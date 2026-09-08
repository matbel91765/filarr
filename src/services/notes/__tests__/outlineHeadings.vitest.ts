/**
 * Le sommaire et l'autocomplétion `![[Note#` doivent voir LES MÊMES titres.
 *
 * LE DÉFAUT D'ORIGINE. `OutlinePanel` extrayait les titres lui-même, en ne
 * parcourant que le premier niveau de `doc.content`, tandis que
 * `extractHeadings` descend récursivement. Un titre posé dans un encadré
 * (callout), une colonne ou un dépliant était donc proposé comme cible de
 * transclusion — et absent du sommaire de la même note. Deux vérités
 * contradictoires dans le même produit, sans qu'aucune des deux ne se signale
 * comme fausse.
 *
 * Le panneau consomme maintenant cette fonction : les cas ci-dessous couvrent
 * ce que le panneau lui demande EN PLUS de ce que l'autocomplétion utilisait
 * (le rang dans le document, qui sert d'ancre de défilement).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractHeadings, extractHeadingsFromJson } from '../transclusionHelpers';
import { toOutlineItems } from '../../../renderer/components/notes/outlineNavigation';

/** Fabrique un titre ProseMirror. */
function heading(level: number, text: string) {
  return { type: 'heading', attrs: { level }, content: text ? [{ type: 'text', text }] : [] };
}

function paragraph(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

describe('extraction récursive des titres', () => {
  it('voit un titre enfermé dans un encadré (callout)', () => {
    const doc = {
      type: 'doc',
      content: [
        heading(1, 'Racine'),
        {
          type: 'callout',
          attrs: { variant: 'warning' },
          content: [paragraph('Attention'), heading(3, 'Titre dans un encadré')],
        },
      ],
    };
    const titles = extractHeadings(doc).map((h) => h.text);
    expect(titles).toEqual(['Racine', 'Titre dans un encadré']);
  });

  it('voit un titre dans une colonne, à deux niveaux d’imbrication', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'columnBlock',
          content: [
            { type: 'column', content: [heading(2, 'Colonne gauche')] },
            { type: 'column', content: [paragraph('rien'), heading(2, 'Colonne droite')] },
          ],
        },
      ],
    };
    const found = extractHeadings(doc);
    expect(found.map((h) => h.text)).toEqual(['Colonne gauche', 'Colonne droite']);
    expect(found.map((h) => h.level)).toEqual([2, 2]);
  });

  it('rend les titres dans l’ORDRE DU DOCUMENT, imbriqués compris', () => {
    // C'est l'ordre du DOM (`querySelectorAll('h1..h6')`) : le sommaire s'en
    // sert comme ancre de défilement, donc un ordre autre casserait le clic.
    const doc = {
      type: 'doc',
      content: [
        heading(1, 'Un'),
        { type: 'callout', content: [heading(2, 'Deux')] },
        heading(1, 'Trois'),
      ],
    };
    const found = extractHeadings(doc);
    expect(found.map((h) => h.text)).toEqual(['Un', 'Deux', 'Trois']);
    expect(found.map((h) => h.index)).toEqual([0, 1, 2]);
  });

  it('COMPTE les titres vides dans le rang : le DOM les rend aussi', () => {
    // Les sauter décalerait d'un cran toutes les ancres suivantes, et le clic
    // sur « Après » amènerait sur le titre d'avant.
    const doc = {
      type: 'doc',
      content: [heading(2, ''), heading(2, 'Après')],
    };
    const found = extractHeadings(doc);
    expect(found).toHaveLength(2);
    expect(found[1].text).toBe('Après');
    expect(found[1].index).toBe(1);
  });

  it('donne un slug stable, identique à celui visé par `![[Note#`', () => {
    const doc = { type: 'doc', content: [{ type: 'callout', content: [heading(2, 'Été 2026')] }] };
    expect(extractHeadings(doc)[0].slug).toBe('ete-2026');
  });

  it('lit aussi la forme persistée, et ne tombe pas sur un JSON illisible', () => {
    const json = JSON.stringify({
      type: 'doc',
      content: [{ type: 'callout', content: [heading(4, 'Caché')] }],
    });
    expect(extractHeadingsFromJson(json).map((h) => h.text)).toEqual(['Caché']);
    expect(extractHeadingsFromJson('{ pas du json')).toEqual([]);
    expect(extractHeadingsFromJson('')).toEqual([]);
  });

  it('rassemble le texte d’un titre morcelé par des marques', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [
            { type: 'text', text: 'Bilan ' },
            { type: 'text', marks: [{ type: 'bold' }], text: 'annuel' },
          ],
        },
      ],
    };
    expect(extractHeadings(doc)[0].text).toBe('Bilan annuel');
  });
});

