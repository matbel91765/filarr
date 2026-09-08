/**
 * CONTRATS DE L'ASSEMBLAGE — la ou les trois couches se rencontrent.
 *
 * Rangement, decision et reseau sont eprouves separement, et c'est bien : une
 * erreur DANS l'une d'elles s'y verra. Mais une erreur DE BRANCHEMENT — lire
 * sous la mauvaise cle, ecrire l'index avant les notes, oublier de signaler au
 * renderer — ne se voit qu'ici, ou tout est relie.
 *
 * Quatre choses :
 *  1. la DORMANCE, qui doit couter une lecture et rien de plus ;
 *  2. l'ordre d'ecriture, encore, mais cette fois de bout en bout ;
 *  3. une note descendue arrive VRAIMENT sur le disque, sous la bonne cle ;
 *  4. un echec ne fait jamais tomber le cycle englobant.
 */

import { describe, expect, it } from 'vitest';

import {
  LEGACY_BLOB_REFRESH_MS,
  legacyBlobAgeMs,
  rememberMissingBlobs,
  runNotesCycleV2,
} from '../notesCycleV2';
import { CLOUD_BLOB_SWEEP_MAX_PER_CYCLE } from '../noteBlobs';
import { saveVaultV2, V1_BLOB_FILENAME, type VaultIO } from '../notesVaultStore';
import {
  NOTES_DIR,
  NOTES_FORMAT_VERSION,
  type NoteRecord,
  type NotesIndex,
  type NotesPayload,
  type SplitDeps,
} from '../notesStoreV2';
import type { NotesTransport } from '../notesSyncV2';

const T0 = '2026-01-01T00:00:00.000Z';
const T2 = '2026-09-01T00:00:00.000Z';
const INDEX_PATH = `${NOTES_DIR}/index.enc`;

class FakeDisk implements VaultIO {
  files = new Map<string, unknown>();
  writes: string[] = [];
  reads: string[] = [];
  failWriteOn: string | null = null;

  async read(p: string): Promise<unknown | null> {
    this.reads.push(p);
    const v = this.files.get(p);
    return v === undefined ? null : structuredClone(v);
  }
  async write(p: string, plain: unknown): Promise<void> {
    if (this.failWriteOn === p) throw new Error('disque plein');
    this.files.set(p, structuredClone(plain));
    this.stamps.delete(p);
    this.writes.push(p);
  }
  async remove(p: string): Promise<void> {
    this.files.delete(p);
  }
  async list(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const k of this.files.keys()) if (k.startsWith(`${dir}/`)) out.push(k.slice(dir.length + 1));
    return out;
  }
  /** Une identite qui change a chaque ecriture, comme le ferait taille+mtime. */
  private tick = 0;
  async stat(p: string): Promise<string | null> {
    if (!this.files.has(p)) return null;
    if (!this.stamps.has(p)) this.stamps.set(p, `s${++this.tick}`);
    return this.stamps.get(p)!;
  }
  stamps = new Map<string, string>();
}

class FakeTransport implements NotesTransport {
  cloudNotes = new Map<string, NoteRecord>();
  publishedIndex: NotesIndex | null = null;
  journal: string[] = [];
  constructor(public remote: NotesIndex | null) {}
  async getRemoteIndex() {
    this.journal.push('getIndex');
    return this.remote;
  }
  async getNote(objectId: string) {
    this.journal.push(`get:${objectId}`);
    return this.cloudNotes.get(objectId) ?? null;
  }
  async putNote(objectId: string, note: NoteRecord) {
    this.journal.push(`put:${objectId}`);
    this.cloudNotes.set(objectId, note);
  }
  async putIndex(index: NotesIndex) {
    this.journal.push('putIndex');
    this.publishedIndex = index;
  }
  cloudBlobs = new Map<string, string>();
  async getBlob(hash: string) {
    return this.cloudBlobs.get(hash) ?? null;
  }
  async putBlob(hash: string, base64: string) {
    this.cloudBlobs.set(hash, base64);
  }
  deleted: string[] = [];
  async deleteBlob(hash: string) {
    this.journal.push(`deleteBlob:${hash}`);
    this.deleted.push(hash);
    this.cloudBlobs.delete(hash);
  }
}

function note(id: string, o: Record<string, unknown> = {}): NoteRecord {
  return { id, title: `Note ${id}`, content: `c-${id}`, createdAt: T0, updatedAt: T0, ...o };
}

function vault(ids: string[]): NotesPayload {
  const byId: Record<string, NoteRecord> = {};
  for (const id of ids) byId[id] = note(id);
  return { byId, allIds: [...ids], templates: [], notebooks: {} };
}

function deps(): SplitDeps {
  let n = 0;
  return { digestOf: (x) => JSON.stringify(x), newObjectId: () => `o${++n}` };
}

/** Un index distant qui porte une note de plus, deja posee dans le nuage. */
function remoteWithExtra(base: NotesIndex, noteId: string, objectId: string): NotesIndex {
  return {
    ...base,
    notes: {
      ...base.notes,
      [noteId]: { objectId, updatedAt: T2, deletedAt: null, digest: `d-${noteId}` },
    },
    allIds: [...base.allIds, noteId],
  };
}

