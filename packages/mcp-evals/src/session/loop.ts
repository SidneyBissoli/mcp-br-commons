/**
 * O loop de UMA sessão: modelo ↔ tools até `end_turn`, teto de passos ou teto de gasto.
 *
 * Regras do loop (as lições do `ilo-mcp-server/evals/results/2026-08-07-e2e.md`):
 *   - `tool_use` paralelo → TODOS os `tool_result` na MESMA mensagem user, um por id;
 *   - `is_error: true` quando o servidor devolveu `isError` (ou erro de protocolo);
 *   - `response.content` inteiro volta como assistant (append-only; blocos de
 *     thinking intactos);
 *   - `stop_reason`: `tool_use` executa; `end_turn` encerra; `max_tokens` encerra e
 *     marca; `refusal` é dropout de infra, não chamada ruim; `pause_turn` continua.
 *
 * O filtro do braço B roda AQUI, no texto do `tool_result`, e o `retrieval` é lido
 * ANTES do filtro — é assim que o NDJSON do braço B ainda sabe quando a origem
 * oscilou (para o juiz e para a contagem de `unstableResults`).
 */

import type { AnthropicTool } from "../catalog.js";
import { EvalApiError } from "../retry.js";
import { buildBody, postMessages, usageOf, type ApiDeps, type ContentBlock, type MessageParam } from "./api.js";
import { Budget, BudgetExceededError } from "./budget.js";
import { applyArm, readRetrieval } from "./filter.js";
import type { McpToolClient } from "./mcp-client.js";
import { checkAnswer, classifyError, computeMetrics, summarize } from "./metrics.js";
import {
  DEFAULT_MAX_STEPS,
  DEFAULT_MAX_TOKENS,
  DEFAULT_RETRIEVAL_HINT,
  addUsage,
  canonicalCall,
  emptyUsage,
  type Arm,
  type CallRecord,
  type FaultLevel,
  type SessionRecord,
  type Task,
  type TaskSet,
} from "./types.js";

export interface SessionConfig {
  task: Task;
  taskSet: TaskSet;
  arm: Arm;
  fault: FaultLevel;
  run: number;
  model: string;
  apiKey: string;
  tools: AnthropicTool[];
  mcp: McpToolClient;
  budget: Budget;
  serverSha: string | null;
  maxTokens?: number;
  deps: ApiDeps;
  /** Relógio injetável (testes). */
  now?: () => Date;
  /** Progresso por passo (opcional). */
  onStep?: (info: { step: number; calls: number; costUSD: number }) => void;
}

/** System prompt do braço: a comum + a frase de `retrieval` só no A. */
export function systemPromptFor(taskSet: TaskSet, arm: Arm): string {
  if (arm !== "A") return taskSet.systemPrompt;
  return `${taskSet.systemPrompt}\n\n${taskSet.retrievalHint ?? DEFAULT_RETRIEVAL_HINT}`;
}

function textOf(blocks: ContentBlock[]): string {
  return blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();
}

