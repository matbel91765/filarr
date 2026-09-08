/**
 * TransclusionNodeView — React NodeView for the `![[note]]` embed node.
 *
 * Reads the target note from Redux and renders its content live via TipTap's
 * static `generateHTML` using the parent editor's extension list. Clicking the
 * header navigates to the source note. The card auto-updates when the target
 * note's title or content changes.
 *
 * Cycle guard: a `data-depth` chain on the DOM is used to abort rendering when
 * the same note is being embedded inside its own chain — without this, A
 * embedding B embedding A would expand infinitely on every keystroke. The
 * depth check is conservative (max 5) rather than visited-set based, because
 * each level uses a fresh `generateHTML` pass (no shared traversal state).
 *
 * Section / block targeting (Sprint 2): if `section` is set, only the
 * matching heading subtree is rendered; if `blockId` is set, only the
 * paragraph/block with that id. Resolution happens via `extractSubtree`.
 *
 * Alias (Sprint 3): when `alias` is set, the header shows it instead of the
 * resolved note title.
 */

import React, { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { normalizeVaultNoteBodyValue } from '../../../../services/vault/vaultNoteBody';
import { NodeViewWrapper } from '@tiptap/react';
import { useBlockResize } from './useBlockResize';
import { generateHTML } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { useSelector, useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import type { RootState, AppDispatch } from '../../../../store';
import { setEditingNote } from '../../../../store/slices/notesSlice';
import { loadVaultNoteContent } from '../../../../store/slices/vaultsSlice';
import { extractSubtree, slugifyHeading } from '../../../../services/notes/transclusionHelpers';

interface TransclusionNodeViewProps {
  editor: Editor;
  node: {
    attrs: {
      noteId: string;
      noteTitle: string;
      section: string | null;
      blockId: string | null;
      alias: string | null;
      preview: string;
      /** Largeur en pixels réglée à la poignée ; `null` = largeur d'office. */
      blockWidthPx?: number | null;
      /** Hauteur bornée en pixels ; `null` = aussi haut qu'il faut. */
      blockHeightPx?: number | null;
    };
  };
  updateAttributes: (attrs: Record<string, unknown>) => void;
  selected: boolean;
  deleteNode: () => void;
}

/** Conservative max nesting depth — guards against A→B→A cycles and runaway costs. */
const MAX_DEPTH = 5;

export const TransclusionNodeView: React.FC<TransclusionNodeViewProps> = ({
  editor,
  node,
  updateAttributes,
  selected,
  deleteNode,
}) => {
  // Même garde que les autres vues : le schéma est monté par quatre surfaces,
  // dont des rendus en lecture seule.
  const resize = useBlockResize(
    node.attrs.blockWidthPx,
    node.attrs.blockHeightPx,
    updateAttributes,
    {
      disabled: !editor.isEditable,
    }
  );
  const dispatch = useDispatch<AppDispatch>();
  const { noteId, section, blockId, alias } = node.attrs;
  const { t } = useTranslation();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [depth, setDepth] = useState(0);

  // A `vault:<vaultId>:<itemId>` ref embeds a team-vault note (E3-3c); anything else
  // is a personal note id.
  const isVaultRef = noteId.startsWith('vault:');
  const vaultRef = isVaultRef ? noteId.slice('vault:'.length) : '';
  const [vaultLoad, setVaultLoad] = useState<'idle' | 'loading' | 'error'>('idle');

  // Look up the depth from the DOM chain — each transclusion sets
  // `data-transclusion-depth` on its wrapper; we read the closest ancestor
  // to know how deep we are, then write our own depth so descendants can.
  useEffect(() => {
    if (!wrapperRef.current) return;
    let parent = wrapperRef.current.parentElement;
    let d = 0;
    while (parent) {
      const attr = parent.getAttribute?.('data-transclusion-depth');
      if (attr) {
        d = parseInt(attr, 10) + 1;
        break;
      }
      parent = parent.parentElement;
    }
    setDepth(d);
  }, []);

  // Read the linked note live so renames + content edits propagate.
  // Soft-deleted notes (deletedAt set) are treated as missing so the
  // orphan placeholder shows up while the note is in the trash — embedding
  // a trashed note's content would be confusing.
  // Personal note (live) — only for non-vault refs.
  const personalNote = useSelector((state: RootState) => {
    if (!noteId || isVaultRef) return undefined;
    const n = state.notes.byId[noteId];
    return n && !n.deletedAt ? n : undefined;
  });

  // Vault-note body (E3-3c): decrypted on demand into a memory-only cache. The
  // personal note stores ONLY the `vault:<vaultId>:<itemId>` reference, never the
  // plaintext — so embedding can't leak vault content into the personal note's store
  // or its exports (the static renderHTML emits only the title, no body).
  const vaultContent = useSelector((state: RootState) =>
    isVaultRef ? state.vaults.noteContentByRef[vaultRef] : undefined
  );

  useEffect(() => {
    if (!isVaultRef || vaultContent !== undefined) return;
    const sep = vaultRef.indexOf(':');
    const vId = sep > 0 ? vaultRef.slice(0, sep) : '';
    const iId = sep > 0 ? vaultRef.slice(sep + 1) : '';
    if (!vId || !iId) {
      setVaultLoad('error');
      return;
    }
    let cancelled = false;
    setVaultLoad('loading');
    dispatch(loadVaultNoteContent({ vaultId: vId, itemId: iId }))
      .unwrap()
      .then(() => {
        if (!cancelled) setVaultLoad('idle');
      })
      .catch(() => {
        if (!cancelled) setVaultLoad('error');
      });
    return () => {
      cancelled = true;
    };
  }, [isVaultRef, vaultRef, vaultContent, dispatch]);

  // Unified note-like source ({ title, content }) for both personal and vault refs.
  // Memoised so its identity is stable while content is unchanged — otherwise the
  // vault branch builds a fresh object each render and invalidates the renderedHTML
  // memo below, re-running generateHTML on every keystroke/selection.
  const linkedNote = useMemo(
    () =>
      isVaultRef
        ? vaultContent !== undefined
          ? { title: node.attrs.noteTitle, content: vaultContent }
          : undefined
        : personalNote,
    [isVaultRef, vaultContent, node.attrs.noteTitle, personalNote]
  );

  const displayTitle = alias || linkedNote?.title || node.attrs.noteTitle || 'Untitled';

  const handleOpenSource = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (noteId) dispatch(setEditingNote(noteId));
    },
    [dispatch, noteId]
  );

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      deleteNode();
    },
    [deleteNode]
  );

  // Render the embedded note content to static HTML. Recomputed only when
  // the source's content actually changes (referential equality on
  // linkedNote.content keeps re-renders cheap when unrelated notes change).
  const renderedHTML = useMemo(() => {
    if (!linkedNote || depth >= MAX_DEPTH) return '';
    let json: unknown;
    try {
      json =
        typeof linkedNote.content === 'string'
          ? JSON.parse(linkedNote.content)
          : linkedNote.content;
    } catch {
      return '';
    }
    // Une note de coffre COMMENTÉE arrive sous l'enveloppe filarr.note+comments :
    // l'embed rend le doc, jamais les commentaires. La branche objet (contenu
    // déjà parsé) passe par la même normalisation.
    const normalized = normalizeVaultNoteBodyValue(json);
    if (normalized) json = normalized.doc;

    // Apply section/block subtree extraction if requested.
    const targeted = extractSubtree(json, { section, blockId });
    if (!targeted) return '';

    try {
      return generateHTML(targeted as never, editor.extensionManager.extensions);
    } catch (err) {
      console.warn('[transclusion] generateHTML failed:', err);
      return '';
    }
  }, [linkedNote, section, blockId, depth, editor]);

  const isVaultLoading = isVaultRef && vaultContent === undefined && vaultLoad !== 'error';
  const isVaultError = isVaultRef && vaultContent === undefined && vaultLoad === 'error';
  const isOrphan = !isVaultRef && noteId && !linkedNote;
  const tooDeep = depth >= MAX_DEPTH;
  const subTargetLabel = section ? `# ${section}` : blockId ? `^ ${blockId}` : null;

  return (
    <NodeViewWrapper
      ref={resize.ref}
      className={`transclusion ${resize.className}${selected ? ' transclusion--selected' : ''}`}
      style={resize.style}
      data-transclusion=""
      data-transclusion-depth={depth}
    >
      {resize.grip}
      <div ref={wrapperRef}>
        <button
          type="button"
          className="transclusion__header"
          onClick={handleOpenSource}
          title={`Ouvrir « ${displayTitle} »`}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" />
            <polyline points="14,2 14,8 20,8" />
          </svg>
          <span className="transclusion__title">{displayTitle}</span>
          {subTargetLabel && <span className="transclusion__subtarget">{subTargetLabel}</span>}
          {selected && (
            <span
              className="transclusion__remove"
              onClick={handleDelete}
              role="button"
              tabIndex={0}
              aria-label="Supprimer l'embed"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </span>
          )}
        </button>

        {isVaultError ? (
          <div className="transclusion__content transclusion__content--orphan">
            ⚠️ {t('teamVaults.transclusion.noAccess')}
          </div>
        ) : isVaultLoading ? (
          <div className="transclusion__content transclusion__content--empty">
            {t('teamVaults.transclusion.loading')}
          </div>
        ) : isOrphan ? (
          <div className="transclusion__content transclusion__content--orphan">
            ⚠️ Source supprimée
          </div>
        ) : tooDeep ? (
          <div className="transclusion__content transclusion__content--deep">
            … embed trop profond (max {MAX_DEPTH})
          </div>
        ) : !renderedHTML ? (
          <div className="transclusion__content transclusion__content--empty">
            {section || blockId ? `Aucun contenu trouvé pour ${subTargetLabel}` : 'Note vide'}
          </div>
        ) : (
          <div
            className="transclusion__content"
            contentEditable={false}
            // generateHTML output comes from sanitized ProseMirror JSON in our
            // own store — same trust boundary as the original note's editor.
            dangerouslySetInnerHTML={{ __html: renderedHTML }}
          />
        )}
      </div>
    </NodeViewWrapper>
  );
};

export { slugifyHeading };
