/**
 * Camada de exibição: transforma os números crus do núcleo no bloco que vai na
 * RESPOSTA da tool — arredondamento (default 2 casas: valores monetários), lista de
 * percentis auto-explicativa e chaves no idioma do servidor (`locale.ts`).
 *
 * Todas as tools de estatísticas de um servidor devem passar por aqui, para que a
 * redação fique idêntica em toda a superfície.
 */

import type { GroupedStats, Percentiles, StatEntry, SummaryStats } from "./core.js";
import { resolveStatsLocale, type StatsLocale } from "./locale.js";

export interface DisplayOptions {
  /** Idioma das chaves/rótulos. Default: "pt-BR". */
  locale?: string | StatsLocale;
  /** Formatador dos valores citados nos rótulos (default: o do locale). */
  formatValue?: (n: number) => string;
  /** Casas decimais do arredondamento de exibição (default 2). */
  decimals?: number;
}

interface Resolved {
  locale: StatsLocale;
  formatValue: (n: number) => string;
  round: (n: number) => number;
}

function resolve(opts: DisplayOptions = {}): Resolved {
  const locale = resolveStatsLocale(opts.locale ?? "pt-BR");
  const decimals = opts.decimals ?? 2;
  const factor = 10 ** decimals;
  return {
    locale,
    formatValue: opts.formatValue ?? locale.formatValue,
    round: (n: number) => Math.round(n * factor) / factor,
  };
}

const PERCENTILE_ORDER: ReadonlyArray<keyof Percentiles> = ["p25", "p50", "p75", "p90", "p95", "p99"];

/**
 * Converte o bloco cru `{p25..p99}` na lista rotulada auto-explicativa:
 * `[{ percentil|percentile, valor|value, rotulo|label }]` (chaves do locale).
 */
export function labeledPercentiles(p: Percentiles, opts: DisplayOptions = {}): Array<Record<string, unknown>> {
  const { locale, formatValue, round } = resolve(opts);
  const k = locale.keys;
  return PERCENTILE_ORDER.map((key) => {
    const pct = Number(key.slice(1));
    const value = round(p[key]);
    return {
      [k.percentile]: pct,
      [k.value]: value,
      [k.label]: locale.percentileLabel(pct, formatValue(value)),
    };
  });
}

/**
 * Bloco de distribuição pronto para resposta: arredondado, chaves do locale,
 * percentis rotulados (nunca `p25..p99` cru). Não inclui top/bottom/argMax —
 * ver `formatEntries` (a tool decide quais extremos expõe e com que rótulo).
 */
export function formatStats(e: SummaryStats, opts: DisplayOptions = {}): Record<string, unknown> {
  const { locale, round } = resolve(opts);
  const k = locale.keys;
  return {
    n: e.n,
    [k.sum]: round(e.sum),
    [k.min]: round(e.min),
    [k.max]: round(e.max),
    [k.mean]: round(e.mean),
    [k.median]: round(e.median),
    [k.stdDev]: round(e.stdDev),
    [k.percentiles]: labeledPercentiles(e.percentiles, opts),
  };
}

/** Arredonda o valor de cada registro extremo/rankeado, sob a chave de valor do locale. */
export function formatEntries(entries: StatEntry[], opts: DisplayOptions = {}): Array<Record<string, unknown>> {
  const { locale, round } = resolve(opts);
  const k = locale.keys;
  return entries.map(({ value, ...rest }) => ({ ...rest, [k.value]: round(value) }));
}

/**
 * Bloco agrupado pronto para resposta: `{ totalGrupos|totalGroups, aviso|notice?,
 * grupos|groups: [{ grupo|group, ...formatStats }] }`. O aviso de truncamento só
 * aparece quando o teto cortou grupos; avisos adicionais da tool podem ser
 * concatenados pelo chamador.
 */
export function formatGrouped(g: GroupedStats, opts: DisplayOptions = {}): Record<string, unknown> {
  const { locale } = resolve(opts);
  const k = locale.keys;
  const shown = g.groups.length;
  return {
    [k.totalGroups]: g.totalGroups,
    ...(g.totalGroups > shown ? { [k.notice]: locale.truncationNotice(shown, g.totalGroups) } : {}),
    [k.groups]: g.groups.map(({ group, ...stats }) => ({ [k.group]: group, ...formatStats(stats, opts) })),
  };
}
