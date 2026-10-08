# @sbissoli/mcp-search

🇧🇷 [Leia em Português](https://github.com/SidneyBissoli/mcp-br-commons/blob/main/packages/mcp-search/LEIA-ME.md)

ChatGPT's Deep Research (and Company Knowledge, and the research workflows of the Responses
API) only uses an MCP server that exposes **exactly** two tools, `search` and `fetch`, with a
fixed input and output format. A server with twenty rich tools and neither of those two is
invisible to it. This package is the part of that contract that is the same in every
server — names, schemas, envelope, descriptions, telemetry — so that each server writes only
what is its own: the **index** (what can be found) and the **renderer** (the text of a
document).

> Maintained for my own portfolio of MCP servers. Third-party use is welcome, but the
> roadmap follows what my servers need.

The literal contract from OpenAI's docs (`developers.openai.com/api/docs/mcp`, read on
2026-09-02):

- `search(query: string)` → `{ results: [{ id, title, url }] }`
- `fetch(id: string)` → `{ id, title, text, url, metadata? }`
- the object goes in `structuredContent` **and** serialised in `content[0].text`;
- ChatGPT only creates a citation when `url` is a non-empty string.

## Rules the library enforces

- **The names are `search` and `fetch`, with no prefix.** It is the only exception to the
  per-server prefix in the portfolio (`ibge_*`, `bcb_*`…); `DEEP_RESEARCH_TOOLS` exists so
  that tests that require the prefix open the exception through an allowlist, not a loose
  regex.
- **`content` has a single block, the compact JSON of the object.** The provenance envelope
  (`@sbissoli/mcp-provenance`) emits two blocks; here the footer is left out because the docs
  describe `content[0].text` as the object and nothing else. Provenance goes through the
  other two channels — `structuredContent` and `_meta`, via the `extras` that `search`/`fetch`
  return with the result — and extra keys there do not get in Deep Research's way. It is the
  call that delivers the provenance, not an outside decorator: the real retrieval instant and
  the cache key only exist inside it.
- **The contract's keys win on collision** with the attached extras.
- **`search` cuts at `limit`** (default 10) even if the index returns more.
- **Strict input** (0.9.0): `searchInputSchema` and `fetchInputSchema` are `z.strictObject`
  and publish `additionalProperties: false`. A key outside the contract is refused with an
  error that names it, instead of being silently dropped. Whoever registers through `.shape`
  (`z.object(shape)`) LOSES the strictness — pass the object, or apply `.strict()` on your
  side.
- **An error never surfaces raw**: a `search`/`fetch` that throws becomes an `isError` result
  with a pt-BR message; an unknown id likewise.
- Everything is read-only; the caller passes the same `annotations` as the other tools, so
  that surface tests do not tell the two apart.

## Usage

```ts
import {
  createIndex,
  registerDeepResearchTools,
  type FetchReply,
  type IndexEntry,
} from "@sbissoli/mcp-search";

// 1. The index: anything with an id, a title and a public URL. `keywords`
//    and `text` only serve for ranking. Build it once (or per TTL) from
//    the server's real catalogue.
const entradas: IndexEntry[] = [
  {
    id: "sidra:6579",
    title: "Tabela 6579 — População residente estimada",
    url: "https://sidra.ibge.gov.br/tabela/6579",
    keywords: ["estimativas de população"],
  },
];
const indice = createIndex(entradas);

// 2. The renderer: given an id, the whole document (readable Markdown text),
//    with the envelope extras when there is provenance to attach.
async function documento(id: string): Promise<FetchReply | null> {
  const e = entradas.find((x) => x.id === id);
  if (!e) return null;
  return {
    document: { id, title: e.title, url: e.url, text: `# ${e.title}\n…` },
    extras: { structured: { provenance, attribution }, meta: { [chaveMeta]: provenance } },
  };
}

// 3. Inside the server's central tool registration:
registerDeepResearchTools(server, {
  search: async (query) => indice.search(query), // or { results, extras }
  fetch: documento,
  corpus: "IBGE official statistics (SIDRA tables, municipalities, indicators)",
  richTools: "the `ibge_*` tools",
  annotations: READ_ONLY,
  extendOutputSchema: comProveniencia, // adds the provenance block to the schema
  record, // tool_call/tool_error telemetry, like the server's `handle`
});
```

### Surface language

The default is pt-BR: titles, the schemas' `.describe()` and error messages in Portuguese
(the `description` the model reads is always in English). In a server whose whole surface is
in English (medical, ilo, uis), `locale: "en"` switches the three at once —
`contractSchemas("en")` returns the same four schemas with English descriptions, and
`titles`/`notFound`/`onError` still override the language default when passed.

### Servers that register JSON Schema by hand

The factory registers the zod schemas on the `McpServer`. A server whose definitions are
hand-written JSON Schema (bcb, with `TOOL_DEFINITIONS` and a `dispatchTool` by `case`) does
not need to derive anything: `contractJsonSchemas(locale)` returns the same four schemas in
JSON Schema draft-07 (no `$schema`, inline references), derived once here from the same
zod — and the server wraps them with its own provenance wrapper over JSON.

### Ranking

`createIndex` precomputes the tokens and returns a deterministic searcher: normalisation
without accents and without case, tokens `[a-z0-9]{2,}` minus the pt-BR stopwords, scoring
per query token with a weight per field (id 10, title 3, keywords 2, text 1; a prefix from 3
characters on is worth half), bonuses for coverage (each distinct token matched) and for the
whole phrase in the title, ties broken by the collection's order. An empty query or one with
no match returns `[]`. `rankEntries(entradas, consulta)` is the shortcut for small
collections.

## The question's vocabulary

Every substring search against the name the source uses has the same defect: whoever asks
with the everyday word, or with another country's spelling, does not get a bad result — they
get **zero, silently**. Measured in the portfolio in September 2026: `labor` 0 × labour 176 in
ILOSTAT; `enrollment` 0 × enrolment 227 in UIS; `populacao` 0 × população 520 and `renda` 72 ×
rendimento 1,126 in IBGE; `câncer` 0 × neoplasia maligna 439 in ICD-10 (CID-10); `calote` 0 ×
inadimplência 484 in BCB. Since 0.5.0 the recipe lives here; each server brings only the table.

```ts
import { createVocabulary } from "@sbissoli/mcp-search";

