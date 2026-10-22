# @sbissoli/mcp-live-source

Reporter for tests that run against the **live source** (contract tests, post-deploy
smokes, recovery probes). It separates "the source changed" (drift, a defect to fix)
from "the source is down" (nothing to fix, measure again tomorrow), keeps the circuit
breaker, repeats what is worth repeating, and writes the job summary and the GitHub
Actions annotations in a fixed contract that the portfolio panel reads.

*Em português: [LEIA-ME.md](./LEIA-ME.md).* Names in the API are in Portuguese; the
glossary is at the end.

## Why

Measured on 2026-10-22 in the Brazilian Senate server: 63 endpoints answered normally,
one answered 502 in all three attempts, and the nightly contract job went red three
times (the automatic retry burnt its attempts on a persistent 502). The portfolio panel
then reported "the source changed". It had not. A drift detector that raises a false
alarm on an outage is a detector that stops being read.

The verdict itself comes from [`entregaDaOrigem`](https://www.npmjs.com/package/@sbissoli/mcp-upstream)
in `@sbissoli/mcp-upstream`, decided by the error's `kind`, never by its wording. This
package adds what a reporter needs on top of it: the `dependencia` verdict, the breaker,
the retry, and the policy.

## The policy

Decided once, for every consumer (portfolio owner, 2026-10-22):

| What happened | Exit code | Annotation |
|---|---|---|
| Everything captured | `0` | — |
| Only `indisponivel` / `dependencia`, with at least one capture | **`0`** (green) | `::warning title=Fonte indisponível::a, b` |
| Breaker tripped (nothing captured, N unavailable in a row) | **`3`** | `::error title=Fonte inalcançável::…` |
| Any `respondeu` (404 / 4xx: the source refused the request) | `1` | `::error title=Deriva de formato::a, b` |
| Any `ambiguo` that persisted through the retries | `1` | `::error title=Ambíguo (deriva ou página de erro)::a` |
| Any `alheio` (our own defect) | `1` | `::error title=Falha alheia à origem::a` |

Green with a warning, not red with a label: red triggers the automatic retry (three
attempts on a 502 that persists) and paints the panel with "the source changed". The
fixture of an endpoint that was not measured stays the committed one, and the "live"
test runs over it — honestly, because the summary says "drift NOT measured in N
endpoints".

The message of the `Fonte indisponível` annotation is the list of endpoint names,
comma-and-space separated. The panel counts nights per endpoint from it (three nights
in a row opens an item). The titles are exported constants (`TITULO_*`): changing one
is changing the contract.

## Usage (capture script)

```ts
import { Relatorio, capturarComRetentativa, linhaDeResultado } from "@sbissoli/mcp-live-source";

const relatorio = new Relatorio({ dependencia: (e) => e instanceof MissingDependencyError });

for (const spec of specs) {
  process.stdout.write(`capturing ${spec.name} ... `);
  const t0 = Date.now();
  try {
    const raw = await capturarComRetentativa(() => spec.capture(helpers), {
      dependencia: (e) => e instanceof MissingDependencyError,
      aoRepetir: (n, falha) => console.warn(`  retry ${n}: ${falha.motivo}`),
    });
    write(spec, raw);
    console.log(linhaDeResultado(relatorio.registrarCaptura(spec.name, Date.now() - t0)));
  } catch (err) {
    console.log(linhaDeResultado(relatorio.registrarFalha(spec.name, err, Date.now() - t0)));
  }
  if (relatorio.deveParar) break;
}

const resumo = relatorio.escrever(); // stdout + annotations + $GITHUB_STEP_SUMMARY (when set)
process.exit(resumo.codigoDeSaida);
```

The server must pass the package error as `cause` of its own error class
(`new MyError(msg, { cause: err })`); `entregaDaOrigem` follows the chain since
mcp-upstream 0.5.1. Without it every failure is `alheio`.

## Usage (vitest)

For a server whose live tier is a test file rather than a capture script. `vitest` is an
optional peer (`^5`); the subpath imports it, the root entry does not.

```ts
import { describe, expect } from "vitest";
import { createUpstream } from "@sbissoli/mcp-upstream";
import { suiteAoVivo } from "@sbissoli/mcp-live-source/vitest";

const upstream = createUpstream({ timeoutMs: 45_000, retries: 0 }); // ONE network seam: the package error carries `kind`
const { aoVivo } = suiteAoVivo();                                 // one report per file; written in afterAll

describe.runIf(LIVE)("SGS catalogue contract", () => {
  for (const serie of SERIES) {
    aoVivo(
      `SGS ${serie.codigo} — ${serie.nome}`,
      async () => {
        const [ponto] = await upstream.call().json<Ponto[]>(url(serie.codigo));
        expect(ageDays(ponto.data)).toBeLessThanOrEqual(serie.toleranciaDias);
      },
      { endpoint: `sgs-${serie.codigo}`, timeout: 180_000 },
    );
  }
});
```

The policy, translated to tests — the process exit code is the runner's, and vitest exits 0
when the only non-passing tests are skipped:

| verdict (after the retries) | the test | annotation (in `afterAll`) |
|---|---|---|
| captured | passes | — |
| `indisponivel` (timeout, network, 429, 5xx) | **skipped**, note `Fonte indisponível: …` | `::warning title=Fonte indisponível::a, b` |
| `ambiguo` (persisted) | fails | `::error title=Ambíguo (deriva ou página de erro)::a` |
| `respondeu` (404/4xx **or the test's own assertion**) | fails | `::error title=Deriva de formato::a` |
| `alheio` (a `TypeError` of ours) | fails | `::error title=Falha alheia à origem::a` |
| circuit breaker (N unavailable in a row, nothing captured) | the following tests skip **without touching the network**; the file **fails** in `afterAll` (`falharSeInalcancavel`, default) so the automatic retry reruns on a fresh runner — the script's exit code 3 | `::error title=Fonte inalcançável::…` |

Only `indisponivel` and `ambiguo` are retried (`repetirAoVivo`); an assertion failure is the
drift the test exists to measure, so it is not retried and is labelled drift, not "our
fault" (`deriva` predicate, default `ehAssercao`: `err.name === "AssertionError"`).
`endpoint` is the short label the panel counts nights by (no comma); it defaults to the test
name. The breaker relies on the tests of a file running in sequence — do not use
`describe.concurrent` with `aoVivo`. The report writes with `process.stdout.write`, not
`console.log`: vitest 5's default reporter swallows the console of tests and hooks, and the
Actions runner only recognises `::warning` at the start of a stdout line (measured 2026-10-22,
vitest 5.0.5). Nothing is written when the file ran no live test (`describe.runIf(false)`).

The runner-agnostic core is `criarSuiteAoVivo({ it, afterAll }, opcoes)` on the root entry:
bind it to another runner (node:test) by supplying the hooks and a context whose `skip(nota)`
throws.

## API

- `classificarFalha(err, { dependencia?, deriva? })` → `Falha { veredito, motivo, kind, status, url }`.
  Verdicts: `indisponivel`, `respondeu`, `ambiguo`, `alheio` (from mcp-upstream) and
  `dependencia` (the capture was never attempted because one it depends on failed; recognised
  by the predicate you pass — the package does not know your error class). `deriva` is only
  consulted for an error that did not come from the source and turns it into `respondeu`
  ("the source answered and the contract failed on what arrived").
- `Disjuntor(limite = 5)`: `registrarCaptura()`, `registrarFalha(veredito)`, `disparou`,
  `sequencia`, `capturadas`; pure form `disjuntorDisparou(capturadas, sequencia, limite)`.
  `indisponivel` counts, `respondeu`/`ambiguo` reset, `dependencia`/`alheio` leave it alone;
  it only trips while nothing has been captured.
- `capturarComRetentativa(fn, { tentativas = 3, esperaMs = n => 2000·n, repetir, aoRepetir, aoDesistir, dependencia, deriva, dormir })`:
  rethrows the **last** error intact. By default repeats everything except `dependencia`
  and `respondeu`.
- `Relatorio({ dependencia?, deriva?, limiteDoDisjuntor? })`: `registrarCaptura(nome, ms)`,
  `registrarFalha(nome, err, ms, { idas? })`, `registrarNaoMedida(nome, motivo)` (never
  attempted: the breaker had tripped), `deveParar`, `resumo()`, `codigoDeSaida()`,
  `anotacoes()`, `escrever({ log?, comando?, env?, anexar?, codigoDeSaida? })` (every sink
  injectable; the summary goes to the file named by `GITHUB_STEP_SUMMARY` when the variable
  exists; `codigoDeSaida: false` drops the "código de saída" line when the runner owns the
  exit code).
- `anotacao(nivel, titulo, mensagem)`, `escaparMensagem`, `escaparPropriedade`: workflow
  commands with the runner's escaping (`%`, `\r`, `\n` in the message; `:` and `,` too in
  properties). `resumoMarkdown(resumo)`, `linhasDeConclusao(resumo, { codigoDeSaida? })`,
  `linhaDeResultado(r)`.
- Exit codes: `SAIDA_OK` (0), `SAIDA_FALHA` (1), `SAIDA_FONTE_INALCANCAVEL` (3).
- Test runners: `criarSuiteAoVivo(ganchos, { retentativa?, destinos?, dependencia?, deriva?,
  limiteDoDisjuntor? })` → `{ aoVivo, relatorio }`; `aoVivo(nome, fn, { endpoint?, timeout?,
  tentativas?, esperaMs?, repetir?, … })`; `repetirAoVivo`, `ehAssercao`. Bound to vitest in
  `@sbissoli/mcp-live-source/vitest` as `suiteAoVivo(opcoes?)`.

## Glossary

| pt | en |
|---|---|
| fonte viva | live source |
| veredito | verdict |
| indisponível / respondeu / ambíguo / alheio / dependência | unavailable / answered / ambiguous / not the source's / dependency |
| disjuntor | circuit breaker |
| capturar com retentativa | capture with retry |
| relatório, resumo, anotação | report, summary, annotation |
| deriva de formato | shape drift |
| saída | exit (code) |
| ao vivo, suíte ao vivo | live, live suite |
| asserção | assertion |
| não medida | not measured |

## License

MIT
