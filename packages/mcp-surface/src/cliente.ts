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

/** Um valor do tipo errado para o tipo JSON Schema declarado. */
function tipoErrado(tipo: unknown): unknown {
  if (tipo === "string") return 0;
  if (typeof tipo === "string") return "valor-de-tipo-errado";
  return undefined;
}

/**
 * As quebras genéricas, DERIVADAS do schema listado (não de nomes escritos à
 * mão): `structuredContent` ausente, cada campo obrigatório ausente, o primeiro
 * obrigatório com tipo declarado trocado de tipo.
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
  const tipado = obrigatorios.find(c => tipoErrado(props[c]?.type) !== undefined);
  if (tipado) {
    quebras.push({
      descricao: `campo de tipo errado (${tipado})`,
      adulterar: r => {
        if (r.structuredContent) r.structuredContent[tipado] = tipoErrado(props[tipado]?.type);
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

  const vereditos: Veredito[] = [];
  for (const q of quebras) vereditos.push({ descricao: q.descricao, esperado: "reprova", ...(await rodar(q, true)) });
  const armadilha = quebras[1] ?? quebras[0]!;
  vereditos.push({
    descricao: `a armadilha: sem tools/list antes, "${armadilha.descricao}" passa calada`,
    esperado: "passa",
    ...(await rodar(armadilha, false)),
  });
  return vereditos;
}
