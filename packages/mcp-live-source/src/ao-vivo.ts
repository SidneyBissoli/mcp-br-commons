import { TITULO_FONTE_INALCANCAVEL, TITULO_FONTE_INDISPONIVEL } from "./actions.js";
import { Relatorio, type Destinos, type OpcoesDoRelatorio } from "./relatorio.js";
import { capturarComRetentativa, type OpcoesDeRetentativa } from "./retentativa.js";
import type { Falha } from "./veredito.js";

/**
 * O adaptador para runner de testes (vitest em `./vitest`), independente do runner: o
 * núcleo recebe os ganchos `it`/`afterAll` e um contexto com `skip(nota)` que LANÇA (é
 * assim no vitest: `ctx.skip()` interrompe o teste e o marca pulado). Com um dublê dos
 * ganchos o núcleo se testa sem o runner.
 *
 * A política, traduzida para teste: `indisponivel` (depois das idas) → teste PULADO com a
 * nota "Fonte indisponível: …" (o runner sai verde: vitest sai 0 quando só há skips) e
 * registro no relatório; `ambiguo` → repete e, se persistir, falha normal; `respondeu`
 * (404/4xx, ou a asserção do próprio teste — predicado `deriva`, padrão `AssertionError`)
 * e `alheio` → falha normal, sem repetir. Um `Relatorio` por arquivo; no `afterAll` ele
 * escreve o log, as anotações e o `$GITHUB_STEP_SUMMARY` — nada se o arquivo não rodou
 * nenhum teste ao vivo (`describe.runIf(false)`).
 *
 * O disjuntor vale: os testes de um arquivo rodam em sequência, e a partir do momento em
 * que N testes seguidos saíram indisponíveis sem NENHUMA captura, os seguintes pulam sem
 * ir à rede (`registrarNaoMedida`) — a anotação sai `Fonte inalcançável` (erro, como no
 * script) e o `afterAll` LANÇA (`falharSeInalcancavel`, padrão): o arquivo fica vermelho,
 * como o código 3 do script, para o retry automático re-rodar num runner novo. Com
 * `describe.concurrent` a ordem não é garantida e o disjuntor pode disparar tarde; não
 * usar.
 */
export interface ContextoDeTeste {
  /** Interrompe o teste e o marca pulado, com a nota. */
  skip(nota?: string): never;
}

export interface OpcoesDeTeste {
  timeout?: number | undefined;
}

export interface GanchosDoRunner<Ctx extends ContextoDeTeste> {
  it(nome: string, fn: (ctx: Ctx) => Promise<void>, opcoes?: OpcoesDeTeste): void;
  afterAll(fn: () => void): void;
}

export interface OpcoesAoVivo extends Omit<OpcoesDeRetentativa, "dependencia" | "deriva"> {
  /**
   * Rótulo curto para a anotação e o resumo (é o que o painel lê: SEM vírgula). Padrão:
   * o nome do teste.
   */
  endpoint?: string | undefined;
  /** Teto do teste no runner, em ms — deve cobrir TODAS as idas. */
  timeout?: number | undefined;
}

export interface OpcoesDaSuite extends OpcoesDoRelatorio {
  /** Padrão de retentativa de cada `aoVivo` do arquivo (cada um pode sobrepor). */
  retentativa?: Omit<OpcoesDeRetentativa, "dependencia" | "deriva"> | undefined;
  /** Destinos do relatório no `afterAll`. Padrão: stdout, `$GITHUB_STEP_SUMMARY`. */
  destinos?: Destinos | undefined;
  /**
   * Disjuntor disparado (nada capturado, N indisponíveis seguidas) = o `afterAll` LANÇA e
   * o arquivo falha — o equivalente ao código 3 do script de captura, para o retry
   * automático re-rodar num runner novo. Padrão `true`; `false` deixa o arquivo verde
   * só com a anotação `Fonte inalcançável`.
   */
  falharSeInalcancavel?: boolean | undefined;
  /**
   * Orçamento de PAREDE do arquivo, em ms, contado do início do primeiro `aoVivo`. Esgotado,
   * os testes seguintes pulam sem ir à rede (`Fonte inalcançável`, como o disjuntor) e o
   * `afterAll` lança — sujeito a `falharSeInalcancavel`.
   *
   * Por que existe (bcb-br-mcp, 26/10/2026): o disjuntor só cobre a origem que não responde
   * a NADA. Se ela responde às primeiras capturas e para no meio, cada endpoint restante
   * gasta as três idas inteiras (~141 s no bcb), e 135 séries passam de 5 h — o job era
   * cortado pelo `timeout-minutes` de fora, sem rótulo, e o GitHub reporta esse corte
   * como `cancelled`, que o retry automático não re-roda. O orçamento faz o arquivo
   * terminar com veredito ANTES do teto do job. Escolha: teto do job − timeout de um teste
   * − preparo do job, com folga. Sem orçamento (padrão), nenhum limite.
   */
  orcamentoMs?: number | undefined;
  /** Relógio em ms (injetável nos testes). Padrão `performance.now`. */
  agora?: (() => number) | undefined;
}

export type AoVivo<Ctx extends ContextoDeTeste> = (
  nome: string,
  fn: (ctx: Ctx) => Promise<unknown>,
  opcoes?: OpcoesAoVivo,
) => void;

export interface SuiteAoVivo<Ctx extends ContextoDeTeste> {
  aoVivo: AoVivo<Ctx>;
  relatorio: Relatorio;
}

/** A variável de ambiente que o workflow declara AO LADO do `timeout-minutes` do job. */
export const VARIAVEL_DO_ORCAMENTO = "AO_VIVO_ORCAMENTO_S";

