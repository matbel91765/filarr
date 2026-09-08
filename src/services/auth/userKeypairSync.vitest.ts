import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the pure crypto so we test only the orchestration (no real keys).
const KP = {
  encPublicKey: 'E',
  signPublicKey: 'SG',
  encPublicKeySig: 'SIG',
  wrappedPrivateKey: 'W',
  kekSalt: 'S',
  keyAlgo: 'x25519-ed25519',
  keyVersion: 1,
  fingerprint: 'F',
};

vi.mock('./userKeypair', () => ({
  generateAndWrapKeypair: vi.fn(async () => ({ ...KP })),
  unwrapPrivateKey: vi.fn(async () => {}),
  rewrapLoadedKeypair: vi.fn(async () => ({ ...KP, wrappedPrivateKey: 'W2', kekSalt: 'S2' })),
  wrapLoadedRecovery: vi.fn(async () => ({ recoveryWrappedPrivateKey: 'RW', recoverySalt: 'RS' })),
  // Real impl — pure string transform exercised by the orchestration.
  normalizeRecoveryPhrase: (p: string) => p.toLowerCase().trim(),
  // Controllable per test (keypair loaded in memory by default).
  hasUserKeypair: vi.fn(() => true),
  // Fetched-blob integrity check (E2-7) — pass by default; orchestration only warns.
  verifyKeypairIntegrity: vi.fn(async () => true),
  // Alternate unlock paths (E2-9).
  wrapLoadedUnderKey: vi.fn(async () => 'HW_WRAPPED'),
  unwrapPrivateKeyUnderKey: vi.fn(async () => {}),
  generateDetachedKeypair: vi.fn(async () => ({
    ...KP,
    wrappedPrivateKey: 'DECOY_W',
    fingerprint: 'DECOY_FP',
  })),
  clearUserKeypair: vi.fn(),
}));

import {
  generateAndWrapKeypair,
  unwrapPrivateKey,
  rewrapLoadedKeypair,
  wrapLoadedRecovery,
  hasUserKeypair,
  wrapLoadedUnderKey,
  unwrapPrivateKeyUnderKey,
  generateDetachedKeypair,
  clearUserKeypair,
} from './userKeypair';
import {
  initUserKeypair,
  rewrapKeypairForPasswordChange,
  buildRecoveredKeypair,
  attachRecoveryWrap,
  recoverKeypairFromLocalPhrase,
  rotateKeypairRecoveryWrap,
  ensureUserKeypair,
  wrapKeypairUnderHardwareKey,
  unwrapKeypairFromHardwareKey,
  generateDetachedKeypairBlob,
  clearUserKeypairMemory,
  stripKeypairHardwareWrap,
} from './userKeypairSync';

const STORED = {
  encPublicKey: 'E',
  signPublicKey: 'SG',
  encPublicKeySig: 'SIG',
  wrappedPrivateKey: 'W',
  kekSalt: 'S',
  keyAlgo: 'x25519-ed25519',
  keyVersion: 1,
  fingerprint: 'F',
};

let invoke: ReturnType<typeof vi.fn>;

/** Route IPC channels to canned responses. */
function setIpc(responses: Record<string, unknown>) {
  invoke = vi.fn(async (channel: string) =>
    channel in responses ? responses[channel] : undefined
  );
  (globalThis as any).window = { electron: { ipcRenderer: { invoke } } };
}

const pushCalls = () => invoke.mock.calls.filter((c) => c[0] === 'keypair:pushToCloud');

