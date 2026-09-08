/**
 * Élection de l'onglet MENEUR — le primitif qui empêche la MULTIPLICATION PAR N.
 *
 * Patron de panne : l'ordonnanceur est une variable de MODULE, donc un
 * exemplaire complet par onglet ouvert. Avec N onglets, c'était N sondages
 * toutes les 20 s (chacun = une authentification + une lecture D1 côté Worker,
 * sur une route sans limitation de débit) et N cycles concurrents qui poussent
 * en même temps — le verrou de cycle de readSync étant lui aussi par onglet, il
 * ne les sérialise pas entre eux.
 *
 * Éprouvé ici avec DEUX instances distinctes du module (deux « onglets »)
 * partageant des doublures de `LockManager` et de `BroadcastChannel`, à la
 * manière de notesLock.vitest.ts.
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
// Le cycle interroge le serveur sur la portee du magasin (BYOS local). Ces
// tests portent sur l'election de l'onglet meneur, pas sur cette garde.
vi.mock('../localStoreGuard', () => ({
  isStoreOutOfReachFromBrowser: async () => false,
  resetLocalStoreCache: () => {},
}));
vi.mock('../pendingUploads', () => ({ refreshPendingCount: mocks.refreshPendingCount }));
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
const LEADER_LOCK = 'filarr-sync-leader';
const CHANNEL_NAME = 'filarr-sync';

const okCycle = {
  state: 'idle',
  version: 1,
  installedMeta: 0,
  pushed: 0,
  restoredProfiles: 0,
  notModified: false,
};

let visibility: 'visible' | 'hidden' = 'visible';

/**
 * File d'attente exclusive par nom, comme celle du navigateur — avec ce que le
 * vrai gestionnaire fait de décisif ici : `ifAvailable` refuse net quand le
 * verrou est TENU (c'est ce qui rend deux meneurs impossibles), et `signal`
 * retire une demande encore en file.
 */
