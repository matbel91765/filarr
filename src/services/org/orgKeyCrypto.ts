/**
 * orgKeyCrypto.ts (E4) — the organization keypair: generation + admin-wrapping + unwrap.
 *
 * Generalizes the E2 one-key-N-recipients seal (userKeypair.sealToPublicKey) to the ORG
 * keypair used for escrow/recovery. The org PRIVATE key is sealed to each owner/admin's
 * per-user public key — Filarr never holds it, no vendor master key (HARD RULE). An admin
 * unwraps it with their OWN already-unlocked keypair, then uses it (via openSealedWithPriv)
 * to recover a member's team-vault recovery copy in the reset flow (E4-5).
 */

import { split, combine } from 'shamir-secret-sharing';
import {
  generateSealableKeypair,
  sealToPublicKey,
  openSealed,
  openSealedWithPriv,
  derivePublicFromPacked,
  verifyKeypairIntegrity,
  signWithIdentity,
  verifyWithIdentity,
} from '../auth/userKeypair';

/** Public key of an admin, resolved via GET /account/public-key/:userId (E2-8). The full
 *  set is required: the org private key (the escrow root) is sealed to encPublicKey, which
 *  the SHA-256(sign-key) fingerprint does NOT cover — so the enc↔identity binding signature
 *  must be verified before sealing (anti key-substitution, mirrors the E3 vault-share gate). */
export interface AdminPublicKey {
  userId: string;
  encPublicKey: string;
  signPublicKey: string;
  encPublicKeySig?: string;
  fingerprint: string;
  keyAlgo?: string;
}

export interface OrgAdminWrap {
  adminUserId: string;
  wrappedOrgPrivkey: string;
}

export interface OrgKeypairBundle {
  encPublicKey: string;
  signPublicKey: string;
  encPublicKeySig: string;
  fingerprint: string;
  keyAlgo: string;
  keyVersion: number;
  adminWraps: OrgAdminWrap[];
}

/**
 * Generate the org keypair and seal its private key to each admin's public key.
 * Returns the public material + one wrapped-private blob per admin, ready to POST to
 * /org/:id/keys. Throws if an admin's key_algo is unsupported (refuse rather than wrap
 * with the wrong scheme).
 */
export async function generateOrgKeypair(admins: AdminPublicKey[]): Promise<OrgKeypairBundle> {
  if (admins.length === 0) throw new Error('Cannot create an org keypair with no admins');
  // Authenticate EVERY recipient key before sealing the escrow root to it. A broker that
  // substitutes an admin's encryption key (uncovered by the fingerprint) must not receive a
  // wrap of the org private key. Refuse on a missing binding signature or a failed verify.
  for (const a of admins) {
    if (!a.encPublicKeySig) {
      throw new Error(
        `Admin ${a.userId}: missing identity-binding signature — refusing to seal the org key`
      );
    }
    const ok = await verifyKeypairIntegrity({
      encPublicKey: a.encPublicKey,
      signPublicKey: a.signPublicKey,
      encPublicKeySig: a.encPublicKeySig,
      fingerprint: a.fingerprint,
      keyAlgo: a.keyAlgo,
    });
    if (!ok) {
      throw new Error(
        `Admin ${a.userId}: key failed integrity verification — refusing to seal the org key`
      );
    }
  }
  const mat = await generateSealableKeypair();
  try {
    const adminWraps = await Promise.all(
      admins.map(async (a) => ({
        adminUserId: a.userId,
        wrappedOrgPrivkey: await sealToPublicKey(mat.privatePacked, a.encPublicKey, a.keyAlgo),
      }))
    );
    return {
      encPublicKey: mat.encPublicKey,
      signPublicKey: mat.signPublicKey,
      encPublicKeySig: mat.encPublicKeySig,
      fingerprint: mat.fingerprint,
      keyAlgo: mat.keyAlgo,
      keyVersion: mat.keyVersion,
      adminWraps,
    };
  } finally {
    // The org private key is now only inside the sealed blobs — drop the cleartext copy.
    mat.privatePacked.fill(0);
  }
}

