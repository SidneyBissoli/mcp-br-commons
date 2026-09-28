/**
 * `--dry`: servidor REAL por stdio, modelo DUBLADO.
 *
 * O dublê executa o `script` de cada tarefa (as chamadas que uma trajetória
 * correta faria) e mede o que a rodada paga vai pagar: caracteres de cada
 * `tool_result` como sai (braço A) e depois do filtro (braço B), o tamanho da
 * lista de tools na forma do modelo, e — quando há `ANTHROPIC_API_KEY` e o operador
 * pede `--count-tokens` — a contagem EXATA pelo endpoint gratuito
 * `/v1/messages/count_tokens`. Sem chave, estima por caracteres e diz que estimou.
 *
 * O objetivo é o do dossiê: substituir o custo SUPOSTO por sessão por um MEDIDO
 * antes de aprovar a rodada. A estimativa de custo usa a tabela de preços real e
 * a forma do loop (tools+system cacheados, contexto que cresce a cada passo).
 */

import type { AnthropicTool } from "../catalog.js";
import { API_VERSION } from "./api.js";
import { applyArm, readRetrieval } from "./filter.js";
import type { McpToolClient } from "./mcp-client.js";
import { classifyError } from "./metrics.js";
import { pricingFor } from "./pricing.js";
import type { Task, TaskSet } from "./types.js";

/** Aproximação para JSON em pt-BR com números; o `--count-tokens` a substitui. */
export const CHARS_PER_TOKEN_ESTIMATE = 3.5;

export interface DryCall {
  tool: string;
  args: Record<string, unknown>;
  isError: boolean;
  errorClass: string | null;
  charsA: number;
  charsB: number;
  tokensA: number;
  tokensB: number;
  unstable: boolean;
  durationMs: number;
}

export interface DryTaskResult {
  taskId: string;
  calls: DryCall[];
  totalTokensA: number;
  totalTokensB: number;
}

export interface DryReport {
  server: string;
  toolsChars: number;
  toolsTokens: number;
  systemTokens: number;
  tokenSource: "count_tokens" | "estimated";
  tasks: DryTaskResult[];
  /** Custo estimado por sessão (roteiro como trajetória, média sobre as tarefas), por modelo. */
  costPerSession: Record<string, { A: number; B: number }>;
  /** Custo estimado de uma sessão de REFERENCE_STEPS passos com o tamanho médio MEDIDO de resultado. */
  costPerReferenceSession: Record<string, { A: number; B: number }>;
  meanResultTokens: { A: number; B: number };
}

export type TokenCounter = (text: string) => Promise<number>;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

