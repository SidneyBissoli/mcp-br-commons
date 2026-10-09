/**
 * A superfície de um servidor MCP — o que um cliente vê dele —, reduzida a um
 * objeto normalizado e a um sha256.
 *
 * Por que existe. A cópia do MCP Registry carrega só a versão (medido em
 * 30/09/2026 nas 26 versões publicadas do bcb-br-mcp: `name`, `version`,
 * `packages`, `remotes`), então a versão é a ÚNICA coisa que um cliente
 * consegue comparar com o servidor — e isso só vale se TODA mudança de
 * superfície subir a versão. Proposta de um leitor (dev.to, comentários 3g5m4
 * e 3g607), que achou o caso grave no servidor dele: registro dizendo 0.1.0 com
 * 4 tools só-leitura, servidor com 6, duas escrevendo pelo usuário.
 *
 * A normalização é a mesma em todo caminho — em memória, HTTP e stdio de uma
 * versão antiga (replay) — porque todos passam por `normalizarSuperficie`. Ela
 * nasceu no bcb-br-mcp (1.15.1) e foi trazida para cá sem mudar um byte: o
 * sha256 travado lá continua valendo aqui.
 */

import { createHash } from "node:crypto";

import { capturarBrutaPor, type Pedir, type SuperficieBruta } from "./captura.js";

export { PROTOCOLO_DA_CAPTURA, paramsDoInitialize, type SuperficieBruta } from "./captura.js";

function ordenarChaves(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenarChaves);
  if (valor && typeof valor === "object") {
    return Object.fromEntries(
      Object.keys(valor)
        .sort()
        .map(k => [k, ordenarChaves((valor as Record<string, unknown>)[k])]),
    );
  }
  return valor;
}

/**
 * Ordem por unidade de código UTF-16 — a mesma de `Object.keys().sort()` e da
 * RFC 8785. Até 0.4.x era `localeCompare`, que depende do locale e do ICU de
 * quem roda: um host em Python ou noutro locale podia ordenar `_`, dígitos e
 * maiúsculas de outro jeito e chegar a outro sha. A forma canônica tem de ser
 * reproduzível por quem não roda este código (SPEC.md). Medido em 07/10/2026:
 * as listas travadas dos seis servidores já estavam nesta ordem — nenhum sha
 * mudou.
 */
export function compararUnidades(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function porChave(lista: unknown[] | undefined, chave: string): unknown[] | null {
  if (!lista) return null;
  return [...lista].sort((a, b) =>
    compararUnidades(String((a as Record<string, unknown>)[chave]), String((b as Record<string, unknown>)[chave])),
  );
}

/**
 * Forma canônica da superfície. A versão do servidor sai — ela muda a cada
 * release e é justamente o que se compara contra a superfície. O resto do
 * `serverInfo` (nome, título, site, ícones) fica: é declaração de identidade.
 * Arrays internos (`required`, `enum`) mantêm a ordem: ela é parte do que se
 * publica. Método não servido vira `null`, não lista vazia: "não serve" e
 * "serve nada" são superfícies diferentes.
 */
export function normalizarSuperficie(bruta: SuperficieBruta): Record<string, unknown> {
  const init = bruta.initialize ?? {};
  const { version: _versao, ...serverInfo } = (init["serverInfo"] ?? {}) as Record<string, unknown>;
  return ordenarChaves({
    initialize: {
      protocolVersion: init["protocolVersion"] ?? null,
      capabilities: init["capabilities"] ?? null,
      instructions: init["instructions"] ?? null,
      serverInfo,
    },
    tools: porChave(bruta.tools, "name"),
    resources: porChave(bruta.resources, "uri"),
    resourceTemplates: porChave(bruta.resourceTemplates, "uriTemplate"),
    prompts: porChave(bruta.prompts, "name"),
  }) as Record<string, unknown>;
}

/**
 * JSON canônico (SPEC §3), escrito chave a chave na ordem por unidade UTF-16.
 * NÃO é `JSON.stringify(ordenarChaves(v))`: objeto JavaScript põe as chaves
 * de cara inteira ("9", "10") na frente, em ordem NUMÉRICA, seja qual for a
 * ordem de inserção — "9" saía antes de "10", e a SPEC e a RFC 8785 mandam
 * "10" antes de "9". Até 0.5.2 era assim. Achado de Valentina Koniukhova
 * (worklore, dev.to 3h046, 08/10/2026) ao reimplementar a forma; medido no
 * mesmo dia: nenhuma das sete travas do portfólio tem chave assim, nenhum sha
 * mudou. Escalares seguem `JSON.stringify` (SPEC §3.2).
 */
export function serializarCanonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(v => serializarCanonico(v === undefined ? null : v)).join(",")}]`;
  if (valor && typeof valor === "object") {
    const obj = valor as Record<string, unknown>;
    const chaves = Object.keys(obj).filter(k => obj[k] !== undefined).sort(compararUnidades);
    return `{${chaves.map(k => `${JSON.stringify(k)}:${serializarCanonico(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(valor);
}

/** sha256 do JSON canônico (SPEC §3) — a impressão digital. */
export function impressaoDigital(valor: unknown): string {
  return createHash("sha256").update(serializarCanonico(valor), "utf8").digest("hex");
}

/**
 * Captura a superfície por qualquer transporte: `pedir` faz uma requisição
 * JSON-RPC e devolve o `result` (ou `undefined` em erro). `notificar`, quando
 * o transporte tem sessão, manda o `notifications/initialized`.
 */
export async function capturarPor(pedir: Pedir, cliente: string, notificar?: () => void): Promise<Record<string, unknown>> {
  return normalizarSuperficie(await capturarBrutaPor(pedir, cliente, notificar));
}
