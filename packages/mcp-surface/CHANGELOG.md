# Changelog — @sbissoli/mcp-surface

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões seguem
semver; em 0.x, superfície publicada que muda é minor (caret `^0.x` não cobre o minor
seguinte — cada servidor faz bump explícito).

**Mudar a normalização muda o sha256 de todo `surface.lock.json` que usa o pacote** —
e, pela regra da trava, obrigaria cada servidor a subir de versão sem ter mudado nada.
Mudança de normalização é major (ou minor em 0.x), com nota de migração.

## [0.1.0] — 2026-10-02

Primeira versão, extraída do molde no bcb-br-mcp (PR #49, 1.15.1). A normalização é a do
bcb byte a byte: o `surface.lock.json` travado lá confere com este pacote
(`mcp-surface verificar https://bcb.sidneybissoli.com/mcp` → `1d31ec423d36`).

### Adicionado

- `capturarSuperficie(server)` — superfície em memória (`InMemoryTransport` do SDK v2,
  JSON-RPC cru): `initialize` (instructions, capabilities, `serverInfo` sem a versão) +
  `tools/list` + `resources/list` + `resources/templates/list` + `prompts/list`.
  `normalizarSuperficie` e `impressaoDigital` (sha256 do JSON canônico).
- `conferirSecao(trava, "declarada" | "semToken", medido, versao)` — a regra: divergiu sob a
  mesma versão = falha, inclusive em modo de escrita; o sha gravado denuncia edição à mão.
- `sondaSemToken`, `medirSemToken`, `comHost`, `ipDaSonda` — quem responde sem credencial,
  medido na borda HTTP de cada servidor.
- CLI `mcp-surface`: `travar` (regrava rodando os testes em modo de escrita), `verificar`
  (endpoint no ar contra a trava, com repetição para a propagação da Cloudflare) e `replay`
  (todas as versões publicadas no npm, uma contra a anterior, e o ar contra o `/status`).
