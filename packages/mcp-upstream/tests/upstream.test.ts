import { describe, expect, it, vi } from "vitest";
import { normalizeRetrieval, RetrievalInputSchema } from "@sbissoli/mcp-provenance";
import { UpstreamError, createUpstream, type UpstreamOptions } from "../src/index.js";

/**
 * Harness offline: relógio, sono e fetch injetados. `sleep` avança o relógio, então o
 * orçamento é medido de verdade, sem esperar de verdade.
 */
function harness(
  responders: Array<(url: string, init: RequestInit) => Response | Promise<Response>>,
  options: UpstreamOptions = {},
) {
  let t = Date.parse("2026-09-26T12:00:00Z");
  const waits: number[] = [];
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const next = responders.shift();
    if (!next) throw new Error(`fetch inesperado: ${url}`);
    return next(url, init ?? {});
  }) as unknown as typeof fetch;
  const upstream = createUpstream({
    fetchImpl,
    now: () => t,
    sleep: async (ms) => {
      waits.push(ms);
      t += ms;
    },
    random: () => 0,
    backoff: { baseMs: 1_000, maxMs: 8_000, jitterMs: 0 },
    ...options,
  });
  return { upstream, waits, calls, clock: () => t, advance: (ms: number) => (t += ms) };
}

const ok = (body: unknown, headers?: Record<string, string>) => () =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });
const status = (code: number, body = "", headers?: Record<string, string>) => () =>
  new Response(body, { status: code, ...(headers ? { headers } : {}) });
const throws = (err: unknown) => () => {
  throw err;
};
const URL_A = "https://origem.exemplo/a";
const URL_B = "https://origem.exemplo/b";

async function fails(p: Promise<unknown>): Promise<UpstreamError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof UpstreamError) return e;
    throw new Error(`esperava UpstreamError, veio ${String(e)}`);
  }
  throw new Error("esperava falha, houve sucesso");
}

