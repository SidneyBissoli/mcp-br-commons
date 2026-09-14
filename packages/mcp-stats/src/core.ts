/**
 * Núcleo de estatísticas sobre um campo numérico de um conjunto de registros.
 *
 * Generalização do `src/utils/estatisticas.ts` do senado-br-mcp-cloudflare. O problema
 * que resolve: datasets buscados INTEIROS no servidor e depois filtrados/paginados —
 * o modelo só vê uma fatia e nunca poderia responder "qual o maior?"/"qual a média?".
 * Este módulo computa a distribuição completa NO SERVIDOR, antes do truncamento, e
 * devolve um bloco compacto (~15 números) + registros extremos — determinístico (o
 * servidor computa, não o LLM) e barato (o dado já está quente no cache).
 *
 * Recebe FUNÇÕES de acesso, não nomes de campo: o valor canônico costuma ser computado
 * (ex.: bruto = soma de 7 colunas) ou precisa de parsing (strings pt-BR → `parseBRL`).
 *
 * Convenções FIXADAS (herdadas do senado, decisão de 2026-07-07 — não alterar):
 *  - percentis: interpolação linear, type 7 (== numpy.percentile / Excel INC);
 *  - stdDev: desvio-padrão POPULACIONAL (÷n) — os datasets são censos, não amostras;
 *  - desempate de argMax/argMin/ranking: menor `tieBreak` vence (estável, determinístico);
 *  - grupos ordenados por soma decrescente; teto de grupos (default 50) com contagem
 *    do excedente (o texto de aviso é da camada de exibição).
 *
 * Números saem em precisão total; arredondar para exibição é papel de `display.ts`.
 */

/**
 * Motivo de uma estatística sair `null`. Mesmo desenho de `CorrelationUndefinedReason`
 * em `correlation.ts`: valor `null` + razão tipada, nunca um número de mentira.
 */
export type StatsUndefinedReason =
  /** Nenhum registro entrou no cálculo: não há distribuição a resumir. */
  | "no-records";

/**
 * `null` em qualquer percentil quando o conjunto é vazio. Percentil de conjunto
 * vazio não é zero — é indefinido, e zero é a única resposta errada que passa por
 * toda validação e chega ao leitor como medida (ver EMPTY_STATS).
 */
export interface Percentiles {
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
}

/** Registro extremo/rankeado: os campos de identificação escolhidos + seu `value`. */
export type StatEntry = Record<string, unknown> & { value: number };

export interface SummaryStats {
  /** Registros considerados. `0` é o único sinal que nunca mente. */
  n: number;
  /** Soma dos valores. Zero num conjunto vazio é a soma vazia, e é correto. */
  sum: number;
  /**
   * `null` quando `n === 0`: mínimo, máximo, média, mediana e desvio de um conjunto
   * vazio são INDEFINIDOS, não zero. Ver `reason`.
   */
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  stdDev: number | null;
  percentiles: Percentiles;
  argMax: StatEntry | null;
  argMin: StatEntry | null;
  top: StatEntry[];
  bottom: StatEntry[];
  /** Presente somente quando há estatística indefinida (hoje, só `n === 0`). */
  reason?: StatsUndefinedReason;
}

export interface GroupStats extends SummaryStats {
  group: string;
}

export interface GroupedStats {
  /** Total de grupos existentes (antes do teto). */
  totalGroups: number;
  /** Grupos retornados (<= maxGroups), ordenados por soma decrescente. */
  groups: GroupStats[];
}

export interface ComputeOptions<T> {
  /** Tamanho dos rankings `top`/`bottom` (default 0 = nenhum). */
  topN?: number;
  /** Campos a carregar em argMax/argMin/top/bottom (default: o registro inteiro). */
  identify?: (r: T) => Record<string, unknown>;
  /** Desempate estável: em valores iguais, o menor vence (default: ordem de entrada). */
  tieBreak?: (r: T) => number;
}

export interface GroupComputeOptions<T> extends ComputeOptions<T> {
  /** Máximo de grupos retornados (default 50); o excedente é cortado após a ordenação. */
  maxGroups?: number;
}

/** Par valor/desempate precomputado — acessores rodam uma vez por registro. */
interface Pair<T> {
  r: T;
  v: number;
  d: number;
}

export const DEFAULT_MAX_GROUPS = 50;

/**
 * Percentil por interpolação linear (type 7 / numpy / Excel PERCENTILE.INC). `q` em [0,1].
 * Conjunto vazio devolve `null` — não existe "o percentil 50 de nada", e devolver 0
 * fazia a camada de exibição escrever "metade dos valores é igual ou inferior a R$ 0,00".
 */
export function percentile(sortedAsc: number[], q: number): number | null {
  const n = sortedAsc.length;
  if (n === 0) return null;
  if (n === 1) return sortedAsc[0]!;
  const h = (n - 1) * q;
  const lo = Math.floor(h);
  const frac = h - lo;
  if (lo + 1 >= n) return sortedAsc[n - 1]!;
  return sortedAsc[lo]! + frac * (sortedAsc[lo + 1]! - sortedAsc[lo]!);
}

