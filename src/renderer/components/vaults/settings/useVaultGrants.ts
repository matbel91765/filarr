/**
 * useVaultGrants (F17) — les accès ponctuels du coffre, lus PAR LA PAGE.
 *
 * OÙ IL VIT, ET POURQUOI PAS DANS L'ONGLET. Même raisonnement que `useVaultStats`
 * et `useVaultActivityPreview`, et il vaut ici mot pour mot : les onglets sont
 * montés et démontés à chaque clic de la barre, si bien qu'un effet posé dans
 * Membres repartirait à chaque retour. Cinq allers-retours Membres↔Aperçu
 * feraient cinq `GET /:id/grants` pour une section que personne n'a demandé à
 * rafraîchir. La page, elle, reste montée d'un onglet à l'autre.
 *
 * RÉSERVÉ AUX ADMINISTRATEURS, ET C'EST LA ROUTE QUI LE DIT (`requireVaultRole
 * 'admin'`). L'appeler pour un membre ordinaire lui vaudrait un 403 à chaque
 * ouverture de la page — un reproche pour un appel qu'on a choisi de faire à sa
 * place. `enabled` à faux ne charge donc rien du tout, et l'état reste « pas
 * chargé », jamais « vide ».
 *
 * UN ÉCHEC EST CONSERVÉ, PAS RÉDUIT À UNE LISTE VIDE. Cette section répond à
 * « qui, en dehors de mes membres, peut encore lire ? » : une liste vide rendue
 * sur une panne répondrait « personne », c'est-à-dire la seule réponse fausse
 * qui rassure. `apiListVaultGrants` laisse donc remonter son erreur (contrairement
 * à `apiListItemGrants`, dont l'échec est un simple confort perdu).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '../../../../services/vault/vaultErrorMessages';
import { apiListVaultGrants, type VaultGrantDTO } from '../../../../services/vault/vaultApi';

export interface VaultGrants {
  /** `null` = pas encore lu (ou pas le droit) — jamais confondu avec « aucun ». */
  grants: VaultGrantDTO[] | null;
  loading: boolean;
  /** Le code du refus, MÉMORISÉ : l'écran le dit et propose de réessayer. */
  error: string | null;
  reload: () => Promise<void>;
}

export function useVaultGrants(vaultId: string, enabled: boolean): VaultGrants {
  const [grants, setGrants] = useState<VaultGrantDTO[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Les gestes de la page peuvent démonter leur hôte (quitter, supprimer) alors
  // qu'une lecture est encore en vol.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!enabled) {
      // Pas le droit de lire : on ne prétend NI que la liste est vide, NI qu'une
      // lecture a échoué. On ne sait pas, et c'est ce que `null` dit.
      setGrants(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await apiListVaultGrants(vaultId);
      if (mountedRef.current) setGrants(rows);
    } catch (e) {
      if (mountedRef.current) setError(errorText(e) || 'grants_load_failed');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [vaultId, enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { grants, loading, error, reload };
}

export default useVaultGrants;
