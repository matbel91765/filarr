/**
 * Handlers web des canaux auth:* — le proxy main-process (electron/authService.ts)
 * réimplémenté en fetch direct vers le Worker, mêmes formes de requête/réponse.
 *
 * Différences assumées vs desktop :
 *  - le refresh token ne transite JAMAIS côté JS : le Worker le pose en cookie
 *    HttpOnly pour les origines navigateur allowlistées (cookies.ts) ; la
 *    restauration de session au boot passe par ce cookie, pas par safeStorage ;
 *  - le jeton d'accès vit en mémoire module (webApiBase), jamais persisté ;
 *  - le trusted-device token (skip TOTP 30 j) n'est pas persisté en W1 —
 *    localStorage serait plus faible que safeStorage ; à trancher avec QW-04.
 */

import type { UserDTO } from '../../../types/auth';
import {
  apiFetch,
  ensureAccessToken,
  getAccessToken,
  getWebDeviceId,
  adoptWebDeviceId,
  getWebDeviceName,
  refreshViaCookie,
  registerSessionAccountHintProvider,
  setAccessToken,
} from '../webApiBase';
import { getActiveProfileId } from '../webStore';
import { idbGet } from '../idb';
import { emitWebEvent } from '../webEventBus';

let _user: UserDTO | null = null;
let _pendingMfaToken: string | null = null;
/** La restauration en cours, mémorisée le temps qu'elle aboutisse. */
let _bootRestore: Promise<void> | null = null;
/** Une restauration qui a échoué n'est pas retentée avant ce délai. */
let _bootRestoreFailedAt = 0;
const RESTORE_RETRY_MS = 30_000;
const RESTORE_TIMEOUT_MS = 8_000;

const deviceFields = () => ({
  deviceId: getWebDeviceId(),
  deviceName: getWebDeviceName(),
  deviceOs: 'web',
  // La « machine » du web est le navigateur (0091) — voir adoptWebDeviceId.
  machineId: getWebDeviceId(),
});

/**
 * Restaure la session via le refresh-cookie HttpOnly (survit au rechargement
 * de l'onglet).
 *
 * Bornée dans le temps — la custody des clés l'attend avant chaque décision,
 * et un réseau qui pend ne doit pas geler le déverrouillage — et RETENTÉE après
 * un échec (pas plus d'une fois par demi-minute) : un échec transitoire au
 * chargement laissait sinon l'onglet « local » jusqu'au prochain rechargement.
 */
export async function restoreSessionOnce(): Promise<void> {
  if (_bootRestore) return _bootRestore;
  if (getAccessToken() || _user) return;
  if (Date.now() - _bootRestoreFailedAt < RESTORE_RETRY_MS) return;
  const attempt = (async () => {
    // LA SESSION SUIT LE PROFIL. Sans indice, le refresh sert le cookie legacy
    // — « le dernier connecté dans ce navigateur », qui peut être un AUTRE
    // compte (constaté le 2026-09-01 : profil matlion47, session noreply,
    // coffres invisibles pour toute la session d'onglet). L'estampille du
    // profil actif nomme donc le compte à restaurer ; le Worker choisit alors
    // le cookie de CE compte, ou refuse — jamais celui d'un autre.
    const hint = await activeProfileStampUserId();
    if (!(await refreshViaCookie(hint))) throw new Error('refresh refusé ou injoignable');
    const me = await apiFetch<{ data?: { user?: UserDTO } }>('/auth/me', {
      signal: AbortSignal.timeout(RESTORE_TIMEOUT_MS),
    });
    const user = me.body?.data?.user;
    if (me.status !== 200 || !user) throw new Error(`auth/me: HTTP ${me.status}`);
    _user = user;
    await stampActiveProfile(user, 'refresh');
  })();
  const deadline = new Promise<void>((_, reject) =>
    setTimeout(
      () => reject(new Error('restauration de session : délai dépassé')),
      RESTORE_TIMEOUT_MS
    )
  );
  _bootRestore = Promise.race([attempt, deadline]).then(
    () => undefined,
    () => {
      _bootRestoreFailedAt = Date.now();
      _bootRestore = null;
    }
  );
  return _bootRestore;
}

