/**
 * Hot Folder Rule Modal
 *
 * Create / edit form for a single HotFolderRule. Submits the full rule back
 * to the parent section which merges it into the array and POSTs the whole
 * set to main via hot-folders:set-rules.
 */

import { FC, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import type { RootState } from '../../../store';
import { InlineFolderPicker } from '../automation/InlineFolderPicker';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../ui/Modal/Modal';
import { Checkbox } from '../ui/Checkbox/Checkbox';
import { RadioGroup } from '../ui/Radio/RadioGroup';
import { Toggle } from '../ui/Toggle/Toggle';
import { createTag } from '../../../store/slices/tagsSlice';
import { useDispatch } from 'react-redux';
import './HotFolderRuleModal.css';

export type PostImportAction = 'keep' | 'secure-delete' | 'move-to-subfolder';

export type HotFolderState = 'disabled' | 'starting' | 'active' | 'error' | 'paused-safety';

export interface HotFolderRule {
  id: string;
  enabled: boolean;
  name: string;
  sourcePath: string;
  targetFolderId: string;
  recursive: boolean;
  extensionAllowList: string[];
  maxFileSizeBytes: number;
  postImportAction: PostImportAction;
  postImportSubfolderPath?: string;
  autoTagIds: string[];
  watchDeletes: boolean;
  safetyThreshold: number;
  createdAt: string;
  updatedAt: string;
}

export interface HotFolderStatus {
  ruleId: string;
  state: HotFolderState;
  watchedPath: string;
  importedCount: number;
  deletedCount: number;
  lastEventAt: string | null;
  lastEventName: string | null;
  lastError: string | null;
}

const DEFAULT_MAX_BYTES = 500 * 1024 * 1024;
const DEFAULT_SAFETY_THRESHOLD = 50;

const PLAN_MAX_FILE_BYTES: Record<string, number> = {
  free: 1 * 1024 * 1024 * 1024,
  solo: 10 * 1024 * 1024 * 1024,
  pro: 50 * 1024 * 1024 * 1024,
};

function emptyRule(): HotFolderRule {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    enabled: true,
    name: '',
    sourcePath: '',
    targetFolderId: '',
    recursive: false,
    extensionAllowList: [],
    maxFileSizeBytes: DEFAULT_MAX_BYTES,
    postImportAction: 'keep',
    postImportSubfolderPath: '',
    autoTagIds: [],
    watchDeletes: false,
    safetyThreshold: DEFAULT_SAFETY_THRESHOLD,
    createdAt: now,
    updatedAt: now,
  };
}

interface Props {
  isOpen: boolean;
  rule: HotFolderRule | null;
  onClose: () => void;
  onSave: (rule: HotFolderRule) => void | Promise<void>;
  tier: string;
}

