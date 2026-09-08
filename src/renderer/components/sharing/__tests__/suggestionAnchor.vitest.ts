/**
 * suggestionAnchor — où se pose la liste de suggestions une fois qu'elle a
 * QUITTÉ le flux du champ.
 *
 * CE QUE CES TESTS GARDENT, ET POURQUOI ILS EXISTENT SÉPARÉMENT DU COMPOSANT.
 * Tant que la liste était `absolute` sous un parent `relative`, le navigateur
 * tenait le lien entre elle et le champ : il n'y avait rien à calculer, donc
 * rien à casser. Le portail supprime ce lien — la liste vit désormais sur
 * `document.body` et ne sait plus rien du champ. Trois défauts apparaissent avec
 * lui, et tous trois COMPILENT :
 *   · l'oubli du décalage de défilement (`scrollY`), qui pose la liste tout en
 *     haut du document dès que la page a été descendue d'un pixel — le symptôme
 *     ressemble à « la liste ne s'affiche plus », alors qu'elle s'affiche
 *     ailleurs ;
 *   · la liste orpheline : le champ est sorti de l'écran (on a fait défiler le
 *     corps de la modale), et une liste de noms flotte au-dessus d'un contenu
 *     qui n'a rien à voir avec elle ;
 *   · la liste INATTEIGNABLE, posée sous le bord bas alors que `body
 *     { overflow: hidden }` interdit de faire défiler pour aller la chercher.
 * Aucun des trois ne se voit d'un test de modèle sur les candidats, et ce
 * dépôt n'a AUCUN lanceur de tests avec DOM (ni jsdom, ni testing-library, ni
 * jest installés) : la seule façon de les éprouver est de sortir l'arithmétique
 * du composant. C'est tout ce que fait ce module.
 *
 * CE QUE LA PREMIÈRE VERSION DE CES TESTS A LAISSÉ PASSER. Ils ne mesuraient la
 * sortie d'écran que contre LA FENÊTRE — or aucun des deux hôtes de la ligne ne
 * défile dans la fenêtre : `reset.css` pose `body { overflow: hidden }` et
 * `#root { height: 100dvh; overflow: hidden }`, si bien que `window.scrollY`
 * vaut éternellement 0. Ce qui défile est un conteneur INTÉRIEUR — la page des
 * réglages (`VaultSettingsView`, `height: 100%; overflow-y: auto`) et
 * `.modal-body` du dialogue de partage. Un champ entièrement rentré sous
 * l'en-tête de page gardait donc un `rect.top` très confortablement compris
 * entre 0 et `window.innerHeight`, la liste se déclarait visible, et elle
 * remontait se poser sur un contenu étranger : exactement le défaut que le
 * module prétend fermer. D'où `clipTop`/`clipBottom` — la boîte réellement
 * découpante — à la place de la seule hauteur de fenêtre.
 *
 *   npx vitest run src/renderer/components/sharing/__tests__/suggestionAnchor.vitest.ts
 */

import { describe, expect, it } from 'vitest';
import {
  SUGGESTION_ANCHOR_FLIP_SPACE,
  SUGGESTION_ANCHOR_GAP,
  SUGGESTION_ANCHOR_MIN_WIDTH,
  suggestionAnchor,
} from '../suggestionAnchor';

/** Un champ de 320 px de large, posé à 200 px du haut de la fenêtre. */
const CHAMP = { top: 200, bottom: 236, left: 48, width: 320 };
/** Une fenêtre de 800 px de haut, page non défilée, rien d'autre qui découpe. */
const FENETRE = { scrollX: 0, scrollY: 0, clipTop: 0, clipBottom: 800 };

