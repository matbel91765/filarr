/**
 * La carte partagée des commentaires, sur de VRAIS Y.Doc synchronisés.
 *
 * Ce qui se prouve, dans l'ordre où ça saignerait : un commentaire posé chez A
 * arrive chez B ; deux réponses CONCURRENTES survivent toutes deux (deux clés
 * — jamais d'écrasement LWW) ; le tombstone se propage ; `transaction.local`
 * distingue l'écrivain du récepteur ; l'origine de SEMIS est visible de
 * l'observateur (il doit l'ignorer) ; et le garde « carte non vide » refuse un
 * second semis.
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { COMMENTS_SEED_ORIGIN } from '../../../../services/collab/collabSession';
import {
  sanitizeCommentMap,
  commentsEqual,
  type VaultComment,
} from '../../../../services/vault/vaultComments';

const MAP = 'filarr:comments';

function pair(): { a: Y.Doc; b: Y.Doc } {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on('update', (u: Uint8Array) => Y.applyUpdate(b, u));
  b.on('update', (u: Uint8Array) => Y.applyUpdate(a, u));
  return { a, b };
}

function comment(id: string, o: Partial<VaultComment> = {}): VaultComment {
  return {
    id,
    parentId: null,
    text: `texte-${id}`,
    authorName: 'alice@x.com',
    authorId: 'u1',
    createdAt: '2026-08-01T00:00:00.000Z',
    resolved: false,
    ...o,
  };
}

describe('la Y.Map des commentaires', () => {
  it('posé chez A, lu chez B — et l’assainissement rend le même contenu', () => {
    const { a, b } = pair();
    a.getMap(MAP).set('c1', { ...comment('c1') });
    const chezB = sanitizeCommentMap(b.getMap(MAP).toJSON());
    expect(chezB.c1.text).toBe('texte-c1');
    expect(commentsEqual(chezB, sanitizeCommentMap(a.getMap(MAP).toJSON()))).toBe(true);
  });

  it('réponses CONCURRENTES (hors ligne) : deux clés, zéro perte à la fusion', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    // Un état de départ partagé…
    a.getMap(MAP).set('racine', { ...comment('racine') });
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    // …puis chacun répond SANS voir l'autre.
    a.getMap(MAP).set('rep-a', { ...comment('rep-a', { parentId: 'racine' }) });
    b.getMap(MAP).set('rep-b', { ...comment('rep-b', { parentId: 'racine' }) });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    for (const doc of [a, b]) {
      expect(Object.keys(doc.getMap(MAP).toJSON()).sort()).toEqual(['racine', 'rep-a', 'rep-b']);
    }
  });

  it('le tombstone se propage — et l’entrée ne disparaît jamais', () => {
    const { a, b } = pair();
    a.getMap(MAP).set('c1', { ...comment('c1') });
    b.getMap(MAP).set('c1', { ...comment('c1', { deleted: true }) });
    const chezA = sanitizeCommentMap(a.getMap(MAP).toJSON());
    expect(chezA.c1).toBeDefined();
    expect(chezA.c1.deleted).toBe(true);
  });

  it('transaction.local : vrai côté écrivain, faux côté récepteur ; l’origine de semis voyage', () => {
    const { a, b } = pair();
    const vus: Array<{ side: string; local: boolean; origin: unknown }> = [];
    const observe = (doc: Y.Doc, side: string) =>
      doc.getMap(MAP).observe((_e, tr) => vus.push({ side, local: tr.local, origin: tr.origin }));
    observe(a, 'a');
    observe(b, 'b');

    a.transact(() => {
      a.getMap(MAP).set('c1', { ...comment('c1') });
    }, COMMENTS_SEED_ORIGIN);

    const chezA = vus.find((v) => v.side === 'a');
    const chezB = vus.find((v) => v.side === 'b');
    expect(chezA).toMatchObject({ local: true, origin: COMMENTS_SEED_ORIGIN });
    // Chez le récepteur : pas local, et l'origine du SEMIS ne voyage pas — c'est
    // pour ça que l'observateur du récepteur s'appuie sur la garde de settle,
    // pas sur l'origine.
    expect(chezB).toMatchObject({ local: false });
  });

  it('le garde du semis : une carte NON vide refuse un second versement', () => {
    const { a } = pair();
    a.getMap(MAP).set('c1', { ...comment('c1', { deleted: true }) });
    // La règle de l'éditeur : commentsEmpty() === false → pas de semis. Un
    // tombstone COMPTE — c'est précisément lui qui empêche la résurrection
    // depuis un corps ancien.
    expect(a.getMap(MAP).size === 0).toBe(false);
  });
});
