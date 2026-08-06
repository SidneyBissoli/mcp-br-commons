/**
 * Validação de datapackage.json contra o profile oficial Frictionless Data
 * Package v2 (vendorado em profiles/datapackage-2.0.json, draft-07) mais as
 * checagens do portfólio que a spec não impõe.
 *
 * A spec exige apenas `resources`; o portfólio exige o piso de citação e
 * reprodutibilidade do contrato de proveniência: name, title, version,
 * created, licenses e sources, além de integridade (bytes + hash sha256)
 * em todo resource.
 */
import { readFileSync } from "node:fs";
import { Ajv, type ValidateFunction } from "ajv";
import addFormatsExport, { type FormatsPlugin } from "ajv-formats";

// Interop CJS↔ESM sob NodeNext: o default import resolve para o namespace do
// módulo (não chamável); em runtime tanto o namespace quanto .default são a função.
const addFormats = ((addFormatsExport as { default?: FormatsPlugin }).default ??
  addFormatsExport) as FormatsPlugin;

export const PROFILE_URL = "https://datapackage.org/profiles/2.0/datapackage.json";

// Timestamps canônicos do portfólio: RFC 3339 sem milissegundos (contrato v1.0).
const TIMESTAMP_CANONICO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/;

export interface ResultadoValidacao {
  ok: boolean;
  erros: string[];
}

let compiled: ValidateFunction | undefined;

function profileValidator(): ValidateFunction {
  if (!compiled) {
    const profile = JSON.parse(
      readFileSync(new URL("../profiles/datapackage-2.0.json", import.meta.url), "utf8"),
    ) as object;
    // strict: false — o profile usa keywords de UI (propertyOrder, options...).
    const ajv = new Ajv({ strict: false, allErrors: true });
    addFormats(ajv);
    ajv.addFormat("textarea", true); // keyword de UI do profile, sem semântica de validação
    compiled = ajv.compile(profile);
  }
  return compiled;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Valida um descriptor já parseado. */
export function validarDescriptor(descriptor: unknown): ResultadoValidacao {
  const erros: string[] = [];

  const validate = profileValidator();
  if (!validate(descriptor)) {
    for (const e of validate.errors ?? []) {
      erros.push(`profile v2: ${e.instancePath || "(raiz)"} ${e.message ?? "inválido"}`);
    }
  }

  if (!isRecord(descriptor)) {
    return { ok: false, erros: erros.length ? erros : ["descriptor não é um objeto JSON"] };
  }

  if (descriptor.$schema !== PROFILE_URL) {
    erros.push(`$schema deve ser "${PROFILE_URL}" (encontrado: ${JSON.stringify(descriptor.$schema)})`);
  }

  for (const campo of ["name", "title", "version"] as const) {
    if (typeof descriptor[campo] !== "string" || descriptor[campo] === "") {
      erros.push(`campo obrigatório do portfólio ausente ou vazio: ${campo}`);
    }
  }

  if (typeof descriptor.created !== "string" || !TIMESTAMP_CANONICO.test(descriptor.created)) {
    erros.push(
      "created deve ser timestamp RFC 3339 sem milissegundos (ex.: 2026-08-06T12:00:00Z)",
    );
  }

  if (!Array.isArray(descriptor.licenses) || descriptor.licenses.length === 0) {
    erros.push("licenses deve ter ao menos uma entrada (licença do DADO, não do código)");
  }
  if (!Array.isArray(descriptor.sources) || descriptor.sources.length === 0) {
    erros.push("sources deve ter ao menos uma entrada (fonte original do dado)");
  }

  const resources = Array.isArray(descriptor.resources) ? descriptor.resources : [];
  const nomes = new Set<string>();
  const paths = new Set<string>();
  resources.forEach((r, i) => {
    if (!isRecord(r)) return; // o profile já acusa
    const rotulo = typeof r.name === "string" ? r.name : `#${i}`;

    if (typeof r.name === "string") {
      if (nomes.has(r.name)) erros.push(`resource com name duplicado: ${r.name}`);
      nomes.add(r.name);
    }
    if (typeof r.path === "string") {
      if (paths.has(r.path)) erros.push(`resource com path duplicado: ${r.path}`);
      paths.add(r.path);
    } else {
      erros.push(`resource ${rotulo}: o portfólio exige path (arquivo em disco, não data inline)`);
    }
    if (typeof r.format !== "string" || r.format === "") {
      erros.push(`resource ${rotulo}: format ausente`);
    }
    if (typeof r.bytes !== "number") {
      erros.push(`resource ${rotulo}: bytes ausente`);
    }
    if (typeof r.hash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(r.hash)) {
      erros.push(`resource ${rotulo}: hash deve ter a forma sha256:<64 hex minúsculos>`);
    }
  });

  return { ok: erros.length === 0, erros };
}

/** Lê e valida um datapackage.json em disco. */
export function validarArquivo(caminho: string): ResultadoValidacao {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(caminho, "utf8"));
  } catch (e) {
    return { ok: false, erros: [`falha ao ler/parsear ${caminho}: ${(e as Error).message}`] };
  }
  return validarDescriptor(parsed);
}
