/**
 * Lecture d'une copie de conflit, pour l'écran de résolution assistée.
 *
 * CE QUI EST EN JEU. L'interface va montrer deux versions côte à côte et laisser
 * l'utilisateur trancher. Un rapport qui se trompe d'origine, qui affiche
 * l'horodatage de la FABRICATION à la place de celui de la version perdante, ou
 * qui déclare « identiques » deux textes qui ne le sont pas, fait supprimer du
 * contenu par un humain persuadé de ne rien perdre. Ces tests visent donc
 * d'abord ces trois mensonges-là.
 */

import { describe, expect, it } from 'vitest';

import {
  describeConflictCopy,
  isConflictCopy,
  listConflictResolutions,
  stripConflictMark,
} from '../conflictResolution';
import {
  applyConflictCopies,
  mergeNotesPayload,
  selectGenuineConflicts,
} from '../../../platform/web/sync/notesMerge';
import type { Note } from '../../../types/notes';

const DOC = (text: string): string =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

function note(over: Partial<Note> & { id: string }): Note {
  return {
    title: '',
    content: '',
    plainText: '',
    parentId: null,
    linkedNoteIds: [],
    linkedFileIds: [],
    linkedFolderIds: [],
    isDaily: false,
    wordCount: 0,
    tagIds: [],
    isPinned: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

const SAVED = '2026-08-15T12:00:00.000Z';

/** L'original, tel qu'il a survécu à l'arbitrage. */
const origine = (over: Partial<Note> = {}): Note =>
  note({
    id: 'n',
    title: 'Bug find filarr',
    content: DOC('la version qui a gagné'),
    plainText: 'la version qui a gagné',
    updatedAt: '2026-08-15T11:59:00.000Z',
    ...over,
  });

/** La copie, telle que `applyConflictCopies` la fabrique. */
const copie = (over: Partial<Note> = {}): Note =>
  note({
    id: 'copie-1',
    title: 'Bug find filarr (⚠ 2026-08-15)',
    content: DOC('la version perdue'),
    plainText: 'la version perdue',
    updatedAt: SAVED,
    conflictOfId: 'n',
    conflictSavedAt: SAVED,
    conflictOriginalUpdatedAt: '2026-08-14T09:00:00.000Z',
    conflictKeptUpdatedAt: '2026-08-15T11:58:00.000Z',
    conflictSide: 'local',
    conflictDevice: 'desktop',
    ...over,
  });

const table = (...notes: Note[]): Record<string, Note> =>
  Object.fromEntries(notes.map((n) => [n.id, n]));

describe('reconnaître une copie de conflit', () => {
  it('le champ machine fait foi, jamais la marque du titre', () => {
    expect(isConflictCopy(copie())).toBe(true);
    // Renommée à la main : la marque a disparu, la copie reste une copie.
    expect(isConflictCopy(copie({ title: 'mes notes du mardi' }))).toBe(true);
    // Un ⚠ écrit par l'utilisateur ne fait pas d'une note une copie.
    expect(isConflictCopy(origine({ title: 'Attention ⚠ relire' }))).toBe(false);
    expect(isConflictCopy(origine())).toBe(false);
    expect(isConflictCopy(copie({ conflictOfId: '   ' }))).toBe(false);
  });

  it('la marque de titre se retire sans emporter le reste', () => {
    expect(stripConflictMark('Projet (⚠ 2026-08-15)')).toBe('Projet');
    expect(stripConflictMark('Projet (⚠)')).toBe('Projet');
    expect(stripConflictMark('(⚠ 2026-08-15)')).toBe('');
    // Ancrée en FIN : un ⚠ au milieu du titre n'est pas une marque.
    expect(stripConflictMark('Relire (⚠ important) demain')).toBe('Relire (⚠ important) demain');
    expect(stripConflictMark('Projet')).toBe('Projet');
  });
});

describe('describeConflictCopy — les deux versions et leurs horodatages', () => {
  it('rend l’origine, la version conservée, la version perdante et les dates', () => {
    const vue = describeConflictCopy(copie(), table(origine(), copie()))!;

    expect(vue.originId).toBe('n');
    expect(vue.originState).toBe('live');
    expect(vue.origin?.id).toBe('n');

    // VERSION LOCALE (conservée) : celle qui vit sous l'id d'origine.
    expect(vue.kept).toMatchObject({ id: 'n', plainText: 'la version qui a gagné' });
    // VERSION PERDANTE : le contenu de la copie, titre DÉMARQUÉ.
    expect(vue.losing).toMatchObject({
      id: 'copie-1',
      title: 'Bug find filarr',
      plainText: 'la version perdue',
    });
    // …et son horodatage est celui d'AVANT la copie, pas celui de la fabrication.
    expect(vue.losing.updatedAt).toBe('2026-08-14T09:00:00.000Z');
    expect(vue.timestamps).toEqual({
      savedAt: SAVED,
      losingUpdatedAt: '2026-08-14T09:00:00.000Z',
      keptUpdatedAtAtCopy: '2026-08-15T11:58:00.000Z',
      keptUpdatedAtNow: '2026-08-15T11:59:00.000Z',
      copyUpdatedAt: SAVED,
    });
    // L'original a rebougé depuis l'arbitrage : les deux dates le disent.
    expect(vue.timestamps.keptUpdatedAtNow).not.toBe(vue.timestamps.keptUpdatedAtAtCopy);
  });

  it('dit d’où venait la perdante, sans jamais nommer une machine', () => {
    const vue = describeConflictCopy(copie(), table(origine(), copie()))!;
    expect(vue.side).toBe('local');
    expect(vue.device).toBe('desktop');
    expect(JSON.stringify(vue.losing)).not.toContain('desktop');
  });

  it('copie ANCIENNE, sans les champs de provenance : `null`, jamais une invention', () => {
    const ancienne = copie({
      conflictSide: undefined,
      conflictDevice: undefined,
      conflictKeptUpdatedAt: undefined,
    });
    const vue = describeConflictCopy(ancienne, table(origine(), ancienne))!;
    expect(vue.side).toBeNull();
    expect(vue.device).toBeNull();
    expect(vue.timestamps.keptUpdatedAtAtCopy).toBeNull();
    // Ce qui reste lisible l'est toujours : l'origine et les deux contenus.
    expect(vue.kept?.plainText).toBe('la version qui a gagné');
    expect(vue.losing.plainText).toBe('la version perdue');
  });

  it('origine à la CORBEILLE : signalée, et toujours comparable', () => {
    const poubelle = origine({ deletedAt: '2026-08-15T12:30:00.000Z' });
    const vue = describeConflictCopy(copie(), table(poubelle, copie()))!;
    expect(vue.originState).toBe('trashed');
    expect(vue.kept?.plainText).toBe('la version qui a gagné');
  });

  it('origine DISPARUE : la copie est le dernier porteur, et rien n’est comparé', () => {
    const vue = describeConflictCopy(copie(), table(copie()))!;
    expect(vue.originState).toBe('missing');
    expect(vue.origin).toBeNull();
    expect(vue.kept).toBeNull();
    expect(vue.identical).toBe(false); // sans comparaison possible, aucun feu vert
    expect(vue.losing.plainText).toBe('la version perdue');
  });

  it('copie qui se réclame d’elle-même (donnée abîmée) : rien à comparer', () => {
    const boucle = copie({ conflictOfId: 'copie-1' });
    const vue = describeConflictCopy(boucle, table(boucle))!;
    expect(vue.originState).toBe('self');
    expect(vue.kept).toBeNull();
    expect(vue.identical).toBe(false);
  });

  it('une note ordinaire ne donne aucun rapport', () => {
    expect(describeConflictCopy(origine(), table(origine()))).toBeNull();
  });

  it('`identical` n’est vrai que si titre, document ET texte coïncident', () => {
    const memeTexte = copie({
      content: origine().content,
      plainText: origine().plainText,
    });
    expect(describeConflictCopy(memeTexte, table(origine(), memeTexte))!.identical).toBe(true);

    // Un document différent pour un même texte (image, base inline, lien) :
    // JAMAIS « identique » — c'est exactement le contenu qu'un écran de purge
    // ferait disparaître en croyant ne rien perdre.
    const memeTexteAutreDoc = copie({
      content: JSON.stringify({ type: 'doc', content: [{ type: 'image', attrs: { src: 'x' } }] }),
      plainText: origine().plainText,
    });
    expect(
      describeConflictCopy(memeTexteAutreDoc, table(origine(), memeTexteAutreDoc))!.identical
    ).toBe(false);
  });

  it('`reworked` distingue la copie retouchée par un humain', () => {
    expect(describeConflictCopy(copie(), table(origine(), copie()))!.reworked).toBe(false);
    const retouchee = copie({ updatedAt: '2026-08-16T08:00:00.000Z' });
    expect(describeConflictCopy(retouchee, table(origine(), retouchee))!.reworked).toBe(true);
  });
});

describe('listConflictResolutions — toutes les copies, de la plus récente à la plus ancienne', () => {
  it('ordonne par date de fabrication, ignore les notes ordinaires et la corbeille', () => {
    const vieille = copie({ id: 'copie-0', conflictSavedAt: '2026-08-10T12:00:00.000Z' });
    const jetee = copie({ id: 'copie-2', deletedAt: '2026-08-16T00:00:00.000Z' });
    const liste = listConflictResolutions([origine(), vieille, copie(), jetee]);

    expect(liste.map((r) => r.copyId)).toEqual(['copie-1', 'copie-0']);
  });

  it('rend une liste vide quand aucune copie ne traîne', () => {
    expect(listConflictResolutions([origine()])).toEqual([]);
  });
});

/**
 * LE CONTRAT DE BOUT EN BOUT : ce que la FUSION écrit doit suffire au rapport.
 * Si `applyConflictCopies` cesse un jour de poser un champ, c'est ici que ça
 * casse — pas dans l'interface, six mois plus tard, devant l'utilisateur.
 */
describe('ce que la fusion fabrique est exactement ce que le rapport sait lire', () => {
  it('une copie née d’une vraie divergence se relit intégralement', () => {
    const local = {
      byId: {
        n: {
          ...origine(),
          content: DOC('écrit sur cet appareil'),
          plainText: 'écrit sur cet appareil',
          updatedAt: '2026-08-14T09:00:00.000Z',
        },
      },
      allIds: ['n'],
    };
    const remote = {
      byId: {
        n: {
          ...origine(),
          content: DOC('écrit ailleurs'),
          plainText: 'écrit ailleurs',
          updatedAt: '2026-08-15T11:59:00.000Z',
        },
      },
      allIds: ['n'],
    };

    const merged = mergeNotesPayload(local, remote);
    const kept = selectGenuineConflicts(
      merged.overwritten,
      merged.merged,
      {
        notes: { n: Date.parse('2026-08-13T00:00:00.000Z') },
        notebooks: {},
        remote: { notes: { n: Date.parse('2026-08-13T00:00:00.000Z') }, notebooks: {} },
      },
      null
    );
    expect(
      applyConflictCopies(merged.merged, kept, {
        now: SAVED,
        newId: () => 'copie-nee',
        device: 'web',
      })
    ).toBe(1);

    const byId = merged.merged.byId as Record<string, Note>;
    const vue = describeConflictCopy(byId['copie-nee'], byId)!;

    expect(vue.originId).toBe('n');
    expect(vue.originState).toBe('live');
    expect(vue.side).toBe('local'); // la perdante était sur cet appareil
    expect(vue.device).toBe('web');
    expect(vue.losing.plainText).toBe('écrit sur cet appareil');
    expect(vue.kept?.plainText).toBe('écrit ailleurs');
    expect(vue.losing.title).toBe('Bug find filarr'); // marque retirée
    expect(vue.timestamps.losingUpdatedAt).toBe('2026-08-14T09:00:00.000Z');
    expect(vue.timestamps.keptUpdatedAtAtCopy).toBe('2026-08-15T11:59:00.000Z');
    expect(vue.timestamps.savedAt).toBe(SAVED);
    expect(vue.identical).toBe(false);
    expect(vue.reworked).toBe(false);
  });
});
