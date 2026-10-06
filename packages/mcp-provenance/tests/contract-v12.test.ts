import { describe, expect, it } from "vitest";
import { createProvenanceContext, type ProvenanceContextOptions } from "../src/context.js";
import {
  CONCISE_BLOCK_JSON_SCHEMA,
  ConciseBlockSchema,
  DetailedBlockSchema,
  FIELD_SOURCE_JSON_SCHEMA,
} from "../src/json-schema.js";
import { renderConcise, renderDetailed } from "../src/render.js";
import { CONTRACT_VERSION, LATEST_CONTRACT_VERSION, ProvenanceContractError, type ProvenanceInput } from "../src/schema.js";

const base: ProvenanceContextOptions = { metaNamespace: "com.exemplo.teste", timezone: "utc" };
const v11 = createProvenanceContext(base);
const v12 = createProvenanceContext({ ...base, contractVersion: "1.2" });

const mista: ProvenanceInput = {
  source: { name: "ILOSTAT", agency: "ILO", database: "ILOSTAT", endpoint: "https://sdmx.ilo.org/rest" },
  dataset: { id: "DF_X", version: "1.0", name: "Example" },
  dimension_key: { REF_AREA: "BRA" },
  data_vintage: "2026-06-15",
  retrieved_at: "2026-08-04T14:32:07Z",
  source_url: "https://sdmx.ilo.org/rest/data/ILO,DF_X/all",
  license: { id: "CC-BY-4.0" },
  citation: "ILO, ILOSTAT.",
  served_from_cache: true,
  retrieval: { requests: 2, attempts: 3, anomalies: [{ kind: "timeout", count: 1 }] },
  field_sources: [
    { fields: ["a"], source_url: "https://a.example/1", retrieved_at: "2026-08-04T14:32:07Z" },
    { fields: ["b", "c"], source_url: "https://a.example/2", dataset_id: "D2", data_vintage: "2026" },
  ],
};

const simples: ProvenanceInput = { ...mista, field_sources: null };

// Saída da lib 0.2.0 PUBLICADA para `mista`, capturada em 2026-10-06 rodando o pacote do npm
// (node_modules de um servidor). É o fio que os clientes conhecem hoje.
const CONCISE_020 =
  '{"source":"ILOSTAT","source_url":"https://sdmx.ilo.org/rest/data/ILO,DF_X/all","data_vintage":"2026-06-15",' +
  '"retrieved_at":"2026-08-04T14:32:07Z","retrieval":{"requests":2,"attempts":3,"anomalies":[{"kind":"timeout","count":1}],' +
  '"unstable":true},"citation":"ILO, ILOSTAT.","license":"CC-BY-4.0"}';
const DETAILED_020 =
  '{"contract_version":"1.1","source":{"name":"ILOSTAT","agency":"ILO","database":"ILOSTAT","endpoint":"https://sdmx.ilo.org/rest"},' +
  '"dataset":{"id":"DF_X","version":"1.0","name":"Example"},"dimension_key":{"REF_AREA":"BRA"},"data_vintage":"2026-06-15",' +
  '"retrieved_at":"2026-08-04T14:32:07Z","source_url":"https://sdmx.ilo.org/rest/data/ILO,DF_X/all","api_version":null,' +
  '"license":{"id":"CC-BY-4.0","name":null,"url":null,"terms_url":null,"verified_at":null},"citation":"ILO, ILOSTAT.",' +
  '"notices":[],"derived":false,"derivation_note":null,"served_from_cache":true,' +
  '"retrieval":{"requests":2,"attempts":3,"anomalies":[{"kind":"timeout","count":1}],"unstable":true},' +
  '"field_sources":[{"fields":["a"],"source_url":"https://a.example/1","dataset_id":null,"data_vintage":null,' +
  '"retrieved_at":"2026-08-04T14:32:07Z"},{"fields":["b","c"],"source_url":"https://a.example/2","dataset_id":"D2",' +
  '"data_vintage":"2026","retrieved_at":null}]}';

describe("primeiro tempo do rollout: subir o pacote não muda um byte do fio", () => {
  it("o default continua 1.1 (a 1.2 é opt-in do servidor)", () => {
    expect(CONTRACT_VERSION).toBe("1.1");
    expect(LATEST_CONTRACT_VERSION).toBe("1.2");
    expect(v11.contractVersion).toBe("1.1");
    expect(v11.build(mista).contract_version).toBe("1.1");
  });

  it("concise e detailed saem byte-idênticos aos da 0.2.0 publicada", () => {
    const p = v11.build(mista);
    expect(JSON.stringify(renderConcise(p))).toBe(CONCISE_020);
    expect(JSON.stringify(renderDetailed(p))).toBe(DETAILED_020);
  });

  it("result(): structuredContent e _meta idem", () => {
    const r = v11.result({ x: 1 }, v11.build(mista));
    expect(JSON.stringify(r.structuredContent.provenance)).toBe(CONCISE_020);
    expect(JSON.stringify(r._meta["com.exemplo.teste/provenance"])).toBe(CONCISE_020);
  });

  it("na 1.1 a regra do mais antigo NÃO é cobrada (servidor que escolhe a chave à mão sobe o pacote sem quebrar)", () => {
    expect(() =>
      v11.build({ ...mista, field_sources: [{ fields: ["a"], source_url: "u", retrieved_at: "2026-01-01T00:00:00Z" }] }),
    ).not.toThrow();
  });
});

