/**
 * Comparaison bloc par bloc et reconstruction du document fusionné.
 *
 * CE QUI EST EN JEU. Cet écran écrase une note avec le résultat de la
 * comparaison, puis purge définitivement la copie de conflit. Un diff qui
 * confond deux blocs, un regroupement instable, ou une reconstruction qui perd
 * un nœud (une image, un tableau, une base inline) détruit du contenu chez un
 * utilisateur persuadé d'avoir tout gardé. Ces tests visent d'abord ces
 * défauts-là, avant l'esthétique du découpage.
 */

import { describe, expect, it } from 'vitest';

import {
  buildHunks,
  compareDocuments,
  decisionSummary,
  diffBlocks,
  mergedBlocks,
  mergedDocument,
  unresolvedHunkIds,
} from '../blockDiff';
import type { DiffBlock, HunkChoices } from '../blockDiff';

// ==================== Fabriques ====================

const para = (text: string): unknown => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});

const doc = (...nodes: unknown[]): string => JSON.stringify({ type: 'doc', content: nodes });

/** Document fait de paragraphes de texte simple. */
const text = (...lines: string[]): string => doc(...lines.map(para));

/** Bloc nu, pour éprouver `diffBlocks` sans passer par la lecture d'un document. */
const block = (key: string, index = 0): DiffBlock => ({
  index,
  key,
  type: 'paragraph',
  text: key,
  summary: '',
  node: para(key),
});

const ops = (changes: ReturnType<typeof diffBlocks>): string[] =>
  changes.map((change) => `${change.op}:${(change.mine ?? change.theirs)?.key ?? ''}`);

const kinds = (hunks: ReturnType<typeof buildHunks>): string[] => hunks.map((hunk) => hunk.kind);

/** Textes des blocs, dans l'ordre, tels qu'ils atterriraient dans le document. */
const merged = (mine: string, theirs: string, choices: HunkChoices = {}): string[] => {
  const comparison = compareDocuments(mine, theirs);
  return mergedBlocks(comparison.hunks, choices).map((b) => b.text);
};

// ==================== Différence de séquence ====================

describe('diffBlocks — la séquence', () => {
  it('deux listes identiques ne portent que du commun', () => {
    const list = [block('a', 0), block('b', 1), block('c', 2)];
    expect(ops(diffBlocks(list, list))).toEqual(['common:a', 'common:b', 'common:c']);
  });

  it('deux listes vides ne portent rien', () => {
    expect(diffBlocks([], [])).toEqual([]);
  });

  it('tout est ajouté quand le côté gauche est vide', () => {
    expect(ops(diffBlocks([], [block('a'), block('b')]))).toEqual(['added:a', 'added:b']);
  });

  it('tout est retiré quand le côté droit est vide', () => {
    expect(ops(diffBlocks([block('a'), block('b')], []))).toEqual(['removed:a', 'removed:b']);
  });

  it('un bloc inséré au milieu ne bouscule pas ses voisins', () => {
    const mine = [block('a', 0), block('c', 1)];
    const theirs = [block('a', 0), block('b', 1), block('c', 2)];
    expect(ops(diffBlocks(mine, theirs))).toEqual(['common:a', 'added:b', 'common:c']);
  });

  it('un bloc retiré au milieu ne bouscule pas ses voisins', () => {
    const mine = [block('a', 0), block('b', 1), block('c', 2)];
    const theirs = [block('a', 0), block('c', 1)];
    expect(ops(diffBlocks(mine, theirs))).toEqual(['common:a', 'removed:b', 'common:c']);
  });

  it('un remplacement sort le retrait AVANT l’ajout', () => {
    const mine = [block('a', 0), block('b', 1), block('c', 2)];
    const theirs = [block('a', 0), block('B', 1), block('c', 2)];
    expect(ops(diffBlocks(mine, theirs))).toEqual(['common:a', 'removed:b', 'added:B', 'common:c']);
  });

  it('deux listes sans rien de commun ne fabriquent aucun faux commun', () => {
    const changes = diffBlocks([block('a'), block('b')], [block('x'), block('y')]);
    expect(changes.every((change) => change.op !== 'common')).toBe(true);
    expect(ops(changes)).toEqual(['removed:a', 'removed:b', 'added:x', 'added:y']);
  });
});

