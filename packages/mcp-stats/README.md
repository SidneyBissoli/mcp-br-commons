# @sbissoli/mcp-stats

🇧🇷 [Leia em Português](https://github.com/SidneyBissoli/mcp-br-commons/blob/main/packages/mcp-stats/LEIA-ME.md)

Statistics engine for MCP tools that return tabular records: the server computes the full
distribution **before** truncation/pagination and returns a compact block — without it, the
model only sees a slice and never answers "which is the largest?", "what is the average?",
"how is it distributed?". Zero dependencies; runs on Workers and Node.

> Maintained for my own portfolio of MCP servers. Third-party use is welcome, but the
> roadmap follows what my servers need. With the `pt-BR` locale the output keys are
> Portuguese; they are glossed at the end.

Origin: a generalisation of senado-br-mcp-cloudflare's `src/utils/estatisticas.ts` (in
production in its 5 quantitative tools). The `pt-BR` locale reproduces the senado's shape
byte for byte — adopting it there changes no response at all.

## Fixed conventions (do not change without a decision)

- **Percentiles**: linear interpolation type 7 (== `numpy.percentile` / Excel INC);
- **Population standard deviation** (÷n) — the datasets are censuses, not samples;
- **Stable tie-break** in argMax/argMin/ranking: the smallest `tieBreak` wins;
- **Groups** sorted by descending sum, default cap of 50 with a notice;
- Full precision in the core; rounding (default 2 decimals) only for display.
- **An empty set is UNDEFINED, never zero** (since 0.3.0). `min`, `max`, `mean`,
  `median`, `stdDev` and every percentile come out `null` with `reason: "no-records"`;
  `n` and `sum` stay numeric (zero records is a fact, and the empty sum is zero by
  definition). For display, `formatStats` and `formatGrouped` replace the block with a
  notice, and `labeledPercentiles` labels without quoting a value.

  Why: up to 0.2.0 the empty block came out with zero in every field, and the display layer
  NARRATED it — *"mediana — metade dos valores é igual ou inferior a R$ 0,00"* ("median —
  half of the values are equal to or below R$ 0.00"). Measured in production in
  senado-br-mcp on 14/09/2026, in a query with a valid year and a filter that matched no
  record: the response handed the model a ready-made sentence, with full provenance,
  asserting a value nobody measured. Zero is the most dangerous wrong answer possible here —
  it passes any type validation, looks like a measurement and leaves no trace. ibge and bcb
  never showed the defect, but only because their callers guarded before: the engine was the
  loaded gun. See `tests/sem-registros.test.ts`.

  **Migrating from 0.2.x:** the fields went from `number` to `number | null`. Whoever rounds
  or formats the raw block must handle the null — `Math.round(null)` is `0` and reintroduces
  exactly the defect. Whoever already guarded an empty list before calling (ibge, bcb)
  changes nothing.

## Usage

```ts
import {
  computeStats, computeGroupedStats,
  formatStats, formatEntries, formatGrouped, parseBRL,
} from "@sbissoli/mcp-stats";

// Full dataset already on the server (e.g. the month's payroll, ~5 MB, values as pt-BR strings):
const e = computeStats(linhas, (r) => parseBRL(r.remuneracao_total), {
  topN: 10,
  identify: (r) => ({ nome: r.nome, cargo: r.cargo }),  // what goes into the extremes
  tieBreak: (r) => r.sequencial,                        // deterministic tie-break
});

return {
  distribuicao: formatStats(e),          // n/soma/minimo/maximo/media/mediana/desvioPadrao
  top: formatEntries(e.top),             //   + LABELLED percentiles (the reader never sees "p99")
  bottom: formatEntries(e.bottom),
};

// Grouped (e.g. agruparPor=uf):
const g = computeGroupedStats(linhas, (r) => parseBRL(r.valor), (r) => r.uf);
return formatGrouped(g);                 // { totalGrupos, aviso?, grupos: [...] }
```

### Correlation between two series

```ts
import { computeCorrelation } from "@sbissoli/mcp-stats";

// `linhas` arrives already PAIRED by the caller (same date, same grid):
const c = computeCorrelation(linhas, (r) => r.ipca ?? NaN, (r) => r.selic ?? NaN, {
  method: "spearman",                    // default: "pearson"
});
// { method, n, dropped, coefficient: number | null, reason? }
```

This module **does not pair**, on purpose: aligning time grids is domain work and goes wrong
in ways specific to each source. Whoever knows the source aligns it.

Three conventions that avoid a plausible and wrong number:

- **Spearman is Pearson over the ranks**, with the average rank on ties — not the
  `1 - 6Σd²/n(n²-1)` shortcut, which only holds without ties and does not warn when there are;
- **pairwise dropping**, with `n` (used) and `dropped` (left out) in the response — without
  that, a coefficient computed over 7 of 250 points would go unnoticed;
- **an undefined coefficient is `null` with `reason`**, never 0: zero is "I measured and there
  is no relationship", `null` is "it cannot be measured" (fewer than 2 pairs, or a constant
  series).

There is no display formatter for correlation: the current consumers build the response block
with their own keys. When the second consumer appears, it goes into `display.ts` like the
others.

### Another language / another unit

```ts
// en server (e.g. ilostat) — keys and labels in English, rates with 4 decimals:
formatStats(e, { locale: "en", decimals: 4, formatValue: (n) => `${n}%` });
// Custom locale: pass your own StatsLocale (keys + labels + formatter).
```

The core/display split exists because the block's keys and labels are read by the model and
passed on to the reader — they must be in the server's language; the computation, not.

## API

Core: `computeStats`, `computeGroupedStats`, `percentile`, `computeCorrelation` —
they take **accessor functions** (`valueOf`, `identify`, `tieBreak`, `groupBy`, `xOf`,
`yOf`), not field names, because the canonical value is often computed or needs parsing.
Display: `formatStats`, `formatGrouped`, `formatEntries`, `labeledPercentiles`,
locales `ptBR`/`en` (`StatsLocale` customisable), `formatBRL`, `formatNumberEn`.
Parsing: `parseBRL` ("1.234,56" → 1234.56; native numbers pass unchanged).

## Glossary

Output keys of the `pt-BR` locale (the `en` locale uses English keys):

| Key (as emitted) | Meaning in English |
|:--|:--|
| `soma` | sum |
| `minimo` / `maximo` | minimum / maximum |
| `media` / `mediana` | mean / median |
| `desvioPadrao` | standard deviation |
| `percentis` / `percentil` | percentiles / percentile |
| `valor` / `rotulo` | value / label |
| `grupo` / `grupos` | group / groups |
| `totalGrupos` | number of groups |
| `aviso` | notice |
