/**
 * trashModel — la corbeille d'un coffre, ses échéances et son vidage (F20),
 * sans React, sans réseau, sans traduction.
 *
 * POURQUOI CES QUATRE DÉCISIONS SONT DES FONCTIONS ET NON DES `if` DE RENDU.
 * Elles portent toutes la même charge : dire quelque chose de DÉFINITIF sur des
 * données qui ne sont plus récupérables. Une phrase fausse ici ne se répare pas.
 *
 *  1. LA BOUCLE DE VIDAGE, ET SA CONDITION D'ARRÊT. `POST /:id/trash/empty`
 *     détruit une passe de cinquante éléments et rend `{ purged, remaining }`.
 *     Côté serveur, `destroyVaultItem` rend `false` quand R2 refuse durablement
 *     un objet : la passe suivante retrouve alors exactement les mêmes lignes et
 *     répond encore `purged: 0, remaining: N`. Un écran qui ne regarderait que
 *     `remaining` rappellerait jusqu'au 429 du seau (30 passes par heure et par
 *     coffre) — une roue qui tourne un quart d'heure pour finir sur une erreur
 *     de débit, là où il fallait dire « il reste N éléments que le serveur
 *     n'arrive pas à détruire ». La règle de contrat est donc : rappeler tant que
 *     `purged > 0 && remaining > 0`, s'ARRÊTER sur `purged === 0 && remaining > 0`
 *     et le présenter comme un ÉCHEC PARTIEL.
 *  2. LA DATE DE PROCHAINE PURGE NE SE COMPTE PAS DEPUIS MAINTENANT. Le balayage
 *     détruit ce qui a dépassé la rétention, donc l'échéance visible est celle
 *     du PLUS ANCIEN élément de la corbeille. « Aujourd'hui + 30 jours »
 *     promettrait un mois à un élément supprimé il y a vingt-neuf jours.
 *  3. « ON NE SAIT PAS » N'EST PAS « C'EST VIDE ». Les agrégats peuvent n'avoir
 *     jamais été lus (un 429 qui n'a rien laissé, une panne) : un `0` de repli
 *     annoncerait une corbeille vide à qui s'apprête justement à la vider — et
 *     le bouton disparaîtrait.
 *  4. LE MOT À TAPER. Un geste sans retour se confirme en l'écrivant ; comparer
 *     la saisie sans la raboter ferait refuser un mot correct suivi d'une
 *     espace, et son auteur chercherait une faute de frappe qui n'existe pas.
 *  5. LA CONSERVATION AUSSI PEUT ÊTRE INCONNUE, ET C'EST UN `null`, PAS UN
 *     DÉFAUT. `useVaultSettings` retombe VOLONTAIREMENT sur
 *     `DEFAULT_VAULT_SETTINGS` quand `GET /:id/settings` échoue — le repli
 *     permissif — et signale l'ignorance par `state === 'unavailable'`. Recopier
 *     ce trente-jours ferait annoncer « détruits 30 jours après leur
 *     suppression » PUIS dater la purge avec, sur un coffre réglé à sept : une
 *     date jusqu'à quatre-vingt-trois jours trop tard, présentée comme un fait,
 *     sur la seule carte de la page qui parle de destruction irréversible.
 *     L'ignorance est donc PORTÉE PAR LE MODÈLE (`retentionDays: null` ⇒ pas
 *     d'échéance), et non par un `if` de rendu que rien n'éprouve — c'est la
 *     même discipline que la règle 3 pour le compte.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Le résumé de la corbeille
// ─────────────────────────────────────────────────────────────────────────────

/** L'échéance de destruction automatique du plus ancien élément. */
export interface NextPurge {
  /** L'instant, en millisecondes. */
  at: number;
  /**
   * L'échéance est DÉPASSÉE et la ligne est toujours là. Ce n'est pas une
   * anomalie : le balayage passe par lots bornés, il peut avoir du retard. On le
   * dit « imminent » plutôt que d'afficher une date du mois dernier pour une
   * purge qui n'a pas eu lieu.
   */
  due: boolean;
}

