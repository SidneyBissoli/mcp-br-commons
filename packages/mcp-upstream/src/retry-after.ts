/**
 * Núcleo PURO do cálculo de espera entre tentativas. Sem rede, sem relógio próprio: os
 * testes o exercitam com valores exatos.
 */

export interface BackoffSpec {
  /** Espera antes do 1º retry; dobra a cada retry seguinte. */
  baseMs: number;
  /** Teto do backoff exponencial (sem contar o jitter). */
  maxMs: number;
  /** Jitter uniforme somado à espera: `random() * jitterMs`. */
  jitterMs: number;
}

/**
 * Interpreta um cabeçalho `Retry-After` (RFC 9110 §10.2.3) em milissegundos de espera.
 * Aceita delta-seconds ("5") e HTTP-date; devolve `null` quando ausente ou
 * ininteligível, para o chamador cair no próprio backoff.
 */
export function parseRetryAfterMs(value: string | null | undefined, now: number): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10) * 1000;
  // HTTP-date sempre tem nome de mês/dia; sem letra nenhuma, `Date.parse` inventa
  // datas para "-3" ou "5.5" — e isso não é Retry-After.
  if (!/[A-Za-z]/.test(trimmed)) return null;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now);
}

/** Backoff exponencial limitado, SEM jitter. `retry` é 0-based (0 = antes do 1º retry). */
export function backoffMs(retry: number, spec: BackoffSpec): number {
  return Math.min(spec.baseMs * 2 ** retry, spec.maxMs);
}

/**
 * Espera antes do próximo retry: nunca menor que o `Retry-After` da origem (quando
 * honrado), nunca menor que o backoff exponencial; jitter somado por fora.
 */
export function retryWaitMs(
  retry: number,
  retryAfterMs: number | null,
  spec: BackoffSpec,
  random: () => number,
): number {
  const jitter = spec.jitterMs > 0 ? Math.floor(random() * spec.jitterMs) : 0;
  return Math.max(retryAfterMs ?? 0, backoffMs(retry, spec)) + jitter;
}
