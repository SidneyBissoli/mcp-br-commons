import { describe, expect, it } from "vitest";
import { estimateSessionCost, estimateTokens, renderDryReport, runDry } from "../../src/session/dry.js";
import { RUBRIC, buildJudgeItem, judgeSession, parseJudge } from "../../src/session/judge.js";
import { Budget } from "../../src/session/budget.js";
import { renderReport, stat, summarizeGroups } from "../../src/session/report.js";
import type { SessionRecord } from "../../src/session/types.js";
import { validateTaskSet } from "../../src/session/validate.js";
import { STABLE, TASK_SET, TOOLS, UNSTABLE, fakeMcp, fakeModel, noopDeps, payloadWith } from "./helpers.js";

describe("validateTaskSet", () => {
  it("conjunto do dublê é válido", () => {
    expect(validateTaskSet(TASK_SET, TOOLS)).toEqual([]);
  });
  it("acusa tool inexistente, argumento obrigatório ausente, argumento desconhecido e falta do nível 0", () => {
    const bad = {
      ...TASK_SET,
      faults: { "20": TASK_SET.faults["20"]! },
      tasks: [
        { ...TASK_SET.tasks[0]!, id: "x", expectedTools: ["srv_nada"], script: [{ tool: "srv_serie", args: { quantidade: 1 } }, { tool: "srv_buscar", args: { termo: "a", extra: 1 } }] },
      ],
    };
    const problems = validateTaskSet(bad, TOOLS);
    expect(problems.some((p) => p.includes("srv_nada"))).toBe(true);
    expect(problems.some((p) => p.includes('obrigatório "codigo"'))).toBe(true);
    expect(problems.some((p) => p.includes('desconhecido "extra"'))).toBe(true);
    expect(problems.some((p) => p.includes('nível "0"'))).toBe(true);
  });
});

describe("--dry", () => {
  it("mede A e B por chamada, marca instável e estima custo por modelo", async () => {
    const mcp = fakeMcp({ srv_serie: { text: payloadWith(UNSTABLE), isError: false } });
    const report = await runDry(TASK_SET, TASK_SET.tasks, TOOLS, mcp, { models: ["claude-opus-5", "claude-sonnet-5"] });
    const t = report.tasks[0]!;
    expect(t.calls[0]!.unstable).toBe(true);
    expect(t.calls[0]!.charsB).toBeLessThan(t.calls[0]!.charsA);
    expect(t.totalTokensB).toBeLessThan(t.totalTokensA);
    expect(report.tokenSource).toBe("estimated");
    expect(report.costPerSession["claude-opus-5"]!.A).toBeGreaterThan(report.costPerSession["claude-sonnet-5"]!.A);
    const md = renderDryReport(report).join("\n");
    expect(md).toContain("ESTIMADOS");
    expect(md).toContain("| t1 |");
  });
  it("contador injetado muda a fonte para count_tokens", async () => {
    const mcp = fakeMcp({ srv_serie: { text: payloadWith(STABLE), isError: false } });
    const report = await runDry(TASK_SET, TASK_SET.tasks, TOOLS, mcp, { models: ["claude-opus-5"], counter: async (t) => t.length });
    expect(report.tokenSource).toBe("count_tokens");
    expect(report.tasks[0]!.calls[0]!.tokensA).toBe(report.tasks[0]!.calls[0]!.charsA);
  });
  it("estimateSessionCost cresce com os passos e é maior no opus", () => {
    const one = estimateSessionCost("claude-sonnet-5", 10_000, [2_000]);
    const twenty = estimateSessionCost("claude-sonnet-5", 10_000, Array(20).fill(2_000));
    expect(twenty).toBeGreaterThan(one * 10);
    expect(estimateSessionCost("claude-opus-5", 10_000, [2_000])).toBeGreaterThan(one);
    expect(estimateTokens("a".repeat(35))).toBe(10);
  });
});

