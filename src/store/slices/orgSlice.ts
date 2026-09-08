/**
 * Organizations Redux Slice (E1-6)
 *
 * Multi-org membership + the active-org context for the signed-in cloud user.
 * The list comes from the worker (GET /org) via the main process; the active
 * org is the source of truth in main (persisted per profile), mirrored here for
 * the UI and pushed to the renderer apiClient so org-scoped resource calls carry
 * X-Org-Id.
 */

import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import type { OrgSummary } from '../../types/org';
import {
  setActiveOrg as setApiClientOrg,
  setImplicitOrg as setApiClientImplicitOrg,
  forgetVaultOrgs,
} from '../../services/network/apiClient';
import { apiEnsurePersonalSpace } from '../../services/vault/vaultApi';

/**
 * MY auto-provisioned personal org — the implicit tenant of shared vaults in
 * personal space. Not a workspace: it is hidden from the org switcher and the
 * word "organization" never reaches the personal UI.
 *
 * `role === 'owner'` is the discriminator, not `isPersonal`: being a guest in
 * someone else's personal space also lists THEIR personal org here, and adopting
 * it as our own tenant would scope our own vaults to a space we don't own.
 */
function ownedPersonalOrg(orgs: OrgSummary[]): OrgSummary | undefined {
  return orgs.find((o) => o.isPersonal && o.role === 'owner');
}

function personalOrgIdOf(orgs: OrgSummary[]): string | null {
  const own = ownedPersonalOrg(orgs);
  return own && own.status !== 'pending_deletion' ? own.id : null;
}

export type WorkspaceSpace = 'personal' | 'enterprise';

interface ApiResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

function ipc() {
  return window.electron?.ipcRenderer;
}

// ── Thunks ───────────────────────────────────────────────────────────────────

/** Fetch the orgs the user belongs to (GET /org via main). */
export const fetchOrgs = createAsyncThunk('org/fetch', async (_: void, { rejectWithValue }) => {
  const res = (await ipc()?.invoke('org:list')) as ApiResult<{ orgs: OrgSummary[] }> | undefined;
  if (!res?.success) {
    return rejectWithValue(res?.error ?? 'Failed to load organizations');
  }
  const orgs = res.data?.orgs ?? [];
  // A FULFILLED read is authoritative, including when it names no space of ours.
  // Keeping a tenant the server didn't confirm is how a signed-out account's
  // X-Org-Id survives into the next sign-in within the same profile — every
  // vault call would then carry the previous account's tenant and come back 403.
  // The one case this could wrongly clear (a read lagging a space we JUST
  // provisioned) is handled where it belongs: ensurePersonalSpace re-adopts the
  // id the POST returned, after this refresh. `rejected` learns nothing and
  // therefore changes nothing.
  setApiClientImplicitOrg(personalOrgIdOf(orgs));
  return orgs;
});

/**
 * Make sure the caller HAS a personal space, then adopt it as the implicit tenant.
 *
 * THE BUG THIS CLOSES. The personal org is auto-provisioned at register (E1-7), but
 * only for accounts created after that shipped; the E1-9 backfill never reached every
 * older one. Such an account signs in, opens Shared Vaults, and `GET /org` answers
 * with an empty list — so the client held no tenant, refused to make the request at
 * all, and told the user to check their connection. Nothing was wrong with their
 * connection: they simply had no space yet, and nothing on the client would ever
 * create one.
 *
 * WHY THE CLIENT ASKS EXPLICITLY rather than leaning on the Worker's implicit
 * resolution. The vault routes DO provision on first access (rbac.ts personalFallback),
 * and that stays as the server-side floor. But it provisions SILENTLY: the renderer
 * would get its (empty) vault list back and still hold `personalOrgId === null`, and
 * the rest of the journey is not tenant-free — bringing a newcomer in still goes
 * through `apiInviteToVaultSpace(orgId, …)`, from selectSharedVaultOrgId. (The invite
 * picker no longer names a tenant at all: since P2 it reads
 * `apiListVaultDirectory(vaultId)`, and the Worker resolves the space from the vault
 * row.) Fixing only the list would leave a screen that opens and an invitation that
 * can't be sent.
 *
 * The thunk also returns the entitlement the Worker answered with (tier, seat limit,
 * seats used). NOTHING READS IT TODAY — occupancy reaches the invite modal through
 * `apiGetVaultSeats()`, and the caller here only looks at the request status. It is
 * carried rather than dropped because it is what an honest upsell would need ("your
 * plan doesn't include shared vaults") without waiting for a refusal, but until a
 * screen consumes it, treat it as unused.
 *
 * Idempotent (the Worker reads before it inserts, behind a partial unique index) and
 * refused server-side for a tier that isn't entitled — rejected as `upgrade_required`,
 * an answer, not an outage.
 */
