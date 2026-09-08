/**
 * CONTRATS DE LA SAUVEGARDE INCRÉMENTALE DES NOTES.
 *
 * Ce qui est mis à l'épreuve ici, c'est la seule chose qu'un delta peut vraiment
 * casser : la PERTE. Une écriture partielle sur `notes.enc` n'a pas de session
 * suivante pour se rattraper — le contenu qui n'y est pas n'existe plus.
 *
 * Quatre familles :
 *  1. un delta d'une note ne fait disparaître aucune autre note ;
 *  2. une suppression nommée est bien appliquée (et une suppression NON nommée
 *     ne l'est pas) ;
 *  3. cache absent ou périmé → relecture du disque, jamais d'écriture à partir
 *     de rien ;
 *  4. deux deltas concurrents sont sérialisés par le verrou partagé.
 *
 * Le harnais reproduit la SÉQUENCE de décision du handler `notes:saveDelta`
 * (main.ts) avec des entrées/sorties bouchonnées — c'est cette séquence qui
 * porte les garanties, `ipcMain.handle` n'étant qu'un guichet. Le module de
 * décision lui-même (`notesDelta.ts`) est pur et testé directement.
 *
 * Le jumeau web (`src/platform/web/sync/notesDelta.ts`) est passé aux MÊMES
 * contrats : les deux copies doivent rester interchangeables.
 */

import { describe, expect, it } from 'vitest';

import {
  applyNotesDelta,
  isEmptyNotesVault,
  isUsableNotesBase,
  isWellFormedNotesDelta,
  selectStaleDeltaEntries,
  snapshotInputsFromDelta,
  type NotesDeltaPayload,
  type NotesVaultPayload,
} from '../notesDelta';
import { withNotesLock } from '../notesLock';
import * as webTwin from '../../../src/platform/web/sync/notesDelta';

// ── Fabriques ───────────────────────────────────────────────────────────────

function note(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: `Note ${id}`,
    content: `{"type":"doc","content":[{"type":"text","text":"${id}"}]}`,
    plainText: id,
    wordCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    linkedNoteIds: [],
    linkedFileIds: [],
    linkedFolderIds: [],
    ...overrides,
  };
}

function vault(ids: string[]): NotesVaultPayload {
  const byId: Record<string, Record<string, unknown>> = {};
  for (const id of ids) byId[id] = note(id);
  return { byId, allIds: [...ids], templates: [], notebooks: {}, skipVersioning: false };
}

function delta(partial: Partial<NotesDeltaPayload> = {}): NotesDeltaPayload {
  return {
    dirtyById: {},
    removedIds: [],
    allIds: [],
    templates: [],
    notebooks: {},
    skipVersioning: false,
    ...partial,
  };
}

// ── Harnais : la séquence de décision du handler ────────────────────────────

interface FakeDisk {
  /** `null` = le fichier n'existe pas. */
  payload: NotesVaultPayload | null;
  /** Identité du fichier ; change à chaque écriture (write-then-rename). */
  fingerprint: string | null;
  /** Taille approximative, pour la garde anti-vidage. */
  size: number;
  /** Le déchiffrement échoue-t-il ? */
  unreadable?: boolean;
  reads: number;
}

interface FakeCache {
  entry: { payload: NotesVaultPayload; fingerprint: string } | null;
}

function newDisk(payload: NotesVaultPayload | null): FakeDisk {
  return {
    payload,
    fingerprint: payload ? 'fp-0' : null,
    size: payload ? 5000 : 0,
    reads: 0,
  };
}

let fingerprintSeq = 0;

type HandlerResult = { ok: true } | { ok: false; needsFull: boolean };

/**
 * Miroir fidèle de la section critique de `notes:saveDelta` : vérification
 * d'identité → cache ou relecture → application → garde anti-vidage → écriture →
 * mémorisation. Tout passe par le VRAI verrou (`withNotesLock`).
 */
