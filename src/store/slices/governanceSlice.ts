/**
 * governanceSlice — E9-10 offline org-policy enforcement (client side).
 *
 * Holds the cached, member-readable governance policy (session timeouts, offline-grace days,
 * sharing flags) and the derived OFFLINE state machine: a device that runs too long on a stale
 * cached policy (> offlineGraceDays) enters `degraded` mode — the vault is locked until a successful
 * re-sync. Everything here is BEST-EFFORT and client-applied: the Worker stays authoritative for
 * anything enforced server-side (token mint/refresh, IP allowlist), and a determined offline user
 * who holds the password can still bypass the client guards. The app discloses that honestly.
 *
 * Never persisted via redux-persist (blacklisted in store/index): the policy is re-hydrated from the
 * on-disk cache (electron `org:policy:load`) and re-fetched online; it must never stale-load from the
 * redux blob. Reset on logout/profile switch via the global RESET_APP_DATA reducer.
 */

import { createSlice, type PayloadAction, createSelector } from '@reduxjs/toolkit';
import type { RootState } from '../index';

/** The enforcement-relevant subset served by GET /org/:id/policies/effective. */
export interface EffectivePolicy {
  session: {
    idleTimeoutMinutes: number | null;
    absoluteTimeoutMinutes: number | null;
    reauthForSensitiveActions: boolean;
    offlineGraceDays: number | null;
  };
  sharing: {
    externalSharesDisabled: boolean;
    forceExpiry: boolean;
    maxExpiryDays: number | null;
    forcePassword: boolean;
    restrictDownload: boolean;
  };
  retention: {
    trashRetentionDays: number | null;
    versionRetentionDays: number | null;
  };
  /**
   * Politique de POSTE DE TRAVAIL. Facultative dans ce type, et pas par confort :
   * un client à jour peut parler à un Worker qui ne l'envoie pas encore, et une
   * organisation dont la politique date d'avant cette section n'en a aucune. Dans
   * les deux cas la bonne lecture est « aucune restriction », jamais un blocage
   * déduit d'une absence.
   */
  workspace?: WorkspacePolicyView;
}

/**
 * Ce que le membre reçoit de `GET /org/:id/policies/effective` pour son poste.
 *
 * MIROIR de `WorkspacePolicy` (infra/cloudflare-worker/src/policies.ts). Le worker
 * reste l'autorité : il refuse lui-même le catalogue, le paquet d'une extension
 * hors liste et la publication. Ce que le client en fait — masquer l'entrée,
 * griser une extension, poser le thème — est du CONFORT et de la cohérence, et
 * l'écran d'administration le dit à l'administrateur au lieu de le lui cacher.
 */
export interface WorkspacePolicyView {
  marketplaceDisabled: boolean;
  layoutMarketDisabled: boolean;
  pluginPolicy: 'open' | 'allowlist' | 'blocked';
  allowedPluginIds: string[];
  publishingDisabled: boolean;
  defaultTheme: string | null;
  themeLocked: boolean;
  defaultFontId: string | null;
  fontLocked: boolean;
}

/** Aucune organisation, aucune politique, un Worker plus ancien : l'application telle qu'elle est vendue. */
export const OPEN_WORKSPACE_POLICY: WorkspacePolicyView = {
  marketplaceDisabled: false,
  layoutMarketDisabled: false,
  pluginPolicy: 'open',
  allowedPluginIds: [],
  publishingDisabled: false,
  defaultTheme: null,
  themeLocked: false,
  defaultFontId: null,
  fontLocked: false,
};

/**
 * Client fallback for session.offlineGraceDays when an org leaves it unset (user-chosen default).
 * 30 days favours work continuity for travelling/field users; admins can tighten it per-policy.
 */
export const DEFAULT_OFFLINE_GRACE_DAYS = 30;

export interface GovernanceState {
  /** The org the cached policy belongs to (guards cross-org/profile bleed). */
  orgId: string | null;
  policy: EffectivePolicy | null;
  /** 0 = defaults / no policy configured by an admin → nothing to enforce. */
  policyVersion: number;
  /** epoch ms of the last successful ONLINE fetch — drives the offline-grace clock. */
  fetchedAt: number | null;
  /** Last sync attempt reached the server. */
  online: boolean;
  /** The current policy was applied from the on-disk cache (offline), not a fresh fetch. */
  fromCache: boolean;
  /** Offline-grace expired → vault locked + sensitive actions blocked until a successful re-sync. */
  degraded: boolean;
}

