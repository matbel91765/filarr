/**
 * OutlinePanel — Filarr Notes
 *
 * Table of contents sidebar extracted from headings in the active note.
 * Parses TipTap JSON content and renders a clickable heading hierarchy.
 */

import React, { useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import type { RootState } from '../../../store';
import './OutlinePanel.css';

// ==================== Types ====================

interface HeadingItem {
  id: string;
  text: string;
  level: number;
}

// ==================== Heading Extraction ====================

function extractHeadings(contentJson: string): HeadingItem[] {
  try {
    const doc = JSON.parse(contentJson);
    if (!doc?.content) return [];
    const headings: HeadingItem[] = [];
    let idx = 0;
    for (const node of doc.content) {
      if (node.type === 'heading' && node.attrs?.level) {
        const text = extractText(node);
        if (text.trim()) {
          headings.push({
            id: `heading-${idx++}`,
            text: text.trim(),
            level: node.attrs.level,
          });
        }
      }
    }
    return headings;
  } catch {
    return [];
  }
}

function extractText(node: any): string {
  if (typeof node === 'string') return node;
  if (node.text) return node.text;
  if (node.content) return node.content.map(extractText).join('');
  return '';
}

// ==================== Component ====================

interface OutlinePanelProps {
  noteId: string;
  /** Callback to scroll the editor to a heading index */
  onScrollToHeading?: (headingIndex: number) => void;
}

export const OutlinePanel: React.FC<OutlinePanelProps> = React.memo(function OutlinePanel({
  noteId,
  onScrollToHeading,
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const content = useSelector((s: RootState) => s.notes.byId[noteId]?.content ?? '');

  const headings = useMemo(() => extractHeadings(content), [content]);

  const handleClick = useCallback(
    (index: number) => {
      if (onScrollToHeading) {
        onScrollToHeading(index);
        return;
      }
      // Fallback: find heading elements in the editor DOM
      const editorEl = document.querySelector('.note-editor__body .ProseMirror');
      if (!editorEl) return;
      const hEls = editorEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
      const target = hEls[index];
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Brief highlight
        target.classList.add('outline-highlight');
        setTimeout(() => target.classList.remove('outline-highlight'), 1500);
      }
    },
    [onScrollToHeading]
  );

  if (headings.length === 0) return null;

  return (
    <div className="outline-panel">
      <button
        className="outline-panel__header"
        onClick={() => setExpanded(!expanded)}
      >
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="currentColor"
          style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
        >
          <path d="M8 5l8 7-8 7z" />
        </svg>
        <span>{t('notes.outline', 'Outline')}</span>
        <span className="outline-panel__count">{headings.length}</span>
      </button>

      {expanded && (
        <div className="outline-panel__list">
          {headings.map((h, i) => (
            <button
              key={h.id}
              className={`outline-panel__item outline-panel__item--h${h.level}`}
              onClick={() => handleClick(i)}
              title={h.text}
            >
              <span className="outline-panel__item-marker">{'H' + h.level}</span>
              <span className="outline-panel__item-text">{h.text}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
