/**
 * Migração POR MAPEAMENTO (não reescrita) do formato legado do dataset do
 * senado-br-mcp-cloudflare (datapackage.json próprio + release.json) para um
 * descriptor Frictionless Data Package v2 válido.
 *
 * Decisão da Fase 0 (Entregável 4): release.json é ABSORVIDO pelo descriptor —
 * todo campo migra (tabela de mapeamento no README). O único artefato de
 * integridade que permanece fora é o SHA256SUMS, porque o descriptor não pode
 * conter o próprio hash. A migração é zero-perda: campos sem equivalente na
 * spec viram custom properties com namespace (`<ns>:campo`), como a spec v2
 * recomenda. Aplicação real acontece no PRÓXIMO release do dataset (o 1.0.0
 * publicado é congelado/append-only — nunca reescrever release publicado).
 */

export interface EntidadeLegada {
  entidade: string;
  titulo: string;
  file: string;
  recordCount: number;
  corpusTotal: number;
  hasFirstSeen: boolean;
}

export interface DatapackageLegado {
  name: string;
  title: string;
  schemaVersion: string;
  license: string;
  source: string;
  generatedAt: string;
  sample: unknown;
  envelope: string[];
  entities: EntidadeLegada[];
  caveats: string[];
}

export interface ArquivoRelease {
  file: string;
  sha256: string;
  bytes: number;
  records?: number;
}

export interface ReleaseLegado {
  name: string;
  title: string;
  releaseVersion: string;
  edition: string;
  schemaVersion: string;
  conceptDoi: string;
  versionDoi: string;
  license: string;
  licenseUrl: string;
  source: string;
  gitCommit: string;
  generatedAt: string;
  envelope: string[];
  totalRecords: number;
  files: ArquivoRelease[];
  changelog: string;
  citation: string;
  caveats: string[];
}

export interface OpcoesMigracao {
  /** Namespace das custom properties (default: "senado"). */
  namespace?: string;
}

const MEDIATYPES: Record<string, string> = {
  ndjson: "application/x-ndjson",
  parquet: "application/vnd.apache.parquet",
  csv: "text/csv",
  json: "application/json",
  md: "text/markdown",
};

function formatoDe(file: string): string {
  const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
  return ext;
}

/** RFC 3339 sem milissegundos (timestamp canônico do portfólio). */
export function normalizarTimestamp(ts: string): string {
  return ts.replace(/\.\d{3,}(?=Z|[+-]\d{2}:\d{2}$)/, "");
}

function doiCunhado(doi: string): boolean {
  return doi !== "" && !doi.toUpperCase().includes("PENDENTE");
}

/**
 * Gera o descriptor v2 a partir dos dois arquivos legados. release.json tem
 * precedência nos campos que os dois carregam (é o manifesto do release).
 */
export function migrarSenado(
  legado: DatapackageLegado,
  release: ReleaseLegado,
  opcoes: OpcoesMigracao = {},
): Record<string, unknown> {
  const ns = opcoes.namespace ?? "senado";
  const porArquivo = new Map(legado.entities.map((e) => [e.file, e]));

  const resources = release.files
    .filter((f) => f.file !== "datapackage.json") // auto-hash fica no SHA256SUMS
    .map((f) => {
      const entidade = porArquivo.get(f.file);
      const format = formatoDe(f.file);
      const resource: Record<string, unknown> = {
        name: entidade?.entidade ?? f.file.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]/g, "-"),
        path: f.file,
        ...(entidade ? { title: entidade.titulo } : {}),
        format,
        ...(MEDIATYPES[format] ? { mediatype: MEDIATYPES[format] } : {}),
        bytes: f.bytes,
        hash: `sha256:${f.sha256.toLowerCase()}`,
      };
      if (f.records !== undefined) resource[`${ns}:records`] = f.records;
      if (entidade) {
        resource[`${ns}:corpusTotal`] = entidade.corpusTotal;
        resource[`${ns}:hasFirstSeen`] = entidade.hasFirstSeen;
      }
      return resource;
    });

  const descriptor: Record<string, unknown> = {
    $schema: "https://datapackage.org/profiles/2.0/datapackage.json",
    name: release.name,
    // id só quando o version-DOI foi cunhado — é o identificador global DESTE
    // snapshot; o concept-DOI (estável entre versões) vive em custom property.
    ...(doiCunhado(release.versionDoi) ? { id: `https://doi.org/${release.versionDoi}` } : {}),
    title: release.title,
    version: release.releaseVersion,
    created: normalizarTimestamp(release.generatedAt),
    licenses: [
      {
        path: release.licenseUrl,
        title: release.license,
      },
    ],
    sources: [
      {
        title: release.source,
      },
    ],
    resources,
    [`${ns}:edition`]: release.edition,
    [`${ns}:schemaVersion`]: release.schemaVersion,
    [`${ns}:conceptDoi`]: release.conceptDoi,
    [`${ns}:versionDoi`]: release.versionDoi,
    [`${ns}:gitCommit`]: release.gitCommit,
    [`${ns}:envelope`]: release.envelope,
    [`${ns}:totalRecords`]: release.totalRecords,
    [`${ns}:changelog`]: release.changelog,
    [`${ns}:citation`]: release.citation,
    [`${ns}:caveats`]: release.caveats, // release.json traz o conjunto mais completo
  };
  // Campo legado descartado por decisão: `sample` (sempre null em produção).

  return descriptor;
}
