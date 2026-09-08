/**
 * mergePlan — LE MODÈLE DE DÉCISION d'une résolution de conflit, module PUR
 * (ni Redux, ni React, ni i18n) posé au-dessus de `blockDiff`.
 *
 * POURQUOI CE MODULE EXISTE. Deux écrans arbitrent désormais le même genre de
 * conflit : celui des notes PERSONNELLES (`NoteConflictModal`, deux copies dans
 * le magasin local) et celui des notes de COFFRE (`VaultNoteConflict`, un 409
 * sur la garde de version du serveur). Rien de leur persistance n'est commun —
 * l'une écrase une note et purge une copie, l'autre rejoue un compare-and-set
 * contre la version qu'on vient de lire. Mais la QUESTION posée à l'utilisateur
 * est mot pour mot la même, et c'est elle qui porte les règles de sûreté payées
 * en revue. Les laisser recopiées dans deux composants, c'était accepter qu'un
 * seul des deux soit corrigé le jour où l'une se révèle fausse.
 *
 * ── LES RÈGLES QUE CE MODULE TIENT ──────────────────────────────────────────
 *
 * 1. AUCUNE DIFFÉRENCE N'A DE VALEUR PAR DÉFAUT. `planProgress().settled` n'est
 *    vrai que si CHAQUE décision a reçu une réponse explicite. Un repli muet sur
 *    « ma version » jetterait le travail d'en face sans que personne l'ait dit.
 *    (`mergedBlocks` a bien un repli, mais il ne sert QUE l'aperçu : l'écriture
 *    passe par `settled`.)
 *
 * 2. UNE VERSION GARDÉE ENTIÈRE EST RECOPIÉE À L'OCTET, jamais reconstruite.
 *    Reconstruire un document qu'on n'a pas modifié ne peut qu'introduire des
 *    écarts — un attribut absent, un nom de nœud que ProseMirror JETTE sans
 *    lever. Seul un vrai mélange reconstruit, et alors à partir des NŒUDS
 *    d'origine (c'est `blockDiff.mergedDocument` qui s'en charge, en recopiant
 *    `block.node` tel quel : les `attrs` d'origine partent avec, un titre de
 *    niveau 2 reste un titre de niveau 2).
 *
 * 3. LES IDENTIFIANTS DE DÉCISION PORTENT L'EMPREINTE DU COUPLE COMPARÉ. Ils
 *    sont attribués par POSITION (`h0`, `h1`…) : un bloc inséré en tête décale
 *    tout. `blockDiff` les suffixe de l'empreinte du couple (`h0@…`), donc un
 *    choix pris sur une comparaison précédente est structurellement incomptable
 *    sur la suivante — `planProgress` ne le voit plus, le bouton se referme, et
 *    on n'écrit pas une fusion que personne n'a vue. L'appelant doit ENCORE le
 *    dire à l'écran (voir `signature`), mais il ne peut plus se tromper.
 *
 * 4. « GARDER LES DEUX » EST UNE ISSUE À PART ENTIÈRE. Deux ajouts au même
 *    endroit ne s'excluent pas ; sans ce troisième choix il faudrait en
 *    sacrifier un, définitivement. `planOutcome` la classe en `merge`, jamais
 *    en « je garde ma version ».
 *
 * CE QUE CE MODULE NE FAIT PAS : il ne persiste rien, ne connaît ni copie de
 * conflit ni version de serveur, et ne traduit rien.
 */

import {
  compareDocuments,
  decisionSummary,
  mergedDocument,
  type DocumentComparison,
  type DiffSide,
  type HunkChoices,
} from './blockDiff';

/**
 * Clés de choix RÉSERVÉES, hors de l'espace des différences de document
 * (`h0@…`, `h1@…`) : le titre est une décision à part, et « tout le document »
 * est la seule qui reste quand les deux corps ne se comparent pas.
 */
export const TITLE_DECISION = 'title';
export const WHOLE_DECISION = 'whole';

/** Une version en présence — ce qui serait écrit si on la gardait entière. */
export interface MergeSide {
  title: string;
  /** Document ProseMirror SÉRIALISÉ. C'est cette chaîne qui est recopiée. */
  content: string;
  plainText: string;
}

export interface MergePlan {
  comparison: DocumentComparison;
  /** Les deux titres diffèrent : une décision de plus, comptée comme les autres. */
  titleDiffers: boolean;
  /** Les décisions à prendre, DANS L'ORDRE OÙ L'ÉCRAN LES PRÉSENTE. */
  decisionIds: string[];
  /** Empreinte du couple comparé — change dès que l'un des deux corps change. */
  signature: string;
}

