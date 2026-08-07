/**
 * Testes offline do núcleo de scoring puro (portados do harness do senado) + o gate
 * parametrizável, incluindo compatibilidade byte-a-byte das mensagens com o harness
 * original quando toolCount=67.
 */

import { describe, it, expect } from "vitest";
import {
  scoreItem,
  aggregate,
  scoreAll,
  evaluateGate,
  GATE_REMEDIATION_THRESHOLD,
  GATE_DEPRIORITIZE_THRESHOLD,
  type Prediction,
} from "../src/score.js";

const fx = (id: string, expectedTools: string[]) => ({ id, expectedTools });

describe("scoreItem", () => {
  it("marca acerto top-1 quando a primeira predição está em expectedTools", () => {
    const item = scoreItem(fx("a", ["tool_x"]), { id: "a", predictedTools: ["tool_x"] }, "area1");
    expect(item.top1).toBe(true);
    expect(item.hitRank).toBe(1);
  });

  it("aceita qualquer membro de um conjunto esperado multi-tool", () => {
    const item = scoreItem(fx("a", ["tool_x", "tool_y"]), { id: "a", predictedTools: ["tool_y"] }, "area1");
    expect(item.top1).toBe(true);
  });

  it("marca erro mas registra hitRank quando a tool certa vem depois na lista", () => {
    const item = scoreItem(fx("a", ["tool_x"]), { id: "a", predictedTools: ["wrong", "tool_x"] }, "area1");
    expect(item.top1).toBe(false);
    expect(item.hitRank).toBe(2);
  });

  it("registra hitRank null quando nenhuma predição acerta", () => {
    const item = scoreItem(fx("a", ["tool_x"]), { id: "a", predictedTools: ["wrong", "nope"] }, "area1");
    expect(item.top1).toBe(false);
    expect(item.hitRank).toBeNull();
  });

  it("trata predição ausente/vazia como erro", () => {
    const item = scoreItem(fx("a", ["tool_x"]), undefined, "area1");
    expect(item.top1).toBe(false);
    expect(item.hitRank).toBeNull();
    expect(item.predictedTools).toEqual([]);
  });
});

describe("aggregate", () => {
  it("computa acurácia top-1 (3/4 = 75%)", () => {
    const items = [
      scoreItem(fx("1", ["a"]), { id: "1", predictedTools: ["a"] }, "x"),
      scoreItem(fx("2", ["b"]), { id: "2", predictedTools: ["b"] }, "x"),
      scoreItem(fx("3", ["c"]), { id: "3", predictedTools: ["c"] }, "y"),
      scoreItem(fx("4", ["d"]), { id: "4", predictedTools: ["wrong"] }, "y"),
    ];
    const report = aggregate(items, 3);
    expect(report.total).toBe(4);
    expect(report.top1Correct).toBe(3);
    expect(report.top1Accuracy).toBeCloseTo(0.75, 5);
  });

  it("computa top-k como acerto-cumulativo-até-rank-k", () => {
    const items = [
      scoreItem(fx("1", ["a"]), { id: "1", predictedTools: ["a"] }, "x"), // hitRank 1
      scoreItem(fx("2", ["b"]), { id: "2", predictedTools: ["wrong", "b"] }, "x"), // hitRank 2
      scoreItem(fx("3", ["c"]), { id: "3", predictedTools: ["w", "w2", "c"] }, "x"), // hitRank 3
      scoreItem(fx("4", ["d"]), { id: "4", predictedTools: ["nope"] }, "x"), // erro
    ];
    const report = aggregate(items, 3);
    expect(report.topKAccuracy[1]).toBeCloseTo(0.25, 5);
    expect(report.topKAccuracy[2]).toBeCloseTo(0.5, 5);
    expect(report.topKAccuracy[3]).toBeCloseTo(0.75, 5);
  });

  it("quebra a acurácia por área, ordenada da pior para a melhor", () => {
    const items = [
      scoreItem(fx("1", ["a"]), { id: "1", predictedTools: ["a"] }, "alpha"),
      scoreItem(fx("2", ["b"]), { id: "2", predictedTools: ["wrong"] }, "alpha"),
      scoreItem(fx("3", ["c"]), { id: "3", predictedTools: ["c"] }, "beta"),
    ];
    const report = aggregate(items, 3);
    const alpha = report.byArea.find((a) => a.area === "alpha")!;
    const beta = report.byArea.find((a) => a.area === "beta")!;
    expect(alpha.top1Accuracy).toBeCloseTo(0.5, 5);
    expect(beta.top1Accuracy).toBeCloseTo(1.0, 5);
    expect(report.byArea[0]!.area).toBe("alpha");
  });

  it("conta attempted (predição não-vazia) separado de total", () => {
    const items = [
      scoreItem(fx("1", ["a"]), { id: "1", predictedTools: ["a"] }, "x"),
      scoreItem(fx("2", ["b"]), undefined, "x"),
    ];
    const report = aggregate(items, 3);
    expect(report.total).toBe(2);
    expect(report.attempted).toBe(1);
  });

  it("lida com conjunto vazio sem dividir por zero", () => {
    const report = aggregate([], 3);
    expect(report.top1Accuracy).toBe(0);
    expect(report.topKAccuracy[1]).toBe(0);
  });
});

