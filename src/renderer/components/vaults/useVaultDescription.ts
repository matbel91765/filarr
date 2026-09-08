/**
 * useVaultDescription (F27) — la description courte d'un coffre, telle que cette
 * session la connaît.
 *
 * TROIS SURFACES la montrent : les cartes de l'accueil (les trois dessins de
 * `VaultCards`), le fil d'Ariane de l'explorateur, et la fiche d'identité de la
 * page de gestion — cette dernière l'a directement sous la main, puisqu'elle
 * vient de lire les réglages. Les deux autres la LISENT dans l'index en
 * mémoire (`vaultDescriptionIndex`) : une carte ne fait jamais de requête, c'est
 * la règle des cartes de coffre depuis l'effectif partagé.
 *
 * `useSyncExternalStore` PLUTÔT QU'UN ÉTAT LOCAL, pour la même raison que le
 * repère d'apparence : l'index est rempli par un AUTRE écran (l'explorateur, la
 * page de gestion), et sans abonnement une carte déjà montée garderait son état
 * d'avant — c'est-à-dire, pour l'accueil, jusqu'au prochain redémarrage.
 *
 * `undefined` = « cette session n'a pas lu ». La surface n'affiche alors RIEN,
 * et surtout pas une ligne vide : promettre l'emplacement d'un texte qu'on n'a
 * pas ferait chercher ce qui manque, et une carte qui change de hauteur selon ce
 * qu'on a lu ferait sauter la grille.
 */

import { useSyncExternalStore } from 'react';
import {
  getVaultDescription,
  subscribeVaultDescriptions,
} from '../../../services/vault/vaultDescriptionIndex';

export function useVaultDescription(vaultId: string): string | undefined {
  // Le module rend la MÊME chaîne tant que rien n'a changé (une `Map` de
  // primitives) : `useSyncExternalStore` compare par référence, et une valeur
  // neuve à chaque appel bouclerait.
  return useSyncExternalStore(subscribeVaultDescriptions, () => getVaultDescription(vaultId));
}

export default useVaultDescription;
