/**
 * LE SCÉNARIO DU 28 AOÛT, REJOUÉ AVEC LA VRAIE CRYPTO.
 *
 * Ce que le fondateur a vu sur app.filarr.com : connecté, `auth:getMe` répond,
 * et pourtant « mes comptes restent tous en local », rien ne descend, et la
 * console dit `[webSync] profil nuage <id bureau> illisible avec la clé
 * actuelle : OperationError` pour ses deux profils bureau.
 *
 * Ce qui s'était passé : `wrapped_fek` était UNE clé IndexedDB globale du
 * navigateur, jamais effacée, lue AVANT la copie du serveur. Un second compte
 * (essais d'invitation) y avait laissé SON blob ; avec le même mot de passe, le
 * compte principal adoptait en silence une FEK étrangère, et ses manifestes
 * bureau ne se déchiffraient plus.
 *
 * Ici : hybridCrypto RÉEL (PBKDF2, AES-GCM wrap), custodyHandlers RÉELS,
 * authHandlers et profileHandlers RÉELS, restauration RÉELLE, containerCrypto
 * RÉEL. Seules les frontières sont doublées : réseau, IndexedDB, ordonnanceur.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  idb: new Map<string, unknown>(),
  token: null as string | null,
  server: {
    wrappedKey: null as Record<string, unknown> | null,
    /** 'ok' = la ligne du compte (ou 404 si nulle) ; 'down' = réseau HS. */
    wrappedKeyMode: 'ok' as 'ok' | 'down',
    profiles: [] as Array<{ profileId: string; manifestVersion: number }>,
    manifests: new Map<string, string>(),
    puts: [] as Array<Record<string, unknown>>,
  },
  user: { id: 'u-a', email: 'a@example.com', subscriptionTier: 'solo', accountType: 'personal' },
}));

vi.mock('../idb', () => ({
  idbGet: async (k: string) => h.idb.get(k) ?? null,
  idbPut: async (k: string, v: unknown) => {
    h.idb.set(k, v);
  },
  idbDelete: async (k: string) => {
    h.idb.delete(k);
  },
  idbKeys: async () => [...h.idb.keys()],
}));

vi.mock('../webStore', () => {
  const active = async () => {
    const m = h.idb.get('profiles_manifest') as { activeProfileId: string | null } | undefined;
    return m?.activeProfileId ?? null;
  };
  const scoped = async (key: string) => `p:${await active()}:${key}`;
  return {
    getActiveProfileId: active,
    storeGet: async (key: string) => h.idb.get(await scoped(key)) ?? null,
    storePut: async (key: string, value: unknown) => {
      h.idb.set(await scoped(key), value);
    },
    storeDelete: async (key: string) => {
      h.idb.delete(await scoped(key));
    },
    forProfile: (pid: string) => ({
      get: async (key: string) => h.idb.get(`p:${pid}:${key}`) ?? null,
      put: async (key: string, value: unknown) => {
        h.idb.set(`p:${pid}:${key}`, value);
      },
      delete: async (key: string) => {
        h.idb.delete(`p:${pid}:${key}`);
      },
    }),
    purgeProfileScope: async () => 0,
  };
});

vi.mock('../webEventBus', () => ({ emitWebEvent: () => undefined }));
vi.mock('../sync/syncScheduler', () => ({
  startSyncScheduler: () => undefined,
  stopSyncScheduler: () => undefined,
}));

