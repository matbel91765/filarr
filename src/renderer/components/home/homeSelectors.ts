/**
 * Accueil modulaire — les SÉLECTEURS.
 *
 * Chaque widget est `React.memo` et lit lui-même ce dont il a besoin : c'est ce
 * qui permet à un accueil de douze blocs de ne re-rendre QUE celui qui a changé.
 * Encore faut-il que la lecture ne fabrique pas un tableau neuf à chaque appel —
 * sinon `useSelector` déclenche un rendu à chaque action du store, et la
 * mémoïsation des blocs ne sert plus à rien.
 *
 * D'où ce module : tous les dérivés de l'accueil passent par `createSelector`,
 * définis UNE fois au niveau du module (jamais dans un composant, où ils
 * naîtraient à chaque rendu et ne mémoriseraient rien).
 */

import { createSelector } from '@reduxjs/toolkit';

import type { RootState } from '../../../store';
import type { Folder } from '../../../types';
import type { Note } from '../../../types/notes';

// ==================== Dossiers ====================

const selectFoldersById = (state: RootState) => state.folders.byId;
const selectFoldersAllIds = (state: RootState) => state.folders.allIds;

/** Tous les dossiers vivants — même filtre que `selectAllFolders`. */
export const selectLiveFolders = createSelector(
  [selectFoldersAllIds, selectFoldersById],
  (allIds, byId): Folder[] =>
    (allIds || [])
      .map((id) => byId[id])
      .filter((f): f is Folder => !!f && !(f as { deletedAt?: string }).deletedAt)
);

/** Les dossiers de PREMIER NIVEAU : ce que l'accueil montre. */
export const selectRootFolders = createSelector([selectLiveFolders], (folders): Folder[] =>
  folders.filter((folder) => !folder.parentId || folder.parentId === null)
);

/**
 * Les quatre derniers dossiers touchés. `updatedAt` puis `createdAt` : un
 * dossier jamais rouvert doit quand même pouvoir remonter à sa création.
 */
export const selectSuggestedFolders = createSelector([selectRootFolders], (folders): Folder[] =>
  [...folders]
    .sort((a, b) => {
      const dateA =
        (a as { updatedAt?: string; createdAt?: string }).updatedAt ||
        (a as { createdAt?: string }).createdAt ||
        '';
      const dateB =
        (b as { updatedAt?: string; createdAt?: string }).updatedAt ||
        (b as { createdAt?: string }).createdAt ||
        '';
      return dateB.localeCompare(dateA);
    })
    .slice(0, 4)
);

export const selectFolderCount = (state: RootState): number => state.folders.allIds.length;

// ==================== Notes ====================

const selectNotesById = (state: RootState) => state.notes.byId;
const selectNotesAllIds = (state: RootState) => state.notes.allIds;

/**
 * Les notes ÉCRITES, les plus récentes d'abord.
 *
 * Les notes QUOTIDIENNES sont écartées ici, une bonne fois pour toutes : elles
 * sont touchées chaque jour, elles trustaient donc les quatre cartes et
 * évinçaient les vraies notes jamais classées.
 */
export const selectAuthoredNotesByRecency = createSelector(
  [selectNotesAllIds, selectNotesById],
  (allIds, byId): Note[] =>
    (allIds || [])
      .map((id) => byId[id])
      .filter((n): n is Note => !!n && !n.deletedAt && !n.isDaily)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
);

/** Le compte des notes écrites — affiché à côté de « Notes récentes ». */
export const selectAuthoredNoteCount = createSelector(
  [selectAuthoredNotesByRecency],
  (notes): number => notes.length
);

/** Toutes les notes sans dossier — le TOTAL, pas la rangée montrée. */
export const selectUnfiledNotes = createSelector([selectAuthoredNotesByRecency], (notes): Note[] =>
  notes.filter((n) => !n.parentId)
);

// ==================== Coffres partagés ====================

/**
 * Les coffres du compte. Le résumé complet (pas seulement l'identifiant) :
 * le menu contextuel partagé de `VaultsList` le réclame entier.
 *
 * ALIAS, pas copie : c'est le `selectVaults` mémoïsé de la slice. Deux
 * `createSelector` sur les mêmes entrées, ce seraient deux caches à entretenir
 * pour la même liste — et deux références distinctes pour un même état.
 */
export { selectVaults as selectSharedVaults } from '../../../store/slices/vaultsSlice';
