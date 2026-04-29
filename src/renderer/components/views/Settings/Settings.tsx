/**
 * Settings View Component
 *
 * Page paramètres redesignée en Tailwind CSS
 * Style Google Drive - Single column layout
 */

import { useState, useEffect, useMemo, FC, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate, useSearchParams } from 'react-router-dom';
import profileStorage from '../../../../services/core/profileStorage';
import useUI from '../../../../hooks/useUI';
import { setUseSystemTheme } from '../../../../store/slices/uiSlice';
import { setAutoLock } from '../../../../store/slices/settingsSlice';
import {
  detectSystemTheme,
  loadThemePreferences,
  saveThemePreferences,
} from '../../../../services/platform/themeService';
import {
  rewrapFEK,
  hasHybridKey,
  initHybridCrypto,
  generateAndWrapFEK,
} from '../../../../services/auth/hybridCrypto';
import {
  exportVault,
  type ExportProgress,
  type NoteForExport,
  type TagForExport,
  type ExportExtras,
} from '../../../../services/vault/vaultExportService';
import { useNotification } from '../../ui/Notification';
import Button from '../../ui/Button/Button';
import Modal, { ModalBody, ModalFooter } from '../../ui/Modal/Modal';
import { getAppVersion } from '../../../../services/platform/appVersion';

import type { RootState } from '../../../../store';
import { selectFilesStats } from '../../../../store/selectors/fileSelectors';
import ImportVaultModal from '../../settings/ImportVaultModal';
import DownloadsWatcherSection from '../../settings/DownloadsWatcherSection';

// ==================== TYPES ====================

interface AppSettings {
  theme: 'light' | 'dark' | 'space' | 'lofi' | 'sky' | 'aurora' | 'sakura' | 'crepuscule' | 'foret';
  primaryColor: string;
  language: string;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  primaryColor: '#87CEEB',
  language: 'fr',
  notificationsEnabled: true,
  soundEnabled: true,
};

// Accent color palette utilities — imported from shared themeService
import {
  PRESET_ACCENT_COLORS as PRESET_COLORS,
  applyAccentColorPalette as applyColorPalette,
  resetAccentColorPalette as resetColorPalette,
} from '../../../../services/platform/themeService';

/** Format bytes into a human-readable string */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

// ==================== INLINE COMPONENTS ====================

/** Toggle Switch – pure Tailwind */
const ToggleSwitch: FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}> = ({ checked, onChange, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => !disabled && onChange(!checked)}
    className={`
      relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent
      transition-colors duration-200 ease-in-out
      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-400)] focus-visible:ring-offset-2
      ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      ${checked ? 'bg-[var(--color-primary-500)]' : 'bg-[var(--color-neutral-300)]'}
    `}
  >
    <span
      className={`
        pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm
        ring-0 transition-transform duration-200 ease-in-out
        ${checked ? 'translate-x-5' : 'translate-x-0'}
      `}
    />
  </button>
);

/** Section Card wrapper */
const SectionCard: FC<{
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
}> = ({ icon, title, description, children }) => (
  <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-sm overflow-hidden">
    <div className="px-6 py-4 border-b border-[var(--color-border-light)]">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)]">
          {icon}
        </div>
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h2>
          {description && (
            <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">{description}</p>
          )}
        </div>
      </div>
    </div>
    <div className="divide-y divide-[var(--color-border-light)]">{children}</div>
  </div>
);

/** Setting Row */
const SettingRow: FC<{
  label: string;
  description?: string;
  children: React.ReactNode;
  vertical?: boolean;
}> = ({ label, description, children, vertical }) => (
  <div
    className={`
      px-6 py-4 transition-colors hover:bg-[var(--color-surface-hover)]
      ${vertical ? 'flex flex-col gap-3' : 'flex items-center justify-between gap-4'}
    `}
  >
    <div className={vertical ? '' : 'flex-1 min-w-0'}>
      <p className="text-sm font-medium text-[var(--color-text-primary)]">{label}</p>
      {description && (
        <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5 leading-relaxed">
          {description}
        </p>
      )}
    </div>
    <div className={vertical ? 'w-full' : 'shrink-0'}>{children}</div>
  </div>
);

// ==================== ICONS ====================

const SunIcon: FC = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="5" />
    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
  </svg>
);

const MoonIcon: FC = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const MonitorIcon: FC = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

const PaletteIcon: FC = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="8" r="1.5" fill="currentColor" />
    <circle cx="8" cy="14" r="1.5" fill="currentColor" />
    <circle cx="16" cy="14" r="1.5" fill="currentColor" />
  </svg>
);

const GlobeIcon: FC = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const BellIcon: FC = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

const DatabaseIcon: FC = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
  </svg>
);

const InfoIcon: FC = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

const TrashIcon: FC = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const SettingsIcon: FC = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const CheckIcon: FC = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const ResetIcon: FC = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="1 4 1 10 7 10" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
  </svg>
);

const VolumeIcon: FC = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
  </svg>
);

const FeedbackIcon: FC = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

// ==================== FONT SELECTOR ====================

const FONT_OPTIONS = [
  {
    id: 'inter',
    label: 'Inter',
    value: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    preview: 'Inter',
  },
  {
    id: 'system',
    label: 'System',
    value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', sans-serif",
    preview: 'System UI',
  },
  {
    id: 'geist',
    label: 'Geist',
    value: "'Geist', 'Inter', -apple-system, sans-serif",
    preview: 'Geist',
  },
  {
    id: 'mono',
    label: 'JetBrains Mono',
    value: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
    preview: 'JetBrains Mono',
  },
  {
    id: 'georgia',
    label: 'Georgia',
    value: "'Georgia', 'Times New Roman', serif",
    preview: 'Georgia',
  },
  {
    id: 'nunito',
    label: 'Nunito',
    value: "'Nunito', 'Inter', -apple-system, sans-serif",
    preview: 'Nunito',
  },
  {
    id: 'space-grotesk',
    label: 'Space Grotesk',
    value: "'Space Grotesk', 'Inter', -apple-system, sans-serif",
    preview: 'Space Grotesk',
  },
  {
    id: 'atkinson',
    label: 'Atkinson Hyperlegible',
    value: "'Atkinson Hyperlegible', 'Inter', -apple-system, sans-serif",
    preview: 'Atkinson',
  },
];

const FontSelector: FC = () => {
  const { t } = useTranslation();

  const [currentFont, setCurrentFont] = useState(() => {
    return localStorage.getItem('filarr-font') || 'inter';
  });

  const applyFont = useCallback((fontId: string) => {
    const option = FONT_OPTIONS.find((f) => f.id === fontId);
    if (!option) return;

    document.documentElement.style.setProperty('--font-family-base', option.value);
    document.documentElement.style.setProperty('--font-family-display', option.value);
    localStorage.setItem('filarr-font', fontId);
    setCurrentFont(fontId);
  }, []);

  return (
    <SettingRow
      label={t('settings.font', 'Police d\u2019écriture')}
      description={t('settings.fontDesc', 'Choisissez la police utilisée dans l\u2019application.')}
      vertical
    >
      <div className="grid grid-cols-3 gap-2">
        {FONT_OPTIONS.map((font) => (
          <button
            key={font.id}
            onClick={() => applyFont(font.id)}
            className="px-3 py-2.5 rounded-lg text-left transition-all"
            style={{
              border:
                currentFont === font.id
                  ? '2px solid var(--color-primary-500)'
                  : '1px solid var(--color-border)',
              backgroundColor:
                currentFont === font.id ? 'var(--color-primary-50)' : 'var(--color-surface)',
              cursor: 'pointer',
              fontFamily: font.value,
            }}
          >
            <span
              className="block text-sm font-semibold"
              style={{ color: 'var(--color-text-primary)', fontFamily: font.value }}
            >
              {font.preview}
            </span>
            <span className="block text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
              {font.label}
            </span>
          </button>
        ))}
      </div>
    </SettingRow>
  );
};

