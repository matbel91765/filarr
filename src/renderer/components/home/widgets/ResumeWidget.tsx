/**
 * Bloc « Reprendre » — les cinq dernières choses touchées, TOUS TYPES MÊLÉS.
 *
 * ── POURQUOI MÉLANGER ───────────────────────────────────────────────────────
 *
 * Le produit sépare déjà les fichiers des notes partout ailleurs, et c'est
 * justifié : ce sont deux façons de travailler. Mais « ce que je faisais il y a
 * dix minutes » ne connaît pas cette frontière — on a ouvert un dossier, puis
 * écrit une note, puis rouvert un fichier. Deux listes côte à côte obligeraient
 * à se demander de quel côté chercher, ce qui est exactement le travail que ce
 * bloc doit épargner.
 *
 * L'ordre est donc un seul : le plus récemment touché en premier, quelle que
 * soit sa nature. Le type ne survit que dans la pastille de gauche.
 *
 * ── DES LIGNES, PAS DES CARTES ──────────────────────────────────────────────
 *
 * Cinq cartes à bordure font cinq boîtes qu'on compte ; cinq lignes font une
 * liste qu'on lit. Le repère est le filet entre deux lignes (`.home-line`), et
 * le survol allume un fond — jamais un contour.
 *
 * ── CE QUE LA LISTE ÉCARTE ──────────────────────────────────────────────────
 *
 * · Les notes QUOTIDIENNES (via `selectAuthoredNotesByRecency`) : elles sont
 *   touchées chaque jour et évinceraient tout le reste.
 * · Les récents dont la cible n'existe plus (fichier supprimé, dossier
 *   effacé) : une ligne qui n'ouvre rien est pire que pas de ligne du tout.
 */

import React, { useCallback } from 'react';
import { createSelector } from '@reduxjs/toolkit';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import type { RootState } from '../../../../store';
import type { Folder } from '../../../../types';
import { useHomeActions } from '../HomeActionsContext';
import { selectAuthoredNotesByRecency } from '../homeSelectors';
import type { WidgetOptionSchema, WidgetProps } from '../widgetOptions';
import { FRAME_OPTION, WidgetSurface, frameOf } from './WidgetSurface';
import { useRelativeTime } from './relativeTime';
import { vaultRefOf } from '../../../../store/selectors/fileShortcutSelectors';

export const RESUME_OPTIONS: WidgetOptionSchema = [FRAME_OPTION];

/** Ce que la ligne doit savoir. Rien de plus : la vue ne relit pas le store. */
interface ResumeEntry {
  key: string;
  kind: 'note' | 'file' | 'folder';
  /** Cible d'ouverture : la note, ou le dossier (le sien pour un fichier). */
  targetId: string;
  name: string;
  /** Horodatage retenu pour le tri — dernier accès, ou dernière écriture. */
  at: string;
  /** Pastille : la couleur et l'emoji du dossier, quand il y en a. */
  color?: string;
  emoji?: string;
  /** Un fichier-RACCOURCI : il se reprend dans le coffre, sur l'élément. */
  vault?: { vaultId: string; itemId: string };
}

/** Combien de lignes. Cinq : la conception, et la hauteur d'un bloc de 3 rangées. */
const RESUME_LIMIT = 5;

/**
 * Le dérivé, mémoïsé AU NIVEAU DU MODULE. Défini dans un composant, il naîtrait
 * à chaque rendu et ne mémoriserait rien — et `useSelector` comparant par
 * identité, l'accueil se re-rendrait à chaque action du store.
 */
