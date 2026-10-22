import { appendFileSync } from "node:fs";
import {
  TITULO_ALHEIO,
  TITULO_AMBIGUO,
  TITULO_DERIVA,
  TITULO_FONTE_INALCANCAVEL,
  TITULO_FONTE_INDISPONIVEL,
  anotacao,
} from "./actions.js";
import { Disjuntor, LIMITE_PADRAO_DO_DISJUNTOR } from "./disjuntor.js";
import { classificarFalha, type Falha, type OpcoesDeClassificacao } from "./veredito.js";

/**
 * Códigos de saída do script de captura. O workflow e o retry automático decidem
 * por eles; o painel do portfólio lê a CONCLUSÃO do job e as anotações.
 */
export const SAIDA_OK = 0;
/** Alguma captura respondeu com forma diferente, ambígua ou com erro nosso: vermelho. */
export const SAIDA_FALHA = 1;
/** Disjuntor: a origem não respondeu a nada. Deriva NÃO foi medida. */
export const SAIDA_FONTE_INALCANCAVEL = 3;

export interface ResultadoOk {
  nome: string;
  ok: true;
  ms: number;
}
export interface ResultadoFalho {
  nome: string;
  ok: false;
  falha: Falha;
  ms: number;
  /** Idas que o script fez (de `capturarComRetentativa`), quando informado. */
  idas?: number | undefined;
}
export type Resultado = ResultadoOk | ResultadoFalho;

export interface Resumo {
  total: number;
  capturadas: number;
  /** Indisponíveis e dependências: deriva NÃO medida nestes. */
  naoMedidas: ResultadoFalho[];
  /** `respondeu`: a origem recusou o pedido (404/4xx) — contrato quebrado. */
  derivas: ResultadoFalho[];
  /** `ambiguo` que persistiu nas tentativas: deriva OU página de erro. */
  ambiguas: ResultadoFalho[];
  /** `alheio`: defeito nosso (código, harness, disco). */
  alheias: ResultadoFalho[];
  disjuntor: boolean;
  codigoDeSaida: number;
}

/**
 * As palavras do log e do resumo que mudam com o FORMATO do repórter. O script de
 * captura e o vitest "capturam" fixtures e, quando a fonte está fora, a fixture
 * commitada fica no lugar; o smoke pós-deploy "verifica" tools no ar, e fonte fora
 * significa que a tool degradou como devia. A política é a mesma; a frase, não.
 */
export interface Vocabulario {
  /** Título do bloco do `$GITHUB_STEP_SUMMARY`. */
  titulo: string;
  /** Particípio da contagem: "N de M capturadas". */
  capturadas: string;
  /** O que significa "não medida" neste formato (entre parênteses, no resumo). */
  naoMedidas: string;
}

export const VOCABULARIO_DA_CAPTURA: Vocabulario = {
  titulo: "Teste contra a fonte viva",
  capturadas: "capturadas",
  naoMedidas: "fonte indisponível; a fixture commitada ficou no lugar",
};

export interface OpcoesDoRelatorio extends OpcoesDeClassificacao {
  limiteDoDisjuntor?: number | undefined;
  vocabulario?: Partial<Vocabulario> | undefined;
}

export interface Destinos {
  /** Linha de log (stdout). Padrão `console.log`. */
  log?: ((linha: string) => void) | undefined;
  /** Comando de workflow (`::warning …`) — também vai ao stdout. Padrão `console.log`. */
  comando?: ((linha: string) => void) | undefined;
  /** Variáveis de ambiente; o resumo vai ao arquivo de `GITHUB_STEP_SUMMARY` se existir. */
  env?: Record<string, string | undefined> | undefined;
  /** Grava o markdown no arquivo do resumo. Padrão `appendFileSync`. */
  anexar?: ((caminho: string, texto: string) => void) | undefined;
  /**
   * Imprimir a linha "código de saída: N". Padrão `true`. `false` quando quem decide a
   * saída do processo é o runner (vitest), não o código do relatório.
   */
  codigoDeSaida?: boolean | undefined;
}