// ==================== Titres affichables et ancres ====================

/**
 * `toOutlineItems` est le code le plus délicat de tout le sommaire : il doit
 * RETIRER les titres vides de l'affichage sans jamais toucher au rang, sous
 * peine de faire atterrir chaque clic un titre trop haut. Il vit dans un
 * module à part (`outlineNavigation.ts`) précisément pour être éprouvable
 * ici — sa moitié DOM (`findHeadingElement`) ne l'est pas dans un
 * environnement `node`, et reste à couvrir par une suite Jest.
 */
describe('titres affichables (toOutlineItems)', () => {
  it('retire un titre vide de la liste SANS décaler les rangs suivants', () => {
    const entries = extractHeadings({
      type: 'doc',
      content: [heading(2, 'Contexte'), heading(2, ''), heading(2, 'Décision')],
    });
    const items = toOutlineItems(entries);

    expect(items.map((i) => i.text)).toEqual(['Contexte', 'Décision']);
    // « Décision » est le TROISIÈME titre du document : son ancre doit rester
    // 2, pas 1. C'est exactement le décalage qui faisait sauter le bloc /toc
    // sur le titre vide.
    expect(items.map((i) => i.index)).toEqual([0, 2]);
  });

  it('numérote les homonymes de même niveau par occurrence croissante', () => {
    const entries = extractHeadings({
      type: 'doc',
      content: [heading(3, 'Notes'), heading(2, 'Notes'), heading(3, 'Notes')],
    });
    const items = toOutlineItems(entries);

    // L'occurrence est comptée par couple (niveau, texte) : le H2 « Notes »
    // n'est pas le deuxième H3 « Notes ».
    expect(items.map((i) => [i.level, i.occurrence])).toEqual([
      [3, 0],
      [2, 0],
      [3, 1],
    ]);
  });

  it('rogne les blancs du libellé mais garde un identifiant stable', () => {
    const items = toOutlineItems(
      extractHeadings({ type: 'doc', content: [heading(1, '  Racine  ')] })
    );
    expect(items[0].text).toBe('Racine');
    expect(items[0].id).toBe('heading-0');
  });
});

// ==================== Garde-fou de source ====================

/**
 * POURQUOI CE TEST EXISTE. Le dépôt a porté CINQ extracteurs de titres
 * indépendants ; chacun avait ses propres bugs (non récursif, rang compté sur
 * les seuls titres non vides, rang comptant tous les nœuds). Les replier sur
 * `extractHeadings` ne suffit pas : rien n'empêcherait quelqu'un de
 * « remettre une petite boucle locale » et de faire revenir la divergence sans
 * qu'aucune suite ne tombe. Ce test l'interdit.
 */
describe('aucune surface ne réécrit son propre extracteur de titres', () => {
  const SURFACES = [
    'renderer/components/notes/OutlinePanel.tsx',
    'renderer/components/notes/MindMapView.tsx',
    'renderer/components/notes/QuickSwitcherPlus.tsx',
    'renderer/components/notes/extensions/TocNodeView.tsx',
  ];

  for (const rel of SURFACES) {
    it(`${rel} passe par l’extracteur partagé`, () => {
      const raw = readFileSync(resolve(__dirname, '../../..', rel), 'utf8');
      // On scanne le CODE, pas les commentaires : les en-têtes de ces fichiers
      // citent justement les motifs qu'on interdit, pour expliquer pourquoi.
      const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

      // 1. Elle consomme bien le module partagé.
      expect(src).toMatch(/from '[^']*transclusionHelpers'/);

      // 2. Et elle ne refait pas le parcours elle-même. On traque les deux
      //    signatures d'une extraction maison : tester le type d'un nœud
      //    contre 'heading', ou interroger le DOM des titres. `result.type`
      //    est écarté : c'est le genre d'un résultat de recherche du
      //    sélecteur rapide, pas un nœud ProseMirror.
      const offenders = [
        ...src.matchAll(/(?<!result)\.type(?:\.name)?\s*===\s*'heading'/g),
        ...src.matchAll(/querySelectorAll\('h1/g),
      ].map((m) => m[0]);
      expect({ rel, offenders }).toEqual({ rel, offenders: [] });
    });
  }
});
