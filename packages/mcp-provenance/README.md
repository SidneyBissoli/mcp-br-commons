# @sbissoli/mcp-provenance

Contrato de proveniência para servidores MCP: todo retorno de tool carrega **fonte,
endpoint, período, data de extração e licença**, com serialização determinística, em dois
modos — `concise` (padrão, piso legal) e `detailed` (bloco canônico completo).

> Mantido para o meu portfólio de servidores MCP. Uso por terceiros é bem-vindo, mas o
> roadmap segue as necessidades dos meus servidores.

Especificação completa: [`docs/contrato-proveniencia-v1.md`](docs/contrato-proveniencia-v1.md).

## Uso

```ts
import { createProvenanceContext } from "@sbissoli/mcp-provenance";

// 1. Uma vez, na inicialização do servidor:
const prov = createProvenanceContext({
  metaNamespace: "com.sidneybissoli.senado",   // chaves de _meta (reverse-DNS, estável)
  locale: "pt-BR",                             // idioma do rodapé ("pt-BR" | "en" | LocaleSpec)
  timezone: { offset: "-03:00", label: "horário de Brasília" }, // default: "utc"
  defaultMode: "concise",                      // default: "concise"
});

// 2. Presets por fonte upstream (opcional):
const SENADO_LEGIS = {
  source: "Senado Federal — Dados Abertos (Legislativo)",
  citation: "Fonte: Senado Federal, Portal de Dados Abertos (Legislativo) — legis.senado.leg.br/dadosabertos.",
  license: "Dados Abertos do Senado Federal — uso livre com atribuição da fonte.",
};

// 3. Em cada tool:
const p = prov.from(SENADO_LEGIS, {
  source_url: `${baseUrl}/processo.json`,
  retrieved_at: fetchedAt,        // instante REAL da extração (preservado pelo cache)
  data_vintage: "2025",
});
return prov.result(shapedData, p);                      // modo concise (default)
return prov.result(shapedData, p, { mode: "detailed" }); // bloco canônico completo
```

`result()` emite os três canais: `structuredContent` (bloco + `attribution` RFC #711,
visível ao modelo), `_meta` namespaced (auditoria/UI, zero tokens) e rodapé de texto
compacto para clientes text-only.

### Fonte estruturada (ex.: ILOSTAT/SDMX)

```ts
const p = prov.build({
  source: { name: "ILOSTAT", agency: "ILO", database: "ILOSTAT", endpoint: "https://sdmx.ilo.org/rest" },
  dataset: { id: "DF_UNE_DEAP_SEX_AGE_RT", version: "1.0", name: "Unemployment rate by sex and age" },
  dimension_key: { REF_AREA: "BRA", SEX: "SEX_F", TIME_PERIOD: "2024" },
  data_vintage: "2026-06-15",
  retrieved_at: fetchedAt,
  source_url: canonicalRestUrl,
  license: { id: "CC-BY-4.0", url: "https://creativecommons.org/licenses/by/4.0/", verified_at: "2026-08-04" },
  citation: "International Labour Organization, ILOSTAT, https://ilostat.ilo.org/data/, accessed 2026-08-04.",
});
```

### Multi-fonte (segregação de licenças)

```ts
// Um bloco POR FONTE; dados de cada fonte em estruturas separadas apontando para o seu bloco.
return prov.result({ ilostat: dadosIlo, uis: dadosUis }, [pIlo, pUis]);
```

### Recortes múltiplos de uma mesma fonte

```ts
const p = prov.build({ ...base, field_sources: [
  { fields: ["relatoria"], source_url: urlRelatoria, retrieved_at: fetchedAtRelatoria },
]});
```

## Regras que a lib impõe (server-side, antes de responder)

- `license` com ao menos `id` ou `name` (piso legal);
- `derived: true` exige `derivation_note`;
- chaves em ordem fixa e ausência como `null` explícito (determinismo byte-a-byte por modo);
- timestamps ISO-8601 sem milissegundos, normalizados ao fuso configurado (datas puras
  passam intactas — nunca inventa horário num vintage).

## API

`createProvenanceContext(options)` → `{ build, from, render, footer, result, metaKeys }`.
Peças soltas também exportadas: `CanonicalProvenanceSchema`, `renderConcise`,
`renderDetailed`, `attributionList`, `provenanceFooter`, `toCanonicalIso`, locales
`ptBR`/`en`.
