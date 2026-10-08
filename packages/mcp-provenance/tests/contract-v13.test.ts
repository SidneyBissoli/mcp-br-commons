import { describe, expect, it } from "vitest";
import { createProvenanceContext, type ProvenanceContextOptions } from "../src/context.js";
import {
  CONCISE_BLOCK_JSON_SCHEMA,
  ConciseBlockSchema,
  DETAILED_BLOCK_JSON_SCHEMA,
  DetailedBlockSchema,
  REVISION_OBJECT_JSON_SCHEMA,
} from "../src/json-schema.js";
import { renderConcise, renderDetailed } from "../src/render.js";
import {
  CONTRACT_VERSION,
  LATEST_CONTRACT_VERSION,
  ProvenanceContractError,
  RevisionStatusSchema,
  type ProvenanceInput,
} from "../src/schema.js";

const base: ProvenanceContextOptions = { metaNamespace: "com.exemplo.teste", timezone: "utc" };
const v11 = createProvenanceContext(base);
const v12 = createProvenanceContext({ ...base, contractVersion: "1.2" });
const v13 = createProvenanceContext({ ...base, contractVersion: "1.3" });

const comum: ProvenanceInput = {
  source: { name: "ILOSTAT", agency: "ILO", database: "ILOSTAT", endpoint: "https://sdmx.ilo.org/rest" },
  dataset: { id: "DF_X", version: "1.0", name: "Example" },
  data_vintage: "2026-06-15",
  retrieved_at: "2026-08-04T14:32:07Z",
  source_url: "https://sdmx.ilo.org/rest/data/ILO,DF_X/all",
  license: { id: "CC-BY-4.0" },
  citation: "ILO, ILOSTAT.",
  retrieval: { requests: 1, attempts: 1 },
};

/** Tudo o que a 1.3 acrescenta, de uma vez. */
const completa: ProvenanceInput = {
  ...comum,
  notices: ["Break in series (2)", "Thousands (12)"],
  derived: true,
  derivation_note: "Taxa por 100 mil habitantes calculada pelo servidor",
  revision: { status: "provisional", note: "Ano com competências ainda abertas" },
};

describe("primeiro tempo da 1.3: subir o pacote não muda um byte do fio 1.1 nem do 1.2", () => {
  it("o default continua 1.1; a 1.3 é a mais nova e é opt-in", () => {
    expect(CONTRACT_VERSION).toBe("1.1");
    expect(LATEST_CONTRACT_VERSION).toBe("1.3");
  });

  it("1.1 e 1.2 ignoram notices/derived/revision no concise e não ganham revision no detailed", () => {
    for (const ctx of [v11, v12]) {
      const c = renderConcise(ctx.build(completa));
      expect(Object.keys(c)).toEqual([
        "source", "source_url", "data_vintage", "retrieved_at", "retrieval", "citation", "license",
      ]);
      expect("revision" in renderDetailed(ctx.build(completa))).toBe(false);
    }
  });

  it("rodapé de 1.1/1.2 com aviso, derivação e preliminar: idêntico ao de sem nada", () => {
    for (const ctx of [v11, v12]) {
      expect(ctx.footer(ctx.build(completa))).toBe(ctx.footer(ctx.build(comum)));
    }
  });
});

describe("segundo tempo: contractVersion 1.3 — chave nova só quando há o que dizer", () => {
  it("resposta comum (sem aviso, sem derivação, sem revisão conhecida): concise byte-idêntico ao da 1.1", () => {
    expect(JSON.stringify(renderConcise(v13.build(comum)))).toBe(JSON.stringify(renderConcise(v11.build(comum))));
  });

  it("resposta comum: rodapé byte-idêntico ao da 1.1", () => {
    expect(v13.footer(v13.build(comum))).toBe(v11.footer(v11.build(comum)));
  });

  it("revision 'current' sai no concise, mas não acrescenta linha ao rodapé (é o caso normal)", () => {
    const p = v13.build({ ...comum, revision: { status: "current" } });
    expect(renderConcise(p).revision).toEqual({ status: "current", note: null });
    expect(v13.footer(p)).toBe(v11.footer(v11.build(comum)));
  });

  it("revision 'final' também não acrescenta linha ao rodapé", () => {
    const p = v13.build({ ...comum, revision: { status: "final", note: "Versão 2019 da tabela" } });
    expect(v13.footer(p)).toBe(v11.footer(v11.build(comum)));
  });

  it("tudo presente: as chaves novas vêm depois das da 1.2, em ordem fixa", () => {
    const c = renderConcise(
      v13.build({
        ...completa,
        field_sources: [{ fields: ["a"], source_url: "https://a/1", retrieved_at: "2026-08-04T14:32:07Z" }],
      }),
    );
    expect(Object.keys(c)).toEqual([
      "source", "source_url", "data_vintage", "retrieved_at", "retrieval", "citation", "license",
      "field_sources", "notices", "derived", "derivation_note", "revision",
    ]);
    expect(c.notices).toEqual(["Break in series (2)", "Thousands (12)"]);
    expect(c.derived).toBe(true);
    expect(c.derivation_note).toBe("Taxa por 100 mil habitantes calculada pelo servidor");
    expect(c.revision).toEqual({ status: "provisional", note: "Ano com competências ainda abertas" });
  });

  it("notices: [] e derived: false são AUSÊNCIA, não chave vazia", () => {
    const c = renderConcise(v13.build({ ...comum, notices: [], derived: false }));
    for (const k of ["notices", "derived", "derivation_note", "revision"]) expect(k in c).toBe(false);
  });

  it("revision ausente na entrada = não se sabe = chave ausente no concise e null no detailed", () => {
    expect("revision" in renderConcise(v13.build(comum))).toBe(false);
    const d = renderDetailed(v13.build(comum));
    expect(d.contract_version).toBe("1.3");
    expect(d.revision).toBeNull();
    expect(Object.keys(d).at(-1)).toBe("revision");
  });

  it("status fora do vocabulário fechado é erro de contrato", () => {
    expect(() => v13.build({ ...comum, revision: { status: "definitivo" as never } })).toThrow();
    expect(RevisionStatusSchema.options).toEqual(["current", "provisional", "final"]);
  });

  it("a regra do mais antigo (1.2) continua valendo na 1.3", () => {
    expect(() =>
      v13.build({
        ...comum,
        retrieved_at: "2026-10-05T21:30:00Z",
        field_sources: [{ fields: ["a"], source_url: "https://ibge/a", retrieved_at: "2026-10-04T15:00:00Z" }],
      }),
    ).toThrow(ProvenanceContractError);
  });
});

