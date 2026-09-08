/**
 * MISE EN PAGE SUR LE WEB — le cycle complet, de bout en bout.
 *
 * LA PANNE VERROUILLÉE ICI. Le client web SAUTAIT l'entrée `meta:layout` à la
 * descente. La garde était juste (sans elle, la boucle installait le conteneur
 * de mise en page comme un DOSSIER, produisant un dossier fantôme de clé
 * `undefined` à chaque cycle) mais elle laissait app.filarr.com incapable
 * d'afficher la mise en page personnalisée : l'accueil modulaire retombait
 * indéfiniment sur sa disposition de secours, alors que le nuage portait la
 * vraie, faite sur le bureau.
 *
 * CE QUE CES CAS EXIGENT :
 *  1. la mise en page distante est LUE, fusionnée et déposée localement, et le
 *     renderer en est prévenu (`layout-updated`) ;
 *  2. le dossier fantôme ne revient PAS (c'est la régression que la garde
 *     empêchait : elle est remplacée, pas retirée) ;
 *  3. la clé de lecture est celle du manifeste (`encryptionKey`), la MÊME que
 *     pour `notes.enc` — aucune seconde politique de clé n'a été inventée ;
 *  4. ce qui REPART est le conteneur clé machine `v2:` que le bureau relira, au
 *     chemin qu'il attend (`layout.enc`) ;
 *  5. rien ne part TANT QUE le distant n'a pas été lu : la remontée remplace le
 *     blob entier, donc pousser en aveugle effacerait la disposition de l'autre
 *     appareil.
 *
 * Réseau et stockage sont des doublures en mémoire ; la CRYPTO DES CONTENEURS
 * et le MOTEUR DE FUSION sont réels — ce sont eux qui prouvent ce qui part
 * vraiment et ce qui arrive vraiment.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { kv, idb, mocks, emits, writes, scoped } = vi.hoisted(() => ({
  kv: new Map<string, unknown>(),
  idb: new Map<string, unknown>(),
  mocks: { apiFetch: vi.fn(), fetch: vi.fn() },
  emits: [] as Array<{ channel: string; args: unknown[] }>,
  writes: [] as string[],
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

// Chiffrement FEK neutralisé : ce test porte sur la mise en page, pas sur
// hybridCrypto (couvert ailleurs).
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
import { LAYOUT_META_FILE_ID, LAYOUT_SEED_CLOCK, type LayoutDocument } from '../sync/layoutMerge';

const BASE = 'https://api.test';
const MACHINE_KEY = new Uint8Array(32).fill(3);
const MACHINE_KEY_B64 = btoa(String.fromCharCode(...MACHINE_KEY));
const LAYOUT_KEY = 'layout_doc';
const T1 = '2026-08-01T10:00:00.000Z';
const T2 = '2026-08-02T10:00:00.000Z';
const T3 = '2026-08-03T10:00:00.000Z';

type Json = Record<string, unknown>;

let readSync: typeof import('../sync/readSync');
let layoutHandlers: typeof import('../handlers/layoutHandlers');

const uploads: { layout: Uint8Array | null; manifest: Uint8Array | null } = {
  layout: null,
  manifest: null,
};

/** Un poseur de conteneur distant illisible, pour la garde n°5. */
let breakLayoutDownload = false;

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

const slot = (id: string, over: Json = {}) => ({
  id,
  role: 'recents',
  type: 'recent-notes',
  x: 0,
  y: 0,
  w: 6,
  h: 3,
  ...over,
});

const layoutDoc = (slots: unknown[], updatedAt: string): LayoutDocument =>
  ({
    schema: 1,
    views: { home: { id: 'home', slots, updatedAt } },
    templates: {},
    seededAt: T1,
  }) as unknown as LayoutDocument;

const layoutEntry = (size: number, checksum = 'empreinte-distante') => ({
  checksum,
  size,
  updatedAt: T2,
  syncedAt: T2,
  chunks: ['c0'],
  status: 'synced',
  localPath: 'layout.enc',
});

/** Le document tel qu'il est PERSISTÉ dans ce navigateur. */
const localLayout = (): LayoutDocument => {
  const raw = kv.get(scoped('p1', LAYOUT_KEY));
  if (!raw) throw new Error('aucun document de mise en page local');
  return raw as LayoutDocument;
};

/** Le manifeste tel qu'il PART sur le câble (ce que le bureau lira). */
async function pushedManifest(): Promise<Record<string, Json>> {
  if (!uploads.manifest) throw new Error('aucun manifeste poussé');
  const plain = await decryptFekContainer(uploads.manifest, FEK);
  return JSON.parse(new TextDecoder().decode(plain)) as Record<string, Json>;
}

