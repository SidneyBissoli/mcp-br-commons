/**
 * Teste com forma de cliente: o servidor interrogado pelo `Client` do SDK, que
 * reprova o resultado de `tools/call` contra o `outputSchema` LISTADO — o teste
 * falha como a sessão do usuário falharia, sem validador escolhido por nós.
 *
 * Ideia de leitor (https://dev.to/arhancanli/comment/3g4i4); o circuito nasceu
 * no ilo-mcp-server 1.3.0 e mora aqui para os sete servidores o usarem igual.
 *
 * Subpath próprio (`@sbissoli/mcp-surface/cliente`), fora da raiz do pacote: o
 * `Client` compila os schemas com Ajv (`new Function`), que o runtime da
 * Cloudflare proíbe. Importar daqui é coisa de teste em Node, nunca de Worker.
 *
 * Duas armadilhas que este módulo fecha, medidas no ilo:
 * - o `Client` só valida contra o schema que tem em cache do `tools/list` —
 *   sem `listTools` antes, `callTool` devolve o que recebeu sem validar;
 * - o `InMemoryTransport` não serializa: chave `undefined` sobrevive em memória
 *   e some no fio (`JSON.stringify`). Aqui toda mensagem do servidor passa por
 *   JSON antes de chegar ao cliente, como passaria pela rede.
 */

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";

import type { ServidorConectavel } from "./memoria.js";

/** Resultado de `tools/call` como viaja no fio (o que uma quebra recebe). */
export type ResultadoNoFio = { content?: unknown; structuredContent?: Record<string, unknown> } & Record<string, unknown>;

export interface OpcoesConexao {
  /** Mexe no resultado de `tools/call` entre servidor e cliente (controle negativo). */
  adulterar?: (r: ResultadoNoFio) => void;
}

const listados = new WeakSet<Client>();

export async function conectarComoCliente(server: ServidorConectavel, opcoes: OpcoesConexao = {}): Promise<Client> {
  const [lado, ladoServidor] = InMemoryTransport.createLinkedPair();
  const enviar = ladoServidor.send.bind(ladoServidor);
  ladoServidor.send = async (mensagem, extra) => {
    const noFio = JSON.parse(JSON.stringify(mensagem)) as typeof mensagem;
    const r = (noFio as { result?: ResultadoNoFio }).result;
    if (opcoes.adulterar && r && "content" in r) opcoes.adulterar(r);
    return enviar(noFio, extra);
  };
  const client = new Client({ name: "mcp-surface/cliente", version: "0.0.0" });
  await Promise.all([server.connect(ladoServidor), client.connect(lado)]);
  return client;
}

/** O percurso do cliente: `tools/list` (uma vez por conexão) → `tools/call`. */
async function percorrer(client: Client, nome: string, args: Record<string, unknown>) {
  if (!listados.has(client)) {
    await client.listTools();
    listados.add(client);
  }
  return client.callTool({ name: nome, arguments: args });
}

/**
 * Chamada que TEM de dar certo, no percurso do cliente. Lança quando o `Client`
 * reprova o resultado e também quando a tool responde `isError` — o servidor do
 * SDK v2 valida a própria saída e, se ela não obedece, devolve o erro em
 * `isError` ("Output validation error"), não em exceção. Para afirmar uma
 * recusa de propósito (parâmetro inválido), use `client.callTool` direto.
 */
export async function chamarComoCliente(client: Client, nome: string, args: Record<string, unknown> = {}) {
  const r = await percorrer(client, nome, args);
  if (r.isError) {
    const texto = Array.isArray(r.content) ? r.content.map(c => ("text" in c ? c.text : "")).join(" ") : "";
    throw new Error(`${nome} respondeu isError: ${texto}`);
  }
  return r;
}

export interface Quebra {
  descricao: string;
  adulterar: (r: ResultadoNoFio) => void;
}

/** Candidatos a valor errado, com os tipos JSON Schema que cada um satisfaz. */
const CANDIDATOS: Array<[unknown, string[]]> = [
  ["valor-de-tipo-errado", ["string"]],
  [0, ["number", "integer"]],
  [true, ["boolean"]],
  [[], ["array"]],
  [{}, ["object"]],
];

/**
 * Um valor que NENHUM dos tipos declarados aceita — `type` simples ou lista
 * (`["string", "null"]`, o campo anulável, que é onde o defeito mora). Sem
 * `type` declarado não há o que trocar: `undefined`.
 */
function tipoErrado(tipo: unknown): unknown {
  const tipos = typeof tipo === "string" ? [tipo] : Array.isArray(tipo) ? (tipo as unknown[]) : [];
  if (tipos.length === 0) return undefined;
  return CANDIDATOS.find(([, aceitos]) => !aceitos.some(t => tipos.includes(t)))?.[0];
}

