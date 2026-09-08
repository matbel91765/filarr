/**
 * Magasin LOCAL — le plan de donnees ne passe plus par le relais.
 *
 * ── CE QUE CES TESTS DEFENDENT ──────────────────────────────────────────────
 *
 * Sur un magasin local (NAS, MinIO sur le reseau de l'utilisateur), le worker
 * ne joint pas le magasin : il SIGNE, et c'est ce processus qui execute. Trois
 * chemins devaient donc changer de comportement, et un seul oubli suffirait a
 * casser la synchro de facon incomprehensible :
 *
 *   · l'envoi     — sinon les octets partent vers `/sync/upload/:token`, un
 *                   relais qui ecrirait dans un magasin qu'il n'atteint pas ;
 *   · la lecture  — meme raison, en sens inverse ;
 *   · l'effacement— le pire des trois, parce qu'il echoue EN SILENCE : la route
 *                   serveur enumere le prefixe, ce qu'un worker ne peut pas
 *                   faire sur un NAS. Les objets resteraient a jamais dans le
 *                   bucket que l'utilisateur paie, sans qu'aucune erreur ne le
 *                   dise.
 *
 * On observe donc QUELLE ROUTE est appelee, pas la valeur rendue : un test sur
 * le retour resterait vert si le client demandait une signature puis envoyait
 * quand meme par le relais.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const routesAppelees: string[] = [];
const urlsFetchees: Array<{ url: string; method: string }> = [];

/** Reponse du worker, selon la route demandee. */
function reponseWorker(path: string): unknown {
  if (path.startsWith('/sync/capabilities')) {
    return {
      success: true,
      data: { directUpload: true, deltaSync: true, storageMode: 'byos', byosLocality: 'local' },
    };
  }
  if (path === '/sync/presign/upload-direct') {
    return { success: true, data: { url: 'https://nas.invalid/sign-put', key: 'users/u/f/chunk_0.enc' } };
  }
  if (path === '/sync/presign/download-direct') {
    return { success: true, data: { url: 'https://nas.invalid/sign-get' } };
  }
  if (path === '/sync/presign/delete-direct') {
    return { success: true, data: { url: 'https://nas.invalid/sign-del' } };
  }
  return { success: true, data: {} };
}

// syncR2Client est un module du processus principal : il ouvre `electron` et
// `electron-log` des l'import. Coquilles, comme les tests voisins.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false, getVersion: () => '0.0.0' },
  safeStorage: { isEncryptionAvailable: () => false },
  BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock('electron-log', () => ({
  default: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

// `authenticatedApiCall` et `fetchWithTimeout` vivent dans authService, pas
// dans un client d'API separe. On garde `fetchWithTimeout` REEL : c'est lui qui
// appelle le `fetch` global qu'on espionne, donc le remplacer masquerait
// justement ce que ces tests observent.
vi.mock('../authService', () => ({
  API_BASE: 'https://api.filarr.test',
  authenticatedApiCall: vi.fn(async (path: string) => {
    routesAppelees.push(path);
    return reponseWorker(path);
  }),
  fetchWithTimeout: (url: string, init?: RequestInit) => fetch(url, init),
  getAccessToken: async () => 'jeton-de-test',
}));

let r2: typeof import('../sync/syncR2Client');

beforeEach(async () => {
  routesAppelees.length = 0;
  urlsFetchees.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      urlsFetchees.push({ url: String(input), method: (init?.method || 'GET').toUpperCase() });
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    })
  );
  vi.resetModules();
  r2 = await import('../sync/syncR2Client');
  r2.resetDirectCapabilityCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('magasin local — la localite est lue depuis les capacites', () => {
  it('reconnait `byosLocality: local`', async () => {
    expect(await r2.isLocalStore()).toBe(true);
  });
});

describe('magasin local — envoi', () => {
  it('demande une signature et N’UTILISE PAS le relais', async () => {
    await r2.uploadChunk('p1', 'f1', 0, Buffer.from('abc'));
    expect(routesAppelees).toContain('/sync/presign/upload-direct');
    // La regression a ne jamais rouvrir : le relais du worker.
    expect(routesAppelees).not.toContain('/sync/presign/upload');
    expect(urlsFetchees.some((f) => f.url.includes('/sync/upload/'))).toBe(false);
  });

  it('PUT les octets vers l’URL signee, pas vers l’API', async () => {
    await r2.uploadChunk('p1', 'f1', 0, Buffer.from('abc'));
    const put = urlsFetchees.find((f) => f.method === 'PUT');
    expect(put?.url).toBe('https://nas.invalid/sign-put');
    expect(put?.url).not.toContain('api.filarr.test');
  });
});

describe('magasin local — lecture', () => {
  it('passe par la signature de lecture, pas par le relais', async () => {
    await r2.downloadChunk('p1', 'f1', 0);
    expect(routesAppelees).toContain('/sync/presign/download-direct');
    expect(routesAppelees).not.toContain('/sync/presign/download');
    const get = urlsFetchees.find((f) => f.method === 'GET');
    expect(get?.url).toBe('https://nas.invalid/sign-get');
  });
});

describe('magasin local — effacement', () => {
  it('efface CHAQUE morceau par une signature, jamais par la route serveur', async () => {
    await r2.deleteFile('p1', 'f1', 3);
    const signatures = routesAppelees.filter((p) => p === '/sync/presign/delete-direct');
    // Un objet par morceau : trois morceaux, trois effacements.
    expect(signatures).toHaveLength(3);
    expect(routesAppelees.some((p) => p.startsWith('/sync/file/'))).toBe(false);
    expect(urlsFetchees.filter((f) => f.method === 'DELETE')).toHaveLength(3);
  });

  it('un morceau deja absent (404) n’est pas une erreur', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: { method?: string }) => {
        urlsFetchees.push({ url: String(input), method: (init?.method || 'GET').toUpperCase() });
        return new Response(null, { status: 404 });
      })
    );
    // Effacer ce qui n'est plus la, c'est le resultat recherche. Lever ici
    // laisserait l'entree dans le manifeste et rendrait la suppression
    // impossible a terminer.
    await expect(r2.deleteFile('p1', 'f1', 1)).resolves.toBeUndefined();
  });

  it('un REFUS (403) remonte — sinon on effacerait le manifeste en laissant les octets', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 403 }))
    );
    await expect(r2.deleteFile('p1', 'f1', 1)).rejects.toThrow(/403/);
  });
});
