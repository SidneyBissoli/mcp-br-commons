import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CHAVE_DA_SUPERFICIE,
  CHAVE_DO_PUBLICADOR,
  capturarHttp,
  compararUnidades,
  conferirMetaDoServerJson,
  conferirRegistro,
  conferirSecao,
  gravarMetaNoServerJson,
  impressaoDigital,
  serializarCanonico,
  metaDoRegistro,
  normalizarSuperficie,
  type SuperficieBruta,
  type Trava,
} from "../src/index.js";
import { capturarBrutaPor } from "../src/captura.js";
// A segunda implementação, escrita a partir da SPEC. Sem tipos, de propósito.
// @ts-expect-error módulo .mjs sem declaração
import * as verify from "../exemplos/verify.mjs";

const SPEC = readFileSync(new URL("../SPEC.md", import.meta.url), "utf8");

describe.each([
  ["7.1", "### 7.1", "### 7.2"],
  // 7.2: chaves de cara inteira — "10" antes de "9" (achado de Valentina Koniukhova, 08/10/2026)
  ["7.2", "### 7.2", "## 8."],
])("SPEC.md §%s: o vetor de teste é o que as DUAS implementações calculam", (_n, de, ate) => {
  const secao = SPEC.slice(SPEC.indexOf(de), SPEC.indexOf(ate));
  const bruta = JSON.parse(/```json\n([\s\S]*?)```/.exec(secao)![1]!) as SuperficieBruta;
  // o bloco SEM linguagem que começa com "{" (o anterior é ```json)
  const serializada = /\n```\n(\{.*\})\n```/.exec(secao)![1]!;
  const sha = /sha256 is `([0-9a-f]{64})`/.exec(secao)![1]!;

  it("pacote: mesma serialização e mesmo sha da SPEC", () => {
    const n = normalizarSuperficie(bruta);
    expect(serializarCanonico(n)).toBe(serializada);
    expect(impressaoDigital(n)).toBe(sha);
  });

  it("verify.mjs: mesma serialização e mesmo sha da SPEC", () => {
    const n = verify.canonical(bruta);
    expect(verify.canonicalJson(n)).toBe(serializada);
    expect(verify.sha256(n)).toBe(sha);
  });
});

describe("SPEC.md §3: ordem por unidade UTF-16", () => {
  it("chave de cara inteira: o objeto JS põe '9' antes de '10'; a forma canônica, não", () => {
    const v = { a: 1, "9": 2, "10": 3 };
    expect(JSON.stringify(v)).toBe('{"9":2,"10":3,"a":1}');
    expect(serializarCanonico(v)).toBe('{"10":3,"9":2,"a":1}');
    expect(verify.canonicalJson(v)).toBe('{"10":3,"9":2,"a":1}');
  });

  it("a ordem é por unidade UTF-16, nunca por locale (o localeCompare de até 0.4.x)", () => {
    expect(["b", "a", "B", "_", "0"].sort(compararUnidades)).toEqual(["0", "B", "_", "a", "b"]);
    expect(["b", "a", "B"].sort((x, y) => x.localeCompare(y))).not.toEqual(["B", "a", "b"]);
  });
});

describe("captura segue nextCursor", () => {
  const paginas: Record<string, Record<string, unknown>> = {
    "": { tools: [{ name: "a" }], nextCursor: "p2" },
    p2: { tools: [{ name: "b" }], nextCursor: "" },
  };

  it("concatena as páginas, na ordem", async () => {
    const b = await capturarBrutaPor(async (method, params) => {
      if (method === "initialize") return {};
      if (method !== "tools/list") return undefined;
      return paginas[String(params?.["cursor"] ?? "")];
    }, "t");
    expect(b.tools).toEqual([{ name: "a" }, { name: "b" }]);
    expect(b.prompts).toBeUndefined();
  });

  it("página que falha no meio = método sem resposta, nunca lista truncada", async () => {
    const b = await capturarBrutaPor(async (method, params) => {
      if (method !== "tools/list") return undefined;
      return params?.["cursor"] ? undefined : paginas[""];
    }, "t");
    expect(b.tools).toBeUndefined();
  });
});

