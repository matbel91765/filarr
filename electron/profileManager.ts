/**
 * ProfileManager — Electron Main Process
 *
 * Manages profile CRUD operations, directory structure, and the profiles manifest.
 * Runs in the main process. The renderer communicates via IPC.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { app, safeStorage } from 'electron';

// ── Types (mirrored from src/types/profiles.ts for main process) ──

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
  /** ISO timestamp of last PIN mutation — used for cross-device PIN sync */
  pinUpdatedAt?: string;
  /**
   * ISO timestamp of the last mutation of the profile's PRESENTATION — name,
   * avatar colour/emoji/image, order. Same last-write-wins clock as
   * `pinUpdatedAt`, but for everything the picker shows.
   *
   * Its absence used to mean these edits never left the device that made them:
   * `restoreProfileFromCloud` returns immediately on a known id, so a rename on
   * device A stayed on device A forever. Absent = legacy manifest, and the
   * merge then keeps the local values untouched — an old device breaks nothing.
   */
  metaUpdatedAt?: string;
  createdAt: string;
  lastAccessedAt: string;
  isDefault: boolean;
  order: number;
  /**
   * Cloud account bound to this profile. Null/undefined means the profile is
   * purely local. Populated after successful login and cleared on logout.
   * Stored in cleartext in the encrypted manifest — it's just a label used
   * to render badges in the profile picker and prevent FEK mix-ups at login.
   */
  cloudAccount?: {
    email: string;
    tier: string;
    /** ISO timestamp of last successful auth */
    linkedAt: string;
    /** Strict account type (0059) — reliable pre-activation space signal. */
    accountType?: 'personal' | 'enterprise';
  } | null;
  /** Denormalized hint of the profile's last-known space (source of truth: .space file). */
  spaceMode?: 'personal' | 'enterprise';
  /** Denormalized hint of the profile's real (non-personal) orgs, for the picker. */
  orgs?: Array<{ id: string; name: string; tier: string; role: string; isPersonal: boolean }>;
}

interface ProfilesManifest {
  version: 1;
  activeProfileId: string | null;
  profiles: ProfileMetadata[];
  plan?: string; // deprecated — kept for backward compat, ignored
  maxProfiles: number;
  migratedFromLegacy: boolean;
}

// ── PIN Hashing ──

const PIN_ITERATIONS = 600_000;
const PIN_KEY_LENGTH = 32;

function generatePinSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

async function hashPin(pin: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(pin, Buffer.from(salt, 'hex'), PIN_ITERATIONS, PIN_KEY_LENGTH, 'sha256', (err, key) => {
      if (err) reject(err);
      else resolve(key.toString('hex'));
    });
  });
}

// ── Profile Limits (local-first, no plan restrictions) ──

const MAX_PROFILES = 10;

function getMaxProfiles(): number {
  return MAX_PROFILES;
}

// ── ProfileManager ──

class ProfileManager {
  private manifestPath: string = '';
  private profilesDir: string = '';
  private manifest: ProfilesManifest | null = null;

  /**
   * Initialize — call once during app startup, BEFORE StorageService.initialize()
   */
  async initialize(): Promise<ProfilesManifest> {
    const baseDir = path.join(app.getPath('userData'), 'FilarData');
    this.manifestPath = path.join(baseDir, 'profiles.json');
    this.profilesDir = path.join(baseDir, 'profiles');

    await fs.mkdir(baseDir, { recursive: true });
    await fs.mkdir(this.profilesDir, { recursive: true });

    this.manifest = await this.loadOrCreateManifest();
    return this.manifest;
  }

  /**
   * Load manifest from disk, or create a fresh one
   */
  private async loadOrCreateManifest(): Promise<ProfilesManifest> {
    try {
      const raw = await fs.readFile(this.manifestPath);
      let data: string;

      // Try decrypting first (encrypted format), fall back to plain JSON (migration)
      if (safeStorage.isEncryptionAvailable() && raw[0] !== 0x7B /* not '{' */) {
        data = safeStorage.decryptString(raw);
      } else {
        data = raw.toString('utf-8');
      }

      const parsed = JSON.parse(data) as ProfilesManifest;
      // Validate and repair if needed
      if (!parsed.version || !Array.isArray(parsed.profiles)) {
        throw new Error('Invalid manifest');
      }
      // Migrate old plan-based limits to flat limit
      if (parsed.maxProfiles < MAX_PROFILES) {
        parsed.maxProfiles = MAX_PROFILES;
        await this.saveManifest(parsed);
      }
      // Migrate plain JSON to encrypted format
      if (raw[0] === 0x7B && safeStorage.isEncryptionAvailable()) {
        await this.saveManifest(parsed);
      }
      return parsed;
    } catch {
      const fresh: ProfilesManifest = {
        version: 1,
        activeProfileId: null,
        profiles: [],
        maxProfiles: MAX_PROFILES,
        migratedFromLegacy: false,
      };
      await this.saveManifest(fresh);
      return fresh;
    }
  }

