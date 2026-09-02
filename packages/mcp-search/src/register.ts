/**
 * A fábrica: registra `search` e `fetch` num `McpServer` a partir de duas
 * funções do servidor — quem busca no acervo e quem renderiza um documento.
 * Tudo que é contrato (nomes, schemas, envelope, descrições) mora aqui, para
 * os seis servidores do portfólio divergirem só no que é deles: o índice e o
 * texto do documento.
 *
 * Convenções do portfólio embutidas:
 *  - `title` pt-BR (é o que o cliente mostra), `description` em inglês (é o
 *    que o modelo lê), dizendo explicitamente que as duas existem para o
 *    contrato do ChatGPT e que as tools ricas do servidor são as de dados;
 *  - annotations somente-leitura (o chamador passa as suas, iguais às das
 *    outras tools, para os testes de superfície não distinguirem);
 *  - `extendOutputSchema` deixa o servidor acrescentar ao outputSchema o
 *    bloco de proveniência (`comProveniencia(...)` no ibge), e `search`/
 *    `fetch` podem devolver os extras do envelope junto com o resultado
 *    (`{ results, extras }` / `{ document, extras }`) — a proveniência nasce
 *    dentro da chamada (instante real da extração, chave de cache), então é
 *    a chamada que a entrega; o portão de proveniência de cada repositório
 *    continua valendo para as duas;
 *  - `record` recebe `tool_call`/`tool_error` como o `handle` dos servidores
 *    (telemetria do Worker: nomes e contagens, nunca argumentos).
 */

import type { CallToolResult, McpServer, ToolAnnotations } from "@modelcontextprotocol/server";
import type { z } from "zod";
import {
  fetchDocumentSchema,
  fetchInputSchema,
  searchInputSchema,
  searchOutputSchema,
  type DeepResearchToolName,
  type FetchDocument,
  type SearchResult,
} from "./contract.js";
import { deepResearchError, deepResearchResult, type EnvelopeExtras } from "./envelope.js";
import { DEFAULT_LIMIT } from "./rank.js";

export type UsageRecorder = (kind: "tool_call" | "tool_error", name: string) => void;

/** Resposta de `search` com extras do envelope (proveniência do índice). */
export interface SearchReply {
  results: readonly SearchResult[];
  extras?: EnvelopeExtras;
}

/** Resposta de `fetch` com extras do envelope (proveniência do documento). */
export interface FetchReply {
  document: FetchDocument;
  extras?: EnvelopeExtras;
}

export interface DeepResearchToolsOptions {
  /** Busca no acervo; devolve os resultados já em ordem de relevância (a lista nua ou `{ results, extras }`). */
  search: (query: string) => Promise<readonly SearchResult[] | SearchReply>;
  /** Renderiza o documento de um id devolvido por `search` (o documento nu ou `{ document, extras }`); `null` = id desconhecido. */
  fetch: (id: string) => Promise<FetchDocument | FetchReply | null>;
  /** O acervo, em inglês, para a description: "IBGE official statistics (SIDRA tables, municipalities, indicators)". */
  corpus: string;
  /** Como o modelo deve chamar as tools de dados: "the `ibge_*` tools". */
  richTools: string;
  /** Teto de resultados do `search` (padrão 10); o excedente é cortado aqui. */
  limit?: number;
  /** Títulos pt-BR (padrão: "Busca para Deep Research" / "Documento para Deep Research"). */
  titles?: { search?: string; fetch?: string };
  /** As mesmas annotations das outras tools do servidor (somente leitura). */
  annotations?: ToolAnnotations;
  /** Estende os outputSchemas do contrato (p.ex. com o bloco de proveniência). */
  extendOutputSchema?: (schema: z.ZodObject<z.ZodRawShape>) => z.ZodType;
  /** Telemetria por chamada, como o `handle` dos servidores. */
  record?: UsageRecorder;
  /** Mensagem pt-BR para id desconhecido em `fetch`. */
  notFound?: (id: string) => string;
  /** Mensagem pt-BR quando `search`/`fetch` lançam (o erro nunca sobe ao cliente cru). */
  onError?: (error: unknown, tool: DeepResearchToolName) => string;
}

const DEFAULT_TITLES = {
  search: "Busca para Deep Research",
  fetch: "Documento para Deep Research",
} as const;