/** Résultat de la résolution, prêt à être écrit. */
export interface MergeResult extends MergeSide {
  /**
   * Le document a été RECONSTRUIT (mélange bloc à bloc), par opposition à une
   * version recopiée telle quelle. L'appelant s'en sert pour n'appliquer ses
   * retouches d'après-fusion — re-frapper l'identité d'une base inline posée en
   * double par « garder les deux » — que là où quelque chose a bougé.
   */
  rebuilt: boolean;
}

export function buildMergePlan(mine: MergeSide, theirs: MergeSide): MergePlan {
  const comparison = compareDocuments(mine.content, theirs.content);
  const titleDiffers = mine.title !== theirs.title;
  const decisionIds: string[] = [];
  if (titleDiffers) decisionIds.push(TITLE_DECISION);
  if (!comparison.comparable) decisionIds.push(WHOLE_DECISION);
  else for (const hunk of comparison.hunks) if (hunk.kind !== 'common') decisionIds.push(hunk.id);
  return { comparison, titleDiffers, decisionIds, signature: comparison.signature };
}

/**
 * Où en est l'arbitrage. `settled` est la SEULE porte de l'écriture : tant
 * qu'une décision manque, il n'y a pas de résultat que quelqu'un ait validé.
 */
export function planProgress(
  plan: MergePlan,
  choices: HunkChoices
): { decided: number; total: number; settled: boolean } {
  let decided = 0;
  for (const id of plan.decisionIds) if (choices[id] !== undefined) decided += 1;
  const total = plan.decisionIds.length;
  return { decided, total, settled: decided === total };
}

/**
 * L'issue que la confirmation doit NOMMER.
 *
 * Le titre compte comme une décision à part entière : un document gardé
 * entièrement d'un côté avec le titre de l'autre EST un mélange, et l'annoncer
 * « je garde ma version » serait faux.
 */
export function planOutcome(plan: MergePlan, choices: HunkChoices): 'mine' | 'theirs' | 'merge' {
  const document = ((): 'mine' | 'theirs' | 'merge' => {
    if (!plan.comparison.comparable) {
      return choices[WHOLE_DECISION] === 'theirs' ? 'theirs' : 'mine';
    }
    const summary = decisionSummary(plan.comparison.hunks, choices);
    if (summary.allTheirs) return 'theirs';
    if (summary.total === 0 || summary.allMine) return 'mine';
    return 'merge';
  })();
  if (document === 'merge') return 'merge';
  const titleSide = plan.titleDiffers ? choices[TITLE_DECISION] : undefined;
  return titleSide !== undefined && titleSide !== document ? 'merge' : document;
}

/**
 * CE QUI SERA ÉCRIT — et, par construction, ce que l'aperçu doit montrer.
 *
 * L'aperçu et l'écriture appellent CETTE fonction, une seule fois chacun, sur
 * les mêmes entrées : ils ne peuvent donc pas raconter deux histoires
 * différentes. C'était le défaut de l'aperçu « liste de fragments » : il
 * réassemblait les blocs de son côté, et rien ne garantissait que le document
 * commité soit celui qu'on avait sous les yeux.
 *
 * Les deux branches de recopie (`allMine` / `allTheirs`) rendent les chaînes
 * d'ORIGINE, octet pour octet — voir la règle 2 de l'en-tête.
 */
export function planResult(
  plan: MergePlan,
  choices: HunkChoices,
  mine: MergeSide,
  theirs: MergeSide
): MergeResult {
  const title =
    plan.titleDiffers && choices[TITLE_DECISION] === 'theirs' ? theirs.title : mine.title;

  if (!plan.comparison.comparable) {
    const side = choices[WHOLE_DECISION] === 'theirs' ? theirs : mine;
    return { title, content: side.content, plainText: side.plainText, rebuilt: false };
  }

  const summary = decisionSummary(plan.comparison.hunks, choices);
  if (summary.total === 0 || summary.allMine) {
    return { title, content: mine.content, plainText: mine.plainText, rebuilt: false };
  }
  if (summary.allTheirs) {
    return { title, content: theirs.content, plainText: theirs.plainText, rebuilt: false };
  }
  const built = mergedDocument(plan.comparison, choices);
  return { title, content: built.content, plainText: built.plainText, rebuilt: true };
}

/** Tous les choix d'un coup — le raccourci « je garde tout ce côté ». */
export function takeAllChoices(plan: MergePlan, side: DiffSide): Record<string, DiffSide> {
  const next: Record<string, DiffSide> = {};
  for (const id of plan.decisionIds) next[id] = side;
  return next;
}
