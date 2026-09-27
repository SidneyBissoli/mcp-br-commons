/**
 * Fetch comum dos servidores MCP do portfólio.
 *
 * Um `Upstream` guarda a política (timeout, retries, orçamento, backoff). Cada chamada
 * de tool abre UM `UpstreamCall` — o coletor explícito daquela chamada — e faz por ele
 * todas as idas à origem (`json`, `text`, `response`). Ao final, `call.retrieval()`
 * devolve o `RetrievalInput` do contrato de proveniência v1.1: quantas idas, quantas
 * tentativas, quais anomalias — MEDIÇÃO REAL, nunca inventada.
 *
 * O núcleo não usa AsyncLocalStorage: o coletor é um objeto passado à mão. Quem já
 * carrega contexto por ALS (bcb, medical, senado) usa o adaptador em `./als`.
 *
 * Todo I/O é injetável (`fetchImpl`, `sleep`, `now`, `random`), então o comportamento
 * inteiro — contagens, esperas, desistência por orçamento — é provado offline.
 */

import { RetrievalAnomalyKindSchema, type RetrievalAnomalyKind, type RetrievalInput } from "@sbissoli/mcp-provenance";
import { UpstreamError, type UpstreamErrorKind } from "./errors.js";
import { parseRetryAfterMs, retryWaitMs, type BackoffSpec } from "./retry-after.js";

/** O que `retryOn` recebe para decidir se a tentativa que acabou de falhar se repete. */
export interface RetryContext {
  url: string;
  /** Tentativa que falhou, 1-based. */
  attempt: number;
  kind: RetrievalAnomalyKind;
  status: number | undefined;
  /** Resposta que chegou (status/cabeçalhos legíveis; corpo já consumido nos modos text/json). */
  response: Response | undefined;
  /** Corpo lido, quando o modo lê corpo. */
  body: string | undefined;
  /**
   * O que o `fetch` lançou (`network`, `timeout` no corpo) ou o que o parse lançou
   * (`malformed_body`). Existe porque "o fetch lançou" não é sempre rede: o ibge
   * distingue `ECONNRESET` (repete) de um `Error` que outra camada lançou dentro do
   * fetch (não repete), e só o `cause` separa os dois. `undefined` quando a falha
   * veio de um status.
   */
  cause?: unknown;
}

export interface UpstreamOptions {
  /** Enviado como `User-Agent` quando o chamador não define o seu. */
  userAgent?: string | undefined;
  /** Teto de UMA tentativa (cabeçalhos + corpo), em ms. Default 10 000. */
  timeoutMs?: number | undefined;
  /** Retries ALÉM da primeira tentativa. Default 2 (até 3 tentativas). */
  retries?: number | undefined;
  /**
   * Orçamento TOTAL de uma ida à origem, em ms, incluindo as esperas entre tentativas.
   * Uma tentativa nunca recebe mais que o que sobra dele; uma espera que o estouraria
   * faz desistir na hora, com o erro repetível. Default 30 000.
   */
  budgetMs?: number | undefined;
  backoff?: Partial<BackoffSpec> | undefined;
  /** Honrar `Retry-After` da origem ao calcular a espera. Default `true`. */
  honorRetryAfter?: boolean | undefined;
  /**
   * Decide se uma falha se repete. Default: `timeout`, `network`, `rate_limited`,
   * `http_5xx` e `malformed_body` repetem; `http_4xx` não. O número de retries e o
   * orçamento continuam valendo por cima da decisão.
   */
  retryOn?: ((ctx: RetryContext) => boolean) | undefined;
  /**
   * Inspeciona um corpo que chegou com status OK (modos `text` e `json`, ANTES do
   * parse). Devolver `"malformed_body"` marca a tentativa como falha dessa classe —
   * é como bcb detecta HTML-em-200 e senado o corpo vazio. `null` aceita o corpo.
   */
  inspectBody?: ((response: Response, body: string) => "malformed_body" | null) | undefined;
  /** Injeções para teste offline. */
  fetchImpl?: typeof fetch | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  now?: (() => number) | undefined;
  random?: (() => number) | undefined;
}

export interface ResolvedUpstreamOptions {
  userAgent: string | undefined;
  timeoutMs: number;
  retries: number;
  budgetMs: number;
  backoff: BackoffSpec;
  honorRetryAfter: boolean;
  retryOn: (ctx: RetryContext) => boolean;
  inspectBody: ((response: Response, body: string) => "malformed_body" | null) | undefined;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  random: () => number;
}

export const DEFAULT_BACKOFF: BackoffSpec = { baseMs: 1_000, maxMs: 8_000, jitterMs: 500 };

const RETRYABLE_BY_DEFAULT: ReadonlySet<RetrievalAnomalyKind> = new Set([
  "timeout",
  "network",
  "rate_limited",
  "http_5xx",
  "malformed_body",
]);

