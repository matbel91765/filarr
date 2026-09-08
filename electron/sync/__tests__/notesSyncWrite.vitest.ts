/**
 * `downloadAndMergeNotes` — CE QUI DOIT NE JAMAIS ÊTRE ÉCRIT.
 *
 * Trois défauts sont verrouillés ici, tous constatés en revue :
 *  1. `notes.enc` local indéchiffrable : le code copiait l'original « au mieux »
 *     (`.catch(() => {})`) puis installait le distant par-dessus. Copie ratée =
 *     notes perdues sans recours. La sauvegarde est désormais BLOQUANTE.
 *  2. Une clé machine indisponible (coffre verrouillé, safeStorage pas prêt) se
 *     présente comme un déchiffrement raté. La traiter comme une corruption
 *     effaçait TOUTES les notes de l'appareil au profit du distant.
 *  3. Le manifeste publiait `checksum: <empreinte du fichier LOCAL>` avec le
 *     statut `synced` alors que rien n'avait été remonté : le nuage annonçait
 *     un objet inexistant et l'appareil suivant cassait sur « Checksum
 *     mismatch » en descendant les notes.
 *
 * Le chiffrement est remplacé par un container factice `FAKE:<sel>:<json>` —
 * seul compte ici le fait que deux scellements du MÊME contenu produisent des
 * OCTETS DIFFÉRENTS, exactement comme le sel aléatoire de StorageService.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as nodeCrypto from 'crypto';
import * as os from 'os';
import * as nodePath from 'path';

// ── Mocks (hissés) ──────────────────────────────────────────────────────────

const state = vi.hoisted(() => ({ failCopy: false }));

const storage = vi.hoisted(() => ({
  getBaseDir: vi.fn(),
  decrypt: vi.fn(),
  encryptToFile: vi.fn(),
}));

const r2 = vi.hoisted(() => ({
  downloadChunk: vi.fn(),
  uploadChunk: vi.fn(),
}));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    default: actual,
    // Seule dérivation : la copie de secours peut être forcée à l'échec.
    copyFile: async (src: string, dest: string) => {
      if (state.failCopy) {
        throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
      }
      return actual.copyFile(src, dest);
    },
  };
});

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  BrowserWindow: class {},
  net: {},
}));

vi.mock('electron-log', () => ({
  default: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  },
}));

vi.mock('../../storageService', () => ({ default: storage }));
vi.mock('../../profileManager', () => ({ default: { getManifest: () => ({ profiles: [] }) } }));
vi.mock('../../reminderScheduler', () => ({}));
vi.mock('../../authService', () => ({
  isAuthenticated: () => true,
  getMe: async () => null,
  authenticatedApiCall: async () => null,
}));

vi.mock('../multipartTransfer', () => ({
  streamingSha256: async (filePath: string) => {
    const fsp = await import('fs/promises');
    return nodeCrypto.createHash('sha256').update(await fsp.readFile(filePath)).digest('hex');
  },
}));

vi.mock('../syncR2Client', () => ({
  MULTIPART_THRESHOLD: 1_000_000_000,
  createDeltaTransport: () => ({}),
  downloadChunk: (...args: unknown[]) => r2.downloadChunk(...args),
  uploadChunk: (...args: unknown[]) => r2.uploadChunk(...args),
  getDeltaSyncCapability: async () => false,
  getDirectUploadCapability: async () => false,
  getStorageMode: async () => 'filarr',
  resetDirectCapabilityCache: () => undefined,
  isClearlyTransientError: () => false,
  markDirectUnavailable: () => undefined,
  abortDirectSession: async () => undefined,
  deleteFile: async () => undefined,
  recalculateStorage: async () => null,
  gcProfile: async () => null,
  getManifest: async () => ({ manifest: null, version: 0 }),
  putManifest: async () => 1,
  SyncConflictError: class SyncConflictError extends Error {},
  DirectUploadUnavailableError: class DirectUploadUnavailableError extends Error {},
  ByosSyncError: class ByosSyncError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'ByosSyncError';
      this.code = code;
    }
  },
}));

vi.mock('../syncQueue', () => ({
  enqueue: async () => undefined,
  dequeue: async () => [],
  getFailedItems: async () => [],
  getPendingCount: async () => 0,
  markSuccess: async () => undefined,
  markFailed: async () => undefined,
}));

vi.mock('../deltaSync', () => ({
  DeltaUnavailableError: class DeltaUnavailableError extends Error {},
  uploadDelta: async () => ({}),
  downloadDelta: async () => ({}),
}));

vi.mock('../deltaManifest', () => ({ DELTA_THRESHOLD: 64 * 1024 * 1024 }));

import * as fs from 'fs/promises';
import { downloadAndMergeNotes } from '../syncService';
import { NOTES_META_FILE_ID } from '../notesMergeCore';
import type { SyncFileEntry, SyncManifest } from '../syncManifest';
import { withNotesLock } from '../notesLock';

// ── Container factice ───────────────────────────────────────────────────────

type Payload = Record<string, unknown>;

/** Deux scellements du même contenu diffèrent — comme le sel de StorageService. */
function seal(payload: unknown): string {
  return `FAKE:${nodeCrypto.randomBytes(8).toString('hex')}:${JSON.stringify(payload)}`;
}

