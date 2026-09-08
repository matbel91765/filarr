/**
 * Dossiers personnalisables — LES SIX BLOCS CONTEXTUELS.
 *
 * ── POURQUOI SIX BLOCS DANS UN SEUL FICHIER ─────────────────────────────────
 *
 * L'accueil range un widget par fichier, et c'est justifié là-bas : ses blocs
 * n'ont ni source ni coque communes (une bannière, une grille de dossiers avec
 * son glisser-déposer, un calendrier…). Ceux-ci sont l'exact contraire : même
 * coque (`FolderBlock`), même source (`folderWidgetData`), même règle du vide
 * (pas de dossier ⇒ on le dit). Les éclater en six fichiers de trente lignes
 * aurait recopié la coque six fois — et c'est précisément comme ça que le menu
 * contextuel des dossiers avait fini par avoir « son dialecte » selon l'écran.
 *
 * ── CE QUE CES BLOCS NE FONT PAS ────────────────────────────────────────────
 *
 * Ils ne modifient RIEN. Pas de case à cocher qui écrit dans une note, pas de
 * renommage, pas de suppression. Un bandeau est un tableau de bord : il montre
 * et il emmène. Tout geste qui change quelque chose appartient à la liste, en
 * bas, qui a ses menus et ses confirmations — et qui, elle, ne bouge jamais.
 */