async function saveDelta(
  disk: FakeDisk,
  cache: FakeCache,
  d: unknown,
  hooks: { beforeWrite?: () => Promise<void> } = {}
): Promise<HandlerResult> {
  if (!isWellFormedNotesDelta(d)) return { ok: false, needsFull: true };
  return withNotesLock(async (): Promise<HandlerResult> => {
    const fingerprint = disk.fingerprint;
    let base: NotesVaultPayload | null = null;
    if (cache.entry && fingerprint !== null && cache.entry.fingerprint === fingerprint) {
      base = cache.entry.payload;
    }
    if (!base) {
      cache.entry = null;
      if (fingerprint === null) return { ok: false, needsFull: true };
      disk.reads += 1;
      if (disk.unreadable || !isUsableNotesBase(disk.payload)) {
        return { ok: false, needsFull: true };
      }
      base = disk.payload;
    }

    const next = applyNotesDelta(base, d);
    if (isEmptyNotesVault(next) && disk.size > 200) return { ok: false, needsFull: false };

    if (hooks.beforeWrite) await hooks.beforeWrite();

    disk.payload = next;
    disk.size = JSON.stringify(next).length;
    disk.fingerprint = `fp-${++fingerprintSeq}`;
    cache.entry = { payload: next, fingerprint: disk.fingerprint };
    return { ok: true };
  });
}

// ── 1. Rien ne disparaît ────────────────────────────────────────────────────

describe('un delta ne perd aucune autre note', () => {
  it('réécrit la note sale et laisse les autres intactes', () => {
    const base = vault(['a', 'b', 'c']);
    const next = applyNotesDelta(
      base,
      delta({
        dirtyById: { b: note('b', { title: 'B modifiée', updatedAt: '2026-02-02T00:00:00.000Z' }) },
        allIds: ['a', 'b', 'c'],
      })
    );

    expect(Object.keys(next.byId).sort()).toEqual(['a', 'b', 'c']);
    expect(next.allIds).toEqual(['a', 'b', 'c']);
    expect(next.byId.b.title).toBe('B modifiée');
    expect(next.byId.a).toEqual(base.byId.a);
    expect(next.byId.c).toEqual(base.byId.c);
  });

  it('ne mute jamais la base — un échec d’écriture laisse le cache cohérent', () => {
    const base = vault(['a', 'b']);
    const avant = JSON.stringify(base);
    applyNotesDelta(base, delta({ dirtyById: { a: note('a', { title: 'X' }) }, allIds: ['a', 'b'] }));
    expect(JSON.stringify(base)).toBe(avant);
  });

  it('CONSERVE une note que le renderer ignore encore (copie de conflit de la fusion)', () => {
    // La fusion du cycle de sync vient d'écrire `conflit` dans notes.enc ; le
    // renderer, lui, n'a pas encore rechargé et ne la connaît donc pas. La
    // sauvegarde PLEINE l'effacerait ; le delta doit la garder.
    const base = vault(['a', 'conflit']);
    const next = applyNotesDelta(
      base,
      delta({ dirtyById: { a: note('a', { title: 'A' }) }, allIds: ['a'] })
    );
    expect(next.byId.conflit).toBeDefined();
    expect(next.allIds).toContain('conflit');
  });

  it('accepte une note NOUVELLE absente de la base', () => {
    const base = vault(['a']);
    const next = applyNotesDelta(
      base,
      delta({ dirtyById: { neuve: note('neuve') }, allIds: ['a', 'neuve'] })
    );
    expect(next.allIds).toEqual(['a', 'neuve']);
  });

  it('écrit exactement la forme de notes:save (mêmes champs, même ordre de clés)', () => {
    const base = vault(['a']);
    const next = applyNotesDelta(
      base,
      delta({ dirtyById: {}, allIds: ['a'], templates: [{ id: 't' }], notebooks: { nb: {} } })
    );
    expect(Object.keys(next)).toEqual(['byId', 'allIds', 'templates', 'notebooks', 'skipVersioning']);

    const avecPurges = applyNotesDelta(
      base,
      delta({ allIds: ['a'], purged: { x: 'now' }, purgedNotebooks: { nb: 'now' } })
    );
    expect(Object.keys(avecPurges)).toEqual([
      'byId',
      'allIds',
      'templates',
      'notebooks',
      'purged',
      'purgedNotebooks',
      'skipVersioning',
    ]);
  });
});

// ── 2. Suppressions ─────────────────────────────────────────────────────────

