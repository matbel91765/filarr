/**
 * CONTRATS DE LA COUCHE DE RANGEMENT (v1, v2, et le passage entre les deux).
 *
 * Ce qui est éprouvé ici n'est pas l'arbitrage — il l'est dans
 * `notesStoreV2.vitest.ts` — mais la seule chose qu'une couche de rangement
 * peut casser : ÉCRIRE UN ÉTAT QU'ON NE SAURA PAS RELIRE.
 *
 * Quatre familles :
 *  1. l'aller-retour par le disque ;
 *  2. l'ORDRE d'écriture, qui EST toute l'atomicité (les notes, puis l'index,
 *     puis les orphelins) — éprouvé en coupant le courant à chaque étape ;
 *  3. la migration, et ses trois refus ;
 *  4. la réconciliation avec un appareil resté en v1 — le piège qui ferait
 *     disparaître des notes sans que rien ne s'affiche.
 */

import { describe, expect, it } from 'vitest';

import {
  decideLegacyVerdict,
  legacyObservationOf,
  bootstrapEmptyV2,
  detectFormat,
  findOrphanObjects,
  LEGACY_NOTES_STALE_MS,
  formatVersionOf,
  isValidObjectId,
  loadVaultV1,
  loadVaultV2,
  readBounded,
  VAULT_READ_CONCURRENCY,
  mergeV1PayloadIntoV2,
  migrateToV2,
  reconcileLegacyBlob,
  saveVaultV2,
  shouldWriteBackLegacy,
  V1_BLOB_FILENAME,
  type VaultIO,
} from '../notesVaultStore';
import {
  indexForCloud,
  legacyVaultDigest,
  mergeIndexes,
  NOTES_DIR,
  type NoteRecord,
  type NotesPayload,
  type SplitDeps,
} from '../notesStoreV2';

// ── Un disque en mémoire, avec panne à la demande ───────────────────────────

class FakeDisk implements VaultIO {
  files = new Map<string, unknown>();
  /** Chemins lus — la dormance se prouve en montrant ce qu'on ne lit PAS. */
  reads: string[] = [];
  writes: string[] = [];
  removes: string[] = [];
  /** Chemin sur lequel la prochaine écriture DOIT échouer (coupure de courant). */
  failWriteOn: string | null = null;
  /** Chemins dont la LECTURE échoue (objet corrompu). */
  unreadable = new Set<string>();

  async read(relPath: string): Promise<unknown | null> {
    this.reads.push(relPath);
    if (this.unreadable.has(relPath)) return null;
    const v = this.files.get(relPath);
    return v === undefined ? null : structuredClone(v);
  }

  async write(relPath: string, plain: unknown): Promise<void> {
    if (this.failWriteOn === relPath) {
      throw new Error(`panne simulée en écrivant ${relPath}`);
    }
    this.files.set(relPath, structuredClone(plain));
    this.writes.push(relPath);
  }

  async remove(relPath: string): Promise<void> {
    this.files.delete(relPath);
    this.removes.push(relPath);
  }

  async list(relDir: string): Promise<string[]> {
    const out: string[] = [];
    for (const key of this.files.keys()) {
      if (key.startsWith(`${relDir}/`)) out.push(key.slice(relDir.length + 1));
    }
    return out;
  }
}

const T0 = '2026-01-01T00:00:00.000Z';
const T2 = '2026-09-01T00:00:00.000Z';

function note(id: string, overrides: Record<string, unknown> = {}): NoteRecord {
  return { id, title: `Note ${id}`, content: `c-${id}`, createdAt: T0, updatedAt: T0, ...overrides };
}

function vault(ids: string[], overrides: Partial<NotesPayload> = {}): NotesPayload {
  const byId: Record<string, NoteRecord> = {};
  for (const id of ids) byId[id] = note(id);
  return { byId, allIds: [...ids], templates: [], notebooks: {}, ...overrides };
}

function makeDeps(): SplitDeps {
  let n = 0;
  return {
    digestOf: (note: NoteRecord) => JSON.stringify(note),
    newObjectId: () => `o${++n}`,
  };
}

// ── 1. Aller-retour par le disque ───────────────────────────────────────────