describe('suggestionAnchor — la liste reste collée au champ', () => {
  it('se pose juste sous le champ, à sa gauche et à sa largeur', () => {
    const a = suggestionAnchor(CHAMP, FENETRE);
    expect(a).toEqual({
      visible: true,
      placement: 'below',
      top: 236 + SUGGESTION_ANCHOR_GAP,
      left: 48,
      width: 320,
    });
  });

  it('l’espace de quatre pixels est celui que le flux posait (`mt-1`)', () => {
    // La liste ne doit pas se recoller au champ en changeant de mode de
    // positionnement : le déplacement se verrait, et se lirait comme un défaut.
    expect(SUGGESTION_ANCHOR_GAP).toBe(4);
  });

  /**
   * LE DÉFAUT QUI COMPILE. `getBoundingClientRect()` est relatif à la FENÊTRE,
   * `position: absolute` au DOCUMENT. Sans les deux décalages, la liste part se
   * poser en haut de la page dès qu'on a fait défiler — et le portail rend le
   * défaut silencieux, puisque plus rien ne la ramène près du champ.
   */
  it('ajoute le défilement de la page — sinon la liste part en haut du document', () => {
    const a = suggestionAnchor(CHAMP, { scrollX: 15, scrollY: 640, clipTop: 0, clipBottom: 800 });
    expect(a).toEqual({
      visible: true,
      placement: 'below',
      top: 236 + 640 + SUGGESTION_ANCHOR_GAP,
      left: 48 + 15,
      width: 320,
    });
  });
});

describe('la liste orpheline', () => {
  /**
   * Le portail affranchit la liste du découpage de son conteneur : c'est tout
   * l'objet du correctif. Mais il l'affranchit AUSSI de sa disparition — un
   * champ sorti de l'écran laisserait derrière lui une liste de noms posée sur
   * un contenu étranger. On ne la repositionne pas hors champ : on dit à
   * l'appelant de la refermer.
   */
  it('se referme quand le champ est sorti par le haut', () => {
    expect(suggestionAnchor({ ...CHAMP, top: -80, bottom: -44 }, FENETRE)).toEqual({
      visible: false,
    });
  });

  it('se referme quand le champ est sorti par le bas', () => {
    expect(suggestionAnchor({ ...CHAMP, top: 812, bottom: 848 }, FENETRE)).toEqual({
      visible: false,
    });
  });

  /**
   * LE CAS RÉEL, ET CELUI QUE LA FENÊTRE SEULE NE VOIT PAS. Personne ne défile
   * dans la fenêtre ici (`body { overflow: hidden }`) : ce qui défile est la
   * page des réglages, dont le haut commence SOUS l'en-tête de page. Un champ
   * remonté à 80 px du haut de la fenêtre est alors entièrement caché derrière
   * cet en-tête, alors que `rect.top` reste bien entre 0 et 800.
   */
  it('se referme quand le champ est rentré sous l’en-tête de la page des réglages', () => {
    expect(
      suggestionAnchor(
        { ...CHAMP, top: 80, bottom: 116 },
        { scrollX: 0, scrollY: 0, clipTop: 140, clipBottom: 900 }
      )
    ).toEqual({ visible: false });
  });

  it('se referme quand le champ est rentré sous l’en-tête de la modale de partage', () => {
    // `.modal-body` (`overflow-y: auto`) commence sous le titre de la modale :
    // le champ défilé vers le haut disparaît DERRIÈRE ce titre, pas hors écran.
    expect(
      suggestionAnchor(
        { ...CHAMP, top: 80, bottom: 116 },
        { scrollX: 0, scrollY: 0, clipTop: 260, clipBottom: 700 }
      )
    ).toEqual({ visible: false });
  });

  it('se referme quand le champ est sorti par le bas de son conteneur défilant', () => {
    expect(
      suggestionAnchor(
        { ...CHAMP, top: 620, bottom: 656 },
        { scrollX: 0, scrollY: 0, clipTop: 140, clipBottom: 600 }
      )
    ).toEqual({ visible: false });
  });

  it('un champ seulement RASANT reste servi — on ne referme pas pour un pixel', () => {
    // Un bord exactement à la limite est encore là : refermer ici ferait
    // clignoter la liste au moindre défilement fin.
    expect(suggestionAnchor({ ...CHAMP, top: -35, bottom: 1 }, FENETRE)).toMatchObject({
      visible: true,
    });
    expect(suggestionAnchor({ ...CHAMP, top: 799, bottom: 835 }, FENETRE)).toMatchObject({
      visible: true,
    });
  });

  it('une boîte de découpe dégénérée (0) ne referme rien', () => {
    // Mesure absente ≠ « le champ est caché ». Même règle que partout ailleurs :
    // on ne tire pas de verdict d'une absence d'information.
    expect(
      suggestionAnchor(
        { ...CHAMP, top: -80, bottom: -44 },
        {
          scrollX: 0,
          scrollY: 0,
          clipTop: 0,
          clipBottom: 0,
        }
      )
    ).toMatchObject({ visible: true, placement: 'below' });
  });
});

