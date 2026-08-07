/**
 * Contrato de fixtures + validação offline.
 *
 * Cada projeto do portfólio mantém seu próprio conjunto de fixtures (consultas realistas
 * na persona do usuário-alvo, com as tools aceitáveis para o PRIMEIRO passo da resposta).
 * `validateFixtures` codifica os invariantes que no senado viviam num teste ad-hoc:
 * o teste de fixtures de cada projeto vira uma asserção única de lista vazia.
 */

import type { Catalog } from "./catalog.js";

export interface EvalFixture {
  id: string;
  /** Consulta realista, no idioma e na persona do servidor. */
  query: string;
  /** Tools aceitáveis como primeiro passo. Predição correta = qualquer membro do conjunto. */
  expectedTools: string[];
  /** Por que essas tools (e não as vizinhas) são a resposta certa. */
  note: string;
}

export interface FixtureValidationOptions {
  /** Mínimo de fixtures no conjunto. Padrão: 10. */
  minFixtures?: number;
  /** Máximo de fixtures (evita conjunto inchado/caro). Padrão: sem teto. */
  maxFixtures?: number;
  /** Comprimento mínimo da query. Padrão: 10. */
  minQueryLength?: number;
  /** Exigir `note` não-vazia em toda fixture. Padrão: true. */
  requireNote?: boolean;
  /**
   * Mínimo de áreas funcionais distintas cobertas (área da primeira expectedTool).
   * Padrão: 0 (sem exigência).
   */
  minAreas?: number;
}

/**
 * Valida um conjunto de fixtures contra o catálogo vivo. Retorna a lista de problemas
 * encontrados (vazia = válido) — cada string é autoexplicativa para o log do teste.
 * O invariante central: toda tool em `expectedTools` deve existir no catálogo, para que
 * um rename de tool quebre o teste offline imediatamente.
 */
export function validateFixtures(
  fixtures: EvalFixture[],
  catalog: Catalog,
  options: FixtureValidationOptions = {},
): string[] {
  const {
    minFixtures = 10,
    maxFixtures,
    minQueryLength = 10,
    requireNote = true,
    minAreas = 0,
  } = options;

  const problems: string[] = [];

  if (fixtures.length < minFixtures) {
    problems.push(`conjunto tem ${fixtures.length} fixtures (mínimo ${minFixtures})`);
  }
  if (maxFixtures !== undefined && fixtures.length > maxFixtures) {
    problems.push(`conjunto tem ${fixtures.length} fixtures (máximo ${maxFixtures})`);
  }

  const seenIds = new Set<string>();
  const seenQueries = new Set<string>();
  for (const f of fixtures) {
    if (!f.id) {
      problems.push(`fixture sem id (query: ${JSON.stringify(f.query.slice(0, 40))})`);
    } else if (seenIds.has(f.id)) {
      problems.push(`id duplicado: ${f.id}`);
    } else {
      seenIds.add(f.id);
    }

    const normQuery = f.query.trim().toLowerCase();
    if (seenQueries.has(normQuery)) {
      problems.push(`[${f.id}] query duplicada`);
    } else {
      seenQueries.add(normQuery);
    }

    if (f.query.trim().length < minQueryLength) {
      problems.push(`[${f.id}] query curta demais (< ${minQueryLength} caracteres)`);
    }
    if (requireNote && (!f.note || f.note.trim().length === 0)) {
      problems.push(`[${f.id}] note vazia`);
    }

    if (!Array.isArray(f.expectedTools) || f.expectedTools.length === 0) {
      problems.push(`[${f.id}] expectedTools vazio`);
      continue;
    }
    if (new Set(f.expectedTools).size !== f.expectedTools.length) {
      problems.push(`[${f.id}] expectedTools com duplicata`);
    }
    for (const tool of f.expectedTools) {
      if (!catalog.toolNames.has(tool)) {
        problems.push(`[${f.id}] tool inexistente no catálogo: ${tool}`);
      }
    }
  }

  if (minAreas > 0) {
    const areas = new Set<string>();
    for (const f of fixtures) {
      const first = f.expectedTools[0];
      if (first === undefined) continue;
      const area = catalog.areaByName.get(first);
      if (area) areas.add(area);
    }
    if (areas.size < minAreas) {
      problems.push(`cobertura de áreas insuficiente: ${areas.size} distintas (mínimo ${minAreas})`);
    }
  }

  return problems;
}
