# Contrato de proveniência do portfólio — v1.0

| Campo | Valor |
|:--|:--|
| Status | VIGENTE — implementado por `@sbissoli/mcp-provenance` |
| Origem | Promoção do contrato v0.1 do ilostat (`ilostat/docs/03-contrato-proveniencia.md`) + envelope nível-1 do senado-br-mcp-cloudflare (`src/utils/provenance.ts`) |
| Escopo | Toda resposta de toda ferramenta de todo servidor do portfólio (adoção nas Fases 1–4) |
| Decisões de base | Decisão 5 da Fase 0 (modos `concise`/`detailed`, princípio de linguagem) |

## 1. Princípio

Todo dado retornado por um servidor carrega um **bloco de proveniência determinístico**:
a mesma consulta, sobre a mesma versão dos dados, produz bloco byte-idêntico exceto pelos
campos de timestamp. O bloco é o *wedge* do produto — é o que torna cada número citável,
auditável e reproduzível.

**Determinismo:** serialização canônica — chaves em ordem fixa (a ordem de construção nos
`render*` da lib é contrato), ausência é `null` explícito, timestamps sem milissegundos em
fuso fixo configurado por servidor. Os únicos campos que variam entre execuções idênticas
são `retrieved_at` e citação que embuta data. O determinismo vale **dentro de cada modo**.

**Segregação:** um bloco refere-se a exatamente **uma** fonte. Resposta que combine fontes
com regimes legais distintos (ex.: CC BY e CC BY-SA) carrega um bloco por fonte, e os
dados de cada fonte ficam em estruturas separadas, cada qual apontando para seu bloco —
não contaminar a saída de uma licença com as obrigações da outra. A lib aceita
`CanonicalProvenance[]` em `result()`/`footer()`; a separação das estruturas de dados é
responsabilidade do servidor. Para respostas de UMA fonte que fundem **recortes/endpoints**
diferentes, usar `field_sources` (granularidade por campo), não blocos múltiplos.

## 2. Os dois modos (decisão 5)

- **`concise` (padrão)** — piso legal + citação mínima. Exatamente 6 chaves, nesta ordem:
  `source`, `source_url`, `data_vintage`, `retrieved_at`, `citation`, `license`
  (rótulo curto: `license.id` quando existe, senão `license.name`).
- **`detailed`** — bloco canônico completo (§3). Evals de completude (camada 2) rodam em
  `detailed` para exercitar os dois caminhos.

O parâmetro técnico que expõe o modo na tool (nome, descrição) é decisão por-servidor e
vive na descrição da tool — nunca no texto voltado ao leitor.

## 3. Bloco canônico (modo `detailed`)

Ordem fixa de chaves; ausência = `null`:

```jsonc
{
  "contract_version": "1.0",
  "source":   { "name": "...", "agency": null, "database": null, "endpoint": null },
  "dataset":  { "id": null, "version": null, "name": null },
  "dimension_key": null,          // objeto {DIM: valor} na ordem das dimensões da fonte
  "data_vintage": null,           // última atualização segundo a fonte; null se não expõe
  "retrieved_at": "...",          // ISO-8601 no fuso do servidor — instante REAL da extração
  "source_url": "...",            // URL canônica que reproduz a consulta
  "api_version": null,
  "license":  { "id": null, "name": null, "url": null, "terms_url": null, "verified_at": null },
  "citation": "...",              // string de citação/atribuição pronta para uso
  "notices": [],                  // avisos da origem, verbatim
  "derived": false,
  "derivation_note": null,        // obrigatório se derived=true
  "served_from_cache": null,      // true/false quando o servidor distingue; null quando não
  "field_sources": null           // [{fields, source_url, dataset_id, data_vintage, retrieved_at}]
}
```

Invariantes validados server-side (zod + `assertSemantics`), antes de responder:
`license` exige ao menos `id` ou `name`; `derived=true` exige `derivation_note`.

### Semântica de `retrieved_at`

