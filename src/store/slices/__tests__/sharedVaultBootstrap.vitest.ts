/**
 * Opening Shared Vaults on an account that has NO personal space yet.
 *
 * THE BUG THIS PINS DOWN. Personal spaces are auto-provisioned at register, but that
 * shipped after most accounts were created and the backfill missed them. For such an
 * account `GET /org` answers with an empty list, so the client held no tenant — and
 * rather than ask the server for one, it gave up before making a single request and
 * told the user to check their connection. Nothing was wrong with the connection.
 *
 * So two properties, and they are the two that were broken:
 *   1. AMORÇAGE — an entitled account with no space gets one created, then sees its
 *      (empty) vault list, without doing anything special. Once created, it is not
 *      created again: opening the screen twice provisions once.
 *   2. VÉRITÉ — every other way this can fail arrives with its OWN reason. A plan that
 *      doesn't include shared vaults is not a network problem; neither is a 403, nor a
 *      Worker that threw. Only an unanswered request says "check your connection".
 *
 * The HTTP layer is stubbed (there is no Worker in a unit test); the classification,
 * the org list, the selectors and the thunk ladder are the real code path.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import type { OrgSummary } from '../../../types/org';

// ── The simulated server + its client-side ambient context ───────────────────

interface FakeSpace {
  id: string;
  tier: string;
}

let serverOrgs: OrgSummary[] = [];
let space: FakeSpace | null = null;
/** The plan the SERVER holds — the only authority on entitlement. */
let serverTier = 'solo';
let provisionCalls = 0;
let listVaultsCalls: Array<string | undefined> = [];
let listVaultsFailure: (() => never) | null = null;

/** An axios-shaped rejection: the server answered, with (or without) a code. */
function httpError(status: number, code?: string) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data: code ? { success: false, code } : { success: false } },
  });
}

/** An axios-shaped rejection with NO response: nothing came back at all. */
function networkError() {
  return Object.assign(new Error('Network Error'), {
    isAxiosError: true,
    code: 'ERR_NETWORK',
  });
}

const PERSONAL_LIMITS: Record<string, number> = { solo: 3, pro: 10, teams: 25, enterprise: 25 };

// ── apiClient: the ambient tenant, kept as real module state ─────────────────

let implicitOrg: string | null = null;
let activeOrg: string | null = null;

vi.mock('../../../services/network/apiClient', () => ({
  default: {},
  getOrgContextId: (vaultId?: string) => (vaultId ? null : (activeOrg ?? implicitOrg)),
  getImplicitOrg: () => implicitOrg,
  setImplicitOrg: (id: string | null) => {
    implicitOrg = id;
  },
  setActiveOrg: (id: string | null) => {
    activeOrg = id;
  },
  rememberVaultOrg: vi.fn(),
  forgetVaultOrgs: vi.fn(),
}));

// ── vaultApi: real classification, stubbed transport ─────────────────────────

vi.mock('../../../services/vault/vaultApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/vault/vaultApi')>();
  return {
    ...actual,
    // POST /org/personal, including the parts that make it idempotent + tier-gated.
    apiEnsurePersonalSpace: vi.fn(async () => {
      provisionCalls++;
      const limit = PERSONAL_LIMITS[serverTier];
      if (limit === undefined) throw new Error('upgrade_required');
      // Yield BEFORE the read-before-insert guard, so two concurrent calls really do
      // interleave. Without this the guard runs synchronously, the calls serialise in
      // the event loop, and the idempotence test could not fail whatever the code did.
      await Promise.resolve();
      // Read before insert — a second call returns the first call's space.
      if (!space) {
        space = { id: 'space-1', tier: serverTier };
        serverOrgs = [
          ...serverOrgs,
          {
            id: space.id,
            name: 'me@example.com',
            slug: null,
            tier: 'free',
            role: 'owner',
            billingStatus: 'active',
            status: 'active',
            isPersonal: true,
          },
        ];
      }
      return {
        org: { id: space.id, name: 'me@example.com', isPersonal: true, status: 'active' },
        entitled: true,
        tier: serverTier,
        memberLimit: limit,
        membersUsed: 1,
      };
    }),
    apiListVaults: vi.fn(async (orgId?: string) => {
      listVaultsCalls.push(orgId);
      if (listVaultsFailure) listVaultsFailure();
      return [];
    }),
    apiCreateVault: vi.fn(async () => {
      throw new Error('unused in this suite');
    }),
  };
});

