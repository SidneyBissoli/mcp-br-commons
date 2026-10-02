import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  capturarHttp,
  comHost,
  conferirSecao,
  diferenca,
  impressaoDigital,
  lerCorpoJsonRpc,
  linhaDeCompatibilidade,
  medirSemToken,
  sondaSemToken,
  verificarNoAr,
} from "../src/index.js";

describe("sonda", () => {
  it("lê corpo JSON e SSE", () => {
    expect(lerCorpoJsonRpc('{"jsonrpc":"2.0","id":1,"result":{"a":1}}')?.result).toEqual({ a: 1 });
    expect(lerCorpoJsonRpc('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n')?.result).toEqual({});
    expect(lerCorpoJsonRpc("Missing Authorization header")).toBeUndefined();
  });

  it("tools/call entra só com uma tool local declarada", () => {
    expect(sondaSemToken().map(p => p.method)).not.toContain("tools/call");
    expect(sondaSemToken({ name: "x", arguments: {} }).at(-1)).toEqual({
      method: "tools/call",
      params: { name: "x", arguments: {} },
    });
  });

  it("medirSemToken: 200 com result conta; 401 e 200 com erro não", async () => {
    const m = await medirSemToken(["aberto", "fechado"], ["POST /mcp"], sondaSemToken(), async (config, _rota, pedido) => {
      if (config === "fechado") return new Response("Missing Authorization header", { status: 401 });
      if (pedido.method === "prompts/list") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "x" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), { status: 200 });
    });
    expect(m["aberto"]?.["POST /mcp"]?.["tools/list"]).toBe(true);
    expect(m["aberto"]?.["POST /mcp"]?.["prompts/list"]).toBe(false);
    expect(Object.values(m["fechado"]?.["POST /mcp"] ?? {})).toEqual(Array(6).fill(false));
  });

  it("comHost põe o Host que o Request do Node descartaria", () => {
    const r = comHost(new Request("https://x.example/mcp", { method: "POST" }), "x.example");
    expect(r.headers.get("host")).toBe("x.example");
    expect(r.method).toBe("POST");
  });
});

