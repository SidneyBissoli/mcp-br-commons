/**
 * Cliente MCP do runner — loop CLIENT-SIDE por stdio.
 *
 * Decisão de desenho (27/09/2026): o runner é dono do loop e fala com o servidor
 * pelo SDK oficial (`@modelcontextprotocol/client` + `StdioClientTransport`) sobre
 * o `dist/index.js` do servidor sob teste, e NÃO pelo MCP connector da Messages
 * API. Com o connector quem chama o servidor é a Anthropic — o servidor teria de
 * ser URL pública, o braço B precisaria de um proxy e a injeção de falha ficaria
 * fora do alcance. Client-side, tudo isso é local: o filtro do braço B roda aqui,
 * o `--import fault.mjs` entra no `node` que sobe o servidor, e a rodada testa o
 * build local sem deploy.
 *
 * A interface `McpToolClient` é o que o loop e o `--dry` consomem; os testes
 * offline injetam um dublê em memória e nunca sobem processo.
 *
 * O SDK é peer OPCIONAL do pacote: o entry principal (`.`) continua sem
 * dependência de runtime; só quem importa `./session` precisa dele, e o import é
 * dinâmico para que a ausência falhe com mensagem clara em vez de TS2307 na carga.
 */

import type { AnthropicTool, JsonSchema } from "../catalog.js";

export interface ToolCallOutcome {
  /** Texto que o modelo receberia (blocos `text` concatenados por linha). */
  text: string;
  isError: boolean;
  /** Erro de PROTOCOLO (JSON-RPC error), com o código quando houver. -32602 = recusa de esquema. */
  protocolError?: { code: number | null; message: string };
}

export interface McpToolClient {
  listTools(): Promise<AnthropicTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallOutcome>;
  close(): Promise<void>;
}

export interface StdioServerSpec {
  /** Executável (padrão: `process.execPath`, o mesmo node do runner). */
  command?: string;
  /** Argumentos — tipicamente `["--import", faultPreload, "dist/index.js"]` ou `["dist/index.js"]`. */
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** Nome do cliente anunciado no `initialize`. */
  clientName?: string;
}

interface SdkToolsListResult {
  tools: { name: string; description?: string; inputSchema: unknown }[];
}
interface SdkCallToolResult {
  content?: { type: string; text?: string }[];
  isError?: boolean;
}

/** Serializa os blocos de conteúdo como um cliente MCP entrega ao modelo. */
export function contentToText(content: { type: string; text?: string }[] | undefined): string {
  if (!content) return "";
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
}

/** Sobe o servidor por stdio e devolve o cliente pronto (já inicializado). */
export async function connectStdio(spec: StdioServerSpec): Promise<McpToolClient> {
  let clientMod: typeof import("@modelcontextprotocol/client");
  let stdioMod: typeof import("@modelcontextprotocol/client/stdio");
  try {
    clientMod = await import("@modelcontextprotocol/client");
    stdioMod = await import("@modelcontextprotocol/client/stdio");
  } catch (e) {
    throw new Error(
      "o runner de sessão longa precisa de `@modelcontextprotocol/client` (peer opcional de " +
        `@sbissoli/mcp-evals): npm i -D @modelcontextprotocol/client — ${(e as Error).message}`,
    );
  }

  const client = new clientMod.Client({ name: spec.clientName ?? "mcp-evals-session", version: "0.2.0" });
  const transport = new stdioMod.StdioClientTransport({
    command: spec.command ?? process.execPath,
    args: spec.args,
    ...(spec.env ? { env: { ...stdioMod.getDefaultEnvironment(), ...spec.env } } : {}),
    ...(spec.cwd ? { cwd: spec.cwd } : {}),
    // O stderr do servidor é ruído para o NDJSON, mas é onde um crash aparece:
    // herda para o terminal do operador.
    stderr: "inherit",
  });
  await client.connect(transport);

  return {
    async listTools() {
      const res = (await client.listTools()) as unknown as SdkToolsListResult;
      return res.tools.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        input_schema: t.inputSchema as JsonSchema,
      }));
    },
    async callTool(name, args) {
      try {
        const res = (await client.callTool({ name, arguments: args })) as unknown as SdkCallToolResult;
        return { text: contentToText(res.content), isError: res.isError === true };
      } catch (e) {
        const err = e as { code?: unknown; message?: string };
        const code = typeof err.code === "number" ? err.code : null;
        const message = err.message ?? String(e);
        return { text: message, isError: true, protocolError: { code, message } };
      }
    },
    async close() {
      await client.close().catch(() => {});
    },
  };
}