vi.mock('../../../services/vault/vaultKeyCache', () => ({
  getVaultKey: () => null,
  unlockVault: vi.fn(),
  isVaultUnlocked: () => false,
  lockVault: vi.fn(),
}));

vi.mock('../../../services/collab/collabSession', () => ({ purgeVaultCollab: vi.fn() }));

vi.mock('../../../services/auth/userKeypair', () => ({
  hasUserKeypair: () => false,
  getOwnPublicKey: vi.fn(async () => null),
  sealToPublicKey: vi.fn(),
  openSealed: vi.fn(),
  verifyKeypairIntegrity: vi.fn(),
  isKeyAlgoSupported: () => true,
}));

import vaultsReducer, { loadVaults } from '../vaultsSlice';
import orgReducer, { ensurePersonalSpace, fetchOrgs } from '../orgSlice';
import { apiEnsurePersonalSpace, apiListVaults } from '../../../services/vault/vaultApi';

// ── Harness ──────────────────────────────────────────────────────────────────

function makeStore(tier = 'solo') {
  // The tier the CLIENT believes it has. Deliberately independent of `serverTier`:
  // entitlement is the server's call, and a stale client claim must not decide it.
  const auth = { cloudUser: { subscriptionTier: tier } };
  return configureStore({
    reducer: { vaults: vaultsReducer, org: orgReducer, auth: () => auth },
    middleware: (gdm) => gdm({ serializableCheck: false, immutableCheck: false }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  serverOrgs = [];
  space = null;
  serverTier = 'solo';
  provisionCalls = 0;
  listVaultsCalls = [];
  listVaultsFailure = null;
  implicitOrg = null;
  activeOrg = null;
  // `GET /org` travels over IPC in the real app; node has no window, so stand one up.
  (globalThis as { window?: unknown }).window = {
    electron: {
      ipcRenderer: {
        invoke: async (channel: string) => {
          if (channel === 'org:list') return { success: true, data: { orgs: serverOrgs } };
          return { success: true, data: {} };
        },
      },
    },
  };
});

// ── 1. Amorçage ──────────────────────────────────────────────────────────────

describe('loadVaults — an account that never had a personal space', () => {
  it('creates one and lists the vaults, with no special action from the user', async () => {
    const store = makeStore('solo');
    const result = await store.dispatch(loadVaults());

    expect(result.meta.requestStatus).toBe('fulfilled');
    expect(apiEnsurePersonalSpace).toHaveBeenCalledTimes(1);
    expect(apiListVaults).toHaveBeenCalled();
    expect(store.getState().vaults.error).toBeNull();
    // The screen is empty because the space is new — not because anything failed.
    expect(store.getState().vaults.vaultIds).toEqual([]);
  });

  it('adopts the new space as the tenant, so the invite picker has one too', async () => {
    const store = makeStore('solo');
    await store.dispatch(loadVaults());

    // Both halves matter: the ambient header for calls in flight, and the org list
    // that selectSharedVaultOrgId (invite roster, email invitation) reads from.
    expect(implicitOrg).toBe('space-1');
    expect(store.getState().org.orgs.map((o) => o.id)).toEqual(['space-1']);
    expect(listVaultsCalls).toContain('space-1');
  });

  it('provisions ONCE however many times the screen is opened (idempotence)', async () => {
    const store = makeStore('solo');
    await store.dispatch(loadVaults());
    await store.dispatch(loadVaults());
    await store.dispatch(loadVaults());

    expect(provisionCalls).toBe(1);
    expect(store.getState().org.orgs).toHaveLength(1);
  });

  it('does not touch the entry point at all when a space is already known', async () => {
    const store = makeStore('solo');
    await store.dispatch(ensurePersonalSpace());
    vi.clearAllMocks();

    await store.dispatch(loadVaults());
    expect(apiEnsurePersonalSpace).not.toHaveBeenCalled();
  });

  it('does not re-provision when a lagging org list forgets the space it just made', async () => {
    const store = makeStore('solo');
    await store.dispatch(loadVaults());
    expect(provisionCalls).toBe(1);

    // The space exists, but this read of `GET /org` doesn't mention it yet. A list
    // that is missing information is not evidence the space is gone: creating a
    // second one here would be the very duplication the unique index exists to stop.
    const created = serverOrgs;
    serverOrgs = [];
    await store.dispatch(loadVaults());
    expect(provisionCalls).toBe(1);
    expect(implicitOrg).toBe('space-1');

    serverOrgs = created;
    await store.dispatch(loadVaults());
    expect(provisionCalls).toBe(1);
  });

  it('is idempotent at the entry point itself: two concurrent calls, one space', async () => {
    const store = makeStore('solo');
    const [a, b] = await Promise.all([
      store.dispatch(ensurePersonalSpace()),
      store.dispatch(ensurePersonalSpace()),
    ]);

    expect(a.meta.requestStatus).toBe('fulfilled');
    expect(b.meta.requestStatus).toBe('fulfilled');
    expect(serverOrgs).toHaveLength(1);
    expect(store.getState().org.orgs).toHaveLength(1);
  });
});

// ── 1 bis. Ce qui termine l'échelle : un espace À SOI ─────────────────────────

/**
 * KNOWING A TENANT IS NOT THE SAME AS HAVING ONE. Being a guest in someone else's
 * personal space fills the tenant list too — and an account with no space of its own
 * that happens to have been invited somewhere is EXACTLY the population this bootstrap
 * exists for. Stopping the ladder on "some tenant is known" skipped provisioning for
 * them: creating a vault then went out against the ambient context, the Worker's silent
 * fallback filed it under a space the client never learned, and the next refresh found
 * it outside the live set and locked it away. So the ladder ends on role 'owner'.
 */
const GUEST_SPACE: OrgSummary = {
  id: 'host-space',
  name: 'host@example.com',
  slug: null,
  tier: 'free',
  role: 'editor',
  billingStatus: 'active',
  status: 'active',
  isPersonal: true,
};

describe('loadVaults — invited elsewhere, but with no space of my own', () => {
  it('still provisions my own space instead of settling for the host’s', async () => {
    serverOrgs = [GUEST_SPACE];
    const store = makeStore('solo');
    const result = await store.dispatch(loadVaults());

    expect(result.meta.requestStatus).toBe('fulfilled');
    expect(provisionCalls).toBe(1);
    expect(implicitOrg).toBe('space-1');
    // And BOTH spaces are listed: mine, plus the one that invited me.
    expect([...listVaultsCalls].sort()).toEqual(['host-space', 'space-1']);
  });

  it('does not provision again once I own one', async () => {
    serverOrgs = [GUEST_SPACE];
    const store = makeStore('solo');
    await store.dispatch(loadVaults());
    await store.dispatch(loadVaults());

    expect(provisionCalls).toBe(1);
  });

  it('a free guest, refused a space, still sees what was shared WITH them', async () => {
    // The owner pays; the guest they invited is expected to be on the free plan. A
    // refusal to give them a space of their own must not hide their invitation.
    serverOrgs = [GUEST_SPACE];
    serverTier = 'free';
    const store = makeStore('free');
    const result = await store.dispatch(loadVaults());

    expect(result.meta.requestStatus).toBe('fulfilled');
    expect(listVaultsCalls).toEqual(['host-space']);
    expect(store.getState().vaults.error).toBeNull();
  });
});

// ── 1 ter. Le locataire appartient au COMPTE, pas au profil ──────────────────

describe('fetchOrgs — a signed-in list is authoritative, including when it is empty', () => {
  it('drops the previous account’s tenant when the new one owns no space', async () => {
    const store = makeStore('solo');
    await store.dispatch(loadVaults());
    expect(implicitOrg).toBe('space-1');

    // Sign out, sign in as someone else in the same profile: the server now answers
    // for THEM. Keeping the old tenant would send every vault call with the previous
    // account's X-Org-Id and earn a 403 — the very bug this bootstrap fixes, dressed
    // up as an authorization failure.
    serverOrgs = [];
    space = null;
    await store.dispatch(fetchOrgs());

    expect(implicitOrg).toBeNull();
  });

  it('keeps the tenant the creation itself returned, even if the list lags behind', async () => {
    const store = makeStore('solo');
    // The POST answers with the space; the `GET /org` it triggers hasn't caught up.
    // This is the ONE case where the client legitimately knows more than the list, and
    // it is why the creation re-adopts its own answer AFTER the refresh.
    (
      globalThis as { window: { electron: { ipcRenderer: { invoke: unknown } } } }
    ).window.electron.ipcRenderer.invoke = async () => ({ success: true, data: { orgs: [] } });
    const created = await store.dispatch(ensurePersonalSpace());

    expect(created.meta.requestStatus).toBe('fulfilled');
    expect(implicitOrg).toBe('space-1');
  });
});

// ── 2. Vérité des refus ──────────────────────────────────────────────────────

describe('loadVaults — a free account is refused, and told what to do', () => {
  it('rejects with upgrade_required, never a connectivity story', async () => {
    serverTier = 'free';
    const store = makeStore('free');
    const result = await store.dispatch(loadVaults());

    expect(result.meta.requestStatus).toBe('rejected');
    expect(store.getState().vaults.error).toBe('upgrade_required');
    // Refused BEFORE any vault request — there is no tenant to ask about.
    expect(apiListVaults).not.toHaveBeenCalled();
  });

  it('does not create a space for a tier that is not entitled', async () => {
    serverTier = 'free';
    const store = makeStore('free');
    await store.dispatch(loadVaults());

    expect(space).toBeNull();
    expect(store.getState().org.orgs).toEqual([]);
  });
});

describe('loadVaults — each failure keeps its own reason', () => {
  /** Give the account a space first, so the failure under test is the vault call's. */
  async function withSpace(tier = 'solo') {
    const store = makeStore(tier);
    await store.dispatch(ensurePersonalSpace());
    return store;
  }

  it('a request that got no answer is the ONLY one reported as a network failure', async () => {
    const store = await withSpace();
    listVaultsFailure = () => {
      throw networkError();
    };
    await store.dispatch(loadVaults());
    expect(store.getState().vaults.error).toBe('network_unavailable');
  });

  it('a 5xx is a server problem, not the user’s connection', async () => {
    const store = await withSpace();
    listVaultsFailure = () => {
      throw httpError(500);
    };
    await store.dispatch(loadVaults());
    expect(store.getState().vaults.error).toBe('server_error');
  });

  it('a 403 with no code reads as "no access", not as a hiccup', async () => {
    const store = await withSpace();
    listVaultsFailure = () => {
      throw httpError(403);
    };
    await store.dispatch(loadVaults());
    expect(store.getState().vaults.error).toBe('org_forbidden');
  });

  it('an expired session says so instead of blaming the network', async () => {
    const store = await withSpace();
    listVaultsFailure = () => {
      throw httpError(401);
    };
    await store.dispatch(loadVaults());
    expect(store.getState().vaults.error).toBe('session_expired');
  });

  it.each([
    ['upgrade_required', 403],
    ['org_forbidden', 403],
    ['org_enterprise_only', 403],
    ['org_read_only', 403],
    ['org_insufficient_role', 403],
    ['org_required', 400],
  ])('surfaces the Worker code %s verbatim', async (code, status) => {
    const store = await withSpace();
    listVaultsFailure = () => {
      throw httpError(status, code);
    };
    await store.dispatch(loadVaults());
    expect(store.getState().vaults.error).toBe(code);
  });

  it('a network failure during provisioning is reported as one', async () => {
    const store = makeStore('solo');
    vi.mocked(apiEnsurePersonalSpace).mockRejectedValueOnce(new Error('network_unavailable'));
    const result = await store.dispatch(loadVaults());

    expect(result.meta.requestStatus).toBe('rejected');
    expect(store.getState().vaults.error).toBe('network_unavailable');
  });
});
