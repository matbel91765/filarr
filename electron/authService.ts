/**
 * Auth Service — Electron Main Process
 *
 * All network requests and token storage happen here.
 * The renderer NEVER sees tokens — it communicates via IPC and receives only UserDTO.
 *
 * Token storage: safeStorage → files in {userData}/FilarData/
 *   .auth_tokens.safe  → { accessToken, refreshToken }
 *   .auth_user.safe    → UserDTO (cached for offline startup)
 */

import { app, safeStorage, BrowserWindow } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { cheminDeStaging } from './atomicStaging';
import * as os from 'os';
import * as crypto from 'crypto';
import log from 'electron-log';
import profileManager from './profileManager';
import { API_BASE } from './apiOrigin';

// ── Types ───────────────────────────────────────────────────────────────────

interface UserDTO {
  id: string;
  email: string;
  emailVerified: boolean;
  subscriptionTier: 'free' | 'solo' | 'pro';
  subscriptionExpiresAt: string | null;
  createdAt: string;
  /** Strict account type (0059) — personal accounts can never belong to an org. */
  accountType?: 'personal' | 'enterprise';
}

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  /**
   * Le code machine du refus. Il vient du Worker quand celui-ci a répondu ; les
   * échecs que CE module fabrique (session tombée, refresh injoignable, corps
   * non-JSON) en portent un aussi, sinon le renderer n'a plus qu'une phrase
   * anglaise à interpréter — et l'écran d'acceptation d'invitation, faute de
   * mieux, conclurait « invitation retirée » sur une panne passagère.
   */
  code?: string;
  /**
   * Le statut HTTP réel. Le SEUL signal disponible quand le Worker refuse sans
   * nommer son refus — `authMiddleware` rend un 401 « Invalid or expired token »
   * sans `code` — et ce que la reprise automatique doit lire au lieu du texte.
   */
  httpStatus?: number;
}

// ── Config ──────────────────────────────────────────────────────────────────


const REQUEST_TIMEOUT = 10_000;
const REFRESH_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
const REFRESH_THRESHOLD = 2 * 60; // refresh if <2 min left

const TOKENS_FILE = '.auth_tokens.safe';
const USER_FILE = '.auth_user.safe';
const DEVICE_ID_FILE = '.device_id';
// LA MACHINE (0091). Un seul fichier pour tout le poste, sous FilarData et non
// sous le profil : c'est ce qui fait que six profils sur un PC ne font plus six
// « appareils » — le serveur retombe sur la meme ligne pour (compte, machine)
// et rend l'identifiant canonique, que le profil adopte (adoptDeviceId).
const MACHINE_ID_FILE = '.machine_id';
// "Remember this device" 2FA-skip token (random, server-validated). 0o600, per profile.
const TRUSTED_DEVICE_FILE = '.trusted_device';
// Active organization id, persisted per profile (plaintext — an org id is not a
// secret). Drives the X-Org-Id header on org-scoped requests (E1-6).
const CURRENT_ORG_FILE = '.current_org';
// Active workspace SPACE, persisted per profile (plaintext — not a secret).
// The explicit personal|enterprise axis: the single durable intent that gates
// every enterprise surface in the renderer (selectIsEnterpriseSpace). Subordinates
// .current_org — the org context is only honored when space === 'enterprise'.
const SPACE_FILE = '.space';
const POLICY_CACHE_FILE = 'org_policy_cache.json';

// ── State ───────────────────────────────────────────────────────────────────

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let cachedUser: UserDTO | null = null;
// Short-lived MFA challenge token held server-side of the IPC boundary — the
// renderer never sees it. Cleared on successful /auth/2fa/login, on cancel,
// or after the 5-minute server-side expiry.
let pendingMfaToken: string | null = null;
// E5-7: short-lived FORCED-ENROLMENT token, issued by /auth/login when the user's org requires 2FA but
// they have none. Same bridge-private treatment as pendingMfaToken; drives only the enroll-setup/verify
// endpoints, never a session. Cleared on enrol success, cancel, or logout.
let pendingEnrollToken: string | null = null;

// The active profile scopes every token/file path read/written by this
// module. Set by main.ts via setProfile() before any auth call and updated
// on profile switches. Null means "no profile active" — authService is a
// no-op (all reads return null, writes throw).
let currentProfileId: string | null = null;

/**
 * DOMAINE D'ATTENTE — s'authentifier avant de savoir dans quel profil atterrir.
 *
 * Un profil EST un domaine d'authentification (cf. getBasePath) : les jetons
 * vivent sous son dossier. « Ajouter un compte cloud » veut pourtant l'ordre
 * inverse — se connecter d'abord, puis découvrir les profils du compte et n'en
 * choisir un qu'ensuite. Sans zone d'attente, la connexion écrirait ses jetons
 * chez le DERNIER profil activé (`currentProfileId` n'est jamais remis à zéro
 * en revenant au sélecteur), c'est-à-dire chez quelqu'un d'autre.
 *
 * On écrit donc dans `FilarData/.pending-account/`, et l'activation du profil
 * retenu y déménage les artefacts (adoptPendingSession). Abandonner la
 * démarche efface le dossier — aucune session orpheline ne subsiste.
 */
let pendingRealm = false;
const PENDING_REALM_DIR = '.pending-account';

// The active org for the current profile. null = personal context (no org).
// Loaded in setProfile(); attached as X-Org-Id by authenticatedApiCall().
let currentOrgId: string | null = null;

// The active workspace space for the current profile. Loaded in setProfile()
// (with lazy migration from .current_org for pre-space profiles). Personal space
// forces currentOrgId off; enterprise space honors it.
export type WorkspaceSpace = 'personal' | 'enterprise';
let currentSpace: WorkspaceSpace = 'personal';

// ── Path Helpers ────────────────────────────────────────────────────────────
//
// All auth artifacts (tokens, user cache, device id, pause flag lived under
// the active profile directory so each profile is a self-contained auth
// realm. See setProfile() for how `currentProfileId` is established.

function getLegacyBasePath(): string {
  return path.join(app.getPath('userData'), 'FilarData');
}

/** Dossier du domaine d'attente. Exporté : StorageService y range aussi la FEK. */
export function getPendingRealmDir(): string {
  return path.join(getLegacyBasePath(), PENDING_REALM_DIR);
}

function getProfileBasePath(profileId: string): string {
  const safe = profileId.replace(/[^a-zA-Z0-9\-]/g, '');
  return path.join(app.getPath('userData'), 'FilarData', 'profiles', safe);
}

function getBasePath(): string {
  // Le domaine D'ATTENTE prime : pendant « ajouter un compte », l'identité en
  // cours d'établissement n'appartient encore à AUCUN profil, et surtout pas au
  // dernier activé. Cf. beginPendingSession().
  if (pendingRealm) return getPendingRealmDir();
  if (currentProfileId) {
    return getProfileBasePath(currentProfileId);
  }
  // Fallback for boot-time (before setProfile is called) and migration.
  return getLegacyBasePath();
}

/**
 * Le dossier d'auth du domaine ACTIF. Exporté pour `custodyService`, qui y
 * range la mémoire « se souvenir de ce coffre sur cet appareil » : elle doit
 * suivre EXACTEMENT le même domaine que les jetons — même profil, même domaine
 * d'attente — sinon un changement de profil servirait la clé de garde du compte
 * précédent à celui d'après.
 */
export function getAuthBasePath(): string {
  return getBasePath();
}

function getTokensPath(): string {
  return path.join(getBasePath(), TOKENS_FILE);
}

function getUserPath(): string {
  return path.join(getBasePath(), USER_FILE);
}

// ── SafeStorage I/O ─────────────────────────────────────────────────────────

async function safeWrite(filePath: string, data: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(data);
    // Nom de staging UNIQUE — voir `atomicStaging`. Deux sauvegardes de
    // jetons qui se croisent (rafraîchissement + connexion) partageaient
    // leur fichier intermédiaire.
    const tmpPath = cheminDeStaging(filePath);
    await fs.writeFile(tmpPath, encrypted, { mode: 0o600 });

    // Atomic rename — retry on Windows EPERM (file locked by AV/other process)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await fs.rename(tmpPath, filePath);
        return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EPERM' && attempt < 2) {
          await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
          continue;
        }
        // Final attempt: fall back to direct overwrite
        log.warn('[authService] rename failed, falling back to direct write');
        await fs.writeFile(filePath, encrypted, { mode: 0o600 });
        await fs.unlink(tmpPath).catch(() => {});
        return;
      }
    }
  } else {
    log.warn('[authService] safeStorage unavailable, skipping token storage');
  }
}

async function safeRead(filePath: string): Promise<string | null> {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const encrypted = await fs.readFile(filePath);
    return safeStorage.decryptString(encrypted);
  } catch {
    return null;
  }
}

async function safeDelete(filePath: string): Promise<void> {
  await fs.unlink(filePath).catch(() => {});
}

// ── Token Storage ───────────────────────────────────────────────────────────

async function saveTokens(tokens: StoredTokens): Promise<void> {
  await safeWrite(getTokensPath(), JSON.stringify(tokens));
}

