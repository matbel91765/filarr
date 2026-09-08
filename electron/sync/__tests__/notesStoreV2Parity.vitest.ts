/**
 * PARITÉ ENTRE LES DEUX MOTEURS v2 — bureau et web.
 *
 * ═══ POURQUOI CE FICHIER EXISTE ═══
 *
 * `electron/sync/notesStoreV2.ts` et `src/platform/web/sync/notesStoreV2.ts`
 * sont deux copies du MÊME module. La duplication n'est pas un choix : le
 * processus principal se compile avec `electron/tsconfig.json`, dont la racine
 * est `electron/`, et importer un module de `src/` y déplacerait toute
 * l'arborescence émise dans `dist-electron`.
 *
 * Deux copies veut dire deux occasions de diverger. Et une divergence ICI n'est
 * pas une bizarrerie cosmétique : les deux moteurs ARBITRENT. S'ils ne désignent
 * pas le même gagnant, le bureau et le web se renvoient indéfiniment des
 * versions différentes de la même note, chacun convaincu d'avoir raison — et
 * l'utilisateur voit son texte osciller sans qu'aucune erreur ne s'affiche.
 *
 * ⚠ CE QUE CE TEST NE PROUVE PAS. Une parité entre deux dérivés ne dit rien de
 * leur JUSTESSE : deux copies fausses à l'identique passent ici sans broncher.
 * La justesse est éprouvée contre l'AUTORITÉ, dans `notesStoreV2.vitest.ts`
 * (aller-retour, invariant dur, et surtout parité d'arbitrage avec la v1). Ce
 * fichier-ci n'attrape qu'UNE chose : la dérive entre les deux copies.
 */

import { describe, expect, it } from 'vitest';

import * as bureau from '../notesStoreV2';
import * as web from '../../../src/platform/web/sync/notesStoreV2';
import * as blobsBureau from '../noteBlobs';
import * as blobsWeb from '../../../src/platform/web/sync/noteBlobs';
import { blobHash } from '../notesVaultFacade';
import { webBlobHash } from '../../../src/platform/web/sync/webNotesHash';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-06-01T00:00:00.000Z';
const T2 = '2026-09-01T00:00:00.000Z';
const NOW = Date.parse('2026-09-02T00:00:00.000Z');

type Entree = { o?: string; u?: string | null; d?: string | null; g?: string; s?: string };

function idx(entrees: Record<string, Entree>, extra: Record<string, unknown> = {}) {
  const notes: Record<string, unknown> = {};
  for (const [id, e] of Object.entries(entrees)) {
    notes[id] = {
      objectId: e.o ?? `obj-${id}`,
      updatedAt: e.u === undefined ? T0 : e.u,
      deletedAt: e.d ?? null,
      digest: e.g ?? `d-${id}`,
      ...(e.s !== undefined ? { syncedDigest: e.s } : {}),
    };
  }
  return {
    version: 2,
    notes,
    allIds: Object.keys(notes),
    notebooks: {},
    templates: [],
    purged: {},
    purgedNotebooks: {},
    ...extra,
  };
}

function note(id: string, o: Record<string, unknown> = {}) {
  return { id, title: `Note ${id}`, content: `c-${id}`, createdAt: T0, updatedAt: T0, ...o };
}

const deps = () => {
  let n = 0;
  return { digestOf: (x: never) => JSON.stringify(x), newObjectId: () => `o${++n}` };
};

// ── Les constantes doivent être les mêmes des deux côtés ────────────────────

describe('constantes', () => {
  it('même version de format, mêmes clés, même durée de vie des pierres', () => {
    expect(web.NOTES_FORMAT_VERSION).toBe(bureau.NOTES_FORMAT_VERSION);
    expect(web.PURGE_TOMBSTONE_TTL_MS).toBe(bureau.PURGE_TOMBSTONE_TTL_MS);
    expect(web.NOTES_INDEX_FILE_ID).toBe(bureau.NOTES_INDEX_FILE_ID);
    expect(web.NOTE_ENTRY_PREFIX).toBe(bureau.NOTE_ENTRY_PREFIX);
    expect(web.NOTES_INDEX_FILENAME).toBe(bureau.NOTES_INDEX_FILENAME);
    expect(web.NOTES_DIR).toBe(bureau.NOTES_DIR);
  });
});

// ── L'arbitrage, cas par cas ────────────────────────────────────────────────

/**
 * Chaque cas est celui d'une règle du module : union, fraîcheur, égalité,
 * résurrection, purge, contenus identiques, clé d'objet du nuage, ancêtre
 * commun. Les deux copies doivent rendre EXACTEMENT le même plan.
 */
