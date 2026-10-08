# @sbissoli/mcp-evals

🇺🇸 [Read in English](https://github.com/SidneyBissoli/mcp-br-commons/blob/main/packages/mcp-evals/README.md)

Harness de evals de **seleção de tool** para servidores MCP: mede a acurácia com que um
modelo escolhe a tool certa do catálogo, dada uma consulta realista na persona do
usuário-alvo do servidor. Generalização do harness do senado-br-mcp-cloudflare
(`evals/`), promovido a componente do portfólio na Fase 0 (Entregável 5).

O núcleo (extrator de catálogo + validação de fixtures + scorer + gate) roda **offline em
`npm test`**, sem rede e sem modelo — renomear/remover uma tool quebra o teste de
fixtures do projeto imediatamente, de graça. A rodada cara (modelo real via Anthropic
Messages API) só é necessária quando você quer o número de acurácia em si.

> **Custo**: o runner com modelo real cobra uso de API separado de qualquer assinatura
> Claude. Nunca rode `evals/run.ts` com `ANTHROPIC_API_KEY` sem decisão explícita.

## Módulos

| Módulo | Papel |
|---|---|
| `catalog` | **Extrator de catálogo.** `CapturingServer` (fake McpServer) grava cada registro de tool ao rodar os `registerXTools` do servidor — sem rede, sem runtime de Worker. Captura as duas formas do portfólio: `server.tool(name, desc, shape, cb)` (senado) e `server.registerTool(name, {description, inputSchema}, cb)` (template Cloudflare / SDK v2). Converte zod → JSON-schema via `z.toJSONSchema` nativo (modo `io: "input"`: campo com `.default()` não é required). |
| `fixtures` | Contrato `EvalFixture` + `validateFixtures(fixtures, catalog, opts)`: contagem mínima/máxima, ids e queries únicos, `expectedTools` não-vazio e existente no catálogo, cobertura mínima de áreas. O teste de fixtures de um projeto vira `expect(validateFixtures(...)).toEqual([])`. |
| `score` | **Scorer puro.** top-1 / top-k / por-área + gate parametrizável (`evaluateGate`, limiares padrão 85%/90%). |
| `retry` | Classificação de erro da API (transitório × fatal) + backoff com Retry-After. Dropout de infra nunca é pontuado como escolha errada. |
| `report` | Formatação pura do relatório (linhas + exit code): cobertura, acurácias, erros por kind, gate — marcado PRELIMINAR quando a rodada é incompleta. |
| `runner` | `runEval(config)`: manda cada fixture + o catálogo inteiro à Messages API com `tool_choice: any`, com concorrência limitada, retry e curto-circuito em falha fatal (auth/billing). Sem `ANTHROPIC_API_KEY`, imprime instruções e devolve exit 0 — nunca quebra CI. `fetch` puro, sem SDK. |

## Instanciando num projeto

```
meu-servidor/
  evals/
    catalog.ts     # GROUPS do projeto → buildCatalog(GROUPS)
    fixtures/queries.ts
    run.ts
  tests/evals/
    fixtures.test.ts
```

`evals/catalog.ts` — a única parte específica do servidor é a lista de grupos:

```ts
import { buildCatalog, type CatalogGroup } from "@sbissoli/mcp-evals";
import { registerFooTools } from "../src/tools/foo.js";

const GROUPS: CatalogGroup[] = [
  { area: "foo", register: (s) => registerFooTools(s as never, BASE_URL) },
  // ... um por grupo de src/server.ts — grupo faltando encolhe o eval em silêncio
];

export const CATALOG = buildCatalog(GROUPS);
```

`tests/evals/fixtures.test.ts` — o sinal offline de regressão:

```ts
import { validateFixtures } from "@sbissoli/mcp-evals";
import { CATALOG } from "../../evals/catalog.js";
import { FIXTURES } from "../../evals/fixtures/queries.js";

it("fixtures válidas contra o catálogo vivo", () => {
  expect(validateFixtures(FIXTURES, CATALOG, { minFixtures: 30, maxFixtures: 50, minAreas: 12 }))
    .toEqual([]);
});
```

`evals/run.ts` — a rodada com modelo real:

```ts
import { runEval } from "@sbissoli/mcp-evals";
import { CATALOG } from "./catalog.js";
import { FIXTURES } from "./fixtures/queries.js";

const { exitCode } = await runEval({
  catalog: CATALOG,
  fixtures: FIXTURES,
  systemPrompt: "Você é o roteador de ferramentas do MCP <nome>. ... apenas chame a ferramenta.",
});
process.exit(exitCode);
```

Variáveis de ambiente do runner (opcionais): `EVAL_MODEL` (padrão `claude-opus-4-8`),
`EVAL_CONCURRENCY` (padrão 4), `EVAL_LIMIT` (smoke com as N primeiras fixtures).

## Gate

A partir da acurácia **top-1** (`evaluateGate`, limiares configuráveis por servidor):

| Acurácia top-1 | Decisão | Recomendação |
|---|---|---|
| `< 85%` | `remediar` | Abrir sessão de remediação (deferred loading / Code Mode / agrupamento). |
| `85%–90%` | `zona-cinzenta` | Manter sob observação; reavaliar após a próxima mudança de tool/descrição. |
| `>= 90%` | `despriorizar-refatoracao` | Despriorizar refatoração de catálogo; seguir consolidando via enums. |

Exit codes do runner: `0` = rodada completa (gate autoritativo) ou pulada sem API key;
`2` = uma ou mais fixtures não chegaram ao modelo (gate PRELIMINAR — não usar para
decisão).

## Migração do harness do senado (adoção na Fase 1)

A adoção troca imports sem mudar comportamento — as mensagens de gate são reproduzidas
byte-a-byte (teste de compatibilidade em `tests/score.test.ts`). Mapa:

| senado `evals/*` | `@sbissoli/mcp-evals` |
|---|---|
| `buildCatalog()` (sem args, memoizado, GROUPS embutido) | `buildCatalog(GROUPS)` — GROUPS fica no projeto; memoize no módulo do projeto (`export const CATALOG = buildCatalog(GROUPS)`) |
| `catalogToolNames()` / `catalogAreaByName()` | `CATALOG.toolNames` / `CATALOG.areaByName` |
| `catalogAsAnthropicTools()` | `catalogAsAnthropicTools(CATALOG)` |
| invariantes de `tests/evals/fixtures.test.ts` | `validateFixtures(FIXTURES, CATALOG, { minFixtures: 30, maxFixtures: 50, minAreas: 12 })` (os testes de contagem exata do catálogo e prefixo `senado_` permanecem no projeto) |
| `evaluateGate(acc)` (mensagem cita "67 tools") | `evaluateGate(acc, { toolCount: 67 })` — o runner preenche `toolCount` do catálogo automaticamente |
| `run.ts` inteiro (main/printReport/retry loop) | `runEval({ catalog, fixtures, systemPrompt })` — mesmo protocolo (`tool_choice: any`), mesmas env vars, mesmos exit codes |
| `retry.ts` / `score.ts` | idênticos (portados; `EvalApiError.retryAfterSeconds` virou campo declarado) |

Duas camadas de eval (ver FASE0_PROMPT_SESSAO.md): este pacote mede **seleção de tool**;
a camada de **completude de tarefa** (o modelo responde certo usando as tools?) é coberta
pelo `evaluation.py` do mcp-builder (assets em `fase0-insumos/mcp-builder-evaluation/`)
e/ou MCPJam Inspector — complementares, não substitutos.

## Sessão longa (`@sbissoli/mcp-evals/session`)

A segunda camada do pacote mede a **sessão**, não o turno: o modelo recebe uma tarefa de
10–25 passos, chama as tools de um servidor MCP real e segue até concluir. Nasceu para
responder, com número, se o diagnóstico de origem do contrato v1.1 (`provenance.retrieval`
— idas, tentativas, anomalias, `unstable`) **reduz chamadas ruins em execuções longas**.

- **Transporte**: loop client-side por stdio (`@modelcontextprotocol/client`, peer opcional)
  sobre o `dist/index.js` do servidor — sem deploy, sem URL pública, sem o MCP connector.
- **A/B**: braço A recebe o `tool_result` como sai do servidor; braço B recebe o mesmo texto
  com `provenance.retrieval` apagado (objeto ou array), no mesmo formato. Só o A ganha uma
  frase de system prompt explicando o campo; as duas prompts vão ao NDJSON.
- **Falha injetada na origem**: `node --import dist/session/fault.js` embrulha o `fetch` do
  processo do servidor e, por regra determinística (semente + URL + nº da ida), responde
  502/HTML/timeout em X % das idas. O `retrieval` sai verdadeiro; o servidor se comporta como
  em produção sob oscilação. Regras por servidor, versionadas nas tarefas dele.
- **Métrica "chamada ruim por tarefa"**, por trace: (a) repetir a MESMA chamada após erro
  definitivo, (b) recusa de esquema, (c) insistência (≥3 chamadas na mesma chave, todas com
  erro). (d) citar valor instável sem ressalva pede juiz (modelo barato) e sai separada.
- **Teto de gasto obrigatório** (`--budget-usd` / `EVAL_BUDGET_USD`): soma o `usage` de cada
  requisição, loop e juiz, e aborta ao cruzar; modelo sem preço na tabela é erro.
- **NDJSON com resume** por (data, sha, braço, nível): sessão concluída não roda de novo;
  dropout de infra e teto ficam fora da agregação. Relatório Markdown gerado dos NDJSON.
- **`--dry`**: servidor real, modelo dublado — executa o roteiro de cada tarefa e mede
  tokens por resposta (contagem exata com `--count-tokens`, endpoint gratuito) e o custo
  estimado por sessão ANTES de aprovar a rodada.

```bash
# no servidor sob teste (dist/ construído), sem gastar:
tsx ../mcp-br-commons/packages/mcp-evals/dist/session/cli.js   --server dist/index.js --tasks evals/session/tasks.ts --dry
# rodada paga (ANTHROPIC_API_KEY só aqui; nunca no processo do servidor):
EVAL_BUDGET_USD=5 tsx .../dist/session/cli.js --server dist/index.js   --tasks evals/session/tasks.ts --arm both --fault 0,20 --runs 1 --limit 1 --model claude-opus-5
```

O conjunto de tarefas (`TaskSet`) é um módulo do servidor: `systemPrompt` comum,
`faults` por nível, e tarefas com `prompt`, `expectedTools`, `script` (roteiro do `--dry`,
validado offline por `validateTaskSet` contra o catálogo), `answer` (gabarito mecânico) e
`trap`. Primeiro adotante: `bcb-br-mcp/src/evals/session/tasks.ts`.

## Desenvolvimento

```bash
npm run typecheck
npm test        # 112 testes offline (turno único + sessão longa: loop, filtro, métricas, falha, teto, resume)
npm run build
```

Dependências: `zod` ^4 como peer (para `z.toJSONSchema` no extrator); `@modelcontextprotocol/client` ^2 como peer OPCIONAL (só o subpath `./session` o carrega, por import dinâmico).
