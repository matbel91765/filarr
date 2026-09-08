/**
 * Re-visée du défilement vers un titre (carte mentale → éditeur).
 *
 * Ce qui est verrouillé ici, c'est l'orchestration : QUAND on re-vise (un
 * décalage de mise en page dans la fenêtre), QUAND on lâche prise (fenêtre
 * écoulée, intention de l'utilisateur, cible disparue, démontage) et le fait
 * que l'arrêt n'est signalé qu'UNE fois — c'est lui qui efface le drapeau
 * Redux et débranche les capteurs. Le DOM n'entre pas ici : les ports sont
 * bouchonnés.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createHeadingScrollStabilizer,
  computeScrollTopForTarget,
  findHeadingPosByRank,
  HEADING_SCROLL_STABILIZE_WINDOW_MS,
  type HeadingDocLike,
  type StabilizerStopReason,
} from '../scrollToHeadingStabilizer';

// ==================== Bouchons ====================

function harness(opts: { aim?: () => boolean; windowMs?: number } = {}) {
  let clock = 1_000;
  const aim = vi.fn(opts.aim ?? (() => true));
  const stops: StabilizerStopReason[] = [];
  const stab = createHeadingScrollStabilizer(
    { aim, now: () => clock, onStop: (r) => stops.push(r) },
    { windowMs: opts.windowMs }
  );
  return {
    stab,
    aim,
    stops,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

/** Document jouet : arbre de nœuds, `descendants` en profondeur avec positions. */
interface ToyNode {
  type: { name: string };
  content?: ToyNode[];
}
function toyDoc(nodes: ToyNode[]): HeadingDocLike {
  return {
    descendants(cb) {
      let pos = 0;
      const walk = (list: ToyNode[]): boolean => {
        for (const n of list) {
          const here = pos;
          pos += 1;
          const goOn = cb(n, here);
          if (goOn === false) return false;
          if (n.content && !walk(n.content)) return false;
          pos += 1; // frontière de fermeture
        }
        return true;
      };
      walk(nodes);
    },
  };
}
const h = (content?: ToyNode[]): ToyNode => ({ type: { name: 'heading' }, content });
const p = (): ToyNode => ({ type: { name: 'paragraph' } });
const callout = (content: ToyNode[]): ToyNode => ({ type: { name: 'callout' }, content });

// ==================== Résolution par rang ====================

describe('findHeadingPosByRank', () => {
  it('compte les titres IMBRIQUÉS dans un encadré au même rang que le sommaire', () => {
    // H(0) ; encadré[ p, H(1) ] ; H(2)
    const doc = toyDoc([h(), callout([p(), h()]), h()]);
    // Positions : H0@0, callout@2, p@3, H1@5, H2@8 → intérieur = pos + 1
    expect(findHeadingPosByRank(doc, 0)).toBe(1);
    expect(findHeadingPosByRank(doc, 1)).toBe(6);
    expect(findHeadingPosByRank(doc, 2)).toBe(9);
  });

  it('rend null hors bornes, sans lever', () => {
    const doc = toyDoc([h(), p()]);
    expect(findHeadingPosByRank(doc, 1)).toBeNull();
    expect(findHeadingPosByRank(doc, -1)).toBeNull();
    expect(findHeadingPosByRank(doc, 1.5)).toBeNull();
  });

  it('un document sans titre ne résout rien', () => {
    expect(findHeadingPosByRank(toyDoc([p(), p()]), 0)).toBeNull();
  });
});

// ==================== Géométrie ====================

describe('computeScrollTopForTarget', () => {
  it('amène le titre à `margin` pixels sous le haut du conteneur', () => {
    expect(
      computeScrollTopForTarget({
        containerTop: 100,
        containerScrollTop: 50,
        containerScrollHeight: 5000,
        containerClientHeight: 600,
        targetTop: 900,
        margin: 16,
      })
    ).toBe(50 + 800 - 16);
  });

  it('borne au défilement maximal du conteneur, et jamais sous zéro', () => {
    const base = {
      containerTop: 0,
      containerScrollTop: 0,
      containerScrollHeight: 1000,
      containerClientHeight: 600,
      margin: 0,
    };
    expect(computeScrollTopForTarget({ ...base, targetTop: 950 })).toBe(400);
    expect(computeScrollTopForTarget({ ...base, targetTop: -300 })).toBe(0);
  });
});

