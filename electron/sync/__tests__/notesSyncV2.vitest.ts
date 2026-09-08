/**
 * CONTRATS DU TRANSPORT v2.
 *
 * L'arbitrage est eprouve ailleurs (`notesStoreV2.vitest.ts`). Ici on eprouve
 * ce qu'un transport peut casser tout seul, et qui ne se voit qu'en panne
 * PARTIELLE — le cas normal marche toujours :
 *
 *  1. l'ORDRE : les notes montent AVANT l'index. Un index publie qui cite un
 *     objet absent de R2 casse TOUS les autres appareils, pas celui qui a fauté ;
 *  2. une REMONTEE ratee annule la publication, entierement ;
 *  3. une DESCENTE ratee n'annule rien, mais l'index LOCAL doit garder notre
 *     entree — pretendre detenir un contenu qu'on n'a pas se propagerait comme
 *     une perte a l'ecriture suivante ;
 *  4. la PROPORTIONNALITE : rien ne bouge quand rien n'a change.
 */

import { describe, expect, it } from 'vitest';

import { syncNotesV2, type LocalVaultView, type NotesTransport } from '../notesSyncV2';
import {
  NOTES_FORMAT_VERSION,
  type NoteRecord,
  type NotesIndex,
} from '../notesStoreV2';

const T0 = '2026-01-01T00:00:00.000Z';
const T2 = '2026-09-01T00:00:00.000Z';

function idx(
  entries: Record<string, { o?: string; u?: string; g?: string; s?: string }>
): NotesIndex {
  const notes: NotesIndex['notes'] = {};
  for (const [id, e] of Object.entries(entries)) {
    notes[id] = {
      objectId: e.o ?? `obj-${id}`,
      updatedAt: e.u ?? T0,
      deletedAt: null,
      digest: e.g ?? `d-${id}`,
      ...(e.s !== undefined ? { syncedDigest: e.s } : {}),
    };
  }
  return {
    version: NOTES_FORMAT_VERSION,
    notes,
    allIds: Object.keys(notes),
    notebooks: {},
    templates: [],
    purged: {},
    purgedNotebooks: {},
  };
}

/** Transport enregistreur, avec panne ciblee. */
class FakeTransport implements NotesTransport {
  journal: string[] = [];
  cloudNotes = new Map<string, NoteRecord>();
  publishedIndex: NotesIndex | null = null;
  failGetNote = new Set<string>();
  failPutNote = new Set<string>();

  constructor(private remote: NotesIndex | null) {}

  async getRemoteIndex(): Promise<NotesIndex | null> {
    this.journal.push('getIndex');
    return this.remote;
  }
  async getNote(objectId: string): Promise<NoteRecord | null> {
    this.journal.push(`get:${objectId}`);
    if (this.failGetNote.has(objectId)) throw new Error('reseau');
    return this.cloudNotes.get(objectId) ?? null;
  }
  async putNote(objectId: string, note: NoteRecord): Promise<void> {
    this.journal.push(`put:${objectId}`);
    if (this.failPutNote.has(objectId)) throw new Error('reseau');
    this.cloudNotes.set(objectId, note);
  }
  async putIndex(index: NotesIndex): Promise<void> {
    this.journal.push('putIndex');
    this.publishedIndex = index;
  }
  cloudBlobs = new Map<string, string>();
  async getBlob(hash: string): Promise<string | null> {
    this.journal.push(`getBlob:${hash}`);
    return this.cloudBlobs.get(hash) ?? null;
  }
  async putBlob(hash: string, base64: string): Promise<void> {
    this.journal.push(`putBlob:${hash}`);
    this.cloudBlobs.set(hash, base64);
  }
  async deleteBlob(hash: string): Promise<void> {
    this.journal.push(`deleteBlob:${hash}`);
    this.cloudBlobs.delete(hash);
  }
}

function localView(
  index: NotesIndex,
  notes: Record<string, NoteRecord> = {},
  blobs: Record<string, string> = {}
): LocalVaultView {
  return {
    index,
    readNote: async (noteId) => notes[noteId] ?? { id: noteId, title: `local ${noteId}` },
    readBlob: async (h) => blobs[h] ?? null,
    writeBlob: async (h, b) => {
      blobs[h] = b;
    },
  };
}

// ── 1. Le cas normal ────────────────────────────────────────────────────────

