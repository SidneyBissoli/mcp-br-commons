/**
 * O conjunto vazio não pode sair com cara de medida.
 *
 * Este arquivo existe por um defeito medido em produção em 14/09/2026, no
 * senado-br-mcp: `senado_ceaps({ano: 2024, estatisticas: true, nomeSenador:
 * "ZZQX INEXISTENTE"})` — ano válido, filtro que não casa nenhum registro —
 * respondia a distribuição inteira em zero e, pior, NARRADA por extenso pela
 * camada de exibição:
 *
 *     "mediana — metade dos valores é igual ou inferior a R$ 0,00"
 *     "99% dos valores são iguais ou inferiores a R$ 0,00"
 *
 * com bloco de proveniência completo. Um modelo que lê isso afirma ao leitor
 * que a despesa mediana foi R$ 0,00: uma afirmação sobre o mundo, saída de uma
 * consulta vazia, com aparência de dado oficial.
 *
 * A origem era o `EMPTY_STATS` deste pacote, que devolvia zero em todo campo.
 * Zero é a resposta errada mais perigosa que existe aqui: atravessa qualquer
 * validação de tipo, tem cara de medida e não deixa rastro.
 *
 * O que se afirma abaixo são INVARIANTES do caso vazio, não redações: a
 * asserção central varre a saída inteira atrás de qualquer valor formatado, em
 * vez de pinar a frase que o defeito produzia. Trocar o texto dos rótulos não
 * quebra estes testes; voltar a narrar um número, sim.
 *
 * Os três consumidores do pacote (ibge-br-mcp, bcb-br-mcp e
 * senado-br-mcp-cloudflare) dividem este motor. Os dois primeiros escapavam do
 * defeito só porque os chamadores deles guardavam antes — o motor era a arma
 * carregada, e quem não guardava disparava. A defesa passa a ser daqui.
 */

import { describe, expect, it } from "vitest";

import { computeGroupedStats, computeStats } from "../src/core.js";
import { formatGrouped, formatStats, labeledPercentiles } from "../src/display.js";
import { en, ptBR } from "../src/locale.js";

/** Qualquer moeda/número formatado pelos locales embutidos: "R$ 0,00", "0.00", "1.234,56". */
const VALOR_FORMATADO = /R\$\s*-?[\d.,]+|\b-?\d[\d.,]*\.\d{2}\b|\b-?\d[\d.]*,\d{2}\b/;

const VAZIO = computeStats([] as number[], (v) => v);

describe("conjunto vazio: o núcleo não inventa número", () => {
  it("as estatísticas indefinidas saem null, com a razão dita", () => {
    expect(VAZIO.n).toBe(0);
    expect(VAZIO.reason).toBe("no-records");
    for (const campo of ["min", "max", "mean", "median", "stdDev"] as const) {
      expect(VAZIO[campo], `${campo} deveria ser null`).toBeNull();
    }
  });

  it("nenhum percentil vira zero", () => {
    expect(Object.values(VAZIO.percentiles).every((v) => v === null)).toBe(true);
  });
});

