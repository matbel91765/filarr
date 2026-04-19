/**
 * PasswordUnlockModal Component
 *
 * A streamlined modal for unlocking password-protected files/folders.
 * Features:
 * - Password input
 * - Remember for session option
 * - Hint display
 * - Wrong password feedback with attempt tracking
 */

import React, { FC, useState, useCallback, useEffect, useRef } from 'react';
import clsx from 'clsx';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../ui/Modal/Modal';
import { Input } from '../ui/Input/Input';
import { Button } from '../ui/Button/Button';
import { Checkbox } from '../ui/Checkbox/Checkbox';
import {
  verifyPassword,
  unlockForSession,
  getPasswordHint,
  isUnlockedForSession,
} from '../../../services/auth/filePasswordService';
import './PasswordUnlockModal.css';

// SVG Icons
const LockIcon: FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="32" height="32">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
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

const WarningIcon: FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="20" height="20">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
  </svg>
);

// Session duration options (in milliseconds)
const SESSION_DURATIONS = {
  short: 5 * 60 * 1000,      // 5 minutes
  medium: 30 * 60 * 1000,    // 30 minutes
  long: 2 * 60 * 60 * 1000,  // 2 hours
  session: null,             // Until browser close
};

export interface PasswordUnlockModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal is closed */
  onClose: () => void;
  /** Item ID to unlock */
  itemId: string;
  /** Item name for display */
  itemName: string;
  /** Item type (file or folder) */
  itemType: 'file' | 'folder';
  /** Callback when item is successfully unlocked */
  onUnlock?: (itemId: string) => void;
  /** Maximum unlock attempts */
  maxAttempts?: number;
}

export const PasswordUnlockModal: FC<PasswordUnlockModalProps> = ({
  isOpen,
  onClose,
  itemId,
  itemName,
  itemType,
  onUnlock,
  maxAttempts = 5,
}) => {
  // State
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberSession, setRememberSession] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

  // Refs
  const inputRef = useRef<HTMLInputElement>(null);

  // Load hint on open
  useEffect(() => {
    if (isOpen && itemId) {
      const passwordHint = getPasswordHint(itemId);
      setHint(passwordHint);

      // Check if already unlocked
      if (isUnlockedForSession(itemId)) {
        onUnlock?.(itemId);
        onClose();
      }
    }
  }, [isOpen, itemId, onUnlock, onClose]);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current && !isLocked) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, isLocked]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setPassword('');
      setShowPassword(false);
      setError(null);
      setShowHint(false);
      // Don't reset attempts - they should persist within a session
    }
  }, [isOpen]);

  // Check if too many attempts
  useEffect(() => {
    if (attempts >= maxAttempts) {
      setIsLocked(true);
      setError(`Trop de tentatives. Veuillez attendre avant de reessayer.`);

      // Unlock after 30 seconds
      const timer = setTimeout(() => {
        setIsLocked(false);
        setAttempts(0);
        setError(null);
      }, 30000);

      return () => clearTimeout(timer);
    }
    return undefined;
  }, [attempts, maxAttempts]);

  // Handle unlock
  const handleUnlock = useCallback(async () => {
    if (!password || isLoading || isLocked) return;

    setIsLoading(true);
    setError(null);

    try {
      const isValid = await verifyPassword(itemId, password);

      if (isValid) {
        // Unlock for session
        if (rememberSession) {
          unlockForSession(itemId, SESSION_DURATIONS.medium || undefined);
        }

        onUnlock?.(itemId);
        onClose();
      } else {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);

        if (newAttempts >= maxAttempts) {
          setError('Trop de tentatives. Veuillez attendre 30 secondes.');
        } else {
          setError(`Mot de passe incorrect. ${maxAttempts - newAttempts} tentative${maxAttempts - newAttempts > 1 ? 's' : ''} restante${maxAttempts - newAttempts > 1 ? 's' : ''}.`);
        }

        setPassword('');
      }
    } catch (err) {
      console.error('[PasswordUnlockModal] Error verifying password:', err);
      setError('Une erreur est survenue. Veuillez reessayer.');
    } finally {
      setIsLoading(false);
    }
  }, [itemId, password, rememberSession, attempts, maxAttempts, isLoading, isLocked, onUnlock, onClose]);

  // Handle form submit
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleUnlock();
  };

  // Handle key down
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isLoading && !isLocked && password) {
      handleUnlock();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm" closeOnEsc={!isLoading}>
      <ModalHeader onClose={onClose} showCloseButton={!isLoading}>
        Deverrouiller {itemType === 'folder' ? 'le dossier' : 'le fichier'}
      </ModalHeader>

      <ModalBody>
        <form onSubmit={handleSubmit} className="password-unlock">
          {/* Lock icon and item name */}
          <div className="password-unlock__header">
            <div className={clsx('password-unlock__icon', { 'password-unlock__icon--error': error })}>
              <LockIcon />
            </div>
            <h4 className="password-unlock__item-name" title={itemName}>
              {itemName}
            </h4>
            <p className="password-unlock__description">
              Ce {itemType === 'folder' ? 'dossier' : 'fichier'} est protege par un mot de passe.
            </p>
          </div>

          {/* Error message */}
          {error && (
            <div className="password-unlock__error">
              <WarningIcon />
              <span>{error}</span>
            </div>
          )}

          {/* Password input */}
          <div className="password-unlock__field">
            <Input
              ref={inputRef}
              type={showPassword ? 'text' : 'password'}
              placeholder="Entrez le mot de passe"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error && attempts < maxAttempts) setError(null);
              }}
              onKeyDown={handleKeyDown}
              disabled={isLoading || isLocked}
              fullWidth
              rightIcon={
                <button
                  type="button"
                  className="password-unlock__visibility-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={isLoading || isLocked}
                  aria-label={showPassword ? 'Masquer' : 'Afficher'}
                >
                  {showPassword ? <EyeSlashIcon /> : <EyeIcon />}
                </button>
              }
            />
          </div>

          {/* Hint toggle */}
          {hint && (
            <div className="password-unlock__hint">
              <button
                type="button"
                className="password-unlock__hint-toggle"
                onClick={() => setShowHint(!showHint)}
                disabled={isLoading}
              >
                <LightBulbIcon />
                {showHint ? 'Masquer l\'indice' : 'Afficher l\'indice'}
              </button>
              {showHint && (
                <p className="password-unlock__hint-text">{hint}</p>
              )}
            </div>
          )}

          {/* Remember for session */}
          <div className="password-unlock__remember">
            <Checkbox
              id="remember-session"
              checked={rememberSession}
              onChange={(e) => setRememberSession(e.target.checked)}
              disabled={isLoading || isLocked}
              label="Garder deverrouille pour cette session"
            />
          </div>
        </form>
      </ModalBody>

      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={isLoading}>
          Annuler
        </Button>
        <Button
          variant="primary"
          onClick={handleUnlock}
          disabled={!password || isLoading || isLocked}
          loading={isLoading}
        >
          Deverrouiller
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default PasswordUnlockModal;
