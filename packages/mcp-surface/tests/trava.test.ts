import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { conferirSecao } from "../src/index.js";

const trava = () => join(mkdtempSync(join(tmpdir(), "surface-lock-")), "surface.lock.json");

describe("a regra da trava", () => {
  it("superfície nova sob a MESMA versão: falha, inclusive no modo de escrita", () => {
    const f = trava();
    expect(conferirSecao(f, "declarada", { tools: ["a"] }, "1.0.0", true).ok).toBe(true);
    for (const escrever of [false, true]) {
      const v = conferirSecao(f, "declarada", { tools: ["a", "b"] }, "1.0.0", escrever);
      expect(v.ok).toBe(false);
      expect(v.mensagem).toContain("MUDOU e a versão continua 1.0.0");
    }
    expect(conferirSecao(f, "declarada", { tools: ["a"] }, "1.0.0", false).ok).toBe(true);
  });

  it("superfície nova com versão nova: falha até regravar, e regravada passa", () => {
    const f = trava();
    conferirSecao(f, "declarada", { tools: ["a"] }, "1.0.0", true);
    expect(conferirSecao(f, "declarada", { tools: ["a", "b"] }, "1.1.0", false).mensagem).toContain("npm run surface:lock");
    expect(conferirSecao(f, "declarada", { tools: ["a", "b"] }, "1.1.0", true).ok).toBe(true);
    expect(conferirSecao(f, "declarada", { tools: ["a", "b"] }, "1.1.0", false).ok).toBe(true);
  });

  it("versão nova sem mudança de superfície não exige nada", () => {
    const f = trava();
    conferirSecao(f, "declarada", { tools: ["a"] }, "1.0.0", true);
    expect(conferirSecao(f, "declarada", { tools: ["a"] }, "2.0.0", false).ok).toBe(true);
  });

  it("trava ausente: pede para gravar, e não grava fora do modo de escrita", () => {
    const f = trava();
    const v = conferirSecao(f, "semToken", { ping: true }, "1.0.0", false);
    expect(v.ok).toBe(false);
    expect(v.mensagem).toContain('não tem a seção "semToken"');
  });

  it("as duas seções convivem sem uma apagar a outra", () => {
    const f = trava();
    conferirSecao(f, "declarada", { tools: ["a"] }, "1.0.0", true);
    conferirSecao(f, "semToken", { ping: true }, "1.0.0", true);
    expect(Object.keys(JSON.parse(readFileSync(f, "utf8")) as object)).toEqual(["$comentario", "declarada", "semToken"]);
  });

  it("edição à mão do conteúdo é recusada", () => {
    const f = trava();
    conferirSecao(f, "declarada", { tools: ["a"] }, "1.0.0", true);
    const gravado = JSON.parse(readFileSync(f, "utf8")) as { declarada: { conteudo: unknown } };
    gravado.declarada.conteudo = { tools: ["a", "b"] };
    writeFileSync(f, JSON.stringify(gravado));
    const v = conferirSecao(f, "declarada", { tools: ["a", "b"] }, "1.0.0", true);
    expect(v.ok).toBe(false);
    expect(v.mensagem).toContain("editada à mão");
  });
});
