import type { RetrievalAnomalyKind } from "@sbissoli/mcp-provenance";

/**
 * Classe do erro final de uma ida à origem.
 *
 * As seis primeiras são o vocabulário FECHADO de `retrieval.anomalies` do contrato de
 * proveniência v1.1 (mesmo nome, mesma grafia). As duas últimas NÃO são anomalias:
 * - `not_found`: a origem respondeu 404. Ausência é resposta, não falha — quem decide o
 *   que ela significa (recurso inexistente × chave fora da cobertura × rota errada) é o
 *   servidor, lendo `body`/`response`.
 * - `aborted`: o `signal` passado pelo chamador abortou. Não foi a origem que falhou.
 */
export type UpstreamErrorKind = RetrievalAnomalyKind | "not_found" | "aborted";

export interface UpstreamErrorInit {
  url: string;
  kind: UpstreamErrorKind;
  /** Status HTTP quando uma resposta chegou; `undefined` em timeout/rede/abort. */
  status?: number | undefined;
  /** Se uma nova tentativa faria sentido (classe repetível). Informativo no erro final. */
  retryable: boolean;
  /**
   * `true` só quando NADA chegou da origem: DNS, TCP, TLS, timeout, abort. Resposta que
   * chegou e foi rejeitada (status, corpo inválido) NÃO é transporte, mesmo com 502.
   */
  transport: boolean;
  /** Tentativas feitas nesta ida (>= 1), incluindo a que gerou este erro. */
  attempts: number;
  /** `Retry-After` da última resposta, em ms, quando presente e interpretável. */
  retryAfterMs?: number | undefined;
  /** Corpo textual da última resposta, quando foi lido (modos `text`/`json`). */
  body?: string | undefined;
  /** Última resposta, sem o corpo consumido (modo `response`). */
  response?: Response | undefined;
  cause?: unknown;
  message?: string | undefined;
}

export class UpstreamError extends Error {
  readonly url: string;
  readonly kind: UpstreamErrorKind;
  readonly status: number | undefined;
  readonly retryable: boolean;
  readonly transport: boolean;
  readonly attempts: number;
  readonly retryAfterMs: number | undefined;
  readonly body: string | undefined;
  readonly response: Response | undefined;

  constructor(init: UpstreamErrorInit) {
    super(init.message ?? describe(init), init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "UpstreamError";
    this.url = init.url;
    this.kind = init.kind;
    this.status = init.status;
    this.retryable = init.retryable;
    this.transport = init.transport;
    this.attempts = init.attempts;
    this.retryAfterMs = init.retryAfterMs;
    this.body = init.body;
    this.response = init.response;
  }

  /** `true` quando `kind` pertence ao vocabulário de anomalias do contrato. */
  get isAnomaly(): boolean {
    return this.kind !== "not_found" && this.kind !== "aborted";
  }
}

function describe(init: UpstreamErrorInit): string {
  const tent = init.attempts === 1 ? "1 tentativa" : `${init.attempts} tentativas`;
  switch (init.kind) {
    case "timeout":
      return `[${init.url}] Timeout ao acessar a origem (${tent}).`;
    case "network":
      return `[${init.url}] Erro de rede ao acessar a origem (${tent}).`;
    case "rate_limited":
      return `[${init.url}] A origem limitou a taxa de requisições (HTTP 429, ${tent}).`;
    case "http_5xx":
      return `[${init.url}] A origem respondeu HTTP ${init.status} (${tent}).`;
    case "http_4xx":
      return `[${init.url}] A origem recusou a requisição (HTTP ${init.status}).`;
    case "malformed_body":
      return `[${init.url}] A origem respondeu com corpo inesperado (${tent}).`;
    case "not_found":
      return `[${init.url}] A origem não tem registro para este recurso (HTTP 404).`;
    case "aborted":
      return `[${init.url}] Requisição cancelada pelo chamador.`;
  }
}
