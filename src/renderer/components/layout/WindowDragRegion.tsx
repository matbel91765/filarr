/**
 * WindowDragRegion — la poignée invisible de déplacement de la fenêtre.
 *
 * `pointer-events: none` laisse TOUS les événements souris traverser vers ce
 * qui est dessous (boutons, champs, barre de recherche fonctionnent
 * normalement), et `-webkit-app-region: drag` continue pourtant de déplacer la
 * fenêtre : Chromium traite les régions de déplacement au niveau du
 * COMPOSITEUR, pas au niveau des événements DOM. Même technique que VS Code.
 *
 * Les contrôles restent cliquables parce que `global.css` soustrait button,
 * input, select, textarea, a et [role] de la région, à toute profondeur, et
 * qu'une région `no-drag` déclarée plus tard retire de la région `drag`
 * déclarée plus tôt — or ce composant est monté en tout premier.
 *
 * ── LA GÉOMÉTRIE N'EST PLUS ICI ────────────────────────────────────────────
 * Elle vivait en dur (`right: 140`, `height: 40`), devinée, et fausse sur
 * macOS où les boutons de fenêtre sont à GAUCHE : la bande s'arrêtait du
 * mauvais côté et recouvrait les feux. Tout est maintenant dans
 * `.chrome-drag-band` (styles/chrome.css), donc MESURÉ par
 * `env(titlebar-area-*)` — les deux bords, sur les trois plateformes, sans une
 * seule branche.
 */

export default function WindowDragRegion() {
  return <div className="chrome-drag-band" aria-hidden="true" />;
}
