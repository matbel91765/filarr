/**
 * ImportWizard — Multi-step modal for importing notes from Obsidian, Notion, Evernote.
 *
 * Steps:
 * 1. Source selection (Obsidian / Notion / Evernote)
 * 2. File/folder selection via Electron dialog
 * 3. Import options (notebook, tags, links)
 * 4. Progress & results
 */

import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import Modal, { ModalBody, ModalFooter } from '../ui/Modal/Modal';
import {
  addNotesBatch,
  addNotebook,
  setNoteNotebook,
  saveNotesToDisk,
} from '../../../store/slices/notesSlice';
import { createTag } from '../../../store/slices/tagsSlice';
import store from '../../../store';
import type { AppDispatch } from '../../../store';
import { selectAllNotebooks } from '../../../store/slices/notesSlice';
import type { Note } from '../../../types/notes';
import {
  runExternalImport,
  type ExternalSource,
  type ExternalImportProgress,
  type ExternalImportResult,
} from '../../../services/notes/externalImportService';

// ==================== Types ====================

interface ImportWizardProps {
  isOpen: boolean;
  onClose: () => void;
}

type WizardStep = 'source' | 'file' | 'options' | 'progress';

// ==================== Source Cards ====================

const SOURCES: {
  id: ExternalSource;
  icon: string;
  fileType: 'directory' | 'file';
  filters?: { name: string; extensions: string[] }[];
  instructionKey: string;
}[] = [
  {
    id: 'obsidian',
    icon: '💎',
    fileType: 'directory',
    instructionKey: 'import.obsidianInstructions',
  },
  // Notion & Evernote — uncomment when tested
  // {
  //   id: 'notion',
  //   icon: '📝',
  //   fileType: 'file',
  //   filters: [{ name: 'ZIP', extensions: ['zip'] }],
  //   instructionKey: 'import.notionInstructions',
  // },
  // {
  //   id: 'evernote',
  //   icon: '🐘',
  //   fileType: 'file',
  //   filters: [{ name: 'Evernote Export', extensions: ['enex'] }],
  //   instructionKey: 'import.evernoteInstructions',
  // },
];

// ==================== Component ====================