// ── 1. Dormance ─────────────────────────────────────────────────────────────

describe('dormance', () => {
  it('un profil v1 : rien n’est tente, et ca coute une lecture', async () => {
    const io = new FakeDisk();
    await io.write(V1_BLOB_FILENAME, vault(['a']));
    io.reads = [];
    io.writes = [];

    const transport = new FakeTransport(null);
    const res = await runNotesCycleV2('p1', '/x', { io, transport });

    expect(res.ran).toBe(false);
    expect(io.writes).toEqual([]);
    expect(transport.journal).toEqual([]);
    // `detectFormat` lit l'index (absent) puis le blob pour conclure « v1 ».
    expect(io.reads[0]).toBe(INDEX_PATH);
  });

  /**
   * ⚠ UN PROFIL SANS RIEN COÛTE DÉSORMAIS UNE REQUÊTE D'INDEX, et c'est voulu :
   * c'est la seule façon pour un appareil neuf de découvrir qu'un coffre v2
   * l'attend là-haut. Ce test affirmait « aucun trafic », ce qui décrivait
   * exactement le défaut — un second appareil qui ne voyait jamais rien.
   *
   * Le coût s'arrête dès qu'une note existe quelque part, et rien n'est écrit
   * quand le nuage n'a pas de v2 non plus.
   */
  it('un profil neuf, sans rien : une question au nuage, et rien d’écrit', async () => {
    const io = new FakeDisk();
    const transport = new FakeTransport(null);
    expect((await runNotesCycleV2('p1', '/x', { io, transport })).ran).toBe(false);
    expect(transport.journal).toEqual(['getIndex']);
    expect(io.writes).toEqual([]);
  });
});

// ── 2 & 3. Le cycle reel ────────────────────────────────────────────────────

describe('cycle v2 de bout en bout', () => {
  it('descend une note du nuage et la POSE sur le disque, sous la cle du nuage', async () => {
    const io = new FakeDisk();
    const d = deps();
    const local = await saveVaultV2(io, vault(['a']), d);

    const transport = new FakeTransport(remoteWithExtra(local.index, 'b', 'cle-nuage'));
    transport.cloudNotes.set('cle-nuage', note('b', { title: 'venue du nuage' }));
    io.writes = [];

    const res = await runNotesCycleV2('p1', '/x', { io, transport });

    expect(res.ran).toBe(true);
    expect(res.downloaded).toBe(1);
    expect(res.contentChanged).toBe(true);
    // La note est bien la, sous la cle que le NUAGE designait.
    expect(io.files.get(`${NOTES_DIR}/cle-nuage.enc`)).toMatchObject({ title: 'venue du nuage' });
    // Et l'index local la connait desormais.
    const index = io.files.get(INDEX_PATH) as NotesIndex;
    expect(index.notes.b.objectId).toBe('cle-nuage');
  });

  it('ecrit la note AVANT l’index, de bout en bout', async () => {
    const io = new FakeDisk();
    const d = deps();
    const local = await saveVaultV2(io, vault(['a']), d);
    const transport = new FakeTransport(remoteWithExtra(local.index, 'b', 'cle-nuage'));
    transport.cloudNotes.set('cle-nuage', note('b'));
    io.writes = [];

    await runNotesCycleV2('p1', '/x', { io, transport });

    /**
     * ON ASSERVIT LA PROPRIÉTÉ, PAS LA SÉQUENCE EXACTE.
     *
     * Ce test comparait la liste d'écritures à un tableau littéral. Le ménage
     * des images l'a fait tomber en écrivant l'index une SECONDE fois pour
     * dater son passage — alors que la garantie qu'il porte (« aucune note
     * n'est écrite après l'index qui la cite ») tenait toujours.
     *
     * Un test qui fige plus que ce qu'il garde fait échouer du code correct, et
     * on finit par le corriger en regardant ailleurs.
     */
    const premierIndex = io.writes.indexOf(INDEX_PATH);
    expect(premierIndex).toBeGreaterThan(-1);
    for (const [i, chemin] of io.writes.entries()) {
      if (chemin !== INDEX_PATH) expect(i).toBeLessThan(premierIndex);
    }
  });

  it('remonte ce que le nuage n’a pas, et publie ensuite', async () => {
    const io = new FakeDisk();
    const d = deps();
    await saveVaultV2(io, vault(['a', 'b']), d);
    const transport = new FakeTransport(null);

    const res = await runNotesCycleV2('p1', '/x', { io, transport });

    expect(res.uploaded).toBe(2);
    expect(res.published).toBe(true);
    expect(transport.journal[transport.journal.length - 1]).toBe('putIndex');
    expect(transport.cloudNotes.size).toBe(2);
  });

  it('rien a faire : aucune ecriture, aucune publication', async () => {
    const io = new FakeDisk();
    const d = deps();
    const local = await saveVaultV2(io, vault(['a']), d);
    // Le nuage porte exactement le meme etat.
    const transport = new FakeTransport(local.index);

    // Premier cycle : il apprend l'ancetre commun, donc reecrit l'index local.
    await runNotesCycleV2('p1', '/x', { io, transport });
    io.writes = [];
    transport.journal = [];

    // Second : plus rien du tout.
    const res = await runNotesCycleV2('p1', '/x', {
      io,
      transport: new FakeTransport(io.files.get(INDEX_PATH) as NotesIndex),
    });
    expect(res.downloaded).toBe(0);
    expect(res.uploaded).toBe(0);
    expect(io.writes).toEqual([]);
  });
});

