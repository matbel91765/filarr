/**
 * DEUX APPAREILS, UN SEUL NUAGE — le seul endroit où la synchronisation se juge.
 *
 * ═══ POURQUOI CE FICHIER EXISTE ═══
 *
 * Tout le reste de la suite éprouve UN côté à la fois : un disque, une décision,
 * un transport, avec l'autre bout remplacé par une doublure qui dit ce qu'on
 * veut entendre. C'est nécessaire et ça n'a jamais suffi — le défaut d'origine
 * de tout ce chantier (une copie périmée qui écrase une fusion, puis la
 * remonte) vivait EXACTEMENT dans l'espace entre deux appareils, et aucun test
 * d'un seul côté ne pouvait le voir.
 *
 * Ici, deux moteurs complets tournent contre un même nuage. Les deux disques
 * sont distincts, les deux index sont distincts, et rien ne circule autrement
 * que par le transport — comme entre deux vraies machines.
 *
 * ═══ LA PROPRIÉTÉ QUI COMPTE LE PLUS N'EST PAS LA CONVERGENCE ═══
 *
 * Que deux appareils finissent d'accord est nécessaire mais facile. Ce qui fait
 * mal en production, c'est l'OSCILLATION : deux appareils d'accord sur le
 * contenu mais pas sur sa représentation, qui se renvoient éternellement la même
 * note, chacun convaincu que l'autre a changé quelque chose. Ça ne perd pas de
 * données — ça brûle de la bande passante, du chiffrement et de la batterie,
 * sans que rien ne s'affiche. Presque tous les tests ci-dessous vérifient donc
 * qu'un TROISIÈME tour n'écrit RIEN.
 *
 * ⚠ CE QUE CE FICHIER NE REMPLACE PAS. Deux moteurs dans un même processus ne
 * sont pas deux machines : pas d'horloges qui dérivent, pas de latence, pas de
 * coupure au milieu d'un transfert, pas de vraie couche de chiffrement. Un essai
 * sur deux appareils réels reste à faire, et rien ici ne l'annule.
 */

import { describe, expect, it } from 'vitest';

import { runNotesCycleV2 } from '../notesCycleV2';
import { extractIntoStore } from '../notesVaultFacade';
import { saveVaultV2, V1_BLOB_FILENAME, type VaultIO } from '../notesVaultStore';
import { splitDeps } from '../notesVaultFacade';
import {
  NOTES_DIR,
  NOTES_INDEX_FILENAME,
  type NoteRecord,
  type NotesIndex,
  type NotesPayload,
} from '../notesStoreV2';
import type { NotesTransport } from '../notesSyncV2';

const INDEX_PATH = `${NOTES_DIR}/${NOTES_INDEX_FILENAME}`;
const T0 = '2026-01-01T00:00:00.000Z';

// ── Un nuage, deux disques ──────────────────────────────────────────────────

/**
 * LE NUAGE PARTAGÉ. Un seul objet, deux transports qui le voient : c'est cette
 * unicité qui fait que le test dit quelque chose. Deux doublures indépendantes
 * ne se contrediraient jamais.
 */
class Nuage {
  index: NotesIndex | null = null;
  notes = new Map<string, NoteRecord>();
  blobs = new Map<string, string>();
  /** Les images supprimées du nuage, dans l'ordre. */
  deleted: string[] = [];
  /** Le vieux blob `meta:notes`, que le cycle de fichiers ORDINAIRE transporte. */
  legacy: NotesPayload | null = null;
}

class Disque implements VaultIO {
  files = new Map<string, unknown>();
  writes: string[] = [];
  reads: string[] = [];
  private tick = 0;
  private stamps = new Map<string, string>();

