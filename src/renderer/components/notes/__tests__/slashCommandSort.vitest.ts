/**
 * Le tri du menu « / ».
 *
 * Ce qui est verrouillé ici, c'est ce qui casse en silence : un classement où
 * « Entrée » ne tombe PAS sur la meilleure correspondance, et une section
 * « Récents » qui remonterait une commande faiblement pertinente au-dessus
 * d'une correspondance exacte. Les libellés sont injectés (pas d'i18n réelle) :
 * le tri ne doit dépendre que de ce qu'on lui donne.
 */

import { describe, it, expect } from 'vitest';
import {
  SLASH_GROUP_ORDER,
  buildSlashSections,
  mergeRecent,
  scoreSlashItem,
  sortSlashItems,
  type SlashGroup,
  type SortableSlashItem,
} from '../slashCommandSort';

interface TestItem extends SortableSlashItem {
  label: string;
  description: string;
}

const item = (
  id: string,
  group: SlashGroup,
  label: string,
  aliases: string[] = [],
  description = ''
): TestItem => ({ id, group, label, description, aliases });

const CATALOG: TestItem[] = [
  item('text', 'basic', 'Text', ['paragraph', 'p']),
  item('h1', 'basic', 'Heading 1', ['h1', 'title', 'heading']),
  item('table', 'layout', 'Table', ['table', 'grid']),
  item('toc', 'layout', 'Table of Contents', ['toc', 'outline'], 'Auto-generated outline'),
  item('callout-info', 'callout', 'Callout', ['callout', 'info']),
  item('image', 'media', 'Image', ['image', 'img'], 'Embed an image from your files'),
  item('sub-page', 'pages', 'Page', ['page', 'subpage']),
  item('mermaid', 'advanced', 'Mermaid Diagram', ['mermaid', 'diagram']),
];

const ctx = (recents: string[] = []) => ({
  resolve: (i: TestItem) => ({ label: i.label, description: i.description }),
  recents,
});

describe('sortSlashItems — catalogue (sans requête)', () => {
  it('range les commandes par section, dans l ordre canonique', () => {
    const sorted = sortSlashItems([...CATALOG].reverse(), '', ctx());
    const groups = sorted.map((i) => i.group);
    const firstSeen = [...new Set(groups)];
    expect(firstSeen).toEqual(SLASH_GROUP_ORDER.filter((g) => CATALOG.some((i) => i.group === g)));
    // Une section n'est jamais entrecoupée d'une autre.
    expect(groups).toEqual(
      [...groups].sort((a, b) => SLASH_GROUP_ORDER.indexOf(a) - SLASH_GROUP_ORDER.indexOf(b))
    );
  });

  it('ne perd ni ne duplique aucune commande', () => {
    const sorted = sortSlashItems(CATALOG, '', ctx(['image']));
    expect(sorted.map((i) => i.id).sort()).toEqual(CATALOG.map((i) => i.id).sort());
  });
});

describe('sortSlashItems — recherche', () => {
  it('met la correspondance exacte en tête', () => {
    const sorted = sortSlashItems(CATALOG, 'table', ctx());
    expect(sorted[0].id).toBe('table');
    // « Table of Contents » matche aussi, mais moins bien.
    expect(sorted[1].id).toBe('toc');
  });

  it('classe un début de libellé au-dessus d une simple description', () => {
    const sorted = sortSlashItems(CATALOG, 'ima', ctx());
    expect(sorted[0].id).toBe('image');
  });

  it('ignore la casse et les espaces autour', () => {
    expect(sortSlashItems(CATALOG, '  TABLE ', ctx())[0].id).toBe('table');
  });

  it('la récence départage sans jamais renverser un palier', () => {
    // « toc » est récent mais ne matche « table » que par sa description :
    // le bonus (max 5) ne doit pas le faire passer devant la correspondance
    // exacte (100).
    const sorted = sortSlashItems(CATALOG, 'table', ctx(['toc']));
    expect(sorted[0].id).toBe('table');
  });

  it('à pertinence égale, la plus récemment utilisée passe devant', () => {
    const pair: TestItem[] = [
      item('alpha', 'basic', 'Alpha block'),
      item('beta', 'basic', 'Alpha block'),
    ];
    expect(sortSlashItems(pair, 'alpha', ctx())[0].id).toBe('alpha');
    expect(sortSlashItems(pair, 'alpha', ctx(['beta']))[0].id).toBe('beta');
  });
});