// ==================== Regroupement ====================

describe('buildHunks — les différences décidables', () => {
  it('les blocs communs contigus tiennent en un seul groupe', () => {
    const list = [block('a', 0), block('b', 1)];
    const hunks = buildHunks(diffBlocks(list, list));
    expect(kinds(hunks)).toEqual(['common']);
    expect(hunks[0].mine).toHaveLength(2);
  });

  it('un retrait suivi d’un ajout ne fait QU’UNE différence', () => {
    const mine = [block('a', 0), block('b', 1), block('c', 2)];
    const theirs = [block('a', 0), block('B', 1), block('c', 2)];
    const hunks = buildHunks(diffBlocks(mine, theirs));
    expect(kinds(hunks)).toEqual(['common', 'changed', 'common']);
    expect(hunks[1].mine.map((b) => b.key)).toEqual(['b']);
    expect(hunks[1].theirs.map((b) => b.key)).toEqual(['B']);
  });

  it('un ajout seul et un retrait seul gardent leur nature', () => {
    const added = buildHunks(diffBlocks([block('a')], [block('a', 0), block('b', 1)]));
    expect(kinds(added)).toEqual(['common', 'added']);
    const removed = buildHunks(diffBlocks([block('a', 0), block('b', 1)], [block('a')]));
    expect(kinds(removed)).toEqual(['common', 'removed']);
  });

  it('les identifiants de différence sont stables d’un appel à l’autre', () => {
    const mine = [block('a', 0), block('b', 1)];
    const theirs = [block('a', 0), block('B', 1)];
    const first = buildHunks(diffBlocks(mine, theirs)).map((hunk) => hunk.id);
    const second = buildHunks(diffBlocks(mine, theirs)).map((hunk) => hunk.id);
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(first.length);
  });
});

// ==================== Lecture des documents ====================

describe('compareDocuments — ce que l’écran reçoit', () => {
  it('deux documents identiques n’ont aucune différence', () => {
    const same = text('un', 'deux');
    const comparison = compareDocuments(same, same);
    expect(comparison.comparable).toBe(true);
    expect(comparison.differences).toBe(0);
    expect(kinds(comparison.hunks)).toEqual(['common']);
  });

  it('un paragraphe réécrit donne une seule différence à deux côtés', () => {
    const comparison = compareDocuments(text('un', 'deux'), text('un', 'DEUX'));
    expect(comparison.differences).toBe(1);
    const changed = comparison.hunks.find((hunk) => hunk.kind === 'changed');
    expect(changed?.mine[0].text).toBe('deux');
    expect(changed?.theirs[0].text).toBe('DEUX');
  });

  it('un document vide face à un document plein : tout est ajouté', () => {
    const comparison = compareDocuments('', text('un'));
    expect(comparison.comparable).toBe(true);
    expect(kinds(comparison.hunks)).toEqual(['added']);
  });

  it('deux documents vides sont comparables et sans différence', () => {
    const comparison = compareDocuments('', '');
    expect(comparison.comparable).toBe(true);
    expect(comparison.hunks).toEqual([]);
    expect(comparison.differences).toBe(0);
  });

  it('un document illisible se déclare INCOMPARABLE plutôt que d’inventer', () => {
    expect(compareDocuments('{ pas du json', text('un')).comparable).toBe(false);
    expect(compareDocuments(text('un'), 'null').comparable).toBe(false);
    expect(compareDocuments(text('un'), 42).comparable).toBe(false);
  });

  it('l’ordre des clés du JSON ne fabrique pas de fausse différence', () => {
    const mine = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { textAlign: 'left' }, content: [] }],
    });
    const theirs = JSON.stringify({
      type: 'doc',
      content: [{ attrs: { textAlign: 'left' }, content: [], type: 'paragraph' }],
    });
    expect(compareDocuments(mine, theirs).differences).toBe(0);
  });

  it('un lien ajouté sur le même texte EST une différence', () => {
    const plain = doc({ type: 'paragraph', content: [{ type: 'text', text: 'filarr' }] });
    const linked = doc({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'filarr', marks: [{ type: 'link', attrs: { href: 'https://x' } }] },
      ],
    });
    expect(compareDocuments(plain, linked).differences).toBe(1);
  });

  it('le texte d’une liste se lit ligne par ligne', () => {
    const list = doc({
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [para('un')] },
        { type: 'listItem', content: [para('deux')] },
      ],
    });
    const comparison = compareDocuments(list, text('autre'));
    const removed = comparison.hunks.find((hunk) => hunk.kind === 'changed');
    expect(removed?.mine[0].text).toBe('un\ndeux');
  });

  it('un bloc sans texte garde son type pour que l’écran sache le nommer', () => {
    const image = doc({ type: 'image', attrs: { src: 'data:image/png;base64,AAA' } });
    const comparison = compareDocuments(text('un'), image);
    const changed = comparison.hunks.find((hunk) => hunk.kind === 'changed');
    expect(changed?.theirs[0].type).toBe('image');
    expect(changed?.theirs[0].text).toBe('');
  });
});

