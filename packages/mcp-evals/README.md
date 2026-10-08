# @sbissoli/mcp-evals

🇧🇷 [Leia em Português](https://github.com/SidneyBissoli/mcp-br-commons/blob/main/packages/mcp-evals/LEIA-ME.md)

Eval harness for **tool selection** in MCP servers: it measures how accurately a model
picks the right tool from the catalogue, given a realistic query in the persona of the
server's target user. A generalisation of the senado-br-mcp-cloudflare harness (`evals/`),
promoted to a portfolio component in Phase 0 (Deliverable 5).

> The gate decisions are Portuguese strings; they are glossed at the end.

The core (catalogue extractor + fixture validation + scorer + gate) runs **offline in
`npm test`**, with no network and no model — renaming or removing a tool breaks the
project's fixture test immediately, for free. The expensive run (a real model through the
Anthropic Messages API) is only needed when you want the accuracy number itself.

> **Cost**: the real-model runner bills API usage separately from any Claude subscription.
> Never run `evals/run.ts` with `ANTHROPIC_API_KEY` without an explicit decision.

## Modules

| Module | Role |
|---|---|
| `catalog` | **Catalogue extractor.** `CapturingServer` (a fake McpServer) records every tool registration while running the server's `registerXTools` — no network, no Worker runtime. It captures both forms used in the portfolio: `server.tool(name, desc, shape, cb)` (senado) and `server.registerTool(name, {description, inputSchema}, cb)` (Cloudflare template / SDK v2). Converts zod → JSON Schema with the native `z.toJSONSchema` (`io: "input"` mode: a field with `.default()` is not required). |
| `fixtures` | The `EvalFixture` contract + `validateFixtures(fixtures, catalog, opts)`: minimum/maximum count, unique ids and queries, non-empty `expectedTools` that exist in the catalogue, minimum area coverage. A project's fixture test becomes `expect(validateFixtures(...)).toEqual([])`. |
| `score` | **Pure scorer.** top-1 / top-k / per-area + configurable gate (`evaluateGate`, default thresholds 85%/90%). |
| `retry` | API error classification (transient × fatal) + backoff honouring Retry-After. An infrastructure dropout is never scored as a wrong choice. |
| `report` | Pure report formatting (lines + exit code): coverage, accuracies, errors by kind, gate — marked PRELIMINARY when the run is incomplete. |
| `runner` | `runEval(config)`: sends each fixture + the whole catalogue to the Messages API with `tool_choice: any`, with bounded concurrency, retry and a short-circuit on fatal failure (auth/billing). Without `ANTHROPIC_API_KEY` it prints instructions and returns exit 0 — it never breaks CI. Plain `fetch`, no SDK. |

## Instantiating it in a project

```
my-server/
  evals/
    catalog.ts     # the project's GROUPS → buildCatalog(GROUPS)
    fixtures/queries.ts
    run.ts
  tests/evals/
    fixtures.test.ts
```

`evals/catalog.ts` — the only server-specific part is the list of groups:

```ts
import { buildCatalog, type CatalogGroup } from "@sbissoli/mcp-evals";
import { registerFooTools } from "../src/tools/foo.js";

const GROUPS: CatalogGroup[] = [
  { area: "foo", register: (s) => registerFooTools(s as never, BASE_URL) },
  // ... one per group in src/server.ts — a missing group silently shrinks the eval
];

export const CATALOG = buildCatalog(GROUPS);
```

`tests/evals/fixtures.test.ts` — the offline regression signal:

```ts
import { validateFixtures } from "@sbissoli/mcp-evals";
import { CATALOG } from "../../evals/catalog.js";
import { FIXTURES } from "../../evals/fixtures/queries.js";

it("fixtures valid against the live catalogue", () => {
  expect(validateFixtures(FIXTURES, CATALOG, { minFixtures: 30, maxFixtures: 50, minAreas: 12 }))
    .toEqual([]);
});
```

`evals/run.ts` — the real-model run:

```ts
import { runEval } from "@sbissoli/mcp-evals";
import { CATALOG } from "./catalog.js";
import { FIXTURES } from "./fixtures/queries.js";

const { exitCode } = await runEval({
  catalog: CATALOG,
  fixtures: FIXTURES,
  systemPrompt: "Você é o roteador de ferramentas do MCP <nome>. ... apenas chame a ferramenta.",
});
process.exit(exitCode);
```

Runner environment variables (optional): `EVAL_MODEL` (default `claude-opus-4-8`),
`EVAL_CONCURRENCY` (default 4), `EVAL_LIMIT` (smoke run with the first N fixtures).

## Gate

From the **top-1** accuracy (`evaluateGate`, thresholds configurable per server):

| Top-1 accuracy | Decision | Recommendation |
|---|---|---|
| `< 85%` | `remediar` | Open a remediation session (deferred loading / Code Mode / grouping). |
| `85%–90%` | `zona-cinzenta` | Keep under observation; re-evaluate after the next tool/description change. |
| `>= 90%` | `despriorizar-refatoracao` | Deprioritise catalogue refactoring; keep consolidating through enums. |

Runner exit codes: `0` = complete run (authoritative gate) or skipped without an API key;
`2` = one or more fixtures did not reach the model (PRELIMINARY gate — do not use it for a
decision).

## Migrating the senado harness (adoption in Phase 1)