describe("contagem por chamada", () => {
  it("ida limpa: 1 request, 1 attempt, sem anomalia", async () => {
    const h = harness([ok({ x: 1 })]);
    const call = h.upstream.call();
    expect(await call.json(URL_A)).toEqual({ x: 1 });
    expect(call.retrieval()).toEqual({ requests: 1, attempts: 1, anomalies: [] });
    expect(h.waits).toEqual([]);
  });

  it("retrieval() é null sem nenhuma ida à origem — o contrato manda null, não {1,1}", () => {
    const h = harness([]);
    const call = h.upstream.call();
    expect(call.retrieval()).toBeNull();
    call.recordCache(URL_A, "2026-09-01T00:00:00Z");
    expect(call.retrieval()).toBeNull();
  });

  it("1 retry em 5xx: attempts 2, anomalia http_5xx", async () => {
    const h = harness([status(503), ok([1])]);
    const call = h.upstream.call();
    expect(await call.json(URL_A)).toEqual([1]);
    expect(call.retrieval()).toEqual({ requests: 1, attempts: 2, anomalies: [{ kind: "http_5xx", count: 1 }] });
    expect(h.waits).toEqual([1_000]);
  });

  it("duas idas, uma repetida: requests 2, attempts 3", async () => {
    const h = harness([ok(1), status(500), ok(2)]);
    const call = h.upstream.call();
    await call.json(URL_A);
    await call.json(URL_B);
    expect(call.retrieval()).toEqual({ requests: 2, attempts: 3, anomalies: [{ kind: "http_5xx", count: 1 }] });
    expect(call.accesses().map((a) => a.url)).toEqual([URL_A, URL_B]);
  });

  it("429 com Retry-After: espera o maior entre Retry-After e backoff, anomalia rate_limited", async () => {
    const h = harness([status(429, "", { "retry-after": "3" }), ok("ok")]);
    const call = h.upstream.call();
    expect(await call.json(URL_A)).toBe("ok");
    expect(h.waits).toEqual([3_000]);
    expect(call.retrieval()).toEqual({ requests: 1, attempts: 2, anomalies: [{ kind: "rate_limited", count: 1 }] });
  });

  it("Retry-After menor que o backoff não encurta a espera", async () => {
    const h = harness([status(429, "", { "retry-after": "0" }), ok("ok")]);
    await h.upstream.call().json(URL_A);
    expect(h.waits).toEqual([1_000]);
  });

  it("honorRetryAfter: false ignora o cabeçalho", async () => {
    const h = harness([status(429, "", { "retry-after": "30" }), ok("ok")], { honorRetryAfter: false });
    await h.upstream.call().json(URL_A);
    expect(h.waits).toEqual([1_000]);
  });

  it("rede (fetch lançou): anomalia network, transport no erro final", async () => {
    const h = harness([throws(new TypeError("fetch failed")), throws(new TypeError("fetch failed")), throws(new TypeError("fetch failed"))]);
    const call = h.upstream.call();
    const err = await fails(call.json(URL_A));
    expect(err.kind).toBe("network");
    expect(err.transport).toBe(true);
    expect(err.status).toBeUndefined();
    expect(err.retryable).toBe(true);
    expect(err.attempts).toBe(3);
    expect(err.cause).toBeInstanceOf(TypeError);
    expect(h.waits).toEqual([1_000, 2_000]);
  });

  it("malformed_body contornado por inspectBody: 1 retry, anomalia malformed_body", async () => {
    const h = harness([() => new Response("<html>manutenção</html>", { status: 200 }), ok({ serie: [] })], {
      inspectBody: (_res, body) => (body.trimStart().startsWith("<") ? "malformed_body" : null),
    });
    const call = h.upstream.call();
    expect(await call.json(URL_A)).toEqual({ serie: [] });
    expect(call.retrieval()).toEqual({ requests: 1, attempts: 2, anomalies: [{ kind: "malformed_body", count: 1 }] });
  });

  it("JSON inválido em 200 é malformed_body e repete; o erro final leva o corpo", async () => {
    const h = harness([() => new Response("{oops", { status: 200 }), () => new Response("{oops", { status: 200 })], {
      retries: 1,
    });
    const err = await fails(h.upstream.call().json(URL_A));
    expect(err.kind).toBe("malformed_body");
    expect(err.body).toBe("{oops");
    expect(err.status).toBe(200);
    expect(err.transport).toBe(false);
    expect(err.attempts).toBe(2);
  });

  it("text() aplica inspectBody mas não exige JSON", async () => {
    const h = harness([() => new Response("a;b;c", { status: 200 })]);
    expect(await h.upstream.call().text(URL_A)).toBe("a;b;c");
  });

  it("404 final: not_found, não repete, NÃO é anomalia, mas a ida e a tentativa contam", async () => {
    const h = harness([status(404, '{"detail":"No static resource x"}')]);
    const call = h.upstream.call();
    const err = await fails(call.json(URL_A));
    expect(err.kind).toBe("not_found");
    expect(err.status).toBe(404);
    expect(err.retryable).toBe(false);
    expect(err.isAnomaly).toBe(false);
    expect(err.body).toBe('{"detail":"No static resource x"}');
    expect(err.attempts).toBe(1);
    expect(h.waits).toEqual([]);
    // Outra fatia teve sucesso: o 404 entra na contagem de idas, não nas anomalias.
    h.calls.length = 0;
    const h2 = harness([status(404), ok(1)]);
    const call2 = h2.upstream.call();
    await fails(call2.json(URL_A));
    await call2.json(URL_B);
    expect(call2.retrieval()).toEqual({ requests: 2, attempts: 2, anomalies: [] });
  });

  it("outro 4xx é http_4xx e não repete por padrão", async () => {
    const h = harness([status(400, "bad")]);
    const err = await fails(h.upstream.call().json(URL_A));
    expect(err.kind).toBe("http_4xx");
    expect(err.retryable).toBe(false);
    expect(err.isAnomaly).toBe(true);
    expect(h.waits).toEqual([]);
  });

  it("retryOn customizado pode repetir http_4xx e vetar http_5xx", async () => {
    const h = harness([status(400), ok(1), status(500)], {
      retryOn: (ctx) => ctx.kind === "http_4xx",
    });
    const call = h.upstream.call();
    expect(await call.json(URL_A)).toBe(1);
    const err = await fails(call.json(URL_B));
    expect(err.kind).toBe("http_5xx");
    expect(err.retryable).toBe(false);
    expect(h.waits).toEqual([1_000]);
  });

  it("tentativa final que falha TAMBÉM é anomalia: fatia engolida sai instável, não limpa", async () => {
    const h = harness([status(502), ok(1)], { retries: 0 });
    const call = h.upstream.call();
    await fails(call.json(URL_A)); // o servidor engole e segue
    await call.json(URL_B);
    const r = call.retrieval()!;
    expect(r).toEqual({ requests: 2, attempts: 2, anomalies: [{ kind: "http_5xx", count: 1 }] });
    expect(normalizeRetrieval(RetrievalInputSchema.parse(r)).unstable).toBe(true);
  });

  it("esgota os retries: erro final leva attempts e retryable", async () => {
    const h = harness([status(500), status(500), status(500)]);
    const err = await fails(h.upstream.call().json(URL_A));
    expect(err.attempts).toBe(3);
    expect(err.retryable).toBe(true);
    expect(err.message).toMatch(/HTTP 500 \(3 tentativas\)/);
  });
});