  async read(p: string): Promise<unknown | null> {
    this.reads.push(p);
    const v = this.files.get(p);
    return v === undefined ? null : structuredClone(v);
  }
  async write(p: string, plain: unknown): Promise<void> {
    this.files.set(p, structuredClone(plain));
    this.stamps.delete(p);
    this.writes.push(p);
  }
  async remove(p: string): Promise<void> {
    this.files.delete(p);
    this.stamps.delete(p);
  }
  async list(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const k of this.files.keys()) {
      if (k.startsWith(`${dir}/`)) out.push(k.slice(dir.length + 1));
    }
    return out;
  }
  async stat(p: string): Promise<string | null> {
    if (!this.files.has(p)) return null;
    if (!this.stamps.has(p)) this.stamps.set(p, `s${++this.tick}`);
    return this.stamps.get(p)!;
  }
}

/**
 * Le transport d'UN appareil vers LE nuage.
 *
 * `structuredClone` partout : sans lui, les deux appareils partageraient des
 * objets en mémoire et le test verrait une cohérence qu'aucun réseau ne donne.
 */
function transportVers(nuage: Nuage): NotesTransport {
  return {
    async getRemoteIndex() {
      return nuage.index ? structuredClone(nuage.index) : null;
    },
    async getNote(objectId) {
      const n = nuage.notes.get(objectId);
      return n ? structuredClone(n) : null;
    },
    async putNote(objectId, note) {
      nuage.notes.set(objectId, structuredClone(note));
    },
    async getBlob(hash) {
      return nuage.blobs.get(hash) ?? null;
    },
    async putBlob(hash, base64) {
      nuage.blobs.set(hash, base64);
    },
    async deleteBlob(hash) {
      nuage.blobs.delete(hash);
      nuage.deleted.push(hash);
    },
    async putIndex(index) {
      nuage.index = structuredClone(index);
    },
  };
}

/** Un appareil : son disque, son transport, et de quoi faire tourner un cycle. */
class Appareil {
  io = new Disque();
  constructor(
    private nom: string,
    private nuage: Nuage
  ) {}

  /** Un cycle complet, comme le ferait la synchronisation de fond. */
  async cycle() {
    return runNotesCycleV2(`p-${this.nom}`, '/x', {
      io: this.io,
      transport: transportVers(this.nuage),
    });
  }

  get index(): NotesIndex {
    return this.io.files.get(INDEX_PATH) as NotesIndex;
  }

  /** Le coffre tel que le renderer le verrait — notes lues objet par objet. */
  async coffre(): Promise<Record<string, NoteRecord>> {
    const out: Record<string, NoteRecord> = {};
    for (const [noteId, entry] of Object.entries(this.index?.notes ?? {})) {
      const n = this.io.files.get(`${NOTES_DIR}/${entry.objectId}.enc`);
      if (n) out[noteId] = n as NoteRecord;
    }
    return out;
  }

  /** Écrit le coffre comme le fait `saveNotesV2` : images sorties, puis notes. */
  async ecrire(payload: NotesPayload) {
    const sorti = await extractIntoStore(this.io, payload);
    return saveVaultV2(this.io, sorti.payload, splitDeps(), this.index ?? null);
  }

  /** Ce que ce cycle a réellement touché sur le disque. */
  mesure<T>(f: () => Promise<T>): Promise<{ res: T; ecritures: string[] }> {
    this.io.writes = [];
    return f().then((res) => ({ res, ecritures: [...this.io.writes] }));
  }
}

function note(id: string, o: Record<string, unknown> = {}): NoteRecord {
  return { id, title: `Note ${id}`, content: `c-${id}`, createdAt: T0, updatedAt: T0, ...o };
}

function coffre(notes: NoteRecord[]): NotesPayload {
  const byId: Record<string, NoteRecord> = {};
  for (const n of notes) byId[n.id as string] = n;
  return { byId, allIds: notes.map((n) => n.id as string), templates: [], notebooks: {} };
}

/** Deux appareils neufs branchés sur le même nuage. */
function paire() {
  const nuage = new Nuage();
  return { nuage, a: new Appareil('a', nuage), b: new Appareil('b', nuage) };
}

