import { describe, it, expect, beforeEach } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  generateAndWrapKeypair,
  unwrapPrivateKey,
  computeFingerprint,
  getEncryptionPrivateKey,
  getSigningPrivateKey,
  clearUserKeypair,
  rewrapLoadedKeypair,
  wrapLoadedRecovery,
  normalizeRecoveryPhrase,
  verifyKeypairIntegrity,
  wrapLoadedUnderKey,
  unwrapPrivateKeyUnderKey,
  generateDetachedKeypair,
  hasUserKeypair,
  isKeyAlgoSupported,
} from './userKeypair';

const b64 = (s: string) => Uint8Array.from(Buffer.from(s, 'base64'));
const hex = (u: Uint8Array | null) => Buffer.from(u!).toString('hex');
// IV(12) + ciphertext(64-byte plaintext + 16-byte GCM tag) = 92
const IV_PLUS_WRAPPED = 12 + 64 + 16;

describe('userKeypair (E2-2)', () => {
  beforeEach(() => clearUserKeypair());

  it('wrap → unwrap round-trip recovers both private keys', async () => {
    const kp = await generateAndWrapKeypair('correct horse battery staple');
    const encBefore = hex(getEncryptionPrivateKey());
    const signBefore = hex(getSigningPrivateKey());

    clearUserKeypair();
    await unwrapPrivateKey('correct horse battery staple', kp);

    expect(hex(getEncryptionPrivateKey())).toBe(encBefore);
    expect(hex(getSigningPrivateKey())).toBe(signBefore);

    // The recovered signing key produces a signature the published pubkey verifies.
    const msg = new Uint8Array([9, 9, 9]);
    const sig = ed25519.sign(msg, getSigningPrivateKey()!);
    expect(ed25519.verify(sig, msg, b64(kp.signPublicKey))).toBe(true);
  });

  it('wrappedPrivateKey is base64(IV(12)||ciphertext), opaque, not the raw key', async () => {
    const kp = await generateAndWrapKeypair('pw');
    const blob = b64(kp.wrappedPrivateKey);
    // IV(12) + AES-GCM(64 bytes plaintext + 16 tag) = 12 + 80 = 92 bytes
    expect(blob.length).toBe(IV_PLUS_WRAPPED);
    expect(kp.keyAlgo).toBe('x25519-ed25519');
    expect(kp.keyVersion).toBe(1);
  });

  it('fingerprint is a deterministic Signal-style safety number', async () => {
    const pk = new Uint8Array(32).fill(7);
    const f1 = await computeFingerprint(pk);
    const f2 = await computeFingerprint(pk);
    expect(f1).toBe(f2);
    expect(f1).toMatch(/^\d{5}( \d{5}){5}$/); // 6 groups of 5 decimal digits
    // different key → different fingerprint
    const other = await computeFingerprint(new Uint8Array(32).fill(8));
    expect(other).not.toBe(f1);
  });

  it('verifyKeypairIntegrity accepts a genuine keypair and rejects tampering', async () => {
    const kp = await generateAndWrapKeypair('pw');
    expect(await verifyKeypairIntegrity(kp)).toBe(true);

    // Tampered fingerprint → rejected (consistency check, criterion 2).
    expect(
      await verifyKeypairIntegrity({ ...kp, fingerprint: '00000 00000 00000 00000 00000 00000' })
    ).toBe(false);

    // Swapped encryption key → the enc↔identity binding signature no longer verifies.
    const other = await generateAndWrapKeypair('pw2');
    expect(await verifyKeypairIntegrity({ ...kp, encPublicKey: other.encPublicKey })).toBe(false);

    // No binding sig but a consistent fingerprint → still accepted (sig optional).
    expect(
      await verifyKeypairIntegrity({
        encPublicKey: kp.encPublicKey,
        signPublicKey: kp.signPublicKey,
        fingerprint: kp.fingerprint,
      })
    ).toBe(true);
  });

  it('unwrap with the wrong password fails (AES-GCM tag mismatch)', async () => {
    const kp = await generateAndWrapKeypair('right-password');
    await expect(unwrapPrivateKey('wrong-password', kp)).rejects.toThrow();
  });

  it('enc_public_key_sig is a valid Ed25519 signature under the identity key', async () => {
    const kp = await generateAndWrapKeypair('pw');
    expect(
      ed25519.verify(b64(kp.encPublicKeySig), b64(kp.encPublicKey), b64(kp.signPublicKey))
    ).toBe(true);
    // a tampered encryption key breaks the binding
    const tampered = b64(kp.encPublicKey);
    tampered[0] ^= 0xff;
    expect(ed25519.verify(b64(kp.encPublicKeySig), tampered, b64(kp.signPublicKey))).toBe(false);
  });

  it('two generations produce distinct keypairs', async () => {
    const a = await generateAndWrapKeypair('pw');
    const b = await generateAndWrapKeypair('pw');
    expect(a.encPublicKey).not.toBe(b.encPublicKey);
    expect(a.signPublicKey).not.toBe(b.signPublicKey);
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });
});

