/**
 * Projeções por modo do bloco de proveniência (decisão 5 da Fase 0).
 *
 * - `concise` (padrão): piso legal + citação mínima + diagnóstico de origem — fonte,
 *   URL canônica, vintage, data de extração, `retrieval`, citação/atribuição, licença.
 *   Sete chaves (v1.1), sempre presentes, `null` explícito quando desconhecido; na v1.2
 *   uma oitava, `field_sources`, presente SÓ quando a resposta funde sub-fontes; na v1.3
 *   `notices`, `derived`/`derivation_note` e `revision`, cada uma SÓ quando há o que dizer.
 * - `detailed`: bloco canônico completo do contrato, todas as chaves em ordem
 *   fixa, ausência = `null` explícito.
 *
 * A versão emitida é a que o bloco carrega (`contract_version`, posta pelo contexto).
 *
 * DETERMINISMO: os objetos são construídos literalmente em ordem fixa de chaves —
 * `JSON.stringify` preserva a ordem de inserção, logo a mesma consulta sobre a mesma
 * versão dos dados produz bloco byte-idêntico exceto pelos campos de timestamp
 * (`retrieved_at`, citação que embute data). Não reordenar campos: a ordem é contrato.
 */

import {
  contractAtLeast,
  type CanonicalProvenance,
  type ContractVersion,
  type FieldSource,
  type Retrieval,
  type Revision,
} from "./schema.js";

export type ProvenanceMode = "concise" | "detailed";

/** Sub-fonte como sai no fio; `served_from_cache` só a partir da v1.2. */
export interface RenderedFieldSource {
  fields: string[];
  source_url: string;
  dataset_id: string | null;
  data_vintage: string | null;
  retrieved_at: string | null;
  served_from_cache?: boolean | null;
}

/**
 * Projeção concise — chaves e ordem fazem parte do contrato (v1.1: `retrieval` após
 * `retrieved_at`; v1.2: `field_sources`, SÓ quando a resposta funde sub-fontes; v1.3:
 * `notices`, `derived` + `derivation_note` e `revision`, cada uma SÓ quando há o que dizer).
 */
export interface ConciseBlock {
  source: string;
  source_url: string;
  data_vintage: string | null;
  retrieved_at: string;
  retrieval: Retrieval | null;
  citation: string;
  license: string | null;
  field_sources?: RenderedFieldSource[];
  notices?: string[];
  derived?: true;
  derivation_note?: string;
  revision?: Revision;
}

/** Cópia literal de `revision`, em ordem fixa de chaves. */
function renderRevision(r: Revision): Revision {
  return { status: r.status, note: r.note };
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

/** Cópia literal de uma sub-fonte em ordem fixa; a v1.1 não leva `served_from_cache`. */
function renderFieldSource(fs: FieldSource, version: ContractVersion): RenderedFieldSource {
  const out: RenderedFieldSource = {
    fields: [...fs.fields],
    source_url: fs.source_url,
    dataset_id: fs.dataset_id,
    data_vintage: fs.data_vintage,
    retrieved_at: fs.retrieved_at,
  };
  if (version !== "1.1") out.served_from_cache = fs.served_from_cache;
  return out;
}

export function renderConcise(p: CanonicalProvenance): ConciseBlock {
  const block: ConciseBlock = {
    source: p.source.name,
    source_url: p.source_url,
    data_vintage: p.data_vintage,
    retrieved_at: p.retrieved_at,
    retrieval: renderRetrieval(p.retrieval),
    citation: p.citation,
    license: conciseLicense(p.license),
  };
  // Ausente (não null) quando não há fusão: a resposta comum fica byte-idêntica à v1.1 e
  // um cliente com o outputSchema antigo só estranha as tools que de fato misturam (§8).
  if (contractAtLeast(p.contract_version, "1.2") && p.field_sources && p.field_sources.length > 0) {
    block.field_sources = p.field_sources.map((fs) => renderFieldSource(fs, p.contract_version));
  }
  // v1.3, mesma regra: o que o canônico já tinha e o concise descartava passa a sair, mas
  // só quando há o que dizer — a resposta comum segue byte-idêntica à da 1.1.
  if (contractAtLeast(p.contract_version, "1.3")) {
    if (p.notices.length > 0) block.notices = [...p.notices];
    if (p.derived) {
      block.derived = true;
      // assertSemantics garante a nota quando derived=true.
      block.derivation_note = p.derivation_note!;
    }
    if (p.revision) block.revision = renderRevision(p.revision);
  }
  return block;
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
  field_sources: RenderedFieldSource[] | null;
  /** v1.3 em diante: sempre presente, `null` quando não se sabe. Antes da 1.3, ausente. */
  revision?: Revision | null;
}

export function renderDetailed(p: CanonicalProvenance): DetailedBlock {
  const block: DetailedBlock = {
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
    field_sources: p.field_sources ? p.field_sources.map((fs) => renderFieldSource(fs, p.contract_version)) : null,
  };
  if (contractAtLeast(p.contract_version, "1.3")) block.revision = p.revision ? renderRevision(p.revision) : null;
  return block;
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
