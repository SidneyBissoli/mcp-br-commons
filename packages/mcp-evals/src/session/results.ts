/**
 * Gravação NDJSON com resume.
 *
 * Um arquivo por (data, sha, braço, nível de falha):
 *   `results/AAAA-MM-DD_<sha>_<braço>_<falha>.ndjson` + `.resumo.json`.
 * Uma linha por (tarefa, execução, modelo). O runner faz APPEND — uma sessão que
 * caiu por infra pode ser refeita, e a linha mais recente vence (`dedupe`). Resume:
 * chave (tarefa|braço|falha|run|modelo) concluída SEM `infraError` não roda de novo.
 *
 * Tudo é I/O puro de arquivo; a lógica de chave e dedupe é testável sem disco.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionRecord } from "./types.js";

export function sessionKey(r: Pick<SessionRecord, "taskId" | "arm" | "fault" | "run" | "model">): string {
  return `${r.taskId}|${r.arm}|${r.fault}|${r.run}|${r.model}`;
}

export function resultsFileName(date: string, sha: string | null, arm: string, fault: string): string {
  return `${date}_${sha ?? "nosha"}_${arm}_${fault}.ndjson`;
}

/** Lê um NDJSON tolerando linha final rasgada. */
export function parseNdjson<T>(text: string, warn: (line: string) => void = () => {}): T[] {
  const out: T[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    try {
      out.push(JSON.parse(raw) as T);
    } catch {
      warn("linha NDJSON ilegível ignorada");
    }
  }
  return out;
}

/** Última linha por chave (ordem: primeira ocorrência de cada chave). */
export function dedupe(records: SessionRecord[]): SessionRecord[] {
  const byKey = new Map<string, SessionRecord>();
  for (const r of records) byKey.set(sessionKey(r), r);
  return [...byKey.values()];
}

/** Chaves concluídas sem dropout (para o resume). Uma refeita com falha REABRE a chave. */
export function completedKeys(records: SessionRecord[]): Set<string> {
  const done = new Set<string>();
  for (const r of records) {
    const k = sessionKey(r);
    if (r.infraError === undefined) done.add(k);
    else done.delete(k);
  }
  return done;
}

export class ResultsStore {
  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  pathFor(name: string): string {
    return join(this.dir, name);
  }

  load(name: string): SessionRecord[] {
    const p = this.pathFor(name);
    if (!existsSync(p)) return [];
    return parseNdjson<SessionRecord>(readFileSync(p, "utf8"), (l) => console.warn(`${l} (${name})`));
  }

  append(name: string, record: SessionRecord): void {
    appendFileSync(this.pathFor(name), `${JSON.stringify(record)}\n`, "utf8");
  }

  writeSummary(name: string, summary: unknown): void {
    writeFileSync(this.pathFor(name.replace(/\.ndjson$/, ".resumo.json")), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }

  /** Todos os NDJSON do diretório (para o relatório), já deduplicados por chave. */
  loadAll(): SessionRecord[] {
    if (!existsSync(this.dir)) return [];
    const all: SessionRecord[] = [];
    for (const f of readdirSync(this.dir).filter((f) => f.endsWith(".ndjson")).sort()) all.push(...this.load(f));
    return dedupe(all);
  }
}