// ==================== Construction du résultat ====================

describe('mergedBlocks / mergedDocument — le résultat', () => {
  it('sans aucun choix, le résultat est exactement ma version', () => {
    expect(merged(text('a', 'b'), text('a', 'B'))).toEqual(['a', 'b']);
  });

  it('en prenant leur côté sur la seule différence, le résultat est leur version', () => {
    const comparison = compareDocuments(text('a', 'b'), text('a', 'B'));
    const changed = comparison.hunks.find((hunk) => hunk.kind === 'changed');
    expect(mergedBlocks(comparison.hunks, { [changed!.id]: 'theirs' }).map((b) => b.text)).toEqual([
      'a',
      'B',
    ]);
  });

  it('tout ce qui diverge d’une seule traite ne fait qu’UNE différence', () => {
    // « b » réécrit ET « c » ajouté juste derrière : une seule place du
    // document, donc un seul choix — pas deux boutons pour un même endroit.
    const comparison = compareDocuments(text('a', 'b'), text('a', 'B', 'c'));
    expect(comparison.differences).toBe(1);
    const changed = comparison.hunks.find((hunk) => hunk.kind === 'changed');
    expect(mergedBlocks(comparison.hunks, { [changed!.id]: 'theirs' }).map((b) => b.text)).toEqual([
      'a',
      'B',
      'c',
    ]);
  });

  it('bloc par bloc : je garde mon paragraphe ET je prends leur ajout', () => {
    const comparison = compareDocuments(
      text('intro', 'corps', 'fin'),
      text('intro', 'CORPS', 'fin', 'annexe')
    );
    const differing = comparison.hunks.filter((hunk) => hunk.kind !== 'common');
    expect(differing.map((hunk) => hunk.kind)).toEqual(['changed', 'added']);
    const choices = { [differing[0].id]: 'mine', [differing[1].id]: 'theirs' } as HunkChoices;
    expect(mergedBlocks(comparison.hunks, choices).map((b) => b.text)).toEqual([
      'intro',
      'corps',
      'fin',
      'annexe',
    ]);
  });

  it('le nœud d’origine est RECOPIÉ tel quel : une image survit à la fusion', () => {
    const image = { type: 'image', attrs: { src: 'data:image/png;base64,AAA' } };
    const comparison = compareDocuments(text('a'), doc(para('a'), image));
    const added = comparison.hunks.find((hunk) => hunk.kind === 'added');
    const { content } = mergedDocument(comparison, { [added!.id]: 'theirs' });
    expect(JSON.parse(content).content[1]).toEqual(image);
  });

  it('le texte brut suit le document choisi', () => {
    const comparison = compareDocuments(text('a', 'b'), text('a', 'B'));
    const changed = comparison.hunks.find((hunk) => hunk.kind === 'changed');
    const { plainText } = mergedDocument(comparison, { [changed!.id]: 'theirs' });
    expect(plainText).toBe('a\n\nB');
  });

  it('un résultat sans aucun bloc reste un document que l’éditeur sait rouvrir', () => {
    const comparison = compareDocuments(text('a'), '');
    const removed = comparison.hunks.find((hunk) => hunk.kind === 'removed');
    const { content, plainText } = mergedDocument(comparison, { [removed!.id]: 'theirs' });
    expect(JSON.parse(content)).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(plainText).toBe('');
  });

  it('les attributs de la racine de ma version sont conservés', () => {
    const mine = JSON.stringify({ type: 'doc', attrs: { lang: 'fr' }, content: [para('a')] });
    const comparison = compareDocuments(mine, text('a', 'b'));
    const { content } = mergedDocument(comparison, {});
    expect(JSON.parse(content).attrs).toEqual({ lang: 'fr' });
  });

  it('un document incomparable rend tout de même un document valide', () => {
    const comparison = compareDocuments('{ cassé', text('a'));
    const { content } = mergedDocument(comparison, {});
    expect(JSON.parse(content)).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });
});