export const ensurePersonalSpace = createAsyncThunk(
  'org/ensurePersonal',
  async (_: void, { dispatch, rejectWithValue }) => {
    try {
      const space = await apiEnsurePersonalSpace();
      // Adopt it immediately: the org list is authoritative for the selectors, but the
      // apiClient header must be right for any call made before that refresh lands.
      if (space.org) setApiClientImplicitOrg(space.org.id);
      // Re-read the list so selectSharedVaultOrgId / the invite picker see the space too.
      await dispatch(fetchOrgs());
      // …and re-adopt AFTER it: that refresh is authoritative, so a read that lagged
      // the row we just created would otherwise clear the tenant we hold from the
      // POST's own answer. This is the only place where the client legitimately knows
      // more than the list does.
      if (space.org) setApiClientImplicitOrg(space.org.id);
      return space;
    } catch (e) {
      // vaultApi already reduced this to a canonical code (upgrade_required,
      // network_unavailable, server_error…). Pass it up verbatim — it is the message.
      return rejectWithValue((e as Error)?.message ?? 'shared_vault_no_context');
    }
  }
);

/** Read the authoritative per-profile space from main into the Redux mirror. */
export const hydrateSpace = createAsyncThunk('org/hydrateSpace', async () => {
  const res = (await ipc()?.invoke('space:get')) as
    | ApiResult<{ space: WorkspaceSpace }>
    | undefined;
  return res?.data?.space ?? 'personal';
});

/**
 * Restore the active space + org from main on startup and sync them to the
 * renderer apiClient, then refresh the org list. This is the single boot path
 * that makes the app enterprise-aware — dispatched at profile activation (App)
 * so gating is correct app-wide, not only after Settings is opened.
 */
export const initOrgContext = createAsyncThunk('org/init', async (_: void, { dispatch }) => {
  // Drop the previous profile's tenants BEFORE anything can be fetched: if the
  // refresh below fails (offline, signed out), no shared-vault call may inherit
  // the org of the profile we just left.
  setApiClientImplicitOrg(null);
  forgetVaultOrgs();
  // Le choix d'espace et le choix d'org sont des PRÉFÉRENCES : un canal absent
  // ou en panne ne doit pas empêcher `fetchOrgs` de partir, faute de quoi
  // l'utilisateur se retrouve aveugle à ses propres espaces — donc sans coffres
  // partagés — pour une raison qui n'a rien à voir avec eux.
  const spaceRes = (await ipc()
    ?.invoke('space:get')
    .catch(() => undefined)) as ApiResult<{ space: WorkspaceSpace }> | undefined;
  const space: WorkspaceSpace = spaceRes?.data?.space ?? 'personal';

  const res = (await ipc()
    ?.invoke('org:getCurrent')
    .catch(() => undefined)) as ApiResult<{ orgId: string | null }> | undefined;
  // Personal space forces the org context off, mirroring the main invariant.
  let orgId = space === 'enterprise' ? (res?.data?.orgId ?? null) : null;
  setApiClientOrg(orgId);
  const fetched = await dispatch(fetchOrgs())
    .unwrap()
    .catch(() => [] as OrgSummary[]);

  /**
   * CHOISIR ENTRE UNE SEULE OPTION N'EST PAS UN CHOIX.
   *
   * `currentOrgId` ne venait que d'un choix PERSISTÉ, fait à la main dans le
   * sélecteur d'organisation des Réglages. Personne ne le faisait — rien ne le
   * demandait — et tant qu'il restait nul, `selectIsEnterpriseSpace` répondait
   * faux : pas d'entrée « Organisation » dans la barre, pas de console, pas de
   * coffres d'équipe. Il fallait donc trouver un réglage enfoui pour débloquer
   * la fonction qu'on venait d'acheter.
   *
   * Quand il n'y a qu'une organisation, on la prend. Quand il y en a plusieurs,
   * on prend la première et le sélecteur reste là pour en changer : se tromper
   * de locataire est réparable en un clic, alors que n'en avoir aucun laisse
   * l'application muette.
   */
  if (space === 'enterprise' && !orgId) {
    const real = fetched.filter((o) => !o.isPersonal && o.status !== 'pending_deletion');
    if (real.length > 0) {
      orgId = real[0].id;
      await ipc()
        ?.invoke('org:setCurrent', orgId)
        .catch(() => {
          /* préférence : un canal en panne ne doit pas priver d'organisation */
        });
      setApiClientOrg(orgId);
    }
  }
  return { space, orgId };
});

