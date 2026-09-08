/**
 * vaultComments — le modèle pur, prouvé sans mock.
 *
 * Les deux propriétés qui coûteraient des données : le TOMBSTONE gagne
 * toujours (un supprimé ne ressuscite jamais, quelle que soit la direction de
 * la fusion), et la fusion est une UNION (aucune réponse concurrente perdue).
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeComment,
  sanitizeCommentMap,
  mergeComments,
  commentsEqual,
  withoutTombstones,
  visibleComments,
  type VaultComment,
} from '../vaultComments';

function c(o: Partial<VaultComment> & { id: string }): VaultComment {
  return {
    parentId: null,
    text: 'texte',
    authorName: 'alice@x.com',
    authorId: 'u-alice',
    createdAt: '2026-08-01T00:00:00.000Z',
    resolved: false,
    ...o,
  };
}

describe('sanitizeComment', () => {
  it('accepte un commentaire complet et normalise parentId vide → null', () => {
    expect(sanitizeComment(c({ id: 'a' }))).toMatchObject({ id: 'a', parentId: null });
    expect(sanitizeComment({ ...c({ id: 'a' }), parentId: '' })).toMatchObject({ parentId: null });
  });

  it.each([
    [null],
    ['pas un objet'],
    [{ ...c({ id: 'a' }), id: 42 }],
    [{ ...c({ id: 'a' }), text: 7 }],
    [{ ...c({ id: 'a' }), parentId: 42 }],
    [{ ...c({ id: 'a' }), createdAt: null }],
    [{ ...c({ id: 'a' }), text: 'x'.repeat(20_001) }],
  ])('rejette %j', (bad) => {
    expect(sanitizeComment(bad)).toBeNull();
  });

  it('sanitizeCommentMap filtre les entrées inexploitables sans rejeter le reste', () => {
    const map = sanitizeCommentMap({
      a: c({ id: 'a' }),
      b: { id: 42 },
      c: c({ id: 'c', deleted: true }),
    });
    expect(Object.keys(map).sort()).toEqual(['a', 'c']);
    expect(map.c.deleted).toBe(true);
  });
});

describe('mergeComments — union, tombstone souverain', () => {
  it('union : aucune clé perdue, dans les deux sens', () => {
    const a = { x: c({ id: 'x' }) };
    const b = { y: c({ id: 'y' }) };
    expect(Object.keys(mergeComments(a, b)).sort()).toEqual(['x', 'y']);
    expect(Object.keys(mergeComments(b, a)).sort()).toEqual(['x', 'y']);
  });

  it('le tombstone gagne quel que soit le côté et quelle que soit la date', () => {
    const vivant = c({ id: 'x', createdAt: '2026-08-02T00:00:00.000Z', text: 'récent' });
    const mort = c({ id: 'x', createdAt: '2026-08-01T00:00:00.000Z', deleted: true });
    expect(mergeComments({ x: vivant }, { x: mort }).x.deleted).toBe(true);
    expect(mergeComments({ x: mort }, { x: vivant }).x.deleted).toBe(true);
  });

  it('resolved est un OR ; à date égale, b gagne le texte', () => {
    const ours = c({ id: 'x', resolved: true, text: 'a' });
    const theirs = c({ id: 'x', text: 'b' });
    const merged = mergeComments({ x: ours }, { x: theirs });
    expect(merged.x.resolved).toBe(true);
    expect(merged.x.text).toBe('b');
  });

  it('idempotence : fusionner deux fois ne change rien', () => {
    const a = { x: c({ id: 'x' }), y: c({ id: 'y', deleted: true }) };
    const b = { x: c({ id: 'x', resolved: true }) };
    const once = mergeComments(a, b);
    expect(commentsEqual(mergeComments(once, b), once)).toBe(true);
  });
});

describe('commentsEqual / withoutTombstones', () => {
  it('égalité stable, insensible à l’ordre des clés', () => {
    const a = { x: c({ id: 'x' }), y: c({ id: 'y' }) };
    const b = { y: c({ id: 'y' }), x: c({ id: 'x' }) };
    expect(commentsEqual(a, b)).toBe(true);
    expect(commentsEqual(a, { ...a, x: c({ id: 'x', resolved: true }) })).toBe(false);
  });

  it('withoutTombstones retire exactement les supprimés', () => {
    const all = { x: c({ id: 'x' }), y: c({ id: 'y', deleted: true }) };
    expect(Object.keys(withoutTombstones(all))).toEqual(['x']);
  });
});

describe('visibleComments', () => {
  it('rattache les réponses, promeut les orphelines, exclut les tombstones, trie', () => {
    const all = {
      racine: c({ id: 'racine', createdAt: '2026-08-01T00:00:00.000Z' }),
      reponse: c({ id: 'reponse', parentId: 'racine', createdAt: '2026-08-02T00:00:00.000Z' }),
      orpheline: c({ id: 'orpheline', parentId: 'disparu', createdAt: '2026-08-03T00:00:00.000Z' }),
      morte: c({ id: 'morte', deleted: true }),
    };
    const view = visibleComments(all);
    expect(view.roots.map((r) => r.id)).toEqual(['racine', 'orpheline']);
    expect(view.repliesByParent.get('racine')?.map((r) => r.id)).toEqual(['reponse']);
  });
});