// ==================== État de la résolution ====================

describe('decisionSummary / unresolvedHunkIds — le compte à rendre', () => {
  it('rien n’est tranché tant que rien n’est choisi', () => {
    const comparison = compareDocuments(
      text('intro', 'corps', 'fin'),
      text('intro', 'CORPS', 'fin', 'annexe')
    );
    const summary = decisionSummary(comparison.hunks);
    expect(summary.total).toBe(2);
    expect(summary.decided).toBe(0);
    expect(summary.allMine).toBe(false);
    expect(summary.allTheirs).toBe(false);
    expect(unresolvedHunkIds(comparison.hunks)).toHaveLength(2);
  });

  it('tout d’un côté se reconnaît, et plus rien n’attend', () => {
    const comparison = compareDocuments(
      text('intro', 'corps', 'fin'),
      text('intro', 'CORPS', 'fin', 'annexe')
    );
    const choices: Record<string, 'mine' | 'theirs'> = {};
    for (const hunk of comparison.hunks) {
      if (hunk.kind !== 'common') choices[hunk.id] = 'theirs';
    }
    const summary = decisionSummary(comparison.hunks, choices);
    expect(summary.decided).toBe(summary.total);
    expect(summary.allTheirs).toBe(true);
    expect(summary.allMine).toBe(false);
    expect(unresolvedHunkIds(comparison.hunks, choices)).toEqual([]);
  });

  it('un choix mêlé n’est ni tout à moi ni tout à eux', () => {
    const comparison = compareDocuments(
      text('intro', 'corps', 'fin'),
      text('intro', 'CORPS', 'fin', 'annexe')
    );
    const differing = comparison.hunks.filter((hunk) => hunk.kind !== 'common');
    const choices = { [differing[0].id]: 'mine', [differing[1].id]: 'theirs' } as HunkChoices;
    const summary = decisionSummary(comparison.hunks, choices);
    expect(summary.decided).toBe(2);
    expect(summary.allMine).toBe(false);
    expect(summary.allTheirs).toBe(false);
  });

  it('un document sans différence n’est ni « tout à moi » ni « tout à eux »', () => {
    const same = text('a');
    const summary = decisionSummary(compareDocuments(same, same).hunks);
    expect(summary.total).toBe(0);
    expect(summary.allMine).toBe(false);
    expect(summary.allTheirs).toBe(false);
  });
});

// ==================== Dérive de schéma entre deux clients ====================

