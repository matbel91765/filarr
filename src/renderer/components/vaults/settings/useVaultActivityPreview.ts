/**
 * useVaultActivityPreview (F07) — les cinq derniers événements de la carte
 * « Dernière activité », lus PAR LA PAGE.
 *
 * OÙ IL VIT, ET POURQUOI PAS DANS L'ONGLET. C'est le même raisonnement que
 * `useVaultStats`, et il vaut ici mot pour mot : les onglets sont montés et
 * démontés à chaque clic de la barre, si bien qu'un effet posé dans l'Aperçu
 * repartait à chaque retour. Cinq allers-retours Aperçu↔Membres faisaient cinq
 * `GET /:id/activity` pour une carte que personne n'avait demandé à rafraîchir.
 * La page, elle, reste montée d'un onglet à l'autre.
 *
 * ELLE NE MARQUE RIEN COMME « VU ». Poser le curseur de lecture ici éteindrait
 * la pastille du rail pour quelqu'un qui n'a fait que passer sur l'Aperçu. C'est
 * l'onglet Activité qui marque, parce que c'est lui qu'on ouvre pour lire.
 *
 * ET UNE PANNE RESTE UNE PANNE. `events: []` avec une erreur n'est pas « ce
 * coffre n'a rien vécu » : les trois vides du fil sont tranchés par
 * `activityEmptyState`, à partir de ce que ce hook rapporte sans le réduire.
 */

import { useEffect, useState } from 'react';
import {
  apiGetVaultActivity,
  type VaultActivityEventDTO,
} from '../../../../services/vault/vaultApi';

/** Combien d'événements la carte montre — pas un de plus. */
export const ACTIVITY_PREVIEW = 5;

export interface VaultActivityPreview {
  /** `null` tant qu'on n'a pas de réponse : c'est l'état « en cours ». */
  events: VaultActivityEventDTO[] | null;
  /** Le plan journalise-t-il ? `null` = on ne sait pas encore. */
  recorded: boolean | null;
  /** Le message d'une lecture qui a échoué — jamais confondu avec un fil vide. */
  error: string | null;
}

export function useVaultActivityPreview(vaultId: string): VaultActivityPreview {
  const [events, setEvents] = useState<VaultActivityEventDTO[] | null>(null);
  const [recorded, setRecorded] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    setError(null);
    void apiGetVaultActivity(vaultId, { limit: ACTIVITY_PREVIEW })
      .then((page) => {
        if (!vivant) return;
        setEvents(page.events);
        setRecorded(page.recorded);
      })
      .catch((e) => {
        if (!vivant) return;
        setEvents([]);
        setError(e instanceof Error ? e.message : 'activity_load_failed');
      });
    return () => {
      vivant = false;
    };
  }, [vaultId]);

  return { events, recorded, error };
}

export default useVaultActivityPreview;
