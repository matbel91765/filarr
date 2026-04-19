/**
 * ImportVaultModal — Select a backup file and import it.
 * If the file is .enc, shows a password field.
 */

import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import Modal, { ModalBody, ModalFooter } from '../ui/Modal/Modal';

interface ImportVaultModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (options: { filePath: string; password?: string }) => void;
}

const ImportVaultModal: React.FC<ImportVaultModalProps> = ({ isOpen, onClose, onImport }) => {
  const { t } = useTranslation();

  const [selectedFile, setSelectedFile] = useState<{
    filePath: string;
    fileName: string;
    isEncrypted: boolean;
  } | null>(null);
  const [password, setPassword] = useState('');
  const [selecting, setSelecting] = useState(false);

  const handleSelectFile = useCallback(async () => {
    setSelecting(true);
    try {
      const result = await window.electron.ipcRenderer.invoke('vault:selectImportFile');
      if (result) {
        setSelectedFile(result);
        setPassword('');
      }
    } catch {
      // Dialog cancelled
    } finally {
      setSelecting(false);
    }
  }, []);

  const handleImport = useCallback(() => {
    if (!selectedFile) return;
    if (selectedFile.isEncrypted && !password) return;
    onImport({
      filePath: selectedFile.filePath,
      password: selectedFile.isEncrypted ? password : undefined,
    });
  }, [selectedFile, password, onImport]);

  const handleClose = () => {
    setSelectedFile(null);
    setPassword('');
    onClose();
  };

  const canImport = selectedFile && (!selectedFile.isEncrypted || password.length > 0);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('settings.importVault', 'Importer un backup')}
      size="sm"
    >
      <ModalBody>
        <p className="text-sm mb-4" style={{ color: 'var(--color-text-secondary)' }}>
          {t(
            'settings.importVaultModalDesc',
            "Sélectionnez un fichier d'export Filarr (.zip ou .enc chiffré)."
          )}
        </p>

        {/* File selection */}
        <button
          onClick={handleSelectFile}
          disabled={selecting}
          className="w-full px-4 py-3 text-sm rounded-lg border-2 border-dashed transition-colors"
          style={{
            borderColor: selectedFile ? 'var(--color-primary-500)' : 'var(--color-border)',
            backgroundColor: 'var(--color-background-secondary)',
            color: 'var(--color-text-primary)',
            cursor: 'pointer',
          }}
        >
          {selecting
            ? t('common.loading', 'Chargement...')
            : selectedFile
              ? selectedFile.fileName
              : t('settings.importSelectFile', 'Sélectionner un fichier...')}
        </button>

        {/* Encrypted badge */}
        {selectedFile?.isEncrypted && (
          <div className="mt-3">
            <span
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
              style={{ backgroundColor: '#fef3c7', color: '#92400e' }}
            >
              <svg
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              {t('settings.importEncryptedFile', 'Fichier chiffré')}
            </span>

            <div className="mt-3">
              <label
                className="block text-xs font-medium mb-1.5"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {t('settings.importBackupPassword', 'Mot de passe du backup')}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t(
                  'settings.importPasswordPlaceholder',
                  "Mot de passe utilisé lors de l'export"
                )}
                autoFocus
                className="w-full px-3 py-2 text-sm rounded-lg outline-none"
                style={{
                  backgroundColor: 'var(--color-background-secondary)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)',
                }}
              />
            </div>
          </div>
        )}

        {selectedFile && !selectedFile.isEncrypted && (
          <p className="mt-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            {t('settings.importPlainFile', 'Fichier non chiffré — import direct.')}
          </p>
        )}
      </ModalBody>

      <ModalFooter>
        <div className="flex justify-end gap-2">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium rounded-lg"
            style={{
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
            }}
          >
            {t('common.cancel', 'Annuler')}
          </button>
          <button
            onClick={handleImport}
            disabled={!canImport}
            className="px-4 py-2 text-sm font-medium rounded-lg text-white"
            style={{
              backgroundColor: canImport ? 'var(--color-primary-600)' : 'var(--color-primary-300)',
              cursor: canImport ? 'pointer' : 'not-allowed',
              opacity: canImport ? 1 : 0.6,
            }}
          >
            {t('settings.importVaultBtn', 'Importer')}
          </button>
        </div>
      </ModalFooter>
    </Modal>
  );
};

export default ImportVaultModal;
