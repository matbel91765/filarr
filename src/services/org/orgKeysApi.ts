/**
 * orgKeysApi.ts (E4-1) — renderer HTTP layer for the org keypair endpoints.
 *
 * Uses the authenticated apiClient (Bearer + X-Org-Id). The server only ever brokers opaque
 * blobs; the org private key is generated + sealed client-side (orgKeyCrypto).
 */

import apiClient from '../network/apiClient';
import type { KeyLogEntry } from '../vault/keyTransparency';

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface OrgPublicKey {
  orgId: string;
  encPublicKey: string;
  signPublicKey: string;
  encPublicKeySig?: string;
  fingerprint: string;
  keyAlgo: string;
  keyVersion: number;
  escrowPolicy: string;
}

export interface MemberPublicKey {
  userId: string;
  encPublicKey: string;
  signPublicKey: string;
  encPublicKeySig?: string;
  fingerprint: string;
  keyAlgo: string;
  keyVersion: number;
}

/** The org public key, or null if not yet provisioned (404). */
export async function apiGetOrgPublicKey(orgId: string): Promise<OrgPublicKey | null> {
  try {
    const { data } = await apiClient.get<Envelope<OrgPublicKey>>(`/org/${orgId}/public-key`);
    return data.data ?? null;
  } catch (e: unknown) {
    if ((e as { response?: { status?: number } })?.response?.status === 404) return null;
    throw e;
  }
}

/** A member's full public-key material (E2-8) — needed to seal the org key to them. */
export async function apiGetMemberPublicKey(userId: string): Promise<MemberPublicKey | null> {
  try {
    const { data } = await apiClient.get<Envelope<MemberPublicKey>>(
      `/account/public-key/${userId}`
    );
    return data.data ?? null;
  } catch (e: unknown) {
    if ((e as { response?: { status?: number } })?.response?.status === 404) return null;
    throw e;
  }
}

export interface CreateOrgKeysBody {
  encPublicKey: string;
  signPublicKey: string;
  encPublicKeySig: string;
  fingerprint: string;
  keyAlgo: string;
  keyVersion: number;
  adminWraps: { adminUserId: string; wrappedOrgPrivkey: string }[];
}

export async function apiCreateOrgKeys(orgId: string, body: CreateOrgKeysBody): Promise<void> {
  try {
    await apiClient.post<Envelope<{ fingerprint: string }>>(`/org/${orgId}/keys`, body);
  } catch (e: unknown) {
    // 409 means another device already provisioned it — idempotent, treat as success.
    const env = (e as { response?: { status?: number; data?: { code?: string } } })?.response;
    if (env?.status === 409 || env?.data?.code === 'org_key_exists') return;
    throw e;
  }
}

/** Owner/admin sets the escrow policy (E4-3): off | org_key (shamir is via shamir-convert). */
export async function apiSetEscrowPolicy(orgId: string, policy: string): Promise<void> {
  await apiClient.put<Envelope<{ policy: string }>>(`/org/${orgId}/escrow-policy`, { policy });
}

/** Convert org_key → Shamir k-of-n (E4-6b): destroys the whole-wraps, stores one share per admin. */
export async function apiShamirConvert(
  orgId: string,
  body: {
    kThreshold: number;
    nShares: number;
    fingerprint: string;
    shares: { adminUserId: string; shareIndex: number; sealedShare: string }[];
  }
): Promise<void> {
  await apiClient.post<Envelope<{ kThreshold: number; nShares: number }>>(
    `/org/${orgId}/keys/shamir-convert`,
    body
  );
}

/** Record a member's signed escrow consent (E4-3). */
export async function apiRecordEscrowConsent(
  orgId: string,
  userId: string,
  body: { consentMessage: string; memberSignature: string }
): Promise<void> {
  await apiClient.post<Envelope<unknown>>(`/org/${orgId}/members/${userId}/escrow-consent`, body);
}