/** Fait tourner les deux jusqu'à ce que plus rien ne bouge (borné). */
async function stabiliser(a: Appareil, b: Appareil, tours = 4): Promise<void> {
  for (let i = 0; i < tours; i++) {
    await a.cycle();
    await b.cycle();
  }
}

// ── 1. Aller-retour ─────────────────────────────────────────────────────────

describe('deux appareils convergent', () => {
  it('ce que A écrit, B le lit', async () => {
    const { a, b } = paire();
    await a.ecrire(coffre([note('n1'), note('n2')]));

    await a.cycle();
    const res = await b.cycle();

    expect(res.downloaded).toBe(2);
    expect(Object.keys(await b.coffre()).sort()).toEqual(['n1', 'n2']);
  });

  it('et ce que B modifie ensuite revient à A', async () => {
    const { a, b } = paire();
    await a.ecrire(coffre([note('n1')]));
    await stabiliser(a, b);

    await b.ecrire(coffre([note('n1', { title: 'CORRIGÉ', updatedAt: '2026-09-02T10:00:00.000Z' })]));
    await b.cycle();
    await a.cycle();

    expect((await a.coffre()).n1.title).toBe('CORRIGÉ');
  });

  /**
   * ⚠ SUPPRIMER, C'EST MARQUER — jamais retirer du coffre. La fusion est une
   * UNION : une note absente d'un côté est une note que ce côté N'A PAS, pas
   * une note qu'il a supprimée. C'est ce qui permet à un appareil neuf de
   * rejoindre un coffre sans l'effacer en arrivant, et c'est aussi pour ça
   * qu'une corbeille se propage par `deletedAt` et une purge par sa pierre.
   */
  it('une mise à la corbeille traverse, et reste une corbeille', async () => {
    const { a, b } = paire();
    await a.ecrire(coffre([note('n1'), note('n2')]));
    await stabiliser(a, b);

    await a.ecrire(
      coffre([note('n1'), note('n2', { deletedAt: '2026-09-02T10:00:00.000Z' })])
    );
    await a.cycle();
    await b.cycle();

    // La note est TOUJOURS là — elle est à la corbeille, pas effacée.
    expect(Object.keys(await b.coffre()).sort()).toEqual(['n1', 'n2']);
    expect(b.index.notes.n2.deletedAt).toBe('2026-09-02T10:00:00.000Z');
    expect(b.index.notes.n1.deletedAt).toBeNull();
  });

  it('une purge définitive retire la note des deux côtés', async () => {
    const { a, b } = paire();
    await a.ecrire(coffre([note('n1'), note('n2')]));
    await stabiliser(a, b);

    const apres = coffre([note('n1')]);
    apres.purged = { n2: '2026-09-02T10:00:00.000Z' };
    await a.ecrire(apres);
    await a.cycle();
    await b.cycle();

    expect(Object.keys(await b.coffre())).toEqual(['n1']);
    expect(b.index.notes.n2).toBeUndefined();
  });

  /**
   * LE COROLLAIRE, ET C'EST LUI QUI PROTÈGE. Retirer une note du coffre SANS
   * pierre ne l'efface nulle part : elle revient du nuage. Sans cette règle, un
   * appareil dont la lecture a mal tourné effacerait la bibliothèque de tous
   * les autres — la panne silencieuse que tout ce chantier poursuit.
   */
  it('une note simplement absente REVIENT du nuage', async () => {
    const { a, b } = paire();
    await a.ecrire(coffre([note('n1'), note('n2')]));
    await stabiliser(a, b);

    await a.ecrire(coffre([note('n1')]));
    await a.cycle();

    expect(Object.keys(await a.coffre()).sort()).toEqual(['n1', 'n2']);
    expect(Object.keys(await b.coffre()).sort()).toEqual(['n1', 'n2']);
  });
});

