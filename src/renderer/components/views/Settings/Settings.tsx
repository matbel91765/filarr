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
import {
  setUseSystemTheme,
  setFileClickBehavior,
  setHomeRecentNotes,
  setAnimatedBackground,
  setBarsMode,
  setNotesPanelsHover,
} from '../../../../store/slices/uiSlice';
import BarsModePicker from './BarsModePicker';
import type { BarsMode } from '../../../../store/slices/uiSlice';
import { selectOrgAppearance } from '../../../../store/slices/governanceSlice';
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
  isRecoveryPhraseConfigured,
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
import { sendFeedback } from '../../../../services/feedback/feedbackQueue';
import { isWebPlatform } from '../../../../services/platform/isWebPlatform';
import { APP_FONTS, applyAppFont, currentAppFontId } from '../../../../services/platform/appFonts';
import {
  applyPageWidth,
  currentPageWidth,
  type PageWidth,
} from '../../../../services/platform/pageWidth';
// Bundlé partout (localStorage seulement, aucun import web-only) — inerte sur desktop
import {
  isConnectorProxyOptedIn,
  isMetaProxyOptedIn,
  setConnectorProxyOptIn,
  setMetaProxyOptIn,
} from '../../../../platform/web/handlers/metaHandlers';
// Clé TMDB du connecteur « Films » — localStorage, jamais synchronisée
import {
  getTmdbApiKey,
  setTmdbApiKey,
  TMDB_API_KEY_URL,
} from '../../notes/extensions/inlineDatabase/types';

import type { RootState } from '../../../../store';
import { selectFilesStats } from '../../../../store/selectors/fileSelectors';
import { isEnterpriseHidden, setEnterpriseHidden } from '../../../../config/enterprise';
// Édition vivante (collaboration temps réel) — drapeau local, éteint par défaut
import { isLiveCollabEnabled, setLiveCollabEnabled } from '../../../../config/collab';
import AccountSyncSection from '../../settings/AccountSyncSection';
import DisplayNameSection from '../../settings/DisplayNameSection';
import PasskeysSection from '../../settings/PasskeysSection';
import NotesFormatSection from '../../settings/NotesFormatSection';
import ThemeStudio from '../../settings/ThemeStudio';
import type { CustomThemeSpec } from '../../../../services/theme/customTheme';
import {
  applyCustomTheme,
  loadCustomTheme,
  saveCustomTheme,
  unapplyCustomTheme,
} from '../../../../services/theme/customThemeStore';
import MigrationModal from '../../settings/MigrationModal';
import DisableSyncModal from '../../settings/DisableSyncModal';
import ManageDevicesModal from '../../settings/ManageDevicesModal';
import DeleteAccountModal from '../../settings/DeleteAccountModal';
import RecoveryKeyExportModal from '../../settings/RecoveryKeyExportModal';
import RecoveryKeyImportModal from '../../settings/RecoveryKeyImportModal';
import TwoFASetupModal from '../../settings/TwoFASetupModal';
import TwoFADisableModal from '../../settings/TwoFADisableModal';
import RegeneratePhraseModal from '../../settings/RegeneratePhraseModal';
import * as authApi from '../../../../services/auth/authApi';
import { useAuth } from '../../../../hooks/useAuth';
import ImportVaultModal from '../../settings/ImportVaultModal';
import DownloadsWatcherSection from '../../settings/DownloadsWatcherSection';
import DesktopProtectionSection from '../../settings/DesktopProtectionSection';
import HotFoldersSection from '../../settings/HotFoldersSection';
import WebClipperSection from '../../settings/WebClipperSection';
import HardwareKeySection from '../../settings/HardwareKeySection';
import DeviceTrustSection from '../../settings/DeviceTrustSection';
import HiddenVaultSection from '../../settings/HiddenVaultSection';

// Réglages de style de l'éditeur. La constante est dupliquée depuis NoteEditor
// à dessein : importer ce module ici tirerait tout tiptap dans le bundle des
// Paramètres. Elle passe par profileStorage comme là-bas, sinon l'export du
// coffre lirait une clé que plus personne n'écrit.
const STYLE_SETTINGS_KEY = 'filarr-style-settings';

// ==================== TYPES ====================

interface AppSettings {
  theme: // `custom` — la composition de l'atelier de thème. Elle n'a pas de bloc
    // dans la feuille de style : ses couleurs sont posées en style en ligne
    // depuis `customThemeStore`, et retirées avant de poser tout autre thème.
    | 'custom'
    | 'light'
    | 'dark'
    | 'space'
    | 'lofi'
    | 'sky'
    | 'aurora'
    | 'sakura'
    | 'crepuscule'
    | 'foret'
    | 'terracotta'
    | 'papier'
    | 'minuit';
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

const FontSelector: FC = () => {
  const { t } = useTranslation();

  const [currentFont, setCurrentFont] = useState(() => {
    // Le web affiche Jakarta par défaut (App.tsx) : refléter le vrai état.
    return currentAppFontId(isWebPlatform() ? 'jakarta' : 'inter') ?? 'inter';
  });

  const applyFont = useCallback((fontId: string) => {
    // La pose ET la persistance vivent dans `appFonts` : c'est le meme geste
    // que fait le demarrage, et c'etait la seule chose que les deux tables
    // avaient en commun sans le savoir.
    if (applyAppFont(fontId)) setCurrentFont(fontId);
  }, []);

  return (
    <SettingRow
      label={t('settings.font', 'Police d\u2019écriture')}
      description={t('settings.fontDesc', 'Choisissez la police utilisée dans l\u2019application.')}
      vertical
    >
      <div className="grid grid-cols-3 gap-2">
        {APP_FONTS.map((font) => (
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
              fontFamily: font.stack,
            }}
          >
            <span
              className="block text-sm font-semibold"
              style={{ color: 'var(--color-text-primary)', fontFamily: font.stack }}
            >
              {font.label}
            </span>
          </button>
        ))}
      </div>
    </SettingRow>
  );
};

// ==================== PAGE WIDTH SELECTOR ====================

/**
 * LA LARGEUR DES PAGES.
 *
 * Deux valeurs, et le libellé dit ce qui change plutôt que de nommer un
 * nombre : personne ne choisit « 1120 px », on choisit entre « une colonne
 * qui se lit » et « toute la fenêtre ».
 *
 * ⚠ L'ACCUEIL N'EST PAS CONCERNÉ, et la description le dit. Il porte son
 * propre réglage, dans sa propre barre d'édition, parce que sa largeur voyage
 * avec le document quand on le publie. Taire cette exception ferait passer
 * pour un défaut ce qui est une frontière.
 */
