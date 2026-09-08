/**
 * Fusion NOTE À NOTE du store de notes — la fonction pure, sans IndexedDB ni
 * crypto.
 *
 * Patron de panne verrouillé ici : le dernier-écrivain-gagne au niveau du BLOB.
 * Le web et le desktop écrivent tous deux `notes.enc` en entier ; sans fusion,
 * le premier des deux qui pousse efface tout ce que l'autre a écrit depuis leur
 * dernière rencontre. Chaque cas ci-dessous décrit une divergence réelle et
 * exige que RIEN ne disparaisse.
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
} from '../notesMerge';

const T1 = '2026-08-01T10:00:00.000Z';
const T2 = '2026-08-02T10:00:00.000Z';
const T3 = '2026-08-03T10:00:00.000Z';

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

/** Raccourci de lecture : les notes fusionnées, typées. */
const notesOf = (p: NotesPayload): Record<string, Record<string, unknown>> =>
  p.byId as Record<string, Record<string, unknown>>;

describe('byId — union et arbitrage par horodatage', () => {
  it('unit les notes que seul un côté possède, sans en perdre une seule', () => {
    const local = payload({ byId: { a: note('a') }, allIds: ['a'] });
    const remote = payload({ byId: { b: note('b') }, allIds: ['b'] });

    const { merged, changedFromLocal, changedFromRemote } = mergeNotesPayload(local, remote);

    expect(Object.keys(notesOf(merged)).sort()).toEqual(['a', 'b']);
    expect(merged.allIds).toEqual(['a', 'b']); // ordre local d'abord
    expect(changedFromLocal).toBe(true);
    expect(changedFromRemote).toBe(true);
  });

  it('collision : le distant plus récent gagne', () => {
    const local = payload({ byId: { a: note('a', { title: 'local', updatedAt: T1 }) } });
    const remote = payload({ byId: { a: note('a', { title: 'distant', updatedAt: T2 }) } });

    const { merged } = mergeNotesPayload(local, remote);
    expect(notesOf(merged).a.title).toBe('distant');
  });

  it('collision : le local plus récent gagne', () => {
    const local = payload({
      byId: { a: note('a', { title: 'local', updatedAt: T3 }) },
      allIds: ['a'],
    });
    const remote = payload({
      byId: { a: note('a', { title: 'distant', updatedAt: T2 }) },
      allIds: ['a'],
    });

    const { merged, changedFromLocal, changedFromRemote } = mergeNotesPayload(local, remote);
    expect(notesOf(merged).a.title).toBe('local');
    expect(changedFromLocal).toBe(false); // rien à réécrire localement
    expect(changedFromRemote).toBe(true); // mais du neuf à pousser
  });

  it('égalité d’horodatage : départage déterministe par l’empreinte (voir plus bas)', () => {
    const l = note('a', { title: 'local', updatedAt: T2 });
    const r = note('a', { title: 'distant', updatedAt: T2 });
    const attendu = noteTieDigest(r) > noteTieDigest(l) ? 'distant' : 'local';
    expect(
      notesOf(mergeNotesPayload(payload({ byId: { a: l } }), payload({ byId: { a: r } })).merged).a
        .title
    ).toBe(attendu);
  });

  it('horodatage absent ou illisible : perd face à un horodatage valide', () => {
    const sansDate = mergeNotesPayload(
      payload({ byId: { a: { id: 'a', title: 'local' } } }),
      payload({ byId: { a: note('a', { title: 'distant', updatedAt: T1 }) } })
    );
    expect(notesOf(sansDate.merged).a.title).toBe('distant');

    const illisible = mergeNotesPayload(
      payload({ byId: { a: note('a', { title: 'local', updatedAt: 'hier matin' }) } }),
      payload({ byId: { a: note('a', { title: 'distant', updatedAt: T1 }) } })
    );
    expect(notesOf(illisible.merged).a.title).toBe('distant');

    // Symétrique : un distant sans date ne détrône jamais un local daté.
    const distantSansDate = mergeNotesPayload(
      payload({ byId: { a: note('a', { title: 'local', updatedAt: T1 }) } }),
      payload({ byId: { a: { id: 'a', title: 'distant' } } })
    );
    expect(notesOf(distantSansDate.merged).a.title).toBe('local');
  });
});

describe('tombstones — une note supprimée est une note comme une autre', () => {
  it('la tombstone distante gagne (suppression faite sur l’autre appareil)', () => {
    // `deleteNote` pose `deletedAt` SANS toucher `updatedAt` : sans l'horloge
    // composite, l'égalité garderait le local et la note ressusciterait.
    const local = payload({ byId: { a: note('a', { updatedAt: T1 }) }, allIds: ['a'] });
    const remote = payload({
      byId: { a: note('a', { updatedAt: T1, deletedAt: T2 }) },
      allIds: ['a'],
    });

    const { merged } = mergeNotesPayload(local, remote);
    expect(notesOf(merged).a.deletedAt).toBe(T2);
    // La note n'est pas FILTRÉE : elle reste dans byId et dans allIds.
    expect(merged.allIds).toEqual(['a']);
  });

  it('la tombstone distante perd face à une modification locale postérieure', () => {
    const local = payload({ byId: { a: note('a', { title: 'reprise', updatedAt: T3 }) } });
    const remote = payload({ byId: { a: note('a', { updatedAt: T1, deletedAt: T2 }) } });

    const { merged } = mergeNotesPayload(local, remote);
    expect(notesOf(merged).a.title).toBe('reprise');
    expect(notesOf(merged).a.deletedAt).toBeUndefined();
  });

  it('une tombstone que seul le distant connaît est INSTALLÉE, jamais filtrée', () => {
    const { merged } = mergeNotesPayload(
      payload({ byId: {}, allIds: [] }),
      payload({ byId: { z: note('z', { deletedAt: T2 }) }, allIds: ['z'] })
    );
    expect(Object.keys(notesOf(merged))).toEqual(['z']);
    expect(merged.allIds).toEqual(['z']);
  });
});

describe('résurrection — une restauration ne doit pas être annulée', () => {
  it('note locale VIVANTE face à une tombstone distante d’horloge ÉGALE : elle reste vivante', () => {
    // `restoreNote` bouscule `updatedAt` : l'horloge locale égale celle de la
    // tombstone d'en face (posée au même instant). À égalité, la note vit.
    const local = payload({ byId: { a: note('a', { updatedAt: T2 }) }, allIds: ['a'] });
    const remote = payload({
      byId: { a: note('a', { updatedAt: T1, deletedAt: T2 }) },
      allIds: ['a'],
    });

    const { merged } = mergeNotesPayload(local, remote);
    expect(notesOf(merged).a.deletedAt).toBeUndefined();
    expect(merged.allIds).toEqual(['a']);
  });

  it('tombstone distante ANTÉRIEURE : la résurrection tient', () => {
    const local = payload({ byId: { a: note('a', { updatedAt: T3 }) } });
    const remote = payload({ byId: { a: note('a', { updatedAt: T1, deletedAt: T2 }) } });

    expect(notesOf(mergeNotesPayload(local, remote).merged).a.deletedAt).toBeUndefined();
  });

  it('tombstone distante STRICTEMENT postérieure : la suppression gagne quand même', () => {
    // Garde-fou du garde-fou : la résurrection ne doit pas rendre les
    // suppressions distantes inopérantes.
    const local = payload({ byId: { a: note('a', { updatedAt: T2 }) } });
    const remote = payload({ byId: { a: note('a', { updatedAt: T2, deletedAt: T3 }) } });

    expect(notesOf(mergeNotesPayload(local, remote).merged).a.deletedAt).toBe(T3);
  });
});

