import { describe, expect, it } from "vitest";
import { checkAnswer, classifyError, computeMetrics, extractNumbers } from "../../src/session/metrics.js";
import { canonicalCall, type CallRecord } from "../../src/session/types.js";

function call(step: number, tool: string, args: Record<string, unknown>, isError = false, errorClass: CallRecord["errorClass"] = null): CallRecord {
  return {
    step,
    tool,
    args,
    canonical: canonicalCall(tool, args),
    isError,
    errorClass,
    retrieval: null,
    resultChars: 10,
    resultSummary: "",
    durationMs: 1,
  };
}

describe("classifyError", () => {
  it("-32602 é schema; outro código de protocolo é protocol", () => {
    expect(classifyError({ text: "x", isError: true, protocolError: { code: -32602, message: "" } })).toBe("schema");
    expect(classifyError({ text: "x", isError: true, protocolError: { code: -32603, message: "" } })).toBe("protocol");
  });
  it("texto transitório é transient; validação é schema; o resto é definitive; sucesso é null", () => {
    expect(classifyError({ text: "BCB indisponível (HTTP 503). Tente novamente.", isError: true })).toBe("transient");
    expect(classifyError({ text: "Tempo limite de 30 s esgotado", isError: true })).toBe("transient");
    expect(classifyError({ text: "Parâmetro `dataInicial` inválido: use AAAA-MM-DD", isError: true })).toBe("schema");
    expect(classifyError({ text: "Série 99999 não encontrada no SGS.", isError: true })).toBe("definitive");
    expect(classifyError({ text: "{}", isError: false })).toBeNull();
  });
  it("o padrão definitivo do TaskSet vence o transitório (a mensagem do bcb para código inexistente)", () => {
    const text = "A API do BCB não trouxe dado em 3 tentativas. É a série INEXISTENTE que fica ~30 s sem resposta. Se o código estiver certo, a origem está indisponível — repita em instantes.";
    expect(classifyError({ text, isError: true })).toBe("transient");
    expect(classifyError({ text, isError: true }, { definitive: /s[eé]rie INEXISTENTE/ })).toBe("definitive");
  });
});

describe("computeMetrics (a, b, c)", () => {
  it("(a) conta a repetição IGUAL logo depois de erro definitivo, não depois de transitório", () => {
    const calls = [
      call(1, "srv_serie", { codigo: 99999 }, true, "definitive"),
      call(2, "srv_serie", { codigo: 99999 }, true, "definitive"), // repetição ruim
      call(3, "srv_serie", { codigo: 433 }, true, "transient"),
      call(4, "srv_serie", { codigo: 433 }, false), // retry legítimo
      call(5, "srv_serie", { codigo: 99999, quantidade: 5 }, true, "definitive"), // args diferentes: não é a mesma chamada
    ];
    const m = computeMetrics(calls, 5);
    expect(m.repeatAfterDefinitiveError).toBe(1);
  });

  it("(a) chaves em ordem diferente são a MESMA chamada canônica", () => {
    const calls = [
      call(1, "t", { a: 1, b: 2 }, true, "definitive"),
      call(2, "t", { b: 2, a: 1 }, true, "definitive"),
    ];
    expect(computeMetrics(calls, 2).repeatAfterDefinitiveError).toBe(1);
  });

  it("(b) conta cada recusa de esquema", () => {
    const calls = [call(1, "t", { x: 1 }, true, "schema"), call(2, "t", { x: "1" }, true, "schema"), call(3, "t", { y: 1 }, false)];
    expect(computeMetrics(calls, 3).schemaRefusals).toBe(2);
  });

  it("(c) insistência: ≥3 chamadas com a mesma chave (código) TODAS com erro, mesmo trocando de tool", () => {
    const calls = [
      call(1, "srv_serie", { codigo: 99999 }, true, "definitive"),
      call(2, "srv_ultimos", { codigo: 99999 }, true, "definitive"),
      call(3, "srv_metadados", { codigo: 99999 }, true, "definitive"),
      call(4, "srv_serie", { codigo: 433 }, true, "definitive"),
      call(5, "srv_ultimos", { codigo: 433 }, true, "definitive"),
      call(6, "srv_metadados", { codigo: 433 }, false), // uma deu certo: não é insistência
    ];
    const m = computeMetrics(calls, 6);
    expect(m.insistenceGroups).toBe(1);
    // (a) não conta aqui: nenhuma chamada canônica se repete.
    expect(m.repeatAfterDefinitiveError).toBe(0);
    expect(m.badCalls).toBe(1);
  });

  it("(c) extrator de chave injetável pelo TaskSet", () => {
    const calls = [call(1, "t", { moedaX: "USD" }, true, "definitive"), call(2, "t", { moedaX: "USD" }, true, "definitive"), call(3, "u", { moedaX: "USD" }, true, "definitive")];
    expect(computeMetrics(calls, 3).insistenceGroups).toBe(0); // chave padrão não vê `moedaX`
    expect(computeMetrics(calls, 3, { insistenceKey: (c) => String(c.args.moedaX ?? "") || null }).insistenceGroups).toBe(1);
  });

  it("conta instáveis e erros; sem chamadas tudo zero", () => {
    const c = call(1, "t", {}, false);
    c.retrieval = [{ requests: 1, attempts: 2, anomalies: [], unstable: true }];
    expect(computeMetrics([c], 1).unstableResults).toBe(1);
    expect(computeMetrics([], 0)).toMatchObject({ badCalls: 0, calls: 0, errors: 0, steps: 0 });
  });
});

describe("gabarito mecânico", () => {
  it("extractNumbers entende pt-BR e ponto decimal", () => {
    expect(extractNumbers("Selic 10,50% e IPCA acumulado 4.832,17; dólar 5.12")).toEqual([10.5, 4832.17, 5.12]);
  });
  it("checkAnswer por número com tolerância, texto normalizado e regex", () => {
    expect(checkAnswer({ kind: "number", value: 0.56 }, "O IPCA foi 0,56% em agosto")).toBe(1);
    expect(checkAnswer({ kind: "number", value: 0.56 }, "O IPCA foi 0,60%")).toBe(0);
    expect(checkAnswer({ kind: "text", value: "Reunião 268" }, "na reuniao 268 do Copom")).toBe(1);
    expect(checkAnswer({ kind: "regex", pattern: "n[aã]o (existe|encontrad)" }, "A série não existe no SGS.")).toBe(1);
    expect(checkAnswer(undefined, "qualquer")).toBeNull();
  });
});
