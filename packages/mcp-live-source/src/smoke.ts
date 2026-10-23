import { UpstreamError, createUpstream, entregaDaOrigem, type EntregaDaOrigem } from "@sbissoli/mcp-upstream";
import { Relatorio, type Destinos, type Resumo, type Vocabulario } from "./relatorio.js";
import type { Falha } from "./veredito.js";

/**
 * O terceiro formato do repórter: o SMOKE pós-deploy.
 *
 * O smoke chama as tools do servidor NO AR (pela rota de uso próprio) logo depois do
 * deploy, e só vê o que viaja no fio: `isError` e um texto. A classe do erro da origem
 * não viaja (é chave-símbolo não enumerável, só a telemetria a lê), então o smoke NÃO
 * pode decidir pela frase — e decidia: o bcb (22/10/2026, #75) reprovou duas
 * reexecuções com o SGS em 502, cada rodada derrubando tools diferentes, porque a regex
 * de "upstream fora" não cobria os textos; o ibge (mesmo dia, run 39853335263) ficou
 * vermelho em `ibge_estados retornou erro`, sem o texto, com o Worker no ar na versão
 * certa e o IBGE recusando conexões de parte das nuvens.
 *
 * O instrumento honesto é o que o bcb adotou em #76: SONDAR a fonte diretamente, fora
 * do servidor, no instante em que a tool falhou. Aqui a sonda é um `createUpstream` do
 * próprio portfólio (`retries: 0`, prazo curto) e o veredito vem de `entregaDaOrigem`,
 * pelo `kind` do erro — nunca por frase:
 *
 * | A tool devolveu `isError` e… | Veredito | Efeito |
 * |---|---|---|
 * | a sonda não obteve o esperado (timeout, rede, 429, 5xx, corpo não aceito) | `indisponivel` | **verde** com `::warning title=Fonte indisponível::tool` |
 * | a origem respondeu 4xx com PÁGINA HTML (gateway/WAF, não o recurso) | `indisponivel` | verde com aviso — 0.3.1 |
 * | a origem recusou (401/403) uma sonda que foi COM credencial (`recusaEhFora`) | `indisponivel` | verde com aviso — 0.3.1 |
 * | a sonda obteve o esperado, ou a origem respondeu (4xx sem página HTML) | `alheio` | **vermelho** (`Falha alheia à origem`): a tool quebrou com a fonte de pé |
 * | não há sonda declarada para a verificação | `alheio` | vermelho: ninguém mediu a fonte |
 *
 * Por que 4xx com HTML é fora (0.3.1): medido em 22/10/2026 no pool da OIT (`sdmx.ilo.org`,
 * 3 servidores atrás de um cookie de afinidade): dois deles respondiam 403 com a página de
 * erro do IIS a um pedido BOM, em ~60% dos pedidos; o 502 do BCB atrás do Azure Front Door
 * também é página HTML. Uma página de erro de gateway não é a origem respondendo ao
 * pedido — é a origem não entregando o recurso; lê-la como "de pé" pintava de vermelho a
 * tool que tinha falhado exatamente por isso. A `aceita` NÃO é consultada em 4xx: quem
 * decide é a forma do corpo (HTML), porque um 404 em JSON continua sendo resposta.
 *
 * O resto do smoke não muda de natureza: a verificação que LANÇA (asserção sobre o
 * resultado, HTTP do endpoint, JSON-RPC) é defeito do deploy e sai vermelha; a tool
 * que DEVIA recusar (`esperaErro`) e não recusou também. Prova de que o deploy
 * subiu continua sendo o passo anterior do workflow ("Versão hospedada bate com o
 * package.json"); o smoke prova que o que subiu responde.
 *
 * O disjuntor NÃO vale aqui: num smoke a fonte inteira fora é verde com aviso (o
 * servidor degradou como devia em cada tool), não código 3 — não há retry a disparar
 * e a versão já foi provada. Por isso o relatório nasce com limite infinito.
 */

