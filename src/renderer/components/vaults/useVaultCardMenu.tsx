/**
 * useVaultCardMenu — le clic droit d'une carte de coffre et les boîtes qu'il
 * ouvre. UN seul menu, deux écrans (page des coffres, accueil).
 *
 * Extrait de `VaultsList` (lot A, C2) : l'accueil l'importait déjà, mais en
 * tirant avec lui la page entière. Déplacement PUR — aucun comportement ne
 * change, sauf la cible d'« Ouvrir » qui suit la route profonde
 * `/vault-folder/<id>` (C3), seule adresse d'un coffre désormais.
 *
 * C'est la règle du builder partagé (`itemContextMenu`) appliquée jusqu'au
 * bout — le même clic droit doit donner le même menu où qu'on le fasse.
 *
 * DEUX PORTES, ET ELLES NE SE RECOUVRENT PAS : « Gérer l'accès » ouvre le
 * dialogue unifié (`ShareDialog` — inviter, la liste d'accès, le lien au même
 * endroit), la porte RAPIDE ; « Gérer le coffre… » mène à la page entière
 * (`?view=settings`), la porte COMPLÈTE — rôles, invitations, fil, danger.
 * « Activité » ouvre le PANNEAU EXISTANT dans une boîte plutôt qu'un écran de
 * plus : `VaultActivityPanel` est exactement celui que l'explorateur de coffre
 * montre sur son côté. Deux vues qui divergeraient, c'est la panne qu'on ne
 * remarque qu'au moment où l'une des deux ment.
 *
 * Les overlays du dialogue de partage sont INCLUS dans `overlays` : l'accueil
 * et la page des coffres n'ont rien de plus à monter.
 */

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { Modal, ModalBody, ConfirmModal } from '../ui';
import { useNotification } from '../ui/Notification';
import type { ContextMenuItem } from '../ui/ContextMenu';
import type { AppDispatch, RootState } from '../../../store';
import { leaveVault, type VaultSummary } from '../../../store/slices/vaultsSlice';
import { vaultErrorKey } from '../../../services/vault/vaultErrorMessages';
import { buildItemContextMenu } from '../files/itemContextMenu';
import { vaultFolderRoute } from '../layout/RouteContent/routeCompat';
import { useShareDialog } from '../sharing/useShareDialog';
import { VaultActivityPanel } from './VaultActivityPanel';

export function useVaultCardMenu(): {
  menuFor: (vault: VaultSummary) => ContextMenuItem[];
  overlays: React.ReactNode;
} {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const { success, error } = useNotification();
  // Règle 13 : hors nuage, aucune entrée de partage — `open` serait un no-op,
  // mais une entrée qui ne fait rien est pire qu'une entrée absente.
  const isCloud = useSelector((s: RootState) => s.auth.accountMode === 'cloud');
  const { open: openShare, overlays: shareOverlays } = useShareDialog();
  const [activityFor, setActivityFor] = useState<VaultSummary | null>(null);
  const [leaving, setLeaving] = useState<VaultSummary | null>(null);

  const confirmLeave = useCallback(async () => {
    const cible = leaving;
    if (!cible) return;
    try {
      await dispatch(leaveVault({ vaultId: cible.id })).unwrap();
      success(t('teamVaults.leave.done', { name: cible.name || t('teamVaults.locked') }));
    } catch (e) {
      const code = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
      error(t(vaultErrorKey(code, 'teamVaults.errors.leave')));
    }
  }, [leaving, dispatch, success, error, t]);

  const menuFor = useCallback(
    (vault: VaultSummary): ContextMenuItem[] =>
      buildItemContextMenu(
        { id: vault.id },
        {
          open: true,
          vaultManage: true,
          vaultActivity: true,
          manageAccess: isCloud,
          vaultLeave: true,
        },
        {
          onOpen: () => navigate(vaultFolderRoute(vault.id)),
          onVaultManage: () => navigate(vaultFolderRoute(vault.id, { view: 'settings' })),
          onVaultActivity: () => setActivityFor(vault),
          onManageAccess: () => openShare({ kind: 'vault', vaultId: vault.id }),
          onVaultLeave: () => setLeaving(vault),
        },
        t
      ),
    [navigate, t, isCloud, openShare]
  );

  const overlays = (
    <>
      {shareOverlays}
      {activityFor && (
        <Modal
          isOpen
          onClose={() => setActivityFor(null)}
          title={t('teamVaults.viewTab.activity')}
          size="lg"
        >
          <ModalBody>
            <VaultActivityPanel vaultId={activityFor.id} />
          </ModalBody>
        </Modal>
      )}
      <ConfirmModal
        isOpen={!!leaving}
        onClose={() => setLeaving(null)}
        onConfirm={() => void confirmLeave()}
        title={t('teamVaults.leave.title')}
        message={t('teamVaults.leave.confirm', {
          name: leaving?.name || t('teamVaults.locked'),
        })}
        confirmText={t('teamVaults.leave.menu')}
        cancelText={t('common.cancel')}
        variant="danger"
      />
    </>
  );

  return { menuFor, overlays };
}
