/**
 * useRubberBandSelection Hook
 *
 * Provides Windows Explorer-style lasso/rubber-band selection.
 * Click and drag on empty space to draw a selection rectangle;
 * items intersecting the rectangle get selected.
 *
 * Supports:
 * - Ctrl+drag to add to existing selection
 * - Auto-scroll when dragging near container edges
 * - Works with any layout (grid, list, flex)
 *
 * Performance: the rectangle div is updated via direct DOM manipulation
 * (no React state / no re-renders during drag).
 */

import { useCallback, useRef, useEffect, RefObject } from 'react';

export interface RubberBandRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UseRubberBandSelectionOptions {
  /** Ref to the scrollable container element */
  containerRef: RefObject<HTMLDivElement>;
  /** Data attribute name on selectable items (default: 'data-item-id') */
  itemAttribute?: string;
  /** Current selected item IDs (for Ctrl+drag additive mode) */
  currentSelection?: string[];
  /** Callback when selection changes */
  onSelectionChange: (selectedIds: string[]) => void;
  /** Whether rubber-band is enabled (default: true) */
  enabled?: boolean;
}

export interface UseRubberBandSelectionReturn {
  /** Ref to attach to the rubber-band rectangle div (hook controls its style directly) */
  rectRef: RefObject<HTMLDivElement>;
  /** Whether a rubber-band drag is in progress */
  isSelecting: boolean;
  /** Event handlers to attach to the container */
  handlers: {
    onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  };
}

/** Minimum drag distance (px) before rubber-band activates */
const DRAG_THRESHOLD = 5;
/** Distance from container edge that triggers auto-scroll (px) */
const SCROLL_MARGIN = 40;
/** Auto-scroll speed (px per frame) */
const SCROLL_SPEED = 12;

/** CSS class toggled on items during rubber-band drag (visual only, no React) */
const RB_CLASS = 'rb-selecting';

interface CachedItem {
  left: number;
  top: number;
  right: number;
  bottom: number;
  element: HTMLElement;
}