function fauxVerrous(): LockManager & { etat: { annulees: number; accordes: number } } {
  const files = new Map<string, Promise<unknown>>();
  const tenus = new Set<string>();
  const etat = { annulees: 0, accordes: 0 };
  const manager = {
    etat,
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
          etat.annulees++;
          reject(Object.assign(new Error('lock request aborted'), { name: 'AbortError' }));
        };
        if (opts.signal?.aborted) {
          abandonner();
          return;
        }
        opts.signal?.addEventListener('abort', abandonner, { once: true });
        void precedent.then(() => {
          if (opts.signal?.aborted) return; // déjà rejetée
          tenus.add(nom);
          etat.accordes++;
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
  return manager as unknown as LockManager & { etat: typeof etat };
}

interface MessageVu {
  data: unknown;
}

/** Doublure de BroadcastChannel : livraison en microtâche, jamais à soi-même. */
function fauxCanaux() {
  const ouverts = new Set<FauxCanal>();
  class FauxCanal {
    name: string;
    onmessage: ((event: MessageVu) => void) | null = null;
    ferme = false;
    constructor(name: string) {
      this.name = name;
      ouverts.add(this);
    }
    postMessage(data: unknown): void {
      if (this.ferme) throw new Error('canal fermé');
      // Le navigateur clone la charge : une valeur non clonable doit se voir.
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
let verrous: ReturnType<typeof fauxVerrous>;
const ouvertsScheduler: Array<typeof import('../syncScheduler')> = [];

/** Un « onglet » = une instance neuve du module, comme un second app.filarr.com. */
async function ouvrirOnglet(): Promise<{
  scheduler: typeof import('../syncScheduler');
  bus: typeof import('../../webEventBus');
}> {
  vi.resetModules();
  const scheduler = await import('../syncScheduler');
  // Le bus doit venir du MÊME registre que l'ordonnanceur, sinon l'événement
  // n'atteint pas son abonné.
  const bus = await import('../../webEventBus');
  ouvertsScheduler.push(scheduler);
  scheduler.startSyncScheduler();
  await vi.advanceTimersByTimeAsync(0);
  return { scheduler, bus };
}

/** Un tiers garde le verrou : l'onglet ouvert ensuite reste suiveur. */
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
  messages: unknown[];
  poster: (data: unknown) => void;
  fermer: () => void;
} {
  const messages: unknown[] = [];
  const canal = new FauxCanal(CHANNEL_NAME);
  canal.onmessage = (event) => messages.push(event.data);
  return {
    messages,
    poster: (data) => canal.postMessage(data),
    fermer: () => canal.close(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  ouvertsScheduler.length = 0;
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
  FauxCanal = fauxCanaux();
  verrous = fauxVerrous();
  vi.stubGlobal('navigator', { locks: verrous });
  vi.stubGlobal('BroadcastChannel', FauxCanal);
});

afterEach(() => {
  for (const scheduler of ouvertsScheduler) scheduler.stopSyncScheduler();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.resetModules();
});

describe('un seul onglet travaille', () => {
  it('deux onglets ne font qu’un sondage par période et un seul cycle de démarrage', async () => {
    await ouvrirOnglet();
    await ouvrirOnglet();

    // Le suiveur n'ouvre pas de second cycle de démarrage.
    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(PROBE_MS * 3);

    // Sans élection : 6 sondages (2 onglets × 3 périodes) et autant de lectures D1.
    expect(mocks.probeManifestChanged).toHaveBeenCalledTimes(3);
    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(1);
  });

  it('un suiveur ne cycle pas tout seul : il DEMANDE au meneur', async () => {
    const tiers = occuperLeVerrou();
    await vi.advanceTimersByTimeAsync(0);

    const espion = canalDeTest();
    const suiveur = await ouvrirOnglet();
    expect(mocks.pullFromCloud).not.toHaveBeenCalled(); // suiveur : aucun cycle

    suiveur.bus.emitWebEvent('web:pending-marked');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await vi.advanceTimersByTimeAsync(0);

    // Il n'a rien poussé lui-même…
    expect(mocks.pullFromCloud).not.toHaveBeenCalled();
    // …mais il a réclamé le cycle sur le canal, en attendant un accusé (sans
    // quoi il finirait par pousser lui-même — voir la suite).
    const demande = espion.messages.find((m) => (m as { type?: string }).type === 'cycle') as
      | { reason?: string; id?: string }
      | undefined;
    expect(demande?.reason).toBe('modification-suiveur');
    expect(typeof demande?.id).toBe('string');

    espion.fermer();
    tiers.rendre();
  });

  it('le meneur exécute le cycle demandé par un suiveur', async () => {
    await ouvrirOnglet(); // meneur
    const suiveur = await ouvrirOnglet();
    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(1);

    suiveur.bus.emitWebEvent('web:pending-marked');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await vi.advanceTimersByTimeAsync(0);

    // Exactement UN cycle de plus : celui du meneur, pas un par onglet.
    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(2);

    // Accusé reçu : le filet du suiveur ne se déclenche pas et ne double rien.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(2);
  });

  it('meneur MUET : le suiveur finit par pousser SES modifications lui-même', async () => {
    // Un onglet gelé garde son verrou (le navigateur ne le rend qu'à la mort de
    // l'onglet) : sa promotion est impossible et personne n'accuse réception.
    // Sans filet, ce que l'utilisateur écrit ICI ne partait JAMAIS — le pire
    // silence possible, puisque rien à l'écran ne le dit.
    const tiers = occuperLeVerrou();
    await vi.advanceTimersByTimeAsync(0);
    const suiveur = await ouvrirOnglet();

    suiveur.bus.emitWebEvent('web:pending-marked');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.pullFromCloud).not.toHaveBeenCalled(); // il laisse sa chance au meneur

    await vi.advanceTimersByTimeAsync(3_000 + 100); // échéance de l'accusé
    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(1);

    const messages = vi.mocked(console.warn).mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('aucun meneur n’a accusé réception'))).toBe(true);
    tiers.rendre();
  });

  it('un suiveur visible réclame le sondage à chaque période, et se tait caché', async () => {
    const tiers = occuperLeVerrou();
    await vi.advanceTimersByTimeAsync(0);
    const espion = canalDeTest();
    await ouvrirOnglet(); // suiveur

    await vi.advanceTimersByTimeAsync(PROBE_MS * 2);
    expect(espion.messages).toEqual([
      { type: 'wake', reason: 'sondage-suiveur' },
      { type: 'wake', reason: 'sondage-suiveur' },
    ]);

    visibility = 'hidden';
    await vi.advanceTimersByTimeAsync(PROBE_MS * 2);
    expect(espion.messages).toHaveLength(2);

    espion.fermer();
    tiers.rendre();
  });

  it('le meneur CACHÉ sonde quand même à la demande d’un suiveur visible', async () => {
    await ouvrirOnglet(); // meneur
    const suiveur = canalDeTest();

    // Meneur en arrière-plan : son propre tic est muet (garde de visibilité).
    visibility = 'hidden';
    await vi.advanceTimersByTimeAsync(PROBE_MS);
    expect(mocks.probeManifestChanged).not.toHaveBeenCalled();

    // Mais un suiveur visible, lui, veut de la fraîcheur — et trois suiveurs
    // qui la réclament au même tic ne valent toujours qu'UN sondage.
    suiveur.poster({ type: 'wake', reason: 'sondage-suiveur' });
    suiveur.poster({ type: 'wake', reason: 'sondage-suiveur' });
    suiveur.poster({ type: 'wake', reason: 'sondage-suiveur' });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.probeManifestChanged).toHaveBeenCalledTimes(1);

    suiveur.fermer();
  });
});

describe('perte du meneur', () => {
  it('promeut un suiveur, qui reprend cycle et sondage', async () => {
    const meneur = await ouvrirOnglet();
    await ouvrirOnglet();
    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(1);

    // Fermeture de l'onglet meneur (le navigateur rendrait le verrou de même).
    meneur.scheduler.stopSyncScheduler();
    await vi.advanceTimersByTimeAsync(0);

    // Le suiveur promu fait son cycle de démarrage…
    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(2);
    // …et prend le sondage à son compte.
    await vi.advanceTimersByTimeAsync(PROBE_MS);
    expect(mocks.probeManifestChanged).toHaveBeenCalledTimes(1);
  });
});

describe('diffusion des changements', () => {
  it('le suiveur rejoue les événements du cycle du meneur', async () => {
    const meneur = await ouvrirOnglet();
    const suiveur = await ouvrirOnglet();

    const vus: string[] = [];
    suiveur.bus.subscribeWebEvent('folders-updated', () => vus.push('folders-updated'));
    suiveur.bus.subscribeWebEvent('notes-updated', () => vus.push('notes-updated'));
    suiveur.bus.subscribeWebEvent('sync-file-status-changed', (...args) =>
      vus.push(`sync-file-status-changed:${JSON.stringify(args[0])}`)
    );
    mocks.refreshPendingCount.mockClear();

    // Le cycle du meneur écrit dans l'IndexedDB PARTAGÉ et l'annonce sur SON bus.
    mocks.pullFromCloud.mockImplementationOnce(async () => {
      meneur.bus.emitWebEvent('folders-updated');
      meneur.bus.emitWebEvent('notes-updated');
      meneur.bus.emitWebEvent('sync-file-status-changed', { fileId: 'f1', status: 'synced' });
      meneur.bus.emitWebEvent('folders-updated'); // doublon : dédupliqué
      return okCycle;
    });
    mocks.probeManifestChanged.mockResolvedValueOnce('changed');
    await vi.advanceTimersByTimeAsync(PROBE_MS);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(vus).toEqual([
      'folders-updated',
      'notes-updated',
      'sync-file-status-changed:{"fileId":"f1","status":"synced"}',
    ]);
    // Le compteur du garde-fou de fermeture suit la purge faite par le meneur.
    expect(mocks.refreshPendingCount).toHaveBeenCalled();
  });

  it('ne rejoue pas un canal hors liste blanche', async () => {
    const meneur = await ouvrirOnglet();
    const suiveur = await ouvrirOnglet();

    let reveils = 0;
    suiveur.bus.subscribeWebEvent('web:pending-marked', () => {
      reveils++;
    });

    mocks.pullFromCloud.mockImplementationOnce(async () => {
      meneur.bus.emitWebEvent('web:pending-marked'); // rejouer ceci bouclerait
      return okCycle;
    });
    mocks.probeManifestChanged.mockResolvedValueOnce('changed');
    await vi.advanceTimersByTimeAsync(PROBE_MS);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(reveils).toBe(0);
  });
});

describe('repli sans les API d’élection', () => {
  it('sans navigator.locks : chaque onglet pour soi (comportement d’avant)', async () => {
    vi.stubGlobal('navigator', {});
    await ouvrirOnglet();
    await ouvrirOnglet();

    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(PROBE_MS);
    expect(mocks.probeManifestChanged).toHaveBeenCalledTimes(2);
  });

  it('sans BroadcastChannel : pas d’élection non plus (un suiveur serait muet)', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    await ouvrirOnglet();
    await ouvrirOnglet();

    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(PROBE_MS);
    expect(mocks.probeManifestChanged).toHaveBeenCalledTimes(2);
  });

  it('le repli est JOURNALISÉ : c’est le mode où N onglets refont N cycles', async () => {
    // Sans trace, un onglet qui perd l'élection (contexte non sécurisé, vieux
    // navigateur) se met à sonder et cycler pour son compte en silence.
    vi.stubGlobal('navigator', {});
    await ouvrirOnglet();

    const messages = vi.mocked(console.warn).mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('élection impossible'))).toBe(true);
  });

  it('un refus RÉEL du gestionnaire promeut quand même, et le dit', async () => {
    const casse = {
      request: () => Promise.reject(new Error('contexte perdu')),
    } as unknown as LockManager;
    vi.stubGlobal('navigator', { locks: casse });

    await ouvrirOnglet();
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(1); // meneur solitaire
    const messages = vi.mocked(console.warn).mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('demande de verrou de meneur refusée'))).toBe(true);
  });
});

