/**
 * LE THÈME SUR MESURE — quarante-deux jetons déduits de deux couleurs.
 *
 * ── CE QU'ON A TROUVÉ AVANT D'ÉCRIRE CE MODULE ──────────────────────────────
 *
 * Il existait déjà, dans `themeService`, un modèle de thème personnalisé
 * complet : dix-neuf couleurs, création, import/export, et un `ThemeCustomizer`
 * de six cent quatre-vingt-sept lignes. Rien de tout cela n'était branché —
 * l'écran n'était rendu NULLE PART, et surtout `applyTheme` écrit des variables
 * `--theme-*` que la feuille de style n'utilise que quarante-deux fois, contre
 * plus de sept mille usages de `--color-*`.
 *
 * Autrement dit : même branché, cet écran aurait recoloré moins d'un pour cent
 * de l'application, et l'utilisateur aurait vu son thème « ne pas marcher »
 * sans comprendre pourquoi. On ne le rebranche donc pas ; on produit les jetons
 * que l'application lit VRAIMENT.
 *
 * ── DEUX COULEURS, PAS QUARANTE-DEUX ────────────────────────────────────────
 *
 * Les onze thèmes livrés sont écrits à la main et relus un par un. On ne peut
 * pas demander ça à quelqu'un : il choisit un FOND et un ACCENT, éventuellement
 * une couleur de texte, et tout le reste se déduit.
 *
 * Les proportions ci-dessous ne sont pas inventées : elles ont été relevées sur
 * les thèmes existants (« papier » pour le clair, « space » pour le sombre)
 * puis vérifiées à rebours — appliquées à leur fond et à leur accent, elles
 * retombent à quelques unités près sur leurs valeurs écrites à la main. Un thème
 * composé ressemble donc aux thèmes livrés, au lieu d'avoir « l'air composé ».
 *
 * ── LA RAMPE D'ACCENT CHANGE DE SENS SELON LE FOND ──────────────────────────
 *
 * En thème CLAIR la rampe `primary-200 → 800` va du plus clair au plus sombre,
 * l'accent est au 500, et les liens prennent le 600. En thème SOMBRE elle n'est
 * pas monotone : l'accent est au 300, les indices moyens s'assombrissent, et
 * 700/800 REMONTENT vers le clair — parce que là-bas ce sont des couleurs de
 * TEXTE, posées sur un fond sombre.
 *
 * Ignorer ce retournement produirait un thème sombre dont tous les liens sont
 * illisibles. C'est la première chose qui casse quand on croit qu'une rampe est
 * « juste » une échelle de luminosité.
 *
 * ── « CLAIR OU SOMBRE » NE SE DÉCLARE PAS, IL SE MESURE ─────────────────────
 *
 * La première version demandait une `base: 'light' | 'dark'` EN PLUS du fond.
 * Deux valeurs pour un seul fait, donc deux valeurs qui peuvent se contredire —
 * et le test de balayage a trouvé la contradiction en une seconde : « base
 * claire » avec un fond NOIR élevait les surfaces de 35 % vers le blanc, ce qui
 * posait un texte réglé pour le noir sur un gris moyen. 4,59:1 là où il fallait
 * 6.
 *
 * Ce n'était pas un coefficient à retoucher : c'était une source de vérité en
 * trop. La direction de toutes les rampes se déduit maintenant du FOND seul —
 * un fond qui réclame du texte clair EST un thème sombre, quoi qu'on ait coché
 * ailleurs. L'écran continue de proposer « clair » et « sombre », mais ces
 * boutons posent un FOND ; ils ne déclarent plus une nature.
 *
 * ── AUCUN THÈME NE PEUT RENDRE L'APPLICATION ILLISIBLE ──────────────────────
 *
 * Chaque teinte de texte passe par `ensureContrast` avant d'être écrite. Un fond
 * ardoise avec un texte gris moyen n'est pas REFUSÉ — on ne dit pas non au goût
 * de quelqu'un — il est RAMENÉ jusqu'au rapport lisible, en gardant sa teinte
 * aussi longtemps que possible.
 */

