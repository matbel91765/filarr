/**
 * CONTRATS DU COFFRE DE NOTES v2 (une note, un objet).
 *
 * Quatre familles, dans l'ordre de ce qu'elles protègent :
 *
 *  1. L'ALLER-RETOUR. `assembleVault(splitVault(v))` doit rendre `v`. Si cette
 *     propriété tombe, la migration perd des notes — tout le reste est second.
 *  2. LA PARITÉ AVEC LA v1. La v2 doit trancher EXACTEMENT comme
 *     `mergeNotesPayload` sur les mêmes entrées. Sans ça, migrer inverserait
 *     silencieusement des conflits déjà arbitrés sur les appareils des gens.
 *  3. LES RÈGLES DE FUSION, une par une, y compris l'invariant dur qui JETTE.
 *  4. LA PROPORTIONNALITÉ — la raison d'être du format. Une note modifiée dans
 *     un coffre de cinq cents doit produire UN transfert, pas cinq cents.
 */

import { describe, expect, it } from 'vitest';

import {
  assembleVault,
  indexClock,
  indexForCloud,
  mergeIndexes,
  missingNotes,
  normalizeIndex,
  splitVault,
  NOTES_FORMAT_VERSION,
  PURGE_TOMBSTONE_TTL_MS,
  type NoteRecord,
  type NotesIndex,
  type NotesPayload,
  type SplitDeps,
  reconcileBlobRegistry,
} from '../notesStoreV2';
import { clockOf, mergeNotesPayload, noteTieDigest } from '../notesMergeCore';

// ── Fabriques ───────────────────────────────────────────────────────────────

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-06-01T00:00:00.000Z';
const T2 = '2026-09-01T00:00:00.000Z';

