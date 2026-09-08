/**
 * Selecteurs pour l'authentification (mode local)
 */

import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '../index';
import type { OrgSummary, OrgRole } from '../../types/org';
import type { WorkspaceSpace } from '../slices/orgSlice';
import { ENTERPRISE_ACCESSIBLE } from '../../config/enterprise';

const selectAuthState = (state: RootState) => state.auth;
const selectOrgState = (state: RootState) => state.org;

export const selectIsAuthenticated = createSelector(
  [selectAuthState],
  (auth) => auth.isAuthenticated
);

export const selectAuthLoading = createSelector([selectAuthState], (auth) => auth.loading);

export const selectLocalProfile = createSelector([selectAuthState], (auth) => auth.localProfile);

export const selectIsLocked = createSelector([selectAuthState], (auth) => auth.isLocked);

/**
 * CE PROFIL EST-IL DANS LE NUAGE ? — à distinguer de « suis-je connecté ».
 *
 * ── POURQUOI CE SÉLECTEUR EXISTE ────────────────────────────────────────────
 *
 * `accountMode === 'cloud'` ne dit qu'une chose : une session est ouverte dans
 * ce navigateur. Sur le web elle revient TOUTE SEULE — le cookie de
 * rafraîchissement est posé pour le domaine, donc s'inscrire sur filarr.com
 * pour Filarr Send suffit à ouvrir une session sur app.filarr.com.
 *
 * Le PROFIL, lui, n'est rattaché que par une connexion explicite. Un profil
 * local ouvert pendant qu'une session traîne donne donc `accountMode: 'cloud'`
 * avec `profileAttachedTo: null` : rien de ce qu'il contient ne part dans le
 * nuage, et la synchronisation refuse chaque cycle.
 *
 * ── CE QU'IL FAUT DEMANDER, ET QUAND ────────────────────────────────────────
 *
 * Les deux questions sont légitimes, et elles n'ont pas la même réponse :
 *
 *   · « puis-je publier sur la place de marché ? » — la SESSION suffit, elle
 *     ne touche à aucune donnée de profil ;
 *   · « mes fichiers partent-ils ? mon quota ? l'état de la synchro ? » — le
 *     PROFIL, et lui seul.
 *
 * Les écrans de la seconde famille lisaient la première, et affichaient donc
 * « Synchronisation activée » sur un profil qui ne synchronisera jamais.
 */
export const selectProfileIsCloud = createSelector(
  [selectAuthState],
  (auth) => auth.accountMode === 'cloud' && auth.profileAttachedTo !== null
);

// ── Plan / tier gating ──────────────────────────────────────────────────────
// The cloud subscription tier drives feature availability. Local mode (no cloud
// account) has cloudUser === null and is treated as 'free'. These selectors are
// UX hints only — the Cloudflare Worker remains authoritative for any limit that
// matters server-side (see infra/cloudflare-worker/src/billing.ts, share.ts).

export type SubscriptionTier = 'free' | 'solo' | 'pro' | 'teams' | 'enterprise';

// ── Organization context (E1-6) ─────────────────────────────────────────────

export const selectOrgs = createSelector([selectOrgState], (org): OrgSummary[] => org.orgs);

export const selectCurrentOrgId = createSelector(
  [selectOrgState],
  (org): string | null => org.currentOrgId
);

export const selectCurrentOrg = createSelector([selectOrgState], (org): OrgSummary | null =>
  org.currentOrgId ? (org.orgs.find((o) => o.id === org.currentOrgId) ?? null) : null
);

// ── Workspace space (personal | enterprise) — THE gating axis ────────────────
// spaceMode is the persisted per-profile intent; currentOrgId is the bound-org
// requirement. Their AND is the single boolean every enterprise surface gates
// on. Personal space = !isEnterpriseSpace and covers: local mode, cloud-with-no-
// org, and a cloud member who explicitly chose personal.

export const selectActiveSpace = createSelector(
  [selectOrgState],
  (org): WorkspaceSpace => org.spaceMode
);

/** THE canonical enterprise gate. Every enterprise surface consumes this.
 *  Forced off while enterprise is not yet shipped (ENTERPRISE_ACCESSIBLE), so no
 *  enterprise feature can render even for an enterprise-typed profile. */
