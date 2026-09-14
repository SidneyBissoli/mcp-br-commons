import { describe, expect, it } from "vitest";
import { computeGroupedStats, computeStats, percentile } from "../src/core.js";

describe("percentile (type 7 — interpolação linear)", () => {
  it("bate com numpy.percentile em casos conhecidos", () => {
    expect(percentile([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([15, 20, 35, 40, 50], 0.4)).toBe(29);
    expect(percentile([15, 20, 35, 40, 50], 1)).toBe(50);
    expect(percentile([15, 20, 35, 40, 50], 0)).toBe(15);
  });

  it("casos degenerados: vazio → null, singleton → o próprio valor", () => {
    // Até 0.2.0 isto devolvia 0, e era o começo da cadeia que fazia a camada de
    // exibição escrever "metade dos valores é igual ou inferior a R$ 0,00" sobre
    // uma consulta que não casou registro nenhum.
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([7], 0.99)).toBe(7);
  });
});

describe("computeStats", () => {
  const registros = [
    { nome: "A", v: 2 }, { nome: "B", v: 4 }, { nome: "C", v: 4 }, { nome: "D", v: 4 },
    { nome: "E", v: 5 }, { nome: "F", v: 5 }, { nome: "G", v: 7 }, { nome: "H", v: 9 },
  ];

  it("desvio-padrão POPULACIONAL (÷n): exemplo clássico mean=5, std=2", () => {
    const e = computeStats(registros, (r) => r.v);
    expect(e.mean).toBe(5);
    expect(e.stdDev).toBe(2);
    expect(e.n).toBe(8);
    expect(e.sum).toBe(40);
    expect(e.min).toBe(2);
    expect(e.max).toBe(9);
    expect(e.median).toBe(4.5);
  });

  it("conjunto vazio → estatísticas INDEFINIDAS (null), não zeradas", () => {
    const e = computeStats([], () => 0);
    expect(e.n).toBe(0);
    expect(e.argMax).toBeNull();
    expect(e.top).toEqual([]);
    // O que 0.3.0 mudou: mínimo, máximo, média, mediana e desvio de um conjunto
    // vazio são indefinidos. Zero atravessa qualquer validação de tipo, tem cara
    // de medida e não deixa rastro; null obriga quem consome a decidir.
    expect(e.min).toBeNull();
    expect(e.max).toBeNull();
    expect(e.mean).toBeNull();
    expect(e.median).toBeNull();
    expect(e.stdDev).toBeNull();
    expect(Object.values(e.percentiles)).toEqual([null, null, null, null, null, null]);
    expect(e.reason).toBe("no-records");
    // `n` e `sum` seguem numéricos: zero registro é um fato, e a soma vazia é zero
    // por definição — são os dois campos em que o zero não mente.
    expect(e.sum).toBe(0);
  });

  it("desempate estável: em valor igual, menor tieBreak vence em argMax e argMin", () => {
    const empatados = [
      { id: 3, v: 10 }, { id: 1, v: 10 }, { id: 2, v: 10 },
    ];
    const e = computeStats(empatados, (r) => r.v, { tieBreak: (r) => r.id });
    expect(e.argMax?.id).toBe(1);
    expect(e.argMin?.id).toBe(1);
  });

  it("top/bottom rankeados por valor com desempate estável, identificação escolhida", () => {
    const e = computeStats(registros, (r) => r.v, {
      topN: 2,
      identify: (r) => ({ nome: r.nome }),
      tieBreak: (r) => r.nome.charCodeAt(0),
    });
    expect(e.top).toEqual([
      { nome: "H", value: 9 },
      { nome: "G", value: 7 },
    ]);
    expect(e.bottom[0]).toEqual({ nome: "A", value: 2 });
    // empate em 4 (B,C,D): B vence por desempate
    expect(e.bottom[1]).toEqual({ nome: "B", value: 4 });
  });

  it("sem identify, o registro inteiro entra no extremo (+ value)", () => {
    const e = computeStats(registros, (r) => r.v);
    expect(e.argMax).toEqual({ nome: "H", v: 9, value: 9 });
  });
});

describe("computeGroupedStats", () => {
  const registros = [
    { uf: "SP", v: 10 }, { uf: "SP", v: 30 },
    { uf: "RJ", v: 25 }, { uf: "MG", v: 5 },
  ];

  it("agrupa, ordena por soma decrescente e reporta totalGroups", () => {
    const g = computeGroupedStats(registros, (r) => r.v, (r) => r.uf);
    expect(g.totalGroups).toBe(3);
    expect(g.groups.map((x) => x.group)).toEqual(["SP", "RJ", "MG"]);
    expect(g.groups[0]?.sum).toBe(40);
  });

  it("teto de grupos corta após a ordenação", () => {
    const g = computeGroupedStats(registros, (r) => r.v, (r) => r.uf, { maxGroups: 2 });
    expect(g.totalGroups).toBe(3);
    expect(g.groups.map((x) => x.group)).toEqual(["SP", "RJ"]);
  });
});
