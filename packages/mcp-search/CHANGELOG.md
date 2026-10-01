# Changelog — @sbissoli/mcp-search

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões seguem
semver; em 0.x, superfície publicada que muda é minor (caret `^0.x` não cobre o minor
seguinte — cada servidor faz bump explícito). As versões anteriores a 0.7.0 estão no
histórico do git (`git log -- packages/mcp-search`).

## [0.8.0] — 2026-09-30

Medido em 30/09/2026 na varredura da frota depois da prova de produção da classe do
erro: `search` e `fetch` eram as únicas tools classificadas SÓ pela frase. Toda exceção
virava texto em `onError` e o tipo se perdia — o timeout da origem no `fetch` do bcb saía
`outro`, o 429 no ibge saía `contrato` (que o painel exclui da taxa de erro) — e o id
desconhecido ecoado em `notFound` puxava `contrato` quando o id continha "invalid".

### Adicionado
- `classifyThrown?: (error) => string | undefined` — a classe de uma exceção pelo TIPO
  (o `classifyThrown` do servidor). Vazio devolve a decisão à frase.

### Corrigido
- Com `classifyError` presente, a classe do `tool_error` vem do TIPO quando há um, e da
  frase só no resto: id desconhecido em `fetch` -> `nao_encontrado`; exceção com
  `error.classe` (string não vazia) -> essa classe; senão `classifyThrown(error)`.
- O texto devolvido ao cliente não muda.

### Inalterado
- Sem `classifyError`, a classe continua vazia (o vocabulário é de cada servidor).

## [0.7.0] — 2026-09-27

Medido no bcb-br-mcp em 27/09/2026 pelo `--dry` do runner de sessão longa:
`bcb_buscar_serie("IGP-M")` devolvia ZERO, e "IGP" achava a série 189. A fronteira de
palavra (0.6.0) já tratava o hífen como separador no TEXTO, mas a consulta ficava
inteira — "igp-m" era um padrão só, e um padrão com hífen não começa palavra nenhuma num
texto onde o hífen separa. Assimetria dentro do pacote; a correção é do pacote.

### Corrigido
- `createVocabulary().normalize` troca hífens (e os traços U+2010–U+2014) por espaço nos
  DOIS lados — consulta, tabela e texto. "IGP-M" casa "IGP-M - Variação mensal" e
  "IGP M"; "igp m" casa "IGP-M"; "covid-19" casa "COVID-19"; "pre primary" casa
  "Pre-primary".
- A palavra composta da consulta vira FRASE (`"igp m"` é um termo, não dois): "IGP-M"
  NÃO casa "IGP-DI - Variação mensal" pela letra `m` de "mensal".
- `askedWordsFor` (a ponta inversa do índice de `search`) usa a mesma normalização.

### Inalterado
- `tokenize`/ranking de `search` já quebravam em `[^a-z0-9]+` e nunca tiveram o defeito.
- A fronteira de palavra continua só no INÍCIO (radicais da tabela seguem valendo).