import React, { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import { formatBytes } from '../../../../constants/limits';
import type { RootState } from '../../../../store';
import type { Folder, Item } from '../../../../types';
import { useHomeActions } from '../../home/HomeActionsContext';
import type { WidgetProps } from '../../home/widgetOptions';
import { SectionHeading } from '../../home/widgets/SectionHeading';
import { useWidgetFolderId } from '../FolderWidgetContext';
import {
  byRecency,
  directItems,
  directSubfolders,
  notesOfFolder,
  pendingTasks,
  subtreeStats,
} from '../folderWidgetData';

// ==================== La coque ====================

/** Ce que chaque bloc montre : un titre, et soit du contenu, soit son vide. */
const FolderBlock: React.FC<{
  label: string;
  count?: number;
  empty?: string;
  children?: React.ReactNode;
}> = ({ label, count, empty, children }) => (
  <section className="folder-block">
    <SectionHeading label={label} count={count} />
    {children ?? <p className="folder-block__empty">{empty}</p>}
  </section>
);

/**
 * Le bloc n'a pas de dossier : il est en aperçu dans la palette, ou posé sur
 * l'accueil sans attache. Il le DIT — un rectangle vide laisserait croire à une
 * panne, et un bloc qui disparaît laisserait croire qu'il n'existe pas.
 */
const NoFolder: React.FC<{ label: string }> = ({ label }) => {
  const { t } = useTranslation();
  return (
    <FolderBlock label={label} empty={t('folder.widgets.noFolder', 'S’affiche dans un dossier.')} />
  );
};

/** Une ligne cliquable — la brique de quatre des six blocs. */
const Row: React.FC<{
  title: string;
  meta?: string;
  glyph?: string;
  onClick?: () => void;
}> = ({ title, meta, glyph, onClick }) => (
  <button type="button" className="folder-block__row" onClick={onClick} disabled={!onClick}>
    {glyph && (
      <span className="folder-block__glyph" aria-hidden="true">
        {glyph}
      </span>
    )}
    <span className="folder-block__row-title">{title}</span>
    {meta && <span className="folder-block__row-meta">{meta}</span>}
  </button>
);

/** Le nombre de lignes qu'un bloc de deux rangées peut montrer sans tricher. */
const ROW_LIMIT = 6;

// ==================== Récents de ce dossier ====================

export const FolderRecentsWidget: React.FC<WidgetProps> = React.memo(function FolderRecentsWidget({
  binding,
}) {
  const { t } = useTranslation();
  const actions = useHomeActions();
  const folderId = useWidgetFolderId(binding);
  const foldersById = useSelector((state: RootState) => state.folders.byId);
  const filesById = useSelector((state: RootState) => state.files.byId);

  const recent = useMemo(
    () => byRecency(directItems(foldersById, filesById, folderId)).slice(0, ROW_LIMIT),
    [foldersById, filesById, folderId]
  );

  const label = t('folder.widgets.recents', 'Récents de ce dossier');
  if (!folderId) return <NoFolder label={label} />;

  return (
    <FolderBlock
      label={label}
      empty={t('folder.widgets.recentsEmpty', 'Rien n’a encore été modifié ici.')}
    >
      {recent.length > 0 ? (
        <div className="folder-block__rows">
          {recent.map((item) => (
            <Row
              key={item.id}
              glyph={'items' in item ? '📁' : '📄'}
              title={item.name}
              meta={formatWhen(item.updatedAt)}
              onClick={
                'items' in item
                  ? () => actions.openFolder(item.id)
                  : () => actions.showDetails(item as Item)
              }
            />
          ))}
        </div>
      ) : undefined}
    </FolderBlock>
  );
});

// ==================== Sous-dossiers épinglés ====================

/**
 * ÉPINGLÉ veut dire FAVORI, et pas une seconde liste. Le produit a déjà des
 * favoris, avec leur geste, leur menu et leur barre latérale ; inventer un
 * « épinglage » propre au bandeau aurait donné deux listes à entretenir dont
 * l'une n'apparaît nulle part ailleurs.
 */
export const FolderPinnedWidget: React.FC<WidgetProps> = React.memo(function FolderPinnedWidget({
  binding,
}) {
  const { t } = useTranslation();
  const actions = useHomeActions();
  const folderId = useWidgetFolderId(binding);
  const foldersById = useSelector((state: RootState) => state.folders.byId);
  const filesById = useSelector((state: RootState) => state.files.byId);
  const favorites = useSelector((state: RootState) => state.favorites.favorites);

  const pinned = useMemo<Folder[]>(() => {
    const favoriteIds = new Set(favorites.map((favorite) => favorite.itemId));
    return directSubfolders(foldersById, filesById, folderId).filter((folder) =>
      favoriteIds.has(folder.id)
    );
  }, [foldersById, filesById, folderId, favorites]);

  const label = t('folder.widgets.pinned', 'Sous-dossiers épinglés');
  if (!folderId) return <NoFolder label={label} />;

  return (
    <FolderBlock
      label={label}
      count={pinned.length || undefined}
      empty={t(
        'folder.widgets.pinnedEmpty',
        'Ajoutez un sous-dossier aux favoris pour l’épingler ici.'
      )}
    >
      {pinned.length > 0 ? (
        <div className="folder-block__rows">
          {pinned.slice(0, ROW_LIMIT).map((folder) => (
            <Row
              key={folder.id}
              glyph={folder.emoji || '📁'}
              title={folder.name}
              meta={t('folder.items', { count: folder.items?.length ?? 0 })}
              onClick={() => actions.openFolder(folder.id)}
            />
          ))}
        </div>
      ) : undefined}
    </FolderBlock>
  );
});

// ==================== Stockage de ce dossier ====================

export const FolderStorageWidget: React.FC<WidgetProps> = React.memo(function FolderStorageWidget({
  binding,
}) {
  const { t } = useTranslation();
  const folderId = useWidgetFolderId(binding);
  const foldersById = useSelector((state: RootState) => state.folders.byId);
  const filesById = useSelector((state: RootState) => state.files.byId);

  const stats = useMemo(
    () => subtreeStats(foldersById, filesById, folderId),
    [foldersById, filesById, folderId]
  );

  const label = t('folder.widgets.storage', 'Stockage de ce dossier');
  if (!folderId) return <NoFolder label={label} />;

  return (
    <FolderBlock label={label}>
      <div className="folder-block__stats">
        <p className="folder-block__figure">{formatBytes(stats.bytes)}</p>
        <p className="folder-block__caption">
          {t('folder.widgets.storageDetail', '{{files}} fichier(s) · {{folders}} sous-dossier(s)', {
            files: stats.files,
            folders: stats.folders,
          })}
        </p>
      </div>
    </FolderBlock>
  );
});

// ==================== Membres et partage ====================

/**
 * Un dossier de l'espace PERSONNEL n'a pas de membres, et le dire est une
 * information — pas un vide. Ce bloc existe pour les coffres partagés, où le
 * même bandeau listera les membres ; ici il répond à la question qu'on se pose
 * en le regardant : « qui d'autre voit ça ? ».
 */
export const FolderMembersWidget: React.FC<WidgetProps> = React.memo(function FolderMembersWidget({
  binding,
}) {
  const { t } = useTranslation();
  const folderId = useWidgetFolderId(binding);
  const vaultCount = useSelector((state: RootState) => state.vaults.vaultIds.length);

  const label = t('folder.widgets.members', 'Membres et partage');
  if (!folderId) return <NoFolder label={label} />;

  return (
    <FolderBlock label={label}>
      <div className="folder-block__stats">
        <p className="folder-block__caption">
          {t(
            'folder.widgets.membersPrivate',
            'Ce dossier est personnel : personne d’autre n’y a accès.'
          )}
        </p>
        {vaultCount > 0 && (
          <p className="folder-block__caption">
            {t(
              'folder.widgets.membersHint',
              'Clic droit → « Ajouter au coffre partagé… » pour le partager avec une équipe.'
            )}
          </p>
        )}
      </div>
    </FolderBlock>
  );
});

// ==================== Tâches du dossier ====================

export const FolderTasksWidget: React.FC<WidgetProps> = React.memo(function FolderTasksWidget({
  binding,
}) {
  const { t } = useTranslation();
  const actions = useHomeActions();
  const folderId = useWidgetFolderId(binding);
  const notesById = useSelector((state: RootState) => state.notes.byId);

  const tasks = useMemo(
    () => pendingTasks(notesOfFolder(notesById, folderId), ROW_LIMIT),
    [notesById, folderId]
  );

  const label = t('folder.widgets.tasks', 'Tâches du dossier');
  if (!folderId) return <NoFolder label={label} />;

  return (
    <FolderBlock
      label={label}
      count={tasks.length || undefined}
      empty={t('folder.widgets.tasksEmpty', 'Aucune tâche en attente dans les notes d’ici.')}
    >
      {tasks.length > 0 ? (
        <div className="folder-block__rows">
          {tasks.map((task, index) => (
            <Row
              key={`${task.noteId}-${index}`}
              glyph="☐"
              title={task.text}
              meta={task.noteTitle}
              onClick={() => actions.openNote(task.noteId)}
            />
          ))}
        </div>
      ) : undefined}
    </FolderBlock>
  );
});

// ==================== Activité ====================

export const FolderActivityWidget: React.FC<WidgetProps> = React.memo(
  function FolderActivityWidget({ binding }) {
    const { t } = useTranslation();
    const actions = useHomeActions();
    const folderId = useWidgetFolderId(binding);
    const foldersById = useSelector((state: RootState) => state.folders.byId);
    const filesById = useSelector((state: RootState) => state.files.byId);
    const notesById = useSelector((state: RootState) => state.notes.byId);

    /**
     * Fichiers, sous-dossiers ET notes dans une seule frise. Les notes vivent
     * dans une autre tranche du store que les fichiers, mais elles sont rangées
     * dans le même dossier : les séparer en deux listes obligerait à comparer
     * deux horloges à l'œil pour savoir ce qui a bougé en dernier.
     */
    const activity = useMemo(() => {
      const entries = [
        ...directItems(foldersById, filesById, folderId).map((item) => ({
          id: item.id,
          name: item.name,
          updatedAt: item.updatedAt,
          kind: 'items' in item ? ('folder' as const) : ('file' as const),
        })),
        ...notesOfFolder(notesById, folderId).map((note) => ({
          id: note.id,
          name: note.title,
          updatedAt: note.updatedAt,
          kind: 'note' as const,
        })),
      ];
      return byRecency(entries).slice(0, ROW_LIMIT);
    }, [foldersById, filesById, notesById, folderId]);

    const label = t('folder.widgets.activity', 'Activité');
    if (!folderId) return <NoFolder label={label} />;

    return (
      <FolderBlock
        label={label}
        empty={t('folder.widgets.activityEmpty', 'Aucune activité récente ici.')}
      >
        {activity.length > 0 ? (
          <div className="folder-block__rows">
            {activity.map((entry) => (
              <Row
                key={`${entry.kind}-${entry.id}`}
                glyph={entry.kind === 'folder' ? '📁' : entry.kind === 'note' ? '📝' : '📄'}
                title={entry.name}
                meta={formatWhen(entry.updatedAt)}
                onClick={
                  entry.kind === 'folder'
                    ? () => actions.openFolder(entry.id)
                    : entry.kind === 'note'
                      ? () => actions.openNote(entry.id)
                      : undefined
                }
              />
            ))}
          </div>
        ) : undefined}
      </FolderBlock>
    );
  }
);

// ==================== Dates ====================

/**
 * La date d'une ligne, courte. Pas de bibliothèque et pas de « il y a trois
 * jours » calculé à la main : une date localisée par l'API du navigateur suit
 * la langue de l'utilisateur sans que rien n'ait à être traduit.
 */
function formatWhen(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
