/**
 * Extrator de catálogo — a fonte de verdade do harness.
 *
 * Nunca toca a rede. Um "fake McpServer" (`CapturingServer`) grava cada registro de tool
 * feito pelos `registerXTools` do servidor, exatamente como o `server.ts` real os liga.
 * O resultado é a lista viva de tools (nome, descrição, JSON-schema do input) contra a
 * qual as fixtures são validadas — renomear/remover uma tool quebra o teste offline
 * imediatamente, sem rede e sem modelo.
 *
 * Duas formas de registro são capturadas, cobrindo os dois padrões do portfólio:
 *   - `server.tool(name, description, shape, cb)` — forma clássica (shape zod cru);
 *   - `server.registerTool(name, { description, inputSchema }, cb)` — forma SDK v2
 *     (inputSchema pode ser um `z.object(...)` pronto ou um shape cru).
 *
 * Os callbacks das tools (que tocariam upstream/cache/bindings) são capturados mas nunca
 * invocados — por isso nenhum runtime de Worker é necessário.
 */

import { z, type ZodTypeAny, type ZodRawShape } from "zod";

/** JSON-schema mínimo (subconjunto do draft 2020-12) descrevendo o input de uma tool. */
export interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
}

export interface CatalogTool {
  name: string;
  description: string;
  /** Área funcional grossa, herdada do grupo que registrou a tool. */
  area: string;
  /** Visão JSON-schema do shape zod de input (para a definição de tool do modelo). */
  inputSchema: JsonSchema;
}

export type ZodShape = Record<string, ZodTypeAny>;

/** O que a captura aceita como "shape": shape cru, schema zod pronto, ou nada. */
export type CapturedShape = ZodShape | ZodTypeAny | undefined;

/**
 * Fake McpServer que só grava registros de tool. Passe-o (com cast, ex.: `as never`)
 * aos `registerXTools` do servidor real; nada além de `.tool`/`.registerTool` é chamado
 * em tempo de registro nos servidores do portfólio.
 */
export class CapturingServer {
  readonly captured: { name: string; description: string; shape: CapturedShape }[] = [];

  /** Forma clássica: `server.tool(name, description, shape, cb)`. */
  tool(name: string, description: string, shape?: unknown, _cb?: unknown): void {
    this.captured.push({ name, description, shape: shape as CapturedShape });
  }

  /** Forma SDK v2: `server.registerTool(name, { description, inputSchema }, cb)`. */
  registerTool(
    name: string,
    config: { title?: string; description?: string; inputSchema?: unknown },
    _cb?: unknown,
  ): void {
    this.captured.push({
      name,
      description: config.description ?? "",
      shape: config.inputSchema as CapturedShape,
    });
  }
}

/** Um grupo de tools do servidor: a área funcional + o registrar que a popula. */
export interface CatalogGroup {
  area: string;
  register: (server: CapturingServer) => void;
}

/** Catálogo extraído + índices derivados (nomes e área por nome). */
export interface Catalog {
  tools: CatalogTool[];
  /** Conjunto de nomes, para validação O(1) de fixtures. */
  toolNames: Set<string>;
  /** Nome da tool -> área grossa (para o relatório de acurácia por área). */
  areaByName: Map<string, string>;
}

// ---------------------------------------------------------------------------
// Conversão zod -> JSON-schema.
//
// O zod 4 traz `z.toJSONSchema` nativo e estável entre versões — o harness não adiciona
// dependência nova nem alcança internals privados. Convertemos em modo `io: "input"`:
// um param é required sse não é `.optional()` nem `.default()` (campo com default é
// suprido pelo servidor, o modelo não precisa enviá-lo). O resultado é normalizado ao
// contrato JsonSchema deste harness: a saída nativa omite `additionalProperties` e
// descarta `required` quando vazio.
// ---------------------------------------------------------------------------

function isZodType(x: unknown): x is ZodTypeAny {
  return !!x && typeof (x as { safeParse?: unknown }).safeParse === "function";
}

/** Converte o shape capturado (cru ou `z.object` pronto) em JSON-schema de input. */
export function shapeToJsonSchema(shape: CapturedShape): JsonSchema {
  const objectSchema = isZodType(shape) ? shape : z.object((shape ?? {}) as ZodRawShape);
  const raw = z.toJSONSchema(objectSchema, { io: "input" }) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  return {
    type: "object",
    properties: raw.properties ?? {},
    required: raw.required ?? [],
    additionalProperties: false,
  };
}

/** Monta o catálogo completo rodando o registrar de cada grupo. */
export function buildCatalog(groups: CatalogGroup[]): Catalog {
  const tools: CatalogTool[] = [];
  for (const group of groups) {
    const server = new CapturingServer();
    group.register(server);
    for (const t of server.captured) {
      tools.push({
        name: t.name,
        description: t.description,
        area: group.area,
        inputSchema: shapeToJsonSchema(t.shape),
      });
    }
  }
  return {
    tools,
    toolNames: new Set(tools.map((t) => t.name)),
    areaByName: new Map(tools.map((t) => [t.name, t.area])),
  };
}

/** Definição de tool no formato do array `tools` da Anthropic Messages API. */
export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: JsonSchema;
}

/** Array `tools` da Anthropic Messages API construído a partir do catálogo. */
export function catalogAsAnthropicTools(catalog: Catalog): AnthropicTool[] {
  return catalog.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}
