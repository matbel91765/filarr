/**
 * LE BOUTON « Synchroniser » (canal `sync:triggerSync`), de bout en bout.
 *
 * Patron de panne, vécu en conditions réelles : l'élection d'un onglet MENEUR a
 * réservé tout le travail de sync à un seul onglet, mais le bouton, lui, est
 * resté branché en direct sur le moteur (`pullFromCloud`). Dans un onglet
 * SUIVEUR il cyclait donc pour son compte — exactement la concurrence que
 * l'élection existe pour empêcher (deux onglets qui poussent en même temps se
 * battent sur le CAS du manifeste) — et l'utilisateur n'en savait jamais rien :
 * le verdict était jeté par l'appelant.
 *
 * Ce qui est verrouillé ici : un clic CONCLUT toujours, et il conclut au bon
 * endroit — délégué au meneur depuis un suiveur, exécuté ici sinon, rejoint
 * quand un cycle tourne déjà, et nommé quand il échoue.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pullFromCloud: vi.fn(),
  probeManifestChanged: vi.fn(),
  clearServerVersions: vi.fn(),
  isCycleInFlight: vi.fn(() => false),
  getSyncState: vi.fn(),
  getActiveProfileId: vi.fn(),
  refreshPendingCount: vi.fn(),
  getPendingUploads: vi.fn(),
}));

vi.mock('../sync/readSync', () => ({
  pullFromCloud: mocks.pullFromCloud,
  probeManifestChanged: mocks.probeManifestChanged,
  clearServerVersions: mocks.clearServerVersions,
  isCycleInFlight: mocks.isCycleInFlight,
  getSyncState: mocks.getSyncState,
}));
vi.mock('../webStore', () => ({ getActiveProfileId: mocks.getActiveProfileId }));
// Le cycle interroge le serveur sur la portee du magasin (BYOS local). Ces
// tests portent sur l'election de l'onglet meneur, pas sur cette garde.
vi.mock('../sync/localStoreGuard', () => ({
  isStoreOutOfReachFromBrowser: async () => false,
  resetLocalStoreCache: () => {},
}));
vi.mock('../sync/pendingUploads', () => ({
  refreshPendingCount: mocks.refreshPendingCount,
  getPendingUploads: mocks.getPendingUploads,
}));
vi.mock('../idb', () => ({
  // Le profil actif est rattaché au compte de la session : c'est la condition
  // pour qu'un cycle parte (syncScheduler.profileMatchesSession).
  idbGet: async () => ({
    activeProfileId: 'p1',
    profiles: [{ id: 'p1', cloudAccount: { email: 'moi@example.com' } }],
  }),
  idbPut: async () => undefined,
  idbDelete: async () => undefined,
  idbKeys: async () => [],
}));
vi.mock('../handlers/authHandlers', () => ({
  getSessionUser: () => ({ email: 'moi@example.com' }),
  isPendingRealmOpen: () => false,
  restoreSessionOnce: async () => undefined,
}));

const LEADER_LOCK = 'filarr-sync-leader';
const CHANNEL_NAME = 'filarr-sync';
/** Délai au-delà duquel un meneur muet ne bloque plus le clic (syncScheduler). */
const MANUAL_ACK_MS = 3_000;

const okCycle = {
  state: 'idle',
  version: 1,
  installedMeta: 0,
  pushed: 0,
  restoredProfiles: 0,
  notModified: false,
};

interface Demande {
  type: string;
  reason?: string;
  id?: string;
}

/** File exclusive par nom, comme le navigateur (voir syncLeader.vitest.ts). */
function fauxVerrous(): LockManager {
  const files = new Map<string, Promise<unknown>>();
  const tenus = new Set<string>();
  const manager = {
    request(nom: string, options: unknown, rappel?: unknown) {
      const opts = (typeof options === 'function' ? {} : (options ?? {})) as {
        ifAvailable?: boolean;
        signal?: AbortSignal;
      };
      const callback = (typeof options === 'function' ? options : rappel) as (
        lock: unknown
      ) => Promise<unknown>;
      if (opts.ifAvailable && tenus.has(nom)) return Promise.resolve(callback(null));
      const precedent = files.get(nom) ?? Promise.resolve();
      const run = new Promise<unknown>((resolve, reject) => {
        const abandonner = (): void => {
          reject(Object.assign(new Error('lock request aborted'), { name: 'AbortError' }));
        };
        if (opts.signal?.aborted) {
          abandonner();
          return;
        }
        opts.signal?.addEventListener('abort', abandonner, { once: true });
        void precedent.then(() => {
          if (opts.signal?.aborted) return;
          tenus.add(nom);
          Promise.resolve(callback({ name: nom, mode: 'exclusive' })).then(
            (v) => {
              tenus.delete(nom);
              resolve(v);
            },
            (e) => {
              tenus.delete(nom);
              reject(e);
            }
          );
        });
      });
      files.set(
        nom,
        run.then(
          () => undefined,
          () => undefined
        )
      );
      return run;
    },
  };
  return manager as unknown as LockManager;
}

