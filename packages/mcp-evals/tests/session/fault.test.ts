import { describe, expect, it } from "vitest";
import { createDecider, fnv1a, parseFaultConfig, unit, wrapFetch } from "../../src/session/fault-core.js";

const CFG = { seed: 42, rules: [{ match: "api\\.bcb\\.gov\\.br", rate: 0.3, kind: "http_5xx" as const }] };

describe("injeção de falha — determinismo", () => {
  it("fnv1a/unit são puros e estáveis", () => {
    expect(fnv1a("abc")).toBe(fnv1a("abc"));
    expect(unit(1)).toBe(unit(1));
    expect(unit(1)).toBeGreaterThanOrEqual(0);
    expect(unit(1)).toBeLessThan(1);
  });

  it("mesma semente → mesma sequência de decisões; semente diferente → sequência diferente", () => {
    const urls = Array.from({ length: 200 }, (_, i) => `https://api.bcb.gov.br/dados/serie/${i}`);
    const run = (seed: number) => {
      const d = createDecider({ ...CFG, seed });
      return urls.map((u) => (d(u) ? 1 : 0));
    };
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
  });

  it("a taxa observada fica perto da pedida (30 % ± 8 pontos em 1000 idas)", () => {
    const d = createDecider(CFG);
    let fails = 0;
    for (let i = 0; i < 1000; i++) if (d(`https://api.bcb.gov.br/s/${i}`)) fails++;
    expect(fails / 1000).toBeGreaterThan(0.22);
    expect(fails / 1000).toBeLessThan(0.38);
  });

  it("idas sucessivas à MESMA URL sorteiam independentes (o retry às vezes salva)", () => {
    const d = createDecider({ seed: 7, rules: [{ match: ".", rate: 0.5, kind: "http_5xx" }] });
    const seq = Array.from({ length: 40 }, () => (d("https://x/y") ? 1 : 0));
    expect(new Set(seq).size).toBe(2);
  });

  it("URL que não casa nunca falha", () => {
    const d = createDecider(CFG);
    for (let i = 0; i < 100; i++) expect(d(`https://olinda.bcb.gov.br/${i}`)).toBeNull();
  });
});

describe("wrapFetch", () => {
  it("ida sorteada devolve o 502 falso; ida limpa passa ao fetch de base com os mesmos argumentos", async () => {
    const seen: string[] = [];
    const base = (async (input: string | URL | Request) => {
      seen.push(String(input));
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const wrapped = wrapFetch(base, { seed: 1, rules: [{ match: "falha", rate: 1, kind: "http_5xx", status: 503 }] });
    const bad = await wrapped("https://x/falha");
    expect(bad.status).toBe(503);
    const good = await wrapped("https://x/limpa");
    expect(good.status).toBe(200);
    expect(seen).toEqual(["https://x/limpa"]);
  });

  it("html devolve 200 com text/html (a armadilha do corpo que não é JSON)", async () => {
    const wrapped = wrapFetch(fetch, { seed: 1, rules: [{ match: ".", rate: 1, kind: "html" }] });
    const r = await wrapped("https://x/");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(await r.text()).toContain("<html>");
  });

  it("timeout obedece ao AbortSignal do chamador", async () => {
    const wrapped = wrapFetch(fetch, { seed: 1, rules: [{ match: ".", rate: 1, kind: "timeout" }] });
    const ac = new AbortController();
    const p = wrapped("https://x/", { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("parseFaultConfig", () => {
  it("ausente → null; forma inválida → erro claro", () => {
    expect(parseFaultConfig(undefined)).toBeNull();
    expect(parseFaultConfig(JSON.stringify(CFG))).toEqual(CFG);
    expect(() => parseFaultConfig('{"seed":1,"rules":[{"match":"x","rate":2,"kind":"http_5xx"}]}')).toThrow(/regra inválida/);
  });
});
