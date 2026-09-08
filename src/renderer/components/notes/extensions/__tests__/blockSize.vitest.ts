/**
 * Taille d'un bloc — logique pure.
 *
 *   npx vitest run src/renderer/components/notes/extensions/__tests__/blockSize.vitest.ts
 */

import { describe, it, expect } from 'vitest';
import {
  BLOCK_FALLBACK_WIDTH,
  BLOCK_HEIGHT_STEP,
  BLOCK_MAX_HEIGHT,
  BLOCK_MIN_HEIGHT,
  BLOCK_MIN_WIDTH,
  BLOCK_SNAP_TOLERANCE,
  BLOCK_WIDTH_STEP,
  RESIZABLE_BLOCK_TYPES,
  canBoundHeight,
  canResizeBlockHeightType,
  canResizeBlockType,
  clampBlockHeight,
  clampBlockWidth,
  heightAttrFor,
  heightFromDrag,
  parseBlockHeight,
  parseBlockWidth,
  stepBlockHeight,
  stepBlockWidth,
  usableWidth,
  widthAttrFor,
  widthFromDrag,
} from '../blockSize';

const COLUMN = 900;

describe('quels blocs portent une largeur', () => {
  it('couvre la base inline — celle qui porte le kanban', () => {
    expect(canResizeBlockType('inlineDatabase')).toBe(true);
  });

  it('laisse le texte tranquille', () => {
    // Une poignée sur chaque ligne de la note est du bruit permanent : le prix
    // d'une affordance se paie partout où elle apparaît sans servir.
    for (const type of ['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList']) {
      expect(canResizeBlockType(type)).toBe(false);
    }
  });

  it("laisse l'image régler sa propre largeur", () => {
    // Deux largeurs sur le même nœud se contrediraient sans que rien à l'écran
    // ne dise laquelle gagne.
    expect(RESIZABLE_BLOCK_TYPES).not.toContain('fileEmbed');
  });
});

describe('mesure de la place disponible', () => {
  it('replie sur une valeur exploitable quand on ne peut pas mesurer', () => {
    // jsdom, bloc détaché, conteneur pas encore posé : jamais de NaN, qui
    // finirait en `width: NaNpx`, c'est-à-dire en bloc invisible.
    expect(usableWidth(NaN)).toBe(BLOCK_FALLBACK_WIDTH);
    expect(usableWidth(0)).toBe(BLOCK_FALLBACK_WIDTH);
    expect(usableWidth(-40)).toBe(BLOCK_FALLBACK_WIDTH);
  });

  it('prend la mesure telle quelle quand elle est utilisable', () => {
    expect(usableWidth(COLUMN)).toBe(COLUMN);
  });
});

describe('bornes', () => {
  it('ne descend jamais sous le minimum lisible', () => {
    expect(clampBlockWidth(10, COLUMN)).toBe(BLOCK_MIN_WIDTH);
  });

  it('ne dépasse jamais la place réellement disponible', () => {
    // Le plafond est MESURÉ, pas constant : c'est ce qui garantit qu'un bloc ne
    // déborde pas d'un panneau étroit.
    expect(clampBlockWidth(5000, COLUMN)).toBe(COLUMN);
    expect(clampBlockWidth(5000, 400)).toBe(400);
  });
});

describe('lecture depuis le document', () => {
  it("traite l'absence d'attribut comme la largeur d'office", () => {
    // Un document écrit avant cette fonctionnalité doit se lire exactement
    // comme aujourd'hui.
    for (const raw of [null, undefined, '', 'oui', NaN]) {
      expect(parseBlockWidth(raw)).toBeNull();
    }
  });

  it('accepte le nombre comme la chaîne (data-attribut ou attribut de nœud)', () => {
    expect(parseBlockWidth(480)).toBe(480);
    expect(parseBlockWidth('480')).toBe(480);
  });

  it('ne PLAFONNE pas à la lecture', () => {
    // Une note relue dans un panneau étroit ne doit pas se faire RÉÉCRIRE par
    // la seule lecture : le plafond est affaire de rendu, pas de stockage.
    expect(parseBlockWidth(1800)).toBe(1800);
  });

  it('remonte une valeur abîmée au minimum plutôt que de la jeter', () => {
    expect(parseBlockWidth(12)).toBe(BLOCK_MIN_WIDTH);
  });
});