async function cloudManifestBody(version: number, files: Json): Promise<Json> {
  const manifest = {
    version,
    profileId: 'p1',
    lastSyncAt: T1,
    files,
    notes: {},
    encryptionKey: MACHINE_KEY_B64,
    profileMeta: { id: 'p1', name: 'Nuage', avatarColor: '#111' },
    notesMergeVersion: 1,
  };
  const sealed = await encryptFekContainer(new TextEncoder().encode(JSON.stringify(manifest)), FEK);
  return { success: true, data: { manifest: btoa(String.fromCharCode(...sealed)), version } };
}

/** Faux Worker : sert un manifeste, et le conteneur de mise en page distant. */
async function serveCloud(remoteDoc: LayoutDocument | null, extraFiles: Json = {}): Promise<void> {
  const container = remoteDoc
    ? new TextEncoder().encode(await encryptMachineContainerText(remoteDoc, MACHINE_KEY))
    : null;
  const files: Json = {
    ...extraFiles,
    ...(container ? { [LAYOUT_META_FILE_ID]: layoutEntry(container.byteLength) } : {}),
  };

  mocks.apiFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === '/sync/profiles') {
      return { status: 200, body: { success: true, data: { profiles: [] } } };
    }
    if (path === '/sync/presign/download') {
      return { status: 200, body: { success: true, data: { downloadUrl: '/dl-layout' } } };
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
        return jsonResponse(200, await cloudManifestBody(1, files));
      }
      if (url === `${BASE}/dl-layout` && container) {
        if (breakLayoutDownload) return { status: 500, ok: false, arrayBuffer: async () => null };
        return binaryResponse(container);
      }
      if (url === `${BASE}/up-blob`) {
        uploads.layout = new Uint8Array(init?.body as ArrayBuffer);
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
  emits.length = 0;
  writes.length = 0;
  uploads.layout = null;
  uploads.manifest = null;
  breakLayoutDownload = false;
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
  layoutHandlers = await import('../handlers/layoutHandlers');
});

// ── 1. La descente : la dette elle-même ─────────────────────────────────────

describe('descente — la mise en page du bureau arrive enfin dans le navigateur', () => {
  it('lit `meta:layout`, le dépose localement et prévient le renderer', async () => {
    await serveCloud(layoutDoc([slot('bureau', { x: 3 })], T2));

    const result = await readSync.pullFromCloud('p1');
    expect(result.state).toBe('idle');

    const installed = localLayout();
    expect(installed.views.home.slots.map((s) => s.id)).toEqual(['bureau']);
    expect(installed.views.home.updatedAt).toBe(T2);
    // Le renderer relit son document sur ce canal (App.tsx) : sans lui, la
    // disposition n'apparaîtrait qu'au prochain démarrage.
    expect(emits.map((e) => e.channel)).toContain('layout-updated');
  });

  it('ne fabrique JAMAIS le dossier fantôme que la garde d’origine empêchait', async () => {
    await serveCloud(layoutDoc([slot('bureau')], T2));

    await readSync.pullFromCloud('p1');

    // Le magasin de dossiers n'a rien reçu, et surtout aucune clé `undefined`.
    const folders = kv.get(scoped('p1', 'folders')) as Json | undefined;
    expect(folders === undefined || Object.keys(folders).length === 0).toBe(true);
    expect(emits.map((e) => e.channel)).not.toContain('folders-updated');
  });

  it('ne remonte RIEN quand la nouveauté est purement distante (pas de boucle)', async () => {
    await serveCloud(layoutDoc([slot('bureau')], T2));

    await readSync.pullFromCloud('p1');

    expect(uploads.layout).toBeNull();
    expect(uploads.manifest).toBeNull();
  });

  it('ne touche à rien quand la clé machine manque au manifeste', async () => {
    // Manifeste sans `encryptionKey` : le conteneur est illisible — ce n'est pas
    // un échec, c'est un manifeste écrit par un appareil qui ne la connaît pas.
    const remote = layoutDoc([slot('bureau')], T2);
    const container = new TextEncoder().encode(
      await encryptMachineContainerText(remote, MACHINE_KEY)
    );
    mocks.apiFetch.mockImplementation(async (path: string) => {
      if (path === '/sync/profiles') {
        return { status: 200, body: { success: true, data: { profiles: [] } } };
      }
      if (path === '/sync/presign/download') {
        return { status: 200, body: { success: true, data: { downloadUrl: '/dl-layout' } } };
      }
      return { status: 404, body: { success: false, error: path } };
    });
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url === `${BASE}/sync/manifest/p1`) {
        const manifest = {
          version: 1,
          profileId: 'p1',
          lastSyncAt: T1,
          files: { [LAYOUT_META_FILE_ID]: layoutEntry(container.byteLength) },
          notes: {},
        };
        const sealed = await encryptFekContainer(
          new TextEncoder().encode(JSON.stringify(manifest)),
          FEK
        );
        return jsonResponse(200, {
          success: true,
          data: { manifest: btoa(String.fromCharCode(...sealed)), version: 1 },
        });
      }
      if (url === `${BASE}/dl-layout`) return binaryResponse(container);
      throw new Error(`URL inattendue ${url}`);
    });

    const result = await readSync.pullFromCloud('p1');

    expect(result.state).toBe('idle');
    expect(kv.get(scoped('p1', LAYOUT_KEY))).toBeUndefined();
  });
});