// ==================== Stabilisateur ====================

describe('createHeadingScrollStabilizer', () => {
  it('re-vise à chaque décalage tant que la fenêtre court', () => {
    const t = harness();
    expect(t.stab.onLayoutShift()).toBe('aimed');
    t.advance(100);
    expect(t.stab.onLayoutShift()).toBe('aimed');
    t.advance(300);
    expect(t.stab.onLayoutShift()).toBe('aimed');
    expect(t.aim).toHaveBeenCalledTimes(3);
    expect(t.stab.active).toBe(true);
    expect(t.stops).toEqual([]);
  });

  it('la fenêtre par défaut est courte (une demi-seconde environ)', () => {
    expect(HEADING_SCROLL_STABILIZE_WINDOW_MS).toBeLessThanOrEqual(600);
    expect(HEADING_SCROLL_STABILIZE_WINDOW_MS).toBeGreaterThanOrEqual(400);
    const t = harness();
    expect(t.stab.deadlineAt).toBe(1_000 + HEADING_SCROLL_STABILIZE_WINDOW_MS);
  });

  it("l'horloge fait foi : un décalage après l'échéance n'est PAS re-visé, même sans minuterie", () => {
    const t = harness({ windowMs: 500 });
    t.advance(501);
    expect(t.stab.onLayoutShift()).toBe('stopped');
    expect(t.aim).not.toHaveBeenCalled();
    expect(t.stab.stopReason).toBe('deadline');
    expect(t.stops).toEqual(['deadline']);
  });

  it("un décalage PILE à l'échéance est encore re-visé (borne incluse)", () => {
    const t = harness({ windowMs: 500 });
    t.advance(500);
    expect(t.stab.onLayoutShift()).toBe('aimed');
  });

  it("l'intention de l'utilisateur abandonne définitivement : plus aucune re-visée", () => {
    const t = harness();
    expect(t.stab.onLayoutShift()).toBe('aimed');
    t.stab.onUserIntent();
    expect(t.stab.active).toBe(false);
    expect(t.stab.stopReason).toBe('user');
    t.advance(50);
    expect(t.stab.onLayoutShift()).toBe('stopped');
    expect(t.aim).toHaveBeenCalledTimes(1);
  });

  it('une cible disparue arrête le stabilisateur (on ne re-vise pas le vide)', () => {
    let alive = true;
    const t = harness({ aim: () => alive });
    expect(t.stab.onLayoutShift()).toBe('aimed');
    alive = false;
    expect(t.stab.onLayoutShift()).toBe('stopped');
    expect(t.stab.stopReason).toBe('unresolvable');
    expect(t.stab.onLayoutShift()).toBe('stopped');
    expect(t.aim).toHaveBeenCalledTimes(2);
  });

  it('une visée qui lève vaut cible perdue, sans propager', () => {
    const t = harness({
      aim: () => {
        throw new Error('view destroyed');
      },
    });
    expect(() => t.stab.onLayoutShift()).not.toThrow();
    expect(t.stab.stopReason).toBe('unresolvable');
  });

  it("l'arrêt n'est signalé qu'UNE fois, quelle que soit la suite des causes", () => {
    const t = harness();
    t.stab.onDeadline();
    t.stab.onUserIntent();
    t.stab.dispose();
    t.stab.onDeadline();
    expect(t.stops).toEqual(['deadline']);
    expect(t.stab.stopReason).toBe('deadline');
  });

  it('le démontage externe arrête proprement, avec sa propre cause', () => {
    const t = harness();
    t.stab.dispose();
    expect(t.stops).toEqual(['disposed']);
    expect(t.stab.onLayoutShift()).toBe('stopped');
  });

  it("`onStop` est facultatif : sans lui, l'arrêt reste observable par `active`", () => {
    const stab = createHeadingScrollStabilizer({ aim: () => true, now: () => 0 });
    expect(stab.active).toBe(true);
    stab.onUserIntent();
    expect(stab.active).toBe(false);
  });
});