describe('purges définitives — la note ne revient pas du nuage', () => {
  const OLD = '2026-01-01T00:00:00.000Z'; // > 90 jours avant T3
  const NOW = Date.parse(T3);

  it('une note purgée localement est soustraite de l’union', () => {
    const local = payload({ byId: { a: note('a') }, allIds: ['a'], purged: { z: T2 } });
    const remote = payload({
      byId: { a: note('a'), z: note('z', { updatedAt: T1 }) },
      allIds: ['a', 'z'],
    });

    const { merged, changedFromRemote } = mergeNotesPayload(local, remote, NOW);
    expect(Object.keys(notesOf(merged))).toEqual(['a']);
    expect(merged.allIds).toEqual(['a']);
    expect(merged.purged).toEqual({ z: T2 });
    expect(changedFromRemote).toBe(true); // la purge doit remonter
  });

  it('une purge DISTANTE retire la note locale sans déclencher le filet anti-perte', () => {
    const local = payload({
      byId: { a: note('a'), z: note('z', { updatedAt: T1 }) },
      allIds: ['a', 'z'],
    });
    const remote = payload({ byId: { a: note('a') }, allIds: ['a'], purged: { z: T2 } });

    const { merged, changedFromLocal, remoteContentChanged } = mergeNotesPayload(
      local,
      remote,
      NOW
    );
    expect(Object.keys(notesOf(merged))).toEqual(['a']);
    expect(changedFromLocal).toBe(true);
    expect(remoteContentChanged).toBe(true);
  });

  it('une note modifiée APRÈS la purge survit (la mutation la plus récente gagne)', () => {
    const local = payload({ byId: {}, allIds: [], purged: { z: T1 } });
    const remote = payload({ byId: { z: note('z', { updatedAt: T2 }) }, allIds: ['z'] });

    const { merged } = mergeNotesPayload(local, remote, NOW);
    expect(Object.keys(notesOf(merged))).toEqual(['z']);
  });

  it('un carnet purgé ne revient pas non plus', () => {
    const local = payload({ notebooks: {}, purgedNotebooks: { n1: T2 } });
    const remote = payload({ notebooks: { n1: { id: 'n1', name: 'distant', updatedAt: T1 } } });

    const { merged } = mergeNotesPayload(local, remote, NOW);
    expect(merged.notebooks).toEqual({});
  });

  it('les pierres de plus de 90 jours sont oubliées (le registre ne grossit pas sans fin)', () => {
    const local = payload({ byId: { a: note('a') }, allIds: ['a'], purged: { z: OLD } });
    const remote = payload({
      byId: { a: note('a'), z: note('z', { updatedAt: T1 }) },
      allIds: ['a', 'z'],
    });

    const { merged } = mergeNotesPayload(local, remote, NOW);
    expect(merged.purged).toEqual({});
    expect(Object.keys(notesOf(merged)).sort()).toEqual(['a', 'z']); // plus rien ne la retient
  });

  it('la pierre la plus RÉCENTE l’emporte, et une pierre illisible est ignorée', () => {
    const local = payload({ purged: { z: T1, illisible: 'hier matin' } });
    const remote = payload({ purged: { z: T2 } });

    expect(mergeNotesPayload(local, remote, NOW).merged.purged).toEqual({ z: T2 });
  });

  it('sans registre d’aucun côté, la fusion n’en INVENTE pas (sinon réécriture perpétuelle)', () => {
    const p = payload({ byId: { a: note('a') }, allIds: ['a'] });
    const { merged, changedFromLocal, changedFromRemote } = mergeNotesPayload(
      p,
      JSON.parse(JSON.stringify(p)),
      NOW
    );
    expect('purged' in merged).toBe(false);
    expect('purgedNotebooks' in merged).toBe(false);
    expect(changedFromLocal).toBe(false);
    expect(changedFromRemote).toBe(false);
  });

  it('deux payloads identiques AVEC registres restent stables', () => {
    const p = payload({ byId: { a: note('a') }, allIds: ['a'], purged: { z: T2 } });
    const { changedFromLocal, changedFromRemote } = mergeNotesPayload(
      p,
      JSON.parse(JSON.stringify(p)),
      NOW
    );
    expect(changedFromLocal).toBe(false);
    expect(changedFromRemote).toBe(false);
  });
});

describe('remoteContentChanged — ne réveiller le renderer que pour du contenu', () => {
  it('une simple normalisation (index nettoyé) ne le lève pas', () => {
    const local = payload({ byId: { a: note('a') }, allIds: ['a', 'morte'] });
    const remote = payload({ byId: { a: note('a') }, allIds: ['a'] });

    const { changedFromLocal, remoteContentChanged } = mergeNotesPayload(local, remote);
    expect(changedFromLocal).toBe(true); // il faut bien réécrire
    expect(remoteContentChanged).toBe(false); // mais SANS faire recharger le renderer
  });

  it('un champ inconnu adopté du distant ne le lève pas non plus', () => {
    const local = payload({ byId: { a: note('a') }, allIds: ['a'] });
    const remote = payload({ byId: { a: note('a') }, allIds: ['a'], inventionDistante: 1 });

    const { changedFromLocal, remoteContentChanged } = mergeNotesPayload(local, remote);
    expect(changedFromLocal).toBe(true);
    expect(remoteContentChanged).toBe(false);
  });

  it('une note distante nouvelle ou modifiée le lève', () => {
    const arrivee = mergeNotesPayload(
      payload({ byId: { a: note('a') }, allIds: ['a'] }),
      payload({ byId: { b: note('b') }, allIds: ['b'] })
    );
    expect(arrivee.remoteContentChanged).toBe(true);

    const modifiee = mergeNotesPayload(
      payload({ byId: { a: note('a', { updatedAt: T1 }) }, allIds: ['a'] }),
      payload({ byId: { a: note('a', { title: 'ailleurs', updatedAt: T2 }) }, allIds: ['a'] })
    );
    expect(modifiee.remoteContentChanged).toBe(true);
  });
});