vi.mock('../webApiBase', () => ({
  // 0091 : l'adoption de l'identifiant canonique est un no-op ici.
  adoptWebDeviceId: () => undefined,
  registerSessionAccountHintProvider: () => undefined,
  resolveApiBase: () => 'https://api.test',
  getAccessToken: () => h.token,
  // Le jeton du double ne porte pas d'echeance : frais tant qu'il existe.
  ensureAccessToken: async () => h.token,
  setAccessToken: (t: string | null) => {
    h.token = t;
  },
  getWebDeviceId: () => 'web-test',
  getWebDeviceName: () => 'Test (web)',
  refreshViaCookie: async () => false,
  apiFetch: vi.fn(async (path: string, init?: { method?: string; body?: unknown }) => {
    if (path === '/auth/login') {
      return { status: 200, body: { success: true, data: { accessToken: 'tok', user: h.user } } };
    }
    if (path === '/auth/me')
      return { status: 200, body: { success: true, data: { user: h.user } } };
    if (path === '/auth/logout') return { status: 200, body: { success: true } };
    if (path === '/account/wrapped-key' && (init?.method ?? 'GET') === 'GET') {
      if (h.server.wrappedKeyMode === 'down') throw new TypeError('Failed to fetch');
      if (!h.server.wrappedKey) {
        return { status: 404, body: { success: false, error: 'No wrapped key stored' } };
      }
      return { status: 200, body: { success: true, data: h.server.wrappedKey } };
    }
    if (path === '/account/wrapped-key' && init?.method === 'PUT') {
      const body = init.body as Record<string, unknown>;
      h.server.puts.push(body);
      // Le serveur accepte 'initial' seulement s'il n'a rien ; sinon 409.
      if (body.expectedPreviousDigest === 'initial' && !h.server.wrappedKey) {
        h.server.wrappedKey = { wrappedFek: body.wrappedFek, kekSalt: body.kekSalt, version: 1 };
        return { status: 200, body: { success: true } };
      }
      return { status: 409, body: { success: false, error: 'conflict' } };
    }
    if (path.startsWith('/sync/profiles')) {
      return { status: 200, body: { success: true, data: { profiles: h.server.profiles } } };
    }
    return { status: 404, body: { success: false, error: `route inattendue ${path}` } };
  }),
}));

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');

/** Le pont : custody, auth et profils vont aux vrais handlers, le reste est muet. */
async function installBridge(): Promise<void> {
  const { custodyHandlers } = await import('../handlers/custodyHandlers');
  const { authHandlers } = await import('../handlers/authHandlers');
  const { profileHandlers } = await import('../handlers/profileHandlers');
  const invoke: Invoke = async (channel, ...args) => {
    const handler = custodyHandlers[channel] ?? authHandlers[channel] ?? profileHandlers[channel];
    if (handler) return handler(...args);
    return null;
  };
  Object.defineProperty(globalThis, 'window', {
    value: {
      electron: { ipcRenderer: { invoke } },
      __FILARR_WEB__: true,
      // pendingUploads.ts pose un `beforeunload` à l'import.
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    configurable: true,
    writable: true,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const id = (/\/sync\/manifest\/([^/?]+)/.exec(String(url)) ?? [])[1] ?? '';
      const manifest = h.server.manifests.get(id);
      if (!manifest) return { ok: false, status: 404, json: async () => ({ success: false }) };
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ success: true, data: { manifest, version: 3 } }),
      };
    })
  );
}

const PASSWORD = 'même mot de passe partout';
const DESKTOP_PROFILE = 'affb7e4f-8afe-4b4e-8a93-9e72fa3a8add';

/** Une FEK enveloppée sous `password`, et ses octets — comme un appareil l'aurait fait. */
async function makeWrappedFek(password: string) {
  const crypto = await import('../../../services/auth/hybridCrypto');
  const blob = await crypto.generateAndWrapFEK(password);
  const raw = await crypto.exportFEKRaw();
  crypto.clearHybridCrypto();
  if (!raw) throw new Error('FEK non exportable');
  return { blob, raw: new Uint8Array(raw) };
}

async function desktopManifestEncryptedWith(fekRaw: Uint8Array): Promise<string> {
  const { encryptFekContainer } = await import('../sync/containerCrypto');
  const plain = new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      files: {},
      profileMeta: { name: 'Bureau', avatarColor: '#336699', createdAt: '2026-01-01' },
    })
  );
  return b64(await encryptFekContainer(plain, fekRaw));
}

type ProfileRow = { id: string; name?: string; cloudAccount?: { email?: string } | null };
function manifestProfiles(): ProfileRow[] {
  const m = h.idb.get('profiles_manifest') as { profiles: ProfileRow[] } | undefined;
  return m?.profiles ?? [];
}

function seedManifest(active: string, profiles: ProfileRow[]): void {
  h.idb.set('profiles_manifest', {
    version: 1,
    activeProfileId: active,
    profiles: profiles.map((p, i) => ({
      name: p.id,
      avatarColor: '#000',
      pinAttempts: 0,
      createdAt: '2026-08-20',
      lastAccessedAt: '2026-08-20',
      isDefault: i === 0,
      order: i,
      ...p,
    })),
    maxProfiles: 10,
    migratedFromLegacy: true,
  });
}

/** `sync:setSessionKey` part en tâche de fond : on lui laisse le temps d'atterrir. */
async function settle(until: () => boolean, ms = 3000): Promise<void> {
  const t0 = Date.now();
  while (!until() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 20));
}

