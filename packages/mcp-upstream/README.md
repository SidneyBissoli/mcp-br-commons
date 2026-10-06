# @sbissoli/mcp-upstream

Fetch comum dos servidores MCP do portfólio: **retry com backoff e `Retry-After`, timeout
por tentativa, orçamento total por ida à origem** — e a **contagem de idas, tentativas e
anomalias** que alimenta o bloco `retrieval` do
[contrato de proveniência v1.1](../mcp-provenance/docs/contrato-proveniencia-v1.md)
(`@sbissoli/mcp-provenance` ≥ 0.2.0).

> Mantido para o meu portfólio de servidores MCP. Uso por terceiros é bem-vindo, mas o
> roadmap segue as necessidades dos meus servidores.

O pacote **classifica**; o servidor **decide**. Ele diz "a origem respondeu 404", "o corpo
veio em HTML", "repeti duas vezes por 503" — e nunca o que isso significa para o dado
(ausência legítima × chave fora da cobertura × série inexistente é semântica de cada
servidor, e fica nele).

## Uso

```ts
import { createUpstream, UpstreamError } from "@sbissoli/mcp-upstream";

// 1. Uma vez, na inicialização do servidor: a política de rede.
const upstream = createUpstream({
  userAgent: "bcb-br-mcp/2.0 (+https://…)",
  timeoutMs: 10_000,   // teto de UMA tentativa (cabeçalhos + corpo)
  retries: 2,          // além da primeira tentativa (até 3 no total)
  budgetMs: 30_000,    // orçamento TOTAL da ida, esperas incluídas
  backoff: { baseMs: 1_000, maxMs: 8_000, jitterMs: 500 },
  honorRetryAfter: true,
  inspectBody: (_res, body) => (body.trimStart().startsWith("<") ? "malformed_body" : null),
});

// 2. Em cada chamada de tool: UM coletor, explícito.
const call = upstream.call();
const serie = await call.json(`${BASE}/serie/${codigo}`);      // 1 ida; conta tentativas
const meta  = await call.json(`${BASE}/serie/${codigo}/meta`); // 2ª ida
call.recordCache(urlDoCatalogo, catalogo.retrievedAt);         // acerto de cache do SERVIDOR

return prov.result(dados, prov.from(PRESET, {
  source_url: …,
  retrieved_at: call.retrievedAt(),      // o mais antigo entre rede e cache
  served_from_cache: call.servedFromCache(),
  retrieval: call.retrieval(),           // { requests: 2, attempts: 3, anomalies: [...] } | null
}));
```

`call.retrieval()` devolve o `RetrievalInput` **cru**: quem soma `unstable` e normaliza é
a lib de proveniência, como já faz. É `null` quando a chamada não foi à origem nenhuma
vez (cache puro, dado local) — o contrato manda `null`, não `{ attempts: 1 }` inventado.

### Resposta que junta partes de procedências distintas (`field_sources`)

Quando a resposta funde sub-fontes — uma parte do cache, outra buscada agora —,
`call.fieldSource()` monta o item de `field_sources` (contrato de proveniência v1.2,
`@sbissoli/mcp-provenance` ≥ 0.3.0) a partir dos acessos registrados. O servidor diz
quais campos vêm de qual URL; o coletor põe o instante mais antigo e o `served_from_cache`
daquela sub-fonte:

```ts
field_sources: [
  call.fieldSource({ fields: ["serie"], source_url: urlSerie }),                    // acessos com URL igual
  call.fieldSource({ fields: ["meta"],  source_url: urlMeta, filter: (u) => u.startsWith(urlMeta) }),
],
```

Sub-fonte sem nenhum acesso nesta chamada sai com `retrieved_at` e `served_from_cache`
`null` — diferente de `retrievedAt()`, que devolve "agora" para o bloco, o item nunca
afirma uma extração que não aconteceu.

### Três modos de ida

| método | corpo | `inspectBody` | `malformed_body` |
|---|---|---|---|
| `call.json(url, init?)` | lido e parseado | sim | corpo rejeitado ou JSON inválido |
| `call.text(url, init?)` | lido | sim | corpo rejeitado |
| `call.response(url, init?)` | **não consumido** | não | nunca (o corpo é seu) |

