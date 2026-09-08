/**
 * Moteur de sync web — ce qui PART vers le nuage et ce que le sondage RÉPOND.
 *
 * Deux patrons de panne verrouillés ici :
 *  1. des drapeaux internes au web (`__fromCloud`, `__unreadable`) glissés dans
 *     le conteneur chiffré poussé — le desktop les relirait comme des champs de
 *     métadonnées ; et un `profileMeta` distant figé, qui rendait inerte tout
 *     changement local de PIN ou d'autorisation de réinitialisation ;
 *  2. un sondage qui pend pour toujours (aucun délai maximal) ou qui rend un
 *     verdict après l'arrêt de la session.
 *
 * Réseau et stockage sont des doublures en mémoire ; la CRYPTO est réelle
 * (containerCrypto), c'est elle qui prouve le contenu effectivement poussé.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { kv, idb, mocks, scoped, session } = vi.hoisted(() => ({
  kv: new Map<string, unknown>(),
  idb: new Map<string, unknown>(),
  mocks: { apiFetch: vi.fn(), fetch: vi.fn() },
  scoped: (pid: string, key: string) => `p:${pid}:${key}`,
  /**
   * La session du navigateur, telle que le socle réseau la tient : un jeton en
   * mémoire, et un cookie de refresh qui peut le re-frapper. `refreshes` compte
   * les re-frappes — c'est ce qui distingue « le cycle a renouvelé » de « le
   * cycle est passé en force ».
   */
  session: {
    token: 'jeton-de-test',
    cookieValide: false,
    jetonFrais: 'jeton-frais',
    refreshes: 0,
    /** Le jeton en mémoire a dépassé son `exp` (ce que le vrai module lit). */
    perime: false,
  },
}));