/**
 * LE ROYAUME EN ATTENTE — « + Ajouter un compte » sur le web.
 *
 * Sur le bureau, `authService.beginPendingSession` détache le profil courant le
 * temps de la démarche : la session qu'on ouvre ne doit pas être estampillée ni
 * clé-installée chez le DERNIER profil activé, celui d'un autre compte. Le web
 * n'avait pas cette zone (les canaux étaient desktop-only) : la session étant
 * celle du navigateur, `auth:login` estampillait le profil resté actif au nom
 * du compte qu'on ajoutait, et la clé de ce compte s'installait dessus — le
 * même incident que celui qu'on ferme, pris par l'autre bout.
 *
 * Tant que la zone est ouverte : aucune estampille (`stampActiveProfile` sort),
 * la clé s'installe sous le COMPTE de la session et pas sous le profil
 * (custodyHandlers.wrappedKeyScope), aucun cycle de sync ne part
 * (syncScheduler.profileMatchesSession). L'ADOPTION la referme : le profil
 * qu'on active ou qu'on crée pendant la démarche prend l'estampille
 * (profileHandlers). L'ABANDON la referme aussi, et révoque la session si une
 * connexion a eu lieu entre-temps — on ne laisse pas le navigateur connecté à
 * un compte que la personne vient de renoncer à ajouter.
 */
let _pendingRealm: { loginHappened: boolean } | null = null;

export function isPendingRealmOpen(): boolean {
  return _pendingRealm !== null;
}

/** Appelé par l'adoption (profile:activate / profile:create pendant la démarche). */
export function closePendingRealm(): void {
  _pendingRealm = null;
}

/**
 * Abandon de la démarche depuis l'activation d'un profil qui ne PEUT PAS
 * l'adopter (rattaché à un autre compte) — miroir de electron/main.ts:3110 :
 * la zone se referme et la session ouverte pendant la démarche est révoquée.
 */
export async function discardPendingRealm(): Promise<void> {
  const realm = _pendingRealm;
  _pendingRealm = null;
  // La zone n'a rien scellé (storeFEK y est un no-op) : le scellé du profil
  // resté actif appartient à SA session, pas à celle qu'on révoque.
  if (realm?.loginHappened) await logoutSession({ keepSeal: true });
}

/**
 * Ferme la session du navigateur, et le DIT à l'écran.
 *
 * Le web n'émettait jamais `auth-status-changed` : Redux n'était hydraté qu'au
 * montage (`auth:getStatus`), si bien qu'une déconnexion décidée ici — refus de
 * rattachement, abandon d'une démarche — laissait l'en-tête « connecté » et les
 * cycles échouer sans un mot.
 */
