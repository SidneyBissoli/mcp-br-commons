import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  migrarSenado,
  normalizarTimestamp,
  type DatapackageLegado,
  type ReleaseLegado,
} from "../src/migrate-senado.js";
import { validarDescriptor } from "../src/validate.js";

const legado = JSON.parse(
  readFileSync(new URL("./fixtures/senado-datapackage-legado.json", import.meta.url), "utf8"),
) as DatapackageLegado;
const release = JSON.parse(
  readFileSync(new URL("./fixtures/senado-release-legado.json", import.meta.url), "utf8"),
) as ReleaseLegado;

describe("migrarSenado", () => {
  const descriptor = migrarSenado(legado, release);

  it("produz um Data Package v2 válido (profile + checagens do portfólio)", () => {
    const resultado = validarDescriptor(descriptor);
    expect(resultado.erros).toEqual([]);
    expect(resultado.ok).toBe(true);
  });

  it("mapeia os campos padrão: name/title/version/created/licenses/sources", () => {
    expect(descriptor.name).toBe("ecidadania-participacao");
    expect(descriptor.version).toBe("1.0.0");
    // generatedAt do release (precedência) normalizado sem milissegundos
    expect(descriptor.created).toBe("2026-07-03T00:00:00Z");
    expect(descriptor.licenses).toEqual([
      {
        path: "https://www12.senado.leg.br/dados-abertos",
        title: "Dados Abertos do Senado Federal — uso livre com atribuição da fonte.",
      },
    ]);
    expect(descriptor.sources).toEqual([
      {
        title:
          "Senado Federal — Portal e-Cidadania (www12.senado.leg.br/ecidadania) + acervo Arquimedes",
      },
    ]);
  });

  it("omite id enquanto o version-DOI for PENDENTE, preservando-o em custom property", () => {
    expect(descriptor.id).toBeUndefined();
    expect(descriptor["senado:versionDoi"]).toBe("10.5281/zenodo.PENDENTE");
    expect(descriptor["senado:conceptDoi"]).toBe("10.5281/zenodo.PENDENTE");
  });

  it("emite id como URL de DOI quando o version-DOI foi cunhado", () => {
    const cunhado = migrarSenado(legado, { ...release, versionDoi: "10.5281/zenodo.1234567" });
    expect(cunhado.id).toBe("https://doi.org/10.5281/zenodo.1234567");
  });

  it("converte entities[] + files[] em resources[] absorvendo o SHA256SUMS", () => {
    const resources = descriptor.resources as Record<string, unknown>[];
    // 6 files no release.json, menos o próprio datapackage.json
    expect(resources).toHaveLength(5);

    const consultas = resources.find((r) => r.name === "consultas")!;
    expect(consultas.path).toBe("consultas.ndjson");
    expect(consultas.title).toBe("Consultas públicas (Apoie)");
    expect(consultas.format).toBe("ndjson");
    expect(consultas.mediatype).toBe("application/x-ndjson");
    expect(consultas.bytes).toBe(26244431);
    expect(consultas.hash).toBe(
      "sha256:fa99e5ed74c01e7eb3904b04b5fc81bc66a857f692c1fdc046ef91eea4a1576d",
    );
    expect(consultas["senado:records"]).toBe(7773);
    expect(consultas["senado:corpusTotal"]).toBe(7773);
    expect(consultas["senado:hasFirstSeen"]).toBe(true);

    // dictionary.md não é entidade: vira resource de documentação, sem records
    const dictionary = resources.find((r) => r.path === "dictionary.md")!;
    expect(dictionary.name).toBe("dictionary");
    expect(dictionary.format).toBe("md");
    expect(dictionary["senado:records"]).toBeUndefined();
  });

  it("preserva os campos sem equivalente na spec como custom properties com namespace", () => {
    expect(descriptor["senado:edition"]).toBe("Inaugural — bootstrap 2026 (piso 14/06/2026)");
    expect(descriptor["senado:schemaVersion"]).toBe("1.0.0");
    expect(descriptor["senado:gitCommit"]).toBe("0d3a73ed9442fcf66c91542d2fa9c2b8cab8e70b");
    expect(descriptor["senado:envelope"]).toEqual(release.envelope);
    expect(descriptor["senado:totalRecords"]).toBe(142005);
    expect(descriptor["senado:changelog"]).toBe("CHANGELOG-dataset.md");
    expect(descriptor["senado:citation"]).toBe("CITATION.cff");
    // caveats do release.json (conjunto mais completo) têm precedência
    expect(descriptor["senado:caveats"]).toEqual(release.caveats);
    // sample (sempre null) é descartado por decisão
    expect("sample" in descriptor).toBe(false);
    expect("senado:sample" in descriptor).toBe(false);
  });

  it("aceita namespace customizado", () => {
    const outro = migrarSenado(legado, release, { namespace: "meuns" });
    expect(outro["meuns:totalRecords"]).toBe(142005);
    expect(validarDescriptor(outro).ok).toBe(true);
  });
});

describe("normalizarTimestamp", () => {
  it("remove milissegundos preservando o fuso", () => {
    expect(normalizarTimestamp("2026-07-03T00:00:00.000Z")).toBe("2026-07-03T00:00:00Z");
    expect(normalizarTimestamp("2026-07-03T00:00:00.182-03:00")).toBe("2026-07-03T00:00:00-03:00");
    expect(normalizarTimestamp("2026-07-03T00:00:00Z")).toBe("2026-07-03T00:00:00Z");
  });
});