async function loadTokens(): Promise<StoredTokens | null> {
  const raw = await safeRead(getTokensPath());
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

async function clearTokens(): Promise<void> {
  await safeDelete(getTokensPath());
}

// ── User Cache ──────────────────────────────────────────────────────────────

async function saveUserCache(user: UserDTO): Promise<void> {
  cachedUser = user;
  await safeWrite(getUserPath(), JSON.stringify(user));
  // Keep the profile manifest in sync so the ProfilePicker + Redux hydrate
  // path can render the correct cloud account badge for this profile.
  if (currentProfileId) {
    try {
      await profileManager.setCloudAccount(currentProfileId, {
        email: user.email,
        tier: user.subscriptionTier,
        accountType: user.accountType,
      });
    } catch (err) {
      log.warn('[authService] setCloudAccount on saveUserCache failed:', err);
    }
    // Reconcile the persisted space with the authoritative account type (0059):
    // account_type is the server truth and cannot change, so a diverged .space
    // (migration edge / bug) is corrected here. Only runs on an actual mismatch
    // to avoid churning currentOrgId on every getMe.
    if (user.accountType) {
      const desired: WorkspaceSpace = user.accountType === 'enterprise' ? 'enterprise' : 'personal';
      if (currentSpace !== desired) {
        try {
          await setSpace(desired);
        } catch (err) {
          log.warn('[authService] space reconcile on saveUserCache failed:', err);
        }
      }
    }
  }
}

async function loadUserCache(): Promise<UserDTO | null> {
  if (cachedUser) return cachedUser;
  const raw = await safeRead(getUserPath());
  if (!raw) return null;
  try {
    cachedUser = JSON.parse(raw) as UserDTO;
    return cachedUser;
  } catch {
    return null;
  }
}

async function clearUserCache(): Promise<void> {
  cachedUser = null;
  await safeDelete(getUserPath());
  if (currentProfileId) {
    try {
      await profileManager.setCloudAccount(currentProfileId, null);
    } catch (err) {
      log.warn('[authService] setCloudAccount(null) on clearUserCache failed:', err);
    }
  }
}

// ── JWT Helpers ─────────────────────────────────────────────────────────────

function getTokenExpiry(token: string): number | null {
  try {
    const payloadB64 = token.split('.')[1];
    if (!payloadB64) return null;
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

function isTokenExpired(token: string): boolean {
  const exp = getTokenExpiry(token);
  if (!exp) return true;
  return Math.floor(Date.now() / 1000) >= exp;
}

function isTokenExpiringSoon(token: string): boolean {
  const exp = getTokenExpiry(token);
  if (!exp) return true;
  return Math.floor(Date.now() / 1000) >= exp - REFRESH_THRESHOLD;
}

// ── HTTP Client ─────────────────────────────────────────────────────────────

export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeout = REQUEST_TIMEOUT
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

export { API_BASE };

export async function apiCall<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const response = await fetchWithTimeout(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  // Defend against non-JSON bodies: Cloudflare challenge pages, proxy error
  // pages, or a mis-routed request ending up at a Vercel-served domain will
  // all return HTML and crash `response.json()` with a cryptic SyntaxError.
  // Surface a readable error with the HTTP status instead.
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const snippet = (await response.text()).slice(0, 120).replace(/\s+/g, ' ');
    log.error(
      `[authService] Non-JSON response from ${endpoint} (HTTP ${response.status}, ${contentType}): ${snippet}`
    );
    return {
      success: false,
      error: `Unexpected server response (HTTP ${response.status})`,
      // Un corps illisible n'est PAS un verdict sur la requête : c'est
      // l'infrastructure qui a parlé à la place du Worker.
      code: 'server_error',
      httpStatus: response.status,
    };
  }

  const body = (await response.json()) as ApiResponse<T>;
  return { ...body, httpStatus: response.status };
}

/**
 * Les routes où un 401 parle du SECRET QUE L'UTILISATEUR VIENT DE TAPER, pas de
 * notre jeton de session.
 *
 * LISTE ÉTABLIE PAR RELEVÉ EXHAUSTIF, pas par intuition. En parcourant tous les
 * points de sortie 401 du Worker et en ne gardant que ceux atteignables par
 * `authenticatedApiCall`, il en reste exactement cinq :
 *   — `/auth/change-password`            « Current password is incorrect »
 *   — `/auth/2fa/verify-setup`           « Invalid code »
 *   — `/auth/2fa/disable`                « Invalid password » / « Invalid code »
 *   — `/auth/2fa/backup-codes/regenerate` idem
 *   — `/account/recovery-phrase/regenerate` « Invalid password » / « Invalid TOTP code »
 * Toutes les autres routes appelées d'ici (`/auth/me`, `/account/*`, `/org/*`,
 * `/sync/*`, `/billing/*`) n'ont AUCUN 401 qui leur soit propre : le seul qu'on
 * puisse y recevoir vient de `authMiddleware` — ou de la garde « fail closed »
 * de `orgAuthMiddleware` — et c'est bien un jeton refusé.
 *
 * POURQUOI PAS L'ABSENCE DE `code` COMME DISCRIMINANT : ces cinq refus n'en
 * portent aucun non plus. C'est la ROUTE qui les distingue, et rien d'autre.
 *
 * CE QUE CETTE LISTE ÉVITE. Sans elle, taper un mauvais code 2FA ou un mauvais
 * mot de passe actuel faisait tourner le jeton de session PUIS REJOUER la
 * requête : deuxième vérification du même secret erroné, donc un compteur de
 * limitation qui avance deux fois plus vite, et un refus qui pouvait revenir
 * DIFFÉRENT du premier.
 */
const CREDENTIAL_CHALLENGE_ENDPOINTS: ReadonlySet<string> = new Set([
  '/auth/change-password',
  '/auth/2fa/verify-setup',
  '/auth/2fa/disable',
  '/auth/2fa/backup-codes/regenerate',
  '/account/recovery-phrase/regenerate',
]);

/**
 * Ce refus appelle-t-il une ROTATION du jeton de session ?
 *
 * ON TESTE LE STATUT, PAS LE TEXTE. La condition était
 * `response.error?.includes('expired')`, et le Worker prononce ce mot dans une
 * quinzaine de refus qui n'ont rien à voir avec notre jeton d'accès :
 * `invitation_expired` (410, l'invitation est périmée), `invite_expired`,
 * `session_expired` des sessions de recouvrement Shamir (410), « Invalid or
 * expired upload token » (403), « Send expired », « Share expired », « Pairing
 * code not found or expired »… Chacun déclenchait une rotation parasite PUIS
 * rejouait la requête : le refus ressortait donc éventuellement DIFFÉRENT du
 * premier — une invitation expirée pouvait revenir déguisée — et le jeton de
 * session était tourné pour rien.
 *
 * Un jeton d'accès refusé, c'est un 401 sans `code` : c'est la signature de
 * `authMiddleware`, et exactement ce que le commentaire d'origine revendiquait
 * déjà (« Auto-retry on 401 »). Un 403 est une PERMISSION, qu'un jeton neuf ne
 * change pas. Restent les 401 QUI NE PORTENT PAS SUR NOTRE JETON, écartés par
 * leur route (voir ci-dessus).
 */
export function needsSessionRefresh(
  endpoint: string,
  response: ApiResponse<unknown>
): boolean {
  if (response.success || response.httpStatus !== 401) return false;
  return !CREDENTIAL_CHALLENGE_ENDPOINTS.has(endpoint.split('?')[0]);
}

export async function authenticatedApiCall<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  let accessToken = await getAccessToken();
  if (!accessToken) {
    return { success: false, error: 'Not authenticated', code: 'session_expired' };
  }

  // Attach the active org context (X-Org-Id) so org-scoped resource endpoints
  // resolve the right tenant. Analogous to the renderer's X-Profile-Id. The
  // org-management API (/org/:orgId/...) carries the org in the path instead.
  const orgHeaders = currentOrgId ? { 'X-Org-Id': currentOrgId } : {};

  let response = await apiCall<T>(endpoint, {
    ...options,
    headers: { ...options.headers, ...orgHeaders, Authorization: `Bearer ${accessToken}` },
  });

  // Auto-retry on 401
  if (needsSessionRefresh(endpoint, response)) {
    const outcome = await refreshTokens();
    if (outcome === 'rejected') {
      // Server explicitly invalidated the refresh token — real logout.
      await logout();
      notifyRenderer();
      return { success: false, error: 'Session expired', code: 'session_expired' };
    }
    if (outcome === 'network') {
      // Refresh couldn't reach the server (timeout / 5xx / CF challenge).
      // Surface a transient error instead of nuking the session — the
      // caller can retry or fall back, and the next refresh tick will
      // get another shot.
      return {
        success: false,
        error: 'Refresh unavailable (network)',
        code: 'network_unavailable',
      };
    }
    accessToken = await getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'Not authenticated', code: 'session_expired' };
    }
    response = await apiCall<T>(endpoint, {
      ...options,
      headers: { ...options.headers, ...orgHeaders, Authorization: `Bearer ${accessToken}` },
    });
  }

  return response;
}

// ── Device Info ─────────────────────────────────────────────────────────────

async function getOrCreateDeviceId(): Promise<string> {
  const deviceIdPath = path.join(getBasePath(), DEVICE_ID_FILE);
  try {
    const existing = await fs.readFile(deviceIdPath, 'utf8');
    if (existing.trim()) return existing.trim();
  } catch {
    // File doesn't exist yet
  }
  const id = crypto.randomUUID();
  await fs.mkdir(path.dirname(deviceIdPath), { recursive: true });
  await fs.writeFile(deviceIdPath, id, { mode: 0o600 });
  return id;
}

