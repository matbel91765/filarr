/**
 * LE REFUS DE CONNEXION « TROP D'APPAREILS », EN ATTENTE D'UN CHOIX.
 *
 * Un point de rendez-vous minuscule entre le hook qui se connecte et l'écran
 * qui propose. Il existe parce que la connexion part de CINQ endroits
 * différents (onboarding, réglages, écran de lancement, inscription,
 * migration) : y coller un modal à chaque fois, ce serait cinq copies du même
 * écran, dont quatre finiraient par diverger.
 *
 * ═══ AUCUN MOT DE PASSE N'EST STOCKÉ ICI ═══
 *
 * `retry` est une FERMETURE fabriquée par l'appelant, qui garde ses propres
 * identifiants le temps du dialogue. Rien de secret ne traverse ce module, et
 * rien n'y survit à la fermeture de l'écran.
 */

import type { DeviceLimitSession } from './authApi';

export interface DeviceLimitPrompt {
  cap: number;
  /** Sessions vivantes, la plus INACTIVE en tête (le serveur les trie). */
  sessions: DeviceLimitSession[];
  /** Rejoue la connexion en déconnectant cet appareil. */
  retry: (deviceId: string) => Promise<void>;
}

type Listener = (prompt: DeviceLimitPrompt | null) => void;

let current: DeviceLimitPrompt | null = null;
const listeners = new Set<Listener>();

export function publishDeviceLimitPrompt(prompt: DeviceLimitPrompt | null): void {
  current = prompt;
  for (const l of listeners) {
    try {
      l(current);
    } catch {
      /* un abonné qui jette ne doit pas empêcher les autres d'être prévenus */
    }
  }
}

export function readDeviceLimitPrompt(): DeviceLimitPrompt | null {
  return current;
}

export function subscribeDeviceLimitPrompt(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
