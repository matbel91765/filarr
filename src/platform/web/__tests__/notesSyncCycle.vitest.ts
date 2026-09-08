/**
 * Boucle de synchronisation des NOTES — cycle complet, de bout en bout.
 *
 * Deux patrons de panne verrouillés ici, tous deux vécus :
 *  1. le web n'envoyait RIEN (`meta:notes` jamais marqué en attente) et ne
 *     rapatriait qu'UNE fois (installation réservée au store local vide) : les
 *     notes écrites dans le navigateur y restaient prisonnières, et celles du
 *     desktop n'arrivaient plus jamais ;
 *  2. la reprise naïve — remplacer le blob local par le blob distant, ou
 *     pousser le blob local par-dessus le distant — efface l'un des deux côtés
 *     d'un coup, `notes.enc` étant écrit en ENTIER par chaque appareil.
 *
 * Réseau et stockage sont des doublures en mémoire ; la CRYPTO DES CONTENEURS
 * est réelle (containerCrypto), c'est elle qui prouve ce qui part vraiment.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { kv, idb, mocks, events, emits, writes, counters, scoped } = vi.hoisted(() => ({
  kv: new Map<string, unknown>(),
  idb: new Map<string, unknown>(),
  mocks: { apiFetch: vi.fn(), fetch: vi.fn() },
  events: [] as string[],
  /** Les mêmes émissions, avec leur charge — pour l'état visible du cycle. */
  emits: [] as Array<{ channel: string; args: unknown[] }>,
  writes: [] as string[],
  /** Lectures du manifeste : un cycle en fait deux (pull + remontée), pas quatre. */
  counters: { manifestGets: 0 },
  scoped: (pid: string, key: string) => `p:${pid}:${key}`,
}));

vi.mock('../webStore', () => ({
  getActiveProfileId: async () => 'p1',
  storeGet: async (key: string) => kv.get(scoped('p1', key)) ?? null,
  storePut: async (key: string, value: unknown) => {
    writes.push(key);
    kv.set(scoped('p1', key), value);
  },
  storeDelete: async (key: string) => {
    kv.delete(scoped('p1', key));
  },
  forProfile: (pid: string) => ({
    get: async (key: string) => kv.get(scoped(pid, key)) ?? null,
    put: async (key: string, value: unknown) => {
      writes.push(key);
      kv.set(scoped(pid, key), value);
    },
    delete: async (key: string) => {
      kv.delete(scoped(pid, key));
    },
  }),
}));

vi.mock('../idb', () => ({
  idbGet: async (key: string) => idb.get(key) ?? null,
  idbPut: async (key: string, value: unknown) => {
    idb.set(key, value);
  },
  idbDelete: async (key: string) => {
    idb.delete(key);
  },
  idbKeys: async () => [...idb.keys()],
}));

vi.mock('../webEventBus', () => ({
  emitWebEvent: (channel: string, ...args: unknown[]) => {
    events.push(channel);
    emits.push({ channel, args });
  },
}));

vi.mock('../webApiBase', () => ({
  registerSessionAccountHintProvider: () => undefined,
  resolveApiBase: () => 'https://api.test',
  getAccessToken: () => 'jeton-de-test',
  // Le cycle reclame un jeton FRAIS (webApiBase.ensureAccessToken) : le double en
  // rend un et ne renouvelle jamais — ces tests n'ont pas de session qui expire.
  ensureAccessToken: async () => 'jeton-de-test',
  refreshViaCookie: async () => false,
  apiFetch: mocks.apiFetch,
}));

const FEK = new Uint8Array(32).fill(7);

// Chiffrement FEK neutralisé : le blob local est son propre clair, ce test
// porte sur la FUSION, pas sur hybridCrypto (couvert ailleurs).
vi.mock('../../../services/auth/hybridCrypto', () => ({
  exportFEKRaw: async () => FEK,
  hasHybridKey: () => true,
  encryptFileContent: async (buf: ArrayBuffer) => new Uint8Array(buf),
  decryptFileContent: async (bytes: Uint8Array) =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
}));

import {
  decryptFekContainer,
  decryptMachineContainerText,
  encryptFekContainer,
  encryptMachineContainerText,
} from '../sync/containerCrypto';
import type { NotesMergeBase, NotesPayload } from '../sync/notesMerge';

const BASE = 'https://api.test';
const MACHINE_KEY = new Uint8Array(32).fill(3);
const MACHINE_KEY_B64 = btoa(String.fromCharCode(...MACHINE_KEY));
const NOTES_KEY = 'notes_enc';
const T1 = '2026-08-01T10:00:00.000Z';
const T2 = '2026-08-02T10:00:00.000Z';

type Json = Record<string, unknown>;

const jsonResponse = (status: number, body: Json) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
  body: { cancel: async () => undefined },
});

const binaryResponse = (bytes: Uint8Array) => ({
  status: 200,
  ok: true,
  arrayBuffer: async () =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
});

let readSync: typeof import('../sync/readSync');

const uploads: { notes: Uint8Array | null; manifest: Uint8Array | null } = {
  notes: null,
  manifest: null,
};

const note = (id: string, extra: Json = {}) => ({
  id,
  title: id,
  content: '',
  updatedAt: T1,
  ...extra,
});

const notesEntry = (size: number, checksum = 'peu-importe') => ({
  checksum,
  size,
  updatedAt: T1,
  syncedAt: T1,
  chunks: ['c0'],
  status: 'synced',
});

/** Même empreinte que le moteur (readSync.sha256HexBytes). */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  );
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Le manifeste tel qu'il PART sur le câble (ce que le desktop lira). */
async function pushedManifest(): Promise<Record<string, Json>> {
  if (!uploads.manifest) throw new Error('aucun manifeste poussé');
  const plain = await decryptFekContainer(uploads.manifest, FEK);
  return JSON.parse(new TextDecoder().decode(plain)) as Record<string, Json>;
}

/** Dépose le payload de notes LOCAL (clair, chiffrement FEK neutralisé). */
function seedLocalNotes(payload: NotesPayload): void {
  kv.set(scoped('p1', NOTES_KEY), new TextEncoder().encode(JSON.stringify(payload)));
}

/** Lit le payload de notes local tel qu'il est PERSISTÉ. */
function localNotes(): NotesPayload {
  const raw = kv.get(scoped('p1', NOTES_KEY)) as Uint8Array | undefined;
  if (!raw) throw new Error('aucun store de notes local');
  return JSON.parse(new TextDecoder().decode(raw)) as NotesPayload;
}

/**
 * `notesMergeVersion` = marqueur de capacité écrit par un desktop à jour. Sans
 * lui, la remontée des notes depuis le web est DÉSACTIVÉE (garde d'activation) :
 * tous les scénarios de remontée le posent, un test dédié vérifie son absence.
 */
async function cloudManifestBody(
  version: number,
  files: Json,
  extra: Json = { notesMergeVersion: 1 }
): Promise<Json> {
  const manifest = {
    version,
    profileId: 'p1',
    lastSyncAt: T1,
    files,
    notes: {},
    encryptionKey: MACHINE_KEY_B64,
    profileMeta: { id: 'p1', name: 'Nuage', avatarColor: '#111' },
    ...extra,
  };
  const sealed = await encryptFekContainer(new TextEncoder().encode(JSON.stringify(manifest)), FEK);
  return { success: true, data: { manifest: btoa(String.fromCharCode(...sealed)), version } };
}

/** Faux Worker : sert un manifeste avec `meta:notes` et le conteneur distant. */
async function serveCloud(
  remotePayload: NotesPayload | null,
  manifestExtra: Json = { notesMergeVersion: 1 }
): Promise<void> {
  const container = remotePayload
    ? new TextEncoder().encode(await encryptMachineContainerText(remotePayload, MACHINE_KEY))
    : null;
  const files: Json = container ? { 'meta:notes': notesEntry(container.byteLength) } : {};

  mocks.apiFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === '/sync/profiles') {
      return { status: 200, body: { success: true, data: { profiles: [] } } };
    }
    if (path === '/sync/presign/download') {
      return { status: 200, body: { success: true, data: { downloadUrl: '/dl-notes' } } };
    }
    if (path === '/sync/presign/upload') {
      return { status: 200, body: { success: true, data: { uploadUrl: '/up-blob', key: 'k1' } } };
    }
    if (path === '/sync/manifest/p1' && init?.method === 'PUT') {
      return {
        status: 200,
        body: { success: true, data: { uploadUrl: '/up-manifest', newVersion: 2 } },
      };
    }
    return { status: 404, body: { success: false, error: `route inattendue ${path}` } };
  });

  mocks.fetch.mockImplementation(
    async (url: string, init?: { method?: string; body?: ArrayBuffer }) => {
      if (url === `${BASE}/sync/manifest/p1` && !init?.method) {
        counters.manifestGets++;
        return jsonResponse(200, await cloudManifestBody(1, files, manifestExtra));
      }
      if (url === `${BASE}/dl-notes` && container) return binaryResponse(container);
      if (url === `${BASE}/up-blob`) {
        uploads.notes = new Uint8Array(init?.body as ArrayBuffer);
        return jsonResponse(200, { success: true, data: { key: 'k1' } });
      }
      if (url === `${BASE}/up-manifest`) {
        uploads.manifest = new Uint8Array(init?.body as ArrayBuffer);
        return jsonResponse(200, { success: true });
      }
      throw new Error(`URL inattendue ${url}`);
    }
  );
}