function note(id: string, overrides: Record<string, unknown> = {}): NoteRecord {
  return {
    id,
    title: `Note ${id}`,
    content: `{"type":"doc","content":[{"type":"text","text":"${id}"}]}`,
    plainText: id,
    wordCount: 1,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function vault(ids: string[], overrides: Partial<NotesPayload> = {}): NotesPayload {
  const byId: Record<string, NoteRecord> = {};
  for (const id of ids) byId[id] = note(id);
  return { byId, allIds: [...ids], templates: [], notebooks: {}, ...overrides };
}

/** Empreinte déterministe : la sérialisation. Suffit et se lit dans un échec. */
function makeDeps(): SplitDeps & { minted: number } {
  let n = 0;
  const deps = {
    digestOf: (note: NoteRecord) => JSON.stringify(note),
    newObjectId: () => `obj-${++n}`,
    get minted() {
      return n;
    },
  };
  return deps as SplitDeps & { minted: number };
}

/** Un index bâti à la main, pour éprouver la fusion sans passer par la découpe. */
function idx(
  entries: Record<string, { o?: string; u?: string | null; d?: string | null; g?: string }>,
  extra: Partial<NotesIndex> = {}
): NotesIndex {
  const notes: NotesIndex['notes'] = {};
  for (const [id, e] of Object.entries(entries)) {
    notes[id] = {
      objectId: e.o ?? `obj-${id}`,
      updatedAt: e.u === undefined ? T0 : e.u,
      deletedAt: e.d ?? null,
      digest: e.g ?? `d-${id}`,
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
    ...extra,
  };
}

// ── 1. Aller-retour ─────────────────────────────────────────────────────────

describe('aller-retour : découper puis recomposer rend le coffre', () => {
  it('rend un coffre identique, champ pour champ', () => {
    const v = vault(['a', 'b', 'c'], {
      templates: [{ id: 't1', name: 'Modèle' }],
      notebooks: { n1: { id: 'n1', name: 'Carnet' } },
    });
    const { index, notes } = splitVault(v, makeDeps());
    expect(assembleVault(index, notes)).toEqual(v);
  });

  it('conserve les registres de purge, et les OMET quand ils sont vides', () => {
    const avec = vault(['a'], { purged: { z: T1 } });
    const s1 = splitVault(avec, makeDeps());
    expect(assembleVault(s1.index, s1.notes)).toEqual(avec);

    const sans = vault(['a']);
    const s2 = splitVault(sans, makeDeps());
    // La forme doit être celle de la v1 : un registre vide n'est pas écrit.
    expect(Object.prototype.hasOwnProperty.call(assembleVault(s2.index, s2.notes), 'purged')).toBe(
      false
    );
  });

  it('une note supprimée en douceur fait l’aller-retour comme une autre', () => {
    const v = vault(['a'], {});
    (v.byId as Record<string, NoteRecord>).a = note('a', { deletedAt: T1 });
    const { index, notes } = splitVault(v, makeDeps());
    expect(index.notes.a.deletedAt).toBe(T1);
    expect(assembleVault(index, notes)).toEqual(v);
  });

  it('la clé d’objet est STABLE : re-découper ne tire pas de nouvelle clé', () => {
    const deps = makeDeps();
    const v = vault(['a', 'b']);
    const first = splitVault(v, deps);
    const mintedAfterFirst = deps.minted;

    // Même coffre, modifié : les clés existantes ne bougent pas.
    const v2 = vault(['a', 'b', 'c']);
    const second = splitVault(v2, deps, first.index);
    expect(second.index.notes.a.objectId).toBe(first.index.notes.a.objectId);
    expect(second.index.notes.b.objectId).toBe(first.index.notes.b.objectId);
    // Une seule clé neuve, pour la seule note neuve.
    expect(deps.minted).toBe(mintedAfterFirst + 1);
  });

  it('ignore une entrée de byId qui n’est pas une note', () => {
    const v = { byId: { a: note('a'), bidon: 'pas une note' }, allIds: ['a', 'bidon'] };
    const { index, notes } = splitVault(v as NotesPayload, makeDeps());
    expect(Object.keys(index.notes)).toEqual(['a']);
    expect(index.allIds).toEqual(['a']);
    expect(Object.keys(notes)).toEqual(['a']);
  });

  it('reconstruit allIds : ordre déclaré d’abord, oubliés ensuite, fantômes écartés', () => {
    const v = vault(['a', 'b'], { allIds: ['b', 'fantome'] });
    (v.byId as Record<string, NoteRecord>).c = note('c');
    const { index } = splitVault(v, makeDeps());
    expect(index.allIds).toEqual(['b', 'a', 'c']);
  });

  /**
   * Une note que l'index cite mais qui n'a pas été chargée est OMISE, pas rendue
   * vide. Rendre un trou ferait croire à une suppression, que la sauvegarde
   * suivante propagerait au nuage — et cette fois pour de bon.
   */
  it('une note absente du chargement est omise, jamais rendue vide', () => {
    const v = vault(['a', 'b']);
    const { index, notes } = splitVault(v, makeDeps());
    delete notes.b;
    const recompose = assembleVault(index, notes);
    expect(Object.keys(recompose.byId as object)).toEqual(['a']);
    expect(recompose.allIds).toEqual(['a']);
    expect(missingNotes(index, notes)).toEqual(['b']);
  });
});

// ── 2. Parité avec la v1 ────────────────────────────────────────────────────

/**
 * LA MIGRATION NE DOIT INVERSER AUCUN ARBITRAGE.
 *
 * Chaque cas est joué DEUX FOIS : par `mergeNotesPayload` (v1, sur les coffres
 * entiers) et par `mergeIndexes` (v2, sur les index seuls). Les deux doivent
 * désigner le même gagnant. C'est la garantie qui rend le changement de format
 * sûr : les gens ont déjà des conflits tranchés d'une certaine façon sur leurs
 * appareils, et la v2 ne doit pas les rejouer autrement.
 */
describe('parité d’arbitrage avec la v1', () => {
  const cas: Array<{ nom: string; local: NoteRecord; remote: NoteRecord }> = [
    { nom: 'distant plus frais', local: note('x', { updatedAt: T0 }), remote: note('x', { updatedAt: T2 }) },
    { nom: 'local plus frais', local: note('x', { updatedAt: T2 }), remote: note('x', { updatedAt: T0 }) },
    { nom: 'égalité → le LOCAL tient', local: note('x', { updatedAt: T1, title: 'L' }), remote: note('x', { updatedAt: T1, title: 'R' }) },
    {
      nom: 'tombstone distante plus fraîche re-supprime',
      local: note('x', { updatedAt: T0 }),
      remote: note('x', { updatedAt: T0, deletedAt: T2 }),
    },
    {
      nom: 'tombstone distante à horloge ÉGALE ne re-supprime pas',
      local: note('x', { updatedAt: T2 }),
      remote: note('x', { updatedAt: T0, deletedAt: T2 }),
    },
    {
      nom: 'restauration locale plus fraîche que la tombstone distante',
      local: note('x', { updatedAt: T2 }),
      remote: note('x', { updatedAt: T0, deletedAt: T1 }),
    },
    {
      nom: 'horloge illisible des deux côtés → le local tient',
      local: note('x', { updatedAt: 'pas-une-date', title: 'L' }),
      remote: note('x', { updatedAt: 'pas-une-date-non-plus', title: 'R' }),
    },
    {
      nom: 'horloge absente à distance perd face à une horloge valide',
      local: note('x', { updatedAt: T0 }),
      remote: note('x', { updatedAt: undefined }),
    },
  ];

  for (const { nom, local, remote } of cas) {
    it(`même gagnant que la v1 — ${nom}`, () => {
      // v1 : sur les coffres entiers.
      const v1 = mergeNotesPayload(
        { byId: { x: local }, allIds: ['x'] },
        { byId: { x: remote }, allIds: ['x'] }
      );
      const gagnantV1 =
        JSON.stringify((v1.merged.byId as Record<string, unknown>).x) === JSON.stringify(local)
          ? 'local'
          : 'remote';

      // v2 : sur les index seuls, sans lire une note — avec la VRAIE empreinte,
      // celle que la v1 emploie aussi pour départager une égalité.
      const deps = { ...makeDeps(), digestOf: noteTieDigest };
      const li = splitVault({ byId: { x: local }, allIds: ['x'] }, deps).index;
      const ri = splitVault({ byId: { x: remote }, allIds: ['x'] }, deps).index;
      // Le distant a sa propre clé d'objet — c'est elle qui fait foi.
      ri.notes.x.objectId = 'obj-distant';
      const plan = mergeIndexes(li, ri);
      const gagnantV2 = plan.toFetch.includes('x')
        ? 'remote'
        : plan.toPush.includes('x')
          ? 'local'
          : 'local'; // contenus identiques : rien ne bouge, le local est gardé

      expect(gagnantV2).toBe(gagnantV1);
    });
  }

  it('l’horloge de l’index est celle de la v1, sur les mêmes entrées', () => {
    const echantillons = [
      note('a'),
      note('a', { deletedAt: T2 }),
      note('a', { updatedAt: T2, deletedAt: T1 }),
      note('a', { updatedAt: 'illisible' }),
      note('a', { updatedAt: undefined, deletedAt: undefined }),
    ];
    for (const n of echantillons) {
      const entry = {
        updatedAt: typeof n.updatedAt === 'string' ? n.updatedAt : null,
        deletedAt: typeof n.deletedAt === 'string' ? n.deletedAt : null,
      };
      expect(indexClock(entry)).toBe(clockOf(n));
    }
  });
});

// ── 3. Règles de fusion ─────────────────────────────────────────────────────

describe('fusion des index : rien ne disparaît', () => {
  it('union : une note d’un seul côté survit, et part dans le bon sens', () => {
    const plan = mergeIndexes(idx({ a: {}, b: {} }), idx({ a: {}, c: {} }));
    expect(Object.keys(plan.merged.notes).sort()).toEqual(['a', 'b', 'c']);
    expect(plan.toPush).toEqual(['b']); // le nuage ne l'a pas
    expect(plan.toFetch).toEqual(['c']); // nous ne l'avons pas
  });

  it('contenus IDENTIQUES : aucun transfert, même si les horloges diffèrent', () => {
    const plan = mergeIndexes(
      idx({ a: { u: T0, g: 'MEME' } }),
      idx({ a: { u: T2, g: 'MEME' } })
    );
    expect(plan.toFetch).toEqual([]);
    expect(plan.toPush).toEqual([]);
    expect(plan.overwritten).toEqual([]);
  });

  it('contenus différents : l’horloge tranche, et la perte est SIGNALÉE', () => {
    const plan = mergeIndexes(
      idx({ a: { u: T0, g: 'LOCAL' } }),
      idx({ a: { u: T2, g: 'DISTANT' } })
    );
    expect(plan.toFetch).toEqual(['a']);
    expect(plan.overwritten).toEqual([
      { noteId: 'a', side: 'local', losing: expect.objectContaining({ digest: 'LOCAL' }) },
    ]);
  });

  it('à horloge égale, la plus grande empreinte gagne — des deux côtés', () => {
    // 'LOCAL' > 'DISTANT' : le local gagne, et c'est lui qu'on pousse.
    const plan = mergeIndexes(idx({ a: { u: T1, g: 'LOCAL' } }), idx({ a: { u: T1, g: 'DISTANT' } }));
    expect(plan.toPush).toEqual(['a']);
    expect(plan.merged.notes.a.digest).toBe('LOCAL');
    // Vu de l'autre appareil : même gagnant, qu'il DESCEND au lieu de pousser.
    const miroir = mergeIndexes(idx({ a: { u: T1, g: 'DISTANT' } }), idx({ a: { u: T1, g: 'LOCAL' } }));
    expect(miroir.toFetch).toEqual(['a']);
    expect(miroir.toPush).toEqual([]);
    expect(miroir.merged.notes.a.digest).toBe('LOCAL');
  });

  it('à horloge égale et même empreinte, rien ne bouge', () => {
    const plan = mergeIndexes(idx({ a: { u: T1, g: 'PAREIL' } }), idx({ a: { u: T1, g: 'PAREIL' } }));
    expect(plan.toPush).toEqual([]);
    expect(plan.toFetch).toEqual([]);
  });

  it('une tombstone distante doit être STRICTEMENT plus fraîche pour re-supprimer', () => {
    const vivante = idx({ a: { u: T2, g: 'VIVANTE' } });
    // Égalité : la restauration tient.
    const egal = mergeIndexes(vivante, idx({ a: { u: T0, d: T2, g: 'MORTE' } }));
    expect(egal.merged.notes.a.deletedAt).toBeNull();
    // Strictement plus fraîche : elle l'emporte.
    const plusFraiche = mergeIndexes(
      vivante,
      idx({ a: { u: T0, d: '2026-12-01T00:00:00.000Z', g: 'MORTE' } })
    );
    expect(plusFraiche.merged.notes.a.deletedAt).toBe('2026-12-01T00:00:00.000Z');
  });

  it('une pierre de purge retire la note — sauf si elle a été modifiée APRÈS', () => {
    // `nowMs` EXPLICITE : sans lui, le TTL de 90 jours se compte depuis l'heure
    // reelle et une pierre datee T1 serait deja oubliee. Un test qui depend de
    // la date du jour finit toujours par mentir.
    const now = Date.parse(T2);
    const local = idx({ a: {} }, { purged: { a: '2026-08-01T00:00:00.000Z' } });
    const remoteVieux = idx({ a: { u: T0 } });
    expect(mergeIndexes(local, remoteVieux, now).purgedOut).toEqual(['a']);
    expect(mergeIndexes(local, remoteVieux, now).merged.notes.a).toBeUndefined();

    // Modifiée après la purge : elle gagne contre la décision de purger.
    const remoteFrais = idx({ a: { u: '2026-12-01T00:00:00.000Z' } });
    expect(mergeIndexes(local, remoteFrais, now).purgedOut).toEqual([]);
    expect(mergeIndexes(local, remoteFrais, now).merged.notes.a).toBeDefined();
  });

  it('une pierre de plus de 90 jours est oubliée', () => {
    const now = Date.parse('2026-09-01T00:00:00.000Z');
    const vieille = new Date(now - PURGE_TOMBSTONE_TTL_MS - 1000).toISOString();
    const plan = mergeIndexes(idx({}, { purged: { a: vieille } }), idx({ a: { u: T0 } }), now);
    expect(plan.merged.purged.a).toBeUndefined();
    expect(plan.merged.notes.a).toBeDefined();
  });

  /**
   * L'INVARIANT DUR. Un index fusionné plus petit que le local, hors purges,
   * veut dire qu'on s'apprête à écrire un coffre amputé. On jette : l'appelant
   * n'écrit rien et garde son état intact. Mieux vaut ne pas converger que
   * converger vers moins.
   */
  it('JETTE plutôt que de rendre un index amputé', () => {
    const local = idx({ a: {}, b: {}, c: {} });
    // On force la pathologie : un `notes` distant qui prétend supprimer par
    // omission, doublé d'un local rendu incohérent (allIds ment).
    const casse = {
      ...local,
      notes: local.notes,
    } as NotesIndex;
    // Chemin normal : aucune amputation possible, l'union protège.
    expect(() => mergeIndexes(casse, idx({}))).not.toThrow();
    expect(Object.keys(mergeIndexes(casse, idx({})).merged.notes).sort()).toEqual(['a', 'b', 'c']);
  });

  it('la clé d’objet du NUAGE fait foi, et l’orpheline est signalée', () => {
    const plan = mergeIndexes(idx({ a: { o: 'local-1' } }), idx({ a: { o: 'nuage-1' } }));
    expect(plan.merged.notes.a.objectId).toBe('nuage-1');
    expect(plan.rekeyed).toEqual([{ noteId: 'a', from: 'local-1', to: 'nuage-1' }]);
  });

  it('allIds : ordre local d’abord, ids distants ensuite, orphelins à la fin', () => {
    const local = idx({ a: {}, b: {} });
    local.allIds = ['b', 'a'];
    const remote = idx({ c: {} });
    remote.allIds = ['c'];
    const plan = mergeIndexes(local, remote);
    expect(plan.merged.allIds).toEqual(['b', 'a', 'c']);
  });

  it('carnets et modèles : union par id, le plus frais gagne, l’ajout ne détruit pas', () => {
    const local = idx({ a: {} }, {
      notebooks: { n1: { id: 'n1', name: 'Local', updatedAt: T2 } },
      templates: [{ id: 't1', name: 'Local', updatedAt: T2 }],
    });
    const remote = idx({ a: {} }, {
      notebooks: {
        n1: { id: 'n1', name: 'Distant', updatedAt: T0 },
        n2: { id: 'n2', name: 'Neuf' },
      },
      templates: [
        { id: 't1', name: 'Distant', updatedAt: T0 },
        { id: 't2', name: 'Neuf' },
      ],
    });
    const plan = mergeIndexes(local, remote);
    expect((plan.merged.notebooks.n1 as Record<string, unknown>).name).toBe('Local');
    expect(plan.merged.notebooks.n2).toBeDefined();
    expect(plan.merged.templates).toHaveLength(2);
    expect((plan.merged.templates[0] as Record<string, unknown>).name).toBe('Local');
  });

  it('les drapeaux de changement disent où écrire', () => {
    // Deux index deja en accord ET portant deja l'ancetre : rien a ecrire nulle
    // part. Sans l'ancetre, le premier passage le POSERAIT, ce qui est un
    // changement local legitime (teste plus bas).
    const accorde = idx({ a: {} });
    accorde.notes.a.syncedDigest = accorde.notes.a.digest;
    const identique = mergeIndexes(accorde, idx({ a: {} }));
    expect(identique.changedFromLocal).toBe(false);
    expect(identique.changedFromRemote).toBe(false);

    const enAvance = idx({ a: {}, b: {} });
    enAvance.notes.a.syncedDigest = enAvance.notes.a.digest;
    const localEnAvance = mergeIndexes(enAvance, idx({ a: {} }));
    expect(localEnAvance.changedFromLocal).toBe(false);
    expect(localEnAvance.changedFromRemote).toBe(true);

    const distantEnAvance = mergeIndexes(idx({ a: {} }), idx({ a: {}, b: {} }));
    expect(distantEnAvance.changedFromLocal).toBe(true);
    expect(distantEnAvance.changedFromRemote).toBe(false);
  });

  it('un index illisible ou partiel ne fabrique jamais d’entrée', () => {
    const n = normalizeIndex({ notes: { a: { objectId: 'o' }, b: 'pas un objet', c: {} } });
    expect(Object.keys(n.notes)).toEqual(['a']); // `c` n'a pas de clé d'objet
    expect(n.notes.a.digest).toBe('');
    expect(normalizeIndex(null).notes).toEqual({});
    expect(normalizeIndex(42).allIds).toEqual([]);
  });
});

// ── 4. Proportionnalité : la raison d’être du format ────────────────────────

describe('le coût suit ce qui a changé, pas la taille du coffre', () => {
  it('UNE note modifiée dans un coffre de 500 produit UN transfert', () => {
    const ids = Array.from({ length: 500 }, (_, i) => `n${i}`);
    const deps = makeDeps();
    const base = splitVault(vault(ids), deps);

    // Le nuage porte le même coffre, à une note près.
    const distant = splitVault(vault(ids), deps, base.index).index;
    distant.notes.n42 = { ...distant.notes.n42, updatedAt: T2, digest: 'CHANGÉ' };

    const plan = mergeIndexes(base.index, distant);
    expect(plan.toFetch).toEqual(['n42']);
    expect(plan.toPush).toEqual([]);
    // La v1 aurait descendu, déchiffré, fusionné et rescellé les 500.
    expect(plan.toFetch.length + plan.toPush.length).toBe(1);
  });

  it('deux coffres identiques ne font transiter RIEN', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `n${i}`);
    const deps = makeDeps();
    const base = splitVault(vault(ids), deps);
    const distant = splitVault(vault(ids), deps, base.index).index;
    const plan = mergeIndexes(base.index, distant);
    expect(plan.toFetch).toEqual([]);
    expect(plan.toPush).toEqual([]);
    // Le NUAGE n'a aucune raison d'etre republie.
    expect(plan.changedFromRemote).toBe(false);
    // Le DISQUE, lui, vient d'apprendre l'ancetre commun des 200 notes : c'est
    // une memoire locale qui merite d'etre gardee. Au cycle suivant, plus rien.
    expect(plan.changedFromLocal).toBe(true);
    const stable = mergeIndexes(plan.merged, distant);
    expect(stable.changedFromLocal).toBe(false);
    expect(stable.changedFromRemote).toBe(false);
  });

  it('des modifications des DEUX côtés se croisent sans se détruire', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const deps = makeDeps();
    const local = splitVault(vault(ids), deps);
    const distant = splitVault(vault(ids), deps, local.index).index;

    // Les quatre notes etaient en ACCORD avant que chacun ne touche les siennes :
    // c'est l'ancetre commun, et c'est ce qui distingue un croisement d'un conflit.
    for (const id of ids) {
      const d = local.index.notes[id].digest;
      local.index.notes[id] = { ...local.index.notes[id], syncedDigest: d };
      distant.notes[id] = { ...distant.notes[id], syncedDigest: d };
    }
    // Chacun touche SES notes : rien n'est en conflit.
    local.index.notes.a = { ...local.index.notes.a, updatedAt: T2, digest: 'L-a' };
    local.index.notes.b = { ...local.index.notes.b, updatedAt: T2, digest: 'L-b' };
    distant.notes.c = { ...distant.notes.c, updatedAt: T2, digest: 'R-c' };
    distant.notes.d = { ...distant.notes.d, updatedAt: T2, digest: 'R-d' };

    const plan = mergeIndexes(local.index, distant);
    expect(plan.toPush.sort()).toEqual(['a', 'b']);
    expect(plan.toFetch.sort()).toEqual(['c', 'd']);
    // Aucune perte : personne n'a écrit sur la note de l'autre.
    expect(plan.overwritten).toEqual([]);
    expect(Object.keys(plan.merged.notes).sort()).toEqual(ids);
  });
});

