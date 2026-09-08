import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateAndWrapKeypair,
  generateDetachedKeypair,
  unwrapPrivateKey,
  unwrapPrivateKeyUnderKey,
  wrapLoadedUnderKey,
  rewrapLoadedKeypair,
  wrapLoadedRecovery,
  clearUserKeypair,
  sealToPublicKey,
  openSealed,
  isKeyAlgoSupported,
  verifyKeypairIntegrity,
  type GeneratedKeypair,
} from './userKeypair';

/**
 * E2-11 — multi-member crypto integration suite (CI gate against silent data loss).
 *
 * End-to-end, REAL crypto (no mocks): members seal vault keys to each other's
 * public keys and unwrap them, across every rotation/unlock path the keypair
 * supports. A round-trip regression here = a shared vault that silently can't be
 * opened, so this file is a blocking gate. userKeypair holds ONE keypair in module
 * memory, so members are exercised by loading one at a time from their blobs.
 */

const hex = (u: Uint8Array) => Buffer.from(u).toString('hex');
const vaultKey = () => crypto.getRandomValues(new Uint8Array(32)); // a symmetric vault key

/** In-memory broker mirroring the worker's compare-and-set on user_keys. */
function makeBroker() {
  let row: GeneratedKeypair | null = null;
  const digest = async (r: GeneratedKeypair) => {
    const data = new TextEncoder().encode(
      r.encPublicKey + r.signPublicKey + r.wrappedPrivateKey + ''
    );
    return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
  };
  return {
    get: () => row,
    put: async (blob: GeneratedKeypair, expectedPreviousDigest: string) => {
      if (!row) {
        if (expectedPreviousDigest !== 'initial')
          return { success: false, code: 'user_key_conflict' };
        row = blob;
        return { success: true as const };
      }
      const cur = await digest(row);
      if (expectedPreviousDigest !== cur) {
        return { success: false, code: 'user_key_conflict', serverDigest: cur };
      }
      row = blob;
      return { success: true as const };
    },
  };
}

