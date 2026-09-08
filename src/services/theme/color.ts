/**
 * LES MATHÉMATIQUES DE COULEUR — le socle du thème sur mesure.
 *
 * ── POURQUOI CE MODULE EXISTE, ALORS QU'IL Y A DÉJÀ ONZE THÈMES ─────────────
 *
 * Les onze thèmes livrés sont écrits À LA MAIN, quarante-deux couleurs chacune,
 * et relues une par une. Un thème que l'utilisateur compose ne peut pas l'être :
 * il choisit un fond et un accent, et les quarante autres jetons doivent se
 * DÉDUIRE — sans quoi il faudrait lui demander quarante-deux couleurs, ce que
 * personne ne fera.
 *
 * Déduire, c'est prendre le risque de fabriquer du texte gris sur fond gris.
 * D'où ce module : il ne mélange pas seulement des couleurs, il sait MESURER le
 * contraste et RAMENER une teinte jusqu'à ce qu'elle soit lisible. C'est la
 * seule chose qui empêche un thème composé en trente secondes de rendre
 * l'application inutilisable.
 *
 * ── TOUT EST PUR ────────────────────────────────────────────────────────────
 *
 * Aucune lecture du DOM, aucun `getComputedStyle`. Les fonctions d'ici tournent
 * dans un test, dans le rendu d'un aperçu et à l'application du thème, et elles
 * doivent y donner exactement le même résultat.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Le blanc et le noir, nommés une fois — ce sont les deux pôles de tout. */
export const WHITE: Rgb = { r: 255, g: 255, b: 255 };
export const BLACK: Rgb = { r: 0, g: 0, b: 0 };

const HEX3 = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX6 = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/**
 * Lit une couleur écrite `#rgb` ou `#rrggbb`.
 *
 * Rend `null` plutôt que de lever : cette valeur vient d'un champ de saisie, du
 * stockage d'un profil ou d'un thème reçu d'ailleurs. Une couleur illisible
 * doit faire retomber l'appelant sur son repli, pas casser l'écran des
 * paramètres.
 */
export function parseHex(value: string | null | undefined): Rgb | null {
  if (typeof value !== 'string') return null;
  const short = HEX3.exec(value.trim());
  if (short) {
    return {
      r: parseInt(short[1] + short[1], 16),
      g: parseInt(short[2] + short[2], 16),
      b: parseInt(short[3] + short[3], 16),
    };
  }
  const long = HEX6.exec(value.trim());
  if (!long) return null;
  return {
    r: parseInt(long[1], 16),
    g: parseInt(long[2], 16),
    b: parseInt(long[3], 16),
  };
}

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/** La couleur telle qu'elle sera ÉCRITE : canaux entiers, bornés. */
export function round(c: Rgb): Rgb {
  return { r: clamp255(c.r), g: clamp255(c.g), b: clamp255(c.b) };
}

