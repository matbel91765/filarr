/**
 * L'ORDRE DES CARNETS FRÈRES ET SŒURS.
 *
 * ── LE DÉFAUT QUE CE MODULE FERME ───────────────────────────────────────────
 *
 * `selectNotebookTree` triait la fratrie par `name.localeCompare` et RIEN
 * D'AUTRE. Or le téléphone offre un rangement manuel (glissé dans l'arbre) et
 * s'en souvient dans un champ `order` qu'il écrit sur le carnet
 * (`filarr-mobile/src/services/notes/notebooks/model.ts`). Ce champ traverse
 * déjà la synchronisation intact — la fusion des notes arbitre des ENTRÉES
 * ENTIÈRES (`electron/sync/notesMergeCore.ts`) et `updateNotebook` recopie par
 * `Object.assign` — mais l'ordinateur ne le LISAIT pas : quelqu'un qui range
 * ses carnets sur son téléphone rouvrait son ordinateur et retrouvait l'ordre
 * alphabétique, sans rien pour lui dire que son rangement existait toujours.
 *
 * ── CE QUE LE BUREAU NE FAIT PAS, ET NE DOIT PAS FAIRE ───────────────────────
 *
 * IL NE POSE JAMAIS `order`. `addNotebook` énumère ses champs et n'en met pas ;
 * aucun écran n'offre de glissé. Un carnet né ici produit donc exactement les
 * octets d'avant, et un `order` posé là-bas n'est jamais écrasé. Le jour où le
 * bureau offrira le glissé, ce sera une décision séparée — pas un effet de
 * bord de la lecture.
 *
 * ── LA RÈGLE, DANS L'ORDRE ──────────────────────────────────────────────────
 *
 *   1. le rang manuel, quand il y en a un ;
 *   2. les carnets SANS rang passent APRÈS ceux qui en ont un (`+Infinity`) —
 *      un carnet arrivé du nuage après un rangement ne saute pas en tête ;
 *   3. à rang égal (ou tous deux sans rang), le NOM, `localeCompare` nu, celui
 *      d'avant : une bibliothèque jamais rangée rend la MÊME liste qu'avant ;
 *   4. l'identifiant départage les homonymes — sans lui, deux carnets du même
 *      nom s'échangeraient de place d'un rendu à l'autre au gré de
 *      `Object.values`.
 *
 * C'est mot pour mot `compareSiblings` du mobile : les deux applications
 * doivent rendre la MÊME liste, sans quoi le rangement ne « tient » que d'un
 * côté et l'utilisateur ne sait plus lequel croire.
 */

/** Le peu qu'il faut connaître d'un carnet pour le ranger. */
export interface SortableNotebook {
  id: string;
  name?: string;
  /**
   * Rang manuel, ÉCRIT PAR LE MOBILE UNIQUEMENT. Absent sur tout carnet né au
   * bureau, et c'est très bien : absent veut dire « range-moi par nom ».
   */
  order?: number;
}

/**
 * Le rang effectif : un nombre FINI, ou `+Infinity` quand il n'y en a pas.
 *
 * `NaN` et l'infini reçus tels quels comptent pour « pas de rang » : un `NaN`
 * rendrait toutes les comparaisons fausses et l'ordre de la fratrie deviendrait
 * celui de `Object.values`, c'est-à-dire aucun.
 */
export function notebookRank(nb: SortableNotebook): number {
  return typeof nb.order === 'number' && Number.isFinite(nb.order)
    ? nb.order
    : Number.POSITIVE_INFINITY;
}

/** Le comparateur de fratrie — rang, puis nom, puis identifiant. */
export function compareNotebookSiblings(a: SortableNotebook, b: SortableNotebook): number {
  const ra = notebookRank(a);
  const rb = notebookRank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  const byName = (a.name ?? '').localeCompare(b.name ?? '');
  if (byName !== 0) return byName;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
