/**
 * Downloads Watcher Settings Section
 *
 * UI for configuring the OS-level downloads folder watcher. Persists settings
 * to appConfig.json via IPC and (re)starts the main-process watcher whenever
 * the user changes anything.
 */

import { FC, useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import type { RootState } from '../../../store';
import type { Folder } from '../../../types';

interface DownloadsWatcherConfig {
  enabled: boolean;
  sourceFolders: string[];
  inboxFolderId: string;
  deleteOriginal: boolean;
  extensionAllowList: string[];
}

type DownloadsWatcherState = 'disabled' | 'starting' | 'active' | 'error';

interface DownloadsWatcherStatus {
  state: DownloadsWatcherState;
  watchedPaths: string[];
  invalidPaths: string[];
  lastImportName: string | null;
  lastImportAt: string | null;
  lastError: string | null;
  importedCount: number;
}

const DEFAULT_CONFIG: DownloadsWatcherConfig = {
  enabled: false,
  sourceFolders: [],
  inboxFolderId: '',
  deleteOriginal: false,
  extensionAllowList: [],
};

const DEFAULT_STATUS: DownloadsWatcherStatus = {
  state: 'disabled',
  watchedPaths: [],
  invalidPaths: [],
  lastImportName: null,
  lastImportAt: null,
  lastError: null,
  importedCount: 0,
};

const ToggleSwitch: FC<{ checked: boolean; onChange: () => void; disabled?: boolean }> = ({
  checked,
  onChange,
  disabled,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => !disabled && onChange()}
    className={`
      relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent
      transition-colors duration-200 ease-in-out
      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-400)] focus-visible:ring-offset-2
      ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      ${checked ? 'bg-[var(--color-primary-500)]' : 'bg-[var(--color-neutral-300)]'}
    `}
  >
    <span
      className={`
        pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm
        ring-0 transition-transform duration-200 ease-in-out
        ${checked ? 'translate-x-5' : 'translate-x-0'}
      `}
    />
  </button>
);

const DownloadsWatcherSection: FC = () => {
  const { t } = useTranslation();
  const foldersById = useSelector((state: RootState) => state.folders.byId);
  const allFolders = useMemo<Folder[]>(
    () => Object.values(foldersById).sort((a, b) => a.name.localeCompare(b.name)),
    [foldersById]
  );

  const [config, setConfig] = useState<DownloadsWatcherConfig>(DEFAULT_CONFIG);
  const [status, setStatus] = useState<DownloadsWatcherStatus>(DEFAULT_STATUS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ipc = window.electron?.ipcRenderer;

  const load = useCallback(async () => {
    if (!ipc) return;
    try {
      const [fromMain, statusFromMain] = await Promise.all([
        ipc.invoke('downloads-watcher:get-config'),
        ipc.invoke('downloads-watcher:get-status'),
      ]);
      setConfig({ ...DEFAULT_CONFIG, ...fromMain });
      setStatus({ ...DEFAULT_STATUS, ...statusFromMain });
    } catch (err) {
      console.error('[DownloadsWatcherSection] load failed:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [ipc]);

  useEffect(() => {
    load();
  }, [load]);

  // Subscribe to live status changes pushed from the main process. The
  // listener is registered once per component mount and torn down on unmount.
  useEffect(() => {
    if (!ipc) return;
    const handler = (next: DownloadsWatcherStatus) => {
      setStatus({ ...DEFAULT_STATUS, ...next });
    };
    ipc.on('downloads-watcher:status-changed', handler);
    return () => {
      ipc.removeListener('downloads-watcher:status-changed', handler);
    };
  }, [ipc]);

  const inboxValid = config.inboxFolderId !== '' && !!foldersById[config.inboxFolderId];
  const hasSources = config.sourceFolders.length > 0;
  const canEnable = inboxValid && hasSources;
  const validationHint = !canEnable
    ? !inboxValid
      ? t(
          'settings.downloadsWatcher.validation.needInbox',
          "Choisissez d'abord une boîte de réception Filarr."
        )
      : t(
          'settings.downloadsWatcher.validation.needSource',
          "Ajoutez d'abord au moins un dossier à surveiller."
        )
    : null;

  const persist = useCallback(
    async (next: DownloadsWatcherConfig) => {
      if (!ipc) return;
      setSaving(true);
      setError(null);
      try {
        const applied = await ipc.invoke('downloads-watcher:set-config', next);
        setConfig({ ...DEFAULT_CONFIG, ...applied });
      } catch (err) {
        console.error('[DownloadsWatcherSection] save failed:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [ipc]
  );

  const handleToggleEnabled = () => {
    // Block enabling without a complete config; allow disabling unconditionally.
    if (!config.enabled && !canEnable) return;
    persist({ ...config, enabled: !config.enabled });
  };

  const handleAddFolder = async () => {
    if (!ipc) return;
    try {
      const result = await ipc.invoke('showOpenDialog', {
        properties: ['openDirectory'],
        title: t('settings.downloadsWatcher.pickSourceTitle', 'Choisir un dossier à surveiller'),
      });
      if (result?.canceled || !result?.filePaths?.length) return;
      const newPath = result.filePaths[0] as string;
      if (config.sourceFolders.includes(newPath)) return;
      persist({ ...config, sourceFolders: [...config.sourceFolders, newPath] });
    } catch (err) {
      console.error('[DownloadsWatcherSection] folder picker failed:', err);
    }
  };

  const handleRemoveFolder = (pathToRemove: string) => {
    persist({
      ...config,
      sourceFolders: config.sourceFolders.filter((p) => p !== pathToRemove),
    });
  };

  const handleInboxChange = (folderId: string) => {
    persist({ ...config, inboxFolderId: folderId });
  };

  const handleToggleDeleteOriginal = () => {
    persist({ ...config, deleteOriginal: !config.deleteOriginal });
  };

  const [extensionDraft, setExtensionDraft] = useState('');

  const handleAddExtension = () => {
    const cleaned = extensionDraft.trim().toLowerCase().replace(/^\./, '');
    if (!cleaned || !/^[a-z0-9]+$/.test(cleaned)) {
      setExtensionDraft('');
      return;
    }
    if (config.extensionAllowList.includes(cleaned)) {
      setExtensionDraft('');
      return;
    }
    persist({
      ...config,
      extensionAllowList: [...config.extensionAllowList, cleaned],
    });
    setExtensionDraft('');
  };

  const handleRemoveExtension = (ext: string) => {
    persist({
      ...config,
      extensionAllowList: config.extensionAllowList.filter((e) => e !== ext),
    });
  };

  const [scanInProgress, setScanInProgress] = useState(false);

  const handleScanNow = async () => {
    if (!ipc || scanInProgress) return;
    setScanInProgress(true);
    setError(null);
    try {
      const result = (await ipc.invoke('downloads-watcher:scan-now')) as {
        queued: number;
        skipped: number;
      };
      // The queued count reflects files surfaced to the renderer. Imports
      // happen async via the file-detected listener — the live status badge
      // will reflect them as they come in.
      if (result.queued === 0) {
        setError(
          t(
            'settings.downloadsWatcher.scanNoFiles',
            'Aucun fichier nouveau trouvé dans les dossiers surveillés.'
          )
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanInProgress(false);
    }
  };

  if (loading) {
    return (
      <div className="px-6 py-4 text-sm text-[var(--color-text-tertiary)]">
        {t('common.loading', 'Chargement…')}
      </div>
    );
  }

  const statusBadge = (() => {
    const dot = (color: string) => (
      <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
    );
    switch (status.state) {
      case 'active':
        return (
          <span className="inline-flex items-center gap-2 px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700">
            {dot('bg-emerald-500')}
            {t('settings.downloadsWatcher.statusActive', 'Active')}
            {' · '}
            {t('settings.downloadsWatcher.watchedCount', '{{count}} dossier(s)', {
              count: status.watchedPaths.length,
            })}
          </span>
        );
      case 'starting':
        return (
          <span className="inline-flex items-center gap-2 px-2.5 py-1 text-xs font-medium rounded-full bg-blue-50 text-blue-700">
            {dot('bg-blue-500')}
            {t('settings.downloadsWatcher.statusStarting', 'Démarrage…')}
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-2 px-2.5 py-1 text-xs font-medium rounded-full bg-red-50 text-red-700">
            {dot('bg-red-500')}
            {t('settings.downloadsWatcher.statusError', 'Erreur')}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-2 px-2.5 py-1 text-xs font-medium rounded-full bg-[var(--color-background-secondary)] text-[var(--color-text-tertiary)]">
            {dot('bg-gray-400')}
            {t('settings.downloadsWatcher.statusDisabled', 'Inactive')}
          </span>
        );
    }
  })();

  return (
    <div className="divide-y divide-[var(--color-border-light)]">
      {error && <div className="px-6 py-3 text-xs text-red-600 bg-red-50">{error}</div>}

      <div className="px-6 py-3 flex items-center justify-between gap-4 bg-[var(--color-background-secondary)]/50">
        <div className="flex items-center gap-3 flex-wrap">
          {statusBadge}
          {status.lastImportName && status.lastImportAt && (
            <span className="text-xs text-[var(--color-text-tertiary)]">
              {t('settings.downloadsWatcher.lastImport', 'Dernier import : {{name}}', {
                name: status.lastImportName,
              })}
            </span>
          )}
          {status.importedCount > 0 && (
            <span className="text-xs text-[var(--color-text-tertiary)]">
              {t('settings.downloadsWatcher.totalImported', '{{count}} fichier(s) importé(s)', {
                count: status.importedCount,
              })}
            </span>
          )}
        </div>
      </div>

      {status.state === 'error' && status.lastError && (
        <div className="px-6 py-3 text-xs text-red-700 bg-red-50/60">⚠ {status.lastError}</div>
      )}

      {status.invalidPaths.length > 0 && (
        <div className="px-6 py-3 text-xs text-amber-700 bg-amber-50/60">
          {t(
            'settings.downloadsWatcher.invalidPathsWarning',
            "Ces dossiers configurés n'existent pas ou sont inaccessibles : {{paths}}",
            { paths: status.invalidPaths.join(', ') }
          )}
        </div>
      )}

      <div className="px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--color-text-primary)]">
            {t('settings.downloadsWatcher.enableLabel', 'Activer la surveillance')}
          </p>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5 leading-relaxed">
            {t(
              'settings.downloadsWatcher.enableDesc',
              'Importe automatiquement chaque nouveau fichier détecté dans les dossiers surveillés.'
            )}
          </p>
          {validationHint && !config.enabled && (
            <p className="text-xs text-amber-600 mt-1">{validationHint}</p>
          )}
        </div>
        <ToggleSwitch
          checked={config.enabled}
          onChange={handleToggleEnabled}
          disabled={saving || (!config.enabled && !canEnable)}
        />
      </div>

      <div className="px-6 py-4">
        <p className="text-sm font-medium text-[var(--color-text-primary)] mb-1">
          {t('settings.downloadsWatcher.sourceFoldersLabel', 'Dossiers surveillés')}
        </p>
        <p className="text-xs text-[var(--color-text-tertiary)] mb-3 leading-relaxed">
          {t(
            'settings.downloadsWatcher.sourceFoldersDesc',
            "Le dossier Téléchargements de votre PC, ou n'importe quel dossier que vous voulez voir importé automatiquement."
          )}
        </p>

        <div className="space-y-2">
          {config.sourceFolders.length === 0 ? (
            <p className="text-xs italic text-[var(--color-text-tertiary)] py-2">
              {t(
                'settings.downloadsWatcher.noSourceFolders',
                'Aucun dossier surveillé pour le moment.'
              )}
            </p>
          ) : (
            config.sourceFolders.map((folder) => (
              <div
                key={folder}
                className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--color-background-secondary)]"
              >
                <span className="text-sm flex-1 truncate text-[var(--color-text-primary)] font-mono">
                  {folder}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveFolder(folder)}
                  disabled={saving}
                  className="text-xs px-2 py-1 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
                  aria-label={t('common.remove', 'Supprimer')}
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>

        <button
          type="button"
          onClick={handleAddFolder}
          disabled={saving}
          className="mt-3 inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]"
        >
          <span>＋</span>
          <span>{t('settings.downloadsWatcher.addFolder', 'Ajouter un dossier')}</span>
        </button>
      </div>

      <div className="px-6 py-4">
        <p className="text-sm font-medium text-[var(--color-text-primary)] mb-1">
          {t('settings.downloadsWatcher.inboxLabel', 'Boîte de réception Filarr')}
        </p>
        <p className="text-xs text-[var(--color-text-tertiary)] mb-3 leading-relaxed">
          {t(
            'settings.downloadsWatcher.inboxDesc',
            "Dossier Filarr où chaque fichier importé est déposé. Ajoutez ensuite des règles d'automatisation pour le router automatiquement."
          )}
        </p>
        <select
          value={config.inboxFolderId}
          onChange={(e) => handleInboxChange(e.target.value)}
          disabled={saving || allFolders.length === 0}
          className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)]"
        >
          <option value="">
            {t('settings.downloadsWatcher.selectFolder', '— Choisir un dossier —')}
          </option>
          {allFolders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>

      <div className="px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--color-text-primary)]">
            {t('settings.downloadsWatcher.deleteOriginalLabel', 'Supprimer le fichier source')}
          </p>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5 leading-relaxed">
            {t(
              'settings.downloadsWatcher.deleteOriginalDesc',
              "Une fois le fichier importé dans Filarr, le supprimer du dossier d'origine."
            )}
          </p>
        </div>
        <ToggleSwitch
          checked={config.deleteOriginal}
          onChange={handleToggleDeleteOriginal}
          disabled={saving}
        />
      </div>

      <div className="px-6 py-4">
        <p className="text-sm font-medium text-[var(--color-text-primary)] mb-1">
          {t('settings.downloadsWatcher.extensionFilterLabel', 'Filtrer par extension')}
        </p>
        <p className="text-xs text-[var(--color-text-tertiary)] mb-3 leading-relaxed">
          {t(
            'settings.downloadsWatcher.extensionFilterDesc',
            'Si vide, tous les fichiers sont importés (sauf les exécutables, toujours bloqués). Sinon, seuls les fichiers avec ces extensions le sont.'
          )}
        </p>

        {config.extensionAllowList.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {config.extensionAllowList.map((ext) => (
              <span
                key={ext}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-[var(--color-background-secondary)] text-[var(--color-text-primary)] font-mono"
              >
                .{ext}
                <button
                  type="button"
                  onClick={() => handleRemoveExtension(ext)}
                  disabled={saving}
                  className="ml-0.5 hover:text-red-600"
                  aria-label={t('common.remove', 'Supprimer')}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={extensionDraft}
            onChange={(e) => setExtensionDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddExtension();
              }
            }}
            placeholder={t('settings.downloadsWatcher.extensionPlaceholder', 'pdf, jpg…')}
            disabled={saving}
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] font-mono"
          />
          <button
            type="button"
            onClick={handleAddExtension}
            disabled={saving || !extensionDraft.trim()}
            className="px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-primary)] disabled:opacity-50"
          >
            {t('common.add', 'Ajouter')}
          </button>
        </div>
      </div>

      <div className="px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--color-text-primary)]">
            {t('settings.downloadsWatcher.scanNowLabel', 'Lancer un scan maintenant')}
          </p>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5 leading-relaxed">
            {t(
              'settings.downloadsWatcher.scanNowDesc',
              'Importe tous les fichiers déjà présents dans les dossiers surveillés. Sans cela, seuls les nouveaux fichiers le sont.'
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={handleScanNow}
          disabled={status.state !== 'active' || scanInProgress}
          className="px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {scanInProgress
            ? t('settings.downloadsWatcher.scanInProgress', 'Scan…')
            : t('settings.downloadsWatcher.scanButton', 'Scanner')}
        </button>
      </div>

      <div className="px-6 py-3 text-xs text-[var(--color-text-tertiary)] bg-[var(--color-background-secondary)]">
        ⓘ{' '}
        {t(
          'settings.downloadsWatcher.hint',
          'Astuce : créez des règles d\'automatisation avec le déclencheur "Importé depuis l\'OS" pour trier finement les fichiers (PDF dans Documents, images dans Photos, etc.).'
        )}
      </div>
    </div>
  );
};

export default DownloadsWatcherSection;
