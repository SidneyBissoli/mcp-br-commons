# Changelog — <título do dataset>

<!-- Modelo do portfólio (Fase 0, E4). Substitua os <placeholders> e apague os comentários. -->

Changelog do **DADO** (separado do `CHANGELOG.md`, que é do código/servidor MCP).
Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); o dataset segue
[Versionamento Semântico](https://semver.org/lang/pt-BR/) **próprio** (`dataset-v<X.Y.Z>`), distinto
da versão do pacote npm/servidor.

O dado é **append-only**: releases não reescrevem valores publicados — corrigem via nova versão.
Cada entrada amarra a **versão de schema** vigente e aponta o **version-DOI** do repositório de
depósito (ex.: Zenodo).

Convenção de bump:

- **MAJOR** — mudança de schema (a versão de schema sobe junto);
- **MINOR** — edição periódica nova (mais dado, mesmo schema);
- **PATCH** — release extraordinário (defeito de dado corrigido), com version-DOI próprio.

O **concept-DOI** é estável entre versões — é o que um paper cita para "o dataset". Cada release
tem também seu **version-DOI**. Enquanto o depósito não cunha, use `PENDENTE` nos campos.

---

## [dataset-v1.0.0] — <AAAA-MM> · Inaugural

- **schemaVersion:** `1.0.0`
- **concept-DOI:** `10.5281/zenodo.PENDENTE` · **version-DOI:** `10.5281/zenodo.PENDENTE`
- **Licença do dado:** <licença do DADO, com atribuição da fonte> (ver `LICENSE-DATA.md`;
  separada da licença de código).

### Adicionado (primeiro corte congelado)

<!-- Descreva o corpus: entidades/arquivos, contagens, série temporal, dicionário. -->

| Resource | Registros | Observação |
|---|--:|---|
| `<resource>` | <n> | <série/vintage> |

### Caveats de dado — declaração load-bearing

<!-- Todo limite metodológico que muda a interpretação do dado entra AQUI e no
     campo `<ns>:caveats` do datapackage.json — declarado, nunca silenciado. -->

- <caveat 1>

### Integridade

`SHA256SUMS` (formato coreutils) acompanha o release e cobre todos os arquivos, inclusive o
`datapackage.json` (que carrega os hashes dos resources, mas não pode conter o próprio).
Verifique com `sha256sum -c SHA256SUMS`.

---

<!-- Template para o próximo corte (não remover):

## [dataset-vX.Y.Z] — AAAA-MM · <edição>

- **schemaVersion:** `?.?.?`
- **concept-DOI:** `10.5281/zenodo.<concept>` · **version-DOI:** `10.5281/zenodo.<versão>`

### Adicionado / Alterado / Corrigido
- O que ENTROU/mudou desde o release anterior (o dado é append-only: descreva deltas, não reescritas).
-->
