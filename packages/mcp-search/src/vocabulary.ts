/**
 * O vocabulário da PERGUNTA contra o vocabulário da FONTE.
 *
 * Toda busca por substring contra o NOME que a fonte usa tem o mesmo defeito:
 * quem pergunta com a palavra de todo dia (ou com a grafia de outro país) não
 * recebe um resultado ruim — recebe ZERO, calado. Medido no portfólio em
 * setembro de 2026: `labor` 0 × labour 176 no ILOSTAT; `enrollment` 0 ×
 * enrolment 227 na UIS; `populacao` 0 × população 520 e `renda` 72 ×
 * rendimento 1.126 no IBGE; `câncer` 0 × neoplasia maligna 439 na CID-10;
 * `calote` 0 × inadimplência 484 no BCB. Cinco servidores receberam a mesma
 * receita, cópia a cópia (ilo 0.6.0, uis 0.3.0, ibge 5.1.0, medical 1.12.0,
 * bcb 1.12.0); a regra da Fase 0 é que componente compartilhado mora aqui.
 *
 * O que este módulo faz, e o que deixa para o servidor:
 *
 *  - o SERVIDOR traz a tabela — só par MEDIDO (a palavra perguntada ausente do
 *    catálogo, a da fonte presente), com as contagens no cabeçalho do módulo
 *    dele. Nada aqui inventa sinônimo: uma tabela vazia é uma expansão nula;
 *  - a LIB expande a consulta: frases da tabela ("pressão alta", "conta
 *    corrente") viram UM termo antes da quebra em palavras (senão "alta" e
 *    "corrente" entrariam no AND e matariam o resultado); stopwords do idioma
 *    ficam fora do AND, mas consulta feita só de stopword continua valendo;
 *    cada termo vira um OR das grafias da fonte — o próprio termo primeiro, e
 *    também o singular, pelas regras do idioma que não fabricam caco — e os
 *    termos casam em AND. Expandir só AUMENTA o recall: o que casava antes
 *    segue casando;
 *  - a tradução é DITA (`vocabularyNotes`): sem isso o resultado parece vir do
 *    que o usuário escreveu;
 *  - a ponta inversa (`askedWordsFor`) dá ao índice de `search` (Deep
 *    Research) a palavra perguntada como keyword do documento cujo nome traz a
 *    palavra da fonte — o ranqueador não casa substring, então precisa da
 *    palavra do usuário no documento.
 *
 * Normalização: NFD sem diacríticos, caixa baixa, espaços colapsados — a mesma
 * `normalizeText` do ranking, para os dois lados da busca passarem pelo mesmo
 * funil ("populacao" ≡ "População").
 */

import { normalizeText } from "./rank.js";

export type VocabularyLocale = "en" | "pt-BR";

export interface VocabularyEntry {
  /** Como o usuário escreve — uma palavra ou uma frase; normalizada ao entrar. */
  readonly asked: string;
  /** Como a fonte escreve — substrings (podem ser frases), normalizadas ao entrar. */
  readonly source: readonly string[];
}

export interface VocabularyOptions {
  /** A tabela medida do servidor. */
  readonly entries: readonly VocabularyEntry[];
  /** Idioma da CONSULTA: decide stopwords, regras de singular e a frase da nota. */
  readonly locale: VocabularyLocale;
  /**
   * Como a nota chama a fonte, no caso gramatical da frase: em inglês
   * "ILOSTAT" ou "the UIS" ("the wording the UIS uses"); em pt-BR "o IBGE",
   * "a CID-10" ("a palavra que o IBGE usa").
   */
  readonly sourceName: string;
  /** Stopwords além das do idioma (raro; a lista padrão é curta de propósito). */
  readonly extraStopwords?: readonly string[];
}

export interface ExpandedTerm {
  /** O termo como o usuário escreveu, normalizado (uma palavra ou uma frase da tabela). */
  readonly term: string;
  /** As substrings que o representam na busca — o próprio termo primeiro. */
  readonly patterns: readonly string[];
  /** A tabela (não a mera flexão de singular) mudou o que se procura. */
  readonly translated: boolean;
}

