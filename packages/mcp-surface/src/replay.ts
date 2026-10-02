/**
 * REPLAY RETROATIVO: cada versão publicada no npm, instalada num diretório
 * temporário e interrogada por stdio, normalizada com a mesma função da trava;
 * e o endpoint no ar comparado com a versão que o `/status` dele declara.
 *
 * A trava só protege daqui para a frente. A prova que achou o caso grave do
 * leitor do dev.to (3g607) foi um replay — a superfície do dia da listagem
 * contra a de hoje. Aqui o equivalente é rodar o histórico inteiro uma vez: o
 * que mudou entre versões vizinhas, se alguma remoção saiu fora de major, e se
 * o ar serve a superfície da versão que anuncia.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { capturarHttp, capturarStdio } from "./remoto.js";
import { impressaoDigital } from "./superficie.js";

const shell = process.platform === "win32";

export interface OpcoesReplay {
  pacote: string;
  /** Nome no MCP Registry (o `name` do server.json), para a coluna "registrada". */
  nomeNoRegistro?: string;
  /** Endpoint MCP no ar; o `/status` é lido no mesmo host. */
  url?: string;
  /** Ambiente do servidor stdio (ex.: fixar uma flag que muda a superfície). */
  env?: NodeJS.ProcessEnv;
  log?: (linha: string) => void;
}

interface Linha {
  versao: string;
  data: string | undefined;
  noRegistro: boolean;
  sha256?: string;
  sup?: Record<string, unknown>;
  erro?: string;
}

type Item = Record<string, unknown>;

function npmJson(...argv: string[]): unknown {
  const r = spawnSync("npm", argv, { encoding: "utf8", shell });
  if (r.status !== 0) throw new Error(`npm ${argv.join(" ")}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

const lista = (sup: Item, campo: string) => (sup[campo] as Item[] | null) ?? [];
const nomes = (l: Item[], chave: string) => l.map(x => String(x[chave]));
const init = (sup: Item) => sup["initialize"] as Item;

/** O que mudou de uma versão para a seguinte, e o que disso quebra cliente. */
export function diferenca(antes: Item, depois: Item) {
  const r = {
    tools: { mais: [] as string[], menos: [] as string[], mudou: [] as string[] },
    resources: { mais: [] as string[], menos: [] as string[] },
    prompts: { mais: [] as string[], menos: [] as string[] },
    quebras: [] as string[],
    instructions: false,
    capabilities: false,
    identidade: false,
  };
  const ta = new Map(lista(antes, "tools").map(t => [String(t["name"]), t]));
  const td = new Map(lista(depois, "tools").map(t => [String(t["name"]), t]));
  for (const n of td.keys()) if (!ta.has(n)) r.tools.mais.push(n);
  for (const [n, a] of ta) {
    const d = td.get(n);
    if (!d) {
      r.tools.menos.push(n);
      r.quebras.push(`tool removida: ${n}`);
      continue;
    }
    if (impressaoDigital(a) === impressaoDigital(d)) continue;
    r.tools.mudou.push(n);
    const sa = (a["inputSchema"] ?? {}) as Item;
    const sd = (d["inputSchema"] ?? {}) as Item;
    const pd = (sd["properties"] ?? {}) as Item;
    for (const p of Object.keys((sa["properties"] ?? {}) as Item)) {
      if (!(p in pd)) r.quebras.push(`${n}: parâmetro removido \`${p}\``);
    }
    const ra = new Set((sa["required"] as string[] | undefined) ?? []);
    for (const p of (sd["required"] as string[] | undefined) ?? []) {
      if (!ra.has(p)) r.quebras.push(`${n}: parâmetro passou a obrigatório \`${p}\``);
    }
  }
  for (const [campo, chave] of [["resources", "uri"], ["prompts", "name"]] as const) {
    const a = new Set(nomes(lista(antes, campo), chave));
    const d = new Set(nomes(lista(depois, campo), chave));
    for (const x of d) if (!a.has(x)) r[campo].mais.push(x);
    for (const x of a) {
      if (!d.has(x)) {
        r[campo].menos.push(x);
        r.quebras.push(`${campo === "resources" ? "resource" : "prompt"} removido: ${x}`);
      }
    }
  }
  r.instructions = impressaoDigital(init(antes)["instructions"]) !== impressaoDigital(init(depois)["instructions"]);
  r.capabilities = impressaoDigital(init(antes)["capabilities"]) !== impressaoDigital(init(depois)["capabilities"]);
  r.identidade = impressaoDigital(init(antes)["serverInfo"]) !== impressaoDigital(init(depois)["serverInfo"]);
  return r;
}

