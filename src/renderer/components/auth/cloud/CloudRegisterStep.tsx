/**
 * CloudRegisterStep — Reusable cloud registration form
 *
 * Used in:
 *   - Onboarding (cloud flow, step 1)
 *   - Settings migration modal (local → cloud)
 *
 * Manages its own form state. Returns user + recoveryCodes via onSuccess.
 * Recovery codes are NEVER stored here — passed up to the parent immediately.
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as authApi from '../../../../services/auth/authApi';
import { isWebPlatform } from '../../../../services/platform/isWebPlatform';
import { takeInviteSignInHint } from '../../../../services/invites/inviteSignInHint';
import type { UserDTO } from '../../../../types/auth';
import { apiLoginWithPasskey, passkeysSupported } from '../../../../services/account/passkeysApi';
import TwoFAChallengeModal from '../../settings/TwoFAChallengeModal';
import TwoFAEnrollModal from './TwoFAEnrollModal';
import ForgotPasswordModal from '../../settings/ForgotPasswordModal';

// ── Helpers ─────────────────────────────────────────────────────────────────

function getPasswordStrength(pw: string): number {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

const STRENGTH_LABELS_FR = ['Très faible', 'Faible', 'Moyen', 'Fort', 'Très fort'];
const STRENGTH_LABELS_EN = ['Very weak', 'Weak', 'Medium', 'Strong', 'Very strong'];
const STRENGTH_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#16a34a'];

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

// ── Props ───────────────────────────────────────────────────────────────────

interface CloudRegisterStepProps {
  language: 'en' | 'fr';
  onSuccess: (result: { user: UserDTO; recoveryCodes: string[]; password: string }) => void;
  /** Called when user logs in with existing account (no recovery codes) */
  onLogin?: (result: { user: UserDTO; password: string }) => void;
  /**
   * Strict account type (0059) for NEW registrations. Enterprise accounts may
   * create/join orgs; personal accounts never can. Defaults to 'personal'.
   */
  accountType?: 'personal' | 'enterprise';
  /**
   * Connexion par CLÉ D'ACCÈS. Rend `needsPassword: true` quand cet appareil
   * n'a pas encore la clé du coffre : une clé d'accès ouvre le COMPTE, jamais
   * le coffre, et il faut alors le mot de passe une fois pour le déchiffrer.
   * Absent, le bouton n'est pas rendu.
   */
  onPasskeyLogin?: (user: UserDTO) => Promise<{ needsPassword: boolean }>;
  /** Which form to show first — 'login' for "connect to an existing account". */
  initialMode?: 'register' | 'login';
}

// ── Component ───────────────────────────────────────────────────────────────

