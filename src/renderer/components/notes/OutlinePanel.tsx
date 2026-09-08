/**
 * OutlinePanel — Filarr Notes
 *
 * Sommaire latéral de la note active.
 *
 * Les titres NE SONT PLUS extraits ici : ce panneau lisait autrefois le seul
 * premier niveau de `doc.content`, alors que l'autocomplétion `![[Note#` passe
 * par `extractHeadings` (récursif). Un titre posé dans un encadré ou une
 * colonne était donc proposé comme cible de transclusion tout en restant
 * absent du sommaire — deux vérités contradictoires dans le même produit.
 * Le panneau consomme maintenant la MÊME fonction, si bien que la divergence
 * ne peut plus revenir par construction.
 *
 * L'ancre de défilement (titres vides, transclusions) vit elle aussi hors
 * d'ici, dans `outlineNavigation.ts`, partagée avec le bloc /toc.
 */

import React, { useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import type { RootState } from '../../../store';
import { extractHeadingsFromJson } from '../../../services/notes/transclusionHelpers';
import {
  toOutlineItems,
  scrollToOutlineItem,
  type OutlineItem,
} from './outlineNavigation';
import './OutlinePanel.css';

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

  const headings = useMemo(() => toOutlineItems(extractHeadingsFromJson(content)), [content]);

  const handleClick = useCallback(
    (item: OutlineItem) => {
      if (onScrollToHeading) {
        // Le contrat de la prop est le rang dans le document, pas le rang
        // d'affichage : les titres vides comptent des deux côtés.
        onScrollToHeading(item.index);
        return;
      }
      scrollToOutlineItem(item);
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
          {headings.map((h) => (
            <button
              key={h.id}
              className={`outline-panel__item outline-panel__item--h${h.level}`}
              onClick={() => handleClick(h)}
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
