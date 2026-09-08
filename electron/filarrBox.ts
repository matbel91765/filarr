/**
 * filarrBox.ts — "Protéger sur place" orchestration (Wave 2), main-process
 * side. Pure Node, deps-injected exactly like moveIntoVault.ts so the HARD
 * data-safety sequencing is unit-testable headless:
 *
 *   pack → (verify the staged container decrypts back to the exact source
 *   bytes) → rename into the final `.filarr` name → ONLY THEN secure-delete
 *   the original. Any failure keeps the original untouched and removes the
 *   staging file.
 *
 * Composes the container primitives from filarrContainer.ts (format,
 * pack/verify/extract) — this module owns the collision guard, the staging
 * lifecycle, the rename retries (AV/OneDrive locks), the delete-after-verify
 * step, the "déprotéger" restore and the extract-all tree rebuild.
 */

import { randomBytes, createHash } from 'node:crypto';
import { open, lstat, mkdir, rename, rm, unlink, access } from 'node:fs/promises';
import * as path from 'node:path';
import { V3FileReader, decryptFileToFileV3 } from './streamCrypto';
import { walkTarIndex } from './tarStream';
import {
  BOX_KIND_FILE,
  BOX_KIND_FOLDER,
  ERR_BOX_NOT_A_FOLDER_BOX,
  ERR_BOX_CORRUPT,
  packFileContainer,
  packFolderContainer,
  readContainerMetadata,
  verifyContainerHash,
  hashContainerPlaintextHex,
  type BoxKeyInput,
  type BoxKind,
  type BoxMetadata,
  type BoxProgress,
  type PackContainerResult,
} from './filarrContainer';

// ── French user-facing messages (orchestration level) ───────────────────────

export const ERR_BOX_LOCKED = "Coffre verrouillé — déverrouillez Filarr d'abord";
export const ERR_PROTECT_SOURCE_MISSING = 'Fichier ou dossier source introuvable';
export const ERR_PROTECT_SYMLINK = 'Les liens symboliques ne peuvent pas être protégés';
export const ERR_PROTECT_KIND = "Le chemin source n'est ni un fichier ni un dossier";
export const ERR_PROTECT_DEST_INSIDE_SOURCE =
  "Le dossier de destination est à l'intérieur du dossier à protéger";
export const ERR_PROTECT_TOO_MANY_COLLISIONS =
  'Trop de conteneurs du même nom à cet emplacement — renommez ou déplacez les anciens';
export const ERR_PROTECT_VERIFY =
  "Vérification d'intégrité échouée — l'original a été conservé";
export const ERR_PROTECT_FINALIZE =
  "Impossible de finaliser le conteneur — l'original a été conservé";
export const WARN_ORIGINAL_KEPT =
  "Conteneur créé, mais l'original n'a pas pu être supprimé (peut-être ouvert dans une autre application)";
export const NOTE_ORIGINAL_GONE =
  "Conteneur créé — l'original avait déjà disparu au moment de la suppression";
export const ERR_UNPROTECT_VERIFY =
  "Vérification d'intégrité échouée — le conteneur a été conservé";
export const ERR_ENTRY_PATH_UNSAFE =
  'Chemin d’entrée invalide dans le conteneur — extraction refusée';

const RENAME_RETRIES = 3;
const RENAME_BACKOFF_MS = 200;
const EXTRACT_SLICE = 8 * 1024 * 1024;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * fs.rename with 3 retries / 200 ms backoff — antivirus and OneDrive briefly
 * lock freshly-written files on Windows; the previous container version (if
 * any) stays intact until the rename lands.
 */
export async function renameWithRetries(from: string, to: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RENAME_RETRIES; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < RENAME_RETRIES - 1) {
        await sleep(RENAME_BACKOFF_MS);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(ERR_PROTECT_FINALIZE);
}

/**
 * `<destDir>/<baseName>.filarr`, suffixing " (2)" … " (99)" on collision —
 * NEVER overwrites an existing container (verifying against a fresh blob
 * while destroying an old one would silently lose data — the moveIntoVault
 * collision-guard rationale).
 */
export async function suffixedContainerPath(destDir: string, baseName: string): Promise<string> {
  for (let i = 1; i <= 99; i++) {
    const name = i === 1 ? `${baseName}.filarr` : `${baseName} (${i}).filarr`;
    const candidate = path.join(destDir, name);
    const exists = await access(candidate).then(() => true, () => false);
    if (!exists) return candidate;
  }
  throw new Error(ERR_PROTECT_TOO_MANY_COLLISIONS);
}

