import type { Veredito } from "./veredito.js";

/**
 * Quantas capturas seguidas podem sair `indisponivel`, sem NENHUMA captura bem-
 * sucedida antes, até o repórter dizer que a origem está inalcançável e parar.
 *
 * Por que 5 (herdado do senado, medido em 09/2026): uma captura que falha custa
 * ~36 s (3 tentativas contra um orçamento de 10 s, mais 2 s + 4 s de espera), então
 * o disjuntor gasta ~3 min antes de desistir — além de qualquer endpoint instável
 * isolado, bem dentro do teto do job. Uma rodada saudável leva 86–116 s; as noites
 * em que a origem descartava os pacotes do runner levavam 1 800 s.
 */
export const LIMITE_PADRAO_DO_DISJUNTOR = 5;

/**
 * O disjuntor: dispara só enquanto nada foi capturado. Assim que a origem respondeu
 * UMA captura, ela é alcançável, e uma sequência de falhas depois disso é sobre
 * aqueles endpoints, não sobre a conexão.
 *
 * O que conta na sequência: `indisponivel` (timeout, rede, 429, 5xx — a origem não
 * entregou nada medível). O que a zera: uma captura ok, `respondeu` e `ambiguo` (chegou
 * uma resposta; a origem está lá). O que não mexe: `dependencia` e `alheio` (não dizem
 * nada sobre a origem).
 *
 * Diferença medida em 22/10/2026 em relação ao disjuntor local do senado: lá o 5xx
 * ZERAVA a sequência (o erro traduzido dizia `transport=false`), então uma noite em que
 * a origem respondia 502 a tudo caminhava o manifesto inteiro até o teto do job.
 */
export class Disjuntor {
  #capturadas = 0;
  #sequencia = 0;
  readonly limite: number;

  constructor(limite: number = LIMITE_PADRAO_DO_DISJUNTOR) {
    this.limite = limite;
  }

  get capturadas(): number {
    return this.#capturadas;
  }

  /** Falhas `indisponivel` seguidas desde a última captura ok (ou resposta). */
  get sequencia(): number {
    return this.#sequencia;
  }

  registrarCaptura(): void {
    this.#capturadas++;
    this.#sequencia = 0;
  }

  registrarFalha(veredito: Veredito): void {
    switch (veredito) {
      case "indisponivel":
        this.#sequencia++;
        return;
      case "respondeu":
      case "ambiguo":
        this.#sequencia = 0;
        return;
      case "dependencia":
      case "alheio":
        return;
    }
  }

  get disparou(): boolean {
    return disjuntorDisparou(this.#capturadas, this.#sequencia, this.limite);
  }
}

/** A decisão, pura: nada capturado E sequência de indisponível no limite. */
export function disjuntorDisparou(
  capturadas: number,
  sequencia: number,
  limite: number = LIMITE_PADRAO_DO_DISJUNTOR,
): boolean {
  return capturadas === 0 && sequencia >= limite;
}
