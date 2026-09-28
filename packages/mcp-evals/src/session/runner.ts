/**
 * Orquestração da rodada: níveis de falha × braços × tarefas × execuções.
 *
 * Um processo de servidor por NÍVEL de falha (as regras entram por env no
 * `--import`), reutilizado por braços, tarefas e execuções. Resume por chave;
 * teto de gasto único para a rodada inteira (loop + juiz); falha fatal de infra
 * (auth/billing) para tudo na hora. Os braços do mesmo nível rodam intercalados
 * por tarefa (A, B, A, B…) para que uma origem que oscila por hora atinja os dois
 * por igual — nunca comparar braços medidos em horas diferentes.
 */

import type { AnthropicTool } from "../catalog.js";
import { EvalApiError, isFatalInfra } from "../retry.js";
import type { ApiDeps } from "./api.js";
import { Budget, BudgetExceededError } from "./budget.js";
import { judgeSession } from "./judge.js";
import { runSession } from "./loop.js";
import type { McpToolClient } from "./mcp-client.js";
import { ResultsStore, completedKeys, resultsFileName, sessionKey } from "./results.js";
import type { Arm, FaultLevel, SessionRecord, Task, TaskSet } from "./types.js";
import { validateTaskSet } from "./validate.js";

export interface RoundConfig {
  taskSet: TaskSet;
  tasks: Task[];
  arms: Arm[];
  faults: FaultLevel[];
  runs: number;
  model: string;
  judgeModel?: string;
  judge: boolean;
  apiKey: string;
  budget: Budget;
  store: ResultsStore;
  date: string;
  serverSha: string | null;
  maxTokens?: number;
  resume: boolean;
  deps: ApiDeps;
  /** Sobe o servidor para um nível de falha; o runner fecha ao terminar o nível. */
  connect: (fault: FaultLevel) => Promise<McpToolClient>;
  log: (line: string) => void;
}

export interface RoundResult {
  records: SessionRecord[];
  skipped: number;
  spentUSD: number;
  /** Motivo de parada antecipada, se houve. */
  stoppedBy?: "budget" | "fatal";
}

export async function runRound(cfg: RoundConfig): Promise<RoundResult> {
  const records: SessionRecord[] = [];
  let skipped = 0;
  let stoppedBy: RoundResult["stoppedBy"];

  outer: for (const fault of cfg.faults) {
    const mcp = await cfg.connect(fault);
    try {
      const tools: AnthropicTool[] = await mcp.listTools();
      const problems = validateTaskSet(cfg.taskSet, tools);
      if (problems.length > 0) throw new Error(`tarefas inválidas contra o catálogo vivo:\n  - ${problems.join("\n  - ")}`);
      cfg.log(`nível de falha ${fault}: ${tools.length} tools no servidor`);

      const fileByArm = new Map<Arm, string>();
      const doneByArm = new Map<Arm, Set<string>>();
      for (const arm of cfg.arms) {
        const file = resultsFileName(cfg.date, cfg.serverSha, arm, fault);
        fileByArm.set(arm, file);
        doneByArm.set(arm, cfg.resume ? completedKeys(cfg.store.load(file)) : new Set());
      }

      for (const task of cfg.tasks) {
        for (let run = 1; run <= cfg.runs; run++) {
          for (const arm of cfg.arms) {
            const key = sessionKey({ taskId: task.id, arm, fault, run, model: cfg.model });
            if (doneByArm.get(arm)?.has(key)) {
              skipped++;
              continue;
            }
            const label = `${task.id}/${arm}/${fault}/run${run}`;
            cfg.log(`▶ ${label} (gasto US$ ${cfg.budget.spentUSD.toFixed(3)} de ${cfg.budget.limitUSD.toFixed(2)})`);
            let record: SessionRecord;
            try {
              record = await runSession({
                task,
                taskSet: cfg.taskSet,
                arm,
                fault,
                run,
                model: cfg.model,
                apiKey: cfg.apiKey,
                tools,
                mcp,
                budget: cfg.budget,
                serverSha: cfg.serverSha,
                ...(cfg.maxTokens !== undefined ? { maxTokens: cfg.maxTokens } : {}),
                deps: cfg.deps,
              });
            } catch (e) {
              const err = e as EvalApiError & { partial?: SessionRecord };
              if (err instanceof EvalApiError && isFatalInfra(err.kind)) {
                if (err.partial) {
                  cfg.store.append(fileByArm.get(arm) as string, err.partial);
                  records.push(err.partial);
                }
                cfg.log(`✖ falha fatal de infra (${err.kind}): ${err.message} — rodada interrompida`);
                stoppedBy = "fatal";
                break outer;
              }
              throw e;
            }

            if (cfg.judge && record.endedBy === "end_turn") {
              try {
                record = await judgeSession(record, {
                  ...cfg.deps,
                  apiKey: cfg.apiKey,
                  budget: cfg.budget,
                  ...(cfg.judgeModel ? { model: cfg.judgeModel } : {}),
                });
              } catch (e) {
                if (e instanceof BudgetExceededError) {
                  record = { ...record, unstableCitedAsCertain: null, judgeVerdict: `juiz não rodou: ${e.message}` };
                } else {
                  record = { ...record, unstableCitedAsCertain: null, judgeVerdict: `juiz falhou: ${(e as Error).message}` };
                }
              }
            }

            cfg.store.append(fileByArm.get(arm) as string, record);
            records.push(record);
            const m = record.metrics;
            cfg.log(
              `  ${record.endedBy} · ${m.calls} chamadas em ${m.steps} passos · ruins ${m.badCalls} (a${m.repeatAfterDefinitiveError} b${m.schemaRefusals} c${m.insistenceGroups}) · instáveis ${m.unstableResults} · US$ ${record.costUSD.toFixed(3)}`,
            );
            if (record.endedBy === "budget") {
              cfg.log(`✖ ${record.infraError} — rodada interrompida`);
              stoppedBy = "budget";
              break outer;
            }
          }
        }
      }

      for (const arm of cfg.arms) {
        const file = fileByArm.get(arm) as string;
        const all = cfg.store.load(file);
        cfg.store.writeSummary(file, {
          generatedAt: new Date().toISOString(),
          server: cfg.taskSet.server,
          serverSha: cfg.serverSha,
          model: cfg.model,
          arm,
          fault,
          sessions: all.length,
          completed: all.filter((r) => r.infraError === undefined).length,
          costUSD: Number(all.reduce((a, r) => a + r.costUSD, 0).toFixed(4)),
          spentThisRunUSD: Number(cfg.budget.spentUSD.toFixed(4)),
          budgetUSD: cfg.budget.limitUSD,
        });
      }
    } finally {
      await mcp.close();
    }
  }

  return { records, skipped, spentUSD: cfg.budget.spentUSD, ...(stoppedBy ? { stoppedBy } : {}) };
}