describe('cycle normal', () => {
  it('descend ce que le distant a gagne, remonte ce que le local a gagne', async () => {
    const local = idx({ a: { u: T2, g: 'L-a' }, b: { g: 'd-b' } });
    const remote = idx({ a: { u: T0, g: 'ANCIEN' }, c: { u: T2, g: 'R-c' } });
    const transport = new FakeTransport(remote);
    transport.cloudNotes.set('obj-c', { id: 'c', title: 'venu du nuage' });

    const res = await syncNotesV2(localView(local), transport);

    expect(res.downloaded).toEqual(['c']);
    expect(res.uploaded.sort()).toEqual(['a', 'b']);
    expect(res.fetched.c).toEqual({ id: 'c', title: 'venu du nuage' });
    expect(res.published).toBe(true);
  });

  it('rien n’a change : aucun transfert, aucune publication', async () => {
    const meme = idx({ a: { s: 'd-a' }, b: { s: 'd-b' } });
    const transport = new FakeTransport(idx({ a: {}, b: {} }));
    const res = await syncNotesV2(localView(meme), transport);

    expect(res.downloaded).toEqual([]);
    expect(res.uploaded).toEqual([]);
    expect(res.published).toBe(false);
    expect(transport.journal).toEqual(['getIndex']);
  });

  it('nuage sans index : tout part, rien ne descend', async () => {
    const transport = new FakeTransport(null);
    const res = await syncNotesV2(localView(idx({ a: {}, b: {} })), transport);
    expect(res.uploaded.sort()).toEqual(['a', 'b']);
    expect(res.downloaded).toEqual([]);
    expect(res.published).toBe(true);
  });

  it('va chercher la note sous la clé d’objet du NUAGE, pas la locale', async () => {
    const local = idx({ a: { o: 'cle-locale', u: T0, g: 'vieux' } });
    const remote = idx({ a: { o: 'cle-nuage', u: T2, g: 'frais' } });
    const transport = new FakeTransport(remote);
    transport.cloudNotes.set('cle-nuage', { id: 'a' });

    const res = await syncNotesV2(localView(local), transport);
    expect(transport.journal).toContain('get:cle-nuage');
    expect(transport.journal).not.toContain('get:cle-locale');
    expect(res.downloaded).toEqual(['a']);
  });
});

// ── 2. L'ordre : les notes AVANT l'index ────────────────────────────────────

/**
 * LA PANNE QUE CET ORDRE EVITE N'EST PAS LOCALE. Un index publie qui cite un
 * objet absent de R2 ne casse pas l'appareil qui l'a publie — il casse tous les
 * AUTRES, qui descendront l'index, demanderont la note, et tomberont sur du
 * vide. Le depot connait deja cette panne sous une autre forme (« Checksum
 * mismatch » en descendant `meta:notes`).
 */
describe('ordre de publication', () => {
  it('publie l’index APRES toutes les remontees', async () => {
    const local = idx({ a: { u: T2, g: 'L' }, b: { u: T2, g: 'L' } });
    const transport = new FakeTransport(idx({}));
    await syncNotesV2(localView(local), transport);

    const iPut = transport.journal.indexOf('putIndex');
    expect(iPut).toBeGreaterThan(-1);
    for (const [i, evt] of transport.journal.entries()) {
      if (evt.startsWith('put:')) expect(i).toBeLessThan(iPut);
    }
  });

  it('l’index publie ne porte JAMAIS l’ancetre commun', async () => {
    const local = idx({ a: { u: T2, g: 'L', s: 'SECRET-LOCAL' } });
    const transport = new FakeTransport(idx({ a: { u: T0, g: 'ANCIEN' } }));
    await syncNotesV2(localView(local), transport);
    expect(transport.publishedIndex!.notes.a.syncedDigest).toBeUndefined();
  });
});

// ── 3. Pannes partielles ────────────────────────────────────────────────────

describe('une remontee ratee annule la publication', () => {
  it('ne publie RIEN quand une seule note n’a pas pu monter', async () => {
    const local = idx({ a: { u: T2, g: 'L-a' }, b: { u: T2, g: 'L-b' } });
    const transport = new FakeTransport(idx({}));
    transport.failPutNote.add('obj-b');

    const res = await syncNotesV2(localView(local), transport);

    expect(res.uploaded).toEqual(['a']);
    expect(res.failures).toEqual([
      { noteId: 'b', direction: 'up', reason: 'reseau' },
    ]);
    expect(res.published).toBe(false);
    expect(transport.publishedIndex).toBeNull();
    expect(transport.journal).not.toContain('putIndex');
  });

  it('l’ancetre n’est pose que sur ce qui a REELLEMENT converge', async () => {
    const local = idx({ a: { u: T2, g: 'L-a' }, b: { u: T2, g: 'L-b' } });
    const transport = new FakeTransport(idx({}));
    transport.failPutNote.add('obj-b');

    const res = await syncNotesV2(localView(local), transport);
    expect(res.localIndex.notes.a.syncedDigest).toBe('L-a');
    expect(res.localIndex.notes.b.syncedDigest ?? null).toBeNull();
  });
});

