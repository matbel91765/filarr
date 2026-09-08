/**
 * La clé enveloppée SUIT LE PROFIL — et la copie du serveur ne fait autorité
 * que pour le compte dont la session est ouverte.
 *
 * LE DÉFAUT QUE CECI ÉPINGLE (prod, 2026-08-28) : `wrapped_fek` était une clé
 * IndexedDB unique pour tout le navigateur, jamais effacée, lue avant la copie
 * nuage. Le blob d'un autre compte (ou d'un profil local) était adopté en
 * silence par le compte suivant — ses manifestes bureau devenaient illisibles.
 *
 * ET L'INVERSE, que la première correction avait réintroduit : router la clé
 * par la SESSION du navigateur installait la clé du compte connecté sur le
 * profil d'un autre compte (ou d'un profil local) qu'on venait d'ouvrir.
 *
 * Handlers réels ; réseau, IndexedDB, session et profil actif sont doublés.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  idb: new Map<string, unknown>(),
  user: null as { email: string } | null,
  active: null as string | null,
  pending: false,
  cloud: null as Record<string, unknown> | null,
  cloudMode: 'ok' as 'ok' | 'down' | '500',
  /** Le compte a-t-il des profils synchronisés (manifestVersion > 0) ? */
  synced: false,
  /** Les identifiants listés sous le compte (manifestVersion > 0). */
  listed: [] as string[],
  listingMode: 'ok' as 'ok' | '500',
  cleared: 0,
  stopped: 0,
  putStatus: 200,
  gets: 0,
  puts: 0,
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
  getActiveProfileId: async () => h.active,
  storeGet: vi.fn(async () => null),
  storePut: vi.fn(async () => undefined),
  storeDelete: async () => undefined,
  forProfile: () => ({
    get: async () => null,
    put: async () => undefined,
    delete: async () => undefined,
  }),
}));
vi.mock('../handlers/authHandlers', () => ({
  getSessionUser: () => h.user,
  restoreSessionOnce: async () => undefined,
  isPendingRealmOpen: () => h.pending,
}));
vi.mock('../sync/syncScheduler', () => ({
  startSyncScheduler: () => undefined,
  stopSyncScheduler: () => {
    h.stopped++;
  },
}));
vi.mock('../../../services/auth/hybridCrypto', () => ({
  clearHybridCrypto: () => {
    h.cleared++;
  },
}));
vi.mock('../sync/readSync', () => ({
  resetUnreadableProfiles: () => undefined,
  restoreAccountProfiles: async () => ({ restored: 0, profileIds: [], unreadable: [] }),
}));
vi.mock('../webApiBase', () => ({
  registerSessionAccountHintProvider: () => undefined,
  apiFetch: vi.fn(async (path: string, init?: { method?: string }) => {
    if (path === '/account/wrapped-key' && (init?.method ?? 'GET') === 'GET') {
      h.gets++;
      if (h.cloudMode === 'down') throw new TypeError('Failed to fetch');
      if (h.cloudMode === '500') return { status: 500, body: null };
      if (!h.cloud)
        return { status: 404, body: { success: false, error: 'No wrapped key stored' } };
      return { status: 200, body: { success: true, data: h.cloud } };
    }
    if (path === '/account/wrapped-key' && init?.method === 'PUT') {
      h.puts++;
      if (h.putStatus !== 200) {
        return { status: h.putStatus, body: { success: false, error: 'conflict' } };
      }
      return { status: 200, body: { success: true } };
    }
    if (path.startsWith('/sync/profiles')) {
      if (h.listingMode === '500') return { status: 500, body: null };
      const ids = h.synced ? ['bureau', ...h.listed] : h.listed;
      return {
        status: 200,
        body: {
          success: true,
          data: { profiles: ids.map((id) => ({ profileId: id, manifestVersion: 3 })) },
        },
      };
    }
    return { status: 404, body: { success: false } };
  }),
}));

const FOREIGN = { wrappedFek: 'B-wrap', kekSalt: 'B-salt', version: 1 };
const MINE = { wrappedFek: 'A-wrap', kekSalt: 'A-salt', version: 1 };
const ACCT = 'wrapped_fek:acct:a@example.com';

