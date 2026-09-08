import { describe, it, expect, afterEach } from 'vitest';
import {
  unlockVault,
  getVaultKey,
  isVaultUnlocked,
  lockVault,
  clearVaultKeys,
} from './vaultKeyCache';
import { generateVaultKey, wrapVaultKeyForMember } from './vaultCrypto';
import { generateAndWrapKeypair, clearUserKeypair, getOwnPublicKey } from '../auth/userKeypair';

afterEach(() => {
  clearVaultKeys();
  clearUserKeypair();
});

async function sealToSelf(kVault: Uint8Array): Promise<string> {
  const ownPub = await getOwnPublicKey();
  if (!ownPub) throw new Error('no keypair');
  return wrapVaultKeyForMember(kVault, ownPub);
}

describe('vaultKeyCache (E3-3b)', () => {
  it('unlocks K_vault for a (vault, epoch) and caches it', async () => {
    await generateAndWrapKeypair('pw'); // loads our keypair into userKeypair memory
    const kVault = generateVaultKey();
    const wrapped = await sealToSelf(kVault);

    expect(isVaultUnlocked('v1', 1)).toBe(false);
    const got = await unlockVault('v1', 1, wrapped);
    expect(Array.from(got)).toEqual(Array.from(kVault));
    expect(isVaultUnlocked('v1', 1)).toBe(true);
    expect(Array.from(getVaultKey('v1', 1)!)).toEqual(Array.from(kVault));
  });

  it('caches each epoch independently (post-rotation history)', async () => {
    await generateAndWrapKeypair('pw');
    const k1 = generateVaultKey();
    const k2 = generateVaultKey();
    await unlockVault('v1', 1, await sealToSelf(k1));
    await unlockVault('v1', 2, await sealToSelf(k2));
    expect(Array.from(getVaultKey('v1', 1)!)).toEqual(Array.from(k1));
    expect(Array.from(getVaultKey('v1', 2)!)).toEqual(Array.from(k2));
    expect(getVaultKey('v1', 3)).toBeNull();
  });

  it('returns the same cached buffer on repeat unlock (no re-derivation)', async () => {
    await generateAndWrapKeypair('pw');
    const wrapped = await sealToSelf(generateVaultKey());
    const a = await unlockVault('v1', 1, wrapped);
    const b = await unlockVault('v1', 1, wrapped);
    expect(b).toBe(a);
  });

  it('lockVault zeroes + drops ALL epochs of one vault; clearVaultKeys drops all', async () => {
    await generateAndWrapKeypair('pw');
    const k1 = await unlockVault('v1', 1, await sealToSelf(generateVaultKey()));
    await unlockVault('v1', 2, await sealToSelf(generateVaultKey()));
    await unlockVault('v2', 1, await sealToSelf(generateVaultKey()));

    lockVault('v1');
    expect(isVaultUnlocked('v1', 1)).toBe(false);
    expect(isVaultUnlocked('v1', 2)).toBe(false); // every epoch dropped
    expect(Array.from(k1)).toEqual(new Array(32).fill(0)); // buffer was zeroed
    expect(isVaultUnlocked('v2', 1)).toBe(true);

    clearVaultKeys();
    expect(isVaultUnlocked('v2', 1)).toBe(false);
  });

  it('throws when no keypair is loaded (cannot open the seal)', async () => {
    clearUserKeypair();
    await expect(unlockVault('v1', 1, 'AAAA')).rejects.toBeTruthy();
    expect(isVaultUnlocked('v1', 1)).toBe(false);
  });
});
