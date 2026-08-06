import { describe, expect, it } from "vitest";
import { createProvenanceContext } from "../src/context.js";

const ptCtx = createProvenanceContext({
  metaNamespace: "com.exemplo.teste",
  locale: "pt-BR",
  timezone: { offset: "-03:00", label: "horário de Brasília" },
});

const enCtx = createProvenanceContext({ metaNamespace: "com.exemplo.teste", locale: "en", timezone: "utc" });

const senadoInput = {
  source: "Senado Federal — Dados Abertos (Legislativo)",
  source_url: "https://legis.senado.leg.br/dadosabertos/processo.json",
  citation: "Fonte: Senado Federal, Portal de Dados Abertos.",
  license: "Dados Abertos do Senado Federal — uso livre com atribuição da fonte.",
  data_vintage: "2025",
  retrieved_at: "2026-08-06T12:00:00Z",
};

describe("rodapé pt-BR", () => {
  it("modo concise: fonte, vintage, extração humanizada, licença e o aviso da decisão 5", () => {
    const footer = ptCtx.footer(ptCtx.build(senadoInput));
    expect(footer).toBe(
      [
        "---",
        "Fonte: Senado Federal — Dados Abertos (Legislativo) · https://legis.senado.leg.br/dadosabertos/processo.json · dados de 2025 · extraído em 06/08/2026 às 09:00 (horário de Brasília)",
        "Licença: Dados Abertos do Senado Federal — uso livre com atribuição da fonte.",
        "A referência completa desta informação pode ser solicitada nesta própria conversa.",
      ].join("\n"),
    );
  });

  it("modo detailed omite o aviso (a referência completa já está na resposta)", () => {
    const footer = ptCtx.footer(ptCtx.build(senadoInput), "detailed");
    expect(footer).not.toMatch(/solicitada nesta própria conversa/);
    expect(footer).toMatch(/^---\nFonte: /);
  });

  it("sem vintage, o segmento some (função pura da entrada — ainda determinístico)", () => {
    const { data_vintage: _, ...noVintage } = senadoInput;
    const footer = ptCtx.footer(ptCtx.build(noVintage));
    expect(footer).not.toMatch(/dados de/);
  });
});

describe("rodapé en", () => {
  it("usa os rótulos e o aviso em inglês", () => {
    const footer = enCtx.footer(
      enCtx.build({
        source: "ILOSTAT",
        source_url: "https://sdmx.ilo.org/rest/data/ILO,DF_X/all",
        citation: "ILO, ILOSTAT.",
        license: { id: "CC-BY-4.0" },
        data_vintage: "2026-06-15",
        retrieved_at: "2026-08-04T14:32:07Z",
      }),
    );
    expect(footer).toContain("Source: ILOSTAT");
    expect(footer).toContain("data as of 2026-06-15");
    expect(footer).toContain("retrieved on 2026-08-04, 14:32 (UTC)");
    expect(footer).toContain("License: CC-BY-4.0.");
    expect(footer).toContain("can be requested here, in this same conversation.");
  });
});

describe("segregação multi-fonte", () => {
  it("uma dupla de linhas por fonte, cada qual com sua licença; aviso uma única vez", () => {
    const ilostat = enCtx.build({
      source: "ILOSTAT",
      source_url: "https://sdmx.ilo.org/rest/a",
      citation: "ILO.",
      license: { id: "CC-BY-4.0" },
      retrieved_at: "2026-08-04T14:32:07Z",
    });
    const uis = enCtx.build({
      source: "UIS Data Browser",
      source_url: "https://api.uis.unesco.org/b",
      citation: "UIS.",
      license: { id: "CC-BY-SA-4.0" },
      retrieved_at: "2026-08-04T14:32:07Z",
    });
    const footer = enCtx.footer([ilostat, uis]);
    expect(footer).toContain("License: CC-BY-4.0.");
    expect(footer).toContain("License: CC-BY-SA-4.0.");
    expect(footer.match(/in this same conversation/g)).toHaveLength(1);
  });
});
