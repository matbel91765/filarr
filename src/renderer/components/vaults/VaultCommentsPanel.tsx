/**
 * VaultCommentsPanel — les commentaires d'une note de COFFRE.
 *
 * Modelé sur le panneau des notes personnelles (Temps 1) mais avec le modèle
 * de coffre : fils par parentId (visibleComments), réponses, tombstones jamais
 * affichés. Les VIEWERS lisent sans écrire — l'écran ne promet pas ce que le
 * serveur refuse (leur updateVaultItem prendrait un 403).
 */

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '../ui';
import { visibleComments, type VaultComment } from '../../../services/vault/vaultComments';

interface Props {
  comments: Record<string, VaultComment>;
  canComment: boolean;
  onReply: (parentId: string, text: string) => void;
  onResolve: (id: string) => void;
  onDelete: (id: string) => void;
  activeCommentId?: string | null;
  onSelectComment?: (id: string) => void;
}

const CommentRow: React.FC<{
  comment: VaultComment;
  active: boolean;
  canComment: boolean;
  onResolve: (id: string) => void;
  onDelete: (id: string) => void;
  onSelect?: (id: string) => void;
  isReply?: boolean;
}> = ({ comment, active, canComment, onResolve, onDelete, onSelect, isReply }) => {
  const { t } = useTranslation();
  return (
    <div
      className={`rounded-md px-2.5 py-2 ${isReply ? 'ml-5' : ''} ${
        active
          ? 'bg-[var(--color-primary-50)] border border-[var(--color-primary-200,#bfdbfe)]'
          : 'bg-[var(--color-surface-secondary)] border border-[var(--color-border-light)]'
      } ${comment.resolved ? 'opacity-60' : ''}`}
      onClick={() => onSelect?.(comment.id)}
      role={onSelect ? 'button' : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-[var(--color-text-secondary)] truncate">
          {comment.authorName || t('teamVaults.comments.someone')}
        </span>
        <span className="text-[10px] text-[var(--color-text-tertiary)] shrink-0">
          {new Date(comment.createdAt).toLocaleString()}
        </span>
      </div>
      <p className="text-sm text-[var(--color-text-primary)] m-0 mt-1 whitespace-pre-wrap break-words">
        {comment.text}
      </p>
      {canComment && (
        <div className="flex gap-1 mt-1.5">
          {!comment.resolved && !isReply && (
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onResolve(comment.id);
              }}
            >
              {t('teamVaults.comments.resolve')}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(comment.id);
            }}
          >
            {t('teamVaults.comments.delete')}
          </Button>
        </div>
      )}
    </div>
  );
};

export const VaultCommentsPanel: React.FC<Props> = ({
  comments,
  canComment,
  onReply,
  onResolve,
  onDelete,
  activeCommentId,
  onSelectComment,
}) => {
  const { t } = useTranslation();
  const [showResolved, setShowResolved] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});

  const view = useMemo(() => visibleComments(comments), [comments]);
  const openCount = useMemo(() => view.roots.filter((c) => !c.resolved).length, [view.roots]);

  if (view.roots.length === 0) return null;

  const submitReply = (parentId: string) => {
    const text = (replyDrafts[parentId] ?? '').trim();
    if (!text) return;
    onReply(parentId, text);
    setReplyDrafts((d) => ({ ...d, [parentId]: '' }));
  };

  return (
    <div className="border border-[var(--color-border-light)] rounded-md p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-[var(--color-text-secondary)] m-0">
          {t('teamVaults.comments.panelTitle')}
          {openCount > 0 && (
            <span className="ml-1.5 text-[10px] font-normal text-[var(--color-text-tertiary)]">
              {t('teamVaults.comments.count', { count: openCount })}
            </span>
          )}
        </p>
        <Button size="sm" variant="ghost" onClick={() => setShowResolved((v) => !v)}>
          {showResolved
            ? t('teamVaults.comments.hideResolved')
            : t('teamVaults.comments.showResolved')}
        </Button>
      </div>
      {!canComment && (
        <p className="text-[11px] text-[var(--color-text-tertiary)] m-0">
          {t('teamVaults.comments.readOnlyNotice')}
        </p>
      )}
      <div className="flex flex-col gap-2 max-h-[30vh] overflow-y-auto">
        {view.roots
          .filter((c) => showResolved || !c.resolved)
          .map((root) => (
            <div key={root.id} className="flex flex-col gap-1.5">
              <CommentRow
                comment={root}
                active={activeCommentId === root.id}
                canComment={canComment}
                onResolve={onResolve}
                onDelete={onDelete}
                onSelect={onSelectComment}
              />
              {(view.repliesByParent.get(root.id) ?? []).map((reply) => (
                <CommentRow
                  key={reply.id}
                  comment={reply}
                  active={activeCommentId === reply.id}
                  canComment={canComment}
                  onResolve={onResolve}
                  onDelete={onDelete}
                  isReply
                />
              ))}
              {canComment && !root.resolved && (
                <div className="ml-5 flex gap-1.5">
                  <Input
                    value={replyDrafts[root.id] ?? ''}
                    placeholder={t('teamVaults.comments.replyPlaceholder')}
                    aria-label={t('teamVaults.comments.reply')}
                    fullWidth
                    onChange={(e) => setReplyDrafts((d) => ({ ...d, [root.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitReply(root.id);
                    }}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!(replyDrafts[root.id] ?? '').trim()}
                    onClick={() => submitReply(root.id)}
                  >
                    {t('teamVaults.comments.reply')}
                  </Button>
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  );
};

export default VaultCommentsPanel;