describe('une descente ratee n’annule rien, mais ne ment pas', () => {
  it('publie quand meme — le nuage porte bien cette note', async () => {
    const local = idx({ a: { u: T2, g: 'L-a' }, c: { u: T0, g: 'vieux-c' } });
    const remote = idx({ c: { u: T2, g: 'frais-c' } });
    const transport = new FakeTransport(remote);
    transport.failGetNote.add('obj-c');

    const res = await syncNotesV2(localView(local), transport);
    expect(res.failures).toEqual([{ noteId: 'c', direction: 'down', reason: 'reseau' }]);
    expect(res.published).toBe(true);
  });

  /**
   * LE POINT QUI COMPTE. Si l'index LOCAL adoptait l'entree distante sans avoir
   * la note, on pretendrait detenir un contenu qu'on n'a pas — et la prochaine
   * ecriture du coffre ecrirait une note vide sous cette entree, donc la
   * perdrait pour de bon, sur tous les appareils.
   */
  it('l’index LOCAL garde notre entree tant que la note n’est pas arrivee', async () => {
    const local = idx({ c: { u: T0, g: 'LE-NOTRE' } });
    const remote = idx({ c: { u: T2, g: 'LE-LEUR' } });
    const transport = new FakeTransport(remote);
    transport.failGetNote.add('obj-c');

    const res = await syncNotesV2(localView(local), transport);
    expect(res.localIndex.notes.c.digest).toBe('LE-NOTRE');
    expect(res.fetched.c).toBeUndefined();
  });

  it('un objet absent du nuage compte comme une descente ratee', async () => {
    const local = idx({ c: { u: T0, g: 'LE-NOTRE' } });
    const transport = new FakeTransport(idx({ c: { u: T2, g: 'LE-LEUR' } }));
    // `cloudNotes` est vide : le get rend `null`.
    const res = await syncNotesV2(localView(local), transport);
    expect(res.failures[0]).toMatchObject({ noteId: 'c', direction: 'down' });
    expect(res.localIndex.notes.c.digest).toBe('LE-NOTRE');
  });

  it('une note locale illisible ne fait pas echouer le cycle, seulement sa remontee', async () => {
    const local: LocalVaultView = {
      index: idx({ a: { u: T2, g: 'L-a' }, b: { u: T2, g: 'L-b' } }),
      readNote: async (id) => (id === 'b' ? null : { id }),
      readBlob: async () => null,
      writeBlob: async () => {},
    };
    const transport = new FakeTransport(idx({}));
    const res = await syncNotesV2(local, transport);
    expect(res.uploaded).toEqual(['a']);
    expect(res.failures[0]).toMatchObject({ noteId: 'b', direction: 'up' });
    expect(res.published).toBe(false);
  });
});

// ── 4. Proportionnalite ─────────────────────────────────────────────────────

describe('le cout suit ce qui a change', () => {
  it('une note sur 300 : un seul aller-retour reseau pour une note', async () => {
    const entries: Record<string, { u?: string; g?: string; s?: string }> = {};
    for (let i = 0; i < 300; i++) entries[`n${i}`] = { g: `d-n${i}`, s: `d-n${i}` };
    const local = idx(entries);

    const remoteEntries = { ...entries };
    remoteEntries.n7 = { u: T2, g: 'CHANGE' };
    const transport = new FakeTransport(idx(remoteEntries));
    transport.cloudNotes.set('obj-n7', { id: 'n7' });

    const res = await syncNotesV2(localView(local), transport);

    expect(res.downloaded).toEqual(['n7']);
    expect(res.uploaded).toEqual([]);
    // Un `getIndex`, un `get`, et rien d'autre — pas 300 requetes.
    expect(transport.journal.filter((e) => e.startsWith('get:'))).toHaveLength(1);
    expect(transport.journal.filter((e) => e.startsWith('put:'))).toHaveLength(0);
  });
});