// Only MEASURED pairs: the asked word absent from the catalogue, the source's present.
const vocab = createVocabulary({
  locale: "pt-BR",            // stopwords, singular and the note's sentence
  sourceName: "o IBGE",       // "a palavra que o IBGE usa" / en: "the wording ILOSTAT uses"
  entries: [
    { asked: "renda", source: ["rendimento"] },
    { asked: "pressão alta", source: ["hipertens"] },   // phrase: becomes ONE term before splitting
  ],
});

const expanded = vocab.expandQuery("renda média");       // [{ term, patterns, translated }]
const hits = docs.filter((d) => vocab.matchesQuery(vocab.normalize(d.nome), expanded));
const notes = vocab.vocabularyNotes(expanded);           // '"renda" também foi buscado como rendimento — …'
// In the search index: keywords: [...vocab.askedWordsFor(d.nome)]
```

Rules: both sides go through `normalize` (NFD without diacritics, lower case); the table's
phrases match before splitting into words; the language's stopwords stay out of the AND (a
stopword-only query still counts); each term becomes an OR of the term itself, its singular
(per-language rules that do not fabricate fragments) and the source's spellings; terms are
ANDed. An empty table is a null expansion.

**Word boundary (since 0.6.0).** A pattern matches the **start** of a word, never the middle.
Up to 0.5.0 it was a substring at any position, and a substring without a boundary invents
results without raising an error: measured on 22/09/2026, `uber` matched 1 CNAE subclass and
it was inside `TUBÉRCULOS`; `ovo` matched 11 and 9 were `NOVOS`; `idade` matched 6,092 of the
9,336 SIDRA aggregates, almost all inside `atividade`; and in the UIS catalogue `male`
matched inside `female`, so asking about men brought women. The boundary is only at the start
because the tables keep STEMS on purpose (`ocupa` reaches ocupação/ocupadas, `odontolog`
reaches odontológico/odontologia, `child` reaches children): requiring a boundary at the end
would take `ocupa` from 1,609 to 0.

**For SQL (D1/SQLite)** the same rule is `GLOB`, not `LIKE` — `LIKE '%p%'` is exactly the match
without a boundary. Each pattern in `patterns` becomes:

```sql
(col GLOB ?n OR col GLOB ?m)   --  ?n = 'p*'   ?m = '*[^a-z0-9]p*'
```

and the terms are joined with AND. Sanitise the pattern before binding it
(`p.replace(/[*?[\]]/g, "")`): `patterns[0]` is the text the USER typed, and `GLOB` has no
escape character. The column must be normalised (that is what the `_lc` suffix means in the
catalogues), otherwise the `[^a-z0-9]` boundary does not hold.

## API

Contract: `DEEP_RESEARCH_TOOLS`, `searchInputSchema`, `searchOutputSchema`,
`searchResultSchema`, `fetchInputSchema`, `fetchDocumentSchema` (pt-BR),
`contractSchemas(locale)`, `contractJsonSchemas(locale)` and the types
`SearchInput`, `SearchResult`, `SearchOutput`, `FetchInput`, `FetchDocument`,
`DeepResearchToolName`, `ContractLocale`, `JsonSchemaObject`. Ranking: `createIndex`, `rankEntries`, `normalizeText`,
`tokenize`, `DEFAULT_LIMIT`, types `IndexEntry`, `SearchIndex`,
`SearchOptions`. Envelope: `deepResearchResult`, `deepResearchError`,
`EnvelopeExtras`. Vocabulary: `createVocabulary`, types `Vocabulary`,
`VocabularyOptions`, `VocabularyEntry`, `VocabularyLocale`, `ExpandedTerm`. Factory: `registerDeepResearchTools`,
`DeepResearchToolsOptions`, `SearchReply`, `FetchReply`, `UsageRecorder`.

Dependencies: `zod` (schemas); `@modelcontextprotocol/server` ^2 as a peer
(types only — the server that registers is the caller's).
