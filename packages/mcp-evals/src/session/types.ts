/**
 * Tipos do runner de SESSÃO LONGA.
 *
 * O eval de seleção (`../runner.ts`) mede UM turno: dada a consulta, qual tool o
 * modelo escolhe. Este runner mede a SESSÃO: o modelo recebe uma tarefa de 10–25
 * passos, chama as tools de um servidor MCP real (por stdio), lê os resultados e
 * segue até concluir. A pergunta que ele responde é a do comentário de 26/09/2026
 * no dev.to — "os diagnósticos de origem (`provenance.retrieval`) reduzem chamadas
 * ruins em execuções longas?" — e por isso tudo aqui é desenhado como A/B:
 *
 *   - braço A: o `tool_result` chega ao modelo como sai do servidor;
 *   - braço B: o runner apaga `provenance.retrieval` do texto antes de entregar.
 *
 * Os dois braços recebem a MESMA system prompt (registrada no NDJSON) e a mesma
 * lista de tarefas. A métrica é "chamada ruim por tarefa", contada por trace, sem
 * juiz, exceto a leitura de dado instável como certeza (essa pede juiz e sai
 * separada).
 *
 * Identificadores de código em inglês; nomes de campo do NDJSON em português,
 * como no harness do senado que serviu de molde.
 */

/** Uma chamada de tool escrita à mão: roteiro do `--dry` e validação offline. */
export interface ScriptedCall {
  tool: string;
  args: Record<string, unknown>;
}

/** Gabarito checável mecanicamente na resposta final. */
export type Answer =
  | { kind: "number"; value: number; /** Tolerância relativa (padrão 0,5 %). */ tolerance?: number }
  | { kind: "text"; value: string }
  | { kind: "regex"; pattern: string; flags?: string };

export interface Task {
  id: string;
  /** Pedido do usuário, na persona e no idioma do servidor. */
  prompt: string;
  /** Tools que uma trajetória correta tem de tocar (validadas contra o catálogo). */
  expectedTools: string[];
  /**
   * Chamadas que o modelo dublado faz no `--dry`: é o que mede o tamanho real das
   * respostas das tools-alvo antes da rodada paga. Validadas contra o catálogo
   * (nome existe, argumentos obrigatórios presentes).
   */
  script: ScriptedCall[];
  /** Gabarito checável na resposta final (opcional — tarefa de armadilha pode não ter). */
  answer?: Answer;
  /** A armadilha que a tarefa arma (documentação; entra no relatório). */
  trap?: string;
  /** Teto de passos (iterações modelo→tools) desta tarefa. Padrão: 25. */
  maxSteps?: number;
  note: string;
}

export type Arm = "A" | "B";

/**
 * Nível de falha injetada na ORIGEM (via `--import fault.mjs`):
 *   - `0`: mundo real, nada injetado (controle);
 *   - `20`: 20 % das idas à origem respondem 502/HTML/timeout, determinístico por semente;
 *   - `missing`: nada injetado, mas a lista de tarefas é a que contém a série inexistente.
 * O nome é livre — o conjunto de tarefas define quais existem e que regras cada um liga.
 */
export type FaultLevel = string;

/** Regra de falha injetada; o `fault.mjs` lê a lista em JSON por `EVAL_FAULT_RULES`. */
export interface FaultRule {
  /** Regex (fonte) casada contra a URL completa da ida. */
  match: string;
  /** Fração das idas casadas que falham, em [0, 1]. */
  rate: number;
  /** Como falha. */
  kind: "http_5xx" | "html" | "timeout";
  /** Status do `http_5xx` (padrão 502). */
  status?: number;
  /** Atraso do `timeout` em ms (padrão 65 000 — acima de qualquer timeout de servidor do portfólio). */
  delayMs?: number;
}

export interface FaultConfig {
  seed: number;
  rules: FaultRule[];
}

