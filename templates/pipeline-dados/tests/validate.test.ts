import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validarDescriptor, validarArquivo, PROFILE_URL } from "../src/validate.js";

function fixture(nome: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${nome}`, import.meta.url), "utf8"),
  ) as Record<string, unknown>;
}

describe("validarDescriptor", () => {
  it("aceita o descriptor de exemplo do template (profile + portfólio)", () => {
    const resultado = validarDescriptor(fixture("exemplo-datapackage.json"));
    expect(resultado.erros).toEqual([]);
    expect(resultado.ok).toBe(true);
  });

  it("rejeita o datapackage.json LEGADO do senado (colisão de nomes com a spec)", () => {
    const resultado = validarDescriptor(fixture("senado-datapackage-legado.json"));
    expect(resultado.ok).toBe(false);
    // sem resources — a única exigência dura da spec
    expect(resultado.erros.some((e) => e.includes("resources"))).toBe(true);
  });

  it("rejeita descriptor sem os obrigatórios do portfólio", () => {
    const base = fixture("exemplo-datapackage.json");
    delete base.version;
    delete base.created;
    delete base.licenses;
    const resultado = validarDescriptor(base);
    expect(resultado.erros.some((e) => e.includes("version"))).toBe(true);
    expect(resultado.erros.some((e) => e.includes("created"))).toBe(true);
    expect(resultado.erros.some((e) => e.includes("licenses"))).toBe(true);
  });

  it("rejeita $schema divergente do profile 2.0", () => {
    const base = fixture("exemplo-datapackage.json");
    base.$schema = "https://datapackage.org/profiles/1.0/datapackage.json";
    const resultado = validarDescriptor(base);
    expect(resultado.erros.some((e) => e.includes(PROFILE_URL))).toBe(true);
  });

  it("rejeita created com milissegundos (timestamp canônico do portfólio)", () => {
    const base = fixture("exemplo-datapackage.json");
    base.created = "2026-08-06T12:00:00.000Z";
    const resultado = validarDescriptor(base);
    expect(resultado.erros.some((e) => e.includes("milissegundos"))).toBe(true);
  });

  it("rejeita hash sem prefixo sha256: e nomes/paths duplicados", () => {
    const base = fixture("exemplo-datapackage.json");
    const resources = base.resources as Record<string, unknown>[];
    resources[0]!.hash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    resources[1]!.name = resources[0]!.name;
    resources[1]!.path = resources[0]!.path;
    const resultado = validarDescriptor(base);
    expect(resultado.erros.some((e) => e.includes("sha256:"))).toBe(true);
    expect(resultado.erros.some((e) => e.includes("name duplicado"))).toBe(true);
    expect(resultado.erros.some((e) => e.includes("path duplicado"))).toBe(true);
  });

  it("rejeita resource inline (data) sem path", () => {
    const base = fixture("exemplo-datapackage.json");
    (base.resources as unknown[]).push({ name: "inline", data: [{ a: 1 }] });
    const resultado = validarDescriptor(base);
    expect(resultado.erros.some((e) => e.includes("exige path"))).toBe(true);
  });

  it("rejeita não-objeto e JSON quebrado em disco", () => {
    expect(validarDescriptor("string").ok).toBe(false);
    const resultado = validarArquivo("caminho/que/nao/existe.json");
    expect(resultado.ok).toBe(false);
    expect(resultado.erros[0]).toContain("falha ao ler");
  });
});