// ── 2. La fusion, puis la remontée ──────────────────────────────────────────

describe('fusion — les deux appareils se retrouvent, et ce qui repart est lisible', () => {
  it('arbitre au grain de la vue, conserve la perdante et pousse un conteneur `v2:`', async () => {
    // Ce navigateur a rangé son accueil APRÈS le bureau : il gagne, mais la
    // disposition du bureau n'est pas perdue pour autant.
    kv.set(scoped('p1', LAYOUT_KEY), layoutDoc([slot('web', { x: 9 })], T3));
    await serveCloud(layoutDoc([slot('bureau', { x: 3 })], T2));

    await readSync.pullFromCloud('p1');

    const merged = localLayout();
    expect(merged.views.home.slots.map((s) => s.id)).toEqual(['web']);
    expect(merged.views.home.superseded).toHaveLength(1);
    expect(merged.views.home.superseded![0].side).toBe('remote');

    // Ce qui part sur le câble : le conteneur clé machine que le bureau relira.
    expect(uploads.layout).not.toBeNull();
    const wire = new TextDecoder().decode(uploads.layout!);
    expect(wire.startsWith('v2:')).toBe(true);
    const reread = (await decryptMachineContainerText(wire, MACHINE_KEY)) as LayoutDocument;
    expect(reread.views.home.slots.map((s) => s.id)).toEqual(['web']);

    // Et l'entrée de manifeste porte le chemin que le bureau attend.
    const manifest = await pushedManifest();
    const entry = (manifest.files as Json)[LAYOUT_META_FILE_ID] as Json;
    expect(entry.localPath).toBe('layout.enc');
    expect(entry.status).toBe('synced');
  });

  it('laisse le distant gagner quand c’est lui le plus frais, sans rien détruire', async () => {
    kv.set(scoped('p1', LAYOUT_KEY), layoutDoc([slot('web')], T1));
    await serveCloud(layoutDoc([slot('bureau')], T3));

    await readSync.pullFromCloud('p1');

    const merged = localLayout();
    expect(merged.views.home.slots.map((s) => s.id)).toEqual(['bureau']);
    expect(merged.views.home.superseded).toHaveLength(1);
    expect(merged.views.home.superseded![0].side).toBe('local');
  });
});

// ── 3. La garde : ne jamais pousser en aveugle ──────────────────────────────

describe('garde de remontée — rien ne part tant que le distant n’a pas été lu', () => {
  it('diffère la remontée quand le conteneur distant n’a pas pu être rapatrié', async () => {
    kv.set(scoped('p1', LAYOUT_KEY), layoutDoc([slot('web')], T3));
    await serveCloud(layoutDoc([slot('bureau')], T2));
    breakLayoutDownload = true;
    // Une écriture locale attend déjà d'être remontée.
    await readSync.markLayoutPending('p1');

    await readSync.pullFromCloud('p1');

    // Pousser ici remplacerait `layout.enc` distant par un document qui n'a
    // JAMAIS vu la disposition du bureau : c'est exactement la perte que la
    // fusion existe pour empêcher.
    expect(uploads.layout).toBeNull();
    // La marque reste : le cycle suivant refusionnera, puis poussera.
    const pending = kv.get(scoped('p1', 'pending_uploads')) as Json;
    expect(pending[LAYOUT_META_FILE_ID]).toBeDefined();
    // Et le document local n'a pas bougé d'un octet.
    expect(localLayout().views.home.slots.map((s) => s.id)).toEqual(['web']);
  });

  it('publie la première mise en page quand le nuage n’en porte aucune', async () => {
    kv.set(scoped('p1', LAYOUT_KEY), layoutDoc([slot('web')], T3));
    await serveCloud(null);
    await readSync.markLayoutPending('p1');

    await readSync.pullFromCloud('p1');

    expect(uploads.layout).not.toBeNull();
    const reread = (await decryptMachineContainerText(
      new TextDecoder().decode(uploads.layout!),
      MACHINE_KEY
    )) as LayoutDocument;
    expect(reread.views.home.slots.map((s) => s.id)).toEqual(['web']);
  });
});

// ── 4. Le contrat rendu au renderer ─────────────────────────────────────────

