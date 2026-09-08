/**
 * editorChromeModel — qui décide de ce qui est visible autour du texte
 *
 * Trois sources se disputent le même DOM : le clic de l'utilisateur, le
 * défilement (l'en-tête se replie quand on descend) et le mode sans
 * distraction. Les câbler chacune sur son propre `useState` produit des
 * contradictions silencieuses — un repli manuel annulé au premier cran de
 * molette, un panneau qui reparaît en mode focus — alors la DÉCISION vit ici,
 * en logique pure, et les composants ne gardent que les capteurs.
 *
 * Pas de DOM, pas de `window`, pas de React : c'est ce qui rend ce module
 * testable en environnement `node` (vitest.config.ts pose `environment: 'node'`).
 *
 * ── LA RÈGLE ──────────────────────────────────────────────────────────────
 *
 *   manuel  >  focus  >  défilement
 *
 * Le choix explicite gagne toujours. Il n'est réarmé que par une TRANSITION :
 * être descendu au-delà du seuil haut PUIS être remonté sous le seuil bas.
 * Jamais par le simple fait d'être en haut — sinon replier l'en-tête d'une
 * note qu'on vient d'ouvrir (donc à scrollTop = 0) serait défait par le
 * premier événement de défilement venu, et « manuel > automatique » serait un
 * mensonge dans le cas le plus courant.
 *
 * Contrepartie à respecter par les appelants : SORTIR du mode focus doit
 * remettre `headerManual` et `toolbarFocusOverride` à `null`. Sans cela, un
 * ajustement fait pendant le focus figerait le chrome après la sortie.
 */

// ==================== Composition du chrome ====================

export interface ChromeInputs {
  /** Mode sans distraction actif. */
  focusMode: boolean;
  /** Préférence « panneaux latéraux au survol seulement ». */
  hoverPref: boolean;
  /** Panneau de gauche épinglé par l'utilisateur. */
  listPinned: boolean;
  /** Panneau de droite épinglé par l'utilisateur. */
  rightPinned: boolean;
  /** Le pointeur (ou le focus clavier) réclame le panneau de gauche. */
  listPeek: boolean;
  /** Le pointeur (ou le focus clavier) réclame le panneau de droite. */
  rightPeek: boolean;
  /** Choix explicite sur l'en-tête. `null` = laisser l'automatique décider. */
  headerManual: boolean | null;
  /** Palier atteint par le défilement (voir `decideHeaderStage`). */
  scrollStage: HeaderStage;
  /** Préférence persistée de la barre d'outils. */
  toolbarPref: boolean;
  /** Ajustement de la barre VALABLE LE TEMPS DU FOCUS, jamais écrit sur disque. */
  toolbarFocusOverride: boolean | null;
  /**
   * Une note est-elle ouverte ?
   *
   * Quand il n'y en a pas, les deux panneaux restent là quoi qu'il arrive : la
   * page vide n'a rien à protéger de la distraction, et masquer la liste y
   * retirerait le seul chemin vers une note. On sortirait du mode survol par
   * un geste au bord, à condition de le deviner.
   *
   * ⚠ TOUTE note à l'écran, y compris celle d'un COFFRE PARTAGÉ.
   *
   * Une note de coffre ne passe pas par `notesSlice` — l'appelant a donc lu
   * `!!editingNote`, qui est nul pendant qu'on en lit une, et cette règle
   * forçait alors les panneaux visibles quoi qu'on clique. Les boutons de repli
   * paraissaient morts alors qu'ils faisaient exactement leur travail : la
   * visibilité était décidée avant qu'on consulte leur état.
   */
  noteOpen: boolean;
}

/**
 * Les TROIS paliers de l'en-tête, du plus garni au plus nu.
 *
 *   full    couverture + icône + titre + informations   (~280 px avec la barre)
 *   title   la couverture s'efface, le reste demeure    (~150 px)
 *   compact un bandeau d'une ligne : titre et témoins    (~80 px)
 *
 * Un seul automate, pas deux booléens : « couverture masquée » et « en-tête
 * replié » posés côte à côte finiraient par se contredire sur le même DOM.
 */
export type HeaderStage = 'full' | 'title' | 'compact';

export interface ChromeState {
  listVisible: boolean;
  rightVisible: boolean;
  headerStage: HeaderStage;
  /** Raccourci de `headerStage === 'compact'`, pour les appelants binaires. */
  headerCollapsed: boolean;
  toolbarCollapsed: boolean;
}

export function resolveChrome(input: ChromeInputs): ChromeState {
  const {
    focusMode,
    hoverPref,
    listPinned,
    rightPinned,
    listPeek,
    rightPeek,
    headerManual,
    scrollStage,
    toolbarPref,
    toolbarFocusOverride,
    noteOpen,
  } = input;

  // Sans note ouverte, les panneaux restent : c'est la seule facon d'en
  // atteindre une. Cette regle passe AVANT le mode focus, qui n'a rien a epurer
  // sur une page vide.
  //
  // En mode focus les panneaux partent, quelle que soit la préférence de survol
  // et quel que soit l'épinglage : c'est la promesse du mode.
  const panelVisible = (pinned: boolean, peek: boolean) =>
    !noteOpen ? true : focusMode ? false : hoverPref ? pinned || peek : pinned;
  const listVisible = panelVisible(listPinned, listPeek);
  const rightVisible = panelVisible(rightPinned, rightPeek);

  // Le choix explicite reste BINAIRE — le bouton d'en-tête n'a que deux états —
  // et il écrase le palier automatique dans les deux sens.
  const headerStage: HeaderStage =
    headerManual !== null
      ? headerManual
        ? 'compact'
        : 'full'
      : focusMode
        ? 'compact'
        : scrollStage;

  return {
    listVisible,
    rightVisible,
    headerStage,
    headerCollapsed: headerStage === 'compact',
    toolbarCollapsed: focusMode ? (toolbarFocusOverride ?? true) : toolbarPref,
  };
}