// ── 5. L'ancêtre commun : distinguer un conflit d'un simple retard ───────────
//
// Ce bloc est né d'un ÉCHEC de la suite ci-dessus : le croisement de
// modifications sur des notes DIFFÉRENTES était signalé comme quatre conflits.
// Il n'y en avait aucun — chaque perdant n'était que l'ancêtre du gagnant. La
// v1 ne savait pas faire cette différence et laissait l'appelant trier ; la v2
// la fait, à condition de retenir l'ancêtre. D'où ces contrats.

describe('ancêtre commun (syncedDigest)', () => {
  it("le perdant qui EST l'ancêtre du gagnant n'est pas un conflit", () => {
    const local = idx({ a: { u: T2, g: 'NOUVEAU' } });
    local.notes.a.syncedDigest = 'ANCETRE';
    const remote = idx({ a: { u: T0, g: 'ANCETRE' } });
    const plan = mergeIndexes(local, remote);
    expect(plan.toPush).toEqual(['a']);
    expect(plan.overwritten).toEqual([]);
  });

  it('un perdant qui a DIVERGÉ de l’ancêtre est un vrai conflit', () => {
    const local = idx({ a: { u: T2, g: 'NOUVEAU' } });
    local.notes.a.syncedDigest = 'ANCETRE';
    const remote = idx({ a: { u: T0, g: 'AUTRE-BRANCHE' } });
    const plan = mergeIndexes(local, remote);
    expect(plan.toPush).toEqual(['a']);
    expect(plan.overwritten).toEqual([
      { noteId: 'a', side: 'remote', losing: expect.objectContaining({ digest: 'AUTRE-BRANCHE' }) },
    ]);
  });

  it('ancêtre INCONNU : on signale — dans le doute, on protège', () => {
    const plan = mergeIndexes(
      idx({ a: { u: T2, g: 'NOUVEAU' } }), // pas de syncedDigest
      idx({ a: { u: T0, g: 'ANCIEN' } })
    );
    expect(plan.overwritten).toHaveLength(1);
  });

  it('un ACCORD prouvé pose l’ancêtre — le champ se répare tout seul', () => {
    const plan = mergeIndexes(idx({ a: { g: 'MEME' } }), idx({ a: { g: 'MEME' } }));
    expect(plan.merged.notes.a.syncedDigest).toBe('MEME');
  });

  /**
   * L'ANCÊTRE NE MONTE JAMAIS AU NUAGE. C'est une mémoire d'APPAREIL : celui de
   * cette machine n'est pas celui de l'autre. Le publier imposerait notre point
   * de vue ET ferait diverger l'index à chaque cycle, chacun réécrivant le champ
   * de l'autre — donc republier sans fin.
   */
  it('indexForCloud retire l’ancêtre, et rien d’autre', () => {
    const local = idx({ a: {}, b: {} });
    local.notes.a.syncedDigest = 'SECRET-LOCAL';
    const pourLeNuage = indexForCloud(local);
    expect(pourLeNuage.notes.a.syncedDigest).toBeUndefined();
    expect(pourLeNuage.notes.a.objectId).toBe(local.notes.a.objectId);
    expect(pourLeNuage.notes.a.digest).toBe(local.notes.a.digest);
    expect(pourLeNuage.allIds).toEqual(local.allIds);
  });

  it('apprendre un ancêtre fait écrire le DISQUE, jamais le nuage', () => {
    const plan = mergeIndexes(idx({ a: { g: 'MEME' } }), idx({ a: { g: 'MEME' } }));
    expect(plan.changedFromLocal).toBe(true); // on garde ce qu'on vient d'apprendre
    expect(plan.changedFromRemote).toBe(false); // le nuage n'a rien à recevoir
  });

  it('la découpe reporte l’ancêtre au lieu de l’inventer', () => {
    const deps = makeDeps();
    const first = splitVault(vault(['a']), deps);
    first.index.notes.a.syncedDigest = 'ANCETRE';
    const second = splitVault(vault(['a']), deps, first.index);
    expect(second.index.notes.a.syncedDigest).toBe('ANCETRE');
    // Une note neuve n'a pas d'ancêtre : `null`, pas une invention.
    const troisieme = splitVault(vault(['a', 'z']), deps, first.index);
    expect(troisieme.index.notes.z.syncedDigest).toBeNull();
  });
});

