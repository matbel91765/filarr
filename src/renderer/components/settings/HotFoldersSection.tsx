/**
 * Hot Folders Settings Section
 *
 * Lists the user's hot folder rules, exposes create/edit/remove + scan-now +
 * pause/resume actions. Plan gating: Free 1 rule / Solo 3 / Pro unlimited.
 */

import { FC, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import type { AppDispatch, RootState } from '../../../store';
import { setCurrentFolder } from '../../../store/slices/foldersSlice';
import { buildFolderPath } from '../../../services/features/hotFoldersBridge';
import { useEffectiveTier } from '../../../hooks/useEffectiveTier';
import HotFolderRuleModal, { type HotFolderRule, type HotFolderStatus } from './HotFolderRuleModal';

const HotFoldersSection: FC = () => {
  const { t } = useTranslation();
  // Le palier EFFECTIF (siège d'organisation compris) : un siège Teams avait
  // droit à UNE règle, comme un gratuit.
  const tier = useEffectiveTier();

  const maxRules =
    tier === 'pro' || tier === 'teams' || tier === 'enterprise'
      ? Infinity
      : tier === 'solo'
        ? 3
        : 1;

  const [rules, setRules] = useState<HotFolderRule[]>([]);
  const [statuses, setStatuses] = useState<Record<string, HotFolderStatus>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<HotFolderRule | null>(null);

  const ipc = window.electron?.ipcRenderer;

  const refresh = useCallback(async () => {
    if (!ipc) return;
    try {
      const [r, s] = await Promise.all([
        ipc.invoke('hot-folders:list'),
        ipc.invoke('hot-folders:get-statuses'),
      ]);
      setRules(Array.isArray(r) ? r : []);
      const map: Record<string, HotFolderStatus> = {};
      if (Array.isArray(s)) for (const st of s as HotFolderStatus[]) map[st.ruleId] = st;
      setStatuses(map);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [ipc]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!ipc) return;
    const handler = (next: HotFolderStatus) => {
      setStatuses((prev) => ({ ...prev, [next.ruleId]: next }));
    };
    ipc.on('hot-folders:status-changed', handler);
    return () => {
      ipc.removeListener('hot-folders:status-changed', handler);
    };
  }, [ipc]);

  const persistRules = useCallback(
    async (next: HotFolderRule[]) => {
      if (!ipc) return;
      setError(null);
      try {
        const applied = (await ipc.invoke('hot-folders:set-rules', next)) as HotFolderRule[];
        setRules(applied);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [ipc]
  );

  const openCreate = () => {
    if (rules.length >= maxRules) return;
    setEditingRule(null);
    setModalOpen(true);
  };

  const openEdit = (rule: HotFolderRule) => {
    setEditingRule(rule);
    setModalOpen(true);
  };

  const handleSave = async (rule: HotFolderRule) => {
    const others = rules.filter((r) => r.id !== rule.id);
    await persistRules([...others, rule]);
    setModalOpen(false);
    setEditingRule(null);
  };

  const handleDelete = async (ruleId: string) => {
    if (!confirm(t('settings.hotFolders.confirmDelete', 'Supprimer cette règle ?') as string))
      return;
    await persistRules(rules.filter((r) => r.id !== ruleId));
  };

  const handleScanNow = async (ruleId: string) => {
    if (!ipc) return;
    try {
      await ipc.invoke('hot-folders:scan-now', ruleId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handlePauseResume = async (rule: HotFolderRule) => {
    if (!ipc) return;
    try {
      if (rule.enabled) {
        await ipc.invoke('hot-folders:pause-rule', rule.id);
      } else {
        await ipc.invoke('hot-folders:resume-rule', rule.id);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleClearSafety = async (ruleId: string) => {
    if (!ipc) return;
    try {
      await ipc.invoke('hot-folders:clear-safety-pause', ruleId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading) {
    return (
      <div className="px-6 py-4 text-sm text-[var(--color-text-tertiary)]">
        {t('common.loading', 'Chargement…')}
      </div>
    );
  }

  return (
    <div className="divide-y divide-[var(--color-border-light)]">
      {error && <div className="px-6 py-3 text-xs text-red-600 bg-red-50">{error}</div>}

      <div className="px-6 py-4">
        {rules.length === 0 ? (
          <p className="text-sm italic text-[var(--color-text-tertiary)] py-2">
            {t('settings.hotFolders.empty', 'Aucun hot folder configuré pour le moment.')}
          </p>
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => (
              <HotFolderRow
                key={rule.id}
                rule={rule}
                status={statuses[rule.id]}
                onEdit={() => openEdit(rule)}
                onDelete={() => handleDelete(rule.id)}
                onScanNow={() => handleScanNow(rule.id)}
                onPauseResume={() => handlePauseResume(rule)}
                onClearSafety={() => handleClearSafety(rule.id)}
              />
            ))}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={openCreate}
            disabled={rules.length >= maxRules}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>＋</span>
            <span>{t('settings.hotFolders.addRule', 'Ajouter un hot folder')}</span>
          </button>
          <PlanQuotaHint tier={tier} used={rules.length} max={maxRules} />
        </div>
      </div>

      <div className="px-6 py-3 text-xs text-[var(--color-text-tertiary)] bg-[var(--color-background-secondary)]">
        ⓘ{' '}
        {t(
          'settings.hotFolders.hint',
          "Astuce : combinez avec des règles d'automatisation pour trier les fichiers par extension dans des sous-dossiers."
        )}
      </div>

      {modalOpen && (
        <HotFolderRuleModal
          isOpen={modalOpen}
          rule={editingRule}
          onClose={() => {
            setModalOpen(false);
            setEditingRule(null);
          }}
          onSave={handleSave}
          tier={tier}
        />
      )}
    </div>
  );
};

const HotFolderRow: FC<{
  rule: HotFolderRule;
  status: HotFolderStatus | undefined;
  onEdit: () => void;
  onDelete: () => void;
  onScanNow: () => void;
  onPauseResume: () => void;
  onClearSafety: () => void;
}> = ({ rule, status, onEdit, onDelete, onScanNow, onPauseResume, onClearSafety }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const foldersById = useSelector((s: RootState) => s.folders.byId);
  // Chemin complet (« Docs / Scans / 2026 ») et non plus le seul nom de
  // feuille : deux dossiers homonymes étaient indiscernables, et un dossier
  // supprimé s'affichait comme un « ? » muet.
  const targetPath = buildFolderPath(foldersById, rule.targetFolderId);
  const openTarget = () => {
    dispatch(setCurrentFolder(rule.targetFolderId));
    navigate(`/folder/${rule.targetFolderId}`);
  };
  const live = status ?? {
    state: rule.enabled ? 'starting' : 'disabled',
    importedCount: 0,
    deletedCount: 0,
    lastEventAt: null,
    lastEventName: null,
    lastError: null,
  };

  const stateBadge = (() => {
    const dot = (color: string) => (
      <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
    );
    switch (live.state) {
      case 'active':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700">
            {dot('bg-emerald-500')}
            {t('settings.hotFolders.statusActive', 'Active')}
          </span>
        );
      case 'starting':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full bg-blue-50 text-blue-700">
            {dot('bg-blue-500')}
            {t('settings.hotFolders.statusStarting', 'Démarrage…')}
          </span>
        );
      case 'paused-safety':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-50 text-amber-700">
            {dot('bg-amber-500')}
            {t('settings.hotFolders.statusPausedSafety', 'En pause (sécurité)')}
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full bg-red-50 text-red-700">
            {dot('bg-red-500')}
            {t('settings.hotFolders.statusError', 'Erreur')}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full bg-[var(--color-background-secondary)] text-[var(--color-text-tertiary)]">
            {dot('bg-gray-400')}
            {t('settings.hotFolders.statusDisabled', 'Inactive')}
          </span>
        );
    }
  })();

  return (
    <div className="px-3 py-3 rounded-lg border border-[var(--color-border-light)] bg-[var(--color-background-secondary)]/40">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
              {rule.name}
            </span>
            {stateBadge}
          </div>
          <div className="mt-1 flex items-center gap-1.5 flex-wrap text-xs text-[var(--color-text-tertiary)]">
            <span className="font-mono truncate max-w-[18rem]" title={rule.sourcePath}>
              {rule.sourcePath}
              {rule.recursive ? ' ⥀' : ''}
            </span>
            <span aria-hidden="true">→</span>
            {targetPath ? (
              <button
                type="button"
                onClick={openTarget}
                title={
                  t('settings.hotFolders.openTarget', 'Ouvrir « {{path}} »', {
                    path: targetPath,
                  }) as string
                }
                className="max-w-[18rem] truncate px-1.5 py-0.5 rounded text-[var(--color-primary-600)] hover:bg-[var(--color-surface-hover)] hover:underline"
              >
                {targetPath}
              </button>
            ) : (
              <>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium">
                  ⚠{' '}
                  {t(
                    'settings.hotFolders.targetNotFound',
                    'Dossier cible introuvable (supprimé ?)'
                  )}
                </span>
                <button
                  type="button"
                  onClick={onEdit}
                  className="px-2 py-0.5 rounded font-medium text-amber-700 underline hover:bg-amber-50"
                >
                  {t('settings.hotFolders.fixRule', 'Corriger la règle')}
                </button>
              </>
            )}
          </div>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
            {t('settings.hotFolders.importedCount', '{{count}} importé(s)', {
              count: live.importedCount,
            })}
            {live.deletedCount > 0
              ? ` · ${t('settings.hotFolders.deletedCount', '{{count}} supprimé(s)', { count: live.deletedCount })}`
              : ''}
            {live.lastEventName ? ` · ${live.lastEventName}` : ''}
          </p>
          {live.lastError && live.state === 'error' && (
            <p className="text-xs text-red-600 mt-1">⚠ {live.lastError}</p>
          )}
          {live.lastError && live.state === 'paused-safety' && (
            <div className="mt-2 flex items-center justify-between gap-3 px-2.5 py-1.5 rounded border border-amber-200 bg-amber-50">
              <p className="text-xs text-amber-800 leading-snug">⚠ {live.lastError}</p>
              <button
                type="button"
                onClick={onClearSafety}
                className="shrink-0 px-2.5 py-1 text-xs font-medium rounded bg-amber-600 text-white hover:bg-amber-700"
              >
                {t('settings.hotFolders.clearSafety', 'Reprendre quand même')}
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onScanNow}
            disabled={live.state !== 'active'}
            title={t('settings.hotFolders.scanNow', 'Scanner maintenant') as string}
            className="px-2 py-1 text-xs rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] disabled:opacity-40"
          >
            ↻
          </button>
          <button
            type="button"
            onClick={onPauseResume}
            title={
              rule.enabled
                ? (t('settings.hotFolders.pauseRule', 'Mettre en pause') as string)
                : (t('settings.hotFolders.resumeRule', 'Reprendre') as string)
            }
            className="px-2 py-1 text-xs rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
          >
            {rule.enabled ? '⏸' : '▶'}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="px-2 py-1 text-xs rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
          >
            {t('settings.hotFolders.editRule', 'Éditer')}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="px-2 py-1 text-xs rounded hover:bg-red-50 hover:text-red-700 text-[var(--color-text-secondary)]"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
};

const PlanQuotaHint: FC<{ tier: string; used: number; max: number }> = ({ tier, used, max }) => {
  const { t } = useTranslation();
  if (max === Infinity) {
    return (
      <span className="text-xs text-[var(--color-text-tertiary)]">
        {t('settings.hotFolders.quotaUnlimited', 'Pro — illimité')}
      </span>
    );
  }
  const reached = used >= max;
  const tierLabel = tier === 'solo' ? 'Solo' : 'Free';
  return (
    <span className={`text-xs ${reached ? 'text-amber-600' : 'text-[var(--color-text-tertiary)]'}`}>
      {t('settings.hotFolders.quotaUsed', '{{used}}/{{max}} ({{tier}})', {
        used,
        max,
        tier: tierLabel,
      })}
      {reached && tier !== 'pro' && (
        <>
          {' — '}
          {t('settings.hotFolders.upgradeForMore', 'Upgrade pour plus')}
        </>
      )}
    </span>
  );
};

export default HotFoldersSection;
