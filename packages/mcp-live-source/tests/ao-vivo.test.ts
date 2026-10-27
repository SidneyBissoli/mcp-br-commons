import { describe, expect, it } from "vitest";
import { UpstreamError, type UpstreamErrorKind } from "@sbissoli/mcp-upstream";
import {
  TITULO_DERIVA,
  TITULO_FONTE_INALCANCAVEL,
  TITULO_FONTE_INDISPONIVEL,
  VARIAVEL_DO_ORCAMENTO,
  criarSuiteAoVivo,
  ehAssercao,
  orcamentoDoAmbiente,
  repetirAoVivo,
  type ContextoDeTeste,
  type GanchosDoRunner,
  type OpcoesDaSuite,
  type OpcoesDeTeste,
} from "../src/index.js";

function daOrigem(kind: UpstreamErrorKind, status?: number): UpstreamError {
  return new UpstreamError({ url: `https://origem.exemplo/${kind}`, kind, status, retryable: false, transport: false, attempts: 1 });
}

/** O que `ctx.skip(nota)` faz no vitest: lança e o runner marca o teste pulado. */
class Pulado extends Error {
  constructor(readonly nota: string | undefined) {
    super(`pulado: ${nota ?? ""}`);
    this.name = "Pulado";
  }
}

class AssertionError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "AssertionError";
  }
}

interface TesteColetado {
  nome: string;
  fn: (ctx: ContextoDeTeste) => Promise<void>;
  opcoes: OpcoesDeTeste | undefined;
}

/** Dublê do runner: coleta os testes e os hooks; `rodar()` executa em sequência, como o vitest. */
function runnerDuble() {
  const testes: TesteColetado[] = [];
  const depois: Array<() => void> = [];
  const ganchos: GanchosDoRunner<ContextoDeTeste> = {
    it: (nome, fn, opcoes) => {
      testes.push({ nome, fn, opcoes });
    },
    afterAll: (fn) => {
      depois.push(fn);
    },
  };
  const ctx: ContextoDeTeste = {
    skip(nota) {
      throw new Pulado(nota);
    },
  };
  interface Desfecho {
    nome: string;
    estado: "ok" | "pulado" | "falhou";
    nota?: string | undefined;
    erro?: unknown;
  }
  async function rodar(): Promise<Desfecho[]> {
    const saida: Desfecho[] = [];
    for (const t of testes) {
      try {
        await t.fn(ctx);
        saida.push({ nome: t.nome, estado: "ok" });
      } catch (err) {
        if (err instanceof Pulado) saida.push({ nome: t.nome, estado: "pulado", nota: err.nota });
        else saida.push({ nome: t.nome, estado: "falhou", erro: err });
      }
    }
    for (const fn of depois) {
      try {
        fn();
      } catch (err) {
        errosDoAfterAll.push(err);
      }
    }
    return saida;
  }
  const errosDoAfterAll: unknown[] = [];
  return { ganchos, testes, rodar, errosDoAfterAll };
}

const semEspera: OpcoesDaSuite["retentativa"] = { dormir: async () => {} };

function suite(opcoes: OpcoesDaSuite = {}) {
  const runner = runnerDuble();
  const log: string[] = [];
  const comandos: string[] = [];
  const anexos: string[] = [];
  const s = criarSuiteAoVivo(runner.ganchos, {
    retentativa: semEspera,
    destinos: {
      log: (l) => log.push(l),
      comando: (c) => comandos.push(c),
      env: { GITHUB_STEP_SUMMARY: "resumo.md" },
      anexar: (_c, t) => anexos.push(t),
    },
    ...opcoes,
  });
  return { ...s, ...runner, log, comandos, anexos };
}

