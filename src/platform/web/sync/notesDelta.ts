/**
 * APPLICATION D'UN DELTA DE NOTES sur un coffre déjà déchiffré — logique PURE.
 *
 * Jumeau EXACT de `electron/sync/notesDelta.ts` (où vit la note d'intention
 * complète), volontairement DUPLIQUÉ pour la même raison que `notesLock.ts` :
 * `electron/tsconfig.json` a pour racine `electron/`, et le build CRA interdit
 * à `src/` de sortir de son périmètre. Toute correction ici doit être reportée
 * là-bas, et réciproquement — la suite `notesDelta.vitest.ts` fait tourner les
 * mêmes contrats des deux côtés.
 *
 * Les deux règles qui portent tout :
 *  1. RIEN NE DISPARAÎT SANS ÊTRE NOMMÉ dans `removedIds` — une note que la
 *     fusion nuage vient d'ajouter et que le renderer ignore encore survit.
 *  2. LA FORME ÉCRITE EST CELLE DE `notes:save`, champ pour champ et clé pour
 *     clé, sans quoi chaque côté de la synchronisation voit une différence que
 *     l'autre ne voit pas et les appareils se renvoient le coffre sans fin.
 */

/** Une note, vue d'ici : un objet opaque dont on ne lit que `deletedAt`. */
export type NoteRecord = Record<string, unknown>;

/** Le coffre tel qu'il est persisté (blob chiffré desktop ou IndexedDB web). */
export interface NotesVaultPayload {
  byId: Record<string, NoteRecord>;
  allIds: string[];
  templates?: unknown[];
  notebooks?: Record<string, unknown>;
  purged?: Record<string, string>;
  purgedNotebooks?: Record<string, string>;
  skipVersioning?: boolean;
  [key: string]: unknown;
}

/** Charge utile du canal `notes:saveDelta`. */
export interface NotesDeltaPayload {
  /** Notes touchées depuis la dernière écriture, entières. */
  dirtyById: Record<string, NoteRecord>;
  /** Notes SUPPRIMÉES DÉFINITIVEMENT (la corbeille passe par `dirtyById`). */
  removedIds: string[];
  /** Ordre d'affichage faisant autorité côté renderer. */
  allIds: string[];
  /**
   * PAR NOTE SALE, L'`updatedAt` QUE LE RENDERER AVAIT SOUS LES YEUX AVANT DE
   * LA MODIFIER — sa BASE. C'est ce qui rend l'écriture vérifiable : sans elle,
   * une copie périmée écrase une fusion tout juste rapatriée, et la régression
   * repart au nuage comme si elle était neuve.
   *
   * `null` = aucune copie côté renderer (note neuve). Clé absente = pas de
   * garde pour cette note (comportement d'avant, conservé).
   *
   * ⚠ MIROIR EXACT de `electron/sync/notesDelta.ts` — les deux copies sont
   * confrontées aux mêmes contrats dans `notesDelta.vitest.ts`.
   */
  baseUpdatedAt?: Record<string, string | null>;
  templates?: unknown[];
  notebooks?: Record<string, unknown>;
  purged?: Record<string, string>;
  purgedNotebooks?: Record<string, string>;
  skipVersioning?: boolean;
}

/** Le delta a-t-il la forme attendue ? Sinon : sauvegarde PLEINE, jamais partielle. */
export function isWellFormedNotesDelta(value: unknown): value is NotesDeltaPayload {
  if (!value || typeof value !== 'object') return false;
  const d = value as Partial<NotesDeltaPayload>;
  if (!d.dirtyById || typeof d.dirtyById !== 'object' || Array.isArray(d.dirtyById)) return false;
  if (!Array.isArray(d.removedIds)) return false;
  if (!Array.isArray(d.allIds)) return false;
  return true;
}

/** La base relue est-elle un coffre exploitable ? Sinon : on n'applique rien. */
export function isUsableNotesBase(value: unknown): value is NotesVaultPayload {
  if (!value || typeof value !== 'object') return false;
  const b = value as Partial<NotesVaultPayload>;
  if (!b.byId || typeof b.byId !== 'object' || Array.isArray(b.byId)) return false;
  if (!Array.isArray(b.allIds)) return false;
  return true;
}