import {
  BLACK,
  WHITE,
  contrastPole,
  ensureContrast,
  luminance,
  mix,
  parseHex,
  toHex,
  toRgba,
  type Rgb,
} from './color';

// ==================== Ce que l'utilisateur choisit ====================

/**
 * Le décor de fond — une image, éventuellement ANIMÉE.
 *
 * Elle est posée derrière l'application, pas dans un bloc : c'est une propriété
 * du thème, elle suit donc le thème quand on en change et disparaît avec lui.
 */
export interface CustomBackdrop {
  /** Une URL de données. Rien d'autre n'est accepté — voir `backdropImage.ts`. */
  image: string;
  /** De 0 (invisible) à 1 (pleine). Bornée à l'écriture ET à la lecture. */
  opacity: number;
  /** Flou, en pixels. Un décor net rend le texte illisible par-dessus. */
  blur: number;
}

/**
 * LE DÉCOR VIVANT — ce qui bouge derrière l'application.
 *
 * ── QUATRE, ET PAS UN DE PLUS ───────────────────────────────────────────────
 *
 *   · LUEUR — un halo qui suit le curseur. Le seul effet qui répond à ce qu'on
 *     fait, et de loin le plus agréable à l'usage.
 *   · CONSTELLATION — deux trames de points à des vitesses différentes. C'est
 *     la PARALLAXE qui donne la profondeur : une seule trame ne ferait qu'une
 *     image qui glisse.
 *   · AURORE — deux voiles teintés de l'accent, qui respirent lentement. Ne
 *     suit rien : c'est un fond d'ambiance.
 *   · HORLOGE — l'heure en très grand, très pâle, dans un coin.
 *
 * Ils se COMBINENT avec l'image : on peut avoir sa photo ET une lueur qui suit
 * la souris. Ce sont deux couches distinctes.
 *
 * ── AUCUN N'EST DÉCIDÉ PAR NOUS SEULS ───────────────────────────────────────
 *
 * Le réglage « Fond animé » des paramètres et le `prefers-reduced-motion` du
 * système les IMMOBILISENT tous les deux. Le décor ne disparaît pas — l'image,
 * la lueur et la trame restent — il cesse de bouger. Le mouvement de fond
 * continu déclenche des malaises chez une partie des gens, et ce n'est pas à
 * l'application d'en décider à leur place.
 */
export type LivingBackdrop = 'none' | 'glow' | 'constellation' | 'aurora' | 'clock';

const LIVING_BACKDROPS: readonly LivingBackdrop[] = [
  'none',
  'glow',
  'constellation',
  'aurora',
  'clock',
];

/**
 * LES RÉGLAGES D'APPARENCE QUI VOYAGENT AVEC LE THÈME.
 *
 * ── POURQUOI ILS SONT DANS LE THÈME, ET PAS À CÔTÉ ──────────────────────────
 *
 * Un « thème » n'est pas seulement une palette. Ce qu'on retient d'un espace de
 * travail, c'est l'ENSEMBLE : les couleurs, mais aussi la police, la façon dont
 * les barres s'effacent, si les panneaux de notes surgissent au survol. Quatre
 * réglages qui vivaient chacun dans son coin des paramètres et qu'il fallait
 * repositionner un par un après un changement de thème.
 *
 * ── CHAQUE CHAMP EST FACULTATIF, ET CE N'EST PAS UN DÉTAIL ──────────────────
 *
 * Un thème qui imposerait D'OFFICE ses quatre réglages écraserait des choix que
 * l'utilisateur a faits pour d'autres raisons que l'esthétique — quelqu'un qui
 * a mis les barres en mode « rail » l'a fait pour gagner de la place, pas pour
 * assortir des couleurs, et un thème installé ne doit pas le lui reprendre.
 *
 * Seul ce que l'auteur a EXPLICITEMENT inclus voyage. Le reste est `undefined`,
 * et `undefined` veut dire « ce thème n'a pas d'avis là-dessus » — pas
 * « remets la valeur par défaut ».
 */