function manifest(profiles: Array<{ id: string; cloudAccount?: { email: string } | null }>) {
  h.idb.set('profiles_manifest', { activeProfileId: h.active, profiles });
}

async function custody() {
  return (await import('../handlers/custodyHandlers')).custodyHandlers;
}

beforeEach(async () => {
  h.idb.clear();
  h.user = null;
  h.active = null;
  h.pending = false;
  h.cloud = null;
  h.cloudMode = 'ok';
  h.synced = false;
  h.listed = [];
  h.listingMode = 'ok';
  h.cleared = 0;
  h.stopped = 0;
  h.putStatus = 200;
  h.gets = 0;
  h.puts = 0;
  // Le mémo de la copie serveur est un état de module : module neuf par test.
  vi.resetModules();
});

describe('profil estampillé du compte connecté (le cas nominal)', () => {
  beforeEach(() => {
    h.user = { email: 'A@Example.com' };
    h.active = 'p-a';
    manifest([{ id: 'p-a', cloudAccount: { email: 'a@example.com' } }]);
  });

  it('la copie du serveur l’emporte sur le résidu global, et se met en cache sous le compte', async () => {
    const c = await custody();
    h.idb.set('wrapped_fek', FOREIGN);
    h.cloud = MINE;
    await expect(c['hybrid:loadWrappedKey']()).resolves.toMatchObject(MINE);
    expect(h.idb.get(ACCT)).toMatchObject(MINE);
    // Le résidu n'est pas le nôtre : on ne le touche pas.
    expect(h.idb.get('wrapped_fek')).toBe(FOREIGN);
  });

  it('le résidu global n’est JAMAIS retiré ici — un profil sans compte peut encore l’ouvrir en lecture', async () => {
    const c = await custody();
    h.idb.set('wrapped_fek', { ...MINE });
    h.cloud = MINE;
    await c['hybrid:loadWrappedKey']();
    expect(h.idb.get('wrapped_fek')).toMatchObject(MINE);
  });

  it('404 sur un compte VIDE : le cache du compte, sinon null (une clé neuve sera créée) — même avec un résidu', async () => {
    const c = await custody();
    await expect(c['hybrid:loadWrappedKey']()).resolves.toBeNull();
    h.idb.set('wrapped_fek', FOREIGN);
    await expect(c['hybrid:loadWrappedKey']()).resolves.toBeNull();
    h.idb.set(ACCT, MINE);
    await expect(c['hybrid:loadWrappedKey']()).resolves.toMatchObject(MINE);
  });

  it('404 sur un compte qui a DÉJÀ des données : on LÈVE, on ne fabrique rien et on n’adopte rien', async () => {
    const c = await custody();
    h.synced = true;
    h.idb.set('wrapped_fek', FOREIGN);
    await expect(c['hybrid:loadWrappedKey']()).rejects.toMatchObject({
      code: 'wrapped_key_unavailable',
    });
    expect(h.idb.get(ACCT)).toBeUndefined();
  });

  it('404 et liste des profils injoignable : on LÈVE avec le code (l’écran ne dit pas « mauvais mot de passe »)', async () => {
    const c = await custody();
    h.listingMode = '500';
    await expect(c['hybrid:loadWrappedKey']()).rejects.toMatchObject({
      code: 'wrapped_key_unavailable',
    });
  });

  it('409 sur la clé initiale : un autre appareil a posé la clé — cache, drapeau, clé en mémoire et démon sont oubliés', async () => {
    const c = await custody();
    await c['hybrid:saveWrappedKey'](FOREIGN); // la clé qu’on vient de fabriquer
    expect(h.idb.get(`${ACCT}:pending-push`)).toBe(true);
    h.putStatus = 409;
    await expect(
      c['hybrid:pushWrappedKeyToCloud']({ ...FOREIGN, expectedPreviousDigest: 'initial' })
    ).resolves.toMatchObject({ success: false, code: 'seeded_elsewhere' });
    expect(h.idb.get(ACCT)).toBeUndefined();
    expect(h.idb.get(`${ACCT}:pending-push`)).toBeUndefined();
    expect(h.cleared).toBe(1);
    expect(h.stopped).toBe(1);
    // Le prochain chargement repart de la copie du serveur.
    h.cloud = MINE;
    await expect(c['hybrid:loadWrappedKey']()).resolves.toMatchObject(MINE);
  });

  it('404 sur un compte vide, profil local avec du contenu : sa clé (le résidu) lui est apportée', async () => {
    const c = await custody();
    h.idb.set('wrapped_fek', FOREIGN);
    h.idb.set('p:p-a:notes_enc', 'x');
    await expect(c['hybrid:loadWrappedKey']()).resolves.toBe(FOREIGN);
  });

  it('réseau indisponible : le cache du compte, sinon on LÈVE avec un code (jamais null)', async () => {
    const c = await custody();
    h.cloudMode = 'down';
    await expect(c['hybrid:loadWrappedKey']()).rejects.toMatchObject({
      code: 'wrapped_key_unavailable',
    });
    h.idb.set(ACCT, MINE);
    await expect(c['hybrid:loadWrappedKey']()).resolves.toMatchObject(MINE);
    h.cloudMode = '500';
    h.idb.delete(ACCT);
    await expect(c['hybrid:loadWrappedKey']()).rejects.toThrow(/HTTP 500/);
  });

  it('les enveloppes locales survivent, même quand le serveur a rescellé sous un autre mot de passe', async () => {
    const c = await custody();
    h.idb.set(ACCT, { ...MINE, altWrappedFek: 'leurre', altKekSalt: 's' });
    h.cloud = { wrappedFek: 'A2-wrap', kekSalt: 'A2-salt', version: 2, recoveryWrappedFek: 'rec' };
    await expect(c['hybrid:loadWrappedKey']()).resolves.toMatchObject({
      wrappedFek: 'A2-wrap',
      altWrappedFek: 'leurre',
      recoveryWrappedFek: 'rec',
    });
  });

  it('une sauvegarde locale qui DEVANCE le serveur n’est pas défaite par « le serveur gagne »', async () => {
    const c = await custody();
    h.cloud = MINE;
    await c['hybrid:loadWrappedKey'](); // la copie serveur est connue
    const rewrapped = { wrappedFek: 'A-new-wrap', kekSalt: 'A-new-salt', version: 1 };
    await c['hybrid:saveWrappedKey'](rewrapped); // rescellement local (mot de passe changé)
    // La remontée n'a pas encore abouti : le local reste l'autorité.
    await expect(c['hybrid:loadWrappedKey']()).resolves.toMatchObject(rewrapped);
    // Une fois acceptée par le serveur, la fusion reprend.
    await c['hybrid:pushWrappedKeyToCloud'](rewrapped);
    h.cloud = rewrapped;
    await expect(c['hybrid:loadWrappedKey']()).resolves.toMatchObject(rewrapped);
  });

  it('une enveloppe LOCALE ajoutée (partie nuage inchangée) ne devance rien : la copie serveur reste consultée', async () => {
    const c = await custody();
    h.idb.set(ACCT, MINE); // déverrouillage depuis le cache, serveur jamais vu
    await c['hybrid:saveWrappedKey']({ ...MINE, deviceWrappedFek: 'dev' });
    h.cloud = { ...MINE, recoveryWrappedFek: 'rec' }; // le serveur a gagné une enveloppe entre-temps
    await expect(c['hybrid:loadWrappedKey']()).resolves.toMatchObject({
      deviceWrappedFek: 'dev',
      recoveryWrappedFek: 'rec',
    });
  });

  it('le drapeau « local devance » se lève tout seul quand le serveur a fini par accepter', async () => {
    const c = await custody();
    h.cloud = MINE;
    await c['hybrid:loadWrappedKey']();
    const rewrapped = { wrappedFek: 'A-new-wrap', kekSalt: 'A-new-salt', version: 1 };
    await c['hybrid:saveWrappedKey'](rewrapped);
    // Poussé depuis un autre onglet : le serveur porte déjà la nouvelle partie nuage.
    vi.resetModules();
    const c2 = await custody();
    h.cloud = rewrapped;
    await c2['hybrid:loadWrappedKey']();
    expect(h.idb.get(`${ACCT}:pending-push`)).toBeUndefined();
  });

  it('la copie serveur est mémorisée quelques secondes : les sondes ne la redemandent pas en rafale', async () => {
    const c = await custody();
    h.cloud = MINE;
    await c['hybrid:loadWrappedKey']();
    await c['hybrid:loadWrappedKey']();
    await c['hybrid:fetchWrappedKeyFromCloud']();
    expect(h.gets).toBe(1);
  });
});

