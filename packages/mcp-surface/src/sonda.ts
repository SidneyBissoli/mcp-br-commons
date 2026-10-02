/**
 * Quem responde SEM CREDENCIAL — o comportamento que nenhuma listagem mostra.
 * O caso que o leitor do dev.to achou (comentário 3g5m4) foi exatamente
 * `tools/list` passando a responder sem token sem que nada na superfície
 * declarada mudasse. Só a borda HTTP sabe medir isso, então a medição recebe
 * do servidor um `responder` que monta a requisição do jeito da borda dele.
 */

import { paramsDoInitialize } from "./superficie.js";

export interface Pedido {
  method: string;
  params?: Record<string, unknown>;
}

/** Uma chamada de tool que NÃO toca a rede da origem (catálogo local, dado empacotado). */
export interface ChamadaLocal {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Os métodos que um cliente sem credencial pode tentar. `tools/call` entra só
 * com uma tool que não vai à rede — a sonda mede a borda, não o humor da fonte.
 */
export function sondaSemToken(chamada?: ChamadaLocal): Pedido[] {
  const sonda: Pedido[] = [
    { method: "initialize", params: paramsDoInitialize("surface-lock") },
    { method: "ping" },
    { method: "tools/list" },
    { method: "resources/list" },
    { method: "resources/templates/list" },
    { method: "prompts/list" },
  ];
  if (chamada) sonda.push({ method: "tools/call", params: { name: chamada.name, arguments: chamada.arguments } });
  return sonda;
}

/** Lê o corpo de uma resposta MCP por HTTP (JSON puro ou SSE com uma mensagem). */
export function lerCorpoJsonRpc(texto: string): { result?: Record<string, unknown>; error?: unknown } | undefined {
  const t = texto.trim();
  try {
    if (t.startsWith("{")) return JSON.parse(t);
    const dados = t
      .split("\n")
      .filter(l => l.startsWith("data:"))
      .pop();
    return dados ? JSON.parse(dados.slice(5).trim()) : undefined;
  } catch {
    return undefined;
  }
}

/** "Responde" = HTTP 200 com `result` no corpo JSON-RPC. */
export async function respondeu(res: Response): Promise<boolean> {
  if (res.status !== 200) return false;
  return lerCorpoJsonRpc(await res.text())?.result !== undefined;
}

/** O corpo JSON-RPC de um pedido da sonda, pronto para `fetch`. */
export function corpoDoPedido(pedido: Pedido, id = 1): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method: pedido.method, params: pedido.params });
}

export const CABECALHOS_MCP: Readonly<Record<string, string>> = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

/**
 * Mede a sonda em cada configuração × rota. `responder(config, rota, pedido)`
 * devolve a `Response` da borda — o servidor decide como montar a requisição e
 * o `env` de cada configuração. Saída: `{ config: { rota: { método: bool } } }`,
 * a forma da seção `semToken` do `surface.lock.json`.
 */
export async function medirSemToken(
  configuracoes: readonly string[],
  rotas: readonly string[],
  sonda: readonly Pedido[],
  responder: (config: string, rota: string, pedido: Pedido) => Promise<Response>,
): Promise<Record<string, Record<string, Record<string, boolean>>>> {
  const saida: Record<string, Record<string, Record<string, boolean>>> = {};
  for (const config of configuracoes) {
    const porRota: Record<string, Record<string, boolean>> = {};
    for (const rota of rotas) {
      const porMetodo: Record<string, boolean> = {};
      for (const pedido of sonda) porMetodo[pedido.method] = await respondeu(await responder(config, rota, pedido));
      porRota[rota] = porMetodo;
    }
    saida[config] = porRota;
  }
  return saida;
}

/**
 * A requisição com o `Host` que o runtime real (workerd) teria posto. O
 * `Request` do Node (undici) trata `host` como cabeçalho proibido e o descarta
 * em silêncio; sem isto, um handler que valida `Host` responde 403/"Missing
 * Host header" a tudo e a sonda mede a ausência do cabeçalho, não a
 * autenticação. Nada além do cabeçalho é simulado.
 */
export function comHost(request: Request, host: string): Request {
  const headers = new Headers(request.headers);
  headers.set("host", host);
  return new Proxy(request, {
    get(alvo, prop) {
      if (prop === "headers") return headers;
      const valor = Reflect.get(alvo, prop, alvo);
      return typeof valor === "function" ? valor.bind(alvo) : valor;
    },
  });
}

let ip = 0;
/**
 * Um IP de documentação (RFC 5737) por chamada: a sonda faz dezenas de
 * requisições e um rate limit por IP (burst 20 nos servidores do portfólio)
 * responderia 429 no meio — mediria o limitador, não a autenticação.
 */
export function ipDaSonda(): string {
  ip = (ip % 250) + 1;
  return `192.0.2.${ip}`;
}
