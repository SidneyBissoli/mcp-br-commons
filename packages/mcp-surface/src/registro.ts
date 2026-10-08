/**
 * A impressão digital PUBLICADA no MCP Registry, para o CLIENTE conferir.
 *
 * Por que existe. A trava (`surface.lock.json`) faz o publicador cumprir a
 * promessa "superfície nova = versão nova", mas o hash mora no repositório e a
 * entrada do registro só carrega a versão: o cliente não tem como conferir
 * nada. Proposta de um leitor do dev.to (comentário 3glme, 07/10/2026):
 * publicar os hashes de cada release no `server.json`, sob
 * `_meta["io.modelcontextprotocol.registry/publisher-provided"]` (o único
 * `_meta` que o registro guarda; teto de 4 KB), para o host recalcular na
 * primeira conexão e recusar ou pedir nova aprovação quando divergir do que o
 * registro lista para aquela versão. Outra leitora (3gmgp) fez o mesmo no
 * worklore 0.5.1 e acrescentou o recorte: só entra o que um estranho reproduz
 * SEM credencial.
 *
 * Daí as duas partes do que se publica:
 *  - `declared`: o sha256 da superfície declarada (forma canônica, SPEC.md),
 *    o mesmo da seção `declarada` da trava;
 *  - `anonymous`: quem responde sem token NA CONFIGURAÇÃO DE PRODUÇÃO e na
 *    rota publicada (`apiKeyAusente` / `POST /mcp`), com a chamada de tool que
 *    a sonda usa. A variante com chave fica de fora: o estranho não a mede.
 *
 * E as duas pontas: `gravarMetaNoServerJson` (publicador, junto do
 * `surface:lock`) e `conferirRegistro` (cliente; roda no CI depois de
 * publicar, sem ler a trava — só o registro e o ar).
 */

import { readFileSync, writeFileSync } from "node:fs";

import { capturarHttp, endpointSabeDizerNao, pedirHttp } from "./remoto.js";
import { sondaSemToken, type ChamadaLocal } from "./sonda.js";
import { impressaoDigital } from "./superficie.js";
import { lerTrava, type Trava, type Veredito } from "./trava.js";

/** O único `_meta` do `server.json` que o registro oficial guarda. */
export const CHAVE_DO_PUBLICADOR = "io.modelcontextprotocol.registry/publisher-provided";
/** A chave deste pacote dentro dele (DNS reverso, como o registro recomenda). */
export const CHAVE_DA_SUPERFICIE = "io.github.sidneybissoli/mcp-surface";
/** Identificador da forma canônica; muda só se a SPEC mudar de um jeito que muda o sha. */
export const FORMA_CANONICA = "mcp-surface/1";
export const URL_DA_SPEC = "https://github.com/SidneyBissoli/mcp-br-commons/blob/main/packages/mcp-surface/SPEC.md";
export const REGISTRO_OFICIAL = "https://registry.modelcontextprotocol.io";
/** Teto do registro para o objeto `publisher-provided` serializado. */
export const TETO_DO_PUBLICADOR = 4096;

export interface MetaDaSuperficie {
  form: string;
  spec: string;
  /** O endpoint em que `anonymous` foi medido (um dos `remotes` do server.json). */
  endpoint: string;
  declared: { sha256: string; lockedAt: string };
  anonymous: { sha256: string; answers: Record<string, boolean>; call?: ChamadaLocal };
}

export interface OpcoesMeta {
  endpoint: string;
  /** Configuração da trava que vale em produção. Padrão: `apiKeyAusente`. */
  config?: string;
  /** Rota da seção `semToken` que corresponde a `endpoint`. Padrão: `POST /mcp`. */
  rota?: string;
  /** Servidor com uma superfície por rota: a chave da `declarada` que `endpoint` serve. */
  perfil?: string;
  /** A chamada de tool da sonda; sem ela, `tools/call` não é publicado. */
  chamada?: ChamadaLocal;
}

