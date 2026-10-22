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

## Uso (vitest)

Para servidor cujo tier vivo é um arquivo de teste, não um script de captura. O `vitest`
é peer opcional (`^5`); o subpath o importa, o entrypoint raiz não.

```ts
import { describe, expect } from "vitest";
import { createUpstream } from "@sbissoli/mcp-upstream";
import { suiteAoVivo } from "@sbissoli/mcp-live-source/vitest";

const upstream = createUpstream({ timeoutMs: 45_000, retries: 0 }); // UM ponto de rede: o erro do pacote carrega o `kind`
const { aoVivo } = suiteAoVivo();                                 // um relatório por arquivo; escrito no afterAll

describe.runIf(LIVE)("contrato do catálogo SGS", () => {
  for (const serie of SERIES) {
    aoVivo(
      `SGS ${serie.codigo} — ${serie.nome}`,
      async () => {
        const [ponto] = await upstream.call().json<Ponto[]>(url(serie.codigo));
        expect(idadeEmDias(ponto.data)).toBeLessThanOrEqual(serie.toleranciaDias);
      },
      { endpoint: `sgs-${serie.codigo}`, timeout: 180_000 },
    );
  }
});
```

A política, traduzida para teste — o código de saída do processo é do runner, e o vitest
sai 0 quando os únicos testes que não passaram foram pulados:

| veredito (depois das idas) | o teste | anotação (no `afterAll`) |
|---|---|---|
| capturado | passa | — |
| `indisponivel` (timeout, rede, 429, 5xx) | **pulado**, nota `Fonte indisponível: …` | `::warning title=Fonte indisponível::a, b` |
| `ambiguo` (persistiu) | falha | `::error title=Ambíguo (deriva ou página de erro)::a` |
| `respondeu` (404/4xx **ou a asserção do próprio teste**) | falha | `::error title=Deriva de formato::a` |
| `alheio` (um `TypeError` nosso) | falha | `::error title=Falha alheia à origem::a` |
| disjuntor (N indisponíveis seguidos, nada capturado) | os testes seguintes pulam **sem ir à rede** | `::error title=Fonte inalcançável::…` (job segue verde: quem decide a saída é o runner) |

Só `indisponivel` e `ambiguo` são repetidos (`repetirAoVivo`); a asserção que falha é a
deriva que o teste existe para medir, então não se repete e sai rotulada como deriva, não
como "defeito nosso" (predicado `deriva`, padrão `ehAssercao`: `err.name ===
"AssertionError"`). `endpoint` é o rótulo curto pelo qual o painel conta noites (sem
vírgula); padrão é o nome do teste. O disjuntor depende de os testes do arquivo rodarem em
sequência — não usar `describe.concurrent` com `aoVivo`. O relatório escreve com
`process.stdout.write`, não `console.log`: o reporter padrão do vitest 5 engole o console
dos testes e dos hooks, e o runner do Actions só reconhece `::warning` no início de uma
linha do stdout (medido em 22/10/2026, vitest 5.0.5). Nada é escrito quando o arquivo não
rodou nenhum teste ao vivo (`describe.runIf(false)`).

O núcleo independente de runner é `criarSuiteAoVivo({ it, afterAll }, opcoes)`, no
entrypoint raiz: liga-se a outro runner (node:test) dando os ganchos e um contexto cujo
`skip(nota)` lança.

## API

- `classificarFalha(err, { dependencia?, deriva? })` → `Falha { veredito, motivo, kind, status, url }`.
  Vereditos: `indisponivel`, `respondeu`, `ambiguo`, `alheio` (do mcp-upstream) e
  `dependencia` (a captura nem foi tentada porque outra de que depende falhou; reconhecida
  pelo predicado que você passa — o pacote não conhece a sua classe de erro). `deriva` só é
  consultado para erro que NÃO veio da origem e o transforma em `respondeu` ("a origem
  respondeu e o contrato falhou no que chegou").
- `Disjuntor(limite = 5)`: `registrarCaptura()`, `registrarFalha(veredito)`, `disparou`,
  `sequencia`, `capturadas`; forma pura `disjuntorDisparou(capturadas, sequencia, limite)`.
  `indisponivel` conta, `respondeu`/`ambiguo` zeram, `dependencia`/`alheio` não mexem; só
  dispara enquanto nada foi capturado.
- `capturarComRetentativa(fn, { tentativas = 3, esperaMs = n => 2000·n, repetir, aoRepetir, aoDesistir, dependencia, deriva, dormir })`:
  relança o **último** erro intacto. Por padrão repete tudo menos `dependencia` e `respondeu`.
- `Relatorio({ dependencia?, deriva?, limiteDoDisjuntor? })`: `registrarCaptura(nome, ms)`,
  `registrarFalha(nome, err, ms, { idas? })`, `registrarNaoMedida(nome, motivo)` (nem foi
  tentada: o disjuntor já tinha disparado), `deveParar`, `resumo()`, `codigoDeSaida()`,
  `anotacoes()`, `escrever({ log?, comando?, env?, anexar?, codigoDeSaida? })` (todo destino
  é injetável; o resumo vai ao arquivo nomeado por `GITHUB_STEP_SUMMARY` quando a variável
  existe; `codigoDeSaida: false` tira a linha "código de saída" quando a saída é do runner).
- `anotacao(nivel, titulo, mensagem)`, `escaparMensagem`, `escaparPropriedade`: comandos
  de workflow com o escape do runner (`%`, `\r`, `\n` na mensagem; `:` e `,` também nas
  propriedades). `resumoMarkdown(resumo)`, `linhasDeConclusao(resumo, { codigoDeSaida? })`,
  `linhaDeResultado(r)`.
- Códigos de saída: `SAIDA_OK` (0), `SAIDA_FALHA` (1), `SAIDA_FONTE_INALCANCAVEL` (3).
- Runners de teste: `criarSuiteAoVivo(ganchos, { retentativa?, destinos?, dependencia?,
  deriva?, limiteDoDisjuntor? })` → `{ aoVivo, relatorio }`; `aoVivo(nome, fn, { endpoint?,
  timeout?, tentativas?, esperaMs?, repetir?, … })`; `repetirAoVivo`, `ehAssercao`. Ligado ao
  vitest em `@sbissoli/mcp-live-source/vitest` como `suiteAoVivo(opcoes?)`.

## Licença

MIT