describe('scoreSlashItem', () => {
  it('hiérarchise exact > début > contient > description', () => {
    const target = item('x', 'basic', 'Callout', ['callout', 'info'], 'Info callout box');
    const exact = scoreSlashItem(target, 'callout', { label: 'Callout', description: 'Info box' });
    const prefix = scoreSlashItem(target, 'call', { label: 'Callout', description: 'Info box' });
    const inside = scoreSlashItem(target, 'lout', { label: 'Callout', description: 'Info box' });
    const desc = scoreSlashItem({ id: 'y', group: 'basic' }, 'box', {
      label: 'Callout',
      description: 'Info box',
    });
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(desc);
    expect(desc).toBeGreaterThan(0);
  });
});

describe('buildSlashSections', () => {
  it('sans requête : les récents d abord, puis les sections', () => {
    const sorted = sortSlashItems(CATALOG, '', ctx(['mermaid', 'image']));
    const sections = buildSlashSections(sorted, '', ['mermaid', 'image']);
    expect(sections[0].key).toBe('recent');
    expect(sections[0].items.map((i) => i.id)).toEqual(['mermaid', 'image']);
    expect(sections[1].key).toBe('basic');
  });

  it('plafonne les récents et ignore une commande absente du menu', () => {
    const sorted = sortSlashItems(CATALOG, '', ctx());
    const sections = buildSlashSections(sorted, '', ['vault-embed', 'image', 'table', 'text'], 2);
    expect(sections[0].items.map((i) => i.id)).toEqual(['image', 'table']);
  });

  it('avec une requête : pas de section « récents » (elle ne ferait que dupliquer)', () => {
    const sorted = sortSlashItems(CATALOG, 'table', ctx(['image']));
    const sections = buildSlashSections(sorted, 'table', ['image']);
    expect(sections.map((s) => s.key)).not.toContain('recent');
    // Le rail ne montre que les catégories qui ont encore quelque chose.
    expect(sections.every((s) => s.items.length > 0)).toBe(true);
  });

  it('une catégorie garde l ordre de la liste triée qu on lui donne', () => {
    const sorted = sortSlashItems(CATALOG, 'table', ctx());
    const layout = buildSlashSections(sorted, 'table', []).find((s) => s.key === 'layout');
    // « Table » avant « Table of Contents » : le classement par pertinence
    // survit au découpage en catégories.
    expect(layout?.items.map((i) => i.id)).toEqual(['table', 'toc']);
  });

  it('couvre la liste sans rien perdre, catégorie par catégorie', () => {
    const sorted = sortSlashItems(CATALOG, '', ctx(['image']));
    const sections = buildSlashSections(sorted, '', ['image']);
    const fromGroups = sections
      .filter((s) => s.key !== 'recent')
      .flatMap((s) => s.items.map((i) => i.id));
    expect(fromGroups.sort()).toEqual(CATALOG.map((i) => i.id).sort());
  });

  it('rend une liste vide quand rien ne correspond', () => {
    expect(buildSlashSections([], 'zzz', [])).toEqual([]);
  });
});

describe('mergeRecent', () => {
  it('met en tête, dédoublonne et plafonne', () => {
    let recents = mergeRecent([], 'a', 3);
    recents = mergeRecent(recents, 'b', 3);
    recents = mergeRecent(recents, 'a', 3);
    expect(recents).toEqual(['a', 'b']);
    recents = mergeRecent(recents, 'c', 3);
    recents = mergeRecent(recents, 'd', 3);
    expect(recents).toEqual(['d', 'c', 'a']);
  });
});