export function useRubberBandSelection({
  containerRef,
  itemAttribute = 'data-item-id',
  currentSelection = [],
  onSelectionChange,
  enabled = true,
}: UseRubberBandSelectionOptions): UseRubberBandSelectionReturn {
  // isSelecting tracked via ref — no React re-renders during drag
  const isSelectingRef = useRef(false);

  // Ref for the rectangle div — updated via direct DOM manipulation, no React re-renders
  const rectRef = useRef<HTMLDivElement>(null);

  // Refs to avoid re-renders during mousemove
  const isDragging = useRef(false);
  const startPoint = useRef({ x: 0, y: 0 });
  const ctrlHeld = useRef(false);
  const baseSelection = useRef<string[]>([]);
  const thresholdMet = useRef(false);
  const scrollRAF = useRef<number | null>(null);

  // Keep currentSelection ref in sync for use in document-level handlers
  const currentSelectionRef = useRef(currentSelection);
  currentSelectionRef.current = currentSelection;

  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  // Cached item positions + element refs (scroll-relative) — computed once at drag start
  const cachedItems = useRef<Map<string, CachedItem>>(new Map());
  // Cached container bounds — avoids getBoundingClientRect() on every mousemove
  const cachedContBounds = useRef<DOMRect | null>(null);
  // Tracks which items are visually highlighted during drag (DOM class only, no React)
  const visualSelectionRef = useRef<Set<string>>(new Set());

  /** Cache all item bounding rects + element refs in scroll-relative coordinates */
  const cacheItemPositions = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const items = container.querySelectorAll<HTMLElement>(`[${itemAttribute}]`);
    const contBounds = container.getBoundingClientRect();
    const map = new Map<string, CachedItem>();

    items.forEach(item => {
      const id = item.getAttribute(itemAttribute);
      if (!id) return;
      const b = item.getBoundingClientRect();
      map.set(id, {
        left: b.left - contBounds.left + container.scrollLeft,
        top: b.top - contBounds.top + container.scrollTop,
        right: b.right - contBounds.left + container.scrollLeft,
        bottom: b.bottom - contBounds.top + container.scrollTop,
        element: item,
      });
    });

    cachedItems.current = map;
    cachedContBounds.current = contBounds;
  }, [containerRef, itemAttribute]);

  /** Calculate which items intersect a rectangle using cached positions (no DOM reads) */
  const getIntersectingIds = useCallback((rect: RubberBandRect): Set<string> => {
    const intersecting = new Set<string>();
    const rRight = rect.x + rect.width;
    const rBottom = rect.y + rect.height;

    cachedItems.current.forEach((ir, id) => {
      if (!(rRight < ir.left || rect.x > ir.right || rBottom < ir.top || rect.y > ir.bottom)) {
        intersecting.add(id);
      }
    });

    return intersecting;
  }, []);

  /** Toggle CSS class on items — visual feedback without React re-renders */
  const updateVisualSelection = useCallback((newIds: Set<string>, baseIds: Set<string>) => {
    const prev = visualSelectionRef.current;
    const combined = new Set([...baseIds, ...newIds]);

    // Remove class from items no longer selected
    prev.forEach(id => {
      if (!combined.has(id)) {
        const cached = cachedItems.current.get(id);
        if (cached) cached.element.classList.remove(RB_CLASS);
      }
    });

    // Add class to newly selected items
    combined.forEach(id => {
      if (!prev.has(id)) {
        const cached = cachedItems.current.get(id);
        if (cached) cached.element.classList.add(RB_CLASS);
      }
    });

    visualSelectionRef.current = combined;
  }, []);

  /** Remove all visual selection classes */
  const clearVisualSelection = useCallback(() => {
    visualSelectionRef.current.forEach(id => {
      const cached = cachedItems.current.get(id);
      if (cached) cached.element.classList.remove(RB_CLASS);
    });
    visualSelectionRef.current = new Set();
  }, []);

  /** Update the rectangle div style directly (no React state, GPU-accelerated) */
  const showRect = useCallback((rect: RubberBandRect) => {
    const el = rectRef.current;
    if (!el) return;
    el.style.display = 'block';
    el.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height}px`;
  }, []);

  const hideRect = useCallback(() => {
    const el = rectRef.current;
    if (el) el.style.display = 'none';
  }, []);

  /** Handle mousedown on the container */
  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!enabled || e.button !== 0) return;

    const target = e.target as HTMLElement;

    // Don't start rubber-band if clicking on an item or interactive element
    if (target.closest(`[${itemAttribute}]`)) return;
    if (target.closest('input, button, a, select, textarea, [role="button"], [role="menuitem"]')) return;

    const container = containerRef.current;
    if (!container) return;

    e.preventDefault(); // Prevent text selection

    const containerBounds = container.getBoundingClientRect();
    startPoint.current = {
      x: e.clientX - containerBounds.left + container.scrollLeft,
      y: e.clientY - containerBounds.top + container.scrollTop,
    };

    ctrlHeld.current = e.ctrlKey || e.metaKey;
    baseSelection.current = ctrlHeld.current ? [...currentSelectionRef.current] : [];
    isDragging.current = true;
    thresholdMet.current = false;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;

      const cont = containerRef.current;
      if (!cont) return;

      // Use cached bounds (no getBoundingClientRect on every mousemove)
      // scrollLeft/scrollTop are fast reads (no forced layout without prior writes)
      const contBounds = cachedContBounds.current || cont.getBoundingClientRect();
      const currentX = ev.clientX - contBounds.left + cont.scrollLeft;
      const currentY = ev.clientY - contBounds.top + cont.scrollTop;

      // Check drag threshold
      const dx = Math.abs(currentX - startPoint.current.x);
      const dy = Math.abs(currentY - startPoint.current.y);
      if (!thresholdMet.current && dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;

      if (!thresholdMet.current) {
        thresholdMet.current = true;
        isSelectingRef.current = true;
        // Cache all item positions + element refs once at drag start
        cacheItemPositions();
        // rb-drag-active: disables transitions, isolates paint, prevents text selection
        cont.classList.add('rb-drag-active');
        // Pre-highlight base selection items (for Ctrl+drag)
        if (baseSelection.current.length > 0) {
          const baseSet = new Set(baseSelection.current);
          updateVisualSelection(new Set(), baseSet);
        }
      }

      // Calculate rectangle (pure math, no DOM)
      const rect: RubberBandRect = {
        x: Math.min(startPoint.current.x, currentX),
        y: Math.min(startPoint.current.y, currentY),
        width: Math.abs(currentX - startPoint.current.x),
        height: Math.abs(currentY - startPoint.current.y),
      };

      // Capture mouse position relative to container viewport (for auto-scroll)
      const mouseRelY = ev.clientY - contBounds.top;
      const mouseRelX = ev.clientX - contBounds.left;
      const contHeight = contBounds.height;
      const contWidth = contBounds.width;

      // Batch ALL DOM work inside a single rAF — no reads/writes outside
      if (scrollRAF.current) cancelAnimationFrame(scrollRAF.current);
      scrollRAF.current = requestAnimationFrame(() => {
        // Auto-scroll near edges (write-only, no DOM reads)
        if (mouseRelY < SCROLL_MARGIN) {
          cont.scrollTop -= SCROLL_SPEED;
        } else if (mouseRelY > contHeight - SCROLL_MARGIN) {
          cont.scrollTop += SCROLL_SPEED;
        }
        if (mouseRelX < SCROLL_MARGIN) {
          cont.scrollLeft -= SCROLL_SPEED;
        } else if (mouseRelX > contWidth - SCROLL_MARGIN) {
          cont.scrollLeft += SCROLL_SPEED;
        }

        // Direct DOM update — no React re-render
        showRect(rect);

        // Use cached positions — no DOM queries or forced reflows
        const intersecting = getIntersectingIds(rect);
        const baseSet = ctrlHeld.current ? new Set(baseSelection.current) : new Set<string>();

        // Toggle CSS classes directly on DOM elements (no React state updates)
        updateVisualSelection(intersecting, baseSet);
      });
    };

    const onMouseUp = () => {
      const cont = containerRef.current;

      isDragging.current = false;
      isSelectingRef.current = false;
      hideRect();

      // Remove transition-disabling class from container
      if (cont) cont.classList.remove('rb-drag-active');

      if (scrollRAF.current) {
        cancelAnimationFrame(scrollRAF.current);
        scrollRAF.current = null;
      }

      // Commit final selection to React state (single update)
      if (thresholdMet.current) {
        const finalSelection = [...visualSelectionRef.current];
        clearVisualSelection();
        onSelectionChangeRef.current(finalSelection);
      } else if (!ctrlHeld.current) {
        // Click on empty space without dragging → clear selection
        onSelectionChangeRef.current([]);
      }

      // Clear cache
      cachedItems.current.clear();
      cachedContBounds.current = null;

      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [enabled, itemAttribute, containerRef, getIntersectingIds, cacheItemPositions, updateVisualSelection, clearVisualSelection, showRect, hideRect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scrollRAF.current) {
        cancelAnimationFrame(scrollRAF.current);
      }
    };
  }, []);

  return {
    rectRef,
    isSelecting: isSelectingRef.current,
    handlers: { onMouseDown },
  };
}

export default useRubberBandSelection;