describe('la clé suit le profil, pas la session', () => {
  it('un profil d’un AUTRE compte lit le cache de SON compte — jamais la clé de la session, et sans cache on LÈVE', async () => {
    const c = await custody();
    h.user = { email: 'a@example.com' };
    h.active = 'p-b';
    manifest([{ id: 'p-b', cloudAccount: { email: 'b@example.com' } }]);
    h.idb.set('wrapped_fek:acct:b@example.com', FOREIGN);
    h.idb.set(ACCT, MINE);
    h.cloud = MINE;
    await expect(c['hybrid:loadWrappedKey']()).resolves.toBe(FOREIGN);
    expect(h.gets).toBe(0);
    // Sans cache pour B : rien à ouvrir ici — et surtout pas la clé de A, ni une neuve.
    h.idb.delete('wrapped_fek:acct:b@example.com');
    await expect(c['hybrid:loadWrappedKey']()).rejects.toMatchObject({
      code: 'wrapped_key_unavailable',
    });
    // Le repli serveur de initHybridCrypto ne reçoit pas non plus la copie de A.
    await expect(c['hybrid:fetchWrappedKeyFromCloud']()).resolves.toBeNull();
    // Et rien ne s'écrit ni ne part sous ce profil au nom de A.
    await expect(c['hybrid:saveWrappedKey'](MINE)).rejects.toMatchObject({
      code: 'wrapped_key_unavailable',
    });
    await expect(c['hybrid:pushWrappedKeyToCloud'](MINE)).resolves.toMatchObject({
      success: false,
    });
    expect(h.puts).toBe(0);
  });

  it('un profil qui détient SA clé la garde, session ou pas (rattacher un profil local ne le rechiffre pas)', async () => {
    const c = await custody();
    h.user = { email: 'a@example.com' };
    h.active = 'p-local';
    manifest([{ id: 'p-local', cloudAccount: { email: 'a@example.com' } }]);
    const own = { wrappedFek: 'L-wrap', kekSalt: 'L-salt', version: 1 };
    h.idb.set('wrapped_fek:p:p-local', own);
    h.cloud = MINE;
    await expect(c['hybrid:loadWrappedKey']()).resolves.toBe(own);
    expect(h.gets).toBe(0);
    await c['hybrid:saveWrappedKey']({ ...own, recoveryWrappedFek: 'r' });
    expect(h.idb.get('wrapped_fek:p:p-local')).toMatchObject({ recoveryWrappedFek: 'r' });
  });

  it('« + Ajouter un compte » : le profil resté actif est un spectateur, la clé va au compte ajouté', async () => {
    const c = await custody();
    h.user = { email: 'a@example.com' };
    h.active = 'p-b';
    h.pending = true;
    manifest([{ id: 'p-b', cloudAccount: { email: 'b@example.com' } }]);
    h.idb.set('wrapped_fek:acct:b@example.com', FOREIGN);
    h.cloud = MINE;
    await expect(c['hybrid:loadWrappedKey']()).resolves.toMatchObject(MINE);
    expect(h.idb.get(ACCT)).toMatchObject(MINE);
    expect(h.idb.get('wrapped_fek:acct:b@example.com')).toBe(FOREIGN);
  });

  it('profil sans estampille + session : la copie du compte SI le compte le liste (le profil d’avant l’estampille)', async () => {
    const c = await custody();
    h.user = { email: 'a@example.com' };
    h.active = 'web-1';
    manifest([{ id: 'web-1' }]);
    h.idb.set('p:web-1:notes_enc', 'x');
    h.idb.set('wrapped_fek', FOREIGN);
    h.cloud = MINE;
    h.listed = ['web-1'];
    await expect(c['hybrid:loadWrappedKey']()).resolves.toMatchObject(MINE);
  });

  it('profil sans estampille avec du contenu, NON listé par le compte : un profil local — sa portée, pas la clé du compte', async () => {
    const c = await custody();
    h.user = { email: 'a@example.com' };
    h.active = 'libre';
    manifest([{ id: 'libre' }]);
    h.idb.set('p:libre:notes_enc', 'x');
    h.idb.set('wrapped_fek', FOREIGN);
    h.cloud = MINE;
    await expect(c['hybrid:loadWrappedKey']()).resolves.toBe(FOREIGN);
  });

  it('rule 3, liste des profils injoignable : on LÈVE plutôt que de deviner (ni la clé du compte, ni le résidu)', async () => {
    const c = await custody();
    h.user = { email: 'a@example.com' };
    h.active = 'web-1';
    manifest([{ id: 'web-1' }]);
    h.idb.set('p:web-1:notes_enc', 'x');
    h.idb.set('wrapped_fek', FOREIGN);
    h.cloud = MINE;
    h.listingMode = '500';
    await expect(c['hybrid:loadWrappedKey']()).rejects.toMatchObject({
      code: 'wrapped_key_unavailable',
    });
  });

  it('une liste de dossiers n’est pas du contenu chiffré : un profil neuf qui a créé un dossier reçoit SA clé, pas le résidu', async () => {
    const c = await custody();
    h.active = 'neuf';
    manifest([{ id: 'neuf' }]);
    h.idb.set('p:neuf:folders', { f1: { id: 'f1', items: [] } });
    h.idb.set('wrapped_fek', FOREIGN);
    await expect(c['hybrid:loadWrappedKey']()).resolves.toBeNull();
  });

  it('un profil SANS estampille ne publie jamais sa clé, cookie ou pas ; il ne reçoit pas non plus la copie du compte', async () => {
    const c = await custody();
    h.user = { email: 'a@example.com' };
    h.active = 'local';
    manifest([{ id: 'local' }]);
    h.idb.set('wrapped_fek:p:local', FOREIGN);
    h.cloud = MINE;
    await expect(
      c['hybrid:pushWrappedKeyToCloud']({ ...FOREIGN, expectedPreviousDigest: 'initial' })
    ).resolves.toMatchObject({ success: false });
    expect(h.puts).toBe(0);
    await expect(c['hybrid:fetchWrappedKeyFromCloud']()).resolves.toBeNull();
    // Sa clé, elle, se sauvegarde chez lui sans histoire.
    await c['hybrid:saveWrappedKey'](MINE);
    expect(h.idb.get('wrapped_fek:p:local')).toBe(MINE);
  });

  it('un profil RATTACHÉ dont la clé propre est encore chez lui voit la copie du compte, et la publication la fait migrer sous le compte', async () => {
    const c = await custody();
    h.user = { email: 'a@example.com' };
    h.active = 'p-mine';
    manifest([{ id: 'p-mine', cloudAccount: { email: 'a@example.com' } }]);
    h.idb.set('wrapped_fek:p:p-mine', FOREIGN);
    // Compte vide : la publication initiale passe, et la clé devient celle du compte.
    await expect(c['hybrid:fetchWrappedKeyFromCloud']()).resolves.toBeNull();
    await expect(
      c['hybrid:pushWrappedKeyToCloud']({ ...FOREIGN, expectedPreviousDigest: 'initial' })
    ).resolves.toMatchObject({ success: true });
    expect(h.idb.get('wrapped_fek:p:p-mine')).toBeUndefined();
    expect(h.idb.get(ACCT)).toMatchObject({ wrappedFek: 'B-wrap' });
    // Désormais le compte fait autorité : plus de republication « initiale ».
    h.cloud = FOREIGN;
    await expect(c['hybrid:fetchWrappedKeyFromCloud']()).resolves.toMatchObject(FOREIGN);
    await expect(c['hybrid:loadWrappedKey']()).resolves.toMatchObject(FOREIGN);
  });

  it('409 sur une clé « initiale » PROFIL (rattaché) : rien n’est effacé — le compte a déjà cette clé', async () => {
    const c = await custody();
    h.user = { email: 'a@example.com' };
    h.active = 'p-mine';
    manifest([{ id: 'p-mine', cloudAccount: { email: 'a@example.com' } }]);
    h.idb.set('wrapped_fek:p:p-mine', FOREIGN);
    h.putStatus = 409;
    await expect(
      c['hybrid:pushWrappedKeyToCloud']({ ...FOREIGN, expectedPreviousDigest: 'initial' })
    ).resolves.toMatchObject({ success: false });
    expect(h.idb.get('wrapped_fek:p:p-mine')).toBe(FOREIGN);
    expect(h.cleared).toBe(0);
    expect(h.stopped).toBe(0);
  });

  it('profil sans estampille et SANS contenu + session : un profil neuf, sa propre portée (null → clé neuve)', async () => {
    const c = await custody();
    h.user = { email: 'a@example.com' };
    h.active = 'neuf';
    manifest([{ id: 'neuf' }]);
    h.cloud = MINE;
    await expect(c['hybrid:loadWrappedKey']()).resolves.toBeNull();
    expect(h.gets).toBe(0);
    await c['hybrid:saveWrappedKey'](FOREIGN);
    expect(h.idb.get('wrapped_fek:p:neuf')).toBe(FOREIGN);
  });

  it('un profil d’un autre compte qui détient SA clé ne pousse rien vers la session, et n’en reçoit rien', async () => {
    const c = await custody();
    h.user = { email: 'a@example.com' };
    h.active = 'p-b';
    manifest([{ id: 'p-b', cloudAccount: { email: 'b@example.com' } }]);
    h.idb.set('wrapped_fek:p:p-b', FOREIGN);
    h.cloud = MINE;
    await expect(c['hybrid:loadWrappedKey']()).resolves.toBe(FOREIGN);
    await expect(c['hybrid:fetchWrappedKeyFromCloud']()).resolves.toBeNull();
    await expect(
      c['hybrid:pushWrappedKeyToCloud']({ ...FOREIGN, expectedPreviousDigest: 'initial' })
    ).resolves.toMatchObject({ success: false });
    await expect(c['hybrid:saveWrappedKey'](FOREIGN)).rejects.toMatchObject({
      code: 'wrapped_key_unavailable',
    });
    expect(h.puts).toBe(0);
  });
});

