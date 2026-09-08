/**
 * Le détecteur de notes parasites décide ce qui sera coché dans un écran de
 * SUPPRESSION DÉFINITIVE, dans le coffre réel du fondateur. Ces tests visent
 * donc d'abord les FAUX POSITIFS : une note légitime cochée par erreur est une
 * perte de données, une note parasite ratée n'est qu'un résidu de plus.
 */

import { describe, it, expect } from 'vitest';
import {
  findSuspectNotes,
  defaultSelection,
  documentHasSubstance,
  contentSignature,
  normalizeText,
  EXCERPT_LENGTH,
} from '../ghostNotes';
import type { Note } from '../../../types/notes';

const DOC = (text: string): string =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

/** Document quelconque : un paragraphe de texte suivi des nœuds donnés. */
const DOC_WITH = (text: string, ...nodes: unknown[]): string =>
  JSON.stringify({
    type: 'doc',
    content: [
      ...(text === '' ? [] : [{ type: 'paragraph', content: [{ type: 'text', text }] }]),
      ...nodes,
    ],
  });

const IMAGE = { type: 'image', attrs: { src: 'data:image/png;base64,AAA' } };

/** Base inline : ses lignes vivent dans `attrs.data`, aucun `plainText` ne les rend. */
const INLINE_DB = (rows: string[]): unknown => ({
  type: 'inlineDatabase',
  attrs: {
    title: 'Suivi',
    data: JSON.stringify({
      properties: [{ id: 'p1', name: 'Nom' }],
      rows: rows.map((r) => ({ p1: r })),
    }),
  },
});

/** Paragraphe dont le texte porte un lien : l'URL n'est nulle part dans `plainText`. */
const LINKED = (text: string, href: string): unknown => ({
  type: 'paragraph',
  content: [{ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }],
});

const EMPTY_DOC = JSON.stringify({ type: 'doc', content: [] });
const EMPTY_PARAGRAPH_DOC = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });

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

/** Note ordinaire, titrée et pleine. */
const healthy = (id: string, title: string, text: string): Note =>
  note({ id, title, content: DOC(text), plainText: text, wordCount: text.split(' ').length });

/** Copie de conflit telle que `applyConflictCopies` la fabrique. */
const conflictCopy = (
  id: string,
  originId: string,
  text: string,
  title = 'Projet (⚠ 2026-08-14)'
): Note =>
  note({
    id,
    title,
    content: DOC(text),
    plainText: text,
    conflictOfId: originId,
    conflictSavedAt: '2026-08-14T10:00:00.000Z',
    conflictOriginalUpdatedAt: '2026-08-13T09:00:00.000Z',
    updatedAt: '2026-08-14T10:00:00.000Z',
  });

/** Note miroir : titre vide, document vide, `plainText` volé à une autre note. */
const mirror = (id: string, stolenText: string, content = EMPTY_DOC): Note =>
  note({ id, title: '', content, plainText: stolenText, updatedAt: '2026-08-14T11:00:00.000Z' });

