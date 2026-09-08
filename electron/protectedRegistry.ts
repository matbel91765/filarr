/**
 * protectedRegistry.ts — « Mes fichiers protégés » persistence (Wave 2).
 *
 * ADVISORY-ONLY registry of the `.filarr` protected containers this profile
 * knows about: containers are fully self-contained, a moved/renamed box
 * still opens by double-click, and losing this file loses nothing but the
 * list. Because entries carry real OS paths + original names, the file is
 * stored ENCRYPTED (deps-injected StorageService envelope — same as folder
 * metadata.json) at `<activeProfileDataDir>/protected_items.json`, so each
 * profile (including a decoy) only ever sees its own list.
 *
 * All operations run through a single promise-chain mutex (read-modify-write
 * races between IPC handlers would otherwise drop entries). Pure Node,
 * deps-injected — harness-testable with an identity cipher.
 */

import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

/** Matches the renderer contract (filarrBoxBridge.ProtectedRegistryEntry). */
export interface ProtectedRegistryEntry {
  id: string;
  /** Absolute OS path of the `.filarr` container. */
  boxPath: string;
  /** 0 = single file, 1 = folder container. */
  kind: 0 | 1;
  /** Original basename recorded in the container metadata. */
  name: string;
  /** Plaintext size (files) / tar size (folders). */
  size: number;
  /** ISO-8601 — when the item was protected. */
  createdAt: string;
  /** ISO-8601 — refreshed on every successful open. */
  lastOpenedAt?: string;
}

export interface ProtectedRegistryDeps {
  /** Current registry file (profile-scoped — re-evaluated on EVERY operation). */
  getFilePath(): string;
  /** Encrypts the serialized registry (StorageService.encryptBinary). */
  encrypt(plain: Buffer): Promise<Buffer>;
  /** Decrypts the on-disk registry (StorageService.decryptBinary). */
  decrypt(blob: Buffer): Promise<Buffer>;
  /** Optional logger for non-fatal load failures (advisory data). */
  warn?(message: string, error?: unknown): void;
}

export interface UpsertInput {
  boxPath: string;
  kind: 0 | 1;
  name: string;
  size: number;
  /** Defaults to now for new entries; existing entries keep theirs. */
  createdAt?: string;
  /** Set to refresh the last-opened stamp. */
  lastOpenedAt?: string;
}

interface RegistryFile {
  v: 1;
  items: ProtectedRegistryEntry[];
}

function isValidEntry(raw: unknown): raw is ProtectedRegistryEntry {
  const e = raw as Partial<ProtectedRegistryEntry> | null;
  return (
    !!e &&
    typeof e.id === 'string' &&
    typeof e.boxPath === 'string' &&
    e.boxPath.length > 0 &&
    (e.kind === 0 || e.kind === 1) &&
    typeof e.name === 'string' &&
    typeof e.size === 'number' &&
    typeof e.createdAt === 'string' &&
    (e.lastOpenedAt === undefined || typeof e.lastOpenedAt === 'string')
  );
}

export class ProtectedRegistry {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: ProtectedRegistryDeps) {}

  /** Serializes every read-modify-write on the single promise chain. */
  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task);
    // Failures must not poison the chain for later operations.
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async load(): Promise<ProtectedRegistryEntry[]> {
    const filePath = this.deps.getFilePath();
    let blob: Buffer;
    try {
      blob = await readFile(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
      this.deps.warn?.('[protectedRegistry] read failed', err);
      return [];
    }
    try {
      const plain = await this.deps.decrypt(blob);
      const parsed = JSON.parse(plain.toString('utf8')) as Partial<RegistryFile>;
      if (parsed?.v !== 1 || !Array.isArray(parsed.items)) return [];
      return parsed.items.filter(isValidEntry);
    } catch (err) {
      // Advisory registry: a corrupt/undecryptable file must never block the
      // feature — containers remain openable by double-click.
      this.deps.warn?.('[protectedRegistry] decrypt/parse failed — starting empty', err);
      return [];
    }
  }

  private async save(items: ProtectedRegistryEntry[]): Promise<void> {
    const filePath = this.deps.getFilePath();
    await mkdir(path.dirname(filePath), { recursive: true });
    const payload: RegistryFile = { v: 1, items };
    const encrypted = await this.deps.encrypt(Buffer.from(JSON.stringify(payload), 'utf8'));
    const tmpPath = `${filePath}.tmp-${randomBytes(4).toString('hex')}`;
    try {
      await writeFile(tmpPath, encrypted);
      await rename(tmpPath, filePath);
    } catch (err) {
      await unlink(tmpPath).catch(() => undefined);
      throw err;
    }
  }

  /** Current entries (newest-first by createdAt). */
  list(): Promise<ProtectedRegistryEntry[]> {
    return this.run(async () => {
      const items = await this.load();
      return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }

  /**
   * Adds or updates the entry for `boxPath` (protect success, opportunistic
   * registration on double-click open). Matching is by resolved path.
   */
  upsert(input: UpsertInput): Promise<ProtectedRegistryEntry> {
    return this.run(async () => {
      const items = await this.load();
      const boxPath = path.resolve(input.boxPath);
      const now = new Date().toISOString();
      const existing = items.find((e) => path.resolve(e.boxPath) === boxPath);
      if (existing) {
        existing.kind = input.kind;
        existing.name = input.name;
        existing.size = input.size;
        if (input.lastOpenedAt) existing.lastOpenedAt = input.lastOpenedAt;
        await this.save(items);
        return { ...existing };
      }
      const entry: ProtectedRegistryEntry = {
        id: randomUUID(),
        boxPath,
        kind: input.kind,
        name: input.name,
        size: input.size,
        createdAt: input.createdAt ?? now,
        ...(input.lastOpenedAt ? { lastOpenedAt: input.lastOpenedAt } : {}),
      };
      items.push(entry);
      await this.save(items);
      return { ...entry };
    });
  }

  /** Removes by id. Returns whether an entry was dropped. */
  remove(id: string): Promise<boolean> {
    return this.run(async () => {
      const items = await this.load();
      const next = items.filter((e) => e.id !== id);
      if (next.length === items.length) return false;
      await this.save(next);
      return true;
    });
  }

  /** Removes by container path (déprotéger). */
  removeByBoxPath(boxPath: string): Promise<boolean> {
    return this.run(async () => {
      const resolved = path.resolve(boxPath);
      const items = await this.load();
      const next = items.filter((e) => path.resolve(e.boxPath) !== resolved);
      if (next.length === items.length) return false;
      await this.save(next);
      return true;
    });
  }

  /** Re-points an entry to a new container path ("Localiser…"). */
  relocate(id: string, newBoxPath: string): Promise<ProtectedRegistryEntry | null> {
    return this.run(async () => {
      const items = await this.load();
      const entry = items.find((e) => e.id === id);
      if (!entry) return null;
      entry.boxPath = path.resolve(newBoxPath);
      await this.save(items);
      return { ...entry };
    });
  }
}