/**
 * Switch the active org (or null for personal context) WITHIN enterprise space.
 * Persists in main and updates the renderer apiClient so the next org-scoped
 * call uses it. (Intra-enterprise org picker — not the personal↔enterprise axis.)
 */
export const setCurrentOrg = createAsyncThunk('org/setCurrent', async (orgId: string | null) => {
  await ipc()?.invoke('org:setCurrent', orgId);
  setApiClientOrg(orgId);
  return orgId;
});

// ── Slice ────────────────────────────────────────────────────────────────────

export interface OrgSliceState {
  orgs: OrgSummary[];
  currentOrgId: string | null;
  /** The active workspace space — mirror of the per-profile .space file. */
  spaceMode: WorkspaceSpace;
  loading: boolean;
  error: string | null;
}

const initialState: OrgSliceState = {
  orgs: [],
  currentOrgId: null,
  spaceMode: 'personal',
  loading: false,
  error: null,
};

const orgSlice = createSlice({
  name: 'org',
  initialState,
  reducers: {
    setCurrentOrgId(state, action: PayloadAction<string | null>) {
      state.currentOrgId = action.payload;
    },
    setSpaceModeState(state, action: PayloadAction<WorkspaceSpace>) {
      state.spaceMode = action.payload;
      if (action.payload === 'personal') state.currentOrgId = null;
    },
    clearOrgs(state) {
      state.orgs = [];
      state.currentOrgId = null;
      state.spaceMode = 'personal';
      state.error = null;
      setApiClientOrg(null);
      setApiClientImplicitOrg(null);
      forgetVaultOrgs();
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchOrgs.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchOrgs.fulfilled, (state, action) => {
        state.loading = false;
        state.orgs = action.payload;
        // If the active org is no longer one we belong to, drop back to personal.
        if (state.currentOrgId && !action.payload.some((o) => o.id === state.currentOrgId)) {
          state.currentOrgId = null;
          setApiClientOrg(null);
        }
      })
      .addCase(fetchOrgs.rejected, (state, action) => {
        state.loading = false;
        state.error = (action.payload as string) ?? 'Failed to load organizations';
      });

    builder.addCase(hydrateSpace.fulfilled, (state, action) => {
      state.spaceMode = action.payload;
      if (action.payload === 'personal') state.currentOrgId = null;
    });

    builder.addCase(initOrgContext.fulfilled, (state, action) => {
      state.spaceMode = action.payload.space;
      state.currentOrgId = action.payload.orgId;
    });

    builder.addCase(setCurrentOrg.fulfilled, (state, action) => {
      state.currentOrgId = action.payload;
    });
  },
});

export type OrgState = ReturnType<typeof orgSlice.reducer>;
export const { setCurrentOrgId, setSpaceModeState, clearOrgs } = orgSlice.actions;
export default orgSlice.reducer;
