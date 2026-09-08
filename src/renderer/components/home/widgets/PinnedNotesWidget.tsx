/**
 * Bloc « Notes épinglées ».
 *
 * ── ÉPINGLER EST UNE INTENTION, PAS UN TRI ──────────────────────────────────
 *
 * « Notes récentes » répond à « qu'ai-je écrit hier ? ». Ce bloc répond à
 * « qu'est-ce que je garde sous la main ? », et les deux réponses n'ont aucune
 * raison de coïncider : une note de référence qu'on relit sans la modifier tombe
 * du classement par récence au bout d'une semaine, alors même que c'est elle
 * qu'on veut voir tous les jours.
 *
 * L'épingle existe déjà dans la liste des notes (`isPinned`, qui les remonte en
 * tête) : ce bloc ne crée aucun état, il montre celui-là.
 */

import React, { useCallback } from 'react';
import { createSelector } from '@reduxjs/toolkit';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import type { RootState } from '../../../../store';
import type { Note } from '../../../../types/notes';
import { useHomeActions } from '../HomeActionsContext';
import { selectAuthoredNotesByRecency } from '../homeSelectors';
import type { WidgetOptionSchema, WidgetProps } from '../widgetOptions';
import { FRAME_OPTION, WidgetSurface, frameOf } from './WidgetSurface';

export const PINNED_NOTES_OPTIONS: WidgetOptionSchema = [FRAME_OPTION];

/** Six : au-delà, l'épingle ne veut plus rien dire (tout est épinglé). */
const PINNED_LIMIT = 6;

/**
 * Le dérivé, mémoïsé AU NIVEAU DU MODULE (voir `homeSelectors`). Il part des
 * notes ÉCRITES : les quotidiennes sont déjà écartées en amont, et une
 * quotidienne épinglée reviendrait de toute façon chaque jour.
 */
export const selectPinnedNotes = createSelector([selectAuthoredNotesByRecency], (notes): Note[] =>
  notes.filter((note) => note.isPinned).slice(0, PINNED_LIMIT)
);

/** Aucune note épinglée ⇒ aucun bloc. */
export function isPinnedNotesEmpty(state: RootState): boolean {
  return selectPinnedNotes(state).length === 0;
}

/**
 * L'icône d'une note accepte trois encodages (voir `Note.icon`) : un emoji brut,
 * `lucide:<Nom>`, ou `img:<dataUrl>`. Seul le premier s'affiche tel quel ; les
 * deux autres demanderaient la table d'icônes et un `<img>`, pour une ligne de
 * huit pixels de haut. On retombe donc sur la pastille par défaut.
 */
function rawEmoji(icon: string | undefined): string | null {
  if (!icon) return null;
  if (icon.startsWith('lucide:') || icon.startsWith('img:')) return null;
  return icon;
}

const PinIcon: React.FC = () => (
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
      d="M12 21v-8m0 0l4.5-1.5V6L12 4.5 7.5 6v5.5L12 13z"
    />
  </svg>
);

/** Une ligne, isolée pour que son rappel ait une identité stable par note. */
const PinnedNoteLine: React.FC<{
  note: Note;
  onOpen: (noteId: string) => void;
}> = React.memo(function PinnedNoteLine({ note, onOpen }) {
  const { t } = useTranslation();
  const open = useCallback(() => onOpen(note.id), [onOpen, note.id]);
  const emoji = rawEmoji(note.icon);
  const title = note.title || t('home.pinnedNotes.untitled', 'Note sans titre');

  return (
    <button type="button" className="home-line" onClick={open} title={title}>
      <span
        className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center
        bg-[var(--color-background-secondary)] text-[var(--color-text-tertiary)]"
        aria-hidden="true"
      >
        {emoji ? <span className="text-base leading-none">{emoji}</span> : <PinIcon />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-[var(--color-text-primary)] truncate">{title}</span>
        {note.plainText?.trim() && (
          <span className="block text-xs text-[var(--color-text-tertiary)] truncate">
            {note.plainText.trim().slice(0, 80)}
          </span>
        )}
      </span>
    </button>
  );
});

export const PinnedNotesWidget: React.FC<WidgetProps> = React.memo(function PinnedNotesWidget({
  options,
}) {
  const { t } = useTranslation();
  const actions = useHomeActions();
  const notes = useSelector(selectPinnedNotes);
  const frame = frameOf(options);

  return (
    <WidgetSurface
      frame={frame}
      label={t('home.pinnedNotes.title', 'Notes épinglées')}
      actions={
        <button
          type="button"
          onClick={actions.seeAllNotes}
          className="text-xs text-[var(--color-primary-500)] hover:underline px-1"
        >
          {t('home.seeAllNotes', 'Toutes les notes')}
        </button>
      }
    >
      {notes.length === 0 ? (
        <p className="text-xs text-[var(--color-text-tertiary)] m-0">
          {t('home.pinnedNotes.empty', 'Épinglez une note pour la garder ici.')}
        </p>
      ) : (
        <div className="flex flex-col">
          {notes.map((note) => (
            <PinnedNoteLine key={note.id} note={note} onOpen={actions.openNote} />
          ))}
        </div>
      )}
    </WidgetSurface>
  );
});

export default PinnedNotesWidget;
