import { describe, expect, it } from "vitest";
import { createProvenanceContext } from "../src/context.js";
import {
  CONCISE_BLOCK_JSON_SCHEMA,
  ConciseBlockSchema,
  DETAILED_BLOCK_JSON_SCHEMA,
  DetailedBlockSchema,
  RETRIEVAL_OBJECT_JSON_SCHEMA,
  provenanceBlockJsonSchema,
} from "../src/json-schema.js";
import { renderConcise, renderDetailed } from "../src/render.js";
import { CONTRACT_VERSION, CONTRACT_VERSIONS, RetrievalAnomalyKindSchema } from "../src/schema.js";

const ctx = createProvenanceContext({ metaNamespace: "com.exemplo.teste", timezone: "utc" });

const semRetrieval = ctx.build({
  source: { name: "ILOSTAT", agency: "ILO", database: "ILOSTAT", endpoint: "https://sdmx.ilo.org/rest" },
  dataset: { id: "DF_X", version: "1.0", name: "Example" },
  dimension_key: { REF_AREA: "BRA" },
  data_vintage: "2026-06-15",
  retrieved_at: "2026-08-04T14:32:07Z",
  source_url: "https://sdmx.ilo.org/rest/data/ILO,DF_X/all",
  license: { id: "CC-BY-4.0" },
  citation: "ILO, ILOSTAT.",
  field_sources: [{ fields: ["x"], source_url: "https://a.example/1" }],
});

const semRetrievalV12 = createProvenanceContext({
  metaNamespace: "com.exemplo.teste",
  timezone: "utc",
  contractVersion: "1.2",
}).build({
  source: "ILOSTAT",
  source_url: "https://sdmx.ilo.org/rest/data/ILO,DF_X/all",
  license: { id: "CC-BY-4.0" },
  citation: "ILO, ILOSTAT.",
  retrieved_at: "2026-08-04T14:32:07Z",
  field_sources: [{ fields: ["x"], source_url: "https://a.example/1" }],
});

const comRetrieval = ctx.build({
  source: "Banco Central do Brasil — SGS",
  source_url: "https://api.bcb.gov.br/x",
  citation: "Fonte: BCB.",
  license: "Uso livre com atribuição.",
  retrieved_at: "2026-09-26T12:00:00Z",
  retrieval: { requests: 2, attempts: 4, anomalies: [{ kind: "http_5xx", count: 2 }] },
});

describe("JSON Schema das projeções (para o outputSchema das tools)", () => {
  it("concise: required = as 7 chaves da 1.1; properties = as 8 que a 1.2 emite com fusão, na mesma ordem; objeto fechado", () => {
    expect(CONCISE_BLOCK_JSON_SCHEMA.required).toEqual(Object.keys(renderConcise(semRetrieval)));
    expect(Object.keys(CONCISE_BLOCK_JSON_SCHEMA.properties)).toEqual(Object.keys(renderConcise(semRetrievalV12)));
    expect(CONCISE_BLOCK_JSON_SCHEMA.additionalProperties).toBe(false);
  });

  it("detailed: idem para renderDetailed; contract_version aceita exatamente as versões que a lib emite", () => {
    const chaves = Object.keys(renderDetailed(semRetrieval));
    expect(Object.keys(DETAILED_BLOCK_JSON_SCHEMA.properties)).toEqual(chaves);
    expect(DETAILED_BLOCK_JSON_SCHEMA.required).toEqual(chaves);
    expect(DETAILED_BLOCK_JSON_SCHEMA.properties.contract_version.enum).toEqual([...CONTRACT_VERSIONS]);
    expect(CONTRACT_VERSIONS).toContain(CONTRACT_VERSION);
  });

  it("retrieval: chaves e vocabulário de kind batem com o modelo", () => {
    const r = renderConcise(comRetrieval).retrieval!;
    expect(Object.keys(RETRIEVAL_OBJECT_JSON_SCHEMA.properties)).toEqual(Object.keys(r));
    expect(RETRIEVAL_OBJECT_JSON_SCHEMA.required).toEqual(Object.keys(r));
    expect(RETRIEVAL_OBJECT_JSON_SCHEMA.properties.anomalies.items.properties.kind.enum).toEqual([
      ...RetrievalAnomalyKindSchema.options,
    ]);
  });

  it("provenanceBlockJsonSchema(mode) devolve o schema do modo", () => {
    expect(provenanceBlockJsonSchema("concise")).toBe(CONCISE_BLOCK_JSON_SCHEMA);
    expect(provenanceBlockJsonSchema("detailed")).toBe(DETAILED_BLOCK_JSON_SCHEMA);
  });

  it("o JSON Schema serializa determinístico e sem funções (é servido verbatim no outputSchema)", () => {
    const a = JSON.stringify(CONCISE_BLOCK_JSON_SCHEMA);
    expect(a).toBe(JSON.stringify(JSON.parse(a)));
    expect(a).not.toMatch(/undefined/);
  });
});

describe("schemas zod das projeções (estritos) validam o que a lib emite", () => {
  it("concise, com e sem retrieval", () => {
    expect(ConciseBlockSchema.parse(renderConcise(semRetrieval))).toEqual(renderConcise(semRetrieval));
    expect(ConciseBlockSchema.parse(renderConcise(comRetrieval))).toEqual(renderConcise(comRetrieval));
  });

  it("detailed, com e sem retrieval/field_sources", () => {
    expect(DetailedBlockSchema.parse(renderDetailed(semRetrieval))).toEqual(renderDetailed(semRetrieval));
    expect(DetailedBlockSchema.parse(renderDetailed(comRetrieval))).toEqual(renderDetailed(comRetrieval));
  });

  it("chave a mais é RECUSADA (é o mesmo comportamento do SDK contra additionalProperties: false)", () => {
    expect(() => ConciseBlockSchema.parse({ ...renderConcise(semRetrieval), extra: 1 })).toThrow();
    expect(() =>
      ConciseBlockSchema.parse({
        ...renderConcise(comRetrieval),
        retrieval: { ...renderConcise(comRetrieval).retrieval, latency_ms: 10 },
      }),
    ).toThrow();
  });

  it("as chaves do zod são as mesmas do JSON Schema (as duas fontes não podem divergir)", () => {
    expect(Object.keys(ConciseBlockSchema.shape)).toEqual(Object.keys(CONCISE_BLOCK_JSON_SCHEMA.properties));
    expect(Object.keys(DetailedBlockSchema.shape)).toEqual(Object.keys(DETAILED_BLOCK_JSON_SCHEMA.properties));
  });
});
