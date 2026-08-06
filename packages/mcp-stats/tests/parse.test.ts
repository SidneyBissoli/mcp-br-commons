import { describe, expect, it } from "vitest";
import { parseBRL } from "../src/parse.js";

describe("parseBRL", () => {
  it("converte strings pt-BR com milhar e decimal", () => {
    expect(parseBRL("1.234,56")).toBe(1234.56);
    expect(parseBRL("-7.139,64")).toBe(-7139.64);
    expect(parseBRL("41.441,26")).toBe(41441.26);
    expect(parseBRL("0,50")).toBe(0.5);
  });

  it("números nativos passam inalterados (não perde o ponto decimal)", () => {
    expect(parseBRL(123.45)).toBe(123.45);
  });

  it("null/undefined/vazio/não-parseável → fallback", () => {
    expect(parseBRL(null)).toBe(0);
    expect(parseBRL(undefined)).toBe(0);
    expect(parseBRL("")).toBe(0);
    expect(parseBRL("abc")).toBe(0);
    expect(parseBRL("abc", -1)).toBe(-1);
    expect(parseBRL(NaN, -1)).toBe(-1);
  });
});