describe('aller-retour par le disque', () => {
  it('écrit puis relit le même coffre', async () => {
    const io = new FakeDisk();
    const v = vault(['a', 'b']);
    await saveVaultV2(io, v, makeDeps());
    const loaded = await loadVaultV2(io);
    expect(loaded).not.toBeNull();
    expect(loaded!.payload).toEqual(v);
    expect(loaded!.missing).toEqual([]);
  });

  it('reconnaît le format que porte le disque', async () => {
    const io = new FakeDisk();
    expect(await detectFormat(io)).toBe('none');

    await io.write(V1_BLOB_FILENAME, vault(['a']));
    expect(await detectFormat(io)).toBe('v1');

    await saveVaultV2(io, vault(['a']), makeDeps());
    // L'index PRÉSENT définit la v2, même si le blob v1 est toujours là.
    expect(await detectFormat(io)).toBe('v2');
    expect(formatVersionOf('v2')).toBe(2);
    expect(formatVersionOf('v1')).toBe(1);
  });

  /**
   * Une note illisible est SIGNALÉE et omise, jamais rendue vide. Rendre un trou
   * ferait croire à une suppression, que la sauvegarde suivante propagerait au
   * nuage — et cette fois pour de bon.
   */
  it('une note illisible est signalée, pas silencieusement perdue', async () => {
    const io = new FakeDisk();
    const saved = await saveVaultV2(io, vault(['a', 'b']), makeDeps());
    io.unreadable.add(`${NOTES_DIR}/${saved.index.notes.b.objectId}.enc`);

    const loaded = await loadVaultV2(io);
    expect(loaded!.missing).toEqual(['b']);
    expect(Object.keys(loaded!.payload.byId as object)).toEqual(['a']);
    // L'index, lui, la connaît toujours : rien n'a été effacé.
    expect(loaded!.index.notes.b).toBeDefined();
  });

  it('refuse un identifiant d’objet qui sortirait du profil', () => {
    expect(isValidObjectId('o1')).toBe(true);
    expect(isValidObjectId('../../etc/passwd')).toBe(false);
    expect(isValidObjectId('a/b')).toBe(false);
    expect(isValidObjectId('')).toBe(false);
    expect(isValidObjectId('x'.repeat(65))).toBe(false);
  });
});

// ── 2. L'ordre d'écriture EST l'atomicité ───────────────────────────────────

describe('ordre d’écriture : notes, puis index, puis orphelins', () => {
  it('l’index est écrit EN DERNIER', async () => {
    const io = new FakeDisk();
    await saveVaultV2(io, vault(['a', 'b', 'c']), makeDeps());
    expect(io.writes[io.writes.length - 1]).toBe(`${NOTES_DIR}/index.enc`);
    expect(io.writes.filter((w) => w.endsWith('index.enc'))).toHaveLength(1);
  });

  /**
   * LA PROPRIÉTÉ QUI REMPLACE LE RENOMMAGE ATOMIQUE. Un dossier ne se renomme
   * pas d'un bloc ; on s'appuie donc sur « le coffre v2 n'existe que si son
   * index existe ». Coupé avant l'index, le disque garde l'ANCIEN coffre —
   * pas un mélange des deux.
   */
  it('coupé avant l’index, le disque garde l’ancien coffre', async () => {
    const io = new FakeDisk();
    const first = await saveVaultV2(io, vault(['a']), makeDeps());

    io.failWriteOn = `${NOTES_DIR}/index.enc`;
    await expect(
      saveVaultV2(io, vault(['a', 'b']), makeDeps(), first.index)
    ).rejects.toThrow(/panne simulée/);

    // L'objet de `b` traîne sur le disque, mais l'index ne le cite pas :
    // le coffre relu est exactement celui d'avant.
    const loaded = await loadVaultV2(io);
    expect(Object.keys(loaded!.payload.byId as object)).toEqual(['a']);
    expect(loaded!.missing).toEqual([]);
  });

  /**
   * LE TEST QUI MORD VRAIMENT. Le précédent coupe le courant SUR l'index : si
   * l'implémentation écrivait l'index en premier, la panne tomberait sur la
   * toute première écriture et le disque serait intact — le test passerait sans
   * rien prouver. Ici la panne tombe sur une NOTE, donc APRÈS l'index dans un
   * ordre inversé : l'index citerait alors une note dont l'objet n'existe pas.
   *
   * Avec le bon ordre, l'index n'est jamais atteint et le coffre relu est
   * l'ancien, INTACT — aucune note manquante.
   */
  it('coupé sur une NOTE, l’index ne cite jamais un objet qui n’existe pas', async () => {
    const io = new FakeDisk();
    const deps = makeDeps();
    const first = await saveVaultV2(io, vault(['a']), deps);

    const suivant = vault(['a', 'b']);
    // On vise l'objet que `b` recevra (la prochaine clé tirée par `makeDeps`).
    io.failWriteOn = `${NOTES_DIR}/o2.enc`;
    await expect(saveVaultV2(io, suivant, deps, first.index)).rejects.toThrow(/panne simulée/);

    const loaded = await loadVaultV2(io);
    expect(loaded!.missing).toEqual([]);
    expect(Object.keys(loaded!.payload.byId as object)).toEqual(['a']);
    expect(loaded!.index.notes.b).toBeUndefined();
  });

  it('un objet orphelin est repérable, et n’empêche rien', async () => {
    const io = new FakeDisk();
    const first = await saveVaultV2(io, vault(['a']), makeDeps());
    await io.write(`${NOTES_DIR}/orphelin.enc`, note('z'));
    expect(await findOrphanObjects(io, first.index)).toEqual(['orphelin.enc']);
  });

  it('n’écrit QUE les notes dont l’empreinte a changé', async () => {
    const io = new FakeDisk();
    const deps = makeDeps();
    const first = await saveVaultV2(io, vault(['a', 'b', 'c']), deps);
    expect(first.written).toHaveLength(3);

    io.writes = [];
    const v2 = vault(['a', 'b', 'c']);
    (v2.byId as Record<string, NoteRecord>).b = note('b', { updatedAt: T2, title: 'CHANGÉ' });
    const second = await saveVaultV2(io, v2, deps, first.index);

    // UNE note réécrite, plus l'index. C'est toute la raison d'être du format.
    expect(second.written).toEqual([first.index.notes.b.objectId]);
    expect(io.writes).toHaveLength(2);
  });

  it('une note supprimée définitivement voit son objet retiré APRÈS l’index', async () => {
    const io = new FakeDisk();
    const deps = makeDeps();
    const first = await saveVaultV2(io, vault(['a', 'b']), deps);
    const objetDeB = first.index.notes.b.objectId;

    io.writes = [];
    const second = await saveVaultV2(io, vault(['a']), deps, first.index);
    expect(second.removed).toEqual([objetDeB]);
    // L'index est écrit avant la suppression : jamais d'index qui désigne un
    // objet déjà disparu.
    expect(io.writes[io.writes.length - 1]).toBe(`${NOTES_DIR}/index.enc`);
    expect(io.files.has(`${NOTES_DIR}/${objetDeB}.enc`)).toBe(false);
  });
});

