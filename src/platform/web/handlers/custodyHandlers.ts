/**
 * Handlers web des canaux de custody de clés (famille 'crypto', palier M1).
 *
 * Politique W2 (baseline honnête, QW-04 tranchée) :
 *  - le wrapped_fek (chiffré sous la KEK mot de passe) EST persisté — c'est le
 *    même blob que wrapped_fek.json sur le disque desktop, inutilisable sans
 *    le mot de passe ; IndexedDB convient ;
 *  - la FEK BRUTE n'est persistée que sous « Rester déverrouillé » (opt-in),
 *    scellée sous une KEK de session non-extractible ;
 *  - sync:setSessionKey/clearSessionKey : le point d'accroche du démon de sync.
 *
 * Les moitiés cloud (push/fetch du wrapped key) parlent aux endpoints existants
 * GET/PUT /account/wrapped-key du Worker, mêmes formes que electron/main.ts:2750-2807.
 *
 * ── LA CLÉ SUIT LE PROFIL, PAS LA SESSION DU NAVIGATEUR ─────────────────────
 *
 * LE DÉFAUT QUE CECI FERME (constaté en prod le 2026-08-28). `wrapped_fek`
 * était UNE clé IndexedDB globale, partagée par tous les profils et tous les
 * comptes du navigateur, jamais effacée, et lue AVANT la copie nuage
 * (`initHybridCrypto` est local-d'abord). Un second compte de test, ou un profil
 * local web, laissait son blob derrière lui ; à la connexion suivante, avec le
 * même mot de passe, le compte adoptait EN SILENCE une FEK étrangère : ses
 * manifestes bureau levaient `OperationError`, étaient ignorés « pour la
 * session », et tout restait « Local » sans un mot.
 *
 * Sur le bureau, un profil est un domaine : sa clé vit dans son dossier et sa
 * session aussi. Sur le web la session est celle du NAVIGATEUR ; la clé, elle,
 * doit rester celle du PROFIL. D'où la résolution de portée (`wrappedKeyScope`) :
 *
 *   1. le profil actif détient SA PROPRE clé (`wrapped_fek:p:<id>`) → elle
 *      gagne, sans consulter le serveur — et son estampille reste sa frontière :
 *      rien ne part vers un autre compte que le sien ;
 *   2. le profil actif est ESTAMPILLÉ d'un compte → la clé de ce compte
 *      (`wrapped_fek:acct:<adresse>`), et la copie serveur fait autorité
 *      SEULEMENT si la session ouverte est celle de ce compte ; sans session
 *      pour ce compte et sans cache, on LÈVE — jamais la clé d'un autre ;
 *   3. profil sans estampille ni clé propre, AVEC du contenu, et une session :
 *      c'est le profil d'avant l'estampille — si le compte le LISTE parmi ses
 *      profils synchronisés, sa clé est celle du compte ; sinon c'est un profil
 *      local, qui garde sa portée (le blob hérité y est LU, jamais copié) ;
 *      sans contenu, un profil sans estampille est un profil neuf : sa portée ;
 *   4. pas de profil actif — ou un « royaume en attente » ouvert (« + Ajouter
 *      un compte », voir authHandlers) : la session, sinon la clé héritée.
 *
 * Le blob hérité n'est JAMAIS adopté par un compte qui possède déjà des données
 * synchronisées. Réseau indisponible : le cache du compte, sinon on LÈVE —
 * rendre `null` ferait générer une FEK neuve à `initHybridCrypto`, c'est-à-dire
 * fourcher le coffre. Un compte VIDE (aucun profil synchronisé) reçoit une clé
 * neuve, ou la clé propre du profil local qu'on lui rattache — et un profil qui
 * a SA clé ne se rattache pas à un compte qui en a déjà une autre
 * (`canBindOwnKeyProfile`) : deux clés pour un compte, c'est l'incident à
 * l'envers.
 */

import { apiFetch } from '../webApiBase';
import { idbDelete, idbGet, idbKeys, idbPut } from '../idb';
import { getActiveProfileId, storeDelete, storeGet, storePut } from '../webStore';
import { resetUnreadableProfiles, restoreAccountProfiles } from '../sync/readSync';

const LEGACY_WRAPPED_KEY = 'wrapped_fek';
const FEK_SESSION_KEY = 'fek_session';
const FEK_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 jours (comme le site)
/**
 * Version du scellé « Rester déverrouillé ». Un scellé d'avant la portée par
 * compte peut contenir la FEK étrangère de l'incident : il est ignoré (un mot
 * de passe à ressaisir, une fois) plutôt que restauré les yeux fermés.
 */
