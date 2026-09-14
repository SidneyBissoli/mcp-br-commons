/**
 * Idiomas da camada de exibição. Princípio do portfólio: o que o modelo lê e repassa
 * ao leitor deve estar no idioma do servidor — CHAVES do bloco inclusive (o modelo
 * papagueia chaves na prosa; "desvioPadrao" vira texto natural em pt-BR, "stdDev" não).
 *
 * O rótulo dos percentis existe pelo mesmo motivo: a saída `{p25..p99}` crua fazia o
 * modelo escrever "p99" na resposta — sem sentido para quem não construiu o servidor.
 * O `label` enuncia o significado por extenso; o leitor nunca vê "p99".
 *
 * O locale `ptBR` reproduz byte-a-byte o shape em produção no senado-br-mcp-cloudflare
 * (chaves, rótulos e aviso de truncamento) — a adoção lá não muda resposta nenhuma.
 */

export interface StatsLocaleKeys {
  sum: string;
  min: string;
  max: string;
  mean: string;
  median: string;
  stdDev: string;
  percentiles: string;
  /** Chaves de cada item da lista de percentis. */
  percentile: string;
  value: string;
  label: string;
  /** Chaves do bloco agrupado. */
  group: string;
  groups: string;
  totalGroups: string;
  notice: string;
}

export interface StatsLocale {
  id: string;
  keys: StatsLocaleKeys;
  /** Rótulo por extenso de um percentil (p=50 é a mediana). */
  percentileLabel(percentile: number, formattedValue: string): string;
  /**
   * Rótulo de um percentil INDEFINIDO (conjunto vazio). Existe para que a lista de
   * percentis jamais cite um valor que ninguém mediu — a redação não pode conter
   * número nenhum.
   */
  percentileUndefinedLabel(percentile: number): string;
  /** Aviso que substitui o bloco de distribuição quando não há registro nenhum. */
  noRecordsNotice(): string;
  /** Aviso quando o teto de grupos corta a saída. */
  truncationNotice(shown: number, total: number): string;
  /** Formatador default de valores nos rótulos (injetável por chamada em display.ts). */
  formatValue(n: number): string;
}

/**
 * Formata moeda pt-BR deterministicamente ("R$ 1.234,56") — sem `Intl`, para que os
 * testes sejam estáveis e nada dependa dos dados ICU do runtime.
 */
export function formatBRL(n: number): string {
  const negative = n < 0;
  const [inteiro, decimais] = Math.abs(n).toFixed(2).split(".") as [string, string];
  const agrupado = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}R$ ${agrupado},${decimais}`;
}

/** Número en-US determinístico ("1,234.56"), também sem `Intl`. */
export function formatNumberEn(n: number): string {
  const negative = n < 0;
  const [int, dec] = Math.abs(n).toFixed(2).split(".") as [string, string];
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}.${dec}`;
}

export const ptBR: StatsLocale = {
  id: "pt-BR",
  keys: {
    sum: "soma",
    min: "minimo",
    max: "maximo",
    mean: "media",
    median: "mediana",
    stdDev: "desvioPadrao",
    percentiles: "percentis",
    percentile: "percentil",
    value: "valor",
    label: "rotulo",
    group: "grupo",
    groups: "grupos",
    totalGroups: "totalGrupos",
    notice: "aviso",
  },
  percentileLabel(percentile, formattedValue) {
    return percentile === 50
      ? `mediana — metade dos valores é igual ou inferior a ${formattedValue}`
      : `${percentile}% dos valores são iguais ou inferiores a ${formattedValue}`;
  },
  percentileUndefinedLabel(percentile) {
    return percentile === 50
      ? "mediana indefinida: a consulta não encontrou nenhum registro"
      : `percentil ${percentile} indefinido: a consulta não encontrou nenhum registro`;
  },
  noRecordsNotice() {
    return (
      "A consulta não encontrou nenhum registro, então não há distribuição a resumir. " +
      "Confira o período e os filtros — este resultado NÃO significa que os valores sejam zero."
    );
  },
  truncationNotice(shown, total) {
    return `Exibindo ${shown} de ${total} grupos (ordenados por soma decrescente). Refine o filtro ou reduza a granularidade.`;
  },
  formatValue: formatBRL,
};

export const en: StatsLocale = {
  id: "en",
  keys: {
    sum: "sum",
    min: "min",
    max: "max",
    mean: "mean",
    median: "median",
    stdDev: "stdDev",
    percentiles: "percentiles",
    percentile: "percentile",
    value: "value",
    label: "label",
    group: "group",
    groups: "groups",
    totalGroups: "totalGroups",
    notice: "notice",
  },
  percentileLabel(percentile, formattedValue) {
    return percentile === 50
      ? `median — half of the values are at or below ${formattedValue}`
      : `${percentile}% of the values are at or below ${formattedValue}`;
  },
  percentileUndefinedLabel(percentile) {
    return percentile === 50
      ? "median undefined: the query matched no records"
      : `percentile ${percentile} undefined: the query matched no records`;
  },
  noRecordsNotice() {
    return (
      "The query matched no records, so there is no distribution to summarise. " +
      "Check the period and the filters — this result does NOT mean the values are zero."
    );
  },
  truncationNotice(shown, total) {
    return `Showing ${shown} of ${total} groups (sorted by descending total). Narrow the filter or reduce the granularity.`;
  },
  formatValue: formatNumberEn,
};

export const statsLocales: Record<string, StatsLocale> = { "pt-BR": ptBR, en };

/** Resolve um id embutido ou aceita um StatsLocale customizado. */
export function resolveStatsLocale(locale: string | StatsLocale): StatsLocale {
  if (typeof locale !== "string") return locale;
  const found = statsLocales[locale];
  if (!found) {
    throw new Error(
      `Locale desconhecido: "${locale}" (embutidos: ${Object.keys(statsLocales).join(", ")}); passe um StatsLocale customizado`,
    );
  }
  return found;
}
