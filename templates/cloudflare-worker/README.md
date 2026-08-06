# Template de hosting Cloudflare para servidores MCP

Esqueleto instanciável do portfólio (Fase 0, Entregável 2): Worker + Streamable
HTTP + rate limit + Durable Object de estatísticas de uso + health/status.
Esta pasta **se copia, não se importa** — cada servidor novo nasce de uma cópia
dela e evolui por conta própria.

Extraído do `senado-br-mcp-cloudflare` e atualizado para o caminho recomendado
pós-deprecação do `McpAgent`: **`createMcpHandler`** (stateless, de
`agents/mcp/server`, `agents` ≥ 0.20) com **MCP SDK v2**
(`@modelcontextprotocol/server` 2.x) — a factory cria um `McpServer` novo por
request; estado cross-request vive atrás de handle próprio (Durable Object),
nunca do session ID do MCP.

## O que vem pronto

| Rota | O quê | Arquivo |
|---|---|---|
| `/` | Landing page pública (identificação + contato — é a URL do User-Agent) | `src/landing.ts` |
| `/health` | Liveness (texto `ok`) | `src/index.ts` |
| `/status` | Versão + id/tag/timestamp do último deploy (`version_metadata`) | `src/status.ts` |
| `/metrics` | Estatísticas de uso agregadas (últimos 30 dias) | `src/usage.ts` |
| `/mcp` | Endpoint MCP (Streamable HTTP, CORS, validação de Host/Origin) | `src/index.ts` + `src/server.ts` |

Transversais:

- **Bearer auth opcional** (`wrangler secret put API_KEY`; ausente = acesso
  aberto), comparação em tempo constante — `src/auth.ts`.
- **Rate limit por cliente** (token bucket por IP, em memória por isolate;
  tunáveis em `src/config.ts`) — `src/rate-limit.ts`. Não é teto global exato;
  para isso, mover a contagem para o Durable Object.
- **Estatísticas de uso** — Durable Object singleton com SQLite
  (`UsageTracker`), contagens diárias por evento e por tool, registro
  fire-and-forget fora do caminho crítico. Privacidade: só nome de tool/rota e
  contagens; nunca parâmetros ou conteúdo. Núcleo puro testável em
  `src/usage-core.ts`.
- **Proveniência** — tool de exemplo com o envelope completo do contrato v1.0
  (`@sbissoli/mcp-provenance`): bloco parseável no `structuredContent`, `_meta`
  namespaced e rodapé humano no `content`.
- **Anotações obrigatórias** em toda tool (`title`, `readOnlyHint`,
  `destructiveHint`; nome ≤ 64 chars; descrição diz o que a tool NÃO faz) —
  critério pass/fail do diretório Anthropic, demonstrado em `src/server.ts`.

## Instanciar um servidor novo

1. Copiar a pasta para o repositório do servidor.
2. `package.json`: trocar `name`, `description` e (fora do monorepo) a
   dependência `@sbissoli/mcp-provenance` — enquanto não publicada no npm,
   apontar via `file:` para o pacote local ou publicar antes.
3. `wrangler.jsonc`: trocar `name`; subir `compatibility_date` para a data
   corrente; revisar comentários TODO.
4. `src/config.ts`: identidade (`name`, `version`, `title`, `description`,
   `instructions`, contato), namespace de proveniência (reverse-DNS próprio),
   fuso (`-03:00` para servidores brasileiros) e tunáveis de rate limit.
5. `src/server.ts`: remover a tool de exemplo (`exemplo_buscar_catalogo` e o
   bloco `FONTE_EXEMPLO`/`CATALOGO_EXEMPLO`) e registrar as tools reais — mantendo
   o padrão: preset de fonte + `provenance.result()` + `withUsage` + anotações.
6. Testes: substituir `tests/server.test.ts` pelos testes das tools reais
   (convenção do portfólio: exportar parsers/helpers puros e testá-los direto).
7. `npm install && npm run typecheck && npm test && npm run dev`.
8. Smoke manual: `npx @modelcontextprotocol/inspector` apontando para
   `http://localhost:8787/mcp`; conferir `/`, `/health`, `/status`, `/metrics`.
9. `npm run deploy`. Nenhum recurso precisa ser criado à mão: a migration do
   Durable Object e o binding `version_metadata` provisionam no deploy.

### Domínio próprio

Ativar `routes` no `wrangler.jsonc` **e** listar o hostname em
`SERVER_CONFIG.extraAllowedHostnames` — o `createMcpHandler` valida o header
Host e, sem isso, só aceita localhost e `*.workers.dev`. A lista substitui os
defaults: inclua também o hostname `workers.dev` se ele continuar servido.

## Decisões herdadas (não reabrir sem fato novo)

- `createMcpHandler` stateless; `McpAgent` está deprecado (congelado em
  v0.20.0, 27/07/2026). Não voltar para Durable Object por sessão MCP.
- MCP SDK v2 = pacotes `@modelcontextprotocol/server`/`client` 2.x (o pacote
  `sdk` 1.x segue existindo, mas o handler usa os novos).
- Cache de upstream, throttle de saída e canal npm/stdio ficam FORA do
  template: são por-servidor (referência: `senado-br-mcp-cloudflare`,
  `src/cache/`, `src/throttle/`, `src/cli.ts`).
