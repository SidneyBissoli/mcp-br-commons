# Changelog — @sbissoli/mcp-surface

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões seguem
semver; em 0.x, superfície publicada que muda é minor (caret `^0.x` não cobre o minor
seguinte — cada servidor faz bump explícito).

**Mudar a normalização muda o sha256 de todo `surface.lock.json` que usa o pacote** —
e, pela regra da trava, obrigaria cada servidor a subir de versão sem ter mudado nada.
Mudança de normalização é major (ou minor em 0.x), com nota de migração.

## [0.4.0] — 2026-10-04

A normalização NÃO muda. Minor porque a superfície publicada cresce (subpath novo); o
`/card` da 0.3.0 continua com a mesma API, então quem já o usa não precisa mudar nada.

### Adicionado

- **`@sbissoli/mcp-surface/card/http`** — tudo do `/card` MENOS `capturarCard`, sem o SDK
  em valor no grafo de imports. Medido em 04/10/2026 na adoção pelo sih-br-mcp, cuja borda
  só captura por HTTP o container: o `/card` puxava o `InMemoryTransport` e, com ele, o SDK
  inteiro (zod, core, `@cfworker/json-schema`), e a borda foi de 31 para 156 KiB gzip.
  `sideEffects: false` não resolve, porque o próprio SDK não o declara. Com `/card/http`
  (e o `semToken` importado por nome), a mesma borda fica em 32 KiB gzip. Nos servidores
  que montam o `McpServer` no Worker o SDK já está no bundle, e o `/card` não custa nada.

### Mudado (interno)

- A captura em memória saiu de `captura.ts` para `captura-memoria.ts` (o único módulo da
  captura com o SDK em valor); `captura.ts` só importa o TIPO do transporte. `card.ts`
  passa a reexportar `card-http.ts` e acrescentar `capturarCard`. Teste novo confere que o
  grafo de `/card/http` não importa o SDK em valor, com controle negativo no grafo de
  `/card`.

## [0.3.0] — 2026-10-04

A normalização NÃO muda: o sha256 de todo `surface.lock.json` continua o mesmo. Minor
porque a superfície publicada do pacote cresce (subpath novo); quem quiser o card faz o
bump explícito para `^0.3.0`.

### Adicionado

- **`@sbissoli/mcp-surface/card`** — o `/.well-known/mcp/server-card.json` derivado da
  mesma captura que a trava normaliza. Em 04/10/2026, 4 dos 7 servidores serviam o card
  por um `card.ts` copiado e 3 respondiam 404; os quatro que serviam publicavam
  `name`/`version` soltos na raiz, enquanto a forma documentada pela Smithery exige
  `serverInfo: { name, version }`. `montarCard` / `capturarCard` / `capturarCardPorFetch`
  montam o card com `serverInfo` do `initialize` real; `superficieDoCard` faz a volta, para
  o teste do servidor provar que o card tem o MESMO sha256 da seção `declarada`;
  `autenticacaoDaTrava` deriva `authentication.required` da seção `semToken`;
  `cardEmCache` guarda o primeiro sucesso por isolate. Seguro para Worker, com teste que
  percorre o grafo de imports do subpath.

### Mudado (interno)

- A captura crua (`initialize` + as quatro listas) saiu de `superficie.ts` e de
  `memoria.ts` para `captura.ts`, que não importa `node:crypto` nem
  `node:child_process`. `capturarPor` e `capturarSuperficie` passam a normalizar essa
  captura: mesma ordem de pedidos, mesmo `clientInfo`, mesmo resultado. A raiz do pacote
  exporta os mesmos nomes de antes.

## [0.2.1] — 2026-10-04

A normalização NÃO muda. Patch: a API de `/cliente` é a mesma; os controles negativos
ficam mais fortes, e os servidores herdam isso pelo caret `^0.2.0`.

### Corrigido

- **A troca de tipo cobria UM campo só.** `quebrasDoSchema` trocava o tipo do primeiro
  obrigatório tipado. No ilo-mcp-server esse campo era um objeto (`dataflow`), e os
  escalares ficavam sem prova, o que obrigou a escrever `rows_count` como quebra extra à
  mão. Agora a troca vale para CADA obrigatório com `type` declarado.
- **O campo anulável não era trocado.** `type: ["string", "null"]` (lista) não gerava
  quebra, e é justamente a classe do defeito que o circuito existe para pegar. O valor
  errado agora é o primeiro de texto, número, booleano, lista e objeto que nenhum dos tipos
  declarados aceita.
- **As quebras rodam em paralelo.** Com uma troca por obrigatório, em série,
  `loinc_details` do medical-terminologies-mcp passava dos 5 s do vitest sob a carga da
  suíte. Cada quebra já tinha servidor e conexão próprios. A ordem dos vereditos não muda,
  e a armadilha continua sendo o último.

Conferido contra os sete servidores com o build local antes de publicar: todos verdes.

## [0.2.0] — 2026-10-04

A normalização NÃO muda: todo `surface.lock.json` continua conferindo. Minor porque a
superfície publicada do pacote cresce (subpath novo).

### Adicionado

- **`@sbissoli/mcp-surface/cliente`**: o teste com forma de cliente, que nasceu no
  ilo-mcp-server 1.3.0 (ideia de leitor, https://dev.to/arhancanli/comment/3g4i4).
  `conectarComoCliente` (transporte em memória com JSON no fio), `chamarComoCliente`
  (`tools/list` antes do `tools/call`, lança se o `Client` reprovar ou vier `isError`),
  `controlesNegativos` (quebras derivadas do `outputSchema` listado, mais a armadilha do
  `tools/list` ausente) e `quebrasDoSchema`. `@modelcontextprotocol/client` entra como peer
  OPCIONAL; a raiz do pacote continua sem o `Client`, que o Worker não pode carregar.

## [0.1.1] — 2026-10-02

Achados da adoção nos irmãos, no mesmo dia. A normalização NÃO muda: todo
`surface.lock.json` travado com a 0.1.0 continua conferindo.

### Adicionado

- `verificar --perfil <chave>` (`OpcoesVerificar.perfil`): servidor com uma superfície por
  rota (senado-br-mcp: `full` em `/mcp`, `openai-app` em `/mcp/openai-app-v2`) trava a
  `declarada` como mapa `{ perfil: superfície }`, e o endpoint é conferido contra a chave
  que ele serve.
- `linhaDeCompatibilidade(versao)`.

### Corrigido

- **O replay acusava como quebra fora de major uma mudança incompatível em minor de 0.x**,
  que o semver permite (ilo-mcp-server 0.5.0 → 0.6.0, `filters` passou a obrigatório).
  Em 0.x a linha de compatibilidade é o minor.
- O replay chamava `npm` com argumentos em array e `shell: true` no Windows — o DEP0190 do
  Node 24 (argumentos concatenados sem escape). Agora a linha vai montada e citada.
- `bin` sem o `./`, que o npm corrigia sozinho a cada publicação com aviso.

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
