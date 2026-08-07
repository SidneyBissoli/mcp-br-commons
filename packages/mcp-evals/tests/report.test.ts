/**
 * Testes offline do formatador puro de relatório: exclusão de dropouts do score,
 * código de saída, dicas de remédio e marcação PRELIMINAR do gate.
 */

import { describe, it, expect } from "vitest";
import { formatReport, type FixtureError } from "../src/report.js";
import { scoreItem } from "../src/score.js";

const fx = (id: string, expectedTools: string[]) => ({ id, expectedTools });

const ITEMS = [
  scoreItem(fx("1", ["a"]), { id: "1", predictedTools: ["a"] }, "x"),
  scoreItem(fx("2", ["b"]), { id: "2", predictedTools: ["wrong"] }, "x"),
  scoreItem(fx("3", ["c"]), undefined, "y"),
];

describe("formatReport", () => {
  it("rodada completa: exit 0, gate autoritativo, erros listados como escolha errada", () => {
    const { lines, exitCode, report, gate } = formatReport(ITEMS, [], "modelo-teste");
    const text = lines.join("\n");
    expect(exitCode).toBe(0);
    expect(report.total).toBe(3);
    expect(report.top1Accuracy).toBeCloseTo(1 / 3, 5);
    expect(gate.decision).toBe("remediar");
    expect(text).toContain("Cobertura:          3/3 fixtures avaliadas");
    expect(text).toContain("Escolhas erradas");
    expect(text).toContain("[3] esperado [\"c\"] · obteve (nenhuma)");
    expect(text).not.toContain("PRELIMINAR");
  });

  it("dropout de infra: fixture sai do score, exit 2 e gate PRELIMINAR", () => {
    const errors: FixtureError[] = [{ id: "3", kind: "rate_limit", status: 429, message: "rate limited" }];
    const { lines, exitCode, report } = formatReport(ITEMS, errors, "modelo-teste");
    const text = lines.join("\n");
    expect(exitCode).toBe(2);
    // A fixture 3 não conta como erro de seleção: 1 acerto em 2 avaliadas.
    expect(report.total).toBe(2);
    expect(report.top1Accuracy).toBeCloseTo(0.5, 5);
    expect(text).toContain("2/3 fixtures avaliadas · 1 não avaliadas (falha de infra)");
    expect(text).toContain("RODADA INCOMPLETA — 1 fixtures não avaliadas (rate_limit×1)");
    expect(text).toContain("Dica: rate-limit.");
    expect(text).toContain("decisão: PRELIMINAR/");
    expect(text).toContain("Complete a cobertura (100%)");
  });

  it("falha fatal de billing traz o remédio de créditos", () => {
    const errors: FixtureError[] = [{ id: "3", kind: "billing", status: 400, message: "credit balance" }];
    const text = formatReport(ITEMS, errors, "m").lines.join("\n");
    expect(text).toContain("saldo de créditos insuficiente");
    expect(text).toContain("console.anthropic.com/settings/billing");
  });

  it("falha fatal de auth traz o remédio de chave", () => {
    const errors: FixtureError[] = [{ id: "3", kind: "auth", status: 401, message: "invalid key" }];
    const text = formatReport(ITEMS, errors, "m").lines.join("\n");
    expect(text).toContain("chave rejeitada (auth)");
    expect(text).toContain("ANTHROPIC_API_KEY");
  });

  it("propaga as opções de gate (limiar customizado)", () => {
    const { gate } = formatReport(
      [scoreItem(fx("1", ["a"]), { id: "1", predictedTools: ["a"] }, "x")],
      [],
      "m",
      { deprioritizeThreshold: 0.99, toolCount: 5 },
    );
    expect(gate.decision).toBe("despriorizar-refatoracao");
    expect(gate.message).toContain("mesmo com 5 tools");
  });
});