// ── 5. Les images ───────────────────────────────────────────────────────────
//
// Elles vivent hors du JSON des notes, adressees par leur contenu. Tout
// l'interet du changement tient dans un seul contrat : UNE IMAGE NE SE
// TRANSFERE QU'UNE FOIS, quelles que soient les frappes qui suivent. Si celui-la
// tombe, le chantier n'a servi a rien.

const HASH = 'aaaabbbbccccdddd';
const AUTRE = '1111222233334444';

/** Une note qui cite une image par son empreinte. */
const noteAvecImage = (id: string, hash = HASH) => ({
  id,
  type: 'doc',
  content: [{ type: 'fileEmbed', attrs: { src: `filarr-blob:${hash}`, fileType: 'image/png' } }],
});

describe('les images ne repartent pas a chaque frappe', () => {
  it("LE CONTRAT : une image deja dans le nuage n'est JAMAIS remontee a nouveau", async () => {
    const local = idx({ a: { u: T2, g: 'L' } });
    local.blobs = { [HASH]: T0 }; // le nuage la detient deja
    const transport = new FakeTransport(idx({}));

    const res = await syncNotesV2(
      localView(local, { a: noteAvecImage('a') }, { [HASH]: 'OCTETS' }),
      transport
    );

    expect(res.uploaded).toEqual(['a']);
    expect(res.blobsUploaded).toEqual([]);
    expect(transport.journal.filter((e) => e.startsWith('putBlob'))).toHaveLength(0);
  });

  it("une image inconnue du nuage monte AVANT la note qui la cite", async () => {
    const transport = new FakeTransport(idx({}));
    const res = await syncNotesV2(
      localView(idx({ a: { u: T2, g: 'L' } }), { a: noteAvecImage('a') }, { [HASH]: 'OCTETS' }),
      transport
    );

    expect(res.blobsUploaded).toEqual([HASH]);
    // L'ordre : un objet publie qui designe des octets absents casserait
    // l'appareil SUIVANT, pas celui-ci.
    const iBlob = transport.journal.indexOf(`putBlob:${HASH}`);
    const iNote = transport.journal.findIndex((e) => e.startsWith('put:'));
    expect(iBlob).toBeGreaterThan(-1);
    expect(iBlob).toBeLessThan(iNote);
  });

  it("l'index publie apprend aux autres appareils ce qu'ils n'ont plus a envoyer", async () => {
    const transport = new FakeTransport(idx({}));
    await syncNotesV2(
      localView(idx({ a: { u: T2, g: 'L' } }), { a: noteAvecImage('a') }, { [HASH]: 'OCTETS' }),
      transport
    );
    expect(transport.publishedIndex?.blobs?.[HASH]).toBeDefined();
  });

  it('une image descendue arrive AVANT que sa note ne serve', async () => {
    const remote = idx({ b: { u: T2, g: 'R' } });
    const transport = new FakeTransport(remote);
    transport.cloudNotes.set('obj-b', noteAvecImage('b', AUTRE));
    transport.cloudBlobs.set(AUTRE, 'OCTETS-DISTANTS');
    const local: Record<string, string> = {};

    const res = await syncNotesV2(localView(idx({}), {}, local), transport);

    expect(res.downloaded).toEqual(['b']);
    expect(res.blobsDownloaded).toEqual([AUTRE]);
    expect(local[AUTRE]).toBe('OCTETS-DISTANTS');
  });

  it("une image deja detenue localement n'est pas redemandee", async () => {
    const remote = idx({ b: { u: T2, g: 'R' } });
    const transport = new FakeTransport(remote);
    transport.cloudNotes.set('obj-b', noteAvecImage('b', AUTRE));
    const res = await syncNotesV2(
      localView(idx({}), {}, { [AUTRE]: 'DEJA-LA' }),
      transport
    );
    expect(res.blobsDownloaded).toEqual([]);
    expect(transport.journal.filter((e) => e.startsWith('getBlob'))).toHaveLength(0);
  });

  /**
   * Une image absente EN LOCAL ne doit pas empecher la note de partir : la
   * reference vaut mieux que rien, et un autre appareil peut fort bien la
   * detenir. Bloquer la note ferait perdre le TEXTE en plus de l'image.
   */
  it("une image locale introuvable n'empeche pas la note de partir", async () => {
    const transport = new FakeTransport(idx({}));
    const res = await syncNotesV2(
      localView(idx({ a: { u: T2, g: 'L' } }), { a: noteAvecImage('a') }, {}),
      transport
    );
    expect(res.uploaded).toEqual(['a']);
    expect(res.blobsUploaded).toEqual([]);
    expect(res.published).toBe(true);
  });

  it("une image distante manquante est signalee, la note reste en place", async () => {
    const remote = idx({ b: { u: T2, g: 'R' } });
    const transport = new FakeTransport(remote);
    transport.cloudNotes.set('obj-b', noteAvecImage('b', AUTRE));
    // `cloudBlobs` vide : le get rend `null`.
    const res = await syncNotesV2(localView(idx({}), {}, {}), transport);
    expect(res.failures[0]).toMatchObject({ noteId: 'b', direction: 'down' });
    expect(res.blobsDownloaded).toEqual([]);
  });
});

