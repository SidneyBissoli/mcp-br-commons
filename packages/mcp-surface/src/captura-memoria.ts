/**
 * Captura crua em memória: o servidor montado pela mesma fábrica que os
 * transportes usam, interrogado por JSON-RPC cru sobre o `InMemoryTransport`.
 *
 * Arquivo separado de `captura.ts` porque é o ÚNICO ponto da captura que
 * importa o SDK em valor. Quem só captura por HTTP (`/card/http`, a borda do
 * sih na frente do container) não importa daqui, e o bundle não carrega o SDK.
 * Medido em 04/10/2026: com o import no caminho, a borda do sih foi de 31 para
 * 156 KiB gzip; `sideEffects: false` não resolve, porque o SDK não o declara.
 *
 * JSON-RPC cru, e não o `Client` do SDK: o `Client` compila os `outputSchema`
 * com Ajv (`new Function`), que o runtime da Cloudflare proíbe — o mesmo
 * caminho serve teste em Node e código de Worker.
 */

import { InMemoryTransport } from "@modelcontextprotocol/server";

import { capturarBrutaPor, type Pedir, type ServidorConectavel, type SuperficieBruta } from "./captura.js";

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