describe('purgeRegistryChanged — les pierres doivent atteindre le renderer', () => {
  // Le store Redux reconstruit le payload à chaque sauvegarde : s'il n'a pas
  // rechargé les pierres apportées par la fusion, la sauvegarde suivante les
  // efface du disque et les notes purgées reviennent du nuage.
  it('un registre distant que le local n’a pas le lève, même sans note touchée', () => {
    const local = payload({ byId: { a: note('a') }, allIds: ['a'] });
    const remote = payload({ byId: { a: note('a') }, allIds: ['a'], purged: { z: T2 } });

    const { changedFromLocal, remoteContentChanged, purgeRegistryChanged } = mergeNotesPayload(
      local,
      remote
    );
    expect(changedFromLocal).toBe(true);
    expect(remoteContentChanged).toBe(false); // aucune note n'a bougé…
    expect(purgeRegistryChanged).toBe(true); // …mais le renderer doit recharger
  });

  it('un registre de CARNETS distant le lève aussi', () => {
    const local = payload({ notebooks: { n: { id: 'n' } } });
    const remote = payload({ notebooks: { n: { id: 'n' } }, purgedNotebooks: { autre: T2 } });

    expect(mergeNotesPayload(local, remote).purgeRegistryChanged).toBe(true);
  });

  it('registres identiques (ou absents des deux côtés) ne le lèvent pas', () => {
    const p = payload({ byId: { a: note('a') }, allIds: ['a'], purged: { z: T2 } });
    expect(mergeNotesPayload(p, JSON.parse(JSON.stringify(p))).purgeRegistryChanged).toBe(false);

    const sansRegistre = payload({ byId: { a: note('a') }, allIds: ['a'] });
    expect(
      mergeNotesPayload(sansRegistre, JSON.parse(JSON.stringify(sansRegistre))).purgeRegistryChanged
    ).toBe(false);
  });
});

describe('allIds — cohérence avec byId', () => {
  it('préserve l’ordre local, ajoute les nouveautés distantes à la fin', () => {
    const local = payload({ byId: { c: note('c'), a: note('a') }, allIds: ['c', 'a'] });
    const remote = payload({ byId: { b: note('b'), a: note('a') }, allIds: ['b', 'a'] });

    expect(mergeNotesPayload(local, remote).merged.allIds).toEqual(['c', 'a', 'b']);
  });

  it('rattrape un id présent dans byId mais cité par aucune des deux listes', () => {
    const local = payload({ byId: { a: note('a'), orphelin: note('orphelin') }, allIds: ['a'] });
    const remote = payload({ byId: {}, allIds: [] });

    const { merged } = mergeNotesPayload(local, remote);
    expect(merged.allIds).toEqual(['a', 'orphelin']);
  });

  it('écarte un id qui ne désigne aucune note (référence morte)', () => {
    const local = payload({ byId: { a: note('a') }, allIds: ['a', 'disparue'] });
    const remote = payload({ byId: { a: note('a') }, allIds: ['a'] });

    expect(mergeNotesPayload(local, remote).merged.allIds).toEqual(['a']);
  });
});

describe('carnets et modèles', () => {
  it('unit les carnets par id, arbitre par horodatage, n’en supprime aucun', () => {
    const local = payload({
      notebooks: {
        n1: { id: 'n1', name: 'local', updatedAt: T2 },
        n2: { id: 'n2', name: 'seulement local' },
      },
    });
    const remote = payload({
      notebooks: {
        n1: { id: 'n1', name: 'distant', updatedAt: T3 },
        n3: { id: 'n3', name: 'seulement distant' },
      },
    });

    const { merged } = mergeNotesPayload(local, remote);
    const notebooks = merged.notebooks as Record<string, { name: string }>;
    expect(Object.keys(notebooks).sort()).toEqual(['n1', 'n2', 'n3']);
    expect(notebooks.n1.name).toBe('distant');
  });

  it('un carnet distant sans date ne remplace pas un carnet local existant', () => {
    const local = payload({ notebooks: { n1: { id: 'n1', name: 'local' } } });
    const remote = payload({ notebooks: { n1: { id: 'n1', name: 'distant' } } });

    const { merged, changedFromLocal } = mergeNotesPayload(local, remote);
    expect((merged.notebooks as Record<string, { name: string }>).n1.name).toBe('local');
    expect(changedFromLocal).toBe(false);
  });

  it('unit les modèles par id sans jamais raccourcir la liste locale', () => {
    const local = payload({
      templates: [
        { id: 'tpl-meeting', name: 'intégré', updatedAt: '2024-01-01T00:00:00.000Z' },
        { id: 'perso-local', name: 'mien' },
      ],
    });
    const remote = payload({
      templates: [
        { id: 'tpl-meeting', name: 'intégré', updatedAt: '2024-01-01T00:00:00.000Z' },
        { id: 'perso-distant', name: 'sien', updatedAt: T2 },
      ],
    });

    const { merged } = mergeNotesPayload(local, remote);
    const ids = (merged.templates as Array<{ id: string }>).map((t) => t.id);
    expect(ids).toEqual(['tpl-meeting', 'perso-local', 'perso-distant']);
  });

  it('un modèle distant plus frais remplace son homonyme local en place', () => {
    const local = payload({ templates: [{ id: 't', name: 'local', updatedAt: T1 }] });
    const remote = payload({ templates: [{ id: 't', name: 'distant', updatedAt: T2 }] });

    const templates = mergeNotesPayload(local, remote).merged.templates as Array<{ name: string }>;
    expect(templates).toHaveLength(1);
    expect(templates[0].name).toBe('distant');
  });
});

describe('champs hors contrat', () => {
  it('garde la valeur locale d’un champ inconnu et adopte le champ distant absent du local', () => {
    const local = payload({ byId: { a: note('a') }, reglagesFuturs: { theme: 'local' } });
    const remote = payload({
      byId: { a: note('a') },
      reglagesFuturs: { theme: 'distant' },
      inventionDistante: [1, 2, 3],
    });

    const { merged } = mergeNotesPayload(local, remote);
    expect(merged.reglagesFuturs).toEqual({ theme: 'local' });
    expect(merged.inventionDistante).toEqual([1, 2, 3]);
  });

  it('un store local vide de forme reprend intégralement le distant', () => {
    const { merged, changedFromRemote } = mergeNotesPayload(
      {},
      payload({ byId: { a: note('a') }, allIds: ['a'] })
    );
    expect(Object.keys(notesOf(merged))).toEqual(['a']);
    expect(changedFromRemote).toBe(false); // rien à repousser
  });

  it('un byId local absent ou de mauvaise forme laisse passer le distant intact', () => {
    const { merged } = mergeNotesPayload(
      { byId: 'corrompu', allIds: null },
      payload({ byId: { a: note('a') }, allIds: ['a'] })
    );
    expect(Object.keys(notesOf(merged))).toEqual(['a']);
    expect(merged.allIds).toEqual(['a']);
  });
});