const FEK_SESSION_VERSION = 2;
export const STAY_UNLOCKED_FLAG = 'filarr-web-stay-unlocked';
/** Délai maximal des consultations serveur : un réseau qui pend ne bloque pas le déverrouillage. */
const CLOUD_TIMEOUT_MS = 8_000;
/** Mémo des réponses serveur : les sondes de l'écran de verrouillage ne redemandent pas en rafale. */
const CLOUD_MEMO_TTL_MS = 10_000;

/**
 * « La clé de ce profil n'est pas disponible ici » — pas « mauvais mot de
 * passe ». L'écran de verrouillage distingue les deux grâce au `code`.
 */
export class WrappedKeyUnavailableError extends Error {
  readonly code = 'wrapped_key_unavailable';

  constructor(message: string) {
    super(message);
    this.name = 'WrappedKeyUnavailableError';
  }
}

function isStayUnlockedEnabled(): boolean {
  try {
    return localStorage.getItem(STAY_UNLOCKED_FLAG) === '1';
  } catch {
    return false;
  }
}

interface CloudWrappedKey {
  wrappedFek: string;
  kekSalt: string;
  version: number;
  recoveryWrappedFek?: string;
  recoverySalt?: string;
}

/** Le blob tel que le renderer le manipule : la partie nuage + des enveloppes locales. */
type WrappedKeyBlob = CloudWrappedKey & Record<string, unknown>;

const norm = (email: string) => email.trim().toLowerCase();
const accountKey = (email: string) => `wrapped_fek:acct:${norm(email)}`;
const profileKey = (pid: string) => `wrapped_fek:p:${pid}`;
/** Une écriture locale pas encore acceptée par le serveur : le local reste l'autorité. */
const pendingPushKey = (key: string) => `${key}:pending-push`;

interface KeyScope {
  key: string;
  kind: 'account' | 'profile' | 'legacy';
  /** Vrai quand la copie serveur de CE compte est joignable et fait autorité. */
  online: boolean;
  /** Le compte auquel cette clé appartient (estampille ou session), s'il y en a un. */
  email?: string;
  pid: string | null;
  /** L'adresse de la session ouverte, s'il y en a une. */
  sessionEmail: string | null;
}

/** L'adresse du compte auquel un profil est rattaché, d'après son estampille. */
async function stampedEmailOf(profileId: string): Promise<string | null> {
  const manifest = await idbGet<{
    profiles?: Array<{ id: string; cloudAccount?: { email?: string } | null }>;
  }>('profiles_manifest');
  const email = manifest?.profiles?.find((x) => x.id === profileId)?.cloudAccount?.email;
  return email ? norm(email) : null;
}

/**
 * Le profil a-t-il quelque chose à ouvrir avec une clé ? Seul le matériel
 * CHIFFRÉ compte : la liste des dossiers est du JSON en clair qu'un profil neuf
 * écrit avant même d'avoir une clé — la compter ferait prendre un résidu
 * hérité pour la clé d'un profil qui n'en a pas encore.
 */
async function profileHasContent(pid: string): Promise<boolean> {
  const prefix = `p:${pid}:`;
  const keys = await idbKeys();
  return keys.some(
    (k) =>
      k === `${prefix}notes_enc` || k.startsWith(`${prefix}file:`) || k.startsWith(`${prefix}blob:`)
  );
}

/**
 * Le profil actif est-il RATTACHÉ au compte de la session ? Sans profil actif
 * (onboarding, royaume en attente), la session parle pour elle-même. Un profil
 * SANS estampille n'appartient à personne : sa clé ne quitte pas le navigateur
 * et n'en reçoit aucune — même avec un cookie qui traîne.
 */
const boundToSession = (scope: KeyScope): boolean =>
  scope.pid === null || (scope.email !== undefined && scope.email === scope.sessionEmail);

/** Le profil actif est-il rattaché à un AUTRE compte que la session ? */
const boundElsewhere = (scope: KeyScope): boolean =>
  scope.pid !== null && scope.email !== undefined && scope.email !== scope.sessionEmail;

const _cloudMemo = new Map<string, { at: number; value: CloudWrappedKey | null }>();
/** La dernière copie serveur vue par compte : sert à savoir si une sauvegarde locale la devance. */
const _lastServer = new Map<string, CloudWrappedKey>();
const _listingMemo = new Map<string, { at: number; ids: Set<string> }>();

/**
 * La copie du compte sur le serveur : `null` SEULEMENT sur un 404 (le compte
 * n'a pas de clé) ; tout autre échec LÈVE, pour que l'appelant ne confonde
 * jamais « pas de clé » et « pas de réseau ».
 */
