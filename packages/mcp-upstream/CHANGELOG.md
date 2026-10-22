# Changelog — @sbissoli/mcp-upstream

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões seguem
semver; em 0.x, superfície publicada que muda é minor (caret `^0.x` não cobre o minor
seguinte — cada servidor faz bump explícito).

## [0.5.1] — 2026-10-22

Patch: o único comportamento que muda é o de um erro que na 0.5.0 saía `alheio`.

### Corrigido
- **`entregaDaOrigem` segue a cadeia `cause`** até achar o `UpstreamError` do pacote. Os
  servidores traduzem o erro do pacote para uma classe local antes de ele chegar ao teste
  de contrato (o senado para o seu `UpstreamError`, o medical para `HttpError`), e na 0.5.0
  esse erro traduzido caía em `alheio` — "defeito do nosso código" — mesmo quando a origem
  tinha respondido 502. Basta o servidor passar o erro do pacote como `cause` (ES2022) e o
  veredito volta a ser o da origem; a classe e a mensagem locais ficam. A busca para no
  primeiro `UpstreamError` e tem teto de profundidade (ciclo em `cause` não trava). Erro
  sem `UpstreamError` na cadeia continua `alheio`. É o que o repórter de teste vivo
  (`@sbissoli/mcp-fonte-viva`) precisa para classificar sem que cada servidor reescreva
  a tradução.

## [0.5.0] — 2026-10-22

Export novo; nada do que existia muda. Minor porque a superfície publicada cresce
(caret `^0.4` não a alcança — cada servidor faz bump explícito quando for consumir).

### Adicionado
- **`entregaDaOrigem(err)`: a origem entregou algo medível?** Vocabulário fechado de
  quatro vereditos pelo `kind` do `UpstreamError`, nunca pela frase: `indisponivel`
  (timeout, rede, 429, 5xx — deriva NÃO foi medida), `respondeu` (404, outro 4xx — é
  resposta, território de contrato), `ambiguo` (`malformed_body` — formato mudou OU a
  origem serviu a página de erro a um pedido bom; se resolve por repetição) e `alheio`
  (abort do chamador ou erro que não é da origem). Com `motivo` em pt-BR para o log e
  `kind`/`status`/`url` de passagem. Motivo, medido em 22/10/2026 duas vezes no mesmo
  dia: o smoke pós-deploy do bcb reprovou duas reexecuções com o SGS em 502 (a frase do
  erro escapava da regex de "upstream fora"), e o teste de contrato do senado reprovou
  três tentativas porque UM endpoint respondeu 502 — o classificador local só separava
  "nada respondeu" de "outra coisa", e o painel do portfólio abriu "a fonte mudou". Os
  dois reinventavam por frase uma decisão que é função do `kind`; agora ela é uma só.
  A função NÃO carrega política (aviso, teste pulado, código de saída é do repórter de
  cada formato — peça seguinte do mesmo item). Testes cobrem a tabela inteira de kinds,
  os erros reais de 22/10 e uma ida de ponta a ponta pelo `createUpstream`.

## [0.4.3] — 2026-10-14

Só documentação e teste: código e API NÃO mudam.

### Corrigido
- **O README dizia que `timeoutMs` cobre "cabeçalhos + corpo" em todo modo**, e no modo
  `response` isso é falso: o cronômetro é desarmado quando a `Response` é devolvida, e o corpo
  lido depois não tem prazo do pacote. README, LEIA-ME e o JSDoc de `timeoutMs` e de
  `response()` agora dizem onde o prazo termina e dão a receita (usar `text()`/`json()`, ou
  um `signal` próprio abortado só depois da ida). Achado em 13/10/2026: o senado lia o corpo
  sem prazo em dois pontos, confiando na frase (consertado no servidor, 3.18.4). Um teste
  novo trava o comportamento documentado.

## [0.4.2] — 2026-10-08

### Mudado
- Dependência `@sbissoli/mcp-provenance`: `^0.2.0 || ^0.3.0` → `^0.2.0 || ^0.3.0 ||
  ^0.4.0` (contrato v1.3), pelo mesmo motivo da 0.4.0: o servidor que sobe a proveniência
  não leva uma segunda cópia da 0.3.x aninhada aqui. Código e API NÃO mudam; o que este
  pacote usa da proveniência (`RetrievalAnomalyKindSchema`, os tipos de `retrieval` e de
  `field_sources`) não mudou na 0.4.0.

## [0.4.1] — 2026-10-08

Só documentação e licença: código e API NÃO mudam.

### Alterado

- **README em inglês** (`README.md`), o que o npm exibe; o texto em português
  passa a `LEIA-ME.md`. O npm empacota todo `README*` da pasta e pode exibir o
  traduzido, por isso o par fica fora desse prefixo.
