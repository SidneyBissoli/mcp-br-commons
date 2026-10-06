/**
 * JSON Schema das PROJEÇÕES do bloco (concise/detailed) — para o `outputSchema` das tools.
 *
 * Por que existe (26/09/2026): até a 0.1.x o pacote publicava só o modelo canônico em
 * zod, e cada servidor transcrevia a projeção `concise` à mão no seu `outputSchema`
 * (bcb `PROVENANCE_BLOCK_SCHEMA`, sih `output-schemas.ts`, ibge `provenanceBlockSchema`,
 * medical `evals/catalog.ts`), quase sempre com `additionalProperties: false`. O SDK do
 * MCP valida `structuredContent` contra o `outputSchema` em runtime, então uma chave
 * nova no contrato (v1.1: `retrieval`) derruba TODA chamada do servidor que subiu o
 * pacote sem reescrever a transcrição — medido nos sete servidores contra a 0.2.0:
 * bcb 44 falhas, ibge 48, sih 39, medical 64, todas "must NOT have additional
 * properties". A defesa na camada certa é o contrato publicar a forma que ele mesmo
 * emite. Servidor que importa daqui sobe de contrato junto com o pacote.
 *
 * Escritos à mão (não derivados de zod) para serem determinísticos e servidos verbatim;
 * os testes prendem que `properties`/`required` batem com o que `render*` emite e com os
 * schemas zod ao lado. `description` fala com o agente, em pt-BR como o resto do contrato.
 */

import { z } from "zod";
import { CONTRACT_VERSIONS, RetrievalAnomalyKindSchema } from "./schema.js";

/** Tipo mínimo de JSON Schema que estes objetos satisfazem (evita depender de tipos externos). */
export type JsonSchemaObject = {
  type: "object";
  description?: string;
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
};

const str = (description: string) => ({ type: "string" as const, description });
const strOrNull = (description: string) => ({ type: ["string", "null"] as const, description });

/** Bloco `retrieval` (v1.1), sem o `null` externo — quem embute decide o nullable. */
export const RETRIEVAL_OBJECT_JSON_SCHEMA = {
  type: "object" as const,
  description:
    "Diagnóstico de origem da chamada: como o dado foi obtido. Medição real do servidor; " +
    "unstable=true pede ao agente que trate o dado como obtido com dificuldade",
  properties: {
    requests: {
      type: "integer" as const,
      minimum: 1,
      description: "Idas distintas à origem que compõem esta resposta (fatias, páginas)",
    },
    attempts: {
      type: "integer" as const,
      minimum: 1,
      description: "Tentativas somadas, incluindo as repetidas (>= requests)",
    },
    anomalies: {
      type: "array" as const,
      description: "Anomalias superadas até o sucesso, somadas por classe, em ordem fixa; [] se nenhuma",
      items: {
        type: "object" as const,
        properties: {
          kind: {
            type: "string" as const,
            enum: [...RetrievalAnomalyKindSchema.options],
            description: "Classe da anomalia (vocabulário fechado do contrato)",
          },
          count: { type: "integer" as const, minimum: 1, description: "Ocorrências desta classe na chamada" },
        },
        required: ["kind", "count"],
        additionalProperties: false as const,
      },
    },
    unstable: {
      type: "boolean" as const,
      description: "true se houve repetição (attempts > requests) ou alguma anomalia",
    },
  },
  required: ["requests", "attempts", "anomalies", "unstable"],
  additionalProperties: false as const,
} satisfies JsonSchemaObject;

/** `retrieval` como aparece nos blocos: o objeto acima OU null (servidor que não mede). */
export const RETRIEVAL_JSON_SCHEMA = {
  oneOf: [RETRIEVAL_OBJECT_JSON_SCHEMA, { type: "null" as const }],
  description: RETRIEVAL_OBJECT_JSON_SCHEMA.description + "; null quando o servidor não mede",
};

/**
 * Sub-fonte de `field_sources`. `served_from_cache` (v1.2) é declarada mas NÃO exigida:
 * o mesmo schema aceita o item da v1.1 (sem ela) e o da v1.2 (com ela).
 */