/**
 * Collision-free PLAINTEXT restore path: "Rapport.pdf" → "Rapport (2).pdf",
 * "MonDossier" → "MonDossier (2)". Used by "déprotéger" and "tout extraire".
 */
export async function suffixedPlainPath(destDir: string, fileName: string): Promise<string> {
  const ext = path.extname(fileName);
  const stem = ext.length > 0 ? fileName.slice(0, -ext.length) : fileName;
  for (let i = 1; i <= 99; i++) {
    const name = i === 1 ? fileName : `${stem} (${i})${ext}`;
    const candidate = path.join(destDir, name);
    const exists = await access(candidate).then(() => true, () => false);
    if (!exists) return candidate;
  }
  throw new Error(ERR_PROTECT_TOO_MANY_COLLISIONS);
}

/** Streaming SHA-256 (hex) of a plaintext file — verify half of "déprotéger". */
async function sha256FileHex(filePath: string): Promise<string> {
  const handle = await open(filePath, 'r');
  try {
    const hash = createHash('sha256');
    const buf = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buf, 0, buf.length, position);
      if (bytesRead <= 0) break;
      hash.update(buf.subarray(0, bytesRead));
      position += bytesRead;
    }
    return hash.digest('hex');
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/**
 * Defense in depth for tar entry paths (the payload is GCM-authenticated
 * under our own key, but extraction writes to the real filesystem): every
 * '/'-separated segment must be a plain name — no '', '.', '..', drive
 * colons, backslashes or NULs.
 */
export function isSafeEntryPath(entryPath: string): boolean {
  if (entryPath.length === 0 || entryPath.length > 4096) return false;
  const segments = entryPath.split('/');
  for (const seg of segments) {
    if (seg.length === 0 || seg === '.' || seg === '..') return false;
    if (seg.includes('\\') || seg.includes(':') || seg.includes('\0')) return false;
  }
  return true;
}

// ── Protect in place ────────────────────────────────────────────────────────

export interface ProtectDeps {
  /**
   * Owned copy of the write key (session FEK when loaded — portable across
   * the user's unlocked devices — else the machine master key). Zeroized
   * here after use.
   */
  getWriteKey(): Promise<Buffer>;
  /** Secure-deletes the original FILE (overwrite + unlink, best-effort on SSD). */
  secureDeleteFile(p: string): Promise<void>;
  /** Secure-deletes the original FOLDER recursively. */
  secureDeleteDir(p: string): Promise<void>;
  /**
   * Test seam: called after the staged container is fully written, BEFORE
   * verification. Production wiring leaves it undefined; the harness uses it
   * to corrupt the staging file and prove verify-fail preserves the original.
   */
  onStaged?(stagedPath: string): Promise<void>;
}

export interface ProtectRequest {
  sourcePath: string;
  /** undefined/null = in place, next to the original. */
  destDir?: string | null;
  /** Secure-delete the original after a successful verify (checkbox). */
  deleteOriginal: boolean;
}

/** Mirrors the renderer contract (filarrBoxBridge.ProtectItemResult). */
export interface ProtectOutcome {
  sourcePath: string;
  ok: boolean;
  /** Final container path (ok === true). */
  boxPath?: string;
  kind?: BoxKind;
  name?: string;
  /** Plaintext size (files) / tar size (folders). */
  size?: number;
  skippedSymlinks?: number;
  originalDeleted: boolean;
  /** French failure reason (ok === false) — the original is ALWAYS kept. */
  error?: string;
  /** French non-fatal note (original kept / already gone). */
  warning?: string;
}

/**
 * Protects ONE source path in place. Never throws for expected failures —
 * returns a per-item French outcome. Sequencing contract (identical spirit
 * to performMoveIntoVault): nothing destructive before the staged container
 * is written AND verified; the original is touched ONLY after the container
 * carries its final name.
 */
