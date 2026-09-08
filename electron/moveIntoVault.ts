/**
 * Move-into-vault orchestration — "Déplacer dans le coffre".
 *
 * Contract (the whole point of this module): the ORIGINAL plaintext file is
 * secure-deleted ONLY after the encrypted vault copy has been proven to
 * decrypt back to byte-identical content. On ANY failure — stat, quota,
 * name collision, encryption, verification, even an interrupted hash — the
 * original is left untouched. A failed verification also removes the
 * freshly-written vault blob (safe: a pre-existing blob at the destination
 * aborts the move BEFORE encryption, so the blob we remove is always ours).
 *
 * Verification never materializes plaintext on disk: the vault copy is
 * stream-decrypted into a SHA-256 (deps.hashVaultPlaintext), compared with
 * the source file's streaming SHA-256 computed BEFORE encryption. A source
 * file mutated mid-import therefore fails verification and is preserved.
 *
 * Dependencies are injected so the sequencing logic is unit-testable in
 * plain Node (no Electron): main.ts wires StorageService + secureDelete.
 */

import * as crypto from 'crypto';
import type { Readable } from 'stream';

export interface MoveIntoVaultDeps {
  /** stat() of the source path; null when missing. */
  statSource(sourcePath: string): Promise<{ isFile: boolean; size: number } | null>;
  /** Per-file quota/size gate (French reason string on refusal). */
  checkQuota(size: number): Promise<{ allowed: boolean; reason?: string }>;
  /** True when a vault blob already exists at the destination. */
  destinationExists(): Promise<boolean>;
  /** Streaming SHA-256 (hex) of the source plaintext. */
  hashSource(sourcePath: string): Promise<string>;
  /** Encrypts source → vault destination (stage-then-rename inside). */
  encryptToVault(
    sourcePath: string,
    onProgress?: (doneBytes: number, totalBytes: number) => void
  ): Promise<{ origSize: number }>;
  /** Streaming SHA-256 (hex) of the DECRYPTED vault copy — no plaintext on disk. */
  hashVaultPlaintext(): Promise<string>;
  /** Removes the freshly-written vault blob (verify-failure rollback). */
  removeVaultFile(): Promise<void>;
  /** Post-verify bookkeeping: storage usage + sync notification. */
  commit(origSize: number): Promise<void>;
  /** Secure-deletes the original plaintext (overwrite + unlink). */
  secureDeleteOriginal(sourcePath: string): Promise<void>;
}

export interface MoveIntoVaultResult {
  /** True when the vault copy is written AND verified (metadata may be saved). */
  success: boolean;
  /** True when decrypt-back verification matched the source hash. */
  verified: boolean;
  /** True when the original plaintext was secure-deleted. */
  originalDeleted: boolean;
  /** Plaintext size in bytes (present on success). */
  size?: number;
  /** French user-facing message when something went wrong. */
  error?: string;
}

export const ERR_SOURCE_MISSING = 'Fichier source introuvable';
export const ERR_SOURCE_NOT_FILE = "Le chemin source n'est pas un fichier";
export const ERR_NAME_TAKEN =
  'Un fichier du même nom existe déjà dans le coffre — renommez-le avant de le déplacer';
export const ERR_VERIFY_FAILED =
  "Vérification d'intégrité échouée — le fichier original a été conservé";
export const ERR_ORIGINAL_KEPT =
  "Fichier protégé, mais l'original n'a pas pu être supprimé (peut-être ouvert dans une autre application)";

/**
 * Runs the full move: validate → hash source → encrypt → verify → commit →
 * secure-delete original. Returns a result object (never throws for expected
 * failures) so the renderer can surface a precise French message per file.
 */