describe('E2-11 — multi-member crypto integration (CI gate)', () => {
  beforeEach(() => clearUserKeypair());

  it('Alice receives vault keys sealed by Bob and Carol, and unwraps both', async () => {
    const alice = await generateAndWrapKeypair('alice-pw');
    clearUserKeypair(); // Bob/Carol never hold Alice's private key

    const k1 = vaultKey(); // Bob's vault key
    const k2 = vaultKey(); // Carol's vault key
    // Bob and Carol seal to Alice's PUBLIC key only (no private key needed).
    const sealed1 = await sealToPublicKey(k1, alice.encPublicKey, alice.keyAlgo);
    const sealed2 = await sealToPublicKey(k2, alice.encPublicKey, alice.keyAlgo);

    await unwrapPrivateKey('alice-pw', alice, alice.keyAlgo);
    expect(hex(await openSealed(sealed1))).toBe(hex(k1));
    expect(hex(await openSealed(sealed2))).toBe(hex(k2));
  });

  it('a key sealed BEFORE a password change + phrase recovery still opens (stable identity)', async () => {
    const alice = await generateAndWrapKeypair('old-pw');
    const k = vaultKey();
    const sealed = await sealToPublicKey(k, alice.encPublicKey);
    const recovery = await wrapLoadedRecovery('correct horse battery staple');

    // Password change — identity (public key + fingerprint) MUST be stable.
    const afterPwChange = await rewrapLoadedKeypair('new-pw');
    expect(afterPwChange.encPublicKey).toBe(alice.encPublicKey);
    expect(afterPwChange.fingerprint).toBe(alice.fingerprint);
    clearUserKeypair();
    await unwrapPrivateKey('new-pw', afterPwChange, afterPwChange.keyAlgo);
    expect(hex(await openSealed(sealed))).toBe(hex(k)); // no access loss

    // Phrase recovery (forgot the password) — unwrap from the recovery wrap, reset.
    clearUserKeypair();
    await unwrapPrivateKey('correct horse battery staple', {
      wrappedPrivateKey: recovery.recoveryWrappedPrivateKey,
      kekSalt: recovery.recoverySalt,
    });
    const afterRecovery = await rewrapLoadedKeypair('reset-pw');
    expect(afterRecovery.encPublicKey).toBe(alice.encPublicKey); // identity survived recovery
    clearUserKeypair();
    await unwrapPrivateKey('reset-pw', afterRecovery, afterRecovery.keyAlgo);
    expect(hex(await openSealed(sealed))).toBe(hex(k)); // still no access loss
  });

  it('PRF unlock restores the real key; the decoy keypair is independent and cannot open real seals', async () => {
    const alice = await generateAndWrapKeypair('alice-pw');
    const k = vaultKey();
    const sealed = await sealToPublicKey(k, alice.encPublicKey);

    // Hardware-key (PRF) path: wrap under a PRF-style KEK, clear, unwrap via the KEK.
    const prfKek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    const hwBlob = await wrapLoadedUnderKey(prfKek);
    clearUserKeypair();
    await unwrapPrivateKeyUnderKey(prfKek, hwBlob, alice.keyAlgo);
    expect(hex(await openSealed(sealed))).toBe(hex(k)); // PRF restored the REAL key

    // Decoy: an INDEPENDENT identity that must NOT open Alice's seals (deniability).
    clearUserKeypair();
    const decoy = await generateDetachedKeypair('duress-pw');
    expect(decoy.encPublicKey).not.toBe(alice.encPublicKey);
    expect(decoy.fingerprint).not.toBe(alice.fingerprint);
    await unwrapPrivateKey('duress-pw', decoy, decoy.keyAlgo);
    await expect(openSealed(sealed)).rejects.toThrow(); // decoy can't open the real seal
  });

  it('refuses to seal/verify against an unsupported key_algo (lazy migration safety)', async () => {
    const alice = await generateAndWrapKeypair('alice-pw');
    expect(isKeyAlgoSupported(alice.keyAlgo)).toBe(true);
    // A key newer than this binary: refuse to wrap rather than use the wrong scheme.
    await expect(
      sealToPublicKey(vaultKey(), alice.encPublicKey, 'mlkem768-x25519')
    ).rejects.toThrow(/unsupported key algorithm/i);
    expect(await verifyKeypairIntegrity({ ...alice, keyAlgo: 'mlkem768-x25519' })).toBe(false);
  });

  it('two devices racing to seed the keypair: exactly one survives, the loser adopts it (no stomp)', async () => {
    const pwd = 'shared-pw';
    const a = await generateAndWrapKeypair(pwd);
    clearUserKeypair();
    const b = await generateAndWrapKeypair(pwd);
    clearUserKeypair();
    expect(a.encPublicKey).not.toBe(b.encPublicKey); // each device generated its own

    const broker = makeBroker();
    expect((await broker.put(a, 'initial')).success).toBe(true); // device A wins the race
    const bRes = await broker.put(b, 'initial'); // device B races with a stale 'initial'
    expect(bRes.success).toBe(false);
    expect(bRes.code).toBe('user_key_conflict');

    // The surviving keypair is A's; B adopts it (fetch + unwrap, shared password).
    const server = broker.get()!;
    expect(server.encPublicKey).toBe(a.encPublicKey);
    await unwrapPrivateKey(pwd, server, server.keyAlgo);
    const k = vaultKey();
    const sealed = await sealToPublicKey(k, a.encPublicKey);
    expect(hex(await openSealed(sealed))).toBe(hex(k)); // a key wrapped to the survivor opens
  });

  it('escrow round-trip: a vault key sealed to the org escrow key reconstitutes identically', async () => {
    const escrow = await generateAndWrapKeypair('org-escrow-pw'); // org escrow keypair (E4)
    clearUserKeypair();
    const k = vaultKey();
    const sealedToEscrow = await sealToPublicKey(k, escrow.encPublicKey);

    await unwrapPrivateKey('org-escrow-pw', escrow, escrow.keyAlgo);
    expect(hex(await openSealed(sealedToEscrow))).toBe(hex(k)); // escrow integrity
  });
});
