import { UpstreamError, type UpstreamErrorKind } from "./errors.js";

/**
 * A origem ENTREGOU algo medível?
 *
 * Pergunta de quem roda teste de contrato, smoke pós-deploy ou sonda de recuperação
 * contra a fonte viva — e precisa separar "a fonte mudou" (deriva, defeito a corrigir)
 * de "a fonte está fora" (nada a corrigir, repetir depois). Medido em 22/10/2026 nos
 * dois formatos do portfólio, no mesmo dia:
 *
 * - O smoke pós-deploy do bcb reprovou DUAS reexecuções com o SGS em 502, cada rodada
 *   derrubando testes diferentes: a tool devolvia erro cuja frase a regex de "upstream
 *   fora" não cobria, e o deploy saiu vermelho sem defeito nenhum.
 * - O teste de contrato do senado reprovou nas três tentativas porque UM endpoint
 *   respondeu 502 nas três; o classificador local só distinguia "nada respondeu"
 *   (disjuntor) de "outra coisa", e 5xx isolado caiu em "outra" — o painel abriu
 *   "a fonte mudou ou uma referência externa quebrou".
 *
 * Os dois reinventavam, por frase, uma decisão que é função do `kind` do
 * `UpstreamError` — e o `kind` já é escolhido pelo STATUS e pelo que chegou, nunca
 * pelo texto (`upstream.ts`). Esta função só nomeia a consequência, num vocabulário
 * fechado, para que todo consumidor diga a mesma coisa sobre o mesmo erro.
 *
 * Os quatro vereditos:
 *
 * - `indisponivel` — a origem NÃO entregou corpo para comparar: timeout, rede,
 *   429, 5xx. Deriva não foi medida nesta ida; não é deriva. O 5xx entra aqui mesmo
 *   tendo "chegado uma resposta": o que chegou é a página de erro do gateway, não o
 *   recurso pedido, e compará-la com a fixture afirmaria deriva de um corpo que a
 *   origem nunca pretendeu servir.
 * - `respondeu` — a origem respondeu ao pedido, e a resposta é a recusa dele: 404 ou
 *   outro 4xx. É território de contrato (rota, chave, parâmetro): quem decide o que a
 *   recusa significa é o consumidor, lendo `status`/`body`. Não é indisponibilidade.
 * - `ambiguo` — chegou um corpo que não é o esperado (`malformed_body`): ou a origem
 *   mudou o formato (deriva real), ou serviu a página de erro num pedido bom (o SGS
 *   responde HTML a série que EXISTE quando soluça, medido em 24/09/2026 na 432). A
 *   mesma forma, duas causas, e a diferença é inexistência × transitório: se resolve
 *   por REPETIÇÃO em outra ida, não por leitura desta. O veredito nomeia a dúvida em
 *   vez de escondê-la num dos lados.
 * - `alheio` — não é a origem: o chamador abortou (`aborted`), ou o erro nem é um
 *   `UpstreamError` (defeito do próprio código, do harness, do disco). Reprovar o
 *   contrato por isso seria culpar a fonte pelo que é nosso.
 *
 * O que NÃO está aqui, de propósito: política. Se `indisponivel` deve virar aviso,
 * teste pulado, código de saída 3 ou retry é decisão do repórter de cada formato
 * (peça 2 do item `mcp:fonte-indisponivel-nao-e-deriva`); esta função só responde a
 * pergunta, e responde igual para todos.
 */
export type VereditoDeEntrega = "indisponivel" | "respondeu" | "ambiguo" | "alheio";

export interface EntregaDaOrigem {
  veredito: VereditoDeEntrega;
  /** `kind` do erro quando é um `UpstreamError`; `undefined` para erro alheio. */
  kind: UpstreamErrorKind | undefined;
  /** Status HTTP quando uma resposta chegou. */
  status: number | undefined;
  /** URL da ida, quando é um `UpstreamError`. */
  url: string | undefined;
  /** Uma frase em pt-BR para o log ou o resumo do job — nunca a base da decisão. */
  motivo: string;
}

const INDISPONIVEL: ReadonlySet<UpstreamErrorKind> = new Set(["timeout", "network", "rate_limited", "http_5xx"]);
const RESPONDEU: ReadonlySet<UpstreamErrorKind> = new Set(["not_found", "http_4xx"]);

/**
 * O `UpstreamError` do pacote, se `err` é um ou CARREGA um na cadeia `cause`.
 *
 * Os servidores do portfólio traduzem o erro do pacote para uma classe local (o
 * senado tem o seu `UpstreamError`, o medical o `HttpError`) antes de ele chegar a
 * quem testa o contrato — e, até a 0.5.0, essa tradução deixava o veredito em
 * `alheio`, como se o erro fosse do nosso código. Seguir `cause` deixa o servidor
 * manter a classe dele e ainda assim responder a pergunta certa, desde que ele
 * passe o erro do pacote como `cause` (ES2022). A busca para no primeiro
 * `UpstreamError` e tem teto, porque `cause` pode formar ciclo.
 */
function origemNaCadeia(err: unknown): UpstreamError | undefined {
  let atual: unknown = err;
  for (let profundidade = 0; profundidade < 16 && atual !== undefined && atual !== null; profundidade++) {
    if (atual instanceof UpstreamError) return atual;
    if (!(atual instanceof Error)) return undefined;
    atual = atual.cause;
  }
  return undefined;
}

export function entregaDaOrigem(err: unknown): EntregaDaOrigem {
  const daOrigem = origemNaCadeia(err);
  if (daOrigem === undefined) {
    const texto = err instanceof Error ? err.message : String(err);
    return {
      veredito: "alheio",
      kind: undefined,
      status: undefined,
      url: undefined,
      motivo: `erro que não veio da origem (${err instanceof Error ? err.name : typeof err}): ${texto}`,
    };
  }
  return vereditoDoErro(daOrigem);
}

function vereditoDoErro(err: UpstreamError): EntregaDaOrigem {
  const base = { kind: err.kind, status: err.status, url: err.url };
  const tent = err.attempts === 1 ? "1 tentativa" : `${err.attempts} tentativas`;
  if (err.kind === "aborted") {
    return { veredito: "alheio", ...base, motivo: "requisição cancelada pelo chamador; a origem não foi medida" };
  }
  if (INDISPONIVEL.has(err.kind)) {
    const como =
      err.kind === "timeout"
        ? "não respondeu dentro do prazo"
        : err.kind === "network"
          ? "não foi alcançada (rede)"
          : err.kind === "rate_limited"
            ? "limitou a taxa de requisições (HTTP 429)"
            : `respondeu HTTP ${err.status ?? "5xx"}`;
    return {
      veredito: "indisponivel",
      ...base,
      motivo: `a origem ${como} em ${tent}; nada medível chegou — não é deriva`,
    };
  }
  if (RESPONDEU.has(err.kind)) {
    return {
      veredito: "respondeu",
      ...base,
      motivo: `a origem recusou o pedido (HTTP ${err.status ?? "4xx"}); é resposta, não indisponibilidade`,
    };
  }
  // malformed_body: o único kind que sobra — e o único que a forma não resolve.
  return {
    veredito: "ambiguo",
    ...base,
    motivo:
      `a origem respondeu${err.status === undefined ? "" : ` HTTP ${err.status}`} com corpo que não é o esperado ` +
      `em ${tent}: ou o formato mudou, ou ela serviu a página de erro num pedido bom — repetir em outra ida decide`,
  };
}