describe("política por ida (retries, backoff, retryOn por requisição)", () => {
  // A repetição justa depende da forma do pedido, como o timeout: o ibge dá 4 retries a
  // uma consulta principal e 2 a um enriquecimento de melhor esforço, no mesmo coletor.
  it("retries por requisição valem só naquela ida; a política segue nas outras", async () => {
    const h = harness([status(500), status(500), status(500), status(500), ok("principal")], { retries: 4 });
    const call = h.upstream.call();
    const err = await fails(call.json(URL_A, { retries: 1 }));
    expect(err.attempts).toBe(2);
    expect(err.retryable).toBe(true);
    // Sobraram 3 respostas: 500, 500, ok — a política de 4 retries absorve as duas.
    expect(await call.json(URL_B)).toBe("principal");
    expect(call.retrieval()).toEqual({ requests: 2, attempts: 5, anomalies: [{ kind: "http_5xx", count: 4 }] });
    for (const c of h.calls) expect("retries" in c.init).toBe(false);
  });

  it("backoff por requisição é parcial e mesclado sobre o da política", async () => {
    const h = harness([status(503), status(503), ok(1), status(503), ok(2)]);
    const call = h.upstream.call();
    expect(await call.json(URL_A, { backoff: { baseMs: 500 } })).toBe(1);
    expect(await call.json(URL_B)).toBe(2);
    // 500, 1000 (base 500 dobrando, teto 8000 da política); depois 1000 da política.
    expect(h.waits).toEqual([500, 1_000, 1_000]);
    for (const c of h.calls) expect("backoff" in c.init).toBe(false);
  });

  it("retryOn por requisição veta o 500 de uma ida sem mudar a política", async () => {
    // O caso do ibge: a API de Agregados responde 500 a parâmetro inválido — determinístico,
    // repetir só gasta tempo — mas o 500 de outra API continua transitório.
    const h = harness([status(500), status(500), ok("outra")]);
    const call = h.upstream.call();
    const err = await fails(call.json(URL_A, { retryOn: (ctx) => ctx.status !== 500 }));
    expect(err.attempts).toBe(1);
    expect(err.retryable).toBe(false);
    expect(await call.json(URL_B)).toBe("outra");
    expect(h.waits).toEqual([1_000]);
    for (const c of h.calls) expect("retryOn" in c.init).toBe(false);
  });

  it("o `cause` chega ao retryOn: só a rejeição que É rede se repete", async () => {
    const vistos: unknown[] = [];
    const h = harness([throws(new Error("HTTP 404: Not Found")), ok(1)], {
      retryOn: (ctx) => {
        vistos.push(ctx.cause);
        return ctx.cause instanceof Error && /ECONNRESET|fetch failed/.test(ctx.cause.message);
      },
    });
    const err = await fails(h.upstream.call().json(URL_A));
    expect(err.kind).toBe("network");
    expect(err.attempts).toBe(1);
    expect(vistos).toHaveLength(1);
    expect((vistos[0] as Error).message).toBe("HTTP 404: Not Found");
    expect(h.waits).toEqual([]);
  });

  it("retries inválido na requisição falha alto, como o timeoutMs", async () => {
    const h = harness([ok(1)]);
    await expect(h.upstream.call().json(URL_A, { retries: -1 })).rejects.toThrow(RangeError);
  });
});