describe("juiz (d)", () => {
  const base: SessionRecord = {
    taskId: "t1", arm: "A", fault: "20", run: 1, model: "claude-sonnet-5", server: "s", serverSha: null,
    startedAt: "", finishedAt: "", faultSeed: 7, systemPrompt: "", finalAnswer: "O IPCA foi 0,56%.",
    stopReason: "end_turn", endedBy: "end_turn",
    calls: [{ step: 1, tool: "srv_serie", args: { codigo: 433 }, canonical: "", isError: false, errorClass: null, retrieval: [UNSTABLE], resultChars: 1, resultSummary: "valor 0,56", durationMs: 1 }],
    metrics: { repeatAfterDefinitiveError: 0, schemaRefusals: 0, insistenceGroups: 0, badCalls: 0, unstableResults: 1, calls: 1, errors: 0, steps: 2, answerCorrect: 1 },
    usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, requests: 2 }, costUSD: 0,
  };
  it("parseJudge exige 0/1; buildJudgeItem leva a resposta e os resumos instáveis", () => {
    expect(parseJudge('{"cited_as_certain": 1, "verdict": "citou"}')).toEqual({ cited: 1, verdict: "citou" });
    expect(parseJudge("sem json")).toBeNull();
    expect(parseJudge('{"cited_as_certain": 2}')).toBeNull();
    expect(buildJudgeItem({ finalAnswer: "x", unstableResults: ["a"] })).toContain("resultados_instaveis");
    expect(RUBRIC).toContain("SOMENTE com JSON");
  });
  it("sem instável não chama o modelo; com instável cobra no teto e preenche o veredito", async () => {
    const budget = new Budget(1);
    const none = await judgeSession({ ...base, calls: [{ ...base.calls[0]!, retrieval: [STABLE] }] }, { fetchImpl: fakeModel([]).fetchImpl, ...noopDeps, apiKey: "k", budget });
    expect(none.unstableCitedAsCertain).toBeNull();
    const model = fakeModel([{ content: [{ type: "text", text: '{"cited_as_certain": 1, "verdict": "sem ressalva"}' }], stop_reason: "end_turn", usage: { input_tokens: 500, output_tokens: 20 } }]);
    const judged = await judgeSession(base, { fetchImpl: model.fetchImpl, ...noopDeps, apiKey: "k", budget });
    expect(judged.unstableCitedAsCertain).toBe(1);
    expect(judged.judgeVerdict).toBe("sem ressalva");
    expect(budget.spentUSD).toBeGreaterThan(0);
    expect((model.bodies[0] as { model: string }).model).toBe("claude-haiku-4-5");
  });
});

describe("relatório", () => {
  it("stat e tabela braço × falha; dropout fica fora da agregação", () => {
    expect(stat([1, 2, 3])).toEqual({ n: 3, mean: 2, sd: 1 });
    const mk = (arm: "A" | "B", bad: number, extra: Partial<SessionRecord> = {}): SessionRecord => ({
      taskId: "t1", arm, fault: "0", run: 1, model: "m", server: "s", serverSha: "sha", startedAt: "", finishedAt: "", faultSeed: null, systemPrompt: "",
      calls: [], finalAnswer: "", stopReason: "end_turn", endedBy: "end_turn",
      metrics: { repeatAfterDefinitiveError: bad, schemaRefusals: 0, insistenceGroups: 0, badCalls: bad, unstableResults: 0, calls: 3, errors: 0, steps: 4, answerCorrect: 1 },
      usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, requests: 4 }, costUSD: 0.1, ...extra,
    });
    const records = [mk("A", 0), mk("A", 2, { run: 2 }), mk("B", 3), mk("B", 9, { run: 2, endedBy: "infra", infraError: "caiu" })];
    const groups = summarizeGroups(records);
    expect(groups.map((g) => [g.arm, g.completed, g.dropouts, g.badCalls.mean])).toEqual([["A", 2, 0, 1], ["B", 1, 1, 3]]);
    const md = renderReport(records).join("\n");
    expect(md).toContain("| m | 0 | A | 2 | 0 | 0 | **1.00 ± 1.41**");
    expect(md).toContain("Fora da agregação");
  });
});
