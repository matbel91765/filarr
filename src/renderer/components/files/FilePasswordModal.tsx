/**
 * FilePasswordModal Component
 *
 * Modal pour gerer les mots de passe sur les fichiers et dossiers individuels.
 * Permet de:
 * - Definir un mot de passe sur un fichier/dossier
 * - Deverrouiller un fichier/dossier protege
 * - Modifier le mot de passe existant
 * - Ajouter un indice de mot de passe
 * - Afficher un indicateur de force du mot de passe
 */

import React, { useState, useEffect, useRef, useMemo, FC, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../ui/Modal/Modal';
import { Input } from '../ui/Input/Input';
import { Button } from '../ui/Button/Button';
import { ProgressBar } from '../ui/ProgressBar/ProgressBar';
import './FilePasswordModal.css';

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

// ==================== TYPES ====================

export type FilePasswordMode = 'set' | 'unlock' | 'change' | 'remove';

export interface FilePasswordModalProps {
  /** Modal ouvert ou ferme */
  isOpen: boolean;
  /** Callback de fermeture */
  onClose: () => void;
  /** Mode du modal */
  mode: FilePasswordMode;
  /** Callback de confirmation */
  onConfirm: (data: FilePasswordResult) => Promise<void>;
  /** Nom du fichier/dossier */
  itemName: string;
  /** Type de l'element (fichier ou dossier) */
  itemType: 'file' | 'folder';
  /** Indice de mot de passe existant (pour le mode unlock) */
  existingHint?: string;
  /** Duree de session en minutes (pour le mode unlock) */
  sessionDuration?: number;
  /** Nombre de tentatives maximum (pour le mode unlock) */
  maxAttempts?: number;
}

export interface FilePasswordResult {
  password: string;
  hint?: string;
  sessionDuration?: number; // en minutes
}

// Session cache for unlocked items
interface UnlockedSession {
  itemId: string;
  expiresAt: number;
}

// Module-level session storage
const unlockedSessions: Map<string, UnlockedSession> = new Map();

// ==================== ICONS ====================

const LockClosedIcon: FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="24" height="24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
  </svg>
);

const LockOpenIcon: FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="24" height="24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
  </svg>
);

const KeyIcon: FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="24" height="24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
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

const TrashIcon: FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="24" height="24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
  </svg>
);

const ClockIcon: FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="16" height="16">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

// ==================== SESSION MANAGEMENT ====================

/**
 * Verifie si un element est deverrouille en session
 */
export const isItemUnlocked = (itemId: string): boolean => {
  const session = unlockedSessions.get(itemId);
  if (!session) return false;

  if (Date.now() > session.expiresAt) {
    unlockedSessions.delete(itemId);
    return false;
  }

  return true;
};

/**
 * Deverrouille un element pour une duree de session
 */
export const unlockItemSession = (itemId: string, durationMinutes: number): void => {
  const expiresAt = Date.now() + durationMinutes * 60 * 1000;
  unlockedSessions.set(itemId, { itemId, expiresAt });
};

/**
 * Verrouille un element (supprime la session)
 */
export const lockItemSession = (itemId: string): void => {
  unlockedSessions.delete(itemId);
};

/**
 * Nettoie les sessions expirees
 */
export const cleanupExpiredSessions = (): void => {
  const now = Date.now();
  for (const [itemId, session] of unlockedSessions) {
    if (now > session.expiresAt) {
      unlockedSessions.delete(itemId);
    }
  }
};

// Cleanup timer
let cleanupTimer: NodeJS.Timeout | null = null;
if (typeof window !== 'undefined') {
  cleanupTimer = setInterval(cleanupExpiredSessions, 60000); // Check every minute
}

// ==================== COMPONENT ====================

