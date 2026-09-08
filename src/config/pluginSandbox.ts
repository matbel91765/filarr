/**
 * Drapeau LOCAL du greffon de démonstration du bac à sable — même modèle que
 * src/config/collab.ts : localStorage gardé (env vitest node : pas de
 * localStorage, le catch rend false), par appareil, jamais synchronisé.
 *
 * La démo prouve la matrice d'isolation de façon EXÉCUTABLE (auto-test dans
 * l'iframe) — la distribution de code tiers réel passe par la marketplace.
 */

const KEY = 'filarr-plugin-sandbox-demo';

export function isPluginSandboxDemoEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setPluginSandboxDemoEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    /* pas de stockage : le drapeau reste éteint */
  }
}