describe('invariants anti-perte', () => {
  it('la fusion ne rend JAMAIS moins de notes que le local', () => {
    const local = payload({
      byId: { a: note('a'), b: note('b'), c: note('c', { deletedAt: T1 }) },
      allIds: ['a', 'b', 'c'],
    });
    const remote = payload({ byId: { a: note('a', { updatedAt: T3 }) }, allIds: ['a'] });

    const { merged } = mergeNotesPayload(local, remote);
    expect(Object.keys(notesOf(merged)).sort()).toEqual(['a', 'b', 'c']);
    expect(merged.allIds).toEqual(['a', 'b', 'c']);
  });

  it('le filet réclame chaque note locale NOMMÉMENT (un compte ne prouverait rien)', () => {
    // Une note locale perdue mais compensée par une note distante gagnée passe
    // un simple comptage. Ici, chaque id local doit être présent ou purgé.
    const local = payload({
      byId: { garde: note('garde'), purgee: note('purgee', { updatedAt: T1 }) },
      allIds: ['garde', 'purgee'],
    });
    const remote = payload({
      byId: { nouvelle: note('nouvelle') },
      allIds: ['nouvelle'],
      purged: { purgee: T2 },
    });

    const { merged } = mergeNotesPayload(local, remote);
    expect(Object.keys(notesOf(merged)).sort()).toEqual(['garde', 'nouvelle']);
    // La seule disparition tolérée est celle qu'une pierre plus récente que la
    // note réclame explicitement.
    expect(merged.purged).toEqual({ purgee: T2 });
  });

  it('deux payloads identiques ne déclenchent ni réécriture ni remontée', () => {
    const p = payload({
      byId: { a: note('a') },
      allIds: ['a'],
      notebooks: { n: { id: 'n', name: 'carnet' } },
      templates: [{ id: 't' }],
    });
    // Clone par JSON : même contenu, objets distincts (ce que fait le cycle réel).
    const { changedFromLocal, changedFromRemote } = mergeNotesPayload(
      p,
      JSON.parse(JSON.stringify(p))
    );
    expect(changedFromLocal).toBe(false);
    expect(changedFromRemote).toBe(false);
  });

  it('clockOf prend la plus récente des dates de mutation', () => {
    expect(clockOf({ updatedAt: T1, deletedAt: T2 })).toBe(Date.parse(T2));
    expect(clockOf({ updatedAt: T3, deletedAt: T2 })).toBe(Date.parse(T3));
    expect(clockOf({ updatedAt: 'n’importe quoi' })).toBe(-Infinity);
    expect(clockOf(null)).toBe(-Infinity);
  });
});

// ── Copies de conflit ───────────────────────────────────────────────────────

/**
 * LE DÉFAUT VERROUILLÉ ICI : « rien ne disparaît » ne valait qu'au grain de
 * l'ID. Quand la même note avait été éditée des deux côtés, l'horloge tranchait
 * et le texte perdant s'évaporait — sans copie, sans trace, alors que le desktop
 * fabrique un `_conflict_<horodatage>` pour le moindre fichier ordinaire.
 */
describe('overwritten — ce que l’arbitrage détruit est signalé', () => {
  const collision = (localEntry: unknown, remoteEntry: unknown) =>
    mergeNotesPayload(
      payload({ byId: { a: localEntry }, allIds: ['a'] }),
      payload({ byId: { a: remoteEntry }, allIds: ['a'] })
    );

  it('contenus DIFFÉRENTS + horloge qui tranche : l’entrée perdante est rapportée', () => {
    const perdante = note('a', { title: 'local', updatedAt: T1 });
    const { overwritten } = collision(perdante, note('a', { title: 'distant', updatedAt: T2 }));

    expect(overwritten).toHaveLength(1);
    expect(overwritten[0]).toMatchObject({ id: 'a', kind: 'note', side: 'local' });
    expect(overwritten[0].losing).toEqual(perdante);
  });

  it('quand le LOCAL gagne, c’est la version distante qui est rapportée perdante', () => {
    const perdante = note('a', { title: 'distant', updatedAt: T2 });
    const { overwritten } = collision(note('a', { title: 'local', updatedAt: T3 }), perdante);

    expect(overwritten[0]).toMatchObject({ id: 'a', side: 'remote' });
    expect(overwritten[0].losing).toEqual(perdante);
  });

  it('contenus IDENTIQUES : rien n’est rapporté (sinon une copie par cycle)', () => {
    expect(collision(note('a'), note('a')).overwritten).toEqual([]);
    // Horloges différentes mais même contenu : il n'y a toujours rien à sauver.
    expect(collision(note('a'), note('a')).overwritten).toEqual([]);
  });

  it('entrée présente d’un SEUL côté : rien n’est rapporté', () => {
    const { overwritten } = mergeNotesPayload(
      payload({ byId: { a: note('a') }, allIds: ['a'] }),
      payload({ byId: { b: note('b', { title: 'ailleurs' }) }, allIds: ['b'] })
    );
    expect(overwritten).toEqual([]);
  });

  it('les carnets sont arbitrés — et rapportés — comme les notes', () => {
    const { overwritten } = mergeNotesPayload(
      payload({ notebooks: { n1: { id: 'n1', name: 'local', updatedAt: T1 } } }),
      payload({ notebooks: { n1: { id: 'n1', name: 'distant', updatedAt: T2 } } })
    );
    expect(overwritten).toHaveLength(1);
    expect(overwritten[0]).toMatchObject({ id: 'n1', kind: 'notebook', side: 'local' });
  });

  it('une entrée qu’une purge retire de l’union n’est pas rapportée', () => {
    // Rien à sauver : la note a été définitivement supprimée, la « conserver »
    // en copie la ferait ressusciter.
    const { merged, overwritten } = mergeNotesPayload(
      payload({ byId: { a: note('a', { title: 'local', updatedAt: T1 }) }, allIds: ['a'] }),
      payload({
        byId: { a: note('a', { title: 'distant', updatedAt: T2 }) },
        allIds: ['a'],
        purged: { a: T3 },
      }),
      Date.parse(T3)
    );
    expect(Object.keys(notesOf(merged))).toEqual([]);
    expect(overwritten).toEqual([]);
  });
});

