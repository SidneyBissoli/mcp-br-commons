/**
 * O que o modelo vê em cada braço.
 *
 * O `tool_result` leva SÓ `content[].text` — é o que qualquer cliente MCP mostra ao
 * modelo. `structuredContent`, `_meta` e `outputSchema` não chegam lá, então o
 * filtro não os toca. Braço A entrega o texto como saiu do servidor. Braço B faz
 * `JSON.parse`, apaga `provenance.retrieval` (objeto OU array — multi-fonte) e
 * re-serializa NO MESMO FORMATO (pretty com 2 espaços se o original era pretty,
 * compacto se era compacto), para que a única diferença entre os braços seja o
 * campo sob teste, não o tamanho ou a forma do JSON.
 *
 * Texto que não é JSON (erros em pt-BR, avisos) passa intacto nos dois braços.
 */

import type { RetrievalView } from "./types.js";

interface ProvenanceLike {
  retrieval?: unknown;
  [k: string]: unknown;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function looksPretty(text: string): boolean {
  // O `structuredResult` dos servidores usa JSON.stringify(payload, null, 2): a
  // primeira quebra de linha vem logo depois do `{`/`[` de abertura.
  return /^[\[{]\r?\n\s+/.test(text);
}

/** Lê o(s) bloco(s) `retrieval` de um texto de resultado (antes de qualquer filtro). */
export function readRetrieval(text: string): RetrievalView[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(parsed)) return null;
  const prov = parsed.provenance;
  const blocks = Array.isArray(prov) ? prov : prov !== undefined ? [prov] : [];
  const out: RetrievalView[] = [];
  for (const b of blocks) {
    if (!isObject(b)) continue;
    const r = (b as ProvenanceLike).retrieval;
    if (!isObject(r)) continue;
    out.push({
      requests: Number(r.requests ?? 0),
      attempts: Number(r.attempts ?? 0),
      anomalies: Array.isArray(r.anomalies)
        ? (r.anomalies as { kind?: unknown; count?: unknown }[]).map((a) => ({
            kind: String(a.kind ?? "?"),
            count: Number(a.count ?? 0),
          }))
        : [],
      unstable: r.unstable === true,
    });
  }
  return out.length > 0 ? out : null;
}

/**
 * Braço B: remove `provenance.retrieval` (objeto ou array de blocos). Devolve o
 * texto original quando não há JSON, não há `provenance` ou não há `retrieval`.
 */
export function stripRetrieval(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (!isObject(parsed) || parsed.provenance === undefined) return text;

  const prov = parsed.provenance;
  let touched = false;
  const strip = (b: unknown): unknown => {
    if (!isObject(b) || !("retrieval" in b)) return b;
    touched = true;
    const { retrieval: _dropped, ...rest } = b as ProvenanceLike;
    return rest;
  };
  const next = Array.isArray(prov) ? prov.map(strip) : strip(prov);
  if (!touched) return text;

  const out = { ...parsed, provenance: next };
  return looksPretty(text) ? JSON.stringify(out, null, 2) : JSON.stringify(out);
}

/** Aplica o filtro do braço pedido. */
export function applyArm(arm: "A" | "B", text: string): string {
  return arm === "B" ? stripRetrieval(text) : text;
}
