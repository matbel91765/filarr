/**
 * BacklinksPanel Component — Filarr Notes
 *
 * Displays all notes that reference the currently selected note (backlinks),
 * plus linked files and folders.
 */

import React, { useDeferredValue, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../store';
import { setEditingNote } from '../../../store/slices/notesSlice';
import { findBacklinks, findFileBacklinks } from '../../../services/notes/noteService';
import { findPotentialLinks, requestPotentialLink } from '../../../services/notes/autoLinkService';
import type { Note, Backlink } from '../../../types/notes';
import type { PotentialLink } from '../../../services/notes/autoLinkService';
import { Button } from '../ui/Button';
import { useNotification } from '../ui/Notification';
import './BacklinksPanel.css';

// ==================== Icons ====================

const BacklinkIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M9 17H7A5 5 0 017 7h2" />
    <path d="M15 7h2a5 5 0 010 10h-2" />
    <line x1="8" y1="12" x2="16" y2="12" />
  </svg>
);

const NoteRefIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
  >
    <path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" />
    <polyline points="14,2 14,8 20,8" />
  </svg>
);

const FileRefIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
  >
    <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
    <polyline points="13,2 13,9 20,9" />
  </svg>
);

const FolderRefIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
  >
    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
  </svg>
);

const UnlinkedIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M16.88 3.549L7.12 20.451" />
    <path d="M9 17H7A5 5 0 017 7h2" />
    <path d="M15 7h2a5 5 0 010 10h-2" />
  </svg>
);

const MagnetIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M6 15a6 6 0 0012 0V4h-4v11a2 2 0 11-4 0V4H6v11z" />
    <line x1="6" y1="4" x2="10" y2="4" />
    <line x1="14" y1="4" x2="18" y2="4" />
  </svg>
);

const ChevronIcon: React.FC<{ open: boolean }> = ({ open }) => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    style={{ transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'rotate(0)' }}
  >
    <polyline points="9,18 15,12 9,6" />
  </svg>
);

// ==================== Layout ====================

/**
 * A "Link" action can't live INSIDE `.backlinks-panel__item` — that item is
 * itself a button, and nesting two is invalid. The row splits it in two
 * instead; these three constants are the whole of the extra layout, kept as
 * frozen objects so they never re-render the memoised rows.
 */
const LINK_ALL_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  padding: '0 4px 4px',
};

const POTENTIAL_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

const POTENTIAL_ITEM_STYLE: React.CSSProperties = { flex: 1, minWidth: 0 };

/**
 * How long a linked row stays hidden on the panel's own say-so. The store
 * normally catches up in ~600 ms (editor debounce + link resolution); this is
 * generous enough to cover it and short enough that, if the rewrite somehow
 * did NOT stick, the row comes back instead of quietly vanishing.
 */
const OPTIMISTIC_HIDE_MS = 4000;

// ==================== Component ====================

interface BacklinksPanelProps {
  noteId: string;
}

