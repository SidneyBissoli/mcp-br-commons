# @sbissoli/mcp-search

O Deep Research do ChatGPT (e o Company Knowledge, e os workflows de pesquisa
da API Responses) só usa um servidor MCP que exponha **exatamente** duas
tools, `search` e `fetch`, com um formato fixo de entrada e saída. Um servidor
com vinte tools ricas e nenhuma dessas duas é invisível para ele. Este pacote
é a parte desse contrato que é igual em todo servidor — nomes, schemas,
envelope, descrições, telemetria — para cada servidor escrever só o que é
dele: o **índice** (o que se pode achar) e o **renderizador** (o texto de um
documento).

> Mantido para o meu portfólio de servidores MCP. Uso por terceiros é
> bem-vindo, mas o roadmap segue as necessidades dos meus servidores.

Contrato literal da doc da OpenAI (`developers.openai.com/api/docs/mcp`, lida
em 2026-09-02):

- `search(query: string)` → `{ results: [{ id, title, url }] }`
- `fetch(id: string)` → `{ id, title, text, url, metadata? }`
- o objeto vai em `structuredContent` **e** serializado em `content[0].text`;
- o ChatGPT só cria citação quando `url` é uma string não vazia.

## Regras que a lib impõe

- **Os nomes são `search` e `fetch`, sem prefixo.** É a única exceção ao
  prefixo por servidor do portfólio (`ibge_*`, `bcb_*`…); `DEEP_RESEARCH_TOOLS`
  existe para os testes que exigem o prefixo abrirem a exceção por allowlist,
  não por regex frouxa.
- **`content` tem um bloco só, o JSON compacto do objeto.** O envelope de
  proveniência (`@sbissoli/mcp-provenance`) emite dois blocos; aqui o rodapé
  fica de fora porque a doc descreve `content[0].text` como o objeto e nada
  além. A proveniência entra pelos outros dois canais — `structuredContent` e
  `_meta`, via os `extras` que `search`/`fetch` devolvem junto com o
  resultado — e chaves extras ali não atrapalham o Deep Research. É a
  chamada que entrega a proveniência, não um decorador de fora: o instante
  real da extração e a chave de cache só existem dentro dela.
- **As chaves do contrato vencem em colisão** com os extras anexados.
- **`search` corta no `limit`** (padrão 10) mesmo que o índice devolva mais.
- **Erro nunca sobe cru**: `search`/`fetch` que lançam viram resultado
  `isError` com mensagem pt-BR; id desconhecido idem.
- Tudo é somente leitura; o chamador passa as mesmas `annotations` das outras
  tools, para os testes de superfície não distinguirem as duas.

## Uso

```ts
import {
  createIndex,
  registerDeepResearchTools,
  type FetchReply,
  type IndexEntry,
} from "@sbissoli/mcp-search";

// 1. O índice: qualquer coisa que tenha id, título e URL pública. `keywords`
//    e `text` só servem para ranquear. Monte-o uma vez (ou por TTL) a partir
//    do catálogo real do servidor.
const entradas: IndexEntry[] = [
  {
    id: "sidra:6579",
    title: "Tabela 6579 — População residente estimada",
    url: "https://sidra.ibge.gov.br/tabela/6579",
    keywords: ["estimativas de população"],
  },
];
const indice = createIndex(entradas);

// 2. O renderizador: dado um id, o documento inteiro (texto Markdown legível),
//    com os extras do envelope quando houver proveniência a anexar.
async function documento(id: string): Promise<FetchReply | null> {
  const e = entradas.find((x) => x.id === id);
  if (!e) return null;
  return {
    document: { id, title: e.title, url: e.url, text: `# ${e.title}\n…` },
    extras: { structured: { provenance, attribution }, meta: { [chaveMeta]: provenance } },
  };
}

// 3. Dentro do registro central de tools do servidor:
registerDeepResearchTools(server, {
  search: async (query) => indice.search(query), // ou { results, extras }
  fetch: documento,
  corpus: "IBGE official statistics (SIDRA tables, municipalities, indicators)",
  richTools: "the `ibge_*` tools",
  annotations: READ_ONLY,
  extendOutputSchema: comProveniencia, // acrescenta o bloco de proveniência ao schema
  record, // telemetria tool_call/tool_error, como o `handle` do servidor
});
```

### Idioma da superfície

O padrão é pt-BR: títulos, `.describe()` dos schemas e mensagens de erro em
português (a `description` que o modelo lê é sempre em inglês). Num servidor
cuja superfície inteira é em inglês (medical, ilo, uis), `locale: "en"` troca
os três de uma vez — `contractSchemas("en")` devolve os mesmos quatro schemas
com as descrições em inglês, e `titles`/`notFound`/`onError` continuam
sobrepondo o padrão do idioma quando passados.

### Servidores que registram JSON Schema à mão

A fábrica registra os schemas zod no `McpServer`. Um servidor cujas
definições são JSON Schema escrito à mão (o bcb, com `TOOL_DEFINITIONS` e
`dispatchTool` por `case`) não precisa derivar nada: `contractJsonSchemas(locale)`
devolve os mesmos quatro schemas em JSON Schema draft-07 (sem `$schema`,
referências inline), derivados uma vez aqui dos mesmos zod — e o servidor os
embrulha com o seu próprio wrapper de proveniência sobre JSON.

### Ranking

`createIndex` pré-computa os tokens e devolve um buscador determinístico:
normalização sem acentos e sem caixa, tokens `[a-z0-9]{2,}` sem as stopwords
do pt-BR, pontuação por token da consulta com peso por campo (id 10, título 3,
palavras-chave 2, texto 1; prefixo a partir de 3 caracteres vale metade),
bônus por cobertura (cada token distinto casado) e por frase inteira no título,
desempate pela ordem do acervo. Consulta vazia ou sem casamento devolve `[]`.
`rankEntries(entradas, consulta)` é o atalho para acervos pequenos.

## API

Contrato: `DEEP_RESEARCH_TOOLS`, `searchInputSchema`, `searchOutputSchema`,
`searchResultSchema`, `fetchInputSchema`, `fetchDocumentSchema` (pt-BR),
`contractSchemas(locale)`, `contractJsonSchemas(locale)` e os tipos
`SearchInput`, `SearchResult`, `SearchOutput`, `FetchInput`, `FetchDocument`,
`DeepResearchToolName`, `ContractLocale`, `JsonSchemaObject`. Ranking: `createIndex`, `rankEntries`, `normalizeText`,
`tokenize`, `DEFAULT_LIMIT`, tipos `IndexEntry`, `SearchIndex`,
`SearchOptions`. Envelope: `deepResearchResult`, `deepResearchError`,
`EnvelopeExtras`. Fábrica: `registerDeepResearchTools`,
`DeepResearchToolsOptions`, `SearchReply`, `FetchReply`, `UsageRecorder`.

Dependências: `zod` (schemas); `@modelcontextprotocol/server` ^2 como peer
(só tipos — o servidor que registra é o do chamador).
