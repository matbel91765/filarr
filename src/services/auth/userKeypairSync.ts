/**
 * userKeypairSync.ts (E2-4) — orchestrates the per-user keypair lifecycle in the
 * login flow, mirroring how hybridCrypto.ts syncs the wrapped FEK.
 *
 * Kept separate from the pure userKeypair.ts (which has no IPC/window deps so it
 * stays unit-testable). This module talks to the main process over IPC:
 *   keypair:loadLocal / saveLocal   — user_keypair.json (mode 0600)
 *   keypair:fetchFromCloud / pushToCloud — GET/PUT /account/user-key (broker)
 *
 * Eager generation: a brand-new account generates + publishes its keypair at
 * first login so it can immediately receive vault shares (E3). A new device
 * fetches and unwraps the existing keypair instead of regenerating (a fresh
 * keypair would orphan every vault key wrapped to the old public key).
 */

import {
  generateAndWrapKeypair,
  unwrapPrivateKey,
  rewrapLoadedKeypair,
  wrapLoadedRecovery,
  normalizeRecoveryPhrase,
  hasUserKeypair,
  verifyKeypairIntegrity,
  wrapLoadedUnderKey,
  unwrapPrivateKeyUnderKey,
  generateDetachedKeypair,
  clearUserKeypair,
  type GeneratedKeypair,
} from './userKeypair';

/**
 * The blob persisted locally + at the broker. Recovery wrap (E2-5) is cloud-
 * portable; the hardware-key wrap (E2-9) is LOCAL-ONLY — stripped before any cloud
 * push and never folded into the compare-and-set digest, exactly like the FEK's
 * hwWrappedFek. (The decoy keypair is NOT represented here: it's an independent
 * keypair seeded into the decoy profile's own blob, never an alt-field on this one.)
 */
export type StoredKeypair = GeneratedKeypair & {
  recoveryWrappedPrivateKey?: string;
  recoverySalt?: string;
  hwWrappedPrivateKey?: string;
  hwSalt?: string;
  hwCredentialId?: string;
};

function ipc() {
  return window.electron?.ipcRenderer;
}

async function fetchKeypairFromCloud(): Promise<StoredKeypair | null> {
  const r = (await ipc()?.invoke('keypair:fetchFromCloud')) as StoredKeypair | null | undefined;
  if (!r) return null;
  // E2-7: surface an inconsistent served blob (own key). The private-key unwrap
  // is the real authenticity gate; this is a tamper/corruption heads-up.
  if (!(await verifyKeypairIntegrity(r))) {
    console.warn(
      '[userKeypairSync] fetched keypair failed integrity check (fingerprint/binding mismatch)'
    );
  }
  return r;
}

async function pushKeypairToCloud(
  data: StoredKeypair,
  expectedPreviousDigest: string
): Promise<{ success: boolean; code?: string } | undefined> {
  // Strip the LOCAL-ONLY hardware-key wrap (E2-9): it never leaves the device and
  // is excluded from the digest (mirror of the FEK's hwWrappedFek).
  const { hwWrappedPrivateKey: _h, hwSalt: _hs, hwCredentialId: _hc, ...cloud } = data;
  void _h;
  void _hs;
  void _hc;
  return (await ipc()?.invoke('keypair:pushToCloud', { ...cloud, expectedPreviousDigest })) as
    | { success: boolean; code?: string }
    | undefined;
}

/** Discard the local keypair and adopt the server's (after a 409 race). */
async function adoptServerKeypair(password: string): Promise<void> {
  const cloud = await fetchKeypairFromCloud();
  if (cloud) {
    await ipc()?.invoke('keypair:saveLocal', cloud);
    await unwrapPrivateKey(password, cloud);
  }
}

/**
 * Backfill: accounts created before the keypair feature have a local blob but no
 * server copy. Push it only when the server has none (otherwise the 409
 * compare-and-set would — correctly — reject the stomp).
 *
 * Also reconciles a MISSING recovery wrap (mirror of the FEK backfill): if the
 * server holds the SAME keypair identity but never got the recovery-phrase wrap
 * (a transient publish miss at onboarding/rotation), re-push it. The same-identity
 * guard prevents stomping a diverged server keypair; the server digest gates it.
 * This self-heals the FEK↔keypair recovery lockstep on a later launch.
 */
