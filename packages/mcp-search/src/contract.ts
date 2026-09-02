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
 * `outputSchema`; os `.describe()` em pt-BR seguem a convenção do portfólio
 * (o campo aparece ao cliente MCP, e o leitor é brasileiro).
 */

import { z } from "zod";

/** Nomes fixados pela OpenAI — allowlist para os testes que exigem prefixo por servidor. */
export const DEEP_RESEARCH_TOOLS = ["search", "fetch"] as const;
export type DeepResearchToolName = (typeof DEEP_RESEARCH_TOOLS)[number];

const idSchema = z
  .string()
  .min(1)
  .describe("Identificador único do documento no servidor; é o que `fetch` recebe");
const titleSchema = z.string().describe("Título legível do documento");
const urlSchema = z
  .string()
  .describe("URL pública canônica do documento — a citação do ChatGPT depende dela");

export const searchResultSchema = z.object({
  id: idSchema,
  title: titleSchema,
  url: urlSchema,
});

export const searchInputSchema = z.object({
  query: z
    .string()
    .describe("Termos de busca em linguagem natural ou palavras-chave (acentos e caixa são ignorados)"),
});

export const searchOutputSchema = z.object({
  results: z.array(searchResultSchema).describe("Documentos encontrados, em ordem de relevância"),
});

export const fetchInputSchema = z.object({
  id: z.string().describe("Identificador de um documento devolvido por `search`"),
});

export const fetchDocumentSchema = z.object({
  id: idSchema,
  title: titleSchema,
  text: z.string().describe("Conteúdo integral do documento, legível (Markdown)"),
  url: urlSchema,
  metadata: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Pares chave/valor adicionais sobre o documento (tipo, fonte, período…)"),
});

export type SearchInput = z.infer<typeof searchInputSchema>;
export type SearchResult = z.infer<typeof searchResultSchema>;
export type SearchOutput = z.infer<typeof searchOutputSchema>;
export type FetchInput = z.infer<typeof fetchInputSchema>;
export type FetchDocument = z.infer<typeof fetchDocumentSchema>;
