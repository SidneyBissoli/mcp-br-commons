/**
 * Princípio de linguagem (decisão 5 da Fase 0): o rodapé fala com o LEITOR, o schema
 * fala com o agente. O aviso no corpo da resposta é em linguagem simples, registro
 * formal/institucional (público: pesquisadores, jornalistas, órgãos públicos), no
 * idioma do servidor, sem jargão técnico ("proveniência", "response_format", inglês
 * voltado ao usuário final) e sem coloquialidade. O aviso deixa explícito que a
 * referência completa se solicita AQUI MESMO, na conversa — não em portal, e-mail ou
 * outro canal.
 *
 * A redação pt-BR do aviso é a fixada na decisão 5; não alterar sem decisão nova.
 */

import type { Retrieval, RetrievalAnomalyKind } from "./schema.js";

export interface LocaleSpec {
  id: string;
  /** "Fonte" / "Source" */
  sourceLabel: string;
  /** Prefixo do vintage: "dados de" / "data as of" */
  vintagePrefix: string;
  /** Prefixo da extração: "extraído em" / "retrieved on" */
  retrievedPrefix: string;
  /** "Licença" / "License" */
  licenseLabel: string;
  /** Aviso ao leitor de que a referência completa pode ser pedida na própria conversa. */
  requestNotice: string;
  /** Versão humana de um timestamp canônico ISO-8601 (datas puras sem hora). */
  formatTimestamp(iso: string, tzLabel: string): string;
  /**
   * Frase ao leitor quando a obtenção foi INSTÁVEL (v1.1) — só é chamada com
   * `retrieval.unstable === true`. Opcional: LocaleSpec customizado sem ela não emite a
   * linha. Sem jargão: "tentativas", "consultas à origem", nunca "retry"/"4xx".
   */
  retrievalNotice?(r: Retrieval): string;
  /**
   * Frases ao leitor das exceções da v1.3 — só chamadas quando há a exceção: dado
   * preliminar (`revision.status === "provisional"`), valor calculado pelo servidor
   * (`derived`) e avisos da fonte (`notices` não vazio). O caso comum não ganha linha.
   * Opcionais, como `retrievalNotice`. Notas e avisos entram verbatim.
   */
  provisionalNotice?(note: string | null): string;
  derivedNotice?(note: string): string;
  sourceNotices?(notices: string[]): string;
}

/** Fecha a frase com ponto, sem duplicar a pontuação que o texto já traz. */
function sentence(text: string): string {
  const t = text.trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

/**
 * Frase nova: só SOBE a inicial (rebaixar estragaria sigla — "IPCA" viraria "iPCA").
 * Para texto que vem depois de dois-pontos, usar `sentence`, que não mexe na caixa.
 */
function newSentence(text: string): string {
  const t = sentence(text);
  return t.charAt(0).toLocaleUpperCase() + t.slice(1);
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/;

/** Nomes das classes de anomalia para o leitor, por idioma (singular/plural). */
const ANOMALY_PT: Record<RetrievalAnomalyKind, [string, string]> = {
  timeout: ["tempo de resposta esgotado", "tempos de resposta esgotados"],
  network: ["falha de rede", "falhas de rede"],
  http_4xx: ["recusa da origem", "recusas da origem"],
  http_5xx: ["erro da origem", "erros da origem"],
  rate_limited: ["limite de consultas atingido", "limites de consultas atingidos"],
  malformed_body: ["resposta malformada", "respostas malformadas"],
};

const ANOMALY_EN: Record<RetrievalAnomalyKind, [string, string]> = {
  timeout: ["timeout", "timeouts"],
  network: ["network failure", "network failures"],
  http_4xx: ["refusal by the source", "refusals by the source"],
  http_5xx: ["error at the source", "errors at the source"],
  rate_limited: ["rate limit reached", "rate limits reached"],
  malformed_body: ["malformed response", "malformed responses"],
};

function listAnomalies(r: Retrieval, names: Record<RetrievalAnomalyKind, [string, string]>): string {
  return r.anomalies.map((a) => `${a.count} ${names[a.kind][a.count === 1 ? 0 : 1]}`).join(", ");
}

export const ptBR: LocaleSpec = {
  id: "pt-BR",
  sourceLabel: "Fonte",
  vintagePrefix: "dados de",
  retrievedPrefix: "extraído em",
  licenseLabel: "Licença",
  requestNotice: "A referência completa desta informação pode ser solicitada nesta própria conversa.",
  formatTimestamp(iso, tzLabel) {
    const m = iso.match(ISO_RE);
    if (!m) return iso;
    const [, y, mo, d, hh, mm] = m;
    return hh !== undefined ? `${d}/${mo}/${y} às ${hh}:${mm} (${tzLabel})` : `${d}/${mo}/${y}`;
  },
  retrievalNotice(r) {
    const head = `Obtenção instável: ${r.attempts} ${r.attempts === 1 ? "tentativa" : "tentativas"} para ${r.requests} ${r.requests === 1 ? "consulta" : "consultas"} à origem`;
    return r.anomalies.length > 0 ? `${head} (${listAnomalies(r, ANOMALY_PT)}).` : `${head}.`;
  },
  provisionalNotice(note) {
    const head = "Dados preliminares: a fonte ainda pode completá-los ou corrigi-los.";
    return note ? `${head} ${newSentence(note)}` : head;
  },
  derivedNotice(note) {
    return `Valores calculados pelo servidor a partir dos dados da fonte: ${sentence(note)}`;
  },
  sourceNotices(notices) {
    return `Avisos da fonte: ${sentence(notices.map((n) => n.trim()).join("; "))}`;
  },
};

export const en: LocaleSpec = {
  id: "en",
  sourceLabel: "Source",
  vintagePrefix: "data as of",
  retrievedPrefix: "retrieved on",
  licenseLabel: "License",
  requestNotice: "The complete reference for this information can be requested here, in this same conversation.",
  formatTimestamp(iso, tzLabel) {
    const m = iso.match(ISO_RE);
    if (!m) return iso;
    const [, y, mo, d, hh, mm] = m;
    return hh !== undefined ? `${y}-${mo}-${d}, ${hh}:${mm} (${tzLabel})` : `${y}-${mo}-${d}`;
  },
  retrievalNotice(r) {
    const head = `Unstable retrieval: ${r.attempts} ${r.attempts === 1 ? "attempt" : "attempts"} for ${r.requests} ${r.requests === 1 ? "request" : "requests"} to the source`;
    return r.anomalies.length > 0 ? `${head} (${listAnomalies(r, ANOMALY_EN)}).` : `${head}.`;
  },
  provisionalNotice(note) {
    const head = "Preliminary data: the source may still complete or correct it.";
    return note ? `${head} ${newSentence(note)}` : head;
  },
  derivedNotice(note) {
    return `Values computed by the server from the source data: ${sentence(note)}`;
  },
  sourceNotices(notices) {
    return `Notices from the source: ${sentence(notices.map((n) => n.trim()).join("; "))}`;
  },
};

export const locales: Record<string, LocaleSpec> = { "pt-BR": ptBR, en };

/** Resolve um id de locale embutido ou aceita um LocaleSpec customizado. */
export function resolveLocale(locale: string | LocaleSpec): LocaleSpec {
  if (typeof locale !== "string") return locale;
  const found = locales[locale];
  if (!found) {
    throw new Error(`Locale desconhecido: "${locale}" (embutidos: ${Object.keys(locales).join(", ")}); passe um LocaleSpec customizado`);
  }
  return found;
}
