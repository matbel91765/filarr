/**
 * VaultFileThreadPanel — le fil de discussion d'un FICHIER de coffre.
 *
 * Monté sous l'aperçu (BufferPreview). Le fil vit dans un sidecar chiffré
 * (voir fileThread.ts) chargé PARESSEUSEMENT ici — jamais au rendu de la
 * liste — et son clair reste dans l'état LOCAL de ce composant : rien
 * n'entre dans Redux.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { Button, Input } from '../ui';
import type { AppDispatch, RootState } from '../../../store';
import { downloadVaultItemContent, type VaultItemSummary } from '../../../store/slices/vaultsSlice';
import {
  findThreadItem,
  parseFileThread,
  saveFileThread,
} from '../../../services/vault/fileThread';
import { visibleComments, type VaultComment } from '../../../services/vault/vaultComments';
import { vaultMemberLabel } from './vaultNoteCollab';

interface Props {
  vaultId: string;
  file: VaultItemSummary;
  /** La liste d'éléments du coffre (pour trouver le sidecar). */
  items: VaultItemSummary[];
  canEdit: boolean;
  /** Recharger la liste du parent après une écriture (version du sidecar). */
  onWrote?: () => void;
}

export const VaultFileThreadPanel: React.FC<Props> = ({
  vaultId,
  file,
  items,
  canEdit,
  onWrote,
}) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const cloudUser = useSelector((s: RootState) => s.auth?.cloudUser ?? null);
  const profileName = useSelector((s: RootState) => s.auth?.localProfile?.name ?? null);

  const [comments, setComments] = useState<Record<string, VaultComment>>({});
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const mountedRef = useRef(true);
  /** Le sidecar tel que CHARGÉ — la base des écritures (version fraîche). */
  const threadItemRef = useRef<VaultItemSummary | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let vivant = true;
    setLoadState('loading');
    setComments({});
    const existing = findThreadItem(items, file.id);
    threadItemRef.current = existing;
    if (!existing) {
      setLoadState('ready');
      return undefined;
    }
    downloadVaultItemContent(vaultId, existing)
      .then((bytes) => {
        if (!vivant) return;
        setComments(parseFileThread(bytes));
        setLoadState('ready');
      })
      .catch(() => {
        if (vivant) setLoadState('error');
      });
    return () => {
      vivant = false;
    };
    // Rechargé quand le sidecar change d'identité/version dans la liste.
    // eslint désactivé inutile : items est une dépendance légitime.
  }, [vaultId, file.id, items]);

  const memberLabel = vaultMemberLabel({
    email: cloudUser?.email,
    profileName,
    userId: cloudUser?.id,
  });

  const post = useCallback(
    async (parentId: string | null, text: string) => {
      const body = text.trim();
      if (!body || busy) return;
      setBusy(true);
      const comment: VaultComment = {
        id: crypto.randomUUID(),
        parentId,
        text: body,
        authorName: memberLabel,
        authorId: cloudUser?.id ?? null,
        createdAt: new Date().toISOString(),
        resolved: false,
      };
      const next = { ...comments, [comment.id]: comment };
      try {
        const saved = await saveFileThread(dispatch, {
          vaultId,
          file,
          existing: threadItemRef.current,
          comments: next,
          downloadContent: (item) => downloadVaultItemContent(vaultId, item),
        });
        if (!mountedRef.current) return;
        threadItemRef.current = saved;
        // Relire depuis ce qu'on vient d'écrire (la fusion a pu élargir).
        setComments(next);
        setDraft('');
        onWrote?.();
      } catch {
        if (mountedRef.current) setLoadState('error');
      } finally {
        if (mountedRef.current) setBusy(false);
      }
    },
    [busy, comments, dispatch, vaultId, file, memberLabel, cloudUser?.id, onWrote]
  );

  const remove = useCallback(
    async (id: string) => {
      const current = comments[id];
      if (!current || busy) return;
      setBusy(true);
      const next = { ...comments, [id]: { ...current, deleted: true as const } };
      try {
        const saved = await saveFileThread(dispatch, {
          vaultId,
          file,
          existing: threadItemRef.current,
          comments: next,
          downloadContent: (item) => downloadVaultItemContent(vaultId, item),
        });
        if (!mountedRef.current) return;
        threadItemRef.current = saved;
        setComments(next);
        onWrote?.();
      } catch {
        if (mountedRef.current) setLoadState('error');
      } finally {
        if (mountedRef.current) setBusy(false);
      }
    },
    [busy, comments, dispatch, vaultId, file, onWrote]
  );

  const view = visibleComments(comments);

  return (
    <div className="mt-3 border-t border-[var(--color-border-light)] pt-3">
      <p className="text-xs font-semibold text-[var(--color-text-secondary)] m-0 mb-2">
        {t('teamVaults.comments.thread.title')}
      </p>
      {loadState === 'loading' && (
        <p className="text-xs text-[var(--color-text-tertiary)] m-0">{t('common.loading')}</p>
      )}
      {loadState === 'error' && (
        <p role="alert" className="text-xs text-[var(--color-error-600,#dc2626)] m-0">
          {t('teamVaults.comments.thread.loadError')}
        </p>
      )}
      {loadState === 'ready' && (
        <>
          {view.roots.length === 0 && (
            <p className="text-xs text-[var(--color-text-tertiary)] m-0 mb-2">
              {t('teamVaults.comments.thread.empty')}
            </p>
          )}
          <ul className="list-none m-0 p-0 flex flex-col gap-1.5 max-h-[25vh] overflow-y-auto">
            {view.roots.map((c) => (
              <li
                key={c.id}
                className="rounded-md px-2.5 py-1.5 bg-[var(--color-surface-secondary)] border border-[var(--color-border-light)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-[var(--color-text-secondary)] truncate">
                    {c.authorName || t('teamVaults.comments.someone')}
                  </span>
                  <span className="text-[10px] text-[var(--color-text-tertiary)] shrink-0">
                    {new Date(c.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-[var(--color-text-primary)] m-0 mt-0.5 whitespace-pre-wrap break-words">
                  {c.text}
                </p>
                {canEdit && (
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void remove(c.id)}
                    >
                      {t('teamVaults.comments.delete')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <div className="flex gap-1.5 mt-2">
              <Input
                value={draft}
                placeholder={t('teamVaults.comments.addPlaceholder')}
                aria-label={t('teamVaults.comments.add')}
                fullWidth
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void post(null, draft);
                }}
              />
              <Button
                size="sm"
                variant="secondary"
                loading={busy}
                disabled={!draft.trim()}
                onClick={() => void post(null, draft)}
              >
                {t('teamVaults.comments.add')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default VaultFileThreadPanel;