const PageWidthSelector: FC = () => {
  const { t } = useTranslation();
  const [width, setWidth] = useState<PageWidth>(() => currentPageWidth());

  const choose = useCallback((next: PageWidth) => {
    applyPageWidth(next);
    setWidth(next);
  }, []);

  const options: { id: PageWidth; label: string; hint: string }[] = [
    {
      id: 'centered',
      label: t('settings.pageWidth.centered', 'Centré'),
      hint: t('settings.pageWidth.centeredHint', 'Une colonne bornée, plus facile à lire.'),
    },
    {
      id: 'full',
      label: t('settings.pageWidth.full', 'Pleine largeur'),
      hint: t('settings.pageWidth.fullHint', 'Les pages occupent toute la fenêtre.'),
    },
  ];

  return (
    <SettingRow
      label={t('settings.pageWidth.label', 'Largeur des pages')}
      description={t(
        'settings.pageWidth.description',
        "S'applique aux coffres, à la marketplace, aux rappels et à la corbeille. L'accueil garde son propre réglage, dans sa barre de personnalisation."
      )}
      vertical
    >
      <div className="grid grid-cols-2 gap-2">
        {options.map((option) => (
          <button
            key={option.id}
            onClick={() => choose(option.id)}
            aria-pressed={width === option.id}
            className="px-3 py-2.5 rounded-lg text-left transition-all"
            style={{
              border:
                width === option.id
                  ? '2px solid var(--color-primary-500)'
                  : '1px solid var(--color-border)',
              backgroundColor:
                width === option.id ? 'var(--color-primary-50)' : 'var(--color-surface)',
              cursor: 'pointer',
            }}
          >
            <span
              className="block text-sm font-semibold"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {option.label}
            </span>
            <span className="block text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
              {option.hint}
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
    try {
      await window.electron?.ipcRenderer?.invoke('security:setEnhancedLock', profileId, newVal);
    } catch {
      // Le web sert `security:getEnhancedLock` (toujours false) mais pas encore
      // `setEnhancedLock` : le dispatcher lève, et la promesse partait en rejet
      // non géré pendant que la case restait cochée sans rien derrière. On
      // rétablit ce que le stockage sait vraiment.
      setEnabled(!newVal);
    }
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

// ==================== OPEN AT LOGIN ROW ====================

const OpenAtLoginRow: FC = () => {
  const { t } = useTranslation();
  const ipc = window.electron?.ipcRenderer;
  const [enabled, setEnabled] = useState(false);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    if (!ipc) return;
    ipc
      .invoke('app:get-open-at-login')
      .then((v: boolean | null) => {
        if (v === null || v === undefined) setAvailable(false);
        else setEnabled(!!v);
      })
      .catch(() => setAvailable(false));
  }, [ipc]);

  if (!available) return null;

  const handleToggle = async () => {
    if (!ipc) return;
    try {
      const applied = (await ipc.invoke('app:set-open-at-login', !enabled)) as boolean;
      setEnabled(!!applied);
    } catch (err) {
      console.warn('[OpenAtLoginRow] toggle failed:', err);
    }
  };

  return (
    <SettingRow
      label={t('settings.openAtLogin.label', 'Lancer Filarr au démarrage')}
      description={t(
        'settings.openAtLogin.description',
        "Démarre Filarr en arrière-plan à l'ouverture de session. Indispensable pour que les rappels se déclenchent même si vous n'avez pas ouvert l'app manuellement."
      )}
    >
      <ToggleSwitch checked={enabled} onChange={handleToggle} />
    </SettingRow>
  );
};

// ==================== SETTINGS SIDEBAR ====================

type SettingsCategoryId =
  | 'apparence'
  | 'langue'
  | 'notifications'
  | 'downloads'
  | 'hotfolders'
  | 'webclipper'
  | 'securite'
  | 'bureau'
  | 'hardwarekey'
  | 'hiddenvault'
  | 'compte'
  | 'stockage'
  | 'feedback'
  | 'apropos';

const SETTINGS_CATEGORY_IDS: readonly SettingsCategoryId[] = [
  'apparence',
  'langue',
  'notifications',
  'downloads',
  'hotfolders',
  'webclipper',
  'securite',
  'bureau',
  'hardwarekey',
  'hiddenvault',
  'compte',
  'stockage',
  'feedback',
  'apropos',
] as const;

const ShieldIcon: FC = () => (
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
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

/**
 * Icône « Protection du bureau » — bouclier au point de marque (vocabulaire
 * point-et-trait du glyphe Filarr : bouts ronds, point plein à la jonction).
 * Vecteur écrit à la main, cohérent avec les icônes heroicons-style du fichier.
 */
const DesktopShieldIcon: FC = () => (
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
    <path d="M12 3l7 3v5.2c0 4.4-2.9 7.4-7 8.8-4.1-1.4-7-4.4-7-8.8V6l7-3z" />
    <circle cx="12" cy="10.6" r="1.6" fill="currentColor" stroke="none" />
    <path d="M12 12.2v2.6" />
  </svg>
);

const ScissorsIcon: FC = () => (
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
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <line x1="20" y1="4" x2="8.12" y2="15.88" />
    <line x1="14.47" y1="14.48" x2="20" y2="20" />
    <line x1="8.12" y1="8.12" x2="12" y2="12" />
  </svg>
);

const HardwareKeyIcon: FC = () => (
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
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
  </svg>
);

const EyeOffIcon: FC = () => (
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
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

const UserCircleIcon: FC = () => (
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
    <circle cx="12" cy="10" r="3" />
    <path d="M6.5 19a6 6 0 0 1 11 0" />
  </svg>
);

const DownloadIcon: FC = () => (
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
);

const FolderIcon: FC = () => (
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
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

interface SettingsCategoryMeta {
  id: SettingsCategoryId;
  label: string;
  icon: React.ReactNode;
  group: 'general' | 'privacy' | 'sync' | 'automation' | 'data' | 'help';
  /** Lowercased keywords (in addition to the label) used by the search filter. */
  keywords: string[];
  /** Optional status indicator dot shown in the sidebar — surfaces attention items at a glance. */
  status?: { kind: 'warning' | 'info'; title: string };
}

/** Sidebar navigation for the Settings two-pane layout. */
const SettingsSidebar: FC<{
  categories: SettingsCategoryMeta[];
  selected: SettingsCategoryId;
  onSelect: (id: SettingsCategoryId) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
}> = ({ categories, selected, onSelect, searchValue, onSearchChange, searchPlaceholder }) => {
  const normalizedQuery = searchValue.trim().toLowerCase();
  const filtered = normalizedQuery
    ? categories.filter(
        (c) =>
          c.label.toLowerCase().includes(normalizedQuery) ||
          c.keywords.some((k) => k.includes(normalizedQuery))
      )
    : categories;

  // Group categories by their `group` field while preserving order.
  const groupOrder: SettingsCategoryMeta['group'][] = [
    'general',
    'privacy',
    'sync',
    'automation',
    'data',
    'help',
  ];
  const groupLabels: Record<SettingsCategoryMeta['group'], string> = {
    general: 'Général',
    privacy: 'Confidentialité',
    sync: 'Compte & Sync',
    automation: 'Automations',
    data: 'Données',
    help: 'Aide',
  };
  const grouped = groupOrder
    .map((g) => ({ group: g, items: filtered.filter((c) => c.group === g) }))
    .filter((g) => g.items.length > 0);

  return (
    <aside
      className="hidden md:flex flex-col shrink-0 w-[240px] h-full border-r border-[var(--color-border-light)] bg-[var(--color-surface)]"
      aria-label="Navigation des paramètres"
    >
      <div className="px-4 pt-4 pb-3 border-b border-[var(--color-border-light)]">
        <div className="relative">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] pointer-events-none"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full pl-8 pr-2 py-1.5 text-xs rounded-md bg-[var(--color-background-secondary)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-primary-400)] focus:ring-1 focus:ring-[var(--color-primary-100)]"
          />
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto py-2">
        {grouped.length === 0 ? (
          <p className="px-4 py-6 text-xs text-center text-[var(--color-text-tertiary)]">
            Aucun résultat
          </p>
        ) : (
          grouped.map(({ group, items }) => (
            <div key={group} className="mb-2">
              <p className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
                {groupLabels[group]}
              </p>
              <ul>
                {items.map((cat) => {
                  const isActive = cat.id === selected;
                  return (
                    <li key={cat.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(cat.id)}
                        aria-current={isActive ? 'page' : undefined}
                        className={`
                          w-full flex items-center gap-2.5 px-4 py-2 text-sm font-medium text-left
                          transition-colors
                          ${
                            isActive
                              ? 'bg-[var(--color-primary-50)] text-[var(--color-primary-600)] border-l-2 border-[var(--color-primary-500)]'
                              : 'text-[var(--color-text-secondary)] border-l-2 border-transparent hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
                          }
                        `}
                      >
                        <span
                          className={`shrink-0 ${isActive ? 'text-[var(--color-primary-500)]' : 'text-[var(--color-text-tertiary)]'}`}
                        >
                          {cat.icon}
                        </span>
                        <span className="truncate flex-1">{cat.label}</span>
                        {cat.status && (
                          <span
                            title={cat.status.title}
                            aria-label={cat.status.title}
                            className={`shrink-0 inline-block w-1.5 h-1.5 rounded-full ${
                              cat.status.kind === 'warning' ? 'bg-amber-500' : 'bg-sky-500'
                            }`}
                          />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </nav>
    </aside>
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
  const fileClickBehavior = useSelector((state: RootState) => state.ui.fileClickBehavior);
  const homeRecentNotes = useSelector((state: RootState) => state.ui.homeRecentNotes);
  const animatedBackground = useSelector((state: RootState) => state.ui.animatedBackground);
  const notesPanelsHover = useSelector((state: RootState) => state.ui.notesPanelsHover);
  const barsMode = useSelector((state: RootState) => state.ui.barsMode);
  /** La police en vigueur — lue au montage, comme le sélecteur de police. */
  const currentFontId = useMemo(
    () => currentAppFontId(isWebPlatform() ? 'jakarta' : 'inter') ?? 'inter',
    []
  );

  // Redux app stats
  const folderCount = useSelector((state: RootState) => state.folders.allIds.length);
  const fileCount = useSelector((state: RootState) => state.files.allIds.length);
  const tagCount = useSelector((state: RootState) => state.tags.tags.length);
  const fileStats = useSelector(selectFilesStats);

  /**
   * L'ATELIER DE THÈME et la composition retenue.
   *
   * `customSpec` est lu UNE FOIS au montage : c'est du stockage par profil, pas
   * un état partagé. Le relire à chaque rendu ferait un nouvel objet à chaque
   * fois, donc un aperçu qui se réinitialise sous les doigts.
   */
  const [studioOpen, setStudioOpen] = useState(false);
  const [customSpec, setCustomSpec] = useState<CustomThemeSpec | null>(() => loadCustomTheme());

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

  // Hide the enterprise space at startup (global preference).
  const [hideEnterprise, setHideEnterprise] = useState(isEnterpriseHidden());

  // Sync modals
  const [isMigrationOpen, setIsMigrationOpen] = useState(false);
  const [isDisableSyncOpen, setIsDisableSyncOpen] = useState(false);
  const [isDevicesOpen, setIsDevicesOpen] = useState(false);
  const [isDeleteAccountOpen, setIsDeleteAccountOpen] = useState(false);
  const cloudUser = useSelector((state: RootState) => state.auth.cloudUser);
  const { logout: logoutCloud } = useAuth();

  /**
   * Le détour par les Réglages a disparu. « Ajouter un compte cloud » posait un
   * drapeau `filarr.pending-cloud-setup` que cet effet relisait pour ouvrir la
   * migration dans le profil qu'on venait de créer de force. Le geste commence
   * désormais par la connexion, dans l'assistant, et ne passe plus par ici.
   *
   * La migration reste accessible depuis cette page pour ce qu'elle sait faire :
   * rattacher au nuage le profil DÉJÀ ouvert.
   */

  // Recovery key modals
  const [isRecoveryExportOpen, setIsRecoveryExportOpen] = useState(false);
  const [isRecoveryImportOpen, setIsRecoveryImportOpen] = useState(false);

  // 2FA state + modals (cloud accounts only)
  const [twofaEnabled, setTwofaEnabled] = useState(false);
  const [twofaBackupCount, setTwofaBackupCount] = useState(0);
  const [is2FASetupOpen, setIs2FASetupOpen] = useState(false);
  const [is2FADisableOpen, setIs2FADisableOpen] = useState(false);
  const [isRegenBackupOpen, setIsRegenBackupOpen] = useState(false);
  const [isRegenPhraseOpen, setIsRegenPhraseOpen] = useState(false);
  // Existing cloud accounts (created before the recovery-wrap fix) have no
  // recovery wrap → phrase recovery can't work until they set it up. Default true
  // to avoid a flash of the nudge before the check resolves.
  const [recoveryConfigured, setRecoveryConfigured] = useState(true);
  // The account's own key safety-number (E2-7), shown for out-of-band verification.
  const [ownFingerprint, setOwnFingerprint] = useState<string | null>(null);

  // Reload 2FA status whenever we open the page or after a toggle action.
  const refresh2FAStatus = useCallback(async () => {
    if (!cloudUser) {
      setTwofaEnabled(false);
      setTwofaBackupCount(0);
      return;
    }
    const result = await authApi.get2FAStatus();
    if (result.success && result.data) {
      setTwofaEnabled(result.data.enabled);
      setTwofaBackupCount(result.data.unusedBackupCodes);
    }
  }, [cloudUser]);

  // Whether phrase recovery is set up (cloud accounts only).
  const refreshRecoveryConfig = useCallback(async () => {
    if (!cloudUser) {
      setRecoveryConfigured(true);
      return;
    }
    setRecoveryConfigured(await isRecoveryPhraseConfigured());
  }, [cloudUser]);

  useEffect(() => {
    refresh2FAStatus();
    refreshRecoveryConfig();
  }, [refresh2FAStatus, refreshRecoveryConfig]);

  // Load the account's own key fingerprint (E2-7) for the out-of-band display.
  useEffect(() => {
    if (!cloudUser) {
      setOwnFingerprint(null);
      return;
    }
    void import('../../../../services/auth/userKeypairSync')
      .then(({ getOwnFingerprint }) => getOwnFingerprint())
      .then(setOwnFingerprint)
      .catch(() => undefined);
  }, [cloudUser]);

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

  // Aperçus de liens via le proxy serveur (web uniquement) — état miroir du localStorage
  const [metaProxyEnabled, setMetaProxyEnabled] = useState(isMetaProxyOptedIn);
  // Relais des connecteurs : consentement DISTINCT (ce ne sont pas les mêmes données)
  const [connectorProxyEnabled, setConnectorProxyEnabled] = useState(isConnectorProxyOptedIn);
  // Édition vivante : change la posture réseau, donc consentement à part
  const [liveCollabEnabled, setLiveCollabEnabledState] = useState(isLiveCollabEnabled);
  // Clé TMDB du connecteur « Films » des bases inline — reste sur cet appareil
  const [tmdbKeyDraft, setTmdbKeyDraft] = useState(getTmdbApiKey);
  const [showTmdbKey, setShowTmdbKey] = useState(false);

  // Security / password change
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordChanging, setPasswordChanging] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);

  // URL query params for deep linking (e.g. /settings?cat=securite, legacy ?tab=security)
  const [searchParams, setSearchParams] = useSearchParams();
  const rawCategoryParam =
    searchParams.get('cat') || (searchParams.get('tab') === 'security' ? 'securite' : null);
  const selectedCategory: SettingsCategoryId = SETTINGS_CATEGORY_IDS.includes(
    rawCategoryParam as SettingsCategoryId
  )
    ? (rawCategoryParam as SettingsCategoryId)
    : 'apparence';
  const handleSelectCategory = useCallback(
    (id: SettingsCategoryId) => {
      const next = new URLSearchParams(searchParams);
      next.set('cat', id);
      next.delete('tab');
      setSearchParams(next, { replace: true });
      // Reset scroll on category change so users land at the top of the panel.
      window.scrollTo({ top: 0 });
    },
    [searchParams, setSearchParams]
  );
  // Sidebar search input — purely local UI state.
  const [sidebarSearch, setSidebarSearch] = useState('');

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

  /**
   * Le verrou de thème de l'organisation.
   *
   * Il gouverne l'INTERFACE, jamais une frontière de sécurité — c'est écrit tel
   * quel dans l'écran d'administration qui le pose. Le garde ci-dessous n'est
   * donc pas là pour empêcher un contournement, mais pour que l'application ne
   * se contredise pas : une grille inerte qui changerait quand même le thème
   * serait une panne, pas une politique.
   */
  const orgAppearance = useSelector(selectOrgAppearance);
  const orgThemeLocked = orgAppearance.themeLocked;

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
        | 'terracotta'
        | 'papier'
        | 'minuit'
        | 'system'
    ) => {
      if (newTheme === 'system') {
        dispatch(setUseSystemTheme(true));
        saveThemePreferences({ ...loadThemePreferences(), useSystemTheme: true });
        const resolved = detectSystemTheme();
        const updatedSettings = { ...settings, theme: resolved };
        saveSettings(updatedSettings);
        changeTheme(resolved);
        // ⚠ Retirer AVANT de poser l'attribut : les jetons d'un thème composé
        // sont écrits en style en ligne sur `:root` et battent tous les blocs
        // `[data-theme='…']`. Sans ce retrait, l'attribut changerait sans que
        // l'écran change — « mon ancien thème ne part pas ».
        unapplyCustomTheme();
        document.documentElement.setAttribute('data-theme', resolved);
        success(t('settings.themeSystemEnabled'));
      } else {
        dispatch(setUseSystemTheme(false));
        saveThemePreferences({ ...loadThemePreferences(), useSystemTheme: false });
        const updatedSettings = { ...settings, theme: newTheme };
        saveSettings(updatedSettings);
        changeTheme(newTheme);
        // Voir plus haut : le style en ligne d'un thème composé survit à tout,
        // y compris au thème qu'on vient de choisir.
        unapplyCustomTheme();
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
          terracotta: t('settings.theme_terracotta', 'Terracotta'),
          papier: t('settings.theme_papier', 'Papier'),
          minuit: t('settings.theme_minuit', 'Minuit'),
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

        // In cloud mode, also update the account password on the server
        if (cloudUser) {
          try {
            await window.electron?.ipcRenderer?.invoke(
              'auth:changePassword',
              currentPassword,
              newPassword
            );
          } catch {
            // Non-fatal: FEK is already re-wrapped locally.
            // Cloud password will be out of sync but user can fix via forgot-password.
            console.warn('[Settings] Cloud password sync failed (non-fatal)');
          }
        }

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
  }, [currentPassword, newPassword, confirmNewPassword, isSetMode, cloudUser, success, t]);

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
          styleSettings: profileStorage.getItemWithLegacyFallback(STYLE_SETTINGS_KEY),
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
            profileStorage.setItem(STYLE_SETTINGS_KEY, importedSettings.styleSettings as string);
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

  // Category metadata for the sidebar — labels translated at render time.
  const categoriesMeta: SettingsCategoryMeta[] = [
    {
      id: 'apparence',
      label: t('settings.appearance'),
      icon: <PaletteIcon />,
      group: 'general',
      keywords: ['theme', 'thème', 'couleur', 'police', 'font', 'densité', 'apparence'],
    },
    {
      id: 'langue',
      label: t('settings.languageSection'),
      icon: <GlobeIcon />,
      group: 'general',
      keywords: ['langue', 'language', 'français', 'english', 'locale'],
    },
    {
      id: 'notifications',
      label: t('settings.notifications'),
      icon: <BellIcon />,
      group: 'general',
      keywords: ['notification', 'son', 'sound', 'rappel'],
    },
    {
      id: 'securite',
      label: t('settings.securitySection', 'Sécurité'),
      icon: <ShieldIcon />,
      group: 'privacy',
      keywords: [
        'sécurité',
        'security',
        'mot de passe',
        'password',
        'chiffrement',
        'encryption',
        '2fa',
        'fek',
        'recovery',
        'récupération',
        'lock',
        'verrouillage',
      ],
      status: !fekExists
        ? {
            kind: 'warning',
            // `settings.security` est une CHAÎNE (« Sécurité ») : toute clé
            // sous elle était inatteignable par construction, jamais traduite,
            // et le repli français s'affichait à tout le monde.
            title: t(
              'settings.securityNoFekWarning',
              'Aucun mot de passe défini — vos fichiers ne sont pas chiffrés.'
            ),
          }
        : undefined,
    },
    {
      id: 'bureau',
      label: t('settings.desktop.title', 'Protection du bureau'),
      icon: <DesktopShieldIcon />,
      group: 'privacy',
      keywords: [
        'bureau',
        'desktop',
        'protection',
        'déplacer',
        'move',
        'coffre',
        'vault',
        'raccourci',
        'hotkey',
        'tray',
        'zone de notification',
        'purge',
        'temporaire',
        'temp',
        'verrouillage session',
        'veille',
        'mini',
      ],
    },
    {
      id: 'hardwarekey',
      label: t('settings.hardwareKey.title', 'Clé de sécurité matérielle'),
      icon: <HardwareKeyIcon />,
      group: 'privacy',
      keywords: [
        'clé',
        'key',
        'yubikey',
        'webauthn',
        'passkey',
        'windows hello',
        'touch id',
        'fido',
        'matérielle',
        'hardware',
      ],
    },
    {
      id: 'hiddenvault',
      label: t('settings.hiddenVault.title', 'Vault caché'),
      icon: <EyeOffIcon />,
      group: 'privacy',
      keywords: [
        'vault caché',
        'hidden vault',
        'leurre',
        'decoy',
        'duress',
        'contrainte',
        'déni plausible',
        'plausible deniability',
      ],
    },
    {
      id: 'compte',
      label: t('settings.account', 'Compte & Synchronisation'),
      icon: <UserCircleIcon />,
      group: 'sync',
      // « invitation » et « rejoindre » mènent ici parce que c'est ici que vit
      // « J'ai une invitation » — le seul point de saisie manuelle, et sur le
      // bureau le seul chemin tout court. Sans ces mots, quelqu'un qui cherchait
      // où présenter son invitation ne trouvait rien et devait deviner la
      // catégorie parmi quatorze.
      keywords: [
        'compte',
        'account',
        'sync',
        'cloud',
        'plan',
        'abonnement',
        'devices',
        'email',
        'invitation',
        'invite',
        'rejoindre',
        'join',
        'coffre partagé',
      ],
    },
    {
      id: 'downloads',
      label: t('settings.downloadsWatcher.title', 'Surveillance des téléchargements'),
      icon: <DownloadIcon />,
      group: 'automation',
      keywords: ['téléchargement', 'download', 'watcher', 'surveillance', 'auto'],
    },
    {
      id: 'hotfolders',
      label: t('settings.hotFolders.title', 'Hot Folders'),
      icon: <FolderIcon />,
      group: 'automation',
      keywords: ['hot folder', 'dossier', 'folder', 'sync', 'watch'],
    },
    {
      id: 'webclipper',
      label: t('settings.webClipper.title', 'Web Clipper'),
      icon: <ScissorsIcon />,
      group: 'automation',
      keywords: [
        'clipper',
        'clip',
        'extension',
        'navigateur',
        'browser',
        'capture',
        'web',
        'article',
      ],
    },
    {
      id: 'stockage',
      label: t('settings.storage'),
      icon: <DatabaseIcon />,
      group: 'data',
      keywords: ['stockage', 'storage', 'cache', 'export', 'import', 'backup', 'données', 'data'],
    },
    {
      id: 'feedback',
      label: t('settings.feedback', 'Feedback'),
      icon: <FeedbackIcon />,
      group: 'help',
      keywords: ['feedback', 'retour', 'bug', 'idée', 'suggestion'],
    },
    {
      id: 'apropos',
      label: t('settings.about'),
      icon: <InfoIcon />,
      group: 'help',
      keywords: ['à propos', 'about', 'version', 'crédits', 'licence', 'reset', 'tour'],
    },
  ];
  const currentCategoryMeta = categoriesMeta.find((c) => c.id === selectedCategory);

  return (
    <div className="flex w-full h-full min-h-0 bg-[var(--color-background-secondary)]">
      <SettingsSidebar
        categories={categoriesMeta}
        selected={selectedCategory}
        onSelect={handleSelectCategory}
        searchValue={sidebarSearch}
        onSearchChange={setSidebarSearch}
        searchPlaceholder={t('settings.searchPlaceholder', 'Rechercher…')}
      />

      <div className="flex-1 flex flex-col min-w-0 min-h-0 h-full overflow-y-auto">
        {/* ===== Header Banner ===== */}
        <div className="sticky top-0 z-10 bg-[var(--color-surface)] border-b border-[var(--color-border-light)] px-6 py-4">
          <div className="max-w-[960px] mx-auto flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--color-primary-50)] text-[var(--color-primary-500)] shrink-0">
              {currentCategoryMeta?.icon ?? <SettingsIcon />}
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-[var(--color-text-primary)] truncate">
                {currentCategoryMeta?.label ?? t('settings.title')}
              </h1>
              <p className="text-xs text-[var(--color-text-tertiary)] truncate">
                {t('settings.subtitle')}
              </p>
            </div>
          </div>
        </div>

        {/* ===== Content ===== */}
        <div className="max-w-[960px] mx-auto w-full px-6 py-6 flex flex-col gap-5">
          {/* ── Lien: Profil (visible only in Compte category) ── */}
          {selectedCategory === 'compte' && (
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
          )}

          {/* ── Section: Apparence ── */}
          {selectedCategory === 'apparence' && (
            <SectionCard
              icon={<PaletteIcon />}
              title={t('settings.appearance')}
              description={t('settings.appearanceDesc')}
            >
              {/* Theme toggle */}
              <SettingRow
                label={t('settings.theme')}
                description={t('settings.themeDesc')}
                vertical
              >
                {/*
                  Un thème imposé par l'organisation le DIT, à l'endroit exact où
                  le choix se trouvait. Faire disparaître la grille laisserait
                  croire à une panne ; la laisser cliquable sans effet serait pire
                  encore. On la montre, inerte, et on nomme la raison.
                */}
                {orgThemeLocked && (
                  <div
                    className="mb-3 rounded-lg px-3 py-2 text-xs"
                    style={{
                      background: 'var(--color-background-tertiary)',
                      color: 'var(--color-text-secondary)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    {t(
                      'settings.themeLockedByOrg',
                      'Votre organisation a choisi le thème de l’application. Le choix n’est pas disponible sur ce poste.'
                    )}
                  </div>
                )}
                <div
                  className="grid grid-cols-3 gap-3"
                  style={orgThemeLocked ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
                  aria-disabled={orgThemeLocked || undefined}
                >
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
                      id: 'terracotta' as const,
                      label: t('settings.theme_terracotta', 'Terracotta'),
                      icon: null,
                      bg: '#F9F2EA',
                      sidebar: '#F2E7DB',
                      accent: '#C2542F',
                      text: '#6E5849',
                    },
                    {
                      id: 'papier' as const,
                      label: t('settings.theme_papier', 'Papier'),
                      icon: null,
                      bg: '#FFFFFF',
                      sidebar: '#FAF9F7',
                      accent: '#536878',
                      text: '#5F5C54',
                    },
                    {
                      id: 'minuit' as const,
                      label: t('settings.theme_minuit', 'Minuit'),
                      icon: null,
                      bg: '#0A0F1E',
                      sidebar: '#101728',
                      accent: '#E2AB55',
                      text: '#BCC3D6',
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

                  {/* LA CARTE « SUR MESURE ».
                      Rendue APRÈS la liste et non dedans : les entrées de la
                      liste sont typées par l'union des thèmes livrés, et y
                      glisser une treizième valeur aurait obligé à élargir cette
                      union pour une carte qui ne se comporte comme aucune
                      autre — elle n'applique rien, elle ouvre un atelier. */}
                  <button
                    onClick={() => setStudioOpen(true)}
                    className={`
                      relative flex flex-col items-center gap-2 px-3 py-3 rounded-xl border-2 transition-all duration-200
                      ${
                        settings.theme === 'custom' && !useSystemThemeValue
                          ? 'border-[var(--color-primary-400)] bg-[var(--color-selected)] shadow-sm'
                          : 'border-dashed border-[var(--color-border-strong)] bg-[var(--color-background-secondary)] hover:border-[var(--color-primary-400)] hover:shadow-sm'
                      }
                    `}
                  >
                    <div
                      className="w-full rounded-lg overflow-hidden border flex"
                      style={{
                        height: 48,
                        borderColor: 'var(--color-border-strong)',
                        // Les couleurs de la vignette sont celles de la
                        // composition ENREGISTRÉE quand il y en a une : la
                        // carte montre le thème qu'elle rappellera, pas un
                        // dégradé décoratif choisi au hasard.
                        background: customSpec
                          ? customSpec.ground
                          : 'linear-gradient(135deg, var(--color-primary-300), var(--color-primary-600))',
                      }}
                    >
                      {customSpec && (
                        <div
                          style={{
                            width: '30%',
                            background: customSpec.accent,
                            opacity: 0.35,
                          }}
                        />
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-[var(--color-text-primary)]">
                        {t('settings.themeStudio.cardTitle')}
                      </span>
                    </div>
                    {settings.theme === 'custom' && !useSystemThemeValue && (
                      <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-[var(--color-primary-500)] text-white flex items-center justify-center">
                        <CheckIcon />
                      </div>
                    )}
                  </button>
                </div>
              </SettingRow>

              <ThemeStudio
                isOpen={studioOpen}
                initial={customSpec}
                /* L'état COURANT de l'écran : c'est ce que les cases proposent
                   de figer dans le thème, et il doit être lu au moment où on
                   ouvre l'atelier — pas au montage des Paramètres. */
                current={{
                  fontId: currentFontId,
                  accentColor:
                    settings.primaryColor && settings.primaryColor !== '#87CEEB'
                      ? settings.primaryColor
                      : null,
                  barsMode,
                  notesPanelsHover,
                  animatedBackground,
                }}
                onClose={() => setStudioOpen(false)}
                onApply={(spec) => {
                  // ⚠ L'ÉCRITURE PEUT ÉCHOUER, ET IL FAUT LE DIRE.
                  //
                  // Un décor de deux mégaoctets fait sauter le quota du stockage
                  // local. Le thème s'applique quand même à l'écran — et il a
                  // disparu au redémarrage suivant. Avaler cet échec, ce que
                  // faisait la première version, donnait un réglage qui « ne
                  // tient pas » sans que rien n'explique pourquoi.
                  const kept = saveCustomTheme(spec);
                  applyCustomTheme(spec);

                  /**
                   * LE RESTE DE L'APPARENCE, SI LE THÈME EN PORTE.
                   *
                   * ⚠ On teste la PRÉSENCE de chaque champ, jamais sa valeur.
                   * `undefined` veut dire « ce thème n'a pas d'avis » ; `false`
                   * veut dire « ce thème demande que ce soit éteint ». Un
                   * `if (look.notesPanelsHover)` confondrait les deux et
                   * n'appliquerait jamais un « éteint » explicite.
                   */
                  const look = spec.appearance;
                  if (look) {
                    if (look.notesPanelsHover !== undefined) {
                      dispatch(setNotesPanelsHover(look.notesPanelsHover));
                    }
                    if (look.animatedBackground !== undefined) {
                      dispatch(setAnimatedBackground(look.animatedBackground));
                    }
                    if (look.barsMode !== undefined) {
                      dispatch(setBarsMode(look.barsMode as BarsMode));
                    }
                    if (look.fontId !== undefined) applyAppFont(look.fontId);
                    if (look.accentColor !== undefined) {
                      if (look.accentColor) applyColorPalette(look.accentColor);
                      else resetColorPalette();
                    }
                  }
                  setCustomSpec(spec);
                  setStudioOpen(false);
                  dispatch(setUseSystemTheme(false));
                  saveThemePreferences({ ...loadThemePreferences(), useSystemTheme: false });
                  saveSettings({ ...settings, theme: 'custom' });
                  changeTheme('custom');
                  if (kept) {
                    success(
                      t('settings.themeEnabled', { theme: t('settings.themeStudio.cardTitle') })
                    );
                  } else {
                    error(t('settings.themeStudio.notKept'));
                  }
                }}
              />

              {/* Fonds animés — juste sous le choix du thème, puisque c'est ce
                  qu'il modifie. Minuit est aujourd'hui le seul thème vivant. */}
              <SettingRow
                label={t('settings.animatedBackground.label', 'Fond animé')}
                description={t(
                  'settings.animatedBackground.description',
                  'Les thèmes vivants respirent : le ciel de Minuit scintille lentement. Désactivez pour économiser la batterie — les étoiles restent, elles cessent simplement de bouger.'
                )}
              >
                <ToggleSwitch
                  checked={animatedBackground}
                  onChange={(v) => dispatch(setAnimatedBackground(v))}
                />
              </SettingRow>

              {/* Panneaux des notes au survol. Activer le réglage DÉSÉPINGLE les
                  deux panneaux : sans cela ils resteraient là et le réglage
                  passerait pour cassé. */}
              <SettingRow
                label={t('settings.notesPanelsHover.label', 'Panneaux des notes au survol')}
                description={t(
                  'settings.notesPanelsHover.description',
                  'La liste des notes et le panneau de droite s’effacent et reviennent quand le pointeur atteint le bord de la page. Ctrl+B les épingle à nouveau.'
                )}
              >
                <ToggleSwitch
                  checked={notesPanelsHover}
                  onChange={(v) => dispatch(setNotesPanelsHover(v))}
                />
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

              <PageWidthSelector />

              <SettingRow
                label={t('settings.barsMode.label', 'Affichage des barres')}
                description={t(
                  'settings.barsMode.description',
                  "Choisissez les barres qui encadrent vos onglets : la barre supérieure (recherche, synchronisation, profil) et la barre d'onglets. Ctrl+Maj+B fait défiler ces modes à tout moment."
                )}
                vertical
              >
                <BarsModePicker />
              </SettingRow>

              <SettingRow
                label={t('settings.homeRecentNotes.label', "Notes récentes sur l'accueil")}
                description={t(
                  'settings.homeRecentNotes.description',
                  "Affiche vos dernières notes modifiées directement sur l'accueil. Les notes quotidiennes n'y figurent pas."
                )}
              >
                <ToggleSwitch
                  checked={homeRecentNotes}
                  onChange={(v) => dispatch(setHomeRecentNotes(v))}
                />
              </SettingRow>

              <SettingRow
                label={t('settings.fileClickBehavior.label', 'Comportement du clic sur un fichier')}
                description={t(
                  'settings.fileClickBehavior.description',
                  'Choisissez si un simple clic ouvre le panneau de détails (double-clic pour ouvrir le fichier) ou ouvre directement le fichier.'
                )}
              >
                <ToggleSwitch
                  checked={fileClickBehavior === 'details'}
                  onChange={() =>
                    dispatch(
                      setFileClickBehavior(fileClickBehavior === 'details' ? 'open' : 'details')
                    )
                  }
                />
              </SettingRow>

              <SettingRow
                label={t('settings.hideEnterprise.label', "Masquer l'espace entreprise")}
                description={t(
                  'settings.hideEnterprise.description',
                  "N'affiche plus le choix « Entreprise » au démarrage — l'app ouvre directement l'espace personnel. (La partie entreprise est de toute façon à venir.)"
                )}
              >
                <ToggleSwitch
                  checked={hideEnterprise}
                  onChange={(v) => {
                    setEnterpriseHidden(v);
                    setHideEnterprise(v);
                    info(
                      v
                        ? t('settings.hideEnterprise.on', 'Espace entreprise masqué au démarrage')
                        : t('settings.hideEnterprise.off', 'Espace entreprise affiché au démarrage')
                    );
                  }}
                />
              </SettingRow>
            </SectionCard>
          )}

          {/* ── Section: Langue ── */}
          {selectedCategory === 'langue' && (
            <SectionCard
              icon={<GlobeIcon />}
              title={t('settings.languageSection')}
              description={t('settings.languageSectionDesc')}
            >
              <SettingRow
                label={t('settings.languageLabel')}
                description={t('settings.languageDesc')}
              >
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
          )}

          {/* ── Section: Notifications ── */}
          {selectedCategory === 'notifications' && (
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

              <OpenAtLoginRow />
            </SectionCard>
          )}

          {/* ── Section: Surveillance des téléchargements ── */}
          {selectedCategory === 'downloads' && (
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
                'Importer automatiquement les fichiers ajoutés dans un dossier de votre PC.'
              )}
            >
              <DownloadsWatcherSection />
            </SectionCard>
          )}

          {/* ── Section: Hot Folders ── */}
          {selectedCategory === 'hotfolders' && (
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
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="2.5" />
                </svg>
              }
              title={t('settings.hotFolders.title', 'Hot Folders')}
              description={t(
                'settings.hotFolders.subtitle',
                'Surveiller des dossiers de votre PC et les synchroniser avec le vault, chiffré.'
              )}
            >
              <HotFoldersSection />
            </SectionCard>
          )}

          {/* ── Section: Web Clipper (#9) ── */}
          {selectedCategory === 'webclipper' && (
            <SectionCard
              icon={<ScissorsIcon />}
              title={t('settings.webClipper.title', 'Web Clipper')}
              description={t(
                'settings.webClipper.subtitle',
                'Capturer des pages web depuis votre navigateur, directement dans le vault chiffré.'
              )}
            >
              <WebClipperSection />
            </SectionCard>
          )}

          {/* ── Section: Clé de sécurité matérielle (#7) ── */}
          {selectedCategory === 'hardwarekey' && (
            <SectionCard
              icon={<HardwareKeyIcon />}
              title={t('settings.hardwareKey.title', 'Clé de sécurité matérielle')}
              description={t(
                'settings.hardwareKey.subtitle',
                'Déverrouiller le vault avec une YubiKey, Windows Hello ou Touch ID.'
              )}
            >
              <HardwareKeySection />
            </SectionCard>
          )}

          {/* ── Section: Confiance de l'appareil (E5-4, SSO) ── */}
          {selectedCategory === 'hardwarekey' && (
            <SectionCard
              icon={<HardwareKeyIcon />}
              title={t('settings.deviceTrust.title', 'Appareil de confiance (SSO)')}
              description={t(
                'settings.deviceTrust.subtitle',
                'Déverrouiller le coffre sans mot de passe après une connexion SSO, sur cet appareil.'
              )}
            >
              <DeviceTrustSection />
            </SectionCard>
          )}

          {/* ── Section: Protection du bureau (Wave 1) ── */}
          {selectedCategory === 'bureau' && (
            <SectionCard
              icon={<DesktopShieldIcon />}
              title={t('settings.desktop.title', 'Protection du bureau')}
              description={t(
                'settings.desktop.subtitle',
                'Import sécurisé, verrouillage lié à la session et purge des fichiers temporaires.'
              )}
            >
              <DesktopProtectionSection />
            </SectionCard>
          )}

          {/* ── Section: Vault caché (#6) ── */}
          {selectedCategory === 'hiddenvault' && (
            <SectionCard
              icon={<EyeOffIcon />}
              title={t('settings.hiddenVault.title', 'Vault caché')}
              description={t(
                'settings.hiddenVault.subtitle',
                'Un second mot de passe ouvre un profil leurre — déni plausible en cas de contrainte.'
              )}
            >
              <HiddenVaultSection />
            </SectionCard>
          )}

          {/* ── Section: Sécurité ── */}
          {selectedCategory === 'securite' && (
            <div className="mb-4">
              <PasskeysSection />
            </div>
          )}

          {selectedCategory === 'securite' && (
            <div>
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

                {isWebPlatform() && (
                  <SettingRow
                    label={t('settings.metaProxy.label', 'Aperçus de liens via le serveur')}
                    description={t(
                      'settings.metaProxy.description',
                      'Remplissage ⚡, titres de liens collés, aperçus de favoris : seule l’URL du lien est envoyée à nos serveurs — jamais le contenu de vos notes, jamais journalisée.'
                    )}
                  >
                    <ToggleSwitch
                      checked={metaProxyEnabled}
                      onChange={(v) => {
                        setMetaProxyOptIn(v);
                        setMetaProxyEnabled(v);
                      }}
                    />
                  </SettingRow>
                )}

                {isWebPlatform() && (
                  <SettingRow
                    label={t(
                      'settings.connectorProxy.label',
                      'Recherches de sources via le serveur'
                    )}
                    description={t(
                      'settings.connectorProxy.description',
                      'Bouton ⚡ des bases inline quand une source est choisie : seuls les quelques mots cherchés — et votre clé TMDB si la source Films est utilisée — sont envoyés à nos serveurs, jamais le contenu de vos notes, jamais journalisés. Interrupteur distinct de celui des aperçus de liens.'
                    )}
                  >
                    <ToggleSwitch
                      checked={connectorProxyEnabled}
                      onChange={(v) => {
                        setConnectorProxyOptIn(v);
                        setConnectorProxyEnabled(v);
                      }}
                    />
                  </SettingRow>
                )}

                <SettingRow
                  label={t('settings.liveCollab.label', 'Édition vivante entre mes appareils')}
                  description={t(
                    'settings.liveCollab.description',
                    'Écrivez la même note en même temps sur votre bureau et sur le web, en voyant le curseur de l’autre. Chaque modification et chaque message de présence est chiffré sur votre appareil : le relais apprend seulement quels appareils sont connectés à quelle note, quand, et la taille des messages — jamais un mot de leur contenu. Désactivé par défaut, car cela ouvre un canal permanent tant qu’une note est ouverte.'
                  )}
                >
                  <ToggleSwitch
                    checked={liveCollabEnabled}
                    onChange={(v) => {
                      setLiveCollabEnabled(v);
                      setLiveCollabEnabledState(v);
                    }}
                  />
                </SettingRow>

                <SettingRow
                  label={t('settings.tmdbKey.label', 'Clé TMDB (source Films)')}
                  description={t(
                    'settings.tmdbKey.description',
                    'Utilisée par le bouton ⚡ des bases inline quand la source de la table est « Films ». Stockée uniquement sur cet appareil, jamais synchronisée ni conservée sur nos serveurs : en desktop elle part directement vers TMDB, en web elle transite par notre relais, qui ne la journalise pas.'
                  )}
                  vertical
                >
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1 min-w-0">
                      <input
                        type={showTmdbKey ? 'text' : 'password'}
                        value={tmdbKeyDraft}
                        spellCheck={false}
                        autoComplete="off"
                        placeholder={t(
                          'settings.tmdbKey.placeholder',
                          'Collez votre clé d’API TMDB'
                        )}
                        aria-label={t('settings.tmdbKey.label', 'Clé TMDB (source Films)')}
                        onChange={(e) => setTmdbKeyDraft(e.target.value)}
                        // Écrit au blur/Enter : pas de clé tronquée enregistrée en cours de frappe
                        onBlur={() => setTmdbApiKey(tmdbKeyDraft)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                        className="w-full px-3 py-2 pr-10 text-sm rounded-lg bg-[var(--color-background)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-400)]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowTmdbKey(!showTmdbKey)}
                        aria-label={t('settings.tmdbKey.toggle', 'Afficher ou masquer la clé')}
                        aria-pressed={showTmdbKey}
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
                          {showTmdbKey ? (
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
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        window.electron?.ipcRenderer?.send('open-external', TMDB_API_KEY_URL)
                      }
                    >
                      {t('settings.tmdbKey.get', 'Obtenir une clé gratuite')}
                    </Button>
                    {tmdbKeyDraft !== '' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setTmdbApiKey('');
                          setTmdbKeyDraft('');
                        }}
                      >
                        {t('settings.tmdbKey.clear', 'Retirer')}
                      </Button>
                    )}
                  </div>
                </SettingRow>

                {isWebPlatform() && (
                  <SettingRow
                    label={t('settings.securityPosture.label', 'Modèle de sécurité du web')}
                    description={t(
                      'settings.securityPosture.description',
                      'Ce que l’application web garantit, et ce qu’elle ne peut pas garantir — sans superlatifs.'
                    )}
                  >
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        window.open(
                          i18n.language?.startsWith('fr') ? '/securite.html' : '/security.html',
                          '_blank',
                          'noopener,noreferrer'
                        )
                      }
                    >
                      {t('settings.securityPosture.action', 'Lire la page')}
                    </Button>
                  </SettingRow>
                )}

                <SettingRow
                  label={t('settings.recoveryKey', 'Clé de secours')}
                  description={t(
                    'settings.recoveryKeyDesc',
                    'Exportez ou restaurez une clé de secours pour récupérer vos données.'
                  )}
                  vertical
                >
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setIsRecoveryExportOpen(true)}
                    >
                      {t('settings.exportRecoveryKey', 'Exporter')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setIsRecoveryImportOpen(true)}
                    >
                      {t('settings.importRecoveryKey', 'Restaurer')}
                    </Button>
                  </div>
                </SettingRow>

                {cloudUser && (
                  <>
                    <SettingRow
                      label={t('settings.2fa.label', 'Double authentification (2FA)')}
                      description={
                        twofaEnabled
                          ? t(
                              'settings.2fa.enabledDesc',
                              'Activée. {{count}} codes de secours restants.',
                              { count: twofaBackupCount }
                            )
                          : t(
                              'settings.2fa.disabledDesc',
                              "Protégez votre compte avec une application d'authentification (TOTP)."
                            )
                      }
                      vertical
                    >
                      <div className="flex gap-2">
                        {twofaEnabled ? (
                          <>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setIsRegenBackupOpen(true)}
                            >
                              {t('settings.2fa.regenBackup', 'Régénérer les codes de secours')}
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setIs2FADisableOpen(true)}
                            >
                              {t('settings.2fa.disable', 'Désactiver')}
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => setIs2FASetupOpen(true)}
                          >
                            {t('settings.2fa.enable', 'Activer')}
                          </Button>
                        )}
                      </div>
                    </SettingRow>

                    {recoveryConfigured ? (
                      <SettingRow
                        label={t('settings.regenPhrase.label', 'Phrase de récupération')}
                        description={t(
                          'settings.regenPhrase.desc',
                          "Régénérez votre phrase de récupération à 24 mots. L'ancienne sera invalidée."
                        )}
                        vertical
                      >
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setIsRegenPhraseOpen(true)}
                        >
                          {t('settings.regenPhrase.button', 'Régénérer la phrase')}
                        </Button>
                      </SettingRow>
                    ) : (
                      <SettingRow
                        label={t(
                          'settings.regenPhrase.notConfiguredLabel',
                          'Récupération de compte non configurée'
                        )}
                        description={t(
                          'settings.regenPhrase.notConfiguredDesc',
                          "Configure une phrase de récupération pour pouvoir retrouver l'accès à tes données si tu oublies ton mot de passe. Sans elle, un oubli de mot de passe est irréversible."
                        )}
                        vertical
                      >
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => setIsRegenPhraseOpen(true)}
                        >
                          {t('settings.regenPhrase.setupButton', 'Configurer la récupération')}
                        </Button>
                      </SettingRow>
                    )}

                    {ownFingerprint && (
                      <SettingRow
                        label={t('settings.keyFingerprint.label', 'Empreinte de votre clé')}
                        description={t(
                          'settings.keyFingerprint.desc',
                          "Numéro de sécurité de votre clé. Communiquez-le hors-bande (appel, en personne) pour qu'un collègue vérifie que c'est bien votre clé avant de partager un coffre."
                        )}
                        vertical
                      >
                        <code
                          className="font-mono text-sm px-3 py-2 rounded select-all"
                          style={{
                            backgroundColor: 'var(--color-background-secondary)',
                            color: 'var(--color-text-primary)',
                            letterSpacing: '0.05em',
                          }}
                        >
                          {ownFingerprint}
                        </code>
                      </SettingRow>
                    )}
                  </>
                )}
              </SectionCard>
            </div>
          )}

          {/* ── Section: Compte & Synchronisation ── */}
          {selectedCategory === 'compte' && (
            <AccountSyncSection
              onEnableSync={() => setIsMigrationOpen(true)}
              onDisableSync={() => setIsDisableSyncOpen(true)}
              onManageDevices={() => setIsDevicesOpen(true)}
              onDeleteAccount={() => setIsDeleteAccountOpen(true)}
              onLogout={() => logoutCloud()}
            />
          )}

          {/* Rangement des notes (un seul fichier / une note un fichier).
              Bureau ET navigateur : le web a lui aussi un coffre, dans
              IndexedDB. Se masque toute seule là où la question ne se pose
              pas — un profil sans notes, ou un format qu'on n'a pas su lire. */}
          {selectedCategory === 'compte' && (
            <div className="mt-4">
              <DisplayNameSection />
            </div>
          )}

          {selectedCategory === 'compte' && (
            <div className="mt-4">
              <NotesFormatSection />
            </div>
          )}

          {/* ── Section: Stockage & Données ── */}
          {selectedCategory === 'stockage' && (
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
              <SettingRow
                label={t('settings.clearCache')}
                description={t('settings.clearCacheDesc')}
              >
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
          )}

          {/* ── Section: Feedback ── */}
          {selectedCategory === 'feedback' && (
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
          )}

          {/* ── Section: À propos ── */}
          {selectedCategory === 'apropos' && (
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

              {!isWebPlatform() && <UpdateCheckRow />}

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
                      window.electron?.ipcRenderer?.send(
                        'open-external',
                        'https://ko-fi.com/filarr'
                      );
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
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      window.electron?.ipcRenderer?.send(
                        'open-external',
                        'https://buy.stripe.com/28EfZiaOq0rd0Fl1uZ0Ny00'
                      );
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
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                      </svg>
                    }
                  >
                    Stripe
                  </Button>
                </div>
              </SettingRow>

              <SettingRow label={t('settings.license')}>
                <span className="text-sm text-[var(--color-text-secondary)]">ISC License</span>
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
          )}

          {/* Footer */}
          <p className="text-center text-xs text-[var(--color-text-tertiary)] pb-4">
            {t('settings.copyright')}
          </p>
        </div>
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

                /**
                 * `sendFeedback` poste, ou met de côté — et REJOUE la file au
                 * passage. L'ancien repli empilait dans `localStorage` sans que
                 * rien ne dépile jamais : les retours s'accumulaient,
                 * invisibles, pendant que cet écran remerciait pour un envoi
                 * qui n'avait pas eu lieu.
                 */
                const outcome = await sendFeedback(feedbackEntry);

                setIsFeedbackOpen(false);
                setFeedbackText('');
                setFeedbackEmail('');
                setFeedbackType('bug');
                // Deux verdicts, deux phrases : « mis de côté » n'est pas un
                // échec, mais ce n'est pas « envoyé » non plus.
                success(
                  outcome === 'sent'
                    ? t('settings.feedbackSuccess', 'Merci ! Votre feedback a été envoyé.')
                    : t(
                        'settings.feedbackQueued',
                        'Merci ! Aucun réseau pour le moment : votre retour partira automatiquement.'
                      )
                );
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

      {/* ── Sync Modals ── */}
      <MigrationModal
        isOpen={isMigrationOpen}
        onClose={() => setIsMigrationOpen(false)}
        onSuccess={() => setIsMigrationOpen(false)}
      />
      <DisableSyncModal
        isOpen={isDisableSyncOpen}
        onClose={() => setIsDisableSyncOpen(false)}
        userEmail={cloudUser?.email || ''}
      />
      <ManageDevicesModal
        isOpen={isDevicesOpen}
        onClose={() => setIsDevicesOpen(false)}
        profileId={activeProfileId}
      />
      <DeleteAccountModal
        isOpen={isDeleteAccountOpen}
        onClose={() => setIsDeleteAccountOpen(false)}
        userEmail={cloudUser?.email || ''}
      />
      <RecoveryKeyExportModal
        isOpen={isRecoveryExportOpen}
        onClose={() => setIsRecoveryExportOpen(false)}
        profileId={activeProfileId}
      />
      <RecoveryKeyImportModal
        isOpen={isRecoveryImportOpen}
        onClose={() => setIsRecoveryImportOpen(false)}
      />
      <TwoFASetupModal
        isOpen={is2FASetupOpen}
        onClose={() => {
          setIs2FASetupOpen(false);
          refresh2FAStatus();
        }}
        onEnabled={refresh2FAStatus}
      />
      <TwoFADisableModal
        isOpen={is2FADisableOpen}
        onClose={() => setIs2FADisableOpen(false)}
        onDisabled={refresh2FAStatus}
      />
      <RegeneratePhraseModal
        isOpen={isRegenBackupOpen}
        onClose={() => {
          setIsRegenBackupOpen(false);
          refresh2FAStatus();
        }}
        mode="backup"
        requireTotp={true}
      />
      <RegeneratePhraseModal
        isOpen={isRegenPhraseOpen}
        onClose={() => {
          setIsRegenPhraseOpen(false);
          refreshRecoveryConfig(); // clears the nudge once recovery is set up
        }}
        mode="recovery"
        requireTotp={twofaEnabled}
      />
      <ImportVaultModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImport={handleImportVault}
      />
    </div>
  );
};

export default Settings;

// ── « Rechercher une mise a jour » ─────────────────────────────────────────
//
// L'updater du bureau cherche seul au demarrage puis toutes les quatre heures,
// telecharge en silence et installe a la fermeture — sans ce bouton, rien ne
// permettait de demander ni de savoir. Le verdict est rendu ICI, en une
// phrase ; si une version se telecharge, le bandeau de Layout prend le relais.
// Bureau seulement : le web sert toujours le dernier build.

type UpdateCheckVerdict = {
  status: 'ready' | 'available' | 'up-to-date' | 'unsupported' | 'error';
  version?: string;
  current: string;
  error?: string;
};

function UpdateCheckRow() {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<UpdateCheckVerdict | null>(null);

  const check = async () => {
    setChecking(true);
    try {
      const r = (await window.electron?.ipcRenderer.invoke('app:checkForUpdates')) as
        | UpdateCheckVerdict
        | undefined;
      setVerdict(r ?? { status: 'error', current: getAppVersion(), error: 'no bridge' });
    } catch (e) {
      setVerdict({ status: 'error', current: getAppVersion(), error: (e as Error).message });
    } finally {
      setChecking(false);
    }
  };

  const line = (() => {
    if (checking) return t('settings.updateChecking');
    if (!verdict) return null;
    switch (verdict.status) {
      case 'up-to-date':
        return t('settings.updateUpToDate', { version: verdict.current });
      case 'available':
        return t('settings.updateAvailable', { version: verdict.version });
      case 'ready':
        return t('settings.updateReady', { version: verdict.version || '' });
      case 'unsupported':
        return t('settings.updateUnsupported');
      default:
        return t('settings.updateError', { error: verdict.error || '' });
    }
  })();

  return (
    <SettingRow label={t('settings.updateCheck')} description={t('settings.updateCheckDesc')}>
      <div className="flex flex-col items-end gap-1.5">
        <Button variant="secondary" size="sm" onClick={check} disabled={checking}>
          {checking ? t('settings.updateChecking') : t('settings.updateCheckAction')}
        </Button>
        {line && (
          <span
            className={
              verdict?.status === 'error'
                ? 'text-xs text-[var(--color-error)]'
                : 'text-xs text-[var(--color-text-secondary)]'
            }
          >
            {line}
          </span>
        )}
      </div>
    </SettingRow>
  );
}