const CloudRegisterStep: React.FC<CloudRegisterStepProps> = ({
  language,
  onSuccess,
  onLogin,
  onPasskeyLogin,
  accountType = 'personal',
  initialMode = 'register',
}) => {
  const { t } = useTranslation();

  /** Le compte se cree du cote entreprise : le formulaire est le meme, les
      phrases ne le sont pas. */
  const isOrg = accountType === 'enterprise';

  const [mode, setMode] = useState<'register' | 'login'>(initialMode);

  /*
    LE SSO FÉDÈRE LA SESSION, JAMAIS LA CLÉ. Le fournisseur d'identité dit
    « c'est bien elle » ; il ne voit ni le mot de passe du coffre ni la FEK,
    et ne le verra pas. Donc, une fois la session adoptée, il reste à OUVRIR
    le coffre : par la clé d'appareil si ce poste est enrôlé (E5-4), sinon en
    demandant une fois le mot de passe du coffre — le même que celui du
    compte. C'est ce que `ssoUser` retient entre les deux moments.

    Bureau seulement : la session revient par une boucle locale que seul un
    processus natif peut tenir. Sur le web, ni bouton ni promesse.
  */
  const ssoAvailable = isOrg && !isWebPlatform();
  const [ssoOrg, setSsoOrg] = useState<{ orgId: string; orgName: string } | null>(null);
  const [ssoBusy, setSsoBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [ssoUser, setSsoUser] = useState<{ id: string; email: string } | null>(null);
  const [ssoVaultPassword, setSsoVaultPassword] = useState('');
  /**
   * Pré-rempli par le REPÈRE laissé par l'écran d'invitation, quand il y en a un.
   *
   * POURQUOI. Une invitation reçue à l'adresse B, ouverte avec le compte A, mène
   * ici après un détour (déconnexion sur le web, retour au sélecteur de profils
   * sur le bureau). Sans ce repère, l'écran précédent montrait l'adresse à saisir
   * et ce champ s'ouvrait vide : il fallait la retenir et la retaper sans faute,
   * et une faute ramenait au même refus. Le repère se CONSOMME à la lecture et
   * périme en trente minutes — un champ pré-rempli par un souvenir d'hier serait
   * une surprise, pas un service.
   *
   * Lecture PARESSEUSE (dans l'initialiseur) et pas dans un effet : sous
   * StrictMode un effet est joué deux fois, et la seconde lecture ne trouverait
   * plus rien puisque la première a consommé le repère.
   */
  const [email, setEmail] = useState(() => takeInviteSignInHint() ?? '');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When the server reports `requires2FA`, we stash the password so the 2FA
  // challenge modal can forward it into the `onLogin` callback on success.
  // The MFA challenge token itself lives in the Electron main process.
  const [pending2FA, setPending2FA] = useState<string | null>(null);
  // E5-7: the org requires 2FA and this user has none — stash the password so we can re-login
  // automatically once they finish enrolling.
  const [enrolling, setEnrolling] = useState<string | null>(null);
  const [isForgotOpen, setIsForgotOpen] = useState(false);

  const strength = getPasswordStrength(password);
  const strengthLabels = language === 'fr' ? STRENGTH_LABELS_FR : STRENGTH_LABELS_EN;
  const emailValid = isValidEmail(email);
  const pwHasUpper = /[A-Z]/.test(password);
  const pwHasDigit = /[0-9]/.test(password);
  const pwLongEnough = password.length >= 10;
  const pwMatch = password === passwordConfirm && password.length > 0;
  const registerValid = emailValid && pwLongEnough && pwHasUpper && pwHasDigit && pwMatch;
  const loginValid = emailValid && password.length >= 1;
  const formValid = mode === 'register' ? registerValid : loginValid;

  const handleRegister = async () => {
    setRegistering(true);
    setError(null);
    try {
      const result = await authApi.register(email.trim(), password, accountType);
      if (result.success && result.recoveryCodes && result.user) {
        onSuccess({ user: result.user, recoveryCodes: result.recoveryCodes, password });
      } else {
        setError(result.error || 'Registration failed');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setRegistering(false);
    }
  };

  useEffect(() => {
    if (!ssoAvailable || mode !== 'login') {
      setSsoOrg(null);
      return;
    }
    const at = email.indexOf('@');
    if (at <= 0 || at === email.length - 1) {
      setSsoOrg(null);
      return;
    }
    // Une frappe par seconde au plus : la route est publique et limitée par IP.
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const r = await authApi.ssoResolve(email.trim());
        if (!cancelled) setSsoOrg(r.success && r.data ? r.data : null);
      } catch {
        if (!cancelled) setSsoOrg(null);
      }
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [email, mode, ssoAvailable]);

  const handleSsoLogin = async () => {
    if (!ssoOrg) return;
    setSsoBusy(true);
    setError(null);
    try {
      const r = await authApi.ssoLogin(ssoOrg.orgId);
      if (!r.success || !r.user) {
        if (r.code !== 'sso_cancelled') {
          setError(t(`onboarding.cloud.login.sso.${r.code ?? 'failed'}`, r.error || 'SSO failed'));
        }
        return;
      }
      // Session adoptée. Si ce poste sait déjà ouvrir le coffre, on n'insiste pas.
      const hasKey = await window.electron?.ipcRenderer?.invoke('hybrid:hasKey').catch(() => false);
      if (hasKey && onLogin) {
        onLogin({ user: r.user, password: '' });
        return;
      }
      setSsoUser({ id: r.user.id, email: r.user.email });
    } catch {
      setError(t('onboarding.cloud.login.sso.failed', 'SSO failed'));
    } finally {
      setSsoBusy(false);
    }
  };

  /**
   * SE CONNECTER AVEC UNE CLÉ D'ACCÈS.
   *
   * Elle ouvre le COMPTE : les jetons de session, et rien de plus. Le coffre
   * se déchiffre avec une clé dérivée du mot de passe, gardée sur l'appareil
   * après la première fois. Sur un appareil qui l'a déjà, la clé d'accès
   * remplace donc entièrement le mot de passe ; sur un appareil neuf, elle
   * ouvre la session et le mot de passe reste demandé UNE fois. On le dit,
   * plutôt que de laisser quelqu'un devant un coffre vide sans comprendre.
   *
   * Renoncer (fermer la fenêtre du navigateur) n'est pas une erreur : l'API
   * rend `null` et le formulaire se tait.
   */
  const handlePasskeyLogin = async () => {
    setPasskeyBusy(true);
    setError(null);
    try {
      const res = await apiLoginWithPasskey(email.trim() || undefined);
      if (!res) return;
      const suite = await onPasskeyLogin?.(res.user);
      if (suite?.needsPassword) {
        setEmail(res.user.email);
        setError(
          t(
            'onboarding.cloud.login.passkey.needsPassword',
            'Vous êtes connecté. Cet appareil n’a pas encore la clé de votre coffre : saisissez votre mot de passe une fois pour le déchiffrer.'
          )
        );
      }
    } catch {
      setError(t('onboarding.cloud.login.passkey.failed', 'La clé d’accès n’a pas fonctionné.'));
    } finally {
      setPasskeyBusy(false);
    }
  };

  const handleLogin = async () => {
    setRegistering(true);
    setError(null);
    try {
      const result = await authApi.login(email.trim(), password);
      if (!result.success) {
        setError(result.error || 'Login failed');
        return;
      }
      if (result.mfaEnrollmentRequired) {
        // E5-7: org mandates 2FA but the user has none → force enrolment, then re-login.
        setEnrolling(password);
        return;
      }
      if (result.requires2FA) {
        // Password step OK — hand off to the 2FA challenge modal. `pending2FA`
        // is stored here so the modal knows which credentials to proceed with
        // if the user cancels and tries again.
        setPending2FA(password);
        return;
      }
      if (result.user && onLogin) {
        onLogin({ user: result.user, password });
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setRegistering(false);
    }
  };

  if (ssoUser) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!ssoVaultPassword || !onLogin) return;
          onLogin({ user: ssoUser as never, password: ssoVaultPassword });
        }}
      >
        <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>
          {t('onboarding.cloud.login.sso.vaultTitle')}
        </h2>
        <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
          {t('onboarding.cloud.login.sso.vaultDesc', { email: ssoUser.email })}
        </p>
        <div className="mb-4">
          <label
            className="block text-sm font-medium mb-1.5"
            style={{ color: 'var(--color-text-primary)' }}
            htmlFor="sso-vault-password"
          >
            {t('onboarding.cloud.login.sso.vaultLabel')}
          </label>
          <input
            id="sso-vault-password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={ssoVaultPassword}
            onChange={(e) => setSsoVaultPassword(e.target.value)}
            className="w-full px-4 py-2.5 rounded-lg focus:outline-none focus:ring-2"
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
            }}
          />
        </div>
        <div
          className="p-3 rounded-lg mb-5 text-xs"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-info-500) 9%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-info-500) 26%, transparent)',
            color: 'var(--color-text-secondary)',
            lineHeight: 'var(--line-height-relaxed)',
          }}
        >
          {t('onboarding.cloud.login.sso.vaultNote')}
        </div>
        <button
          type="submit"
          disabled={!ssoVaultPassword}
          className="w-full py-2.5 text-sm font-medium rounded-lg text-white transition-colors"
          style={{
            backgroundColor: 'var(--color-primary-600)',
            opacity: ssoVaultPassword ? 1 : 0.6,
          }}
        >
          {t('onboarding.cloud.login.sso.vaultSubmit')}
        </button>
      </form>
    );
  }

  return (
    <>
      {/* Un vrai <form> : requis pour que les gestionnaires de mots de passe
          détectent correctement les champs, et pour supprimer l'avertissement
          DOM de Chrome qui ECHO la valeur des champs password en console. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (mode === 'register') handleRegister();
          else handleLogin();
        }}
      >
        {/*
          LE MÊME FORMULAIRE, MAIS PAS LE MÊME COMPTE — et il faut le dire ici.
          `accountType` ne servait qu'à l'appel réseau : un utilisateur venu par
          la porte entreprise lisait mot pour mot l'écran du parcours personnel,
          puis découvrait plus tard que les deux mondes sont étanches. La
          séparation est une règle du serveur (migration 0059, `account_type`
          fixé à l'inscription et jamais modifiable) : autant l'annoncer avant
          la saisie plutôt que la faire constater après.
        */}
        <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>
          {mode === 'register'
            ? isOrg
              ? t('onboarding.cloud.register.titleOrg')
              : t('onboarding.cloud.register.title', 'Créez votre compte Filarr')
            : isOrg
              ? t('onboarding.cloud.login.titleOrg')
              : t('onboarding.cloud.login.title', 'Connectez-vous à Filarr')}
        </h2>
        <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
          {mode === 'register'
            ? isOrg
              ? t('onboarding.cloud.register.subtitleOrg')
              : t(
                  'onboarding.cloud.register.subtitle',
                  'Vos données restent chiffrées. Nous ne voyons rien.'
                )
            : isOrg
              ? t('onboarding.cloud.login.subtitleOrg')
              : t('onboarding.cloud.login.subtitle', 'Retrouvez vos fichiers synchronisés.')}
        </p>

        {/* Email */}
        <div className="mb-4">
          <label
            className="block text-sm font-medium mb-1.5"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {t('onboarding.cloud.register.emailLabel', 'Adresse email')}
          </label>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            placeholder="email@example.com"
            className="w-full px-4 py-2.5 rounded-lg focus:outline-none focus:ring-2"
            style={{
              backgroundColor: 'var(--color-background-secondary)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border)',
            }}
          />
          {email && !emailValid && (
            <p className="text-xs mt-1" style={{ color: '#ef4444' }}>
              {t('onboarding.cloud.register.emailInvalid', 'Adresse email invalide')}
            </p>
          )}
          {error && error.toLowerCase().includes('email') && (
            <p className="text-xs mt-1" style={{ color: '#ef4444' }}>
              {error}
            </p>
          )}
        </div>

        {/* Password */}
        <div className="mb-4">
          <label
            className="block text-sm font-medium mb-1.5"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {t('onboarding.cloud.register.passwordLabel', 'Mot de passe du compte')}
          </label>
          <input
            type="password"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t(
              'onboarding.cloud.register.passwordPlaceholder',
              '10+ caractères, 1 majuscule, 1 chiffre'
            )}
            className="w-full px-4 py-2.5 rounded-lg focus:outline-none focus:ring-2"
            style={{
              backgroundColor: 'var(--color-background-secondary)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border)',
            }}
          />
          {/* Strength bar */}
          {password.length > 0 && (
            <div className="mt-2">
              <div className="flex gap-1 mb-1">
                {[0, 1, 2, 3, 4].map((level) => (
                  <div
                    key={level}
                    className="h-1.5 flex-1 rounded-full transition-colors"
                    style={{
                      backgroundColor:
                        level <= strength ? STRENGTH_COLORS[strength] : 'var(--color-border)',
                    }}
                  />
                ))}
              </div>
              <p className="text-xs" style={{ color: STRENGTH_COLORS[strength] }}>
                {strengthLabels[strength]}
              </p>
            </div>
          )}
        </div>

        {/* Confirm password — register only */}
        {mode === 'register' && (
          <div className="mb-4">
            <label
              className="block text-sm font-medium mb-1.5"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {t('onboarding.cloud.register.confirmLabel', 'Confirmer le mot de passe')}
            </label>
            <input
              type="password"
              autoComplete="new-password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg focus:outline-none focus:ring-2"
              style={{
                backgroundColor: 'var(--color-background-secondary)',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border)',
              }}
            />
            {passwordConfirm && !pwMatch && (
              <p className="text-xs mt-1" style={{ color: '#ef4444' }}>
                {t(
                  'onboarding.cloud.register.passwordMismatch',
                  'Les mots de passe ne correspondent pas'
                )}
              </p>
            )}
          </div>
        )}

        {/* Vault encryption warning — register only */}
        {/*
          UN ENCART CLAIR SUR UN ÉCRAN SOMBRE. Les trois couleurs étaient écrites
          en dur — rouge très pâle sur bordure rose — alors que cet écran se
          présente sur le fond sombre de l'accueil : la tache était éblouissante
          et illisible. Les jetons du thème s'en chargent, et suivent les huit
          thèmes au lieu de convenir à un seul.
        */}
        {mode === 'register' && (
          <div
            className="flex items-start gap-2 p-3 rounded-lg mb-5 text-xs"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--color-warning-500) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--color-warning-500) 28%, transparent)',
              color: 'var(--color-text-secondary)',
              lineHeight: 'var(--line-height-relaxed)',
            }}
          >
            <span className="flex-shrink-0 mt-0.5">&#9888;&#65039;</span>
            <span>
              {isOrg
                ? t('onboarding.cloud.register.vaultWarningOrg')
                : t(
                    'onboarding.cloud.register.vaultWarning',
                    "Ce mot de passe chiffre aussi vos fichiers. S'il est perdu, vos données sont irrécupérables."
                  )}
            </span>
          </div>
        )}

        {/* Error */}
        {error && !error.toLowerCase().includes('email') && (
          <div
            className="p-3 rounded-lg text-sm mb-4"
            role="alert"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--color-error-500) 10%, transparent)',
              borderLeft: '4px solid var(--color-error-500)',
              color: 'var(--color-error-on-background)',
            }}
          >
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={!formValid || registering}
          className="w-full py-2.5 text-sm font-medium rounded-lg text-white transition-colors flex items-center justify-center gap-2"
          style={{
            backgroundColor:
              formValid && !registering ? 'var(--color-primary-600)' : 'var(--color-neutral-400)',
            cursor: formValid && !registering ? 'pointer' : 'not-allowed',
            opacity: formValid && !registering ? 1 : 0.5,
          }}
        >
          {registering && (
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
              <path
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                opacity="0.75"
              />
            </svg>
          )}
          {mode === 'register'
            ? registering
              ? t('onboarding.cloud.register.creating', 'Création en cours...')
              : t('onboarding.cloud.register.submit', 'Créer mon compte')
            : registering
              ? t('onboarding.cloud.login.connecting', 'Connexion...')
              : t('onboarding.cloud.login.submit', 'Se connecter')}
        </button>

        {/* Clé d'accès — le navigateur seul : WebAuthn lie une clé à un nom de
            domaine, et le bureau sert son interface depuis un schéma privé. */}
        {mode === 'login' && passkeysSupported() && onPasskeyLogin && (
          <button
            type="button"
            onClick={handlePasskeyLogin}
            disabled={passkeyBusy}
            className="w-full py-2.5 mt-2 text-sm font-medium rounded-lg transition-colors"
            style={{
              border: '1px solid var(--color-border-strong, var(--color-border))',
              background: 'transparent',
              color: 'var(--color-text-primary)',
              cursor: passkeyBusy ? 'wait' : 'pointer',
            }}
          >
            {passkeyBusy
              ? t('onboarding.cloud.login.passkey.waiting', 'En attente de votre appareil…')
              : t('onboarding.cloud.login.passkey.button', 'Se connecter avec une clé d’accès')}
          </button>
        )}

        {/* SSO — quand l'adresse relève d'une organisation qui l'a activé */}
        {mode === 'login' && ssoAvailable && ssoOrg && (
          <button
            type="button"
            onClick={handleSsoLogin}
            disabled={ssoBusy}
            className="w-full py-2.5 mt-2 text-sm font-medium rounded-lg transition-colors"
            style={{
              border: '1px solid var(--color-border-strong, var(--color-border))',
              background: 'transparent',
              color: 'var(--color-text-primary)',
              cursor: ssoBusy ? 'wait' : 'pointer',
            }}
          >
            {ssoBusy
              ? t('onboarding.cloud.login.sso.waiting')
              : t('onboarding.cloud.login.sso.button', { org: ssoOrg.orgName })}
          </button>
        )}
        {mode === 'login' && ssoBusy && (
          <p className="text-xs mt-2 text-center" style={{ color: 'var(--color-text-tertiary)' }}>
            {t('onboarding.cloud.login.sso.waitingHint')}{' '}
            <button
              type="button"
              onClick={() => void authApi.ssoCancel()}
              className="underline"
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
            >
              {t('common.cancel', 'Annuler')}
            </button>
          </p>
        )}

        {/* Forgot password — login mode only */}
        {mode === 'login' && (
          <div className="text-center mt-3">
            <button
              type="button"
              onClick={() => setIsForgotOpen(true)}
              className="text-sm underline"
              style={{
                color: 'var(--color-text-tertiary)',
                cursor: 'pointer',
                background: 'none',
                border: 'none',
              }}
            >
              {t('onboarding.cloud.login.forgotPassword', 'Mot de passe oublié ?')}
            </button>
          </div>
        )}

        {/* Toggle register/login */}
        <div className="text-center mt-4">
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'register' ? 'login' : 'register');
              setError(null);
            }}
            className="text-sm underline"
            style={{
              color: 'var(--color-text-tertiary)',
              cursor: 'pointer',
              background: 'none',
              border: 'none',
            }}
          >
            {mode === 'register'
              ? isOrg
                ? t('onboarding.cloud.login.switchToLoginOrg')
                : t('onboarding.cloud.login.switchToLogin', "J'ai déjà un compte")
              : isOrg
                ? t('onboarding.cloud.login.switchToRegisterOrg')
                : t('onboarding.cloud.login.switchToRegister', 'Créer un compte')}
          </button>
        </div>
      </form>
      <TwoFAChallengeModal
        isOpen={pending2FA !== null}
        onCancel={() => setPending2FA(null)}
        onSuccess={(user) => {
          const pw = pending2FA;
          setPending2FA(null);
          if (onLogin && pw !== null) {
            onLogin({ user, password: pw });
          }
        }}
      />
      <TwoFAEnrollModal
        isOpen={enrolling !== null}
        onCancel={() => {
          authApi.cancelMFALogin();
          setEnrolling(null);
        }}
        onEnrolled={async () => {
          // 2FA is now enabled but no session was minted — re-login (which now hits the standard
          // 2FA challenge with the freshly-enrolled authenticator).
          const pw = enrolling;
          setEnrolling(null);
          if (pw === null) return;
          try {
            const result = await authApi.login(email.trim(), pw);
            if (result.mfaEnrollmentRequired) {
              // Unexpected (we just enrolled) — re-open enrolment rather than strand the user.
              setEnrolling(pw);
            } else if (result.requires2FA) {
              setPending2FA(pw);
            } else if (result.user && onLogin) {
              onLogin({ user: result.user, password: pw });
            } else {
              setError(
                result.error || t('settings.2fa.enrollReloginFailed', 'Please sign in again')
              );
            }
          } catch {
            setError(t('settings.2fa.enrollReloginFailed', 'Please sign in again'));
          }
        }}
      />
      <ForgotPasswordModal
        isOpen={isForgotOpen}
        onClose={() => setIsForgotOpen(false)}
        defaultEmail={email}
      />
    </>
  );
};

export default CloudRegisterStep;
