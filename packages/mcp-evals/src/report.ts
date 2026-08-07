/**
 * Formatação pura do relatório da rodada. Sem I/O — devolve linhas + código de saída,
 * para que o teste offline possa asserir o comportamento (cobertura incompleta, dicas
 * de remédio, gate PRELIMINAR) sem capturar console.
 */

import { aggregate, evaluateGate, type GateOptions, type GateResult, type ScoredItem, type ScoreReport } from "./score.js";
import { isFatalInfra, type ErrorKind } from "./retry.js";

/** Fixture que nunca chegou ao modelo — dropout de infra, NÃO escolha errada de tool. */
export interface FixtureError {
  id: string;
  kind: ErrorKind;
  status: number;
  message: string;
}

export interface FormattedReport {
  lines: string[];
  /**
   * 0 → toda fixture foi avaliada (a decisão de gate é autoritativa).
   * 2 → uma ou mais fixtures nunca chegaram ao modelo (dropout de infra); o gate sobre
   *     o subconjunto avaliado aparece marcado PRELIMINAR — fixtures não tentadas não
   *     podem ser pontuadas silenciosamente como erro de seleção.
   */
  exitCode: 0 | 2;
  /** Relatório agregado apenas sobre as fixtures que chegaram ao modelo. */
  report: ScoreReport;
  gate: GateResult;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/** Monta o relatório completo da rodada (cobertura, acurácias, erros, gate). */
export function formatReport(
  items: ScoredItem[],
  errors: FixtureError[],
  model: string,
  gateOptions: GateOptions = {},
): FormattedReport {
  // Só pontua as fixtures que de fato chegaram ao modelo — dropouts de infra ficam de
  // fora, para que rate-limit/billing não se disfarce de acurácia ruim de seleção.
  const erroredIds = new Set(errors.map((e) => e.id));
  const evaluated = items.filter((it) => !erroredIds.has(it.id));
  const report = aggregate(evaluated, 3);
  const complete = errors.length === 0;
  const lines: string[] = [];

  lines.push("");
  lines.push("=".repeat(64));
  lines.push(`  Eval de seleção de tool — modelo: ${model}`);
  lines.push("=".repeat(64));
  lines.push(
    `  Cobertura:          ${evaluated.length}/${items.length} fixtures avaliadas` +
      (complete ? "" : ` · ${errors.length} não avaliadas (falha de infra)`),
  );
  lines.push(`  Acurácia top-1:     ${pct(report.top1Accuracy)} (${report.top1Correct}/${report.total} avaliadas)`);
  lines.push(`  Acurácia top-2:     ${pct(report.topKAccuracy[2] ?? 0)}`);
  lines.push(`  Acurácia top-3:     ${pct(report.topKAccuracy[3] ?? 0)}`);
  lines.push("");
  lines.push("  Por área (acurácia top-1 entre as avaliadas, pior → melhor):");
  for (const a of report.byArea) {
    lines.push(`    ${a.area.padEnd(18)} ${pct(a.top1Accuracy).padStart(6)}  (${a.top1Correct}/${a.total})`);
  }

  const misses = evaluated.filter((it) => !it.top1);
  if (misses.length > 0) {
    lines.push("");
    lines.push("  Escolhas erradas (top-1 fora do esperado):");
    for (const m of misses) {
      const got = m.predictedTools[0] ?? "(nenhuma)";
      lines.push(`    [${m.id}] esperado ${JSON.stringify(m.expectedTools)} · obteve ${got}`);
    }
  }

  if (errors.length > 0) {
    const byKind = new Map<ErrorKind, number>();
    for (const e of errors) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
    const kindSummary = [...byKind.entries()].map(([k, n]) => `${k}×${n}`).join(", ");
    lines.push("");
    lines.push(`  ⚠ RODADA INCOMPLETA — ${errors.length} fixtures não avaliadas (${kindSummary}):`);
    for (const e of errors) {
      lines.push(`    [${e.id}] ${e.kind} (HTTP ${e.status})`);
    }
    const fatal = errors.find((e) => isFatalInfra(e.kind));
    lines.push("");
    if (fatal?.kind === "billing") {
      lines.push("    Causa fatal: saldo de créditos insuficiente. Reponha créditos em");
      lines.push("    https://console.anthropic.com/settings/billing e rode de novo.");
    } else if (fatal) {
      lines.push("    Causa fatal: chave rejeitada (auth). Verifique a ANTHROPIC_API_KEY e rode de novo.");
    } else {
      lines.push("    Dica: rate-limit. Rode com EVAL_CONCURRENCY=1 e/ou um modelo menor (EVAL_MODEL).");
    }
  }

  const gate = evaluateGate(report.top1Accuracy, gateOptions);
  lines.push("");
  lines.push("  Gate de seleção de tool:");
  if (complete) {
    lines.push(`    decisão: ${gate.decision}`);
    lines.push(`    ${gate.message}`);
  } else {
    lines.push(`    decisão: PRELIMINAR/${gate.decision} (rodada incompleta — NÃO usar para decisão)`);
    lines.push(`    ${gate.message}`);
    lines.push("    Complete a cobertura (100%) antes de tratar o gate como definitivo.");
  }
  lines.push("=".repeat(64));
  lines.push("");

  return { lines, exitCode: complete ? 0 : 2, report, gate };
}