const initialState: GovernanceState = {
  orgId: null,
  policy: null,
  policyVersion: 0,
  fetchedAt: null,
  online: true,
  fromCache: false,
  degraded: false,
};

const governanceSlice = createSlice({
  name: 'governance',
  initialState,
  reducers: {
    setPolicy(
      state,
      action: PayloadAction<{
        orgId: string;
        policy: EffectivePolicy;
        version: number;
        fetchedAt: number;
        fromCache: boolean;
      }>
    ) {
      const { orgId, policy, version, fetchedAt, fromCache } = action.payload;
      state.orgId = orgId;
      state.policy = policy;
      state.policyVersion = version;
      state.fetchedAt = fetchedAt;
      state.fromCache = fromCache;
      // A FRESH online fetch means we successfully re-synced → leave degraded mode. Applying a cached
      // policy offline must NOT clear degraded (we never reached the server).
      if (!fromCache) {
        state.online = true;
        state.degraded = false;
      }
    },
    setGovernanceOnline(state, action: PayloadAction<boolean>) {
      state.online = action.payload;
    },
    enterDegraded(state) {
      state.degraded = true;
    },
    clearDegraded(state) {
      state.degraded = false;
    },
    resetGovernance() {
      return { ...initialState };
    },
  },
});

export const { setPolicy, setGovernanceOnline, enterDegraded, clearDegraded, resetGovernance } =
  governanceSlice.actions;
export default governanceSlice.reducer;

// ── Selectors ─────────────────────────────────────────────────────────────────

const selectGovernance = (state: RootState): GovernanceState => state.governance;
const selectSecurity = (state: RootState) => state.settings.security;

/**
 * True once an org admin has actually configured a policy (version ≥ 1). Below this there is nothing
 * to enforce, so personal/unconfigured orgs NEVER get an idle override or a degraded-mode lockout.
 */
export const selectPolicyActive = createSelector(
  [selectGovernance],
  (g): boolean => g.policyVersion >= 1 && g.policy !== null
);

export const selectGovernancePolicy = createSelector([selectGovernance], (g) => g.policy);
export const selectIsPolicyDegraded = createSelector(
  [selectGovernance],
  (g): boolean => g.degraded
);
export const selectGovernanceOnline = createSelector([selectGovernance], (g): boolean => g.online);
export const selectPolicyFromCache = createSelector(
  [selectGovernance],
  (g): boolean => g.fromCache
);
export const selectPolicyFetchedAt = createSelector([selectGovernance], (g) => g.fetchedAt);
export const selectPolicyVersion = createSelector(
  [selectGovernance],
  (g): number => g.policyVersion
);

/**
 * Effective offline-grace window in days when a policy is ACTIVE (org value, or the client default
 * when unset); null when no policy is configured — an unconfigured org has no grace window, matching
 * the sibling selectors below (never imply enforcement where none is configured).
 */
export const selectGraceDays = createSelector(
  [selectGovernance, selectPolicyActive],
  (g, active): number | null =>
    active ? (g.policy?.session.offlineGraceDays ?? DEFAULT_OFFLINE_GRACE_DAYS) : null
);

/** Org-imposed idle-timeout cap (minutes) when a policy is active; null = no org cap. */
export const selectOrgIdleTimeoutMinutes = createSelector(
  [selectGovernance, selectPolicyActive],
  (g, active): number | null => (active ? (g.policy?.session.idleTimeoutMinutes ?? null) : null)
);

/**
 * Org restreint le téléchargement pour les LECTEURS (politique active seulement).
 *
 * BEST-EFFORT DÉCLARÉ, PAS UNE GARANTIE — et c'est dit à l'administrateur dans
 * l'écran de politique. Sous E2EE, un lecteur détient la clé du coffre et le
 * chiffré : rien ne peut l'empêcher de reconstruire le fichier. Ce sélecteur
 * pilote l'interface (masquer les gestes de téléchargement/export), c'est-à-dire
 * exactement ce qu'un client honnête peut offrir. Il était transporté, stocké,
 * réglé dans l'écran d'administration — et lu par RIEN : un interrupteur qui
 * mentait à l'administrateur, ce qui est pire que son absence.
 */
export const selectRestrictDownloadByOrg = createSelector(
  [selectGovernance, selectPolicyActive],
  (g, active): boolean => active && (g.policy?.sharing.restrictDownload ?? false)
);

