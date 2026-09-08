/**
 * useVaultPin (F27) — poser et retirer l'épingle d'un coffre, par LE MÊME chemin
 * que la description.
 *
 * POURQUOI UN HOOK PLUTÔT QU'UN APPEL EN LIGNE. Écrire l'épingle, c'est écrire
 * le bloc scellé des réglages — donc refaire, mot pour mot, ce que fait
 * l'onglet « Réglages » : un plan d'enregistrement (`vaultSettingsSavePlan`, qui
 * PORTE les champs inconnus), un scellé sous K_vault de l'époque COURANTE, un
 * `PUT` en compare-and-set sur `version`, et la relecture. Recopier cette
 * séquence dans le menu contextuel, c'était garantir qu'une des cinq précautions
 * y manquerait — et la plus coûteuse à oublier est celle qui refuse d'écrire un
 * bloc qu'on n'a pas su ouvrir : elle efface, pour TOUS les membres, une
 * description et une apparence qu'un autre appareil lit encore.
 *
 * LE GESTE EST ATOMIQUE VIS-À-VIS DES RÉGLAGES EN CLAIR : le plan ne porte
 * QUE le bloc (aucun réglage n'a changé), donc le `patch` est nul. Un coffre
 * dont un autre administrateur modifie les réglages au même instant fait échouer
 * le compare-and-set — on le DIT, on ne rejoue pas : réécrire par-dessus
 * l'enregistrement de quelqu'un d'autre est exactement ce qu'un compare-and-set
 * existe pour empêcher.
 *
 * L'ÉPINGLE NE CRÉE RIEN. L'élément visé est une note ordinaire du coffre ; ce
 * hook ne fait que ranger son identifiant. Rien n'est déplacé, copié, ni caché.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotification } from '../../ui/Notification';
import { getVaultKey } from '../../../../services/vault/vaultKeyCache';
import { encryptVaultBlob } from '../../../../services/vault/vaultCrypto';
import { apiPutVaultSettings } from '../../../../services/vault/vaultApi';
import { errorText, vaultErrorKey } from '../../../../services/vault/vaultErrorMessages';
import {
  encodeVaultSettingsBlock,
  settingsBlockNotice,
  vaultSettingsSavePlan,
} from './vaultSettingsModel';
import type { VaultSettingsHandle } from './useVaultSettings';

export interface VaultPinHandle {
  /** Ce qui est épinglé aujourd'hui, tel que le bloc l'a rendu. */
  pinnedItemId: string | undefined;
  /** Une écriture est en vol — le menu n'en lance pas deux. */
  busy: boolean;
  /** Épingler cet élément, ou (avec `undefined`) retirer l'épingle. */
  setPinned: (itemId: string | undefined) => Promise<void>;
}

