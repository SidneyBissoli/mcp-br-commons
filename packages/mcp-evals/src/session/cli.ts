#!/usr/bin/env node
/**
 * CLI do runner de sessão longa.
 *
 *   mcp-evals-session --server <dist/index.js> --tasks <evals/session/tasks.ts> [opções]
 *
 * Opções:
 *   --server <caminho>     entry do servidor MCP (sobe com o node do runner, por stdio)
 *   --server-cwd <dir>     cwd do servidor (padrão: pasta do --server, subindo até o package.json)
 *   --tasks <módulo>       módulo que exporta o TaskSet (default, TASK_SET ou tasks); .ts exige tsx
 *   --arm A|B|both         braço(s) (padrão both)
 *   --fault <n1,n2,...>    níveis de falha do TaskSet (padrão 0)
 *   --runs <n>             execuções por (tarefa, braço, nível) (padrão 3)
 *   --model <id>           modelo do loop (padrão EVAL_MODEL ou claude-opus-5)
 *   --judge-model <id>     modelo do juiz (padrão claude-haiku-4-5); --no-judge desliga
 *   --budget-usd <n>       TETO de gasto da rodada (ou EVAL_BUDGET_USD) — obrigatório fora do --dry
 *   --limit <n>            só as N primeiras tarefas (ou EVAL_LIMIT)
 *   --only <id,id>         só estas tarefas
 *   --max-tokens <n>       max_tokens por requisição (padrão 4096)
 *   --results <dir>        pasta dos NDJSON (padrão <pasta do tasks>/results)
 *   --sha <short>          sha do servidor (padrão: git rev-parse no cwd do servidor)
 *   --fresh                ignora o resume (roda tudo de novo, em append)
 *   --dry                  servidor real, modelo dublado: mede tokens e custo, sem gastar
 *   --count-tokens         no --dry, conta tokens pelo endpoint gratuito (exige a chave)
 *   --verbose              no --dry, mostra um trecho de cada resultado (conferir gabaritos)
 *   --report               só regenera o relatório Markdown dos NDJSON existentes
 *
 * `ANTHROPIC_API_KEY` é lida AQUI, explicitamente, e vai só às requisições do
 * runner — nunca ao processo do servidor. A rodada é paga de propósito; nada mais
 * na máquina deve estar usando a chave enquanto ela roda.
 */

import { execSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { Budget } from "./budget.js";
import { countTokensWith, renderDryReport, runDry } from "./dry.js";
import { connectStdio, type McpToolClient } from "./mcp-client.js";
import { renderReport } from "./report.js";
import { ResultsStore } from "./results.js";
import { runRound } from "./runner.js";
import type { Arm, TaskSet } from "./types.js";
import { validateTaskSet } from "./validate.js";

interface Args {
  flags: Map<string, string | true>;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (!a.startsWith("--")) continue;
    const name = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(name, next);
      i++;
    } else {
      flags.set(name, true);
    }
  }
  return { flags };
}

function str(args: Args, name: string, env?: string): string | undefined {
  const v = args.flags.get(name);
  if (typeof v === "string") return v;
  if (env && process.env[env]) return process.env[env];
  return undefined;
}

