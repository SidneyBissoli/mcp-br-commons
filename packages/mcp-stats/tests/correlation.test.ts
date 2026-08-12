import { describe, expect, it } from "vitest";
import { computeCorrelation } from "../src/correlation.js";

/** Registro pareado mínimo; `null` vira NaN pelo acessor, como no uso real. */
const pares = (xs: Array<number | null>, ys: Array<number | null>) =>
  xs.map((x, i) => ({ x, y: ys[i] ?? null }));

const corr = (
  xs: Array<number | null>,
  ys: Array<number | null>,
  method?: "pearson" | "spearman",
) =>
  computeCorrelation(
    pares(xs, ys),
    (r) => r.x ?? NaN,
    (r) => r.y ?? NaN,
    method ? { method } : {},
  );

describe("computeCorrelation — Pearson", () => {
  it("relação linear perfeita positiva e negativa", () => {
    expect(corr([1, 2, 3, 4], [2, 4, 6, 8]).coefficient).toBe(1);
    expect(corr([1, 2, 3, 4], [8, 6, 4, 2]).coefficient).toBe(-1);
  });

  it("caso com a aritmética à vista: Σdxdy=8, Σdx²=Σdy²=10 ⇒ r = 0,8", () => {
    expect(corr([1, 2, 3, 4, 5], [2, 1, 4, 3, 5]).coefficient).toBeCloseTo(0.8, 12);
  });

  it("quarteto de Anscombe: os quatro conjuntos dão r ≈ 0,816", () => {
    // Referência externa clássica (Anscombe, 1973): quatro conjuntos com dispersões
    // visualmente distintas e as MESMAS estatísticas, r = 0.816 em todos.
    const x = [10, 8, 13, 9, 11, 14, 6, 4, 12, 7, 5];
    const x4 = [8, 8, 8, 8, 8, 8, 8, 19, 8, 8, 8];
    const conjuntos: Array<[number[], number[]]> = [
      [x, [8.04, 6.95, 7.58, 8.81, 8.33, 9.96, 7.24, 4.26, 10.84, 4.82, 5.68]],
      [x, [9.14, 8.14, 8.74, 8.77, 9.26, 8.1, 6.13, 3.1, 9.13, 7.26, 4.74]],
      [x, [7.46, 6.77, 12.74, 7.11, 7.81, 8.84, 6.08, 5.39, 8.15, 6.42, 5.73]],
      [x4, [6.58, 5.76, 7.71, 8.84, 8.47, 7.04, 5.25, 12.5, 5.56, 7.91, 6.89]],
    ];
    for (const [xs, ys] of conjuntos) {
      expect(corr(xs, ys).coefficient).toBeCloseTo(0.8165, 3);
    }
  });

  it("não estoura [-1, 1] em série idêntica a si mesma", () => {
    const valores = [1234.5678, 1234.5679, 1234.568, 1234.5681, 1234.5682];
    const r = corr(valores, valores).coefficient;
    expect(r).toBe(1);
  });

  it("precisão preservada com média grande e variância pequena", () => {
    // O atalho por somas de quadrados perde os dígitos significativos aqui.
    const xs = [1_000_000.1, 1_000_000.2, 1_000_000.3, 1_000_000.4];
    const ys = [5.1, 5.2, 5.3, 5.4];
    expect(corr(xs, ys).coefficient).toBeCloseTo(1, 10);
  });
});

describe("computeCorrelation — Spearman", () => {
  it("monótona não-linear: Spearman vê 1 onde Pearson não vê", () => {
    const xs = [1, 2, 3, 4, 5];
    const ys = [1, 4, 9, 16, 25]; // y = x², monótona crescente
    expect(corr(xs, ys, "spearman").coefficient).toBe(1);
    expect(corr(xs, ys).coefficient!).toBeLessThan(0.99);
  });

  it("empates usam POSTO MÉDIO — o atalho 6Σd² daria outro número", () => {
    // scipy.stats.spearmanr([1,2,2,3], [1,2,3,4]) = 0.9486832980505138
    expect(corr([1, 2, 2, 3], [1, 2, 3, 4], "spearman").coefficient).toBeCloseTo(
      0.9486832980505138,
      12,
    );
  });

  it("platô longo numa das séries não infla o coeficiente", () => {
    // Juros parados por 4 períodos enquanto a outra série sobe: os 4 empatados
    // compartilham o mesmo posto, então não carregam ordem que não existe.
    const juros = [10, 10, 10, 10, 11, 12];
    const outra = [1, 2, 3, 4, 5, 6];
    const r = corr(juros, outra, "spearman").coefficient!;
    expect(r).toBeGreaterThan(0.8);
    expect(r).toBeLessThan(1);
  });
});

describe("computeCorrelation — descarte e casos indefinidos", () => {
  it("descarte é aos pares e fica contado", () => {
    const e = corr([1, 2, null, 4, 5], [2, 4, 6, null, 10]);
    expect(e.n).toBe(3);
    expect(e.dropped).toBe(2);
    expect(e.coefficient).toBe(1);
  });

  it("menos de 2 pares completos: null com motivo, nunca 0", () => {
    const e = corr([1, null], [null, 2]);
    expect(e.n).toBe(0);
    expect(e.dropped).toBe(2);
    expect(e.coefficient).toBeNull();
    expect(e.reason).toBe("insufficient-pairs");
  });

  it("série constante: null com motivo, nunca 0", () => {
    const e = corr([5, 5, 5, 5], [1, 2, 3, 4]);
    expect(e.coefficient).toBeNull();
    expect(e.reason).toBe("constant-series");
    expect(e.n).toBe(4);
  });

  it("conjunto vazio não quebra", () => {
    const e = computeCorrelation([], () => 0, () => 0);
    expect(e).toEqual({
      method: "pearson",
      n: 0,
      dropped: 0,
      coefficient: null,
      reason: "insufficient-pairs",
    });
  });

  it("`reason` só existe quando o coeficiente é null", () => {
    expect(corr([1, 2, 3], [3, 2, 1])).not.toHaveProperty("reason");
  });
});