describe('findSuspectNotes — ce qui n’est JAMAIS suspect', () => {
  it('une note légitimement vide (titre vide, plainText vide) n’est pas suspecte', () => {
    // Le cas le plus dangereux : c’est exactement ce que `createNote` produit.
    const fresh = note({ id: 'n1', title: '', content: '', plainText: '' });
    expect(findSuspectNotes([fresh])).toEqual([]);
  });

  it('une note vide avec un document de paragraphes vides n’est pas suspecte', () => {
    const fresh = note({ id: 'n1', title: '', content: EMPTY_PARAGRAPH_DOC, plainText: '' });
    expect(findSuspectNotes([fresh])).toEqual([]);
  });

  it('une note vide dont le plainText n’est que des espaces n’est pas suspecte', () => {
    const fresh = note({ id: 'n1', title: '', content: EMPTY_DOC, plainText: '   \n\t  ' });
    expect(findSuspectNotes([fresh])).toEqual([]);
  });

  it('une note titrée avec du contenu n’est jamais suspecte', () => {
    expect(findSuspectNotes([healthy('n1', 'Projet', 'du texte')])).toEqual([]);
  });

  it('une note SANS titre mais avec un vrai document n’est pas suspecte', () => {
    // Une note sans titre est parfaitement normale tant que son document porte
    // le texte que `plainText` reflète.
    const untitled = note({
      id: 'n1',
      title: '',
      content: DOC('des idées'),
      plainText: 'des idées',
    });
    expect(findSuspectNotes([untitled])).toEqual([]);
  });

  it('une note titrée au document vide mais au plainText plein n’est pas suspecte', () => {
    // Deux des trois conditions du miroir : le titre suffit à disculper.
    const odd = note({ id: 'n1', title: 'Titre', content: EMPTY_DOC, plainText: 'texte résiduel' });
    expect(findSuspectNotes([odd])).toEqual([]);
  });

  it('une note dont le titre porte ⚠ sans champ conflictOfId n’est pas suspecte', () => {
    // La marque du titre est un signal d’appoint : un utilisateur peut la taper.
    const decoy = healthy('n1', 'Attention ⚠ danger', 'du texte');
    expect(findSuspectNotes([decoy])).toEqual([]);
  });

  it('un conflictOfId vide ou blanc ne fabrique pas de suspect', () => {
    const a = note({ ...healthy('n1', 'A', 'x'), conflictOfId: '' });
    const b = note({ ...healthy('n2', 'B', 'y'), conflictOfId: '   ' });
    expect(findSuspectNotes([a, b])).toEqual([]);
  });

  it('une note déjà à la corbeille n’est jamais listée', () => {
    const trashedCopy = { ...conflictCopy('c1', 'n1', 'x'), deletedAt: '2026-08-14T12:00:00.000Z' };
    const trashedMirror = { ...mirror('m1', 'volé'), deletedAt: '2026-08-14T12:00:00.000Z' };
    expect(findSuspectNotes([healthy('n1', 'Projet', 'x'), trashedCopy, trashedMirror])).toEqual(
      []
    );
  });
});

