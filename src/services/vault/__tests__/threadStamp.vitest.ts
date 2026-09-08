/**
 * LE TAMPON D'UN FIL — LE FORMAT, ET LES TROIS FAÇONS DE NE PAS MENTIR.
 *
 * ── LE DÉFAUT QUE CES VECTEURS FERMENT ──────────────────────────────────────
 *
 * Le bureau recopiait `{ ...existing.meta }` à chaque écriture de fil. Un
 * tampon posé par un téléphone survivait donc intact, écriture après écriture,
 * en annonçant un compte que plus personne ne vérifiait — et rien ne le
 * signalait.
 *
 * ── LE FORMAT EST CELUI DU MOBILE, À L'OCTET ────────────────────────────────
 *
 * `filarr-mobile/src/services/vaults/sharing/threadBadge.ts` : même clé
 * (`threadStats`), mêmes trois champs (`open`, `total`, `at`), même règle de
 * retrait quand le fil est vide, même tolérance d'une minute. Les vecteurs
 * ci-dessous épinglent la FORME SÉRIALISÉE, pas seulement le comportement :
 * c'est elle que l'autre application lit.
 */

import { describe, it, expect } from 'vitest';

import {
  THREAD_STATS_META,
  metaWithThreadStamp,
  readThreadStamp,
  stampStillTrusted,
  threadBadgeFor,
  threadBadgeKey,
  threadBadges,
  threadStampOf,
  writeThreadStamp,
} from '../threadStamp';
import { THREAD_FOR_META } from '../fileThread';
import type { VaultComment } from '../vaultComments';

const T1 = '2026-09-01T10:00:00.000Z';
const T2 = '2026-09-01T10:05:00.000Z';
const T3 = '2026-09-01T10:10:00.000Z';

function comment(over: Partial<VaultComment> & Pick<VaultComment, 'id'>): VaultComment {
  return {
    authorId: 'u1',
    authorName: 'A',
    text: 'x',
    createdAt: T1,
    resolved: false,
    deleted: false,
    parentId: null,
    ...over,
  } as VaultComment;
}

function map(...list: VaultComment[]): Record<string, VaultComment> {
  return Object.fromEntries(list.map((c) => [c.id, c]));
}

// ── Le tampon ───────────────────────────────────────────────────────────────

describe('threadStampOf — le résumé d’un fil', () => {
  it('un fil VIDE ne compte rien et ne date de rien', () => {
    expect(threadStampOf({})).toEqual({ open: 0, total: 0, at: null });
  });

  it('compte les racines OUVERTES, et TOUT ce qui est vivant', () => {
    const stamp = threadStampOf(
      map(
        comment({ id: 'a', createdAt: T1 }),
        comment({ id: 'b', createdAt: T2, resolved: true }),
        comment({ id: 'c', createdAt: T3, parentId: 'a' })
      )
    );
    expect(stamp).toEqual({ open: 1, total: 3, at: T3 });
  });

  it('`open` COMPTE LES RACINES, PAS LES RÉPONSES — le compte du panneau', () => {
    // Compter les réponses ferait dire « 4 ouverts » à la liste là où le
    // panneau annonce « 1 » pour exactement le même fil.
    const stamp = threadStampOf(
      map(
        comment({ id: 'a' }),
        comment({ id: 'r1', parentId: 'a' }),
        comment({ id: 'r2', parentId: 'a' }),
        comment({ id: 'r3', parentId: 'a' })
      )
    );
    expect(stamp.open).toBe(1);
    expect(stamp.total).toBe(4);
  });

  it('les pierres tombales ne comptent pas, et ne datent pas', () => {
    const stamp = threadStampOf(
      map(comment({ id: 'a', createdAt: T1 }), comment({ id: 'b', createdAt: T3, deleted: true }))
    );
    expect(stamp).toEqual({ open: 1, total: 1, at: T1 });
  });

  it('une réponse ORPHELINE est promue racine — comme dans le panneau', () => {
    const stamp = threadStampOf(
      map(comment({ id: 'mort', deleted: true }), comment({ id: 'r', parentId: 'mort' }))
    );
    expect(stamp).toEqual({ open: 1, total: 1, at: T1 });
  });

  it('`at` est la date du DERNIER commentaire, pas celle de l’écriture', () => {
    expect(
      threadStampOf(map(comment({ id: 'a', createdAt: T3 }), comment({ id: 'b', createdAt: T1 })))
        .at
    ).toBe(T3);
  });
});

// ── La forme sérialisée ─────────────────────────────────────────────────────

