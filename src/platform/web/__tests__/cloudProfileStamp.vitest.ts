import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * UN PROFIL RESTAURÉ APPARTIENT AU COMPTE — et l'écran doit le savoir.
 *
 * La restauration ramenait bien les profils, avec leur nom et leur couleur, et
 * l'utilisateur ne les retrouvait pourtant pas « dans la liste des profils de ce
 * compte » : `ProfilePicker` groupe sur `cloudAccount`, et rien ne posait cette
 * estampille. Les profils atterrissaient donc sous « Local », c'est-à-dire
 * exactement là où personne ne les cherchait — ce qui, du point de vue de la
 * personne, revient à ne pas les avoir retrouvés du tout.
 *
 * L'estampille n'est PAS une supposition : `/sync/profiles` est portée au
 * `user_id` du jeton, donc tout ce qu'elle rend appartient, par construction, au
 * compte qui vient de s'authentifier.
 *
 * Ce fichier exerce la VRAIE `restoreCloudProfiles`, en ne doublant que ses
 * frontières (réseau, IndexedDB, session, déchiffrement).
 */

const h = vi.hoisted(() => ({
  idb: new Map<string, unknown>(),
  user: null as { email: string; subscriptionTier: string; accountType?: string } | null,
  profilsDistants: [] as Array<{ profileId: string; manifestVersion: number }>,
  metaParProfil: new Map<string, unknown>(),
  illisibles: new Set<string>(),
  evenements: [] as string[],
  /** La liste des profils du compte répond 502 (réseau, passerelle). */
  listingDown: false,
}));

vi.mock('../webApiBase', () => ({
  registerSessionAccountHintProvider: () => undefined,
  apiFetch: vi.fn(async (path: string) => {
    if (path.startsWith('/sync/profiles')) {
      if (h.listingDown) return { status: 502, body: null };
      return { status: 200, body: { success: true, data: { profiles: h.profilsDistants } } };
    }
    // Le manifeste chiffré : `fetchManifestRaw` passe par là, on lui rend de
    // quoi produire le `profileMeta` attendu (voir le double de hybridCrypto).
    return { status: 404, body: { success: false, error: `route inattendue ${path}` } };
  }),
  getAccessToken: () => 'jeton-de-test',
  ensureAccessToken: async () => 'jeton-de-test',
  refreshViaCookie: async () => false,
  resolveApiBase: () => 'https://api.test',
}));

vi.mock('../handlers/authHandlers', () => ({
  getSessionUser: () => h.user,
}));

vi.mock('../idb', () => ({
  idbGet: async (k: string) => h.idb.get(k),
  idbPut: async (k: string, v: unknown) => {
    h.idb.set(k, v);
  },
  idbDelete: async (k: string) => {
    h.idb.delete(k);
  },
}));

vi.mock('../webEventBus', () => ({
  emitWebEvent: (nom: string) => {
    h.evenements.push(nom);
  },
}));

// Le coffre doit passer pour déverrouillé : `fekRawOrThrow` est privée à
// readSync et s'appuie sur `exportFEKRaw`, c'est donc celle-ci qu'on double.
vi.mock('../../../services/auth/hybridCrypto', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    exportFEKRaw: vi.fn(async () => new Uint8Array(32)),
    hasHybridKey: vi.fn(() => true),
  };
});

// Le conteneur chiffré n'est pas l'objet du test : on le traverse en clair, et
// l'on refuse ce que le scénario a marqué illisible — c'est le seul
// comportement de déchiffrement dont dépend la règle éprouvée ici.
vi.mock('../sync/containerCrypto', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    decryptFekContainer: vi.fn(async (bytes: Uint8Array) => {
      const texte = new TextDecoder().decode(bytes);
      if (texte === 'ILLISIBLE') {
        const err = new Error('déchiffrement impossible');
        err.name = 'OperationError';
        throw err;
      }
      return bytes;
    }),
  };
});

import { restoreCloudProfiles } from '../sync/readSync';

