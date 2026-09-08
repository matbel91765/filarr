/**
 * LES POLICES DE L'APPLICATION — une seule liste, un seul poseur.
 *
 * ── POURQUOI CE MODULE EXISTE ───────────────────────────────────────────────
 *
 * La liste était écrite DEUX fois : une table `fontMap` dans `App.tsx` pour la
 * restauration au démarrage, et un tableau `FONT_OPTIONS` dans l'écran des
 * paramètres pour le choix. Deux tables pour une seule idée, avec les mêmes
 * neuf identifiants et les mêmes neuf piles de repli, recopiées à la main.
 *
 * Elles coïncidaient encore — vérifié avant d'écrire ce fichier. Mais l'arrivée
 * d'une troisième lecture (un thème qui emporte sa police) allait faire une
 * TROISIÈME copie, et c'est le moment où ce genre de duplication se met à
 * diverger : on ajoute une police dans les paramètres, elle ne se restaure pas
 * au démarrage, et le symptôme — « ma police revient à Inter à chaque
 * ouverture » — ne désigne aucun des deux fichiers.
 *
 * ── LA PILE DE REPLI FAIT PARTIE DU CHOIX ───────────────────────────────────
 *
 * Chaque entrée porte la déclaration COMPLÈTE, avec ses replis. Une police
 * nommée seule (« Geist ») s'effondre sur le sérif du navigateur là où elle
 * n'est pas installée — ce qui arrive sur toute machine qui n'a pas ouvert la
 * feuille de Google Fonts, et sur le bureau hors ligne.
 */

export interface AppFont {
  /** L'identifiant retenu dans le stockage et dans un thème. */
  id: string;
  /** Le nom montré à l'utilisateur. */
  label: string;
  /** La déclaration CSS complète, replis compris. */
  stack: string;
}

export const APP_FONTS: readonly AppFont[] = [
  {
    id: 'inter',
    label: 'Inter',
    stack: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  {
    id: 'system',
    label: 'System',
    stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', sans-serif",
  },
  { id: 'geist', label: 'Geist', stack: "'Geist', 'Inter', -apple-system, sans-serif" },
  {
    id: 'mono',
    label: 'JetBrains Mono',
    stack: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  },
  { id: 'georgia', label: 'Georgia', stack: "'Georgia', 'Times New Roman', serif" },
  { id: 'nunito', label: 'Nunito', stack: "'Nunito', 'Inter', -apple-system, sans-serif" },
  {
    id: 'space-grotesk',
    label: 'Space Grotesk',
    stack: "'Space Grotesk', 'Inter', -apple-system, sans-serif",
  },
  {
    id: 'atkinson',
    label: 'Atkinson Hyperlegible',
    stack: "'Atkinson Hyperlegible', 'Inter', -apple-system, sans-serif",
  },
  {
    id: 'jakarta',
    label: 'Plus Jakarta Sans',
    stack: "'Plus Jakarta Sans', 'Inter', -apple-system, sans-serif",
  },
];

/** La clé de stockage. Partagée entre fenêtres de même origine (mode réduit). */
export const APP_FONT_KEY = 'filarr-font';

/** LE VOCABULAIRE, tel quel — l'unique autorité sur « cet identifiant existe-t-il ? ». */
export const APP_FONT_IDS: readonly string[] = APP_FONTS.map((font) => font.id);

/** La police de repli quand rien de valide n'est enregistré. */
export const DEFAULT_APP_FONT_ID = 'inter';

export function findAppFont(id: string | null | undefined): AppFont | null {
  if (!id) return null;
  return APP_FONTS.find((font) => font.id === id) ?? null;
}

export function isAppFontId(id: unknown): id is string {
  return typeof id === 'string' && APP_FONT_IDS.includes(id);
}

/**
 * L'identifiant de police À ÉCRIRE DANS UN DOCUMENT — validé, jamais brut.
 *
 * ── LE DÉFAUT QUE CECI FERME ────────────────────────────────────────────────
 *
 * L'export d'une disposition et l'assistant de publication lisaient
 * `localStorage.getItem('filarr-font') ?? 'inter'` : le `??` ne couvre QUE
 * l'absence, pas une valeur présente et inconnue. Or ce stockage est partagé
 * entre fenêtres de même origine, survit aux mises à jour, et peut porter
 * l'identifiant d'une police retirée depuis — ou d'une version plus récente.
 *
 * Cette chaîne partait alors telle quelle dans le fichier de disposition, était
 * validée par `layoutValidator` comme un simple texte (il vérifie une longueur,
 * pas une appartenance), puis ré-écrite dans le stockage de celui qui importe.
 * `applyAppFont` la refusait ensuite en silence — c'est sa règle, et elle est
 * bonne : elle ne remet pas Inter sous les yeux de quelqu'un. Résultat : le
 * stockage annonçait une police que l'application n'avait pas posée, et le
 * suivant qui exportait propageait l'identifiant mort à son tour.
 *
 * Un repli est donc INDISPENSABLE ICI, là où `applyAppFont` n'en veut pas : on
 * n'écrit pas un document sur une valeur qu'on sait fausse.
 */
export function resolveAppFontId(
  raw: string | null | undefined,
  fallback: string = DEFAULT_APP_FONT_ID
): string {
  return isAppFontId(raw) ? raw : fallback;
}

/**
 * La police en vigueur, VALIDÉE — ce qu'un export doit inscrire.
 *
 * Un stockage refusé (navigation privée, politique d'entreprise) rend le repli
 * plutôt que de faire échouer l'export : la police est un détail du document,
 * pas sa raison d'être.
 */
export function exportableAppFontId(fallback: string = DEFAULT_APP_FONT_ID): string {
  try {
    return resolveAppFontId(localStorage.getItem(APP_FONT_KEY), fallback);
  } catch {
    return fallback;
  }
}

/**
 * Pose une police sur le document, et la retient.
 *
 * Un identifiant inconnu ne fait RIEN plutôt que de retomber sur un défaut :
 * la valeur peut venir d'un thème composé sur une version plus récente, et
 * remettre Inter sous les yeux de quelqu'un serait plus déroutant que de
 * laisser sa police actuelle en place.
 *
 * @returns la police posée, ou `null` si l'identifiant n'existe pas ici.
 */
export function applyAppFont(id: string, persist = true): AppFont | null {
  const font = findAppFont(id);
  if (!font || typeof document === 'undefined') return null;
  document.documentElement.style.setProperty('--font-family-base', font.stack);
  document.documentElement.style.setProperty('--font-family-display', font.stack);
  if (persist) {
    try {
      localStorage.setItem(APP_FONT_KEY, id);
    } catch {
      // Stockage refusé : la police est posée pour cette session, et c'est déjà
      // ce que l'utilisateur vient de demander.
    }
  }
  return font;
}

/**
 * La police en vigueur.
 *
 * @param webDefault le web affiche Jakarta sans choix enregistré — un défaut
 *        d'AFFICHAGE, pas une préférence, donc rien n'est persisté pour lui.
 *        L'appelant le fournit parce que lui seul sait sur quelle plateforme il
 *        tourne ; ce module reste sans dépendance.
 */
export function currentAppFontId(webDefault: string | null): string | null {
  try {
    return localStorage.getItem(APP_FONT_KEY) || webDefault;
  } catch {
    return webDefault;
  }
}