describe('la FORME dans la méta — ce que l’autre application lit', () => {
  it('la clé est « threadStats », et elle porte exactement trois champs', () => {
    const meta = metaWithThreadStamp({ title: 'x' }, map(comment({ id: 'a', createdAt: T2 })));
    expect(THREAD_STATS_META).toBe('threadStats');
    expect(meta).toEqual({ title: 'x', threadStats: { open: 1, total: 1, at: T2 } });
    expect(Object.keys((meta as unknown as Record<string, object>).threadStats)).toEqual([
      'open',
      'total',
      'at',
    ]);
  });

  it('un fil VIDE RETIRE la clé au lieu d’écrire des zéros', () => {
    // Un `{open:0,total:0}` traînant est un fil fantôme que rien ne nettoie —
    // et la méta est bornée.
    const meta = metaWithThreadStamp(
      { title: 'x', threadStats: { open: 2, total: 3, at: T1 } },
      {}
    );
    expect(meta).toEqual({ title: 'x' });
    expect('threadStats' in meta).toBe(false);
  });

  it('n’écrase PAS le reste de la méta — threadFor survit', () => {
    const meta = metaWithThreadStamp(
      { [THREAD_FOR_META]: 'file-1', title: '' },
      map(comment({ id: 'a' }))
    );
    expect(meta[THREAD_FOR_META]).toBe('file-1');
  });

  it('ne mute jamais la méta d’entrée', () => {
    const source = { title: 'x' };
    const out = writeThreadStamp(source, { open: 1, total: 1, at: T1 });
    expect(source).toEqual({ title: 'x' });
    expect(out).not.toBe(source);
  });
});

describe('readThreadStamp — un tampon vient d’octets qu’un AUTRE a écrits', () => {
  it('relit ce qu’on vient d’écrire', () => {
    const meta = metaWithThreadStamp({}, map(comment({ id: 'a', createdAt: T2 })));
    expect(readThreadStamp(meta)).toEqual({ open: 1, total: 1, at: T2 });
  });

  it('rend null quand il n’y a rien', () => {
    expect(readThreadStamp(undefined)).toBeNull();
    expect(readThreadStamp({})).toBeNull();
    expect(readThreadStamp({ threadStats: 'nope' })).toBeNull();
    expect(readThreadStamp({ threadStats: null })).toBeNull();
  });

  it('REFUSE EN BLOC un tampon incohérent plutôt que de le corriger', () => {
    // Une pastille tirée d'une donnée incohérente vaut moins que pas de
    // pastille : on ne « répare » pas des octets qu'on n'a pas écrits.
    expect(readThreadStamp({ threadStats: { open: -1, total: 3, at: T1 } })).toBeNull();
    expect(readThreadStamp({ threadStats: { open: 5, total: 3, at: T1 } })).toBeNull();
    expect(readThreadStamp({ threadStats: { open: 1.5, total: 3, at: T1 } })).toBeNull();
    expect(readThreadStamp({ threadStats: { open: '1', total: 3, at: T1 } })).toBeNull();
    expect(readThreadStamp({ threadStats: { total: 3, at: T1 } })).toBeNull();
  });

  it('une date absente ou creuse devient null, sans invalider le compte', () => {
    expect(readThreadStamp({ threadStats: { open: 1, total: 2 } })).toEqual({
      open: 1,
      total: 2,
      at: null,
    });
    expect(readThreadStamp({ threadStats: { open: 1, total: 2, at: '' } })?.at).toBeNull();
  });
});

// ── La fraîcheur ────────────────────────────────────────────────────────────

describe('stampStillTrusted — un tampon PÉRIMÉ ne s’affiche pas comme sûr', () => {
  it('reste digne de foi quand le porteur n’a pas bougé depuis', () => {
    expect(stampStillTrusted({ open: 1, total: 1, at: T2 }, T2)).toBe(true);
  });

  it('tolère une minute — l’écriture du tampon met à jour l’élément juste après', () => {
    expect(
      stampStillTrusted(
        { open: 1, total: 1, at: '2026-09-01T10:00:00.000Z' },
        '2026-09-01T10:00:59.000Z'
      )
    ).toBe(true);
  });

  it('tombe quand le porteur a été réécrit BIEN APRÈS le dernier commentaire', () => {
    // C'est exactement la trace qu'un client ignorant `threadStats` laisse.
    expect(stampStillTrusted({ open: 1, total: 1, at: T1 }, T3)).toBe(false);
  });

  it('un fil sans date ne peut pas être déclaré périmé', () => {
    expect(stampStillTrusted({ open: 0, total: 0, at: null }, T3)).toBe(true);
  });

  it('une date illisible penche vers la confiance plutôt que vers le faux négatif', () => {
    expect(stampStillTrusted({ open: 1, total: 1, at: 'pas-une-date' }, T3)).toBe(true);
  });
});