describe("segundo tempo: contractVersion 1.2", () => {
  it("resposta SEM fusão: concise idêntico ao da 1.1 — field_sources ausente, não null", () => {
    const c = renderConcise(v12.build(simples));
    expect("field_sources" in c).toBe(false);
    expect(JSON.stringify(c)).toBe(JSON.stringify(renderConcise(v11.build(simples))));
  });

  it("field_sources: [] também conta como sem fusão", () => {
    expect("field_sources" in renderConcise(v12.build({ ...mista, field_sources: [] }))).toBe(false);
  });

  it("resposta COM fusão: field_sources é a 8ª chave, por último, com served_from_cache por sub-fonte", () => {
    const p = v12.build({
      ...mista,
      retrieved_at: "2026-10-04T15:00:00Z",
      field_sources: [
        { fields: ["vitoria"], source_url: "https://ibge/a", retrieved_at: "2026-10-04T15:00:00Z", served_from_cache: true },
        { fields: ["vila_velha"], source_url: "https://ibge/b", retrieved_at: "2026-10-05T21:30:00Z", served_from_cache: false },
      ],
    });
    const c = renderConcise(p);
    expect(Object.keys(c)).toEqual([
      "source", "source_url", "data_vintage", "retrieved_at", "retrieval", "citation", "license", "field_sources",
    ]);
    expect(c.field_sources).toEqual([
      { fields: ["vitoria"], source_url: "https://ibge/a", dataset_id: null, data_vintage: null,
        retrieved_at: "2026-10-04T15:00:00Z", served_from_cache: true },
      { fields: ["vila_velha"], source_url: "https://ibge/b", dataset_id: null, data_vintage: null,
        retrieved_at: "2026-10-05T21:30:00Z", served_from_cache: false },
    ]);
  });

  it("served_from_cache ausente na entrada sai null (não distingue), nunca inventado", () => {
    const c = renderConcise(v12.build(mista));
    expect(c.field_sources!.map((fs) => fs.served_from_cache)).toEqual([null, null]);
  });

  it("detailed carrega contract_version 1.2 e served_from_cache nos itens", () => {
    const d = renderDetailed(v12.build(mista));
    expect(d.contract_version).toBe("1.2");
    expect(Object.keys(d.field_sources![0]!)).toEqual([
      "fields", "source_url", "dataset_id", "data_vintage", "retrieved_at", "served_from_cache",
    ]);
  });

  it("retrieved_at de sub-fonte aceita Date e é normalizado ao fuso do contexto", () => {
    const ctx = createProvenanceContext({ ...base, timezone: { offset: "-03:00" }, contractVersion: "1.2" });
    const p = ctx.build({
      ...simples,
      retrieved_at: "2026-10-04T15:00:00Z",
      field_sources: [{ fields: ["a"], source_url: "u", retrieved_at: new Date("2026-10-05T00:00:00Z") }],
    });
    expect(p.field_sources![0]!.retrieved_at).toBe("2026-10-04T21:00:00-03:00");
  });

  it("regra do mais antigo (§5): bloco mais novo que uma sub-fonte é erro de contrato", () => {
    expect(() =>
      v12.build({
        ...simples,
        retrieved_at: "2026-10-05T21:30:00Z",
        field_sources: [
          { fields: ["a"], source_url: "https://ibge/a", retrieved_at: "2026-10-04T15:00:00Z" },
          { fields: ["b"], source_url: "https://ibge/b", retrieved_at: "2026-10-05T21:30:00Z" },
        ],
      }),
    ).toThrow(ProvenanceContractError);
  });

  it("regra do mais antigo compara instantes, não strings (fusos diferentes)", () => {
    expect(() =>
      v12.build({
        ...simples,
        retrieved_at: "2026-10-04T12:00:00-03:00", // = 15:00Z
        field_sources: [{ fields: ["a"], source_url: "u", retrieved_at: "2026-10-04T15:00:00Z" }],
      }),
    ).not.toThrow();
  });

  it("contractVersion desconhecida é recusada na criação do contexto", () => {
    expect(() => createProvenanceContext({ ...base, contractVersion: "2.0" as never })).toThrow(/desconhecida/);
  });
});

describe("os schemas publicados aceitam o fio das DUAS versões", () => {
  const fios = () => ({
    c11: renderConcise(v11.build(mista)),
    c12: renderConcise(v12.build(mista)),
    c12simples: renderConcise(v12.build(simples)),
    d11: renderDetailed(v11.build(mista)),
    d12: renderDetailed(v12.build(mista)),
  });

  it("zod estrito valida concise 1.1, 1.2 sem fusão e 1.2 com fusão", () => {
    const f = fios();
    for (const c of [f.c11, f.c12, f.c12simples]) expect(ConciseBlockSchema.parse(c)).toEqual(c);
  });

  it("zod estrito valida detailed 1.1 e 1.2", () => {
    const f = fios();
    for (const d of [f.d11, f.d12]) expect(DetailedBlockSchema.parse(d)).toEqual(d);
  });

  it("JSON Schema: field_sources declarada e NÃO exigida; o item declara served_from_cache sem exigir", () => {
    expect(Object.keys(CONCISE_BLOCK_JSON_SCHEMA.properties).at(-1)).toBe("field_sources");
    expect(CONCISE_BLOCK_JSON_SCHEMA.required).not.toContain("field_sources");
    expect(CONCISE_BLOCK_JSON_SCHEMA.properties.field_sources.items).toBe(FIELD_SOURCE_JSON_SCHEMA);
    expect(Object.keys(FIELD_SOURCE_JSON_SCHEMA.properties)).toContain("served_from_cache");
    expect(FIELD_SOURCE_JSON_SCHEMA.required).not.toContain("served_from_cache");
  });

  it("chave estranha dentro de uma sub-fonte continua recusada", () => {
    const c = fios().c12;
    expect(() =>
      ConciseBlockSchema.parse({ ...c, field_sources: [{ ...c.field_sources![0]!, extra: 1 }] }),
    ).toThrow();
  });
});