export async function runSession(cfg: SessionConfig): Promise<SessionRecord> {
  const now = cfg.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const systemPrompt = systemPromptFor(cfg.taskSet, cfg.arm);
  const maxSteps = cfg.task.maxSteps ?? DEFAULT_MAX_STEPS;
  const messages: MessageParam[] = [{ role: "user", content: cfg.task.prompt }];
  const calls: CallRecord[] = [];
  const usage = emptyUsage();
  let costUSD = 0;
  let stopReason: string | null = null;
  let endedBy: SessionRecord["endedBy"] = "end_turn";
  let infraError: string | undefined;
  let steps = 0;
  const finalParts: string[] = [];
  const label = `${cfg.task.id}/${cfg.arm}/${cfg.fault}/run${cfg.run}`;

  try {
    for (;;) {
      if (steps >= maxSteps) {
        endedBy = "max_steps";
        break;
      }
      steps++;
      cfg.budget.assertAvailable();
      const res = await postMessages(
        buildBody({
          model: cfg.model,
          maxTokens: cfg.maxTokens ?? DEFAULT_MAX_TOKENS,
          systemPrompt,
          tools: cfg.tools,
          messages,
        }),
        cfg.apiKey,
        label,
        cfg.deps,
      );
      const u = usageOf(res);
      addUsage(usage, u);
      costUSD += cfg.budget.charge(cfg.model, u);
      stopReason = res.stop_reason;

      // Append-only: o conteúdo inteiro volta, thinking incluído.
      messages.push({ role: "assistant", content: res.content });
      const text = textOf(res.content);
      if (text) finalParts.push(text);

      const toolUses = res.content.filter((b) => b.type === "tool_use" && typeof b.id === "string");
      if (stopReason === "refusal") {
        endedBy = "refusal";
        infraError = `refusal: ${res.stop_details?.category ?? "?"} — ${res.stop_details?.explanation ?? ""}`.trim();
        break;
      }
      if (stopReason === "max_tokens") {
        endedBy = "max_tokens";
        break;
      }
      if (stopReason === "pause_turn") continue;
      if (toolUses.length === 0) {
        endedBy = "end_turn";
        break;
      }

      // Executa todas as chamadas do passo e devolve um único user com todos os results.
      const results: ContentBlock[] = [];
      for (const tu of toolUses) {
        const name = String(tu.name);
        const args = (tu.input && typeof tu.input === "object" ? tu.input : {}) as Record<string, unknown>;
        const t0 = Date.now();
        const outcome = await cfg.mcp.callTool(name, args);
        const durationMs = Date.now() - t0;
        const shown = applyArm(cfg.arm, outcome.text);
        calls.push({
          step: steps,
          tool: name,
          args,
          canonical: canonicalCall(name, args),
          isError: outcome.isError,
          errorClass: classifyError(outcome, { transient: cfg.taskSet.transientErrorPattern, definitive: cfg.taskSet.definitiveErrorPattern }),
          retrieval: readRetrieval(outcome.text),
          resultChars: shown.length,
          resultSummary: summarize(shown, outcome.isError),
          durationMs,
        });
        results.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: shown,
          ...(outcome.isError ? { is_error: true } : {}),
        });
      }
      messages.push({ role: "user", content: results });
      cfg.onStep?.({ step: steps, calls: calls.length, costUSD });
    }
  } catch (e) {
    if (e instanceof BudgetExceededError) {
      endedBy = "budget";
      infraError = e.message;
    } else if (e instanceof EvalApiError) {
      endedBy = "infra";
      infraError = `[${e.kind}] ${e.message}`;
      // Falha fatal (auth/billing) sobe: a rodada inteira tem de parar.
      if (e.kind === "auth" || e.kind === "billing") {
        throw Object.assign(e, { partial: buildRecord() });
      }
    } else {
      endedBy = "infra";
      infraError = (e as Error).message;
    }
  }

  return buildRecord();

  function buildRecord(): SessionRecord {
    const metrics = computeMetrics(calls, steps, {
      ...(cfg.taskSet.insistenceKey ? { insistenceKey: cfg.taskSet.insistenceKey } : {}),
    });
    const finalAnswer = finalParts.length > 0 ? (finalParts[finalParts.length - 1] as string) : "";
    metrics.answerCorrect = endedBy === "end_turn" ? checkAnswer(cfg.task.answer, finalAnswer) : null;
    const faultCfg = cfg.taskSet.faults[cfg.fault];
    return {
      taskId: cfg.task.id,
      arm: cfg.arm,
      fault: cfg.fault,
      run: cfg.run,
      model: cfg.model,
      server: cfg.taskSet.server,
      serverSha: cfg.serverSha,
      startedAt,
      finishedAt: now().toISOString(),
      faultSeed: faultCfg && faultCfg.rules.length > 0 ? faultCfg.seed : null,
      systemPrompt,
      calls,
      finalAnswer,
      stopReason,
      endedBy,
      metrics,
      usage,
      costUSD: Number(costUSD.toFixed(6)),
      ...(infraError !== undefined && endedBy !== "end_turn" && endedBy !== "max_steps" && endedBy !== "max_tokens"
        ? { infraError }
        : {}),
    };
  }
}
