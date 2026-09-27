import { describe, expect, it } from "vitest";
import { Budget, BudgetExceededError } from "../../src/session/budget.js";
import { costUSD, pricingFor } from "../../src/session/pricing.js";
import { emptyUsage } from "../../src/session/types.js";

describe("pricing", () => {
  it("cobra entrada, escrita de cache ×1,25, leitura ×0,1 e saída", () => {
    const u = { ...emptyUsage(), inputTokens: 1_000_000, cacheCreationInputTokens: 1_000_000, cacheReadInputTokens: 1_000_000, outputTokens: 1_000_000 };
    // opus-5: 5 + 6,25 + 0,5 + 25
    expect(costUSD("claude-opus-5", u)).toBeCloseTo(36.75, 6);
    // sonnet-5: 2 + 2,5 + 0,2 + 10
    expect(costUSD("claude-sonnet-5", u)).toBeCloseTo(14.7, 6);
    // fable-5-1 tem leitura de cache própria (0,25): 10 + 12,5 + 0,25 + 50
    expect(costUSD("claude-fable-5-1", u)).toBeCloseTo(72.75, 6);
  });
  it("modelo fora da tabela é erro, não estimativa", () => {
    expect(() => pricingFor("claude-opus-4-5")).toThrow(/sem preço/);
  });
});

describe("Budget", () => {
  it("acumula, expõe restante e aborta ao cruzar o teto", () => {
    const b = new Budget(1);
    const half = { ...emptyUsage(), inputTokens: 100_000, requests: 1 }; // opus-5: 0,50
    expect(b.charge("claude-opus-5", half)).toBeCloseTo(0.5, 6);
    expect(b.remainingUSD).toBeCloseTo(0.5, 6);
    b.assertAvailable();
    expect(() => b.charge("claude-opus-5", { ...half, inputTokens: 200_000 })).toThrow(BudgetExceededError);
    expect(() => b.assertAvailable()).toThrow(BudgetExceededError);
    expect(b.usageByModel.get("claude-opus-5")?.requests).toBe(2);
  });
  it("teto inválido falha na construção", () => {
    expect(() => new Budget(0)).toThrow(RangeError);
    expect(() => new Budget(NaN)).toThrow(RangeError);
  });
});
