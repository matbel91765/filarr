/**
 * Le recensement des rappels côté processus principal.
 */
import { describe, it, expect } from 'vitest';
import {
  dedupeRemindersById,
  reminderClockMs,
  stampReminderCreation,
  touchReminder,
  type StoredReminder,
} from '../reminderMetaCore';

const r = (over: Partial<StoredReminder> & { id: string }): StoredReminder => ({
  date: '2026-09-10T09:30:00.000Z',
  ...over,
});

describe('dedupeRemindersById', () => {
  /**
   * LA RÉGRESSION. `getAllReminders` voit un sous-dossier DEUX fois : comme
   * dossier (avec ses propres `reminders[]`) et comme item du parent, dont le
   * `metadata.json` porte une copie du même tableau.
   */
  it('ne compte qu une fois le rappel d un sous-dossier', () => {
    const recense = [
      r({ id: '42', itemId: 'sous-dossier', itemName: 'Factures', itemType: 'folder' }),
      r({ id: '7', itemId: 'racine', itemName: 'Racine', itemType: 'folder' }),
      // Le même, revu comme item du parent.
      r({ id: '42', itemId: 'sous-dossier', itemName: 'Factures', itemType: 'folder' }),
    ];
    expect(dedupeRemindersById(recense).map((x) => x.id)).toEqual(['42', '7']);
  });

  it('garde la PREMIÈRE occurrence, celle qui porte le bon itemType', () => {
    const out = dedupeRemindersById([
      r({ id: '1', itemType: 'folder', itemName: 'juste' }),
      r({ id: '1', itemType: 'file', itemName: 'faux' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].itemType).toBe('folder');
    expect(out[0].itemName).toBe('juste');
  });

  it('écarte un enregistrement sans identifiant', () => {
    const out = dedupeRemindersById([
      { date: 'x' } as unknown as StoredReminder,
      r({ id: '' }),
      r({ id: 'ok' }),
    ]);
    expect(out.map((x) => x.id)).toEqual(['ok']);
  });

  it('laisse une liste sans doublon strictement intacte', () => {
    const liste = [r({ id: 'a' }), r({ id: 'b' }), r({ id: 'c' })];
    expect(dedupeRemindersById(liste)).toEqual(liste);
  });
});

describe('reminderClockMs', () => {
  it('lit updatedAt en premier', () => {
    expect(
      reminderClockMs({
        updatedAt: '2026-09-02T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
      })
    ).toBe(new Date('2026-09-02T00:00:00.000Z').getTime());
  });

  it('retombe sur createdAt', () => {
    expect(reminderClockMs({ createdAt: '2026-01-01T00:00:00.000Z' })).toBe(
      new Date('2026-01-01T00:00:00.000Z').getTime()
    );
  });

  it('rend 0 quand rien n est lisible — donc PERD tout arbitrage', () => {
    expect(reminderClockMs({})).toBe(0);
    expect(reminderClockMs({ updatedAt: 'pas une date' })).toBe(0);
  });
});

describe('stampReminderCreation', () => {
  it('pose les deux horodatages sur un rappel neuf', () => {
    const x = stampReminderCreation({} as StoredReminder, '2026-09-03T10:00:00.000Z');
    expect(x.createdAt).toBe('2026-09-03T10:00:00.000Z');
    expect(x.updatedAt).toBe('2026-09-03T10:00:00.000Z');
  });

  it('respecte une date de naissance déjà posée', () => {
    const x = stampReminderCreation(
      { createdAt: '2020-01-01T00:00:00.000Z' } as StoredReminder,
      '2026-09-03T10:00:00.000Z'
    );
    expect(x.createdAt).toBe('2020-01-01T00:00:00.000Z');
    expect(x.updatedAt).toBe('2026-09-03T10:00:00.000Z');
  });

  it('modifie EN PLACE — l appelant rend l objet qu il a reçu', () => {
    const source = {} as StoredReminder;
    expect(stampReminderCreation(source, '2026-09-03T10:00:00.000Z')).toBe(source);
  });
});

describe('touchReminder', () => {
  it('rafraîchit updatedAt', () => {
    const out = touchReminder(
      r({ id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' }),
      { message: 'neuf' },
      '2026-09-03T10:00:00.000Z'
    );
    expect(out.message).toBe('neuf');
    expect(out.updatedAt).toBe('2026-09-03T10:00:00.000Z');
  });

  it('laisse gagner un updatedAt explicite — le cas d une descente', () => {
    const out = touchReminder(
      r({ id: 'a' }),
      { updatedAt: '2026-05-05T00:00:00.000Z' },
      '2026-09-03T10:00:00.000Z'
    );
    expect(out.updatedAt).toBe('2026-05-05T00:00:00.000Z');
  });
});