describe("scoreAll", () => {
  it("junta fixtures com predições por id e pontua fim-a-fim", () => {
    const fixtures = [fx("1", ["a"]), fx("2", ["b"])];
    const predictions: Prediction[] = [
      { id: "1", predictedTools: ["a"] },
      { id: "2", predictedTools: ["wrong"] },
    ];
    const report = scoreAll(fixtures, predictions, () => "area", 3);
    expect(report.top1Accuracy).toBeCloseTo(0.5, 5);
  });
});

describe("evaluateGate", () => {
  it("recomenda remediação abaixo de 85% (padrão)", () => {
    expect(evaluateGate(0.84).decision).toBe("remediar");
  });

  it("despriorriza refatoração de catálogo em/acima de 90% (padrão)", () => {
    expect(evaluateGate(0.9).decision).toBe("despriorizar-refatoracao");
    expect(evaluateGate(0.97).decision).toBe("despriorizar-refatoracao");
  });

  it("sinaliza zona cinzenta entre 85% e 90% (padrão)", () => {
    expect(evaluateGate(0.87).decision).toBe("zona-cinzenta");
  });

  it("usa os limiares documentados, com fronteiras corretas", () => {
    expect(GATE_REMEDIATION_THRESHOLD).toBe(0.85);
    expect(GATE_DEPRIORITIZE_THRESHOLD).toBe(0.9);
    expect(evaluateGate(GATE_REMEDIATION_THRESHOLD).decision).toBe("zona-cinzenta");
    expect(evaluateGate(GATE_DEPRIORITIZE_THRESHOLD).decision).toBe("despriorizar-refatoracao");
  });

  it("aceita limiares customizados por servidor", () => {
    const opts = { remediationThreshold: 0.7, deprioritizeThreshold: 0.8 };
    expect(evaluateGate(0.69, opts).decision).toBe("remediar");
    expect(evaluateGate(0.75, opts).decision).toBe("zona-cinzenta");
    expect(evaluateGate(0.8, opts).decision).toBe("despriorizar-refatoracao");
    expect(evaluateGate(0.69, opts).message).toContain("(< 70%)");
    expect(evaluateGate(0.75, opts).message).toContain("(entre 70% e 80%)");
  });

  it("reproduz byte-a-byte as mensagens do harness do senado (toolCount=67)", () => {
    // Compatibilidade com senado-br-mcp-cloudflare/evals/score.ts — a adoção lá deve
    // trocar o import sem mudar nenhuma mensagem de gate.
    expect(evaluateGate(0.84, { toolCount: 67 }).message).toBe(
      "Acurácia top-1 = 84.0% (< 85%). Recomendação: abrir SESSÃO DE REMEDIAÇÃO (deferred loading / Code Mode / agrupamento por sessão).",
    );
    expect(evaluateGate(0.97, { toolCount: 67 }).message).toBe(
      "Acurácia top-1 = 97.0% (>= 90%) mesmo com 67 tools. Recomendação: DESPRIORIZAR refatoração de catálogo; seguir consolidando via enums.",
    );
    expect(evaluateGate(0.87, { toolCount: 67 }).message).toBe(
      "Acurácia top-1 = 87.0% (entre 85% e 90%). Zona cinzenta: manter sob observação; reavaliar após próxima mudança de tool/descrição.",
    );
  });

  it("omite o contexto de tamanho do catálogo quando toolCount não é dado", () => {
    const msg = evaluateGate(0.95).message;
    expect(msg).toContain("(>= 90%). Recomendação: DESPRIORIZAR");
    expect(msg).not.toContain("mesmo com");
  });
});
