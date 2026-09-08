/**
 * Protection du bureau — section Paramètres (Wave 1).
 *
 * Mode d'import par défaut (copier vs déplacer-dans-le-coffre), verrouillage
 * lié à la session OS, purge des fichiers temporaires en clair, raccourcis
 * globaux et démarrage réduit dans la zone de notification.
 *
 * Les préférences vivent dans settingsSlice (persisté par profil) et sont
 * MIROITÉES vers filarr-flags.json ('flag:set', clé 'desktop-protection') à
 * chaque changement : le main process les applique EN DIRECT (raccourcis,
 * powerMonitor, purge au verrouillage) et les relit au boot — il ne peut pas
 * lire Redux. L'enregistrement des raccourcis passe en plus par
 * 'app:setGlobalHotkey' qui retourne l'état réel par raccourci (une autre
 * application peut posséder la combinaison — la UI le dit).
 *
 * Honnêteté sécurité : la suppression sécurisée sur SSD est best-effort
 * (wear-leveling / TRIM) — le texte le dit explicitement et renvoie vers le
 * chiffrement de disque de l'OS (BitLocker / FileVault).
 */

import { FC, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../../../store';
import {
  selectDesktopProtection,
  updateDesktopProtection,
  setAutoLock,
  type DesktopProtectionSettings,
} from '../../../store/slices/settingsSlice';
import {
  mirrorDesktopSettingsToMain,
  applyGlobalHotkeys,
  purgeTempFiles,
} from '../../../services/features/desktopProtectionBridge';
import { Toggle } from '../ui/Toggle';
import { Radio } from '../ui/Radio';
import { Select } from '../ui/Dropdown';
import { Button } from '../ui/Button/Button';
import { useNotification } from '../ui/Notification';
import { ProtectedItemsSection } from '../protect';

// ==================== Rangée (même langage visuel que Settings.tsx) ====================

const Row: FC<{
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

// ==================== Éditeur de raccourci global ====================

/** Touches de modification seules — ignorées pendant la capture. */
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph']);

/** Convertit un KeyboardEvent en accélérateur Electron, ou null si invalide. */
function eventToAccelerator(e: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  // Exiger Ctrl/Cmd ou Alt : un raccourci GLOBAL sans modificateur fort
  // volerait des touches à tout le système.
  if (!e.ctrlKey && !e.metaKey && !e.altKey) return null;

  let key: string | null = null;
  if (/^[a-z]$/i.test(e.key)) key = e.key.toUpperCase();
  else if (/^[0-9]$/.test(e.key)) key = e.key;
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.key)) key = e.key;
  else if (e.key === ' ') key = 'Space';
  else if (e.key === 'ArrowUp') key = 'Up';
  else if (e.key === 'ArrowDown') key = 'Down';
  else if (e.key === 'ArrowLeft') key = 'Left';
  else if (e.key === 'ArrowRight') key = 'Right';
  if (!key) return null;

  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

/** Affichage lisible d'un accélérateur (chips kbd). */
function acceleratorParts(accelerator: string): string[] {
  const isMac = navigator.platform.toLowerCase().includes('mac');
  return accelerator
    .split('+')
    .map((part) => (part === 'CommandOrControl' ? (isMac ? '⌘' : 'Ctrl') : part));
}

const HotkeyEditor: FC<{
  value: string;
  /** false = l'OS a refusé l'enregistrement (combinaison déjà prise). */
  registered: boolean | null;
  disabled?: boolean;
  onChange: (accelerator: string) => void;
}> = ({ value, registered, disabled, onChange }) => {
  const { t } = useTranslation();
  const [capturing, setCapturing] = useState(false);
  const [invalidHint, setInvalidHint] = useState(false);

  useEffect(() => {
    if (!capturing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapturing(false);
        setInvalidHint(false);
        return;
      }
      if (MODIFIER_KEYS.has(e.key)) return; // attendre la touche finale
      const accelerator = eventToAccelerator(e);
      if (accelerator) {
        setCapturing(false);
        setInvalidHint(false);
        onChange(accelerator);
      } else {
        setInvalidHint(true);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [capturing, onChange]);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {capturing ? (
          <span
            className="px-3 py-1.5 text-xs font-medium rounded-lg animate-pulse"
            style={{
              border: '1.5px dashed var(--color-primary-500)',
              color: 'var(--color-primary-500)',
              backgroundColor: 'color-mix(in srgb, var(--color-primary-500) 8%, transparent)',
            }}
          >
            {t('settings.desktop.hotkeyCapture', 'Appuyez sur une combinaison…')}
          </span>
        ) : (
          <span className="flex items-center gap-1" aria-label={value}>
            {acceleratorParts(value).map((part, i) => (
              <kbd
                key={`${part}-${i}`}
                className="px-2 py-1 text-[11px] font-semibold rounded-md"
                style={{
                  backgroundColor: 'var(--color-background-secondary)',
                  border:
                    registered === false
                      ? '1px solid var(--color-warning-500)'
                      : '1px solid var(--color-border)',
                  color:
                    registered === false ? 'var(--color-warning-500)' : 'var(--color-text-primary)',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                {part}
              </kbd>
            ))}
          </span>
        )}
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => {
            setCapturing((prev) => !prev);
            setInvalidHint(false);
          }}
        >
          {capturing ? t('common.cancel', 'Annuler') : t('settings.desktop.hotkeyEdit', 'Modifier')}
        </Button>
      </div>
      {capturing && invalidHint && (
        <p className="text-[11px]" style={{ color: 'var(--color-warning-500)' }}>
          {t('settings.desktop.hotkeyInvalid', 'Utilisez au moins Ctrl/Cmd ou Alt + une touche.')}
        </p>
      )}
      {!capturing && registered === false && (
        <p className="text-[11px]" style={{ color: 'var(--color-warning-500)' }}>
          {t(
            'settings.desktop.hotkeyConflict',
            'Déjà utilisé par une autre application — choisissez une autre combinaison.'
          )}
        </p>
      )}
    </div>
  );
};

// ==================== Démarrer réduit (état détenu par l'OS) ====================

const StartInTrayRow: FC = () => {
  const { t } = useTranslation();
  const ipc = window.electron?.ipcRenderer;
  const [enabled, setEnabled] = useState(false);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    if (!ipc) {
      setAvailable(false);
      return;
    }
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
      // L'entrée de connexion passe '--hidden' : Filarr démarre dans la zone
      // de notification, sans fenêtre — même mécanisme que « Lancer au
      // démarrage » (l'état est détenu par l'OS, pas par Redux).
      const applied = (await ipc.invoke('app:set-open-at-login', !enabled)) as boolean;
      setEnabled(!!applied);
    } catch {
      // Refus de l'OS (stratégie d'entreprise, plateforme non gérée) — l'état
      // affiché reste celui réellement appliqué.
    }
  };

  return (
    <Row
      label={t('settings.desktop.startInTray', 'Démarrer réduit dans la zone de notification')}
      description={t(
        'settings.desktop.startInTrayDesc',
        "À l'ouverture de session, Filarr se lance en arrière-plan dans la zone de notification, sans ouvrir de fenêtre."
      )}
    >
      <Toggle
        checked={enabled}
        onChange={handleToggle}
        aria-label={t(
          'settings.desktop.startInTray',
          'Démarrer réduit dans la zone de notification'
        )}
      />
    </Row>
  );
};

// ==================== Section ====================

const AUTO_LOCK_VALUES = [0, 1, 5, 15, 30, 60] as const;

export const DesktopProtectionSection: FC = () => {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { success, error: notifyError, info, warning } = useNotification();

  const desktop = useSelector(selectDesktopProtection);
  const { autoLockEnabled, autoLockTimeout } = useSelector(
    (state: RootState) => state.settings.security
  );

  const [purging, setPurging] = useState(false);
  // null = pas encore interrogé ; par raccourci : true = enregistré.
  const [hotkeyRegistered, setHotkeyRegistered] = useState<{
    mini: boolean | null;
    lock: boolean | null;
  }>({ mini: null, lock: null });
  const [hotkeysUnavailable, setHotkeysUnavailable] = useState(false);

  // Garder une réf à jour pour composer l'état COMPLET envoyé au miroir
  // (les callbacks peuvent partir d'un state Redux pas encore rafraîchi).
  const desktopRef = useRef(desktop);
  desktopRef.current = desktop;

  /** (Ré)applique les raccourcis côté main + mémorise l'état réel par raccourci. */
  const applyHotkeys = useCallback(async (next: DesktopProtectionSettings) => {
    const res = await applyGlobalHotkeys({
      enabled: next.hotkeysEnabled,
      mini: next.hotkeyMini,
      lock: next.hotkeyLock,
    });
    if (res.ok) {
      const registered = res.data?.registered;
      setHotkeysUnavailable(false);
      setHotkeyRegistered({
        mini: next.hotkeysEnabled ? (registered?.mini ?? null) : null,
        lock: next.hotkeysEnabled ? (registered?.lock ?? null) : null,
      });
    } else if (res.unavailable) {
      // Main pas encore à jour : le miroir est écrit, prise en compte au
      // prochain démarrage — l'UI le dit au lieu de prétendre que c'est actif.
      setHotkeysUnavailable(true);
      setHotkeyRegistered({ mini: null, lock: null });
    }
  }, []);

  /** Patch Redux + miroir flags (appliqué EN DIRECT par le main) en une passe. */
  const update = useCallback(
    (patch: Partial<DesktopProtectionSettings>) => {
      dispatch(updateDesktopProtection(patch));
      const next = { ...desktopRef.current, ...patch };
      mirrorDesktopSettingsToMain(next).catch(() => {});
      return next;
    },
    [dispatch]
  );

  const handleHotkeyChange = useCallback(
    (patch: Partial<DesktopProtectionSettings>) => {
      const next = update(patch);
      void applyHotkeys(next);
    },
    [update, applyHotkeys]
  );

  // Au montage : interroger l'état réel des raccourcis (une combinaison peut
  // avoir été volée par une autre application depuis le dernier passage ici).
  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    void applyHotkeys(desktopRef.current);
  }, [applyHotkeys]);

  const handleImportModeChange = useCallback(
    (mode: 'copy' | 'move') => {
      // Passer à « Déplacer » réactive la confirmation à l'import : une
      // suppression d'originaux ne doit jamais devenir silencieuse par simple
      // changement de réglage (« Ne plus demander » se choisit dans le
      // dialogue lui-même).
      update(mode === 'move' ? { importMode: mode, askImportMode: true } : { importMode: mode });
    },
    [update]
  );

  const handleAutoLockChange = useCallback(
    (value: string | string[]) => {
      const minutes = parseInt(Array.isArray(value) ? value[0] : value, 10);
      if (Number.isNaN(minutes)) return;
      dispatch(setAutoLock({ enabled: minutes > 0, timeout: minutes }));
    },
    [dispatch]
  );

  const handlePurgeNow = useCallback(async () => {
    setPurging(true);
    try {
      const res = await purgeTempFiles();
      if (res.ok) {
        const deleted = res.data?.deletedCount ?? 0;
        const errors = res.data?.errors ?? 0;
        if (errors > 0) {
          warning(
            t(
              'settings.desktop.purgePartial',
              '{{count}} élément(s) purgé(s), {{errors}} en échec (fichier encore ouvert ?).',
              { count: deleted, errors }
            )
          );
        } else {
          success(
            t('settings.desktop.purgeDone', '{{count}} fichier(s) temporaire(s) purgé(s).', {
              count: deleted,
            })
          );
        }
      } else if (res.unavailable) {
        info(
          t(
            'settings.desktop.featureUnavailable',
            'Disponible après la prochaine mise à jour de Filarr.'
          )
        );
      } else {
        notifyError(res.error || t('settings.desktop.purgeFailed', 'Échec de la purge.'));
      }
    } finally {
      setPurging(false);
    }
  }, [success, info, warning, notifyError, t]);

  const autoLockValue = String(autoLockEnabled ? autoLockTimeout : 0);
  const autoLockOptions = AUTO_LOCK_VALUES.map((minutes) => ({
    value: String(minutes),
    label:
      minutes === 0
        ? t('settings.desktop.autoLockOff', 'Jamais')
        : minutes >= 60
          ? t('settings.desktop.autoLockHour', 'Après 1 heure')
          : t('settings.desktop.autoLockAfter', 'Après {{count}} min', { count: minutes }),
  }));

  const isMac = navigator.platform.toLowerCase().includes('mac');

  return (
    <>
      {/* ── Import par défaut ── */}
      <Row
        label={t('settings.desktop.importMode', "Comportement d'import par défaut")}
        description={t(
          'settings.desktop.importModeDesc',
          'À l’ajout d’un fichier dans le coffre (glisser-déposer ou sélecteur).'
        )}
        vertical
      >
        <div className="flex flex-col gap-2.5">
          <Radio
            name="desktop-import-mode"
            value="copy"
            checked={desktop.importMode === 'copy'}
            onChange={() => handleImportModeChange('copy')}
            label={t(
              'settings.desktop.importCopy',
              'Copier — l’original reste en clair à son emplacement'
            )}
            size="sm"
          />
          <Radio
            name="desktop-import-mode"
            value="move"
            checked={desktop.importMode === 'move'}
            onChange={() => handleImportModeChange('move')}
            label={t(
              'settings.desktop.importMove',
              'Déplacer dans le coffre — l’original est supprimé après vérification'
            )}
            size="sm"
          />
          <p
            className="text-[11px] leading-relaxed mt-1 px-3 py-2 rounded-lg"
            style={{
              color: 'var(--color-text-secondary)',
              backgroundColor: 'var(--color-background-tertiary)',
            }}
          >
            {t(
              'settings.desktop.secureDeleteNote',
              'La suppression sécurisée réécrit le fichier avant de l’effacer, mais sur un SSD le contrôleur peut conserver des copies internes (wear-leveling) : c’est un effort maximal, pas une garantie. Pour une protection complète du disque, activez {{feature}}.',
              {
                feature: isMac
                  ? t(
                      'settings.desktop.filevault',
                      'FileVault (Réglages Système → Confidentialité et sécurité)'
                    )
                  : t(
                      'settings.desktop.bitlocker',
                      'BitLocker (Paramètres Windows → Confidentialité et sécurité → Chiffrement de l’appareil)'
                    ),
              }
            )}
          </p>
        </div>
      </Row>

      <Row
        label={t('settings.desktop.askImport', 'Demander à chaque import')}
        description={t(
          'settings.desktop.askImportDesc',
          'Affiche le choix Copier / Déplacer à chaque ajout de fichiers.'
        )}
      >
        <Toggle
          checked={desktop.askImportMode}
          onChange={(e) => update({ askImportMode: e.target.checked })}
          aria-label={t('settings.desktop.askImport', 'Demander à chaque import')}
        />
      </Row>

      {/* ── Verrouillage ── */}
      <Row
        label={t('settings.autoLock', 'Verrouillage automatique')}
        description={t(
          'settings.desktop.autoLockDesc',
          'Verrouille le coffre après une période d’inactivité.'
        )}
      >
        <Select
          options={autoLockOptions}
          value={autoLockValue}
          onChange={handleAutoLockChange}
          size="sm"
          ariaLabel={t('settings.autoLock', 'Verrouillage automatique')}
        />
      </Row>

      <Row
        label={t('settings.desktop.lockOnOsLock', 'Verrouiller avec la session')}
        description={t(
          'settings.desktop.lockOnOsLockDesc',
          'Verrouille le coffre dès que la session de l’ordinateur est verrouillée (Win+L, écran de veille).'
        )}
      >
        <Toggle
          checked={desktop.lockOnOsLock}
          onChange={(e) => update({ lockOnOsLock: e.target.checked })}
          aria-label={t('settings.desktop.lockOnOsLock', 'Verrouiller avec la session')}
        />
      </Row>

      <Row
        label={t('settings.desktop.lockOnSuspend', 'Verrouiller à la mise en veille')}
        description={t(
          'settings.desktop.lockOnSuspendDesc',
          'Verrouille le coffre quand l’ordinateur se met en veille.'
        )}
      >
        <Toggle
          checked={desktop.lockOnSuspend}
          onChange={(e) => update({ lockOnSuspend: e.target.checked })}
          aria-label={t('settings.desktop.lockOnSuspend', 'Verrouiller à la mise en veille')}
        />
      </Row>

      <Row
        label={t('settings.desktop.purgeOnLock', 'Purger les temporaires au verrouillage')}
        description={t(
          'settings.desktop.purgeOnLockDesc',
          'Efface les copies de travail en clair (fichiers ouverts depuis le coffre) à chaque verrouillage.'
        )}
      >
        <Toggle
          checked={desktop.purgeTempOnLock}
          onChange={(e) => update({ purgeTempOnLock: e.target.checked })}
          aria-label={t('settings.desktop.purgeOnLock', 'Purger les temporaires au verrouillage')}
        />
      </Row>

      {/* ── Raccourcis globaux ── */}
      <Row
        label={t('settings.desktop.hotkeys', 'Raccourcis clavier globaux')}
        description={t(
          'settings.desktop.hotkeysDesc',
          'Fonctionnent partout dans le système, même quand Filarr est en arrière-plan.'
        )}
      >
        <Toggle
          checked={desktop.hotkeysEnabled}
          onChange={(e) => handleHotkeyChange({ hotkeysEnabled: e.target.checked })}
          aria-label={t('settings.desktop.hotkeys', 'Raccourcis clavier globaux')}
        />
      </Row>

      {desktop.hotkeysEnabled && (
        <>
          <Row
            label={t('settings.desktop.hotkeyMini', 'Ouvrir le mini-coffre')}
            description={t(
              'settings.desktop.hotkeyMiniDesc',
              'Affiche la petite fenêtre de protection rapide.'
            )}
          >
            <HotkeyEditor
              value={desktop.hotkeyMini}
              registered={hotkeyRegistered.mini}
              onChange={(accelerator) => handleHotkeyChange({ hotkeyMini: accelerator })}
            />
          </Row>
          <Row
            label={t('settings.desktop.hotkeyLock', 'Tout verrouiller')}
            description={t(
              'settings.desktop.hotkeyLockDesc',
              'Verrouille le coffre et purge les fichiers temporaires.'
            )}
          >
            <HotkeyEditor
              value={desktop.hotkeyLock}
              registered={hotkeyRegistered.lock}
              onChange={(accelerator) => handleHotkeyChange({ hotkeyLock: accelerator })}
            />
          </Row>
          {hotkeysUnavailable && (
            <div className="px-6 pb-3">
              <p
                className="text-xs px-3 py-2 rounded-lg"
                style={{
                  color: 'var(--color-text-secondary)',
                  backgroundColor: 'var(--color-background-tertiary)',
                }}
              >
                {t(
                  'settings.desktop.hotkeyPendingRestart',
                  'Enregistré — pris en compte au prochain démarrage de Filarr.'
                )}
              </p>
            </div>
          )}
        </>
      )}

      {/* ── Zone de notification ── */}
      <StartInTrayRow />

      {/* ── Purge manuelle ── */}
      <Row
        label={t('settings.desktop.purgeNow', 'Purger les fichiers temporaires maintenant')}
        description={t(
          'settings.desktop.purgeNowDesc',
          'Efface immédiatement toutes les copies de travail en clair laissées sur le disque.'
        )}
      >
        <Button variant="secondary" size="sm" loading={purging} onClick={handlePurgeNow}>
          {t('settings.desktop.purgeButton', 'Purger maintenant')}
        </Button>
      </Row>

      {/* ── Wave 2 : conteneurs .filarr protégés sur place ── */}
      <ProtectedItemsSection />
    </>
  );
};

export default DesktopProtectionSection;