describe('selectGenuineConflicts — divergence réelle contre simple rattrapage', () => {
  const ancestor = (clock: string, kind: 'notes' | 'notebooks' = 'notes'): NotesMergeBase => ({
    notes: kind === 'notes' ? { a: Date.parse(clock) } : {},
    notebooks: kind === 'notebooks' ? { n1: Date.parse(clock) } : {},
  });

  const collision = (localEntry: unknown, remoteEntry: unknown) =>
    mergeNotesPayload(
      payload({ byId: { a: localEntry }, allIds: ['a'] }),
      payload({ byId: { a: remoteEntry }, allIds: ['a'] })
    );

  it('LE PIÈGE : le local n’a pas bougé depuis l’ancêtre → aucune copie', () => {
    // Modification propagée normalement : l'autre appareil a édité, nous
    // portions l'ancêtre. Sans ce garde, CHAQUE édition reçue fabriquerait une
    // note « (version en conflit) » — une par cycle, pour rien.
    const { merged, overwritten } = collision(
      note('a', { title: 'ancêtre', updatedAt: T1 }),
      note('a', { title: 'édité ailleurs', updatedAt: T2 })
    );
    expect(overwritten).toHaveLength(1); // la fusion le signale…
    expect(selectGenuineConflicts(overwritten, merged, ancestor(T1), null)).toEqual([]); // …mais rien n'est perdu
  });

  it('le distant n’a pas bougé depuis l’ancêtre → aucune copie non plus', () => {
    const { merged, overwritten } = collision(
      note('a', { title: 'édité ici', updatedAt: T3 }),
      note('a', { title: 'ancêtre', updatedAt: T1 })
    );
    expect(selectGenuineConflicts(overwritten, merged, ancestor(T1), null)).toEqual([]);
  });

  it('les DEUX ont bougé depuis l’ancêtre → la perdante est conservée', () => {
    const { merged, overwritten } = collision(
      note('a', { title: 'édité ici', updatedAt: T2 }),
      note('a', { title: 'édité ailleurs', updatedAt: T3 })
    );
    const kept = selectGenuineConflicts(overwritten, merged, ancestor(T1), null);
    expect(kept).toHaveLength(1);
    expect(kept[0].losing).toMatchObject({ title: 'édité ici' });
  });

  it('un accord postérieur à l’édition locale la disqualifie (nous l’avons poussée)', () => {
    // La base peut être en retard — nous avons poussé sans refusionner. Le
    // dernier accord prouvé avec le nuage tranche : notre version y est déjà.
    const { merged, overwritten } = collision(
      note('a', { title: 'édité ici', updatedAt: T2 }),
      note('a', { title: 'édité ailleurs', updatedAt: T3 })
    );
    const apresLePush = Date.parse(T2) + 1000;
    expect(selectGenuineConflicts(overwritten, merged, ancestor(T1), apresLePush)).toEqual([]);
    // …et un accord ANTÉRIEUR ne la disqualifie pas.
    expect(selectGenuineConflicts(overwritten, merged, ancestor(T1), Date.parse(T1))).toHaveLength(
      1
    );
  });

  it('aucun ancêtre connu (premier cycle) : on ne fabrique rien', () => {
    const { merged, overwritten } = collision(
      note('a', { title: 'ici', updatedAt: T2 }),
      note('a', { title: 'ailleurs', updatedAt: T3 })
    );
    expect(selectGenuineConflicts(overwritten, merged, null, null)).toEqual([]);
  });

  it('une tombstone perdante n’est jamais conservée (ce serait ressusciter)', () => {
    const { merged, overwritten } = collision(
      note('a', { title: 'supprimée ici', updatedAt: T2, deletedAt: T2 }),
      note('a', { title: 'reprise ailleurs', updatedAt: T3 })
    );
    expect(overwritten[0].side).toBe('local');
    expect(selectGenuineConflicts(overwritten, merged, ancestor(T1), null)).toEqual([]);
  });

  it('un carnet divergent est conservé comme une note', () => {
    const { merged, overwritten } = mergeNotesPayload(
      payload({ notebooks: { n1: { id: 'n1', name: 'ici', updatedAt: T2 } } }),
      payload({ notebooks: { n1: { id: 'n1', name: 'ailleurs', updatedAt: T3 } } })
    );
    expect(
      selectGenuineConflicts(overwritten, merged, ancestor(T1, 'notebooks'), null)
    ).toHaveLength(1);
  });
});

describe('applyConflictCopies — la version perdante devient une note visible', () => {
  const NOW = '2026-08-14T12:00:00.000Z';
  let compteur = 0;
  const newId = (): string => `copie-${++compteur}`;

  const divergence = () => {
    const local = payload({
      byId: { a: note('a', { title: 'ma version', content: 'écrit ici', updatedAt: T2 }) },
      allIds: ['a'],
    });
    const remote = payload({
      byId: { a: note('a', { title: 'sa version', content: 'écrit ailleurs', updatedAt: T3 }) },
      allIds: ['a'],
    });
    const result = mergeNotesPayload(local, remote);
    const kept = selectGenuineConflicts(
      result.overwritten,
      result.merged,
      { notes: { a: Date.parse(T1) }, notebooks: {} },
      null
    );
    return { result, kept };
  };

  it('crée une note sous un id NEUF, titrée, indexée, sans écraser la gagnante', () => {
    compteur = 0;
    const { result, kept } = divergence();
    expect(applyConflictCopies(result.merged, kept, { now: NOW, newId })).toBe(1);

    const notes = notesOf(result.merged);
    // La gagnante est intacte, sous son id d'origine.
    expect(notes.a).toMatchObject({ id: 'a', title: 'sa version', content: 'écrit ailleurs' });
    // La perdante survit sous un id neuf, avec son contenu.
    expect(notes['copie-1']).toMatchObject({
      id: 'copie-1',
      // Suffixe NEUTRE : l'application est EN/FR et ce module est pur, un
      // « (version en conflit) » en dur s'affichait tel quel en anglais.
      title: 'ma version (⚠ 2026-08-14)',
      content: 'écrit ici',
      conflictOfId: 'a',
      conflictOriginalUpdatedAt: T2,
      updatedAt: NOW,
    });
    // Indexée, sinon aucune vue ne l'affiche.
    expect(result.merged.allIds).toContain('copie-1');
  });

  it('la copie ne rouvre pas de conflit au cycle suivant', () => {
    compteur = 0;
    const { result, kept } = divergence();
    applyConflictCopies(result.merged, kept, { now: NOW, newId });

    // Cycle suivant : le local porte la fusion + la copie, le distant n'a pas
    // bougé (remontée impossible, par exemple). L'id neuf n'existe que d'un
    // côté : l'union le recopie sans jamais l'arbitrer.
    const distantInchange = payload({
      byId: { a: note('a', { title: 'sa version', content: 'écrit ailleurs', updatedAt: T3 }) },
      allIds: ['a'],
    });
    const cycle2 = mergeNotesPayload(result.merged, distantInchange);
    expect(cycle2.overwritten).toEqual([]);
    expect(Object.keys(notesOf(cycle2.merged)).sort()).toEqual(['a', 'copie-1']);
  });

  it('LE PIÈGE inverse : avec la base rafraîchie, la même divergence ne recopie pas', () => {
    compteur = 0;
    // Cycle 1 : notre version gagne, la version distante est conservée.
    const local = payload({
      byId: { a: note('a', { title: 'ici', updatedAt: T3 }) },
      allIds: ['a'],
    });
    const remote = payload({
      byId: { a: note('a', { title: 'ailleurs', updatedAt: T2 }) },
      allIds: ['a'],
    });
    const c1 = mergeNotesPayload(local, remote);
    const base1: NotesMergeBase = { notes: { a: Date.parse(T1) }, notebooks: {} };
    const kept1 = selectGenuineConflicts(c1.overwritten, c1.merged, base1, null);
    expect(applyConflictCopies(c1.merged, kept1, { now: NOW, newId })).toBe(1);

    // Cycle 2 : le distant n'a toujours pas notre version (remontée refusée).
    // La base retient désormais l'horloge que la fusion a arrêtée → plus rien
    // n'a bougé de notre côté → aucune seconde copie.
    const base2 = collectEntryClocks(c1.merged);
    const c2 = mergeNotesPayload(c1.merged, JSON.parse(JSON.stringify(remote)));
    expect(c2.overwritten).toHaveLength(1); // l'arbitrage se reproduit…
    expect(selectGenuineConflicts(c2.overwritten, c2.merged, base2, null)).toEqual([]); // …sans copie
  });

  it('un carnet perdant donne un carnet de conflit, jamais une note', () => {
    compteur = 0;
    const result = mergeNotesPayload(
      payload({ notebooks: { n1: { id: 'n1', name: 'ici', updatedAt: T2 } } }),
      payload({ notebooks: { n1: { id: 'n1', name: 'ailleurs', updatedAt: T3 } } })
    );
    const kept = selectGenuineConflicts(
      result.overwritten,
      result.merged,
      { notes: {}, notebooks: { n1: Date.parse(T1) } },
      null
    );
    applyConflictCopies(result.merged, kept, { now: NOW, newId });

    const notebooks = result.merged.notebooks as Record<string, Record<string, unknown>>;
    expect(notebooks['copie-1']).toMatchObject({ name: 'ici (⚠ 2026-08-14)' });
    expect(Object.keys(notesOf(result.merged) ?? {})).toEqual([]);
  });

  it('l’appelant peut imposer son suffixe (le jour où il saura traduire)', () => {
    compteur = 0;
    const { result, kept } = divergence();
    applyConflictCopies(result.merged, kept, {
      now: NOW,
      newId,
      titleSuffix: ' (conflicted copy)',
    });
    expect(notesOf(result.merged)['copie-1'].title).toBe('ma version (conflicted copy)');
  });

  it('une entrée SANS titre ne fabrique pas un titre français par défaut', () => {
    compteur = 0;
    const result = mergeNotesPayload(
      payload({ byId: { a: { id: 'a', content: 'ici', updatedAt: T2 } }, allIds: ['a'] }),
      payload({ byId: { a: { id: 'a', content: 'ailleurs', updatedAt: T3 } }, allIds: ['a'] })
    );
    const kept = selectGenuineConflicts(
      result.overwritten,
      result.merged,
      { notes: { a: Date.parse(T1) }, notebooks: {} },
      null
    );
    applyConflictCopies(result.merged, kept, { now: NOW, newId });
    expect(notesOf(result.merged)['copie-1'].title).toBe('(⚠ 2026-08-14)');
  });

  it('collectEntryClocks ne retient QUE des horloges — aucun contenu', () => {
    const clocks = collectEntryClocks(
      payload({
        byId: { a: note('a', { updatedAt: T2 }), sansDate: { id: 'sansDate' } },
        notebooks: { n1: { id: 'n1', updatedAt: T3 } },
      })
    );
    // `sansDate: null` = « elle était là, sans horloge lisible ». L'OMETTRE la
    // rendait indistinguable d'une entrée inconnue de la base, donc à jamais
    // divergente — une copie de conflit par cycle, pour toujours.
    expect(clocks).toEqual({
      notes: { a: Date.parse(T2), sansDate: null },
      notebooks: { n1: Date.parse(T3) },
    });
  });
});

