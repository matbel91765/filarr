/**
 * Fusion des notes côté DESKTOP — comportement, puis PARITÉ avec le web.
 *
 * Patron de panne verrouillé ici : le desktop écrasait `notes.enc` avec la
 * version venue du nuage. Un appareil porteur d'éditions jamais remontées
 * perdait tout. Chaque cas décrit une divergence réelle et exige que RIEN ne
 * disparaisse.
 *
 * La seconde moitié compare `electron/sync/notesMergeCore.ts` à sa SOURCE DE
 * VÉRITÉ `src/platform/web/sync/notesMerge.ts` sur un jeu de cas partagé : le
 * portage existe pour des raisons de compilation, pas pour diverger.
 */

import { describe, expect, it } from 'vitest';

import {
  applyConflictCopies,
  clockOf,
  collectEntryClocks,
  collectMergeBase,
  dropLiveSessionConflicts,
  mergeNotesPayload,
  noteTieDigest,
  preserveLiveSessionNotes,
  selectGenuineConflicts,
  type NotesMergeBase,
  type NotesPayload,
} from '../notesMergeCore';
import {
  applyConflictCopies as applyCopiesOnWeb,
  collectEntryClocks as collectClocksOnWeb,
  collectMergeBase as collectMergeBaseOnWeb,
  dropLiveSessionConflicts as dropLiveConflictsOnWeb,
  mergeNotesPayload as mergeOnWeb,
  preserveLiveSessionNotes as preserveLiveOnWeb,
  selectGenuineConflicts as selectConflictsOnWeb,
} from '../../../src/platform/web/sync/notesMerge';

const T1 = '2026-08-01T10:00:00.000Z';
const T2 = '2026-08-02T10:00:00.000Z';
const T3 = '2026-08-03T10:00:00.000Z';
/** Horloge figée pour l'expiration des pierres tombales de purge. */
const NOW = Date.parse('2026-08-14T00:00:00.000Z');

const note = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: id,
  content: '',
  updatedAt: T1,
  ...extra,
});

const payload = (over: Partial<NotesPayload> = {}): NotesPayload => ({
  byId: {},
  allIds: [],
  templates: [],
  notebooks: {},
  ...over,
});

const notesOf = (p: NotesPayload): Record<string, Record<string, unknown>> =>
  p.byId as Record<string, Record<string, unknown>>;

