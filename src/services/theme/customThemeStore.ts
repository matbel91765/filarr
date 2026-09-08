/**
 * POSER, RETIRER ET RETENIR UN THÈME SUR MESURE.
 *
 * ── LE PIÈGE CENTRAL : UN STYLE EN LIGNE NE S'EFFACE PAS TOUT SEUL ──────────
 *
 * Les jetons d'un thème composé sont écrits EN STYLE EN LIGNE sur `:root`. Il
 * le faut : c'est le seul moyen de battre les onze blocs `[data-theme='…']` de
 * la feuille de style sans en écrire un douzième.
 *
 * Mais un style en ligne bat AUSSI le thème suivant. Choisir « Minuit » après
 * un thème composé changerait l'attribut `data-theme` sans rien changer à
 * l'écran : les quarante-deux propriétés en ligne resteraient là, plus fortes
 * que tout, et l'utilisateur verrait son ancien thème refuser de partir.
 *
 * D'où `unapplyCustomTheme`, et surtout : c'est `applyCustomTheme` qui l'appelle
 * en premier. Poser un thème n'ajoute jamais par-dessus les restes du précédent.
 *
 * ── LE DÉCOR NE PASSE PAS PAR UNE VARIABLE DE COULEUR ───────────────────────
 *
 * L'image de fond est posée sur un élément DÉDIÉ, derrière l'application, et
 * non en `background-image` de `<body>`. Deux raisons, et la seconde est la
 * vraie : le flou. `filter: blur()` sur le corps de page flouterait TOUT, texte
 * compris ; il faut donc une couche à soi qu'on peut flouter seule.
 */

import * as profileStorage from '../core/profileStorage';

import { mountBackdrop, unmountBackdrop } from './backdropLayer';
import { deriveThemeTokens, normalizeSpec, type CustomThemeSpec } from './customTheme';

/** La clé de stockage. Par PROFIL — deux profils du même appareil ne partagent
 *  pas leurs couleurs, pas plus qu'ils ne partagent leurs coffres. */
const STORAGE_KEY = 'filarr.theme.custom';

/**
 * Les propriétés actuellement posées en ligne.
 *
 * ⚠ On ne se contente PAS de retirer les clés qu'on connaît : on retient ce
 * qu'on a écrit. Un thème composé sur une version future pourrait poser un
 * jeton de plus ; retirer « la liste d'aujourd'hui » laisserait le nouveau
 * jeton collé sur `:root` pour le reste de la session.
 */
let applied: string[] = [];

// ==================== Poser ====================

export function applyCustomTheme(spec: CustomThemeSpec): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  // TOUJOURS en premier : voir l'en-tête.
  unapplyCustomTheme();

  const safe = normalizeSpec(spec);
  const tokens = deriveThemeTokens(safe);
  for (const [name, value] of Object.entries(tokens)) {
    root.style.setProperty(name, value);
  }
  applied = Object.keys(tokens);
  root.setAttribute('data-theme', 'custom');

  // Le décor vit dans son propre module : il a des écouteurs et un minuteur à
  // démonter, ce qui n'a rien à voir avec la comptabilité des jetons.
  mountBackdrop({
    image: safe.backdrop ?? null,
    living: safe.living ?? 'none',
    language: typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'fr',
  });
}

/**
 * Retire tout ce qu'un thème composé avait posé.
 *
 * À appeler avant de poser N'IMPORTE QUEL autre thème. Le `data-theme` n'est
 * pas touché ici : c'est l'appelant qui sait vers quel thème il va, et écrire
 * un `data-theme` intermédiaire ferait clignoter l'écran.
 */
export function unapplyCustomTheme(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const name of applied) root.style.removeProperty(name);
  applied = [];
  unmountBackdrop();
}

// ==================== Retenir ====================

/**
 * Le thème composé de ce profil, ou `null` s'il n'y en a jamais eu.
 *
 * Une valeur illisible est traitée comme une absence : mieux vaut ouvrir sur le
 * thème par défaut que sur un écran à moitié coloré.
 */
export function loadCustomTheme(): CustomThemeSpec | null {
  try {
    const raw = profileStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeSpec(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Retient le thème, et DIT si l'écriture a réussi.
 *
 * ⚠ Ce booléen n'est pas décoratif : c'était un défaut réel.
 *
 * La première version avalait l'échec en silence. Un décor de deux mégaoctets
 * fait sauter le quota du stockage local (cinq mégaoctets pour TOUT le profil,
 * et une URL de données pèse un tiers de plus que le fichier) : le thème
 * s'appliquait à l'écran, l'écran disait « appliqué », et il avait disparu au
 * redémarrage suivant. Sans le moindre message.
 *
 * On rend donc l'échec, et l'appelant le dit.
 */
export function saveCustomTheme(spec: CustomThemeSpec): boolean {
  try {
    profileStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeSpec(spec)));
    return true;
  } catch {
    return false;
  }
}

export function clearCustomTheme(): void {
  try {
    profileStorage.removeItem(STORAGE_KEY);
  } catch {
    /* rien à faire de plus */
  }
}
