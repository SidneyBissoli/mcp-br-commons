import { entregaDaOrigem, type EntregaDaOrigem, type VereditoDeEntrega } from "@sbissoli/mcp-upstream";

/**
 * Veredito sobre UMA captura que falhou, do ponto de vista de quem mede deriva
 * contra a fonte viva.
 *
 * Os quatro primeiros são os de `entregaDaOrigem` (mcp-upstream): decididos pelo
 * `kind` do erro da origem, nunca pela frase. O quinto é deste repórter:
 *
 * - `dependencia` — a captura nem foi tentada, porque depende de outra que falhou
 *   antes (o detalhe de um processo precisa do id vindo da lista). Não diz nada
 *   sobre a origem; a culpa é da captura de que depende, e ela já foi julgada.
 */
export type Veredito = VereditoDeEntrega | "dependencia";

export interface Falha {
  veredito: Veredito;
  /** Uma frase em pt-BR para o log e o resumo — nunca a base de decisão. */
  motivo: string;
  kind: EntregaDaOrigem["kind"];
  status: number | undefined;
  url: string | undefined;
}

export interface OpcoesDeClassificacao {
  /**
   * Reconhece o erro "depende de captura que falhou" do consumidor. O pacote não
   * conhece a classe de cada script; por padrão nada é dependência.
   */
  dependencia?: ((err: unknown) => boolean) | undefined;
}

/**
 * Classifica a falha de uma captura. Delega à origem (`entregaDaOrigem`, que segue a
 * cadeia `cause` até o `UpstreamError` do pacote) e acrescenta `dependencia`.
 */
export function classificarFalha(err: unknown, opcoes: OpcoesDeClassificacao = {}): Falha {
  if (opcoes.dependencia?.(err) === true) {
    const texto = err instanceof Error ? err.message : String(err);
    return {
      veredito: "dependencia",
      motivo: `não medida: depende de captura que falhou (${texto})`,
      kind: undefined,
      status: undefined,
      url: undefined,
    };
  }
  const e = entregaDaOrigem(err);
  return { veredito: e.veredito, motivo: e.motivo, kind: e.kind, status: e.status, url: e.url };
}