export async function performProtectInPlace(
  deps: ProtectDeps,
  req: ProtectRequest,
  onProgress?: BoxProgress
): Promise<ProtectOutcome> {
  const sourcePath = path.resolve(req.sourcePath);
  const fail = (error: string): ProtectOutcome => ({
    sourcePath,
    ok: false,
    originalDeleted: false,
    error,
  });

  // ── 1. Validate the source (lstat — symlinks refused, never followed) ──
  let st;
  try {
    st = await lstat(sourcePath);
  } catch {
    return fail(ERR_PROTECT_SOURCE_MISSING);
  }
  if (st.isSymbolicLink()) return fail(ERR_PROTECT_SYMLINK);
  let kind: BoxKind;
  if (st.isFile()) kind = BOX_KIND_FILE;
  else if (st.isDirectory()) kind = BOX_KIND_FOLDER;
  else return fail(ERR_PROTECT_KIND);

  // ── 2. Destination + collision-proof container name ────────────────────
  const destDir = req.destDir ? path.resolve(req.destDir) : path.dirname(sourcePath);
  if (
    kind === BOX_KIND_FOLDER &&
    (destDir === sourcePath || destDir.startsWith(sourcePath + path.sep))
  ) {
    // Packing a folder into itself would tar the staging file — and with
    // deleteOriginal, secure-delete the folder holding the fresh container.
    return fail(ERR_PROTECT_DEST_INSIDE_SOURCE);
  }
  let destPath: string;
  try {
    await mkdir(destDir, { recursive: true });
    destPath = await suffixedContainerPath(destDir, path.basename(sourcePath));
  } catch (err) {
    return fail(err instanceof Error ? err.message : ERR_PROTECT_FINALIZE);
  }

  // Staging lives IN the destination dir → same volume → atomic rename.
  const stagedPath = `${destPath}.staging-${randomBytes(6).toString('hex')}`;
  let key: Buffer | undefined;
  try {
    try {
      key = await deps.getWriteKey();
    } catch (err) {
      return fail(err instanceof Error ? err.message : ERR_BOX_LOCKED);
    }

    // ── 3. Pack into the staging file (source hashed BEFORE encryption;
    //       folder caps + ustar limits enforced by the scan inside) ───────
    let pack: PackContainerResult;
    try {
      pack =
        kind === BOX_KIND_FILE
          ? await packFileContainer(key, sourcePath, stagedPath, onProgress)
          : await packFolderContainer(key, sourcePath, stagedPath, onProgress);
    } catch (err) {
      // pack* already unlinked its own partial staging file.
      return fail(err instanceof Error ? err.message : ERR_PROTECT_FINALIZE);
    }

    if (deps.onStaged) {
      await deps.onStaged(stagedPath);
    }

    // ── 4. VERIFY before anything destructive (re-parse + GCM-verified
    //       payload hash === pre-encryption source/tar hash) ──────────────
    const verified = await verifyContainerHash(key, stagedPath, pack.sourceSha256Hex);
    if (!verified) {
      await unlink(stagedPath).catch(() => undefined);
      return fail(ERR_PROTECT_VERIFY);
    }

    // ── 5. Finalize (same-volume rename, AV/OneDrive retry) ──────────────
    try {
      await renameWithRetries(stagedPath, destPath);
    } catch {
      await unlink(stagedPath).catch(() => undefined);
      return fail(ERR_PROTECT_FINALIZE);
    }

    // ── 6. Success — ONLY NOW touch the original ─────────────────────────
    const outcome: ProtectOutcome = {
      sourcePath,
      ok: true,
      boxPath: destPath,
      kind,
      name: pack.metadata.name,
      size: pack.metadata.size,
      originalDeleted: false,
      ...(pack.skippedSymlinks !== undefined && pack.skippedSymlinks > 0
        ? { skippedSymlinks: pack.skippedSymlinks }
        : {}),
    };
    if (req.deleteOriginal) {
      const stillThere = await lstat(sourcePath).then(() => true, () => false);
      if (!stillThere) {
        outcome.warning = NOTE_ORIGINAL_GONE;
        return outcome;
      }
      try {
        if (kind === BOX_KIND_FILE) {
          await deps.secureDeleteFile(sourcePath);
        } else {
          await deps.secureDeleteDir(sourcePath);
        }
        outcome.originalDeleted = true;
      } catch {
        outcome.warning = WARN_ORIGINAL_KEPT;
      }
    }
    return outcome;
  } finally {
    if (key) key.fill(0);
  }
}

// ── Rewrite-on-save (edit watcher over an opened single-file container) ─────

/**
 * Rebuilds the whole container from the edited plaintext temp copy into a
 * sibling staging file, verifies it decrypts back to the temp bytes, then
 * renames it over the box (retries for AV locks). The previous container
 * version survives any failure. The caller serializes concurrent rewrites
 * per boxPath.
 */
export async function rewriteFileContainer(
  key: Buffer,
  boxPath: string,
  editedPlainPath: string,
  name: string
): Promise<void> {
  const stagedPath = `${boxPath}.staging-${randomBytes(6).toString('hex')}`;
  try {
    const pack = await packFileContainer(key, editedPlainPath, stagedPath, undefined, {
      nameOverride: name,
    });
    const verified = await verifyContainerHash(key, stagedPath, pack.sourceSha256Hex);
    if (!verified) {
      throw new Error(ERR_PROTECT_VERIFY);
    }
    await renameWithRetries(stagedPath, boxPath);
  } catch (err) {
    await unlink(stagedPath).catch(() => undefined);
    throw err;
  }
}