vi.mock('../webStore', () => ({
  getActiveProfileId: async () => 'p1',
  storeGet: async (key: string) => kv.get(scoped('p1', key)) ?? null,
  storePut: async (key: string, value: unknown) => {
    kv.set(scoped('p1', key), value);
  },
  storeDelete: async (key: string) => {
    kv.delete(scoped('p1', key));
  },
  forProfile: (pid: string) => ({
    get: async (key: string) => kv.get(scoped(pid, key)) ?? null,
    put: async (key: string, value: unknown) => {
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

vi.mock('../webEventBus', () => ({ emitWebEvent: () => undefined }));

vi.mock('../webApiBase', () => {
  // Le CONTRAT du socle réseau, pas sa mécanique : `refreshViaCookie` re-frappe
  // si le cookie vaut encore, `ensureAccessToken` rend un jeton frais en
  // renouvelant d'abord si l'échéance est passée. La lecture de `exp`, elle, est
  // éprouvée contre le VRAI module (accessTokenFreshness.vitest.ts).
  const refreshViaCookie = async () => {
    session.refreshes += 1;
    if (!session.cookieValide) return false;
    session.token = session.jetonFrais;
    session.perime = false;
    return true;
  };
  return {
    resolveApiBase: () => 'https://api.test',
    getAccessToken: () => session.token,
    ensureAccessToken: async () => {
      if (session.perime) await refreshViaCookie();
      return session.token;
    },
    refreshViaCookie,
    registerSessionAccountHintProvider: () => undefined,
    apiFetch: mocks.apiFetch,
  };
});

const FEK = new Uint8Array(32).fill(7);

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
} from '../sync/containerCrypto';

const BASE = 'https://api.test';
const MACHINE_KEY = new Uint8Array(32).fill(3);
const MACHINE_KEY_B64 = btoa(String.fromCharCode(...MACHINE_KEY));
const PIN_LOCAL = '2026-06-01T00:00:00.000Z';
const PIN_NUAGE = '2026-01-01T00:00:00.000Z';

type Json = Record<string, unknown>;

/** Réponse minimale : readSync ne lit que status / ok / json() / body.cancel(). */
const jsonResponse = (status: number, body: Json) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
  body: { cancel: async () => undefined },
});

let readSync: typeof import('../sync/readSync');

const uploads: { meta: Uint8Array | null; manifest: Uint8Array | null } = {
  meta: null,
  manifest: null,
};

/** Manifeste distant servi par le faux Worker (chiffré FEK, comme le vrai). */
async function cloudManifestBody(version: number, files: Json = {}): Promise<Json> {
  const manifest = {
    version,
    profileId: 'p1',
    lastSyncAt: '2026-08-01T00:00:00.000Z',
    files,
    notes: {},
    encryptionKey: MACHINE_KEY_B64,
    profileMeta: { id: 'p1', name: 'Nuage', avatarColor: '#111', pinUpdatedAt: PIN_NUAGE },
  };
  const sealed = await encryptFekContainer(new TextEncoder().encode(JSON.stringify(manifest)), FEK);
  return { success: true, data: { manifest: btoa(String.fromCharCode(...sealed)), version } };
}

beforeEach(async () => {
  vi.resetModules();
  kv.clear();
  idb.clear();
  uploads.meta = null;
  uploads.manifest = null;
  session.token = 'jeton-de-test';
  session.cookieValide = false;
  session.refreshes = 0;
  session.perime = false;
  mocks.apiFetch.mockReset();
  mocks.fetch.mockReset();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', mocks.fetch);

  idb.set('profiles_manifest', {
    version: 1,
    activeProfileId: 'p1',
    profiles: [
      {
        id: 'p1',
        name: 'Local',
        avatarColor: '#fff',
        pinHash: 'abc',
        pinSalt: 'def',
        allowPinReset: true,
        pinUpdatedAt: PIN_LOCAL,
        isDefault: true,
        order: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    maxProfiles: 10,
    migratedFromLegacy: true,
  });

  mocks.apiFetch.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === '/sync/profiles') {
      return { status: 200, body: { success: true, data: { profiles: [] } } };
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

  readSync = await import('../sync/readSync');
});

describe('remontée — le conteneur poussé ne contient que des données de métier', () => {
  it('une méta poussée perd __fromCloud et __unreadable, et garde le PIN local le plus frais', async () => {
    kv.set(scoped('p1', 'folders'), {
      d1: {
        id: 'd1',
        name: 'Dossier',
        color: '#abcdef',
        emoji: '📁',
        items: [{ id: 'i1', name: 'note.txt', type: 'file' }],
        __fromCloud: true,
        __unreadable: true,
      },
    });
    kv.set(scoped('p1', 'pending_uploads'), {
      'meta:d1': { kind: 'meta', folderId: 'd1', markedAt: '2026-08-02T00:00:00.000Z' },
    });

    mocks.fetch.mockImplementation(
      async (url: string, init?: { method?: string; body?: ArrayBuffer }) => {
        if (url === `${BASE}/sync/manifest/p1` && !init?.method) {
          return jsonResponse(200, await cloudManifestBody(1));
        }
        if (url === `${BASE}/up-blob`) {
          uploads.meta = new Uint8Array(init?.body as ArrayBuffer);
          return jsonResponse(200, { success: true, data: { key: 'k1' } });
        }
        if (url === `${BASE}/up-manifest`) {
          uploads.manifest = new Uint8Array(init?.body as ArrayBuffer);
          return jsonResponse(200, { success: true });
        }
        throw new Error(`URL inattendue ${url}`);
      }
    );

    const result = await readSync.pullFromCloud('p1');
    expect(result.state).toBe('idle');
    expect(result.pushed).toBe(1);

    // 1. Le conteneur machine réellement téléversé, relu avec la clé du manifeste.
    expect(uploads.meta).not.toBeNull();
    const pushedFolder = (await decryptMachineContainerText(
      new TextDecoder().decode(uploads.meta!),
      MACHINE_KEY
    )) as Record<string, unknown>;
    expect('__fromCloud' in pushedFolder).toBe(false);
    expect('__unreadable' in pushedFolder).toBe(false);
    expect(pushedFolder.id).toBe('d1');
    expect(pushedFolder.emoji).toBe('📁');
    expect(pushedFolder.items).toEqual([{ id: 'i1', name: 'note.txt', type: 'file' }]);

    // 2. Le manifeste réécrit : entrée présente, et méta de profil LOCALE
    //    (son horloge PIN est plus récente que celle du nuage).
    expect(uploads.manifest).not.toBeNull();
    const manifest = JSON.parse(
      new TextDecoder().decode(await decryptFekContainer(uploads.manifest!, FEK))
    ) as { files: Record<string, Json>; profileMeta: Json };
    expect(manifest.files['meta:d1']).toBeDefined();
    expect(manifest.profileMeta.pinUpdatedAt).toBe(PIN_LOCAL);
    expect(manifest.profileMeta.allowPinReset).toBe(true);
  }, 30_000);
});

describe('entrée de manifeste poussée — fusion sur l’existante, jamais remplacement', () => {
  /** Manifeste réécrit par le push, déchiffré. */
  async function manifestePousse(): Promise<Record<string, Json>> {
    const decoded = JSON.parse(
      new TextDecoder().decode(await decryptFekContainer(uploads.manifest!, FEK))
    ) as { files: Record<string, Json> };
    return decoded.files;
  }

  /** Faux Worker paramétré : le manifeste distant porte `remoteFiles`. */
  function servir(remoteFiles: Json, keyOfChunk = (i: number) => `k${i}`): number[] {
    const chunkIndices: number[] = [];
    mocks.apiFetch.mockImplementation(
      async (path: string, init?: { method?: string; body?: Json }) => {
        if (path === '/sync/profiles') {
          return { status: 200, body: { success: true, data: { profiles: [] } } };
        }
        if (path === '/sync/presign/upload') {
          const index = Number(init?.body?.chunkIndex ?? 0);
          chunkIndices.push(index);
          return {
            status: 200,
            body: {
              success: true,
              data: { uploadUrl: '/up-blob', key: keyOfChunk(index) },
            },
          };
        }
        if (path === '/sync/manifest/p1' && init?.method === 'PUT') {
          return {
            status: 200,
            body: { success: true, data: { uploadUrl: '/up-manifest', newVersion: 2 } },
          };
        }
        return { status: 404, body: { success: false, error: `route inattendue ${path}` } };
      }
    );
    mocks.fetch.mockImplementation(
      async (url: string, init?: { method?: string; body?: ArrayBuffer }) => {
        if (url === `${BASE}/sync/manifest/p1` && !init?.method) {
          return jsonResponse(200, await cloudManifestBody(1, remoteFiles));
        }
        if (url === `${BASE}/up-blob`) {
          uploads.meta = new Uint8Array(init?.body as ArrayBuffer);
          return jsonResponse(200, { success: true, data: {} });
        }
        if (url === `${BASE}/up-manifest`) {
          uploads.manifest = new Uint8Array(init?.body as ArrayBuffer);
          return jsonResponse(200, { success: true });
        }
        throw new Error(`URL inattendue ${url}`);
      }
    );
    return chunkIndices;
  }

  it('garde les champs distants inconnus, pose le localPath, et périme ce qui décrit le contenu', async () => {
    kv.set(scoped('p1', 'file:d1/photo.jpg'), new Uint8Array([1, 2, 3, 4]));
    kv.set(scoped('p1', 'pending_uploads'), {
      fhash: {
        kind: 'blob',
        folderId: 'd1',
        fileName: 'photo.jpg',
        markedAt: '2026-08-02T00:00:00.000Z',
      },
    });
    servir({
      fhash: {
        checksum: 'ancien',
        size: 999,
        updatedAt: '2026-07-01T00:00:00.000Z',
        syncedAt: '2026-07-01T00:00:00.000Z',
        chunks: ['vieille-cle'],
        status: 'synced',
        // Champs que le web ne sait pas produire.
        plaintextChecksum: 'empreinte-du-clair-perimee',
        delta: { version: 1, blockCount: 4 },
        champDuFutur: 'à conserver',
      },
    });

    const result = await readSync.pullFromCloud('p1');
    expect(result.pushed).toBe(1);

    const entry = (await manifestePousse()).fhash as Json;
    // 1. Ce que la fusion préserve.
    expect(entry.champDuFutur).toBe('à conserver');
    // 2. Ce qu'elle POSE : le desktop a besoin du chemin pour écrire le fichier.
    expect(entry.localPath).toBe('d1/photo.jpg');
    // 3. Ce qu'elle PÉRIME : ces deux-là décrivent des octets qui n'existent
    //    plus. Les garder faisait conclure au desktop « même contenu » (il
    //    compare les empreintes du clair quand les DEUX côtés en portent une)
    //    ou lui faisait lire un blob entier comme des blocs delta.
    expect('plaintextChecksum' in entry).toBe(false);
    expect('delta' in entry).toBe(false);
    expect(entry.checksum).not.toBe('ancien');
    expect(entry.chunks).toEqual(['k0']);
  }, 30_000);

  it('une méta de dossier poussée porte `{folderId}/metadata.json`', async () => {
    kv.set(scoped('p1', 'folders'), { d1: { id: 'd1', name: 'Dossier', items: [] } });
    kv.set(scoped('p1', 'pending_uploads'), {
      'meta:d1': { kind: 'meta', folderId: 'd1', markedAt: '2026-08-02T00:00:00.000Z' },
    });
    servir({});

    await readSync.pullFromCloud('p1');

    expect(((await manifestePousse())['meta:d1'] as Json).localPath).toBe('d1/metadata.json');
  }, 30_000);

  it('au-delà de 4 Mio le blob part en PLUSIEURS chunks (le presign refuse au-delà)', async () => {
    const gros = new Uint8Array(4 * 1024 * 1024 + 17).fill(9);
    kv.set(scoped('p1', 'file:d1/gros.bin'), gros);
    kv.set(scoped('p1', 'pending_uploads'), {
      fhash: {
        kind: 'blob',
        folderId: 'd1',
        fileName: 'gros.bin',
        markedAt: '2026-08-02T00:00:00.000Z',
      },
    });
    const chunkIndices = servir({});

    await readSync.pullFromCloud('p1');

    expect(chunkIndices).toEqual([0, 1]);
    const entry = (await manifestePousse()).fhash as Json;
    expect(entry.chunks).toEqual(['k0', 'k1']);
    expect(entry.size).toBe(gros.byteLength);
    // Le DERNIER chunk envoyé porte bien le reste, pas le fichier entier.
    expect(uploads.meta?.byteLength).toBe(17);
  }, 30_000);
});

describe('sondage du manifeste — verdicts', () => {
  /** Amorce `_serverVersions` : un cycle complet sur un nuage encore vide. */
  async function amorcerVersion(version = 3): Promise<void> {
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url === `${BASE}/sync/manifest/p1`) {
        return jsonResponse(200, { success: true, data: { manifest: null, version } });
      }
      throw new Error(`URL inattendue ${url}`);
    });
    const result = await readSync.pullFromCloud('p1');
    expect(result.state).toBe('idle');
    mocks.fetch.mockReset();
  }

  it('rend skipped tant qu’aucune version n’a été lue pour ce profil', async () => {
    expect(await readSync.probeManifestChanged('p1')).toBe('skipped');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('304 → unchanged, avec l’ETag de la version connue et un délai maximal', async () => {
    await amorcerVersion(3);
    mocks.fetch.mockResolvedValue(jsonResponse(304, {}));

    expect(await readSync.probeManifestChanged('p1')).toBe('unchanged');
    const [, init] = mocks.fetch.mock.calls[0] as [string, { headers: Json; signal?: AbortSignal }];
    expect(init.headers['If-None-Match']).toBe('W/"v3"');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('200 → changed (sans lire le corps : le cycle complet s’en charge)', async () => {
    await amorcerVersion(3);
    mocks.fetch.mockResolvedValue(jsonResponse(200, { success: true }));
    expect(await readSync.probeManifestChanged('p1')).toBe('changed');
  });

  it('401 → unauthorized', async () => {
    await amorcerVersion(3);
    mocks.fetch.mockResolvedValue(jsonResponse(401, { success: false }));
    expect(await readSync.probeManifestChanged('p1')).toBe('unauthorized');
  });

  it('délai dépassé → error (et non une promesse pendue pour toujours)', async () => {
    await amorcerVersion(3);
    mocks.fetch.mockRejectedValue(
      Object.assign(new Error('The operation was aborted due to timeout'), {
        name: 'TimeoutError',
      })
    );
    expect(await readSync.probeManifestChanged('p1')).toBe('error');
  });

  it('conditionnel hors service → repli sans en-tête, puis sondage skipped', async () => {
    // Un premier cycle complet installe la version connue ET le cache : c'est
    // ce qui arme le GET conditionnel du cycle suivant.
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url === `${BASE}/sync/manifest/p1`) return jsonResponse(200, await cloudManifestBody(1));
      throw new Error(`URL inattendue ${url}`);
    });
    expect((await readSync.pullFromCloud('p1')).state).toBe('idle');

    // Panne réseau du chemin conditionnel (préflight CORS refusé — déjà vécu en
    // conditions réelles) : le cycle rejoue SANS l'en-tête plutôt que d'échouer,
    // et le sondage se retire pour le reste de la session.
    let appels = 0;
    mocks.fetch.mockImplementation(async (url: string, init?: { headers?: Json }) => {
      appels++;
      if (init?.headers?.['If-None-Match']) throw new TypeError('Failed to fetch');
      if (url === `${BASE}/sync/manifest/p1`) return jsonResponse(200, await cloudManifestBody(2));
      throw new Error(`URL inattendue ${url}`);
    });

    const result = await readSync.pullFromCloud('p1');
    expect(result.state).toBe('idle');
    expect(appels).toBe(2); // conditionnel refusé, puis repli sans en-tête
    expect(readSync.isConditionalGetDisabled()).toBe(true);

    mocks.fetch.mockClear();
    expect(await readSync.probeManifestChanged('p1')).toBe('skipped');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe('versions connues — ce que le sondage a le droit de croire', () => {
  it('une méta illisible laisse la version d’avant (le sondage redemandera)', async () => {
    const files = {
      'meta:d1': {
        checksum: 'x',
        size: 10,
        updatedAt: '2026-08-01T00:00:00.000Z',
        syncedAt: '2026-08-01T00:00:00.000Z',
        chunks: ['c0'],
        status: 'synced',
      },
    };
    mocks.apiFetch.mockImplementation(async (path: string) => {
      if (path === '/sync/profiles') {
        return { status: 200, body: { success: true, data: { profiles: [] } } };
      }
      if (path === '/sync/presign/download') {
        return { status: 200, body: { success: false, error: 'chunk indisponible' } };
      }
      return { status: 404, body: { success: false } };
    });
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url === `${BASE}/sync/manifest/p1`)
        return jsonResponse(200, await cloudManifestBody(5, files));
      throw new Error(`URL inattendue ${url}`);
    });

    const result = await readSync.pullFromCloud('p1');
    expect(result.state).toBe('idle');
    expect(result.installedMeta).toBe(0);
    // Version NON inscrite : le sondage n'a rien à comparer, le cycle complet
    // refera foi (et le manifeste sera redemandé).
    expect(await readSync.probeManifestChanged('p1')).toBe('skipped');
    expect(kv.get(scoped('p1', 'cloud_sync_state'))).toBeUndefined();
  });

  it('clearServerVersions oublie tout (logout / changement de profil)', async () => {
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url === `${BASE}/sync/manifest/p1`) {
        return jsonResponse(200, { success: true, data: { manifest: null, version: 9 } });
      }
      throw new Error(`URL inattendue ${url}`);
    });
    mocks.apiFetch.mockImplementation(async () => ({
      status: 200,
      body: { success: true, data: { profiles: [] } },
    }));
    await readSync.pullFromCloud('p1');
    mocks.fetch.mockResolvedValue(jsonResponse(304, {}));
    expect(await readSync.probeManifestChanged('p1')).toBe('unchanged');

    readSync.clearServerVersions();
    expect(await readSync.probeManifestChanged('p1')).toBe('skipped');
  });
});

/**
 * LE 401 DU MANIFESTE, VU EN PRODUCTION LE 31/08/2026.
 *
 * Le jeton d'accès dure quinze minutes ; le manifeste est l'ÉTAPE 1 du cycle et
 * part par un `fetch` nu, hors du seul chemin (`apiFetch`) qui savait renouveler.
 * Passé le quart d'heure, chaque cycle mourait donc sur « Manifeste : HTTP 401 »
 * — périodique, sondage et bouton « Synchroniser » compris — jusqu'au
 * rechargement de l'onglet, alors que le cookie de refresh valait encore
 * quatre-vingt-dix jours.
 */
describe('session périmée en cours de route — le manifeste se re-frappe un jeton', () => {
  /**
   * Faux Worker qui EXIGE le jeton frais : tout `Authorization` autre que
   * `jeton-frais` vaut 401, exactement comme le vrai face à un JWT expiré.
   */
  function workerQuiExigeLeJetonFrais(): void {
    mocks.fetch.mockImplementation(
      async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
        if (url === `${BASE}/sync/manifest/p1` && !init?.method) {
          if (init?.headers?.Authorization !== `Bearer ${session.jetonFrais}`) {
            return jsonResponse(401, { success: false, error: 'token expired' });
          }
          return jsonResponse(200, await cloudManifestBody(1));
        }
        throw new Error(`URL inattendue ${url}`);
      }
    );
    mocks.apiFetch.mockImplementation(async () => ({
      status: 200,
      body: { success: true, data: { profiles: [] } },
    }));
  }

  it('un 401 déclenche UNE re-frappe, et le cycle aboutit avec le jeton neuf', async () => {
    session.cookieValide = true;
    workerQuiExigeLeJetonFrais();

    const result = await readSync.pullFromCloud('p1');

    expect(result.error).toBeUndefined();
    expect(result.state).toBe('idle');
    expect(session.refreshes).toBe(1);
    expect(session.token).toBe(session.jetonFrais);
  }, 30_000);

  it("un refresh refusé laisse le 401 remonter : on n'invente pas une session", async () => {
    session.cookieValide = false; // cookie mort (déconnexion, révocation)
    workerQuiExigeLeJetonFrais();

    const result = await readSync.pullFromCloud('p1');

    expect(result.error).toContain('401');
    // Une seule tentative : pas de boucle de re-frappe contre un refus ferme.
    expect(session.refreshes).toBe(1);
  }, 30_000);

  it('le sondage renouvelle aussi — sinon il se suspend tout seul pour la session', async () => {
    session.cookieValide = true;
    // Une version connue : sans elle le sondage rend `skipped` sans rien tenter.
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url === `${BASE}/sync/manifest/p1`) {
        return jsonResponse(200, { success: true, data: { manifest: null, version: 4 } });
      }
      throw new Error(`URL inattendue ${url}`);
    });
    mocks.apiFetch.mockImplementation(async () => ({
      status: 200,
      body: { success: true, data: { profiles: [] } },
    }));
    await readSync.pullFromCloud('p1');

    // Le jeton meurt entre le cycle et le sondage : échéance passée.
    session.token = 'jeton-perime';
    session.perime = true;
    session.refreshes = 0;
    mocks.fetch.mockImplementation(
      async (url: string, init?: { headers?: Record<string, string> }) => {
        if (url === `${BASE}/sync/manifest/p1`) {
          return init?.headers?.Authorization === `Bearer ${session.jetonFrais}`
            ? jsonResponse(304, {})
            : jsonResponse(401, { success: false, error: 'token expired' });
        }
        throw new Error(`URL inattendue ${url}`);
      }
    );

    // `unauthorized` suspendrait le sondage jusqu'à la fin de la session.
    expect(await readSync.probeManifestChanged('p1')).toBe('unchanged');
    expect(session.refreshes).toBe(1);
  }, 30_000);
});