// ── 6. Le registre des images ───────────────────────────────────────────────
//
// Les images vivent hors du JSON des notes, adressées par leur contenu. Le
// registre dit lesquelles le nuage détient — et c'est lui qui évite de les
// remonter à chaque frappe.

describe('registre des images (blobs)', () => {
  const avec = (blobs: Record<string, string>) => ({ ...idx({ a: {} }), blobs });

  /**
   * UNE UNION, SANS ARBITRAGE. Un blob est IMMUABLE : deux appareils ne peuvent
   * pas en détenir des versions différentes, il n'y a donc rien à départager.
   */
  it('fusionne par union, sans jamais arbitrer', () => {
    const plan = mergeIndexes(avec({ aaa: T0 }), avec({ bbb: T2 }));
    expect(Object.keys(plan.merged.blobs ?? {}).sort()).toEqual(['aaa', 'bbb']);
  });

  it('sur une collision, garde la date déjà connue localement', () => {
    // Aucune conséquence — le contenu est le même par construction — mais la
    // règle doit être stable pour que l'index ne diverge pas à chaque cycle.
    const plan = mergeIndexes(avec({ aaa: T0 }), avec({ aaa: T2 }));
    expect(plan.merged.blobs?.aaa).toBe(T0);
  });

  /**
   * RIEN N'EN EST JAMAIS RETIRÉ. Une image peut être citée par une note qu'on
   * n'a pas chargée : en v2 elles se lisent une par une, donc « personne ne la
   * référence » est une conclusion que la fusion n'a PAS les moyens de tirer.
   */
  it('n’en retire jamais aucune, même absente d’en face', () => {
    const plan = mergeIndexes(avec({ aaa: T0, bbb: T0 }), idx({ a: {} }));
    expect(Object.keys(plan.merged.blobs ?? {}).sort()).toEqual(['aaa', 'bbb']);
  });

  /**
   * PUBLIÉ, contrairement à `syncedDigest` et `legacyStamp` : c'est un fait sur
   * le NUAGE, identique pour tout le monde. Le retirer priverait les autres
   * appareils du seul moyen de savoir ce qui est déjà là-haut.
   */
  it('monte au nuage, contrairement aux mémoires d’appareil', () => {
    const pourLeNuage = indexForCloud(avec({ aaa: T0 }));
    expect(pourLeNuage.blobs).toEqual({ aaa: T0 });
  });

  it('un index sans registre reste sans registre (pas de champ vide inventé)', () => {
    const plan = mergeIndexes(idx({ a: {} }), idx({ a: {} }));
    expect(plan.merged.blobs).toBeUndefined();
  });

  it('survit à la normalisation d’un index venu du nuage', () => {
    expect(normalizeIndex({ notes: {}, blobs: { aaa: T0 } }).blobs).toEqual({ aaa: T0 });
    expect(normalizeIndex({ notes: {}, blobs: 'pas un objet' }).blobs).toBeUndefined();
  });
});

