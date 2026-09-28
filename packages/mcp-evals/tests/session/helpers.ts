/**
 * Dublês dos testes offline do runner de sessão: modelo (fetch) e servidor MCP
 * (cliente em memória). Nenhum teste toca rede ou processo.
 */

import type { AnthropicTool } from "../../src/catalog.js";
import type { ContentBlock, MessagesResponse } from "../../src/session/api.js";
import type { McpToolClient, ToolCallOutcome } from "../../src/session/mcp-client.js";
import type { TaskSet } from "../../src/session/types.js";

export const TOOLS: AnthropicTool[] = [
  {
    name: "srv_serie",
    description: "Lê a série pelo código.",
    input_schema: { type: "object", properties: { codigo: { type: "number" } }, required: ["codigo"], additionalProperties: false },
  },
  {
    name: "srv_buscar",
    description: "Busca séries por termo.",
    input_schema: { type: "object", properties: { termo: { type: "string" } }, required: ["termo"], additionalProperties: false },
  },
];

export const TASK_SET: TaskSet = {
  server: "dublê",
  systemPrompt: "Você responde com dados do servidor dublê. Use as ferramentas e conclua com um número.",
  faults: { "0": { seed: 1, rules: [] }, "20": { seed: 7, rules: [{ match: "api\\.", rate: 0.2, kind: "http_5xx" }] } },
  tasks: [
    {
      id: "t1",
      prompt: "Qual é o último valor da série 433? Responda só o número.",
      expectedTools: ["srv_serie"],
      script: [{ tool: "srv_serie", args: { codigo: 433 } }],
      answer: { kind: "number", value: 0.56 },
      note: "uma chamada",
    },
  ],
};

/** Payload como o `structuredResult` dos servidores emite: JSON pretty com provenance. */
export function payloadWith(retrieval: unknown, valor = 0.56, pretty = true): string {
  const obj = {
    codigo: 433,
    valores: [{ data: "2026-08-01", valor }],
    provenance: { source: "BCB", source_url: "https://api.bcb.gov.br/x", retrieval, citation: "BCB (2026)" },
  };
  return pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj);
}

export const UNSTABLE = { requests: 1, attempts: 3, anomalies: [{ kind: "http_5xx", count: 2 }], unstable: true };
export const STABLE = { requests: 1, attempts: 1, anomalies: [], unstable: false };

export function toolUse(id: string, name: string, input: Record<string, unknown>): ContentBlock {
  return { type: "tool_use", id, name, input };
}

export function response(content: ContentBlock[], stop_reason: string, usage = { input_tokens: 1000, output_tokens: 50 }): MessagesResponse {
  return { content, stop_reason, usage };
}

export interface FakeModel {
  fetchImpl: typeof fetch;
  /** Corpos enviados, na ordem. */
  bodies: Record<string, unknown>[];
}

/** Modelo dublado: devolve as respostas na ordem; grava cada corpo enviado. */
export function fakeModel(responses: (MessagesResponse | { status: number; body: string })[]): FakeModel {
  const bodies: Record<string, unknown>[] = [];
  let i = 0;
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const next = responses[i++];
    if (!next) throw new Error(`modelo dublado sem resposta para a requisição #${i}`);
    if ("status" in next && typeof next.status === "number" && "body" in next) {
      return new Response(next.body, { status: next.status });
    }
    return new Response(JSON.stringify(next), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, bodies };
}

/** Servidor MCP dublado: resultados por tool (função ou fixo); grava as chamadas. */
export function fakeMcp(
  handlers: Record<string, ToolCallOutcome | ((args: Record<string, unknown>) => ToolCallOutcome)>,
): McpToolClient & { calls: { name: string; args: Record<string, unknown> }[]; closed: boolean } {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client = {
    calls,
    closed: false,
    async listTools() {
      return TOOLS;
    },
    async callTool(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      const h = handlers[name];
      if (!h) return { text: `tool desconhecida ${name}`, isError: true, protocolError: { code: -32602, message: "unknown tool" } };
      return typeof h === "function" ? h(args) : h;
    },
    async close() {
      client.closed = true;
    },
  };
  return client;
}

export const noopDeps = {
  sleepImpl: async () => {},
  logError: () => {},
};
