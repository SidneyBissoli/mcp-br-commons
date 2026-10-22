# Changelog — @sbissoli/mcp-live-source

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões seguem
semver; em 0.x, superfície publicada que muda é minor (caret `^0.x` não cobre o minor
seguinte — cada servidor faz bump explícito). Os TÍTULOS das anotações (`TITULO_*`) são
contrato com o painel do portfólio: mudar um é minor com nota de migração.

## [0.2.1] — 2026-10-22

Patch: o único comportamento que muda é o do arquivo vitest em que NADA foi capturado.

### Corrigido
- **Disjuntor disparado no vitest = o arquivo FALHA** (`afterAll` lança), como o código 3
  do script de captura — opção `falharSeInalcancavel` (padrão `true`). Medido no primeiro
  dispatch real do ibge depois do 0.2.0 (run 39850550875): os quatro arquivos saíram
  VERDES com `::error title=Fonte inalcançável` (3 indisponíveis seguidas, nada capturado
  em cada um) — era o runner bloqueado pela origem (regime medido em 12/09/2026, cura =
  runner novo), e o `integration-retry.yml` só re-roda em `failure`. Verde ali perdia a
  noite: a 0.2.0 deixava "verde com skips" porque "o runner decide a saída", mas a política
  do dono diz que nada respondeu é vermelho. Prova de ponta a ponta nova
  (`tests/fixtures/vitest/inalcancavel.fixture.ts`): 4 pulados, c e d sem ir à rede, saída 1.

## [0.2.0] — 2026-10-22

Minor: superfície nova (subpath `./vitest`, `criarSuiteAoVivo`, predicado `deriva`,
`registrarNaoMedida`); nada do que existia muda. Peça 4 do item
`mcp:fonte-indisponivel-nao-e-deriva`: os irmãos cujo tier vivo é um arquivo de teste
(bcb, ilo, ibge, medical) passam a emitir o mesmo contrato de anotações que o senado.

### Adicionado
- **`@sbissoli/mcp-live-source/vitest`** — `suiteAoVivo(opcoes?)` → `{ aoVivo, relatorio }`.
  `aoVivo(nome, fn, { endpoint?, timeout?, tentativas?, … })` envolve `it`: `indisponivel`
  (depois das idas) → teste **pulado** com a nota `Fonte indisponível: …` (vitest sai 0 quando
  só há skips); `ambiguo` → repete e, se persistir, falha; `respondeu` e `alheio` → falha sem
  repetir. Um `Relatorio` por arquivo, escrito no `afterAll` (log, anotações,
  `$GITHUB_STEP_SUMMARY`; nada quando o arquivo não rodou teste ao vivo). O disjuntor vale:
  depois de N indisponíveis seguidos sem captura, os testes seguintes pulam **sem ir à rede**
  (`Fonte inalcançável`, job verde — a saída é do runner). `vitest` é peer OPCIONAL (`^5`);
  o entrypoint raiz não o importa.
- **`criarSuiteAoVivo(ganchos, opcoes)`** no entrypoint raiz: o núcleo sem runner (`it`,
  `afterAll` e um contexto cujo `skip(nota)` lança) — testável com dublê, ligável a outro
  runner. `repetirAoVivo` (só `indisponivel` e `ambiguo`) e `ehAssercao`.
- **`deriva`** em `OpcoesDeClassificacao` (e por tabela em `capturarComRetentativa` e
  `Relatorio`): predicado consultado só para erro que NÃO veio da origem; vira `respondeu`
  ("a origem respondeu e o contrato falhou no que chegou"). Num teste, a asserção que falha
  é a deriva que ele existe para medir — sem isso saía `alheio`, "defeito nosso", e o
  painel leria "falha alheia" onde houve deriva medida. Padrão do adaptador: `AssertionError`.
- **`Relatorio.registrarNaoMedida(nome, motivo)`**: captura nem tentada porque o disjuntor
  já tinha disparado; conta em `naoMedidas`, não mexe no disjuntor.
- **`escrever({ codigoDeSaida: false })`** / `linhasDeConclusao(resumo, { codigoDeSaida })`:
  sem a linha "código de saída: N" quando quem decide a saída é o runner.

