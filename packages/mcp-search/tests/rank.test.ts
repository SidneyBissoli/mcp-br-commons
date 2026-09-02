import { describe, expect, it } from "vitest";
import { createIndex, normalizeText, rankEntries, tokenize, type IndexEntry } from "../src/rank.js";

const acervo: IndexEntry[] = [
  {
    id: "sidra:6579",
    title: "Tabela 6579 — População residente estimada",
    url: "https://sidra.ibge.gov.br/tabela/6579",
    keywords: ["estimativas de população", "POP"],
  },
  {
    id: "sidra:1612",
    title: "Tabela 1612 — Área plantada, área colhida e produção de lavouras temporárias",
    url: "https://sidra.ibge.gov.br/tabela/1612",
    keywords: ["PAM"],
    text: "Produção agrícola municipal: soja, milho, cana-de-açúcar",
  },
  {
    id: "mun:3550308",
    title: "São Paulo (SP)",
    url: "https://cidades.ibge.gov.br/brasil/sp/sao-paulo/panorama",
    keywords: ["município", "capital"],
  },
  {
    id: "mun:2927408",
    title: "Salvador (BA)",
    url: "https://cidades.ibge.gov.br/brasil/ba/salvador/panorama",
    keywords: ["município", "capital"],
  },
  {
    id: "ind:populacao",
    title: "População residente (estimativas anuais)",
    url: "https://sidra.ibge.gov.br/tabela/6579",
    text: "Estimativas de população por município, UF e Brasil",
  },
];

describe("normalizeText e tokenize", () => {
  it("tira acentos, baixa a caixa e colapsa espaços", () => {
    expect(normalizeText("  População   Residente Ção ")).toBe("populacao residente cao");
  });

  it("tokeniza sem stopwords, sem repetição, mantendo a ordem", () => {
    expect(tokenize("Produção de soja e de milho no Paraná")).toEqual([
      "producao",
      "soja",
      "milho",
      "parana",
    ]);
  });

  it("descarta tokens de um caractere", () => {
    expect(tokenize("PIB a preços de 2010")).toEqual(["pib", "precos", "2010"]);
  });
});

describe("createIndex().search", () => {
  const indice = createIndex(acervo);

  it("devolve só os três campos do contrato", () => {
    const [primeiro] = indice.search("salvador");
    expect(primeiro).toEqual({
      id: "mun:2927408",
      title: "Salvador (BA)",
      url: "https://cidades.ibge.gov.br/brasil/ba/salvador/panorama",
    });
  });

  it("ignora acentos e caixa dos dois lados", () => {
    expect(indice.search("POPULAÇÃO").map((r) => r.id)).toEqual(
      indice.search("populacao").map((r) => r.id)
    );
    expect(indice.search("são paulo")[0]?.id).toBe("mun:3550308");
    expect(indice.search("sao paulo")[0]?.id).toBe("mun:3550308");
  });

  it("código ou chave digitados como consulta trazem o item pelo id antes de tudo", () => {
    expect(indice.search("6579")[0]?.id).toBe("sidra:6579");
    // "populacao" é token do id `ind:populacao` (peso 10) — passa a 6579, que
    // só casa em título e palavra-chave.
    expect(indice.search("populacao")[0]?.id).toBe("ind:populacao");
  });

  it("cobertura vence repetição: quem casa os dois termos passa quem casa um", () => {
    // "estimativas população": ind:populacao e a 6579 casam os DOIS termos;
    // São Paulo não casa nenhum e fica fora.
    const ids = indice.search("estimativas população").map((r) => r.id);
    expect(ids.slice(0, 2)).toEqual(["ind:populacao", "sidra:6579"]);
    expect(ids).not.toContain("mun:3550308");
    // "produção soja": a 1612 casa os dois (título + texto) e é a única.
    expect(indice.search("produção soja").map((r) => r.id)).toEqual(["sidra:1612"]);
  });

  it("casa por prefixo a partir de 3 caracteres, valendo menos que o exato", () => {
    const ids = indice.search("popul").map((r) => r.id);
    expect(ids).toContain("sidra:6579");
    expect(ids).toContain("ind:populacao");
    expect(indice.search("po")).toEqual([]);
  });

  it("frase inteira no título ganha bônus", () => {
    expect(indice.search("população residente estimada")[0]?.id).toBe("sidra:6579");
  });

  it("texto longo pesa menos, mas conta", () => {
    expect(indice.search("soja").map((r) => r.id)).toEqual(["sidra:1612"]);
  });

  it("empate mantém a ordem do acervo", () => {
    expect(indice.search("capital").map((r) => r.id)).toEqual(["mun:3550308", "mun:2927408"]);
  });

  it("respeita o limite e devolve vazio para consulta vazia ou só de stopwords", () => {
    expect(indice.search("município", { limit: 1 })).toHaveLength(1);
    expect(indice.search("")).toEqual([]);
    expect(indice.search("de e a")).toEqual([]);
    expect(indice.search("capital", { limit: 0 })).toEqual([]);
  });

  it("consulta sem nenhum casamento devolve vazio (não o acervo inteiro)", () => {
    expect(indice.search("xyzzy")).toEqual([]);
  });

  it("expõe o tamanho do acervo", () => {
    expect(indice.size).toBe(acervo.length);
  });
});

describe("rankEntries", () => {
  it("é o atalho para indexar e buscar de uma vez", () => {
    expect(rankEntries(acervo, "salvador")).toEqual(createIndex(acervo).search("salvador"));
  });
});