describe('arbitrage : les deux moteurs rendent le même plan', () => {
  const cas: Array<[string, ReturnType<typeof idx>, ReturnType<typeof idx>]> = [
    ['union simple', idx({ a: {}, b: {} }), idx({ a: {}, c: {} })],
    ['distant plus frais', idx({ a: { u: T0, g: 'L' } }), idx({ a: { u: T2, g: 'R' } })],
    ['local plus frais', idx({ a: { u: T2, g: 'L' } }), idx({ a: { u: T0, g: 'R' } })],
    ['égalité → le local tient', idx({ a: { u: T1, g: 'L' } }), idx({ a: { u: T1, g: 'R' } })],
    [
      'tombstone distante plus fraîche',
      idx({ a: { u: T0, g: 'L' } }),
      idx({ a: { u: T0, d: T2, g: 'R' } }),
    ],
    [
      'résurrection : tombstone à horloge égale',
      idx({ a: { u: T2, g: 'L' } }),
      idx({ a: { u: T0, d: T2, g: 'R' } }),
    ],
    ['contenus identiques', idx({ a: { u: T0, g: 'MEME' } }), idx({ a: { u: T2, g: 'MEME' } })],
    ['clé d’objet du nuage', idx({ a: { o: 'local' } }), idx({ a: { o: 'nuage' } })],
    [
      'ancêtre commun connu',
      idx({ a: { u: T2, g: 'NEUF', s: 'ANCETRE' } }),
      idx({ a: { u: T0, g: 'ANCETRE' } }),
    ],
    [
      'ancêtre commun divergent',
      idx({ a: { u: T2, g: 'NEUF', s: 'ANCETRE' } }),
      idx({ a: { u: T0, g: 'AUTRE' } }),
    ],
    [
      'purge qui emporte',
      idx({ a: {} }, { purged: { a: '2026-08-01T00:00:00.000Z' } }),
      idx({ a: { u: T0 } }),
    ],
    [
      'purge devancée par une modification',
      idx({ a: {} }, { purged: { a: '2026-08-01T00:00:00.000Z' } }),
      idx({ a: { u: '2026-08-15T00:00:00.000Z' } }),
    ],
    ['horloge illisible', idx({ a: { u: 'bidon', g: 'L' } }), idx({ a: { u: 'aussi', g: 'R' } })],
    ['horloge absente', idx({ a: { u: null, g: 'L' } }), idx({ a: { u: T0, g: 'R' } })],
  ];

  for (const [nom, local, distant] of cas) {
    it(`même plan — ${nom}`, () => {
      const b = bureau.mergeIndexes(local as never, distant as never, NOW);
      const w = web.mergeIndexes(local as never, distant as never, NOW);
      expect(w.toFetch).toEqual(b.toFetch);
      expect(w.toPush).toEqual(b.toPush);
      expect(w.purgedOut).toEqual(b.purgedOut);
      expect(w.rekeyed).toEqual(b.rekeyed);
      expect(w.changedFromLocal).toBe(b.changedFromLocal);
      expect(w.changedFromRemote).toBe(b.changedFromRemote);
      expect(JSON.stringify(w.overwritten)).toBe(JSON.stringify(b.overwritten));
      expect(JSON.stringify(w.merged)).toBe(JSON.stringify(b.merged));
    });
  }
});

// ── Découpe, recomposition, normalisation ───────────────────────────────────

