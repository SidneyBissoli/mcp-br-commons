/**
 * A regra do `surface.lock.json`.
 *
 * Cada seção (`declarada`, `semToken`) guarda a versão do `package.json` em que
 * foi travada e o sha256 do conteúdo. Se o medido diverge do travado:
 *  - versão igual à da trava → FALHA: a superfície mudou sem subir a versão;
 *  - versão diferente → FALHA pedindo para regravar (`mcp-surface travar`).
 * O modo de escrita (`SURFACE_LOCK_ESCREVER=1`, posto pelo `mcp-surface
 * travar`) obedece à mesma regra: ele se RECUSA a travar superfície nova sob a
 * versão antiga. É isso que transforma a disciplina da receita de release em
 * teste. O sha gravado também denuncia edição à mão do conteúdo.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { impressaoDigital } from "./superficie.js";

export type NomeDaSecao = "declarada" | "semToken";

/** Variável de ambiente do modo de escrita. */
export const VAR_ESCRITA = "SURFACE_LOCK_ESCREVER";

interface Secao {
  versao: string;
  sha256: string;
  conteudo: unknown;
}

export type Trava = Partial<Record<NomeDaSecao, Secao>> & { $comentario?: string };

const COMENTARIO =
  "Impressão digital da superfície (@sbissoli/mcp-surface). Não editar à mão: `npm run surface:lock` regrava, e só aceita superfície nova sob versão nova.";

export interface Veredito {
  ok: boolean;
  mensagem: string;
}

export function lerTrava(caminho: string): Trava {
  try {
    return JSON.parse(readFileSync(caminho, "utf8")) as Trava;
  } catch {
    return {};
  }
}

/** O modo de escrita está ligado neste processo? */
export function modoEscrita(): boolean {
  return process.env[VAR_ESCRITA] === "1";
}

/**
 * Confere (e, em modo de escrita, regrava) UMA seção da trava contra o medido.
 * Devolve o veredito em vez de lançar, para o teste mostrar a mensagem inteira:
 * `expect(v.ok, v.mensagem).toBe(true)`.
 */
export function conferirSecao(
  caminhoDaTrava: string,
  secao: NomeDaSecao,
  medido: unknown,
  versaoDoPacote: string,
  escrever: boolean = modoEscrita(),
): Veredito {
  const trava = lerTrava(caminhoDaTrava);
  const atual = trava[secao];
  const sha = impressaoDigital(medido);

  if (atual && impressaoDigital(atual.conteudo) !== atual.sha256) {
    return {
      ok: false,
      mensagem: `surface.lock.json: a seção "${secao}" foi editada à mão (o sha256 gravado não é o do conteúdo). Restaure o arquivo e rode \`npm run surface:lock\`.`,
    };
  }
  if (atual && atual.sha256 === sha) {
    return { ok: true, mensagem: `seção "${secao}" confere (${sha.slice(0, 12)}, travada em ${atual.versao})` };
  }
  if (atual && atual.versao === versaoDoPacote) {
    return {
      ok: false,
      mensagem:
        `A superfície "${secao}" MUDOU e a versão continua ${versaoDoPacote} ` +
        `(travada ${atual.sha256.slice(0, 12)}, medida ${sha.slice(0, 12)}). ` +
        "Quem compara o registro com o servidor só enxerga a versão: suba-a " +
        "(`npm version <patch|minor|major> --no-git-tag-version`) e rode `npm run surface:lock`.",
    };
  }
  if (!escrever) {
    return {
      ok: false,
      mensagem: atual
        ? `A superfície "${secao}" mudou junto com a versão (${atual.versao} → ${versaoDoPacote}): rode \`npm run surface:lock\` e commite o surface.lock.json.`
        : `surface.lock.json não tem a seção "${secao}": rode \`npm run surface:lock\`.`,
    };
  }

  trava[secao] = { versao: versaoDoPacote, sha256: sha, conteudo: medido };
  const saida: Trava = { $comentario: COMENTARIO };
  for (const nome of ["declarada", "semToken"] as const) {
    const s = trava[nome];
    if (s) saida[nome] = s;
  }
  writeFileSync(caminhoDaTrava, `${JSON.stringify(saida, null, 2)}\n`);
  return { ok: true, mensagem: `seção "${secao}" travada em ${versaoDoPacote} (${sha.slice(0, 12)})` };
}
