import { describe, it, expect } from 'vitest';
import {
  mentionPinsForVault,
  publishMentionInbox,
  readMentionInbox,
  subscribeMentionInbox,
} from './mentionInbox';
import type { MentionDTO } from './mentionsApi';

/**
 * L'ÉPINGLE DE NOTIFICATION (volet A) est DÉRIVÉE, jamais stockée : une
 * mention non lue EST le marqueur. Même règle que le mobile
 * (`mentionPinsForVault`, commit 2e1d0ed) : seules les non-lues comptent, et
 * un élément disparu (`itemKind === null`) n'est pas épinglé.
 */

const m = (over: Partial<MentionDTO>): MentionDTO => ({
  id: over.id ?? 'm',
  vaultId: 'v1',
  itemId: 'i1',
  fromUserId: 'u2',
  fromLabel: 'Nour',
  itemKind: 'note',
  createdAt: '2026-09-06T00:00:00.000Z',
  readAt: null,
  ...over,
});

describe('mentionPinsForVault', () => {
  it('groupe les NON-LUES par élément, pour CE coffre seulement', () => {
    const pins = mentionPinsForVault(
      [
        m({ id: 'a', itemId: 'i1' }),
        m({ id: 'b', itemId: 'i1' }),
        m({ id: 'c', itemId: 'i2' }),
        m({ id: 'd', itemId: 'i9', vaultId: 'autre' }),
      ],
      'v1'
    );
    expect([...pins.entries()]).toEqual([
      ['i1', 2],
      ['i2', 1],
    ]);
  });

  it('marquer lu retire l’épingle', () => {
    const pins = mentionPinsForVault(
      [m({ id: 'a', readAt: '2026-09-06T01:00:00.000Z' }), m({ id: 'b', itemId: 'i2' })],
      'v1'
    );
    expect(pins.has('i1')).toBe(false);
    expect(pins.get('i2')).toBe(1);
  });

  it('un élément disparu n’est pas épinglé — la boîte le dit autrement', () => {
    const pins = mentionPinsForVault([m({ itemKind: null })], 'v1');
    expect(pins.size).toBe(0);
  });
});

describe('le magasin partagé', () => {
  it('publie, se lit, et prévient ses abonnés', () => {
    let appels = 0;
    const off = subscribeMentionInbox(() => {
      appels++;
    });
    const liste = [m({ id: 'x' })];
    publishMentionInbox(liste);
    expect(readMentionInbox()).toBe(liste);
    expect(appels).toBe(1);
    off();
    publishMentionInbox([]);
    expect(appels).toBe(1); // désabonné : plus prévenu
  });
});