beforeEach(async () => {
  vi.resetModules();
  kv.clear();
  idb.clear();
  events.length = 0;
  emits.length = 0;
  writes.length = 0;
  counters.manifestGets = 0;
  uploads.notes = null;
  uploads.manifest = null;
  mocks.apiFetch.mockReset();
  mocks.fetch.mockReset();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', mocks.fetch);

  idb.set('profiles_manifest', {
    version: 1,
    activeProfileId: 'p1',
    profiles: [{ id: 'p1', name: 'Local', avatarColor: '#fff', isDefault: true, order: 0 }],
    maxProfiles: 10,
    migratedFromLegacy: true,
  });

  readSync = await import('../sync/readSync');
});

describe('cycle complet — le local et le distant se retrouvent tous les deux', () => {
  it('store local A + `meta:notes` distant B → union locale, une seule écriture, union poussée', async () => {
    seedLocalNotes({
      byId: { a: note('a', { title: 'web' }) },
      allIds: ['a'],
      templates: [{ id: 'tpl', name: 'modèle' }],
      notebooks: { carnet: { id: 'carnet', name: 'Recherche' } },
    });
    await serveCloud({
      byId: { b: note('b', { title: 'desktop' }), z: note('z', { deletedAt: T2 }) },
      allIds: ['b', 'z'],
      templates: [],
      notebooks: {},
    });

    const result = await readSync.pullFromCloud('p1');
    expect(result.state).toBe('idle');

    // 1. Le store local porte l'UNION — la tombstone distante comprise.
    const merged = localNotes();
    expect(Object.keys(merged.byId as Json).sort()).toEqual(['a', 'b', 'z']);
    expect(merged.allIds).toEqual(['a', 'b', 'z']);
    expect((merged.notebooks as Json).carnet).toBeDefined();
    expect(merged.templates).toHaveLength(1);

    // 2. UNE seule écriture du blob de notes (pas de réécriture en boucle),
    //    et le renderer a été prévenu de recharger.
    expect(writes.filter((k) => k === NOTES_KEY)).toHaveLength(1);
    expect(events).toContain('notes-updated');

    // 3. Ce qui PART : le conteneur clé machine que le desktop sait relire,
    //    porteur de l'union (et non du seul état local).
    expect(uploads.notes).not.toBeNull();
    const pushed = (await decryptMachineContainerText(
      new TextDecoder().decode(uploads.notes!),
      MACHINE_KEY
    )) as NotesPayload;
    expect(Object.keys(pushed.byId as Json).sort()).toEqual(['a', 'b', 'z']);
    expect((pushed.byId as Json).a).toMatchObject({ title: 'web' });
    expect((pushed.byId as Json).b).toMatchObject({ title: 'desktop' });

    // 4. Le manifeste réécrit référence bien l'entrée notes.
    expect(uploads.manifest).not.toBeNull();
    expect(result.pushed).toBe(1);

    // 5. Registre vidé : la remontée est acquittée, pas de push répété.
    expect(kv.get(scoped('p1', 'pending_uploads'))).toEqual({});
  }, 60_000);

  it('distant identique au local : aucune écriture, aucune remontée', async () => {
    const payload: NotesPayload = {
      byId: { a: note('a') },
      allIds: ['a'],
      templates: [],
      notebooks: {},
    };
    seedLocalNotes(payload);
    await serveCloud(JSON.parse(JSON.stringify(payload)) as NotesPayload);

    const result = await readSync.pullFromCloud('p1');
    expect(result.state).toBe('idle');
    expect(writes.filter((k) => k === NOTES_KEY)).toHaveLength(0);
    expect(events).not.toContain('notes-updated');
    expect(result.pushed).toBe(0);
    expect(uploads.notes).toBeNull();
  }, 60_000);

  it('store local absent : le distant est installé tel quel, sans remontée', async () => {
    await serveCloud({ byId: { b: note('b') }, allIds: ['b'], templates: [], notebooks: {} });

    const result = await readSync.pullFromCloud('p1');
    expect(result.state).toBe('idle');
    expect(Object.keys(localNotes().byId as Json)).toEqual(['b']);
    expect(writes.filter((k) => k === NOTES_KEY)).toHaveLength(1);
    expect(result.pushed).toBe(0); // rien de local à renvoyer
  }, 60_000);

  it('nuage sans entrée notes : le store local est marqué et poussé', async () => {
    seedLocalNotes({ byId: { a: note('a') }, allIds: ['a'], templates: [], notebooks: {} });
    await serveCloud(null);

    const result = await readSync.pullFromCloud('p1');
    expect(result.state).toBe('idle');
    expect(result.pushed).toBe(1);
    expect(writes.filter((k) => k === NOTES_KEY)).toHaveLength(0); // rien à fusionner
    const pushed = (await decryptMachineContainerText(
      new TextDecoder().decode(uploads.notes!),
      MACHINE_KEY
    )) as NotesPayload;
    expect(Object.keys(pushed.byId as Json)).toEqual(['a']);
  }, 60_000);

  it('remontée déjà en attente : le distant est quand même FUSIONNÉ avant le push', async () => {
    // Sans cette exemption, le push écraserait `notes.enc` côté nuage avec un
    // état local qui n'a jamais vu les notes de l'autre appareil.
    seedLocalNotes({ byId: { a: note('a') }, allIds: ['a'], templates: [], notebooks: {} });
    kv.set(scoped('p1', 'pending_uploads'), {
      'meta:notes': { kind: 'meta', folderId: 'notes', markedAt: T2 },
    });
    await serveCloud({ byId: { b: note('b') }, allIds: ['b'], templates: [], notebooks: {} });

    await readSync.pullFromCloud('p1');

    expect(Object.keys(localNotes().byId as Json).sort()).toEqual(['a', 'b']);
    const pushed = (await decryptMachineContainerText(
      new TextDecoder().decode(uploads.notes!),
      MACHINE_KEY
    )) as NotesPayload;
    expect(Object.keys(pushed.byId as Json).sort()).toEqual(['a', 'b']);
  }, 60_000);

  it('distant illisible : la remontée est DIFFÉRÉE, pas exécutée à l’aveugle', async () => {
    // Le chunk distant ne descend pas. Pousser quand même remplacerait
    // notes.enc côté nuage par un état qui n'a jamais vu les notes d'en face.
    seedLocalNotes({ byId: { a: note('a') }, allIds: ['a'], templates: [], notebooks: {} });
    kv.set(scoped('p1', 'pending_uploads'), {
      'meta:notes': { kind: 'meta', folderId: 'notes', markedAt: T2 },
    });
    await serveCloud({ byId: { b: note('b') }, allIds: ['b'], templates: [], notebooks: {} });
    mocks.apiFetch.mockImplementation(async (path: string) => {
      if (path === '/sync/profiles') {
        return { status: 200, body: { success: true, data: { profiles: [] } } };
      }
      if (path === '/sync/presign/download') {
        return { status: 200, body: { success: false, error: 'chunk indisponible' } };
      }
      return { status: 404, body: { success: false } };
    });

    const result = await readSync.pullFromCloud('p1');
    expect(result.state).toBe('idle');
    expect(uploads.notes).toBeNull();
    expect(result.pushed).toBe(0);
    // La marque SURVIT : le cycle suivant retentera lecture puis fusion.
    expect(kv.get(scoped('p1', 'pending_uploads'))).toHaveProperty('meta:notes');
    expect(writes.filter((k) => k === NOTES_KEY)).toHaveLength(0);
  }, 60_000);

  it('normalisation sans contenu distant : réécriture SANS réveiller le renderer', async () => {
    // `notes-updated` fait remplacer TOUT le store du renderer depuis le
    // disque : l'émettre pour un index nettoyé écrasait la frappe en cours.
    seedLocalNotes({
      byId: { a: note('a') },
      allIds: ['a', 'reference-morte'],
      templates: [],
      notebooks: {},
    });
    await serveCloud({ byId: { a: note('a') }, allIds: ['a'], templates: [], notebooks: {} });

    await readSync.pullFromCloud('p1');

    expect(localNotes().allIds).toEqual(['a']);
    expect(writes.filter((k) => k === NOTES_KEY)).toHaveLength(1);
    expect(events).not.toContain('notes-updated');
  }, 60_000);

  it('store local vide face à un notes.enc distant garni : la remontée est refusée', async () => {
    // Anomalie locale (un vrai vidage voyage en pierres tombales, cas couvert
    // plus bas). Mise en scène réaliste en deux cycles : le premier fusionne le
    // distant, le store local se vide ensuite tout seul, le second ne rapatrie
    // rien (manifeste inchangé) et doit refuser de pousser ce vide.
    await serveCloud({
      byId: { b: note('b', { content: 'x'.repeat(400) }) },
      allIds: ['b'],
      templates: [],
      notebooks: {},
    });
    await readSync.pullFromCloud('p1');
    expect(Object.keys(localNotes().byId as Json)).toEqual(['b']);

    seedLocalNotes({ byId: {}, allIds: [], templates: [], notebooks: {} });
    kv.set(scoped('p1', 'pending_uploads'), {
      'meta:notes': { kind: 'meta', folderId: 'notes', markedAt: T2 },
    });

    const result = await readSync.pullFromCloud('p1');
    expect(result.state).toBe('idle');
    expect(result.pushed).toBe(0);
    expect(uploads.notes).toBeNull();
    expect(uploads.manifest).toBeNull();
  }, 60_000);

  it('vidage VOULU (registre de purge couvrant le distant) : la remontée passe', async () => {
    // Symétrique du précédent : sans cette levée, l'utilisateur qui supprime
    // définitivement toutes ses notes sur le web ne les voit jamais disparaître
    // ailleurs — la garde anti-effacement retenait les purges pour toujours.
    const purgedAt = new Date(Date.now() - 60_000).toISOString();
    seedLocalNotes({
      byId: {},
      allIds: [],
      templates: [],
      notebooks: {},
      purged: { b: purgedAt, c: purgedAt },
    });
    await serveCloud({
      byId: { b: note('b', { content: 'x'.repeat(400) }), c: note('c') },
      allIds: ['b', 'c'],
      templates: [],
      notebooks: {},
    });

    const result = await readSync.pullFromCloud('p1');

    expect(result.state).toBe('idle');
    expect(result.pushed).toBe(1);
    const pushed = (await decryptMachineContainerText(
      new TextDecoder().decode(uploads.notes!),
      MACHINE_KEY
    )) as NotesPayload;
    expect(Object.keys(pushed.byId as Json)).toEqual([]);
    expect(pushed.purged).toEqual({ b: purgedAt, c: purgedAt });
  }, 60_000);
});