// ── 3. Migration ────────────────────────────────────────────────────────────

describe('migration v1 → v2', () => {
  it('découpe le blob, écrit la v2, et NE SUPPRIME PAS notes.enc', async () => {
    const io = new FakeDisk();
    const v = vault(['a', 'b', 'c']);
    await io.write(V1_BLOB_FILENAME, v);

    const res = await migrateToV2(io, makeDeps());
    expect(res.ok).toBe(true);
    expect(res.noteCount).toBe(3);

    // Le blob est TOUJOURS là — c'est le seul chemin de retour.
    expect(await loadVaultV1(io)).toEqual(v);
    // Et la v2 relit exactement le même coffre.
    expect((await loadVaultV2(io))!.payload).toEqual(v);
    expect(await detectFormat(io)).toBe('v2');
  });

  it('refuse si une v2 existe déjà', async () => {
    const io = new FakeDisk();
    await io.write(V1_BLOB_FILENAME, vault(['a']));
    await saveVaultV2(io, vault(['a']), makeDeps());
    const res = await migrateToV2(io, makeDeps());
    expect(res.ok).toBe(false);
    expect(res.why).toMatch(/déjà présente/);
  });

  it('refuse sans blob exploitable', async () => {
    const io = new FakeDisk();
    expect((await migrateToV2(io, makeDeps())).ok).toBe(false);
    await io.write(V1_BLOB_FILENAME, { pas: 'un coffre' });
    expect((await migrateToV2(io, makeDeps())).ok).toBe(false);
  });

  /**
   * GARDE ANTI-MIGRATION-VIDE. Un blob dont la découpe ne rend AUCUNE note alors
   * que `byId` en contient est le signe d'une lecture qui a mal tourné. Migrer
   * là-dessus écrirait un index vide qui ferait autorité — et le blob ne serait
   * plus jamais relu.
   */
  it('refuse une découpe vide sur un coffre qui ne l’est pas', async () => {
    const io = new FakeDisk();
    // Des entrées qui ne sont pas des objets : `splitVault` les ignore toutes.
    await io.write(V1_BLOB_FILENAME, { byId: { a: 'pas une note', b: 42 }, allIds: ['a', 'b'] });
    const res = await migrateToV2(io, makeDeps());
    expect(res.ok).toBe(false);
    expect(res.why).toMatch(/découpe vide/);
  });

  it('migre un coffre RÉELLEMENT vide sans se plaindre', async () => {
    const io = new FakeDisk();
    await io.write(V1_BLOB_FILENAME, { byId: {}, allIds: [] });
    expect((await migrateToV2(io, makeDeps())).ok).toBe(true);
  });

  it('coupée en plein vol, elle ne laisse pas de v2 à moitié faite', async () => {
    const io = new FakeDisk();
    await io.write(V1_BLOB_FILENAME, vault(['a', 'b']));
    io.failWriteOn = `${NOTES_DIR}/index.enc`;
    await expect(migrateToV2(io, makeDeps())).rejects.toThrow(/panne simulée/);
    // Sans index, le profil est toujours en v1 : la migration repartira.
    expect(await detectFormat(io)).toBe('v1');
  });
});

