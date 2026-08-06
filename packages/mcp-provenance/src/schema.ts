/**
 * Modelo canônico de proveniência — contrato v1.0 do portfólio.
 *
 * Generalização de duas linhagens em produção/rascunho:
 *  - envelope nível-1 do senado-br-mcp-cloudflare (`src/utils/provenance.ts`) — vira a
 *    projeção `concise`;
 *  - bloco canônico v0.1 do ilostat (`docs/03-contrato-proveniencia.md`) — vira a
 *    projeção `detailed`.
 *
 * O servidor constrói UM modelo canônico por fonte (validado aqui, server-side); a
 * projeção por modo acontece em `render.ts`. Regra de segregação: um bloco refere-se a
 * exatamente UMA fonte — resposta multi-fonte carrega um bloco por fonte, e os dados de
 * cada fonte ficam em estruturas separadas apontando para seu bloco (não contaminar
 * licenças distintas, ex.: CC BY vs. CC BY-SA).
 */

import { z } from "zod";

/** Versão do contrato de proveniência implementado por esta lib. */
export const CONTRACT_VERSION = "1.0";

const nullableString = z.string().min(1).nullable().default(null);

/** Identidade da fonte. `name` é o nome humano oficial; os demais refinam quando existem. */
export const SourceSchema = z.object({
  name: z.string().min(1).describe('Nome oficial da fonte (ex.: "Senado Federal — Dados Abertos (Legislativo)")'),
  agency: nullableString.describe('Órgão/agência (ex.: "ILO", "Senado Federal")'),
  database: nullableString.describe('Base/sistema dentro do órgão (ex.: "ILOSTAT")'),
  endpoint: nullableString.describe("Endpoint-base efetivamente consultado"),
});

/** Identidade do conjunto de dados dentro da fonte (dataflow SDMX, tabela, série…). */
export const DatasetSchema = z.object({
  id: nullableString.describe("Identificador do conjunto (dataflow, código da matéria, série, tabela)"),
  version: nullableString.describe("Versão do conjunto reportada pela fonte"),
  name: nullableString.describe("Nome humano do conjunto, do metadado da fonte"),
});

/** Regime legal do dado. Ao menos `id` ou `name` deve estar presente (piso legal). */
export const LicenseSchema = z
  .object({
    id: nullableString.describe('Identificador SPDX-like (ex.: "CC-BY-4.0")'),
    name: nullableString.describe("Nome/descrição da licença quando não há identificador formal"),
    url: nullableString.describe("URL do texto da licença"),
    terms_url: nullableString.describe("URL dos termos de uso da fonte"),
    verified_at: nullableString.describe("Data (ISO-8601) da última verificação verbatim da licença"),
  })
  .refine((l) => l.id !== null || l.name !== null, {
    message: "license exige ao menos `id` ou `name` (piso legal do contrato)",
  });

/** Sub-fonte por campo — para respostas que fundem recortes/endpoints numa única estrutura. */
export const FieldSourceSchema = z.object({
  fields: z.array(z.string().min(1)).min(1).describe("Campos do payload atribuídos a esta sub-fonte"),
  source_url: z.string().min(1).describe("URL canônica da sub-fonte que originou estes campos"),
  dataset_id: nullableString.describe("Identificador do conjunto da sub-fonte"),
  data_vintage: nullableString.describe("Vintage/competência da sub-fonte"),
  retrieved_at: nullableString.describe("ISO-8601 da extração desta sub-fonte no upstream"),
});

export type FieldSource = z.infer<typeof FieldSourceSchema>;

/**
 * Modelo canônico completo (pós-validação). `retrieved_at` deve ser o instante real da
 * extração no upstream — preservado pela camada de cache do servidor —, nunca o momento
 * do build/deploy; respostas servidas de cache mantêm o `retrieved_at` do fetch original
 * (é a data de extração juridicamente relevante) e podem marcar `served_from_cache`.
 */
