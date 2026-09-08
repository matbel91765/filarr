import { describe, it, expect } from 'vitest';
import { sameMentionSet, scanMentionUserIds } from '../mentionScan';

const doc = (...content: unknown[]) => ({ type: 'doc', content });
const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const mention = (userId: string, label = 'X') => ({ type: 'mention', attrs: { userId, label } });
const texte = (text: string) => ({ type: 'text', text });

describe('scanMentionUserIds', () => {
  it('relève les identifiants dans l’ordre d’apparition, sans doublon', () => {
    const d = doc(
      p(texte('Vu avec '), mention('u-1'), texte(' et '), mention('u-2')),
      p(mention('u-1'))
    );
    expect(scanMentionUserIds(d)).toEqual(['u-1', 'u-2']);
  });

  it('descend dans les structures imbriquées (tableaux, colonnes, dépliants)', () => {
    const d = doc({
      type: 'table',
      content: [
        { type: 'tableRow', content: [{ type: 'tableCell', content: [p(mention('u-9'))] }] },
      ],
    });
    expect(scanMentionUserIds(d)).toEqual(['u-9']);
  });

  it('accepte une chaîne JSON, et rend une liste vide sur du charabia', () => {
    expect(scanMentionUserIds(JSON.stringify(doc(p(mention('u-3')))))).toEqual(['u-3']);
    expect(scanMentionUserIds('{pas du json')).toEqual([]);
  });

  it('ne rend jamais autre chose que des identifiants exploitables', () => {
    const d = doc(
      p({ type: 'mention', attrs: { label: 'sans id' } }, { type: 'mention' }, mention('  '))
    );
    expect(scanMentionUserIds(d)).toEqual([]);
  });

  it('ne bronche pas sur un document nul, vide ou mal formé', () => {
    expect(scanMentionUserIds(null)).toEqual([]);
    expect(scanMentionUserIds(undefined)).toEqual([]);
    expect(scanMentionUserIds(42)).toEqual([]);
    expect(scanMentionUserIds({ type: 'doc' })).toEqual([]);
  });
});

describe('sameMentionSet', () => {
  it('ignore l’ordre : déplacer une puce n’est pas nommer quelqu’un de neuf', () => {
    expect(sameMentionSet(['a', 'b'], ['b', 'a'])).toBe(true);
  });
  it('voit un ajout comme un retrait', () => {
    expect(sameMentionSet(['a'], ['a', 'b'])).toBe(false);
    expect(sameMentionSet(['a', 'b'], ['a'])).toBe(false);
    expect(sameMentionSet([], [])).toBe(true);
  });
});
