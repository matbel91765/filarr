/**
 * BlockLinkContextMenu — appears on right-click inside a paragraph or
 * heading in the note editor. Single action: "Copier le lien vers ce bloc",
 * which ensures the block has a `blockId` (lazy-generated) and writes
 * `![[CurrentNoteTitle^blockId]]` to the clipboard.
 *
 * The menu is dismissed by any outside click, Escape, or scroll.
 */

import React, { useEffect, useRef } from 'react';

interface BlockLinkContextMenuProps {
  x: number;
  y: number;
  onCopy: () => void;
  onClose: () => void;
}

export const BlockLinkContextMenu: React.FC<BlockLinkContextMenuProps> = ({
  x,
  y,
  onCopy,
  onClose,
}) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Wait one tick so the right-click that opened us doesn't immediately
    // close it via the mousedown handler.
    const t = setTimeout(() => {
      document.addEventListener('mousedown', onClick);
      document.addEventListener('keydown', onKey);
      document.addEventListener('scroll', onClose, true);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="block-link-context-menu"
      style={{ left: x, top: y, position: 'fixed' }}
      role="menu"
    >
      <button
        type="button"
        role="menuitem"
        className="block-link-context-menu__item"
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
          <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
        </svg>
        <span>Copier le lien vers ce bloc</span>
      </button>
    </div>
  );
};
