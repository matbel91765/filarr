/**
 * Sélecteurs du cache d'agrégats de partage (`shareIndexSlice`).
 *
 * L'état est typé STRUCTURELLEMENT (`{ shareIndex: ShareIndexState }`) et non
 * par `RootState` : ces sélecteurs sont lus par des composants de cartes qui
 * n'ont besoin que de cette tranche, et le typage structurel les rend
 * testables avec un store réduit — `RootState` s'y conforme dès que la slice
 * est enregistrée dans `store/index.ts`.
 *
 * Le contrat côté cartes est « lire, jamais demander » : aucun sélecteur ici
 * ne déclenche de chargement. C'est l'écran qui possède le coffre (rail,
 * liste) qui dispatche `loadShareHeads` / `loadVaultShareSummary`, une fois.
 */

import { createSelector } from '@reduxjs/toolkit';
import type { ShareIndexState } from '../slices/shareIndexSlice';

export type StateWithShareIndex = { shareIndex: ShareIndexState };

const selectShareIndex = (state: StateWithShareIndex) => state.shareIndex;
const selectGrantCountByItem = (state: StateWithShareIndex) => state.shareIndex.grantCountByItem;
const selectVaultIdArg = (_state: StateWithShareIndex, vaultId: string) => vaultId;

/**
 * L'effectif d'un coffre, ou `undefined` tant qu'aucune tête ni aucun agrégat
 * ne l'a donné — la pastille distingue « pas encore su » de « 0 ». Primitif,
 * donc pas de mémoïsation à faire.
 */
export const selectVaultMemberCount = (
  state: StateWithShareIndex,
  vaultId: string
): number | undefined => state.shareIndex.memberCountByVault[vaultId];

/**
 * Les grants vivants d'un coffre, indexés par itemId — une Map par coffre, la
 * MÊME référence tant que `grantCountByItem` n'a pas bougé, pour que les cartes
 * qui la reçoivent en prop ne se re-rendent pas à chaque tick. Un élément absent
 * de la Map n'a pas de grant (voir `grantCountByItem`).
 */
export const selectGrantCountMap = createSelector(
  [selectGrantCountByItem, selectVaultIdArg],
  (grantCountByItem, vaultId): ReadonlyMap<string, number> => {
    const prefix = `${vaultId}:`;
    const map = new Map<string, number>();
    for (const [key, count] of Object.entries(grantCountByItem)) {
      if (key.startsWith(prefix)) map.set(key.slice(prefix.length), count);
    }
    return map;
  }
);

/**
 * Le rail peut afficher ses pastilles : au moins un passage de têtes a abouti.
 * Avant ça, un coffre sans entrée est « pas encore su », pas « seul ».
 */
export const selectShareIndexReady = createSelector(
  [selectShareIndex],
  (s): boolean => s.headsLoadedAt !== null
);

/** L'agrégat de ce coffre a-t-il déjà été reçu (quelle que soit sa fraîcheur) ? */
export const selectVaultSummaryLoaded = (state: StateWithShareIndex, vaultId: string): boolean =>
  typeof state.shareIndex.summaryLoadedAt[vaultId] === 'number';