describe('fraîcheur de la remontée — ne jamais pousser par-dessus un manifeste non fusionné', () => {
  /** Sert un manifeste dont l'entrée notes change d'empreinte entre deux GET. */
  async function serveMovingCloud(remote: NotesPayload, secondChecksum: string): Promise<void> {
    await serveCloud(remote);
    const container = new TextEncoder().encode(
      await encryptMachineContainerText(remote, MACHINE_KEY)
    );
    const base = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation(
      async (url: string, init?: { method?: string; body?: ArrayBuffer }) => {
        if (url === `${BASE}/sync/manifest/p1` && !init?.method) {
          counters.manifestGets++;
          const checksum = counters.manifestGets === 1 ? 'peu-importe' : secondChecksum;
          return jsonResponse(
            200,
            await cloudManifestBody(1, {
              'meta:notes': notesEntry(container.byteLength, checksum),
            })
          );
        }
        return base(url, init);
      }
    );
  }

  it('`meta:notes` publié entre la fusion et la remontée : push différé, marque intacte', async () => {
    // Le pull fusionne la version V ; la remontée relit le manifeste et y
    // trouve V' > V. Pousser maintenant remplacerait notes.enc par un état qui
    // n'a jamais vu V' — exactement la perte que la fusion doit empêcher.
    seedLocalNotes({ byId: { a: note('a') }, allIds: ['a'], templates: [], notebooks: {} });
    kv.set(scoped('p1', 'pending_uploads'), {
      'meta:notes': { kind: 'meta', folderId: 'notes', markedAt: T2 },
    });
    await serveMovingCloud(
      { byId: { b: note('b') }, allIds: ['b'], templates: [], notebooks: {} },
      'un-autre-appareil-est-passe'
    );

    const result = await readSync.pullFromCloud('p1');

    expect(result.state).toBe('idle');
    expect(result.pushed).toBe(0);
    expect(uploads.notes).toBeNull();
    expect(uploads.manifest).toBeNull();
    // Le rapatriement, lui, a bien eu lieu : c'est la remontée qui attend.
    expect(Object.keys(localNotes().byId as Json).sort()).toEqual(['a', 'b']);
    // La marque SURVIT : le cycle suivant refusionnera puis poussera.
    expect(kv.get(scoped('p1', 'pending_uploads'))).toHaveProperty('meta:notes');
  }, 60_000);

  it('empreinte inchangée : la remontée part normalement', async () => {
    seedLocalNotes({ byId: { a: note('a') }, allIds: ['a'], templates: [], notebooks: {} });
    kv.set(scoped('p1', 'pending_uploads'), {
      'meta:notes': { kind: 'meta', folderId: 'notes', markedAt: T2 },
    });
    await serveMovingCloud(
      { byId: { b: note('b') }, allIds: ['b'], templates: [], notebooks: {} },
      'peu-importe'
    );

    const result = await readSync.pullFromCloud('p1');
    expect(result.pushed).toBe(1);
    expect(uploads.notes).not.toBeNull();
  }, 60_000);

  it('après NOTRE remontée, un cycle sans rapatriement peut pousser à nouveau', async () => {
    // L'empreinte de référence doit suivre notre propre écriture : sinon elle
    // reste celle de la fusion précédente, ne correspond plus au distant (que
    // nous venons de remplacer) et la remontée est refusée pour toujours.
    seedLocalNotes({ byId: { a: note('a') }, allIds: ['a'], templates: [], notebooks: {} });
    kv.set(scoped('p1', 'pending_uploads'), {
      'meta:notes': { kind: 'meta', folderId: 'notes', markedAt: T2 },
    });
    await serveCloud({ byId: { b: note('b') }, allIds: ['b'], templates: [], notebooks: {} });

    expect((await readSync.pullFromCloud('p1')).pushed).toBe(1);
    const notreConteneur = uploads.notes!;
    const notreEmpreinte = await sha256Hex(notreConteneur);

    // Le nuage sert désormais CE que nous avons poussé, à la version suivante
    // (celle que notre CAS a produite) : le cycle 2 ne rapatrie donc rien.
    uploads.notes = null;
    uploads.manifest = null;
    const files: Json = {
      'meta:notes': notesEntry(notreConteneur.byteLength, notreEmpreinte),
    };
    mocks.fetch.mockImplementation(
      async (url: string, init?: { method?: string; body?: ArrayBuffer }) => {
        if (url === `${BASE}/sync/manifest/p1` && !init?.method) {
          return jsonResponse(200, await cloudManifestBody(2, files));
        }
        if (url === `${BASE}/dl-notes`) return binaryResponse(notreConteneur);
        if (url === `${BASE}/up-blob`) {
          uploads.notes = new Uint8Array(init?.body as ArrayBuffer);
          return jsonResponse(200, { success: true, data: { key: 'k1' } });
        }
        if (url === `${BASE}/up-manifest`) {
          uploads.manifest = new Uint8Array(init?.body as ArrayBuffer);
          return jsonResponse(200, { success: true });
        }
        throw new Error(`URL inattendue ${url}`);
      }
    );
    kv.set(scoped('p1', 'pending_uploads'), {
      'meta:notes': { kind: 'meta', folderId: 'notes', markedAt: T2 },
    });

    const result = await readSync.pullFromCloud('p1');
    expect(result.notModified).toBe(true); // rien à rapatrier
    expect(result.pushed).toBe(1);
    expect(uploads.notes).not.toBeNull();
  }, 60_000);
});

