/**
 * Rodapé de fonte — o canal para clientes que só renderizam texto.
 *
 * Formato (uma dupla de linhas por fonte, respeitando a segregação por licença):
 *
 *   ---
 *   Fonte: {nome} · {url} · dados de {vintage} · extraído em {timestamp humano}
 *   Licença: {licença}.
 *   A referência completa desta informação pode ser solicitada nesta própria conversa.
 *
 * O aviso final (requestNotice) aparece UMA vez, apenas no modo `concise` — no modo
 * `detailed` a referência completa já está na própria resposta, e o aviso seria ruído.
 */

import type { LocaleSpec } from "./locale.js";
import type { ProvenanceMode } from "./render.js";
import { conciseLicense } from "./render.js";
import type { CanonicalProvenance } from "./schema.js";

export function provenanceFooter(
  blocks: CanonicalProvenance[],
  opts: { locale: LocaleSpec; tzLabel: string; mode: ProvenanceMode },
): string {
  const { locale, tzLabel, mode } = opts;
  const lines: string[] = ["---"];
  for (const p of blocks) {
    const parts = [`${locale.sourceLabel}: ${p.source.name}`, p.source_url];
    if (p.data_vintage) parts.push(`${locale.vintagePrefix} ${p.data_vintage}`);
    parts.push(`${locale.retrievedPrefix} ${locale.formatTimestamp(p.retrieved_at, tzLabel)}`);
    lines.push(parts.join(" · "));
    const license = conciseLicense(p.license);
    if (license) lines.push(`${locale.licenseLabel}: ${license.endsWith(".") ? license : `${license}.`}`);
  }
  if (mode === "concise") lines.push(locale.requestNotice);
  return lines.join("\n");
}
