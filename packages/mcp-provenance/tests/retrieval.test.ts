import { describe, expect, it } from "vitest";
import { createProvenanceContext } from "../src/context.js";
import { renderConcise, renderDetailed } from "../src/render.js";
import { normalizeRetrieval, RetrievalInputSchema } from "../src/schema.js";

const ctx = createProvenanceContext({ metaNamespace: "com.exemplo.teste", timezone: "utc" });

const input = {
  source: "Banco Central do Brasil — SGS",
  source_url: "https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados",
  citation: "Fonte: Banco Central do Brasil — SGS.",
  license: { id: "ODbL-1.0" },
  retrieved_at: "2026-09-26T12:00:00Z",
};

describe("retrieval — diagnóstico de origem (v1.1)", () => {
  it("não medido = null nos dois modos (omitido ou null explícito)", () => {
    const omitido = ctx.build(input);
    const explicito = ctx.build({ ...input, retrieval: null });
    expect(renderConcise(omitido).retrieval).toBeNull();
    expect(renderDetailed(omitido).retrieval).toBeNull();
    expect(renderConcise(explicito).retrieval).toBeNull();
  });

  it("obtenção limpa: attempts == requests, sem anomalias → unstable=false", () => {
    const p = ctx.build({ ...input, retrieval: { requests: 3, attempts: 3 } });
    expect(renderConcise(p).retrieval).toEqual({ requests: 3, attempts: 3, anomalies: [], unstable: false });
  });

  it("repetição sem anomalia classificada ainda é instável (attempts > requests)", () => {
    const p = ctx.build({ ...input, retrieval: { requests: 1, attempts: 2 } });
    expect(renderConcise(p).retrieval?.unstable).toBe(true);
  });

  it("anomalia com attempts == requests é instável (ex.: HTML em 200 sem repetir)", () => {
    const p = ctx.build({
      ...input,
      retrieval: { requests: 1, attempts: 1, anomalies: [{ kind: "malformed_body", count: 1 }] },
    });
    expect(renderConcise(p).retrieval?.unstable).toBe(true);
  });

  it("normaliza anomalies: soma por classe e ordena na ordem do enum (ordem de coleta não muda os bytes)", () => {
    const a = ctx.build({
      ...input,
      retrieval: {
        requests: 2,
        attempts: 5,
        anomalies: [
          { kind: "http_5xx", count: 1 },
          { kind: "timeout", count: 1 },
          { kind: "http_5xx", count: 1 },
        ],
      },
    });
    const b = ctx.build({
      ...input,
      retrieval: {
        requests: 2,
        attempts: 5,
        anomalies: [
          { kind: "timeout", count: 1 },
          { kind: "http_5xx", count: 2 },
        ],
      },
    });
    expect(renderConcise(a).retrieval?.anomalies).toEqual([
      { kind: "timeout", count: 1 },
      { kind: "http_5xx", count: 2 },
    ]);
    expect(JSON.stringify(renderConcise(a))).toBe(JSON.stringify(renderConcise(b)));
    expect(JSON.stringify(renderDetailed(a))).toBe(JSON.stringify(renderDetailed(b)));
  });

  it("ordem fixa das chaves internas do bloco retrieval (determinismo)", () => {
    const p = ctx.build({ ...input, retrieval: { requests: 1, attempts: 1 } });
    expect(Object.keys(renderConcise(p).retrieval!)).toEqual(["requests", "attempts", "anomalies", "unstable"]);
  });

  it("recusa attempts < requests e classe de anomalia fora do vocabulário", () => {
    expect(() => ctx.build({ ...input, retrieval: { requests: 3, attempts: 2 } })).toThrow(/attempts/);
    expect(() =>
      ctx.build({
        ...input,
        retrieval: { requests: 1, attempts: 1, anomalies: [{ kind: "dns" as never, count: 1 }] },
      }),
    ).toThrow();
    expect(() => ctx.build({ ...input, retrieval: { requests: 0, attempts: 0 } })).toThrow();
  });

  it("o servidor não informa unstable: a lib deriva e ignora o que vier", () => {
    const parsed = RetrievalInputSchema.parse({ requests: 1, attempts: 1, unstable: true });
    expect("unstable" in parsed).toBe(false);
    expect(normalizeRetrieval(parsed).unstable).toBe(false);
  });

  it("_meta espelha o mesmo bloco com retrieval", () => {
    const p = ctx.build({ ...input, retrieval: { requests: 1, attempts: 2 } });
    const res = ctx.result({ total: 1 }, p);
    expect(res._meta["com.exemplo.teste/provenance"]).toEqual(res.structuredContent.provenance);
    expect((res.structuredContent.provenance as { retrieval: unknown }).retrieval).toEqual({
      requests: 1,
      attempts: 2,
      anomalies: [],
      unstable: true,
    });
  });
});