// ── 4. Les echecs ne renversent rien ────────────────────────────────────────

describe('un echec ne fait jamais tomber le cycle englobant', () => {
  it('un transport qui jette est absorbe, pas propage', async () => {
    const io = new FakeDisk();
    await saveVaultV2(io, vault(['a']), deps());
    const casse: NotesTransport = {
      getRemoteIndex: async () => {
        throw new Error('reseau mort');
      },
      getNote: async () => null,
      putNote: async () => {},
      putIndex: async () => {},
      getBlob: async () => null,
      putBlob: async () => {},
      deleteBlob: async () => {},
    };

    const res = await runNotesCycleV2('p1', '/x', { io, transport: casse });
    expect(res.ran).toBe(true);
    expect(res.failures).toBe(1);
    expect(res.contentChanged).toBe(false);
  });

  /**
   * Une note descendue qu'on ne sait pas ECRIRE ne doit pas etre citee comme
   * detenue : sinon l'index promettrait un objet absent du disque, et la
   * prochaine lecture la verrait « manquante » — un trou qu'une sauvegarde
   * propagerait comme une suppression.
   */
  it('une note descendue mais non ecrite n’entre pas dans l’index', async () => {
    const io = new FakeDisk();
    const d = deps();
    const local = await saveVaultV2(io, vault(['a']), d);
    const transport = new FakeTransport(remoteWithExtra(local.index, 'b', 'cle-nuage'));
    transport.cloudNotes.set('cle-nuage', note('b'));
    io.failWriteOn = `${NOTES_DIR}/cle-nuage.enc`;

    const res = await runNotesCycleV2('p1', '/x', { io, transport });

    expect(res.downloaded).toBe(0);
    const index = io.files.get(INDEX_PATH) as NotesIndex;
    expect(index.notes.b).toBeUndefined();
  });

  it('un index local non ecrit est signale, et le disque reste coherent', async () => {
    const io = new FakeDisk();
    const d = deps();
    const local = await saveVaultV2(io, vault(['a']), d);
    const avant = structuredClone(io.files.get(INDEX_PATH));
    const transport = new FakeTransport(remoteWithExtra(local.index, 'b', 'cle-nuage'));
    transport.cloudNotes.set('cle-nuage', note('b'));
    io.failWriteOn = INDEX_PATH;

    const res = await runNotesCycleV2('p1', '/x', { io, transport });

    expect(res.failures).toBeGreaterThan(0);
    // L'index sur le disque n'a pas bouge : l'ancien etat, coherent.
    expect(io.files.get(INDEX_PATH)).toEqual(avant);
  });
});

// ── 5. La réécriture du blob v1 ─────────────────────────────────────────────
//
// La réinjection (plus haut dans le cycle) ne va que dans UN SENS : elle lit ce
// qu'un appareil resté en v1 a écrit. L'inverse manquait, et une note créée en
// v2 n'atteignait jamais ce vieil appareil — qui affichait un coffre figé au
// jour de la migration, sans la moindre erreur.