// ── Poste de travail ─────────────────────────────────────────────────────────
//
// UNE SEULE PORTE D'ENTRÉE, `selectWorkspacePolicy`, et toutes les autres en
// dérivent. Chaque écran qui poserait la question à sa façon — « ai-je une
// politique active ? le champ est-il là ? » — serait une occasion de plus de
// répondre « restreint » à une absence d'information, c'est-à-dire de punir un
// utilisateur pour un Worker plus ancien ou une requête réseau ratée.

/**
 * La politique de poste effective, ou l'application telle qu'elle est vendue.
 *
 * `policyVersion === 0` signifie qu'aucun administrateur n'a jamais rien réglé :
 * il n'y a alors rien à appliquer, exactement comme pour les autres sections.
 */
export const selectWorkspacePolicy = createSelector(
  [selectGovernance, selectPolicyActive],
  (g, active): WorkspacePolicyView => (active ? g.policy?.workspace : null) ?? OPEN_WORKSPACE_POLICY
);

/** La place de marché est-elle joignable depuis ce poste ? (entrée de la barre latérale, route) */
export const selectMarketplaceAllowed = createSelector(
  [selectWorkspacePolicy],
  (w): boolean => !w.marketplaceDisabled && w.pluginPolicy !== 'blocked'
);

/** Le marché de modèles de mise en page est-il joignable ? */
export const selectLayoutMarketAllowed = createSelector(
  [selectWorkspacePolicy],
  (w): boolean => !w.marketplaceDisabled && !w.layoutMarketDisabled
);

/** Publier une extension ou un modèle depuis ce poste. */
export const selectPublishingAllowed = createSelector(
  [selectWorkspacePolicy],
  (w): boolean => !w.publishingDisabled
);

/**
 * Cette extension peut-elle être chargée ?
 *
 * MÊME RÈGLE que `isPluginAllowed` côté Worker, réécrite ici parce que le client
 * ne peut pas importer le code du Worker — et c'est précisément pourquoi elle
 * tient en quatre lignes et est testée des deux côtés. Une divergence se lirait
 * en production comme une extension affichée comme disponible que le serveur
 * refuse ensuite de livrer.
 */
export const selectIsPluginAllowed = createSelector(
  [selectWorkspacePolicy],
  (w) =>
    (pluginId: string): boolean => {
      if (w.marketplaceDisabled) return false;
      if (w.pluginPolicy === 'blocked') return false;
      if (w.pluginPolicy === 'allowlist') return w.allowedPluginIds.includes(pluginId);
      return true;
    }
);

/**
 * L'apparence imposée ou proposée par l'organisation.
 *
 * `locked` est ce qui distingue les deux, et la distinction se voit à l'écran :
 * un défaut se pose une fois et l'utilisateur reste libre d'en changer ; un
 * verrou retire le choix des réglages et l'explique. Sans cette différence, tout
 * défaut d'organisation ressemblerait à une panne du choix de thème.
 */
export const selectOrgAppearance = createSelector(
  [selectWorkspacePolicy],
  (
    w
  ): {
    theme: string | null;
    themeLocked: boolean;
    fontId: string | null;
    fontLocked: boolean;
  } => ({
    theme: w.defaultTheme,
    themeLocked: w.themeLocked,
    fontId: w.defaultFontId,
    fontLocked: w.fontLocked,
  })
);

/** Org forbids external shares (active policy only) — gates the client share-creation UI. */
export const selectExternalSharesDisabledByOrg = createSelector(
  [selectGovernance, selectPolicyActive],
  (g, active): boolean => active && (g.policy?.sharing.externalSharesDisabled ?? false)
);

/**
 * Effective auto-lock config = the org idle cap (when a policy is active) intersected with the user's
 * own setting. The org cap is a MAXIMUM: a user who picked a shorter timeout keeps it (more secure),
 * and if the org sets a cap, auto-lock is FORCED on even if the user disabled it. Best-effort (E9-10).
 */
export const selectEffectiveAutoLock = createSelector(
  [selectOrgIdleTimeoutMinutes, selectSecurity],
  (orgIdle, security): { enabled: boolean; timeoutMinutes: number } => {
    const userEnabled = !!security.autoLockEnabled && security.autoLockTimeout > 0;
    if (orgIdle && orgIdle > 0) {
      return {
        enabled: true,
        timeoutMinutes: userEnabled ? Math.min(orgIdle, security.autoLockTimeout) : orgIdle,
      };
    }
    return { enabled: userEnabled, timeoutMinutes: security.autoLockTimeout };
  }
);
