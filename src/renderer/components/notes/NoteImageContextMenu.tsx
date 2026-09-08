/**
 * NoteImageContextMenu — clic droit sur une image d'une note.
 *
 * Electron n'installe AUCUN menu contextuel : sans ce composant, le clic droit
 * sur une image ne fait rien du tout (pas de « Copier l'image » comme dans un
 * navigateur). Rendu par un portail sur `document.body` : à l'intérieur du
 * `contenteditable`, ProseMirror reprendrait le focus au premier clic.
 *
 * Congédié par un clic à l'extérieur, Échap, ou un défilement — même contrat
 * que `BlockLinkContextMenu`.
 */

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

interface NoteImageContextMenuProps {
  x: number;
  y: number;
  onCopy: () => void;
  onSaveAs: () => void;
  onClose: () => void;
}

export const NoteImageContextMenu: React.FC<NoteImageContextMenuProps> = ({
  x,
  y,
  onCopy,
  onSaveAs,
  onClose,
}) => {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Un tour d'horloge d'attente : le clic droit qui vient d'ouvrir le menu
    // déclencherait sinon la fermeture immédiate.
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', onClick);
      document.addEventListener('keydown', onKey);
      document.addEventListener('scroll', onClose, true);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="note-image-menu"
      // Le menu ne doit pas déborder de la fenêtre quand le clic est près du
      // bord droit / bas : on le décale de sa propre taille estimée.
      style={{
        position: 'fixed',
        left: Math.min(x, window.innerWidth - 220),
        top: Math.min(y, window.innerHeight - 96),
      }}
      role="menu"
    >
      <button
        type="button"
        role="menuitem"
        className="note-image-menu__item"
        onClick={() => {
          onCopy();
          onClose();
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
        <span>{t('notes.image.copy', { defaultValue: 'Copy image' })}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="note-image-menu__item"
        onClick={() => {
          onSaveAs();
          onClose();
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="7,10 12,15 17,10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <span>{t('notes.image.saveAs', { defaultValue: 'Save image as…' })}</span>
      </button>
    </div>,
    document.body
  );
};
