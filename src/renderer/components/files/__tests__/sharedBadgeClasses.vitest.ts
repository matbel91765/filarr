/**
 * SharedBadge — le piège Tailwind de l'opacité sur une variable CSS.
 *
 * `bg-[var(--x)]/90` n'est PAS une classe : Tailwind ne sait pas décomposer une
 * variable CSS en canaux pour y appliquer l'opacité, il rejette la classe
 * entière sans un mot, et la pastille se rend SANS FOND — invisible sur une
 * vignette claire. C'est arrivé une fois (la pastille « Partagé » n'apparaissait
 * pas). Ce test relit les classes, exportées pour ça, et tombe si le motif
 * revient sous quelque forme que ce soit ; il relit aussi la source des deux
 * fichiers corrigés, parce que le même piège vivait dans FolderGridWidget.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  SHARED_BADGE_CORNER_CLASSES,
  SHARED_BADGE_CORNER_STYLE,
  SHARED_BADGE_INLINE_CLASSES,
} from '../SharedBadge';

/**
 * Une valeur arbitraire `[…var(--…)…]` suivie d'un modificateur `/nombre`.
 * `bg-green-500/90` (couleur du thème Tailwind) ne matche pas : là, l'opacité
 * est légitime, Tailwind connaît les canaux.
 */
const OPACITY_ON_CSS_VAR = /\[[^\]]*var\(--[^\]]*\]\/\d/;

const tokens = (classes: readonly string[]): string[] =>
  classes.flatMap((chunk) => chunk.split(/\s+/)).filter(Boolean);

describe('SharedBadge — classes', () => {
  it('le motif attrape bien ce qu il doit, et rien d autre', () => {
    expect('bg-[var(--color-primary-500)]/90').toMatch(OPACITY_ON_CSS_VAR);
    expect('bg-[var(--color-text-secondary)]/50').toMatch(OPACITY_ON_CSS_VAR);
    expect('bg-[var(--color-primary-500)]').not.toMatch(OPACITY_ON_CSS_VAR);
    expect('bg-green-500/90').not.toMatch(OPACITY_ON_CSS_VAR);
    expect('min-w-[1.5rem]').not.toMatch(OPACITY_ON_CSS_VAR);
  });

  it('corner : aucune opacité Tailwind sur une variable CSS', () => {
    for (const token of tokens(SHARED_BADGE_CORNER_CLASSES)) {
      expect(token).not.toMatch(OPACITY_ON_CSS_VAR);
    }
  });

  it('inline : aucune opacité Tailwind sur une variable CSS', () => {
    for (const token of tokens(SHARED_BADGE_INLINE_CLASSES)) {
      expect(token).not.toMatch(OPACITY_ON_CSS_VAR);
    }
  });

  it('corner : un fond opaque de la teinte primaire, un liseré de la surface', () => {
    expect(tokens(SHARED_BADGE_CORNER_CLASSES)).toContain('bg-[var(--color-primary-500)]');
    expect(tokens(SHARED_BADGE_CORNER_CLASSES)).toContain('text-white');
    // Le liseré (patron SyncBadge) vit en style : un `box-shadow` en ligne
    // écraserait `shadow-sm`, alors l'ombre douce est recopiée à côté.
    expect(SHARED_BADGE_CORNER_STYLE.boxShadow).toContain('0 0 0 1.5px var(--color-surface)');
    expect(tokens(SHARED_BADGE_CORNER_CLASSES)).not.toContain('shadow-sm');
  });
});

describe('sources — le piège ne revient pas dans les fichiers corrigés', () => {
  const FILES = [
    '../SharedBadge.tsx',
    '../../home/widgets/FolderGridWidget.tsx',
    // La pastille « verrouillé » du coin d'une carte de coffre a rejoué le
    // piège : `bg-[var(--color-text-secondary)]/90` rendait un cadenas blanc
    // sans fond, invisible sur une vignette pâle.
    '../../vaults/VaultCards.tsx',
  ];

  for (const rel of FILES) {
    it(rel, () => {
      const lines = readFileSync(join(__dirname, rel), 'utf8').split('\n');
      const hits = lines
        .map((line, index) => ({ line: index + 1, text: line.trim() }))
        .filter(({ text }) => OPACITY_ON_CSS_VAR.test(text));
      expect(hits).toEqual([]);
    });
  }
});
