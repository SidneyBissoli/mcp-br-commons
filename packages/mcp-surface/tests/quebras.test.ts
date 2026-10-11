import { describe, expect, it } from "vitest";

import { quebrasDeContrato } from "../src/index.js";

const sup = (tools: unknown[], extra: Record<string, unknown> = {}) => ({
  initialize: { capabilities: {}, instructions: null, serverInfo: { name: "t" } },
  tools,
  resources: [],
  resourceTemplates: null,
  prompts: [],
  ...extra,
});
const tool = (inputSchema: unknown, outputSchema?: unknown) => ({
  name: "t1",
  inputSchema,
  ...(outputSchema === undefined ? {} : { outputSchema }),
});
const q = (antes: unknown, depois: unknown) => quebrasDeContrato(sup([tool(antes)]), sup([tool(depois)]));
const qr = (antes: unknown, depois: unknown) =>
  quebrasDeContrato(sup([tool({ type: "object" }, antes)]), sup([tool({ type: "object" }, depois)]));
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });

describe("quebrasDeContrato — entrada (o que o cliente manda)", () => {
  it("tipo que deixou de ser aceito quebra; tipo ampliado não", () => {
    expect(q(obj({ ano: { type: "string" } }), obj({ ano: { type: "integer" } }))).toEqual([
      "t1: `ano` deixou de aceitar o tipo string",
    ]);
    expect(q(obj({ ano: { type: "number" } }), obj({ ano: { type: "integer" } }))).toEqual([
      "t1: `ano` deixou de aceitar o tipo number",
    ]);
    // controles: ampliar não quebra; integer cabe em number
    expect(q(obj({ ano: { type: "string" } }), obj({ ano: { type: ["string", "integer"] } }))).toEqual([]);
    expect(q(obj({ ano: { type: "integer" } }), obj({ ano: { type: "number" } }))).toEqual([]);
    expect(q(obj({ ano: { type: "string" } }), obj({ ano: {} }))).toEqual([]);
    // sem type antes: tipar é estreitar — salvo se um enum já restringia
    expect(q(obj({ ano: {} }), obj({ ano: { type: "integer" } }))).toEqual(["t1: `ano` passou a aceitar só o tipo integer"]);
    expect(q(obj({ ano: { enum: [2020, 2021] } }), obj({ ano: { type: "integer", enum: [2020, 2021] } }))).toEqual([]);
  });

  it("enum que encolheu quebra; enum que cresceu não", () => {
    expect(q(obj({ uf: { enum: ["SP", "RJ"] } }), obj({ uf: { enum: ["SP"] } }))).toEqual([
      't1: `uf` deixou de aceitar "RJ"',
    ]);
    expect(q(obj({ uf: { type: "string" } }), obj({ uf: { type: "string", enum: ["SP"] } }))).toEqual([
      "t1: `uf` deixou de aceitar qualquer valor fora da lista",
    ]);
    expect(q(obj({ uf: { enum: ["SP"] } }), obj({ uf: { enum: ["SP", "RJ"] } }))).toEqual([]);
    expect(q(obj({ uf: { enum: ["SP"] } }), obj({ uf: { type: "string" } }))).toEqual([]);
  });

  it("limite que apertou quebra; que afrouxou não", () => {
    expect(q(obj({ n: { type: "integer", maximum: 100 } }), obj({ n: { type: "integer", maximum: 50 } }))).toEqual([
      "t1: `n` apertou maximum (100 → 50)",
    ]);
    expect(q(obj({ s: { type: "string" } }), obj({ s: { type: "string", minLength: 3 } }))).toEqual([
      "t1: `s` apertou minLength (sem → 3)",
    ]);
    expect(q(obj({ n: { maximum: 50 } }), obj({ n: { maximum: 100 } }))).toEqual([]);
    expect(q(obj({ s: { minLength: 3 } }), obj({ s: {} }))).toEqual([]);
  });

  it("aninhado: o caminho do parâmetro vai na mensagem", () => {
    const antes = obj({ filtro: obj({ ano: { type: "integer" }, uf: { type: "string" } }) });
    const depois = obj({ filtro: obj({ ano: { type: "string" } }, ["ano"]) });
    expect(q(antes, depois).sort()).toEqual([
      "t1: `filtro.ano` deixou de aceitar o tipo integer",
      "t1: parâmetro passou a obrigatório `filtro.ano`",
      "t1: parâmetro removido `filtro.uf`",
    ]);
    expect(q(obj({ l: { type: "array", items: { enum: [1, 2] } } }), obj({ l: { type: "array", items: { enum: [1] } } }))).toEqual([
      "t1: `l.[]` deixou de aceitar 2",
    ]);
  });

  it("additionalProperties: false novo NÃO é quebra: torna visível o parâmetro que era ignorado calado", () => {
    expect(q(obj({}), { ...obj({}), additionalProperties: false })).toEqual([]);
    expect(q({ ...obj({}), additionalProperties: false }, obj({}))).toEqual([]);
  });

  it("parâmetro novo OPCIONAL, descrição e título mudando: nada quebra", () => {
    expect(q(obj({ a: { type: "string" } }), obj({ a: { type: "string", description: "x" }, b: { type: "string" } }))).toEqual([]);
  });

  it("composição e pattern não são julgados (mudam, mas não acusam)", () => {
    expect(q(obj({ a: { anyOf: [{ type: "string" }, { type: "integer" }] } }), obj({ a: { anyOf: [{ type: "string" }] } }))).toEqual([]);
    expect(q(obj({ a: { type: "string" } }), obj({ a: { type: "string", pattern: "^\\d+$" } }))).toEqual([]);
  });
});

