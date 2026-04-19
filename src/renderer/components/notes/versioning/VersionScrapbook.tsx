/**
 * VersionScrapbook — Option 4
 *
 * Fullscreen modal with a two-column layout:
 *   - Left: version list grouped by day, each entry showing title,
 *     relative time, and word delta vs the previous version.
 *   - Right: large rendered preview of the selected version, or a
 *     line-based diff against the current content if toggled.
 *
 * Rendered through a React portal into `document.body` so it sits
 * above the whole app and doesn't inherit positioning from the
 * editor tree. ESC closes, arrow keys navigate.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../../../../store';
import { updateNote, updateNoteContent } from '../../../../store/slices/notesSlice';
import {
  deleteVersion,
  diffVersions,
  getVersion,
  listVersions,
  type NoteVersionContent,
  type NoteVersionMeta,
  type VersionDiffLine,
} from '../../../../services/notes/noteVersionService';

/**
 * Collapse runs of consecutive "same" or empty-unchanged lines in the
 * diff output so long unchanged blocks become a single "… N unchanged
 * lines" marker. Keeps added/removed context unchanged.
 */
type CollapsedMarker = { kind: 'collapsed'; count: number };
type DiffDisplayItem = { kind: 'line'; line: VersionDiffLine } | CollapsedMarker;

function collapseDiff(lines: VersionDiffLine[], threshold = 3): DiffDisplayItem[] {
  const out: DiffDisplayItem[] = [];
  let run: VersionDiffLine[] = [];

  const flush = () => {
    if (run.length === 0) return;
    if (run.length > threshold) {
      // Show first line for upstream context, collapse middle, show last line.
      out.push({ kind: 'line', line: run[0] });
      out.push({ kind: 'collapsed', count: run.length - 2 });
      out.push({ kind: 'line', line: run[run.length - 1] });
    } else {
      for (const l of run) out.push({ kind: 'line', line: l });
    }
    run = [];
  };

  for (const l of lines) {
    if (l.type === 'same') {
      run.push(l);
    } else {
      flush();
      out.push({ kind: 'line', line: l });
    }
  }
  flush();
  return out;
}

/**
 * Augment each version meta with its delta (wordCount diff against
 * the older neighbor). For the oldest version, delta is `null` and
 * the UI shows nothing.
 */
function withDeltas(
  versions: NoteVersionMeta[]
): Array<NoteVersionMeta & { delta: number | null }> {
  // Versions come newest-first. For each, the "previous" version is
  // the next index (older in time).
  return versions.map((v, i) => {
    const older = versions[i + 1];
    return {
      ...v,
      delta: older ? v.wordCount - older.wordCount : null,
    };
  });
}
import VersionRender from './VersionRender';
import VersionModeSelector from './VersionModeSelector';
import type { VersionHistoryMode } from './useVersionHistoryMode';
import './VersionScrapbook.css';

interface VersionScrapbookProps {
  noteId: string;
  currentContent: string;
  currentPlainText: string;
  onClose: () => void;
  mode: VersionHistoryMode;
  onModeChange: (m: VersionHistoryMode) => void;
}

type PreviewMode = 'render' | 'diff';

// ── Date grouping helpers ───────────────────────────────────────────────────

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

type TranslateFn = (key: string, defaultValue?: string) => string;

function groupLabel(isoDate: string, nowMs: number, locale: string, t: TranslateFn): string {
  const savedMs = Date.parse(isoDate);
  const savedDay = startOfDay(new Date(savedMs));
  const today = startOfDay(new Date(nowMs));
  const dayDiff = Math.round((today - savedDay) / 86_400_000);

  if (dayDiff === 0) return t('notes.versions.groupToday', "Aujourd'hui");
  if (dayDiff === 1) return t('notes.versions.groupYesterday', 'Hier');
  if (dayDiff < 7) return t('notes.versions.groupThisWeek', 'Cette semaine');
  if (dayDiff < 30) return t('notes.versions.groupThisMonth', 'Ce mois-ci');

  return new Date(savedMs).toLocaleDateString(locale || undefined, {
    year: 'numeric',
    month: 'long',
  });
}

