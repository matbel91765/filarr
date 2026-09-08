/**
 * ÉTAT DE VERROUILLAGE CÔTÉ MAIN — les invariants de la porte.
 *
 * Deux régressions sont explicitement gardées ici, parce que ce sont les deux
 * façons de rater ce module :
 *
 *   1. FERMER TROP. Traiter « rien rapporté » comme verrouillé casserait le
 *      démarrage (l'écran de choix de profil déchiffre `profiles.json` avant
 *      qu'un rapport existe) et le changement de profil (le profil entrant
 *      charge dossiers/notes/mise en page avant que son renderer ait parlé).
 *   2. FERMER TROP PEU. Un verrouillage décidé par le main (tray, raccourci,
 *      veille, inactivité) doit tenir même si le renderer ne rapporte jamais —
 *      c'est précisément le chemin où le renderer dort.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ERR_VAULT_LOCKED,
  assertVaultUnlocked,
  awaitRendererLockReport,
  getLastLockCause,
  getReportedLockState,
  isVaultLocked,
  isVaultLockedForDisplay,
  noteProfileSwitch,
  noteSessionKeyCleared,
  noteSessionKeySet,
  noteVaultLockedByMain,
  reportRendererLockState,
  resetVaultLockStateForTests,
} from '../vaultLockState';

beforeEach(() => {
  resetVaultLockStateForTests();
});

describe('la porte (isVaultLocked / assertVaultUnlocked)', () => {
  it('laisse passer au démarrage, quand rien n a encore été rapporté', () => {
    expect(getReportedLockState()).toBeNull();
    expect(isVaultLocked()).toBe(false);
    expect(() => assertVaultUnlocked('get-folders')).not.toThrow();
  });

  it('refuse dès que le renderer rapporte un verrouillage', () => {
    reportRendererLockState(true);
    expect(isVaultLocked()).toBe(true);
    expect(() => assertVaultUnlocked('notes:load')).toThrow(ERR_VAULT_LOCKED);
  });

  it('rouvre quand le renderer rapporte un déverrouillage', () => {
    reportRendererLockState(true);
    reportRendererLockState(false);
    expect(isVaultLocked()).toBe(false);
    expect(() => assertVaultUnlocked('notes:load')).not.toThrow();
  });

  it('tient sur un verrouillage décidé par le main, sans aucun rapport du renderer', () => {
    // Le chemin réel : tray / raccourci / veille / inactivité, renderer endormi.
    noteVaultLockedByMain();
    expect(isVaultLocked()).toBe(true);
    expect(() => assertVaultUnlocked('read-file')).toThrow(ERR_VAULT_LOCKED);
  });

  it('suit la clé de session dans les deux sens', () => {
    noteSessionKeySet();
    expect(isVaultLocked()).toBe(false);
    noteSessionKeyCleared();
    expect(isVaultLocked()).toBe(true);
  });

  it('ne divulgue pas le canal dans le message rendu à l appelant', () => {
    // Le canal sert au journal du main ; le renderer, lui, ne doit avoir qu'UNE
    // chaîne à reconnaître — la même que celle de sessionKeyStore.
    noteVaultLockedByMain();
    try {
      assertVaultUnlocked('hybrid:readDecryptedV3');
      expect.unreachable('assertVaultUnlocked aurait dû lever');
    } catch (err) {
      expect((err as Error).message).toBe(ERR_VAULT_LOCKED);
      expect((err as Error).message).not.toContain('hybrid:readDecryptedV3');
      expect((err as Error & { channel?: string }).channel).toBe('hybrid:readDecryptedV3');
    }
  });
});

describe('changement de profil', () => {
  it('efface le rapport périmé et laisse passer le chargement du profil entrant', () => {
    // RÉGRESSION : poser `true` ici refuserait fetchFolders / loadNotesFromDisk
    // / loadLayoutFromDisk, que handleProfileSelected lance immédiatement après
    // l'activation, avant que le renderer du profil entrant ait pu rapporter.
    reportRendererLockState(true);
    noteProfileSwitch();
    expect(getReportedLockState()).toBeNull();
    expect(isVaultLocked()).toBe(false);
    expect(() => assertVaultUnlocked('get-folders')).not.toThrow();
  });

  it('n hérite pas non plus du déverrouillage du profil sortant', () => {
    reportRendererLockState(false);
    noteProfileSwitch();
    expect(getReportedLockState()).toBeNull();
  });
});

describe('lecture du tray (isVaultLockedForDisplay)', () => {
  it('sans rapport, retombe sur la sonde de clé de session', () => {
    expect(isVaultLockedForDisplay(true)).toBe(false);
    expect(isVaultLockedForDisplay(false)).toBe(true);
  });

  it('un rapport explicite prime sur la sonde', () => {
    // Un profil LOCAL (clé machine) déverrouillé n'a jamais de clé de session :
    // sans cette priorité, le tray l'afficherait verrouillé en permanence.
    reportRendererLockState(false);
    expect(isVaultLockedForDisplay(false)).toBe(false);

    reportRendererLockState(true);
    expect(isVaultLockedForDisplay(true)).toBe(true);
  });

  it('est plus prudente que la porte au démarrage — et c est voulu', () => {
    // Même état (`null`), deux lectures : le tray montre un cadenas, la porte
    // laisse passer. Afficher un cadenas de trop ne coûte rien ; refuser une
    // lecture de trop casse le démarrage.
    expect(isVaultLockedForDisplay(false)).toBe(true);
    expect(isVaultLocked()).toBe(false);
  });
});

describe("attente de l'accusé de purge (awaitRendererLockReport)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('se résout quand le renderer rapporte « verrouillé »', async () => {
    const ack = awaitRendererLockReport(5_000);
    reportRendererLockState(true);
    await expect(ack).resolves.toBe('reported');
  });

  it("expire quand personne ne répond — et n'attend pas indéfiniment", async () => {
    // Fenêtre fermée, renderer planté, ou seule la fenêtre mini ouverte (elle
    // ne rapporte pas). L'appelant doit effacer la clé quand même : un
    // verrouillage qui n'efface pas serait pire que la frappe qu'on sauve.
    vi.useFakeTimers();
    const ack = awaitRendererLockReport(2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(ack).resolves.toBe('timeout');
  });

  it("ne compte PAS un rapport antérieur à l'armement", async () => {
    // Piège : le rapport d'un verrouillage précédent ne doit pas faire croire
    // que la purge de CELUI-CI est terminée. Par construction — le rapport
    // d'avant a déjà vidé la liste d'attente.
    vi.useFakeTimers();
    reportRendererLockState(true); // verrouillage précédent, personne n'attend

    const ack = awaitRendererLockReport(2_000);
    await vi.advanceTimersByTimeAsync(1_999);
    let resolu: string | null = null;
    void ack.then((r) => {
      resolu = r;
    });
    await Promise.resolve();
    expect(resolu).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    await expect(ack).resolves.toBe('timeout');
  });

  it('ignore un rapport « déverrouillé » — seul le verrouillage prouve la purge', async () => {
    vi.useFakeTimers();
    const ack = awaitRendererLockReport(2_000);
    reportRendererLockState(false);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(ack).resolves.toBe('timeout');
  });

  it('libère TOUS ceux qui attendent, sur un seul rapport', async () => {
    const a = awaitRendererLockReport(5_000);
    const b = awaitRendererLockReport(5_000);
    reportRendererLockState(true);
    await expect(Promise.all([a, b])).resolves.toEqual(['reported', 'reported']);
  });
});

describe('cause du dernier basculement', () => {
  it('est renseignée pour le diagnostic, et remise à zéro avec l état', () => {
    expect(getLastLockCause()).toBeNull();
    noteVaultLockedByMain();
    expect(getLastLockCause()).toBe('main-lock');
    reportRendererLockState(false);
    expect(getLastLockCause()).toBe('renderer-report');
    noteProfileSwitch();
    expect(getLastLockCause()).toBe('profile-switch');
  });
});