export const FIELD_SOURCE_JSON_SCHEMA = {
  type: "object" as const,
  description: "Proveniência de um grupo de campos da resposta: de onde veio e quando foi extraído",
  properties: {
    fields: {
      type: "array" as const,
      items: { type: "string" as const },
      minItems: 1,
      description: "Campos do payload atribuídos a esta sub-fonte",
    },
    source_url: str("URL canônica da sub-fonte que originou estes campos"),
    dataset_id: strOrNull("Identificador do conjunto da sub-fonte"),
    data_vintage: strOrNull("Vintage/competência da sub-fonte"),
    retrieved_at: strOrNull("ISO-8601 da extração desta sub-fonte na origem"),
    served_from_cache: {
      type: ["boolean", "null"] as const,
      description:
        "true se esta sub-fonte veio do cache do servidor (retrieved_at é o da extração original); " +
        "false se foi buscada nesta chamada; null se o servidor não distingue",
    },
  },
  required: ["fields", "source_url", "dataset_id", "data_vintage", "retrieved_at"],
  additionalProperties: false as const,
} satisfies JsonSchemaObject;

/**
 * Projeção `concise`: 7 chaves obrigatórias em ordem fixa (v1.1) e, na v1.2, a oitava
 * `field_sources`, OPCIONAL — ausente quando a resposta não funde sub-fontes, de modo
 * que o mesmo schema aceita o fio da v1.1 e o da v1.2. `additionalProperties: false`.
 * É o que `renderConcise` emite em `structuredContent.provenance` e no espelho `_meta`.
 */
export const CONCISE_BLOCK_JSON_SCHEMA = {
  type: "object" as const,
  description:
    "Bloco de proveniência (contrato v1.2): fonte, URL, competência, extração, diagnóstico de origem, " +
    "citação e licença; e, só quando a resposta junta partes de origens ou momentos distintos, de onde veio cada parte",
  properties: {
    source: str("Fonte oficial do dado"),
    source_url: str("URL canônica que reproduz a consulta na fonte"),
    data_vintage: strOrNull("Competência/vintage do dado segundo a fonte; null quando a fonte não expõe"),
    retrieved_at: str(
      "Instante REAL da extração na origem (ISO-8601, fuso do servidor). Resposta servida de cache " +
        "mantém o instante do fetch original, que é a data de extração relevante. Quando a resposta " +
        "junta partes extraídas em momentos distintos, é o MAIS ANTIGO deles (field_sources diz cada um)",
    ),
    retrieval: RETRIEVAL_JSON_SCHEMA,
    citation: str("Citação/atribuição pronta para uso"),
    license: strOrNull("Regime legal do dado (id SPDX quando há, senão o nome da licença)"),
    field_sources: {
      type: "array" as const,
      items: FIELD_SOURCE_JSON_SCHEMA,
      minItems: 1,
      description:
        "Presente só quando a resposta junta partes de origens ou momentos distintos: para cada grupo de " +
        "campos, a URL, a extração e se veio do cache. Ausente nas respostas de uma origem só",
    },
  },
  required: ["source", "source_url", "data_vintage", "retrieved_at", "retrieval", "citation", "license"],
  additionalProperties: false as const,
} satisfies JsonSchemaObject;

/** Projeção `detailed` (bloco canônico completo), ordem fixa, nulls explícitos; aceita v1.1 e v1.2. */
export const DETAILED_BLOCK_JSON_SCHEMA = {
  type: "object" as const,
  description: "Bloco canônico de proveniência (contrato v1.1 ou v1.2), completo",
  properties: {
    contract_version: {
      type: "string" as const,
      enum: [...CONTRACT_VERSIONS],
      description: "Versão do contrato de proveniência",
    },
    source: {
      type: "object" as const,
      properties: {
        name: str("Nome oficial da fonte"),
        agency: strOrNull("Órgão/agência"),
        database: strOrNull("Base/sistema dentro do órgão"),
        endpoint: strOrNull("Endpoint-base efetivamente consultado"),
      },
      required: ["name", "agency", "database", "endpoint"],
      additionalProperties: false as const,
    },
    dataset: {
      type: "object" as const,
      properties: {
        id: strOrNull("Identificador do conjunto"),
        version: strOrNull("Versão do conjunto reportada pela fonte"),
        name: strOrNull("Nome humano do conjunto"),
      },
      required: ["id", "version", "name"],
      additionalProperties: false as const,
    },
    dimension_key: {
      type: ["object", "null"] as const,
      additionalProperties: { type: "string" as const },
      description: "Chave dimensional da consulta, na ordem das dimensões da fonte; null quando não aplicável",
    },
    data_vintage: strOrNull("Vintage/competência do dado segundo a fonte"),
    retrieved_at: str("ISO-8601 do instante real da extração na origem"),
    source_url: str("URL canônica que reproduz a consulta"),
    api_version: strOrNull("Versão do endpoint upstream, se exposta"),
    license: {
      type: "object" as const,
      properties: {
        id: strOrNull("Identificador SPDX-like"),
        name: strOrNull("Nome/descrição da licença"),
        url: strOrNull("URL do texto da licença"),
        terms_url: strOrNull("URL dos termos de uso da fonte"),
        verified_at: strOrNull("Data da última verificação verbatim da licença"),
      },
      required: ["id", "name", "url", "terms_url", "verified_at"],
      additionalProperties: false as const,
    },
    citation: str("Citação/atribuição pronta para uso"),
    notices: { type: "array" as const, items: { type: "string" as const }, description: "Avisos da origem, verbatim" },
    derived: { type: "boolean" as const, description: "true se o servidor transformou além de filtrar/paginar" },
    derivation_note: strOrNull("O que foi feito, quando derived=true"),
    served_from_cache: {
      type: ["boolean", "null"] as const,
      description: "true/false quando o servidor distingue cache de fetch; null quando não",
    },
    retrieval: RETRIEVAL_JSON_SCHEMA,
    field_sources: {
      oneOf: [{ type: "array" as const, items: FIELD_SOURCE_JSON_SCHEMA }, { type: "null" as const }],
      description: "Proveniência por campo, quando a resposta funde recortes; null quando não",
    },
  },
  required: [
    "contract_version",
    "source",
    "dataset",
    "dimension_key",
    "data_vintage",
    "retrieved_at",
    "source_url",
    "api_version",
    "license",
    "citation",
    "notices",
    "derived",
    "derivation_note",
    "served_from_cache",
    "retrieval",
    "field_sources",
  ],
  additionalProperties: false as const,
} satisfies JsonSchemaObject;

