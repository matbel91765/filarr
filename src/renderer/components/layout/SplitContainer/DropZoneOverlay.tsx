/**
 * DropZoneOverlay Component
 *
 * Overlay qui apparait quand on drag un onglet.
 * Affiche deux zones (gauche/droite) pour declencher un split.
 * N'apparait que si on n'est pas deja en split.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { AppDispatch } from '../../../../store';
import { splitPanel } from '../../../../store/slices/tabsSlice';
import { selectIsSplit } from '../../../../store/selectors/tabSelectors';

export const DropZoneOverlay: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const isSplit = useSelector(selectIsSplit);
  const [isTabDragging, setIsTabDragging] = useState(false);
  const [hoverSide, setHoverSide] = useState<'left' | 'right' | null>(null);
  const [dragData, setDragData] = useState<{ tabId: string; sourcePanelId: string } | null>(null);

  useEffect(() => {
    const onStart = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setIsTabDragging(true);
      setDragData(detail);
    };
    const onEnd = () => {
      setIsTabDragging(false);
      setHoverSide(null);
      setDragData(null);
    };
    window.addEventListener('filarr:tab-drag-start', onStart);
    window.addEventListener('filarr:tab-drag-end', onEnd);
    return () => {
      window.removeEventListener('filarr:tab-drag-start', onStart);
      window.removeEventListener('filarr:tab-drag-end', onEnd);
    };
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, side: 'left' | 'right') => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setHoverSide(side);
  }, []);

  const handleDragLeave = useCallback(() => {
    setHoverSide(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, side: 'left' | 'right') => {
    e.preventDefault();
    if (dragData) {
      dispatch(splitPanel({
        tabId: dragData.tabId,
        sourcePanelId: dragData.sourcePanelId,
        side,
      }));
    }
    setIsTabDragging(false);
    setHoverSide(null);
    setDragData(null);
  }, [dispatch, dragData]);

  // Don't show if already split or not dragging
  if (!isTabDragging || isSplit) return null;

  return (
    <div className="absolute inset-0 z-50 flex pointer-events-none">
      {/* Left drop zone */}
      <div
        className={`flex-1 pointer-events-auto flex items-center justify-center transition-colors duration-200
          ${hoverSide === 'left' ? 'bg-[var(--color-primary-100)]/40' : 'bg-transparent'}`}
        onDragOver={(e) => handleDragOver(e, 'left')}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, 'left')}
      >
        {hoverSide === 'left' && (
          <div className="border-2 border-dashed border-[var(--color-primary-500)] rounded-lg px-6 py-4 text-[var(--color-primary-600)] font-medium text-sm">
            Ouvrir a gauche
          </div>
        )}
      </div>

      {/* Right drop zone */}
      <div
        className={`flex-1 pointer-events-auto flex items-center justify-center transition-colors duration-200
          ${hoverSide === 'right' ? 'bg-[var(--color-primary-100)]/40' : 'bg-transparent'}`}
        onDragOver={(e) => handleDragOver(e, 'right')}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, 'right')}
      >
        {hoverSide === 'right' && (
          <div className="border-2 border-dashed border-[var(--color-primary-500)] rounded-lg px-6 py-4 text-[var(--color-primary-600)] font-medium text-sm">
            Ouvrir a droite
          </div>
        )}
      </div>
    </div>
  );
};

export default DropZoneOverlay;
