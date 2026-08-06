import { describe, expect, it } from "vitest";
import { createProvenanceContext } from "../src/context.js";
import type { ConciseBlock, DetailedBlock } from "../src/render.js";

const ctx = createProvenanceContext({
  metaNamespace: "com.sidneybissoli.senado",
  locale: "pt-BR",
  timezone: { offset: "-03:00", label: "horário de Brasília" },
});

const prov = ctx.build({
  source: "Senado Federal — Dados Abertos (Legislativo)",
  source_url: "https://legis.senado.leg.br/dadosabertos/processo.json",
  citation: "Fonte: Senado Federal, Portal de Dados Abertos.",
  license: "Dados Abertos do Senado Federal — uso livre com atribuição da fonte.",
  retrieved_at: "2026-08-06T12:00:00Z",
});

describe("result — os três canais", () => {
  const data = { total: 2, itens: [{ id: 1 }, { id: 2 }] };
  const res = ctx.result(data, prov);

  it("canal 1: structuredContent = dados + provenance (modo default concise) + attribution", () => {
    expect(res.structuredContent.total).toBe(2);
    const block = res.structuredContent.provenance as ConciseBlock;
    expect(block.source).toBe("Senado Federal — Dados Abertos (Legislativo)");
    expect(Object.keys(block)).toHaveLength(6);
    expect(res.structuredContent.attribution).toEqual([
      "https://legis.senado.leg.br/dadosabertos/processo.json",
    ]);
  });

  it("canal 2: _meta espelha o MESMO bloco sob chaves namespaced", () => {
    expect(res._meta["com.sidneybissoli.senado/provenance"]).toEqual(res.structuredContent.provenance);
    expect(res._meta["com.sidneybissoli.senado/attribution"]).toEqual(res.structuredContent.attribution);
  });

  it("canal 3: texto = JSON dos dados (SEM provenance) + rodapé compacto", () => {
    expect(res.content).toHaveLength(2);
    expect(res.content[0]!.text).toBe(JSON.stringify(data, null, 2));
    expect(res.content[0]!.text).not.toMatch(/provenance/);
    expect(res.content[1]!.text).toMatch(/^---\nFonte: /);
  });

  it("modo detailed embute o bloco canônico completo", () => {
    const det = ctx.result(data, prov, { mode: "detailed" });
    const block = det.structuredContent.provenance as DetailedBlock;
    expect(block.contract_version).toBe("1.0");
    expect(block.derived).toBe(false);
    expect(det.content[1]!.text).not.toMatch(/solicitada nesta própria conversa/);
  });

  it("segregação: array de blocos entra como array nos canais 1 e 2", () => {
    const other = ctx.build({
      source: "Senado Federal — Dados Abertos (Administrativo)",
      source_url: "https://adm.senado.gov.br/adm-dadosabertos/api/v1/ceaps",
      citation: "Fonte: Senado Federal, Portal de Dados Abertos (Administrativo).",
      license: "Dados Abertos do Senado Federal — uso livre com atribuição da fonte.",
      retrieved_at: "2026-08-06T12:00:00Z",
    });
    const res2 = ctx.result(data, [prov, other]);
    expect(Array.isArray(res2.structuredContent.provenance)).toBe(true);
    expect(res2.structuredContent.attribution).toHaveLength(2);
  });

  it("exige ao menos um bloco", () => {
    expect(() => ctx.result(data, [])).toThrow(/ao menos um bloco/);
  });
});