/**
 * O coletor da rodada: registra cada captura (ok ou falha), alimenta o disjuntor e,
 * no fim, aplica a POLÍTICA — decidida pelo dono do portfólio em 22/10/2026:
 *
 * | O que aconteceu | Código | Anotação |
 * |---|---|---|
 * | Tudo capturado | 0 | — |
 * | Só `indisponivel`/`dependencia`, com ≥ 1 captura | **0** | `::warning title=Fonte indisponível::a, b` |
 * | Disjuntor (nada capturado, N indisponíveis seguidas) | **3** | `::error title=Fonte inalcançável::…` |
 * | Qualquer `respondeu` | 1 | `::error title=Deriva de formato::a, b` |
 * | Qualquer `ambiguo` (persistiu nas tentativas) | 1 | `::error title=Ambíguo (deriva ou página de erro)::a` |
 * | Qualquer `alheio` | 1 | `::error title=Falha alheia à origem::a` |
 *
 * Verde com aviso, e não vermelho rotulado, porque o vermelho dispara o retry
 * automático (3 tentativas num 502 que persiste) e pinta o painel de "a fonte mudou"
 * — medido no senado em 22/10/2026: 63 endpoints ok, um em 502 nas três tentativas,
 * três runs vermelhos. A fixture do endpoint não medido fica a commitada, e o teste
 * "live" roda sobre ela: honesto, porque o resumo diz "deriva NÃO medida em N".
 *
 * A mensagem da anotação `Fonte indisponível` é a lista de nomes separada por
 * vírgula e espaço — é o que o painel lê para contar noites por endpoint.
 */
export class Relatorio {
  readonly #resultados: Resultado[] = [];
  readonly #disjuntor: Disjuntor;
  readonly #classificacao: OpcoesDeClassificacao;
  readonly vocabulario: Vocabulario;

  constructor(opcoes: OpcoesDoRelatorio = {}) {
    this.#disjuntor = new Disjuntor(opcoes.limiteDoDisjuntor ?? LIMITE_PADRAO_DO_DISJUNTOR);
    this.#classificacao = { dependencia: opcoes.dependencia, deriva: opcoes.deriva };
    this.vocabulario = { ...VOCABULARIO_DA_CAPTURA, ...semIndefinidos(opcoes.vocabulario ?? {}) };
  }

  get disjuntor(): Disjuntor {
    return this.#disjuntor;
  }

  get resultados(): readonly Resultado[] {
    return this.#resultados;
  }

  registrarCaptura(nome: string, ms: number): ResultadoOk {
    const r: ResultadoOk = { nome, ok: true, ms };
    this.#resultados.push(r);
    this.#disjuntor.registrarCaptura();
    return r;
  }

