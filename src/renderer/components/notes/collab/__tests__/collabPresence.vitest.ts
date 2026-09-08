/**
 * Barre de présence — dérivation depuis un état d'awareness simulé.
 * Aucun réseau, aucun Yjs : seulement la Map que publie l'awareness.
 */

import { describe, it, expect } from 'vitest';
import {
  COLLAB_PALETTE,
  collabInitial,
  composeDisplayName,
  derivePresence,
  pickCollabColor,
  samePresence,
} from '../collabPresence';
import type { AwarenessUserState } from '../collabTypes';

const states = (
  entries: Array<[number, AwarenessUserState | undefined]>
): ReadonlyMap<number, AwarenessUserState | undefined> => new Map(entries);

describe('derivePresence', () => {
  it('met l’appareil courant en tête, puis trie par clientId', () => {
    const result = derivePresence(
      states([
        [42, { user: { name: 'Bureau', color: '#2563eb' } }],
        [7, { user: { name: 'Web', color: '#059669' } }],
        [19, { user: { name: 'Portable', color: '#db2777' } }],
      ]),
      19,
      'Filarr'
    );

    expect(result.map((p) => p.clientId)).toEqual([19, 7, 42]);
    expect(result[0].isLocal).toBe(true);
    expect(result.slice(1).every((p) => !p.isLocal)).toBe(true);
  });

  it('compte un pair qui n’a pas encore publié son identité', () => {
    const result = derivePresence(
      states([
        [1, { user: { name: 'Web', color: '#059669' } }],
        [2, undefined],
        [3, { user: null }],
      ]),
      1,
      'Appareil'
    );

    expect(result).toHaveLength(3);
    const late = result.filter((p) => p.clientId !== 1);
    expect(late.map((p) => p.name)).toEqual(['Appareil', 'Appareil']);
    // Couleur de repli déterministe, prise dans la palette.
    expect(late.every((p) => (COLLAB_PALETTE as readonly string[]).includes(p.color))).toBe(true);
  });

  it('ignore les champs vides ou mal typés au profit du repli', () => {
    const result = derivePresence(
      states([[5, { user: { name: '   ', color: 42 } } as AwarenessUserState]]),
      5,
      'Repli'
    );

    expect(result[0].name).toBe('Repli');
    expect(result[0].color).toBe(pickCollabColor('5'));
  });

  it('rend une liste vide quand personne n’est connecté', () => {
    expect(derivePresence(states([]), 1, 'Filarr')).toEqual([]);
  });

  it('expose l’initiale affichée dans la pastille', () => {
    const result = derivePresence(
      states([[1, { user: { name: 'étienne', color: '#2563eb' } }]]),
      1,
      'Filarr'
    );
    expect(result[0].initial).toBe('É');
  });
});

describe('samePresence', () => {
  const base = () =>
    derivePresence(
      states([
        [1, { user: { name: 'Bureau', color: '#2563eb' } }],
        [2, { user: { name: 'Web', color: '#059669' } }],
      ]),
      1,
      'Filarr'
    );

  it('ignore un simple mouvement de curseur — la barre est identique', () => {
    // Le champ `cursor` bouge à chaque frappe distante, `user` ne bouge pas.
    const moved = derivePresence(
      states([
        [1, { user: { name: 'Bureau', color: '#2563eb' } } as AwarenessUserState],
        [
          2,
          { user: { name: 'Web', color: '#059669' }, cursor: { anchor: 42 } } as AwarenessUserState,
        ],
      ]),
      1,
      'Filarr'
    );
    expect(samePresence(base(), moved)).toBe(true);
  });

  it('détecte une arrivée, un départ et un changement de nom', () => {
    const arrival = derivePresence(
      states([
        [1, { user: { name: 'Bureau', color: '#2563eb' } }],
        [2, { user: { name: 'Web', color: '#059669' } }],
        [3, { user: { name: 'Tablette', color: '#db2777' } }],
      ]),
      1,
      'Filarr'
    );
    const departure = derivePresence(
      states([[1, { user: { name: 'Bureau', color: '#2563eb' } }]]),
      1,
      'Filarr'
    );
    const renamed = derivePresence(
      states([
        [1, { user: { name: 'Bureau', color: '#2563eb' } }],
        [2, { user: { name: 'Navigateur', color: '#059669' } }],
      ]),
      1,
      'Filarr'
    );

    expect(samePresence(base(), arrival)).toBe(false);
    expect(samePresence(base(), departure)).toBe(false);
    expect(samePresence(base(), renamed)).toBe(false);
  });
});

describe('collabInitial', () => {
  it('prend la première lettre en majuscule', () => {
    expect(collabInitial('bureau')).toBe('B');
  });

  it('garde un emoji entier', () => {
    expect(collabInitial('🐧 Linux')).toBe('🐧');
  });

  it('retombe sur « ? » quand le nom est vide', () => {
    expect(collabInitial('   ')).toBe('?');
  });
});

describe('pickCollabColor', () => {
  it('est stable pour une même graine', () => {
    expect(pickCollabColor('abc')).toBe(pickCollabColor('abc'));
  });

  it('reste dans la palette', () => {
    for (const seed of ['a', 'bb', 'ccc', 'dddd', 'eeeee', '123456']) {
      expect(COLLAB_PALETTE as readonly string[]).toContain(pickCollabColor(seed));
    }
  });
});

describe('composeDisplayName', () => {
  it('suffixe la plateforme pour distinguer deux appareils du même compte', () => {
    expect(composeDisplayName('Mathis', 'Bureau')).toBe('Mathis · Bureau');
  });

  it('se contente de la plateforme quand le profil n’a pas de nom', () => {
    expect(composeDisplayName('  ', 'Web')).toBe('Web');
  });
});
