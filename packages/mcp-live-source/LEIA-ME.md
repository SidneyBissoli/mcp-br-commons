# @sbissoli/mcp-live-source

Repórter de teste contra a **fonte viva** (teste de contrato, smoke pós-deploy, sonda de
recuperação). Separa "a fonte mudou" (deriva, defeito a corrigir) de "a fonte está fora"
(nada a corrigir, medir de novo amanhã), mantém o disjuntor, repete o que vale repetir e
escreve o resumo do job e as anotações do GitHub Actions num contrato fixo que o painel do
portfólio lê.

*In English: [README.md](./README.md).*

## Por quê

Medido em 22/10/2026 no servidor do Senado: 63 endpoints responderam normalmente, um
respondeu 502 nas três tentativas, e o job noturno de contrato ficou vermelho três vezes
(o retry automático gastou as tentativas num 502 que persistia). O painel do portfólio
disse "a fonte mudou". Não tinha mudado. Detector de deriva que dá alarme falso em queda
da fonte é detector que deixa de ser lido.

O veredito em si vem de [`entregaDaOrigem`](https://www.npmjs.com/package/@sbissoli/mcp-upstream)
do `@sbissoli/mcp-upstream`, decidido pelo `kind` do erro, nunca pela frase. Este pacote
põe em cima o que um repórter precisa: o veredito `dependencia`, o disjuntor, a
retentativa e a política.

## A política

Decidida uma vez, para todo consumidor (dono do portfólio, 22/10/2026):

| O que aconteceu | Código de saída | Anotação |
|---|---|---|
| Tudo capturado | `0` | — |
| Só `indisponivel` / `dependencia`, com pelo menos uma captura | **`0`** (verde) | `::warning title=Fonte indisponível::a, b` |
| Disjuntor (nada capturado, N indisponíveis seguidas) | **`3`** | `::error title=Fonte inalcançável::…` |
| Qualquer `respondeu` (404 / 4xx: a origem recusou o pedido) | `1` | `::error title=Deriva de formato::a, b` |
| Qualquer `ambiguo` que persistiu nas tentativas | `1` | `::error title=Ambíguo (deriva ou página de erro)::a` |
| Qualquer `alheio` (defeito nosso) | `1` | `::error title=Falha alheia à origem::a` |

Verde com aviso, e não vermelho rotulado: o vermelho dispara o retry automático (três
tentativas num 502 que persiste) e pinta o painel de "a fonte mudou". A fixture do
endpoint não medido fica a commitada, e o teste "live" roda sobre ela — honesto, porque
o resumo diz "deriva NÃO medida em N endpoints".

A mensagem da anotação `Fonte indisponível` é a lista de nomes dos endpoints, separada
por vírgula e espaço. O painel conta noites por endpoint a partir dela (três noites
seguidas abrem um item). Os títulos são constantes exportadas (`TITULO_*`): mudar um é
mudar o contrato.

## Uso (script de captura)

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
    gravar(spec, raw);
    console.log(linhaDeResultado(relatorio.registrarCaptura(spec.name, Date.now() - t0)));
  } catch (err) {
    console.log(linhaDeResultado(relatorio.registrarFalha(spec.name, err, Date.now() - t0)));
  }
  if (relatorio.deveParar) break;
}

const resumo = relatorio.escrever(); // stdout + anotações + $GITHUB_STEP_SUMMARY (quando existe)
process.exit(resumo.codigoDeSaida);
```

O servidor precisa passar o erro do pacote como `cause` da classe de erro dele
(`new MeuErro(msg, { cause: err })`); `entregaDaOrigem` segue a cadeia desde o
mcp-upstream 0.5.1. Sem isso toda falha é `alheio`.

## API

- `classificarFalha(err, { dependencia? })` → `Falha { veredito, motivo, kind, status, url }`.
  Vereditos: `indisponivel`, `respondeu`, `ambiguo`, `alheio` (do mcp-upstream) e
  `dependencia` (a captura nem foi tentada porque outra de que depende falhou; reconhecida
  pelo predicado que você passa — o pacote não conhece a sua classe de erro).
- `Disjuntor(limite = 5)`: `registrarCaptura()`, `registrarFalha(veredito)`, `disparou`,
  `sequencia`, `capturadas`; forma pura `disjuntorDisparou(capturadas, sequencia, limite)`.
  `indisponivel` conta, `respondeu`/`ambiguo` zeram, `dependencia`/`alheio` não mexem; só
  dispara enquanto nada foi capturado.
- `capturarComRetentativa(fn, { tentativas = 3, esperaMs = n => 2000·n, repetir, aoRepetir, dependencia, dormir })`:
  relança o **último** erro intacto. Por padrão repete tudo menos `dependencia` e `respondeu`.
- `Relatorio({ dependencia?, limiteDoDisjuntor? })`: `registrarCaptura(nome, ms)`,
  `registrarFalha(nome, err, ms)`, `deveParar`, `resumo()`, `codigoDeSaida()`,
  `anotacoes()`, `escrever({ log?, comando?, env?, anexar? })` (todo destino é injetável;
  o resumo vai ao arquivo nomeado por `GITHUB_STEP_SUMMARY` quando a variável existe).
- `anotacao(nivel, titulo, mensagem)`, `escaparMensagem`, `escaparPropriedade`: comandos
  de workflow com o escape do runner (`%`, `\r`, `\n` na mensagem; `:` e `,` também nas
  propriedades). `resumoMarkdown(resumo)`, `linhasDeConclusao(resumo)`, `linhaDeResultado(r)`.
- Códigos de saída: `SAIDA_OK` (0), `SAIDA_FALHA` (1), `SAIDA_FONTE_INALCANCAVEL` (3).

Um adaptador vitest (`aoVivo(nome, fn)` + reporter, para servidores cujo tier vivo é um
arquivo de teste e não um script de captura) está planejado para o próximo minor.

## Licença

MIT
