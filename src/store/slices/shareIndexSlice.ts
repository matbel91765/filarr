/**
 * shareIndex — le cache d'AGRÉGATS de partage des coffres : combien de membres
 * par coffre, combien de grants vivants par élément. Des COMPTES, jamais des
 * identités : c'est ce qui nourrit les pastilles du rail, les badges des
 * cartes et l'en-tête du panneau de détails, sans rien révéler de qui.
 *
 * POURQUOI UNE SLICE DÉDIÉE. `vaultsSlice` frôle les 2 200 lignes et porte
 * déjà le cycle de vie des coffres, leur crypto et le contenu déchiffré. Un
 * cache d'affichage n'a rien à y faire : il ne détient aucun secret, il n'a pas
 * de version, il se jette et se recharge. Le garder à part, c'est aussi garder
 * ses règles d'invalidation lisibles d'un seul tenant — elles tiennent ici en
 * quelques matchers, là-bas elles se perdraient entre deux rescellements.
 *
 * POURQUOI EXCLU DE REDUX-PERSIST. Tout ce qui est ici est DÉRIVÉ du serveur et
 * daté (`summaryLoadedAt`, `headsLoadedAt`) : le rehydrater d'un blob local
 * ferait afficher des effectifs d'avant-hier avec l'assurance d'un chiffre
 * frais, et un TTL calculé sur une horloge d'une autre session. Le blanc
 * initial coûte une requête ; le faux chiffre coûte la confiance. L'exclusion
 * elle-même vit dans `store/index.ts` (blacklist), à côté de `vaults`.
 *
 * POURQUOI JAMAIS D'APPEL PAR CARTE. Une grille de trente éléments qui fait
 * trente GET au montage, c'est une rafale à chaque navigation et un rail qui
 * clignote pastille par pastille. Le contrat est donc : UNE requête pour les
 * têtes de tous les coffres (`loadShareHeads`), UNE requête par coffre ouvert
 * (`loadVaultShareSummary`), dédupliquée en vol et protégée par un TTL — les
 * cartes ne font que LIRE via les sélecteurs (`shareIndexSelectors`). Entre
 * deux chargements, ce sont les actions de `vaultsSlice` qui tiennent le cache
 * à jour localement (grant créé/révoqué, membre invité/retiré, coffre quitté).
 *
 * Les types d'action de `vaultsSlice` et `authSlice` sont EN DUR, pas importés :
 * importer `vaultsSlice` ici tirerait sa crypto et son client HTTP, et
 * refermerait le cycle store → slice → store. C'est le même mécanisme béni que
 * NOTES_LOADED_ACTION dans `store/middleware/electronMiddleware.ts` et que les
 * VAULT_ITEM(S)_DELETED_ACTION de `notesSlice`. Chaque forme de payload
 * ci-dessous est celle du `return` du thunk correspondant — à re-vérifier si
 * l'un d'eux change.
 */

import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import {
  apiGetVaultShareHeads,
  apiGetVaultShareSummary,
  type VaultShareHeadDTO,
  type VaultShareSummaryDTO,
} from '../../services/vault/vaultApi';

// ── Types d'action EN DUR (voir l'en-tête) ───────────────────────────────────

/** `createItemGrant` → `{ vaultId, itemId, grant }` */
const GRANT_CREATED_ACTION = 'vaults/createItemGrant/fulfilled';
/** `revokeItemGrant` → `{ vaultId, itemId, grantId, remainingGrants }` */
const GRANT_REVOKED_ACTION = 'vaults/revokeItemGrant/fulfilled';
/** `inviteMember` → `{ vaultId, inviteeEmail }` */
const MEMBER_INVITED_ACTION = 'vaults/invite/fulfilled';
/** `removeMember` → `{ vaultId, removedUserId }` */
const MEMBER_REMOVED_ACTION = 'vaults/removeMember/fulfilled';
/** `leaveVault` → `{ vaultId }` */
const VAULT_LEFT_ACTION = 'vaults/leave/fulfilled';
/** `authSlice.clearCloudAuth` — déconnexion du nuage, sans payload. */
const CLOUD_AUTH_CLEARED_ACTION = 'auth/clearCloudAuth';

/**
 * Fraîcheur d'un agrégat de coffre. Une minute : assez court pour qu'un
 * partage fait sur un autre appareil apparaisse à la prochaine ouverture du
 * coffre, assez long pour qu'aller-retour entre deux coffres ne coûte rien.
 */
export const SHARE_SUMMARY_TTL_MS = 60_000;

