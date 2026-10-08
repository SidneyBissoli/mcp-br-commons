# Contrato de proveniência do portfólio — linha 1.x (vigente: v1.3)

| Campo | Valor |
|:--|:--|
| Status | VIGENTE — v1.3 implementada por `@sbissoli/mcp-provenance` ≥ 0.4.0, que emite 1.1 por padrão e 1.2 ou 1.3 quando o servidor escolhe (`contractVersion`); v1.2 = 0.3.x, v1.1 = 0.2.x, v1.0 = 0.1.x |
| Histórico | v1.0 (ago/2026): piso legal, 6 chaves no `concise` · v1.1 (26/09/2026): campo `retrieval` — diagnóstico de origem — 7ª chave do `concise`; regra de compatibilidade (§8) · **v1.2 (06/10/2026): `field_sources` no `concise`, só quando a resposta funde sub-fontes; `served_from_cache` por sub-fonte; regra do instante mais antigo escrita (§3); rollout em dois tempos (§8)** · **v1.3 (08/10/2026): `notices`, `derived`/`derivation_note` e `revision` no `concise`, cada uma só quando há o que dizer; `revision` com vocabulário fechado (§3); rodapé com uma linha por exceção (§6)** |
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

- **`concise` (padrão)** — piso legal + citação mínima + diagnóstico de origem. Exatamente
  7 chaves, nesta ordem: `source`, `source_url`, `data_vintage`, `retrieved_at`,
  `retrieval`, `citation`, `license` (rótulo curto: `license.id` quando existe, senão
  `license.name`). Na v1.0 eram 6 — `retrieval` entrou na v1.1 (§3, "Semântica de
  `retrieval`"), e entrou no `concise` de propósito: é o modo que TODO servidor serve por
  padrão, logo o único em que o agente de fato vê o campo. (`served_from_cache`, que só
  existe em `detailed`, é o exemplo do que acontece com um campo de dificuldade que fica
  fora do `concise`: nenhum agente o lê.)

  **v1.2:** uma 8ª chave, `field_sources`, depois de `license` — **presente só quando a
  resposta funde sub-fontes** e ausente (não `null`) nas demais (§3, "Semântica de
  `field_sources`"; a exceção à regra do `null` está justificada em §8). Mesmo motivo do
  `retrieval`: o `detailed` já tinha `field_sources` desde a v1.0 e nenhum agente o via.

  **v1.3:** depois de `field_sources`, nesta ordem, `notices` (só quando não vazio),
  `derived` + `derivation_note` (só quando `derived=true`) e `revision` (só quando o
  servidor sabe dizer). Mesmo motivo outra vez: `notices` e `derived` existiam no canônico
  desde a v1.0 — a OIT publicando "quebra na série", o servidor calculando uma taxa — e o
  `concise` os descartava. A resposta comum (sem aviso, sem cálculo, sem revisão conhecida)
  segue byte-idêntica à da 1.1.
- **`detailed`** — bloco canônico completo (§3). Evals de completude (camada 2) rodam em
  `detailed` para exercitar os dois caminhos.

O parâmetro técnico que expõe o modo na tool (nome, descrição) é decisão por-servidor e
vive na descrição da tool — nunca no texto voltado ao leitor.

## 3. Bloco canônico (modo `detailed`)

Ordem fixa de chaves; ausência = `null`:

```jsonc
{
  "contract_version": "1.3",      // a versão que o servidor emite (contractVersion do contexto)
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
  "retrieval": null,              // v1.1 — {requests, attempts, anomalies, unstable}; null quando não medido
  "field_sources": null,          // [{fields, source_url, dataset_id, data_vintage, retrieved_at,
                                  //   served_from_cache (v1.2)}]
  "revision": null                // v1.3 — {status, note}; null quando o servidor não sabe dizer.
                                  //   Ausente (não null) nos blocos 1.1/1.2, para não mudar o fio deles
}
```

Invariantes validados server-side (zod + `assertSemantics`), antes de responder:
`license` exige ao menos `id` ou `name`; `derived=true` exige `derivation_note`;
`retrieval.attempts >= retrieval.requests`, ambos ≥ 1, `anomalies[].kind` no vocabulário
fechado; `revision.status` no vocabulário fechado.

### Semântica de `retrieval` (v1.1)

**Pergunta que responde:** *como* este dado foi obtido da origem — para que o agente
explique um dado instável em vez de inventar certeza. Sem o campo, um sucesso obtido na
terceira tentativa depois de duas páginas HTML é indistinguível de um sucesso limpo.

```jsonc
"retrieval": {
  "requests": 3,                  // idas DISTINTAS à origem que compõem esta resposta (fatias, páginas)
  "attempts": 5,                  // tentativas somadas, incluindo as repetidas; >= requests
  "anomalies": [                  // por classe, somadas; ordem FIXA (a do vocabulário); [] se nenhuma
    { "kind": "timeout", "count": 2 }
  ],
  "unstable": true                // DERIVADO: attempts > requests || anomalies.length > 0
}
```

- **Agregado por CHAMADA da tool**, não por ida à origem: uma chamada que fatia a
  consulta em N pedidos conta `requests: N`. Um bloco, um `retrieval`.
- **É medição real, como `retrieved_at`.** Servidor que não instrumenta suas idas à origem
  passa `null` — nunca `{ "requests": 1, "attempts": 1 }` inventado. `null` significa "não
  sei", não "foi limpo". Um `retrieval` não-nulo é uma afirmação sobre o que aconteceu.
- **Resposta servida de cache:** o campo descreve a extração que produziu o dado. O
  servidor que guarda o `retrieval` junto com o `retrieved_at` do fetch original o
  reproduz; o que não guarda passa `null`. Nunca zerar (`requests: 0` é inválido).
- **Vocabulário fechado de `kind`** (mesmo nome em todos os servidores; a ordem é a de
  serialização):

  | `kind` | Quando |
  |:--|:--|
  | `timeout` | a origem não respondeu no prazo do servidor |
  | `network` | falha de transporte (conexão recusada, reset, DNS) |
  | `http_4xx` | a origem recusou o pedido (exceto 429) |
  | `http_5xx` | a origem falhou |
  | `rate_limited` | 429 ou limite local de vazão atingido |
  | `malformed_body` | a origem respondeu 200 com corpo que não é o esperado (HTML, JSON inválido, truncado) |

  Um erro que encerra a chamada NÃO gera `retrieval` — o campo só existe no SUCESSO. A
  anomalia registrada é a que foi superada (por repetição, por outra fatia, por fallback).
- **`unstable` é derivado pela lib**, nunca informado pelo servidor: `attempts > requests`
  (houve repetição) OU há anomalia (mesmo sem repetir — ex.: um `malformed_body` detectado
  e contornado na mesma tentativa). O servidor passa `{requests, attempts, anomalies?}`; a
  lib soma `anomalies` por classe, ordena no vocabulário e calcula `unstable`. Assim a
  ordem de coleta no servidor não altera os bytes do bloco.
- **Rodapé (canal 3):** só quando `unstable` é `true`, uma linha ao leitor, entre a
  licença e o aviso da decisão 5, em linguagem do leitor (§6): *"Obtenção instável: 5
  tentativas para 3 consultas à origem (2 tempos de resposta esgotados)."* Obtenção limpa
  ou não medida não gera linha — o leitor não vê ruído; o agente já tem o bloco.
- **O que o campo NÃO é:** não é telemetria de latência, não é classificação do erro
  final (isso é da resposta de erro), não substitui `served_from_cache`.

### Semântica de `retrieved_at`

Instante real da ida ao upstream — preservado pela camada de cache do servidor —, nunca o
momento do build/deploy. Respostas servidas de cache mantêm o `retrieved_at` do fetch
original (é a data de extração juridicamente relevante) e podem marcar
`served_from_cache: true`. O default `new Date()` do builder só é aceitável para
catálogos estáticos mantidos em código.

**Resposta que junta acessos de momentos distintos** (parte do cache, parte buscada agora;
ou duas leituras de cache de idades diferentes): `retrieved_at` é o **mais antigo** entre
eles. É a afirmação honesta para um instante só — "nada aqui é mais velho que isto" — e é
o que `call.retrievedAt()` do `@sbissoli/mcp-upstream` calcula. Até a v1.1 a regra morava
só no código do coletor; servidores que escolhiam uma chave de cache à mão reportavam, na
prática, o acesso mais NOVO. Na v1.2 a lib cobra a regra quando há `field_sources`:
`retrieved_at` do bloco mais novo que o de alguma sub-fonte é erro de contrato (só na 1.2,
para que subir o pacote não derrube servidor que ainda escolhe à mão).

### Semântica de `field_sources` (v1.2 no `concise`)

**Pergunta que responde:** *qual parte* da resposta veio de onde, e de quando. Exemplo:
"compare a população de Vitória e de Vila Velha" — Vitória estava no cache desde ontem,
Vila Velha foi buscada agora. Com um `retrieved_at` só, o leitor lê "extraído ontem" e
supõe que tudo é de ontem.

```jsonc
"field_sources": [
  { "fields": ["vitoria"],    "source_url": "...", "dataset_id": null, "data_vintage": null,
    "retrieved_at": "2026-10-04T15:00:00Z", "served_from_cache": true },
  { "fields": ["vila_velha"], "source_url": "...", "dataset_id": null, "data_vintage": null,
    "retrieved_at": "2026-10-05T21:30:00Z", "served_from_cache": false }
]
```

- **Presente só quando a resposta funde sub-fontes** (endpoints, recortes ou leituras de
  momentos distintos). Resposta de uma origem só não leva a chave. `[]` conta como ausência.
- **`fields`** nomeia os campos do payload que a sub-fonte produziu — o servidor sabe; o
  coletor não. **`served_from_cache`** (v1.2): `true` se a sub-fonte veio do cache do
  servidor (o `retrieved_at` é o da extração original), `false` se buscada nesta chamada,
  `null` se o servidor não distingue — nunca inventado.
- **O `retrieved_at` do bloco é o mais antigo entre as sub-fontes** (parágrafo acima).
- Não substitui blocos múltiplos: sub-fontes de **regimes legais distintos** continuam em
  blocos separados (§1). `field_sources` é para UMA fonte que funde recortes.
- `@sbissoli/mcp-upstream` ≥ 0.4.0 monta o item a partir dos acessos da chamada
  (`call.fieldSource({ fields, source_url, filter })`); o servidor só diz quais campos
  vêm de quais URLs.

### Semântica de `derived`

- `false`: dado bruto, apenas filtrado/paginado/reserializado — atribuição basta.
- `true`: qualquer transformação de valor (agregação, taxa calculada, interpolação,
  harmonização). Exige `derivation_note`. Licenças ShareAlike (ex.: UIS CC BY-SA)
  propagam-se ao derivado — refletir em `license` do bloco.
- **Caso de fronteira** (conversão de unidade/arredondamento conta como derivação?):
  decisão **por-servidor**, registrada nos docs do servidor; a lib suporta ambas.

### Semântica de `revision` (v1.3)

**Pergunta que responde:** este número ainda pode mudar? Exemplos: o IBGE revisa o PIB de
um trimestre já divulgado; o ano corrente do SIH ainda recebe internações por meses; uma
versão publicada de uma tabela de códigos não muda mais.

```jsonc
"revision": { "status": "provisional", "note": "competências de 2026 ainda abertas" }
```

- **`status`, vocabulário FECHADO e comum** (como as classes de anomalia de `retrieval`):
  - `current` — a versão vigente na fonte; a fonte pode revisá-la depois;
  - `provisional` — preliminar: sabidamente incompleta ou sujeita a mudança. Quem compara
    um período `provisional` com um fechado vê uma queda que não houve;
  - `final` — não muda mais. **Só com prova:** (a) a fonte declara, valor a valor, ou
    (b) o dado vem de um arquivo congelado cuja versão a resposta nomeia. Não ter visto o
    número mudar NÃO é prova — uma revisão pode vir na edição seguinte. Na dúvida,
    `current`: errar por cautela custa ao leitor um cuidado a mais; um `final` errado o faz
    confiar num número que vai mudar.
- **`note`**: o específico da fonte (o que revisa, quando, por quê), em texto humano;
  `null` quando não há o que acrescentar.
- **Ausente / `null`** = o servidor não sabe dizer. Nunca chutar.
- O `status` vale para o bloco. Fonte que marca a situação por observação (o `OBS_STATUS`
  da OIT, por exemplo) segue reproduzindo-a em `notices`, verbatim.

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

**Linhas de exceção.** Só a exceção ganha linha; o caso comum não acrescenta nada:

- v1.1, obtenção instável (`retrieval.unstable`): "Obtenção instável: 3 tentativas para
  2 consultas à origem (1 tempo de resposta esgotado)."
- v1.3, por bloco, nesta ordem, só em blocos 1.3 ou mais novos:
  - `revision.status = provisional`: "Dados preliminares: a fonte ainda pode completá-los
    ou corrigi-los." + a `note`, quando há;
  - `derived = true`: "Valores calculados pelo servidor a partir dos dados da fonte: " +
    `derivation_note`;
  - `notices` não vazio: "Avisos da fonte: " + os avisos, verbatim, separados por "; ".

`current` e `final` não ganham linha: "pode ser revisado" é o normal de quase todo dado
público e já está nas instruções de cada servidor; repetido em toda resposta, vira ruído
que o leitor aprende a ignorar. As linhas da v1.3 existem porque, em muitos clientes, o
modelo lê só o texto: sem elas, num servidor que responde em Markdown com rodapé, ele
nunca saberia que o ano é preliminar ou que a série tem quebra. (Servidor que serializa o
payload JSON inteiro no texto já entrega o bloco ao modelo; ali a linha é redundante, mas
não custa nada quando não há exceção.)

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

## 8. Compatibilidade do contrato (linha 1.x)

A v1.0 não tinha regra para acrescentar campo; esta é a regra, escrita na primeira vez em
que foi preciso (v1.1).

- **Minor (1.x → 1.x+1) só ACRESCENTA.** Campo novo é sempre nullable, `null` quando não
  informado, e tem posição fixa declarada aqui (a ordem é contrato — §1). Não se renomeia,
  não se remove, não se muda tipo, não se reordena o que já existe. Quem lê o bloco da
  v1.0 continua achando as suas chaves nos mesmos lugares.
- **`contract_version` sobe junto** com a chave nova (`"1.0"` → `"1.1"`), para que um
  leitor saiba, sem inspecionar chaves, o que esperar do bloco.
- **Servidor que consome uma lib antiga e passa um campo novo perde o campo em silêncio**
  (o schema descarta chave desconhecida). Por isso o teste de proveniência do servidor
  DEVE asserir a presença da chave, não só a ausência de erro.
- **Testes que prendem a lista de chaves do `concise`** (há em ibge, ilo, senado e no
  template) quebram de propósito a cada minor — são o alarme de que o servidor subiu de
  contrato e precisa reler esta spec. Ajuste de uma linha.
- **O `outputSchema` da tool tem de subir JUNTO com o pacote — e a forma de garantir isso
  é não transcrevê-lo.** O SDK do MCP valida `structuredContent` contra o `outputSchema`
  em runtime; um servidor que fecha o bloco (`additionalProperties: false`) com as chaves
  transcritas à mão e sobe o pacote sem reescrever a transcrição **falha em toda chamada**
  (medido em 26/09/2026 contra a 0.2.0: bcb 44 falhas, ibge 48, sih 39, medical 64, todas
  "must NOT have additional properties"). Desde a 0.2.0 o pacote publica a projeção que
  ele mesmo emite — `CONCISE_BLOCK_JSON_SCHEMA`/`DETAILED_BLOCK_JSON_SCHEMA`
  (`provenanceBlockJsonSchema(mode)`) em JSON Schema verbatim e `ConciseBlockSchema`/
  `DetailedBlockSchema` em zod estrito. O servidor **importa** e embute no
  `outputSchema`; assim sobe de contrato pelo mesmo bump que sobe o pacote, e os testes
  do pacote prendem que schema e `render*` não divergem.
- **Major (2.0)** é para tudo o que esta regra proíbe.

### O que a v1.2 acrescentou a esta regra (06/10/2026)

**O cliente também guarda o `outputSchema`.** Importar o schema do pacote resolve o lado
do servidor; não resolve o conector (Claude.ai e outros) que listou as tools antes e
guardou a lista. Com `additionalProperties: false`, uma chave que ele não conhece faz a
resposta inteira ser recusada até ele renovar a lista — e isso não depende de nós. Daí
duas regras:

- **Exceção ao `null` explícito, só para chave que existe para poucas respostas.**
  `field_sources` no `concise` é **ausente** quando não há fusão, não `null`. Com `null`
  em toda resposta, um conector desatualizado recusaria TODA tool de TODO servidor; com a
  chave ausente, só as tools que de fato fundem sub-fontes. A ordem continua contrato
  (é a 8ª chave); o que muda é que ela pode faltar. Pela mesma razão,
  `served_from_cache` dentro do item é declarada no schema sem ser exigida.
- **Rollout em dois tempos, por servidor.** A lib 0.3.0 emite **1.1 por padrão**, byte a
  byte o que a 0.2.0 emitia (teste do pacote compara com a saída da 0.2.0 publicada), e
  publica schemas que **aceitam** 1.1 e 1.2. (1) O servidor sobe o pacote: o
  `outputSchema` passa a declarar a chave nova, o fio não muda, nada quebra. (2) Depois de
  medir que os conectores renovaram o schema, o servidor liga `contractVersion: "1.2"` no
  contexto — um patch dele, sem release do pacote — e a chave passa a sair nas tools que
  fundem sub-fontes. `contract_version` no `detailed` acompanha a escolha do servidor.

### O que a v1.3 acrescentou a esta regra (08/10/2026)

- **A mesma exceção ao `null`, para quatro chaves.** `notices`, `derived`,
  `derivation_note` e `revision` entram no `concise` ausentes quando não há o que dizer;
  no `detailed`, `revision` sai sempre a partir da 1.3 (`null` quando não se sabe) e fica
  ausente nos blocos 1.1/1.2, para não mudar o fio de quem ainda não ligou a 1.3.
- **Regra "a partir da versão X" compara posição, não igualdade.** Até a 0.3.x a regra do
  `retrieved_at` mais antigo era cobrada com `contract_version === "1.2"` — na 1.3 ela se
  desligaria em silêncio. A lib compara pela ordem de `CONTRACT_VERSIONS`
  (`contractAtLeast`).
- **O rodapé também é fio.** As linhas de exceção (§6) só saem em blocos 1.3: o rodapé de
  quem emite 1.1/1.2 segue byte-idêntico ao subir o pacote.
- **Mesmo rollout em dois tempos**, sem medir conectores: o tempo 2 é um prazo fixo depois
  de o tempo 1 estar no ar (com pouco uso, não há o que medir).

| Versão | Lib | Mudança |
|:--|:--|:--|
| 1.0 | 0.1.x | Contrato inicial: piso legal, modos `concise` (6 chaves)/`detailed`, três canais |
| 1.1 | 0.2.x | `retrieval` (diagnóstico de origem) como 7ª chave do `concise` e no bloco canônico após `served_from_cache`; `contract_version: "1.1"`; esta seção; JSON Schema e zod das projeções publicados pelo pacote para o `outputSchema` |
| 1.2 | 0.3.x | `field_sources` como 8ª chave do `concise`, presente só com fusão de sub-fontes; `served_from_cache` por sub-fonte; regra do `retrieved_at` mais antigo escrita (§3) e cobrada quando há `field_sources`; `contractVersion` no contexto (default 1.1); schemas aceitam 1.1 e 1.2; exceção ao `null` e rollout em dois tempos (acima) |
| 1.3 | 0.4.x | `notices`, `derived`/`derivation_note` e `revision` no `concise`, cada uma só quando há o que dizer; `revision` (`current`/`provisional`/`final`) no canônico e no `detailed`; linhas de exceção no rodapé; regra do mais antigo cobrada da 1.2 em diante; schemas aceitam 1.1, 1.2 e 1.3 |
