/**
 * Auth API — Renderer-side IPC wrappers
 *
 * Every function calls the main process via IPC.
 * Tokens never cross the bridge — only UserDTO and results.
 */

import type { UserDTO, RegisterResult, AuthStatus } from '../../types/auth';

function ipc() {
  return window.electron.ipcRenderer;
}

/**
 * The two ways the WEB dispatcher refuses a channel (src/platform/web/errors.ts):
 * classified desktop-only, or classified for a tier not delivered yet.
 */
const WEB_CHANNEL_ERROR_CODES: ReadonlySet<string> = new Set([
  'ERR_CHANNEL_UNAVAILABLE',
  'ERR_CHANNEL_NOT_IMPLEMENTED',
]);

/** `code` of the envelope returned when the web client has not ported a channel. */
export const WEB_UNAVAILABLE_CODE = 'web_unavailable';
export const WEB_UNAVAILABLE_ERROR = 'Not available in the web app yet';

/**
 * Invoke an auth channel and turn "not ported on the web" into a failure envelope.
 *
 * WHY. On app.filarr.com, `window.electron.ipcRenderer` is the web dispatcher,
 * which THROWS on a channel without a web handler. Every caller of this module
 * reads `result.success` / `result.error` without a try/catch — that is the
 * contract of the desktop bridge, where main always answers with an envelope.
 * On the web the promise rejected instead: an unhandled rejection in the
 * CrashReporter, and a modal stuck on its spinner (2FA setup, devices list,
 * recovery-phrase regeneration…). Converting HERE, at the single choke point,
 * keeps the callers' contract on both platforms.
 *
 * Only the two web dispatcher errors are converted. A genuine exception from the
 * desktop main process keeps propagating: masking it as "unavailable" would hide
 * a real defect behind a polite sentence.
 */
async function invokeAuth<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipc().invoke(channel, ...args)) as T;
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code;
    if (typeof code === 'string' && WEB_CHANNEL_ERROR_CODES.has(code)) {
      return {
        success: false,
        error: await webUnavailableMessage(),
        code: WEB_UNAVAILABLE_CODE,
      } as unknown as T;
    }
    throw err;
  }
}

/**
 * La phrase affichée par les modales (`setError(result.error || …)`), dans la
 * langue de l'interface. Import paresseux : le module i18n est déjà chargé par
 * l'application, et ce chemin ne s'exécute que sur un refus du dispatcher web —
 * les tests du service n'ont pas à embarquer les deux catalogues.
 */
async function webUnavailableMessage(): Promise<string> {
  try {
    const { default: i18n } = await import('../../i18n/config');
    return i18n.t('settings.webUnavailable', WEB_UNAVAILABLE_ERROR);
  } catch {
    return WEB_UNAVAILABLE_ERROR;
  }
}

/**
 * Une session vivante proposée au refus de connexion (plafond d'appareils).
 * La plus INACTIVE est en tête — c'est celle que l'écran pré-sélectionne.
 */
export interface DeviceLimitSession {
  deviceId: string;
  name: string;
  os: string;
  lastUsedAt: string | null;
}

export async function login(
  email: string,
  password: string,
  /** L'appareil que l'utilisateur accepte de déconnecter pour faire de la place. */
  revokeDeviceId?: string
): Promise<{
  success: boolean;
  user?: UserDTO;
  requires2FA?: boolean;
  /** E5-7: the org requires 2FA and the user has none → walk the forced-enrolment flow. */
  mfaEnrollmentRequired?: boolean;
  error?: string;
  /** `device_limit_reached` quand le palier refuse un appareil de plus. */
  code?: string;
  data?: { cap?: number; sessions?: DeviceLimitSession[] };
}> {
  return invokeAuth('auth:login', email, password, revokeDeviceId);
}

export async function completeMFALogin(
  code: string,
  rememberDevice = false,
  /** L'appareil que l'utilisateur accepte de déconnecter — même issue de secours que `login`. */
  revokeDeviceId?: string
): Promise<{
  success: boolean;
  user?: UserDTO;
  error?: string;
  /** `device_limit_reached` quand le palier refuse un appareil de plus. */
  code?: string;
  data?: { cap?: number; sessions?: DeviceLimitSession[] };
}> {
  return invokeAuth('auth:completeMFALogin', code, rememberDevice, revokeDeviceId);
}

