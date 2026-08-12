/**
 * Correlação entre DUAS séries pareadas — a estatística bivariada do motor.
 *
 * Por que aqui e não no servidor que pediu: `core.ts` responde "como se distribui
 * este campo?"; correlação responde "estes dois campos andam juntos?". É a mesma
 * natureza de trabalho — determinístico, computado no servidor, antes de qualquer
 * truncamento — e nenhum servidor do portfólio tem motivo para ter a sua própria.
 *
 * O que este módulo NÃO faz, de propósito: **parear**. Ele recebe registros já
 * alinhados e lê as duas pontas por acessores. Alinhar é trabalho de domínio (casar
 * grades temporais, decidir o que fazer com buraco) e erra de formas específicas de
 * cada fonte — quem alinha é quem conhece a fonte.
 *
 * Convenções FIXADAS (mesma régua do `core.ts`):
 *  - **Pearson** é linear sobre os valores; **Spearman** é Pearson sobre os POSTOS,
 *    com posto médio nos empates. Não usamos o atalho `1 - 6Σd²/n(n²-1)`: ele só
 *    vale sem empate, e com empate devolve um número plausível e errado.
 *  - **Descarte é aos pares** (pairwise deletion): um par entra só se as DUAS pontas
 *    forem finitas. `n` conta o que entrou e `dropped` o que ficou de fora — sem
 *    isso, um coeficiente sobre 7 de 250 pontos passaria por completo.
 *  - **Coeficiente indefinido é `null`, com motivo** — nunca 0. Zero significa "medi
 *    e não há relação linear"; `null` significa "não dá para medir". Confundir os
 *    dois é a diferença entre uma conclusão e uma invenção.
 *  - Denominador populacional nas duas variâncias, como em `core.ts`; na razão de
 *    Pearson o `n` se cancela, então a escolha não muda o coeficiente.
 *
 * Números saem em precisão total; arredondar é papel de quem exibe.
 */

export type CorrelationMethod = "pearson" | "spearman";

/** Por que o coeficiente não pôde ser calculado. */
export type CorrelationUndefinedReason =
  /** Menos de 2 pares completos: não há dispersão para correlacionar. */
  | "insufficient-pairs"
  /** Ao menos uma das séries é constante no período: variância zero, razão 0/0. */
  | "constant-series";

export interface CorrelationStats {
  method: CorrelationMethod;
  /** Pares completos usados no cálculo. */
  n: number;
  /** Pares descartados por valor não-finito em alguma das pontas. */
  dropped: number;
  /** Coeficiente em [-1, 1]; `null` quando indefinido (ver `reason`). */
  coefficient: number | null;
  /** Presente somente quando `coefficient` é `null`. */
  reason?: CorrelationUndefinedReason;
}

export interface CorrelationOptions {
  /** Default: "pearson". */
  method?: CorrelationMethod;
}

/**
 * Postos 1..n com **posto médio nos empates** (o "average rank" de Spearman).
 * Empate tratado como ordem de entrada inflaria a correlação de séries com platôs —
 * taxa de juros parada por meses é o caso comum no portfólio.
 */
function averageRanks(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);

  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.v === order[i]!.v) j++;
    // Postos de i..j (1-based) têm média (i + j) / 2 + 1.
    const shared = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]!.i] = shared;
    i = j + 1;
  }

  return ranks;
}

/** Pearson sobre dois vetores de mesmo tamanho, já limpos. `null` se alguma variância é zero. */
function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i]!;
    sumY += ys[i]!;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  // Duas passadas (desvios em torno da média) em vez do atalho de somas de quadrados:
  // o atalho perde precisão catastroficamente quando a média é grande e a variância
  // pequena — exatamente o formato de série de índice de preço.
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }

  if (sxx === 0 || syy === 0) return null;

  const r = sxy / Math.sqrt(sxx * syy);
  // Erro de ponto flutuante pode devolver 1.0000000000000002 numa série idêntica a
  // si mesma, e um coeficiente fora de [-1, 1] é indefensável na resposta.
  return Math.min(1, Math.max(-1, r));
}

/**
 * Correlação entre duas leituras dos MESMOS registros, já pareados por quem chama.
 *
 * Acessores em vez de nomes de campo, pela mesma razão de `computeStats`: o valor
 * canônico costuma precisar de parsing ou de composição. Ponta ausente se declara
 * devolvendo `NaN` (ou qualquer não-finito) — o par inteiro é descartado e contado.
 */
export function computeCorrelation<T>(
  records: T[],
  xOf: (r: T) => number,
  yOf: (r: T) => number,
  options: CorrelationOptions = {},
): CorrelationStats {
  const method = options.method ?? "pearson";

  const xs: number[] = [];
  const ys: number[] = [];
  let dropped = 0;

  for (const r of records) {
    const x = xOf(r);
    const y = yOf(r);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      xs.push(x);
      ys.push(y);
    } else {
      dropped++;
    }
  }

  const n = xs.length;
  if (n < 2) {
    return { method, n, dropped, coefficient: null, reason: "insufficient-pairs" };
  }

  const coefficient =
    method === "spearman" ? pearson(averageRanks(xs), averageRanks(ys)) : pearson(xs, ys);

  return coefficient === null
    ? { method, n, dropped, coefficient: null, reason: "constant-series" }
    : { method, n, dropped, coefficient };
}
