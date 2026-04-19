/**
 * TocNodeView — Filarr Notes
 *
 * React NodeView for the inline Table of Contents block.
 * Extracts headings live from the editor document.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { NodeViewWrapper } from '@tiptap/react';

interface HeadingItem {
  text: string;
  level: number;
  index: number;
}

interface TocNodeViewProps {
  editor: any;
  selected: boolean;
}

export const TocNodeView: React.FC<TocNodeViewProps> = ({ editor, selected }) => {
  const [headings, setHeadings] = useState<HeadingItem[]>([]);

  // Extract headings from editor doc
  const updateHeadings = useCallback(() => {
    if (!editor) return;
    const items: HeadingItem[] = [];
    let idx = 0;
    editor.state.doc.descendants((node: any) => {
      if (node.type.name === 'heading') {
        const text = node.textContent;
        if (text.trim()) {
          items.push({ text: text.trim(), level: node.attrs.level, index: idx++ });
        }
      }
    });
    setHeadings(items);
  }, [editor]);

  useEffect(() => {
    updateHeadings();
    if (!editor) return;
    editor.on('update', updateHeadings);
    return () => { editor.off('update', updateHeadings); };
  }, [editor, updateHeadings]);

  const scrollToHeading = useCallback(
    (index: number) => {
      const editorEl = document.querySelector('.note-editor__body .ProseMirror');
      if (!editorEl) return;
      const hEls = editorEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
      const target = hEls[index];
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('outline-highlight');
        setTimeout(() => target.classList.remove('outline-highlight'), 1500);
      }
    },
    []
  );

  return (
    <NodeViewWrapper className={`toc-block ${selected ? 'toc-block--selected' : ''}`} data-toc="">
      <div className="toc-block__header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
        <span>Table of Contents</span>
      </div>
      {headings.length === 0 ? (
        <div className="toc-block__empty">Add headings to generate a table of contents</div>
      ) : (
        <div className="toc-block__list">
          {headings.map((h) => (
            <button
              key={h.index}
              className={`toc-block__item toc-block__item--h${h.level}`}
              onClick={() => scrollToHeading(h.index)}
            >
              {h.text}
            </button>
          ))}
        </div>
      )}
    </NodeViewWrapper>
  );
};
