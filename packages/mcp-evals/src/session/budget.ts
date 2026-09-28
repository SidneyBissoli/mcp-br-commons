/**
 * Teto de gasto da rodada — obrigatório.
 *
 * Soma o `usage` de CADA requisição (a do loop e a do juiz) e aborta a rodada ao
 * passar do teto. Checa ANTES de cada requisição também: uma sessão que já
 * estourou não manda mais nada. O aborto é uma exceção própria para o loop
 * distinguir "acabou o dinheiro" (registra `endedBy: budget` e para a rodada) de
 * "a API falhou" (dropout de infra) — os dois saem da agregação, mas por motivos
 * que o relatório tem de mostrar separados.
 */

import { costUSD } from "./pricing.js";
import { addUsage, emptyUsage, type UsageTotals } from "./types.js";

export class BudgetExceededError extends Error {
  constructor(
    public readonly spentUSD: number,
    public readonly limitUSD: number,
  ) {
    super(`teto de gasto atingido: US$ ${spentUSD.toFixed(4)} de US$ ${limitUSD.toFixed(2)}`);
    this.name = "BudgetExceededError";
  }
}

export class Budget {
  private spent = 0;
  readonly usageByModel = new Map<string, UsageTotals>();

  constructor(public readonly limitUSD: number) {
    if (!Number.isFinite(limitUSD) || limitUSD <= 0) {
      throw new RangeError(`teto de gasto inválido: ${String(limitUSD)} (EVAL_BUDGET_USD / --budget-usd, > 0)`);
    }
  }

  get spentUSD(): number {
    return this.spent;
  }

  get remainingUSD(): number {
    return Math.max(0, this.limitUSD - this.spent);
  }

  /** Lança se o teto já foi atingido — chamar antes de cada requisição. */
  assertAvailable(): void {
    if (this.spent >= this.limitUSD) throw new BudgetExceededError(this.spent, this.limitUSD);
  }

  /** Registra o uso de uma requisição; lança se ela cruzou o teto. Devolve o custo dela. */
  charge(model: string, usage: UsageTotals): number {
    const cost = costUSD(model, usage);
    this.spent += cost;
    const acc = this.usageByModel.get(model) ?? emptyUsage();
    addUsage(acc, usage);
    this.usageByModel.set(model, acc);
    if (this.spent > this.limitUSD) throw new BudgetExceededError(this.spent, this.limitUSD);
    return cost;
  }
}
