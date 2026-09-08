/**
 * La fabrique de rappels — et les deux pertes qu'elle répare.
 */
import { describe, it, expect } from 'vitest';
import {
  buildReminder,
  touchReminder,
  resolveReminderDate,
  type ReminderFormData,
} from '../reminderFactory';

const NOW = '2026-09-03T10:00:00.000Z';

const form = (over: Partial<ReminderFormData> = {}): ReminderFormData => ({
  date: '2026-09-10',
  time: '09:30',
  message: 'Renouveler le bail',
  ...over,
});

const cible = { itemId: 'f1', itemName: 'Bail', itemType: 'file' as const };

describe('buildReminder', () => {
  /**
   * LA RÉGRESSION. `ReminderModal` récolte `recurring` et `priority`,
   * `FolderView` et `Home` construisaient l'objet à la main et n'en reprenaient
   * aucun des deux : un rappel « tous les mois, priorité haute » arrivait
   * ponctuel et sans priorité sur le disque.
   */
  it('garde la récurrence et la priorité choisies', () => {
    const r = buildReminder(form({ recurring: 'monthly', priority: 'high' }), cible, 'r1', NOW);
    expect(r.recurring).toBe('monthly');
    expect(r.priority).toBe('high');
  });

  it('pose createdAt ET updatedAt — sans quoi le mobile fait perdre le rappel', () => {
    const r = buildReminder(form(), cible, 'r1', NOW);
    expect(r.createdAt).toBe(NOW);
    expect(r.updatedAt).toBe(NOW);
  });

  it('écrit recurring: none par défaut, mais laisse priority ABSENT', () => {
    const r = buildReminder(form(), cible, 'r1', NOW);
    expect(r.recurring).toBe('none');
    expect('priority' in r).toBe(false);
  });

  it('reprend la cible telle quelle', () => {
    const r = buildReminder(
      form(),
      { itemId: 'd9', itemName: 'Archives', itemType: 'folder' },
      'r2',
      NOW
    );
    expect(r.itemId).toBe('d9');
    expect(r.itemName).toBe('Archives');
    expect(r.itemType).toBe('folder');
    expect(r.id).toBe('r2');
    expect(r.message).toBe('Renouveler le bail');
  });
});

describe('resolveReminderDate', () => {
  it('préfère datetime quand la boîte de dialogue le compose déjà', () => {
    expect(resolveReminderDate(form({ datetime: '2026-12-01T08:00:00.000Z' }), NOW)).toBe(
      '2026-12-01T08:00:00.000Z'
    );
  });

  it('recompose depuis date + heure', () => {
    const iso = resolveReminderDate(form(), NOW);
    expect(new Date(iso).getTime()).toBe(new Date('2026-09-10T09:30').getTime());
  });

  /**
   * Une date illisible produisait `Invalid Date`, sérialisée en `null` : le
   * rappel ne se déclenchait jamais et disparaissait en silence.
   */
  it('retombe sur maintenant plutôt que de fabriquer une date invalide', () => {
    expect(resolveReminderDate(form({ date: '', time: '' }), NOW)).toBe(NOW);
  });
});

describe('touchReminder', () => {
  it('rafraîchit updatedAt à chaque modification', () => {
    const r = buildReminder(form(), cible, 'r1', NOW);
    const next = touchReminder(r, { message: 'Autre' }, '2026-09-04T12:00:00.000Z');
    expect(next.message).toBe('Autre');
    expect(next.updatedAt).toBe('2026-09-04T12:00:00.000Z');
    expect(next.createdAt).toBe(NOW);
  });
});
