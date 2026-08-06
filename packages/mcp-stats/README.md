# @sbissoli/mcp-stats

Motor de estatísticas para tools MCP que retornam registros tabulares: o servidor
computa a distribuição completa **antes** do truncamento/paginação e devolve um bloco
compacto — sem isso, o modelo só vê uma fatia e nunca responde "qual o maior?",
"qual a média?", "como se distribui?". Zero dependências; roda em Workers e Node.

> Mantido para o meu portfólio de servidores MCP. Uso por terceiros é bem-vindo, mas o
> roadmap segue as necessidades dos meus servidores.

Origem: generalização do `src/utils/estatisticas.ts` do senado-br-mcp-cloudflare (em
produção nas 5 tools quantitativas). O locale `pt-BR` reproduz o shape do senado
byte-a-byte — a adoção lá não muda resposta nenhuma.

## Convenções fixadas (não alterar sem decisão)

- **Percentis**: interpolação linear type 7 (== `numpy.percentile` / Excel INC);
- **Desvio-padrão populacional** (÷n) — os datasets são censos, não amostras;
- **Desempate estável** em argMax/argMin/ranking: menor `tieBreak` vence;
- **Grupos** ordenados por soma decrescente, teto default de 50 com aviso;
- Núcleo em precisão total; arredondamento (default 2 casas) só na exibição.

## Uso

```ts
import {
  computeStats, computeGroupedStats,
  formatStats, formatEntries, formatGrouped, parseBRL,
} from "@sbissoli/mcp-stats";

// Dataset completo já no servidor (ex.: folha do mês, ~5 MB, valores em string pt-BR):
const e = computeStats(linhas, (r) => parseBRL(r.remuneracao_total), {
  topN: 10,
  identify: (r) => ({ nome: r.nome, cargo: r.cargo }),  // o que vai nos extremos
  tieBreak: (r) => r.sequencial,                        // desempate determinístico
});

return {
  distribuicao: formatStats(e),          // n/soma/minimo/maximo/media/mediana/desvioPadrao
  top: formatEntries(e.top),             //   + percentis ROTULADOS (o leitor nunca vê "p99")
  bottom: formatEntries(e.bottom),
};

// Agrupado (ex.: agruparPor=uf):
const g = computeGroupedStats(linhas, (r) => parseBRL(r.valor), (r) => r.uf);
return formatGrouped(g);                 // { totalGrupos, aviso?, grupos: [...] }
```

### Outro idioma / outra unidade

```ts
// Servidor en (ex.: ilostat) — chaves e rótulos em inglês, taxas com 4 casas:
formatStats(e, { locale: "en", decimals: 4, formatValue: (n) => `${n}%` });
// Locale customizado: passe um StatsLocale próprio (chaves + rótulos + formatador).
```

A separação núcleo/exibição existe porque as chaves e rótulos do bloco são lidos pelo
modelo e repassados ao leitor — devem estar no idioma do servidor; o cálculo, não.

## API

Núcleo: `computeStats`, `computeGroupedStats`, `percentile` — recebem **funções de
acesso** (`valueOf`, `identify`, `tieBreak`, `groupBy`), não nomes de campo, porque o
valor canônico costuma ser computado ou precisar de parsing.
Exibição: `formatStats`, `formatGrouped`, `formatEntries`, `labeledPercentiles`,
locales `ptBR`/`en` (`StatsLocale` customizável), `formatBRL`, `formatNumberEn`.
Parsing: `parseBRL` ("1.234,56" → 1234.56; números nativos passam inalterados).
