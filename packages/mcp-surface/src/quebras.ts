/**
 * QUEBRA DE CONTRATO entre duas superfícies: do que mudou, o que deixa de
 * funcionar para um cliente escrito contra a anterior.
 *
 * Até a 0.5.3 a lista de quebras do replay conhecia quatro casos — tool,
 * resource ou prompt removido, parâmetro removido, parâmetro novo obrigatório —
 * e o resto de uma tool alterada saía só como "mudou". Pergunta de jkming
 * (dev.to, comentário 3h0n8, 09/10/2026): "a changed argument shape on an
 * existing tool has been the most common silent break". A trava já VIA essa
 * mudança (o item entra inteiro no sha); o que faltava era JULGÁ-LA: tipo que
 * deixou de ser aceito, enum que encolheu, limite que apertou, campo que sumiu
 * da resposta. Desde a 0.6.0 a regra da trava usa esta lista para exigir a
 * versão de compatibilidade nova (src/trava.ts).
 *
 * Errar para o lado de NÃO acusar: uma quebra acusada à toa recusa uma release
 * legítima. Por isso só entra o que é quebra com certeza, comparando nó a nó o
 * que o JSON Schema declara (`type`, `enum`/`const`, limites numéricos e de
 * tamanho, `required`, `properties`, `items`). Composição (`anyOf`, `oneOf`,
 * `allOf`, `$ref`, `not`), `pattern` e `additionalProperties` NÃO são julgados —
 * mudança neles aparece como "mudou", nunca como quebra.
 *
 * Provado contra o histórico real (11/10/2026): as 35 mudanças de superfície
 * travadas nos sete servidores, aplicadas a esta regra, dão uma quebra só — a
 * 2.0.0 do medical, que aposentou o SNOMED, e que saiu em major.
 */

import { impressaoDigital } from "./superficie.js";

type No = Record<string, unknown>;

