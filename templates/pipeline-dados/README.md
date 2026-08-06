# Padrão de pipeline de dados (R → parquet versionado → consulta)

Receita reprodutível do portfólio (Fase 0, Entregável 4): como um dataset sai de
um pipeline R, vira **parquet versionado com metadado citável** e chega à
consulta num servidor MCP. Esta pasta **se copia, não se importa** — cada
dataset novo nasce de uma cópia dela e evolui por conta própria.

Base de metadado: **Frictionless Data Package v2** (`datapackage.json` com
`$schema` apontando o profile 2.0), gerado por **escrita direta de JSON** no
pipeline R e validado contra o profile oficial com ajv. O pacote R
`frictionless` (rOpenSci) implementa só a v1 e é centrado em CSV — **não usar**
(verificado em 06/08/2026).

Referências vivas: `sih-br-mcp` (etapa R → parquet; primeiro alvo de adoção —
6 parquet em `data/` hoje sem metadado) e
`senado-br-mcp-cloudflare/dataset/1.0.0` (embrião de dataset versionado, no
formato legado que a migração desta pasta absorve).

## Anatomia de um release de dataset

```
<dataset>/            # ex.: data/ do repositório, congelado por versão
  *.parquet | *.ndjson       # os dados
  datapackage.json           # descriptor v2 — metadado citável + integridade
  dictionary.md              # dicionário de variáveis (resource de documentação)
  CHANGELOG-dataset.md       # changelog do DADO (não do código) — modelos/
  CITATION.cff               # citação do dataset (a spec não cobre CFF) — modelos/
  LICENSE-DATA.md            # licença do DADO, separada da de código — modelos/
  SHA256SUMS                 # integridade coreutils, cobre TUDO (inclusive o descriptor)
```

Papel de cada camada de integridade: os `resources[].hash` do descriptor provam
os **dados**; o `SHA256SUMS` prova o **release inteiro**, inclusive o próprio
`datapackage.json` (que não pode conter o próprio hash).

## A receita, etapa a etapa

1. **Construir** (por-projeto): pipeline R que baixa a fonte, transforma e grava
   os cubos parquet. Referência viva: `sih-br-mcp/scripts/build-aggregations.R`.
   Regras do portfólio: agregações determinísticas, saída ordenada de forma
   estável (dois builds do mesmo corte = bytes idênticos), caveats metodológicos
   anotados na hora em que aparecem.
2. **Descrever**: ao fim do build, gerar o `datapackage.json` com `r/datapackage.R`
   (`dp_resource` → `dp_descriptor` → `dp_write`) — exemplo completo em
   `r/exemplo-build.R`, parametrizado no sih. Dependências R: `jsonlite` + `digest`.
   - Obrigatórios do portfólio (a spec só exige `resources`): `name`, `title`,
     `version`, `created` (RFC 3339 **sem milissegundos**, fuso do contrato de
     proveniência), `licenses` (a licença do DADO), `sources` (fonte original).
   - `id` = URL do version-DOI, **só quando cunhado**.
   - Todo campo fora da spec vira custom property **com namespace do dataset**
     (`sih:records`, `senado:caveats`, …) — a spec v2 permite e recomenda.
3. **Selar**: `dp_write_sha256sums()` gera o `SHA256SUMS` (verificação:
   `sha256sum -c SHA256SUMS`).
4. **Documentar**: instanciar `modelos/` (CHANGELOG-dataset, CITATION.cff,
   LICENSE-DATA) + dicionário de variáveis. O dado é **append-only**: release
   publicado nunca é reescrito; correção = nova versão (`dataset-v<X.Y.Z>`,
   convenção de bump no modelo de changelog).
5. **Validar**: `npm run validate -- <dataset>/datapackage.json` — profile
   oficial v2 (vendorado em `profiles/datapackage-2.0.json`, baixado em
   06/08/2026) + checagens do portfólio (obrigatórios acima, hash `sha256:`,
   nomes/paths únicos, timestamp canônico).