export const CanonicalProvenanceSchema = z.object({
  contract_version: z.literal(CONTRACT_VERSION).default(CONTRACT_VERSION),
  source: SourceSchema,
  dataset: DatasetSchema.default({ id: null, version: null, name: null }),
  dimension_key: z
    .record(z.string(), z.string())
    .nullable()
    .default(null)
    .describe("Chave dimensional da consulta (ordem = ordem das dimensões na fonte), quando aplicável"),
  data_vintage: nullableString.describe("Vintage/competência do dado segundo a fonte; null se a fonte não expõe"),
  retrieved_at: z.string().min(1).describe("ISO-8601 do momento da extração no upstream (não do build/deploy)"),
  source_url: z.string().min(1).describe("URL canônica que reproduz a consulta na fonte"),
  api_version: nullableString.describe("Versão do endpoint upstream, se exposta"),
  license: LicenseSchema,
  citation: z.string().min(1).describe("String de citação/atribuição pronta para uso (texto humano)"),
  notices: z
    .array(z.string().min(1))
    .default([])
    .describe("Disclaimers/avisos que acompanham o dado na origem, reproduzidos verbatim; [] se não houver"),
  derived: z.boolean().default(false).describe("true se o servidor transformou além de filtrar/paginar/reserializar"),
  derivation_note: nullableString.describe("Obrigatório se derived=true: o que foi feito"),
  served_from_cache: z
    .boolean()
    .nullable()
    .default(null)
    .describe("true/false quando o servidor distingue cache de fetch; null quando não distingue"),
  field_sources: z
    .array(FieldSourceSchema)
    .nullable()
    .default(null)
    .describe("Proveniência por-campo: presente só quando a resposta funde múltiplos recortes upstream"),
});

export type CanonicalProvenance = z.infer<typeof CanonicalProvenanceSchema>;

/** Entrada aceita pelos builders: atalhos de string para source/dataset/license. */
export interface ProvenanceInput {
  source: string | z.input<typeof SourceSchema>;
  source_url: string;
  citation: string;
  license: string | z.input<typeof LicenseSchema>;
  dataset?: string | z.input<typeof DatasetSchema> | null;
  dimension_key?: Record<string, string> | null;
  data_vintage?: string | null;
  /** Default: instante da chamada — aceitável só para catálogos estáticos sem extração upstream. */
  retrieved_at?: string | Date;
  api_version?: string | null;
  notices?: string[];
  derived?: boolean;
  derivation_note?: string | null;
  served_from_cache?: boolean | null;
  field_sources?: Array<{
    fields: string[];
    source_url: string;
    dataset_id?: string | null;
    data_vintage?: string | null;
    retrieved_at?: string | null;
  }> | null;
}

/** Erro de contrato: builder recebeu entrada que viola o schema ou as regras semânticas. */
export class ProvenanceContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvenanceContractError";
  }
}

/**
 * Expande os atalhos de string da entrada para os objetos canônicos. `retrievedAtIso` é
 * o instante já normalizado para o fuso do contexto (a normalização vive no builder,
 * que conhece o `TimezoneSpec`).
 */
export function expandInput(
  input: ProvenanceInput,
  retrievedAtIso: string,
): z.input<typeof CanonicalProvenanceSchema> {
  const source = typeof input.source === "string" ? { name: input.source } : input.source;
  const license = typeof input.license === "string" ? { name: input.license } : input.license;
  const dataset =
    input.dataset == null ? undefined : typeof input.dataset === "string" ? { id: input.dataset } : input.dataset;
  const { source: _s, license: _l, dataset: _d, retrieved_at: _r, ...rest } = input;
  return {
    ...rest,
    source,
    license,
    ...(dataset !== undefined ? { dataset } : {}),
    retrieved_at: retrievedAtIso,
  };
}

/** Regras semânticas que o zod não cobre por campo isolado. */
export function assertSemantics(p: CanonicalProvenance): void {
  if (p.derived && p.derivation_note === null) {
    throw new ProvenanceContractError("derived=true exige derivation_note não-nulo (§4 do contrato)");
  }
}
