/**
 * LA CLÉ DU COFFRE AVANT LA LECTURE DU COFFRE.
 *
 * Panne observée en production sur app.filarr.com :
 *
 *     [App] loadNotesFromDisk FAILED:
 *       Error: Hybrid crypto not initialized — call initHybridCrypto first
 *
 * Sur le BUREAU, `notes:load` est servi par le processus principal, qui détient
 * sa propre clé : le renderer peut demander les notes avant d'avoir installé la
 * FEK, personne ne s'en aperçoit. Sur le WEB, c'est le renderer LUI-MÊME qui
 * déchiffre (`webStorageHandlers['notes:load']` → `decryptFileContent`) : la
 * même séquence lève, et le `.catch` d'App.tsx avale l'erreur — l'écran des
 * notes reste vide pour toute la session, sans que rien ne le dise.
 *
 * L'ordonnancement fautif vit dans `handleProfileSelected` (src/App.tsx) :
 * `dispatch(loadNotesFromDisk())` y était émis AVANT
 * `await tryRestoreFEKFromSafeStorage()`. Le garde ci-dessous confronte donc
 * l'AUTORITÉ — le source d'App.tsx — et non une copie du raisonnement.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { store } = vi.hoisted(() => {
  // `hybridCrypto` sonde `window.electron?.ipcRenderer` sur le chemin
  // d'installation de la clé (poussée de clé de session, clés retirées) : sans
  // un `window`, le module lève un ReferenceError en environnement node.
  (globalThis as { window?: unknown }).window = {
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return { store: new Map<string, unknown>() };
});

vi.mock('../webStore', () => ({
  storeGet: async (key: string) => (store.has(key) ? store.get(key) : null),
  storePut: async (key: string, value: unknown) => {
    store.set(key, value);
  },
  storeDelete: async (key: string) => {
    store.delete(key);
  },
  getActiveProfileId: async () => 'profil-test',
}));

vi.mock('../sync/readSync', () => ({
  isNotesPushAllowed: async () => false,
  cloudCarriesLayout: async () => false,
  markLayoutPending: async () => {},
  readLocalLayout: async () => null,
  withLayoutLock: async (fn: () => unknown) => fn(),
  writeLocalLayout: async (_id: string, doc: unknown) => doc,
}));

// La crypto est la VRAIE : c'est elle qui porte la garde qu'on éprouve.
import * as hybridCrypto from '../../../services/auth/hybridCrypto';
import { webStorageHandlers } from '../handlers/webStorageHandlers';

const GARDE = 'Hybrid crypto not initialized — call initHybridCrypto first';

const invoke = (channel: string, ...args: unknown[]): Promise<unknown> => {
  const handler = webStorageHandlers[channel];
  if (!handler) throw new Error(`handler ${channel} absent`);
  return Promise.resolve(handler(...args));
};

beforeEach(() => {
  store.clear();
  hybridCrypto.clearHybridCrypto();
});

describe("ordre d'activation d'un profil — src/App.tsx (autorité)", () => {
  const source = readFileSync(fileURLToPath(new URL('../../../App.tsx', import.meta.url)), 'utf8');

  /** Corps de `handleProfileSelected`, isolé pour ne rien lire d'ailleurs. */
  const corps = (): string => {
    const debut = source.indexOf('const handleProfileSelected');
    expect(debut, 'handleProfileSelected introuvable dans App.tsx').toBeGreaterThan(-1);
    const fin = source.indexOf('// Loading: waiting for onboarding flag check', debut);
    expect(fin, 'fin de handleProfileSelected introuvable').toBeGreaterThan(debut);
    return source.slice(debut, fin);
  };

  it('installe la clé du coffre AVANT de demander les notes', () => {
    const bloc = corps();
    const cle = bloc.indexOf('tryRestoreFEKFromSafeStorage()');
    const notes = bloc.indexOf('dispatch(loadNotesFromDisk())');
    // Un garde qui ne trouve pas ses deux repères ne garde rien.
    expect(cle, 'tryRestoreFEKFromSafeStorage() absent du bloc').toBeGreaterThan(-1);
    expect(notes, 'dispatch(loadNotesFromDisk()) absent du bloc').toBeGreaterThan(-1);
    expect(cle).toBeLessThan(notes);
  });

  it('installe la clé du coffre AVANT de demander les dossiers et la mise en page', () => {
    const bloc = corps();
    const cle = bloc.indexOf('tryRestoreFEKFromSafeStorage()');
    const dossiers = bloc.indexOf('dispatch(fetchFolders())');
    const layout = bloc.indexOf('dispatch(loadLayoutFromDisk())');
    expect(dossiers).toBeGreaterThan(-1);
    expect(layout).toBeGreaterThan(-1);
    expect(cle).toBeLessThan(dossiers);
    expect(cle).toBeLessThan(layout);
  });
});

describe('ce que coûte le mauvais ordre — notes:load côté web', () => {
  it('lève la garde de la crypto hybride quand la FEK n’est pas encore installée', async () => {
    // Un coffre BIEN présent dans IndexedDB, scellé lors d'une session
    // précédente : c'est exactement l'état d'un rechargement de page.
    await hybridCrypto.importFEKRaw(crypto.getRandomValues(new Uint8Array(32)));
    await invoke('notes:save', { byId: { n1: { id: 'n1' } }, allIds: ['n1'], templates: [] });
    const scelle = store.get('notes_enc');
    expect(scelle).toBeInstanceOf(Uint8Array);

    // La page se recharge : la mémoire du module est vide, le blob reste.
    hybridCrypto.clearHybridCrypto();
    expect(hybridCrypto.hasHybridKey()).toBe(false);

    await expect(invoke('notes:load')).rejects.toThrow(GARDE);
  });

  it('rend le coffre dès que la FEK est installée — même blob, même clé', async () => {
    const fek = crypto.getRandomValues(new Uint8Array(32));
    await hybridCrypto.importFEKRaw(fek);
    await invoke('notes:save', { byId: { n1: { id: 'n1' } }, allIds: ['n1'], templates: [] });

    hybridCrypto.clearHybridCrypto();
    await hybridCrypto.importFEKRaw(fek);

    const charge = (await invoke('notes:load')) as { allIds: string[] };
    expect(charge.allIds).toEqual(['n1']);
  });
});