/** Doublure de BroadcastChannel : livraison en microtâche, jamais à soi-même. */
function fauxCanaux() {
  const ouverts = new Set<FauxCanal>();
  class FauxCanal {
    name: string;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    ferme = false;
    constructor(name: string) {
      this.name = name;
      ouverts.add(this);
    }
    postMessage(data: unknown): void {
      if (this.ferme) throw new Error('canal fermé');
      const brut = JSON.stringify(data);
      for (const autre of [...ouverts]) {
        if (autre === this || autre.ferme || autre.name !== this.name) continue;
        queueMicrotask(() => {
          if (!autre.ferme) autre.onmessage?.({ data: JSON.parse(brut) });
        });
      }
    }
    close(): void {
      this.ferme = true;
      ouverts.delete(this);
    }
  }
  return FauxCanal;
}

let FauxCanal: ReturnType<typeof fauxCanaux>;
let verrous: LockManager;
const ouverts: Array<typeof import('../sync/syncScheduler')> = [];

/** Un « onglet » : son ordonnanceur ET ses handlers, même registre de modules. */
async function ouvrirOnglet(): Promise<{
  scheduler: typeof import('../sync/syncScheduler');
  bus: typeof import('../webEventBus');
  clic: (profileId?: string) => Promise<{
    state: string;
    error?: string;
    alreadyRunning?: boolean;
    delegated?: boolean;
  }>;
}> {
  vi.resetModules();
  const scheduler = await import('../sync/syncScheduler');
  const bus = await import('../webEventBus');
  const { syncStatusHandlers } = await import('../handlers/syncStatusHandlers');
  ouverts.push(scheduler);
  scheduler.startSyncScheduler();
  await vi.advanceTimersByTimeAsync(0);
  return {
    scheduler,
    bus,
    clic: (profileId = '') =>
      syncStatusHandlers['sync:triggerSync'](profileId) as Promise<{ state: string }>,
  };
}

/** Un tiers garde le verrou : l'onglet ouvert ensuite reste SUIVEUR. */
function occuperLeVerrou(): { rendre: () => void } {
  let rendre = (): void => undefined;
  void verrous.request(
    LEADER_LOCK,
    { mode: 'exclusive' },
    () =>
      new Promise<void>((resolve) => {
        rendre = resolve;
      })
  );
  return { rendre: () => rendre() };
}

