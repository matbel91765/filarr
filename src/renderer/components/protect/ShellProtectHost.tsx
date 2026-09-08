/**
 * ShellProtectHost — hôte du « Protéger avec Filarr » du menu contextuel
 * Windows (Wave 2b).
 *
 * Monté UNIQUEMENT dans l'arbre principal déverrouillé (à côté de
 * FilarrBoxHost) : il draine la file de demandes de filarrBoxBridge — un
 * clic droit pendant le verrouillage y attend (notice poussée par
 * desktopProtectionBridge), et le dialogue s'ouvre automatiquement ici au
 * montage post-déverrouillage (« queue-and-retry », même mécanisme que les
 * ouvertures de conteneurs .filarr).
 *
 * Réutilise ProtectInPlaceDialog TEL QUEL (Wave 2) : sélecteur du dossier de
 * destination + suppression de l'original après vérification. Chaque lot est
 * monté avec une `key` dédiée — le remontage réinitialise l'état interne du
 * dialogue (phase, destination, coche). Un lot arrivé pendant qu'un dialogue
 * est déjà affiché (chiffrement en cours compris) est mis en attente,
 * dédupliqué, et présenté à la fermeture du dialogue courant.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ProtectInPlaceDialog } from './ProtectInPlaceDialog';
import { subscribeShellProtectRequest } from '../../../services/features/filarrBoxBridge';

interface ProtectBatch {
  /** Identifiant de lot — sert de `key` pour remonter le dialogue à neuf. */
  id: number;
  paths: string[];
}

export const ShellProtectHost: React.FC = () => {
  const [batch, setBatch] = useState<ProtectBatch | null>(null);
  /** Chemins arrivés pendant qu'un dialogue est affiché — lot suivant. */
  const bufferedRef = useRef<string[]>([]);
  /** true tant qu'un dialogue est affiché (miroir hors-render de `batch`). */
  const dialogOpenRef = useRef(false);
  const nextIdRef = useRef(1);

  useEffect(() => {
    // L'abonnement draine immédiatement les demandes en attente (clic droit
    // pendant le verrouillage / avant montage), puis livre en direct.
    return subscribeShellProtectRequest((paths) => {
      if (dialogOpenRef.current) {
        // Un dialogue est déjà affiché (peut-être en plein chiffrement) : on
        // n'écrase rien — le lot attend et sera présenté à la fermeture.
        for (const p of paths) {
          if (!bufferedRef.current.includes(p)) bufferedRef.current.push(p);
        }
        return;
      }
      dialogOpenRef.current = true;
      setBatch({ id: nextIdRef.current++, paths });
    });
  }, []);

  const handleClose = useCallback(() => {
    const buffered = bufferedRef.current.splice(0);
    if (buffered.length > 0) {
      // Lot suivant en attente : rouvrir aussitôt avec une `key` neuve
      // (remontage complet = dialogue réinitialisé en phase « configure »).
      setBatch({ id: nextIdRef.current++, paths: buffered });
    } else {
      dialogOpenRef.current = false;
      setBatch(null);
    }
  }, []);

  if (!batch) return null;

  return <ProtectInPlaceDialog key={batch.id} isOpen paths={batch.paths} onClose={handleClose} />;
};

export default ShellProtectHost;
