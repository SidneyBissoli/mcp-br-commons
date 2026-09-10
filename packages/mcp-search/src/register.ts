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
 *    `locale: "en"` troca para inglês tudo que é do idioma do servidor —
 *    títulos, `.describe()` dos schemas e mensagens de erro padrão — nos
 *    servidores cuja superfície inteira é em inglês (medical, ilo, uis);
 *  - annotations somente-leitura (o chamador passa as suas, iguais às das
 *    outras tools, para os testes de superfície não distinguirem);
 *  - `extendOutputSchema` deixa o servidor acrescentar ao outputSchema o
 *    bloco de proveniência (`comProveniencia(...)` no ibge), e `search`/
 *    `fetch` podem devolver os extras do envelope junto com o resultado
 *    (`{ results, extras }` / `{ document, extras }`) — a proveniência nasce
 *    dentro da chamada (instante real da extração, chave de cache), então é
 *    a chamada que a entrega; o portão de proveniência de cada repositório
 *    continua valendo para as duas;
 *  - `record` recebe `tool_call`/`tool_error` como o `handle` dos servidores,
 *    agora com a FORMA da chamada: os NOMES dos parâmetros e, quando o servidor
 *    passa `classifyError`, a classe do erro. Nunca o VALOR de um parâmetro —
 *    `query` é texto livre e o que a pessoa digitou não entra na telemetria.
 */

import type { CallToolResult, McpServer, ToolAnnotations } from "@modelcontextprotocol/server";
import type { z } from "zod";
import {
  contractSchemas,
  type ContractLocale,
  type DeepResearchToolName,
  type FetchDocument,
  type SearchResult,
} from "./contract.js";
import { deepResearchError, deepResearchResult, type EnvelopeExtras } from "./envelope.js";
import { DEFAULT_LIMIT } from "./rank.js";

/**
 * A FORMA da chamada — nomes de parâmetro e classe do erro, nunca valores.
 *
 * Os servidores do portfólio passaram a gravar isto em 10/09/2026, porque a
 * telemetria dizia QUE uma ferramenta falhou e não por quê. `search` e `fetch`
 * ficaram de fora sem que ninguém notasse: o gancho aqui tinha aridade 2, então
 * a forma que os servidores montam não tinha por onde entrar, e as linhas de
 * `fetch` chegaram na produção do ilo, do uis e do ibge com classe e parâmetros
 * VAZIOS. Foi visto lendo o Analytics Engine, não pelos testes — os dois lados
 * estavam certos e só faltava o argumento na costura.
 */
export interface FormaDaChamada {
  /** Nomes dos parâmetros da chamada, em ordem, separados por vírgula. */
  params: string;
  /** Classe do erro; vazia quando a chamada deu certo ou quando não há classificador. */
  classe: string;
}

export type UsageRecorder = (
  kind: "tool_call" | "tool_error",
  name: string,
  forma?: FormaDaChamada,
) => void;

/** Nomes dos parâmetros presentes, em ordem. NUNCA os valores. */
function nomesDeParametro(args: Record<string, unknown>): string {
  return Object.keys(args)
    .filter((k) => args[k] !== undefined)
    .sort()
    .join(",")
    .slice(0, 200);
}

/** Texto de erro de um resultado, para o classificador do servidor. */
function textoDoErro(result: CallToolResult): string {
  const primeiro = result.content?.[0];
  return primeiro && "text" in primeiro && typeof primeiro.text === "string" ? primeiro.text : "";
}

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
  /** Idioma dos textos que o cliente vê — títulos, `.describe()`, mensagens padrão (padrão pt-BR). */
  locale?: ContractLocale;
  /** Títulos (padrão por idioma: "Busca para Deep Research" / "Documento para Deep Research"). */
  titles?: { search?: string; fetch?: string };
  /** As mesmas annotations das outras tools do servidor (somente leitura). */
  annotations?: ToolAnnotations;
  /** Estende os outputSchemas do contrato (p.ex. com o bloco de proveniência). */
  extendOutputSchema?: (schema: z.ZodObject<z.ZodRawShape>) => z.ZodType;
  /** Telemetria por chamada, como o `handle` dos servidores. */
  record?: UsageRecorder;
  /**
   * Classifica a mensagem de erro num vocabulário fechado do servidor (o
   * `classifyError` de `call-shape.ts`). Sem ele, a classe vai vazia e os nomes
   * dos parâmetros continuam sendo gravados: o pacote conhece a chamada, mas o
   * vocabulário é de cada servidor e não cabe aqui.
   */
  classifyError?: (message: string) => string;
  /** Mensagem para id desconhecido em `fetch` (padrão no idioma de `locale`). */
  notFound?: (id: string) => string;
  /** Mensagem quando `search`/`fetch` lançam — o erro nunca sobe ao cliente cru (padrão no idioma de `locale`). */
  onError?: (error: unknown, tool: DeepResearchToolName) => string;
}