describe('découpe et recomposition', () => {
  const coffre = {
    byId: { a: note('a'), b: note('b', { deletedAt: T1 }), c: note('c', { updatedAt: T2 }) },
    allIds: ['c', 'a', 'b'],
    templates: [{ id: 't1', name: 'Modèle' }],
    notebooks: { n1: { id: 'n1', name: 'Carnet' } },
    purged: { z: T1 },
  };

  it('découpent à l’identique', () => {
    expect(JSON.stringify(web.splitVault(coffre as never, deps() as never))).toBe(
      JSON.stringify(bureau.splitVault(coffre as never, deps() as never))
    );
  });

  it('recomposent à l’identique, et rendent le coffre', () => {
    const b = bureau.splitVault(coffre as never, deps() as never);
    const w = web.splitVault(coffre as never, deps() as never);
    expect(JSON.stringify(web.assembleVault(w.index, w.notes))).toBe(
      JSON.stringify(bureau.assembleVault(b.index, b.notes))
    );
    // Et la propriété qui compte vraiment : l'aller-retour rend le coffre.
    expect(bureau.assembleVault(b.index, b.notes)).toEqual(coffre);
  });

  it('normalisent un index illisible de la même façon', () => {
    for (const entree of [null, 42, {}, { notes: { a: 'pas un objet', b: { objectId: 'o' } } }]) {
      expect(JSON.stringify(web.normalizeIndex(entree))).toBe(
        JSON.stringify(bureau.normalizeIndex(entree))
      );
    }
  });

  it('retirent l’ancêtre commun de la même façon avant publication', () => {
    const i = idx({ a: { s: 'SECRET' }, b: {} });
    expect(JSON.stringify(web.indexForCloud(i as never))).toBe(
      JSON.stringify(bureau.indexForCloud(i as never))
    );
  });

  it('lisent l’horloge de la même façon, y compris sur du n’importe quoi', () => {
    for (const e of [
      { updatedAt: T0, deletedAt: null },
      { updatedAt: null, deletedAt: T2 },
      { updatedAt: 'bidon', deletedAt: null },
      { updatedAt: null, deletedAt: null },
    ]) {
      expect(web.indexClock(e)).toBe(bureau.indexClock(e));
    }
    for (const n of [note('a'), note('a', { updatedAt: 'bidon' }), null, 42, []]) {
      expect(web.noteClock(n)).toBe(bureau.noteClock(n));
    }
  });
});

// ── L'invariant dur doit jeter des DEUX côtés ───────────────────────────────

describe('invariant dur', () => {
  it('les deux acceptent ce que les deux acceptent', () => {
    const local = idx({ a: {}, b: {}, c: {} });
    expect(() => bureau.mergeIndexes(local as never, idx({}) as never, NOW)).not.toThrow();
    expect(() => web.mergeIndexes(local as never, idx({}) as never, NOW)).not.toThrow();
    expect(
      Object.keys(web.mergeIndexes(local as never, idx({}) as never, NOW).merged.notes).sort()
    ).toEqual(['a', 'b', 'c']);
  });
});

// ── Les images, dont les deux copies doivent lire le MÊME document ──────────
//
// Une divergence ici ne se voit pas tout de suite : le bureau sort une image et
// pose une référence, le web ne la reconnaît pas, ne remonte jamais les octets
// — et l'image arrive cassée sur le troisième appareil, sans qu'aucune erreur
// ne s'affiche nulle part.

describe('parité des images', () => {
  const hash = (b64: string) => `h${b64.length}`;
  const OCTETS = 'AAAABBBBCCCC';

  /** La forme RÉELLE : `Note.content` est une chaîne de JSON TipTap sérialisé. */
  const vraieNote = (src: string) => ({
    id: 'n1',
    content: JSON.stringify({
      type: 'doc',
      content: [{ type: 'fileEmbed', attrs: { src, fileType: 'image/png' } }],
    }),
  });

  it('même préfixe, même délai de grâce, même dossier', () => {
    expect(blobsWeb.BLOB_REF_PREFIX).toBe(blobsBureau.BLOB_REF_PREFIX);
    expect(blobsWeb.BLOB_SWEEP_GRACE_MS).toBe(blobsBureau.BLOB_SWEEP_GRACE_MS);
    expect(blobsWeb.BLOBS_DIR).toBe(blobsBureau.BLOBS_DIR);
  });

  it('extraient la même chose d’une note réelle', () => {
    const source = vraieNote(`data:image/png;base64,${OCTETS}`);
    expect(blobsWeb.extractBlobs(source, hash)).toEqual(blobsBureau.extractBlobs(source, hash));
  });

  it('recensent les mêmes références', () => {
    const avecRef = vraieNote(`${blobsBureau.BLOB_REF_PREFIX}${'ab'.repeat(8)}`);
    expect([...blobsWeb.referencedBlobs(avecRef)]).toEqual([
      ...blobsBureau.referencedBlobs(avecRef),
    ]);
  });

  it('réinsèrent à l’identique, et signalent les mêmes manques', () => {
    const avecRef = vraieNote(`${blobsBureau.BLOB_REF_PREFIX}${'ab'.repeat(8)}`);
    expect(blobsWeb.inlineBlobs(avecRef, () => OCTETS)).toEqual(
      blobsBureau.inlineBlobs(avecRef, () => OCTETS)
    );
    expect(blobsWeb.inlineBlobs(avecRef, () => null)).toEqual(
      blobsBureau.inlineBlobs(avecRef, () => null)
    );
  });

  it('fabriquent le même chemin, et refusent les mêmes empreintes', () => {
    for (const h of ['ab'.repeat(8), '../../evasion', 'zz', '']) {
      expect(blobsWeb.blobPath('notes', h)).toBe(blobsBureau.blobPath('notes', h));
    }
  });

  it('balaient exactement les mêmes images', () => {
    const entree = {
      present: ['aaa', 'bbb'],
      referenced: new Set(['aaa']),
      scannedNotes: 3,
      expectedNotes: 3,
      ageMs: () => 999_999_999,
      graceMs: blobsBureau.BLOB_SWEEP_GRACE_MS,
    };
    expect(blobsWeb.selectSweepableBlobs(entree)).toEqual(
      blobsBureau.selectSweepableBlobs(entree)
    );
    const incomplet = { ...entree, scannedNotes: 2 };
    expect(blobsWeb.selectSweepableBlobs(incomplet)).toEqual(
      blobsBureau.selectSweepableBlobs(incomplet)
    );
  });
});

