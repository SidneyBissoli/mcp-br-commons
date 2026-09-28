/**
 * Injeção de falha na ORIGEM — o núcleo puro (testável sem processo).
 *
 * Em vez de falsificar o bloco `retrieval`, o runner faz a origem oscilar de
 * verdade: embrulha `globalThis.fetch` do PROCESSO DO SERVIDOR (via `node --import
 * fault.js dist/index.js`) e, por regra determinística (semente + URL + nº da ida
 * àquela URL), responde 502, HTML ou timeout em X % das idas. O retry do próprio
 * servidor trabalha, o `retrieval` sai VERDADEIRO (`{1,3,[http_5xx×2],true}`) e o
 * servidor se comporta como em produção sob oscilação.
 *
 * Determinismo: a n-ésima ida a uma URL sorteia sempre o mesmo resultado para a
 * mesma semente, mas idas sucessivas (os retries) sorteiam independentes — assim o
 * retry às vezes salva, como no mundo real. `fetchImpl` do `@sbissoli/mcp-upstream`
 * é ligação a `globalThis.fetch` em `resolveOptions` — o preload roda antes do
 * módulo principal, então o embrulho já está no lugar.
 */

import type { FaultConfig, FaultRule } from "./types.js";

/** FNV-1a 32 bits de uma string. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Um passo do mulberry32 a partir de uma semente: número em [0, 1). */
export function unit(seed: number): number {
  let s = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function parseFaultConfig(json: string | undefined): FaultConfig | null {
  if (!json) return null;
  const cfg = JSON.parse(json) as FaultConfig;
  if (!Number.isFinite(cfg.seed) || !Array.isArray(cfg.rules)) throw new Error("EVAL_FAULT_RULES: {seed, rules[]} esperado");
  for (const r of cfg.rules) {
    if (typeof r.match !== "string" || !(r.rate >= 0 && r.rate <= 1) || !["http_5xx", "html", "timeout"].includes(r.kind)) {
      throw new Error(`EVAL_FAULT_RULES: regra inválida ${JSON.stringify(r)}`);
    }
  }
  return cfg;
}

export interface FaultDecision {
  rule: FaultRule;
  /** Índice (1-based) da ida a esta URL. */
  nth: number;
}

/** Decide, sem efeito colateral além do contador, se esta ida falha e por qual regra. */
export function createDecider(cfg: FaultConfig): (url: string) => FaultDecision | null {
  const compiled = cfg.rules.map((rule) => ({ rule, re: new RegExp(rule.match) }));
  const counts = new Map<string, number>();
  return (url) => {
    const nth = (counts.get(url) ?? 0) + 1;
    counts.set(url, nth);
    for (const { rule, re } of compiled) {
      if (!re.test(url)) continue;
      const draw = unit(fnv1a(`${cfg.seed}|${url}|${nth}|${rule.kind}`));
      if (draw < rule.rate) return { rule, nth };
    }
    return null;
  };
}

const HTML_BODY =
  "<!DOCTYPE html><html><head><title>Service Unavailable</title></head><body><h1>Service Unavailable</h1>" +
  "<p>The server is temporarily unable to service your request.</p></body></html>";

/** Resposta falsa para a decisão (ou uma promessa que só resolve depois do timeout). */
export function fakeResponse(decision: FaultDecision, signal: AbortSignal | null | undefined): Promise<Response> {
  const { rule } = decision;
  if (rule.kind === "http_5xx") {
    return Promise.resolve(
      new Response(JSON.stringify({ error: "injected upstream failure" }), {
        status: rule.status ?? 502,
        headers: { "content-type": "application/json" },
      }),
    );
  }
  if (rule.kind === "html") {
    return Promise.resolve(new Response(HTML_BODY, { status: 200, headers: { "content-type": "text/html" } }));
  }
  // timeout: só termina se o chamador abortar (o servidor tem o seu próprio timeout).
  return new Promise<Response>((_resolve, reject) => {
    const delay = rule.delayMs ?? 65_000;
    const timer = setTimeout(() => reject(new Error("injected timeout")), delay);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted.", "AbortError"));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/** Embrulha um fetch: idas sorteadas falham conforme as regras; o resto passa. */
export function wrapFetch(base: typeof fetch, cfg: FaultConfig, log?: (line: string) => void): typeof fetch {
  const decide = createDecider(cfg);
  const wrapped = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const decision = decide(url);
    if (decision) {
      log?.(`[fault] ${decision.rule.kind} na ida #${decision.nth} → ${url}`);
      return fakeResponse(decision, init?.signal ?? (input instanceof Request ? input.signal : null));
    }
    return base(input, init);
  }) as typeof fetch;
  return wrapped;
}
