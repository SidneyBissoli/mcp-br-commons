import { describe, expect, it, vi } from "vitest";
import { UpstreamError, type UpstreamErrorKind } from "@sbissoli/mcp-upstream";
import {
  Disjuntor,
  LIMITE_PADRAO_DO_DISJUNTOR,
  Relatorio,
  SAIDA_FALHA,
  SAIDA_FONTE_INALCANCAVEL,
  SAIDA_OK,
  TITULO_AMBIGUO,
  TITULO_DERIVA,
  TITULO_FONTE_INALCANCAVEL,
  TITULO_FONTE_INDISPONIVEL,
  anotacao,
  capturarComRetentativa,
  classificarFalha,
  disjuntorDisparou,
  escaparMensagem,
  escaparPropriedade,
  linhaDeResultado,
  resumoMarkdown,
} from "../src/index.js";

/** Erro do pacote, como `createUpstream` o lança. */
function daOrigem(kind: UpstreamErrorKind, status?: number, attempts = 3): UpstreamError {
  return new UpstreamError({
    url: `https://origem.exemplo/${kind}`,
    kind,
    status,
    retryable: false,
    transport: kind === "timeout" || kind === "network",
    attempts,
  });
}

/** O `UpstreamError` LOCAL de um servidor, com o erro do pacote em `cause`. */
class ErroLocal extends Error {
  constructor(msg: string, cause: unknown) {
    super(msg, { cause });
    this.name = "UpstreamError";
  }
}

class DependenciaAusente extends Error {
  constructor(readonly dependeDe: string) {
    super(`depende de '${dependeDe}', que não foi capturada`);
    this.name = "MissingDependencyError";
  }
}
const ehDependencia = (e: unknown) => e instanceof DependenciaAusente;

describe("classificarFalha", () => {
  it("decide pela origem, inclusive através da classe local do servidor (cause)", () => {
    expect(classificarFalha(daOrigem("http_5xx", 502)).veredito).toBe("indisponivel");
    const local = new ErroLocal("[/taquigrafia] Upstream retornou HTTP 502", daOrigem("http_5xx", 502));
    const f = classificarFalha(local);
    expect(f.veredito).toBe("indisponivel");
    expect(f.status).toBe(502);
    expect(f.url).toContain("http_5xx");
  });

  it("dependência é do consumidor: só com o predicado", () => {
    const e = new DependenciaAusente("senador-lista-atual");
    expect(classificarFalha(e).veredito).toBe("alheio");
    const f = classificarFalha(e, { dependencia: ehDependencia });
    expect(f.veredito).toBe("dependencia");
    expect(f.motivo).toContain("senador-lista-atual");
  });

  it("404 é resposta; corpo inesperado é ambíguo; TypeError é alheio", () => {
    expect(classificarFalha(daOrigem("not_found", 404)).veredito).toBe("respondeu");
    expect(classificarFalha(daOrigem("malformed_body", 200)).veredito).toBe("ambiguo");
    expect(classificarFalha(new TypeError("x")).veredito).toBe("alheio");
  });
});

describe("Disjuntor", () => {
  it("5xx CONTA na sequência (no senado zerava) e só dispara sem captura", () => {
    const d = new Disjuntor(3);
    d.registrarFalha("indisponivel");
    d.registrarFalha("indisponivel");
    expect(d.disparou).toBe(false);
    d.registrarFalha("indisponivel");
    expect(d.disparou).toBe(true);
    expect(d.sequencia).toBe(3);
  });

  it("resposta (respondeu/ambiguo) zera; dependencia/alheio não mexem; captura zera e trava aberto", () => {
    const d = new Disjuntor(2);
    d.registrarFalha("indisponivel");
    d.registrarFalha("dependencia");
    d.registrarFalha("alheio");
    expect(d.sequencia).toBe(1);
    d.registrarFalha("respondeu");
    expect(d.sequencia).toBe(0);
    d.registrarFalha("indisponivel");
    d.registrarFalha("ambiguo");
    expect(d.sequencia).toBe(0);
    d.registrarCaptura();
    for (let i = 0; i < 100; i++) d.registrarFalha("indisponivel");
    expect(d.disparou).toBe(false);
    expect(disjuntorDisparou(1, 100, 2)).toBe(false);
    expect(disjuntorDisparou(0, LIMITE_PADRAO_DO_DISJUNTOR)).toBe(true);
    expect(disjuntorDisparou(0, LIMITE_PADRAO_DO_DISJUNTOR - 1)).toBe(false);
  });
});