/** Política padrão de repetição: só o que é transitório por natureza. */
export function defaultRetryOn(ctx: RetryContext): boolean {
  return RETRYABLE_BY_DEFAULT.has(ctx.kind);
}

/** Um acesso registrado no coletor: ida real à origem ou acerto de cache do servidor. */
export interface UpstreamAccess {
  url: string;
  /** Instante da extração: agora, se veio da rede; o instante original, se veio do cache. */
  retrievedAt: Date;
  fromCache: boolean;
}

export type UpstreamRequestInit = Omit<RequestInit, "signal"> & {
  signal?: AbortSignal | undefined;
  /**
   * Teto de UMA tentativa só para esta ida, em ms, no lugar do `timeoutMs` da política.
   * Existe porque o prazo justo depende da FORMA do pedido, não do servidor: o bcb dá 6 s
   * a um pedido de 20 observações (resposta real ≤ 0,4 s; código inexistente leva ~30 s
   * para negar) e 30 s a uma janela diária larga — na mesma chamada, no mesmo coletor.
   * O orçamento total continua o da política.
   */
  timeoutMs?: number | undefined;
  /**
   * Política de repetição só para esta ida, no lugar da política do coletor: `retries`
   * (além da primeira tentativa), `backoff` (parcial, mesclado sobre o da política) e
   * `retryOn`. Existe pelo mesmo motivo do `timeoutMs`: a repetição justa também depende
   * da FORMA do pedido. O ibge dá 4 retries de 2→16 s a uma consulta principal e 2 de
   * 0,5→2 s a um enriquecimento de melhor esforço, e NÃO repete o 500 da API de
   * Agregados (que ela responde a parâmetro inválido, determinístico) — três políticas
   * numa chamada, num coletor só. `budgetMs` continua o da política, por cima de tudo.
   */
  retries?: number | undefined;
  backoff?: Partial<BackoffSpec> | undefined;
  retryOn?: ((ctx: RetryContext) => boolean) | undefined;
};

