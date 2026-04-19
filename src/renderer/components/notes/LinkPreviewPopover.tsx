/**
 * LinkPreviewPopover — Filarr Notes
 *
 * Floating card that appears when hovering over a [[wiki-link]] in the editor.
 * Supports notes, files, and folders with appropriate previews.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../store';
import { setEditingNote } from '../../../store/slices/notesSlice';

type LinkType = 'note' | 'file' | 'folder';

interface PopoverState {
  type: LinkType;
  target: string; // name or ID used for lookup
  x: number;
  y: number;
}

interface LinkPreviewPopoverProps {
  editorEl: HTMLElement | null;
}

// ---- File type icons ----
const FILE_ICONS: Record<string, string> = {
  image: '\uD83D\uDDBC\uFE0F',
  pdf: '\uD83D\uDCC4',
  spreadsheet: '\uD83D\uDCCA',
  word: '\uD83D\uDCDD',
  archive: '\uD83D\uDCE6',
  video: '\uD83C\uDFAC',
  audio: '\uD83C\uDFB5',
  code: '\uD83D\uDCBB',
  default: '\uD83D\uDCCE',
};

function getFileIcon(type: string): string {
  if (/^image/i.test(type)) return FILE_ICONS.image;
  if (/pdf/i.test(type)) return FILE_ICONS.pdf;
  if (/spreadsheet|excel|csv/i.test(type)) return FILE_ICONS.spreadsheet;
  if (/word|document|docx/i.test(type)) return FILE_ICONS.word;
  if (/zip|archive|rar|7z/i.test(type)) return FILE_ICONS.archive;
  if (/video/i.test(type)) return FILE_ICONS.video;
  if (/audio/i.test(type)) return FILE_ICONS.audio;
  if (/javascript|typescript|python|java|html|css|json/i.test(type)) return FILE_ICONS.code;
  return FILE_ICONS.default;
}

function formatSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export const LinkPreviewPopover: React.FC<LinkPreviewPopoverProps> = React.memo(
  function LinkPreviewPopover({ editorEl }) {
    const [popover, setPopover] = useState<PopoverState | null>(null);
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dispatch = useDispatch<AppDispatch>();
    const notesById = useSelector((s: RootState) => s.notes.byId);
    const filesById = useSelector((s: RootState) => s.files.byId);
    const foldersById = useSelector((s: RootState) => s.folders.byId);

    const showPopover = useCallback((type: LinkType, target: string, rect: DOMRect) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (showTimer.current) clearTimeout(showTimer.current);
      // Delay before showing to avoid flicker on quick mouse movements
      showTimer.current = setTimeout(() => {
        // Always position ABOVE the link so it doesn't block clicking
        const y = rect.top - 8;
        setPopover({ type, target, x: Math.min(rect.left, window.innerWidth - 300), y });
      }, 400);
    }, []);

    const scheduleHide = useCallback(() => {
      if (showTimer.current) clearTimeout(showTimer.current);
      hideTimer.current = setTimeout(() => setPopover(null), 200);
    }, []);

    const cancelHide = useCallback(() => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    }, []);

    // Attach hover listeners to wiki-link decorations and note-link elements
    useEffect(() => {
      if (!editorEl) return;

      const handleMouseOver = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        // Check for wiki-link decoration (from WikiLinkDecorationExtension)
        const wikiLink = target.closest('.wiki-link') as HTMLElement | null;
        if (wikiLink) {
          const linkType = (wikiLink.getAttribute('data-link-type') || 'note') as LinkType;
          const linkTarget = wikiLink.getAttribute('data-link-target') || '';
          if (linkTarget) {
            showPopover(linkType, linkTarget, wikiLink.getBoundingClientRect());
          }
          return;
        }

        // Fallback: check for standard <a> links with note-link class
        const linkEl = target.closest('.note-link, a[href]') as HTMLElement | null;
        if (linkEl) {
          const linkText = (linkEl.textContent || '').replace(/^\[\[|\]\]$/g, '').trim();
          if (linkText) {
            showPopover('note', linkText, linkEl.getBoundingClientRect());
          }
        }
      };

      const handleMouseOut = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest('.wiki-link, .note-link, a[href]')) {
          scheduleHide();
        }
      };

      editorEl.addEventListener('mouseover', handleMouseOver);
      editorEl.addEventListener('mouseout', handleMouseOut);

      return () => {
        editorEl.removeEventListener('mouseover', handleMouseOver);
        editorEl.removeEventListener('mouseout', handleMouseOut);
      };
    }, [editorEl, showPopover, scheduleHide]);

    if (!popover) return null;

    // ---- Resolve target ----
    const { type, target: linkTarget } = popover;
    const lcTarget = linkTarget.toLowerCase();

    if (type === 'note') {
      const note = Object.values(notesById).find(
        (n) => !n.deletedAt && n.title.toLowerCase() === lcTarget
      );
      if (!note) return null;

      const preview = note.plainText
        ? note.plainText.replace(/\s+/g, ' ').trim().slice(0, 150) +
          (note.plainText.length > 150 ? '...' : '')
        : '';

      const dateStr = new Date(note.updatedAt).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });

      const handleNavigate = () => {
        dispatch(setEditingNote(note.id));
        setPopover(null);
      };

      return (
        <div
          className="link-preview-popover link-preview-popover--clickable"
          style={{
            left: popover.x,
            bottom: window.innerHeight - popover.y,
          }}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
          onClick={handleNavigate}
        >
          <div className="link-preview-popover__header">
            <span className="link-preview-popover__icon link-preview-popover__icon--note">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14,2 14,8 20,8" />
              </svg>
            </span>
            <span className="link-preview-popover__title">{note.title || 'Untitled'}</span>
          </div>
          {preview && <p className="link-preview-popover__text">{preview}</p>}
          <div className="link-preview-popover__meta">
            <span>{note.wordCount} mots</span>
            <span>{dateStr}</span>
            {note.linkedNoteIds.length > 0 && <span>{note.linkedNoteIds.length} liens</span>}
          </div>
        </div>
      );
    }

    if (type === 'file') {
      const file = Object.values(filesById).find((f) => f.name.toLowerCase() === lcTarget);
      if (!file) return null;

      const isImage = /^image\//i.test(file.type || '');
      const dateStr = file.date
        ? new Date(file.date).toLocaleDateString('fr-FR', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })
        : '';

      const positionAbove = popover.y < 100;

      return (
        <div
          className="link-preview-popover link-preview-popover--file"
          style={{
            left: popover.x,
            ...(positionAbove ? { bottom: window.innerHeight - popover.y } : { top: popover.y }),
          }}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          <div className="link-preview-popover__header">
            <span className="link-preview-popover__file-icon">{getFileIcon(file.type || '')}</span>
            <div className="link-preview-popover__file-info">
              <span className="link-preview-popover__title">{file.name}</span>
              <span className="link-preview-popover__file-type">
                {isImage ? 'Image' : file.type || 'File'}
              </span>
            </div>
          </div>
          {file.description && <p className="link-preview-popover__text">{file.description}</p>}
          <div className="link-preview-popover__meta">
            {file.size != null && <span>{formatSize(file.size)}</span>}
            {dateStr && <span>{dateStr}</span>}
            {(file as any).parentId && <span>In folder</span>}
          </div>
        </div>
      );
    }

    if (type === 'folder') {
      const folder = Object.values(foldersById).find((f) => f.name.toLowerCase() === lcTarget);
      if (!folder) return null;

      const itemCount = (folder as any).items?.length ?? 0;

      const positionAbove = popover.y < 100;

      return (
        <div
          className="link-preview-popover link-preview-popover--folder"
          style={{
            left: popover.x,
            ...(positionAbove ? { bottom: window.innerHeight - popover.y } : { top: popover.y }),
          }}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          <div className="link-preview-popover__header">
            <span
              className="link-preview-popover__folder-icon"
              style={{ color: (folder as any).color || 'var(--color-primary-500)' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
              </svg>
            </span>
            <span className="link-preview-popover__title">{folder.name}</span>
          </div>
          <div className="link-preview-popover__meta">
            <span>
              {itemCount} {itemCount === 1 ? 'item' : 'items'}
            </span>
            {(folder as any).protected && <span>Protected</span>}
          </div>
        </div>
      );
    }

    return null;
  }
);

export default LinkPreviewPopover;
