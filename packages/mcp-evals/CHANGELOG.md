# Changelog — @sbissoli/mcp-evals

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões seguem
semver; em 0.x, superfície publicada que muda é minor.

## [0.2.0] — 2026-09-27

O item 3 do fio do fetch comum (comentário no dev.to, 26/09/2026): medir em SESSÃO LONGA se
o `provenance.retrieval` reduz chamadas ruins. O pacote só media turno único. Publicado em
27/09 (tag `mcp-evals-v0.2.0`) para o bcb-br-mcp depender do pacote real, não de um build local.

### Adicionado
- Subpath `./session` e bin `mcp-evals-session`: runner de sessão longa com loop client-side
  por stdio (`@modelcontextprotocol/client`, peer opcional), A/B do bloco `retrieval`
  (filtro do braço B no texto do `tool_result`, objeto ou array, mesmo formato), injeção de
  falha determinística na origem (`dist/session/fault.js` por `--import`), métricas
  mecânicas a–c por trace, juiz (d) separado, teto de gasto obrigatório com tabela de preços
  (`claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5`, `claude-fable-5-1`, `claude-opus-4-8`,
  `claude-sonnet-4-6`), NDJSON com resume por (data, sha, braço, nível), relatório Markdown
  gerado, `validateTaskSet` e modo `--dry` (servidor real, modelo dublado, contagem exata
  opcional por `count_tokens`).
- 51 testes offline novos (modelo e servidor dublados).

### Inalterado
- Entry `.` (seleção de tool em turno único): mesma API, sem dependência de runtime.

## [0.1.1] — 2026-09-14

Republicação com atestação (sem mudança de código).

## [0.1.0] — 2026-08-30

Primeira publicação: extrator de catálogo, fixtures, scorer, gate, runner de seleção.
