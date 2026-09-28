/**
 * Chamada à Anthropic Messages API para o loop de sessão.
 *
 * `fetch` cru, como o runner de turno único (`../runner.ts`): o pacote não tem
 * dependência de runtime e o commons não quer ganhar uma por causa de um SDK. O
 * retry/classificação é o mesmo `retry.ts` — dropout de infra (429/529/5xx/rede)
 * repete com backoff; auth/billing aborta a rodada.
 *
 * Forma do pedido (modelos da família 5 — ver skill claude-api 27/09/2026):
 *   - `tool_choice` só `auto` (o `any` forçado do eval de seleção dá 400 no Fable 5.1);
 *   - sem `temperature` (removido) e sem `thinking` explícito (adaptativo por padrão);
 *   - `cache_control` no bloco de system e no ÚLTIMO tool: tools+system são ~10 k
 *     tokens estáveis por sessão, e é a leitura de cache que segura o custo;
 *   - o histórico é APPEND-ONLY: `response.content` inteiro volta como assistant
 *     (com blocos `thinking`, que o modelo exige intactos) e todos os `tool_result`
 *     do passo vão numa ÚNICA mensagem user.
 */

import type { AnthropicTool } from "../catalog.js";
import { EvalApiError, MAX_RETRIES, backoffMs, classifyApiError, parseRetryAfter } from "../retry.js";
import type { UsageTotals } from "./types.js";

export const API_URL = "https://api.anthropic.com/v1/messages";
export const API_VERSION = "2023-06-01";

export interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  [k: string]: unknown;
}

export interface MessageParam {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface MessagesResponse {
  content: ContentBlock[];
  stop_reason: string | null;
  stop_details?: { type?: string; category?: string | null; explanation?: string } | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface ApiDeps {
  fetchImpl: typeof fetch;
  sleepImpl: (ms: number) => Promise<void>;
  logError: (line: string) => void;
  maxRetries?: number;
  /** Timeout por requisição (ms). Padrão 300 000 — sessões longas pensam. */
  requestTimeoutMs?: number;
}

export interface MessagesRequest {
  model: string;
  maxTokens: number;
  systemPrompt: string;
  tools: AnthropicTool[];
  messages: MessageParam[];
}

/** Monta o corpo com os dois pontos de cache (system e último tool). */
export function buildBody(req: MessagesRequest): Record<string, unknown> {
  const tools = req.tools.map((t, i) =>
    i === req.tools.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t,
  );
  return {
    model: req.model,
    max_tokens: req.maxTokens,
    system: [{ type: "text", text: req.systemPrompt, cache_control: { type: "ephemeral" } }],
    tools,
    tool_choice: { type: "auto" },
    messages: req.messages,
  };
}

export function usageOf(res: MessagesResponse): UsageTotals {
  return {
    inputTokens: res.usage?.input_tokens ?? 0,
    outputTokens: res.usage?.output_tokens ?? 0,
    cacheCreationInputTokens: res.usage?.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: res.usage?.cache_read_input_tokens ?? 0,
    requests: 1,
  };
}

async function postOnce(body: unknown, apiKey: string, deps: ApiDeps): Promise<MessagesResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.requestTimeoutMs ?? 300_000);
  let res: Response;
  try {
    res = await deps.fetchImpl(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    throw new EvalApiError(`erro de rede: ${(e as Error).message || "desconhecido"}`, 0, "network", true);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const { kind, retryable } = classifyApiError(res.status, text);
    const err = new EvalApiError(`Anthropic API ${res.status}: ${text.slice(0, 300)}`, res.status, kind, retryable);
    err.retryAfterSeconds = parseRetryAfter(res.headers.get("retry-after"));
    throw err;
  }
  return (await res.json()) as MessagesResponse;
}

/** POST /v1/messages com retry de falha transitória. Lança `EvalApiError` tipado. */
export async function postMessages(
  body: unknown,
  apiKey: string,
  label: string,
  deps: ApiDeps,
): Promise<MessagesResponse> {
  const maxRetries = deps.maxRetries ?? MAX_RETRIES;
  let last: EvalApiError | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await postOnce(body, apiKey, deps);
    } catch (e) {
      const err = e instanceof EvalApiError ? e : new EvalApiError((e as Error).message, 0, "other", false);
      last = err;
      if (!err.retryable || attempt === maxRetries) throw err;
      const wait = backoffMs(attempt, err.retryAfterSeconds) + Math.floor(Math.random() * 500);
      deps.logError(`    ↻ ${label}: ${err.kind} (HTTP ${err.status}); retry ${attempt + 1}/${maxRetries} em ${wait}ms`);
      await deps.sleepImpl(wait);
    }
  }
  throw last ?? new EvalApiError(`falha desconhecida em ${label}`, 0, "other", false);
}
