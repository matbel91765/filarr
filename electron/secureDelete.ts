/**
 * Secure file deletion — Electron main process.
 *
 * Overwrites a file's contents with cryptographically random bytes and
 * fsyncs to disk before unlinking, so casual filesystem carving cannot
 * recover the previous payload from the unlinked sectors.
 *
 * Best-effort caveats:
 *   - SSDs with TRIM, copy-on-write filesystems (ReFS, BTRFS, APFS) and
 *     full-disk-encrypted volumes may remap writes — the original
 *     physical blocks are not guaranteed to be overwritten.
 *   - On classic HDDs with NTFS / ext4 the overwrite hits the same
 *     sectors and defeats common recovery tools.
 *   - If overwriting fails (file busy, permission denied, etc.) we fall
 *     back to a plain unlink so the deletion still happens.
 */
import * as fs from 'fs/promises';
import { Stats } from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';
import log from 'electron-log';

const CHUNK_SIZE = 256 * 1024;

/**
 * Overwrite a single file with random bytes, then unlink it.
 * No-ops silently if the file does not exist.
 * Symbolic links are unlinked without overwriting their target.
 */
/**
 * DÉLIER UN FICHIER QUE WINDOWS TIENT ENCORE.
 *
 * Sous Windows, un fichier ne se supprime pas tant qu'un descripteur reste
 * ouvert dessus : `unlink` répond `EPERM` (ou `EBUSY`). Le porteur du
 * descripteur est presque toujours nous-mêmes — une lecture qui vient de
 * finir, un antivirus qui inspecte le fichier fraîchement écrit — et il le
 * rend dans les millisecondes qui suivent.
 *
 * Trois tentatives espacées suffisent donc, et l'attente reste imperceptible.
 * Ce qui ne va pas, c'est de laisser remonter la première erreur : le vidage
 * de la corbeille s'arrêtait sur le premier fichier tenu, en journalisant
 * « Error permanently deleting item », et l'utilisateur retrouvait sa
 * corbeille pleine sans savoir pourquoi.
 *
 * On ne boucle PAS indéfiniment : un fichier réellement verrouillé par un
 * autre programme doit finir par lever, pour que l'appelant le dise.
 */
const ATTENTES_MS = [30, 120, 400];

async function unlinkTenace(filePath: string): Promise<void> {
  for (let essai = 0; ; essai += 1) {
    try {
      await fs.unlink(filePath);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') return;
      if ((code !== 'EPERM' && code !== 'EBUSY') || essai >= ATTENTES_MS.length) throw err;
      await new Promise((r) => setTimeout(r, ATTENTES_MS[essai]));
    }
  }
}

export async function secureDeleteFile(filePath: string): Promise<void> {
  let stat: Stats;
  try {
    stat = await fs.lstat(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return;
    throw err;
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    await unlinkTenace(filePath);
    return;
  }

  const size = stat.size;

  if (size > 0) {
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(filePath, 'r+');
      const buffer = Buffer.allocUnsafe(Math.min(CHUNK_SIZE, size));
      let written = 0;
      while (written < size) {
        const remaining = size - written;
        const chunk =
          remaining >= buffer.length ? buffer : buffer.subarray(0, remaining);
        crypto.randomFillSync(chunk);
        await handle.write(chunk, 0, chunk.length, written);
        written += chunk.length;
      }
      await handle.sync();
    } catch (err) {
      log.warn(
        `[secureDelete] overwrite failed for ${filePath}, falling back to plain unlink:`,
        err
      );
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch {
          /* ignore */
        }
      }
    }
  }

  await unlinkTenace(filePath);
}

/**
 * Recursively secure-delete a directory tree: every regular file is
 * overwritten before unlinking, then empty directories are removed.
 * No-ops silently if the directory does not exist.
 */
export async function secureDeleteDir(dirPath: string): Promise<void> {
  let stat: Stats;
  try {
    stat = await fs.lstat(dirPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return;
    throw err;
  }

  if (!stat.isDirectory()) {
    await secureDeleteFile(dirPath);
    return;
  }

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await secureDeleteDir(entryPath);
    } else {
      await secureDeleteFile(entryPath);
    }
  }

  try {
    await fs.rmdir(dirPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return;
    // Residual content we couldn't wipe — fall back to forced rm so the
    // directory still goes away.
    await fs.rm(dirPath, { recursive: true, force: true });
  }
}
