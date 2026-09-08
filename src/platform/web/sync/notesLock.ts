/**
 * Verrou d'exclusion du STORE DE NOTES (`notes_enc`) — deux étages : une chaîne
 * de promesses pour l'onglet courant, un Web Lock nommé pour tous les autres.
 *
 * POURQUOI. Deux chemins concurrents écrivent le même blob :
 *  - `installNotes` (cycle de sync) : lire → déchiffrer → fusionner → chiffrer
 *    → écrire, avec plusieurs `await` entre la lecture et l'écriture ;
 *  - `notes:save` (auto-save du renderer) : garde anti-vidage (qui LIT le blob)
 *    puis écriture ;
 *  - `buildNotesContainer` (remontée) : lit ce qui part sur le câble.
 * Sans verrou, une sauvegarde qui s'intercale entre la lecture et l'écriture de
 * la fusion est écrasée par cette dernière — la frappe part définitivement, et
 * symétriquement une fusion peut être annulée par une sauvegarde partie avant
 * elle. IndexedDB ne protège que l'atomicité d'une clé, pas la séquence.
 *
 * DEUX ÉTAGES, parce qu'une chaîne de promesses est une variable de MODULE :
 * elle ne connaît que son propre onglet. Or IndexedDB est partagé par tous les
 * onglets de l'origine, et l'application y tourne volontiers en double —
 * chacun avec son ordonnanceur de sync. `navigator.locks` (Web Locks) porte
 * l'exclusion entre onglets ; là où l'API manque (environnement de test, vieux
 * navigateur, contexte non sécurisé), la chaîne locale reste seule et le
 * comportement est exactement celui d'avant.
 *
 * Le verrou est volontairement GLOBAL (et non par profil) : le store de notes
 * du profil actif est le seul écrit, et une file unique évite toute possibilité
 * d'interversion. Une tâche qui jette ne bloque pas la file.
 */

/** Nom du Web Lock — partagé par tous les onglets de l'origine. */
const NOTES_LOCK_NAME = 'filarr-notes';

let _chain: Promise<unknown> = Promise.resolve();

/** L'API Web Locks est-elle réellement utilisable ici ? */
function lockManager(): LockManager | null {
  if (typeof navigator === 'undefined') return null;
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  return locks && typeof locks.request === 'function' ? locks : null;
}

/**
 * Exécute `task` en exclusion mutuelle avec toutes les autres tâches passées
 * par ce verrou — dans cet onglet ET dans les autres. Ne JAMAIS imbriquer un
 * `withNotesLock` dans un autre : les deux étages étant strictement
 * séquentiels, l'appel interne attendrait l'externe pour toujours.
 */
export function withNotesLock<T>(task: () => Promise<T>): Promise<T> {
  const guarded = (): Promise<T> => {
    const locks = lockManager();
    if (!locks) return task();
    // Le Web Lock est pris APRÈS le tour de file local : la chaîne garde
    // l'ordre d'arrivée dans l'onglet, le Web Lock exclut les autres onglets.
    return locks.request(NOTES_LOCK_NAME, () => task()) as Promise<T>;
  };
  const run = _chain.then(guarded, guarded);
  // La file avance quoi qu'il arrive : un échec ne doit pas figer le suivant.
  _chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