describe('demande de verrou : jamais abandonnée dans la file', () => {
  it('l’arrêt ANNULE la demande en attente (elle fuyait à chaque verrouillage)', async () => {
    // Sans `signal`, chaque cycle démarrage/verrouillage laissait une demande
    // vivante dans la file du navigateur : la première accordée réveillait un
    // ordonnanceur dont plus personne ne tenait les rênes.
    const tiers = occuperLeVerrou();
    await vi.advanceTimersByTimeAsync(0);
    const suiveur = await ouvrirOnglet();
    expect(verrous.etat.annulees).toBe(0);

    suiveur.scheduler.stopSyncScheduler();
    await vi.advanceTimersByTimeAsync(0);
    expect(verrous.etat.annulees).toBe(1);

    // Et l'annulation ne se fait pas passer pour un échec : aucune promotion.
    tiers.rendre();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.pullFromCloud).not.toHaveBeenCalled();
  });
});

describe('battement de cœur du meneur', () => {
  it('le meneur donne signe de vie à chaque tic', async () => {
    await ouvrirOnglet(); // meneur
    const espion = canalDeTest();

    await vi.advanceTimersByTimeAsync(PROBE_MS);
    await vi.advanceTimersByTimeAsync(0);

    expect(espion.messages).toContainEqual({ type: 'status', busy: false });
    espion.fermer();
  });

  it('une demande de suiveur reçoit un accusé IMMÉDIAT', async () => {
    // Sans accusé, le demandeur ne sait pas si quelqu'un l'a entendu.
    await ouvrirOnglet(); // meneur
    const suiveur = canalDeTest();

    suiveur.poster({ type: 'cycle', reason: 'modification-suiveur' });
    await vi.advanceTimersByTimeAsync(0);

    expect(suiveur.messages).toContainEqual({ type: 'status', busy: true });
    suiveur.fermer();
  });

  it('deux périodes de SILENCE : le suiveur journalise et tente une promotion', async () => {
    // Un meneur figé (onglet gelé, cycle bloqué) ne rend pas son verrou : le
    // suiveur ne peut pas le remplacer, mais il doit cesser d'attendre en
    // silence — c'est ce diagnostic qui manquait.
    const tiers = occuperLeVerrou();
    await vi.advanceTimersByTimeAsync(0);
    await ouvrirOnglet(); // suiveur, sans meneur qui batte

    await vi.advanceTimersByTimeAsync(PROBE_MS * 2 + 1000);

    const messages = vi.mocked(console.warn).mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('aucun signe du meneur'))).toBe(true);
    // JAMAIS deux meneurs : le verrou est tenu, la promotion est refusée.
    expect(mocks.pullFromCloud).not.toHaveBeenCalled();

    tiers.rendre();
  });

  it('un onglet CACHÉ ne crie pas au meneur mort (ses minuteries sont bridées)', async () => {
    const tiers = occuperLeVerrou();
    await vi.advanceTimersByTimeAsync(0);
    await ouvrirOnglet(); // suiveur

    visibility = 'hidden';
    await vi.advanceTimersByTimeAsync(PROBE_MS * 6);

    const messages = vi.mocked(console.warn).mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('aucun signe du meneur'))).toBe(false);
    tiers.rendre();
  });

  it('un meneur qui bat empêche la promotion ET le message', async () => {
    await ouvrirOnglet(); // meneur, qui bat à chaque tic
    await ouvrirOnglet(); // suiveur
    mocks.pullFromCloud.mockClear();

    await vi.advanceTimersByTimeAsync(PROBE_MS * 3);

    const messages = vi.mocked(console.warn).mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('aucun signe du meneur'))).toBe(false);
  });
});

