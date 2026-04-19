/**
 * PinLockScreen
 *
 * Ecran plein ecran de deverrouillage par PIN (mode local).
 * Affiche le logo, l'avatar utilisateur et un champ PIN.
 */

import React, { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import ProfileAvatar from '../profiles/ProfileAvatar';
import type { RootState, AppDispatch } from '../../../store';
import { unlockApp } from '../../../store/slices/authSlice';
import { tryRestoreFEKFromSafeStorage } from '../../../services/auth/hybridCrypto';

const PIN_LENGTH = 6;
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION = 30000; // 30s

export const PinLockScreen: React.FC = () => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const localProfile = useSelector((state: RootState) => state.auth.localProfile);
  const manifest = useSelector((state: RootState) => state.profiles.manifest);
  const activeProfileMeta = manifest?.profiles.find((p) => p.id === manifest.activeProfileId);

  const [pin, setPin] = useState<string[]>(Array(PIN_LENGTH).fill(''));
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const isLockedOut = lockedUntil !== null && Date.now() < lockedUntil;

  const handleChange = useCallback(
    (index: number, value: string) => {
      if (isLockedOut) return;
      // Only allow digits
      const digit = value.replace(/\D/g, '').slice(-1);
      const newPin = [...pin];
      newPin[index] = digit;
      setPin(newPin);
      setError('');

      if (digit && index < PIN_LENGTH - 1) {
        inputRefs.current[index + 1]?.focus();
      }

      // Auto-submit when all filled
      const fullPin = newPin.join('');
      if (fullPin.length === PIN_LENGTH && newPin.every((d) => d !== '')) {
        handleSubmit(fullPin);
      }
    },
    [pin, isLockedOut]
  );

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent) => {
      if (e.key === 'Backspace' && !pin[index] && index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
    },
    [pin]
  );

  const handleSubmit = useCallback(
    async (fullPin?: string) => {
      const pinValue = fullPin || pin.join('');
      const profileId = activeProfileMeta?.id || manifest?.activeProfileId;
      if (pinValue.length < 4 || !profileId || checking) return;

      setChecking(true);
      try {
        // Verify PIN via main process IPC — hash never leaves the main process
        const result = await window.electron.ipcRenderer.invoke(
          'profile:verifyPin',
          profileId,
          pinValue
        );
        const valid = result?.success === true;
        if (valid) {
          // Restore FEK from .fek_safe (may have been cleared by auto-lock)
          await tryRestoreFEKFromSafeStorage();
          dispatch(unlockApp());
        } else {
          const newAttempts = attempts + 1;
          setAttempts(newAttempts);
          setPin(Array(PIN_LENGTH).fill(''));
          inputRefs.current[0]?.focus();

          if (newAttempts >= MAX_ATTEMPTS) {
            setLockedUntil(Date.now() + LOCKOUT_DURATION);
            setError(t('pin.tooManyAttempts'));
            setTimeout(() => {
              setLockedUntil(null);
              setAttempts(0);
            }, LOCKOUT_DURATION);
          } else {
            setError(t('pin.error'));
          }
        }
      } finally {
        setChecking(false);
      }
    },
    [pin, activeProfileMeta?.id, manifest?.activeProfileId, checking, attempts, dispatch, t]
  );

  const initial = localProfile?.name?.charAt(0)?.toUpperCase() || '?';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--color-background)]">
      <div className="flex flex-col items-center max-w-sm w-full px-6">
        {/* Logo */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="currentColor"
          viewBox="0 0 24 24"
          className="w-12 h-12 text-[var(--color-primary-600)] mb-6"
        >
          <path d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
        </svg>

        {/* Avatar */}
        <ProfileAvatar
          name={localProfile?.name || 'User'}
          avatarColor={localProfile?.avatarColor || '#4682B4'}
          avatarImage={activeProfileMeta?.avatarImage}
          size={64}
          className="mb-3"
        />

        <p className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
          {localProfile?.name || 'User'}
        </p>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-8">{t('pin.subtitle')}</p>

        {/* PIN inputs */}
        <div className="flex gap-3 mb-4">
          {pin.map((digit, i) => (
            <input
              key={i}
              ref={(el) => {
                inputRefs.current[i] = el;
              }}
              type="password"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              disabled={isLockedOut || checking}
              autoFocus={i === 0}
              style={{
                width: 48,
                height: 56,
                textAlign: 'center',
                fontSize: '1.25rem',
                fontWeight: 700,
                borderRadius: 12,
                border: error ? '2px solid #f87171' : '2px solid #9ca3af',
                background: 'var(--color-surface)',
                color: 'var(--color-text-primary)',
                outline: 'none',
                transition: 'border-color 0.15s, box-shadow 0.15s',
                opacity: isLockedOut || checking ? 0.5 : 1,
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-primary-500)';
                e.currentTarget.style.boxShadow = '0 0 0 3px var(--color-primary-400)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = error ? '#f87171' : '#9ca3af';
                e.currentTarget.style.boxShadow = 'none';
              }}
              className={error ? 'animate-[shake_0.3s_ease-in-out]' : ''}
            />
          ))}
        </div>

        {/* Error message */}
        {error && <p className="text-sm text-red-500 mb-4 text-center">{error}</p>}

        {/* Unlock button */}
        <button
          onClick={() => handleSubmit()}
          disabled={pin.filter((d) => d).length < 4 || isLockedOut || checking}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white
            bg-[var(--color-primary-600)] hover:bg-[var(--color-primary-700)]
            disabled:opacity-50 transition-all"
        >
          {checking ? '...' : t('pin.unlock')}
        </button>
      </div>
    </div>
  );
};

export default PinLockScreen;
