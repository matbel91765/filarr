/**
 * CommentsPanel — Filarr Notes
 *
 * Side panel for viewing and adding inline comments on note content.
 * Comments are stored as marks on text ranges, with comment data in local state.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './CommentsPanel.css';

// Le modèle vit désormais dans src/types/notes.ts — ré-exporté ici pour ne pas
// casser les imports existants (NoteEditor, NotesView).
export type { NoteComment } from '../../../types/notes';
import type { NoteComment } from '../../../types/notes';

interface CommentsPanelProps {
  comments: Record<string, NoteComment>;
  onAddComment: (commentId: string, text: string) => void;
  onResolveComment: (commentId: string) => void;
  onDeleteComment: (commentId: string) => void;
  activeCommentId?: string | null;
  onSelectComment?: (commentId: string) => void;
}

export const CommentsPanel: React.FC<CommentsPanelProps> = React.memo(function CommentsPanel({
  comments,
  onAddComment,
  onResolveComment,
  onDeleteComment,
  activeCommentId,
  onSelectComment,
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const [showResolved, setShowResolved] = useState(false);

  const commentList = useMemo(() => {
    const list = Object.values(comments);
    if (!showResolved) return list.filter((c) => !c.resolved);
    return list;
  }, [comments, showResolved]);

  const openCount = useMemo(
    () => Object.values(comments).filter((c) => !c.resolved).length,
    [comments]
  );

  if (Object.keys(comments).length === 0) return null;

  return (
    <div className="comments-panel">
      <button className="comments-panel__header" onClick={() => setExpanded(!expanded)}>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="currentColor"
          style={{
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s',
          }}
        >
          <path d="M8 5l8 7-8 7z" />
        </svg>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
        <span>{t('notes.comments', 'Comments')}</span>
        {openCount > 0 && <span className="comments-panel__count">{openCount}</span>}
      </button>

      {expanded && (
        <div className="comments-panel__body">
          <button
            className="comments-panel__toggle-resolved"
            onClick={() => setShowResolved(!showResolved)}
          >
            {showResolved
              ? t('notes.hideResolved', 'Hide resolved')
              : t('notes.showResolved', 'Show resolved')}
          </button>
          {commentList.length === 0 ? (
            <div className="comments-panel__empty">{t('notes.noComments', 'No comments')}</div>
          ) : (
            <div className="comments-panel__list">
              {commentList.map((comment) => (
                <div
                  key={comment.id}
                  className={`comments-panel__item ${activeCommentId === comment.id ? 'is-active' : ''} ${comment.resolved ? 'is-resolved' : ''}`}
                  onClick={() => onSelectComment?.(comment.id)}
                >
                  <div className="comments-panel__item-header">
                    <span className="comments-panel__item-author">{comment.author}</span>
                    <span className="comments-panel__item-date">
                      {new Date(comment.createdAt).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </span>
                  </div>
                  <p className="comments-panel__item-text">{comment.text}</p>
                  <div className="comments-panel__item-actions">
                    {!comment.resolved && (
                      <button
                        className="comments-panel__item-action"
                        onClick={(e) => {
                          e.stopPropagation();
                          onResolveComment(comment.id);
                        }}
                        title={t('notes.resolveComment', 'Resolve')}
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <polyline points="20,6 9,17 4,12" />
                        </svg>
                      </button>
                    )}
                    <button
                      className="comments-panel__item-action comments-panel__item-action--delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteComment(comment.id);
                      }}
                      title={t('notes.deleteComment', 'Delete')}
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
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