// ── 4. Réconciliation avec un appareil resté en v1 ──────────────────────────

/**
 * LE PIÈGE. Tant que tous les appareils d'un compte ne sont pas passés en v2,
 * l'un d'eux continue d'écrire l'ancien `meta:notes`. Si la v2 ignorait ce blob,
 * les notes écrites depuis ce téléphone-là n'atteindraient JAMAIS les autres —
 * sans erreur, sans indicateur, sans rien. C'est la pire forme de perte, et
 * c'est exactement celle que ce chantier poursuit depuis le début.
 */
describe('réconciliation avec un appareil resté en v1', () => {
  it('une note qui n’existe QUE dans le blob v1 est réinjectée', async () => {
    const io = new FakeDisk();
    const deps = makeDeps();
    const local = await saveVaultV2(io, vault(['a']), deps);

    // Le vieil appareil a écrit `b` dans son blob.
    const blobDistant = vault(['a', 'b']);
    const { plan, notes } = mergeV1PayloadIntoV2(local.index, blobDistant, deps);

    expect(plan.toFetch).toEqual(['b']);
    expect(Object.keys(plan.merged.notes).sort()).toEqual(['a', 'b']);
    // Le contenu est DÉJÀ là : il vient du blob, aucune requête n'est nécessaire.
    expect(notes.b).toEqual(blobDistant.byId!['b' as keyof object]);
  });

  it('ne réattribue PAS de clé d’objet à une note déjà connue', async () => {
    const io = new FakeDisk();
    const deps = makeDeps();
    const local = await saveVaultV2(io, vault(['a']), deps);
    const cleDeA = local.index.notes.a.objectId;

    const { plan } = mergeV1PayloadIntoV2(local.index, vault(['a', 'b']), deps);
    expect(plan.merged.notes.a.objectId).toBe(cleDeA);
    expect(plan.rekeyed).toEqual([]);
  });

  it('une note plus fraîche en v2 n’est pas écrasée par le vieux blob', async () => {
    const io = new FakeDisk();
    const deps = makeDeps();
    const frais = vault(['a']);
    (frais.byId as Record<string, NoteRecord>).a = note('a', { updatedAt: T2, title: 'FRAIS' });
    const local = await saveVaultV2(io, frais, deps);

    const { plan } = mergeV1PayloadIntoV2(local.index, vault(['a']), deps);
    expect(plan.toFetch).toEqual([]);
    expect(plan.toPush).toEqual(['a']); // c'est le vieil appareil qui doit rattraper
  });
});

// ── 5. Dormance : un profil v1 ne doit RIEN payer ───────────────────────────

/**
 * LA v2 EST LIVRÉE DORMANTE, et « dormante » doit vouloir dire GRATUITE.
 *
 * Le chemin de chargement demande d'abord « y a-t-il une v2 ? ». Si cette
 * question coûtait un déchiffrement du blob v1 — 9,9 Mo et ~2 s sur un coffre
 * réel — on doublerait le temps de démarrage de TOUS les profils encore en v1,
 * c'est-à-dire de tout le monde, pour une fonctionnalité que personne n'a
 * encore activée. Ce serait une régression pure.
 *
 * `loadVaultV2` ne doit donc lire QUE l'index.
 */