function unseal(container: string): Payload {
  if (!container.startsWith('FAKE:')) throw new Error('Unsupported state or unable to authenticate data');
  const json = container.slice(container.indexOf(':', 5) + 1);
  return JSON.parse(json) as Payload;
}

const sha256 = (data: string | Buffer): string =>
  nodeCrypto.createHash('sha256').update(data).digest('hex');

const note = (id: string, updatedAt: string): Payload => ({ id, title: id, updatedAt });

const payloadOf = (...notes: Payload[]): Payload => ({
  byId: Object.fromEntries(notes.map((n) => [n.id as string, n])),
  allIds: notes.map((n) => n.id as string),
});

// ── Décor ───────────────────────────────────────────────────────────────────

let dir: string;
let notesPath: string;
let localManifest: SyncManifest;

/** Sert `remoteBytes` comme unique morceau distant et rend l'entrée de manifeste. */
function serveRemote(remoteBytes: string): SyncFileEntry {
  const buf = Buffer.from(remoteBytes, 'utf-8');
  r2.downloadChunk.mockResolvedValue(buf);
  return {
    checksum: sha256(buf),
    size: buf.byteLength,
    updatedAt: '2026-08-03T10:00:00.000Z',
    syncedAt: '2026-08-03T10:00:00.000Z',
    chunks: ['chunk_0'],
    status: 'synced',
  };
}

const run = (remoteEntry: SyncFileEntry): Promise<void> =>
  downloadAndMergeNotes('p1', NOTES_META_FILE_ID, remoteEntry, localManifest);

/** Fichiers de secours déposés à côté de notes.enc. */
async function backups(): Promise<string[]> {
  const all = await fs.readdir(dir);
  return all.filter((f) => f.includes('.unreadable-'));
}

beforeEach(async () => {
  vi.clearAllMocks();
  state.failCopy = false;
  dir = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'filarr-notes-'));
  notesPath = nodePath.join(dir, 'notes.enc');
  localManifest = { version: 1, profileId: 'p1', lastSyncAt: '', files: {}, notes: {} };

  storage.getBaseDir.mockReturnValue(dir);
  storage.decrypt.mockImplementation(async (container: string) => unseal(container));
  storage.encryptToFile.mockImplementation(async (data: unknown, filePath: string) => {
    await fs.writeFile(filePath, seal(data), 'utf-8');
  });
  r2.uploadChunk.mockResolvedValue({ key: 'chunk_0' });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

// ── Refus d'écrire ──────────────────────────────────────────────────────────