describe('demande de cycle refusée : mise en file, jamais jetée', () => {
  /** Rend un cycle suspendu et le moyen de le libérer. */
  function cycleSuspendu(): { liberer: () => void } {
    let liberer = (): void => undefined;
    mocks.pullFromCloud.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          liberer = () => resolve(okCycle);
        })
    );
    return { liberer: () => liberer() };
  }

  it('LE DÉFAUT : la demande d’un suiveur arrivée pendant un cycle était perdue', async () => {
    const suspendu = cycleSuspendu();
    await ouvrirOnglet(); // meneur : son cycle de démarrage reste en vol
    const suiveur = canalDeTest();
    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(1);

    suiveur.poster({ type: 'cycle', reason: 'modification-suiveur' });
    await vi.advanceTimersByTimeAsync(0);
    // Rien de plus tant que le cycle en vol tient le verrou.
    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(1);

    suspendu.liberer();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    // La demande refusée a été consommée à la sortie du cycle.
    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(2);
    suiveur.fermer();
  });

  it('une seule relance, quel que soit le nombre de demandes refusées', async () => {
    const suspendu = cycleSuspendu();
    await ouvrirOnglet();
    const suiveur = canalDeTest();

    suiveur.poster({ type: 'cycle', reason: 'a' });
    suiveur.poster({ type: 'cycle', reason: 'b' });
    suiveur.poster({ type: 'cycle', reason: 'c' });
    await vi.advanceTimersByTimeAsync(0);

    suspendu.liberer();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(2); // pas quatre
    suiveur.fermer();
  });
});

