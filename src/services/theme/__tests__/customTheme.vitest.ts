/**
 * LE THÈME SUR MESURE — ce qu'aucune combinaison de couleurs ne doit produire.
 *
 * Un thème livré est relu par un humain avant d'exister. Un thème composé, non :
 * il naît d'un clic sur une pastille de couleur, et il est appliqué à tout
 * l'écran dans la seconde. Les deux garanties ci-dessous remplacent cette
 * relecture.
 *
 *   1. LISIBILITÉ — aucun couple (fond, accent, texte), même absurde, ne peut
 *      produire du texte qu'on ne lit pas. On ne l'éprouve pas sur trois cas
 *      choisis : on balaie des centaines de combinaisons, y compris les pires
 *      (gris moyen sur gris moyen, où même le blanc pur plafonne à 4,6:1).
 *
 *   2. COMPLÉTUDE — la dérivation écrit TOUS les jetons qu'un thème doit
 *      définir. Et ce n'est pas une liste recopiée dans ce fichier, qui aurait
 *      dérivé au premier jeton ajouté : elle est LUE dans `colors.css`, sur un
 *      thème livré, qui est l'autorité. Ajouter un `--color-` à un thème sans
 *      l'ajouter à la dérivation fait donc échouer ce test.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { contrast, parseHex, type Rgb } from '../color';
import {
  BACKDROP_MAX_BLUR,
  THEME_BARS_MODES,
  DEFAULT_CUSTOM_THEME,
  deriveThemeTokens,
  normalizeSpec,
  type CustomThemeSpec,
} from '../customTheme';

// ==================== Outils ====================

/** Les jetons que définit un thème LIVRÉ — l'autorité, pas une copie. */
function tokensOfBuiltInTheme(name: string): Set<string> {
  const css = readFileSync(
    path.join(__dirname, '..', '..', '..', 'renderer', 'styles', 'tokens', 'colors.css'),
    'utf-8'
  );
  const block = new RegExp(`\\[data-theme='${name}'\\]\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css);
  if (!block) throw new Error(`thème « ${name} » introuvable dans colors.css`);
  return new Set([...block[1].matchAll(/(--color-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
}

/**
 * Lit une couleur de jeton, opaque ou non.
 *
 * Un `rgba()` est APLATI sur son fond avant mesure : mesurer le contraste d'une
 * couleur translucide contre le fond sans la composer d'abord donne un chiffre
 * qui ne correspond à rien de ce qu'on voit à l'écran.
 */
function readToken(value: string, over: Rgb): Rgb | null {
  const hex = parseHex(value);
  if (hex) return hex;
  const rgba = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(value);
  if (!rgba) return null;
  const a = rgba[4] === undefined ? 1 : parseFloat(rgba[4]);
  const c = { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]) };
  return {
    r: c.r * a + over.r * (1 - a),
    g: c.g * a + over.g * (1 - a),
    b: c.b * a + over.b * (1 - a),
  };
}

/**
 * Un large balayage de fonds et d'accents.
 *
 * Les gris moyens y sont VOLONTAIREMENT présents : c'est le cas où aucune
 * couleur de texte n'atteint 7:1, et donc celui où une dérivation naïve rend
 * l'application inutilisable.
 */
const GROUNDS = [
  '#000000',
  '#0f1115',
  '#1a1d33',
  '#2d2d2d',
  '#404040',
  '#555555',
  '#6b6b6b',
  '#7f7f7f',
  '#8a8a8a',
  '#999999',
  '#b3b3b3',
  '#d4d4d4',
  '#f5f5f5',
  '#ffffff',
  '#0b1d2a',
  '#2b0f1a',
  '#12240f',
  '#3a2f0b',
  '#4a1f6b',
  '#083344',
  '#fef3c7',
  '#fee2e2',
  '#e0f2fe',
  '#1e293b',
  '#78350f',
  '#365314',
];

const ACCENTS = [
  '#87ceeb',
  '#8b5cf6',
  '#ef4444',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#000000',
  '#ffffff',
  '#808080',
  '#1e40af',
  '#facc15',
  '#065f46',
];

/** Les jetons de TEXTE et le fond contre lequel chacun se mesure vraiment. */
const TEXT_TOKENS: readonly { token: string; over: string; min: number }[] = [
  { token: '--color-text-primary', over: '--color-background', min: 7 },
  { token: '--color-text-secondary', over: '--color-background', min: 4.5 },
  { token: '--color-text-tertiary', over: '--color-background', min: 4.5 },
  { token: '--color-link', over: '--color-background', min: 4.5 },
  { token: '--color-link-hover', over: '--color-background', min: 4.5 },
  { token: '--color-warning-on-background', over: '--color-background', min: 4.5 },
  { token: '--color-error-on-background', over: '--color-background', min: 4.5 },
  // Les mêmes textes, posés sur une SURFACE et non sur le fond. C'est là que
  // vivent les cartes, et une surface s'écarte du fond : un texte réglé pour
  // le fond seul peut y perdre un demi-point de contraste.
  { token: '--color-text-primary', over: '--color-surface', min: 6 },
  { token: '--color-text-secondary', over: '--color-surface', min: 4 },
  { token: '--color-text-tertiary', over: '--color-surface', min: 4 },
];

// ==================== 1. Lisibilité ====================

describe('deriveThemeTokens — aucun thème ne peut être illisible', () => {
  it('LA GARDE : tout couple (fond, accent) rend du texte lisible', () => {
    let checked = 0;
    for (const ground of GROUNDS) {
      for (const accent of ACCENTS) {
        {
          const tokens = deriveThemeTokens({ ground, accent });
          for (const { token, over, min } of TEXT_TOKENS) {
            const bg = readToken(tokens[over], { r: 128, g: 128, b: 128 });
            const fg = readToken(tokens[token], bg ?? { r: 128, g: 128, b: 128 });
            expect(bg, `${token} sur ${over}`).not.toBeNull();
            expect(fg, token).not.toBeNull();
            if (!bg || !fg) continue;

            const ratio = contrast(fg, bg);
            // Le plafond physique du fond : un gris moyen ne peut PAS porter du
            // texte à 7:1, même en blanc pur. On exige alors le meilleur
            // possible, pas l'impossible — mais on exige qu'on soit ALLÉ le
            // chercher, à un cheveu près (les mélanges arrondissent au canal).
            const ceiling = Math.max(
              contrast({ r: 255, g: 255, b: 255 }, bg),
              contrast({ r: 0, g: 0, b: 0 }, bg)
            );
            expect(
              ratio >= Math.min(min, ceiling - 0.01),
              `${ground}/${accent} — ${token} sur ${over} = ${ratio.toFixed(2)}:1 (visé ${min}, plafond ${ceiling.toFixed(2)})`
            ).toBe(true);
            checked += 1;
          }
        }
      }
    }
    // Le balayage doit avoir eu lieu : une boucle vide passerait sans rien dire.
    expect(checked).toBeGreaterThan(2500);
  });

  it('une couleur de texte CHOISIE est respectée quand elle est lisible', () => {
    // On ne ramène que ce qui ne passe pas. Un ivoire sur du bleu nuit doit
    // rester exactement l'ivoire demandé, sinon l'éditeur « corrige » un choix
    // parfaitement valable et personne ne comprend ce qui se passe.
    const tokens = deriveThemeTokens({
      ground: '#0b1020',
      accent: '#d4af37',
      text: '#f3ead3',
    });
    expect(tokens['--color-text-primary']).toBe('#f3ead3');
  });

  it('une couleur de texte ILLISIBLE est ramenée, pas refusée', () => {
    // Gris moyen sur presque noir : 3,4:1, très en dessous du seuil. La teinte
    // doit être poussée vers le clair jusqu'à passer.
    const ground = parseHex('#0b1020');
    const tokens = deriveThemeTokens({
      ground: '#0b1020',
      accent: '#87ceeb',
      text: '#555555',
    });
    const got = parseHex(tokens['--color-text-primary']);
    expect(got).not.toBeNull();
    expect(got).not.toEqual(parseHex('#555555'));
    if (ground && got) expect(contrast(got, ground)).toBeGreaterThanOrEqual(7);
  });

  it('le texte posé sur l’accent se mesure contre l’ACCENT', () => {
    // Un accent jaune vif avec du texte blanc dessus, c'est un bouton dont on
    // ne lit pas l'intitulé. L'erreur consiste à mesurer ce texte contre le
    // fond de page, où le blanc passe très bien.
    const accent = parseHex('#facc15');
    const tokens = deriveThemeTokens({
      ground: '#0b1020',
      accent: '#facc15',
    });
    const inverted = parseHex(tokens['--color-text-inverted']);
    expect(accent).not.toBeNull();
    expect(inverted).not.toBeNull();
    if (accent && inverted) expect(contrast(inverted, accent)).toBeGreaterThanOrEqual(4.5);
  });
});

// ==================== 2. Complétude ====================

describe('deriveThemeTokens — tous les jetons, confrontés à colors.css', () => {
  it('LA GARDE : rien de ce qu’un thème livré définit ne manque', () => {
    // « space » est l'un des thèmes COMPLETS (42 jetons). Le confronter à la
    // dérivation est la seule façon de s'apercevoir qu'un jeton ajouté aux
    // thèmes n'a pas été ajouté ici — auquel cas le thème composé hériterait
    // silencieusement de la valeur du thème précédent.
    const expected = tokensOfBuiltInTheme('space');
    const produced = new Set(Object.keys(deriveThemeTokens(DEFAULT_CUSTOM_THEME)));

    const missing = [...expected].filter((k) => !produced.has(k));
    expect(missing, `jetons définis par « space » et absents de la dérivation`).toEqual([]);
  });

  it('aucun jeton ne vaut une chaîne vide ou « undefined »', () => {
    // Une variable CSS posée à `undefined` n'est pas une erreur : le navigateur
    // l'accepte, la propriété devient invalide, et l'élément retombe sur sa
    // couleur héritée. C'est-à-dire un défaut invisible à la relecture.
    for (const [key, value] of Object.entries(deriveThemeTokens(DEFAULT_CUSTOM_THEME))) {
      expect(value, key).toMatch(/^(#[0-9a-f]{6}|rgba\()/);
    }
  });

  it('la même entrée donne exactement la même sortie', () => {
    // La dérivation est appelée au rendu de l'aperçu, à l'application et au
    // test. Une seule source d'aléa (un `Math.random` de repli, un ordre de clé
    // instable) ferait un aperçu qui ne montre pas ce qui sera appliqué.
    const spec: CustomThemeSpec = { ground: '#fffaf0', accent: '#b45309' };
    expect(deriveThemeTokens(spec)).toEqual(deriveThemeTokens(spec));
  });
});

// ==================== 3. Ce qui vient d'ailleurs ====================

describe('normalizeSpec — une valeur reçue ne peut pas casser le thème', () => {
  it('un objet vide donne le thème par défaut', () => {
    expect(normalizeSpec({})).toEqual(DEFAULT_CUSTOM_THEME);
  });

  it('les valeurs illisibles retombent CHAMP PAR CHAMP', () => {
    // Un accent invalide ne doit pas emporter le fond avec lui : on répare ce
    // qui est cassé, on garde ce qui tient.
    const spec = normalizeSpec({ ground: '#123456', accent: 'bleu ciel' });
    expect(spec.ground).toBe('#123456');
    expect(spec.accent).toBe(DEFAULT_CUSTOM_THEME.accent);
  });

  it('la notation courte est acceptée et développée', () => {
    expect(normalizeSpec({ ground: '#abc' }).ground).toBe('#aabbcc');
  });

  it('un décor qui n’est pas une URL de données est REFUSÉ', () => {
    // Une URL distante ferait sortir une requête de l'application au moment
    // d'appliquer un thème — y compris un thème reçu de quelqu'un d'autre, ce
    // qui suffirait à révéler une adresse IP à qui l'a composé.
    for (const image of ['https://exemple.test/a.gif', 'file:///c:/x.png', 'javascript:0', '']) {
      expect(
        normalizeSpec({ backdrop: { image, opacity: 1, blur: 0 } }).backdrop,
        image
      ).toBeNull();
    }
  });

  it('une opacité de ZÉRO survit — c’est un choix, pas une absence', () => {
    // Le piège de `raw.opacity || 1` : éteindre le décor sans le supprimer est
    // exactement ce qu'on fait quand on hésite, et la valeur serait remontée à
    // 1 sous les doigts.
    const spec = normalizeSpec({
      backdrop: { image: 'data:image/gif;base64,AAAA', opacity: 0, blur: 0 },
    });
    expect(spec.backdrop?.opacity).toBe(0);
  });

  it('le flou est borné', () => {
    const spec = normalizeSpec({
      backdrop: { image: 'data:image/gif;base64,AAAA', opacity: 1, blur: 9999 },
    });
    expect(spec.backdrop?.blur).toBe(BACKDROP_MAX_BLUR);
  });
});

// ==================== 4. Les réglages d'apparence ====================

describe("le bloc d'apparence — ce qu'un thème dit du RESTE de l'écran", () => {
  it('LA GARDE : « absent » et « éteint » ne se confondent JAMAIS', () => {
    /**
     * C'est l'invariant qui protège les choix de l'utilisateur.
     *
     * Un champ ABSENT veut dire « ce thème n'a pas d'avis là-dessus » ; un
     * champ à `false` veut dire « ce thème demande explicitement que ce soit
     * éteint ». Un `?? défaut` dans la normalisation transformerait le premier
     * en second — et un thème installé reprendrait des réglages dont il n'a
     * jamais parlé, comme le mode des barres que quelqu'un a choisi pour
     * gagner de la place et non pour assortir des couleurs.
     */
    const sansAvis = normalizeSpec({ ground: '#101418', accent: '#87ceeb' });
    expect(sansAvis.appearance).toBeUndefined();

    const eteint = normalizeSpec({
      ground: '#101418',
      accent: '#87ceeb',
      appearance: { notesPanelsHover: false },
    });
    expect(eteint.appearance).toEqual({ notesPanelsHover: false });
  });

  it('un bloc VIDE ne devient pas un bloc', () => {
    // Sinon le fichier publié porterait un objet vide qui dit « j'ai un avis »
    // là où il n'y en a aucun.
    expect(normalizeSpec({ ground: '#101418', appearance: {} }).appearance).toBeUndefined();
    expect(
      normalizeSpec({ ground: '#101418', appearance: { barsMode: 'inventé' } }).appearance
    ).toBeUndefined();
  });

  it('`accentColor: null` SURVIT — c’est « remets la palette d’origine »', () => {
    // `null` est une valeur, pas une absence : le distinguer d'`undefined` est
    // la seule façon d'exprimer « ce thème veut l'accent par défaut ».
    const spec = normalizeSpec({ ground: '#101418', appearance: { accentColor: null } });
    expect(spec.appearance).toEqual({ accentColor: null });
  });

  it('une couleur d’accent illisible est ÉCARTÉE, pas remplacée', () => {
    expect(
      normalizeSpec({ ground: '#101418', appearance: { accentColor: 'bleu' } }).appearance
    ).toBeUndefined();
  });

  it('un identifiant de police hors-format est refusé', () => {
    // Il finit dans une clé de stockage et dans un attribut du document.
    for (const fontId of ['../evil', 'a'.repeat(40), 'Inter Bold', '<script>']) {
      expect(
        normalizeSpec({ ground: '#101418', appearance: { fontId } }).appearance,
        fontId
      ).toBeUndefined();
    }
    expect(
      normalizeSpec({ ground: '#101418', appearance: { fontId: 'jakarta' } }).appearance
    ).toEqual({ fontId: 'jakarta' });
  });

  it('LA SECONDE GARDE : les modes de barres sont ceux du magasin', () => {
    /**
     * `THEME_BARS_MODES` est une COPIE de l'union `BarsMode` d'`uiSlice` —
     * délibérée, parce que ce module est pur et ne doit rien tirer du magasin.
     * Une copie qui diverge accepterait un mode que l'écran ne sait pas rendre,
     * ou refuserait un mode parfaitement valide.
     *
     * On confronte donc à L'AUTORITÉ : le fichier source de l'union.
     */
    const source = readFileSync(
      path.join(__dirname, '..', '..', '..', 'store', 'slices', 'uiSlice.ts'),
      'utf-8'
    );
    const bloc = /export type BarsMode =([\s\S]*?);/.exec(source);
    expect(bloc, 'union BarsMode introuvable dans uiSlice').not.toBeNull();

    const attendus = [...(bloc?.[1] ?? '').matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
    expect(attendus.length).toBeGreaterThan(3);
    expect([...THEME_BARS_MODES].sort()).toEqual([...attendus].sort());
  });
});
