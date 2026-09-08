/**
 * useVaultAppearance (F14) — l'apparence effective d'un coffre, les deux
 * portées fondues.
 *
 * UN SEUL POINT DE FUSION POUR CINQ ENDROITS. Le glyphe d'un coffre est rendu
 * par les cartes de l'accueil, les rangées de liste, le fil d'Ariane de
 * l'explorateur, l'en-tête de la page « Gérer le coffre » et le badge
 * « Partagé ». Si chacun fusionnait « pour tout le monde » et « pour moi » à sa
 * façon, il suffirait d'un oubli pour qu'un écran affiche l'emoji de l'équipe
 * là où les quatre autres montrent celui qu'on s'est choisi.
 *
 * `useSyncExternalStore` PLUTÔT QU'UN ÉTAT LOCAL : le repère personnel vit en
 * localStorage, que rien n'observe. Sans abonnement, changer la couleur depuis
 * la page ne repeindrait pas les cartes de l'accueil déjà montées — elles
 * garderaient l'ancienne jusqu'au prochain rendu, c'est-à-dire potentiellement
 * jusqu'au redémarrage.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../../store';
import {
  getLocalVaultAppearance,
  setLocalVaultAppearance,
  subscribeVaultAppearance,
} from '../../../services/vault/vaultAppearanceLocal';
import {
  resolveVaultAppearance,
  type VaultAppearance,
} from '../../../services/vault/vaultNameEnvelope';

/** Le repère personnel de ce coffre sur cet appareil, et de quoi le changer. */
export function useLocalVaultAppearance(vaultId: string): {
  local: VaultAppearance | undefined;
  setLocal: (a: VaultAppearance | undefined) => void;
} {
  const myUserId = useSelector((s: RootState) => s.auth.cloudUser?.id ?? null);
  const local = useSyncExternalStore(
    subscribeVaultAppearance,
    // Le module rend le MÊME objet tant que rien n'a changé : `useSyncExternalStore`
    // compare par référence, et un objet neuf à chaque appel bouclerait.
    () => getLocalVaultAppearance(myUserId, vaultId)
  );
  const setLocal = useCallback(
    (a: VaultAppearance | undefined) => setLocalVaultAppearance(myUserId, vaultId, a),
    [myUserId, vaultId]
  );
  return { local, setLocal };
}

/**
 * L'apparence à AFFICHER : le partagé, recouvert champ par champ par le local.
 *
 * `vault` peut être `undefined` (un coffre pas encore chargé) : le glyphe
 * retombe alors sur le cadenas, comme avant la fiche.
 */
export function useVaultAppearance(
  vault: { id: string; appearance?: VaultAppearance } | undefined
): VaultAppearance | undefined {
  const { local } = useLocalVaultAppearance(vault?.id ?? '');
  return useMemo(
    () => resolveVaultAppearance(vault?.appearance, local),
    [vault?.appearance, local]
  );
}
