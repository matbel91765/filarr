/**
 * useVaultStats (F07) — les agrégats du coffre, lus une fois par ouverture de
 * page, et RELUS quand un geste réel les a rendus faux.
 *
 * OÙ IL VIT, ET POURQUOI PAS DANS L'ONGLET. La grille de compteurs ne s'affiche
 * que dans l'Aperçu, mais le chargeur est appelé par la PAGE : un hook posé dans
 * l'onglet repartirait à chaque aller-retour entre Aperçu et Membres, et dix
 * allers-retours feraient dix requêtes sur un seau qui n'en autorise que 120 par
 * heure ET PAR COFFRE — c'est-à-dire pour tous ses membres à la fois. La page,
 * elle, reste montée d'un onglet à l'autre.
 *
 * LE PLANCHER EST DANS LE MODÈLE (`shouldFetchStats`), pas ici : c'est une règle
 * qui doit s'éprouver, et un `if (Date.now() - ref.current > 30000)` au milieu
 * d'un effet ne s'éprouve pas. Il y en a DEUX, et la nuance compte : trente
 * secondes pour la lecture d'ambiance, trois pour le geste explicite —
 * « Réessayer » ne doit ni être désarmé ni pouvoir marteler le seau.
 *
 * ET UN CHANGEMENT D'EFFECTIF LE ROUVRE (`invalidate`). Un retrait fait tourner
 * la clé : la grille garderait sinon l'effectif et l'époque d'avant pendant
 * trente secondes au moins — et indéfiniment si personne ne revient sur
 * l'Aperçu. C'est un geste par relecture, donc borné par la rotation elle-même.
 *
 * LE RANG EST UNE PORTE, PAS UNE DÉCORATION. `GET /:id/stats` est au rang
 * member : appelée pour un lecteur, elle rend un 403 que l'écran afficherait
 * comme une panne. On n'appelle donc pas, et l'Aperçu d'un lecteur montre ce
 * qu'il sait déjà — pas des zéros.
 *
 * LA PART DU POOL EST CONDITIONNELLE, ET C'EST LA MOITIÉ DE L'HONNÊTETÉ DE CET
 * ÉCRAN. `GET /vaults/seats` répond pour l'espace AMBIANT (en-tête X-Org-Id),
 * pas pour l'espace du coffre : chez un hôte qui m'a invité, ce serait mon quota
 * affiché à côté de son coffre. On ne le demande donc que lorsque les deux
 * espaces sont le même, et `poolShare` refuse de toute façon de conclure sans.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '../../../../services/vault/vaultErrorMessages';
import {
  apiGetVaultSeats,
  apiGetVaultStats,
  type VaultSeatsDTO,
} from '../../../../services/vault/vaultApi';
import {
  IDLE_STATS,
  STATS_GESTURE_FLOOR_MS,
  STATS_REFRESH_FLOOR_MS,
  applyStatsOutcome,
  beginStatsFetch,
  invalidateStats,
  mayRetryStats,
  shouldFetchStats,
  type VaultStatsState,
} from './vaultStatsModel';

export interface VaultStatsHandle extends VaultStatsState {
  /** Les sièges et le stockage mutualisé de MON espace — `null` si non demandé. */
  seats: VaultSeatsDTO | null;
  /**
   * Relire. `force` est réservé au bouton « Réessayer » : un clic est une
   * demande explicite, et il n'attend donc pas les trente secondes — mais il a
   * son PROPRE plancher, court (`STATS_GESTURE_FLOOR_MS`). Sans lui, s'acharner
   * sur le bouton après un 429 éteindrait les chiffres de tous les membres du
   * coffre pour une heure. Il ne contourne jamais la lecture en vol, et il ne
   * part pas du tout quand `mayRetryStats` dit que le seau est vide.
   */
  refresh: (force?: boolean) => void;
  /**
   * « L'effectif vient de changer » : les agrégats affichés ne décrivent plus ce
   * coffre. Le plancher est rouvert et une relecture part — la fréquence est
   * bornée par le geste lui-même (une rotation), pas par une boucle.
   */
  invalidate: () => void;
}