const major = (v: string) => Number(v.split(".")[0]);

export async function replay(o: OpcoesReplay): Promise<{ markdown: string; json: unknown }> {
  const log = o.log ?? (() => {});
  const versoes = npmJson("view", o.pacote, "versions", "--json") as string[];
  const datas = npmJson("view", o.pacote, "time", "--json") as Record<string, string>;

  let registro = new Set<string>();
  if (o.nomeNoRegistro) {
    try {
      const res = await fetch(
        `https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(o.nomeNoRegistro)}&limit=100`,
      );
      const corpo = (await res.json()) as { servers?: Array<{ server: { name: string; version: string } }> };
      registro = new Set((corpo.servers ?? []).filter(s => s.server.name === o.nomeNoRegistro).map(s => s.server.version));
    } catch {
      /* registro fora: a coluna sai vazia, o replay segue */
    }
  }

  const linhas: Linha[] = [];
  for (const v of versoes) {
    const base = { versao: v, data: datas[v]?.slice(0, 10), noRegistro: registro.has(v) };
    const dir = mkdtempSync(join(tmpdir(), "mcp-surface-replay-"));
    try {
      const inst = spawnSync(
        "npm",
        ["install", `${o.pacote}@${v}`, "--prefix", dir, "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"],
        { encoding: "utf8", shell },
      );
      if (inst.status !== 0) throw new Error(inst.stderr.trim().split("\n").pop());
      const pasta = join(dir, "node_modules", ...o.pacote.split("/"));
      const pkg = JSON.parse(readFileSync(join(pasta, "package.json"), "utf8")) as { bin?: string | Record<string, string>; main?: string };
      const bin = typeof pkg.bin === "string" ? pkg.bin : (Object.values(pkg.bin ?? {})[0] ?? pkg.main ?? "index.js");
      const sup = await capturarStdio(join(pasta, bin), o.env);
      if (!sup["tools"]) throw new Error("tools/list não respondeu");
      const sha256 = impressaoDigital(sup);
      linhas.push({ ...base, sha256, sup });
      log(`${v}: ${sha256.slice(0, 12)} — ${lista(sup, "tools").length} tools`);
    } catch (e) {
      const erro = String((e as Error).message ?? e);
      linhas.push({ ...base, erro });
      log(`${v}: ERRO ${erro}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  let shaNoAr: string | undefined;
  let statusVersion: string | undefined;
  if (o.url) {
    shaNoAr = impressaoDigital(await capturarHttp(o.url));
    statusVersion = await fetch(new URL("/status", o.url))
      .then(r => r.json() as Promise<{ version?: string }>)
      .then(s => s.version)
      .catch(() => undefined);
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const md: string[] = [];
  md.push(`# Replay retroativo da superfície — ${o.pacote}, ${hoje}`, "");
  md.push(
    "Gerado por `mcp-surface replay` (`@sbissoli/mcp-surface`): cada versão publicada no npm instalada e interrogada por stdio, normalizada pela mesma função da trava (`initialize` com instructions e capabilities, tools, resources, templates e prompts; a versão do servidor fica de fora).",
    "",
  );
  if (o.url && shaNoAr) {
    const declarada = linhas.find(l => l.versao === statusVersion);
    md.push("## O que está no ar", "");
    md.push(`- Endpoint: \`${o.url}\` — \`/status\` declara **${statusVersion ?? "?"}**.`);
    md.push(`- Superfície servida: \`${shaNoAr.slice(0, 12)}\`.`);
    if (declarada?.sha256) {
      md.push(
        declarada.sha256 === shaNoAr
          ? `- **Confere:** é a superfície da ${statusVersion} publicada no npm.`
          : `- **NÃO confere:** a ${statusVersion} publicada no npm tem \`${declarada.sha256.slice(0, 12)}\`.`,
      );
    }
    const iguais = linhas.filter(l => l.sha256 === shaNoAr).map(l => l.versao);
    md.push(`- Versões publicadas com exatamente esta superfície: ${iguais.join(", ") || "nenhuma"}.`, "");
  }

  md.push("## Versão a versão", "");
  md.push("| versão | data | MCP Registry | sha256 | tools | o que mudou em relação à anterior |");
  md.push("|:--|:--|:--:|:--|--:|:--|");
  const quebras: Array<{ de: string; para: string; itens: string[] }> = [];
  let anterior: Linha | undefined;
  for (const l of linhas) {
    if (!l.sup || !l.sha256) {
      md.push(`| ${l.versao} | ${l.data} | ${l.noRegistro ? "sim" : "—"} | erro | — | ${(l.erro ?? "").replaceAll("|", "\\|")} |`);
      continue;
    }
    let mudou = "(primeira)";
    if (anterior?.sup) {
      const d = diferenca(anterior.sup, l.sup);
      const partes: string[] = [];
      if (d.tools.mais.length) partes.push(`+${d.tools.mais.length} tools (${d.tools.mais.join(", ")})`);
      if (d.tools.menos.length) partes.push(`−${d.tools.menos.length} tools (${d.tools.menos.join(", ")})`);
      if (d.tools.mudou.length) partes.push(`${d.tools.mudou.length} tools alteradas`);
      if (d.resources.mais.length || d.resources.menos.length) partes.push(`resources +${d.resources.mais.length}/−${d.resources.menos.length}`);
      if (d.prompts.mais.length || d.prompts.menos.length) partes.push(`prompts +${d.prompts.mais.length}/−${d.prompts.menos.length}`);
      if (d.instructions) partes.push("instructions");
      if (d.capabilities) partes.push("capabilities");
      if (d.identidade) partes.push("identidade");
      mudou = l.sha256 === anterior.sha256 ? "nada" : partes.join("; ") || "detalhe de normalização";
      if (d.quebras.length && major(l.versao) === major(anterior.versao)) {
        quebras.push({ de: anterior.versao, para: l.versao, itens: d.quebras });
      }
    }
    md.push(`| ${l.versao} | ${l.data} | ${l.noRegistro ? "sim" : "—"} | \`${l.sha256.slice(0, 12)}\` | ${lista(l.sup, "tools").length} | ${mudou} |`);
    anterior = l;
  }
  md.push("", "## Remoções fora de versão major", "");
  md.push(
    "Tool, resource ou prompt removido, parâmetro removido ou parâmetro que passou a obrigatório quebra o cliente que dependia dele; pela convenção de versão isso pede major. Listado sem julgamento — cada caso pode ter tido razão registrada no CHANGELOG.",
    "",
  );
  if (!quebras.length) md.push("Nenhuma.");
  for (const q of quebras) md.push(`- **${q.de} → ${q.para}:** ${q.itens.join("; ")}`);
  md.push("", "## Limites", "");
  md.push(
    "- O replay mede o PACOTE de cada versão (stdio). O que o endpoint hospedado serviu no passado não é reconstituível; o que se mede é o de hoje contra a versão que ele declara.",
    "- A cópia do MCP Registry não carrega superfície (só nome, versão, pacotes e remotos): a coluna diz só se a versão foi registrada.",
    "- Quem responde sem token não entra no replay: é comportamento da borda HTTP, medido pela trava daqui para a frente.",
  );

  const json = {
    gerado: new Date().toISOString(),
    pacote: o.pacote,
    endpoint: o.url ?? null,
    statusVersion: statusVersion ?? null,
    sha256NoAr: shaNoAr ?? null,
    versoes: linhas.map(({ sup, ...l }) => ({
      ...l,
      ...(sup
        ? {
            tools: nomes(lista(sup, "tools"), "name"),
            resources: nomes(lista(sup, "resources"), "uri"),
            prompts: nomes(lista(sup, "prompts"), "name"),
            instructionsSha256: impressaoDigital(init(sup)["instructions"]),
          }
        : {}),
    })),
  };
  return { markdown: `${md.join("\n")}\n`, json };
}