/**
 * Unwrap the org private key from this admin's org_admin_wrapped_keys blob, using their
 * own loaded keypair. Returns the packed org private key (encPriv||signPriv). The caller
 * MUST zero it after use. Consumed by the reset flow (E4-5, via openSealedWithPriv).
 */
export async function unwrapOrgPrivateKey(wrappedOrgPrivkey: string): Promise<Uint8Array> {
  return openSealed(wrappedOrgPrivkey);
}

export interface OrgPublicKeyMaterial {
  encPublicKey: string;
  signPublicKey: string;
  encPublicKeySig?: string;
  fingerprint: string;
  keyAlgo?: string;
}

/**
 * Seal a team-vault key (K_vault) to the ORG public key as an escrow recovery copy (E4-2).
 * Verifies the org key's enc↔identity binding FIRST (anti key-substitution — a compromised
 * broker must not trick a member into sealing their recovery copy to a key it controls). The
 * member should ALSO confirm the org fingerprint out-of-band (E4-7). Returns an opaque blob
 * only the org private key (held by admins) can open.
 */
export async function wrapVaultKeyToOrg(
  kVault: Uint8Array,
  orgPub: OrgPublicKeyMaterial
): Promise<string> {
  if (!orgPub.encPublicKeySig) {
    throw new Error('Org key missing identity binding — refusing to wrap a recovery copy');
  }
  const ok = await verifyKeypairIntegrity({
    encPublicKey: orgPub.encPublicKey,
    signPublicKey: orgPub.signPublicKey,
    encPublicKeySig: orgPub.encPublicKeySig,
    fingerprint: orgPub.fingerprint,
    keyAlgo: orgPub.keyAlgo,
  });
  if (!ok) {
    throw new Error('Org key failed integrity verification — refusing to wrap a recovery copy');
  }
  return sealToPublicKey(kVault, orgPub.encPublicKey, orgPub.keyAlgo);
}

export interface RecoveryWrapInput {
  vaultId: string;
  wrappedVaultKey: string;
}

/**
 * Admin-side reset crypto (E4-5): recover each escrowed K_vault with the org private key and
 * RE-SEAL it to the member's NEW public key. `wrappedOrgPrivkey` is the admin's own org wrap
 * (org_admin_wrapped_keys) — only an admin holding it can run this. The member's new key binding
 * is verified before sealing (anti key-substitution); all secrets are zeroed. Returns one new
 * wrap per input, ready to POST to /recovery-reset/:id/complete. The org private key never leaves
 * this function in the clear.
 */
export async function resealRecoveryWraps(
  wrappedOrgPrivkey: string,
  memberNewKey: OrgPublicKeyMaterial,
  wraps: RecoveryWrapInput[]
): Promise<{ vaultId: string; wrappedVaultKey: string }[]> {
  const orgPriv = await unwrapOrgPrivateKey(wrappedOrgPrivkey);
  return resealRecoveryWrapsWithPriv(orgPriv, memberNewKey, wraps);
}

/**
 * Same as resealRecoveryWraps but consumes an ALREADY-reconstructed org private key — the Shamir
 * completion path (E4-6c) obtains it from combineOrgKeyShares, not from a whole-wrap (there is no
 * whole-wrap under shamir). Verifies the member's new-key binding, re-seals each K_vault to it, and
 * ALWAYS zeroes orgPriv (even if the binding check fails). The org private key never leaves cleanly.
 */
export async function resealRecoveryWrapsWithPriv(
  orgPriv: Uint8Array,
  memberNewKey: OrgPublicKeyMaterial,
  wraps: RecoveryWrapInput[]
): Promise<{ vaultId: string; wrappedVaultKey: string }[]> {
  try {
    if (!memberNewKey.encPublicKeySig) {
      throw new Error('Member key missing identity binding — refusing to re-seal recovery copies');
    }
    const ok = await verifyKeypairIntegrity({
      encPublicKey: memberNewKey.encPublicKey,
      signPublicKey: memberNewKey.signPublicKey,
      encPublicKeySig: memberNewKey.encPublicKeySig,
      fingerprint: memberNewKey.fingerprint,
      keyAlgo: memberNewKey.keyAlgo,
    });
    if (!ok) {
      throw new Error('Member key failed integrity verification — refusing to re-seal');
    }
    const out: { vaultId: string; wrappedVaultKey: string }[] = [];
    for (const w of wraps) {
      const kVault = await openSealedWithPriv(w.wrappedVaultKey, orgPriv);
      try {
        out.push({
          vaultId: w.vaultId,
          wrappedVaultKey: await sealToPublicKey(
            kVault,
            memberNewKey.encPublicKey,
            memberNewKey.keyAlgo
          ),
        });
      } finally {
        kVault.fill(0);
      }
    }
    return out;
  } finally {
    orgPriv.fill(0);
  }
}