describe('findSuspectNotes — copies de conflit', () => {
  it('une copie dont l’original contient le texte est redondante ET cochée', () => {
    const origin = healthy('n1', 'Projet', 'alpha beta gamma');
    const copy = conflictCopy('c1', 'n1', 'beta gamma');
    const [suspect] = findSuspectNotes([origin, copy]);
    expect(suspect.id).toBe('c1');
    expect(suspect.family).toBe('conflictCopy');
    expect(suspect.verdict).toBe('redundant');
    expect(suspect.safeToPurge).toBe(true);
    expect(suspect.origin).toEqual({ id: 'n1', title: 'Projet' });
    expect(defaultSelection(findSuspectNotes([origin, copy]))).toEqual(['c1']);
  });

  it('une copie dont l’original a disparu est SIGNALÉE mais NON cochée', () => {
    const copy = conflictCopy('c1', 'disparu', 'du texte qui n’existe peut-être nulle part');
    const [suspect] = findSuspectNotes([copy]);
    expect(suspect.verdict).toBe('originGone');
    expect(suspect.safeToPurge).toBe(false);
    expect(suspect.origin).toBeNull();
    expect(suspect.originId).toBe('disparu');
    expect(defaultSelection([suspect])).toEqual([]);
  });

  it('une copie dont l’original est à la corbeille compte comme original disparu', () => {
    // La corbeille se vide : l’original n’est pas une garantie de conservation.
    const origin = {
      ...healthy('n1', 'Projet', 'alpha beta'),
      deletedAt: '2026-08-14T00:00:00.000Z',
    };
    const copy = conflictCopy('c1', 'n1', 'alpha beta');
    const [suspect] = findSuspectNotes([origin, copy]);
    expect(suspect.verdict).toBe('originGone');
    expect(suspect.safeToPurge).toBe(false);
  });

  it('une copie dont le texte n’est PAS contenu dans l’original est signalée NON cochée', () => {
    const origin = healthy('n1', 'Projet', 'alpha beta');
    const copy = conflictCopy('c1', 'n1', 'alpha beta ET UN PARAGRAPHE ÉCRIT NULLE PART AILLEURS');
    const [suspect] = findSuspectNotes([origin, copy]);
    expect(suspect.verdict).toBe('uniqueText');
    expect(suspect.safeToPurge).toBe(false);
    // L’original est tout de même montré : c’est avec lui qu’on compare.
    expect(suspect.origin).toEqual({ id: 'n1', title: 'Projet' });
    expect(defaultSelection([suspect])).toEqual([]);
  });

  it('l’inclusion est insensible aux sauts de ligne mais SENSIBLE à la casse', () => {
    const origin = healthy('n1', 'Projet', 'alpha\nbeta\n\ngamma');
    expect(
      findSuspectNotes([origin, conflictCopy('c1', 'n1', 'alpha beta gamma')])[0].verdict
    ).toBe('redundant');
    expect(findSuspectNotes([origin, conflictCopy('c2', 'n1', 'ALPHA BETA')])[0].verdict).toBe(
      'uniqueText'
    );
  });

  it('une copie renommée à la main reste détectée par son champ', () => {
    const origin = healthy('n1', 'Projet', 'alpha beta');
    const copy = conflictCopy('c1', 'n1', 'alpha', 'Mon brouillon');
    const [suspect] = findSuspectNotes([origin, copy]);
    expect(suspect.verdict).toBe('redundant');
    expect(suspect.titleMarked).toBe(false);
  });

  it('une copie qui se réclame d’elle-même n’est pas déclarée redondante', () => {
    // Sans garde, `origin === note` rendrait toute copie auto-référente
    // « redondante » avec elle-même, donc cochée, donc supprimée.
    const self = conflictCopy('c1', 'c1', 'texte unique');
    const [suspect] = findSuspectNotes([self]);
    expect(suspect.verdict).toBe('originGone');
    expect(suspect.safeToPurge).toBe(false);
    expect(suspect.origin).toBeNull();
  });

  it('une copie sans conflictSavedAt retombe sur updatedAt pour la date', () => {
    const origin = healthy('n1', 'Projet', 'alpha');
    const copy = note({
      ...conflictCopy('c1', 'n1', 'alpha'),
      conflictSavedAt: undefined,
      updatedAt: '2026-08-12T08:00:00.000Z',
    });
    expect(findSuspectNotes([origin, copy])[0].date).toBe('2026-08-12T08:00:00.000Z');
  });

  it('une copie vide de texte ET de document est redondante', () => {
    // Le seul cas où le texte vide ne prouve rien de dangereux : il n’y a
    // vraiment RIEN dans la copie.
    const origin = healthy('n1', 'Projet', 'alpha');
    const empty = note({ ...conflictCopy('c1', 'n1', ''), content: '', plainText: '' });
    expect(findSuspectNotes([origin, empty])[0].verdict).toBe('redundant');
  });

  it('le champ conflit l’emporte sur la signature miroir', () => {
    // Une copie qui coche aussi les trois cases du miroir doit rester jugée
    // comme copie : c’est le verdict le plus prudent des deux.
    const weird = note({
      id: 'c1',
      title: '',
      content: EMPTY_DOC,
      plainText: 'du texte',
      conflictOfId: 'introuvable',
    });
    const [suspect] = findSuspectNotes([weird]);
    expect(suspect.family).toBe('conflictCopy');
    expect(suspect.safeToPurge).toBe(false);
  });
});

/**
 * LE CŒUR DU DANGER. `redundant` est le seul verdict qui COCHE une copie, et la
 * copie est la version PERDANTE : son document peut porter ce qu'aucun
 * `plainText` ne restitue. Un détecteur qui ne compare que les textes est un
 * destructeur de contenu — ces cas doivent le tuer.
 */