describe('égalité — un attribut absent et un attribut nul disent la même chose', () => {
  // Le scénario n'est pas théorique : un conflit vient PAR DÉFINITION de deux
  // appareils, souvent de deux versions. ProseMirror émet l'objet `attrs`
  // COMPLET dès qu'un type déclare un attribut, donc un client qui charge une
  // extension de plus écrit `{"attrs":{"blockId":null}}` là où l'autre n'écrit
  // rien. Les confondre est ce qui empêche le document ENTIER de se présenter
  // comme une seule différence — dégradation totale, et muette.
  const bare = JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }],
  });
  const decorated = JSON.stringify({
    type: 'doc',
    content: [
      { type: 'paragraph', attrs: { blockId: null }, content: [{ type: 'text', text: 'a' }] },
    ],
  });

  it('ne fabrique aucune différence', () => {
    const comparison = compareDocuments(bare, decorated);
    expect(comparison.differences).toBe(0);
    expect(kinds(comparison.hunks)).toEqual(['common']);
  });

  it('vaut aussi en profondeur et sur un objet devenu vide', () => {
    const nested = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: {}, content: [{ type: 'text', text: 'a', marks: null }] },
      ],
    });
    expect(compareDocuments(bare, nested).differences).toBe(0);
  });

  it('mais une VRAIE valeur reste une différence', () => {
    const marked = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { blockId: 'z9' }, content: [{ type: 'text', text: 'a' }] },
      ],
    });
    expect(compareDocuments(bare, marked).differences).toBe(1);
  });

  it('et `false`, `0` ne sont pas des absences', () => {
    const off = JSON.stringify({ type: 'doc', content: [{ type: 'x', attrs: { on: false } }] });
    const zero = JSON.stringify({ type: 'doc', content: [{ type: 'x', attrs: { on: 0 } }] });
    const none = JSON.stringify({ type: 'doc', content: [{ type: 'x' }] });
    expect(compareDocuments(off, none).differences).toBe(1);
    expect(compareDocuments(off, zero).differences).toBe(1);
  });
});

// ==================== Empreinte du couple comparé ====================

describe('signature — un choix pris sur une comparaison périmée ne compte plus', () => {
  it('les identifiants de différence la portent', () => {
    const comparison = compareDocuments(text('a', 'b'), text('a', 'B'));
    expect(comparison.signature).not.toBe('');
    for (const hunk of comparison.hunks) {
      expect(hunk.id.endsWith(`@${comparison.signature}`)).toBe(true);
    }
  });

  it('elle change dès que l’un des deux côtés change', () => {
    const base = compareDocuments(text('a', 'b'), text('a', 'B'));
    expect(compareDocuments(text('a', 'b', 'c'), text('a', 'B')).signature).not.toBe(
      base.signature
    );
    expect(compareDocuments(text('a', 'b'), text('a', 'C')).signature).not.toBe(base.signature);
  });

  it('elle est stable à contenu égal', () => {
    expect(compareDocuments(text('a'), text('b')).signature).toBe(
      compareDocuments(text('a'), text('b')).signature
    );
  });

  it('un choix de l’ancienne comparaison n’est pas compté par la nouvelle', () => {
    const before = compareDocuments(text('intro', 'corps'), text('intro', 'CORPS'));
    const stale = before.hunks.filter((hunk) => hunk.kind !== 'common')[0].id;
    // La note change sous l'écran : un cycle de synchronisation a tourné.
    const after = compareDocuments(text('intro', 'corps', 'ajout'), text('intro', 'CORPS'));
    const choices = { [stale]: 'theirs' } as HunkChoices;
    const summary = decisionSummary(after.hunks, choices);
    expect(summary.decided).toBe(0);
    expect(unresolvedHunkIds(after.hunks, choices)).toHaveLength(summary.total);
  });
});

// ==================== Garder les deux ====================

