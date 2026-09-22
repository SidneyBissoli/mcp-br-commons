/**
 * O vocabulário da pergunta contra o da fonte — a receita que os cinco
 * servidores carregavam em cópia. Os pares aqui são os MEDIDOS neles em
 * setembro de 2026 (ILOSTAT, UIS, IBGE, CID-10, BCB); os nomes de documento são
 * reais. O que este teste prova é a MECÂNICA (frase antes da palavra, stopword,
 * singular por idioma, nota dita, ponta inversa) — a tabela de cada servidor é
 * provada lá, contra o catálogo dele.
 */

import { describe, expect, it } from "vitest";
import { createVocabulary, type VocabularyEntry } from "../src/vocabulary.js";

const EN: VocabularyEntry[] = [
  { asked: "wages", source: ["earnings", "wage"] },
  { asked: "wage", source: ["earnings", "wage"] },
  { asked: "labor", source: ["labour"] },
  { asked: "workforce", source: ["labour force"] },
  { asked: "productivity", source: ["output per worker"] },
  { asked: "enrollment", source: ["enrolment", "enrolled"] },
];

const PT: VocabularyEntry[] = [
  { asked: "renda", source: ["rendimento"] },
  { asked: "desemprego", source: ["desocupa"] },
  { asked: "cidade", source: ["cidade", "municipio"] },
  { asked: "cancer", source: ["neoplasia maligna", "carcinoma"] },
  { asked: "pressão alta", source: ["hipertens"] },
  { asked: "conta corrente", source: ["transacoes correntes"] },
  { asked: "calote", source: ["inadimplencia"] },
];

const en = createVocabulary({ entries: EN, locale: "en", sourceName: "ILOSTAT" });
const pt = createVocabulary({ entries: PT, locale: "pt-BR", sourceName: "o IBGE" });

describe("expansão de termo", () => {
  it("sinônimo medido e o próprio termo primeiro — expandir nunca perde o que já casava", () => {
    expect(en.expandTerm("wages")).toEqual(["wages", "earnings", "wage"]);
    expect(en.expandTerm("unemployment")).toEqual(["unemployment"]);
    expect(pt.expandTerm("Cidades")).toEqual(["cidades", "cidade", "municipio"]);
  });

  it("singular em inglês: ies → y, s final; nunca 'es' (wages não vira wag)", () => {
    expect(en.expandTerm("countries")).toContain("country");
    expect(en.expandTerm("rates")).toEqual(["rates", "rate"]);
    expect(en.expandTerm("wages")).not.toContain("wag");
  });

  it("singular em português: ões → ão, ais/eis/ois → al/el/ol, s final", () => {
    expect(pt.expandTerm("informações")).toContain("informacao");
    expect(pt.expandTerm("imóveis")).toContain("imovel");
    expect(pt.expandTerm("municípios")).toContain("municipio");
  });

  it("acento e caixa não distinguem: os dois lados passam pelo mesmo funil", () => {
    expect(pt.normalize("População Residente")).toBe("populacao residente");
    expect(pt.expandTerm("CÂNCER")[1]).toBe("neoplasia maligna");
  });
});

describe("a consulta inteira", () => {
  it("stopword não entra no AND, mas consulta só de stopword continua valendo", () => {
    expect(en.queryTerms("hours of work")).toEqual(["hours", "work"]);
    expect(en.queryTerms("of")).toEqual(["of"]);
    expect(pt.queryTerms("grupo de idade")).toEqual(["grupo", "idade"]);
    expect(pt.queryTerms("de")).toEqual(["de"]);
  });

  it("frase da tabela vira UM termo antes da quebra: 'pressão alta' não morre no 'alta'", () => {
    const e = pt.expandQuery("pressão alta");
    expect(e).toHaveLength(1);
    expect(e[0]).toEqual({ term: "pressao alta", patterns: ["pressao alta", "hipertens"], translated: true });
  });

  it("frase da tabela convive com palavras e stopwords ao redor", () => {
    expect(pt.expandQuery("saldo da conta corrente").map((e) => e.term)).toEqual(["conta corrente", "saldo"]);
  });

  it("frase parcial não casa: 'corrente' sozinho não é 'conta corrente'", () => {
    expect(pt.expandQuery("corrente").map((e) => e.translated)).toEqual([false]);
  });

  it("marca como traduzido só o que a TABELA mudou, não o plural", () => {
    expect(en.expandQuery("wages").map((e) => e.translated)).toEqual([true]);
    expect(en.expandQuery("rates").map((e) => e.translated)).toEqual([false]);
    expect(pt.expandQuery("desempregos").map((e) => e.translated)).toEqual([true]);
  });
});