`init` é um `RequestInit` normal; um `signal` seu é combinado com o do timeout. Quatro chaves
a mais trocam a política **só naquela ida**, no mesmo coletor, porque prazo e repetição justos
dependem da FORMA do pedido, não do servidor: `timeoutMs` (teto de UMA tentativa — o bcb dá
6 s a um pedido de 20 observações e 30 s a uma janela larga), `retries`, `backoff` (parcial,
mesclado sobre o da política) e `retryOn` (o ibge dá 4 retries de 2→16 s à consulta principal,
2 de 0,5→2 s a um enriquecimento de melhor esforço, e não repete o 500 determinístico da API
de Agregados). Nenhuma delas vaza para o `fetch`; `budgetMs` segue o da política, por cima.

### Classificação e repetição

| o que aconteceu | `kind` | repete por padrão | `transport` |
|---|---|---|---|
| tentativa estourou `timeoutMs` (ou o orçamento) | `timeout` | sim | sim (não, se foi lendo o corpo) |
| `fetch` lançou (DNS/TCP/TLS) | `network` | sim | sim |
| HTTP 429 | `rate_limited` | sim, honrando `Retry-After` | não |
| HTTP 5xx | `http_5xx` | sim | não |
| HTTP 4xx (exceto 404) | `http_4xx` | **não** | não |
| 200 com corpo rejeitado / JSON inválido | `malformed_body` | sim | não |
| HTTP 404 | `not_found` | não | não |
| o `signal` do chamador abortou | `aborted` | não | sim |

Os seis primeiros são o vocabulário fechado de `retrieval.anomalies`. **`not_found` e
`aborted` não são anomalias**: ausência é resposta da origem, e cancelamento é decisão
do chamador. `retryOn(ctx)` troca a política de repetição (ex.: repetir um 4xx que a
origem usa como "tente de novo"); `retries` e `budgetMs` continuam valendo por cima. O `ctx`
traz `url`, `attempt`, `kind`, `status`, `response`, `body` e `cause` (o que o `fetch` ou o
parse lançou) — é pelo `cause` que um servidor separa `ECONNRESET` de um erro que outra camada
lançou dentro do fetch.

**Toda tentativa falha conta como anomalia** — a superada e a final. Como `retrieval`
só sai no sucesso da tool, a diferença só aparece quando o servidor engole a falha de
uma fatia e responde parcial: e aí a resposta **é** instável, e o bloco tem de dizer.

### Espera entre tentativas

`max(Retry-After, backoff exponencial) + jitter`, com `backoff = min(baseMs · 2ⁿ, maxMs)`.
Uma espera que estouraria o que sobra de `budgetMs` **desiste na hora**, com o erro
repetível — esperar só adiaria o mesmo timeout. Cada tentativa recebe, no máximo, o que
sobra do orçamento.

### O erro

```ts
try { await call.json(url); }
catch (e) {
  if (e instanceof UpstreamError) {
    e.kind;        // "timeout" | "network" | "rate_limited" | "http_5xx" | "http_4xx" | "malformed_body" | "not_found" | "aborted"
    e.status;      // número quando uma resposta chegou
    e.retryable;   // a classe era repetível (informativo: os retries já se esgotaram)
    e.transport;   // true só quando NADA chegou da origem
    e.attempts;    // tentativas desta ida
    e.body;        // corpo lido (modos text/json) — é aqui que o servidor lê o 404
    e.response;    // Response sem corpo consumido (modo response)
    e.retryAfterMs;
    e.isAnomaly;   // kind pertence ao vocabulário do contrato
  }
}
```

### Adaptador por AsyncLocalStorage (opcional)

Para servidores que já propagam contexto assim:

```ts
import { withCall, currentCall, requireCall } from "@sbissoli/mcp-upstream/als";

server.tool("x", schema, (args) =>
  withCall(upstream, async (call) => {
    const dados = await buscar(args);            // lá no fundo: requireCall().json(url)
    return prov.result(dados, prov.from(PRESET, { retrieval: call.retrieval(), … }));
  }),
);
```

Entrypoint separado para o núcleo não depender de `node:async_hooks`. Exige Node ou
Worker com `nodejs_compat`.

## Testes offline

`fetchImpl`, `sleep`, `now` e `random` são injetáveis: os testes do pacote provam
contagens exatas, esperas exatas e desistência por orçamento sem rede e sem esperar.
Servidores que adotam testam do mesmo jeito.

## Licença

MIT