describe('la bascule au-dessus du champ', () => {
  /**
   * POURQUOI ELLE EXISTE ICI ET PAS DANS LE `Select` DU DESIGN SYSTÈME. Celui-ci
   * pose toujours son menu sous son déclencheur, et s'en tire parce que ses
   * menus sont courts et ses déclencheurs rarement en bas de page. La ligne
   * d'invitation, elle, est le DERNIER élément du bloc dans les deux écrans qui
   * la portent, et `body { overflow: hidden }` interdit de faire défiler la
   * fenêtre pour aller chercher une liste posée sous le bord : elle serait
   * simplement inatteignable. On la retourne donc au-dessus du champ.
   *
   * La bascule ne rend PAS une hauteur : elle rend le haut du champ, et le
   * composant remonte la boîte d'elle-même (`translateY(-100%)`). Devoir
   * connaître la hauteur de la liste obligerait à la mesurer après l'avoir
   * affichée — donc à la laisser sauter une image sous l'œil.
   */
  it('bascule au-dessus quand il ne reste presque rien sous le champ', () => {
    const a = suggestionAnchor({ ...CHAMP, top: 700, bottom: 736 }, FENETRE);
    expect(a).toEqual({
      visible: true,
      placement: 'above',
      top: 700 - SUGGESTION_ANCHOR_GAP,
      left: 48,
      width: 320,
    });
  });

  it('la bascule suit le défilement de la page comme le reste', () => {
    const a = suggestionAnchor(
      { ...CHAMP, top: 700, bottom: 736 },
      { scrollX: 15, scrollY: 640, clipTop: 0, clipBottom: 800 }
    );
    expect(a).toMatchObject({ placement: 'above', top: 700 + 640 - SUGGESTION_ANCHOR_GAP });
  });

  it('ne bascule pas quand le dessus est encore plus étroit que le dessous', () => {
    // Retourner la liste pour gagner quarante pixels serait un déplacement
    // gratuit : le geste appris se retournerait sans rien rendre en échange.
    expect(
      suggestionAnchor(
        { ...CHAMP, top: 660, bottom: 696 },
        { scrollX: 0, scrollY: 0, clipTop: 600, clipBottom: 800 }
      )
    ).toMatchObject({ placement: 'below' });
  });

  it('ne bascule pas sans mesure de découpe — on ne conclut pas d’une absence', () => {
    expect(
      suggestionAnchor(
        { ...CHAMP, top: 700, bottom: 736 },
        {
          scrollX: 0,
          scrollY: 0,
          clipTop: 0,
          clipBottom: 0,
        }
      )
    ).toMatchObject({ placement: 'below' });
  });

  it('le seuil laisse voir plusieurs lignes avant de retourner la liste', () => {
    // Une option fait 36 à 40 px : sous ce seuil, il en resterait moins de
    // quatre à l'écran, ce qui est le symptôme qu'on répare.
    expect(SUGGESTION_ANCHOR_FLIP_SPACE).toBe(160);
  });
});

describe('les mesures aberrantes', () => {
  it('une largeur nulle ne rend pas une liste de zéro pixel', () => {
    // Le champ n'a pas encore été mis en page (premier rendu) : une liste large
    // de rien serait un liseré vide, c'est-à-dire le défaut qu'on répare.
    const a = suggestionAnchor({ top: 10, bottom: 46, left: 20, width: 0 }, FENETRE);
    expect(a).toMatchObject({ visible: true, width: SUGGESTION_ANCHOR_MIN_WIDTH });
  });

  it('les coordonnées sont arrondies — un demi-pixel fait vibrer le texte', () => {
    const a = suggestionAnchor({ top: 200.4, bottom: 236.6, left: 48.5, width: 319.7 }, FENETRE);
    expect(a).toEqual({ visible: true, placement: 'below', top: 241, left: 49, width: 320 });
  });
});
