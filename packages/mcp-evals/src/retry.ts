/**
 * Núcleo puro de retry/classificação de erro do runner. Sem rede, sem I/O — os testes
 * offline o exercitam diretamente.
 *
 * O runner manda cada fixture à Anthropic Messages API. Duas classes de falha precisam
 * ser distinguidas, porque nenhuma delas é sinal de acurácia (uma fixture que nunca
 * chegou ao modelo não foi "respondida errado"):
 *   - infra transitória (429 rate-limit, 529 overloaded, 5xx, rede) → vale retry;
 *   - infra fatal (401 auth, 400 "credit balance too low") → retry nunca ajuda; a rodada
 *     inteira deve falhar rápido com remédio claro em vez de martelar a API.
 */

export type ErrorKind =
  | "rate_limit" // 429 — estourou tokens/min; backoff e retry
  | "overloaded" // 529 — capacidade da Anthropic; backoff e retry
  | "server" // 5xx — erro transitório upstream; retry
  | "network" // fetch lançou (DNS/TCP/TLS/abort); retry
  | "auth" // 401/403 — chave inválida/rejeitada; fatal, aborta a rodada
  | "billing" // 400 credit balance too low; fatal, aborta a rodada
  | "other"; // qualquer outra coisa (ex.: request malformado); sem retry

export class EvalApiError extends Error {
  /** Dica Retry-After (segundos) vinda da API, quando presente. */
  retryAfterSeconds: number | undefined;

  constructor(
    message: string,
    public readonly status: number,
    public readonly kind: ErrorKind,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "EvalApiError";
  }
}

/** Kinds fatais curto-circuitam a rodada inteira — toda fixture bateria na mesma parede. */
export function isFatalInfra(kind: ErrorKind): boolean {
  return kind === "auth" || kind === "billing";
}

/**
 * Classifica um erro HTTP da Anthropic API (status + corpo) em kind + retryable.
 * Puro; o corpo só é inspecionado para distinguir um 400 de billing ("credit balance
 * is too low") dos demais 400.
 */
export function classifyApiError(status: number, body: string): { kind: ErrorKind; retryable: boolean } {
  const lower = (body || "").toLowerCase();
  if (status === 429) return { kind: "rate_limit", retryable: true };
  if (status === 529) return { kind: "overloaded", retryable: true };
  if (status === 401 || status === 403) return { kind: "auth", retryable: false };
  if (status === 400 && (lower.includes("credit balance") || lower.includes("plans & billing"))) {
    return { kind: "billing", retryable: false };
  }
  if (status >= 500) return { kind: "server", retryable: true };
  return { kind: "other", retryable: false };
}

export const BASE_BACKOFF_MS = 2_000;
export const MAX_BACKOFF_MS = 30_000;
export const MAX_RETRIES = 5;

/**
 * Backoff base (ms) antes da tentativa de retry (0-based). Honra a dica Retry-After
 * (segundos) da API quando presente — importante no 429, onde a janela de rate-limit
 * precisa rolar antes da próxima tentativa. O chamador adiciona jitter; mantido puro
 * para o teste unitário poder asserir valores exatos.
 */
export function backoffMs(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(Math.ceil(retryAfterSeconds * 1000), MAX_BACKOFF_MS);
  }
  return Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
}

/** Interpreta um header `Retry-After` (só a forma inteiro-segundos) em segundos. */
export function parseRetryAfter(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;
  const secs = parseInt(headerValue.trim(), 10);
  return Number.isFinite(secs) && secs >= 0 ? secs : undefined;
}
