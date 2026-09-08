/**
 * Purge de la sauvegarde de notes EN ATTENTE — point de rendez-vous minuscule.
 *
 * L'auto-save des notes vit dans `App.tsx` : un abonnement au store qui arme un
 * debounce de 2 s. Pendant ces 2 s, l'état à écrire n'existe que dans Redux.
 *
 * Or la sync peut annoncer `notes-updated` à tout moment, et le renderer y
 * répond par `loadNotesFromDisk`, qui REMPLACE `byId` par ce que porte le
 * disque. Tombé dans la fenêtre du debounce, ce remplacement effaçait le
 * déplacement (ou la frappe) que l'utilisateur venait de faire — et le timer,
 * lui, finissait par partir et re-persistait l'état périmé.
 *
 * D'où ce sas : avant d'appliquer un rechargement venu de la sync, on force
 * l'écriture en attente et on l'attend. `notes:save` et la fusion de la
 * descente partagent déjà le même verrou côté main (`withNotesLock`), donc une
 * fois cette promesse tenue, le disque porte bien le travail de l'utilisateur.
 *
 * Choisi plutôt qu'une fusion note à note côté renderer : le main SAIT déjà
 * fusionner (`mergeNotesPayload`), en refaire une deuxième dans le renderer
 * aurait ajouté un second arbitre — et deux arbitres qui divergent, c'est de la
 * perte de notes. Ici, on se contente de ne pas court-circuiter le premier.
 *
 * Pas de plomberie Redux : une action de plus aurait retraversé le middleware
 * qui, justement, est l'appelant.
 */

type FlushFn = () => Promise<void>;

let pendingFlush: FlushFn | null = null;

/**
 * Publie (ou retire, avec `null`) la fonction de purge. Appelé par l'effet
 * d'auto-save d'`App.tsx` — l'inscription suit exactement la durée de vie de
 * l'abonnement, sinon on garderait une fermeture sur un store démonté.
 */
export function registerNotesAutosaveFlush(fn: FlushFn | null): void {
  pendingFlush = fn;
}

/**
 * Écrit tout de suite ce que le debounce retenait. Sans écriture en attente,
 * résout immédiatement. Toujours résolue : un échec d'écriture ne doit pas
 * empêcher le rechargement qui suit (le disque est simplement resté ce qu'il
 * était, et la prochaine sauvegarde réessaiera).
 */
export async function flushPendingNotesSave(): Promise<void> {
  if (!pendingFlush) return;
  try {
    await pendingFlush();
  } catch {
    /* best-effort — voir plus haut */
  }
}

// ==================== Remise à zéro du jeu des notes SALES ====================

/**
 * Second point de rendez-vous, même esprit que le premier.
 *
 * L'auto-save d'`App.tsx` ne compare plus l'identité GLOBALE de `byId` : il
 * diffe CLÉ PAR CLÉ pour ne réécrire que les notes touchées. Ce diff a une
 * base — l'état vu à la sauvegarde précédente — et un cas où cette base saute :
 * `loadNotesFromDisk.fulfilled` REMPLACE `byId` en bloc. Sans rien, le diff
 * verrait alors les ~6 000 notes comme modifiées et armerait une écriture pleine
 * parfaitement inutile : ce que Redux porte à cet instant SORT du disque.
 *
 * D'où cette remise à zéro, appelée par le middleware Redux qui voit passer
 * l'action (`electronMiddleware`). Le middleware s'exécute APRÈS les abonnés du
 * store — le diff aura donc déjà tout marqué : on repart de l'état courant et on
 * désarme le minuteur.
 *
 * Pas de plomberie Redux ici non plus : une action de plus retraverserait
 * justement le middleware qui l'émet.
 */
type ResetFn = () => void;

let pendingDirtyReset: ResetFn | null = null;

/** Publie (ou retire, avec `null`) la remise à zéro. Suit la vie de l'abonnement. */
export function registerNotesDirtyReset(fn: ResetFn | null): void {
  pendingDirtyReset = fn;
}

/** Déclare l'état PROPRE : ce que porte Redux est exactement ce que porte le disque. */
export function markNotesStateClean(): void {
  if (!pendingDirtyReset) return;
  try {
    pendingDirtyReset();
  } catch {
    /* best-effort : au pire une écriture pleine de plus, jamais une perte */
  }
}
