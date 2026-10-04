import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { fromJsonSchema, McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";

import {
  autenticacaoDaTrava,
  capturarCard,
  capturarCardPorFetch,
  cardEmCache,
  montarCard,
  superficieDoCard,
} from "../src/card.js";
import { capturarSuperficie, impressaoDigital, normalizarSuperficie, type Trava } from "../src/index.js";

function servidor(comPrompt = false): McpServer {
  const s = new McpServer(
    { name: "teste", version: "3.4.5", title: "Teste", websiteUrl: "https://exemplo.org" },
    { instructions: "Use as tools com cuidado." },
  );
  s.registerTool(
    "a_tool",
    { description: "primeira", inputSchema: fromJsonSchema({ type: "object", properties: { x: { type: "string" } }, required: ["x"] }) },
    async () => ({ content: [{ type: "text", text: "ok" }] }),
  );
  s.registerResource("guia", "teste://guia", { description: "guia", mimeType: "text/plain" }, async () => ({
    contents: [{ uri: "teste://guia", text: "x" }],
  }));
  if (comPrompt) s.registerPrompt("p", { description: "um prompt" }, async () => ({ messages: [] }));
  return s;
}

describe("montarCard", () => {
  it("tem serverInfo com name e version, do initialize real", async () => {
    const card = await capturarCard(servidor());
    expect(card["serverInfo"]).toMatchObject({ name: "teste", version: "3.4.5", title: "Teste", websiteUrl: "https://exemplo.org" });
    expect(card).not.toHaveProperty("name");
    expect(card["instructions"]).toBe("Use as tools com cuidado.");
    expect((card["tools"] as { name: string }[]).map(t => t.name)).toEqual(["a_tool"]);
  });

  it("método não servido fica FORA do card; servido e vazio sai como []", async () => {
    const sem = await capturarCard(servidor());
    expect(sem).not.toHaveProperty("prompts");
    const vazio = montarCard({
      initialize: { serverInfo: { name: "x", version: "1.0.0" } },
      tools: [],
      resources: undefined,
      resourceTemplates: undefined,
      prompts: undefined,
    });
    expect(vazio["tools"]).toEqual([]);
    expect(vazio).not.toHaveProperty("resources");
  });

  it("recusa initialize sem serverInfo.name/version — card vazio é pior que 404", () => {
    const bruta = { tools: [], resources: undefined, resourceTemplates: undefined, prompts: undefined };
    expect(() => montarCard({ ...bruta, initialize: undefined })).toThrow(/serverInfo/);
    expect(() => montarCard({ ...bruta, initialize: { serverInfo: { name: "x" } } })).toThrow(/serverInfo/);
  });

  it("a volta é exata: o card normalizado tem o MESMO sha256 da superfície travada", async () => {
    for (const comPrompt of [false, true]) {
      const card = await capturarCard(servidor(comPrompt));
      const travada = await capturarSuperficie(servidor(comPrompt));
      expect(impressaoDigital(normalizarSuperficie(superficieDoCard(card)))).toBe(impressaoDigital(travada));
    }
  });

  it("controle negativo: card com uma tool a menos NÃO casa com a trava", async () => {
    const card = await capturarCard(servidor());
    const adulterado = { ...card, tools: [] };
    expect(impressaoDigital(normalizarSuperficie(superficieDoCard(adulterado)))).not.toBe(
      impressaoDigital(await capturarSuperficie(servidor())),
    );
  });
});

describe("autenticacaoDaTrava", () => {
  const trava = (toolsList: boolean) => ({
    semToken: { conteudo: { apiKeyAusente: { "POST /mcp": { initialize: true, "tools/list": toolsList } } } },
  });

  it("deriva required da medição sem token em produção", () => {
    expect(autenticacaoDaTrava(trava(true))).toEqual({ required: false });
    expect(autenticacaoDaTrava(trava(false))).toEqual({ required: true });
  });

  it("aceita a Trava tipada do próprio pacote (conteudo não tipado)", () => {
    const t: Trava = { semToken: { versao: "1.0.0", sha256: "x", conteudo: trava(true).semToken.conteudo } };
    expect(autenticacaoDaTrava(t)).toEqual({ required: false });
  });

  it("lança quando a medição não está na trava", () => {
    expect(() => autenticacaoDaTrava({})).toThrow(/semToken/);
    expect(() => autenticacaoDaTrava(trava(true), "apiKeyAusente", "POST /outra")).toThrow(/semToken/);
  });
});

describe("capturarCardPorFetch", () => {
  it("monta o mesmo card que a captura em memória, por HTTP stateless", async () => {
    const buscar = async (req: Request) => {
      const transporte = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await servidor().connect(transporte);
      return transporte.handleRequest(req);
    };
    const porFetch = await capturarCardPorFetch(buscar, "http://container/mcp");
    expect(porFetch).toEqual(await capturarCard(servidor()));
  });

  it("initialize que não responde faz lançar (o servidor decide o fallback)", async () => {
    const quebrado = async () => new Response("<html>erro</html>", { status: 502 });
    await expect(capturarCardPorFetch(quebrado, "http://container/mcp")).rejects.toThrow(/serverInfo/);
  });
});

describe("cardEmCache", () => {
  it("cacheia o primeiro sucesso e NÃO cacheia falha", async () => {
    let chamadas = 0;
    let falhar = true;
    const obter = cardEmCache(async () => {
      chamadas++;
      if (falhar) throw new Error("container frio");
      return { serverInfo: { name: "x", version: "1" } };
    });
    await expect(obter()).rejects.toThrow("container frio");
    falhar = false;
    expect(JSON.parse(await obter())).toEqual({ serverInfo: { name: "x", version: "1" } });
    await obter();
    expect(chamadas).toBe(2);
  });
});

describe("o subpath /card é seguro para Worker", () => {
  it("nenhum módulo do grafo de card.ts importa node:crypto, node:child_process, node:fs ou o Client", () => {
    const src = (f: string) => readFileSync(fileURLToPath(new URL(`../src/${f}`, import.meta.url)), "utf8");
    const visitados = new Set<string>();
    const visitar = (f: string) => {
      if (visitados.has(f)) return;
      visitados.add(f);
      const texto = src(f);
      expect(texto, f).not.toMatch(/from "node:(crypto|child_process|fs)"|@modelcontextprotocol\/client/);
      for (const [, rel] of texto.matchAll(/from "\.\/([\w-]+)\.js"/g)) visitar(`${rel}.ts`);
    };
    visitar("card.ts");
    expect([...visitados].sort()).toEqual(["captura.ts", "card.ts", "sonda.ts"]);
  });
});