describe('layout:load / layout:save — même contrat que le bureau', () => {
  it('amorce le profil neuf, marque la remontée, et rend `seeded: true`', async () => {
    const result = (await layoutHandlers.layoutHandlers['layout:load']({
      homeRecentNotes: true,
      dashboardCollapsed: false,
      display: { compactMode: true, gridSize: 'large', defaultViewMode: 'list' },
    })) as { document: LayoutDocument; seeded: boolean; created: boolean };

    expect(result.seeded).toBe(true);
    expect(result.created).toBe(true);
    // Les identifiants de l'amorçage sont DÉTERMINISTES : deux appareils qui
    // amorcent le même accueil produisent le même document, et la fusion les
    // reconnaît comme une seule et même chose.
    expect(result.document.views.home.slots.map((s) => s.id)).toEqual([
      'seed:stat-files',
      'seed:stat-folders',
      'seed:stat-storage',
      'seed:stat-notes',
      'seed:types',
      'seed:resume',
      'seed:recents',
      'seed:folder-grid',
    ]);
    // ⚠ L'ÉPOQUE, jamais l'heure de l'amorçage : une vue amorcée ne doit pouvoir
    // gagner que là où le nuage n'a rien.
    expect(result.document.views.home.updatedAt).toBe(LAYOUT_SEED_CLOCK);
    // Les préférences déjà exprimées sont reprises, pas réinventées.
    const grid = result.document.views.home.slots.find((s) => s.id === 'seed:folder-grid');
    expect(grid?.options).toEqual({ compact: true, gridSize: 'large', viewMode: 'list' });

    const pending = kv.get(scoped('p1', 'pending_uploads')) as Json;
    expect(pending[LAYOUT_META_FILE_ID]).toBeDefined();
  });

  it('RETIENT l’amorçage quand le nuage porte déjà une mise en page', async () => {
    await serveCloud(layoutDoc([slot('bureau')], T2));
    await readSync.pullFromCloud('p1');
    // Le document est descendu : on l'efface pour simuler l'ordre inverse — un
    // manifeste connu, mais rien encore en local (la descente n'a pas abouti).
    kv.delete(scoped('p1', LAYOUT_KEY));

    const result = (await layoutHandlers.layoutHandlers['layout:load']({})) as {
      document: LayoutDocument;
      seeded: boolean;
    };

    // `seeded: false` = document PROVISOIRE : le renderer n'écrit rien par
    // dessus et réessaiera après `layout-updated`.
    expect(result.seeded).toBe(false);
    expect(Object.keys(result.document.views)).toHaveLength(0);
    expect(kv.get(scoped('p1', LAYOUT_KEY))).toBeUndefined();
  });

  it('relit ce qui existe sans jamais ré-amorcer par-dessus', async () => {
    kv.set(scoped('p1', LAYOUT_KEY), layoutDoc([slot('deja-la')], T3));

    const result = (await layoutHandlers.layoutHandlers['layout:load']({})) as {
      document: LayoutDocument;
      seeded: boolean;
      created: boolean;
    };

    expect(result.created).toBe(false);
    expect(result.seeded).toBe(true);
    expect(result.document.views.home.slots.map((s) => s.id)).toEqual(['deja-la']);
  });

  it('`layout:save` dépose le document et met la remontée en attente', async () => {
    const ok = await layoutHandlers.layoutHandlers['layout:save'](
      layoutDoc([slot('range-a-la-main')], T3)
    );

    expect(ok).toBe(true);
    expect(localLayout().views.home.slots.map((s) => s.id)).toEqual(['range-a-la-main']);
    // Le conteneur porte SA propre horloge de dernier écrivain, comme sur le
    // bureau (`writeLayoutDocument`).
    expect(typeof localLayout().updatedAt).toBe('string');
    const pending = kv.get(scoped('p1', 'pending_uploads')) as Json;
    expect(pending[LAYOUT_META_FILE_ID]).toEqual(
      expect.objectContaining({ kind: 'meta', folderId: 'layout' })
    );
  });

  it('un rangement fait dans le navigateur atteint le nuage au cycle suivant', async () => {
    await serveCloud(null);
    await layoutHandlers.layoutHandlers['layout:save'](layoutDoc([slot('web')], T3));

    await readSync.pullFromCloud('p1');

    expect(uploads.layout).not.toBeNull();
    const manifest = await pushedManifest();
    expect((manifest.files as Json)[LAYOUT_META_FILE_ID]).toBeDefined();
    // La marque est acquittée : pas de badge « non synchronisé » perpétuel.
    const pending = kv.get(scoped('p1', 'pending_uploads')) as Json;
    expect(pending[LAYOUT_META_FILE_ID]).toBeUndefined();
  });
});