describe('findSuspectNotes — copies de conflit : le DOCUMENT compte', () => {
  it('une copie SANS TEXTE dont le document porte une image n’est PAS redondante', () => {
    // `''.includes(x)` est vrai : la comparaison de textes seule cocherait cette
    // copie, et l’image serait détruite sans trace.
    const origin = healthy('n1', 'Projet', 'alpha beta');
    const copy = note({
      ...conflictCopy('c1', 'n1', ''),
      content: DOC_WITH('', IMAGE),
      plainText: '',
    });
    const [suspect] = findSuspectNotes([origin, copy]);
    expect(suspect.verdict).toBe('uniqueContent');
    expect(suspect.safeToPurge).toBe(false);
    expect(defaultSelection([suspect])).toEqual([]);
  });

  it('une copie sans texte portant une base inline seule n’est PAS redondante', () => {
    // Les lignes vivent dans `attrs.data` : rien n’en transparaît dans le texte.
    const origin = healthy('n1', 'Projet', 'alpha beta');
    const copy = note({
      ...conflictCopy('c1', 'n1', ''),
      content: DOC_WITH('', INLINE_DB(['ligne A', 'ligne B'])),
      plainText: '',
    });
    expect(findSuspectNotes([origin, copy])[0].verdict).toBe('uniqueContent');
  });

  it('une copie dont le texte EST dans l’original mais qui porte une image en plus n’est pas cochée', () => {
    const origin = healthy('n1', 'Projet', 'alpha beta gamma');
    const copy = note({
      ...conflictCopy('c1', 'n1', 'alpha beta'),
      content: DOC_WITH('alpha beta', IMAGE),
    });
    const [suspect] = findSuspectNotes([origin, copy]);
    expect(suspect.verdict).toBe('uniqueContent');
    expect(suspect.safeToPurge).toBe(false);
  });

  it('une copie portant une base inline que l’original porte aussi reste redondante', () => {
    // LIMITE ASSUMÉE : l’inclusion se juge sur les ESPÈCES de contenu, pas sur
    // leurs octets. L’original a bien une base inline ; le rapport ne prétend
    // pas qu’elle contient les mêmes lignes.
    const origin = note({
      ...healthy('n1', 'Projet', 'alpha beta'),
      content: DOC_WITH('alpha beta', INLINE_DB(['ligne A'])),
    });
    const copy = note({
      ...conflictCopy('c1', 'n1', 'alpha'),
      content: DOC_WITH('alpha', INLINE_DB(['ligne A'])),
    });
    expect(findSuspectNotes([origin, copy])[0].verdict).toBe('redundant');
  });

  it('l’URL d’un lien fait partie du contenu : une URL absente de l’original bloque', () => {
    const origin = note({
      ...healthy('n1', 'Projet', 'le site'),
      content: JSON.stringify({ type: 'doc', content: [LINKED('le site', 'https://a.example')] }),
    });
    const same = note({
      ...conflictCopy('c1', 'n1', 'le site'),
      content: JSON.stringify({ type: 'doc', content: [LINKED('le site', 'https://a.example')] }),
    });
    const other = note({
      ...conflictCopy('c2', 'n1', 'le site'),
      content: JSON.stringify({ type: 'doc', content: [LINKED('le site', 'https://b.example')] }),
    });
    expect(findSuspectNotes([origin, same])[0].verdict).toBe('redundant');
    expect(findSuspectNotes([origin, other])[0].verdict).toBe('uniqueContent');
  });

  it('le gras et l’italique ne bloquent pas : le texte les restitue', () => {
    const origin = healthy('n1', 'Projet', 'alpha beta');
    const copy = note({
      ...conflictCopy('c1', 'n1', 'alpha'),
      content: JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'alpha', marks: [{ type: 'bold' }] }],
          },
        ],
      }),
    });
    expect(findSuspectNotes([origin, copy])[0].verdict).toBe('redundant');
  });

  it('un type de nœud INCONNU compte comme du contenu (liste blanche, pas noire)', () => {
    const origin = healthy('n1', 'Projet', 'alpha beta');
    const copy = note({
      ...conflictCopy('c1', 'n1', 'alpha'),
      content: DOC_WITH('alpha', { type: 'extensionDeDemain', attrs: { payload: 'x' } }),
    });
    expect(findSuspectNotes([origin, copy])[0].verdict).toBe('uniqueContent');
  });

  it('un document ILLISIBLE ne peut jamais prouver sa redondance', () => {
    // Même quand les deux côtés sont illisibles : deux HTML hérités ne sont pas
    // pour autant le même HTML.
    const origin = note({ ...healthy('n1', 'Projet', 'alpha beta'), content: '<p>alpha beta</p>' });
    const copy = note({ ...conflictCopy('c1', 'n1', 'alpha'), content: '<p>alpha</p>' });
    expect(findSuspectNotes([origin, copy])[0].verdict).toBe('uniqueContent');
  });

  it('un tableau présent des DEUX côtés n’empêche pas la redondance', () => {
    const origin = note({
      ...healthy('n1', 'Projet', 'alpha beta'),
      content: DOC_WITH('alpha beta', { type: 'table', attrs: {} }),
    });
    const copy = note({
      ...conflictCopy('c1', 'n1', 'alpha'),
      content: DOC_WITH('alpha', { type: 'table', attrs: {} }),
    });
    expect(findSuspectNotes([origin, copy])[0].verdict).toBe('redundant');
  });
});