  /**
   * Persist manifest to disk (encrypted with OS credential store)
   */
  async saveManifest(manifest: ProfilesManifest): Promise<void> {
    this.manifest = manifest;
    const json = JSON.stringify(manifest, null, 2);

    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(json);
      await fs.writeFile(this.manifestPath, encrypted);
    } else {
      // Fallback: plain JSON if OS encryption unavailable
      await fs.writeFile(this.manifestPath, json, 'utf-8');
    }
  }

  /**
   * Get current manifest (in-memory)
   */
  getManifest(): ProfilesManifest {
    if (!this.manifest) {
      throw new Error('ProfileManager not initialized');
    }
    return this.manifest;
  }

  /**
   * Create a new profile
   */
  async createProfile(
    name: string,
    avatarColor: string,
    pin?: string,
    allowPinReset?: boolean,
  ): Promise<ProfileMetadata> {
    const manifest = this.getManifest();

    if (manifest.profiles.length >= manifest.maxProfiles) {
      throw new Error(`Profile limit reached (${manifest.maxProfiles})`);
    }

    if (name.length > 50) {
      throw new Error('Profile name too long (max 50 characters)');
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    let pinHash: string | undefined;
    let pinSalt: string | undefined;

    if (pin) {
      if (!/^\d{4,6}$/.test(pin)) {
        throw new Error('PIN must be 4-6 digits');
      }
      pinSalt = generatePinSalt();
      pinHash = await hashPin(pin, pinSalt);
    }

    const profile: ProfileMetadata = {
      id,
      name: name.trim(),
      avatarColor,
      pinHash,
      pinSalt,
      pinAttempts: 0,
      allowPinReset: pin ? (allowPinReset ?? false) : undefined,
      pinUpdatedAt: pin ? now : undefined,
      createdAt: now,
      lastAccessedAt: now,
      isDefault: manifest.profiles.length === 0, // First profile is default
      order: manifest.profiles.length,
    };

    // Create profile directory
    const profileDir = this.getProfileDataDir(id);
    await fs.mkdir(profileDir, { recursive: true });

    // Add to manifest
    manifest.profiles.push(profile);
    if (profile.isDefault) {
      manifest.activeProfileId = id;
    }
    await this.saveManifest(manifest);

    return profile;
  }

  /**
   * Delete a profile and its data directory
   */
  async deleteProfile(profileId: string): Promise<void> {
    const manifest = this.getManifest();
    const index = manifest.profiles.findIndex(p => p.id === profileId);

    if (index === -1) {
      throw new Error('Profile not found');
    }

    if (manifest.profiles.length <= 1) {
      throw new Error('Cannot delete the last profile');
    }

    // Remove from manifest
    const [removed] = manifest.profiles.splice(index, 1);

    // If deleting the active profile, switch to the first remaining
    if (manifest.activeProfileId === profileId) {
      manifest.activeProfileId = manifest.profiles[0]?.id || null;
    }

    // If deleting the default, make the first remaining the default
    if (removed.isDefault && manifest.profiles.length > 0) {
      manifest.profiles[0].isDefault = true;
    }

    // Recompute order
    manifest.profiles.forEach((p, i) => { p.order = i; });

    await this.saveManifest(manifest);

    // Delete directory (async, non-blocking error)
    try {
      const profileDir = this.getProfileDataDir(profileId);
      await fs.rm(profileDir, { recursive: true, force: true });
    } catch (err) {
      console.error(`Failed to delete profile directory for ${profileId}:`, err);
    }
  }

  /**
   * Update a profile's metadata
   */
  async updateProfile(
    profileId: string,
    updates: { name?: string; avatarColor?: string; avatarImage?: string | null; pin?: string | null; allowPinReset?: boolean },
  ): Promise<ProfileMetadata> {
    const manifest = this.getManifest();
    const profile = manifest.profiles.find(p => p.id === profileId);

    if (!profile) {
      throw new Error('Profile not found');
    }

    // Toute mutation de la PRÉSENTATION avance l'horloge `metaUpdatedAt` — c'est
    // elle qui décide, à la fusion, quel appareil a raison. Le PIN garde la
    // sienne (`pinUpdatedAt`) : les deux se déplacent indépendamment, un
    // changement de nom ne doit pas faire gagner un vieux PIN.
    let metaChanged = false;

    if (updates.name !== undefined) {
      if (updates.name.trim().length === 0 || updates.name.length > 50) {
        throw new Error('Invalid profile name');
      }
      profile.name = updates.name.trim();
      metaChanged = true;
    }

    if (updates.avatarColor !== undefined) {
      profile.avatarColor = updates.avatarColor;
      metaChanged = true;
    }

    if (updates.avatarImage === null) {
      profile.avatarImage = undefined;
      metaChanged = true;
    } else if (updates.avatarImage !== undefined) {
      // Validate: must be a data URL, max 128KB
      if (updates.avatarImage.startsWith('data:image/') && updates.avatarImage.length <= 128 * 1024) {
        profile.avatarImage = updates.avatarImage;
        metaChanged = true;
      }
    }

    if (metaChanged) {
      profile.metaUpdatedAt = new Date().toISOString();
    }

    if (updates.pin === null) {
      // Remove PIN
      profile.pinHash = undefined;
      profile.pinSalt = undefined;
      profile.pinAttempts = 0;
      profile.pinLockedUntil = undefined;
      profile.allowPinReset = undefined;
      profile.pinUpdatedAt = new Date().toISOString();
    } else if (updates.pin !== undefined) {
      // Set new PIN
      if (!/^\d{4,6}$/.test(updates.pin)) {
        throw new Error('PIN must be 4-6 digits');
      }
      profile.pinSalt = generatePinSalt();
      profile.pinHash = await hashPin(updates.pin, profile.pinSalt);
      profile.pinAttempts = 0;
      profile.pinLockedUntil = undefined;
      profile.pinUpdatedAt = new Date().toISOString();
    }

    if (updates.allowPinReset !== undefined && profile.pinHash) {
      profile.allowPinReset = updates.allowPinReset;
      profile.pinUpdatedAt = new Date().toISOString();
    }

    await this.saveManifest(manifest);
    return profile;
  }

  /**
   * Verify a PIN for a profile
   * Returns true if correct, false if wrong (and increments attempts)
   */
  async verifyPin(profileId: string, pin: string): Promise<{ success: boolean; lockedUntil?: number }> {
    const manifest = this.getManifest();
    const profile = manifest.profiles.find(p => p.id === profileId);

    if (!profile || !profile.pinHash || !profile.pinSalt) {
      throw new Error('Profile not found or has no PIN');
    }

    // Check lockout
    if (profile.pinLockedUntil && Date.now() < profile.pinLockedUntil) {
      return { success: false, lockedUntil: profile.pinLockedUntil };
    }

    const hash = await hashPin(pin, profile.pinSalt);

    if (hash === profile.pinHash) {
      // Success — reset attempts
      profile.pinAttempts = 0;
      profile.pinLockedUntil = undefined;
      await this.saveManifest(manifest);
      return { success: true };
    }

    // Failure — increment attempts
    profile.pinAttempts += 1;

    // Progressive lockout: starts at 3 failed attempts, then escalates
    // 3 fails → 15s, 5 → 30s, 8 → 60s, 11 → 120s, 14 → 240s, ...
    if (profile.pinAttempts >= 3) {
      const tier = Math.floor((profile.pinAttempts - 3) / 3);
      const lockoutMs = 15_000 * Math.pow(2, tier);
      profile.pinLockedUntil = Date.now() + lockoutMs;
    }

    await this.saveManifest(manifest);
    return { success: false, lockedUntil: profile.pinLockedUntil };
  }

  /**
   * Reset PIN for a profile (forgot PIN flow)
   * Requires the profile name as confirmation to prevent unauthorized resets.
   */
  async resetPin(profileId: string, confirmName?: string): Promise<void> {
    const manifest = this.getManifest();
    const profile = manifest.profiles.find(p => p.id === profileId);

    if (!profile) {
      throw new Error('Profile not found');
    }

    // Only allow reset if explicitly opted in
    if (!profile.allowPinReset) {
      throw new Error('PIN reset is not enabled for this profile');
    }

    // Require typing the profile name to confirm reset
    if (!confirmName || confirmName.trim() !== profile.name) {
      throw new Error('Profile name does not match');
    }

    profile.pinHash = undefined;
    profile.pinSalt = undefined;
    profile.pinAttempts = 0;
    profile.pinLockedUntil = undefined;

    await this.saveManifest(manifest);
  }

  /**
   * Reorder profiles
   */
  async reorderProfiles(orderedIds: string[]): Promise<void> {
    const manifest = this.getManifest();
    const reordered: ProfileMetadata[] = [];
    const now = new Date().toISOString();

    for (let i = 0; i < orderedIds.length; i++) {
      const profile = manifest.profiles.find(p => p.id === orderedIds[i]);
      if (profile) {
        // L'ordre fait partie de la présentation : seul un profil qui BOUGE
        // réellement avance son horloge, sinon un simple glisser-déposer sans
        // effet ferait gagner cet appareil sur tous les autres.
        if (profile.order !== i) {
          profile.order = i;
          profile.metaUpdatedAt = now;
        }
        reordered.push(profile);
      }
    }

    manifest.profiles = reordered;
    await this.saveManifest(manifest);
  }

  /**
   * Update last accessed timestamp
   */
  async updateLastAccessed(profileId: string): Promise<void> {
    const manifest = this.getManifest();
    const profile = manifest.profiles.find(p => p.id === profileId);
    if (profile) {
      profile.lastAccessedAt = new Date().toISOString();
      manifest.activeProfileId = profileId;
      await this.saveManifest(manifest);
    }
  }

  /**
   * Get the absolute path to a profile's data directory
   */
  getProfileDataDir(profileId: string): string {
    // Sanitize to prevent path traversal
    const safe = profileId.replace(/[^a-zA-Z0-9\-]/g, '');
    return path.join(this.profilesDir, safe);
  }

  /**
   * Restore a profile from cloud sync manifest metadata.
   * Used by Device B after pairing to recreate the profile locally
   * with the same ID, name, and avatar as Device A.
   * If a profile with this ID already exists, it is skipped.
   */
  async restoreProfileFromCloud(meta: {
    id: string;
    name: string;
    avatarColor: string;
    avatarEmoji?: string;
    avatarImage?: string;
    isDefault: boolean;
    order: number;
    createdAt: string;
    pinHash?: string;
    pinSalt?: string;
    allowPinReset?: boolean;
    pinUpdatedAt?: string;
    metaUpdatedAt?: string;
  }): Promise<void> {
    const manifest = this.getManifest();

    // Skip if already exists — les MISES À JOUR d'un profil connu passent par
    // `applyCloudMetaUpdate`, qui arbitre à l'horloge au lieu d'écraser.
    if (manifest.profiles.some((p) => p.id === meta.id)) {
      return;
    }

    const profile: ProfileMetadata = {
      id: meta.id,
      name: meta.name,
      avatarColor: meta.avatarColor,
      avatarEmoji: meta.avatarEmoji,
      avatarImage: meta.avatarImage,
      pinHash: meta.pinHash,
      pinSalt: meta.pinSalt,
      pinAttempts: 0,
      allowPinReset: meta.allowPinReset,
      pinUpdatedAt: meta.pinUpdatedAt,
      metaUpdatedAt: meta.metaUpdatedAt,
      createdAt: meta.createdAt,
      lastAccessedAt: new Date().toISOString(),
      isDefault: meta.isDefault || manifest.profiles.length === 0,
      order: meta.order,
    };

    // Create profile directory
    const profileDir = this.getProfileDataDir(meta.id);
    await fs.mkdir(profileDir, { recursive: true });

    manifest.profiles.push(profile);
    if (profile.isDefault) {
      manifest.activeProfileId = meta.id;
    }
    await this.saveManifest(manifest);
  }

  /**
   * Merge PIN state from a cloud manifest into an existing local profile.
   * Uses pinUpdatedAt as a last-write-wins clock: the remote PIN only
   * replaces the local PIN if its timestamp is strictly newer. If the
   * local profile has no pinUpdatedAt (legacy), any remote PIN wins.
   *
   * Returns true if the local profile was mutated.
   */
  async applyCloudPinUpdate(
    profileId: string,
    remote: {
      pinHash?: string;
      pinSalt?: string;
      allowPinReset?: boolean;
      pinUpdatedAt?: string;
    }
  ): Promise<boolean> {
    const manifest = this.getManifest();
    const profile = manifest.profiles.find((p) => p.id === profileId);
    if (!profile) return false;

    // No PIN clock on either side — nothing verifiable to sync
    if (!remote.pinUpdatedAt && !profile.pinUpdatedAt) return false;

    // Remote has nothing authoritative about PIN state
    if (!remote.pinUpdatedAt) return false;

    // Local is strictly newer — keep local
    if (
      profile.pinUpdatedAt &&
      new Date(profile.pinUpdatedAt).getTime() >=
        new Date(remote.pinUpdatedAt).getTime()
    ) {
      return false;
    }

    // Remote wins
    profile.pinHash = remote.pinHash;
    profile.pinSalt = remote.pinSalt;
    profile.allowPinReset = remote.allowPinReset;
    profile.pinUpdatedAt = remote.pinUpdatedAt;
    profile.pinAttempts = 0;
    profile.pinLockedUntil = undefined;

    await this.saveManifest(manifest);
    return true;
  }

  /**
   * Fusionne la PRÉSENTATION d'un profil (nom, avatar, ordre) venue du nuage
   * dans le profil local du même identifiant.
   *
   * CE QUE SON ABSENCE COÛTAIT. Renommer un profil sur l'appareil A ne se voyait
   * nulle part ailleurs, jamais : `restoreProfileFromCloud` sort immédiatement
   * sur un identifiant déjà connu, et le PIN était le seul champ à disposer d'une
   * fusion. Deux appareils du même compte affichaient donc durablement deux noms
   * et deux couleurs pour un seul et même profil.
   *
   * ARBITRAGE À L'HORLOGE, calqué sur `applyCloudPinUpdate` : le distant ne gagne
   * que si son `metaUpdatedAt` est STRICTEMENT plus récent que le nôtre. À
   * égalité — donc y compris quand c'est notre propre manifeste qui nous revient
   * — le local reste, et l'écran ne clignote pas.
   *
   * LE SILENCE N'EST PAS UNE OPINION : un distant sans horloge (manifeste
   * antérieur à ce champ) ne peut rien réclamer et ne touche à rien. Un local
   * sans horloge, lui, n'a rien à opposer : le distant estampillé l'emporte, ce
   * qui est exactement ce qu'il faut pour un appareil qui vient de rejoindre.
   *
   * NE TOUCHE PAS AU PIN, ni au compte lié, ni au dernier accès : chacun a sa
   * propre horloge ou sa propre autorité locale.
   *
   * Rend `true` si le profil local a été modifié.
   */
  async applyCloudMetaUpdate(
    profileId: string,
    remote: {
      name?: string;
      avatarColor?: string;
      avatarEmoji?: string;
      avatarImage?: string;
      order?: number;
      metaUpdatedAt?: string;
    }
  ): Promise<boolean> {
    const manifest = this.getManifest();
    const profile = manifest.profiles.find((p) => p.id === profileId);
    if (!profile) return false;

    // Le distant ne porte aucune horloge — rien d'autoritaire à appliquer.
    if (!remote.metaUpdatedAt) return false;

    const remoteMs = new Date(remote.metaUpdatedAt).getTime();
    if (Number.isNaN(remoteMs)) return false;

    // Local strictement plus récent (ou aussi récent) — on garde le local.
    if (profile.metaUpdatedAt) {
      const localMs = new Date(profile.metaUpdatedAt).getTime();
      if (!Number.isNaN(localMs) && localMs >= remoteMs) return false;
    }

    let changed = false;

    if (remote.name !== undefined && remote.name !== profile.name) {
      profile.name = remote.name;
      changed = true;
    }
    if (remote.avatarColor !== undefined && remote.avatarColor !== profile.avatarColor) {
      profile.avatarColor = remote.avatarColor;
      changed = true;
    }
    if (remote.avatarEmoji !== profile.avatarEmoji) {
      // Retirer l'emoji est une décision comme une autre : `undefined` distant
      // efface l'emoji local, contrairement aux champs obligatoires ci-dessus
      // qu'un manifeste ne peut pas ne pas porter.
      profile.avatarEmoji = remote.avatarEmoji;
      changed = true;
    }
    if (remote.avatarImage !== profile.avatarImage) {
      profile.avatarImage = remote.avatarImage;
      changed = true;
    }
    if (remote.order !== undefined && remote.order !== profile.order) {
      profile.order = remote.order;
      changed = true;
    }
    // `isDefault` N'EST PAS SYNCHRONISÉ : c'est « le profil qui s'ouvre sur CET
    // appareil ». L'adopter depuis le nuage promeut un second profil par défaut
    // sans jamais rétrograder l'ancien — deux profils par défaut, et un picker
    // qui ne sait plus lequel ouvrir.

    // L'horloge est reprise même si rien n'a bougé matériellement (mêmes valeurs
    // des deux côtés) : sans cela, le même manifeste distant serait réexaminé à
    // chaque cycle, pour rien.
    if (profile.metaUpdatedAt !== remote.metaUpdatedAt) {
      profile.metaUpdatedAt = remote.metaUpdatedAt;
      await this.saveManifest(manifest);
    } else if (changed) {
      await this.saveManifest(manifest);
    }

    return changed;
  }

  /**
   * Bind/unbind a cloud account to a profile. Called from authService after
   * successful login (bind) or logout/account-delete (unbind).
   */
  async setCloudAccount(
    profileId: string,
    account: { email: string; tier: string; accountType?: 'personal' | 'enterprise' } | null
  ): Promise<void> {
    const manifest = this.getManifest();
    const profile = manifest.profiles.find((p) => p.id === profileId);
    if (!profile) return;
    profile.cloudAccount = account
      ? {
          email: account.email,
          tier: account.tier,
          linkedAt: new Date().toISOString(),
          accountType: account.accountType,
        }
      : null;
    // Unbinding the cloud account clears the enterprise hints — a local profile
    // can never be enterprise.
    if (!account) {
      profile.spaceMode = 'personal';
      profile.orgs = [];
    }
    await this.saveManifest(manifest);
  }

  /**
   * Denormalize the profile's active space onto the manifest so the
   * pre-activation ProfilePicker can badge/default it. The .space file stays
   * authoritative; this is only a picker hint.
   */
  async setSpaceMode(
    profileId: string,
    spaceMode: 'personal' | 'enterprise'
  ): Promise<void> {
    const manifest = this.getManifest();
    const profile = manifest.profiles.find((p) => p.id === profileId);
    if (!profile || profile.spaceMode === spaceMode) return;
    profile.spaceMode = spaceMode;
    await this.saveManifest(manifest);
  }

  /**
   * Denormalize the profile's real (non-personal) org list onto the manifest so
   * the picker knows whether to offer the Enterprise toggle without a network
   * call. Called whenever the org list is fetched. No-ops if unchanged.
   */
  async setOrgsHint(
    profileId: string,
    orgs: Array<{ id: string; name: string; tier: string; role: string; isPersonal: boolean }>
  ): Promise<void> {
    const manifest = this.getManifest();
    const profile = manifest.profiles.find((p) => p.id === profileId);
    if (!profile) return;
    const next = orgs.filter((o) => !o.isPersonal);
    if (JSON.stringify(profile.orgs ?? []) === JSON.stringify(next)) return;
    profile.orgs = next;
    await this.saveManifest(manifest);
  }

  /**
   * True if any profile other than `excludeProfileId` is already bound to
   * the given email. Used to warn the user before they bind the same cloud
   * account to a second profile (allowed, but worth flagging).
   */
  isCloudAccountBoundElsewhere(email: string, excludeProfileId: string): boolean {
    const manifest = this.getManifest();
    return manifest.profiles.some(
      (p) =>
        p.id !== excludeProfileId &&
        p.cloudAccount?.email?.toLowerCase() === email.toLowerCase()
    );
  }

  /**
   * Check if legacy (pre-profile) data exists
   */
  async hasLegacyData(): Promise<boolean> {
    const baseDir = path.join(app.getPath('userData'), 'FilarData');
    try {
      // Check for encryption.key at root level (legacy indicator)
      await fs.access(path.join(baseDir, 'encryption.key'));
      return true;
    } catch {
      return false;
    }
  }
}

export default new ProfileManager();