export const selectResumeEntries = createSelector(
  [
    (state: RootState) => state.favorites.recentFiles,
    selectAuthoredNotesByRecency,
    (state: RootState) => state.folders.byId,
    (state: RootState) => state.files.byId,
  ],
  (recents, notes, foldersById, filesById): ResumeEntry[] => {
    const entries: ResumeEntry[] = [];

    for (const recent of recents) {
      if (recent.itemType === 'folder') {
        const folder = foldersById[recent.itemId] as Folder | undefined;
        if (!folder || folder.deletedAt) continue;
        entries.push({
          key: `folder-${recent.itemId}`,
          kind: 'folder',
          targetId: folder.id,
          name: folder.name || recent.name,
          at: recent.accessedAt,
          color: folder.color,
          emoji: folder.emoji,
        });
        continue;
      }
      const file = filesById[recent.itemId];
      if (!file || file.deletedAt) continue;
      // Un fichier s'ouvre DANS son dossier : l'accueil n'a pas de visionneuse,
      // et `HomeActions` n'expose pas d'ouverture de fichier. Sans dossier
      // parent connu, la ligne n'ouvrirait rien — on la retire.
      const parent = (Object.values(foldersById) as Folder[]).find(
        (candidate) => !candidate.deletedAt && candidate.items?.includes(recent.itemId)
      );
      if (!parent) continue;
      const shortcutRef = vaultRefOf(file);
      entries.push({
        key: `file-${recent.itemId}`,
        kind: 'file',
        targetId: parent.id,
        name: file.name || recent.name,
        at: recent.accessedAt,
        vault: shortcutRef
          ? { vaultId: shortcutRef.vaultId, itemId: shortcutRef.itemId }
          : undefined,
      });
    }

    for (const note of notes.slice(0, RESUME_LIMIT)) {
      entries.push({
        key: `note-${note.id}`,
        kind: 'note',
        targetId: note.id,
        name: note.title,
        at: note.updatedAt,
      });
    }

    return entries
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, RESUME_LIMIT);
  }
);

/** Rien à reprendre : ni récent utilisable, ni note écrite. */
export function isResumeEmpty(state: RootState): boolean {
  return selectResumeEntries(state).length === 0;
}

// ==================== Pastilles ====================

const NoteGlyph: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.6}
    stroke="currentColor"
    className="w-4 h-4"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"
    />
  </svg>
);

const FileGlyph: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.6}
    stroke="currentColor"
    className="w-4 h-4"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25M9 16.5v.75m3-3v3M15 12v5.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
    />
  </svg>
);

const FolderGlyph: React.FC<{ color?: string }> = ({ color }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill={color || 'var(--color-primary-500)'}
    viewBox="0 0 24 24"
    className="w-4 h-4"
    aria-hidden="true"
  >
    <path d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
  </svg>
);

/** Une ligne, isolée pour que son rappel ait une identité stable par entrée. */
const ResumeLine: React.FC<{
  entry: ResumeEntry;
  when: string;
  onOpen: (entry: ResumeEntry) => void;
}> = React.memo(function ResumeLine({ entry, when, onOpen }) {
  const open = useCallback(() => onOpen(entry), [onOpen, entry]);

  return (
    <button type="button" className="home-line" onClick={open} title={entry.name}>
      <span
        className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center
        text-[var(--color-text-tertiary)]"
        style={{
          backgroundColor: entry.color
            ? `color-mix(in srgb, ${entry.color} 18%, transparent)`
            : 'var(--color-background-secondary)',
        }}
        aria-hidden="true"
      >
        {entry.emoji ? (
          <span className="text-base leading-none">{entry.emoji}</span>
        ) : entry.kind === 'folder' ? (
          <FolderGlyph color={entry.color} />
        ) : entry.kind === 'note' ? (
          <NoteGlyph />
        ) : (
          <FileGlyph />
        )}
      </span>
      <span className="min-w-0 flex-1 text-sm text-[var(--color-text-primary)] truncate">
        {entry.name}
      </span>
      <span className="shrink-0 text-xs text-[var(--color-text-tertiary)]">{when}</span>
    </button>
  );
});

export const ResumeWidget: React.FC<WidgetProps> = React.memo(function ResumeWidget({ options }) {
  const { t } = useTranslation();
  const actions = useHomeActions();
  const entries = useSelector(selectResumeEntries);
  const relative = useRelativeTime();
  const frame = frameOf(options);

  const open = useCallback(
    (entry: ResumeEntry) => {
      if (entry.kind === 'note') actions.openNote(entry.targetId);
      // Un raccourci se reprend là où sont ses octets : dans le coffre.
      else if (entry.vault) actions.openVault(entry.vault.vaultId, entry.vault.itemId);
      else actions.openFolder(entry.targetId);
    },
    [actions]
  );

  return (
    <WidgetSurface frame={frame} label={t('home.resume.title', 'Reprendre')}>
      {entries.length === 0 ? (
        <p className="text-xs text-[var(--color-text-tertiary)] m-0">
          {t('home.resume.empty', 'Rien à reprendre pour le moment.')}
        </p>
      ) : (
        <div className="flex flex-col">
          {entries.map((entry) => (
            <ResumeLine key={entry.key} entry={entry} when={relative(entry.at)} onOpen={open} />
          ))}
        </div>
      )}
    </WidgetSurface>
  );
});

export default ResumeWidget;