describe("rodapé na 1.3: uma linha por exceção, em linguagem simples", () => {
  const pt = createProvenanceContext({ ...base, contractVersion: "1.3" });
  const en = createProvenanceContext({ ...base, locale: "en", contractVersion: "1.3" });

  it("pt-BR: preliminar, derivação e avisos da fonte, depois da licença e antes do aviso final", () => {
    const linhas = pt.footer(pt.build(completa)).split("\n");
    expect(linhas.slice(2)).toEqual([
      "Licença: CC-BY-4.0.",
      "Dados preliminares: a fonte ainda pode completá-los ou corrigi-los. Ano com competências ainda abertas.",
      "Valores calculados pelo servidor a partir dos dados da fonte: Taxa por 100 mil habitantes calculada pelo servidor.",
      "Avisos da fonte: Break in series (2); Thousands (12).",
      "A referência completa desta informação pode ser solicitada nesta própria conversa.",
    ]);
  });

  it("en: as mesmas três linhas", () => {
    const linhas = en.footer(en.build(completa)).split("\n");
    expect(linhas.slice(3, 6)).toEqual([
      "Preliminary data: the source may still complete or correct it. Ano com competências ainda abertas.",
      "Values computed by the server from the source data: Taxa por 100 mil habitantes calculada pelo servidor.",
      "Notices from the source: Break in series (2); Thousands (12).",
    ]);
  });

  it("nota do preliminar abre frase: sobe a inicial, não mexe no resto nem duplica o ponto", () => {
    const f = pt.footer(pt.build({ ...comum, revision: { status: "provisional", note: "competências do IPCA abertas." } }));
    expect(f).toContain("corrigi-los. Competências do IPCA abertas.\n");
  });

  it("preliminar sem nota: só a frase-base", () => {
    const f = pt.footer(pt.build({ ...comum, revision: { status: "provisional" } }));
    expect(f).toContain("\nDados preliminares: a fonte ainda pode completá-los ou corrigi-los.\n");
  });
});

describe("os schemas publicados aceitam o fio das TRÊS versões", () => {
  const fios = () => [
    renderConcise(v11.build(completa)),
    renderConcise(v12.build(completa)),
    renderConcise(v13.build(comum)),
    renderConcise(v13.build(completa)),
  ];

  it("zod estrito valida concise 1.1, 1.2, 1.3 comum e 1.3 completa", () => {
    for (const c of fios()) expect(ConciseBlockSchema.parse(c)).toEqual(c);
  });

  it("zod estrito valida detailed 1.1, 1.2 e 1.3", () => {
    for (const ctx of [v11, v12, v13]) {
      const d = renderDetailed(ctx.build(completa));
      expect(DetailedBlockSchema.parse(d)).toEqual(d);
    }
  });

  it("JSON Schema: as quatro chaves novas declaradas e NÃO exigidas, em ambas as projeções", () => {
    for (const k of ["notices", "derived", "derivation_note", "revision"]) {
      expect(Object.keys(CONCISE_BLOCK_JSON_SCHEMA.properties)).toContain(k);
      expect(CONCISE_BLOCK_JSON_SCHEMA.required).not.toContain(k);
    }
    expect(Object.keys(DETAILED_BLOCK_JSON_SCHEMA.properties)).toContain("revision");
    expect(DETAILED_BLOCK_JSON_SCHEMA.required).not.toContain("revision");
  });

  it("revision: chaves e vocabulário do JSON Schema batem com o modelo", () => {
    const r = renderConcise(v13.build(completa)).revision!;
    expect(Object.keys(REVISION_OBJECT_JSON_SCHEMA.properties)).toEqual(Object.keys(r));
    expect(REVISION_OBJECT_JSON_SCHEMA.required).toEqual(Object.keys(r));
    expect(REVISION_OBJECT_JSON_SCHEMA.properties.status.enum).toEqual([...RevisionStatusSchema.options]);
  });

  it("status estranho no fio é recusado pelo zod", () => {
    const c = renderConcise(v13.build(completa));
    expect(() => ConciseBlockSchema.parse({ ...c, revision: { status: "x", note: null } })).toThrow();
  });
});
