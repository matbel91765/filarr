/**
 * suggestionAnchor — OÙ POSER LA LISTE DE SUGGESTIONS quand elle ne vit plus
 * dans le flux du champ.
 *
 * LE DÉFAUT QUE CE FICHIER FERME. La liste de la ligne d'invitation était posée
 * `absolute` sous un parent `relative`, donc À L'INTÉRIEUR de son conteneur — et
 * ses deux conteneurs la DÉCOUPENT. Sur l'onglet Membres, la ligne est l'unique
 * enfant d'une `AdminSection` dont la racine `.ent-section` porte
 * `overflow: hidden` (settings/enterprise/enterprise.css) : sous le champ, à
 * l'intérieur de la boîte de découpe, il ne reste que le `padding` du corps de
 * section et, quand elle est revenue du réseau, la ligne d'occupation de sièges.
 * Une option en fait 36 à 40 — donc au mieux UNE ligne rognée, souvent un simple
 * liseré, et jamais au moment qui compte : champ vide, on vient de prendre le
 * focus précisément pour voir qui est dans l'espace, et les sièges ne sont pas
 * encore arrivés. Dans le dialogue de partage, `.modal-body` porte
 * `overflow-y: auto` (ui/Modal/Modal.css), ce qui calcule l'axe horizontal en
 * `auto` : les deux axes découpent là aussi.
 *
 * LE PORTAIL EST LE CHEMIN QUE LE DESIGN SYSTÈME A CHOISI POUR ÇA. Le `Select`
 * de rôle, posé dans LA MÊME rangée et dans LA MÊME section, s'affiche déjà par
 * `createPortal(…, document.body)` et fonctionne à l'intérieur de la modale de
 * partage : `--z-index-dropdown` (1065) est délibérément AU-DESSUS de
 * `--z-index-modal` (1060). L'ancien commentaire qui craignait de « se glisser
 * derrière la modale » se trompait — et le contre-exemple était à trente pixels.
 *
 * POURQUOI CETTE ARITHMÉTIQUE EST ICI, ET PAS DANS LE COMPOSANT. Le portail
 * coupe le lien que le navigateur tenait tout seul entre le champ et sa liste.
 * Trois défauts naissent de cette coupure, et tous trois compilent : l'oubli du
 * décalage de défilement (`getBoundingClientRect` est relatif à la FENÊTRE,
 * `position: absolute` au DOCUMENT — la liste part alors se poser en haut de la
 * page), la liste ORPHELINE qui survit à la sortie d'écran du champ, posée sur
 * un contenu qui n'a rien à voir avec elle, et la liste INATTEIGNABLE posée sous
 * le bord bas alors que rien ne défile pour aller la chercher. Ce dépôt n'a
 * aucun lanceur de tests avec DOM ; sortir le calcul du composant est la seule
 * façon de les éprouver, et c'est exactement la classe de défaut qui a valu son
 * rapport à la version précédente.
 *
 * CE QUE LA PREMIÈRE VERSION MESURAIT, ET POURQUOI C'ÉTAIT LE MAUVAIS BORD. Elle
 * jugeait la sortie d'écran contre `window.innerHeight` — c'est-à-dire contre un
 * défilement QUI N'EXISTE PAS ICI : `reset.css` pose `body { overflow: hidden }`
 * et `#root { height: 100dvh; overflow: hidden }`, donc `window.scrollY` vaut
 * éternellement 0 et la fenêtre entière est « visible ». Ce qui défile est un
 * conteneur INTÉRIEUR — la page des réglages (`height: 100%; overflow-y: auto`)
 * et `.modal-body`. Un champ entièrement rentré sous l'en-tête de page gardait
 * donc un `rect.top` très confortablement compris entre 0 et la hauteur de
 * fenêtre : la garde se déclarait satisfaite et la liste remontait se poser sur
 * du contenu étranger, c'est-à-dire le défaut que cet en-tête prétend fermer.
 * D'où `clipTop`/`clipBottom` : la boîte réellement découpante, que l'appelant
 * obtient en croisant TOUS ses ancêtres qui découpent avec la fenêtre.
 */

/** Ce que `getBoundingClientRect()` rend du champ, réduit à ce qui sert. */
export interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

/**
 * La boîte qui découpe réellement le champ, en coordonnées de FENÊTRE, plus le
 * défilement de la page.
 *
 * `clipBottom <= clipTop` = mesure indisponible, et non « rien n'est visible » :
 * on ne tire aucun verdict d'une absence d'information — ni la fermeture, ni la
 * bascule.
 */
