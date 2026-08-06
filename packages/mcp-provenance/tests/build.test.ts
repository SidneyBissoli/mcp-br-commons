import { describe, expect, it } from "vitest";
import { createProvenanceContext } from "../src/context.js";

const ctx = createProvenanceContext({
  metaNamespace: "com.exemplo.teste",
  locale: "pt-BR",
  timezone: { offset: "-03:00", label: "horário de Brasília" },
});

const baseInput = {
  source: "Senado Federal — Dados Abertos (Legislativo)",
  source_url: "https://legis.senado.leg.br/dadosabertos/processo.json",
  citation: "Fonte: Senado Federal, Portal de Dados Abertos.",
  license: "Dados Abertos do Senado Federal — uso livre com atribuição da fonte.",
  retrieved_at: "2026-08-06T12:00:00Z",
};

describe("build", () => {
  it("expande atalhos de string para os objetos canônicos", () => {
    const p = ctx.build(baseInput);
    expect(p.source).toEqual({
      name: "Senado Federal — Dados Abertos (Legislativo)",
      agency: null,
      database: null,
      endpoint: null,
    });
    expect(p.license.name).toMatch(/uso livre/);
    expect(p.license.id).toBeNull();
    expect(p.contract_version).toBe("1.0");
  });

  it("normaliza retrieved_at para o fuso do contexto", () => {
    const p = ctx.build(baseInput);
    expect(p.retrieved_at).toBe("2026-08-06T09:00:00-03:00");
  });

  it("preenche defaults com null explícito (ausência nunca é omissão silenciosa)", () => {
    const p = ctx.build(baseInput);
    expect(p.data_vintage).toBeNull();
    expect(p.dataset).toEqual({ id: null, version: null, name: null });
    expect(p.dimension_key).toBeNull();
    expect(p.notices).toEqual([]);
    expect(p.derived).toBe(false);
    expect(p.derivation_note).toBeNull();
    expect(p.served_from_cache).toBeNull();
    expect(p.field_sources).toBeNull();
  });

  it("aceita dataset como string (vira dataset.id)", () => {
    const p = ctx.build({ ...baseInput, dataset: "consultas_votos" });
    expect(p.dataset).toEqual({ id: "consultas_votos", version: null, name: null });
  });

  it("rejeita licença sem id nem name (piso legal)", () => {
    expect(() => ctx.build({ ...baseInput, license: { url: "https://example.org/terms" } })).toThrow();
  });

  it("rejeita derived=true sem derivation_note (§4)", () => {
    expect(() => ctx.build({ ...baseInput, derived: true })).toThrow(/derivation_note/);
  });

  it("aceita derived=true com derivation_note", () => {
    const p = ctx.build({
      ...baseInput,
      derived: true,
      derivation_note: "Taxa por 100 mil habitantes calculada pelo servidor.",
    });
    expect(p.derived).toBe(true);
  });

  it("normaliza retrieved_at das field_sources para o fuso do contexto", () => {
    const p = ctx.build({
      ...baseInput,
      field_sources: [
        {
          fields: ["relatoria"],
          source_url: "https://legis.senado.leg.br/dadosabertos/processo/relatoria.json",
          retrieved_at: "2026-08-06T13:30:00Z",
        },
      ],
    });
    expect(p.field_sources?.[0]?.retrieved_at).toBe("2026-08-06T10:30:00-03:00");
    expect(p.field_sources?.[0]?.dataset_id).toBeNull();
  });

  it("bloco canônico ilostat completo passa inteiro", () => {
    const p = ctx.build({
      source: { name: "ILOSTAT", agency: "ILO", database: "ILOSTAT", endpoint: "https://sdmx.ilo.org/rest" },
      dataset: { id: "DF_UNE_DEAP_SEX_AGE_RT", version: "1.0", name: "Unemployment rate by sex and age" },
      dimension_key: { REF_AREA: "BRA", SEX: "SEX_F", TIME_PERIOD: "2024" },
      data_vintage: "2026-06-15",
      retrieved_at: "2026-08-04T14:32:07Z",
      source_url: "https://sdmx.ilo.org/rest/data/ILO,DF_UNE_DEAP_SEX_AGE_RT/...",
      license: {
        id: "CC-BY-4.0",
        url: "https://creativecommons.org/licenses/by/4.0/",
        terms_url: "https://www.ilo.org/rights-and-permissions",
        verified_at: "2026-08-04",
      },
      citation: "International Labour Organization, ILOSTAT, https://ilostat.ilo.org/data/, accessed 2026-08-04.",
    });
    expect(p.source.agency).toBe("ILO");
    expect(p.license.id).toBe("CC-BY-4.0");
    expect(p.dimension_key?.REF_AREA).toBe("BRA");
  });

  it("from() mescla preset de fonte com campos por chamada", () => {
    const preset = {
      source: "Senado Federal — Dados Abertos (Administrativo)",
      citation: "Fonte: Senado Federal, Portal de Dados Abertos (Administrativo).",
      license: "Dados Abertos do Senado Federal — uso livre com atribuição da fonte.",
    };
    const p = ctx.from(preset, {
      source_url: "https://adm.senado.gov.br/adm-dadosabertos/api/v1/ceaps",
      retrieved_at: "2026-08-06T12:00:00Z",
      data_vintage: "2025",
    });
    expect(p.source.name).toMatch(/Administrativo/);
    expect(p.data_vintage).toBe("2025");
  });
});
