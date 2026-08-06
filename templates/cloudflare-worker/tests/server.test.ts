import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/server";
import type { ConciseBlock } from "@sbissoli/mcp-provenance";
import {
  buildServer,
  CATALOGO_EXEMPLO,
  EXEMPLO_TOOL_NAME,
  exemploBuscarCatalogo,
  filtrarCatalogo,
  provenance,
  withUsage,
} from "../src/server.js";
import type { UsageKind } from "../src/usage-core.js";

describe("filtrarCatalogo", () => {
  it("sem busca → catálogo inteiro", () => {
    expect(filtrarCatalogo()).toHaveLength(CATALOGO_EXEMPLO.length);
  });

  it("busca por trecho do nome, case-insensitive", () => {
    const itens = filtrarCatalogo("ALFA");
    expect(itens).toHaveLength(1);
    expect(itens[0]?.id).toBe("alfa");
  });

  it("sem correspondência → lista vazia", () => {
    expect(filtrarCatalogo("nao-existe")).toHaveLength(0);
  });
});

describe("exemploBuscarCatalogo", () => {
  it("retorna os três canais do envelope de proveniência", async () => {
    const r = await exemploBuscarCatalogo({ busca: "beta" });
    expect(r.structuredContent.total).toBe(1);
    expect(r.structuredContent.itens[0]?.id).toBe("beta");
    // Canal 1: bloco parseável + attribution com a URL canônica da fonte
    expect(r.structuredContent.attribution).toEqual(["https://exemplo.invalid/catalogo"]);
    // Modo concise (default do contrato v1.0): exatamente 6 chaves em ordem fixa
    expect(Object.keys(r.structuredContent.provenance as ConciseBlock)).toEqual([
      "source",
      "source_url",
      "data_vintage",
      "retrieved_at",
      "citation",
      "license",
    ]);
    // Canal 2: _meta sob chaves namespaced
    expect(r._meta[provenance.metaKeys.provenance]).toBeDefined();
    // Canal 3: rodapé humano anexado ao content textual
    expect(r.content).toHaveLength(2);
    expect(r.content[1]?.text).toContain("Fonte de Exemplo");
  });
});

describe("withUsage", () => {
  function recorder() {
    const events: Array<{ kind: UsageKind; name?: string | undefined }> = [];
    return { events, record: (kind: UsageKind, name?: string) => events.push({ kind, name }) };
  }

  it("registra tool_call em sucesso", async () => {
    const { events, record } = recorder();
    const wrapped = withUsage("t", record, async (_: unknown) => ({ ok: true }));
    await wrapped(undefined);
    expect(events).toEqual([{ kind: "tool_call", name: "t" }]);
  });

  it("registra tool_error quando o resultado tem isError", async () => {
    const { events, record } = recorder();
    const wrapped = withUsage("t", record, async (_: unknown) => ({ isError: true }));
    await wrapped(undefined);
    expect(events.map((e) => e.kind)).toEqual(["tool_call", "tool_error"]);
  });

  it("registra tool_error e relança quando o handler lança", async () => {
    const { events, record } = recorder();
    const wrapped = withUsage("t", record, async (_: unknown): Promise<{ isError?: boolean }> => {
      throw new Error("boom");
    });
    await expect(wrapped(undefined)).rejects.toThrow("boom");
    expect(events.map((e) => e.kind)).toEqual(["tool_call", "tool_error"]);
  });
});

describe("buildServer", () => {
  it("constrói um McpServer com a tool de exemplo registrada", () => {
    const server = buildServer();
    expect(server).toBeInstanceOf(McpServer);
  });

  it("nome da tool respeita o teto de 64 chars do diretório", () => {
    expect(EXEMPLO_TOOL_NAME.length).toBeLessThanOrEqual(64);
  });
});
