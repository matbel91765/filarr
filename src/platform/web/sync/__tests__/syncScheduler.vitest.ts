/**
 * Tests du sondage quasi-temps-réel de l'ordonnanceur web (GET conditionnel) :
 * cadence, verrous, visibilité, back-off, 401, arrêt propre.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pullFromCloud: vi.fn(),
  probeManifestChanged: vi.fn(),
  clearServerVersions: vi.fn(),
  getActiveProfileId: vi.fn(),
  refreshPendingCount: vi.fn(),
}));

vi.mock('../readSync', () => ({
  pullFromCloud: mocks.pullFromCloud,
  probeManifestChanged: mocks.probeManifestChanged,
  clearServerVersions: mocks.clearServerVersions,
}));
vi.mock('../../webStore', () => ({ getActiveProfileId: mocks.getActiveProfileId }));
vi.mock('../pendingUploads', () => ({ refreshPendingCount: mocks.refreshPendingCount }));
// Le cycle demande au serveur si le magasin du compte est hors de portee d'un
// navigateur (BYOS local). Ces tests portent sur la CADENCE du planificateur,
// pas sur cette garde : on repond « joignable », le cas par defaut.
vi.mock('../localStoreGuard', () => ({
  isStoreOutOfReachFromBrowser: async () => false,
  resetLocalStoreCache: () => {},
}));
// Le profil actif est rattaché au compte de la session : c'est la condition
// pour qu'un cycle parte (syncScheduler.profileMatchesSession).
vi.mock('../../idb', () => ({
  idbGet: async () => ({
    activeProfileId: 'p1',
    profiles: [{ id: 'p1', cloudAccount: { email: 'moi@example.com' } }],
  }),
  idbPut: async () => undefined,
  idbDelete: async () => undefined,
  idbKeys: async () => [],
}));
vi.mock('../../handlers/authHandlers', () => ({
  getSessionUser: () => ({ email: 'moi@example.com' }),
  isPendingRealmOpen: () => false,
  restoreSessionOnce: async () => undefined,
}));

const PROBE_MS = 20_000;
const DEBOUNCE_MS = 10_000;
const CYCLE_MS = 5 * 60_000;

let visibility: 'visible' | 'hidden' = 'visible';
let scheduler: typeof import('../syncScheduler');
// Le bus doit venir du MÊME registre de modules que l'ordonnanceur
// (vi.resetModules), sinon l'événement n'atteint pas son abonné.
let bus: typeof import('../../webEventBus');

/** Promesse résolue à la demande — pour figer un sondage ou un cycle en vol. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const okCycle: {
  state: string;
  version: number;
  installedMeta: number;
  pushed: number;
  restoredProfiles: number;
  notModified: boolean;
  error?: string;
} = {
  state: 'idle',
  version: 1,
  installedMeta: 0,
  pushed: 0,
  restoredProfiles: 0,
  notModified: false,
};

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  visibility = 'visible';
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: {
      get visibilityState() {
        return visibility;
      },
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
  mocks.clearServerVersions.mockReset();
  scheduler = await import('../syncScheduler');
  bus = await import('../../webEventBus');
});

afterEach(() => {
  scheduler.stopSyncScheduler();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function start(): Promise<void> {
  scheduler.startSyncScheduler();
  await vi.advanceTimersByTimeAsync(0); // laisse le cycle de démarrage se poser
}

describe('sondage par GET conditionnel', () => {
  it('sonde toutes les 20 s sans relancer de cycle quand rien ne bouge (304)', async () => {
    await start();
    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(1); // cycle de démarrage
    await vi.advanceTimersByTimeAsync(PROBE_MS * 3);
    expect(mocks.probeManifestChanged).toHaveBeenCalledTimes(3);
    expect(mocks.probeManifestChanged).toHaveBeenCalledWith('p1');
    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(1); // aucun cycle inutile
  });

  it('un 200 déclenche un cycle complet unique', async () => {
    await start();
    mocks.probeManifestChanged.mockResolvedValueOnce('changed');
    await vi.advanceTimersByTimeAsync(PROBE_MS);
    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(PROBE_MS);
    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(2);
  });

  it('aucun sondage quand l’onglet est caché', async () => {
    await start();
    visibility = 'hidden';
    await vi.advanceTimersByTimeAsync(PROBE_MS * 3);
    expect(mocks.probeManifestChanged).not.toHaveBeenCalled();
    visibility = 'visible';
    await vi.advanceTimersByTimeAsync(PROBE_MS);
    expect(mocks.probeManifestChanged).toHaveBeenCalledTimes(1);
  });

  it('se suspend après 3 échecs et repart au premier cycle périodique réussi', async () => {
    await start();
    mocks.probeManifestChanged.mockResolvedValue('error');
    await vi.advanceTimersByTimeAsync(PROBE_MS * 5);
    expect(mocks.probeManifestChanged).toHaveBeenCalledTimes(3); // suspendu au 3e

    mocks.probeManifestChanged.mockResolvedValue('unchanged');
    await vi.advanceTimersByTimeAsync(CYCLE_MS); // filet de sécurité
    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(2);
    mocks.probeManifestChanged.mockClear();
    await vi.advanceTimersByTimeAsync(PROBE_MS);
    expect(mocks.probeManifestChanged).toHaveBeenCalledTimes(1);
  });

  it('un 401 suspend immédiatement (la restauration de session a son chemin)', async () => {
    await start();
    mocks.probeManifestChanged.mockResolvedValue('unauthorized');
    await vi.advanceTimersByTimeAsync(PROBE_MS * 4);
    expect(mocks.probeManifestChanged).toHaveBeenCalledTimes(1);
  });

  it('un cycle en cours interdit tout sondage (verrou)', async () => {
    const gate: { release: () => void } = { release: () => undefined };
    mocks.pullFromCloud.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          gate.release = () => resolve(okCycle);
        })
    );
    await start();
    await vi.advanceTimersByTimeAsync(PROBE_MS * 2);
    expect(mocks.probeManifestChanged).not.toHaveBeenCalled();
    gate.release();
    await vi.advanceTimersByTimeAsync(PROBE_MS);
    expect(mocks.probeManifestChanged).toHaveBeenCalledTimes(1);
  });

  it('stopSyncScheduler arrête sondage et cycles', async () => {
    await start();
    scheduler.stopSyncScheduler();
    await vi.advanceTimersByTimeAsync(CYCLE_MS * 2);
    expect(mocks.probeManifestChanged).not.toHaveBeenCalled();
    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(1);
    // Les versions connues appartiennent à la session qui s'arrête.
    expect(mocks.clearServerVersions).toHaveBeenCalled();
  });

  it('un sondage EN VOL au moment de l’arrêt ne relance pas de cycle', async () => {
    const enVol = deferred<string>();
    await start();
    mocks.probeManifestChanged.mockReturnValueOnce(enVol.promise);
    await vi.advanceTimersByTimeAsync(PROBE_MS); // le sondage part…
    scheduler.stopSyncScheduler(); // …verrouillage / logout / changement de profil
    enVol.resolve('changed'); // la réponse arrive APRÈS
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(1); // seulement le démarrage
  });

  it('un cycle empêché par le verrou (busy) ne compte pas comme un échec', async () => {
    await start();

    // Le sondage part, puis un cycle concurrent (debounce) prend le verrou :
    // au retour du sondage, le cycle demandé est refusé sans rien tenter.
    const sondage = deferred<string>();
    const cycleConcurrent = deferred<typeof okCycle>();
    mocks.probeManifestChanged.mockReturnValueOnce(sondage.promise);
    await vi.advanceTimersByTimeAsync(PROBE_MS);
    mocks.pullFromCloud.mockReturnValueOnce(cycleConcurrent.promise);
    bus.emitWebEvent('web:pending-marked');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    sondage.resolve('changed');
    await vi.advanceTimersByTimeAsync(0);
    // Cycle concurrent en échec : il ne doit pas RÉARMER le compteur non plus.
    cycleConcurrent.resolve({ ...okCycle, state: 'error', error: 'réseau' });
    await vi.advanceTimersByTimeAsync(0);

    // Deux vrais échecs de sondage : avec la contention comptée pour un échec,
    // le sondage serait suspendu ici (3 sur 3).
    mocks.probeManifestChanged.mockResolvedValue('error');
    await vi.advanceTimersByTimeAsync(PROBE_MS * 2);
    mocks.probeManifestChanged.mockClear();
    await vi.advanceTimersByTimeAsync(PROBE_MS);
    expect(mocks.probeManifestChanged).toHaveBeenCalledTimes(1); // toujours vivant
  });
});