describe('sans session', () => {
  it('un profil estampillé lit le cache de son compte — le déverrouillage hors ligne tient', async () => {
    const c = await custody();
    h.active = 'p-bureau';
    manifest([{ id: 'p-bureau', cloudAccount: { email: 'A@example.com' } }]);
    h.idb.set(ACCT, MINE);
    h.idb.set('wrapped_fek', FOREIGN);
    await expect(c['hybrid:loadWrappedKey']()).resolves.toMatchObject(MINE);
    expect(h.gets).toBe(0);
  });

  it('un profil SANS compte lit le résidu global s’il a du contenu — sans se l’approprier', async () => {
    const c = await custody();
    h.active = 'p-local';
    manifest([{ id: 'p-local' }]);
    h.idb.set('wrapped_fek', FOREIGN);
    // Profil vide : rien à ouvrir, il recevra sa propre clé.
    await expect(c['hybrid:loadWrappedKey']()).resolves.toBeNull();
    // Profil avec des notes : le blob ouvre — mais il n'est pas copié sous sa
    // portée : si un compte s'ouvre ensuite avec une autre copie serveur, elle gagne.
    h.idb.set('p:p-local:notes_enc', 'x');
    await expect(c['hybrid:loadWrappedKey']()).resolves.toBe(FOREIGN);
    expect(h.idb.get('wrapped_fek:p:p-local')).toBeUndefined();
    expect(h.idb.get('wrapped_fek')).toBe(FOREIGN);
    // Un geste sur CE profil (rescellement) écrit sous sa portée — et elle gagne alors.
    await c['hybrid:saveWrappedKey'](MINE);
    expect(h.idb.get('wrapped_fek:p:p-local')).toBe(MINE);
    await expect(c['hybrid:loadWrappedKey']()).resolves.toBe(MINE);
    expect(h.gets).toBe(0);
  });

  it('un profil estampillé sans cache : on LÈVE (connectez-vous), pas le résidu d’un autre', async () => {
    const c = await custody();
    h.active = 'p-bureau';
    manifest([{ id: 'p-bureau', cloudAccount: { email: 'a@example.com' } }]);
    h.idb.set('wrapped_fek', FOREIGN);
    await expect(c['hybrid:loadWrappedKey']()).rejects.toMatchObject({
      code: 'wrapped_key_unavailable',
    });
  });

  it('un profil sans compte, avec du contenu et AUCUNE clé nulle part : on LÈVE, pas de clé neuve par-dessus', async () => {
    const c = await custody();
    h.active = 'p-local';
    manifest([{ id: 'p-local' }]);
    h.idb.set('p:p-local:notes_enc', 'x');
    await expect(c['hybrid:loadWrappedKey']()).rejects.toMatchObject({
      code: 'wrapped_key_unavailable',
    });
  });

  it('ni profil ni session (onboarding local d’avant le profil) : la clé héritée, comme avant', async () => {
    const c = await custody();
    h.idb.set('wrapped_fek', MINE);
    await expect(c['hybrid:loadWrappedKey']()).resolves.toBe(MINE);
  });
});

