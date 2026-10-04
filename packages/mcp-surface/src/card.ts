/**
 * Server card estático (`/.well-known/mcp/server-card.json`) para scanners de
 * diretório que o leem em vez de conectar ao `/mcp` — a Smithery lê quando a
 * varredura automática não completa, e um card velho NÃO se conserta
 * republicando: ele é lido de novo na próxima varredura.
 *
 * Por que existe. Em 04/10/2026, 4 dos 7 servidores serviam o card por um
 * `worker/src/card.ts` copiado entre eles, e os outros 3 respondiam 404. Os
 * quatro que serviam publicavam `name`/`version` soltos na raiz, enquanto a
 * forma documentada pela Smithery (smithery.ai/docs/build/publish) exige
 * `serverInfo: { name, version }` — fora do formato em todos.
 *
 * Desenho:
 * - DERIVADO da mesma captura crua que a trava normaliza (`captura.ts`), nunca
 *   transcrito: `serverInfo` é o do `initialize` real, versão incluída;
 *   `superficieDoCard` faz a volta, e o teste do servidor prova que o card
 *   normalizado tem o MESMO sha256 da seção `declarada` do `surface.lock.json`.
 * - Método não servido fica FORA do card (não vira `[]`): "não serve" e "serve
 *   nada" são superfícies diferentes, e a volta precisa ser exata.
 * - `authentication.required` sai da seção `semToken` da trava
 *   (`autenticacaoDaTrava`) — o que a borda MEDIU, não o que alguém declarou.
 * - Subpath próprio (`@sbissoli/mcp-surface/card`) e seguro para Worker: só
 *   importa `captura.ts` e `sonda.ts` — sem `node:crypto`, sem
 *   `node:child_process`, sem Ajv.
 */

import { capturarBrutaEmMemoria, capturarBrutaPor, type ServidorConectavel, type SuperficieBruta } from "./captura.js";
import { CABECALHOS_MCP, corpoDoPedido, lerCorpoJsonRpc, type Pedido } from "./sonda.js";

export type { ServidorConectavel, SuperficieBruta } from "./captura.js";

/** O campo `authentication` do card (forma da Smithery). */
export interface Autenticacao {
  required: boolean;
  schemes?: string[];
}

export interface OpcoesCard {
  /** Quase sempre `autenticacaoDaTrava(trava)`; ausente = o card não fala de autenticação. */
  authentication?: Autenticacao;
}

const LISTAS = ["tools", "resources", "resourceTemplates", "prompts"] as const;

/**
 * Monta o card a partir da captura crua. Recusa (lança) sem `serverInfo.name`
 * e `serverInfo.version` — os dois obrigatórios da forma da Smithery: um card
 * sem eles é pior que 404, porque o scanner o aceita e grava o vazio.
 */
export function montarCard(bruta: SuperficieBruta, opcoes: OpcoesCard = {}): Record<string, unknown> {
  const init = bruta.initialize;
  const serverInfo = init?.["serverInfo"] as Record<string, unknown> | undefined;
  if (typeof serverInfo?.["name"] !== "string" || typeof serverInfo["version"] !== "string") {
    throw new Error("server card: initialize sem serverInfo.name/serverInfo.version");
  }
  const card: Record<string, unknown> = {
    serverInfo,
    protocolVersion: init!["protocolVersion"],
    capabilities: init!["capabilities"],
    instructions: init!["instructions"],
  };
  if (opcoes.authentication) card["authentication"] = opcoes.authentication;
  for (const chave of LISTAS) if (bruta[chave]) card[chave] = bruta[chave];
  return card;
}

/** A volta: o card como captura crua — para conferir contra a trava (`normalizarSuperficie`). */
export function superficieDoCard(card: Record<string, unknown>): SuperficieBruta {
  const { serverInfo, protocolVersion, capabilities, instructions } = card;
  const lista = (chave: (typeof LISTAS)[number]) => card[chave] as unknown[] | undefined;
  return {
    initialize: { serverInfo, protocolVersion, capabilities, instructions },
    tools: lista("tools"),
    resources: lista("resources"),
    resourceTemplates: lista("resourceTemplates"),
    prompts: lista("prompts"),
  };
}

/** A seção `semToken` de um `surface.lock.json` (o JSON importado ou uma `Trava`). */
interface TravaComSemToken {
  semToken?: { conteudo?: unknown } | undefined;
}

/**
 * `authentication` derivado da trava: exige credencial se, na configuração de
 * PRODUÇÃO (`apiKeyAusente`) e na rota pública (`POST /mcp`), `tools/list` NÃO
 * responde sem token. Lança se a medição não está lá — card que afirma sem
 * medida é o que este módulo existe para evitar.
 */
export function autenticacaoDaTrava(trava: TravaComSemToken, config = "apiKeyAusente", rota = "POST /mcp"): Autenticacao {
  const conteudo = trava.semToken?.conteudo as Record<string, Record<string, Record<string, unknown>> | undefined> | undefined;
  const medido = conteudo?.[config]?.[rota]?.["tools/list"];
  if (typeof medido !== "boolean") {
    throw new Error(`server card: trava sem semToken.conteudo["${config}"]["${rota}"]["tools/list"]`);
  }
  return { required: !medido };
}

/** Card em memória: o servidor montado pela mesma fábrica dos transportes. */
export async function capturarCard(server: ServidorConectavel, opcoes: OpcoesCard = {}): Promise<Record<string, unknown>> {
  return montarCard(await capturarBrutaEmMemoria(server, "server-card"), opcoes);
}

/**
 * Card por HTTP stateless (JSON ou SSE) — para o servidor cuja superfície mora
 * atrás de outro `fetch` (o container do sih). Um `initialize` que não responde
 * faz `montarCard` lançar; o servidor decide o fallback.
 */
export async function capturarCardPorFetch(
  buscar: (req: Request) => Promise<Response>,
  url: string,
  opcoes: OpcoesCard = {},
): Promise<Record<string, unknown>> {
  let id = 1;
  const bruta = await capturarBrutaPor(async (method, params) => {
    const pedido: Pedido = params ? { method, params } : { method };
    const res = await buscar(
      new Request(url, { method: "POST", headers: { ...CABECALHOS_MCP }, body: corpoDoPedido(pedido, id++) }),
    );
    const corpo = lerCorpoJsonRpc(await res.text());
    return corpo?.error ? undefined : corpo?.result;
  }, "server-card");
  return montarCard(bruta, opcoes);
}

/**
 * Cache por isolate: a primeira montagem que DÁ CERTO fica; falha não é
 * cacheada (lança de novo na próxima requisição). Devolve o JSON pronto.
 */
export function cardEmCache(montar: () => Promise<Record<string, unknown>>): () => Promise<string> {
  let pronto: string | undefined;
  return async () => (pronto ??= JSON.stringify(await montar()));
}
