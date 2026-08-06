import { describe, expect, it } from "vitest";
import { parseOffsetMinutes, timezoneLabel, toCanonicalIso } from "../src/time.js";

describe("parseOffsetMinutes", () => {
  it("converte offsets válidos", () => {
    expect(parseOffsetMinutes("-03:00")).toBe(-180);
    expect(parseOffsetMinutes("+05:30")).toBe(330);
    expect(parseOffsetMinutes("+00:00")).toBe(0);
  });

  it("rejeita formatos inválidos", () => {
    expect(() => parseOffsetMinutes("-3:00")).toThrow(/inválido/);
    expect(() => parseOffsetMinutes("Z")).toThrow(/inválido/);
  });
});

describe("timezoneLabel", () => {
  it("usa UTC, o label explícito ou o offset como fallback", () => {
    expect(timezoneLabel("utc")).toBe("UTC");
    expect(timezoneLabel({ offset: "-03:00", label: "horário de Brasília" })).toBe("horário de Brasília");
    expect(timezoneLabel({ offset: "-03:00" })).toBe("UTC-03:00");
  });
});

describe("toCanonicalIso", () => {
  const instant = new Date("2026-07-15T00:23:45.123Z");

  it("serializa em UTC sem milissegundos", () => {
    expect(toCanonicalIso(instant, "utc")).toBe("2026-07-15T00:23:45Z");
  });

  it("aplica offset fixo preservando o instante (caso Brasília: noite vira o dia anterior)", () => {
    expect(toCanonicalIso(instant, { offset: "-03:00" })).toBe("2026-07-14T21:23:45-03:00");
  });

  it("aplica offset positivo", () => {
    expect(toCanonicalIso(instant, { offset: "+05:30" })).toBe("2026-07-15T05:53:45+05:30");
  });

  it("deixa datas puras inalteradas (nunca inventa horário num vintage)", () => {
    expect(toCanonicalIso("2026-06-28", { offset: "-03:00" })).toBe("2026-06-28");
  });

  it("deixa strings não-parseáveis inalteradas", () => {
    expect(toCanonicalIso("não é data", "utc")).toBe("não é data");
  });

  it("aceita string ISO como entrada", () => {
    expect(toCanonicalIso("2026-07-15T00:23:45Z", { offset: "-03:00" })).toBe("2026-07-14T21:23:45-03:00");
  });
});