describe("orçamento e timeout", () => {
  it("Retry-After maior que o que sobra do orçamento desiste na hora, sem dormir", async () => {
    const h = harness([status(429, "", { "retry-after": "60" })], { budgetMs: 10_000 });
    const err = await fails(h.upstream.call().json(URL_A));
    expect(err.kind).toBe("rate_limited");
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(60_000);
    expect(err.attempts).toBe(1);
    expect(h.waits).toEqual([]);
  });

  it("backoff que estoura o orçamento também desiste cedo", async () => {
    const h = harness([status(500), status(500), status(500)], { budgetMs: 2_500, retries: 5 });
    const err = await fails(h.upstream.call().json(URL_A));
    // 1ª espera 1 000 (sobram 1 500); 2ª espera 2 000 >= 1 500 → desiste
    expect(h.waits).toEqual([1_000]);
    expect(err.attempts).toBe(2);
  });

  it("timeout por tentativa: aborta, classifica timeout, repete", async () => {
    // Nunca responde; só o abort do timeout o encerra.
    const hang = (_u: string, init: RequestInit) =>
      new Promise<Response>((_, reject) =>
        init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
      );
    const h = harness([hang, ok("depois")], { timeoutMs: 20 });
    const call = h.upstream.call();
    expect(await call.json(URL_A)).toBe("depois");
    expect(call.retrieval()).toEqual({ requests: 1, attempts: 2, anomalies: [{ kind: "timeout", count: 1 }] });
    const err = await fails(harness([hang, hang, hang], { timeoutMs: 20 }).upstream.call().json(URL_A));
    expect(err.attempts).toBe(3);
    expect(err.kind).toBe("timeout");
    expect(err.transport).toBe(true);
  });

  it("timeoutMs por requisição substitui o da política só naquela ida, no MESMO coletor", async () => {
    // O prazo justo depende da forma do pedido (bcb: 6 s para `ultimos/N`, 30 s para
    // janela larga). A política diz 30 s; a ida pequena pede 20 ms e é ela que estoura.
    const hang = (_u: string, init: RequestInit) =>
      new Promise<Response>((_, reject) =>
        init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
      );
    const h = harness([hang, ok("pequena"), ok("larga")], { timeoutMs: 30_000 });
    const call = h.upstream.call();
    expect(await call.json(URL_A, { timeoutMs: 20 })).toBe("pequena");
    expect(await call.json(URL_B)).toBe("larga");
    // Uma contagem só: 2 idas, 3 tentativas, o timeout da pequena.
    expect(call.retrieval()).toEqual({ requests: 2, attempts: 3, anomalies: [{ kind: "timeout", count: 1 }] });
    // O override é do pacote, não do fetch: nunca vaza para o `init` da origem.
    for (const c of h.calls) expect("timeoutMs" in c.init).toBe(false);
    // Valor inválido falha alto, como as opções da política.
    await expect(call.json(URL_A, { timeoutMs: -1 })).rejects.toThrow(RangeError);
  });

  it("timeout lendo o CORPO é timeout, mas não é transporte (a resposta chegou)", async () => {
    const h = harness(
      [
        (_u, init) =>
          new Response(
            new ReadableStream({
              start(controller) {
                init.signal!.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
              },
            }),
            { status: 200 },
          ),
      ],
      { timeoutMs: 20, retries: 0 },
    );
    const err = await fails(h.upstream.call().json(URL_A));
    expect(err.kind).toBe("timeout");
    expect(err.transport).toBe(false);
    expect(err.status).toBe(200);
  });

  it("abort do chamador é `aborted`: não é anomalia e não repete", async () => {
    const ac = new AbortController();
    const h = harness([
      (_u, init) =>
        new Promise<Response>((_, reject) => {
          init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          ac.abort();
        }),
    ]);
    const call = h.upstream.call();
    const err = await fails(call.json(URL_A, { signal: ac.signal }));
    expect(err.kind).toBe("aborted");
    expect(err.isAnomaly).toBe(false);
    expect(call.retrieval()).toEqual({ requests: 1, attempts: 1, anomalies: [] });
  });
});

