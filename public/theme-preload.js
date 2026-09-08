// Applique le thème avant le premier paint pour éviter le flash.
// Externe (pas inline) : compatible avec une CSP web sans 'unsafe-inline'
// côté script-src (avant-projet web, ETW-1052).
try {
  var t = localStorage.getItem('theme');
  // Première visite web (pas de préférence, pas d'Electron) : papier,
  // aligné sur le défaut appliqué par App.tsx — évite le flash de thème.
  if (!t && !window.electron) t = 'papier';
  if (t) document.documentElement.setAttribute('data-theme', t);
} catch (e) {
  /* localStorage indisponible : thème par défaut */
}
