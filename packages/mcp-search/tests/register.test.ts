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

  it("extras devolvidos pela chamada vão a structuredContent e _meta sem tocar no texto do contrato", async () => {
    const meta = { "br.com.x/provenance": { source: "IBGE" } };
    const client = await conectar(
      opcoes({
        extendOutputSchema: (schema) => schema.extend({ provenance: z.object({ source: z.string() }) }),
        search: async (query) => ({
          results: indice.search(query),
          extras: { structured: { provenance: { source: "IBGE/indice" } }, meta },
        }),
        fetch: async (id) => ({
          document: { id, title: "T", text: "x", url: "https://x/t" },
          extras: { structured: { provenance: { source: `IBGE/${id}` } }, meta },
        }),
      })
    );
    const busca = await client.callTool({ name: "search", arguments: { query: "paulo" } });
    expect(busca.isError).toBeFalsy();
    const objeto = JSON.parse(texto(busca)) as Record<string, unknown>;
    expect(Object.keys(objeto)).toEqual(["results"]);
    expect(busca.structuredContent).toEqual({ ...objeto, provenance: { source: "IBGE/indice" } });
    expect(busca._meta).toEqual(meta);

    const doc = await client.callTool({ name: "fetch", arguments: { id: "sidra:6579" } });
    expect(doc.isError).toBeFalsy();
    const documento = JSON.parse(texto(doc)) as Record<string, unknown>;
    expect(Object.keys(documento).sort()).toEqual(["id", "text", "title", "url"]);
    expect(doc.structuredContent).toEqual({ ...documento, provenance: { source: "IBGE/sidra:6579" } });
    expect(doc._meta).toEqual(meta);

    const { tools } = await client.listTools();
    for (const nome of ["search", "fetch"]) {
      const tool = tools.find((t) => t.name === nome);
      expect(Object.keys(tool?.outputSchema?.properties ?? {})).toContain("provenance");
    }
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

  it("record recebe tool_call em toda chamada e tool_error nos erros, com a FORMA", async () => {
    const record = vi.fn();
    const client = await conectar(opcoes({ record }));
    await client.callTool({ name: "search", arguments: { query: "paulo" } });
    await client.callTool({ name: "fetch", arguments: { id: "nada" } });
    expect(record.mock.calls).toEqual([
      ["tool_call", "search", { params: "query", classe: "" }],
      ["tool_call", "fetch", { params: "id", classe: "" }],
      ["tool_error", "fetch", { params: "id", classe: "" }],
    ]);
    await client.close();
  });

  it("com classifyError, o erro chega classificado", async () => {
    const record = vi.fn();
    // O vocabulário é de cada servidor; o pacote só entrega a mensagem.
    const classifyError = (m: string) => (/not found|não encontrad/i.test(m) ? "nao_encontrado" : "outro");
    const client = await conectar(opcoes({ record, classifyError }));
    await client.callTool({ name: "fetch", arguments: { id: "nada" } });
    expect(record.mock.calls).toEqual([
      ["tool_call", "fetch", { params: "id", classe: "" }],
      ["tool_error", "fetch", { params: "id", classe: "nao_encontrado" }],
    ]);
    await client.close();
  });

  it("a forma NUNCA carrega valor de parâmetro", async () => {
    // A linha que este pacote não pode cruzar: `query` é texto livre, e o que a
    // pessoa digitou não entra na telemetria. Só o NOME do parâmetro entra.
    const record = vi.fn();
    const client = await conectar(opcoes({ record }));
    await client.callTool({ name: "search", arguments: { query: "nome-de-uma-pessoa" } });
    const forma = JSON.stringify(record.mock.calls);
    expect(forma).not.toContain("nome-de-uma-pessoa");
    expect(forma).toContain("query");
    await client.close();
  });

  it("sem record, nada quebra (o gancho é opcional)", async () => {
    const client = await conectar(opcoes());
    const r = await client.callTool({ name: "fetch", arguments: { id: "nada" } });
    expect(r.isError).toBe(true);
    await client.close();
  });
});

describe("registerDeepResearchTools — locale", () => {
  it("pt-BR é o padrão: títulos, describe() e mensagens em português", async () => {
    const client = await conectar(opcoes());
    const { tools } = await client.listTools();
    const search = tools.find((t) => t.name === "search")!;
    expect(search.title).toBe("Busca para Deep Research");
    const query = (search.inputSchema.properties as Record<string, { description?: string }>).query;
    expect(query?.description).toContain("Termos de busca");
    const r = await client.callTool({ name: "fetch", arguments: { id: "nada" } });
    expect(texto(r)).toContain("Documento não encontrado");
    await client.close();
  });

  it('locale "en" troca títulos, describe() dos quatro schemas e mensagens padrão; a description do modelo não muda', async () => {
    const client = await conectar(
      opcoes({
        locale: "en",
        search: async () => {
          throw new Error("boom");
        },
      })
    );
    const { tools } = await client.listTools();
    const search = tools.find((t) => t.name === "search")!;
    const fetch = tools.find((t) => t.name === "fetch")!;
    expect(search.title).toBe("Deep Research Search");
    expect(fetch.title).toBe("Deep Research Document");
    // description (o que o modelo lê) é em inglês nos dois idiomas — igual.
    expect(search.description).toContain("OpenAI Deep Research contract");

    interface Prop {
      description?: string;
      items?: { properties?: Record<string, Prop> };
    }
    const prop = (s: unknown, nome: string): Prop =>
      (s as { properties: Record<string, Prop> }).properties[nome] ?? {};
    expect(prop(search.inputSchema, "query").description).toBe(
      "Search terms, natural language or keywords (accents and case are ignored)"
    );
    expect(prop(fetch.inputSchema, "id").description).toBe(
      "Identifier of a document returned by `search`"
    );
    expect(prop(search.outputSchema, "results").items?.properties?.url?.description).toContain(
      "ChatGPT's citation"
    );
    expect(prop(fetch.outputSchema, "text").description).toBe(
      "Full readable content of the document (Markdown)"
    );
    // Nenhum describe() em português sobrou na superfície.
    const superficie = JSON.stringify([search, fetch]);
    expect(superficie).not.toMatch(/documento|busca/i);

    const naoAchou = await client.callTool({ name: "fetch", arguments: { id: "nada" } });
    expect(naoAchou.isError).toBe(true);
    expect(texto(naoAchou)).toBe('Document not found: "nada". Use an id returned by `search`.');
    const falhou = await client.callTool({ name: "search", arguments: { query: "x" } });
    expect(falhou.isError).toBe(true);
    expect(texto(falhou)).toBe("`search` failed: boom");
    await client.close();
  });

  it("títulos explícitos vencem o padrão do idioma", async () => {
    const client = await conectar(opcoes({ locale: "en", titles: { search: "Catalog Search" } }));
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === "search")!.title).toBe("Catalog Search");
    expect(tools.find((t) => t.name === "fetch")!.title).toBe("Deep Research Document");
    await client.close();
  });
});
