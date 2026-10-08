/**
 * O QUE mudou entre a superfície travada e a medida — para o teste vermelho
 * nomear a tool, não só dois sha.
 *
 * A trava guarda o conteúdo inteiro de cada seção, então a diferença sai dela,
 * sem hash por tool e sem mudar a forma canônica (nenhum sha muda). Ideia de
 * Chris Sellers (dev.to, comentário 3gnh0, 08/10/2026): "per-tool hashes ... so
 * a red test names the tool that drifted". Até a 0.5.1 a mensagem dizia só
 * "travada 517e0224…, medida 9c1d…" e quem recebia tinha de diffar o JSON à mão.
 */

import { compararUnidades, impressaoDigital } from "./superficie.js";

/** Chaves que identificam um item numa lista da superfície, nesta ordem. */
const CHAVES_DE_ITEM = ["name", "uri", "uriTemplate"] as const;

function objeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function chaveDoItem(v: unknown): string | undefined {
  if (!objeto(v)) return undefined;
  for (const k of CHAVES_DE_ITEM) if (typeof v[k] === "string") return v[k] as string;
  return undefined;
}

/** Lista de itens nomeados (tools, resources, prompts): todo item tem chave, e nenhuma se repete. */
function listaDeItens(v: unknown[]): boolean {
  const chaves = v.map(chaveDoItem);
  return chaves.every(c => c !== undefined) && new Set(chaves).size === chaves.length;
}

function juntar(caminho: string, parte: string): string {
  return caminho === "" ? parte : `${caminho}.${parte}`;
}

function andar(antes: unknown, depois: unknown, caminho: string, saida: string[]): void {
  if (impressaoDigital(antes) === impressaoDigital(depois)) return;

  if (Array.isArray(antes) && Array.isArray(depois) && listaDeItens(antes) && listaDeItens(depois)) {
    const a = new Map(antes.map(x => [chaveDoItem(x)!, x]));
    const b = new Map(depois.map(x => [chaveDoItem(x)!, x]));
    for (const k of [...new Set([...a.keys(), ...b.keys()])].sort(compararUnidades)) {
      const item = `${caminho}[${k}]`;
      if (!a.has(k)) saida.push(`${item}: nova`);
      else if (!b.has(k)) saida.push(`${item}: removida`);
      else andar(a.get(k), b.get(k), item, saida);
    }
    return;
  }

  if (objeto(antes) && objeto(depois)) {
    for (const k of [...new Set([...Object.keys(antes), ...Object.keys(depois)])].sort(compararUnidades)) {
      const filho = juntar(caminho, k);
      if (!(k in antes)) saida.push(`${filho}: nova`);
      else if (!(k in depois)) saida.push(`${filho}: removida`);
      else andar(antes[k], depois[k], filho, saida);
    }
    return;
  }

  saida.push(`${caminho === "" ? "(seção inteira)" : caminho}: mudou`);
}

/**
 * Os caminhos que mudaram, do mais geral ao mais fino, em ordem estável:
 * `tools[bcb_serie_valores].description: mudou`, `tools[x]: nova`,
 * `initialize.instructions: mudou`, `full.tools[y]: removida` (senado, por perfil).
 * Vazio quando os dois conteúdos têm o mesmo sha.
 */
export function oQueMudou(antes: unknown, depois: unknown): string[] {
  const saida: string[] = [];
  andar(antes, depois, "", saida);
  return saida;
}

/** A frase da mensagem da trava: no máximo `limite` caminhos, com o resto contado. */
export function resumoDoQueMudou(antes: unknown, depois: unknown, limite = 10): string {
  const mudancas = oQueMudou(antes, depois);
  if (mudancas.length === 0) return "";
  const mostradas = mudancas.slice(0, limite).join("; ");
  const resto = mudancas.length > limite ? ` (e mais ${mudancas.length - limite})` : "";
  return ` O que mudou: ${mostradas}${resto}.`;
}
