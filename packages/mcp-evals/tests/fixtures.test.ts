/**
 * Testes offline de validateFixtures — os invariantes que fazem um rename de tool
 * quebrar o teste de fixtures de um projeto imediatamente, sem rede e sem modelo.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { buildCatalog, type CatalogGroup } from "../src/catalog.js";
import { validateFixtures, type EvalFixture } from "../src/fixtures.js";

const GROUPS: CatalogGroup[] = [
  {
    area: "alfa",
    register: (s) => {
      s.tool("srv_buscar", "Busca registros por palavra-chave.", { termo: z.string() }, async () => ({}));
      s.tool("srv_obter", "Obtém o detalhe pelo código.", { codigo: z.number() }, async () => ({}));
    },
  },
  {
    area: "beta",
    register: (s) => {
      s.tool("srv_listar", "Lista itens do acervo.", {}, async () => ({}));
    },
  },
];

const CATALOG = buildCatalog(GROUPS);

function fixture(overrides: Partial<EvalFixture> & { id: string }): EvalFixture {
  return {
    query: `Consulta realista de exemplo para ${overrides.id}?`,
    expectedTools: ["srv_buscar"],
    note: "Nota explicando a escolha.",
    ...overrides,
  };
}

/** Conjunto válido com ids distintos e queries distintas. */
function validSet(n: number): EvalFixture[] {
  return Array.from({ length: n }, (_, i) => fixture({ id: `fx-${i + 1}` }));
}

describe("validateFixtures", () => {
  it("aceita um conjunto válido (lista de problemas vazia)", () => {
    expect(validateFixtures(validSet(10), CATALOG)).toEqual([]);
  });

  it("reprova conjunto abaixo do mínimo", () => {
    const problems = validateFixtures(validSet(3), CATALOG, { minFixtures: 5 });
    expect(problems.some((p) => p.includes("mínimo 5"))).toBe(true);
  });

  it("reprova conjunto acima do máximo quando maxFixtures é dado", () => {
    const problems = validateFixtures(validSet(12), CATALOG, { minFixtures: 1, maxFixtures: 10 });
    expect(problems.some((p) => p.includes("máximo 10"))).toBe(true);
  });

  it("detecta id duplicado", () => {
    const set = [...validSet(10), fixture({ id: "fx-1", query: "Outra consulta bem diferente?" })];
    const problems = validateFixtures(set, CATALOG);
    expect(problems.some((p) => p.includes("id duplicado: fx-1"))).toBe(true);
  });

  it("detecta query duplicada (case/espacos-insensível)", () => {
    const set = [
      ...validSet(10),
      fixture({ id: "fx-dup", query: "  consulta REALISTA de exemplo para fx-1?  " }),
    ];
    const problems = validateFixtures(set, CATALOG);
    expect(problems.some((p) => p.includes("[fx-dup] query duplicada"))).toBe(true);
  });

  it("detecta tool inexistente no catálogo (o sinal de rename)", () => {
    const set = [...validSet(9), fixture({ id: "fx-ren", expectedTools: ["srv_renomeada"] })];
    const problems = validateFixtures(set, CATALOG);
    expect(problems).toContain("[fx-ren] tool inexistente no catálogo: srv_renomeada");
  });

  it("detecta expectedTools vazio e duplicata dentro da fixture", () => {
    const set = [
      ...validSet(9),
      fixture({ id: "fx-vazio", expectedTools: [] }),
      fixture({ id: "fx-dup-tool", query: "Consulta distinta sobre duplicata?", expectedTools: ["srv_buscar", "srv_buscar"] }),
    ];
    const problems = validateFixtures(set, CATALOG);
    expect(problems.some((p) => p.includes("[fx-vazio] expectedTools vazio"))).toBe(true);
    expect(problems.some((p) => p.includes("[fx-dup-tool] expectedTools com duplicata"))).toBe(true);
  });

  it("reprova query curta e note vazia", () => {
    const set = [
      ...validSet(9),
      fixture({ id: "fx-curta", query: "Oi?" }),
      fixture({ id: "fx-sem-nota", query: "Consulta longa o suficiente sem nota?", note: "  " }),
    ];
    const problems = validateFixtures(set, CATALOG);
    expect(problems.some((p) => p.includes("[fx-curta] query curta demais"))).toBe(true);
    expect(problems.some((p) => p.includes("[fx-sem-nota] note vazia"))).toBe(true);
  });

  it("não exige note quando requireNote=false", () => {
    const set = validSet(10).map((f) => ({ ...f, note: "" }));
    expect(validateFixtures(set, CATALOG, { requireNote: false })).toEqual([]);
  });

  it("verifica cobertura mínima de áreas pela primeira expectedTool", () => {
    // Todas as fixtures apontam para tools da área "alfa" → só 1 área coberta.
    const problems = validateFixtures(validSet(10), CATALOG, { minAreas: 2 });
    expect(problems.some((p) => p.includes("cobertura de áreas insuficiente: 1 distintas (mínimo 2)"))).toBe(true);

    // Incluindo uma fixture da área "beta", a exigência é satisfeita.
    const set = [...validSet(9), fixture({ id: "fx-beta", expectedTools: ["srv_listar"] })];
    expect(validateFixtures(set, CATALOG, { minAreas: 2 })).toEqual([]);
  });
});