describe('initUserKeypair (E2-4)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('first time (no local, no cloud) → generates, saves, pushes with initial', async () => {
    setIpc({ 'keypair:loadLocal': null, 'keypair:fetchFromCloud': null });
    await initUserKeypair('pw');

    expect(generateAndWrapKeypair).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith('keypair:saveLocal', expect.any(Object));
    const push = pushCalls();
    expect(push).toHaveLength(1);
    expect((push[0][1] as any).expectedPreviousDigest).toBe('initial');
    expect(unwrapPrivateKey).not.toHaveBeenCalled();
  });

  it('first-time push 409 (concurrent device) → adopts the server keypair, no stomp', async () => {
    // loadLocal: null; first fetch (pre-push): null → first-time path; push: 409;
    // adopt re-fetch: the winner's keypair.
    let fetchCount = 0;
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'keypair:loadLocal') return null;
      if (channel === 'keypair:pushToCloud') return { success: false, code: 'user_key_conflict' };
      if (channel === 'keypair:fetchFromCloud') {
        fetchCount += 1;
        return fetchCount === 1 ? null : STORED;
      }
      return undefined;
    });
    (globalThis as any).window = { electron: { ipcRenderer: { invoke } } };

    await initUserKeypair('pw');

    expect(generateAndWrapKeypair).toHaveBeenCalledOnce(); // generated...
    expect(unwrapPrivateKey).toHaveBeenCalledWith('pw', STORED); // ...but adopted the server's
  });

  it('new device (no local, cloud has it) → fetches, caches, unwraps, no regen', async () => {
    setIpc({ 'keypair:loadLocal': null, 'keypair:fetchFromCloud': STORED });
    await initUserKeypair('pw');

    expect(generateAndWrapKeypair).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith('keypair:saveLocal', STORED); // cached locally
    expect(unwrapPrivateKey).toHaveBeenCalledWith('pw', STORED);
  });

  it('local present + server already has it → unwrap, no push (no stomp)', async () => {
    setIpc({ 'keypair:loadLocal': STORED, 'keypair:fetchFromCloud': STORED });
    await initUserKeypair('pw');

    expect(unwrapPrivateKey).toHaveBeenCalledWith('pw', STORED);
    expect(generateAndWrapKeypair).not.toHaveBeenCalled();
    expect(pushCalls()).toHaveLength(0);
  });

  it('local present + server missing → unwrap + backfill push initial', async () => {
    setIpc({ 'keypair:loadLocal': STORED, 'keypair:fetchFromCloud': null });
    await initUserKeypair('pw');

    expect(unwrapPrivateKey).toHaveBeenCalledWith('pw', STORED);
    const push = pushCalls();
    expect(push).toHaveLength(1);
    expect((push[0][1] as any).expectedPreviousDigest).toBe('initial');
  });

  it('local has recovery wrap + server lacks it (same identity) → reconciles on launch', async () => {
    // Self-heal for a transient recovery-wrap publish miss: server holds the same
    // keypair without the recovery copy; backfill re-pushes our recovery-bearing blob.
    setIpc({ 'keypair:loadLocal': STORED_REC, 'keypair:fetchFromCloud': STORED });
    await initUserKeypair('pw');

    expect(unwrapPrivateKey).toHaveBeenCalledWith('pw', STORED_REC);
    const push = pushCalls();
    expect(push).toHaveLength(1);
    expect((push[0][1] as any).recoveryWrappedPrivateKey).toBe('OLD_RW');
    // pushed against the server's current (recovery-less) digest, not 'initial'
    expect((push[0][1] as any).expectedPreviousDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('no Electron IPC (window without electron) → no-op', async () => {
    (globalThis as any).window = {}; // renderer always has window; just no Electron bridge
    await expect(initUserKeypair('pw')).resolves.toBeUndefined();
    expect(generateAndWrapKeypair).not.toHaveBeenCalled();
  });
});

describe('rewrapKeypairForPasswordChange (E2-5)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('re-wraps under the new password, pushes with the current digest, saves', async () => {
    setIpc({ 'keypair:loadLocal': STORED });
    await rewrapKeypairForPasswordChange('new-pw');

    expect(rewrapLoadedKeypair).toHaveBeenCalledWith('new-pw');
    const push = pushCalls();
    expect(push).toHaveLength(1);
    // compare-and-set against the real SHA-256 digest of the current blob (64 hex)
    expect((push[0][1] as any).expectedPreviousDigest).toMatch(/^[0-9a-f]{64}$/);
    // carries the (unchanged) recovery wrap forward, saves the new blob locally
    expect(invoke).toHaveBeenCalledWith(
      'keypair:saveLocal',
      expect.objectContaining({ wrappedPrivateKey: 'W2' })
    );
  });

  it('no-op when there is no local keypair', async () => {
    setIpc({ 'keypair:loadLocal': null });
    await rewrapKeypairForPasswordChange('new-pw');
    expect(rewrapLoadedKeypair).not.toHaveBeenCalled();
  });

  it('carries the hardware-key wrap locally (E2-9) but strips it from the cloud push', async () => {
    const hwBlob = {
      ...STORED,
      hwWrappedPrivateKey: 'HW_W',
      hwSalt: 'HW_S',
      hwCredentialId: 'cred-1',
    };
    setIpc({ 'keypair:loadLocal': hwBlob });
    await rewrapKeypairForPasswordChange('new-pw');

    // PRF-derived hw wrap is password-independent → carried over locally.
    expect(invoke).toHaveBeenCalledWith(
      'keypair:saveLocal',
      expect.objectContaining({ hwWrappedPrivateKey: 'HW_W', hwCredentialId: 'cred-1' })
    );
    // ...but LOCAL-ONLY, so never transmitted to the broker.
    const push = pushCalls();
    expect(push).toHaveLength(1);
    expect((push[0][1] as any).hwWrappedPrivateKey).toBeUndefined();
    expect((push[0][1] as any).hwSalt).toBeUndefined();
    expect((push[0][1] as any).hwCredentialId).toBeUndefined();
  });
});

