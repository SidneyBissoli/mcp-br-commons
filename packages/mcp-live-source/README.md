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

## API

- `classificarFalha(err, { dependencia? })` → `Falha { veredito, motivo, kind, status, url }`.
  Verdicts: `indisponivel`, `respondeu`, `ambiguo`, `alheio` (from mcp-upstream) and
  `dependencia` (the capture was never attempted because one it depends on failed; recognised
  by the predicate you pass — the package does not know your error class).
- `Disjuntor(limite = 5)`: `registrarCaptura()`, `registrarFalha(veredito)`, `disparou`,
  `sequencia`, `capturadas`; pure form `disjuntorDisparou(capturadas, sequencia, limite)`.
  `indisponivel` counts, `respondeu`/`ambiguo` reset, `dependencia`/`alheio` leave it alone;
  it only trips while nothing has been captured.
- `capturarComRetentativa(fn, { tentativas = 3, esperaMs = n => 2000·n, repetir, aoRepetir, dependencia, dormir })`:
  rethrows the **last** error intact. By default repeats everything except `dependencia`
  and `respondeu`.
- `Relatorio({ dependencia?, limiteDoDisjuntor? })`: `registrarCaptura(nome, ms)`,
  `registrarFalha(nome, err, ms)`, `deveParar`, `resumo()`, `codigoDeSaida()`,
  `anotacoes()`, `escrever({ log?, comando?, env?, anexar? })` (every sink injectable;
  the summary goes to the file named by `GITHUB_STEP_SUMMARY` when the variable exists).
- `anotacao(nivel, titulo, mensagem)`, `escaparMensagem`, `escaparPropriedade`: workflow
  commands with the runner's escaping (`%`, `\r`, `\n` in the message; `:` and `,` too in
  properties). `resumoMarkdown(resumo)`, `linhasDeConclusao(resumo)`, `linhaDeResultado(r)`.
- Exit codes: `SAIDA_OK` (0), `SAIDA_FALHA` (1), `SAIDA_FONTE_INALCANCAVEL` (3).

A vitest adapter (`aoVivo(nome, fn)` + reporter, for servers whose live tier is a test
file rather than a capture script) is planned for the next minor.

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

## License

MIT