  registrarFalha(nome: string, err: unknown, ms: number, opcoes: { idas?: number | undefined } = {}): ResultadoFalho {
    return this.registrarVeredito(nome, classificarFalha(err, this.#classificacao), ms, opcoes);
  }

  /**
   * Falha JÁ classificada por quem mediu de outro jeito — o smoke pós-deploy, que não
   * tem o erro da origem em mãos (a tool devolveu `isError` no fio) e decide pela
   * SONDA direta na fonte. Entra no disjuntor como qualquer falha.
   */
  registrarVeredito(nome: string, falha: Falha, ms: number, opcoes: { idas?: number | undefined } = {}): ResultadoFalho {
    const r: ResultadoFalho = { nome, ok: false, falha, ms, idas: opcoes.idas };
    this.#resultados.push(r);
    this.#disjuntor.registrarFalha(falha.veredito);
    return r;
  }

  /**
   * Captura que nem foi tentada porque o disjuntor já tinha disparado (num runner de
   * testes, que não para o laço, cada teste seguinte pula sem ir à rede). Conta como
   * não medida, sem mexer no disjuntor.
   */
  registrarNaoMedida(nome: string, motivo: string): ResultadoFalho {
    const falha: Falha = { veredito: "dependencia", motivo, kind: undefined, status: undefined, url: undefined };
    const r: ResultadoFalho = { nome, ok: false, falha, ms: 0 };
    this.#resultados.push(r);
    return r;
  }

  /** `true` quando o laço deve parar: a origem não respondeu a nada. */
  get deveParar(): boolean {
    return this.#disjuntor.disparou;
  }

  resumo(): Resumo {
    const falhas = this.#resultados.filter((r): r is ResultadoFalho => !r.ok);
    const por = (v: Falha["veredito"]) => falhas.filter((r) => r.falha.veredito === v);
    const naoMedidas = falhas.filter((r) => r.falha.veredito === "indisponivel" || r.falha.veredito === "dependencia");
    const derivas = por("respondeu");
    const ambiguas = por("ambiguo");
    const alheias = por("alheio");
    const disjuntor = this.#disjuntor.disparou;
    const codigoDeSaida = disjuntor
      ? SAIDA_FONTE_INALCANCAVEL
      : derivas.length + ambiguas.length + alheias.length > 0
        ? SAIDA_FALHA
        : SAIDA_OK;
    return {
      total: this.#resultados.length,
      capturadas: this.#disjuntor.capturadas,
      naoMedidas,
      derivas,
      ambiguas,
      alheias,
      disjuntor,
      codigoDeSaida,
    };
  }

  codigoDeSaida(): number {
    return this.resumo().codigoDeSaida;
  }

  /** As anotações da rodada, na ordem em que saem — uma por veredito presente. */
  anotacoes(resumo: Resumo = this.resumo()): string[] {
    const nomes = (lista: ResultadoFalho[]) => lista.map((r) => r.nome).join(", ");
    const saida: string[] = [];
    if (resumo.disjuntor) {
      saida.push(
        anotacao(
          "error",
          TITULO_FONTE_INALCANCAVEL,
          `nenhuma captura respondeu (${this.#disjuntor.sequencia} indisponíveis seguidas); deriva NÃO medida — não é deriva de formato`,
        ),
      );
    } else if (resumo.naoMedidas.length > 0) {
      saida.push(anotacao("warning", TITULO_FONTE_INDISPONIVEL, nomes(resumo.naoMedidas)));
    }
    if (resumo.derivas.length > 0) saida.push(anotacao("error", TITULO_DERIVA, nomes(resumo.derivas)));
    if (resumo.ambiguas.length > 0) saida.push(anotacao("error", TITULO_AMBIGUO, nomes(resumo.ambiguas)));
    if (resumo.alheias.length > 0) saida.push(anotacao("error", TITULO_ALHEIO, nomes(resumo.alheias)));
    return saida;
  }

  /** Escreve stdout (uma linha por falha + a conclusão), as anotações e o resumo do job. */
  escrever(destinos: Destinos = {}): Resumo {
    const log = destinos.log ?? ((l: string) => console.log(l));
    const comando = destinos.comando ?? ((l: string) => console.log(l));
    const env = destinos.env ?? process.env;
    const anexar = destinos.anexar ?? ((caminho: string, texto: string) => appendFileSync(caminho, texto, "utf8"));
    const resumo = this.resumo();

    const vocabulario = this.vocabulario;
    for (const linha of linhasDeConclusao(resumo, { codigoDeSaida: destinos.codigoDeSaida ?? true, vocabulario })) log(linha);
    for (const a of this.anotacoes(resumo)) comando(a);
    const arquivo = env["GITHUB_STEP_SUMMARY"];
    if (arquivo !== undefined && arquivo !== "") anexar(arquivo, resumoMarkdown(resumo, { vocabulario }));
    return resumo;
  }
}

function semIndefinidos<T extends object>(o: T): Partial<T> {
  const saida: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (saida as Record<string, unknown>)[k] = v;
  return saida;
}

/** A linha de log de uma captura, como o script a imprime ao vivo. */
export function linhaDeResultado(r: Resultado): string {
  if (r.ok) return `ok (${r.ms}ms)`;
  return `FALHOU [${r.falha.veredito}] (${r.ms}ms${idasTexto(r)}): ${r.falha.motivo}`;
}

/** ", 3 idas" quando o script informou quantas vezes tentou; vazio quando não. */
function idasTexto(r: ResultadoFalho): string {
  if (r.idas === undefined) return "";
  return r.idas === 1 ? ", 1 ida" : `, ${r.idas} idas`;
}

export function linhasDeConclusao(
  resumo: Resumo,
  opcoes: { codigoDeSaida?: boolean | undefined; vocabulario?: Vocabulario | undefined } = {},
): string[] {
  const v = opcoes.vocabulario ?? VOCABULARIO_DA_CAPTURA;
  const linhas: string[] = [];
  const lista = (titulo: string, itens: ResultadoFalho[]) => {
    if (itens.length === 0) return;
    linhas.push(`${titulo} (${itens.length}): ${itens.map((r) => r.nome).join(", ")}`);
  };
  linhas.push("");
  if (resumo.disjuntor) {
    linhas.push(
      "PARANDO CEDO: a origem não respondeu a nenhuma captura. Isto NÃO é deriva de formato — " +
        "a deriva não foi medida nesta rodada. Re-rodar o job cai em outro IP de saída.",
    );
  }
  linhas.push(`${resumo.capturadas} de ${resumo.total} ${v.capturadas}.`);
  lista("Fonte indisponível — deriva NÃO medida", resumo.naoMedidas);
  lista("Deriva de formato (a origem recusou o pedido)", resumo.derivas);
  lista("Ambíguo (formato mudou OU página de erro; persistiu nas tentativas)", resumo.ambiguas);
  lista("Falha alheia à origem (defeito nosso)", resumo.alheias);
  if (opcoes.codigoDeSaida ?? true) linhas.push(`código de saída: ${resumo.codigoDeSaida}`);
  return linhas;
}

/** O bloco de `$GITHUB_STEP_SUMMARY` (markdown do GitHub). */
export function resumoMarkdown(resumo: Resumo, opcoes: { vocabulario?: Vocabulario | undefined } = {}): string {
  const v = opcoes.vocabulario ?? VOCABULARIO_DA_CAPTURA;
  const partes: string[] = [];
  if (resumo.disjuntor) {
    partes.push("### Fonte inalcançável", "");
    partes.push(
      "Nenhuma captura respondeu; o disjuntor parou a rodada. **A deriva de formato NÃO foi " +
        "medida nesta noite** — isto não é deriva. Re-rodar o job cai em outro IP de saída.",
      "",
    );
  } else {
    partes.push(`### ${v.titulo}`, "");
    partes.push(`${resumo.capturadas} de ${resumo.total} ${v.capturadas}.`, "");
    if (resumo.naoMedidas.length > 0) {
      partes.push(
        `**Deriva NÃO medida em ${resumo.naoMedidas.length} endpoint${resumo.naoMedidas.length === 1 ? "" : "s"}** ` +
          `(${v.naoMedidas}):`,
        "",
      );
    }
  }
  const tabela = (titulo: string, itens: ResultadoFalho[]) => {
    if (itens.length === 0) return;
    partes.push(`#### ${titulo}`, "", "| Endpoint | HTTP | Idas | Motivo |", "|---|---|---|---|");
    for (const r of itens) {
      partes.push(
        `| \`${r.nome}\` | ${r.falha.status ?? "—"} | ${r.idas ?? "—"} | ${r.falha.motivo.replaceAll("|", "\\|")} |`,
      );
    }
    partes.push("");
  };
  tabela("Fonte indisponível", resumo.naoMedidas);
  tabela("Deriva de formato", resumo.derivas);
  tabela("Ambíguo (deriva ou página de erro)", resumo.ambiguas);
  tabela("Falha alheia à origem", resumo.alheias);
  return partes.join("\n") + "\n";
}