export function useVaultStats(
  vaultId: string,
  opts: { enabled: boolean; sameSpace: boolean }
): VaultStatsHandle {
  const { enabled, sameSpace } = opts;
  const [state, setState] = useState<VaultStatsState>(IDLE_STATS);
  const [seats, setSeats] = useState<VaultSeatsDTO | null>(null);

  /**
   * L'état est LU dans le déclencheur (le plancher se compare à la dernière
   * tentative) mais ne doit pas le recréer à chaque réponse : une dépendance sur
   * `state` relancerait l'effet à chaque `setState`, et le plancher deviendrait
   * la seule chose qui empêche la boucle. La ref porte la lecture, l'état porte
   * l'affichage.
   */
  const stateRef = useRef(state);
  stateRef.current = state;

  const vivantRef = useRef(true);
  useEffect(() => {
    vivantRef.current = true;
    return () => {
      vivantRef.current = false;
    };
  }, []);

  const fetchStats = useCallback(
    (force: boolean) => {
      if (!enabled) return;
      const now = Date.now();
      // La lecture en vol n'est JAMAIS contournée, même par un clic : deux
      // réponses concurrentes finiraient par écrire dans le désordre.
      if (stateRef.current.loading) return;
      // Un geste explicite raccourcit le plancher, il ne le supprime pas :
      // c'est la différence entre « je redemande » et « je martèle ». Et un
      // geste dont on SAIT qu'il ne peut rien rendre ne part pas du tout : après
      // un 429 qui n'a laissé aucun chiffre, le seau du coffre est vide pour
      // tout le monde. L'écran désarme déjà le bouton ; la porte est ici aussi,
      // parce qu'un composant n'est pas un garde-fou.
      if (force && !mayRetryStats(stateRef.current)) return;
      const plancher = force ? STATS_GESTURE_FLOOR_MS : STATS_REFRESH_FLOOR_MS;
      if (!shouldFetchStats(stateRef.current, now, plancher)) return;

      const depart = beginStatsFetch(stateRef.current, now);
      stateRef.current = depart;
      setState(depart);

      void (async () => {
        try {
          const stats = await apiGetVaultStats(vaultId);
          if (!vivantRef.current) return;
          const suite = applyStatsOutcome(stateRef.current, { ok: true, stats }, Date.now());
          stateRef.current = suite;
          setState(suite);
        } catch (e) {
          if (!vivantRef.current) return;
          // `apiGetVaultStats` a déjà réduit l'échec à son code canonique
          // (`rate_limited` pour le 429) : c'est ce code que le modèle lit pour
          // décider s'il garde la valeur précédente.
          const suite = applyStatsOutcome(
            stateRef.current,
            { ok: false, code: errorText(e) || 'stats_load_failed' },
            Date.now()
          );
          stateRef.current = suite;
          setState(suite);
        }
      })();
    },
    [enabled, vaultId]
  );

  useEffect(() => {
    fetchStats(false);
    // Un cleanup rendu DANS TOUS LES CAS : une fonction qui n'en rend que dans
    // une branche déclenche TS7030.
    return () => {};
  }, [fetchStats]);

  /**
   * Les sièges : une seule fois, et seulement si le coffre vit dans MON espace.
   * `apiGetVaultSeats` avale son propre échec (il rend `null`) — cette lecture
   * décore, elle ne porte rien.
   */
  useEffect(() => {
    if (!enabled || !sameSpace) {
      setSeats(null);
      return () => {};
    }
    let vivant = true;
    void apiGetVaultSeats().then((s) => {
      if (vivant && vivantRef.current) setSeats(s);
    });
    return () => {
      vivant = false;
    };
  }, [enabled, sameSpace]);

  const refresh = useCallback((force = false) => fetchStats(force), [fetchStats]);

  /**
   * Après un geste qui change l'effectif (donc une rotation), les chiffres
   * affichés sont faux : `memberCount` et l'époque datent d'avant. On rouvre le
   * plancher AVANT de relire — sans quoi la relecture, demandée dans la même
   * seconde que la lecture initiale de la page, serait refusée par ce plancher
   * et la grille garderait ses chiffres périmés jusqu'à un prochain montage.
   */
  const invalidate = useCallback(() => {
    const perime = invalidateStats(stateRef.current);
    stateRef.current = perime;
    setState(perime);
    fetchStats(false);
  }, [fetchStats]);

  return { ...state, seats, refresh, invalidate };
}

export default useVaultStats;
