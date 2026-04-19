/**
 * VersionScrubber — Option 2
 *
 * Fullscreen immersive mode with a horizontal time track at the top.
 * The user drags a thumb along the track to "travel in time"; the
 * preview below updates live to show the selected version as a
 * read-only TipTap render. Checkpoints on the track mark each stored
 * version and snap the thumb to them.
 *
 * Design notes:
 *   - We render through a portal so the editor underneath stays
 *     untouched and unchanged. Exit always returns cleanly.
 *   - Snap-to-checkpoint is deliberate: free-scrubbing between
 *     versions has no meaning — we can only show snapshotted states.
 *   - Keyboard: ArrowLeft/ArrowRight move one step, Home/End jump
 *     to endpoints, ESC closes, Enter restores.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../../../../store';
import { updateNote, updateNoteContent } from '../../../../store/slices/notesSlice';
import {
  getVersion,
  listVersions,
  type NoteVersionContent,
  type NoteVersionMeta,
} from '../../../../services/notes/noteVersionService';
import VersionRender from './VersionRender';
import VersionModeSelector from './VersionModeSelector';
import type { VersionHistoryMode } from './useVersionHistoryMode';
import './VersionScrubber.css';

interface VersionScrubberProps {
  noteId: string;
  currentContent: string;
  currentPlainText: string;
  onClose: () => void;
  mode: VersionHistoryMode;
  onModeChange: (m: VersionHistoryMode) => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compute the fractional position [0..1] of a version on a time axis
 * that runs from the oldest savedAt to now. We use time as the scale
 * rather than index so clusters of edits appear clustered on the track,
 * giving a visual rhythm of activity.
 */
function computePositions(versions: NoteVersionMeta[], nowMs: number): number[] {
  if (versions.length === 0) return [];
  if (versions.length === 1) return [1];

  // Versions come newest-first from the service.
  const oldestMs = Date.parse(versions[versions.length - 1].savedAt);
  const span = Math.max(1, nowMs - oldestMs);
  return versions.map((v) => (Date.parse(v.savedAt) - oldestMs) / span);
}

function formatFullDate(isoDate: string, locale: string): string {
  return new Date(isoDate).toLocaleString(locale || undefined, {
    dateStyle: 'full',
    timeStyle: 'short',
  });
}

/**
 * Compact format for the floating bubble that follows the thumb.
 * We want something scannable at a glance during a drag — full date
 * is too long, so we fall back to a relative or HH:MM form for same-day
 * entries and a short absolute for older ones.
 */