// ── Org key rotation (E4-8) ─────────────────────────────────────────────────

export interface RecoveryCopyRef {
  vaultId: string;
  memberUserId: string;
  wrappedVaultKey: string;
}

/**
 * Rotation crypto (E4-8): re-wrap every escrow recovery copy from the OLD org key to the NEW org
 * key. Opens K_vault with the OLD org private key (held by the rotating admin) and re-seals it to
 * the NEW org public key. Preserves recoverability across rotation AND revokes the old key — a
 * departed/compromised admin who kept the old private key can no longer open the rotated copies
 * (the old ones are replaced, the old key discarded). The new key is generated by the same client,
 * so no binding check is needed. Zeroes the old org private key + every K_vault on all paths.
 */
export async function rewrapRecoveryCopiesToNewOrgKey(
  oldOrgPriv: Uint8Array,
  newOrgEncPublicKey: string,
  newOrgKeyAlgo: string,
  copies: RecoveryCopyRef[]
): Promise<RecoveryCopyRef[]> {
  try {
    const out: RecoveryCopyRef[] = [];
    for (const c of copies) {
      const kVault = await openSealedWithPriv(c.wrappedVaultKey, oldOrgPriv);
      try {
        out.push({
          vaultId: c.vaultId,
          memberUserId: c.memberUserId,
          wrappedVaultKey: await sealToPublicKey(kVault, newOrgEncPublicKey, newOrgKeyAlgo),
        });
      } finally {
        kVault.fill(0);
      }
    }
    return out;
  } finally {
    oldOrgPriv.fill(0);
  }
}

// ── Shamir k-of-n org key (E4-6) — closes T1: no single admin can recover the org key ──

export interface OrgShamirShare {
  adminUserId: string;
  shareIndex: number;
  sealedShare: string; // sealToPublicKey(rawShare, adminEncPub)
}

export interface OrgShamirBundle {
  encPublicKey: string;
  signPublicKey: string;
  encPublicKeySig: string;
  fingerprint: string;
  keyAlgo: string;
  keyVersion: number;
  kThreshold: number;
  nShares: number;
  shares: OrgShamirShare[];
}

/**
 * Shared core: split `privBytes` into N Shamir shares (threshold K) and seal one to each admin.
 * Verifies every admin's enc↔identity binding first (anti key-substitution) and zeroes the raw
 * shares. Does NOT zero `privBytes` — the caller owns its lifetime. Used by both keypair generation
 * (org private of a fresh key) and conversion (the existing org private key).
 */
