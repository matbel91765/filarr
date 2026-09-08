/**
 * L'estampille de compte sur les profils WEB — posée par la session, comme sur
 * le bureau (authService.saveUserCache → profileManager.setCloudAccount), mais
 * avec les règles que la session DU NAVIGATEUR impose :
 *  - jamais par-dessus l'estampille d'un autre compte — se connecter « dans »
 *    un profil rattaché à un autre compte est REFUSÉ (le chemin est
 *    « + Ajouter un compte ») ;
 *  - un profil sans estampille n'est rattaché que par une connexion EXPLICITE,
 *    pas par la restauration de session au chargement ni par un getMe ;
 *  - pendant « + Ajouter un compte » (royaume en attente), le profil resté
 *    actif n'est pas touché : c'est le profil activé ou créé qui adopte, et
 *    ouvrir le profil d'un autre compte abandonne la démarche ;
 *  - une connexion faite SANS profil actif (premier lancement) ouvre un
 *    royaume implicite : le profil créé ensuite adopte, un profil créé hors de
 *    toute démarche (le « + » du sélecteur) reste local ;
 *  - se déconnecter ne retire pas l'estampille (elle route aussi la clé).
 *
 * LE DÉFAUT QUE CECI ÉPINGLE (prod, 2026-08-28) : « mes comptes restent tous en
 * local ». Et l'inverse, que la première correction réintroduisait : le profil
 * d'un autre compte rebaptisé au nom de la session.
 *
 * authHandlers et profileHandlers RÉELS ; réseau et IndexedDB doublés.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  idb: new Map<string, unknown>(),
  token: null as string | null,
  user: { id: 'u-a', email: 'a@example.com', subscriptionTier: 'solo', accountType: 'personal' },
  events: [] as string[],
  logouts: 0,
  /** Le cookie de rafraîchissement : révoqué par la déconnexion, comme en vrai. */
  cookieValid: true,
  /** La clé enveloppée du compte côté serveur (null = 404). */
  cloudKey: null as Record<string, unknown> | null,
  /** GET /account/wrapped-key injoignable (réseau, 5xx). */
  cloudKeyDown: false,
  /** Le jeton en mémoire a dépassé son `exp` — présent, et inutile. */
  tokenExpired: false,
  /** Nombre de re-frappes demandées au cookie. */
  refreshes: 0,
  /** Cookies PAR COMPTE que ce navigateur détient (userId → compte servi). */
  cookieAccounts: {} as Record<
    string,
    { id: string; email: string; subscriptionTier: string; accountType: 'personal' | 'enterprise' }
  >,
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
vi.mock('../webStore', () => ({
  getActiveProfileId: async () =>
    (h.idb.get('profiles_manifest') as { activeProfileId: string | null } | undefined)
      ?.activeProfileId ?? null,
  storeDelete: vi.fn(async () => undefined),
  purgeProfileScope: async () => 0,
}));
vi.mock('../webEventBus', () => ({
  emitWebEvent: (name: string) => {
    h.events.push(name);
  },
}));
vi.mock('../sync/readSync', () => ({
  resetUnreadableProfiles: () => undefined,
  restoreAccountProfiles: async () => ({ restored: 0, profileIds: [], unreadable: [] }),
}));
vi.mock('../sync/syncScheduler', () => ({
  startSyncScheduler: () => undefined,
  stopSyncScheduler: () => undefined,
}));
vi.mock('../../../i18n/config', () => ({
  default: { t: (_k: string, fallback: string) => fallback },
}));
vi.mock('../webApiBase', () => ({
  // 0091 : l'adoption de l'identifiant canonique est un no-op ici.
  adoptWebDeviceId: () => undefined,
  registerSessionAccountHintProvider: () => undefined,
  // `getAccessToken` rend le jeton BRUT, périmé ou non : c'est le trou par
  // lequel un jeton mort partait chez tous les appelants du renderer.
  getAccessToken: () => h.token,
  // `ensureAccessToken` rend un jeton FRAIS, en re-frappant s'il le faut —
  // contrat éprouvé contre le vrai module (accessTokenFreshness.vitest.ts).
  ensureAccessToken: async () => {
    if (h.token && h.tokenExpired) {
      h.refreshes += 1;
      if (h.cookieValid) {
        h.token = 'tok-frais';
        h.tokenExpired = false;
      }
    }
    return h.token;
  },
  setAccessToken: (t: string | null) => {
    h.token = t;
    h.tokenExpired = false;
  },
  getWebDeviceId: () => 'web-test',
  getWebDeviceName: () => 'Test (web)',
  // Avec un indice : le contrat des cookies par-compte du Worker — SEUL le
  // cookie de ce compte répond, et la session servie est la SIENNE.
  refreshViaCookie: async (hint?: string) => {
    if (hint) {
      const account = h.cookieAccounts[hint];
      if (!account) return false;
      h.user = account;
      h.token = `tok-${hint}`;
      h.tokenExpired = false;
      return true;
    }
    return h.cookieValid;
  },
  apiFetch: vi.fn(async (path: string) => {
    if (path === '/auth/login') {
      h.cookieValid = true;
      return { status: 200, body: { success: true, data: { accessToken: 'tok', user: h.user } } };
    }
    if (path === '/auth/me')
      return { status: 200, body: { success: true, data: { user: h.user } } };
    if (path === '/auth/logout') {
      h.logouts++;
      h.cookieValid = false;
      return { status: 200, body: { success: true } };
    }
    if (path === '/account/wrapped-key') {
      if (h.cloudKeyDown) throw new TypeError('Failed to fetch');
      if (!h.cloudKey) return { status: 404, body: { success: false } };
      return { status: 200, body: { success: true, data: h.cloudKey } };
    }
    return { status: 404, body: { success: false } };
  }),
}));

