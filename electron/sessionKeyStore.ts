/**
 * Session key store — the hybrid FEK handed over by the renderer for the
 * duration of an unlocked session.
 *
 * The renderer holds the FEK (hybridCrypto) and pushes a copy here via the
 * `sync:setSessionKey` IPC whenever the vault unlocks; `sync:clearSessionKey`
 * wipes it on lock / profile switch / logout. Main-process streaming crypto
 * (V3-FEK hybrid blobs) reads it through getSessionKey().
 *
 * Invariants:
 *  - memory only: the key is NEVER written to disk or logged by this module;
 *  - zeroized: the backing Buffer is fill(0)-ed on clear and on replace;
 *  - strict: consumers get the French locked error when no key is loaded.
 *
 * Pure Node module (no Electron imports) so the lifecycle is unit-testable.
 */

export const SESSION_KEY_LENGTH = 32;

/** French user-facing error when an FEK-dependent operation runs while locked. */
export const ERR_VAULT_LOCKED = 'Coffre verrouille - reessayez apres deverrouillage';

const ERR_BAD_KEY = 'Cle de session invalide (32 octets attendus)';

let sessionKey: Buffer | null = null;

/**
 * Installs the session FEK (copies the 32 bytes into a private Buffer).
 * Replacing an existing key zeroizes the previous Buffer first.
 */
export function setSessionKey(raw: Uint8Array): void {
  if (!(raw instanceof Uint8Array) || raw.byteLength !== SESSION_KEY_LENGTH) {
    throw new Error(ERR_BAD_KEY);
  }
  if (sessionKey) {
    sessionKey.fill(0);
  }
  sessionKey = Buffer.alloc(SESSION_KEY_LENGTH);
  sessionKey.set(raw);
}

/** Zeroizes and forgets the session FEK. Idempotent. */
export function clearSessionKey(): void {
  if (sessionKey) {
    sessionKey.fill(0);
    sessionKey = null;
  }
}

export function hasSessionKey(): boolean {
  return sessionKey !== null;
}

/**
 * Returns the live session FEK Buffer, or throws the French locked error.
 * Callers must NOT retain the reference beyond the current operation — the
 * bytes are zeroized in place on clear/replace.
 */
export function getSessionKey(): Buffer {
  if (!sessionKey) {
    throw new Error(ERR_VAULT_LOCKED);
  }
  return sessionKey;
}

/** Non-throwing variant for probes (null when locked). */
export function peekSessionKey(): Buffer | null {
  return sessionKey;
}
