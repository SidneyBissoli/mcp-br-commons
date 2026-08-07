/**
 * Testes offline do núcleo puro de retry/classificação (portados do harness do senado).
 * Sem rede — só o mapeamento status→kind e a matemática de backoff que decidem se o
 * runner tenta de novo ou trata a falha como fatal.
 */

import { describe, it, expect } from "vitest";
import {
  classifyApiError,
  backoffMs,
  parseRetryAfter,
  isFatalInfra,
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
} from "../src/retry.js";

describe("classifyApiError", () => {
  it("trata 429 como rate_limit com retry", () => {
    expect(classifyApiError(429, "rate_limit_error")).toEqual({ kind: "rate_limit", retryable: true });
  });

  it("trata 529 como overloaded com retry", () => {
    expect(classifyApiError(529, "overloaded")).toEqual({ kind: "overloaded", retryable: true });
  });

  it("trata 5xx como erro de servidor com retry", () => {
    expect(classifyApiError(500, "")).toEqual({ kind: "server", retryable: true });
    expect(classifyApiError(503, "")).toEqual({ kind: "server", retryable: true });
  });

  it("trata 401/403 como auth fatal", () => {
    expect(classifyApiError(401, "invalid x-api-key")).toEqual({ kind: "auth", retryable: false });
    expect(classifyApiError(403, "forbidden")).toEqual({ kind: "auth", retryable: false });
  });

  it("trata 400 de saldo de créditos como billing fatal", () => {
    const body = '{"error":{"message":"Your credit balance is too low to access the Anthropic API."}}';
    expect(classifyApiError(400, body)).toEqual({ kind: "billing", retryable: false });
  });

  it("matching é case-insensitive", () => {
    expect(classifyApiError(400, "CREDIT BALANCE too low").kind).toBe("billing");
  });

  it("trata outros 400 como other sem retry (não billing)", () => {
    expect(classifyApiError(400, "messages: invalid request")).toEqual({ kind: "other", retryable: false });
  });
});

describe("isFatalInfra", () => {
  it("é true só para auth e billing", () => {
    expect(isFatalInfra("auth")).toBe(true);
    expect(isFatalInfra("billing")).toBe(true);
    expect(isFatalInfra("rate_limit")).toBe(false);
    expect(isFatalInfra("server")).toBe(false);
    expect(isFatalInfra("network")).toBe(false);
    expect(isFatalInfra("other")).toBe(false);
  });
});

describe("backoffMs", () => {
  it("cresce exponencialmente a partir da base sem Retry-After", () => {
    expect(backoffMs(0)).toBe(BASE_BACKOFF_MS);
    expect(backoffMs(1)).toBe(BASE_BACKOFF_MS * 2);
    expect(backoffMs(2)).toBe(BASE_BACKOFF_MS * 4);
  });

  it("limita o backoff exponencial a MAX_BACKOFF_MS", () => {
    expect(backoffMs(20)).toBe(MAX_BACKOFF_MS);
  });

  it("honra a dica Retry-After sobre a escala exponencial", () => {
    expect(backoffMs(0, 7)).toBe(7_000);
  });

  it("limita a dica Retry-After a MAX_BACKOFF_MS", () => {
    expect(backoffMs(0, 120)).toBe(MAX_BACKOFF_MS);
  });

  it("ignora dica Retry-After não-positiva ou não-finita", () => {
    expect(backoffMs(1, 0)).toBe(BASE_BACKOFF_MS * 2);
    expect(backoffMs(1, -5)).toBe(BASE_BACKOFF_MS * 2);
    expect(backoffMs(1, NaN)).toBe(BASE_BACKOFF_MS * 2);
  });
});

describe("parseRetryAfter", () => {
  it("interpreta o header de segundos inteiros", () => {
    expect(parseRetryAfter("30")).toBe(30);
    expect(parseRetryAfter("  5 ")).toBe(5);
  });

  it("devolve undefined para valores ausentes ou não-numéricos", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("")).toBeUndefined();
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT")).toBeUndefined();
  });
});
