/**
 * Édition vivante (collaboration temps réel) — drapeau local.
 *
 * Désactivé par défaut : ouvrir une session change la posture réseau de
 * l'application (un canal permanent vers le relais, ouvert tant que la note
 * est ouverte). Le drapeau vit en localStorage, global à l'appareil, comme
 * les deux relais de métadonnées — il n'est jamais synchronisé.
 *
 * Ce que le relais voit quand le drapeau est actif : quels appareils sont
 * connectés à quelle note (identifiants opaques), quand, et la taille des
 * messages. Jamais leur contenu : chaque mise à jour CRDT et chaque message
 * de présence est chiffré sur l'appareil avant d'entrer sur le réseau.
 */

const LIVE_COLLAB_KEY = 'filarr-live-collab';

/** Événement fenêtre émis à chaque bascule, pour que les éditeurs ouverts réagissent. */
export const LIVE_COLLAB_CHANGED_EVENT = 'filarr-live-collab-changed';

export function isLiveCollabEnabled(): boolean {
  try {
    return localStorage.getItem(LIVE_COLLAB_KEY) === '1';
  } catch {
    return false;
  }
}

export function setLiveCollabEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(LIVE_COLLAB_KEY, '1');
    else localStorage.removeItem(LIVE_COLLAB_KEY);
  } catch {
    /* localStorage indisponible : reste désactivé */
  }
  try {
    window.dispatchEvent(new CustomEvent(LIVE_COLLAB_CHANGED_EVENT, { detail: enabled }));
  } catch {
    /* environnement sans window (tests node) */
  }
}
