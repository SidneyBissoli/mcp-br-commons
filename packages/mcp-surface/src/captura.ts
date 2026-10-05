/**
 * A captura CRUA da superfície: `initialize` + as quatro listas, como saem do
 * JSON-RPC, sem normalizar nem tirar hash.
 *
 * Arquivo separado de `superficie.ts` de propósito: aqui não entra
 * `node:crypto` nem `node:child_process`, e nem o SDK em valor (só o tipo do
 * transporte), então o subpath `/card/http` importa daqui sem levar o SDK ao
 * bundle. A captura em memória, que precisa do SDK, mora em
 * `captura-memoria.ts`. A trava e o card partem desta mesma captura — é o que
 * permite provar que os dois não divergem.
 */

import type { InMemoryTransport } from "@modelcontextprotocol/server";

/** O protocolo pedido no `initialize` de toda captura — fixo, para o eco não variar. */
export const PROTOCOLO_DA_CAPTURA = "2025-06-18";

/** Resultados crus, como saem do JSON-RPC. Lista ausente = método não servido. */
export interface SuperficieBruta {
  initialize: Record<string, unknown> | undefined;
  tools: unknown[] | undefined;
  resources: unknown[] | undefined;
  resourceTemplates: unknown[] | undefined;
  prompts: unknown[] | undefined;
}

/** Faz uma requisição JSON-RPC e devolve o `result` (ou `undefined` em erro). */
export type Pedir = (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown> | undefined>;

/** O que a captura precisa de um `McpServer`: só conectar a um transporte. */
export interface ServidorConectavel {
  connect(transport: InMemoryTransport): Promise<void>;
}

/** Os parâmetros do `initialize` de toda captura. */
export function paramsDoInitialize(cliente: string): Record<string, unknown> {
  return {
    protocolVersion: PROTOCOLO_DA_CAPTURA,
    capabilities: {},
    clientInfo: { name: cliente, version: "1.0.0" },
  };
}

/**
 * Captura crua por qualquer transporte. `notificar`, quando o transporte tem
 * sessão, manda o `notifications/initialized`.
 */
export async function capturarBrutaPor(pedir: Pedir, cliente: string, notificar?: () => void): Promise<SuperficieBruta> {
  const initialize = await pedir("initialize", paramsDoInitialize(cliente));
  notificar?.();
  const lista = async (method: string, chave: string) => (await pedir(method, {}))?.[chave] as unknown[] | undefined;
  return {
    initialize,
    tools: await lista("tools/list", "tools"),
    resources: await lista("resources/list", "resources"),
    resourceTemplates: await lista("resources/templates/list", "resourceTemplates"),
    prompts: await lista("prompts/list", "prompts"),
  };
}
