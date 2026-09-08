/**
 * VaultPasswordLock
 *
 * Full-screen overlay shown when the app is locked and the user
 * has no PIN configured. Requires the vault password to unlock
 * (re-initializes hybrid crypto from wrapped_fek.json).
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import ProfileAvatar from '../profiles/ProfileAvatar';
import { FilarrLogo } from '../ui/FilarrLogo';
import type { RootState, AppDispatch } from '../../../store';
import { unlockApp } from '../../../store/slices/authSlice';
import { fetchFolders } from '../../../store/slices/foldersSlice';
import { loadNotesFromDisk } from '../../../store/slices/notesSlice';
import { getHardwareKeyInfo } from '../../../services/auth/hybridCrypto';
import { isWebAuthnAvailable, unlockWithHardwareKey } from '../../../services/auth/hardwareKey';
import type { LockReason } from '../../../store/slices/authSlice';
import { selectIsPolicyDegraded } from '../../../store/slices/governanceSlice';
import { isWebPlatform } from '../../../services/platform/isWebPlatform';
import { Checkbox } from '../ui/Checkbox';
import { CredentialUsernameField } from '../ui/CredentialUsernameField';

const STAY_UNLOCKED_FLAG = 'filarr-web-stay-unlocked';

export const VaultPasswordLock: React.FC = () => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const policyDegraded = useSelector(selectIsPolicyDegraded);
  const localProfile = useSelector((state: RootState) => state.auth.localProfile);
  const manifest = useSelector((state: RootState) => state.profiles.manifest);
  const cloudUser = useSelector((state: RootState) => state.auth.cloudUser);
  const lockReason = useSelector((state: RootState) => state.auth.lockReason);
  const activeProfileMeta = manifest?.profiles.find((p) => p.id === manifest.activeProfileId);

  // Name resolution order — use the first non-empty source:
  //   1. profile metadata from manifest (authoritative, always populated
  //      once the profile is selected; works in both local and cloud mode)
  //   2. local profile from localStorage (legacy; may be null in cloud mode)
  //   3. email local-part extracted from cloudUser.email (post-cloud-login
  //      fallback before the manifest has been fetched)
  //   4. 'User' fallback — shown only if everything else is empty
  const displayName =
    activeProfileMeta?.name || localProfile?.name || cloudUser?.email?.split('@')[0] || 'User';
  const avatarColor = activeProfileMeta?.avatarColor || localProfile?.avatarColor || '#4682B4';

  // À QUEL COMPTE CE PROFIL EST-IL RATTACHÉ.
  //
  // Un nom d'affichage ne suffit pas : plusieurs profils peuvent porter le même,
  // et le mot de passe demandé ici n'est pas le même selon que le coffre est
  // purement local (clé dérivée sur cet appareil) ou rattaché à un compte Filarr
  // (FEK du compte, partagée entre les appareils). Sans ce repère, on tape à
  // l'aveugle — et un échec ne dit pas s'il s'agit du mauvais mot de passe ou du
  // mauvais profil.
  //
  // Source d'autorité : `cloudAccount` du manifeste (écrit à la connexion,
  // effacé à la déconnexion). `cloudUser` n'est qu'un repli pour la fenêtre où
  // la connexion vient d'aboutir mais le manifeste n'est pas encore relu.
  const boundEmail = activeProfileMeta?.cloudAccount?.email || cloudUser?.email || null;
  const accountLabel = boundEmail
    ? t('vaultLock.boundCloud', {
        defaultValue: 'Compte Filarr · {{email}}',
        email: boundEmail,
      })
    : t('vaultLock.boundLocal', {
        defaultValue: 'Profil local — cet appareil uniquement',
      });

  // POURQUOI l'écran est là. Six chemins verrouillent ; ils rendaient tous le
  // même écran muet.
  const REASON_TEXT: Record<LockReason, string> = {
    'auto-lock': t('vaultLock.reason.autoLock', {
      defaultValue: "Verrouillé après une période d'inactivité.",
    }),
    'enhanced-lock': t('vaultLock.reason.enhancedLock', {
      defaultValue:
        "Verrouillage renforcé : la clé de ce coffre n'est jamais conservée sur cet appareil entre deux sessions.",
    }),
    'no-key': t('vaultLock.reason.noKey', {
      defaultValue:
        "La clé de ce coffre n'est plus disponible sur cet appareil. Votre mot de passe la reconstruit.",
    }),
    logout: t('vaultLock.reason.logout', {
      defaultValue: 'Session fermée sur cet appareil.',
    }),
    policy: t('vaultLock.reason.policy', {
      defaultValue: 'Votre organisation exige une nouvelle validation.',
    }),
    manual: t('vaultLock.reason.manual', {
      defaultValue: 'Verrouillage demandé.',
    }),
  };
  const reasonText = lockReason ? REASON_TEXT[lockReason] : null;

  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [hwAvailable, setHwAvailable] = useState(false);
  // Web uniquement (QW-04, opt-in) : persiste la FEK scellée sous une clé de
  // session non-extractible, TTL 14 jours. Le flag est lu par hybrid:storeFEK
  // au moment du déverrouillage — cocher AVANT de soumettre.
  const [stayUnlocked, setStayUnlocked] = useState(() => {
    try {
      return localStorage.getItem(STAY_UNLOCKED_FLAG) === '1';
    } catch {
      return false;
    }
  });
  const inputRef = useRef<HTMLInputElement>(null);

  // Hardware key unlock (#7): offer the button only when a key is enrolled on
  // this device AND WebAuthn can run here (secure origin — not file://).
  useEffect(() => {
    let cancelled = false;
    if (!isWebAuthnAvailable()) return;
    getHardwareKeyInfo()
      .then((info) => {
        if (!cancelled && info.enrolled) setHwAvailable(true);
      })
      .catch(() => {
        /* no hardware key — password input is already shown */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      if (!password || checking) return;

      setChecking(true);
      setError('');

      try {
        // Dual-vault aware unlock (#6): with no hidden vault configured this
        // is exactly the old single-password unwrap. On a duress match we
        // switch to the decoy profile BEFORE persisting the FEK, so the real
        // profile's keychain entry is never touched.
        const { tryUnlockDualVault, getDecoyVaultInfo, persistFekToSafeStorage } =
          await import('../../../services/auth/hybridCrypto');
        const match = await tryUnlockDualVault(password);

        if (match === 'real') {
          // Web + « Rester déverrouillé » coché : persister la FEK scellée
          // (sur desktop, .fek_safe existe déjà — ce chemin n'y re-stocke que
          // si l'utilisateur web a opté ; le handler no-op sans le flag).
          if (isWebPlatform() && stayUnlocked) {
            await persistFekToSafeStorage().catch(() => {
              /* best effort — la session mémoire suffit */
            });
          }
          dispatch(unlockApp());
          // Reload folders + notes after unlock. When Enhanced Lock forced
          // the lock screen at startup, handleProfileSelected skipped these
          // loads (the app was locked, loading them would have raced with
          // the unlock). We must trigger them now to populate the UI.
          dispatch(fetchFolders());
          dispatch(loadNotesFromDisk());
        } else if (match === 'decoy') {
          // Read the decoy profile id while the REAL profile is still active
          // (the alt* fields live in its wrapped blob), then switch + persist
          // + reload so the whole app boots cleanly on the decoy profile.
          const { altProfileId } = await getDecoyVaultInfo();
          if (!altProfileId) throw new Error('Decoy profile missing');
          await window.electron.ipcRenderer.invoke('profile:activate', altProfileId);
          await persistFekToSafeStorage();
          window.location.reload();
        } else {
          setError(t('vaultLock.wrongPassword', 'Mot de passe incorrect. Veuillez réessayer.'));
          setPassword('');
          inputRef.current?.focus();
        }
      } catch (err) {
        // « La clé n'est pas disponible ici » n'est pas « mauvais mot de
        // passe » : le web le dit (réseau, profil d'un autre compte, compte
        // sans clé publiée) — retaper le bon mot de passe n'y changerait rien.
        const unavailable =
          !!err &&
          typeof err === 'object' &&
          (err as { code?: string }).code === 'wrapped_key_unavailable';
        setError(
          unavailable
            ? `${t('vaultLock.keyUnavailable', 'La clé de ce coffre n’est pas disponible ici.')} ${(err as Error).message}`
            : t('vaultLock.wrongPassword', 'Mot de passe incorrect. Veuillez réessayer.')
        );
        setPassword('');
        inputRef.current?.focus();
      } finally {
        setChecking(false);
      }
    },
    [password, checking, stayUnlocked, dispatch, t]
  );

  const handleHardwareUnlock = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    setError('');
    try {
      await unlockWithHardwareKey();
      dispatch(unlockApp());
      dispatch(fetchFolders());
      dispatch(loadNotesFromDisk());
    } catch {
      setError(
        t(
          'vaultLock.hardwareKeyFailed',
          'Échec du déverrouillage par clé de sécurité. Réessayez ou utilisez votre mot de passe.'
        )
      );
    } finally {
      setChecking(false);
    }
  }, [checking, dispatch, t]);

  return (
    // chrome:free — ecran centre, aucun controle dans la bande haute.
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--color-background)]">
      <div className="flex flex-col items-center max-w-sm w-full px-6">
        {/* Logo Filarr — marque l'app, pas juste une icône générique */}
        <FilarrLogo size={48} className="mb-6" />

        {/* Avatar du profil actif */}
        <ProfileAvatar
          name={displayName}
          avatarColor={avatarColor}
          avatarImage={activeProfileMeta?.avatarImage}
          size={64}
          className="mb-3"
        />

        <p className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">{displayName}</p>

        {/* Rattachement du profil — local, ou compte Filarr nommé. */}
        <div
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs mb-3 max-w-full"
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-secondary)',
          }}
          title={accountLabel}
        >
          <span aria-hidden="true">{boundEmail ? '☁' : '🖥'}</span>
          <span className="truncate">{accountLabel}</span>
        </div>

        <p
          className={`text-sm text-[var(--color-text-tertiary)] text-center ${
            reasonText ? 'mb-1' : 'mb-6'
          }`}
        >
          {t('vaultLock.subtitle', 'Saisissez votre mot de passe vault pour déverrouiller')}
        </p>
        {reasonText && (
          <p className="text-xs text-[var(--color-text-tertiary)] mb-6 text-center opacity-80">
            {reasonText}
          </p>
        )}

        {/* E9-10: degraded-mode disclosure — the org policy went stale offline, so the vault was
            locked. Honest: re-unlocking offline is possible (best-effort), but reconnecting restores
            full enforcement. */}
        {policyDegraded && (
          <div
            className="w-full mb-5 rounded-xl px-4 py-3 text-sm text-left"
            style={{
              backgroundColor: 'color-mix(in srgb, #f59e0b 14%, var(--color-surface))',
              border: '1px solid color-mix(in srgb, #f59e0b 40%, transparent)',
              color: 'var(--color-text-secondary)',
            }}
          >
            {t('org.governance.degraded.lock', {
              defaultValue:
                'Your organization requires a policy re-sync. This device has been offline past the allowed grace window, so the vault was locked. Reconnect to restore full access — offline unlock remains best-effort.',
            })}
          </div>
        )}

        {/* Password form */}
        <form onSubmit={handleSubmit} className="w-full">
          {/* Même raison que dans `VaultKeypairGate` : un mot de passe SEUL fait
              chercher au navigateur où écrire l'identifiant, et il le pose
              dans le premier champ de la page qui y ressemble. */}
          <CredentialUsernameField />
          <input
            ref={inputRef}
            type="password"
            autoComplete="current-password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('vaultLock.placeholder', 'Mot de passe vault')}
            autoFocus
            disabled={checking}
            className="w-full px-4 py-3 rounded-xl text-sm outline-none mb-3"
            style={{
              backgroundColor: 'var(--color-surface)',
              border: error ? '2px solid #f87171' : '2px solid var(--color-border)',
              color: 'var(--color-text-primary)',
              opacity: checking ? 0.5 : 1,
            }}
          />

          {error && <p className="text-sm text-red-500 mb-3 text-center">{error}</p>}

          {/* Web uniquement : « Rester déverrouillé » (QW-04, opt-in 14 jours).
              Sans objet sur desktop où safeStorage restaure la FEK. */}
          {isWebPlatform() && (
            <div className="mb-3">
              <Checkbox
                label={t(
                  'vaultLock.stayUnlocked',
                  'Rester déverrouillé sur cet appareil (14 jours)'
                )}
                checked={stayUnlocked}
                size="sm"
                onChange={(e) => {
                  const next = e.target.checked;
                  setStayUnlocked(next);
                  try {
                    localStorage.setItem(STAY_UNLOCKED_FLAG, next ? '1' : '0');
                  } catch {
                    /* mémoire seule */
                  }
                }}
              />
            </div>
          )}

          <button
            type="submit"
            disabled={!password || checking}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white
              bg-[var(--color-primary-600)] hover:bg-[var(--color-primary-700)]
              disabled:opacity-50 transition-all"
          >
            {checking
              ? t('vaultLock.unlocking', 'Déverrouillage...')
              : t('vaultLock.unlock', 'Déverrouiller')}
          </button>
        </form>

        {/* Hardware key unlock (#7) — alternative path, password always works */}
        {hwAvailable && (
          <button
            type="button"
            onClick={handleHardwareUnlock}
            disabled={checking}
            className="w-full mt-3 py-3 rounded-xl text-sm font-semibold
              border-2 border-[var(--color-border)] text-[var(--color-text-primary)]
              hover:border-[var(--color-primary-600)] disabled:opacity-50 transition-all"
          >
            🔑 {t('vaultLock.useHardwareKey', 'Utiliser ma clé de sécurité')}
          </button>
        )}
      </div>
    </div>
  );
};

export default VaultPasswordLock;