describe('re-wrap / recovery wrap (E2-5)', () => {
  beforeEach(() => clearUserKeypair());

  it('rewrapLoadedKeypair: identity stable, unwraps with the NEW password only', async () => {
    const orig = await generateAndWrapKeypair('old-pw');
    const encBefore = hex(getEncryptionPrivateKey());

    const rew = await rewrapLoadedKeypair('new-pw');
    // Public identity is unchanged (deterministic from the same private keys).
    expect(rew.encPublicKey).toBe(orig.encPublicKey);
    expect(rew.signPublicKey).toBe(orig.signPublicKey);
    expect(rew.fingerprint).toBe(orig.fingerprint);
    expect(rew.encPublicKeySig).toBe(orig.encPublicKeySig); // Ed25519 is deterministic
    // The wrapped blob is fresh (new salt/IV).
    expect(rew.wrappedPrivateKey).not.toBe(orig.wrappedPrivateKey);

    // Unwraps with the new password to the SAME private keys...
    clearUserKeypair();
    await unwrapPrivateKey('new-pw', rew);
    expect(hex(getEncryptionPrivateKey())).toBe(encBefore);

    // ...and NOT with the old password.
    clearUserKeypair();
    await expect(unwrapPrivateKey('old-pw', rew)).rejects.toThrow();
  });

  it('wrapLoadedRecovery: round-trips under the recovery phrase', async () => {
    await generateAndWrapKeypair('pw');
    const signBefore = hex(getSigningPrivateKey());

    const rec = await wrapLoadedRecovery('correct horse recovery phrase');
    clearUserKeypair();
    await unwrapPrivateKey('correct horse recovery phrase', {
      wrappedPrivateKey: rec.recoveryWrappedPrivateKey,
      kekSalt: rec.recoverySalt,
    });
    expect(hex(getSigningPrivateKey())).toBe(signBefore);
  });

  it('rewrapLoadedKeypair throws when no keypair is loaded', async () => {
    await expect(rewrapLoadedKeypair('pw')).rejects.toThrow();
  });

  it('wrapLoadedUnderKey/unwrapPrivateKeyUnderKey round-trips under an arbitrary KEK (PRF path)', async () => {
    await generateAndWrapKeypair('pw');
    const before = hex(getSigningPrivateKey());
    const kek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);

    const blob = await wrapLoadedUnderKey(kek);
    clearUserKeypair();
    await unwrapPrivateKeyUnderKey(kek, blob);
    expect(hex(getSigningPrivateKey())).toBe(before);

    // A different KEK fails (GCM tag mismatch).
    clearUserKeypair();
    const other = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    await expect(unwrapPrivateKeyUnderKey(other, blob)).rejects.toThrow();
  });

  it('generateDetachedKeypair makes a valid INDEPENDENT keypair WITHOUT touching module memory', async () => {
    clearUserKeypair();
    expect(hasUserKeypair()).toBe(false);

    const decoy = await generateDetachedKeypair('decoy-pw');
    // The module's (real) keypair memory is untouched by detached generation.
    expect(hasUserKeypair()).toBe(false);
    // Self-consistent blob (fingerprint + binding sig).
    expect(await verifyKeypairIntegrity(decoy)).toBe(true);

    // It unwraps under its OWN password — an independent identity.
    await unwrapPrivateKey('decoy-pw', decoy);
    expect(hasUserKeypair()).toBe(true);
  });

  it('normalizeRecoveryPhrase lowercases + trims (matches the server)', () => {
    expect(normalizeRecoveryPhrase('  AbC DeF  ')).toBe('abc def');
    expect(normalizeRecoveryPhrase('already lower')).toBe('already lower');
  });

  it('recovery wrap is case/whitespace tolerant (no "verified but cannot decrypt" trap)', async () => {
    await generateAndWrapKeypair('pw');
    const signBefore = hex(getSigningPrivateKey());

    // Wrap with a mixed-case, padded rendering of the phrase.
    const rec = await wrapLoadedRecovery('  Correct Horse Battery  ');

    // Unwrap with the normalized phrase succeeds — wrap normalized identically.
    clearUserKeypair();
    await unwrapPrivateKey(normalizeRecoveryPhrase('CORRECT horse battery'), {
      wrappedPrivateKey: rec.recoveryWrappedPrivateKey,
      kekSalt: rec.recoverySalt,
    });
    expect(hex(getSigningPrivateKey())).toBe(signBefore);

    // The RAW mixed-case phrase does NOT unwrap — the wrap is keyed on the
    // normalized form, so recovery callers MUST normalize before deriving the KEK.
    clearUserKeypair();
    await expect(
      unwrapPrivateKey('CORRECT horse battery', {
        wrappedPrivateKey: rec.recoveryWrappedPrivateKey,
        kekSalt: rec.recoverySalt,
      })
    ).rejects.toThrow();
  });
});