const STORED_REC = { ...STORED, recoveryWrappedPrivateKey: 'OLD_RW', recoverySalt: 'OLD_RS' };

describe('buildRecoveredKeypair (E2-5 cloud recovery crypto)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when the server has no recovery-wrapped keypair', async () => {
    expect(await buildRecoveredKeypair('phrase', 'new-pw', null)).toBeNull();
    expect(await buildRecoveredKeypair('phrase', 'new-pw', {})).toBeNull();
    expect(unwrapPrivateKey).not.toHaveBeenCalled();
  });

  it('unwraps with the phrase, re-wraps under the new password, rotates recovery', async () => {
    const out = await buildRecoveredKeypair('phrase', 'new-pw', {
      recoveryWrappedPrivateKey: 'OLD_RW',
      recoverySalt: 'OLD_RS',
    });
    // unwrap uses the RECOVERY blob (not the password blob)
    expect(unwrapPrivateKey).toHaveBeenCalledWith('phrase', {
      wrappedPrivateKey: 'OLD_RW',
      kekSalt: 'OLD_RS',
    });
    expect(rewrapLoadedKeypair).toHaveBeenCalledWith('new-pw');
    expect(wrapLoadedRecovery).toHaveBeenCalledWith('phrase');
    // new password-wrap + freshly rotated recovery wrap, stable identity
    expect(out).toMatchObject({
      wrappedPrivateKey: 'W2',
      kekSalt: 'S2',
      recoveryWrappedPrivateKey: 'RW',
      recoverySalt: 'RS',
    });
  });
});

describe('attachRecoveryWrap (E2-5 — recovery wrap at phrase setup)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('wraps the loaded keypair under the phrase, pushes (compare-and-set), saves', async () => {
    setIpc({ 'keypair:loadLocal': STORED });
    await attachRecoveryWrap('phrase');

    expect(wrapLoadedRecovery).toHaveBeenCalledWith('phrase');
    const push = pushCalls();
    expect(push).toHaveLength(1);
    expect((push[0][1] as any).expectedPreviousDigest).toMatch(/^[0-9a-f]{64}$/);
    expect((push[0][1] as any).recoveryWrappedPrivateKey).toBe('RW');
    expect(invoke).toHaveBeenCalledWith(
      'keypair:saveLocal',
      expect.objectContaining({ recoveryWrappedPrivateKey: 'RW', recoverySalt: 'RS' })
    );
  });

  it('no-op when no local keypair (generation skipped/failed)', async () => {
    setIpc({ 'keypair:loadLocal': null });
    await attachRecoveryWrap('phrase');
    expect(wrapLoadedRecovery).not.toHaveBeenCalled();
    expect(pushCalls()).toHaveLength(0);
  });

  it('idempotent: no-op when the keypair already has a recovery wrap', async () => {
    setIpc({ 'keypair:loadLocal': STORED_REC });
    await attachRecoveryWrap('phrase');
    expect(wrapLoadedRecovery).not.toHaveBeenCalled();
    expect(pushCalls()).toHaveLength(0);
  });

  it('persists the recovery wrap locally even when the cloud push fails (local-only onboarding)', async () => {
    // In local-mode onboarding there is no authenticated account, so the push
    // returns { success: false, 'Not authenticated' }. The wrap MUST still be
    // saved locally (regression guard for the push-then-save data-loss bug).
    setIpc({
      'keypair:loadLocal': STORED,
      'keypair:pushToCloud': { success: false, error: 'Not authenticated' },
    });
    await attachRecoveryWrap('phrase');
    expect(invoke).toHaveBeenCalledWith(
      'keypair:saveLocal',
      expect.objectContaining({ recoveryWrappedPrivateKey: 'RW', recoverySalt: 'RS' })
    );
  });

  it('keeps the local recovery wrap on a genuine cloud 409 conflict', async () => {
    setIpc({
      'keypair:loadLocal': STORED,
      'keypair:pushToCloud': { success: false, code: 'user_key_conflict' },
    });
    await attachRecoveryWrap('phrase');
    expect(invoke).toHaveBeenCalledWith(
      'keypair:saveLocal',
      expect.objectContaining({ recoveryWrappedPrivateKey: 'RW' })
    );
  });
});

