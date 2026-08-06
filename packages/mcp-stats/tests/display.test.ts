import { describe, expect, it } from "vitest";
import { computeGroupedStats, computeStats } from "../src/core.js";
import { formatEntries, formatGrouped, formatStats, labeledPercentiles } from "../src/display.js";
import { formatBRL, formatNumberEn } from "../src/locale.js";

const registros = [
  { nome: "Ana", v: 10 }, { nome: "Bia", v: 20 }, { nome: "Caio", v: 30 }, { nome: "Davi", v: 40 },
];
const stats = computeStats(registros, (r) => r.v, { topN: 2, identify: (r) => ({ nome: r.nome }) });

describe("formatBRL / formatNumberEn (determinísticos, sem Intl)", () => {
  it("agrupa milhares e usa 2 casas", () => {
    expect(formatBRL(1234.5)).toBe("R$ 1.234,50");
    expect(formatBRL(-7139.64)).toBe("-R$ 7.139,64");
    expect(formatBRL(0)).toBe("R$ 0,00");
    expect(formatNumberEn(1234567.891)).toBe("1,234,567.89");
    expect(formatNumberEn(-0.5)).toBe("-0.50");
  });
});

describe("formatStats pt-BR (default)", () => {
  const bloco = formatStats(stats);

  it("chaves pt-BR na ordem do contrato", () => {
    expect(Object.keys(bloco)).toEqual([
      "n", "soma", "minimo", "maximo", "media", "mediana", "desvioPadrao", "percentis",
    ]);
  });

  it("valores arredondados a 2 casas", () => {
    expect(bloco.n).toBe(4);
    expect(bloco.soma).toBe(100);
    expect(bloco.desvioPadrao).toBe(11.18); // sqrt(125) = 11.1803...
  });

  it("percentis como lista rotulada — o leitor nunca vê 'p99'", () => {
    const percentis = bloco.percentis as Array<Record<string, unknown>>;
    expect(percentis).toHaveLength(6);
    expect(percentis[0]).toEqual({
      percentil: 25,
      valor: 17.5,
      rotulo: "25% dos valores são iguais ou inferiores a R$ 17,50",
    });
    expect(percentis[1]).toEqual({
      percentil: 50,
      valor: 25,
      rotulo: "mediana — metade dos valores é igual ou inferior a R$ 25,00",
    });
    expect(percentis[5]?.valor).toBe(39.7);
  });
});

describe("formatStats en", () => {
  it("chaves e rótulos em inglês, formatador en", () => {
    const bloco = formatStats(stats, { locale: "en" });
    expect(Object.keys(bloco)).toEqual([
      "n", "sum", "min", "max", "mean", "median", "stdDev", "percentiles",
    ]);
    const p = (bloco.percentiles as Array<Record<string, unknown>>)[1];
    expect(p).toEqual({
      percentile: 50,
      value: 25,
      label: "median — half of the values are at or below 25.00",
    });
  });
});

describe("formatEntries", () => {
  it("arredonda e usa a chave de valor do locale", () => {
    expect(formatEntries(stats.top)).toEqual([
      { nome: "Davi", valor: 40 },
      { nome: "Caio", valor: 30 },
    ]);
    expect(formatEntries(stats.top, { locale: "en" })[0]).toEqual({ nome: "Davi", value: 40 });
  });
});

describe("formatGrouped", () => {
  const muitos = Array.from({ length: 60 }, (_, i) => ({ g: `G${i}`, v: i + 1 }));

  it("sem truncamento não há aviso", () => {
    const g = computeGroupedStats(registros, (r) => r.v, (r) => r.nome);
    const bloco = formatGrouped(g);
    expect(bloco.totalGrupos).toBe(4);
    expect(bloco).not.toHaveProperty("aviso");
  });

  it("com truncamento, o aviso pt-BR do senado, e grupos com chave 'grupo' primeiro", () => {
    const g = computeGroupedStats(muitos, (r) => r.v, (r) => r.g);
    const bloco = formatGrouped(g);
    expect(bloco.aviso).toBe(
      "Exibindo 50 de 60 grupos (ordenados por soma decrescente). Refine o filtro ou reduza a granularidade.",
    );
    const primeiro = (bloco.grupos as Array<Record<string, unknown>>)[0]!;
    expect(Object.keys(primeiro)[0]).toBe("grupo");
    expect(primeiro.grupo).toBe("G59");
  });
});

describe("opções de exibição", () => {
  it("decimals e formatValue injetáveis (ex.: taxas com 4 casas)", () => {
    const taxas = computeStats([{ v: 0.123456 }, { v: 0.654321 }], (r) => r.v);
    const bloco = formatStats(taxas, {
      locale: "en",
      decimals: 4,
      formatValue: (n) => `${n}%`,
    });
    expect(bloco.mean).toBe(0.3889);
    const p = (bloco.percentiles as Array<Record<string, unknown>>)[1];
    expect(p?.label).toBe("median — half of the values are at or below 0.3889%");
  });

  it("labeledPercentiles utilizável isoladamente", () => {
    const lista = labeledPercentiles(stats.percentiles, { locale: "en" });
    expect(lista.map((x) => x.percentile)).toEqual([25, 50, 75, 90, 95, 99]);
  });
});
