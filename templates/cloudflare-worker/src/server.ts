/**
 * Construção do McpServer — chamado pela factory do createMcpHandler a cada request
 * (exigência do modelo stateless do MCP SDK v2).
 *
 * Padrões do portfólio demonstrados na tool de exemplo (remover ao instanciar):
 *  - anotações obrigatórias em toda tool: title, readOnlyHint, destructiveHint
 *    (critério pass/fail do diretório Anthropic); nome ≤ 64 chars;
 *  - descrição diz também o que a tool NÃO faz;
 *  - todo retorno carrega o envelope de proveniência (@sbissoli/mcp-provenance);
 *  - instrumentação de uso fora do caminho crítico (withUsage → Durable Object).
 */

import { McpServer } from "@modelcontextprotocol/server";
import { createProvenanceContext, type SourcePreset } from "@sbissoli/mcp-provenance";
import { z } from "zod";
import { PROVENANCE_OPTIONS, SERVER_CONFIG } from "./config.js";
import type { RecordUsage } from "./usage-core.js";

/** Contexto de proveniência — um por servidor, criado na inicialização do isolate. */
export const provenance = createProvenanceContext(PROVENANCE_OPTIONS);

/**
 * Instrumentação por tool: conta toda chamada (tool_call) e as falhas (tool_error),
 * inclusive exceções — relançadas para o SDK produzir a resposta de erro normal.
 */
export function withUsage<A, R>(
  name: string,
  record: RecordUsage,
  cb: (args: A) => Promise<R>,
): (args: A) => Promise<R> {
  return async (args: A) => {
    let isError = false;
    try {
      const result = await cb(args);
      isError = (result as { isError?: unknown } | null | undefined)?.isError === true;
      return result;
    } catch (e) {
      isError = true;
      throw e;
    } finally {
      record("tool_call", name);
      if (isError) record("tool_error", name);
    }
  };
}

// ---------------------------------------------------------------------------
// Tool de exemplo — TODO(instância): remover e registrar as tools reais.
// ---------------------------------------------------------------------------

/** Preset de fonte: campos fixos por fonte upstream; o restante vem por chamada. */
const FONTE_EXEMPLO: SourcePreset = {
  source: "Fonte de Exemplo (fictícia)",
  citation: "Fonte de Exemplo. Catálogo demonstrativo do template. Dados fictícios.",
  license: "CC0-1.0",
};

export const CATALOGO_EXEMPLO = [
  { id: "alfa", nome: "Registro Alfa", categoria: "demonstracao" },
  { id: "beta", nome: "Registro Beta", categoria: "demonstracao" },
  { id: "gama", nome: "Registro Gama", categoria: "exemplo" },
] as const;

export interface ItemCatalogo {
  id: string;
  nome: string;
  categoria: string;
}

/** Filtro puro do catálogo — exportado para teste unitário (convenção do portfólio). */
export function filtrarCatalogo(busca?: string): ItemCatalogo[] {
  const itens: ItemCatalogo[] = CATALOGO_EXEMPLO.map((i) => ({ ...i }));
  if (!busca) return itens;
  const alvo = busca.toLocaleLowerCase("pt-BR");
  return itens.filter(
    (i) =>
      i.id.toLocaleLowerCase("pt-BR").includes(alvo) ||
      i.nome.toLocaleLowerCase("pt-BR").includes(alvo),
  );
}

export const EXEMPLO_TOOL_NAME = "exemplo_buscar_catalogo";

/** Handler da tool de exemplo — exportado para teste unitário direto. */
export async function exemploBuscarCatalogo(args: { busca?: string | undefined }) {
  const itens = filtrarCatalogo(args.busca);
  const data = { total: itens.length, itens };
  const prov = provenance.from(FONTE_EXEMPLO, {
    source_url: "https://exemplo.invalid/catalogo",
    data_vintage: "2026",
    // retrieved_at omitido = instante da chamada — aceitável SÓ porque o catálogo é
    // estático, sem extração upstream. Com fetch real, preservar o instante da
    // extração original (a camada de cache do servidor deve carregá-lo).
  });
  const r = provenance.result(data, prov);
  // Re-espalha `data` por cima para que o structuredContent saia com o tipo forte
  // exigido pelo outputSchema (o envelope de proveniência tipa os campos como unknown).
  return { ...r, structuredContent: { ...r.structuredContent, ...data } };
}

export function buildServer(record: RecordUsage = () => {}): McpServer {
  const server = new McpServer(
    { name: SERVER_CONFIG.name, version: SERVER_CONFIG.version, title: SERVER_CONFIG.title },
    { instructions: SERVER_CONFIG.instructions },
  );

  server.registerTool(
    EXEMPLO_TOOL_NAME,
    {
      title: "Buscar no catálogo de exemplo",
      description:
        "Busca registros no catálogo estático de demonstração do template (3 itens fictícios). " +
        "Não consulta nenhuma fonte externa e não cobre dados reais — substitua esta tool " +
        "pelas tools do seu servidor.",
      inputSchema: z.object({
        busca: z
          .string()
          .min(1)
          .optional()
          .describe("Trecho do id ou do nome do registro; omita para listar tudo"),
      }),
      outputSchema: z.looseObject({
        total: z.number(),
        itens: z.array(
          z.object({ id: z.string(), nome: z.string(), categoria: z.string() }),
        ),
        // Envelope de proveniência (contrato v1.0) — presente em toda resposta.
        provenance: z.unknown(),
        attribution: z.array(z.string()),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    withUsage(EXEMPLO_TOOL_NAME, record, exemploBuscarCatalogo),
  );

  return server;
}
