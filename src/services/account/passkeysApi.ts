import apiClient from '../network/apiClient';
import type { UserDTO } from '../../types/auth';
import { isWebPlatform } from '../platform/isWebPlatform';
import { getWebDeviceId, getWebDeviceName } from '../../platform/web/webApiBase';

/**
 * LES CLÉS D'ACCÈS, CÔTÉ CLIENT.
 *
 * ═══ CE QU'UNE CLÉ D'ACCÈS OUVRE ═══
 *
 * Le COMPTE, jamais le coffre. La clé qui déchiffre les fichiers se dérive du
 * mot de passe du coffre, sur l'appareil ; une clé d'accès ne la remplace pas et
 * ne la contourne pas. Se connecter avec une clé d'accès puis ouvrir son coffre
 * restent deux gestes.
 *
 * ═══ POURQUOI C'EST LE NAVIGATEUR, ET PAS LE BUREAU ═══
 *
 * WebAuthn lie une clé à un NOM DE DOMAINE, et le vérifie contre l'origine de la
 * page. L'application de bureau sert son interface depuis un schéma privé
 * (`app://`), qui n'est pas `filarr.com` : le navigateur refuserait la clé, et
 * ce refus n'a pas de contournement propre. `passkeysSupported()` dit donc non
 * sur le bureau, et l'écran propose d'aller sur app.filarr.com plutôt que
 * d'offrir un bouton qui échouerait.
 */

export interface PasskeyDTO {
  id: string;
  label: string | null;
  deviceType: string | null;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

/** Le navigateur sait-il faire, et sommes-nous sur une origine qu'il acceptera ? */
export function passkeysSupported(): boolean {
  if (!isWebPlatform()) return false;
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential === 'function' &&
    !!navigator.credentials
  );
}

// ── base64url ↔ octets — WebAuthn parle en octets, le réseau en texte ────────

function deB64u(txt: string): Uint8Array {
  const pad = txt.replace(/-/g, '+').replace(/_/g, '/');
  const brut = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  const out = new Uint8Array(brut.length);
  for (let i = 0; i < brut.length; i++) out[i] = brut.charCodeAt(i);
  return out;
}

