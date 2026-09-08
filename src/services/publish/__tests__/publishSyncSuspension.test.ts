/**
 * LA SUSPENSION DU CYCLE ORDINAIRE PENDANT UNE MIGRATION.
 *
 * Deux moitiés, et il faut les DEUX :
 *  1. la TABLE (`isOrdinarySyncSuspended`) — quels états de journal suspendent ;
 *  2. le BRANCHEMENT — `triggerSync` consulte réellement le drapeau EN TÊTE,
 *     avant toute sonde, et la découverte de profils vit derrière lui.
 *
 * La panne constatée sur mobile était précisément une table écrite, testée, et
 * jamais consultée : le cycle a tourné en pleine migration et la découverte de
 * profils a adopté en douce les profils cibles. La seconde moitié de ce fichier
 * ÉCHOUE si le court-circuit de `triggerSync` disparaît.
 */

import { isOrdinarySyncSuspended } from '../../../../electron/publish/journalMachine';
import type { PublishState } from '../../../../electron/publish/types';

// ── Le process principal, remplacé pièce par pièce ──────────────────────────
// `syncService` vit dans Electron : chaque dépendance est substituée pour que
// le VRAI `triggerSync` s'exécute ici, avec son vrai court-circuit.

vi.mock('electron', () => ({
  // Jamais consulté par ces tests : le cycle s'arrête bien avant tout chemin
  // de fichier (c'est précisément ce qu'ils prouvent).
  app: { getPath: () => '' },
  BrowserWindow: class {},
  net: { isOnline: () => true },
}));
vi.mock('electron-log', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../../electron/sync/multipartTransfer', () => ({
  streamingSha256: vi.fn(),
}));
vi.mock('../../../../electron/storageService', () => ({
  __esModule: true,
  default: {},
}));
vi.mock('../../../../electron/profileManager', () => ({
  __esModule: true,
  default: {},
}));
vi.mock('../../../../electron/reminderScheduler', () => ({
  rescheduleAll: async () => undefined,
}));
// `isAuthenticated` est un `vi.fn()` SANS implémentation, à dessein : la
// config CRA (`resetMocks: true`) effacerait une implémentation posée dans la
// fabrique avant chaque test. Son retour `undefined` est falsy — le cycle
// s'arrête à « non authentifié », ce qui suffit : seul le fait d'avoir été
// CONSULTÉ compte ici.
vi.mock('../../../../electron/authService', () => ({
  isAuthenticated: vi.fn(),
  getMe: vi.fn(),
  authenticatedApiCall: vi.fn(),
}));
vi.mock('../../../../electron/sync/syncR2Client', () => ({
  createDeltaTransport: () => ({}),
  resetDirectCapabilityCache: () => undefined,
  getStorageMode: async () => 'filarr',
  SyncConflictError: class SyncConflictError extends Error {},
  ByosSyncError: class ByosSyncError extends Error {},
}));
vi.mock('../../../../electron/sync/syncManifest', () => ({
  getConflicts: async () => [],
}));
vi.mock('../../../../electron/sync/syncQueue', () => ({
  getFailedItems: async () => [],
  getPendingCount: async () => 0,
}));
vi.mock('../../../../electron/sync/deltaSync', () => ({}));
vi.mock('../../../../electron/sync/deltaManifest', () => ({
  DELTA_THRESHOLD: 1000,
}));

import * as syncService from '../../../../electron/sync/syncService';
import { isAuthenticated } from '../../../../electron/authService';
import { describe, it, expect, afterEach, vi } from 'vitest';

// ── 1. La table ─────────────────────────────────────────────────────────────

describe('isOrdinarySyncSuspended — la table de décision', () => {
  it('tout état VIVANT suspend le cycle — FAILED compris, il attend une reprise', () => {
    const alive: PublishState[] = [
      'PREPARING',
      'READY',
      'PUBLISHING',
      'VERIFYING',
      'SWITCHING',
      'FAILED',
    ];
    for (const state of alive) {
      expect(isOrdinarySyncSuspended(state)).toBe(true);
    }
  });

  it('les états TERMINAUX rendent le cycle : DONE (clé promue) et ABANDONED (seul le ménage distant reste)', () => {
    expect(isOrdinarySyncSuspended('DONE')).toBe(false);
    expect(isOrdinarySyncSuspended('ABANDONED')).toBe(false);
  });
});

// ── 2. Le branchement ───────────────────────────────────────────────────────

describe('triggerSync — le drapeau est consulté EN TÊTE de cycle', () => {
  afterEach(() => {
    // Ne jamais laisser la suspension posée pour un autre test.
    syncService.setPublishSuspended(false);
    vi.clearAllMocks();
  });

  it('suspendu ⇒ le cycle rend la main AVANT toute sonde — donc avant la découverte de profils', async () => {
    syncService.setPublishSuspended(true);

    const status = await syncService.triggerSync('profil-1');

    // `isAuthenticated` est la PREMIÈRE sonde après le court-circuit : si elle
    // n'a pas été consultée, RIEN d'ultérieur (téléversements, fusion de
    // manifestes, découverte/adoption de profils) n'a pu courir. C'est ce test
    // qui échoue si le branchement du drapeau disparaît de `triggerSync`.
    expect(isAuthenticated).not.toHaveBeenCalled();
    expect(status.state).toBe('idle');
  });

  it('repris ⇒ le cycle repart réellement (la sonde d authentification court à nouveau)', async () => {
    syncService.setPublishSuspended(false);

    await syncService.triggerSync('profil-1');

    expect(isAuthenticated).toHaveBeenCalled();
  });

  it('le drapeau se lit tel qu il a été posé', () => {
    syncService.setPublishSuspended(true);
    expect(syncService.isPublishSuspended()).toBe(true);
    syncService.setPublishSuspended(false);
    expect(syncService.isPublishSuspended()).toBe(false);
  });
});
