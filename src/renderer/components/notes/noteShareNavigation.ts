/**
 * Où MÈNE un dépôt de note — le seul endroit qui traduit un `NoteShareRef`
 * en route.
 *
 * Aujourd'hui, cliquer le badge « Partagée » ouvre le COFFRE qui contient la
 * copie (`/vault-folder/<id>`, la forme canonique de `routeCompat`) : c'est ce
 * que l'écran des coffres sait rendre. Le jour où un élément aura une adresse
 * profonde (`/vault-folder/<id>?item=<itemId>` ou autre), c'est ICI, et
 * seulement ici, qu'on la fabriquera — le badge, ses variantes et ses tests
 * ne connaissent que `vaultShareDestination(ref)`.
 *
 * Module sans React ni Redux, pour que le modèle du badge (et sa suite vitest)
 * puissent l'importer sans traîner le rendu.
 */

import type { NoteShareRef } from '../../../types/notes';
import { notesVaultNoteRoute, vaultFolderRoute } from '../layout/RouteContent/routeCompat';

/** La route à ouvrir pour aller voir la copie décrite par `ref`. */
export function vaultShareDestination(ref: Pick<NoteShareRef, 'vaultId' | 'itemId'>): string {
  return vaultFolderRoute(ref.vaultId);
}

/**
 * L'ADRESSE PROFONDE d'une note de coffre : celle qui l'OUVRE dans l'éditeur —
 * SANS QUITTER L'ONGLET NOTES.
 *
 * ELLE MENAIT À L'EXPLORATEUR DU COFFRE, ET C'ÉTAIT LE DÉFAUT RAPPORTÉ : « pour
 * les notes dans un coffre partagé, ça n'ouvre pas dans les notes de base de
 * l'app ». Un clic sur une ligne de la section « Coffres partagés » emportait la
 * personne dans un explorateur de fichiers, où une modale s'ouvrait par-dessus.
 * Or ce clic dit une chose et une seule : « je veux lire cette note ». Il doit
 * donc la poser à l'écran là où on est, exactement comme un clic sur une note
 * personnelle — et c'est ce que fait `notesVaultNoteRoute`.
 *
 * L'ÉDITEUR MONTÉ RESTE `VaultNoteEditor`, et ce n'est pas négociable : c'est
 * lui qui tient la salle, l'élection d'enregistrement, le veto de lecture seule
 * du relais et la bannière de version plus récente. Seul son CADRE change
 * (`variant="pane"`), pas une ligne de sa logique.
 *
 * IL RESTE DISTINCT DE `vaultShareDestination`, ET CE N'EST PAS UN DOUBLON.
 * Les deux gestes ne demandent pas la même chose. Le badge « Partagée » d'une
 * note personnelle dit « votre copie est là-bas » : il MONTRE le coffre, et
 * ouvrir d'autorité un éditeur sur une copie que la personne n'a pas demandé à
 * modifier serait un geste pris en son nom. La section, elle, liste des notes
 * pour qu'on les ouvre — c'est sa seule raison d'être. Fondre les deux dans un
 * seul helper obligerait à choisir un comportement pour les deux, et l'un des
 * deux appelants aurait tort.
 */
export function vaultNoteDestination(vaultId: string, itemId: string): string {
  return notesVaultNoteRoute(vaultId, itemId);
}

/**
 * LE CHEMIN DU RETOUR — la note, mais vue depuis l'explorateur de son coffre.
 *
 * Rester dans l'onglet Notes ne doit pas emmurer : depuis une note de coffre on
 * doit pouvoir rejoindre le dossier qui la contient (ses voisins, ses réglages,
 * son historique). C'est l'ancienne destination, gardée pour ce qu'elle est
 * vraiment : un geste EXPLICITE, et non plus le sort de tous les clics.
 *
 * IL MONTRE, IL N'OUVRE PLUS (`?item=` seul, sans `open=1`), et ce détail d'une
 * option retirée est devenu une BOUCLE le jour où l'explorateur s'est mis à
 * trancher l'intention d'ouverture selon le droit d'écrire
 * (`vaultNoteOpenTarget`). Pour un rédacteur, « ouvrir cette note » veut
 * désormais dire « dans l'onglet Notes » — c'est-à-dire exactement le panneau
 * qu'il vient de quitter : `open=1` le renverrait aussitôt d'où il vient, en
 * aller-retour serré entre deux onglets.
 *
 * Et c'est de toute façon ce que le bouton PROMET : « ← nom du coffre » dit
 * « montre-moi le dossier », pas « rouvre-moi la note ». `?item=` fait
 * précisément cela — il place l'explorateur dans le bon dossier, sélectionne la
 * carte et l'amène à l'écran.
 */
export function vaultNoteExplorerDestination(vaultId: string, itemId: string): string {
  return vaultFolderRoute(vaultId, { itemId });
}
