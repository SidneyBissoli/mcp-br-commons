import { describe, expect, it } from "vitest";
import { applyArm, readRetrieval, stripRetrieval } from "../../src/session/filter.js";
import { STABLE, UNSTABLE, payloadWith } from "./helpers.js";

describe("filtro do braço B (stripRetrieval)", () => {
  it("apaga provenance.retrieval quando é objeto e preserva o resto e o formato pretty", () => {
    const original = payloadWith(UNSTABLE);
    const out = stripRetrieval(original);
    const parsed = JSON.parse(out) as { provenance: Record<string, unknown>; valores: unknown[] };
    expect(parsed.provenance).not.toHaveProperty("retrieval");
    expect(parsed.provenance.source).toBe("BCB");
    expect(parsed.valores).toHaveLength(1);
    // Mesmo formato: pretty com 2 espaços, como o original.
    expect(out.startsWith("{\n  ")).toBe(true);
    expect(out).toBe(JSON.stringify(JSON.parse(out), null, 2));
  });

  it("apaga retrieval de CADA bloco quando provenance é array (multi-fonte)", () => {
    const obj = {
      x: 1,
      provenance: [
        { source: "A", retrieval: STABLE },
        { source: "B", retrieval: UNSTABLE },
      ],
    };
    const out = JSON.parse(stripRetrieval(JSON.stringify(obj))) as { provenance: Record<string, unknown>[] };
    expect(out.provenance).toHaveLength(2);
    for (const b of out.provenance) expect(b).not.toHaveProperty("retrieval");
    expect(out.provenance.map((b) => b.source)).toEqual(["A", "B"]);
  });

  it("mantém o formato compacto quando o original era compacto", () => {
    const out = stripRetrieval(payloadWith(STABLE, 1, false));
    expect(out.includes("\n")).toBe(false);
  });

  it("texto que não é JSON passa intacto (erro em pt-BR)", () => {
    const erro = "Série 99999 não encontrada no SGS.";
    expect(stripRetrieval(erro)).toBe(erro);
  });

  it("JSON sem provenance ou sem retrieval devolve o texto ORIGINAL, byte a byte", () => {
    const semProv = JSON.stringify({ a: 1 }, null, 2);
    expect(stripRetrieval(semProv)).toBe(semProv);
    const semRetrieval = JSON.stringify({ a: 1, provenance: { source: "X" } });
    expect(stripRetrieval(semRetrieval)).toBe(semRetrieval);
  });

  it("applyArm: A é identidade, B filtra", () => {
    const t = payloadWith(UNSTABLE);
    expect(applyArm("A", t)).toBe(t);
    expect(applyArm("B", t)).not.toContain("retrieval");
  });
});

describe("readRetrieval", () => {
  it("lê objeto e array; null quando não há", () => {
    expect(readRetrieval(payloadWith(UNSTABLE))).toEqual([UNSTABLE]);
    const multi = JSON.stringify({ provenance: [{ retrieval: STABLE }, { retrieval: UNSTABLE }] });
    expect(readRetrieval(multi)?.map((r) => r.unstable)).toEqual([false, true]);
    expect(readRetrieval(payloadWith(null))).toBeNull();
    expect(readRetrieval("não é json")).toBeNull();
  });
});