interface LocaleDefaults {
  titles: { search: string; fetch: string };
  notFound: (id: string) => string;
  onError: (error: unknown, tool: DeepResearchToolName) => string;
}

const detalheDe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const DEFAULTS: Record<ContractLocale, LocaleDefaults> = {
  "pt-BR": {
    titles: { search: "Busca para Deep Research", fetch: "Documento para Deep Research" },
    notFound: (id) => `Documento não encontrado: "${id}". Use um id devolvido por \`search\`.`,
    onError: (error, tool) => `Falha em \`${tool}\`: ${detalheDe(error)}`,
  },
  en: {
    titles: { search: "Deep Research Search", fetch: "Deep Research Document" },
    notFound: (id) => `Document not found: "${id}". Use an id returned by \`search\`.`,
    onError: (error, tool) => `\`${tool}\` failed: ${detalheDe(error)}`,
  },
};

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
    `${opts.richTools.charAt(0).toUpperCase()}${opts.richTools.slice(1)} remain the tools for data queries.`,
    "",
    "Behavior: read-only and idempotent — a live GET against the public source when the document needs it.",
  ].join("\n");
}

/** Registra `search` e `fetch` no servidor. Chame de dentro do registro central de tools. */
export function registerDeepResearchTools(server: McpServer, opts: DeepResearchToolsOptions): void {
  const limit = Math.max(1, Math.floor(opts.limit ?? DEFAULT_LIMIT));
  const extend = opts.extendOutputSchema ?? ((schema) => schema);
  const defaults = DEFAULTS[opts.locale ?? "pt-BR"];
  const notFound = opts.notFound ?? defaults.notFound;
  const onError = opts.onError ?? defaults.onError;
  const { searchInputSchema, searchOutputSchema, fetchInputSchema, fetchDocumentSchema } =
    contractSchemas(opts.locale);

  /**
   * Mesmo protocolo de telemetria do `handle` dos servidores, incluindo a FORMA
   * da chamada. Os argumentos entram por parâmetro (e não por closure) porque é
   * daqui que saem os NOMES deles — o pacote é o único ponto que enxerga a
   * chamada destas duas tools.
   */
  const instrumented =
    (
      tool: DeepResearchToolName,
      args: Record<string, unknown>,
      run: () => Promise<CallToolResult>,
    ) =>
    async () => {
      let result: CallToolResult;
      try {
        result = await run();
      } catch (error) {
        result = deepResearchError(onError(error, tool));
      }
      const forma: FormaDaChamada = { params: nomesDeParametro(args), classe: "" };
      opts.record?.("tool_call", tool, forma);
      if (result.isError === true) {
        opts.record?.("tool_error", tool, {
          ...forma,
          classe: opts.classifyError?.(textoDoErro(result)) ?? "",
        });
      }
      return result;
    };

  server.registerTool(
    "search",
    {
      title: opts.titles?.search ?? defaults.titles.search,
      description: searchDescription(opts, limit),
      inputSchema: searchInputSchema,
      outputSchema: extend(searchOutputSchema),
      ...(opts.annotations !== undefined ? { annotations: opts.annotations } : {}),
    },
    async ({ query }) =>
      instrumented("search", { query }, async () => {
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
      title: opts.titles?.fetch ?? defaults.titles.fetch,
      description: fetchDescription(opts),
      inputSchema: fetchInputSchema,
      outputSchema: extend(fetchDocumentSchema),
      ...(opts.annotations !== undefined ? { annotations: opts.annotations } : {}),
    },
    async ({ id }) =>
      instrumented("fetch", { id }, async () => {
        const resposta = await opts.fetch(id);
        if (resposta === null) return deepResearchError(notFound(id));
        const { document, extras } =
          "document" in resposta ? resposta : { document: resposta, extras: undefined };
        return deepResearchResult({ ...document }, extras);
      })()
  );
}
