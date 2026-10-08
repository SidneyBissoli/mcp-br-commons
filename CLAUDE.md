# CLAUDE.md

Orientação para o Claude Code neste repositório.

## O que é

Monorepo (npm workspaces, `private: true` na raiz) com os componentes compartilhados dos
sete servidores MCP do portfólio, publicados no npm sob `@sbissoli/*`, mais duas pastas
copiáveis (`templates/`). É a peça de maior alcance do portfólio: uma regressão aqui sai
em release e chega a vários servidores ao mesmo tempo (comentário de abertura do
`.github/workflows/ci.yml`). O repositório é público.

### Pacotes

| Pacote | O quê |
|---|---|
| `packages/mcp-provenance` | Contrato de proveniência: todo retorno de tool carrega fonte, endpoint, período, data de extração e licença (`concise`/`detailed`), com serialização determinística |
| `packages/mcp-stats` | Motor de estatísticas para tools tabulares (média, mediana, percentis, topN, agruparPor, correlação), exibição por idioma, zero dependências |
| `packages/mcp-search` | `search`/`fetch` do contrato Deep Research: schemas, envelope, índice em memória e a fábrica `registerDeepResearchTools` |
| `packages/mcp-upstream` | Fetch comum: retry com backoff e Retry-After, timeout, orçamento por chamada e a contagem que alimenta o `retrieval` |
| `packages/mcp-surface` | Impressão digital da superfície (`surface.lock.json`), publicada no MCP Registry desde a 0.5.0; CLI `mcp-surface` (`travar`, `verificar`, `replay`, `registro`, `conferir-registro`); forma canônica em `SPEC.md` |
| `packages/mcp-evals` | Harness de evals de seleção de tool e de sessão longa (Messages API — **custa dinheiro**, só com pedido do dono) |
| `templates/cloudflare-worker` | Esqueleto de hosting Cloudflare — copiar a pasta, não importar |
| `templates/pipeline-dados` | Receita R → parquet versionado → consulta (Frictionless v2) — copiar, não importar |

### Quem consome (medido em 2026-10-08, `package.json` de cada servidor)

| Servidor | provenance | upstream | search | stats | surface (dev) | evals (dev) |
|---|---|---|---|---|---|---|
| bcb-br-mcp | ^0.3.0 | ^0.4.0 | ^0.9.0 | ^0.3.1 | ^0.5.0 | ^0.2.1 |
| ibge-br-mcp | ^0.3.0 | ^0.4.0 | ^0.9.0 | ^0.3.0 | ^0.5.0 | ^0.2.1 |
| senado-br-mcp-cloudflare | ^0.3.0 | ^0.4.0 | ^0.9.0 | ^0.3.0 | ^0.5.0 | ^0.2.1 |
| ilo-mcp-server | ^0.3.0 | ^0.4.0 | ^0.9.0 | — | ^0.5.0 | ^0.2.1 |
| medical-terminologies-mcp | ^0.3.0 | ^0.4.0 | ^0.9.0 | — | ^0.5.0 | ^0.2.1 |
| uis-mcp-server | ^0.3.0 | ^0.4.0 | ^0.9.0 | — | ^0.5.0 | ^0.2.1 |
| sih-br-mcp | ^0.3.0 | ^0.4.0 | — | — | ^0.5.0 | — |

O servidor do senado em produção é o `senado-br-mcp-cloudflare`; o `senado-br-mcp` (sem
sufixo) é o legado e não usa nenhum pacote daqui. Esta tabela é retrato: antes de afirmar
quem usa o quê, releia os `package.json`.

## Comandos

Na raiz (cada um roda em todas as workspaces, pacotes e templates, com `--if-present`):

```bash
npm ci                 # instalação estrita (a do CI)
npm run build          # ANTES do typecheck: o template importa irmãos pelo nome público, que resolve no dist/
npm run typecheck
npm test               # vitest em cada workspace
```

Num pacote só: `npm test -w packages/mcp-surface` (ou de dentro da pasta).

## Convenções

- **Nomes da API em português, README do npm em inglês.** O `README.md` de cada pacote é o
  que o npm exibe; quando há versão em português, ela se chama `LEIA-ME.md` — o npm
  empacota todo `README*` da pasta e pode exibir o traduzido (hoje só o `mcp-surface` tem o
  par; os outros READMEs ainda são em português). Nomes exportados ficam em português, com
  glossário no README em inglês.
