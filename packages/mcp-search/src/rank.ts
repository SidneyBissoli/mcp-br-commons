/**
 * Índice de busca em memória com ranking simples e determinístico.
 *
 * O acervo de um servidor do portfólio é pequeno (milhares de tabelas,
 * municípios, séries) e cabe inteiro na memória; o que a busca precisa é ser
 * previsível, não sofisticada:
 *
 *  - normalização: NFD sem diacríticos, caixa baixa, espaços colapsados —
 *    "População" e "populacao" são a mesma coisa;
 *  - tokens: sequências de [a-z0-9] com 2+ caracteres, sem as stopwords do
 *    pt-BR (senão "de" pontuaria em quase todo título);
 *  - pontuação por token da consulta: casamento exato no `id` vale mais que
 *    tudo (quem digita "6579" quer a tabela 6579), depois título, palavras-chave
 *    e texto, nessa ordem; prefixo (consulta "popul", campo "populacao") vale
 *    metade;
 *  - cobertura pesa mais que repetição: cada token DISTINTO da consulta que
 *    casou soma um bônus fixo, para uma entrada que casa dois termos
 *    fracamente vencer uma que casa um termo várias vezes;
 *  - a frase inteira contida no título ganha bônus;
 *  - desempate estável pela ordem de inserção (o chamador controla a ordem
 *    do acervo — catálogo oficial primeiro, p.ex.).
 *
 * Entrada sem nenhum token casado fica fora; consulta vazia devolve lista
 * vazia (o contrato admite `results: []`).
 */

import type { SearchResult } from "./contract.js";

/** Um documento do acervo: o resultado do contrato mais os campos que só servem para ranquear. */
export interface IndexEntry extends SearchResult {
  /** Sinônimos, siglas, códigos alternativos — contam quase como título. */
  keywords?: readonly string[];
  /** Descrição longa — peso menor. */
  text?: string;
}

export interface SearchOptions {
  /** Máximo de resultados (padrão 10). */
  limit?: number;
}

export interface SearchIndex {
  /** Quantidade de documentos indexados. */
  readonly size: number;
  search(query: string, options?: SearchOptions): SearchResult[];
}

/** Pesos por campo, por token casado (exato; prefixo vale metade). */
const WEIGHTS = { id: 10, title: 3, keywords: 2, text: 1 } as const;
/** Bônus por token DISTINTO da consulta que casou em algum campo. */
const COVERAGE_BONUS = 10;
/** Bônus quando o título contém a consulta inteira, na ordem. */
const PHRASE_BONUS = 5;
/** Comprimento mínimo de um token da consulta para casar por prefixo. */
const PREFIX_MIN = 3;
export const DEFAULT_LIMIT = 10;

const STOPWORDS = new Set([
  "a", "o", "as", "os", "um", "uma", "uns", "umas",
  "de", "da", "do", "das", "dos", "e", "em", "no", "na", "nos", "nas",
  "ao", "aos", "por", "para", "com", "sem", "que", "ou",
  "the", "of", "in", "and", "for", "by",
]);

/** Sem diacríticos, caixa baixa, espaços colapsados. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokens distintos de [a-z0-9]{2,}, sem stopwords, na ordem de aparição. */
export function tokenize(value: string): string[] {
  const seen = new Set<string>();
  for (const token of normalizeText(value).split(/[^a-z0-9]+/)) {
    if (token.length >= 2 && !STOPWORDS.has(token)) seen.add(token);
  }
  return [...seen];
}

interface IndexedEntry {
  readonly entry: IndexEntry;
  readonly order: number;
  readonly idNorm: string;
  readonly idTokens: readonly string[];
  readonly titleNorm: string;
  readonly titleTokens: readonly string[];
  readonly keywordTokens: readonly string[];
  readonly textTokens: readonly string[];
}

function indexEntry(entry: IndexEntry, order: number): IndexedEntry {
  return {
    entry,
    order,
    idNorm: normalizeText(entry.id),
    idTokens: tokenize(entry.id),
    titleNorm: normalizeText(entry.title),
    titleTokens: tokenize(entry.title),
    keywordTokens: tokenize((entry.keywords ?? []).join(" ")),
    textTokens: tokenize(entry.text ?? ""),
  };
}

/** 1 = casamento exato, 0.5 = prefixo, 0 = nada. */
function fieldHit(fieldTokens: readonly string[], token: string): number {
  let best = 0;
  for (const candidate of fieldTokens) {
    if (candidate === token) return 1;
    if (token.length >= PREFIX_MIN && candidate.startsWith(token)) best = 0.5;
  }
  return best;
}

function score(indexed: IndexedEntry, queryNorm: string, queryTokens: readonly string[]): number {
  let total = 0;
  let covered = 0;
  for (const token of queryTokens) {
    const id = indexed.idNorm === token ? 1 : fieldHit(indexed.idTokens, token);
    const title = fieldHit(indexed.titleTokens, token);
    const keywords = fieldHit(indexed.keywordTokens, token);
    const text = fieldHit(indexed.textTokens, token);
    const partial =
      id * WEIGHTS.id + title * WEIGHTS.title + keywords * WEIGHTS.keywords + text * WEIGHTS.text;
    if (partial > 0) {
      covered += 1;
      total += partial;
    }
  }
  if (covered === 0) return 0;
  total += covered * COVERAGE_BONUS;
  if (queryNorm.length >= PREFIX_MIN && indexed.titleNorm.includes(queryNorm)) total += PHRASE_BONUS;
  return total;
}

/** Só os três campos do contrato saem para o cliente. */
function toResult(entry: IndexEntry): SearchResult {
  return { id: entry.id, title: entry.title, url: entry.url };
}

/**
 * Indexa o acervo uma vez (tokens por campo pré-computados) e devolve o
 * buscador. Chame de novo quando o acervo mudar — o índice é imutável.
 */
export function createIndex(entries: readonly IndexEntry[]): SearchIndex {
  const indexed = entries.map((entry, order) => indexEntry(entry, order));
  return {
    size: indexed.length,
    search(query, options) {
      const limit = Math.max(0, Math.floor(options?.limit ?? DEFAULT_LIMIT));
      const queryNorm = normalizeText(query);
      const queryTokens = tokenize(query);
      if (limit === 0 || queryTokens.length === 0) return [];

      const scored: Array<{ score: number; item: IndexedEntry }> = [];
      for (const item of indexed) {
        const s = score(item, queryNorm, queryTokens);
        if (s > 0) scored.push({ score: s, item });
      }
      scored.sort((a, b) => b.score - a.score || a.item.order - b.item.order);
      return scored.slice(0, limit).map(({ item }) => toResult(item.entry));
    },
  };
}

/** Conveniência para acervos pequenos ou efêmeros: indexa e busca de uma vez. */
export function rankEntries(
  entries: readonly IndexEntry[],
  query: string,
  options?: SearchOptions
): SearchResult[] {
  return createIndex(entries).search(query, options);
}