// ==================== AUTO-LOCK SELECT ====================

const AUTO_LOCK_OPTIONS = [
  { value: 0, labelFr: 'Jamais', labelEn: 'Never' },
  { value: 5, labelFr: 'Après 5 minutes', labelEn: 'After 5 minutes' },
  { value: 15, labelFr: 'Après 15 minutes', labelEn: 'After 15 minutes' },
  { value: 30, labelFr: 'Après 30 minutes', labelEn: 'After 30 minutes' },
  { value: 60, labelFr: 'Après 1 heure', labelEn: 'After 1 hour' },
];

const AutoLockSelect: FC = () => {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch();
  const { autoLockEnabled, autoLockTimeout } = useSelector(
    (state: RootState) => state.settings.security
  );
  const isFr = i18n.language?.startsWith('fr');
  const currentValue = autoLockEnabled ? autoLockTimeout : 0;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const minutes = parseInt(e.target.value, 10);
    dispatch(setAutoLock({ enabled: minutes > 0, timeout: minutes }));
  };

  return (
    <SettingRow
      label={t('settings.autoLock', 'Verrouillage automatique')}
      description={t(
        'settings.autoLockDesc',
        "Verrouille l'application après une période d'inactivité."
      )}
    >
      <select
        value={currentValue}
        onChange={handleChange}
        className="px-3 py-1.5 text-xs font-medium rounded-lg outline-none"
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-primary)',
          cursor: 'pointer',
        }}
      >
        {AUTO_LOCK_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {isFr ? opt.labelFr : opt.labelEn}
          </option>
        ))}
      </select>
    </SettingRow>
  );
};

// ==================== ENHANCED LOCK TOGGLE ====================

const EnhancedLockToggle: FC<{ profileId: string }> = ({ profileId }) => {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!profileId) return;
    window.electron?.ipcRenderer
      ?.invoke('security:getEnhancedLock', profileId)
      .then((val: boolean) => {
        setEnabled(val);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [profileId]);

  const handleToggle = async () => {
    const newVal = !enabled;
    setEnabled(newVal);
    await window.electron?.ipcRenderer?.invoke('security:setEnhancedLock', profileId, newVal);
  };

  if (!loaded) return null;

  return (
    <SettingRow
      label={t('settings.enhancedLock', 'Verrouillage renforcé')}
      description={t(
        'settings.enhancedLockDesc',
        'Supprime la clé locale à chaque fermeture. Votre mot de passe vault sera demandé à chaque ouverture.'
      )}
    >
      <div className="flex items-center gap-3">
        <button
          onClick={handleToggle}
          className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
          style={{
            backgroundColor: enabled ? 'var(--color-primary-600)' : 'var(--color-neutral-300)',
            cursor: 'pointer',
          }}
        >
          <span
            className="inline-block h-4 w-4 rounded-full bg-white transition-transform"
            style={{ transform: enabled ? 'translateX(1.375rem)' : 'translateX(0.25rem)' }}
          />
        </button>
        {enabled && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
            {t('settings.enhancedLockWarning', 'Recommandé sur appareils partagés')}
          </span>
        )}
      </div>
    </SettingRow>
  );
};

// ==================== MAIN COMPONENT ====================

