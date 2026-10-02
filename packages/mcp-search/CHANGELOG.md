# Changelog — @sbissoli/mcp-search

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões seguem
semver; em 0.x, superfície publicada que muda é minor (caret `^0.x` não cobre o minor
seguinte — cada servidor faz bump explícito). As versões anteriores a 0.7.0 estão no
histórico do git (`git log -- packages/mcp-search`).

## [0.9.0] — 2026-10-02

Fecha a última lacuna da classe medida em 11/09/2026 ("esquema que não recusa responde
outra pergunta"): nos sete servidores, só `search` e `fetch` ainda descartavam parâmetro
desconhecido em silêncio — o zod tirava a chave, o default entrava no lugar e a tool
respondia OUTRA pergunta com cara de resposta. Ficaram de fora em 11/09 porque o
contrato é da OpenAI; a doc dele (developers.openai.com/api/docs/mcp, relida hoje) define
UM argumento string por tool e nada mais, então recusar o resto não recusa chamada
nenhuma que o contrato admita.

### Mudado
- `searchInputSchema` e `fetchInputSchema` passam a `z.strictObject`: o JSON publicado
  (no `registerDeepResearchTools` e em `contractJsonSchemas`) leva
  `additionalProperties: false`, e a chave fora do contrato volta como erro que a
  NOMEIA, antes de o acervo ser consultado. Superfície publicada que muda = minor.

### Atenção a quem consome
- Registrar pelo `.shape` (`z.object(contractSchemas().searchInputSchema.shape)`) perde a
  estrição. Passe o objeto, ou aplique `.strict()` do seu lado.
- A recusa é feita pela SDK antes do callback: não passa pela telemetria (`record`),
  como nas demais tools estritas da frota.

## [0.8.1] — 2026-09-30

### Corrigido
- `peerDependencies`: `@modelcontextprotocol/server` volta a `^2.0.0`. O Dependabot (#24,
  29/09) subiu o peer para `^2.1.0` junto com a devDependency, e a 0.8.0 saiu com ele:
  o senado-br-mcp não instala, porque o `agents` 0.24.0 (a última) fixa a SDK em 2.0.0.
  O pacote só importa TIPOS da SDK (`CallToolResult`, `McpServer`, `ToolAnnotations`),
  presentes desde a 2.0.0. O `dependabot.yml` passa a `increase-if-necessary`, para não
  repetir.

## [0.8.0] — 2026-09-30

Medido em 30/09/2026 na varredura da frota depois da prova de produção da classe do
erro: `search` e `fetch` eram as únicas tools classificadas SÓ pela frase. Toda exceção
virava texto em `onError` e o tipo se perdia — o timeout da origem no `fetch` do bcb saía
`outro`, o 429 no ibge saía `contrato` (que o painel exclui da taxa de erro) — e o id
desconhecido ecoado em `notFound` puxava `contrato` quando o id continha "invalid".

### Adicionado
- `classifyThrown?: (error) => string | undefined` — a classe de uma exceção pelo TIPO
  (o `classifyThrown` do servidor). Vazio devolve a decisão à frase.
- `CLASSE_DO_ERRO` (exportado): a classe decidida pelo tipo também viaja no RESULTADO, numa
  chave-símbolo não enumerável (a da frota, `Symbol.for("br.com.sidneybissoli.mcp/classe-do-erro")`),
  para o hook dos servidores que capturam o handler e o embrulham (bcb, medical, senado).

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
