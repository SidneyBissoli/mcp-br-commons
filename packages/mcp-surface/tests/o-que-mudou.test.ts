/**
 * A trava vermelha nomeia o que mudou. Ideia de Chris Sellers (dev.to,
 * comentário 3gnh0): "per-tool hashes ... so a red test names the tool that
 * drifted". A diferença sai do conteúdo que a trava já guarda; nenhum sha muda.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { conferirSecao, impressaoDigital, oQueMudou, resumoDoQueMudou } from "../src/index.js";

const tool = (name: string, description: string, props: Record<string, unknown> = {}) => ({
  name,
  description,
  inputSchema: { type: "object", properties: props },
});

const antes = {
  initialize: { instructions: "use a", capabilities: { tools: {} } },
  tools: [tool("a", "faz a", { x: { type: "string" } }), tool("b", "faz b"), tool("c", "faz c")],
  resources: [{ uri: "r://1", name: "um" }],
  prompts: null,
};

describe("oQueMudou", () => {
  it("nomeia a tool e o campo, a tool nova e a removida, e as instructions", () => {
    const depois = {
      ...antes,
      initialize: { ...antes.initialize, instructions: "use a e d" },
      tools: [tool("a", "faz a, agora melhor", { x: { type: "string" }, y: { type: "number" } }), tool("c", "faz c"), tool("d", "faz d")],
    };
    expect(oQueMudou(antes, depois)).toEqual([
      "initialize.instructions: mudou",
      "tools[a].description: mudou",
      "tools[a].inputSchema.properties.y: nova",
      "tools[b]: removida",
      "tools[d]: nova",
    ]);
  });

  it("superfície por perfil (senado): o perfil entra no caminho", () => {
    const depois = { full: { ...antes, tools: [tool("a", "faz a", { x: { type: "string" } }), tool("b", "outra coisa"), tool("c", "faz c")] }, app: antes };
    expect(oQueMudou({ full: antes, app: antes }, depois)).toEqual(["full.tools[b].description: mudou"]);
  });

  it("seção sem tools (semToken): o caminho é a configuração, a rota e o método", () => {
    const t = { apiKeyAusente: { "POST /mcp": { "tools/list": true, ping: true } } };
    const m = { apiKeyAusente: { "POST /mcp": { "tools/list": false, ping: true } } };
    expect(oQueMudou(t, m)).toEqual(["apiKeyAusente.POST /mcp.tools/list: mudou"]);
  });

  it("mesmo sha, nada a dizer; resumo corta no limite e conta o resto", () => {
    expect(impressaoDigital(antes)).toBe(impressaoDigital(structuredClone(antes)));
    expect(oQueMudou(antes, structuredClone(antes))).toEqual([]);
    expect(resumoDoQueMudou(antes, antes)).toBe("");
    const muitas = { ...antes, tools: Array.from({ length: 15 }, (_, i) => tool(`t${String(i).padStart(2, "0")}`, "x")) };
    expect(resumoDoQueMudou(antes, muitas, 3)).toMatch(/^ O que mudou: .+; .+; .+ \(e mais \d+\)\.$/);
  });
});

describe("a mensagem da trava vermelha diz o que mudou", () => {
  const f = () => join(mkdtempSync(join(tmpdir(), "o-que-mudou-")), "surface.lock.json");

  it("superfície mudada sob a mesma versão: nomeia a tool", () => {
    const lock = f();
    conferirSecao(lock, "declarada", antes, "1.0.0", true);
    const depois = { ...antes, tools: [tool("a", "faz a", { x: { type: "string" } }), tool("b", "faz b, de outro jeito"), tool("c", "faz c")] };
    const v = conferirSecao(lock, "declarada", depois, "1.0.0", false);
    expect(v.ok).toBe(false);
    expect(v.mensagem).toContain("O que mudou: tools[b].description: mudou.");
  });

  it("superfície mudada junto com a versão, antes de regravar: nomeia também", () => {
    const lock = f();
    conferirSecao(lock, "declarada", antes, "1.0.0", true);
    const depois = { ...antes, tools: [...antes.tools, tool("d", "faz d")] };
    expect(conferirSecao(lock, "declarada", depois, "1.1.0", false).mensagem).toContain("tools[d]: nova");
  });
});
