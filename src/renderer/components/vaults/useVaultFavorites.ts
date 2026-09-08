/**
 * useVaultFavorites — MES ÉPINGLES (« favoris », ★) d'un coffre partagé.
 *
 * Par utilisateur, par coffre, scellées : la liste suit la personne d'un
 * appareil à l'autre et le serveur n'en lit jamais le contenu. Rien à voir
 * avec `useVaultPin` (F27, 📌) : celle-là écrit le bloc PARTAGÉ des réglages
 * et désigne UNE note pour tout le monde ; celle-ci ne regarde que soi.
 *
 * ═══ LA REPRISE SUR 409 EST LE CŒUR DU HOOK ═══
 *
 * Deux appareils du même compte peuvent écrire en même temps. Le serveur
 * refuse la seconde écriture et rend l'ÉTAT COURANT : on fusionne dessus
 * (`mergePins`, par identifiant, horloge la plus haute gagnante) et on rejoue —
 * BORNÉ à trois tentatives, puis on le dit plutôt que de tourner. Un `GET` de
 * relecture entre les deux serait pire qu'inutile : il rouvrirait la course.
 *
 * ═══ UNE ÉCRITURE À LA FOIS, ET LA GARDE EST ICI ═══
 *
 * Deux clics rapides partiraient sinon avec la même `version` et le second
 * récolterait un conflit contre soi-même. La garde est une ref, pas l'état :
 * `busy` n'est à jour qu'au rendu suivant.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotification } from '../ui/Notification';
import {
  apiGetVaultPins,
  apiPutVaultPins,
  sealPins,
  unsealPins,
} from '../../../services/vault/pinsApi';
import {
  EMPTY_PINS,
  isPinned,
  mergePins,
  pinClock,
  pinnedIds,
  withPin,
  withoutPin,
  type PinsDoc,
} from '../../../services/vault/pinsModel';

const MAX_ATTEMPTS = 3;

export interface VaultFavoritesHandle {
  /** Les identifiants épinglés, les plus récents en tête. */
  ids: ReadonlySet<string>;
  ordered: readonly string[];
  /** La liste a été lue (ou son absence constatée) sur cette session. */
  loaded: boolean;
  busy: boolean;
  isFavorite: (itemId: string) => boolean;
  toggle: (itemId: string) => Promise<void>;
  reload: () => Promise<void>;
}

export function useVaultFavorites(
  vaultId: string,
  currentKeyEpoch: number,
  enabled: boolean
): VaultFavoritesHandle {
  const { t } = useTranslation();
  const { error } = useNotification();
  const [doc, setDoc] = useState<PinsDoc>(EMPTY_PINS);
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const enVol = useRef(false);
  const vivant = useRef(true);
  // L'état que la PROCHAINE écriture doit prendre pour base — une ref, parce
  // qu'une reprise sur 409 enchaîne plusieurs écritures dans le même geste.
  const courant = useRef<{ doc: PinsDoc; version: number }>({ doc: EMPTY_PINS, version: 0 });

  const poser = useCallback((d: PinsDoc, v: number): void => {
    courant.current = { doc: d, version: v };
    if (!vivant.current) return;
    setDoc(d);
    setVersion(v);
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    if (!enabled || !vaultId) return;
    try {
      const remote = await apiGetVaultPins(vaultId);
      const ouvert = await unsealPins(remote.blob, vaultId);
      // Un blob qu'on ne sait pas ouvrir (clé de son époque absente) n'est
      // PAS une liste vide : on garde ce qu'on avait et on ne réécrit rien
      // par-dessus — `toggle` refusera d'écrire tant que `loaded` est faux.
      if (ouvert === null) return;
      poser(ouvert, remote.version);
      if (vivant.current) setLoaded(true);
    } catch {
      /* hors ligne : la liste locale reste ce qu'elle est */
    }
  }, [enabled, vaultId, poser]);

  useEffect(() => {
    vivant.current = true;
    setLoaded(false);
    poser(EMPTY_PINS, 0);
    void reload();
    return () => {
      vivant.current = false;
    };
  }, [reload, poser]);

  const toggle = useCallback(
    async (itemId: string): Promise<void> => {
      if (!enabled || enVol.current || !loaded) return;
      enVol.current = true;
      if (vivant.current) setBusy(true);
      try {
        const geste = isPinned(courant.current.doc, itemId) ? withoutPin : withPin;
        let local = geste(courant.current.doc, itemId, pinClock());
        let base = courant.current.version;
        for (let tentative = 0; tentative < MAX_ATTEMPTS; tentative++) {
          const blob = await sealPins(local, vaultId, currentKeyEpoch);
          if (!blob) {
            error(t('teamVaults.favorites.failed'));
            return;
          }
          const r = await apiPutVaultPins(vaultId, blob, base);
          if (r.ok) {
            poser(local, r.version);
            return;
          }
          // 409 : l'état courant est ce sur quoi on fusionne, sans relecture.
          const distant = await unsealPins(r.current.blob, vaultId);
          if (distant === null) {
            error(t('teamVaults.favorites.failed'));
            return;
          }
          local = mergePins(distant, local);
          base = r.current.version;
        }
        // Trois refus d'affilée : un autre appareil écrit sans arrêt. On le
        // dit, et on relit — rejouer indéfiniment serait pire.
        error(t('teamVaults.favorites.conflict'));
        await reload();
      } catch {
        error(t('teamVaults.favorites.failed'));
      } finally {
        enVol.current = false;
        if (vivant.current) setBusy(false);
      }
    },
    [enabled, loaded, vaultId, currentKeyEpoch, poser, reload, error, t]
  );

  const ordered = useMemo(() => pinnedIds(doc), [doc]);
  const ids = useMemo(() => new Set(ordered), [ordered]);
  const isFavorite = useCallback((itemId: string) => ids.has(itemId), [ids]);

  // `version` n'est lue que par la ref ; l'état existe pour re-rendre.
  void version;

  return { ids, ordered, loaded, busy, isFavorite, toggle, reload };
}

export default useVaultFavorites;