function entryOf<T>(pair: Pair<T>, identify?: (r: T) => Record<string, unknown>): StatEntry {
  const base = identify ? identify(pair.r) : (pair.r as Record<string, unknown>);
  return { ...base, value: pair.v };
}

/**
 * Conjunto vazio. Até 0.2.0 este bloco saía com ZERO em todo campo, e era a origem
 * de um defeito medido em produção no senado-br-mcp em 14/09/2026: uma consulta com
 * filtro que não casava nenhum registro (ano válido, nome de senador inexistente)
 * respondia `mediana: 0` e a camada de exibição a narrava por extenso — "mediana —
 * metade dos valores é igual ou inferior a R$ 0,00" — com bloco de proveniência
 * completo. O modelo que lê isso afirma ao leitor um valor que ninguém mediu.
 *
 * Zero é a resposta errada mais perigosa que existe aqui: atravessa qualquer
 * validação de tipo, tem cara de medida e não deixa rastro. `null` obriga quem
 * consome a decidir o que dizer, e `reason` diz por quê. `n` e `sum` continuam
 * numéricos: zero registros é um fato, e a soma vazia é zero por definição.
 */
const EMPTY_STATS: SummaryStats = {
  n: 0, sum: 0, min: null, max: null, mean: null, median: null, stdDev: null,
  percentiles: { p25: null, p50: null, p75: null, p90: null, p95: null, p99: null },
  argMax: null, argMin: null, top: [], bottom: [], reason: "no-records",
};

function compute<T>(pairs: Pair<T>[], topN: number, identify?: (r: T) => Record<string, unknown>): SummaryStats {
  const n = pairs.length;
  if (n === 0) return { ...EMPTY_STATS, percentiles: { ...EMPTY_STATS.percentiles }, top: [], bottom: [] };

  let sum = 0;
  let argMax = pairs[0]!;
  let argMin = pairs[0]!;
  for (const p of pairs) {
    sum += p.v;
    // Desempate: em valor igual, o menor `d` vence (estável, determinístico).
    if (p.v > argMax.v || (p.v === argMax.v && p.d < argMax.d)) argMax = p;
    if (p.v < argMin.v || (p.v === argMin.v && p.d < argMin.d)) argMin = p;
  }
  const mean = sum / n;

  let sumSq = 0;
  for (const p of pairs) {
    const dv = p.v - mean;
    sumSq += dv * dv;
  }
  const stdDev = Math.sqrt(sumSq / n); // populacional (censo, não amostra)

  const asc = pairs.map((p) => p.v).sort((a, b) => a - b);

  let top: StatEntry[] = [];
  let bottom: StatEntry[] = [];
  if (topN > 0) {
    const byValueDesc = [...pairs].sort((a, b) => b.v - a.v || a.d - b.d);
    const byValueAsc = [...pairs].sort((a, b) => a.v - b.v || a.d - b.d);
    top = byValueDesc.slice(0, topN).map((p) => entryOf(p, identify));
    bottom = byValueAsc.slice(0, topN).map((p) => entryOf(p, identify));
  }

  return {
    n,
    sum,
    min: asc[0]!,
    max: asc[n - 1]!,
    mean,
    median: percentile(asc, 0.5),
    stdDev,
    percentiles: {
      p25: percentile(asc, 0.25),
      p50: percentile(asc, 0.5),
      p75: percentile(asc, 0.75),
      p90: percentile(asc, 0.9),
      p95: percentile(asc, 0.95),
      p99: percentile(asc, 0.99),
    },
    argMax: entryOf(argMax, identify),
    argMin: entryOf(argMin, identify),
    top,
    bottom,
  };
}

function toPairs<T>(records: T[], valueOf: (r: T) => number, tieBreak?: (r: T) => number): Pair<T>[] {
  return records.map((r) => ({ r, v: valueOf(r), d: tieBreak ? tieBreak(r) : 0 }));
}

/** Estatísticas do conjunto inteiro, lendo o valor de cada registro via `valueOf`. */
export function computeStats<T>(
  records: T[],
  valueOf: (r: T) => number,
  options: ComputeOptions<T> = {},
): SummaryStats {
  const { topN = 0, identify, tieBreak } = options;
  return compute(toPairs(records, valueOf, tieBreak), topN, identify);
}

/** Estatísticas por grupo (`groupBy` extrai a chave), ordenadas por soma decrescente. */
export function computeGroupedStats<T>(
  records: T[],
  valueOf: (r: T) => number,
  groupBy: (r: T) => string,
  options: GroupComputeOptions<T> = {},
): GroupedStats {
  const { topN = 0, maxGroups = DEFAULT_MAX_GROUPS, identify, tieBreak } = options;
  const pairs = toPairs(records, valueOf, tieBreak);

  const byGroup = new Map<string, Pair<T>[]>();
  for (const p of pairs) {
    const k = groupBy(p.r);
    const bucket = byGroup.get(k);
    if (bucket) bucket.push(p);
    else byGroup.set(k, [p]);
  }

  const all: GroupStats[] = Array.from(byGroup.entries())
    .map(([group, ps]) => ({ group, ...compute(ps, topN, identify) }))
    .sort((a, b) => b.sum - a.sum); // grupo de maior total primeiro

  return { totalGroups: all.length, groups: all.slice(0, maxGroups) };
}