async function fetchCloudWrappedKey(email: string): Promise<CloudWrappedKey | null> {
  const memo = _cloudMemo.get(email);
  if (memo && Date.now() - memo.at < CLOUD_MEMO_TTL_MS) return memo.value;
  const res = await apiFetch<{ data?: CloudWrappedKey }>('/account/wrapped-key', {
    signal: AbortSignal.timeout(CLOUD_TIMEOUT_MS),
  });
  let value: CloudWrappedKey | null;
  if (res.status === 200 && res.body?.success && res.body.data) value = res.body.data;
  else if (res.status === 404) value = null;
  else throw new Error(`wrapped-key: HTTP ${res.status}`);
  _cloudMemo.set(email, { at: Date.now(), value });
  if (value) _lastServer.set(email, value);
  return value;
}

/**
 * Les profils que le compte connecté a déjà synchronisés (manifestVersion > 0).
 * C'est ce qui distingue « compte neuf » de « compte d'avant la copie serveur »,
 * et « profil d'avant l'estampille » de « profil local ». Un échec LÈVE.
 */
async function syncedProfileIds(email: string): Promise<Set<string>> {
  const memo = _listingMemo.get(email);
  if (memo && Date.now() - memo.at < CLOUD_MEMO_TTL_MS) return memo.ids;
  const res = await apiFetch<{
    data?: { profiles?: Array<{ profileId: string; manifestVersion: number }> };
  }>('/sync/profiles', { signal: AbortSignal.timeout(CLOUD_TIMEOUT_MS) });
  if (res.status !== 200 || !res.body?.success)
    throw new Error(`sync/profiles: HTTP ${res.status}`);
  const ids = new Set(
    (res.body.data?.profiles ?? []).filter((p) => p.manifestVersion > 0).map((p) => p.profileId)
  );
  _listingMemo.set(email, { at: Date.now(), ids });
  return ids;
}

async function wrappedKeyScope(): Promise<KeyScope> {
  const auth = await import('./authHandlers');
  // La session se restaure au premier appel (cookie) : décider AVANT qu'elle
  // n'ait atterri cimenterait le blob hérité dans la portée du profil.
  await auth.restoreSessionOnce().catch(() => undefined);
  const session = auth.getSessionUser()?.email;
  const sessionEmail = session ? norm(session) : null;
  // « + Ajouter un compte » : le profil resté actif n'est qu'un spectateur, la
  // clé qui s'installe est celle du compte qu'on ajoute.
  const pid = auth.isPendingRealmOpen() ? null : await getActiveProfileId();

  if (pid) {
    const stamped = await stampedEmailOf(pid);
    if (await idbGet(profileKey(pid))) {
      return {
        key: profileKey(pid),
        kind: 'profile',
        online: false,
        email: stamped ?? undefined,
        pid,
        sessionEmail,
      };
    }
    if (stamped) {
      return {
        key: accountKey(stamped),
        kind: 'account',
        online: sessionEmail === stamped,
        email: stamped,
        pid,
        sessionEmail,
      };
    }
    if (sessionEmail && (await profileHasContent(pid))) {
      // Le profil d'avant l'estampille — ou un profil local qu'un cookie
      // traînant ne doit pas rattacher. Le compte tranche : listé parmi ses
      // profils synchronisés, sa clé est celle du compte.
      let listed: boolean;
      try {
        listed = (await syncedProfileIds(sessionEmail)).has(pid);
      } catch (err) {
        // Liste injoignable : on ne DEVINE pas à qui est ce profil — ni la clé
        // du compte (qui ouvrirait un profil local sous une clé étrangère), ni
        // le résidu hérité. L'écran de verrouillage le dit, et retentera.
        throw new WrappedKeyUnavailableError(
          `Impossible de vérifier à quel compte appartient ce profil (${(err as Error).message}). Vérifiez la connexion et réessayez.`
        );
      }
      if (listed) {
        return {
          key: accountKey(sessionEmail),
          kind: 'account',
          online: true,
          email: sessionEmail,
          pid,
          sessionEmail,
        };
      }
    }
    return { key: profileKey(pid), kind: 'profile', online: false, pid, sessionEmail };
  }
  if (sessionEmail) {
    return {
      key: accountKey(sessionEmail),
      kind: 'account',
      online: true,
      email: sessionEmail,
      pid: null,
      sessionEmail,
    };
  }
  return { key: LEGACY_WRAPPED_KEY, kind: 'legacy', online: false, pid: null, sessionEmail };
}

/** Les champs qui voyagent : c'est sur eux que deux blobs se comparent. */
function sameCloudPart(a: CloudWrappedKey, b: CloudWrappedKey): boolean {
  return (
    a.wrappedFek === b.wrappedFek &&
    a.kekSalt === b.kekSalt &&
    (a.recoveryWrappedFek ?? null) === (b.recoveryWrappedFek ?? null) &&
    (a.recoverySalt ?? null) === (b.recoverySalt ?? null)
  );
}

