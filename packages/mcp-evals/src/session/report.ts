/**
 * Relatório Markdown gerado dos NDJSON — nunca transcrito à mão.
 *
 * Tabela braço × nível de falha × métrica, com média e desvio-padrão sobre as
 * sessões concluídas (dropout de infra e teto de gasto saem da agregação e são
 * contados à parte). Depois, a quebra por tarefa. Formatação pura: recebe records,
 * devolve linhas.
 */

import type { SessionRecord } from "./types.js";

export interface Stat {
  n: number;
  mean: number;
  sd: number;
}

export function stat(values: number[]): Stat {
  const n = values.length;
  if (n === 0) return { n: 0, mean: NaN, sd: NaN };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  return { n, mean, sd };
}

function fmt(s: Stat, digits = 2): string {
  if (s.n === 0) return "—";
  return s.n > 1 ? `${s.mean.toFixed(digits)} ± ${s.sd.toFixed(digits)}` : s.mean.toFixed(digits);
}

function rate(values: (0 | 1 | null | undefined)[]): string {
  const v = values.filter((x): x is 0 | 1 => x === 0 || x === 1);
  if (v.length === 0) return "—";
  return `${((v.reduce<number>((a, b) => a + b, 0) / v.length) * 100).toFixed(0)}% (n=${v.length})`;
}

export interface GroupSummary {
  arm: string;
  fault: string;
  model: string;
  completed: number;
  dropouts: number;
  budgetStops: number;
  badCalls: Stat;
  repeat: Stat;
  schema: Stat;
  insistence: Stat;
  calls: Stat;
  steps: Stat;
  unstable: Stat;
  costUSD: Stat;
  answerRate: string;
  judgeRate: string;
}

export function summarizeGroups(records: SessionRecord[]): GroupSummary[] {
  const groups = new Map<string, SessionRecord[]>();
  for (const r of records) {
    const k = `${r.model}|${r.fault}|${r.arm}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: GroupSummary[] = [];
  for (const [k, rs] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [model, fault, arm] = k.split("|") as [string, string, string];
    const ok = rs.filter((r) => r.infraError === undefined);
    out.push({
      arm,
      fault,
      model,
      completed: ok.length,
      dropouts: rs.filter((r) => r.endedBy === "infra" || r.endedBy === "refusal").length,
      budgetStops: rs.filter((r) => r.endedBy === "budget").length,
      badCalls: stat(ok.map((r) => r.metrics.badCalls)),
      repeat: stat(ok.map((r) => r.metrics.repeatAfterDefinitiveError)),
      schema: stat(ok.map((r) => r.metrics.schemaRefusals)),
      insistence: stat(ok.map((r) => r.metrics.insistenceGroups)),
      calls: stat(ok.map((r) => r.metrics.calls)),
      steps: stat(ok.map((r) => r.metrics.steps)),
      unstable: stat(ok.map((r) => r.metrics.unstableResults)),
      costUSD: stat(ok.map((r) => r.costUSD)),
      answerRate: rate(ok.map((r) => r.metrics.answerCorrect)),
      judgeRate: rate(ok.map((r) => r.unstableCitedAsCertain)),
    });
  }
  return out;
}

export function renderReport(records: SessionRecord[], title = "Sessão longa — retrieval A/B"): string[] {
  const lines: string[] = [];
  const server = records[0]?.server ?? "?";
  const shas = [...new Set(records.map((r) => r.serverSha ?? "nosha"))].join(", ");
  lines.push(`# ${title} — ${server}`, "");
  lines.push(`Gerado em ${new Date().toISOString()} de ${records.length} sessões (sha ${shas}).`, "");
  lines.push(
    "Braço A recebe `provenance.retrieval` como o servidor emite; braço B recebe o mesmo texto sem o campo. " +
      "Métricas mecânicas por trace: (a) repetição da mesma chamada após erro definitivo, (b) recusa de esquema, " +
      "(c) insistência (≥3 chamadas na mesma chave, todas com erro). `ruins` = a+b+c. `M-juiz` = citou valor de " +
      "resultado instável sem ressalva (só onde houve instável). Média ± desvio sobre sessões concluídas; " +
      "dropout de infra e teto de gasto ficam fora da agregação.",
    "",
  );
  lines.push("## Braço × nível de falha", "");
  lines.push(
    "| modelo | falha | braço | sessões | dropout | teto | ruins/tarefa | (a) repetição | (b) esquema | (c) insistência | chamadas | passos | instáveis | gabarito | M-juiz | US$/sessão |",
  );
  lines.push("|---|---|---|---:|---:|---:|---|---|---|---|---|---|---|---|---|---|");
  for (const g of summarizeGroups(records)) {
    lines.push(
      `| ${g.model} | ${g.fault} | ${g.arm} | ${g.completed} | ${g.dropouts} | ${g.budgetStops} | **${fmt(g.badCalls)}** | ${fmt(g.repeat)} | ${fmt(g.schema)} | ${fmt(g.insistence)} | ${fmt(g.calls, 1)} | ${fmt(g.steps, 1)} | ${fmt(g.unstable, 1)} | ${g.answerRate} | ${g.judgeRate} | ${fmt(g.costUSD, 3)} |`,
    );
  }
  lines.push("");

  lines.push("## Por tarefa (chamadas ruins, média sobre execuções)", "");
  const tasks = [...new Set(records.map((r) => r.taskId))].sort();
  const cols = [...new Set(records.map((r) => `${r.fault}/${r.arm}`))].sort();
  lines.push(`| tarefa | ${cols.join(" | ")} |`);
  lines.push(`|---|${cols.map(() => "---").join("|")}|`);
  for (const t of tasks) {
    const cells = cols.map((c) => {
      const [fault, arm] = c.split("/") as [string, string];
      const rs = records.filter((r) => r.taskId === t && r.fault === fault && r.arm === arm && r.infraError === undefined);
      return fmt(stat(rs.map((r) => r.metrics.badCalls)), 1);
    });
    lines.push(`| ${t} | ${cells.join(" | ")} |`);
  }
  lines.push("");

  const dropped = records.filter((r) => r.infraError !== undefined);
  if (dropped.length > 0) {
    lines.push("## Fora da agregação", "");
    for (const r of dropped) lines.push(`- ${r.taskId}/${r.arm}/${r.fault}/run${r.run} (${r.endedBy}): ${r.infraError}`);
    lines.push("");
  }
  return lines;
}