/** Onglet de test : voit ce que les autres diffusent, et peut leur parler. */
function canalDeTest(): {
  messages: Demande[];
  poster: (data: unknown) => void;
  fermer: () => void;
} {
  const messages: Demande[] = [];
  const canal = new FauxCanal(CHANNEL_NAME);
  canal.onmessage = (event) => messages.push(event.data as Demande);
  return {
    messages,
    poster: (data) => canal.postMessage(data),
    fermer: () => canal.close(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  ouverts.length = 0;
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: {
      visibilityState: 'visible',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  mocks.pullFromCloud.mockReset().mockResolvedValue(okCycle);
  mocks.probeManifestChanged.mockReset().mockResolvedValue('unchanged');
  mocks.getActiveProfileId.mockReset().mockResolvedValue('p1');
  mocks.refreshPendingCount.mockReset().mockResolvedValue(undefined);
  mocks.getPendingUploads.mockReset().mockResolvedValue({});
  mocks.isCycleInFlight.mockReset().mockReturnValue(false);
  mocks.clearServerVersions.mockReset();
  FauxCanal = fauxCanaux();
  verrous = fauxVerrous();
  vi.stubGlobal('navigator', { locks: verrous });
  vi.stubGlobal('BroadcastChannel', FauxCanal);
});

afterEach(() => {
  for (const scheduler of ouverts) scheduler.stopSyncScheduler();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.resetModules();
});

describe('onglet SUIVEUR — le bouton délègue, et rend le verdict du meneur', () => {
  it('ne cycle PAS ici : il demande au meneur et attend sa réponse', async () => {
    const tiers = occuperLeVerrou();
    await vi.advanceTimersByTimeAsync(0);
    const meneur = canalDeTest();
    const onglet = await ouvrirOnglet(); // suiveur : aucun cycle de démarrage
    expect(mocks.pullFromCloud).not.toHaveBeenCalled();

    const clic = onglet.clic();
    await vi.advanceTimersByTimeAsync(0);

    // LE DÉFAUT : le bouton cyclait ICI, en concurrence avec le meneur.
    expect(mocks.pullFromCloud).not.toHaveBeenCalled();
    const demande = meneur.messages.find((m) => m.type === 'cycle');
    expect(demande).toBeDefined();
    expect(demande?.reason).toBe('manuel-suiveur');
    // Une demande IDENTIFIÉE : sans identifiant, personne ne peut répondre.
    expect(typeof demande?.id).toBe('string');

    meneur.poster({ type: 'status', busy: true, id: demande?.id });
    meneur.poster({ type: 'done', id: demande?.id, ok: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(await clic).toEqual({ state: 'idle', delegated: true });
    expect(mocks.pullFromCloud).not.toHaveBeenCalled();

    meneur.fermer();
    tiers.rendre();
  });

  it('rend visible ce qui se passe : « en cours », puis le repos', async () => {
    const tiers = occuperLeVerrou();
    await vi.advanceTimersByTimeAsync(0);
    const meneur = canalDeTest();
    const onglet = await ouvrirOnglet();

    const vus: unknown[] = [];
    onglet.bus.subscribeWebEvent('sync-status-changed', (s) => vus.push(s));

    const clic = onglet.clic();
    await vi.advanceTimersByTimeAsync(0);
    const demande = meneur.messages.find((m) => m.type === 'cycle');
    meneur.poster({ type: 'status', busy: true, id: demande?.id });
    meneur.poster({ type: 'done', id: demande?.id, ok: true });
    await vi.advanceTimersByTimeAsync(0);
    await clic;

    expect(vus).toEqual([{ state: 'syncing' }, { state: 'idle' }]);

    meneur.fermer();
    tiers.rendre();
  });

  it('l’échec du meneur revient NOMMÉ jusqu’au bouton', async () => {
    const tiers = occuperLeVerrou();
    await vi.advanceTimersByTimeAsync(0);
    const meneur = canalDeTest();
    const onglet = await ouvrirOnglet();

    const clic = onglet.clic();
    await vi.advanceTimersByTimeAsync(0);
    const demande = meneur.messages.find((m) => m.type === 'cycle');
    meneur.poster({ type: 'status', busy: true, id: demande?.id });
    meneur.poster({ type: 'done', id: demande?.id, ok: false, error: 'Non authentifié' });
    await vi.advanceTimersByTimeAsync(0);

    expect(await clic).toEqual({
      state: 'error',
      delegated: true,
      error: 'Non authentifié',
    });

    meneur.fermer();
    tiers.rendre();
  });

  it('meneur MUET : cet onglet s’en charge plutôt que de rester sans effet', async () => {
    // Verrou tenu par un onglet gelé (le navigateur ne le rend qu'à sa mort) :
    // personne n'accuse réception. Un bouton qui ne fait rien serait pire.
    const tiers = occuperLeVerrou();
    await vi.advanceTimersByTimeAsync(0);
    const onglet = await ouvrirOnglet();

    const clic = onglet.clic();
    await vi.advanceTimersByTimeAsync(MANUAL_ACK_MS + 100);

    expect(await clic).toEqual({ state: 'idle' });
    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(1);

    tiers.rendre();
  });
});

describe('onglet MENEUR — le bouton travaille ici', () => {
  it('exécute le cycle et rend un succès', async () => {
    const onglet = await ouvrirOnglet(); // meneur : cycle de démarrage
    mocks.pullFromCloud.mockClear();

    expect(await onglet.clic()).toEqual({ state: 'idle' });
    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(1);
    expect(mocks.pullFromCloud).toHaveBeenCalledWith('p1');
  });

  it('exécute la demande IDENTIFIÉE d’un suiveur et lui répond', async () => {
    await ouvrirOnglet(); // meneur
    const suiveur = canalDeTest();
    mocks.pullFromCloud.mockClear();

    suiveur.poster({ type: 'cycle', reason: 'manuel-suiveur', id: 'r-1' });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(1);
    expect(suiveur.messages).toContainEqual({ type: 'done', id: 'r-1', ok: true });
    suiveur.fermer();
  });

  it('un cycle échoué remonte son message d’erreur', async () => {
    const onglet = await ouvrirOnglet();
    mocks.pullFromCloud.mockResolvedValueOnce({ ...okCycle, state: 'error', error: 'Hors ligne' });

    expect(await onglet.clic()).toEqual({ state: 'error', error: 'Hors ligne' });
  });

  it('un cycle DÉJÀ EN VOL est REJOINT, pas refusé', async () => {
    let liberer = (): void => undefined;
    const enVol = new Promise<typeof okCycle>((resolve) => {
      liberer = () => resolve(okCycle);
    });
    // Le vrai verrou de readSync rend la promesse du cycle en vol : la doublure
    // fait pareil, c'est ce « rejoindre » que le bouton doit obtenir.
    mocks.pullFromCloud.mockImplementation(() => enVol);
    const onglet = await ouvrirOnglet(); // cycle de démarrage, suspendu

    const clic = onglet.clic();
    await vi.advanceTimersByTimeAsync(0);
    liberer();
    await vi.advanceTimersByTimeAsync(0);

    expect(await clic).toEqual({ state: 'idle', alreadyRunning: true });
  });
});

describe('sans les API d’élection — chaque onglet est son propre meneur', () => {
  it('le bouton cycle ici, sans rien attendre de personne', async () => {
    vi.stubGlobal('navigator', {});
    const onglet = await ouvrirOnglet();
    mocks.pullFromCloud.mockClear();

    expect(await onglet.clic()).toEqual({ state: 'idle' });
    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(1);
  });
});