const Settings: FC = () => {
  const { t, i18n } = useTranslation();
  const { theme, changeTheme } = useUI();
  const { success, error, info } = useNotification();
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const useSystemThemeValue = useSelector((state: RootState) => state.ui.useSystemTheme);

  // Redux app stats
  const folderCount = useSelector((state: RootState) => state.folders.allIds.length);
  const fileCount = useSelector((state: RootState) => state.files.allIds.length);
  const tagCount = useSelector((state: RootState) => state.tags.tags.length);
  const fileStats = useSelector(selectFilesStats);

  // Local state
  const [settings, setSettings] = useState<AppSettings>({
    ...DEFAULT_SETTINGS,
    theme: (theme as 'light' | 'dark') || 'light',
    language: i18n.language || 'fr',
  });

  // Modals
  const [isClearCacheModalOpen, setIsClearCacheModalOpen] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState<'bug' | 'feature' | 'other'>('bug');
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackEmail, setFeedbackEmail] = useState('');
  const [feedbackSending, setFeedbackSending] = useState(false);

  // Export / Import
  const [exportInProgress, setExportInProgress] = useState(false);
  const [exportPhase, setExportPhase] = useState('');
  const [importInProgress, setImportInProgress] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportMode, setExportMode] = useState<'plain' | 'encrypted'>('plain');
  const [exportPassword, setExportPassword] = useState('');
  const [exportPasswordConfirm, setExportPasswordConfirm] = useState('');
  const [showExportPw, setShowExportPw] = useState(false);
  const filesById = useSelector((state: RootState) => state.files.byId);
  const foldersById = useSelector((state: RootState) => state.folders.byId);
  const notesById = useSelector((state: RootState) => state.notes?.byId);
  const allFiles = useMemo(() => Object.values(filesById), [filesById]);
  const allFolders = useMemo(() => Object.values(foldersById), [foldersById]);
  const allNotes = useMemo(() => (notesById ? Object.values(notesById) : []), [notesById]);
  const allTags = useSelector((state: RootState) => (state.tags?.tags ? state.tags.tags : []));
  const activeProfileId = useSelector(
    (state: RootState) => state.profiles?.manifest?.activeProfileId || ''
  );
  const activeProfileName = useSelector((state: RootState) => {
    const manifest = state.profiles?.manifest;
    if (!manifest?.profiles || !manifest.activeProfileId) return 'Filarr';
    const p = manifest.profiles.find((pr: any) => pr.id === manifest.activeProfileId);
    return p?.name || 'Filarr';
  });

  // Security / password change
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordChanging, setPasswordChanging] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);

  // URL query params for deep linking (e.g. /settings?tab=security)
  const [searchParams] = useSearchParams();
  const securitySectionRef = useRef<HTMLDivElement>(null);

  // Scroll to security section if ?tab=security
  useEffect(() => {
    if (searchParams.get('tab') === 'security' && securitySectionRef.current) {
      securitySectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [searchParams]);

  // Color picker ref
  const colorInputRef = useRef<HTMLInputElement>(null);

  // Load settings from localStorage and apply saved color
  useEffect(() => {
    const savedSettings = profileStorage.getItem('filarr-settings');
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        setSettings((prev) => ({ ...prev, ...parsed }));
        // Apply saved accent color palette
        if (parsed.primaryColor && parsed.primaryColor !== '#87CEEB') {
          applyColorPalette(parsed.primaryColor);
        }
      } catch (err) {
        console.error('Erreur lors du chargement des paramètres:', err);
      }
    }
  }, []);

  // Save
  const saveSettings = useCallback((newSettings: AppSettings) => {
    setSettings(newSettings);
    profileStorage.setItem('filarr-settings', JSON.stringify(newSettings));
  }, []);

  // ==================== Handlers ====================

  const handleThemeChange = useCallback(
    (
      newTheme:
        | 'light'
        | 'dark'
        | 'space'
        | 'lofi'
        | 'sky'
        | 'aurora'
        | 'sakura'
        | 'crepuscule'
        | 'foret'
        | 'system'
    ) => {
      if (newTheme === 'system') {
        dispatch(setUseSystemTheme(true));
        saveThemePreferences({ ...loadThemePreferences(), useSystemTheme: true });
        const resolved = detectSystemTheme();
        const updatedSettings = { ...settings, theme: resolved };
        saveSettings(updatedSettings);
        changeTheme(resolved);
        document.documentElement.setAttribute('data-theme', resolved);
        success(t('settings.themeSystemEnabled'));
      } else {
        dispatch(setUseSystemTheme(false));
        saveThemePreferences({ ...loadThemePreferences(), useSystemTheme: false });
        const updatedSettings = { ...settings, theme: newTheme };
        saveSettings(updatedSettings);
        changeTheme(newTheme);
        document.documentElement.setAttribute('data-theme', newTheme);
        const themeLabels: Record<string, string> = {
          light: t('settings.theme_light'),
          dark: t('settings.theme_dark'),
          space: t('settings.theme_space', 'Espace'),
          lofi: t('settings.theme_lofi', 'Lofi'),
          sky: t('settings.theme_sky', 'Ciel'),
          aurora: t('settings.theme_aurora', 'Aurora'),
          sakura: t('settings.theme_sakura', 'Sakura'),
          crepuscule: t('settings.theme_crepuscule', 'Crépuscule'),
          foret: t('settings.theme_foret', 'Forêt'),
        };
        success(t('settings.themeEnabled', { theme: themeLabels[newTheme] || newTheme }));
      }
    },
    [settings, saveSettings, changeTheme, success, dispatch, t]
  );

  const handleColorChange = useCallback(
    (color: string) => {
      const updatedSettings = { ...settings, primaryColor: color };
      saveSettings(updatedSettings);
      if (color === '#87CEEB') {
        resetColorPalette();
      } else {
        applyColorPalette(color);
      }
      info(t('settings.accentColorUpdated'));
    },
    [settings, saveSettings, info, t]
  );

  const handleLanguageChange = useCallback(
    (lang: string) => {
      const updatedSettings = { ...settings, language: lang };
      saveSettings(updatedSettings);
      i18n.changeLanguage(lang);
      success(t('settings.languageUpdated'));
    },
    [settings, saveSettings, i18n, success, t]
  );

  const handleNotificationsToggle = useCallback(
    (enabled: boolean) => {
      const updatedSettings = { ...settings, notificationsEnabled: enabled };
      saveSettings(updatedSettings);
      if (enabled && 'Notification' in window) {
        Notification.requestPermission();
      }
      info(enabled ? t('settings.notificationsEnabled') : t('settings.notificationsDisabled'));
    },
    [settings, saveSettings, info, t]
  );

  const handleSoundToggle = useCallback(
    (enabled: boolean) => {
      const updatedSettings = { ...settings, soundEnabled: enabled };
      saveSettings(updatedSettings);
      info(enabled ? t('settings.soundsEnabled') : t('settings.soundsDisabled'));
    },
    [settings, saveSettings, info, t]
  );

  const confirmClearCache = useCallback(() => {
    try {
      // Clear profile-scoped cached data
      profileStorage.clearProfile();
      const keysToRemove: string[] = [];
      // Also clean non-prefixed legacy keys (except essentials)
      const essentialKeys = [
        'filarr-settings',
        'filarr-state',
        'appMode',
        'theme',
        'filarr-onboarding-complete',
        'filarr_device_id',
        'filarr-server-url',
        'filarr-auth-mode',
      ];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && !essentialKeys.includes(key) && !key.startsWith('p:')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));
      success(t('settings.clearCacheSuccess', { count: keysToRemove.length }));
      setIsClearCacheModalOpen(false);
    } catch (err) {
      console.error('Erreur lors du vidage du cache:', err);
      error(t('settings.clearCacheError'));
      setIsClearCacheModalOpen(false);
    }
  }, [success, error, t]);

  const confirmReset = useCallback(() => {
    saveSettings({ ...DEFAULT_SETTINGS });
    changeTheme('light');
    document.documentElement.removeAttribute('data-theme');
    resetColorPalette();
    i18n.changeLanguage('fr');
    success(t('settings.resetSuccess'));
    setIsResetModalOpen(false);
  }, [saveSettings, changeTheme, i18n, success, t]);

  // ==================== Password Change ====================

  const passwordStrength = useCallback(
    (pw: string): { score: number; label: string; color: string } => {
      let score = 0;
      if (pw.length >= 8) score++;
      if (pw.length >= 12) score++;
      if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
      if (/\d/.test(pw)) score++;
      if (/[^a-zA-Z0-9]/.test(pw)) score++;
      const levels = [
        { label: t('settings.passwordWeak', 'Faible'), color: '#ef4444' },
        { label: t('settings.passwordFair', 'Moyen'), color: '#f97316' },
        { label: t('settings.passwordGood', 'Bon'), color: '#eab308' },
        { label: t('settings.passwordStrong', 'Fort'), color: '#22c55e' },
        { label: t('settings.passwordVeryStrong', 'Excellent'), color: '#10b981' },
      ];
      const idx = Math.min(score, levels.length) - 1;
      return {
        score,
        label: idx >= 0 ? levels[idx].label : '',
        color: idx >= 0 ? levels[idx].color : '#94a3b8',
      };
    },
    [t]
  );

  // Detect whether a FEK (encryption password) already exists.
  // `hasHybridKey()` alone is unreliable because it reads the renderer-side
  // module variable `_fek`, which stays null in cloud-mode flows where the
  // main process handles FEK via IPC without ever importing it into the
  // renderer. We therefore combine both: renderer memory OR on-disk presence
  // (`.fek_safe` / `wrapped_fek.json` checked via `security:fekStatus`).
  const [fekOnDisk, setFekOnDisk] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const result = (await window.electron?.ipcRenderer?.invoke('security:fekStatus')) as
          | { active: boolean }
          | undefined;
        if (!cancelled) setFekOnDisk(result?.active ?? false);
      } catch {
        if (!cancelled) setFekOnDisk(false);
      }
    };
    refresh();
    // Re-check every 3s to catch async inits (cloud restore, pairing, etc.)
    const interval = window.setInterval(refresh, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);
  const fekExists = hasHybridKey() || fekOnDisk === true;
  const isSetMode = !fekExists; // true = "Define password", false = "Change password"

  const handlePasswordChange = useCallback(async () => {
    setPasswordError('');

    // In "change" mode, current password is required
    if (!isSetMode && !currentPassword) {
      setPasswordError(
        t('settings.passwordErrorCurrent', 'Veuillez entrer votre mot de passe actuel')
      );
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError(
        t(
          'settings.passwordErrorMinLength',
          'Le nouveau mot de passe doit contenir au moins 8 caractères'
        )
      );
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError(
        t('settings.passwordErrorMismatch', 'Les mots de passe ne correspondent pas')
      );
      return;
    }
    if (!isSetMode && currentPassword === newPassword) {
      setPasswordError(
        t('settings.passwordErrorSame', "Le nouveau mot de passe doit être différent de l'actuel")
      );
      return;
    }

    setPasswordChanging(true);
    try {
      if (isSetMode) {
        // First time: generate a new FEK and wrap it with the chosen password
        await initHybridCrypto(newPassword);
        success(t('settings.passwordSetSuccess', 'Mot de passe de chiffrement defini avec succes'));
      } else {
        // Re-wrap existing FEK with new password
        await rewrapFEK(currentPassword, newPassword);
        success(t('settings.passwordChangeSuccess', 'Mot de passe change avec succes'));
      }
      setIsPasswordModalOpen(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (err) {
      console.error('[Settings] Password operation failed:', err);
      if (isSetMode) {
        setPasswordError(
          t('settings.passwordSetError', 'Echec de la creation du mot de passe de chiffrement')
        );
      } else {
        setPasswordError(t('settings.passwordErrorWrong', 'Mot de passe actuel incorrect'));
      }
    } finally {
      setPasswordChanging(false);
    }
  }, [currentPassword, newPassword, confirmNewPassword, isSetMode, success, t]);

  const closePasswordModal = useCallback(() => {
    setIsPasswordModalOpen(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    setPasswordError('');
    setShowCurrentPw(false);
    setShowNewPw(false);
  }, []);

  // ==================== Export Vault ====================

  const handleExportVault = useCallback(async () => {
    setExportInProgress(true);
    setExportPhase('');

    try {
      const notes: NoteForExport[] = (allNotes as any[]).map((n: any) => ({
        id: n.id,
        title: n.title || 'Untitled',
        content: n.content || '',
        plainText: n.plainText || '',
        createdAt: n.createdAt || new Date().toISOString(),
        updatedAt: n.updatedAt || new Date().toISOString(),
        tagIds: n.tagIds || [],
        linkedNoteIds: n.linkedNoteIds || [],
        linkedFileIds: n.linkedFileIds || [],
        linkedFolderIds: n.linkedFolderIds || [],
        parentId: n.parentId ?? null,
        isDaily: n.isDaily ?? false,
        dailyDate: n.dailyDate,
        icon: n.icon,
        coverColor: n.coverColor,
        isPinned: n.isPinned ?? false,
      }));

      const tags: TagForExport[] = (allTags as any[]).map((t: any) => ({
        id: t.id,
        name: t.name,
        color: t.color,
      }));

      // Gather extra data for complete restoration
      const extras: ExportExtras = {
        settings: {
          theme: localStorage.getItem('theme'),
          styleSettings: localStorage.getItem('filarr-style-settings'),
        },
      };

      const result = await exportVault(
        allFiles as any,
        allFolders as any,
        notes,
        tags,
        {
          mode: exportMode,
          password: exportMode === 'encrypted' ? exportPassword : undefined,
          profileName: activeProfileName,
        },
        (progress: ExportProgress) => {
          setExportPhase(progress.phase);
        },
        extras
      );

      if (result) {
        success(
          t(
            'settings.exportSuccessDetail',
            `Export termine : ${(allFiles as any[]).length} fichiers, ${notes.length} notes, ${tags.length} tags`
          )
        );
        setIsExportModalOpen(false);
        setExportPassword('');
        setExportPasswordConfirm('');
        setExportMode('plain');
      }
    } catch (err) {
      console.error('[Settings] Export failed:', err);
      error(t('settings.exportError', "Echec de l'export"));
    } finally {
      setExportInProgress(false);
      setExportPhase('');
    }
  }, [
    allFiles,
    allFolders,
    allNotes,
    allTags,
    activeProfileName,
    exportMode,
    exportPassword,
    success,
    error,
    t,
  ]);

  // ==================== Import Vault ====================

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  const handleImportVault = useCallback(
    async (options: { filePath: string; password?: string }) => {
      setIsImportModalOpen(false);
      setImportInProgress(true);
      try {
        const { importVault } = await import('../../../../services/vault/vaultImportService');
        const result = await importVault({
          filePath: options.filePath,
          password: options.password,
        });

        if (!result) {
          // User cancelled file dialog
          return;
        }

        const { manifest, notes, settings: importedSettings, fileEntries } = result;

        // Restore notes into Redux
        for (const note of notes) {
          dispatch({
            type: 'notes/addNote',
            payload: {
              id: note.id,
              title: note.title,
              content: note.content,
              plainText: note.plainText,
              createdAt: note.createdAt,
              updatedAt: note.updatedAt,
              tagIds: note.tagIds || [],
              linkedNoteIds: note.linkedNoteIds || [],
              linkedFileIds: note.linkedFileIds || [],
              linkedFolderIds: note.linkedFolderIds || [],
              parentId: note.parentId ?? null,
              isDaily: note.isDaily ?? false,
              dailyDate: note.dailyDate,
              icon: note.icon,
              coverColor: note.coverColor,
              isPinned: note.isPinned ?? false,
              wordCount: (note.plainText || '').split(/\s+/).filter(Boolean).length,
              deletedAt: undefined,
            },
          });
        }

        // Restore tags
        if (manifest.tags?.length) {
          for (const tag of manifest.tags) {
            dispatch({ type: 'tags/addTag', payload: tag });
          }
        }

        // Restore folders (Redux + create metadata.json on disk)
        if (manifest.folders?.length) {
          for (const folder of manifest.folders) {
            // Add to Redux
            dispatch({
              type: 'folders/addFolder',
              payload: {
                id: folder.id,
                name: folder.name,
                parentId: folder.parentId,
                color: folder.color,
              },
            });
            // Create folder metadata on disk via saveFolder IPC
            try {
              await window.electron?.ipcRenderer?.invoke('saveFolder', {
                id: folder.id,
                name: folder.name,
                color: folder.color,
                parentId: folder.parentId || null,
                items: [],
              });
            } catch {
              // Non-fatal — folder will be visible but empty
            }
          }
        }

        // Restore files — addItemToFolder handles encryption + metadata
        let filesRestored = 0;
        if (fileEntries?.length) {
          for (const file of fileEntries) {
            try {
              const bytes =
                file.encoding === 'base64'
                  ? Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0))
                  : new TextEncoder().encode(file.data);

              await window.electron?.ipcRenderer?.invoke('addItemToFolder', file.folderId, {
                id: file.name,
                name: file.name,
                type: 'file',
                size: bytes.length,
                content: Array.from(bytes),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });
              filesRestored++;
            } catch {
              // Skip files that fail
            }
          }
        }

        // Restore settings
        if (importedSettings) {
          if (importedSettings.theme) {
            localStorage.setItem('theme', importedSettings.theme as string);
          }
          if (importedSettings.styleSettings) {
            localStorage.setItem('filarr-style-settings', importedSettings.styleSettings as string);
          }
        }

        // Persist notes to disk then reload to ensure they're visible
        const { saveNotesToDisk, loadNotesFromDisk } =
          await import('../../../../store/slices/notesSlice');
        await dispatch(saveNotesToDisk() as any);
        await dispatch(loadNotesFromDisk() as any);

        // Refresh folder view
        const { fetchFolders } = await import('../../../../store/slices/foldersSlice');
        await dispatch(fetchFolders() as any);

        success(
          t(
            'settings.importSuccess',
            `Import terminé : ${filesRestored} fichiers, ${notes.length} notes, ${manifest.folders?.length || 0} dossiers, ${manifest.tags?.length || 0} tags`
          )
        );
      } catch (err) {
        console.error('[Settings] Import failed:', err);
        error(t('settings.importError', "Echec de l'import"));
      } finally {
        setImportInProgress(false);
      }
    },
    [dispatch, success, error, t]
  );

  // ==================== Computed ====================

  const isCustomColor = !PRESET_COLORS.some((c) => c.value === settings.primaryColor);

  // Total file storage from Redux
  const totalFilesSize = fileStats.totalSize;

  // ==================== Render ====================

  return (
    <div className="flex flex-col w-full min-h-full bg-[var(--color-background-secondary)]">
      {/* ===== Header Banner ===== */}
      <div className="bg-[var(--color-surface)] border-b border-[var(--color-border-light)] px-6 py-6">
        <div className="max-w-[1200px] mx-auto flex items-center gap-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--color-primary-50)] text-[var(--color-primary-500)]">
            <SettingsIcon />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">
              {t('settings.title')}
            </h1>
            <p className="text-sm text-[var(--color-text-tertiary)]">{t('settings.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* ===== Content ===== */}
      <div className="max-w-[1200px] mx-auto w-full px-6 py-6 flex flex-col gap-5">
        {/* ── Lien: Profil ── */}
        <button
          onClick={() => navigate('/profile')}
          className="w-full flex items-center gap-4 px-6 py-4 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-sm hover:bg-[var(--color-surface-hover)] transition-colors text-left"
        >
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)]">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">
              {t('settings.profile')}
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
              {t('settings.profileDesc')}
            </p>
          </div>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-[var(--color-text-tertiary)]"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        {/* ── Section: Apparence ── */}
        <SectionCard
          icon={<PaletteIcon />}
          title={t('settings.appearance')}
          description={t('settings.appearanceDesc')}
        >
          {/* Theme toggle */}
          <SettingRow label={t('settings.theme')} description={t('settings.themeDesc')} vertical>
            <div className="grid grid-cols-3 gap-3">
              {[
                {
                  id: 'light' as const,
                  label: t('settings.theme_light'),
                  icon: <SunIcon />,
                  bg: '#FFFFFF',
                  sidebar: '#F8FAFC',
                  accent: '#E2E8F0',
                  text: '#334155',
                },
                {
                  id: 'dark' as const,
                  label: t('settings.theme_dark'),
                  icon: <MoonIcon />,
                  bg: '#0A0E1A',
                  sidebar: '#10141F',
                  accent: '#2A3142',
                  text: '#B8C5D6',
                },
                {
                  id: 'space' as const,
                  label: t('settings.theme_space', 'Espace'),
                  icon: null,
                  bg: '#0B0D1A',
                  sidebar: '#111425',
                  accent: '#2A2D4A',
                  text: '#A89FC0',
                },
                {
                  id: 'lofi' as const,
                  label: t('settings.theme_lofi', 'Lofi'),
                  icon: null,
                  bg: '#F5F0E8',
                  sidebar: '#EDE6D9',
                  accent: '#D4C9B8',
                  text: '#6B5D4F',
                },
                {
                  id: 'sky' as const,
                  label: t('settings.theme_sky', 'Ciel'),
                  icon: null,
                  bg: '#F0F7FF',
                  sidebar: '#E6F1FC',
                  accent: '#B8D4F0',
                  text: '#3E6890',
                },
                {
                  id: 'aurora' as const,
                  label: t('settings.theme_aurora', 'Aurora'),
                  icon: null,
                  bg: '#0B1120',
                  sidebar: '#111B2E',
                  accent: '#22D3A0',
                  text: '#94A3B8',
                },
                {
                  id: 'sakura' as const,
                  label: t('settings.theme_sakura', 'Sakura'),
                  icon: null,
                  bg: '#FFF8F9',
                  sidebar: '#FFF0F3',
                  accent: '#F2C4CF',
                  text: '#7A4A60',
                },
                {
                  id: 'crepuscule' as const,
                  label: t('settings.theme_crepuscule', 'Crépuscule'),
                  icon: null,
                  bg: '#1A1018',
                  sidebar: '#221620',
                  accent: '#E8845C',
                  text: '#B89A98',
                },
                {
                  id: 'foret' as const,
                  label: t('settings.theme_foret', 'Forêt'),
                  icon: null,
                  bg: '#0F1D15',
                  sidebar: '#15271C',
                  accent: '#6BBE7D',
                  text: '#A0BCA4',
                },
                {
                  id: 'system' as const,
                  label: t('settings.theme_system'),
                  icon: <MonitorIcon />,
                  bg: '',
                  sidebar: '',
                  accent: '',
                  text: '',
                },
              ].map((theme) => {
                const isSelected =
                  theme.id === 'system'
                    ? useSystemThemeValue
                    : settings.theme === theme.id && !useSystemThemeValue;
                return (
                  <button
                    key={theme.id}
                    onClick={() => handleThemeChange(theme.id)}
                    className={`
                      relative flex flex-col items-center gap-2 px-3 py-3 rounded-xl border-2 transition-all duration-200
                      ${
                        isSelected
                          ? 'border-[var(--color-primary-400)] bg-[var(--color-selected)] shadow-sm'
                          : 'border-[var(--color-border)] bg-[var(--color-background-secondary)] hover:border-[var(--color-border-strong)] hover:shadow-sm'
                      }
                    `}
                  >
                    <div
                      className="w-full rounded-lg overflow-hidden border"
                      style={{
                        height: 48,
                        display: 'flex',
                        borderColor: theme.id === 'system' ? '#CBD5E1' : theme.accent,
                      }}
                    >
                      {theme.id === 'system' ? (
                        <>
                          <div className="flex-1" style={{ background: '#FFFFFF', padding: 5 }}>
                            <div
                              style={{
                                height: 3,
                                width: 14,
                                background: '#E2E8F0',
                                borderRadius: 2,
                              }}
                            />
                          </div>
                          <div className="flex-1" style={{ background: '#0A0E1A', padding: 5 }}>
                            <div
                              style={{
                                height: 3,
                                width: 14,
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
                          <div style={{ flex: 1, padding: 5 }}>
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
                    <div className="flex items-center gap-1.5">
                      {theme.icon}
                      <span className="text-xs font-medium text-[var(--color-text-primary)]">
                        {theme.label}
                      </span>
                    </div>
                    {isSelected && (
                      <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-[var(--color-primary-500)] text-white flex items-center justify-center">
                        <CheckIcon />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </SettingRow>

          {/* Accent color */}
          <SettingRow
            label={t('settings.accentColor')}
            description={t('settings.accentColorDesc')}
            vertical
          >
            <div className="flex flex-wrap items-center gap-2.5">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color.value}
                  onClick={() => handleColorChange(color.value)}
                  title={color.name}
                  className={`
                    relative w-8 h-8 rounded-full transition-all duration-150
                    hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-primary-400)]
                    ${settings.primaryColor === color.value ? 'ring-2 ring-offset-2 ring-[var(--color-text-primary)] scale-110' : ''}
                  `}
                  style={{ backgroundColor: color.value }}
                >
                  {settings.primaryColor === color.value && (
                    <span className="absolute inset-0 flex items-center justify-center text-white">
                      <CheckIcon />
                    </span>
                  )}
                </button>
              ))}

              {/* Custom color */}
              <div className="relative">
                <button
                  onClick={() => colorInputRef.current?.click()}
                  title={t('settings.customColor')}
                  className={`
                    relative w-8 h-8 rounded-full border-2 border-dashed transition-all duration-150
                    hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-primary-400)]
                    ${
                      isCustomColor
                        ? 'ring-2 ring-offset-2 ring-[var(--color-text-primary)] scale-110 border-transparent'
                        : 'border-[var(--color-border-strong)]'
                    }
                  `}
                  style={isCustomColor ? { backgroundColor: settings.primaryColor } : {}}
                >
                  {isCustomColor ? (
                    <span className="absolute inset-0 flex items-center justify-center text-white">
                      <CheckIcon />
                    </span>
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center text-[var(--color-text-tertiary)]">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                      </svg>
                    </span>
                  )}
                </button>
                <input
                  ref={colorInputRef}
                  type="color"
                  value={settings.primaryColor}
                  onChange={(e) => handleColorChange(e.target.value)}
                  className="absolute inset-0 opacity-0 w-0 h-0 pointer-events-none"
                  tabIndex={-1}
                />
              </div>

              {/* Current color label */}
              <span className="ml-1 text-xs font-mono text-[var(--color-text-tertiary)] uppercase">
                {settings.primaryColor}
              </span>
            </div>
          </SettingRow>

          <FontSelector />
        </SectionCard>

        {/* ── Section: Langue ── */}
        <SectionCard
          icon={<GlobeIcon />}
          title={t('settings.languageSection')}
          description={t('settings.languageSectionDesc')}
        >
          <SettingRow label={t('settings.languageLabel')} description={t('settings.languageDesc')}>
            <select
              value={settings.language}
              onChange={(e) => handleLanguageChange(e.target.value)}
              className="
                min-w-[160px] px-3 py-2 text-sm font-medium rounded-lg
                bg-[var(--color-background-secondary)] text-[var(--color-text-primary)]
                border border-[var(--color-border)] cursor-pointer
                hover:border-[var(--color-border-strong)]
                focus:outline-none focus:border-[var(--color-primary-400)] focus:ring-2 focus:ring-[var(--color-primary-100)]
                transition-all duration-150
              "
            >
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </SettingRow>
        </SectionCard>

        {/* ── Section: Notifications ── */}
        <SectionCard
          icon={<BellIcon />}
          title={t('settings.notifications')}
          description={t('settings.notificationsDesc')}
        >
          <SettingRow
            label={t('settings.desktopNotifications')}
            description={t('settings.desktopNotificationsDesc')}
          >
            <ToggleSwitch
              checked={settings.notificationsEnabled}
              onChange={handleNotificationsToggle}
            />
          </SettingRow>

          <SettingRow label={t('settings.sounds')} description={t('settings.soundsDesc')}>
            <div className="flex items-center gap-3">
              <VolumeIcon />
              <ToggleSwitch checked={settings.soundEnabled} onChange={handleSoundToggle} />
            </div>
          </SettingRow>
        </SectionCard>

        {/* ── Section: Surveillance des téléchargements ── */}
        <SectionCard
          icon={
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          }
          title={t('settings.downloadsWatcher.title', 'Surveillance des téléchargements')}
          description={t(
            'settings.downloadsWatcher.subtitle',
            "Importer automatiquement les fichiers ajoutés dans un dossier de votre PC."
          )}
        >
          <DownloadsWatcherSection />
        </SectionCard>

        {/* ── Section: Sécurité ── */}
        <div ref={securitySectionRef}>
          <SectionCard
            icon={
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            }
            title={t('settings.securitySection', 'Securite')}
            description={t('settings.securitySectionDesc', 'Chiffrement et mot de passe')}
          >
            <SettingRow
              label={t('settings.encryption', 'Chiffrement')}
              description={t(
                'settings.encryptionDesc',
                'Algorithme utilise pour proteger vos fichiers'
              )}
            >
              <span className="inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-50 text-emerald-600">
                AES-256-GCM
              </span>
            </SettingRow>

            <SettingRow
              label={t('settings.fekStatus', 'Cle de chiffrement (FEK)')}
              description={t(
                'settings.fekStatusDesc',
                'Etat de la cle utilisee pour chiffrer vos fichiers'
              )}
            >
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-full ${
                  fekExists ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${fekExists ? 'bg-emerald-500' : 'bg-amber-500'}`}
                />
                {fekExists
                  ? t('settings.fekActive', 'Active')
                  : t('settings.fekInactive', 'Inactive')}
              </span>
            </SettingRow>

            <SettingRow
              label={
                isSetMode
                  ? t('settings.setPassword', 'Definir un mot de passe')
                  : t('settings.changePassword', 'Changer le mot de passe')
              }
              description={
                isSetMode
                  ? t(
                      'settings.setPasswordDesc',
                      'Activer le chiffrement de vos fichiers avec un mot de passe'
                    )
                  : t(
                      'settings.changePasswordDesc',
                      'Modifier le mot de passe de chiffrement. Vos fichiers ne seront pas re-chiffres.'
                    )
              }
            >
              <Button
                variant={isSetMode ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setIsPasswordModalOpen(true)}
              >
                {isSetMode
                  ? t('settings.setPasswordBtn', 'Activer')
                  : t('settings.changePasswordBtn', 'Modifier')}
              </Button>
            </SettingRow>

            <AutoLockSelect />
            <EnhancedLockToggle profileId={activeProfileId} />
          </SectionCard>
        </div>

        {/* ── Section: Stockage & Données ── */}
        <SectionCard
          icon={<DatabaseIcon />}
          title={t('settings.storage')}
          description={t('settings.storageDesc')}
        >
          {/* Total storage used by files */}
          <SettingRow label={t('settings.spaceUsed')} description={t('settings.spaceUsedDesc')}>
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">
              {formatBytes(totalFilesSize)}
            </span>
          </SettingRow>

          {/* App statistics */}
          <SettingRow label={t('settings.appStats')} vertical>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col items-center py-3 px-4 rounded-lg bg-[var(--color-background-secondary)] border border-[var(--color-border-light)]">
                <span className="text-lg font-bold text-[var(--color-text-primary)]">
                  {folderCount}
                </span>
                <span className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                  {t('settings.folders')}
                </span>
              </div>
              <div className="flex flex-col items-center py-3 px-4 rounded-lg bg-[var(--color-background-secondary)] border border-[var(--color-border-light)]">
                <span className="text-lg font-bold text-[var(--color-text-primary)]">
                  {fileCount}
                </span>
                <span className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                  {t('settings.files')}
                </span>
              </div>
              <div className="flex flex-col items-center py-3 px-4 rounded-lg bg-[var(--color-background-secondary)] border border-[var(--color-border-light)]">
                <span className="text-lg font-bold text-[var(--color-text-primary)]">
                  {tagCount}
                </span>
                <span className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                  {t('settings.tags')}
                </span>
              </div>
            </div>
          </SettingRow>

          {/* Clear cache */}
          <SettingRow label={t('settings.clearCache')} description={t('settings.clearCacheDesc')}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsClearCacheModalOpen(true)}
              leftIcon={<TrashIcon />}
            >
              {t('settings.clearCache')}
            </Button>
          </SettingRow>

          {/* Export vault */}
          <SettingRow
            label={t('settings.exportVault', 'Exporter tout')}
            description={t(
              'settings.exportVaultDesc',
              'Telecharger un ZIP contenant tous vos fichiers, notes et metadonnees'
            )}
          >
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsExportModalOpen(true)}
              leftIcon={
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              }
            >
              {t('settings.exportVaultBtn', 'Exporter')}
            </Button>
          </SettingRow>

          {/* Import vault */}
          <SettingRow
            label={t('settings.importVault', 'Importer un backup')}
            description={t(
              'settings.importVaultDesc',
              "Restaurer toutes les donnees depuis un fichier d'export Filarr"
            )}
          >
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsImportModalOpen(true)}
              disabled={importInProgress}
              leftIcon={
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              }
            >
              {importInProgress
                ? t('settings.importing', 'Import en cours...')
                : t('settings.importVaultBtn', 'Importer')}
            </Button>
          </SettingRow>
        </SectionCard>

        {/* ── Section: Feedback ── */}
        <SectionCard
          icon={<FeedbackIcon />}
          title={t('settings.feedback', 'Feedback')}
          description={t('settings.feedbackDesc', 'Aidez-nous a ameliorer Filarr')}
        >
          <SettingRow
            label={t('settings.feedbackReport', 'Signaler un probleme ou proposer une idee')}
            description={t(
              'settings.feedbackReportDesc',
              'Vos retours nous aident a construire un meilleur produit'
            )}
          >
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsFeedbackOpen(true)}
              leftIcon={<FeedbackIcon />}
            >
              {t('settings.feedbackSend', 'Envoyer un feedback')}
            </Button>
          </SettingRow>
        </SectionCard>

        {/* ── Section: À propos ── */}
        <SectionCard
          icon={<InfoIcon />}
          title={t('settings.about')}
          description={t('settings.aboutDesc')}
        >
          <SettingRow label={t('settings.version')}>
            <span
              className="
              inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-full
              bg-[var(--color-primary-50)] text-[var(--color-primary-600)]
            "
            >
              v{getAppVersion()}
            </span>
          </SettingRow>

          <SettingRow label={t('settings.credits')} vertical>
            <div className="rounded-lg bg-[var(--color-background-secondary)] border border-[var(--color-border-light)] p-4">
              <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                {t('settings.creditsText')}
              </p>
            </div>
          </SettingRow>

          <SettingRow
            label={t('settings.supportProject', 'Soutenir le projet')}
            description={t(
              'settings.supportProjectDesc',
              'Si Filarr vous est utile, vous pouvez soutenir son developpement'
            )}
          >
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  window.electron?.ipcRenderer?.send('open-external', 'https://ko-fi.com/filarr');
                }}
                leftIcon={
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M18 8h1a4 4 0 010 8h-1" />
                    <path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" />
                    <line x1="6" y1="1" x2="6" y2="4" />
                    <line x1="10" y1="1" x2="10" y2="4" />
                    <line x1="14" y1="1" x2="14" y2="4" />
                  </svg>
                }
              >
                Ko-fi
              </Button>
            </div>
          </SettingRow>

          <SettingRow label={t('settings.license')}>
            <span className="text-sm text-[var(--color-text-secondary)]">BSL 1.1</span>
          </SettingRow>

          <SettingRow label={t('settings.uiTour')} description={t('settings.uiTourDesc')}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                localStorage.removeItem('filarr-ui-tour-complete');
                success(t('settings.uiTourRelaunched'));
                // Dispatch a custom event so the UITour can react immediately
                window.dispatchEvent(new CustomEvent('filarr-tour-relaunch'));
                navigate('/');
              }}
            >
              {t('settings.uiTourRelaunch')}
            </Button>
          </SettingRow>

          <SettingRow
            label={t('settings.resetSettings')}
            description={t('settings.resetSettingsDesc')}
          >
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsResetModalOpen(true)}
              leftIcon={<ResetIcon />}
            >
              {t('settings.reset')}
            </Button>
          </SettingRow>
        </SectionCard>

        {/* Footer */}
        <p className="text-center text-xs text-[var(--color-text-tertiary)] pb-4">
          {t('settings.copyright')}
        </p>
      </div>

      {/* ===== Modal: Vider le cache ===== */}
      <Modal
        isOpen={isClearCacheModalOpen}
        onClose={() => setIsClearCacheModalOpen(false)}
        size="sm"
        title={t('settings.clearCache')}
      >
        <ModalBody>
          <p className="text-sm text-[var(--color-text-primary)]">
            {t('settings.clearCacheConfirm')}
          </p>
          <div className="mt-3 p-3 rounded-lg bg-amber-50 border-l-4 border-amber-500 text-sm text-amber-700">
            {t('settings.clearCacheWarning')}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setIsClearCacheModalOpen(false)}>
            {t('settings.cancel')}
          </Button>
          <Button variant="danger" onClick={confirmClearCache}>
            {t('settings.clearCache')}
          </Button>
        </ModalFooter>
      </Modal>

      {/* ===== Modal: Réinitialiser ===== */}
      <Modal
        isOpen={isResetModalOpen}
        onClose={() => setIsResetModalOpen(false)}
        size="sm"
        title={t('settings.resetSettings')}
      >
        <ModalBody>
          <p className="text-sm text-[var(--color-text-primary)]">{t('settings.resetConfirm')}</p>
          <div className="mt-3 p-3 rounded-lg bg-amber-50 border-l-4 border-amber-500 text-sm text-amber-700">
            {t('settings.resetWarning')}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setIsResetModalOpen(false)}>
            {t('settings.cancel')}
          </Button>
          <Button variant="danger" onClick={confirmReset}>
            {t('settings.reset')}
          </Button>
        </ModalFooter>
      </Modal>

      {/* ===== Modal: Definir / Changer le mot de passe ===== */}
      <Modal
        isOpen={isPasswordModalOpen}
        onClose={closePasswordModal}
        size="sm"
        title={
          isSetMode
            ? t('settings.setPassword', 'Definir un mot de passe')
            : t('settings.changePassword', 'Changer le mot de passe')
        }
      >
        <ModalBody>
          <div className="space-y-4">
            {isSetMode ? (
              <div className="p-3 rounded-lg bg-amber-50 border-l-4 border-amber-400 text-sm text-amber-700">
                {t(
                  'settings.setPasswordInfo',
                  "Le chiffrement n'est pas encore active. Definissez un mot de passe pour chiffrer vos fichiers avec AES-256-GCM. Ce mot de passe sera irrecuperable — conservez-le en lieu sur."
                )}
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-blue-50 border-l-4 border-blue-400 text-sm text-blue-700">
                {t(
                  'settings.changePasswordInfo',
                  'Le changement de mot de passe re-chiffre uniquement la cle de chiffrement (FEK). Vos fichiers ne sont pas modifies.'
                )}
              </div>
            )}

            {/* Current password — only in change mode */}
            {!isSetMode && (
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                  {t('settings.currentPassword', 'Mot de passe actuel')}
                </label>
                <div className="relative">
                  <input
                    type={showCurrentPw ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => {
                      setCurrentPassword(e.target.value);
                      setPasswordError('');
                    }}
                    className="w-full px-3 py-2 pr-10 text-sm rounded-lg bg-[var(--color-background)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-400)]"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPw(!showCurrentPw)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      {showCurrentPw ? (
                        <>
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </>
                      ) : (
                        <>
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </>
                      )}
                    </svg>
                  </button>
                </div>
              </div>
            )}

            {/* New password */}
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                {t('settings.newPassword', 'Nouveau mot de passe')}
              </label>
              <div className="relative">
                <input
                  type={showNewPw ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    setPasswordError('');
                  }}
                  className="w-full px-3 py-2 pr-10 text-sm rounded-lg bg-[var(--color-background)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-400)]"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPw(!showNewPw)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    {showNewPw ? (
                      <>
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </>
                    ) : (
                      <>
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </>
                    )}
                  </svg>
                </button>
              </div>
              {newPassword.length > 0 && (
                <div className="mt-2">
                  <div className="flex gap-1 mb-1">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div
                        key={i}
                        className="h-1 flex-1 rounded-full transition-colors"
                        style={{
                          backgroundColor:
                            i <= passwordStrength(newPassword).score
                              ? passwordStrength(newPassword).color
                              : 'var(--color-border)',
                        }}
                      />
                    ))}
                  </div>
                  <p className="text-xs" style={{ color: passwordStrength(newPassword).color }}>
                    {passwordStrength(newPassword).label}
                  </p>
                </div>
              )}
            </div>

            {/* Confirm new password */}
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                {t('settings.confirmNewPassword', 'Confirmer le nouveau mot de passe')}
              </label>
              <input
                type="password"
                value={confirmNewPassword}
                onChange={(e) => {
                  setConfirmNewPassword(e.target.value);
                  setPasswordError('');
                }}
                className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--color-background)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-400)]"
              />
              {confirmNewPassword.length > 0 && newPassword !== confirmNewPassword && (
                <p className="mt-1 text-xs text-red-500">
                  {t('settings.passwordErrorMismatch', 'Les mots de passe ne correspondent pas')}
                </p>
              )}
            </div>

            {passwordError && (
              <div className="p-3 rounded-lg bg-red-50 border-l-4 border-red-500 text-sm text-red-700">
                {passwordError}
              </div>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={closePasswordModal}>
            {t('settings.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={handlePasswordChange}
            disabled={
              passwordChanging ||
              (!isSetMode && !currentPassword) ||
              !newPassword ||
              !confirmNewPassword ||
              newPassword !== confirmNewPassword
            }
          >
            {passwordChanging
              ? t('settings.passwordChanging', 'Changement en cours...')
              : isSetMode
                ? t('settings.setPasswordBtn', 'Activer')
                : t('settings.changePasswordBtn', 'Modifier')}
          </Button>
        </ModalFooter>
      </Modal>

      {/* ===== Modal: Export vault ===== */}
      <Modal
        isOpen={isExportModalOpen}
        onClose={() => {
          if (!exportInProgress) {
            setIsExportModalOpen(false);
            setExportPassword('');
            setExportPasswordConfirm('');
            setExportMode('plain');
          }
        }}
        size="sm"
        title={t('settings.exportVault', 'Exporter tout')}
      >
        <ModalBody>
          <div className="space-y-4">
            {/* Mode selection */}
            <div className="space-y-3">
              {/* Plain option */}
              <label
                className="flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors"
                style={{
                  backgroundColor:
                    exportMode === 'plain'
                      ? 'var(--color-primary-50)'
                      : 'var(--color-background-secondary)',
                  border: `1px solid ${exportMode === 'plain' ? 'var(--color-primary-400)' : 'var(--color-border)'}`,
                }}
              >
                <input
                  type="radio"
                  name="exportMode"
                  checked={exportMode === 'plain'}
                  onChange={() => setExportMode('plain')}
                  className="mt-0.5 accent-[var(--color-primary-600)]"
                />
                <div>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">
                    {t('settings.exportPlain', 'Export en clair')}
                  </p>
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                    {t(
                      'settings.exportPlainDesc',
                      'ZIP lisible universellement. Ideal pour migrer vers un autre outil ou archiver.'
                    )}
                  </p>
                </div>
              </label>

              {/* Encrypted option */}
              <label
                className="flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors"
                style={{
                  backgroundColor:
                    exportMode === 'encrypted'
                      ? 'var(--color-primary-50)'
                      : 'var(--color-background-secondary)',
                  border: `1px solid ${exportMode === 'encrypted' ? 'var(--color-primary-400)' : 'var(--color-border)'}`,
                }}
              >
                <input
                  type="radio"
                  name="exportMode"
                  checked={exportMode === 'encrypted'}
                  onChange={() => setExportMode('encrypted')}
                  className="mt-0.5 accent-[var(--color-primary-600)]"
                />
                <div>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">
                    {t('settings.exportEncrypted', 'Export chiffre')}
                  </p>
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                    {t(
                      'settings.exportEncryptedDesc',
                      'ZIP protege par mot de passe AES-256. Ideal pour un backup securise.'
                    )}
                  </p>
                </div>
              </label>
            </div>

            {/* Password fields — only if encrypted mode */}
            {exportMode === 'encrypted' && (
              <div className="space-y-3 pt-1">
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                    {t('settings.exportBackupPassword', 'Mot de passe du backup')}
                  </label>
                  <div className="relative">
                    <input
                      type={showExportPw ? 'text' : 'password'}
                      value={exportPassword}
                      onChange={(e) => setExportPassword(e.target.value)}
                      placeholder={t(
                        'settings.exportPasswordPlaceholder',
                        'Choisissez un mot de passe...'
                      )}
                      className="w-full px-3 py-2 pr-10 text-sm rounded-lg bg-[var(--color-background)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-400)]"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowExportPw(!showExportPw)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        {showExportPw ? (
                          <>
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                            <line x1="1" y1="1" x2="23" y2="23" />
                          </>
                        ) : (
                          <>
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </>
                        )}
                      </svg>
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                    {t('settings.exportConfirmPassword', 'Confirmer le mot de passe')}
                  </label>
                  <input
                    type="password"
                    value={exportPasswordConfirm}
                    onChange={(e) => setExportPasswordConfirm(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--color-background)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-400)]"
                  />
                  {exportPasswordConfirm.length > 0 && exportPassword !== exportPasswordConfirm && (
                    <p className="mt-1 text-xs text-red-500">
                      {t(
                        'settings.passwordErrorMismatch',
                        'Les mots de passe ne correspondent pas'
                      )}
                    </p>
                  )}
                </div>
                <div className="p-3 rounded-lg bg-amber-50 border-l-4 border-amber-400 text-xs text-amber-700">
                  {t(
                    'settings.exportEncryptedWarning',
                    'Ce mot de passe est independant de votre mot de passe de profil. Conservez-le — il sera necessaire pour dechiffrer le backup.'
                  )}
                </div>
              </div>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => {
              setIsExportModalOpen(false);
              setExportPassword('');
              setExportPasswordConfirm('');
            }}
            disabled={exportInProgress}
          >
            {t('settings.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={handleExportVault}
            disabled={
              exportInProgress ||
              (exportMode === 'encrypted' &&
                (exportPassword.length < 1 || exportPassword !== exportPasswordConfirm))
            }
          >
            {exportInProgress
              ? t('settings.exporting', 'Export en cours...')
              : t('settings.exportVaultBtn', 'Exporter')}
          </Button>
        </ModalFooter>
      </Modal>

      {/* ===== Modal: Feedback ===== */}
      <Modal
        isOpen={isFeedbackOpen}
        onClose={() => {
          setIsFeedbackOpen(false);
          setFeedbackText('');
          setFeedbackEmail('');
          setFeedbackType('bug');
        }}
        size="md"
        title={t('settings.feedbackTitle', 'Envoyer un feedback')}
      >
        <ModalBody>
          <div className="space-y-4">
            {/* Type selector */}
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                {t('settings.feedbackTypeLabel', 'Type de retour')}
              </label>
              <div className="flex gap-2">
                {[
                  { value: 'bug' as const, label: t('settings.feedbackBug', 'Bug'), icon: '🐛' },
                  {
                    value: 'feature' as const,
                    label: t('settings.feedbackFeature', 'Idee'),
                    icon: '💡',
                  },
                  {
                    value: 'other' as const,
                    label: t('settings.feedbackOther', 'Autre'),
                    icon: '💬',
                  },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setFeedbackType(opt.value)}
                    className={`
                      flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium rounded-lg border transition-all
                      ${
                        feedbackType === opt.value
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary-50)] text-[var(--color-primary-600)] shadow-sm'
                          : 'border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                      }
                    `}
                  >
                    <span>{opt.icon}</span>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                {t('settings.feedbackDescription', 'Description')}
              </label>
              <textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder={
                  feedbackType === 'bug'
                    ? t(
                        'settings.feedbackBugPlaceholder',
                        'Decrivez le probleme rencontre, les etapes pour le reproduire...'
                      )
                    : feedbackType === 'feature'
                      ? t(
                          'settings.feedbackFeaturePlaceholder',
                          'Decrivez la fonctionnalite souhaitee et pourquoi elle serait utile...'
                        )
                      : t('settings.feedbackOtherPlaceholder', 'Dites-nous tout...')
                }
                rows={5}
                className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--color-background)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-400)] resize-none"
              />
            </div>

            {/* Email (optional) */}
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                {t('settings.feedbackEmail', 'Email (optionnel)')}
              </label>
              <input
                type="email"
                value={feedbackEmail}
                onChange={(e) => setFeedbackEmail(e.target.value)}
                placeholder={t('settings.feedbackEmailPlaceholder', 'Pour recevoir une reponse...')}
                className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--color-background)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-400)]"
              />
            </div>

            {/* Auto system info */}
            <div className="p-3 rounded-lg bg-[var(--color-background-secondary)] border border-[var(--color-border-light)]">
              <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                {t('settings.feedbackSystemInfo', 'Infos systeme jointes automatiquement')}
              </p>
              <p className="text-xs text-[var(--color-text-tertiary)] font-mono">
                Filarr v{getAppVersion()} · {navigator.platform} · {navigator.language}
              </p>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => {
              setIsFeedbackOpen(false);
              setFeedbackText('');
              setFeedbackEmail('');
              setFeedbackType('bug');
            }}
            disabled={feedbackSending}
          >
            {t('settings.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!feedbackText.trim() || feedbackSending}
            onClick={async () => {
              if (!feedbackText.trim()) return;
              setFeedbackSending(true);
              try {
                const feedbackEntry = {
                  id: Date.now().toString(),
                  type: feedbackType,
                  text: feedbackText,
                  email: feedbackEmail || null,
                  version: getAppVersion(),
                  platform: navigator.platform,
                  locale: navigator.language,
                  createdAt: new Date().toISOString(),
                };

                // Local-only build: persist feedback to localStorage for the user
                // to review or export. Forks may wire up their own remote endpoint.
                const stored = JSON.parse(localStorage.getItem('filarr-feedback') || '[]');
                stored.push(feedbackEntry);
                localStorage.setItem('filarr-feedback', JSON.stringify(stored));

                setIsFeedbackOpen(false);
                setFeedbackText('');
                setFeedbackEmail('');
                setFeedbackType('bug');
                success(t('settings.feedbackSuccess', 'Merci ! Votre feedback a été envoyé.'));
              } catch {
                error(t('settings.feedbackError', "Erreur lors de l'envoi du feedback"));
              } finally {
                setFeedbackSending(false);
              }
            }}
          >
            {feedbackSending
              ? t('settings.feedbackSending', 'Envoi...')
              : t('settings.feedbackSubmit', 'Envoyer')}
          </Button>
        </ModalFooter>
      </Modal>

      <ImportVaultModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImport={handleImportVault}
      />
    </div>
  );
};

export default Settings;
