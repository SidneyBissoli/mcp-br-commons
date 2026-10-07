# mcp-br-commons

Componentes compartilhados do meu portfólio de servidores MCP (dados abertos
brasileiros e internacionais: Senado Federal, DATASUS, BCB, IBGE, ILOSTAT,
terminologias médicas).

> **Aviso**: estes pacotes são mantidos para o meu portfólio. São publicados
> abertamente e você pode usá-los, mas o roadmap, as decisões de design e o
> ritmo de manutenção seguem as necessidades dos meus servidores — não há
> compromisso de estabilidade de API para terceiros.

## Pacotes

| Pacote | O quê | Versão publicada |
|---|---|---|
| [`@sbissoli/mcp-provenance`](packages/mcp-provenance) | Contrato de proveniência: todo retorno de tool carrega fonte, endpoint, período, data de extração, licença e diagnóstico de origem (`retrieval`, contrato v1.1), em dois modos (`concise`/`detailed`) | [npm](https://www.npmjs.com/package/@sbissoli/mcp-provenance) |
| [`@sbissoli/mcp-stats`](packages/mcp-stats) | Motor de estatísticas (média/mediana/distribuição/topN/agruparPor) para tools tabulares, exibição por idioma | [npm](https://www.npmjs.com/package/@sbissoli/mcp-stats) |
| [`@sbissoli/mcp-evals`](packages/mcp-evals) | Harness de evals de seleção de tool: extrator de catálogo (fake McpServer, captura `.tool` e `.registerTool`), validação de fixtures, scorer offline (top-1/top-k/por-área), gate de acurácia e runner via Anthropic Messages API | [npm](https://www.npmjs.com/package/@sbissoli/mcp-evals) |
| [`@sbissoli/mcp-search`](packages/mcp-search) | As tools `search`/`fetch` do contrato Deep Research do ChatGPT: schemas, envelope (JSON em `content` + `structuredContent`), índice em memória com ranking simples e a fábrica `registerDeepResearchTools` — o servidor fornece só o índice e o renderizador | [npm](https://www.npmjs.com/package/@sbissoli/mcp-search) |
| [`@sbissoli/mcp-surface`](packages/mcp-surface) | Impressão digital da superfície: `initialize` (instructions + capabilities) + tools/resources/prompts + quem responde sem token, travados ao lado da versão no `surface.lock.json` — mudou sem subir a versão = build vermelho e deploy recusado; CLI `mcp-surface` para regravar, conferir o endpoint no ar e fazer o replay das versões publicadas | [npm](https://www.npmjs.com/package/@sbissoli/mcp-surface) |
| [`@sbissoli/mcp-upstream`](packages/mcp-upstream) | Fetch comum dos servidores MCP: retry com backoff e Retry-After, timeout por tentativa e orçamento por chamada, e a contagem de tentativas e anomalias que alimenta o `retrieval` do contrato de proveniência v1.1 | [npm](https://www.npmjs.com/package/@sbissoli/mcp-upstream) |

A versão de cada pacote fica no npm (e no `package.json` e no `CHANGELOG.md` dele), não
nesta tabela: número copiado à mão envelhece calado — até 07/10/2026 quatro das cinco
versões listadas aqui estavam atrasadas e o `mcp-upstream` faltava.

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

## Licença

MIT — ver [`LICENSE`](LICENSE). Cada pacote leva o mesmo arquivo na sua pasta, e o npm o
inclui no tarball a partir da próxima release de cada um.