describe('le vieil appareil voit ce qu’on écrit', () => {
  /** Un cycle sur un profil v2 qui porte AUSSI un blob v1, comme après migration. */
  async function profilMixte(notes: string[]) {
    const io = new FakeDisk();
    const local = await saveVaultV2(io, vault(notes), deps());
    // Le blob v1 existe : un appareil est resté dessus.
    await io.write(V1_BLOB_FILENAME, { byId: {}, allIds: [], templates: [], notebooks: {} });
    return { io, local };
  }

  it('réécrit le blob avec les notes de la v2', async () => {
    const { io } = await profilMixte(['a', 'b']);
    await runNotesCycleV2('p1', '/x', { io, transport: new FakeTransport(null) });

    const blob = io.files.get(V1_BLOB_FILENAME) as { byId: Record<string, unknown> };
    expect(Object.keys(blob.byId).sort()).toEqual(['a', 'b']);
  });

  /**
   * SANS CE SECOND GESTE, LE CYCLE SUIVANT PAIE DIX MÉGAOCTETS. Réécrire le
   * blob le fait « bouger » ; si on ne notait pas sa nouvelle identité, la
   * réinjection le relirait entièrement pour se découvrir d'accord avec
   * elle-même — à chaque cycle, indéfiniment.
   */
  it('ne réécrit rien au cycle suivant, et ne relit pas le blob', async () => {
    const { io } = await profilMixte(['a']);
    await runNotesCycleV2('p1', '/x', { io, transport: new FakeTransport(null) });

    io.writes = [];
    io.reads = [];
    await runNotesCycleV2('p1', '/x', {
      io,
      transport: new FakeTransport(io.files.get(INDEX_PATH) as NotesIndex),
    });

    expect(io.writes).not.toContain(V1_BLOB_FILENAME);
    expect(io.reads).not.toContain(V1_BLOB_FILENAME);
  });

  /**
   * LE REFUS QUI COMPTE. Un blob amputé d'une note serait lu comme une
   * SUPPRESSION par le vieil appareil, qui la propagerait au nuage. Un échec de
   * lecture deviendrait une perte définitive.
   */
  it('REFUSE de réécrire quand une note est illisible', async () => {
    const { io, local } = await profilMixte(['a', 'b']);
    const avant = structuredClone(io.files.get(V1_BLOB_FILENAME));
    io.files.delete(`${NOTES_DIR}/${local.index.notes.b.objectId}.enc`);

    await runNotesCycleV2('p1', '/x', { io, transport: new FakeTransport(null) });

    expect(io.files.get(V1_BLOB_FILENAME)).toEqual(avant);
  });

  /**
   * ⚠ LE BLOB RÉÉCRIT DOIT PARTIR, ET RIEN NE LE FAISAIT PARTIR.
   *
   * La réécriture a lieu à l'étape 6 bis du cycle de synchronisation, donc
   * APRÈS `scanLocalFiles` (qui a relevé l'ancienne empreinte) et APRÈS la
   * phase de remontée : ce cycle-ci ne peut plus rien en faire. Sans un signal
   * explicite, le fichier frais attendait qu'un événement sans rapport
   * déclenche un autre cycle — sur une machine tranquille, jamais — et le
   * vieil appareil continuait d'afficher un coffre figé.
   *
   * `syncService` lit ce drapeau et appelle `notifyMetadataChanged(…, 'notes')`,
   * qui pose l'accusé et arme le cycle suivant.
   */
  it('DIT qu’il a réécrit le blob, pour que meta:notes reparte', async () => {
    const { io } = await profilMixte(['a', 'b']);
    const res = await runNotesCycleV2('p1', '/x', { io, transport: new FakeTransport(null) });

    expect(io.writes).toContain(V1_BLOB_FILENAME);
    expect(res.legacyBlobRewritten).toBe(true);
  });

  it('ne le dit PAS quand rien n’a été réécrit', async () => {
    const { io } = await profilMixte(['a']);
    await runNotesCycleV2('p1', '/x', { io, transport: new FakeTransport(null) });

    const second = await runNotesCycleV2('p1', '/x', {
      io,
      transport: new FakeTransport(io.files.get(INDEX_PATH) as NotesIndex),
    });
    expect(second.legacyBlobRewritten).toBe(false);
  });

  it('ne le dit pas non plus quand la réécriture est REFUSÉE', async () => {
    const { io, local } = await profilMixte(['a', 'b']);
    io.files.delete(`${NOTES_DIR}/${local.index.notes.b.objectId}.enc`);

    const res = await runNotesCycleV2('p1', '/x', { io, transport: new FakeTransport(null) });
    expect(res.legacyBlobRewritten).toBe(false);
  });

  /** On ne RESSUSCITE pas la v1 : un profil sans blob n'en voit pas apparaître un. */
  it('n’en fabrique pas un quand il n’y en a pas', async () => {
    const io = new FakeDisk();
    await saveVaultV2(io, vault(['a']), deps());
    await runNotesCycleV2('p1', '/x', { io, transport: new FakeTransport(null) });
    expect(io.files.has(V1_BLOB_FILENAME)).toBe(false);
  });

  /**
   * Un appareil en v1 ne sait pas résoudre `filarr-blob:` : il afficherait des
   * images cassées, et les renverrait telles quelles.
   */
  it('remet les images dans les notes avant d’écrire', async () => {
    const io = new FakeDisk();
    const d = deps();
    const OCTETS = 'AAAABBBBCCCC';
    const empreinte = 'ab'.repeat(8);
    const avecImage = {
      ...vault([]),
      byId: {
        a: {
          id: 'a',
          createdAt: T0,
          updatedAt: T0,
          // La forme RÉELLE : le document est une chaîne (`src/types/notes.ts`).
          content: JSON.stringify({
            type: 'doc',
            content: [
              {
                type: 'fileEmbed',
                attrs: { src: `filarr-blob:${empreinte}`, fileType: 'image/png' },
              },
            ],
          }),
        },
      },
      allIds: ['a'],
    };
    await saveVaultV2(io, avecImage, d);
    await io.write(`${NOTES_DIR}/blobs/${empreinte}.enc`, OCTETS);
    await io.write(V1_BLOB_FILENAME, { byId: {}, allIds: [], templates: [], notebooks: {} });

    await runNotesCycleV2('p1', '/x', { io, transport: new FakeTransport(null) });

    const blob = JSON.stringify(io.files.get(V1_BLOB_FILENAME));
    expect(blob).toContain(`data:image/png;base64,${OCTETS}`);
    expect(blob).not.toContain('filarr-blob:');
  });

  /** Une note créée en v2 doit arriver jusqu'au vieil appareil, pas seulement au nuage. */
  it('une note descendue du nuage entre dans le blob v1', async () => {
    const { io, local } = await profilMixte(['a']);
    const transport = new FakeTransport(remoteWithExtra(local.index, 'b', 'cle-nuage'));
    transport.cloudNotes.set('cle-nuage', note('b', { title: 'venue du nuage' }));

    await runNotesCycleV2('p1', '/x', { io, transport });

    const blob = io.files.get(V1_BLOB_FILENAME) as { byId: Record<string, { title?: string }> };
    expect(blob.byId.b?.title).toBe('venue du nuage');
  });
});