/**
 * L'identifiant du POSTE, partage par tous les profils (voir MACHINE_ID_FILE).
 * Aleatoire, jamais derive du materiel : il ne dit rien de la machine a qui
 * n'a pas le fichier. Efface par wipeAuthArtifacts — un poste efface a
 * distance repart avec une identite neuve, sinon il retomberait sur la ligne
 * marquee « a effacer » et serait refuse pour toujours.
 */
async function getOrCreateMachineId(): Promise<string> {
  const p = path.join(getLegacyBasePath(), MACHINE_ID_FILE);
  try {
    const existing = (await fs.readFile(p, 'utf8')).trim();
    if (/^[0-9a-f-]{36}$/.test(existing)) return existing;
  } catch {
    // pas encore de fichier
  }
  const id = crypto.randomUUID();
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, id, { mode: 0o600 });
  return id;
}

/**
 * Adopte l'identifiant CANONIQUE rendu par le serveur quand il differe de
 * celui envoye : ce compte avait deja un appareil sur cette machine (un autre
 * profil), c'est lui qui porte la session — et c'est lui que « Cet appareil »
 * doit designer dans la liste. Silencieux : ne rien adopter laisse simplement
 * l'ancien identifiant, que le serveur continue de reconnaitre.
 */
async function adoptDeviceId(sent: string, canonical: unknown): Promise<void> {
  if (typeof canonical !== 'string' || !canonical || canonical === sent) return;
  try {
    const p = path.join(getBasePath(), DEVICE_ID_FILE);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, canonical, { mode: 0o600 });
  } catch (e) {
    log.warn('[authService] failed to adopt canonical device id:', (e as Error).message);
  }
}

// ── Trusted device ("remember this device" — skip 2FA for 30 days) ───────────
async function readTrustedDeviceToken(): Promise<string | null> {
  try {
    const t = (await fs.readFile(path.join(getBasePath(), TRUSTED_DEVICE_FILE), 'utf8')).trim();
    return /^[a-f0-9]{64}$/.test(t) ? t : null;
  } catch {
    return null;
  }
}

async function writeTrustedDeviceToken(token: string): Promise<void> {
  const p = path.join(getBasePath(), TRUSTED_DEVICE_FILE);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, token, { mode: 0o600 });
}

function getDeviceName(): string {
  return os.hostname() || 'Unknown Device';
}

function getDeviceOs(): string {
  const platform = os.platform();
  const release = os.release();
  switch (platform) {
    case 'win32': return `Windows ${release}`;
    case 'darwin': return `macOS ${release}`;
    case 'linux': return `Linux ${release}`;
    default: return platform;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Une session vivante, telle que le serveur la propose au refus. Le plus
 * INACTIF est en tête : c'est celui que l'écran présente pré-sélectionné.
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
  /**
   * PLAFOND D'APPAREILS : celui que l'utilisateur accepte de déconnecter pour
   * faire de la place, choisi à l'écran de refus précédent.
   *
   * Il repart DANS la connexion, et pas par `/account/devices`, parce qu'un
   * refus n'a pas de session : il n'existe aucun jeton avec lequel appeler quoi
   * que ce soit. Le mot de passe, lui, est renvoyé et revérifié.
   */
  revokeDeviceId?: string
): Promise<{
  success: boolean;
  user?: UserDTO;
  requires2FA?: boolean;
  mfaEnrollmentRequired?: boolean;
  error?: string;
  /** `device_limit_reached` quand le palier refuse un appareil de plus. */
  code?: string;
  /** Le plafond et les sessions à choisir, quand `code` le dit. */
  data?: { cap?: number; sessions?: DeviceLimitSession[] };
}> {
  try {
    const deviceId = await getOrCreateDeviceId();
    const trustedDeviceToken = await readTrustedDeviceToken();
    const result = await apiCall<{
      accessToken?: string;
      refreshToken?: string;
      user?: UserDTO;
      requires2FA?: boolean;
      mfaEnrollmentRequired?: boolean;
      mfaToken?: string;
      deviceId?: string;
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        deviceId,
        deviceName: getDeviceName(),
        deviceOs: getDeviceOs(),
        machineId: await getOrCreateMachineId(),
        // Skip the TOTP step on this device if it's still trusted (server checks
        // the password regardless). Sent only if a token is stored locally.
        ...(trustedDeviceToken ? { trustedDeviceToken } : {}),
        ...(revokeDeviceId ? { revokeDeviceId } : {}),
      }),
    });

    if (!result.success || !result.data) {
      /**
       * UN REFUS QUI PROPOSE N'EST PAS UNE PANNE. Le serveur joint le plafond et
       * la liste des sessions ; les jeter ici transformerait un choix offert en
       * message d'erreur opaque, et l'écran n'aurait plus rien à afficher.
       */
      const refus = result as { code?: string; data?: { cap?: number; sessions?: unknown } };
      if (refus.code === 'device_limit_reached') {
        return {
          success: false,
          error: result.error || 'Too many active devices',
          code: refus.code,
          data: refus.data as { cap?: number; sessions?: DeviceLimitSession[] },
        };
      }
      return { success: false, error: result.error || 'Login failed' };
    }

    // 2FA required. E5-7: an org may force ENROLMENT (the user has no 2FA yet) — stash the enrol token
    // and signal the renderer to walk the setup flow. Otherwise it's a normal 2FA challenge.
    if (result.data.requires2FA && result.data.mfaToken) {
      if (result.data.mfaEnrollmentRequired) {
        pendingEnrollToken = result.data.mfaToken;
        return { success: true, mfaEnrollmentRequired: true };
      }
      pendingMfaToken = result.data.mfaToken;
      return { success: true, requires2FA: true };
    }

    if (!result.data.accessToken || !result.data.refreshToken || !result.data.user) {
      return { success: false, error: 'Unexpected server response' };
    }

    await saveTokens({
      accessToken: result.data.accessToken,
      refreshToken: result.data.refreshToken,
    });
    await adoptDeviceId(deviceId, result.data.deviceId);
    await saveUserCache(result.data.user);
    startAutoRefresh();

    return { success: true, user: result.data.user };
  } catch (error) {
    log.error('[authService] login error:', (error as Error).message);
    return { success: false, error: 'Network error. Please try again.' };
  }
}

/**
 * Second step of a 2FA login: exchange the cached MFA challenge token + a
 * TOTP or backup code for real access/refresh tokens. The MFA token is
 * cleared on any outcome (success, failure, or malformed response) to
 * prevent stale reuse.
 */
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
  if (!pendingMfaToken) {
    return { success: false, error: 'No pending 2FA challenge — log in again' };
  }
  const mfaToken = pendingMfaToken;

  try {
    const deviceId = await getOrCreateDeviceId();
    const result = await apiCall<{
      accessToken: string;
      refreshToken: string;
      user: UserDTO;
      trustedDeviceToken?: string;
      deviceId?: string;
    }>('/auth/2fa/login', {
      method: 'POST',
      body: JSON.stringify({
        mfaToken,
        code,
        deviceId,
        deviceName: getDeviceName(),
        deviceOs: getDeviceOs(),
        machineId: await getOrCreateMachineId(),
        rememberDevice,
        ...(revokeDeviceId ? { revokeDeviceId } : {}),
      }),
    });

    if (!result.success || !result.data) {
      /**
       * LE REFUS « TROP D'APPAREILS » PROPOSE, IL NE BLOQUE PAS — sur ce chemin
       * aussi. Le jeton MFA n'a pas été consommé par le refus : la reprise
       * rejoue le code avec l'appareil choisi. Le jeter ici enfermait dehors
       * un compte à double facteur parfaitement à jour.
       */
      const refus = result as { code?: string; data?: { cap?: number; sessions?: unknown } };
      if (refus.code === 'device_limit_reached') {
        return {
          success: false,
          error: result.error || 'Too many active devices',
          code: refus.code,
          data: refus.data as { cap?: number; sessions?: DeviceLimitSession[] },
        };
      }
      // Keep the mfaToken alive on wrong-code — the user should be able to
      // retry without restarting from the password step. Only clear it when
      // the server rejects the token itself (expired / invalid token).
      if (result.error?.toLowerCase().includes('mfa token')) {
        pendingMfaToken = null;
      }
      return { success: false, error: result.error || '2FA verification failed' };
    }

    pendingMfaToken = null;
    await saveTokens({
      accessToken: result.data.accessToken,
      refreshToken: result.data.refreshToken,
    });
    // Persist the 30-day trusted-device token (issued only when rememberDevice was
    // checked) so this device skips the TOTP step on its next login.
    if (typeof result.data.trustedDeviceToken === 'string') {
      try {
        await writeTrustedDeviceToken(result.data.trustedDeviceToken);
      } catch (e) {
        log.warn('[authService] failed to persist trusted-device token:', (e as Error).message);
      }
    }
    await adoptDeviceId(deviceId, result.data.deviceId);
    await saveUserCache(result.data.user);
    startAutoRefresh();

    return { success: true, user: result.data.user };
  } catch (error) {
    log.error('[authService] completeMFALogin error:', (error as Error).message);
    return { success: false, error: 'Network error. Please try again.' };
  }
}

export function cancelMFALogin(): void {
  pendingMfaToken = null;
  pendingEnrollToken = null;
}