// ── Champs de placement ─────────────────────────────────────────────────────

describe('la copie de conflit hérite du contenu, jamais de la place', () => {
  const NOW = '2026-08-14T12:00:00.000Z';

  /** Divergence réelle sur une note lourdement « placée ». */
  const copieDe = (extra: Record<string, unknown>): Record<string, unknown> => {
    const local = payload({
      byId: { a: note('a', { title: 'ici', updatedAt: T2, ...extra }) },
      allIds: ['a'],
    });
    const remote = payload({
      byId: { a: note('a', { title: 'ailleurs', updatedAt: T3 }) },
      allIds: ['a'],
    });
    const result = mergeNotesPayload(local, remote);
    const kept = selectGenuineConflicts(
      result.overwritten,
      result.merged,
      { notes: { a: Date.parse(T1) }, notebooks: {} },
      null
    );
    expect(applyConflictCopies(result.merged, kept, { now: NOW, newId: () => 'copie' })).toBe(1);
    return notesOf(result.merged).copie;
  };

  it('la note du jour n’a pas deux prétendants pour la même date', () => {
    // Deux `isDaily` sur `dailyDate` = la vue du jour en choisit une au hasard,
    // et l'utilisateur écrit dans une note fantôme.
    const copie = copieDe({ isDaily: true, dailyDate: '2026-08-10' });
    expect(copie.isDaily).toBe(false);
    expect(copie.dailyDate).toBeUndefined();
  });

  it('positions, tailles et ordres ne sont pas dupliqués', () => {
    const copie = copieDe({
      viewPositions: { canvas: { x: 10, y: 20 } },
      viewSizes: { canvas: { w: 200, h: 100 } },
      kanbanOrder: 3,
      manualOrder: 7,
      scheduledDate: '2026-08-12',
      // Ce qui n'est PAS un placement doit survivre : la copie sert à relire
      // le contenu perdu, pas à le mutiler.
      kanbanStatus: 'in-progress',
      notebookId: 'carnet-1',
      tagIds: ['t1'],
    });
    expect(copie.viewPositions).toBeUndefined();
    expect(copie.viewSizes).toBeUndefined();
    expect(copie.kanbanOrder).toBeUndefined();
    expect(copie.manualOrder).toBeUndefined();
    expect(copie.scheduledDate).toBeUndefined();
    expect(copie).toMatchObject({
      kanbanStatus: 'in-progress',
      notebookId: 'carnet-1',
      tagIds: ['t1'],
    });
  });
});

// ── Horloge absente vs horloge inconnue ─────────────────────────────────────

describe('selectGenuineConflicts — « sans horloge » n’est pas « inconnue »', () => {
  const sansHorloge = (title: string) => ({ id: 'a', title });

  const collision = () =>
    mergeNotesPayload(
      payload({ byId: { a: sansHorloge('ici') }, allIds: ['a'] }),
      payload({ byId: { a: sansHorloge('ailleurs') }, allIds: ['a'] })
    );

  it('LE DÉFAUT : une entrée sans horloge, connue de la base, n’est plus divergente', () => {
    // Elle n'entrait JAMAIS dans la base (les horloges illisibles y étaient
    // omises) : chaque cycle la retrouvait « inconnue », donc bougée des deux
    // côtés, donc recopiée. Une copie de conflit par cycle, indéfiniment.
    const { merged, overwritten } = collision();
    expect(overwritten).toHaveLength(1);
    const base = collectEntryClocks(merged);
    expect(base.notes.a).toBeNull();
    expect(selectGenuineConflicts(overwritten, merged, base, null)).toEqual([]);
  });

  it('mais une entrée VRAIMENT inconnue de la base reste conservée', () => {
    const { merged, overwritten } = collision();
    expect(
      selectGenuineConflicts(overwritten, merged, { notes: {}, notebooks: {} }, null)
    ).toHaveLength(1);
  });

  it('et une entrée qui GAGNE une horloge a bien bougé', () => {
    const { merged, overwritten } = mergeNotesPayload(
      payload({ byId: { a: note('a', { title: 'ici', updatedAt: T2 }) }, allIds: ['a'] }),
      payload({ byId: { a: note('a', { title: 'ailleurs', updatedAt: T3 }) }, allIds: ['a'] })
    );
    expect(
      selectGenuineConflicts(overwritten, merged, { notes: { a: null }, notebooks: {} }, null)
    ).toHaveLength(1);
  });
});

// ── Garde des sessions vivantes ─────────────────────────────────────────────

