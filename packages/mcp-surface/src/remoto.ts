/**
 * Captura por fora: um endpoint HTTP no ar, ou o pacote de uma versão
 * publicada rodando em stdio. Os dois passam pela mesma normalização da
 * captura em memória — é o que permite comparar o ar com a trava e uma versão
 * antiga com a de hoje.
 */

import { spawn } from "node:child_process";

import {
  CABECALHOS_MCP,
  METODO_INEXISTENTE,
  corpoDoPedido,
  lerCorpoJsonRpc,
  vereditoDoMetodoInexistente,
  type Pedido,
} from "./sonda.js";
import { capturarPor } from "./superficie.js";

/** Um pedido JSON-RPC a um endpoint MCP, sem credencial. */
export async function pedirHttp(url: string, pedido: Pedido): Promise<{ status: number; result?: Record<string, unknown> }> {
  const res = await fetch(url, { method: "POST", headers: { ...CABECALHOS_MCP }, body: corpoDoPedido(pedido) });
  const corpo = lerCorpoJsonRpc(await res.text());
  return corpo?.result ? { status: res.status, result: corpo.result } : { status: res.status };
}

/**
 * O endpoint sabe dizer não? Pede o método inexistente; `null` = sim (pode
 * comparar); senão, o motivo para não comparar nada.
 */
export async function endpointSabeDizerNao(url: string): Promise<string | null> {
  return vereditoDoMetodoInexistente(await pedirHttp(url, { method: METODO_INEXISTENTE }));
}

/** A superfície declarada servida por um endpoint HTTP (stateless, sem credencial). */
export function capturarHttp(url: string): Promise<Record<string, unknown>> {
  return capturarPor(async (method, params) => {
    const pedido: Pedido = params ? { method, params } : { method };
    return (await pedirHttp(url, pedido)).result;
  }, "mcp-surface");
}

/** A superfície de um servidor stdio (`node <entrada>`), como um cliente local a veria. */
export async function capturarStdio(entrada: string, env: NodeJS.ProcessEnv = process.env): Promise<Record<string, unknown>> {
  const filho = spawn(process.execPath, [entrada], { stdio: ["pipe", "pipe", "ignore"], env });
  let buffer = "";
  const pendentes = new Map<number, (msg: { result?: Record<string, unknown>; error?: unknown }) => void>();
  filho.stdout.on("data", (pedaco: Buffer) => {
    buffer += pedaco.toString();
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const linha = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      let msg: { id?: unknown; result?: Record<string, unknown>; error?: unknown };
      try {
        msg = JSON.parse(linha);
      } catch {
        continue; // log solto no stdout
      }
      if (typeof msg.id === "number") {
        pendentes.get(msg.id)?.(msg);
        pendentes.delete(msg.id);
      }
    }
  });
  let id = 1;
  const escrever = (msg: unknown) => filho.stdin.write(`${JSON.stringify(msg)}\n`);
  const pedir = (method: string, params?: Record<string, unknown>) =>
    new Promise<Record<string, unknown> | undefined>(resolve => {
      const meu = id++;
      pendentes.set(meu, msg => resolve(msg.error ? undefined : msg.result));
      escrever({ jsonrpc: "2.0", id: meu, method, params });
      setTimeout(() => {
        if (pendentes.delete(meu)) resolve(undefined);
      }, 20_000);
    });
  try {
    return await capturarPor(pedir, "mcp-surface-replay", () =>
      escrever({ jsonrpc: "2.0", method: "notifications/initialized" }),
    );
  } finally {
    filho.kill();
  }
}
