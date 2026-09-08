import { describe, it, expect } from 'vitest';
import {
  generateAndWrapKeypair,
  unwrapPrivateKey,
  sealToPublicKey,
  openSealed,
  openSealedWithPriv,
} from '../auth/userKeypair';
import {
  generateOrgKeypair,
  unwrapOrgPrivateKey,
  wrapVaultKeyToOrg,
  resealRecoveryWraps,
  rewrapRecoveryCopiesToNewOrgKey,
  generateOrgKeypairShamir,
  splitExistingOrgPrivateKey,
  reshareToCoordinator,
  combineOrgKeyShares,
  resplitOrgKey,
  signEscrowConsent,
  verifyEscrowConsent,
  escrowConsentMessage,
} from './orgKeyCrypto';

// E4-1: the escrow primitive end to end. The org private key is sealed to an admin; the
// admin recovers it with their own keypair; a team-vault key sealed to the org public key
// is recoverable only with the org private key. No master key, nothing in clear server-side.

type KP = Awaited<ReturnType<typeof generateAndWrapKeypair>>;
const asAdmin = (userId: string, kp: KP) => ({
  userId,
  encPublicKey: kp.encPublicKey,
  signPublicKey: kp.signPublicKey,
  encPublicKeySig: kp.encPublicKeySig,
  fingerprint: kp.fingerprint,
  keyAlgo: kp.keyAlgo,
});

