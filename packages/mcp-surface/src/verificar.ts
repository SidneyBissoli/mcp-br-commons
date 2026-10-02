/**
 * O que está NO AR é o que foi travado? Os testes provam que o CÓDIGO bate com
 * o `surface.lock.json`; isto prova que o ENDPOINT bate. Roda no fim do deploy.
 */

import { capturarHttp, pedirHttp } from "./remoto.js";
import { sondaSemToken, type ChamadaLocal } from "./sonda.js";
import { impressaoDigital } from "./superficie.js";
import { lerTrava } from "./trava.js";

export interface OpcoesVerificar {
  url: string;
  caminhoDaTrava: string;
  /** Configuração da trava que vale em produção. Padrão: `apiKeyAusente` (acesso aberto). */
  config?: string;
  /** Rota da seção `semToken` que corresponde a `url`. Padrão: `POST /mcp`. */
  rota?: string;
  /**
   * Servidor com mais de uma superfície (perfis por rota): a `declarada` é um
   * mapa `{ perfil: superfície }` e esta é a chave que `url` serve.
   */
  perfil?: string;
  /** A mesma tool local que a trava sondou; sem ela, `tools/call` não é conferido. */
  chamada?: ChamadaLocal;
  tentativas?: number;
  esperaMs?: number;
  log?: (linha: string) => void;
}

/** Devolve `null` quando confere; senão, a divergência da última tentativa. */
export async function verificarNoAr(o: OpcoesVerificar): Promise<string | null> {
  const config = o.config ?? "apiKeyAusente";
  const rota = o.rota ?? "POST /mcp";
  const log = o.log ?? (() => {});
  const trava = lerTrava(o.caminhoDaTrava);
  const declarada = trava.declarada;
  const semToken = (trava.semToken?.conteudo as Record<string, Record<string, Record<string, boolean>>> | undefined)?.[config]?.[rota];
  if (!declarada || !semToken) {
    return `surface.lock.json incompleto: falta a seção declarada ou semToken["${config}"]["${rota}"].`;
  }
  const sonda = sondaSemToken(o.chamada).filter(p => p.method in semToken);
  let esperado = declarada.sha256;
  if (o.perfil !== undefined) {
    const porPerfil = (declarada.conteudo as Record<string, unknown> | null)?.[o.perfil];
    if (porPerfil === undefined) return `surface.lock.json: a seção declarada não tem o perfil "${o.perfil}".`;
    esperado = impressaoDigital(porPerfil);
  }

  const tentativas = o.tentativas ?? 6;
  let ultimo = "";
  for (let t = 1; t <= tentativas; t++) {
    const sha = impressaoDigital(await capturarHttp(o.url));
    const divergentes: string[] = [];
    for (const pedido of sonda) {
      const r = await pedirHttp(o.url, pedido);
      const responde = r.status === 200 && r.result !== undefined;
      if (responde !== semToken[pedido.method]) divergentes.push(`${pedido.method} (no ar ${responde})`);
    }
    if (sha === esperado && divergentes.length === 0) {
      log(
        `no ar = trava: declarada${o.perfil !== undefined ? ` [${o.perfil}]` : ""} ${sha.slice(0, 12)} (travada em ${declarada.versao}); ` +
          `sem token: ${config}/${rota} confere em ${sonda.length} métodos.`,
      );
      return null;
    }
    ultimo =
      (sha !== esperado ? `declarada no ar ${sha.slice(0, 12)} ≠ trava ${esperado.slice(0, 12)}. ` : "") +
      (divergentes.length ? `sem token diverge em: ${divergentes.join(", ")}.` : "");
    log(`tentativa ${t}: ${ultimo}`);
    // A Cloudflare serve isolates mistos por alguns segundos logo após o deploy.
    if (t < tentativas) await new Promise(r => setTimeout(r, o.esperaMs ?? 10_000));
  }
  return ultimo;
}