describe('findSuspectNotes — copies retravaillées à la main', () => {
  it('une copie modifiée APRÈS sa création n’est jamais cochée', () => {
    // À la naissance `updatedAt === conflictSavedAt` : un `updatedAt` postérieur
    // prouve qu’un humain y est repassé, même si son texte tient dans l’original.
    const origin = healthy('n1', 'Projet', 'alpha beta');
    const copy = note({
      ...conflictCopy('c1', 'n1', 'alpha'),
      updatedAt: '2026-08-14T18:30:00.000Z', // conflictSavedAt = 10:00
    });
    const [suspect] = findSuspectNotes([origin, copy]);
    expect(suspect.verdict).toBe('userEdited');
    expect(suspect.safeToPurge).toBe(false);
    expect(defaultSelection([suspect])).toEqual([]);
  });

  it('quelques secondes d’écart d’horloge ne comptent pas pour une retouche', () => {
    const origin = healthy('n1', 'Projet', 'alpha beta');
    const copy = note({
      ...conflictCopy('c1', 'n1', 'alpha'),
      updatedAt: '2026-08-14T10:00:03.000Z', // 3 s après la fabrication
    });
    expect(findSuspectNotes([origin, copy])[0].verdict).toBe('redundant');
  });

  it('sans conflictSavedAt lisible, aucune retouche n’est affirmée', () => {
    const origin = healthy('n1', 'Projet', 'alpha beta');
    const copy = note({
      ...conflictCopy('c1', 'n1', 'alpha'),
      conflictSavedAt: undefined,
      updatedAt: '2026-08-20T00:00:00.000Z',
    });
    expect(findSuspectNotes([origin, copy])[0].verdict).toBe('redundant');
  });
});