describe("determinismo e contrato", () => {
  it("anomalias saem somadas por classe na ordem canônica, seja qual for a ordem de coleta", async () => {
    const h = harness([status(429), status(500), status(429), ok(1)], { retries: 3 });
    const call = h.upstream.call();
    await call.json(URL_A);
    const r = call.retrieval()!;
    expect(r.anomalies).toEqual([
      { kind: "http_5xx", count: 1 },
      { kind: "rate_limited", count: 2 },
    ]);
    // O que o pacote devolve é exatamente o que a lib de proveniência aceita.
    const norm = normalizeRetrieval(RetrievalInputSchema.parse(r));
    expect(norm).toEqual({ requests: 1, attempts: 4, anomalies: r.anomalies, unstable: true });
  });

  it("dois coletores da mesma política não se misturam", async () => {
    const h = harness([ok(1), status(500), ok(2)]);
    const a = h.upstream.call();
    const b = h.upstream.call();
    await a.json(URL_A);
    await b.json(URL_B);
    expect(a.retrieval()).toEqual({ requests: 1, attempts: 1, anomalies: [] });
    expect(b.retrieval()).toEqual({ requests: 1, attempts: 2, anomalies: [{ kind: "http_5xx", count: 1 }] });
  });
});

describe("cache e instante de extração", () => {
  it("recordCache não entra no retrieval, mas entra em retrievedAt e servedFromCache", async () => {
    const h = harness([ok(1)]);
    const call = h.upstream.call();
    expect(call.servedFromCache()).toBeNull();
    call.recordCache(URL_A, "2026-09-01T00:00:00Z");
    expect(call.servedFromCache()).toBe(true);
    expect(call.retrievedAt().toISOString()).toBe("2026-09-01T00:00:00.000Z");
    await call.json(URL_B);
    expect(call.servedFromCache()).toBe(false);
    expect(call.retrievedAt().toISOString()).toBe("2026-09-01T00:00:00.000Z"); // o mais antigo
    expect(call.retrieval()).toEqual({ requests: 1, attempts: 1, anomalies: [] });
    // filtro por procedência, como o bcb faz
    expect(call.servedFromCache((u) => u === URL_B)).toBe(false);
    expect(call.retrievedAt((u) => u === URL_B).getTime()).toBe(h.clock());
  });

  it("fieldSource: uma sub-fonte do cache e outra da rede, cada uma com o seu instante", async () => {
    const h = harness([ok(1)]);
    const call = h.upstream.call();
    call.recordCache(URL_A, "2026-09-25T15:00:00Z");
    await call.json(URL_B);
    expect(call.fieldSource({ fields: ["vitoria"], source_url: URL_A })).toEqual({
      fields: ["vitoria"],
      source_url: URL_A,
      dataset_id: null,
      data_vintage: null,
      retrieved_at: "2026-09-25T15:00:00.000Z",
      served_from_cache: true,
    });
    const b = call.fieldSource({ fields: ["vila_velha"], source_url: URL_B, dataset_id: "6579", data_vintage: "2025" });
    expect(b.retrieved_at).toBe(new Date(h.clock()).toISOString());
    expect(b.served_from_cache).toBe(false);
    expect([b.dataset_id, b.data_vintage]).toEqual(["6579", "2025"]);
    // o bloco: o mais antigo entre as duas — a regra que a v1.2 do contrato cobra
    expect(call.retrievedAt().toISOString()).toBe("2026-09-25T15:00:00.000Z");
  });

  it("fieldSource: filter agrupa várias URLs; sem acesso que case, instante e cache saem null (nunca 'agora')", async () => {
    const h = harness([ok(1), ok(2)]);
    const call = h.upstream.call();
    call.recordCache(`${URL_A}?p=1`, "2026-09-20T00:00:00Z");
    await call.json(`${URL_A}?p=2`);
    const paginas = call.fieldSource({ fields: ["x"], source_url: URL_A, filter: (u) => u.startsWith(URL_A) });
    expect(paginas.retrieved_at).toBe("2026-09-20T00:00:00.000Z");
    expect(paginas.served_from_cache).toBe(false); // nem tudo veio do cache
    const nada = call.fieldSource({ fields: ["y"], source_url: "https://nao-lida.example/" });
    expect([nada.retrieved_at, nada.served_from_cache]).toEqual([null, null]);
  });

  it("fieldSource não altera a entrada do chamador", () => {
    const h = harness([]);
    const fields = ["a"];
    const fs = h.upstream.call().fieldSource({ fields, source_url: URL_A });
    fs.fields.push("b");
    expect(fields).toEqual(["a"]);
  });

  it("retrievedAt sem acesso é o instante corrente; retrievedAt inválido falha alto", () => {
    const h = harness([]);
    const call = h.upstream.call();
    expect(call.retrievedAt().getTime()).toBe(h.clock());
    expect(() => call.recordCache(URL_A, "ontem")).toThrow(RangeError);
  });
});

