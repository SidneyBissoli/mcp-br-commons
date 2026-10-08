# @sbissoli/mcp-surface

🇧🇷 [Leia em Português](https://github.com/SidneyBissoli/mcp-br-commons/blob/main/packages/mcp-surface/LEIA-ME.md)

**Surface changed without a version bump = red build and refused deploy.**

> Maintained for my own portfolio of MCP servers. Third-party use is welcome, but the
> roadmap follows what my servers need, and there is no API stability promise for others.
> The API and CLI names are in Portuguese; the main ones are glossed below.

The copy of a server in the MCP Registry carries only name, version, packages and remotes —
no surface. Anyone comparing the registry with the server can only compare the **version**,
and that only means something if every surface change bumps the version. This package turns
that discipline into a test. The idea came from a reader on dev.to
([3g5m4](https://dev.to/yahhi/comment/3g5m4) and 3g607), who found the serious case in their
own server: the registry said 0.1.0 with 4 read-only tools, the server had 6, two of them
writing on the user's behalf.

## What goes into the fingerprint

`surface.lock.json`, committed at the server's root, has two sections. Each one stores the
`package.json` version it was locked under and the sha256 of its content:

- **`declarada`** (declared) — `initialize` (instructions, capabilities, `serverInfo` without
  the version) + `tools/list` + `resources/list` + `resources/templates/list` +
  `prompts/list`, normalised (sorted keys, lists ordered by name/uri by UTF-16 code unit; the
  full canonical form is in [SPEC.md](SPEC.md)). A method that is not
  served is `null`, not `[]`.
- **`semToken`** (without token) — WHICH METHODS ANSWER WITHOUT A CREDENTIAL, per
  configuration (e.g. `API_KEY` unset and set) and per route. This is behaviour no listing
  shows.

The rule (`conferirSecao`, "check section"): measured ≠ locked with the same version →
**fail**; different version → fail, asking for `npm run surface:lock`. Write mode follows the
same rule and refuses to lock a new surface under the old version.

## Adopting it in a server

1. **Declared-surface test** (where the server factory can be imported):

   ```ts
   import { capturarSuperficie, conferirSecao } from "@sbissoli/mcp-surface";
   import { createServer } from "../src/server.js";

   it("surface.lock.json — declared surface", async () => {
     const v = conferirSecao("surface.lock.json", "declarada", await capturarSuperficie(createServer()), pkg.version);
     expect(v.ok, v.mensagem).toBe(true);
   });
   ```

2. **Test of what answers without a token** (at the HTTP edge, calling the Worker's `fetch`):

   ```ts
   import { comHost, conferirSecao, corpoDoPedido, CABECALHOS_MCP, ipDaSonda, medirSemToken, sondaSemToken } from "@sbissoli/mcp-surface";

   const envs = { apiKeyAusente: {} as Env, apiKeyPresente: { API_KEY: "x" } as Env };
   const medido = await medirSemToken(Object.keys(envs), ["POST /mcp", "POST /mcp/uso-proprio"],
     sondaSemToken({ name: "<tool with no network access>", arguments: {} }),
     (config, rota, pedido) => worker.fetch(comHost(new Request(`https://host${rota.slice(5)}`, {
       method: "POST", headers: { ...CABECALHOS_MCP, "CF-Connecting-IP": ipDaSonda() }, body: corpoDoPedido(pedido),
     }), "host"), envs[config], ctx));
   expect(conferirSecao("surface.lock.json", "semToken", medido, pkg.version).ok).toBe(true);
   ```

3. **Script** in `package.json` (`travar` = lock):
   `"surface:lock": "npm run build && mcp-surface travar --cmd \"vitest run tests/surface-lock.test.ts\""`.

4. **Deploy**: run `npm test` BEFORE wrangler, and at the end
   `npx mcp-surface verificar https://<host>/mcp --tool <tool with no network access>`
   (`verificar` = verify) — it proves that what is live is what was locked. It first asks for a
   method that does not exist and refuses to compare if that gets a `result`: an endpoint that says
   yes to everything proves nothing.
   **Publish**: `npm test` before npm.

5. **Once**: `npx mcp-surface replay --url https://<host>/mcp` writes
   `baselines/replay-<date>.md` with every version published on npm, each against the
   previous one, the removals outside a major release, and the live endpoint against the
   version its `/status` declares.

