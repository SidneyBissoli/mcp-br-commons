/**
 * Testes offline do runner com fetch injetado — nenhum teste toca a rede ou a API real.
 * Cobrem: skip sem API key, rodada completa, retry transitório, curto-circuito em falha
 * fatal e EVAL_LIMIT.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { buildCatalog, type CatalogGroup } from "../src/catalog.js";
import type { EvalFixture } from "../src/fixtures.js";
import { runEval, type EvalRunnerConfig } from "../src/runner.js";

const GROUPS: CatalogGroup[] = [
  {
    area: "alfa",
    register: (s) => {
      s.tool("srv_buscar", "Busca registros por palavra-chave.", { termo: z.string() }, async () => ({}));
      s.tool("srv_obter", "Obtém o detalhe pelo código.", { codigo: z.number() }, async () => ({}));
    },
  },
];

const CATALOG = buildCatalog(GROUPS);

const FIXTURES: EvalFixture[] = [
  { id: "f1", query: "Procure registros sobre educação.", expectedTools: ["srv_buscar"], note: "busca" },
  { id: "f2", query: "Detalhe o registro de código 42.", expectedTools: ["srv_obter"], note: "detalhe" },
];

/** fetch stub que devolve um tool_use fixo por query, na ordem de chamada. */
function fetchPicking(pickByQuery: Record<string, string>): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
    const query = body.messages[0]!.content;
    const name = pickByQuery[query];
    if (!name) throw new Error(`query inesperada no stub: ${query}`);
    return new Response(JSON.stringify({ content: [{ type: "tool_use", name }] }), { status: 200 });
  }) as typeof fetch;
}

function baseConfig(overrides: Partial<EvalRunnerConfig>): EvalRunnerConfig {
  const logs: string[] = [];
  return {
    catalog: CATALOG,
    fixtures: FIXTURES,
    systemPrompt: "Escolha a tool certa.",
    env: { ANTHROPIC_API_KEY: "sk-test", EVAL_CONCURRENCY: "1" },
    log: (l) => logs.push(l),
    logError: (l) => logs.push(l),
    sleepImpl: async () => {},
    ...overrides,
  };
}

describe("runEval", () => {
  it("sem ANTHROPIC_API_KEY: imprime instruções e devolve exit 0 sem rodar", async () => {
    const logs: string[] = [];
    const result = await runEval(
      baseConfig({
        env: {},
        log: (l) => logs.push(l),
        fetchImpl: (() => {
          throw new Error("não deveria tocar a rede");
        }) as unknown as typeof fetch,
      }),
    );
    expect(result).toEqual({ exitCode: 0, skipped: true });
    expect(logs.join("\n")).toContain("ANTHROPIC_API_KEY não está definido");
  });

  it("rodada completa: pontua as escolhas e devolve exit 0 com gate do catálogo", async () => {
    const result = await runEval(
      baseConfig({
        fetchImpl: fetchPicking({
          "Procure registros sobre educação.": "srv_buscar",
          "Detalhe o registro de código 42.": "srv_buscar", // erro proposital na f2
        }),
      }),
    );
    expect(result.exitCode).toBe(0);
    expect(result.skipped).toBe(false);
    expect(result.report!.total).toBe(2);
    expect(result.report!.top1Accuracy).toBeCloseTo(0.5, 5);
    expect(result.gate!.decision).toBe("remediar");
    // toolCount default vem do catálogo (2 tools) — só aparece na mensagem de despriorizar,
    // mas o campo de opções deve ter sido propagado; validamos via rodada 100% correta:
    const perfect = await runEval(
      baseConfig({
        fetchImpl: fetchPicking({
          "Procure registros sobre educação.": "srv_buscar",
          "Detalhe o registro de código 42.": "srv_obter",
        }),
      }),
    );
    expect(perfect.gate!.decision).toBe("despriorizar-refatoracao");
    expect(perfect.gate!.message).toContain("mesmo com 2 tools");
  });

  it("retry transitório: um 500 seguido de sucesso conta como avaliada", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls === 1) return new Response("internal error", { status: 500 });
      return new Response(JSON.stringify({ content: [{ type: "tool_use", name: "srv_buscar" }] }), { status: 200 });
    }) as typeof fetch;
    const result = await runEval(
      baseConfig({ fixtures: [FIXTURES[0]!], fetchImpl, maxRetries: 2 }),
    );
    expect(calls).toBe(2);
    expect(result.exitCode).toBe(0);
    expect(result.report!.top1Accuracy).toBe(1);
  });

  it("falha fatal (auth) curto-circuita o resto e devolve exit 2", async () => {
    const fetchImpl = (async () => new Response("invalid x-api-key", { status: 401 })) as typeof fetch;
    const result = await runEval(baseConfig({ fetchImpl }));
    expect(result.exitCode).toBe(2);
    expect(result.errors).toHaveLength(2);
    expect(result.errors![0]!.kind).toBe("auth");
    // A segunda fixture nem tenta a rede: abortada pela falha fatal anterior.
    expect(result.errors![1]!.message).toContain("abortado");
    // Nenhum dropout entra no score.
    expect(result.report!.total).toBe(0);
  });

  it("EVAL_LIMIT restringe às N primeiras fixtures", async () => {
    const result = await runEval(
      baseConfig({
        env: { ANTHROPIC_API_KEY: "sk-test", EVAL_CONCURRENCY: "1", EVAL_LIMIT: "1" },
        fetchImpl: fetchPicking({ "Procure registros sobre educação.": "srv_buscar" }),
      }),
    );
    expect(result.report!.total).toBe(1);
    expect(result.report!.top1Accuracy).toBe(1);
  });
});
