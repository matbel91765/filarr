/**
 * PinOverlay — PIN entry screen
 *
 * Slides up over the ProfilePicker when a PIN-protected profile is selected.
 * 4 circles fill as digits are entered. Shake animation on error.
 * Keyboard input + on-screen numpad for mouse users.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface PinOverlayProps {
  profileName: string;
  avatarColor: string;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
  onForgotPin: () => void;
  allowPinReset?: boolean;
  error?: string | null;
  lockedUntil?: number | null;
  verifying?: boolean;
}

const NUMPAD = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', 'del'],
];

const PinOverlay: React.FC<PinOverlayProps> = ({
  profileName,
  avatarColor,
  onSubmit,
  onCancel,
  onForgotPin,
  allowPinReset = false,
  error,
  lockedUntil,
  verifying,
}) => {
  const { t } = useTranslation();
  const [digits, setDigits] = useState<string[]>([]);
  const [shake, setShake] = useState(false);
  const [lockCountdown, setLockCountdown] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Focus container for keyboard input
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // Shake on error
  useEffect(() => {
    if (error) {
      setShake(true);
      setDigits([]);
      const timer = setTimeout(() => setShake(false), 500);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [error]);

  // Lockout countdown
  useEffect(() => {
    if (!lockedUntil) {
      setLockCountdown(null);
      return;
    }
    const update = () => {
      const remaining = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
      setLockCountdown(remaining > 0 ? remaining : null);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [lockedUntil]);

  const isLocked = lockCountdown !== null && lockCountdown > 0;

  const submitPin = useCallback(() => {
    if (digits.length >= 4 && !isLocked && !verifying) {
      onSubmit(digits.join(''));
    }
  }, [digits, isLocked, verifying, onSubmit]);

  const addDigit = useCallback(
    (d: string) => {
      if (isLocked || verifying) return;
      setDigits((prev) => {
        if (prev.length >= 6) return prev;
        return [...prev, d];
      });
    },
    [isLocked, verifying]
  );

  const removeDigit = useCallback(() => {
    if (isLocked || verifying) return;
    setDigits((prev) => prev.slice(0, -1));
  }, [isLocked, verifying]);

  // Keyboard input
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        addDigit(e.key);
      } else if (e.key === 'Backspace') {
        removeDigit();
      } else if (e.key === 'Enter') {
        submitPin();
      } else if (e.key === 'Escape') {
        onCancel();
      }
    },
    [addDigit, removeDigit, submitPin, onCancel]
  );

  const initials = profileName.trim().charAt(0).toUpperCase();

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    // chrome:free — ecran centre, aucun controle dans la bande haute.
      className="fixed inset-0 z-50 flex items-center justify-center
        bg-[var(--color-background)] animate-slideUp outline-none"
      style={{
        animation: 'slideUp 300ms ease-out forwards',
      }}
    >
      <div className="flex flex-col items-center gap-6 max-w-sm w-full px-6">
        {/* Avatar */}
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center shadow-md"
          style={{
            background: `linear-gradient(135deg, ${avatarColor}, ${avatarColor}88)`,
          }}
        >
          <span className="text-white text-xl font-bold">{initials}</span>
        </div>

        <p className="text-base font-semibold text-[var(--color-text-primary)]">{profileName}</p>

        {/* PIN dots (4-6 digits) */}
        <div className={`flex gap-3 ${shake ? 'animate-shake' : ''}`}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className={`w-3.5 h-3.5 rounded-full border-2 transition-all duration-150
                ${i >= 4 ? 'opacity-40' : ''}`}
              style={{
                borderColor: error ? 'var(--color-error-500)' : 'var(--color-border-strong)',
                backgroundColor:
                  i < digits.length
                    ? error
                      ? 'var(--color-error-500)'
                      : 'var(--color-primary-600)'
                    : 'transparent',
              }}
            />
          ))}
        </div>

        {/* Error / Lock message */}
        {isLocked && (
          <p className="text-sm text-[var(--color-error-500)] text-center">
            {t('profiles.pinLockedFor', { seconds: lockCountdown })}
          </p>
        )}
        {error && !isLocked && (
          <p className="text-sm text-[var(--color-error-500)] text-center">
            {t('profiles.incorrectPin')}
          </p>
        )}

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-3 mt-2">
          {NUMPAD.flat().map((key, idx) => {
            if (key === '') return <div key={idx} />;
            if (key === 'del') {
              return (
                <button
                  key={idx}
                  onClick={removeDigit}
                  disabled={isLocked || verifying}
                  className="w-16 h-16 rounded-full flex items-center justify-center
                    text-[var(--color-text-secondary)]
                    hover:bg-[var(--color-surface-hover)]
                    transition-colors duration-150
                    disabled:opacity-40"
                  aria-label={t('profiles.delete')}
                >
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" />
                    <line x1="18" y1="9" x2="12" y2="15" />
                    <line x1="12" y1="9" x2="18" y2="15" />
                  </svg>
                </button>
              );
            }
            return (
              <button
                key={idx}
                onClick={() => addDigit(key)}
                disabled={isLocked || verifying}
                className="w-16 h-16 rounded-full flex items-center justify-center
                  text-xl font-medium text-[var(--color-text-primary)]
                  bg-[var(--color-surface)]
                  hover:bg-[var(--color-surface-hover)]
                  active:bg-[var(--color-surface-active)]
                  transition-colors duration-150
                  disabled:opacity-40"
              >
                {key}
              </button>
            );
          })}
        </div>

        {/* Submit button */}
        <button
          onClick={submitPin}
          disabled={digits.length < 4 || isLocked || verifying}
          className="w-full max-w-[224px] py-2.5 rounded-xl text-sm font-medium text-white
            bg-[var(--color-primary-600)] hover:bg-[var(--color-primary-700)]
            disabled:opacity-30 disabled:cursor-not-allowed
            transition-colors duration-150"
        >
          {verifying ? t('profiles.verifying', 'Verification...') : t('pin.unlock')}
        </button>

        {/* Forgot PIN (only if reset is enabled) */}
        {allowPinReset && (
          <button
            onClick={onForgotPin}
            className="text-sm text-[var(--color-primary-600)] hover:text-[var(--color-primary-700)]
              transition-colors mt-2"
          >
            {t('profiles.forgotPin')}
          </button>
        )}

        {/* Back */}
        <button
          onClick={onCancel}
          className="text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]
            transition-colors"
        >
          {t('profiles.backToProfiles')}
        </button>
      </div>

      {/* Inline animation keyframes */}
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-shake {
          animation: shake 400ms ease-out;
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
      `}</style>
    </div>
  );
};

export default PinOverlay;
