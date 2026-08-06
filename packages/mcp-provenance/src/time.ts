/**
 * Normalização de timestamps do contrato de proveniência.
 *
 * Todo `retrieved_at` (e afins) é serializado em ISO-8601 SEM milissegundos, num fuso
 * fixo escolhido pelo servidor — o objetivo é a REPRESENTAÇÃO estável (determinismo
 * byte-a-byte), nunca alterar o instante. Origem do requisito: no senado-br-mcp,
 * timestamps em UTC faziam respostas noturnas citarem a data do dia seguinte para o
 * leitor brasileiro; a solução (offset explícito -03:00) é aqui generalizada para
 * qualquer offset fixo. O fuso do IP do requisitante não serve: em conectores MCP
 * remotos o IP visto é o do backend do provedor de IA, não o da pessoa.
 */

/** Fuso de serialização: "utc" ou offset fixo explícito (ex.: { offset: "-03:00" }). */
export type TimezoneSpec = "utc" | { offset: string; label?: string };

const OFFSET_RE = /^([+-])(\d{2}):(\d{2})$/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Converte "-03:00" em minutos (-180). Lança em formato inválido. */
export function parseOffsetMinutes(offset: string): number {
  const m = offset.match(OFFSET_RE);
  if (!m) throw new Error(`Offset de fuso inválido: "${offset}" (esperado ±HH:MM)`);
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/** Rótulo humano do fuso, para o rodapé (ex.: "horário de Brasília", "UTC"). */
export function timezoneLabel(tz: TimezoneSpec): string {
  if (tz === "utc") return "UTC";
  return tz.label ?? `UTC${tz.offset}`;
}

/**
 * Converte um instante para ISO-8601 canônico no fuso configurado, sem milissegundos
 * (ex.: "2026-07-14T21:23:45-03:00"; em UTC, sufixo "Z"). Datas puras ("2026-06-28")
 * e strings não-parseáveis passam inalteradas — nunca corrompe um vintage nem
 * inventa horário onde não há.
 */
export function toCanonicalIso(value: string | Date, tz: TimezoneSpec): string {
  if (typeof value === "string" && DATE_ONLY_RE.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  if (tz === "utc") return d.toISOString().replace(/\.\d{3}Z$/, "Z");
  const offsetMs = parseOffsetMinutes(tz.offset) * 60_000;
  const wall = new Date(d.getTime() + offsetMs).toISOString();
  return wall.replace(/\.\d{3}Z$/, tz.offset);
}