function formatBubbleDate(isoDate: string, locale: string): string {
  const d = new Date(isoDate);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();

  if (sameDay) {
    return d.toLocaleTimeString(locale || undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return d.toLocaleDateString(locale || undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Component ───────────────────────────────────────────────────────────────

export const VersionScrubber: React.FC<VersionScrubberProps> = ({
  noteId,
  currentContent,
  currentPlainText,
  onClose,
  mode,
  onModeChange,
}) => {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();

  const [versions, setVersions] = useState<NoteVersionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [content, setContent] = useState<NoteVersionContent | null>(null);
  const [busy, setBusy] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  // ── Load list on mount, reverse to oldest-first for the track ────────────

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listVersions(noteId).then((list) => {
      if (cancelled) return;
      setVersions(list);
      setSelectedIndex(0); // newest
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  // ── Load content when selection changes ──────────────────────────────────

  useEffect(() => {
    const v = versions[selectedIndex];
    if (!v) {
      setContent(null);
      return;
    }
    let cancelled = false;
    getVersion(noteId, v.id).then((full) => {
      if (!cancelled) setContent(full);
    });
    return () => {
      cancelled = true;
    };
  }, [noteId, versions, selectedIndex]);

  // ── Positions on the track ──────────────────────────────────────────────

  const positions = useMemo(() => computePositions(versions, Date.now()), [versions]);

  // ── Navigation (keyboard + scrubbing) ───────────────────────────────────

  const goTo = useCallback(
    (nextIndex: number) => {
      if (versions.length === 0) return;
      const clamped = Math.max(0, Math.min(versions.length - 1, nextIndex));
      setSelectedIndex(clamped);
    },
    [versions]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        // Left = older in time. Newest is index 0, so older = higher index.
        goTo(selectedIndex + 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goTo(selectedIndex - 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        goTo(versions.length - 1); // oldest
      } else if (e.key === 'End') {
        e.preventDefault();
        goTo(0); // newest
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, goTo, selectedIndex, versions.length]);

  /**
   * Find the nearest checkpoint index for a given click/drag x within
   * the track. Snaps to whichever checkpoint is closest in fractional
   * position, so the user can't end up "between" versions.
   */
  const handleTrackPointer = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el || positions.length === 0) return;
      const rect = el.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));

      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < positions.length; i++) {
        const d = Math.abs(positions[i] - frac);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      goTo(bestIdx);
    },
    [positions, goTo]
  );

  const onTrackMouseDown = useCallback(
    (e: React.MouseEvent) => {
      handleTrackPointer(e.clientX);
      const move = (ev: MouseEvent) => handleTrackPointer(ev.clientX);
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [handleTrackPointer]
  );

  // ── Restore ─────────────────────────────────────────────────────────────

  const handleRestore = useCallback(async () => {
    if (!content || busy) return;
    setBusy(true);
    try {
      dispatch(updateNote({ id: noteId, changes: { title: content.title } }));
      dispatch(
        updateNoteContent({
          id: noteId,
          content: content.content,
          plainText: content.plainText,
        })
      );
      onClose();
    } finally {
      setBusy(false);
    }
  }, [content, busy, dispatch, noteId, onClose]);

  // ── Render ──────────────────────────────────────────────────────────────

  const activePosition = positions[selectedIndex] ?? 0;
  const current = versions[selectedIndex];
  const isViewingCurrent = !!content && currentContent && content.content === currentContent;

  const body = (
    <div
      className="scrubber"
      role="dialog"
      aria-modal="true"
      aria-label={t('notes.versionHistory', 'Historique des versions')}
    >
      {/* Header */}
      <header className="scrubber__header">
        <button
          type="button"
          className="scrubber__close"
          onClick={onClose}
          aria-label={t('common.close', 'Fermer')}
        >
          ×
        </button>

        <div className="scrubber__nav">
          <button
            type="button"
            className="scrubber__nav-btn"
            onClick={() => goTo(selectedIndex + 1)}
            disabled={selectedIndex >= versions.length - 1}
            aria-label={t('notes.versions.olderBtn', 'Version plus ancienne')}
          >
            ←
          </button>
          <div className="scrubber__date">
            {loading
              ? t('common.loading', 'Chargement…')
              : current
                ? formatFullDate(current.savedAt, i18n.language)
                : t('notes.noVersions', 'Aucune version')}
          </div>
          <button
            type="button"
            className="scrubber__nav-btn"
            onClick={() => goTo(selectedIndex - 1)}
            disabled={selectedIndex <= 0}
            aria-label={t('notes.versions.newerBtn', 'Version plus récente')}
          >
            →
          </button>
        </div>

        <VersionModeSelector mode={mode} onChange={onModeChange} />

        <button
          type="button"
          className="scrubber__restore"
          onClick={handleRestore}
          disabled={!content || busy || !!isViewingCurrent}
          title={
            isViewingCurrent
              ? t('notes.versions.alreadyCurrent', 'Déjà la version actuelle')
              : undefined
          }
        >
          {t('notes.restoreVersion', 'Restaurer cette version')}
        </button>
      </header>

      {/* Track */}
      <div className="scrubber__track-wrap">
        <div
          className="scrubber__track"
          ref={trackRef}
          onMouseDown={onTrackMouseDown}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, versions.length - 1)}
          aria-valuenow={selectedIndex}
          tabIndex={0}
        >
          <div className="scrubber__track-line" />

          {/* Checkpoints — native tooltip on hover, hover-bubble via
              onMouseEnter so the user sees the target time before clicking. */}
          {positions.map((frac, i) => {
            const v = versions[i];
            const title = v
              ? `${formatFullDate(v.savedAt, i18n.language)} · ${v.wordCount} ${t(
                  'notes.words',
                  'mots'
                )}`
              : undefined;
            return (
              <button
                key={v?.id ?? i}
                type="button"
                className={`scrubber__checkpoint ${
                  i === selectedIndex ? 'scrubber__checkpoint--active' : ''
                }`}
                style={{ left: `${frac * 100}%` }}
                onClick={(e) => {
                  e.stopPropagation();
                  goTo(i);
                }}
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex((h) => (h === i ? null : h))}
                aria-label={title}
                title={title}
              />
            );
          })}

          {/* Floating date bubble that travels with the active thumb. */}
          {current && (
            <div
              className="scrubber__bubble"
              style={{ left: `${activePosition * 100}%` }}
              aria-hidden="true"
            >
              {formatBubbleDate(current.savedAt, i18n.language)}
              <span className="scrubber__bubble-sub">
                {current.wordCount} {t('notes.words', 'mots')}
              </span>
            </div>
          )}

          {/* Thumb */}
          {versions.length > 0 && (
            <div className="scrubber__thumb" style={{ left: `${activePosition * 100}%` }} />
          )}

          {/* Hover preview bubble for non-selected checkpoints — lets
              the user peek at a time before committing to click. */}
          {hoverIndex !== null && hoverIndex !== selectedIndex && versions[hoverIndex] && (
            <div
              className="scrubber__hover-bubble"
              style={{ left: `${positions[hoverIndex] * 100}%` }}
              aria-hidden="true"
            >
              {formatBubbleDate(versions[hoverIndex].savedAt, i18n.language)}
            </div>
          )}
        </div>

        <div className="scrubber__track-ends">
          <span>
            {versions.length > 0 ? t('notes.versions.oldest', 'plus ancienne') : '\u00A0'}
          </span>
          <span>{versions.length > 0 ? t('notes.versions.newest', 'plus récente') : '\u00A0'}</span>
        </div>
      </div>

      {/* Preview */}
      <main className="scrubber__preview">
        {loading ? (
          <div className="scrubber__preview-empty">{t('common.loading', 'Chargement…')}</div>
        ) : versions.length === 0 ? (
          <div className="scrubber__preview-empty">
            {t(
              'notes.noVersions',
              'Aucune version enregistrée pour le moment. Continuez à éditer — les snapshots apparaîtront ici automatiquement.'
            )}
          </div>
        ) : !content ? (
          <div className="scrubber__preview-empty">…</div>
        ) : (
          <article className="scrubber__doc">
            <h1 className="scrubber__doc-title">
              {content.title || t('notes.untitled', 'Sans titre')}
            </h1>
            <div className="scrubber__doc-meta">
              {content.wordCount} {t('notes.words', 'mots')}
              {' · '}
              {t('notes.versions.snapshotTaken', 'capture du')}{' '}
              {formatFullDate(content.savedAt, i18n.language)}
            </div>
            <VersionRender
              content={content.content}
              plainTextFallback={content.plainText}
              className="scrubber__render"
            />
          </article>
        )}
      </main>
    </div>
  );

  return ReactDOM.createPortal(body, document.body);
};

export default VersionScrubber;