const ImportWizard: React.FC<ImportWizardProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const notebooks = useSelector(selectAllNotebooks);

  // Wizard state
  const [step, setStep] = useState<WizardStep>('source');
  const [source, setSource] = useState<ExternalSource | null>(null);
  const [sourcePath, setSourcePath] = useState<string>('');
  const [sourceDisplayName, setSourceDisplayName] = useState<string>('');
  const [targetNotebookId, setTargetNotebookId] = useState<string>('');
  const [importTags, setImportTags] = useState(true);
  const [preserveLinks, setPreserveLinks] = useState(true);

  // Progress state
  const [progress, setProgress] = useState<ExternalImportProgress | null>(null);
  const [result, setResult] = useState<ExternalImportResult | null>(null);
  const [importing, setImporting] = useState(false);

  // ==================== Handlers ====================

  const handleSelectSource = useCallback((src: ExternalSource) => {
    setSource(src);
    setStep('file');
  }, []);

  const handleSelectFile = useCallback(async () => {
    if (!source) return;
    const sourceConfig = SOURCES.find((s) => s.id === source);
    if (!sourceConfig) return;

    let selectedPath: string | null = null;

    if (sourceConfig.fileType === 'directory') {
      selectedPath = await window.electron.ipcRenderer.invoke('import:selectDirectory');
    } else {
      selectedPath = await window.electron.ipcRenderer.invoke('import:selectFile', {
        filters: sourceConfig.filters,
      });
    }

    if (selectedPath) {
      setSourcePath(selectedPath);
      // Extract display name from path
      const parts = selectedPath.replace(/\\/g, '/').split('/');
      setSourceDisplayName(parts[parts.length - 1] || selectedPath);
    }
  }, [source]);

  const handleStartImport = useCallback(async () => {
    if (!source || !sourcePath) return;
    setStep('progress');
    setImporting(true);
    setResult(null);

    try {
      const importResult = await runExternalImport(
        {
          source,
          sourcePath,
          targetNotebookId: targetNotebookId || undefined,
          importTags,
          preserveLinks,
        },
        (p) => setProgress(p)
      );

      // Create tags in Redux and build name→id mapping (batch-friendly)
      const tagIdMap = new Map<string, string>();
      if (importTags && importResult.tags.length > 0) {
        // Dispatch all tag creations and collect results
        const tagPromises = importResult.tags.map((tagData) =>
          dispatch(createTag({ name: tagData.name, color: tagData.color }))
        );
        const tagResults = await Promise.all(tagPromises);
        for (const tagAction of tagResults) {
          if (createTag.fulfilled.match(tagAction)) {
            tagIdMap.set(tagAction.payload.name, tagAction.payload.id);
          }
        }
      }

      // Create notebooks from folder structure and build name→id mapping
      const notebookIdMap = new Map<string, string>();
      const NOTEBOOK_COLORS = [
        '#4a9eed',
        '#34d399',
        '#fbbf24',
        '#f87171',
        '#a78bfa',
        '#fb923c',
        '#38bdf8',
        '#e879f9',
        '#22d3ee',
        '#84cc16',
      ];
      if (importResult.notebooks.length > 0) {
        for (let i = 0; i < importResult.notebooks.length; i++) {
          const nb = importResult.notebooks[i];
          const color = NOTEBOOK_COLORS[i % NOTEBOOK_COLORS.length];
          dispatch(addNotebook({ name: nb.name, color }));
          // Find the newly created notebook ID
          const currentNotebooks = store.getState().notes.notebooks;
          const created = Object.values(currentNotebooks).find((n: any) => n.name === nb.name);
          if (created) {
            notebookIdMap.set(nb.name, created.id);
          }
        }
      }

      // Resolve tag names to IDs and folder→notebook mapping on all notes
      for (const note of importResult.notes) {
        // Tags
        const noteTags = (note as Note & { _importTags?: string[] })._importTags;
        if (noteTags && noteTags.length > 0) {
          note.tagIds = noteTags
            .map((name) => tagIdMap.get(name))
            .filter((id): id is string => !!id);
        }
        delete (note as Note & { _importTags?: string[] })._importTags;

        // Notebook from folder
        const folderName = (note as Note & { _folderName?: string })._folderName;
        if (folderName) {
          const nbId = notebookIdMap.get(folderName);
          if (nbId) note.notebookId = nbId;
          delete (note as Note & { _folderName?: string })._folderName;
        }

        // Fallback to user-selected target notebook
        if (!note.notebookId && targetNotebookId) {
          note.notebookId = targetNotebookId;
        }
      }

      // Single batch dispatch — 1 Redux update instead of N
      if (importResult.notes.length > 0) {
        dispatch(addNotesBatch(importResult.notes));
        await dispatch(saveNotesToDisk());
      }

      setResult(importResult);
    } catch (err) {
      setResult({
        notes: [],
        tags: [],
        notebooks: [],
        notesImported: 0,
        tagsCreated: 0,
        linksResolved: 0,
        warnings: [],
        errors: [err instanceof Error ? err.message : 'Unknown import error'],
      });
    } finally {
      setImporting(false);
    }
  }, [source, sourcePath, targetNotebookId, importTags, preserveLinks, dispatch]);

  const handleClose = useCallback(() => {
    if (importing) return; // Don't close while importing
    setStep('source');
    setSource(null);
    setSourcePath('');
    setSourceDisplayName('');
    setTargetNotebookId('');
    setImportTags(true);
    setPreserveLinks(true);
    setProgress(null);
    setResult(null);
    onClose();
  }, [importing, onClose]);

  const handleBack = useCallback(() => {
    if (step === 'file') setStep('source');
    else if (step === 'options') setStep('file');
  }, [step]);

  // ==================== Render Steps ====================

  const renderSourceStep = () => (
    <ModalBody>
      <p className="text-sm mb-4" style={{ color: 'var(--color-text-secondary)' }}>
        {t('import.selectSourceDesc', 'Choisissez la source depuis laquelle importer vos notes.')}
      </p>
      <div className="flex flex-col gap-3">
        {SOURCES.map((src) => (
          <button
            key={src.id}
            onClick={() => handleSelectSource(src.id)}
            className="flex items-center gap-4 w-full px-4 py-4 text-left rounded-xl border-2 transition-all hover:shadow-sm"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-background-secondary)',
              cursor: 'pointer',
            }}
          >
            <span className="text-2xl">{src.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm" style={{ color: 'var(--color-text-primary)' }}>
                {t(`import.${src.id}`, src.id.charAt(0).toUpperCase() + src.id.slice(1))}
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                {t(`import.${src.id}Desc`, getSourceDescription(src.id))}
              </div>
            </div>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              <polyline points="9,18 15,12 9,6" />
            </svg>
          </button>
        ))}
      </div>
    </ModalBody>
  );

  const renderFileStep = () => {
    const sourceConfig = SOURCES.find((s) => s.id === source);
    return (
      <>
        <ModalBody>
          <p className="text-sm mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            {t(sourceConfig?.instructionKey || '', getInstructions(source!))}
          </p>

          <button
            onClick={handleSelectFile}
            className="w-full px-4 py-4 text-sm rounded-lg border-2 border-dashed transition-colors mt-3"
            style={{
              borderColor: sourcePath ? 'var(--color-primary-500)' : 'var(--color-border)',
              backgroundColor: 'var(--color-background-secondary)',
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
            }}
          >
            {sourcePath ? (
              <span className="flex items-center gap-2">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--color-primary-500)"
                  strokeWidth="2"
                >
                  <polyline points="20,6 9,17 4,12" />
                </svg>
                {sourceDisplayName}
              </span>
            ) : (
              t(
                'import.selectFileOrFolder',
                source === 'obsidian'
                  ? 'Sélectionner le dossier du vault...'
                  : 'Sélectionner le fichier...'
              )
            )}
          </button>
        </ModalBody>
        <ModalFooter>
          <button
            onClick={handleBack}
            className="px-4 py-2 text-sm rounded-lg"
            style={{
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              background: 'none',
              border: 'none',
            }}
          >
            {t('common.back', 'Retour')}
          </button>
          <button
            onClick={() => setStep('options')}
            disabled={!sourcePath}
            className="px-4 py-2 text-sm font-medium rounded-lg transition-colors"
            style={{
              backgroundColor: sourcePath ? 'var(--color-primary-500)' : 'var(--color-border)',
              color: 'white',
              cursor: sourcePath ? 'pointer' : 'not-allowed',
              border: 'none',
            }}
          >
            {t('common.next', 'Suivant')}
          </button>
        </ModalFooter>
      </>
    );
  };

  const renderOptionsStep = () => (
    <>
      <ModalBody>
        <div className="flex flex-col gap-4">
          {/* Target notebook */}
          <div>
            <label
              className="block text-xs font-medium mb-1.5"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {t('import.targetNotebook', 'Carnet cible')}
            </label>
            <select
              value={targetNotebookId}
              onChange={(e) => setTargetNotebookId(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border"
              style={{
                borderColor: 'var(--color-border)',
                backgroundColor: 'var(--color-background-secondary)',
                color: 'var(--color-text-primary)',
              }}
            >
              <option value="">{t('import.noNotebook', 'Aucun (racine)')}</option>
              {notebooks.map((nb) => (
                <option key={nb.id} value={nb.id}>
                  {nb.name}
                </option>
              ))}
            </select>
          </div>

          {/* Import tags toggle */}
          <label
            className="flex items-center gap-3 cursor-pointer"
            onClick={() => setImportTags(!importTags)}
          >
            <div
              style={{
                width: 36,
                height: 20,
                borderRadius: 10,
                backgroundColor: importTags
                  ? 'var(--color-primary-500)'
                  : 'var(--color-border-strong)',
                position: 'relative',
                transition: 'background-color 0.2s',
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  backgroundColor: 'white',
                  position: 'absolute',
                  top: 2,
                  left: importTags ? 18 : 2,
                  transition: 'left 0.2s',
                }}
              />
            </div>
            <div>
              <div className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                {t('import.importTags', 'Importer les tags')}
              </div>
              <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                {t('import.importTagsDesc', 'Crée les tags trouvés dans les notes importées.')}
              </div>
            </div>
          </label>

          {/* Preserve links toggle */}
          <label
            className="flex items-center gap-3 cursor-pointer"
            onClick={() => setPreserveLinks(!preserveLinks)}
          >
            <div
              style={{
                width: 36,
                height: 20,
                borderRadius: 10,
                backgroundColor: preserveLinks
                  ? 'var(--color-primary-500)'
                  : 'var(--color-border-strong)',
                position: 'relative',
                transition: 'background-color 0.2s',
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  backgroundColor: 'white',
                  position: 'absolute',
                  top: 2,
                  left: preserveLinks ? 18 : 2,
                  transition: 'left 0.2s',
                }}
              />
            </div>
            <div>
              <div className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                {t('import.preserveLinks', 'Préserver les liens entre notes')}
              </div>
              <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                {t(
                  'import.preserveLinksDesc',
                  'Résout les [[wiki-links]] entre les notes importées.'
                )}
              </div>
            </div>
          </label>
        </div>
      </ModalBody>
      <ModalFooter>
        <button
          onClick={handleBack}
          className="px-4 py-2 text-sm rounded-lg"
          style={{
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
            background: 'none',
            border: 'none',
          }}
        >
          {t('common.back', 'Retour')}
        </button>
        <button
          onClick={handleStartImport}
          className="px-4 py-2 text-sm font-medium rounded-lg"
          style={{
            backgroundColor: 'var(--color-primary-500)',
            color: 'white',
            cursor: 'pointer',
            border: 'none',
          }}
        >
          {t('import.startImport', 'Importer')}
        </button>
      </ModalFooter>
    </>
  );

  const renderProgressStep = () => (
    <>
      <ModalBody>
        {importing && progress && (
          <div className="flex flex-col items-center gap-4 py-4">
            {/* Progress bar */}
            <div
              className="w-full h-2 rounded-full overflow-hidden"
              style={{ backgroundColor: 'var(--color-border)' }}
            >
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  backgroundColor: 'var(--color-primary-500)',
                  width:
                    progress.total > 0 ? `${(progress.current / progress.total) * 100}%` : '0%',
                }}
              />
            </div>
            <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {getPhaseLabel(progress.phase, t)} — {progress.current}/{progress.total}
            </div>
            {progress.detail && (
              <div
                className="text-xs truncate max-w-full"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                {progress.detail}
              </div>
            )}
          </div>
        )}

        {!importing && result && (
          <div className="flex flex-col gap-3 py-2">
            {/* Success summary */}
            {result.notesImported > 0 && (
              <div
                className="flex items-center gap-3 px-4 py-3 rounded-lg"
                style={{ backgroundColor: 'var(--color-success-50)' }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--color-success-500)"
                  strokeWidth="2"
                >
                  <polyline points="20,6 9,17 4,12" />
                </svg>
                <div>
                  <div
                    className="text-sm font-semibold"
                    style={{ color: 'var(--color-success-700)' }}
                  >
                    {result.notesImported} {t('import.notesImported', 'note(s) importée(s)')}
                  </div>
                  {result.tagsCreated > 0 && (
                    <div className="text-xs" style={{ color: 'var(--color-success-600)' }}>
                      {result.tagsCreated} {t('import.tagsCreated', 'tag(s) créé(s)')}
                    </div>
                  )}
                  {result.linksResolved > 0 && (
                    <div className="text-xs" style={{ color: 'var(--color-success-600)' }}>
                      {result.linksResolved} {t('import.linksResolved', 'lien(s) résolu(s)')}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Warnings */}
            {result.warnings.length > 0 && (
              <div
                className="px-4 py-3 rounded-lg"
                style={{ backgroundColor: 'var(--color-warning-50)' }}
              >
                <div
                  className="text-xs font-semibold mb-1"
                  style={{ color: 'var(--color-warning-700)' }}
                >
                  {t('import.warnings', 'Avertissements')}
                </div>
                {result.warnings.slice(0, 5).map((w, i) => (
                  <div key={i} className="text-xs" style={{ color: 'var(--color-warning-600)' }}>
                    {w}
                  </div>
                ))}
                {result.warnings.length > 5 && (
                  <div className="text-xs mt-1" style={{ color: 'var(--color-warning-500)' }}>
                    +{result.warnings.length - 5}{' '}
                    {t('import.moreWarnings', 'autres avertissements')}
                  </div>
                )}
              </div>
            )}

            {/* Errors */}
            {result.errors.length > 0 && (
              <div
                className="px-4 py-3 rounded-lg"
                style={{ backgroundColor: 'var(--color-error-50)' }}
              >
                <div
                  className="text-xs font-semibold mb-1"
                  style={{ color: 'var(--color-error-700)' }}
                >
                  {t('import.errors', 'Erreurs')}
                </div>
                {result.errors.slice(0, 5).map((e, i) => (
                  <div key={i} className="text-xs" style={{ color: 'var(--color-error-600)' }}>
                    {e}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </ModalBody>
      {!importing && (
        <ModalFooter>
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium rounded-lg"
            style={{
              backgroundColor: 'var(--color-primary-500)',
              color: 'white',
              cursor: 'pointer',
              border: 'none',
            }}
          >
            {t('common.done', 'Terminé')}
          </button>
        </ModalFooter>
      )}
    </>
  );

  // ==================== Main Render ====================

  return (
    <Modal
      isOpen={isOpen}
      onClose={importing ? () => {} : handleClose}
      title={t('import.title', 'Importer des notes')}
      size="md"
    >
      {step === 'source' && renderSourceStep()}
      {step === 'file' && renderFileStep()}
      {step === 'options' && renderOptionsStep()}
      {step === 'progress' && renderProgressStep()}
    </Modal>
  );
};

// ==================== Helpers ====================

function getSourceDescription(source: ExternalSource): string {
  switch (source) {
    case 'obsidian':
      return 'Vault Obsidian (.md avec wiki-links et tags)';
    case 'notion':
      return 'Export Notion (ZIP HTML ou Markdown)';
    case 'evernote':
      return 'Export Evernote (.enex)';
  }
}

function getInstructions(source: ExternalSource): string {
  switch (source) {
    case 'obsidian':
      return 'Sélectionnez le dossier racine de votre vault Obsidian.';
    case 'notion':
      return 'Dans Notion, allez dans Paramètres → Exporter tout le contenu → Format HTML ou Markdown. Sélectionnez ensuite le fichier ZIP exporté.';
    case 'evernote':
      return 'Dans Evernote, sélectionnez les notes → Fichier → Exporter (.enex). Sélectionnez ensuite le fichier .enex exporté.';
  }
}

function getPhaseLabel(phase: string, t: (key: string, fallback: string) => string): string {
  switch (phase) {
    case 'reading':
      return t('import.phaseReading', 'Lecture des fichiers');
    case 'parsing':
      return t('import.phaseParsing', 'Analyse du contenu');
    case 'converting':
      return t('import.phaseConverting', 'Conversion des notes');
    case 'linking':
      return t('import.phaseLinking', 'Résolution des liens');
    case 'done':
      return t('import.phaseDone', 'Terminé');
    default:
      return phase;
  }
}

export default ImportWizard;