Adoption swaps imports without changing behaviour — the gate messages are reproduced
byte for byte (compatibility test in `tests/score.test.ts`). Map:

| senado `evals/*` | `@sbissoli/mcp-evals` |
|---|---|
| `buildCatalog()` (no args, memoised, GROUPS built in) | `buildCatalog(GROUPS)` — GROUPS stays in the project; memoise in the project's module (`export const CATALOG = buildCatalog(GROUPS)`) |
| `catalogToolNames()` / `catalogAreaByName()` | `CATALOG.toolNames` / `CATALOG.areaByName` |
| `catalogAsAnthropicTools()` | `catalogAsAnthropicTools(CATALOG)` |
| invariants in `tests/evals/fixtures.test.ts` | `validateFixtures(FIXTURES, CATALOG, { minFixtures: 30, maxFixtures: 50, minAreas: 12 })` (the tests for the exact catalogue count and the `senado_` prefix stay in the project) |
| `evaluateGate(acc)` (message cites "67 tools") | `evaluateGate(acc, { toolCount: 67 })` — the runner fills `toolCount` from the catalogue automatically |
| the whole `run.ts` (main/printReport/retry loop) | `runEval({ catalog, fixtures, systemPrompt })` — same protocol (`tool_choice: any`), same env vars, same exit codes |
| `retry.ts` / `score.ts` | identical (ported; `EvalApiError.retryAfterSeconds` became a declared field) |

Two eval layers (see FASE0_PROMPT_SESSAO.md): this package measures **tool selection**;
the **task completion** layer (does the model answer correctly using the tools?) is covered
by mcp-builder's `evaluation.py` (assets in `fase0-insumos/mcp-builder-evaluation/`)
and/or MCPJam Inspector — complementary, not substitutes.

## Long session (`@sbissoli/mcp-evals/session`)

The package's second layer measures the **session**, not the turn: the model gets a task of
10–25 steps, calls the tools of a real MCP server and keeps going until it finishes. It was
born to answer, with a number, whether the origin diagnosis of contract v1.1
(`provenance.retrieval` — trips, attempts, anomalies, `unstable`) **reduces bad calls in long
runs**.

- **Transport**: a client-side loop over stdio (`@modelcontextprotocol/client`, optional peer)
  on the server's `dist/index.js` — no deploy, no public URL, no MCP connector.
- **A/B**: arm A gets the `tool_result` as it comes out of the server; arm B gets the same text
  with `provenance.retrieval` removed (object or array), in the same format. Only A gets a
  system-prompt sentence explaining the field; both prompts go into the NDJSON.
- **Fault injected at the origin**: `node --import dist/session/fault.js` wraps the server
  process's `fetch` and, by a deterministic rule (seed + URL + trip number), answers
  502/HTML/timeout in X % of the trips. `retrieval` comes out true; the server behaves as it
  does in production under instability. Rules per server, versioned with its tasks.
- **"Bad call per task" metric**, per trace: (a) repeating the SAME call after a definitive
  error, (b) a schema refusal, (c) insistence (≥3 calls on the same key, all erroring).
  (d) quoting an unstable value without a caveat needs a judge (a cheap model) and is reported
  separately.
- **Mandatory spending cap** (`--budget-usd` / `EVAL_BUDGET_USD`): adds up the `usage` of every
  request, loop and judge, and aborts when it crosses; a model without a price in the table is
  an error.
- **NDJSON with resume** by (date, sha, arm, level): a finished session does not run again;
  infrastructure dropouts and the cap stay out of the aggregation. Markdown report generated
  from the NDJSON.
- **`--dry`**: real server, stubbed model — runs each task's script and measures tokens per
  response (exact count with `--count-tokens`, a free endpoint) and the estimated cost per
  session BEFORE the run is approved.

```bash
# on the server under test (dist/ built), without spending:
tsx ../mcp-br-commons/packages/mcp-evals/dist/session/cli.js   --server dist/index.js --tasks evals/session/tasks.ts --dry
# paid run (ANTHROPIC_API_KEY only here; never in the server's process):
EVAL_BUDGET_USD=5 tsx .../dist/session/cli.js --server dist/index.js   --tasks evals/session/tasks.ts --arm both --fault 0,20 --runs 1 --limit 1 --model claude-opus-5
```

The task set (`TaskSet`) is a module of the server: a common `systemPrompt`, `faults` per
level, and tasks with `prompt`, `expectedTools`, `script` (the `--dry` script, validated
offline by `validateTaskSet` against the catalogue), `answer` (mechanical answer key) and
`trap`. First adopter: `bcb-br-mcp/src/evals/session/tasks.ts`.

## Development

```bash
npm run typecheck
npm test        # 112 offline tests (single turn + long session: loop, filter, metrics, fault, cap, resume)
npm run build
```

Dependencies: `zod` ^4 as a peer (for `z.toJSONSchema` in the extractor);
`@modelcontextprotocol/client` ^2 as an OPTIONAL peer (only the `./session` subpath loads it,
through a dynamic import).

## Glossary

The gate decisions are returned as Portuguese strings; code that reads them uses them as
written below.

| Value (as returned) | Meaning in English |
|:--|:--|
| `remediar` | remediate |
| `zona-cinzenta` | grey zone |
| `despriorizar-refatoracao` | deprioritise refactoring |
