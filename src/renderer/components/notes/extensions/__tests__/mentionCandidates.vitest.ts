import { describe, it, expect } from 'vitest';
import { filterMentionCandidates } from '../mentionSuggestionExtension';

const gens = [
  { userId: 'u-1', label: 'nour@exemple.fr', secondary: 'editor' },
  { userId: 'u-2', label: 'Élodie Martin', secondary: 'viewer' },
  { userId: 'me', label: 'moi@exemple.fr', secondary: 'owner' },
];

describe('filterMentionCandidates', () => {
  it('propose tout le monde sauf soi-même sur une requête vide', () => {
    expect(filterMentionCandidates(gens, '', 'me').map((c) => c.userId)).toEqual(['u-1', 'u-2']);
  });
  it('filtre sans casse ni accents, sur le libellé et la ligne secondaire', () => {
    expect(filterMentionCandidates(gens, 'elo', 'me').map((c) => c.userId)).toEqual(['u-2']);
    expect(filterMentionCandidates(gens, 'NOUR', 'me').map((c) => c.userId)).toEqual(['u-1']);
    expect(filterMentionCandidates(gens, 'viewer', 'me').map((c) => c.userId)).toEqual(['u-2']);
  });
  it('ne propose personne quand rien ne ressemble à la requête', () => {
    expect(filterMentionCandidates(gens, 'zzz', 'me')).toEqual([]);
  });
  it('plafonne la liste', () => {
    const beaucoup = Array.from({ length: 20 }, (_, i) => ({ userId: `u-${i}`, label: `p${i}` }));
    expect(filterMentionCandidates(beaucoup, '', null)).toHaveLength(8);
  });
});
