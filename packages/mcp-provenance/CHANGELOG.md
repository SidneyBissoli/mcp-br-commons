# Changelog — @sbissoli/mcp-provenance

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões do pacote
seguem semver; a versão do **contrato** (`contract_version`) é outra numeração, registrada
em `docs/contrato-proveniencia-v1.md` §8. Este arquivo nasceu na 0.2.0; as entradas
anteriores foram reconstruídas do histórico do repositório.

## [0.4.0] — 2026-10-08 — contrato v1.3

Superfície publicada muda → minor. **`^0.3.0` não cobre esta versão**: bump explícito em
cada servidor. **O fio NÃO muda** ao subir: o padrão continua 1.1, e quem escolheu 1.1 ou
1.2 emite os mesmos bytes de antes — no `concise`, no `detailed` e no rodapé (testes em
`tests/contract-v13.test.ts`). Muda o que os schemas declaram aceitar, então a trava de
superfície dos servidores acende.

Origem: Parte 2 das lacunas apontadas por um leitor do dev.to (comentário de 08/10): o
`concise` descartava os avisos da fonte e a marca de valor calculado, que o canônico já
tinha, e nenhum servidor dizia se o número ainda podia mudar.

### Adicionado
- **`notices`, `derived` + `derivation_note` e `revision` no `concise`** (v1.3), depois de
  `field_sources`, cada uma **só quando há o que dizer**: `notices` não vazio, `derived`
  true, `revision` conhecida. A resposta comum segue byte-idêntica à da 1.1.
- **`revision: { status, note }`** no bloco canônico e no `detailed` (v1.3; no `detailed`
  sai sempre a partir da 1.3, `null` quando não se sabe, e fica ausente nos blocos
  1.1/1.2). `status` em vocabulário fechado: `current` | `provisional` | `final`
  (`RevisionStatusSchema`); `final` só com prova da fonte (contrato §3).
- **Rodapé: uma linha por exceção** nos blocos 1.3 — dado preliminar, valor calculado pelo
  servidor, avisos da fonte —, em linguagem simples, nos dois idiomas embutidos
  (`LocaleSpec.provisionalNotice`, `derivedNotice`, `sourceNotices`, opcionais como
  `retrievalNotice`). `current`/`final` e o caso comum não ganham linha.
- `revision` aceito em `SourcePreset`.
- Exports: `contractAtLeast`, `RevisionSchema`, `RevisionStatusSchema`, tipos `Revision` e
  `RevisionStatus`, `REVISION_OBJECT_JSON_SCHEMA`.

### Mudado
- `CONTRACT_VERSIONS` ganha `"1.3"`; `LATEST_CONTRACT_VERSION` = `"1.3"`; `CONTRACT_VERSION`
  (padrão) continua `"1.1"`.
- `CONCISE_BLOCK_JSON_SCHEMA`/`ConciseBlockSchema`: as quatro chaves declaradas e não
  exigidas. `DETAILED_BLOCK_JSON_SCHEMA`/`DetailedBlockSchema`: `revision` declarada e não
  exigida; `contract_version` aceita as três versões. A descrição do bloco deixou de citar
  um número de versão (envelhecia a cada minor).

### Corrigido
- **A regra do `retrieved_at` mais antigo valeria só na 1.2.** Era cobrada com
  `contract_version === "1.2"`; na 1.3 teria se desligado em silêncio. Agora "da 1.2 em
  diante", por posição em `CONTRACT_VERSIONS` (`contractAtLeast`), e `renderConcise` usa a
  mesma comparação para o `field_sources`.

## [0.3.1] — 2026-10-08

Só documentação e licença: código e API NÃO mudam.

### Alterado

- **README em inglês** (`README.md`), o que o npm exibe; o texto em português
  passa a `LEIA-ME.md`. O npm empacota todo `README*` da pasta e pode exibir o
  traduzido, por isso o par fica fora desse prefixo.
