/**
 * useVaultKeyHistory (F10) — les deux lectures de la section « Clé du coffre »,
 * tenues PAR LA PAGE.
 *
 * OÙ IL VIT, ET POURQUOI PAS DANS L'ONGLET. Même raison que `useVaultStats` et
 * `useVaultActivityPreview` : les onglets sont montés et démontés à chaque clic
 * de la barre, si bien qu'un effet posé dans Réglages repartirait à chaque
 * retour — cinq allers-retours Réglages↔Membres feraient cinq
 * `GET /:id/key-wraps` et cinq lectures du fil. La page, elle, reste montée.
 *
 * DEUX SOURCES, DEUX RÔLES BIEN DIFFÉRENTS :
 *   · `/key-wraps` est CRITIQUE — c'est lui qui dit quelles époques cet appareil
 *     peut ouvrir. Son échec laisse la section sans frise, et le DIT.
 *   · le fil (`vault.rotate`) est ACCESSOIRE : il ne porte que les dates et les
 *     auteurs. Son échec (ou son absence, sur un plan sans journal) laisse une
 *     frise complète dont les lignes disent « date inconnue » — ce qui est vrai,
 *     et infiniment mieux qu'une frise vide.
 *
 * LE FIL EST DEMANDÉ FILTRÉ (`types=vault.rotate`). Sans le filtre, la première
 * page d'un coffre actif ne contiendrait que des envois de fichiers, et la frise
 * d'un coffre qui a bel et bien tourné serait sans dates — un mensonge par
 * pagination.
 *
 * IL NE MARQUE RIEN COMME « VU » et ne pose aucun curseur : c'est l'onglet
 * Activité qui lit le fil pour de bon.
 *
 * LA CARTE « VOUS » (F15) LIT `/key-wraps` DE SON CÔTÉ, et on l'a laissée
 * faire : elle a besoin de la même liste, mais elle vit dans l'onglet Membres,
 * derrière deux niveaux de props, et lui passer cette lecture aurait fait
 * traverser trois composants à un état pour économiser une requête servie à
 * tout membre. Les deux ne peuvent pas se contredire durablement — elles lisent
 * la même route et la réduisent par le MÊME modèle (`epochCoverage`) — et
 * chacune n'appelle qu'une fois par montage. Le jour où une troisième surface
 * en aura besoin, c'est ce hook qui montera d'un cran, pas une troisième copie.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  apiGetVaultActivity,
  apiGetVaultKeyWraps,
  type VaultActivityEventDTO,
} from '../../../../services/vault/vaultApi';
import {
  buildKeyTimeline,
  lastRotation,
  ROTATE_EVENT_TYPE,
  type KeyEpochEntry,
  type KeyTimeline,
} from './vaultKeyHistoryModel';

/** Référence stable : un objet neuf à chaque rendu relancerait les mémos. */
const EMPTY_TIMELINE: KeyTimeline = { entries: [], truncatedBefore: 0 };

/**
 * Combien de `vault.rotate` on remonte dans le fil. Ce plafond-ci ne borne que
 * les DATES : une rotation plus ancienne que la page laisse sa ligne, sans date
 * (voir `buildKeyTimeline`). Le nombre de LIGNES, lui, est borné ailleurs — par
 * `MAX_TIMELINE_EPOCHS`, parce que ce plafond-là vient du serveur.
 */
export const KEY_HISTORY_EVENTS = 50;

export interface VaultKeyHistory {
  /** La frise, de l'époque courante à la première. Vide tant qu'on ne sait rien. */
  entries: KeyEpochEntry[];
  /** La dernière rotation DATÉE — `null` = jamais tourné, ou fil muet. */
  last: KeyEpochEntry | null;
  /** Les époques que le serveur me garde scellées. */
  wraps: number[];
  /** Combien d'époques la frise n'énumère PAS — `0` = elle est entière. */
  truncatedBefore: number;
  /**
   * `loading` tant que la lecture critique n'a rien rendu ; `unavailable`
   * quand elle a échoué (jamais confondu avec « ce coffre n'a qu'une clé »).
   */
  state: 'loading' | 'ready' | 'unavailable';
  /** Le fil journalise-t-il ? `null` = on n'a pas su lire. */
  recorded: boolean | null;
  reload: () => void;
}