export async function performMoveIntoVault(
  deps: MoveIntoVaultDeps,
  sourcePath: string,
  onProgress?: (doneBytes: number, totalBytes: number) => void
): Promise<MoveIntoVaultResult> {
  const fail = (error: string): MoveIntoVaultResult => ({
    success: false,
    verified: false,
    originalDeleted: false,
    error,
  });

  // ── 1. Validate the source ────────────────────────────────────────────
  let stat: { isFile: boolean; size: number } | null;
  try {
    stat = await deps.statSource(sourcePath);
  } catch {
    return fail(ERR_SOURCE_MISSING);
  }
  if (!stat) return fail(ERR_SOURCE_MISSING);
  if (!stat.isFile) return fail(ERR_SOURCE_NOT_FILE);

  // ── 2. Quota gate ─────────────────────────────────────────────────────
  try {
    const quota = await deps.checkQuota(stat.size);
    if (!quota.allowed) {
      return fail(quota.reason || 'Fichier trop volumineux');
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Vérification du quota impossible');
  }

  // ── 3. Collision guard — never overwrite an existing vault blob in move
  //       mode (a verify against the NEW blob would pass while silently
  //       destroying the OLD vault file). ─────────────────────────────────
  try {
    if (await deps.destinationExists()) {
      return fail(ERR_NAME_TAKEN);
    }
  } catch {
    return fail(ERR_NAME_TAKEN);
  }

  // ── 4. Hash the source BEFORE encryption (mutation detector) ──────────
  let sourceHash: string;
  try {
    sourceHash = await deps.hashSource(sourcePath);
  } catch (err) {
    return fail(err instanceof Error ? err.message : ERR_SOURCE_MISSING);
  }

  // ── 5. Encrypt into the vault ─────────────────────────────────────────
  let origSize: number;
  try {
    const encrypted = await deps.encryptToVault(sourcePath, onProgress);
    origSize = encrypted.origSize;
  } catch (err) {
    // StorageService stages then renames — nothing to roll back here.
    return fail(err instanceof Error ? err.message : 'Chiffrement impossible');
  }

  // ── 6. Verify: stream-decrypt the vault copy → SHA-256 → compare ──────
  let verified = false;
  try {
    const vaultHash = await deps.hashVaultPlaintext();
    verified = vaultHash === sourceHash;
  } catch {
    verified = false;
  }
  if (!verified) {
    // Roll back OUR blob (collision guard above guarantees it is ours);
    // the original plaintext is untouched.
    try {
      await deps.removeVaultFile();
    } catch {
      /* best-effort rollback */
    }
    return fail(ERR_VERIFY_FAILED);
  }

  // ── 7. Commit bookkeeping (storage usage + sync notify) ───────────────
  try {
    await deps.commit(origSize);
  } catch {
    // Non-fatal: the vault copy is valid and verified. Continue.
  }

  // ── 8. Only now: secure-delete the original ───────────────────────────
  try {
    await deps.secureDeleteOriginal(sourcePath);
  } catch {
    return {
      success: true,
      verified: true,
      originalDeleted: false,
      size: origSize,
      error: ERR_ORIGINAL_KEPT,
    };
  }

  return { success: true, verified: true, originalDeleted: true, size: origSize };
}

// ────────────────────────────────────────────────────────────────────────────
// Verify-then-delete (renderer-driven move flow)
//
// The renderer's "Déplacer dans le coffre" import first runs the NORMAL save
// path (encrypted copy + folder metadata, exactly like a copy import), then
// asks main to dispose of the original. This is the second half only:
// prove the vault copy decrypts back to the source bytes, and ONLY on an
// exact hash match secure-delete the original. Any failure — missing vault
// blob, decrypt error, hash mismatch, unreadable source — keeps the
// original untouched. Unlike performMoveIntoVault there is NO rollback of
// the vault blob here: it may legitimately overwrite a same-named file the
// user chose to replace, and metadata already references it.
// ────────────────────────────────────────────────────────────────────────────

export interface VerifyThenDeleteDeps {
  /** stat() of the original path; null when missing. */
  statSource(sourcePath: string): Promise<{ isFile: boolean; size: number } | null>;
  /** True when the encrypted vault copy exists on disk. */
  vaultExists(): Promise<boolean>;
  /** Streaming SHA-256 (hex) of the original plaintext. */
  hashSource(sourcePath: string): Promise<string>;
  /** Streaming SHA-256 (hex) of the DECRYPTED vault copy — no plaintext on disk. */
  hashVaultPlaintext(): Promise<string>;
  /** Secure-deletes the original plaintext (overwrite + unlink). */
  secureDeleteOriginal(sourcePath: string): Promise<void>;
}

export interface VerifyThenDeleteResult {
  /** True when the vault copy decrypted to the exact source bytes. */
  verified: boolean;
  /** True when the original plaintext was secure-deleted. */
  deleted: boolean;
  /** French user-facing message when verified/deleted is false. */
  error?: string;
}

export const ERR_VAULT_COPY_MISSING =
  'Copie chiffrée introuvable dans le coffre — le fichier original a été conservé';
export const ERR_DELETE_FAILED =
  "Vérification réussie, mais l'original n'a pas pu être supprimé (peut-être ouvert dans une autre application)";

/**
 * Verifies the vault copy against the original, then secure-deletes the
 * original. Never throws for expected failures; never deletes unless the
 * decrypt-back hash matched.
 */
export async function performVerifyThenDelete(
  deps: VerifyThenDeleteDeps,
  sourcePath: string
): Promise<VerifyThenDeleteResult> {
  const fail = (error: string): VerifyThenDeleteResult => ({
    verified: false,
    deleted: false,
    error,
  });

  // 1. The original must still exist and be a file.
  let stat: { isFile: boolean; size: number } | null;
  try {
    stat = await deps.statSource(sourcePath);
  } catch {
    return fail(ERR_SOURCE_MISSING);
  }
  if (!stat) return fail(ERR_SOURCE_MISSING);
  if (!stat.isFile) return fail(ERR_SOURCE_NOT_FILE);

  // 2. The vault copy must exist.
  try {
    if (!(await deps.vaultExists())) return fail(ERR_VAULT_COPY_MISSING);
  } catch {
    return fail(ERR_VAULT_COPY_MISSING);
  }

  // 3. Hash both sides — decrypt failure or mismatch keeps the original.
  let verified = false;
  try {
    const [sourceHash, vaultHash] = await Promise.all([
      deps.hashSource(sourcePath),
      deps.hashVaultPlaintext(),
    ]);
    verified = sourceHash.length > 0 && sourceHash === vaultHash;
  } catch {
    verified = false;
  }
  if (!verified) return fail(ERR_VERIFY_FAILED);

  // 4. Only now: secure-delete the original.
  try {
    await deps.secureDeleteOriginal(sourcePath);
  } catch {
    return { verified: true, deleted: false, error: ERR_DELETE_FAILED };
  }
  return { verified: true, deleted: true };
}

/**
 * SHA-256 (hex) of a plaintext Readable — used by main.ts to hash the
 * decrypted vault stream without ever writing plaintext to disk.
 */
export function sha256OfStream(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    stream.on('data', (chunk: Buffer | string) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}