Workflow for whoever changes the surface: `npm version <level> --no-git-tag-version` →
`npm run surface:lock` → commit the lock with it.

## Publishing the fingerprint so clients can check it (0.5.0)

The lock makes the publisher keep the promise; on its own, a client still can't check it,
because the hash lives in the repository and the registry entry carries only the version.
From 0.5.0 the fingerprint is published **with each release, in the registry entry**, under
`_meta["io.modelcontextprotocol.registry/publisher-provided"]` in `server.json`. A host can
recompute it on first connect and refuse, or ask again, when it differs from what the registry
lists for that version. The canonical form is written down in **[SPEC.md](SPEC.md)**, so that a
host built by someone else hashes the same bytes; [`exemplos/verify.mjs`](exemplos/verify.mjs)
is a second implementation of it with no dependencies, and the tests require both to agree.

Only what a stranger can reproduce without a credential is published: the declared surface,
and which methods answer anonymously on the published endpoint in the production configuration.

Both ideas came from readers of the replay article: publishing the hashes in the registry and
writing the normalisation down from [Mike Dabydeen](https://dev.to/_firelinks/comment/3glme);
the "only what a stranger can reproduce" cut from
[Valentina Koniukhova](https://dev.to/yahhi/comment/3gmgp), who shipped it in worklore 0.5.1.

6. **Publish the fingerprint**: append `mcp-surface registro` to the lock script, with the same
   tool the deploy check calls —
   `"surface:lock": "… && mcp-surface travar --cmd \"…\" && mcp-surface registro --tool <tool> --args '{}'"`
   — and check, in the lock test, that the committed `server.json` carries what the lock produces:

   ```ts
   import { conferirMetaDoServerJson } from "@sbissoli/mcp-surface";
   it("server.json publishes the lock's fingerprint", () => {
     const v = conferirMetaDoServerJson("server.json", "surface.lock.json", { chamada: { name: "<tool>", arguments: {} } });
     expect(v.ok, v.mensagem).toBe(true);
   });
   ```

7. **After `mcp-publisher publish`**: `npx mcp-surface conferir-registro` ("check the registry")
   reads the entry for the version in `server.json` and compares it with the live endpoint, the
   way a client would — it does not read the lock.

Anyone can check a server themselves:

```sh
curl -sO https://raw.githubusercontent.com/SidneyBissoli/mcp-br-commons/main/packages/mcp-surface/exemplos/verify.mjs
node verify.mjs io.github.SidneyBissoli/bcb-br-mcp
```

That shows the live server is what the registry published for that version (the registry does not
let a published version change). To check that the published hash is the **public source's**, not
just the publisher's word, run the lock tests from the tag ([SPEC.md §6.1](SPEC.md)):

```sh
git clone --depth 1 --branch v1.16.2 https://github.com/SidneyBissoli/bcb-br-mcp && cd bcb-br-mcp
npm ci && npm test
node -p "require('./surface.lock.json').declarada.sha256"   # = the registry's declared.sha256
```

## Client-shaped test (`@sbissoli/mcp-surface/cliente`)

The server is questioned by the SDK's `Client`, which rejects a `tools/call` result against
the **listed** `outputSchema`. So the test fails the way the user's session would fail,
without a validator of our choosing. It is a separate subpath because the `Client` compiles
schemas with Ajv (`new Function`), which the Worker forbids: import it only in Node tests;
`@modelcontextprotocol/client` is an optional peer.

```ts
import { chamarComoCliente, conectarComoCliente, controlesNegativos } from "@sbissoli/mcp-surface/cliente";

const client = await conectarComoCliente(buildServer(env));
const r = await chamarComoCliente(client, "my_tool", { x: 1 }); // throws if the Client rejects or isError comes back

const vs = await controlesNegativos(() => buildServer(env), "my_tool", { x: 1 });
for (const v of vs) expect(v.obtido, `${v.descricao}: ${v.mensagem ?? ""}`).toBe(v.esperado);
```

- `conectarComoCliente` (connect as client) passes every server message through JSON before
  handing it over: the in-memory transport doesn't serialise, and an `undefined` key only
  disappears on the wire.
- `chamarComoCliente` (call as client) does `tools/list` before the connection's first
  `tools/call`. Without it, the `Client` (2.0 to 2.2) returns the result unvalidated.
- `controlesNegativos` (negative controls) tampers with the result between server and client,
  with breakages **derived from the listed schema**: `structuredContent` missing, each
  required field missing, and each required field with a declared `type` receiving a value
  none of its types accept (the nullable `["string", "null"]` gets `0`). The breakages run
  in parallel, each with its own server. Each breakage must make the call fail. The last
  verdict is the trap (without `tools/list`, the breakage passes silently); if the SDK
  changes, it says so. Server-specific breakages, such as an extra field where the schema
  closes the object, go in through the 4th argument.

## Server card (`@sbissoli/mcp-surface/card`)

The `/.well-known/mcp/server-card.json` that directory scanners (Smithery) read when the
scan of `/mcp` doesn't complete, **derived from the same capture the lock normalises**.
Smithery's shape: `serverInfo` (from the real `initialize`, with the version),
`authentication`, `tools`, `resources`, `prompts`, plus `protocolVersion`, `capabilities`,
`instructions` and `resourceTemplates`. A method that is not served stays out of the card
(it doesn't become `[]`). Safe for Workers: the subpath's import graph doesn't pull in
`node:crypto`, `node:child_process`, `node:fs` or the `Client` (a test checks it).

```ts
// worker/src/index.ts
import { autenticacaoDaTrava, capturarCard, cardEmCache } from "@sbissoli/mcp-surface/card";
// Named import (moduleResolution Bundler): esbuild leaves the rest of the lock out of the bundle.
// NodeNext has no named JSON import: `import trava from "…" with { type: "json" }`.
import { semToken } from "../../surface.lock.json";

const serverCard = cardEmCache(() => capturarCard(buildServer(), { authentication: autenticacaoDaTrava({ semToken }) }));
// GET /.well-known/mcp/server-card.json → new Response(await serverCard(), { headers: { "Content-Type": "application/json" } })
```

```ts
// server test: the card must not diverge from the lock
import { normalizarSuperficie, impressaoDigital, lerTrava } from "@sbissoli/mcp-surface";
import { capturarCard, superficieDoCard } from "@sbissoli/mcp-surface/card";

const card = await capturarCard(buildServer());
expect(impressaoDigital(normalizarSuperficie(superficieDoCard(card)))).toBe(lerTrava(caminho).declarada?.sha256);
```

- `autenticacaoDaTrava(trava)` (authentication from the lock) derives
  `authentication.required` from the `semToken` section: `tools/list` under
  `apiKeyAusente` / `POST /mcp`. Throws if that measurement isn't there.
- `capturarCardPorFetch(buscar, url)` builds the same card over stateless HTTP (JSON or
  SSE), for a surface behind another `fetch` (the sih container). Throws if `initialize`
  doesn't answer; the fallback is the server's job. Code that ONLY uses this path imports
  from **`@sbissoli/mcp-surface/card/http`**: everything in `/card` except `capturarCard`,
  without the SDK as a value in the graph — at the sih edge, 156 → 32 KiB gzip.
- `cardEmCache` (cached card) keeps the first build that succeeds, per isolate; a failure is
  not kept.

## Notes

- An SDK update that touches `capabilities` also turns the lock red — on purpose: the client
  sees a different surface.
- A surface that depends on the environment (feature flag, tool profile) must be locked with
  the environment fixed, or with one capture per profile.
- Changing this package's normalisation changes the sha of every lock that uses it — see the
  CHANGELOG.

## Glossary

The API keeps its Portuguese identifiers, so code that imports it uses them as written below.

| Identifier (as exported) | Meaning in English |
|:--|:--|
| `trava` / `travar` | lock / to lock (`surface.lock.json`) |
| `declarada` | declared surface section |
| `semToken` | "without token" section |
| `conferirSecao` | check one section of the lock against a measurement |
| `capturarSuperficie` | capture a server's surface in-process |
| `impressaoDigital` | fingerprint (sha256 of the normalised value) |
| `verificar` | verify the live endpoint against the lock |
| `registro` | write the fingerprint into `server.json` for the registry |
| `conferir-registro` / `conferirRegistro` | check the registry entry against the live endpoint, as a client |
| `conferirMetaDoServerJson` | check that `server.json` publishes what the lock produces |
| `apiKeyAusente` / `apiKeyPresente` | API key unset / set |

## License

MIT — see [`LICENSE`](https://github.com/SidneyBissoli/mcp-br-commons/blob/main/packages/mcp-surface/LICENSE).