describe('chien de garde du verrou de cycle', () => {
  it('un cycle qui ne rend JAMAIS la main ne condamne pas l’onglet', async () => {
    // Un fetch sans délai maximal sur un réseau qui décroche laissait `_running`
    // à `true` à vie : le meneur refusait tout travail et les suiveurs
    // attendaient un cycle que personne ne ferait plus.
    mocks.pullFromCloud.mockImplementationOnce(() => new Promise(() => undefined));
    await ouvrirOnglet();
    const suiveur = canalDeTest();
    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(1);

    // Avant le plafond : le verrou tient, pas même un sondage ne passe.
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(mocks.probeManifestChanged).not.toHaveBeenCalled();

    // Passé le plafond (3 min), le verrou est repris : tout repart.
    await vi.advanceTimersByTimeAsync(61 * 1000);
    expect(mocks.probeManifestChanged).toHaveBeenCalled();
    suiveur.poster({ type: 'cycle', reason: 'modification-suiveur' });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(2);

    const messages = vi.mocked(console.warn).mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('cycle figé'))).toBe(true);
    suiveur.fermer();
  });

  it('le cycle zombie qui finit enfin ne vole pas le verrou du suivant', async () => {
    // Son `finally` s'exécute alors qu'un AUTRE cycle tient le verrou : sans
    // jeton, il l'ouvrirait sous ses pieds.
    let libererZombie = (): void => undefined;
    mocks.pullFromCloud.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          libererZombie = () => resolve(okCycle);
        })
    );
    await ouvrirOnglet();
    const suiveur = canalDeTest();

    await vi.advanceTimersByTimeAsync(3 * 60 * 1000 + 1000);
    // Un cycle NEUF prend le verrou et reste en vol.
    let libererNeuf = (): void => undefined;
    mocks.pullFromCloud.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          libererNeuf = () => resolve(okCycle);
        })
    );
    suiveur.poster({ type: 'cycle', reason: 'neuf' });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(2);

    // Le zombie finit : il ne doit RIEN relâcher.
    libererZombie();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    suiveur.poster({ type: 'cycle', reason: 'pendant-le-neuf' });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(2);

    libererNeuf();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    // La demande refusée pendant le cycle neuf, elle, a bien été rejouée.
    expect(mocks.pullFromCloud).toHaveBeenCalledTimes(3);
    suiveur.fermer();
  });
});