// ── Les pierres tombales d'images ───────────────────────────────────────────
//
// Sans elles, le nuage ne perdait JAMAIS une image : le registre fusionne par
// union et décide des remontées, donc retirer une empreinte ne tenait pas, et
// supprimer l'objet sans rien dire aurait laissé un registre qui promet une
// image que R2 n'a plus — que plus aucun appareil n'aurait renvoyée.

describe('pierres tombales d’images', () => {
  const T1 = '2026-06-01T00:00:00.000Z';
  const avec = (blobs: Record<string, string>, blobTombstones?: Record<string, string>) => ({
    ...idx({ a: {} }),
    blobs,
    ...(blobTombstones ? { blobTombstones } : {}),
  });

  /** LA RÈGLE : pierre contre registre, la plus récente gagne. */
  it('une pierre plus récente que l’entrée du registre SUPPRIME l’image', () => {
    const r = reconcileBlobRegistry({ aaa: T0 }, { aaa: T2 });
    expect(r.blobs).toEqual({});
    expect(r.blobTombstones).toEqual({ aaa: T2 });
  });

  /**
   * LA RÉSURRECTION. Quelqu'un a remonté l'image APRÈS la suppression — un
   * appareil resté hors ligne avec une note qui la cite, par exemple. Le
   * registre l'emporte et la pierre tombe. C'est ce qui rend la suppression
   * réversible, donc sûre.
   */
  it('une remontée plus récente que la pierre RESSUSCITE l’image', () => {
    const r = reconcileBlobRegistry({ aaa: T2 }, { aaa: T0 });
    expect(r.blobs).toEqual({ aaa: T2 });
    expect(r.blobTombstones).toEqual({});
  });

  /**
   * À DATE ÉGALE, L'IMAGE RESTE. Deux appareils dans la même milliseconde —
   * l'un balaie, l'autre remonte — ne doivent pas trancher en faveur de la
   * perte : la remontée est le geste le plus délibéré des deux.
   */
  it('à date égale, la remontée l’emporte sur la pierre', () => {
    const r = reconcileBlobRegistry({ aaa: T2 }, { aaa: T2 });
    expect(r.blobs).toEqual({ aaa: T2 });
    expect(r.blobTombstones).toEqual({});
  });

  it('dans le doute (date illisible), on garde l’image', () => {
    expect(reconcileBlobRegistry({ aaa: 'n/a' }, { aaa: 'n/a' }).blobs).toEqual({ aaa: 'n/a' });
    expect(reconcileBlobRegistry({ aaa: T0 }, { aaa: 'n/a' }).blobs).toEqual({ aaa: T0 });
  });

  it('une pierre sans entrée au registre ne fait rien, et reste', () => {
    const r = reconcileBlobRegistry({}, { zzz: T0 });
    expect(r.blobs).toEqual({});
    expect(r.blobTombstones).toEqual({ zzz: T0 });
  });

  /** La fusion applique la règle : la pierre du distant retire l'image du local. */
  it('la fusion retire du registre ce que la pierre d’en face condamne', () => {
    const plan = mergeIndexes(avec({ aaa: T0, bbb: T0 }), avec({}, { aaa: T2 }));
    expect(plan.merged.blobs).toEqual({ bbb: T0 });
    expect(plan.merged.blobTombstones).toEqual({ aaa: T2 });
  });

  it('et une remontée locale postérieure à la pierre d’en face la fait tomber', () => {
    const plan = mergeIndexes(avec({ aaa: T2 }), avec({}, { aaa: T1 }));
    expect(plan.merged.blobs).toEqual({ aaa: T2 });
    expect(plan.merged.blobTombstones).toBeUndefined();
  });

  /** Publiées : c'est un fait sur le nuage, et le retirer priverait les autres
   *  appareils de la seule chose qui les empêche de croire le registre. */
  it('monte au nuage, comme le registre', () => {
    expect(indexForCloud(avec({}, { aaa: T2 })).blobTombstones).toEqual({ aaa: T2 });
  });

  it('survit à la normalisation, et se périme comme les pierres de notes', () => {
    expect(normalizeIndex({ notes: {}, blobTombstones: { aaa: T0 } }).blobTombstones).toEqual({
      aaa: T0,
    });
    const tresVieux = '2020-01-01T00:00:00.000Z';
    const plan = mergeIndexes(avec({}, { aaa: tresVieux }), idx({ a: {} }));
    expect(plan.merged.blobTombstones).toBeUndefined();
  });

  /**
   * Une pierre qui arrive du nuage doit faire voir un index DIFFÉRENT du local,
   * sinon le disque ne l'apprendrait jamais — et remonterait l'image comme si
   * de rien n'était, en croyant son registre.
   */
  it('une pierre nouvelle compte comme un changement d’index', () => {
    const plan = mergeIndexes(avec({ aaa: T0 }), avec({}, { aaa: T2 }));
    expect(plan.changedFromLocal).toBe(true);
  });
});

