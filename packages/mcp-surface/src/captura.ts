/**
 * A captura CRUA da superfície: `initialize` + as quatro listas, como saem do
 * JSON-RPC, sem normalizar nem tirar hash.
 *
 * Arquivo separado de `superficie.ts` de propósito: aqui não entra
 * `node:crypto` nem `node:child_process`, então o subpath `/card` (que roda
 * dentro do Worker) importa só daqui e de `sonda.ts`. A trava e o card partem
 * desta mesma captura — é o que permite provar que os dois não divergem.
 */

import { InMemoryTransport } from "@modelcontextprotocol/server";

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

/**
 * Captura crua em memória: o servidor montado pela mesma fábrica que os
 * transportes usam, interrogado por JSON-RPC cru sobre o `InMemoryTransport`.
 *
 * JSON-RPC cru, e não o `Client` do SDK: o `Client` compila os `outputSchema`
 * com Ajv (`new Function`), que o runtime da Cloudflare proíbe — o mesmo
 * caminho serve teste em Node e código de Worker.
 */
export async function capturarBrutaEmMemoria(server: ServidorConectavel, cliente: string): Promise<SuperficieBruta> {
  const [lado, ladoServidor] = InMemoryTransport.createLinkedPair();
  await server.connect(ladoServidor);

  const pendentes = new Map<number, (msg: { result?: Record<string, unknown>; error?: unknown }) => void>();
  lado.onmessage = (msg: unknown) => {
    const m = msg as { id?: unknown; result?: Record<string, unknown>; error?: unknown };
    if (typeof m.id === "number") {
      pendentes.get(m.id)?.(m);
      pendentes.delete(m.id);
    }
  };
  await lado.start();

  let proximo = 1;
  const pedir: Pedir = (method, params) =>
    new Promise(resolve => {
      const id = proximo++;
      pendentes.set(id, msg => resolve(msg.error ? undefined : msg.result));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void lado.send({ jsonrpc: "2.0", id, method, params } as any);
    });

  try {
    return await capturarBrutaPor(pedir, cliente, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void lado.send({ jsonrpc: "2.0", method: "notifications/initialized" } as any);
    });
  } finally {
    await lado.close();
  }
}