describe('dormance : un profil v1 ne paie rien', () => {
  it('chercher une v2 ne touche jamais au blob v1', async () => {
    const io = new FakeDisk();
    await io.write(V1_BLOB_FILENAME, vault(['a', 'b', 'c']));

    const lus: string[] = [];
    const espion: VaultIO = {
      read: (p) => {
        lus.push(p);
        return io.read(p);
      },
      write: (p, v) => io.write(p, v),
      remove: (p) => io.remove(p),
      list: (p) => io.list(p),
    };

    expect(await loadVaultV2(espion)).toBeNull();
    expect(lus).toEqual([`${NOTES_DIR}/index.enc`]);
    expect(lus).not.toContain(V1_BLOB_FILENAME);
  });

  it('aucun dossier `notes/` n’est créé tant que rien n’écrit en v2', async () => {
    const io = new FakeDisk();
    await io.write(V1_BLOB_FILENAME, vault(['a']));
    await loadVaultV2(io);
    expect(await io.list(NOTES_DIR)).toEqual([]);
  });
});

// ── 6. Le garde-fou de migration ────────────────────────────────────────────
//
// Migrer CET appareil pendant qu'un autre ecrit encore l'ancien blob
// fabriquerait exactement la panne que tout ce chantier poursuit : le second
// continuerait de publier `meta:notes`, celui-ci ne le lirait plus, et les
// notes ecrites la-bas n'arriveraient nulle part — sans erreur, sans
// indicateur, sans rien.

describe('verdict de migration', () => {
  const NOW = Date.parse('2026-09-02T00:00:00.000Z');
  const ilYA = (jours: number) =>
    new Date(NOW - jours * 24 * 60 * 60 * 1000).toISOString();

  it('JAMAIS OBSERVE = on ne sait pas, donc on ne migre pas', () => {
    // Le cas du demarrage : aucun cycle n'a encore vu le manifeste distant.
    // Migrer dans le noir est precisement le geste qu'on ne veut pas.
    expect(decideLegacyVerdict(undefined, NOW)).toBe('unknown');
  });

  it('pas de blob v1 dans le nuage : migration autorisee', () => {
    expect(decideLegacyVerdict(null, NOW)).toBe('safe');
  });

  it('un blob v1 ecrit recemment : un autre appareil vit encore en v1', () => {
    expect(decideLegacyVerdict(ilYA(0), NOW)).toBe('legacy-active');
    expect(decideLegacyVerdict(ilYA(1), NOW)).toBe('legacy-active');
    expect(decideLegacyVerdict(ilYA(29), NOW)).toBe('legacy-active');
  });

  it('un blob abandonne depuis plus de trente jours : autorise', () => {
    expect(decideLegacyVerdict(ilYA(31), NOW)).toBe('safe');
    expect(decideLegacyVerdict(ilYA(365), NOW)).toBe('safe');
  });

  it('un horodatage illisible compte comme ACTIF', () => {
    // On ne conclut pas a l'abandon depuis une donnee qu'on ne sait pas lire.
    expect(decideLegacyVerdict('pas-une-date', NOW)).toBe('legacy-active');
    expect(decideLegacyVerdict('', NOW)).toBe('legacy-active');
  });

  it('un blob v1 REECRIT par un appareil v2 n’est pas un ecrivain v1 — personne ne tape', () => {
    // Le pont vers les appareils v1 remontait comme une ecriture ordinaire et
    // bloquait la migration de tous les autres, sans que personne ne tape.
    expect(legacyObservationOf({ updatedAt: ilYA(0), legacyWriteBack: true })).toBeNull();
    expect(decideLegacyVerdict(legacyObservationOf({ updatedAt: ilYA(0), legacyWriteBack: true }), NOW)).toBe('safe');
    // Une vraie ecriture v1 (pas de drapeau) reste un ecrivain vivant.
    expect(legacyObservationOf({ updatedAt: ilYA(0) })).toBe(ilYA(0));
    expect(decideLegacyVerdict(legacyObservationOf({ updatedAt: ilYA(0) }), NOW)).toBe('legacy-active');
    // Supprime ou absent : pas de blob.
    expect(legacyObservationOf({ status: 'deleted', updatedAt: ilYA(0) })).toBeNull();
    expect(legacyObservationOf(undefined)).toBeNull();
    // Sans horodatage : illisible, donc actif (jamais « pas de blob »).
    expect(legacyObservationOf({})).toBe('');
  });

  it('la bascule tient exactement sur le seuil', () => {
    const pile = new Date(NOW - LEGACY_NOTES_STALE_MS).toISOString();
    expect(decideLegacyVerdict(pile, NOW)).toBe('legacy-active');
    const juste = new Date(NOW - LEGACY_NOTES_STALE_MS - 1000).toISOString();
    expect(decideLegacyVerdict(juste, NOW)).toBe('safe');
  });
});