/** Le manifeste que le module lira pour un profil donné. */
function profilDistant(id: string, name: string) {
  h.profilsDistants.push({ profileId: id, manifestVersion: 1 });
  h.metaParProfil.set(id, { name, avatarColor: '#123456', createdAt: '2026-01-01' });
}

function profils(): Array<{ id: string; name?: string; cloudAccount?: { email?: string } }> {
  const m = h.idb.get('profiles_manifest') as
    | { profiles: Array<{ id: string; name?: string; cloudAccount?: { email?: string } }> }
    | undefined;
  return m?.profiles ?? [];
}

/** La règle exacte de ProfilePicker : sans `cloudAccount`, direction « Local ». */
function seau(p: { cloudAccount?: { email?: string } }): string {
  return p.cloudAccount?.email ?? 'local';
}

beforeEach(() => {
  h.idb.clear();
  h.profilsDistants = [];
  h.metaParProfil.clear();
  h.illisibles.clear();
  h.evenements = [];
  h.listingDown = false;
  h.user = { email: 'moi@example.com', subscriptionTier: 'pro', accountType: 'personal' };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const id = (/\/sync\/manifest\/([^/?]+)/.exec(String(url)) ?? [])[1] ?? '';
      const meta = h.metaParProfil.get(id);
      if (!meta) {
        return { ok: false, status: 404, json: async () => ({ success: false }) };
      }
      // `decryptFekContainer` est doublé en identité : le « chiffré » est donc
      // le JSON clair, encodé en base64 comme le fait le Worker.
      const clair = h.illisibles.has(id) ? 'ILLISIBLE' : JSON.stringify({ profileMeta: meta });
      const b64 = Buffer.from(clair, 'utf-8').toString('base64');
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ success: true, data: { manifest: b64, version: 1 } }),
      };
    })
  );
});

describe('restoreCloudProfiles — l’estampille de compte', () => {
  it('range le profil restauré sous le COMPTE, pas sous « Local »', async () => {
    profilDistant('p-distant', 'Travail');

    await restoreCloudProfiles();

    const restaure = profils().find((p) => p.id === 'p-distant');
    // Si la restauration n'a rien pu déchiffrer, le test n'a rien prouvé : on
    // l'exige explicitement plutôt que de laisser passer un vide silencieux.
    expect(restaure, 'aucun profil restauré — le double de déchiffrement a échoué').toBeDefined();
    expect(seau(restaure!)).toBe('moi@example.com');
    expect(restaure!.cloudAccount).toMatchObject({ email: 'moi@example.com', tier: 'pro' });
  });

  it('sans session lisible, restaure SANS estampille plutôt que de ne rien restaurer', async () => {
    // Un profil sans badge vaut mieux qu'un profil absent : le nom et le contenu
    // sont là, seul le regroupement se dégrade.
    h.user = null;
    profilDistant('p-distant', 'Travail');

    await restoreCloudProfiles();

    const restaure = profils().find((p) => p.id === 'p-distant');
    expect(restaure).toBeDefined();
    expect(restaure!.name).toBe('Travail');
    expect(restaure!.cloudAccount).toBeUndefined();
  });

  it('l’identité vient de la SESSION, jamais du manifeste distant', async () => {
    // Le manifeste est écrit par l'appareil d'origine : lui laisser porter
    // l'identité du compte reviendrait à faire confiance à une donnée qu'on ne
    // contrôle pas.
    h.profilsDistants.push({ profileId: 'p1', manifestVersion: 1 });
    h.metaParProfil.set('p1', {
      name: 'Travail',
      avatarColor: '#123456',
      createdAt: '2026-01-01',
      cloudAccount: { email: 'attaquant@example.com', tier: 'free' },
    });

    await restoreCloudProfiles();

    const restaure = profils().find((p) => p.id === 'p1');
    expect(restaure).toBeDefined();
    expect(restaure!.cloudAccount?.email).toBe('moi@example.com');
  });
});