/** Pedido mínimo e barato a um recurso da origem que EXISTE. */
export interface Sonda {
  /** Nome curto: vai ao log e ao motivo da anotação. */
  nome: string;
  url: string;
  /**
   * O corpo é o esperado? (`JSON.parse` dá certo, é um array, tem tal chave.) Corpo
   * recusado conta como fonte fora: a origem serviu a página de erro num pedido bom
   * (o SGS faz isso em HTML, medido em 24/09/2026). Padrão: qualquer corpo com 2xx.
   */
  aceita?: ((corpo: string, resposta: Response) => boolean) | undefined;
  /** Cabeçalhos do pedido — um `User-Agent` de navegador quando o WAF da origem exige. */
  cabecalhos?: Record<string, string> | undefined;
  /** Teto da sonda, em ms, numa tentativa só. Padrão 8 000. */
  timeoutMs?: number | undefined;
  /**
   * A sonda vai COM credencial (bearer em `cabecalhos`): então 401/403 não é "a origem
   * está de pé e recusou o pedido mínimo" — é a origem recusando a credencial que o
   * servidor usa, isto é, não servindo a nós. Conta como fora (aviso), com o status no
   * estado. Padrão `false`: sem credencial, 4xx sem página HTML é "de pé". Medido na API
   * ICD-11 da OMS (22/10/2026): nenhum recurso dela responde sem token.
   */
  recusaEhFora?: boolean | undefined;
}

/**
 * O corpo é uma página HTML (de erro de gateway/WAF), não o recurso pedido? Decide pela
 * ABERTURA do documento (depois de espaço em branco), não por `<html` em qualquer lugar:
 * um JSON que cite HTML num campo é JSON.
 */
export function pareceHtml(corpo: string | undefined): boolean {
  if (corpo === undefined) return false;
  return /^\s*(<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>])/i.test(corpo.slice(0, 1024));
}

export const TEMPO_DA_SONDA_MS = 8_000;

export type VereditoDaSonda = "servindo" | "fora" | "nao-sondada";

export interface EstadoDaSonda {
  nome: string;
  url: string;
  /**
   * `servindo`: a origem respondeu ao pedido mínimo — com o corpo esperado, ou recusando
   * (4xx: ela está de pé; o pedido é que ela não aceitou). `fora`: não entregou nada
   * medível (timeout, rede, 429, 5xx) ou entregou corpo que `aceita` recusou.
   * `nao-sondada`: o erro nem veio da origem (defeito da própria sonda).
   */
  veredito: VereditoDaSonda;
  /** Uma frase para o log e o motivo. */
  estado: string;
  ms: number;
  /** O veredito do mcp-upstream quando a sonda falhou. */
  entrega: EntregaDaOrigem | undefined;
}

export const VOCABULARIO_DO_SMOKE: Vocabulario = {
  titulo: "Smoke em produção",
  capturadas: "verificadas",
  naoMedidas: "a fonte estava fora quando a tool foi chamada e a tool degradou como devia; não é defeito do deploy",
};

export interface OpcoesDoSmoke {
  /** As fontes que as tools consultam. Vazio = nenhuma falha de tool é explicável. */
  sondas: Sonda[];
  /** Reconhece "depende de verificação que falhou" lançado pelo roteiro. Padrão: nada. */
  dependencia?: ((err: unknown) => boolean) | undefined;
  /** Destinos do log e do relatório. Padrão: stdout e `$GITHUB_STEP_SUMMARY`. */
  destinos?: Destinos | undefined;
  /** Quantos caracteres do texto da tool entram no motivo. Padrão 200. */
  tamanhoDoTexto?: number | undefined;
  /** Injeção para teste offline: o `fetch` das sondas. */
  fetchImpl?: typeof fetch | undefined;
}

export interface OpcoesDeVerificacao {
  /** A tool TEM de recusar (erro pedagógico): `isError` é o resultado certo. */
  esperaErro?: boolean | undefined;
  /** Quais sondas (por nome) explicam uma falha desta verificação. Padrão: todas. */
  sondas?: string[] | undefined;
  /** Detalhe impresso na linha `[OK  ]`, a partir do resultado. */
  detalhe?: ((resultado: unknown) => string) | undefined;
  /**
   * A duração da chamada, quando ela aconteceu FORA de `fn` (o roteiro já tinha o
   * resultado em mãos e `fn` só o devolve): número em ms, medido por quem chamou. `null`
   * = verificação sem chamada nenhuma (asserção sobre um resultado já obtido): a linha
   * `[OK  ]` sai sem tempo, em vez de um "(0 ms)" que mede a asserção e parece medir a
   * tool. Padrão: o pacote cronometra `fn`.
   */
  ms?: number | null | undefined;
}

