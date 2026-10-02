export {
  PROTOCOLO_DA_CAPTURA,
  capturarPor,
  impressaoDigital,
  normalizarSuperficie,
  paramsDoInitialize,
  type SuperficieBruta,
} from "./superficie.js";
export { capturarSuperficie, type ServidorConectavel } from "./memoria.js";
export {
  CABECALHOS_MCP,
  comHost,
  corpoDoPedido,
  ipDaSonda,
  lerCorpoJsonRpc,
  medirSemToken,
  respondeu,
  sondaSemToken,
  type ChamadaLocal,
  type Pedido,
} from "./sonda.js";
export { VAR_ESCRITA, conferirSecao, lerTrava, modoEscrita, type NomeDaSecao, type Trava, type Veredito } from "./trava.js";
export { capturarHttp, capturarStdio, pedirHttp } from "./remoto.js";
export { verificarNoAr, type OpcoesVerificar } from "./verificar.js";
export { diferenca, linhaDeCompatibilidade, replay, type OpcoesReplay } from "./replay.js";