- **`LICENSE`** (MIT) no tarball e autor com o nome completo no `package.json` (#39).

## [0.4.0] — 2026-10-06

### Adicionado
- **`call.fieldSource({ fields, source_url, filter?, dataset_id?, data_vintage? })`** —
  item de `field_sources` (contrato de proveniência v1.2) a partir dos acessos da
  chamada: `retrieved_at` = o mais antigo dos acessos que casam com `filter` (por padrão,
  URL igual a `source_url`), `served_from_cache` = todos do cache. Sem acesso que case,
  os dois saem `null` — não "agora". Tipos `FieldSourceSpec` e `UpstreamFieldSource`.
  Existe para que os servidores parem de escolher uma chave de cache à mão (ibge, senado,
  ilo, uis reportavam, na prática, o acesso mais NOVO de uma resposta mista).

### Mudado
- Dependência `@sbissoli/mcp-provenance`: `^0.2.0` → `^0.2.0 || ^0.3.0`, para que o
  servidor que sobe a proveniência não leve uma segunda cópia da 0.2.0 aninhada aqui.

## [0.3.0] — 2026-09-27

Segunda adoção (ibge-br-mcp) pediu o par do `timeoutMs`: a REPETIÇÃO justa também depende
da forma do pedido. O ibge dá 4 retries de 2→16 s a uma consulta principal, 2 de 0,5→2 s a
um enriquecimento de melhor esforço (`ibge_cidades`, `ibge_vizinhos`) e não repete o 500 da
API de Agregados (que ela responde a parâmetro inválido, determinístico) — três políticas
numa chamada de tool, e o coletor tem de ser um só.

### Adicionado
- `retries`, `backoff` (parcial, mesclado sobre o da política) e `retryOn` em
  `UpstreamRequestInit`: política de repetição só para aquela ida, no mesmo coletor.
  Nenhum vaza para o `init` do `fetch`; `budgetMs` continua o da política, por cima.
  `retries` inválido falha alto (`RangeError`), como `timeoutMs`.
- `cause` em `RetryContext`: o que o `fetch` lançou (`network`, `timeout` lendo o corpo) ou
  o que o parse lançou (`malformed_body`). "O fetch lançou" não é sempre rede — o ibge
  repete `ECONNRESET`/`fetch failed` e não repete um `Error` que outra camada lançou dentro
  do fetch, e só o `cause` separa os dois.

## [0.2.0] — 2026-09-27

Primeira adoção (bcb-br-mcp) pediu um ajuste: o prazo justo de uma tentativa depende da
FORMA do pedido, não só do servidor.

### Adicionado
- `timeoutMs` em `UpstreamRequestInit` (`call.json(url, { timeoutMs })`, idem `text` e
  `response`): teto de UMA tentativa só para aquela ida, no lugar do `timeoutMs` da
  política. Orçamento total (`budgetMs`) e `retries` continuam os da política; o valor
  não vaza para o `init` do `fetch`. Caso de uso: o bcb dá 6 s a `ultimos/N` (resposta
  real ≤ 0,4 s; código inexistente leva ~30 s para negar) e 30 s a uma janela diária
  larga — na mesma chamada, no mesmo coletor. Sem isto a alternativa era um `signal` do
  chamador, que o pacote classifica como `aborted` (não repete, não é anomalia) — errado
  para um timeout.

## [0.1.0] — 2026-09-27

Primeira versão. Nasce para os sete servidores TS do portfólio pararem de ter cada um o
seu coletor de rede, e para o bloco `retrieval` do contrato de proveniência v1.1 sair
com o MESMO nome e forma em todos.

### Adicionado
- `createUpstream(options)` / `Upstream` — política de rede de um servidor: `userAgent`,
  `timeoutMs` (por tentativa), `retries`, `budgetMs` (orçamento total da ida, esperas
  incluídas), `backoff {baseMs, maxMs, jitterMs}`, `honorRetryAfter`, `retryOn(ctx)`,
  `inspectBody(res, body)`; I/O injetável (`fetchImpl`, `sleep`, `now`, `random`).
- `upstream.call()` → `UpstreamCall`, o coletor de UMA chamada de tool, sem
  AsyncLocalStorage: `json`, `text`, `response`; `recordCache(url, retrievedAt)`;
  `retrieval()` (`RetrievalInput | null`, anomalias somadas por classe na ordem canônica);
  `retrievedAt(filtro?)` e `servedFromCache(filtro?)` com a semântica do coletor do bcb;
  `requests`, `attempts`, `accesses()`.
- `UpstreamError { url, kind, status?, retryable, transport, attempts, retryAfterMs?,
  body?, response?, isAnomaly }`. `kind` = vocabulário de `retrieval.anomalies`
  (`timeout`, `network`, `rate_limited`, `http_5xx`, `http_4xx`, `malformed_body`) mais
  `not_found` (404) e `aborted` (signal do chamador), que NÃO são anomalias.
- Repetição: `Retry-After` honrado (delta-seconds e HTTP-date), espera =
  `max(Retry-After, backoff) + jitter`; espera que estoura o orçamento desiste na hora.
- Subpath `@sbissoli/mcp-upstream/als`: `withCall`, `currentCall`, `requireCall`.
- Núcleo puro exportado: `parseRetryAfterMs`, `backoffMs`, `retryWaitMs`, `defaultRetryOn`.

### Decisões presas por teste
- Toda tentativa falha é anomalia, superada ou final — uma fatia engolida pelo servidor
  sai instável no `retrieval`, nunca limpa.
- 404 conta como ida e tentativa, mas não como anomalia; não repete.
- `retrieval()` é `null` com zero idas, mesmo com acertos de cache registrados.
