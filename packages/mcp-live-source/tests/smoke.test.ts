import { describe, expect, it } from "vitest";
import {
  Relatorio,
  SAIDA_FALHA,
  SAIDA_FONTE_INALCANCAVEL,
  SAIDA_OK,
  TITULO_ALHEIO,
  TITULO_FONTE_INDISPONIVEL,
  VOCABULARIO_DO_SMOKE,
  criarSmoke,
  pareceHtml,
  resumoMarkdown,
  type Destinos,
  type Sonda,
} from "../src/index.js";

/** O que a sonda encontra na origem, por URL. */
type Origem = Record<string, () => Response | Promise<Response>>;

function fetchDe(origem: Origem, chamadas: string[] = []): typeof fetch {
  return (async (entrada: string | URL | Request) => {
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    chamadas.push(url);
    const responder = origem[url];
    if (responder === undefined) throw new TypeError("fetch failed");
    return responder();
  }) as typeof fetch;
}

function coletor(): Destinos & { linhas: string[]; comandos: string[]; resumo: string[] } {
  const linhas: string[] = [];
  const comandos: string[] = [];
  const resumo: string[] = [];
  return {
    linhas,
    comandos,
    resumo,
    log: (l) => linhas.push(l),
    comando: (l) => comandos.push(l),
    env: { GITHUB_STEP_SUMMARY: "resumo.md" },
    anexar: (_, texto) => resumo.push(texto),
  };
}

const SIDRA: Sonda = {
  nome: "sidra",
  url: "https://origem.exemplo/sidra",
  aceita: (corpo) => {
    try {
      return Array.isArray(JSON.parse(corpo));
    } catch {
      return false;
    }
  },
};
const LOCALIDADES: Sonda = { nome: "localidades", url: "https://origem.exemplo/estados/33" };

const okJson = () => new Response("[1]", { status: 200, headers: { "content-type": "application/json" } });
const erroDaTool = (texto = "Não foi possível consultar o IBGE agora.") => ({
  isError: true,
  content: [{ type: "text", text: texto }],
});