/**
 * O orçamento declarado no ambiente, em ms; `undefined` sem a variável (ou vazia). Valor
 * que não é número de segundos > 0 LANÇA: um orçamento digitado errado que virasse
 * "sem orçamento" devolveria em silêncio o defeito que ele existe para impedir.
 */
export function orcamentoDoAmbiente(env: Record<string, string | undefined>): number | undefined {
  const bruto = env[VARIAVEL_DO_ORCAMENTO]?.trim();
  if (bruto === undefined || bruto === "") return undefined;
  const s = Number(bruto);
  if (!Number.isFinite(s) || s <= 0) {
    throw new RangeError(`mcp-live-source: ${VARIAVEL_DO_ORCAMENTO} deve ser segundos > 0 (recebido "${bruto}")`);
  }
  return s * 1000;
}

/** Num teste, só vale repetir o que pode ter sido um soluço da origem. */
export function repetirAoVivo(falha: Falha): boolean {
  return falha.veredito === "indisponivel" || falha.veredito === "ambiguo";
}

/** A asserção do teste (`expect` do vitest, `node:assert`): a origem respondeu e o contrato falhou. */
export function ehAssercao(err: unknown): boolean {
  return err instanceof Error && err.name === "AssertionError";
}

export function criarSuiteAoVivo<Ctx extends ContextoDeTeste>(
  ganchos: GanchosDoRunner<Ctx>,
  opcoes: OpcoesDaSuite = {},
): SuiteAoVivo<Ctx> {
  const deriva = opcoes.deriva ?? ehAssercao;
  const relatorio = new Relatorio({ ...opcoes, deriva });
  const padrao = opcoes.retentativa ?? {};
  const orcamentoMs = opcoes.orcamentoMs;
  if (orcamentoMs !== undefined && !(Number.isFinite(orcamentoMs) && orcamentoMs > 0)) {
    throw new RangeError(`mcp-live-source: orcamentoMs deve ser um número > 0 (recebido ${String(orcamentoMs)})`);
  }
  const agora = opcoes.agora ?? (() => performance.now());
  let inicioDaSuite: number | undefined;

  ganchos.afterAll(() => {
    if (relatorio.resultados.length === 0) return;
    const resumo = relatorio.escrever({ ...opcoes.destinos, codigoDeSaida: false });
    if (resumo.orcamentoEsgotado && !resumo.disjuntor && (opcoes.falharSeInalcancavel ?? true)) {
      throw new Error(
        `${TITULO_FONTE_INALCANCAVEL}: orçamento da rodada esgotado com ${resumo.capturadas} de ` +
          `${resumo.total} capturadas; deriva NÃO medida no resto. O arquivo falha de propósito para ` +
          "o retry automático re-rodar num runner novo (outro IP de saída), em vez de o job ser " +
          "cortado de fora pelo teto (cancelled, que o retry não re-roda).",
      );
    }
    if (resumo.disjuntor && (opcoes.falharSeInalcancavel ?? true)) {
      // O mesmo que o código 3 do script de captura: o arquivo FALHA de propósito.
      // Medido no primeiro dispatch real (ibge, 22/10/2026): os quatro arquivos saíram
      // verdes com `Fonte inalcançável` — o runner estava bloqueado pela origem (regime
      // de 12/09/2026, cura = runner novo), e o retry automático só re-roda em
      // `failure`. Verde ali perdia a noite em silêncio.
      throw new Error(
        `${TITULO_FONTE_INALCANCAVEL}: a origem não respondeu a nenhuma captura deste arquivo ` +
          `(${relatorio.disjuntor.sequencia} indisponíveis seguidas); deriva NÃO medida. O arquivo ` +
          "falha de propósito para o retry automático re-rodar num runner novo (outro IP de saída).",
      );
    }
  });

  const aoVivo: AoVivo<Ctx> = (nome, fn, o = {}) => {
    const endpoint = o.endpoint ?? nome;
    ganchos.it(
      nome,
      async (ctx) => {
        if (relatorio.deveParar) {
          const motivo = `${TITULO_FONTE_INALCANCAVEL}: a origem não respondeu a nenhuma captura; não medido`;
          relatorio.registrarNaoMedida(endpoint, motivo);
          ctx.skip(motivo);
        }
        inicioDaSuite ??= agora();
        if (relatorio.orcamentoEsgotado || (orcamentoMs !== undefined && agora() - inicioDaSuite >= orcamentoMs)) {
          relatorio.marcarOrcamentoEsgotado(orcamentoMs!);
          const motivo = `${TITULO_FONTE_INALCANCAVEL}: orçamento da rodada esgotado; não medido`;
          relatorio.registrarNaoMedida(endpoint, motivo);
          ctx.skip(motivo);
        }
        const inicio = performance.now();
        let idas: number | undefined;
        try {
          await capturarComRetentativa(() => fn(ctx), {
            ...padrao,
            ...o,
            dependencia: opcoes.dependencia,
            deriva,
            repetir: o.repetir ?? padrao.repetir ?? repetirAoVivo,
            aoDesistir: (n, f) => {
              idas = n;
              (o.aoDesistir ?? padrao.aoDesistir)?.(n, f);
            },
          });
        } catch (err) {
          const r = relatorio.registrarFalha(endpoint, err, Math.round(performance.now() - inicio), { idas });
          if (r.falha.veredito === "indisponivel") ctx.skip(`${TITULO_FONTE_INDISPONIVEL}: ${r.falha.motivo}`);
          throw err;
        }
        relatorio.registrarCaptura(endpoint, Math.round(performance.now() - inicio));
      },
      o.timeout === undefined ? undefined : { timeout: o.timeout },
    );
  };

  return { aoVivo, relatorio };
}