export interface Vocabulary {
  /** Sem diacríticos, caixa baixa, espaços colapsados. */
  normalize(text: string): string;
  /** Os termos efetivos da consulta: frases da tabela primeiro, depois palavras sem stopword. */
  queryTerms(query: string): string[];
  /** Um termo e as substrings que o representam (o próprio termo primeiro). */
  expandTerm(term: string): string[];
  /** A consulta inteira, termo a termo, pronta para virar WHERE ou filtro. */
  expandQuery(query: string): ExpandedTerm[];
  /** As frases que contam ao chamador que a palavra dele não é a da fonte. */
  vocabularyNotes(expanded: readonly ExpandedTerm[]): string[];
  /**
   * Um texto (JÁ normalizado) casa o termo expandido? O padrão precisa COMEÇAR
   * uma palavra — em SQL isso é `col GLOB 'p*' OR col GLOB '*[^a-z0-9]p*'`, e
   * NÃO `col LIKE '%p%'`, que é o casamento sem fronteira que a 0.6.0 corrigiu.
   */
  matchesTerm(normalizedText: string, expanded: ExpandedTerm): boolean;
  /** Um texto (JÁ normalizado) casa TODOS os termos da consulta expandida? */
  matchesQuery(normalizedText: string, expanded: readonly ExpandedTerm[]): boolean;
  /** As palavras com que se PERGUNTA por este nome — keywords para o índice de `search`. */
  askedWordsFor(name: string): string[];
}

/**
 * Palavras que não carregam significado no nome de um documento e, em AND,
 * excluem resultado certo ("hours of work" não pode morrer no "of"; "grupo de
 * idade" não pode morrer no "de"). Curtas de propósito.
 */
const STOPWORDS: Readonly<Record<VocabularyLocale, readonly string[]>> = {
  en: ["a", "an", "the", "of", "in", "on", "for", "and", "to", "per", "by", "with"],
  "pt-BR": [
    "a", "o", "as", "os", "um", "uma", "de", "da", "do", "das", "dos", "e", "em", "no", "na", "nos", "nas",
    "ao", "aos", "por", "para", "com", "sem", "que", "ou",
  ],
};

/**
 * Forma singular de um termo já normalizado — a substring mais curta casa o
 * plural também. Só as regras que não fabricam caco: tirar "es" em inglês
 * faria "wages" → "wag", que casa por acidente e suja a nota ao usuário.
 */
const SINGULARS: Readonly<Record<VocabularyLocale, (term: string) => string[]>> = {
  en: (term) => {
    if (term.length > 4 && term.endsWith("ies")) return [`${term.slice(0, -3)}y`];
    if (term.length > 3 && term.endsWith("s") && !term.endsWith("ss")) return [term.slice(0, -1)];
    return [];
  },
  "pt-BR": (term) => {
    if (term.length > 4 && (term.endsWith("oes") || term.endsWith("aes"))) return [`${term.slice(0, -3)}ao`];
    if (term.length > 4 && /(ais|eis|ois)$/.test(term)) return [`${term.slice(0, -2)}l`];
    if (term.length > 3 && term.endsWith("s") && !term.endsWith("ss")) return [term.slice(0, -1)];
    return [];
  },
};

const NOTE: Readonly<Record<VocabularyLocale, (term: string, others: string, source: string) => string>> = {
  en: (term, others, source) => `"${term}" was also searched as ${others} — the wording ${source} uses.`,
  "pt-BR": (term, others, source) => `"${term}" também foi buscado como ${others} — a palavra que ${source} usa.`,
};

/**
 * Depois de `normalizeText`, a palavra é `[a-z0-9]` — a mesma definição que
 * `tokenize` usa no ranking, para a biblioteca não ter dois conceitos de
 * palavra.
 */
function ehLetraOuDigito(codigo: number): boolean {
  return (codigo >= 97 && codigo <= 122) || (codigo >= 48 && codigo <= 57);
}