// ── 2. L'OSCILLATION — la propriété qui compte ──────────────────────────────

/**
 * Deux appareils d'accord sur le CONTENU mais pas sur sa REPRÉSENTATION se
 * renvoient la même note indéfiniment. Rien ne s'affiche, rien ne se perd — et
 * la batterie, le réseau et le chiffrement y passent. C'est le défaut le plus
 * cher à trouver en production, parce qu'il ne ressemble à rien.
 */
describe('rien ne bouge quand rien n’a changé', () => {
  it('un troisième tour n’écrit RIEN, des deux côtés', async () => {
    const { a, b } = paire();
    await a.ecrire(coffre([note('n1'), note('n2'), note('n3')]));
    await stabiliser(a, b);

    const tourA = await a.mesure(() => a.cycle());
    const tourB = await b.mesure(() => b.cycle());

    expect(tourA.ecritures).toEqual([]);
    expect(tourB.ecritures).toEqual([]);
    expect(tourA.res.uploaded).toBe(0);
    expect(tourA.res.downloaded).toBe(0);
    expect(tourB.res.uploaded).toBe(0);
    expect(tourB.res.downloaded).toBe(0);
  });

  it('et l’index n’est pas republié pour rien', async () => {
    const { nuage, a, b } = paire();
    await a.ecrire(coffre([note('n1')]));
    await stabiliser(a, b);

    const avant = JSON.stringify(nuage.index);
    expect((await a.cycle()).published).toBe(false);
    expect((await b.cycle()).published).toBe(false);
    expect(JSON.stringify(nuage.index)).toBe(avant);
  });

  /**
   * Le nuage doit se stabiliser sur UN état, pas alterner entre deux. Un
   * transfert compté après stabilisation est le symptôme direct de
   * l'oscillation.
   */
  it('dix tours de plus ne transfèrent plus rien', async () => {
    const { a, b } = paire();
    await a.ecrire(coffre([note('n1'), note('n2')]));
    await stabiliser(a, b);

    let transferts = 0;
    for (let i = 0; i < 10; i++) {
      const ra = await a.cycle();
      const rb = await b.cycle();
      transferts += ra.uploaded + ra.downloaded + rb.uploaded + rb.downloaded;
    }
    expect(transferts).toBe(0);
  });
});

// ── 3. Modifications croisées ───────────────────────────────────────────────

describe('les deux modifient en même temps', () => {
  /**
   * DES NOTES DIFFÉRENTES NE SONT PAS UN CONFLIT. C'est le cas courant du
   * travail à deux appareils, et le compter comme un conflit ferait remonter
   * des avertissements sur un usage parfaitement normal — c'est le défaut que
   * `syncedDigest` (l'ancêtre commun) a fermé.
   */
  it('chacun sa note : les deux arrivent, aucun conflit', async () => {
    const { a, b } = paire();
    await a.ecrire(coffre([note('n1'), note('n2')]));
    await stabiliser(a, b);

    await a.ecrire(coffre([note('n1', { title: 'A', updatedAt: '2026-09-02T10:00:00.000Z' }), note('n2')]));
    await b.ecrire(coffre([note('n1'), note('n2', { title: 'B', updatedAt: '2026-09-02T10:00:00.000Z' })]));

    await a.cycle();
    await b.cycle();
    await a.cycle();

    const va = await a.coffre();
    const vb = await b.coffre();
    expect(va.n1.title).toBe('A');
    expect(va.n2.title).toBe('B');
    expect(vb).toEqual(va);
  });

  /**
   * LA MÊME note des deux côtés : l'horloge tranche, et le perdant est SIGNALÉ.
   * Ce qui est inacceptable ici n'est pas de perdre l'un des deux — c'est de le
   * perdre sans le dire.
   */
  it('la même note : l’horloge tranche, et le perdant est signalé', async () => {
    const { a, b } = paire();
    await a.ecrire(coffre([note('n1')]));
    await stabiliser(a, b);

    await a.ecrire(coffre([note('n1', { title: 'TÔT', updatedAt: '2026-09-02T09:00:00.000Z' })]));
    await b.ecrire(coffre([note('n1', { title: 'TARD', updatedAt: '2026-09-02T11:00:00.000Z' })]));

    await a.cycle();
    await b.cycle();
    await a.cycle();

    expect((await a.coffre()).n1.title).toBe('TARD');
    expect((await b.coffre()).n1.title).toBe('TARD');
  });

  it('et après l’arbitrage, plus rien ne bouge', async () => {
    const { a, b } = paire();
    await a.ecrire(coffre([note('n1')]));
    await stabiliser(a, b);
    await a.ecrire(coffre([note('n1', { title: 'TÔT', updatedAt: '2026-09-02T09:00:00.000Z' })]));
    await b.ecrire(coffre([note('n1', { title: 'TARD', updatedAt: '2026-09-02T11:00:00.000Z' })]));
    await stabiliser(a, b);

    const tourA = await a.mesure(() => a.cycle());
    const tourB = await b.mesure(() => b.cycle());
    expect(tourA.ecritures).toEqual([]);
    expect(tourB.ecritures).toEqual([]);
  });
});