function num(args: Args, name: string, env: string | undefined, fallback: number): number {
  const v = str(args, name, env);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${name}: número esperado, veio "${v}"`);
  return n;
}

function has(args: Args, name: string): boolean {
  return args.flags.has(name);
}

function findPackageRoot(from: string): string {
  let dir = resolve(from);
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(from);
}

function gitShortSha(cwd: string): string | null {
  try {
    return execSync("git rev-parse --short HEAD", { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || null;
  } catch {
    return null;
  }
}

function brasiliaDate(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

async function loadTaskSet(path: string): Promise<TaskSet> {
  const mod = (await import(pathToFileURL(resolve(path)).href)) as Record<string, unknown>;
  const set = (mod.default ?? mod.TASK_SET ?? mod.tasks) as TaskSet | undefined;
  if (!set || !Array.isArray(set.tasks)) throw new Error(`${path}: exporte o TaskSet como default, TASK_SET ou tasks`);
  return set;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const log = (l: string) => console.log(l);

  const tasksPath = str(args, "tasks");
  if (!tasksPath) throw new Error("--tasks <módulo> é obrigatório");
  const resultsDir = str(args, "results") ?? join(dirname(resolve(tasksPath)), "results");
  const store = new ResultsStore(resultsDir);
  const taskSet = await loadTaskSet(tasksPath);

  if (has(args, "report")) {
    const records = store.loadAll();
    if (records.length === 0) throw new Error(`nenhum NDJSON em ${resultsDir}`);
    const lines = renderReport(records);
    const out = join(resultsDir, "relatorio.md");
    writeFileSync(out, `${lines.join("\n")}\n`, "utf8");
    log(lines.join("\n"));
    log(`\nrelatório: ${out}`);
    return 0;
  }

  const serverPath = str(args, "server");
  if (!serverPath) throw new Error("--server <dist/index.js> é obrigatório");
  const serverAbs = resolve(serverPath);
  if (!existsSync(serverAbs)) throw new Error(`--server: não existe ${serverAbs} (rode o build do servidor)`);
  const serverCwd = str(args, "server-cwd") ?? findPackageRoot(dirname(serverAbs));
  const serverSha = str(args, "sha") ?? gitShortSha(serverCwd);
  const faultPreload = new URL("./fault.js", import.meta.url);
  const faultPreloadPath = faultPreload.protocol === "file:" ? decodeURIComponent(faultPreload.pathname.replace(/^\/([A-Za-z]:)/, "$1")) : "";

  const faults = (str(args, "fault") ?? "0").split(",").map((s) => s.trim()).filter(Boolean);
  for (const f of faults) if (!(f in taskSet.faults)) throw new Error(`nível de falha "${f}" não existe no TaskSet (tem: ${Object.keys(taskSet.faults).join(", ")})`);

  const connect = async (fault: string): Promise<McpToolClient> => {
    const cfg = taskSet.faults[fault];
    const inject = !!cfg && cfg.rules.length > 0;
    const nodeArgs = inject ? ["--import", faultPreloadPath, serverAbs] : [serverAbs];
    return connectStdio({
      args: nodeArgs,
      cwd: serverCwd,
      ...(inject ? { env: { EVAL_FAULT_RULES: JSON.stringify(cfg) } } : {}),
    });
  };

  const only = str(args, "only")?.split(",").map((s) => s.trim()).filter(Boolean);
  const limit = num(args, "limit", "EVAL_LIMIT", 0);
  let tasks = taskSet.tasks;
  if (only && only.length > 0) {
    tasks = only.map((id) => {
      const t = taskSet.tasks.find((x) => x.id === id);
      if (!t) throw new Error(`--only: tarefa desconhecida ${id}`);
      return t;
    });
  } else if (limit > 0) tasks = tasks.slice(0, limit);

  const model = str(args, "model", "EVAL_MODEL") ?? "claude-opus-5";
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (has(args, "dry")) {
    const mcp = await connect(faults[0] as string);
    try {
      const tools = await mcp.listTools();
      const problems = validateTaskSet(taskSet, tools);
      if (problems.length > 0) throw new Error(`tarefas inválidas contra o catálogo vivo:\n  - ${problems.join("\n  - ")}`);
      const wantCount = has(args, "count-tokens");
      if (wantCount && !apiKey) throw new Error("--count-tokens exige ANTHROPIC_API_KEY (o endpoint é gratuito, mas autenticado)");
      const report = await runDry(taskSet, tasks, tools, mcp, {
        models: [model, ...["claude-opus-5", "claude-sonnet-5"].filter((m) => m !== model)],
        ...(wantCount && apiKey ? { counter: countTokensWith(apiKey, model) } : {}),
        verbose: has(args, "verbose"),
        log,
      });
      const lines = renderDryReport(report);
      const out = join(resultsDir, `${brasiliaDate()}_${serverSha ?? "nosha"}_dry.md`);
      writeFileSync(out, `${lines.join("\n")}\n`, "utf8");
      log(`\n${lines.join("\n")}`);
      log(`relatório do --dry: ${out}`);
      return 0;
    } finally {
      await mcp.close();
    }
  }

  if (!apiKey) {
    log("ANTHROPIC_API_KEY não está definido — a rodada paga não roda. Use --dry para medir sem gastar.");
    return 0;
  }
  const budgetUsd = num(args, "budget-usd", "EVAL_BUDGET_USD", NaN);
  if (!Number.isFinite(budgetUsd)) throw new Error("--budget-usd (ou EVAL_BUDGET_USD) é obrigatório na rodada paga");
  const armFlag = str(args, "arm") ?? "both";
  const arms: Arm[] = armFlag === "both" ? ["A", "B"] : armFlag === "A" || armFlag === "B" ? [armFlag] : (() => { throw new Error(`--arm: A, B ou both`); })();
  const runs = Math.max(1, Math.floor(num(args, "runs", "EVAL_RUNS", 3)));
  const budget = new Budget(budgetUsd);

  log(`rodada: ${taskSet.server}@${serverSha ?? "nosha"} · modelo ${model} · ${tasks.length} tarefas × ${arms.join("+")} × falha ${faults.join(",")} × ${runs} execuções · teto US$ ${budgetUsd.toFixed(2)}`);
  const result = await runRound({
    taskSet,
    tasks,
    arms,
    faults,
    runs,
    model,
    ...(str(args, "judge-model") ? { judgeModel: str(args, "judge-model") as string } : {}),
    judge: !has(args, "no-judge"),
    apiKey,
    budget,
    store,
    date: brasiliaDate(),
    serverSha,
    ...(has(args, "max-tokens") ? { maxTokens: num(args, "max-tokens", undefined, 4096) } : {}),
    resume: !has(args, "fresh"),
    deps: { fetchImpl: fetch, sleepImpl: (ms) => new Promise((r) => setTimeout(r, ms)), logError: (l) => console.error(l) },
    connect,
    log,
  });

  const all = store.loadAll();
  const lines = renderReport(all);
  const out = join(resultsDir, "relatorio.md");
  writeFileSync(out, `${lines.join("\n")}\n`, "utf8");
  log(`\n${lines.join("\n")}`);
  log(`\nsessões nesta execução: ${result.records.length} · puladas pelo resume: ${result.skipped} · gasto US$ ${result.spentUSD.toFixed(4)}${result.stoppedBy ? ` · INTERROMPIDA (${result.stoppedBy})` : ""}`);
  log(`relatório: ${out}`);
  return result.stoppedBy ? 2 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error((e as Error).stack ?? String(e));
    process.exit(1);
  },
);
