/**
 * Handlers web des canaux profile:* — le miroir navigateur de
 * electron/profileManager.ts, manifeste en IndexedDB au lieu de profiles.json.
 *
 * Mêmes règles que le desktop : nom ≤ 50 caractères, PIN 4-6 chiffres haché
 * PBKDF2-SHA-256 600k/32 o (format hex identique — indispensable pour la
 * synchro de PIN inter-appareils du manifeste cloud), premier profil = défaut,
 * plafond 10 profils. Les répertoires disque n'ont pas d'équivalent : le
 * contenu web vit côté cloud (M2) puis en cache OPFS (M3).
 */

import type { UserDTO } from '../../../types/auth';
import { idbDelete, idbGet, idbKeys, idbPut } from '../idb';
import { purgeProfileScope } from '../webStore';
import { emitWebEvent } from '../webEventBus';
import {
  closePendingRealm,
  discardPendingRealm,
  getSessionUser,
  isPendingRealmOpen,
} from './authHandlers';

const MANIFEST_KEY = 'profiles_manifest';
const MAX_PROFILES = 10;
const PIN_ITERATIONS = 600_000;
const PIN_KEY_LENGTH = 32; // bytes

/**
 * LE COMPTE AUQUEL UN PROFIL EST RATTACHÉ — même forme que le bureau
 * (electron/profileManager.ts `cloudAccount`). C'est CE champ que lisent toutes
 * les étiquettes « Local » / « <adresse> » (ProfilePicker, Header, ProfileCard,
 * VaultPasswordLock), jamais `state.auth.accountMode` — et c'est lui qui ROUTE
 * la clé de coffre du profil (custodyHandlers.wrappedKeyScope).
 *
 * LE DÉFAUT QUE CECI FERME (prod, 2026-08-28). Le web ne posait JAMAIS cette
 * estampille sur un profil existant : `auth:login` ne touchait pas au manifeste,
 * `profile:create` n'avait pas le champ, et la restauration sautait les profils
 * déjà connus avant d'estampiller. Connecté, avec `auth:getMe` qui répondait,
 * « tous les comptes restaient en local ».
 */
export interface CloudAccountStamp {
  email: string;
  tier: string;
  /** ISO — dernière authentification réussie. */
  linkedAt: string;
  accountType?: 'personal' | 'enterprise';
  /**
   * L'identifiant du compte — l'INDICE que le refresh multi-comptes donne au
   * Worker pour choisir le cookie de CE compte (cookies par-compte, 09/2026).
   * Absent des estampilles d'avant ce champ : `refreshSameAccountStamp` le
   * remplit au premier passage d'une session du même compte.
   */
  userId?: string;
}

export function cloudAccountStampFrom(user: UserDTO): CloudAccountStamp {
  return {
    email: user.email,
    tier: user.subscriptionTier,
    linkedAt: new Date().toISOString(),
    accountType: user.accountType,
    userId: user.id,
  };
}

/** L'estampille d'UN profil, pour la restauration de session (authHandlers). */
export async function getProfileCloudStamp(profileId: string): Promise<CloudAccountStamp | null> {
  const manifest = await loadManifest();
  return manifest.profiles.find((p) => p.id === profileId)?.cloudAccount ?? null;
}

const sameEmail = (a: string | undefined | null, b: string): boolean =>
  !!a && a.trim().toLowerCase() === b.trim().toLowerCase();

interface ProfileMetadata {
  id: string;
  name: string;
  avatarColor: string;
  avatarEmoji?: string;
  avatarImage?: string;
  pinHash?: string;
  pinSalt?: string;
  pinAttempts: number;
  pinLockedUntil?: number;
  allowPinReset?: boolean;
  pinUpdatedAt?: string;
  createdAt: string;
  lastAccessedAt: string;
  isDefault: boolean;
  order: number;
  cloudAccount?: CloudAccountStamp | null;
}

interface ProfilesManifest {
  version: 1;
  activeProfileId: string | null;
  profiles: ProfileMetadata[];
  maxProfiles: number;
  migratedFromLegacy: boolean;
}

const hex = (buf: ArrayBuffer | Uint8Array): string =>
  Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const hexToBytes = (h: string): Uint8Array =>
  new Uint8Array((h.match(/../g) ?? []).map((b) => parseInt(b, 16)));

async function hashPin(pin: string, saltHex: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: hexToBytes(saltHex) as unknown as BufferSource,
      iterations: PIN_ITERATIONS,
      hash: 'SHA-256',
    },
    key,
    PIN_KEY_LENGTH * 8
  );
  return hex(bits);
}

