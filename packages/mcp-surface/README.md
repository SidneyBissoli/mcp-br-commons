# @sbissoli/mcp-surface

**Mudou a superfície sem subir a versão = build vermelho e deploy recusado.**

> Mantido para o meu portfólio de servidores MCP. Uso por terceiros é bem-vindo, mas o
> roadmap segue as necessidades dos meus servidores.

A cópia de um servidor no MCP Registry carrega só nome, versão, pacotes e remotos — nenhuma
superfície. Quem compara o registro com o servidor só consegue comparar a **versão**, e isso
só vale se toda mudança de superfície subir a versão. Este pacote transforma essa disciplina
em teste. A ideia veio de um leitor (dev.to,
[3g5m4](https://dev.to/yahhi/comment/3g5m4) e 3g607), que achou o caso grave no servidor
dele: registro dizendo 0.1.0 com 4 tools só-leitura, servidor com 6, duas escrevendo pelo
usuário.

## O que entra na impressão digital

O `surface.lock.json`, commitado na raiz do servidor, tem duas seções. Cada uma guarda a
versão do `package.json` em que foi travada e o sha256 do conteúdo:

- **`declarada`** — `initialize` (instructions, capabilities, `serverInfo` sem a versão) +
  `tools/list` + `resources/list` + `resources/templates/list` + `prompts/list`,
  normalizados (chaves ordenadas, listas por nome/uri). Método não servido é `null`, não `[]`.
- **`semToken`** — QUAIS MÉTODOS RESPONDEM SEM CREDENCIAL, por configuração (ex.: `API_KEY`
  ausente e presente) e por rota. É comportamento que nenhuma listagem mostra.

A regra (`conferirSecao`): medido ≠ travado e versão igual → **falha**; versão diferente →
falha pedindo `npm run surface:lock`. O modo de escrita obedece à mesma regra e recusa
travar superfície nova sob a versão antiga.

## Adoção num servidor

1. **Teste da superfície declarada** (onde a fábrica do servidor é importável):

   ```ts
   import { capturarSuperficie, conferirSecao } from "@sbissoli/mcp-surface";
   import { createServer } from "../src/server.js";

   it("surface.lock.json — superfície declarada", async () => {
     const v = conferirSecao("surface.lock.json", "declarada", await capturarSuperficie(createServer()), pkg.version);
     expect(v.ok, v.mensagem).toBe(true);
   });
   ```

2. **Teste de quem responde sem token** (na borda HTTP, chamando o `fetch` do Worker):

   ```ts
   import { comHost, conferirSecao, corpoDoPedido, CABECALHOS_MCP, ipDaSonda, medirSemToken, sondaSemToken } from "@sbissoli/mcp-surface";

   const envs = { apiKeyAusente: {} as Env, apiKeyPresente: { API_KEY: "x" } as Env };
   const medido = await medirSemToken(Object.keys(envs), ["POST /mcp", "POST /mcp/uso-proprio"],
     sondaSemToken({ name: "<tool sem rede>", arguments: {} }),
     (config, rota, pedido) => worker.fetch(comHost(new Request(`https://host${rota.slice(5)}`, {
       method: "POST", headers: { ...CABECALHOS_MCP, "CF-Connecting-IP": ipDaSonda() }, body: corpoDoPedido(pedido),
     }), "host"), envs[config], ctx));
   expect(conferirSecao("surface.lock.json", "semToken", medido, pkg.version).ok).toBe(true);
   ```

3. **Script** no `package.json`:
   `"surface:lock": "npm run build && mcp-surface travar --cmd \"vitest run tests/surface-lock.test.ts\""`.

4. **Deploy**: rodar `npm test` ANTES do wrangler, e no fim
   `npx mcp-surface verificar https://<host>/mcp --tool <tool sem rede>` — prova que o que
   está no ar é o que foi travado. **Publish**: `npm test` antes do npm.

5. **Uma vez**: `npx mcp-surface replay --url https://<host>/mcp` grava
   `baselines/replay-<data>.md` com todas as versões publicadas no npm, uma contra a
   anterior, as remoções fora de major e o ar contra a versão que o `/status` declara.

Fluxo de quem muda a superfície: `npm version <nível> --no-git-tag-version` →
`npm run surface:lock` → commitar o lock junto.

## Teste com forma de cliente (`@sbissoli/mcp-surface/cliente`)