export interface TrashSummary {
  /**
   * Le nombre d'éléments — `null` quand les agrégats n'ont pas été lus. JAMAIS
   * zéro par défaut : voir la règle 3 de l'en-tête.
   */
  count: number | null;
  /** Les octets occupés — même règle que `count`. */
  bytes: number | null;
  /**
   * La conservation en vigueur sur ce coffre, en jours — `null` quand les
   * réglages n'ont pas été lus. Même règle que `count` : un défaut de repli
   * n'est pas une valeur lue, et l'affirmer serait une promesse chiffrée sur
   * une ignorance.
   */
  retentionDays: number | null;
  /** L'échéance du plus ancien, ou `null` quand on ne la connaît pas. */
  nextPurge: NextPurge | null;
  /**
   * Vrai SEULEMENT sur un compte réellement lu et nul. Une ignorance n'est pas
   * un inventaire : c'est ce booléen qui décide si l'on éteint « Vider la
   * corbeille », et l'éteindre sur une panne de lecture retirerait le geste à
   * qui en a besoin.
   */
  empty: boolean;
}

export function trashSummary(input: {
  trashedCount: number | null;
  trashedBytes: number | null;
  /** La conservation LUE sur ce coffre — `null` si la lecture des réglages est tombée. */
  retentionDays: number | null;
  /** L'instant du plus ancien élément de la corbeille — `null` si inconnu. */
  oldestDeletedAtMs: number | null;
  nowMs: number;
}): TrashSummary {
  const count = typeof input.trashedCount === 'number' ? input.trashedCount : null;
  const empty = count === 0;
  const retentionDays =
    typeof input.retentionDays === 'number' && Number.isFinite(input.retentionDays)
      ? input.retentionDays
      : null;
  // Une corbeille vide n'a pas d'échéance, même si l'on croit connaître un
  // « plus ancien » : la liste qui l'a fourni date d'avant le vidage.
  const oldest = empty ? null : input.oldestDeletedAtMs;
  // ET UNE CONSERVATION QU'ON N'A PAS LUE N'EN DONNE AUCUNE NON PLUS : dater
  // avec le défaut de repli produirait une échéance plausible et fausse (voir la
  // règle 5 de l'en-tête).
  const at =
    retentionDays === null || oldest === null || !Number.isFinite(oldest)
      ? null
      : oldest + retentionDays * 86_400_000;
  return {
    count,
    bytes: typeof input.trashedBytes === 'number' ? input.trashedBytes : null,
    retentionDays,
    nextPurge: at === null ? null : { at, due: at <= input.nowMs },
    empty,
  };
}

/**
 * L'INSTANT DU PLUS ANCIEN ÉLÉMENT DE LA CORBEILLE, lu sur `updatedAt`.
 *
 * POURQUOI `updatedAt` EST BIEN LA DATE DE SUPPRESSION. Le serveur ne sert
 * jamais `deleted_at` : le DTO d'un élément ne le porte pas, et les agrégats non
 * plus. Mais la suppression douce écrit `deleted_at` ET `updated_at` dans le
 * MÊME ordre SQL, et toutes les autres écritures d'un élément (finalisation,
 * correctif de méta, commit d'une révision) portent `AND deleted_at IS NULL` :
 * une ligne qui est DANS la corbeille n'a donc plus été touchée depuis qu'elle y
 * est tombée. La restauration, elle, l'en sort. L'égalité n'est pas une
 * coïncidence — c'est une propriété du schéma, et c'est à ce titre qu'on s'y
 * appuie plutôt que d'inventer une date.
 *
 * Une date ILLISIBLE est ignorée au lieu d'être comptée : un `NaN` glissé dans
 * un minimum empoisonne le calcul entier, et la carte annoncerait une purge
 * datée de 1970.
 */
export function oldestDeletedAt(rows: readonly { updatedAt: string }[]): number | null {
  let plusAncien: number | null = null;
  for (const row of rows) {
    const ms = Date.parse(row.updatedAt);
    if (Number.isNaN(ms)) continue;
    if (plusAncien === null || ms < plusAncien) plusAncien = ms;
  }
  return plusAncien;
}

// ─────────────────────────────────────────────────────────────────────────────
// Le vidage, passe par passe
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Combien de passes au maximum. Le seau du worker est de 30 par heure et par
 * COFFRE : une trente-et-unième ne peut être que refusée, et faire tourner la
 * roue pour une requête dont on sait qu'elle échouera est pire que de s'arrêter
 * en le disant. C'est aussi le garde-fou contre un serveur qui annoncerait
 * éternellement « j'en ai détruit » — la boucle est bornée par un fait, pas par
 * la confiance.
 */
export const TRASH_EMPTY_MAX_PASSES = 30;