describe("registro: publicar e conferir contra endpoints de verdade (HTTP local)", () => {
  const abertos: Server[] = [];
  afterEach(() => {
    for (const s of abertos.splice(0)) s.close();
  });

  async function subir(trata: (corpo: string, res: import("node:http").ServerResponse) => void): Promise<string> {
    const http = createServer((req, res) => {
      let corpo = "";
      req.on("data", c => (corpo += c));
      req.on("end", () => trata(corpo, res));
    });
    abertos.push(http);
    await new Promise<void>(ok => http.listen(0, "127.0.0.1", ok));
    return `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  }

  /** Servidor MCP mínimo, stateless, que PAGINA o tools/list e responde em SSE. */
  /** `simATudo`: responde `result` a qualquer método — o dublê/proxy que a sonda tem de recusar. */
  function servidorMcp(instructions: string, simATudo = false) {
    return subir((corpo, res) => {
      const { id, method, params } = JSON.parse(corpo) as { id: number; method: string; params?: { cursor?: string } };
      const results: Record<string, unknown> = {
        initialize: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, instructions, serverInfo: { name: "t", version: "1.0.0" } },
        ping: {},
        "tools/list": params?.cursor
          ? { tools: [{ name: "a_local", inputSchema: { type: "object" } }] }
          : { tools: [{ name: "B_rede", inputSchema: { type: "object" } }], nextCursor: "2" },
        "tools/call": { content: [{ type: "text", text: "ok" }] },
      };
      const r = results[method];
      res.writeHead(200, { "Content-Type": "text/event-stream" }).end(
        `event: message\ndata: ${JSON.stringify(r || simATudo ? { jsonrpc: "2.0", id, result: r ?? {} } : { jsonrpc: "2.0", id, error: { code: -32601, message: "não" } })}\n\n`,
      );
    });
  }

  const chamada = { name: "a_local", arguments: {} };
  const respostas = {
    initialize: true,
    ping: true,
    "tools/list": true,
    "resources/list": false,
    "resources/templates/list": false,
    "prompts/list": false,
    "tools/call": true,
  };

  async function travar(endpoint: string): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), "registro-"));
    const f = join(dir, "surface.lock.json");
    conferirSecao(f, "declarada", await capturarHttp(endpoint), "1.0.0", true);
    conferirSecao(f, "semToken", { apiKeyAusente: { "POST /mcp": respostas }, apiKeyPresente: { "POST /mcp": {} } }, "1.0.0", true);
    writeFileSync(
      join(dir, "server.json"),
      JSON.stringify({
        name: "io.github.x/t",
        version: "1.0.1",
        remotes: [{ type: "streamable-http", url: endpoint }],
        _meta: { [CHAVE_DO_PUBLICADOR]: { outro: { fica: true } }, "outra.chave/descartada": 1 },
      }),
    );
    return dir;
  }

  it("metaDoRegistro: sem a chamada, tools/call sai da promessa; com ela, entra com a chamada", () => {
    const trava = {
      declarada: { versao: "1.0.0", sha256: "d".repeat(64), conteudo: {} },
      semToken: { versao: "1.0.0", sha256: "s", conteudo: { apiKeyAusente: { "POST /mcp": respostas } } },
    } as Trava;
    const sem = metaDoRegistro(trava, { endpoint: "https://x/mcp" });
    expect(sem.anonymous.answers).not.toHaveProperty("tools/call");
    expect(sem.anonymous.call).toBeUndefined();
    const com = metaDoRegistro(trava, { endpoint: "https://x/mcp", chamada });
    expect(com.anonymous.answers["tools/call"]).toBe(true);
    expect(com.anonymous.call).toEqual(chamada);
    expect(com.anonymous.sha256).toBe(impressaoDigital(com.anonymous.answers));
    expect(com.declared).toEqual({ sha256: "d".repeat(64), lockedAt: "1.0.0" });
    expect(() => metaDoRegistro({}, { endpoint: "x" })).toThrow(/incompleto/);
  });

  it("gravar preserva o resto do _meta; conferir acusa server.json defasado da trava", async () => {
    const endpoint = `${await servidorMcp("i")}/mcp`;
    const dir = await travar(endpoint);
    const sj = join(dir, "server.json");
    const lock = join(dir, "surface.lock.json");
    expect(conferirMetaDoServerJson(sj, lock, { chamada }).ok).toBe(false);

    const meta = gravarMetaNoServerJson(sj, lock, { chamada });
    const gravado = JSON.parse(readFileSync(sj, "utf8")) as Record<string, Record<string, Record<string, unknown>>>;
    expect(gravado["_meta"]![CHAVE_DO_PUBLICADOR]!["outro"]).toEqual({ fica: true });
    expect(gravado["_meta"]![CHAVE_DO_PUBLICADOR]![CHAVE_DA_SUPERFICIE]).toEqual(meta);
    expect(meta.endpoint).toBe(endpoint);
    expect(conferirMetaDoServerJson(sj, lock, { chamada }).ok).toBe(true);

    // a superfície mudou e a trava foi regravada; o server.json, não
    const t = JSON.parse(readFileSync(lock, "utf8")) as Trava;
    t.declarada!.sha256 = "e".repeat(64);
    writeFileSync(lock, JSON.stringify(t));
    expect(conferirMetaDoServerJson(sj, lock, { chamada }).mensagem).toContain("diferente da trava");
  });

  it("recusa gravar acima do teto de 4 KB do registro", async () => {
    const dir = await travar(`${await servidorMcp("i")}/mcp`);
    const grande = { name: "x", arguments: { a: "y".repeat(5000) } };
    expect(() => gravarMetaNoServerJson(join(dir, "server.json"), join(dir, "surface.lock.json"), { chamada: grande })).toThrow(/4096/);
  });

  async function registroCom(serverJson: string): Promise<string> {
    const entrada = { server: JSON.parse(readFileSync(serverJson, "utf8")), _meta: {} };
    return subir((_c, res) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(entrada)));
  }

  it("conferirRegistro: confere pelo registro e pelo ar, sem ler a trava — e o verify.mjs chega ao mesmo sha", async () => {
    const endpoint = `${await servidorMcp("i")}/mcp`;
    const dir = await travar(endpoint);
    const sj = join(dir, "server.json");
    const meta = gravarMetaNoServerJson(sj, join(dir, "surface.lock.json"), { chamada });
    const registro = await registroCom(sj);
    expect(await conferirRegistro({ nome: "io.github.x/t", versao: "1.0.1", registro, tentativas: 1 })).toBeNull();
    // a segunda implementação, pelo HTTP de verdade (SSE + paginação)
    expect(verify.sha256(await verify.capture(endpoint))).toBe(meta.declared.sha256);
  });

  it("conferirRegistro acusa instructions que mudaram no ar sem a versão subir", async () => {
    const dir = await travar(`${await servidorMcp("i")}/mcp`);
    const sj = join(dir, "server.json");
    gravarMetaNoServerJson(sj, join(dir, "surface.lock.json"), { chamada });
    const outro = `${await servidorMcp("i, e agora outra regra")}/mcp`;
    const s = JSON.parse(readFileSync(sj, "utf8")) as Record<string, Record<string, Record<string, Record<string, unknown>>>>;
    s["_meta"]![CHAVE_DO_PUBLICADOR]![CHAVE_DA_SUPERFICIE]!["endpoint"] = outro;
    writeFileSync(sj, JSON.stringify(s));
    const erro = await conferirRegistro({ nome: "io.github.x/t", versao: "1.0.1", registro: await registroCom(sj), tentativas: 1 });
    expect(erro).toMatch(/no ar [0-9a-f]{12} ≠ registro/);
  });

  // Ideia de Valentina Koniukhova (dev.to, 3gmbl): uma sonda que não sabe dizer não não prova nada.
  it("conferirRegistro e verify.mjs recusam comparar um endpoint que diz sim ao método inexistente", async () => {
    const dir = await travar(`${await servidorMcp("i")}/mcp`);
    const sj = join(dir, "server.json");
    gravarMetaNoServerJson(sj, join(dir, "surface.lock.json"), { chamada });
    const surdo = `${await servidorMcp("i", true)}/mcp`;
    const s = JSON.parse(readFileSync(sj, "utf8")) as Record<string, Record<string, Record<string, Record<string, unknown>>>>;
    s["_meta"]![CHAVE_DO_PUBLICADOR]![CHAVE_DA_SUPERFICIE]!["endpoint"] = surdo;
    writeFileSync(sj, JSON.stringify(s));
    const erro = await conferirRegistro({ nome: "io.github.x/t", versao: "1.0.1", registro: await registroCom(sj), tentativas: 1 });
    expect(erro).toContain("não sabe dizer não");
    expect(await verify.saysNo(surdo)).toBe(false);
    expect(await verify.saysNo(`${await servidorMcp("i")}/mcp`)).toBe(true);
  });

  it("entrada sem o bloco, ou com forma desconhecida, é dita — não vira 'confere'", async () => {
    const dir = await travar(`${await servidorMcp("i")}/mcp`);
    const sj = join(dir, "server.json");
    expect(await conferirRegistro({ nome: "n", versao: "1", registro: await registroCom(sj), tentativas: 1 })).toContain("não traz _meta");
    gravarMetaNoServerJson(sj, join(dir, "surface.lock.json"));
    const s = JSON.parse(readFileSync(sj, "utf8")) as Record<string, Record<string, Record<string, Record<string, unknown>>>>;
    s["_meta"]![CHAVE_DO_PUBLICADOR]![CHAVE_DA_SUPERFICIE]!["form"] = "mcp-surface/9";
    writeFileSync(sj, JSON.stringify(s));
    expect(await conferirRegistro({ nome: "n", versao: "1", registro: await registroCom(sj), tentativas: 1 })).toContain("desconhecida");
  });
});
