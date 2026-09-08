/**
 * recentEdits — la partie pure, et l'intégration state-vectors sur de VRAIS
 * Y.Doc (yjs tourne en node).
 *
 * La propriété qui compte : l'AUTEUR d'une modification distante se lit dans
 * les state-vectors (le client dont l'horloge a avancé a inséré), jamais dans
 * une heuristique de curseur — et le client LOCAL est exclu même s'il avance.
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { computeRemoteAuthors, pruneExpired, RECENT_EDIT_TTL_MS } from '../recentEdits';

describe('computeRemoteAuthors', () => {
  const m = (entries: Array<[number, number]>) => new Map(entries);

  it('rend le client distant dont l’horloge a avancé', () => {
    expect(computeRemoteAuthors(m([[7, 3]]), m([[7, 5]]), 1)).toEqual([7]);
  });

  it('exclut le client LOCAL même s’il avance', () => {
    expect(computeRemoteAuthors(m([[1, 3]]), m([[1, 9]]), 1)).toEqual([]);
  });

  it('un client absent de beforeState compte (première frappe)', () => {
    expect(computeRemoteAuthors(m([]), m([[7, 1]]), 1)).toEqual([7]);
  });

  it('horloge inchangée → personne', () => {
    expect(computeRemoteAuthors(m([[7, 4]]), m([[7, 4]]), 1)).toEqual([]);
  });
});

describe('pruneExpired', () => {
  it('retire les échues, conserve les autres — tableau STABLE si rien n’expire', () => {
    const entries = [
      { expiresAt: 1000, id: 'morte' },
      { expiresAt: 5000, id: 'vive' },
    ];
    expect(pruneExpired(entries, 2000).map((e) => e.id)).toEqual(['vive']);
    const stable = [{ expiresAt: 5000 }];
    expect(pruneExpired(stable, 1000)).toBe(stable);
  });

  it('le TTL par défaut est bien de trois minutes', () => {
    expect(RECENT_EDIT_TTL_MS).toBe(180_000);
  });
});

describe('intégration state-vectors (vrais Y.Doc)', () => {
  it('beforeObserverCalls expose des vecteurs dont computeRemoteAuthors extrait le bon clientID', () => {
    const local = new Y.Doc();
    const remote = new Y.Doc();
    // Le pair distant écrit chez lui…
    remote.getText('t').insert(0, 'bonjour');
    const update = Y.encodeStateAsUpdate(remote);

    let authors: number[] = [];
    local.on('beforeObserverCalls', (tr: Y.Transaction) => {
      authors = computeRemoteAuthors(
        tr.beforeState as ReadonlyMap<number, number>,
        tr.afterState as ReadonlyMap<number, number>,
        local.clientID
      );
    });
    // …et son update arrive chez nous : l'auteur est SON clientID, pas le nôtre.
    Y.applyUpdate(local, update);
    expect(authors).toEqual([remote.clientID]);

    // Notre propre frappe n'a pas d'auteur distant.
    authors = [];
    local.getText('t').insert(0, 'x');
    expect(authors).toEqual([]);
  });
});