// ── 7. Réinjection d'un appareil resté en v1 ────────────────────────────────
//
// APRÈS migration, le cycle ordinaire continue de descendre `meta:notes` et de
// le fusionner dans le `notes.enc` local — ce chemin n'a pas bougé. Mais ce
// fichier n'est plus lu : les notes d'un appareil resté en v1 arrivent sur le
// disque et n'apparaissent NULLE PART. Silencieusement.

describe('réinjection du blob v1', () => {
  /** Un disque qui sait dire si un fichier a bougé, sans le lire. */
  class DiskAvecStat extends FakeDisk {
    stats = new Map<string, string>();
    statCalls: string[] = [];
    async stat(p: string): Promise<string | null> {
      this.statCalls.push(p);
      return this.stats.get(p) ?? (this.files.has(p) ? 'v1' : null);
    }
  }

  it('reprend une note qui n’existe que dans le blob v1', async () => {
    const io = new DiskAvecStat();
    const d = makeDeps();
    const local = await saveVaultV2(io, vault(['a']), d);
    await io.write(V1_BLOB_FILENAME, vault(['a', 'b']));

    const res = await reconcileLegacyBlob(io, local.index, d, null);
    expect(res).not.toBeNull();
    expect(res!.plan.toFetch).toEqual(['b']);
    // Le contenu est DÉJÀ là : il vient du blob, aucune requête réseau.
    expect(res!.notes.b).toBeDefined();
  });

  /**
   * LA GARDE QUI COMPTE. Relire dix mégaoctets à chaque cycle pour découvrir
   * qu'un appareil éteint est toujours éteint coûterait plus cher que tout ce
   * que la v2 fait gagner.
   */
  it('ne relit RIEN quand le blob n’a pas bougé', async () => {
    const io = new DiskAvecStat();
    const d = makeDeps();
    const local = await saveVaultV2(io, vault(['a']), d);
    await io.write(V1_BLOB_FILENAME, vault(['a', 'b']));

    const premier = await reconcileLegacyBlob(io, local.index, d, null);
    io.reads = [];
    const second = await reconcileLegacyBlob(io, local.index, d, premier!.stamp);
    expect(second).toBeNull();
    expect(io.reads).not.toContain(V1_BLOB_FILENAME);
  });

  it('pas de blob du tout : rien à faire', async () => {
    const io = new DiskAvecStat();
    const d = makeDeps();
    const local = await saveVaultV2(io, vault(['a']), d);
    expect(await reconcileLegacyBlob(io, local.index, d, null)).toBeNull();
  });

  it('une note plus fraîche en v2 n’est pas écrasée par le vieux blob', async () => {
    const io = new DiskAvecStat();
    const d = makeDeps();
    const frais = vault(['a']);
    (frais.byId as Record<string, NoteRecord>).a = note('a', { updatedAt: T2, title: 'FRAIS' });
    const local = await saveVaultV2(io, frais, d);
    await io.write(V1_BLOB_FILENAME, vault(['a']));

    const res = await reconcileLegacyBlob(io, local.index, d, null);
    expect(res!.plan.toFetch).toEqual([]);
  });

  /**
   * L'empreinte est une mémoire d'APPAREIL. Si la fusion la perdait, chaque
   * cycle relirait le blob entier sans que rien ne le signale.
   */
  it('l’empreinte survit à une fusion d’index', async () => {
    const io = new DiskAvecStat();
    const d = makeDeps();
    const local = await saveVaultV2(io, vault(['a']), d);
    const avecEmpreinte = { ...local.index, legacyStamp: 'EMPREINTE' };
    const plan = mergeIndexes(avecEmpreinte, local.index);
    expect(plan.merged.legacyStamp).toBe('EMPREINTE');
    // Et elle ne monte JAMAIS au nuage.
    expect(indexForCloud(plan.merged).legacyStamp).toBeUndefined();
  });
});

// ── La réécriture du blob v1 ────────────────────────────────────────────────
//
// C'est le geste le plus destructeur du lot : on ÉCRASE un fichier qu'un autre
// appareil traite comme la vérité. Ses contrats décrivent donc, comme ceux du
// balayage, surtout les cas où il doit refuser.

