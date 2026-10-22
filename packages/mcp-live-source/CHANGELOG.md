# Changelog — @sbissoli/mcp-live-source

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões seguem
semver; em 0.x, superfície publicada que muda é minor (caret `^0.x` não cobre o minor
seguinte — cada servidor faz bump explícito). Os TÍTULOS das anotações (`TITULO_*`) são
contrato com o painel do portfólio: mudar um é minor com nota de migração.

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