/**
 * ADOPTER UNE SESSION FRAPPÉE AILLEURS (E5-1, connexion SSO).
 *
 * Le flux SSO ne passe pas par `/auth/login` : le Worker frappe les jetons
 * lui-même à la fin de l'aller-retour OIDC et les rend à l'application par
 * la boucle locale (`ssoLogin.ts`). Ce qui suit est EXACTEMENT ce que fait
 * `login()` après un mot de passe accepté — même stockage, même cache, même
 * rafraîchissement — précédé d'une vérification : on ne persiste rien avant
 * que `/auth/me` ait répondu avec ces jetons. Un jeton forgé ou périmé
 * n'entre pas.
 */
export async function adoptSsoCode(
  code: string
): Promise<{ success: boolean; user?: UserDTO; error?: string; code?: string }> {
  if (!code || code.length < 16) return { success: false, error: 'Invalid code' };
  try {
    // Le même trio qu'à /auth/login : c'est ce qui inscrit la session SSO dans
    // le plafond d'appareils et l'effacement à distance.
    const deviceId = await getOrCreateDeviceId();
    const result = await apiCall<{
      accessToken: string;
      refreshToken: string;
      user: UserDTO;
      deviceId?: string;
    }>('/auth/sso/exchange', {
      method: 'POST',
      body: JSON.stringify({
        code,
        deviceId,
        deviceName: getDeviceName(),
        deviceOs: getDeviceOs(),
        machineId: await getOrCreateMachineId(),
      }),
    });
    if (!result.success || !result.data?.accessToken || !result.data.refreshToken || !result.data.user) {
      return { success: false, error: result.error || 'Session rejected', code: (result as { code?: string }).code };
    }
    await saveTokens({ accessToken: result.data.accessToken, refreshToken: result.data.refreshToken });
    await adoptDeviceId(deviceId, result.data.deviceId);
    await saveUserCache(result.data.user);
    startAutoRefresh();
    return { success: true, user: result.data.user };
  } catch (error) {
    log.error('[authService] adoptSsoCode error:', (error as Error).message);
    return { success: false, error: 'Network error. Please try again.' };
  }
}

/**
 * E5-7 forced enrolment, step 1: exchange the stashed enrol token for a fresh pending TOTP secret +
 * otpauth URL (for the QR). No session is involved. The enrol token stays alive across this call so
 * the user can complete with mfaEnrollVerify().
 */
export async function mfaEnrollSetup(): Promise<{
  success: boolean;
  secret?: string;
  otpauthUrl?: string;
  error?: string;
}> {
  if (!pendingEnrollToken) {
    return { success: false, error: 'No pending enrolment — log in again' };
  }
  try {
    const result = await apiCall<{ secret: string; otpauthUrl: string }>('/auth/2fa/enroll-setup', {
      method: 'POST',
      body: JSON.stringify({ mfaToken: pendingEnrollToken }),
    });
    if (!result.success || !result.data) {
      if (result.error?.toLowerCase().includes('token')) pendingEnrollToken = null;
      return { success: false, error: result.error || 'Could not start 2FA setup' };
    }
    return { success: true, secret: result.data.secret, otpauthUrl: result.data.otpauthUrl };
  } catch (error) {
    log.error('[authService] mfaEnrollSetup error:', (error as Error).message);
    return { success: false, error: 'Network error. Please try again.' };
  }
}

/**
 * E5-7 forced enrolment, step 2: submit the first TOTP code. On success 2FA is enabled and the one-shot
 * backup codes are returned; NO session is minted (by design) — the caller then re-runs a normal login,
 * which now issues tokens via the standard 2FA challenge. The enrol token is cleared on success.
 */
export async function mfaEnrollVerify(
  code: string
): Promise<{ success: boolean; backupCodes?: string[]; error?: string }> {
  if (!pendingEnrollToken) {
    return { success: false, error: 'No pending enrolment — log in again' };
  }
  try {
    const result = await apiCall<{ backupCodes: string[]; enrolled: boolean }>(
      '/auth/2fa/enroll-verify',
      {
        method: 'POST',
        body: JSON.stringify({ mfaToken: pendingEnrollToken, code }),
      }
    );
    if (!result.success || !result.data) {
      // Wrong code is retryable (keep the token); a rejected/expired TOKEN ends the flow.
      if (result.error?.toLowerCase().includes('token')) pendingEnrollToken = null;
      return { success: false, error: result.error || '2FA verification failed' };
    }
    pendingEnrollToken = null;
    return { success: true, backupCodes: result.data.backupCodes };
  } catch (error) {
    log.error('[authService] mfaEnrollVerify error:', (error as Error).message);
    return { success: false, error: 'Network error. Please try again.' };
  }
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
  try {
    const result = await apiCall<{
      user: UserDTO;
      recoveryCodes: string[];
    }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        accountType: accountType === 'enterprise' ? 'enterprise' : 'personal',
      }),
    });

    if (!result.success || !result.data) {
      return { success: false, error: result.error || 'Registration failed' };
    }

    // Don't save tokens yet — email not verified, user can't login
    // Recovery codes are returned to renderer ONCE and never stored
    return {
      success: true,
      user: result.data.user,
      recoveryCodes: result.data.recoveryCodes,
    };
  } catch (error) {
    log.error('[authService] register error:', (error as Error).message);
    return { success: false, error: 'Network error. Please try again.' };
  }
}