describe('le local n’est jamais écrasé sans filet', () => {
  it('LE DÉFAUT : sauvegarde de secours impossible → aucune écriture, aucune entrée de manifeste', async () => {
    await fs.writeFile(notesPath, 'CE-NEST-PAS-UN-CONTAINER', 'utf-8');
    const remote = serveRemote(seal(payloadOf(note('distante', '2026-08-03T10:00:00.000Z'))));
    state.failCopy = true;

    await run(remote);

    // Le blob illisible est encore là, intact : c'est la seule copie du contenu.
    expect(await fs.readFile(notesPath, 'utf-8')).toBe('CE-NEST-PAS-UN-CONTAINER');
    expect(await backups()).toEqual([]);
    expect(localManifest.files[NOTES_META_FILE_ID]).toBeUndefined();
    expect(r2.uploadChunk).not.toHaveBeenCalled();
  });

  it('clé indisponible (transitoire) → rien n’est écrit et RIEN n’est mis de côté', async () => {
    const localBytes = seal(payloadOf(note('locale', '2026-08-02T10:00:00.000Z')));
    await fs.writeFile(notesPath, localBytes, 'utf-8');
    const remote = serveRemote(seal(payloadOf(note('distante', '2026-08-03T10:00:00.000Z'))));

    // Le distant se déchiffre (il vient d'être lu), le LOCAL bute sur la clé.
    storage.decrypt.mockImplementation(async (container: string) => {
      if (container === localBytes) {
        throw new Error('StorageService not initialized — encryption key not loaded');
      }
      return unseal(container);
    });

    await run(remote);

    expect(await fs.readFile(notesPath, 'utf-8')).toBe(localBytes);
    expect(await backups()).toEqual([]); // pas une corruption : rien à archiver
    expect(localManifest.files[NOTES_META_FILE_ID]).toBeUndefined();
  });

  it('corruption avérée + sauvegarde réussie → copie conservée, distant installé', async () => {
    await fs.writeFile(notesPath, 'CE-NEST-PAS-UN-CONTAINER', 'utf-8');
    const remoteBytes = seal(payloadOf(note('distante', '2026-08-03T10:00:00.000Z')));
    const remote = serveRemote(remoteBytes);

    await run(remote);

    expect(await fs.readFile(notesPath, 'utf-8')).toBe(remoteBytes);
    const kept = await backups();
    expect(kept).toHaveLength(1);
    expect(await fs.readFile(nodePath.join(dir, kept[0]), 'utf-8')).toBe('CE-NEST-PAS-UN-CONTAINER');
  });

  it('notes.enc modifié sous nos pieds (écrivain hors verrou) → écriture abandonnée', async () => {
    const localBytes = seal(payloadOf(note('locale', '2026-08-02T10:00:00.000Z')));
    await fs.writeFile(notesPath, localBytes, 'utf-8');
    const remote = serveRemote(seal(payloadOf(note('distante', '2026-08-03T10:00:00.000Z'))));

    // Un écrivain qui ignorerait le verrou glisse une frappe entre la lecture
    // du local et l'écriture de la fusion : elle serait effacée par l'union.
    const intercalee = seal(payloadOf(note('frappe', '2026-08-04T10:00:00.000Z')));
    storage.decrypt.mockImplementation(async (container: string) => {
      const payload = unseal(container);
      if (container === localBytes) await fs.writeFile(notesPath, intercalee, 'utf-8');
      return payload;
    });

    await run(remote);

    expect(await fs.readFile(notesPath, 'utf-8')).toBe(intercalee);
    expect(localManifest.files[NOTES_META_FILE_ID]).toBeUndefined();
    expect(r2.uploadChunk).not.toHaveBeenCalled();
  });
});

// ── Empreinte publiée ───────────────────────────────────────────────────────

describe('le manifeste n’annonce jamais une empreinte non remontée', () => {
  it('LE DÉFAUT : fusion convergente → empreinte, taille et morceaux viennent du DISTANT', async () => {
    // Même contenu des deux côtés, scellé deux fois → octets différents.
    const payload = payloadOf(note('a', '2026-08-02T10:00:00.000Z'));
    const localBytes = seal(payload);
    const remoteBytes = seal(payload);
    expect(localBytes).not.toBe(remoteBytes);

    await fs.writeFile(notesPath, localBytes, 'utf-8');
    const remote = serveRemote(remoteBytes);

    await run(remote);

    const entry = localManifest.files[NOTES_META_FILE_ID];
    expect(entry.status).toBe('synced');
    expect(entry.checksum).toBe(remote.checksum); // ← était sha256(localBytes)
    expect(entry.checksum).not.toBe(sha256(localBytes));
    expect(entry.size).toBe(remote.size);
    expect(entry.chunks).toEqual(['chunk_0']);
    expect(r2.uploadChunk).not.toHaveBeenCalled();

    // …et le disque porte bien l'objet du nuage, à l'octet près : sans cela le
    // scan local rouvrirait une remontée à chaque cycle sur un écart de sel.
    expect(await fs.readFile(notesPath, 'utf-8')).toBe(remoteBytes);
    expect(sha256(await fs.readFile(notesPath))).toBe(entry.checksum);
  });

  it('local absent → l’entrée décrit l’objet distant installé', async () => {
    const remoteBytes = seal(payloadOf(note('distante', '2026-08-03T10:00:00.000Z')));
    const remote = serveRemote(remoteBytes);

    await run(remote);

    const entry = localManifest.files[NOTES_META_FILE_ID];
    expect(entry.status).toBe('synced');
    expect(entry.checksum).toBe(remote.checksum);
    expect(await fs.readFile(notesPath, 'utf-8')).toBe(remoteBytes);
  });

  it('le local apporte du neuf → union scellée, remontée, empreinte du DISQUE', async () => {
    const localBytes = seal(payloadOf(note('locale', '2026-08-02T10:00:00.000Z')));
    await fs.writeFile(notesPath, localBytes, 'utf-8');
    const remote = serveRemote(seal(payloadOf(note('distante', '2026-08-03T10:00:00.000Z'))));

    await run(remote);

    // L'union porte les deux notes et part vers R2 dans le même cycle.
    const onDisk = unseal(await fs.readFile(notesPath, 'utf-8'));
    expect(Object.keys(onDisk.byId as Record<string, unknown>).sort()).toEqual(['distante', 'locale']);
    expect(r2.uploadChunk).toHaveBeenCalled();

    // Ici l'empreinte du disque est légitime : elle décrit ce qui vient d'être
    // envoyé (uploadFile la repose lui-même après succès).
    const entry = localManifest.files[NOTES_META_FILE_ID];
    expect(entry.checksum).toBe(sha256(await fs.readFile(notesPath)));
    expect(entry.status).toBe('synced');
  });

  it('une entrée locale restée en `conflict` retombe sur un statut sain après fusion', async () => {
    const localBytes = seal(payloadOf(note('a', '2026-08-02T10:00:00.000Z')));
    await fs.writeFile(notesPath, localBytes, 'utf-8');
    const remote = serveRemote(seal(payloadOf(note('a', '2026-08-02T10:00:00.000Z'))));
    localManifest.files[NOTES_META_FILE_ID] = { ...remote, status: 'conflict', localPath: 'notes.enc' };

    await run(remote);

    expect(localManifest.files[NOTES_META_FILE_ID].status).toBe('synced');
  });
});

