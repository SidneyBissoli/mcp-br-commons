# Changelog — @sbissoli/mcp-surface

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões seguem
semver; em 0.x, superfície publicada que muda é minor (caret `^0.x` não cobre o minor
seguinte — cada servidor faz bump explícito).

**Mudar a normalização muda o sha256 de todo `surface.lock.json` que usa o pacote** —
e, pela regra da trava, obrigaria cada servidor a subir de versão sem ter mudado nada.
Mudança de normalização é major (ou minor em 0.x), com nota de migração.

## [Não lançado]

Só documentação (a SPEC é lida do GitHub, pelo link que vai no registro); código e forma
canônica NÃO mudam.

### Adicionado

- **SPEC §6.1 — conferir contra o código-fonte.** O hash do registro é declarado pelo
  publicador; quem clona o tag e roda `npm ci && npm test` prova que a superfície capturada
  DAQUELE código é a da trava e que o `server.json` publica a trava. Medido em 07/10/2026 no
  bcb-br-mcp 1.16.2, clone limpo: trava, `server.json` e registro com o mesmo
  `ff0973f91573…`. README e LEIA-ME com o comando.
- **SPEC §8 reescrita:** o limite deixa de ser "não pega publicador desonesto" e passa a dizer
  o que se prova (o que roda = o que o registro publicou, que não muda; com §6.1, = o código
  público) e o que não se prova (que uma tool declarada é benigna). Registrada como ideia, não
  feita: atestação assinada (Sigstore pelo OIDC do CI) ligando hash, commit e workflow — espera
  um host que verifique atestações.

## [0.5.0] — 2026-10-07

A impressão digital passa a ser publicada no MCP Registry, para o CLIENTE conferir. Ideia de
dois leitores do artigo do replay no dev.to: publicar os hashes com cada release e escrever a
normalização fora do código (Mike Dabydeen, comentário 3glme); publicar só o que um estranho
reproduz sem credencial (Valentina Koniukhova, 3gmgp, que fez o mesmo no worklore 0.5.1).

**Nenhum sha256 muda.** Medido em 07/10/2026: com este build, a captura ao vivo dos seis
endpoints que usam o pacote (bcb, ibge, ilo, medical, sih, uis) dá o sha travado em cada
`surface.lock.json`, no pacote e no `exemplos/verify.mjs`. Nenhum servidor precisa subir de
versão por causa desta release.

### Adicionado

- **`SPEC.md`** — a forma canônica `mcp-surface/1` como contrato: captura (protocolo fixo,
  paginação, "não servido" = `null`), normalização, serialização (RFC 8785), a parte sem
  token, onde se publica, como um host confere, o que não prova. Com vetor de teste, que os
  testes leem da própria SPEC e exigem das duas implementações.
- **`exemplos/verify.mjs`** — segunda implementação, escrita a partir da SPEC, sem
  dependência (Node 18+): `node verify.mjs <nome no registro> [versão]`. Vai no tarball.
- **`mcp-surface registro`** / `gravarMetaNoServerJson` — grava no `server.json`, sob
  `_meta["io.modelcontextprotocol.registry/publisher-provided"]["io.github.sidneybissoli/mcp-surface"]`,
  o sha da `declarada` e o mapa de quem responde sem token na configuração de produção e na
  rota publicada (`apiKeyAusente` / `POST /mcp`), com a chamada da sonda. Recusa passar do
  teto de 4096 bytes do registro.
- **`conferirMetaDoServerJson`** — para o teste da trava: o `server.json` commitado publica o
  que a trava de hoje produz.
- **`mcp-surface conferir-registro`** / `conferirRegistro` — lê a entrada da versão no
  registro (`/v0.1/servers/{nome}/versions/{versão}`) e compara com o endpoint no ar, sem ler a
  trava: a conferência de um cliente, para rodar depois do `mcp-publisher publish`.
- **`compararUnidades`** — a ordem das listas, exportada.

### Alterado

- **Listas ordenadas por unidade de código UTF-16**, não por `localeCompare`. A ordem antiga
  dependia do locale e do ICU de quem roda; a SPEC não podia ser implementada fora do
  JavaScript. As listas travadas dos seis servidores já estavam nesta ordem.
- **A captura segue `nextCursor`** em `tools/list`, `resources/list`,
  `resources/templates/list` e `prompts/list` (até 100 páginas). Antes, servidor que paginasse
  teria o sha da primeira página. Página que falha no meio = método sem resposta (`null`).
  Nenhum dos seis pagina.

## [0.4.1] — 2026-10-07

Só documentação e licença: código, API e normalização NÃO mudam.

### Alterado

- **README em inglês** (`README.md`), com glossário dos nomes da API, que seguem em
  português; o texto em português passa a `LEIA-ME.md`. O npm empacota todo `README*` da
  pasta e pode exibir o traduzido, por isso o par fica fora desse prefixo.
- **`LICENSE`** (MIT) no tarball. O `package.json` já declarava MIT, mas o texto da licença
  não acompanhava o pacote.

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
