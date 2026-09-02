import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { DEEP_RESEARCH_TOOLS, type FetchDocument, type SearchResult } from "../src/contract.js";
import { createIndex } from "../src/rank.js";
import { registerDeepResearchTools, type DeepResearchToolsOptions } from "../src/register.js";

/**
 * Exercita a fábrica contra um McpServer REAL, por transporte in-memory e o
 * cliente do SDK — é a visão exata do ChatGPT: tools/list e tools/call.
 */

const acervo = [
  { id: "sidra:6579", title: "Tabela 6579 — População residente", url: "https://sidra.ibge.gov.br/tabela/6579" },
  { id: "mun:3550308", title: "São Paulo (SP)", url: "https://cidades.ibge.gov.br/brasil/sp/sao-paulo/panorama" },
];
const indice = createIndex(acervo);

const ANOTACOES = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

function opcoes(extra: Partial<DeepResearchToolsOptions> = {}): DeepResearchToolsOptions {
  return {
    search: async (query) => indice.search(query),
    fetch: async (id): Promise<FetchDocument | null> => {
      const entrada = acervo.find((e) => e.id === id);
      return entrada ? { ...entrada, text: `# ${entrada.title}\n\nConteúdo.`, metadata: { tipo: "x" } } : null;
    },
    corpus: "IBGE official statistics",
    richTools: "the `ibge_*` tools",
    annotations: ANOTACOES,
    ...extra,
  };
}

async function conectar(opts: DeepResearchToolsOptions) {
  const server = new McpServer({ name: "teste", version: "0.0.0" });
  registerDeepResearchTools(server, opts);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "cliente", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function texto(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  expect(content).toHaveLength(1);
  return content[0]?.text ?? "";
}

describe("registerDeepResearchTools — superfície", () => {
  let client: Client;
  beforeEach(async () => {
    client = await conectar(opcoes());
  });
  afterEach(async () => {
    await client.close();
  });

  it("registra exatamente `search` e `fetch`, com título pt-BR, annotations e outputSchema", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...DEEP_RESEARCH_TOOLS].sort());
    for (const tool of tools) {
      expect(tool.title).toBeTruthy();
      expect(tool.title).not.toBe(tool.name);
      expect(tool.annotations).toEqual(ANOTACOES);
      expect(tool.outputSchema).toBeDefined();
      expect(tool.description?.length ?? 0).toBeGreaterThan(40);
      expect(tool.description).toContain("Deep Research");
      expect(tool.description).toContain("`ibge_*`");
    }
  });

  it("publica o inputSchema do contrato: search(query) e fetch(id)", async () => {
    const { tools } = await client.listTools();
    const porNome = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(Object.keys(porNome.search?.inputSchema.properties ?? {})).toEqual(["query"]);
    expect(Object.keys(porNome.fetch?.inputSchema.properties ?? {})).toEqual(["id"]);
  });
});

describe("registerDeepResearchTools — chamadas", () => {
  it("search devolve o JSON do contrato em content[0].text e o objeto em structuredContent", async () => {
    const client = await conectar(opcoes());
    const r = await client.callTool({ name: "search", arguments: { query: "população" } });
    expect(r.isError).toBeFalsy();
    const objeto = JSON.parse(texto(r)) as { results: SearchResult[] };
    expect(objeto).toEqual({
      results: [{ id: "sidra:6579", title: "Tabela 6579 — População residente", url: "https://sidra.ibge.gov.br/tabela/6579" }],
    });
    expect(r.structuredContent).toEqual(objeto);
    await client.close();
  });

  it("search sem casamento devolve results vazio, não erro", async () => {
    const client = await conectar(opcoes());
    const r = await client.callTool({ name: "search", arguments: { query: "xyzzy" } });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(texto(r))).toEqual({ results: [] });
    await client.close();
  });

  it("search corta no limite configurado", async () => {
    const client = await conectar(opcoes({ limit: 1, search: async () => acervo }));
    const r = await client.callTool({ name: "search", arguments: { query: "qualquer" } });
    expect((r.structuredContent as { results: unknown[] }).results).toHaveLength(1);
    await client.close();
  });

  it("fetch devolve o documento inteiro do contrato", async () => {
    const client = await conectar(opcoes());
    const r = await client.callTool({ name: "fetch", arguments: { id: "mun:3550308" } });
    expect(r.isError).toBeFalsy();
    const doc = JSON.parse(texto(r)) as FetchDocument;
    expect(doc).toEqual({
      id: "mun:3550308",
      title: "São Paulo (SP)",
      text: "# São Paulo (SP)\n\nConteúdo.",
      url: "https://cidades.ibge.gov.br/brasil/sp/sao-paulo/panorama",
      metadata: { tipo: "x" },
    });
    expect(r.structuredContent).toEqual(doc);
    await client.close();
  });

  it("fetch de id desconhecido é erro legível, com a mensagem do servidor", async () => {
    const client = await conectar(opcoes({ notFound: (id) => `Não achei ${id}` }));
    const r = await client.callTool({ name: "fetch", arguments: { id: "nada" } });
    expect(r.isError).toBe(true);
    expect(texto(r)).toBe("Não achei nada");
    expect(r.structuredContent).toBeUndefined();
    await client.close();
  });

  it("decorate anexa proveniência a structuredContent e _meta sem tocar no texto do contrato", async () => {
    const client = await conectar(
      opcoes({
        extendOutputSchema: (schema) => schema.extend({ provenance: z.object({ source: z.string() }) }),
        decorate: (tool, objeto) => ({
          structured: { provenance: { source: `IBGE/${tool}/${Object.keys(objeto).join(",")}` } },
          meta: { "br.com.x/provenance": { source: "IBGE" } },
        }),
      })
    );
    const r = await client.callTool({ name: "search", arguments: { query: "paulo" } });
    expect(r.isError).toBeFalsy();
    const objeto = JSON.parse(texto(r)) as Record<string, unknown>;
    expect(Object.keys(objeto)).toEqual(["results"]);
    expect(r.structuredContent).toEqual({ ...objeto, provenance: { source: "IBGE/search/results" } });
    expect(r._meta).toEqual({ "br.com.x/provenance": { source: "IBGE" } });

    const { tools } = await client.listTools();
    const search = tools.find((t) => t.name === "search");
    expect(Object.keys(search?.outputSchema?.properties ?? {})).toEqual(["results", "provenance"]);
    await client.close();
  });

  it("erro lançado por search/fetch vira resultado de erro, nunca sobe cru", async () => {
    const client = await conectar(
      opcoes({
        search: async () => {
          throw new Error("upstream fora do ar");
        },
      })
    );
    const r = await client.callTool({ name: "search", arguments: { query: "x" } });
    expect(r.isError).toBe(true);
    expect(texto(r)).toBe("Falha em `search`: upstream fora do ar");
    await client.close();
  });

  it("record recebe tool_call em toda chamada e tool_error nos erros", async () => {
    const record = vi.fn();
    const client = await conectar(opcoes({ record }));
    await client.callTool({ name: "search", arguments: { query: "paulo" } });
    await client.callTool({ name: "fetch", arguments: { id: "nada" } });
    expect(record.mock.calls).toEqual([
      ["tool_call", "search"],
      ["tool_call", "fetch"],
      ["tool_error", "fetch"],
    ]);
    await client.close();
  });
});