describe('glissement de la poignée', () => {
  it('rend au bloc exactement ce que la souris a parcouru', () => {
    // Aucun facteur d'échelle : le bord gauche ne bouge pas, la main et le bord
    // droit restent collés. C'est le geste de l'image.
    expect(widthFromDrag(500, 120, COLUMN)).toBe(620);
    expect(widthFromDrag(500, -120, COLUMN)).toBe(380);
  });

  it('reste dans les bornes même sur un geste emballé', () => {
    expect(widthFromDrag(500, 9000, COLUMN)).toBe(COLUMN);
    expect(widthFromDrag(500, -9000, COLUMN)).toBe(BLOCK_MIN_WIDTH);
  });
});

describe("ce qu'on écrit dans le document", () => {
  it("écrit `null` — et non la mesure — dès qu'on retrouve la largeur d'office", () => {
    // Un bloc ramené à sa taille d'origine doit redevenir rigoureusement
    // identique à un bloc qu'on n'a jamais touché : mêmes attributs, même
    // sérialisation, même empreinte pour la synchronisation.
    expect(widthAttrFor(COLUMN, COLUMN)).toBeNull();
  });

  it('pardonne les derniers pixels', () => {
    // Sans zone d'attraction, revenir à « comme avant » demanderait de tomber
    // au pixel près sur la largeur du conteneur : le bloc resterait à 899 px
    // pour toujours, avec un attribut inutile dans le document.
    expect(widthAttrFor(COLUMN - BLOCK_SNAP_TOLERANCE + 1, COLUMN)).toBeNull();
    expect(widthAttrFor(COLUMN - BLOCK_SNAP_TOLERANCE - 1, COLUMN)).toBe(
      COLUMN - BLOCK_SNAP_TOLERANCE - 1
    );
  });

  it('garde une largeur franchement plus étroite', () => {
    expect(widthAttrFor(520, COLUMN)).toBe(520);
  });
});

describe('réglage au clavier', () => {
  it('part de la largeur d’office quand le bloc n’a pas encore de largeur', () => {
    expect(stepBlockWidth(null, -1, COLUMN)).toBe(COLUMN - BLOCK_WIDTH_STEP);
  });

  it('ne fait rien de plus large que la place disponible', () => {
    expect(stepBlockWidth(null, 1, COLUMN)).toBeNull();
  });

  it('atteint les mêmes valeurs que la souris', () => {
    expect(stepBlockWidth(520, -1, COLUMN)).toBe(520 - BLOCK_WIDTH_STEP);
    expect(stepBlockWidth(520, 1, COLUMN)).toBe(520 + BLOCK_WIDTH_STEP);
  });

  it("sait REVENIR à la largeur d'office sans souris", () => {
    // Sinon un bloc rétréci le resterait pour toujours dès qu'on n'a pas de
    // souris sous la main.
    expect(stepBlockWidth(COLUMN - BLOCK_WIDTH_STEP, 1, COLUMN)).toBeNull();
  });

  it('ne descend pas sous le minimum lisible', () => {
    expect(stepBlockWidth(BLOCK_MIN_WIDTH, -1, COLUMN)).toBe(BLOCK_MIN_WIDTH);
  });
});

// ==================== Hauteur ====================

/** Hauteur naturelle du bloc : ce qu'il prendrait sans contrainte. */
const NATURAL = 800;

describe('quels blocs acceptent une hauteur', () => {
  it('couvre la base inline — le kanban est le cas qui a motivé le réglage', () => {
    expect(canResizeBlockHeightType('inlineDatabase')).toBe(true);
  });

  it("laisse l'embed tranquille", () => {
    // Une vidéo a un rapport d'image : sa hauteur découle de sa largeur. Lui en
    // imposer une autre ne borne rien, ça rogne. La largeur, elle, reste réglable.
    expect(canResizeBlockHeightType('embedUrl')).toBe(false);
    expect(canResizeBlockType('embedUrl')).toBe(true);
  });
});

describe('bornes de hauteur', () => {
  it('ne descend jamais sous le minimum lisible', () => {
    expect(clampBlockHeight(10)).toBe(BLOCK_MIN_HEIGHT);
  });

  it('ne monte jamais au-delà du plafond absolu', () => {
    // Garde-fou contre un glissement emballé : un bloc de 40 000 px ne se
    // rattrape plus à la souris.
    expect(clampBlockHeight(99_999)).toBe(BLOCK_MAX_HEIGHT);
  });

  it("NE dépend PAS du contenu — c'est ce qui rend l'agrandissement possible", () => {
    // La régression corrigée : plafonner à la hauteur naturelle rendait le
    // glissement vers le BAS totalement inerte, donc le réglage « cassé ».
    expect(clampBlockHeight(NATURAL + 400)).toBe(NATURAL + 400);
  });
});

