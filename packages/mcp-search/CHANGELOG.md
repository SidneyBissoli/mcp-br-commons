# Changelog — @sbissoli/mcp-search

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões seguem
semver; em 0.x, superfície publicada que muda é minor (caret `^0.x` não cobre o minor
seguinte — cada servidor faz bump explícito). As versões anteriores a 0.7.0 estão no
histórico do git (`git log -- packages/mcp-search`).

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