describe("busca: OR dentro do termo, AND entre termos", () => {
  const docs = [
    "Average monthly earnings of employees by sex and economic activity",
    "Labour force participation rate by sex and age",
    "Output per worker, GDP constant 2015 US $",
    "Enrolment in primary education, both sexes (number)",
  ].map((d) => en.normalize(d));
  const busca = (q: string) => docs.filter((d) => en.matchesQuery(d, en.expandQuery(q)));

  it("wages acha earnings; labor force acha labour force; productivity acha output per worker", () => {
    expect(busca("wages")).toHaveLength(1);
    expect(busca("labor force participation")).toHaveLength(1);
    expect(busca("workforce")).toHaveLength(1);
    expect(busca("productivity")).toHaveLength(1);
    expect(busca("enrollment primary")).toHaveLength(1);
  });

  it("AND entre termos: 'earnings hours' não casa nada; termo sem correspondência segue em zero", () => {
    expect(busca("earnings hours")).toHaveLength(0);
    expect(busca("telework")).toHaveLength(0);
  });

  it("matchesTerm é a semântica do LIKE: substring de qualquer padrão", () => {
    const e = en.expandQuery("labor")[0]!;
    expect(en.matchesTerm("labour force", e)).toBe(true);
    expect(en.matchesTerm("earnings", e)).toBe(false);
  });

  it("tabela vazia é expansão nula: a busca fica exatamente como era", () => {
    const nulo = createVocabulary({ entries: [], locale: "en", sourceName: "x" });
    expect(nulo.expandQuery("labor force")).toEqual([
      { term: "labor", patterns: ["labor"], translated: false },
      { term: "force", patterns: ["force"], translated: false },
    ]);
    expect(nulo.vocabularyNotes(nulo.expandQuery("labor"))).toEqual([]);
  });
});

describe("a tradução é dita, no idioma da consulta", () => {
  it("inglês nomeia o termo, as grafias e a fonte", () => {
    expect(en.vocabularyNotes(en.expandQuery("wages"))).toEqual([
      '"wages" was also searched as earnings, wage — the wording ILOSTAT uses.',
    ]);
  });

  it("português idem, e frase da tabela aparece inteira", () => {
    expect(pt.vocabularyNotes(pt.expandQuery("pressão alta"))).toEqual([
      '"pressao alta" também foi buscado como hipertens — a palavra que o IBGE usa.',
    ]);
  });

  it("termo que já é o da fonte, plural ou acento não geram nota", () => {
    expect(en.vocabularyNotes(en.expandQuery("unemployment rates"))).toEqual([]);
    expect(pt.vocabularyNotes(pt.expandQuery("populacao municípios"))).toEqual([]);
  });
});

describe("a ponta inversa, para o índice de search", () => {
  it("um documento de earnings é encontrável por wages e wage", () => {
    expect(en.askedWordsFor("Average monthly earnings of employees")).toEqual(["wages", "wage"]);
  });

  it("um documento com a palavra da fonte acentuada é encontrável pela palavra perguntada", () => {
    expect(pt.askedWordsFor("Inadimplência da carteira de crédito - Total")).toEqual(["calote"]);
  });

  it("nome sem palavra da tabela não ganha keyword", () => {
    expect(en.askedWordsFor("Hours of work per week")).toEqual([]);
  });
});

