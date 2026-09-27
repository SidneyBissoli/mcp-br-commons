import { describe, expect, it } from "vitest";
import { createUpstream } from "../src/index.js";
import { currentCall, requireCall, withCall } from "../src/als.js";

const upstream = createUpstream({
  fetchImpl: (async () => new Response("1", { status: 200 })) as unknown as typeof fetch,
});

describe("adaptador ALS", () => {
  it("withCall abre um coletor visível em qualquer profundidade assíncrona", async () => {
    async function fundo(): Promise<unknown> {
      await Promise.resolve();
      return requireCall().json("https://origem.exemplo/x");
    }
    const r = await withCall(upstream, async (call) => {
      expect(currentCall()).toBe(call);
      await fundo();
      await fundo();
      return call.retrieval();
    });
    expect(r).toEqual({ requests: 2, attempts: 2, anomalies: [] });
  });

  it("fora de withCall: currentCall é undefined e requireCall falha alto", () => {
    expect(currentCall()).toBeUndefined();
    expect(() => requireCall()).toThrow(/withCall/);
  });

  it("chamadas concorrentes não compartilham coletor", async () => {
    const [a, b] = await Promise.all([
      withCall(upstream, async (call) => {
        await call.json("https://origem.exemplo/a");
        await new Promise((r) => setTimeout(r, 5));
        return currentCall()!.retrieval();
      }),
      withCall(upstream, async (call) => {
        await call.json("https://origem.exemplo/b");
        await call.json("https://origem.exemplo/b2");
        return currentCall()!.retrieval();
      }),
    ]);
    expect(a!.requests).toBe(1);
    expect(b!.requests).toBe(2);
  });
});
