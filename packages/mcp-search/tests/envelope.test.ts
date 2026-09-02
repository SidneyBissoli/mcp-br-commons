import { describe, expect, it } from "vitest";
import { deepResearchError, deepResearchResult } from "../src/envelope.js";

describe("deepResearchResult", () => {
  const objeto = { results: [{ id: "a", title: "A", url: "https://x/a" }] };

  it("serializa o objeto em UM bloco de texto e o repete em structuredContent", () => {
    const r = deepResearchResult(objeto);
    expect(r.content).toHaveLength(1);
    expect(r.content[0]).toMatchObject({ type: "text" });
    expect(JSON.parse((r.content[0] as { text: string }).text)).toEqual(objeto);
    expect(r.structuredContent).toEqual(objeto);
    expect(r.isError).toBeUndefined();
    expect("_meta" in r).toBe(false);
  });

  it("anexa extras a structuredContent e _meta sem tocar no texto", () => {
    const r = deepResearchResult(objeto, {
      structured: { provenance: { source: "IBGE" }, attribution: ["https://x"] },
      meta: { "br.com.x/provenance": { source: "IBGE" } },
    });
    expect(r.structuredContent).toEqual({
      ...objeto,
      provenance: { source: "IBGE" },
      attribution: ["https://x"],
    });
    expect(r._meta).toEqual({ "br.com.x/provenance": { source: "IBGE" } });
    expect(JSON.parse((r.content[0] as { text: string }).text)).toEqual(objeto);
  });

  it("as chaves do contrato vencem uma colisão com os extras", () => {
    const r = deepResearchResult(objeto, { structured: { results: "não" } });
    expect((r.structuredContent as { results: unknown }).results).toEqual(objeto.results);
  });
});

describe("deepResearchError", () => {
  it("é um resultado de erro com texto legível e sem structuredContent", () => {
    const r = deepResearchError("Documento não encontrado");
    expect(r.isError).toBe(true);
    expect(r.content).toEqual([{ type: "text", text: "Documento não encontrado" }]);
    expect(r.structuredContent).toBeUndefined();
  });
});
