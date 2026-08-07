/**
 * Runner — dirige o eval real de seleção de tool contra a Anthropic Messages API.
 *
 * Para cada fixture, envia o catálogo inteiro como `tools` da requisição, força uma
 * chamada de tool com `tool_choice: {type: "any"}` e registra a tool escolhida. O scorer
 * puro (score.ts) transforma as escolhas em acurácia top-1/top-k/por-área e na decisão
 * de gate.
 *
 * Princípios (herdados do harness do senado — reexecução barata):
 *   - Sem dependência de SDK: `fetch` puro contra /v1/messages.
 *   - Gateado em ANTHROPIC_API_KEY: ausente → imprime instruções e devolve exit 0
 *     (nunca quebra CI, nunca exige rede).
 *   - Catálogo + fixtures são a fonte de verdade; o modelo só escolhe entre tools reais.
 *
 * Uso típico no `evals/run.ts` de um projeto:
 *
 *   const { exitCode } = await runEval({ catalog, fixtures: FIXTURES, systemPrompt: "..." });
 *   process.exit(exitCode);
 *
 * Variáveis de ambiente (todas opcionais): EVAL_MODEL, EVAL_CONCURRENCY, EVAL_LIMIT.
 */

import { catalogAsAnthropicTools, type AnthropicTool, type Catalog } from "./catalog.js";
import type { EvalFixture } from "./fixtures.js";
import { scoreItem, type GateOptions, type GateResult, type Prediction, type ScoredItem, type ScoreReport } from "./score.js";
import { formatReport, type FixtureError } from "./report.js";
import {
  EvalApiError,
  classifyApiError,
  backoffMs,
  parseRetryAfter,
  isFatalInfra,
  MAX_RETRIES,
} from "./retry.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-opus-4-8";

export interface EvalRunnerConfig {
  catalog: Catalog;
  fixtures: EvalFixture[];
  /** System prompt de roteamento, na persona/idioma do servidor. */
  systemPrompt: string;
  /** Modelo padrão quando EVAL_MODEL não está definido. Padrão: claude-opus-4-8. */
  defaultModel?: string;
  /** Limiares/contexto do gate (toolCount é preenchido do catálogo se omitido). */
  gate?: GateOptions;
  /** Ambiente a consultar (padrão: process.env). */
  env?: Record<string, string | undefined>;
  /** Saída normal (padrão: console.log). */
  log?: (line: string) => void;
  /** Saída de erro/progresso de retry (padrão: console.error). */
  logError?: (line: string) => void;
  /** Implementação de fetch (padrão: fetch global) — injetável para teste offline. */
  fetchImpl?: typeof fetch;
  /** Implementação de sleep (padrão: setTimeout) — injetável para teste offline. */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Máximo de retries por fixture em falha transitória. Padrão: MAX_RETRIES (5). */
  maxRetries?: number;
}

export interface EvalRunResult {
  /** 0 = completo (ou pulado sem API key); 2 = rodada incompleta (dropout de infra). */
  exitCode: number;
  /** True quando ANTHROPIC_API_KEY não estava definido e nada rodou. */
  skipped: boolean;
  report?: ScoreReport;
  gate?: GateResult;
  errors?: FixtureError[];
}

interface AnthropicContentBlock {
  type: string;
  name?: string;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Uma tentativa HTTP. Lança EvalApiError tipado em qualquer não-2xx ou falha de rede. */
async function callOnce(
  fixture: EvalFixture,
  apiKey: string,
  model: string,
  tools: AnthropicTool[],
  systemPrompt: string,
  fetchImpl: typeof fetch,
): Promise<Prediction> {
  const body = {
    model,
    max_tokens: 1024,
    system: systemPrompt,
    tools,
    tool_choice: { type: "any" as const },
    messages: [{ role: "user" as const, content: fixture.query }],
  };

  let res: Response;
  try {
    res = await fetchImpl(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    // DNS/TCP/TLS/abort — sempre vale retry.
    throw new EvalApiError(`erro de rede: ${(e as Error).message || "desconhecido"}`, 0, "network", true);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const { kind, retryable } = classifyApiError(res.status, text);
    const err = new EvalApiError(`Anthropic API ${res.status}: ${text.slice(0, 200)}`, res.status, kind, retryable);
    err.retryAfterSeconds = parseRetryAfter(res.headers.get("retry-after"));
    throw err;
  }

  const data = (await res.json()) as { content?: AnthropicContentBlock[] };
  const picks: string[] = [];
  for (const block of data.content ?? []) {
    if (block.type === "tool_use" && typeof block.name === "string") {
      picks.push(block.name);
    }
  }
  return { id: fixture.id, predictedTools: picks };
}

/**
 * Chama a API para uma fixture, com retry de falhas transitórias (429/529/5xx/rede) em
 * backoff exponencial limitado + jitter, honrando Retry-After. Falhas fatais de infra
 * (auth/billing) lançam imediatamente — retry só desperdiça tempo. O EvalApiError
 * lançado carrega `kind` para o chamador distinguir "dropout de infra" de "tool errada".
 */
async function predictOne(
  fixture: EvalFixture,
  apiKey: string,
  model: string,
  tools: AnthropicTool[],
  systemPrompt: string,
  fetchImpl: typeof fetch,
  sleepImpl: (ms: number) => Promise<void>,
  maxRetries: number,
  logError: (line: string) => void,
): Promise<Prediction> {
  let lastError: EvalApiError | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callOnce(fixture, apiKey, model, tools, systemPrompt, fetchImpl);
    } catch (e) {
      const err = e instanceof EvalApiError ? e : new EvalApiError((e as Error).message, 0, "other", false);
      lastError = err;
      if (!err.retryable || attempt === maxRetries) throw err;
      const base = backoffMs(attempt, err.retryAfterSeconds);
      const jitter = Math.floor(Math.random() * 500);
      logError(`    ↻ ${fixture.id}: ${err.kind} (HTTP ${err.status}); retry ${attempt + 1}/${maxRetries} em ${base + jitter}ms`);
      await sleepImpl(base + jitter);
    }
  }
  throw lastError ?? new EvalApiError(`falha desconhecida em ${fixture.id}`, 0, "other", false);
}

