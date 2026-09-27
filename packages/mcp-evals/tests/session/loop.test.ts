import { describe, expect, it } from "vitest";
import { Budget } from "../../src/session/budget.js";
import { runSession, systemPromptFor, type SessionConfig } from "../../src/session/loop.js";
import { DEFAULT_RETRIEVAL_HINT } from "../../src/session/types.js";
import { STABLE, TASK_SET, TOOLS, UNSTABLE, fakeMcp, fakeModel, noopDeps, payloadWith, response, toolUse } from "./helpers.js";

function config(overrides: Partial<SessionConfig>): SessionConfig {
  return {
    task: TASK_SET.tasks[0]!,
    taskSet: TASK_SET,
    arm: "A",
    fault: "0",
    run: 1,
    model: "claude-sonnet-5",
    apiKey: "sk-test",
    tools: TOOLS,
    mcp: fakeMcp({ srv_serie: { text: payloadWith(STABLE), isError: false } }),
    budget: new Budget(5),
    serverSha: "abc1234",
    deps: { fetchImpl: fakeModel([]).fetchImpl, ...noopDeps },
    ...overrides,
  };
}

describe("runSession — o loop", () => {
  it("dois tool_use paralelos → UM user com dois tool_result, um por id; is_error só no que errou", async () => {
    const model = fakeModel([
      response([toolUse("tu1", "srv_serie", { codigo: 433 }), toolUse("tu2", "srv_buscar", { termo: "ipca" })], "tool_use"),
      response([{ type: "text", text: "O último valor é 0,56." }], "end_turn"),
    ]);
    const mcp = fakeMcp({
      srv_serie: { text: payloadWith(STABLE), isError: false },
      srv_buscar: { text: "Nenhuma série encontrada para o termo.", isError: true },
    });
    const rec = await runSession(config({ deps: { fetchImpl: model.fetchImpl, ...noopDeps }, mcp }));

    expect(rec.endedBy).toBe("end_turn");
    expect(rec.calls.map((c) => c.tool)).toEqual(["srv_serie", "srv_buscar"]);
    // A 2ª requisição carrega: user(prompt), assistant(content inteiro), user(2 tool_results).
    const second = model.bodies[1] as { messages: { role: string; content: unknown }[] };
    expect(second.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    const results = second.messages[2]!.content as { type: string; tool_use_id: string; is_error?: boolean }[];
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.tool_use_id)).toEqual(["tu1", "tu2"]);
    expect(results[0]!.is_error).toBeUndefined();
    expect(results[1]!.is_error).toBe(true);
    expect(rec.finalAnswer).toBe("O último valor é 0,56.");
    expect(rec.metrics.answerCorrect).toBe(1);
    expect(rec.usage.requests).toBe(2);
  });

  it("braço B: o tool_result vai SEM retrieval; o record ainda sabe que foi instável", async () => {
    const model = fakeModel([
      response([toolUse("tu1", "srv_serie", { codigo: 433 })], "tool_use"),
      response([{ type: "text", text: "0,56" }], "end_turn"),
    ]);
    const rec = await runSession(
      config({
        arm: "B",
        deps: { fetchImpl: model.fetchImpl, ...noopDeps },
        mcp: fakeMcp({ srv_serie: { text: payloadWith(UNSTABLE), isError: false } }),
      }),
    );
    const second = model.bodies[1] as { messages: { content: unknown }[]; system: { text: string }[] };
    const shown = (second.messages[2]!.content as { content: string }[])[0]!.content;
    expect(shown).not.toContain("retrieval");
    expect(shown).toContain("provenance");
    expect(rec.calls[0]!.retrieval?.[0]?.unstable).toBe(true);
    expect(rec.metrics.unstableResults).toBe(1);
    // Braço B não recebe a frase do retrieval.
    expect(second.system[0]!.text).not.toContain("unstable");
  });

  it("braço A recebe a system prompt comum + a frase do retrieval; ambas registradas no NDJSON", async () => {
    expect(systemPromptFor(TASK_SET, "A")).toBe(`${TASK_SET.systemPrompt}\n\n${DEFAULT_RETRIEVAL_HINT}`);
    expect(systemPromptFor(TASK_SET, "B")).toBe(TASK_SET.systemPrompt);
    const model = fakeModel([response([{ type: "text", text: "sem tools" }], "end_turn")]);
    const rec = await runSession(config({ deps: { fetchImpl: model.fetchImpl, ...noopDeps } }));
    expect(rec.systemPrompt).toContain("unstable");
    const body = model.bodies[0] as { tools: { cache_control?: unknown }[]; system: { cache_control?: unknown }[]; tool_choice: unknown };
    expect(body.tool_choice).toEqual({ type: "auto" });
    expect(body.system[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(body.tools.at(-1)!.cache_control).toEqual({ type: "ephemeral" });
    expect(body.tools[0]!.cache_control).toBeUndefined();
  });

  it("max_tokens encerra e marca; refusal é dropout de infra (fora da agregação)", async () => {
    const m1 = fakeModel([response([{ type: "text", text: "cortado" }], "max_tokens")]);
    const r1 = await runSession(config({ deps: { fetchImpl: m1.fetchImpl, ...noopDeps } }));
    expect(r1.endedBy).toBe("max_tokens");
    expect(r1.infraError).toBeUndefined();
    expect(r1.metrics.answerCorrect).toBeNull();

    const m2 = fakeModel([{ content: [], stop_reason: "refusal", stop_details: { category: "cyber", explanation: "x" }, usage: {} }]);
    const r2 = await runSession(config({ deps: { fetchImpl: m2.fetchImpl, ...noopDeps } }));
    expect(r2.endedBy).toBe("refusal");
    expect(r2.infraError).toContain("cyber");
  });

  it("teto de passos para o loop e conta como max_steps", async () => {
    const loopForever = Array.from({ length: 10 }, (_, i) => response([toolUse(`tu${i}`, "srv_serie", { codigo: 433 })], "tool_use"));
    const model = fakeModel(loopForever);
    const rec = await runSession(config({ task: { ...TASK_SET.tasks[0]!, maxSteps: 3 }, deps: { fetchImpl: model.fetchImpl, ...noopDeps } }));
    expect(rec.endedBy).toBe("max_steps");
    expect(rec.metrics.steps).toBe(3);
    expect(rec.calls).toHaveLength(3);
  });

  it("teto de gasto aborta a sessão (endedBy budget) e não manda mais requisições", async () => {
    const model = fakeModel([
      response([toolUse("tu1", "srv_serie", { codigo: 433 })], "tool_use", { input_tokens: 400_000, output_tokens: 10 }),
      response([{ type: "text", text: "nunca chega" }], "end_turn"),
    ]);
    // sonnet-5: 400k × 2 US$/M = 0,80 > teto 0,50
    const rec = await runSession(config({ budget: new Budget(0.5), deps: { fetchImpl: model.fetchImpl, ...noopDeps } }));
    expect(rec.endedBy).toBe("budget");
    expect(rec.infraError).toContain("teto de gasto");
    expect(model.bodies).toHaveLength(1);
  });

  it("dropout de infra transitório esgotado vira infraError; auth fatal sobe com o parcial", async () => {
    const transient = fakeModel([{ status: 529, body: "overloaded" }, { status: 529, body: "overloaded" }]);
    const r1 = await runSession(config({ deps: { fetchImpl: transient.fetchImpl, maxRetries: 1, ...noopDeps } }));
    expect(r1.endedBy).toBe("infra");
    expect(r1.infraError).toContain("overloaded");

    const auth = fakeModel([{ status: 401, body: "invalid x-api-key" }]);
    await expect(runSession(config({ deps: { fetchImpl: auth.fetchImpl, ...noopDeps } }))).rejects.toMatchObject({ kind: "auth" });
  });

  it("erro de protocolo -32602 do servidor vira tool_result com is_error e classe schema", async () => {
    const model = fakeModel([
      response([toolUse("tu1", "srv_inexistente", {})], "tool_use"),
      response([{ type: "text", text: "desisto" }], "end_turn"),
    ]);
    const rec = await runSession(config({ deps: { fetchImpl: model.fetchImpl, ...noopDeps } }));
    expect(rec.calls[0]!.errorClass).toBe("schema");
    expect(rec.metrics.schemaRefusals).toBe(1);
    expect(rec.metrics.badCalls).toBe(1);
  });
});