function defaultNotFound(id: string): string {
  return `Documento não encontrado: "${id}". Use um id devolvido por \`search\`.`;
}

function defaultOnError(error: unknown, tool: DeepResearchToolName): string {
  const detalhe = error instanceof Error ? error.message : String(error);
  return `Falha em \`${tool}\`: ${detalhe}`;
}

function searchDescription(opts: DeepResearchToolsOptions, limit: number): string {
  return [
    `Searches the ${opts.corpus} catalog and returns up to ${limit} matching documents as { id, title, url }, ordered by relevance (an empty list means nothing matched).`,
    "",
    "This tool exists for the OpenAI Deep Research contract: ChatGPT deep research, company knowledge and research workflows over the Responses API require exactly the tools `search` and `fetch`. Pass one of the returned ids to `fetch` to read the document.",
    `For direct questions and for data (values, series, rankings) prefer ${opts.richTools}, which return the actual data with provenance — this is a catalog index, not a data query.`,
    "",
    "Query: natural language or keywords, Portuguese or English; accents and case are ignored.",
    "",
    "Behavior: read-only and idempotent — the catalog comes from the public source and is cached in memory.",
  ].join("\n");
}

function fetchDescription(opts: DeepResearchToolsOptions): string {
  return [
    "Returns the full document for an id obtained from `search`, as { id, title, text, url, metadata }: `text` is the readable content (Markdown) and `url` the canonical public page to cite.",
    "",
    `Companion of \`search\` in the OpenAI Deep Research contract, over the ${opts.corpus} catalog. Only ids returned by \`search\` are valid; an unknown id returns an error.`,
    `${opts.richTools} remain the tools for data queries.`,
    "",
    "Behavior: read-only and idempotent — a live GET against the public source when the document needs it.",
  ].join("\n");
}

/** Registra `search` e `fetch` no servidor. Chame de dentro do registro central de tools. */
export function registerDeepResearchTools(server: McpServer, opts: DeepResearchToolsOptions): void {
  const limit = Math.max(1, Math.floor(opts.limit ?? DEFAULT_LIMIT));
  const extend = opts.extendOutputSchema ?? ((schema) => schema);
  const notFound = opts.notFound ?? defaultNotFound;
  const onError = opts.onError ?? defaultOnError;

  /** Mesmo protocolo de telemetria do `handle` dos servidores. */
  const instrumented =
    (tool: DeepResearchToolName, run: () => Promise<CallToolResult>) => async () => {
      let result: CallToolResult;
      try {
        result = await run();
      } catch (error) {
        result = deepResearchError(onError(error, tool));
      }
      opts.record?.("tool_call", tool);
      if (result.isError === true) opts.record?.("tool_error", tool);
      return result;
    };

  server.registerTool(
    "search",
    {
      title: opts.titles?.search ?? DEFAULT_TITLES.search,
      description: searchDescription(opts, limit),
      inputSchema: searchInputSchema,
      outputSchema: extend(searchOutputSchema),
      ...(opts.annotations !== undefined ? { annotations: opts.annotations } : {}),
    },
    async ({ query }) =>
      instrumented("search", async () => {
        const resposta = await opts.search(query);
        // `Array.isArray` não estreita `readonly T[]` — o guarda explícito sim.
        const isReply = (r: typeof resposta): r is SearchReply => !Array.isArray(r);
        const { results, extras } = isReply(resposta)
          ? { results: resposta.results, extras: resposta.extras }
          : { results: resposta, extras: undefined };
        return deepResearchResult({ results: results.slice(0, limit) }, extras);
      })()
  );

  server.registerTool(
    "fetch",
    {
      title: opts.titles?.fetch ?? DEFAULT_TITLES.fetch,
      description: fetchDescription(opts),
      inputSchema: fetchInputSchema,
      outputSchema: extend(fetchDocumentSchema),
      ...(opts.annotations !== undefined ? { annotations: opts.annotations } : {}),
    },
    async ({ id }) =>
      instrumented("fetch", async () => {
        const resposta = await opts.fetch(id);
        if (resposta === null) return deepResearchError(notFound(id));
        const { document, extras } =
          "document" in resposta ? resposta : { document: resposta, extras: undefined };
        return deepResearchResult({ ...document }, extras);
      })()
  );
}
