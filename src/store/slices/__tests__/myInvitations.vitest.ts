/**
 * La boîte de réception /me — les trois thunks et leurs deux invariants durs :
 *
 *   · ORDRE : à l'acceptation, `rememberVaultOrg` est appelé AVANT `loadVaults`.
 *     Le coffre accepté vit dans le locataire de l'INVITATION ; charger d'abord
 *     ferait résoudre le nouveau coffre contre le mauvais espace et le déballage
 *     de K_vault échouerait au premier passage.
 *   · RÉCONCILIATION : un lien e-mail encore armé pour le MÊME coffre est
 *     effacé — sinon l'écran d'acceptation représenterait un jeton que le
 *     serveur vient de régler, et son `invite_invalid` détruirait la confiance.
 *
 * Le refus, lui, doit rester honnête sur la course : `invite_settled` n'est pas
 * une erreur pour l'utilisatrice — la liste rechargée fait foi.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';

const calls: string[] = [];

vi.mock('../../../services/vault/vaultApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/vault/vaultApi')>();
  return {
    ...actual,
    apiListMyInvitations: vi.fn(async () => []),
    apiAcceptMyInvitation: vi.fn(async () => {
      calls.push('accept');
      return { vaultId: 'v-new', orgId: 'org-invite', role: 'member' };
    }),
    apiDeclineMyInvitation: vi.fn(async () => {}),
    // loadVaults se réduit à « aucune liste » : le test observe l'ORDRE des
    // appels, pas le déchiffrement.
    apiListVaults: vi.fn(async () => {
      calls.push('loadVaults');
      return [];
    }),
  };
});

vi.mock('../../../services/network/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/network/apiClient')>();
  return {
    ...actual,
    rememberVaultOrg: vi.fn((vaultId: string, orgId: string) => {
      calls.push(`remember:${vaultId}:${orgId}`);
    }),
    getOrgContextId: vi.fn(() => 'org-ambient'),
  };
});

vi.mock('../../../services/invites/pendingInvite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/invites/pendingInvite')>();
  return {
    ...actual,
    readPendingInvites: vi.fn(() => pendingLinks),
    clearPendingInvite: vi.fn((inv: unknown) => {
      cleared.push(inv);
    }),
  };
});

import * as vaultApi from '../../../services/vault/vaultApi';
import { clearPendingInvite } from '../../../services/invites/pendingInvite';
import vaultsReducer, {
  fetchMyInvitations,
  acceptMyInvitation,
  declineMyInvitation,
} from '../vaultsSlice';
import type { MyInvitationDTO } from '../../../services/vault/vaultApi';

let pendingLinks: Array<{ kind: string; vaultId?: string; token: string }> = [];
const cleared: unknown[] = [];

function makeStore() {
  return configureStore({
    reducer: {
      vaults: vaultsReducer,
      org: () => ({ orgs: [], currentOrgId: 'org-ambient', spaceMode: 'personal' }),
      auth: () => ({ cloudUser: { subscriptionTier: 'pro' } }),
    },
  });
}

function invitation(o: Partial<MyInvitationDTO> = {}): MyInvitationDTO {
  return {
    id: 'inv1',
    vaultId: 'v-new',
    orgId: 'org-invite',
    orgName: 'Acme',
    role: 'member',
    expiresAt: '2099-01-01T00:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    invitedByEmail: 'host@x.com',
    stale: false,
    ...o,
  };
}

/**
 * Ce que /me rend vraiment : DEUX listes qui ne se confondent pas. `invitations`
 * demande une réponse, `awaitingHost` (0073) n'en demande aucune et se contente
 * de nommer une attente — l'accès qu'un hôte doit encore sceller.
 */
function inbox(
  invitations: vaultApi.MyInvitationDTO[],
  awaitingHost: vaultApi.AwaitingHostDTO[] = []
): { invitations: vaultApi.MyInvitationDTO[]; awaitingHost: vaultApi.AwaitingHostDTO[] } {
  return { invitations, awaitingHost };
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  cleared.length = 0;
  pendingLinks = [];
});

describe('fetchMyInvitations', () => {
  it('remplit la boîte et retombe toujours sur ses pieds', async () => {
    vi.mocked(vaultApi.apiListMyInvitations).mockResolvedValue(inbox([invitation()]));
    const store = makeStore();
    await store.dispatch(fetchMyInvitations());
    expect(store.getState().vaults.myInvitations).toHaveLength(1);
    expect(store.getState().vaults.myInvitationsLoading).toBe(false);
  });

  it("range l'attente d'un accès promis SÉPARÉMENT des invitations (0073)", async () => {
    // Les confondre remettrait un bouton « Accepter » devant quelque chose qui
    // ne s'accepte pas : l'hôte n'a pas encore scellé, il n'y a rien à répondre.
    vi.mocked(vaultApi.apiListMyInvitations).mockResolvedValue(
      inbox([], [{ orgId: 'org1', orgName: 'Acme', role: 'member', since: '2026-08-20' }])
    );
    const store = makeStore();
    await store.dispatch(fetchMyInvitations());

    expect(store.getState().vaults.myInvitations).toEqual([]);
    expect(store.getState().vaults.awaitingHost).toHaveLength(1);
    expect(store.getState().vaults.awaitingHost[0].orgName).toBe('Acme');
  });

  it("l'attente DISPARAÎT dès que le serveur ne la rend plus", async () => {
    // Remplacée, jamais fusionnée : l'accès accordé entre-temps ne doit pas
    // laisser à l'écran une phrase qui dit qu'on attend encore.
    vi.mocked(vaultApi.apiListMyInvitations).mockResolvedValue(
      inbox([], [{ orgId: 'org1', orgName: 'Acme', role: 'member', since: '2026-08-20' }])
    );
    const store = makeStore();
    await store.dispatch(fetchMyInvitations());
    expect(store.getState().vaults.awaitingHost).toHaveLength(1);

    vi.mocked(vaultApi.apiListMyInvitations).mockResolvedValue(inbox([]));
    await store.dispatch(fetchMyInvitations());
    expect(store.getState().vaults.awaitingHost).toEqual([]);
  });
});

