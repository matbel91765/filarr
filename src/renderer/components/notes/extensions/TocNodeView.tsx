/**
 * TocNodeView — Filarr Notes
 *
 * NodeView React du bloc « sommaire » inline. Les titres sont lus en direct
 * dans le document de l'éditeur.
 *
 * CE BLOC NE FAIT PLUS SA PROPRE CUISINE. Il portait auparavant sa propre
 * extraction (rang compté sur les seuls titres NON VIDES) et sa propre ancre
 * (`querySelectorAll('h1..h6')[index]`, qui rend TOUS les titres, vides et
 * transclus compris). Le sommaire latéral et le bloc /toc de la MÊME note
 * pouvaient donc sauter à deux endroits différents pour le même titre. Les
 * deux passent maintenant par `extractHeadings` et `outlineNavigation`.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import { extractHeadings } from '../../../../services/notes/transclusionHelpers';
import {
  toOutlineItems,
  scrollToOutlineItem,
  type OutlineItem,
} from '../outlineNavigation';

interface TocNodeViewProps {
  editor: any;
  selected: boolean;
}

export const TocNodeView: React.FC<TocNodeViewProps> = ({ editor, selected }) => {
  const [headings, setHeadings] = useState<OutlineItem[]>([]);

  // Les titres viennent du JSON du document, via l'extracteur partagé : même
  // parcours récursif que le sommaire latéral (un titre dans un encadré ou une
  // colonne compte), et même convention de rang (les titres vides comptent).
  const updateHeadings = useCallback(() => {
    if (!editor) return;
    setHeadings(toOutlineItems(extractHeadings(editor.getJSON())));
  }, [editor]);

  useEffect(() => {
    updateHeadings();
    if (!editor) return;
    editor.on('update', updateHeadings);
    return () => { editor.off('update', updateHeadings); };
  }, [editor, updateHeadings]);

  // Même résolution que le sommaire latéral : titres transclus écartés,
  // niveau + texte vérifiés, repli par occurrence.
  const scrollToHeading = useCallback((item: OutlineItem) => {
    scrollToOutlineItem(item);
  }, []);

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
              key={h.id}
              className={`toc-block__item toc-block__item--h${h.level}`}
              onClick={() => scrollToHeading(h)}
            >
              {h.text}
            </button>
          ))}
        </div>
      )}
    </NodeViewWrapper>
  );
};
