# mcp-br-commons

Componentes compartilhados do meu portfólio de servidores MCP (dados abertos
brasileiros e internacionais: Senado Federal, DATASUS, BCB, IBGE, ILOSTAT,
terminologias médicas).

> **Aviso**: estes pacotes são mantidos para o meu portfólio. São publicados
> abertamente e você pode usá-los, mas o roadmap, as decisões de design e o
> ritmo de manutenção seguem as necessidades dos meus servidores — não há
> compromisso de estabilidade de API para terceiros.

## Pacotes

| Pacote | O quê | Status |
|---|---|---|
| [`@sbissoli/mcp-provenance`](packages/mcp-provenance) | Contrato de proveniência: todo retorno de tool carrega fonte, endpoint, período, data de extração e licença, em dois modos (`concise`/`detailed`) | 0.1.0 (npm) |
| [`@sbissoli/mcp-stats`](packages/mcp-stats) | Motor de estatísticas (média/mediana/distribuição/topN/agruparPor) para tools tabulares, exibição por idioma | 0.3.0 (npm) |
| [`@sbissoli/mcp-evals`](packages/mcp-evals) | Harness de evals de seleção de tool: extrator de catálogo (fake McpServer, captura `.tool` e `.registerTool`), validação de fixtures, scorer offline (top-1/top-k/por-área), gate de acurácia e runner via Anthropic Messages API | 0.1.0 (npm) |
| [`@sbissoli/mcp-search`](packages/mcp-search) | As tools `search`/`fetch` do contrato Deep Research do ChatGPT: schemas, envelope (JSON em `content` + `structuredContent`), índice em memória com ranking simples e a fábrica `registerDeepResearchTools` — o servidor fornece só o índice e o renderizador | 0.6.2 (npm) |

Além dos pacotes, o monorepo abriga como **pastas copiáveis** (não importáveis):

- [`templates/cloudflare-worker/`](templates/cloudflare-worker) — esqueleto de
  hosting Cloudflare: Worker + Streamable HTTP (`createMcpHandler`, MCP SDK v2) +
  rate limit + Durable Object de estatísticas de uso + health/status + tool de
  exemplo com proveniência — **entregue** (instruções de instanciação no README
  da pasta)
- [`templates/pipeline-dados/`](templates/pipeline-dados) — receita R → parquet
  versionado → consulta, com `datapackage.json` (Frictionless v2), CHANGELOG de
  dataset, licença e citação — **entregue** (receita no README da pasta)

## Desenvolvimento

```bash
npm install
npm run typecheck
npm test
```

Monorepo com npm workspaces. Cada pacote tem seus próprios testes (vitest) e
`tsconfig.json` estendendo `tsconfig.base.json`.