/** Conjunto de tarefas de um servidor, como exportado por `evals/session/tasks.ts`. */
export interface TaskSet {
  /** Nome do servidor (vai ao NDJSON e ao relatório). */
  server: string;
  tasks: Task[];
  /**
   * System prompt comum aos dois braços. O runner ACRESCENTA a frase sobre
   * `retrieval`/`unstable` no braço A (`retrievalHint`), porque sem ela o A/B mede
   * se o modelo adivinha o campo, não se o usa.
   */
  systemPrompt: string;
  /** Frase a mais do braço A. Padrão: `DEFAULT_RETRIEVAL_HINT`. */
  retrievalHint?: string;
  /** Níveis de falha e as regras de cada um. `0` sempre existe (sem regras). */
  faults: Record<FaultLevel, FaultConfig>;
  /**
   * Extrai a "chave de insistência" de uma chamada (ex.: o código da série). A
   * métrica (c) conta ≥3 chamadas com a mesma chave que falharam. Padrão:
   * valores dos argumentos chamados `codigo`/`codigos`/`code`/`id`/`serie`.
   */
  insistenceKey?: (call: ScriptedCall) => string | null;
  /**
   * Texto de erro que é TRANSITÓRIO (vale repetir). Repetir a mesma chamada depois
   * de erro que NÃO casa aqui é a métrica (a). Padrão: `DEFAULT_TRANSIENT_PATTERN`.
   */
  transientErrorPattern?: RegExp;
  /**
   * Texto de erro que é DEFINITIVO mesmo quando também soa transitório — vence o
   * padrão transitório. Ex.: a mensagem do bcb para código inexistente diz "a origem
   * está indisponível — repita" E "é a série INEXISTENTE que fica ~30 s"; para o A/B,
   * repetir depois dela é chamada ruim. Sem padrão por omissão.
   */
  definitiveErrorPattern?: RegExp;
}

// ---------------------------------------------------------------------------
// Trace
// ---------------------------------------------------------------------------

/** O que uma chamada de tool devolve ao runner (forma mínima; `mcp-client.ts` a produz). */
export interface ToolCallOutcomeLike {
  text: string;
  isError: boolean;
  protocolError?: { code: number | null; message: string };
}

export type ErrorClass =
  /** `isError` do servidor, texto que NÃO parece transitório → repetir igual é chamada ruim. */
  | "definitive"
  /** `isError` do servidor com texto transitório (timeout, 5xx, indisponível). */
  | "transient"
  /** Recusa de esquema: -32602 do protocolo ou validação de argumentos. */
  | "schema"
  /** Erro de protocolo/transporte (o servidor caiu, JSON-RPC inválido). */
  | "protocol";

/** Projeção do bloco `retrieval` do contrato v1.1 (o que o servidor mede por chamada). */
export interface RetrievalView {
  requests: number;
  attempts: number;
  anomalies: { kind: string; count: number }[];
  unstable: boolean;
}

/** Uma chamada de tool observada na sessão. */
export interface CallRecord {
  /** Índice do passo (iteração do loop) em que a chamada saiu. */
  step: number;
  tool: string;
  args: Record<string, unknown>;
  /** `tool + args` canônicos (chaves ordenadas) — a identidade para "repetiu a mesma chamada". */
  canonical: string;
  isError: boolean;
  errorClass: ErrorClass | null;
  /** `retrieval` como o servidor emitiu (lido ANTES do filtro do braço B; array quando multi-fonte). */
  retrieval: RetrievalView[] | null;
  /** Caracteres do texto que o modelo recebeu (depois do filtro, no braço B). */
  resultChars: number;
  /** Resumo curto do resultado para leitura humana no NDJSON. */
  resultSummary: string;
  durationMs: number;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  requests: number;
}

/** Métricas mecânicas (a–c) + contagens de apoio, por sessão. */
export interface SessionMetrics {
  /** (a) repetições da MESMA chamada logo depois de erro definitivo. */
  repeatAfterDefinitiveError: number;
  /** (b) chamadas recusadas pelo esquema (o modelo tinha o schema e errou o argumento). */
  schemaRefusals: number;
  /** (c) grupos de insistência: ≥3 chamadas com a mesma chave que falharam. */
  insistenceGroups: number;
  /** Soma de (a)+(b)+(c): a métrica-título "chamadas ruins por tarefa". */
  badCalls: number;
  /** Chamadas cujo `retrieval.unstable` veio true (o campo sob teste apareceu). */
  unstableResults: number;
  calls: number;
  errors: number;
  steps: number;
  /** Gabarito mecânico: 1 acertou, 0 errou, null sem gabarito. */
  answerCorrect: 0 | 1 | null;
}

