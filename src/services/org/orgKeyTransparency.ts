/**
 * orgKeyTransparency.ts (E4-7) — verify the ORG escrow key against its Key Transparency log.
 *
 * Reuses the per-user KT chain verifier (services/vault/keyTransparency) with the org id in the
 * identity slot — the worker's org_key_log hashes org_id exactly where the user chain hashes
 * user_id, so the same recomputation applies. Adds an org-scoped TOFU baseline (distinct
 * localStorage prefix) so a silent org-key substitution surfaces as a 'changed'/'served_not_latest'
 * /'tampered_log' status the escrow flow refuses. The member should ALSO confirm the fingerprint
 * out-of-band with an admin — the strongest anti-MITM guarantee (the server can't forge that).
 */

import { verifyKeyLogChain, type KeyLogEntry, type PeerKeyStatus } from '../vault/keyTransparency';

const ORG_TOFU_PREFIX = 'filarr.kt.org.fp.';

export function getOrgTofuFingerprint(orgId: string): string | null {
  try {
    return localStorage.getItem(ORG_TOFU_PREFIX + orgId);
  } catch {
    return null;
  }
}

export function setOrgTofuFingerprint(orgId: string, fingerprint: string): void {
  try {
    localStorage.setItem(ORG_TOFU_PREFIX + orgId, fingerprint);
  } catch {
    /* no localStorage (tests / non-browser) */
  }
}

/** Pin a NEW org-key fingerprint after the user confirmed the change out-of-band. */
export function acceptOrgKeyChange(orgId: string, fingerprint: string): void {
  setOrgTofuFingerprint(orgId, fingerprint);
}

/**
 * Check a served org public key against its transparency log + the local TOFU baseline. Mirrors
 * checkPeerKeyTransparency (users) for the org key:
 *   - 'tampered_log'      the chain doesn't recompute — the server rewrote history
 *   - 'served_not_latest' the served key isn't the latest logged entry — possible substitution
 *   - 'changed'           valid chain but the org fingerprint changed since last seen — VERIFY OOB
 *   - 'first_seen'        valid + pinned for the first time (TOFU baseline)
 *   - 'no_log'            no log yet (legacy) — fall back to the binding/fingerprint only
 *   - 'ok'                valid, served key is latest, fingerprint unchanged
 * An empty log for an ALREADY-pinned org is a malicious truncation → 'changed', not benign 'no_log'.
 */
export async function checkOrgKeyTransparency(
  orgId: string,
  served: { encPublicKey: string; fingerprint: string },
  entries: KeyLogEntry[]
): Promise<PeerKeyStatus> {
  const { valid, latest } = await verifyKeyLogChain(orgId, entries);
  if (!valid) return 'tampered_log';
  if (!latest) {
    // Empty log. If we've ALREADY pinned this org, an empty log is a malicious truncation to
    // suppress a key-change alert → 'changed'. Otherwise it's first contact with no chain yet:
    // PIN the served key (TOFU) and treat it as first_seen, so a broker can't keep serving an
    // empty log to leave the org permanently downgradable — a later substitution becomes
    // 'changed'. The fingerprint must still be confirmed out of band.
    if (getOrgTofuFingerprint(orgId) !== null) return 'changed';
    setOrgTofuFingerprint(orgId, served.fingerprint);
    return 'first_seen';
  }
  if (latest.encPublicKey !== served.encPublicKey || latest.fingerprint !== served.fingerprint) {
    return 'served_not_latest';
  }
  const known = getOrgTofuFingerprint(orgId);
  if (known === null) {
    setOrgTofuFingerprint(orgId, served.fingerprint);
    return 'first_seen';
  }
  if (known !== served.fingerprint) return 'changed';
  return 'ok';
}

/**
 * Trust gate used before sealing a recovery copy / signing consent to the org key (E4-7). Returns
 * true ONLY for 'ok' and 'first_seen' (the latter pins a TOFU baseline, including on an empty-log
 * first contact). 'no_log' is NOT trusted — an org with a key always has a log entry (backfilled
 * on read), so an empty log can only be broker tampering. A 'changed' / 'served_not_latest' /
 * 'tampered_log' is a substitution signal needing explicit out-of-band confirmation
 * (acceptOrgKeyChange) via the UI before proceeding.
 */
export function isOrgKeyTrustedForEscrow(status: PeerKeyStatus): boolean {
  return status === 'ok' || status === 'first_seen';
}