describe('horloge de câble — `meta:notes` est daté de la REMONTÉE', () => {
  it('la marque peut être vieille : c’est l’instant du push qui date l’entrée', async () => {
    // La marque de `meta:notes` peut attendre des jours (garde de capacité,
    // distant non fusionné). Dater l'entrée de la marque ferait comparer au
    // desktop une horloge périmée — et perdre l'arbitrage face à sa version.
    kv.set(scoped('p1', 'folders'), {
      d1: { id: 'd1', name: 'Dossier', items: [], __fromCloud: true },
    });
    // Distant IDENTIQUE au local : la fusion ne repose aucune marque, celle du
    // registre garde donc son âge — le cas même que la garde de capacité et le
    // report de remontée produisent en vrai.
    const payload: NotesPayload = {
      byId: { a: note('a') },
      allIds: ['a'],
      templates: [],
      notebooks: {},
    };
    seedLocalNotes(payload);
    kv.set(scoped('p1', 'pending_uploads'), {
      'meta:notes': { kind: 'meta', folderId: 'notes', markedAt: T2 },
      'meta:d1': { kind: 'meta', folderId: 'd1', markedAt: T2 },
    });
    await serveCloud(JSON.parse(JSON.stringify(payload)) as NotesPayload);

    await readSync.pullFromCloud('p1');

    const files = (await pushedManifest()).files as Record<string, { updatedAt: string }>;
    expect(Date.parse(files['meta:notes'].updatedAt)).toBeGreaterThan(Date.parse(T2));
    expect(Date.now() - Date.parse(files['meta:notes'].updatedAt)).toBeLessThan(60_000);
    // Pour un dossier, la marque DATE la modification : elle reste juste.
    expect(files['meta:d1'].updatedAt).toBe(T2);
  }, 60_000);
});

describe('état visible du cycle — l’interface doit savoir qu’il se passe quelque chose', () => {
  /** Les seuls statuts émis, dans l'ordre. */
  const statuts = () =>
    emits.filter((e) => e.channel === 'sync-status-changed').map((e) => e.args[0] as Json);

  it('annonce « en cours » AVANT de travailler, puis le repos', async () => {
    // Sans l'annonce d'entrée, un clic sur « Synchroniser » ne changeait
    // strictement rien à l'écran tant que le cycle durait : le bouton passait
    // pour mort. Le desktop l'annonce depuis toujours (syncService.ts:525-532).
    seedLocalNotes({ byId: { a: note('a') }, allIds: ['a'], templates: [], notebooks: {} });
    await serveCloud({ byId: { b: note('b') }, allIds: ['b'], templates: [], notebooks: {} });

    await readSync.pullFromCloud('p1');

    const vus = statuts();
    expect(vus[0]).toEqual({ state: 'syncing' });
    expect(vus[vus.length - 1]).toMatchObject({ state: 'idle' });
    expect(vus[vus.length - 1].lastSyncAt).toEqual(expect.any(String));
  }, 60_000);

  it('un cycle qui ÉCHOUE le dit aussi, ET DIT POURQUOI', async () => {
    // Sans la RAISON, un échec de cycle automatique (qui n'affiche aucune
    // bulle) laissait un bouton rouge muet : rien à l'écran ne disait ce qui
    // avait cassé. Le message voyage donc avec l'état, jusqu'à l'infobulle.
    seedLocalNotes({ byId: { a: note('a') }, allIds: ['a'], templates: [], notebooks: {} });
    await serveCloud(null);
    mocks.fetch.mockImplementation(async () => {
      throw new Error('réseau coupé');
    });

    const result = await readSync.pullFromCloud('p1');

    expect(result.state).toBe('error');
    expect(result.error).toContain('réseau coupé');
    expect(statuts()).toEqual([
      { state: 'syncing' },
      { state: 'error', error: expect.stringContaining('réseau coupé') },
    ]);
  }, 60_000);
});

describe('verrou de cycle — deux déclencheurs ne font pas deux cycles', () => {
  it('un appel concurrent REJOINT le cycle en vol', async () => {
    // « Synchroniser maintenant » pendant le cycle périodique : deux cycles
    // liraient le même manifeste, pousseraient deux fois et se battraient sur
    // le CAS.
    seedLocalNotes({ byId: { a: note('a') }, allIds: ['a'], templates: [], notebooks: {} });
    kv.set(scoped('p1', 'pending_uploads'), {
      'meta:notes': { kind: 'meta', folderId: 'notes', markedAt: T2 },
    });
    await serveCloud({ byId: { b: note('b') }, allIds: ['b'], templates: [], notebooks: {} });

    const [a, b] = await Promise.all([readSync.pullFromCloud('p1'), readSync.pullFromCloud('p1')]);

    expect(a).toBe(b); // le second n'a pas ouvert de cycle : il a rejoint
    expect(counters.manifestGets).toBe(2); // un pull + une remontée, pas quatre
    expect(readSync.isCycleInFlight()).toBe(false);
  }, 60_000);

  it('le verrou est relâché : un cycle ultérieur repart normalement', async () => {
    seedLocalNotes({ byId: { a: note('a') }, allIds: ['a'], templates: [], notebooks: {} });
    await serveCloud({ byId: { b: note('b') }, allIds: ['b'], templates: [], notebooks: {} });

    await readSync.pullFromCloud('p1');
    const apresPremier = counters.manifestGets;
    await readSync.pullFromCloud('p1');

    expect(counters.manifestGets).toBeGreaterThan(apresPremier);
  }, 60_000);
});

describe('pierres tombales rapatriées — le renderer est prévenu', () => {
  it('un registre `purged` distant réveille le renderer même sans note modifiée', async () => {
    // Sans cet événement, le store Redux n'a pas les pierres : sa prochaine
    // sauvegarde reconstruit le payload sans elles et les efface du disque —
    // les notes définitivement supprimées reviennent au cycle suivant.
    const purgedAt = new Date(Date.now() - 60_000).toISOString();
    seedLocalNotes({ byId: { a: note('a') }, allIds: ['a'], templates: [], notebooks: {} });
    await serveCloud({
      byId: { a: note('a') },
      allIds: ['a'],
      templates: [],
      notebooks: {},
      purged: { z: purgedAt },
    });

    await readSync.pullFromCloud('p1');

    expect(localNotes().purged).toEqual({ z: purgedAt });
    expect(events).toContain('notes-updated');
  }, 60_000);
});

describe('garde d’activation — la remontée attend un desktop à jour', () => {
  const marked = () => (kv.get(scoped('p1', 'pending_uploads')) as Json | undefined) ?? {};

  it('manifeste SANS `notesMergeVersion` : rien ne part, la marque survit, le pull fusionne', async () => {
    // Un desktop d'avant la fusion traite notes.enc en dernier-écrivain-gagne
    // au niveau du blob : notre remontée effacerait tout ce qu'il a écrit.
    seedLocalNotes({ byId: { a: note('a') }, allIds: ['a'], templates: [], notebooks: {} });
    kv.set(scoped('p1', 'pending_uploads'), {
      'meta:notes': { kind: 'meta', folderId: 'notes', markedAt: T2 },
    });
    await serveCloud({ byId: { b: note('b') }, allIds: ['b'], templates: [], notebooks: {} }, {});

    const result = await readSync.pullFromCloud('p1');

    expect(result.state).toBe('idle');
    expect(result.pushed).toBe(0);
    expect(uploads.notes).toBeNull();
    expect(uploads.manifest).toBeNull();
    // Le RAPATRIEMENT fusionnant, lui, reste actif : il ne met personne en danger.
    expect(Object.keys(localNotes().byId as Json).sort()).toEqual(['a', 'b']);
    // La marque attend un desktop à jour plutôt que d'être consommée.
    expect(marked()).toHaveProperty('meta:notes');
  }, 60_000);

  it('manifeste SANS marqueur et nuage sans entrée notes : le repli ne marque rien', async () => {
    seedLocalNotes({ byId: { a: note('a') }, allIds: ['a'], templates: [], notebooks: {} });
    await serveCloud(null, {});

    await readSync.pullFromCloud('p1');

    expect(marked()).toEqual({});
    expect(events).not.toContain('web:pending-marked');
  }, 60_000);

  it('marqueur PRÉSENT : la remontée repart normalement', async () => {
    seedLocalNotes({ byId: { a: note('a') }, allIds: ['a'], templates: [], notebooks: {} });
    kv.set(scoped('p1', 'pending_uploads'), {
      'meta:notes': { kind: 'meta', folderId: 'notes', markedAt: T2 },
    });
    await serveCloud({ byId: { b: note('b') }, allIds: ['b'], templates: [], notebooks: {} });

    const result = await readSync.pullFromCloud('p1');

    expect(result.pushed).toBe(1);
    expect(uploads.notes).not.toBeNull();
    expect(marked()).toEqual({});
  }, 60_000);

  it('le repli « nuage sans entrée notes » ne marque QU’UNE fois par session', async () => {
    // Sans ce garde, chaque pull remarquait la ressource → `web:pending-marked`
    // → cycle complet 10 s plus tard, en boucle chaude perpétuelle.
    seedLocalNotes({ byId: { a: note('a') }, allIds: ['a'], templates: [], notebooks: {} });
    await serveCloud(null);

    await readSync.pullFromCloud('p1');
    await readSync.pullFromCloud('p1');

    expect(events.filter((e) => e === 'web:pending-marked')).toHaveLength(1);
  }, 60_000);
});

