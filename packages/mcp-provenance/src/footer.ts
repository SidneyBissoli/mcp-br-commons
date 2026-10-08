/**
 * Rodapé de fonte — o canal para clientes que só renderizam texto.
 *
 * Formato (uma dupla de linhas por fonte, respeitando a segregação por licença):
 *
 *   ---
 *   Fonte: {nome} · {url} · dados de {vintage} · extraído em {timestamp humano}
 *   Licença: {licença}.
 *   Obtenção instável: {tentativas} para {consultas} à origem ({anomalias}).   ← só se unstable
 *   Dados preliminares: … {nota}                                ← v1.3, só se provisional
 *   Valores calculados pelo servidor a partir dos dados da fonte: {nota}   ← v1.3, só se derived
 *   Avisos da fonte: {aviso}; {aviso}.                            ← v1.3, só se há aviso
 *   A referência completa desta informação pode ser solicitada nesta própria conversa.
 *
 * A linha de obtenção (retrievalNotice, v1.1) só entra quando `retrieval.unstable` é
 * true — obtenção limpa não vira ruído para o leitor; o agente já tem o bloco. As três
 * da v1.3 seguem a mesma regra: só a exceção ganha linha, e só quando o bloco é 1.3 ou
 * mais novo, para o rodapé de quem emite 1.1/1.2 seguir byte-idêntico. Existem porque
 * em muitos clientes o modelo lê só o texto: sem a linha, ele nunca saberia que o ano é
 * preliminar ou que a série tem quebra.
 * O aviso final (requestNotice) aparece UMA vez, apenas no modo `concise` — no modo
 * `detailed` a referência completa já está na própria resposta, e o aviso seria ruído.
 */

import type { LocaleSpec } from "./locale.js";
import type { ProvenanceMode } from "./render.js";
import { conciseLicense } from "./render.js";
import { contractAtLeast, type CanonicalProvenance } from "./schema.js";

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
    if (p.retrieval?.unstable && locale.retrievalNotice) lines.push(locale.retrievalNotice(p.retrieval));
    if (contractAtLeast(p.contract_version, "1.3")) {
      if (p.revision?.status === "provisional" && locale.provisionalNotice) {
        lines.push(locale.provisionalNotice(p.revision.note));
      }
      if (p.derived && p.derivation_note && locale.derivedNotice) lines.push(locale.derivedNotice(p.derivation_note));
      if (p.notices.length > 0 && locale.sourceNotices) lines.push(locale.sourceNotices(p.notices));
    }
  }
  if (mode === "concise") lines.push(locale.requestNotice);
  return lines.join("\n");
}
