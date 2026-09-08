import { describe, it, expect, afterEach } from 'vitest';
import {
  generateVaultKey,
  wrapVaultKeyForMember,
  unwrapVaultKey,
  encryptVaultName,
  decryptVaultName,
  buildVaultCreatePayload,
  VaultKeyError,
  generateItemKey,
  wrapItemKey,
  unwrapItemKey,
  encryptItemChunk,
  decryptItemChunk,
  encryptItemMeta,
  decryptItemMeta,
  wrapItemKeyForRecipient,
  unwrapGrantedItemKey,
  type MemberPublicKey,
} from './vaultCrypto';
import {
  generateAndWrapKeypair,
  unwrapPrivateKey,
  clearUserKeypair,
  type GeneratedKeypair,
} from '../auth/userKeypair';

// Real WebCrypto + @noble/curves (vitest node env). userKeypair holds ONE keypair
// in module memory at a time, so to act as "member X" we load X's private key,
// then reload another member's key to open their wrap. Mirrors the E2-11 suite.

function pubOf(g: GeneratedKeypair): MemberPublicKey {
  return {
    encPublicKey: g.encPublicKey,
    signPublicKey: g.signPublicKey,
    encPublicKeySig: g.encPublicKeySig,
    fingerprint: g.fingerprint,
    keyAlgo: g.keyAlgo,
    keyVersion: g.keyVersion,
  };
}

afterEach(() => {
  clearUserKeypair();
});

describe('vaultCrypto — per-member wrap/unwrap of K_vault (E3-2)', () => {
  it('owner round-trip: wrap K_vault to own key, open with loaded private key', async () => {
    const owner = await generateAndWrapKeypair('owner-pw'); // loads owner into memory
    const kVault = generateVaultKey();

    const sealed = await wrapVaultKeyForMember(kVault, pubOf(owner));
    const recovered = await unwrapVaultKey(sealed);

    expect(Array.from(recovered)).toEqual(Array.from(kVault));
  });

  it('two members reach the SAME K_vault from DIFFERENT wraps', async () => {
    const kVault = generateVaultKey();

    // Bob: generate (loads Bob), capture pub + wrapped private for later reload.
    const bob = await generateAndWrapKeypair('bob-pw');
    const sealedForBob = await wrapVaultKeyForMember(kVault, pubOf(bob));

    // Alice: generate (REPLACES the loaded keypair with Alice).
    const alice = await generateAndWrapKeypair('alice-pw');
    const sealedForAlice = await wrapVaultKeyForMember(kVault, pubOf(alice));

    // The two stored blobs differ (sealed to different keys, fresh ephemerals).
    expect(sealedForAlice).not.toBe(sealedForBob);

    // Alice (currently loaded) opens her wrap.
    expect(Array.from(await unwrapVaultKey(sealedForAlice))).toEqual(Array.from(kVault));

    // Reload Bob's private key, then Bob opens his wrap → same raw K_vault.
    await unwrapPrivateKey(
      'bob-pw',
      { wrappedPrivateKey: bob.wrappedPrivateKey, kekSalt: bob.kekSalt },
      bob.keyAlgo
    );
    expect(Array.from(await unwrapVaultKey(sealedForBob))).toEqual(Array.from(kVault));
  });

  it("a member cannot open another member's wrap (AES-GCM tag mismatch)", async () => {
    const kVault = generateVaultKey();
    const bob = await generateAndWrapKeypair('bob-pw');
    const sealedForBob = await wrapVaultKeyForMember(kVault, pubOf(bob));

    // Now load Alice and try to open Bob's wrap with Alice's private key.
    await generateAndWrapKeypair('alice-pw');
    await expect(unwrapVaultKey(sealedForBob)).rejects.toBeTruthy();
  });
});

