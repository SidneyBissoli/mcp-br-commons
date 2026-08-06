/**
 * Fábrica de contexto: o servidor cria UM contexto na inicialização (namespace de
 * `_meta`, idioma, fuso, modo default) e as tools usam os helpers ligados a ele.
 *
 * Três canais para o mesmo envelope (estratégia herdada do senado-br-mcp):
 *  1. `structuredContent.provenance` + `structuredContent.attribution` — canal
 *     PARSEÁVEL e visível ao modelo (para que ele cite fonte/período/extração).
 *  2. `_meta` sob chaves namespaced — metadado out-of-band (auditoria/UI), não custa
 *     tokens do modelo; forward-compat com a Extensions Track de trust/attribution do
 *     MCP (RFC #711 → PR #1913).
 *  3. Linha de fonte compacta anexada ao `content` textual, para clientes text-only.
 *
 * O bloco embutido nos canais 1 e 2 é a PROJEÇÃO do modo da resposta (concise por
 * padrão — decisão 5); `attribution` é sempre a lista canônica de `source_url`.
 */

import { provenanceFooter } from "./footer.js";
import { resolveLocale, type LocaleSpec } from "./locale.js";
import {
  attributionList,
  renderProvenance,
  type ConciseBlock,
  type DetailedBlock,
  type ProvenanceMode,
} from "./render.js";
import {
  assertSemantics,
  CanonicalProvenanceSchema,
  expandInput,
  type CanonicalProvenance,
  type ProvenanceInput,
} from "./schema.js";
import { timezoneLabel, toCanonicalIso, type TimezoneSpec } from "./time.js";

export interface ProvenanceContextOptions {
  /**
   * Namespace reverse-DNS das chaves de `_meta` (ex.: "com.sidneybissoli.senado").
   * Evita colisão com os namespaces reservados do MCP (`modelcontextprotocol.io/`,
   * `mcp.*`) e com `openai/...`. Manter estável — consumidores leem por estas chaves.
   */
  metaNamespace: string;
  /** Idioma do rodapé humano — "pt-BR", "en" ou um LocaleSpec customizado. */
  locale?: string | LocaleSpec;
  /** Fuso de serialização dos timestamps. Default: "utc". */
  timezone?: TimezoneSpec;
  /** Modo default das respostas. Default: "concise" (decisão 5). */
  defaultMode?: ProvenanceMode;
}

/** Preset de fonte: campos fixos por fonte upstream; o restante vem por chamada. */
export type SourcePreset = Pick<ProvenanceInput, "source" | "citation" | "license"> &
  Partial<Pick<ProvenanceInput, "dataset" | "api_version" | "notices">>;

export interface ProvenanceResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown> & {
    provenance: ConciseBlock | DetailedBlock | Array<ConciseBlock | DetailedBlock>;
    attribution: string[];
  };
  _meta: Record<string, unknown>;
}

export interface ProvenanceContext {
  metaKeys: { provenance: string; attribution: string };
  locale: LocaleSpec;
  timezone: TimezoneSpec;
  defaultMode: ProvenanceMode;
  /** Valida e normaliza a entrada no modelo canônico (fuso aplicado a retrieved_at). */
  build(input: ProvenanceInput): CanonicalProvenance;
  /** `build` a partir de um preset de fonte + campos por chamada. */
  from(preset: SourcePreset, perCall: Omit<ProvenanceInput, keyof SourcePreset> & Partial<SourcePreset>): CanonicalProvenance;
  /** Projeção do bloco no modo pedido (default do contexto). */
  render(p: CanonicalProvenance, mode?: ProvenanceMode): ConciseBlock | DetailedBlock;
  /** Rodapé humano para os blocos, no idioma/fuso do contexto. */
  footer(p: CanonicalProvenance | CanonicalProvenance[], mode?: ProvenanceMode): string;
  /** Resultado MCP completo: os três canais. `data` deve ser um objeto. */
  result(
    data: Record<string, unknown>,
    provenance: CanonicalProvenance | CanonicalProvenance[],
    opts?: { mode?: ProvenanceMode },
  ): ProvenanceResult;
}

export function createProvenanceContext(options: ProvenanceContextOptions): ProvenanceContext {
  const locale = resolveLocale(options.locale ?? "pt-BR");
  const timezone = options.timezone ?? "utc";
  const defaultMode = options.defaultMode ?? "concise";
  const ns = options.metaNamespace.replace(/\/+$/, "");
  if (!ns) throw new Error("metaNamespace é obrigatório (ex.: \"com.exemplo.meuservidor\")");
  const metaKeys = { provenance: `${ns}/provenance`, attribution: `${ns}/attribution` };
  const tzLabel = timezoneLabel(timezone);

  function build(input: ProvenanceInput): CanonicalProvenance {
    const retrievedAtIso = toCanonicalIso(input.retrieved_at ?? new Date(), timezone);
    const expanded = expandInput(input, retrievedAtIso);
    if (expanded.field_sources) {
      expanded.field_sources = expanded.field_sources.map((fs) =>
        fs.retrieved_at ? { ...fs, retrieved_at: toCanonicalIso(fs.retrieved_at, timezone) } : fs,
      );
    }
    const parsed = CanonicalProvenanceSchema.parse(expanded);
    assertSemantics(parsed);
    return parsed;
  }

  function from(
    preset: SourcePreset,
    perCall: Omit<ProvenanceInput, keyof SourcePreset> & Partial<SourcePreset>,
  ): CanonicalProvenance {
    return build({ ...preset, ...perCall } as ProvenanceInput);
  }

  function render(p: CanonicalProvenance, mode?: ProvenanceMode) {
    return renderProvenance(p, mode ?? defaultMode);
  }

  function footer(p: CanonicalProvenance | CanonicalProvenance[], mode?: ProvenanceMode): string {
    const blocks = Array.isArray(p) ? p : [p];
    return provenanceFooter(blocks, { locale, tzLabel, mode: mode ?? defaultMode });
  }

  function result(
    data: Record<string, unknown>,
    provenance: CanonicalProvenance | CanonicalProvenance[],
    opts?: { mode?: ProvenanceMode },
  ): ProvenanceResult {
    const mode = opts?.mode ?? defaultMode;
    const blocks = Array.isArray(provenance) ? provenance : [provenance];
    if (blocks.length === 0) throw new Error("result() exige ao menos um bloco de proveniência");
    const rendered = blocks.map((b) => renderProvenance(b, mode));
    const provOut = Array.isArray(provenance) ? rendered : rendered[0]!;
    const attribution = attributionList(blocks);
    return {
      content: [
        { type: "text", text: JSON.stringify(data, null, 2) },
        { type: "text", text: footer(blocks, mode) },
      ],
      structuredContent: { ...data, provenance: provOut, attribution },
      _meta: {
        [metaKeys.provenance]: provOut,
        [metaKeys.attribution]: attribution,
      },
    };
  }

  return { metaKeys, locale, timezone, defaultMode, build, from, render, footer, result };
}