export interface ThemeAppearance {
  /** Les panneaux de notes s'effacent et reviennent au bord de l'écran. */
  notesPanelsHover?: boolean;
  /** La couleur d'accentuation de l'interface. `null` = la palette d'origine. */
  accentColor?: string | null;
  /** L'identifiant de police (`inter`, `jakarta`…). */
  fontId?: string;
  /** Les barres qui encadrent les onglets. */
  barsMode?: string;
  /** Les thèmes vivants respirent, ou non. */
  animatedBackground?: boolean;
}

export interface CustomThemeSpec {
  /**
   * Le fond de page — et, par voie de conséquence, TOUT le reste : c'est lui
   * qui décide si le thème est clair ou sombre. Voir l'en-tête.
   */
  ground: string;
  /** La couleur d'action : boutons, liens, sélection, anneau de focus. */
  accent: string;
  /** Le texte principal. `null` ⇒ déduit du fond. */
  text?: string | null;
  backdrop?: CustomBackdrop | null;
  /** Ce qui bouge derrière l'application. Voir `LivingBackdrop`. */
  living?: LivingBackdrop;
  /** Ce que ce thème dit du RESTE de l'apparence. Voir `ThemeAppearance`. */
  appearance?: ThemeAppearance;
}

/** Le thème proposé quand on ouvre l'éditeur sans rien avoir composé. */
export const DEFAULT_CUSTOM_THEME: CustomThemeSpec = {
  ground: '#0f1115',
  accent: '#87ceeb',
  text: null,
  backdrop: null,
  living: 'none',
};

// ==================== Bornes ====================

/**
 * Le flou maximal, en pixels.
 *
 * 40 et non 200 : au-delà, l'image n'est plus qu'un aplat de couleur, et un
 * flou énorme sur une grande image coûte cher à composer À CHAQUE IMAGE d'une
 * animation. Un décor animé flouté à 200 px fait tomber le défilement.
 */
export const BACKDROP_MAX_BLUR = 40;

function clamp(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
}

// ==================== Lecture d'une valeur qui vient d'ailleurs ====================

/**
 * Remet en règle une valeur venue du stockage, d'un fichier ou du réseau.
 *
 * Tout ce qui n'est pas reconnu retombe sur le défaut, CHAMP PAR CHAMP : une
 * couleur illisible ne doit pas emporter le reste du thème. C'est la même
 * doctrine que `readEnumOption` pour les réglages de blocs — le repli fait foi.
 */
export function normalizeSpec(value: unknown): CustomThemeSpec {
  const raw = (value ?? {}) as Partial<Record<keyof CustomThemeSpec, unknown>>;
  const ground = parseHex(raw.ground as string);
  const accent = parseHex(raw.accent as string);
  const text = parseHex(raw.text as string);

  return {
    ground: ground ? toHex(ground) : DEFAULT_CUSTOM_THEME.ground,
    accent: accent ? toHex(accent) : DEFAULT_CUSTOM_THEME.accent,
    text: text ? toHex(text) : null,
    backdrop: normalizeBackdrop(raw.backdrop),
    living: (LIVING_BACKDROPS as readonly string[]).includes(raw.living as string)
      ? (raw.living as LivingBackdrop)
      : 'none',
    appearance: normalizeAppearance(raw.appearance),
  };
}

/** Les modes de barres reconnus. Recopiés depuis `uiSlice` À DESSEIN : ce module
 *  est PUR et ne doit rien importer du magasin, sous peine de le tirer dans le
 *  worker et dans les tests. Le test de garde confronte les deux listes. */