describe('algo-agility registry (E2-10)', () => {
  beforeEach(() => clearUserKeypair());

  it('isKeyAlgoSupported reflects the registry', () => {
    expect(isKeyAlgoSupported('x25519-ed25519')).toBe(true);
    expect(isKeyAlgoSupported('mlkem768-x25519')).toBe(false); // reserved, not implemented
    expect(isKeyAlgoSupported('p256')).toBe(false);
  });

  it('generated keypairs carry the current algo + version', async () => {
    const kp = await generateAndWrapKeypair('pw');
    expect(kp.keyAlgo).toBe('x25519-ed25519');
    expect(kp.keyVersion).toBe(1);
  });

  it('verifyKeypairIntegrity refuses an unsupported key_algo (no silent wrap to an unknown scheme)', async () => {
    const kp = await generateAndWrapKeypair('pw');
    // Genuine, self-consistent blob but tagged with an algo this build doesn't know.
    expect(await verifyKeypairIntegrity({ ...kp, keyAlgo: 'mlkem768-x25519' })).toBe(false);
    // ...accepted under the known algo (and when no algo is given → defaults).
    expect(await verifyKeypairIntegrity({ ...kp, keyAlgo: 'x25519-ed25519' })).toBe(true);
    expect(await verifyKeypairIntegrity(kp)).toBe(true);
  });

  it('unwrapPrivateKey dispatches on key_algo and rejects an unsupported one cleanly', async () => {
    const kp = await generateAndWrapKeypair('pw');
    const before = hex(getSigningPrivateKey());

    clearUserKeypair();
    await unwrapPrivateKey('pw', kp, kp.keyAlgo); // explicit algo dispatch round-trips
    expect(hex(getSigningPrivateKey())).toBe(before);

    clearUserKeypair();
    await expect(unwrapPrivateKey('pw', kp, 'mlkem768-x25519')).rejects.toThrow(
      /unsupported key algorithm/i
    );
  });
});
