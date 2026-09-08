/**
 * overlayBounds — la zone libre, et le bornage qui n'abandonne pas le début.
 *
 * Ce calcul s'est trompé DEUX FOIS de suite, chaque fois réécrit à la main
 * dans le composant concerné : une fois vers le bas (les menus du rail, dont
 * les boutons sont épinglés en bas, s'ouvraient sous le bord de la fenêtre),
 * une fois vers la gauche (le panneau de synchro, ramené « dans l'écran » à
 * 8 px, se glissait sous le rail, qui se peint au-dessus de lui).
 *
 * Les deux cas réels sont donc ici, en toutes lettres. Chacun ÉCHOUE contre la
 * version d'avant, qui bornait sur la fenêtre : c'est ce qui fait d'eux des
 * gardes et non une paraphrase du code.
 */

import { describe, it, expect } from 'vitest';
import { computeBounds, clampToBounds, OVERLAY_MARGIN } from '../overlayBounds';

/** Le rail : 56 px collés à gauche, toute la hauteur (cf. Layout.css). */
const RAIL = {
  side: 'left' as const,
  rect: { left: 0, right: 56, top: 0, bottom: 900, width: 56, height: 900 },
};

const VIEWPORT = { width: 1600, height: 900 };

describe('computeBounds', () => {
  it('sans obstruction, rend la fenêtre moins la marge', () => {
    expect(computeBounds(VIEWPORT)).toEqual({
      left: OVERLAY_MARGIN,
      right: 1600 - OVERLAY_MARGIN,
      top: OVERLAY_MARGIN,
      bottom: 900 - OVERLAY_MARGIN,
    });
  });

  it('LE CAS RÉEL : le rail repousse le bord gauche au-delà de sa largeur', () => {
    const bounds = computeBounds(VIEWPORT, [RAIL]);
    // 56 (le rail) + 8 (la marge). La version d'avant rendait 8 : le panneau
    // commençait alors SOUS le rail, qui lui mangeait 48 px de titre.
    expect(bounds.left).toBe(64);
    // Le rail ne mord qu'un côté : les trois autres sont inchangés.
    expect(bounds.right).toBe(1592);
    expect(bounds.top).toBe(OVERLAY_MARGIN);
    expect(bounds.bottom).toBe(892);
  });

  it('ignore une surface repliée : montée ne veut pas dire obstruante', () => {
    const replie = {
      side: 'left' as const,
      rect: { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 },
    };
    expect(computeBounds(VIEWPORT, [replie]).left).toBe(OVERLAY_MARGIN);
  });

  it('cumule plusieurs obstructions, la plus mordante gagne', () => {
    const bandeBasse = {
      side: 'bottom' as const,
      rect: { left: 0, right: 1600, top: 860, bottom: 900, width: 1600, height: 40 },
    };
    const bounds = computeBounds(VIEWPORT, [RAIL, bandeBasse]);
    expect(bounds.left).toBe(64);
    expect(bounds.bottom).toBe(852);
  });
});

describe('clampToBounds', () => {
  it('LE CAS RÉEL : un panneau ancré à gauche du rail est repoussé à sa droite', () => {
    // Bouton de synchro dans le rail (x 8→48), panneau de 380 px aligné à
    // droite du bouton : 48 - 380 = -332, très à gauche de tout.
    expect(clampToBounds(-332, 64, 1592 - 380)).toBe(64);
  });

  it('LE CAS RÉEL : un menu ouvert vers le bas est remonté dans la fenêtre', () => {
    // Menu de 200 px sous un bouton à y=860 : 864 + 200 dépasse 892.
    expect(clampToBounds(864, 8, 892 - 200)).toBe(692);
  });

  it('laisse passer une valeur qui tient déjà', () => {
    expect(clampToBounds(300, 64, 1200)).toBe(300);
  });

  it('quand la zone est plus étroite que le panneau, garde le DÉBUT visible', () => {
    // max < min : un `Math.min(Math.max(min, v), max)` naïf rendrait 40, donc
    // MOINS que le minimum — le début du panneau passerait hors champ, et
    // c'est lui qui porte le titre et les premières lignes.
    expect(clampToBounds(500, 64, 40)).toBe(64);
  });
});