function objeto(v: unknown): v is No {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * A linha de compatibilidade da versão: o major — e, em 0.x, o minor, porque
 * no semver de série 0 mudança incompatível em minor é permitida. Medido no
 * replay do ilo-mcp-server (0.5.0 → 0.6.0 tornou `filters` obrigatório): a
 * 0.1.0 do pacote listava isso como quebra fora de major.
 */
export function linhaDeCompatibilidade(v: string): string {
  const [maior, menor] = v.split(".");
  return maior === "0" ? `0.${menor}` : String(maior);
}

// ---- o que um nó de schema aceita ------------------------------------------

/** O tipo JSON Schema de um valor (número inteiro é `integer`, que cabe em `number`). */
function tipoDoValor(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v === "object" ? "object" : typeof v;
}

/**
 * Tipos que o nó aceita; `undefined` = qualquer tipo. Sem `type`, um `enum` ou
 * `const` já restringe o tipo aos dos valores — sem isso, declarar `type:
 * "string"` num `enum: ["SP"]` seria acusado como estreitamento (caso do teste).
 */
function tipos(n: No): Set<string> | undefined {
  const t = n["type"];
  if (typeof t === "string") return new Set([t]);
  if (Array.isArray(t) && t.every(x => typeof x === "string")) return new Set(t as string[]);
  const v = valores(n);
  return v && new Set([...v.values()].map(tipoDoValor));
}

/** Os tipos que `de` admite e `em` não admite (`integer` cabe em `number`). */
function tiposQueSobram(de: Set<string> | undefined, em: Set<string> | undefined): string[] {
  if (!em) return [];
  if (!de) return ["qualquer"];
  return [...de].filter(t => !em.has(t) && !(t === "integer" && em.has("number"))).sort();
}

/** Valores enumerados (`enum` ou `const`), pela forma canônica; `undefined` = qualquer valor. */
function valores(n: No): Map<string, unknown> | undefined {
  const lista = Array.isArray(n["enum"]) ? (n["enum"] as unknown[]) : "const" in n ? [n["const"]] : undefined;
  return lista && new Map(lista.map(v => [impressaoDigital(v), v]));
}

/** Os valores que `de` admite e `em` não admite, legíveis. */
function valoresQueSobram(de: Map<string, unknown> | undefined, em: Map<string, unknown> | undefined): string[] {
  if (!em) return [];
  if (!de) return ["qualquer valor fora da lista"];
  return [...de].filter(([k]) => !em.has(k)).map(([, v]) => JSON.stringify(v));
}

/** Limites que, se sobem (mínimos) ou descem (máximos), recusam o que antes passava. */
const MINIMOS = ["minimum", "exclusiveMinimum", "minLength", "minItems", "minProperties"] as const;
const MAXIMOS = ["maximum", "exclusiveMaximum", "maxLength", "maxItems", "maxProperties"] as const;

const numero = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const propriedades = (n: No): No => (objeto(n["properties"]) ? n["properties"] : {});
const obrigatorios = (n: No): Set<string> =>
  new Set(Array.isArray(n["required"]) ? (n["required"] as unknown[]).filter(x => typeof x === "string") as string[] : []);

const juntar = (caminho: string, parte: string) => (caminho === "" ? parte : `${caminho}.${parte}`);
const rotulo = (caminho: string) => (caminho === "" ? "a entrada" : `\`${caminho}\``);

// ---- entrada: o que o cliente MANDA deixa de ser aceito ---------------------

function entrada(a: No, d: No, caminho: string, tool: string, saida: string[]): void {
  const [ta, td] = [tipos(a), tipos(d)];
  const sobraTipo = tiposQueSobram(ta, td);
  if (sobraTipo.length) {
    saida.push(
      ta
        ? `${tool}: ${rotulo(caminho)} deixou de aceitar o tipo ${sobraTipo.join(", ")}`
        : `${tool}: ${rotulo(caminho)} passou a aceitar só o tipo ${[...td!].sort().join(", ")}`,
    );
  }

  const sobraValor = valoresQueSobram(valores(a), valores(d));
  if (sobraValor.length) saida.push(`${tool}: ${rotulo(caminho)} deixou de aceitar ${sobraValor.join(", ")}`);

  for (const k of MINIMOS) {
    const [x, y] = [a[k], d[k]];
    if (numero(y) && (!numero(x) || y > x)) saida.push(`${tool}: ${rotulo(caminho)} apertou ${k} (${numero(x) ? x : "sem"} → ${y})`);
  }
  for (const k of MAXIMOS) {
    const [x, y] = [a[k], d[k]];
    if (numero(y) && (!numero(x) || y < x)) saida.push(`${tool}: ${rotulo(caminho)} apertou ${k} (${numero(x) ? x : "sem"} → ${y})`);
  }

  // `additionalProperties: false` novo NÃO é quebra (decisão do dono, 11/10/2026):
  // o parâmetro não declarado era ignorado calado — o cliente achava que filtrou e
  // recebia outra coisa —, e recusá-lo torna visível um erro que já existia. Foi
  // como search/fetch saíram estritos em minor no ibge, ilo, medical e uis.

  const pa = propriedades(a);
  const pd = propriedades(d);
  const ra = obrigatorios(a);
  for (const p of Object.keys(pa)) {
    if (!(p in pd)) saida.push(`${tool}: parâmetro removido \`${juntar(caminho, p)}\``);
    else if (objeto(pa[p]) && objeto(pd[p])) entrada(pa[p], pd[p], juntar(caminho, p), tool, saida);
  }
  for (const p of obrigatorios(d)) {
    if (!ra.has(p)) saida.push(`${tool}: parâmetro passou a obrigatório \`${juntar(caminho, p)}\``);
  }
  if (objeto(a["items"]) && objeto(d["items"])) entrada(a["items"], d["items"], juntar(caminho, "[]"), tool, saida);
}

// ---- resposta: o que o cliente LÊ deixa de ser o prometido ------------------

function resposta(a: No, d: No, caminho: string, tool: string, saida: string[]): void {
  const onde = caminho === "" ? "a resposta" : `\`${caminho}\` na resposta`;
  const sobraTipo = tiposQueSobram(tipos(d), tipos(a));
  if (sobraTipo.length) {
    saida.push(
      sobraTipo[0] === "qualquer"
        ? `${tool}: ${onde} deixou de ter tipo garantido`
        : `${tool}: ${onde} passou a poder vir com o tipo ${sobraTipo.join(", ")}`,
    );
  }

  const sobraValor = valoresQueSobram(valores(d), valores(a));
  if (sobraValor.length) saida.push(`${tool}: ${onde} passou a poder trazer ${sobraValor.join(", ")}`);

  const pa = propriedades(a);
  const pd = propriedades(d);
  const rd = obrigatorios(d);
  for (const p of obrigatorios(a)) {
    if (!(p in pd)) saida.push(`${tool}: campo removido da resposta \`${juntar(caminho, p)}\``);
    else if (!rd.has(p)) saida.push(`${tool}: campo deixou de ser garantido na resposta \`${juntar(caminho, p)}\``);
  }
  for (const p of Object.keys(pa)) {
    if (p in pd && objeto(pa[p]) && objeto(pd[p])) resposta(pa[p], pd[p], juntar(caminho, p), tool, saida);
  }
  if (objeto(a["items"]) && objeto(d["items"])) resposta(a["items"], d["items"], juntar(caminho, "[]"), tool, saida);
}

// ---- a superfície inteira ----------------------------------------------------

/** Itens de uma lista da superfície, por chave; `null` = o método não é servido. */
function itens(sup: No, campo: string, chave: string): Map<string, No> | null {
  const l = sup[campo];
  if (!Array.isArray(l)) return null;
  const m = new Map<string, No>();
  for (const x of l) if (objeto(x) && typeof x[chave] === "string") m.set(x[chave] as string, x);
  return m;
}

const LISTAS = [
  ["tools", "name", "tools/list", "tool removida"],
  ["resources", "uri", "resources/list", "resource removido"],
  ["resourceTemplates", "uriTemplate", "resources/templates/list", "resource template removido"],
  ["prompts", "name", "prompts/list", "prompt removido"],
] as const;

/**
 * As quebras de contrato de `antes` para `depois` (superfícies na forma da
 * seção `declarada`). Lista vazia = um cliente escrito contra `antes` segue
 * funcionando contra `depois`. Entrada que não tem a forma de superfície (as
 * travas de exemplo dos testes, com tools como strings) não acusa nada.
 */
export function quebrasDeContrato(antes: unknown, depois: unknown): string[] {
  if (!objeto(antes) || !objeto(depois)) return [];
  const saida: string[] = [];

  for (const [campo, chave, metodo, removido] of LISTAS) {
    const a = itens(antes, campo, chave);
    const d = itens(depois, campo, chave);
    if (a === null) continue;
    // `[]` → `null`: quem chamava o método recebia lista vazia e passa a receber erro.
    if (d === null) {
      saida.push(`método deixou de ser servido: ${metodo}`);
      continue;
    }
    for (const k of a.keys()) if (!d.has(k)) saida.push(`${removido}: ${k}`);
  }

  const ta = itens(antes, "tools", "name") ?? new Map<string, No>();
  const td = itens(depois, "tools", "name") ?? new Map<string, No>();
  for (const [n, a] of ta) {
    const d = td.get(n);
    if (!d || impressaoDigital(a) === impressaoDigital(d)) continue;
    entrada(objeto(a["inputSchema"]) ? a["inputSchema"] : {}, objeto(d["inputSchema"]) ? d["inputSchema"] : {}, "", n, saida);
    if (objeto(a["outputSchema"])) {
      if (!objeto(d["outputSchema"])) saida.push(`${n}: deixou de declarar a forma da resposta (outputSchema)`);
      else resposta(a["outputSchema"], d["outputSchema"], "", n, saida);
    }
  }

  // Argumentos de prompt: mesma regra dos parâmetros de tool.
  const pa = itens(antes, "prompts", "name") ?? new Map<string, No>();
  const pd = itens(depois, "prompts", "name") ?? new Map<string, No>();
  for (const [n, a] of pa) {
    const d = pd.get(n);
    if (!d) continue;
    const args = (p: No) =>
      new Map((Array.isArray(p["arguments"]) ? p["arguments"] : []).filter(objeto).map(x => [String(x["name"]), x]));
    const [aa, ad] = [args(a), args(d)];
    for (const k of aa.keys()) if (!ad.has(k)) saida.push(`prompt ${n}: argumento removido \`${k}\``);
    for (const [k, x] of ad) {
      if (x["required"] === true && aa.get(k)?.["required"] !== true) {
        saida.push(`prompt ${n}: argumento passou a obrigatório \`${k}\``);
      }
    }
  }

  return saida;
}
