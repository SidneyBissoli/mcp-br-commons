import { describe, expect, it } from "vitest";
import { fromJsonSchema, McpServer } from "@modelcontextprotocol/server";

import { capturarSuperficie, impressaoDigital, normalizarSuperficie } from "../src/index.js";

function servidor(versao: string, extra?: (s: McpServer) => void): McpServer {
  const s = new McpServer({ name: "teste", version: versao, title: "Teste" }, { instructions: "Use as tools com cuidado." });
  s.registerTool(
    "b_tool",
    { description: "segunda", inputSchema: fromJsonSchema({ type: "object", properties: { x: { type: "string" } }, required: ["x"] }) },
    async () => ({ content: [{ type: "text", text: "ok" }] }),
  );
  s.registerTool(
    "a_tool",
    { description: "primeira", inputSchema: fromJsonSchema({ type: "object", properties: {} }) },
    async () => ({ content: [{ type: "text", text: "ok" }] }),
  );
  s.registerResource("guia", "teste://guia", { description: "guia", mimeType: "text/plain" }, async () => ({
    contents: [{ uri: "teste://guia", text: "x" }],
  }));
  extra?.(s);
  return s;
}

describe("normalizarSuperficie", () => {
  it("tira a versão do servidor e mantém o resto da identidade", () => {
    const n = normalizarSuperficie({
      initialize: { serverInfo: { name: "x", version: "1.2.3", title: "X" }, instructions: "i", capabilities: {} },
      tools: [],
      resources: undefined,
      resourceTemplates: undefined,
      prompts: undefined,
    }) as { initialize: { serverInfo: Record<string, unknown> } };
    expect(n.initialize.serverInfo).toEqual({ name: "x", title: "X" });
  });

  it("'não serve' (null) e 'serve nada' ([]) são superfícies diferentes", () => {
    const base = { initialize: {}, tools: [], resources: undefined, resourceTemplates: undefined, prompts: undefined };
    expect(impressaoDigital(normalizarSuperficie(base))).not.toBe(
      impressaoDigital(normalizarSuperficie({ ...base, resources: [] })),
    );
  });

  it("a ordem de chaves e de itens da lista não muda o hash; a ordem de um `required` muda", () => {
    const t1 = { name: "a", inputSchema: { type: "object", required: ["x", "y"] } };
    const t2 = { inputSchema: { required: ["x", "y"], type: "object" }, name: "a" };
    const outra = { name: "b" };
    const sup = (tools: unknown[]) =>
      impressaoDigital(normalizarSuperficie({ initialize: {}, tools, resources: [], resourceTemplates: [], prompts: [] }));
    expect(sup([t1, outra])).toBe(sup([outra, t2]));
    expect(sup([t1])).not.toBe(sup([{ name: "a", inputSchema: { type: "object", required: ["y", "x"] } }]));
  });
});

describe("capturarSuperficie (em memória)", () => {
  it("lê o que nenhum teste lia: instructions e capabilities, mais as listas ordenadas", async () => {
    const sup = (await capturarSuperficie(servidor("1.0.0"))) as {
      initialize: { instructions: string; capabilities: Record<string, unknown>; serverInfo: Record<string, unknown> };
      tools: Array<{ name: string }>;
      resources: Array<{ uri: string }>;
      prompts: unknown;
    };
    expect(sup.initialize.instructions).toBe("Use as tools com cuidado.");
    expect(Object.keys(sup.initialize.capabilities)).toEqual(expect.arrayContaining(["tools", "resources"]));
    expect(sup.initialize.serverInfo).not.toHaveProperty("version");
    expect(sup.tools.map(t => t.name)).toEqual(["a_tool", "b_tool"]);
    expect(sup.resources.map(r => r.uri)).toEqual(["teste://guia"]);
  });

  it("a versão do servidor NÃO entra na impressão digital", async () => {
    expect(impressaoDigital(await capturarSuperficie(servidor("1.0.0")))).toBe(
      impressaoDigital(await capturarSuperficie(servidor("9.9.9"))),
    );
  });

  it("uma tool a mais muda a impressão digital", async () => {
    const com = await capturarSuperficie(
      servidor("1.0.0", s =>
        s.registerTool("c_escreve", { description: "escreve pelo usuário", inputSchema: fromJsonSchema({ type: "object" }) }, async () => ({
          content: [],
        })),
      ),
    );
    expect(impressaoDigital(com)).not.toBe(impressaoDigital(await capturarSuperficie(servidor("1.0.0"))));
  });
});
