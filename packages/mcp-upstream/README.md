# @sbissoli/mcp-upstream

🇧🇷 [Leia em Português](https://github.com/SidneyBissoli/mcp-br-commons/blob/main/packages/mcp-upstream/LEIA-ME.md)

Common fetch for the portfolio's MCP servers: **retry with backoff and `Retry-After`, timeout
per attempt, total budget per trip to the origin** — and the **count of trips, attempts and
anomalies** that feeds the `retrieval` block of the
[provenance contract v1.1](../mcp-provenance/docs/contrato-proveniencia-v1.md) (in Portuguese)
(`@sbissoli/mcp-provenance` ≥ 0.2.0).

> Maintained for my own portfolio of MCP servers. Third-party use is welcome, but the
> roadmap follows what my servers need.

The package **classifies**; the server **decides**. It says "the origin answered 404", "the
body came back as HTML", "I retried twice because of a 503" — and never what that means for
the data (legitimate absence × key outside coverage × non-existent series is each server's
semantics, and stays in it).

## Usage

```ts
import { createUpstream, UpstreamError } from "@sbissoli/mcp-upstream";

// 1. Once, when the server starts: the network policy.
const upstream = createUpstream({
  userAgent: "bcb-br-mcp/2.0 (+https://…)",
  timeoutMs: 10_000,   // cap of ONE attempt (headers + body in json/text; headers only in response)
  retries: 2,          // beyond the first attempt (up to 3 in total)
  budgetMs: 30_000,    // TOTAL budget of the trip, waits included
  backoff: { baseMs: 1_000, maxMs: 8_000, jitterMs: 500 },
  honorRetryAfter: true,
  inspectBody: (_res, body) => (body.trimStart().startsWith("<") ? "malformed_body" : null),
});

// 2. In each tool call: ONE collector, explicit.
const call = upstream.call();
const serie = await call.json(`${BASE}/serie/${codigo}`);      // 1 trip; counts attempts
const meta  = await call.json(`${BASE}/serie/${codigo}/meta`); // 2nd trip
call.recordCache(urlDoCatalogo, catalogo.retrievedAt);         // a cache hit of the SERVER

return prov.result(dados, prov.from(PRESET, {
  source_url: …,
  retrieved_at: call.retrievedAt(),      // the oldest between network and cache
  served_from_cache: call.servedFromCache(),
  retrieval: call.retrieval(),           // { requests: 2, attempts: 3, anomalies: [...] } | null
}));
```

`call.retrieval()` returns the **raw** `RetrievalInput`: whoever adds `unstable` and normalises
is the provenance library, as it already does. It is `null` when the call did not go to the
origin even once (pure cache, local data) — the contract requires `null`, not an invented
`{ attempts: 1 }`.

### A response that joins parts of different provenance (`field_sources`)

When the response merges sub-sources — one part from the cache, another fetched now —,
`call.fieldSource()` builds the `field_sources` item (provenance contract v1.2,
`@sbissoli/mcp-provenance` ≥ 0.3.0) from the recorded accesses. The server says which fields
come from which URL; the collector puts in that sub-source's oldest instant and its
`served_from_cache`:

```ts
field_sources: [
  call.fieldSource({ fields: ["serie"], source_url: urlSerie }),                    // accesses with an equal URL
  call.fieldSource({ fields: ["meta"],  source_url: urlMeta, filter: (u) => u.startsWith(urlMeta) }),
],
```

A sub-source with no access in this call comes out with `retrieved_at` and `served_from_cache`
`null` — unlike `retrievedAt()`, which returns "now" for the block, the item never asserts a
retrieval that did not happen.

### Three trip modes

| method | body | `inspectBody` | `malformed_body` |
|---|---|---|---|
| `call.json(url, init?)` | read and parsed | yes | body rejected or invalid JSON |
| `call.text(url, init?)` | read | yes | body rejected |
| `call.response(url, init?)` | **not consumed** | no | never (the body is yours) |

**In `response` mode the deadline ends at the headers.** `timeoutMs` and `budgetMs` cover the
trip until the `Response` is returned; the timer is cleared then, and the body you read
afterwards has **no deadline** from the package. An origin that sends the headers and stalls
the body hangs your read. If you read the body, either use `text()`/`json()` (the body is read
inside the attempt, under the deadline, and a stalled body is a `timeout`), or pass a `signal`
of yours that stays alive while you read and abort it when your own deadline runs out — the
package combines it with the fetch, so aborting it after the headers also aborts the body
stream. Abort it only **after** the call returns: aborting during the trip is `aborted`, not
`timeout`, and is not counted as an anomaly.

`init` is a normal `RequestInit`; a `signal` of yours is combined with the timeout's. Four extra
keys change the policy **for that trip only**, in the same collector, because a fair deadline
and retry depend on the SHAPE of the request, not on the server: `timeoutMs` (cap of ONE
attempt — bcb gives 6 s to a request for 20 observations and 30 s to a wide window),
`retries`, `backoff` (partial, merged over the policy's) and `retryOn` (ibge gives 4 retries of
2→16 s to the main query, 2 of 0.5→2 s to a best-effort enrichment, and does not retry the
deterministic 500 of the Aggregates API). None of them leaks into `fetch`; `budgetMs` follows the
policy's, on top.

### Classification and retry

| what happened | `kind` | retried by default | `transport` |
|---|---|---|---|
| an attempt exceeded `timeoutMs` (or the budget) | `timeout` | yes | yes (no, if it was while reading the body in json/text) |
| `fetch` threw (DNS/TCP/TLS) | `network` | yes | yes |
| HTTP 429 | `rate_limited` | yes, honouring `Retry-After` | no |
| HTTP 5xx | `http_5xx` | yes | no |
| HTTP 4xx (except 404) | `http_4xx` | **no** | no |
| 200 with a rejected body / invalid JSON | `malformed_body` | yes | no |
| HTTP 404 | `not_found` | no | no |
| the caller's `signal` aborted | `aborted` | no | yes |

The first six are the closed vocabulary of `retrieval.anomalies`. **`not_found` and `aborted`
are not anomalies**: absence is an answer from the origin, and cancellation is the caller's
decision. `retryOn(ctx)` replaces the retry policy (e.g. retrying a 4xx that the origin uses
as "try again"); `retries` and `budgetMs` still apply on top. The `ctx` carries `url`,
`attempt`, `kind`, `status`, `response`, `body` and `cause` (what `fetch` or the parse threw) —
it is through `cause` that a server tells an `ECONNRESET` from an error another layer threw
inside the fetch.

**Every failed attempt counts as an anomaly** — the overcome one and the final one. Since
`retrieval` only comes out when the tool succeeds, the difference only shows when the server
swallows the failure of a slice and answers partially: and then the response **is**
unstable, and the block has to say so.

### Wait between attempts

`max(Retry-After, exponential backoff) + jitter`, with `backoff = min(baseMs · 2ⁿ, maxMs)`.
A wait that would exceed what is left of `budgetMs` **gives up immediately**, with the
retryable error — waiting would only postpone the same timeout. Each attempt gets, at most,
what is left of the budget.

### The error

```ts
try { await call.json(url); }
catch (e) {
  if (e instanceof UpstreamError) {
    e.kind;        // "timeout" | "network" | "rate_limited" | "http_5xx" | "http_4xx" | "malformed_body" | "not_found" | "aborted"
    e.status;      // a number when a response arrived
    e.retryable;   // the class was retryable (informative: the retries are already exhausted)
    e.transport;   // true only when NOTHING arrived from the origin
    e.attempts;    // attempts of this trip
    e.body;        // body read (text/json modes) — this is where the server reads the 404
    e.response;    // Response with the body not consumed (response mode)
    e.retryAfterMs;
    e.isAnomaly;   // kind belongs to the contract's vocabulary
  }
}
```

### Did the origin deliver anything measurable? (`entregaDaOrigem`)

Contract tests, post-deploy smokes and recovery probes run against the live source and
need to tell "the source changed" (drift, a defect to fix) from "the source is down"
(nothing to fix, try again later). Deciding by the error's wording is brittle: measured
on 2026-10-22, two formats in this portfolio turned a deploy and a contract run red with
the origin answering 502. The decision is a function of `kind`, so it lives here, the
same for every consumer:

```ts
import { entregaDaOrigem } from "@sbissoli/mcp-upstream";

try { await call.json(url); }
catch (e) {
  const r = entregaDaOrigem(e);   // "delivery from the origin"
  r.veredito; // verdict: "indisponivel" | "respondeu" | "ambiguo" | "alheio"
  r.motivo;   // one pt-BR sentence for the log — never the basis of the decision
  r.kind; r.status; r.url;
}
```

| Verdict | When | Meaning |
|---|---|---|
| `indisponivel` (unavailable) | timeout, network, 429, 5xx | The origin delivered no body to compare. Drift was **not measured**; it is not drift. A 5xx lands here even though "a response arrived": what arrived is the gateway's error page, not the resource. |
| `respondeu` (answered) | 404, other 4xx | The origin answered, and the answer is a refusal of the request. Contract territory (route, key, parameter); whoever reads `status`/`body` decides. |
| `ambiguo` (ambiguous) | `malformed_body` | A body arrived that is not the expected one: either the format changed (real drift) or the origin served its error page to a sound request (the Central Bank's SGS does that for series that exist). Resolved by **repeating** on another trip, not by reading this one. |
| `alheio` (not the origin's) | `aborted`, or an error that is not an `UpstreamError` | The caller aborted, or it is a defect in our own code. Failing the contract for it would blame the source for what is ours. |

The function follows the error's `cause` chain (since 0.5.1): a server that translates
the package error into its own class keeps the verdict of the origin as long as it passes
the package error as `cause` (`new MyError(msg, { cause: err })`). An error with no
`UpstreamError` anywhere in the chain is `alheio`.

What the function does **not** do: policy. Whether `indisponivel` becomes a warning, a
skipped test or an exit code is the reporter's decision, per format — that reporter is
[`@sbissoli/mcp-fonte-viva`](https://www.npmjs.com/package/@sbissoli/mcp-fonte-viva).

### AsyncLocalStorage adapter (optional)

For servers that already propagate context this way:

```ts
import { withCall, currentCall, requireCall } from "@sbissoli/mcp-upstream/als";

server.tool("x", schema, (args) =>
  withCall(upstream, async (call) => {
    const dados = await buscar(args);            // deep down: requireCall().json(url)
    return prov.result(dados, prov.from(PRESET, { retrieval: call.retrieval(), … }));
  }),
);
```

A separate entrypoint so that the core does not depend on `node:async_hooks`. Requires Node or
a Worker with `nodejs_compat`.

## Offline tests

`fetchImpl`, `sleep`, `now` and `random` are injectable: the package's tests prove exact
counts, exact waits and giving up by budget without network and without waiting. Servers that
adopt it test the same way.

## License

MIT
