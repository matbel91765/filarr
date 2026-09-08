/**
 * Bloc « Dossiers les plus lourds » -- trois lectures du meme classement.
 *
 * Meme source (`useTopFoldersBySize`) que le bandeau historique : deux
 * classements calcules separement finiraient par ne plus donner le meme ordre.
 *
 * La variante COMPACTE existe pour une raison precise : ce bloc sert souvent a
 * surveiller un seul chiffre (« qu'est-ce qui prend toute la place ? »), et un
 * graphique de six rangees pour repondre a ca prend justement toute la place.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

import {
  TopFoldersChart,
  useFormatSize,
  useTopFoldersBySize,
} from '../../views/Home/DashboardStats';
import { readEnumOption, type WidgetOptionSchema, type WidgetProps } from '../widgetOptions';
import { BlockEmpty } from './BlockEmpty';
import './blocks.css';

export const TOP_FOLDERS_OPTIONS: WidgetOptionSchema = [
  {
    kind: 'enum',
    key: 'shape',
    labelKey: 'home.widgets.opt.foldersShape',
    fallback: 'chart',
    choices: [
      { value: 'chart', labelKey: 'home.widgets.opt.foldersChart' },
      { value: 'list', labelKey: 'home.widgets.opt.foldersList' },
      { value: 'compact', labelKey: 'home.widgets.opt.foldersCompact' },
    ],
  },
];

export const TopFoldersWidget: React.FC<WidgetProps> = React.memo(function TopFoldersWidget({
  options,
}) {
  const { t } = useTranslation();
  const topFolders = useTopFoldersBySize();
  const formatSize = useFormatSize();
  const shape = readEnumOption(TOP_FOLDERS_OPTIONS, options, 'shape');

  const heaviest = topFolders[0];

  return (
    <div className="h-full p-4 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-sm overflow-auto">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-3">
        {t('dashboard.topFoldersBySize')}
      </p>

      {shape === 'chart' && (
        <TopFoldersChart
          folders={topFolders}
          noFoldersLabel={t('dashboard.noFolders')}
          formatSizeFn={formatSize}
        />
      )}

      {shape !== 'chart' && topFolders.length === 0 && (
        <BlockEmpty glyph="collection">{t('dashboard.noFolders')}</BlockEmpty>
      )}

      {shape === 'list' && topFolders.length > 0 && (
        <div className="blk-lines">
          {topFolders.map((folder) => (
            <div key={folder.name} className="blk-line blk-line--static">
              <span className="blk-line__title">{folder.name}</span>
              <span className="blk-line__meta">{formatSize(folder.size)}</span>
            </div>
          ))}
        </div>
      )}

      {shape === 'compact' && heaviest && (
        <div className="blk-clock">
          <p className="blk-clock__primary">{formatSize(heaviest.size)}</p>
          <p className="blk-clock__secondary">{heaviest.name}</p>
        </div>
      )}
    </div>
  );
});

export default TopFoldersWidget;
