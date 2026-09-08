/**
 * Drag Handle Plugin — Filarr Notes (Notion-style)
 *
 * Single reusable grip handle positioned at the left margin of the hovered
 * top-level block.  Stays visible as long as the cursor is anywhere on the
 * block row (text, padding, handle itself).  Drag & drop uses direct DOM
 * listeners so events work even though the handle lives outside ProseMirror.
 *
 * Vague B : bouton « + » (insère un bloc en dessous et ouvre le menu slash)
 * et menu de bloc au clic sur la poignée (Dupliquer / Supprimer /
 * Transformer en) — DOM vanilla, comme le reste du plugin.
 */

import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Extension } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import i18n from '../../../../i18n/config';
import { applyOutsideList } from '../listAwareCommands';

const dragHandlePluginKey = new PluginKey('dragHandle');
const DRAG_MIME = 'application/x-filarr-block-drag';

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────

function blockAtY(view: EditorView, y: number): { pos: number; dom: HTMLElement } | null {
  // posAtCoords peut rendre une position hors bornes pendant une mutation du
  // document (RangeError au resolve) : le survol ne doit jamais faire tomber l'app.
  try {
    const editorRect = view.dom.getBoundingClientRect();
    const probe = view.posAtCoords({ left: editorRect.left + 10, top: y });
    if (!probe || probe.pos > view.state.doc.content.size) return null;

    const resolved = view.state.doc.resolve(probe.pos);
    const depth = Math.min(resolved.depth, 1);
    if (depth === 0 && resolved.parent === view.state.doc) return null;

    const blockStart = depth === 0 ? probe.pos : resolved.before(1);
    if (!view.state.doc.nodeAt(blockStart)) return null;

    const dom = view.nodeDOM(blockStart);
    if (!(dom instanceof HTMLElement)) return null;

    return { pos: blockStart, dom };
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────
// Extension
// ────────────────────────────────────────────────────────

export const DragHandleExtension = Extension.create({
  name: 'dragHandle',

  addProseMirrorPlugins() {
    const editor = this.editor;

    let view: EditorView;
    let handleEl: HTMLDivElement;
    let plusEl: HTMLDivElement;
    let dropIndicator: HTMLDivElement;
    let container: HTMLElement;
    let menuEl: HTMLDivElement | null = null;

    let hoveredBlockPos: number | null = null;
    let dragSourcePos: number | null = null;

    // Cached during dragover — used by drop
    let dropTargetPos: number | null = null;
    let dropInsertBefore = true;

    const t = (key: string, fallback: string) => i18n.t(key, { defaultValue: fallback });

    // ── Handle positioning ──

    function positionHandle(blockDom: HTMLElement) {
      const parentRect = container.getBoundingClientRect();
      const blockRect = blockDom.getBoundingClientRect();

      const style = window.getComputedStyle(blockDom);
      const lh = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
      const firstLineCenter = blockRect.top + Math.min(lh, blockRect.height) / 2;

      const top = `${firstLineCenter - parentRect.top + container.scrollTop - 11}px`;
      handleEl.style.top = top;
      handleEl.style.left = `${blockRect.left - parentRect.left - 28}px`;
      handleEl.classList.add('is-visible');
      plusEl.style.top = top;
      plusEl.style.left = `${blockRect.left - parentRect.left - 52}px`;
      plusEl.classList.add('is-visible');
    }

    function hideHandle() {
      handleEl.classList.remove('is-visible');
      plusEl.classList.remove('is-visible');
      hoveredBlockPos = null;
    }

    // ── Block menu (clic sur la poignée) ──

    function closeMenu() {
      if (!menuEl) return;
      menuEl.remove();
      menuEl = null;
      document.removeEventListener('mousedown', onDocMouseDown, true);
      document.removeEventListener('keydown', onMenuKeyDown, true);
    }

    function onDocMouseDown(e: MouseEvent) {
      if (menuEl && !menuEl.contains(e.target as Node) && !handleEl.contains(e.target as Node)) {
        closeMenu();
      }
    }

    function onMenuKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeMenu();
      }
    }

    /**
     * Sélectionne le CONTENU ENTIER du bloc, puis on lui applique la
     * transformation.
     *
     * `blockAtY` rend toujours un bloc de premier niveau : survoler une puce
     * désigne la LISTE entière, jamais la ligne seule. L'ancien
     * `placeCaretIn` posait un caret dans le premier item, ce qui (a) ne
     * transformait que cette ligne alors que le menu promet le bloc survolé,
     * et (b) garantissait l'échec de Citation / Titre / Code, illégaux dans un
     * `listItem`. Sélectionner tout le bloc fait porter la transformation sur
     * tous ses items — et donne à `applyOutsideList` de quoi sortir toute la
     * liste d'un coup.
     */
    function selectBlockContent(pos: number) {
      const { doc } = view.state;
      const node = doc.nodeAt(pos);
      if (!node) return;
      const $from = doc.resolve(Math.min(pos + 1, doc.content.size));
      const $to = doc.resolve(Math.min(pos + node.nodeSize - 1, doc.content.size));
      view.dispatch(view.state.tr.setSelection(TextSelection.between($from, $to)));
      view.focus();
    }

    function openMenu(pos: number) {
      closeMenu();
      const node = view.state.doc.nodeAt(pos);
      if (!node) return;

      menuEl = document.createElement('div');
      menuEl.className = 'note-editor__block-menu';
      menuEl.setAttribute('role', 'menu');

      const addItem = (label: string, run: () => void, danger = false) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `note-editor__block-menu-item${danger ? ' note-editor__block-menu-item--danger' : ''}`;
        btn.setAttribute('role', 'menuitem');
        btn.textContent = label;
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          closeMenu();
          run();
        });
        menuEl!.appendChild(btn);
      };

      const addHeader = (label: string) => {
        const el = document.createElement('div');
        el.className = 'note-editor__block-menu-header';
        el.textContent = label;
        menuEl!.appendChild(el);
      };

      addItem(t('notes.blockMenu.duplicate', 'Dupliquer'), () => {
        const current = view.state.doc.nodeAt(pos);
        if (!current) return;
        const copy = current.type.create(current.attrs, current.content, current.marks);
        view.dispatch(view.state.tr.insert(pos + current.nodeSize, copy));
      });
      addItem(
        t('notes.blockMenu.delete', 'Supprimer'),
        () => {
          const current = view.state.doc.nodeAt(pos);
          if (!current) return;
          view.dispatch(view.state.tr.delete(pos, pos + current.nodeSize));
        },
        true
      );

      // Transformations : uniquement pour les blocs textuels et les wrappers connus
      const transformable =
        node.isTextblock ||
        ['bulletList', 'orderedList', 'taskList', 'blockquote'].includes(node.type.name);
      if (transformable) {
        addHeader(t('notes.blockMenu.turnInto', 'Transformer en'));
        // Citation / Titres / Code sont illégaux dans un `listItem` : sur une
        // liste survolée ils passent par `applyOutsideList`, qui la sort de la
        // liste avant d'appliquer. Texte et les trois listes, eux, sont légaux
        // partout et gardent l'appel direct.
        const transforms: Array<[string, string, () => void]> = [
          ['notes.blockMenu.text', 'Texte', () => editor.chain().focus().setParagraph().run()],
          [
            'notes.blockMenu.heading1',
            'Titre 1',
            () =>
              applyOutsideList(
                editor,
                () => editor.can().toggleHeading({ level: 1 }),
                () => editor.chain().focus().toggleHeading({ level: 1 }).run()
              ),
          ],
          [
            'notes.blockMenu.heading2',
            'Titre 2',
            () =>
              applyOutsideList(
                editor,
                () => editor.can().toggleHeading({ level: 2 }),
                () => editor.chain().focus().toggleHeading({ level: 2 }).run()
              ),
          ],
          [
            'notes.blockMenu.heading3',
            'Titre 3',
            () =>
              applyOutsideList(
                editor,
                () => editor.can().toggleHeading({ level: 3 }),
                () => editor.chain().focus().toggleHeading({ level: 3 }).run()
              ),
          ],
          [
            'notes.blockMenu.bulletList',
            'Liste à puces',
            () => editor.chain().focus().toggleBulletList().run(),
          ],
          [
            'notes.blockMenu.orderedList',
            'Liste numérotée',
            () => editor.chain().focus().toggleOrderedList().run(),
          ],
          [
            'notes.blockMenu.taskList',
            'Liste de tâches',
            () => editor.chain().focus().toggleTaskList().run(),
          ],
          [
            'notes.blockMenu.quote',
            'Citation',
            () =>
              applyOutsideList(
                editor,
                () => editor.can().toggleBlockquote(),
                () => editor.chain().focus().toggleBlockquote().run()
              ),
          ],
          [
            'notes.blockMenu.code',
            'Code',
            () =>
              applyOutsideList(
                editor,
                () => editor.can().toggleCodeBlock(),
                () => editor.chain().focus().toggleCodeBlock().run()
              ),
          ],
        ];
        for (const [key, fallback, run] of transforms) {
          addItem(t(key, fallback), () => {
            selectBlockContent(pos);
            run();
            // Le bloc reste entièrement sélectionné après la transformation :
            // la première frappe le remplacerait. On repose un caret à son
            // début (position d'après-coup, les sorties de liste ayant pu
            // décaler tout ce qui précède).
            const { selection } = editor.state;
            if (!selection.empty) {
              editor.commands.setTextSelection(selection.from);
            }
          });
        }
      }

      document.body.appendChild(menuEl);

      // Position fixe près de la poignée, bornée au viewport
      const rect = handleEl.getBoundingClientRect();
      const menuRect = menuEl.getBoundingClientRect();
      const top = Math.min(rect.top, window.innerHeight - menuRect.height - 8);
      const left = Math.min(rect.right + 6, window.innerWidth - menuRect.width - 8);
      menuEl.style.top = `${Math.max(8, top)}px`;
      menuEl.style.left = `${Math.max(8, left)}px`;

      document.addEventListener('mousedown', onDocMouseDown, true);
      document.addEventListener('keydown', onMenuKeyDown, true);
    }

    function onHandleClick(e: MouseEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (hoveredBlockPos === null) return;
      if (menuEl) {
        closeMenu();
        return;
      }
      openMenu(hoveredBlockPos);
    }

    // ── « + » : insère un paragraphe sous le bloc et ouvre le menu slash ──

    function onPlusClick(e: MouseEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (hoveredBlockPos === null) return;
      closeMenu();
      const node = view.state.doc.nodeAt(hoveredBlockPos);
      if (!node) return;
      const insertAt = hoveredBlockPos + node.nodeSize;
      editor
        .chain()
        .focus()
        .insertContentAt(insertAt, { type: 'paragraph' })
        .setTextSelection(insertAt + 1)
        .insertContent('/')
        .run();
    }

    // ── Mouse tracking ──

    function onMouseMove(e: MouseEvent) {
      if (dragSourcePos !== null) return;
      if (menuEl) return; // menu ouvert : la poignée reste ancrée à son bloc
      if (!view.editable) {
        hideHandle();
        return;
      }

      const block = blockAtY(view, e.clientY);
      if (!block) {
        hideHandle();
        return;
      }

      hoveredBlockPos = block.pos;
      positionHandle(block.dom);
    }

    function onMouseLeave(e: MouseEvent) {
      if (dragSourcePos !== null) return;
      if (menuEl) return;
      const related = e.relatedTarget as HTMLElement | null;
      if (related && container.contains(related)) return;
      hideHandle();
    }

    // ── Drag start ──

    function onDragStart(e: DragEvent) {
      if (hoveredBlockPos === null) return;
      closeMenu();
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
      const nodeCopy = sourceNode.type.create(
        sourceNode.attrs,
        sourceNode.content,
        sourceNode.marks
      );

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
      container
        .querySelectorAll('.is-dragging')
        .forEach((el) => el.classList.remove('is-dragging'));
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
          handleEl.title = t(
            'notes.blockMenu.handleTitle',
            'Glisser pour déplacer, cliquer pour le menu'
          );
          handleEl.innerHTML = `<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
            <circle cx="2.5" cy="2" r="1.3"/><circle cx="7.5" cy="2" r="1.3"/>
            <circle cx="2.5" cy="7" r="1.3"/><circle cx="7.5" cy="7" r="1.3"/>
            <circle cx="2.5" cy="12" r="1.3"/><circle cx="7.5" cy="12" r="1.3"/>
          </svg>`;
          container.appendChild(handleEl);

          plusEl = document.createElement('div');
          plusEl.className = 'note-editor__insert-handle';
          plusEl.contentEditable = 'false';
          plusEl.title = t('notes.blockMenu.addBelow', 'Ajouter un bloc en dessous');
          plusEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
            <path d="M6 1.5v9M1.5 6h9"/>
          </svg>`;
          container.appendChild(plusEl);

          dropIndicator = document.createElement('div');
          dropIndicator.className = 'note-editor__drop-indicator';
          container.appendChild(dropIndicator);

          container.addEventListener('mousemove', onMouseMove);
          container.addEventListener('mouseleave', onMouseLeave);
          container.addEventListener('dragover', onDragOver);
          container.addEventListener('drop', onDrop, true);
          container.addEventListener('scroll', closeMenu);

          handleEl.addEventListener('dragstart', onDragStart);
          handleEl.addEventListener('dragend', onDragEnd);
          handleEl.addEventListener('click', onHandleClick);
          plusEl.addEventListener('click', onPlusClick);

          return {
            destroy() {
              closeMenu();
              container.removeEventListener('mousemove', onMouseMove);
              container.removeEventListener('mouseleave', onMouseLeave);
              container.removeEventListener('dragover', onDragOver);
              container.removeEventListener('drop', onDrop, true);
              container.removeEventListener('scroll', closeMenu);
              handleEl?.remove();
              plusEl?.remove();
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