export const selectIsEnterpriseSpace = createSelector(
  [selectActiveSpace, selectCurrentOrgId],
  (space, orgId): boolean => ENTERPRISE_ACCESSIBLE && space === 'enterprise' && orgId != null
);

/**
 * La personne est-elle ENTRÉE dans l'espace organisation ?
 *
 * ── POURQUOI CE SÉLECTEUR EXISTE À CÔTÉ DE `selectIsEnterpriseSpace` ─────────
 *
 * Le second exige en plus une organisation LIÉE (`currentOrgId`). C'est juste
 * pour décider si une fonction d'organisation peut s'exécuter — sans locataire,
 * il n'y a rien à administrer. Mais c'est faux pour décider si la SURFACE doit
 * exister : quelqu'un qui vient de créer son compte d'organisation n'appartient
 * encore à aucune, et se retrouvait donc devant une application ordinaire, sans
 * la moindre entrée « Organisation » — ni moyen d'en créer une. L'espace était
 * choisi, marqué dans l'en-tête, et pourtant vide de toute trace de lui-même.
 *
 * Celui-ci répond « la personne a choisi cet espace », ce qui suffit à lui
 * montrer la porte et à lui expliquer ce qu'il s'y passe.
 */
export const selectIsOrgSpaceEntered = createSelector(
  [selectActiveSpace],
  (space): boolean => ENTERPRISE_ACCESSIBLE && space === 'enterprise'
);

/** Les organisations RÉELLES (non personnelles, non en suppression) du compte. */
export const selectRealOrgs = createSelector([selectOrgs], (orgs): OrgSummary[] =>
  orgs.filter((o) => !o.isPersonal && o.status !== 'pending_deletion')
);

/** The caller's role in the active org, or null in personal context. */
export const selectCurrentOrgRole = createSelector(
  [selectCurrentOrg],
  (org): OrgRole | null => org?.role ?? null
);

/** Owner/admin gate for the admin console + management UI (E1-8). */
export const selectCanManageOrg = createSelector(
  [selectCurrentOrgRole, selectIsEnterpriseSpace],
  (role, isEnterprise): boolean => isEnterprise && (role === 'owner' || role === 'admin')
);

// The effective tier drives plan gating. Only in ENTERPRISE space does the
// active org's tier win; in personal space the personal cloud tier always
// applies so an org seat never unlocks personal paid features while the user is
// in their personal space. The Worker stays authoritative server-side.
export const selectSubscriptionTier = createSelector(
  [selectAuthState, selectCurrentOrg, selectIsEnterpriseSpace],
  (auth, currentOrg, isEnterprise): SubscriptionTier =>
    (isEnterprise ? (currentOrg?.tier as SubscriptionTier) : undefined) ??
    (auth.cloudUser?.subscriptionTier as SubscriptionTier) ??
    'free'
);

/** Paid tiers — personal (solo/pro) and org (teams/enterprise, both ≥ pro). */
const isPaid = (tier: SubscriptionTier) =>
  tier === 'solo' || tier === 'pro' || tier === 'teams' || tier === 'enterprise';

/** Pro-and-above — includes the org tiers (teams/enterprise ≥ pro). */
const isProPlus = (tier: SubscriptionTier) =>
  tier === 'pro' || tier === 'teams' || tier === 'enterprise';

/** Solo+ — hardware-key vault unlock (#7) and hidden vault (#6). */
export const selectCanUseHardwareKey = createSelector([selectSubscriptionTier], isPaid);

export const selectCanUseHiddenVault = createSelector([selectSubscriptionTier], isPaid);

/** Pro+ — passwordless mode (#7) and wipe-on-duress (#6). */
export const selectCanUsePasswordless = createSelector([selectSubscriptionTier], isProPlus);

export const selectCanUseWipeOnDuress = createSelector([selectSubscriptionTier], isProPlus);

/** Solo+ — unlimited web clips (#9); Free is capped (see CLIPPER_FREE_MONTHLY_LIMIT). */
export const selectClipperUnlimited = createSelector([selectSubscriptionTier], isPaid);

/** The org plans, as opposed to the personal paid plans. */
const isOrgPlan = (tier: SubscriptionTier) => tier === 'teams' || tier === 'enterprise';

