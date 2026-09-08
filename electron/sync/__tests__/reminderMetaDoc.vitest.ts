/**
 * LE FORMAT DE TRANSPORT DES RAPPELS DE NOTE ET DES RAPPELS LIBRES.
 *
 * Ces tests sont le CONTRAT partagé avec le mobile : ils décrivent le document
 * (un tableau nu), l'arbitrage (`updatedAt`, égalité au local) et la pierre
 * tombale (`deletedAt`). Les changer change le protocole.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeReminderDoc,
  mergeReminderDocs,
  liveReminders,
  isTombstone,
  toTombstone,
  pruneExpiredTombstones,
  reminderMetaFilename,
  TOMBSTONE_TTL_MS,
  NOTE_REMINDERS_META_FILE_ID,
  CALENDAR_REMINDERS_META_FILE_ID,
  REMINDER_META_FILE_IDS,
} from '../reminderMetaDoc';
import type { StoredReminder } from '../reminderMetaCore';

const T = (iso: string) => new Date(iso).getTime();
const NOW = T('2026-09-03T12:00:00.000Z');

const r = (id: string, over: Partial<StoredReminder> = {}): StoredReminder => ({
  id,
  itemId: `note-${id}`,
  itemType: 'note',
  date: '2026-09-10T09:00:00.000Z',
  message: `Rappel ${id}`,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

describe('clés de protocole', () => {
  it('les deux clés réservées, et leur fichier', () => {
    expect(NOTE_REMINDERS_META_FILE_ID).toBe('meta:note-reminders');
    expect(CALENDAR_REMINDERS_META_FILE_ID).toBe('meta:calendar-reminders');
    expect(reminderMetaFilename(NOTE_REMINDERS_META_FILE_ID)).toBe('noteReminders.json');
    expect(reminderMetaFilename(CALENDAR_REMINDERS_META_FILE_ID)).toBe('calendarReminders.json');
  });

  it('ne reconnaît rien d autre — un meta:{folderId} n est pas des rappels', () => {
    expect(reminderMetaFilename('meta:notes')).toBeNull();
    expect(reminderMetaFilename('meta:layout')).toBeNull();
    expect(reminderMetaFilename('meta:3f2a1c00-0000-4000-8000-000000000000')).toBeNull();
    expect(REMINDER_META_FILE_IDS.has('meta:notes')).toBe(false);
  });
});

describe('normalizeReminderDoc', () => {
  it('le document EST un tableau nu — compatible avec les fichiers déjà sur disque', () => {
    const doc = [r('a'), r('b')];
    expect(normalizeReminderDoc(doc)).toEqual(doc);
  });

  it.each([
    ['null', null],
    ['un objet', { reminders: [] }],
    ['une enveloppe versionnée', { version: 1, reminders: [] }],
    ['une chaîne', 'rien'],
  ])('rend un tableau vide pour %s', (_quoi, input) => {
    expect(normalizeReminderDoc(input)).toEqual([]);
  });

  it('écarte ce qui ne peut être ni arbitré ni supprimé', () => {
    expect(
      normalizeReminderDoc([null, 'x', {}, { id: '' }, ['a'], r('ok')]).map((x) => x.id)
    ).toEqual(['ok']);
  });

  it('dédoublonne, premier vu gagnant', () => {
    const out = normalizeReminderDoc([r('a', { message: 'juste' }), r('a', { message: 'faux' })]);
    expect(out).toHaveLength(1);
    expect(out[0].message).toBe('juste');
  });
});

describe('pierres tombales', () => {
  it('une suppression est un ENREGISTREMENT, pas un trou', () => {
    const pierre = toTombstone(r('a'), '2026-09-03T12:00:00.000Z');
    expect(isTombstone(pierre)).toBe(true);
    expect(pierre.deletedAt).toBe('2026-09-03T12:00:00.000Z');
    expect(pierre.updatedAt).toBe('2026-09-03T12:00:00.000Z');
    expect(pierre.id).toBe('a');
  });

  /**
   * Un intitulé de rappel dit quelque chose de la vie de l'utilisateur. Le
   * garder trente jours pour la seule commodité d'un arbitrage serait un
   * mauvais échange.
   */
  it('la pierre tombale ne garde PAS le contenu', () => {
    const pierre = toTombstone(r('a', { message: 'Rendez-vous médical' }), '2026-09-03T12:00:00.000Z');
    expect(pierre.message).toBeUndefined();
    expect(pierre.date).toBeUndefined();
    // Mais garde de quoi comprendre QUOI supprimer.
    expect(pierre.itemId).toBe('note-a');
    expect(pierre.itemType).toBe('note');
    expect(pierre.createdAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('liveReminders les écarte — sinon elles s afficheraient comme des rappels', () => {
    const doc = [r('a'), toTombstone(r('b'), '2026-09-02T00:00:00.000Z'), r('c')];
    expect(liveReminders(doc).map((x) => x.id)).toEqual(['a', 'c']);
  });

  it('purge celles que tout le monde a eu le temps de voir', () => {
    const vieille = toTombstone(r('vieux'), new Date(NOW - TOMBSTONE_TTL_MS - 1000).toISOString());
    const fraiche = toTombstone(r('frais'), new Date(NOW - 1000).toISOString());
    expect(pruneExpiredTombstones([r('vif'), vieille, fraiche], NOW).map((x) => x.id)).toEqual([
      'vif',
      'frais',
    ]);
  });

  it('purge aussi celle dont on ne saura jamais dire l âge', () => {
    const illisible: StoredReminder = { id: 'x', deletedAt: 'pas une date' };
    expect(pruneExpiredTombstones([illisible], NOW)).toEqual([]);
  });
});

describe('mergeReminderDocs', () => {
  it('UNION : un rappel présent d un seul côté est gardé', () => {
    const out = mergeReminderDocs([r('a')], [r('b')], NOW);
    expect(out.merged.map((x) => x.id)).toEqual(['a', 'b']);
    expect(out.changedFromLocal).toBe(true);
    expect(out.changedFromRemote).toBe(true);
  });

  it('le plus RÉCENT gagne', () => {
    const local = r('a', { message: 'ancien', updatedAt: '2026-09-01T00:00:00.000Z' });
    const remote = r('a', { message: 'neuf', updatedAt: '2026-09-02T00:00:00.000Z' });
    expect(mergeReminderDocs([local], [remote], NOW).merged[0].message).toBe('neuf');
  });

  /** Convention alignée sur `mergeFolderMeta` et sur le mobile. */
  it('à horodatage ÉGAL, le local tient', () => {
    const local = r('a', { message: 'local', updatedAt: '2026-09-02T00:00:00.000Z' });
    const remote = r('a', { message: 'distant', updatedAt: '2026-09-02T00:00:00.000Z' });
    const out = mergeReminderDocs([local], [remote], NOW);
    expect(out.merged[0].message).toBe('local');
    expect(out.changedFromLocal).toBe(false);
    expect(out.changedFromRemote).toBe(true);
  });

  it('un rappel sans horloge perd contre un rappel horodaté', () => {
    const local: StoredReminder = { id: 'a', message: 'muet' };
    const remote = r('a', { message: 'horodaté', updatedAt: '2020-01-01T00:00:00.000Z' });
    expect(mergeReminderDocs([local], [remote], NOW).merged[0].message).toBe('horodaté');
  });

  /**
   * LA RAISON D'ÊTRE DE LA PIERRE TOMBALE. Retirer le rappel du tableau ne
   * suffirait pas : l'autre appareil le porte encore, et l'union le
   * ressusciterait au cycle suivant.
   */
  it('une pierre tombale plus récente EMPORTE le rappel encore vivant d en face', () => {
    const pierre = toTombstone(r('a'), '2026-09-02T00:00:00.000Z');
    const vivant = r('a', { updatedAt: '2026-09-01T00:00:00.000Z' });
    const out = mergeReminderDocs([pierre], [vivant], NOW);
    expect(out.merged).toHaveLength(1);
    expect(isTombstone(out.merged[0])).toBe(true);
    expect(liveReminders(out.merged)).toEqual([]);
  });

  it('mais une RÉOUVERTURE plus récente l emporte sur la pierre tombale', () => {
    const pierre = toTombstone(r('a'), '2026-09-01T00:00:00.000Z');
    const rouvert = r('a', { message: 'de retour', updatedAt: '2026-09-02T00:00:00.000Z' });
    const out = mergeReminderDocs([pierre], [rouvert], NOW);
    expect(isTombstone(out.merged[0])).toBe(false);
    expect(out.merged[0].message).toBe('de retour');
  });

  it('rien à faire quand les deux côtés disent la même chose', () => {
    const doc = [r('a'), r('b')];
    const out = mergeReminderDocs(doc, doc, NOW);
    expect(out.changedFromLocal).toBe(false);
    expect(out.changedFromRemote).toBe(false);
  });

  /**
   * Deux appareils qui fusionnent le même couple doivent produire les MÊMES
   * octets — sinon le condensat diffère et chacun republie éternellement.
   */
  it('ordre STABLE, quelle que soit celle des deux listes qu on lit d abord', () => {
    const un = mergeReminderDocs([r('c'), r('a')], [r('b')], NOW);
    const deux = mergeReminderDocs([r('b')], [r('a'), r('c')], NOW);
    expect(un.merged.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(deux.merged.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('un ordre de clés différent ne compte pas pour un changement', () => {
    const local = [{ id: 'a', message: 'x', updatedAt: '2026-09-01T00:00:00.000Z' }];
    const remote = [{ updatedAt: '2026-09-01T00:00:00.000Z', message: 'x', id: 'a' }];
    const out = mergeReminderDocs(local, remote, NOW);
    expect(out.changedFromLocal).toBe(false);
    expect(out.changedFromRemote).toBe(false);
  });

  it('un fichier distant illisible ne fait pas disparaître le local', () => {
    const out = mergeReminderDocs([r('a')], 'du bruit', NOW);
    expect(out.merged.map((x) => x.id)).toEqual(['a']);
    expect(out.changedFromLocal).toBe(false);
    expect(out.changedFromRemote).toBe(true);
  });

  it('purge les pierres tombales périmées au passage', () => {
    const vieille = toTombstone(r('vieux'), new Date(NOW - TOMBSTONE_TTL_MS - 1).toISOString());
    const out = mergeReminderDocs([r('vif'), vieille], [], NOW);
    expect(out.merged.map((x) => x.id)).toEqual(['vif']);
  });
});