/**
 * As quebras genéricas, DERIVADAS do schema listado (não de nomes escritos à
 * mão): `structuredContent` ausente, cada campo obrigatório ausente, e cada
 * obrigatório com tipo declarado trocado de tipo. Cada um, não o primeiro: até a
 * 0.2.0 só o primeiro tipado era trocado, e no ilo esse caía num objeto
 * (`dataflow`) e deixava os escalares sem prova.
 */
export function quebrasDoSchema(outputSchema: Record<string, unknown>): Quebra[] {
  const obrigatorios = Array.isArray(outputSchema.required) ? (outputSchema.required as string[]) : [];
  const props = (outputSchema.properties ?? {}) as Record<string, { type?: unknown }>;
  const quebras: Quebra[] = [
    { descricao: "structuredContent ausente", adulterar: r => void delete r.structuredContent },
    ...obrigatorios.map(campo => ({
      descricao: `campo obrigatório ausente (${campo})`,
      adulterar: (r: ResultadoNoFio) => void delete r.structuredContent?.[campo],
    })),
  ];
  for (const campo of obrigatorios) {
    const errado = tipoErrado(props[campo]?.type);
    if (errado === undefined) continue;
    quebras.push({
      descricao: `campo de tipo errado (${campo})`,
      adulterar: r => {
        if (r.structuredContent) r.structuredContent[campo] = structuredClone(errado);
      },
    });
  }
  return quebras;
}

export interface Veredito {
  descricao: string;
  /** O que o circuito exige: o cliente reprovar a quebra (ou, na armadilha, deixá-la passar). */
  esperado: "reprova" | "passa";
  /** `isError`: a chamada-base falhou como tool — o caso está mal montado. */
  obtido: "reprova" | "passa" | "isError";
  mensagem?: string;
}

/**
 * Controle negativo pelo lado do resultado: o servidor responde certo, o que
 * chega ao cliente está quebrado, e a chamada TEM de falhar. Um servidor novo
 * por quebra (`fabrica`), porque cada conexão leva a sua adulteração.
 *
 * Inclui a armadilha como veredito esperado "passa": sem `tools/list` antes, a
 * primeira quebra passa calada. Se um dia o SDK passar a validar sem a lista,
 * esse veredito acusa — e a regra do `listTools` pode ser revista.
 *
 * O teste afirma `obtido === esperado` em cada veredito; a `descricao` diz qual.
 */
export async function controlesNegativos(
  fabrica: () => ServidorConectavel | Promise<ServidorConectavel>,
  nome: string,
  args: Record<string, unknown> = {},
  extras: Quebra[] = [],
): Promise<Veredito[]> {
  const sonda = await conectarComoCliente(await fabrica());
  let schema: Record<string, unknown> | undefined;
  try {
    const { tools } = await sonda.listTools();
    schema = tools.find(t => t.name === nome)?.outputSchema as Record<string, unknown> | undefined;
  } finally {
    await sonda.close();
  }
  if (!schema) throw new Error(`${nome}: sem outputSchema no tools/list — não há contrato a provar`);

  const quebras = [...quebrasDoSchema(schema), ...extras];
  const rodar = async (q: Quebra, listar: boolean): Promise<Pick<Veredito, "obtido" | "mensagem">> => {
    const client = await conectarComoCliente(await fabrica(), { adulterar: q.adulterar });
    try {
      const r = listar ? await percorrer(client, nome, args) : await client.callTool({ name: nome, arguments: args });
      // Erro de tool NÃO é reprovação do validador: a chamada-base tem de dar
      // certo, ou o controle não prova nada — veredito que nunca confere.
      if (r.isError) return { obtido: "isError", mensagem: JSON.stringify(r.content) };
      return { obtido: "passa" };
    } catch (e) {
      return { obtido: "reprova", mensagem: e instanceof Error ? e.message : String(e) };
    } finally {
      await client.close();
    }
  };

  // Em paralelo: cada quebra tem servidor e conexão próprios. Desde a 0.2.1 há
  // uma troca de tipo por obrigatório, e em série o medical (`loinc_details`,
  // muitos obrigatórios) passava dos 5 s do vitest sob a carga da suíte.
  const armadilha = quebras[1] ?? quebras[0]!;
  return Promise.all([
    ...quebras.map(async q => ({ descricao: q.descricao, esperado: "reprova" as const, ...(await rodar(q, true)) })),
    rodar(armadilha, false).then(r => ({
      descricao: `a armadilha: sem tools/list antes, "${armadilha.descricao}" passa calada`,
      esperado: "passa" as const,
      ...r,
    })),
  ]);
}
