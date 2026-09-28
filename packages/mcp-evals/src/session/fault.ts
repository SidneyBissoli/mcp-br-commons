/**
 * Preload de injeção de falha: `node --import <dist/session/fault.js> dist/index.js`.
 *
 * Lê `EVAL_FAULT_RULES` (JSON `{seed, rules[]}`) e embrulha `globalThis.fetch` antes
 * de o servidor carregar. Sem a variável, não faz nada — o mesmo preload serve ao
 * nível 0. Loga cada falha injetada no stderr (que o runner herda), para o
 * operador ver a oscilação acontecendo.
 */

import { parseFaultConfig, wrapFetch } from "./fault-core.js";

const cfg = parseFaultConfig(process.env.EVAL_FAULT_RULES);
if (cfg && cfg.rules.length > 0) {
  globalThis.fetch = wrapFetch(globalThis.fetch, cfg, (line) => process.stderr.write(`${line}\n`));
}