/** Record a member's signed REVOCATION of escrow consent (E4-9, RGPD). */
export async function apiRevokeEscrowConsent(
  orgId: string,
  userId: string,
  body: { consentMessage: string; memberSignature: string }
): Promise<void> {
  await apiClient.post<Envelope<unknown>>(
    `/org/${orgId}/members/${userId}/escrow-consent/revoke`,
    body
  );
}

/** Store an escrow recovery copy of a team-vault key, sealed to the org key (E4-2). */
export async function apiStoreRecoveryWrap(
  orgId: string,
  body: { vaultId: string; wrappedVaultKey: string; vaultKeyEpoch: number }
): Promise<void> {
  await apiClient.post<Envelope<unknown>>(`/org/${orgId}/recovery-wrap`, body);
}

// ── E4-5 account recovery reset ──

/** The admin's own org-key wrap (to unwrap the org private key for a reset). */
export async function apiGetMyOrgWrap(
  orgId: string
): Promise<{ wrappedOrgPrivkey: string; keyVersion: number; fingerprint: string } | null> {
  try {
    const { data } = await apiClient.get<
      Envelope<{ wrappedOrgPrivkey: string; keyVersion: number; fingerprint: string }>
    >(`/org/${orgId}/keys/mine`);
    return data.data ?? null;
  } catch (e: unknown) {
    if ((e as { response?: { status?: number } })?.response?.status === 404) return null;
    throw e;
  }
}