async function loadManifest(): Promise<ProfilesManifest> {
  const existing = await idbGet<ProfilesManifest>(MANIFEST_KEY);
  if (existing) return existing;
  const fresh: ProfilesManifest = {
    version: 1,
    activeProfileId: null,
    profiles: [],
    maxProfiles: MAX_PROFILES,
    migratedFromLegacy: true,
  };
  await idbPut(MANIFEST_KEY, fresh);
  return fresh;
}

async function saveManifest(manifest: ProfilesManifest): Promise<void> {
  await idbPut(MANIFEST_KEY, manifest);
  emitWebEvent('profiles-updated');
}

/**
 * UN SEUL ÉCRIVAIN À LA FOIS sur le manifeste des profils.
 *
 * Chaque mutation est un lire-modifier-écrire sur IndexedDB ; deux en vol se
 * marchent dessus (le dernier écrit gagne, l'autre est perdu). Le cas réel :
 * au chargement, la restauration de session estampille le profil actif pendant
 * que le sélecteur active un profil — l'activation pouvait disparaître. Les
 * mutations s'enchaînent donc ici, dans l'ordre d'arrivée — TOUTES, y compris
 * celles qui passent un demi-seconde dans PBKDF2 (PIN) ou dans une purge.
 */
let _manifestChain: Promise<unknown> = Promise.resolve();
export function withManifestLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = _manifestChain.then(fn, fn);
  _manifestChain = run.catch(() => undefined);
  return run;
}

/**
 * Pose l'estampille de compte sur un profil — miroir de
 * `profileManager.setCloudAccount`, appelé par la session web.
 *
 * JAMAIS par-dessus l'estampille d'un AUTRE compte : la session web est celle
 * du navigateur, et le profil affiché n'est pas forcément le sien. Un profil
 * SANS estampille n'est rattaché que si l'appelant l'affirme (`bindUnstamped`,
 * réservé à une connexion explicite ou à une adoption) ; sinon on ne fait que
 * rafraîchir l'offre et le type de compte d'un profil déjà rattaché.
 *
 * N'écrit que si quelque chose change : un `auth:getMe` de routine ne doit pas
 * réveiller l'écran des profils.
 */
export async function stampProfileCloudAccount(
  profileId: string,
  account: CloudAccountStamp,
  opts: { bindUnstamped?: boolean } = {}
): Promise<boolean> {
  return withManifestLock(async () => {
    const manifest = await loadManifest();
    const profile = manifest.profiles.find((p) => p.id === profileId);
    if (!profile) return false;
    const current = profile.cloudAccount ?? null;
    if (current && !sameEmail(current.email, account.email)) return false;
    if (!current && !opts.bindUnstamped) return false;
    const unchanged =
      !!current && current.tier === account.tier && current.accountType === account.accountType;
    if (unchanged) return false;
    profile.cloudAccount = account;
    await saveManifest(manifest);
    return true;
  });
}

/** Rafraîchit l'estampille d'un profil déjà rattaché au MÊME compte (offre, type). */
function refreshSameAccountStamp(profile: ProfileMetadata, user: UserDTO): void {
  if (!profile.cloudAccount || !sameEmail(profile.cloudAccount.email, user.email)) return;
  const stamp = cloudAccountStampFrom(user);
  if (
    profile.cloudAccount.tier !== stamp.tier ||
    profile.cloudAccount.accountType !== stamp.accountType ||
    // Backfill : les estampilles d'avant `userId` le gagnent au premier passage
    // — c'est lui qui permet à la session de suivre le profil (multi-comptes).
    profile.cloudAccount.userId !== stamp.userId
  ) {
    profile.cloudAccount = stamp;
  }
}

/**
 * L'ADOPTION du royaume en attente, à l'activation d'un profil.
 *
 * Pendant « + Ajouter un compte » (ou après une connexion faite sans profil
 * actif), le profil qu'on ouvre prend l'estampille de la session et la démarche
 * se referme. S'il appartient à un AUTRE compte, c'est un abandon : la zone se
 * referme aussi, et la session ouverte pendant la démarche est révoquée
 * (electron/main.ts:3110) — sinon elle resterait ouverte pour toute la page,
 * et chaque déverrouillage prendrait la clé du compte qu'on n'a pas retenu.
 *
 * Hors démarche, ouvrir un profil ne prouve rien : un profil sans estampille
 * reste tel quel (seule une connexion explicite dans le profil le rattache), et
 * un profil déjà rattaché garde le sien.
 */