/** O bloco a publicar, derivado da trava. Lança se a trava não tem o que publicar. */
export function metaDoRegistro(trava: Trava, o: OpcoesMeta): MetaDaSuperficie {
  const config = o.config ?? "apiKeyAusente";
  const rota = o.rota ?? "POST /mcp";
  const declarada = trava.declarada;
  const porRota = (trava.semToken?.conteudo as Record<string, Record<string, Record<string, boolean>>> | undefined)?.[config]?.[rota];
  if (!declarada || !porRota) {
    throw new Error(`surface.lock.json incompleto: falta a seção declarada ou semToken["${config}"]["${rota}"].`);
  }
  let sha = declarada.sha256;
  if (o.perfil !== undefined) {
    const sup = (declarada.conteudo as Record<string, unknown> | null)?.[o.perfil];
    if (sup === undefined) throw new Error(`surface.lock.json: a seção declarada não tem o perfil "${o.perfil}".`);
    sha = impressaoDigital(sup);
  }
  // Sem a chamada, o estranho não tem como repetir `tools/call`: sai da promessa.
  const answers = Object.fromEntries(
    Object.entries(porRota).filter(([metodo]) => metodo !== "tools/call" || o.chamada !== undefined),
  );
  return {
    form: FORMA_CANONICA,
    spec: URL_DA_SPEC,
    endpoint: o.endpoint,
    declared: { sha256: sha, lockedAt: declarada.versao },
    anonymous: {
      sha256: impressaoDigital(answers),
      answers,
      ...(o.chamada && "tools/call" in answers ? { call: o.chamada } : {}),
    },
  };
}

type ServerJson = Record<string, unknown> & {
  _meta?: Record<string, unknown>;
  remotes?: { type?: string; url?: string }[];
};

/** O endpoint publicado: o primeiro `remotes[]` streamable-http do server.json. */
export function endpointDoServerJson(server: ServerJson): string | undefined {
  return server.remotes?.find(r => r.type === "streamable-http" && typeof r.url === "string")?.url;
}

function lerServerJson(caminho: string): ServerJson {
  return JSON.parse(readFileSync(caminho, "utf8")) as ServerJson;
}

function opcoesComEndpoint(server: ServerJson, o: Partial<OpcoesMeta>): OpcoesMeta {
  const endpoint = o.endpoint ?? endpointDoServerJson(server);
  if (!endpoint) throw new Error("server.json sem `remotes` streamable-http: passe o endpoint explicitamente.");
  return { ...o, endpoint };
}

/**
 * Grava (ou regrava) o bloco no server.json, preservando o resto do `_meta`
 * publicado. Lança se o `publisher-provided` passaria do teto do registro —
 * publicar falharia lá, depois do npm, com a release já feita.
 */
export function gravarMetaNoServerJson(caminhoServerJson: string, caminhoDaTrava: string, o: Partial<OpcoesMeta> = {}): MetaDaSuperficie {
  const server = lerServerJson(caminhoServerJson);
  const meta = metaDoRegistro(lerTrava(caminhoDaTrava), opcoesComEndpoint(server, o));
  const _meta = { ...(server._meta ?? {}) };
  const doPublicador = { ...((_meta[CHAVE_DO_PUBLICADOR] as Record<string, unknown> | undefined) ?? {}), [CHAVE_DA_SUPERFICIE]: meta };
  const tamanho = Buffer.byteLength(JSON.stringify(doPublicador));
  if (tamanho > TETO_DO_PUBLICADOR) {
    throw new Error(`_meta publisher-provided teria ${tamanho} bytes; o registro aceita até ${TETO_DO_PUBLICADOR}.`);
  }
  _meta[CHAVE_DO_PUBLICADOR] = doPublicador;
  writeFileSync(caminhoServerJson, `${JSON.stringify({ ...server, _meta }, null, 2)}\n`);
  return meta;
}

/**
 * O server.json commitado traz o bloco que a trava de HOJE produz? Para o teste
 * da trava: sem isto, `surface:lock` regravaria a trava e o server.json
 * seguiria publicando o sha antigo — o registro mentiria com a versão nova.
 */
export function conferirMetaDoServerJson(caminhoServerJson: string, caminhoDaTrava: string, o: Partial<OpcoesMeta> = {}): Veredito {
  let esperado: MetaDaSuperficie;
  let server: ServerJson;
  try {
    server = lerServerJson(caminhoServerJson);
    esperado = metaDoRegistro(lerTrava(caminhoDaTrava), opcoesComEndpoint(server, o));
  } catch (e) {
    return { ok: false, mensagem: `server.json / surface.lock.json: ${(e as Error).message}` };
  }
  const gravado = (server._meta?.[CHAVE_DO_PUBLICADOR] as Record<string, unknown> | undefined)?.[CHAVE_DA_SUPERFICIE];
  if (gravado !== undefined && impressaoDigital(gravado) === impressaoDigital(esperado)) {
    return { ok: true, mensagem: `server.json publica a superfície da trava (${esperado.declared.sha256.slice(0, 12)})` };
  }
  return {
    ok: false,
    mensagem:
      gravado === undefined
        ? "server.json não publica a impressão digital: rode `npm run surface:lock` (que chama `mcp-surface registro`) e commite o server.json."
        : "server.json publica uma impressão digital diferente da trava: rode `npm run surface:lock` e commite o server.json.",
  };
}

