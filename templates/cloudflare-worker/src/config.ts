/**
 * Identidade e tunáveis do servidor — o arquivo central que uma instância nova edita
 * (junto com wrangler.jsonc e package.json). Os demais módulos leem daqui.
 */

import type { ProvenanceContextOptions } from "@sbissoli/mcp-provenance";

export const SERVER_CONFIG = {
  /** Nome curto do servidor (handshake MCP, /status, landing). TODO(instância). */
  name: "exemplo-mcp",
  /** Versão do servidor — manter em sincronia com package.json. */
  version: "0.1.0",
  /** Título de exibição (clientes MCP mostram ao usuário). TODO(instância). */
  title: "Servidor MCP de Exemplo (template)",
  /** Uma frase: o que o servidor serve e de qual fonte. TODO(instância). */
  description:
    "Esqueleto de servidor MCP hospedado em Cloudflare Workers — template da Fase 0 do portfólio.",
  /**
   * Contato exibido na landing page. A URL raiz do Worker é o que sysadmins upstream
   * veem no User-Agent — precisa resolver para identificação humana + contato.
   */
  contactEmail: "sbissoli76@gmail.com",
  /**
   * Site do servidor no handshake (`serverInfo.websiteUrl`) e base canônica da
   * landing. É o DOMÍNIO PRÓPRIO, não o repositório: é o que o `server.json`
   * declara e o que serve o ícone. TODO(instância).
   */
  websiteUrl: "https://exemplo.sidneybissoli.com",
  /** Rota do endpoint MCP (Streamable HTTP). */
  mcpRoute: "/mcp",
  /**
   * Instruções do handshake MCP: uma linha sobre o que o servidor cobre e quando o
   * cliente NÃO deve usá-lo (critério do diretório Anthropic). TODO(instância).
   */
  instructions:
    "Servidor de exemplo do template Cloudflare. Contém apenas uma tool demonstrativa " +
    "sobre um catálogo estático fictício — não use para responder perguntas reais.",
  /**
   * Hostnames extras aceitos no header Host além dos defaults (localhost e *.workers.dev).
   * Obrigatório listar aqui o domínio próprio quando "routes" for ativado no wrangler.jsonc.
   */
  extraAllowedHostnames: [] as string[],
} as const;

/**
 * Texto da LANDING PAGE — a única superfície própria do produto, e por isso a
 * única que responde por ele numa busca. TODO(instância): trocar tudo.
 *
 * `lang` segue o PÚBLICO do produto, não a língua do código: produto de dado
 * brasileiro é `pt-BR`, produto internacional é `en`. O bloco `emOutroIdioma`
 * garante que quem chega pela outra ponta entenda o que é isto.
 */
export const LANDING = {
  /** Idioma principal da página. */
  lang: "pt-BR" as "pt-BR" | "en",
  /**
   * UMA frase, no idioma principal: o que o servidor serve e de qual fonte.
   * Vira a `meta description` e o parágrafo de abertura — até ~155 caracteres,
   * que é o que o resultado de busca mostra sem cortar.
   */
  resumo: "Servidor MCP de exemplo — template da Fase 0 do portfólio.",
  /** Perguntas REAIS que o produto responde, no idioma principal. Três ou quatro. */
  exemplos: ["“Pergunta de exemplo?”"] as readonly string[],
  /** O que ele faz de diferente. Três a cinco itens curtos. */
  destaques: ["Item de exemplo."] as readonly string[],
  /** Links canônicos. `npmUrl` e `docsUrl` são opcionais. */
  repoUrl: "https://github.com/SidneyBissoli/exemplo-mcp",
  npmUrl: "" as string,
  docsUrl: "" as string,
  /**
   * O MESMO produto no outro idioma. Não é rodapé de cortesia: é seção com
   * resumo e exemplos próprios, porque é texto indexável — e a lacuna medida
   * pelo monitor GEO era justamente a ausência dele.
   */
  emOutroIdioma: {
    lang: "en" as "pt-BR" | "en",
    resumo: "In English: this is an example MCP server.",
    exemplos: ["“Example question?”"] as readonly string[],
  },
} as const;

/**
 * Contexto de proveniência do servidor (Entregável 1). TODO(instância): trocar o
 * namespace reverse-DNS e, se for o caso, o fuso (ex.: "-03:00" para Brasília).
 */
export const PROVENANCE_OPTIONS: ProvenanceContextOptions = {
  metaNamespace: "com.exemplo.exemplo-mcp",
  locale: "pt-BR",
  timezone: "utc",
};

/**
 * Rate limit de entrada por cliente (IP), aplicado às rotas não-públicas.
 * Token bucket em memória por isolate: proteção contra abuso acidental/burst, não um
 * limite global exato (recicla com o isolate; instâncias em POPs distintos não somam).
 * Para limite global rígido, mover a contagem para um Durable Object.
 */
export const RATE_LIMIT = {
  /** Burst máximo por cliente. */
  clientBurst: 20,
  /** Reposição de tokens por segundo por cliente. */
  clientRefillPerSec: 5,
  /** Teto de buckets rastreados por isolate (evicção FIFO ao estourar). */
  maxClientBuckets: 1000,
} as const;