// ==================== Verdict du défilement ====================

/**
 * Seuil au-delà duquel l'en-tête se replie, et seuil sous lequel il revient.
 *
 * L'écart entre les deux n'est pas cosmétique : replier libère ~300 px, donc
 * `.note-editor__body { min-height: 100% }` suit, la course de défilement
 * diminue et le navigateur peut ramener `scrollTop` sous le seuil. Sans
 * hystérésis, ce seul enchaînement suffit à faire clignoter l'en-tête.
 */
export const COVER_AT = 48;
export const COVER_BACK = 12;
export const COLLAPSE_AT = 200;
export const EXPAND_AT = 96;

/**
 * Durée pendant laquelle les mesures sont ignorées après une bascule : le
 * temps que la mise en page se stabilise, les valeurs lues décrivent encore
 * l'état d'AVANT.
 */
export const SETTLE_MS = 300;

/**
 * Hauteur de la barre compacte qui REMPLACE l'en-tête déployé
 * (`.note-editor__header-compact { min-height: 36px }`). Le repli ne libère
 * donc pas la hauteur de l'en-tête, mais la DIFFÉRENCE entre les deux.
 */
export const COMPACT_HEADER_PX = 36;

export interface ScrollCollapseState {
  /** Palier courant. */
  stage: HeaderStage;
  /** Horodatage de la dernière bascule, pour le verrou temporel. */
  changedAt: number;
}

export const initialScrollCollapse: ScrollCollapseState = {
  stage: 'full',
  changedAt: 0,
};

export interface ScrollMeasurement {
  scrollTop: number;
  /** Hauteur visible du conteneur qui défile. */
  clientHeight: number;
  /** Hauteur totale de son contenu. */
  scrollHeight: number;
  /**
   * Ce que chaque palier LIBÈRE, mesuré en état déployé.
   *
   * Mesurer l'en-tête courant donnerait ~280 px déployé et ~36 px replié : le
   * garde-fou anti-oscillation deviendrait bien plus permissif juste après le
   * premier repli, c'est-à-dire à l'instant précis où il doit tenir. On passe
   * donc des DELTAS mis en cache pendant que l'en-tête est entier.
   */
  coverHeight: number;
  collapsibleHeight: number;
  now: number;
  /**
   * Un geste en cours interdit toute bascule : sélecteur de couverture ouvert
   * (il est rendu DANS l'en-tête et serait démonté), saut vers un titre en
   * cours (il écrit `scrollTop` lui-même et re-vise), mode dessin (le canevas
   * est dimensionné sur la géométrie courante).
   */
  locked: boolean;
  /**
   * La note a-t-elle une couverture ? Sans couverture il n'y a rien à faire
   * disparaître, l'en-tête ne fait qu'une centaine de pixels, et le replier
   * masquerait le SEUL bouton « Ajouter une couverture ».
   */
  hasCover: boolean;
}

/**
 * Fait avancer ou reculer l'en-tête d'UN palier, jamais de deux.
 *
 * Un seul pas par événement : sauter `full` → `compact` d'un coup escamoterait
 * le palier intermédiaire précisément quand il sert — sur la lancée d'un grand
 * défilement — et rendrait le retour saccadé.
 *
 * Retourne aussi `rearm`, que l'appelant traduit par `setHeaderManual(null)` :
 * le modèle ne connaît pas React. Il n'est levé qu'en revenant à `full`, donc
 * seulement après être vraiment redescendu dans le document — rester en haut
 * n'est pas un réarmement, sinon un repli manuel posé sur une note qu'on vient
 * d'ouvrir ne survivrait pas au premier cran de molette.
 */
export function decideHeaderStage(
  prev: ScrollCollapseState,
  m: ScrollMeasurement
): { next: ScrollCollapseState; rearm: boolean } {
  const keep = { next: prev, rearm: false };

  if (!m.hasCover || m.locked) return keep;

  // Verrou temporel : tant que la mise en page n'a pas fini de bouger, ce
  // qu'on mesure décrit l'état précédent.
  if (prev.changedAt > 0 && m.now - prev.changedAt < SETTLE_MS) return keep;

  const runway = m.scrollHeight - m.clientHeight;
  const step = (stage: HeaderStage, rearm = false) => ({
    next: { stage, changedAt: m.now },
    rearm,
  });

  // Replier ne DÉPLACE pas le contenu — l'en-tête est un frère du conteneur qui
  // défile, donc c'est le conteneur qui grandit — mais la course de défilement,
  // elle, diminue d'autant. Refuser tant qu'il n'y a pas de quoi revenir, sinon
  // l'en-tête resterait replié sans qu'aucun geste ne puisse le rouvrir.
  const affordable = (freed: number) => runway - freed > EXPAND_AT;

  if (prev.stage === 'full') {
    if (m.scrollTop >= COVER_AT && affordable(m.coverHeight)) return step('title');
    return keep;
  }

  if (prev.stage === 'title') {
    if (m.scrollTop >= COLLAPSE_AT && affordable(m.collapsibleHeight)) return step('compact');
    if (m.scrollTop <= COVER_BACK) return step('full', true);
    return keep;
  }

  if (m.scrollTop <= EXPAND_AT) return step('title');
  return keep;
}
