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
  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    try {
      return await fn();
    } catch (err) {
      ultimo = err;
      if (tentativa === tentativas) break;
      const falha = classificarFalha(err, classificacao);
      if (!repetir(falha)) break;
      opcoes.aoRepetir?.(tentativa, falha);
      await dormir(esperaMs(tentativa));
    }
  }
  throw ultimo;
}