describe('recoverKeypairFromLocalPhrase (E2-5 — local-device recovery path)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('re-wraps the local keypair under the new password and publishes it', async () => {
    setIpc({ 'keypair:loadLocal': STORED_REC });
    await recoverKeypairFromLocalPhrase('phrase', 'new-pw');

    expect(unwrapPrivateKey).toHaveBeenCalledWith('phrase', {
      wrappedPrivateKey: 'OLD_RW',
      kekSalt: 'OLD_RS',
    });
    expect(rewrapLoadedKeypair).toHaveBeenCalledWith('new-pw');
    const push = pushCalls();
    expect(push).toHaveLength(1);
    expect((push[0][1] as any).expectedPreviousDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(invoke).toHaveBeenCalledWith(
      'keypair:saveLocal',
      expect.objectContaining({ wrappedPrivateKey: 'W2', recoveryWrappedPrivateKey: 'RW' })
    );
  });

  it('no-op when the local keypair has no recovery wrap', async () => {
    setIpc({ 'keypair:loadLocal': STORED });
    await recoverKeypairFromLocalPhrase('phrase', 'new-pw');
    expect(rewrapLoadedKeypair).not.toHaveBeenCalled();
    expect(pushCalls()).toHaveLength(0);
  });

  it('persists the re-wrap locally even when the cloud push fails', async () => {
    setIpc({
      'keypair:loadLocal': STORED_REC,
      'keypair:pushToCloud': { success: false, error: 'Not authenticated' },
    });
    await recoverKeypairFromLocalPhrase('phrase', 'new-pw');
    expect(invoke).toHaveBeenCalledWith(
      'keypair:saveLocal',
      expect.objectContaining({ wrappedPrivateKey: 'W2' })
    );
  });
});