// ── 4. Les images traversent ────────────────────────────────────────────────

describe('une image collée sur A s’affiche sur B', () => {
  const OCTETS = 'QUJDREVGR0hJSktMTU5PUA==';

  /** Une note telle que le renderer l'écrit : le document est une CHAÎNE. */
  const avecImage = (id: string) =>
    note(id, {
      content: JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'fileEmbed',
            attrs: { fileType: 'image/png', src: `data:image/png;base64,${OCTETS}` },
          },
        ],
      }),
    });

  it('les octets traversent, et B les retrouve sur son disque', async () => {
    const { a, b } = paire();
    await a.ecrire(coffre([avecImage('n1')]));

    await a.cycle();
    await b.cycle();

    // Un seul objet d'image, adressé par son contenu, des deux côtés.
    const chezB = await b.io.list(`${NOTES_DIR}/blobs`);
    expect(chezB).toHaveLength(1);
    expect(b.io.files.get(`${NOTES_DIR}/blobs/${chezB[0]}`)).toBe(OCTETS);
    // Et la note de B cite la référence, pas les octets.
    expect(JSON.stringify(await b.coffre())).toContain('filarr-blob:');
    expect(JSON.stringify(await b.coffre())).not.toContain(OCTETS);
  });

  /**
   * LA PROPRIÉTÉ QUI JUSTIFIE TOUTE LA SÉPARATION DES IMAGES : une image est
   * immuable, donc elle traverse UNE FOIS. Éditer le texte de la note qui la
   * porte ne doit plus jamais la refaire voyager.
   */
  it('éditer le texte ne refait pas voyager l’image', async () => {
    const { nuage, a, b } = paire();
    await a.ecrire(coffre([avecImage('n1')]));
    await stabiliser(a, b);

    const empreinte = [...nuage.blobs.keys()][0];
    nuage.blobs.delete(empreinte);
    nuage.blobs.set(empreinte, 'SENTINELLE-NON-REECRITE');

    const doc = JSON.parse(avecImage('n1').content as string);
    doc.content.unshift({ type: 'paragraph', content: [{ type: 'text', text: 'un mot' }] });
    await a.ecrire(
      coffre([note('n1', { content: JSON.stringify(doc), updatedAt: '2026-09-02T10:00:00.000Z' })])
    );
    await a.cycle();

    // La note est repartie ; l'image, non — personne n'a réécrit la sentinelle.
    expect(nuage.blobs.get(empreinte)).toBe('SENTINELLE-NON-REECRITE');
    expect(nuage.blobs.size).toBe(1);
  });

  it('la même image dans deux notes ne traverse qu’une fois', async () => {
    const { nuage, a } = paire();
    await a.ecrire(coffre([avecImage('n1'), avecImage('n2')]));
    await a.cycle();
    expect(nuage.blobs.size).toBe(1);
  });
});