describe('faut-il réécrire le blob v1 ?', () => {
  const base = {
    blobPresent: true,
    digest: 'NEUF',
    lastDigest: 'ANCIEN',
    missing: 0,
    noteCount: 3,
  };

  it('oui : le blob est là, tout est lu, et le contenu a changé', () => {
    expect(shouldWriteBackLegacy(base)).toBe(true);
  });

  /**
   * ON N'EN FABRIQUE PAS. Créer `notes.enc` pour un compte qui a quitté la v1
   * la ressusciterait, et ferait remonter dix mégaoctets par cycle pour
   * personne.
   */
  it('non quand il n’y a pas de blob : on ne ressuscite pas la v1', () => {
    expect(shouldWriteBackLegacy({ ...base, blobPresent: false })).toBe(false);
  });

  /**
   * LE REFUS QUI COMPTE. Une note absente du blob réécrit serait lue comme
   * SUPPRIMÉE par le vieil appareil, qui propagerait la suppression. Un échec
   * de lecture deviendrait une perte définitive.
   */
  it('non quand une seule note n’a pas pu être lue', () => {
    expect(shouldWriteBackLegacy({ ...base, missing: 1 })).toBe(false);
  });

  it('non quand l’index est vide : il n’écrase pas un blob qui, lui, porte des notes', () => {
    expect(shouldWriteBackLegacy({ ...base, noteCount: 0 })).toBe(false);
  });

  it('non quand rien n’a changé — y compris au tout premier passage', () => {
    expect(shouldWriteBackLegacy({ ...base, lastDigest: 'NEUF' })).toBe(false);
    // Jamais réécrit (`undefined`) et un contenu : oui, cette fois.
    expect(shouldWriteBackLegacy({ ...base, lastDigest: undefined })).toBe(true);
  });
});

describe('empreinte du coffre, calculée depuis l’index seul', () => {
  const hash = (v: Record<string, unknown>) => JSON.stringify(v);

  it('ne bouge pas quand seules les mémoires d’appareil changent', async () => {
    const io = new FakeDisk();
    const local = await saveVaultV2(io, vault(['a', 'b']), makeDeps());
    const avant = legacyVaultDigest(local.index, hash);
    const apres = legacyVaultDigest(
      { ...local.index, legacyStamp: 'X', blobSweepAt: T2, legacyDigest: 'Y' },
      hash
    );
    expect(apres).toBe(avant);
  });

  /**
   * Elle sert à décider s'il faut réécrire dix mégaoctets. Si elle ratait un
   * changement de contenu, le vieil appareil resterait figé — exactement le
   * défaut que la réécriture existe pour fermer.
   */
  it('bouge dès qu’une note change de contenu', async () => {
    const io = new FakeDisk();
    const local = await saveVaultV2(io, vault(['a']), makeDeps());
    const avant = legacyVaultDigest(local.index, hash);
    const modifie = {
      ...local.index,
      notes: { a: { ...local.index.notes.a, digest: 'AUTRE' } },
    };
    expect(legacyVaultDigest(modifie, hash)).not.toBe(avant);
  });

  it('ne dépend pas de l’ordre d’insertion des notes', async () => {
    const io = new FakeDisk();
    const local = await saveVaultV2(io, vault(['a', 'b']), makeDeps());
    const inverse = {
      ...local.index,
      notes: { b: local.index.notes.b, a: local.index.notes.a },
    };
    expect(legacyVaultDigest(inverse, hash)).toBe(legacyVaultDigest(local.index, hash));
  });

  it('bouge quand une note est mise à la corbeille', async () => {
    const io = new FakeDisk();
    const local = await saveVaultV2(io, vault(['a']), makeDeps());
    const supprimee = {
      ...local.index,
      notes: { a: { ...local.index.notes.a, deletedAt: T2 } },
    };
    expect(legacyVaultDigest(supprimee, hash)).not.toBe(legacyVaultDigest(local.index, hash));
  });
});

describe('le ménage des objets ne descend pas dans les sous-dossiers', () => {
  /**
   * Les images vivent sous `notes/blobs/`, et l'index des notes ne les réclame
   * pas : sans cette garde elles seraient TOUTES vues comme orphelines, donc
   * supprimées. Aujourd'hui `fs.readdir` ne descend pas — la sûreté ne tenait
   * qu'à ce détail, et rien ne l'écrivait.
   */
  it('ignore une image, même quand la liste la fait remonter', async () => {
    const io = new FakeDisk();
    const local = await saveVaultV2(io, vault(['a']), makeDeps());
    await io.write(`${NOTES_DIR}/blobs/${'ab'.repeat(8)}.enc`, 'OCTETS');

    const orphelins = await findOrphanObjects(io, local.index);
    expect(orphelins.filter((f) => f.includes('blobs'))).toEqual([]);
  });

  it('désigne toujours un objet de note qu’aucune entrée ne réclame', async () => {
    const io = new FakeDisk();
    const local = await saveVaultV2(io, vault(['a']), makeDeps());
    await io.write(`${NOTES_DIR}/orphelin.enc`, { id: 'x' });
    expect(await findOrphanObjects(io, local.index)).toEqual(['orphelin.enc']);
  });
});