describe("requisição", () => {
  it("User-Agent entra quando o chamador não define o seu, e não sobrescreve o dele", async () => {
    const h = harness([ok(1), ok(2)], { userAgent: "teste-mcp/1.0" });
    const call = h.upstream.call();
    await call.json(URL_A);
    await call.json(URL_B, { headers: { "User-Agent": "meu/2" } });
    const ua = (i: number) => new Headers(h.calls[i]!.init.headers).get("user-agent");
    expect(ua(0)).toBe("teste-mcp/1.0");
    expect(ua(1)).toBe("meu/2");
    expect(h.calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("response() devolve a Response sem consumir o corpo; 404 leva a Response", async () => {
    const h = harness([ok({ a: 1 }), status(404, "nada")]);
    const call = h.upstream.call();
    const res = await call.response(URL_A);
    expect(res.bodyUsed).toBe(false);
    expect(await res.json()).toEqual({ a: 1 });
    const err = await fails(call.response(URL_B));
    expect(err.response).toBeInstanceOf(Response);
    expect(await err.response!.text()).toBe("nada");
    expect(err.body).toBeUndefined();
  });

  it("opções inválidas falham na construção", () => {
    expect(() => createUpstream({ retries: -1 })).toThrow(RangeError);
    expect(() => createUpstream({ timeoutMs: Number.NaN })).toThrow(RangeError);
    expect(() => createUpstream({ fetchImpl: undefined as unknown as typeof fetch })).not.toThrow();
  });
});