async function fekInMemory(): Promise<string | null> {
  const crypto = await import('../../../services/auth/hybridCrypto');
  const raw = await crypto.exportFEKRaw();
  return raw ? b64(new Uint8Array(raw)) : null;
}

beforeEach(async () => {
  vi.resetModules();
  h.idb.clear();
  h.token = null;
  h.server.wrappedKey = null;
  h.server.wrappedKeyMode = 'ok';
  h.server.profiles = [];
  h.server.manifests.clear();
  h.server.puts = [];
  // Le navigateur porte déjà un profil né sur le web, actif, sans estampille.
  seedManifest('web-1', [{ id: 'web-1', name: 'a' }]);
  await installBridge();
});

describe('la clé du compte, malgré un blob étranger dans le navigateur', () => {
  it('adopte la FEK du serveur, déchiffre le profil bureau, et l’estampille au compte', async () => {
    const a = await makeWrappedFek(PASSWORD); // le compte du fondateur
    const b = await makeWrappedFek(PASSWORD); // un second compte, même mot de passe
    h.idb.set('wrapped_fek', b.blob); // ← le résidu global d'hier
    h.server.wrappedKey = { ...a.blob }; // ← la copie du compte, posée par le bureau
    h.server.profiles = [{ profileId: DESKTOP_PROFILE, manifestVersion: 3 }];
    h.server.manifests.set(DESKTOP_PROFILE, await desktopManifestEncryptedWith(a.raw));

    const { authHandlers } = await import('../handlers/authHandlers');
    await authHandlers['auth:login']('a@example.com', PASSWORD);

    const crypto = await import('../../../services/auth/hybridCrypto');
    await crypto.initHybridCrypto(PASSWORD);
    expect(await fekInMemory()).toBe(b64(a.raw));
    expect(await fekInMemory()).not.toBe(b64(b.raw));

    // L'installation de la clé ramène les profils du compte, sans attendre un cycle.
    await settle(() => manifestProfiles().some((p) => p.id === DESKTOP_PROFILE));
    const { restoreAccountProfiles, getUnreadableProfileIds } = await import('../sync/readSync');
    const outcome = await restoreAccountProfiles();
    expect(outcome.unreadable).toEqual([]);
    expect(outcome.profileIds).toContain(DESKTOP_PROFILE);
    expect(getUnreadableProfileIds()).toEqual([]);

    const bureau = manifestProfiles().find((p) => p.id === DESKTOP_PROFILE);
    expect(bureau?.name).toBe('Bureau');
    expect(bureau?.cloudAccount?.email).toBe('a@example.com');
    // Et le profil web dans lequel on s'est connecté n'est plus « Local ».
    expect(manifestProfiles().find((p) => p.id === 'web-1')?.cloudAccount?.email).toBe(
      'a@example.com'
    );

    // Le cache est celui du COMPTE ; le résidu global n'a été ni adopté ni touché.
    expect(h.idb.get('wrapped_fek:acct:a@example.com')).toMatchObject({
      wrappedFek: a.blob.wrappedFek,
    });
    expect(h.idb.get('wrapped_fek')).toBe(b.blob);
    // Rien n'a été poussé par-dessus la clé du serveur.
    expect(h.server.puts).toEqual([]);
  }, 60_000);

  it('une mauvaise clé écarte le profil ; la bonne clé le ramène (sans attendre un rechargement)', async () => {
    const a = await makeWrappedFek(PASSWORD);
    h.server.wrappedKey = { ...a.blob };
    h.server.profiles = [{ profileId: DESKTOP_PROFILE, manifestVersion: 3 }];
    h.server.manifests.set(DESKTOP_PROFILE, await desktopManifestEncryptedWith(a.raw));
    const { authHandlers } = await import('../handlers/authHandlers');
    await authHandlers['auth:login']('a@example.com', PASSWORD);

    // Une clé QUELCONQUE en mémoire (le blob étranger d'hier, déjà déballé).
    const crypto = await import('../../../services/auth/hybridCrypto');
    await crypto.generateAndWrapFEK('autre');
    const { restoreAccountProfiles, getUnreadableProfileIds } = await import('../sync/readSync');
    const first = await restoreAccountProfiles();
    expect(first.restored).toBe(0);
    expect(first.unreadable).toEqual([DESKTOP_PROFILE]);
    expect(getUnreadableProfileIds()).toEqual([DESKTOP_PROFILE]);

    // La bonne clé s'installe (initHybridCrypto → sync:setSessionKey → reset + restauration).
    crypto.clearHybridCrypto();
    await crypto.initHybridCrypto(PASSWORD);
    await settle(() => manifestProfiles().some((p) => p.id === DESKTOP_PROFILE));
    expect(getUnreadableProfileIds()).toEqual([]);
    expect(manifestProfiles().find((p) => p.id === DESKTOP_PROFILE)?.name).toBe('Bureau');
  }, 60_000);

  it('serveur injoignable et aucun cache : on LÈVE, on ne fabrique pas une FEK neuve', async () => {
    const b = await makeWrappedFek(PASSWORD);
    h.idb.set('wrapped_fek', b.blob);
    h.server.wrappedKeyMode = 'down';
    const { authHandlers } = await import('../handlers/authHandlers');
    await authHandlers['auth:login']('a@example.com', PASSWORD);

    const crypto = await import('../../../services/auth/hybridCrypto');
    await expect(crypto.initHybridCrypto(PASSWORD)).rejects.toThrow();
    expect(crypto.hasHybridKey()).toBe(false);
    expect(h.server.puts).toEqual([]);
  }, 60_000);

  it('compte qui a des données mais pas de clé publiée, blob non attribué dans le navigateur : on LÈVE, rien n’est fabriqué', async () => {
    const b = await makeWrappedFek(PASSWORD);
    h.idb.set('wrapped_fek', b.blob);
    h.server.wrappedKey = null; // compte d'avant la copie serveur
    h.server.profiles = [{ profileId: DESKTOP_PROFILE, manifestVersion: 3 }];
    const { authHandlers } = await import('../handlers/authHandlers');
    await authHandlers['auth:login']('a@example.com', PASSWORD);

    const crypto = await import('../../../services/auth/hybridCrypto');
    await expect(crypto.initHybridCrypto(PASSWORD)).rejects.toMatchObject({
      code: 'wrapped_key_unavailable',
    });
    expect(crypto.hasHybridKey()).toBe(false);
    expect(h.server.puts).toEqual([]);
    expect(h.idb.get('wrapped_fek')).toBe(b.blob);
  }, 60_000);

  it('compte NEUF sur un navigateur qui porte un blob non attribué : une FEK est créée, le résidu ignoré', async () => {
    // Le cas du fondateur créant un compte de test après l'incident.
    const b = await makeWrappedFek(PASSWORD);
    h.idb.set('wrapped_fek', b.blob);
    h.server.wrappedKey = null;
    const { authHandlers } = await import('../handlers/authHandlers');
    await authHandlers['auth:login']('a@example.com', PASSWORD);
    const crypto = await import('../../../services/auth/hybridCrypto');
    await crypto.initHybridCrypto(PASSWORD);
    expect(crypto.hasHybridKey()).toBe(true);
    expect(await fekInMemory()).not.toBe(b64(b.raw));
    expect(h.server.puts).toHaveLength(1);
    expect(h.server.puts[0].expectedPreviousDigest).toBe('initial');
    expect(h.idb.get('wrapped_fek:acct:a@example.com')).toBeTruthy();
    expect(h.idb.get('wrapped_fek')).toBe(b.blob);
  }, 60_000);
});

