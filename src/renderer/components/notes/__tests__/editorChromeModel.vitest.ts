/**
 * Le seul filet automatisé des quatre chantiers d'UX de l'éditeur : il n'existe
 * ni instantané ni test testing-library sur les notes. Chaque règle ci-dessous
 * a été vue ÉCHOUER avant d'être gardée — un garde-fou qu'on n'a pas cassé une
 * fois ne garde rien.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveChrome,
  decideHeaderStage,
  initialScrollCollapse,
  COVER_AT,
  COVER_BACK,
  COLLAPSE_AT,
  EXPAND_AT,
  SETTLE_MS,
  type ChromeInputs,
  type ScrollMeasurement,
} from '../editorChromeModel';

const chrome = (over: Partial<ChromeInputs> = {}): ChromeInputs => ({
  focusMode: false,
  hoverPref: false,
  listPinned: true,
  rightPinned: true,
  listPeek: false,
  rightPeek: false,
  headerManual: null,
  scrollStage: 'full',
  toolbarPref: false,
  toolbarFocusOverride: null,
  noteOpen: true,
  ...over,
});

/** Note longue, avec couverture, rien qui bloque, verrou temporel écoulé. */
const measure = (over: Partial<ScrollMeasurement> = {}): ScrollMeasurement => ({
  scrollTop: 0,
  clientHeight: 800,
  scrollHeight: 4000,
  coverHeight: 130,
  collapsibleHeight: 250,
  now: 10_000,
  locked: false,
  hasCover: true,
  ...over,
});

describe('resolveChrome — priorité manuel > focus > défilement', () => {
  it('le choix manuel bat le défilement', () => {
    expect(
      resolveChrome(chrome({ headerManual: false, scrollStage: 'compact' })).headerCollapsed
    ).toBe(false);
    expect(resolveChrome(chrome({ headerManual: true, scrollStage: 'full' })).headerCollapsed).toBe(
      true
    );
  });

  it('le choix manuel bat le mode focus', () => {
    expect(resolveChrome(chrome({ headerManual: false, focusMode: true })).headerCollapsed).toBe(
      false
    );
  });

  it('le mode focus bat le défilement', () => {
    expect(resolveChrome(chrome({ focusMode: true, scrollStage: 'full' })).headerCollapsed).toBe(
      true
    );
  });

  it('sans rien de manuel, le défilement décide', () => {
    expect(resolveChrome(chrome({ scrollStage: 'compact' })).headerCollapsed).toBe(true);
    expect(resolveChrome(chrome({ scrollStage: 'full' })).headerCollapsed).toBe(false);
  });
});

describe('resolveChrome — panneaux latéraux', () => {
  it('en mode focus les panneaux partent, même épinglés et même réclamés', () => {
    const s = resolveChrome(
      chrome({
        focusMode: true,
        hoverPref: true,
        listPinned: true,
        listPeek: true,
        rightPeek: true,
      })
    );
    expect(s.listVisible).toBe(false);
    expect(s.rightVisible).toBe(false);
  });

  it('hors mode survol, le survol n’a aucun effet — seul l’épinglage compte', () => {
    const s = resolveChrome(chrome({ hoverPref: false, listPinned: false, listPeek: true }));
    expect(s.listVisible).toBe(false);
  });

  it('en mode survol, épinglé OU réclamé suffit', () => {
    expect(
      resolveChrome(chrome({ hoverPref: true, listPinned: false, listPeek: true })).listVisible
    ).toBe(true);
    expect(
      resolveChrome(chrome({ hoverPref: true, listPinned: true, listPeek: false })).listVisible
    ).toBe(true);
    expect(
      resolveChrome(chrome({ hoverPref: true, listPinned: false, listPeek: false })).listVisible
    ).toBe(false);
  });

  it('sans note ouverte, les deux panneaux restent — c’est le seul chemin vers une note', () => {
    const s = resolveChrome(
      chrome({ noteOpen: false, hoverPref: true, listPinned: false, rightPinned: false })
    );
    expect(s.listVisible).toBe(true);
    expect(s.rightVisible).toBe(true);
  });

  it('sans note ouverte, le mode focus ne masque rien non plus', () => {
    const s = resolveChrome(chrome({ noteOpen: false, focusMode: true }));
    expect(s.listVisible).toBe(true);
    expect(s.rightVisible).toBe(true);
  });

  it('les deux panneaux sont indépendants', () => {
    const s = resolveChrome(chrome({ hoverPref: true, listPinned: true, rightPinned: false }));
    expect(s.listVisible).toBe(true);
    expect(s.rightVisible).toBe(false);
  });
});

