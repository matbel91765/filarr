/**
 * FolderPasswordModal Component
 *
 * Modal specifically for setting password protection on folders.
 * Extends the functionality of FilePasswordModal with folder-specific options:
 * - Apply password to all folder contents
 * - Recursive protection option
 */

import React, { FC, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../ui/Modal/Modal';
import { Input } from '../ui/Input/Input';
import { Button } from '../ui/Button/Button';
import { ProgressBar } from '../ui/ProgressBar/ProgressBar';
import { Checkbox } from '../ui/Checkbox/Checkbox';
import {
  setPassword,
  removePassword,
  verifyPassword,
  isProtected,
  protectFolderContents,
  unprotectFolderContents,
  changePassword,
} from '../../../services/auth/filePasswordService';

// Inline password strength calculator (vaultService removed)
function calculatePasswordStrength(password: string): { score: number } {
  let score = 0;
  if (password.length >= 4) score += 20;
  if (password.length >= 8) score += 20;
  if (/[A-Z]/.test(password)) score += 15;
  if (/[a-z]/.test(password)) score += 15;
  if (/[0-9]/.test(password)) score += 15;
  if (/[^A-Za-z0-9]/.test(password)) score += 15;
  return { score: Math.min(100, score) };
}

// SVG Icons
const FolderLockIcon: FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="24" height="24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10.5v3m0 0v3m0-3h3m-3 0H9" />
  </svg>
);

const EyeIcon: FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="20" height="20">
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const EyeSlashIcon: FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="20" height="20">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
  </svg>
);

const LightBulbIcon: FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="16" height="16">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
  </svg>
);

const InfoIcon: FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="16" height="16">
    <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
  </svg>
);

export interface FolderPasswordModalProps {
  /** Modal ouvert ou ferme */
  isOpen: boolean;
  /** Callback de fermeture */
  onClose: () => void;
  /** ID du dossier */
  folderId: string;
  /** Nom du dossier */
  folderName: string;
  /** IDs des elements enfants du dossier */
  childItemIds: string[];
  /** Callback when password is set/removed */
  onPasswordChange?: (folderId: string, isProtected: boolean, appliedToContents: boolean) => void;
}