function b64u(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Le serveur envoie ses options en base64url (c'est du JSON) ; `navigator`
 * exige des octets. La conversion est mécanique mais elle ne pardonne pas : un
 * champ oublié fait échouer l'appel avec une erreur qui ne dit pas lequel.
 */
function optionsPourNavigateur<T extends Record<string, unknown>>(options: T): T {
  const out: Record<string, unknown> = { ...options };
  if (typeof options.challenge === 'string') out.challenge = deB64u(options.challenge);
  const user = options.user as { id?: unknown } | undefined;
  if (user && typeof user.id === 'string') out.user = { ...user, id: deB64u(user.id) };
  for (const cle of ['excludeCredentials', 'allowCredentials']) {
    const liste = options[cle];
    if (Array.isArray(liste)) {
      out[cle] = liste.map((c: Record<string, unknown>) =>
        typeof c.id === 'string' ? { ...c, id: deB64u(c.id) } : c
      );
    }
  }
  return out as T;
}

/** La réponse du navigateur, remise en texte pour le voyage. */
function reponsePourServeur(cred: PublicKeyCredential): Record<string, unknown> {
  const r = cred.response as AuthenticatorAttestationResponse & AuthenticatorAssertionResponse;
  const out: Record<string, unknown> = {
    id: cred.id,
    rawId: b64u(cred.rawId),
    type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults(),
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    response: {
      clientDataJSON: b64u(r.clientDataJSON),
    } as Record<string, unknown>,
  };
  const rep = out.response as Record<string, unknown>;
  if (r.attestationObject) {
    rep.attestationObject = b64u(r.attestationObject);
    if (typeof r.getTransports === 'function') rep.transports = r.getTransports();
  }
  if (r.authenticatorData) rep.authenticatorData = b64u(r.authenticatorData);
  if (r.signature) rep.signature = b64u(r.signature);
  if (r.userHandle) rep.userHandle = b64u(r.userHandle);
  return out;
}

// ── Inscrire une clé (session ouverte) ──────────────────────────────────────

export async function apiListPasskeys(): Promise<PasskeyDTO[]> {
  const { data } = await apiClient.get<Envelope<{ passkeys: PasskeyDTO[] }>>('/auth/passkeys');
  return data.data?.passkeys ?? [];
}

export async function apiDeletePasskey(id: string): Promise<number> {
  const { data } = await apiClient.delete<Envelope<{ removed: number }>>(
    `/auth/passkeys/${encodeURIComponent(id)}`
  );
  return data.data?.removed ?? 0;
}

/**
 * Crée une clé d'accès et l'enregistre. Rend la clé créée, ou `null` si la
 * personne a fermé la fenêtre du navigateur — un renoncement n'est pas une
 * erreur, et ne doit pas s'afficher comme telle.
 */
export async function apiRegisterPasskey(label: string): Promise<PasskeyDTO | null> {
  const { data } = await apiClient.post<
    Envelope<{ challengeId: string; options: Record<string, unknown> }>
  >('/auth/passkeys/register/options', {});
  const debut = data.data;
  if (!debut) throw new Error(data.error || 'passkey_options_failed');

  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.create({
      publicKey: optionsPourNavigateur(debut.options) as never,
    })) as PublicKeyCredential | null;
  } catch (err) {
    // `NotAllowedError` = fenêtre fermée ou délai dépassé. C'est un choix, pas
    // une panne : on rend `null` et l'écran se tait.
    if ((err as Error).name === 'NotAllowedError') return null;
    throw err;
  }
  if (!cred) return null;

  const fin = await apiClient.post<Envelope<{ passkey: PasskeyDTO | null }>>(
    '/auth/passkeys/register',
    { challengeId: debut.challengeId, response: reponsePourServeur(cred), label }
  );
  if (!fin.data.success) throw new Error(fin.data.error || 'passkey_register_failed');
  return fin.data.data?.passkey ?? null;
}

// ── Se connecter avec une clé ───────────────────────────────────────────────

export interface PasskeyLoginResult {
  accessToken: string;
  refreshToken: string;
  /** Le compte, tel que /auth/login le rend : meme forme, memes appelants. */
  user: UserDTO;
  deviceId?: string;
}

/**
 * Ouvre une session avec une clé d'accès. Rend `null` si la personne renonce.
 * L'adresse est facultative et n'est qu'un indice : c'est la signature qui
 * désigne le compte, et le serveur répond la même chose qu'on la donne ou non
 * — sans quoi cette route dirait qui est inscrit.
 */
export async function apiLoginWithPasskey(email?: string): Promise<PasskeyLoginResult | null> {
  // L'appareil se déclare ICI plutôt que chez l'appelant : une session ouverte
  // sans identité d'appareil n'apparaîtrait dans aucune liste, et ne pourrait
  // pas être révoquée à distance.
  const device = {
    deviceId: getWebDeviceId(),
    deviceName: getWebDeviceName(),
    deviceOs: 'web',
    machineId: getWebDeviceId(),
  };
  const { data } = await apiClient.post<
    Envelope<{ challengeId: string; options: Record<string, unknown> }>
  >('/auth/passkeys/login/options', email ? { email } : {});
  const debut = data.data;
  if (!debut) throw new Error(data.error || 'passkey_options_failed');

  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.get({
      publicKey: optionsPourNavigateur(debut.options) as never,
    })) as PublicKeyCredential | null;
  } catch (err) {
    if ((err as Error).name === 'NotAllowedError') return null;
    throw err;
  }
  if (!cred) return null;

  const fin = await apiClient.post<Envelope<PasskeyLoginResult>>('/auth/passkeys/login', {
    challengeId: debut.challengeId,
    response: reponsePourServeur(cred),
    ...device,
  });
  if (!fin.data.success || !fin.data.data) {
    throw new Error(fin.data.error || 'passkey_login_failed');
  }
  return fin.data.data;
}