- **Um `CHANGELOG.md` por pacote**, sem changelog na raiz (cada pacote tem seu histórico;
  um da raiz copiaria os seis). Em 0.x, **mudança de contrato ou de normalização é minor**:
  o caret `^0.x` não cobre o minor seguinte, então cada servidor faz bump explícito
  (cabeçalho do `packages/mcp-surface/CHANGELOG.md`). No `mcp-surface`, mudar a
  normalização muda o sha de toda trava e obrigaria cada servidor a subir de versão sem ter
  mudado nada — medir antes nos sete endpoints (ver o CHANGELOG da 0.5.0).
- **`LICENSE` (MIT) na raiz e em cada pacote**, autor "Sidney da Silva Pereira Bissoli"
  (#39). O npm empacota `LICENSE` independentemente do campo `files`.
- **`repository` com `directory`** em cada `package.json`: sem ele o npm não sabe qual
  repositório atestar, e num monorepo sem `directory` atestaria a raiz (#8).
- **Versão não se escreve à mão em README**: a tabela da raiz linka o npm, porque número
  copiado envelhece calado (README da raiz).

## Publicar um pacote

`.github/workflows/publish.yml`, por **trusted publishing** (OIDC, `id-token: write`), sem
token: `workflow_dispatch` com `pacote=<pasta em packages/>`, ou tag `<pacote>-v<versão>`
(o monorepo não usa `v*`, porque a tag precisa dizer de qual pacote se trata).

```bash
npm version <patch|minor> --no-git-tag-version -w packages/<pacote>
# CHANGELOG do pacote, PR, merge — e então:
gh workflow run publish.yml -R SidneyBissoli/mcp-br-commons -f pacote=<pacote>
```

O workflow roda build, typecheck e test do **monorepo inteiro** antes de publicar, confere
`npm pack --dry-run`, pula se a versão já está no npm (re-executável) e publica com
`--provenance` quando o repositório é público. O trusted publisher é configuração **por
pacote** na interface do npmjs.com; sem ela o publish falha com erro de autenticação e não
publica nada. Depois de publicar: conferir `npm view @sbissoli/<pacote>@<v>
dist.attestations readmeFilename`.

O classificador do Claude Code costuma negar `gh pr merge` e `gh workflow run` ("Merge
Without Review", "Production Deploy"): tentar uma vez e entregar o comando ao dono.

## Testar os servidores contra um build local

Antes de publicar algo que os servidores consomem, sem tocar manifesto nem lockfile deles:

1. No pacote: `npm run build && npm pack --pack-destination <scratch>`.
2. `tar --force-local -xzf <scratch>/sbissoli-<pkg>-<v>.tgz -C <scratch>/pkg` (no Git
   Bash, `tar` trata `C:/...` como host remoto: usar `/c/...` e `--force-local`).
3. Em cada servidor: trocar `node_modules/@sbissoli/<pkg>` pela pasta extraída, `npm test`,
   restaurar.

Para o `mcp-surface`, há uma prova mais direta: capturar os sete endpoints no ar com o
`dist/` novo e comparar com o `declarada.sha256` de cada `surface.lock.json` (foi como a
0.5.0 provou que nenhum sha mudava).

## Pontos que mordem

- **`npm install`/`npm version` no Windows apagam os campos `libc` do `package-lock.json`**,
  e o `npm ci` do CI (Linux) passa a instalar binário errado. Depois de mexer no lock:
  `node C:\dev\skills\scripts\restore-libc.mjs <lock do HEAD> package-lock.json` e conferir
  que o diff do lock ficou só com o que você mudou.
- **`npm version ... -w <pacote> --dry-run` NÃO é ensaio**: medido em 08/10/2026, o npm
  ignorou o `--dry-run` com `-w` e gravou a versão nova no `package.json`. Conferir
  `git diff` depois de qualquer `npm version`.
- **Build antes de typecheck.** Em clone limpo não há `dist/`, e o template que importa um
  irmão pelo nome falha com TS2307 (derrubou a primeira execução do CI, 30/08/2026 —
  comentário do `ci.yml`).
- **Proveniência não é retroativa.** A atestação prende-se no ato de publicar: versão já
  publicada sem ela só se conserta com versão nova (#15).
- **O npm publica de forma assíncrona**: a versão pode levar minutos para aparecer em
  `npm view` — o `publish.yml` espera até 5 min.
- **`mcp-evals` chama a API da Anthropic**: rodada paga só com pedido explícito do dono.
