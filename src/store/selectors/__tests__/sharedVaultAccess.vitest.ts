/**
 * Shared vaults: who may reach them, and in whose tenant.
 *
 * Two things are being pinned down here, and they are the two that broke the
 * feature before:
 *   1. the ENTITLEMENT no longer depends on the enterprise space (which is closed
 *      and cannot be opened), while the enterprise SURFACE still does;
 *   2. "the personal org" is ambiguous the moment anyone is invited anywhere —
 *      a guest belongs to two personal spaces — so MY space is the one I own, and
 *      the vault LIST spans all of them.
 */

import { describe, it, expect } from 'vitest';
import {
  selectCanUseTeamVaults,
  selectIsOrgPlan,
  selectIsEnterpriseSpace,
  selectCanManageOrg,
  selectPersonalOrgId,
  selectSharedVaultOrgId,
  selectSharedVaultOrgIds,
  selectIsSharedVaultGuest,
  type SubscriptionTier,
} from '../authSelectors';
import type { OrgSummary } from '../../../types/org';
import type { RootState } from '../../index';

type Org = Partial<OrgSummary> & { id: string };

const org = (o: Org): OrgSummary => ({
  name: o.id,
  slug: null,
  tier: 'free',
  role: 'owner',
  billingStatus: 'active',
  status: 'active',
  isPersonal: true,
  ...o,
});

/** Minimal state: these selectors read auth + org and nothing else. */
const state = (opts: {
  tier?: SubscriptionTier | null;
  orgs?: OrgSummary[];
  currentOrgId?: string | null;
  spaceMode?: 'personal' | 'enterprise';
}): RootState =>
  ({
    auth: { cloudUser: opts.tier ? { subscriptionTier: opts.tier } : null },
    org: {
      orgs: opts.orgs ?? [],
      currentOrgId: opts.currentOrgId ?? null,
      spaceMode: opts.spaceMode ?? 'personal',
    },
  }) as unknown as RootState;

const MINE = org({ id: 'mine', role: 'owner', isPersonal: true });
const HOSTS = org({ id: 'host', role: 'editor', isPersonal: true });
const REAL = org({ id: 'acme', role: 'owner', isPersonal: false, tier: 'teams' });

describe('shared-vault entitlement', () => {
  it('is granted to every paid personal tier, in the PERSONAL space', () => {
    for (const tier of ['solo', 'pro', 'teams', 'enterprise'] as SubscriptionTier[]) {
      expect(selectCanUseTeamVaults(state({ tier, orgs: [MINE] }))).toBe(true);
    }
  });

  it('is refused to a free account nobody invited (no new surface for free users)', () => {
    expect(selectCanUseTeamVaults(state({ tier: 'free', orgs: [MINE] }))).toBe(false);
    // Local mode: no cloud account at all.
    expect(selectCanUseTeamVaults(state({ tier: null }))).toBe(false);
  });

  it('is granted to a FREE guest of someone else’s space — the owner is the one paying', () => {
    expect(selectCanUseTeamVaults(state({ tier: 'free', orgs: [MINE, HOSTS] }))).toBe(true);
    expect(selectIsSharedVaultGuest(state({ tier: 'free', orgs: [MINE, HOSTS] }))).toBe(true);
    // Owning a personal org is not being a guest of one.
    expect(selectIsSharedVaultGuest(state({ tier: 'pro', orgs: [MINE] }))).toBe(false);
  });

  it('la surface d’organisation s’ouvre — mais seulement avec un locataire lié', () => {
    /**
     * CE TEST DISAIT L'INVERSE, et il avait raison de le dire à l'époque : le
     * drapeau unique fermait tout, et il fallait un garde-fou pour qu'une
     * fonction non finie ne se glisse pas dehors par inadvertance.
     *
     * La porte est ouverte à dessein depuis, et le drapeau global a été remplacé
     * par des drapeaux par fonction. Le retourner plutôt que le supprimer garde
     * une trace exécutable de ce qui EST vrai maintenant — et surtout de la
     * condition qui subsiste, la seule qui compte encore : la surface exige un
     * locataire lié. C'est elle qui, en restant nulle, rendait la console
     * introuvable alors que l'espace était bien choisi.
     */
    const s = state({
      tier: 'enterprise',
      orgs: [REAL],
      currentOrgId: 'acme',
      spaceMode: 'enterprise',
    });
    expect(selectCanUseTeamVaults(s)).toBe(true);
    expect(selectIsEnterpriseSpace(s)).toBe(true);
    expect(selectCanManageOrg(s)).toBe(true);
  });

  it('sans organisation liée, la surface reste fermée même en espace d’organisation', () => {
    // L'impasse corrigée : l'espace est choisi, mais aucun locataire n'est actif.
    // La console n'a alors rien à administrer — c'est l'ecran sans-organisation qui repond.
    const s = state({
      tier: 'enterprise',
      orgs: [REAL],
      currentOrgId: null,
      spaceMode: 'enterprise',
    });
    expect(selectIsEnterpriseSpace(s)).toBe(false);
    expect(selectCanManageOrg(s)).toBe(false);
  });

  it('keeps governance on the ORG plan, not on the vault entitlement', () => {
    expect(selectIsOrgPlan(state({ tier: 'pro', orgs: [MINE] }))).toBe(false);
    expect(selectCanUseTeamVaults(state({ tier: 'pro', orgs: [MINE] }))).toBe(true);
    expect(selectIsOrgPlan(state({ tier: 'teams', orgs: [MINE] }))).toBe(true);
  });
});

describe('implicit org context', () => {
  it('resolves MY space by ownership, not by isPersonal alone', () => {
    // A guest sees two personal orgs; picking the host's would scope our own
    // vaults to a space we don't own.
    const s = state({ tier: 'solo', orgs: [HOSTS, MINE] });
    expect(selectPersonalOrgId(s)).toBe('mine');
    expect(selectSharedVaultOrgId(s)).toBe('mine');
  });

  it('lists vaults across every space we stand in', () => {
    expect(selectSharedVaultOrgIds(state({ tier: 'free', orgs: [MINE, HOSTS] }))).toEqual([
      'mine',
      'host',
    ]);
  });

  it('ignores real orgs and spaces being torn down', () => {
    const dying = org({ id: 'gone', role: 'owner', status: 'pending_deletion' });
    const s = state({ tier: 'pro', orgs: [REAL, dying, MINE] });
    expect(selectSharedVaultOrgIds(s)).toEqual(['mine']);
    expect(selectPersonalOrgId(s)).toBe('mine');
  });

  it('is null before the org list has loaded — the screen retries, it does not call without a tenant', () => {
    const s = state({ tier: 'pro', orgs: [] });
    expect(selectSharedVaultOrgId(s)).toBeNull();
    expect(selectSharedVaultOrgIds(s)).toEqual([]);
  });

  it('never adopts the host’s space as our own when we own none yet', () => {
    expect(selectPersonalOrgId(state({ tier: 'free', orgs: [HOSTS] }))).toBeNull();
    expect(selectSharedVaultOrgIds(state({ tier: 'free', orgs: [HOSTS] }))).toEqual(['host']);
  });
});