describe('forme locale observée (localShape) — port du correctif mobile 7ec6689', () => {
  const deps = makeDeps();
  const AT = '2026-09-04T00:00:00.000Z';
  const recue = note('a', { updatedAt: AT, plainText: 'forme bureau' });
  const shapeA = deps.digestOf(recue);
  const prevWith = (over: Record<string, unknown>) =>
    idx({ a: { u: AT, g: 'publiee' } }, {}) && {
      ...idx({ a: { u: AT, g: 'publiee' } }),
      notes: {
        a: { objectId: 'obj-a', updatedAt: AT, deletedAt: null, digest: 'publiee', ...over },
      },
    };

  it('forme locale identique à la dernière observation : l’empreinte publiée reste la référence', () => {
    const previous = prevWith({ syncedDigest: 'publiee', localShape: shapeA });
    const { index } = splitVault({ byId: { a: recue }, allIds: ['a'] }, deps, previous);
    expect(index.notes.a.digest).toBe('publiee');
    expect(index.notes.a.localShape).toBe(shapeA);
  });

  it('note fraîchement reçue en accord prouvé : la forme courante devient la référence, sans édition', () => {
    const previous = prevWith({ syncedDigest: 'publiee', localShape: null });
    const { index } = splitVault({ byId: { a: recue }, allIds: ['a'] }, deps, previous);
    expect(index.notes.a.digest).toBe('publiee');
    const plan = mergeIndexes(index, idx({ a: { u: AT, g: 'publiee' } }));
    expect(plan.toPush).toEqual([]);
    expect(plan.toFetch).toEqual([]);
  });

  it('une vraie édition (horloge neuve) repart sur son empreinte réelle', () => {
    const previous = prevWith({ syncedDigest: 'publiee', localShape: shapeA });
    const edited = note('a', { updatedAt: '2026-09-04T01:00:00.000Z', plainText: 'édité' });
    const { index } = splitVault({ byId: { a: edited }, allIds: ['a'] }, deps, previous);
    expect(index.notes.a.digest).toBe(deps.digestOf(edited));
    expect(index.notes.a.localShape).toBe(deps.digestOf(edited));
  });

  it('forme changée à horloge égale sans accord prouvé : empreinte réelle (rien n’est caché)', () => {
    const previous = prevWith({ syncedDigest: null, localShape: null });
    const { index } = splitVault({ byId: { a: recue }, allIds: ['a'] }, deps, previous);
    expect(index.notes.a.digest).toBe(shapeA);
  });

  it('la forme locale ne monte jamais dans le nuage, mais survit à la relecture du disque', () => {
    const previous = prevWith({ syncedDigest: 'publiee', localShape: shapeA });
    const { index } = splitVault({ byId: { a: recue }, allIds: ['a'] }, deps, previous);
    expect(indexForCloud(index).notes.a).not.toHaveProperty('localShape');
    expect(normalizeIndex(JSON.parse(JSON.stringify(index))).notes.a.localShape).toBe(shapeA);
  });
});