/**
 * Un profil qui détient SA clé peut-il se rattacher à ce compte, et à quel prix ?
 *
 * ── QUATRE ISSUES, ET LA TROISIÈME EST CELLE QU'ON A FAILLI MANQUER ────────
 *
 *   · `no-own-key`  — le profil n'a pas de clé propre : rien à confronter, il
 *     prendra celle du compte.
 *   · `same-key`    — c'est déjà la même. Rien ne change de main.
 *   · `adopts-own-key` — LE COMPTE N'A AUCUNE CLÉ, et il adoptera celle du
 *     profil au premier repli 'initial'.
 *   · `conflict`    — le compte enveloppe une AUTRE clé. Refus : deux clés sous
 *     un compte, c'est l'incident à l'envers.
 *
 * ── POURQUOI LA TROISIÈME MÉRITE SON PROPRE NOM ────────────────────────────
 *
 * Techniquement elle est valide, et c'était le seul comportement raisonnable.
 * Humainement, elle est la plus dangereuse des quatre : le mot de passe de
 * coffre choisi pour un profil qu'on croyait jetable — souvent tapé au hasard —
 * devient CELUI QUI DÉVERROUILLE TOUT LE COMPTE, sur tous les appareils. Le
 * mot de passe du compte, lui, n'y donne aucun accès : il enveloppe la paire de
 * clés d'identité, pas la FEK.
 *
 * On l'apprenait le jour où l'on change d'appareil, c'est-à-dire trop tard.
 * Elle est donc nommée pour que l'appelant puisse EXIGER une preuve avant que
 * la clé ne change de propriétaire — au seul moment où se tromper est encore
 * sans conséquence, puisque les données sont encore uniquement locales.
 */
export type BindVerdict = 'no-own-key' | 'same-key' | 'adopts-own-key' | 'conflict' | 'unknown';

export async function canBindOwnKeyProfile(pid: string, email: string): Promise<BindVerdict> {
  const own = await idbGet<CloudWrappedKey>(profileKey(pid));
  if (!own) return 'no-own-key';
  try {
    const cloud = await fetchCloudWrappedKey(norm(email));
    if (!cloud) return 'adopts-own-key';
    return sameCloudPart(own, cloud) ? 'same-key' : 'conflict';
  } catch {
    return 'unknown';
  }
}

/**
 * RATTACHER LE PROFIL ACTIF AU COMPTE DE LA SESSION — avec la preuve.
 *
 * ── POURQUOI CE GESTE EST À PART ────────────────────────────────────────────
 *
 * Rattacher un profil qui détient sa clé à un compte qui n'en a aucune fait
 * ADOPTER cette clé par le compte. Le mot de passe de coffre du profil devient
 * alors celui qui déverrouille le compte entier, sur tous ses appareils — et
 * celui du compte n'y donne aucun accès, puisqu'il n'enveloppe que la paire de
 * clés d'identité.
 *
 * Quand ce mot de passe a été choisi pour un profil qu'on croyait jetable,
 * c'est une perte de données différée : on l'apprend en changeant d'appareil.
 *
 * ── « LE COFFRE EST OUVERT » NE PROUVE RIEN ─────────────────────────────────
 *
 * Le coffre peut être déverrouillé par un gestionnaire de mots de passe qui a
 * rempli le champ, ou par le scellé « Rester déverrouillé » qui dure quatorze
 * jours. Dans les deux cas la personne peut ne PAS connaître son mot de passe.
 *
 * On exige donc de le retaper — au seul moment où se tromper est encore
 * gratuit, puisque les données sont encore uniquement locales et récupérables.
 * Et on offre d'en changer dans le même geste : c'est la seule occasion où la
 * question se pose naturellement.
 */