describe('lecture de la hauteur depuis le document', () => {
  it("traite l'absence d'attribut comme « aussi haut qu'il faut »", () => {
    for (const raw of [null, undefined, '', 'oui', NaN]) {
      expect(parseBlockHeight(raw)).toBeNull();
    }
  });

  it('accepte le nombre comme la chaîne, et ne plafonne pas à la lecture', () => {
    expect(parseBlockHeight(360)).toBe(360);
    expect(parseBlockHeight('360')).toBe(360);
    expect(parseBlockHeight(4000)).toBe(4000);
  });
});

describe('glissement vertical', () => {
  it('rend au bloc exactement ce que la souris a parcouru, DANS LES DEUX SENS', () => {
    expect(heightFromDrag(500, -120)).toBe(380);
    expect(heightFromDrag(500, 120)).toBe(620);
  });

  it('reste dans les bornes même sur un geste emballé', () => {
    expect(heightFromDrag(500, 99_999)).toBe(BLOCK_MAX_HEIGHT);
    expect(heightFromDrag(500, -99_999)).toBe(BLOCK_MIN_HEIGHT);
  });
});

describe("ce qu'on écrit comme hauteur", () => {
  it('garde une hauteur plus COURTE que le contenu — le bloc défilera', () => {
    expect(heightAttrFor(360, NATURAL)).toBe(360);
  });

  it('garde une hauteur plus HAUTE que le contenu — la vue active s’y étire', () => {
    // Le cas qui ne marchait pas : tirer vers le bas doit produire quelque chose.
    expect(heightAttrFor(NATURAL + 300, NATURAL)).toBe(NATURAL + 300);
  });

  it('efface la borne en repassant près de la hauteur naturelle, des DEUX côtés', () => {
    // Sans bande symétrique, « revenir comme avant » ne serait atteignable que
    // par le haut — et tout agrandissement se réécrirait en « libre ».
    expect(heightAttrFor(NATURAL, NATURAL)).toBeNull();
    expect(heightAttrFor(NATURAL - BLOCK_SNAP_TOLERANCE + 1, NATURAL)).toBeNull();
    expect(heightAttrFor(NATURAL + BLOCK_SNAP_TOLERANCE - 1, NATURAL)).toBeNull();
    expect(heightAttrFor(NATURAL + BLOCK_SNAP_TOLERANCE + 1, NATURAL)).toBe(
      NATURAL + BLOCK_SNAP_TOLERANCE + 1
    );
  });

  it('règle quand même la hauteur sans mesure du contenu', () => {
    // jsdom, bloc pas encore posé : on perd le retour à « libre » par
    // glissement (le double-clic le garde), pas le réglage lui-même.
    expect(canBoundHeight(NaN)).toBe(false);
    expect(heightAttrFor(360, NaN)).toBe(360);
  });
});

describe('réglage de la hauteur au clavier', () => {
  it('part de la hauteur du contenu quand le bloc est libre', () => {
    expect(stepBlockHeight(null, -1, NATURAL)).toBe(NATURAL - BLOCK_HEIGHT_STEP);
    expect(stepBlockHeight(null, 1, NATURAL)).toBe(NATURAL + BLOCK_HEIGHT_STEP);
  });

  it('atteint les mêmes valeurs que la souris', () => {
    expect(stepBlockHeight(360, -1, NATURAL)).toBe(360 - BLOCK_HEIGHT_STEP);
    expect(stepBlockHeight(360, 1, NATURAL)).toBe(360 + BLOCK_HEIGHT_STEP);
  });

  it('sait LIBÉRER la hauteur sans souris', () => {
    expect(stepBlockHeight(NATURAL - BLOCK_HEIGHT_STEP, 1, NATURAL)).toBeNull();
    expect(stepBlockHeight(NATURAL + BLOCK_HEIGHT_STEP, -1, NATURAL)).toBeNull();
  });

  it('ne descend pas sous le minimum lisible', () => {
    expect(stepBlockHeight(BLOCK_MIN_HEIGHT, -1, NATURAL)).toBe(BLOCK_MIN_HEIGHT);
  });
});