// ── Extract-all + déprotéger ────────────────────────────────────────────────

/**
 * Rebuilds a FOLDER container's whole tree under destRoot (which must exist):
 * directory entries recreate empty folders; file bytes are streamed in 8 MiB
 * authenticated slices (flat memory). Walks the tar index ONCE. Every entry
 * path is traversal-checked before any write.
 */
export async function extractAllEntries(
  keyInput: BoxKeyInput,
  boxPath: string,
  destRoot: string
): Promise<{ fileCount: number }> {
  const { header, key } = await readContainerMetadata(keyInput, boxPath);
  if (header.kind !== BOX_KIND_FOLDER) {
    throw new Error(ERR_BOX_NOT_A_FOLDER_BOX);
  }
  const reader = await V3FileReader.open(key, boxPath, { baseOffset: header.payloadOffset });
  try {
    const index = await walkTarIndex((offset, length) => reader.read(offset, length), header.payloadSize);
    for (const entry of index) {
      if (!isSafeEntryPath(entry.path)) {
        throw new Error(ERR_ENTRY_PATH_UNSAFE);
      }
    }
    let fileCount = 0;
    for (const entry of index) {
      const abs = path.join(destRoot, ...entry.path.split('/'));
      if (entry.isDir) {
        await mkdir(abs, { recursive: true });
        continue;
      }
      await mkdir(path.dirname(abs), { recursive: true });
      const out = await open(abs, 'wx');
      let ok = false;
      try {
        let position = 0;
        while (position < entry.size) {
          const want = Math.min(EXTRACT_SLICE, entry.size - position);
          const slice = await reader.read(entry.offset + position, want);
          if (slice.length !== want) {
            throw new Error(ERR_BOX_CORRUPT);
          }
          await out.write(slice, 0, want, position);
          position += want;
        }
        ok = true;
      } finally {
        await out.close().catch(() => undefined);
        if (!ok) {
          await unlink(abs).catch(() => undefined);
        }
      }
      fileCount += 1;
    }
    return { fileCount };
  } finally {
    await reader.close();
  }
}

export interface UnprotectResult {
  restoredPath: string;
  kind: BoxKind;
  metadata: BoxMetadata;
}

/**
 * "Déprotéger" — restores the plaintext next to the container, then removes
 * the `.filarr` (plain unlink: it is ciphertext, no secure delete needed).
 *
 *  - FILE container: decrypted to a sibling staging file, the WRITTEN bytes
 *    are re-hashed and compared to the container's GCM-verified payload hash,
 *    then renamed to a collision-free "<name>" — any failure keeps the
 *    container and removes the partial restore.
 *  - FOLDER container: the tree is rebuilt under a collision-free
 *    "<name>" directory (every byte comes from GCM-verified chunks); a
 *    mid-extraction failure removes the partial tree and keeps the container.
 */
export async function unprotectContainer(
  keyInput: BoxKeyInput,
  boxPath: string
): Promise<UnprotectResult> {
  const resolvedBox = path.resolve(boxPath);
  const dir = path.dirname(resolvedBox);
  const { header, metadata, key } = await readContainerMetadata(keyInput, resolvedBox);

  if (header.kind === BOX_KIND_FILE) {
    const destPath = await suffixedPlainPath(dir, metadata.name);
    const stagedPath = `${destPath}.restore-${randomBytes(6).toString('hex')}`;
    try {
      await decryptFileToFileV3(key, resolvedBox, stagedPath, undefined, {
        baseOffset: header.payloadOffset,
      });
      const writtenHash = await sha256FileHex(stagedPath);
      const boxHash = await hashContainerPlaintextHex(key, resolvedBox);
      if (writtenHash !== boxHash) {
        throw new Error(ERR_UNPROTECT_VERIFY);
      }
      await renameWithRetries(stagedPath, destPath);
    } catch (err) {
      await unlink(stagedPath).catch(() => undefined);
      throw err;
    }
    await rm(resolvedBox, { force: true });
    return { restoredPath: destPath, kind: BOX_KIND_FILE, metadata };
  }

  const destRoot = await suffixedPlainPath(dir, metadata.name);
  await mkdir(destRoot, { recursive: true });
  try {
    await extractAllEntries(key, resolvedBox, destRoot);
  } catch (err) {
    // Partial plaintext tree we just created — never "the original": plain
    // removal is safe, and the container stays intact.
    await rm(destRoot, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
  await rm(resolvedBox, { force: true });
  return { restoredPath: destRoot, kind: BOX_KIND_FOLDER, metadata };
}
