/**
 * Tabela de preços (US$ por milhão de tokens) — a base do teto de gasto.
 *
 * Fonte: tabela de modelos do skill `claude-api` em 27/09/2026. Cache: escrita
 * (5 min) cobra 1,25× o preço de entrada; leitura cobra 0,1× — salvo quando o
 * modelo publica um preço de leitura próprio (`cacheReadPerMTok`).
 *
 * Modelo fora da tabela é ERRO, não estimativa: um preço inventado furaria o teto
 * em silêncio, e a rodada é paga de propósito.
 */

import type { UsageTotals } from "./types.js";

export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  /** Preço de leitura de cache quando o modelo não segue o 0,1× padrão. */
  cacheReadPerMTok?: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
  "claude-fable-5-1": { inputPerMTok: 10, outputPerMTok: 50, cacheReadPerMTok: 0.25 },
};

export const CACHE_WRITE_MULTIPLIER = 1.25;
export const CACHE_READ_MULTIPLIER = 0.1;

export function pricingFor(model: string): ModelPricing {
  const p = MODEL_PRICING[model];
  if (!p) {
    throw new Error(
      `sem preço para o modelo ${model} — acrescente em packages/mcp-evals/src/session/pricing.ts ` +
        `antes de rodar (o teto de gasto depende dele)`,
    );
  }
  return p;
}

/** Custo em US$ de um uso acumulado, com os multiplicadores de cache. */
export function costUSD(model: string, usage: UsageTotals): number {
  const p = pricingFor(model);
  const M = 1_000_000;
  const cacheRead = p.cacheReadPerMTok ?? p.inputPerMTok * CACHE_READ_MULTIPLIER;
  return (
    (usage.inputTokens * p.inputPerMTok) / M +
    (usage.cacheCreationInputTokens * p.inputPerMTok * CACHE_WRITE_MULTIPLIER) / M +
    (usage.cacheReadInputTokens * cacheRead) / M +
    (usage.outputTokens * p.outputPerMTok) / M
  );
}
