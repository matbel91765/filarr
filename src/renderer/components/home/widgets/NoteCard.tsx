/**
 * La carte d'une note sur l'accueil.
 *
 * Deux blocs l'affichent (« Notes sans dossier » et « Notes récentes ») et
 * l'ancien accueil en portait deux copies caractère pour caractère. Une seule
 * définition : deux cartes de note ne doivent pas pouvoir diverger.
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

export interface NoteCardProps {
  noteId: string;
  title: string;
  excerpt: string;
  onOpen: (noteId: string) => void;
}

export const NoteCard: React.FC<NoteCardProps> = React.memo(function NoteCard({
  noteId,
  title,
  excerpt,
  onOpen,
}) {
  const { t } = useTranslation();

  const open = useCallback(() => onOpen(noteId), [onOpen, noteId]);

  return (
    <div
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      role="button"
      tabIndex={0}
      className="flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer bg-[var(--color-surface)] border border-[var(--color-border)] shadow-sm hover:shadow-md transition-shadow"
    >
      <span className="text-lg leading-none shrink-0" aria-hidden="true">
        📝
      </span>
      <div className="min-w-0">
        <div className="text-sm font-medium truncate text-[var(--color-text-primary)]">
          {title || t('notes.untitled', 'Sans titre')}
        </div>
        <div className="text-xs truncate text-[var(--color-text-tertiary)]">
          {excerpt || t('home.emptyNote', 'Note vide')}
        </div>
      </div>
    </div>
  );
});

export default NoteCard;