export interface AnchorViewport {
  scrollX: number;
  scrollY: number;
  /** Le haut de la zone visible du champ (en-têtes fixes déduits). */
  clipTop: number;
  /** Le bas de cette même zone. */
  clipBottom: number;
}

export type SuggestionAnchor =
  | {
      visible: true;
      /**
       * `below` : `top` est le haut de la liste. `above` : `top` est le haut du
       * CHAMP, et l'appelant remonte la boîte lui-même (`translateY(-100%)`).
       */
      placement: 'below' | 'above';
      top: number;
      left: number;
      width: number;
    }
  | { visible: false };

/**
 * L'espace entre le bas du champ et le haut de la liste.
 *
 * Quatre pixels, parce que c'est ce que posait le `mt-1` du flux : changer de
 * mode de positionnement ne doit pas déplacer la liste à l'écran, sinon le
 * correctif se lit lui-même comme un défaut.
 */
export const SUGGESTION_ANCHOR_GAP = 4;

/**
 * La largeur de repli quand le champ n'a pas encore été mis en page.
 *
 * Un premier rendu peut rendre un rectangle de largeur nulle ; une liste large
 * de rien est un liseré vide — c'est-à-dire, mot pour mot, le symptôme qu'on
 * répare. On préfère une liste trop large une frame durant : le recalcul au
 * `resize`/`scroll` la remet à la bonne mesure.
 */
export const SUGGESTION_ANCHOR_MIN_WIDTH = 240;

/**
 * En dessous de cette place restante sous le champ, la liste se retourne.
 *
 * Cent soixante pixels, soit quatre options (36 à 40 chacune) : au-delà on voit
 * assez de monde pour que la liste réponde à sa question, en deçà elle est
 * réduite à un liseré — et `body { overflow: hidden }` interdit de faire défiler
 * la fenêtre pour aller chercher ce qui dépasse, si bien qu'une liste posée trop
 * bas n'est pas seulement rognée : elle est INATTEIGNABLE.
 */
export const SUGGESTION_ANCHOR_FLIP_SPACE = 160;

/**
 * La position de la liste, ou l'ordre de la refermer.
 *
 * ON NE REPOSITIONNE PAS UN CHAMP SORTI DE L'ÉCRAN, ON FERME. Repositionner
 * laisserait une liste de noms flotter au-dessus d'un contenu étranger : le
 * portail affranchit la liste du découpage de son conteneur — c'est tout son
 * objet — mais il l'affranchit aussi de sa disparition. Un bord seulement
 * RASANT reste servi : refermer au pixel ferait clignoter la liste au moindre
 * défilement fin.
 *
 * ELLE SE RETOURNE PLUTÔT QUE DE DÉBORDER. La ligne d'invitation est le dernier
 * élément du bloc dans les deux écrans qui la portent ; sous le bord bas de la
 * boîte découpante, une liste n'est pas seulement rognée, elle est hors
 * d'atteinte. On la bascule au-dessus du champ — mais seulement s'il y a
 * VRAIMENT mieux à y gagner, sinon le geste appris se retournerait pour rien.
 */
export function suggestionAnchor(rect: AnchorRect, viewport: AnchorViewport): SuggestionAnchor {
  const mesuree = viewport.clipBottom > viewport.clipTop;

  // Découpe absente ≠ « le champ est caché » : même règle que partout ailleurs,
  // on ne tire pas de verdict d'une absence d'information.
  if (mesuree && (rect.bottom <= viewport.clipTop || rect.top >= viewport.clipBottom)) {
    return { visible: false };
  }

  const placeDessous = viewport.clipBottom - rect.bottom;
  const placeDessus = rect.top - viewport.clipTop;
  const bascule =
    mesuree && placeDessous < SUGGESTION_ANCHOR_FLIP_SPACE && placeDessus > placeDessous;

  return {
    visible: true,
    placement: bascule ? 'above' : 'below',
    // Les demi-pixels d'un rectangle mesuré font vibrer le texte de la liste au
    // moindre recalcul : on les rend au navigateur déjà arrondis.
    top: Math.round(
      (bascule ? rect.top - SUGGESTION_ANCHOR_GAP : rect.bottom + SUGGESTION_ANCHOR_GAP) +
        viewport.scrollY
    ),
    left: Math.round(rect.left + viewport.scrollX),
    width: Math.round(Math.max(rect.width, SUGGESTION_ANCHOR_MIN_WIDTH)),
  };
}
