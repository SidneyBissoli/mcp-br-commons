/**
 * Núcleo de scoring puro do eval de seleção de tool. Sem rede, sem modelo, sem I/O.
 *
 * O runner produz, por fixture, a lista ordenada de tools que o modelo chamaria (mais
 * provável primeiro). Este módulo transforma essas predições + os `expectedTools` das
 * fixtures em números de acurácia: top-1, top-k e por área. São estas funções que os
 * testes offline exercitam com dados sintéticos de acurácia conhecida.
 */

import type { EvalFixture } from "./fixtures.js";

/** Predição do modelo para uma fixture: nomes de tool em ordem de prioridade. */
export interface Prediction {
  id: string;
  /** Candidatas em ordem (mais provável primeiro). Vazio se o modelo não chamou tool. */
  predictedTools: string[];
}

export interface ScoredItem {
  id: string;
  area: string;
  expectedTools: string[];
  predictedTools: string[];
  /** True se a predição top-1 está em expectedTools. */
  top1: boolean;
  /** Rank (1-based) da primeira predição correta, ou null se nenhuma acertou. */
  hitRank: number | null;
}

export interface AreaAccuracy {
  area: string;
  total: number;
  top1Correct: number;
  top1Accuracy: number;
}

export interface ScoreReport {
  total: number;
  /** Fixtures com ao menos uma predição (o modelo tentou chamar uma tool). */
  attempted: number;
  top1Correct: number;
  top1Accuracy: number;
  /** topKAccuracy[k] = fração cujo primeiro acerto tem rank <= k, para k em 1..maxK. */
  topKAccuracy: Record<number, number>;
  byArea: AreaAccuracy[];
  items: ScoredItem[];
}

/** Pontua uma fixture contra sua predição. `area` vem do catálogo, via chamador. */
export function scoreItem(
  fixture: Pick<EvalFixture, "id" | "expectedTools">,
  prediction: Prediction | undefined,
  area: string,
): ScoredItem {
  const predicted = prediction?.predictedTools ?? [];
  const expected = new Set(fixture.expectedTools);
  let hitRank: number | null = null;
  for (const [i, name] of predicted.entries()) {
    if (expected.has(name)) {
      hitRank = i + 1;
      break;
    }
  }
  const first = predicted[0];
  return {
    id: fixture.id,
    area,
    expectedTools: fixture.expectedTools,
    predictedTools: predicted,
    top1: first !== undefined && expected.has(first),
    hitRank,
  };
}

/**
 * Agrega itens pontuados num relatório.
 *
 * @param maxK maior k para o cálculo de acurácia top-k (padrão 3).
 */
export function aggregate(items: ScoredItem[], maxK = 3): ScoreReport {
  const total = items.length;
  const attempted = items.filter((it) => it.predictedTools.length > 0).length;
  const top1Correct = items.filter((it) => it.top1).length;

  const topKAccuracy: Record<number, number> = {};
  for (let k = 1; k <= maxK; k++) {
    const hits = items.filter((it) => it.hitRank !== null && it.hitRank <= k).length;
    topKAccuracy[k] = total === 0 ? 0 : hits / total;
  }

  const areas = new Map<string, { total: number; correct: number }>();
  for (const it of items) {
    const a = areas.get(it.area) ?? { total: 0, correct: 0 };
    a.total += 1;
    if (it.top1) a.correct += 1;
    areas.set(it.area, a);
  }
  const byArea: AreaAccuracy[] = [...areas.entries()]
    .map(([area, v]) => ({
      area,
      total: v.total,
      top1Correct: v.correct,
      top1Accuracy: v.total === 0 ? 0 : v.correct / v.total,
    }))
    .sort((x, y) => x.top1Accuracy - y.top1Accuracy || x.area.localeCompare(y.area));

  return {
    total,
    attempted,
    top1Correct,
    top1Accuracy: total === 0 ? 0 : top1Correct / total,
    topKAccuracy,
    byArea,
    items,
  };
}

/** Conveniência: pontua um lote inteiro dado fixtures, predições e lookup de área. */
export function scoreAll(
  fixtures: Pick<EvalFixture, "id" | "expectedTools">[],
  predictions: Prediction[],
  areaByExpectedTool: (fixture: Pick<EvalFixture, "id" | "expectedTools">) => string,
  maxK = 3,
): ScoreReport {
  const predById = new Map(predictions.map((p) => [p.id, p]));
  const items = fixtures.map((f) => scoreItem(f, predById.get(f.id), areaByExpectedTool(f)));
  return aggregate(items, maxK);
}

// --- Lógica de gate -------------------------------------------------------

export type GateDecision = "remediar" | "despriorizar-refatoracao" | "zona-cinzenta";

export interface GateResult {
  decision: GateDecision;
  accuracy: number;
  /** Recomendação legível em pt-BR. */
  message: string;
}

export interface GateOptions {
  /** Abaixo deste valor → `remediar`. Padrão: 0.85. */
  remediationThreshold?: number;
  /** Neste valor ou acima → `despriorizar-refatoracao`. Padrão: 0.9. */
  deprioritizeThreshold?: number;
  /**
   * Tamanho do catálogo, se informado citado na mensagem de despriorização
   * ("mesmo com N tools") — dá contexto ao número de acurácia.
   */
  toolCount?: number;
}

export const GATE_REMEDIATION_THRESHOLD = 0.85;
export const GATE_DEPRIORITIZE_THRESHOLD = 0.9;

/** Formata um limiar (fração) como percentual sem decimais espúrios: 0.85 → "85". */
function thresholdPct(fraction: number): string {
  return String(Math.round(fraction * 100 * 1e6) / 1e6);
}

/**
 * Aplica o gate de seleção de tool a uma acurácia top-1:
 *   < remediationThreshold  → abrir sessão de remediação (deferred loading / Code Mode /
 *                             agrupamento por sessão).
 *   >= deprioritizeThreshold → despriorizar refatoração de catálogo (seguir só
 *                             consolidando via enums).
 *   entre os dois → zona cinzenta (manter sob observação).
 */
export function evaluateGate(top1Accuracy: number, options: GateOptions = {}): GateResult {
  const {
    remediationThreshold = GATE_REMEDIATION_THRESHOLD,
    deprioritizeThreshold = GATE_DEPRIORITIZE_THRESHOLD,
    toolCount,
  } = options;
  const pct = (top1Accuracy * 100).toFixed(1);
  const remPct = thresholdPct(remediationThreshold);
  const depPct = thresholdPct(deprioritizeThreshold);

  if (top1Accuracy < remediationThreshold) {
    return {
      decision: "remediar",
      accuracy: top1Accuracy,
      message: `Acurácia top-1 = ${pct}% (< ${remPct}%). Recomendação: abrir SESSÃO DE REMEDIAÇÃO (deferred loading / Code Mode / agrupamento por sessão).`,
    };
  }
  if (top1Accuracy >= deprioritizeThreshold) {
    const context = toolCount !== undefined ? ` mesmo com ${toolCount} tools` : "";
    return {
      decision: "despriorizar-refatoracao",
      accuracy: top1Accuracy,
      message: `Acurácia top-1 = ${pct}% (>= ${depPct}%)${context}. Recomendação: DESPRIORIZAR refatoração de catálogo; seguir consolidando via enums.`,
    };
  }
  return {
    decision: "zona-cinzenta",
    accuracy: top1Accuracy,
    message: `Acurácia top-1 = ${pct}% (entre ${remPct}% e ${depPct}%). Zona cinzenta: manter sob observação; reavaliar após próxima mudança de tool/descrição.`,
  };
}