describe('les suppressions nommées, et elles seules', () => {
  it('retire la note nommée dans removedIds', () => {
    const next = applyNotesDelta(
      vault(['a', 'b', 'c']),
      delta({ removedIds: ['b'], allIds: ['a', 'c'] })
    );
    expect(next.byId.b).toBeUndefined();
    expect(next.allIds).toEqual(['a', 'c']);
  });

  it('une note simplement ABSENTE du delta n’est pas supprimée', () => {
    const next = applyNotesDelta(vault(['a', 'b', 'c']), delta({ allIds: ['a'] }));
    expect(Object.keys(next.byId).sort()).toEqual(['a', 'b', 'c']);
  });

  it('un id à la fois retiré et resalé est RÉÉCRIT, pas effacé (recréation)', () => {
    const next = applyNotesDelta(
      vault(['a']),
      delta({ removedIds: ['a'], dirtyById: { a: note('a', { title: 'renée' }) }, allIds: ['a'] })
    );
    expect(next.byId.a.title).toBe('renée');
  });

  it('la corbeille passe par les notes SALES (deletedAt), pas par removedIds', () => {
    const next = applyNotesDelta(
      vault(['a']),
      delta({ dirtyById: { a: note('a', { deletedAt: '2026-03-03T00:00:00.000Z' }) }, allIds: ['a'] })
    );
    expect(next.byId.a.deletedAt).toBe('2026-03-03T00:00:00.000Z');
    // …et une note à la corbeille n'est pas instantanée-versionnée.
    expect(
      snapshotInputsFromDelta(
        delta({ dirtyById: { a: note('a', { deletedAt: '2026-03-03T00:00:00.000Z' }) } })
      )
    ).toEqual([]);
  });

  it('un delta qui viderait un coffre non vide est REFUSÉ', async () => {
    const disk = newDisk(vault(['a']));
    const cache: FakeCache = { entry: null };
    const res = await saveDelta(disk, cache, delta({ removedIds: ['a'], allIds: [] }));
    expect(res).toEqual({ ok: false, needsFull: false });
    expect(disk.payload?.allIds).toEqual(['a']); // rien n'a été écrit
  });
});

// ── 3. Cache absent / périmé → relecture ────────────────────────────────────

describe('la base : cache, disque, ou refus', () => {
  it('cache vide → une relecture du disque, puis le cache sert', async () => {
    const disk = newDisk(vault(['a', 'b']));
    const cache: FakeCache = { entry: null };

    await saveDelta(disk, cache, delta({ dirtyById: { a: note('a', { title: '1' }) }, allIds: ['a', 'b'] }));
    expect(disk.reads).toBe(1);

    await saveDelta(disk, cache, delta({ dirtyById: { a: note('a', { title: '2' }) }, allIds: ['a', 'b'] }));
    expect(disk.reads).toBe(1); // le cache a servi
    expect(disk.payload?.byId.a.title).toBe('2');
    expect(disk.payload?.byId.b).toBeDefined();
  });

  it('fichier réécrit par la fusion → cache PÉRIMÉ, relecture, aucune perte', async () => {
    const disk = newDisk(vault(['a']));
    const cache: FakeCache = { entry: null };
    await saveDelta(disk, cache, delta({ dirtyById: { a: note('a', { title: '1' }) }, allIds: ['a'] }));
    expect(disk.reads).toBe(1);

    // La fusion du cycle de sync écrit une note que le renderer n'a jamais vue,
    // et l'identité du fichier change (write-then-rename).
    disk.payload = vault(['a', 'venue-du-nuage']);
    disk.fingerprint = 'fp-fusion';

    await saveDelta(disk, cache, delta({ dirtyById: { a: note('a', { title: '2' }) }, allIds: ['a'] }));
    expect(disk.reads).toBe(2); // le cache a été rejeté
    expect(disk.payload?.byId['venue-du-nuage']).toBeDefined();
    expect(disk.payload?.byId.a.title).toBe('2');
  });

  it('aucun fichier → écriture PLEINE demandée, rien d’écrit', async () => {
    const disk = newDisk(null);
    const res = await saveDelta(disk, { entry: null }, delta({ dirtyById: { a: note('a') }, allIds: ['a'] }));
    expect(res).toEqual({ ok: false, needsFull: true });
    expect(disk.payload).toBeNull();
  });

  it('base illisible → écriture PLEINE demandée, rien d’écrit', async () => {
    const disk = newDisk(vault(['a']));
    disk.unreadable = true;
    const res = await saveDelta(disk, { entry: null }, delta({ dirtyById: { b: note('b') }, allIds: ['a', 'b'] }));
    expect(res).toEqual({ ok: false, needsFull: true });
    expect(disk.payload?.byId.b).toBeUndefined();
  });

  it('delta malformé → écriture PLEINE demandée', async () => {
    const disk = newDisk(vault(['a']));
    for (const mauvais of [null, undefined, 42, {}, { dirtyById: {}, removedIds: 'non' }]) {
      expect(await saveDelta(disk, { entry: null }, mauvais)).toEqual({ ok: false, needsFull: true });
    }
    expect(isUsableNotesBase({ byId: {} })).toBe(false);
    expect(isUsableNotesBase({ byId: {}, allIds: [] })).toBe(true);
  });
});