// ── Suppression d'images : ce que la couche de décision fait, et ne fait pas ─

describe('images supprimées du nuage', () => {
  // Une pierre RÉCENTE : les pierres se périment (90 jours), et `T0` est bien
  // au-delà. Une pierre périmée disparaît AVANT l'arbitrage — ce n'est pas la
  // résurrection qu'on veut voir ici, c'est l'arbitrage lui-même.
  const RECENTE = new Date(Date.now() - 60_000).toISOString();
  /**
   * LA COUCHE DE DÉCISION NE SUPPRIME JAMAIS. `deleteBlob` existe sur le
   * transport pour le cycle, après un balayage COMPLET de toutes les notes ;
   * ici on ne voit qu'un plan, et un plan ne suffit pas à conclure qu'une
   * image n'est citée par personne.
   */
  it('ne supprime JAMAIS une image, quel que soit le plan', async () => {
    const remote = idx({});
    remote.blobs = { [HASH]: T0, [AUTRE]: T0 };
    const transport = new FakeTransport(remote);
    await syncNotesV2(localView(idx({ a: { u: T2, g: 'L' } }), { a: { id: 'a' } }), transport);
    expect(transport.journal.filter((e) => e.startsWith('deleteBlob'))).toEqual([]);
  });

  /**
   * LA RÉSURRECTION, DE BOUT EN BOUT. Un appareil resté hors ligne avec une
   * note qui cite une image que le nuage a entre-temps supprimée : sa note
   * part, le registre fusionné ne connaît plus l'image, donc elle repart avec
   * — et l'index publié fait tomber la pierre.
   */
  it('une note remontée qui cite une image sous pierre la renvoie, et lève la pierre', async () => {
    const remote = idx({});
    remote.blobTombstones = { [HASH]: RECENTE };
    const transport = new FakeTransport(remote);

    const res = await syncNotesV2(
      localView(idx({ a: { u: T2, g: 'L' } }), { a: noteAvecImage('a') }, { [HASH]: 'OCTETS' }),
      transport
    );

    expect(res.blobsUploaded).toEqual([HASH]);
    expect(transport.cloudBlobs.get(HASH)).toBe('OCTETS');
    expect(transport.publishedIndex?.blobs?.[HASH]).toBeDefined();
    expect(transport.publishedIndex?.blobTombstones?.[HASH]).toBeUndefined();
    expect(res.localIndex.blobTombstones?.[HASH]).toBeUndefined();
  });

  /**
   * Et l'inverse : une pierre reçue du nuage retire l'image du registre LOCAL,
   * pour que la prochaine note qui la cite la renvoie au lieu de croire qu'elle
   * est là-haut.
   */
  it('une pierre venue du nuage retire l’image du registre local', async () => {
    const local = idx({ a: { s: 'd-a' } });
    local.blobs = { [HASH]: T0 };
    const remote = idx({ a: {} });
    remote.blobTombstones = { [HASH]: T2 };
    const transport = new FakeTransport(remote);

    const res = await syncNotesV2(localView(local, { a: { id: 'a' } }), transport);

    expect(res.localIndex.blobs?.[HASH]).toBeUndefined();
    expect(res.localIndex.blobTombstones?.[HASH]).toBe(T2);
    expect(res.changedLocal).toBe(true);
  });

  it('une image sous pierre que personne ne cite reste sous pierre', async () => {
    const remote = idx({});
    remote.blobTombstones = { [HASH]: RECENTE };
    const transport = new FakeTransport(remote);
    const res = await syncNotesV2(localView(idx({})), transport);
    expect(res.localIndex.blobTombstones?.[HASH]).toBe(RECENTE);
    expect(transport.journal.filter((e) => e.startsWith('putBlob'))).toEqual([]);
  });
});
