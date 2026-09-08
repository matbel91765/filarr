/**
 * sharedWithMeSlice — l'écran du DESTINATAIRE d'un partage par personne (E3-6).
 *
 * Le grant EST la capacité : K_item nous est scellé, la méta se déchiffre ICI,
 * en mémoire seulement — le slice est sur la blacklist redux-persist (même
 * règle que 'vaults' : la méta déchiffrée ne touche jamais le disque).
 *
 * Ce que l'écran ne peut PAS montrer, par construction : le nom du coffre
 * (chiffré sous K_vault que le titulaire d'un grant n'a pas). Le « partagé
 * par » vient du serveur (granter résolu par LEFT JOIN — le destinataire n'a
 * aucun moyen de le résoudre lui-même, la découverte de clé exige un espace
 * commun).
 */

import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import {
  apiListSharedWithMe,
  apiDownloadSharedChunk,
  type SharedWithMeEntryDTO,
} from '../../services/vault/vaultApi';
import { unwrapGrantedItemKey } from '../../services/vault/vaultCrypto';
import { decryptItemMeta, decryptItemChunk } from '../../services/vault/vaultCrypto';
import type { VaultItemMeta } from './vaultsSlice';
import { hasUserKeypair } from '../../services/auth/userKeypair';

export interface SharedItemSummary {
  grantId: string;
  itemId: string;
  itemType: string;
  /** Déchiffrée sous le K_item qui nous est scellé — mémoire seulement. */
  meta: VaultItemMeta;
  sizeBytes: number;
  totalChunks: number;
  grantedByUserId: string | null;
  grantedByEmail: string | null;
  expiresAt: string | null;
  /** Le wrap est en retard sur la version réelle : « en attente de rescellement ». */
  needsRewrap: boolean;
  wrappedItemKey: string;
}

export interface SharedWithMeState {
  entries: SharedItemSummary[];
  /**
   * 'locked' : la liste a été LUE (le serveur répond sans clé — les enveloppes
   * sont scellées pour nous, le compte est donc connu) mais rien n'a pu être
   * déchiffré faute de paire de clés en mémoire. Ce n'est pas une erreur : c'est
   * un état d'attente, levé dès que la clé arrive (le bootstrap refait la lecture).
   */
  status: 'idle' | 'loading' | 'ready' | 'locked' | 'error';
  error: string | null;
  /** Entrées reçues mais indéchiffrables (clé absente, blob corrompu) — comptées, jamais fatales. */
  undecryptable: number;
  /** En état 'locked' : combien d'éléments attendent la clé. 0 = rien à montrer. */
  lockedCount: number;
}

const initialState: SharedWithMeState = {
  entries: [],
  status: 'idle',
  error: null,
  undecryptable: 0,
  lockedCount: 0,
};

/**
 * Le bandeau n'a une section « Partagé avec moi » que s'il y a QUELQUE CHOSE —
 * jamais à zéro. `lockedCount` (et non `status === 'locked'`) : il survit au
 * 'loading' de la relecture qui suit l'arrivée de la clé, donc la section ne
 * clignote pas entre « N éléments attendent » et la liste lue ; il retombe à 0
 * au 'ready' suivant.
 */
export function selectSharedWithMeVisible(state: { sharedWithMe: SharedWithMeState }): boolean {
  const s = state.sharedWithMe;
  return s.entries.length > 0 || s.lockedCount > 0;
}

type FetchSharedWithMeResult =
  | { kind: 'ready'; entries: SharedItemSummary[]; undecryptable: number }
  | { kind: 'locked'; lockedCount: number };