const HotFolderRuleModal: FC<Props> = ({ isOpen, rule, onClose, onSave, tier }) => {
  const { t } = useTranslation();
  const foldersById = useSelector((s: RootState) => s.folders.byId);
  const tagsById = useSelector((s: RootState) => s.tags.tags);

  const allTags = useMemo(
    () => Object.values(tagsById ?? {}).sort((a: any, b: any) => a.name.localeCompare(b.name)),
    [tagsById]
  );

  const [draft, setDraft] = useState<HotFolderRule>(rule ?? emptyRule());
  const [extDraft, setExtDraft] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const [creatingTag, setCreatingTag] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dispatch = useDispatch();

  useEffect(() => {
    setDraft(rule ?? emptyRule());
    setError(null);
    setExtDraft('');
  }, [rule, isOpen]);

  const isFreeTier = tier === 'free';
  const planMaxBytes = PLAN_MAX_FILE_BYTES[tier] ?? PLAN_MAX_FILE_BYTES.free;
  const maxFileMb = Math.round(draft.maxFileSizeBytes / (1024 * 1024));

  const update = <K extends keyof HotFolderRule>(key: K, value: HotFolderRule[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const pickSource = async () => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;
    try {
      const result = await ipc.invoke('showOpenDialog', {
        properties: ['openDirectory'],
        title: t('settings.hotFolders.modal.pickSource', 'Choisir le dossier à surveiller'),
      });
      if (result?.canceled || !result?.filePaths?.length) return;
      update('sourcePath', result.filePaths[0] as string);
    } catch (err) {
      console.warn('[HotFolderRuleModal] folder picker failed:', err);
    }
  };

  const addExtension = () => {
    const cleaned = extDraft.trim().toLowerCase().replace(/^\./, '');
    if (!cleaned || !/^[a-z0-9]+$/.test(cleaned)) {
      setExtDraft('');
      return;
    }
    if (draft.extensionAllowList.includes(cleaned)) {
      setExtDraft('');
      return;
    }
    update('extensionAllowList', [...draft.extensionAllowList, cleaned]);
    setExtDraft('');
  };

  const removeExtension = (ext: string) => {
    update(
      'extensionAllowList',
      draft.extensionAllowList.filter((e) => e !== ext)
    );
  };

  const toggleTag = (tagId: string) => {
    if (isFreeTier) return;
    if (draft.autoTagIds.includes(tagId)) {
      update(
        'autoTagIds',
        draft.autoTagIds.filter((t) => t !== tagId)
      );
    } else {
      update('autoTagIds', [...draft.autoTagIds, tagId]);
    }
  };

  const handleCreateTag = async () => {
    const name = tagDraft.trim();
    if (!name || creatingTag || isFreeTier) return;
    if (allTags.some((tag: any) => tag.name.toLowerCase() === name.toLowerCase())) {
      setTagDraft('');
      return;
    }
    setCreatingTag(true);
    try {
      const result: any = await dispatch(createTag({ name }) as any);
      const newTag = result?.payload;
      if (newTag?.id) {
        update('autoTagIds', [...draft.autoTagIds, newTag.id]);
      }
      setTagDraft('');
    } catch (err) {
      console.warn('[HotFolderRuleModal] createTag failed:', err);
    } finally {
      setCreatingTag(false);
    }
  };

  const handleSubmit = async () => {
    setError(null);
    if (!draft.name.trim()) {
      setError(t('settings.hotFolders.validation.nameRequired', 'Nom requis') as string);
      return;
    }
    if (!draft.sourcePath) {
      setError(
        t(
          'settings.hotFolders.validation.sourceMissing',
          'Choisissez un dossier à surveiller'
        ) as string
      );
      return;
    }
    // Un dossier à la corbeille n'est plus une destination valable : le
    // watcher importerait dans le vide (le main refuse d'y ranger un item).
    if (
      !draft.targetFolderId ||
      !foldersById[draft.targetFolderId] ||
      foldersById[draft.targetFolderId].deletedAt
    ) {
      setError(
        t(
          'settings.hotFolders.validation.targetMissing',
          'Choisissez un dossier Filarr cible'
        ) as string
      );
      return;
    }
    if (draft.postImportAction === 'move-to-subfolder' && !draft.postImportSubfolderPath?.trim()) {
      setError(
        t(
          'settings.hotFolders.validation.subfolderRequired',
          'Indiquez le sous-dossier de destination'
        ) as string
      );
      return;
    }
    setSubmitting(true);
    try {
      await onSave({ ...draft, updatedAt: new Date().toISOString() });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" closeOnBackdrop={!submitting}>
      <ModalHeader showCloseButton onClose={onClose}>
        <h3 className="text-base font-semibold text-[var(--color-text-primary)]">
          {rule
            ? t('settings.hotFolders.modal.titleEdit', 'Modifier le hot folder')
            : t('settings.hotFolders.modal.titleCreate', 'Nouveau hot folder')}
        </h3>
      </ModalHeader>

      <ModalBody>
        <div className="space-y-5">
          {error && (
            <div className="px-3 py-2 text-xs rounded bg-red-50 text-red-700 border border-red-200">
              {error}
            </div>
          )}

          {/* Name */}
          <Field
            label={t('settings.hotFolders.modal.name', 'Nom de la règle')}
            hint={t('settings.hotFolders.modal.nameHint', 'Pour vous y retrouver.')}
          >
            <input
              type="text"
              value={draft.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder={t('settings.hotFolders.modal.namePlaceholder', 'ex. Scan screenshots')}
              data-autofocus
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)]"
            />
          </Field>

          {/* Source path */}
          <Field
            label={t('settings.hotFolders.modal.sourceFolder', 'Dossier OS à surveiller')}
            hint={t(
              'settings.hotFolders.modal.sourceFolderHint',
              'Doit exister sur ce PC. Ne peut pas être un dossier du vault Filarr.'
            )}
          >
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={draft.sourcePath}
                readOnly
                placeholder={t(
                  'settings.hotFolders.modal.sourcePlaceholder',
                  'Aucun dossier choisi'
                )}
                className="flex-1 px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] font-mono truncate"
              />
              <button
                type="button"
                onClick={pickSource}
                className="px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]"
              >
                {t('settings.hotFolders.modal.pickSource', 'Choisir…')}
              </button>
            </div>
            <div className="mt-3">
              <Checkbox
                label={t('settings.hotFolders.modal.recursive', 'Inclure les sous-dossiers')}
                checked={draft.recursive}
                onChange={(e) => update('recursive', e.target.checked)}
              />
            </div>
          </Field>

          {/* Target Filarr folder */}
          <Field
            label={t('settings.hotFolders.modal.targetFolder', 'Importer dans le dossier Filarr')}
            hint={t(
              'settings.hotFolders.modal.targetFolderHint',
              'Arborescence complète : le chemin affiché est celui où les fichiers seront rangés.'
            )}
          >
            {/* Arbre cherchable plutôt qu'une liste plate de noms de feuilles :
                deux dossiers « 2026 » y sont enfin distinguables. Les dossiers
                mis à la corbeille sont exclus (selectAllFolders). */}
            <InlineFolderPicker
              value={draft.targetFolderId || null}
              onChange={(folderId) => update('targetFolderId', folderId)}
              placeholder={
                t('settings.hotFolders.modal.targetPlaceholder', '— Choisir un dossier —') as string
              }
            />
          </Field>

          {/* Extension allow list */}
          <Field
            label={t('settings.hotFolders.modal.extensionFilter', 'Filtrer par extension')}
            hint={t(
              'settings.hotFolders.modal.extensionFilterHint',
              'Laisser vide pour tout importer (exécutables toujours bloqués).'
            )}
          >
            {draft.extensionAllowList.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {draft.extensionAllowList.map((ext) => (
                  <span
                    key={ext}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs rounded-full bg-[var(--color-background-secondary)] text-[var(--color-text-primary)] font-mono"
                  >
                    .{ext}
                    <button
                      type="button"
                      onClick={() => removeExtension(ext)}
                      className="hover:text-red-600"
                      aria-label="remove"
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
                value={extDraft}
                onChange={(e) => setExtDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addExtension();
                  }
                }}
                placeholder="pdf, jpg…"
                className="flex-1 px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] font-mono"
              />
              <button
                type="button"
                onClick={addExtension}
                disabled={!extDraft.trim()}
                className="px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-primary)] disabled:opacity-50"
              >
                {t('common.add', 'Ajouter')}
              </button>
            </div>
          </Field>

          {/* Max file size */}
          <Field
            label={t('settings.hotFolders.modal.maxFileSize', 'Taille max par fichier (Mo)')}
            hint={t(
              'settings.hotFolders.modal.maxFileSizeHint',
              'Plafond du plan : {{cap}} Mo. Les fichiers plus gros sont ignorés.',
              { cap: Math.round(planMaxBytes / (1024 * 1024)) }
            )}
          >
            <input
              type="number"
              min={1}
              max={Math.round(planMaxBytes / (1024 * 1024))}
              value={maxFileMb}
              onChange={(e) => {
                const mb = Math.max(
                  1,
                  Math.min(planMaxBytes / (1024 * 1024), Number(e.target.value) || 1)
                );
                update('maxFileSizeBytes', mb * 1024 * 1024);
              }}
              className="w-32 px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)]"
            />
          </Field>

          {/* Post-import action */}
          <Field label={t('settings.hotFolders.modal.postImport', 'Après import')}>
            <RadioGroup
              name="postImportAction"
              value={draft.postImportAction}
              onChange={(v) => update('postImportAction', v as PostImportAction)}
              orientation="vertical"
              options={[
                {
                  value: 'keep',
                  label: t(
                    'settings.hotFolders.modal.postImportKeep',
                    'Conserver le fichier source'
                  ),
                },
                {
                  value: 'secure-delete',
                  label: t(
                    'settings.hotFolders.modal.postImportSecureDelete',
                    'Effacer le fichier source de manière sécurisée'
                  ),
                },
                {
                  value: 'move-to-subfolder',
                  label: t(
                    'settings.hotFolders.modal.postImportMove',
                    'Déplacer dans un sous-dossier…'
                  ),
                },
              ]}
            />
            {draft.postImportAction === 'move-to-subfolder' && (
              <input
                type="text"
                value={draft.postImportSubfolderPath ?? ''}
                onChange={(e) => update('postImportSubfolderPath', e.target.value)}
                placeholder={t(
                  'settings.hotFolders.modal.postImportSubfolderPlaceholder',
                  'ex. processed/'
                )}
                className="mt-2 ml-7 w-full max-w-md px-3 py-1.5 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] font-mono"
              />
            )}
          </Field>

          {/* Auto-tags */}
          <Field
            label={t('settings.hotFolders.modal.autoTags', 'Auto-tags')}
            hint={
              isFreeTier
                ? (t(
                    'settings.hotFolders.modal.autoTagsLockedFree',
                    'Disponible à partir du plan Solo.'
                  ) as string)
                : (t(
                    'settings.hotFolders.modal.autoTagsExplain',
                    'Chaque fichier importé via cette règle recevra automatiquement ces tags. Cliquez sur un tag pour l\'activer (fond coloré = actif). Idéal pour catégoriser sans intervention manuelle (ex: "scan", "screenshot", "à trier").'
                  ) as string)
            }
          >
            <div className={isFreeTier ? 'opacity-50 pointer-events-none' : ''}>
              {allTags.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {allTags.map((tag: any) => {
                    const active = draft.autoTagIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        disabled={isFreeTier}
                        onClick={() => toggleTag(tag.id)}
                        className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                          active
                            ? 'bg-[var(--color-primary-500)] border-[var(--color-primary-500)] text-white'
                            : 'bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                        } disabled:cursor-not-allowed`}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleCreateTag();
                    }
                  }}
                  placeholder={t(
                    'settings.hotFolders.modal.createTagPlaceholder',
                    'Nom du nouveau tag…'
                  )}
                  disabled={isFreeTier || creatingTag}
                  className="flex-1 px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)]"
                />
                <button
                  type="button"
                  onClick={handleCreateTag}
                  disabled={isFreeTier || creatingTag || !tagDraft.trim()}
                  className="px-3 py-2 text-sm rounded-lg bg-[var(--color-primary-500)] hover:bg-[var(--color-primary-600)] text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creatingTag
                    ? t('common.creating', 'Création…')
                    : t('settings.hotFolders.modal.createTag', '＋ Créer')}
                </button>
              </div>
            </div>
          </Field>

          {/* Watch deletes + safety threshold */}
          <Field
            label={t('settings.hotFolders.modal.watchDeletes', 'Miroir des suppressions')}
            hint={t(
              'settings.hotFolders.modal.watchDeletesHint',
              'Si vous supprimez un fichier de ce dossier OS, il sera marqué supprimé dans le vault.'
            )}
          >
            <Toggle
              label={t('settings.hotFolders.modal.watchDeletesLabel', 'Activer le miroir')}
              checked={draft.watchDeletes}
              onChange={(e) => update('watchDeletes', e.target.checked)}
            />
            {draft.watchDeletes && (
              <div className="mt-4">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-medium text-[var(--color-text-secondary)]">
                    {t('settings.hotFolders.modal.safetyThresholdLabel', 'Seuil de sécurité')}
                  </p>
                  <span className="text-xs font-mono font-semibold text-[var(--color-primary-500)]">
                    {draft.safetyThreshold}%
                  </span>
                </div>
                <p className="text-xs text-[var(--color-text-tertiary)] mb-2 leading-relaxed">
                  {t(
                    'settings.hotFolders.modal.safetyThresholdHint',
                    'Si plus de {{percent}}% des fichiers déjà importés disparaissent en une fois, on suspend la suppression (drive probablement déconnecté).',
                    { percent: draft.safetyThreshold }
                  )}
                </p>
                <input
                  type="range"
                  min={10}
                  max={90}
                  step={10}
                  value={draft.safetyThreshold}
                  onChange={(e) => update('safetyThreshold', Number(e.target.value))}
                  className="hf-range w-full max-w-md"
                />
                <div className="flex justify-between max-w-md text-[10px] text-[var(--color-text-tertiary)] mt-1.5">
                  <span>{t('settings.hotFolders.modal.safetyStrict', 'Strict (10%)')}</span>
                  <span>{t('settings.hotFolders.modal.safetyPermissive', 'Permissif (90%)')}</span>
                </div>
              </div>
            )}
          </Field>
        </div>
      </ModalBody>

      <ModalFooter>
        <div className="flex items-center justify-end gap-2 w-full">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-2 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-primary)] disabled:opacity-50"
          >
            {t('common.cancel', 'Annuler')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 text-sm rounded-lg bg-[var(--color-primary-500)] hover:bg-[var(--color-primary-600)] text-white disabled:opacity-50"
          >
            {submitting
              ? t('common.saving', 'Enregistrement…')
              : t('settings.hotFolders.modal.save', 'Enregistrer')}
          </button>
        </div>
      </ModalFooter>
    </Modal>
  );
};

const Field: FC<{
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, hint, children }) => (
  <div>
    <p className="text-sm font-medium text-[var(--color-text-primary)] mb-1">{label}</p>
    {hint && (
      <p className="text-xs text-[var(--color-text-tertiary)] mb-2 leading-relaxed">{hint}</p>
    )}
    {children}
  </div>
);

export default HotFolderRuleModal;