// ── Copies de conflit ───────────────────────────────────────────────────────

describe('la version écrasée par l’horloge est conservée', () => {
  const T1 = '2026-08-01T10:00:00.000Z';
  const T2 = '2026-08-02T10:00:00.000Z';
  const T3 = '2026-08-03T10:00:00.000Z';
  const BASE_FILE = '.notes-merge-base.json';

  /** Ancêtre commun laissé par le cycle précédent (horloges seules). */
  async function seedBase(clocks: Record<string, number>): Promise<void> {
    await fs.writeFile(
      nodePath.join(dir, BASE_FILE),
      JSON.stringify({ notes: clocks, notebooks: {} }),
      'utf-8'
    );
  }

  const titled = (id: string, title: string, updatedAt: string): Payload => ({
    id,
    title,
    updatedAt,
  });

  const copies = (payload: Payload): Array<Record<string, unknown>> =>
    Object.values(payload.byId as Record<string, Record<string, unknown>>).filter(
      (n) => n.conflictOfId === 'a'
    );

  it('LE DÉFAUT : les deux côtés ont édité la même note → la perdante survit sur le disque', async () => {
    await fs.writeFile(notesPath, seal(payloadOf(titled('a', 'ma version', T2))), 'utf-8');
    await seedBase({ a: Date.parse(T1) });
    const remote = serveRemote(seal(payloadOf(titled('a', 'sa version', T3))));

    await run(remote);

    const onDisk = unseal(await fs.readFile(notesPath, 'utf-8'));
    const byId = onDisk.byId as Record<string, Record<string, unknown>>;
    expect(byId.a.title).toBe('sa version'); // la gagnante garde son id
    const kept = copies(onDisk);
    expect(kept).toHaveLength(1);
    expect(kept[0].title).toMatch(/^ma version \(⚠ \d{4}-\d{2}-\d{2}\)$/);
    expect(kept[0].id).not.toBe('a');
    expect(onDisk.allIds).toContain(kept[0].id);
    // La copie n'existe que chez nous : elle doit partir vers les autres.
    expect(r2.uploadChunk).toHaveBeenCalled();
    expect(localManifest.files[NOTES_META_FILE_ID].status).toBe('synced');
  });

  it('la copie PART sans que le verrou soit rendu — sinon une sauvegarde l’efface', async () => {
    // Entre la sortie du verrou et l'envoi, `notes:save` reconstruit le payload
    // ENTIER depuis Redux : si le renderer n'a pas rechargé, sa sauvegarde
    // efface la copie, et rien ne la refabrique (la base d'ancêtres vient
    // d'avancer). La remontée doit donc tenir dans la section critique.
    await fs.writeFile(notesPath, seal(payloadOf(titled('a', 'ma version', T2))), 'utf-8');
    await seedBase({ a: Date.parse(T1) });
    const remote = serveRemote(seal(payloadOf(titled('a', 'sa version', T3))));

    let verrouLibrePendantEnvoi: boolean | null = null;
    r2.uploadChunk.mockImplementation(async () => {
      let entre = false;
      // Surtout NE PAS attendre : si le verrou est tenu — ce qu'on exige — cet
      // envoi l'attendrait lui-même, pour toujours.
      void withNotesLock(async () => {
        entre = true;
      });
      for (let i = 0; i < 10; i++) await Promise.resolve();
      verrouLibrePendantEnvoi = entre;
      return { key: 'chunk_0' };
    });

    await run(remote);

    expect(r2.uploadChunk).toHaveBeenCalled();
    expect(verrouLibrePendantEnvoi).toBe(false);
    // Et l'entrée publiée n'est pas rétrogradée après coup par le chemin normal.
    expect(localManifest.files[NOTES_META_FILE_ID].status).toBe('synced');
  });

  it('sans copie de conflit, la remontée reste HORS du verrou (cas ordinaire)', async () => {
    // Tenir le verrou pendant chaque envoi bloquerait l'auto-save du renderer :
    // la section critique n'est étendue que pour ce qui n'existe nulle part
    // ailleurs.
    await fs.writeFile(notesPath, seal(payloadOf(note('local', T3))), 'utf-8');
    const remote = serveRemote(seal(payloadOf(note('distant', T2))));

    let verrouLibrePendantEnvoi: boolean | null = null;
    r2.uploadChunk.mockImplementation(async () => {
      let entre = false;
      void withNotesLock(async () => {
        entre = true;
      });
      for (let i = 0; i < 10; i++) await Promise.resolve();
      verrouLibrePendantEnvoi = entre;
      return { key: 'chunk_0' };
    });

    await run(remote);

    expect(r2.uploadChunk).toHaveBeenCalled();
    expect(verrouLibrePendantEnvoi).toBe(true);
  });

  it('LE PIÈGE : simple rattrapage (le local n’avait pas bougé) → aucune copie', async () => {
    await fs.writeFile(notesPath, seal(payloadOf(titled('a', 'ancêtre', T2))), 'utf-8');
    await seedBase({ a: Date.parse(T2) });
    const remote = serveRemote(seal(payloadOf(titled('a', 'édité ailleurs', T3))));

    await run(remote);

    const onDisk = unseal(await fs.readFile(notesPath, 'utf-8'));
    expect(Object.keys(onDisk.byId as Record<string, unknown>)).toEqual(['a']);
    expect(copies(onDisk)).toEqual([]);
  });

  it('premier cycle sans ancêtre connu : rien n’est fabriqué, la base est posée', async () => {
    await fs.writeFile(notesPath, seal(payloadOf(titled('a', 'ma version', T2))), 'utf-8');
    const remote = serveRemote(seal(payloadOf(titled('a', 'sa version', T3))));

    await run(remote);

    expect(copies(unseal(await fs.readFile(notesPath, 'utf-8')))).toEqual([]);
    const base = JSON.parse(await fs.readFile(nodePath.join(dir, BASE_FILE), 'utf-8')) as {
      notes: Record<string, number>;
    };
    expect(base.notes).toEqual({ a: Date.parse(T3) });
  });

  it('un accord postérieur à notre édition la disqualifie (elle est déjà au nuage)', async () => {
    // `synced` + `syncedAt` = ce notes.enc-là est bien parti. Une entrée dont
    // l'horloge précède cet instant n'a rien à sauver, même si la base est en
    // retard (nous avons poussé sans refusionner).
    await fs.writeFile(notesPath, seal(payloadOf(titled('a', 'ma version', T2))), 'utf-8');
    await seedBase({ a: Date.parse(T1) });
    const remote = serveRemote(seal(payloadOf(titled('a', 'sa version', T3))));
    localManifest.files[NOTES_META_FILE_ID] = {
      ...remote,
      localPath: 'notes.enc',
      status: 'synced',
      syncedAt: '2026-08-02T11:00:00.000Z', // après T2
    };

    await run(remote);

    expect(copies(unseal(await fs.readFile(notesPath, 'utf-8')))).toEqual([]);
  });
});

// ── Verrou ──────────────────────────────────────────────────────────────────

describe('verrou du blob de notes', () => {
  it('sérialise les sections critiques et survit à un échec', async () => {
    const trace: string[] = [];
    const task = (name: string) => async (): Promise<void> => {
      trace.push(`${name}:début`);
      await new Promise((r) => setTimeout(r, 5));
      trace.push(`${name}:fin`);
    };

    // Ordre d'entrée dans la file : a, puis la tâche qui jette, puis b.
    const premiere = withNotesLock(task('a'));
    const boum = withNotesLock(async () => {
      trace.push('boum:début');
      throw new Error('boum');
    });
    const seconde = withNotesLock(task('b'));

    await Promise.all([premiere, boum.catch(() => undefined), seconde]);

    expect(trace).toEqual(['a:début', 'a:fin', 'boum:début', 'b:début', 'b:fin']);
  });
});
