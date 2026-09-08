/**
 * Verrou d'exclusion du BLOB DE NOTES (`notes.enc`) dans le PROCESSUS PRINCIPAL
 * — une seule chaîne de promesses partagée par tout ce qui fait
 * lire-modifier-écrire dessus.
 *
 * POURQUOI. Deux chemins concurrents écrivent le même fichier :
 *  - `downloadAndMergeNotes` (cycle de sync) : lire → déchiffrer → fusionner →
 *    chiffrer → écrire, avec plusieurs `await` entre la lecture et l'écriture ;
 *  - `notes:save` (auto-save du renderer) : garde anti-vidage (qui STAT le
 *    fichier) puis écriture.
 * Sans verrou, une sauvegarde qui s'intercale entre la lecture et l'écriture de
 * la fusion est écrasée par cette dernière — la frappe part définitivement — et
 * symétriquement une fusion peut être annulée par une sauvegarde partie avant
 * elle. Pire : les deux passent par `StorageService.encryptToFile`, dont le
 * temporaire est voisin du fichier final ; deux écritures simultanées se
 * marchaient dessus et pouvaient publier un `notes.enc` composite illisible.
 *
 * Jumeau du verrou web (`src/platform/web/sync/notesLock.ts`), volontairement
 * DUPLIQUÉ : `electron/tsconfig.json` a pour racine `electron/`, importer un
 * module de `src/` déplacerait toute l'arborescence émise dans `dist-electron`.
 *
 * Le verrou est GLOBAL au module (et non par profil) : seul le blob du profil
 * actif est écrit, et une file unique interdit toute interversion. Une tâche qui
 * jette ne bloque pas la file.
 */

let chain: Promise<unknown> = Promise.resolve();

/**
 * Exécute `task` en exclusion mutuelle avec toutes les autres tâches passées par
 * ce verrou. Ne JAMAIS imbriquer un `withNotesLock` dans un autre : la file
 * étant strictement séquentielle, l'appel interne attendrait l'externe pour
 * toujours.
 */
export function withNotesLock<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  // La file avance quoi qu'il arrive : un échec ne doit pas figer le suivant.
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