describe('« Rester déverrouillé »', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: (k: string) => (k === 'filarr-web-stay-unlocked' ? '1' : null) },
      configurable: true,
      writable: true,
    });
  });

  it('un scellé d’avant la portée par compte est ignoré (un mot de passe à ressaisir, une fois)', async () => {
    const c = await custody();
    const { storeGet } = await import('../webStore');
    vi.mocked(storeGet).mockResolvedValueOnce({
      kek: {},
      iv: new Uint8Array(12),
      wrapped: new Uint8Array(16),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    } as never);
    await expect(c['hybrid:loadFEK']()).resolves.toBeNull();
    vi.mocked(storeGet).mockResolvedValueOnce({
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    } as never);
    await expect(c['hybrid:hasKey']()).resolves.toBe(false);
  });

  it('le scellé porte la portée de sa clé : posé pour un compte, il ne s’ouvre pas sur un autre routage', async () => {
    const c = await custody();
    h.user = { email: 'a@example.com' };
    h.active = 'p-a';
    manifest([{ id: 'p-a', cloudAccount: { email: 'a@example.com' } }]);
    const { storeGet, storePut } = await import('../webStore');
    await c['hybrid:storeFEK'](new Uint8Array(32).fill(7));
    const sealed = vi.mocked(storePut).mock.calls.at(-1)?.[1] as { scope: string };
    expect(sealed.scope).toBe(ACCT);
    // Le même profil, rattaché entre-temps à un autre compte : le scellé est écarté.
    manifest([{ id: 'p-a', cloudAccount: { email: 'b@example.com' } }]);
    vi.mocked(storeGet).mockResolvedValueOnce({ ...sealed, v: 2 } as never);
    await expect(c['hybrid:hasKey']()).resolves.toBe(false);
  });

  it('pendant « + Ajouter un compte », rien n’est scellé : aucun profil à qui l’attribuer', async () => {
    const c = await custody();
    h.user = { email: 'a@example.com' };
    h.pending = true;
    const { storePut } = await import('../webStore');
    vi.mocked(storePut).mockClear();
    await c['hybrid:storeFEK'](new Uint8Array(32).fill(7));
    expect(vi.mocked(storePut)).not.toHaveBeenCalled();
  });
});