describe("quebrasDeContrato — resposta (o que o cliente lê)", () => {
  it("campo garantido que sumiu ou virou opcional quebra; opcional que sumiu não", () => {
    expect(qr(obj({ total: { type: "number" }, nota: {} }, ["total"]), obj({ nota: {} }))).toEqual([
      "t1: campo removido da resposta `total`",
    ]);
    expect(qr(obj({ total: { type: "number" } }, ["total"]), obj({ total: { type: "number" } }))).toEqual([
      "t1: campo deixou de ser garantido na resposta `total`",
    ]);
    expect(qr(obj({ total: {}, nota: {} }, ["total"]), obj({ total: {} }, ["total"]))).toEqual([]);
  });

  it("tipo ou enum que ALARGOU na resposta quebra; que estreitou não", () => {
    expect(qr(obj({ v: { type: "number" } }, ["v"]), obj({ v: { type: ["number", "null"] } }, ["v"]))).toEqual([
      "t1: `v` na resposta passou a poder vir com o tipo null",
    ]);
    expect(qr(obj({ s: { enum: ["ok"] } }), obj({ s: { enum: ["ok", "parcial"] } }))).toEqual([
      't1: `s` na resposta passou a poder trazer "parcial"',
    ]);
    expect(qr(obj({ v: { type: ["number", "null"] } }), obj({ v: { type: "number" } }))).toEqual([]);
  });

  it("outputSchema retirado quebra; outputSchema novo não", () => {
    expect(quebrasDeContrato(sup([tool({}, obj({}))]), sup([tool({})]))).toEqual([
      "t1: deixou de declarar a forma da resposta (outputSchema)",
    ]);
    expect(quebrasDeContrato(sup([tool({})]), sup([tool({}, obj({}))]))).toEqual([]);
  });
});

describe("quebrasDeContrato — a superfície", () => {
  it("[] → null é método que deixou de ser servido; null → [] não quebra", () => {
    expect(quebrasDeContrato(sup([], { prompts: [] }), sup([], { prompts: null }))).toEqual([
      "método deixou de ser servido: prompts/list",
    ]);
    expect(quebrasDeContrato(sup([], { resourceTemplates: null }), sup([], { resourceTemplates: [] }))).toEqual([]);
  });

  it("resource template removido e argumento de prompt", () => {
    const antes = sup([], {
      resourceTemplates: [{ uriTemplate: "x://{id}" }],
      prompts: [{ name: "p", arguments: [{ name: "a" }, { name: "b" }] }],
    });
    const depois = sup([], {
      resourceTemplates: [],
      prompts: [{ name: "p", arguments: [{ name: "a", required: true }] }],
    });
    expect(quebrasDeContrato(antes, depois).sort()).toEqual([
      "prompt p: argumento passou a obrigatório `a`",
      "prompt p: argumento removido `b`",
      "resource template removido: x://{id}",
    ]);
  });

  it("superfície idêntica e entrada sem forma de superfície: nada", () => {
    expect(quebrasDeContrato(sup([tool(obj({ a: {} }))]), sup([tool(obj({ a: {} }))]))).toEqual([]);
    expect(quebrasDeContrato({ tools: ["a"] }, { tools: ["b"] })).toEqual([]);
    expect(quebrasDeContrato(null, {})).toEqual([]);
  });
});