describe('E4-1 org keypair escrow round-trip', () => {
  it('seals the org key to an admin, who recovers it and opens a vault key sealed to the org', async () => {
    // An admin with a real per-user keypair, loaded into module memory.
    const admin = await generateAndWrapKeypair('admin-password');
    await unwrapPrivateKey('admin-password', {
      wrappedPrivateKey: admin.wrappedPrivateKey,
      kekSalt: admin.kekSalt,
    });

    const org = await generateOrgKeypair([asAdmin('admin1', admin)]);
    expect(org.adminWraps).toHaveLength(1);
    expect(org.fingerprint).toMatch(/^\d{5}( \d{5}){5}$/);
    expect(org.encPublicKey).not.toBe(admin.encPublicKey);

    // The admin unwraps the org private key with their OWN loaded keypair.
    const orgPriv = await unwrapOrgPrivateKey(org.adminWraps[0].wrappedOrgPrivkey);
    expect(orgPriv.length).toBe(64); // encPriv(32) || signPriv(32)

    // A team-vault key sealed to the ORG public key is recoverable with the org private key.
    const kVault = crypto.getRandomValues(new Uint8Array(32));
    const sealedToOrg = await sealToPublicKey(kVault, org.encPublicKey);
    const recovered = await openSealedWithPriv(sealedToOrg, orgPriv);
    expect(Array.from(recovered)).toEqual(Array.from(kVault));
  });

  it('seals to multiple admins; each recovers the SAME org key independently', async () => {
    const a = await generateAndWrapKeypair('pw-a');
    // Capture admin A's public key, then generate B (which reloads module state to B).
    const b = await generateAndWrapKeypair('pw-b');
    const org = await generateOrgKeypair([asAdmin('a', a), asAdmin('b', b)]);
    expect(org.adminWraps.map((w) => w.adminUserId).sort()).toEqual(['a', 'b']);

    // Admin B (currently loaded) recovers the org key from their wrap.
    const bWrap = org.adminWraps.find((w) => w.adminUserId === 'b')!;
    const orgPrivViaB = await unwrapOrgPrivateKey(bWrap.wrappedOrgPrivkey);

    // Admin A loads their keypair and recovers the SAME org key from their wrap.
    await unwrapPrivateKey('pw-a', { wrappedPrivateKey: a.wrappedPrivateKey, kekSalt: a.kekSalt });
    const aWrap = org.adminWraps.find((w) => w.adminUserId === 'a')!;
    const orgPrivViaA = await unwrapOrgPrivateKey(aWrap.wrappedOrgPrivkey);

    expect(Array.from(orgPrivViaA)).toEqual(Array.from(orgPrivViaB));
  });

  it('rejects generating an org keypair with no admins', async () => {
    await expect(generateOrgKeypair([])).rejects.toThrow();
  });

  it('wraps a vault key to the verified org key; the org private key recovers it', async () => {
    const admin = await generateAndWrapKeypair('pw');
    await unwrapPrivateKey('pw', {
      wrappedPrivateKey: admin.wrappedPrivateKey,
      kekSalt: admin.kekSalt,
    });
    const org = await generateOrgKeypair([asAdmin('a', admin)]);
    const orgPub = {
      encPublicKey: org.encPublicKey,
      signPublicKey: org.signPublicKey,
      encPublicKeySig: org.encPublicKeySig,
      fingerprint: org.fingerprint,
      keyAlgo: org.keyAlgo,
    };

    const kVault = crypto.getRandomValues(new Uint8Array(32));
    const wrapped = await wrapVaultKeyToOrg(kVault, orgPub);

    // An admin recovers the org private key and opens the recovery copy → original K_vault.
    const orgPriv = await unwrapOrgPrivateKey(org.adminWraps[0].wrappedOrgPrivkey);
    const recovered = await openSealedWithPriv(wrapped, orgPriv);
    expect(Array.from(recovered)).toEqual(Array.from(kVault));

    // Refuse to wrap to an org key with a missing or forged identity binding.
    await expect(
      wrapVaultKeyToOrg(kVault, { ...orgPub, encPublicKeySig: undefined })
    ).rejects.toThrow(/binding|refusing/i);
    await expect(
      wrapVaultKeyToOrg(kVault, { ...orgPub, fingerprint: '00000 00000 00000 00000 00000 00000' })
    ).rejects.toThrow(/integrity|refusing/i);
  });

  it('E4-5 full reset chain: recover an escrow copy and re-seal it to the member NEW key', async () => {
    // Admin with a keypair; org keypair sealed to them.
    const admin = await generateAndWrapKeypair('admin-pw');
    await unwrapPrivateKey('admin-pw', {
      wrappedPrivateKey: admin.wrappedPrivateKey,
      kekSalt: admin.kekSalt,
    });
    const org = await generateOrgKeypair([asAdmin('admin1', admin)]);

    // The member (OLD key) stored an escrow recovery copy of a team-vault key.
    await generateAndWrapKeypair('member-old'); // load member-old (irrelevant after re-key)
    const kVault = crypto.getRandomValues(new Uint8Array(32));
    const recoveryCopy = await wrapVaultKeyToOrg(kVault, {
      encPublicKey: org.encPublicKey,
      signPublicKey: org.signPublicKey,
      encPublicKeySig: org.encPublicKeySig,
      fingerprint: org.fingerprint,
      keyAlgo: org.keyAlgo,
    });

    // The member lost their password and RE-KEYED to a brand-new keypair.
    const memberNew = await generateAndWrapKeypair('member-new');
    const memberNewMaterial = {
      encPublicKey: memberNew.encPublicKey,
      signPublicKey: memberNew.signPublicKey,
      encPublicKeySig: memberNew.encPublicKeySig,
      fingerprint: memberNew.fingerprint,
      keyAlgo: memberNew.keyAlgo,
    };

    // The ADMIN (reloaded) recovers K_vault with the org key and re-seals it to the new key.
    await unwrapPrivateKey('admin-pw', {
      wrappedPrivateKey: admin.wrappedPrivateKey,
      kekSalt: admin.kekSalt,
    });
    const resealed = await resealRecoveryWraps(
      org.adminWraps[0].wrappedOrgPrivkey,
      memberNewMaterial,
      [{ vaultId: 'v1', wrappedVaultKey: recoveryCopy }]
    );
    expect(resealed).toHaveLength(1);
    expect(resealed[0].vaultId).toBe('v1');

    // The member, now on their NEW key, opens the re-sealed wrap → the SAME K_vault.
    await unwrapPrivateKey('member-new', {
      wrappedPrivateKey: memberNew.wrappedPrivateKey,
      kekSalt: memberNew.kekSalt,
    });
    const recovered = await openSealed(resealed[0].wrappedVaultKey);
    expect(Array.from(recovered)).toEqual(Array.from(kVault));

    // Refuse to re-seal to a member key with a forged binding (admin reloaded so the org-key
    // unwrap succeeds and the member-key binding check is the thing that rejects).
    await unwrapPrivateKey('admin-pw', {
      wrappedPrivateKey: admin.wrappedPrivateKey,
      kekSalt: admin.kekSalt,
    });
    await expect(
      resealRecoveryWraps(
        org.adminWraps[0].wrappedOrgPrivkey,
        { ...memberNewMaterial, encPublicKeySig: undefined },
        [{ vaultId: 'v1', wrappedVaultKey: recoveryCopy }]
      )
    ).rejects.toThrow(/binding|refusing/i);
  });

  it('E4-8 rotation: re-wraps a recovery copy from the OLD org key to the NEW org key', async () => {
    const admin = await generateAndWrapKeypair('pw');
    await unwrapPrivateKey('pw', {
      wrappedPrivateKey: admin.wrappedPrivateKey,
      kekSalt: admin.kekSalt,
    });
    const oldOrg = await generateOrgKeypair([asAdmin('a', admin)]);

    // A recovery copy sealed to the OLD org key.
    const kVault = crypto.getRandomValues(new Uint8Array(32));
    const oldCopy = await sealToPublicKey(kVault, oldOrg.encPublicKey);

    // Rotate: a NEW org key, and re-wrap the copy from old → new using the old org private key.
    const newOrg = await generateOrgKeypair([asAdmin('a', admin)]);
    expect(newOrg.fingerprint).not.toBe(oldOrg.fingerprint);
    const oldOrgPriv = await unwrapOrgPrivateKey(oldOrg.adminWraps[0].wrappedOrgPrivkey);
    const rewrapped = await rewrapRecoveryCopiesToNewOrgKey(
      oldOrgPriv,
      newOrg.encPublicKey,
      newOrg.keyAlgo,
      [{ vaultId: 'v1', memberUserId: 'm1', wrappedVaultKey: oldCopy }]
    );
    expect(rewrapped).toHaveLength(1);

    // The NEW org key opens the rewrapped copy → same K_vault.
    const newOrgPriv = await unwrapOrgPrivateKey(newOrg.adminWraps[0].wrappedOrgPrivkey);
    const recovered = await openSealedWithPriv(rewrapped[0].wrappedVaultKey, newOrgPriv);
    expect(Array.from(recovered)).toEqual(Array.from(kVault));

    // The OLD key can no longer open the rotated copy (sealed to the new key only).
    const oldOrgPriv2 = await unwrapOrgPrivateKey(oldOrg.adminWraps[0].wrappedOrgPrivkey);
    await expect(openSealedWithPriv(rewrapped[0].wrappedVaultKey, oldOrgPriv2)).rejects.toThrow();
  });

  it('E4-6 Shamir 2-of-3: no single admin holds the org key; two reconstruct it', async () => {
    const a = await generateAndWrapKeypair('pw-a');
    const b = await generateAndWrapKeypair('pw-b');
    const d = await generateAndWrapKeypair('pw-d');
    const bundle = await generateOrgKeypairShamir(
      [asAdmin('a', a), asAdmin('b', b), asAdmin('d', d)],
      2
    );
    expect(bundle.shares).toHaveLength(3);
    expect(bundle.kThreshold).toBe(2);
    expect(bundle.nShares).toBe(3);
    // No whole org-private wrap exists — only one share per admin.
    const shareA = bundle.shares.find((s) => s.adminUserId === 'a')!.sealedShare;
    const shareB = bundle.shares.find((s) => s.adminUserId === 'b')!.sealedShare;

    // Admin A is the coordinator. A and B each re-seal their share to A.
    const coordinator = {
      encPublicKey: a.encPublicKey,
      signPublicKey: a.signPublicKey,
      encPublicKeySig: a.encPublicKeySig,
      fingerprint: a.fingerprint,
      keyAlgo: a.keyAlgo,
    };
    await unwrapPrivateKey('pw-a', { wrappedPrivateKey: a.wrappedPrivateKey, kekSalt: a.kekSalt });
    const reSealedA = await reshareToCoordinator(shareA, coordinator);
    await unwrapPrivateKey('pw-b', { wrappedPrivateKey: b.wrappedPrivateKey, kekSalt: b.kekSalt });
    const reSealedB = await reshareToCoordinator(shareB, coordinator);

    // The coordinator (A) combines the two re-sealed shares → the org private key.
    await unwrapPrivateKey('pw-a', { wrappedPrivateKey: a.wrappedPrivateKey, kekSalt: a.kekSalt });
    const orgPriv = await combineOrgKeyShares([reSealedA, reSealedB]);
    expect(orgPriv.length).toBe(64);

    // The reconstructed org key opens a vault key sealed to the org public key.
    const kVault = crypto.getRandomValues(new Uint8Array(32));
    const sealedToOrg = await sealToPublicKey(kVault, bundle.encPublicKey);
    const recovered = await openSealedWithPriv(sealedToOrg, orgPriv);
    expect(Array.from(recovered)).toEqual(Array.from(kVault));

    // Threshold/admin-count guards.
    await expect(generateOrgKeypairShamir([asAdmin('a', a)], 2)).rejects.toThrow(/at least 2/i);
    await expect(generateOrgKeypairShamir([asAdmin('a', a), asAdmin('b', b)], 3)).rejects.toThrow(
      /threshold/i
    );
  });

  it('E4-6b conversion: splits an EXISTING org private key in place; k shares reconstruct it', async () => {
    const a = await generateAndWrapKeypair('pw-a');
    const b = await generateAndWrapKeypair('pw-b');
    // An existing org private key, as if just unwrapped from a whole-wrap during conversion.
    const orgPriv = crypto.getRandomValues(new Uint8Array(64));
    const orgPrivCopy = Uint8Array.from(orgPriv);

    const result = await splitExistingOrgPrivateKey(orgPriv, [asAdmin('a', a), asAdmin('b', b)], 2);
    expect(result.shares).toHaveLength(2);
    expect(result.kThreshold).toBe(2);
    // splitExistingOrgPrivateKey must NOT zero the caller's key (needed for the self-test).
    expect(Array.from(orgPriv)).toEqual(Array.from(orgPrivCopy));

    const shareA = result.shares.find((s) => s.adminUserId === 'a')!.sealedShare;
    const shareB = result.shares.find((s) => s.adminUserId === 'b')!.sealedShare;
    const coordinator = {
      encPublicKey: a.encPublicKey,
      signPublicKey: a.signPublicKey,
      encPublicKeySig: a.encPublicKeySig,
      fingerprint: a.fingerprint,
      keyAlgo: a.keyAlgo,
    };
    await unwrapPrivateKey('pw-a', { wrappedPrivateKey: a.wrappedPrivateKey, kekSalt: a.kekSalt });
    const rA = await reshareToCoordinator(shareA, coordinator);
    await unwrapPrivateKey('pw-b', { wrappedPrivateKey: b.wrappedPrivateKey, kekSalt: b.kekSalt });
    const rB = await reshareToCoordinator(shareB, coordinator);
    await unwrapPrivateKey('pw-a', { wrappedPrivateKey: a.wrappedPrivateKey, kekSalt: a.kekSalt });
    const recombined = await combineOrgKeyShares([rA, rB]);
    expect(Array.from(recombined)).toEqual(Array.from(orgPrivCopy));
  });

  it('E4 re-split: redistributes shares + changes k, reconstructs the SAME org key', async () => {
    const a = await generateAndWrapKeypair('pw-a');
    const b = await generateAndWrapKeypair('pw-b');
    const d = await generateAndWrapKeypair('pw-d');
    const bundle = await generateOrgKeypairShamir(
      [asAdmin('a', a), asAdmin('b', b), asAdmin('d', d)],
      2
    );
    // A team-vault key sealed to the ORG public key — it MUST still open after the re-split, proving
    // the org key (hence every recovery copy) is unchanged.
    const kVault = crypto.getRandomValues(new Uint8Array(32));
    const sealedToOrg = await sealToPublicKey(kVault, bundle.encPublicKey);

    const coordinator = {
      encPublicKey: a.encPublicKey,
      signPublicKey: a.signPublicKey,
      encPublicKeySig: a.encPublicKeySig,
      fingerprint: a.fingerprint,
      keyAlgo: a.keyAlgo,
    };
    const shareA = bundle.shares.find((s) => s.adminUserId === 'a')!.sealedShare;
    const shareB = bundle.shares.find((s) => s.adminUserId === 'b')!.sealedShare;

    // Collect k=2 current shares to the coordinator (a).
    await unwrapPrivateKey('pw-a', { wrappedPrivateKey: a.wrappedPrivateKey, kekSalt: a.kekSalt });
    const rA = await reshareToCoordinator(shareA, coordinator);
    await unwrapPrivateKey('pw-b', { wrappedPrivateKey: b.wrappedPrivateKey, kekSalt: b.kekSalt });
    const rB = await reshareToCoordinator(shareB, coordinator);

    // Coordinator (a) re-splits the SAME key for {a,b,d} with a NEW threshold k=3.
    await unwrapPrivateKey('pw-a', { wrappedPrivateKey: a.wrappedPrivateKey, kekSalt: a.kekSalt });
    const res = await resplitOrgKey({
      reSealedShares: [rA, rB],
      admins: [asAdmin('a', a), asAdmin('b', b), asAdmin('d', d)],
      newK: 3,
      expectedEncPublicKey: bundle.encPublicKey,
      expectedFingerprint: bundle.fingerprint,
    });
    expect(res.kThreshold).toBe(3);
    expect(res.nShares).toBe(3);

    // The NEW shares (3-of-3) reconstruct the SAME org key → still opens the vault key.
    const nA = res.shares.find((s) => s.adminUserId === 'a')!.sealedShare;
    const nB = res.shares.find((s) => s.adminUserId === 'b')!.sealedShare;
    const nD = res.shares.find((s) => s.adminUserId === 'd')!.sealedShare;
    await unwrapPrivateKey('pw-a', { wrappedPrivateKey: a.wrappedPrivateKey, kekSalt: a.kekSalt });
    const rnA = await reshareToCoordinator(nA, coordinator);
    await unwrapPrivateKey('pw-b', { wrappedPrivateKey: b.wrappedPrivateKey, kekSalt: b.kekSalt });
    const rnB = await reshareToCoordinator(nB, coordinator);
    await unwrapPrivateKey('pw-d', { wrappedPrivateKey: d.wrappedPrivateKey, kekSalt: d.kekSalt });
    const rnD = await reshareToCoordinator(nD, coordinator);
    await unwrapPrivateKey('pw-a', { wrappedPrivateKey: a.wrappedPrivateKey, kekSalt: a.kekSalt });
    const orgPriv2 = await combineOrgKeyShares([rnA, rnB, rnD]);
    const recovered = await openSealedWithPriv(sealedToOrg, orgPriv2);
    expect(Array.from(recovered)).toEqual(Array.from(kVault));
  }, 30000); // many PBKDF2 unwraps (collect k, re-split, re-collect the new shares)

  it('E4 re-split refuses when the recombined key does not match the org public key (anti-brick)', async () => {
    const a = await generateAndWrapKeypair('pw-a');
    const b = await generateAndWrapKeypair('pw-b');
    const bundle = await generateOrgKeypairShamir([asAdmin('a', a), asAdmin('b', b)], 2);
    const coordinator = {
      encPublicKey: a.encPublicKey,
      signPublicKey: a.signPublicKey,
      encPublicKeySig: a.encPublicKeySig,
      fingerprint: a.fingerprint,
      keyAlgo: a.keyAlgo,
    };
    const shareA = bundle.shares.find((s) => s.adminUserId === 'a')!.sealedShare;
    const shareB = bundle.shares.find((s) => s.adminUserId === 'b')!.sealedShare;
    await unwrapPrivateKey('pw-a', { wrappedPrivateKey: a.wrappedPrivateKey, kekSalt: a.kekSalt });
    const rA = await reshareToCoordinator(shareA, coordinator);
    await unwrapPrivateKey('pw-b', { wrappedPrivateKey: b.wrappedPrivateKey, kekSalt: b.kekSalt });
    const rB = await reshareToCoordinator(shareB, coordinator);
    await unwrapPrivateKey('pw-a', { wrappedPrivateKey: a.wrappedPrivateKey, kekSalt: a.kekSalt });
    // The combine is actually correct, but we lie about the expected fingerprint — the guard must
    // refuse rather than store shares that wouldn't match the org's recovery copies.
    await expect(
      resplitOrgKey({
        reSealedShares: [rA, rB],
        admins: [asAdmin('a', a), asAdmin('b', b)],
        newK: 2,
        expectedEncPublicKey: bundle.encPublicKey,
        expectedFingerprint: '00000 00000 00000 00000 00000 00000',
      })
    ).rejects.toThrow(/does not match/i);
    // Threshold guards.
    await expect(
      resplitOrgKey({
        reSealedShares: [rA, rB],
        admins: [asAdmin('a', a), asAdmin('b', b)],
        newK: 3,
        expectedEncPublicKey: bundle.encPublicKey,
        expectedFingerprint: bundle.fingerprint,
      })
    ).rejects.toThrow(/exceed/i);
  });

  it('signs canonical escrow consent that verifies, and fails on tamper or wrong key', async () => {
    const member = await generateAndWrapKeypair('pw');
    await unwrapPrivateKey('pw', {
      wrappedPrivateKey: member.wrappedPrivateKey,
      kekSalt: member.kekSalt,
    });
    const params = {
      action: 'grant' as const,
      orgId: 'o1',
      orgFingerprint: '11111 22222 33333 44444 55555 66666',
      policy: 'org_key',
      keyVersion: 1,
    };
    const { message, signature } = await signEscrowConsent(params);
    expect(message).toBe(escrowConsentMessage(params)); // deterministic
    expect(await verifyEscrowConsent(message, signature, member.signPublicKey)).toBe(true);
    // Tampered message → fails.
    expect(
      await verifyEscrowConsent(
        message.replace('org_key', 'shamir'),
        signature,
        member.signPublicKey
      )
    ).toBe(false);
    // Wrong signer → fails.
    const other = await generateAndWrapKeypair('pw2');
    expect(await verifyEscrowConsent(message, signature, other.signPublicKey)).toBe(false);
  });

  it('refuses to seal the escrow root to an admin key with a missing/forged binding signature', async () => {
    const admin = await generateAndWrapKeypair('pw');
    // Missing binding signature → refuse (anti key-substitution).
    await expect(
      generateOrgKeypair([{ ...asAdmin('a', admin), encPublicKeySig: undefined }])
    ).rejects.toThrow(/binding|refusing/i);
    // Forged: a fingerprint that doesn't match the signing key → verifyKeypairIntegrity fails.
    await expect(
      generateOrgKeypair([
        { ...asAdmin('a', admin), fingerprint: '00000 00000 00000 00000 00000 00000' },
      ])
    ).rejects.toThrow(/integrity|refusing/i);
  });
});
