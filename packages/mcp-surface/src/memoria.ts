/**
 * Captura em memória: o servidor montado pela mesma fábrica que os transportes
 * usam, interrogado por JSON-RPC cru sobre o `InMemoryTransport` do SDK v2.
 *
 * JSON-RPC cru, e não o `Client` do SDK: o `Client` compila os `outputSchema`
 * com Ajv (`new Function`), que o runtime da Cloudflare proíbe — o mesmo
 * caminho serve teste em Node e código de Worker.
 */

import { InMemoryTransport } from "@modelcontextprotocol/server";

import { capturarPor } from "./superficie.js";

/** O que a captura precisa de um `McpServer`: só conectar a um transporte. */
export interface ServidorConectavel {
  connect(transport: InMemoryTransport): Promise<void>;
}

export async function capturarSuperficie(server: ServidorConectavel): Promise<Record<string, unknown>> {
  const [cliente, lado] = InMemoryTransport.createLinkedPair();
  await server.connect(lado);

  const pendentes = new Map<number, (msg: { result?: Record<string, unknown>; error?: unknown }) => void>();
  cliente.onmessage = (msg: unknown) => {
    const m = msg as { id?: unknown; result?: Record<string, unknown>; error?: unknown };
    if (typeof m.id === "number") {
      pendentes.get(m.id)?.(m);
      pendentes.delete(m.id);
    }
  };
  await cliente.start();

  let proximo = 1;
  const pedir = (method: string, params?: Record<string, unknown>) =>
    new Promise<Record<string, unknown> | undefined>(resolve => {
      const id = proximo++;
      pendentes.set(id, msg => resolve(msg.error ? undefined : msg.result));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void cliente.send({ jsonrpc: "2.0", id, method, params } as any);
    });

  try {
    return await capturarPor(pedir, "surface-lock", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void cliente.send({ jsonrpc: "2.0", method: "notifications/initialized" } as any);
    });
  } finally {
    await cliente.close();
  }
}