describe('acquittement par markedAt — la dernière modification n’est pas perdue', () => {
  it('ressource remarquée PENDANT le push : la nouvelle marque survit', async () => {
    seedLocalNotes({ byId: { a: note('a') }, allIds: ['a'], templates: [], notebooks: {} });
    await serveCloud({ byId: { b: note('b') }, allIds: ['b'], templates: [], notebooks: {} });

    // Une sauvegarde du renderer arrive pendant l'upload du conteneur : elle
    // repose une marque NEUVE. L'acquittement aveugle l'effaçait, et cette
    // modification-là n'était jamais remontée.
    const base = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation(
      async (url: string, init?: { method?: string; body?: ArrayBuffer }) => {
        if (url === `${BASE}/up-blob`) {
          kv.set(scoped('p1', 'pending_uploads'), {
            'meta:notes': { kind: 'meta', folderId: 'notes', markedAt: T2 },
          });
        }
        return base(url, init);
      }
    );

    const result = await readSync.pullFromCloud('p1');

    expect(result.pushed).toBe(1);
    expect(uploads.notes).not.toBeNull();
    expect(kv.get(scoped('p1', 'pending_uploads'))).toEqual({
      'meta:notes': { kind: 'meta', folderId: 'notes', markedAt: T2 },
    });
  }, 60_000);

  it('marque inchangée : l’entrée est bien acquittée (pas de push répété)', async () => {
    seedLocalNotes({ byId: { a: note('a') }, allIds: ['a'], templates: [], notebooks: {} });
    kv.set(scoped('p1', 'pending_uploads'), {
      'meta:notes': { kind: 'meta', folderId: 'notes', markedAt: T2 },
    });
    await serveCloud({ byId: { b: note('b') }, allIds: ['b'], templates: [], notebooks: {} });

    await readSync.pullFromCloud('p1');

    expect(kv.get(scoped('p1', 'pending_uploads'))).toEqual({});
  }, 60_000);
});

describe('copies de conflit — le contenu écrasé reste consultable', () => {
  const T3 = '2026-08-03T10:00:00.000Z';
  const BASE_KEY = 'notes_merge_base';

  /** Ancêtre commun connu du cycle précédent (horloges seules). */
  const seedBase = (clocks: Record<string, number>, agreedAt: number | null = null): void => {
    kv.set(scoped('p1', BASE_KEY), { agreedAt, clocks: { notes: clocks, notebooks: {} } });
  };

  const conflictCopies = (p: NotesPayload): Array<Record<string, unknown>> =>
    Object.values(p.byId as Record<string, Record<string, unknown>>).filter(
      (n) => n.conflictOfId === 'a'
    );

  it('LE DÉFAUT : les deux côtés ont édité la même note → la perdante survit et part', async () => {
    // Avant : l'horloge tranchait et « ma version » disparaissait sans trace,
    // là où un fichier ordinaire aurait eu sa copie `_conflict_<horodatage>`.
    seedLocalNotes({
      byId: { a: note('a', { title: 'ma version', content: 'écrit ici', updatedAt: T2 }) },
      allIds: ['a'],
      templates: [],
      notebooks: {},
    });
    seedBase({ a: Date.parse(T1) });
    await serveCloud({
      byId: { a: note('a', { title: 'sa version', content: 'écrit ailleurs', updatedAt: T3 }) },
      allIds: ['a'],
      templates: [],
      notebooks: {},
    });

    await readSync.pullFromCloud('p1');

    const merged = localNotes();
    const byId = merged.byId as Record<string, Record<string, unknown>>;
    expect(byId.a).toMatchObject({ title: 'sa version' }); // la gagnante reste sous son id
    const copies = conflictCopies(merged);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ content: 'écrit ici' });
    // Suffixe NEUTRE (l'app est EN/FR) : voir `conflictTitleSuffix`.
    expect(copies[0].title).toMatch(/^ma version \(⚠ \d{4}-\d{2}-\d{2}\)$/);
    expect(copies[0].id).not.toBe('a'); // id NEUF : la gagnante n'est pas écrasée
    expect(merged.allIds).toContain(copies[0].id); // indexée, donc visible
    expect(events).toContain('notes-updated'); // sinon la prochaine sauvegarde l'efface

    // Elle voyage comme n'importe quelle note : les autres appareils la verront.
    const pushed = (await decryptMachineContainerText(
      new TextDecoder().decode(uploads.notes!),
      MACHINE_KEY
    )) as NotesPayload;
    expect(conflictCopies(pushed)).toHaveLength(1);
  }, 60_000);

  it('LE PIÈGE : simple rattrapage (le local n’avait pas bougé) → aucune copie', async () => {
    // Cas le plus fréquent de tous : l'autre appareil édite, nous portions
    // l'ancêtre. Fabriquer une copie ici polluerait le carnet à CHAQUE
    // modification reçue.
    seedLocalNotes({
      byId: { a: note('a', { title: 'ancêtre', updatedAt: T2 }) },
      allIds: ['a'],
      templates: [],
      notebooks: {},
    });
    seedBase({ a: Date.parse(T2) });
    await serveCloud({
      byId: { a: note('a', { title: 'édité ailleurs', updatedAt: T3 }) },
      allIds: ['a'],
      templates: [],
      notebooks: {},
    });

    await readSync.pullFromCloud('p1');

    const merged = localNotes();
    expect(Object.keys(merged.byId as Json)).toEqual(['a']);
    expect(conflictCopies(merged)).toEqual([]);
  }, 60_000);

  it('contenus identiques : aucune copie, aucune écriture (rien n’a été écrasé)', async () => {
    const payload: NotesPayload = {
      byId: { a: note('a', { title: 'même', updatedAt: T2 }) },
      allIds: ['a'],
      templates: [],
      notebooks: {},
    };
    seedLocalNotes(payload);
    seedBase({ a: Date.parse(T1) }); // base « périmée » exprès
    await serveCloud(JSON.parse(JSON.stringify(payload)) as NotesPayload);

    await readSync.pullFromCloud('p1');

    expect(Object.keys(localNotes().byId as Json)).toEqual(['a']);
    expect(writes.filter((k) => k === NOTES_KEY)).toHaveLength(0);
  }, 60_000);

  it('premier cycle sans ancêtre connu : rien n’est fabriqué, la base est posée', async () => {
    seedLocalNotes({
      byId: { a: note('a', { title: 'ma version', updatedAt: T2 }) },
      allIds: ['a'],
      templates: [],
      notebooks: {},
    });
    await serveCloud({
      byId: { a: note('a', { title: 'sa version', updatedAt: T3 }) },
      allIds: ['a'],
      templates: [],
      notebooks: {},
    });

    await readSync.pullFromCloud('p1');

    expect(conflictCopies(localNotes())).toEqual([]);
    const base = kv.get(scoped('p1', BASE_KEY)) as { clocks: { notes: Record<string, number> } };
    expect(base.clocks.notes).toEqual({ a: Date.parse(T3) });
  }, 60_000);
});

describe('délais maximaux — aucun aller-retour du cycle ne peut rester pendu', () => {
  it('TOUT fetch du cycle porte une échéance (sinon le verrou reste fermé à vie)', async () => {
    // Un `fetch` sans `signal` n'expire jamais : un réseau qui décroche figeait
    // `_running` pour toujours, le meneur refusait tout travail et les suiveurs
    // attendaient un cycle que personne ne ferait plus — en silence total.
    seedLocalNotes({ byId: { a: note('a') }, allIds: ['a'], templates: [], notebooks: {} });
    kv.set(scoped('p1', 'pending_uploads'), {
      'meta:notes': { kind: 'meta', folderId: 'notes', markedAt: T2 },
    });
    await serveCloud({ byId: { b: note('b') }, allIds: ['b'], templates: [], notebooks: {} });

    const result = await readSync.pullFromCloud('p1');
    expect(result.pushed).toBe(1); // le cycle complet a bien tourné

    // GET manifeste, chunk descendant, chunk montant, PUT manifeste…
    const sansEcheance = mocks.fetch.mock.calls.filter(
      ([, init]) => !(init as { signal?: AbortSignal } | undefined)?.signal
    );
    expect(sansEcheance.map(([url]) => url)).toEqual([]);
    expect(mocks.fetch.mock.calls.length).toBeGreaterThanOrEqual(4);

    // …et les jetons de presign, qui passent par apiFetch.
    const apiSansEcheance = mocks.apiFetch.mock.calls.filter(
      ([, init]) => !(init as { signal?: AbortSignal } | undefined)?.signal
    );
    expect(apiSansEcheance.map(([path]) => path)).toEqual([]);
  }, 60_000);
});