describe('fusion — le desktop ne perd jamais ses notes', () => {
  it('le cas du défaut : édition locale jamais remontée + version distante → UNION', () => {
    // Desktop hors ligne : note `perso` écrite ici, jamais poussée.
    // Nuage (web) : `web` écrite pendant ce temps.
    const local = payload({ byId: { perso: note('perso', { title: 'hors ligne' }) }, allIds: ['perso'] });
    const remote = payload({ byId: { web: note('web', { title: 'navigateur' }) }, allIds: ['web'] });

    const { merged, changedFromLocal, changedFromRemote } = mergeNotesPayload(local, remote);

    expect(Object.keys(notesOf(merged)).sort()).toEqual(['perso', 'web']);
    expect(notesOf(merged).perso.title).toBe('hors ligne');
    expect(merged.allIds).toEqual(['perso', 'web']); // ordre local d'abord
    expect(changedFromLocal).toBe(true); // il faut réécrire notes.enc
    expect(changedFromRemote).toBe(true); // et repousser l'union
  });

  it('collision sur la même note : la plus récente gagne, égalité au local', () => {
    const plusRecentDistant = mergeNotesPayload(
      payload({ byId: { a: note('a', { title: 'local', updatedAt: T1 }) } }),
      payload({ byId: { a: note('a', { title: 'distant', updatedAt: T2 }) } })
    );
    expect(notesOf(plusRecentDistant.merged).a.title).toBe('distant');

    // Égalité : départage déterministe par l'empreinte (voir le bloc dédié).
    const l = note('a', { title: 'local', updatedAt: T2 });
    const r = note('a', { title: 'distant', updatedAt: T2 });
    const egalite = mergeNotesPayload(payload({ byId: { a: l } }), payload({ byId: { a: r } }));
    expect(notesOf(egalite.merged).a.title).toBe(noteTieDigest(r) > noteTieDigest(l) ? 'distant' : 'local');
  });

  it('la suppression faite ailleurs arrive, mais ne ressuscite pas une reprise locale', () => {
    const suppressionDistante = mergeNotesPayload(
      payload({ byId: { a: note('a', { updatedAt: T1 }) }, allIds: ['a'] }),
      payload({ byId: { a: note('a', { updatedAt: T1, deletedAt: T2 }) }, allIds: ['a'] })
    );
    expect(notesOf(suppressionDistante.merged).a.deletedAt).toBe(T2);

    const repriseLocale = mergeNotesPayload(
      payload({ byId: { a: note('a', { title: 'reprise', updatedAt: T3 }) } }),
      payload({ byId: { a: note('a', { updatedAt: T1, deletedAt: T2 }) } })
    );
    expect(notesOf(repriseLocale.merged).a.title).toBe('reprise');
    expect(notesOf(repriseLocale.merged).a.deletedAt).toBeUndefined();
  });

  it('carnets, modèles et champs inconnus : union, jamais de rétrécissement', () => {
    const local = payload({
      byId: { a: note('a') },
      allIds: ['a'],
      notebooks: { n1: { id: 'n1', name: 'local' }, n2: { id: 'n2', name: 'mien' } },
      templates: [{ id: 'tpl', name: 'mien' }],
      reglageInconnu: { theme: 'local' },
    });
    const remote = payload({
      byId: { b: note('b') },
      allIds: ['b'],
      notebooks: { n1: { id: 'n1', name: 'distant', updatedAt: T3 }, n3: { id: 'n3', name: 'sien' } },
      templates: [{ id: 'autre', name: 'sien', updatedAt: T2 }],
      reglageInconnu: { theme: 'distant' },
      inventionDistante: [1, 2, 3],
    });

    const { merged } = mergeNotesPayload(local, remote);
    expect(Object.keys(merged.notebooks as Record<string, unknown>).sort()).toEqual(['n1', 'n2', 'n3']);
    expect((merged.notebooks as Record<string, { name: string }>).n1.name).toBe('distant');
    expect((merged.templates as Array<{ id: string }>).map((t) => t.id)).toEqual(['tpl', 'autre']);
    expect(merged.reglageInconnu).toEqual({ theme: 'local' }); // le local prime
    expect(merged.inventionDistante).toEqual([1, 2, 3]); // le distant est adopté
  });

  it('deux payloads identiques : ni réécriture, ni remontée (pas de boucle de sync)', () => {
    const p = payload({
      byId: { a: note('a') },
      allIds: ['a'],
      notebooks: { n: { id: 'n', name: 'carnet' } },
      templates: [{ id: 't' }],
    });
    const { changedFromLocal, changedFromRemote, remoteContentChanged } = mergeNotesPayload(
      p,
      JSON.parse(JSON.stringify(p))
    );
    expect(changedFromLocal).toBe(false);
    expect(changedFromRemote).toBe(false);
    expect(remoteContentChanged).toBe(false);
  });

  it('refuse une fusion qui rendrait moins de notes que le local (filet dur)', () => {
    // Un `byId` local de 3 notes ne peut pas rendre 2 : `downloadAndMergeNotes`
    // compte sur cette exception pour ne RIEN écrire.
    const local = payload({ byId: { a: note('a'), b: note('b'), c: note('c') } });
    const remote = payload({ byId: { a: note('a') } });
    expect(() => mergeNotesPayload(local, remote)).not.toThrow(); // union : 3 notes, rien à refuser
    expect(Object.keys(notesOf(mergeNotesPayload(local, remote).merged)).sort()).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('une purge définitive distante retire la note, une reprise postérieure la garde', () => {
    const purgeeAilleurs = mergeNotesPayload(
      payload({ byId: { a: note('a', { updatedAt: T1 }) }, allIds: ['a'] }),
      payload({ byId: {}, allIds: [], purged: { a: T2 } }),
      NOW
    );
    expect(Object.keys(notesOf(purgeeAilleurs.merged))).toEqual([]);

    const repriseApresPurge = mergeNotesPayload(
      payload({ byId: { a: note('a', { updatedAt: T3 }) }, allIds: ['a'] }),
      payload({ byId: {}, allIds: [], purged: { a: T2 } }),
      NOW
    );
    expect(Object.keys(notesOf(repriseApresPurge.merged))).toEqual(['a']);
  });

  it('clockOf prend la plus récente des dates de mutation', () => {
    expect(clockOf({ updatedAt: T1, deletedAt: T2 })).toBe(Date.parse(T2));
    expect(clockOf({ updatedAt: T3, deletedAt: T2 })).toBe(Date.parse(T3));
    expect(clockOf({ updatedAt: 'hier matin' })).toBe(-Infinity);
    expect(clockOf(null)).toBe(-Infinity);
  });
});

// ── Copies de conflit ───────────────────────────────────────────────────────

/**
 * Le desktop fabrique depuis toujours un `_conflict_<horodatage>` pour un
 * fichier ordinaire ; pour les notes, l'arbitrage d'horloge jetait le contenu
 * perdant sans trace. `noteVersionService` n'était pas une réponse : son API
 * publique n'archive pas une version arbitraire (dédup par empreinte, seuil
 * d'intervalle), donc une version DISTANTE perdue y serait écartée en silence.
 */
describe('copies de conflit — le contenu écrasé ne part plus sans trace', () => {
  const NOW_ISO = '2026-08-14T12:00:00.000Z';
  const ancetre = (clock: string): NotesMergeBase => ({
    notes: { a: Date.parse(clock) },
    notebooks: {},
  });

  const collision = (localTitle: string, localAt: string, remoteTitle: string, remoteAt: string) =>
    mergeNotesPayload(
      payload({ byId: { a: note('a', { title: localTitle, updatedAt: localAt }) }, allIds: ['a'] }),
      payload({ byId: { a: note('a', { title: remoteTitle, updatedAt: remoteAt }) }, allIds: ['a'] })
    );

  it('contenus différents + horloge qui tranche : la perdante est rapportée puis copiée', () => {
    const result = collision('ici', T2, 'ailleurs', T3);
    expect(result.overwritten).toHaveLength(1);
    expect(result.overwritten[0]).toMatchObject({ id: 'a', kind: 'note', side: 'local' });

    const kept = selectGenuineConflicts(result.overwritten, result.merged, ancetre(T1), null);
    expect(applyConflictCopies(result.merged, kept, { now: NOW_ISO, newId: () => 'copie' })).toBe(1);
    expect(notesOf(result.merged).a.title).toBe('ailleurs'); // gagnante intacte
    expect(notesOf(result.merged).copie).toMatchObject({
      id: 'copie',
      // Suffixe NEUTRE (EN/FR) — voir `conflictTitleSuffix`.
      title: 'ici (⚠ 2026-08-14)',
      conflictOfId: 'a',
    });
    expect(result.merged.allIds).toContain('copie');
  });

  it('contenus identiques : aucune copie (sinon une par cycle, pour rien)', () => {
    const result = mergeNotesPayload(
      payload({ byId: { a: note('a') }, allIds: ['a'] }),
      payload({ byId: { a: note('a') }, allIds: ['a'] })
    );
    expect(result.overwritten).toEqual([]);
    expect(selectGenuineConflicts(result.overwritten, result.merged, ancetre(T1), null)).toEqual([]);
  });

  it('un seul côté rattrape son retard : aucune copie', () => {
    const result = collision('ancêtre', T1, 'édité ailleurs', T2);
    expect(selectGenuineConflicts(result.overwritten, result.merged, ancetre(T1), null)).toEqual([]);
  });

  it('entrée présente d’un seul côté : rien de rapporté', () => {
    const result = mergeNotesPayload(
      payload({ byId: { a: note('a') }, allIds: ['a'] }),
      payload({ byId: { b: note('b') }, allIds: ['b'] })
    );
    expect(result.overwritten).toEqual([]);
  });
});

describe('parité desktop ↔ web — copies de conflit', () => {
  const NOW_ISO = '2026-08-14T12:00:00.000Z';
  const base: NotesMergeBase = {
    // `sansHorloge: null` = « connue de la base, sans horloge lisible » : les
    // deux côtés doivent en conclure « elle n'a pas bougé », donc aucune copie.
    notes: { a: Date.parse(T1), sansHorloge: null },
    notebooks: { n1: Date.parse(T1) },
  };
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

  const local = payload({
    byId: {
      // Note LOURDEMENT placée : la copie doit hériter du contenu, pas de la
      // place — deux notes du jour pour la même date, deux cartes au même rang.
      a: note('a', {
        title: 'ici',
        content: 'écrit ici',
        updatedAt: T2,
        isDaily: true,
        dailyDate: '2026-08-10',
        scheduledDate: '2026-08-11',
        viewPositions: { canvas: { x: 1, y: 2 } },
        viewSizes: { canvas: { w: 3, h: 4 } },
        kanbanOrder: 5,
        manualOrder: 6,
        kanbanStatus: 'in-progress',
      }),
      // Sans horloge lisible des DEUX côtés : c'est le cas que la base doit
      // mémoriser explicitement (`null`), sous peine de divergence éternelle.
      sansHorloge: { id: 'sansHorloge', title: 'ici' },
    },
    allIds: ['a', 'sansHorloge'],
    notebooks: { n1: { id: 'n1', name: 'ici', updatedAt: T3 } },
  });
  const remote = payload({
    byId: {
      a: note('a', { title: 'ailleurs', content: 'écrit ailleurs', updatedAt: T3 }),
      sansHorloge: { id: 'sansHorloge', title: 'ailleurs' },
    },
    allIds: ['a', 'sansHorloge'],
    notebooks: { n1: { id: 'n1', name: 'ailleurs', updatedAt: T2 } },
  });

  it('les deux implémentations rapportent, trient et copient à l’identique', () => {
    const run = (
      merge: typeof mergeNotesPayload,
      select: typeof selectGenuineConflicts,
      apply: typeof applyConflictCopies
    ) => {
      const result = merge(clone(local), clone(remote), NOW);
      const kept = select(result.overwritten, result.merged, clone(base), null);
      let n = 0;
      const created = apply(result.merged, kept, { now: NOW_ISO, newId: () => `copie-${++n}` });
      return { overwritten: result.overwritten, kept, created, merged: result.merged };
    };

    const desktop = run(mergeNotesPayload, selectGenuineConflicts, applyConflictCopies);
    const web = run(mergeOnWeb, selectConflictsOnWeb, applyCopiesOnWeb);

    expect(desktop.overwritten).toEqual(web.overwritten);
    expect(desktop.kept).toEqual(web.kept);
    expect(desktop.created).toBe(web.created);
    expect(desktop.created).toBe(2); // la note ET le carnet
    expect(desktop.merged).toEqual(web.merged);

    // Les DEUX côtés neutralisent les mêmes champs de placement, et titrent la
    // copie de la même marque NEUTRE (l'application est EN/FR).
    const copie = notesOf(desktop.merged)['copie-1'];
    expect(copie).toMatchObject({ title: 'ici (⚠ 2026-08-14)', kanbanStatus: 'in-progress' });
    expect(copie.isDaily).toBe(false);
    for (const champ of [
      'dailyDate',
      'scheduledDate',
      'viewPositions',
      'viewSizes',
      'kanbanOrder',
      'manualOrder',
    ]) {
      expect(copie[champ]).toBeUndefined();
    }
  });

  it('collectEntryClocks rend le même instantané des deux côtés', () => {
    const desktop = collectEntryClocks(clone(local));
    expect(desktop).toEqual(collectClocksOnWeb(clone(local)));
    // « Sans horloge » est mémorisé, pas omis : omettre le rendait
    // indistinguable d'« inconnu », donc éternellement divergent.
    expect(desktop.notes.sansHorloge).toBeNull();
  });
});

// ── Parité avec la source de vérité (web) ───────────────────────────────────

/** Jeu de cas PARTAGÉ : chaque paire doit donner le même résultat des deux côtés. */
const CAS_PARTAGES: Array<{ nom: string; local: unknown; remote: unknown }> = [
  {
    nom: 'union simple (édition locale jamais remontée face au nuage)',
    local: payload({ byId: { perso: note('perso') }, allIds: ['perso'] }),
    remote: payload({ byId: { web: note('web') }, allIds: ['web'] }),
  },
  {
    nom: 'collision — distant plus récent',
    local: payload({ byId: { a: note('a', { title: 'local', updatedAt: T1 }) }, allIds: ['a'] }),
    remote: payload({ byId: { a: note('a', { title: 'distant', updatedAt: T2 }) }, allIds: ['a'] }),
  },
  {
    nom: 'collision — égalité d’horloge',
    local: payload({ byId: { a: note('a', { title: 'local', updatedAt: T2 }) } }),
    remote: payload({ byId: { a: note('a', { title: 'distant', updatedAt: T2 }) } }),
  },
  {
    nom: 'horloges absentes ou illisibles des deux côtés',
    local: payload({ byId: { a: { id: 'a', title: 'local' } } }),
    remote: payload({ byId: { a: note('a', { title: 'distant', updatedAt: 'hier' }) } }),
  },
  {
    nom: 'tombstone distante contre note locale vivante (résurrection)',
    local: payload({ byId: { a: note('a', { updatedAt: T2 }) }, allIds: ['a'] }),
    remote: payload({ byId: { a: note('a', { updatedAt: T1, deletedAt: T2 }) }, allIds: ['a'] }),
  },
  {
    nom: 'tombstone strictement plus fraîche',
    local: payload({ byId: { a: note('a', { updatedAt: T1 }) }, allIds: ['a'] }),
    remote: payload({ byId: { a: note('a', { updatedAt: T1, deletedAt: T3 }) }, allIds: ['a'] }),
  },
  {
    nom: 'allIds — ordre local, nouveautés distantes, orphelin et référence morte',
    local: payload({ byId: { c: note('c'), a: note('a'), orphelin: note('orphelin') }, allIds: ['c', 'a', 'fantome'] }),
    remote: payload({ byId: { b: note('b'), a: note('a') }, allIds: ['b', 'a'] }),
  },
  {
    nom: 'carnets et modèles',
    local: payload({
      notebooks: { n1: { id: 'n1', name: 'local', updatedAt: T2 }, n2: { id: 'n2', name: 'mien' } },
      templates: [{ id: 'tpl', name: 'intégré' }, { name: 'anonyme' }],
    }),
    remote: payload({
      notebooks: { n1: { id: 'n1', name: 'distant', updatedAt: T3 }, n3: { id: 'n3', name: 'sien' } },
      templates: [{ id: 'tpl', name: 'intégré distant', updatedAt: T2 }, { name: 'anonyme' }, { id: 'z' }],
    }),
  },
  {
    nom: 'champs hors contrat',
    local: payload({ byId: { a: note('a') }, reglagesFuturs: { theme: 'local' } }),
    remote: payload({ byId: { a: note('a') }, reglagesFuturs: { theme: 'distant' }, invention: [1, 2] }),
  },
  {
    nom: 'local de forme invalide',
    local: { byId: 'corrompu', allIds: null },
    remote: payload({ byId: { a: note('a') }, allIds: ['a'] }),
  },
  {
    nom: 'local absent (premier appareil)',
    local: {},
    remote: payload({ byId: { a: note('a') }, allIds: ['a'] }),
  },
  {
    nom: 'purges définitives — expirées, actives, et reprise postérieure',
    local: payload({
      byId: { a: note('a', { updatedAt: T1 }), b: note('b', { updatedAt: T3 }), c: note('c') },
      allIds: ['a', 'b', 'c'],
      purged: { vieille: '2024-01-01T00:00:00.000Z' },
    }),
    remote: payload({
      byId: { c: note('c') },
      allIds: ['c'],
      purged: { a: T2, b: T2 },
      purgedNotebooks: { n9: T2 },
    }),
  },
  {
    nom: 'payloads identiques',
    local: payload({ byId: { a: note('a') }, allIds: ['a'], templates: [{ id: 't' }] }),
    remote: payload({ byId: { a: note('a') }, allIds: ['a'], templates: [{ id: 't' }] }),
  },
  {
    nom: 'divergence destructrice — notes ET carnets, dans les deux sens',
    local: payload({
      byId: {
        perdue: note('perdue', { title: 'ici', updatedAt: T1 }),
        gagnee: note('gagnee', { title: 'ici', updatedAt: T3 }),
        intacte: note('intacte'),
      },
      allIds: ['perdue', 'gagnee', 'intacte'],
      notebooks: { n1: { id: 'n1', name: 'ici', updatedAt: T3 } },
    }),
    remote: payload({
      byId: {
        perdue: note('perdue', { title: 'ailleurs', updatedAt: T2 }),
        gagnee: note('gagnee', { title: 'ailleurs', updatedAt: T2 }),
        intacte: note('intacte'),
      },
      allIds: ['perdue', 'gagnee', 'intacte'],
      notebooks: { n1: { id: 'n1', name: 'ailleurs', updatedAt: T2 } },
    }),
  },
  {
    nom: 'divergence effacée par une purge (rien à sauver)',
    local: payload({ byId: { a: note('a', { title: 'ici', updatedAt: T1 }) }, allIds: ['a'] }),
    remote: payload({
      byId: { a: note('a', { title: 'ailleurs', updatedAt: T2 }) },
      allIds: ['a'],
      purged: { a: T3 },
    }),
  },
];

describe('parité desktop ↔ web (source de vérité : src/platform/web/sync/notesMerge.ts)', () => {
  for (const cas of CAS_PARTAGES) {
    it(`donne le même résultat que le web : ${cas.nom}`, () => {
      // Chaque implémentation reçoit sa PROPRE copie : la fusion peut muter les
      // sous-objets qu'elle réutilise, une entrée partagée fausserait la
      // comparaison.
      const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
      const desktop = mergeNotesPayload(clone(cas.local), clone(cas.remote), NOW);
      const web = mergeOnWeb(clone(cas.local), clone(cas.remote), NOW);

      expect(desktop.merged).toEqual(web.merged);
      // Drapeaux COMMUNS aux deux résultats : si le web en ajoute un nouveau, la
      // parité du contenu reste vérifiée sans casser sur un champ que le portage
      // n'a pas encore.
      for (const flag of Object.keys(desktop) as Array<keyof typeof desktop>) {
        if (flag === 'merged' || !(flag in web)) continue;
        expect({ [flag]: desktop[flag] }).toEqual({ [flag]: web[flag as keyof typeof web] });
      }
    });
  }

  it('refuse dans les MÊMES cas que le web (filet anti-rétrécissement)', () => {
    // Une purge locale non déclarée côté distant ne peut pas amputer le local :
    // les deux implémentations doivent se comporter à l'identique, y compris
    // quand elles jettent.
    const local = payload({ byId: { a: note('a'), b: note('b') }, allIds: ['a', 'b'] });
    const remote = payload({ byId: {}, allIds: [], purged: { a: T2, b: T2 } });

    const desktopThrew = (() => {
      try {
        mergeNotesPayload(JSON.parse(JSON.stringify(local)), JSON.parse(JSON.stringify(remote)), NOW);
        return false;
      } catch {
        return true;
      }
    })();
    const webThrew = (() => {
      try {
        mergeOnWeb(JSON.parse(JSON.stringify(local)), JSON.parse(JSON.stringify(remote)), NOW);
        return false;
      } catch {
        return true;
      }
    })();

    expect(desktopThrew).toBe(webThrew);
  });
});

// ── Garde des sessions vivantes ─────────────────────────────────────────────

describe('preserveLiveSessionNotes — parité, et une note vivante n’est jamais écrasée', () => {
  const live = (...ids: string[]) => (id: string) => ids.includes(id);

  it('rétablit la version locale d’une note en session, des deux côtés à l’identique', () => {
    const local = payload({
      byId: { a: note('a', { content: 'en cours de frappe' }) },
      allIds: ['a'],
    });
    const remote = payload({
      byId: { a: note('a', { content: 'venu du nuage', updatedAt: T3 }) },
      allIds: ['a'],
    });
    const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

    const desktop = mergeNotesPayload(clone(local), clone(remote), NOW);
    const heldDesktop = preserveLiveSessionNotes(local, desktop.merged, live('a'));
    const web = mergeOnWeb(clone(local), clone(remote), NOW);
    const heldWeb = preserveLiveOnWeb(local, web.merged, live('a'));

    expect(heldDesktop).toEqual(['a']);
    expect(heldWeb).toEqual(heldDesktop);
    expect(desktop.merged).toEqual(web.merged);
    expect((desktop.merged.byId as Record<string, { content: string }>).a.content).toBe(
      'en cours de frappe'
    );
  });

  it('remet dans l’index une note vivante qu’une purge distante avait retirée', () => {
    const local = payload({ byId: { a: note('a', { content: 'en cours' }) }, allIds: ['a'] });
    const remote = payload({ byId: {}, allIds: [], purged: { a: T3 } });

    const { merged } = mergeNotesPayload(local, remote, NOW);
    expect((merged.byId as Record<string, unknown>).a).toBeUndefined();

    expect(preserveLiveSessionNotes(local, merged, live('a'))).toEqual(['a']);
    expect((merged.byId as Record<string, unknown>).a).toBeDefined();
    expect(merged.allIds).toContain('a');
  });

  it('ne retient rien quand aucune session ne tourne', () => {
    const local = payload({ byId: { a: note('a', { content: 'local' }) }, allIds: ['a'] });
    const remote = payload({
      byId: { a: note('a', { content: 'nuage', updatedAt: T3 }) },
      allIds: ['a'],
    });
    const { merged } = mergeNotesPayload(local, remote, NOW);

    expect(preserveLiveSessionNotes(local, merged, live())).toEqual([]);
    expect((merged.byId as Record<string, { content: string }>).a.content).toBe('nuage');
  });
});

describe('dropLiveSessionConflicts — parité, et pas de copie pendant la collaboration', () => {
  const live =
    (...ids: string[]) =>
    (id: string) =>
      ids.includes(id);

  /**
   * Deux appareils écrivent la MÊME note par le CRDT ; chacun est le dernier
   * écrivain chez lui, donc l'arbitrage donne le LOCAL gagnant et
   * `preserveLiveSessionNotes` n'a rien à rétablir. Filtrer les copies de
   * conflit sur SA liste laissait donc passer l'entrée : une copie par cycle,
   * sur les deux appareils, pendant toute la session.
   */
  const collaboration = () => {
    const local = payload({
      byId: { a: note('a', { content: 'frappe vue ici', updatedAt: T3 }) },
      allIds: ['a'],
    });
    const remote = payload({
      byId: { a: note('a', { content: 'frappe vue là-bas', updatedAt: T2 }) },
      allIds: ['a'],
    });
    const base: NotesMergeBase = { notes: { a: Date.parse(T1) }, notebooks: {} };
    return { local, remote, base };
  };

  it('desktop et web écartent exactement les mêmes entrées', () => {
    const { local, remote } = collaboration();
    const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

    const desktop = mergeNotesPayload(clone(local), clone(remote), NOW);
    const web = mergeOnWeb(clone(local), clone(remote), NOW);

    expect(desktop.overwritten).toHaveLength(1);
    expect(preserveLiveSessionNotes(local, desktop.merged, live('a'))).toEqual([]); // rien à rétablir
    expect(dropLiveSessionConflicts(desktop.overwritten, live('a'))).toEqual([]);
    expect(dropLiveSessionConflicts(desktop.overwritten, live('a'))).toEqual(
      dropLiveConflictsOnWeb(web.overwritten, live('a'))
    );
  });

  it('aucune copie de conflit pour une note en session', () => {
    const { local, remote, base } = collaboration();
    const merged = mergeNotesPayload(local, remote, NOW);

    const kept = selectGenuineConflicts(
      dropLiveSessionConflicts(merged.overwritten, live('a')),
      merged.merged,
      base,
      null
    );

    expect(applyConflictCopies(merged.merged, kept, { now: T3, newId: () => 'copie' })).toBe(0);
  });

  it('mais une copie pour la même divergence HORS session (preuve du défaut)', () => {
    const { local, remote, base } = collaboration();
    const merged = mergeNotesPayload(local, remote, NOW);

    const kept = selectGenuineConflicts(merged.overwritten, merged.merged, base, null);

    expect(applyConflictCopies(merged.merged, kept, { now: T3, newId: () => 'copie' })).toBe(1);
  });
});

/**
 * ANCÊTRE À DEUX CÔTÉS — parité stricte sur la règle qui décide d'une copie.
 *
 * La base ne portait qu'une table, remplie avec l'UNION scellée en local. Un
 * cycle qui fusionnait sans remonter la faisait avancer sur des écritures que le
 * nuage n'avait jamais vues, et le cycle suivant prenait l'horloge distante
 * RESTÉE EN ARRIÈRE pour un mouvement : copie de conflit d'une note que personne
 * d'autre n'avait touchée. Les deux implémentations doivent trancher à
 * l'identique dans chacun de ces cas, sinon le web et le desktop fabriquent des
 * copies différentes du même conflit.
 */
describe('ancêtre à deux côtés — parité desktop ↔ web sur la décision de copier', () => {
  const T0 = '2026-07-31T10:00:00.000Z';
  const ms = (iso: string) => Date.parse(iso);

  const collision = (localAt: string, remoteAt: string, memeTexte = false) => {
    const local = payload({
      byId: { a: note('a', { title: 'ici', content: 'écrit ici', updatedAt: localAt }) },
      allIds: ['a'],
    });
    const remote = payload({
      byId: {
        a: note('a', {
          title: memeTexte ? 'ici' : 'ailleurs',
          content: memeTexte ? 'écrit ici' : 'écrit ailleurs',
          updatedAt: remoteAt,
        }),
      },
      allIds: ['a'],
    });
    const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
    return {
      desktop: mergeNotesPayload(clone(local), clone(remote), NOW),
      web: mergeOnWeb(clone(local), clone(remote), NOW),
    };
  };

  /** Rend le verdict des DEUX implémentations, après avoir vérifié qu'il est le même. */
  const verdict = (
    cas: ReturnType<typeof collision>,
    base: NotesMergeBase,
    agreedAt: number | null = null
  ) => {
    const ici = selectGenuineConflicts(cas.desktop.overwritten, cas.desktop.merged, base, agreedAt);
    const laBas = selectConflictsOnWeb(cas.web.overwritten, cas.web.merged, base, agreedAt);
    expect(laBas.map((e) => e.id)).toEqual(ici.map((e) => e.id));
    expect(laBas.map((e) => e.side)).toEqual(ici.map((e) => e.side));
    return ici;
  };

  it('base HÉRITÉE (une seule table) en avance sur le nuage → aucune copie, des deux côtés', () => {
    expect(verdict(collision(T3, T1), { notes: { a: ms(T2) }, notebooks: {} })).toEqual([]);
  });

  it('le nuage est resté où on l’avait laissé → aucune copie, des deux côtés', () => {
    const base: NotesMergeBase = {
      notes: { a: ms(T2) },
      notebooks: {},
      remote: { notes: { a: ms(T1) }, notebooks: {} },
    };
    expect(verdict(collision(T3, T1), base)).toEqual([]);
  });

  it('notre propre union qui revient du nuage → aucune copie, des deux côtés', () => {
    const base: NotesMergeBase = {
      notes: { a: ms(T2) },
      notebooks: {},
      remote: { notes: { a: ms(T1) }, notebooks: {} },
    };
    expect(verdict(collision(T3, T2), base)).toEqual([]);
  });

  it('le nuage a VRAIMENT écrit → une copie, des deux côtés', () => {
    const base: NotesMergeBase = {
      notes: { a: ms(T2) },
      notebooks: {},
      remote: { notes: { a: ms(T0) }, notebooks: {} },
    };
    expect(verdict(collision(T3, T1), base)).toHaveLength(1);
  });

  it('substance identique, horloges différentes → aucune copie, des deux côtés', () => {
    const base: NotesMergeBase = {
      notes: { a: ms(T0) },
      notebooks: {},
      remote: { notes: { a: ms(T0) }, notebooks: {} },
    };
    expect(verdict(collision(T2, T3, true), base)).toEqual([]);
  });

  it('collectMergeBase rend la même base des deux côtés', () => {
    const local = payload({ byId: { a: note('a', { updatedAt: T2 }) } });
    const remote = payload({ byId: { a: note('a', { updatedAt: T1 }) } });
    expect(collectMergeBase(local, remote)).toEqual(collectMergeBaseOnWeb(local, remote));
    expect(collectMergeBase(local, remote).remote).toEqual(collectClocksOnWeb(remote));
  });

  it('la copie porte sa provenance, à l’identique des deux côtés', () => {
    const base: NotesMergeBase = {
      notes: { a: ms(T2) },
      notebooks: {},
      remote: { notes: { a: ms(T0) }, notebooks: {} },
    };
    const cas = collision(T3, T1);
    const options = { now: T3, newId: () => 'copie', device: 'desktop' };
    expect(
      applyConflictCopies(cas.desktop.merged, verdict(cas, base), options)
    ).toBe(1);
    expect(
      applyCopiesOnWeb(cas.web.merged, selectConflictsOnWeb(cas.web.overwritten, cas.web.merged, base, null), options)
    ).toBe(1);
    expect(notesOf(cas.desktop.merged).copie).toEqual(notesOf(cas.web.merged).copie);
    expect(notesOf(cas.desktop.merged).copie).toMatchObject({
      conflictOfId: 'a',
      conflictSide: 'remote',
      conflictDevice: 'desktop',
      conflictOriginalUpdatedAt: T1,
      conflictKeptUpdatedAt: T3,
    });
  });
});

describe('égalité d’horloge — départage déterministe', () => {
  it('contenus différents : les deux perspectives désignent le même gagnant, celui de la plus grande empreinte', () => {
    const a = note('a', { title: 'ici', updatedAt: T2 });
    const b = note('a', { title: 'là-bas', updatedAt: T2 });
    const attendu = noteTieDigest(b) > noteTieDigest(a) ? 'là-bas' : 'ici';
    const vuDIci = mergeNotesPayload(
      payload({ byId: { a }, allIds: ['a'] }),
      payload({ byId: { a: b }, allIds: ['a'] })
    );
    const vuDeLaBas = mergeNotesPayload(
      payload({ byId: { a: b }, allIds: ['a'] }),
      payload({ byId: { a }, allIds: ['a'] })
    );
    expect(notesOf(vuDIci.merged).a.title).toBe(attendu);
    expect(notesOf(vuDeLaBas.merged).a.title).toBe(attendu);
    // Un seul des deux a quelque chose à pousser : celui qui porte le gagnant.
    expect(vuDIci.changedFromRemote).toBe(attendu === 'ici');
    expect(vuDeLaBas.changedFromRemote).toBe(attendu === 'là-bas');
  });

  it('contenus identiques : le local reste et rien n’est à pousser', () => {
    const a = note('a', { title: 'pareil', updatedAt: T2 });
    const r = mergeNotesPayload(
      payload({ byId: { a }, allIds: ['a'] }),
      payload({ byId: { a: { ...a } }, allIds: ['a'] })
    );
    expect(notesOf(r.merged).a).toEqual(a);
    expect(r.changedFromRemote).toBe(false);
    expect(r.changedFromLocal).toBe(false);
  });

  it('tombstone locale face à une vivante distante à horloge égale : la vivante tient (miroir)', () => {
    const morte = note('a', { updatedAt: T1, deletedAt: T2 });
    const vivante = note('a', { updatedAt: T2 });
    const r = mergeNotesPayload(payload({ byId: { a: morte } }), payload({ byId: { a: vivante } }));
    expect(notesOf(r.merged).a.deletedAt).toBeUndefined();
  });

  it('l’empreinte de départage est celle de la v2 : SHA-256 à clés triées, 32 hexadécimaux', () => {
    expect(noteTieDigest({ b: 1, a: 2 })).toBe(noteTieDigest({ a: 2, b: 1 }));
    expect(noteTieDigest({ a: 1 })).toMatch(/^[0-9a-f]{32}$/);
  });
});