/** Contador exato via `/v1/messages/count_tokens` (endpoint sem custo). */
export function countTokensWith(apiKey: string, model: string, fetchImpl: typeof fetch = fetch): TokenCounter {
  return async (text) => {
    const res = await fetchImpl("https://api.anthropic.com/v1/messages/count_tokens", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": API_VERSION },
      body: JSON.stringify({ model, messages: [{ role: "user", content: text }] }),
    });
    if (!res.ok) throw new Error(`count_tokens ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { input_tokens: number };
    return data.input_tokens;
  };
}

/**
 * Custo estimado de UMA sessão com `n` passos: por passo, tools+system lidos do
 * cache (escritos uma vez no passo 1), mais o contexto acumulado dos passos
 * anteriores (tool_results + ~150 tokens de saída por passo) como entrada nova, e
 * ~300 tokens de saída. É a mesma conta do dossiê, com os tamanhos medidos.
 */
export function estimateSessionCost(
  model: string,
  fixedTokens: number,
  resultTokens: number[],
  outputPerStep = 300,
): number {
  const p = pricingFor(model);
  const M = 1_000_000;
  const cacheRead = p.cacheReadPerMTok ?? p.inputPerMTok * 0.1;
  let cost = (fixedTokens * p.inputPerMTok * 1.25) / M; // escrita do cache, passo 1
  let context = 0;
  const steps = Math.max(1, resultTokens.length + 1);
  for (let k = 0; k < steps; k++) {
    if (k > 0) cost += (fixedTokens * cacheRead) / M;
    cost += (context * p.inputPerMTok) / M;
    cost += (outputPerStep * p.outputPerMTok) / M;
    context += (resultTokens[k] ?? 0) + outputPerStep;
  }
  return cost;
}

export interface DryOptions {
  counter?: TokenCounter;
  models: string[];
  log?: (line: string) => void;
  /** Loga um trecho de cada resultado (para conferir gabaritos). */
  verbose?: boolean;
}

/** Passos da sessão de referência do dossiê (para comparar com a estimativa de 27/09). */
export const REFERENCE_STEPS = 20;

export async function runDry(
  taskSet: TaskSet,
  tasks: Task[],
  tools: AnthropicTool[],
  mcp: McpToolClient,
  opts: DryOptions,
): Promise<DryReport> {
  const count = opts.counter ?? (async (t: string) => estimateTokens(t));
  const log = opts.log ?? (() => {});
  const toolsJson = JSON.stringify(tools);
  const toolsTokens = await count(toolsJson);
  const systemTokens = await count(`${taskSet.systemPrompt}\n\n${taskSet.retrievalHint ?? ""}`);
  log(`tools: ${tools.length} · ${toolsJson.length} chars · ${toolsTokens} tokens · system ${systemTokens} tokens`);

  const results: DryTaskResult[] = [];
  for (const task of tasks) {
    const calls: DryCall[] = [];
    log(`\n${task.id}: ${task.script.length} chamadas do roteiro`);
    for (const c of task.script) {
      const t0 = Date.now();
      const out = await mcp.callTool(c.tool, c.args);
      const durationMs = Date.now() - t0;
      const textB = applyArm("B", out.text);
      const [tokensA, tokensB] = await Promise.all([count(out.text), count(textB)]);
      const call: DryCall = {
        tool: c.tool,
        args: c.args,
        isError: out.isError,
        errorClass: classifyError(out, { transient: taskSet.transientErrorPattern, definitive: taskSet.definitiveErrorPattern }),
        charsA: out.text.length,
        charsB: textB.length,
        tokensA,
        tokensB,
        unstable: readRetrieval(out.text)?.some((r) => r.unstable) ?? false,
        durationMs,
      };
      calls.push(call);
      log(
        `  ${c.tool}(${JSON.stringify(c.args)}) → ${out.isError ? `ERRO[${call.errorClass}]` : "ok"} · A ${tokensA} tok / B ${tokensB} tok · ${durationMs} ms${call.unstable ? " · UNSTABLE" : ""}`,
      );
      if (opts.verbose) log(`    ↳ ${out.text.replace(/\s+/g, " ").slice(0, 700)}`);
    }
    results.push({
      taskId: task.id,
      calls,
      totalTokensA: calls.reduce((a, c) => a + c.tokensA, 0),
      totalTokensB: calls.reduce((a, c) => a + c.tokensB, 0),
    });
  }

  const fixed = toolsTokens + systemTokens;
  const costPerSession: DryReport["costPerSession"] = {};
  for (const model of opts.models) {
    const a = results.map((r) => estimateSessionCost(model, fixed, r.calls.map((c) => c.tokensA)));
    const b = results.map((r) => estimateSessionCost(model, fixed, r.calls.map((c) => c.tokensB)));
    const mean = (xs: number[]) => (xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : 0);
    costPerSession[model] = { A: mean(a), B: mean(b) };
  }

  const allCalls = results.flatMap((r) => r.calls);
  const meanA = allCalls.length ? allCalls.reduce((a, c) => a + c.tokensA, 0) / allCalls.length : 0;
  const meanB = allCalls.length ? allCalls.reduce((a, c) => a + c.tokensB, 0) / allCalls.length : 0;
  const costPerReferenceSession: DryReport["costPerReferenceSession"] = {};
  for (const model of opts.models) {
    costPerReferenceSession[model] = {
      A: estimateSessionCost(model, fixed, Array<number>(REFERENCE_STEPS - 1).fill(Math.round(meanA))),
      B: estimateSessionCost(model, fixed, Array<number>(REFERENCE_STEPS - 1).fill(Math.round(meanB))),
    };
  }

  return {
    server: taskSet.server,
    toolsChars: toolsJson.length,
    toolsTokens,
    systemTokens,
    tokenSource: opts.counter ? "count_tokens" : "estimated",
    tasks: results,
    costPerSession,
    costPerReferenceSession,
    meanResultTokens: { A: Math.round(meanA), B: Math.round(meanB) },
  };
}

export function renderDryReport(r: DryReport): string[] {
  const lines: string[] = [];
  lines.push(`# --dry — ${r.server}`, "");
  lines.push(
    `Tokens ${r.tokenSource === "count_tokens" ? "CONTADOS por /v1/messages/count_tokens" : `ESTIMADOS (chars ÷ ${CHARS_PER_TOKEN_ESTIMATE})`}. ` +
      `Tools na forma do modelo: ${r.toolsChars} chars ≈ ${r.toolsTokens} tokens; system ≈ ${r.systemTokens} tokens (ambos cacheados).`,
    "",
  );
  lines.push("| tarefa | chamadas | erros | instáveis | tokens A | tokens B | Δ |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const t of r.tasks) {
    lines.push(
      `| ${t.taskId} | ${t.calls.length} | ${t.calls.filter((c) => c.isError).length} | ${t.calls.filter((c) => c.unstable).length} | ${t.totalTokensA} | ${t.totalTokensB} | ${t.totalTokensA - t.totalTokensB} |`,
    );
  }
  lines.push("", "## Custo estimado por sessão (roteiro como trajetória, ~300 tokens de saída por passo)", "");
  lines.push("| modelo | braço A | braço B |");
  lines.push("|---|---:|---:|");
  for (const [m, c] of Object.entries(r.costPerSession)) lines.push(`| ${m} | US$ ${c.A.toFixed(3)} | US$ ${c.B.toFixed(3)} |`);
  lines.push("", `## Custo estimado de uma sessão de ${REFERENCE_STEPS} passos (resultado médio medido: A ${r.meanResultTokens.A} / B ${r.meanResultTokens.B} tokens)`, "");
  lines.push("| modelo | braço A | braço B |");
  lines.push("|---|---:|---:|");
  for (const [m, c] of Object.entries(r.costPerReferenceSession)) lines.push(`| ${m} | US$ ${c.A.toFixed(3)} | US$ ${c.B.toFixed(3)} |`);
  lines.push("");
  return lines;
}
