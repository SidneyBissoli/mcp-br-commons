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
| [`@sbissoli/mcp-provenance`](packages/mcp-provenance) | Contrato de proveniência: todo retorno de tool carrega fonte, endpoint, período, data de extração e licença, em dois modos (`concise`/`detailed`) | em desenvolvimento |
| `@sbissoli/mcp-stats` | Motor de estatísticas (média/mediana/distribuição/topN/agruparPor) para tools tabulares | planejado |
| `@sbissoli/mcp-evals` | Harness de evals de seleção de tool (catálogo + fixtures + scorer + gate) | planejado |

Além dos pacotes, o monorepo abrigará como **pastas copiáveis** (não importáveis):

- `templates/cloudflare-worker/` — esqueleto de hosting Cloudflare (Worker +
  Streamable HTTP + rate limit + estatísticas de uso + health/status) — planejado
- `templates/pipeline-dados/` — receita R → parquet versionado → consulta, com
  `datapackage.json` (Frictionless v2), CHANGELOG de dataset, licença e citação — planejado

## Desenvolvimento

```bash
npm install
npm run typecheck
npm test
```

Monorepo com npm workspaces. Cada pacote tem seus próprios testes (vitest) e
`tsconfig.json` estendendo `tsconfig.base.json`.
