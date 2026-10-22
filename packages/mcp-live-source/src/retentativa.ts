import { classificarFalha, type Falha, type OpcoesDeClassificacao, type Veredito } from "./veredito.js";

export interface OpcoesDeRetentativa extends OpcoesDeClassificacao {
  /** Tentativas no total, incluindo a primeira. Padrão 3. */
  tentativas?: number | undefined;
  /** Espera antes da tentativa `n + 1` (n = tentativa que acabou de falhar). Padrão `2000 * n` ms. */
  esperaMs?: ((tentativaQueFalhou: number) => number) | undefined;
  /**
   * Quais vereditos valem repetir. Padrão: tudo menos `dependencia` (a captura de que
   * depende já falhou; insistir só queima a espera) e `respondeu` (404/4xx é resposta
   * da origem ao pedido; repetir o mesmo pedido recebe a mesma resposta).
   */
  repetir?: ((falha: Falha) => boolean) | undefined;
  /** Chamado a cada falha que vai ser repetida — para o log do script. */
  aoRepetir?: ((tentativa: number, falha: Falha) => void) | undefined;
  /**
   * Chamado uma vez, antes de relançar o último erro, com quantas idas o script fez.
   * É o número que o `Relatorio` mostra (`registrarFalha(..., { idas })`): o `motivo`
   * da origem conta as tentativas de UMA ida (um timeout é "1 tentativa" no pacote),
   * e sem este número a linha do log dizia "em 1 tentativa" depois de três idas —
   * medido na primeira rodada em CI, 22/10/2026.
   */
  aoDesistir?: ((idas: number, falha: Falha) => void) | undefined;
  /** Injetável nos testes. */
  dormir?: ((ms: number) => Promise<void>) | undefined;
}

const NAO_SE_REPETE: ReadonlySet<Veredito> = new Set(["dependencia", "respondeu"]);

export function repetirPorPadrao(falha: Falha): boolean {
  return !NAO_SE_REPETE.has(falha.veredito);
}

function dormirDeVerdade(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Roda a captura até `tentativas` vezes. O erro final relançado é o da ÚLTIMA tentativa,
 * intacto (quem chama classifica de novo com `classificarFalha`, ou registra no
 * `Relatorio`, que classifica).
 */
export async function capturarComRetentativa<T>(fn: () => Promise<T>, opcoes: OpcoesDeRetentativa = {}): Promise<T> {
  const tentativas = Math.max(1, opcoes.tentativas ?? 3);
  const esperaMs = opcoes.esperaMs ?? ((n) => 2000 * n);
  const repetir = opcoes.repetir ?? repetirPorPadrao;
  const dormir = opcoes.dormir ?? dormirDeVerdade;
  const classificacao: OpcoesDeClassificacao = { dependencia: opcoes.dependencia };

  let ultimo: unknown;
  let idas = 0;
  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    idas = tentativa;
    try {
      return await fn();
    } catch (err) {
      ultimo = err;
      const falha = classificarFalha(err, classificacao);
      if (tentativa === tentativas || !repetir(falha)) {
        opcoes.aoDesistir?.(idas, falha);
        break;
      }
      opcoes.aoRepetir?.(tentativa, falha);
      await dormir(esperaMs(tentativa));
    }
  }
  throw ultimo;
}
