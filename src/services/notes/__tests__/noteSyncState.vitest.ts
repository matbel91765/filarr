/**
 * CONTRATS DE L'INDICATEUR DE SYNCHRONISATION D'UNE NOTE.
 *
 * Ce fichier existe à cause d'une capture d'écran : « Not synced » affiché sur
 * une note parfaitement synchronisée. L'indicateur DÉDUISAIT son état d'une
 * comparaison d'horloges et le présentait comme un fait.
 *
 * Les deux premiers blocs décrivent exactement les deux mensonges qu'il
 * produisait. Ils échouent sur l'ancienne implémentation, et c'est leur raison
 * d'être.
 */

import { describe, expect, it } from 'vitest';

import { getNoteSyncState, isNoteDirty } from '../noteSyncState';

const T_ANCIEN = '2026-09-01T00:00:00.000Z';
const T_CYCLE = '2026-09-02T00:00:00.000Z';
const T_FUTUR = '2026-09-03T00:00:00.000Z';

const note = (updatedAt: string) => ({ updatedAt });

// ── Mensonge n°1 : le changement de profil ──────────────────────────────────

describe('un profil qu’on vient d’ouvrir n’a pas toutes ses notes en attente', () => {
  /**
   * `lastSyncAt` repart à `null` à chaque changement de profil. L'ancienne règle
   * — « pas d'horodatage = sale » — faisait donc afficher « non synchronisée »
   * sur TOUTES les notes du coffre jusqu'au premier cycle.
   */
  it('sans horodatage de cycle, aucune note n’est déclarée en retard', () => {
    expect(isNoteDirty(note(T_FUTUR), null)).toBe(false);
    expect(getNoteSyncState(note(T_FUTUR), { state: 'idle', lastSyncAt: null })).toBe('synced');
  });
});

// ── Mensonge n°2 : la note reçue d’un autre appareil ────────────────────────

describe('une note reçue d’un autre appareil n’est pas « en retard »', () => {
  /**
   * Elle porte l'horloge de CET appareil-là. Deux machines n'ont jamais
   * exactement la même heure : quelques secondes d'avance suffisaient à la faire
   * afficher « non synchronisée » INDÉFINIMENT — alors qu'elle vient d'arriver
   * du nuage. C'est le cas signalé, capture à l'appui.
   */
  it('l’accusé du moteur prime sur une horloge en avance', () => {
    const state = getNoteSyncState(note(T_FUTUR), {
      state: 'idle',
      lastSyncAt: T_CYCLE,
      notesEntryStatus: 'synced',
    });
    expect(state).toBe('synced');
  });

  it('même en plein cycle, un accusé « synced » reste vrai', () => {
    expect(
      getNoteSyncState(note(T_FUTUR), {
        state: 'syncing',
        lastSyncAt: T_CYCLE,
        notesEntryStatus: 'synced',
      })
    ).toBe('synced');
  });

  it('même hors ligne : ce qui est déjà là-haut y reste', () => {
    expect(
      getNoteSyncState(note(T_FUTUR), {
        state: 'offline',
        lastSyncAt: T_CYCLE,
        notesEntryStatus: 'synced',
      })
    ).toBe('synced');
  });
});

// ── Ce que l’indicateur doit encore dire ────────────────────────────────────

describe('quand il reste vraiment quelque chose à envoyer', () => {
  const enAttente = { lastSyncAt: T_CYCLE, notesEntryStatus: 'pending_upload' as const };

  it('la note modifiée depuis le dernier cycle est « en attente »', () => {
    expect(getNoteSyncState(note(T_FUTUR), { state: 'idle', ...enAttente })).toBe('pending');
  });

  it('… et « envoi » pendant que le transfert est en vol', () => {
    expect(getNoteSyncState(note(T_FUTUR), { state: 'syncing', ...enAttente })).toBe('syncing');
  });

  it('… et « hors ligne » quand c’est le réseau qui manque', () => {
    // Un état à réparer différemment : la note n'attend pas son tour, elle
    // attend une connexion.
    expect(getNoteSyncState(note(T_FUTUR), { state: 'offline', ...enAttente })).toBe('offline');
  });

  /**
   * L'horloge ne sert QU'À désigner laquelle des notes est concernée, une fois
   * que le moteur a dit qu'il restait quelque chose. Les autres sont à jour.
   */
  it('les notes NON modifiées depuis le cycle restent à jour', () => {
    expect(getNoteSyncState(note(T_ANCIEN), { state: 'idle', ...enAttente })).toBe('synced');
  });
});

describe('sans accusé du moteur', () => {
  /**
   * Processus principal antérieur, ou tout premier instant : on retombe sur
   * l'horloge faute de mieux — mais sans le mensonge n°1, qui venait de
   * `lastSyncAt === null`.
   */
  it('l’horloge sert de repli, et seulement de repli', () => {
    expect(getNoteSyncState(note(T_FUTUR), { state: 'idle', lastSyncAt: T_CYCLE })).toBe('pending');
    expect(getNoteSyncState(note(T_ANCIEN), { state: 'idle', lastSyncAt: T_CYCLE })).toBe('synced');
    expect(getNoteSyncState(note(T_FUTUR), { state: 'error', lastSyncAt: T_CYCLE })).toBe(
      'pending'
    );
    // Hors ligne ET modifiée depuis le cycle : « hors ligne » reste plus vrai et
    // plus utile que « à jour » — c'est le réseau qu'il faut réparer.
    expect(getNoteSyncState(note(T_FUTUR), { state: 'offline', lastSyncAt: T_CYCLE })).toBe(
      'offline'
    );
    // Mais sans horodatage de cycle, on ne désigne toujours personne.
    expect(getNoteSyncState(note(T_FUTUR), { state: 'offline', lastSyncAt: null })).toBe('synced');
  });
});

// ── Un état en conflit ou en attente de descente n’est pas « en retard » ────

describe('les autres statuts du moteur', () => {
  it('tout ce qui n’est pas « à remonter » vaut à jour', () => {
    for (const s of ['pending_download', 'conflict', 'cloud-only', 'local_only'] as const) {
      expect(
        getNoteSyncState(note(T_FUTUR), {
          state: 'idle',
          lastSyncAt: T_CYCLE,
          notesEntryStatus: s,
        })
      ).toBe('synced');
    }
  });
});