/** Teams/Enterprise plan — org-only capabilities (governance policies, …). */
export const selectIsOrgPlan = createSelector([selectSubscriptionTier], isOrgPlan);

// ── Implicit org context for shared vaults ──────────────────────────────────
//
// Every account carries an auto-provisioned "personal org" (is_personal = 1,
// created at register). It is a billing/tenancy primitive, NEVER a workspace the
// user picks: it is filtered out of the org switcher and the word "organization"
// must not appear anywhere in the personal UI. Shared vaults reuse it as their
// tenant so the audited RBAC model (roles, seats, pooled quota, anti-enumeration)
// stays exactly as it is instead of growing a second, unaudited access model.
//
// A user can sit in SEVERAL personal spaces: their own (role 'owner') plus one
// per person who invited them as a guest. So "the personal org" is ambiguous and
// `role === 'owner'` — not `isPersonal` alone — is what identifies MY space. Get
// this wrong and a guest's vault list is scoped to their own empty space.

const isLivePersonalOrg = (o: OrgSummary) => o.isPersonal && o.status !== 'pending_deletion';

/** MY personal space: the one I own. Null while the org list hasn't loaded. */
export const selectPersonalOrgId = createSelector(
  [selectOrgs],
  (orgs): string | null => orgs.find((o) => isLivePersonalOrg(o) && o.role === 'owner')?.id ?? null
);

/** True when someone else's personal space has taken us in as a guest. */
export const selectIsSharedVaultGuest = createSelector([selectOrgs], (orgs): boolean =>
  orgs.some((o) => isLivePersonalOrg(o) && o.role !== 'owner')
);

/**
 * Shared vaults (E3) — ANY paid tier, personal plans included, plus guests.
 *
 * This used to require enterprise space, which made the feature unreachable: the
 * enterprise experience is deliberately closed (ENTERPRISE_ACCESSIBLE === false)
 * so `selectIsEnterpriseSpace` is always false. Shared vaults are a product of
 * their own, sold with every paid plan; a personal paid user gets them inside
 * their PERSONAL space, with an implicit org context (see selectSharedVaultOrgIds)
 * they never see. Opening this does NOT open the enterprise surface: the admin
 * console, SSO and the space chooser stay behind selectIsEnterpriseSpace /
 * selectCanManageOrg.
 *
 * THE GUEST CLAUSE IS NOT A LOOPHOLE. It is the owner who pays; a guest they
 * invited may well be on the free plan, and gating the nav entry on the caller's
 * own tier would hand them an invitation they can never open. Being a guest is
 * itself server-granted state (an active membership in someone's space), not a
 * client-side claim, and it unlocks exactly one thing: the shared-vault screen.
 * A free account nobody invited sees no change at all.
 *
 * UX gate only — the Worker re-checks the entitlement on every vault endpoint.
 */
export const selectCanUseTeamVaults = createSelector(
  [selectSubscriptionTier, selectIsSharedVaultGuest],
  (tier, isGuest): boolean => isPaid(tier) || isGuest
);

/**
 * THE tenant for shared-vault actions that are about MY space: creating a vault,
 * inviting someone into the space, reading its roster and its occupancy.
 * Enterprise space keeps its explicitly chosen org.
 */
export const selectSharedVaultOrgId = createSelector(
  [selectIsEnterpriseSpace, selectCurrentOrgId, selectPersonalOrgId],
  (isEnterprise, currentOrgId, personalOrgId): string | null =>
    isEnterprise ? currentOrgId : personalOrgId
);

/**
 * EVERY tenant whose vaults belong in the list — mine plus every space I was
 * invited into. `GET /vaults` is org-scoped, so one call per space is what turns
 * "my vaults" and "vaults shared with me" into the single list the user sees.
 * Empty = no context yet (org list not loaded / offline).
 */
export const selectSharedVaultOrgIds = createSelector(
  [selectIsEnterpriseSpace, selectCurrentOrgId, selectOrgs],
  (isEnterprise, currentOrgId, orgs): string[] =>
    isEnterprise
      ? currentOrgId
        ? [currentOrgId]
        : []
      : orgs.filter(isLivePersonalOrg).map((o) => o.id)
);