describe("fronteira de palavra: o padrão casa o INÍCIO de uma palavra, nunca o miolo", () => {
  const casa = (nome: string, termo: string, v = pt): boolean =>
    v.matchesQuery(v.normalize(nome), v.expandQuery(termo));

  // Nomes REAIS dos catálogos, e as contagens que a medição de 22/09/2026 deu
  // com o casamento antigo (substring em qualquer posição).
  it("o miolo de uma palavra deixa de casar — era 1 de 1 resultado errado", () => {
    // CNAE 4633801, o único que "uber" achava: TUBÉRCULOS.
    expect(
      casa("COMÉRCIO ATACADISTA DE FRUTAS, VERDURAS, RAÍZES, TUBÉRCULOS, HORTALIÇAS", "uber")
    ).toBe(false);
    // CNAE: "ovo" achava 11, e 9 eram estes.
    expect(casa("COMÉRCIO A VAREJO DE AUTOMÓVEIS, CAMIONETAS E UTILITÁRIOS NOVOS", "ovo")).toBe(false);
    // SIDRA: "idade" achava 6.092 dos 9.336 agregados, quase todos assim.
    expect(casa("Atividades de apoio à agricultura", "idade")).toBe(false);
    // CNAE: "negro" chegava aqui por "preta", dentro de interPRETAção.
    expect(casa("SERVIÇOS DE TRADUÇÃO, INTERPRETAÇÃO E SIMILARES", "preta")).toBe(false);
  });

  it("e o resultado CERTO continua vindo", () => {
    expect(casa("PRODUÇÃO DE OVOS", "ovo")).toBe(true);
    expect(casa("Pessoas de 10 anos ou mais de idade, por sexo", "idade")).toBe(true);
    expect(casa("População residente, por cor ou raça — preta", "preta")).toBe(true);
  });

  it("no catálogo em inglês, 'male' deixa de casar dentro de 'female'", () => {
    // O mais caro de perceber: perguntar por homens trazia mulheres, calado.
    expect(casa("Employment by sex: female", "male", en)).toBe(false);
    expect(casa("Employment by sex: male", "male", en)).toBe(true);
  });

  it("RADICAL da tabela segue valendo — é prefixo de palavra, não miolo", () => {
    // Exigir fronteira também no FIM mataria estes: medido em 22/09/2026,
    // `ocupa` cairia de 1.609 para 0 e `odontolog` de 5 para 0.
    expect(casa("Taxa de desocupação das pessoas de 14 anos ou mais", "desemprego")).toBe(true);
    expect(casa("Pessoas desocupadas na semana de referência", "desemprego")).toBe(true);
    const med = createVocabulary({
      entries: [{ asked: "dentista", source: ["odontolog"] }],
      locale: "pt-BR",
      sourceName: "a CNAE",
    });
    for (const nome of ["ATIVIDADE ODONTOLÓGICA", "FABRICAÇÃO DE MATERIAIS PARA MEDICINA E ODONTOLOGIA"]) {
      expect(med.matchesQuery(med.normalize(nome), med.expandQuery("dentista")), nome).toBe(true);
    }
  });

  it("frase da tabela também casa começando palavra, e não no miolo", () => {
    expect(casa("Pessoas com hipertensão arterial diagnosticada", "pressão alta")).toBe(true);
    expect(casa("Transações correntes do balanço de pagamentos", "conta corrente")).toBe(true);
  });

  it("a ponta inversa usa a MESMA fronteira — keyword não nasce de miolo", () => {
    // Sem isto o índice de `search` ganharia a palavra perguntada por acidente,
    // e o defeito voltaria pelo outro lado.
    expect(pt.askedWordsFor("SERVIÇOS DE TRADUÇÃO, INTERPRETAÇÃO E SIMILARES")).toEqual([]);
    expect(pt.askedWordsFor("Rendimento médio mensal real")).toEqual(["renda"]);
  });

  it("separador que não é espaço continua abrindo palavra", () => {
    // Vírgula, parêntese, hífen e barra separam palavra como o espaço separa.
    expect(casa("Rendimento nominal (renda)", "renda")).toBe(true);
    expect(casa("Indicadores,rendimento", "renda")).toBe(true);
    expect(casa("Taxa de desocupação/subutilização", "desemprego")).toBe(true);
  });
});
