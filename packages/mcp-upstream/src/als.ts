/**
 * Adaptador OPCIONAL por AsyncLocalStorage, para servidores que já propagam contexto
 * assim (bcb, medical, senado): a tool abre o coletor uma vez com `withCall` e o código
 * de rede, a qualquer profundidade, o recupera com `currentCall()` — sem passar o
 * objeto por parâmetro. Entrypoint separado (`@sbissoli/mcp-upstream/als`) para o
 * núcleo não depender de `node:async_hooks`.
 *
 * Exige Node ou Worker com `nodejs_compat` — que é o caso dos sete servidores.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Upstream, UpstreamCall } from "./upstream.js";

const storage = new AsyncLocalStorage<UpstreamCall>();

/** Abre um coletor novo de `upstream` e roda `fn` dentro dele. */
export function withCall<T>(upstream: Upstream, fn: (call: UpstreamCall) => T): T {
  const call = upstream.call();
  return storage.run(call, () => fn(call));
}

/** O coletor da chamada corrente, ou `undefined` fora de `withCall`. */
export function currentCall(): UpstreamCall | undefined {
  return storage.getStore();
}

/**
 * Como `currentCall()`, mas falha alto fora de contexto: uma ida à origem sem coletor
 * seria uma ida que o `retrieval` não vê — e o contrato não admite medição parcial
 * disfarçada de medição.
 */
export function requireCall(): UpstreamCall {
  const call = storage.getStore();
  if (!call) throw new Error("mcp-upstream: nenhuma chamada aberta — envolva a tool em withCall()");
  return call;
}
