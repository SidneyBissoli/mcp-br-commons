#!/usr/bin/env node
// Check an MCP server against the surface fingerprint its MCP Registry entry
// publishes (form "mcp-surface/1", see SPEC.md). No dependencies: Node 18+.
//
//   node verify.mjs io.github.SidneyBissoli/bcb-br-mcp            # latest version
//   node verify.mjs io.github.SidneyBissoli/bcb-br-mcp 1.16.2
//
// Written from SPEC.md, not from the package's code, so it doubles as a second
// implementation: the package's tests import the functions below and require
// the same sha256 the package computes.
import { createHash } from "node:crypto";

const PUBLISHER = "io.modelcontextprotocol.registry/publisher-provided";
const KEY = "io.github.sidneybissoli/mcp-surface";
const PROTOCOL = "2025-06-18";

// SPEC §3: object keys sorted by UTF-16 code unit, arrays keep their order.
export function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])]));
  return v;
}
// SPEC §3, written key by key. Not JSON.stringify(sortKeys(v)): a JavaScript
// object puts integer-like keys first in numeric order ("9" before "10"),
// whatever order they were inserted in, while §3 wants "10" before "9".
export function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(x => canonicalJson(x === undefined ? null : x)).join(",")}]`;
  if (v && typeof v === "object") {
    const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}
export const sha256 = v => createHash("sha256").update(canonicalJson(v), "utf8").digest("hex");
const byKey = (list, key) =>
  list ? [...list].sort((a, b) => (String(a[key]) < String(b[key]) ? -1 : String(a[key]) > String(b[key]) ? 1 : 0)) : null;

// SPEC §2: the declared surface. serverInfo without its version.
export function canonical({ initialize, tools, resources, resourceTemplates, prompts }) {
  const { version, ...serverInfo } = initialize?.serverInfo ?? {};
  return sortKeys({
    initialize: {
      protocolVersion: initialize?.protocolVersion ?? null,
      capabilities: initialize?.capabilities ?? null,
      instructions: initialize?.instructions ?? null,
      serverInfo,
    },
    tools: byKey(tools, "name"),
    resources: byKey(resources, "uri"),
    resourceTemplates: byKey(resourceTemplates, "uriTemplate"),
    prompts: byKey(prompts, "name"),
  });
}

// SPEC §1: stateless JSON-RPC over HTTP; the body is JSON or SSE with one message.
async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = (await res.text()).trim();
  let msg;
  try {
    msg = JSON.parse(text.startsWith("{") ? text : text.split("\n").filter(l => l.startsWith("data:")).pop().slice(5));
  } catch {
    msg = undefined;
  }
  return { status: res.status, result: msg?.result };
}

async function list(url, method, key) {
  const items = [];
  let params = {};
  for (let page = 0; page < 100; page++) {
    const result = (await rpc(url, method, params)).result;
    if (!Array.isArray(result?.[key])) return undefined;
    items.push(...result[key]);
    const cursor = result.nextCursor;
    if (typeof cursor !== "string" || cursor === "") return items;
    params = { cursor };
  }
  return undefined;
}

// SPEC §6, step 2: before comparing anything, the endpoint must say "no" to a method that does not exist.
// One that answers it answers everything (a proxy, a test double), and nothing measured after would mean anything.
export const MADE_UP_METHOD = "mcp-surface/metodo-que-nao-existe";
export async function saysNo(url) {
  return (await rpc(url, MADE_UP_METHOD)).result === undefined;
}

export async function capture(url) {
  const init = { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "mcp-surface-verify", version: "1.0.0" } };
  return canonical({
    initialize: (await rpc(url, "initialize", init)).result,
    tools: await list(url, "tools/list", "tools"),
    resources: await list(url, "resources/list", "resources"),
    resourceTemplates: await list(url, "resources/templates/list", "resourceTemplates"),
    prompts: await list(url, "prompts/list", "prompts"),
  });
}

async function main([name, version = "latest"]) {
  if (!name) return console.error("usage: node verify.mjs <registry name> [version]"), 2;
  const entry = await (
    await fetch(`https://registry.modelcontextprotocol.io/v0.1/servers/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`)
  ).json();
  const m = entry.server?._meta?.[PUBLISHER]?.[KEY];
  if (m?.form !== "mcp-surface/1") return console.error(`${name}@${version}: no mcp-surface/1 fingerprint in the registry`), 1;
  if (!(await saysNo(m.endpoint))) {
    return console.error(`${m.endpoint} answered "${MADE_UP_METHOD}": it says yes to everything, so nothing was compared`), 1;
  }
  const declared = sha256(await capture(m.endpoint));
  const calls = {
    initialize: ["initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "mcp-surface-verify", version: "1.0.0" } }],
    "tools/call": ["tools/call", m.anonymous.call && { name: m.anonymous.call.name, arguments: m.anonymous.call.arguments }],
  };
  const wrong = [];
  for (const [method, expected] of Object.entries(m.anonymous.answers)) {
    const [meth, params] = calls[method] ?? [method, undefined];
    const r = await rpc(m.endpoint, meth, params);
    if ((r.status === 200 && r.result !== undefined) !== expected) wrong.push(method);
  }
  const ok = declared === m.declared.sha256 && wrong.length === 0 && sha256(m.anonymous.answers) === m.anonymous.sha256;
  console.log(`${name}@${entry.server.version} at ${m.endpoint}`);
  console.log(`  declared   registry ${m.declared.sha256.slice(0, 12)}  live ${declared.slice(0, 12)}  ${declared === m.declared.sha256 ? "ok" : "DIFFERENT"}`);
  console.log(`  anonymous  ${Object.keys(m.anonymous.answers).length} methods  ${wrong.length ? "DIFFERENT: " + wrong.join(", ") : "ok"}`);
  return ok ? 0 : 1;
}

// Run only as a script, not when the package's tests import the functions above.
if (process.argv[1]?.endsWith("verify.mjs")) {
  process.exit(await main(process.argv.slice(2)));
}
