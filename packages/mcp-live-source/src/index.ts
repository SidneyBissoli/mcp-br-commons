export { classificarFalha, type Falha, type OpcoesDeClassificacao, type Veredito } from "./veredito.js";
export { Disjuntor, LIMITE_PADRAO_DO_DISJUNTOR, disjuntorDisparou } from "./disjuntor.js";
export { capturarComRetentativa, repetirPorPadrao, type OpcoesDeRetentativa } from "./retentativa.js";
export {
  TITULO_ALHEIO,
  TITULO_AMBIGUO,
  TITULO_DERIVA,
  TITULO_FONTE_INALCANCAVEL,
  TITULO_FONTE_INDISPONIVEL,
  anotacao,
  escaparMensagem,
  escaparPropriedade,
  type NivelDeAnotacao,
} from "./actions.js";
export {
  Relatorio,
  SAIDA_FALHA,
  SAIDA_FONTE_INALCANCAVEL,
  SAIDA_OK,
  linhaDeResultado,
  linhasDeConclusao,
  resumoMarkdown,
  type Destinos,
  type OpcoesDoRelatorio,
  type Resultado,
  type ResultadoFalho,
  type ResultadoOk,
  type Resumo,
} from "./relatorio.js";
