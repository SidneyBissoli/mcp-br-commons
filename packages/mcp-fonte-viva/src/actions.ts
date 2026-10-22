/**
 * Comandos de workflow do GitHub Actions, puros e testáveis.
 *
 * A sintaxe é `::<nível> <prop>=<valor>,...::<mensagem>`. O runner decodifica
 * `%25`, `%0D` e `%0A` na mensagem, e também `%3A` e `%2C` nas propriedades
 * (título, arquivo, linha). Sem escapar, uma mensagem com quebra de linha vira dois
 * comandos e um título com `:` termina o comando no meio.
 */
export type NivelDeAnotacao = "notice" | "warning" | "error";

export function escaparMensagem(texto: string): string {
  return texto.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

export function escaparPropriedade(texto: string): string {
  return escaparMensagem(texto).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

export function anotacao(nivel: NivelDeAnotacao, titulo: string, mensagem: string): string {
  return `::${nivel} title=${escaparPropriedade(titulo)}::${escaparMensagem(mensagem)}`;
}

/**
 * Títulos FIXOS das anotações — são o contrato que o painel do portfólio lê pela API
 * (`check-runs/{job}/annotations`, campo `title`). Mudar um título é mudar o contrato.
 */
export const TITULO_FONTE_INDISPONIVEL = "Fonte indisponível";
export const TITULO_FONTE_INALCANCAVEL = "Fonte inalcançável";
export const TITULO_DERIVA = "Deriva de formato";
export const TITULO_AMBIGUO = "Ambíguo (deriva ou página de erro)";
export const TITULO_ALHEIO = "Falha alheia à origem";