export interface ShareIndexState {
  /** Effectif par coffre — la pastille du rail. */
  memberCountByVault: Record<string, number>;
  /**
   * Grants vivants par élément, clé `${vaultId}:${itemId}`. Zéro se lit par
   * ABSENCE : un élément sans entrée n'a pas de grant (le serveur ne renvoie
   * pas de zéros), et une décrémentation qui atteint zéro retire la clé.
   */
  grantCountByItem: Record<string, number>;
  /** Horodatage (ms) du dernier agrégat reçu par coffre — le TTL se lit ici. */
  summaryLoadedAt: Record<string, number>;
  /** Horodatage (ms) des dernières têtes ; `null` tant qu'on n'a rien reçu. */
  headsLoadedAt: number | null;
}

const initialState: ShareIndexState = {
  memberCountByVault: {},
  grantCountByItem: {},
  summaryLoadedAt: {},
  headsLoadedAt: null,
};

/** La clé composite d'un élément — exportée pour que personne ne la recompose à la main. */
export const grantCountKey = (vaultId: string, itemId: string): string => `${vaultId}:${itemId}`;

/** La forme minimale de l'état racine dont les thunks ont besoin — jamais RootState (cycle). */
type ThunkRootState = {
  auth?: { accountMode?: 'local' | 'cloud' };
  shareIndex?: ShareIndexState;
};

const isCloud = (getState: () => unknown): boolean =>
  (getState() as ThunkRootState).auth?.accountMode === 'cloud';

// ── Thunks ───────────────────────────────────────────────────────────────────

/**
 * Les têtes de TOUS les coffres en une requête. Hors nuage il n'y a rien à
 * demander : la `condition` empêche même le dispatch de `pending`, donc aucune
 * trace dans le store — un vrai no-op, pas une requête qui échoue en silence.
 * `null` (agrégat illisible) est un résultat, pas une erreur : le reducer n'y
 * touche à rien et le rail garde ses pastilles précédentes.
 */
export const loadShareHeads = createAsyncThunk<VaultShareHeadDTO[] | null, void>(
  'shareIndex/loadHeads',
  async () => apiGetVaultShareHeads(),
  { condition: (_arg, { getState }) => isCloud(getState) }
);

/**
 * Dédup en vol, à l'échelle du MODULE et non du composant : deux écrans qui
 * ouvrent le même coffre dans le même tick passent tous deux la `condition`
 * (rien n'est encore écrit) mais ne déclenchent qu'un seul GET — le second
 * attend la même promesse. La carte est vidée en `finally`, qu'on ait reçu
 * un agrégat ou `null` : la prochaine demande hors TTL repart proprement.
 */
const summaryInFlight = new Map<string, Promise<VaultShareSummaryDTO | null>>();

const isSummaryFresh = (state: ShareIndexState | undefined, vaultId: string, now: number) => {
  const at = state?.summaryLoadedAt[vaultId];
  return typeof at === 'number' && now - at < SHARE_SUMMARY_TTL_MS;
};

/**
 * L'agrégat d'UN coffre : son effectif + ses grants par élément. No-op (pas
 * même de `pending`) hors nuage ou tant que le dernier agrégat a moins de
 * SHARE_SUMMARY_TTL_MS. Le `pending` d'un chargement n'écrit rien : c'est le
 * `fulfilled` seul qui date l'agrégat, pour qu'un échec ne bloque pas les
 * relances derrière un TTL qu'il n'a pas mérité.
 */
export const loadVaultShareSummary = createAsyncThunk<
  VaultShareSummaryDTO | null,
  string,
  { state: unknown }
>(
  'shareIndex/loadSummary',
  async (vaultId) => {
    const pending = summaryInFlight.get(vaultId);
    if (pending) return pending;
    const p = apiGetVaultShareSummary(vaultId).finally(() => {
      summaryInFlight.delete(vaultId);
    });
    summaryInFlight.set(vaultId, p);
    return p;
  },
  {
    condition: (vaultId, { getState }) =>
      isCloud(getState) &&
      !isSummaryFresh((getState() as ThunkRootState).shareIndex, vaultId, Date.now()),
  }
);

// ── Slice ────────────────────────────────────────────────────────────────────

/** Purge tout ce que l'on sait d'un coffre : la prochaine ouverture redemande. */
const forgetVault = (state: ShareIndexState, vaultId: string) => {
  delete state.summaryLoadedAt[vaultId];
  delete state.memberCountByVault[vaultId];
  const prefix = `${vaultId}:`;
  for (const key of Object.keys(state.grantCountByItem)) {
    if (key.startsWith(prefix)) delete state.grantCountByItem[key];
  }
};