// ── 6. Un appareil neuf rejoint un coffre déjà rangé ────────────────────────
//
// ⚠ SANS ÇA, UN SECOND APPAREIL NE VOYAIT JAMAIS RIEN. Le cycle sortait sur
// « ce disque n'est pas en v2 » — vrai d'une installation neuve, d'une nouvelle
// connexion, d'un profil qu'on vient d'ajouter. Le nuage portait le coffre
// entier, l'appareil restait vide, et rien ne s'affichait nulle part.

describe('adoption d’un coffre v2 par un appareil neuf', () => {
  it('un disque vide + un nuage en v2 = tout descend', async () => {
    const source = new FakeDisk();
    const local = await saveVaultV2(source, vault(['a', 'b']), deps());
    const nuage = new FakeTransport(local.index);
    for (const [id, e] of Object.entries(local.index.notes)) {
      nuage.cloudNotes.set(e.objectId, source.files.get(`${NOTES_DIR}/${e.objectId}.enc`) as never);
      void id;
    }

    const neuf = new FakeDisk();
    const res = await runNotesCycleV2('p1', '/x', { io: neuf, transport: nuage });

    expect(res.ran).toBe(true);
    expect(res.downloaded).toBe(2);
    expect(Object.keys((neuf.files.get(INDEX_PATH) as NotesIndex).notes).sort()).toEqual(['a', 'b']);
  });

  /**
   * UN COFFRE v1 LOCAL NE BASCULE PAS TOUT SEUL. La migration réécrit le
   * rangement complet et se refuse tant qu'un autre appareil écrit en v1 :
   * c'est une décision prise dans les réglages, pas l'effet de bord d'un cycle.
   */
  it('mais un disque en v1 n’adopte RIEN', async () => {
    const io = new FakeDisk();
    await io.write(V1_BLOB_FILENAME, vault(['x']));
    io.writes = [];

    const res = await runNotesCycleV2('p1', '/x', {
      io,
      transport: new FakeTransport({
        version: 2,
        notes: {},
        allIds: [],
        notebooks: {},
        templates: [],
        purged: {},
        purgedNotebooks: {},
      }),
    });

    expect(res.ran).toBe(false);
    expect(io.writes).toEqual([]);
  });

  it('et un nuage sans v2 ne fait rien apparaître', async () => {
    const io = new FakeDisk();
    const res = await runNotesCycleV2('p1', '/x', { io, transport: new FakeTransport(null) });
    expect(res.ran).toBe(false);
    expect(io.writes).toEqual([]);
  });
});

// ── 7. Les clés d'objet qui changent ────────────────────────────────────────

describe('une note dont la clé d’objet change', () => {
  /**
   * Deux appareils ont indexé la même note sans se voir : chacun a minté sa
   * clé, celle du NUAGE fait foi. Sans déplacement, l'index cite une clé sous
   * laquelle ce disque n'a rien, le contenu dort sous l'ancienne — que plus
   * rien ne réclame — et le ménage des orphelins l'efface. Zéro erreur
   * affichée.
   */
  it('déplace le contenu sous la clé du nuage, et retire l’ancien objet', async () => {
    const io = new FakeDisk();
    const d = deps();
    const local = await saveVaultV2(io, vault(['a']), d);
    const mienne = local.index.notes.a.objectId;
    const contenu = io.files.get(`${NOTES_DIR}/${mienne}.enc`);

    // Le nuage porte la MÊME note (même empreinte) sous une AUTRE clé.
    const distant: NotesIndex = {
      ...local.index,
      notes: { a: { ...local.index.notes.a, objectId: 'cle-du-nuage' } },
    };
    const transport = new FakeTransport(distant);
    transport.cloudNotes.set('cle-du-nuage', contenu as never);

    await runNotesCycleV2('p1', '/x', { io, transport });

    expect(io.files.get(`${NOTES_DIR}/cle-du-nuage.enc`)).toEqual(contenu);
    expect(io.files.has(`${NOTES_DIR}/${mienne}.enc`)).toBe(false);
    expect((io.files.get(INDEX_PATH) as NotesIndex).notes.a.objectId).toBe('cle-du-nuage');
  });

  /**
   * Si le contenu est introuvable, on RETIRE l'entrée plutôt que de promettre
   * un objet absent : le cycle suivant verra « le nuage l'a, pas moi » et la
   * redemandera. Promettre l'objet, c'est laisser `loadVaultV2` la compter
   * manquante et bloquer toute écriture du coffre.
   */
  it('retire l’entrée quand le contenu est introuvable, au lieu de mentir', async () => {
    const io = new FakeDisk();
    const d = deps();
    const local = await saveVaultV2(io, vault(['a']), d);
    io.files.delete(`${NOTES_DIR}/${local.index.notes.a.objectId}.enc`);

    const distant: NotesIndex = {
      ...local.index,
      notes: { a: { ...local.index.notes.a, objectId: 'cle-du-nuage' } },
    };
    const transport = new FakeTransport(distant);

    await runNotesCycleV2('p1', '/x', { io, transport });

    expect((io.files.get(INDEX_PATH) as NotesIndex).notes.a).toBeUndefined();
  });
});

