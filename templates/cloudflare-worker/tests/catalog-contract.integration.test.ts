/**
 * ESQUELETO — contrato de constantes externas (preencha ao instanciar).
 *
 * REGRA DE AUTORIA (aprendida em 2026-08, caso ibge-br-mcp): nenhuma
 * constante que referencia um recurso externo — código de tabela SIDRA, id
 * de série SGS, id de dataflow SDMX, release de terminologia, URL de
 * arquivo — entra no código sem um CONTRATO que a valide contra a fonte
 * real. No ibge, ~13 códigos de tabela estavam errados desde o commit
 * inicial ("Mortalidade Infantil" devolvia população; "Óbitos por Causas"
 * devolvia produção agrícola): a API responde 200 com dados válidos DE
 * OUTRA COISA, então nenhum teste offline pega. A causa é escrever códigos
 * "de memória" (humana ou de LLM) sem verificação; a defesa é este teste.
 *
 * Como usar na instância:
 *  1. Para cada catálogo de referências externas do servidor, adicione uma
 *     entrada em `declared()` (código + onde está declarado + rótulo).
 *  2. Para cada código, escreva em EXPECTED uma expectativa SEMÂNTICA
 *     (regex sobre o nome/metadado real, minúsculo e sem acento) derivada
 *     do RÓTULO — nunca copie o nome real da fonte, senão o teste deixa de
 *     ser uma declaração independente.
 *  3. Implemente `liveName(code)` consultando o endpoint de METADADOS da
 *     fonte (não o de dados).
 *  4. Ative o workflow .github/workflows/integration.yml (cron semanal +
 *     dispatch). Os testes offline não são afetados (gate INTEGRATION_TESTS).
 *
 * O teste de completude abaixo garante que todo código novo exige uma
 * expectativa nova — o contrato não fica para trás silenciosamente.
 */
import { describe, expect, it } from "vitest";

const LIVE = process.env.INTEGRATION_TESTS === "1" || process.env.INTEGRATION_TESTS === "true";

interface Declared {
  code: string;
  origin: string; // arquivo/constante onde o código está declarado
  label: string; // o que o catálogo diz que o código significa
}

/** Preencha com os catálogos reais da instância (importe as constantes). */
function declared(): Declared[] {
  return [];
}

/** Uma expectativa semântica por código, derivada do rótulo. */
const EXPECTED: Record<string, RegExp> = {};

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Consulte o endpoint de metadados da fonte e devolva o nome/descrição real. */
async function liveName(_code: string): Promise<string> {
  throw new Error("implemente liveName() para a fonte desta instância");
}

describe.runIf(LIVE && declared().length > 0)("contrato de constantes externas", () => {
  const decl = declared();
  const codes = [...new Set(decl.map((d) => d.code))];

  it("todo código declarado tem expectativa semântica", () => {
    const missing = codes.filter((c) => !(c in EXPECTED));
    expect(missing, `códigos sem entrada em EXPECTED: ${missing.join(", ")}`).toEqual([]);
  });

  for (const code of codes) {
    const where = decl
      .filter((d) => d.code === code)
      .map((u) => `${u.origin}:${u.label}`)
      .join("; ");
    it(`${code} é o que o catálogo promete [${where}]`, async () => {
      const nome = await liveName(code);
      const expected = EXPECTED[code];
      if (!expected) return; // reportado no teste de completude
      expect(
        expected.test(normalize(nome)),
        `código ${code} na fonte é "${nome}" — não bate com ${expected} declarada para: ${where}`
      ).toBe(true);
    }, 180_000);
  }
});