describe('preserveLiveSessionNotes — une note en cours d’édition ne se fait pas écraser', () => {
  const live =
    (...ids: string[]) =>
    (id: string) =>
      ids.includes(id);

  it('rétablit la version locale quand l’arbitrage l’a remplacée', () => {
    // Le nuage porte une version plus fraîche : la fusion la fait gagner. Mais
    // cette note est éditée en direct — son contenu durable est produit par le
    // CRDT, frappe après frappe, et l'écraser perdrait la frappe en cours.
    const local = payload({
      byId: { a: note('a', { content: 'en cours de frappe' }) },
      allIds: ['a'],
    });
    const remote = payload({
      byId: { a: note('a', { content: 'venu du nuage', updatedAt: T3 }) },
      allIds: ['a'],
    });

    const { merged } = mergeNotesPayload(local, remote);
    expect(notesOf(merged).a.content).toBe('venu du nuage'); // la fusion, seule

    const held = preserveLiveSessionNotes(local, merged, live('a'));

    expect(held).toEqual(['a']);
    expect(notesOf(merged).a.content).toBe('en cours de frappe');
  });

  it('ne touche à rien quand aucune note n’est vivante', () => {
    const local = payload({ byId: { a: note('a', { content: 'local' }) }, allIds: ['a'] });
    const remote = payload({
      byId: { a: note('a', { content: 'nuage', updatedAt: T3 }) },
      allIds: ['a'],
    });
    const { merged } = mergeNotesPayload(local, remote);

    expect(preserveLiveSessionNotes(local, merged, live())).toEqual([]);
    expect(notesOf(merged).a.content).toBe('nuage');
  });

  it('ne retient rien quand la fusion n’a rien changé pour cette note', () => {
    const local = payload({ byId: { a: note('a') }, allIds: ['a'] });
    const remote = payload({ byId: { b: note('b') }, allIds: ['b'] });
    const { merged } = mergeNotesPayload(local, remote);

    expect(preserveLiveSessionNotes(local, merged, live('a'))).toEqual([]);
    expect(Object.keys(notesOf(merged)).sort()).toEqual(['a', 'b']);
  });

  it('ressuscite une note vivante qu’une purge distante venait de retirer, index compris', () => {
    // Supprimer définitivement depuis un autre appareil ne peut pas faire
    // disparaître une note sous les doigts de celui qui l'écrit.
    const local = payload({ byId: { a: note('a', { content: 'en cours' }) }, allIds: ['a'] });
    const remote = payload({ byId: {}, allIds: [], purged: { a: T3 } });

    const { merged } = mergeNotesPayload(local, remote);
    expect(notesOf(merged).a).toBeUndefined();

    const held = preserveLiveSessionNotes(local, merged, live('a'));

    expect(held).toEqual(['a']);
    expect(notesOf(merged).a.content).toBe('en cours');
    // Une note absente d'`allIds` casse les vues qui font `allIds.map(...)`.
    expect(merged.allIds).toContain('a');
  });

  it('ne laisse pas une note vivante disparaître avec les autres', () => {
    const local = payload({
      byId: { a: note('a', { content: 'vivante' }), b: note('b', { content: 'ordinaire' }) },
      allIds: ['a', 'b'],
    });
    const remote = payload({
      byId: {
        a: note('a', { content: 'nuage-a', updatedAt: T3 }),
        b: note('b', { content: 'nuage-b', updatedAt: T3 }),
      },
      allIds: ['a', 'b'],
    });

    const { merged } = mergeNotesPayload(local, remote);
    const held = preserveLiveSessionNotes(local, merged, live('a'));

    expect(held).toEqual(['a']);
    expect(notesOf(merged).a.content).toBe('vivante');
    // Les autres notes suivent la règle habituelle : l'horloge tranche.
    expect(notesOf(merged).b.content).toBe('nuage-b');
  });
});

// ── Copies de conflit et sessions vivantes ──────────────────────────────────

describe('dropLiveSessionConflicts — une note en collaboration ne se recopie pas', () => {
  const live =
    (...ids: string[]) =>
    (id: string) =>
      ids.includes(id);

  /**
   * LE SCÉNARIO DU DÉFAUT, en conditions réelles. Deux appareils écrivent la
   * MÊME note par le CRDT. Chacun repose sa version dans `notes.enc` toutes les
   * deux secondes, à des instants différents : les deux horloges bougent, les
   * deux contenus diffèrent, et la fusion voit une divergence franche. Comme
   * chacun est le dernier écrivain CHEZ LUI, l'arbitrage donne le LOCAL
   * gagnant — donc `preserveLiveSessionNotes` n'a RIEN à rétablir et rend une
   * liste VIDE. Filtrer les conflits sur cette liste-là laissait passer
   * l'entrée : une copie de conflit par cycle, chacune portant le texte tapé à
   * cet instant, pendant toute la session.
   */
  const collaboration = () => {
    const base: NotesMergeBase = { notes: { a: Date.parse(T1) }, notebooks: {} };
    const local = payload({
      byId: { a: note('a', { content: 'frappe vue ici', updatedAt: T3 }) },
      allIds: ['a'],
    });
    const remote = payload({
      byId: { a: note('a', { content: 'frappe vue là-bas', updatedAt: T2 }) },
      allIds: ['a'],
    });
    return { base, ...mergeNotesPayload(local, remote), local };
  };

  it('le local gagne, rien n’est à rétablir — et pourtant la note EST vivante', () => {
    const { local, merged, overwritten } = collaboration();

    expect(overwritten).toHaveLength(1); // la fusion a bien détruit un contenu
    // La preuve du défaut : la garde d'origine ne voyait rien à protéger.
    expect(preserveLiveSessionNotes(local, merged, live('a'))).toEqual([]);
  });

  it('écarte l’entrée écrasée quand la note est en session', () => {
    const { overwritten } = collaboration();

    expect(dropLiveSessionConflicts(overwritten, live('a'))).toEqual([]);
  });

  it('donc AUCUNE copie de conflit n’est fabriquée pendant la collaboration', () => {
    const { merged, overwritten, base } = collaboration();

    const retenus = selectGenuineConflicts(
      dropLiveSessionConflicts(overwritten, live('a')),
      merged,
      base,
      null
    );

    expect(applyConflictCopies(merged, retenus, { now: T3, newId: () => 'copie' })).toBe(0);
    expect(Object.keys(notesOf(merged))).toEqual(['a']);
  });

  it('sans la garde, la même situation fabriquait bien une copie (preuve du défaut)', () => {
    const { merged, overwritten, base } = collaboration();

    const retenus = selectGenuineConflicts(overwritten, merged, base, null);

    expect(applyConflictCopies(merged, retenus, { now: T3, newId: () => 'copie' })).toBe(1);
    expect(Object.keys(notesOf(merged)).sort()).toEqual(['a', 'copie']);
  });

  it('une note qui n’est PAS en session garde sa copie de conflit', () => {
    const { merged, overwritten, base } = collaboration();

    const retenus = selectGenuineConflicts(
      dropLiveSessionConflicts(overwritten, live('une-autre')),
      merged,
      base,
      null
    );

    expect(applyConflictCopies(merged, retenus, { now: T3, newId: () => 'copie' })).toBe(1);
  });

  it('les carnets ne sont jamais concernés : ils n’ont pas de session', () => {
    const local = payload({
      notebooks: { n1: { id: 'n1', name: 'ici', updatedAt: T3 } },
    });
    const remote = payload({
      notebooks: { n1: { id: 'n1', name: 'là-bas', updatedAt: T2 } },
    });
    const { overwritten } = mergeNotesPayload(local, remote);

    expect(overwritten).toHaveLength(1);
    // Même en prétendant que TOUT est vivant, le carnet passe.
    expect(dropLiveSessionConflicts(overwritten, () => true)).toHaveLength(1);
  });

  it('un registre qui jette ne fabrique pas une copie de plus', () => {
    const { overwritten } = collaboration();

    expect(
      dropLiveSessionConflicts(overwritten, () => {
        throw new Error('registre indisponible');
      })
    ).toEqual([]);
  });
});

