/**
 * FileEmbedNodeView — React NodeView for the FileEmbed TipTap extension.
 *
 * Renders images with corner resize handles and file cards for non-images.
 * Width is stored as a node attribute so it persists with the document.
 */

import React, { useCallback, useRef, useState } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import { NoteImageContextMenu } from '../NoteImageContextMenu';
import { copyNoteImage, saveNoteImageAs } from '../../../../services/notes/noteImageClipboard';
import {
  notifyImageCopied,
  notifyImageCopyFailed,
  notifyImageSaveFailed,
  notifyImageSaved,
} from './fileEmbedFeedback';

interface FileEmbedNodeViewProps {
  node: {
    attrs: {
      fileId: string;
      fileName: string;
      fileType: string;
      src: string | null;
      width: number | null;
    };
  };
  updateAttributes: (attrs: Record<string, unknown>) => void;
  selected: boolean;
}

function getFileIcon(fileType: string): string {
  if (/^image/i.test(fileType)) return '\uD83D\uDDBC\uFE0F';
  if (/pdf/i.test(fileType)) return '\uD83D\uDCC4';
  if (/spreadsheet|excel|csv/i.test(fileType)) return '\uD83D\uDCCA';
  if (/word|document/i.test(fileType)) return '\uD83D\uDCDD';
  if (/zip|archive|rar/i.test(fileType)) return '\uD83D\uDCE6';
  if (/video/i.test(fileType)) return '\uD83C\uDFAC';
  if (/audio/i.test(fileType)) return '\uD83C\uDFB5';
  return '\uD83D\uDCCE';
}

export const FileEmbedNodeView: React.FC<FileEmbedNodeViewProps> = ({
  node,
  updateAttributes,
  selected,
}) => {
  const { fileId, fileName, fileType, src, width } = node.attrs;
  const isImage = /^image\//i.test(fileType || '');
  const containerRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);

  const handleCopy = useCallback(() => {
    if (!src) return;
    void copyNoteImage(src, fileName).then((ok) => {
      if (ok) notifyImageCopied();
      else notifyImageCopyFailed();
    });
  }, [src, fileName]);

  const handleSaveAs = useCallback(() => {
    if (!src) return;
    void saveNoteImageAs(src, fileName).then((outcome) => {
      // « cancelled » n'est pas un échec : l'utilisateur a fermé le dialogue.
      if (outcome === 'saved') notifyImageSaved();
      else if (outcome === 'failed') notifyImageSaveFailed();
    });
  }, [src, fileName]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsResizing(true);

      const startX = e.clientX;
      const startWidth = containerRef.current?.offsetWidth || 300;

      const onMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        const newWidth = Math.max(100, Math.min(startWidth + delta, 1200));
        if (containerRef.current) {
          containerRef.current.style.width = `${newWidth}px`;
        }
      };

      const onMouseUp = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        const newWidth = Math.max(100, Math.min(startWidth + delta, 1200));
        updateAttributes({ width: Math.round(newWidth) });
        setIsResizing(false);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [updateAttributes]
  );

  if (isImage && src) {
    return (
      <NodeViewWrapper className="file-embed-wrapper">
        <div
          ref={containerRef}
          className={`file-embed file-embed--image ${selected ? 'file-embed--selected' : ''} ${isResizing ? 'file-embed--resizing' : ''}`}
          style={width ? { width: `${width}px` } : undefined}
          data-file-embed=""
          // `stopPropagation` : sans ça, le gestionnaire de clic droit du
          // corps de l'éditeur (menu « lien vers ce bloc ») verrait aussi
          // l'évènement. Et sans `preventDefault`, Electron n'affiche RIEN —
          // il n'a pas de menu contextuel natif.
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMenuAt({ x: e.clientX, y: e.clientY });
          }}
        >
          <img src={src} alt={fileName} className="file-embed__img" draggable={false} />
          <span className="file-embed__caption">{fileName}</span>

          {/* Resize handle (bottom-right corner) */}
          <div
            className="file-embed__resize-handle"
            onMouseDown={handleResizeStart}
            title="Drag to resize"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <path d="M9 1v8H1" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M9 5v4H5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </div>
        </div>

        {menuAt && (
          <NoteImageContextMenu
            x={menuAt.x}
            y={menuAt.y}
            onCopy={handleCopy}
            onSaveAs={handleSaveAs}
            onClose={() => setMenuAt(null)}
          />
        )}
      </NodeViewWrapper>
    );
  }

  // Non-image file card
  return (
    <NodeViewWrapper className="file-embed-wrapper">
      <div
        className={`file-embed file-embed--file ${selected ? 'file-embed--selected' : ''}`}
        data-file-embed=""
      >
        <div className="file-embed__icon">
          <span>{getFileIcon(fileType || '')}</span>
        </div>
        <div className="file-embed__info">
          <span className="file-embed__name">{fileName}</span>
          <span className="file-embed__type">{fileType || 'File'}</span>
        </div>
      </div>
    </NodeViewWrapper>
  );
};