/** JSON Schema da projeção do modo pedido. */
export function provenanceBlockJsonSchema(mode: "concise" | "detailed"): JsonSchemaObject {
  return mode === "concise" ? CONCISE_BLOCK_JSON_SCHEMA : DETAILED_BLOCK_JSON_SCHEMA;
}

// ---- Equivalentes em zod, para servidores cujo outputSchema é zod (ex.: ibge) ----------

const RetrievalOutputZod = z
  .object({
    requests: z.number().int().min(1),
    attempts: z.number().int().min(1),
    anomalies: z.array(z.object({ kind: RetrievalAnomalyKindSchema, count: z.number().int().min(1) }).strict()),
    unstable: z.boolean(),
  })
  .strict();

/** Sub-fonte em zod (estrito); `served_from_cache` opcional, como no JSON Schema. */
const FieldSourceOutputZod = z
  .object({
    fields: z.array(z.string()).min(1),
    source_url: z.string(),
    dataset_id: z.string().nullable(),
    data_vintage: z.string().nullable(),
    retrieved_at: z.string().nullable(),
    served_from_cache: z.boolean().nullable().optional(),
  })
  .strict();

/** Projeção `concise` em zod (estrito): as mesmas chaves do JSON Schema acima. */
export const ConciseBlockSchema = z
  .object({
    source: z.string(),
    source_url: z.string(),
    data_vintage: z.string().nullable(),
    retrieved_at: z.string(),
    retrieval: RetrievalOutputZod.nullable(),
    citation: z.string(),
    license: z.string().nullable(),
    field_sources: z.array(FieldSourceOutputZod).min(1).optional(),
  })
  .strict();

/** Projeção `detailed` em zod (estrito). */
export const DetailedBlockSchema = z
  .object({
    contract_version: z.enum(CONTRACT_VERSIONS),
    source: z
      .object({
        name: z.string(),
        agency: z.string().nullable(),
        database: z.string().nullable(),
        endpoint: z.string().nullable(),
      })
      .strict(),
    dataset: z.object({ id: z.string().nullable(), version: z.string().nullable(), name: z.string().nullable() }).strict(),
    dimension_key: z.record(z.string(), z.string()).nullable(),
    data_vintage: z.string().nullable(),
    retrieved_at: z.string(),
    source_url: z.string(),
    api_version: z.string().nullable(),
    license: z
      .object({
        id: z.string().nullable(),
        name: z.string().nullable(),
        url: z.string().nullable(),
        terms_url: z.string().nullable(),
        verified_at: z.string().nullable(),
      })
      .strict(),
    citation: z.string(),
    notices: z.array(z.string()),
    derived: z.boolean(),
    derivation_note: z.string().nullable(),
    served_from_cache: z.boolean().nullable(),
    retrieval: RetrievalOutputZod.nullable(),
    field_sources: z.array(FieldSourceOutputZod).nullable(),
  })
  .strict();