export const THEME_BARS_MODES: readonly string[] = [
  'all',
  'floating',
  'side',
  'autohide',
  'tabs-only',
  'search-only',
  'none',
];

/**
 * Remet en règle un bloc d'apparence reçu.
 *
 * ⚠ `undefined` et `false` ne veulent PAS dire la même chose, et c'est tout le
 * sujet. Un champ absent signifie « ce thème n'a pas d'avis » ; un champ à
 * `false` signifie « ce thème demande explicitement que ce soit éteint ». Un
 * `?? valeurParDéfaut` ici transformerait le premier en second, et un thème
 * installé reprendrait des réglages dont il n'a jamais parlé.
 */
function normalizeAppearance(value: unknown): ThemeAppearance | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const out: ThemeAppearance = {};

  if (typeof raw.notesPanelsHover === 'boolean') out.notesPanelsHover = raw.notesPanelsHover;
  if (typeof raw.animatedBackground === 'boolean') out.animatedBackground = raw.animatedBackground;
  if (raw.accentColor === null) out.accentColor = null;
  else {
    const accent = parseHex(raw.accentColor as string);
    if (accent) out.accentColor = toHex(accent);
  }
  // L'identifiant de police est écrêté et borné aux caractères d'un
  // identifiant : il finit dans une clé de stockage et dans un attribut.
  if (typeof raw.fontId === 'string' && /^[a-z0-9-]{1,32}$/.test(raw.fontId)) {
    out.fontId = raw.fontId;
  }
  if (typeof raw.barsMode === 'string' && THEME_BARS_MODES.includes(raw.barsMode)) {
    out.barsMode = raw.barsMode;
  }

  // Un bloc vide n'est pas un bloc : le rendre `undefined` évite un objet vide
  // dans le fichier publié, et fait dire la vérité à « ce thème n'a pas d'avis ».
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeBackdrop(value: unknown): CustomBackdrop | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<CustomBackdrop>;
  if (typeof raw.image !== 'string' || !raw.image.startsWith('data:image/')) return null;
  return {
    image: raw.image,
    // ⚠ Un test explicite du type, et non `raw.opacity || 1` : une opacité de
    // ZÉRO est un choix légitime (on éteint le décor sans le perdre), et `||`
    // l'aurait silencieusement remise à 1.
    opacity: clamp(typeof raw.opacity === 'number' ? raw.opacity : 1, 0, 1),
    blur: clamp(typeof raw.blur === 'number' ? raw.blur : 0, 0, BACKDROP_MAX_BLUR),
  };
}

// ==================== La dérivation ====================

/** Vers le blanc. */
const up = (c: Rgb, k: number): Rgb => mix(c, WHITE, k);
/** Vers le noir. */
const down = (c: Rgb, k: number): Rgb => mix(c, BLACK, k);

/**
 * Les rapports de contraste exigés, et pourquoi chacun vaut ce qu'il vaut.
 *
 *   · TEXTE PRINCIPAL — 7:1, le niveau AAA. C'est le texte qu'on lit pendant des
 *     heures ; viser le minimum légal donnerait un thème fatigant qui passe les
 *     tests.
 *   · TEXTE SECONDAIRE ET TERTIAIRE — 4,5:1, le niveau AA pour du texte courant.
 *     Ce sont des dates, des compteurs, des libellés : on doit pouvoir les LIRE,
 *     pas seulement deviner qu'il y a quelque chose.
 *   · TEXTE DÉSACTIVÉ — 3:1. Un contrôle désactivé DOIT se distinguer d'un
 *     contrôle actif ; le monter à 4,5 effacerait cette différence, qui est la
 *     seule information que ce texte porte.
 *   · CONTOURS ET ANNEAU DE FOCUS — 3:1, le seuil des éléments non textuels.
 *     L'anneau de focus est le seul repère de qui navigue au clavier.
 */