Instante real da ida ao upstream — preservado pela camada de cache do servidor —, nunca o
momento do build/deploy. Respostas servidas de cache mantêm o `retrieved_at` do fetch
original (é a data de extração juridicamente relevante) e podem marcar
`served_from_cache: true`. O default `new Date()` do builder só é aceitável para
catálogos estáticos mantidos em código.

### Semântica de `derived`

- `false`: dado bruto, apenas filtrado/paginado/reserializado — atribuição basta.
- `true`: qualquer transformação de valor (agregação, taxa calculada, interpolação,
  harmonização). Exige `derivation_note`. Licenças ShareAlike (ex.: UIS CC BY-SA)
  propagam-se ao derivado — refletir em `license` do bloco.
- **Caso de fronteira** (conversão de unidade/arredondamento conta como derivação?):
  decisão **por-servidor**, registrada nos docs do servidor; a lib suporta ambas.

## 4. Mapeamento obrigação legal → campo

| Obrigação típica | Campo que a satisfaz |
|:--|:--|
| "credit must be given to …" | `citation` |
| Reproduzir avisos/disclaimers da origem | `notices` |
| Marcar obra derivada | `derived` + `derivation_note` |
| URL completa + data de extração (ex.: UIS) | `citation` (embute ambos) + `source_url` + `retrieved_at` |
| Registrar licença vigente a cada fetch | `license.verified_at` + log persistente do servidor (fora da lib) |

## 5. Três canais de emissão (`result()`)

1. `structuredContent.provenance` (projeção do modo) + `structuredContent.attribution`
   (lista canônica de `source_url` distintas, alinhada à RFC `attribution` do MCP,
   modelcontextprotocol#711) — canal parseável, visível ao modelo.
2. `_meta` sob chaves namespaced (`{namespace}/provenance`, `{namespace}/attribution`,
   namespace reverse-DNS por servidor) — out-of-band, auditoria/UI, zero tokens do modelo.
3. Rodapé de texto compacto no `content` — clientes text-only. Medição no senado: embutir
   proveniência também no JSON textual custava ~3.8× mais tokens sem benefício.

## 6. Princípio de linguagem (rodapé)

O rodapé fala com o **leitor**; o schema fala com o agente. Registro formal/institucional,
idioma do servidor, sem jargão técnico nem coloquialidade. Redações fixadas (v1.0):

- **pt-BR**: "A referência completa desta informação pode ser solicitada nesta própria
  conversa." (redação da decisão 5, fixada)
- **en**: "The complete reference for this information can be requested here, in this
  same conversation." (fixada nesta sessão)

O aviso aparece uma única vez por resposta, apenas no modo `concise` — em `detailed` a
referência completa já está na resposta. Outros idiomas: passar um `LocaleSpec` próprio.

## 7. Mapeamento dos predecessores → v1.0

| Predecessor | Campo antigo | v1.0 |
|:--|:--|:--|
| senado nível-1 | `source` (string) | `source.name` |
| senado nível-1 | `dataset_id` | `dataset.id` |
| senado nível-1 | `reference_period` | `data_vintage` |
| senado nível-1 | `citation` | `citation` |
| senado nível-1 | `license` (string) | `license.name` |
| senado nível-1 | `field_sources[].reference_period` | `field_sources[].data_vintage` |
| ilostat v0.1 | `dataflow` (`agency_id`/`dataflow_id`/`version`/`name`) | `dataset` (`id` = dataflow_id; agency já está em `source.agency`) |
| ilostat v0.1 | `attribution` (string) | `citation` (o nome `attribution` fica reservado à lista de URLs da RFC #711) |
| ilostat v0.1 | `license.license_verified_at` | `license.verified_at` |

Questões que o v0.1 do ilostat deixava em aberto e o v1.0 resolve: verbosidade → modos da
decisão 5; `served_from_cache` → campo nullable padrão. Permanecem por-servidor: caso de
fronteira de `derived` (§3) e confirmações de spike (IDs de dataflow, exposição de
`data_vintage` pela fonte).
