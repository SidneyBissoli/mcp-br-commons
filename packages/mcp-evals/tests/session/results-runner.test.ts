import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Budget } from "../../src/session/budget.js";
import { ResultsStore, completedKeys, dedupe, parseNdjson, resultsFileName, sessionKey } from "../../src/session/results.js";
import { runRound } from "../../src/session/runner.js";
import type { SessionRecord } from "../../src/session/types.js";
import { STABLE, TASK_SET, fakeMcp, fakeModel, noopDeps, payloadWith, response, toolUse } from "./helpers.js";

function rec(over: Partial<SessionRecord>): SessionRecord {
  return {
    taskId: "t1",
    arm: "A",
    fault: "0",
    run: 1,
    model: "m",
    server: "s",
    serverSha: null,
    startedAt: "",
    finishedAt: "",
    faultSeed: null,
    systemPrompt: "",
    calls: [],
    finalAnswer: "",
    stopReason: "end_turn",
    endedBy: "end_turn",
    metrics: { repeatAfterDefinitiveError: 0, schemaRefusals: 0, insistenceGroups: 0, badCalls: 0, unstableResults: 0, calls: 0, errors: 0, steps: 1, answerCorrect: null },
    usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, requests: 1 },
    costUSD: 0,
    ...over,
  };
}

describe("results — chave, dedupe, resume", () => {
  it("parseNdjson tolera linha rasgada; dedupe fica com a última; completedKeys reabre a que falhou depois", () => {
    const lines = [JSON.stringify(rec({ run: 1 })), JSON.stringify(rec({ run: 2, infraError: "caiu" })), '{"rasg'].join("\n");
    const parsed = parseNdjson<SessionRecord>(lines);
    expect(parsed).toHaveLength(2);
    const again = [...parsed, rec({ run: 1, infraError: "refeita e caiu" })];
    expect(dedupe(again).map((r) => r.infraError).sort()).toEqual(["caiu", "refeita e caiu"]);
    expect(completedKeys(again).size).toBe(0);
    expect(completedKeys([rec({ run: 2, infraError: "x" }), rec({ run: 2 })]).has(sessionKey(rec({ run: 2 })))).toBe(true);
  });
  it("nome do arquivo carrega data, sha, braço e nível", () => {
    expect(resultsFileName("2026-09-28", "abc1234", "B", "20")).toBe("2026-09-28_abc1234_B_20.ndjson");
    expect(resultsFileName("2026-09-28", null, "A", "0")).toBe("2026-09-28_nosha_A_0.ndjson");
  });
});

describe("runRound — orquestração com resume e teto", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function modelForSessions(n: number) {
    const rs = [];
    for (let i = 0; i < n; i++) {
      rs.push(response([toolUse(`tu${i}`, "srv_serie", { codigo: 433 })], "tool_use"));
      rs.push(response([{ type: "text", text: "0,56" }], "end_turn"));
    }
    return fakeModel(rs);
  }

  it("grava uma linha por (tarefa, braço, run), um servidor por nível de falha, e o resume pula o concluído", async () => {
    dir = mkdtempSync(join(tmpdir(), "mcp-evals-"));
    const store = new ResultsStore(dir);
    const connects: string[] = [];
    const mcps: ReturnType<typeof fakeMcp>[] = [];
    const base = {
      taskSet: TASK_SET,
      tasks: TASK_SET.tasks,
      arms: ["A", "B"] as ("A" | "B")[],
      faults: ["0", "20"],
      runs: 2,
      model: "claude-sonnet-5",
      judge: false,
      apiKey: "sk-test",
      store,
      date: "2026-09-28",
      serverSha: "abc1234",
      resume: true,
      connect: async (fault: string) => {
        connects.push(fault);
        const m = fakeMcp({ srv_serie: { text: payloadWith(STABLE), isError: false } });
        mcps.push(m);
        return m;
      },
      log: () => {},
    };
    // 1 tarefa × 2 braços × 2 níveis × 2 runs = 8 sessões, 16 requisições.
    const first = await runRound({ ...base, budget: new Budget(10), deps: { fetchImpl: modelForSessions(8).fetchImpl, ...noopDeps } });
    expect(first.records).toHaveLength(8);
    expect(first.skipped).toBe(0);
    expect(connects).toEqual(["0", "20"]);
    expect(mcps.every((m) => m.closed)).toBe(true);
    const fileA0 = readFileSync(join(dir, "2026-09-28_abc1234_A_0.ndjson"), "utf8").trim().split("\n");
    expect(fileA0).toHaveLength(2);
    expect(JSON.parse(readFileSync(join(dir, "2026-09-28_abc1234_B_20.ndjson.resumo.json".replace(".ndjson", "")), "utf8"))).toMatchObject({ arm: "B", fault: "20", sessions: 2 });

    // Resume: nada roda de novo; o modelo dublado não é chamado.
    const second = await runRound({ ...base, budget: new Budget(10), deps: { fetchImpl: fakeModel([]).fetchImpl, ...noopDeps } });
    expect(second.records).toHaveLength(0);
    expect(second.skipped).toBe(8);
  });

  it("teto de gasto interrompe a rodada e sinaliza stoppedBy budget", async () => {
    dir = mkdtempSync(join(tmpdir(), "mcp-evals-"));
    const model = fakeModel([
      response([toolUse("tu0", "srv_serie", { codigo: 433 })], "tool_use", { input_tokens: 300_000, output_tokens: 1 }),
      response([{ type: "text", text: "0,56" }], "end_turn", { input_tokens: 300_000, output_tokens: 1 }),
    ]);
    const result = await runRound({
      taskSet: TASK_SET,
      tasks: TASK_SET.tasks,
      arms: ["A", "B"],
      faults: ["0"],
      runs: 3,
      model: "claude-sonnet-5",
      judge: false,
      apiKey: "sk-test",
      budget: new Budget(1), // 2 requisições × 0,60 = 1,20 > 1
      store: new ResultsStore(dir),
      date: "2026-09-28",
      serverSha: null,
      resume: true,
      deps: { fetchImpl: model.fetchImpl, ...noopDeps },
      connect: async () => fakeMcp({ srv_serie: { text: payloadWith(STABLE), isError: false } }),
      log: () => {},
    });
    expect(result.stoppedBy).toBe("budget");
    expect(result.records).toHaveLength(1);
    expect(result.records[0]!.endedBy).toBe("budget");
  });

  it("tarefas inválidas contra o catálogo vivo falham antes de gastar", async () => {
    dir = mkdtempSync(join(tmpdir(), "mcp-evals-"));
    const bad = { ...TASK_SET, tasks: [{ ...TASK_SET.tasks[0]!, expectedTools: ["nao_existe"] }] };
    await expect(
      runRound({
        taskSet: bad,
        tasks: bad.tasks,
        arms: ["A"],
        faults: ["0"],
        runs: 1,
        model: "claude-sonnet-5",
        judge: false,
        apiKey: "sk-test",
        budget: new Budget(1),
        store: new ResultsStore(dir),
        date: "2026-09-28",
        serverSha: null,
        resume: true,
        deps: { fetchImpl: fakeModel([]).fetchImpl, ...noopDeps },
        connect: async () => fakeMcp({}),
        log: () => {},
      }),
    ).rejects.toThrow(/tool inexistente "nao_existe"/);
  });
});
