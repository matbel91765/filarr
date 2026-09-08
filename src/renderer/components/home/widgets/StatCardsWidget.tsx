/**
 * Bloc « Cartes de statistiques » — les trois chiffres du haut.
 *
 * Ce bloc N'EST PAS dans le modèle par défaut, et c'est une décision de produit,
 * pas un oubli : on ne met pas de chiffres sous le nez de quelqu'un qui n'en a
 * pas demandé. Il se pose à la main, ou il arrive par l'amorçage d'un profil qui
 * avait déjà déplié le bandeau.
 *
 * Les cartes, les icônes et le calcul viennent de `DashboardStats` — le bandeau
 * historique et ce bloc doivent afficher exactement les mêmes nombres.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

import {
  FileIcon,
  FolderIcon,
  StatCard,
  StorageIcon,
  useFormatSize,
  useStatCardFigures,
} from '../../views/Home/DashboardStats';
import type { WidgetProps } from '../widgetOptions';

export const StatCardsWidget: React.FC<WidgetProps> = React.memo(function StatCardsWidget() {
  const { t } = useTranslation();
  const { fileCount, folderCount, totalSize } = useStatCardFigures();
  const formatSize = useFormatSize();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <StatCard label={t('dashboard.files')} value={fileCount} icon={<FileIcon />} />
      <StatCard label={t('dashboard.folders')} value={folderCount} icon={<FolderIcon />} />
      <StatCard
        label={t('dashboard.totalSize')}
        value={formatSize(totalSize)}
        icon={<StorageIcon />}
      />
    </div>
  );
});

export default StatCardsWidget;
