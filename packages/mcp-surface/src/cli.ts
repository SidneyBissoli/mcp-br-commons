#!/usr/bin/env node
/**
 * mcp-surface — a trava da superfície pela linha de comando.
 *
 *   mcp-surface travar --cmd "<comando de teste>" [--cmd ...]
 *       Roda cada comando com SURFACE_LOCK_ESCREVER=1: os testes da trava
 *       regravam o surface.lock.json — e se recusam se a superfície mudou sem
 *       subir a versão. Ex. (npm script):
 *       "surface:lock": "npm run build && mcp-surface travar --cmd \"vitest run tests/surface-lock.test.ts\""
 *
 *   mcp-surface verificar <endpoint> [--trava surface.lock.json] [--config apiKeyAusente]
 *                         [--rota "POST /mcp"] [--perfil <chave>] [--tool <nome>] [--args '<json>']
 *       Confere o endpoint no ar contra a trava (superfície declarada + quem
 *       responde sem token). Fim do deploy. Sai com 1 se divergir. `--perfil`:
 *       servidor com uma superfície por rota trava a `declarada` como mapa, e
 *       esta é a chave que o endpoint serve.
 *
 *   mcp-surface replay [--pacote <nome npm>] [--registro <nome no MCP Registry>]
 *                      [--url <endpoint>] [--saida baselines]
 *       Replay retroativo de todas as versões publicadas; escreve
 *       <saida>/replay-<data>.md e .json. Padrões lidos do package.json e do
 *       server.json do diretório atual.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { replay } from "./replay.js";
import { VAR_ESCRITA } from "./trava.js";
import { verificarNoAr } from "./verificar.js";

const [comando, ...resto] = process.argv.slice(2);

function opcao(nome: string): string | undefined {
  const i = resto.indexOf(`--${nome}`);
  return i >= 0 ? resto[i + 1] : undefined;
}

function opcoes(nome: string): string[] {
  return resto.flatMap((a, i) => (a === `--${nome}` && resto[i + 1] ? [resto[i + 1]!] : []));
}

function lerJson(caminho: string): Record<string, unknown> | undefined {
  return existsSync(caminho) ? (JSON.parse(readFileSync(caminho, "utf8")) as Record<string, unknown>) : undefined;
}

async function main(): Promise<number> {
  if (comando === "travar") {
    const cmds = opcoes("cmd");
    if (!cmds.length) {
      console.error('uso: mcp-surface travar --cmd "<comando>" [--cmd ...]');
      return 2;
    }
    for (const cmd of cmds) {
      const r = spawnSync(cmd, { shell: true, stdio: "inherit", env: { ...process.env, [VAR_ESCRITA]: "1" } });
      if (r.status !== 0) return r.status ?? 1;
    }
    console.log("surface.lock.json em dia — commite-o junto com a versão.");
    return 0;
  }

  if (comando === "verificar") {
    const url = resto[0];
    if (!url || url.startsWith("--")) {
      console.error("uso: mcp-surface verificar <endpoint> [--trava ...] [--config ...] [--rota ...] [--tool ... --args ...]");
      return 2;
    }
    const tool = opcao("tool");
    const erro = await verificarNoAr({
      url,
      caminhoDaTrava: opcao("trava") ?? "surface.lock.json",
      ...(opcao("config") ? { config: opcao("config")! } : {}),
      ...(opcao("rota") ? { rota: opcao("rota")! } : {}),
      ...(opcao("perfil") ? { perfil: opcao("perfil")! } : {}),
      ...(tool ? { chamada: { name: tool, arguments: JSON.parse(opcao("args") ?? "{}") as Record<string, unknown> } } : {}),
      log: linha => console.log(linha),
    });
    if (erro) {
      console.error(`O que está no ar NÃO é o que foi travado: ${erro}`);
      return 1;
    }
    return 0;
  }

  if (comando === "replay") {
    const pkg = lerJson("package.json");
    const server = lerJson("server.json");
    const pacote = opcao("pacote") ?? (pkg?.["name"] as string | undefined);
    if (!pacote) {
      console.error("uso: mcp-surface replay --pacote <nome npm> (ou rode na raiz do pacote)");
      return 2;
    }
    const registro = opcao("registro") ?? (server?.["name"] as string | undefined);
    const url = opcao("url");
    const { markdown, json } = await replay({
      pacote,
      ...(registro ? { nomeNoRegistro: registro } : {}),
      ...(url ? { url } : {}),
      log: linha => console.log(linha),
    });
    const base = join(opcao("saida") ?? "baselines", `replay-${new Date().toISOString().slice(0, 10)}`);
    writeFileSync(`${base}.md`, markdown);
    writeFileSync(`${base}.json`, `${JSON.stringify(json, null, 2)}\n`);
    console.log(`\n${base}.md\n${base}.json`);
    return 0;
  }

  console.error("uso: mcp-surface <travar|verificar|replay> … (ver o cabeçalho de src/cli.ts ou o README)");
  return 2;
}

process.exit(await main());
