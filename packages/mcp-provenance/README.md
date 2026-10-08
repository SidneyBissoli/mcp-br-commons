# @sbissoli/mcp-provenance

🇧🇷 [Leia em Português](https://github.com/SidneyBissoli/mcp-br-commons/blob/main/packages/mcp-provenance/LEIA-ME.md)

Provenance contract for MCP servers: every tool result carries **source, endpoint, period,
retrieval date and licence**, with deterministic serialisation, in two modes — `concise`
(default, legal floor) and `detailed` (full canonical block).

> Maintained for my own portfolio of MCP servers. Third-party use is welcome, but the
> roadmap follows what my servers need.

Full specification (in Portuguese): [`docs/contrato-proveniencia-v1.md`](docs/contrato-proveniencia-v1.md).

## Usage

```ts
import { createProvenanceContext } from "@sbissoli/mcp-provenance";

// 1. Once, when the server starts:
const prov = createProvenanceContext({
  metaNamespace: "com.sidneybissoli.senado",   // _meta keys (reverse-DNS, stable)
  locale: "pt-BR",                             // footer language ("pt-BR" | "en" | LocaleSpec)
  timezone: { offset: "-03:00", label: "horário de Brasília" }, // default: "utc"
  defaultMode: "concise",                      // default: "concise"
});

// 2. Presets per upstream source (optional):
const SENADO_LEGIS = {
  source: "Senado Federal — Dados Abertos (Legislativo)",
  citation: "Fonte: Senado Federal, Portal de Dados Abertos (Legislativo) — legis.senado.leg.br/dadosabertos.",
  license: "Dados Abertos do Senado Federal — uso livre com atribuição da fonte.",
};

// 3. In each tool:
const p = prov.from(SENADO_LEGIS, {
  source_url: `${baseUrl}/processo.json`,
  retrieved_at: fetchedAt,        // the REAL retrieval instant (preserved by the cache)
  data_vintage: "2025",
});
return prov.result(shapedData, p);                      // concise mode (default)
return prov.result(shapedData, p, { mode: "detailed" }); // full canonical block
```

`result()` emits the three channels: `structuredContent` (block + `attribution` RFC #711,
visible to the model), namespaced `_meta` (audit/UI, zero tokens) and a compact text footer
for text-only clients.

### Origin diagnosis (`retrieval`, contract v1.1)

How the data was obtained, so that the agent explains an unstable value instead of inventing
certainty. It is the 7th key of `concise` mode (after `retrieved_at`) and enters the
canonical block after `served_from_cache`. **Only what was measured**: a server that does not
instrument its trips to the origin omits the field and it comes out `null` — never an
invented `{attempts: 1}`.

```ts
const p = prov.from(SENADO_LEGIS, {
  source_url,
  retrieved_at: fetchedAt,
  retrieval: {
    requests: 3,                                   // distinct trips to the origin in this call (slices, pages)
    attempts: 5,                                   // attempts added up (>= requests)
    anomalies: [{ kind: "timeout", count: 2 }],    // optional; classes: timeout | network | http_4xx |
  },                                               //   http_5xx | rate_limited | malformed_body
});
// → provenance.retrieval = { requests: 3, attempts: 5, anomalies: [{kind:"timeout",count:2}], unstable: true }
```

`unstable` is derived by the library (`attempts > requests` or any anomaly); `anomalies` is
summed per class and ordered by the vocabulary, so the collection order does not change the
bytes. In the footer, a line for the reader appears **only when unstable**: *"Obtenção
instável: 5 tentativas para 3 consultas à origem (2 tempos de resposta esgotados)."* ("Unstable
retrieval: 5 attempts for 3 queries to the origin (2 timeouts)."). Full semantics in
[`docs/contrato-proveniencia-v1.md`](docs/contrato-proveniencia-v1.md) §3; compatibility rule
of the 1.x line in §8.

### The tool's `outputSchema`: import it, don't transcribe it

The MCP SDK validates `structuredContent` against the `outputSchema` at runtime. A server
that closes the provenance block with hand-transcribed keys (`additionalProperties: false`)
and upgrades the package without rewriting the transcription **fails on every call** — that
is what the measurement of 26/09/2026 showed in four servers. Since 0.2.0 the package
publishes the projection it emits itself:

```ts
import { CONCISE_BLOCK_JSON_SCHEMA, ConciseBlockSchema } from "@sbissoli/mcp-provenance";

// outputSchema in verbatim JSON Schema (bcb, sih, medical):
const outputSchema = {
  type: "object",
  properties: { total: { type: "integer" }, provenance: CONCISE_BLOCK_JSON_SCHEMA, attribution: ATTRIBUTION },
  required: ["total", "provenance", "attribution"],
};

// outputSchema in zod (ibge):
const outputSchema = z.object({ total: z.number().int(), provenance: ConciseBlockSchema, attribution: z.array(z.string()) });
```

`DETAILED_BLOCK_JSON_SCHEMA`/`DetailedBlockSchema` and `provenanceBlockJsonSchema(mode)`
cover `detailed` mode. The package's tests pin that schema and `render*` do not diverge.

### Structured source (e.g. ILOSTAT/SDMX)

```ts
const p = prov.build({
  source: { name: "ILOSTAT", agency: "ILO", database: "ILOSTAT", endpoint: "https://sdmx.ilo.org/rest" },
  dataset: { id: "DF_UNE_DEAP_SEX_AGE_RT", version: "1.0", name: "Unemployment rate by sex and age" },
  dimension_key: { REF_AREA: "BRA", SEX: "SEX_F", TIME_PERIOD: "2024" },
  data_vintage: "2026-06-15",
  retrieved_at: fetchedAt,
  source_url: canonicalRestUrl,
  license: { id: "CC-BY-4.0", url: "https://creativecommons.org/licenses/by/4.0/", verified_at: "2026-08-04" },
  citation: "International Labour Organization, ILOSTAT, https://ilostat.ilo.org/data/, accessed 2026-08-04.",
});
```

### Multi-source (licence segregation)

```ts
// One block PER SOURCE; each source's data in separate structures pointing to its block.
return prov.result({ ilostat: dadosIlo, uis: dadosUis }, [pIlo, pUis]);
```

### Several slices of the same source (`field_sources`, contract v1.2 in `concise`)

A response that joins parts from different endpoints or moments — part from the cache, part
fetched now — says where each part came from. The block's `retrieved_at` is the **oldest**
among them (in 1.2 the library enforces it).

```ts
const prov = createProvenanceContext({ metaNamespace, contractVersion: "1.2" }); // see "Rollout" below
const p = prov.build({ ...base, retrieved_at: call.retrievedAt(), field_sources: [
  call.fieldSource({ fields: ["vitoria"],    source_url: urlVitoria,   filter: (u) => u === urlVitoria }),
  call.fieldSource({ fields: ["vila_velha"], source_url: urlVilaVelha, filter: (u) => u === urlVilaVelha }),
]});
// concise → ..., "license": "...", "field_sources": [
//   { "fields": ["vitoria"],    ..., "retrieved_at": "2026-10-04T15:00:00Z", "served_from_cache": true },
//   { "fields": ["vila_velha"], ..., "retrieved_at": "2026-10-05T21:30:00Z", "served_from_cache": false } ]
```

`call.fieldSource` comes from `@sbissoli/mcp-upstream` ≥ 0.4.0. A response without a merge
does not carry the key (absent, not `null`).

**Rollout in two steps.** 0.3.0 emits version **1.1 by default** — byte for byte what 0.2.0
emitted — and the published schemas accept 1.1 and 1.2. Upgrading the package only changes
what the `outputSchema` declares; the wire stays the same. Turning on
`contractVersion: "1.2"` is a second step, after the connectors have renewed the schema: a
connector that kept the old schema refuses the key it does not know (contract §8).

### Notices, derived values and revision (contract v1.3)

What the canonical block always had but `concise` dropped now reaches the client, each key
**only when there is something to say**: `notices` (warnings the source publishes with the
data, verbatim), `derived` + `derivation_note` (the server computed the value) and
`revision` — whether the number can still change:

```ts
const prov = createProvenanceContext({ metaNamespace, contractVersion: "1.3" });
const p = prov.build({ ...base, revision: { status: "provisional", note: "2026 months still open" } });
// concise → ..., "license": "...", "revision": { "status": "provisional", "note": "2026 months still open" }
// footer  → ... "Preliminary data: the source may still complete or correct it. 2026 months still open."
```

`revision.status` is a closed vocabulary: `current` (the source's current version; it may
revise it), `provisional` (known to be incomplete or subject to change) and `final` (will not
change — only when the source says so, or the data comes from a frozen file whose version
the response names). Absent = the server cannot tell; never guess. `revision` can go in a
`SourcePreset`, since it is usually fixed per source.

The text footer gains **one line per exception** (provisional data, server-computed values,
notices from the source) and nothing in the common case, so a model that reads only the text
also learns that a year is incomplete. Same two-step rollout as 1.2: upgrading to 0.4.0
changes nothing on the wire; `contractVersion: "1.3"` turns it on.

## Rules the library enforces (server-side, before responding)

- `license` with at least `id` or `name` (legal floor);
- `derived: true` requires `derivation_note`;
- keys in a fixed order and absence as an explicit `null` (byte-for-byte determinism per mode);
  the exceptions are the `concise` keys added after 1.1 (`field_sources`, `notices`, `derived`,
  `derivation_note`, `revision`), absent when there is nothing to say;
- `revision.status` within its closed vocabulary;
- from 1.2 on, the block's `retrieved_at` cannot be newer than any sub-source's;
- ISO-8601 timestamps without milliseconds, normalised to the configured time zone (plain dates
  pass through untouched — it never invents a time in a vintage).

## API

`createProvenanceContext(options)` → `{ build, from, render, footer, result, metaKeys }`.
Loose pieces also exported: `CanonicalProvenanceSchema`, `renderConcise`,
`renderDetailed`, `attributionList`, `provenanceFooter`, `toCanonicalIso`, locales
`ptBR`/`en`.