export const FolderPasswordModal: FC<FolderPasswordModalProps> = ({
  isOpen,
  onClose,
  folderId,
  folderName,
  childItemIds,
  onPasswordChange,
}) => {
  const { t } = useTranslation();

  // State
  const [password, setPasswordValue] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [hint, setHint] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [applyToContents, setApplyToContents] = useState(true);
  const [alreadyProtected, setAlreadyProtected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removePasswordInput, setRemovePasswordInput] = useState('');
  const [showRemovePassword, setShowRemovePassword] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // Password strength
  const passwordStrength = password ? calculatePasswordStrength(password) : null;

  // Check if folder is already protected
  useEffect(() => {
    if (isOpen && folderId) {
      setAlreadyProtected(isProtected(folderId));
    }
  }, [isOpen, folderId]);

  // Reset form when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setPasswordValue('');
      setConfirmPassword('');
      setCurrentPassword('');
      setShowCurrentPassword(false);
      setHint('');
      setShowPassword(false);
      setShowConfirmPassword(false);
      setApplyToContents(true);
      setError(null);
      setRemovePasswordInput('');
      setShowRemovePassword(false);
      setRemoveError(null);
    }
  }, [isOpen]);

  // Get strength color
  const getStrengthColor = (score: number): 'error' | 'warning' | 'primary' | 'success' => {
    if (score < 40) return 'error';
    if (score < 60) return 'warning';
    if (score < 80) return 'primary';
    return 'success';
  };

  // Get strength label
  const getStrengthLabel = (score: number): string => {
    if (score < 40) return t('password.weak');
    if (score < 60) return t('password.medium');
    if (score < 80) return t('password.good');
    return t('password.excellent');
  };

  // Validate form
  const isFormValid = useCallback(() => {
    if (alreadyProtected && !currentPassword) return false;
    if (!password) return false;
    if (password !== confirmPassword) return false;
    if (password.length < 4) return false;
    if (passwordStrength && passwordStrength.score < 40) return false;
    return true;
  }, [password, confirmPassword, passwordStrength, alreadyProtected, currentPassword]);

  // Handle setting password
  const handleSetPassword = useCallback(async () => {
    if (!isFormValid()) return;

    setIsLoading(true);
    setError(null);

    try {
      // If already protected, verify current password first
      if (alreadyProtected) {
        const isValid = await verifyPassword(folderId, currentPassword);
        if (!isValid) {
          setError(t('password.currentPasswordIncorrect'));
          setCurrentPassword('');
          setIsLoading(false);
          return;
        }
      }

      if (applyToContents && childItemIds.length > 0) {
        // Protect folder and all contents
        await protectFolderContents(folderId, password, childItemIds, hint || undefined);
      } else {
        // Only protect the folder itself
        await setPassword(folderId, 'folder', password, hint || undefined);
      }

      onPasswordChange?.(folderId, true, applyToContents);
      onClose();
    } catch (err) {
      console.error('[FolderPasswordModal] Error setting password:', err);
      setError(t('password.cannotProtectFolder'));
    } finally {
      setIsLoading(false);
    }
  }, [folderId, password, hint, currentPassword, alreadyProtected, applyToContents, childItemIds, isFormValid, onPasswordChange, onClose]);

  // Handle removing password (requires current password verification)
  const handleRemovePassword = useCallback(async () => {
    if (!removePasswordInput) {
      setRemoveError(t('password.pleaseEnterCurrentPassword'));
      return;
    }

    setIsLoading(true);
    setRemoveError(null);

    try {
      const isValid = await verifyPassword(folderId, removePasswordInput);

      if (!isValid) {
        setRemoveError(t('password.incorrect'));
        setRemovePasswordInput('');
        setIsLoading(false);
        return;
      }

      if (applyToContents && childItemIds.length > 0) {
        unprotectFolderContents(folderId, childItemIds);
      } else {
        removePassword(folderId);
      }

      onPasswordChange?.(folderId, false, applyToContents);
      onClose();
    } catch (err) {
      console.error('[FolderPasswordModal] Error removing password:', err);
      setRemoveError(t('password.cannotRemoveProtection'));
    } finally {
      setIsLoading(false);
    }
  }, [folderId, removePasswordInput, applyToContents, childItemIds, onPasswordChange, onClose]);

  // Visibility toggle button helper
  const VisibilityToggle: FC<{ show: boolean; onToggle: () => void }> = ({ show, onToggle }) => (
    <button
      type="button"
      className="flex items-center justify-center p-0 bg-transparent border-none cursor-pointer
        text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]
        transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
      onClick={onToggle}
      disabled={isLoading}
      aria-label={show ? t('password.hide') : t('password.show')}
    >
      {show ? <EyeSlashIcon /> : <EyeIcon />}
    </button>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm" closeOnEsc={!isLoading}>
      <ModalHeader onClose={onClose} showCloseButton={!isLoading}>
        {alreadyProtected ? t('password.manageFolderProtection') : t('password.protectFolder')}
      </ModalHeader>

      <ModalBody>
        <div className="flex flex-col gap-5">
          {/* Header */}
          <div className="flex items-center gap-4 px-4 py-3 bg-[var(--color-background-secondary)] rounded-lg border border-[var(--color-border)]">
            <div className="flex items-center justify-center w-12 h-12 rounded-xl shrink-0
              bg-[var(--color-primary-50)] text-[var(--color-primary-500)]">
              <FolderLockIcon />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="m-0 text-sm font-semibold text-[var(--color-text-primary)] truncate" title={folderName}>
                {folderName}
              </h4>
              <p className="mt-1 mb-0 text-xs text-[var(--color-text-secondary)]">
                {t('password.itemsInFolder', { count: childItemIds.length })}
              </p>
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="px-3 py-2.5 text-sm rounded-lg bg-red-50 border border-red-200 text-red-600">
              {error}
            </div>
          )}

          {/* Already protected warning */}
          {alreadyProtected && (
            <div className="flex flex-col gap-3 p-4 rounded-lg bg-amber-50 border border-amber-300">
              <p className="m-0 text-sm text-amber-700">
                {t('password.folderCurrentlyProtected')}
              </p>
              <div className="flex flex-col gap-2.5">
                <Input
                  type={showRemovePassword ? 'text' : 'password'}
                  placeholder={t('password.currentPassword')}
                  value={removePasswordInput}
                  onChange={(e) => {
                    setRemovePasswordInput(e.target.value);
                    if (removeError) setRemoveError(null);
                  }}
                  error={removeError || undefined}
                  disabled={isLoading}
                  fullWidth
                  rightIcon={
                    <VisibilityToggle
                      show={showRemovePassword}
                      onToggle={() => setShowRemovePassword(!showRemovePassword)}
                    />
                  }
                />
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleRemovePassword}
                  disabled={isLoading || !removePasswordInput}
                  loading={isLoading}
                >
                  {t('password.removeProtection')}
                </Button>
              </div>
            </div>
          )}

          {/* Form */}
          <div className="flex flex-col gap-4">
            {/* Current password field (required when modifying) */}
            {alreadyProtected && (
              <div className="flex flex-col gap-2">
                <Input
                  type={showCurrentPassword ? 'text' : 'password'}
                  label={t('password.currentPassword')}
                  placeholder={t('password.enterCurrentPassword')}
                  value={currentPassword}
                  onChange={(e) => {
                    setCurrentPassword(e.target.value);
                    if (error) setError(null);
                  }}
                  disabled={isLoading}
                  fullWidth
                  rightIcon={
                    <VisibilityToggle
                      show={showCurrentPassword}
                      onToggle={() => setShowCurrentPassword(!showCurrentPassword)}
                    />
                  }
                />
              </div>
            )}

            {/* Password field */}
            <div className="flex flex-col gap-2">
              <Input
                type={showPassword ? 'text' : 'password'}
                label={alreadyProtected ? t('password.newPassword') : t('password.password')}
                placeholder={t('password.minChars')}
                value={password}
                onChange={(e) => {
                  setPasswordValue(e.target.value);
                  if (error) setError(null);
                }}
                disabled={isLoading}
                fullWidth
                rightIcon={
                  <VisibilityToggle
                    show={showPassword}
                    onToggle={() => setShowPassword(!showPassword)}
                  />
                }
              />

              {password && passwordStrength && (
                <div className="-mt-1">
                  <ProgressBar
                    value={passwordStrength.score}
                    variant={getStrengthColor(passwordStrength.score)}
                    size="sm"
                    label={t('password.strength', { level: getStrengthLabel(passwordStrength.score) })}
                    showValue
                  />
                </div>
              )}
            </div>

            {/* Confirm password field */}
            <div className="flex flex-col gap-2">
              <Input
                type={showConfirmPassword ? 'text' : 'password'}
                label={t('password.confirmPassword')}
                placeholder={t('password.repeatPassword')}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                error={
                  confirmPassword && password !== confirmPassword
                    ? t('password.mismatch')
                    : undefined
                }
                disabled={isLoading}
                fullWidth
                rightIcon={
                  <VisibilityToggle
                    show={showConfirmPassword}
                    onToggle={() => setShowConfirmPassword(!showConfirmPassword)}
                  />
                }
              />
            </div>

            {/* Hint field */}
            <div className="flex flex-col gap-2">
              <Input
                label={t('password.hintOptional')}
                placeholder={t('password.hintPlaceholder')}
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                disabled={isLoading}
                fullWidth
                leftIcon={<LightBulbIcon />}
                helperText={t('password.hintHelp')}
              />
            </div>

            {/* Apply to contents option */}
            {childItemIds.length > 0 && (
              <div className="flex flex-col gap-2 p-4 rounded-lg bg-[var(--color-background-secondary)] border border-[var(--color-border)]">
                <Checkbox
                  id="apply-to-contents"
                  checked={applyToContents}
                  onChange={(e) => setApplyToContents(e.target.checked)}
                  disabled={isLoading}
                  label={t('password.applyToAllItems')}
                />
                <div className="flex items-start gap-2 pl-7 text-xs text-[var(--color-text-tertiary)]">
                  <span className="shrink-0 mt-0.5 text-[var(--color-primary-500)]">
                    <InfoIcon />
                  </span>
                  <span>
                    {applyToContents
                      ? t('password.passwordWillApplyToItems', { count: childItemIds.length })
                      : t('password.onlyFolderProtected')}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </ModalBody>

      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={isLoading}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          onClick={handleSetPassword}
          disabled={!isFormValid() || isLoading}
          loading={isLoading}
        >
          {alreadyProtected ? t('password.changePassword') : t('password.protectFolder')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default FolderPasswordModal;
