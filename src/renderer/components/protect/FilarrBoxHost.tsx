/**
 * FilarrBoxHost — hôte global des ouvertures de conteneurs .filarr (Wave 2).
 *
 * Monté UNIQUEMENT dans l'arbre principal déverrouillé (à côté de la palette
 * de commandes) : il draine la file d'ouvertures de filarrBoxBridge — un
 * double-clic .filarr pendant le verrouillage y attend, l'écran de
 * verrouillage est déjà affiché par LaunchScreen, et l'ouverture repart
 * automatiquement ici au montage post-déverrouillage (« queue-and-retry »).
 *
 *  - Conteneur FICHIER : 'filarrBox:openFile' côté main (copie temporaire
 *    suivie + ouverture) → retour visuel honnête (succès / raison française).
 *  - Conteneur DOSSIER : 'filarrBox:openFolder' → index tar → MiniVaultViewer.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotification } from '../ui/Notification';
import { MiniVaultViewer } from './MiniVaultViewer';
import {
  openBoxFile,
  openBoxFolder,
  subscribeBoxOpen,
  notifyRegistryChanged,
  type BoxFolderListing,
  type PendingBoxOpen,
} from '../../../services/features/filarrBoxBridge';

interface ViewerState {
  boxPath: string;
  listing: BoxFolderListing;
}

/** Nom de base d'un chemin OS (séparateurs Windows et POSIX). */
const basename = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() || p;

export const FilarrBoxHost: React.FC = () => {
  const { t } = useTranslation();
  const { success, error: notifyError, info } = useNotification();
  const [viewer, setViewer] = useState<ViewerState | null>(null);

  const handleOpen = useCallback(
    async (open: PendingBoxOpen) => {
      const name = basename(open.boxPath);

      if (open.kind === 0) {
        const res = await openBoxFile(open.boxPath);
        if (res.ok) {
          success(
            t(
              'desktopProtection.box.fileOpened',
              '« {{name}} » déchiffré et ouvert — les enregistrements sont réécrits dans le conteneur, la copie temporaire est purgée au verrouillage.',
              { name: res.data?.name ?? name }
            )
          );
          notifyRegistryChanged();
        } else if (res.unavailable) {
          info(
            t(
              'settings.desktop.featureUnavailable',
              'Disponible après la prochaine mise à jour de Filarr.'
            )
          );
        } else {
          notifyError(
            res.error ||
              t('desktopProtection.box.openFailed', 'Impossible d’ouvrir « {{name}} ».', { name })
          );
        }
        return;
      }

      const res = await openBoxFolder(open.boxPath);
      if (res.ok && res.data) {
        setViewer({ boxPath: open.boxPath, listing: res.data });
        notifyRegistryChanged();
      } else if (res.unavailable) {
        info(
          t(
            'settings.desktop.featureUnavailable',
            'Disponible après la prochaine mise à jour de Filarr.'
          )
        );
      } else {
        notifyError(
          res.error ||
            t('desktopProtection.box.openFailed', 'Impossible d’ouvrir « {{name}} ».', { name })
        );
      }
    },
    [success, notifyError, info, t]
  );

  useEffect(() => {
    // L'abonnement draine immédiatement les ouvertures en attente (double-clic
    // avant montage / pendant le verrouillage), puis livre en direct.
    return subscribeBoxOpen((open) => {
      void handleOpen(open);
    });
  }, [handleOpen]);

  if (!viewer) return null;

  return (
    <MiniVaultViewer
      isOpen
      boxPath={viewer.boxPath}
      listing={viewer.listing}
      onClose={() => setViewer(null)}
    />
  );
};

export default FilarrBoxHost;
