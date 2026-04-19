/**
 * CreateProfileModal — Create a new profile
 *
 * Name input + color grid + optional PIN setup.
 * Uses the existing Modal component pattern.
 */

import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import { createProfile, fetchManifest } from '../../../store/slices/profilesSlice';
import type { AppDispatch } from '../../../store';
import Modal from '../ui/Modal/Modal';
import { ModalHeader, ModalBody, ModalFooter } from '../ui/Modal/Modal';

const AVATAR_COLORS = [
  '#4682B4',
  '#E74C3C',
  '#2ECC71',
  '#F39C12',
  '#9B59B6',
  '#1ABC9C',
  '#E67E22',
  '#3498DB',
  '#E91E63',
  '#00BCD4',
  '#8BC34A',
  '#FF5722',
];

interface CreateProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (profileId: string) => void;
}

const CreateProfileModal: React.FC<CreateProfileModalProps> = ({ isOpen, onClose, onCreated }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();

  const [name, setName] = useState('');
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0]);
  const [enablePin, setEnablePin] = useState(false);
  const [allowPinReset, setAllowPinReset] = useState(false);
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const reset = useCallback(() => {
    setName('');
    setAvatarColor(AVATAR_COLORS[0]);
    setEnablePin(false);
    setAllowPinReset(false);
    setPin('');
    setPinConfirm('');
    setError(null);
    setCreating(false);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('profiles.errorNameRequired'));
      return;
    }
    if (trimmed.length > 50) {
      setError(t('profiles.errorNameTooLong'));
      return;
    }
    if (enablePin) {
      if (!/^\d{4,6}$/.test(pin)) {
        setError(t('profiles.errorPinFormat'));
        return;
      }
      if (pin !== pinConfirm) {
        setError(t('profiles.errorPinMismatch'));
        return;
      }
    }

    setCreating(true);
    setError(null);

    try {
      const result = await dispatch(
        createProfile({
          name: trimmed,
          avatarColor,
          pin: enablePin ? pin : undefined,
          allowPinReset: enablePin ? allowPinReset : undefined,
        })
      ).unwrap();

      await dispatch(fetchManifest());
      handleClose();
      onCreated?.(result.id);
    } catch (err: any) {
      setError(err?.message || t('profiles.errorCreating'));
      setCreating(false);
    }
  }, [name, avatarColor, enablePin, allowPinReset, pin, pinConfirm, dispatch, handleClose, onCreated, t]);

  const initials = name.trim() ? name.trim().charAt(0).toUpperCase() : '?';

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="md">
      <ModalHeader onClose={handleClose}>{t('profiles.createTitle')}</ModalHeader>

      <ModalBody>
        <div className="flex flex-col gap-6">
          {/* Preview */}
          <div className="flex justify-center">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center shadow-md
                transition-all duration-200"
              style={{
                background: `linear-gradient(135deg, ${avatarColor}, ${avatarColor}88)`,
              }}
            >
              <span className="text-white text-2xl font-bold select-none">{initials}</span>
            </div>
          </div>

          {/* Name input */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1.5">
              {t('profiles.name')}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              autoFocus
              placeholder={t('profiles.namePlaceholder')}
              className="w-full px-3 py-2 rounded-lg text-sm
                bg-[var(--color-background)]
                border border-[var(--color-border)]
                text-[var(--color-text-primary)]
                placeholder:text-[var(--color-text-tertiary)]
                focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]
                focus:border-[var(--color-primary-400)]
                transition-colors"
            />
          </div>

          {/* Color picker */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-2">
              {t('profiles.color')}
            </label>
            <div className="flex flex-wrap gap-2">
              {AVATAR_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => setAvatarColor(color)}
                  className="w-10 h-10 rounded-full border-2 transition-all duration-150
                    hover:scale-110 focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                  style={{
                    backgroundColor: color,
                    borderColor:
                      avatarColor === color ? 'var(--color-text-primary)' : 'transparent',
                    transform: avatarColor === color ? 'scale(1.15)' : undefined,
                  }}
                  aria-label={color}
                >
                  {avatarColor === color && (
                    <svg
                      className="w-5 h-5 mx-auto text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="3"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* PIN toggle */}
          <div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--color-text-secondary)]">
                  {t('profiles.pinProtection')}
                </p>
                <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                  {t('profiles.pinDescription')}
                </p>
              </div>
              <button
                role="switch"
                aria-checked={enablePin}
                onClick={() => {
                  setEnablePin(!enablePin);
                  if (enablePin) {
                    setPin('');
                    setPinConfirm('');
                  }
                }}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full
                  border-2 border-transparent transition-colors duration-200 ease-in-out
                  focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:ring-offset-2
                  ${enablePin ? 'bg-[var(--color-primary-600)]' : 'bg-[var(--color-neutral-300)]'}`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full
                    bg-white shadow-lg transform transition duration-200
                    ${enablePin ? 'translate-x-5' : 'translate-x-0'}`}
                />
              </button>
            </div>

            {enablePin && (
              <>
                <div className="mt-4 flex gap-4">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-[var(--color-text-tertiary)] mb-1">
                      {t('profiles.pinLabel')}
                    </label>
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={6}
                      value={pin}
                      onChange={(e) => {
                        const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                        setPin(v);
                      }}
                      placeholder="----"
                      className="w-full px-3 py-2 rounded-lg text-sm text-center tracking-[0.5em]
                        bg-[var(--color-background)]
                        border border-[var(--color-border)]
                        text-[var(--color-text-primary)]
                        focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]
                        transition-colors"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-[var(--color-text-tertiary)] mb-1">
                      {t('profiles.pinConfirmLabel')}
                    </label>
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={6}
                      value={pinConfirm}
                      onChange={(e) => {
                        const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                        setPinConfirm(v);
                      }}
                      placeholder="----"
                      className="w-full px-3 py-2 rounded-lg text-sm text-center tracking-[0.5em]
                        bg-[var(--color-background)]
                        border border-[var(--color-border)]
                        text-[var(--color-text-primary)]
                        focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]
                        transition-colors"
                    />
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-[var(--color-text-tertiary)]">
                    {t('profiles.allowPinReset')}
                  </p>
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5 opacity-75">
                    {t('profiles.allowPinResetDesc')}
                  </p>
                </div>
                <button
                  role="switch"
                  aria-checked={allowPinReset}
                  onClick={() => setAllowPinReset(!allowPinReset)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full
                    border-2 border-transparent transition-colors duration-200 ease-in-out
                    focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:ring-offset-2
                    ${allowPinReset ? 'bg-[var(--color-primary-600)]' : 'bg-[var(--color-neutral-300)]'}`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 rounded-full
                      bg-white shadow transform transition duration-200
                      ${allowPinReset ? 'translate-x-4' : 'translate-x-0'}`}
                  />
                </button>
                </div>
              </>
            )}
          </div>

          {/* Error */}
          {error && <p className="text-sm text-[var(--color-error-500)] text-center">{error}</p>}
        </div>
      </ModalBody>

      <ModalFooter>
        <button
          onClick={handleClose}
          className="px-4 py-2 rounded-lg text-sm font-medium
            text-[var(--color-text-secondary)]
            hover:bg-[var(--color-surface-hover)]
            transition-colors"
        >
          {t('common.cancel')}
        </button>
        <button
          onClick={handleCreate}
          disabled={creating || !name.trim()}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white
            bg-[var(--color-primary-600)]
            hover:bg-[var(--color-primary-700)]
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors"
        >
          {creating ? t('profiles.creating') : t('profiles.create')}
        </button>
      </ModalFooter>
    </Modal>
  );
};

export default CreateProfileModal;