const shareIndexSlice = createSlice({
  name: 'shareIndex',
  initialState,
  reducers: {
    /**
     * Rendre un coffre « à recharger » sans attendre le TTL — pour un écran qui
     * sait qu'il vient de changer quelque chose que les matchers ci-dessous ne
     * voient pas (ex. acceptation d'invitation côté invité). L'effectif reste
     * affiché en attendant : périmé vaut mieux que vide pendant une requête.
     */
    invalidateVaultShareSummary(state, action: PayloadAction<string>) {
      delete state.summaryLoadedAt[action.payload];
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadShareHeads.fulfilled, (state, action) => {
        // `null` = agrégat illisible : on garde ce qu'on avait, sans le dater.
        if (!action.payload) return;
        for (const h of action.payload) state.memberCountByVault[h.vaultId] = h.memberCount;
        state.headsLoadedAt = Date.now();
      })
      .addCase(loadVaultShareSummary.fulfilled, (state, action) => {
        if (!action.payload) return;
        const vaultId = action.meta.arg;
        const { memberCount, grants } = action.payload;
        state.memberCountByVault[vaultId] = memberCount;
        // Le serveur est la vérité pour CE coffre : on repart de zéro sur son
        // préfixe, sinon un grant révoqué ailleurs survivrait ici par absence.
        const prefix = `${vaultId}:`;
        for (const key of Object.keys(state.grantCountByItem)) {
          if (key.startsWith(prefix)) delete state.grantCountByItem[key];
        }
        for (const g of grants) {
          if (g.count > 0) state.grantCountByItem[grantCountKey(vaultId, g.itemId)] = g.count;
        }
        state.summaryLoadedAt[vaultId] = Date.now();
      })

      // ---- Mises à jour LOCALES entre deux chargements (types en dur) ----
      .addMatcher(
        (a): a is PayloadAction<{ vaultId: string; itemId: string }> =>
          a.type === GRANT_CREATED_ACTION,
        (state, action) => {
          const key = grantCountKey(action.payload.vaultId, action.payload.itemId);
          state.grantCountByItem[key] = (state.grantCountByItem[key] ?? 0) + 1;
        }
      )
      .addMatcher(
        (a): a is PayloadAction<{ vaultId: string; itemId: string; remainingGrants?: number }> =>
          a.type === GRANT_REVOKED_ACTION,
        (state, action) => {
          const key = grantCountKey(action.payload.vaultId, action.payload.itemId);
          const { remainingGrants } = action.payload;
          // Le serveur dit combien il en reste : c'est plus juste qu'un −1 qui
          // ignorerait une révocation faite ailleurs. Sans ce nombre, −1
          // plancher zéro. Zéro se lit par ABSENCE : la clé disparaît.
          const next =
            typeof remainingGrants === 'number' && Number.isFinite(remainingGrants)
              ? Math.max(0, remainingGrants)
              : Math.max(0, (state.grantCountByItem[key] ?? 0) - 1);
          if (next === 0) delete state.grantCountByItem[key];
          else state.grantCountByItem[key] = next;
        }
      )
      // Invitation / retrait : l'effectif du coffre a changé. Le payload ne dit
      // pas si l'invité a déjà accepté (l'effectif compte les membres, pas les
      // invitations), donc on ne devine pas un ±1 : on périme l'agrégat, et la
      // prochaine ouverture du coffre relit le vrai nombre. L'effectif affiché
      // reste en place d'ici là.
      .addMatcher(
        (a): a is PayloadAction<{ vaultId: string }> =>
          a.type === MEMBER_INVITED_ACTION || a.type === MEMBER_REMOVED_ACTION,
        (state, action) => {
          delete state.summaryLoadedAt[action.payload.vaultId];
        }
      )
      // Coffre quitté : on n'y a plus accès, tout ce qu'on en savait est mort.
      .addMatcher(
        (a): a is PayloadAction<{ vaultId: string }> => a.type === VAULT_LEFT_ACTION,
        (state, action) => forgetVault(state, action.payload.vaultId)
      )
      // Déconnexion du nuage : le cache appartenait à ce compte-là.
      .addMatcher(
        (a): a is { type: string } => (a as { type?: string }).type === CLOUD_AUTH_CLEARED_ACTION,
        () => initialState
      );
  },
});

export const { invalidateVaultShareSummary } = shareIndexSlice.actions;

export default shareIndexSlice.reducer;
