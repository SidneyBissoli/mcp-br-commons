/**
 * `@sbissoli/mcp-live-source/vitest` — o adaptador ligado ao vitest (peer opcional; o
 * entrypoint "." não o importa). Importar SÓ em arquivo de teste.
 *
 * ```ts
 * import { suiteAoVivo } from "@sbissoli/mcp-live-source/vitest";
 * const { aoVivo } = suiteAoVivo();
 * describe.runIf(LIVE)("contrato …", () => {
 *   aoVivo("SGS 433 — IPCA", async () => { … }, { endpoint: "sgs-433", timeout: 180_000 });
 * });
 * ```
 */
import { afterAll, it, type TestContext } from "vitest";
import { criarSuiteAoVivo, type OpcoesDaSuite, type SuiteAoVivo } from "./ao-vivo.js";

export type {
  AoVivo,
  ContextoDeTeste,
  GanchosDoRunner,
  OpcoesAoVivo,
  OpcoesDaSuite,
  OpcoesDeTeste,
  SuiteAoVivo,
} from "./ao-vivo.js";
export { ehAssercao, repetirAoVivo } from "./ao-vivo.js";

/**
 * Direto no stdout do worker, não `console.log`: o reporter padrão do vitest 5 ENGOLE o
 * console dos testes e dos hooks (só `--reporter=verbose` o mostra, e prefixado com
 * `stdout | arquivo`), e o runner do GitHub Actions só reconhece `::warning …` no início
 * de uma linha do stdout do processo. Medido em 22/10/2026 com o vitest 5.0.5.
 */
function escreverNoStdout(linha: string): void {
  process.stdout.write(`${linha}\n`);
}

/** Um relatório por arquivo de teste: chamar no topo do módulo (ou dentro do `describe`). */
export function suiteAoVivo(opcoes: OpcoesDaSuite = {}): SuiteAoVivo<TestContext> {
  return criarSuiteAoVivo<TestContext>(
    {
      it: (nome, fn, o) => {
        it(nome, fn, o?.timeout);
      },
      afterAll: (fn) => {
        afterAll(fn);
      },
    },
    { ...opcoes, destinos: { log: escreverNoStdout, comando: escreverNoStdout, ...opcoes.destinos } },
  );
}