// ── Les pastilles d'une liste ───────────────────────────────────────────────

const file = { id: 'file-1', meta: {}, updatedAt: T1 };

describe('threadBadges — deux transports, une carte', () => {
  it('un SIDECAR décore SON FICHIER, jamais lui-même', () => {
    const sidecar = {
      id: 'side-1',
      meta: { [THREAD_FOR_META]: 'file-1', threadStats: { open: 2, total: 5, at: T2 } },
      updatedAt: T2,
    };
    const badges = threadBadges([file, sidecar]);
    expect(badges.get('file-1')).toEqual({
      itemId: 'file-1',
      open: 2,
      total: 5,
      at: T2,
      exact: true,
    });
    expect(badges.has('side-1')).toBe(false);
  });

  it('un sidecar ORPHELIN ne produit rien', () => {
    const sidecar = {
      id: 'side-1',
      meta: { [THREAD_FOR_META]: 'disparu', threadStats: { open: 1, total: 1, at: T2 } },
      updatedAt: T2,
    };
    expect(threadBadges([sidecar]).size).toBe(0);
  });

  it('une NOTE porte son propre tampon', () => {
    const note = {
      id: 'note-1',
      meta: { title: 'n', threadStats: { open: 0, total: 4, at: T2 } },
      updatedAt: T2,
    };
    expect(threadBadges([note]).get('note-1')).toEqual({
      itemId: 'note-1',
      open: 0,
      total: 4,
      at: T2,
      exact: true,
    });
  });

  it('une note SANS tampon n’invente pas de pastille', () => {
    expect(threadBadges([{ id: 'note-2', meta: { title: 'n' }, updatedAt: T1 }]).size).toBe(0);
  });

  it('un fil VIDE n’allume RIEN — même porté par un sidecar bien vivant', () => {
    const sidecar = {
      id: 'side-1',
      meta: { [THREAD_FOR_META]: 'file-1', threadStats: { open: 0, total: 0, at: null } },
      updatedAt: T2,
    };
    expect(threadBadges([file, sidecar]).size).toBe(0);
  });

  it('un sidecar SANS tampon dit « un fil existe » sans avancer de chiffre', () => {
    const sidecar = { id: 'side-1', meta: { [THREAD_FOR_META]: 'file-1' }, updatedAt: T2 };
    expect(threadBadges([file, sidecar]).get('file-1')).toEqual({
      itemId: 'file-1',
      open: 0,
      total: 0,
      at: T2,
      exact: false,
    });
  });

  it('un tampon PÉRIMÉ perd son exactitude, pas son existence', () => {
    const sidecar = {
      id: 'side-1',
      meta: { [THREAD_FOR_META]: 'file-1', threadStats: { open: 3, total: 3, at: T1 } },
      updatedAt: '2026-09-02T10:00:00.000Z',
    };
    const badge = threadBadges([file, sidecar]).get('file-1');
    expect(badge?.exact).toBe(false);
    expect(badge?.open).toBe(3);
    // La date affichée retombe sur celle du PORTEUR : le tampon n'est plus
    // l'autorité sur « quand a-t-on parlé la dernière fois ».
    expect(badge?.at).toBe('2026-09-02T10:00:00.000Z');
  });

  it('threadBadgeFor est la vue à un seul élément', () => {
    const sidecar = {
      id: 'side-1',
      meta: { [THREAD_FOR_META]: 'file-1', threadStats: { open: 1, total: 1, at: T2 } },
      updatedAt: T2,
    };
    expect(threadBadgeFor([file, sidecar], 'file-1')?.open).toBe(1);
    expect(threadBadgeFor([file, sidecar], 'file-2')).toBeNull();
  });
});

describe('threadBadgeKey — trois états, trois PHRASES', () => {
  it('ne fabrique jamais « 0 commentaires ouverts » par interpolation', () => {
    expect(threadBadgeKey(null)).toBe('teamVaults.comments.threadNone');
    expect(threadBadgeKey({ itemId: 'x', open: 0, total: 0, at: null, exact: false })).toBe(
      'teamVaults.comments.threadUnknown'
    );
    expect(threadBadgeKey({ itemId: 'x', open: 0, total: 3, at: T1, exact: true })).toBe(
      'teamVaults.comments.threadResolved'
    );
    expect(threadBadgeKey({ itemId: 'x', open: 2, total: 3, at: T1, exact: true })).toBe(
      'teamVaults.comments.threadOpen'
    );
  });
});
