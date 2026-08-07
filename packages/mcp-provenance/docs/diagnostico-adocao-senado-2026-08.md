# Diagnóstico de adoção — senado-br-mcp-cloudflare × contrato v1.0

| Campo | Valor |
|:--|:--|
| Data | 2026-08-07 (sessão de adoção Fase 1 no senado) |
| Veredito | **DIVERGENTE — decisor escolheu a Opção A (2026-08-07): release menor dedicado, EXECUTADO no senado v3.5.0** |
| Envelope real | `senado-br-mcp-cloudflare/src/utils/provenance.ts` (nível-1, em produção nas 67 tools) |
| Contrato | `contrato-proveniencia-v1.md` + `@sbissoli/mcp-provenance` (schema/render) |

## Diff — envelope do senado × projeções v1.0

O envelope do senado é **plano** e anterior aos modos `concise`/`detailed`. Não é
byte-igual a nenhuma das duas projeções:

| Envelope senado (atual) | v1.0 `concise` | v1.0 `detailed` |
|:--|:--|:--|
| `source` (string) | `source` (string = `source.name`) — igual | `source` vira **objeto** `{name, agency, database, endpoint}` |
| `source_url` | igual | igual (posição diferente na ordem fixa) |
| `dataset_id?` (omitido quando ausente) | **não existe** (cai fora do bloco) | `dataset.id` (objeto `{id, version, name}`, nulls explícitos) |
| `reference_period?` | **renomeado** `data_vintage`, `null` explícito | idem |
| `retrieved_at` | igual | igual |
| `citation` | igual | igual |
| `license?` (string, omitida quando ausente) | `license` (rótulo curto, `null` explícito) | `license` vira **objeto** `{id, name, url, terms_url, verified_at}` |
| `api_version?` | **não existe** | `api_version` (null explícito) |
| `field_sources?[].reference_period` | **não existe** | `field_sources[].data_vintage` (+ nulls explícitos) |
| — | — | campos novos: `contract_version`, `dimension_key`, `notices`, `derived`, `derivation_note`, `served_from_cache` |

Diferenças transversais:

1. **Renome de chave lida pelo modelo**: `reference_period` → `data_vintage` (e dentro de
   `field_sources`). Muda a resposta de todas as 67 tools.
2. **Ausência**: senado omite campos opcionais; v1.0 exige `null` explícito em ordem fixa
   de chaves (determinismo é contrato).
3. **Sem modos**: o senado emite um único envelope; v1.0 define `concise` (6 chaves) ×
   `detailed` (bloco canônico) com parâmetro por-servidor.
4. **`license` string × objeto**: no `concise` o rótulo curto coincide com a string atual
   do senado, mas no canônico é objeto com piso legal (`id` ou `name`).
5. **Rodapé**: v1.0 fixa a redação "A referência completa desta informação pode ser
   solicitada nesta própria conversa." (decisão 5); o rodapé atual do senado é
   `Fonte: X · url · extraído em … · competência …` — também mudaria.

## Consequência

A adoção **não é troca de import**: altera chaves/shape do `structuredContent.provenance`,
do espelho em `_meta` e do rodapé de texto de **todas as 67 tools** — exatamente a classe
de mudança que o harness de evals e o widget do ChatGPT App leem. Conforme o plano da
sessão (ADOCAO_SENADO_PROMPT_SESSAO.md, escopo 3): não adotar em silêncio.

## Decisão (decisor, 2026-08-07): Opção A — executada

- **Opção A (escolhida)**: release menor dedicado do senado migrando o envelope ao v1.0.
  Executada como **senado-br-mcp v3.5.0**: `src/utils/provenance.ts` virou adaptador
  pt-BR sobre `@sbissoli/mcp-provenance` (aceita os nomes de entrada históricos
  `dataset_id`/`reference_period` e emite a projeção `concise` — 6 chaves fixas, nulls
  explícitos, rodapé com a redação fixada do contrato, espelho `concise` em `_meta`;
  `attribution` inalterada). Pacote publicado no npm (`@sbissoli/mcp-provenance@0.1.0`).
  Fuso mantido: `{ offset: "-03:00", label: "horário de Brasília" }`.
- ~~Opção B: adiar para a fase do congresso-br.~~ (não escolhida)

Com isso, os TRÊS pacotes da Fase 0 estão adotados no senado e publicados no npm; o
gatilho "publicar quando o primeiro servidor adotar" está integralmente cumprido.