export function useVaultPin(
  vaultId: string,
  currentKeyEpoch: number,
  settings: VaultSettingsHandle
): VaultPinHandle {
  const { t } = useTranslation();
  const { success, error } = useNotification();
  const [busy, setBusy] = useState(false);
  // Un geste du menu peut démonter l'explorateur (ouvrir la note épinglée)
  // pendant que l'écriture est en vol.
  const vivant = useRef(true);
  /**
   * UNE ÉCRITURE À LA FOIS, ET LA GARDE EST ICI — pas chez les appelants.
   *
   * L'Aperçu grisait bien son bouton pendant l'écriture ; le menu contextuel de
   * l'explorateur, lui, appelait `setPinned` sans regarder `busy`. Deux clics
   * rapides partaient donc avec la MÊME `expectedVersion`, et le second
   * récoltait `settings_version_conflict` — affiché comme « quelqu'un a
   * enregistré les réglages du coffre avant vous », alors que ce quelqu'un
   * était soi-même. Une garde par surface aurait à être réécrite à chaque
   * nouvelle porte ; posée dans le hook, elle couvre toutes celles qui existent
   * et celles qui viendront.
   *
   * UNE RÉF, PAS L'ÉTAT : `busy` n'est à jour qu'au rendu suivant, et deux clics
   * dans la même frame le liraient tous les deux à `false`.
   */
  const enVol = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  useEffect(() => {
    vivant.current = true;
    // Un cleanup rendu DANS TOUS LES CAS (TS7030).
    return () => {
      vivant.current = false;
    };
  }, []);

  const setPinned = useCallback(
    async (itemId: string | undefined) => {
      // Deux clics ne partent pas sur la même version — voir `enVol`.
      if (enVol.current) return;
      const s = settingsRef.current;
      /**
       * LA MÊME GARDE QUE L'ONGLET RÉGLAGES, ET POUR LA MÊME RAISON. Un bloc que
       * cet appareil n'a pas su ouvrir n'est pas un bloc vide : le rescellé
       * qu'on écrirait par-dessus perdrait la description et tout ce qu'une
       * version plus récente y a posé, pour tous les membres à la fois.
       *
       * ET « PAS ENCORE LU » SE DIT AUTREMENT QUE « PAS LU ». La lecture pose la
       * ligne du serveur avant d'avoir déchiffré son bloc : dans cette fenêtre,
       * la poignée porte un `blockReadable` périmé. Le refus reste le même — on
       * n'écrit toujours pas par-dessus un bloc non ouvert — mais annoncer « bloc
       * illisible » à quelqu'un dont la lecture va aboutir à la ligne suivante
       * est faux, et « patientez » est la vérité.
       */
      const notice = settingsBlockNotice({
        seal: s.seal,
        blockReadable: s.blockReadable,
        hasStoredBlock: !!s.stored?.encrypted,
        loading: s.state === 'loading',
      });
      if (notice.unreadable) {
        error(
          t(
            notice.pending
              ? 'teamVaults.settings.edit.blockLoading'
              : 'teamVaults.settings.edit.blockUnreadable'
          )
        );
        return;
      }
      const saved = { settings: s.settings, block: s.block };
      const draft = { settings: s.settings, block: { ...s.block, pinnedItemId: itemId } };
      const plan = vaultSettingsSavePlan(saved, draft, { forceReseal: notice.reseal });
      if (plan.empty || !plan.block) {
        // Rien n'a bougé : épingler ce qui l'est déjà. On ne dit rien et on
        // n'écrit rien — un `PUT` vide se fait refuser 400.
        return;
      }
      // LA CLÉ DE L'ÉPOQUE COURANTE, et elle seule : le serveur vérifie l'époque
      // déclarée (`vault_epoch_conflict`) plutôt que de condamner le bloc.
      const kVault = getVaultKey(vaultId, currentKeyEpoch);
      if (!kVault) {
        error(t('teamVaults.settings.edit.sealFailed'));
        return;
      }
      enVol.current = true;
      setBusy(true);
      try {
        const { ciphertext, iv } = await encryptVaultBlob(
          encodeVaultSettingsBlock(plan.block),
          kVault
        );
        await apiPutVaultSettings(vaultId, {
          // `version: 0` = aucune ligne enregistrée : la valeur qu'attend la
          // PREMIÈRE écriture, pas une version inconnue.
          expectedVersion: s.stored?.version ?? 0,
          encrypted: {
            settingsEncrypted: ciphertext,
            settingsIv: iv,
            sealedEpoch: currentKeyEpoch,
          },
        });
        success(t(itemId ? 'teamVaults.pinned.done' : 'teamVaults.pinned.cleared'));
        await s.reload();
      } catch (e) {
        const code = errorText(e);
        if (code === 'host_plan_lapsed') s.notePlanRefusal();
        if (code === 'settings_version_conflict') {
          // Quelqu'un d'autre administre ce coffre. On relit et on le DIT :
          // rejouer écraserait sa décision, ce qu'un compare-and-set interdit.
          await s.reload();
          error(t('teamVaults.pinned.conflict'));
          return;
        }
        if (code === 'vault_epoch_conflict') {
          error(t('teamVaults.settings.edit.epochMoved'));
          return;
        }
        error(t(vaultErrorKey(code, 'teamVaults.errors.settingsSaveFailed')));
      } finally {
        // Le verrou tombe DANS TOUS LES CAS, y compris démonté — où `busy`, lui,
        // ne peut plus être reposé : un geste suivant ne doit pas se heurter au
        // reliquat d'une écriture achevée.
        enVol.current = false;
        if (vivant.current) setBusy(false);
      }
    },
    [vaultId, currentKeyEpoch, success, error, t]
  );

  return { pinnedItemId: settings.block.pinnedItemId, busy, setPinned };
}

export default useVaultPin;
