/**
 * Onboarding Wizard — Filarr
 *
 * 7-step wizard shown on first launch (local-only):
 * 1. Welcome — splash with feature highlights
 * 2. Profile — name, avatar color, optional PIN
 * 3. Appearance — theme (light/dark/system) + accent color
 * 4. Use Case — personal/student/professional/creative → starter content
 * 5. Discovery — visual tour of 4 app areas
 * 6. Security — encryption warning + checkbox
 * 7. Ready — recap + "Let's go" button
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import { setTheme, setUseSystemTheme } from '../../../store/slices/uiSlice';
import { createProfile, activateProfile } from '../../../store/slices/profilesSlice';
import { createFolder } from '../../../store/slices/foldersSlice';
import { createNewNote } from '../../../store/slices/notesSlice';
import { createTag } from '../../../store/slices/tagsSlice';
import type { AppDispatch } from '../../../store';
import {
  applyAccentColorPalette,
  PRESET_ACCENT_COLORS,
  detectSystemTheme,
} from '../../../services/platform/themeService';
import {
  USE_CASE_OPTIONS,
  STARTER_TEMPLATES,
  DISCOVERY_AREAS,
  getWelcomeNoteContent,
  type UseCase,
} from '../../../services/onboarding/starterTemplates';
import { avatarGradient } from '../../../utils/avatarGradient';
import { FilarrLogo } from '../ui/FilarrLogo';
import './Onboarding.css';

// ==================== Constants ====================

const AVATAR_COLORS = [
  // Blues
  '#4682B4',
  '#3498DB',
  '#2563EB',
  '#1D4ED8',
  '#0EA5E9',
  // Greens
  '#2ECC71',
  '#16A34A',
  '#059669',
  '#1ABC9C',
  '#10B981',
  // Reds / Pinks
  '#E74C3C',
  '#DC2626',
  '#E91E63',
  '#EC4899',
  '#F43F5E',
  // Oranges / Yellows
  '#F39C12',
  '#E67E22',
  '#FF5722',
  '#F59E0B',
  '#EAB308',
  // Purples
  '#9B59B6',
  '#8B5CF6',
  '#7C3AED',
  '#A855F7',
  '#6366F1',
  // Teals / Cyans
  '#00BCD4',
  '#06B6D4',
  '#14B8A6',
  '#0D9488',
  // Neutrals
  '#64748B',
  '#475569',
  '#78716C',
  '#6B7280',
];

type StepId =
  | 'welcome'
  | 'profile'
  | 'appearance'
  | 'usecase'
  | 'discovery'
  | 'security'
  | 'ready';

const LOCAL_STEPS: StepId[] = [
  'welcome',
  'profile',
  'appearance',
  'usecase',
  'discovery',
  'security',
  'ready',
];

// ==================== State ====================

// BIP-39 inspired recovery word list (simplified — 128 common words)
const RECOVERY_WORDS = [
  'apple',
  'arrow',
  'beach',
  'blade',
  'bloom',
  'brave',
  'bread',
  'brick',
  'brush',
  'cabin',
  'candy',
  'chain',
  'chalk',
  'charm',
  'chase',
  'chess',
  'cliff',
  'clock',
  'cloud',
  'coral',
  'crane',
  'crown',
  'dance',
  'delta',
  'dream',
  'eagle',
  'ember',
  'fable',
  'flame',
  'flint',
  'frost',
  'ghost',
  'globe',
  'grain',
  'grape',
  'green',
  'grove',
  'guide',
  'heart',
  'honey',
  'ivory',
  'jewel',
  'karma',
  'kneel',
  'latch',
  'level',
  'light',
  'lilac',
  'lunar',
  'maple',
  'march',
  'medal',
  'melon',
  'metal',
  'might',
  'north',
  'novel',
  'ocean',
  'olive',
  'orbit',
  'panda',
  'pearl',
  'piano',
  'pilot',
  'plaza',
  'polar',
  'pride',
  'prism',
  'pulse',
  'quake',
  'raven',
  'realm',
  'ridge',
  'river',
  'royal',
  'saint',
  'scale',
  'scout',
  'shade',
  'shell',
  'sigma',
  'silky',
  'solar',
  'solid',
  'spark',
  'spice',
  'spine',
  'stamp',
  'steel',
  'stone',
  'storm',
  'sugar',
  'swift',
  'sword',
  'table',
  'terra',
  'thorn',
  'tiger',
  'torch',
  'tower',
  'trail',
  'trend',
  'tulip',
  'umbra',
  'unity',
  'urban',
  'vapor',
  'vivid',
  'voice',
  'watch',
  'water',
  'wheat',
  'whirl',
  'width',
  'windy',
  'world',
  'wound',
  'yacht',
  'zebra',
  'zippy',
  'amber',
  'badge',
  'cedar',
  'drift',
  'faith',
  'haste',
  'index',
  'jumbo',
];

function generateRecoveryPhrase(): string {
  const words: string[] = [];
  const arr = new Uint32Array(12);
  crypto.getRandomValues(arr);
  for (let i = 0; i < 12; i++) {
    words.push(RECOVERY_WORDS[arr[i] % RECOVERY_WORDS.length]);
  }
  return words.join(' ');
}

interface OnboardingState {
  stepIndex: number;
  language: 'en' | 'fr';
  name: string;
  avatarColor: string;
  pinEnabled: boolean;
  pin: string;
  pinConfirm: string;
  allowPinReset: boolean;
  themeChoice:
    | 'light'
    | 'dark'
    | 'space'
    | 'lofi'
    | 'sky'
    | 'aurora'
    | 'sakura'
    | 'crepuscule'
    | 'foret'
    | 'system';
  accentColor: string;
  useCase: UseCase | null;
  securityAcknowledged: boolean;
  encryptionPassword: string;
  encryptionPasswordConfirm: string;
  recoveryPhrase: string;
  recoveryPhraseSaved: boolean;
  isFinishing: boolean;
  finishError: string | null;
}

// ==================== Component ====================

interface OnboardingProps {
  onComplete: () => void;
}

const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();

  // Detect OS language for auto-selection
  const detectedLang = (() => {
    const nav = navigator.language || navigator.languages?.[0] || '';
    if (nav.startsWith('fr')) return 'fr';
    return 'en';
  })();

  const [s, setS] = useState<OnboardingState>({
    stepIndex: 0,
    language: detectedLang,
    name: '',
    avatarColor: AVATAR_COLORS[0],
    pinEnabled: false,
    pin: '',
    pinConfirm: '',
    allowPinReset: true,
    themeChoice: 'light',
    accentColor: '#87CEEB',
    useCase: null,
    securityAcknowledged: false,
    encryptionPassword: '',
    encryptionPasswordConfirm: '',
    recoveryPhrase: '',
    recoveryPhraseSaved: false,
    isFinishing: false,
    finishError: null,
  });

  const update = useCallback((patch: Partial<OnboardingState>) => {
    setS((prev) => ({ ...prev, ...patch }));
  }, []);

  // Apply detected OS language on mount so the welcome page renders correctly
  useEffect(() => {
    if (detectedLang !== i18n.language) {
      i18n.changeLanguage(detectedLang);
    }
  }, []);

  const steps = LOCAL_STEPS;
  const currentStep = steps[s.stepIndex];

  const canNext = (): boolean => {
    switch (currentStep) {
      case 'profile':
        if (!s.name.trim()) return false;
        if (s.pinEnabled) {
          if (!/^\d{4,6}$/.test(s.pin)) return false;
          if (s.pin !== s.pinConfirm) return false;
        }
        return true;
      case 'usecase':
        return s.useCase !== null;
      case 'security':
        return (
          s.securityAcknowledged &&
          s.encryptionPassword.length >= 8 &&
          s.encryptionPassword === s.encryptionPasswordConfirm &&
          s.recoveryPhraseSaved
        );
      default:
        return true;
    }
  };

  const handleNext = () => update({ stepIndex: Math.min(s.stepIndex + 1, steps.length - 1) });
  const handleBack = () => update({ stepIndex: Math.max(s.stepIndex - 1, 0) });

  // ==================== Finish ====================

  const handleFinish = useCallback(async () => {
    update({ isFinishing: true, finishError: null });

    try {
      // 1. Profile (FATAL if fails)
      const profile = await dispatch(
        createProfile({
          name: s.name.trim() || 'User',
          avatarColor: s.avatarColor,
          ...(s.pinEnabled && s.pin ? { pin: s.pin, allowPinReset: s.allowPinReset } : {}),
        })
      ).unwrap();

      // 1b. Activate the profile so StorageService points to the right directory
      await dispatch(activateProfile(profile.id)).unwrap();

      // 1c. Initialize hybrid encryption with the master password
      if (s.encryptionPassword) {
        try {
          const { initHybridCrypto, wrapFEKWithRecoveryPhrase } =
            await import('../../../services/auth/hybridCrypto');
          await initHybridCrypto(s.encryptionPassword);

          // Also wrap FEK with recovery phrase so it can be recovered later
          if (s.recoveryPhrase) {
            const recoveryData = await wrapFEKWithRecoveryPhrase(s.recoveryPhrase);
            // Update the wrapped key file to include recovery data
            const existingWrapped =
              await window.electron?.ipcRenderer?.invoke('hybrid:loadWrappedKey');
            if (existingWrapped) {
              await window.electron?.ipcRenderer?.invoke('hybrid:saveWrappedKey', {
                ...existingWrapped,
                ...recoveryData,
              });
            }
          }
        } catch (err) {
          console.warn('[Onboarding] Encryption init failed (non-fatal):', err);
        }
      }

      // 2. Theme
      if (s.themeChoice === 'system') {
        dispatch(setUseSystemTheme(true));
        const resolved = detectSystemTheme();
        document.documentElement.setAttribute('data-theme', resolved);
      } else {
        dispatch(setTheme(s.themeChoice));
        document.documentElement.setAttribute('data-theme', s.themeChoice);
      }
      localStorage.setItem(
        'theme',
        s.themeChoice === 'system' ? detectSystemTheme() : s.themeChoice
      );

      // 3. Accent color
      if (s.accentColor !== '#87CEEB') {
        applyAccentColorPalette(s.accentColor);
      }
      try {
        localStorage.setItem(
          'filarr-settings',
          JSON.stringify({
            theme: s.themeChoice === 'system' ? detectSystemTheme() : s.themeChoice,
            primaryColor: s.accentColor,
            language: s.language,
            notificationsEnabled: true,
            soundEnabled: true,
          })
        );
      } catch {
        /* non-fatal */
      }

      // 4. Language persistence
      localStorage.setItem('i18nextLng', s.language);

      // 5. Starter content
      if (s.useCase) {
        const template = STARTER_TEMPLATES[s.useCase];
        const createdFolderIds: Record<string, string> = {};

        // 5a. Folders + subfolders
        for (const folderTpl of template.folders) {
          try {
            const folder = await dispatch(
              createFolder({
                name: t(folderTpl.nameKey),
                color: folderTpl.color,
              })
            ).unwrap();
            createdFolderIds[folderTpl.nameKey] = folder.id;

            if (folderTpl.children) {
              for (const child of folderTpl.children) {
                try {
                  await dispatch(
                    createFolder({
                      name: t(child.nameKey),
                      color: child.color,
                      parentId: folder.id,
                    })
                  ).unwrap();
                } catch {
                  /* non-fatal */
                }
              }
            }
          } catch (err) {
            console.warn('[Onboarding] Folder creation failed:', folderTpl.nameKey, err);
          }
        }

        // 5b. Tags
        for (const tagTpl of template.tags) {
          try {
            await dispatch(
              createTag({
                name: t(tagTpl.nameKey),
                color: tagTpl.color,
              })
            ).unwrap();
          } catch {
            /* non-fatal */
          }
        }

        // 5c. Welcome note
        const firstFolderKey = template.folders[0]?.nameKey;
        const firstFolderName = firstFolderKey ? t(firstFolderKey) : 'Documents';
        const firstFolderId = firstFolderKey ? createdFolderIds[firstFolderKey] : undefined;

        try {
          await dispatch(
            createNewNote({
              title: s.language === 'fr' ? 'Bienvenue dans Filarr' : 'Welcome to Filarr',
              content: getWelcomeNoteContent(s.language, firstFolderName),
              parentId: firstFolderId || null,
            })
          ).unwrap();
        } catch {
          /* non-fatal */
        }
      }

      // 6. Complete — write to disk via IPC (survives localStorage resets)
      localStorage.setItem('filarr-onboarding-complete', 'true');
      try {
        await window.electron?.ipcRenderer?.invoke('flag:set', 'onboarding-complete', 'true');
      } catch {
        /* IPC unavailable in dev browser */
      }
      onComplete();
    } catch (err) {
      console.error('[Onboarding] Fatal error:', err);
      update({
        isFinishing: false,
        finishError: t('onboarding.finishError', 'Une erreur est survenue. Veuillez reessayer.'),
      });
    }
  }, [s, dispatch, t, onComplete, update]);

  // ==================== Render helpers ====================

  const Bullet: React.FC<{ icon: React.ReactNode; text: string }> = ({ icon, text }) => (
    <div
      className="flex items-center gap-3 p-3 rounded-lg"
      style={{ backgroundColor: 'var(--color-background-secondary)' }}
    >
      <span className="text-lg">{icon}</span>
      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        {text}
      </p>
    </div>
  );

  const RadioCard: React.FC<{
    selected: boolean;
    onClick: () => void;
    children: React.ReactNode;
  }> = ({ selected, onClick, children }) => (
    <button
      onClick={onClick}
      className="w-full text-left p-4 rounded-xl border-2 transition-all"
      style={{
        borderColor: selected ? 'var(--color-primary-600)' : 'var(--color-border)',
        backgroundColor: selected ? 'var(--color-primary-50)' : 'transparent',
      }}
    >
      {children}
    </button>
  );

  // ==================== Render ====================

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'var(--color-background)' }}
    >
      <div
        className="w-full max-w-2xl mx-4 rounded-2xl"
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
          maxHeight: 'calc(100vh - 48px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Progress bar */}
        <div
          style={{ height: 4, backgroundColor: 'var(--color-background-secondary)', flexShrink: 0 }}
        >
          <div
            style={{
              height: '100%',
              backgroundColor: 'var(--color-primary-600)',
              width: `${((s.stepIndex + 1) / steps.length) * 100}%`,
              transition: 'width 0.3s ease',
            }}
          />
        </div>

        <div style={{ padding: '2rem', overflowY: 'auto', flex: 1, minHeight: 0 }}>
          {/* ======== Step: Welcome ======== */}
          {currentStep === 'welcome' && (
            <div className="text-center">
              <div className="mx-auto mb-6">
                <FilarrLogo size={80} />
              </div>
              <h1
                className="text-2xl font-bold mb-2"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {t('onboarding.welcomeTitle', 'Bienvenue sur Filarr !')}
              </h1>
              <p className="mb-5" style={{ color: 'var(--color-text-secondary)' }}>
                {t(
                  'onboarding.welcomeSubtitle',
                  'Votre gestionnaire de fichiers securise et prive.'
                )}
              </p>
              <div className="space-y-2 text-left">
                <Bullet
                  icon={
                    <svg
                      className="w-5 h-5"
                      style={{ color: '#10b981' }}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
                      />
                    </svg>
                  }
                  text={t(
                    'onboarding.welcomeBullet1',
                    'Chiffrement AES-256 — vos fichiers sont proteges'
                  )}
                />
                <Bullet
                  icon={
                    <svg
                      className="w-5 h-5"
                      style={{ color: '#3b82f6' }}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3"
                      />
                    </svg>
                  }
                  text={t(
                    'onboarding.welcomeBullet2',
                    '100% local — rien ne quitte votre appareil'
                  )}
                />
                <Bullet
                  icon={
                    <svg
                      className="w-5 h-5"
                      style={{ color: '#8b5cf6' }}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
                      />
                    </svg>
                  }
                  text={t(
                    'onboarding.welcomeBullet3',
                    'Multi-profils — chaque utilisateur a son espace'
                  )}
                />
              </div>

              {/* Language quick-switch on welcome page */}
              <div className="flex items-center justify-center gap-2 mt-4">
                <button
                  onClick={() => {
                    update({ language: 'fr' });
                    i18n.changeLanguage('fr');
                  }}
                  className="px-3 py-1 text-sm rounded-lg transition-all"
                  style={{
                    border: '1px solid var(--color-border)',
                    background: s.language === 'fr' ? 'var(--color-primary-50)' : 'transparent',
                    fontWeight: s.language === 'fr' ? 600 : 400,
                    color: 'var(--color-text-primary)',
                    cursor: 'pointer',
                  }}
                >
                  🇫🇷 Français
                </button>
                <button
                  onClick={() => {
                    update({ language: 'en' });
                    i18n.changeLanguage('en');
                  }}
                  className="px-3 py-1 text-sm rounded-lg transition-all"
                  style={{
                    border: '1px solid var(--color-border)',
                    background: s.language === 'en' ? 'var(--color-primary-50)' : 'transparent',
                    fontWeight: s.language === 'en' ? 600 : 400,
                    color: 'var(--color-text-primary)',
                    cursor: 'pointer',
                  }}
                >
                  🇬🇧 English
                </button>
              </div>
            </div>
          )}

          {/* ======== Step: Profile ======== */}
          {currentStep === 'profile' && (
            <div>
              <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>
                {t('onboarding.profileTitle', 'Configurez votre profil')}
              </h2>
              <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
                {t(
                  'onboarding.profileSubtitle',
                  'Choisissez un nom et une couleur pour votre avatar.'
                )}
              </p>

              {/* Name */}
              <div className="mb-4">
                <label
                  className="block text-sm font-medium mb-1.5"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {t('onboarding.nameLabel', 'Votre nom')}
                </label>
                <input
                  type="text"
                  value={s.name}
                  onChange={(e) => update({ name: e.target.value })}
                  placeholder={t('onboarding.namePlaceholder', 'Entrez votre nom')}
                  className="w-full px-4 py-2.5 rounded-lg focus:outline-none focus:ring-2"
                  style={{
                    backgroundColor: 'var(--color-background)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text-primary)',
                  }}
                  autoFocus
                  maxLength={50}
                />
              </div>

              {/* Avatar color */}
              <div className="mb-4">
                <label
                  className="block text-sm font-medium mb-1.5"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {t('onboarding.colorLabel', "Couleur de l'avatar")}
                </label>
                <div className="flex flex-wrap gap-2">
                  {AVATAR_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => update({ avatarColor: color })}
                      className="w-9 h-9 rounded-full border-2 transition-all flex items-center justify-center"
                      style={{
                        backgroundColor: color,
                        borderColor:
                          s.avatarColor === color ? 'var(--color-primary-600)' : 'transparent',
                        transform: s.avatarColor === color ? 'scale(1.15)' : 'scale(1)',
                      }}
                    >
                      {s.avatarColor === color && (
                        <svg
                          className="w-4 h-4 text-white"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={3}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M4.5 12.75l6 6 9-13.5"
                          />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
                    style={{ background: avatarGradient(s.avatarColor) }}
                  >
                    {(s.name.trim() || 'U').charAt(0).toUpperCase()}
                  </div>
                  <span
                    className="font-medium text-sm"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {s.name.trim() || 'User'}
                  </span>
                </div>
              </div>

              {/* PIN toggle */}
              <div
                className="rounded-lg p-3"
                style={{
                  backgroundColor: 'var(--color-background-secondary)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <label className="flex items-center justify-between cursor-pointer">
                  <span
                    className="text-sm font-medium"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {t('onboarding.pinToggle', 'Proteger ce profil avec un PIN')}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={s.pinEnabled}
                    onClick={() => update({ pinEnabled: !s.pinEnabled, pin: '', pinConfirm: '' })}
                    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${s.pinEnabled ? 'bg-[var(--color-primary-500)]' : 'bg-[var(--color-neutral-300)]'}`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${s.pinEnabled ? 'translate-x-5' : 'translate-x-0'}`}
                    />
                  </button>
                </label>
                {s.pinEnabled && (
                  <div className="mt-3 space-y-2">
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={6}
                      value={s.pin}
                      onChange={(e) => update({ pin: e.target.value.replace(/\D/g, '') })}
                      placeholder={t('onboarding.pinLabel', 'Code PIN (4-6 chiffres)')}
                      className="w-full px-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2"
                      style={{
                        backgroundColor: 'var(--color-background)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text-primary)',
                      }}
                    />
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={6}
                      value={s.pinConfirm}
                      onChange={(e) => update({ pinConfirm: e.target.value.replace(/\D/g, '') })}
                      placeholder={t('onboarding.pinConfirmLabel', 'Confirmer le PIN')}
                      className="w-full px-3 py-2 text-sm rounded-lg focus:outline-none focus:ring-2"
                      style={{
                        backgroundColor: 'var(--color-background)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text-primary)',
                      }}
                    />
                    {s.pin.length >= 4 && s.pinConfirm.length >= 4 && s.pin !== s.pinConfirm && (
                      <p className="text-xs text-red-500">
                        {t('onboarding.pinMismatch', 'Les PINs ne correspondent pas')}
                      </p>
                    )}
                    <label className="flex items-center gap-2 mt-1">
                      <input
                        type="checkbox"
                        checked={s.allowPinReset}
                        onChange={(e) => update({ allowPinReset: e.target.checked })}
                        className="accent-[var(--color-primary-600)]"
                      />
                      <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                        {t('onboarding.pinResetToggle', 'Autoriser la reinitialisation du PIN')}
                      </span>
                    </label>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ======== Step 4: Appearance ======== */}
          {currentStep === 'appearance' && (
            <div>
              <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>
                {t('onboarding.appearanceTitle', "Personnalisez l'apparence")}
              </h2>
              <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
                {t('onboarding.appearanceSubtitle', "Choisissez un theme et une couleur d'accent.")}
              </p>

              {/* Theme */}
              <div className="grid grid-cols-3 gap-2 mb-5">
                {[
                  {
                    id: 'light' as const,
                    label: t('onboarding.lightTheme', 'Clair'),
                    bg: '#FFFFFF',
                    sidebar: '#F8FAFC',
                    accent: '#E2E8F0',
                    text: '#334155',
                  },
                  {
                    id: 'dark' as const,
                    label: t('onboarding.darkTheme', 'Sombre'),
                    bg: '#0A0E1A',
                    sidebar: '#10141F',
                    accent: '#2A3142',
                    text: '#B8C5D6',
                  },
                  {
                    id: 'space' as const,
                    label: t('onboarding.spaceTheme', 'Espace'),
                    bg: '#0B0D1A',
                    sidebar: '#111425',
                    accent: '#2A2D4A',
                    text: '#A89FC0',
                  },
                  {
                    id: 'lofi' as const,
                    label: t('onboarding.lofiTheme', 'Lofi'),
                    bg: '#F5F0E8',
                    sidebar: '#EDE6D9',
                    accent: '#D4C9B8',
                    text: '#6B5D4F',
                  },
                  {
                    id: 'sky' as const,
                    label: t('onboarding.skyTheme', 'Ciel'),
                    bg: '#F0F7FF',
                    sidebar: '#E6F1FC',
                    accent: '#B8D4F0',
                    text: '#3E6890',
                  },
                  {
                    id: 'aurora' as const,
                    label: t('onboarding.auroraTheme', 'Aurora'),
                    bg: '#0B1120',
                    sidebar: '#111B2E',
                    accent: '#22D3A0',
                    text: '#94A3B8',
                  },
                  {
                    id: 'sakura' as const,
                    label: t('onboarding.sakuraTheme', 'Sakura'),
                    bg: '#FFF8F9',
                    sidebar: '#FFF0F3',
                    accent: '#F2C4CF',
                    text: '#7A4A60',
                  },
                  {
                    id: 'crepuscule' as const,
                    label: t('onboarding.crepusculeTheme', 'Crépuscule'),
                    bg: '#1A1018',
                    sidebar: '#221620',
                    accent: '#E8845C',
                    text: '#B89A98',
                  },
                  {
                    id: 'foret' as const,
                    label: t('onboarding.foretTheme', 'Forêt'),
                    bg: '#0F1D15',
                    sidebar: '#15271C',
                    accent: '#6BBE7D',
                    text: '#A0BCA4',
                  },
                  {
                    id: 'system' as const,
                    label: t('onboarding.systemTheme', 'Système'),
                    bg: '',
                    sidebar: '',
                    accent: '',
                    text: '',
                  },
                ].map((theme) => (
                  <button
                    key={theme.id}
                    onClick={() => {
                      update({ themeChoice: theme.id });
                      // Apply theme immediately so the user sees the change
                      const resolved = theme.id === 'system' ? detectSystemTheme() : theme.id;
                      document.documentElement.setAttribute('data-theme', resolved);
                    }}
                    className="flex flex-col items-center gap-1.5 p-2 rounded-xl border-2 transition-all"
                    style={{
                      borderColor:
                        s.themeChoice === theme.id
                          ? 'var(--color-primary-600)'
                          : 'var(--color-border-light, var(--color-border))',
                      backgroundColor:
                        s.themeChoice === theme.id ? 'var(--color-primary-50)' : 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    {/* Mini preview */}
                    <div
                      className="w-full rounded-lg overflow-hidden border"
                      style={{
                        height: 36,
                        display: 'flex',
                        borderColor: theme.id === 'system' ? '#CBD5E1' : theme.accent,
                      }}
                    >
                      {theme.id === 'system' ? (
                        <>
                          <div className="flex-1" style={{ background: '#FFFFFF', padding: 6 }}>
                            <div
                              style={{
                                height: 4,
                                width: 16,
                                background: '#E2E8F0',
                                borderRadius: 2,
                              }}
                            />
                          </div>
                          <div className="flex-1" style={{ background: '#0A0E1A', padding: 6 }}>
                            <div
                              style={{
                                height: 4,
                                width: 16,
                                background: '#2A3142',
                                borderRadius: 2,
                              }}
                            />
                          </div>
                        </>
                      ) : (
                        <div className="flex-1 flex" style={{ background: theme.bg }}>
                          <div
                            style={{
                              width: '30%',
                              background: theme.sidebar,
                              borderRight: `1px solid ${theme.accent}`,
                            }}
                          />
                          <div style={{ flex: 1, padding: 6 }}>
                            <div
                              style={{
                                height: 3,
                                width: '60%',
                                background: theme.text,
                                borderRadius: 2,
                                opacity: 0.3,
                                marginBottom: 3,
                              }}
                            />
                            <div
                              style={{
                                height: 3,
                                width: '40%',
                                background: theme.text,
                                borderRadius: 2,
                                opacity: 0.15,
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                    <span
                      className="text-xs font-medium"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      {theme.label}
                    </span>
                  </button>
                ))}
              </div>

              {/* Accent color */}
              <label
                className="block text-sm font-medium mb-2"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {t('onboarding.accentColorLabel', "Couleur d'accent")}
              </label>
              <div className="flex flex-wrap gap-2.5">
                {PRESET_ACCENT_COLORS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => {
                      update({ accentColor: c.value });
                      applyAccentColorPalette(c.value);
                    }}
                    className={`w-8 h-8 rounded-full transition-all hover:scale-110 ${s.accentColor === c.value ? 'ring-2 ring-offset-2 ring-[var(--color-text-primary)] scale-110' : ''}`}
                    style={{ backgroundColor: c.value }}
                    title={c.name}
                  >
                    {s.accentColor === c.value && (
                      <span className="flex items-center justify-center text-white">
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={3}
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ======== Step 5: Use Case ======== */}
          {currentStep === 'usecase' && (
            <div>
              <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>
                {t('onboarding.useCaseTitle', 'Comment utiliserez-vous Filarr ?')}
              </h2>
              <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
                {t('onboarding.useCaseSubtitle', 'Nous creerons des dossiers et tags adaptes.')}
              </p>
              <div className="onboarding-usecase-grid">
                {USE_CASE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => update({ useCase: opt.id })}
                    className={`onboarding-usecase-card ${s.useCase === opt.id ? 'is-selected' : ''}`}
                  >
                    <div className="onboarding-usecase-card__icon">{opt.icon}</div>
                    <p className="onboarding-usecase-card__title">{t(opt.titleKey)}</p>
                    <p className="onboarding-usecase-card__desc">{t(opt.descriptionKey)}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ======== Step 6: Discovery ======== */}
          {currentStep === 'discovery' && (
            <div>
              <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>
                {t('onboarding.discoveryTitle', 'Decouvrez Filarr')}
              </h2>
              <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
                {t(
                  'onboarding.discoverySubtitle',
                  'Quatre espaces pour organiser votre vie numerique.'
                )}
              </p>
              <div className="grid grid-cols-2 gap-3">
                {DISCOVERY_AREAS.map((area, i) => (
                  <div
                    key={i}
                    className="p-4 rounded-xl"
                    style={{
                      backgroundColor: 'var(--color-background-secondary)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    <span className="text-2xl block mb-2">{area.icon}</span>
                    <p
                      className="text-sm font-semibold mb-0.5"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      {t(area.titleKey)}
                    </p>
                    <p
                      className="text-xs leading-relaxed"
                      style={{ color: 'var(--color-text-tertiary)' }}
                    >
                      {t(area.descriptionKey)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ======== Step: Security ======== */}
          {currentStep === 'security' && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#ef4444"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                  />
                </svg>
                <div>
                  <h2 className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>
                    {t('onboarding.securityTitle', 'Sécurité & chiffrement')}
                  </h2>
                  <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    {t('onboarding.securitySubtitle', 'À lire attentivement avant de continuer.')}
                  </p>
                </div>
              </div>
              <div
                className="rounded-xl p-4 mb-4"
                style={{
                  backgroundColor: 'rgba(239,68,68,0.06)',
                  border: '1px solid rgba(239,68,68,0.2)',
                }}
              >
                <p className="text-sm font-semibold mb-1" style={{ color: '#ef4444' }}>
                  {t(
                    'onboarding.securityWarningTitle',
                    'Votre mot de passe est la clé de vos fichiers'
                  )}
                </p>
                <p
                  className="text-sm leading-relaxed mb-2"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {t('onboarding.securityWarningText')}
                </p>
                <ul className="m-0 pl-4" style={{ listStyleType: 'disc' }}>
                  <li className="text-sm mb-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {t('onboarding.securityTip1')}
                  </li>
                  <li className="text-sm mb-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {t('onboarding.securityTip2')}
                  </li>
                  <li className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    {t('onboarding.securityTip3')}
                  </li>
                </ul>
              </div>
              {/* Master encryption password */}
              <div
                className="rounded-xl p-4 mb-4"
                style={{
                  backgroundColor: 'var(--color-background-secondary)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <p
                  className="text-sm font-semibold mb-1"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {t('onboarding.encryptionPasswordTitle', 'Mot de passe de chiffrement')}
                </p>
                <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                  {t(
                    'onboarding.encryptionPasswordDesc',
                    'Ce mot de passe protege vos fichiers. 8 caracteres minimum. Il est different de votre PIN de profil.'
                  )}
                </p>
                <input
                  type="password"
                  value={s.encryptionPassword}
                  onChange={(e) => {
                    update({ encryptionPassword: e.target.value });
                    // Generate recovery phrase on first password entry
                    if (e.target.value.length >= 8 && !s.recoveryPhrase) {
                      update({ recoveryPhrase: generateRecoveryPhrase() });
                    }
                  }}
                  placeholder={t(
                    'onboarding.encryptionPasswordPlaceholder',
                    'Mot de passe (8+ caracteres)'
                  )}
                  className="w-full px-3 py-2 rounded-lg text-sm mb-2"
                  style={{
                    backgroundColor: 'var(--color-background)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text-primary)',
                    outline: 'none',
                  }}
                />
                <input
                  type="password"
                  value={s.encryptionPasswordConfirm}
                  onChange={(e) => update({ encryptionPasswordConfirm: e.target.value })}
                  placeholder={t(
                    'onboarding.encryptionPasswordConfirm',
                    'Confirmer le mot de passe'
                  )}
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{
                    backgroundColor: 'var(--color-background)',
                    border: `1px solid ${s.encryptionPasswordConfirm && s.encryptionPassword !== s.encryptionPasswordConfirm ? '#ef4444' : 'var(--color-border)'}`,
                    color: 'var(--color-text-primary)',
                    outline: 'none',
                  }}
                />
                {s.encryptionPasswordConfirm &&
                  s.encryptionPassword !== s.encryptionPasswordConfirm && (
                    <p className="text-xs mt-1" style={{ color: '#ef4444' }}>
                      {t('onboarding.passwordMismatch', 'Les mots de passe ne correspondent pas')}
                    </p>
                  )}
              </div>

              {/* Recovery phrase */}
              {s.recoveryPhrase && (
                <div
                  className="rounded-xl p-4 mb-4"
                  style={{
                    backgroundColor: 'rgba(251,191,36,0.06)',
                    border: '1px solid rgba(251,191,36,0.3)',
                  }}
                >
                  <p className="text-sm font-semibold mb-1" style={{ color: '#d97706' }}>
                    {t('onboarding.recoveryPhraseTitle', 'Phrase de récupération')}
                  </p>
                  <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                    {t(
                      'onboarding.recoveryPhraseDesc',
                      'Notez ces 12 mots dans un endroit sûr. Ils permettent de récupérer vos données si vous oubliez votre mot de passe.'
                    )}
                  </p>
                  <div
                    className="grid grid-cols-4 gap-2 p-3 rounded-lg mb-3 font-mono text-sm"
                    style={{
                      backgroundColor: 'var(--color-background)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    {s.recoveryPhrase.split(' ').map((word, i) => (
                      <span key={i} style={{ color: 'var(--color-text-primary)' }}>
                        <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.7em' }}>
                          {i + 1}.{' '}
                        </span>
                        {word}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg"
                      style={{
                        backgroundColor:
                          s.finishError === '__copied__'
                            ? 'var(--color-success-50, rgba(34,197,94,0.1))'
                            : 'var(--color-background)',
                        border:
                          s.finishError === '__copied__'
                            ? '1px solid var(--color-success-400, #4ade80)'
                            : '1px solid var(--color-border)',
                        color:
                          s.finishError === '__copied__'
                            ? 'var(--color-success-700, #15803d)'
                            : 'var(--color-text-primary)',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                      onClick={() => {
                        navigator.clipboard.writeText(s.recoveryPhrase);
                        update({ finishError: '__copied__' });
                        setTimeout(() => update({ finishError: null }), 2000);
                      }}
                    >
                      {s.finishError === '__copied__' ? (
                        <>
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2.5}
                          >
                            <polyline points="20,6 9,17 4,12" />
                          </svg>
                          {t('common.copied', 'Copié !')}
                        </>
                      ) : (
                        <>
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <rect x="9" y="9" width="13" height="13" rx="2" />
                            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                          </svg>
                          {t('onboarding.copyPhrase', 'Copier')}
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => update({ recoveryPhraseSaved: !s.recoveryPhraseSaved })}
                      className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg"
                      style={{
                        flex: 1,
                        backgroundColor: s.recoveryPhraseSaved
                          ? 'rgba(251,191,36,0.1)'
                          : 'var(--color-background)',
                        border: s.recoveryPhraseSaved
                          ? '1px solid #d97706'
                          : '1px solid var(--color-border)',
                        color: s.recoveryPhraseSaved ? '#92400e' : 'var(--color-text-primary)',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        fontWeight: 500,
                      }}
                    >
                      <div
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 4,
                          border: s.recoveryPhraseSaved
                            ? 'none'
                            : '2px solid var(--color-text-tertiary)',
                          backgroundColor: s.recoveryPhraseSaved ? '#d97706' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          transition: 'all 0.2s',
                        }}
                      >
                        {s.recoveryPhraseSaved && (
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="white"
                            strokeWidth={3}
                          >
                            <polyline points="20,6 9,17 4,12" />
                          </svg>
                        )}
                      </div>
                      {t('onboarding.recoveryPhraseSaved', "J'ai noté ma phrase de récupération")}
                    </button>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => update({ securityAcknowledged: !s.securityAcknowledged })}
                className="onboarding-acknowledge-btn"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  width: '100%',
                  padding: '14px 16px',
                  borderRadius: 12,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s',
                  border: s.securityAcknowledged
                    ? '2px solid var(--color-primary-500)'
                    : '2px dashed var(--color-text-tertiary, #94a3b8)',
                  backgroundColor: s.securityAcknowledged
                    ? 'var(--color-primary-50)'
                    : 'transparent',
                  animation: !s.securityAcknowledged
                    ? 'acknowledge-pulse 2s ease-in-out infinite'
                    : 'none',
                }}
              >
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    border: s.securityAcknowledged
                      ? 'none'
                      : '2px solid var(--color-text-tertiary, #94a3b8)',
                    backgroundColor: s.securityAcknowledged
                      ? 'var(--color-primary-500, #4682b4)'
                      : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'all 0.2s',
                  }}
                >
                  {s.securityAcknowledged && (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="white"
                      strokeWidth={3}
                    >
                      <polyline points="20,6 9,17 4,12" />
                    </svg>
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <span
                    style={{
                      display: 'block',
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      color: s.securityAcknowledged
                        ? 'var(--color-primary-700, #36648b)'
                        : 'var(--color-text-primary)',
                    }}
                  >
                    {t('onboarding.securityAcknowledge', "J'ai compris et j'accepte")}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      fontSize: '0.6875rem',
                      color: 'var(--color-text-secondary)',
                      marginTop: 2,
                    }}
                  >
                    {t(
                      'onboarding.securityAcknowledgeDetail',
                      'En cas de perte de mon mot de passe, mes fichiers chiffrés seront irrécupérables.'
                    )}
                  </span>
                </div>
                {!s.securityAcknowledged && (
                  <span
                    style={{
                      fontSize: '0.6875rem',
                      color: 'var(--color-text-tertiary)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t('onboarding.clickToAccept', 'Cliquez pour accepter')}
                  </span>
                )}
              </button>
            </div>
          )}

          {/* ======== Step 8: Ready ======== */}
          {currentStep === 'ready' && (
            <div className="text-center">
              <div
                className="w-20 h-20 mx-auto mb-5 rounded-2xl flex items-center justify-center"
                style={{ backgroundColor: 'rgba(34,197,94,0.1)' }}
              >
                <svg
                  className="w-10 h-10"
                  style={{ color: '#22c55e' }}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>
                {t('onboarding.readyTitle', 'Tout est pret !')}
              </h2>
              <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
                {t('onboarding.readyRecap', 'Voici un resume de vos choix :')}
              </p>

              {/* Recap */}
              <div className="text-left space-y-2 mb-4">
                <div
                  className="flex items-center justify-between px-3 py-2 rounded-lg text-sm"
                  style={{ backgroundColor: 'var(--color-background-secondary)' }}
                >
                  <span style={{ color: 'var(--color-text-tertiary)' }}>
                    {t('onboarding.recapProfile', 'Profil')}
                  </span>
                  <div className="flex items-center gap-2">
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold"
                      style={{ background: avatarGradient(s.avatarColor) }}
                    >
                      {(s.name.trim() || 'U').charAt(0).toUpperCase()}
                    </div>
                    <span style={{ color: 'var(--color-text-primary)' }}>
                      {s.name.trim() || 'User'}
                    </span>
                  </div>
                </div>
                <div
                  className="flex items-center justify-between px-3 py-2 rounded-lg text-sm"
                  style={{ backgroundColor: 'var(--color-background-secondary)' }}
                >
                  <span style={{ color: 'var(--color-text-tertiary)' }}>
                    {t('onboarding.recapTheme', 'Theme')}
                  </span>
                  <span style={{ color: 'var(--color-text-primary)' }}>
                    {s.themeChoice === 'light'
                      ? t('onboarding.lightTheme')
                      : s.themeChoice === 'dark'
                        ? t('onboarding.darkTheme')
                        : t('onboarding.systemTheme')}
                  </span>
                </div>
                <div
                  className="flex items-center justify-between px-3 py-2 rounded-lg text-sm"
                  style={{ backgroundColor: 'var(--color-background-secondary)' }}
                >
                  <span style={{ color: 'var(--color-text-tertiary)' }}>
                    {t('onboarding.recapAccent', "Couleur d'accent")}
                  </span>
                  <div
                    className="w-5 h-5 rounded-full"
                    style={{ backgroundColor: s.accentColor }}
                  />
                </div>
                {s.useCase && (
                  <div
                    className="flex items-center justify-between px-3 py-2 rounded-lg text-sm"
                    style={{ backgroundColor: 'var(--color-background-secondary)' }}
                  >
                    <span style={{ color: 'var(--color-text-tertiary)' }}>
                      {t('onboarding.recapUseCase', 'Usage')}
                    </span>
                    <span style={{ color: 'var(--color-text-primary)' }}>
                      {USE_CASE_OPTIONS.find((o) => o.id === s.useCase)?.icon}{' '}
                      {t(USE_CASE_OPTIONS.find((o) => o.id === s.useCase)?.titleKey || '')}
                    </span>
                  </div>
                )}
                {s.pinEnabled && (
                  <div
                    className="flex items-center justify-between px-3 py-2 rounded-lg text-sm"
                    style={{ backgroundColor: 'var(--color-background-secondary)' }}
                  >
                    <span style={{ color: 'var(--color-text-tertiary)' }}>
                      {t('onboarding.recapPin', 'PIN active')}
                    </span>
                    <span style={{ color: '#10b981' }}>✓</span>
                  </div>
                )}
              </div>

              {s.finishError && (
                <div className="p-3 rounded-lg bg-red-50 border-l-4 border-red-500 text-sm text-red-700 mb-4 text-left">
                  {s.finishError}
                </div>
              )}
            </div>
          )}

          {/* ======== Navigation ======== */}
          <div className="flex justify-between" style={{ marginTop: '1.5rem' }}>
            {s.stepIndex > 0 ? (
              <button
                onClick={handleBack}
                disabled={s.isFinishing}
                className="px-5 py-2.5 text-sm font-medium transition-colors rounded-lg"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {t('common.back', 'Retour')}
              </button>
            ) : (
              <div />
            )}

            {currentStep === 'ready' ? (
              <button
                onClick={handleFinish}
                disabled={s.isFinishing}
                className="px-6 py-2.5 text-sm font-medium rounded-lg text-white transition-colors flex items-center gap-2"
                style={{
                  backgroundColor: s.isFinishing
                    ? 'var(--color-neutral-400)'
                    : 'var(--color-primary-600)',
                }}
              >
                {s.isFinishing ? (
                  <>
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        opacity="0.25"
                      />
                      <path
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        opacity="0.75"
                      />
                    </svg>
                    {t('onboarding.finishing', 'Création en cours...')}
                  </>
                ) : (
                  t('onboarding.getStarted', "C'est parti !")
                )}
              </button>
            ) : (
              <button
                onClick={handleNext}
                disabled={!canNext()}
                className="px-6 py-2.5 text-sm font-medium rounded-lg text-white transition-colors"
                style={{
                  backgroundColor: canNext()
                    ? 'var(--color-primary-600)'
                    : 'var(--color-neutral-400)',
                  cursor: canNext() ? 'pointer' : 'not-allowed',
                  opacity: canNext() ? 1 : 0.5,
                }}
              >
                {t('common.next', 'Suivant')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
