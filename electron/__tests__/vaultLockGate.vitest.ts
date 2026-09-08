/**
 * LA PORTE — ce qu'elle refuse, ce qu'elle laisse passer, et ce qu'elle avoue.
 *
 * Le point délicat n'est pas « refuser quand c'est verrouillé » : c'est que le
 * refus tombe AVANT le handler, que les canaux du déverrouillage restent
 * ouverts, et que la liste ne pourrisse pas en silence quand un canal est
 * renommé.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  GATED_CHANNELS,
  auditGate,
  installVaultLockGate,
  resetGateForTests,
  type HandleRegistrar,
} from '../vaultLockGate';
import {
  ERR_VAULT_LOCKED,
  noteVaultLockedByMain,
  reportRendererLockState,
  resetVaultLockStateForTests,
} from '../vaultLockState';

type Listener = (event: unknown, ...args: unknown[]) => unknown;

/** Faux `ipcMain` : retient ce qui a été enregistré et sait le rappeler. */
function fakeIpcMain(): HandleRegistrar & { invoke(channel: string, ...args: unknown[]): unknown } {
  const handlers = new Map<string, Listener>();
  return {
    handle(channel: string, listener: Listener) {
      handlers.set(channel, listener);
    },
    invoke(channel: string, ...args: unknown[]) {
      const h = handlers.get(channel);
      if (!h) throw new Error(`canal non enregistré : ${channel}`);
      return h(undefined, ...args);
    },
  };
}

beforeEach(() => {
  resetGateForTests();
  resetVaultLockStateForTests();
});

describe('enrobage des canaux gardés', () => {
  it('refuse un canal gardé pendant le verrouillage, sans atteindre le handler', () => {
    const ipc = fakeIpcMain();
    installVaultLockGate(ipc);

    let touched = false;
    ipc.handle('notes:load', () => {
      touched = true;
      return 'le clair des notes';
    });

    noteVaultLockedByMain();
    expect(() => ipc.invoke('notes:load')).toThrow(ERR_VAULT_LOCKED);
    // L'essentiel : le handler n'a PAS tourné. Refuser après coup aurait laissé
    // la lecture avoir lieu, et c'est la lecture qu'on refuse.
    expect(touched).toBe(false);
  });

  it('laisse passer le même canal une fois déverrouillé', () => {
    const ipc = fakeIpcMain();
    installVaultLockGate(ipc);
    ipc.handle('notes:load', () => 'le clair des notes');

    reportRendererLockState(false);
    expect(ipc.invoke('notes:load')).toBe('le clair des notes');
  });

  it('laisse passer au démarrage, quand rien n a encore été rapporté', () => {
    // L'écran de choix de profil lit avant qu'un rapport existe.
    const ipc = fakeIpcMain();
    installVaultLockGate(ipc);
    ipc.handle('getFolders', () => []);

    expect(() => ipc.invoke('getFolders')).not.toThrow();
  });

  it("n'enrobe pas les canaux hors liste, verrouillé ou non", () => {
    const ipc = fakeIpcMain();
    installVaultLockGate(ipc);
    ipc.handle('hybrid:loadWrappedKey', () => ({ wrapped: true }));
    ipc.handle('security:fekStatus', () => ({ active: true }));

    noteVaultLockedByMain();
    // Fermer ces canaux-là interdirait de rouvrir le coffre.
    expect(ipc.invoke('hybrid:loadWrappedKey')).toEqual({ wrapped: true });
    expect(ipc.invoke('security:fekStatus')).toEqual({ active: true });
  });

  it('transmet les arguments ET la valeur de retour du handler d origine', () => {
    const ipc = fakeIpcMain();
    installVaultLockGate(ipc);
    ipc.handle('getFolder', (_event, id) => `dossier:${String(id)}`);

    reportRendererLockState(false);
    expect(ipc.invoke('getFolder', 'abc123')).toBe('dossier:abc123');
  });
});

describe('audit de la liste', () => {
  it('signale un nom listé qu aucun handler ne porte', () => {
    // C'est TOUT l'intérêt de l'enrobage sur une liste : un canal renommé
    // devient visible au lieu d'ouvrir un trou muet.
    const ipc = fakeIpcMain();
    installVaultLockGate(ipc);
    ipc.handle('notes:load', () => null);

    const { guarded, missing } = auditGate();
    expect(guarded).toContain('notes:load');
    expect(missing).toContain('getFolders');
    expect(missing).not.toContain('notes:load');
  });

  it('ne signale plus rien quand tous les canaux listés sont enregistrés', () => {
    const ipc = fakeIpcMain();
    installVaultLockGate(ipc);
    for (const channel of GATED_CHANNELS) ipc.handle(channel, () => null);

    expect(auditGate().missing).toEqual([]);
  });
});

describe('la liste elle-même', () => {
  it("n'enferme AUCUN canal nécessaire au déverrouillage", () => {
    // Régression : gardez `hybrid:loadFEK` et plus personne ne rouvre son
    // coffre. Ces noms sont la sortie de secours, ils restent dehors.
    const sortieDeSecours = [
      'hybrid:loadFEK',
      'hybrid:loadWrappedKey',
      'hybrid:storeFEK',
      'hybrid:hasKey',
      'hybrid:loadDeviceKey',
      'secureStore:getPasswordHashes',
      'security:fekStatus',
      'security:getEnhancedLock',
      'crypto:argon2DeriveKey',
      'crypto:verifyPassword',
      'profile:activate',
      'profile:getManifest',
      'profile:verifyPin',
      'sync:setSessionKey',
      'sync:clearSessionKey',
    ];
    for (const channel of sortieDeSecours) {
      expect(GATED_CHANNELS).not.toContain(channel);
    }
  });

  it("laisse dehors les écritures pilotées par un debounce, et l'efface-le-clair", () => {
    // Les refuser échangerait un risque de lecture contre un risque de PERTE
    // (notes:save / saveDelta), ou laisserait traîner du clair (purge des
    // temporaires). Voir le commentaire de GATED_CHANNELS.
    for (const channel of ['notes:save', 'notes:saveDelta', 'vault:purgeTemp', 'deleteTempFile']) {
      expect(GATED_CHANNELS).not.toContain(channel);
    }
  });

  it('ne contient pas de doublon', () => {
    expect(new Set(GATED_CHANNELS).size).toBe(GATED_CHANNELS.length);
  });
});
