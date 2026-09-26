# Changelog — @sbissoli/mcp-provenance

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões do pacote
seguem semver; a versão do **contrato** (`contract_version`) é outra numeração, registrada
em `docs/contrato-proveniencia-v1.md` §8. Este arquivo nasceu na 0.2.0; as entradas
anteriores foram reconstruídas do histórico do repositório.

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
- Spec: §3 "Semântica de `retrieval`" e §8 "Compatibilidade do contrato (linha 1.x)" —
  minor só acrescenta chave nullable em posição fixa; `contract_version` sobe junto.

### Alterado
- `CONTRACT_VERSION` / `contract_version`: `"1.0"` → `"1.1"`.
- Modo `concise` passa de 6 para 7 chaves. **Testes de servidor que prendem a lista das 6
  chaves** (ibge `tests/provenance.test.ts`, ilo `tests/tools-data.test.ts`, senado
  `tests/utils/provenance.test.ts`) e os que prendem `contract_version` `"1.0"` (ibge,
  ilo, senado, medical) quebram de propósito ao subir — ajuste de uma linha cada. O
  template `cloudflare-worker` já foi ajustado neste release.

## [0.1.1] — 2026-09-22

- Sem mudança de código: bump para o pacote sair com atestado de proveniência do npm
  (trusted publishing via OIDC) e `repository` declarado no manifesto.

## [0.1.0] — 2026-08-07 — contrato v1.0

- Primeira publicação: modelo canônico (zod), modos `concise` (6 chaves) e `detailed`,
  três canais (`structuredContent`, `_meta` namespaced, rodapé), locales pt-BR/en,
  fusos configuráveis, `attributionList` (RFC #711).