O servidor interrogado pelo `Client` do SDK, que reprova o resultado de `tools/call`
contra o `outputSchema` **listado**. Assim o teste falha como a sessão do usuário falharia,
sem um validador escolhido por nós. É subpath à parte porque o `Client` compila schemas
com Ajv (`new Function`), que o Worker proíbe: só se importa em teste Node, e o
`@modelcontextprotocol/client` é peer opcional.

```ts
import { chamarComoCliente, conectarComoCliente, controlesNegativos } from "@sbissoli/mcp-surface/cliente";

const client = await conectarComoCliente(buildServer(env));
const r = await chamarComoCliente(client, "minha_tool", { x: 1 }); // lança se o Client reprovar ou se vier isError

const vs = await controlesNegativos(() => buildServer(env), "minha_tool", { x: 1 });
for (const v of vs) expect(v.obtido, `${v.descricao}: ${v.mensagem ?? ""}`).toBe(v.esperado);
```

- `conectarComoCliente` passa toda mensagem do servidor por JSON antes de entregá-la: o
  transporte em memória não serializa, e chave `undefined` só some no fio.
- `chamarComoCliente` faz `tools/list` antes do primeiro `tools/call` da conexão. Sem
  isso, o `Client` (2.0 a 2.2) devolve o resultado sem validar.
- `controlesNegativos` adultera o resultado entre servidor e cliente, com quebras
  **derivadas do schema listado**: `structuredContent` ausente, cada obrigatório ausente e
  cada obrigatório com `type` declarado recebendo um valor que nenhum tipo dele aceita (o
  anulável `["string", "null"]` recebe `0`). As quebras rodam em paralelo, cada uma com
  servidor próprio. Cada quebra tem de fazer a chamada falhar. O
  último veredito é a armadilha (sem `tools/list`, a quebra passa calada); se o SDK mudar,
  ele acusa. Quebras do próprio servidor, como campo a mais onde o schema fecha o objeto,
  entram pelo 4º argumento.

## Server card (`@sbissoli/mcp-surface/card`)

O `/.well-known/mcp/server-card.json` que scanners de diretório (Smithery) leem quando a
varredura do `/mcp` não completa, **derivado da mesma captura que a trava normaliza**.
Forma da Smithery: `serverInfo` (do `initialize` real, com a versão), `authentication`,
`tools`, `resources`, `prompts`, mais `protocolVersion`, `capabilities`, `instructions` e
`resourceTemplates`. Método não servido fica fora do card (não vira `[]`). Seguro para
Worker: o grafo do subpath não importa `node:crypto`, `node:child_process`, `node:fs` nem
o `Client` (há teste que confere).

```ts
// worker/src/index.ts
import { autenticacaoDaTrava, capturarCard, cardEmCache } from "@sbissoli/mcp-surface/card";
import trava from "../../surface.lock.json";

const serverCard = cardEmCache(() => capturarCard(buildServer(), { authentication: autenticacaoDaTrava(trava) }));
// GET /.well-known/mcp/server-card.json → new Response(await serverCard(), { headers: { "Content-Type": "application/json" } })
```

```ts
// teste do servidor: o card não pode divergir da trava
import { normalizarSuperficie, impressaoDigital, lerTrava } from "@sbissoli/mcp-surface";
import { capturarCard, superficieDoCard } from "@sbissoli/mcp-surface/card";

const card = await capturarCard(buildServer());
expect(impressaoDigital(normalizarSuperficie(superficieDoCard(card)))).toBe(lerTrava(caminho).declarada?.sha256);
```

- `autenticacaoDaTrava(trava)` deriva `authentication.required` da seção `semToken`:
  `tools/list` em `apiKeyAusente` / `POST /mcp`. Lança se a medição não está lá.
- `capturarCardPorFetch(buscar, url)` monta o mesmo card por HTTP stateless (JSON ou SSE),
  para superfície atrás de outro `fetch` (o container do sih). Lança se o `initialize`
  não responde; o fallback é do servidor.
- `cardEmCache` guarda a primeira montagem que dá certo, por isolate; falha não fica.

## Observações

- Uma atualização do SDK que mexa nas `capabilities` também acende a trava — de propósito:
  o cliente vê outra superfície.
- Superfície que depende de ambiente (flag de feature, perfil de tools) precisa ser travada
  com o ambiente fixo, ou em uma captura por perfil.
- Mudar a normalização deste pacote muda o sha de todo lock que o usa — ver o CHANGELOG.