describe('rotateKeypairRecoveryWrap (E2-5 — force re-wrap under a new phrase)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasUserKeypair).mockReturnValue(true); // keys in memory unless a test says otherwise
  });

  it('overwrites an EXISTING recovery wrap (phrase rotation, not idempotent)', async () => {
    setIpc({ 'keypair:loadLocal': STORED_REC }); // already has OLD_RW/OLD_RS
    await rotateKeypairRecoveryWrap('new-phrase');
    expect(wrapLoadedRecovery).toHaveBeenCalledWith('new-phrase');
    expect(invoke).toHaveBeenCalledWith(
      'keypair:saveLocal',
      expect.objectContaining({ recoveryWrappedPrivateKey: 'RW', recoverySalt: 'RS' })
    );
    const push = pushCalls();
    expect(push).toHaveLength(1);
    expect((push[0][1] as any).expectedPreviousDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('persists locally even when the cloud push fails (no-auth / network)', async () => {
    setIpc({
      'keypair:loadLocal': STORED,
      'keypair:pushToCloud': { success: false, error: 'Not authenticated' },
    });
    await rotateKeypairRecoveryWrap('new-phrase');
    expect(invoke).toHaveBeenCalledWith(
      'keypair:saveLocal',
      expect.objectContaining({ recoveryWrappedPrivateKey: 'RW' })
    );
  });

  it('no-op when there is no local keypair', async () => {
    setIpc({ 'keypair:loadLocal': null });
    await rotateKeypairRecoveryWrap('new-phrase');
    expect(wrapLoadedRecovery).not.toHaveBeenCalled();
    expect(pushCalls()).toHaveLength(0);
  });

  it('re-seeds with "initial" when a 409 is really an empty server row (transient onboarding push)', async () => {
    // pushToCloud → 409; fetchFromCloud → null (server has no row) ⇒ retry 'initial'.
    setIpc({
      'keypair:loadLocal': STORED_REC,
      'keypair:pushToCloud': { success: false, code: 'user_key_conflict' },
      // 'keypair:fetchFromCloud' omitted → resolves undefined → treated as empty
    });
    await rotateKeypairRecoveryWrap('new-phrase');
    const push = pushCalls();
    expect(push).toHaveLength(2);
    expect((push[1][1] as any).expectedPreviousDigest).toBe('initial');
  });

  it('keeps local on a real 409 (server holds a DIFFERENT keypair) — no re-seed', async () => {
    setIpc({
      'keypair:loadLocal': STORED_REC,
      'keypair:pushToCloud': { success: false, code: 'user_key_conflict' },
      'keypair:fetchFromCloud': STORED, // server has a (different) row
    });
    await rotateKeypairRecoveryWrap('new-phrase');
    expect(pushCalls()).toHaveLength(1); // no 'initial' re-seed
  });

  it('loads the keypair with the password when not in memory (restart-only session)', async () => {
    vi.mocked(hasUserKeypair).mockReturnValue(false);
    setIpc({ 'keypair:loadLocal': STORED });
    await rotateKeypairRecoveryWrap('new-phrase', 'account-pw');
    // unlocked the on-disk keypair before wrapping, so the recovery wrap rotates
    // in lockstep with the FEK's instead of throwing.
    expect(unwrapPrivateKey).toHaveBeenCalledWith('account-pw', STORED);
    expect(wrapLoadedRecovery).toHaveBeenCalled();
  });
});

describe('ensureUserKeypair (E2-6 — lazy keypair for existing accounts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasUserKeypair).mockReturnValue(false); // not loaded in memory by default
  });

  it('no-op when the keypair is already loaded in memory', async () => {
    vi.mocked(hasUserKeypair).mockReturnValue(true);
    setIpc({});
    expect(await ensureUserKeypair('pw')).toEqual({ ok: true });
    expect(generateAndWrapKeypair).not.toHaveBeenCalled();
    expect(unwrapPrivateKey).not.toHaveBeenCalled();
  });

  it('generates + publishes "initial" when none exists anywhere', async () => {
    setIpc({ 'keypair:loadLocal': null, 'keypair:fetchFromCloud': null });
    expect(await ensureUserKeypair('pw')).toEqual({ ok: true });
    expect(generateAndWrapKeypair).toHaveBeenCalledOnce();
    const push = pushCalls();
    expect(push).toHaveLength(1);
    expect((push[0][1] as any).expectedPreviousDigest).toBe('initial');
  });

  it('adopts the server keypair on a 409 race (never two keypairs)', async () => {
    let fetchCount = 0;
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'keypair:loadLocal') return null;
      if (channel === 'keypair:pushToCloud') return { success: false, code: 'user_key_conflict' };
      if (channel === 'keypair:fetchFromCloud') {
        fetchCount += 1;
        return fetchCount === 1 ? null : STORED;
      }
      return undefined;
    });
    (globalThis as any).window = { electron: { ipcRenderer: { invoke } } };

    expect(await ensureUserKeypair('pw')).toEqual({ ok: true });
    expect(generateAndWrapKeypair).toHaveBeenCalledOnce(); // generated...
    expect(unwrapPrivateKey).toHaveBeenCalledWith('pw', STORED); // ...but adopted the server's
  });

  it('existing cloud keypair → caches locally + unwraps, never regenerates', async () => {
    setIpc({ 'keypair:loadLocal': null, 'keypair:fetchFromCloud': STORED });
    expect(await ensureUserKeypair('pw')).toEqual({ ok: true });
    expect(generateAndWrapKeypair).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith('keypair:saveLocal', STORED);
    expect(unwrapPrivateKey).toHaveBeenCalledWith('pw', STORED);
  });

  it('needsUnlock when a keypair exists but no password is supplied', async () => {
    setIpc({ 'keypair:loadLocal': STORED });
    expect(await ensureUserKeypair()).toEqual({ ok: false, needsUnlock: true });
    expect(unwrapPrivateKey).not.toHaveBeenCalled();
  });

  it('needsUnlock when none exists and no password is supplied', async () => {
    setIpc({ 'keypair:loadLocal': null, 'keypair:fetchFromCloud': null });
    expect(await ensureUserKeypair()).toEqual({ ok: false, needsUnlock: true });
    expect(generateAndWrapKeypair).not.toHaveBeenCalled();
  });
});

