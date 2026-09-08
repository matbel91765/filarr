/**
 * useRemoveVaultMember — retirer un membre d'un coffre, avec ses DEUX arrêts.
 *
 * Extrait de VaultMembersPanel (lot B, étape 5) pour que le dialogue de partage
 * unifié (ShareDialog) offre le même « Retirer » que le panneau, avec les mêmes
 * garde-fous — sans en recopier la logique. Déplacement PUR : le panneau le
 * consomme à son tour, et aucun comportement ne change.
 *
 * Retirer un membre fait TOURNER la clé du coffre (thunk `removeMember`) : une
 * K_vault' fraîche est rescellée aux membres restants et l'époque avance. Deux
 * choses doivent être dites à un humain avant / pendant ce geste, et ce sont
 * les deux ConfirmModals que le hook rend dans `overlays` :
 *
 *  1. LA RÉSERVE (avant) : le membre retiré garde ce qu'il a déjà téléchargé —
 *     la révocation ne vaut que vers l'avant ;
 *  2. L'EMPREINTE QUI A CHANGÉ (pendant) : la rotation rescelle la nouvelle clé
 *     à tous ceux qui restent. Si la clé publique servie pour l'un d'eux n'est
 *     plus celle qu'on avait vue, on ne scelle PAS : renouvellement légitime ou
 *     courtier qui glisse la sienne, la différence ne se lit pas depuis le
 *     réseau — seule une vérification hors bande la tranche. Le thunk s'arrête
 *     avec `peer_key_changed:<userId>:<empreinte>`, on montre l'empreinte, et
 *     le geste reprend là où il s'était arrêté avec CETTE empreinte confirmée
 *     (une entrée n'autorise que l'empreinte exacte qu'elle nomme) — ET avec
 *     celles des tours précédents, sans quoi un lot dont deux clés ont changé
 *     tourne en rond de modale en modale.
 *
 * LE GESTE SAIT EMPORTER UN GROUPE, ET C'EST LA SEULE FAÇON DE FERMER F08.
 * Resceller K_vault' à quelqu'un exige de lire sa clé publique, et
 * `GET /account/public-key/:userId` la refuse (403 `org_forbidden`) dès que son
 * appartenance à l'espace n'est plus active. Avec deux personnes sorties de
 * l'espace, retirer l'une s'arrête donc en rescellant à l'autre, et
 * réciproquement : un bouton par ligne offrait deux culs-de-sac.
 * `requestRemoveMany` les passe à la MÊME rotation — aucune ne fait alors partie
 * des « restants ».
 *
 * ET LE REFUS SE DIT JUSTE. `member_no_key` visant quelqu'un que l'hôte sait
 * hors de l'espace n'est pas « cette personne n'a pas encore configuré sa clé » :
 * elle en a une, c'est son appartenance qui est éteinte. `isOutOfSpace` permet à
 * l'écran appelant de trancher — sans lui, le message d'origine est conservé
 * plutôt que deviné.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import { ConfirmModal } from '../ui';
import { useNotification } from '../ui/Notification';
import { errorText } from '../../../services/vault/vaultErrorMessages';
import type { AppDispatch } from '../../../store';
import { removeMember } from '../../../store/slices/vaultsSlice';
import type { VaultMemberDTO } from '../../../services/vault/vaultApi';

export interface UseRemoveVaultMemberOptions {
  /** Le libellé d'un membre (e-mail si connu, sinon l'identifiant) — pour les messages. */
  displayName: (userId: string) => string;
  /**
   * Cette personne est-elle sortie de l'espace du coffre ? Sert UNIQUEMENT à
   * dire la vérité sur un `member_no_key` (voir l'en-tête) ; absent, rien n'est
   * supposé.
   */
  isOutOfSpace?: (userId: string) => boolean;
  /** Le retrait a abouti : l'hôte relit sa liste. */
  onRemoved?: () => void | Promise<void>;
}

export interface RemoveVaultMember {
  /** Ouvre la réserve ; le retrait ne part qu'après confirmation. */
  requestRemove: (member: VaultMemberDTO) => void;
  /** Le même geste sur PLUSIEURS personnes — une seule rotation (F08). */
  requestRemoveMany: (members: VaultMemberDTO[]) => void;
  /** Un retrait est en vol — l'hôte désactive ses autres gestes. */
  busy: boolean;
  /** Les deux ConfirmModals — à rendre UNE fois dans l'arbre de l'hôte. */
  overlays: React.ReactNode;
}