export async function logout(): Promise<void> {
  try {
    const tokens = await loadTokens();
    if (tokens) {
      // Best-effort: tell the server to invalidate the refresh token
      await apiCall('/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      }).catch(() => {});
    }
  } catch {
    // Ignore network errors during logout
  } finally {
    stopAutoRefresh();
    pendingMfaToken = null;
    pendingEnrollToken = null; // E5-7: never carry an in-flight challenge/enrol token across a logout
    await clearTokens();
    await clearUserCache();
    await clearPolicyCache(); // E9-10: governance session ends with the account session
    // La mémoire « se souvenir de ce coffre sur cet appareil » est un secret DE
    // COMPTE : elle part avec les jetons. Un poste qui se déconnecte redevient
    // une machine ordinaire — sinon le suivant à s'y connecter hériterait de la
    // clé de garde du précédent (la garde d'identité la refuserait, mais elle
    // aurait déjà traîné sur le disque sans raison).
    //
    // Import PARESSEUX : `custodyService` importe `authService`, et une
    // dépendance circulaire à la charge du module casserait l'initialisation.
    await import('./custodyService')
      .then((m) => m.clearRememberedCustody())
      .catch(() => {});
    notifyRenderer();
  }
}

/**
 * Outcome of a token refresh. Lets callers distinguish a legitimate
 * server-side rejection ("your refresh token is invalid, log out") from
 * a transient failure ("the worker / network is unreachable, hold the
 * session") — the latter was previously treated as a logout, causing
 * "déconnecte hyper souvent" especially on multi-device setups where
 * the periodic refresh runs in parallel on each device.
 */
export type RefreshOutcome = 'ok' | 'rejected' | 'network';

interface RefreshSuccessPayload {
  accessToken: string;
  refreshToken: string;
  user: UserDTO;
}

const REFRESH_RETRY_DELAYS_MS = [0, 1000, 4000] as const;

/**
 * Single round-trip to the refresh endpoint. Reads the raw HTTP status
 * so we can classify the outcome correctly:
 *   - 401 / 403 with JSON body → 'rejected' (server killed the token)
 *   - 5xx, 429, network throw, non-JSON (CF challenge page) → 'network'
 *   - 2xx + JSON success → 'ok'
 *   - 2xx + JSON failure → 'rejected' (server-side validation failed)
 */
async function refreshOnce(
  refreshToken: string
): Promise<{ outcome: RefreshOutcome; data?: RefreshSuccessPayload; code?: string; wipeNonce?: string | null }> {
  let response: Response;
  try {
    response = await fetchWithTimeout(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  } catch (err) {
    log.warn('[authService] refresh network error:', (err as Error).message);
    return { outcome: 'network' };
  }

  if (response.status >= 500 || response.status === 429) {
    log.warn(`[authService] refresh transient HTTP ${response.status}`);
    return { outcome: 'network' };
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const snippet = (await response.text().catch(() => '')).slice(0, 120).replace(/\s+/g, ' ');
    log.warn(
      `[authService] refresh non-JSON response HTTP ${response.status} (${contentType}): ${snippet}`
    );
    return { outcome: 'network' };
  }

  // E9-11: the refresh response may carry a governance `code` (device_wipe_required / device_revoked /
  // session_expired) + a wipe_nonce — surfaced to the caller so it can act (e.g. execute a wipe).
  let body: ApiResponse<RefreshSuccessPayload> & { code?: string; wipeNonce?: string | null };
  try {
    body = (await response.json()) as ApiResponse<RefreshSuccessPayload> & {
      code?: string;
      wipeNonce?: string | null;
    };
  } catch (err) {
    log.warn('[authService] refresh JSON parse error:', (err as Error).message);
    return { outcome: 'network' };
  }

  if (body?.success && body.data) {
    return { outcome: 'ok', data: body.data };
  }
  // 401 / 4xx with a proper JSON body, or success:false JSON — the
  // server has explicitly rejected this refresh token.
  return { outcome: 'rejected', code: body?.code, wipeNonce: body?.wipeNonce ?? null };
}

// Single-flight guard: at most one /auth/refresh round-trip runs at a time.
// Without it, a wake-from-sleep / reconnect burst (sync runs up to 3 uploads +
// 3 downloads in parallel — see MAX_PARALLEL_* in syncService — plus getMe and
// the 5-min auto-refresh tick) makes 5-8 callers each POST the SAME single-use
// refresh token. The server rotates on first use, so every loser gets 401 ->
// 'rejected' -> a spurious logout() — the "deconnecte hyper souvent" symptom.
// With the guard, concurrent callers await the one in-flight refresh and all
// observe the same outcome and the same freshly-saved tokens.
let inFlightRefresh: Promise<RefreshOutcome> | null = null;

export function refreshTokens(): Promise<RefreshOutcome> {
  if (inFlightRefresh) return inFlightRefresh;
  inFlightRefresh = doRefreshTokens().finally(() => {
    inFlightRefresh = null;
  });
  return inFlightRefresh;
}

async function doRefreshTokens(): Promise<RefreshOutcome> {
  const tokens = await loadTokens();
  if (!tokens?.refreshToken) return 'rejected';

  let last: RefreshOutcome = 'network';
  for (let i = 0; i < REFRESH_RETRY_DELAYS_MS.length; i++) {
    const delay = REFRESH_RETRY_DELAYS_MS[i];
    if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
    const attempt = await refreshOnce(tokens.refreshToken);
    if (attempt.outcome === 'ok' && attempt.data) {
      try {
        await saveTokens({
          accessToken: attempt.data.accessToken,
          refreshToken: attempt.data.refreshToken,
        });
        await saveUserCache(attempt.data.user);
      } catch (saveErr) {
        log.warn('[authService] Token save failed (non-fatal):', (saveErr as Error).message);
      }
      return 'ok';
    }
    if (attempt.outcome === 'rejected') {
      // E9-11: an admin requested a remote wipe of THIS device — execute it (clear local keys + cache)
      // before the caller's normal logout. The wipe handler never throws into the refresh path.
      if (attempt.code === 'device_wipe_required' && deviceWipeHandler) {
        try {
          await deviceWipeHandler({ wipeNonce: attempt.wipeNonce ?? null });
        } catch (e) {
          log.warn('[authService] device wipe handler failed:', (e as Error).message);
        }
      }
      // No point retrying — the server told us the token is dead.
      return 'rejected';
    }
    // 'network' — try again
    last = 'network';
    log.info(`[authService] Refresh attempt ${i + 1} failed (network), retrying...`);
  }
  return last;
}

export async function getAccessToken(): Promise<string | null> {
  const tokens = await loadTokens();
  if (!tokens?.accessToken) return null;

  /*
    ON RAFRAÎCHIT AVANT L'EXPIRATION, PAS À L'INSTANT OÙ ELLE TOMBE.

    `isTokenExpired` répond `now >= exp` : SANS MARGE. Un jeton auquel il reste
    une seconde passait donc le contrôle, et la requête qui suit arrivait
    expirée. Sur un transfert court ça ne se voit pas ; sur un téléversement de
    blocs de plusieurs mégaoctets, la requête dure plus longtemps que ce qui
    restait au jeton.

    Journaux du 2026-09-07, pendant l'envoi d'un fichier de 1,28 Go :

        Block upload failed: HTTP 401 {"error":"Invalid or expired token"}

    quatorze fois, et chacune fait échouer le transfert — qui repart de zéro à
    la reprise. La marge (`isTokenExpiringSoon`, deux minutes) existait déjà et
    était utilisée ailleurs ; c'est ICI, sur le chemin que prend CHAQUE requête
    de synchronisation, qu'elle manquait.

    Sur 'network' on rend `null` (l'appelant verra un échec d'API) sans tuer la
    session : `getAccessToken` récupère au mieux, il ne déconnecte pas.
  */
  if (isTokenExpiringSoon(tokens.accessToken)) {
    const outcome = await refreshTokens();
    if (outcome !== 'ok') return null;
    const newTokens = await loadTokens();
    return newTokens?.accessToken || null;
  }

  return tokens.accessToken;
}

// ── Phrase-based account recovery ──────────────────────────────────────────
// Replaces the defunct email reset. Two steps: verify the phrase to obtain
// the server-held wrapped FEK + a short-lived reset token, then commit the
// new password + re-wrapped FEK blobs.

export interface WrappedKeyFromServer {
  wrappedFek: string;
  kekSalt: string;
  version: number;
  recoveryWrappedFek?: string;
  recoverySalt?: string;
}

// E2-5: the per-user keypair blob returned/accepted alongside the FEK during
// recovery. The worker stores it opaquely; this process just passes it through.
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
): Promise<
  ApiResponse<{
    resetToken: string;
    wrappedKey: WrappedKeyFromServer | null;
    userKey: UserKeyFromServer | null;
  }>
> {
  return apiCall('/auth/recover/phrase-verify', {
    method: 'POST',
    body: JSON.stringify({ email, recoveryPhrase }),
  });
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
}): Promise<ApiResponse<{ user: UserDTO }>> {
  return apiCall('/auth/recover/complete', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function verifyEmail(token: string): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await apiCall('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    return { success: result.success, error: result.error };
  } catch (error) {
    log.error('[authService] verifyEmail error:', (error as Error).message);
    return { success: false, error: 'Network error. Please try again.' };
  }
}

export async function getMe(): Promise<{ success: boolean; user?: UserDTO; error?: string }> {
  try {
    const result = await authenticatedApiCall<{ user: UserDTO }>('/auth/me');

    if (!result.success || !result.data) {
      return { success: false, error: result.error || 'Failed to fetch user' };
    }

    await saveUserCache(result.data.user);
    return { success: true, user: result.data.user };
  } catch (error) {
    log.error('[authService] getMe error:', (error as Error).message);
    return { success: false, error: 'Network error' };
  }
}

export async function isAuthenticated(): Promise<boolean> {
  const tokens = await loadTokens();
  if (!tokens?.accessToken) return false;

  // If access token is expired, check if we can refresh
  if (isTokenExpired(tokens.accessToken)) {
    if (!tokens.refreshToken) return false;
    // Don't actually refresh here — just check if refresh token exists
    // The actual refresh will happen on first API call
    return true;
  }

  return true;
}

export async function getAuthStatus(): Promise<{
  isAuthenticated: boolean;
  user: UserDTO | null;
  accountMode: 'local' | 'cloud';
  syncPaused: boolean;
}> {
  // Read the pause flag with the profile-scoped key first, falling back to
  // the legacy global key for users updating from a single-account build.
  // Legacy values are migrated on first `sync:setEnabled` call.
  let syncPaused = false;
  try {
    const flagsFilePath = path.join(app.getPath('userData'), 'filarr-flags.json');
    const raw = await fs.readFile(flagsFilePath, 'utf-8').catch(() => null);
    if (raw) {
      const flags = JSON.parse(raw) as Record<string, string>;
      const perProfileKey = currentProfileId ? `sync-paused-${currentProfileId}` : null;
      const perProfileValue = perProfileKey ? flags[perProfileKey] : undefined;
      syncPaused =
        perProfileValue !== undefined
          ? perProfileValue === 'true'
          : flags['sync-paused'] === 'true';
    }
  } catch {
    /* missing/corrupt flags file → default to not paused */
  }

  const hasTokens = await isAuthenticated();
  if (!hasTokens) {
    return { isAuthenticated: false, user: null, accountMode: 'local', syncPaused };
  }

  const user = await loadUserCache();
  return {
    isAuthenticated: true,
    user,
    accountMode: 'cloud',
    syncPaused,
  };
}

export async function getDevices(): Promise<{ success: boolean; data?: unknown; error?: string }> {
  try {
    const res = await authenticatedApiCall<Record<string, unknown>>('/account/devices');
    /**
     * QUEL DE CES APPAREILS EST CELUI-CI ?
     *
     * Le serveur ne peut pas le dire : la requête est portée par un jeton
     * d'accès, qui n'identifie pas la machine. L'écran le DEVINAIT donc — il
     * prenait le premier de la liste, c'est-à-dire le dernier vu — et se
     * trompait dès que cette machine n'était pas la plus récemment active :
     * on lisait « Cet appareil » sur le téléphone de quelqu'un d'autre, et le
     * bouton « Révoquer » manquait précisément là où il aurait servi.
     *
     * L'identifiant est pourtant sur le disque depuis toujours (`.device_id`,
     * envoyé à chaque connexion). On le joint à la réponse : plus de devinette.
     */
    if (res.success && res.data && typeof res.data === 'object') {
      (res.data as Record<string, unknown>).currentDeviceId = await getOrCreateDeviceId();
    }
    return res;
  } catch (error) {
    log.error('[authService] getDevices error:', (error as Error).message);
    return { success: false, error: 'Network error' };
  }
}

/** Ferme les sessions dormantes (30 j sans rotation) et retire leurs appareils — pas celui-ci. */
export async function revokeDormantDevices(): Promise<{
  success: boolean;
  data?: { devices: number; sessions: number };
  error?: string;
}> {
  try {
    return await authenticatedApiCall('/account/devices/revoke-dormant', {
      method: 'POST',
      body: JSON.stringify({ exceptDeviceId: await getOrCreateDeviceId() }),
    });
  } catch (error) {
    log.error('[authService] revokeDormantDevices error:', (error as Error).message);
    return { success: false, error: 'Network error' };
  }
}

export async function deleteDevice(deviceId: string): Promise<{ success: boolean; error?: string }> {
  try {
    return await authenticatedApiCall(`/account/devices/${deviceId}`, { method: 'DELETE' });
  } catch (error) {
    log.error('[authService] deleteDevice error:', (error as Error).message);
    return { success: false, error: 'Network error' };
  }
}

export async function deleteAccountData(): Promise<{ success: boolean; error?: string }> {
  try {
    return await authenticatedApiCall('/account/data', { method: 'DELETE' });
  } catch (error) {
    log.error('[authService] deleteAccountData error:', (error as Error).message);
    return { success: false, error: 'Network error' };
  }
}

export async function deleteAccount(): Promise<{
  success: boolean;
  error?: string;
  // Le refus du Worker porte le code et le nombre de coffres concernés :
  // l'enveloppe les contient, ce type les laisse enfin passer jusqu'à l'écran.
  code?: string;
  vaultCount?: number;
}> {
  try {
    const result = await authenticatedApiCall('/account', { method: 'DELETE' });
    if (result.success) {
      stopAutoRefresh();
      await clearTokens();
      await clearUserCache();
    }
    return result;
  } catch (error) {
    log.error('[authService] deleteAccount error:', (error as Error).message);
    return { success: false, error: 'Network error' };
  }
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  try {
    return await authenticatedApiCall('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  } catch (error) {
    log.error('[authService] changePassword error:', (error as Error).message);
    return { success: false, error: 'Network error' };
  }
}

// ── 2FA Management ──────────────────────────────────────────────────────────

export async function get2FAStatus(): Promise<
  ApiResponse<{
    enabled: boolean;
    pendingSetup: boolean;
    unusedBackupCodes: number;
    confirmedAt: string | null;
  }>
> {
  return authenticatedApiCall('/auth/2fa/status');
}

export async function setup2FA(): Promise<
  ApiResponse<{ secret: string; otpauthUrl: string }>
> {
  return authenticatedApiCall('/auth/2fa/setup', { method: 'POST' });
}

export async function verifySetup2FA(
  code: string
): Promise<ApiResponse<{ backupCodes: string[] }>> {
  return authenticatedApiCall('/auth/2fa/verify-setup', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export async function disable2FA(
  password: string,
  code: string
): Promise<ApiResponse<null>> {
  return authenticatedApiCall('/auth/2fa/disable', {
    method: 'POST',
    body: JSON.stringify({ password, code }),
  });
}

export async function regenerateBackupCodes(
  password: string,
  code: string
): Promise<ApiResponse<{ backupCodes: string[] }>> {
  return authenticatedApiCall('/auth/2fa/backup-codes/regenerate', {
    method: 'POST',
    body: JSON.stringify({ password, code }),
  });
}

export async function regenerateRecoveryPhrase(
  password: string,
  code?: string
): Promise<ApiResponse<{ recoveryCodes: string[] }>> {
  return authenticatedApiCall('/account/recovery-phrase/regenerate', {
    method: 'POST',
    body: JSON.stringify({ password, code }),
  });
}

// ── Auto-Refresh Timer ──────────────────────────────────────────────────────

function startAutoRefresh(): void {
  stopAutoRefresh();
  refreshTimer = setInterval(async () => {
    try {
      const tokens = await loadTokens();
      if (!tokens?.accessToken) {
        stopAutoRefresh();
        return;
      }

      if (isTokenExpiringSoon(tokens.accessToken)) {
        log.info('[authService] Access token expiring soon, refreshing...');
        const outcome = await refreshTokens();
        if (outcome === 'rejected') {
          log.warn('[authService] Refresh token rejected by server, logging out');
          await logout();
        } else if (outcome === 'network') {
          // Hold the session. We'll try again at the next tick (5 min).
          log.warn('[authService] Refresh skipped (network) — will retry next tick');
        }
      }
    } catch (error) {
      log.error('[authService] Auto-refresh error:', (error as Error).message);
    }
  }, REFRESH_CHECK_INTERVAL);
}

function stopAutoRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

// ── Renderer Notification ───────────────────────────────────────────────────

function notifyRenderer(): void {
  const windows = BrowserWindow.getAllWindows();
  const status = {
    isAuthenticated: cachedUser !== null,
    user: cachedUser,
    accountMode: cachedUser ? 'cloud' : 'local',
  };
  for (const win of windows) {
    win.webContents.send('auth-status-changed', status);
  }
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

/**
 * Attach this module to a profile. Every subsequent token/cache read or
 * write is scoped to that profile's data directory. Must be called BEFORE
 * initAuth() on startup and again whenever the user switches profiles.
 *
 * Performs a one-time migration of legacy global tokens if the target profile
 * has no tokens yet but the legacy location does — this keeps existing users
 * signed in after the per-profile refactor ships.
 */
export async function setProfile(profileId: string): Promise<void> {
  // Reset in-memory state from any prior profile. Refresh timer is stopped
  // so we don't accidentally refresh tokens we're no longer scoped to.
  stopAutoRefresh();
  cachedUser = null;
  pendingMfaToken = null;
  pendingEnrollToken = null;

  // Garde-fou : entrer dans un profil referme toujours la zone d'attente. Si
  // elle est encore ouverte ici, c'est que l'appelant n'a ni adopté ni annulé —
  // on refuse de laisser le drapeau masquer le profil qu'on vient de choisir.
  if (pendingRealm) {
    log.warn('[authService] setProfile with an un-adopted pending realm — dropping it');
    pendingRealm = false;
  }

  currentProfileId = profileId;

  // Restore this profile's SPACE first — it is the axis that decides whether the
  // org context is honored at all. Migration: profiles created before .space
  // existed derive it once from whether they already have an active org (an
  // existing enterprise member → enterprise, everyone else → personal), then we
  // lazily persist so the derivation happens at most once (self-healing).
  let space = await loadSpace();
  if (space === null) {
    const existingOrg = await loadCurrentOrg();
    space = existingOrg ? 'enterprise' : 'personal';
    await persistSpace(space);
    profileManager
      .setSpaceMode(profileId, space)
      .catch((err) => log.warn('[authService] setSpaceMode (migration) hint failed:', err));
  }
  currentSpace = space;

  // Invariant: personal space NEVER attaches an org (currentOrgId stays null, so
  // no X-Org-Id); enterprise space restores the persisted org so X-Org-Id is
  // correct from the first request after a profile switch / app restart. The
  // .current_org file is left intact in personal space so switching back to
  // enterprise restores the last selection.
  currentOrgId = space === 'enterprise' ? await loadCurrentOrg() : null;

  // One-shot migration: tokens at legacy global path → new profile-scoped
  // path. Happens at most once per profile (the legacy file is deleted after
  // copy). If multiple profiles exist, only the FIRST one to call setProfile
  // after the update inherits the global session — the user will need to
  // log in manually on the others, which is the intended multi-account UX.
  await migrateLegacyTokensToProfile(profileId);
}

/** Detach — renderer should treat the app as in a "between profiles" limbo. */
export function clearProfile(): void {
  stopAutoRefresh();
  cachedUser = null;
  pendingMfaToken = null;
  pendingEnrollToken = null;
  currentProfileId = null;
  currentOrgId = null;
  currentSpace = 'personal';
}

// ── Domaine d'attente : « ajouter un compte cloud » ──────────────────────────

/**
 * Ouvrir la zone d'attente. Tout ce qu'écrira l'authentification qui suit —
 * jetons, cache utilisateur, identifiant d'appareil, espace — atterrit dans
 * `.pending-account/` au lieu du profil courant, qui n'a rien demandé.
 *
 * La zone est REPARTIE DE ZÉRO à chaque ouverture : une tentative abandonnée ne
 * doit jamais servir de session à la suivante.
 */
export async function beginPendingSession(): Promise<void> {
  stopAutoRefresh();
  cachedUser = null;
  pendingMfaToken = null;
  pendingEnrollToken = null;
  // Le profil courant est détaché : `saveUserCache` estampille `cloudAccount`
  // sur `currentProfileId`, et il ne faut PAS marquer l'ancien profil au nom du
  // compte qu'on est en train d'ajouter. L'estampille est posée à l'adoption.
  currentProfileId = null;
  currentOrgId = null;
  currentSpace = 'personal';
  pendingRealm = true;

  const dir = getPendingRealmDir();
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(dir, { recursive: true });
  log.info('[authService] pending sign-in realm opened');
}

export function hasPendingSession(): boolean {
  return pendingRealm;
}

/** Le compte authentifié dans la zone d'attente, ou null si personne encore. */
export async function getPendingAccount(): Promise<{
  email: string;
  tier: string;
  accountType?: 'personal' | 'enterprise';
} | null> {
  if (!pendingRealm) return null;
  const user = await loadUserCache();
  if (!user) return null;
  return { email: user.email, tier: user.subscriptionTier, accountType: user.accountType };
}

/**
 * Déménager la session en attente vers le profil retenu, puis refermer la zone.
 *
 * ÉCRASE les artefacts homonymes du profil cible : la personne vient de prouver
 * qui elle est, et cette preuve prime sur une session périmée qui traînerait
 * là. L'appelant garantit que le profil appartient bien à ce compte (ou n'est
 * lié à aucun) — voir `profile:activate`.
 */
export async function adoptPendingSession(profileId: string): Promise<boolean> {
  if (!pendingRealm) return false;

  const src = getPendingRealmDir();
  const dest = getProfileBasePath(profileId);

  try {
    await fs.mkdir(dest, { recursive: true });
    for (const filename of [
      TOKENS_FILE,
      USER_FILE,
      DEVICE_ID_FILE,
      TRUSTED_DEVICE_FILE,
      CURRENT_ORG_FILE,
      SPACE_FILE,
    ]) {
      const from = path.join(src, filename);
      const exists = await fs
        .access(from)
        .then(() => true)
        .catch(() => false);
      if (!exists) continue;
      const to = path.join(dest, filename);
      try {
        await fs.rename(from, to);
      } catch {
        // Cross-volume ou verrou : copie + suppression, comme la migration
        // héritée. On déplace des blobs déjà chiffrés, rien n'est réécrit.
        const data = await fs.readFile(from);
        await fs.writeFile(to, data, { mode: 0o600 });
        await fs.unlink(from).catch(() => {});
      }
    }
    log.info(`[authService] pending session adopted by profile ${profileId}`);
    return true;
  } catch (err) {
    log.error('[authService] adoptPendingSession failed:', (err as Error).message);
    return false;
  } finally {
    pendingRealm = false;
    // Reste de la zone (FEK déjà déménagée par StorageService) : on efface.
    await fs.rm(src, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Abandonner : on révoque côté serveur tant qu'on tient encore les jetons, puis
 * on efface la zone. Sans la révocation, un jeton de rafraîchissement bien
 * vivant survivrait à une démarche que l'utilisateur a explicitement annulée.
 */
export async function discardPendingSession(): Promise<void> {
  if (!pendingRealm) {
    // Ménage de démarrage : une zone laissée par un plantage n'a plus de sens.
    await fs.rm(getPendingRealmDir(), { recursive: true, force: true }).catch(() => {});
    return;
  }
  try {
    await logout();
  } catch {
    /* hors ligne : on efface quand même localement */
  }
  pendingRealm = false;
  cachedUser = null;
  pendingMfaToken = null;
  pendingEnrollToken = null;
  await fs.rm(getPendingRealmDir(), { recursive: true, force: true }).catch(() => {});
  log.info('[authService] pending sign-in realm discarded');
}

// ── Workspace space (personal | enterprise) ──────────────────────────────────

function getSpacePath(): string {
  return path.join(getBasePath(), SPACE_FILE);
}

async function loadSpace(): Promise<WorkspaceSpace | null> {
  try {
    const raw = (await fs.readFile(getSpacePath(), 'utf8')).trim();
    return raw === 'personal' || raw === 'enterprise' ? raw : null;
  } catch {
    return null;
  }
}

async function persistSpace(space: WorkspaceSpace): Promise<void> {
  try {
    const dir = getBasePath();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(getSpacePath(), space, { mode: 0o600 });
  } catch (err) {
    log.warn(`[authService] failed to persist space: ${(err as Error).message}`);
  }
}

/** The active workspace space for the current profile. */
export function getSpace(): WorkspaceSpace {
  return currentSpace;
}

/**
 * Set (and persist, per profile) the active space. Personal space forces the org
 * context off (currentOrgId=null, no X-Org-Id). Enterprise space binds the given
 * orgId, or — when orgId is omitted — restores the last-persisted org (which may
 * be null → the "pick or create an org" empty state). Passing orgId=null in
 * enterprise space clears the bound org.
 */
export async function setSpace(space: WorkspaceSpace, orgId?: string | null): Promise<void> {
  currentSpace = space;
  await persistSpace(space);
  if (currentProfileId) {
    profileManager
      .setSpaceMode(currentProfileId, space)
      .catch((err) => log.warn('[authService] setSpaceMode hint failed:', err));
  }
  if (space === 'personal') {
    // Invariant: personal never attaches an org. Keep .current_org on disk so
    // returning to enterprise restores the last selection.
    currentOrgId = null;
  } else if (orgId !== undefined) {
    await setCurrentOrg(orgId);
  } else {
    currentOrgId = await loadCurrentOrg();
  }
}

// ── Organization context (E1-6) ──────────────────────────────────────────────

function getCurrentOrgPath(): string {
  return path.join(getBasePath(), CURRENT_ORG_FILE);
}

async function loadCurrentOrg(): Promise<string | null> {
  try {
    const raw = (await fs.readFile(getCurrentOrgPath(), 'utf8')).trim();
    return raw || null;
  } catch {
    return null;
  }
}

/** The active org id for the current profile (null = personal context). */
export function getCurrentOrg(): string | null {
  return currentOrgId;
}

/**
 * Set (and persist, per profile) the active org. Pass null to return to the
 * personal context. Subsequent org-scoped requests carry X-Org-Id accordingly.
 */
export async function setCurrentOrg(orgId: string | null): Promise<void> {
  // Invariant (total): personal space never binds an org, so no X-Org-Id can
  // ever leak from a personal context. A non-null bind is honored only in
  // enterprise space; space transitions go through setSpace, which sets
  // currentSpace before calling this. Clearing (null) is always allowed.
  if (orgId && currentSpace !== 'enterprise') {
    return;
  }
  currentOrgId = orgId;
  try {
    if (orgId) {
      const dir = getBasePath();
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(getCurrentOrgPath(), orgId, { mode: 0o600 });
    } else {
      await fs.rm(getCurrentOrgPath(), { force: true });
    }
  } catch (err) {
    log.warn(`[authService] failed to persist current org: ${(err as Error).message}`);
  }
}

/** List the organizations the signed-in user belongs to (GET /org). */
export async function listOrgs(): Promise<ApiResponse<{ orgs: unknown[] }>> {
  const res = await authenticatedApiCall<{ orgs: unknown[] }>('/org');
  // Opportunistically refresh the picker's denormalized org hint so the
  // Enterprise toggle can appear without a network call on the next launch.
  if (res.success && Array.isArray(res.data?.orgs) && currentProfileId) {
    try {
      const hint = (res.data.orgs as Array<Record<string, unknown>>).map((o) => ({
        id: String(o.id),
        name: String(o.name ?? ''),
        tier: String(o.tier ?? ''),
        role: String(o.role ?? 'viewer'),
        isPersonal: o.isPersonal === true,
      }));
      await profileManager.setOrgsHint(currentProfileId, hint);
    } catch (err) {
      log.warn('[authService] setOrgsHint failed:', err);
    }
  }
  return res;
}

// ── E9-10: org governance policy cache (offline enforcement) ──────────────────
//
// PLAIN JSON, NOT safeStorage-encrypted: the policy is metadata-only (session
// timeouts, offline-grace days, sharing flags — never keys or content) and it
// MUST stay readable offline even where safeStorage is unavailable or the OS
// keychain was reset, because that's exactly when the offline-grace clock runs.
// Profile-scoped (getBasePath) + orgId-stamped so a stale cache can never bleed
// across orgs/profiles; the renderer re-validates orgId before applying. This is
// a best-effort, client-applied guard — a determined offline user who holds the
// password can still bypass it, and the app discloses that honestly (E9-10).

export interface CachedPolicy {
  orgId: string;
  /** The effective policy subset served by GET /org/:id/policies/effective. */
  policyJson: unknown;
  policyVersion: number;
  /** epoch ms when last fetched while online — drives the offline-grace clock. */
  fetchedAt: number;
}

function getPolicyCachePath(): string {
  return path.join(getBasePath(), POLICY_CACHE_FILE);
}

export async function savePolicyCache(data: CachedPolicy): Promise<void> {
  // Tie the cache to the active org: persist ONLY when we are currently scoped to exactly this org.
  // Requiring currentOrgId to be non-null AND equal closes a late write after switching to a personal
  // context (currentOrgId === null), which would otherwise contaminate the profile's cache file.
  if (!data || typeof data.orgId !== 'string' || !currentOrgId || data.orgId !== currentOrgId) return;
  try {
    const filePath = getPolicyCachePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = cheminDeStaging(filePath);
    const json = JSON.stringify(data);
    await fs.writeFile(tmp, json, { mode: 0o600 });
    try {
      await fs.rename(tmp, filePath);
    } catch {
      await fs.writeFile(filePath, json, { mode: 0o600 });
      await fs.unlink(tmp).catch(() => {});
    }
  } catch (err) {
    log.warn(`[authService] policy cache write failed (non-fatal): ${(err as Error).message}`);
  }
}

export async function loadPolicyCache(): Promise<CachedPolicy | null> {
  try {
    const raw = await fs.readFile(getPolicyCachePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<CachedPolicy>;
    if (
      parsed &&
      typeof parsed.orgId === 'string' &&
      typeof parsed.policyVersion === 'number' &&
      typeof parsed.fetchedAt === 'number' &&
      parsed.policyJson !== undefined
    ) {
      return parsed as CachedPolicy;
    }
    return null;
  } catch {
    return null;
  }
}

export async function clearPolicyCache(): Promise<void> {
  await fs.unlink(getPolicyCachePath()).catch(() => {});
}

// ── E9-11: remote-wipe execution (client side) ───────────────────────────────
//
// On a `device_wipe_required` refresh, the device clears its local KEYS + cache so the encrypted
// content on disk becomes undecryptable (crypto + content-cache scope — notes.db/files stay but
// unreadable; the personal profile/settings are NOT destroyed). main.ts registers the orchestrating
// handler (it also deletes the StorageService key files + signals the renderer to sign the ack + lock);
// authService only owns its own artifacts here. Best-effort + honest: a device that never reconnects
// is never wiped (the server marks it wipe_pending_stale, E9-11).

let deviceWipeHandler: ((info: { wipeNonce: string | null }) => Promise<void>) | null = null;
export function setDeviceWipeHandler(
  fn: ((info: { wipeNonce: string | null }) => Promise<void>) | null
): void {
  deviceWipeHandler = fn;
}

/** The active profile's data directory (where the auth + key artifacts live). */
export function getProfileDir(): string {
  return getBasePath();
}

/** The current device id WITHOUT creating one — null if this device has never enrolled. */
export async function peekDeviceId(dir: string = getBasePath()): Promise<string | null> {
  try {
    const raw = (await fs.readFile(path.join(dir, DEVICE_ID_FILE), 'utf8')).trim();
    return raw || null;
  } catch {
    return null;
  }
}

/**
 * Clear the auth + session + device-identity artifacts this module owns (tokens, user cache, policy
 * cache, trusted-device token) and the device id (so a re-enrol gets a FRESH id — never the wiped one,
 * which would let an old wipe_nonce interfere). The crypto key files are cleared by main's handler.
 *
 * Operates on an EXPLICIT `dir` (the caller pins the active profile's directory synchronously at wipe
 * start) so a concurrent profile switch can't redirect this to a DIFFERENT profile's tokens.
 */
export async function wipeAuthArtifacts(dir: string = getBasePath()): Promise<void> {
  stopAutoRefresh();
  cachedUser = null;
  for (const f of [TOKENS_FILE, USER_FILE, POLICY_CACHE_FILE, TRUSTED_DEVICE_FILE, DEVICE_ID_FILE]) {
    await safeDelete(path.join(dir, f));
  }
  // Le poste aussi : la ligne serveur porte l'ordre d'effacement, y retomber
  // par la machine la ferait refuser a jamais (voir getOrCreateMachineId).
  await safeDelete(path.join(getLegacyBasePath(), MACHINE_ID_FILE));
  // Best-effort: drop the cloud-account badge from the profile manifest so the ProfilePicker doesn't
  // show a logged-in account for a wiped profile. Cosmetic only — NOT part of the irreversible wipe —
  // so reading currentProfileId here (rather than the pinned dir) is acceptable.
  if (currentProfileId) {
    try {
      await profileManager.setCloudAccount(currentProfileId, null);
    } catch {
      /* ignore — manifest badge is cosmetic */
    }
  }
}

// ── Org onboarding: create / join ─────────────────────────────────────────────

/** Create an organization (creator becomes owner). POST /org → { org }. */
export async function createOrg(
  name: string
): Promise<ApiResponse<{ org: { id: string; name: string; tier: string } }>> {
  return authenticatedApiCall(`/org`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

/** Accept an org invitation by token (join). POST /org/invitations/:token/accept. */
export async function acceptOrgInvitation(
  token: string
): Promise<ApiResponse<{ orgId: string; role: string }>> {
  return authenticatedApiCall(`/org/invitations/${encodeURIComponent(token)}/accept`, {
    method: 'POST',
  });
}

// ── Org admin console operations (E1-8) ──────────────────────────────────────
// Path-scoped management API (/org/:orgId/...). The org id is in the path, so
// these don't depend on the X-Org-Id header.

export async function getOrgMembers(orgId: string): Promise<ApiResponse<unknown>> {
  return authenticatedApiCall(`/org/${orgId}/members`);
}

export async function updateOrgMemberRole(
  orgId: string,
  userId: string,
  role: string
): Promise<ApiResponse<unknown>> {
  return authenticatedApiCall(`/org/${orgId}/members/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}

export async function removeOrgMember(
  orgId: string,
  userId: string
): Promise<ApiResponse<unknown>> {
  return authenticatedApiCall(`/org/${orgId}/members/${userId}`, { method: 'DELETE' });
}

export async function listOrgInvitations(orgId: string): Promise<ApiResponse<unknown>> {
  return authenticatedApiCall(`/org/${orgId}/invitations`);
}

export async function createOrgInvitation(
  orgId: string,
  email: string,
  role: string,
  lang?: string
): Promise<ApiResponse<unknown>> {
  return authenticatedApiCall(`/org/${orgId}/invitations`, {
    method: 'POST',
    body: JSON.stringify({ email, role, lang }),
  });
}

export async function revokeOrgInvitation(
  orgId: string,
  invId: string
): Promise<ApiResponse<unknown>> {
  return authenticatedApiCall(`/org/${orgId}/invitations/${invId}`, { method: 'DELETE' });
}

export async function getOrgBillingStatus(orgId: string): Promise<ApiResponse<unknown>> {
  return authenticatedApiCall(`/org/${orgId}/billing/status`);
}

export async function createOrgBillingCheckout(
  orgId: string,
  plan: string,
  period: string,
  successUrl: string,
  cancelUrl: string
): Promise<ApiResponse<{ checkoutUrl: string }>> {
  return authenticatedApiCall(`/org/${orgId}/billing/checkout`, {
    method: 'POST',
    body: JSON.stringify({ plan, period, successUrl, cancelUrl }),
  });
}

export async function createOrgBillingPortal(
  orgId: string
): Promise<ApiResponse<{ portalUrl: string }>> {
  return authenticatedApiCall(`/org/${orgId}/billing/portal`, { method: 'POST' });
}

/**
 * Acheter (ou rendre) des sièges.
 *
 * Le serveur refuse de descendre sous le nombre de membres facturables existants
 * ou sous le minimum du plan, et renvoie alors `seats_below_floor` avec le
 * plancher — c'est ce code que l'interface traduit, plutôt qu'un message vague.
 */
export async function setOrgBillingSeats(
  orgId: string,
  seats: number
): Promise<ApiResponse<{ seats: number; unchanged?: boolean }>> {
  return authenticatedApiCall(`/org/${orgId}/billing/seats`, {
    method: 'POST',
    body: JSON.stringify({ seats }),
  });
}

export async function updateOrg(
  orgId: string,
  name: string
): Promise<ApiResponse<unknown>> {
  return authenticatedApiCall(`/org/${orgId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

/** Initiate org teardown (owner-only) — sets pending_deletion (E1-12). */
export async function deleteOrg(orgId: string): Promise<ApiResponse<unknown>> {
  return authenticatedApiCall(`/org/${orgId}`, { method: 'DELETE' });
}

/** Retire une suppression engagée, tant que la grâce court (propriétaire). */
export async function restoreOrg(orgId: string): Promise<ApiResponse<unknown>> {
  return authenticatedApiCall(`/org/${orgId}/restore`, { method: 'POST' });
}

async function migrateLegacyTokensToProfile(profileId: string): Promise<void> {
  const legacyBase = getLegacyBasePath();
  const legacyTokens = path.join(legacyBase, TOKENS_FILE);
  const legacyUser = path.join(legacyBase, USER_FILE);
  const legacyDeviceId = path.join(legacyBase, DEVICE_ID_FILE);

  const profileBase = path.join(legacyBase, 'profiles', profileId.replace(/[^a-zA-Z0-9\-]/g, ''));
  const profileTokens = path.join(profileBase, TOKENS_FILE);

  // Already migrated (or never had legacy tokens) → nothing to do.
  const [profileHasTokens, legacyHasTokens] = await Promise.all([
    fs
      .access(profileTokens)
      .then(() => true)
      .catch(() => false),
    fs
      .access(legacyTokens)
      .then(() => true)
      .catch(() => false),
  ]);
  if (profileHasTokens || !legacyHasTokens) return;

  try {
    await fs.mkdir(profileBase, { recursive: true });
    // Move each artifact if it exists — preserves encryption, we just move
    // the ciphertext blobs. Rename falls back to copy+unlink on cross-device.
    for (const [src, filename] of [
      [legacyTokens, TOKENS_FILE],
      [legacyUser, USER_FILE],
      [legacyDeviceId, DEVICE_ID_FILE],
    ] as const) {
      const srcExists = await fs
        .access(src)
        .then(() => true)
        .catch(() => false);
      if (!srcExists) continue;
      const dest = path.join(profileBase, filename);
      try {
        await fs.rename(src, dest);
      } catch {
        // Cross-volume or permission — fall back to copy + unlink.
        const data = await fs.readFile(src);
        await fs.writeFile(dest, data, { mode: 0o600 });
        await fs.unlink(src).catch(() => {});
      }
    }
    log.info(`[authService] Migrated legacy tokens to profile ${profileId}`);
  } catch (err) {
    log.error('[authService] Legacy token migration failed:', err);
  }
}

/**
 * Initialize auth on app startup.
 * Call this from main.ts after the window is created.
 */
export async function initAuth(): Promise<void> {
  const hasTokens = await isAuthenticated();
  if (!hasTokens) {
    log.info('[authService] No auth tokens found, starting in local mode');
    return;
  }

  log.info('[authService] Auth tokens found, verifying session...');

  // Try to refresh user info from the server
  const meResult = await getMe();
  if (meResult.success) {
    startAutoRefresh();
    notifyRenderer();
    log.info('[authService] Session valid, cloud mode active');
  } else {
    // getMe failed — try refreshing tokens
    const outcome = await refreshTokens();
    if (outcome === 'ok') {
      startAutoRefresh();
      notifyRenderer();
      log.info('[authService] Token refreshed, cloud mode active');
    } else if (outcome === 'rejected') {
      // Server has explicitly invalidated this session — clear locally too.
      log.warn('[authService] Session rejected by server, clearing tokens');
      await clearTokens();
      await clearUserCache();
    } else {
      // 'network' — auth backend unreachable at boot. Keep the tokens
      // (so re-launching online later restores the session) and start
      // the auto-refresh timer so it keeps trying every 5 min in the
      // background. The renderer sees the cached user as authenticated.
      log.warn('[authService] Auth backend unreachable at boot — holding session');
      startAutoRefresh();
      notifyRenderer();
    }
  }
}

/**
 * Cleanup on app quit.
 */
export function cleanup(): void {
  stopAutoRefresh();
}
