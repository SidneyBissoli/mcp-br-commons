/**
 * Métrica "chamada ruim por tarefa" — contada por trace, sem juiz.
 *
 *   (a) repetição da MESMA chamada (tool + args canônicos) logo depois de um erro
 *       DEFINITIVO dela (isError cujo texto não parece transitório, ou recusa de
 *       esquema). Repetir depois de timeout/5xx é razoável e não conta.
 *   (b) chamada recusada pelo esquema (-32602 do protocolo ou validação): o modelo
 *       tinha o schema e errou o argumento. Cada recusa é uma chamada ruim.
 *   (c) insistência: ≥3 chamadas com a mesma CHAVE (ex.: o código da série) em que
 *       todas falharam — trocar de tool sem trocar o alvo que já não existe.
 *
 * Cada heurística erra para o lado de NÃO contar: uma métrica que acusa demais
 * some com o efeito que o A/B quer medir. O gabarito (d, leitura de instável como
 * certeza) fica em `judge.ts`.
 */

import {
  DEFAULT_TRANSIENT_PATTERN,
  defaultInsistenceKey,
  type Answer,
  type CallRecord,
  type ErrorClass,
  type ScriptedCall,
  type SessionMetrics,
  type ToolCallOutcomeLike,
} from "./types.js";

const SCHEMA_PATTERN =
  /inv[aá]lid|invalid|obrigat[oó]rio|required|n[aã]o (é|e) (um|uma) |deve ser|must be|esquema|schema|par[aâ]metro desconhecido|unknown (param|argument|property)/i;

/** Classifica o erro de uma chamada pelo que o servidor devolveu. */
export interface ErrorPatterns {
  transient?: RegExp | undefined;
  /** Vence o transitório quando os dois casam. */
  definitive?: RegExp | undefined;
}

export function classifyError(outcome: ToolCallOutcomeLike, patterns: ErrorPatterns = {}): ErrorClass | null {
  if (outcome.protocolError) {
    if (outcome.protocolError.code === -32602) return "schema";
    return "protocol";
  }
  if (!outcome.isError) return null;
  if (patterns.definitive?.test(outcome.text)) return "definitive";
  if ((patterns.transient ?? DEFAULT_TRANSIENT_PATTERN).test(outcome.text)) return "transient";
  if (SCHEMA_PATTERN.test(outcome.text)) return "schema";
  return "definitive";
}

export interface MetricOptions {
  insistenceKey?: (call: ScriptedCall) => string | null;
}

export function computeMetrics(calls: CallRecord[], steps: number, opts: MetricOptions = {}): SessionMetrics {
  const keyOf = opts.insistenceKey ?? defaultInsistenceKey;

  // (a) repetição logo depois de erro definitivo: olha a ÚLTIMA ocorrência
  // anterior da mesma chamada canônica; se ela falhou de forma definitiva (ou por
  // esquema), esta repetição é ruim.
  let repeatAfterDefinitiveError = 0;
  const lastByCanonical = new Map<string, CallRecord>();
  for (const c of calls) {
    const prev = lastByCanonical.get(c.canonical);
    if (prev && (prev.errorClass === "definitive" || prev.errorClass === "schema")) repeatAfterDefinitiveError++;
    lastByCanonical.set(c.canonical, c);
  }

  // (b) recusas de esquema.
  const schemaRefusals = calls.filter((c) => c.errorClass === "schema").length;

  // (c) insistência: agrupa por chave; grupo com ≥3 chamadas, todas com erro.
  const byKey = new Map<string, CallRecord[]>();
  for (const c of calls) {
    const k = keyOf({ tool: c.tool, args: c.args });
    if (k === null) continue;
    const arr = byKey.get(k) ?? [];
    arr.push(c);
    byKey.set(k, arr);
  }
  let insistenceGroups = 0;
  for (const group of byKey.values()) {
    if (group.length >= 3 && group.every((c) => c.isError)) insistenceGroups++;
  }

  const unstableResults = calls.filter((c) => c.retrieval?.some((r) => r.unstable) ?? false).length;

  return {
    repeatAfterDefinitiveError,
    schemaRefusals,
    insistenceGroups,
    badCalls: repeatAfterDefinitiveError + schemaRefusals + insistenceGroups,
    unstableResults,
    calls: calls.length,
    errors: calls.filter((c) => c.isError).length,
    steps,
    answerCorrect: null,
  };
}

// ---------------------------------------------------------------------------
// Gabarito mecânico na resposta final
// ---------------------------------------------------------------------------

/** Números na resposta, aceitando `1.234,56` (pt-BR) e `1234.56`. */
export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:[.,]\d+)?/g)) {
    let s = m[0];
    if (/\.\d{3}(,|$)/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(",", ".");
    const n = Number(s);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function checkAnswer(answer: Answer | undefined, finalAnswer: string): 0 | 1 | null {
  if (!answer) return null;
  if (answer.kind === "number") {
    const tol = answer.tolerance ?? 0.005;
    const target = answer.value;
    const ok = extractNumbers(finalAnswer).some((n) =>
      target === 0 ? Math.abs(n) <= tol : Math.abs(n - target) / Math.abs(target) <= tol,
    );
    return ok ? 1 : 0;
  }
  if (answer.kind === "text") return normalize(finalAnswer).includes(normalize(answer.value)) ? 1 : 0;
  return new RegExp(answer.pattern, answer.flags ?? "i").test(finalAnswer) ? 1 : 0;
}

/** Resumo curto de um resultado para o NDJSON. */
export function summarize(text: string, isError: boolean): string {
  const compact = text.replace(/\s+/g, " ").trim().slice(0, 160);
  return isError ? `erro: ${compact}` : compact;
}