type Stamped = { id: string; cloudAccount?: { email: string; tier: string } | null };
const profiles = () =>
  ((h.idb.get('profiles_manifest') as { profiles: Stamped[] } | undefined)?.profiles ??
    []) as Stamped[];
const profile = (id: string) => profiles().find((p) => p.id === id);

function seed(active: string | null, list: Array<Partial<Stamped> & { id: string }>): void {
  h.idb.set('profiles_manifest', {
    version: 1,
    activeProfileId: active,
    profiles: list.map((p, i) => ({
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

async function modules() {
  const { authHandlers } = await import('../handlers/authHandlers');
  const { profileHandlers } = await import('../handlers/profileHandlers');
  return { authHandlers, profileHandlers };
}

const pending = async (auth: Record<string, (...a: unknown[]) => unknown>) =>
  ((await auth['auth:pendingSessionStatus']()) as { pending: boolean }).pending;

beforeEach(() => {
  vi.resetModules(); // session et royaume sont des états de module
  h.idb.clear();
  h.token = null;
  h.events = [];
  h.logouts = 0;
  h.cookieValid = true;
  h.cloudKey = null;
  h.cloudKeyDown = false;
  h.tokenExpired = false;
  h.refreshes = 0;
});

describe('connexion explicite dans un profil', () => {
  it('login → le profil actif sans compte est rattaché ; getMe ne réécrit rien ; logout garde l’estampille', async () => {
    const { authHandlers } = await modules();
    seed('web-1', [{ id: 'web-1' }]);
    await expect(authHandlers['auth:login']('a@example.com', 'pw')).resolves.toMatchObject({
      success: true,
    });
    expect(profile('web-1')?.cloudAccount).toMatchObject({ email: 'a@example.com', tier: 'solo' });
    expect(h.events).toContain('profiles-updated');
    // L'ÉCRAN EST PRÉVENU : sans cet événement, Redux gardait
    // `profileAttachedTo: null` et les réglages proposaient de rattacher un
    // profil qui venait de l'être — jusqu'au prochain changement de profil.
    expect(h.events).toContain('auth-status-changed');
    expect(await pending(authHandlers)).toBe(false);

    h.events = [];
    await authHandlers['auth:getMe']();
    expect(h.events).not.toContain('profiles-updated');

    await authHandlers['auth:logout']();
    // L'estampille route aussi la clé du profil : elle survit à la déconnexion.
    expect(profile('web-1')?.cloudAccount?.email).toBe('a@example.com');
  });

  it('se connecter DANS un profil rattaché à un autre compte est refusé, et la session révoquée', async () => {
    const { authHandlers } = await modules();
    seed('p-b', [{ id: 'p-b', cloudAccount: { email: 'b@example.com', tier: 'free' } }]);
    const res = (await authHandlers['auth:login']('a@example.com', 'pw')) as {
      success: boolean;
      code?: string;
      error?: string;
    };
    expect(res.success).toBe(false);
    expect(res.code).toBe('profile_bound_to_other_account');
    expect(res.error).toBeTruthy();
    expect(profile('p-b')?.cloudAccount?.email).toBe('b@example.com');
    expect(h.logouts).toBe(1);
    expect((await authHandlers['auth:getStatus']()) as object).toMatchObject({
      accountMode: 'local',
    });
  });

  it('refuser DANS le profil d’un autre compte ne révoque pas une session qui était déjà celle du même compte', async () => {
    const { authHandlers } = await modules();
    seed('p-b', [{ id: 'p-b', cloudAccount: { email: 'b@example.com', tier: 'free' } }]);
    // La session A est déjà ouverte (cookie), l’utilisateur ouvre P_B puis se reconnecte à A par erreur.
    await authHandlers['auth:getStatus']();
    expect((await authHandlers['auth:getStatus']()) as object).toMatchObject({
      accountMode: 'cloud',
    });
    const res = (await authHandlers['auth:login']('a@example.com', 'pw')) as {
      success: boolean;
      code?: string;
    };
    expect(res.success).toBe(false);
    expect(res.code).toBe('profile_bound_to_other_account');
    expect(h.logouts).toBe(0);
    expect((await authHandlers['auth:getStatus']()) as object).toMatchObject({
      accountMode: 'cloud',
    });
  });

  it('un profil qui détient SA clé ne se rattache pas à un compte qui en a déjà une autre', async () => {
    const { authHandlers } = await modules();
    seed('local', [{ id: 'local' }]);
    h.idb.set('wrapped_fek:p:local', { wrappedFek: 'L', kekSalt: 's', version: 1 });
    h.cloudKey = { wrappedFek: 'A', kekSalt: 'sa', version: 1 };
    const res = (await authHandlers['auth:login']('a@example.com', 'pw')) as {
      success: boolean;
      code?: string;
      error?: string;
    };
    expect(res.success).toBe(false);
    expect(res.code).toBe('profile_key_conflict');
    expect(profile('local')?.cloudAccount).toBeUndefined();
    expect(h.logouts).toBe(1);
    // Même clé (ou compte vide) : le rattachement passe.
    vi.resetModules();
    const again = await modules();
    h.cloudKey = { wrappedFek: 'L', kekSalt: 's', version: 1 };
    await expect(again.authHandlers['auth:login']('a@example.com', 'pw')).resolves.toMatchObject({
      success: true,
    });
    expect(profile('local')?.cloudAccount?.email).toBe('a@example.com');
  });

  it('clé du compte invérifiable (réseau) : on ne rattache pas à l’aveugle', async () => {
    const { authHandlers } = await modules();
    seed('local', [{ id: 'local' }]);
    h.idb.set('wrapped_fek:p:local', { wrappedFek: 'L', kekSalt: 's', version: 1 });
    h.cloudKeyDown = true;
    const res = (await authHandlers['auth:login']('a@example.com', 'pw')) as {
      success: boolean;
      code?: string;
    };
    expect(res.success).toBe(false);
    expect(res.code).toBe('profile_key_check_failed');
    expect(profile('local')?.cloudAccount).toBeUndefined();
  });

  it('un refus ne touche pas au scellé « Rester déverrouillé » du profil affiché', async () => {
    const { authHandlers } = await modules();
    const { storeDelete } = await import('../webStore');
    seed('p-b', [{ id: 'p-b', cloudAccount: { email: 'b@example.com', tier: 'free' } }]);
    vi.mocked(storeDelete).mockClear();
    await authHandlers['auth:login']('a@example.com', 'pw');
    expect(vi.mocked(storeDelete)).not.toHaveBeenCalled();
    expect(h.logouts).toBe(1);
  });

  it('se déconnecter le DIT à l’écran (auth-status-changed)', async () => {
    const { authHandlers } = await modules();
    seed('web-1', [{ id: 'web-1' }]);
    await authHandlers['auth:login']('a@example.com', 'pw');
    h.events = [];
    await authHandlers['auth:logout']();
    expect(h.events).toContain('auth-status-changed');
  });

  it('le même compte, dans son propre profil : rien à refuser, l’offre est rafraîchie', async () => {
    const { authHandlers } = await modules();
    seed('p-a', [{ id: 'p-a', cloudAccount: { email: 'A@example.com', tier: 'free' } }]);
    await expect(authHandlers['auth:login']('a@example.com', 'pw')).resolves.toMatchObject({
      success: true,
    });
    expect(profile('p-a')?.cloudAccount).toMatchObject({ email: 'a@example.com', tier: 'solo' });
  });
});

describe('restauration de session au chargement (cookie)', () => {
  it('ne rattache PAS un profil sans compte : afficher un profil ne prouve pas qu’il est le sien', async () => {
    const { authHandlers } = await modules();
    seed('libre', [{ id: 'libre' }]);
    await authHandlers['auth:getStatus']();
    expect(profile('libre')?.cloudAccount).toBeUndefined();
  });

  it('rafraîchit l’offre d’un profil déjà rattaché au même compte, et laisse un autre compte tranquille', async () => {
    const { authHandlers } = await modules();
    seed('p-a', [{ id: 'p-a', cloudAccount: { email: 'A@example.com', tier: 'free' } }]);
    await authHandlers['auth:getStatus']();
    expect(profile('p-a')?.cloudAccount).toMatchObject({ email: 'a@example.com', tier: 'solo' });

    vi.resetModules();
    const again = await modules();
    seed('p-b', [{ id: 'p-b', cloudAccount: { email: 'b@example.com', tier: 'free' } }]);
    await again.authHandlers['auth:getStatus']();
    expect(profile('p-b')?.cloudAccount?.email).toBe('b@example.com');
  });
});

describe('ouvrir ou créer un profil, hors démarche', () => {
  it('n’estampille pas un profil sans compte, et respecte celui d’un autre compte', async () => {
    const { authHandlers, profileHandlers } = await modules();
    seed('web-1', [
      { id: 'web-1' },
      { id: 'libre' },
      { id: 'de-b', cloudAccount: { email: 'b@example.com', tier: 'free' } },
    ]);
    await authHandlers['auth:login']('a@example.com', 'pw');
    await profileHandlers['profile:activate']('libre');
    expect(profile('libre')?.cloudAccount).toBeUndefined();
    await profileHandlers['profile:activate']('de-b');
    expect(profile('de-b')?.cloudAccount?.email).toBe('b@example.com');
  });

  it('le « + » du sélecteur crée un profil LOCAL, même avec un cookie de session', async () => {
    const { authHandlers, profileHandlers } = await modules();
    seed('web-1', [{ id: 'web-1' }]);
    await authHandlers['auth:getStatus'](); // session restaurée par le cookie, aucune démarche
    const created = (await profileHandlers['profile:create']({
      name: 'Perso',
      avatarColor: '#111',
    })) as Stamped;
    expect(created.cloudAccount).toBeUndefined();
  });
});

describe('premier lancement : connexion sans profil actif', () => {
  it('ouvre un royaume implicite — le profil créé ensuite adopte le compte', async () => {
    const { authHandlers, profileHandlers } = await modules();
    seed(null, []);
    await expect(authHandlers['auth:login']('a@example.com', 'pw')).resolves.toMatchObject({
      success: true,
    });
    expect(await pending(authHandlers)).toBe(true);
    const created = (await profileHandlers['profile:create']({
      name: 'a',
      avatarColor: '#111',
    })) as Stamped;
    expect(created.cloudAccount?.email).toBe('a@example.com');
    expect(await pending(authHandlers)).toBe(false);
  });
});

describe('« + Ajouter un compte » (royaume en attente)', () => {
  it('le profil resté actif n’est pas rebaptisé ; le profil activé ensuite adopte, et la démarche se referme', async () => {
    const { authHandlers, profileHandlers } = await modules();
    seed('p-b', [
      { id: 'p-b', cloudAccount: { email: 'b@example.com', tier: 'free' } },
      { id: 'libre' },
    ]);
    await authHandlers['auth:beginPendingSession']();
    await authHandlers['auth:login']('a@example.com', 'pw');
    expect(profile('p-b')?.cloudAccount?.email).toBe('b@example.com');
    expect((await authHandlers['auth:pendingSessionStatus']()) as object).toMatchObject({
      pending: true,
      account: { email: 'a@example.com' },
    });

    await profileHandlers['profile:activate']('libre');
    expect(profile('libre')?.cloudAccount?.email).toBe('a@example.com');
    expect(await pending(authHandlers)).toBe(false);
  });

  it('ouvrir le profil d’un AUTRE compte pendant la démarche l’abandonne : zone refermée, session révoquée', async () => {
    const { authHandlers, profileHandlers } = await modules();
    seed('p-b', [{ id: 'p-b', cloudAccount: { email: 'b@example.com', tier: 'free' } }]);
    await authHandlers['auth:beginPendingSession']();
    await authHandlers['auth:login']('a@example.com', 'pw');
    await profileHandlers['profile:activate']('p-b');
    expect(profile('p-b')?.cloudAccount?.email).toBe('b@example.com');
    expect(await pending(authHandlers)).toBe(false);
    expect(h.logouts).toBe(1);
  });

  it('un profil sans compte resté actif n’est pas rattaché au compte qu’on ajoute', async () => {
    const { authHandlers } = await modules();
    seed('libre', [{ id: 'libre' }]);
    await authHandlers['auth:beginPendingSession']();
    await authHandlers['auth:login']('a@example.com', 'pw');
    expect(profile('libre')?.cloudAccount).toBeUndefined();
  });

  it('abandonner après une connexion révoque la session ; abandonner avant ne touche à rien', async () => {
    const { authHandlers } = await modules();
    seed('p-b', [{ id: 'p-b', cloudAccount: { email: 'b@example.com', tier: 'free' } }]);
    await authHandlers['auth:beginPendingSession']();
    await authHandlers['auth:discardPendingSession']();
    expect(h.logouts).toBe(0);

    await authHandlers['auth:beginPendingSession']();
    await authHandlers['auth:login']('a@example.com', 'pw');
    await authHandlers['auth:discardPendingSession']();
    expect(h.logouts).toBe(1);
    expect((await authHandlers['auth:getStatus']()) as object).toMatchObject({
      accountMode: 'local',
    });
  });

  it('un profil créé pendant la démarche l’adopte', async () => {
    const { authHandlers, profileHandlers } = await modules();
    seed('p-b', [{ id: 'p-b', cloudAccount: { email: 'b@example.com', tier: 'free' } }]);
    await authHandlers['auth:beginPendingSession']();
    await authHandlers['auth:login']('a@example.com', 'pw');
    const created = (await profileHandlers['profile:create']({
      name: 'a',
      avatarColor: '#111',
    })) as Stamped;
    expect(created.cloudAccount?.email).toBe('a@example.com');
    expect(await pending(authHandlers)).toBe(false);
  });
});

describe('effacer', () => {
  it('« tout effacer » retire aussi les clés enveloppées, résidu hérité compris', async () => {
    const { profileHandlers } = await modules();
    seed('web-1', [{ id: 'web-1' }]);
    h.idb.set('wrapped_fek', { wrappedFek: 'B' });
    h.idb.set('wrapped_fek:acct:a@example.com', { wrappedFek: 'A' });
    h.idb.set('wrapped_fek:p:web-1', { wrappedFek: 'L' });
    await profileHandlers['profile:fullReset']();
    expect([...h.idb.keys()].filter((k) => k.startsWith('wrapped_fek'))).toEqual([]);
  });
});

/**
 * `auth:getAccessToken` EST LE ROBINET DU RENDERER : l'apiClient axios (donc
 * `/vaults/heads`) et le billet de salle collab (`/collab/token`) n'ont pas
 * d'autre source, et NI L'UN NI L'AUTRE ne sait renouveler — l'intercepteur
 * d'apiClient est conditionné à un refresh PORTEUR, que le web n'a pas (le sien
 * vit dans le cookie HttpOnly).
 *
 * Le défaut du 31/08/2026 tenait à une seule ligne : `restoreSessionOnce` sort
 * dès qu'un jeton EXISTE, et le robinet rendait ce jeton-là tel quel. Passé le
 * quart d'heure, la collaboration martelait un 401 définitif.
 */
describe('auth:getAccessToken — un jeton périmé se re-frappe, il ne se sert pas tel quel', () => {
  it('rend le jeton NEUF, pas celui que la mémoire garde', async () => {
    const { authHandlers } = await modules();
    seed('web-1', [{ id: 'web-1' }]);
    await authHandlers['auth:login']('a@example.com', 'pw');

    h.tokenExpired = true; // le quart d'heure est passé
    const jeton = await authHandlers['auth:getAccessToken']();

    expect(jeton).toBe('tok-frais');
    expect(h.refreshes).toBe(1);
  });

  it('un jeton encore bon ne coûte aucune re-frappe', async () => {
    const { authHandlers } = await modules();
    seed('web-1', [{ id: 'web-1' }]);
    await authHandlers['auth:login']('a@example.com', 'pw');

    expect(await authHandlers['auth:getAccessToken']()).toBe('tok');
    expect(h.refreshes).toBe(0);
  });

  it('cookie mort : le jeton périmé remonte quand même — le 401 du serveur juge', async () => {
    const { authHandlers } = await modules();
    seed('web-1', [{ id: 'web-1' }]);
    await authHandlers['auth:login']('a@example.com', 'pw');

    h.tokenExpired = true;
    h.cookieValid = false;
    expect(await authHandlers['auth:getAccessToken']()).toBe('tok');
    expect(h.refreshes).toBe(1);
  });
});

describe('la session suit le profil (cookies par compte, 2026-09-01)', () => {
  const COMPTE_A = {
    id: 'u-a',
    email: 'a@example.com',
    subscriptionTier: 'solo',
    accountType: 'personal' as const,
  };
  const COMPTE_B = {
    id: 'u-b',
    email: 'b@example.com',
    subscriptionTier: 'pro',
    accountType: 'personal' as const,
  };

  it("activer le profil d'un AUTRE compte adopte SA session quand son cookie existe, puis recharge", async () => {
    h.user = { ...COMPTE_A };
    h.cookieAccounts = { 'u-b': { ...COMPTE_B } };
    seed('p-a', [
      { id: 'p-a', cloudAccount: { email: 'a@example.com', tier: 'solo', userId: 'u-a' } as never },
      { id: 'p-b', cloudAccount: { email: 'b@example.com', tier: 'pro', userId: 'u-b' } as never },
    ]);
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });
    try {
      const { authHandlers, profileHandlers } = await modules();
      await authHandlers['auth:login']('a@example.com', 'x');
      const { getSessionUser } = await import('../handlers/authHandlers');
      expect(getSessionUser()?.email).toBe('a@example.com');

      await profileHandlers['profile:activate']('p-b');
      // Le miroir web du « une session par profil » du bureau : le profil de B
      // ramène la session de B — sans mot de passe, le cookie HttpOnly suffit.
      expect(getSessionUser()?.email).toBe('b@example.com');
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('sans cookie de ce compte : la session ne bascule pas, pas de rechargement', async () => {
    h.user = { ...COMPTE_A };
    h.cookieAccounts = {}; // jamais connecté à B dans ce navigateur
    seed('p-a', [
      { id: 'p-a', cloudAccount: { email: 'a@example.com', tier: 'solo', userId: 'u-a' } as never },
      { id: 'p-b', cloudAccount: { email: 'b@example.com', tier: 'pro', userId: 'u-b' } as never },
    ]);
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });
    try {
      const { authHandlers, profileHandlers } = await modules();
      await authHandlers['auth:login']('a@example.com', 'x');
      await profileHandlers['profile:activate']('p-b');
      const { getSessionUser } = await import('../handlers/authHandlers');
      // L'état existant dit le geste (« connectez-vous au compte de ce profil ») ;
      // surtout ne pas basculer sur un cookie legacy qui serait celui d'un tiers.
      expect(getSessionUser()?.email).toBe('a@example.com');
      expect(reload).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("estampille d'avant `userId` : aucun indice fiable, rien ne bascule", async () => {
    h.user = { ...COMPTE_A };
    h.cookieAccounts = { 'u-b': { ...COMPTE_B } };
    seed('p-a', [
      { id: 'p-a', cloudAccount: { email: 'a@example.com', tier: 'solo', userId: 'u-a' } as never },
      // Estampille legacy : email sans userId.
      { id: 'p-b', cloudAccount: { email: 'b@example.com', tier: 'pro' } as never },
    ]);
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });
    try {
      const { authHandlers, profileHandlers } = await modules();
      await authHandlers['auth:login']('a@example.com', 'x');
      await profileHandlers['profile:activate']('p-b');
      const { getSessionUser } = await import('../handlers/authHandlers');
      expect(getSessionUser()?.email).toBe('a@example.com');
      expect(reload).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('profile:unlinkCloud — le soft disconnect du sélecteur', () => {
  it("retire l'estampille, garde le profil, et une connexion explicite re-rattache", async () => {
    seed('p-a', [
      { id: 'p-a', cloudAccount: { email: 'a@example.com', tier: 'solo', userId: 'u-a' } as never },
    ]);
    const { authHandlers, profileHandlers } = await modules();
    const res = (await profileHandlers['profile:unlinkCloud']('p-a')) as { success: boolean };
    expect(res.success).toBe(true);
    expect(profile('p-a')?.cloudAccount).toBeNull();
    expect(h.events).toContain('profiles-updated');

    // Le chemin de retour : une connexion EXPLICITE depuis ce profil re-rattache.
    await authHandlers['auth:login']('a@example.com', 'pw');
    expect(profile('p-a')?.cloudAccount).toMatchObject({ email: 'a@example.com' });
  });

  it('profil inconnu : un échec dit, pas une exception', async () => {
    seed(null, []);
    const { profileHandlers } = await modules();
    const res = (await profileHandlers['profile:unlinkCloud']('fantome')) as {
      success: boolean;
      error?: string;
    };
    expect(res.success).toBe(false);
    expect(res.error).toContain('not found');
  });
});
