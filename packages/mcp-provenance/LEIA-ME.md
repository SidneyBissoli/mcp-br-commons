# @sbissoli/mcp-provenance

🇺🇸 [Read in English](https://github.com/SidneyBissoli/mcp-br-commons/blob/main/packages/mcp-provenance/README.md)

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

### Diagnóstico de origem (`retrieval`, contrato v1.1)

Como o dado foi obtido, para que o agente explique um dado instável em vez de inventar
certeza. É a 7ª chave do modo `concise` (depois de `retrieved_at`) e entra no bloco
canônico depois de `served_from_cache`. **Só o que foi medido**: servidor que não
instrumenta suas idas à origem omite o campo e ele sai `null` — nunca `{attempts: 1}`
inventado.

```ts
const p = prov.from(SENADO_LEGIS, {
  source_url,
  retrieved_at: fetchedAt,
  retrieval: {
    requests: 3,                                   // idas distintas à origem nesta chamada (fatias, páginas)
    attempts: 5,                                   // tentativas somadas (>= requests)
    anomalies: [{ kind: "timeout", count: 2 }],    // opcional; classes: timeout | network | http_4xx |
  },                                               //   http_5xx | rate_limited | malformed_body
});
// → provenance.retrieval = { requests: 3, attempts: 5, anomalies: [{kind:"timeout",count:2}], unstable: true }
```

`unstable` é derivado pela lib (`attempts > requests` ou alguma anomalia); `anomalies` é
somado por classe e ordenado no vocabulário, então a ordem de coleta não muda os bytes. No
rodapé, uma linha ao leitor aparece **só quando instável**: *"Obtenção instável: 5
tentativas para 3 consultas à origem (2 tempos de resposta esgotados)."* Semântica
completa em [`docs/contrato-proveniencia-v1.md`](docs/contrato-proveniencia-v1.md) §3;
regra de compatibilidade da linha 1.x em §8.

### O `outputSchema` da tool: importe, não transcreva

O SDK do MCP valida `structuredContent` contra o `outputSchema` em runtime. Um servidor
que fecha o bloco de proveniência com as chaves transcritas à mão
(`additionalProperties: false`) e sobe o pacote sem reescrever a transcrição **falha em
toda chamada** — foi o que a medição de 26/09/2026 mostrou em quatro servidores. Desde a
0.2.0 o pacote publica a projeção que ele mesmo emite:

```ts
import { CONCISE_BLOCK_JSON_SCHEMA, ConciseBlockSchema } from "@sbissoli/mcp-provenance";

// outputSchema em JSON Schema verbatim (bcb, sih, medical):
const outputSchema = {
  type: "object",
  properties: { total: { type: "integer" }, provenance: CONCISE_BLOCK_JSON_SCHEMA, attribution: ATTRIBUTION },
  required: ["total", "provenance", "attribution"],
};

// outputSchema em zod (ibge):
const outputSchema = z.object({ total: z.number().int(), provenance: ConciseBlockSchema, attribution: z.array(z.string()) });
```

`DETAILED_BLOCK_JSON_SCHEMA`/`DetailedBlockSchema` e `provenanceBlockJsonSchema(mode)`
cobrem o modo `detailed`. Os testes do pacote prendem que schema e `render*` não divergem.

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

### Recortes múltiplos de uma mesma fonte (`field_sources`, contrato v1.2 no `concise`)

Resposta que junta partes de endpoints ou de momentos distintos — parte do cache, parte
buscada agora — diz de onde veio cada parte. O `retrieved_at` do bloco é o **mais antigo**
entre elas (na 1.2 a lib cobra isso).

```ts
const prov = createProvenanceContext({ metaNamespace, contractVersion: "1.2" }); // ver "Rollout" abaixo
const p = prov.build({ ...base, retrieved_at: call.retrievedAt(), field_sources: [
  call.fieldSource({ fields: ["vitoria"],    source_url: urlVitoria,   filter: (u) => u === urlVitoria }),
  call.fieldSource({ fields: ["vila_velha"], source_url: urlVilaVelha, filter: (u) => u === urlVilaVelha }),
]});
// concise → ..., "license": "...", "field_sources": [
//   { "fields": ["vitoria"],    ..., "retrieved_at": "2026-10-04T15:00:00Z", "served_from_cache": true },
//   { "fields": ["vila_velha"], ..., "retrieved_at": "2026-10-05T21:30:00Z", "served_from_cache": false } ]
```

`call.fieldSource` vem do `@sbissoli/mcp-upstream` ≥ 0.4.0. Resposta sem fusão não leva a
chave (ausente, não `null`).

**Rollout em dois tempos.** A 0.3.0 emite a versão **1.1 por padrão** — byte a byte o
que a 0.2.0 emitia — e os schemas publicados aceitam 1.1 e 1.2. Subir o pacote só muda
o que o `outputSchema` declara; o fio fica igual. Ligar `contractVersion: "1.2"` é um
segundo passo, depois que os conectores renovaram o schema: um conector que guardou o
schema antigo recusa a chave que não conhece (contrato §8).

### Avisos, valores calculados e revisão (contrato v1.3)

O que o bloco canônico sempre teve e o `concise` descartava passa a chegar ao cliente, cada
chave **só quando há o que dizer**: `notices` (avisos que a fonte publica junto com o dado,
verbatim), `derived` + `derivation_note` (o servidor calculou o valor) e `revision` — se o
número ainda pode mudar:

```ts
const prov = createProvenanceContext({ metaNamespace, contractVersion: "1.3" });
const p = prov.build({ ...base, revision: { status: "provisional", note: "competências de 2026 ainda abertas" } });
// concise → ..., "license": "...", "revision": { "status": "provisional", "note": "competências de 2026 ainda abertas" }
// rodapé  → ... "Dados preliminares: a fonte ainda pode completá-los ou corrigi-los. Competências de 2026 ainda abertas."
```

`revision.status` é vocabulário fechado: `current` (versão vigente na fonte, que pode
revisá-la), `provisional` (sabidamente incompleto ou sujeito a mudança) e `final` (não muda
mais — só quando a fonte declara, ou quando o dado vem de arquivo congelado cuja versão a
resposta nomeia). Ausente = o servidor não sabe dizer; nunca chutar. `revision` pode ir num
`SourcePreset`, porque costuma ser fixa por fonte.

O rodapé de texto ganha **uma linha por exceção** (dado preliminar, valor calculado pelo
servidor, aviso da fonte) e nada no caso comum, para que o modelo que só lê o texto também
saiba que um ano está incompleto. Mesmo rollout em dois tempos da 1.2: subir para a 0.4.0
não muda o fio; `contractVersion: "1.3"` liga.

## Regras que a lib impõe (server-side, antes de responder)

- `license` com ao menos `id` ou `name` (piso legal);
- `derived: true` exige `derivation_note`;
- chaves em ordem fixa e ausência como `null` explícito (determinismo byte-a-byte por modo);
  as exceções são as chaves do `concise` posteriores à 1.1 (`field_sources`, `notices`,
  `derived`, `derivation_note`, `revision`), ausentes quando não há o que dizer;
- `revision.status` dentro do vocabulário fechado;
- da 1.2 em diante, `retrieved_at` do bloco não pode ser mais novo que o de nenhuma sub-fonte;
- timestamps ISO-8601 sem milissegundos, normalizados ao fuso configurado (datas puras
  passam intactas — nunca inventa horário num vintage).

## API

`createProvenanceContext(options)` → `{ build, from, render, footer, result, metaKeys }`.
Peças soltas também exportadas: `CanonicalProvenanceSchema`, `renderConcise`,
`renderDetailed`, `attributionList`, `provenanceFooter`, `toCanonicalIso`, locales
`ptBR`/`en`.