describe("conjunto vazio: a exibição não narra o que não foi medido", () => {
  it.each([
    ["pt-BR", ptBR],
    ["en", en],
  ])("%s — o bloco de distribuição dá lugar a um aviso", (_id, locale) => {
    const saida = formatStats(VAZIO, { locale });

    // A FORMA muda de propósito: sem registro não existe distribuição, e uma
    // fileira de campos indefinidos ainda convida o leitor a tratá-los como dado.
    expect(saida.n).toBe(0);
    expect(saida[locale.keys.notice]).toBeTypeOf("string");
    for (const chave of ["sum", "min", "max", "mean", "median", "stdDev", "percentiles"] as const) {
      expect(saida, `não deveria emitir ${locale.keys[chave]}`).not.toHaveProperty(locale.keys[chave]);
    }
  });

  it.each([
    ["pt-BR", ptBR],
    ["en", en],
  ])("%s — a saída inteira não contém UM valor formatado sequer", (_id, locale) => {
    // A asserção que fecha a classe. Deriva do defeito (um valor narrado) e não
    // da frase que o defeito escrevia, então sobrevive a qualquer reescrita de
    // rótulo — e reprova na hora se alguém voltar a citar número no caso vazio.
    const texto = JSON.stringify(formatStats(VAZIO, { locale }));
    expect(texto).not.toMatch(VALOR_FORMATADO);
  });

  it("o aviso DIZ que o resultado não significa zero", () => {
    // A negação explícita existe porque o leitor do bloco é, quase sempre, um
    // modelo montando uma frase. "Nenhum registro" sozinho ainda é parafraseável
    // como "foi zero"; a ressalva fecha essa porta.
    expect(ptBR.noRecordsNotice()).toMatch(/não significa que os valores sejam zero/i);
    expect(en.noRecordsNotice()).toMatch(/does not mean the values are zero/i);
  });

  it("percentil indefinido é rotulado sem citar valor nenhum", () => {
    // `labeledPercentiles` é exportado e usado direto por consumidor que mantém a
    // própria camada de exibição (é o caso do senado), então precisa se defender
    // sozinho, sem depender de formatStats.
    const lista = labeledPercentiles(VAZIO.percentiles, { locale: ptBR });
    expect(lista).toHaveLength(6);
    for (const item of lista) {
      expect(item[ptBR.keys.value]).toBeNull();
      expect(String(item[ptBR.keys.label])).not.toMatch(VALOR_FORMATADO);
    }
    expect(String(lista[1]![ptBR.keys.label])).toMatch(/mediana indefinida/i);
  });

  it("nenhum grupo também explica por quê, em vez de devolver lista vazia calada", () => {
    const g = computeGroupedStats([] as { g: string; v: number }[], (r) => r.v, (r) => r.g);
    const saida = formatGrouped(g, { locale: ptBR });
    expect(saida[ptBR.keys.totalGroups]).toBe(0);
    expect(saida[ptBR.keys.groups]).toEqual([]);
    expect(String(saida[ptBR.keys.notice])).toMatch(/nenhum registro/i);
  });
});

describe("o portão fecha — e não reprova o caso legítimo", () => {
  it("com registros, a distribuição sai completa e COM valores narrados", () => {
    // O contrapeso: se o teste acima passasse também aqui, ele não estaria
    // medindo nada. Um conjunto de verdade tem de continuar narrando os números.
    const e = computeStats([2, 4, 6, 8], (v) => v);
    const saida = formatStats(e, { locale: ptBR });
    expect(saida.n).toBe(4);
    expect(saida[ptBR.keys.mean]).toBe(5);
    expect(saida).not.toHaveProperty(ptBR.keys.notice);
    expect(JSON.stringify(saida)).toMatch(VALOR_FORMATADO);
  });

  it("um único registro não é confundido com nenhum", () => {
    const e = computeStats([7], (v) => v);
    expect(e.n).toBe(1);
    expect(e.reason).toBeUndefined();
    expect(e.mean).toBe(7);
    expect(e.stdDev).toBe(0); // desvio de um ponto só é ZERO de verdade, não indefinido
    expect(e.median).toBe(7);
  });

  it("zero legítimo continua sendo zero: valores medidos que somam nada", () => {
    // A distinção que este arquivo inteiro defende — "não medi" contra "medi e deu
    // zero". Quatro despesas de R$ 0,00 SÃO uma medição, e têm de sair narradas.
    const e = computeStats([0, 0, 0, 0], (v) => v);
    const saida = formatStats(e, { locale: ptBR });
    expect(e.n).toBe(4);
    expect(e.reason).toBeUndefined();
    expect(e.mean).toBe(0);
    expect(saida).not.toHaveProperty(ptBR.keys.notice);
    expect(JSON.stringify(saida)).toMatch(/R\$ 0,00/);
  });
});