export async function cancelMFALogin(): Promise<void> {
  await ipc().invoke('auth:cancelMFALogin');
}

// ── SSO (E5-1) ─────────────────────────────────────────────────────────────
// Bureau seulement : le Worker rend la session par une boucle locale (RFC 8252),
// et un navigateur ne peut pas en tenir une. Sur le web, ces fonctions ne sont
// jamais appelées — le bouton ne s’y affiche pas.

/** L’adresse relève-t-elle d’une organisation qui a activé le SSO ? */
export async function ssoResolve(email: string): Promise<{
  success: boolean;
  data?: { orgId: string; orgName: string };
  code?: string;
  error?: string;
}> {
  return ipc().invoke('auth:ssoResolve', email);
}

/**
 * Ouvre le navigateur système chez le fournisseur d'identité et attend la
 * session. Résout quand elle est adoptée, refusée, annulée, ou après cinq
 * minutes. La CLÉ n'est pas dans le lot : après cette connexion, le coffre
 * s'ouvre par la clé d'appareil (E5-4) ou par son mot de passe.
 */
export async function ssoLogin(
  orgId: string
): Promise<{ success: boolean; user?: UserDTO; error?: string; code?: string }> {
  return ipc().invoke('auth:ssoLogin', orgId);
}

export async function ssoCancel(): Promise<void> {
  await ipc().invoke('auth:ssoCancel');
}

// ── E5-7 forced 2FA enrolment ──────────────────────────────────────────────
// When login returns mfaEnrollmentRequired, the org mandates 2FA. The enrol token lives in main; the
// renderer just drives the two steps then re-logs-in on the normal path.

export async function mfaEnrollSetup(): Promise<{
  success: boolean;
  secret?: string;
  otpauthUrl?: string;
  error?: string;
}> {
  return invokeAuth('auth:mfaEnrollSetup');
}

export async function mfaEnrollVerify(
  code: string
): Promise<{ success: boolean; backupCodes?: string[]; error?: string }> {
  return invokeAuth('auth:mfaEnrollVerify', code);
}

export async function register(
  email: string,
  password: string,
  accountType: 'personal' | 'enterprise' = 'personal'
): Promise<{
  success: boolean;
  user?: UserDTO;
  recoveryCodes?: string[];
  error?: string;
}> {
  return invokeAuth('auth:register', email, password, accountType);
}

export async function logout(): Promise<void> {
  return invokeAuth('auth:logout');
}

/**
 * Persist the pause preference in main-process flags AND
 * actually start/stop the background sync daemon. Callers still dispatch
 * `setSyncEnabled` on Redux to update the UI; this is the side-effect half.
 */
export async function setSyncEnabled(enabled: boolean): Promise<void> {
  await ipc().invoke('sync:setEnabled', enabled);
}

// ── Phrase-based account recovery ──────────────────────────────────────────

export interface WrappedKeyFromServer {
  wrappedFek: string;
  kekSalt: string;
  version: number;
  recoveryWrappedFek?: string;
  recoverySalt?: string;
}

// E2-5: per-user keypair blob carried through the recovery flow alongside the FEK.
export interface UserKeyFromServer {
  encPublicKey: string;
  signPublicKey: string;
  encPublicKeySig?: string;
  wrappedPrivateKey: string;
  kekSalt: string;
  keyAlgo: string;
  keyVersion: number;
  fingerprint: string;
  recoveryWrappedPrivateKey?: string;
  recoverySalt?: string;
}

export async function recoverPhraseVerify(
  email: string,
  recoveryPhrase: string
): Promise<{
  success: boolean;
  data?: {
    resetToken: string;
    wrappedKey: WrappedKeyFromServer | null;
    userKey: UserKeyFromServer | null;
  };
  error?: string;
}> {
  return invokeAuth('auth:recoverPhraseVerify', email, recoveryPhrase);
}

export async function recoverComplete(payload: {
  resetToken: string;
  newPassword: string;
  wrappedFek?: string;
  kekSalt?: string;
  version?: number;
  recoveryWrappedFek?: string;
  recoverySalt?: string;
  userKey?: Partial<UserKeyFromServer>;
}): Promise<{ success: boolean; data?: { user: UserDTO }; error?: string }> {
  return invokeAuth('auth:recoverComplete', payload);
}

