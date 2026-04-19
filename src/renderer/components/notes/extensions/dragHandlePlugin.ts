/**
 * Drag Handle Plugin — Filarr Notes (Notion-style)
 *
 * Single reusable grip handle positioned at the left margin of the hovered
 * top-level block.  Stays visible as long as the cursor is anywhere on the
 * block row (text, padding, handle itself).  Drag & drop uses direct DOM
 * listeners so events work even though the handle lives outside ProseMirror.
 */

import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Extension } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';

const dragHandlePluginKey = new PluginKey('dragHandle');
const DRAG_MIME = 'application/x-filarr-block-drag';

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────

function blockAtY(view: EditorView, y: number): { pos: number; dom: HTMLElement } | null {
  const editorRect = view.dom.getBoundingClientRect();
  const probe = view.posAtCoords({ left: editorRect.left + 10, top: y });
  if (!probe) return null;

  const resolved = view.state.doc.resolve(probe.pos);
  const depth = Math.min(resolved.depth, 1);
  if (depth === 0 && resolved.parent === view.state.doc) return null;

  const blockStart = depth === 0 ? probe.pos : resolved.before(1);
  if (!view.state.doc.nodeAt(blockStart)) return null;

  const dom = view.nodeDOM(blockStart);
  if (!(dom instanceof HTMLElement)) return null;

  return { pos: blockStart, dom };
}

// ────────────────────────────────────────────────────────
// Extension
// ────────────────────────────────────────────────────────

