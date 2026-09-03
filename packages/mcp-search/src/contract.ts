/**
 * O contrato `search`/`fetch` da OpenAI, literal da doc
 * (developers.openai.com/api/docs/mcp, lida em 2026-09-02):
 *
 *  - `search(query: string)` → `{ results: [{ id, title, url }] }`
 *  - `fetch(id: string)`     → `{ id, title, text, url, metadata? }`
 *
 * O ChatGPT (Deep Research, Company Knowledge e os workflows de pesquisa da
 * API Responses) procura EXATAMENTE essas duas tools, com esses nomes — são a
 * única exceção admitida ao prefixo por servidor (`ibge_*`, `bcb_*`…). A
 * citação só nasce quando `url` é uma string não vazia: todo resultado carrega
 * a URL pública canônica do documento.
 *
 * Os schemas aqui são os que os servidores registram como `inputSchema` e
 * `outputSchema`. Os `.describe()` existem em dois idiomas: pt-BR (a
 * convenção do portfólio — o campo aparece ao cliente MCP, e o leitor é
 * brasileiro) e en (para os servidores cuja superfície inteira é em inglês:
 * medical, ilo, uis). As constantes exportadas são o pt-BR; `contractSchemas`
 * devolve o conjunto do idioma pedido. A forma é idêntica nos dois — só as
 * descrições mudam.
 */

import { z } from "zod";

/** Nomes fixados pela OpenAI — allowlist para os testes que exigem prefixo por servidor. */
export const DEEP_RESEARCH_TOOLS = ["search", "fetch"] as const;
export type DeepResearchToolName = (typeof DEEP_RESEARCH_TOOLS)[number];

/** Idioma dos textos que o cliente MCP vê (`.describe()`, títulos, mensagens de erro). */
export type ContractLocale = "pt-BR" | "en";

interface ContractTexts {
  id: string;
  title: string;
  url: string;
  query: string;
  results: string;
  fetchId: string;
  text: string;
  metadata: string;
}

const TEXTS: Record<ContractLocale, ContractTexts> = {
  "pt-BR": {
    id: "Identificador único do documento no servidor; é o que `fetch` recebe",
    title: "Título legível do documento",
    url: "URL pública canônica do documento — a citação do ChatGPT depende dela",
    query:
      "Termos de busca em linguagem natural ou palavras-chave (acentos e caixa são ignorados)",
    results: "Documentos encontrados, em ordem de relevância",
    fetchId: "Identificador de um documento devolvido por `search`",
    text: "Conteúdo integral do documento, legível (Markdown)",
    metadata: "Pares chave/valor adicionais sobre o documento (tipo, fonte, período…)",
  },
  en: {
    id: "Unique identifier of the document on this server; what `fetch` takes",
    title: "Human-readable title of the document",
    url: "Canonical public URL of the document — ChatGPT's citation depends on it",
    query: "Search terms, natural language or keywords (accents and case are ignored)",
    results: "Matching documents, in relevance order",
    fetchId: "Identifier of a document returned by `search`",
    text: "Full readable content of the document (Markdown)",
    metadata: "Additional key/value pairs about the document (kind, source, period…)",
  },
};

/** Os quatro schemas do contrato com os `.describe()` no idioma pedido. */
export function contractSchemas(locale: ContractLocale = "pt-BR") {
  const t = TEXTS[locale];
  const idSchema = z.string().min(1).describe(t.id);
  const titleSchema = z.string().describe(t.title);
  const urlSchema = z.string().describe(t.url);

  const searchResultSchema = z.object({
    id: idSchema,
    title: titleSchema,
    url: urlSchema,
  });

  return {
    searchResultSchema,
    searchInputSchema: z.object({ query: z.string().describe(t.query) }),
    searchOutputSchema: z.object({
      results: z.array(searchResultSchema).describe(t.results),
    }),
    fetchInputSchema: z.object({ id: z.string().describe(t.fetchId) }),
    fetchDocumentSchema: z.object({
      id: idSchema,
      title: titleSchema,
      text: z.string().describe(t.text),
      url: urlSchema,
      metadata: z.record(z.string(), z.unknown()).optional().describe(t.metadata),
    }),
  };
}

const ptBR = contractSchemas("pt-BR");

export const searchResultSchema = ptBR.searchResultSchema;
export const searchInputSchema = ptBR.searchInputSchema;
export const searchOutputSchema = ptBR.searchOutputSchema;
export const fetchInputSchema = ptBR.fetchInputSchema;
export const fetchDocumentSchema = ptBR.fetchDocumentSchema;

export type SearchInput = z.infer<typeof searchInputSchema>;
export type SearchResult = z.infer<typeof searchResultSchema>;
export type SearchOutput = z.infer<typeof searchOutputSchema>;
export type FetchInput = z.infer<typeof fetchInputSchema>;
export type FetchDocument = z.infer<typeof fetchDocumentSchema>;
