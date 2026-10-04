import { describe, expect, it } from "vitest";
import { fromJsonSchema, McpServer } from "@modelcontextprotocol/server";

import { chamarComoCliente, conectarComoCliente, controlesNegativos, quebrasDoSchema } from "../src/cliente.js";

const SAIDA = {
  type: "object",
  properties: { total: { type: "integer" }, nome: { type: ["string", "null"] } },
  required: ["total", "nome"],
} as const;

/** `devolver` decide o que a tool responde — honesto ou com o defeito do campo omitido. */
function servidor(devolver: () => Record<string, unknown>): McpServer {
  const s = new McpServer({ name: "teste", version: "1.0.0" });
  s.registerTool(
    "contar",
    {
      description: "conta",
      inputSchema: fromJsonSchema({ type: "object", properties: {} }),
      outputSchema: fromJsonSchema(SAIDA),
    },
    async () => {
      const sc = devolver();
      return { content: [{ type: "text", text: JSON.stringify(sc) }], structuredContent: sc };
    },
  );
  return s;
}

const honesto = () => servidor(() => ({ total: 2, nome: "x" }));

describe("chamarComoCliente", () => {
  it("passa o resultado que obedece ao schema listado", async () => {
    const client = await conectarComoCliente(honesto());
    try {
      const r = await chamarComoCliente(client, "contar");
      expect(r.structuredContent).toEqual({ total: 2, nome: "x" });
    } finally {
      await client.close();
    }
  });

  // O defeito que motivou o circuito: a fonte omite o campo e ele vira
  // `undefined`. Medido com server 2.2.0: o próprio servidor reprova a saída e
  // responde isError — e a chamada "que tem de dar certo" falha nomeando o campo.
  it("falha quando a fonte omite um campo obrigatório (undefined)", async () => {
    const client = await conectarComoCliente(servidor(() => ({ total: 2, nome: undefined })));
    try {
      await expect(chamarComoCliente(client, "contar")).rejects.toThrow(/nome/);
    } finally {
      await client.close();
    }
  });
});

describe("quebrasDoSchema", () => {
  it("deriva as quebras do schema, não de nomes escritos à mão", () => {
    expect(quebrasDoSchema(SAIDA).map(q => q.descricao)).toEqual([
      "structuredContent ausente",
      "campo obrigatório ausente (total)",
      "campo obrigatório ausente (nome)",
      "campo de tipo errado (total)",
    ]);
  });
});

describe("controlesNegativos", () => {
  it("todo veredito confere num servidor honesto", async () => {
    const vs = await controlesNegativos(honesto, "contar");
    for (const v of vs) expect(v.obtido, `${v.descricao}: ${v.mensagem ?? ""}`).toBe(v.esperado);
    expect(vs.at(-1)?.esperado).toBe("passa");
  });

  it("chamada-base com erro de tool não conta como reprovação", async () => {
    const s = () => {
      const m = new McpServer({ name: "teste", version: "1.0.0" });
      m.registerTool(
        "contar",
        { description: "c", inputSchema: fromJsonSchema({ type: "object", properties: {} }), outputSchema: fromJsonSchema(SAIDA) },
        async () => ({ content: [{ type: "text", text: "falhou" }], isError: true }),
      );
      return m;
    };
    const vs = await controlesNegativos(s, "contar");
    expect(vs.some(v => v.obtido === "isError")).toBe(true);
  });

  it("tool sem outputSchema é recusada: não há contrato a provar", async () => {
    const s = () => {
      const m = new McpServer({ name: "teste", version: "1.0.0" });
      m.registerTool("livre", { description: "l", inputSchema: fromJsonSchema({ type: "object", properties: {} }) }, async () => ({
        content: [{ type: "text", text: "ok" }],
      }));
      return m;
    };
    await expect(controlesNegativos(s, "livre")).rejects.toThrow(/sem outputSchema/);
  });
});