describe("criarSmoke — a política do smoke pós-deploy", () => {
  it("tool ok = verificada; o resultado volta para o roteiro encadear", async () => {
    const d = coletor();
    const smoke = criarSmoke({ sondas: [SIDRA], destinos: d, fetchImpl: fetchDe({}) });
    const r = await smoke.verificar("ibge_estados", async () => ({ content: [], structuredContent: { total: 27 } }), {
      detalhe: (x) => `${(x as { structuredContent: { total: number } }).structuredContent.total} UFs`,
    });
    expect(r?.structuredContent.total).toBe(27);
    expect(d.linhas[0]).toMatch(/^ {2}\[OK {2}\] ibge_estados \(\d+ ms\) — 27 UFs$/);
    const resumo = smoke.concluir();
    expect(resumo.codigoDeSaida).toBe(SAIDA_OK);
    expect(d.comandos).toEqual([]);
  });

  it("tool com isError e a fonte sondada FORA (rede) = aviso, verde, `Fonte indisponível`", async () => {
    const d = coletor();
    const chamadas: string[] = [];
    const smoke = criarSmoke({ sondas: [SIDRA, LOCALIDADES], destinos: d, fetchImpl: fetchDe({}, chamadas) });
    const r = await smoke.verificar("ibge_estados", async () => erroDaTool());
    expect(r).toBeUndefined();
    expect(chamadas.sort()).toEqual([LOCALIDADES.url, SIDRA.url].sort());
    expect(d.linhas.some((l) => l.includes("sonda sidra: FORA (não foi alcançada (rede))"))).toBe(true);
    expect(d.linhas.at(-1)).toMatch(/^ {2}\[AVISO\] ibge_estados — fonte fora \(.*\); a tool disse: Não foi possível consultar o IBGE agora\.$/);
    const resumo = smoke.concluir();
    expect(resumo.codigoDeSaida).toBe(SAIDA_OK);
    expect(resumo.naoMedidas.map((x) => x.nome)).toEqual(["ibge_estados"]);
    expect(resumo.naoMedidas[0]!.falha.kind).toBe("network");
    expect(d.comandos).toEqual([`::warning title=${TITULO_FONTE_INDISPONIVEL}::ibge_estados`]);
    expect(d.resumo[0]).toContain("### Smoke em produção");
    expect(d.resumo[0]).toContain("0 de 1 verificadas.");
    expect(d.resumo[0]).toContain(VOCABULARIO_DO_SMOKE.naoMedidas);
  });

  it("fonte em 5xx, 429 e corpo recusado também são FORA; o motivo carrega o HTTP", async () => {
    for (const [resposta, kind, trecho] of [
      [() => new Response("bad gateway", { status: 502 }), "http_5xx", "respondeu HTTP 502"],
      [() => new Response("", { status: 429 }), "rate_limited", "limitou a taxa"],
      [() => new Response("<html>erro</html>", { status: 200 }), "malformed_body", "corpo que não é o esperado"],
    ] as const) {
      const d = coletor();
      const smoke = criarSmoke({ sondas: [SIDRA], destinos: d, fetchImpl: fetchDe({ [SIDRA.url]: resposta }) });
      await smoke.verificar("ibge_sidra", async () => erroDaTool());
      const resumo = smoke.concluir();
      expect(resumo.codigoDeSaida).toBe(SAIDA_OK);
      expect(resumo.naoMedidas[0]!.falha.kind).toBe(kind);
      expect(resumo.naoMedidas[0]!.falha.motivo).toContain(trecho);
    }
  });

  it("tool com isError e a fonte SERVINDO = a tool quebrou: vermelho, `Falha alheia à origem`, com o texto da tool", async () => {
    const d = coletor();
    const smoke = criarSmoke({ sondas: [SIDRA], destinos: d, fetchImpl: fetchDe({ [SIDRA.url]: okJson }) });
    await smoke.verificar("ibge_sidra", async () => erroDaTool("Parâmetro X inválido"));
    const resumo = smoke.concluir();
    expect(resumo.codigoDeSaida).toBe(SAIDA_FALHA);
    expect(resumo.alheias.map((x) => x.nome)).toEqual(["ibge_sidra"]);
    expect(resumo.alheias[0]!.falha.motivo).toContain("com a fonte no ar (sidra: servindo");
    expect(resumo.alheias[0]!.falha.motivo).toContain("a tool disse: Parâmetro X inválido");
    expect(d.comandos).toEqual([`::error title=${TITULO_ALHEIO}::ibge_sidra`]);
    expect(d.linhas.some((l) => l.startsWith("  [FALHA] ibge_sidra — "))).toBe(true);
  });

  it("4xx com PÁGINA HTML é página de erro de gateway/WAF, não resposta: fonte fora, aviso (pool da OIT, 22/10/2026)", async () => {
    const PAGINA_IIS = '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN"><html><head><title>403 - Forbidden</title></head><body>…</body></html>';
    const d = coletor();
    const smoke = criarSmoke({
      sondas: [SIDRA],
      destinos: d,
      fetchImpl: fetchDe({ [SIDRA.url]: () => new Response(PAGINA_IIS, { status: 403, headers: { "content-type": "text/html" } }) }),
    });
    const [estado] = await smoke.sondar();
    expect(estado!.veredito).toBe("fora");
    expect(estado!.estado).toContain("HTTP 403 com página HTML");
    await smoke.verificar("ilo_get_data", async () => erroDaTool("ILOSTAT respondeu 403"));
    const resumo = smoke.concluir();
    expect(resumo.codigoDeSaida).toBe(SAIDA_OK);
    expect(resumo.naoMedidas[0]!.falha.kind).toBe("http_4xx");
    expect(resumo.naoMedidas[0]!.falha.status).toBe(403);
    expect(d.comandos).toEqual([`::warning title=${TITULO_FONTE_INDISPONIVEL}::ilo_get_data`]);
  });

  it("4xx SEM página HTML (JSON, vazio) continua sendo resposta: de pé", async () => {
    for (const corpo of ['{"error":"not found"}', ""]) {
      const smoke = criarSmoke({
        sondas: [SIDRA],
        destinos: coletor(),
        fetchImpl: fetchDe({ [SIDRA.url]: () => new Response(corpo, { status: 404 }) }),
      });
      const [estado] = await smoke.sondar();
      expect(estado!.veredito).toBe("servindo");
    }
  });

  it("sonda COM credencial (`recusaEhFora`): 401 é a origem recusando a credencial — fora, aviso; 2xx continua servindo", async () => {
    const OMS: Sonda = {
      nome: "who-api",
      url: "https://origem.exemplo/icd/entity",
      cabecalhos: { Authorization: "Bearer x" },
      recusaEhFora: true,
    };
    const d = coletor();
    const smoke = criarSmoke({ sondas: [OMS], destinos: d, fetchImpl: fetchDe({ [OMS.url]: () => new Response("", { status: 401 }) }) });
    const [estado] = await smoke.sondar();
    expect(estado!.veredito).toBe("fora");
    expect(estado!.estado).toBe("FORA (recusou a credencial da sonda: HTTP 401)");
    await smoke.verificar("icd11_search", async () => erroDaTool("WHO API 401"));
    expect(smoke.concluir().codigoDeSaida).toBe(SAIDA_OK);

    const ok = criarSmoke({ sondas: [OMS], destinos: coletor(), fetchImpl: fetchDe({ [OMS.url]: () => new Response('{"title":"x"}', { status: 200 }) }) });
    expect((await ok.sondar())[0]!.veredito).toBe("servindo");
  });

  it("pareceHtml reconhece a página pelos primeiros bytes, não pelo content-type", () => {
    expect(pareceHtml("<!DOCTYPE html><html>")).toBe(true);
    expect(pareceHtml("  <html lang=\"en\">")).toBe(true);
    expect(pareceHtml("<HTML>")).toBe(true);
    expect(pareceHtml('{"erro":"<html> no texto"}')).toBe(false); // JSON que cita HTML é JSON: decide a abertura do documento
    expect(pareceHtml('{"error":"not found"}')).toBe(false);
    expect(pareceHtml("")).toBe(false);
    expect(pareceHtml(undefined)).toBe(false);
  });

  it("origem que RECUSA a sonda (4xx) está de pé: a falha da tool é nossa, e o estado manda conferir a URL", async () => {
    const d = coletor();
    const smoke = criarSmoke({
      sondas: [SIDRA],
      destinos: d,
      fetchImpl: fetchDe({ [SIDRA.url]: () => new Response("not found", { status: 404 }) }),
    });
    await smoke.verificar("ibge_sidra", async () => erroDaTool());
    const resumo = smoke.concluir();
    expect(resumo.codigoDeSaida).toBe(SAIDA_FALHA);
    expect(resumo.alheias[0]!.falha.motivo).toContain("recusou o pedido mínimo (HTTP 404)");
  });

  it("só as sondas nomeadas na verificação decidem: a outra fonte fora não desculpa esta tool", async () => {
    const d = coletor();
    const chamadas: string[] = [];
    const smoke = criarSmoke({
      sondas: [SIDRA, LOCALIDADES],
      destinos: d,
      fetchImpl: fetchDe({ [SIDRA.url]: okJson }, chamadas), // localidades FORA, sidra servindo
    });
    await smoke.verificar("ibge_sidra", async () => erroDaTool(), { sondas: ["sidra"] });
    expect(chamadas.length).toBeGreaterThan(0);
    expect(chamadas.every((u) => u === SIDRA.url)).toBe(true);
    expect(smoke.concluir().codigoDeSaida).toBe(SAIDA_FALHA);
  });

  it("sonda não declarada é erro de configuração, na hora", async () => {
    const smoke = criarSmoke({ sondas: [SIDRA], destinos: coletor(), fetchImpl: fetchDe({}) });
    await expect(smoke.verificar("x", async () => erroDaTool(), { sondas: ["inexistente"] })).rejects.toThrow(/não declarada/);
    expect(() => criarSmoke({ sondas: [SIDRA, SIDRA], fetchImpl: fetchDe({}) })).toThrow(/nome repetido/);
  });

  it("sem sonda nenhuma, erro de tool é vermelho: ninguém mediu a fonte", async () => {
    const d = coletor();
    const smoke = criarSmoke({ sondas: [], destinos: d, fetchImpl: fetchDe({}) });
    await smoke.verificar("tool", async () => erroDaTool());
    const resumo = smoke.concluir();
    expect(resumo.codigoDeSaida).toBe(SAIDA_FALHA);
    expect(resumo.alheias[0]!.falha.motivo).toContain("não há sonda declarada");
  });

  it("esperaErro: recusar é o certo; aceitar é defeito", async () => {
    const d = coletor();
    const smoke = criarSmoke({ sondas: [SIDRA], destinos: d, fetchImpl: fetchDe({}) });
    const r = await smoke.verificar("agruparPor inválido", async () => erroDaTool("coluna inexistente"), { esperaErro: true });
    expect(r?.isError).toBe(true);
    await smoke.verificar("argumento ausente", async () => ({ content: [] }), { esperaErro: true });
    const resumo = smoke.concluir();
    expect(resumo.capturadas).toBe(1);
    expect(resumo.alheias[0]!.falha.motivo).toBe("a tool devia recusar o pedido e respondeu sem erro");
    expect(resumo.codigoDeSaida).toBe(SAIDA_FALHA);
  });

  it("verificação que LANÇA (asserção, HTTP do endpoint) é defeito do deploy, sem sondar", async () => {
    const d = coletor();
    const chamadas: string[] = [];
    const smoke = criarSmoke({ sondas: [SIDRA], destinos: d, fetchImpl: fetchDe({}, chamadas) });
    await smoke.verificar("provenance", async () => {
      throw new Error("bloco de proveniência ausente");
    });
    expect(chamadas).toEqual([]);
    const resumo = smoke.concluir();
    expect(resumo.codigoDeSaida).toBe(SAIDA_FALHA);
    expect(resumo.alheias[0]!.falha.motivo).toBe("a verificação lançou Error: bloco de proveniência ausente");
  });

  it("dependência reconhecida vira PULOU (não medida), sem pintar nada", async () => {
    class Depende extends Error {}
    const d = coletor();
    const smoke = criarSmoke({ sondas: [SIDRA], destinos: d, fetchImpl: fetchDe({}), dependencia: (e) => e instanceof Depende });
    await smoke.verificar("fetch", async () => {
      throw new Depende("search falhou");
    });
    smoke.naoMedida("fetch 2", "depende de search");
    const resumo = smoke.concluir();
    expect(resumo.codigoDeSaida).toBe(SAIDA_OK);
    expect(resumo.naoMedidas.map((x) => x.nome)).toEqual(["fetch", "fetch 2"]);
    expect(d.linhas.filter((l) => l.startsWith("  [PULOU]"))).toHaveLength(2);
    expect(d.comandos).toEqual([`::warning title=${TITULO_FONTE_INDISPONIVEL}::fetch, fetch 2`]);
  });

  it("o disjuntor NÃO vale no smoke: toda tool falhando com a fonte fora é verde com aviso, nunca código 3", async () => {
    const d = coletor();
    const smoke = criarSmoke({ sondas: [SIDRA], destinos: d, fetchImpl: fetchDe({}) });
    for (let i = 1; i <= 7; i++) await smoke.verificar(`tool_${i}`, async () => erroDaTool());
    const resumo = smoke.concluir();
    expect(resumo.capturadas).toBe(0);
    expect(resumo.disjuntor).toBe(false);
    expect(resumo.codigoDeSaida).toBe(SAIDA_OK);
    expect(resumo.codigoDeSaida).not.toBe(SAIDA_FONTE_INALCANCAVEL);
    expect(d.comandos[0]).toBe(`::warning title=${TITULO_FONTE_INDISPONIVEL}::tool_1, tool_2, tool_3, tool_4, tool_5, tool_6, tool_7`);
  });

  it("sondar() avulso responde 'a fonte está de pé?' para um --sonda", async () => {
    const d = coletor();
    const smoke = criarSmoke({
      sondas: [SIDRA, LOCALIDADES],
      destinos: d,
      fetchImpl: fetchDe({ [SIDRA.url]: okJson, [LOCALIDADES.url]: () => new Response("x", { status: 503 }) }),
    });
    const estados = await smoke.sondar();
    expect(estados.map((e) => [e.nome, e.veredito])).toEqual([
      ["sidra", "servindo"],
      ["localidades", "fora"],
    ]);
    expect(estados[1]!.entrega?.status).toBe(503);
    expect(d.linhas).toHaveLength(2);
  });

  it("`ms` do roteiro: chamada feita fora de `fn` leva o tempo medido por quem chamou; `null` = asserção sem chamada, linha sem tempo", async () => {
    const d = coletor();
    const smoke = criarSmoke({ sondas: [SIDRA], destinos: d, fetchImpl: fetchDe({}) });
    const resultado = { content: [], structuredContent: {} }; // já obtido pelo roteiro, em 1234 ms
    await smoke.verificar("bcb_serie_ultimos 433", async () => resultado, { ms: 1234 });
    await smoke.verificar("  → tem 1 observação", async () => true, { ms: null, detalhe: () => "1" });
    await smoke.verificar("medida pelo pacote", async () => true);
    expect(d.linhas[0]).toBe("  [OK  ] bcb_serie_ultimos 433 (1234 ms)");
    expect(d.linhas[1]).toBe("  [OK  ]   → tem 1 observação — 1");
    expect(d.linhas[2]).toMatch(/^ {2}\[OK {2}\] medida pelo pacote \(\d+ ms\)$/);
    const r = smoke.relatorio.resultados;
    expect(r[0]!.ms).toBe(1234);
    expect(r[1]!.ms).toBe(0);
    // A falha também leva o tempo do roteiro.
    await smoke.verificar("falha com tempo", async () => erroDaTool(), { ms: 777 });
    expect(smoke.relatorio.resultados[3]!.ms).toBe(777);
  });

  it("fonte de pé + tool falhou: REPETE uma vez; passou na 2ª = soluço da origem (aviso, resultado volta ao roteiro)", async () => {
    const d = coletor();
    const chamadasASonda: string[] = [];
    const smoke = criarSmoke({ sondas: [SIDRA], destinos: d, fetchImpl: fetchDe({ [SIDRA.url]: okJson }, chamadasASonda) });
    let vezes = 0;
    const r = await smoke.verificar("ibge_sidra", async () => {
      vezes++;
      return vezes === 1 ? erroDaTool("SGS respondeu HTML") : { content: [], structuredContent: { n: 27 } };
    });
    expect(vezes).toBe(2);
    expect(chamadasASonda).toEqual([SIDRA.url]); // sondou só na 1ª falha
    expect((r as { structuredContent: { n: number } }).structuredContent.n).toBe(27);
    expect(d.linhas.some((l) => l.includes("repetindo a chamada (2ª de 2)"))).toBe(true);
    expect(d.linhas.at(-1)).toMatch(/^ {2}\[AVISO\] ibge_sidra \(\d+ ms\) — passou na 2ª chamada; a 1ª disse: SGS respondeu HTML$/);
    const resumo = smoke.concluir();
    expect(resumo.codigoDeSaida).toBe(SAIDA_OK);
    expect(resumo.naoMedidas[0]!.falha.motivo).toContain("soluço da origem, não defeito");
    expect(d.comandos).toEqual([`::warning title=${TITULO_FONTE_INDISPONIVEL}::ibge_sidra`]);
  });

  it("falhou nas 2 chamadas com a fonte de pé = defeito: vermelho, e o motivo conta as chamadas", async () => {
    const d = coletor();
    const smoke = criarSmoke({ sondas: [SIDRA], destinos: d, fetchImpl: fetchDe({ [SIDRA.url]: okJson }) });
    let vezes = 0;
    await smoke.verificar("ibge_sidra", async () => {
      vezes++;
      return erroDaTool(`falha ${vezes}`);
    });
    expect(vezes).toBe(2);
    const resumo = smoke.concluir();
    expect(resumo.codigoDeSaida).toBe(SAIDA_FALHA);
    expect(resumo.alheias[0]!.falha.motivo).toContain("em 2 chamadas; a tool disse: falha 2");
  });

  it("não repete: fonte FORA na sonda, `esperaErro`, verificação que lança, `ms` do roteiro, `chamadas: 1`", async () => {
    const conta = async (opcoesSmoke: Partial<Parameters<typeof criarSmoke>[0]>, fn: () => Promise<unknown>, o = {}) => {
      let vezes = 0;
      const smoke = criarSmoke({ sondas: [SIDRA], destinos: coletor(), fetchImpl: fetchDe({ [SIDRA.url]: okJson }), ...opcoesSmoke });
      await smoke.verificar("t", async () => {
        vezes++;
        return fn();
      }, o);
      return vezes;
    };
    expect(await conta({ fetchImpl: fetchDe({}) }, async () => erroDaTool())).toBe(1); // sonda FORA
    expect(await conta({}, async () => ({ content: [] }), { esperaErro: true })).toBe(1);
    expect(await conta({}, async () => { throw new Error("x"); })).toBe(1);
    expect(await conta({}, async () => erroDaTool(), { ms: 50 })).toBe(1);
    expect(await conta({}, async () => erroDaTool(), { chamadas: 1 })).toBe(1);
    expect(await conta({ chamadas: 1 }, async () => erroDaTool())).toBe(1);
    expect(await conta({ chamadas: 3 }, async () => erroDaTool())).toBe(3);
  });

  it("o texto da tool entra no motivo até o tamanho pedido, com espaços normalizados", async () => {
    const smoke = criarSmoke({ sondas: [SIDRA], destinos: coletor(), fetchImpl: fetchDe({}), tamanhoDoTexto: 12 });
    await smoke.verificar("t", async () => erroDaTool("linha um\n\n  linha dois e mais texto"));
    expect(smoke.concluir().naoMedidas[0]!.falha.motivo).toMatch(/a tool disse: linha um lin$/);
  });
});

describe("Relatorio — o vocabulário do formato", () => {
  it("o padrão continua o da captura; o smoke troca título, particípio e nota", () => {
    const captura = new Relatorio();
    const smoke = new Relatorio({ vocabulario: VOCABULARIO_DO_SMOKE });
    captura.registrarCaptura("a", 1);
    smoke.registrarCaptura("a", 1);
    expect(resumoMarkdown(captura.resumo())).toContain("### Teste contra a fonte viva\n\n1 de 1 capturadas.");
    expect(resumoMarkdown(smoke.resumo(), { vocabulario: smoke.vocabulario })).toContain("### Smoke em produção\n\n1 de 1 verificadas.");
  });

  it("registrarVeredito entra no disjuntor como registrarFalha", () => {
    const r = new Relatorio({ limiteDoDisjuntor: 2 });
    const falha = { veredito: "indisponivel" as const, motivo: "x", kind: undefined, status: undefined, url: undefined };
    r.registrarVeredito("a", falha, 1);
    expect(r.deveParar).toBe(false);
    r.registrarVeredito("b", falha, 1);
    expect(r.deveParar).toBe(true);
  });
});
