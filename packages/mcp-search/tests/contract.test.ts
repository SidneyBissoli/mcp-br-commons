import { describe, expect, it } from "vitest";
import { z } from "zod";
import { contractJsonSchemas, contractSchemas, type ContractLocale } from "../src/contract.js";

const LOCALES: ContractLocale[] = ["pt-BR", "en"];
const NOMES = [
  "searchInputSchema",
  "searchOutputSchema",
  "fetchInputSchema",
  "fetchDocumentSchema",
] as const;

/** Apaga toda `description` de um schema JSON, em qualquer profundidade. */
function semDescricoes(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(semDescricoes);
  if (valor && typeof valor === "object") {
    return Object.fromEntries(
      Object.entries(valor as Record<string, unknown>)
        .filter(([k]) => k !== "description")
        .map(([k, v]) => [k, semDescricoes(v)]),
    );
  }
  return valor;
}

describe("contractJsonSchemas", () => {
  for (const locale of LOCALES) {
    describe(locale, () => {
      const zod = contractSchemas(locale);
      const json = contractJsonSchemas(locale);

      for (const nome of NOMES) {
        it(`${nome}: objeto draft-07 com as mesmas chaves, required e descrições do zod`, () => {
          const j = json[nome] as {
            type: string;
            properties: Record<string, { description?: string }>;
            required?: string[];
            $schema?: string;
          };
          const shape = zod[nome].shape as Record<string, z.ZodType>;

          expect(j.$schema).toBeUndefined();
          expect(j.type).toBe("object");
          expect(Object.keys(j.properties)).toEqual(Object.keys(shape));

          const obrigatorias = Object.entries(shape)
            .filter(([, s]) => !s.safeParse(undefined).success)
            .map(([k]) => k);
          expect(j.required ?? []).toEqual(obrigatorias);

          for (const [k, s] of Object.entries(shape)) {
            expect(j.properties[k]?.description).toBe(s.description);
          }
        });
      }

      it("o schema JSON aceita e recusa os mesmos objetos que o zod (amostra)", () => {
        const doc = json.fetchDocumentSchema as { required: string[] };
        const completo = { id: "a", title: "A", text: "t", url: "https://x/a", metadata: { k: 1 } };
        const magro = { id: "a", title: "A", text: "t", url: "https://x/a" };
        const faltando = { id: "a", title: "A", url: "https://x/a" };
        expect(zod.fetchDocumentSchema.safeParse(completo).success).toBe(true);
        expect(zod.fetchDocumentSchema.safeParse(magro).success).toBe(true);
        expect(zod.fetchDocumentSchema.safeParse(faltando).success).toBe(false);
        expect(doc.required).not.toContain("metadata");
        expect(doc.required).toContain("text");
      });
    });
  }

  it("os dois idiomas têm a mesma forma — só as descrições mudam", () => {
    const pt = contractJsonSchemas("pt-BR");
    const en = contractJsonSchemas("en");
    for (const nome of NOMES) {
      expect(semDescricoes(pt[nome])).toEqual(semDescricoes(en[nome]));
      expect(pt[nome]).not.toEqual(en[nome]);
    }
  });

  it("o searchOutputSchema descreve o array de resultados com id/title/url obrigatórios", () => {
    const j = contractJsonSchemas().searchOutputSchema as {
      properties: { results: { type: string; items: { required: string[] } } };
    };
    expect(j.properties.results.type).toBe("array");
    expect(j.properties.results.items.required).toEqual(["id", "title", "url"]);
  });
});