/** Uma linha do NDJSON: (tarefa, braço, nível de falha, execução, modelo). */
export interface SessionRecord {
  taskId: string;
  arm: Arm;
  fault: FaultLevel;
  run: number;
  model: string;
  server: string;
  /** SHA curto do servidor sob teste, quando o chamador informa. */
  serverSha: string | null;
  startedAt: string;
  finishedAt: string;
  /** Semente da injeção de falha (null no nível sem regras). */
  faultSeed: number | null;
  systemPrompt: string;
  calls: CallRecord[];
  finalAnswer: string;
  stopReason: string | null;
  /** Por que a sessão parou: `end_turn` (normal), `max_steps`, `max_tokens`, `refusal`, `budget`, `infra`. */
  endedBy: "end_turn" | "max_steps" | "max_tokens" | "refusal" | "budget" | "infra";
  metrics: SessionMetrics;
  usage: UsageTotals;
  costUSD: number;
  /** Juiz (d): 1 citou instável sem ressalva, 0 não, null sem instável/sem juiz. */
  unstableCitedAsCertain?: 0 | 1 | null;
  judgeVerdict?: string;
  /** Presente só quando a sessão não completou por infra (dropout: sai da agregação). */
  infraError?: string;
}

export const DEFAULT_MAX_STEPS = 25;
export const DEFAULT_MAX_TOKENS = 4096;

export const DEFAULT_RETRIEVAL_HINT =
  "Cada resultado traz um bloco `provenance` com a fonte, a URL e o instante da extração. " +
  "Dentro dele, `retrieval` diz quantas idas à origem a chamada precisou (`requests`), quantas " +
  "tentativas ao todo (`attempts`), as anomalias vistas e `unstable`. Quando `unstable` é true, a " +
  "fonte oscilou naquela chamada: diga isso ao usuário ao citar o número e NÃO repita a mesma " +
  "chamada esperando outro valor — o servidor já repetiu por você.";

/**
 * Texto de erro que indica falha TRANSITÓRIA da origem: repetir a chamada é razoável.
 * Cobre as mensagens do `OrigemError`/`traduzirErro` dos servidores do portfólio e os
 * status clássicos. Tudo o mais que vier com `isError` é tratado como definitivo.
 */
export const DEFAULT_TRANSIENT_PATTERN =
  /tempo (limite|esgotado)|timeout|timed out|indispon[ií]vel|temporari|tente (de novo|novamente)|inst[aá]vel|\b(429|500|502|503|504)\b|rate.?limit|ECONNRESET|fetch failed/i;

const DEFAULT_KEY_ARGS = /^(codigo|codigos|code|codes|serie|series|id|ids|indicador|moeda|reuniao)$/i;

/** Extrator padrão da chave de insistência: valores dos argumentos que identificam o alvo. */
export function defaultInsistenceKey(call: ScriptedCall): string | null {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(call.args)) {
    if (!DEFAULT_KEY_ARGS.test(k) || v === undefined || v === null) continue;
    const vals = Array.isArray(v) ? v : [v];
    for (const x of vals) parts.push(String(x).toLowerCase());
  }
  if (parts.length === 0) return null;
  return parts.sort().join("|");
}

/** JSON com chaves ordenadas em profundidade — identidade estável de `args`. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalCall(tool: string, args: Record<string, unknown>): string {
  return `${tool} ${canonicalJson(args ?? {})}`;
}

export function emptyUsage(): UsageTotals {
  return { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, requests: 0 };
}

export function addUsage(into: UsageTotals, u: Partial<UsageTotals>): void {
  into.inputTokens += u.inputTokens ?? 0;
  into.outputTokens += u.outputTokens ?? 0;
  into.cacheCreationInputTokens += u.cacheCreationInputTokens ?? 0;
  into.cacheReadInputTokens += u.cacheReadInputTokens ?? 0;
  into.requests += u.requests ?? 0;
}