async function adoptOnActivate(profile: ProfileMetadata): Promise<void> {
  const user = getSessionUser();
  if (!isPendingRealmOpen()) {
    if (user) refreshSameAccountStamp(profile, user);
    return;
  }
  if (!user) {
    // Démarche ouverte sans connexion (parcours local en mode ajout) : rien à adopter.
    closePendingRealm();
    return;
  }
  if (profile.cloudAccount && !sameEmail(profile.cloudAccount.email, user.email)) {
    await discardPendingRealm();
    return;
  }
  // Un profil qui détient SA clé ne se rattache pas à un compte qui en a déjà
  // une AUTRE : ce serait faire vivre deux clés sous le compte (custodyHandlers).
  const { canBindOwnKeyProfile } = await import('./custodyHandlers');
  const verdict = await canBindOwnKeyProfile(profile.id, user.email);
  if (verdict === 'conflict') {
    console.warn(
      `[profiles] ${profile.id} possède sa propre clé et ${user.email} en a une autre : non rattaché`
    );
    await discardPendingRealm();
    return;
  }
  if (verdict === 'unknown') {
    // Réseau : on ne rattache pas à l'aveugle, et on laisse la démarche ouverte
    // — la personne peut réessayer ou choisir un autre profil.
    console.warn(
      `[profiles] clé du compte ${user.email} invérifiable : ${profile.id} non rattaché`
    );
    return;
  }
  profile.cloudAccount = cloudAccountStampFrom(user);
  closePendingRealm();
}

