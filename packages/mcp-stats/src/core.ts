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

export interface Percentiles {
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
}

/** Registro extremo/rankeado: os campos de identificação escolhidos + seu `value`. */
export type StatEntry = Record<string, unknown> & { value: number };

export interface SummaryStats {
  n: number;
  sum: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  stdDev: number;
  percentiles: Percentiles;
  argMax: StatEntry | null;
  argMin: StatEntry | null;
  top: StatEntry[];
  bottom: StatEntry[];
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

/** Percentil por interpolação linear (type 7 / numpy / Excel PERCENTILE.INC). `q` em [0,1]. */
export function percentile(sortedAsc: number[], q: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
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

const EMPTY_STATS: SummaryStats = {
  n: 0, sum: 0, min: 0, max: 0, mean: 0, median: 0, stdDev: 0,
  percentiles: { p25: 0, p50: 0, p75: 0, p90: 0, p95: 0, p99: 0 },
  argMax: null, argMin: null, top: [], bottom: [],
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