// ── 8. Le ménage des images DANS LE NUAGE ───────────────────────────────────
//
// Jusqu'ici une image supprimée avec sa note restait dans R2 pour toujours, et
// comptait contre le quota. Supprimer là-haut engage tous les appareils : les
// contrats ci-dessous portent d'abord sur l'ORDRE (la pierre avant les octets)
// et sur les refus.

describe('ménage des images dans le nuage', () => {
  const HASH = 'ab'.repeat(8);
  const VIEUX = '2026-01-01T00:00:00.000Z'; // bien au-delà du délai de grâce
  const HIER = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

  /** Un profil v2 dont le registre connaît une image que plus aucune note ne cite. */
  async function orpheline(vuLe: string) {
    const io = new FakeDisk();
    const local = await saveVaultV2(io, vault(['a']), deps());
    const index: NotesIndex = { ...local.index, blobs: { [HASH]: vuLe } };
    await io.write(INDEX_PATH, index);
    const transport = new FakeTransport(index);
    transport.cloudBlobs.set(HASH, 'OCTETS');
    return { io, transport };
  }

  it('supprime du nuage une image vieille que personne ne cite, sous pierre', async () => {
    const { io, transport } = await orpheline(VIEUX);

    await runNotesCycleV2('p1', '/x', { io, transport });

    expect(transport.deleted).toEqual([HASH]);
    expect(transport.cloudBlobs.has(HASH)).toBe(false);
    const publie = transport.publishedIndex!;
    expect(publie.blobs?.[HASH]).toBeUndefined();
    expect(publie.blobTombstones?.[HASH]).toBeDefined();
    const disque = io.files.get(INDEX_PATH) as NotesIndex;
    expect(disque.blobTombstones?.[HASH]).toBeDefined();
  });

  /**
   * LA PIERRE AVANT LES OCTETS. Dans l'autre sens, une coupure entre les deux
   * laisserait un registre qui promet une image que R2 n'a plus — et aucun
   * appareil ne la renverrait jamais, puisque le registre dit « déjà là-haut ».
   */
  it('skipBlobSweep : rien n est balaye ce cycle, meme du — le menage attend le cycle suivant', async () => {
    const { io, transport } = await orpheline(VIEUX);
    await runNotesCycleV2('p1', '/x', { io, transport, skipBlobSweep: true });
    expect(transport.deleted).toEqual([]);
    expect(transport.cloudBlobs.has(HASH)).toBe(true);
    expect((io.files.get(INDEX_PATH) as NotesIndex).blobSweepAt).toBeUndefined();
    // Le cycle suivant, sans le drapeau, fait le menage normalement.
    await runNotesCycleV2('p1', '/x', { io, transport });
    expect(transport.deleted).toEqual([HASH]);
  });

  it('publie la pierre AVANT de supprimer les octets', async () => {
    const { io, transport } = await orpheline(VIEUX);
    await runNotesCycleV2('p1', '/x', { io, transport });
    const iPierre = transport.journal.lastIndexOf('putIndex');
    const iOctets = transport.journal.indexOf(`deleteBlob:${HASH}`);
    expect(iPierre).toBeGreaterThan(-1);
    expect(iOctets).toBeGreaterThan(iPierre);
  });

  it('protège une image récente, même orpheline', async () => {
    const { io, transport } = await orpheline(HIER);
    await runNotesCycleV2('p1', '/x', { io, transport });
    expect(transport.deleted).toEqual([]);
    expect(transport.cloudBlobs.has(HASH)).toBe(true);
  });

  it('ne touche à rien si un transfert a échoué', async () => {
    const { io, transport } = await orpheline(VIEUX);
    // Une note distante illisible : le cycle compte un échec.
    transport.remote = {
      ...(transport.remote as NotesIndex),
      notes: {
        ...(transport.remote as NotesIndex).notes,
        b: { objectId: 'absent', updatedAt: T2, deletedAt: null, digest: 'd-b' },
      },
      allIds: ['a', 'b'],
    } as NotesIndex;
    await runNotesCycleV2('p1', '/x', { io, transport });
    expect(transport.deleted).toEqual([]);
  });

  it('avance par lots : jamais plus que le plafond par cycle', async () => {
    const io = new FakeDisk();
    const local = await saveVaultV2(io, vault(['a']), deps());
    const blobs: Record<string, string> = {};
    for (let i = 0; i < CLOUD_BLOB_SWEEP_MAX_PER_CYCLE + 5; i++) {
      blobs[i.toString(16).padStart(16, '0')] = VIEUX;
    }
    const index: NotesIndex = { ...local.index, blobs };
    await io.write(INDEX_PATH, index);
    const transport = new FakeTransport(index);

    await runNotesCycleV2('p1', '/x', { io, transport });

    expect(transport.deleted).toHaveLength(CLOUD_BLOB_SWEEP_MAX_PER_CYCLE);
  });

  it('une image citée par une note n’est jamais supprimée, si vieille soit-elle', async () => {
    const io = new FakeDisk();
    const d = deps();
    const avecImage = {
      ...vault([]),
      byId: {
        a: {
          id: 'a',
          createdAt: T0,
          updatedAt: T0,
          content: JSON.stringify({
            type: 'doc',
            content: [{ type: 'fileEmbed', attrs: { src: `filarr-blob:${HASH}` } }],
          }),
        },
      },
      allIds: ['a'],
    };
    const local = await saveVaultV2(io, avecImage, d);
    const index: NotesIndex = { ...local.index, blobs: { [HASH]: VIEUX } };
    await io.write(INDEX_PATH, index);
    const transport = new FakeTransport(index);

    await runNotesCycleV2('p1', '/x', { io, transport });

    expect(transport.deleted).toEqual([]);
  });
});

