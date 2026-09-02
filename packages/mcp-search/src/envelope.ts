/**
 * Envelope MCP do contrato Deep Research.
 *
 * A doc da OpenAI embala cada resposta de DUAS formas ao mesmo tempo: o objeto
 * do contrato em `structuredContent` E o mesmo objeto serializado em
 * `content[0].text`. É isso que este módulo faz — e só isso, deliberadamente:
 *
 *  - `content` tem UM bloco de texto, o JSON compacto do objeto. O envelope de
 *    proveniência do portfólio (`@sbissoli/mcp-provenance`, `ctx.result`)
 *    emite dois blocos (JSON indentado + rodapé humano); aqui o segundo bloco
 *    fica de fora porque o parser do ChatGPT lê `content[0].text` como o
 *    objeto, e um bloco extra é comportamento que a doc não descreve;
 *  - `structuredContent` recebe o objeto MAIS o que o servidor quiser anexar
 *    (`extras.structured`: o bloco `provenance` + `attribution` do contrato
 *    v1.0 do portfólio — chave extra não atrapalha o Deep Research). As chaves
 *    do contrato vencem em colisão: o servidor não sobrescreve `results`,
 *    `id`, `text`… por acidente;
 *  - `_meta` só existe quando há `extras.meta` (o espelho fora de banda da
 *    proveniência, sob as chaves com namespace do servidor).
 */

import type { CallToolResult } from "@modelcontextprotocol/server";

export interface EnvelopeExtras {
  /** Chaves anexadas a `structuredContent` ao lado do objeto do contrato. */
  structured?: Record<string, unknown>;
  /** Conteúdo de `_meta` (omitido quando ausente). */
  meta?: Record<string, unknown>;
}

/** Sucesso: JSON do objeto em `content[0].text`, objeto (+ extras) em `structuredContent`. */
export function deepResearchResult(
  objeto: Record<string, unknown>,
  extras?: EnvelopeExtras
): CallToolResult {
  const content = [{ type: "text" as const, text: JSON.stringify(objeto) }];
  const structuredContent = { ...(extras?.structured ?? {}), ...objeto };
  return extras?.meta !== undefined
    ? { content, structuredContent, _meta: extras.meta }
    : { content, structuredContent };
}

/** Erro: texto legível e `isError` (o SDK pula a validação do outputSchema). */
export function deepResearchError(mensagem: string): CallToolResult {
  return { content: [{ type: "text" as const, text: mensagem }], isError: true };
}
