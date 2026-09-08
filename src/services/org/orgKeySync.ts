/**
 * orgKeySync.ts (E4-1) — provision the org keypair on first admin visit.
 *
 * Best-effort + idempotent: no-op if a keypair already exists; otherwise gather the org's
 * active owners/admins + their authenticated public keys, generate the org keypair sealed to
 * each of them (orgKeyCrypto), and POST it. The caller (an admin opening the dashboard) must
 * have their own keypair loaded (ensureUserKeypair runs first) so they're a valid recipient.
 * Filarr never sees the org private key — the server only stores opaque sealed blobs.
 */

import {
  apiGetOrgPublicKey,
  apiGetMemberPublicKey,
  apiCreateOrgKeys,
  apiRecordEscrowConsent,
  apiStoreRecoveryWrap,
  apiGetMyOrgWrap,
  apiInitReset,
  apiGetResetBundle,
  apiCompleteReset,
  apiGetOrgKeyLog,
  apiGetAllRecoveryWraps,
  apiRotateOrgKey,
  apiRevokeEscrowConsent,
  apiShamirConvert,
  apiOpenShamirSession,
  apiGetMyShamirShare,
  apiApproveShamirShare,
  apiGetShamirShares,
  apiOpenResplitSession,
  apiApproveResplitShare,
  apiGetResplitShares,
  apiCompleteResplit,
  type OrgPublicKey,
  type ShamirSessionDetail,
  type ShamirResplitSessionDetail,
} from './orgKeysApi';
import {
  generateOrgKeypair,
  signEscrowConsent,
  wrapVaultKeyToOrg,
  resealRecoveryWraps,
  resealRecoveryWrapsWithPriv,
  rewrapRecoveryCopiesToNewOrgKey,
  splitExistingOrgPrivateKey,
  reshareToCoordinator,
  combineOrgKeyShares,
  resplitOrgKey,
  unwrapOrgPrivateKey,
  verifyEscrowConsent,
  type AdminPublicKey,
} from './orgKeyCrypto';
import { checkOrgKeyTransparency, isOrgKeyTrustedForEscrow } from './orgKeyTransparency';
import { getOwnPublicKey } from '../auth/userKeypair';
import type { OrgMember } from '../../types/org';

/**
 * E4-7 anti-MITM gate: verify a served org key against its transparency log + TOFU baseline before
 * sealing/consenting to it. Returns true only for states safe to proceed without explicit user
 * re-confirmation (ok / first_seen / no-log-legacy). A substitution signal (changed / not-latest /
 * tampered) returns false — the escrow flow refuses; the UI handles out-of-band confirmation.
 */
async function isOrgKeyTrusted(orgId: string, orgPub: OrgPublicKey): Promise<boolean> {
  try {
    const entries = await apiGetOrgKeyLog(orgId);
    const status = await checkOrgKeyTransparency(
      orgId,
      { encPublicKey: orgPub.encPublicKey, fingerprint: orgPub.fingerprint },
      entries
    );
    return isOrgKeyTrustedForEscrow(status);
  } catch {
    return false; // can't verify the key's provenance → don't seal a secret to it
  }
}

export async function ensureOrgKeypair(orgId: string): Promise<void> {
  // Already provisioned?
  if (await apiGetOrgPublicKey(orgId)) return;

  const ipc = window.electron?.ipcRenderer;
  if (!ipc) return;
  const res = await ipc.invoke('org:members:list', orgId);
  if (!res?.success) return;
  const members: OrgMember[] = res.data?.members ?? [];
  const adminIds = members
    .filter((m) => m.status === 'active' && (m.role === 'owner' || m.role === 'admin'))
    .map((m) => m.userId);
  if (adminIds.length === 0) return;

  // Resolve each admin's authenticated public key. Skip admins without a keypair yet — a
  // later visit re-provisions once they have one (the POST requires the caller to be present,
  // and the caller's keypair was just ensured).
  const keys: AdminPublicKey[] = [];
  for (const userId of adminIds) {
    try {
      const k = await apiGetMemberPublicKey(userId);
      if (k?.encPublicKey && k?.signPublicKey && k?.encPublicKeySig) {
        keys.push({
          userId,
          encPublicKey: k.encPublicKey,
          signPublicKey: k.signPublicKey,
          encPublicKeySig: k.encPublicKeySig,
          fingerprint: k.fingerprint,
          keyAlgo: k.keyAlgo,
        });
      }
    } catch {
      /* transient lookup failure — skip this admin, retry on a later visit */
    }
  }
  if (keys.length === 0) return;

  const bundle = await generateOrgKeypair(keys);
  await apiCreateOrgKeys(orgId, {
    encPublicKey: bundle.encPublicKey,
    signPublicKey: bundle.signPublicKey,
    encPublicKeySig: bundle.encPublicKeySig,
    fingerprint: bundle.fingerprint,
    keyAlgo: bundle.keyAlgo,
    keyVersion: bundle.keyVersion,
    adminWraps: bundle.adminWraps,
  });
}