// ── 4. Concurrence ──────────────────────────────────────────────────────────

describe('deux deltas concurrents sont sérialisés par le verrou', () => {
  it('le second lit ce que le premier a écrit — aucune écriture ne se perd', async () => {
    const disk = newDisk(vault(['a', 'b']));
    const cache: FakeCache = { entry: null };

    let relacher: () => void = () => undefined;
    const barriere = new Promise<void>((resolve) => {
      relacher = resolve;
    });

    // Le premier delta est retenu JUSTE avant son écriture : sans verrou, le
    // second lirait la base d'origine et effacerait la modification du premier.
    const premier = saveDelta(
      disk,
      cache,
      delta({ dirtyById: { a: note('a', { title: 'premier' }) }, allIds: ['a', 'b'] }),
      { beforeWrite: () => barriere }
    );
    const second = saveDelta(
      disk,
      cache,
      delta({ dirtyById: { b: note('b', { title: 'second' }) }, allIds: ['a', 'b'] })
    );

    relacher();
    expect(await premier).toEqual({ ok: true });
    expect(await second).toEqual({ ok: true });

    expect(disk.payload?.byId.a.title).toBe('premier');
    expect(disk.payload?.byId.b.title).toBe('second');
  });

  it('un delta qui jette ne fige pas la file', async () => {
    const disk = newDisk(vault(['a']));
    const cache: FakeCache = { entry: null };
    const jete = saveDelta(disk, cache, delta({ allIds: ['a'] }), {
      beforeWrite: () => Promise.reject(new Error('disque plein')),
    });
    await expect(jete).rejects.toThrow('disque plein');
    await expect(
      saveDelta(disk, cache, delta({ dirtyById: { a: note('a', { title: 'après' }) }, allIds: ['a'] }))
    ).resolves.toEqual({ ok: true });
    expect(disk.payload?.byId.a.title).toBe('après');
  });
});

// ── 5. Les deux copies restent interchangeables ─────────────────────────────

describe('parité desktop / web', () => {
  const cas: Array<[string, NotesVaultPayload, NotesDeltaPayload]> = [
    ['note modifiée', vault(['a', 'b']), delta({ dirtyById: { a: note('a', { title: 'X' }) }, allIds: ['a', 'b'] })],
    ['suppression', vault(['a', 'b']), delta({ removedIds: ['a'], allIds: ['b'] })],
    ['note inconnue du renderer', vault(['a', 'z']), delta({ dirtyById: { a: note('a') }, allIds: ['a'] })],
    ['registres de purge', vault(['a']), delta({ allIds: ['a'], purged: { p: 'now' } })],
  ];

  for (const [nom, base, d] of cas) {
    it(`rend le même coffre — ${nom}`, () => {
      expect(JSON.stringify(webTwin.applyNotesDelta(base, d))).toBe(
        JSON.stringify(applyNotesDelta(base, d))
      );
    });
  }

  it('mêmes verdicts de forme et de vacuité', () => {
    expect(webTwin.isWellFormedNotesDelta({ dirtyById: {}, removedIds: [], allIds: [] })).toBe(true);
    expect(webTwin.isWellFormedNotesDelta({ dirtyById: {} })).toBe(false);
    expect(webTwin.isUsableNotesBase({ byId: {}, allIds: [] })).toBe(true);
    expect(webTwin.isEmptyNotesVault({ byId: {}, allIds: [] })).toBe(true);
    expect(isEmptyNotesVault({ byId: { a: {} }, allIds: ['a'] })).toBe(false);
  });
});

// ── Garde de concurrence : le disque a avancé sous le renderer ──────────────
//
// LE CAS RÉEL, tel que le journal du 2026-09-02 le raconte :
//
//   02:30:19  la fusion écrit un notes.enc de 9 869 173 octets (le nuage était
//             plus riche de 613 586 octets que le disque)
//   02:32:16  le renderer écrit 9 255 587 octets — « 1 sale(s) » — en partant
//             d'une copie d'AVANT la fusion
//   02:32:22  la régression part au nuage
//
// Rien dans le protocole ne permettait de dire non : le delta était un ordre.
// `baseUpdatedAt` en fait une proposition, que ces contrats mettent à l'épreuve.