### Medido
- O reporter padrão do vitest 5.0.5 ENGOLE o `console.log` de testes e hooks (só
  `--reporter=verbose` mostra, prefixado com `stdout | arquivo`); `process.stdout.write` do
  worker chega ao stdout do processo no início da linha, que é onde o runner do Actions
  reconhece `::warning`. O adaptador escreve por `process.stdout.write`. Provado de ponta a
  ponta por `tests/vitest-adaptador.test.ts`, que roda um vitest filho sobre
  `tests/fixtures/vitest/` e lê código de saída, stdout e resumo.

## [0.1.1] — 2026-10-22

Primeira versão publicada pelo workflow (trusted publishing, com atestação); a 0.1.0 saiu
à mão. Patch: superfície só cresce com opções novas, nada do que existia muda.

### Adicionado
- **`aoDesistir(idas, falha)`** em `capturarComRetentativa` e **`idas`** em
  `registrarFalha(nome, err, ms, { idas })` / `ResultadoFalho`: quantas vezes o SCRIPT
  tentou a captura. O `motivo` da origem conta as tentativas de UMA ida (um timeout é
  "1 tentativa" no mcp-upstream), e na primeira rodada em CI (senado, 22/10/2026) a
  linha dizia "em 1 tentativa" depois de três idas de 36 s. A linha do log passa a trazer
  `(36008ms, 3 idas)` e a tabela do resumo ganha a coluna "Idas" — quando o script
  informa; sem informar, nada muda.

### Medido
- Primeira rodada real em CI (senado `contract-tests`, dispatch de 22/10/2026 18:38 UTC):
  62 de 64 capturadas, 2 timeouts, código 0, `::warning title=Fonte indisponível::
  comissao-detalhe, processo-relatoria` legível em `check-runs/{job}/annotations`, resumo
  no job. É o contrato que o painel do portfólio passa a ler (peça 3).

## [0.1.0] — 2026-10-22

Primeira versão. Extraída do `scripts/contract/outage.ts` + `refresh-fixtures.ts` do
`senado-br-mcp-cloudflare` (item `mcp:fonte-indisponivel-nao-e-deriva`, peça 2), com a
política decidida pelo dono em 22/10/2026.

### Adicionado
- **`classificarFalha(err, { dependencia? })`**: o veredito de `entregaDaOrigem`
  (mcp-upstream ≥ 0.5.1, que segue a cadeia `cause`) mais `dependencia`, reconhecida por
  predicado do consumidor.
- **`Disjuntor`** / `disjuntorDisparou`: igual ao do senado, com uma diferença medida —
  **5xx e 429 CONTAM na sequência** (lá o erro traduzido dizia `transport=false` e o 5xx
  zerava o disjuntor; uma noite de 502 em tudo caminhava o manifesto até o teto do job).
- **`capturarComRetentativa`**: 3 tentativas, 2 s · n de espera, não repete `dependencia`
  nem `respondeu`; relança o último erro intacto.
- **`Relatorio`**: a política numa tabela só — verde com `::warning title=Fonte
  indisponível::a, b` quando a única falha é a fonte fora (e ≥ 1 captura), código 3 com
  `::error title=Fonte inalcançável::…` no disjuntor, código 1 com `Deriva de formato` /
  `Ambíguo (deriva ou página de erro)` / `Falha alheia à origem` nos demais. Escreve
  stdout, as anotações e o `$GITHUB_STEP_SUMMARY` (tabela por veredito, "deriva NÃO
  medida em N endpoints"), com todo destino injetável.
- Helpers puros de GitHub Actions: `anotacao` com o escape do runner, `resumoMarkdown`,
  `linhasDeConclusao`, `linhaDeResultado`.
- Testes offline: tabela de vereditos × política, disjuntor com 5xx contando, cadeia
  `cause`, dependência, escape, e os dois casos reais — 22/10/2026 (63 ok + um 502 nas
  três tentativas → 0 com aviso) e 16–17/10/2026 (nada respondeu → 3).
