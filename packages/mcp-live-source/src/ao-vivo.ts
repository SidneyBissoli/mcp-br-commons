import { TITULO_FONTE_INALCANCAVEL, TITULO_FONTE_INDISPONIVEL } from "./actions.js";
import { Relatorio, type Destinos, type OpcoesDoRelatorio } from "./relatorio.js";
import { capturarComRetentativa, type OpcoesDeRetentativa } from "./retentativa.js";
import type { Falha } from "./veredito.js";

/**
 * O adaptador para runner de testes (vitest em `./vitest`), independente do runner: o
 * núcleo recebe os ganchos `it`/`afterAll` e um contexto com `skip(nota)` que LANÇA (é
 * assim no vitest: `ctx.skip()` interrompe o teste e o marca pulado). Com um dublê dos
 * ganchos o núcleo se testa sem o runner.
 *
 * A política, traduzida para teste: `indisponivel` (depois das idas) → teste PULADO com a
 * nota "Fonte indisponível: …" (o runner sai verde: vitest sai 0 quando só há skips) e
 * registro no relatório; `ambiguo` → repete e, se persistir, falha normal; `respondeu`
 * (404/4xx, ou a asserção do próprio teste — predicado `deriva`, padrão `AssertionError`)
 * e `alheio` → falha normal, sem repetir. Um `Relatorio` por arquivo; no `afterAll` ele
 * escreve o log, as anotações e o `$GITHUB_STEP_SUMMARY` — nada se o arquivo não rodou
 * nenhum teste ao vivo (`describe.runIf(false)`).
 *
 * O disjuntor vale: os testes de um arquivo rodam em sequência, e a partir do momento em
 * que N testes seguidos saíram indisponíveis sem NENHUMA captura, os seguintes pulam sem
 * ir à rede (`registrarNaoMedida`) — a anotação sai `Fonte inalcançável` (erro, como no
 * script), mas o processo sai verde: o runner decide a saída, não o relatório. Com
 * `describe.concurrent` a ordem não é garantida e o disjuntor pode disparar tarde; não
 * usar.
 */
export interface ContextoDeTeste {
  /** Interrompe o teste e o marca pulado, com a nota. */
  skip(nota?: string): never;
}

export interface OpcoesDeTeste {
  timeout?: number | undefined;
}

export interface GanchosDoRunner<Ctx extends ContextoDeTeste> {
  it(nome: string, fn: (ctx: Ctx) => Promise<void>, opcoes?: OpcoesDeTeste): void;
  afterAll(fn: () => void): void;
}

export interface OpcoesAoVivo extends Omit<OpcoesDeRetentativa, "dependencia" | "deriva"> {
  /**
   * Rótulo curto para a anotação e o resumo (é o que o painel lê: SEM vírgula). Padrão:
   * o nome do teste.
   */
  endpoint?: string | undefined;
  /** Teto do teste no runner, em ms — deve cobrir TODAS as idas. */
  timeout?: number | undefined;
}

export interface OpcoesDaSuite extends OpcoesDoRelatorio {
  /** Padrão de retentativa de cada `aoVivo` do arquivo (cada um pode sobrepor). */
  retentativa?: Omit<OpcoesDeRetentativa, "dependencia" | "deriva"> | undefined;
  /** Destinos do relatório no `afterAll`. Padrão: stdout, `$GITHUB_STEP_SUMMARY`. */
  destinos?: Destinos | undefined;
}

export type AoVivo<Ctx extends ContextoDeTeste> = (
  nome: string,
  fn: (ctx: Ctx) => Promise<unknown>,
  opcoes?: OpcoesAoVivo,
) => void;

export interface SuiteAoVivo<Ctx extends ContextoDeTeste> {
  aoVivo: AoVivo<Ctx>;
  relatorio: Relatorio;
}

/** Num teste, só vale repetir o que pode ter sido um soluço da origem. */
export function repetirAoVivo(falha: Falha): boolean {
  return falha.veredito === "indisponivel" || falha.veredito === "ambiguo";
}

/** A asserção do teste (`expect` do vitest, `node:assert`): a origem respondeu e o contrato falhou. */
export function ehAssercao(err: unknown): boolean {
  return err instanceof Error && err.name === "AssertionError";
}

export function criarSuiteAoVivo<Ctx extends ContextoDeTeste>(
  ganchos: GanchosDoRunner<Ctx>,
  opcoes: OpcoesDaSuite = {},
): SuiteAoVivo<Ctx> {
  const deriva = opcoes.deriva ?? ehAssercao;
  const relatorio = new Relatorio({ ...opcoes, deriva });
  const padrao = opcoes.retentativa ?? {};

  ganchos.afterAll(() => {
    if (relatorio.resultados.length === 0) return;
    relatorio.escrever({ ...opcoes.destinos, codigoDeSaida: false });
  });

  const aoVivo: AoVivo<Ctx> = (nome, fn, o = {}) => {
    const endpoint = o.endpoint ?? nome;
    ganchos.it(
      nome,
      async (ctx) => {
        if (relatorio.deveParar) {
          const motivo = `${TITULO_FONTE_INALCANCAVEL}: a origem não respondeu a nenhuma captura; não medido`;
          relatorio.registrarNaoMedida(endpoint, motivo);
          ctx.skip(motivo);
        }
        const inicio = performance.now();
        let idas: number | undefined;
        try {
          await capturarComRetentativa(() => fn(ctx), {
            ...padrao,
            ...o,
            dependencia: opcoes.dependencia,
            deriva,
            repetir: o.repetir ?? padrao.repetir ?? repetirAoVivo,
            aoDesistir: (n, f) => {
              idas = n;
              (o.aoDesistir ?? padrao.aoDesistir)?.(n, f);
            },
          });
        } catch (err) {
          const r = relatorio.registrarFalha(endpoint, err, Math.round(performance.now() - inicio), { idas });
          if (r.falha.veredito === "indisponivel") ctx.skip(`${TITULO_FONTE_INDISPONIVEL}: ${r.falha.motivo}`);
          throw err;
        }
        relatorio.registrarCaptura(endpoint, Math.round(performance.now() - inicio));
      },
      o.timeout === undefined ? undefined : { timeout: o.timeout },
    );
  };

  return { aoVivo, relatorio };
}