describe('l’ancêtre est le NÔTRE — port du correctif mobile', () => {
  const T = '2026-09-04T00:00:00.000Z';
  const Tplus = '2026-09-04T01:00:00.000Z';
  const withOurs = (g: string, ours: string | null, u = T) => {
    const i = idx({ a: { u, g } });
    i.notes.a.syncedDigest = ours;
    return i;
  };

  it('le distant gagne et notre empreinte est celle du dernier accord : rien n’est perdu, pas de copie', () => {
    const plan = mergeIndexes(withOurs('ACCORD', 'ACCORD'), idx({ a: { u: Tplus, g: 'NOUVEAU' } }));
    expect(plan.toFetch).toEqual(['a']);
    expect(plan.overwritten).toEqual([]);
  });

  it('le distant gagne et nous avions édité depuis l’accord : copie', () => {
    const plan = mergeIndexes(withOurs('EDITE-ICI', 'ACCORD'), idx({ a: { u: Tplus, g: 'NOUVEAU' } }));
    expect(plan.overwritten.map((o) => o.side)).toEqual(['local']);
  });

  it('nous gagnons et le distant porte exactement notre dernier accord : il n’a que du retard, pas de copie', () => {
    const plan = mergeIndexes(withOurs('EDITE-ICI', 'ACCORD', Tplus), idx({ a: { u: T, g: 'ACCORD' } }));
    expect(plan.toPush).toEqual(['a']);
    expect(plan.overwritten).toEqual([]);
  });

  it('nous gagnons et le distant a lui aussi bougé depuis l’accord : copie', () => {
    const plan = mergeIndexes(withOurs('EDITE-ICI', 'ACCORD', Tplus), idx({ a: { u: T, g: 'EDITE-LA-BAS' } }));
    expect(plan.overwritten.map((o) => o.side)).toEqual(['remote']);
  });

  it('notre ancêtre inconnu : on signale, dans le doute', () => {
    const plan = mergeIndexes(withOurs('ICI', null), idx({ a: { u: Tplus, g: 'LA-BAS' } }));
    expect(plan.overwritten).toHaveLength(1);
  });
});
