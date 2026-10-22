import { describe, expect, it, vi } from "vitest";
import { UpstreamError, createUpstream, entregaDaOrigem, type UpstreamErrorKind } from "../src/index.js";

/**
 * A decisão é pelo `kind`, nunca pela frase. Os casos reproduzem os erros reais de
 * 22/10/2026 (SGS do BCB em 502; endpoint do Senado em 502 nas três tentativas; a
 * página HTML numa série que existe, de 24/09/2026) e cobrem a tabela inteira de
 * kinds — um teste de cobertura garante que kind novo no pacote não cai em veredito
 * por omissão sem ninguém decidir.
 */
function erro(kind: UpstreamErrorKind, extra: Partial<ConstructorParameters<typeof UpstreamError>[0]> = {}) {
  return new UpstreamError({
    url: "https://origem.exemplo/recurso",
    kind,
    retryable: false,
    transport: kind === "timeout" || kind === "network" || kind === "aborted",
    attempts: 2,
    ...extra,
  });
}

describe("entregaDaOrigem: a origem entregou algo medível?", () => {
  it("5xx é indisponível — a página do gateway não é o recurso (senado, 22/10/2026)", () => {
    const e = entregaDaOrigem(erro("http_5xx", { status: 502, body: "<html>Bad Gateway</html>", attempts: 3 }));
    expect(e.veredito).toBe("indisponivel");
    expect(e.status).toBe(502);
    expect(e.motivo).toContain("HTTP 502");
    expect(e.motivo).toContain("3 tentativas");
    expect(e.motivo).toContain("não é deriva");
  });

  it("timeout, rede e 429 são indisponível", () => {
    expect(entregaDaOrigem(erro("timeout")).veredito).toBe("indisponivel");
    expect(entregaDaOrigem(erro("network")).veredito).toBe("indisponivel");
    expect(entregaDaOrigem(erro("rate_limited", { status: 429, retryAfterMs: 5_000 })).veredito).toBe("indisponivel");
    expect(entregaDaOrigem(erro("timeout", { attempts: 1 })).motivo).toContain("1 tentativa;");
  });

  it("404 e outro 4xx são resposta, não indisponibilidade", () => {
    const nf = entregaDaOrigem(erro("not_found", { status: 404 }));
    expect(nf.veredito).toBe("respondeu");
    expect(nf.motivo).toContain("HTTP 404");
    expect(entregaDaOrigem(erro("http_4xx", { status: 406 })).veredito).toBe("respondeu");
  });

  it("corpo que não é o esperado é ambíguo — deriva OU página de erro num pedido bom (SGS 432, 24/09/2026)", () => {
    const e = entregaDaOrigem(erro("malformed_body", { status: 200, body: "<html>requisição inválida</html>" }));
    expect(e.veredito).toBe("ambiguo");
    expect(e.motivo).toContain("HTTP 200");
    expect(e.motivo).toContain("repetir em outra ida decide");
  });

  it("abort do chamador e erro que não é UpstreamError são alheios à origem", () => {
    expect(entregaDaOrigem(erro("aborted")).veredito).toBe("alheio");
    const bug = entregaDaOrigem(new TypeError("Cannot read properties of undefined"));
    expect(bug.veredito).toBe("alheio");
    expect(bug.kind).toBeUndefined();
    expect(bug.motivo).toContain("TypeError");
    expect(entregaDaOrigem("string solta").veredito).toBe("alheio");
  });

  it("todo kind do pacote tem veredito decidido — kind novo não cai em omissão", () => {
    const kinds: UpstreamErrorKind[] = [
      "timeout",
      "network",
      "rate_limited",
      "http_5xx",
      "http_4xx",
      "malformed_body",
      "not_found",
      "aborted",
    ];
    const esperado: Record<UpstreamErrorKind, string> = {
      timeout: "indisponivel",
      network: "indisponivel",
      rate_limited: "indisponivel",
      http_5xx: "indisponivel",
      http_4xx: "respondeu",
      not_found: "respondeu",
      malformed_body: "ambiguo",
      aborted: "alheio",
    };
    for (const k of kinds) expect(entregaDaOrigem(erro(k)).veredito, k).toBe(esperado[k]);
  });

  it("de ponta a ponta: 502 em todas as tentativas pelo createUpstream sai indisponível, com url e status", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>502</html>", { status: 502 })) as unknown as typeof fetch;
    const upstream = createUpstream({
      fetchImpl,
      sleep: async () => {},
      random: () => 0,
      retries: 2,
      backoff: { baseMs: 1, maxMs: 1, jitterMs: 0 },
    });
    const call = upstream.call();
    let capturado: unknown;
    try {
      await call.text("https://api.exemplo/recurso");
    } catch (err) {
      capturado = err;
    }
    const e = entregaDaOrigem(capturado);
    expect(e.veredito).toBe("indisponivel");
    expect(e.kind).toBe("http_5xx");
    expect(e.status).toBe(502);
    expect(e.url).toBe("https://api.exemplo/recurso");
    expect(e.motivo).toContain("3 tentativas");
  });
});