describe('resolveChrome — barre d’outils', () => {
  it('hors focus, la préférence persistée décide', () => {
    expect(resolveChrome(chrome({ toolbarPref: true })).toolbarCollapsed).toBe(true);
    expect(resolveChrome(chrome({ toolbarPref: false })).toolbarCollapsed).toBe(false);
  });

  it('le focus replie la barre par défaut sans toucher à la préférence', () => {
    expect(resolveChrome(chrome({ focusMode: true, toolbarPref: false })).toolbarCollapsed).toBe(
      true
    );
  });

  it('pendant le focus, l’ajustement ponctuel gagne', () => {
    expect(
      resolveChrome(chrome({ focusMode: true, toolbarPref: false, toolbarFocusOverride: false }))
        .toolbarCollapsed
    ).toBe(false);
  });

  it('l’ajustement de focus n’a aucun effet une fois le focus quitté', () => {
    expect(
      resolveChrome(chrome({ focusMode: false, toolbarPref: false, toolbarFocusOverride: false }))
        .toolbarCollapsed
    ).toBe(false);
    expect(
      resolveChrome(chrome({ focusMode: false, toolbarPref: true, toolbarFocusOverride: false }))
        .toolbarCollapsed
    ).toBe(true);
  });
});

const at2 = (
  stage: 'full' | 'title' | 'compact',
  scrollTop: number,
  over: Partial<ScrollMeasurement> = {}
) => decideHeaderStage({ stage, changedAt: 0 }, measure({ scrollTop, ...over }));

describe('decideHeaderStage — un palier a la fois', () => {
  it('la couverture part avant le titre', () => {
    expect(at2('full', COVER_AT - 1).next.stage).toBe('full');
    expect(at2('full', COVER_AT).next.stage).toBe('title');
  });

  it('ne saute JAMAIS un palier, meme lance a fond', () => {
    // Sauter full → compact escamoterait le palier intermediaire precisement
    // quand il sert, et rendrait le retour saccade.
    expect(at2('full', 5000).next.stage).toBe('title');
    expect(at2('compact', 0).next.stage).toBe('title');
  });

  it('le titre part au second seuil', () => {
    expect(at2('title', COLLAPSE_AT - 1).next.stage).toBe('title');
    expect(at2('title', COLLAPSE_AT).next.stage).toBe('compact');
  });

  it('remonter redonne les paliers dans l’ordre inverse', () => {
    expect(at2('compact', EXPAND_AT).next.stage).toBe('title');
    expect(at2('title', COVER_BACK).next.stage).toBe('full');
  });

  it('chaque palier a sa zone morte', () => {
    expect(at2('title', COVER_BACK + 1).next.stage).toBe('title');
    expect(at2('compact', EXPAND_AT + 1).next.stage).toBe('compact');
  });
});

describe('decideHeaderStage — rearmement du choix manuel', () => {
  it('un repli manuel pose en haut du document SURVIT a un evenement en haut', () => {
    expect(at2('full', 0).rearm).toBe(false);
  });

  it('ne rearme qu’en revenant vraiment a l’en-tete entier', () => {
    expect(at2('title', COLLAPSE_AT).rearm).toBe(false);
    expect(at2('compact', EXPAND_AT).rearm).toBe(false);
    expect(at2('title', COVER_BACK).rearm).toBe(true);
  });

  it('aucun evenement ne rearme tant qu’on n’a pas quitte l’en-tete entier', () => {
    for (const scrollTop of [0, COVER_BACK, COVER_AT, COLLAPSE_AT, 5000]) {
      expect(at2('full', scrollTop).rearm).toBe(false);
    }
  });
});

describe('decideHeaderStage — refus de replier', () => {
  it('refuse la couverture si la course restante ne permettrait pas de revenir', () => {
    const r = at2('full', 400, { scrollHeight: 900, clientHeight: 800, coverHeight: 130 });
    expect(r.next.stage).toBe('full');
  });

  it('refuse le second palier meme quand le premier etait finançable', () => {
    const r = at2('title', 400, { scrollHeight: 1100, clientHeight: 800, collapsibleHeight: 250 });
    expect(r.next.stage).toBe('title');
  });

  it('accepte des que la course depasse ce que le palier libere', () => {
    expect(at2('full', 400, { scrollHeight: 2000, clientHeight: 800 }).next.stage).toBe('title');
  });

  it('refuse quand un geste est en cours (selecteur, saut vers un titre, dessin)', () => {
    expect(at2('full', 400, { locked: true }).next.stage).toBe('full');
  });

  it('refuse sur une note SANS couverture : il n’y a rien a faire disparaitre', () => {
    expect(at2('full', 400, { hasCover: false }).next.stage).toBe('full');
  });

  it('respecte le verrou temporel qui suit une bascule', () => {
    const justChanged = { stage: 'title' as const, changedAt: 10_000 };
    expect(
      decideHeaderStage(justChanged, measure({ scrollTop: 0, now: 10_000 + SETTLE_MS - 1 })).next
        .stage
    ).toBe('title');
    expect(
      decideHeaderStage(justChanged, measure({ scrollTop: 0, now: 10_000 + SETTLE_MS })).next.stage
    ).toBe('full');
  });
});