/**
 * Ce qu'il faut faire après une passe.
 *
 * `stalled` ET `capped` arrêtent tous deux la boucle, MAIS ILS N'ACCUSENT PAS
 * LA MÊME CHOSE, et c'est pour cela qu'ils sont deux :
 *  · `stalled` — le stockage refuse DURABLEMENT ces objets-là ; c'est un
 *    incident, et ce qui reste est peut-être coincé pour de bon ;
 *  · `capped` — NOUS avons arrêté, sur notre propre borne de passes, parce que
 *    le seau du serveur (30/h et par coffre) est atteint. Le serveur détruit
 *    très bien : il reste simplement à reprendre dans l'heure.
 * Les confondre faisait afficher « il en reste N que le serveur n'arrive pas à
 * détruire » sur une corbeille de plus de mille cinq cents éléments — un
 * diagnostic faux qui envoie chercher une panne inexistante et fait douter du
 * sort de documents qui partiront tout seuls.
 */
export type EmptyTrashStep = 'done' | 'again' | 'stalled' | 'capped';

export function emptyTrashStep(
  pass: { purged: number; remaining: number },
  passesDone: number
): EmptyTrashStep {
  const { purged, remaining } = pass;
  // Une réponse hors contrat (non finie, négative) n'autorise aucune conclusion,
  // et surtout pas celle de recommencer.
  if (!Number.isFinite(purged) || !Number.isFinite(remaining)) return 'stalled';
  if (purged < 0 || remaining < 0) return 'stalled';
  if (remaining === 0) return 'done';
  // LA RÈGLE : plus rien ne tombe, mais il en reste. Rappeler reproduirait la
  // même passe jusqu'au 429.
  if (purged === 0) return 'stalled';
  return passesDone >= TRASH_EMPTY_MAX_PASSES ? 'capped' : 'again';
}

/**
 * La part détruite du total connu au départ, en pourcentage entier — de quoi
 * remplir une `ProgressBar` plutôt qu'une roue qui tourne. Les deux à zéro
 * valent 100 % : il n'y a rien à faire, donc tout est fait.
 */
export function emptyTrashProgressPct(input: { purgedTotal: number; remaining: number }): number {
  const total = input.purgedTotal + input.remaining;
  if (!Number.isFinite(total) || total <= 0) return 100;
  return Math.min(100, Math.max(0, Math.round((input.purgedTotal / total) * 100)));
}

export interface EmptyTrashOutcome {
  outcome: 'done' | 'partial' | 'capped';
  purged: number;
  remaining: number;
}

/**
 * Le verdict final, tel qu'il est. « Corbeille vidée » sur une corbeille qui
 * contient encore sept éléments est exactement le mensonge que cette fiche
 * existe pour empêcher — et c'est un mensonge coûteux : il ferait croire que ces
 * octets ne pèsent plus sur le quota, et que ces documents n'existent plus.
 *
 * TROIS ISSUES, PARCE QU'IL Y A DEUX FAÇONS DE S'ARRÊTER AVANT LA FIN, et
 * qu'elles n'imputent pas la même chose (voir `EmptyTrashStep`). `lastStep` est
 * le verdict de la DERNIÈRE passe : c'est lui, et non le seul `remaining`, qui
 * sait laquelle des deux a stoppé la boucle. Un vidage QUI A TOUT EMPORTÉ à la
 * borne reste un succès — le seau n'a alors rien coûté.
 */
export function emptyTrashOutcome(
  purgedTotal: number,
  remaining: number,
  lastStep: EmptyTrashStep
): EmptyTrashOutcome {
  return {
    outcome: remaining > 0 ? (lastStep === 'capped' ? 'capped' : 'partial') : 'done',
    purged: purgedTotal,
    remaining,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Le mot à taper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * La saisie arme-t-elle le geste ?
 *
 * On rabote et l'on ignore la casse : le but est de faire ÉCRIRE le mot, pas de
 * piéger sur une espace collée par un copier-coller. Un mot attendu VIDE n'arme
 * jamais rien — sans cette garde, une clé i18n manquante transformerait la
 * confirmation en simple clic sur le geste le plus destructeur de la page.
 */
export function matchesConfirmWord(typed: string, expected: string): boolean {
  const attendu = expected.trim();
  if (!attendu) return false;
  return typed.trim().toLocaleUpperCase() === attendu.toLocaleUpperCase();
}
