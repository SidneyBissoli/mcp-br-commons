/**
 * Testes offline do extrator de catálogo: captura das duas formas de registro
 * (.tool clássico e .registerTool SDK v2), conversão zod → JSON-schema em modo input
 * e os índices derivados.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  CapturingServer,
  buildCatalog,
  catalogAsAnthropicTools,
  shapeToJsonSchema,
  type CatalogGroup,
} from "../src/catalog.js";

const GROUPS: CatalogGroup[] = [
  {
    area: "alfa",
    register: (s) => {
      // Forma clássica: server.tool(name, description, shape, cb) — padrão senado.
      s.tool(
        "srv_buscar",
        "Busca registros por palavra-chave no acervo de exemplo.",
        { termo: z.string(), limite: z.number().int().optional() },
        async () => ({}),
      );
      s.tool(
        "srv_obter",
        "Obtém o detalhe de um registro pelo código numérico.",
        { codigo: z.number().int(), formato: z.enum(["resumo", "completo"]).default("resumo") },
        async () => ({}),
      );
    },
  },
  {
    area: "beta",
    register: (s) => {
      // Forma SDK v2: server.registerTool(name, { description, inputSchema }, cb) —
      // padrão do template Cloudflare (inputSchema como z.object pronto).
      s.registerTool(
        "srv_listar",
        {
          title: "Listar itens",
          description: "Lista os itens do catálogo de exemplo, com filtro opcional.",
          inputSchema: z.object({ filtro: z.string().optional() }),
        },
        async () => ({}),
      );
    },
  },
];

describe("CapturingServer", () => {
  it("grava chamadas .tool e .registerTool sem invocar callbacks", () => {
    const s = new CapturingServer();
    let invoked = false;
    s.tool("a", "descrição a", {}, () => {
      invoked = true;
    });
    s.registerTool("b", { description: "descrição b", inputSchema: z.object({}) }, () => {
      invoked = true;
    });
    expect(s.captured.map((c) => c.name)).toEqual(["a", "b"]);
    expect(invoked).toBe(false);
  });
});

describe("shapeToJsonSchema", () => {
  it("deriva required de shape cru: nem optional nem default", () => {
    const schema = shapeToJsonSchema({
      obrigatorio: z.string(),
      opcional: z.string().optional(),
      comDefault: z.number().default(10),
    });
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["obrigatorio"]);
    expect(Object.keys(schema.properties).sort()).toEqual(["comDefault", "obrigatorio", "opcional"]);
    expect(schema.additionalProperties).toBe(false);
  });

  it("aceita um z.object pronto (forma registerTool do SDK v2)", () => {
    const schema = shapeToJsonSchema(z.object({ id: z.number().int() }));
    expect(schema.required).toEqual(["id"]);
  });

  it("trata shape ausente como objeto vazio", () => {
    const schema = shapeToJsonSchema(undefined);
    expect(schema.properties).toEqual({});
    expect(schema.required).toEqual([]);
  });
});

describe("buildCatalog", () => {
  it("coleta todas as tools de todos os grupos, com área herdada do grupo", () => {
    const catalog = buildCatalog(GROUPS);
    expect(catalog.tools.map((t) => t.name)).toEqual(["srv_buscar", "srv_obter", "srv_listar"]);
    expect(catalog.areaByName.get("srv_buscar")).toBe("alfa");
    expect(catalog.areaByName.get("srv_listar")).toBe("beta");
    expect(catalog.toolNames.has("srv_obter")).toBe(true);
    expect(catalog.toolNames.has("inexistente")).toBe(false);
  });

  it("converte shapes em JSON-schema com required correto (default não é required)", () => {
    const catalog = buildCatalog(GROUPS);
    const obter = catalog.tools.find((t) => t.name === "srv_obter");
    expect(obter).toBeDefined();
    expect(obter!.inputSchema.required).toEqual(["codigo"]);
    const listar = catalog.tools.find((t) => t.name === "srv_listar");
    expect(listar!.inputSchema.required).toEqual([]);
  });

  it("preserva as descrições das duas formas de registro", () => {
    const catalog = buildCatalog(GROUPS);
    for (const t of catalog.tools) {
      expect(t.description.length).toBeGreaterThan(20);
    }
  });
});

describe("catalogAsAnthropicTools", () => {
  it("monta o array tools da Messages API (name/description/input_schema)", () => {
    const tools = catalogAsAnthropicTools(buildCatalog(GROUPS));
    expect(tools).toHaveLength(3);
    const first = tools[0]!;
    expect(first.name).toBe("srv_buscar");
    expect(first.input_schema.type).toBe("object");
    expect(first.input_schema.required).toEqual(["termo"]);
  });
});