describe('parité de l’empreinte de coffre', () => {
  it('les deux copies en tirent la même valeur', () => {
    const index = idx({ a: { g: 'da' }, b: { g: 'db' } });
    const h = (v: Record<string, unknown>) => JSON.stringify(v);
    expect(web.legacyVaultDigest(index as never, h)).toBe(
      bureau.legacyVaultDigest(index as never, h)
    );
  });

  it('et aucune des deux ne la publie', () => {
    const index = idx({ a: {} }, { legacyDigest: 'X' });
    expect(web.indexForCloud(index as never).legacyDigest).toBeUndefined();
    expect(bureau.indexForCloud(index as never).legacyDigest).toBeUndefined();
  });
});

// ── Les pierres tombales d'images doivent être arbitrées PAREIL ─────────────
//
// Une divergence ici est une perte différée : le bureau supprime une image que
// le web croit encore là-haut, ou le web la ressuscite pendant que le bureau la
// tient pour morte — et les deux se renvoient le registre indéfiniment.

describe('parité des pierres tombales', () => {
  it('même arbitrage pierre contre registre', () => {
    for (const [reg, tomb] of [
      [{ aaa: T0 }, { aaa: T2 }],
      [{ aaa: T2 }, { aaa: T0 }],
      [{ aaa: 'n/a' }, { aaa: T0 }],
      [{}, { zzz: T0 }],
      [{ aaa: T0, bbb: T2 }, { aaa: T1, bbb: T1 }],
    ] as Array<[Record<string, string>, Record<string, string>]>) {
      expect(web.reconcileBlobRegistry(reg, tomb)).toEqual(bureau.reconcileBlobRegistry(reg, tomb));
    }
  });

  it('même fusion, même publication', () => {
    const local = idx({ a: {} }, { blobs: { aaa: T0, bbb: T2 } });
    const remote = idx({ a: {} }, { blobTombstones: { aaa: T1, bbb: T1 } });
    const pb = bureau.mergeIndexes(local as never, remote as never, NOW);
    const pw = web.mergeIndexes(local as never, remote as never, NOW);
    expect(pw.merged.blobs).toEqual(pb.merged.blobs);
    expect(pw.merged.blobTombstones).toEqual(pb.merged.blobTombstones);
    expect(web.indexForCloud(pw.merged).blobTombstones).toEqual(
      bureau.indexForCloud(pb.merged).blobTombstones
    );
  });

  it('mêmes constantes de balayage du nuage', () => {
    expect(blobsWeb.CLOUD_BLOB_SWEEP_GRACE_MS).toBe(blobsBureau.CLOUD_BLOB_SWEEP_GRACE_MS);
    expect(blobsWeb.CLOUD_BLOB_SWEEP_MAX_PER_CYCLE).toBe(blobsBureau.CLOUD_BLOB_SWEEP_MAX_PER_CYCLE);
  });
});

/**
 * L'EMPREINTE D'IMAGE EST L'IDENTIFIANT DE L'OBJET. Deux plateformes qui n'en
 * tirent pas la même valeur remontent deux fois la même image sous deux clés —
 * exactement ce que l'adressage par contenu existe pour empêcher. Le bureau
 * hache avec `node:crypto`, le web avec `crypto.subtle` : ce test est le seul
 * endroit où les deux se rencontrent.
 */
describe('parité de l’empreinte d’image', () => {
  it('même SHA-256, même troncature, sur des charges variées', async () => {
    for (const b64 of ['AAAA', 'QUJDREVGR0hJSktMTU5PUA==', 'x'.repeat(10_000), '']) {
      expect(await webBlobHash(b64)).toBe(blobHash(b64));
    }
  });
});