export const BacklinksPanel: React.FC<BacklinksPanelProps> = React.memo(function BacklinksPanel({
  noteId,
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const { error: notifyError } = useNotification();

  const notesById = useSelector((s: RootState) => s.notes.byId);
  const filesById = useSelector((s: RootState) => s.files.byId);
  const foldersById = useSelector((s: RootState) => s.folders.byId);
  const note = notesById[noteId];

  const [showBacklinks, setShowBacklinks] = React.useState(true);
  const [showOutgoing, setShowOutgoing] = React.useState(true);
  // Open by default: the section only exists when there IS something to link,
  // and a collapsed count is a chore nobody opens. Unlinked mentions stay
  // folded — they carry no action, only information about other notes.
  const [showPotential, setShowPotential] = React.useState(true);
  const [showUnlinked, setShowUnlinked] = React.useState(false);

  // Defer the heavy scans (findBacklinks, findPotentialLinks, unlinked
  // mentions) behind React's concurrent renderer. When the user opens
  // a note, these three memos would otherwise block the main thread
  // with O(N) / O(N*M) walks over every note before the editor can
  // paint. With useDeferredValue the first commit uses the previous
  // note's data (cheap reprint), then React reruns the heavy work at
  // lower priority — the editor becomes interactive in a single frame.
  const deferredNoteId = useDeferredValue(noteId);
  const deferredNotesById = useDeferredValue(notesById);

  // Incoming: who links to this note
  const backlinks = useMemo(
    () => findBacklinks(deferredNoteId, deferredNotesById),
    [deferredNoteId, deferredNotesById]
  );

  // Outgoing: what this note links to
  const linkedNotes = useMemo(
    () => (note?.linkedNoteIds || []).map((id) => notesById[id]).filter(Boolean) as Note[],
    [note, notesById]
  );

  const linkedFiles = useMemo(
    () => (note?.linkedFileIds || []).map((id) => filesById[id]).filter(Boolean),
    [note, filesById]
  );

  const linkedFolders = useMemo(
    () => (note?.linkedFolderIds || []).map((id) => foldersById[id]).filter(Boolean),
    [note, foldersById]
  );

  // Potential links: note title mentions that aren't wiki-linked
  const potentialLinks = useMemo(
    () => findPotentialLinks(deferredNoteId, deferredNotesById),
    [deferredNoteId, deferredNotesById]
  );

  /**
   * Titles the editor just confirmed it linked. The store is the authority, but
   * it only catches up after the editor's write-back debounce and the link
   * resolution thunk — nearly a second during which the row the user just acted
   * on would sit there unchanged, as if the click had done nothing. So we hide
   * it on the editor's word, and let the timer below hand authority back.
   */
  const [justLinked, setJustLinked] = React.useState<string[]>([]);
  const hideTimerRef = React.useRef<number | null>(null);

  // Another note, another set of mentions — never carry the optimism across.
  React.useEffect(() => {
    setJustLinked([]);
  }, [noteId]);

  React.useEffect(
    () => () => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    },
    []
  );

  const visiblePotentialLinks = useMemo(
    () =>
      justLinked.length === 0
        ? potentialLinks
        : potentialLinks.filter((pl) => !justLinked.includes(pl.matchedTitle)),
    [potentialLinks, justLinked]
  );

  // Unlinked mentions: other notes that mention THIS note's title without wiki-linking
  const deferredNote = deferredNotesById[deferredNoteId];
  const unlinkedMentions = useMemo(() => {
    if (!deferredNote || !deferredNote.title || deferredNote.title.trim().length < 2) return [];
    const titleLower = deferredNote.title.toLowerCase();
    const results: Array<{ noteId: string; title: string; context: string }> = [];

    for (const other of Object.values(deferredNotesById)) {
      if (other.id === deferredNoteId || other.deletedAt || !other.plainText) continue;
      // Skip if already backlinked
      if (other.linkedNoteIds.includes(deferredNoteId)) continue;

      const textLower = other.plainText.toLowerCase();
      const idx = textLower.indexOf(titleLower);
      if (idx === -1) continue;

      // Check word boundaries
      const charBefore = idx > 0 ? other.plainText[idx - 1] : ' ';
      const charAfter =
        idx + titleLower.length < other.plainText.length
          ? other.plainText[idx + titleLower.length]
          : ' ';
      if (!/[\s,.;:!?()[\]{}'"—–-]/.test(charBefore) && idx !== 0) continue;
      if (
        !/[\s,.;:!?()[\]{}'"—–-]/.test(charAfter) &&
        idx + titleLower.length !== other.plainText.length
      )
        continue;

      const ctxStart = Math.max(0, idx - 30);
      const ctxEnd = Math.min(other.plainText.length, idx + titleLower.length + 30);
      const prefix = ctxStart > 0 ? '...' : '';
      const suffix = ctxEnd < other.plainText.length ? '...' : '';
      const context = prefix + other.plainText.slice(ctxStart, ctxEnd).trim() + suffix;

      results.push({ noteId: other.id, title: other.title || 'Untitled', context });
    }
    return results;
  }, [deferredNoteId, deferredNote, deferredNotesById]);

  const handleBacklinkClick = (sourceNoteId: string) => {
    dispatch(setEditingNote(sourceNoteId));
  };

  /**
   * Linking happens in the EDITOR, not here: it holds the ProseMirror document
   * for this note, and a store-level rewrite would be overwritten at the next
   * keystroke. We only ask; `requestPotentialLink` carries `noteId` so the
   * right pane answers. Nothing to undo here either — the replacement lands in
   * the editor's own history.
   */
  /**
   * The call is a round trip: `dispatchEvent` is synchronous, so by the time it
   * returns we know whether anyone answered and what they managed to link. The
   * per-title failure toast is the editor's to raise (it is the one that
   * looked); what only WE can tell is that nobody was holding the note at all.
   */
  const handleLinkPotential = (titles: string[]) => {
    if (titles.length === 0) return;
    const result = requestPotentialLink(noteId, titles);
    if (!result.answered) {
      notifyError(
        t(
          'notes.potentialLinkNoEditor',
          'This note is not open in an editor — open it to link its mentions'
        )
      );
      return;
    }
    if (result.linked.length === 0) return;
    setJustLinked((prev) => [...prev, ...result.linked]);
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      setJustLinked([]);
    }, OPTIMISTIC_HIDE_MS);
  };

  if (!note) return null;

  const totalBacklinks = backlinks.length;
  const totalOutgoing = linkedNotes.length + linkedFiles.length + linkedFolders.length;

  return (
    <div className="backlinks-panel">
      {/* Backlinks (incoming) */}
      <button
        className="backlinks-panel__section-header"
        onClick={() => setShowBacklinks(!showBacklinks)}
      >
        <ChevronIcon open={showBacklinks} />
        <BacklinkIcon />
        <span className="backlinks-panel__section-title">{t('notes.backlinks', 'Backlinks')}</span>
        <span className="backlinks-panel__section-count">{totalBacklinks}</span>
      </button>

      {showBacklinks && (
        <div className="backlinks-panel__section-body">
          {backlinks.length === 0 ? (
            <p className="backlinks-panel__empty">
              {t('notes.noBacklinks', 'No other notes link here')}
            </p>
          ) : (
            backlinks.map((bl) => (
              <button
                key={bl.sourceNoteId}
                className="backlinks-panel__item"
                onClick={() => handleBacklinkClick(bl.sourceNoteId)}
              >
                <NoteRefIcon />
                <div className="backlinks-panel__item-info">
                  <span className="backlinks-panel__item-title">
                    {bl.sourceNoteTitle || 'Untitled'}
                  </span>
                  <span className="backlinks-panel__item-context">{bl.context}</span>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {/* Outgoing links */}
      <button
        className="backlinks-panel__section-header"
        onClick={() => setShowOutgoing(!showOutgoing)}
      >
        <ChevronIcon open={showOutgoing} />
        <span className="backlinks-panel__section-title">
          {t('notes.outgoingLinks', 'Linked Items')}
        </span>
        <span className="backlinks-panel__section-count">{totalOutgoing}</span>
      </button>

      {showOutgoing && (
        <div className="backlinks-panel__section-body">
          {totalOutgoing === 0 ? (
            <p className="backlinks-panel__empty">{t('notes.noLinks', 'No linked items')}</p>
          ) : (
            <>
              {linkedNotes.map((n) => (
                <button
                  key={n.id}
                  className="backlinks-panel__item"
                  onClick={() => handleBacklinkClick(n.id)}
                >
                  <NoteRefIcon />
                  <span className="backlinks-panel__item-title">{n.title || 'Untitled'}</span>
                </button>
              ))}
              {linkedFiles.map((f) => (
                <div key={f.id} className="backlinks-panel__item backlinks-panel__item--static">
                  <FileRefIcon />
                  <span className="backlinks-panel__item-title">{f.name}</span>
                </div>
              ))}
              {linkedFolders.map((f) => (
                <div key={f.id} className="backlinks-panel__item backlinks-panel__item--static">
                  <FolderRefIcon />
                  <span className="backlinks-panel__item-title">{f.name}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Potential links (auto-detected mentions in this note) */}
      {visiblePotentialLinks.length > 0 && (
        <>
          <button
            className="backlinks-panel__section-header"
            onClick={() => setShowPotential(!showPotential)}
          >
            <ChevronIcon open={showPotential} />
            <MagnetIcon />
            <span className="backlinks-panel__section-title">
              {t('notes.potentialLinks', 'Potential Links')}
            </span>
            <span className="backlinks-panel__section-count">{visiblePotentialLinks.length}</span>
          </button>
          {showPotential && (
            <div className="backlinks-panel__section-body">
              {visiblePotentialLinks.length > 1 && (
                <div style={LINK_ALL_ROW_STYLE}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      handleLinkPotential(visiblePotentialLinks.map((pl) => pl.matchedTitle))
                    }
                  >
                    {t('notes.linkAllMentions', 'Link all')}
                  </Button>
                </div>
              )}
              {visiblePotentialLinks.map((pl) => (
                <div key={pl.noteId} style={POTENTIAL_ROW_STYLE}>
                  <button
                    className="backlinks-panel__item"
                    style={POTENTIAL_ITEM_STYLE}
                    onClick={() => handleBacklinkClick(pl.noteId)}
                  >
                    <NoteRefIcon />
                    <div className="backlinks-panel__item-info">
                      <span className="backlinks-panel__item-title">{pl.matchedTitle}</span>
                      <span className="backlinks-panel__item-context">{pl.context}</span>
                    </div>
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleLinkPotential([pl.matchedTitle])}
                    aria-label={t('notes.linkMentionNamed', 'Link the mention of {{title}}', {
                      title: pl.matchedTitle,
                    })}
                    title={t('notes.linkMention', 'Link this mention')}
                  >
                    {t('notes.linkMentionShort', 'Link')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/*
        Unlinked mentions (OTHER notes mentioning this note's title).
        No "Link" action here, deliberately: the mention lives in a document
        this pane doesn't hold. Rewriting it would mean editing another note's
        content from the store, which the editor holding it would overwrite at
        the next keystroke (see `noteEditorRegistry`). Clicking still navigates
        — from there the mention shows up as a potential link, with its button.
      */}
      {unlinkedMentions.length > 0 && (
        <>
          <button
            className="backlinks-panel__section-header"
            onClick={() => setShowUnlinked(!showUnlinked)}
          >
            <ChevronIcon open={showUnlinked} />
            <UnlinkedIcon />
            <span className="backlinks-panel__section-title">
              {t('notes.unlinkedMentions', 'Unlinked Mentions')}
            </span>
            <span className="backlinks-panel__section-count">{unlinkedMentions.length}</span>
          </button>
          {showUnlinked && (
            <div className="backlinks-panel__section-body">
              {unlinkedMentions.map((um) => (
                <button
                  key={um.noteId}
                  className="backlinks-panel__item"
                  onClick={() => handleBacklinkClick(um.noteId)}
                >
                  <NoteRefIcon />
                  <div className="backlinks-panel__item-info">
                    <span className="backlinks-panel__item-title">{um.title}</span>
                    <span className="backlinks-panel__item-context">{um.context}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
});

export default BacklinksPanel;
