/**
 * GARDE ANTI-REDOS DE LA RECHERCHE — la vraie, celle qui agit.
 *
 * ── CE QUI EXISTAIT, ET POURQUOI ÇA NE PROTÉGEAIT DE RIEN ───────────────────
 * `searchService.testRegexWithTimeout()` fabriquait une `Promise`, armait un
 * `setTimeout`, appelait `regex.test(text)` SYNCHRONEMENT dans l'exécuteur, puis
 * rendait la promesse castée en `boolean` par un `as any`. Trois conséquences,
 * toutes vérifiables à la main :
 *
 *   · l'appelant recevait un OBJET, donc toujours vrai — la recherche par
 *     expression régulière disait « ça correspond » pour TOUT document, nom de
 *     fichier comme contenu ;
 *   · JavaScript n'a qu'un fil d'exécution : le `setTimeout` ne peut pas
 *     s'exécuter AVANT que `regex.test` ait rendu la main. Le délai n'a donc
 *     jamais rien interrompu ;
 *   · et le `clearTimeout` laissait de toute façon la promesse pendante.
 *
 * `isSafeRegex()` de son côté laissait passer `(a+)+`, le cas d'école de
 * l'explosion exponentielle : aucun de ses cinq motifs ne l'attrapait.
 *
 * ── AUCUN MOTEUR JS N'EST INTERRUPTIBLE ─────────────────────────────────────
 * Il n'existe pas de manière d'arrêter un `RegExp.exec` parti trop loin. La
 * défense honnête est donc en TROIS temps — c'est celle du mobile
 * (`filarr-mobile/src/services/search/contentSearch.ts`), reprise ici mot pour
 * mot pour que les deux plateformes refusent les MÊMES motifs :
 *
 *   1. REFUS STATIQUE — les formes qui explosent (quantificateur sur un groupe
 *      lui-même quantifié, alternance répétée, `.*` en série) sont rejetées
 *      AVANT compilation. Seule barrière qui agisse avant le mal.
 *   2. BORNES D'ENTRÉE — motif plafonné à 500 caractères, texte fouillé
 *      plafonné : le pire cas reste fini.
 *   3. BUDGET DE TEMPS — l'horloge est consultée ENTRE deux documents. Un motif
 *      lent n'est pas interrompu au milieu d'un document, mais il ne parcourt
 *      pas les 2 000 suivants : le balayage s'arrête et le DIT (`timedOut`), au
 *      lieu de figer la fenêtre sans rien annoncer.
 *
 * Module PUR et sans dépendance : c'est ce qui le rend testable avec les cas
 * ReDoS classiques sans monter d'index.
 */

/** Longueur maximale d'un motif. Chiffre historique du bureau, conservé. */
export const MAX_PATTERN_LENGTH = 500;

/**
 * Formes connues pour dégénérer en temps exponentiel (ReDoS).
 *
 * Les deux premières viennent de l'ancien `isSafeRegex` ; les suivantes
 * complètent ce qu'il laissait passer. Liste IDENTIQUE à `DANGEROUS_SHAPES` du
 * mobile : un motif refusé sur téléphone doit l'être ici, sinon l'utilisateur
 * apprend deux règles au lieu d'une.
 */
