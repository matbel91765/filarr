/**
 * LES BLOCS DE LA BIBLIOTHÈQUE — tags, collections, fichiers, corbeille.
 *
 * ── UNE OMISSION QUI SAUTE AUX YEUX UNE FOIS DITE ───────────────────────────
 *
 * L'accueil montrait des NOTES et des DOSSIERS. Il ne montrait aucun FICHIER —
 * alors que Filarr est d'abord un coffre à fichiers, et que le compteur du haut
 * en annonce fièrement le nombre. On pouvait voir « 1 248 fichiers » sans avoir
 * le moindre moyen d'en atteindre un depuis l'accueil.
 *
 * Les tags étaient dans le même cas : un panneau entier leur est consacré
 * ailleurs, et l'accueil les ignorait complètement.
 *
 * ── LA CORBEILLE EST ICI POUR UNE RAISON PRÉCISE ────────────────────────────
 *
 * Ce n'est pas un bloc d'archive, c'est un bloc de RATTRAPAGE : la fenêtre
 * pendant laquelle on se rend compte qu'on vient de supprimer la mauvaise
 * chose se compte en minutes. Il montre donc les suppressions les plus
 * RÉCENTES, et il se tait complètement quand la corbeille est vide — un bloc
 * « Corbeille (0) » en permanence serait un rappel inutile.
 */

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import type { RootState } from '../../../../store';
import { useHomeActions } from '../HomeActionsContext';
import { readEnumOption, type WidgetOptionSchema, type WidgetProps } from '../widgetOptions';
import { frameOf, FRAME_OPTION, WidgetSurface } from './WidgetSurface';
import { useRelativeTime } from './relativeTime';
import { BlockEmpty } from './BlockEmpty';
import './blocks.css';

// ==================== 11. Nuage de tags ====================

export const TAG_CLOUD_OPTIONS: WidgetOptionSchema = [
  FRAME_OPTION,
  {
    kind: 'enum',
    key: 'shape',
    labelKey: 'home.widgets.opt.tagShape',
    fallback: 'cloud',
    choices: [
      { value: 'cloud', labelKey: 'home.widgets.opt.tagCloud' },
      { value: 'list', labelKey: 'home.widgets.opt.tagList' },
      { value: 'bars', labelKey: 'home.widgets.opt.tagBars' },
    ],
  },
];

/**
 * Les tags les plus employés.
 *
 * ⚠ LA TAILLE DES MOTS EST BORNÉE, ET C'EST LA SEULE CHOSE DIFFICILE ICI.
 *
 * Un nuage de tags naïf multiplie la taille par le nombre d'usages : un tag
 * utilisé 400 fois à côté d'un tag utilisé 2 fois donne un mot de trois cents
 * pixels et vingt mots illisibles. On projette donc le rang sur une plage
 * FERMÉE (12 → 26 px) — le plus employé est le plus gros, le moins employé
 * reste lisible, et aucune donnée ne peut faire déborder la mise en page.
 */
