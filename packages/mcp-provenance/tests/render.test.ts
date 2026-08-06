import { describe, expect, it } from "vitest";
import { createProvenanceContext } from "../src/context.js";
import { attributionList, renderConcise, renderDetailed } from "../src/render.js";

const ctx = createProvenanceContext({ metaNamespace: "com.exemplo.teste", timezone: "utc" });

const input = {
  source: { name: "ILOSTAT", agency: "ILO", database: "ILOSTAT", endpoint: "https://sdmx.ilo.org/rest" },
  dataset: { id: "DF_X", version: "1.0", name: "Example" },
  data_vintage: "2026-06-15",
  retrieved_at: "2026-08-04T14:32:07Z",
  source_url: "https://sdmx.ilo.org/rest/data/ILO,DF_X/all",
  license: { id: "CC-BY-4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
  citation: "ILO, ILOSTAT, accessed 2026-08-04.",
};

describe("renderConcise", () => {
  it("emite exatamente as 6 chaves do piso legal, em ordem fixa", () => {
    const block = renderConcise(ctx.build(input));
    expect(Object.keys(block)).toEqual([
      "source",
      "source_url",
      "data_vintage",
      "retrieved_at",
      "citation",
      "license",
    ]);
    expect(block.source).toBe("ILOSTAT");
    expect(block.license).toBe("CC-BY-4.0");
  });

  it("usa license.name quando não há id", () => {
    const block = renderConcise(ctx.build({ ...input, license: { name: "Uso livre com atribuição." } }));
    expect(block.license).toBe("Uso livre com atribuição.");
  });
});

describe("renderDetailed", () => {
  it("emite o bloco canônico completo em ordem fixa com nulls explícitos", () => {
    const block = renderDetailed(ctx.build({ ...input, dimension_key: null }));
    expect(Object.keys(block)).toEqual([
      "contract_version",
      "source",
      "dataset",
      "dimension_key",
      "data_vintage",
      "retrieved_at",
      "source_url",
      "api_version",
      "license",
      "citation",
      "notices",
      "derived",
      "derivation_note",
      "served_from_cache",
      "field_sources",
    ]);
    expect(block.dimension_key).toBeNull();
    expect(block.api_version).toBeNull();
    expect(block.license.verified_at).toBeNull();
    expect(Object.keys(block.license)).toEqual(["id", "name", "url", "terms_url", "verified_at"]);
  });
});

describe("determinismo byte-a-byte", () => {
  it("mesma entrada produz serialização idêntica nos dois modos", () => {
    const a = ctx.build(input);
    const b = ctx.build(input);
    expect(JSON.stringify(renderConcise(a))).toBe(JSON.stringify(renderConcise(b)));
    expect(JSON.stringify(renderDetailed(a))).toBe(JSON.stringify(renderDetailed(b)));
  });
});

describe("attributionList", () => {
  it("deduplica source_url incluindo field_sources, na ordem de primeira aparição", () => {
    const a = ctx.build({
      ...input,
      field_sources: [
        { fields: ["x"], source_url: "https://a.example/1" },
        { fields: ["y"], source_url: "https://sdmx.ilo.org/rest/data/ILO,DF_X/all" },
      ],
    });
    const b = ctx.build({ ...input, source_url: "https://b.example/2" });
    expect(attributionList([a, b])).toEqual([
      "https://sdmx.ilo.org/rest/data/ILO,DF_X/all",
      "https://a.example/1",
      "https://b.example/2",
    ]);
  });
});
