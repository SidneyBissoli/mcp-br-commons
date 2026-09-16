/**
 * Entrypoint do Worker — template de hosting da Fase 0.
 *
 * Fluxo por request: rotas públicas (landing, /health, /status, /metrics) →
 * Bearer auth opcional → rate limit por cliente → createMcpHandler (stateless,
 * factory cria um McpServer novo por request — MCP SDK v2 + agents 0.20+).
 */

import { createMcpHandler } from "agents/mcp/server";
import { tagRequest, withAnalytics, recordProtocolMethods, sessionFromRequest, withSessionHeader } from "./analytics.js";
import { checkAuth } from "./auth.js";
import { SERVER_CONFIG } from "./config.js";
import { landingResponse } from "./landing.js";
import { discoveryResponseForPath } from "./discovery.js";
import { logger } from "./logger.js";
import { checkRateLimit } from "./rate-limit.js";
import { buildServer } from "./server.js";
import { buildStatus } from "./status.js";
import type { Env } from "./types.js";
import { createUsageRecorder, usageSnapshot, UsageTracker } from "./usage.js";

// O runtime instancia o Durable Object a partir do export do entrypoint.
export { UsageTracker };

function json(data: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const start = Date.now();
    const record = createUsageRecorder(env, ctx);

    // --- Rotas públicas, servidas antes de qualquer auth ---
    if (url.pathname === "/") return landingResponse();
    // robots.txt, sitemap.xml e a chave do IndexNow vêm ANTES da auth: um
    // rastreador não tem credencial, e robots.txt atrás de Bearer é o mesmo que
    // não ter robots.txt.
    const descoberta = discoveryResponseForPath(url.pathname);
    if (descoberta) return descoberta;
    if (url.pathname === "/health") {
      return new Response("ok", { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    if (url.pathname === "/status") {
      return json(buildStatus(env), { "Cache-Control": "no-store" });
    }
    if (url.pathname === "/metrics") {
      const snap = await usageSnapshot(env);
      return json(snap ?? { aviso: "binding USAGE ausente — estatísticas de uso desativadas" });
    }

    // Preflight CORS nunca carrega Authorization — o handler MCP responde o OPTIONS.
    if (request.method !== "OPTIONS") {
      const authResponse = await checkAuth(request, env.API_KEY);
      if (authResponse) {
        record("auth_failure", url.pathname);
        logger.warn("auth_failure", {
          method: request.method,
          path: url.pathname,
          status: authResponse.status,
        });
        return authResponse;
      }

      const clientId = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const decision = checkRateLimit(clientId);
      if (!decision.allowed) {
        record("rate_limited", url.pathname);
        return new Response("Too Many Requests", {
          status: 429,
          headers: { "Retry-After": String(decision.retryAfterS), "Content-Type": "text/plain" },
        });
      }
    }

    record("request", url.pathname);

    // Contexto da requisição (país/AS/marcador self) + escrita no Analytics
    // Engine pegando carona no hook de uso — ver src/analytics.ts.

    // Cópia do corpo tirada ANTES de o handler consumir o stream — é dela que a
    // telemetria lê os métodos de protocolo (recordProtocolMethods, ao final).
    // Só para o POST do endpoint MCP; corpo que não é JSON não é assunto daqui.
    const corpoMcp =
      url.pathname === SERVER_CONFIG.mcpRoute && request.method === "POST"
        ? await request
            .clone()
            .json()
            .catch(() => undefined)
        : undefined;
    // Sessão: o handler é stateless e não emite id; o Worker sorteia no
    // initialize e devolve no cabeçalho, e nas demais requisições lê o que o
    // cliente repetiu. Vai na telemetria (blob9). Ver src/analytics.ts.
    const sessao = sessionFromRequest(request, corpoMcp);
    const tag = tagRequest(request, env.SELF_MARKER, sessao.id);
    const recordWithAnalytics = withAnalytics(record, env.ANALYTICS, tag);

    const handler = createMcpHandler(() => buildServer(recordWithAnalytics), {
      route: SERVER_CONFIG.mcpRoute,
      // Sem a opção, o handler aceita localhost e *.workers.dev. Ao definir
      // extraAllowedHostnames (domínio próprio), a lista SUBSTITUI os defaults —
      // inclua nela também o hostname workers.dev se ele continuar servido.
      ...(SERVER_CONFIG.extraAllowedHostnames.length
        ? { allowedHostnames: [...SERVER_CONFIG.extraAllowedHostnames] }
        : {}),
      corsOptions: {
        origin: env.ALLOWED_ORIGIN || "*",
        methods: "GET, POST, DELETE, OPTIONS",
        headers: "Content-Type, Accept, mcp-session-id, MCP-Protocol-Version, Authorization",
        maxAge: 86400,
      },
    });

    const response = withSessionHeader(await handler(request, env, ctx), sessao);
    // Métodos de protocolo (initialize, tools/list, notifications/*...) não
    // passam pelo hook de tools: vão para o Analytics Engine daqui, com o
    // desfecho lido do HTTP da resposta. Ver recordProtocolMethods em
    // src/analytics.ts.
    recordProtocolMethods(env.ANALYTICS, tag, corpoMcp, response.status);

    logger.info("request", {
      method: request.method,
      path: url.pathname,
      status: response.status,
      ms: Date.now() - start,
    });
    return response;
  },
} satisfies ExportedHandler<Env>;