export interface Smoke {
  readonly relatorio: Relatorio;
  /**
   * Roda uma verificação e a registra. Devolve o resultado quando ela passou (para o
   * roteiro encadear: o `fetch` usa o id do `search`) e `undefined` quando falhou —
   * nunca lança: o roteiro segue, e a política decide no fim.
   */
  verificar<T>(nome: string, fn: () => Promise<T>, opcoes?: OpcoesDeVerificacao): Promise<T | undefined>;
  /** Verificação que nem foi tentada porque depende de outra que falhou. */
  naoMedida(nome: string, motivo: string): void;
  /** Sonda as fontes (todas, ou as nomeadas) e as imprime — também serve a um `--sonda`. */
  sondar(nomes?: string[]): Promise<EstadoDaSonda[]>;
  /** Escreve conclusão, anotações e resumo do job; devolve o resumo com o código de saída. */
  concluir(): Resumo;
}

/** O resultado de `tools/call` como viaja no fio. */
interface ResultadoNoFio {
  isError?: unknown;
  content?: unknown;
}

function ehResultadoNoFio(x: unknown): x is ResultadoNoFio {
  return typeof x === "object" && x !== null;
}

function textoDoResultado(r: ResultadoNoFio): string {
  if (!Array.isArray(r.content)) return "";
  return r.content
    .map((c) => (typeof c === "object" && c !== null && typeof (c as { text?: unknown }).text === "string" ? (c as { text: string }).text : ""))
    .filter((t) => t !== "")
    .join(" ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

async function sondarUma(sonda: Sonda, fetchImpl: typeof fetch | undefined): Promise<EstadoDaSonda> {
  const timeoutMs = sonda.timeoutMs ?? TEMPO_DA_SONDA_MS;
  const aceita = sonda.aceita;
  const upstream = createUpstream({
    retries: 0,
    timeoutMs,
    budgetMs: timeoutMs,
    fetchImpl,
    inspectBody: aceita === undefined ? undefined : (resposta, corpo) => (aceita(corpo, resposta) ? null : "malformed_body"),
  });
  const inicio = performance.now();
  const base = { nome: sonda.nome, url: sonda.url };
  try {
    await upstream.call().text(sonda.url, sonda.cabecalhos === undefined ? {} : { headers: sonda.cabecalhos });
    return { ...base, veredito: "servindo", estado: "servindo (respondeu 2xx com o corpo esperado)", ms: decorrido(inicio), entrega: undefined };
  } catch (err) {
    const entrega = entregaDaOrigem(err);
    const ms = decorrido(inicio);
    if (entrega.veredito === "respondeu") {
      const status = entrega.status ?? "4xx";
      const corpo = err instanceof UpstreamError ? err.body : undefined;
      if (pareceHtml(corpo)) {
        return {
          ...base,
          veredito: "fora",
          estado: `FORA (respondeu HTTP ${status} com página HTML — página de erro de gateway/WAF, não o recurso)`,
          ms,
          entrega,
        };
      }
      if (sonda.recusaEhFora === true) {
        return { ...base, veredito: "fora", estado: `FORA (recusou a credencial da sonda: HTTP ${status})`, ms, entrega };
      }
      return {
        ...base,
        veredito: "servindo",
        estado: `de pé, mas recusou o pedido mínimo (HTTP ${status}) — conferir a URL da sonda`,
        ms,
        entrega,
      };
    }
    if (entrega.veredito === "alheio") {
      return { ...base, veredito: "nao-sondada", estado: `a sonda não chegou a medir: ${entrega.motivo}`, ms, entrega };
    }
    const como =
      entrega.kind === "timeout"
        ? `não respondeu em ${timeoutMs} ms`
        : entrega.kind === "network"
          ? "não foi alcançada (rede)"
          : entrega.kind === "rate_limited"
            ? "limitou a taxa (HTTP 429)"
            : entrega.kind === "malformed_body"
              ? `respondeu${entrega.status === undefined ? "" : ` HTTP ${entrega.status}`} com corpo que não é o esperado`
              : `respondeu HTTP ${entrega.status ?? "5xx"}`;
    return { ...base, veredito: "fora", estado: `FORA (${como})`, ms, entrega };
  }
}

function decorrido(inicio: number): number {
  return Math.round(performance.now() - inicio);
}

export function criarSmoke(opcoes: OpcoesDoSmoke): Smoke {
  const log = opcoes.destinos?.log ?? ((l: string) => console.log(l));
  const tamanho = opcoes.tamanhoDoTexto ?? 200;
  const relatorio = new Relatorio({
    limiteDoDisjuntor: Number.POSITIVE_INFINITY,
    dependencia: opcoes.dependencia,
    vocabulario: VOCABULARIO_DO_SMOKE,
  });
  const porNome = new Map(opcoes.sondas.map((s) => [s.nome, s] as const));
  if (porNome.size !== opcoes.sondas.length) throw new TypeError("mcp-live-source: sondas com nome repetido");

  const escolher = (nomes: string[] | undefined): Sonda[] => {
    if (nomes === undefined) return opcoes.sondas;
    return nomes.map((n) => {
      const s = porNome.get(n);
      if (s === undefined) throw new TypeError(`mcp-live-source: sonda "${n}" não declarada em criarSmoke`);
      return s;
    });
  };

  const sondar = async (nomes?: string[]): Promise<EstadoDaSonda[]> => {
    const estados = await Promise.all(escolher(nomes).map((s) => sondarUma(s, opcoes.fetchImpl)));
    for (const e of estados) log(`        sonda ${e.nome}: ${e.estado} (${e.ms} ms)`);
    return estados;
  };

  const registrar = (nome: string, falha: Falha, ms: number): void => {
    const r = relatorio.registrarVeredito(nome, falha, ms);
    log(`  [${r.falha.veredito === "indisponivel" ? "AVISO" : "FALHA"}] ${nome} — ${r.falha.motivo}`);
  };

  const alheia = (motivo: string): Falha => ({ veredito: "alheio", motivo, kind: undefined, status: undefined, url: undefined });

  const verificar = async <T>(nome: string, fn: () => Promise<T>, o: OpcoesDeVerificacao = {}): Promise<T | undefined> => {
    const inicio = performance.now();
    let resultado: T;
    try {
      resultado = await fn();
    } catch (err) {
      const ms = decorrido(inicio);
      const texto = err instanceof Error ? err.message : String(err);
      if (opcoes.dependencia?.(err) === true) {
        naoMedida(nome, `depende de verificação que falhou (${texto})`);
        return undefined;
      }
      registrar(nome, alheia(`a verificação lançou ${err instanceof Error ? err.name : typeof err}: ${texto}`), ms);
      return undefined;
    }
    const ms = o.ms === undefined ? decorrido(inicio) : (o.ms ?? 0);
    const comErro = ehResultadoNoFio(resultado) && resultado.isError === true;

    if (o.esperaErro === true) {
      if (comErro) return ok(nome, resultado, ms, o);
      registrar(nome, alheia("a tool devia recusar o pedido e respondeu sem erro"), ms);
      return undefined;
    }
    if (!comErro) return ok(nome, resultado, ms, o);

    const texto = textoDoResultado(resultado as ResultadoNoFio).slice(0, tamanho);
    const disse = texto === "" ? "a tool não disse por quê" : `a tool disse: ${texto}`;
    const estados = await sondar(o.sondas);
    const fora = estados.filter((e) => e.veredito === "fora");
    const descrever = (lista: EstadoDaSonda[]) => lista.map((e) => `${e.nome}: ${e.estado}`).join("; ");
    if (estados.length === 0) {
      registrar(nome, alheia(`a tool devolveu erro e não há sonda declarada para dizer se a fonte estava no ar; ${disse}`), ms);
      return undefined;
    }
    if (fora.length > 0) {
      const primeira = fora[0]!;
      relatorio.registrarVeredito(
        nome,
        {
          veredito: "indisponivel",
          motivo: `a tool devolveu erro e a fonte sondada está fora — ${descrever(fora)}; ${disse}`,
          kind: primeira.entrega?.kind,
          status: primeira.entrega?.status,
          url: primeira.url,
        },
        ms,
      );
      log(`  [AVISO] ${nome} — fonte fora (${descrever(fora)}); ${disse}`);
      return undefined;
    }
    registrar(nome, alheia(`a tool devolveu erro com a fonte no ar (${descrever(estados)}); ${disse}`), ms);
    return undefined;
  };

  const ok = <T>(nome: string, resultado: T, ms: number, o: OpcoesDeVerificacao): T => {
    relatorio.registrarCaptura(nome, ms);
    const detalhe = o.detalhe?.(resultado);
    const tempo = o.ms === null ? "" : ` (${ms} ms)`;
    log(`  [OK  ] ${nome}${tempo}${detalhe === undefined || detalhe === "" ? "" : ` — ${detalhe}`}`);
    return resultado;
  };

  const naoMedida = (nome: string, motivo: string): void => {
    relatorio.registrarNaoMedida(nome, motivo);
    log(`  [PULOU] ${nome} — ${motivo}`);
  };

  const concluir = (): Resumo => relatorio.escrever(opcoes.destinos);

  return { relatorio, verificar, naoMedida, sondar, concluir };
}
