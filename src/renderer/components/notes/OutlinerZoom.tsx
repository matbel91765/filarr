/**
 * OutlinerZoom — Filarr Notes
 *
 * Allows "zooming" into a specific bullet list item, showing only
 * that subtree. Shows breadcrumb path for navigation.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

interface ZoomBreadcrumb {
  text: string;
  pos: number;
}

interface OutlinerZoomProps {
  editor: any;
  isActive: boolean;
  onToggle: () => void;
}

function getListItemText(node: any): string {
  if (!node) return '';
  let text = '';
  node.descendants((child: any) => {
    if (child.isText) text += child.text;
  });
  return text.slice(0, 50) || 'List item';
}

export const OutlinerZoom: React.FC<OutlinerZoomProps> = ({ editor, isActive, onToggle }) => {
  const [zoomStack, setZoomStack] = useState<ZoomBreadcrumb[]>([]);

  // Apply CSS to hide everything except the zoomed subtree
  useEffect(() => {
    if (!editor || !isActive || zoomStack.length === 0) {
      // Remove zoom classes
      const editorEl = editor?.view?.dom;
      if (editorEl) {
        editorEl.classList.remove('outliner-zoomed');
        editorEl.querySelectorAll('.outliner-zoom-hidden').forEach((el: Element) => {
          el.classList.remove('outliner-zoom-hidden');
        });
        editorEl.querySelectorAll('.outliner-zoom-target').forEach((el: Element) => {
          el.classList.remove('outliner-zoom-target');
        });
      }
      return;
    }

    const targetPos = zoomStack[zoomStack.length - 1].pos;
    const editorEl = editor.view.dom as HTMLElement;
    editorEl.classList.add('outliner-zoomed');

    // Find the DOM node at the target position and highlight it
    try {
      const resolvedPos = editor.state.doc.resolve(targetPos);
      const domNode = editor.view.nodeDOM(targetPos);

      if (domNode instanceof HTMLElement) {
        // Hide all siblings at each level
        const topLevel = editorEl.children;
        for (let i = 0; i < topLevel.length; i++) {
          const child = topLevel[i] as HTMLElement;
          if (!child.contains(domNode) && child !== domNode) {
            child.classList.add('outliner-zoom-hidden');
          } else {
            child.classList.remove('outliner-zoom-hidden');
          }
        }
        domNode.classList.add('outliner-zoom-target');
      }
    } catch (e) {
      // Position may be invalid after edits
    }
  }, [editor, isActive, zoomStack]);

  const handleZoomIn = useCallback(() => {
    if (!editor) return;

    const { $from } = editor.state.selection;
    // Find the closest listItem
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d);
      if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
        const pos = $from.before(d);
        const text = getListItemText(node);
        setZoomStack((prev) => [...prev, { text, pos }]);
        if (!isActive) onToggle();
        return;
      }
    }
  }, [editor, isActive, onToggle]);

  const handleZoomOut = useCallback(() => {
    setZoomStack((prev) => {
      if (prev.length <= 1) {
        onToggle(); // Deactivate zoom
        return [];
      }
      return prev.slice(0, -1);
    });
  }, [onToggle]);

  const handleZoomToRoot = useCallback(() => {
    setZoomStack([]);
    if (isActive) onToggle();
  }, [isActive, onToggle]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!editor) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+. to zoom in
      if (e.ctrlKey && e.shiftKey && e.key === '.') {
        e.preventDefault();
        handleZoomIn();
      }
      // Ctrl+Shift+, to zoom out
      if (e.ctrlKey && e.shiftKey && e.key === ',') {
        e.preventDefault();
        handleZoomOut();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [editor, handleZoomIn, handleZoomOut]);

  if (!isActive || zoomStack.length === 0) return null;

  return (
    <div className="outliner-zoom-bar">
      <button className="outliner-zoom-bar__root" onClick={handleZoomToRoot} title="Back to root">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        </svg>
      </button>
      {zoomStack.map((crumb, i) => (
        <React.Fragment key={i}>
          <span className="outliner-zoom-bar__sep">›</span>
          <button
            className={`outliner-zoom-bar__crumb ${i === zoomStack.length - 1 ? 'is-current' : ''}`}
            onClick={() => setZoomStack((prev) => prev.slice(0, i + 1))}
          >
            {crumb.text}
          </button>
        </React.Fragment>
      ))}
      <button className="outliner-zoom-bar__close" onClick={handleZoomToRoot} title="Exit zoom">
        ✕
      </button>
    </div>
  );
};