export async function verifyEmail(token: string): Promise<{ success: boolean; error?: string }> {
  return invokeAuth('auth:verifyEmail', token);
}

export async function getMe(): Promise<{
  success: boolean;
  user?: UserDTO;
  error?: string;
}> {
  return invokeAuth('auth:getMe');
}

export async function getAuthStatus(): Promise<AuthStatus> {
  return invokeAuth('auth:getStatus');
}

export interface DeviceSummary {
  id: string;
  name: string;
  os: string;
  /** Derniere CONNEXION (mise a jour seulement par un login). */
  lastSeenAt: string;
  createdAt: string;
  /** Une session est-elle encore ouverte depuis cet appareil ? */
  hasActiveSession?: boolean;
  /** Derniere ACTIVITE = derniere rotation du jeton ; null sans session. */
  lastActiveAt?: string | null;
  /** Session vivante mais sans activite depuis 30 jours (ou plus de session). */
  dormant?: boolean;
}

export async function getDevices(): Promise<{
  success: boolean;
  data?: {
    devices: DeviceSummary[];
    activeCount?: number;
    dormantCount?: number;
    cap?: number;
    currentDeviceId?: string;
  };
  error?: string;
}> {
  return invokeAuth('auth:getDevices');
}

/** Ferme les sessions dormantes et retire leurs appareils — jamais celui-ci. */
export async function revokeDormantDevices(): Promise<{
  success: boolean;
  data?: { devices: number; sessions: number };
  error?: string;
}> {
  return invokeAuth('auth:revokeDormantDevices');
}

export async function deleteDevice(
  deviceId: string
): Promise<{ success: boolean; error?: string }> {
  return invokeAuth('auth:deleteDevice', deviceId);
}

export async function deleteAccountData(): Promise<{ success: boolean; error?: string }> {
  return invokeAuth('auth:deleteAccountData');
}

/**
 * Le refus porte un CODE, et il doit traverser.
 *
 * `vault_owner_must_hand_over` — vous possédez des coffres partagés, transmettez
 * ou supprimez-les d'abord — était traduit en deux langues dans une table que cet
 * écran ne consultait pas : la personne lisait la phrase anglaise brute du
 * serveur, sur le seul refus de ce dialogue qui dise quoi faire ensuite. Le code
 * arrivait pourtant intact dans l'enveloppe ; c'est le type qui l'effaçait.
 */
export async function deleteAccount(): Promise<{
  success: boolean;
  error?: string;
  code?: string;
  vaultCount?: number;
}> {
  return invokeAuth('auth:deleteAccount');
}

// ── 2FA Management ─────────────────────────────────────────────────────────

export interface TwoFAStatus {
  enabled: boolean;
  pendingSetup: boolean;
  unusedBackupCodes: number;
  confirmedAt: string | null;
}

export async function get2FAStatus(): Promise<{
  success: boolean;
  data?: TwoFAStatus;
  error?: string;
}> {
  return invokeAuth('auth:get2FAStatus');
}

export async function setup2FA(): Promise<{
  success: boolean;
  data?: { secret: string; otpauthUrl: string };
  error?: string;
}> {
  return invokeAuth('auth:setup2FA');
}

export async function verifySetup2FA(code: string): Promise<{
  success: boolean;
  data?: { backupCodes: string[] };
  error?: string;
}> {
  return invokeAuth('auth:verifySetup2FA', code);
}

export async function disable2FA(
  password: string,
  code: string
): Promise<{ success: boolean; error?: string }> {
  return invokeAuth('auth:disable2FA', password, code);
}

export async function regenerateBackupCodes(
  password: string,
  code: string
): Promise<{
  success: boolean;
  data?: { backupCodes: string[] };
  error?: string;
}> {
  return invokeAuth('auth:regenerateBackupCodes', password, code);
}

export async function regenerateRecoveryPhrase(
  password: string,
  code?: string
): Promise<{
  success: boolean;
  data?: { recoveryCodes: string[] };
  error?: string;
}> {
  return invokeAuth('auth:regenerateRecoveryPhrase', password, code);
}