describe('garde de concurrence optimiste (baseUpdatedAt)', () => {
  const AVANT = '2026-09-02T00:20:00.000Z';
  const APRES_FUSION = '2026-09-02T02:30:19.000Z';

  /** Le disque tel que la fusion vient de le laisser. */
  const disque = (): NotesVaultPayload => ({
    byId: {
      liens: note('liens', { updatedAt: APRES_FUSION, plainText: 'CONTENU FUSIONNÉ' }),
      autre: note('autre'),
    },
    allIds: ['liens', 'autre'],
    templates: [],
    notebooks: {},
    skipVersioning: false,
  });

  /** Ce que le renderer périmé propose : sa copie d'avant la fusion. */
  const propositionPerimee = (): NotesDeltaPayload =>
    delta({
      dirtyById: { liens: note('liens', { updatedAt: AVANT, plainText: 'CONTENU PÉRIMÉ' }) },
      baseUpdatedAt: { liens: AVANT },
      allIds: ['liens', 'autre'],
    });

  it('DÉSIGNE la note dont le disque a avancé', () => {
    expect(selectStaleDeltaEntries(disque(), propositionPerimee())).toEqual(['liens']);
  });

  it("N'ÉCRIT PAS la copie périmée — le disque garde la version fusionnée", () => {
    const apres = applyNotesDelta(disque(), propositionPerimee());
    expect((apres.byId.liens as Record<string, unknown>).plainText).toBe('CONTENU FUSIONNÉ');
    expect((apres.byId.liens as Record<string, unknown>).updatedAt).toBe(APRES_FUSION);
  });

  it('laisse passer une modification partie de la version QUI EST sur le disque', () => {
    const d = delta({
      dirtyById: { liens: note('liens', { updatedAt: '2026-09-02T03:00:00.000Z', plainText: 'SUITE' }) },
      baseUpdatedAt: { liens: APRES_FUSION },
      allIds: ['liens', 'autre'],
    });
    expect(selectStaleDeltaEntries(disque(), d)).toEqual([]);
    expect((applyNotesDelta(disque(), d).byId.liens as Record<string, unknown>).plainText).toBe(
      'SUITE'
    );
  });

  it("ne refuse jamais un AJOUT : une note absente du disque ne détruit rien", () => {
    const d = delta({
      dirtyById: { neuve: note('neuve') },
      baseUpdatedAt: { neuve: null },
      allIds: ['liens', 'autre', 'neuve'],
    });
    expect(selectStaleDeltaEntries(disque(), d)).toEqual([]);
    expect(applyNotesDelta(disque(), d).byId.neuve).toBeDefined();
  });

  it('refuse une note neuve côté renderer que le disque porte DÉJÀ (même id des deux côtés)', () => {
    const d = delta({
      dirtyById: { liens: note('liens', { plainText: 'ÉCRASEMENT' }) },
      baseUpdatedAt: { liens: null },
      allIds: ['liens', 'autre'],
    });
    expect(selectStaleDeltaEntries(disque(), d)).toEqual(['liens']);
  });

  it('une SUPPRESSION DOUCE plus fraîche sur le disque gagne aussi (horloge = max(updatedAt, deletedAt))', () => {
    const corbeille = disque();
    corbeille.byId.liens = note('liens', {
      updatedAt: AVANT,
      deletedAt: '2026-09-02T02:40:00.000Z',
    });
    expect(selectStaleDeltaEntries(corbeille, propositionPerimee())).toEqual(['liens']);
  });

  it("SANS `baseUpdatedAt`, rien ne change : le comportement d'avant est intact", () => {
    const d = delta({
      dirtyById: { liens: note('liens', { updatedAt: AVANT, plainText: 'CONTENU PÉRIMÉ' }) },
      allIds: ['liens', 'autre'],
    });
    expect(selectStaleDeltaEntries(disque(), d)).toEqual([]);
    expect((applyNotesDelta(disque(), d).byId.liens as Record<string, unknown>).plainText).toBe(
      'CONTENU PÉRIMÉ'
    );
  });

  it('desktop et web rendent EXACTEMENT le même verdict et le même coffre', () => {
    const base = disque();
    const d = propositionPerimee();
    expect(webTwin.selectStaleDeltaEntries(base, d)).toEqual(selectStaleDeltaEntries(base, d));
    expect(JSON.stringify(webTwin.applyNotesDelta(base, d))).toBe(
      JSON.stringify(applyNotesDelta(base, d))
    );
  });
});
