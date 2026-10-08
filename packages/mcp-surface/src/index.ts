export {
  PROTOCOLO_DA_CAPTURA,
  capturarPor,
  compararUnidades,
  impressaoDigital,
  normalizarSuperficie,
  paramsDoInitialize,
  type SuperficieBruta,
} from "./superficie.js";
export { capturarSuperficie, type ServidorConectavel } from "./memoria.js";
export {
  CABECALHOS_MCP,
  METODO_INEXISTENTE,
  comHost,
  corpoDoPedido,
  ipDaSonda,
  lerCorpoJsonRpc,
  medirSemToken,
  respondeu,
  sondaSemToken,
  vereditoDoMetodoInexistente,
  type ChamadaLocal,
  type Pedido,
} from "./sonda.js";
export { oQueMudou, resumoDoQueMudou } from "./o-que-mudou.js";
export { VAR_ESCRITA, conferirSecao, lerTrava, modoEscrita, type NomeDaSecao, type Trava, type Veredito } from "./trava.js";
export { capturarHttp, capturarStdio, endpointSabeDizerNao, pedirHttp } from "./remoto.js";
export { verificarNoAr, type OpcoesVerificar } from "./verificar.js";
export { diferenca, linhaDeCompatibilidade, replay, type OpcoesReplay } from "./replay.js";
export {
  CHAVE_DA_SUPERFICIE,
  CHAVE_DO_PUBLICADOR,
  FORMA_CANONICA,
  REGISTRO_OFICIAL,
  TETO_DO_PUBLICADOR,
  URL_DA_SPEC,
  conferirMetaDoServerJson,
  conferirRegistro,
  endpointDoServerJson,
  gravarMetaNoServerJson,
  lerMetaDoRegistro,
  metaDoRegistro,
  type MetaDaSuperficie,
  type OpcoesConferirRegistro,
  type OpcoesMeta,
} from "./registro.js";
