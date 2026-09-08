/**
 * QuickLookModal — Overlay fullscreen déclenché par la touche Espace
 *
 * Wrappe FilePreviewPanel en mode isQuickLook pour prévisualiser
 * un fichier sans quitter la vue courante.
 */

import React, { useEffect, useCallback } from 'react';
import { FilePreviewPanel } from './FilePreviewPanel';
import type { FileItem } from '../../../types';

interface QuickLookModalProps {
  file: FileItem | null;
  folderId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export const QuickLookModal: React.FC<QuickLookModalProps> = ({ file, folderId, isOpen, onClose }) => {
  // Fermer sur Escape (en plus du Space géré par FilePreviewPanel)
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleKeyDown]);

  if (!isOpen || !file) return null;

  return (
    <div
    // chrome:free — cadre centre a 85vh : son bord haut depasse 40px.
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => {
        // Fermer si clic sur le backdrop (pas sur le contenu)
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-[90vw] h-[85vh] max-w-[1200px] rounded-xl overflow-hidden shadow-2xl bg-[var(--color-surface)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Bouton fermer */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors"
          title="Fermer (Espace ou Échap)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <FilePreviewPanel
          file={file}
          folderId={folderId}
          isOpen={true}
          onClose={onClose}
          isQuickLook={true}
          className="h-full"
        />
      </div>
    </div>
  );
};

export default QuickLookModal;