describe('capacité de remontée — partagée avec les onglets SUIVEURS', () => {
  it('LE DÉFAUT : un onglet sans cycle refusait de marquer les notes écrites chez lui', async () => {
    // La carte de capacité est une variable de MODULE alimentée par le CYCLE.
    // Or seul le meneur cycle : dans tout autre onglet elle reste vide, la garde
    // de `notes:save` refusait donc toute marque et les notes y restaient
    // prisonnières — exactement la classe de bug qu'on venait de fermer.
    seedLocalNotes({ byId: { a: note('a') }, allIds: ['a'], templates: [], notebooks: {} });
    await serveCloud({ byId: { b: note('b') }, allIds: ['b'], templates: [], notebooks: {} });
    await readSync.pullFromCloud('p1');

    // Le meneur a déposé son verdict là où tout le monde peut le lire.
    expect(kv.get(scoped('p1', 'notes_merge_capability'))).toEqual({ version: 1 });

    // Un AUTRE onglet : instance neuve du module, donc mémoire vierge.
    vi.resetModules();
    const suiveur = await import('../sync/readSync');
    expect(await suiveur.isNotesPushAllowed()).toBe(true);
  }, 60_000);

  it('nuage sans marqueur : le verdict partagé refuse aussi', async () => {
    seedLocalNotes({ byId: { a: note('a') }, allIds: ['a'], templates: [], notebooks: {} });
    await serveCloud({ byId: { b: note('b') }, allIds: ['b'], templates: [], notebooks: {} }, {});
    await readSync.pullFromCloud('p1');

    vi.resetModules();
    const suiveur = await import('../sync/readSync');
    expect(await suiveur.isNotesPushAllowed()).toBe(false);
  }, 60_000);
});

describe('manifeste partagé — un suiveur sait ce que le nuage contient', () => {
  it('LE DÉFAUT : sans cycle local, tout fichier du nuage était « inexistant »', async () => {
    await serveCloud({ byId: { b: note('b') }, allIds: ['b'], templates: [], notebooks: {} });
    await readSync.pullFromCloud('p1');
    expect(kv.get(scoped('p1', 'cloud_manifest_enc'))).toBeInstanceOf(Uint8Array);

    // Onglet neuf : cache mémoire vide par construction.
    vi.resetModules();
    const suiveur = await import('../sync/readSync');
    const manifest = await suiveur.loadCachedManifest();
    expect(manifest?.files['meta:notes']).toBeDefined();
  }, 60_000);

  it('le dépôt est CHIFFRÉ : ni clé machine ni chemins en clair dans IndexedDB', async () => {
    await serveCloud({ byId: { b: note('b') }, allIds: ['b'], templates: [], notebooks: {} });
    await readSync.pullFromCloud('p1');

    const brut = new TextDecoder().decode(kv.get(scoped('p1', 'cloud_manifest_enc')) as Uint8Array);
    expect(brut).not.toContain(MACHINE_KEY_B64);
    expect(brut).not.toContain('meta:notes');
  }, 60_000);
});

describe('copie de conflit — durable AVANT d’avoir quitté le navigateur', () => {
  const T3 = '2026-08-03T10:00:00.000Z';

  it('LE DÉFAUT : une sauvegarde du renderer l’effaçait avant la remontée', async () => {
    // La copie n'existe que dans `notes_enc` tant qu'elle n'est pas poussée, et
    // le renderer reconstruit le payload ENTIER depuis Redux : s'il n'a pas
    // rechargé, sa sauvegarde suivante l'efface. Et rien ne la refabrique — la
    // base d'ancêtres vient d'avancer. La seule version perdante disparaissait.
    seedLocalNotes({
      byId: { a: note('a', { title: 'ma version', content: 'écrit ici', updatedAt: T2 }) },
      allIds: ['a'],
      templates: [],
      notebooks: {},
    });
    kv.set(scoped('p1', 'notes_merge_base'), {
      agreedAt: null,
      clocks: { notes: { a: Date.parse(T1) }, notebooks: {} },
    });
    await serveCloud({
      byId: { a: note('a', { title: 'sa version', content: 'écrit ailleurs', updatedAt: T3 }) },
      allIds: ['a'],
      templates: [],
      notebooks: {},
    });

    // SABOTAGE : dès que la fusion a écrit son blob, le renderer écrase le
    // store avec ce que Redux porte encore — sans la copie de conflit.
    const armed = { value: true };
    const original = kv.set.bind(kv);
    kv.set = ((key: string, value: unknown) => {
      const out = original(key, value);
      if (armed.value && key === scoped('p1', 'notes_enc')) {
        armed.value = false;
        original(
          key,
          new TextEncoder().encode(
            JSON.stringify({
              byId: { a: note('a', { title: 'sa version', updatedAt: T3 }) },
              allIds: ['a'],
              templates: [],
              notebooks: {},
            })
          )
        );
      }
      return out;
    }) as typeof kv.set;

    try {
      await readSync.pullFromCloud('p1');
    } finally {
      kv.set = original;
    }

    // Ce qui PART porte la copie : une fois dans le nuage, elle est récupérable
    // depuis n'importe quel appareil, même si ce navigateur la reperd.
    const pushed = (await decryptMachineContainerText(
      new TextDecoder().decode(uploads.notes!),
      MACHINE_KEY
    )) as NotesPayload;
    const copies = Object.values(pushed.byId as Record<string, Record<string, unknown>>).filter(
      (n) => n.conflictOfId === 'a'
    );
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ content: 'écrit ici' });

    // Et le store local la retrouve, avec un `notes-updated` pour le renderer.
    const locales = Object.values(localNotes().byId as Record<string, Record<string, unknown>>);
    expect(locales.filter((n) => n.conflictOfId === 'a')).toHaveLength(1);
    expect(events).toContain('notes-updated');
  }, 60_000);

  it('acquittée une fois dans le nuage : plus rien à réinjecter au cycle suivant', async () => {
    seedLocalNotes({
      byId: { a: note('a', { title: 'ma version', updatedAt: T2 }) },
      allIds: ['a'],
      templates: [],
      notebooks: {},
    });
    kv.set(scoped('p1', 'notes_merge_base'), {
      agreedAt: null,
      clocks: { notes: { a: Date.parse(T1) }, notebooks: {} },
    });
    await serveCloud({
      byId: { a: note('a', { title: 'sa version', updatedAt: T3 }) },
      allIds: ['a'],
      templates: [],
      notebooks: {},
    });

    await readSync.pullFromCloud('p1');

    expect(uploads.notes).not.toBeNull();
    // Le registre de sauvegarde est vidé : la copie est publiée.
    expect(kv.get(scoped('p1', 'notes_conflict_pending'))).toBeUndefined();
  }, 60_000);
});

describe('suppression définitive — elle ne ressuscite pas depuis le nuage', () => {
  it('la note purgée disparaît de l’union locale ET du conteneur poussé', async () => {
    // Horodatage RELATIF : une pierre en dur finirait par expirer (90 jours) et
    // ferait échouer ce test un jour de l'année prochaine.
    const purgedAt = new Date(Date.now() - 60_000).toISOString();
    seedLocalNotes({
      byId: { a: note('a') },
      allIds: ['a'],
      templates: [],
      notebooks: {},
      purged: { z: purgedAt },
    });
    await serveCloud({
      byId: { a: note('a'), z: note('z', { updatedAt: T1 }) },
      allIds: ['a', 'z'],
      templates: [],
      notebooks: {},
    });

    const result = await readSync.pullFromCloud('p1');
    expect(result.state).toBe('idle');

    // 1. Le nuage ne la fait pas revenir localement.
    expect(Object.keys(localNotes().byId as Json)).toEqual(['a']);
    expect(localNotes().allIds).toEqual(['a']);

    // 2. Ce qui PART porte la purge — et la pierre voyage avec, pour que
    //    l'autre appareil ne la repropose pas au cycle suivant.
    const pushed = (await decryptMachineContainerText(
      new TextDecoder().decode(uploads.notes!),
      MACHINE_KEY
    )) as NotesPayload;
    expect(Object.keys(pushed.byId as Json)).toEqual(['a']);
    expect(pushed.purged).toEqual({ z: purgedAt });
  }, 60_000);
});

