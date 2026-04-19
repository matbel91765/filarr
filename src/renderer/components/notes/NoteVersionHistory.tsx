/**
 * NoteVersionHistory — Filarr Notes
 *
 * Sidebar listing encrypted on-disk snapshots of the currently-edited
 * note, newest first. From here the user can preview the diff against
 * the current version or restore a past version.
 *
 * Data lives in the main process; this component only issues IPC calls
 * via `noteVersionService`.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../../../store';
import { updateNote, updateNoteContent } from '../../../store/slices/notesSlice';
import {
  deleteVersion,
  diffVersions,
  getVersion,
  listVersions,
  type NoteVersionContent,
  type NoteVersionMeta,
  type VersionDiffLine,
} from '../../../services/notes/noteVersionService';
import VersionModeSelector from './versioning/VersionModeSelector';
import type { VersionHistoryMode } from './versioning/useVersionHistoryMode';
import './NoteVersionHistory.css';

// ==================== Icons ====================

const ClockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12,6 12,12 16,14" />
  </svg>
);

const RestoreIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

const DiffIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M12 3v18" />
    <path d="M18 6H6" />
    <path d="M18 18H6" />
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

// ==================== Component ====================

interface NoteVersionHistoryProps {
  noteId: string;
  currentContent: string;
  currentPlainText: string;
  onClose: () => void;
  /** Optional — when provided, renders the mode switcher in the header. */
  mode?: VersionHistoryMode;
  onModeChange?: (m: VersionHistoryMode) => void;
}

type ViewState =
  | { kind: 'list' }
  | { kind: 'diff'; version: NoteVersionContent; lines: VersionDiffLine[] };

export const NoteVersionHistory: React.FC<NoteVersionHistoryProps> = React.memo(
  function NoteVersionHistory({ noteId, currentPlainText, onClose, mode, onModeChange }) {
    const { t } = useTranslation();
    const dispatch = useDispatch<AppDispatch>();

    const [versions, setVersions] = useState<NoteVersionMeta[]>([]);
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState<ViewState>({ kind: 'list' });
    const [busyVersionId, setBusyVersionId] = useState<string | null>(null);

    const reloadList = useCallback(async () => {
      setLoading(true);
      try {
        const list = await listVersions(noteId);
        setVersions(list);
      } finally {
        setLoading(false);
      }
    }, [noteId]);

    useEffect(() => {
      // Drop stale state when the caller switches to a different note.
      setView({ kind: 'list' });
      setBusyVersionId(null);
      reloadList();
    }, [noteId, reloadList]);

    const handleRestore = useCallback(
      async (versionId: string) => {
        setBusyVersionId(versionId);
        try {
          const full = await getVersion(noteId, versionId);
          if (!full) return;

          dispatch(updateNote({ id: noteId, changes: { title: full.title } }));
          dispatch(
            updateNoteContent({
              id: noteId,
              content: full.content,
              plainText: full.plainText,
            })
          );
          onClose();
        } finally {
          setBusyVersionId(null);
        }
      },
      [noteId, dispatch, onClose]
    );

    const handleShowDiff = useCallback(
      async (meta: NoteVersionMeta) => {
        setBusyVersionId(meta.id);
        try {
          const full = await getVersion(noteId, meta.id);
          if (!full) return;
          const lines = diffVersions(full.plainText, currentPlainText);
          setView({ kind: 'diff', version: full, lines });
        } finally {
          setBusyVersionId(null);
        }
      },
      [noteId, currentPlainText]
    );

    const handleDelete = useCallback(
      async (versionId: string) => {
        const confirmed = window.confirm(
          t(
            'notes.deleteVersionConfirm',
            'Supprimer définitivement cette version ? Cette action est irréversible.'
          )
        );
        if (!confirmed) return;

        setBusyVersionId(versionId);
        try {
          const ok = await deleteVersion(noteId, versionId);
          if (ok) await reloadList();
        } finally {
          setBusyVersionId(null);
        }
      },
      [noteId, reloadList, t]
    );

    const formatDate = (iso: string): string => {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    return (
      <div className="version-history">
        <div className="version-history__header">
          <ClockIcon />
          <span className="version-history__title">{t('notes.versionHistory', 'Historique')}</span>
          <span className="version-history__count">{versions.length}</span>
          <button
            className="version-history__close"
            onClick={onClose}
            aria-label={t('common.close', 'Fermer')}
          >
            &times;
          </button>
        </div>

        {mode && onModeChange && (
          <div className="version-history__mode-row">
            <VersionModeSelector mode={mode} onChange={onModeChange} />
          </div>
        )}

        {view.kind === 'diff' ? (
          <div className="version-history__diff">
            <div className="version-history__diff-header">
              <button className="version-history__back" onClick={() => setView({ kind: 'list' })}>
                &larr; {t('common.back', 'Retour')}
              </button>
              <span className="version-history__diff-date">{formatDate(view.version.savedAt)}</span>
            </div>
            <div className="version-history__diff-body">
              {view.lines.length === 0 ? (
                <div className="version-history__empty">
                  {t('notes.noChanges', 'Aucune différence à afficher')}
                </div>
              ) : (
                view.lines.map((line, i) => (
                  <div
                    key={i}
                    className={`version-history__diff-line version-history__diff-line--${line.type}`}
                  >
                    <span className="version-history__diff-num">{line.lineNumber}</span>
                    <span className="version-history__diff-text">{line.text || '\u00A0'}</span>
                  </div>
                ))
              )}
            </div>
            <div className="version-history__diff-footer">
              <button
                className="version-history__action-btn version-history__action-btn--restore"
                onClick={() => handleRestore(view.version.id)}
                disabled={busyVersionId === view.version.id}
              >
                <RestoreIcon />
                <span>{t('notes.restoreVersion', 'Restaurer cette version')}</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="version-history__list">
            {loading ? (
              <div className="version-history__empty">{t('common.loading', 'Chargement…')}</div>
            ) : versions.length === 0 ? (
              <div className="version-history__empty">
                {t(
                  'notes.noVersions',
                  'Aucune version enregistrée pour le moment. Continuez à éditer — les snapshots apparaîtront ici automatiquement.'
                )}
              </div>
            ) : (
              versions.map((v) => (
                <div key={v.id} className="version-history__item">
                  <div className="version-history__item-info">
                    <span className="version-history__item-title" title={v.title}>
                      {v.title || t('notes.untitled', 'Sans titre')}
                    </span>
                    <span className="version-history__item-date">{formatDate(v.savedAt)}</span>
                    <span className="version-history__item-meta">
                      {v.wordCount} {t('notes.words', 'mots')}
                    </span>
                  </div>
                  <div className="version-history__item-actions">
                    <button
                      className="version-history__action-btn"
                      onClick={() => handleShowDiff(v)}
                      disabled={busyVersionId === v.id}
                      title={t('notes.showDiff', 'Voir les différences')}
                    >
                      <DiffIcon />
                    </button>
                    <button
                      className="version-history__action-btn version-history__action-btn--restore"
                      onClick={() => handleRestore(v.id)}
                      disabled={busyVersionId === v.id}
                      title={t('notes.restoreVersion', 'Restaurer cette version')}
                    >
                      <RestoreIcon />
                    </button>
                    <button
                      className="version-history__action-btn version-history__action-btn--danger"
                      onClick={() => handleDelete(v.id)}
                      disabled={busyVersionId === v.id}
                      title={t('notes.deleteVersion', 'Supprimer cette version')}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    );
  }
);

export default NoteVersionHistory;