// ── 6. Le pont v1 se DIFFERE quand plus personne n ecrit en v1 ───────────────
//
// Chaque reecriture de `notes.enc` derive une cle neuve : le chiffre change en
// entier et le cycle suivant le REMONTE — 3,5 Mo par note modifiee, quatre fois
// pour une seule note le 2026-09-05. Mais le pont ne peut pas s eteindre tout a
// fait : l appairage d un telephone neuf s hydrate exclusivement depuis ce blob
// (verifie par la session mobile). Sous verdict `safe`, on ne le rafraichit donc
// qu une fois par heure au plus — au lieu de quatre fois par note.

/** Un disque factice dont `stat` rend `taille:mtimeMs`, comme le vrai. */
class FakeDiskAvecHorloge extends FakeDisk {
  clockMs = 1_757_000_000_000;
  async stat(p: string): Promise<string | null> {
    if (!this.files.has(p)) return null;
    return `${JSON.stringify(this.files.get(p)).length}:${this.clockMs}`;
  }
}

describe("le pont v1 se differe quand plus personne n ecrit en v1", () => {
  async function profilMixte(io: FakeDisk, notes: string[]) {
    const local = await saveVaultV2(io, vault(notes), deps());
    await io.write(V1_BLOB_FILENAME, { byId: {}, allIds: [], templates: [], notebooks: {} });
    return { io, local };
  }

  it("verdict 'safe' + blob FRAIS : le blob n est pas reecrit", async () => {
    const io = new FakeDiskAvecHorloge();
    await profilMixte(io, ['a', 'b']);
    io.writes = [];
    const res = await runNotesCycleV2('p1', '/x', {
      io,
      transport: new FakeTransport(null),
      legacyVerdict: 'safe',
      nowMs: io.clockMs + 5 * 60 * 1000, // cinq minutes apres la derniere ecriture
    });
    // Le cycle v2 a bien tourne — seule la reecriture du blob est differee.
    expect(res.ran).toBe(true);
    expect(io.writes).not.toContain(V1_BLOB_FILENAME);
  });

  it("verdict 'safe' + blob VIEUX d une heure : le blob est rafraichi", async () => {
    // C est ce qui borne l ecart vu par un telephone appaire : une heure au
    // plus, jamais trois semaines.
    const io = new FakeDiskAvecHorloge();
    await profilMixte(io, ['a', 'b']);
    io.writes = [];
    await runNotesCycleV2('p1', '/x', {
      io,
      transport: new FakeTransport(null),
      legacyVerdict: 'safe',
      nowMs: io.clockMs + LEGACY_BLOB_REFRESH_MS + 1,
    });
    expect(io.writes).toContain(V1_BLOB_FILENAME);
    const blob = io.files.get(V1_BLOB_FILENAME) as { byId: Record<string, unknown> };
    expect(Object.keys(blob.byId).sort()).toEqual(['a', 'b']);
  });

  it("verdict 'safe' + age INCONNU : on rafraichit, par prudence", async () => {
    // Le FakeDisk de base rend des identites opaques (`s1`, `s2`...) : l age ne
    // se lit pas. On ne fige jamais un blob dont on ne sait pas la date.
    const io = new FakeDisk();
    await profilMixte(io, ['a']);
    io.writes = [];
    await runNotesCycleV2('p1', '/x', { io, transport: new FakeTransport(null), legacyVerdict: 'safe' });
    expect(io.writes).toContain(V1_BLOB_FILENAME);
  });

  it("verdict 'legacy-active' : le blob est reecrit meme frais", async () => {
    const io = new FakeDiskAvecHorloge();
    await profilMixte(io, ['a', 'b']);
    io.writes = [];
    await runNotesCycleV2('p1', '/x', {
      io,
      transport: new FakeTransport(null),
      legacyVerdict: 'legacy-active',
      nowMs: io.clockMs + 1000,
    });
    expect(io.writes).toContain(V1_BLOB_FILENAME);
  });

  it("sans verdict (= 'unknown') : on garde le pont, par prudence", async () => {
    const io = new FakeDiskAvecHorloge();
    await profilMixte(io, ['a']);
    io.writes = [];
    await runNotesCycleV2('p1', '/x', { io, transport: new FakeTransport(null), nowMs: io.clockMs + 1000 });
    expect(io.writes).toContain(V1_BLOB_FILENAME);
  });

  it("verdict 'safe' : la LECTURE d un blob v1 continue, elle n est jamais differee", async () => {
    // Ce qui rend le differe reversible de lui-meme : si un appareil v1 ecrit
    // `notes.enc`, on le reinjecte quand meme, et son entree distante fait
    // retomber le verdict au cycle suivant.
    const io = new FakeDiskAvecHorloge();
    await profilMixte(io, ['a']);
    await runNotesCycleV2('p1', '/x', { io, transport: new FakeTransport(null), legacyVerdict: 'safe', nowMs: io.clockMs + 1000 });
    await io.write(V1_BLOB_FILENAME, vault(['a', 'z']));
    io.clockMs += 60_000; // le blob a bouge : nouvelle identite
    await runNotesCycleV2('p1', '/x', {
      io,
      transport: new FakeTransport(io.files.get(INDEX_PATH) as NotesIndex),
      legacyVerdict: 'safe',
      nowMs: io.clockMs + 1000,
    });
    const index = io.files.get(INDEX_PATH) as NotesIndex;
    expect(Object.keys(index.notes)).toContain('z');
  });

  it("l age se lit sur `taille:mtimeMs`, et rien d autre", () => {
    const now = 1_757_000_000_000;
    expect(legacyBlobAgeMs(`4096:${now - 60_000}`, now)).toBe(60_000);
    expect(legacyBlobAgeMs('s3', now)).toBeNull();
    expect(legacyBlobAgeMs(null, now)).toBeNull();
    expect(legacyBlobAgeMs('', now)).toBeNull();
    // Une date dans le futur — horloge reculee — n est pas un age : on ne
    // conclut rien, donc on rafraichit.
    expect(legacyBlobAgeMs(`4096:${now + 60_000}`, now)).toBeNull();
  });
});