describe('collaboration temps réel — une note en session ne se recopie jamais', () => {
  const T3 = '2026-08-03T10:00:00.000Z';
  const BASE_KEY = 'notes_merge_base';
  const LIVE_KEY = 'collab_live_notes';

  const seedBase = (clocks: Record<string, number>): void => {
    kv.set(scoped('p1', BASE_KEY), { agreedAt: null, clocks: { notes: clocks, notebooks: {} } });
  };

  const copies = (p: NotesPayload): Array<Record<string, unknown>> =>
    Object.values(p.byId as Record<string, Record<string, unknown>>).filter(
      (n) => n.conflictOfId === 'a'
    );

  /**
   * LE DÉFAUT VÉCU. Deux appareils écrivent la même note par le CRDT. Chacun
   * repose sa version dans `notes.enc` toutes les deux secondes, donc les DEUX
   * horloges ont bougé depuis le dernier accord et les deux contenus diffèrent :
   * la fusion voit une divergence franche. Et comme chacun est le dernier
   * écrivain CHEZ LUI, l'arbitrage donne le local gagnant —
   * `preserveLiveSessionNotes` n'a alors rien à rétablir. La garde d'origine
   * filtrant les copies sur SA liste, une copie de conflit naissait à chaque
   * cycle, portant le texte tapé à cet instant.
   */
  const collaborationEnCours = async (): Promise<void> => {
    seedLocalNotes({
      byId: { a: note('a', { title: '', content: 'frappe vue ici', updatedAt: T3 }) },
      allIds: ['a'],
      templates: [],
      notebooks: {},
    });
    seedBase({ a: Date.parse(T1) });
    await serveCloud({
      byId: { a: note('a', { title: '', content: 'frappe vue là-bas', updatedAt: T2 }) },
      allIds: ['a'],
      templates: [],
      notebooks: {},
    });
  };

  it('session dans CET onglet : aucune copie, la frappe locale reste', async () => {
    const registry = await import('../../../services/collab/liveNoteRegistry');
    registry.setLiveNotes(['a']);
    await collaborationEnCours();

    await readSync.pullFromCloud('p1');

    const merged = localNotes();
    expect(copies(merged)).toEqual([]);
    expect(Object.keys(merged.byId as Json)).toEqual(['a']);
    expect((merged.byId as Record<string, Json>).a).toMatchObject({ content: 'frappe vue ici' });
  }, 60_000);

  it('session dans un AUTRE onglet : l’instantané partagé suffit', async () => {
    // Le cycle ne tourne que chez l'onglet MENEUR ; la note peut être ouverte
    // dans un onglet voisin, qui écrit pourtant dans le même `notes_enc`.
    kv.set(scoped('p1', LIVE_KEY), { ids: ['a'], at: Date.now() });
    await collaborationEnCours();

    await readSync.pullFromCloud('p1');

    expect(copies(localNotes())).toEqual([]);
  }, 60_000);

  it('instantané PÉRIMÉ : l’arbitrage reprend ses droits (pas de gel éternel)', async () => {
    // Onglet mort en pleine édition : la garde doit s'effacer d'elle-même,
    // sinon la note ne serait plus jamais arbitrée.
    kv.set(scoped('p1', LIVE_KEY), { ids: ['a'], at: Date.now() - 10 * 60 * 1000 });
    await collaborationEnCours();

    await readSync.pullFromCloud('p1');

    expect(copies(localNotes())).toHaveLength(1);
  }, 60_000);

  it('aucune session : la même divergence fabrique bien sa copie (preuve du défaut)', async () => {
    await collaborationEnCours();

    await readSync.pullFromCloud('p1');

    const copiesFaites = copies(localNotes());
    expect(copiesFaites).toHaveLength(1);
    expect(copiesFaites[0]).toMatchObject({ content: 'frappe vue là-bas' });
  }, 60_000);

  it('cycle après cycle, la session ne laisse jamais s’accumuler de doublons', async () => {
    const registry = await import('../../../services/collab/liveNoteRegistry');
    registry.setLiveNotes(['a']);
    await collaborationEnCours();

    await readSync.pullFromCloud('p1');
    // Nouvelle frappe des deux côtés, comme à chaque tour de session.
    const encore = localNotes();
    (encore.byId as Record<string, Json>).a.content = 'frappe suivante';
    (encore.byId as Record<string, Json>).a.updatedAt = '2026-08-04T10:00:00.000Z';
    seedLocalNotes(encore);
    await readSync.pullFromCloud('p1');

    expect(copies(localNotes())).toEqual([]);
  }, 60_000);

  it('publishLiveNotesSnapshot dépose l’instantané que liront les autres onglets', async () => {
    await readSync.publishLiveNotesSnapshot(['a', 'b']);

    const stored = kv.get(scoped('p1', LIVE_KEY)) as { ids: string[]; at: number };
    expect(stored.ids).toEqual(['a', 'b']);
    expect(typeof stored.at).toBe('number');
  }, 60_000);
});

/**
 * LE SCÉNARIO VÉCU, joué en entier : on écrit dans ses notes SUR LE WEB pendant
 * que le desktop tourne et synchronise. Rien d'autre — une seule personne, une
 * seule note, une modification simplement propagée d'un appareil à l'autre.
 * AUCUNE copie de conflit ne doit naître de ça.
 *
 * CE QUE CETTE SUITE A ATTRAPÉ. La base d'ancêtres n'avait qu'UNE table pour les
 * deux côtés, remplie avec l'UNION que la fusion venait de sceller EN LOCAL. Dès
 * qu'un cycle fusionnait sans remonter — et la garde de fraîcheur le fait chaque
 * fois que le desktop publie entre la lecture du manifeste par le pull et sa
 * relecture par la remontée, c'est-à-dire sans arrêt quand les deux appareils
 * tournent ensemble — l'ancêtre avançait sur des écritures que le nuage n'avait
 * jamais vues. Au cycle suivant, l'horloge distante RESTÉE EN ARRIÈRE était
 * « différente de l'ancêtre », donc lue comme un mouvement du nuage ; le local
 * ayant vraiment bougé, une copie de conflit naissait — portant notre propre
 * texte d'il y a quarante secondes.
 *
 * Le desktop est simulé par la logique de fusion elle-même (le portage
 * `electron/sync/notesMergeCore.ts` est prouvé identique par sa propre suite de
 * parité) : il télécharge, fusionne, réécrit son fichier et repousse.
 */