/**
 * L'ANCÊTRE A DEUX CÔTÉS — et les confondre fabriquait des copies de conflit
 * pour des notes que personne d'autre n'avait touchées.
 *
 * LE DÉFAUT, tel qu'il s'est produit. La base ne portait qu'UNE table, remplie
 * avec l'UNION que la fusion venait de sceller en local. Dès qu'un cycle
 * fusionnait SANS remonter — remontée différée par la garde de fraîcheur,
 * bloquée par la garde de capacité, retenue par une session vivante, refusée par
 * un 409, ou simplement coupée par le réseau — cette table avançait sur des
 * écritures que le nuage n'avait jamais reçues. Au cycle suivant, l'horloge
 * distante RESTÉE EN ARRIÈRE était « différente de l'ancêtre » : la fusion la
 * lisait comme un mouvement du nuage, le local ayant vraiment bougé de son côté,
 * et recopiait notre propre texte d'il y a un cycle.
 *
 * DEUX MÉCANISMES le ferment, et chacun tient seul :
 *  · l'AVANCE STRICTE — un côté en retard sur l'ancêtre n'a pas écrit ;
 *  · la TABLE DISTANTE — chaque côté est comparé à ce qu'il portait vraiment.
 * On les éprouve donc séparément.
 */
describe('ancêtre à deux côtés — un nuage EN RETARD n’est pas un nuage qui a écrit', () => {
  const T0 = '2026-07-31T10:00:00.000Z';
  const clock = (iso: string) => Date.parse(iso);

  const collision = (localEntry: unknown, remoteEntry: unknown) =>
    mergeNotesPayload(
      payload({ byId: { a: localEntry }, allIds: ['a'] }),
      payload({ byId: { a: remoteEntry }, allIds: ['a'] })
    );

  it('LE DÉFAUT : base en avance sur le nuage (fusion non remontée) → aucune copie', () => {
    // Cycle k : on a fusionné (ancêtre = T2, notre écriture) et la remontée a
    // échoué. Cycle k+1 : on a retapé (T3), le nuage porte TOUJOURS T1.
    // Personne d'autre n'a touché à cette note.
    const { merged, overwritten } = collision(
      note('a', { title: 'ma frappe la plus récente', updatedAt: T3 }),
      note('a', { title: 'ce que le nuage porte encore', updatedAt: T1 })
    );
    expect(overwritten).toHaveLength(1); // la fusion signale bien un écrasement…
    // …mais l'ancêtre d'une SEULE table (base héritée) ne doit pas suffire à en
    // conclure que le nuage a écrit : son horloge est ANTÉRIEURE à l'ancêtre.
    const heritee: NotesMergeBase = { notes: { a: clock(T2) }, notebooks: {} };
    expect(selectGenuineConflicts(overwritten, merged, heritee, null)).toEqual([]);
  });

  it('et avec les deux tables, même verdict — le nuage est resté où on l’avait laissé', () => {
    const { merged, overwritten } = collision(
      note('a', { title: 'ma frappe la plus récente', updatedAt: T3 }),
      note('a', { title: 'ce que le nuage porte encore', updatedAt: T1 })
    );
    const base = collectMergeBase(
      payload({ byId: { a: note('a', { updatedAt: T2 }) } }), // notre union scellée
      payload({ byId: { a: note('a', { updatedAt: T1 }) } }) // ce que le nuage servait
    );
    expect(selectGenuineConflicts(overwritten, merged, base, null)).toEqual([]);
  });

  it('NOTRE PROPRE UNION QUI REVIENT : le nuage a accepté notre push, il n’a rien écrit', () => {
    // Le cycle d'avant a poussé l'union T2 ; le nuage la sert maintenant. Son
    // horloge a bien « avancé » depuis ce qu'on avait lu de lui (T1), mais elle
    // vaut exactement notre ancêtre : c'est nous, revenu par le câble.
    const { merged, overwritten } = collision(
      note('a', { title: 'écrit ici, encore', updatedAt: T3 }),
      note('a', { title: 'écrit ici', updatedAt: T2 })
    );
    const base: NotesMergeBase = {
      notes: { a: clock(T2) },
      notebooks: {},
      remote: { notes: { a: clock(T1) }, notebooks: {} },
    };
    expect(selectGenuineConflicts(overwritten, merged, base, null)).toEqual([]);
  });

  it('mais un nuage qui a VRAIMENT écrit est conservé, même SOUS l’horloge de l’union', () => {
    // MÊME état observable que le cas du défaut ci-dessus (local T3, nuage T1,
    // union T2) — et pourtant le verdict s'inverse, parce que la table distante
    // dit ce que le nuage portait VRAIMENT au dernier accord : T0. Il est donc
    // passé de T0 à T1 : quelqu'un a écrit là-bas, sous notre propre horloge.
    // Sans cette table, on ne pouvait pas le savoir — et ne rien fabriquer
    // était le seul choix sûr.
    const { merged, overwritten } = collision(
      note('a', { title: 'écrit ici', updatedAt: T3 }),
      note('a', { title: 'écrit ailleurs', updatedAt: T1 })
    );
    const base: NotesMergeBase = {
      notes: { a: clock(T2) },
      notebooks: {},
      remote: { notes: { a: clock(T0) }, notebooks: {} },
    };
    const kept = selectGenuineConflicts(overwritten, merged, base, null);
    expect(kept).toHaveLength(1);
    expect(kept[0].losing).toMatchObject({ title: 'écrit ailleurs' });
  });

  it('substance IDENTIQUE, horloges différentes : rien à sauver', () => {
    // Une sauvegarde automatique qui repose `updatedAt` sans toucher au texte.
    // Les deux côtés « ont bougé » au sens des horloges, et pourtant les deux
    // versions disent exactement la même chose.
    const { merged, overwritten } = collision(
      note('a', { title: 'même texte', content: 'identique', updatedAt: T2 }),
      note('a', { title: 'même texte', content: 'identique', updatedAt: T3 })
    );
    expect(overwritten).toHaveLength(1); // les objets diffèrent (updatedAt)
    const base = collectMergeBase(
      payload({ byId: { a: note('a', { updatedAt: T0 }) } }),
      payload({ byId: { a: note('a', { updatedAt: T0 }) } })
    );
    expect(selectGenuineConflicts(overwritten, merged, base, null)).toEqual([]);
  });

  it('collectMergeBase garde les deux tables, et n’emporte que des horloges', () => {
    const base = collectMergeBase(
      payload({ byId: { a: note('a', { updatedAt: T2 }) }, notebooks: { n1: { id: 'n1' } } }),
      payload({ byId: { a: note('a', { updatedAt: T1 }) } })
    );
    expect(base.notes).toEqual({ a: Date.parse(T2) });
    expect(base.notebooks).toEqual({ n1: null }); // présente, sans horloge
    expect(base.remote).toEqual({ notes: { a: Date.parse(T1) }, notebooks: {} });
    // Des ids et des nombres, RIEN d'autre : la base sérialisée ne cite aucun
    // champ de contenu (elle est écrite en clair côté desktop).
    const serialisee = JSON.stringify(base);
    for (const champ of ['title', 'content', 'plainText', 'name']) {
      expect(serialisee).not.toContain(champ);
    }
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
