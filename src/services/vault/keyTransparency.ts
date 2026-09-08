/**
 * keyTransparency.ts (E3-7) — client-side verification of a peer's key-log.
 *
 * The Worker brokers public keys (E2), so it could serve a FAKE key for a victim to
 * capture a shared-vault key. Two defences combine: the fingerprint (E2-7, compared
 * out-of-band) and this ONLINE check against the append-only, hash-chained key-log
 * (GET /account/keys/log/:userId). Before sealing K_vault to a peer (E3-4 invite),
 * the client: (1) fetches the peer's log, (2) verifies the chain recomputes, (3)
 * confirms the served key (E2-8) IS the latest logged entry, (4) TOFU-alerts if the
 * peer's fingerprint changed since last seen.
 *
 * SCOPE (claims must stay precise): a LIGHTWEIGHT per-user hash-chain + TOFU, not a
 * formally-audited CONIKS/Merkle log. TOFU doesn't eliminate a first-contact MITM.
 *
 * The canonical entry hash MUST match the worker's db.keyLogEntryHash byte-for-byte
 * (fields joined by '\n' in this exact order), or every client would false-alarm.
 */

export interface KeyLogEntry {
  encPublicKey: string;
  signPublicKey: string;
  fingerprint: string;
  prevHash: string;
  entryHash: string;
  createdAt: string;
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** The canonical per-entry hash — identical to the worker (db.ts keyLogEntryHash). */
export async function keyLogEntryHash(userId: string, e: KeyLogEntry): Promise<string> {
  return sha256Hex(
    [e.prevHash, userId, e.encPublicKey, e.signPublicKey, e.fingerprint, e.createdAt].join('\n')
  );
}

export interface KeyLogVerification {
  /** The chain is internally consistent (every entry_hash + prev linkage holds). */
  valid: boolean;
  /** The newest entry, or null for an empty (legacy / pre-E3-7) log. */
  latest: KeyLogEntry | null;
}

/**
 * Verify a peer's key-log chain: each entry's entry_hash must recompute from its
 * fields, and its prev_hash must equal the previous entry's entry_hash. An empty
 * log is trivially consistent (valid, no latest). A break ⇒ valid:false (the server
 * rewrote history — treat as tampered).
 */
export async function verifyKeyLogChain(
  userId: string,
  entries: KeyLogEntry[]
): Promise<KeyLogVerification> {
  let prev = '';
  for (const e of entries) {
    if (e.prevHash !== prev) return { valid: false, latest: null };
    if ((await keyLogEntryHash(userId, e)) !== e.entryHash) return { valid: false, latest: null };
    prev = e.entryHash;
  }
  return { valid: true, latest: entries.length ? entries[entries.length - 1] : null };
}

export type PeerKeyStatus =
  | 'ok' // chain valid, served key is the latest, fingerprint unchanged (or first-seen)
  | 'first_seen' // valid + recorded for the first time (TOFU baseline)
  | 'changed' // valid chain but the peer's fingerprint changed since last seen — VERIFY out-of-band
  | 'served_not_latest' // the served key isn't the latest logged entry (possible substitution)
  | 'tampered_log' // the chain doesn't recompute — the server rewrote history
  | 'no_log'; // the peer has no log entry yet (legacy account) — fall back to fingerprint only

/**
 * Full transparency check for a peer's served key against their log, updating the
 * TOFU baseline. `served` is what GET /account/public-key/:userId returned (E2-8).
 */
export async function checkPeerKeyTransparency(
  userId: string,
  served: { encPublicKey: string; fingerprint: string },
  entries: KeyLogEntry[]
): Promise<PeerKeyStatus> {
  const { valid, latest } = await verifyKeyLogChain(userId, entries);
  if (!valid) return 'tampered_log';
  if (!latest) {
    // An honest, append-only log never SHRINKS. So an empty log for a peer we've
    // ALREADY pinned (a TOFU baseline exists ⇒ their log was non-empty before) is a
    // malicious truncation to suppress a key-change alert — treat as 'changed', not
    // benign 'no_log'. A genuinely-new (never-pinned) peer still yields 'no_log'.
    const pinned = getTofuFingerprint(userId);
    if (pinned !== null) return pinned === served.fingerprint ? 'no_log' : 'changed';
    /**
     * ÉPINGLER MÊME SANS JOURNAL — sinon `no_log` est un état où l'on ne se
     * souvient de rien, et un courtier peut servir une clé différente à chaque
     * appel sans jamais déclencher la moindre alerte. Le journal manque (compte
     * ancien), pas la mémoire : on retient ce qu'on a vu, et la prochaine
     * substitution ressortira en 'changed', comme partout ailleurs. Même geste
     * que orgKeyTransparency, pour la même raison.
     */
    setTofuFingerprint(userId, served.fingerprint);
    return 'no_log';
  }
  // fingerprint is SHA-256(signPublicKey) (E2-7), so comparing {encPublicKey,
  // fingerprint} pins BOTH served public keys — signPublicKey need not be compared
  // separately. (entryHash already binds signPublicKey inside the verified chain.)
  if (latest.encPublicKey !== served.encPublicKey || latest.fingerprint !== served.fingerprint) {
    return 'served_not_latest';
  }
  const known = getTofuFingerprint(userId);
  if (known === null) {
    setTofuFingerprint(userId, served.fingerprint);
    return 'first_seen';
  }
  if (known !== served.fingerprint) return 'changed';
  return 'ok';
}

// ── TOFU baseline (trust-on-first-use), persisted per peer ────────────────────
// Stored in localStorage so a key change across sessions still alerts. Mirrors the
// credentialId tracking pattern of hardwareKey.ts. No-ops where localStorage is
// absent (e.g. node tests) — the chain verification above is the pure, testable core.

const TOFU_PREFIX = 'filarr.kt.fp.';

export function getTofuFingerprint(userId: string): string | null {
  try {
    return localStorage.getItem(TOFU_PREFIX + userId);
  } catch {
    return null;
  }
}

export function setTofuFingerprint(userId: string, fingerprint: string): void {
  try {
    localStorage.setItem(TOFU_PREFIX + userId, fingerprint);
  } catch {
    /* no localStorage (tests / non-browser) */
  }
}

/** Accept a legitimate key change (user confirmed out-of-band) — update the baseline. */
export function acceptPeerKeyChange(userId: string, fingerprint: string): void {
  setTofuFingerprint(userId, fingerprint);
}