describe("criarSuiteAoVivo — a política traduzida para teste", () => {
  it("captura ok: o teste passa e o relatório conta a captura", async () => {
    const s = suite();
    s.aoVivo("a", async () => {});
    const r = await s.rodar();
    expect(r).toEqual([{ nome: "a", estado: "ok" }]);
    expect(s.relatorio.resumo().capturadas).toBe(1);
    expect(s.comandos).toEqual([]);
  });

  it("indisponível nas idas: PULA com a nota 'Fonte indisponível: …', registra as idas, avisa no fim", async () => {
    const s = suite();
    let chamadas = 0;
    s.aoVivo(
      "SGS 433 — IPCA, mensal",
      async () => {
        chamadas++;
        throw daOrigem("http_5xx", 502);
      },
      { endpoint: "sgs-433" },
    );
    s.aoVivo("b", async () => {});
    const r = await s.rodar();
    expect(chamadas).toBe(3);
    expect(r[0]?.estado).toBe("pulado");
    expect(r[0]?.nota).toMatch(new RegExp(`^${TITULO_FONTE_INDISPONIVEL}: a origem respondeu HTTP 502`));
    const resumo = s.relatorio.resumo();
    expect(resumo.naoMedidas.map((x) => [x.nome, x.idas])).toEqual([["sgs-433", 3]]);
    expect(resumo.capturadas).toBe(1);
    expect(s.comandos).toEqual([`::warning title=${TITULO_FONTE_INDISPONIVEL}::sgs-433`]);
    expect(s.anexos.join("")).toContain("Deriva NÃO medida em 1 endpoint");
    expect(s.log.some((l) => l.startsWith("código de saída"))).toBe(false);
  });

  it("asserção do teste = deriva medida: falha normal, sem repetir, rotulada 'Deriva de formato'", async () => {
    const s = suite();
    let chamadas = 0;
    s.aoVivo("d", async () => {
      chamadas++;
      throw new AssertionError("expected 400 to be <= 160");
    });
    const r = await s.rodar();
    expect(chamadas).toBe(1);
    expect(r[0]?.estado).toBe("falhou");
    expect((r[0]?.erro as Error).name).toBe("AssertionError");
    const resumo = s.relatorio.resumo();
    expect(resumo.derivas.map((x) => x.nome)).toEqual(["d"]);
    expect(resumo.derivas[0]?.falha.motivo).toContain("o contrato falhou no que chegou");
    expect(s.comandos).toEqual([`::error title=${TITULO_DERIVA}::d`]);
  });

  it("404 da origem: falha normal sem repetir (respondeu)", async () => {
    const s = suite();
    let chamadas = 0;
    s.aoVivo("e", async () => {
      chamadas++;
      throw daOrigem("not_found", 404);
    });
    const r = await s.rodar();
    expect(chamadas).toBe(1);
    expect(r[0]?.estado).toBe("falhou");
    expect(s.relatorio.resumo().derivas).toHaveLength(1);
  });

  it("ambíguo: repete; se persistir, falha normal rotulada", async () => {
    const s = suite();
    let chamadas = 0;
    s.aoVivo("f", async () => {
      chamadas++;
      throw daOrigem("malformed_body", 200);
    });
    const r = await s.rodar();
    expect(chamadas).toBe(3);
    expect(r[0]?.estado).toBe("falhou");
    expect(s.relatorio.resumo().ambiguas.map((x) => x.nome)).toEqual(["f"]);
  });

  it("erro alheio (TypeError do teste): falha normal, sem repetir", async () => {
    const s = suite();
    let chamadas = 0;
    s.aoVivo("g", async () => {
      chamadas++;
      throw new TypeError("x is not a function");
    });
    const r = await s.rodar();
    expect(chamadas).toBe(1);
    expect(r[0]?.estado).toBe("falhou");
    expect(s.relatorio.resumo().alheias).toHaveLength(1);
  });

  it("disjuntor: depois de N indisponíveis sem captura, os seguintes pulam SEM ir à rede ('Fonte inalcançável')", async () => {
    const s = suite({ limiteDoDisjuntor: 2 });
    const chamadas: string[] = [];
    for (const nome of ["a", "b", "c", "d"]) {
      s.aoVivo(nome, async () => {
        chamadas.push(nome);
        throw daOrigem("timeout");
      });
    }
    const r = await s.rodar();
    expect(chamadas).toEqual(["a", "a", "a", "b", "b", "b"]);
    expect(r.map((x) => x.estado)).toEqual(["pulado", "pulado", "pulado", "pulado"]);
    expect(r[2]?.nota).toMatch(new RegExp(`^${TITULO_FONTE_INALCANCAVEL}:`));
    const resumo = s.relatorio.resumo();
    expect(resumo.naoMedidas).toHaveLength(4);
    expect(resumo.disjuntor).toBe(true);
    expect(s.comandos).toHaveLength(1);
    expect(s.comandos[0]).toContain(`::error title=${TITULO_FONTE_INALCANCAVEL}::`);
    // E o arquivo FALHA (como o código 3 do script): o afterAll lança, para o retry
    // automático re-rodar num runner novo — medido no primeiro dispatch do ibge, 22/10/2026.
    expect(s.errosDoAfterAll).toHaveLength(1);
    expect(String(s.errosDoAfterAll[0])).toMatch(new RegExp(`${TITULO_FONTE_INALCANCAVEL}: a origem não respondeu`));
  });

  it("falharSeInalcancavel: false deixa o arquivo verde só com a anotação", async () => {
    const s = suite({ limiteDoDisjuntor: 1, falharSeInalcancavel: false });
    s.aoVivo("a", async () => {
      throw daOrigem("timeout");
    });
    await s.rodar();
    expect(s.relatorio.resumo().disjuntor).toBe(true);
    expect(s.comandos[0]).toContain(`::error title=${TITULO_FONTE_INALCANCAVEL}::`);
    expect(s.errosDoAfterAll).toEqual([]);
  });

  it("só indisponível COM captura antes não dispara o disjuntor nem falha o arquivo", async () => {
    const s = suite({ limiteDoDisjuntor: 1 });
    s.aoVivo("ok", async () => {});
    s.aoVivo("b", async () => {
      throw daOrigem("http_5xx", 503);
    });
    await s.rodar();
    expect(s.comandos).toEqual([`::warning title=${TITULO_FONTE_INDISPONIVEL}::b`]);
    expect(s.errosDoAfterAll).toEqual([]);
  });

  it("uma captura antes desarma o disjuntor: a sequência é sobre os endpoints, não sobre a conexão", async () => {
    const s = suite({ limiteDoDisjuntor: 2 });
    const chamadas: string[] = [];
    s.aoVivo("ok", async () => {
      chamadas.push("ok");
    });
    for (const nome of ["a", "b", "c"]) {
      s.aoVivo(nome, async () => {
        chamadas.push(nome);
        throw daOrigem("timeout");
      });
    }
    await s.rodar();
    expect(chamadas.filter((c) => c === "c")).toHaveLength(3);
    expect(s.relatorio.resumo().disjuntor).toBe(false);
    expect(s.comandos).toEqual([`::warning title=${TITULO_FONTE_INDISPONIVEL}::a, b, c`]);
  });

  it("arquivo sem teste ao vivo rodado (describe.runIf(false)): o afterAll não escreve nada", async () => {
    const s = suite();
    await s.rodar();
    expect(s.log).toEqual([]);
    expect(s.comandos).toEqual([]);
    expect(s.anexos).toEqual([]);
  });

  it("timeout do teste e retentativa por teste vão ao runner e ao laço", async () => {
    const s = suite();
    let chamadas = 0;
    s.aoVivo(
      "h",
      async () => {
        chamadas++;
        throw daOrigem("network");
      },
      { timeout: 123_000, tentativas: 2 },
    );
    expect(s.testes[0]?.opcoes).toEqual({ timeout: 123_000 });
    await s.rodar();
    expect(chamadas).toBe(2);
  });

  it("orçamento esgotado no meio: os seguintes pulam SEM ir à rede, anotação de erro e o arquivo FALHA", async () => {
    // O caso de 26/10/2026 no bcb: a origem respondeu às primeiras e parou no meio. O
    // disjuntor fica desarmado (houve captura) e, sem orçamento, a rodada andava até o
    // teto do job e terminava `cancelled`, sem rótulo e sem retry.
    let relogio = 0;
    const s = suite({ orcamentoMs: 10_000, agora: () => relogio });
    const chamadas: string[] = [];
    s.aoVivo("ok", async () => {
      chamadas.push("ok");
      relogio += 1_000;
    });
    s.aoVivo("lento", async () => {
      chamadas.push("lento");
      relogio += 9_500; // acaba DEPOIS do orçamento: o teste em curso termina
      throw daOrigem("timeout");
    });
    for (const nome of ["c", "d"]) {
      s.aoVivo(nome, async () => {
        chamadas.push(nome);
      });
    }
    const r = await s.rodar();
    expect(chamadas).toEqual(["ok", "lento", "lento", "lento"]);
    expect(r.map((x) => x.estado)).toEqual(["ok", "pulado", "pulado", "pulado"]);
    expect(r[2]?.nota).toMatch(new RegExp(`^${TITULO_FONTE_INALCANCAVEL}: orçamento da rodada esgotado`));
    const resumo = s.relatorio.resumo();
    expect(resumo.orcamentoEsgotado).toBe(true);
    expect(resumo.disjuntor).toBe(false);
    expect(resumo.codigoDeSaida).toBe(3);
    expect(resumo.naoMedidas.map((x) => x.nome)).toEqual(["lento", "c", "d"]);
    expect(s.comandos).toEqual([
      `::error title=${TITULO_FONTE_INALCANCAVEL}::orçamento da rodada (10 s) esgotado com 1 de 4 capturadas; ` +
        "deriva NÃO medida em: lento, c, d — não é deriva de formato",
    ]);
    expect(s.anexos.join("")).toContain("### Fonte inalcançável");
    expect(s.log.some((l) => l.startsWith("PARANDO CEDO: orçamento da rodada (10 s)"))).toBe(true);
    expect(s.errosDoAfterAll).toHaveLength(1);
    expect(String(s.errosDoAfterAll[0])).toMatch(new RegExp(`${TITULO_FONTE_INALCANCAVEL}: orçamento da rodada esgotado`));
  });

  it("orçamento folgado: rodada saudável não muda (verde, sem anotação)", async () => {
    let relogio = 0;
    const s = suite({ orcamentoMs: 10_000, agora: () => relogio });
    for (const nome of ["a", "b", "c"]) {
      s.aoVivo(nome, async () => {
        relogio += 1_000;
      });
    }
    const r = await s.rodar();
    expect(r.map((x) => x.estado)).toEqual(["ok", "ok", "ok"]);
    expect(s.relatorio.resumo().orcamentoEsgotado).toBe(false);
    expect(s.comandos).toEqual([]);
    expect(s.errosDoAfterAll).toEqual([]);
  });

  it("o relógio do orçamento começa no PRIMEIRO teste, não na coleta", async () => {
    let relogio = 50_000; // a coleta e o preparo do job não contam
    const s = suite({ orcamentoMs: 10_000, agora: () => relogio });
    s.aoVivo("a", async () => {
      relogio += 1_000;
    });
    const r = await s.rodar();
    expect(r[0]?.estado).toBe("ok");
  });

  it("orçamento esgotado com falharSeInalcancavel: false — anotação sem falhar o arquivo", async () => {
    let relogio = 0;
    const s = suite({ orcamentoMs: 1_000, agora: () => relogio, falharSeInalcancavel: false });
    s.aoVivo("a", async () => {
      relogio += 2_000;
    });
    s.aoVivo("b", async () => {});
    await s.rodar();
    expect(s.relatorio.resumo().orcamentoEsgotado).toBe(true);
    expect(s.errosDoAfterAll).toEqual([]);
  });

  it("orcamentoMs inválido lança na criação da suíte", () => {
    expect(() => suite({ orcamentoMs: 0 })).toThrow(RangeError);
    expect(() => suite({ orcamentoMs: Number.NaN })).toThrow(RangeError);
  });

  it("orcamentoDoAmbiente: segundos da variável em ms; ausente = sem orçamento; lixo LANÇA", () => {
    expect(orcamentoDoAmbiente({})).toBeUndefined();
    expect(orcamentoDoAmbiente({ [VARIAVEL_DO_ORCAMENTO]: "" })).toBeUndefined();
    expect(orcamentoDoAmbiente({ [VARIAVEL_DO_ORCAMENTO]: "600" })).toBe(600_000);
    expect(orcamentoDoAmbiente({ [VARIAVEL_DO_ORCAMENTO]: " 1.5 " })).toBe(1_500);
    expect(() => orcamentoDoAmbiente({ [VARIAVEL_DO_ORCAMENTO]: "10m" })).toThrow(RangeError);
    expect(() => orcamentoDoAmbiente({ [VARIAVEL_DO_ORCAMENTO]: "0" })).toThrow(RangeError);
  });

  it("helpers: repetirAoVivo só repete indisponível e ambíguo; ehAssercao só AssertionError", () => {
    const f = (veredito: "indisponivel" | "ambiguo" | "respondeu" | "alheio" | "dependencia") => ({
      veredito,
      motivo: "",
      kind: undefined,
      status: undefined,
      url: undefined,
    });
    expect(repetirAoVivo(f("indisponivel"))).toBe(true);
    expect(repetirAoVivo(f("ambiguo"))).toBe(true);
    expect(repetirAoVivo(f("respondeu"))).toBe(false);
    expect(repetirAoVivo(f("alheio"))).toBe(false);
    expect(repetirAoVivo(f("dependencia"))).toBe(false);
    expect(ehAssercao(new AssertionError("x"))).toBe(true);
    expect(ehAssercao(new Error("x"))).toBe(false);
    expect(ehAssercao("x")).toBe(false);
  });
});
