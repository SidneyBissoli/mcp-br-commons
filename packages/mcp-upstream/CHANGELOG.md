# Changelog — @sbissoli/mcp-upstream

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões seguem
semver; em 0.x, superfície publicada que muda é minor (caret `^0.x` não cobre o minor
seguinte — cada servidor faz bump explícito).

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
