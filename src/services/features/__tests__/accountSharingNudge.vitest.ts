/**
 * CONTRATS DU COUP DE COUDE VERS LES COFFRES PARTAGÉS.
 *
 * Un bandeau qui se trompe de cible est pire que pas de bandeau : quelqu'un qui
 * l'a trouvé injuste une fois ne le lit plus jamais. Ces contrats décrivent donc
 * surtout les cas où il doit se TAIRE.
 */

import { describe, expect, it } from 'vitest';

import { shouldShowSharingNudge, SHARING_NUDGE_THRESHOLD } from '../accountSharingNudge';

describe('quand le bandeau se tait', () => {
  /**
   * Bureau, portable, web, téléphone et une réinstallation font quatre à cinq
   * appareils chez UNE personne. Se déclencher en dessous transformerait un
   * conseil en accusation.
   */
  it('sous le seuil, jamais', () => {
    for (const n of [0, 1, 2, 3, 4]) {
      expect(shouldShowSharingNudge({ activeCount: n, dismissal: null })).toBe(false);
    }
  });

  it('un décompte absurde ne le déclenche pas', () => {
    expect(shouldShowSharingNudge({ activeCount: NaN, dismissal: null })).toBe(false);
    expect(shouldShowSharingNudge({ activeCount: -3, dismissal: null })).toBe(false);
  });

  it('écarté, il reste écarté tant que rien ne change', () => {
    const dismissal = { atCount: 6 };
    for (const n of [6, 7, 8, 9, 10]) {
      expect(shouldShowSharingNudge({ activeCount: n, dismissal })).toBe(false);
    }
  });

  it('écarté puis DIMINUÉ : il se tait aussi', () => {
    expect(shouldShowSharingNudge({ activeCount: 5, dismissal: { atCount: 9 } })).toBe(false);
  });
});

describe('quand il parle', () => {
  it('au seuil, la première fois', () => {
    expect(shouldShowSharingNudge({ activeCount: SHARING_NUDGE_THRESHOLD, dismissal: null })).toBe(
      true
    );
  });

  /**
   * Fermer le bandeau à six appareils veut dire « je sais, c'est voulu » — pas
   * « ne me parle plus jamais de rien ». À douze, la situation a changé et
   * mérite d'être redite une fois.
   */
  it('après un écartement, il revient quand la situation a franchi un palier', () => {
    const dismissal = { atCount: 6 };
    expect(shouldShowSharingNudge({ activeCount: 10, dismissal })).toBe(false);
    expect(shouldShowSharingNudge({ activeCount: 11, dismissal })).toBe(true);
  });

  it('le seuil est réglable, et gouverne aussi le palier de retour', () => {
    expect(shouldShowSharingNudge({ activeCount: 3, dismissal: null, threshold: 3 })).toBe(true);
    expect(
      shouldShowSharingNudge({ activeCount: 5, dismissal: { atCount: 3 }, threshold: 3 })
    ).toBe(false);
    expect(
      shouldShowSharingNudge({ activeCount: 6, dismissal: { atCount: 3 }, threshold: 3 })
    ).toBe(true);
  });
});