/** Écrit une couleur en `#rrggbb`, toujours en minuscules et sur six chiffres. */
export function toHex({ r, g, b }: Rgb): string {
  const part = (n: number): string => clamp255(n).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** Écrit une couleur avec transparence. `alpha` est ramené dans [0, 1]. */
export function toRgba(c: Rgb, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  // Trois décimales : au-delà, on n'écrit que du bruit dans la feuille de style.
  return `rgba(${clamp255(c.r)}, ${clamp255(c.g)}, ${clamp255(c.b)}, ${Number(a.toFixed(3))})`;
}

/**
 * La luminance relative, au sens de WCAG 2.
 *
 * ⚠ La linéarisation n'est PAS un simple `/255`. Un canal sRGB est encodé avec
 * une courbe (gamma) ; comparer les valeurs brutes donnerait des ratios faux
 * d'un facteur deux dans les tons moyens — c'est-à-dire précisément là où on a
 * besoin de savoir si un gris passe ou non.
 */
export function luminance(c: Rgb): number {
  const channel = (v: number): number => {
    const s = Math.max(0, Math.min(255, v)) / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** Le rapport de contraste entre deux couleurs OPAQUES. De 1 à 21. */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Mélange linéaire de `a` vers `b`. `t = 0` rend `a`, `t = 1` rend `b`.
 *
 * Le mélange se fait sur les canaux BRUTS et non linéarisés, volontairement :
 * c'est ce que fait `color-mix` en sRGB et ce que font les palettes écrites à la
 * main. Mélanger en linéaire donnerait des tons intermédiaires plus clairs que
 * ceux des onze thèmes livrés, et le thème sur mesure ne leur ressemblerait plus.
 */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.max(0, Math.min(1, t));
  return {
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
  };
}

/**
 * Le pôle qui CONTRASTE le plus avec une couleur : blanc ou noir.
 *
 * C'est la décision « ce fond veut-il du texte clair ou du texte sombre ? », et
 * elle ne se prend pas au seuil naïf de 50 % de luminance : la courbe sRGB fait
 * qu'un fond à mi-chemin visuellement a une luminance d'environ 0,21. On compare
 * donc les deux contrastes réels.
 */
export function contrastPole(background: Rgb): Rgb {
  return contrast(background, WHITE) >= contrast(background, BLACK) ? WHITE : BLACK;
}

/**
 * RAMÈNE une teinte jusqu'à ce qu'elle contraste assez avec son fond.
 *
 * ── C'EST LA FONCTION QUI REND LE THÈME SUR MESURE POSSIBLE ─────────────────
 *
 * Sans elle, « fond ardoise, texte gris moyen » produit une application dont on
 * ne lit plus rien, et l'utilisateur ne comprend pas ce qu'il a fait de mal. On
 * ne REFUSE donc pas son choix : on le pousse, par pas réguliers, vers le pôle
 * qui contraste — sa teinte est conservée aussi longtemps que possible, et elle
 * ne finit blanche ou noire que si rien d'autre ne passe.
 *
 * On avance vers un PÔLE — blanc ou noir —, jamais vers le pôle de la teinte
 * elle-même : pousser un gris moyen vers le noir sur un fond noir l'enfoncerait
 * au lieu de le sortir.
 *
 * ── LE PÔLE SE PASSE, IL NE SE DEVINE PAS ───────────────────────────────────
 *
 * Par défaut on le déduit du fond, ce qui suffit pour un appel isolé. Mais un
 * THÈME pose son texte sur sept fonds voisins, et deux fonds voisins peuvent
 * ne pas être d'accord : sur un gris moyen, un fond répond « texte noir » et
 * celui d'à côté « texte blanc ». Le balayage a trouvé exactement ce cas — le
 * texte principal partait vers le noir puis se faisait renvoyer vers le blanc
 * par un autre fond, et finissait à 3,94:1 sur la page.
 *
 * Un thème décide donc UNE FOIS s'il porte du texte clair ou sombre, et passe
 * ce pôle à chaque appel. La réparation ne déplace plus que le long d'un axe
 * choisi, jamais en travers.
 *
 * @param target rapport visé (4,5 pour du texte courant, 3 pour un contour).
 * @param pole   direction imposée. Absent ⇒ déduite du fond.
 */
export function ensureContrast(color: Rgb, background: Rgb, target: number, pole?: Rgb): Rgb {
  /**
   * ⚠ ON MESURE LA COULEUR TELLE QU'ELLE SERA ÉCRITE, ARRONDIE.
   *
   * `mix` travaille en virgule flottante ; `toHex` arrondit au canal entier.
   * Sans cette quantification, la boucle s'arrêtait sur un candidat à 4,502:1
   * dont l'écriture hexadécimale valait 4,49:1 — la garantie tombait d'un
   * centième, dans le rendu et nulle part ailleurs. Le balayage l'a trouvé sur
   * un seul couple parmi trois mille (gris moyen, accent bleu ciel).
   */
  const solid = round(color);
  if (contrast(solid, background) >= target) return solid;

  const towards = pole ?? contrastPole(background);
  // Cinquante pas : le pas vaut 2 % du chemin vers le pôle, soit une différence
  // invisible entre deux essais successifs. Chercher par dichotomie donnerait
  // le même résultat en moins de tours, mais le mélange n'est pas monotone en
  // contraste sur toutes les teintes, et une dichotomie sur une fonction non
  // monotone rend un point qui n'est pas le premier acceptable.
  for (let step = 1; step <= 50; step += 1) {
    const candidate = round(mix(solid, towards, step / 50));
    if (contrast(candidate, background) >= target) return candidate;
  }

  // Le pôle lui-même ne suffit pas : le fond est à mi-chemin exact, aucun texte
  // n'y atteint le rapport demandé. On rend le meilleur possible plutôt que la
  // couleur d'origine — l'appelant a demandé « le plus lisible que tu peux ».
  return towards;
}

/**
 * Un fond peut-il porter du texte à ce rapport, dans le meilleur des cas ?
 *
 * Sert à AVERTIR au moment du choix, pas à refuser. Un fond gris moyen plafonne
 * autour de 4,6:1 même en blanc pur : on peut composer avec, mais il faut le
 * dire avant que la personne s'installe dedans.
 */
export function bestPossibleContrast(background: Rgb): number {
  return Math.max(contrast(background, WHITE), contrast(background, BLACK));
}