export const fetchSharedWithMe = createAsyncThunk<FetchSharedWithMeResult, void>(
  'sharedWithMe/fetch',
  async (_, { rejectWithValue }) => {
    // L'API D'ABORD, la clé ensuite. Avant, l'absence de paire de clés rejetait
    // en 'keypair_needed' sans rien lire : au démarrage (clé chargée
    // paresseusement) l'écran affichait « déverrouillez » à CHAQUE lancement,
    // même sans aucun partage. Le serveur, lui, répond sans clé — les enveloppes
    // sont scellées pour nous, seul leur contenu exige la clé. On sait donc
    // COMBIEN attend, et on ne montre rien quand la réponse est zéro.
    let dtos: SharedWithMeEntryDTO[];
    try {
      dtos = await apiListSharedWithMe();
    } catch (e) {
      return rejectWithValue((e as Error)?.message || 'shared_with_me_load_failed');
    }
    if (!hasUserKeypair()) {
      return { kind: 'locked', lockedCount: dtos.length };
    }
    const entries: SharedItemSummary[] = [];
    let undecryptable = 0;
    for (const dto of dtos) {
      // Une entrée indéchiffrable est COMPTÉE et sautée, jamais fatale — même
      // geste que le chargement des éléments de coffre.
      try {
        const kItem = await unwrapGrantedItemKey(dto.wrappedItemKey);
        try {
          const meta = (await decryptItemMeta(
            dto.encryptedMeta,
            dto.encryptedMetaIv,
            kItem
          )) as VaultItemMeta;
          entries.push({
            grantId: dto.grantId,
            itemId: dto.itemId,
            itemType: dto.itemType,
            meta,
            sizeBytes: dto.sizeBytes,
            totalChunks: dto.totalChunks,
            grantedByUserId: dto.grantedByUserId,
            grantedByEmail: dto.grantedByEmail,
            expiresAt: dto.expiresAt,
            needsRewrap: dto.wrappedForVersion < dto.itemVersion,
            wrappedItemKey: dto.wrappedItemKey,
          });
        } finally {
          kItem.fill(0);
        }
      } catch {
        undecryptable++;
      }
    }
    return { kind: 'ready', entries, undecryptable };
  },
  {
    // Deux émetteurs peuvent se croiser à l'arrivée de la clé (le bootstrap qui
    // observe la présence, et le geste « Déverrouiller » de la liste qui reprend
    // sa relecture) : une lecture déjà en vol suffit, la seconde est un no-op.
    condition: (_arg, { getState }) =>
      (getState() as { sharedWithMe: SharedWithMeState }).sharedWithMe.status !== 'loading',
  }
);

/**
 * Télécharger + déchiffrer le contenu d'une entrée. PAS un thunk : les octets
 * ne traversent jamais Redux (même règle documentée que
 * downloadVaultItemContent).
 */
export async function downloadSharedItemContent(entry: SharedItemSummary): Promise<Uint8Array> {
  const kItem = await unwrapGrantedItemKey(entry.wrappedItemKey);
  try {
    const parts: Uint8Array[] = [];
    let total = 0;
    for (let i = 0; i < entry.totalChunks; i++) {
      const enc = await apiDownloadSharedChunk(entry.itemId, i);
      const clear = await decryptItemChunk(enc, kItem);
      parts.push(clear);
      total += clear.length;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  } finally {
    kItem.fill(0);
  }
}

const sharedWithMeSlice = createSlice({
  name: 'sharedWithMe',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchSharedWithMe.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(fetchSharedWithMe.fulfilled, (state, action) => {
        if (action.payload.kind === 'locked') {
          // Rien de déchiffré n'est conservé : la liste précédente (s'il y en
          // avait une) datait d'une clé qui n'est plus là.
          state.status = 'locked';
          state.entries = [];
          state.undecryptable = 0;
          state.lockedCount = action.payload.lockedCount;
          return;
        }
        state.status = 'ready';
        state.entries = action.payload.entries;
        state.undecryptable = action.payload.undecryptable;
        state.lockedCount = 0;
      })
      .addCase(fetchSharedWithMe.rejected, (state, action) => {
        state.status = 'error';
        state.error = (action.payload as string) ?? 'shared_with_me_load_failed';
      });
  },
});

export default sharedWithMeSlice.reducer;