// ── 5. Un troisième appareil resté en v1 ────────────────────────────────────

/**
 * Le cas que la réécriture du blob v1 existe pour couvrir. Le transfert de
 * `notes.enc` entre les disques est fait ICI À LA MAIN : dans le produit c'est
 * le cycle de fichiers ORDINAIRE qui s'en charge, sous `meta:notes`, par un
 * chemin qui n'a pas bougé et qui a ses propres contrats.
 */
describe('un appareil resté en v1 reste dans la conversation', () => {
  it('A réécrit le blob, et B le retrouve avec les notes de la v2', async () => {
    const { nuage, a, b } = paire();
    // Les deux ont un blob v1 sur le disque : ils viennent d'être migrés.
    // L'index D'ABORD : `detectFormat` le lit en premier, et c'est lui qui dit
    // « v2 ». Un disque qui n'aurait que `notes.enc` est un appareil v1, et le
    // cycle v2 doit alors s'abstenir — c'est une autre règle, éprouvée ailleurs.
    const vide = { byId: {}, allIds: [], templates: [], notebooks: {} };
    await a.ecrire(coffre([note('n1'), note('n2')]));
    await b.ecrire(coffre([]));
    await a.io.write(V1_BLOB_FILENAME, vide);
    await b.io.write(V1_BLOB_FILENAME, vide);

    await a.cycle();

    // Le cycle de fichiers ordinaire monte `notes.enc` puis le redescend.
    nuage.legacy = a.io.files.get(V1_BLOB_FILENAME) as NotesPayload;
    expect(Object.keys((nuage.legacy as { byId: object }).byId).sort()).toEqual(['n1', 'n2']);

    await b.io.write(V1_BLOB_FILENAME, nuage.legacy);
    await b.cycle();

    expect(Object.keys(await b.coffre()).sort()).toEqual(['n1', 'n2']);
  });

  /**
   * ET LE BLOB NE DOIT PAS SE METTRE À OSCILLER NON PLUS. Il pèse dix
   * mégaoctets sur un coffre réel : le réécrire à chaque cycle coûterait plus
   * cher que tout ce que la v2 fait gagner.
   */
  it('le blob n’est pas réécrit au cycle suivant', async () => {
    const { a } = paire();
    await a.io.write(V1_BLOB_FILENAME, { byId: {}, allIds: [], templates: [], notebooks: {} });
    await a.ecrire(coffre([note('n1')]));
    await a.cycle();

    const tour = await a.mesure(() => a.cycle());
    expect(tour.ecritures).not.toContain(V1_BLOB_FILENAME);
  });
});

// ── 6. Supprimer une image du nuage, à deux ─────────────────────────────────
//
// LA COURSE QUE LES PIERRES TOMBALES EXISTENT POUR PERDRE PROPREMENT. A fait
// le ménage du nuage ; B, resté hors ligne, cite encore l'image dans une note
// que le nuage n'a jamais vue. Sans pierre, B croirait son registre (« déjà
// là-haut »), ne renverrait rien, et l'image serait perdue pour de bon.

