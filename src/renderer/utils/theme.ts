/**
 * Source unique de vérité « ce thème est-il sombre ? ».
 *
 * Trois copies de cette liste vivaient dans NoteEditor/GraphView/MasonryView
 * (et StickyNotesView ne testait que 'dark') : chaque nouveau thème sombre
 * devait rejoindre chaque copie sous peine de trous visuels — c'est arrivé
 * pour minuit. Tout nouveau thème sombre s'ajoute ICI uniquement.
 */

export const DARK_THEMES = ['dark', 'space', 'aurora', 'crepuscule', 'foret', 'minuit'] as const;

export function isDarkTheme(theme?: string | null): boolean {
  const t =
    theme ??
    (typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : null);
  return t ? (DARK_THEMES as readonly string[]).includes(t) : false;
}
