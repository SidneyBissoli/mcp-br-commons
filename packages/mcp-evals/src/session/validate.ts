/**
 * Validação de um conjunto de tarefas contra o catálogo VIVO (tools/list do
 * servidor por stdio, ou o catálogo montado offline no teste do projeto).
 *
 * O invariante é o das fixtures: toda tool citada existe; todo argumento
 * obrigatório do roteiro está presente; nenhum argumento desconhecido quando o
 * schema é selado. Renomear uma tool quebra o teste offline do servidor na hora.
 */

import type { AnthropicTool } from "../catalog.js";
import type { TaskSet } from "./types.js";

interface SchemaLike {
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: unknown;
}

export interface TaskSetValidationOptions {
  minTasks?: number;
  maxTasks?: number;
}

export function validateTaskSet(set: TaskSet, tools: AnthropicTool[], opts: TaskSetValidationOptions = {}): string[] {
  const { minTasks = 1, maxTasks } = opts;
  const problems: string[] = [];
  const byName = new Map(tools.map((t) => [t.name, t]));

  if (!set.server) problems.push("taskSet.server vazio");
  if (!set.systemPrompt || set.systemPrompt.length < 40) problems.push("systemPrompt ausente ou curto demais (< 40)");
  if (!set.faults || !("0" in set.faults)) problems.push("faults precisa ter o nível \"0\" (controle, sem regras)");
  for (const [level, cfg] of Object.entries(set.faults ?? {})) {
    if (!Number.isFinite(cfg.seed)) problems.push(`faults[${level}].seed inválido`);
    for (const r of cfg.rules ?? []) {
      try {
        new RegExp(r.match);
      } catch {
        problems.push(`faults[${level}]: regex inválida ${r.match}`);
      }
      if (!(r.rate >= 0 && r.rate <= 1)) problems.push(`faults[${level}]: rate fora de [0,1] em ${r.match}`);
    }
  }
  if (set.tasks.length < minTasks) problems.push(`conjunto tem ${set.tasks.length} tarefas (mínimo ${minTasks})`);
  if (maxTasks !== undefined && set.tasks.length > maxTasks) problems.push(`conjunto tem ${set.tasks.length} tarefas (máximo ${maxTasks})`);

  const ids = new Set<string>();
  for (const t of set.tasks) {
    if (!t.id) problems.push("tarefa sem id");
    else if (ids.has(t.id)) problems.push(`id duplicado: ${t.id}`);
    ids.add(t.id);
    if (!t.prompt || t.prompt.length < 20) problems.push(`${t.id}: prompt curto demais`);
    if (!t.note) problems.push(`${t.id}: note vazia`);
    if (!t.expectedTools || t.expectedTools.length === 0) problems.push(`${t.id}: expectedTools vazio`);
    for (const name of t.expectedTools ?? []) {
      if (!byName.has(name)) problems.push(`${t.id}: expectedTools cita tool inexistente "${name}"`);
    }
    if (!t.script || t.script.length === 0) problems.push(`${t.id}: script (roteiro do --dry) vazio`);
    for (const [i, call] of (t.script ?? []).entries()) {
      const tool = byName.get(call.tool);
      if (!tool) {
        problems.push(`${t.id}: script[${i}] cita tool inexistente "${call.tool}"`);
        continue;
      }
      const schema = tool.input_schema as SchemaLike;
      for (const req of schema.required ?? []) {
        if (!(req in (call.args ?? {}))) problems.push(`${t.id}: script[${i}] ${call.tool} sem argumento obrigatório "${req}"`);
      }
      if (schema.additionalProperties === false && schema.properties) {
        for (const k of Object.keys(call.args ?? {})) {
          if (!(k in schema.properties)) problems.push(`${t.id}: script[${i}] ${call.tool} com argumento desconhecido "${k}"`);
        }
      }
    }
    if (t.maxSteps !== undefined && (!Number.isInteger(t.maxSteps) || t.maxSteps < 1)) problems.push(`${t.id}: maxSteps inválido`);
  }
  return problems;
}