/**
 * Sign + submit the current member's escrow consent for the org's active policy (E4-3). Must
 * be an explicit, informed action (the consent UI names the org + verifies the fingerprint).
 * Returns true on success; false if escrow is off or anything fails (best-effort).
 */
export async function grantEscrowConsent(orgId: string, myUserId: string): Promise<boolean> {
  try {
    const orgPub = await apiGetOrgPublicKey(orgId);
    if (!orgPub || orgPub.escrowPolicy === 'off') return false;
    if (!(await isOrgKeyTrusted(orgId, orgPub))) return false; // E4-7 anti-MITM gate
    const { message, signature } = await signEscrowConsent({
      action: 'grant',
      orgId,
      orgFingerprint: orgPub.fingerprint,
      policy: orgPub.escrowPolicy,
      keyVersion: orgPub.keyVersion,
    });
    await apiRecordEscrowConsent(orgId, myUserId, {
      consentMessage: message,
      memberSignature: signature,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Member side (E4-9, RGPD): WITHDRAW escrow consent. Signs a canonical action='revoke' message and
 * submits it; the server stamps the revocation + ERASES the member's escrow recovery copies. No
 * org-key-trust gate — revoking only ever removes escrow, never grants access. Returns true on
 * success.
 */
export async function revokeEscrowConsent(orgId: string, myUserId: string): Promise<boolean> {
  try {
    const orgPub = await apiGetOrgPublicKey(orgId);
    if (!orgPub) return false;
    const { message, signature } = await signEscrowConsent({
      action: 'revoke',
      orgId,
      orgFingerprint: orgPub.fingerprint,
      policy: orgPub.escrowPolicy,
      keyVersion: orgPub.keyVersion,
    });
    await apiRevokeEscrowConsent(orgId, myUserId, {
      consentMessage: message,
      memberSignature: signature,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort: store an escrow recovery copy of a team-vault key, sealed to the org key (E4-2).
 * No-op unless escrow is enabled. The org key's identity binding is verified before sealing
 * (anti key-substitution). The server independently re-checks escrow-on + signed consent +
 * vault membership, so this is safe to call optimistically from the vault-join flow and NEVER
 * blocks it. Returns true if a copy was stored.
 */
export async function recordVaultRecoveryCopy(
  orgId: string,
  vaultId: string,
  kVault: Uint8Array,
  vaultKeyEpoch: number
): Promise<boolean> {
  try {
    const orgPub = await apiGetOrgPublicKey(orgId);
    if (!orgPub || orgPub.escrowPolicy === 'off') return false;
    if (!(await isOrgKeyTrusted(orgId, orgPub))) return false; // E4-7 anti-MITM gate
    const wrappedVaultKey = await wrapVaultKeyToOrg(kVault, {
      encPublicKey: orgPub.encPublicKey,
      signPublicKey: orgPub.signPublicKey,
      encPublicKeySig: orgPub.encPublicKeySig,
      fingerprint: orgPub.fingerprint,
      keyAlgo: orgPub.keyAlgo,
    });
    await apiStoreRecoveryWrap(orgId, { vaultId, wrappedVaultKey, vaultKeyEpoch });
    return true;
  } catch {
    return false; // best-effort: escrow must never break a vault join
  }
}

/**
 * Member side (E4-5): open a reset request after re-keying. The caller must already hold their
 * NEW keypair loaded (post-recovery), so its fingerprint pins the request. Returns the request id.
 */
export async function requestAccountReset(orgId: string, reason?: string): Promise<string | null> {
  const pub = await getOwnPublicKey();
  if (!pub) return null;
  return apiInitReset(orgId, { newKeyFingerprint: pub.fingerprint, reason });
}

/**
 * Admin side (E4-5): complete a member's reset. Unwraps the org key with the admin's own wrap,
 * VERIFIES the member's consent signature (against their snapshotted sign key) before doing any
 * crypto, recovers each escrowed K_vault and re-seals it to the member's NEW key, then submits.
 * Throws if the admin doesn't hold the org key or the consent doesn't verify. Returns the count.
 */
export async function completeMemberReset(orgId: string, reqId: string): Promise<number> {
  const wrap = await apiGetMyOrgWrap(orgId);
  if (!wrap) throw new Error('You do not hold the org recovery key');
  const bundle = await apiGetResetBundle(orgId, reqId);
  // Cryptographic consent gate: refuse to recover unless the member provably opted in.
  const consentOk =
    !!bundle.consent.signPublicKey &&
    (await verifyEscrowConsent(
      bundle.consent.message,
      bundle.consent.signature,
      bundle.consent.signPublicKey,
      bundle.consent.keyAlgo ?? undefined
    ));
  if (!consentOk) {
    throw new Error('Member escrow consent signature does not verify — refusing to reset');
  }
  const resealed = await resealRecoveryWraps(
    wrap.wrappedOrgPrivkey,
    {
      encPublicKey: bundle.member.encPublicKey,
      signPublicKey: bundle.member.signPublicKey,
      encPublicKeySig: bundle.member.encPublicKeySig,
      fingerprint: bundle.member.fingerprint,
      keyAlgo: bundle.member.keyAlgo,
    },
    bundle.recoveryWraps.map((w) => ({ vaultId: w.vaultId, wrappedVaultKey: w.wrappedVaultKey }))
  );
  return apiCompleteReset(orgId, reqId, resealed);
}

/** Gather the org's ACTIVE owners/admins + their AUTHENTICATED public keys (E2-8). Skips admins
 *  without a keypair. Shared by org-key provisioning, rotation, and Shamir conversion. */
export async function gatherActiveAdminKeys(orgId: string): Promise<AdminPublicKey[]> {
  const ipc = window.electron?.ipcRenderer;
  if (!ipc) return [];
  const res = await ipc.invoke('org:members:list', orgId);
  if (!res?.success) return [];
  const members: OrgMember[] = res.data?.members ?? [];
  const adminIds = members
    .filter((m) => m.status === 'active' && (m.role === 'owner' || m.role === 'admin'))
    .map((m) => m.userId);
  const keys: AdminPublicKey[] = [];
  for (const userId of adminIds) {
    try {
      const k = await apiGetMemberPublicKey(userId);
      if (k?.encPublicKey && k?.signPublicKey && k?.encPublicKeySig) {
        keys.push({
          userId,
          encPublicKey: k.encPublicKey,
          signPublicKey: k.signPublicKey,
          encPublicKeySig: k.encPublicKeySig,
          fingerprint: k.fingerprint,
          keyAlgo: k.keyAlgo,
        });
      }
    } catch {
      /* transient lookup failure — skip this admin */
    }
  }
  return keys;
}

/**
 * Admin side (E4-8): rotate the org key. Generates a fresh org keypair sealed to the current admins,
 * re-wraps EVERY recovery copy from the OLD key to the new one (the rotating admin unwraps the old
 * key from their own wrap), and submits atomically. Revokes the old key — a departed/compromised
 * admin can no longer open the rotated copies. org_key policy ONLY (Shamir rotates via a multi-party
 * re-split). Returns { keyVersion, rewrapped }, or null if not possible.
 */
export async function rotateOrgKeypair(
  orgId: string
): Promise<{ keyVersion: number; rewrapped: number } | null> {
  const orgPub = await apiGetOrgPublicKey(orgId);
  if (!orgPub || orgPub.escrowPolicy === 'shamir') return null;
  const myWrap = await apiGetMyOrgWrap(orgId);
  if (!myWrap) throw new Error('You do not hold the org key');
  const keys = await gatherActiveAdminKeys(orgId);
  if (keys.length === 0) return null;

  // The NEW org keypair, sealed to the current admins.
  const bundle = await generateOrgKeypair(keys);
  // Re-wrap every recovery copy from the OLD key (unwrapped from our own wrap) to the new key.
  const oldOrgPriv = await unwrapOrgPrivateKey(myWrap.wrappedOrgPrivkey);
  const copies = await apiGetAllRecoveryWraps(orgId);
  const rewrappedCopies = await rewrapRecoveryCopiesToNewOrgKey(
    oldOrgPriv,
    bundle.encPublicKey,
    bundle.keyAlgo,
    copies
  );
  return apiRotateOrgKey(orgId, {
    fromVersion: orgPub.keyVersion,
    encPublicKey: bundle.encPublicKey,
    signPublicKey: bundle.signPublicKey,
    encPublicKeySig: bundle.encPublicKeySig,
    fingerprint: bundle.fingerprint,
    keyAlgo: bundle.keyAlgo,
    adminWraps: bundle.adminWraps,
    rewrappedCopies,
  });
}

/**
 * Admin side (E4-6b): convert org_key → Shamir k-of-n. Unwraps the EXISTING org private key from the
 * caller's own wrap and splits it (preserving the org PUBLIC key, so every recovery copy + consent
 * stays valid — a recombine self-test runs inside splitExistingOrgPrivateKey), sealing one share to
 * each admin; the server then destroys the whole-wraps atomically so no single admin can recover
 * alone (closes T1). Any active admin holding the org key may run it. Returns true on success.
 */
export async function convertOrgKeyToShamir(orgId: string, kThreshold: number): Promise<boolean> {
  const orgPub = await apiGetOrgPublicKey(orgId);
  if (!orgPub || orgPub.escrowPolicy !== 'org_key') return false;
  const myWrap = await apiGetMyOrgWrap(orgId);
  if (!myWrap) throw new Error('You do not hold the org key');
  const keys = await gatherActiveAdminKeys(orgId);
  if (keys.length < 2) throw new Error('Shamir needs at least 2 admins with a keypair');
  if (kThreshold < 2 || kThreshold > keys.length) throw new Error('Invalid threshold');
  const orgPriv = await unwrapOrgPrivateKey(myWrap.wrappedOrgPrivkey);
  try {
    const result = await splitExistingOrgPrivateKey(orgPriv, keys, kThreshold);
    await apiShamirConvert(orgId, {
      kThreshold: result.kThreshold,
      nShares: result.nShares,
      fingerprint: orgPub.fingerprint,
      shares: result.shares,
    });
    return true;
  } finally {
    orgPriv.fill(0);
  }
}

/** Count the org's active admins who hold a keypair (to bound the Shamir k selector). */
export async function countShamirEligibleAdmins(orgId: string): Promise<number> {
  return (await gatherActiveAdminKeys(orgId)).length;
}

/** Coordinator (E4-6c): open a k-of-n approval session for a Shamir reset. Returns the session id +
 *  the coordinator fingerprint approvers confirm out-of-band. */
export async function openShamirResetSession(
  orgId: string,
  reqId: string
): Promise<{ sessionId: string; coordinatorFingerprint: string }> {
  const r = await apiOpenShamirSession(orgId, reqId);
  return { sessionId: r.sessionId, coordinatorFingerprint: r.coordinatorFingerprint };
}

/**
 * Approver (E4-6c): contribute your share to a Shamir reset session. Re-seals YOUR own share to the
 * coordinator's key (binding verified inside reshareToCoordinator) and submits it. The caller MUST
 * have confirmed the coordinator's fingerprint out-of-band first (the session carries it). Returns
 * true on success.
 */
export async function contributeShamirShare(
  orgId: string,
  session: ShamirSessionDetail
): Promise<boolean> {
  const mine = await apiGetMyShamirShare(orgId);
  if (!mine) return false;
  const resealed = await reshareToCoordinator(mine.sealedShare, {
    encPublicKey: session.coordinatorEncPublicKey,
    signPublicKey: session.coordinatorSignPublicKey,
    encPublicKeySig: session.coordinatorEncPublicKeySig,
    fingerprint: session.coordinatorFingerprint,
    keyAlgo: session.coordinatorKeyAlgo,
  });
  await apiApproveShamirShare(orgId, session.sessionId, resealed);
  return true;
}

/**
 * Coordinator (E4-6c): complete a Shamir reset once k approvals exist. Fetches the k re-sealed
 * shares, combines them into the org private key, verifies the member's consent, re-seals each
 * recovery copy to the member's NEW key, and submits. The org private key is reconstructed only
 * transiently in memory and zeroed by resealRecoveryWrapsWithPriv. Returns the restored vault count.
 */
export async function completeMemberResetShamir(
  orgId: string,
  reqId: string,
  sessionId: string
): Promise<number> {
  const bundle = await apiGetResetBundle(orgId, reqId);
  const consentOk =
    !!bundle.consent.signPublicKey &&
    (await verifyEscrowConsent(
      bundle.consent.message,
      bundle.consent.signature,
      bundle.consent.signPublicKey,
      bundle.consent.keyAlgo ?? undefined
    ));
  if (!consentOk) {
    throw new Error('Member escrow consent signature does not verify — refusing to reset');
  }
  const { resealedShares } = await apiGetShamirShares(orgId, sessionId);
  const orgPriv = await combineOrgKeyShares(resealedShares);
  // resealRecoveryWrapsWithPriv zeroes orgPriv on every path.
  const resealed = await resealRecoveryWrapsWithPriv(
    orgPriv,
    {
      encPublicKey: bundle.member.encPublicKey,
      signPublicKey: bundle.member.signPublicKey,
      encPublicKeySig: bundle.member.encPublicKeySig,
      fingerprint: bundle.member.fingerprint,
      keyAlgo: bundle.member.keyAlgo,
    },
    bundle.recoveryWraps.map((w) => ({ vaultId: w.vaultId, wrappedVaultKey: w.wrappedVaultKey }))
  );
  return apiCompleteReset(orgId, reqId, resealed);
}

// ── E4 Shamir RE-SPLIT (redistribute shares / change k; org key unchanged) ──

/** Coordinator: open a re-split ceremony for the org, declaring the new threshold. Returns the
 *  session id + the coordinator fingerprint approvers confirm out-of-band. */
export async function openShamirResplitSession(
  orgId: string,
  targetK: number
): Promise<{ sessionId: string; coordinatorFingerprint: string }> {
  const r = await apiOpenResplitSession(orgId, targetK);
  return { sessionId: r.sessionId, coordinatorFingerprint: r.coordinatorFingerprint };
}

/**
 * Approver: contribute your CURRENT share to a re-split session. Identical mechanics to a reset
 * approval — re-seal YOUR share to the coordinator's key (binding verified inside reshareToCoordinator)
 * after confirming their fingerprint out-of-band. Returns true on success.
 */
export async function contributeResplitShare(
  orgId: string,
  session: ShamirResplitSessionDetail
): Promise<boolean> {
  const mine = await apiGetMyShamirShare(orgId);
  if (!mine) return false;
  const resealed = await reshareToCoordinator(mine.sealedShare, {
    encPublicKey: session.coordinatorEncPublicKey,
    signPublicKey: session.coordinatorSignPublicKey,
    encPublicKeySig: session.coordinatorEncPublicKeySig,
    fingerprint: session.coordinatorFingerprint,
    keyAlgo: session.coordinatorKeyAlgo,
  });
  await apiApproveResplitShare(orgId, session.sessionId, resealed);
  return true;
}

/**
 * Coordinator: complete a re-split once k approvals exist. Fetches the k re-sealed shares, combines
 * them into the org private key, PROVES it is the org's real key (resplitOrgKey re-derives the public
 * key and refuses on mismatch — a wrong combine would brick recovery), re-splits it for the CURRENT
 * admin set at the new threshold, and submits. The org private key is reconstructed only transiently
 * and zeroed inside resplitOrgKey. Returns the new { kThreshold, nShares }.
 */
export async function completeShamirResplit(
  orgId: string,
  sessionId: string
): Promise<{ kThreshold: number; nShares: number }> {
  const orgPub = await apiGetOrgPublicKey(orgId);
  if (!orgPub || orgPub.escrowPolicy !== 'shamir') {
    throw new Error('Org is not in Shamir mode');
  }
  const { resealedShares, targetK } = await apiGetResplitShares(orgId, sessionId);
  const admins = await gatherActiveAdminKeys(orgId);
  if (admins.length < 2) throw new Error('Shamir needs at least 2 admins with a keypair');
  if (targetK < 2 || targetK > admins.length) {
    throw new Error('Target threshold exceeds the current admin count');
  }
  const result = await resplitOrgKey({
    reSealedShares: resealedShares,
    admins,
    newK: targetK,
    expectedEncPublicKey: orgPub.encPublicKey,
    expectedFingerprint: orgPub.fingerprint,
  });
  await apiCompleteResplit(orgId, sessionId, {
    fingerprint: orgPub.fingerprint,
    newK: result.kThreshold,
    shares: result.shares,
  });
  return { kThreshold: result.kThreshold, nShares: result.nShares };
}