export function resolveOptions(options: UpstreamOptions = {}): ResolvedUpstreamOptions {
  const backoff: BackoffSpec = { ...DEFAULT_BACKOFF, ...stripUndefined(options.backoff ?? {}) };
  const resolved: ResolvedUpstreamOptions = {
    userAgent: options.userAgent,
    timeoutMs: options.timeoutMs ?? 10_000,
    retries: options.retries ?? 2,
    budgetMs: options.budgetMs ?? 30_000,
    backoff,
    honorRetryAfter: options.honorRetryAfter ?? true,
    retryOn: options.retryOn ?? defaultRetryOn,
    inspectBody: options.inspectBody,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    sleep: options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    now: options.now ?? Date.now,
    random: options.random ?? Math.random,
  };
  for (const [k, v] of Object.entries({ timeoutMs: resolved.timeoutMs, retries: resolved.retries, budgetMs: resolved.budgetMs })) {
    if (!Number.isFinite(v) || v < 0) throw new RangeError(`mcp-upstream: ${k} deve ser um número >= 0 (recebido ${String(v)})`);
  }
  if (typeof resolved.fetchImpl !== "function") {
    throw new TypeError("mcp-upstream: nenhum fetch disponível — passe fetchImpl");
  }
  return resolved;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

/**
 * Coletor de UMA chamada de tool. Conta idas, tentativas e anomalias; guarda os
 * instantes de extração para `retrievedAt()`/`servedFromCache()`.
 */
export class UpstreamCall {
  readonly options: ResolvedUpstreamOptions;
  #requests = 0;
  #attempts = 0;
  readonly #anomalies = new Map<RetrievalAnomalyKind, number>();
  readonly #accesses: UpstreamAccess[] = [];

  constructor(options: ResolvedUpstreamOptions) {
    this.options = options;
  }

  /** Idas à origem iniciadas nesta chamada (as que falharam de vez também contam). */
  get requests(): number {
    return this.#requests;
  }

  /** Tentativas somadas, incluindo as repetidas (>= requests). */
  get attempts(): number {
    return this.#attempts;
  }

  /** Acessos registrados, na ordem em que aconteceram (rede e cache). */
  accesses(): readonly UpstreamAccess[] {
    return [...this.#accesses];
  }

  /**
   * Uma ida à origem que devolve a `Response` sem consumir o corpo. Repete em
   * status/rede/timeout; `inspectBody` NÃO se aplica (o corpo é seu).
   */
  response(url: string, init: UpstreamRequestInit = {}): Promise<Response> {
    return this.#request(url, init, "response").then((r) => r.response);
  }

  /** Uma ida à origem lendo o corpo como texto; `inspectBody` decide se ele vale. */
  text(url: string, init: UpstreamRequestInit = {}): Promise<string> {
    return this.#request(url, init, "text").then((r) => r.body as string);
  }

  /** Uma ida à origem lendo JSON; corpo que não parseia é `malformed_body` (repetível). */
  json<T = unknown>(url: string, init: UpstreamRequestInit = {}): Promise<T> {
    return this.#request(url, init, "json").then((r) => r.parsed as T);
  }

  /**
   * Registra um acerto de cache do SERVIDOR (o pacote não cacheia). Não entra em
   * `retrieval` — o dado não foi buscado nesta chamada — mas entra em `retrievedAt()` e
   * `servedFromCache()`, que descrevem a extração de que a resposta deriva.
   */
  recordCache(url: string, retrievedAt: Date | string): void {
    const at = retrievedAt instanceof Date ? retrievedAt : new Date(retrievedAt);
    if (Number.isNaN(at.getTime())) throw new RangeError(`mcp-upstream: retrievedAt inválido para ${url}`);
    this.#accesses.push({ url, retrievedAt: at, fromCache: true });
  }

  /**
   * O bloco `retrieval` desta chamada, cru (quem normaliza e deriva `unstable` é a lib de
   * proveniência). `null` quando não houve nenhuma ida à origem — cache puro, dado local
   * — porque o contrato manda: servidor que não mediu passa `null`, não inventa.
   * As anomalias já saem somadas por classe, na ordem canônica do vocabulário.
   */
  retrieval(): RetrievalInput | null {
    if (this.#requests === 0) return null;
    const anomalies = RetrievalAnomalyKindSchema.options
      .filter((kind) => this.#anomalies.has(kind))
      .map((kind) => ({ kind, count: this.#anomalies.get(kind)! }));
    return { requests: this.#requests, attempts: this.#attempts, anomalies };
  }

  /**
   * Instante mais antigo entre os acessos (rede ou cache), como o coletor do bcb; o
   * instante corrente se não houve acesso. Filtro opcional por URL para respostas que
   * misturam procedências.
   */
  retrievedAt(filter?: (url: string) => boolean): Date {
    const acc = filter ? this.#accesses.filter((a) => filter(a.url)) : this.#accesses;
    if (acc.length === 0) return new Date(this.options.now());
    return acc.reduce((a, b) => (a.retrievedAt <= b.retrievedAt ? a : b)).retrievedAt;
  }

  /** `true` só se TODO acesso veio de cache; `null` quando não houve acesso. */
  servedFromCache(filter?: (url: string) => boolean): boolean | null {
    const acc = filter ? this.#accesses.filter((a) => filter(a.url)) : this.#accesses;
    if (acc.length === 0) return null;
    return acc.every((a) => a.fromCache);
  }

  async #request(
    url: string,
    init: UpstreamRequestInit,
    mode: "response" | "text" | "json",
  ): Promise<{ response: Response; body: string | undefined; parsed: unknown }> {
    const o = this.options;
    const {
      timeoutMs: perRequestTimeoutMs,
      retries: perRequestRetries,
      backoff: perRequestBackoff,
      retryOn: perRequestRetryOn,
      ...fetchInit
    } = init;
    for (const [k, v] of Object.entries({ timeoutMs: perRequestTimeoutMs, retries: perRequestRetries })) {
      if (v !== undefined && (!Number.isFinite(v) || v < 0)) {
        throw new RangeError(`mcp-upstream: ${k} da requisição deve ser um número >= 0 (recebido ${String(v)})`);
      }
    }
    const attemptCeilingMs = perRequestTimeoutMs ?? o.timeoutMs;
    const retries = perRequestRetries ?? o.retries;
    const backoff: BackoffSpec = perRequestBackoff ? { ...o.backoff, ...stripUndefined(perRequestBackoff) } : o.backoff;
    const retryOn = perRequestRetryOn ?? o.retryOn;
    this.#requests++;
    const started = o.now();
    const headers = new Headers(fetchInit.headers);
    if (o.userAgent !== undefined && !headers.has("user-agent")) headers.set("user-agent", o.userAgent);

    let attempt = 0;
    for (;;) {
      const remaining = o.budgetMs - (o.now() - started);
      if (attempt > 0 && remaining <= 0) {
        // Só chega aqui se uma espera foi permitida e mesmo assim o orçamento acabou
        // (relógio externo); a desistência normal acontece antes de esperar.
        throw new UpstreamError({ url, kind: "timeout", retryable: true, transport: true, attempts: attempt });
      }
      attempt++;
      this.#attempts++;

      const outcome = await this.#attempt(url, fetchInit, headers, mode, Math.min(attemptCeilingMs, remaining));
      if (outcome.ok) {
        this.#accesses.push({ url, retrievedAt: new Date(o.now()), fromCache: false });
        return { response: outcome.response, body: outcome.body, parsed: outcome.parsed };
      }

      const f = outcome.failure;
      if (f.kind === "not_found" || f.kind === "aborted") {
        throw new UpstreamError({ ...f, url, retryable: false, attempts: attempt });
      }
      // Toda tentativa falha é anomalia — superada ou final. `retrieval` só sai no
      // sucesso, então a diferença só aparece quando o servidor engole a falha de uma
      // fatia e responde parcial: e aí a resposta É instável, e o bloco tem de dizer.
      this.#anomalies.set(f.kind, (this.#anomalies.get(f.kind) ?? 0) + 1);

      const retryable = retryOn({
        url,
        attempt,
        kind: f.kind,
        status: f.status,
        response: f.response,
        body: f.body,
        cause: f.cause,
      });
      const retryAfterMs = o.honorRetryAfter ? f.retryAfterMs : undefined;
      const fail = (): never => {
        throw new UpstreamError({ ...f, url, retryable, attempts: attempt });
      };
      if (!retryable || attempt > retries) fail();

      const wait = retryWaitMs(attempt - 1, retryAfterMs ?? null, backoff, o.random);
      const left = o.budgetMs - (o.now() - started);
      // Esperar mais do que sobra do orçamento só adiaria o mesmo timeout: desiste já,
      // com o erro repetível — é o desenho do senado, e é o que o pacote tem de honrar.
      if (wait >= left) fail();
      await o.sleep(wait);
    }
  }

  async #attempt(
    url: string,
    init: UpstreamRequestInit,
    headers: Headers,
    mode: "response" | "text" | "json",
    timeoutMs: number,
  ): Promise<
    | { ok: true; response: Response; body: string | undefined; parsed: unknown }
    | { ok: false; failure: AttemptFailure }
  > {
    const o = this.options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(0, timeoutMs));
    const signal = init.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal;
    const callerAborted = (): boolean => init.signal?.aborted === true;

    try {
      let response: Response;
      try {
        response = await o.fetchImpl(url, { ...init, headers, signal });
      } catch (cause) {
        if (callerAborted()) return { ok: false, failure: { kind: "aborted", status: undefined, transport: true, cause } };
        const kind: UpstreamErrorKind = controller.signal.aborted ? "timeout" : "network";
        return { ok: false, failure: { kind, status: undefined, transport: true, cause } };
      }

      const status = response.status;
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"), o.now()) ?? undefined;
      const readBody = mode !== "response";

      if (!response.ok) {
        const kind: UpstreamErrorKind =
          status === 404 ? "not_found" : status === 429 ? "rate_limited" : status >= 500 ? "http_5xx" : "http_4xx";
        let body: string | undefined;
        if (readBody) {
          try {
            body = await response.text();
          } catch {
            body = undefined; // o status já classifica; corpo ilegível não muda a classe
          }
        }
        return {
          ok: false,
          failure: { kind, status, transport: false, retryAfterMs, body, response: readBody ? undefined : response },
        };
      }

      if (!readBody) return { ok: true, response, body: undefined, parsed: undefined };

      let body: string;
      try {
        body = await response.text();
      } catch (cause) {
        if (callerAborted()) return { ok: false, failure: { kind: "aborted", status, transport: true, cause } };
        // A resposta chegou (não é transporte), mas o corpo não: timeout no corpo é
        // timeout; qualquer outra coisa é rede.
        const kind: UpstreamErrorKind = controller.signal.aborted ? "timeout" : "network";
        return { ok: false, failure: { kind, status, transport: false, cause } };
      }

      const verdict = o.inspectBody?.(response, body) ?? null;
      if (verdict === "malformed_body") {
        return { ok: false, failure: { kind: "malformed_body", status, transport: false, body } };
      }
      if (mode === "text") return { ok: true, response, body, parsed: undefined };

      try {
        return { ok: true, response, body, parsed: JSON.parse(body) as unknown };
      } catch (cause) {
        return { ok: false, failure: { kind: "malformed_body", status, transport: false, body, cause } };
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

interface AttemptFailure {
  kind: UpstreamErrorKind;
  status: number | undefined;
  transport: boolean;
  retryAfterMs?: number | undefined;
  body?: string | undefined;
  response?: Response | undefined;
  cause?: unknown;
}

/** A política de rede de um servidor. Abre um coletor por chamada de tool com `call()`. */
export class Upstream {
  readonly options: ResolvedUpstreamOptions;

  constructor(options: UpstreamOptions = {}) {
    this.options = resolveOptions(options);
  }

  /** Um coletor novo, vazio, para UMA chamada de tool. */
  call(): UpstreamCall {
    return new UpstreamCall(this.options);
  }
}

export function createUpstream(options: UpstreamOptions = {}): Upstream {
  return new Upstream(options);
}