describe('garder les deux — la seule issue qui ne jette rien', () => {
  it('concatène ma version puis la leur', () => {
    const comparison = compareDocuments(text('intro', 'mien', 'fin'), text('intro', 'leur', 'fin'));
    const changed = comparison.hunks.find((hunk) => hunk.kind === 'changed');
    expect(changed).toBeDefined();
    const choices = { [String(changed?.id)]: 'both' } as HunkChoices;
    expect(mergedBlocks(comparison.hunks, choices).map((b) => b.text)).toEqual([
      'intro',
      'mien',
      'leur',
      'fin',
    ]);
  });

  it('est tranché, sans être « tout à moi » ni « tout à eux »', () => {
    const comparison = compareDocuments(text('a'), text('B'));
    const changed = comparison.hunks.filter((hunk) => hunk.kind !== 'common');
    const choices = { [changed[0].id]: 'both' } as HunkChoices;
    const summary = decisionSummary(comparison.hunks, choices);
    expect(summary.decided).toBe(summary.total);
    expect(summary.allMine).toBe(false);
    expect(summary.allTheirs).toBe(false);
    expect(unresolvedHunkIds(comparison.hunks, choices)).toEqual([]);
  });

  it('recopie les nœuds des deux côtés, sans en reconstruire aucun', () => {
    const mine = JSON.stringify({ type: 'doc', content: [{ type: 'image', attrs: { src: 'a' } }] });
    const theirs = JSON.stringify({
      type: 'doc',
      content: [{ type: 'image', attrs: { src: 'b' } }],
    });
    const comparison = compareDocuments(mine, theirs);
    const changed = comparison.hunks.filter((hunk) => hunk.kind !== 'common');
    const built = mergedDocument(comparison, { [changed[0].id]: 'both' } as HunkChoices);
    expect(JSON.parse(built.content).content).toEqual([
      { type: 'image', attrs: { src: 'a' } },
      { type: 'image', attrs: { src: 'b' } },
    ]);
  });
});

// ==================== Résumé d'un bloc sans texte ====================

describe('résumé — un bloc atomique doit être discernable', () => {
  /** Les blocs d'un document, lus par le même chemin que l'écran. */
  const blocksOf = (node: unknown): DiffBlock[] =>
    compareDocuments(
      JSON.stringify({ type: 'doc', content: [node] }),
      JSON.stringify({ type: 'doc', content: [] })
    ).hunks.flatMap((hunk) => hunk.mine);

  it('une base inline annonce son titre et son nombre de lignes', () => {
    const [first] = blocksOf({
      type: 'inlineDatabase',
      attrs: {
        data: JSON.stringify({
          title: 'Films à voir',
          properties: [{ id: 'p1' }, { id: 'p2' }],
          rows: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }],
        }),
      },
    });
    expect(first.text).toBe('');
    expect(first.summary).toContain('Films à voir');
    expect(first.summary).toContain('3');
  });

  it('deux bases différentes ne se résument pas pareil', () => {
    const one = blocksOf({
      type: 'inlineDatabase',
      attrs: { data: JSON.stringify({ title: 'A', properties: [], rows: [{ id: 'r1' }] }) },
    })[0];
    const two = blocksOf({
      type: 'inlineDatabase',
      attrs: { data: JSON.stringify({ title: 'B', properties: [], rows: [] }) },
    })[0];
    expect(one.summary).not.toBe(two.summary);
  });

  it('une image se nomme par son texte alternatif, jamais par sa donnée embarquée', () => {
    const [named] = blocksOf({
      type: 'image',
      attrs: { alt: 'plan du local', src: 'data:image/png;base64,AAAA' },
    });
    expect(named.summary).toBe('plan du local');
    const [nameless] = blocksOf({
      type: 'image',
      attrs: { src: 'data:image/png;base64,AAAA' },
    });
    expect(nameless.summary).toBe('');
  });

  it('une charge illisible ne fait pas tomber la lecture', () => {
    const [first] = blocksOf({ type: 'inlineDatabase', attrs: { data: '{ pas du JSON' } });
    expect(first.summary).toBe('');
  });

  it('un bloc de texte n’a pas besoin de résumé', () => {
    const [first] = blocksOf(para('bonjour'));
    expect(first.text).toBe('bonjour');
    expect(first.summary).toBe('');
  });
});