- **`LICENSE`** (MIT) no tarball e autor com o nome completo no `package.json` (#39).

## [0.3.0] — 2026-10-06 — contrato v1.2

Superfície publicada muda → minor. **`^0.2.0` não cobre esta versão**: bump explícito em
cada servidor. **O fio NÃO muda** ao subir: a 0.3.0 emite 1.1 por padrão, byte a byte o
que a 0.2.0 emitia (teste compara com a saída da 0.2.0 publicada). Muda só o que os
schemas declaram aceitar — por isso a trava de superfície dos servidores acende.

### Adicionado
- **`field_sources` no `concise`** (8ª chave, depois de `license`), **só quando a resposta
  funde sub-fontes** — ausente, não `null`, nas demais. Origem: leitores do dev.to
  (27–28/09) notaram que uma resposta com parte em cache e parte buscada agora saía com um
  `retrieved_at` só, sem dizer qual parte veio de quando.
- **`served_from_cache` por sub-fonte** (`true`/`false`/`null`), no `concise` e no
  `detailed`, na 1.2.
- **`contractVersion` no contexto** (`"1.1"` | `"1.2"`, default `"1.1"`) e
  `ctx.contractVersion`: o servidor escolhe a versão que EMITE. O bloco canônico a carrega
  em `contract_version`, e `renderConcise`/`renderDetailed` decidem por ela — servidores
  que chamam `renderConcise(p)` direto (bcb, ibge, medical) herdam a escolha.
- Exports: `CONTRACT_VERSIONS`, `LATEST_CONTRACT_VERSION`, tipo `ContractVersion`,
  `FIELD_SOURCE_JSON_SCHEMA` (antes privado) e tipo `RenderedFieldSource`.
- `field_sources[].retrieved_at` aceita `Date` na entrada (normalizado ao fuso do contexto).
- **Regra do `retrieved_at` mais antigo** escrita no contrato (§3) e cobrada na 1.2 quando
  há `field_sources`: bloco mais novo que uma sub-fonte → `ProvenanceContractError`.

### Mudado
- `CONCISE_BLOCK_JSON_SCHEMA`/`ConciseBlockSchema`: `field_sources` declarada e não exigida.
  Item com `served_from_cache` declarada e não exigida. `DETAILED_BLOCK_JSON_SCHEMA`:
  `contract_version` passa de `const: "1.1"` a `enum: ["1.1", "1.2"]` (zod: `z.enum`).
  Descrições de `retrieved_at` e do bloco citam a regra do mais antigo.
- `CONTRACT_VERSION` continua `"1.1"`, agora com o sentido de "versão emitida por padrão";
  quem mostra a versão ao cliente (ex.: rota de status) deve ler `ctx.contractVersion`.
- Contrato §8: exceção ao `null` explícito para chave que existe para poucas respostas, e
  rollout em dois tempos (subir o pacote; depois ligar a 1.2), com o motivo: o conector
  também guarda o `outputSchema` e recusa chave desconhecida.

## [0.2.0] — 2026-09-26 — contrato v1.1

Superfície publicada muda → minor. **`^0.1.0` não cobre esta versão** (caret em 0.x fica no
minor): cada servidor precisa de bump explícito no `package.json`.

### Adicionado
- **`retrieval`** — diagnóstico de origem da chamada: `{ requests, attempts, anomalies:
  [{kind, count}], unstable } | null`. Sétima chave do modo `concise` (depois de
  `retrieved_at`, antes de `citation`) e chave do bloco canônico (`detailed`) depois de
  `served_from_cache`. `null` quando o servidor não mede; `unstable` derivado pela lib
  (`attempts > requests || anomalies.length > 0`); `anomalies` normalizado (somado por
  classe, ordem fixa do vocabulário). Vocabulário fechado de `kind`: `timeout`, `network`,
  `http_4xx`, `http_5xx`, `rate_limited`, `malformed_body`.
- Rodapé (canal 3): linha ao leitor **só quando `unstable`**, entre a licença e o aviso
  da decisão 5, em pt-BR e en. `LocaleSpec.retrievalNotice` é opcional — locale
  customizado sem ela não emite a linha.
- Exports novos: `RetrievalInputSchema`, `RetrievalAnomalyKindSchema`,
  `normalizeRetrieval`, tipos `Retrieval`, `RetrievalInput`, `RetrievalAnomaly`,
  `RetrievalAnomalyKind`.
- **JSON Schema e zod das projeções, para o `outputSchema` das tools:**
  `CONCISE_BLOCK_JSON_SCHEMA`, `DETAILED_BLOCK_JSON_SCHEMA`, `RETRIEVAL_JSON_SCHEMA`,
  `provenanceBlockJsonSchema(mode)` (JSON Schema verbatim, `additionalProperties: false`)
  e `ConciseBlockSchema`, `DetailedBlockSchema` (zod estrito). Motivo: até aqui cada
  servidor transcrevia a projeção `concise` à mão e fechava o objeto; o SDK do MCP valida
  `structuredContent` contra o `outputSchema` em runtime, então subir o pacote sem
  reescrever a transcrição derruba toda chamada (medido contra a 0.2.0: bcb 44 falhas,
  ibge 48, sih 39, medical 64). Importar daqui faz o `outputSchema` subir de contrato
  junto com o pacote; testes prendem que schema e `render*` não divergem.
- Spec: §3 "Semântica de `retrieval`" e §8 "Compatibilidade do contrato (linha 1.x)" —
  minor só acrescenta chave nullable em posição fixa; `contract_version` sobe junto.

### Alterado
- `CONTRACT_VERSION` / `contract_version`: `"1.0"` → `"1.1"`.
- Modo `concise` passa de 6 para 7 chaves. Ao subir, cada servidor precisa de: (1)
  `outputSchema` do bloco vindo do pacote (bcb `src/provenance.ts`, sih
  `src/output-schemas.ts`, ibge `src/provenance.ts`, medical `src/evals/catalog.ts`
  transcrevem à mão hoje — é o que derruba as chamadas); (2) testes que prendem a lista
  das 6 chaves (ibge `tests/provenance.test.ts`, ilo `tests/tools-data.test.ts`, senado
  `tests/utils/provenance.test.ts`) e `contract_version` `"1.0"` (ibge, ilo, senado,
  medical) — uma linha cada. uis não precisa de nada. O template `cloudflare-worker` já
  foi ajustado neste release.

## [0.1.1] — 2026-09-22

- Sem mudança de código: bump para o pacote sair com atestado de proveniência do npm
  (trusted publishing via OIDC) e `repository` declarado no manifesto.

## [0.1.0] — 2026-08-07 — contrato v1.0

- Primeira publicação: modelo canônico (zod), modos `concise` (6 chaves) e `detailed`,
  três canais (`structuredContent`, `_meta` namespaced, rodapé), locales pt-BR/en,
  fusos configuráveis, `attributionList` (RFC #711).