/**
 * `enabled` — LE RANG, PAS UN CONFORT. Le seul lecteur de ce hook est
 * `VaultKeySection`, qui vit dans l'onglet « Réglages » : celui-ci n'existe pas
 * en dessous d'administrateur (`ADMIN_ONLY_TABS`). Sans ce garde, un membre ou
 * un lecteur payait `GET /:id/key-wraps` ET une page de fil à chaque ouverture
 * de la page, pour un écran qu'il ne verra jamais — même raisonnement que
 * `useVaultStats`. Désactivé, l'état reste `loading` : il n'AFFIRME rien (ni
 * « aucune époque », ni une panne), il n'est simplement lu par personne.
 */
export function useVaultKeyHistory(
  vaultId: string,
  currentKeyEpoch: number,
  opts: { enabled: boolean } = { enabled: true }
): VaultKeyHistory {
  const { enabled } = opts;
  const [wraps, setWraps] = useState<number[] | null>(null);
  const [events, setEvents] = useState<VaultActivityEventDTO[]>([]);
  const [recorded, setRecorded] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return () => {};
    let vivant = true;
    setFailed(false);
    // REPARTIR DE « JE NE SAIS PAS » : sans cette remise à zéro, changer de
    // coffre laisserait la frise du PRÉCÉDENT à l'écran le temps de l'aller-
    // retour — des époques justes, attribuées au mauvais coffre.
    setWraps(null);
    void (async () => {
      try {
        const w = await apiGetVaultKeyWraps(vaultId);
        if (!vivant) return;
        setWraps(w.map((x) => x.epoch));
      } catch {
        // On n'affirme RIEN : ni « aucune époque », ni « vous n'avez que la
        // dernière ». La section dit que la lecture a échoué, avec Réessayer.
        if (vivant) {
          setWraps(null);
          setFailed(true);
        }
        return;
      }
      try {
        const page = await apiGetVaultActivity(vaultId, {
          limit: KEY_HISTORY_EVENTS,
          types: [ROTATE_EVENT_TYPE],
        });
        if (!vivant) return;
        setEvents(page.events);
        setRecorded(page.recorded);
      } catch {
        // Accessoire : la frise reste, sans dates.
        if (vivant) {
          setEvents([]);
          setRecorded(null);
        }
      }
    })();
    return () => {
      vivant = false;
    };
    /**
     * L'ÉPOQUE EST UNE DÉPENDANCE, ET C'EST UN CORRECTIF, PAS UN CONFORT. Une
     * rotation faite depuis l'onglet Danger (ou par quelqu'un d'autre) fait
     * avancer `currentKeyEpoch` — mais les scellés, eux, ne seraient pas
     * relus : la frise afficherait la clé neuve marquée « non détenue ici »,
     * c'est-à-dire une alerte inventée juste après un geste réussi. Quand
     * l'époque bouge, la liste des scellés a nécessairement bougé aussi.
     */
  }, [vaultId, currentKeyEpoch, tick, enabled]);

  const timeline = useMemo(
    () => (wraps === null ? EMPTY_TIMELINE : buildKeyTimeline({ wraps, events, currentKeyEpoch })),
    [wraps, events, currentKeyEpoch]
  );

  const last = useMemo(() => lastRotation(timeline.entries), [timeline]);

  return {
    entries: timeline.entries,
    truncatedBefore: timeline.truncatedBefore,
    last,
    wraps: wraps ?? [],
    state: failed ? 'unavailable' : wraps === null ? 'loading' : 'ready',
    recorded,
    reload,
  };
}

export default useVaultKeyHistory;