export async function attachActiveProfileToAccount(
  currentPassword: string,
  newPassword?: string
): Promise<{ ok: true } | { ok: false; code: 'wrong-password' | 'no-session' | 'no-profile' }> {
  const pid = await getActiveProfileId();
  if (!pid) return { ok: false, code: 'no-profile' };

  const { getSessionUser, activeProfileStamp, emitAuthStatus } = await import('./authHandlers');
  const user = getSessionUser();
  if (!user?.email) return { ok: false, code: 'no-session' };

  // DÉJÀ RATTACHÉ À CE COMPTE : rien à prouver, rien à réécrire. L'écran a pu
  // proposer le rattachement sur un état périmé (voir emitAuthStatus) ; on lui
  // rend la vérité au lieu de faire échouer un geste qui n'avait plus d'objet.
  if ((await activeProfileStamp()) === user.email.trim().toLowerCase()) {
    await emitAuthStatus();
    return { ok: true };
  }

  const crypto = await import('../../../services/auth/hybridCrypto');

  // 1. LA PREUVE. Un mot de passe qui n'ouvre pas la clé arrête tout ici —
  //    avant que quoi que ce soit ne change de propriétaire.
  let match: 'real' | 'decoy' | null = null;
  try {
    match = await crypto.tryUnlockDualVault(currentPassword);
  } catch {
    return { ok: false, code: 'wrong-password' };
  }
  /**
   * ⚠ LE MOT DE PASSE DE CONTRAINTE NE RATTACHE PAS.
   *
   * `decoy` ouvre le coffre LEURRE. Accepter ce mot de passe ici publierait la
   * clé du leurre comme clé du compte : la vraie deviendrait inaccessible, et
   * la fonction de contrainte se retournerait contre son propriétaire. On le
   * traite comme un mot de passe qui n'ouvre pas — c'est exactement ce qu'il
   * doit paraître à qui regarde.
   */
  if (match !== 'real') return { ok: false, code: 'wrong-password' };

  // 2. LE CHANGEMENT, s'il est demandé. AVANT l'estampille : si le
  //    rescellement échoue, rien n'a été rattaché et l'état reste celui d'avant.
  if (newPassword) {
    const rewrapped = await crypto.rewrapFEK(currentPassword, newPassword);
    await custodyHandlers['hybrid:saveWrappedKey'](rewrapped);
  }

  // 3. L'ESTAMPILLE. En dernier : c'est elle qui autorise la clé à partir.
  const { cloudAccountStampFrom, stampProfileCloudAccount } = await import('./profileHandlers');
  await stampProfileCloudAccount(pid, cloudAccountStampFrom(user), { bindUnstamped: true });
  // L'état vient de changer : l'écran l'apprend d'ici, pas d'une relecture qu'il
  // pourrait oublier.
  await emitAuthStatus();
  return { ok: true };
}