describe('cycles enchaînés — écrire sur le web pendant que le desktop synchronise', () => {
  const BASE_KEY = 'notes_merge_base';

  /**
   * Horloge des NOTES, volontairement dans le futur : `agreedAt` vaut
   * `Date.now()`, et une note datée du passé serait disqualifiée par ce garde-là
   * — ce qui masquerait précisément ce qu'on veut éprouver, la mémoire des
   * horloges.
   */
  let clock = 0;
  const tick = (ms = 2000): string => new Date((clock += ms)).toISOString();

  const cloud: { version: number; container: Uint8Array; checksum: string } = {
    version: 1,
    container: new Uint8Array(),
    checksum: '',
  };
  /** Blob reçu par R2 mais pas encore publié : le manifeste le commet. */
  let staged: Uint8Array | null = null;
  /**
   * La remontée échoue-t-elle ? C'est la situation qui a fabriqué la fausse
   * copie : le cycle FUSIONNE (donc arrête un ancêtre) mais ne pousse PAS. Dans
   * la vraie vie c'est un 409 sur le manifeste (le desktop l'a réécrit entre
   * temps), la garde de fraîcheur, la garde de capacité, une note retenue par une
   * session vivante, ou simplement le réseau.
   */
  let pushFails = false;

  const desktop: {
    payload: NotesPayload;
    base: NotesMergeBase | null;
    agreedAt: number | null;
    copies: number;
  } = { payload: {}, base: null, agreedAt: null, copies: 0 };

  const noteOf = (p: NotesPayload, id: string): Json => (p.byId as Record<string, Json>)[id];

  const conflictCopiesIn = (p: NotesPayload): Array<Record<string, unknown>> =>
    Object.values((p.byId ?? {}) as Record<string, Record<string, unknown>>).filter(
      (n) => typeof n.conflictOfId === 'string'
    );

  async function encodeCloud(p: NotesPayload): Promise<Uint8Array> {
    return new TextEncoder().encode(await encryptMachineContainerText(p, MACHINE_KEY));
  }

  /** Publie un conteneur : le nuage change d'empreinte ET de version. */
  async function publish(bytes: Uint8Array): Promise<void> {
    cloud.container = bytes;
    cloud.checksum = await sha256Hex(bytes);
    cloud.version += 1;
  }

  /**
   * UN CYCLE DESKTOP : télécharge, fusionne, arbitre, réécrit son fichier, et
   * repousse si son union apporte du neuf. Miroir de `downloadAndMergeNotes`.
   */
  async function desktopCycle(): Promise<void> {
    const merge = await import('../sync/notesMerge');
    const remote = (await decryptMachineContainerText(
      new TextDecoder().decode(cloud.container),
      MACHINE_KEY
    )) as NotesPayload;
    const merged = merge.mergeNotesPayload(
      JSON.parse(JSON.stringify(desktop.payload)) as NotesPayload,
      remote
    );
    const kept = merge.selectGenuineConflicts(
      merged.overwritten,
      merged.merged,
      desktop.base,
      desktop.agreedAt
    );
    const made = merge.applyConflictCopies(merged.merged, kept, {
      now: tick(0),
      newId: () => crypto.randomUUID(),
      device: 'desktop',
    });
    desktop.copies += made;
    const seal = merged.changedFromRemote || made > 0 ? merged.merged : null;
    desktop.payload = seal ?? remote;
    desktop.base = merge.collectMergeBase(desktop.payload, remote);
    if (seal) {
      await publish(await encodeCloud(seal));
      desktop.agreedAt = Date.now();
    } else {
      // Même sans rien à ajouter, le desktop RÉÉCRIT le manifeste à chaque
      // cycle (étape 9 de `triggerSync`) : la version avance, et le web
      // refusionne donc à chaque tour — c'est ce qui fait avancer sa base.
      cloud.version += 1;
    }
  }

  /**
   * Une sauvegarde automatique du renderer web : le texte change, l'horloge
   * aussi, et la ressource est MARQUÉE en attente — c'est `notes:save` qui pose
   * cette marque dans l'application, pas le cycle.
   */
  function webAutosave(id: string, text: string): void {
    const local = localNotes();
    const entry = noteOf(local, id);
    entry.content = text;
    entry.updatedAt = tick();
    seedLocalNotes(local);
    kv.set(scoped('p1', 'pending_uploads'), {
      'meta:notes': { kind: 'meta', folderId: 'notes', markedAt: entry.updatedAt },
    });
  }

  beforeEach(async () => {
    clock = Date.parse('2027-03-01T10:00:00.000Z');
    cloud.version = 1;
    staged = null;
    pushFails = false;
    desktop.base = null;
    desktop.agreedAt = null;
    desktop.copies = 0;

    // État de départ : les deux appareils et le nuage portent la MÊME note.
    const depart: NotesPayload = {
      byId: { n: note('n', { title: 'Bug find filarr', content: 'v0', updatedAt: tick(0) }) },
      allIds: ['n'],
      templates: [],
      notebooks: {},
    };
    seedLocalNotes(JSON.parse(JSON.stringify(depart)) as NotesPayload);
    desktop.payload = JSON.parse(JSON.stringify(depart)) as NotesPayload;
    await publish(await encodeCloud(depart));

    mocks.apiFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === '/sync/profiles') {
        return { status: 200, body: { success: true, data: { profiles: [] } } };
      }
      if (path === '/sync/presign/download') {
        return { status: 200, body: { success: true, data: { downloadUrl: '/dl-notes' } } };
      }
      if (path === '/sync/presign/upload') {
        if (pushFails) return { status: 503, body: { success: false, error: 'nuage injoignable' } };
        return { status: 200, body: { success: true, data: { uploadUrl: '/up-blob', key: 'k1' } } };
      }
      if (path === '/sync/manifest/p1' && init?.method === 'PUT') {
        return {
          status: 200,
          body: {
            success: true,
            data: { uploadUrl: '/up-manifest', newVersion: cloud.version + 1 },
          },
        };
      }
      return { status: 404, body: { success: false, error: `route inattendue ${path}` } };
    });

    mocks.fetch.mockImplementation(
      async (url: string, init?: { method?: string; body?: ArrayBuffer }) => {
        if (url === `${BASE}/sync/manifest/p1` && !init?.method) {
          counters.manifestGets++;
          return jsonResponse(
            200,
            await cloudManifestBody(cloud.version, {
              'meta:notes': notesEntry(cloud.container.byteLength, cloud.checksum),
            })
          );
        }
        if (url === `${BASE}/dl-notes`) return binaryResponse(cloud.container);
        if (url === `${BASE}/up-blob`) {
          staged = new Uint8Array(init?.body as ArrayBuffer);
          return jsonResponse(200, { success: true, data: { key: 'k1' } });
        }
        if (url === `${BASE}/up-manifest`) {
          uploads.manifest = new Uint8Array(init?.body as ArrayBuffer);
          if (staged) await publish(staged);
          staged = null;
          return jsonResponse(200, { success: true });
        }
        throw new Error(`URL inattendue ${url}`);
      }
    );
  });

  it('dix cycles de frappe web + synchro desktop : AUCUNE copie de conflit', async () => {
    for (let cycle = 0; cycle < 10; cycle++) {
      // ~20 s de cycle web pour une sauvegarde toutes les 2 s.
      for (let save = 0; save < 10; save++) webAutosave('n', `frappe ${cycle}-${save}`);
      await readSync.pullFromCloud('p1');
      await desktopCycle();

      expect(conflictCopiesIn(localNotes())).toEqual([]);
      expect(conflictCopiesIn(desktop.payload)).toEqual([]);
    }
    expect(desktop.copies).toBe(0);
    // Le texte a bien voyagé : le desktop porte la dernière frappe du web.
    expect(noteOf(desktop.payload, 'n').content).toBe('frappe 9-9');
  }, 120_000);

  it('LE DÉFAUT : plusieurs cycles qui FUSIONNENT sans remonter, puis la remontée repart', async () => {
    // L'ancêtre avançait sur nos écritures locales à chaque fusion, y compris
    // quand rien ne partait vers le nuage. Le cycle suivant trouvait alors une
    // horloge distante « différente de l'ancêtre » — parce qu'EN RETARD, pas
    // parce que quelqu'un avait écrit — et recopiait notre propre texte.
    pushFails = true;
    for (let cycle = 0; cycle < 5; cycle++) {
      for (let save = 0; save < 10; save++) webAutosave('n', `frappe ${cycle}-${save}`);
      await readSync.pullFromCloud('p1');
      await desktopCycle();

      expect(conflictCopiesIn(localNotes())).toEqual([]);
      expect(conflictCopiesIn(desktop.payload)).toEqual([]);
    }
    // Le nuage n'a rien reçu, et la marque a survécu : rien n'est perdu.
    expect(cloud.version).toBe(7); // 5 manifestes desktop, aucun blob de notes
    expect(kv.get(scoped('p1', 'pending_uploads'))).toHaveProperty('meta:notes');

    // Le réseau revient : la remontée part, toujours sans la moindre copie.
    pushFails = false;
    webAutosave('n', 'frappe finale');
    await readSync.pullFromCloud('p1');
    await desktopCycle();

    expect(conflictCopiesIn(localNotes())).toEqual([]);
    expect(desktop.copies).toBe(0);
    expect(noteOf(desktop.payload, 'n').content).toBe('frappe finale');
  }, 120_000);

  it('la base porte les DEUX tables : la nôtre et celle du nuage', async () => {
    webAutosave('n', 'une frappe');
    await readSync.pullFromCloud('p1');

    const stored = kv.get(scoped('p1', BASE_KEY)) as {
      clocks: { notes: Record<string, number>; remote?: { notes: Record<string, number> } };
    };
    expect(stored.clocks.remote).toBeDefined();
    expect(Object.keys(stored.clocks.remote!.notes)).toEqual(['n']);
  }, 60_000);

  it('mais une VRAIE divergence est toujours attrapée : du neuf desktop jamais remonté', async () => {
    // Exactement le conflit vécu : une version desktop plus ancienne, jamais
    // partie vers le nuage, face à ce que le web vient d'y écrire. Rien ici ne
    // doit se taire — c'est le seul cas où une copie est due.
    await readSync.pullFromCloud('p1'); // pose les bases des deux côtés
    await desktopCycle();

    // Le desktop écrit dans son coin et NE REMONTE PAS (hors ligne).
    noteOf(desktop.payload, 'n').content = 'écrit sur le desktop';
    noteOf(desktop.payload, 'n').updatedAt = tick();
    // Le web écrit de son côté, et lui remonte.
    webAutosave('n', 'écrit sur le web');
    await readSync.pullFromCloud('p1');

    // Le desktop se reconnecte : les deux ont écrit depuis leur dernier accord.
    await desktopCycle();

    const copies = conflictCopiesIn(desktop.payload);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({
      content: 'écrit sur le desktop',
      conflictOfId: 'n',
      conflictSide: 'local',
      conflictDevice: 'desktop',
    });
    expect(noteOf(desktop.payload, 'n').content).toBe('écrit sur le web');
  }, 60_000);
});
