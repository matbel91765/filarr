/**
 * Modèle PUR des gestes de partage d'une note — ce que la liste des notes
 * décide AVANT de dessiner quoi que ce soit.
 *
 * Deux vérités distinctes gouvernent l'entrée « Ajouter au coffre partagé… » :
 *  — le DROIT (`selectCanUseTeamVaults` : offre payante ou invité d'un coffre) ;
 *  — la POSSIBILITÉ ici et maintenant (`useVaultAddTargets` : au moins un
 *    coffre déverrouillé où ce compte écrit).
 *
 * Les confondre donnait deux défauts symétriques : une entrée absente pour qui
 * a le droit mais dont tous les coffres sont verrouillés (« le partage a
 * disparu ? »), ou une entrée qui s'ouvre sur une boîte vide. D'où trois états,
 * pas deux — et la doctrine anti-mur-de-vente de `AddToVaultDialog` : sans le
 * droit, PAS d'entrée du tout (un menu contextuel n'est pas un endroit où
 * vendre) ; avec le droit mais sans cible, une entrée visible, désactivée, qui
 * DIT pourquoi.
 */

export type AddToVaultMenuState = 'hidden' | 'disabled' | 'enabled';

export function addToVaultMenuState(input: {
  canUse: boolean;
  hasTargets: boolean;
}): AddToVaultMenuState {
  if (!input.canUse) return 'hidden';
  return input.hasTargets ? 'enabled' : 'disabled';
}

/**
 * Le geste du bouton de partage d'une note : une note JAMAIS déposée passe par
 * le dépôt (choix du coffre, copier/déplacer) ; une note déjà déposée ouvre le
 * dialogue de partage unifié, qui sait montrer OÙ elle est et proposer un
 * second dépôt. Un seul bouton, deux portes — la bonne selon l'histoire de la
 * note, sans demander à l'utilisateur de la connaître.
 */
export type NoteShareGesture = 'addToVault' | 'manageSharing';

export function noteShareGesture(sharedCount: number): NoteShareGesture {
  return sharedCount > 0 ? 'manageSharing' : 'addToVault';
}