// ── 7. Images manquantes signalées au chargement ─────────────────────────────
//
// Le cycle ne descend une image qu'avec la note qu'il télécharge lui-même. Une
// note arrivée autrement (réinjection v1, ou descendue quand l'image n'était pas
// encore là-haut) garde une référence vers une image absente du disque — pour
// toujours. Mesuré le 05/09/2026 : 8 images « introuvables » sur la dev, toutes
// présentes dans R2. Le chargement les signale ; le cycle suivant les récupère.

describe('images manquantes signalees au chargement', () => {
  const H1 = 'aa11'.repeat(8);
  const H2 = 'bb22'.repeat(8);

  it('recupere du nuage les images signalees et les ecrit sur le disque', async () => {
    const io = new FakeDisk();
    const local = await saveVaultV2(io, vault(['a']), deps());
    const transport = new FakeTransport(local.index);
    transport.cloudBlobs.set(H1, 'base64-1');
    transport.cloudBlobs.set(H2, 'base64-2');
    rememberMissingBlobs('p1', [H1, H2]);

    const res = await runNotesCycleV2('p1', '/x', { io, transport });

    expect(res.blobsRecovered).toBe(2);
    expect(io.files.get(`${NOTES_DIR}/blobs/${H1}.enc`)).toBe('base64-1');
    expect(io.files.get(`${NOTES_DIR}/blobs/${H2}.enc`)).toBe('base64-2');
  });

  it('une image deja sur le disque n est pas redemandee ; absente du nuage aussi, elle est abandonnee sans erreur', async () => {
    const io = new FakeDisk();
    const local = await saveVaultV2(io, vault(['a']), deps());
    const transport = new FakeTransport(local.index);
    const presente = 'cc33'.repeat(8);
    const absente = 'dd44'.repeat(8);
    await io.write(`${NOTES_DIR}/blobs/${presente}.enc`, 'deja-la');
    transport.cloudBlobs.set(presente, 'autre-contenu');
    rememberMissingBlobs('p1', [presente, absente]);
    io.writes = [];

    const res = await runNotesCycleV2('p1', '/x', { io, transport });

    expect(res.blobsRecovered).toBe(0);
    expect(io.files.get(`${NOTES_DIR}/blobs/${presente}.enc`)).toBe('deja-la');
    expect(io.writes.filter((w) => w.includes('/blobs/'))).toEqual([]);
  });

  it('le signalement est consomme : le cycle suivant ne redemande rien', async () => {
    const io = new FakeDisk();
    const local = await saveVaultV2(io, vault(['a']), deps());
    const transport = new FakeTransport(local.index);
    const h = 'ee55'.repeat(8);
    transport.cloudBlobs.set(h, 'b64');
    rememberMissingBlobs('p1', [h]);

    expect((await runNotesCycleV2('p1', '/x', { io, transport })).blobsRecovered).toBe(1);
    await io.remove(`${NOTES_DIR}/blobs/${h}.enc`);
    expect((await runNotesCycleV2('p1', '/x', { io, transport })).blobsRecovered).toBe(0);
    expect(io.files.has(`${NOTES_DIR}/blobs/${h}.enc`)).toBe(false);
  });

  it('une empreinte mal formee est ignoree — jamais un chemin fabrique depuis une donnee', async () => {
    const io = new FakeDisk();
    const local = await saveVaultV2(io, vault(['a']), deps());
    const transport = new FakeTransport(local.index);
    rememberMissingBlobs('p1', ['../../etc/passwd', 'ZZ']);
    io.writes = [];

    const res = await runNotesCycleV2('p1', '/x', { io, transport });

    expect(res.blobsRecovered).toBe(0);
    expect(io.writes.filter((w) => w.includes('etc') || w.includes('ZZ'))).toEqual([]);
  });
});