async function backfillKeypairToCloudIfMissing(data: StoredKeypair): Promise<void> {
  const cloud = await fetchKeypairFromCloud();
  if (!cloud) {
    await pushKeypairToCloud(data, 'initial');
    return;
  }
  if (
    data.recoveryWrappedPrivateKey &&
    cloud.encPublicKey === data.encPublicKey &&
    cloud.signPublicKey === data.signPublicKey &&
    !cloud.recoveryWrappedPrivateKey
  ) {
    const serverDigest = await computeUserKeyDigest(cloud);
    await pushKeypairToCloud(data, serverDigest);
  }
}

/** SHA-256 hex of the persisted blobs — matches the server's compare-and-set digest. */
export async function computeUserKeyDigest(k: {
  encPublicKey: string;
  signPublicKey: string;
  wrappedPrivateKey: string;
  recoveryWrappedPrivateKey?: string;
}): Promise<string> {
  const data = new TextEncoder().encode(
    k.encPublicKey + k.signPublicKey + k.wrappedPrivateKey + (k.recoveryWrappedPrivateKey ?? '')
  );
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * E2-5 (password change): re-wrap the loaded keypair under the new password and
 * publish it with the compare-and-set digest of the current blob. The public key
 * + fingerprint are unchanged (identity stable), so shared-vault keys wrapped to
 * it stay valid. The recovery wrap (under the phrase) is carried over unchanged.
 * Best-effort; a concurrent re-wrap (409) makes us adopt the server's keypair.
 */
export async function rewrapKeypairForPasswordChange(newPassword: string): Promise<void> {
  if (!ipc()) return;
  const current = (await ipc()!.invoke('keypair:loadLocal')) as StoredKeypair | null;
  if (!current) return; // no keypair yet — eager generation (E2-4) handles that

  const prevDigest = await computeUserKeyDigest(current);
  const rewrapped = await rewrapLoadedKeypair(newPassword);
  const next: StoredKeypair = {
    ...rewrapped,
    recoveryWrappedPrivateKey: current.recoveryWrappedPrivateKey,
    recoverySalt: current.recoverySalt,
    // E2-9: the hardware-key wrap is PRF-derived (password-independent), so it
    // survives a password change unchanged — carry it over (mirror of the FEK).
    hwWrappedPrivateKey: current.hwWrappedPrivateKey,
    hwSalt: current.hwSalt,
    hwCredentialId: current.hwCredentialId,
  };
  const res = await pushKeypairToCloud(next, prevDigest);
  if (res && !res.success) {
    await adoptServerKeypair(newPassword);
    return;
  }
  await ipc()!.invoke('keypair:saveLocal', next);
}

/**
 * E2-5 (recovery crypto): unwrap the keypair with the recovery phrase, re-wrap it
 * under the new password, and rotate the recovery copy. Returns the blobs to
 * include in the atomic /recover/complete commit, or null if the account has no
 * recovery-wrapped keypair (pre-keypair accounts). The public key is unchanged.
 */
export async function buildRecoveredKeypair(
  recoveryPhrase: string,
  newPassword: string,
  serverUserKey: { recoveryWrappedPrivateKey?: string; recoverySalt?: string } | null
): Promise<StoredKeypair | null> {
  if (!serverUserKey?.recoveryWrappedPrivateKey || !serverUserKey.recoverySalt) {
    return null;
  }
  // Unwrap with the NORMALIZED phrase (unwrapPrivateKey is generic — also used for
  // the password path — so the recovery normalization is applied here, matching
  // how the wrap side normalizes). wrapLoadedRecovery normalizes internally.
  await unwrapPrivateKey(normalizeRecoveryPhrase(recoveryPhrase), {
    wrappedPrivateKey: serverUserKey.recoveryWrappedPrivateKey,
    kekSalt: serverUserKey.recoverySalt,
  });
  const rewrapped = await rewrapLoadedKeypair(newPassword);
  const recovery = await wrapLoadedRecovery(recoveryPhrase);
  return { ...rewrapped, ...recovery };
}

/**
 * E2-5 (recovery-phrase setup): wrap the loaded private keys under the recovery
 * phrase and publish the updated blob, so the keypair can survive a future
 * password reset — the asymmetric mirror of wrapFEKWithRecoveryPhrase. Requires
 * the keypair to be loaded in memory (initUserKeypair ran). MUST be called
 * wherever the FEK gets its recovery wrap: a keypair with no recovery wrap is
 * unrecoverable by phrase (its private key would orphan after a reset).
 * Best-effort — a keypair hiccup must never block onboarding.
 */
export async function attachRecoveryWrap(recoveryPhrase: string): Promise<void> {
  if (!ipc()) return;
  const current = (await ipc()!.invoke('keypair:loadLocal')) as StoredKeypair | null;
  if (!current) return; // no keypair yet (eager generation skipped/failed)
  if (current.recoveryWrappedPrivateKey && current.recoverySalt) return; // already wrapped
  const recovery = await wrapLoadedRecovery(recoveryPhrase); // throws if keys not loaded
  const next: StoredKeypair = { ...current, ...recovery };
  // Persist locally FIRST. This runs in local-mode onboarding where there is
  // usually no authenticated cloud account, so the push below is a no-op
  // ({ success: false, 'Not authenticated' }). Saving only on push success would
  // silently drop the recovery wrap in that common case, leaving the keypair
  // unrecoverable by phrase on this device — the exact data-loss E2-5 prevents.
  await ipc()!.invoke('keypair:saveLocal', next);
  const prevDigest = await computeUserKeyDigest(current);
  const res = await pushKeypairToCloud(next, prevDigest);
  if (res?.code === 'user_key_conflict') {
    // A concurrent device published a different keypair. Local stays authoritative
    // for this device's phrase-recovery; initUserKeypair reconciles cross-device.
    console.warn('[userKeypairSync] attachRecoveryWrap: cloud conflict; kept local recovery wrap');
  }
}

/**
 * E2-5 (recovery-phrase rotation): (re-)wrap the loaded keypair under
 * `recoveryPhrase` and publish it, ALWAYS overwriting any prior recovery wrap.
 * Unlike attachRecoveryWrap (idempotent, for first-time onboarding) this is the
 * FORCE variant used when the phrase itself changes — recovery-phrase
 * regeneration and bootstrapping cloud accounts that never got a wrap. The
 * server's recovery code_hash and this wrap must rotate together, else recovery
 * would verify the new phrase yet fail to unwrap a blob wrapped under the old one.
 * Local-first + best-effort push (no-op when unauthenticated). Requires the
 * keypair in memory.
 */
export async function rotateKeypairRecoveryWrap(
  recoveryPhrase: string,
  unlockPassword?: string
): Promise<void> {
  if (!ipc()) return;
  const current = (await ipc()!.invoke('keypair:loadLocal')) as StoredKeypair | null;
  if (!current) return; // no keypair (eager generation skipped/failed)
  // After a safeStorage-only restart the FEK is restored but the keypair private
  // keys aren't in memory (they load only on a full password unlock). Load them
  // with the account password so the keypair recovery wrap rotates in LOCKSTEP
  // with the FEK's — otherwise recovery would later fail to unwrap the keypair.
  if (!hasUserKeypair() && unlockPassword) {
    try {
      await unwrapPrivateKey(unlockPassword, current);
    } catch {
      /* fall through — wrapLoadedRecovery throws below and the caller logs it */
    }
  }
  const recovery = await wrapLoadedRecovery(recoveryPhrase); // throws if keys not loaded
  const next: StoredKeypair = { ...current, ...recovery };
  await ipc()!.invoke('keypair:saveLocal', next); // local-first
  const prevDigest = await computeUserKeyDigest(current);
  const res = await pushKeypairToCloud(next, prevDigest);
  if (res?.code === 'user_key_conflict') {
    // The server may simply have no row yet — a transient failure of the eager
    // 'initial' push at onboarding leaves the server empty while local has a blob,
    // so our hex prevDigest 409s. Re-seed in that case. A real conflict (server
    // holds a DIFFERENT keypair) keeps local authoritative.
    const server = await fetchKeypairFromCloud();
    if (!server) {
      await pushKeypairToCloud(next, 'initial');
    } else {
      console.warn(
        '[userKeypairSync] rotateKeypairRecoveryWrap: cloud conflict; kept local re-wrap'
      );
    }
  }
}

/**
 * E2-5 (recoverWithPhrase — local-device path): re-wrap the LOCAL keypair under
 * the new password using its recovery wrap, rotate the recovery copy, and publish
 * it (compare-and-set). No-op when the account has no recovery-wrapped keypair.
 * Mirrors how recoverWithPhrase re-wraps the FEK locally and pushes it.
 */
export async function recoverKeypairFromLocalPhrase(
  recoveryPhrase: string,
  newPassword: string
): Promise<void> {
  if (!ipc()) return;
  const current = (await ipc()!.invoke('keypair:loadLocal')) as StoredKeypair | null;
  if (!current?.recoveryWrappedPrivateKey || !current.recoverySalt) return;
  const recovered = await buildRecoveredKeypair(recoveryPhrase, newPassword, current);
  if (!recovered) return;
  // Persist the re-wrapped blob locally FIRST — the next local login unwraps it
  // with the new password. The cloud push is best-effort (no-op if unauthenticated).
  await ipc()!.invoke('keypair:saveLocal', recovered);
  const prevDigest = await computeUserKeyDigest(current);
  const res = await pushKeypairToCloud(recovered, prevDigest);
  if (res?.code === 'user_key_conflict') {
    console.warn(
      '[userKeypairSync] recoverKeypairFromLocalPhrase: cloud conflict; kept local re-wrap'
    );
  }
}

/**
 * Load (local → cloud → generate) the user's keypair and unwrap its private keys
 * into memory. Called from initHybridCrypto after the FEK is ready. Requires
 * Electron IPC; a no-op otherwise.
 */
export async function initUserKeypair(password: string): Promise<void> {
  if (!ipc()) return;

  let data = (await ipc()!.invoke('keypair:loadLocal')) as StoredKeypair | null;
  const loadedFromLocal = !!data;

  if (!data) {
    const cloud = await fetchKeypairFromCloud();
    if (cloud) {
      data = cloud;
      await ipc()!.invoke('keypair:saveLocal', cloud); // cache locally
    }
  }

  if (data) {
    // Existing keypair (this device, another device, or cloud) — unwrap, never
    // regenerate.
    await unwrapPrivateKey(password, data);
    if (loadedFromLocal) {
      await backfillKeypairToCloudIfMissing(data);
    }
  } else {
    // First time: generate, persist locally, publish with 'initial'. If a
    // concurrent device seeded a row between our check and our push, the broker
    // returns 409 — we adopt THEIR keypair instead of stomping it (criterion 3).
    const generated = await generateAndWrapKeypair(password);
    await ipc()!.invoke('keypair:saveLocal', generated);
    const res = await pushKeypairToCloud(generated, 'initial');
    if (res && !res.success) {
      await adoptServerKeypair(password);
    }
  }
}

/**
 * E2-6: lazily ensure this account has a usable keypair, for accounts created
 * before E2 (no user_keys row) that enter a team context (E3) or open the B2B
 * settings. The eager login path (initUserKeypair) already covers the common
 * case; this is the on-demand safety net (e.g. a safeStorage-only restart where
 * the keys aren't in memory, or a best-effort eager generation that failed).
 *
 * Idempotent + race-safe, mirroring backfillWrappedKeyToCloudIfMissing: GET
 * first, generate + publish with 'initial' only when truly absent, and adopt the
 * winner on a 409 (never two concurrent keypairs).
 *
 * Generating/unwrapping the private key requires the vault unlocked. When the
 * password isn't supplied and the keys aren't already in memory, returns
 * { ok:false, needsUnlock:true } so the caller can prompt (VaultPasswordLock) and
 * retry — the team-invitation flow (E3) treats this as a blocking prerequisite.
 */
export async function ensureUserKeypair(
  password?: string
): Promise<{ ok: boolean; needsUnlock?: boolean }> {
  if (!ipc()) return { ok: false };
  if (hasUserKeypair()) return { ok: true }; // private keys already in memory

  // Prefer the local blob, fall back to the server copy (and cache it locally).
  let data = (await ipc()!.invoke('keypair:loadLocal')) as StoredKeypair | null;
  if (!data) {
    const cloud = await fetchKeypairFromCloud();
    if (cloud) {
      data = cloud;
      await ipc()!.invoke('keypair:saveLocal', cloud);
    }
  }

  if (data) {
    // A keypair already exists — we only need to load its private keys (criterion
    // 3: no regeneration). That needs the password to unwrap.
    if (!password) return { ok: false, needsUnlock: true };
    await unwrapPrivateKey(password, data);
    return { ok: true };
  }

  // None anywhere → generate. Needs the password to wrap the private key.
  if (!password) return { ok: false, needsUnlock: true };
  const generated = await generateAndWrapKeypair(password);
  await ipc()!.invoke('keypair:saveLocal', generated);
  const res = await pushKeypairToCloud(generated, 'initial');
  if (res && !res.success) {
    // A concurrent device seeded one first — adopt theirs, never two keypairs.
    await adoptServerKeypair(password);
  }
  return { ok: true };
}

/**
 * E2-7: the account's own key fingerprint (safety number), for out-of-band
 * verification by a peer. Reads the local keypair blob; null if none yet.
 */
export async function getOwnFingerprint(): Promise<string | null> {
  if (!ipc()) return null;
  const local = (await ipc()!.invoke('keypair:loadLocal')) as StoredKeypair | null;
  return local?.fingerprint ?? null;
}

// ── Alternate unlock paths (E2-9) ────────────────────────────────────────────

/**
 * E2-9 (hardware key): wrap the loaded keypair under the same PRF-derived KEK that
 * wraps the FEK, and persist it LOCAL-ONLY (hwWrappedPrivateKey/hwSalt/
 * hwCredentialId) in the keypair blob. Called from enrollHardwareKey with the KEK
 * already derived. Never pushed to cloud (pushKeypairToCloud strips it).
 */
export async function wrapKeypairUnderHardwareKey(
  kek: CryptoKey,
  hwSalt: string,
  hwCredentialId: string
): Promise<void> {
  if (!ipc()) return;
  if (!hasUserKeypair()) return; // keypair not loaded — nothing to wrap (caller is unlocked)
  const current = (await ipc()!.invoke('keypair:loadLocal')) as StoredKeypair | null;
  if (!current) return;
  const hwWrappedPrivateKey = await wrapLoadedUnderKey(kek);
  await ipc()!.invoke('keypair:saveLocal', {
    ...current,
    hwWrappedPrivateKey,
    hwSalt,
    hwCredentialId,
  });
}

/**
 * E2-9 (hardware key): unwrap the keypair via the PRF-derived KEK and load the
 * private keys into memory — no password. Called from initFromHardwareKey with the
 * same KEK it used for the FEK (the keypair shares the FEK's hw salt). No-op if the
 * keypair was never hardware-wrapped on this device.
 */
export async function unwrapKeypairFromHardwareKey(kek: CryptoKey): Promise<void> {
  if (!ipc()) return;
  const current = (await ipc()!.invoke('keypair:loadLocal')) as StoredKeypair | null;
  if (!current?.hwWrappedPrivateKey) return;
  await unwrapPrivateKeyUnderKey(kek, current.hwWrappedPrivateKey);
}

/**
 * E2-9 (decoy): generate an INDEPENDENT keypair blob wrapped under `password`,
 * WITHOUT touching the in-memory (real) keypair. Seeded into the decoy profile so
 * the duress password never reaches the real asymmetric identity (deniability).
 */
export async function generateDetachedKeypairBlob(password: string): Promise<StoredKeypair> {
  return generateDetachedKeypair(password);
}

/** E2-9 (decoy): drop the real private keys from memory (duress-unlock safety). */
export function clearUserKeypairMemory(): void {
  clearUserKeypair();
}

/**
 * E2-9 (hardware key removal): strip the keypair's LOCAL-ONLY hw wrap so the blob
 * doesn't keep advertising a removed authenticator — mirror of removeHardwareKey
 * on the FEK. No-op when there's no hw wrap. Best-effort.
 */
export async function stripKeypairHardwareWrap(): Promise<void> {
  if (!ipc()) return;
  const current = (await ipc()!.invoke('keypair:loadLocal')) as StoredKeypair | null;
  if (!current?.hwWrappedPrivateKey) return;
  const { hwWrappedPrivateKey: _h, hwSalt: _hs, hwCredentialId: _hc, ...rest } = current;
  void _h;
  void _hs;
  void _hc;
  await ipc()!.invoke('keypair:saveLocal', rest);
}