describe('vaultCrypto — anti-MITM refusal before wrapping (E3-2 / E2-7 / E2-10)', () => {
  it('refuses an unsupported key algorithm', async () => {
    const m = await generateAndWrapKeypair('pw');
    const peer = { ...pubOf(m), keyAlgo: 'mlkem-future-9000' };
    await expect(wrapVaultKeyForMember(generateVaultKey(), peer)).rejects.toMatchObject({
      code: 'unsupported_key_algo',
    });
    await expect(wrapVaultKeyForMember(generateVaultKey(), peer)).rejects.toBeInstanceOf(
      VaultKeyError
    );
  });

  it('refuses a key whose fingerprint does not match (substituted blob)', async () => {
    const m = await generateAndWrapKeypair('pw');
    const peer = { ...pubOf(m), fingerprint: '00000 00000 00000 00000 00000 00000' };
    await expect(wrapVaultKeyForMember(generateVaultKey(), peer)).rejects.toMatchObject({
      code: 'key_integrity_failed',
    });
  });

  it('refuses a key whose enc↔identity binding signature is broken', async () => {
    const m = await generateAndWrapKeypair('pw');
    // Swap the encryption public key for a different valid one → the stored
    // encPublicKeySig no longer verifies against it.
    const other = await generateAndWrapKeypair('other-pw');
    const peer = { ...pubOf(m), encPublicKey: other.encPublicKey };
    await expect(wrapVaultKeyForMember(generateVaultKey(), peer)).rejects.toMatchObject({
      code: 'key_integrity_failed',
    });
  });

  it('refuses a key with the binding signature OMITTED (the silent-substitution attack)', async () => {
    const m = await generateAndWrapKeypair('pw');
    const attacker = await generateAndWrapKeypair('attacker-pw');
    // A compromised broker keeps the victim's REAL signing key + fingerprint (so
    // the user's out-of-band fingerprint comparison still matches) but swaps in an
    // attacker encryption key and DROPS the binding signature. The permissive
    // no-sig path of verifyKeypairIntegrity would accept this — wrapVaultKeyForMember
    // must refuse it, or K_vault gets sealed to the attacker invisibly.
    const peer: MemberPublicKey = {
      ...pubOf(m),
      encPublicKey: attacker.encPublicKey,
      encPublicKeySig: undefined,
    };
    await expect(wrapVaultKeyForMember(generateVaultKey(), peer)).rejects.toMatchObject({
      code: 'key_integrity_failed',
    });
  });
});

describe('vaultCrypto — vault name encryption under K_vault (E3-2)', () => {
  it('round-trips a name under K_vault', async () => {
    const kVault = generateVaultKey();
    const { nameEncrypted, nameIv } = await encryptVaultName('Équipe Design 🔐', kVault);
    expect(nameEncrypted).not.toContain('Équipe');
    const back = await decryptVaultName(nameEncrypted, nameIv, kVault);
    expect(back).toBe('Équipe Design 🔐');
  });

  it('a different K_vault cannot decrypt the name', async () => {
    const { nameEncrypted, nameIv } = await encryptVaultName('Secret', generateVaultKey());
    await expect(decryptVaultName(nameEncrypted, nameIv, generateVaultKey())).rejects.toBeTruthy();
  });
});

describe('vaultCrypto — buildVaultCreatePayload (E3-2)', () => {
  it('produces opaque blobs the owner can open + a name that decrypts', async () => {
    const owner = await generateAndWrapKeypair('owner-pw');
    const payload = await buildVaultCreatePayload('My Team Vault', pubOf(owner));

    // The owner opens their own wrap → exactly the in-session K_vault.
    expect(Array.from(await unwrapVaultKey(payload.wrappedVaultKey))).toEqual(
      Array.from(payload.kVault)
    );
    // The name decrypts under that K_vault.
    expect(await decryptVaultName(payload.nameEncrypted, payload.nameIv, payload.kVault)).toBe(
      'My Team Vault'
    );
  });
});

