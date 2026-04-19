/**
 * SplitContainer Component
 *
 * Conteneur principal qui affiche 1 ou 2 panneaux cote a cote.
 * Inclut un separateur redimensionnable et l'overlay de drop zones.
 */

import React, { useCallback, useRef, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../../store';
import { setSplitRatio, unsplit } from '../../../../store/slices/tabsSlice';
import { PanelView } from '../PanelView/PanelView';
import { DropZoneOverlay } from './DropZoneOverlay';

const ResizeDivider: React.FC<{ containerRef: React.RefObject<HTMLDivElement | null> }> = ({ containerRef }) => {
  const dispatch = useDispatch<AppDispatch>();
  const isDraggingRef = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const ratio = (moveEvent.clientX - rect.left) / rect.width;
      dispatch(setSplitRatio(ratio));
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [dispatch, containerRef]);

  const handleDoubleClick = useCallback(() => {
    dispatch(unsplit());
  }, [dispatch]);

  return (
    <div
      className="w-1 cursor-col-resize bg-[var(--color-border)] hover:bg-[var(--color-primary-400)] active:bg-[var(--color-primary-500)] transition-colors shrink-0"
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      title="Glisser pour redimensionner, double-clic pour fusionner"
    />
  );
};

export const SplitContainer: React.FC = () => {
  const panels = useSelector((state: RootState) => state.tabs.panels);
  const splitDirection = useSelector((state: RootState) => state.tabs.splitDirection);
  const splitRatio = useSelector((state: RootState) => state.tabs.splitRatio);
  const dispatch = useDispatch<AppDispatch>();
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-unsplit on narrow window
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768 && panels.length > 1) {
        dispatch(unsplit());
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [dispatch, panels.length]);

  if (splitDirection === 'none' || panels.length <= 1) {
    return (
      <div ref={containerRef} className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <PanelView panelId={panels[0].id} />
        <DropZoneOverlay />
      </div>
    );
  }

  // Horizontal split (side by side)
  return (
    <div ref={containerRef} className="flex-1 flex flex-row min-w-0 overflow-hidden relative">
      <div
        style={{ width: `${splitRatio * 100}%` }}
        className="flex flex-col min-w-0 overflow-hidden"
      >
        <PanelView panelId={panels[0].id} />
      </div>
      <ResizeDivider containerRef={containerRef} />
      <div
        style={{ width: `${(1 - splitRatio) * 100}%` }}
        className="flex flex-col min-w-0 overflow-hidden"
      >
        <PanelView panelId={panels[1].id} />
      </div>
    </div>
  );
};

export default SplitContainer;