export const DragHandleExtension = Extension.create({
  name: 'dragHandle',

  addProseMirrorPlugins() {
    let view: EditorView;
    let handleEl: HTMLDivElement;
    let dropIndicator: HTMLDivElement;
    let container: HTMLElement;

    let hoveredBlockPos: number | null = null;
    let dragSourcePos: number | null = null;

    // Cached during dragover — used by drop
    let dropTargetPos: number | null = null;
    let dropInsertBefore = true;

    // ── Handle positioning ──

    function positionHandle(blockDom: HTMLElement) {
      const parentRect = container.getBoundingClientRect();
      const blockRect = blockDom.getBoundingClientRect();

      const style = window.getComputedStyle(blockDom);
      const lh = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
      const firstLineCenter = blockRect.top + Math.min(lh, blockRect.height) / 2;

      handleEl.style.top = `${firstLineCenter - parentRect.top + container.scrollTop - 11}px`;
      handleEl.style.left = `${blockRect.left - parentRect.left - 28}px`;
      handleEl.classList.add('is-visible');
    }

    function hideHandle() {
      handleEl.classList.remove('is-visible');
      hoveredBlockPos = null;
    }

    // ── Mouse tracking ──

    function onMouseMove(e: MouseEvent) {
      if (dragSourcePos !== null) return;

      const block = blockAtY(view, e.clientY);
      if (!block) { hideHandle(); return; }

      hoveredBlockPos = block.pos;
      positionHandle(block.dom);
    }

    function onMouseLeave(e: MouseEvent) {
      if (dragSourcePos !== null) return;
      const related = e.relatedTarget as HTMLElement | null;
      if (related && container.contains(related)) return;
      hideHandle();
    }

    // ── Drag start ──

    function onDragStart(e: DragEvent) {
      if (hoveredBlockPos === null) return;
      dragSourcePos = hoveredBlockPos;

      e.dataTransfer!.effectAllowed = 'move';
      e.dataTransfer!.setData(DRAG_MIME, '1');

      const blockDom = view.nodeDOM(dragSourcePos);
      if (blockDom instanceof HTMLElement) {
        blockDom.classList.add('is-dragging');

        const ghost = blockDom.cloneNode(true) as HTMLElement;
        ghost.style.position = 'absolute';
        ghost.style.top = '-9999px';
        ghost.style.width = `${blockDom.offsetWidth}px`;
        ghost.style.opacity = '0.85';
        ghost.style.background = 'var(--color-surface, #fff)';
        ghost.style.borderRadius = '6px';
        ghost.style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)';
        ghost.style.padding = '4px 12px';
        document.body.appendChild(ghost);
        e.dataTransfer!.setDragImage(ghost, 20, 20);
        requestAnimationFrame(() => ghost.remove());
      }
    }

    // ── Drag over: position indicator + cache target ──

    function onDragOver(e: DragEvent) {
      if (dragSourcePos === null) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';

      const block = blockAtY(view, e.clientY);
      if (!block) {
        dropIndicator.classList.remove('is-visible');
        dropTargetPos = null;
        return;
      }

      const blockRect = block.dom.getBoundingClientRect();
      const parentRect = container.getBoundingClientRect();
      dropInsertBefore = e.clientY < blockRect.top + blockRect.height / 2;
      dropTargetPos = block.pos;

      const y = dropInsertBefore
        ? blockRect.top - parentRect.top + container.scrollTop
        : blockRect.bottom - parentRect.top + container.scrollTop;

      dropIndicator.style.top = `${y}px`;
      dropIndicator.style.left = `${blockRect.left - parentRect.left}px`;
      dropIndicator.style.width = `${blockRect.width}px`;
      dropIndicator.classList.add('is-visible');
    }

    // ── Drop: use cached position ──

    function onDrop(e: DragEvent) {
      if (dragSourcePos === null) return;
      e.preventDefault();
      e.stopPropagation();

      const srcPos = dragSourcePos;
      const tgtPos = dropTargetPos;
      const before = dropInsertBefore;

      cleanup();
      dragSourcePos = null;
      dropTargetPos = null;

      if (tgtPos === null) return;

      const { state } = view;
      const sourceNode = state.doc.nodeAt(srcPos);
      if (!sourceNode) return;

      // Compute insert position
      let insertPos: number;
      if (before) {
        insertPos = tgtPos;
      } else {
        const targetNode = state.doc.nodeAt(tgtPos);
        insertPos = tgtPos + (targetNode?.nodeSize || 0);
      }

      // Skip no-op (dropping at same position)
      const sourceEnd = srcPos + sourceNode.nodeSize;
      if (insertPos === srcPos || insertPos === sourceEnd) return;

      // Build transaction: delete source, then insert at adjusted position
      const tr = state.tr;
      const sourceSize = sourceNode.nodeSize;
      const nodeCopy = sourceNode.type.create(sourceNode.attrs, sourceNode.content, sourceNode.marks);

      tr.delete(srcPos, srcPos + sourceSize);

      if (insertPos > srcPos) {
        insertPos -= sourceSize;
      }

      tr.insert(Math.max(0, insertPos), nodeCopy);
      view.dispatch(tr);
    }

    function onDragEnd() {
      cleanup();
      dragSourcePos = null;
      dropTargetPos = null;
    }

    function cleanup() {
      dropIndicator.classList.remove('is-visible');
      container.querySelectorAll('.is-dragging').forEach(el => el.classList.remove('is-dragging'));
    }

    // ── Plugin ──

    return [
      new Plugin({
        key: dragHandlePluginKey,

        view(editorView) {
          view = editorView;
          container = editorView.dom.parentElement as HTMLElement;

          handleEl = document.createElement('div');
          handleEl.className = 'note-editor__drag-handle';
          handleEl.setAttribute('draggable', 'true');
          handleEl.setAttribute('data-drag-handle', '');
          handleEl.contentEditable = 'false';
          handleEl.innerHTML = `<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
            <circle cx="2.5" cy="2" r="1.3"/><circle cx="7.5" cy="2" r="1.3"/>
            <circle cx="2.5" cy="7" r="1.3"/><circle cx="7.5" cy="7" r="1.3"/>
            <circle cx="2.5" cy="12" r="1.3"/><circle cx="7.5" cy="12" r="1.3"/>
          </svg>`;
          container.appendChild(handleEl);

          dropIndicator = document.createElement('div');
          dropIndicator.className = 'note-editor__drop-indicator';
          container.appendChild(dropIndicator);

          container.addEventListener('mousemove', onMouseMove);
          container.addEventListener('mouseleave', onMouseLeave);
          container.addEventListener('dragover', onDragOver);
          container.addEventListener('drop', onDrop, true);

          handleEl.addEventListener('dragstart', onDragStart);
          handleEl.addEventListener('dragend', onDragEnd);

          return {
            destroy() {
              container.removeEventListener('mousemove', onMouseMove);
              container.removeEventListener('mouseleave', onMouseLeave);
              container.removeEventListener('dragover', onDragOver);
              container.removeEventListener('drop', onDrop, true);
              handleEl?.remove();
              dropIndicator?.remove();
            },
          };
        },

        props: {
          handleDrop() {
            // Block ProseMirror's native drop when our drag is active
            if (dragSourcePos !== null) return true;
            return false;
          },
          handleDOMEvents: {
            dragover(_, event) {
              if (dragSourcePos !== null) {
                event.preventDefault();
                return true;
              }
              return false;
            },
            drop(_, event) {
              if (dragSourcePos !== null) {
                event.preventDefault();
                event.stopPropagation();
                return true;
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});