async function sealSharesToAdmins(
  privBytes: Uint8Array,
  admins: AdminPublicKey[],
  kThreshold: number
): Promise<{ kThreshold: number; nShares: number; shares: OrgShamirShare[] }> {
  if (admins.length < 2) throw new Error('Shamir escrow needs at least 2 admins');
  if (kThreshold < 2 || kThreshold > admins.length) {
    throw new Error('Shamir threshold must be between 2 and the number of admins');
  }
  for (const a of admins) {
    if (!a.encPublicKeySig) {
      throw new Error(
        `Admin ${a.userId}: missing identity-binding signature — refusing to seal a share`
      );
    }
    const ok = await verifyKeypairIntegrity({
      encPublicKey: a.encPublicKey,
      signPublicKey: a.signPublicKey,
      encPublicKeySig: a.encPublicKeySig,
      fingerprint: a.fingerprint,
      keyAlgo: a.keyAlgo,
    });
    if (!ok) {
      throw new Error(
        `Admin ${a.userId}: key failed integrity verification — refusing to seal a share`
      );
    }
  }
  let rawShares: Uint8Array[] = [];
  try {
    rawShares = await split(privBytes, admins.length, kThreshold);
    // Self-test BEFORE sealing: K of the freshly split shares MUST recombine to the exact input.
    // A broken split that silently fails to reconstruct would permanently brick recovery — refuse.
    const check = await combine(rawShares.slice(0, kThreshold));
    const matches = check.length === privBytes.length && check.every((b, i) => b === privBytes[i]);
    check.fill(0);
    if (!matches) {
      throw new Error('Shamir split self-test failed — refusing to produce shares');
    }
    const shares = await Promise.all(
      admins.map(async (a, i) => ({
        adminUserId: a.userId,
        shareIndex: i,
        sealedShare: await sealToPublicKey(rawShares[i], a.encPublicKey, a.keyAlgo),
      }))
    );
    return { kThreshold, nShares: admins.length, shares };
  } finally {
    rawShares.forEach((s) => s.fill(0));
  }
}

/**
 * Generate the org keypair and split its private key into N Shamir shares (threshold K, audited
 * shamir-secret-sharing lib), sealing ONE share to each admin. No single admin can recover the org
 * key — K admins must each contribute their share (E4-6, closes threat T1). Verifies every admin's
 * enc↔identity binding before sealing (anti key-substitution, like generateOrgKeypair). Unlike the
 * org_key policy, the full org private key is NEVER sealed whole to anyone.
 */
export async function generateOrgKeypairShamir(
  admins: AdminPublicKey[],
  kThreshold: number
): Promise<OrgShamirBundle> {
  const mat = await generateSealableKeypair();
  try {
    const { nShares, shares } = await sealSharesToAdmins(mat.privatePacked, admins, kThreshold);
    return {
      encPublicKey: mat.encPublicKey,
      signPublicKey: mat.signPublicKey,
      encPublicKeySig: mat.encPublicKeySig,
      fingerprint: mat.fingerprint,
      keyAlgo: mat.keyAlgo,
      keyVersion: mat.keyVersion,
      kThreshold,
      nShares,
      shares,
    };
  } finally {
    mat.privatePacked.fill(0);
  }
}

/**
 * Conversion crypto (E4-6b): split an ALREADY-unwrapped EXISTING org private key into Shamir shares
 * for org_key → shamir conversion. Generates NO new keypair (the org public key MUST stay the same
 * so every existing recovery copy + consent stays valid — a fresh key would be rotation, E4-8) and
 * does NOT zero `orgPriv` (the caller keeps it for the mandatory re-combine self-test before POST).
 */
export async function splitExistingOrgPrivateKey(
  orgPriv: Uint8Array,
  admins: AdminPublicKey[],
  kThreshold: number
): Promise<{ kThreshold: number; nShares: number; shares: OrgShamirShare[] }> {
  return sealSharesToAdmins(orgPriv, admins, kThreshold);
}

/**
 * An admin re-seals their own Shamir share to a COORDINATOR's public key (E4-6 recovery): they
 * unwrap their sealed share with their loaded key and re-seal the raw share to the coordinator who
 * will combine K of them. Verifies the coordinator's key binding first. The raw share is zeroed.
 */
export async function reshareToCoordinator(
  sealedShare: string,
  coordinator: OrgPublicKeyMaterial
): Promise<string> {
  if (!coordinator.encPublicKeySig) {
    throw new Error('Coordinator key missing identity binding — refusing to re-seal a share');
  }
  const ok = await verifyKeypairIntegrity({
    encPublicKey: coordinator.encPublicKey,
    signPublicKey: coordinator.signPublicKey,
    encPublicKeySig: coordinator.encPublicKeySig,
    fingerprint: coordinator.fingerprint,
    keyAlgo: coordinator.keyAlgo,
  });
  if (!ok) {
    throw new Error('Coordinator key failed integrity verification — refusing to re-seal a share');
  }
  const rawShare = await openSealed(sealedShare);
  try {
    return await sealToPublicKey(rawShare, coordinator.encPublicKey, coordinator.keyAlgo);
  } finally {
    rawShare.fill(0);
  }
}