6. **Publicar e citar**: depósito com DOI (Zenodo): concept-DOI estável entre
   versões (vai no CITATION.cff), version-DOI por snapshot (vai no `id` do
   descriptor do release seguinte). Runbook de referência:
   `senado-br-mcp-cloudflare/docs/release-runbook.md`.
7. **Consultar**: o servidor MCP lê os parquet (bundle, R2 ou D1 conforme o
   projeto) e cita o dataset nas respostas via `@sbissoli/mcp-provenance`
   (`data_vintage` = versão do dataset; `citation` = a do CITATION.cff).

## Migração do formato legado do senado (por mapeamento, não reescrita)

O `dataset/1.0.0` do senado usa o nome de arquivo reservado `datapackage.json`
com formato próprio — ferramenta Frictionless que o lê falha. A migração está
implementada em `src/migrate-senado.ts` (CLI: `npm run migrate:senado --
<dir-legado> [saida.json]`, valida antes de escrever) e se aplica **no próximo
release do dataset** — o 1.0.0 publicado é congelado/append-only e não se toca.

**Decisão (06/08/2026): `release.json` é absorvido pelo descriptor** — todo
campo migra; nenhum arquivo `release.json` nos próximos releases. O que
permanece fora do descriptor: `SHA256SUMS` (auto-hash impossível),
`CHANGELOG-dataset.md` e `CITATION.cff` (a spec não cobre changelog/citação
dedicados; apontados por `<ns>:changelog`/`<ns>:citation`).

| Legado (datapackage + release.json) | Descriptor v2 |
|---|---|
| `name`, `title` | `name`, `title` |
| `releaseVersion` | `version` |
| `versionDoi` cunhado | `id` (`https://doi.org/<doi>`) |
| `versionDoi` pendente / `conceptDoi` | `<ns>:versionDoi` / `<ns>:conceptDoi` |
| `license` (string) + `licenseUrl` | `licenses[]` (`path` + `title`) |
| `source` (string) | `sources[]` (`title`) |
| `generatedAt` | `created` (sem milissegundos) |
| `files[]` + `entities[]` + SHA256SUMS dos dados | `resources[]` (`name`=entidade, `path`, `title`, `format`, `mediatype`, `bytes`, `hash: sha256:<hex>`, `<ns>:records`, `<ns>:corpusTotal`, `<ns>:hasFirstSeen`) |
| `files[]` entrada `dictionary.md` | resource de documentação `dictionary` |
| `files[]` entrada `datapackage.json` | — (fica só no SHA256SUMS) |
| `edition`, `schemaVersion`, `gitCommit`, `envelope`, `totalRecords`, `caveats` (release tem precedência), `changelog`, `citation` | `<ns>:campo` (custom properties com namespace) |
| `sample` (sempre `null`) | descartado |

## Comandos

```bash
npm run typecheck        # tsc
npm test                 # vitest — validador + migração (fixtures reais do senado)
npm run validate -- <caminho/datapackage.json>
npm run migrate:senado -- <dir-legado> [saida.json]
```

## Decisões herdadas (não reabrir sem fato novo)

- Frictionless v2 por escrita direta de JSON; pacote R `frictionless` descartado
  (só v1, centrado em CSV). Parquet é resource válido — a spec é agnóstica de formato.
- `release.json` aposentado (absorvido pelo descriptor); `SHA256SUMS`,
  `CITATION.cff` e `CHANGELOG-dataset.md` permanecem como arquivos vizinhos.
- Dado append-only com versionamento próprio (`dataset-v<X.Y.Z>`), licença do
  dado separada da de código, concept-DOI vs version-DOI (padrões herdados do
  embrião do senado).
- Etapa "construir" (fonte → parquet) fica FORA do template: é por-projeto;
  referência viva `sih-br-mcp/scripts/`.