describe("capturarComRetentativa", () => {
  const semEspera = { dormir: async () => {}, esperaMs: () => 0 };

  it("repete indisponível e ambíguo até o limite e relança o ÚLTIMO erro", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(daOrigem("http_5xx", 502))
      .mockRejectedValueOnce(daOrigem("malformed_body", 200))
      .mockResolvedValueOnce("ok");
    await expect(capturarComRetentativa(fn, semEspera)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);

    const sempre = vi.fn(async () => {
      throw daOrigem("http_5xx", 503);
    });
    const aoRepetir = vi.fn();
    await expect(capturarComRetentativa(sempre, { ...semEspera, aoRepetir })).rejects.toMatchObject({ status: 503 });
    expect(sempre).toHaveBeenCalledTimes(3);
    expect(aoRepetir).toHaveBeenCalledTimes(2);
  });

  it("não repete dependência nem 404", async () => {
    const dep = vi.fn(async () => {
      throw new DependenciaAusente("lista");
    });
    await expect(capturarComRetentativa(dep, { ...semEspera, dependencia: ehDependencia })).rejects.toBeInstanceOf(
      DependenciaAusente,
    );
    expect(dep).toHaveBeenCalledTimes(1);
    const nf = vi.fn(async () => {
      throw daOrigem("not_found", 404);
    });
    await expect(capturarComRetentativa(nf, semEspera)).rejects.toMatchObject({ kind: "not_found" });
    expect(nf).toHaveBeenCalledTimes(1);
  });

  it("espera cresce com a tentativa (2 s · n por padrão)", async () => {
    const esperas: number[] = [];
    const fn = vi.fn(async () => {
      throw daOrigem("timeout");
    });
    await expect(capturarComRetentativa(fn, { dormir: async (ms) => void esperas.push(ms) })).rejects.toBeDefined();
    expect(esperas).toEqual([2000, 4000]);
  });
});

describe("anotação (comandos de workflow)", () => {
  it("escapa mensagem e propriedade conforme a sintaxe do runner", () => {
    expect(escaparMensagem("a%b\r\nc")).toBe("a%25b%0D%0Ac");
    expect(escaparPropriedade("t: x, y")).toBe("t%3A x%2C y");
    expect(anotacao("warning", TITULO_FONTE_INDISPONIVEL, "a, b")).toBe("::warning title=Fonte indisponível::a, b");
    expect(anotacao("error", TITULO_AMBIGUO, "x\ny")).toBe("::error title=Ambíguo (deriva ou página de erro)::x%0Ay");
  });
});