describe('findSuspectNotes — notes miroir', () => {
  it('une note miroir est cochée QUAND la note qui porte son texte est retrouvée', () => {
    const [suspect] = findSuspectNotes([
      healthy('n1', 'Source', 'la frappe'),
      mirror('m1', 'la frappe'),
    ]);
    expect(suspect.id).toBe('m1');
    expect(suspect.family).toBe('mirror');
    expect(suspect.verdict).toBe('mirror');
    expect(suspect.safeToPurge).toBe(true);
    expect(suspect.excerpt).toBe('la frappe');
    // La note d’origine est EXPOSÉE : l’utilisateur doit pouvoir vérifier.
    expect(suspect.origin).toEqual({ id: 'n1', title: 'Source' });
  });

  it('une note miroir dont le texte n’est retrouvé NULLE PART est signalée, jamais cochée', () => {
    // « Son texte appartient à une autre note » est une affirmation : sans la
    // note en question, le miroir est peut-être le dernier porteur du texte.
    const [suspect] = findSuspectNotes([
      healthy('n1', 'Source', 'un tout autre texte'),
      mirror('m1', 'la frappe perdue'),
    ]);
    expect(suspect.verdict).toBe('mirrorOrphan');
    expect(suspect.safeToPurge).toBe(false);
    expect(suspect.origin).toBeNull();
    expect(defaultSelection([suspect])).toEqual([]);
  });

  it('deux miroirs jumeaux ne se couvrent pas l’un l’autre', () => {
    // Sinon chacun « prouverait » l’autre et les deux seraient supprimés.
    const suspects = findSuspectNotes([mirror('m1', 'la frappe'), mirror('m2', 'la frappe')]);
    expect(suspects.map((s) => s.verdict)).toEqual(['mirrorOrphan', 'mirrorOrphan']);
    expect(defaultSelection(suspects)).toEqual([]);
  });

  it('une copie de conflit ne sert pas de porteur à un miroir', () => {
    // Elle est elle-même candidate à la suppression : elle ne garantit rien.
    const copy = conflictCopy('c1', 'absent', 'la frappe');
    const suspects = findSuspectNotes([copy, mirror('m1', 'la frappe')]);
    expect(suspects.find((s) => s.id === 'm1')?.verdict).toBe('mirrorOrphan');
  });

  it('le porteur peut contenir le texte du miroir au milieu du sien', () => {
    const holder = healthy('n1', 'Source', 'avant la frappe après');
    expect(findSuspectNotes([holder, mirror('m1', 'la frappe')])[0].verdict).toBe('mirror');
  });

  it('une note à la corbeille ne peut pas servir de porteur', () => {
    const trashed = { ...healthy('n1', 'Source', 'la frappe'), deletedAt: '2026-08-14T00:00:00Z' };
    expect(findSuspectNotes([trashed, mirror('m1', 'la frappe')])[0].verdict).toBe('mirrorOrphan');
  });

  it('les trois formes de document vide déclenchent la détection', () => {
    const forms = ['', EMPTY_DOC, EMPTY_PARAGRAPH_DOC];
    for (const content of forms) {
      expect(findSuspectNotes([mirror('m1', 'texte volé', content)])).toHaveLength(1);
    }
  });

  it('un titre fait uniquement d’espaces compte comme vide', () => {
    const m = note({ ...mirror('m1', 'texte volé'), title: '   ' });
    expect(findSuspectNotes([m])).toHaveLength(1);
  });

  it('un document ne contenant qu’une image n’est PAS un miroir', () => {
    // Une image ne produit pas de plainText, mais elle est du contenu réel :
    // supprimer la note la détruirait.
    const withImage = note({
      id: 'n1',
      title: '',
      content: JSON.stringify({
        type: 'doc',
        content: [{ type: 'image', attrs: { src: 'data:image/png;base64,AAA' } }],
      }),
      plainText: 'légende résiduelle',
    });
    expect(findSuspectNotes([withImage])).toEqual([]);
  });

  it('un document contenant un tableau ou une sous-page n’est PAS un miroir', () => {
    for (const type of ['table', 'subPage', 'inlineDatabase', 'codeBlock']) {
      const n = note({
        id: 'n1',
        title: '',
        content: JSON.stringify({ type: 'doc', content: [{ type, attrs: {} }] }),
        plainText: 'texte',
      });
      expect(findSuspectNotes([n])).toEqual([]);
    }
  });

  it('un contenu illisible (JSON invalide) n’est jamais un miroir', () => {
    const legacy = note({
      id: 'n1',
      title: '',
      content: '<p>vieux HTML</p>',
      plainText: 'vieux HTML',
    });
    expect(findSuspectNotes([legacy])).toEqual([]);
  });

  it('un document dont un paragraphe imbriqué porte du texte n’est pas un miroir', () => {
    const nested = note({
      id: 'n1',
      title: '',
      content: JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
          },
        ],
      }),
      plainText: 'x',
    });
    expect(findSuspectNotes([nested])).toEqual([]);
  });

  it('un document dont le seul texte est blanc reste vide', () => {
    const blank = note({
      id: 'm1',
      title: '',
      content: JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '   ' }] }],
      }),
      plainText: 'du texte volé',
    });
    expect(findSuspectNotes([blank])).toHaveLength(1);
  });
});