describe('bootstrapEmptyV2 — naître en v2', () => {
  it('un disque vierge reçoit un index v2 vide, et devient v2', async () => {
    const io = new FakeDisk();
    expect(await detectFormat(io)).toBe('none');
    const born = await bootstrapEmptyV2(io);
    expect(born).not.toBeNull();
    expect(Object.keys(born!.notes)).toEqual([]);
    expect(await detectFormat(io)).toBe('v2');
    expect((await loadVaultV2(io))?.index.allIds).toEqual([]);
  });

  it('ne touche à rien quand un blob v1 existe : la bascule reste un geste', async () => {
    const io = new FakeDisk();
    await io.write(V1_BLOB_FILENAME, { byId: {}, allIds: [] });
    expect(await bootstrapEmptyV2(io)).toBeNull();
    expect(await detectFormat(io)).toBe('v1');
  });
});

// ── Lecture de front ──────────────────────────────────────────────────────────
//
// Chaque `io.read` d'un conteneur `v2:` coûte une dérivation PBKDF2 de 600 000
// tours (~265 ms). En série, 32 notes = 8,5 s au démarrage — mesuré le
// 05/09/2026. La lecture est désormais bornée mais parallèle, et le coffre rendu
// doit être LE MÊME, dans le même ordre, avec les mêmes échecs.

describe('lecture de front', () => {
  /** Un disque qui compte ce qu'il a en vol et met 5 ms par lecture. */
  class DisqueLent extends FakeDisk {
    enVol = 0;
    pic = 0;
    async read(relPath: string): Promise<unknown | null> {
      this.enVol++;
      this.pic = Math.max(this.pic, this.enVol);
      await new Promise((r) => setTimeout(r, 5));
      try {
        return await super.read(relPath);
      } finally {
        this.enVol--;
      }
    }
  }

  it('lit les objets en parallèle, borné, et rend le même coffre dans le même ordre', async () => {
    const io = new DisqueLent();
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];
    const v = vault(ids);
    await saveVaultV2(io, v, makeDeps());
    io.pic = 0;

    const loaded = await loadVaultV2(io);
    expect(loaded!.payload).toEqual(v);
    // L'ordre des clés suit l'index, pas l'ordre d'arrivée des lectures.
    expect(Object.keys(loaded!.payload.byId)).toEqual(Object.keys(v.byId));
    expect(loaded!.missing).toEqual([]);
    expect(io.pic).toBeGreaterThan(1);
    expect(io.pic).toBeLessThanOrEqual(VAULT_READ_CONCURRENCY);
  });

  it('un objet illisible reste « manquant », les autres arrivent', async () => {
    const io = new DisqueLent();
    const v = vault(['a', 'b', 'c']);
    await saveVaultV2(io, v, makeDeps());
    const cible = Object.values((await loadVaultV2(io))!.index.notes)[1].objectId;
    const chemin = [...io.files.keys()].find((k) => k.endsWith(`${cible}.enc`))!;
    io.unreadable.add(chemin);

    const loaded = await loadVaultV2(io);
    expect(loaded!.missing).toHaveLength(1);
    expect(Object.keys(loaded!.payload.byId)).toHaveLength(2);
  });

  it('le premier échec de lecture rejette, comme la boucle en série', async () => {
    /** L'index (première lecture) passe ; tout objet ensuite casse. */
    class DisqueEnPanne extends DisqueLent {
      premiere = true;
      async read(relPath: string): Promise<unknown | null> {
        if (this.premiere) {
          this.premiere = false;
          return super.read(relPath);
        }
        throw new Error('disque en panne');
      }
    }
    const io = new DisqueEnPanne();
    await saveVaultV2(io, vault(['a', 'b', 'c']), makeDeps());
    await expect(loadVaultV2(io)).rejects.toThrow('disque en panne');
  });

  it('readBounded : au plus `limit` en vol, tout est traité, liste vide tolérée', async () => {
    let enVol = 0;
    let pic = 0;
    const vus: number[] = [];
    await readBounded([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      enVol++;
      pic = Math.max(pic, enVol);
      await new Promise((r) => setTimeout(r, 2));
      vus.push(n);
      enVol--;
    });
    expect(vus.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pic).toBeLessThanOrEqual(3);
    expect(pic).toBeGreaterThan(1);
    await expect(readBounded([], 3, async () => undefined)).resolves.toBeUndefined();
  });
});