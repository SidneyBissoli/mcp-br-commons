/**
 * Prova de ponta a ponta do adaptador: um vitest FILHO roda cada fixture de
 * tests/fixtures/vitest/ e aqui se lê o que o GitHub Actions leria — o código de saída
 * do processo, as anotações no stdout (no início da linha, senão o runner não as
 * reconhece) e o `$GITHUB_STEP_SUMMARY`.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { TITULO_DERIVA, TITULO_FONTE_INALCANCAVEL, TITULO_FONTE_INDISPONIVEL } from "../src/index.js";

const aqui = dirname(fileURLToPath(import.meta.url));
const fixtures = join(aqui, "fixtures", "vitest");
const vitestMjs = join(dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs");
const temp = mkdtempSync(join(tmpdir(), "mcp-live-source-"));

afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
});

function rodarFixture(arquivo: string) {
  const resumo = join(temp, `${arquivo}.md`);
  // Sem as variáveis do vitest pai, senão o filho acha que é um worker dele.
  const env: Record<string, string> = { GITHUB_STEP_SUMMARY: resumo, NO_COLOR: "1", FORCE_COLOR: "0" };
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("VITEST") && k !== "TEST" && k !== "GITHUB_STEP_SUMMARY") env[k] = v;
  }
  const r = spawnSync(
    process.execPath,
    [vitestMjs, "run", "--root", fixtures, "--config", join(fixtures, "vitest.config.ts"), `${arquivo}.fixture.ts`],
    { encoding: "utf8", env, cwd: fixtures },
  );
  let markdown = "";
  try {
    markdown = readFileSync(resumo, "utf8");
  } catch {
    markdown = "";
  }
  return { status: r.status, stdout: r.stdout + r.stderr, markdown };
}

describe("adaptador vitest, de ponta a ponta", () => {
  it("fonte fora em 2 de 3: processo VERDE (0), testes pulados, aviso no início da linha, resumo no job", () => {
    const r = rodarFixture("indisponivel");
    expect(r.status, r.stdout).toBe(0);
    expect(r.stdout).toMatch(/Tests\s+1 passed \| 2 skipped/);
    expect(r.stdout).toMatch(/^1 de 3 capturadas\.$/m);
    expect(r.stdout).toMatch(new RegExp(`^::warning title=${TITULO_FONTE_INDISPONIVEL}::b, c$`, "m"));
    expect(r.stdout).not.toMatch(/código de saída/);
    expect(r.markdown).toContain("1 de 3 capturadas.");
    expect(r.markdown).toContain("Deriva NÃO medida em 2 endpoints");
    expect(r.markdown).toMatch(/\| `b` \| 502 \| 3 \|/);
  }, 60_000);

  it("nada respondeu (disjuntor): testes pulados, mas o arquivo FALHA (1) com `Fonte inalcançável` — para o retry re-rodar", () => {
    const r = rodarFixture("inalcancavel");
    expect(r.status, r.stdout).toBe(1);
    // a e b pagam 3 idas cada; c e d pulam sem ir à rede
    expect(r.stdout.match(/^IDA [ab]$/gm)).toHaveLength(6);
    expect(r.stdout).not.toMatch(/^IDA [cd]$/m);
    expect(r.stdout).toMatch(/Tests\s+4 skipped/);
    expect(r.stdout).toMatch(new RegExp(`^::error title=${TITULO_FONTE_INALCANCAVEL}::`, "m"));
    expect(r.stdout).toMatch(/FAIL\s+inalcancavel\.fixture\.ts/);
    expect(r.stdout).toMatch(/O arquivo falha de propósito para o retry automático/);
    expect(r.markdown).toContain("### Fonte inalcançável");
  }, 60_000);

  it("deriva medida (asserção): processo VERMELHO (1) com `Deriva de formato`", () => {
    const r = rodarFixture("deriva");
    expect(r.status, r.stdout).toBe(1);
    expect(r.stdout).toMatch(/Tests\s+1 failed/);
    expect(r.stdout).toMatch(new RegExp(`^::error title=${TITULO_DERIVA}::d$`, "m"));
    expect(r.markdown).toContain("#### Deriva de formato");
  }, 60_000);
});
