/**
 * Captura em memória, normalizada: a captura crua de `captura.ts` passada pela
 * mesma normalização dos caminhos HTTP e stdio.
 */

import { capturarBrutaEmMemoria, type ServidorConectavel } from "./captura.js";
import { normalizarSuperficie } from "./superficie.js";

export type { ServidorConectavel } from "./captura.js";

export async function capturarSuperficie(server: ServidorConectavel): Promise<Record<string, unknown>> {
  return normalizarSuperficie(await capturarBrutaEmMemoria(server, "surface-lock"));
}
