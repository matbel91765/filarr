/**
 * Sélecteurs du partage de notes vers les coffres — la JOINTURE notes × coffres.
 *
 * Foyer trans-slices (patron `authSelectors`) : ni `notesSlice` ni `vaultsSlice`
 * ne doit connaître l'autre, et la question « dans quel état est la copie de
 * cette note ? » a besoin des deux. La décision elle-même vit dans le module pur
 * `noteShareModel` ; ici on ne fait que projeter l'état des coffres dans la forme
 * minimale qu'il attend (`VaultsLite`) et mémoïser la jointure.
 */

import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '../index';
import type { NoteShareRef } from '../../types/notes';
import { shareBadgeState, shareRefState } from '../../services/notes/noteShareModel';
import type { NoteShareBadgeState, VaultsLite } from '../../services/notes/noteShareModel';

// Entrées atomiques : un sélecteur par champ, pour que la jointure ne se
// recalcule que si l'un d'eux change d'identité (et pas à chaque action).
const selectNotesById = (s: RootState) => s.notes.byId;
const selectNotesAllIds = (s: RootState) => s.notes.allIds;
const selectVaults = (s: RootState) => s.vaults.vaults;
const selectVaultIds = (s: RootState) => s.vaults.vaultIds;
const selectUnlockedVaultIds = (s: RootState) => s.vaults.unlockedVaultIds;
const selectItemsByVault = (s: RootState) => s.vaults.itemsByVault;
const selectDecryptStatusByVault = (s: RootState) => s.vaults.decryptStatusByVault;
const selectInitialLoadRequested = (s: RootState) => s.vaults.initialLoadRequested;
const selectVaultsLoading = (s: RootState) => s.vaults.loading;
const selectVaultsError = (s: RootState) => s.vaults.error;

/**
 * Les notes VIVANTES (hors corbeille) déposées quelque part. Un `Set` : c'est
 * une question d'appartenance posée par ligne de liste (« cette note porte-t-elle
 * un badge ? »), pas une liste à parcourir.
 */
export const selectSharedNoteIds = createSelector(
  [selectNotesById, selectNotesAllIds],
  (byId, allIds): Set<string> => {
    const out = new Set<string>();
    for (const id of allIds) {
      const n = byId[id];
      if (n && !n.deletedAt && n.sharedTo && n.sharedTo.length > 0) out.add(id);
    }
    return out;
  }
);

/**
 * Projection de `VaultsState` vers `VaultsLite`.
 *
 * `vaultsLoaded` = `initialLoadRequested && !loading && !error` : un chargement
 * a été demandé dans cette session (drapeau posé dès `pending`, remis à zéro à
 * la déconnexion), il n'est plus en cours, et le dernier n'a PAS échoué.
 * L'ancienne approximation « au moins un coffre connu » rendait `unknown` à
 * jamais à qui avait perdu TOUS ses coffres — ce cas donne désormais
 * `vaultGone`, le verdict juste.
 *
 * POURQUOI EXCLURE L'ÉCHEC. `initialLoadRequested && !loading` seul vaut aussi
 * après un `loadVaults.rejected` (hors ligne, offre expirée) : la liste est
 * vide non parce que les coffres ont disparu, mais parce qu'on n'a pas pu la
 * lire — en dériver `vaultGone` serait exactement le faux verdict que le
 * principe terminal ≠ jetable interdit. `error` est remis à `null` à chaque
 * `pending` et n'est posé que par `rejected` : il dit précisément « la dernière
 * lecture a échoué ». Limite assumée : une relance qui échoue APRÈS un premier
 * chargement réussi fait retomber `vaultsLoaded` à `false`, et un coffre
 * réellement disparu entre-temps se lit `unknown` jusqu'à la lecture suivante —
 * un « je ne sais pas » de trop plutôt qu'un « disparu » de trop.
 *
 * `itemIdsByVault` ne compte que les éléments VIVANTS, sans filtre ici : un
 * élément soft-supprimé QUITTE `itemsByVault` (`deleteVaultItem(s).fulfilled`
 * le retire) et le serveur ne le liste plus (`deleted_at IS NULL`) tant qu'il
 * est en corbeille ; une restauration le fait revenir par `loadVaultItems`.
 * Le badge passe donc à `copyMissing` puis revient à `live` sans qu'aucun
 * marqueur ne soit touché — c'est ce qui autorise `notesSlice` à ne rien
 * retirer automatiquement. (Le champ `status` d'un élément vaut 'pending' ou
 * 'ready' — jamais « supprimé » : il n'y a rien à filtrer dessus.)
 */
export const selectVaultsLite = createSelector(
  [
    selectVaults,
    selectVaultIds,
    selectUnlockedVaultIds,
    selectItemsByVault,
    selectDecryptStatusByVault,
    selectInitialLoadRequested,
    selectVaultsLoading,
    selectVaultsError,
  ],
  (
    vaults,
    vaultIds,
    unlockedIds,
    itemsByVault,
    decryptStatus,
    requested,
    loading,
    error
  ): VaultsLite => {
    const unlocked = new Set(unlockedIds);
    const liteVaults: VaultsLite['vaults'] = {};
    for (const id of vaultIds) {
      const v = vaults[id];
      if (!v) continue;
      liteVaults[id] = { name: v.name, unlocked: unlocked.has(id) };
    }
    const itemIdsByVault: Record<string, Set<string>> = {};
    for (const [vaultId, items] of Object.entries(itemsByVault)) {
      itemIdsByVault[vaultId] = new Set(items.map((i) => i.id));
    }
    const undecryptableByVault: Record<string, number> = {};
    for (const [vaultId, status] of Object.entries(decryptStatus)) {
      undecryptableByVault[vaultId] = status.undecryptable;
    }
    return {
      vaultsLoaded: requested === true && !loading && !error,
      vaults: liteVaults,
      itemIdsByVault,
      undecryptableByVault,
    };
  }
);

/** Un dépôt, lu contre l'état des coffres — ce que l'infobulle du badge détaille. */
export interface NoteShareEntry {
  ref: NoteShareRef;
  state: NoteShareBadgeState;
  /** Nom déchiffré du coffre, `null` s'il n'est pas (ou plus) connu. */
  vaultName: string | null;
}

export interface NoteShareInfo {
  /** Le badge résumé (préséance dans `noteShareModel`). */
  badge: NoteShareBadgeState;
  entries: NoteShareEntry[];
}

/**
 * Pour chaque note vivante déposée quelque part : son badge et le détail par
 * coffre. Seules les notes qui portent un dépôt figurent dans la table — la
 * liste fait `byNoteId[id]` et rend un badge si l'entrée existe.
 */
export const selectShareInfoByNoteId = createSelector(
  [selectNotesById, selectSharedNoteIds, selectVaultsLite],
  (byId, sharedIds, lite): Record<string, NoteShareInfo> => {
    const out: Record<string, NoteShareInfo> = {};
    for (const id of sharedIds) {
      const note = byId[id];
      const badge = shareBadgeState(note, lite);
      if (!badge) continue; // impossible par construction de sharedIds, mais le type l'exige
      out[id] = {
        badge,
        entries: (note.sharedTo ?? []).map((ref) => ({
          ref,
          state: shareRefState(ref, lite),
          vaultName: lite.vaults[ref.vaultId]?.name ?? null,
        })),
      };
    }
    return out;
  }
);
