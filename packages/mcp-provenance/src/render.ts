/**
 * Projeções por modo do bloco de proveniência (decisão 5 da Fase 0).
 *
 * - `concise` (padrão): piso legal + citação mínima + diagnóstico de origem — fonte,
 *   URL canônica, vintage, data de extração, `retrieval`, citação/atribuição, licença.
 *   Sete chaves (v1.1), sempre presentes, `null` explícito quando desconhecido.
 * - `detailed`: bloco canônico completo do contrato v1.1, todas as chaves em ordem
 *   fixa, ausência = `null` explícito.
 *
 * DETERMINISMO: os objetos são construídos literalmente em ordem fixa de chaves —
 * `JSON.stringify` preserva a ordem de inserção, logo a mesma consulta sobre a mesma
 * versão dos dados produz bloco byte-idêntico exceto pelos campos de timestamp
 * (`retrieved_at`, citação que embute data). Não reordenar campos: a ordem é contrato.
 */

import type { CanonicalProvenance, FieldSource, Retrieval } from "./schema.js";

export type ProvenanceMode = "concise" | "detailed";

/** Projeção concise — chaves e ordem fazem parte do contrato (v1.1: `retrieval` após `retrieved_at`). */
export interface ConciseBlock {
  source: string;
  source_url: string;
  data_vintage: string | null;
  retrieved_at: string;
  retrieval: Retrieval | null;
  citation: string;
  license: string | null;
}

/** Cópia literal do bloco `retrieval`, em ordem fixa de chaves (determinismo). */
function renderRetrieval(r: Retrieval | null): Retrieval | null {
  if (r === null) return null;
  return {
    requests: r.requests,
    attempts: r.attempts,
    anomalies: r.anomalies.map((a) => ({ kind: a.kind, count: a.count })),
    unstable: r.unstable,
  };
}

/** Rótulo curto da licença para o modo concise: `id` quando há, senão `name`. */
export function conciseLicense(license: CanonicalProvenance["license"]): string | null {
  return license.id ?? license.name;
}

export function renderConcise(p: CanonicalProvenance): ConciseBlock {
  return {
    source: p.source.name,
    source_url: p.source_url,
    data_vintage: p.data_vintage,
    retrieved_at: p.retrieved_at,
    retrieval: renderRetrieval(p.retrieval),
    citation: p.citation,
    license: conciseLicense(p.license),
  };
}

/** Projeção detailed — o bloco canônico completo, ordem fixa, nulls explícitos. */
export interface DetailedBlock {
  contract_version: string;
  source: { name: string; agency: string | null; database: string | null; endpoint: string | null };
  dataset: { id: string | null; version: string | null; name: string | null };
  dimension_key: Record<string, string> | null;
  data_vintage: string | null;
  retrieved_at: string;
  source_url: string;
  api_version: string | null;
  license: {
    id: string | null;
    name: string | null;
    url: string | null;
    terms_url: string | null;
    verified_at: string | null;
  };
  citation: string;
  notices: string[];
  derived: boolean;
  derivation_note: string | null;
  served_from_cache: boolean | null;
  retrieval: Retrieval | null;
  field_sources: FieldSource[] | null;
}

export function renderDetailed(p: CanonicalProvenance): DetailedBlock {
  return {
    contract_version: p.contract_version,
    source: {
      name: p.source.name,
      agency: p.source.agency,
      database: p.source.database,
      endpoint: p.source.endpoint,
    },
    dataset: { id: p.dataset.id, version: p.dataset.version, name: p.dataset.name },
    dimension_key: p.dimension_key,
    data_vintage: p.data_vintage,
    retrieved_at: p.retrieved_at,
    source_url: p.source_url,
    api_version: p.api_version,
    license: {
      id: p.license.id,
      name: p.license.name,
      url: p.license.url,
      terms_url: p.license.terms_url,
      verified_at: p.license.verified_at,
    },
    citation: p.citation,
    notices: [...p.notices],
    derived: p.derived,
    derivation_note: p.derivation_note,
    served_from_cache: p.served_from_cache,
    retrieval: renderRetrieval(p.retrieval),
    field_sources: p.field_sources
      ? p.field_sources.map((fs) => ({
          fields: [...fs.fields],
          source_url: fs.source_url,
          dataset_id: fs.dataset_id,
          data_vintage: fs.data_vintage,
          retrieved_at: fs.retrieved_at,
        }))
      : null,
  };
}

export function renderProvenance(p: CanonicalProvenance, mode: ProvenanceMode): ConciseBlock | DetailedBlock {
  return mode === "concise" ? renderConcise(p) : renderDetailed(p);
}

/**
 * Lista canônica de fontes no formato da RFC `attribution` do MCP
 * (modelcontextprotocol#711): todas as `source_url` distintas da resposta, incluindo
 * as de `field_sources`, na ordem de primeira aparição.
 */
export function attributionList(blocks: CanonicalProvenance[]): string[] {
  const urls: string[] = [];
  for (const p of blocks) {
    urls.push(p.source_url, ...(p.field_sources?.map((fs) => fs.source_url) ?? []));
  }
  return [...new Set(urls)];
}