/**
 * L'ESTAMPILLE À CHAQUE PASSAGE — le trou qui laissait « tous les comptes en
 * local » (prod, 2026-08-28) : un profil déjà présent était sauté AVANT d'être
 * estampillé. Restauré avant l'existence de l'estampille, ou né dans le
 * navigateur puis rattaché au compte, il restait « Local » pour toujours.
 */
describe('restoreAccountProfiles — les profils déjà là', () => {
  it('ré-estampille un profil déjà local, et le compte dans profileIds', async () => {
    const { restoreAccountProfiles } = await import('../sync/readSync');
    h.idb.set('profiles_manifest', {
      version: 1,
      activeProfileId: 'p-connu',
      profiles: [{ id: 'p-connu', name: 'Bureau', avatarColor: '#000' }],
      maxProfiles: 10,
      migratedFromLegacy: true,
    });
    h.profilsDistants.push({ profileId: 'p-connu', manifestVersion: 4 });
    profilDistant('p-neuf', 'Perso');

    const outcome = await restoreAccountProfiles();

    expect(outcome.restored).toBe(1);
    expect(outcome.profileIds.sort()).toEqual(['p-connu', 'p-neuf']);
    expect(seau(profils().find((p) => p.id === 'p-connu')!)).toBe('moi@example.com');
    expect(h.evenements).toContain('profiles-updated');
  });

  it('ne réécrit pas le manifeste quand l’estampille est déjà la bonne', async () => {
    const { restoreAccountProfiles } = await import('../sync/readSync');
    h.idb.set('profiles_manifest', {
      version: 1,
      activeProfileId: 'p-connu',
      profiles: [{ id: 'p-connu', cloudAccount: { email: 'MOI@example.com', tier: 'pro' } }],
      maxProfiles: 10,
      migratedFromLegacy: true,
    });
    h.profilsDistants.push({ profileId: 'p-connu', manifestVersion: 4 });

    const outcome = await restoreAccountProfiles();

    expect(outcome.profileIds).toEqual(['p-connu']);
    expect(h.evenements).not.toContain('profiles-updated');
  });

  it('un profil illisible est nommé, écarté pour la session, puis retenté après une nouvelle clé', async () => {
    const { restoreAccountProfiles, resetUnreadableProfiles, getUnreadableProfileIds } =
      await import('../sync/readSync');
    profilDistant('p-chiffre-ailleurs', 'Bureau');
    h.illisibles.add('p-chiffre-ailleurs');

    const first = await restoreAccountProfiles();
    expect(first.restored).toBe(0);
    expect(first.unreadable).toEqual(['p-chiffre-ailleurs']);
    expect(getUnreadableProfileIds()).toEqual(['p-chiffre-ailleurs']);

    // Une nouvelle clé arrive (sync:setSessionKey → reset) et cette fois elle ouvre.
    h.illisibles.clear();
    resetUnreadableProfiles();
    const second = await restoreAccountProfiles();
    expect(second.restored).toBe(1);
    expect(second.unreadable).toEqual([]);
  });

  it('une liste injoignable n’est pas « aucun profil » : on LÈVE, l’appelant ne crée pas de doublon', async () => {
    const { restoreAccountProfiles } = await import('../sync/readSync');
    h.listingDown = true;
    await expect(restoreAccountProfiles()).rejects.toThrow('sync/profiles');
  });

  it('un profil listé sous ce compte mais rattaché à un AUTRE garde son compte', async () => {
    const { restoreAccountProfiles } = await import('../sync/readSync');
    h.idb.set('profiles_manifest', {
      version: 1,
      activeProfileId: 'p-autre',
      profiles: [{ id: 'p-autre', cloudAccount: { email: 'autre@example.com', tier: 'free' } }],
      maxProfiles: 10,
      migratedFromLegacy: true,
    });
    h.profilsDistants.push({ profileId: 'p-autre', manifestVersion: 2 });
    const outcome = await restoreAccountProfiles();
    expect(outcome.profileIds).toEqual([]);
    expect(seau(profils().find((p) => p.id === 'p-autre')!)).toBe('autre@example.com');
    expect(h.evenements).not.toContain('profiles-updated');
  });
});
