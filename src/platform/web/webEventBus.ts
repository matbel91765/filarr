/**
 * Bus d'événements web — remplace les 40 canaux "receive" du preload.
 *
 * Sur desktop, le main PUSH des événements vers le renderer (files-updated,
 * sync-status-changed…). Sur web, ces événements naissent soit du moteur local
 * (une écriture émet elle-même files-updated), soit du polling serveur (M3+),
 * soit jamais (tray, auto-update). Le bus conserve le contrat du preload :
 * `on()` retourne la fonction de désabonnement (contextBridge ne préserve pas
 * l'identité des fonctions, donc removeListener(fn) ne peut pas marcher —
 * même contrat ici, electron/preload.ts:254-269).
 */

type Listener = (...args: unknown[]) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribeWebEvent(channel: string, listener: Listener): () => void {
  let set = listeners.get(channel);
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
  };
}

export function subscribeWebEventOnce(channel: string, listener: Listener): void {
  const off = subscribeWebEvent(channel, (...args) => {
    off();
    listener(...args);
  });
}

export function removeAllWebListeners(channel: string): void {
  listeners.delete(channel);
}

/**
 * Émet un événement vers le renderer — c'est l'API que les implémentations web
 * (moteur de stockage, polling de sync…) utilisent pour remplacer les push du
 * main. Les listeners sont appelés en microtâche pour ne jamais réentrer dans
 * l'émetteur.
 */
export function emitWebEvent(channel: string, ...args: unknown[]): void {
  const set = listeners.get(channel);
  if (!set || set.size === 0) return;
  const snapshot = [...set];
  queueMicrotask(() => {
    for (const l of snapshot) {
      try {
        l(...args);
      } catch {
        /* un listener défaillant ne doit pas couper les autres */
      }
    }
  });
}