/**
 * O padrão aparece no texto COMEÇANDO uma palavra?
 *
 * Até a 0.5.0 o casamento era `texto.includes(padrao)`, substring em qualquer
 * posição — e substring sem fronteira inventa resultado, sem dar erro. Medido
 * em 22/09/2026 nas 1.332 subclasses da CNAE (IBGE):
 *
 *   perguntado   achados   e eram
 *   uber         1         "…VERDURAS, RAÍZES, TUBÉRCULOS…"   (0 certos)
 *   ovo          11        9 deles "NOVOS" / "RENOVO"
 *   ar           611       de 1.332 — "passageiros", "artefatos", "farmácia"…
 *
 * e nos 9.336 agregados do SIDRA: `idade` casava 6.092, quase todos dentro de
 * "atividade". No catálogo da UIS o estrago é pior de perceber: `male` casa
 * dentro de `female`, então perguntar por homens trazia mulheres.
 *
 * A fronteira é só no INÍCIO, e isso é deliberado: as tabelas de vocabulário
 * dos servidores guardam RADICAIS escolhidos a dedo — `ocupa` para alcançar
 * ocupação/ocupadas, `odontolog` para odontológico/odontologia, `contabil`
 * para contabilidade/contábil, `child` para children. Exigir fronteira também
 * no fim mataria todos eles: medido no mesmo dia, `ocupa` cairia de 1.609 para
 * 0, `odontolog` de 5 para 0, e `escola` perderia 197 nomes ("escolaridade",
 * "escolar"). Casar prefixo de palavra é o mecanismo; casar o MIOLO de uma
 * palavra é o defeito.
 *
 * Feito com `indexOf` em laço, e não com `RegExp`, por duas razões: é chamado
 * uma vez por linha de catálogo (9.336 no maior deles) e o padrão vem de uma
 * tabela, então escapá-lo seria mais uma coisa para errar.
 */
function comecaEmFronteira(texto: string, padrao: string): boolean {
  if (padrao === "") return false;
  let i = texto.indexOf(padrao);
  while (i !== -1) {
    if (i === 0 || !ehLetraOuDigito(texto.charCodeAt(i - 1))) return true;
    i = texto.indexOf(padrao, i + 1);
  }
  return false;
}

export function createVocabulary(options: VocabularyOptions): Vocabulary {
  const { locale, sourceName } = options;
  const normalize = (text: string): string => normalizeText(text);
  const entries: readonly VocabularyEntry[] = options.entries.map((e) => ({
    asked: normalize(e.asked),
    source: e.source.map(normalize),
  }));
  const byAsked: ReadonlyMap<string, readonly string[]> = new Map(entries.map((e) => [e.asked, e.source]));
  // As frases da tabela, da mais longa para a mais curta — casam antes da quebra em palavras.
  const phrases: readonly string[] = entries
    .map((e) => e.asked)
    .filter((a) => a.includes(" "))
    .sort((a, b) => b.length - a.length);
  const stopwords: ReadonlySet<string> = new Set([...STOPWORDS[locale], ...(options.extraStopwords ?? []).map(normalize)]);
  const singulars = SINGULARS[locale];

  function queryTerms(query: string): string[] {
    let rest = ` ${normalize(query)} `;
    const out: string[] = [];
    for (const phrase of phrases) {
      const needle = ` ${phrase} `;
      if (rest.includes(needle)) {
        out.push(phrase);
        rest = rest.replace(needle, " ");
      }
    }
    const words = rest.split(" ").filter(Boolean);
    const kept = words.filter((w) => !stopwords.has(w));
    // Consulta só de stopword continua valendo — senão "of" viraria consulta vazia.
    out.push(...(kept.length || out.length ? kept : words));
    return out;
  }

  function expandTerm(term: string): string[] {
    const t = normalize(term);
    const out = [t, ...(byAsked.get(t) ?? []), ...singulars(t).flatMap((s) => [s, ...(byAsked.get(s) ?? [])])];
    return [...new Set(out)];
  }

  function isTranslated(t: string): boolean {
    return byAsked.has(t) || singulars(t).some((s) => byAsked.has(s));
  }

  function expandQuery(query: string): ExpandedTerm[] {
    return queryTerms(query).map((term) => ({ term, patterns: expandTerm(term), translated: isTranslated(term) }));
  }

  function vocabularyNotes(expanded: readonly ExpandedTerm[]): string[] {
    return expanded
      .filter((e) => e.translated)
      .map((e) => NOTE[locale](e.term, e.patterns.filter((p) => p !== e.term).join(", "), sourceName));
  }

  function matchesTerm(normalizedText: string, expanded: ExpandedTerm): boolean {
    return expanded.patterns.some((p) => comecaEmFronteira(normalizedText, p));
  }

  function matchesQuery(normalizedText: string, expanded: readonly ExpandedTerm[]): boolean {
    return expanded.every((e) => matchesTerm(normalizedText, e));
  }

  function askedWordsFor(name: string): string[] {
    const n = normalize(name);
    const out = entries
      .filter((e) => e.source.some((s) => comecaEmFronteira(n, s)))
      .map((e) => e.asked);
    return [...new Set(out)];
  }

  return { normalize, queryTerms, expandTerm, expandQuery, vocabularyNotes, matchesTerm, matchesQuery, askedWordsFor };
}