describe('acceptMyInvitation', () => {
  it('ÉPINGLE le locataire de l’invitation AVANT de recharger les coffres', async () => {
    const store = makeStore();
    const r = await store.dispatch(acceptMyInvitation({ inviteId: 'inv1' }));
    expect(acceptMyInvitation.fulfilled.match(r)).toBe(true);
    const remember = calls.indexOf('remember:v-new:org-invite');
    const load = calls.indexOf('loadVaults');
    expect(remember).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(-1);
    // L'invariant du test : épingler d'abord, charger ensuite.
    expect(remember).toBeLessThan(load);
  });

  it('efface un lien e-mail armé pour le MÊME coffre — et seulement lui', async () => {
    pendingLinks = [
      { kind: 'vault', vaultId: 'v-new', token: 'T1' },
      { kind: 'vault', vaultId: 'v-autre', token: 'T2' },
      { kind: 'org', token: 'T3' },
    ];
    const store = makeStore();
    await store.dispatch(acceptMyInvitation({ inviteId: 'inv1' }));
    expect(cleared).toHaveLength(1);
    expect((cleared[0] as { vaultId?: string }).vaultId).toBe('v-new');
    expect(vi.mocked(clearPendingInvite)).toHaveBeenCalledTimes(1);
  });

  it('retire la ligne acceptée de la boîte sans attendre le refetch', async () => {
    vi.mocked(vaultApi.apiListMyInvitations).mockResolvedValue(
      inbox([invitation(), invitation({ id: 'inv2', vaultId: 'v-autre' })])
    );
    const store = makeStore();
    await store.dispatch(fetchMyInvitations());
    // Le refetch interne rendra la même liste ; l'assertion vise le reducer
    // optimiste d'`acceptMyInvitation.fulfilled`, pas l'état final du réseau.
    vi.mocked(vaultApi.apiListMyInvitations).mockResolvedValue(inbox([]));
    await store.dispatch(acceptMyInvitation({ inviteId: 'inv1' }));
    expect(store.getState().vaults.myInvitations).toEqual([]);
  });

  it('porte le code du serveur en cas de refus, sans toucher à la boîte', async () => {
    vi.mocked(vaultApi.apiAcceptMyInvitation).mockRejectedValue(new Error('invite_stale_epoch'));
    vi.mocked(vaultApi.apiListMyInvitations).mockResolvedValue(
      inbox([invitation({ stale: true })])
    );
    const store = makeStore();
    await store.dispatch(fetchMyInvitations());
    const r = await store.dispatch(acceptMyInvitation({ inviteId: 'inv1' }));
    expect(acceptMyInvitation.rejected.match(r)).toBe(true);
    expect(r.payload).toBe('invite_stale_epoch');
    expect(store.getState().vaults.myInvitations).toHaveLength(1);
    expect(calls).not.toContain('loadVaults');
  });
});

describe('declineMyInvitation', () => {
  it('refuse puis recharge la boîte', async () => {
    vi.mocked(vaultApi.apiListMyInvitations).mockResolvedValue(inbox([]));
    const store = makeStore();
    const r = await store.dispatch(declineMyInvitation({ inviteId: 'inv1' }));
    expect(declineMyInvitation.fulfilled.match(r)).toBe(true);
    expect(vaultApi.apiDeclineMyInvitation).toHaveBeenCalledWith('inv1');
    expect(vaultApi.apiListMyInvitations).toHaveBeenCalled();
  });

  it('perdre la course (invite_settled) N’EST PAS une erreur — la liste fraîche fait foi', async () => {
    vi.mocked(vaultApi.apiDeclineMyInvitation).mockRejectedValue(new Error('invite_settled'));
    vi.mocked(vaultApi.apiListMyInvitations).mockResolvedValue(inbox([]));
    const store = makeStore();
    const r = await store.dispatch(declineMyInvitation({ inviteId: 'inv1' }));
    expect(declineMyInvitation.fulfilled.match(r)).toBe(true);
    expect(vaultApi.apiListMyInvitations).toHaveBeenCalled();
  });

  it('un vrai refus (réseau, session) reste une erreur portée', async () => {
    vi.mocked(vaultApi.apiDeclineMyInvitation).mockRejectedValue(new Error('session_expired'));
    const store = makeStore();
    const r = await store.dispatch(declineMyInvitation({ inviteId: 'inv1' }));
    expect(declineMyInvitation.rejected.match(r)).toBe(true);
    expect(r.payload).toBe('session_expired');
  });
});