const AAA_TEXT = 7;
const AA_TEXT = 4.5;
const UI_MIN = 3;

/**
 * Les jetons d'un thème, prêts à être écrits sur `:root`.
 *
 * Les clés sont les noms de variables CSS — c'est ce que lit `applyCustomTheme`,
 * et c'est aussi ce que mesure le test de contraste.
 */
export type ThemeTokens = Record<string, string>;

/**
 * Ce fond réclame-t-il du texte CLAIR ? C'est la définition d'un thème sombre,
 * et c'est la seule qui ne peut pas se contredire avec le reste du thème.
 *
 * Exportée parce que l'écran s'en sert aussi : il annonce « sombre » ou
 * « clair » d'après ce que la dérivation va réellement faire, et non d'après un
 * bouton qu'on aurait coché.
 */
export function isDarkGround(ground: string): boolean {
  const rgb = parseHex(ground);
  return rgb ? contrastPole(rgb) === WHITE : true;
}

export function deriveThemeTokens(input: CustomThemeSpec): ThemeTokens {
  const spec = normalizeSpec(input);
  // `normalizeSpec` a déjà garanti que ces deux-là sont lisibles ; le repli
  // n'est là que pour satisfaire le typage sans un `!` qui mentirait.
  const ground = parseHex(spec.ground) ?? BLACK;
  const accent = parseHex(spec.accent) ?? WHITE;
  const dark = contrastPole(ground) === WHITE;
  /** La direction du texte, décidée UNE FOIS pour tout le thème. */
  const pole = dark ? WHITE : BLACK;

  // ---------- Les fonds ----------
  //
  // En SOMBRE, s'élever c'est s'éclaircir : une carte posée sur le fond doit
  // capter un peu de lumière. En CLAIR, c'est l'inverse pour les fonds RECULÉS
  // (bandeaux, colonnes latérales) — ils s'assombrissent d'un souffle — tandis
  // que les surfaces ÉLEVÉES vont vers le blanc. Un fond déjà blanc reste
  // blanc : le mélange sature, il ne déborde pas.
  const bgSecondary = dark ? up(ground, 0.035) : down(ground, 0.02);
  const bgTertiary = dark ? up(ground, 0.075) : down(ground, 0.045);
  const bgElevated = dark ? up(ground, 0.055) : up(ground, 0.6);
  const surface = dark ? up(ground, 0.04) : up(ground, 0.35);
  // ⚠ Survol et appui se calculent depuis la SURFACE et non depuis le fond :
  // sinon une surface très élevée en thème clair aurait un survol PLUS SOMBRE
  // qu'elle, et le bloc paraîtrait s'enfoncer au passage de la souris.
  const surfaceHover = dark ? up(surface, 0.045) : down(surface, 0.035);
  const surfaceActive = dark ? up(surface, 0.09) : down(surface, 0.07);

  // ---------- Le texte ----------
  //
  // ⚠ LE TEXTE NE SE MESURE PAS CONTRE LE FOND DE PAGE.
  //
  // Il se mesure contre le fond le PLUS DÉFAVORABLE parmi tous ceux sur
  // lesquels il sera posé. La première version réglait tout contre `ground`, et
  // le balayage a trouvé pourquoi c'est faux : les cartes vivent sur `surface`,
  // qui s'écarte du fond de quelques pour cent, et un texte tertiaire réglé
  // au ras des 4,5:1 contre le fond tombait à 3,98:1 sur une carte. Le thème
  // passait le contrôle et restait dur à lire là où on lit vraiment.
  //
  // Le pire fond, c'est celui dont la luminance est la PLUS PROCHE de celle du
  // texte : le plus clair en thème sombre, le plus sombre en thème clair.
  const surfaces = [
    ground,
    bgSecondary,
    bgTertiary,
    bgElevated,
    surface,
    surfaceHover,
    surfaceActive,
  ];
  const textBase = surfaces.reduce((worst, candidate) =>
    (dark ? luminance(candidate) > luminance(worst) : luminance(candidate) < luminance(worst))
      ? candidate
      : worst
  );

  // On adoucit le pôle d'un souffle vers le fond (du blanc pur sur du noir pur
  // « vibre ») puis on VÉRIFIE. Une couleur choisie par l'utilisateur suit
  // exactement le même chemin : on ne la refuse pas, on la ramène.
  const chosen = spec.text ? parseHex(spec.text) : null;
  const textPrimary = ensureContrast(
    chosen ?? mix(pole, ground, dark ? 0.1 : 0.18),
    textBase,
    AAA_TEXT,
    pole
  );
  const textSecondary = ensureContrast(mix(textPrimary, ground, 0.28), textBase, AA_TEXT, pole);
  const textTertiary = ensureContrast(mix(textPrimary, ground, 0.45), textBase, AA_TEXT, pole);
  const textDisabled = ensureContrast(mix(textPrimary, ground, 0.68), textBase, UI_MIN, pole);
  // Le texte posé SUR l'accent (l'intitulé d'un bouton plein). Il se mesure
  // contre l'ACCENT, jamais contre le fond de page — c'est l'erreur qui donne
  // des boutons dont on ne lit pas ce qui est écrit dessus.
  const textInverted = ensureContrast(contrastPole(accent), accent, AA_TEXT);

  // ---------- Les contours ----------
  //
  // Un contour est un mélange du fond vers le TEXTE, et non vers le blanc : sur
  // un thème clair, un contour tiré vers le blanc serait invisible.
  const border = mix(ground, textPrimary, 0.12);
  const borderLight = mix(ground, textPrimary, 0.07);
  const borderStrong = mix(ground, textPrimary, 0.22);

  // ---------- La rampe d'accent ----------
  //
  // Voir l'en-tête : elle se retourne en thème sombre, et ce retournement est la
  // condition pour que les liens restent lisibles.
  const ramp = dark
    ? {
        200: up(accent, 0.28),
        300: accent,
        400: down(accent, 0.15),
        500: down(accent, 0.28),
        600: down(accent, 0.15),
        700: up(accent, 0.28),
        800: up(accent, 0.5),
      }
    : {
        200: up(accent, 0.55),
        300: up(accent, 0.38),
        400: up(accent, 0.2),
        500: accent,
        600: down(accent, 0.18),
        700: down(accent, 0.35),
        800: down(accent, 0.5),
      };

  // Un lien est du TEXTE. Il se mesure donc comme du texte, et il est ramené
  // s'il ne passe pas — c'est le jeton le plus souvent illisible dans un thème
  // composé à la main, parce qu'on choisit son accent pour un bouton et qu'on
  // oublie qu'il sert aussi de couleur de lien.
  const link = ensureContrast(dark ? ramp[700] : ramp[600], textBase, AA_TEXT, pole);
  const linkHover = ensureContrast(dark ? ramp[800] : ramp[700], textBase, AA_TEXT, pole);
  const focusRing = ensureContrast(dark ? accent : ramp[400], textBase, UI_MIN, pole);

  // ---------- Les voiles ----------
  //
  // Toujours teintés de l'ACCENT et non d'un gris neutre : c'est ce qui fait
  // qu'un survol « appartient » au thème au lieu de le salir.
  const veil = (alpha: number): string => toRgba(accent, alpha);

  // ---------- Les aveux ----------
  //
  // Ambre et rouge, ramenés jusqu'à 4,5:1 CONTRE CE FOND. Les onze thèmes
  // livrés les redéfinissent à la main pour cette raison exacte : le barreau
  // -700 de la palette est lisible sur une pastille claire et tombe à 2,3:1 posé
  // à même un fond sombre. Un thème composé n'a personne pour faire cette
  // relecture — c'est donc la dérivation qui la fait.
  const warningOn = ensureContrast(parseHex('#f59e0b') ?? WHITE, textBase, AA_TEXT, pole);
  const errorOn = ensureContrast(parseHex('#ef4444') ?? WHITE, textBase, AA_TEXT, pole);
  // Le succes et l'info suivent la MEME regle depuis qu'ils ont, eux aussi, leur
  // jeton `-on-background` : les pastilles vertes et bleues employaient les
  // barreaux bruts -600 comme couleur de TEXTE, illisibles sur fond sombre. Un
  // theme compose n'a personne pour faire cette relecture a la main.
  const successOn = ensureContrast(parseHex('#10b981') ?? WHITE, textBase, AA_TEXT, pole);
  const infoOn = ensureContrast(parseHex('#3b82f6') ?? WHITE, textBase, AA_TEXT, pole);

  // Le voile des surmodales : tiré du fond en sombre, du texte en clair — dans
  // les deux cas, la chose la plus opaque du thème.
  const shroud = dark ? down(ground, 0.4) : down(textPrimary, 0.1);

  return {
    '--color-background': toHex(ground),
    '--color-background-secondary': toHex(bgSecondary),
    '--color-background-tertiary': toHex(bgTertiary),
    '--color-background-elevated': toHex(bgElevated),

    '--color-surface': toHex(surface),
    '--color-surface-hover': toHex(surfaceHover),
    '--color-surface-active': toHex(surfaceActive),

    // Les trois neutres bas servent de fonds de composants dans du code qui
    // date d'avant les jetons sémantiques. Les laisser à leur valeur d'origine
    // poserait des cartes BLANCHES au milieu d'un thème sombre.
    '--color-neutral-0': toHex(dark ? bgSecondary : ground),
    '--color-neutral-50': toHex(dark ? up(ground, 0.05) : bgSecondary),
    '--color-neutral-100': toHex(bgTertiary),

    '--color-border': toHex(border),
    '--color-border-light': toHex(borderLight),
    '--color-border-strong': toHex(borderStrong),

    '--color-text-primary': toHex(textPrimary),
    '--color-text-secondary': toHex(textSecondary),
    '--color-text-tertiary': toHex(textTertiary),
    '--color-text-disabled': toHex(textDisabled),
    '--color-text-inverted': toHex(textInverted),

    '--color-primary-50': veil(dark ? 0.1 : 0.07),
    '--color-primary-100': veil(dark ? 0.18 : 0.14),
    '--color-primary-200': toHex(ramp[200]),
    '--color-primary-300': toHex(ramp[300]),
    '--color-primary-400': toHex(ramp[400]),
    '--color-primary-500': toHex(ramp[500]),
    '--color-primary-600': toHex(ramp[600]),
    '--color-primary-700': toHex(ramp[700]),
    '--color-primary-800': toHex(ramp[800]),

    '--color-link': toHex(link),
    '--color-link-hover': toHex(linkHover),

    '--color-hover-overlay': veil(dark ? 0.1 : 0.06),
    '--color-active-overlay': veil(dark ? 0.18 : 0.12),
    '--color-focus-ring': toHex(focusRing),
    '--color-selected': veil(dark ? 0.14 : 0.08),
    '--color-selected-hover': veil(dark ? 0.22 : 0.14),
    '--color-selected-border': toRgba(up(accent, 0.28), 0.45),
    '--color-selection-bg': veil(dark ? 0.38 : 0.28),
    '--color-control-knob': toHex(textPrimary),

    '--color-overlay-light': toRgba(bgSecondary, 0.9),
    '--color-overlay-dark': toRgba(shroud, dark ? 0.85 : 0.45),
    '--color-backdrop': toRgba(shroud, dark ? 0.75 : 0.35),

    '--color-warning-on-background': toHex(warningOn),
    '--color-error-on-background': toHex(errorOn),
    '--color-success-on-background': toHex(successOn),
    '--color-info-on-background': toHex(infoOn),
  };
}