export const DANGEROUS_SHAPES: readonly RegExp[] = [
  // Quantificateurs collés : `*+`, `+*`, `++`, `{2,}+`.
  /(\*\+|\+\*|\+\+|\{\d+,\}\+)/,
  // Groupe quantifié, lui-même suivi d'un quantificateur : `(a+)+`, `(a*)*` —
  // la forme canonique de l'explosion, que l'ancienne garde ratait.
  /\([^()]*[*+][^()]*\)\s*[*+{]/,
  // Même chose avec un quantificateur explicite : `(a{2,})+`.
  /\([^()]*\{\d+,\d*\}[^()]*\)\s*[*+{]/,
  // Alternance dans un groupe répété : `(a|ab)+`.
  /\([^()]*\|[^()]*\)\s*[*+{]/,
  // `.*` en série — chacun peut absorber le suivant.
  /(\.\*){3,}/,
];

/** Pourquoi un motif a été refusé. Une réponse, pas une panne. */
export type PatternRejection = 'too-long' | 'unsafe' | 'invalid';

export type CompiledPattern = { ok: true; regex: RegExp } | { ok: false; reason: PatternRejection };

/**
 * Le motif est-il d'une forme sûre ? Analyse STATIQUE : elle ne prouve pas la
 * terminaison en temps raisonnable, elle écarte les formes dont on SAIT
 * qu'elles explosent. Voir l'en-tête du module.
 */
export function isSafePattern(pattern: string): boolean {
  if (pattern.length > MAX_PATTERN_LENGTH) return false;
  return !DANGEROUS_SHAPES.some((shape) => shape.test(pattern));
}

/**
 * Compile un motif, ou dit POURQUOI il est refusé. Ne jette jamais : c'est
 * l'appelant qui décide d'en faire une erreur affichée.
 */
export function compilePattern(pattern: string, caseSensitive: boolean): CompiledPattern {
  if (pattern.length > MAX_PATTERN_LENGTH) return { ok: false, reason: 'too-long' };
  if (!isSafePattern(pattern)) return { ok: false, reason: 'unsafe' };
  try {
    return { ok: true, regex: new RegExp(pattern, caseSensitive ? 'g' : 'gi') };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

/**
 * Longueur au-delà de laquelle le CONTENU d'un document est tronqué avant
 * d'être confronté au motif. L'index du bureau n'a pas de plafond propre (il
 * reçoit ce que l'extracteur PDF lui donne), donc c'est ici que la borne 2 de
 * l'en-tête est posée. 100 000 caractères, comme l'index du mobile.
 */
export const MAX_SCANNED_TEXT_LENGTH = 100_000;

/**
 * Budget par défaut d'un balayage par expression régulière, en millisecondes.
 * Au-delà, l'utilisateur ne perçoit plus une recherche mais un gel.
 */
export const DEFAULT_REGEX_BUDGET_MS = 250;

/**
 * Applique le motif à un texte, en le bornant d'abord.
 *
 * `lastIndex` est remis à zéro : le drapeau `g` rend `RegExp.test` DÉPENDANT DE
 * L'APPEL PRÉCÉDENT, et la même expression sert ici pour des milliers de
 * documents. Sans cette remise à zéro, un document sur deux « ne correspondait
 * pas » — un défaut que l'ancienne implémentation masquait, puisqu'elle rendait
 * vrai pour tout le monde.
 */
export function testBounded(regex: RegExp, text: string): boolean {
  if (!text) return false;
  const bounded =
    text.length > MAX_SCANNED_TEXT_LENGTH ? text.slice(0, MAX_SCANNED_TEXT_LENGTH) : text;
  regex.lastIndex = 0;
  try {
    return regex.test(bounded);
  } catch {
    return false;
  }
}

/**
 * Chronomètre d'un balayage : « ai-je encore le droit de regarder un document
 * de plus ? »
 *
 * L'horloge est INJECTABLE pour que les tests n'aient pas à dormir.
 */
export class ScanBudget {
  private readonly startedAt: number;
  private exhausted = false;

  constructor(
    private readonly budgetMs: number = DEFAULT_REGEX_BUDGET_MS,
    private readonly now: () => number = Date.now
  ) {
    this.startedAt = now();
  }

  /** `false` = budget épuisé, il faut s'arrêter ICI (entre deux documents). */
  canContinue(): boolean {
    if (this.exhausted) return false;
    if (this.now() - this.startedAt > this.budgetMs) {
      this.exhausted = true;
      return false;
    }
    return true;
  }

  /** Le balayage s'est-il arrêté faute de temps ? Les résultats sont PARTIELS. */
  get timedOut(): boolean {
    return this.exhausted;
  }
}