export interface OpcoesConferirRegistro {
  /** Nome no registro (`io.github.<dono>/<repo>`). */
  nome: string;
  versao: string;
  registro?: string;
  tentativas?: number;
  esperaMs?: number;
  log?: (linha: string) => void;
}

/** Lê o bloco publicado para UMA versão. Devolve a mensagem de erro em vez de lançar. */
export async function lerMetaDoRegistro(o: Pick<OpcoesConferirRegistro, "nome" | "versao" | "registro">): Promise<MetaDaSuperficie | string> {
  const base = (o.registro ?? REGISTRO_OFICIAL).replace(/\/$/, "");
  const url = `${base}/v0.1/servers/${encodeURIComponent(o.nome)}/versions/${encodeURIComponent(o.versao)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return `registro respondeu ${res.status} para ${o.nome}@${o.versao}`;
  const corpo = (await res.json()) as { server?: ServerJson };
  const meta = (corpo.server?._meta?.[CHAVE_DO_PUBLICADOR] as Record<string, unknown> | undefined)?.[CHAVE_DA_SUPERFICIE] as
    | MetaDaSuperficie
    | undefined;
  if (!meta) return `a entrada ${o.nome}@${o.versao} no registro não traz _meta ${CHAVE_DO_PUBLICADOR} → ${CHAVE_DA_SUPERFICIE}`;
  if (meta.form !== FORMA_CANONICA) return `forma canônica desconhecida: ${String(meta.form)} (este pacote calcula ${FORMA_CANONICA})`;
  return meta;
}

/**
 * O que o registro promete para esta versão é o que está no ar? É a conferência
 * que um host faria na primeira conexão, rodada pelo publicador no fim da
 * release. NÃO lê a trava: só o registro e o endpoint, como um cliente.
 * Devolve `null` quando confere; senão, a divergência da última tentativa.
 */
export async function conferirRegistro(o: OpcoesConferirRegistro): Promise<string | null> {
  const log = o.log ?? (() => {});
  const meta = await lerMetaDoRegistro(o);
  if (typeof meta === "string") return meta;
  if (impressaoDigital(meta.anonymous.answers) !== meta.anonymous.sha256) {
    return "o bloco publicado não fecha: anonymous.sha256 não é o sha de anonymous.answers";
  }
  const sonda = sondaSemToken(meta.anonymous.call).filter(p => p.method in meta.anonymous.answers);
  const tentativas = o.tentativas ?? 6;
  let ultimo = "";
  for (let t = 1; t <= tentativas; t++) {
    // Como um cliente cuidadoso faria: antes de comparar, o endpoint sabe dizer não?
    const surdo = await endpointSabeDizerNao(meta.endpoint);
    if (surdo !== null) {
      ultimo = surdo;
      log(`tentativa ${t}: ${ultimo}`);
      if (t < tentativas) await new Promise(r => setTimeout(r, o.esperaMs ?? 10_000));
      continue;
    }
    const sha = impressaoDigital(await capturarHttp(meta.endpoint));
    const divergentes: string[] = [];
    for (const pedido of sonda) {
      const r = await pedirHttp(meta.endpoint, pedido);
      const responde = r.status === 200 && r.result !== undefined;
      if (responde !== meta.anonymous.answers[pedido.method]) divergentes.push(`${pedido.method} (no ar ${responde})`);
    }
    if (sha === meta.declared.sha256 && divergentes.length === 0) {
      log(
        `registro = ar: ${o.nome}@${o.versao} declara ${sha.slice(0, 12)} e ${meta.endpoint} serve o mesmo; ` +
          `sem token confere em ${sonda.length} métodos.`,
      );
      return null;
    }
    ultimo =
      (sha !== meta.declared.sha256 ? `no ar ${sha.slice(0, 12)} ≠ registro ${meta.declared.sha256.slice(0, 12)}. ` : "") +
      (divergentes.length ? `sem token diverge em: ${divergentes.join(", ")}.` : "");
    log(`tentativa ${t}: ${ultimo}`);
    if (t < tentativas) await new Promise(r => setTimeout(r, o.esperaMs ?? 10_000));
  }
  return ultimo;
}
