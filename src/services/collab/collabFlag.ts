/**
 * Drapeau de la collaboration en temps réel — ADAPTATEUR, pas une source.
 *
 * Le réglage vit dans `src/config/collab.ts` (`filarr-live-collab`), qui est
 * aussi ce que lisent l'éditeur et les Paramètres. Deux drapeaux concurrents
 * produiraient exactement la panne qu'on veut éviter : une salle ouverte côté
 * transport alors que l'interface se croit hors ligne. Ce module ne fait donc
 * que relayer, avec un override mémoire réservé aux tests.
 *
 * ÉTEINT PAR DÉFAUT : ouvrir une salle change la posture réseau de
 * l'application (canal permanent vers le relais, qui apprend quels appareils
 * éditent quelle note et quand). C'est un choix de l'utilisateur.
 */

import {
  isLiveCollabEnabled,
  setLiveCollabEnabled,
  LIVE_COLLAB_CHANGED_EVENT,
} from '../../config/collab';

/** Override mémoire — tests, ou coupure d'urgence sans toucher au réglage. */
let _override: boolean | null = null;

export function isCollabEnabled(): boolean {
  if (_override !== null) return _override;
  return isLiveCollabEnabled();
}

export function setCollabEnabled(enabled: boolean): void {
  setLiveCollabEnabled(enabled);
}

/** Force l'état sans toucher au stockage (`null` pour rendre la main au réglage). */
export function overrideCollabEnabled(value: boolean | null): void {
  _override = value;
}

export { LIVE_COLLAB_CHANGED_EVENT };
