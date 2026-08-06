/**
 * Compatibilidade com o shape em produção do senado-br-mcp-cloudflare
 * (`src/utils/estatisticas.ts`): a adoção da lib lá não pode mudar byte algum da
 * resposta. O esperado abaixo replica a saída de
 * `{ ...arredondarEstatisticas(e), top: arredondarEntradas(e.top) }` e do bloco
 * agrupado `{ grupo, ...arredondarEstatisticas(g) }` para um dataset conhecido.
 */
import { describe, expect, it } from "vitest";
import { computeGroupedStats, computeStats } from "../src/core.js";
import { formatEntries, formatGrouped, formatStats } from "../src/display.js";
import { parseBRL } from "../src/parse.js";

// Linhas como as da folha administrativa: valores em string pt-BR.
const folha = [
  { sequencial: 2, nome: "Ana", remuneracao: "10.000,00" },
  { sequencial: 1, nome: "Bia", remuneracao: "10.000,00" }, // empate: menor sequencial vence
  { sequencial: 3, nome: "Caio", remuneracao: "5.500,50" },
  { sequencial: 4, nome: "Davi", remuneracao: "2.000,00" },
];

describe("pipeline senado: parseBRL → computeStats → formatStats", () => {
  const e = computeStats(folha, (r) => parseBRL(r.remuneracao), {
    topN: 2,
    identify: (r) => ({ nome: r.nome }),
    tieBreak: (r) => r.sequencial,
  });

  it("distribuição byte-compatível (JSON idêntico ao shape do senado)", () => {
    expect(JSON.stringify(formatStats(e))).toBe(
      JSON.stringify({
        n: 4,
        soma: 27500.5,
        minimo: 2000,
        maximo: 10000,
        media: 6875.13,
        mediana: 7750.25,
        desvioPadrao: 3361.03,
        percentis: [
          { percentil: 25, valor: 4625.38, rotulo: "25% dos valores são iguais ou inferiores a R$ 4.625,38" },
          { percentil: 50, valor: 7750.25, rotulo: "mediana — metade dos valores é igual ou inferior a R$ 7.750,25" },
          { percentil: 75, valor: 10000, rotulo: "75% dos valores são iguais ou inferiores a R$ 10.000,00" },
          { percentil: 90, valor: 10000, rotulo: "90% dos valores são iguais ou inferiores a R$ 10.000,00" },
          { percentil: 95, valor: 10000, rotulo: "95% dos valores são iguais ou inferiores a R$ 10.000,00" },
          { percentil: 99, valor: 10000, rotulo: "99% dos valores são iguais ou inferiores a R$ 10.000,00" },
        ],
      }),
    );
  });

  it("empate no topo resolvido pelo menor sequencial (argMax e top)", () => {
    expect(e.argMax).toEqual({ nome: "Bia", value: 10000 });
    expect(formatEntries(e.top)).toEqual([
      { nome: "Bia", valor: 10000 },
      { nome: "Ana", valor: 10000 },
    ]);
  });
});

describe("bloco agrupado byte-compatível", () => {
  it("chaves totalGrupos/grupos e grupo primeiro em cada item", () => {
    const g = computeGroupedStats(folha, (r) => parseBRL(r.remuneracao), (r) => r.nome[0]!);
    const bloco = formatGrouped(g);
    expect(Object.keys(bloco)).toEqual(["totalGrupos", "grupos"]);
    const primeiro = (bloco.grupos as Array<Record<string, unknown>>)[0]!;
    expect(Object.keys(primeiro)).toEqual([
      "grupo", "n", "soma", "minimo", "maximo", "media", "mediana", "desvioPadrao", "percentis",
    ]);
  });
});