export const profileHandlers: Record<string, (...args: unknown[]) => unknown> = {
  'profile:getManifest': async () => loadManifest(),

  'profile:create': async (params: unknown) => {
    const { name, avatarColor, pin, allowPinReset } = (params ?? {}) as {
      name: string;
      avatarColor: string;
      pin?: string;
      allowPinReset?: boolean;
    };
    if (name.length > 50) throw new Error('Profile name too long (max 50 characters)');

    let pinHash: string | undefined;
    let pinSalt: string | undefined;
    if (pin) {
      if (!/^\d{4,6}$/.test(pin)) throw new Error('PIN must be 4-6 digits');
      pinSalt = hex(crypto.getRandomValues(new Uint8Array(16)));
      pinHash = await hashPin(pin, pinSalt);
    }

    return withManifestLock(async () => {
      const manifest = await loadManifest();
      if (manifest.profiles.length >= manifest.maxProfiles) {
        throw new Error(`Profile limit reached (${manifest.maxProfiles})`);
      }
      const now = new Date().toISOString();
      const profile: ProfileMetadata = {
        id: crypto.randomUUID(),
        name: name.trim(),
        avatarColor,
        pinHash,
        pinSalt,
        pinAttempts: 0,
        allowPinReset: pin ? (allowPinReset ?? false) : undefined,
        pinUpdatedAt: pin ? now : undefined,
        createdAt: now,
        lastAccessedAt: now,
        isDefault: manifest.profiles.length === 0,
        order: manifest.profiles.length,
      };
      // Né PENDANT une démarche de connexion (onboarding nuage, « + Ajouter un
      // compte ») : c'est lui qui adopte le compte. Né hors démarche — le « + »
      // du sélecteur, un profil LOCAL — il reste sans compte, même si un cookie
      // de session traîne : ce serait le rattacher, le router sur la clé du
      // compte et le synchroniser dedans sans qu'on l'ait demandé.
      if (isPendingRealmOpen()) {
        const user = getSessionUser();
        if (user) profile.cloudAccount = cloudAccountStampFrom(user);
        closePendingRealm();
      }
      manifest.profiles.push(profile);
      if (profile.isDefault) manifest.activeProfileId = profile.id;
      await saveManifest(manifest);
      return profile;
    });
  },

  'profile:update': async (profileId: unknown, updates: unknown) =>
    withManifestLock(async () => {
      const manifest = await loadManifest();
      const profile = manifest.profiles.find((p) => p.id === profileId);
      if (!profile) throw new Error('Profile not found');
      const u = (updates ?? {}) as Partial<ProfileMetadata> & { pin?: string | null };
      if (u.name !== undefined) profile.name = u.name.trim();
      if (u.avatarColor !== undefined) profile.avatarColor = u.avatarColor;
      if (u.avatarEmoji !== undefined) profile.avatarEmoji = u.avatarEmoji;
      if (u.avatarImage !== undefined) profile.avatarImage = u.avatarImage ?? undefined;
      if (u.pin === null) {
        profile.pinHash = undefined;
        profile.pinSalt = undefined;
        profile.pinAttempts = 0;
        profile.pinLockedUntil = undefined;
        profile.allowPinReset = undefined;
        profile.pinUpdatedAt = new Date().toISOString();
      } else if (typeof u.pin === 'string') {
        if (!/^\d{4,6}$/.test(u.pin)) throw new Error('PIN must be 4-6 digits');
        profile.pinSalt = hex(crypto.getRandomValues(new Uint8Array(16)));
        profile.pinHash = await hashPin(u.pin, profile.pinSalt);
        profile.pinAttempts = 0;
        profile.pinLockedUntil = undefined;
        profile.pinUpdatedAt = new Date().toISOString();
      }
      // Après le bloc PIN, comme profileManager.updateProfile : `pinUpdatedAt`
      // est l'horloge du merge PIN inter-appareils — sans ce coup d'horloge, un
      // changement d'autorisation de réinitialisation ne se propageait jamais.
      if (u.allowPinReset !== undefined && profile.pinHash) {
        profile.allowPinReset = u.allowPinReset;
        profile.pinUpdatedAt = new Date().toISOString();
      }
      await saveManifest(manifest);
      return profile;
    }),

  'profile:delete': async (profileId: unknown) =>
    withManifestLock(async () => {
      const manifest = await loadManifest();
      const index = manifest.profiles.findIndex((p) => p.id === profileId);
      if (index === -1) throw new Error('Profile not found');
      if (manifest.profiles.length <= 1) throw new Error('Cannot delete the last profile');
      const [removed] = manifest.profiles.splice(index, 1);
      if (manifest.activeProfileId === profileId) {
        manifest.activeProfileId = manifest.profiles[0]?.id ?? null;
      }
      // Sans cette reprise (profileManager.deleteProfile), supprimer le profil
      // par défaut laissait le manifeste SANS défaut du tout.
      if (removed?.isDefault && manifest.profiles.length > 0) {
        manifest.profiles[0].isDefault = true;
      }
      manifest.profiles.forEach((p, i) => {
        p.order = i;
      });
      // LES DONNÉES DU PROFIL PARTENT AVEC SON ENTRÉE. Le bureau efface le
      // répertoire entier ; ici on retirait la seule ligne du manifeste, laissant
      // dossiers, notes, corbeille et blobs orphelins dans IndexedDB — sans profil
      // pour les atteindre ni geste pour les effacer. Sa clé propre part aussi.
      await purgeProfileScope(String(profileId));
      await idbDelete(`wrapped_fek:p:${String(profileId)}`).catch(() => undefined);
      await saveManifest(manifest);
    }),

  /**
   * TOUT EFFACER SUR CET APPAREIL — le pendant web de `profile:fullReset`.
   *
   * Le canal était CLASSÉ pour le web (channelClassification.ts) mais aucun
   * gestionnaire ne l'implémentait : dans un navigateur, le geste levait
   * « canal inconnu ». Or c'est le SEUL moyen de suppression offert à quelqu'un
   * qui n'a qu'un profil, l'écran masquant le bouton « supprimer » dans ce cas.
   *
   * Purement LOCAL, comme sur le bureau : le compte cloud n'est pas touché, et
   * ce qui y est synchronisé reste récupérable à la prochaine connexion. C'est
   * exactement ce que la nouvelle phrase de confirmation annonce. Les clés
   * enveloppées partent aussi — y compris un résidu hérité d'un autre compte,
   * qui bloquerait sinon toute création de compte sur ce navigateur.
   */
  'profile:fullReset': async () =>
    withManifestLock(async () => {
      const manifest = await loadManifest();
      // Les données de chaque profil AVANT le manifeste : l'inverse perdrait la
      // liste des identifiants, et avec elle la seule prise sur leurs clés.
      for (const p of manifest.profiles) {
        await purgeProfileScope(p.id);
      }
      for (const k of await idbKeys()) {
        if (k === 'wrapped_fek' || k.startsWith('wrapped_fek:')) {
          await idbDelete(k).catch(() => undefined);
        }
      }
      await saveManifest({
        version: 1,
        activeProfileId: null,
        profiles: [],
        maxProfiles: manifest.maxProfiles ?? 10,
        migratedFromLegacy: false,
      });
      return { success: true };
    }),

  'profile:activate': async (profileId: unknown) =>
    withManifestLock(async () => {
      const manifest = await loadManifest();
      const profile = manifest.profiles.find((p) => p.id === profileId);
      if (!profile) throw new Error('Profile not found');
      manifest.activeProfileId = profile.id;
      profile.lastAccessedAt = new Date().toISOString();
      await adoptOnActivate(profile);
      await saveManifest(manifest);

      /**
       * LA SESSION SUIT LE PROFIL (miroir du « une session par profil » du
       * bureau). Profil estampillé pour un AUTRE compte que la session : si ce
       * navigateur détient encore le cookie de CE compte, on re-frappe un
       * jeton pour lui et on RECHARGE — l'amorçage repart proprement sous la
       * bonne session (état redux, coffres, orgs : rien d'hérité de l'autre
       * compte). Sans cookie, rien ne bascule : la bulle de la synchro dit
       * déjà le geste (« connectez-vous au compte de ce profil »).
       *
       * Cas réel fermé (2026-09-01) : connexion à un compte de test, retour au
       * profil principal — session restée sur le compte de test, synchro
       * refusée et coffres partagés invisibles, sans issue en un clic.
       */
      if (!isPendingRealmOpen() && profile.cloudAccount?.email) {
        const session = getSessionUser();
        if (!session || !sameEmail(profile.cloudAccount.email, session.email)) {
          const { adoptSessionForStamp } = await import('./authHandlers');
          if (await adoptSessionForStamp(profile.cloudAccount)) {
            window.location.reload();
          }
        }
      }
      return manifest;
    }),

  /**
   * DÉTACHER un profil de son compte — le « soft disconnect » du sélecteur
   * (« Déconnecter tous les profils de ce compte »), miroir exact du bureau
   * (main.ts : `setCloudAccount(profileId, null)`) : l'estampille part, les
   * données locales restent, une connexion explicite depuis ce profil
   * re-rattache.
   *
   * Côté clé, retirer l'estampille est SÛR depuis la règle 3 de
   * `custodyHandlers.wrappedKeyScope` : un profil sans estampille AVEC du
   * contenu re-dérive son appartenance de la liste serveur quand une session
   * existe, et un blob hérité n'est jamais adopté par un compte qui possède
   * déjà des données. La session du navigateur, elle, n'est pas touchée —
   * même contrat que le bureau, qui garde ses jetons jusqu'à la déconnexion
   * explicite des Paramètres.
   */
  'profile:unlinkCloud': async (profileIdArg: unknown) =>
    withManifestLock(async () => {
      const manifest = await loadManifest();
      const profile = manifest.profiles.find((p) => p.id === String(profileIdArg));
      if (!profile) return { success: false, error: 'Profile not found' };
      profile.cloudAccount = null;
      await saveManifest(manifest);
      emitWebEvent('profiles-updated');
      return { success: true };
    }),

  'profile:reorder': async (orderedIds: unknown) =>
    withManifestLock(async () => {
      const manifest = await loadManifest();
      const ids = (orderedIds ?? []) as string[];
      manifest.profiles.sort((a, b) => {
        const ia = ids.indexOf(a.id);
        const ib = ids.indexOf(b.id);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      });
      manifest.profiles.forEach((p, i) => {
        p.order = i;
      });
      await saveManifest(manifest);
      return manifest;
    }),

  'profile:verifyPin': async (profileId: unknown, pin: unknown) =>
    withManifestLock(async () => {
      const manifest = await loadManifest();
      const profile = manifest.profiles.find((p) => p.id === profileId);
      if (!profile?.pinHash || !profile.pinSalt) return { success: false, error: 'No PIN set' };
      // Forme de retour EXACTE du desktop : profilesSlice lit `lockedUntil` pour
      // afficher le verrouillage et son décompte — `{locked:true}` n'y disait rien.
      if (profile.pinLockedUntil && Date.now() < profile.pinLockedUntil) {
        return { success: false, lockedUntil: profile.pinLockedUntil };
      }
      const candidate = await hashPin(String(pin), profile.pinSalt);
      if (candidate === profile.pinHash) {
        profile.pinAttempts = 0;
        profile.pinLockedUntil = undefined;
        profile.lastAccessedAt = new Date().toISOString();
        await saveManifest(manifest);
        return { success: true };
      }
      profile.pinAttempts += 1;
      // Verrouillage progressif de profileManager.verifyPin : 3 échecs → 15 s,
      // puis doublement tous les 3 échecs.
      if (profile.pinAttempts >= 3) {
        const tier = Math.floor((profile.pinAttempts - 3) / 3);
        profile.pinLockedUntil = Date.now() + 15_000 * Math.pow(2, tier);
      }
      await saveManifest(manifest);
      return { success: false, lockedUntil: profile.pinLockedUntil };
    }),
};