describe('vaultCrypto — per-item keys (E3-3)', () => {
  it('wraps K_item under K_vault and unwraps it back (symmetric)', async () => {
    const kVault = generateVaultKey();
    const kItem = generateItemKey();
    const wrapped = await wrapItemKey(kItem, kVault);
    expect(Array.from(await unwrapItemKey(wrapped, kVault))).toEqual(Array.from(kItem));
  });

  it('a different K_vault cannot unwrap K_item (AES-GCM tag mismatch)', async () => {
    const wrapped = await wrapItemKey(generateItemKey(), generateVaultKey());
    await expect(unwrapItemKey(wrapped, generateVaultKey())).rejects.toBeTruthy();
  });

  it('round-trips a content chunk under K_item (IV||ct+tag, fresh IV each call)', async () => {
    const kItem = generateItemKey();
    const plaintext = crypto.getRandomValues(new Uint8Array(5000));
    const enc1 = await encryptItemChunk(plaintext, kItem);
    const enc2 = await encryptItemChunk(plaintext, kItem);
    // Same plaintext, different ciphertext (fresh random IV → no IV reuse).
    expect(Array.from(enc1.slice(0, 12))).not.toEqual(Array.from(enc2.slice(0, 12)));
    expect(Array.from(await decryptItemChunk(enc1, kItem))).toEqual(Array.from(plaintext));
    expect(Array.from(await decryptItemChunk(enc2, kItem))).toEqual(Array.from(plaintext));
  });

  it('a different K_item cannot decrypt a chunk', async () => {
    const enc = await encryptItemChunk(new Uint8Array([1, 2, 3, 4]), generateItemKey());
    await expect(decryptItemChunk(enc, generateItemKey())).rejects.toBeTruthy();
  });

  it('round-trips item metadata (JSON) under K_item', async () => {
    const kItem = generateItemKey();
    const meta = { title: 'Q3 Plan 🔐', fileName: 'plan.pdf', mime: 'application/pdf', chunks: 3 };
    const { encryptedMeta, encryptedMetaIv } = await encryptItemMeta(meta, kItem);
    expect(encryptedMeta).not.toContain('plan.pdf');
    expect(await decryptItemMeta(encryptedMeta, encryptedMetaIv, kItem)).toEqual(meta);
  });

  it('full flow: member with K_vault opens K_item then reads the content chunk', async () => {
    // Mirror the server's storage: only the wrapped K_item + encrypted chunk + meta.
    const kVault = generateVaultKey();
    const kItem = generateItemKey();
    const wrappedItemKey = await wrapItemKey(kItem, kVault);
    const { encryptedMeta, encryptedMetaIv } = await encryptItemMeta({ title: 'note' }, kItem);
    const content = new TextEncoder().encode('top secret body');
    const encChunk = await encryptItemChunk(content, kItem);

    // Another member who holds K_vault recovers everything from the opaque blobs.
    const recoveredItemKey = await unwrapItemKey(wrappedItemKey, kVault);
    expect(await decryptItemMeta(encryptedMeta, encryptedMetaIv, recoveredItemKey)).toEqual({
      title: 'note',
    });
    expect(new TextDecoder().decode(await decryptItemChunk(encChunk, recoveredItemKey))).toBe(
      'top secret body'
    );
  });
});

describe('vaultCrypto — sceller K_item à un DESTINATAIRE (E3-6)', () => {
  it('round-trip : le destinataire rouvre le K_item scellé à sa clé', async () => {
    const dest = await generateAndWrapKeypair('mdp-destinataire');
    const kItem = generateItemKey();
    const wrapped = await wrapItemKeyForRecipient(kItem, pubOf(dest));
    await unwrapPrivateKey('mdp-destinataire', {
      wrappedPrivateKey: dest.wrappedPrivateKey,
      kekSalt: dest.kekSalt,
    });
    const opened = await unwrapGrantedItemKey(wrapped);
    expect(Array.from(opened)).toEqual(Array.from(kItem));
  });

  it('REFUSE une clé sans liaison enc↔identité — la substitution silencieuse', async () => {
    const dest = await generateAndWrapKeypair('mdp');
    const pub = pubOf(dest);
    delete (pub as { encPublicKeySig?: string }).encPublicKeySig;
    await expect(wrapItemKeyForRecipient(generateItemKey(), pub)).rejects.toThrow(VaultKeyError);
  });

  it('REFUSE un algorithme inconnu', async () => {
    const dest = await generateAndWrapKeypair('mdp');
    const pub = { ...pubOf(dest), keyAlgo: 'post-quantum-maison' };
    await expect(wrapItemKeyForRecipient(generateItemKey(), pub)).rejects.toThrow(
      /Unsupported recipient key algorithm/
    );
  });

  it('non-régression : wrapVaultKeyForMember garde exactement les mêmes refus', async () => {
    const dest = await generateAndWrapKeypair('mdp');
    const pub = pubOf(dest);
    delete (pub as { encPublicKeySig?: string }).encPublicKeySig;
    await expect(wrapVaultKeyForMember(generateVaultKey(), pub)).rejects.toThrow(VaultKeyError);
  });
});