export const custodyHandlers: Record<string, (...args: unknown[]) => unknown> = {
  'profiles:attachToAccount': async (currentPassword: unknown, newPassword: unknown) =>
    attachActiveProfileToAccount(
      String(currentPassword ?? ''),
      newPassword ? String(newPassword) : undefined
    ),

  'hybrid:saveWrappedKey': async (wrappedKeyData: unknown) => {
    const scope = await wrappedKeyScope();
    if (scope.sessionEmail && boundElsewhere(scope)) {
      // Le profil actif appartient à un autre compte que la session : rien de
      // ce que cette session produit n'a à s'écrire sous sa clé.
      throw new WrappedKeyUnavailableError(
        `Ce profil est rattaché à ${scope.email} : connectez-vous avec ce compte pour modifier sa clé.`
      );
    }
    const before = await idbGet<WrappedKeyBlob>(scope.key);
    await idbPut(scope.key, wrappedKeyData);
    if (scope.kind === 'account' && scope.email) {
      // Une sauvegarde qui DEVANCE le serveur (rescellement sous un nouveau mot
      // de passe, phrase de récupération) reste l'autorité locale jusqu'à ce
      // que la remontée soit acceptée : « le serveur gagne » ne doit pas la
      // défaire au prochain chargement. Référence : la dernière copie serveur
      // vue, sinon ce qu'on avait en cache (une enveloppe locale ajoutée à
      // partie nuage égale ne devance rien).
      const base = _lastServer.get(scope.email) ?? before;
      const data = wrappedKeyData as CloudWrappedKey;
      const ahead = !base || !sameCloudPart(data, base);
      if (ahead) await idbPut(pendingPushKey(scope.key), true);
      _cloudMemo.delete(scope.email);
    }
  },

  'hybrid:loadWrappedKey': async () => {
    const scope = await wrappedKeyScope();
    const cached = await idbGet<WrappedKeyBlob>(scope.key);

    if (scope.kind === 'account' && scope.online && scope.email) {
      let cloud: CloudWrappedKey | null;
      try {
        cloud = await fetchCloudWrappedKey(scope.email);
      } catch (err) {
        // Réseau ou serveur indisponible : le cache du compte, sinon on LÈVE.
        if (cached) return cached;
        throw new WrappedKeyUnavailableError(
          `La clé de ce compte n’a pas pu être récupérée (${(err as Error).message}). Vérifiez la connexion et réessayez.`
        );
      }
      if (cached && (await idbGet(pendingPushKey(scope.key)))) {
        // Le local devance le serveur — sauf si le serveur a fini par
        // l'accepter (ou si rien ne diffère) : alors le drapeau est levé.
        if (cloud && sameCloudPart(cloud, cached)) {
          await idbDelete(pendingPushKey(scope.key)).catch(() => undefined);
        } else {
          return cached;
        }
      }
      if (!cloud) {
        // 404 définitif : ce compte n'a pas (encore) de clé côté serveur.
        if (cached) return cached;
        let synced: boolean;
        try {
          synced = (await syncedProfileIds(scope.email)).size > 0;
        } catch (err) {
          throw new WrappedKeyUnavailableError(
            `L’état du compte n’a pas pu être vérifié (${(err as Error).message}). Vérifiez la connexion et réessayez.`
          );
        }
        if (synced) {
          // Des données existent, chiffrées par une clé que le serveur n'a
          // jamais reçue (compte d'avant la copie serveur) : on ne fabrique
          // pas une clé neuve par-dessus, et on n'adopte pas un blob non
          // attribué. C'est l'application de bureau qui publiera la sienne.
          throw new WrappedKeyUnavailableError(
            'Ce compte possède déjà des données chiffrées mais n’a pas encore publié sa clé. Ouvrez-le une fois depuis l’application de bureau à jour, puis réessayez ici.'
          );
        }
        // Compte VIDE. Un profil local avec du contenu qu'on rattache à ce
        // compte lui apporte SA clé (le repli 'initial' de initHybridCrypto la
        // publie) ; sinon, une clé neuve.
        if (scope.pid && (await profileHasContent(scope.pid))) {
          const legacy = await idbGet<WrappedKeyBlob>(LEGACY_WRAPPED_KEY);
          if (legacy) return legacy;
        }
        return null;
      }
      // La copie du serveur fait autorité sur la partie nuage ; les enveloppes
      // LOCALES (clé matérielle, leurre, clé d'appareil) enveloppent la même
      // FEK — elle ne tourne jamais, seul son emballage change — et restent.
      const merged: WrappedKeyBlob = cached ? { ...cached, ...cloud } : { ...cloud };
      if (!cached || !sameCloudPart(cached, cloud)) await idbPut(scope.key, merged);
      // Le résidu hérité n'est JAMAIS effacé ici : un profil sans compte qui
      // l'ouvrait encore en lecture (contenu d'avant la portée par compte) le
      // perdrait. Il ne part qu'avec « tout effacer ».
      return merged;
    }

    if (cached) return cached;
    if (scope.kind === 'account') {
      // Un profil rattaché à un compte dont la session n'est pas ouverte, et
      // sans copie en cache : rien ne permet d'ouvrir ce profil ici — et
      // surtout pas la clé d'un autre compte, ni une clé neuve.
      throw new WrappedKeyUnavailableError(
        `Ce profil est rattaché à ${scope.email}. Connectez-vous avec ce compte pour récupérer sa clé.`
      );
    }
    if (scope.kind === 'profile' && scope.pid) {
      const hasContent = await profileHasContent(scope.pid);
      if (!hasContent) return null; // profil neuf : il recevra sa propre clé
      // Profil sans compte : le blob hérité du navigateur est LU pour ouvrir
      // le contenu qu'il a — sans être copié sous sa portée. Il ne devient
      // « sa » clé qu'une fois écrit par un geste sur ce profil (rescellement,
      // rattachement à un compte vide) ; d'ici là, un compte qui s'ouvre avec
      // une copie serveur différente l'emporte.
      const legacy = await idbGet<WrappedKeyBlob>(LEGACY_WRAPPED_KEY);
      if (legacy) return legacy;
      // Du contenu chiffré et AUCUNE clé ici (ouvert un jour avec la clé d'un
      // compte dont la session est fermée) : on le dit, on n'en fabrique pas une
      // neuve par-dessus.
      throw new WrappedKeyUnavailableError(
        'Ce profil contient des données chiffrées mais aucune clé n’est disponible sur cet appareil. Connectez-vous au compte qui l’a ouvert.'
      );
    }
    return idbGet<WrappedKeyBlob>(LEGACY_WRAPPED_KEY);
  },

  'hybrid:pushWrappedKeyToCloud': async (wrappedKeyData: unknown) => {
    const scope = await wrappedKeyScope();
    // Défense en profondeur : une clé ne part vers un compte que depuis un
    // contexte qui lui appartient — la session de ce compte, sur un profil
    // RATTACHÉ à ce compte, ou hors de tout profil pendant son ajout. Un profil
    // sans estampille (local) ne publie jamais sa clé, cookie ou pas.
    if (!scope.sessionEmail || !boundToSession(scope)) {
      return {
        success: false,
        error: boundElsewhere(scope)
          ? 'Ce profil est rattaché à un autre compte que la session ouverte'
          : 'Ce profil n’est rattaché à aucun compte : sa clé reste sur cet appareil',
      };
    }
    const res = await apiFetch('/account/wrapped-key', {
      method: 'PUT',
      body: wrappedKeyData,
    });
    // Même contrat que le main : on relaie {success,...} tel quel, l'appelant
    // (pushWrappedKeyToCloud, best-effort) gère le 409 du compare-and-set.
    const body = (res.body ?? { success: false, error: `HTTP ${res.status}` }) as {
      success?: boolean;
      error?: string;
      code?: string;
    };
    const key = accountKey(scope.sessionEmail);
    const initial =
      (wrappedKeyData as { expectedPreviousDigest?: string } | null)?.expectedPreviousDigest ===
      'initial';
    if (body.success) {
      await idbDelete(pendingPushKey(key)).catch(() => undefined);
      _lastServer.set(scope.sessionEmail, wrappedKeyData as CloudWrappedKey);
      _cloudMemo.delete(scope.sessionEmail);
      if (scope.kind === 'profile' && scope.pid) {
        // La clé propre du profil vient d'être publiée sous le compte : c'est
        // désormais la clé DU COMPTE. Elle migre sous sa portée — sinon chaque
        // `initHybridCrypto` suivant la republierait comme « initiale » et
        // recevrait un 409 pour une clé pourtant déjà en place.
        const own = await idbGet<WrappedKeyBlob>(profileKey(scope.pid));
        if (own) {
          await idbPut(key, own);
          await idbDelete(profileKey(scope.pid)).catch(() => undefined);
        }
      } else if (!(await idbGet(key))) {
        // Un compte qui vient d'être amorcé garde toujours sa copie hors ligne.
        const { expectedPreviousDigest: _d, ...portable } = wrappedKeyData as Record<
          string,
          unknown
        >;
        await idbPut(key, portable);
      }
    } else if (res.status === 409 && initial && scope.kind === 'account') {
      // Un AUTRE appareil a posé la clé du compte pendant qu'on fabriquait la
      // nôtre (course de premier appareil, ou 404 mémorisé dix secondes) : la
      // clé neuve ne vaut rien. On oublie tout ce qu'elle a laissé — cache,
      // drapeau, clé en mémoire, démon — pour que le prochain déverrouillage
      // reparte de la copie du serveur. (Portée COMPTE seulement : la clé
      // propre d'un profil rattaché, elle, est légitime — un 409 dit juste
      // que le compte en a déjà une, et c'est `canBindOwnKeyProfile` qui a
      // garanti que c'est la même.)
      await idbDelete(key).catch(() => undefined);
      await idbDelete(pendingPushKey(key)).catch(() => undefined);
      _cloudMemo.delete(scope.sessionEmail);
      try {
        const { clearHybridCrypto } = await import('../../../services/auth/hybridCrypto');
        clearHybridCrypto();
        const { stopSyncScheduler } = await import('../sync/syncScheduler');
        stopSyncScheduler();
      } catch {
        /* au pire, le prochain chargement repart proprement */
      }
      return {
        success: false,
        code: 'seeded_elsewhere',
        error:
          'La clé de ce compte vient d’être posée par un autre appareil : déverrouillez à nouveau avec votre mot de passe.',
      };
    }
    return body;
  },

  // `null` = 404 définitif seulement ; un échec réseau LÈVE (le renderer, en
  // face, l'avale en `null` — mais `loadWrappedKey` ci-dessus a déjà refusé de
  // rendre `null` dans ce cas, donc `initHybridCrypto` ne génère rien à tort).
  // Et la copie n'est celle du compte de la session que si le profil actif est
  // le sien : un profil d'un autre compte ne se laisse pas amorcer avec.
  'hybrid:fetchWrappedKeyFromCloud': async () => {
    const scope = await wrappedKeyScope();
    if (!scope.sessionEmail || !boundToSession(scope)) return null;
    // Un profil RATTACHÉ dont la clé propre vit encore sous sa portée voit lui
    // aussi la copie du compte : le repli de `initHybridCrypto` y lit « déjà
    // publiée » et n'insiste pas avec une clé « initiale ».
    if (scope.kind === 'profile') return fetchCloudWrappedKey(scope.sessionEmail);
    if (scope.kind !== 'account' || !scope.online || !scope.email) return null;
    return fetchCloudWrappedKey(scope.email);
  },

  // ── FEK au repos : « Rester déverrouillé » opt-in (QW-04 tranchée) ──────
  // Décision fondateur 2026-08-13 : opt-in, TTL 14 jours — le compromis
  // Bitwarden-style déjà employé par le site (vault-session.ts). La FEK n'est
  // JAMAIS en clair dans IndexedDB : elle est scellée sous une KEK de session
  // AES-GCM NON-EXTRACTIBLE générée par le navigateur (une CryptoKey
  // non-extractible se structured-clone dans IndexedDB mais ses octets sont
  // inaccessibles au JS — un vol du fichier de base ne donne rien ; seul du
  // code s'exécutant dans l'origine pendant la validité peut déverrouiller).
  // Sans opt-in : no-op — mot de passe à chaque session (baseline).
  //
  // Le scellé porte la PORTÉE de la clé qu'il enferme : un scellé posé sous un
  // profil pour la clé d'un compte n'est relu que si ce profil route toujours
  // vers cette clé (pas après un rattachement, ni pendant « + Ajouter un
  // compte », où il n'y a pas encore de profil à qui l'attribuer).
  'hybrid:storeFEK': async (rawBytesArg: unknown) => {
    if (!isStayUnlockedEnabled()) return;
    const auth = await import('./authHandlers');
    if (auth.isPendingRealmOpen()) return;
    const raw =
      rawBytesArg instanceof Uint8Array
        ? rawBytesArg
        : new Uint8Array((rawBytesArg as number[]) ?? []);
    if (raw.byteLength === 0) return;
    const scope = await wrappedKeyScope();
    const kek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      kek,
      raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
    );
    await storePut(FEK_SESSION_KEY, {
      v: FEK_SESSION_VERSION,
      scope: scope.key,
      kek,
      iv,
      wrapped: new Uint8Array(wrapped),
      expiresAt: new Date(Date.now() + FEK_SESSION_TTL_MS).toISOString(),
    });
  },

  'hybrid:loadFEK': async () => {
    if (!isStayUnlockedEnabled()) return null;
    const session = await storeGet<{
      v?: number;
      scope?: string;
      kek: CryptoKey;
      iv: Uint8Array;
      wrapped: Uint8Array;
      expiresAt: string;
    }>(FEK_SESSION_KEY);
    if (!session) return null;
    if (session.v !== FEK_SESSION_VERSION || new Date(session.expiresAt).getTime() < Date.now()) {
      await storeDelete(FEK_SESSION_KEY).catch(() => {});
      return null;
    }
    const scope = await wrappedKeyScope().catch(() => null);
    if (!scope || session.scope !== scope.key) {
      await storeDelete(FEK_SESSION_KEY).catch(() => {});
      return null;
    }
    try {
      const raw = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: session.iv as unknown as BufferSource },
        session.kek,
        session.wrapped.buffer.slice(
          session.wrapped.byteOffset,
          session.wrapped.byteOffset + session.wrapped.byteLength
        ) as ArrayBuffer
      );
      // Contrat du canal : tableau d'octets (hybridCrypto.ts:856 attend number[])
      return Array.from(new Uint8Array(raw));
    } catch {
      await storeDelete(FEK_SESSION_KEY).catch(() => {});
      return null;
    }
  },

  'hybrid:hasKey': async () => {
    if (!isStayUnlockedEnabled()) return false;
    const session = await storeGet<{ v?: number; scope?: string; expiresAt: string }>(
      FEK_SESSION_KEY
    );
    if (!session || session.v !== FEK_SESSION_VERSION) return false;
    if (new Date(session.expiresAt).getTime() < Date.now()) return false;
    const scope = await wrappedKeyScope().catch(() => null);
    return !!scope && session.scope === scope.key;
  },

  'hybrid:clearFEK': async () => {
    await storeDelete(FEK_SESSION_KEY).catch(() => {});
  },

  // ── Session FEK handover : pas de second process sur web ────────────────
  // Appelé par hybridCrypto à CHAQUE installation de la FEK (unlock, login,
  // restauration) — point d'accroche du DÉMON de sync web : cycle immédiat,
  // puis périodique 5 min + debounce 10 s après modification (syncScheduler).
  'sync:setSessionKey': async () => {
    // Une NOUVELLE clé en session : les profils déclarés illisibles avec la
    // précédente méritent un nouvel essai — sinon la bonne clé arrivait et
    // les profils restaient « ignorés pour la session ».
    resetUnreadableProfiles();
    // Et les profils du compte reviennent TOUT DE SUITE, indépendamment du
    // cycle du profil actif — dont le propre manifeste peut être illisible
    // (poussé sous la mauvaise clé pendant l'incident) et bloquer la suite.
    // Avant le premier cycle : c'est cette passe qui estampille le profil
    // d'avant l'estampille, sans quoi le cycle le tiendrait pour « sans compte ».
    try {
      const auth = await import('./authHandlers');
      // La clé peut s'installer AVANT que la session du cookie n'ait atterri
      // (« Rester déverrouillé » + profil unique choisi d'office).
      await auth.restoreSessionOnce().catch(() => undefined);
      if (auth.getSessionUser()) await restoreAccountProfiles();
    } catch (err) {
      console.warn('[webSync] restauration des profils à l’installation de la clé :', err);
    }
    try {
      const { startSyncScheduler } = await import('../sync/syncScheduler');
      startSyncScheduler();
    } catch {
      /* best effort — le pull manuel (sync:triggerSync) reste disponible */
    }
  },
  'sync:clearSessionKey': async () => {
    // La FEK quitte la session (lock, changement de profil) : plus de cycles.
    try {
      const { stopSyncScheduler } = await import('../sync/syncScheduler');
      stopSyncScheduler();
    } catch {
      /* rien à arrêter */
    }
  },
};
