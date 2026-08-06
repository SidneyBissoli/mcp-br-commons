/**
 * Parsing de valores numéricos vindos de APIs brasileiras.
 */

/**
 * Converte string monetária/numérica em formato pt-BR ("1.234,56", "-7.139,64") em
 * número. Separador de milhar é `.`, decimal é `,`. Entrada já numérica volta
 * inalterada (protege contra `String(123.45)` perder o ponto decimal ao remover
 * pontos). null/undefined/""/não-parseável → `fallback` (default 0).
 *
 * NÃO aplicar às cegas: APIs administrativas são heterogêneas (alguns endpoints
 * servem números nativos). Aplicar por endpoint onde o campo upstream é string pt-BR.
 */
export function parseBRL(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  if (s === "") return fallback;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isNaN(n) ? fallback : n;
}