export function useRemoveVaultMember(
  vaultId: string,
  options: UseRemoveVaultMemberOptions
): RemoveVaultMember {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const { success, error } = useNotification();
  const [toRemove, setToRemove] = useState<VaultMemberDTO[] | null>(null);
  const [keyChanged, setKeyChanged] = useState<{
    targets: VaultMemberDTO[];
    peerUserId: string;
    fingerprint: string;
    /**
     * LES EMPREINTES DÉJÀ VÉRIFIÉES AUX TOURS PRÉCÉDENTS. La reprise ne repassait
     * QUE celle de la modale en cours : avec deux restants dont la clé a changé,
     * confirmer le premier relançait un retrait qui s'arrêtait sur le second,
     * lequel repartait sans le premier — une boucle de modales dont on ne
     * sortait pas. Le lot les accumule donc, et chaque entrée n'autorise
     * toujours QUE l'empreinte exacte qu'un humain a nommée.
     */
    confirmed: Record<string, string>;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  // Le retrait peut démonter l'hôte (retirer soi-même fait tomber le coffre de
  // l'état) pendant que le thunk se résout encore : on garde les setState
  // derrière ce garde, comme le panneau le faisait.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Les rappels de l'hôte vivent dans une ref : `displayName` et `onRemoved`
  // sont recréés à chaque rendu (ils ferment sur `t` et sur l'état de l'hôte),
  // et on ne veut pas qu'un retrait en vol relise une fermeture périmée.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  /**
   * `confirmed` porte les empreintes que l'administrateur vient de vérifier
   * hors bande, une par membre. Une entrée n'autorise QUE l'empreinte exacte
   * qu'elle nomme : elle n'ouvre rien de plus au prochain appel.
   */
  const runRemove = useCallback(
    async (targets: VaultMemberDTO[], confirmed?: Record<string, string>) => {
      if (targets.length === 0) return;
      setBusy(true);
      try {
        await dispatch(
          removeMember({
            vaultId,
            // TOUS d'un coup : c'est ce qui empêche un partant de rester à
            // resceller (voir l'en-tête).
            userIds: targets.map((m) => m.userId),
            confirmedFingerprints: confirmed,
          })
        ).unwrap();
        success(
          targets.length > 1
            ? t('teamVaults.members.removedMany', { count: targets.length })
            : t('teamVaults.members.removed')
        );
        // Se retirer soi-même fait tomber le coffre (démontage) : on ne relit
        // que si l'hôte est encore là.
        if (mountedRef.current) await optionsRef.current.onRemoved?.();
      } catch (e) {
        const msg = errorText(e);
        // `peer_key_changed:<userId>:<empreinte>` — un arrêt, pas une panne.
        const changed = /^peer_key_changed:([^:]+):(.+)$/.exec(msg);
        if (changed && mountedRef.current) {
          setKeyChanged({
            targets,
            peerUserId: changed[1],
            fingerprint: changed[2],
            // Ce qui était déjà confirmé le RESTE : sans ça, un lot à deux
            // empreintes changées ne se termine jamais.
            confirmed: confirmed ?? {},
          });
          return;
        }
        // `member_no_key:<userId>` — la clé publique d'un RESTANT n'a pas pu
        // être lue. Quand cette personne est elle-même hors de l'espace, ce
        // n'est pas une clé « pas encore configurée » : elle en a une, et c'est
        // le serveur qui refuse de la servir.
        const noKey = /^member_no_key:(.+)$/.exec(msg);
        if (noKey && optionsRef.current.isOutOfSpace?.(noKey[1])) {
          error(
            t('teamVaults.errors.noKeyOutOfSpace', {
              name: optionsRef.current.displayName(noKey[1]),
            })
          );
          return;
        }
        error(
          /member_no_key/.test(msg)
            ? t('teamVaults.errors.noKey')
            : /tampered_log|served_not_latest/.test(msg)
              ? t('teamVaults.errors.keySubstituted')
              : /epoch_conflict|conflict/.test(msg)
                ? t('teamVaults.errors.conflict')
                : t('teamVaults.errors.remove')
        );
      } finally {
        if (mountedRef.current) setBusy(false);
      }
    },
    [dispatch, vaultId, success, error, t]
  );

  const confirmRemove = useCallback(async () => {
    if (!toRemove) return;
    const targets = toRemove;
    setToRemove(null);
    await runRemove(targets);
  }, [toRemove, runRemove]);

  const requestRemove = useCallback((member: VaultMemberDTO) => setToRemove([member]), []);
  const requestRemoveMany = useCallback((members: VaultMemberDTO[]) => {
    if (members.length > 0) setToRemove([...members]);
  }, []);

  const display = optionsRef.current.displayName;

  /** Les noms du lot, dans l'ordre où l'écran vient de les lister. */
  const names = useMemo(
    () => (toRemove ?? []).map((m) => display(m.userId)).join(', '),
    [toRemove, display]
  );
  const lot = toRemove?.length ?? 0;

  const overlays = (
    <>
      <ConfirmModal
        isOpen={toRemove !== null}
        onClose={() => setToRemove(null)}
        onConfirm={() => void confirmRemove()}
        title={
          lot > 1
            ? t('teamVaults.members.removeManyCaveatTitle')
            : t('teamVaults.members.removeCaveatTitle')
        }
        // Un lot NOMME tout le monde : la rotation est unique et sans retour, et
        // « 3 personnes » ne dit pas lesquelles.
        message={
          lot > 1
            ? t('teamVaults.members.removeManyCaveat', { names })
            : t('teamVaults.members.removeCaveat', { name: names })
        }
        confirmText={
          lot > 1
            ? t('teamVaults.members.removeManyConfirm')
            : t('teamVaults.members.removeConfirm')
        }
        variant="danger"
      />

      {/* Le retrait s'est arrêté sur une empreinte changée : on la montre, et
          on ne reprend que si un humain l'a vérifiée par un autre canal. C'est
          exactement ce que l'invitation exige déjà — la rotation scelle le
          même secret aux mêmes gens. */}
      <ConfirmModal
        isOpen={keyChanged !== null}
        onClose={() => setKeyChanged(null)}
        onConfirm={() => {
          if (!keyChanged) return;
          const { targets, peerUserId, fingerprint, confirmed } = keyChanged;
          setKeyChanged(null);
          void runRemove(targets, { ...confirmed, [peerUserId]: fingerprint });
        }}
        title={t('teamVaults.members.keyChangedTitle')}
        message={t('teamVaults.members.keyChanged', {
          name: keyChanged ? display(keyChanged.peerUserId) : '',
          fingerprint: keyChanged?.fingerprint ?? '',
        })}
        confirmText={t('teamVaults.members.keyChangedConfirm')}
        variant="danger"
      />
    </>
  );

  return { requestRemove, requestRemoveMany, busy, overlays };
}

export default useRemoveVaultMember;