export interface ResetRequestSummary {
  id: string;
  memberUserId: string;
  status: string;
  newKeyFingerprint: string;
  reason: string | null;
  vaultCount: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ResetBundle {
  member: {
    userId: string;
    encPublicKey: string;
    signPublicKey: string;
    encPublicKeySig?: string;
    fingerprint: string;
    keyAlgo: string;
  };
  consent: {
    message: string;
    signature: string;
    signPublicKey: string | null;
    keyAlgo: string | null;
    orgFingerprint: string;
  };
  recoveryWraps: {
    vaultId: string;
    wrappedVaultKey: string;
    vaultKeyEpoch: number;
    orgFingerprint: string;
  }[];
}

/** Member opens a reset request after re-keying. Returns the request id. */
export async function apiInitReset(
  orgId: string,
  body: { newKeyFingerprint: string; reason?: string }
): Promise<string> {
  const { data } = await apiClient.post<Envelope<{ requestId: string }>>(
    `/org/${orgId}/recovery-reset`,
    body
  );
  return data.data!.requestId;
}

export async function apiListResetRequests(
  orgId: string,
  status?: string
): Promise<ResetRequestSummary[]> {
  const { data } = await apiClient.get<Envelope<{ requests: ResetRequestSummary[] }>>(
    `/org/${orgId}/recovery-resets`,
    { params: status ? { status } : undefined }
  );
  return data.data?.requests ?? [];
}

export async function apiGetResetBundle(orgId: string, reqId: string): Promise<ResetBundle> {
  const { data } = await apiClient.get<Envelope<ResetBundle>>(
    `/org/${orgId}/recovery-reset/${reqId}/bundle`
  );
  return data.data!;
}

export async function apiCompleteReset(
  orgId: string,
  reqId: string,
  wraps: { vaultId: string; wrappedVaultKey: string }[]
): Promise<number> {
  const { data } = await apiClient.post<Envelope<{ vaultCount: number }>>(
    `/org/${orgId}/recovery-reset/${reqId}/complete`,
    { wraps }
  );
  return data.data?.vaultCount ?? 0;
}

export async function apiCancelReset(orgId: string, reqId: string): Promise<void> {
  await apiClient.post<Envelope<unknown>>(`/org/${orgId}/recovery-reset/${reqId}/cancel`, {});
}

// ── E4-6c Shamir multi-party reset session ──

export interface ShamirSessionDetail {
  sessionId: string;
  coordinatorUserId: string;
  coordinatorEncPublicKey: string;
  coordinatorSignPublicKey: string;
  coordinatorEncPublicKeySig?: string;
  coordinatorFingerprint: string;
  coordinatorKeyAlgo: string;
  memberUserId: string;
  resetRequestId: string;
  kThreshold: number;
  approvalsSoFar: number;
  status: string;
  expiresAt: string;
}

/** The coordinator opens a k-of-n approval session for a reset request. */
export async function apiOpenShamirSession(
  orgId: string,
  reqId: string
): Promise<{
  sessionId: string;
  coordinatorFingerprint: string;
  kThreshold: number;
  expiresAt: string;
}> {
  const { data } = await apiClient.post<
    Envelope<{
      sessionId: string;
      coordinatorFingerprint: string;
      kThreshold: number;
      expiresAt: string;
    }>
  >(`/org/${orgId}/recovery-reset/${reqId}/shamir-session`, {});
  return data.data!;
}

/** The open session for a reset request (so a shareholder can join it), or null. */
export async function apiGetShamirSessionForRequest(
  orgId: string,
  reqId: string
): Promise<ShamirSessionDetail | null> {
  const { data } = await apiClient.get<Envelope<{ session: ShamirSessionDetail | null }>>(
    `/org/${orgId}/recovery-reset/${reqId}/shamir-session`
  );
  return data.data?.session ?? null;
}

/** An admin contributes their share re-sealed to the coordinator. */
export async function apiApproveShamirShare(
  orgId: string,
  sid: string,
  resealedShare: string
): Promise<void> {
  await apiClient.post<Envelope<unknown>>(`/org/${orgId}/shamir-session/${sid}/approve`, {
    resealedShare,
  });
}

export async function apiRevokeShamirApproval(orgId: string, sid: string): Promise<void> {
  await apiClient.post<Envelope<unknown>>(`/org/${orgId}/shamir-session/${sid}/approve/revoke`, {});
}

/** The coordinator fetches the re-sealed shares once k approvals exist (else 409). */
export async function apiGetShamirShares(
  orgId: string,
  sid: string
): Promise<{ resealedShares: string[]; kThreshold: number }> {
  const { data } = await apiClient.get<Envelope<{ resealedShares: string[]; kThreshold: number }>>(
    `/org/${orgId}/shamir-session/${sid}/shares`
  );
  return data.data!;
}

/** The calling admin's own Shamir share, or null (404). */
export async function apiGetMyShamirShare(orgId: string): Promise<{
  sealedShare: string;
  shareIndex: number;
  orgPubkeyFingerprint: string;
  keyVersion: number;
} | null> {
  try {
    const { data } = await apiClient.get<
      Envelope<{
        sealedShare: string;
        shareIndex: number;
        orgPubkeyFingerprint: string;
        keyVersion: number;
      }>
    >(`/org/${orgId}/keys/shares/mine`);
    return data.data ?? null;
  } catch (e: unknown) {
    if ((e as { response?: { status?: number } })?.response?.status === 404) return null;
    throw e;
  }
}

// ── E4 Shamir RE-SPLIT session (redistribute shares / change k, org key unchanged) ──

export interface ShamirResplitSessionDetail {
  sessionId: string;
  coordinatorUserId: string;
  coordinatorEncPublicKey: string;
  coordinatorSignPublicKey: string;
  coordinatorEncPublicKeySig?: string;
  coordinatorFingerprint: string;
  coordinatorKeyAlgo: string;
  orgKeyVersion: number;
  kThreshold: number;
  targetK: number;
  approvalsSoFar: number;
  status: string;
  expiresAt: string;
}

/** A shareholder admin opens the re-split ceremony for the org (declares the new threshold). */
export async function apiOpenResplitSession(
  orgId: string,
  targetK: number
): Promise<{
  sessionId: string;
  coordinatorFingerprint: string;
  kThreshold: number;
  targetK: number;
  expiresAt: string;
}> {
  const { data } = await apiClient.post<
    Envelope<{
      sessionId: string;
      coordinatorFingerprint: string;
      kThreshold: number;
      targetK: number;
      expiresAt: string;
    }>
  >(`/org/${orgId}/keys/resplit-session`, { targetK });
  return data.data!;
}

/** The open re-split session for the org (so a shareholder can join it), or null. */
export async function apiGetOpenResplitSession(
  orgId: string
): Promise<ShamirResplitSessionDetail | null> {
  const { data } = await apiClient.get<Envelope<{ session: ShamirResplitSessionDetail | null }>>(
    `/org/${orgId}/keys/resplit-session`
  );
  return data.data?.session ?? null;
}

/** Detail of a re-split session by id (coordinator key + progress). */
export async function apiGetResplitSession(
  orgId: string,
  sid: string
): Promise<ShamirResplitSessionDetail> {
  const { data } = await apiClient.get<Envelope<ShamirResplitSessionDetail>>(
    `/org/${orgId}/keys/resplit-session/${sid}`
  );
  return data.data!;
}

/** An admin contributes their current share re-sealed to the coordinator. */
export async function apiApproveResplitShare(
  orgId: string,
  sid: string,
  resealedShare: string
): Promise<void> {
  await apiClient.post<Envelope<unknown>>(`/org/${orgId}/keys/resplit-session/${sid}/approve`, {
    resealedShare,
  });
}

export async function apiRevokeResplitApproval(orgId: string, sid: string): Promise<void> {
  await apiClient.post<Envelope<unknown>>(
    `/org/${orgId}/keys/resplit-session/${sid}/approve/revoke`,
    {}
  );
}

/** The coordinator aborts their open re-split session, freeing the per-org slot immediately. */
export async function apiCancelResplitSession(orgId: string, sid: string): Promise<void> {
  await apiClient.post<Envelope<unknown>>(`/org/${orgId}/keys/resplit-session/${sid}/cancel`, {});
}

/** The coordinator fetches the re-sealed shares once k approvals exist (else 409). */
export async function apiGetResplitShares(
  orgId: string,
  sid: string
): Promise<{ resealedShares: string[]; kThreshold: number; targetK: number }> {
  const { data } = await apiClient.get<
    Envelope<{ resealedShares: string[]; kThreshold: number; targetK: number }>
  >(`/org/${orgId}/keys/resplit-session/${sid}/shares`);
  return data.data!;
}

/** The coordinator submits the freshly re-split shares + new k; the server swaps them atomically. */
export async function apiCompleteResplit(
  orgId: string,
  sid: string,
  body: {
    fingerprint: string;
    newK: number;
    shares: { adminUserId: string; shareIndex: number; sealedShare: string }[];
  }
): Promise<void> {
  await apiClient.post<Envelope<{ kThreshold: number; nShares: number }>>(
    `/org/${orgId}/keys/resplit-session/${sid}/complete`,
    body
  );
}

/** The org key's append-only transparency log (E4-7), oldest → newest, for client verification. */
export async function apiGetOrgKeyLog(orgId: string): Promise<KeyLogEntry[]> {
  const { data } = await apiClient.get<Envelope<{ orgId: string; entries: KeyLogEntry[] }>>(
    `/org/${orgId}/keys/log`
  );
  return data.data?.entries ?? [];
}

// ── E4-8 org key rotation ──

export interface RecoveryCopyRef {
  vaultId: string;
  memberUserId: string;
  wrappedVaultKey: string;
}

/** Every escrow recovery copy in the org — for the rotating admin to re-wrap to the new key. */
export async function apiGetAllRecoveryWraps(orgId: string): Promise<RecoveryCopyRef[]> {
  const { data } = await apiClient.get<Envelope<{ copies: RecoveryCopyRef[] }>>(
    `/org/${orgId}/keys/recovery-wraps/all`
  );
  return data.data?.copies ?? [];
}

export interface RotateOrgKeyBody {
  fromVersion: number;
  encPublicKey: string;
  signPublicKey: string;
  encPublicKeySig: string;
  fingerprint: string;
  keyAlgo: string;
  adminWraps: { adminUserId: string; wrappedOrgPrivkey: string }[];
  rewrappedCopies: RecoveryCopyRef[];
}

export async function apiRotateOrgKey(
  orgId: string,
  body: RotateOrgKeyBody
): Promise<{ keyVersion: number; rewrapped: number }> {
  const { data } = await apiClient.post<Envelope<{ keyVersion: number; rewrapped: number }>>(
    `/org/${orgId}/keys/rotate`,
    body
  );
  return data.data!;
}