export const FilePasswordModal: FC<FilePasswordModalProps> = ({
  isOpen,
  onClose,
  mode,
  onConfirm,
  itemName,
  itemType,
  existingHint,
  sessionDuration = 30,
  maxAttempts = 5,
}) => {
  const { t } = useTranslation();

  // State
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [hint, setHint] = useState('');
  const [selectedDuration, setSelectedDuration] = useState(sessionDuration);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [showHint, setShowHint] = useState(false);

  // Refs
  const inputRef = useRef<HTMLInputElement>(null);

  // Password strength
  const passwordStrength = useMemo(() => {
    if (mode === 'unlock' || mode === 'remove') return null;
    return calculatePasswordStrength(password);
  }, [password, mode]);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Reset state when modal closes or mode changes
  useEffect(() => {
    if (!isOpen) {
      setPassword('');
      setConfirmPassword('');
      setCurrentPassword('');
      setHint('');
      setShowPassword(false);
      setShowConfirmPassword(false);
      setError(null);
      setAttempts(0);
      setShowHint(false);
    }
  }, [isOpen]);

  // Get modal title based on mode
  const getTitle = (): string => {
    switch (mode) {
      case 'set':
        return t('password.protectWithPassword');
      case 'unlock':
        return t('password.unlock');
      case 'change':
        return t('password.changePassword');
      case 'remove':
        return t('password.removeProtection');
      default:
        return t('password.password');
    }
  };

  // Get icon based on mode
  const getIcon = (): React.ReactNode => {
    switch (mode) {
      case 'set':
        return <LockClosedIcon />;
      case 'unlock':
        return <LockOpenIcon />;
      case 'change':
        return <KeyIcon />;
      case 'remove':
        return <TrashIcon />;
      default:
        return <LockClosedIcon />;
    }
  };

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

  // Session duration options
  const durationOptions = [
    { value: 5, label: t('password.duration5min') },
    { value: 15, label: t('password.duration15min') },
    { value: 30, label: t('password.duration30min') },
    { value: 60, label: t('password.duration1hour') },
    { value: 120, label: t('password.duration2hours') },
    { value: 480, label: t('password.duration8hours') },
  ];

  // Validate form
  const isFormValid = (): boolean => {
    switch (mode) {
      case 'set':
        return (
          password.length >= 4 &&
          password === confirmPassword &&
          (passwordStrength?.score || 0) >= 40
        );
      case 'unlock':
        return password.length >= 1;
      case 'change':
        return (
          currentPassword.length >= 1 &&
          password.length >= 4 &&
          password === confirmPassword &&
          (passwordStrength?.score || 0) >= 40
        );
      case 'remove':
        return currentPassword.length >= 1;
      default:
        return false;
    }
  };

  // Handle submit
  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();

    if (!isFormValid() || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const result: FilePasswordResult = {
        password: mode === 'unlock' || mode === 'remove' ? password || currentPassword : password,
        hint: mode === 'set' || mode === 'change' ? hint : undefined,
        sessionDuration: mode === 'unlock' ? selectedDuration : undefined,
      };

      await onConfirm(result);
      handleClose();
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);

      if (mode === 'unlock' && newAttempts >= maxAttempts) {
        setError(t('password.tooManyAttempts'));
      } else {
        setError(errMsg || t('password.incorrect'));
      }
    } finally {
      setIsLoading(false);
      if (mode === 'unlock' || mode === 'remove') {
        setPassword('');
        setCurrentPassword('');
      }
    }
  };

  // Handle close
  const handleClose = () => {
    if (!isLoading) {
      onClose();
    }
  };

  // Render password input with toggle
  const renderPasswordInput = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    show: boolean,
    onToggle: () => void,
    placeholder: string = '',
    inputRefProp?: React.RefObject<HTMLInputElement>,
    errorText?: string
  ) => (
    <div className="file-password__input-wrapper">
      <Input
        ref={inputRefProp}
        type={show ? 'text' : 'password'}
        label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (error) setError(null);
        }}
        error={errorText}
        disabled={isLoading}
        fullWidth
        rightIcon={
          <button
            type="button"
            className="file-password__visibility-toggle"
            onClick={onToggle}
            disabled={isLoading}
            aria-label={show ? t('password.hide') : t('password.show')}
          >
            {show ? <EyeSlashIcon /> : <EyeIcon />}
          </button>
        }
      />
    </div>
  );

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="sm" closeOnEsc={!isLoading}>
      <ModalHeader onClose={handleClose} showCloseButton={!isLoading}>
        {getTitle()}
      </ModalHeader>

      <ModalBody>
        <div className="file-password">
          {/* Header */}
          <div className="file-password__header">
            <div className="file-password__icon">{getIcon()}</div>
            <div className="file-password__info">
              <h4 className="file-password__item-name" title={itemName}>
                {itemName}
              </h4>
              <p className="file-password__item-type">
                {itemType === 'folder' ? t('password.folder') : t('password.file')}
              </p>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="file-password__form">
            {/* Set Password Mode */}
            {mode === 'set' && (
              <>
                {renderPasswordInput(
                  t('password.password'),
                  password,
                  setPassword,
                  showPassword,
                  () => setShowPassword(!showPassword),
                  t('password.minChars'),
                  inputRef
                )}

                {password && passwordStrength && (
                  <div className="file-password__strength">
                    <ProgressBar
                      value={passwordStrength.score}
                      variant={getStrengthColor(passwordStrength.score)}
                      size="sm"
                      label={t('password.strength', { level: getStrengthLabel(passwordStrength.score) })}
                      showValue
                    />
                  </div>
                )}

                {renderPasswordInput(
                  t('password.confirmPassword'),
                  confirmPassword,
                  setConfirmPassword,
                  showConfirmPassword,
                  () => setShowConfirmPassword(!showConfirmPassword),
                  t('password.repeatPassword'),
                  undefined,
                  confirmPassword && password !== confirmPassword
                    ? t('password.mismatch')
                    : undefined
                )}

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
              </>
            )}

            {/* Unlock Mode */}
            {mode === 'unlock' && (
              <>
                {renderPasswordInput(
                  t('password.password'),
                  password,
                  setPassword,
                  showPassword,
                  () => setShowPassword(!showPassword),
                  t('password.enterPassword'),
                  inputRef,
                  error || undefined
                )}

                {existingHint && (
                  <div className="file-password__hint">
                    <button
                      type="button"
                      className="file-password__hint-toggle"
                      onClick={() => setShowHint(!showHint)}
                    >
                      <LightBulbIcon />
                      {showHint ? t('password.hideHint') : t('password.showHint')}
                    </button>
                    {showHint && (
                      <p className="file-password__hint-text">{existingHint}</p>
                    )}
                  </div>
                )}

                <div className="file-password__session">
                  <label className="file-password__session-label">
                    <ClockIcon />
                    {t('password.keepUnlocked')}
                  </label>
                  <div className="file-password__duration-options">
                    {durationOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`file-password__duration-option ${
                          selectedDuration === option.value ? 'active' : ''
                        }`}
                        onClick={() => setSelectedDuration(option.value)}
                        disabled={isLoading}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {attempts > 0 && attempts < maxAttempts && (
                  <p className="file-password__attempts-warning">
                    {t('password.attemptsRemaining', { count: maxAttempts - attempts })}
                  </p>
                )}
              </>
            )}

            {/* Change Password Mode */}
            {mode === 'change' && (
              <>
                {renderPasswordInput(
                  t('password.currentPassword'),
                  currentPassword,
                  setCurrentPassword,
                  false,
                  () => {},
                  t('password.enterCurrentPassword'),
                  inputRef,
                  error || undefined
                )}

                {renderPasswordInput(
                  t('password.newPassword'),
                  password,
                  setPassword,
                  showPassword,
                  () => setShowPassword(!showPassword),
                  t('password.minChars')
                )}

                {password && passwordStrength && (
                  <div className="file-password__strength">
                    <ProgressBar
                      value={passwordStrength.score}
                      variant={getStrengthColor(passwordStrength.score)}
                      size="sm"
                      label={t('password.strength', { level: getStrengthLabel(passwordStrength.score) })}
                      showValue
                    />
                  </div>
                )}

                {renderPasswordInput(
                  t('password.confirmNewPassword'),
                  confirmPassword,
                  setConfirmPassword,
                  showConfirmPassword,
                  () => setShowConfirmPassword(!showConfirmPassword),
                  t('password.repeatNewPassword'),
                  undefined,
                  confirmPassword && password !== confirmPassword
                    ? t('password.mismatch')
                    : undefined
                )}

                <Input
                  label={t('password.newHintOptional')}
                  placeholder={t('password.hintHelper')}
                  value={hint}
                  onChange={(e) => setHint(e.target.value)}
                  disabled={isLoading}
                  fullWidth
                  leftIcon={<LightBulbIcon />}
                />
              </>
            )}

            {/* Remove Protection Mode */}
            {mode === 'remove' && (
              <>
                <p className="file-password__warning">
                  {t('password.removeWarning')}
                </p>

                {renderPasswordInput(
                  t('password.currentPassword'),
                  currentPassword,
                  setCurrentPassword,
                  showPassword,
                  () => setShowPassword(!showPassword),
                  t('password.enterPassword'),
                  inputRef,
                  error || undefined
                )}
              </>
            )}
          </form>
        </div>
      </ModalBody>

      <ModalFooter>
        <Button variant="ghost" onClick={handleClose} disabled={isLoading}>
          {t('common.cancel')}
        </Button>
        <Button
          variant={mode === 'remove' ? 'danger' : 'primary'}
          onClick={handleSubmit}
          disabled={!isFormValid() || isLoading || (mode === 'unlock' && attempts >= maxAttempts)}
          loading={isLoading}
        >
          {mode === 'set' && t('password.protect')}
          {mode === 'unlock' && t('password.unlock')}
          {mode === 'change' && t('password.change')}
          {mode === 'remove' && t('password.removeProtection')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default FilePasswordModal;