describe('la clé suit le profil', () => {
  it('un profil local qu’on rattache à un compte neuf GARDE sa clé, et la propose au compte', async () => {
    // Profil local web : sa propre clé (FEK1), des notes chiffrées avec.
    const own = await makeWrappedFek(PASSWORD);
    h.idb.set('wrapped_fek:p:web-1', own.blob);
    h.idb.set('p:web-1:notes_enc', 'des notes chiffrées avec FEK1');
    h.server.wrappedKey = null; // le compte vient d'être créé

    const { authHandlers } = await import('../handlers/authHandlers');
    const login = (await authHandlers['auth:login']('a@example.com', PASSWORD)) as {
      profileNeedsAttachProof?: boolean;
    };

    /**
     * ⚠ LA CONNEXION NE RATTACHE PLUS TOUTE SEULE, ET C'EST LE POINT.
     *
     * Ce test exigeait l'estampille juste apres `auth:login`. C'etait le
     * comportement d'avant, et il portait une perte de donnees differee : le
     * compte adoptait la cle du profil, donc le mot de passe de coffre choisi
     * pour ce profil -- souvent un mot de passe jetable -- devenait celui qui
     * deverrouille le compte sur TOUS ses appareils. Le mot de passe du compte,
     * lui, n'y donne aucun acces : il n'enveloppe que la paire de cles
     * d'identite.
     *
     * La connexion reussit donc, mais le rattachement attend une PREUVE :
     * retaper le mot de passe de coffre, au seul moment ou se tromper est
     * encore gratuit puisque les donnees sont encore uniquement locales.
     */
    expect(login.profileNeedsAttachProof).toBe(true);
    expect(manifestProfiles().find((p) => p.id === 'web-1')?.cloudAccount).toBeFalsy();

    // Le geste explicite, avec la preuve. C'est LUI qui estampille.
    const { attachActiveProfileToAccount } = await import('../handlers/custodyHandlers');
    expect(await attachActiveProfileToAccount('mauvais-mot-de-passe')).toEqual({
      ok: false,
      code: 'wrong-password',
    });
    expect(manifestProfiles().find((p) => p.id === 'web-1')?.cloudAccount).toBeFalsy();

    expect(await attachActiveProfileToAccount(PASSWORD)).toEqual({ ok: true });
    expect(manifestProfiles().find((p) => p.id === 'web-1')?.cloudAccount?.email).toBe(
      'a@example.com'
    );

    const crypto = await import('../../../services/auth/hybridCrypto');
    await crypto.initHybridCrypto(PASSWORD);
    // FEK1 reste la clé du profil — ses notes restent lisibles…
    expect(await fekInMemory()).toBe(b64(own.raw));
    // …et c'est ELLE que le compte adopte (repli 'initial'), pas une clé neuve.
    await settle(() => h.server.puts.length > 0);
    expect(h.server.puts[0]).toMatchObject({
      wrappedFek: own.blob.wrappedFek,
      expectedPreviousDigest: 'initial',
    });
    // Publiée, la clé du profil est devenue celle du compte : elle a migré
    // sous sa portée, et un second `initHybridCrypto` (mot de passe oublié,
    // migration…) NE la republie PAS — le 409 d'hier effaçait tout.
    await settle(() => h.idb.get('wrapped_fek:acct:a@example.com') !== undefined);
    expect(h.idb.get('wrapped_fek:p:web-1')).toBeUndefined();
    crypto.clearHybridCrypto();
    await crypto.initHybridCrypto(PASSWORD);
    await new Promise((r) => setTimeout(r, 50));
    expect(crypto.hasHybridKey()).toBe(true);
    expect(await fekInMemory()).toBe(b64(own.raw));
    expect(h.server.puts).toHaveLength(1);
  }, 60_000);

  it('« + Ajouter un compte » : le profil d’un autre compte resté actif n’est ni rebaptisé ni re-clé', async () => {
    const t = await makeWrappedFek(PASSWORD); // le compte de test, même mot de passe
    const a = await makeWrappedFek(PASSWORD); // le compte du fondateur
    seedManifest('p-t', [{ id: 'p-t', cloudAccount: { email: 't@example.com' } }]);
    h.idb.set('wrapped_fek:acct:t@example.com', t.blob);
    h.server.wrappedKey = { ...a.blob };
    h.server.profiles = [{ profileId: DESKTOP_PROFILE, manifestVersion: 3 }];
    h.server.manifests.set(DESKTOP_PROFILE, await desktopManifestEncryptedWith(a.raw));

    const { authHandlers } = await import('../handlers/authHandlers');
    await authHandlers['auth:beginPendingSession']();
    await authHandlers['auth:login']('a@example.com', PASSWORD);
    const crypto = await import('../../../services/auth/hybridCrypto');
    await crypto.initHybridCrypto(PASSWORD);
    expect(await fekInMemory()).toBe(b64(a.raw));

    // Le profil de test n'a pas bougé : ni son estampille, ni sa clé.
    expect(manifestProfiles().find((p) => p.id === 'p-t')?.cloudAccount?.email).toBe(
      't@example.com'
    );
    expect(h.idb.get('wrapped_fek:acct:t@example.com')).toBe(t.blob);
    expect(h.idb.get('wrapped_fek:acct:a@example.com')).toMatchObject({
      wrappedFek: a.blob.wrappedFek,
    });

    // Le profil bureau du fondateur arrive, et l'ouvrir referme la démarche.
    await settle(() => manifestProfiles().some((p) => p.id === DESKTOP_PROFILE));
    const { profileHandlers } = await import('../handlers/profileHandlers');
    await profileHandlers['profile:activate'](DESKTOP_PROFILE);
    expect((await authHandlers['auth:pendingSessionStatus']()) as object).toMatchObject({
      pending: false,
    });
    expect(manifestProfiles().find((p) => p.id === DESKTOP_PROFILE)?.cloudAccount?.email).toBe(
      'a@example.com'
    );
  }, 60_000);
});