/**
 * The coordinator combines K shares (each re-sealed to them by a distinct admin) back into the org
 * private key (E4-6). Unwraps each with their OWN loaded key, then runs the audited Shamir combine.
 * Returns the packed org private key (encPriv||signPriv) — the caller MUST zero it after use. Fewer
 * than K correct shares cannot reconstruct it.
 */
export async function combineOrgKeyShares(reSealedShares: string[]): Promise<Uint8Array> {
  if (reSealedShares.length < 2) {
    throw new Error('Shamir recovery needs at least 2 shares');
  }
  const rawShares: Uint8Array[] = [];
  try {
    for (const s of reSealedShares) {
      rawShares.push(await openSealed(s));
    }
    return await combine(rawShares);
  } finally {
    rawShares.forEach((s) => s.fill(0));
  }
}

/**
 * Shamir RE-SPLIT (E4): the coordinator combines K shares re-sealed to them, then re-splits the SAME
 * org private key for a (possibly changed) admin set / threshold. The org public key is unchanged, so
 * every recovery copy + consent stays valid. CRITICAL self-test: the reset flow proves the combine
 * succeeded by unwrapping a recovery copy; re-split has no such step, so we re-derive the public key
 * from the recombined private key and REFUSE if it doesn't match the org's current public key —
 * otherwise k bad/garbage shares could combine to a wrong value whose re-split shares would
 * permanently brick recovery. `splitExistingOrgPrivateKey` adds its own split→recombine self-test.
 */
export async function resplitOrgKey(p: {
  reSealedShares: string[];
  admins: AdminPublicKey[];
  newK: number;
  expectedEncPublicKey: string;
  expectedFingerprint: string;
}): Promise<{ kThreshold: number; nShares: number; shares: OrgShamirShare[] }> {
  if (p.newK < 2) throw new Error('Shamir threshold must be at least 2');
  if (p.newK > p.admins.length)
    throw new Error('Shamir threshold cannot exceed the shareholder count');
  const orgPriv = await combineOrgKeyShares(p.reSealedShares);
  try {
    const pub = await derivePublicFromPacked(orgPriv);
    if (pub.encPublicKey !== p.expectedEncPublicKey || pub.fingerprint !== p.expectedFingerprint) {
      throw new Error(
        'Recombined org key does not match the current org public key — refusing to re-split (would brick recovery)'
      );
    }
    return await splitExistingOrgPrivateKey(orgPriv, p.admins, p.newK);
  } finally {
    orgPriv.fill(0);
  }
}

// ── Escrow consent (E4-3) + revocation (E4-9) — non-repudiable member signature ──

export interface ConsentParams {
  action: 'grant' | 'revoke';
  orgId: string;
  orgFingerprint: string;
  policy: string;
  keyVersion: number;
}

/**
 * The exact, deterministic message a member signs to consent to (or revoke) escrow. Fixed
 * key order so identical inputs always yield identical bytes — a stable, verifiable signature
 * bound to THIS org, key fingerprint, policy and version. A reset (E4-5) re-checks both the
 * signature AND that the content matches the current org key before restoring access.
 */
export function escrowConsentMessage(p: ConsentParams): string {
  return JSON.stringify({
    v: 1,
    action: p.action,
    orgId: p.orgId,
    fingerprint: p.orgFingerprint,
    policy: p.policy,
    keyVersion: p.keyVersion,
  });
}

const encodeMsg = (s: string) => new TextEncoder().encode(s);

/** Sign the canonical consent/revocation message with the loaded member identity key. */
export async function signEscrowConsent(
  p: ConsentParams
): Promise<{ message: string; signature: string }> {
  const message = escrowConsentMessage(p);
  return { message, signature: await signWithIdentity(encodeMsg(message)) };
}

/** Verify a stored consent signature against a member's signing public key (E4-5 reset gate). */
export async function verifyEscrowConsent(
  message: string,
  signature: string,
  memberSignPublicKey: string,
  keyAlgo?: string
): Promise<boolean> {
  return verifyWithIdentity(encodeMsg(message), signature, memberSignPublicKey, keyAlgo);
}