describe("verificarNoAr contra um endpoint de verdade (HTTP local)", () => {
  let http: Server | undefined;
  afterEach(() => http?.close());

  /** Endpoint MCP mínimo, stateless, sem auth; `exigeToken` derruba tools/list sem credencial. */
  async function subir(instructions: string, exigeToken = false): Promise<string> {
    http = createServer((req, res) => {
      let corpo = "";
      req.on("data", c => (corpo += c));
      req.on("end", () => {
        const { id, method } = JSON.parse(corpo) as { id: number; method: string };
        if (exigeToken && method === "tools/list" && !req.headers.authorization) {
          res.writeHead(401).end("Missing Authorization header");
          return;
        }
        const results: Record<string, unknown> = {
          initialize: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, instructions, serverInfo: { name: "t", version: "1.0.0" } },
          ping: {},
          "tools/list": { tools: [{ name: "a", inputSchema: { type: "object" } }] },
        };
        const r = results[method];
        res.writeHead(200, { "Content-Type": "application/json" }).end(
          JSON.stringify(r ? { jsonrpc: "2.0", id, result: r } : { jsonrpc: "2.0", id, error: { code: -32601, message: "não" } }),
        );
      });
    });
    await new Promise<void>(ok => http!.listen(0, "127.0.0.1", ok));
    const porta = (http.address() as { port: number }).port;
    return `http://127.0.0.1:${porta}/mcp`;
  }

  async function travar(url: string): Promise<string> {
    const f = join(mkdtempSync(join(tmpdir(), "verificar-")), "surface.lock.json");
    conferirSecao(f, "declarada", await capturarHttp(url), "1.0.0", true);
    const semToken = await medirSemToken(["apiKeyAusente"], ["POST /mcp"], sondaSemToken(), async (_c, _r, p) =>
      fetch(url, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: p.method, params: p.params }) }),
    );
    conferirSecao(f, "semToken", semToken, "1.0.0", true);
    return f;
  }

  it("confere quando o ar é o travado", async () => {
    const url = await subir("instruções");
    expect(await verificarNoAr({ url, caminhoDaTrava: await travar(url), tentativas: 1 })).toBeNull();
  });

  it("acusa instructions mudadas no ar", async () => {
    const f = await travar(await subir("instruções"));
    http!.close();
    const url = await subir("instruções novas, com regra de auth");
    expect(await verificarNoAr({ url, caminhoDaTrava: f, tentativas: 1 })).toContain("declarada no ar");
  });

  it("--perfil: declarada como mapa por perfil, conferida pela chave que o endpoint serve", async () => {
    const url = await subir("instruções");
    const f = await travar(url);
    const travaComPerfis = JSON.parse(readFileSync(f, "utf8")) as { declarada: { conteudo: unknown; sha256: string } };
    const unica = travaComPerfis.declarada.conteudo;
    travaComPerfis.declarada.conteudo = { completo: unica, outro: { tools: [] } };
    travaComPerfis.declarada.sha256 = impressaoDigital(travaComPerfis.declarada.conteudo);
    writeFileSync(f, JSON.stringify(travaComPerfis));
    expect(await verificarNoAr({ url, caminhoDaTrava: f, perfil: "completo", tentativas: 1 })).toBeNull();
    expect(await verificarNoAr({ url, caminhoDaTrava: f, perfil: "outro", tentativas: 1 })).toContain("declarada no ar");
    expect(await verificarNoAr({ url, caminhoDaTrava: f, perfil: "inexistente", tentativas: 1 })).toContain('não tem o perfil "inexistente"');
    expect(await verificarNoAr({ url, caminhoDaTrava: f, tentativas: 1 })).toContain("declarada no ar");
  });

  it("acusa tools/list que deixou de responder sem token (ou passou a responder)", async () => {
    const f = await travar(await subir("instruções"));
    http!.close();
    const url = await subir("instruções", true);
    const erro = await verificarNoAr({ url, caminhoDaTrava: f, tentativas: 1 });
    expect(erro).toContain("tools/list (no ar false)");
  });
});

describe("diferenca (replay)", () => {
  const sup = (tools: unknown[], instructions = "i") => ({
    initialize: { instructions, capabilities: {}, serverInfo: { name: "t" } },
    tools,
    resources: [{ uri: "r://1" }],
    prompts: [],
  });

  it("acusa remoção de tool, de parâmetro e parâmetro novo obrigatório", () => {
    const antes = sup([
      { name: "a", inputSchema: { properties: { x: {}, y: {} }, required: ["x"] } },
      { name: "b", inputSchema: {} },
    ]);
    const depois = sup([{ name: "a", inputSchema: { properties: { x: {}, z: {} }, required: ["x", "z"] } }], "j");
    const d = diferenca(antes, depois);
    expect([...d.quebras].sort()).toEqual(
      ["a: parâmetro passou a obrigatório `z`", "a: parâmetro removido `y`", "tool removida: b"],
    );
    expect(d.instructions).toBe(true);
    expect(impressaoDigital(antes)).not.toBe(impressaoDigital(depois));
  });
});

describe("linhaDeCompatibilidade", () => {
  it("major em ≥ 1; minor em 0.x, onde o semver permite quebra em minor", () => {
    expect(linhaDeCompatibilidade("5.4.0")).toBe("5");
    expect(linhaDeCompatibilidade("5.0.1")).toBe(linhaDeCompatibilidade("5.9.0"));
    expect(linhaDeCompatibilidade("0.5.0")).not.toBe(linhaDeCompatibilidade("0.6.0"));
    expect(linhaDeCompatibilidade("0.6.0")).toBe(linhaDeCompatibilidade("0.6.1"));
  });
});