async function logoutSession(opts: { keepSeal?: boolean } = {}): Promise<void> {
  // Best-effort côté serveur : révoque le refresh-cookie (le Worker accepte
  // le cookie comme porteur du token à révoquer pour les origines navigateur).
  await apiFetch('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
  setAccessToken(null);
  _user = null;
  _pendingMfaToken = null;
  _pendingRealm = null; // une démarche ouverte n'a plus de session à adopter
  _bootRestore = null;
  _bootRestoreFailedAt = Date.now(); // pas de restauration immédiate par-dessus une déconnexion voulue
  // L'ESTAMPILLE RESTE. Le bureau la retire à la déconnexion parce que là-bas
  // « se déconnecter » détache le profil (mode local). Sur le web, elle est
  // aussi ce qui ROUTE la clé du profil (custodyHandlers.wrappedKeyScope) :
  // la retirer rendait le cache du compte inatteignable au prochain
  // déverrouillage hors ligne, et laissait la place au blob hérité — d'un
  // autre compte, peut-être. Le profil appartient toujours au compte ; seule
  // la session est fermée, et c'est `state.auth.accountMode` qui le dit.
  // La session « Rester déverrouillé » meurt avec la session compte.
  if (!opts.keepSeal) {
    try {
      const { storeDelete } = await import('../webStore');
      await storeDelete('fek_session');
    } catch {
      /* pas de profil actif : rien à effacer */
    }
  }
  emitWebEvent('auth-status-changed', {
    isAuthenticated: false,
    user: null,
    accountMode: 'local',
  });
}

/**
 * L'adresse à laquelle le profil actif est rattaché, d'après son estampille.
 * Lue directement dans le manifeste : le module des profils n'est importé que
 * paresseusement (il importe celui-ci).
 */
export async function activeProfileStamp(): Promise<string | null> {
  const pid = await getActiveProfileId();
  if (!pid) return null;
  const manifest = await idbGet<{
    profiles?: Array<{ id: string; cloudAccount?: { email?: string } | null }>;
  }>('profiles_manifest');
  const email = manifest?.profiles?.find((p) => p.id === pid)?.cloudAccount?.email;
  return email ? email.trim().toLowerCase() : null;
}

/**
 * Ce qu'une CONNEXION EXPLICITE fait du profil actif — décidé AVANT d'appeler
 * le serveur, parce que l'issue peut être un refus.
 *
 *  - pas de profil actif (premier lancement, ou navigateur vierge) : la
 *    connexion ouvre un royaume implicite — le profil créé ou ouvert ensuite
 *    adoptera le compte ; rien d'autre ne sera estampillé entre-temps ;
 *  - profil rattaché à un AUTRE compte : refus. Le bureau rebaptise (sa session
 *    vit dans le profil) ; sur le web la session est celle du navigateur et la
 *    clé de ce profil est celle de son compte — se connecter « dedans » avec un
 *    autre compte pousserait sa clé chez ce compte-là. Le chemin pour un second
 *    compte est « + Ajouter un compte » (royaume en attente).
 */
type RefusalCode =
  | 'profile_bound_to_other_account'
  | 'profile_key_conflict'
  | 'profile_key_check_failed';

type LoginPolicy =
  | { kind: 'bind' }
  | { kind: 'implicit-realm' }
  /**
   * LA CONNEXION RÉUSSIT, MAIS LE PROFIL NE SE RATTACHE PAS TOUT SEUL.
   *
   * Réservé au cas où le rattachement ferait ADOPTER au compte la clé du
   * profil. Ce n'est pas un refus — la connexion est parfaitement légitime —
   * mais le rattachement, lui, change le propriétaire d'une clé de chiffrement
   * et doit être demandé explicitement, avec la preuve qu'on connaît le mot de
   * passe qui l'ouvre. Voir `profiles:attachToAccount`.
   */
  | { kind: 'bind-needs-proof' }
  | { kind: 'refuse'; code: RefusalCode; email: string };

async function loginPolicyForActiveProfile(email: string): Promise<LoginPolicy> {
  if (_pendingRealm) return { kind: 'bind' };
  const pid = await getActiveProfileId();
  if (!pid) return { kind: 'implicit-realm' };
  const stamp = await activeProfileStamp();
  if (stamp && stamp !== email.trim().toLowerCase()) {
    return { kind: 'refuse', code: 'profile_bound_to_other_account', email: stamp };
  }
  if (!stamp) {
    // Un profil qui détient SA clé ne se rattache pas à un compte qui en a déjà
    // une AUTRE : deux clés sous un compte, c'est l'incident à l'envers.
    const { canBindOwnKeyProfile } = await import('./custodyHandlers');
    const verdict = await canBindOwnKeyProfile(pid, email);
    if (verdict === 'conflict') return { kind: 'refuse', code: 'profile_key_conflict', email };
    // Impossible de comparer (réseau) : on ne rattache pas à l'aveugle — un
    // rattachement, ça ne se défait pas, et la clé partirait au premier repli.
    if (verdict === 'unknown') return { kind: 'refuse', code: 'profile_key_check_failed', email };
    /**
     * ⚠ LE COMPTE ADOPTERAIT LA CLÉ DE CE PROFIL. On ne le fait pas ici.
     *
     * Le mot de passe de coffre de ce profil deviendrait celui qui déverrouille
     * le compte entier, sur tous ses appareils — et celui du compte n'y
     * donnerait aucun accès. Quand ce mot de passe a été choisi pour un profil
     * qu'on croyait jetable, c'est une perte de données différée.
     *
     * La connexion réussit ; le rattachement devient un geste à part, qui exige
     * la preuve qu'on sait ouvrir cette clé.
     */
    if (verdict === 'adopts-own-key') return { kind: 'bind-needs-proof' };
  }
  return { kind: 'bind' };
}

const REFUSAL_TEXT: Record<RefusalCode, string> = {
  profile_bound_to_other_account:
    'This profile is linked to another account. Use “Add an account” from the profile picker to sign in with a different account.',
  profile_key_conflict:
    'This profile has its own vault key and this account already has a different one. Create a new profile for this account, or migrate this profile from the desktop app.',
  profile_key_check_failed:
    'The account key could not be verified (network). Check the connection and try again.',
};
const REFUSAL_KEY: Record<RefusalCode, string> = {
  profile_bound_to_other_account: 'settings.profileBoundToOtherAccount',
  profile_key_conflict: 'settings.profileKeyConflict',
  profile_key_check_failed: 'settings.profileKeyCheckFailed',
};

/**
 * Un refus de rattachement. La session qui vient de s'ouvrir n'a pas de profil
 * à qui appartenir : elle est révoquée — SAUF si c'est celle qu'on avait déjà
 * (même compte que la session d'avant) : la refuser ne change rien à l'état du
 * navigateur, et la révoquer casserait une session qui, elle, était légitime.
 */
async function refuseLogin(
  policy: Extract<LoginPolicy, { kind: 'refuse' }>,
  previous: UserDTO | null,
  loggedIn: UserDTO
): Promise<{ success: false; error: string; code: string }> {
  let error = REFUSAL_TEXT[policy.code];
  try {
    const { default: i18n } = await import('../../../i18n/config');
    error = i18n.t(REFUSAL_KEY[policy.code], error, { email: policy.email });
  } catch {
    /* catalogue indisponible : phrase de repli */
  }
  const sameAsBefore =
    !!previous && previous.email.trim().toLowerCase() === loggedIn.email.trim().toLowerCase();
  if (sameAsBefore) {
    _user = previous;
  } else {
    // Le refus ne change rien au profil affiché : son scellé « Rester
    // déverrouillé » lui appartient et reste.
    await logoutSession({ keepSeal: true });
  }
  return { success: false, error, code: policy.code };
}

/**
 * Le profil ACTIF porte le compte de la session — miroir de
 * `authService.saveUserCache → profileManager.setCloudAccount` du bureau.
 *
 * Sans cette estampille, chaque étiquette de l'interface lisait « Local » sur
 * un profil pourtant connecté (prod, 2026-08-28).
 *
 * MAIS la session web est celle du NAVIGATEUR, pas du profil ; l'estampille ne
 * suit donc pas aveuglément :
 *  - jamais pendant le royaume en attente (le profil actif est un spectateur) ;
 *  - jamais par-dessus l'estampille d'un AUTRE compte (profileHandlers refuse) ;
 *  - un profil SANS estampille n'est rattaché que par une connexion EXPLICITE
 *    (`mode = 'login'`) — pas par la restauration de session au chargement ni
 *    par un `getMe` de routine, qui ne prouvent rien sur le profil affiché.
 *
 * Import paresseux : le module des profils importe celui-ci (getSessionUser) ;
 * l'inverse resterait circulaire.
 */
/**
 * PRÉVENIR L'ÉCRAN, MAINTENANT. Redux n'est hydraté qu'au montage
 * (`auth:getStatus`) et à chaque `auth-status-changed` — que le web
 * n'émettait qu'à la DÉCONNEXION. Une connexion qui venait d'estampiller le
 * profil laissait donc `profileAttachedTo: null` à l'écran : les réglages
 * affichaient « Profil non rattaché » et proposaient de rattacher un profil
 * qui l'était déjà, jusqu'à ce qu'on quitte le profil et qu'on y revienne.
 * Même forme que `auth:getStatus`, pour qu'un seul réducteur lise les deux.
 */
export async function emitAuthStatus(): Promise<void> {
  emitWebEvent('auth-status-changed', {
    isAuthenticated: _user !== null,
    user: _user,
    accountMode: _user ? 'cloud' : 'local',
    profileAttachedTo: await activeProfileStamp(),
  });
}

async function stampActiveProfile(user: UserDTO, mode: 'login' | 'refresh'): Promise<void> {
  if (_pendingRealm) return;
  try {
    const pid = await getActiveProfileId();
    if (!pid) return;
    const { cloudAccountStampFrom, stampProfileCloudAccount } = await import('./profileHandlers');
    await stampProfileCloudAccount(pid, cloudAccountStampFrom(user), {
      bindUnstamped: mode === 'login',
    });
  } catch {
    /* le manifeste des profils est indisponible : l'étiquette attendra la prochaine authentification */
  }
}

/** Une connexion réussie pendant la démarche : l'abandon devra la révoquer. */
function noteLoginInRealm(): void {
  if (_pendingRealm) _pendingRealm.loginHappened = true;
}

/**
 * Le compte de la session, tel que ce module le connaît déjà.
 *
 * Exposé pour que la restauration des profils puisse ESTAMPILLER ce qu'elle
 * ramène : sans `cloudAccount`, un profil restauré atterrit sous « Local » au
 * lieu de l'en-tête portant l'adresse du compte, et la personne le retrouve
 * exactement là où elle ne le cherche pas.
 */
export function getSessionUser(): UserDTO | null {
  return _user;
}

// Chaque refresh de cet onglet nomme SON compte — voir webApiBase : sans
// indice, le cookie legacy servi est celui du dernier connecté du NAVIGATEUR,
// qu'un autre onglet a pu changer.
registerSessionAccountHintProvider(() => _user?.id ?? null);

/** L'`userId` de l'estampille du profil actif — l'indice de restauration au boot. */
async function activeProfileStampUserId(): Promise<string | undefined> {
  try {
    const pid = await getActiveProfileId();
    if (!pid) return undefined;
    const { getProfileCloudStamp } = await import('./profileHandlers');
    return (await getProfileCloudStamp(pid))?.userId ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * ADOPTER LA SESSION DU COMPTE D'UN PROFIL — le miroir web du « une session
 * par profil » du bureau, rendu possible par les cookies par-compte du Worker.
 *
 * Appelé à l'activation d'un profil estampillé pour un AUTRE compte que la
 * session courante : si ce navigateur détient encore le cookie de CE compte,
 * on re-frappe un jeton pour lui et la session bascule. Sans cookie (jamais
 * connecté ici, ou révoqué), on rend false et l'état existant dit le geste
 * (« connectez-vous au compte de ce profil »). L'indice n'est jamais un
 * credential : le Worker ne sert que le cookie HttpOnly correspondant.
 */
export async function adoptSessionForStamp(stamp: {
  email: string;
  userId?: string;
}): Promise<boolean> {
  if (_pendingRealm) return false;
  // Estampille d'avant le champ `userId` : pas d'indice fiable — on ne bascule
  // pas au legacy (il désigne « le dernier connecté », pas ce compte-ci).
  if (!stamp.userId) return false;
  if (!(await refreshViaCookie(stamp.userId))) return false;
  const me = await apiFetch<{ data?: { user?: UserDTO } }>('/auth/me');
  const user = me.body?.data?.user;
  if (me.status !== 200 || !user) return false;
  if (user.email.trim().toLowerCase() !== stamp.email.trim().toLowerCase()) return false;
  _user = user;
  return true;
}

/**
 * Relaie une route du Worker et rend son enveloppe telle quelle.
 *
 * Un corps non-JSON (502 de passerelle, réponse vide) devient un échec LISIBLE
 * plutôt qu'un `null` que l'appelant déréférencerait : le renderer lit
 * `result.success` / `result.error` sans autre garde.
 */
async function relay(
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<{ success: boolean; error?: string; [k: string]: unknown }> {
  const res = await apiFetch<{ error?: string }>(path, init);
  if (res.body && typeof res.body === 'object' && typeof res.body.success === 'boolean') {
    return res.body as { success: boolean; error?: string };
  }
  return { success: false, error: `HTTP ${res.status}` };
}

export const authHandlers: Record<string, (...args: unknown[]) => unknown> = {
  'auth:getStatus': async () => {
    await restoreSessionOnce();
    /**
     * ⚠ DEUX FAITS DISTINCTS, ET L'ECRAN N'EN LISAIT QU'UN.
     *
     * `accountMode` ne dit que « une session est ouverte dans ce navigateur ».
     * Sur le web, cette session revient toute seule : le cookie de
     * rafraichissement est pose pour le domaine, donc arriver depuis
     * filarr.com suffit a rouvrir la session sur app.filarr.com.
     *
     * Le PROFIL, lui, n'est rattache que par une connexion EXPLICITE
     * (`stampActiveProfile`, mode 'login'). Un profil local ouvert pendant
     * qu'une session traine n'appartient donc a personne -- et c'est voulu :
     * une session qui passe ne doit pas s'approprier les donnees locales.
     *
     * Les deux se contredisaient a l'ecran : les parametres affichaient
     * l'adresse du compte et « Synchronisation : activee », pendant que le
     * moteur refusait chaque cycle avec « ce profil n'est rattache a aucun
     * compte ». Le seul retour etait une bulle rouge nommant une notion que
     * l'ecran n'avait jamais montree.
     */
    return {
      isAuthenticated: _user !== null,
      user: _user,
      accountMode: _user ? 'cloud' : 'local',
      profileAttachedTo: await activeProfileStamp(),
    };
  },

  /**
   * LE JETON QUE TOUT LE RENDERER LIT (apiClient axios, billet de salle collab).
   *
   * `restoreSessionOnce` ne couvre que l'onglet qui n'a AUCUN jeton ; elle sort
   * aussitôt dès qu'il y en a un, même mort depuis une heure. C'est par ici que
   * partait le jeton périmé qui faisait boucler `/collab/token` et `/vaults/heads`
   * sur un 401 définitif — aucun de ces deux appelants ne sait renouveler
   * (l'intercepteur d'apiClient est conditionné à un refresh porteur, que le web
   * n'a pas : il vit dans le cookie HttpOnly). `ensureAccessToken` re-frappe.
   */
  'auth:getAccessToken': async () => {
    await restoreSessionOnce();
    return ensureAccessToken();
  },

  'auth:login': async (email: unknown, password: unknown, revokeDeviceId?: unknown) => {
    const res = await apiFetch<{
      code?: string;
      data?: {
        accessToken?: string;
        refreshToken?: string;
        user?: UserDTO;
        requires2FA?: boolean;
        mfaEnrollmentRequired?: boolean;
        mfaToken?: string;
        deviceId?: string;
        /** Le refus « trop d'appareils » : le plafond et les sessions à choisir. */
        cap?: number;
        sessions?: unknown[];
      };
    }>('/auth/login', {
      method: 'POST',
      auth: false,
      body: {
        email,
        password,
        ...deviceFields(),
        // L'appareil que l'utilisateur accepte de déconnecter, choisi à l'écran
        // du refus précédent — même issue de secours que le bureau
        // (authService.login). Le mot de passe est renvoyé et revérifié.
        ...(typeof revokeDeviceId === 'string' && revokeDeviceId ? { revokeDeviceId } : {}),
      },
    });

    const data = res.body?.data;
    if (!res.body?.success || !data) {
      /**
       * UN REFUS QUI PROPOSE N'EST PAS UNE PANNE. Le serveur joint le plafond
       * et la liste des sessions ; les jeter ici transformait un choix offert
       * en « Login failed » — et quelqu'un de parfaitement à jour partait
       * réinitialiser un mot de passe correct.
       */
      if (res.body?.code === 'device_limit_reached') {
        return {
          success: false,
          error: res.body.error || 'Too many active devices',
          code: res.body.code,
          data: { cap: data?.cap, sessions: data?.sessions },
        };
      }
      return { success: false, error: res.body?.error || 'Login failed' };
    }
    if (data.requires2FA && data.mfaToken) {
      _pendingMfaToken = data.mfaToken;
      if (data.mfaEnrollmentRequired) return { success: true, mfaEnrollmentRequired: true };
      return { success: true, requires2FA: true };
    }
    if (!data.accessToken || !data.user) {
      return { success: false, error: 'Unexpected server response' };
    }
    const previous = _user;
    setAccessToken(data.accessToken);
    adoptWebDeviceId(data.deviceId);
    _user = data.user;
    const policy = await loginPolicyForActiveProfile(data.user.email);
    if (policy.kind === 'refuse') return refuseLogin(policy, previous, data.user);
    if (policy.kind === 'implicit-realm') _pendingRealm = { loginHappened: true };
    noteLoginInRealm();
    // `bind-needs-proof` : la session s'ouvre, le profil reste local. L'écran
    // des paramètres le dit, et propose le rattachement.
    if (policy.kind !== 'bind-needs-proof') await stampActiveProfile(data.user, 'login');
    // Estampillé ou non, l'écran doit le savoir de la même source que le montage.
    await emitAuthStatus();
    return {
      success: true,
      user: data.user,
      profileNeedsAttachProof: policy.kind === 'bind-needs-proof',
    };
  },

  'auth:completeMFALogin': async (
    code: unknown,
    rememberDevice: unknown = false,
    revokeDeviceId?: unknown
  ) => {
    if (!_pendingMfaToken) {
      return { success: false, error: 'No pending 2FA challenge — log in again' };
    }
    const res = await apiFetch<{
      code?: string;
      data?: {
        accessToken?: string;
        user?: UserDTO;
        deviceId?: string;
        cap?: number;
        sessions?: unknown[];
      };
    }>('/auth/2fa/login', {
      method: 'POST',
      auth: false,
      body: {
        mfaToken: _pendingMfaToken,
        code,
        rememberDevice: Boolean(rememberDevice),
        ...deviceFields(),
        // L'issue de secours du plafond d'appareils, sur CE chemin aussi : sans
        // elle, un compte à double facteur au plafond restait dehors.
        ...(typeof revokeDeviceId === 'string' && revokeDeviceId ? { revokeDeviceId } : {}),
      },
    });
    const data = res.body?.data;
    if (!res.body?.success || !data?.accessToken || !data.user) {
      // Le refus « trop d'appareils » propose, il ne bloque pas. Le jeton MFA
      // n'a pas été consommé : la reprise rejoue le code avec l'appareil choisi.
      if (res.body?.code === 'device_limit_reached') {
        return {
          success: false,
          error: res.body.error || 'Too many active devices',
          code: res.body.code,
          data: { cap: data?.cap, sessions: data?.sessions },
        };
      }
      // Même politique que le desktop : le mfaToken survit à un mauvais code,
      // il ne meurt que si le serveur rejette le token lui-même.
      if (res.body?.error?.toLowerCase().includes('mfa token')) _pendingMfaToken = null;
      return { success: false, error: res.body?.error || '2FA verification failed' };
    }
    _pendingMfaToken = null;
    const previous = _user;
    setAccessToken(data.accessToken);
    adoptWebDeviceId(data.deviceId);
    _user = data.user;
    const policy = await loginPolicyForActiveProfile(data.user.email);
    if (policy.kind === 'refuse') return refuseLogin(policy, previous, data.user);
    if (policy.kind === 'implicit-realm') _pendingRealm = { loginHappened: true };
    noteLoginInRealm();
    await stampActiveProfile(data.user, 'login');
    await emitAuthStatus();
    return { success: true, user: data.user };
  },

  // ── Royaume en attente (« + Ajouter un compte ») ─────────────────────────
  // Mêmes canaux et mêmes enveloppes que electron/main.ts:3733-3770.
  'auth:beginPendingSession': async () => {
    _pendingRealm = { loginHappened: false };
    return { success: true };
  },

  'auth:discardPendingSession': async () => {
    // La session ouverte pendant la démarche est celle du compte qu'on renonce
    // à ajouter : elle ne survit pas à l'abandon (parité bureau, où la zone est
    // révoquée côté serveur puis effacée).
    await discardPendingRealm();
    return { success: true };
  },

  'auth:pendingSessionStatus': async () => ({
    pending: _pendingRealm !== null,
    account:
      _pendingRealm && _user
        ? { email: _user.email, tier: _user.subscriptionTier, accountType: _user.accountType }
        : null,
  }),

  'auth:cancelMFALogin': () => {
    _pendingMfaToken = null;
  },

  'auth:register': async (email: unknown, password: unknown, accountType: unknown = 'personal') => {
    const res = await apiFetch<{
      data?: { user?: UserDTO; recoveryCodes?: string[] };
    }>('/auth/register', {
      method: 'POST',
      auth: false,
      body: { email, password, accountType, ...deviceFields() },
    });
    const data = res.body?.data;
    if (!res.body?.success || !data?.user) {
      return { success: false, error: res.body?.error || 'Registration failed' };
    }
    return { success: true, user: data.user, recoveryCodes: data.recoveryCodes };
  },

  // Statut 2FA (Settings + pre-checks) : relais direct de GET /auth/2fa/status.
  'auth:get2FAStatus': async () => {
    const res = await apiFetch<{ data?: Record<string, unknown> }>('/auth/2fa/status');
    if (res.status === 200 && res.body?.success && res.body.data) {
      return { success: true, data: res.body.data };
    }
    return { success: false, error: res.body?.error || `HTTP ${res.status}` };
  },

  // ── Gestion du compte : relais directs des routes du Worker ───────────────
  //
  // Ces canaux étaient CLASSÉS (api/M1) mais pas SERVIS : sur app.filarr.com,
  // ouvrir « Activer la 2FA », « Appareils connectés » ou « Régénérer » faisait
  // lever le dispatcher — spinner figé et rejet non géré (balayage du
  // 2026-08-28). Le renderer attend exactement l'enveloppe du serveur
  // (`{ success, data?, error? }`, cf. src/services/auth/authApi.ts) : on la
  // rend telle quelle, comme `auth:get2FAStatus` ci-dessus. Aucune crypto ici —
  // la 2FA, les appareils et la phrase de récupération sont des faits de compte,
  // pas de coffre ; le rescellement local de la FEK sous la nouvelle phrase reste
  // au renderer (`applyRecoveryPhrase`), sur les canaux hybrid:* déjà portés.
  'auth:setup2FA': async () => relay('/auth/2fa/setup', { method: 'POST', body: {} }),

  'auth:verifySetup2FA': async (code: unknown) =>
    relay('/auth/2fa/verify-setup', { method: 'POST', body: { code } }),

  'auth:disable2FA': async (password: unknown, code: unknown) =>
    relay('/auth/2fa/disable', { method: 'POST', body: { password, code } }),

  'auth:regenerateBackupCodes': async (password: unknown, code: unknown) =>
    relay('/auth/2fa/backup-codes/regenerate', { method: 'POST', body: { password, code } }),

  'auth:regenerateRecoveryPhrase': async (password: unknown, code?: unknown) =>
    relay('/account/recovery-phrase/regenerate', {
      method: 'POST',
      body: code === undefined ? { password } : { password, code },
    }),

  'auth:getDevices': async () => {
    const res = (await relay('/account/devices')) as {
      success?: boolean;
      data?: Record<string, unknown>;
    };
    // Le bureau joint son `.device_id` a la reponse ; le web ne le faisait pas,
    // donc l'ecran ne savait pas quel navigateur etait « cet appareil » — et
    // proposait de le revoquer lui-meme.
    if (res?.success && res.data && typeof res.data === 'object')
      res.data.currentDeviceId = getWebDeviceId();
    return res;
  },

  'auth:revokeDormantDevices': async () =>
    relay('/account/devices/revoke-dormant', {
      method: 'POST',
      body: { exceptDeviceId: getWebDeviceId() },
    }),

  'auth:deleteDevice': async (deviceId: unknown) =>
    relay(`/account/devices/${encodeURIComponent(String(deviceId ?? ''))}`, {
      method: 'DELETE',
    }),

  // Le mot de passe du compte suit celui du coffre : Settings rescelle la FEK
  // localement puis appelle ce canal. Sans lui, sur le web, la FEK changeait de
  // mot de passe mais pas le compte — un écart silencieux (« non-fatal » côté
  // appelant) qui se payait à la connexion suivante.
  'auth:changePassword': async (currentPassword: unknown, newPassword: unknown) =>
    relay('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),

  'auth:getMe': async () => {
    const res = await apiFetch<{ data?: { user?: UserDTO } }>('/auth/me');
    const user = res.body?.data?.user;
    if (res.status !== 200 || !user) {
      return { success: false, error: res.body?.error || 'not authenticated' };
    }
    _user = user;
    await stampActiveProfile(user, 'refresh');
    return { success: true, user };
  },

  'auth:logout': async () => logoutSession(),
};