describe("Relatorio: a política", () => {
  function noite(relatorio: Relatorio, specs: Array<[string, unknown | null]>) {
    for (const [nome, err] of specs) {
      if (err === null) relatorio.registrarCaptura(nome, 10);
      else relatorio.registrarFalha(nome, err, 30_000);
      if (relatorio.deveParar) break;
    }
    return relatorio;
  }

  it("CASO REAL 22/10/2026: 63 ok + 1 endpoint em 502 nas 3 tentativas → verde com aviso", () => {
    const r = new Relatorio({ dependencia: ehDependencia });
    const specs: Array<[string, unknown | null]> = Array.from({ length: 63 }, (_, i) => [`spec-${i}`, null]);
    specs.splice(40, 0, [
      "taquigrafia-videos",
      new ErroLocal("[/taquigrafia/videos] Upstream retornou HTTP 502", daOrigem("http_5xx", 502, 3)),
    ]);
    noite(r, specs);
    const resumo = r.resumo();
    expect(resumo.capturadas).toBe(63);
    expect(resumo.total).toBe(64);
    expect(resumo.naoMedidas.map((x) => x.nome)).toEqual(["taquigrafia-videos"]);
    expect(resumo.codigoDeSaida).toBe(SAIDA_OK);
    expect(r.anotacoes()).toEqual(["::warning title=Fonte indisponível::taquigrafia-videos"]);
    const md = resumoMarkdown(resumo);
    expect(md).toContain("Deriva NÃO medida em 1 endpoint**");
    expect(md).toContain("| `taquigrafia-videos` | 502 |");
  });

  it("CASO REAL 16–17/10/2026: nada responde → disjuntor, código 3, anotação de erro rotulada", () => {
    const r = new Relatorio();
    const specs: Array<[string, unknown | null]> = Array.from({ length: 64 }, (_, i) => [
      `spec-${i}`,
      new ErroLocal("[/x] Timeout na requisição upstream (10s)", daOrigem("timeout")),
    ]);
    noite(r, specs);
    const resumo = r.resumo();
    expect(resumo.total).toBe(LIMITE_PADRAO_DO_DISJUNTOR);
    expect(resumo.disjuntor).toBe(true);
    expect(resumo.codigoDeSaida).toBe(SAIDA_FONTE_INALCANCAVEL);
    expect(r.anotacoes()[0]).toContain(`::error title=${TITULO_FONTE_INALCANCAVEL}::`);
    expect(r.anotacoes()[0]).toContain("não é deriva de formato");
    expect(r.anotacoes()).toHaveLength(1);
    expect(resumoMarkdown(resumo)).toContain("### Fonte inalcançável");
  });

  it("noite em que a origem responde 502 a tudo também dispara (5xx conta; no senado caminhava até o teto)", () => {
    const r = new Relatorio();
    noite(
      r,
      Array.from({ length: 64 }, (_, i) => [`spec-${i}`, daOrigem("http_5xx", 502)]),
    );
    expect(r.resumo().total).toBe(5);
    expect(r.codigoDeSaida()).toBe(SAIDA_FONTE_INALCANCAVEL);
  });

  it("dependência de captura indisponível é 'não medida', não vermelho", () => {
    const r = new Relatorio({ dependencia: ehDependencia });
    noite(r, [
      ["lista", null],
      ["processo-lista", daOrigem("http_5xx", 502)],
      ["processo-detalhe", new DependenciaAusente("processo-lista")],
    ]);
    const resumo = r.resumo();
    expect(resumo.naoMedidas.map((x) => x.nome)).toEqual(["processo-lista", "processo-detalhe"]);
    expect(resumo.codigoDeSaida).toBe(SAIDA_OK);
    expect(r.anotacoes()).toEqual(["::warning title=Fonte indisponível::processo-lista, processo-detalhe"]);
  });

  it("deriva (404), ambíguo persistente e alheio são vermelhos, cada um com a sua anotação", () => {
    const r = new Relatorio();
    noite(r, [
      ["a", null],
      ["rota-velha", daOrigem("not_found", 404)],
      ["html-no-lugar-do-json", daOrigem("malformed_body", 200)],
      ["bug", new TypeError("Cannot read properties of undefined")],
      ["fora", daOrigem("http_5xx", 502)],
    ]);
    const resumo = r.resumo();
    expect(resumo.codigoDeSaida).toBe(SAIDA_FALHA);
    expect(r.anotacoes()).toEqual([
      "::warning title=Fonte indisponível::fora",
      `::error title=${TITULO_DERIVA}::rota-velha`,
      `::error title=${TITULO_AMBIGUO}::html-no-lugar-do-json`,
      "::error title=Falha alheia à origem::bug",
    ]);
  });

  it("tudo capturado: código 0, sem anotação, resumo curto", () => {
    const r = new Relatorio();
    noite(r, [
      ["a", null],
      ["b", null],
    ]);
    expect(r.codigoDeSaida()).toBe(SAIDA_OK);
    expect(r.anotacoes()).toEqual([]);
    expect(resumoMarkdown(r.resumo())).toBe("### Teste contra a fonte viva\n\n2 de 2 capturadas.\n\n");
  });

  it("escrever: log + comandos no stdout e markdown no arquivo de GITHUB_STEP_SUMMARY, quando existe", () => {
    const r = new Relatorio();
    noite(r, [
      ["a", null],
      ["b", daOrigem("http_5xx", 502)],
    ]);
    const log: string[] = [];
    const comandos: string[] = [];
    const anexos: Array<[string, string]> = [];
    const resumo = r.escrever({
      log: (l) => log.push(l),
      comando: (l) => comandos.push(l),
      env: { GITHUB_STEP_SUMMARY: "/tmp/resumo.md" },
      anexar: (c, t) => anexos.push([c, t]),
    });
    expect(resumo.codigoDeSaida).toBe(SAIDA_OK);
    expect(log.join("\n")).toContain("1 de 2 capturadas.");
    expect(log.join("\n")).toContain("Fonte indisponível — deriva NÃO medida (1): b");
    expect(comandos).toEqual(["::warning title=Fonte indisponível::b"]);
    expect(anexos).toHaveLength(1);
    expect(anexos[0]?.[0]).toBe("/tmp/resumo.md");
    expect(anexos[0]?.[1]).toContain("| `b` | 502 |");

    // Sem a variável, nada é anexado (rodada local).
    const anexos2: Array<[string, string]> = [];
    r.escrever({ log: () => {}, comando: () => {}, env: {}, anexar: (c, t) => anexos2.push([c, t]) });
    expect(anexos2).toEqual([]);
  });

  it("linha de resultado como o script imprime ao vivo", () => {
    const r = new Relatorio();
    expect(linhaDeResultado(r.registrarCaptura("a", 120))).toBe("ok (120ms)");
    const falha = r.registrarFalha("b", daOrigem("http_5xx", 502), 36_000);
    expect(linhaDeResultado(falha)).toMatch(/^FALHOU \[indisponivel\] \(36000ms\): a origem respondeu HTTP 502/);
  });
});
