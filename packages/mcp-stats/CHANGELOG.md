# Changelog — @sbissoli/mcp-stats

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões seguem
semver; em 0.x, mudança de contrato publicado é minor (caret `^0.x` não cobre o minor
seguinte — cada consumidor faz bump explícito).

**Este arquivo foi reconstruído em 2026-10-08**, porque o pacote não tinha changelog até
então. Fontes: as datas de publicação do npm (`npm view @sbissoli/mcp-stats time`, em UTC,
que dão a data de cada seção), o publicador e a atestação de cada versão no registro, os
commits de `packages/mcp-stats` (o que sobe `version` no `package.json` marca a versão) e
os PRs citados. As 0.1.0 e 0.2.0 foram publicadas à mão, sem atestação; a 0.3.0 por
trusted publishing (OIDC), ainda sem atestação; a 0.3.1 é a primeira atestada (SLSA).

## [Não lançado]

### Alterado

- `LICENSE` (MIT) no pacote e autor com o nome completo no `package.json` (#39). Entram
  na próxima versão publicada.

## [0.3.1] — 2026-09-22

Patch de publicação: nenhuma linha de código muda. A atestação de proveniência não é
retroativa — prende-se no ato de publicar —, então a versão nova existe para sair
ATESTADA (SLSA), agora que o repositório é público. (#15)

### Corrigido

- `repository` declarado no `package.json`, com `directory: packages/mcp-stats`: sem o
  campo o npm não sabe qual repositório atestar, e num monorepo sem `directory` atestaria
  a raiz. Foi o que deixou a 0.3.0, publicada por OIDC, sem atestação. (#8)

## [0.3.0] — 2026-09-14

### Alterado

- **Conjunto vazio é INDEFINIDO, nunca zero** (quebra o contrato da 0.2.x). `min`, `max`,
  `mean`, `median`, `stdDev` e todos os percentis saem `null` com `reason: "no-records"`
  quando `n === 0`; `n` e `sum` seguem numéricos. `percentile([], q)` devolve `null`. Na
  exibição, `formatStats` troca o bloco por um aviso, `labeledPercentiles` rotula percentil
  indefinido sem citar valor e `formatGrouped` explica a lista vazia; `percentileUndefinedLabel`
  e `noRecordsNotice` em pt-BR e en. Defeito medido em produção no senado-br-mcp em
  14/09/2026: um filtro sem registro respondia "mediana — metade dos valores é igual ou
  inferior a R$ 0,00", com proveniência completa. 12 casos em `tests/sem-registros.test.ts`.
  **Migração:** os campos passam de `number` para `number | null` — `Math.round(null)` é `0`
  e reintroduz o defeito. (#6)
- `engines.node` declarado (`>=20` em 31/08, depois `>=22` no mesmo dia, quando o Node 20
  saiu de suporte em 30/04/2026). (commits 4e56261 e b40b52f)
- Primeira versão publicada por trusted publishing (OIDC, GitHub Actions), ainda sem
  atestação (ver 0.3.1).

## [0.2.0] — 2026-08-12

### Adicionado

- **Correlação bivariada** (`src/correlation.ts`): Pearson em duas passadas (desvios em
  torno da média, sem o atalho de somas de quadrados, que perde dígitos em série de média
  grande e variância pequena) e Spearman como Pearson sobre os postos, com posto médio nos
  empates. Descarte aos pares, com `n` e `dropped` na resposta. Coeficiente indefinido é
  `null` com `reason`, nunca 0. O módulo não pareia séries de propósito: alinhar grades
  temporais é trabalho de domínio. Pedido da fase bcb, arbitrado para o componente comum.
  (commit 8bd99ea)

## [0.1.0] — 2026-08-07

### Adicionado

- Primeira versão (Fase 0, Entregável 3): motor de estatísticas generalizado do
  `src/utils/estatisticas.ts` do senado — núcleo de cálculo (percentil type 7, desvio
  populacional, desempate estável, agrupamento com teto) separado da camada de exibição
  com chaves por idioma (pt-BR byte-compatível com o senado, com teste de compatibilidade;
  en para servidores internacionais). `parseBRL` como utilitário. Zero dependências.
  (commit c7835cc)