describe('findSuspectNotes — rapport', () => {
  it('trie par famille puis par date décroissante, id en départage', () => {
    const origin = healthy('n1', 'Projet', 'alpha beta');
    const older = note({
      ...conflictCopy('c-old', 'n1', 'alpha'),
      conflictSavedAt: '2026-08-10T00:00:00.000Z',
    });
    const newer = note({
      ...conflictCopy('c-new', 'n1', 'beta'),
      conflictSavedAt: '2026-08-14T00:00:00.000Z',
    });
    const m = mirror('m1', 'texte');
    expect(findSuspectNotes([m, older, newer, origin]).map((s) => s.id)).toEqual([
      'c-new',
      'c-old',
      'm1',
    ]);
  });

  it('l’extrait est tronqué et signalé', () => {
    const long = 'x'.repeat(EXCERPT_LENGTH + 50);
    const [suspect] = findSuspectNotes([mirror('m1', long)]);
    expect(suspect.excerpt).toHaveLength(EXCERPT_LENGTH);
    expect(suspect.truncated).toBe(true);
  });

  it('l’extrait tronque AVANT de normaliser, sans se tromper sur la troncature', () => {
    // Normaliser des mégaoctets pour n’en montrer que 180 caractères coûte pour
    // rien : on lit une fenêtre bornée du texte brut.
    const wordy = findSuspectNotes([mirror('m1', 'mot '.repeat(400))])[0];
    expect(wordy.excerpt).toHaveLength(EXCERPT_LENGTH);
    expect(wordy.excerpt.startsWith('mot mot')).toBe(true);
    expect(wordy.truncated).toBe(true);

    // Une queue faite uniquement de blancs n’est pas du texte coupé.
    const padded = findSuspectNotes([mirror('m2', `court${' '.repeat(2000)}`)])[0];
    expect(padded.excerpt).toBe('court');
    expect(padded.truncated).toBe(false);
  });

  it('defaultSelection ne retient que le prouvé sans perte', () => {
    const origin = healthy('n1', 'Projet', 'alpha beta');
    const holder = healthy('n2', 'Porteur', 'texte volé');
    const suspects = findSuspectNotes([
      origin,
      holder,
      conflictCopy('c-ok', 'n1', 'alpha'),
      conflictCopy('c-unique', 'n1', 'texte introuvable'),
      conflictCopy('c-orphan', 'parti', 'texte'),
      note({
        ...conflictCopy('c-image', 'n1', 'alpha'),
        content: DOC_WITH('alpha', IMAGE),
      }),
      note({
        ...conflictCopy('c-edited', 'n1', 'alpha'),
        updatedAt: '2026-08-15T10:00:00.000Z',
      }),
      mirror('m1', 'texte volé'),
      mirror('m2', 'texte jamais vu ailleurs'),
    ]);
    expect(suspects).toHaveLength(7);
    expect(defaultSelection(suspects).sort()).toEqual(['c-ok', 'm1']);
  });

  it('un lot vide rend un rapport vide', () => {
    expect(findSuspectNotes([])).toEqual([]);
    expect(defaultSelection([])).toEqual([]);
  });
});

describe('primitives', () => {
  it('normalizeText réduit tous les blancs, insécables compris', () => {
    expect(normalizeText('a \n b  c ')).toBe('a b c');
    expect(normalizeText(undefined)).toBe('');
    expect(normalizeText(42)).toBe('');
  });

  it('documentHasSubstance ne déclare vide QUE le vide prouvé', () => {
    expect(documentHasSubstance('')).toBe(false);
    expect(documentHasSubstance('   ')).toBe(false);
    expect(documentHasSubstance(EMPTY_DOC)).toBe(false);
    expect(documentHasSubstance(EMPTY_PARAGRAPH_DOC)).toBe(false);
    expect(documentHasSubstance(DOC('x'))).toBe(true);
    expect(documentHasSubstance('pas du JSON')).toBe(true);
    // Illisible ≠ vide : un contenu qu’on ne sait pas lire est PORTEUR, sinon on
    // le supprime sur une lecture ratée.
    expect(documentHasSubstance(undefined)).toBe(true);
    expect(documentHasSubstance(null)).toBe(true);
    expect(documentHasSubstance(JSON.stringify(null))).toBe(true);
    expect(documentHasSubstance(JSON.stringify(42))).toBe(true);
    expect(documentHasSubstance({ type: 'doc' })).toBe(true);
  });

  it('contentSignature ne retient que ce que le texte ne restitue pas', () => {
    expect(Array.from(contentSignature(DOC('bonjour')))).toEqual([]);
    expect(Array.from(contentSignature(EMPTY_DOC))).toEqual([]);
    expect(Array.from(contentSignature(''))).toEqual([]);
    expect(Array.from(contentSignature(DOC_WITH('x', IMAGE)))).toEqual(['node:image']);
    expect(Array.from(contentSignature(DOC_WITH('x', INLINE_DB(['a']))))).toEqual([
      'node:inlineDatabase',
    ]);
    expect(
      Array.from(contentSignature(JSON.stringify({ type: 'doc', content: [LINKED('x', 'u://v')] })))
    ).toEqual(['mark:link:u://v']);
    // Un fragment illisible ne se compare à rien, pas même à lui-même.
    const opaque = contentSignature('<p>html</p>');
    expect(opaque.size).toBe(1);
    expect(opaque.has('node:image')).toBe(false);
  });
});
