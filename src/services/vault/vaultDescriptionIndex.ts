/**
 * vaultDescriptionIndex (F27) — la description courte d'un coffre, LUE, jamais
 * demandée.
 *
 * LE PROBLÈME. La description vit dans le bloc scellé des réglages
 * (`GET /vaults/:id/settings`, puis un déchiffrement sous K_vault de son
 * époque). L'Aperçu de la page « Gérer le coffre » l'a sous la main : il vient
 * précisément de lire cette ligne. Les CARTES de l'accueil, elles, sont une
 * dizaine à l'écran en même temps — une lecture par carte serait une dizaine de
 * requêtes au montage de l'accueil, chacune suivie d'un déchiffrement. C'est
 * exactement ce que le dossier a interdit pour l'effectif des coffres (« une
 * requête pour toutes les cartes, jamais un appel par carte ») et pour les têtes
 * du fil d'activité.
 *
 * LA RÉPONSE. Un index en MÉMOIRE, alimenté par ceux qui lisent ces réglages de
 * toute façon (`useVaultSettings` : l'explorateur du coffre, sa page de gestion,
 * le panneau de partage par élément), et LU par les cartes. Une carte ne demande
 * rien : elle affiche ce que cette session sait déjà. Ouvrir un coffre une fois
 * suffit à ce que sa carte porte sa description ensuite.
 *
 * ÉCART ASSUMÉ, ET IL EST ICI POUR QUE LA PROCHAINE SESSION NE LE RELISE PAS
 * COMME UN DÉFAUT : au tout premier démarrage, aucune carte ne porte de
 * description. C'est un manque d'information, pas une affirmation — la ligne
 * n'apparaît simplement pas, et rien à l'écran ne dit « ce coffre n'a pas de
 * description ». Le jour où le serveur servira les réglages en lot (avec les
 * têtes de partage, par exemple), c'est cet index-là qu'il remplira, sans qu'une
 * seule carte ne change.
 *
 * EN MÉMOIRE, ET PAS DANS `localStorage` — contrairement au repère d'apparence
 * personnel, qui, lui, n'a jamais quitté cet appareil. Une description est du
 * CONTENU du coffre : elle arrive chiffrée sous K_vault, et la ranger en clair
 * sur le disque la rendrait lisible sans le coffre — c'est-à-dire qu'elle
 * survivrait au verrouillage. Le coût est qu'elle ne survit pas au redémarrage ;
 * c'est le bon côté du marché.
 *
 * ET ELLE MEURT AVEC K_vault, PAS « QUELQUE PART ». Le paragraphe ci-dessus ne
 * vaut que si quelqu'un efface vraiment : la description est du contenu déchiffré
 * sous K_vault, donc elle suit K_vault hors mémoire — `vaultKeyCache` appelle
 * l'oubli DEPUIS `clearVaultKeys()` (verrouillage, déconnexion, changement de
 * profil, branche de contrainte) et depuis `lockVault(vaultId)` (départ d'un
 * coffre). C'est la règle que `collabKeys` énonce pour ses clés de salle (« le
 * cache module suit les secrets dont il dérive »), et elle est câblée DANS le
 * cache de clés plutôt qu'à côté de chacun de ses appelants : un troisième
 * chemin de purge écrit demain l'hérite sans rien savoir de cet index.
 *
 * ON N'ÉCRIT QUE CE QU'ON A SU LIRE. `remember` n'est appelé qu'après un
 * déchiffrement RÉUSSI : un bloc qu'on n'a pas su ouvrir ne doit pas effacer la
 * description qu'un tour précédent avait obtenue. Une absence d'information ne
 * se rend pas en verdict — ici, le verdict serait « ce coffre n'a plus de
 * description ».
 */

/** Les abonnés (`useSyncExternalStore`) — un seul jeu pour toute l'application. */
const abonnes = new Set<() => void>();

export function subscribeVaultDescriptions(fn: () => void): () => void {
  abonnes.add(fn);
  return () => {
    abonnes.delete(fn);
  };
}

/**
 * L'index. La valeur est la description RÉELLEMENT lue, chaîne vide comprise :
 * « ce coffre n'a pas de description » est une réponse, et elle diffère de
 * « on n'a pas lu », qui est l'absence de clé.
 */
const index = new Map<string, string>();

/** Ce que cette session sait de la description de ce coffre — `undefined` = rien. */
export function getVaultDescription(vaultId: string): string | undefined {
  return index.get(vaultId);
}

/**
 * Retenir une description RÉELLEMENT déchiffrée.
 *
 * Sans effet si rien ne change : `useSyncExternalStore` re-rend tous les abonnés
 * à chaque notification, et l'explorateur relit ces réglages à chaque montage.
 */
export function rememberVaultDescription(vaultId: string, description: string): void {
  if (index.get(vaultId) === description) return;
  index.set(vaultId, description);
  for (const fn of abonnes) fn();
}

/**
 * Oublier CE coffre-là (on vient de le quitter, sa clé est partie).
 *
 * Ciblé, parce que quitter un coffre ne dit rien des autres : tout effacer
 * retirerait de toutes les cartes des descriptions parfaitement lisibles.
 */
export function forgetVaultDescription(vaultId: string): void {
  if (!index.delete(vaultId)) return;
  for (const fn of abonnes) fn();
}

/** Oublier tout (changement de profil ou de compte, verrouillage). */
export function forgetVaultDescriptions(): void {
  if (index.size === 0) return;
  index.clear();
  for (const fn of abonnes) fn();
}