describe('E2-9 — hardware-key (PRF) + decoy keypair paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasUserKeypair).mockReturnValue(true); // unlocked when enrolling
  });

  it('wrapKeypairUnderHardwareKey persists the hw wrap LOCAL-ONLY (never pushed)', async () => {
    setIpc({ 'keypair:loadLocal': STORED });
    const fakeKek = {} as CryptoKey;
    await wrapKeypairUnderHardwareKey(fakeKek, 'HW_SALT', 'cred-1');

    expect(wrapLoadedUnderKey).toHaveBeenCalledWith(fakeKek);
    expect(invoke).toHaveBeenCalledWith(
      'keypair:saveLocal',
      expect.objectContaining({
        hwWrappedPrivateKey: 'HW_WRAPPED',
        hwSalt: 'HW_SALT',
        hwCredentialId: 'cred-1',
      })
    );
    expect(pushCalls()).toHaveLength(0); // local-only, never pushed
  });

  it('wrapKeypairUnderHardwareKey is a no-op when the keypair is not loaded', async () => {
    vi.mocked(hasUserKeypair).mockReturnValue(false);
    setIpc({ 'keypair:loadLocal': STORED });
    await wrapKeypairUnderHardwareKey({} as CryptoKey, 'S', 'c');
    expect(wrapLoadedUnderKey).not.toHaveBeenCalled();
  });

  it('unwrapKeypairFromHardwareKey loads via the PRF KEK when hardware-wrapped', async () => {
    setIpc({
      'keypair:loadLocal': {
        ...STORED,
        hwWrappedPrivateKey: 'HW_W',
        hwSalt: 'S',
        hwCredentialId: 'c',
      },
    });
    const fakeKek = {} as CryptoKey;
    await unwrapKeypairFromHardwareKey(fakeKek);
    expect(unwrapPrivateKeyUnderKey).toHaveBeenCalledWith(fakeKek, 'HW_W');
  });

  it('unwrapKeypairFromHardwareKey is a no-op without a hardware wrap', async () => {
    setIpc({ 'keypair:loadLocal': STORED });
    await unwrapKeypairFromHardwareKey({} as CryptoKey);
    expect(unwrapPrivateKeyUnderKey).not.toHaveBeenCalled();
  });

  it('generateDetachedKeypairBlob returns an INDEPENDENT decoy blob', async () => {
    setIpc({});
    const blob = await generateDetachedKeypairBlob('duress-pw');
    expect(generateDetachedKeypair).toHaveBeenCalledWith('duress-pw');
    expect(blob.wrappedPrivateKey).toBe('DECOY_W'); // not the real keypair
  });

  it('clearUserKeypairMemory drops the real private keys (duress-unlock safety)', () => {
    clearUserKeypairMemory();
    expect(clearUserKeypair).toHaveBeenCalledOnce();
  });

  it('stripKeypairHardwareWrap removes the hw fields locally (mirror of removeHardwareKey)', async () => {
    setIpc({
      'keypair:loadLocal': {
        ...STORED,
        hwWrappedPrivateKey: 'HW_W',
        hwSalt: 'S',
        hwCredentialId: 'c',
      },
    });
    await stripKeypairHardwareWrap();
    const saved = invoke.mock.calls.find((c) => c[0] === 'keypair:saveLocal');
    expect(saved).toBeTruthy();
    expect((saved![1] as any).hwWrappedPrivateKey).toBeUndefined();
    expect((saved![1] as any).hwSalt).toBeUndefined();
    expect((saved![1] as any).hwCredentialId).toBeUndefined();
    // identity preserved
    expect((saved![1] as any).encPublicKey).toBe('E');
  });

  it('stripKeypairHardwareWrap is a no-op when there is no hw wrap', async () => {
    setIpc({ 'keypair:loadLocal': STORED });
    await stripKeypairHardwareWrap();
    expect(invoke).not.toHaveBeenCalledWith('keypair:saveLocal', expect.anything());
  });
});
