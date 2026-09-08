/**
 * OUBLIER LES SECRETS DE SESSION — en un seul geste, parce qu'il en faut trois.
 *
 * Quatre chemins perdent la FEK : le verrouillage automatique, l'effacement à
 * distance, la veille de politique, et la déconnexion. Chacun réécrivait la même
 * séquence à la main, et la déconnexion n'en faisait qu'UN tiers — ce qui
 * laissait derrière elle, à chaque fois :
 *
 *   · LES CLÉS DE SALLE COLLAB, qui dérivent de la FEK. De quoi déchiffrer le
 *     trafic d'un coffre dont on vient de partir, plus les sessions vivantes,
 *     leurs sockets et leurs minuteurs, qui continuent de battre pour un compte
 *     qui n'est plus là.
 *   · UNE SESSION « AUTHENTIFIÉE, DÉVERROUILLÉE » SANS FEK. L'écran de
 *     déverrouillage ne s'ouvrait pas, personne ne redérivait quoi que ce soit,
 *     et tout déchiffrement local échouait en silence — dossiers et notes
 *     compris.
 *
 * D'où cette fonction : la séquence a UN endroit, et un cinquième chemin ne peut
 * plus en oublier la moitié.
 *
 * ET ELLE COMMENCE PAR ÉCRIRE, pas par effacer. L'auto-save des notes retient
 * jusqu'à deux secondes de frappe dans un debounce : effacer la clé pendant
 * cette fenêtre condamne l'écriture qui suivra, et la frappe est perdue. Tant
 * que le main gardait ses clés après un verrouillage, l'écriture tardive passait
 * quand même — c'est précisément ce que la porte du main (`vaultLockState`)
 * cesse de tolérer. On purge donc AVANT, et on attend.
 */

import { clearHybridCrypto } from './hybridCrypto';
import { clearCustodySession } from '../custody/custodySession';
import { purgeCollabOnKeyLoss } from '../collab/collabSession';
import { flushPendingNotesSave } from '../../store/notesAutosaveFlush';
import { lockApp } from '../../store/slices/authSlice';
import type { LockReason } from '../../store/slices/authSlice';

/** Ce que la séquence sait faire, sans dépendre du type exact du store. */
type Dispatcher = (action: ReturnType<typeof lockApp>) => unknown;

/**
 * `dispatch` à `null` pour l'effacement à distance SEULEMENT : il recharge la
 * fenêtre entière juste après, et y poser un écran de verrouillage serait un
 * clignotement sans lecteur. Partout ailleurs, l'omettre laisserait une session
 * qui se croit ouverte sans une clé pour l'être.
 */
export async function forgetSessionSecrets(
  dispatch: Dispatcher | null,
  reason?: LockReason
): Promise<void> {
  // 0. Ce que le debounce retenait atteint le disque PENDANT qu'une clé existe
  //    encore. Sauf effacement à distance (`dispatch` à `null`) : écrire juste
  //    avant de détruire n'aurait aucun sens, et courrait après le rechargement.
  //    Toujours résolue, jamais rejetée — un échec d'écriture ne doit pas
  //    empêcher l'effacement qui suit.
  if (dispatch) await flushPendingNotesSave();
  // 1. La FEK, la clé de session du main, la paire de clés, les K_vault ouvertes.
  clearHybridCrypto();
  // 2. Ce qui en DÉRIVE : clés de salle, sessions vivantes, documents, minuteurs.
  purgeCollabOnKeyLoss();
  // 2 bis. LA CLÉ DE GARDE DU COMPTE. Elle ne dérive PAS de la FEK — c'est un
  //    secret de compte, pas de coffre — mais elle vit dans la même mémoire de
  //    renderer et ouvre les libellés de tous les partages du compte. La
  //    laisser derrière ferait lire au suivant les noms que le précédent a
  //    donnés à ses liens. Retour à `unknown` et non `absent` : cette machine
  //    ne sait plus rien du compte d'après, et `absent` ferait afficher « pas
  //    de coffre » à quelqu'un qui en a un.
  //
  //    La mémoire « se souvenir sur cet appareil », elle, n'est PAS touchée
  //    ici : un verrouillage automatique ne doit pas défaire un consentement
  //    de quatorze jours. C'est la DÉCONNEXION qui l'emporte, et elle le fait
  //    côté principal, avec les jetons (`authService.logout`).
  clearCustodySession();
  // 3. Et le dire à l'écran, sans quoi l'application se croit encore ouverte.
  dispatch?.(lockApp(reason));
}