/** Mapeia `items` com concorrência limitada, preservando a ordem. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i] as T, i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function printSetupInstructions(config: EvalRunnerConfig, log: (line: string) => void): void {
  const lines = [
    "",
    "  ANTHROPIC_API_KEY não está definido — pulando a execução com modelo real.",
    "  Este runner faz a seleção de tool real via Anthropic Messages API.",
    "",
    "  Para rodar de verdade:",
    "    ANTHROPIC_API_KEY=sk-ant-... npx tsx evals/run.ts",
    "",
    "  Variáveis opcionais:",
    `    EVAL_MODEL=...                 (padrão: ${config.defaultModel ?? DEFAULT_MODEL})`,
    "    EVAL_CONCURRENCY=4             (requisições paralelas)",
    "    EVAL_LIMIT=10                  (rodar só as N primeiras fixtures)",
    "",
    `  Catálogo: ${config.catalog.tools.length} tools · Fixtures: ${config.fixtures.length} consultas`,
    "  O scorer e o catálogo são testados offline em `npm test`.",
    "",
  ];
  log(lines.join("\n"));
}

/**
 * Roda o eval completo e imprime o relatório. Devolve o resultado com `exitCode`
 * (0 completo/pulado, 2 rodada incompleta) — o `evals/run.ts` do projeto decide se
 * chama `process.exit`.
 */
export async function runEval(config: EvalRunnerConfig): Promise<EvalRunResult> {
  const env = config.env ?? process.env;
  const log = config.log ?? console.log;
  const logError = config.logError ?? console.error;
  const fetchImpl = config.fetchImpl ?? fetch;
  const sleepImpl = config.sleepImpl ?? defaultSleep;
  const maxRetries = config.maxRetries ?? MAX_RETRIES;

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    printSetupInstructions(config, log);
    return { exitCode: 0, skipped: true };
  }

  const model = env.EVAL_MODEL || config.defaultModel || DEFAULT_MODEL;
  const concurrency = Math.max(1, parseInt(env.EVAL_CONCURRENCY || "4", 10) || 4);
  const limit = parseInt(env.EVAL_LIMIT || "", 10);
  const fixtures = Number.isFinite(limit) && limit > 0 ? config.fixtures.slice(0, limit) : config.fixtures;

  const tools = catalogAsAnthropicTools(config.catalog);
  log(`Rodando ${fixtures.length} fixtures contra ${tools.length} tools (modelo ${model}, concorrência ${concurrency})...`);

  // Depois de uma falha fatal de infra (auth/billing), toda fixture restante bateria na
  // mesma parede — curto-circuita em vez de martelar a API com requisições condenadas.
  let fatalAbort: EvalApiError | null = null;
  const predictions: Prediction[] = [];
  const errors: FixtureError[] = [];

  await mapWithConcurrency(fixtures, concurrency, async (f) => {
    if (fatalAbort) {
      errors.push({ id: f.id, kind: fatalAbort.kind, status: fatalAbort.status, message: "abortado (falha fatal anterior)" });
      return;
    }
    try {
      predictions.push(
        await predictOne(f, apiKey, model, tools, config.systemPrompt, fetchImpl, sleepImpl, maxRetries, logError),
      );
    } catch (e) {
      const err = e instanceof EvalApiError ? e : new EvalApiError((e as Error).message, 0, "other", false);
      if (isFatalInfra(err.kind)) fatalAbort = err;
      logError(`  ! ${f.id}: [${err.kind}] ${err.message}`);
      errors.push({ id: f.id, kind: err.kind, status: err.status, message: err.message });
    }
  });

  const predById = new Map(predictions.map((p) => [p.id, p]));
  const items: ScoredItem[] = fixtures.map((f) => {
    // A "área" da fixture é a área da primeira expectedTool (a resposta canônica).
    const first = f.expectedTools[0];
    const area = (first !== undefined ? config.catalog.areaByName.get(first) : undefined) ?? "desconhecida";
    return scoreItem(f, predById.get(f.id), area);
  });

  const gateOptions: GateOptions = {
    ...config.gate,
    ...(config.gate?.toolCount === undefined ? { toolCount: config.catalog.tools.length } : {}),
  };
  const formatted = formatReport(items, errors, model, gateOptions);
  for (const line of formatted.lines) log(line);

  return {
    exitCode: formatted.exitCode,
    skipped: false,
    report: formatted.report,
    gate: formatted.gate,
    errors,
  };
}
