import { describe, expect, it } from "vitest";
import { backoffMs, parseRetryAfterMs, retryWaitMs, DEFAULT_BACKOFF } from "../src/index.js";

const NOW = Date.parse("2026-09-26T12:00:00Z");

describe("parseRetryAfterMs", () => {
  it("delta-seconds", () => {
    expect(parseRetryAfterMs("5", NOW)).toBe(5_000);
    expect(parseRetryAfterMs(" 0 ", NOW)).toBe(0);
  });
  it("HTTP-date, nunca negativo", () => {
    expect(parseRetryAfterMs("Sat, 26 Sep 2026 12:00:30 GMT", NOW)).toBe(30_000);
    expect(parseRetryAfterMs("Sat, 26 Sep 2026 11:00:00 GMT", NOW)).toBe(0);
  });
  it("ausente ou ininteligível é null", () => {
    expect(parseRetryAfterMs(null, NOW)).toBeNull();
    expect(parseRetryAfterMs(undefined, NOW)).toBeNull();
    expect(parseRetryAfterMs("", NOW)).toBeNull();
    expect(parseRetryAfterMs("logo", NOW)).toBeNull();
    expect(parseRetryAfterMs("-3", NOW)).toBeNull();
  });
});

describe("backoff", () => {
  it("exponencial com teto", () => {
    expect([0, 1, 2, 3, 4].map((r) => backoffMs(r, DEFAULT_BACKOFF))).toEqual([1_000, 2_000, 4_000, 8_000, 8_000]);
  });
  it("espera = max(Retry-After, backoff) + jitter", () => {
    const spec = { baseMs: 1_000, maxMs: 8_000, jitterMs: 500 };
    expect(retryWaitMs(0, null, spec, () => 0)).toBe(1_000);
    expect(retryWaitMs(0, 3_000, spec, () => 0)).toBe(3_000);
    expect(retryWaitMs(2, 3_000, spec, () => 0)).toBe(4_000);
    expect(retryWaitMs(0, null, spec, () => 0.5)).toBe(1_250);
    expect(retryWaitMs(0, null, { ...spec, jitterMs: 0 }, () => 0.99)).toBe(1_000);
  });
});