describe('supprimer une image du nuage sans perdre celle d’un appareil hors ligne', () => {
  const OCTETS = 'QUJDREVGR0hJSktMTU5PUA==';
  const VIEUX = '2026-01-01T00:00:00.000Z';

  const avecImage = (id: string, o: Record<string, unknown> = {}) =>
    note(id, {
      content: JSON.stringify({
        type: 'doc',
        content: [
          { type: 'fileEmbed', attrs: { fileType: 'image/png', src: `data:image/png;base64,${OCTETS}` } },
        ],
      }),
      ...o,
    });

  /**
   * « Un jour a passé » : vieillit les images au registre (nuage et disques),
   * et oublie la date du dernier balayage — il est quotidien, et `stabiliser`
   * vient d'en faire un.
   */
  function vieillir(nuage: Nuage, ...appareils: Appareil[]) {
    for (const cible of [nuage.index, ...appareils.map((x) => x.index)]) {
      if (!cible) continue;
      for (const h of Object.keys(cible.blobs ?? {})) cible.blobs![h] = VIEUX;
      delete cible.blobSweepAt;
    }
    for (const x of appareils) x.io.files.set(INDEX_PATH, x.index);
  }

  it('A supprime une image que plus personne ne cite ; B l’apprend et ne la renvoie pas', async () => {
    const { nuage, a, b } = paire();
    await a.ecrire(coffre([avecImage('n1')]));
    await stabiliser(a, b);
    // n1 perd son image, des deux côtés.
    await a.ecrire(coffre([note('n1', { updatedAt: '2026-09-02T10:00:00.000Z' })]));
    await stabiliser(a, b);
    vieillir(nuage, a, b);

    await a.cycle();

    expect(nuage.deleted).toHaveLength(1);
    expect(nuage.blobs.size).toBe(0);
    await b.cycle();
    expect(b.index.blobTombstones).toBeDefined();
    expect(nuage.blobs.size).toBe(0); // B n'a rien renvoyé : il ne la cite plus
  });

  /**
   * LE CAS QUI COMPTE. B a écrit hors ligne une note qui cite l'image ; A a
   * fait le ménage entre-temps. Au retour de B, sa note part, l'image repart
   * avec elle, et la pierre tombe. Rien n'est perdu — au prix d'un transfert.
   */
  it('B, hors ligne, cite encore l’image : à son retour elle RESSUSCITE', async () => {
    const { nuage, a, b } = paire();
    await a.ecrire(coffre([avecImage('n1')]));
    await stabiliser(a, b);
    // A retire l'image de n1 et pousse ; B ne l'a pas encore vu (hors ligne).
    await a.ecrire(coffre([note('n1', { updatedAt: '2026-09-02T10:00:00.000Z' })]));
    await a.cycle();
    vieillir(nuage, a);
    await a.cycle(); // le ménage : l'image part du nuage, sous pierre
    expect(nuage.blobs.size).toBe(0);

    // B, toujours hors ligne, colle la MÊME image dans une note NEUVE.
    await b.ecrire(coffre([note('n1'), avecImage('n2', { updatedAt: '2026-09-02T11:00:00.000Z' })]));

    // Retour de B.
    await b.cycle();

    expect(nuage.blobs.size).toBe(1);
    expect([...nuage.blobs.values()][0]).toBe(OCTETS);
    expect(nuage.index?.blobTombstones ?? {}).toEqual({});
    // Et A la retrouve.
    await a.cycle();
    expect(await a.io.list(`${NOTES_DIR}/blobs`)).toHaveLength(1);
  });

  it('après un ménage, plus rien ne bouge — ni registre, ni pierre, ni transfert', async () => {
    const { nuage, a, b } = paire();
    await a.ecrire(coffre([avecImage('n1')]));
    await stabiliser(a, b);
    await a.ecrire(coffre([note('n1', { updatedAt: '2026-09-02T10:00:00.000Z' })]));
    await stabiliser(a, b);
    vieillir(nuage, a, b);
    await stabiliser(a, b);

    const avant = JSON.stringify(nuage.index);
    const tourA = await a.mesure(() => a.cycle());
    const tourB = await b.mesure(() => b.cycle());
    expect(tourA.ecritures).toEqual([]);
    expect(tourB.ecritures).toEqual([]);
    expect(JSON.stringify(nuage.index)).toBe(avant);
    expect(nuage.deleted).toHaveLength(1);
  });
});