/** Horloge d'une entrée : la plus récente de ses dates de mutation, ou -∞. */
function deltaClock(entry: unknown): number {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return -Infinity;
  const rec = entry as Record<string, unknown>;
  let best = -Infinity;
  for (const field of ['updatedAt', 'deletedAt']) {
    const raw = rec[field];
    if (typeof raw !== 'string') continue;
    const ms = Date.parse(raw);
    if (!Number.isNaN(ms) && ms > best) best = ms;
  }
  return best;
}

/** Horloge d'une base DÉCLARÉE (un `updatedAt` seul, ou rien). */
function declaredClock(raw: string | null | undefined): number {
  if (typeof raw !== 'string') return -Infinity;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? -Infinity : ms;
}

/**
 * LES NOTES DU DELTA QUI ARRIVENT TROP TARD.
 *
 * Refusée = le disque a AVANCÉ sous les pieds du renderer : l'entrée de la base
 * porte une horloge STRICTEMENT plus récente que la base déclarée. Trois
 * non-refus délibérés : aucune base déclarée, note absente de la base (un
 * AJOUT ne détruit rien), disque égal ou en retard. `removedIds` n'est pas
 * gardé — une purge est un geste explicite.
 *
 * ⚠ MIROIR EXACT de `electron/sync/notesDelta.ts`.
 */
export function selectStaleDeltaEntries(
  base: NotesVaultPayload,
  delta: NotesDeltaPayload
): string[] {
  const declared = delta.baseUpdatedAt;
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) return [];
  const stale: string[] = [];
  for (const id of Object.keys(delta.dirtyById)) {
    if (!Object.prototype.hasOwnProperty.call(declared, id)) continue;
    const current = base.byId[id];
    if (current === undefined) continue;
    if (deltaClock(current) > declaredClock(declared[id])) stale.push(id);
  }
  return stale;
}

/**
 * Applique `delta` à `base` et rend un coffre NEUF (la base n'est jamais mutée).
 * Les notes que `selectStaleDeltaEntries` désigne sont SAUTÉES : la base garde
 * la sienne, et l'appelant doit faire recharger le renderer.
 */
export function applyNotesDelta(
  base: NotesVaultPayload,
  delta: NotesDeltaPayload
): NotesVaultPayload {
  const byId: Record<string, NoteRecord> = { ...base.byId };
  const stale = new Set(selectStaleDeltaEntries(base, delta));

  // Les retraits d'abord : un id présent dans les deux listes est RÉÉCRIT, pas
  // effacé — le renderer peut avoir purgé puis recréé la même identité.
  for (const id of delta.removedIds) delete byId[id];
  for (const id of Object.keys(delta.dirtyById)) {
    if (stale.has(id)) continue;
    const note = delta.dirtyById[id];
    if (note && typeof note === 'object') byId[id] = note;
  }

  const allIds: string[] = [];
  const seen = new Set<string>();
  for (const id of delta.allIds) {
    if (byId[id] !== undefined && !seen.has(id)) {
      allIds.push(id);
      seen.add(id);
    }
  }
  for (const id of Object.keys(byId)) {
    if (!seen.has(id)) {
      allIds.push(id);
      seen.add(id);
    }
  }

  const purged = delta.purged;
  const purgedNotebooks = delta.purgedNotebooks;
  return {
    byId,
    allIds,
    templates: delta.templates ?? (base.templates as unknown[] | undefined) ?? [],
    notebooks: delta.notebooks ?? (base.notebooks as Record<string, unknown> | undefined) ?? {},
    ...(purged && Object.keys(purged).length > 0 ? { purged } : {}),
    ...(purgedNotebooks && Object.keys(purgedNotebooks).length > 0 ? { purgedNotebooks } : {}),
    skipVersioning: delta.skipVersioning === true,
  };
}

/** Même critère de vacuité que la garde anti-vidage de `notes:save`. */
export function isEmptyNotesVault(payload: NotesVaultPayload): boolean {
  return payload.allIds.length === 0 && Object.keys(payload.byId).length === 0;
}
