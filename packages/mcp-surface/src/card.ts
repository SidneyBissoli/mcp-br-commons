/**
 * `@sbissoli/mcp-surface/card`: o card inteiro — tudo de `/card/http` mais a
 * captura em memória (`capturarCard`), que é o caminho dos servidores cujo
 * Worker monta o próprio `McpServer` e, portanto, já carrega o SDK. O desenho
 * e o porquê estão em `card-http.ts`.
 */

import type { ServidorConectavel } from "./captura.js";
import { capturarBrutaEmMemoria } from "./captura-memoria.js";
import { montarCard, type OpcoesCard } from "./card-http.js";

export * from "./card-http.js";

/** Card em memória: o servidor montado pela mesma fábrica dos transportes. */
export async function capturarCard(server: ServidorConectavel, opcoes: OpcoesCard = {}): Promise<Record<string, unknown>> {
  return montarCard(await capturarBrutaEmMemoria(server, "server-card"), opcoes);
}