function relativeTime(isoDate: string, nowMs: number, locale: string): string {
  const delta = nowMs - Date.parse(isoDate);
  const mins = Math.round(delta / 60_000);
  if (mins < 1) return 'à l’instant';
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return new Date(isoDate).toLocaleDateString(locale || undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Component ───────────────────────────────────────────────────────────────

export const VersionScrapbook: React.FC<VersionScrapbookProps> = ({
  noteId,
  currentPlainText,
  onClose,
  mode,
  onModeChange,
}) => {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();

  const [versions, setVersions] = useState<NoteVersionMeta[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedContent, setSelectedContent] = useState<NoteVersionContent | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('render');
  const [diffLines, setDiffLines] = useState<VersionDiffLine[] | null>(null);
  const [busy, setBusy] = useState(false);

  // ── Initial list fetch + auto-select newest ─────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setLoadingList(true);
    listVersions(noteId).then((list) => {
      if (cancelled) return;
      setVersions(list);
      setSelectedId(list[0]?.id ?? null);
      setLoadingList(false);
    });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  // ── Load content when selection changes ──────────────────────────────────

  useEffect(() => {
    if (!selectedId) {
      setSelectedContent(null);
      setDiffLines(null);
      return;
    }
    let cancelled = false;
    setLoadingContent(true);
    getVersion(noteId, selectedId).then((full) => {
      if (cancelled) return;
      setSelectedContent(full);
      setDiffLines(full ? diffVersions(full.plainText, currentPlainText) : null);
      setLoadingContent(false);
    });
    return () => {
      cancelled = true;
    };
  }, [noteId, selectedId, currentPlainText]);

  // ── Keyboard ────────────────────────────────────────────────────────────

  const goToIndex = useCallback(
    (delta: number) => {
      setSelectedId((current) => {
        if (!versions.length) return current;
        const idx = versions.findIndex((v) => v.id === current);
        const next = Math.max(0, Math.min(versions.length - 1, idx + delta));
        return versions[next]?.id ?? current;
      });
    },
    [versions]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        goToIndex(1);
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        goToIndex(-1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, goToIndex]);

  // ── Grouping for display ────────────────────────────────────────────────

  const groups = useMemo(() => {
    const now = Date.now();
    const map = new Map<string, Array<NoteVersionMeta & { delta: number | null }>>();
    // Adapter: useTranslation's `t` return type is broader than our
    // plain string contract; the call shape matches, we just narrow it.
    const tr: TranslateFn = (key, def) => t(key, def ?? '') as string;
    const withDelta = withDeltas(versions);
    for (const v of withDelta) {
      const label = groupLabel(v.savedAt, now, i18n.language, tr);
      const list = map.get(label) ?? [];
      list.push(v);
      map.set(label, list);
    }
    return Array.from(map.entries());
  }, [versions, i18n.language, t]);

  // Collapse long unchanged runs in the diff to reduce visual noise
  // for small-edit versions with lots of context.
  const collapsedDiff = useMemo(() => (diffLines ? collapseDiff(diffLines) : null), [diffLines]);

  // ── Actions ─────────────────────────────────────────────────────────────

  const handleRestore = useCallback(async () => {
    if (!selectedContent || busy) return;
    setBusy(true);
    try {
      dispatch(updateNote({ id: noteId, changes: { title: selectedContent.title } }));
      dispatch(
        updateNoteContent({
          id: noteId,
          content: selectedContent.content,
          plainText: selectedContent.plainText,
        })
      );
      onClose();
    } finally {
      setBusy(false);
    }
  }, [selectedContent, busy, dispatch, noteId, onClose]);

  const handleDelete = useCallback(async () => {
    if (!selectedId || busy) return;
    const confirmed = window.confirm(
      t('notes.deleteVersionConfirm', 'Supprimer définitivement cette version ?')
    );
    if (!confirmed) return;

    setBusy(true);
    try {
      const ok = await deleteVersion(noteId, selectedId);
      if (ok) {
        const remaining = versions.filter((v) => v.id !== selectedId);
        setVersions(remaining);
        setSelectedId(remaining[0]?.id ?? null);
      }
    } finally {
      setBusy(false);
    }
  }, [selectedId, busy, t, noteId, versions]);

  // ── Render ──────────────────────────────────────────────────────────────

  const content = (
    <div
      className="scrapbook-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t('notes.versionHistory', 'Historique des versions')}
    >
      <div className="scrapbook">
        {/* Header */}
        <header className="scrapbook__header">
          <div className="scrapbook__header-left">
            <h2 className="scrapbook__title">
              {t('notes.versionHistory', 'Historique des versions')}
            </h2>
            <span className="scrapbook__count">
              {versions.length}{' '}
              {versions.length === 1
                ? t('notes.versions.one', 'version')
                : t('notes.versions.many', 'versions')}
            </span>
          </div>
          <VersionModeSelector mode={mode} onChange={onModeChange} />
          <button
            type="button"
            className="scrapbook__close"
            onClick={onClose}
            aria-label={t('common.close', 'Fermer')}
          >
            ×
          </button>
        </header>

        {/* Body */}
        <div className="scrapbook__body">
          {/* List */}
          <aside className="scrapbook__list" aria-label="Versions">
            {loadingList ? (
              <div className="scrapbook__empty">{t('common.loading', 'Chargement…')}</div>
            ) : versions.length === 0 ? (
              <div className="scrapbook__empty">
                {t(
                  'notes.noVersions',
                  'Aucune version enregistrée pour le moment. Continuez à éditer — les snapshots apparaîtront ici automatiquement.'
                )}
              </div>
            ) : (
              groups.map(([label, items]) => (
                <section key={label} className="scrapbook__group">
                  <h3 className="scrapbook__group-title">{label}</h3>
                  {items.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setSelectedId(v.id)}
                      className={`scrapbook__card ${
                        v.id === selectedId ? 'scrapbook__card--active' : ''
                      }`}
                    >
                      <div className="scrapbook__card-time">
                        {relativeTime(v.savedAt, Date.now(), i18n.language)}
                      </div>
                      <div className="scrapbook__card-meta">
                        <span className="scrapbook__card-words">
                          {v.wordCount} {t('notes.words', 'mots')}
                        </span>
                        {v.delta !== null && v.delta !== 0 && (
                          <span
                            className={`scrapbook__card-delta ${
                              v.delta > 0
                                ? 'scrapbook__card-delta--plus'
                                : 'scrapbook__card-delta--minus'
                            }`}
                          >
                            {v.delta > 0 ? `+${v.delta}` : v.delta}
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </section>
              ))
            )}
          </aside>

          {/* Preview */}
          <main className="scrapbook__preview">
            {!selectedContent && !loadingContent ? (
              <div className="scrapbook__preview-empty">
                <svg
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" />
                  <polyline points="12 7 12 12 15 14" />
                </svg>
                <p>
                  {t(
                    'notes.versions.selectHint',
                    'Sélectionnez une version à gauche pour la prévisualiser.'
                  )}
                </p>
              </div>
            ) : loadingContent ? (
              <div className="scrapbook__preview-empty">{t('common.loading', 'Chargement…')}</div>
            ) : selectedContent ? (
              <>
                <div className="scrapbook__preview-header">
                  <h1 className="scrapbook__preview-title">
                    {selectedContent.title || t('notes.untitled', 'Sans titre')}
                  </h1>
                  <div className="scrapbook__preview-meta">
                    <span>
                      {new Date(selectedContent.savedAt).toLocaleString(
                        i18n.language || undefined,
                        {
                          dateStyle: 'long',
                          timeStyle: 'short',
                        }
                      )}
                    </span>
                    <span>·</span>
                    <span>
                      {selectedContent.wordCount} {t('notes.words', 'mots')}
                    </span>
                  </div>

                  <div className="scrapbook__preview-toggle" role="tablist">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={previewMode === 'render'}
                      className={`scrapbook__preview-tab ${
                        previewMode === 'render' ? 'scrapbook__preview-tab--active' : ''
                      }`}
                      onClick={() => setPreviewMode('render')}
                    >
                      {t('notes.versions.renderTab', 'Rendu')}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={previewMode === 'diff'}
                      className={`scrapbook__preview-tab ${
                        previewMode === 'diff' ? 'scrapbook__preview-tab--active' : ''
                      }`}
                      onClick={() => setPreviewMode('diff')}
                    >
                      {t('notes.versions.diffTab', 'Différences')}
                    </button>
                  </div>
                </div>

                <div className="scrapbook__preview-body">
                  {previewMode === 'render' ? (
                    <VersionRender
                      content={selectedContent.content}
                      plainTextFallback={selectedContent.plainText}
                      className="scrapbook__render"
                    />
                  ) : collapsedDiff && collapsedDiff.length > 0 ? (
                    <div className="scrapbook__diff">
                      {collapsedDiff.map((item, i) =>
                        item.kind === 'collapsed' ? (
                          <div key={`c-${i}`} className="scrapbook__diff-collapsed">
                            <span className="scrapbook__diff-collapsed-rule" />
                            <span className="scrapbook__diff-collapsed-label">
                              {t('notes.versions.collapsedLines', {
                                count: item.count,
                                defaultValue: '… {{count}} lignes inchangées',
                              })}
                            </span>
                            <span className="scrapbook__diff-collapsed-rule" />
                          </div>
                        ) : (
                          <div
                            key={`l-${i}`}
                            className={`scrapbook__diff-line scrapbook__diff-line--${item.line.type}`}
                          >
                            <span className="scrapbook__diff-num">{item.line.lineNumber}</span>
                            <span className="scrapbook__diff-text">
                              {item.line.text || '\u00A0'}
                            </span>
                          </div>
                        )
                      )}
                    </div>
                  ) : (
                    <div className="scrapbook__preview-empty">
                      {t('notes.noChanges', 'Aucune différence à afficher')}
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </main>
        </div>

        {/* Footer */}
        <footer className="scrapbook__footer">
          <button
            type="button"
            className="scrapbook__btn scrapbook__btn--danger"
            onClick={handleDelete}
            disabled={!selectedId || busy}
          >
            {t('notes.deleteVersion', 'Supprimer cette version')}
          </button>
          <button
            type="button"
            className="scrapbook__btn scrapbook__btn--primary"
            onClick={handleRestore}
            disabled={!selectedContent || busy}
          >
            {t('notes.restoreVersion', 'Restaurer cette version')}
          </button>
        </footer>
      </div>
    </div>
  );

  return ReactDOM.createPortal(content, document.body);
};

export default VersionScrapbook;