export const TagCloudWidget: React.FC<WidgetProps> = React.memo(function TagCloudWidget({
  options,
}) {
  const { t } = useTranslation();
  const tags = useSelector((state: RootState) => state.tags.tags);
  const shape = readEnumOption(TAG_CLOUD_OPTIONS, options, 'shape');

  const top = useMemo(
    () =>
      [...tags]
        .filter((tag) => (tag.usageCount ?? 0) > 0)
        .sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0))
        .slice(0, 24),
    [tags]
  );

  const max = top[0]?.usageCount ?? 1;

  return (
    <WidgetSurface frame={frameOf(options)} label={t('home.widgets.tagCloud')}>
      {top.length === 0 ? (
        <BlockEmpty glyph="tag">{t('home.blocks.noTags')}</BlockEmpty>
      ) : shape === 'bars' ? (
        <div className="blk-lines">
          {top.slice(0, 10).map((tag) => (
            <div key={tag.id} className="blk-bar">
              <span className="blk-bar__label" style={{ color: tag.color || undefined }}>
                {tag.name}
              </span>
              <span className="blk-bar__track">
                <span
                  className="blk-bar__fill"
                  style={{
                    width: `${Math.max(4, ((tag.usageCount ?? 0) / max) * 100)}%`,
                    background: tag.color || 'var(--color-primary-400)',
                  }}
                />
              </span>
              <span className="blk-bar__value">{tag.usageCount}</span>
            </div>
          ))}
        </div>
      ) : shape === 'list' ? (
        <div className="blk-lines">
          {top.map((tag) => (
            <div key={tag.id} className="blk-line blk-line--static">
              <span className="blk-line__title" style={{ color: tag.color || undefined }}>
                {tag.name}
              </span>
              <span className="blk-line__meta">{tag.usageCount}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="blk-cloud">
          {top.map((tag) => (
            <span
              key={tag.id}
              className="blk-cloud__tag"
              style={{
                // La plage fermée : voir l'en-tête. `max` vaut au moins 1, donc
                // pas de division par zéro possible.
                fontSize: `${12 + Math.round(((tag.usageCount ?? 0) / max) * 14)}px`,
                color: tag.color || undefined,
              }}
              title={t('home.blocks.tagUses', { count: tag.usageCount ?? 0 })}
            >
              {tag.name}
            </span>
          ))}
        </div>
      )}
    </WidgetSurface>
  );
});

export function isTagCloudEmpty(state: RootState): boolean {
  return !state.tags.tags.some((tag) => (tag.usageCount ?? 0) > 0);
}

// ==================== 12. Collections ====================

export const COLLECTIONS_OPTIONS: WidgetOptionSchema = [FRAME_OPTION];

export const CollectionsWidget: React.FC<WidgetProps> = React.memo(function CollectionsWidget({
  options,
}) {
  const { t } = useTranslation();
  const collections = useSelector((state: RootState) => state.collections.collections);

  return (
    <WidgetSurface frame={frameOf(options)} label={t('home.widgets.collections')}>
      {collections.length > 0 ? (
        <div className="blk-chips">
          {collections.slice(0, 12).map((collection) => (
            <span
              key={collection.id}
              className="blk-chip"
              style={{
                borderColor: collection.color || undefined,
                color: collection.color || undefined,
              }}
            >
              {collection.icon && <span aria-hidden="true">{collection.icon}</span>}
              {collection.name}
              <em>{collection.fileIds?.length ?? 0}</em>
            </span>
          ))}
        </div>
      ) : (
        <BlockEmpty glyph="collection">{t('home.blocks.noCollections')}</BlockEmpty>
      )}
    </WidgetSurface>
  );
});

export function isCollectionsEmpty(state: RootState): boolean {
  return state.collections.collections.length === 0;
}

// ==================== 13. Fichiers récents ====================

export const RECENT_FILES_OPTIONS: WidgetOptionSchema = [FRAME_OPTION];

export const RecentFilesWidget: React.FC<WidgetProps> = React.memo(function RecentFilesWidget({
  options,
}) {
  const { t } = useTranslation();
  const actions = useHomeActions();
  const relative = useRelativeTime();
  const recents = useSelector((state: RootState) => state.favorites.recentFiles);

  const shown = useMemo(
    () =>
      [...recents]
        .sort((a, b) => (b.accessedAt || '').localeCompare(a.accessedAt || ''))
        .slice(0, 8),
    [recents]
  );

  return (
    <WidgetSurface frame={frameOf(options)} label={t('home.widgets.recentFiles')}>
      {shown.length > 0 ? (
        <div className="blk-lines">
          {shown.map((item) => (
            <button
              key={item.id}
              type="button"
              className="blk-line"
              // Un fichier récent ouvre son DOSSIER : l'accueil ne sait pas
              // ouvrir un fichier, et prétendre le contraire donnerait un clic
              // qui ne fait rien. Un dossier de destination inconnu ⇒ la ligne
              // reste inerte plutôt que de mentir.
              onClick={() => item.itemType === 'folder' && actions.openFolder(item.itemId)}
            >
              <span className="blk-line__title">{item.name}</span>
              <span className="blk-line__meta">{relative(item.accessedAt)}</span>
            </button>
          ))}
        </div>
      ) : (
        <BlockEmpty glyph="file">{t('home.blocks.noRecentFiles')}</BlockEmpty>
      )}
    </WidgetSurface>
  );
});

export function isRecentFilesEmpty(state: RootState): boolean {
  return state.favorites.recentFiles.length === 0;
}

// ==================== 14. Favoris ====================

export const FAVORITE_FILES_OPTIONS: WidgetOptionSchema = [FRAME_OPTION];

export const FavoriteFilesWidget: React.FC<WidgetProps> = React.memo(function FavoriteFilesWidget({
  options,
}) {
  const { t } = useTranslation();
  const actions = useHomeActions();
  const favorites = useSelector((state: RootState) => state.favorites.favorites);

  const shown = useMemo(
    () => [...favorites].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).slice(0, 10),
    [favorites]
  );

  return (
    <WidgetSurface frame={frameOf(options)} label={t('home.widgets.favoriteFiles')}>
      {shown.length > 0 ? (
        <div className="blk-lines">
          {shown.map((item) => (
            <button
              key={item.id}
              type="button"
              className="blk-line"
              onClick={() => item.itemType === 'folder' && actions.openFolder(item.itemId)}
            >
              <span className="blk-line__title">
                {item.icon && <span aria-hidden="true">{item.icon} </span>}
                {item.name}
              </span>
              {/* Le raccourci clavier est la moitié de l'intérêt d'un favori :
                  ne pas l'afficher revient à cacher la fonction à qui l'a
                  configurée. */}
              {item.shortcutKey && <span className="blk-line__meta">Ctrl+{item.shortcutKey}</span>}
            </button>
          ))}
        </div>
      ) : (
        <BlockEmpty glyph="star">{t('home.blocks.noFavorites')}</BlockEmpty>
      )}
    </WidgetSurface>
  );
});

export function isFavoriteFilesEmpty(state: RootState): boolean {
  return state.favorites.favorites.length === 0;
}

// ==================== 15. Corbeille ====================

export const TRASH_PEEK_OPTIONS: WidgetOptionSchema = [FRAME_OPTION];

export const TrashPeekWidget: React.FC<WidgetProps> = React.memo(function TrashPeekWidget({
  options,
}) {
  const { t } = useTranslation();
  const relative = useRelativeTime();
  const items = useSelector((state: RootState) => state.trash.items);

  const shown = useMemo(
    () =>
      [...items].sort((a, b) => (b.deletedAt || '').localeCompare(a.deletedAt || '')).slice(0, 6),
    [items]
  );

  return (
    <WidgetSurface frame={frameOf(options)} label={t('home.widgets.trashPeek')}>
      {shown.length > 0 ? (
        <div className="blk-lines">
          {shown.map((item) => (
            <div key={item.id} className="blk-line blk-line--static">
              <span className="blk-line__title">{item.name}</span>
              <span className="blk-line__meta">{relative(item.deletedAt)}</span>
            </div>
          ))}
        </div>
      ) : (
        <BlockEmpty glyph="trash">{t('home.blocks.trashEmpty')}</BlockEmpty>
      )}
    </WidgetSurface>
  );
});

export function isTrashPeekEmpty(state: RootState): boolean {
  return state.trash.items.length === 0;
}
