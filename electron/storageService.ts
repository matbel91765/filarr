import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { promisify } from 'util';
import { Readable } from 'stream';
import { app, safeStorage } from 'electron';
import { secureDeleteFile, secureDeleteDir } from './secureDelete';
import { estRepertoireReserve } from './profileDirs';
import { buildShortcutEntry, type VaultShortcutRef } from './vaultShortcut';
import {
  isV3Buffer,
  isV3File,
  readV3HeaderSync,
  encryptFileToFileV3,
  encryptBufferToFileV3,
  decryptFileToFileV3,
  decryptFileToBufferV3,
  reencryptFileV3,
  statV3File,
  createDecryptReadStreamV3,
  transcodeV3File,
  hashV3Plaintext,
  V3FileReader,
} from './streamCrypto';
import { getSessionKey, peekSessionKey } from './sessionKeyStore';
import { decryptHybridFekBlob } from './hybridBlobCrypto';
import profileManager from './profileManager';
import { openWebFileContainer } from './sync/webContainerRead';
import {
  MACHINE_MARKER_V3,
  deriveMachineKeyV3,
  machineContainerNeedsRewrite,
  machineWriteVersion,
  openMachineV3Bytes,
  openMachineV3Text,
  sealMachineV3Bytes,
  sealMachineV3Text,
  type MachineContainerVersion,
} from './machineContainerV3';
import {
  dedupeRemindersById,
  stampReminderCreation,
  touchReminder,
  type StoredReminder,
} from './sync/reminderMetaCore';
import {
  isTombstone,
  liveReminders,
  toTombstone,
  CALENDAR_REMINDERS_META_RESOURCE_ID,
  NOTE_REMINDERS_META_RESOURCE_ID,
} from './sync/reminderMetaDoc';

const deflateAsync = promisify(zlib.deflate);
const inflateAsync = promisify(zlib.inflate);

/** Compteur des temporaires d'`encryptToFile` — unicité dans le processus. */
let encryptToFileSeq = 0;

/**
 * Sentinelle désignant la racine dans les déplacements. La racine n'est pas un
 * dossier stocké : un dossier de premier niveau est simplement un dossier sans
 * `parentId`. Cf. `moveItem`.
 */
const ROOT_FOLDER_ID = 'root';

/**
 * Folder structure
 */
interface Folder {
  id: string;
  name: string;
  items: Item[];
  color?: string;
  parentId?: string | null;
  protected?: boolean;
  password?: string;
  createdAt?: string;
  updatedAt?: string;
  reminders?: Reminder[];
  deletedAt?: string;
  /**
   * ÉTIQUETTES DES FICHIERS — `identifiant de fichier -> étiquettes`, à plat.
   *
   * Le champ est DÉCLARÉ ici bien que ce processus ne le lise jamais :
   * `saveFolder` chiffre l'objet ENTIER et `updateFolder` fusionne par
   * étalement, donc il traversait déjà. Le déclarer le rend visible à qui
   * relit ce fichier, et empêche qu'une future normalisation champ par champ
   * l'efface sans que personne s'en aperçoive. Écrit par le renderer et par le
   * téléphone (`filarr-mobile/src/services/tags/fileTags.ts`).
   */
  fileTags?: Record<string, string[]>;
  /**
   * RUNTIME UNIQUEMENT, jamais persisté. Marque le dossier vide renvoyé par
   * `getFolder` quand `metadata.json` est PRÉSENT mais ILLISIBLE (déchiffrement
   * échoué, peut-être transitoire). `saveFolder` REFUSE de persister un dossier
   * ainsi marqué : sans ce garde-fou, un « lire → muter → sauver » (ajout
   * d'élément, renommage, déplacement…) réécrirait le vrai contenu à vide et
   * propagerait la perte via la synchro. Voir `getFolder`/`saveFolder`.
   */
  __unreadable?: boolean;
}

/**
 * Item structure (file or folder)
 */
interface Item {
  id: string;
  name: string;
  type: 'file' | 'folder';
  size?: number;
  date?: string;
  description?: string;
  priority?: string;
  protected?: boolean;
  password?: string;
  parentId?: string | null;
  color?: string;
  items?: Item[];
  reminders?: Reminder[];
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string;
  /** Raccourci vers un coffre : les octets sont là-bas, pas ici (voir vaultShortcut.ts). */
  vaultRef?: VaultShortcutRef;
}

/**
 * Reminder structure
 */
interface Reminder {
  id: string;
  // Legacy electron-side field name (kept for back-compat with stored data
  // that still uses `description` instead of the renderer's `message`).
  description?: string;
  message?: string;
  date: string;
  isRead?: boolean;
  read?: boolean;
  isCompleted?: boolean;
  completed?: boolean;
  itemId?: string;
  itemName?: string;
  itemType?: string;
  priority?: 'low' | 'normal' | 'high';
  recurring?: 'none' | 'daily' | 'weekly' | 'monthly';
  snoozedUntil?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Notification settings
 */
interface NotificationSettings {
  enabled: boolean;
  sound: boolean;
  delay: number;
}

/**
 * Storage quota structure
 */
interface StorageQuota {
  used: number;
  total: number;
}

/**
 * Quota check result (file-size only — no tier-based limits)
 */
interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Encryption options
 * @description Configuration for AES-256-GCM encryption
 */
// interface EncryptionOptions {
//   algorithm: string;
//   keyLength: number;
//   ivLength: number;
//   saltLength: number;
//   tagLength: number;
//   iterationCount: number;
//   legacyIterationCount: number;
// }


/**
 * Trash item structure
 */
interface TrashItem extends Item {
  itemType: 'file' | 'folder';
  parentFolderId?: string;
  parentFolderName?: string;
}

/**
 * Identifiant de dossier aleatoire — JUMEAU EXACT de `generateUniqueId()`
 * (`src/utils/idGenerator.ts`), que le renderer utilise pour le meme role.
 *
 * Les deux doivent rendre des chaines de la MEME forme (22 caracteres base36,
 * issus de 16 octets aleatoires) : un identifiant de dossier devient un nom de
 * repertoire sur le disque et l entree de `sha256("<id>/<nom>")` cote synchro.
 * Deux formes distinctes selon le chemin de creation seraient un signal
 * exploitable — et rendraient les tests de forme dependants du chemin.
 *
 * La duplication est assumee : le renderer et le processus principal ne
 * partagent pas de module (bundles distincts, `randomBytes` different). Si l un
 * des deux change, l autre doit suivre.
 */
function randomFolderId(): string {
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (let i = 0; i < bytes.length; i += 4) {
    const n =
      ((bytes[i] << 24) >>> 0) +
      ((bytes[i + 1] ?? 0) << 16) +
      ((bytes[i + 2] ?? 0) << 8) +
      (bytes[i + 3] ?? 0);
    out += n.toString(36).padStart(7, '0');
  }
  return out.slice(0, 22);
}

/**
 * Pose l identifiant d un dossier avant ecriture — LA decision, isolee pour
 * qu une garde puisse l exercer.
 *
 * Elle vivait en ligne dans `saveFolder`, et c est ce qui la rendait
 * intestable : une garde ne pouvait viser que `randomFolderId()`, donc rester
 * verte pendant qu on remettait `Date.now()` sur le site d appel. Le tour de
 * la fonction est ici le CHEMIN REEL, pas un jumeau.
 *
 * Contrat : un identifiant deja pose est conserve (normalise en chaine) ; un
 * identifiant absent est tire au hasard. Jamais d horloge.
 */
export function ensureFolderId(folder: { id?: unknown }): string {
  return folder.id ? String(folder.id) : randomFolderId();
}

/**
 * Storage Service - Manages encrypted file and folder storage
 */
class StorageService {
  private baseDir: string | null = null;
  private keyFile: string | null = null;
  private quotaFile: string | null = null;
  private key: Buffer | null = null;

  // Promise that resolves when current init/reinit is complete.
  // Any encrypt/decrypt call will await this to avoid race conditions.
  private initPromise: Promise<void> = Promise.resolve();

  // Per-folder mutex to prevent concurrent read-modify-write races
  private folderLocks: Map<string, Promise<void>> = new Map();

  private readonly algorithm: string = 'aes-256-gcm';
  private readonly keyLength: number = 32;
  private readonly ivLength: number = 16;
  private readonly saltLength: number = 16;
  private readonly tagLength: number = 16;

  // SECURITY: Increased PBKDF2 iterations from 10000 to 600000
  // This improves resistance against brute force attacks
  // OWASP 2024 recommendation: minimum 600000 iterations for PBKDF2-SHA-512
  private readonly iterationCount: number = 600000;
  private readonly legacyIterationCount: number = 10000; // For backward compatibility with old data

  // Encryption version markers
  // v3 : même disposition que v2, clé dérivée par HKDF-SHA-256 au lieu de
  // 600 000 tours de PBKDF2 — voir machineContainerV3.ts. Lue toujours ;
  // écrite derrière FILARR_MACHINE_CONTAINER_V3.
  public readonly ENCRYPTION_VERSION_3: string = MACHINE_MARKER_V3;
  public readonly ENCRYPTION_VERSION_2: string = 'v2:'; // 600k iterations
  public readonly ENCRYPTION_VERSION_1: string = 'v1:'; // 10k iterations (legacy)

  // V3 chunked streaming format (see ./streamCrypto.ts)
  // Max plaintext size allowed for whole-buffer decryption of a V3 file
  // (previews / renderer round-trips). Larger V3 files must be streamed.
  public readonly V3_PREVIEW_MAX_BYTES: number = 1024 * 1024 * 1024; // 1 GiB
  // Per-file cap for the V3 path-based streaming import — aligned with
  // MAX_FILE_SIZE in src/constants/limits.ts.
  private readonly streamMaxFileSize: number = 5 * 1024 * 1024 * 1024; // 5 GiB
  // User-facing French corrupt-file message — must match ERR_CORRUPT in
  // ./streamCrypto.ts so V3 and legacy failures surface identically.
  private readonly V3_ERR_CORRUPT: string = 'Fichier chiffre corrompu - dechiffrement impossible';
  // Legacy (V1/V2) blobs are not range-decryptable: the streaming fallback
  // decrypts them whole in RAM. Cap mirrors the historical 500 MB legacy
  // vault limit (legacy blobs are <= 500 MB by construction).
  public readonly LEGACY_STREAM_MAX_BYTES: number = 500 * 1024 * 1024;


  /**
   * CLÉ ENTRANTE, en lecture SEULEMENT (« Publier ce coffre sur le compte »).
   *
   * La migration ne rescelle RIEN localement (règle C1, `publish/itemTransfer.ts`) :
   * il n'existe donc AUCUN blob local « re-scellé » qu'il faudrait rouvrir sous
   * cette clé. Elle n'est offerte en lecture que pour le contenu DESCENDU du
   * compte pendant la fenêtre de migration — des octets scellés sous la clé du
   * compte alors que la bascule ne l'a pas encore rendue active sur cet
   * appareil. Sans cette candidate, ce contenu-là resterait illisible jusqu'à
   * la bascule, quel que soit l'instant d'une coupure.
   *
   * Elle n'est JAMAIS utilisée pour ÉCRIRE : `getMasterKey`, `getSessionKey` et
   * `getBoxWriteKey` l'ignorent totalement. Le coût est une tentative GCM
   * supplémentaire sur le seul chemin d'échec, et uniquement pendant la
   * migration. `publishEngine` la pose au démarrage d'une migration reprise et
   * la retire à la bascule, à l'abandon comme à l'échec.
   */
  private incomingReadKey: Buffer | null = null;

  /** Pose (ou retire) la clé entrante dans les candidates de LECTURE au repos. */
  setIncomingReadKey(raw: Buffer | null): void {
    if (this.incomingReadKey) this.incomingReadKey.fill(0);
    this.incomingReadKey = raw ? Buffer.from(raw) : null;
  }

  /**
   * CLÉS RETIRÉES — anciennes clés de coffre, conservées en LECTURE SEULE.
   *
   * Elles existent parce que la migration « publier ce coffre sur le compte »
   * ne rescelle RIEN localement : après une bascule, tout le contenu déjà
   * présent sur l'appareil est encore scellé sous l'ancienne clé. Sans ces
   * candidates, la bascule rendrait le coffre illisible — ce serait le défaut
   * que la nouvelle conception répare, simplement déplacé d'un cran.
   *
   * ELLES NE SERVENT JAMAIS À ÉCRIRE. `getMasterKey`, `getSessionKey`,
   * `getBoxWriteKey` et tous les chemins de scellement les ignorent
   * totalement : un fichier NEUF est toujours scellé sous la clé du compte.
   * Le coût est une tentative GCM supplémentaire sur le seul chemin d'échec,
   * plus le fait — assumé et écrit dans `publish/retiredKey.ts` — que
   * l'appareil garde durablement deux clés.
   *
   * Posées à l'AMORÇAGE de l'application par `publishEngine`, pas à
   * l'ouverture d'un écran : un coffre migré doit s'ouvrir dès le démarrage.
   */
  private retiredReadKeys: Buffer[] = [];

  /** Pose (ou remplace) les clés retirées dans les candidates de LECTURE. */
  setRetiredReadKeys(keys: readonly Buffer[]): void {
    for (const old of this.retiredReadKeys) old.fill(0);
    this.retiredReadKeys = keys.map((k) => Buffer.from(k));
  }

  /**
   * Candidates de lecture d'un conteneur, dans l'ordre de probabilité :
   * la FEK du compte, la clé entrante quand une migration est en cours, puis
   * les clés retirées. La clé machine est ajoutée par les appelants, en tête,
   * car elle est la plus fréquente sur les profils locaux.
   */
  private async accountKeyCandidates(): Promise<Buffer[]> {
    const out: Buffer[] = [];
    const fek = await this.getFekRawForSync();
    if (fek) out.push(fek);
    if (this.incomingReadKey) out.push(this.incomingReadKey);
    out.push(...this.retiredReadKeys);
    return out;
  }

  // Sync callbacks — set by syncService to be notified of changes
  private _onFolderSaved: ((folderId: string) => void) | null = null;
  private _onFolderDeleted: ((folderId: string) => void) | null = null;
  private _onFileDeleted: ((folderId: string, fileName: string) => void) | null = null;
  /**
   * Un des DEUX fichiers de rappels racine a change (`noteReminders.json`,
   * `calendarReminders.json`). Recoit la RESSOURCE, pas le fichier :
   * `note-reminders` ou `calendar-reminders`, que `notifyMetadataChanged`
   * prefixe par `meta:`. Voir `reminderMetaDoc`.
   */
  private _onReminderStoreChanged: ((resourceId: string) => void) | null = null;

  setOnFolderSaved(cb: (folderId: string) => void): void { this._onFolderSaved = cb; }
  setOnFolderDeleted(cb: (folderId: string) => void): void { this._onFolderDeleted = cb; }
  setOnFileDeleted(cb: (folderId: string, fileName: string) => void): void { this._onFileDeleted = cb; }
  setOnReminderStoreChanged(cb: (resourceId: string) => void): void { this._onReminderStoreChanged = cb; }

  constructor() {
    // Delay initialization of baseDir until app is ready
  }

  /**
   * Serialize async operations on a given folder to prevent concurrent
   * read-modify-write race conditions that lose items.
   */
  private async withFolderLock<T>(folderId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.folderLocks.get(folderId) ?? Promise.resolve();
    let resolve!: () => void;
    const next = new Promise<void>((r) => { resolve = r; });
    this.folderLocks.set(folderId, next);

    await prev;
    try {
      return await fn();
    } finally {
      resolve();
      // Clean up finished lock to prevent memory leak
      if (this.folderLocks.get(folderId) === next) {
        this.folderLocks.delete(folderId);
      }
    }
  }

  /**
   * Initialize storage service.
   * If profileDataDir is provided, uses it as the base directory (profile-scoped).
   * Otherwise falls back to the legacy monolithic FilarData/ directory.
   */
  async initialize(profileDataDir?: string): Promise<void> {
    const doInit = async () => {
      if (profileDataDir) {
        this.baseDir = profileDataDir;
      } else if (!this.baseDir) {
        this.baseDir = path.join(app.getPath('userData'), 'FilarData');
      }
      this.keyFile = path.join(this.baseDir, 'encryption.key');
      this.quotaFile = path.join(this.baseDir, 'storage.quota');
      await fs.mkdir(this.baseDir, { recursive: true });
      await this.loadOrGenerateKey();
    };
    this.initPromise = doInit();
    await this.initPromise;
  }

  /**
   * Re-initialize for a different profile directory.
   * Called when the user switches profiles at runtime.
   */
  async reinitialize(profileDataDir: string, options?: { inheritFEK?: boolean }): Promise<void> {
    const doInit = async () => {
      this.baseDir = profileDataDir;
      this.keyFile = path.join(this.baseDir, 'encryption.key');
      this.quotaFile = path.join(this.baseDir, 'storage.quota');
      this.key = null; // Force key reload
      await fs.mkdir(this.baseDir, { recursive: true });
      await this.loadOrGenerateKey();

      // Copy FEK files from root FilarData if missing in this profile
      // (new profile on an existing cloud account should share the FEK).
      // `inheritFEK: false` sert la zone d'attente d'« ajouter un compte » :
      // elle doit rester VIERGE pour que `initHybridCrypto` aille chercher la
      // copie enveloppée du NOUVEAU compte au lieu de trouver celle de l'ancien.
      if (options?.inheritFEK !== false) {
        await this.ensureFEKAvailable(profileDataDir);
      }
    };
    this.initPromise = doInit();
    await this.initPromise;
  }

  /**
   * Déménager la FEK de la zone d'attente vers le profil qui adopte la session.
   *
   * Ne comble que les manques : un profil qui tient déjà sa FEK garde la sienne
   * (elle est enveloppée sous SON mot de passe de coffre, que la personne
   * connaît). Le brut scellé et l'enveloppe sont la même clé de compte, donc
   * combler est sûr — c'est écraser qui ne le serait pas.
   */
  async adoptPendingFEK(pendingDir: string, profileDir: string): Promise<void> {
    for (const filename of ['.fek_safe', 'wrapped_fek.json']) {
      const from = path.join(pendingDir, filename);
      const to = path.join(profileDir, filename);
      const srcExists = await fs.access(from).then(() => true).catch(() => false);
      if (!srcExists) continue;
      const destExists = await fs.access(to).then(() => true).catch(() => false);
      if (destExists) continue;
      await fs.mkdir(profileDir, { recursive: true });
      await fs.copyFile(from, to);
    }
  }

  /**
   * Ensure .fek_safe and wrapped_fek.json exist in the target profile dir.
   * If missing, copies from root FilarData or other profile dirs.
   *
   * PORTÉE AU COMPTE. Ce partage existe pour qu'un profil neuf hérite de la clé
   * du compte déjà installé — vrai tant qu'il n'y a qu'un compte sur la machine.
   * Avec deux comptes, copier « la première FEK trouvée » installe la clé du
   * compte A chez un profil du compte B : ses manifestes deviennent
   * indéchiffrables, la restauration rend zéro, et rien ne le dit. On ne puise
   * donc que chez les profils liés au MÊME compte (et dans le dossier hérité,
   * qui n'a de sens que tant qu'un seul compte existe).
   */
  /**
   * Qui a le droit de prêter sa FEK à ce profil.
   *
   * `singleAccount` rend vrai tant que la machine ne connaît qu'un compte (ou
   * aucun) : on retombe alors EXACTEMENT sur le comportement d'origine, dossier
   * hérité compris. Dès qu'il y en a deux, seuls les profils du même compte
   * comptent — et un profil encore lié à aucun compte ne puise que chez les
   * profils locaux, jamais chez un compte au hasard.
   */
  private fekDonorScope(profileDir: string): { allowedDirs: Set<string>; singleAccount: boolean } {
    const profilesRoot = path.join(app.getPath('userData'), 'FilarData', 'profiles');
    const dirFor = (id: string) =>
      path.resolve(path.join(profilesRoot, id.replace(/[^a-zA-Z0-9\-]/g, '')));
    const target = path.resolve(profileDir);
    const allowedDirs = new Set<string>();

    try {
      const manifest = profileManager.getManifest();
      const emails = new Set(
        manifest.profiles
          .map((p) => p.cloudAccount?.email?.toLowerCase())
          .filter((e): e is string => !!e)
      );
      if (emails.size <= 1) return { allowedDirs, singleAccount: true };

      const targetEmail =
        manifest.profiles.find((p) => dirFor(p.id) === target)?.cloudAccount?.email?.toLowerCase() ??
        null;
      for (const p of manifest.profiles) {
        const email = p.cloudAccount?.email?.toLowerCase() ?? null;
        if (targetEmail ? email === targetEmail : email === null) allowedDirs.add(dirFor(p.id));
      }
      return { allowedDirs, singleAccount: false };
    } catch {
      // Manifeste pas encore chargé (démarrage) : comportement d'origine.
      return { allowedDirs, singleAccount: true };
    }
  }

  private async ensureFEKAvailable(profileDir: string): Promise<void> {
    const rootDir = path.join(app.getPath('userData'), 'FilarData');
    const fekSafe = '.fek_safe';
    const wrappedFek = 'wrapped_fek.json';

    // Check if FEK already exists in this profile
    const hasFekSafe = await fs.access(path.join(profileDir, fekSafe)).then(() => true).catch(() => false);
    const hasWrapped = await fs.access(path.join(profileDir, wrappedFek)).then(() => true).catch(() => false);

    if (hasFekSafe && hasWrapped) return; // Already good

    const { allowedDirs, singleAccount } = this.fekDonorScope(profileDir);

    // Search for FEK in: root dir (mono-compte seulement), then same-account dirs
    const searchDirs = singleAccount ? [rootDir] : [];
    try {
      const profilesDir = path.join(rootDir, 'profiles');
      const profiles = await fs.readdir(profilesDir);
      for (const p of profiles) {
        const pDir = path.join(profilesDir, p);
        const stat = await fs.stat(pDir);
        if (
          stat.isDirectory() &&
          pDir !== profileDir &&
          (singleAccount || allowedDirs.has(path.resolve(pDir)))
        ) {
          searchDirs.push(pDir);
        }
      }
    } catch { /* no profiles dir */ }

    for (const srcDir of searchDirs) {
      const srcFek = path.join(srcDir, fekSafe);
      const srcWrapped = path.join(srcDir, wrappedFek);
      const srcFekExists = await fs.access(srcFek).then(() => true).catch(() => false);
      const srcWrappedExists = await fs.access(srcWrapped).then(() => true).catch(() => false);

      if (srcFekExists && !hasFekSafe) {
        await fs.copyFile(srcFek, path.join(profileDir, fekSafe));
      }
      if (srcWrappedExists && !hasWrapped) {
        await fs.copyFile(srcWrapped, path.join(profileDir, wrappedFek));
      }

      if (srcFekExists || srcWrappedExists) {
        return; // Found a source, done
      }
    }
  }

  /**
   * Returns the current base directory for file storage.
   * Used by hybrid IPC handlers to write/read raw blobs.
   */
  getBaseDir(): string {
    if (!this.baseDir) {
      throw new Error('StorageService not initialized');
    }
    return this.baseDir;
  }

  /**
   * Load or generate encryption key.
   * The key is protected with Electron's safeStorage (DPAPI on Windows,
   * Keychain on macOS, SecretService on Linux). Falls back to raw storage
   * if safeStorage is unavailable and transparently migrates legacy
   * unprotected keys on first load.
   */
  private async loadOrGenerateKey(): Promise<void> {
    const useSafe = safeStorage.isEncryptionAvailable();
    const safeKeyFile = this.keyFile + '.safe';

    try {
      if (useSafe) {
        // Try loading the safeStorage-protected key first
        try {
          const encryptedKey = await fs.readFile(safeKeyFile as string);
          const decrypted = safeStorage.decryptString(encryptedKey);
          this.key = Buffer.from(decrypted, 'base64');
          return;
        } catch {
          // .safe file doesn't exist yet — check for legacy unprotected key
        }

        // Migrate legacy unprotected key if it exists
        try {
          const legacyKey = await fs.readFile(this.keyFile as string);
          this.key = legacyKey;
          // Re-save with safeStorage protection
          const encrypted = safeStorage.encryptString(legacyKey.toString('base64'));
          await fs.writeFile(safeKeyFile as string, encrypted, { mode: 0o600 });
          // Securely wipe the legacy unprotected key file — it contains raw key material
          await secureDeleteFile(this.keyFile as string).catch(() => {});
          return;
        } catch {
          // No legacy key either — generate fresh
        }

        // Generate new key protected with safeStorage
        this.key = crypto.randomBytes(32);
        const encrypted = safeStorage.encryptString(this.key.toString('base64'));
        await fs.writeFile(safeKeyFile as string, encrypted, { mode: 0o600 });
      } else {
        // safeStorage unavailable — fall back to raw file (legacy behavior)
        try {
          this.key = await fs.readFile(this.keyFile as string);
        } catch (error: unknown) {
          if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
            this.key = crypto.randomBytes(32);
            await fs.writeFile(this.keyFile as string, this.key, { mode: 0o600 });
          } else {
            throw error;
          }
        }
      }
    } catch (error) {
      console.error('Error loading encryption key:', error);
      throw error;
    }
  }

  /**
   * Encrypt data (JSON)
   */
  async encrypt(data: any, opts?: { version?: MachineContainerVersion }): Promise<string> {
    // `v3:` — même conteneur, dérivation HKDF (microsecondes au lieu de 265 ms).
    // L'appelant peut imposer la version ; sinon c'est le drapeau qui décide.
    if ((opts?.version ?? machineWriteVersion('all')) === 'v3') {
      await this.initPromise;
      if (!this.key) {
        throw new Error('StorageService not initialized — encryption key not loaded');
      }
      return sealMachineV3Text(this.key, JSON.stringify(data));
    }
    // Wait for any pending initialization to complete before encrypting
    await this.initPromise;
    if (!this.key) {
      throw new Error('StorageService not initialized — encryption key not loaded');
    }
    const iv = crypto.randomBytes(this.ivLength);
    const salt = crypto.randomBytes(this.saltLength);

    return new Promise((resolve, reject) => {
      crypto.pbkdf2(this.key as Buffer, salt, this.iterationCount, this.keyLength, 'sha512', (err, derivedKey) => {
        if (err) {
          reject(err);
          return;
        }
        try {
          const cipher = crypto.createCipheriv(this.algorithm, derivedKey, iv) as crypto.CipherGCM;
          const encrypted = Buffer.concat([
            cipher.update(JSON.stringify(data), 'utf8'),
            cipher.final()
          ]).toString('hex');
          const tag = cipher.getAuthTag();
          // Add version marker to encrypted data
          const encryptedWithVersion = this.ENCRYPTION_VERSION_2 + salt.toString('hex') + iv.toString('hex') + encrypted + tag.toString('hex');
          resolve(encryptedWithVersion);
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  /**
   * Encrypt a JSON-serializable value straight to disk, producing the exact
   * same `v2:` hex container as `encrypt()`.
   *
   * Why this exists: `encrypt()` materializes the whole ciphertext as one hex
   * string (two chars per byte) and then concatenates the container around it.
   * For a large payload that is the serialized JSON, plus a Buffer of it, plus
   * a hex string at double the size, plus the concatenation — roughly five
   * times the data alive at once. On a bulk import that is enough to abort the
   * process, and an out-of-memory abort cannot be caught or logged.
   *
   * Here the hex goes to the file handle as the cipher produces it, so peak
   * memory is the serialized JSON plus one chunk.
   *
   * The output is byte-for-byte what `encrypt()` would have written: the `v2:`
   * container is read by the mobile app and pinned by the interop golden
   * vectors, so it must not drift. Written via a temp file and renamed, since
   * the write is no longer a single call and a crash mid-write must not leave
   * a truncated database behind.
   *
   * Le temporaire est UNIQUE (pid + compteur + horodatage) : il était au chemin
   * fixe `${filePath}.tmp`, donc deux écritures simultanées du MÊME fichier
   * (l'auto-save des notes et la fusion du cycle de sync) écrivaient dans le
   * même temporaire et publiaient un container composite indéchiffrable. Un
   * verrou couvre déjà `notes.enc` (sync/notesLock), mais l'unicité vaut pour
   * tout appelant. Le suffixe reste `.tmp` (les scans le filtrent déjà) et le
   * temporaire est effacé si l'écriture échoue.
   */
  async encryptToFile(
    data: any,
    filePath: string,
    opts?: { version?: MachineContainerVersion }
  ): Promise<void> {
    await this.initPromise;
    if (!this.key) {
      throw new Error('StorageService not initialized — encryption key not loaded');
    }

    // `v3:` = même disposition, dérivation HKDF (voir machineContainerV3.ts).
    // Tout le reste de l'écriture — flux hex, temporaire, renommage — est commun.
    const version = opts?.version ?? machineWriteVersion('all');
    const marker = version === 'v3' ? this.ENCRYPTION_VERSION_3 : this.ENCRYPTION_VERSION_2;

    const iv = crypto.randomBytes(this.ivLength);
    const salt = crypto.randomBytes(this.saltLength);

    const derivedKey =
      version === 'v3'
        ? deriveMachineKeyV3(this.key, salt)
        : await new Promise<Buffer>((resolve, reject) => {
            crypto.pbkdf2(
              this.key as Buffer,
              salt,
              this.iterationCount,
              this.keyLength,
              'sha512',
              (err, dk) => (err ? reject(err) : resolve(dk))
            );
          });

    const cipher = crypto.createCipheriv(this.algorithm, derivedKey, iv) as crypto.CipherGCM;
    const json = JSON.stringify(data);
    /** Source characters per cipher update. */
    const CHUNK = 1024 * 1024;

    const tmpPath = `${filePath}.${process.pid}-${++encryptToFileSeq}-${Date.now().toString(36)}.tmp`;
    try {
      const handle = await fs.open(tmpPath, 'w');
      try {
        await handle.write(
          marker + salt.toString('hex') + iv.toString('hex'),
          null,
          'utf8'
        );

        let offset = 0;
        while (offset < json.length) {
          let end = Math.min(offset + CHUNK, json.length);
          // Never split a surrogate pair: utf8-encoding a lone surrogate is
          // lossy, and notes are full of emoji. Push the orphan to the next chunk.
          if (end < json.length) {
            const lastUnit = json.charCodeAt(end - 1);
            if (lastUnit >= 0xd800 && lastUnit <= 0xdbff) end -= 1;
          }
          const encrypted = cipher.update(json.slice(offset, end), 'utf8');
          if (encrypted.length > 0) {
            await handle.write(encrypted.toString('hex'), null, 'utf8');
          }
          offset = end;
        }

        const final = cipher.final();
        if (final.length > 0) {
          await handle.write(final.toString('hex'), null, 'utf8');
        }
        await handle.write(cipher.getAuthTag().toString('hex'), null, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }

      await fs.rename(tmpPath, filePath);
    } catch (err) {
      // Le temporaire n'est plus réutilisé par l'appel suivant (nom unique) :
      // sans ce nettoyage, un échec en laisserait un derrière lui à chaque fois.
      await fs.unlink(tmpPath).catch(() => undefined);
      throw err;
    }
  }

  /**
   * Decrypt data (JSON)
   */
  async decrypt(encryptedData: string): Promise<any> {
    // Wait for any pending initialization to complete before decrypting
    await this.initPromise;
    if (!this.key) {
      throw new Error('StorageService not initialized — encryption key not loaded');
    }
    // Check for version marker
    if (encryptedData.startsWith(this.ENCRYPTION_VERSION_3)) {
      // v3 : HKDF, même disposition — lue quel que soit le drapeau d'écriture
      return JSON.parse(openMachineV3Text(this.key, encryptedData).toString('utf8'));
    }
    if (encryptedData.startsWith(this.ENCRYPTION_VERSION_2)) {
      // New format with 600k iterations
      return await this.decryptV2(encryptedData.substring(this.ENCRYPTION_VERSION_2.length));
    } else if (encryptedData.startsWith(this.ENCRYPTION_VERSION_1)) {
      // Legacy format with 10k iterations, needs migration
      return await this.decryptV1(encryptedData.substring(this.ENCRYPTION_VERSION_1.length));
    } else {
      // No version marker = legacy data (10k iterations)
      // Try new method first, then fallback to legacy
      try {
        return await this.decryptV2(encryptedData);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        // Fallback to legacy decryption
        return await this.decryptV1(encryptedData);
      }
    }
  }

  /**
   * Decrypt with v2 (600k iterations)
   */
  private async decryptV2(encryptedData: string): Promise<any> {
    // Minimum length: salt(32) + iv(32) + tag(32) + at least 2 hex chars of data
    const minLen = (this.saltLength + this.ivLength + this.tagLength) * 2 + 2;
    if (!encryptedData || encryptedData.length < minLen) {
      throw new Error(`Encrypted data too short (${encryptedData?.length ?? 0} chars, need at least ${minLen})`);
    }

    const salt = Buffer.from(encryptedData.slice(0, this.saltLength * 2), 'hex');
    const iv = Buffer.from(encryptedData.slice(this.saltLength * 2, (this.saltLength + this.ivLength) * 2), 'hex');
    const tag = Buffer.from(encryptedData.slice(-this.tagLength * 2), 'hex');
    const encrypted = encryptedData.slice((this.saltLength + this.ivLength) * 2, -this.tagLength * 2);

    if (iv.length !== this.ivLength) {
      throw new Error(`Invalid IV length: ${iv.length} (expected ${this.ivLength})`);
    }

    return new Promise((resolve, reject) => {
      crypto.pbkdf2(this.key as Buffer, salt, this.iterationCount, this.keyLength, 'sha512', (err, derivedKey) => {
        if (err) {
          reject(err);
          return;
        }
        try {
          const decipher = crypto.createDecipheriv(this.algorithm, derivedKey, iv) as crypto.DecipherGCM;
          decipher.setAuthTag(tag);
          const decrypted = Buffer.concat([
            decipher.update(Buffer.from(encrypted, 'hex')),
            decipher.final()
          ]).toString('utf8');
          resolve(JSON.parse(decrypted));
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  /**
   * Decrypt with v1 (10k iterations - legacy)
   */
  private async decryptV1(encryptedData: string): Promise<any> {
    const minLen = (this.saltLength + this.ivLength + this.tagLength) * 2 + 2;
    if (!encryptedData || encryptedData.length < minLen) {
      throw new Error(`Encrypted data too short for v1 (${encryptedData?.length ?? 0} chars, need at least ${minLen})`);
    }

    const salt = Buffer.from(encryptedData.slice(0, this.saltLength * 2), 'hex');
    const iv = Buffer.from(encryptedData.slice(this.saltLength * 2, (this.saltLength + this.ivLength) * 2), 'hex');
    const tag = Buffer.from(encryptedData.slice(-this.tagLength * 2), 'hex');
    const encrypted = encryptedData.slice((this.saltLength + this.ivLength) * 2, -this.tagLength * 2);

    if (iv.length !== this.ivLength) {
      throw new Error(`Invalid IV length: ${iv.length} (expected ${this.ivLength})`);
    }

    return new Promise((resolve, reject) => {
      crypto.pbkdf2(this.key as Buffer, salt, this.legacyIterationCount, this.keyLength, 'sha512', (err, derivedKey) => {
        if (err) {
          reject(err);
          return;
        }
        try {
          const decipher = crypto.createDecipheriv(this.algorithm, derivedKey, iv) as crypto.DecipherGCM;
          decipher.setAuthTag(tag);
          const decrypted = Buffer.concat([
            decipher.update(Buffer.from(encrypted, 'hex')),
            decipher.final()
          ]).toString('utf8');
          resolve(JSON.parse(decrypted));
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  /**
   * Encrypt binary data (Buffer)
   */
  async encryptBinary(data: Buffer, opts?: { version?: MachineContainerVersion }): Promise<Buffer> {
    if ((opts?.version ?? machineWriteVersion('all')) === 'v3') {
      if (!this.key) {
        throw new Error('StorageService not initialized — encryption key not loaded');
      }
      return sealMachineV3Bytes(this.key, data);
    }
    const iv = crypto.randomBytes(this.ivLength);
    const salt = crypto.randomBytes(this.saltLength);

    return new Promise((resolve, reject) => {
      crypto.pbkdf2(this.key as Buffer, salt, this.iterationCount, this.keyLength, 'sha512', (err, derivedKey) => {
        if (err) {
          reject(err);
          return;
        }
        try {
          const cipher = crypto.createCipheriv(this.algorithm, derivedKey, iv) as crypto.CipherGCM;
          const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
          const tag = cipher.getAuthTag();
          // Add version marker as prefix
          const versionMarker = Buffer.from(this.ENCRYPTION_VERSION_2, 'utf8');
          resolve(Buffer.concat([versionMarker, salt, iv, encrypted, tag]));
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  /**
   * Decrypt binary data (Buffer)
   */
  async decryptBinary(encryptedData: Buffer): Promise<Buffer> {
    // Check for version marker
    const v3Marker = Buffer.from(this.ENCRYPTION_VERSION_3, 'utf8');
    const v2Marker = Buffer.from(this.ENCRYPTION_VERSION_2, 'utf8');
    const v1Marker = Buffer.from(this.ENCRYPTION_VERSION_1, 'utf8');

    if (encryptedData.slice(0, v3Marker.length).equals(v3Marker)) {
      // v3 : HKDF, même disposition — lue quel que soit le drapeau d'écriture
      if (!this.key) {
        throw new Error('StorageService not initialized — encryption key not loaded');
      }
      return openMachineV3Bytes(this.key, encryptedData);
    }
    if (encryptedData.slice(0, v2Marker.length).equals(v2Marker)) {
      // New format with 600k iterations
      return await this.decryptBinaryV2(encryptedData.slice(v2Marker.length));
    } else if (encryptedData.slice(0, v1Marker.length).equals(v1Marker)) {
      // Legacy format with 10k iterations
      return await this.decryptBinaryV1(encryptedData.slice(v1Marker.length));
    } else {
      // No version marker = legacy data
      try {
        return await this.decryptBinaryV2(encryptedData);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return await this.decryptBinaryV1(encryptedData);
      }
    }
  }

  /**
   * Decrypt binary with v2 (600k iterations)
   */
  private async decryptBinaryV2(encryptedData: Buffer): Promise<Buffer> {
    const salt = encryptedData.slice(0, this.saltLength);
    const iv = encryptedData.slice(this.saltLength, this.saltLength + this.ivLength);
    const tag = encryptedData.slice(-this.tagLength);
    const encrypted = encryptedData.slice(this.saltLength + this.ivLength, -this.tagLength);

    return new Promise((resolve, reject) => {
      crypto.pbkdf2(this.key as Buffer, salt, this.iterationCount, this.keyLength, 'sha512', (err, derivedKey) => {
        if (err) {
          console.error('Error deriving key:', err);
          reject(err);
          return;
        }
        try {
          const decipher = crypto.createDecipheriv(this.algorithm, derivedKey, iv) as crypto.DecipherGCM;
          decipher.setAuthTag(tag);
          const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
          resolve(decrypted);
        } catch (e) {
          console.error('Error decrypting:', e);
          reject(e);
        }
      });
    });
  }

  /**
   * Decrypt binary with v1 (10k iterations - legacy)
   */
  private async decryptBinaryV1(encryptedData: Buffer): Promise<Buffer> {
    const salt = encryptedData.slice(0, this.saltLength);
    const iv = encryptedData.slice(this.saltLength, this.saltLength + this.ivLength);
    const tag = encryptedData.slice(-this.tagLength);
    const encrypted = encryptedData.slice(this.saltLength + this.ivLength, -this.tagLength);

    return new Promise((resolve, reject) => {
      crypto.pbkdf2(this.key as Buffer, salt, this.legacyIterationCount, this.keyLength, 'sha512', (err, derivedKey) => {
        if (err) {
          console.error('Error deriving key:', err);
          reject(err);
          return;
        }
        try {
          const decipher = crypto.createDecipheriv(this.algorithm, derivedKey, iv) as crypto.DecipherGCM;
          decipher.setAuthTag(tag);
          const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
          resolve(decrypted);
        } catch (e) {
          console.error('Error decrypting:', e);
          reject(e);
        }
      });
    });
  }

  // ── V3 chunked streaming format (streamCrypto.ts) ─────────────────────────
  // Thin wrappers so the master key never leaves this service. All of them
  // await initPromise and snapshot the key up front, so a profile switch
  // mid-transfer cannot mix keys.

  /**
   * Returns the master key after waiting for any pending (re)initialization.
   * The returned Buffer is a snapshot reference — safe to use for the whole
   * duration of a streaming operation even if the profile switches meanwhile.
   */
  private async getMasterKey(): Promise<Buffer> {
    await this.initPromise;
    if (!this.key) {
      throw new Error('StorageService not initialized — encryption key not loaded');
    }
    return this.key;
  }

  /** True when the on-disk file starts with the V3 magic. */
  async isV3VaultFile(filePath: string): Promise<boolean> {
    return isV3File(filePath);
  }

  /**
   * Message d'un refus d'enregistrer : on sait que le fichier est un conteneur
   * V3, mais aucune clé disponible ne l'ouvre. Écrire quand même le
   * dégraderait, silencieusement et sans retour possible.
   */
  public readonly V3_ERR_NO_KEY: string =
    "Ce fichier est chiffre sous une cle qui n'est pas chargee : enregistrement refuse pour ne pas le degrader";

  /**
   * QUELLE CLÉ OUVRE CE CONTENEUR V3 — ou aucune.
   *
   * L'en-tête ne suffit PAS à trancher : il se lit sans la bonne clé. Seule
   * l'authentification GCM d'un chunk le prouve, d'où la lecture d'un octet —
   * elle déchiffre le premier chunk (8 Mio au plus) et rien de plus.
   *
   * L'ordre reprend celui de la lecture (`decryptFileAuto`) : clé machine
   * d'abord, puis les clés de compte, pour que le cas ordinaire ne paie qu'un
   * essai.
   */
  private async v3KeyFor(filePath: string): Promise<Buffer | null> {
    const essayer = async (cle: Buffer): Promise<boolean> => {
      let lecteur: Awaited<ReturnType<typeof V3FileReader.open>> | null = null;
      try {
        lecteur = await V3FileReader.open(cle, filePath);
        // Un fichier VIDE n'a aucun chunk à authentifier : l'en-tête a déjà
        // été validé par `open`, on ne peut pas en demander plus.
        if (lecteur.origSize > 0) await lecteur.read(0, 1);
        return true;
      } catch {
        return false;
      } finally {
        await lecteur?.close().catch(() => undefined);
      }
    };

    try {
      const machine = await this.getMasterKey();
      if (await essayer(machine)) return machine;
    } catch {
      // Clé machine indisponible (service non initialisé) : on tente quand même
      // les clés de compte plutôt que d'abandonner.
    }
    for (const candidate of await this.accountKeyCandidates()) {
      if (await essayer(candidate)) return candidate;
    }
    return null;
  }

  /**
   * Écrire des octets EN PRÉSERVANT LE CONTENEUR D'ORIGINE.
   *
   * ── CE QUE ÇA RÉPARE ──────────────────────────────────────────────────────
   * `saveEncryptedFile` faisait `encryptBinary` puis `fs.writeFile`, sans
   * JAMAIS regarder ce qu'il écrasait. Les deux chemins de lecture, eux,
   * reconnaissent le V3 et refusent explicitement de le migrer (« NEVER
   * migrate them »). Éditer un fichier V3 le réécrivait donc en v2 monobloc
   * sous la clé MACHINE : il cessait d'être portable, redevenait soumis au
   * plafond de 500 Mo, et perdait le découpage qui permet de le lire sans le
   * charger entier. Une perte de FONCTION, invisible, que rien n'annonçait.
   *
   * ── LA RÈGLE ──────────────────────────────────────────────────────────────
   * Un conteneur V3 est réécrit en V3, sous LA MÊME CLÉ que celle qui l'ouvre.
   * Si aucune clé disponible ne l'ouvre, on REFUSE d'enregistrer. Un refus
   * visible est réparable — l'utilisateur déverrouille et recommence ; une
   * dégradation silencieuse ne l'est pas.
   */
  async saveBinaryPreservingContainer(filePath: string, plaintext: Buffer): Promise<void> {
    const etaitV3 = await isV3File(filePath).catch(() => false);
    if (!etaitV3) {
      await fs.writeFile(filePath, await this.encryptBinary(plaintext));
      return;
    }

    const cle = await this.v3KeyFor(filePath);
    if (!cle) throw new Error(this.V3_ERR_NO_KEY);

    // Écriture À CÔTÉ puis renommage : une écriture V3 interrompue en place
    // laisserait un conteneur tronqué, c'est-à-dire un fichier perdu. Le
    // renommage est atomique sur le même volume.
    const tmp = `${filePath}.${process.pid.toString(36)}.tmp`;
    try {
      await encryptBufferToFileV3(cle, plaintext, tmp);
      await fs.rename(tmp, filePath);
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Header-only probe: returns the plaintext size of a V3 file without
   * decrypting anything, or null when the file is not V3. Throws the French
   * corrupt-file error when the V3 magic is present but the header is invalid.
   */
  async getV3OrigSize(filePath: string): Promise<number | null> {
    const handle = await fs.open(filePath, 'r');
    try {
      const head = Buffer.alloc(50);
      const { bytesRead } = await handle.read(head, 0, 50, 0);
      if (!isV3Buffer(head.subarray(0, bytesRead))) {
        return null;
      }
      return readV3HeaderSync(head.subarray(0, bytesRead)).origSize;
    } finally {
      await handle.close().catch(() => {});
    }
  }

  /**
   * Stream-encrypts a plaintext file into the vault in V3 format with flat
   * memory (8 MiB chunks). Progress reports plaintext bytes done/total.
   *
   * Stage-then-rename: encryptFileToFileV3 truncates its dest on open and
   * unlinks it on failure, which must never destroy a pre-existing vault
   * file at destPath (the openEncryptedFile edit-watcher and re-imports
   * overwrite in place — e.g. a short read of a temp file still being
   * written by the editor). Encrypting to a sibling temp name keeps the
   * original ciphertext intact until the new one is fully written, then
   * the rename swaps it in.
   */
  async saveEncryptedFileFromPathV3(
    srcPath: string,
    destPath: string,
    onProgress?: (doneBytes: number, totalBytes: number) => void
  ): Promise<{ origSize: number }> {
    const masterKey = await this.getMasterKey();
    const stagedPath = `${destPath}.v3staging-${crypto.randomBytes(6).toString('hex')}`;
    try {
      const result = await encryptFileToFileV3(masterKey, srcPath, stagedPath, onProgress);
      await fs.rename(stagedPath, destPath);
      return result;
    } catch (error) {
      // encryptFileToFileV3 already unlinks the staged file on its own
      // failures; this covers a failed rename.
      await fs.unlink(stagedPath).catch(() => {});
      throw error;
    }
  }

  /**
   * Decrypts an on-disk vault file into memory, auto-detecting the format.
   * V3 files are chunk-verified and capped at V3_PREVIEW_MAX_BYTES (French
   * error beyond that); V1/V2 blobs go through the existing decryptBinary
   * exactly as before.
   */
  async decryptFileAuto(srcPath: string): Promise<Buffer> {
    const masterKey = await this.getMasterKey();
    if (await isV3File(srcPath)) {
      try {
        return await decryptFileToBufferV3(masterKey, srcPath, this.V3_PREVIEW_MAX_BYTES);
      } catch (error) {
        // Session-FEK container (hybrid large file)? A wrong key fails GCM
        // on chunk 0 (cheap), so retrying with the account FEK costs nothing
        // for genuine machine-key files. Only the corrupt error retries —
        // the size-cap error would just re-fail.
        const message = error instanceof Error ? error.message : '';
        if (message === this.V3_ERR_CORRUPT) {
          // La clé entrante entre ici À LA MÊME PLACE que la FEK : pendant la
          // fenêtre de migration, le contenu descendu du compte n'ouvre que
          // sous elle (rien n'est re-scellé localement — règle C1).
          for (const candidate of await this.accountKeyCandidates()) {
            try {
              return await decryptFileToBufferV3(candidate, srcPath, this.V3_PREVIEW_MAX_BYTES);
            } catch {
              // Mauvaise clé (tag GCM) — candidate suivante.
            }
          }
        }
        throw error;
      }
    }
    const blob = await fs.readFile(srcPath);
    try {
      return await this.decryptBinary(blob);
    } catch (error) {
      // A tampered V3 file (e.g. stripped magic) falls through to the legacy
      // pipeline and fails GCM auth with a raw English Node error — map it to
      // the user-facing French message. Original error already logged above.
      console.error('decryptFileAuto: legacy decrypt failed:', error);
      throw new Error(this.V3_ERR_CORRUPT);
    }
  }

  /**
   * Decrypts an on-disk vault file to a destination file, auto-detecting the
   * format. V3 streams chunk-by-chunk (flat memory); V1/V2 decrypts the whole
   * blob then writes it (legacy blobs are <= 500 MB by construction).
   */
  async decryptFileToFileAuto(
    srcPath: string,
    destPath: string,
    onProgress?: (doneBytes: number, totalBytes: number) => void
  ): Promise<void> {
    const masterKey = await this.getMasterKey();
    if (await isV3File(srcPath)) {
      // Same machine-key-then-FEK strategy as decryptFileAuto: hybrid V3-FEK
      // blobs (large synced files) export through this path too. La clé
      // entrante suit la FEK pendant une migration (voir `incomingReadKey`).
      const key =
        (await this.selectV3Key(srcPath, [masterKey, ...(await this.accountKeyCandidates())])) ??
        masterKey;
      await decryptFileToFileV3(key, srcPath, destPath, onProgress);
      return;
    }
    const blob = await fs.readFile(srcPath);
    let plain: Buffer;
    try {
      plain = await this.decryptBinary(blob);
    } catch (error) {
      console.error('decryptFileToFileAuto: legacy decrypt failed:', error);
      throw new Error(this.V3_ERR_CORRUPT);
    }
    await fs.writeFile(destPath, plain);
    if (onProgress) {
      onProgress(plain.length, plain.length);
    }
  }

  /**
   * Re-encrypts a vault file to a new location with fresh key material
   * (copy/duplicate flows). Never writes plaintext to disk:
   *  - V3 source  -> chunk-by-chunk transcode in RAM (reencryptFileV3);
   *  - V1/V2 blob -> decrypt in RAM then write as V3 (copies upgrade to V3);
   *  - any other container (e.g. FEK-encrypted hybrid blob, unmarked legacy)
   *    -> verbatim ciphertext copy, preserving today's behavior.
   */
  async reencryptFileAuto(srcPath: string, destPath: string): Promise<void> {
    const masterKey = await this.getMasterKey();
    if (await isV3File(srcPath)) {
      await reencryptFileV3(masterKey, srcPath, destPath);
      return;
    }
    const blob = await fs.readFile(srcPath);
    const v3Marker = Buffer.from(this.ENCRYPTION_VERSION_3, 'utf8');
    const v2Marker = Buffer.from(this.ENCRYPTION_VERSION_2, 'utf8');
    const v1Marker = Buffer.from(this.ENCRYPTION_VERSION_1, 'utf8');
    if (
      blob.subarray(0, v3Marker.length).equals(v3Marker) ||
      blob.subarray(0, v2Marker.length).equals(v2Marker) ||
      blob.subarray(0, v1Marker.length).equals(v1Marker)
    ) {
      let plain: Buffer;
      try {
        plain = await this.decryptBinary(blob);
      } catch (error) {
        console.error('reencryptFileAuto: legacy decrypt failed:', error);
        throw new Error(this.V3_ERR_CORRUPT);
      }
      await encryptBufferToFileV3(masterKey, plain, destPath);
      return;
    }
    // Unknown container: copy ciphertext verbatim (still decryptable by its
    // own pipeline; V3 headers travel with the file so this is always safe).
    await fs.copyFile(srcPath, destPath);
  }

  /**
   * Format/size probe for streaming consumers (protocol handler, ZIP export).
   * V3: validates header + total length and returns the exact plaintext size
   * without decrypting anything. Legacy: plaintext size is unknowable without
   * a full decrypt, so only the encrypted on-disk size is reported.
   */
  async statDecryptedAuto(srcPath: string): Promise<
    | { format: 'v3'; plainSize: number; encryptedSize: number }
    | { format: 'legacy'; plainSize: null; encryptedSize: number }
  > {
    if (await isV3File(srcPath)) {
      const v3 = await statV3File(srcPath);
      return { format: 'v3', plainSize: v3.origSize, encryptedSize: v3.encryptedSize };
    }
    const { size } = await fs.stat(srcPath);
    return { format: 'legacy', plainSize: null, encryptedSize: size };
  }

  /**
   * Returns a plaintext Readable over a vault file, auto-detecting the
   * format. The master key never leaves this service.
   *  - V3: chunk-streamed with flat memory (8 MiB at a time), every emitted
   *    byte GCM-verified; optional [offset, offset+length) plaintext range
   *    decrypts only the chunks it overlaps.
   *  - Legacy V1/V2: whole-blob decrypt in RAM (capped at
   *    LEGACY_STREAM_MAX_BYTES) then wrapped in a Readable; a range is
   *    honored by slicing the buffer.
   */
  async createDecryptStreamAuto(
    srcPath: string,
    range?: { offset: number; length?: number }
  ): Promise<Readable> {
    const masterKey = await this.getMasterKey();
    if (await isV3File(srcPath)) {
      // Two V3 key models coexist on disk: machine-key containers (local
      // mode) and session-FEK containers (hybrid large files). Probe chunk 0
      // to pick the right key — a wrong key fails the GCM tag, never
      // produces garbage. Falls back to the machine key so an actually
      // corrupt file still surfaces the standard French error downstream.
      // Pendant une migration, la clé entrante est une candidate de plus.
      const key =
        (await this.selectV3Key(srcPath, [masterKey, ...(await this.accountKeyCandidates())])) ??
        masterKey;
      return createDecryptReadStreamV3(
        key,
        srcPath,
        range ? { offset: range.offset, length: range.length } : undefined
      );
    }
    const { size } = await fs.stat(srcPath);
    if (size > this.LEGACY_STREAM_MAX_BYTES + 4096) {
      throw new Error('Fichier trop volumineux pour la lecture en continu (format herite, max 500 Mo)');
    }
    const blob = await fs.readFile(srcPath);
    let plain: Buffer;
    try {
      plain = await this.decryptBinary(blob);
    } catch (error) {
      console.error('createDecryptStreamAuto: legacy decrypt failed:', error);
      throw new Error(this.V3_ERR_CORRUPT);
    }
    let out = plain;
    if (range) {
      if (!Number.isSafeInteger(range.offset) || range.offset < 0 ||
          (range.length !== undefined && (!Number.isSafeInteger(range.length) || range.length < 0))) {
        throw new Error('Plage de lecture invalide');
      }
      const start = Math.min(range.offset, plain.length);
      const end = range.length === undefined ? plain.length : Math.min(start + range.length, plain.length);
      out = plain.subarray(start, end);
    }
    return Readable.from([out], { objectMode: false });
  }

  /**
   * Plaintext Readable over a vault file for "Déplacer dans le coffre"
   * VERIFICATION. Covers every container the import pipeline can produce:
   *  - V3 (machine-key or session-FEK) and legacy machine-key V1/V2 via
   *    createDecryptStreamAuto;
   *  - renderer-encrypted hybrid FEK blobs (hybridCrypto.encryptFileContent:
   *    marker||IV||GCM, optional deflate) — the format hybrid profiles use
   *    for every file below the streaming threshold, which
   *    createDecryptStreamAuto cannot read.
   * Wrong key / unknown format throws — the caller then fails verification
   * and PRESERVES the original plaintext file.
   */
  async createVerifyDecryptStream(srcPath: string): Promise<Readable> {
    try {
      return await this.createDecryptStreamAuto(srcPath);
    } catch (primaryError) {
      const { size } = await fs.stat(srcPath);
      if (size > this.LEGACY_STREAM_MAX_BYTES + 4096) throw primaryError;
      // getFekRawForSync returns an owned copy (session key first, then
      // .fek_safe) — zeroized below once the plaintext buffer exists.
      const fek = await this.getFekRawForSync();
      if (!fek) throw primaryError;
      try {
        const blob = await fs.readFile(srcPath);
        // Les clés retirées suivent la FEK : un blob écrit AVANT une bascule
        // n'ouvre que sous elles, et l'échec de vérification qui s'ensuivrait
        // ferait perdre le clair d'origine à l'appelant.
        const plain = decryptHybridFekBlob(blob, [fek, ...this.retiredReadKeys]);
        return Readable.from([plain], { objectMode: false });
      } catch {
        throw primaryError;
      } finally {
        fek.fill(0);
      }
    }
  }

  // ── V3-FEK hybrid blobs (session key handed over by the renderer) ─────────
  //
  // Hybrid (synced) profiles encrypt file content with the account-wide FEK,
  // NOT the machine-local this.key — machine-key blobs are not portable
  // across devices. Large hybrid files are stored as V3 containers keyed by
  // the SESSION FEK (see sessionKeyStore.ts): flat-memory streaming AND
  // cross-device portability. The FEK never touches disk here — it lives in
  // renderer memory, in sessionKeyStore (main memory) and in .fek_safe
  // (safeStorage-sealed, written by hybrid:storeFEK only).

  /**
   * Stream-encrypts a plaintext file into the vault as a V3 container keyed
   * by the session FEK (portable hybrid blob). Same stage-then-rename
   * contract as saveEncryptedFileFromPathV3 — a pre-existing blob at
   * destPath survives any failure. Throws the French locked error when no
   * session key is loaded.
   */
  async saveEncryptedFileFromPathFEK(
    srcPath: string,
    destPath: string,
    onProgress?: (doneBytes: number, totalBytes: number) => void
  ): Promise<{ origSize: number }> {
    // Defensive COPY of the session key: clearSessionKey() zeroizes the
    // backing Buffer in place, and the HKDF file-key derivation only happens
    // after a few awaits inside encryptFileToFileV3 — a lock/profile-switch
    // landing in that window would otherwise key the container with zeroed
    // bytes and write an undecryptable blob while reporting success.
    const fek = Buffer.from(getSessionKey());
    const stagedPath = `${destPath}.v3staging-${crypto.randomBytes(6).toString('hex')}`;
    try {
      const result = await encryptFileToFileV3(fek, srcPath, stagedPath, onProgress);
      await fs.rename(stagedPath, destPath);
      return result;
    } catch (error) {
      // encryptFileToFileV3 already unlinks the staged file on its own
      // failures; this covers a failed rename.
      await fs.unlink(stagedPath).catch(() => {});
      throw error;
    } finally {
      fek.fill(0);
    }
  }

  /**
   * Probes chunk 0 of a V3 file against each candidate key (GCM tag check)
   * and returns the first that authenticates, or null. ≤ 8 MiB read per
   * candidate — used to disambiguate machine-key vs FEK-keyed containers.
   */
  private async selectV3Key(srcPath: string, candidates: Buffer[]): Promise<Buffer | null> {
    for (const candidate of candidates) {
      try {
        const reader = await V3FileReader.open(candidate, srcPath);
        try {
          await reader.read(0, 1);
          return candidate;
        } finally {
          await reader.close();
        }
      } catch {
        // Wrong key (or corrupt file) — try the next candidate.
      }
    }
    return null;
  }

  /**
   * Decrypts a V3-FEK hybrid blob into memory with the session FEK (chunk
   * GCM-verified, capped at V3_PREVIEW_MAX_BYTES — French error beyond).
   * Throws the French locked error when no session key is loaded.
   * Compat: a profile switched from local to hybrid mode still holds
   * machine-key V3 files — those fall back to the machine key instead of
   * failing (and are NEVER deleted as "stale cache").
   */
  async decryptV3FileWithSessionFEK(srcPath: string): Promise<Buffer> {
    // Copy for the same reason as saveEncryptedFileFromPathFEK: a lock
    // mid-read zeroizes the live Buffer and would surface as a misleading
    // "fichier corrompu" GCM failure instead of completing the in-flight read.
    const fek = Buffer.from(getSessionKey());
    try {
      if (!(await isV3File(srcPath))) {
        throw new Error(this.V3_ERR_CORRUPT);
      }
      const candidates: Buffer[] = [fek];
      if (this.key) candidates.push(this.key);
      if (this.incomingReadKey) candidates.push(this.incomingReadKey);
      // Contenu antérieur à une bascule de clé : il dort encore sous l'ancienne.
      candidates.push(...this.retiredReadKeys);
      const key = (await this.selectV3Key(srcPath, candidates)) ?? fek;
      return await decryptFileToBufferV3(key, srcPath, this.V3_PREVIEW_MAX_BYTES);
    } finally {
      fek.fill(0);
    }
  }

  /**
   * Raw FEK bytes for sync-side probes: prefer the session key (always right
   * for the ACTIVE session — including a decoy unlock, where .fek_safe still
   * holds the real profile's key), fall back to .fek_safe for background
   * sync cycles that run before the renderer pushed the session key.
   */
  private async getFekRawForSync(): Promise<Buffer | null> {
    // Copy: the live session Buffer is zeroized in place on lock — a probe
    // or export in flight at that moment must keep the stable key it started
    // with (or fail GCM cleanly), never read half-zeroed key bytes. A wrong
    // probe outcome would pin a portable file as local_only in the manifest.
    const session = peekSessionKey();
    if (session) return Buffer.from(session);
    return this.loadFEKRawBytes();
  }

  /**
   * Raw 32-byte account FEK for block-level delta sync (HKDF ikm + V3-FEK
   * read/write of the portable blob). Same session-first-then-.fek_safe source
   * as the sync probes; throws the French locked error when no key is available
   * so deltaSync aborts cleanly without a partial commit. The returned Buffer
   * is a copy the caller owns (zeroize when done).
   */
  async getFekForDeltaSync(): Promise<Buffer> {
    const fek = await this.getFekRawForSync();
    if (!fek) {
      throw new Error('Coffre verrouille - reessayez apres deverrouillage');
    }
    return fek;
  }

  /**
   * Reads .fek_safe (same candidate paths as loadFEKForPairing) and returns
   * the raw FEK bytes, or null when absent/unavailable. Never logs the key.
   */
  private async loadFEKRawBytes(): Promise<Buffer | null> {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        return null;
      }
      const candidates = [
        this.baseDir ? path.join(this.baseDir, '.fek_safe') : null,
        path.join(app.getPath('userData'), 'FilarData', '.fek_safe'),
      ].filter(Boolean) as string[];
      let encrypted: Buffer | null = null;
      for (const fekPath of candidates) {
        encrypted = await fs.readFile(fekPath).catch(() => null);
        if (encrypted) break;
      }
      if (!encrypted) {
        return null;
      }
      const base64 = safeStorage.decryptString(encrypted);
      return Buffer.from(base64, 'base64');
    } catch (error) {
      console.error('[StorageService] loadFEKRawBytes error:', error);
      return null;
    }
  }

  /**
   * True when the file is a V3 container decryptable with the account FEK —
   * i.e. a PORTABLE hybrid blob that is safe to sync across devices.
   * Machine-key V3 files fail the GCM authentication and return false.
   * Costs one chunk read + decrypt (≤ 8 MiB) — only call it for files that
   * actually need the portability decision (oversized sync candidates).
   */
  async isPortableV3File(filePath: string): Promise<boolean> {
    try {
      if (!(await isV3File(filePath))) {
        return false;
      }
      const fek = await this.getFekRawForSync();
      if (!fek) {
        return false;
      }
      const reader = await V3FileReader.open(fek, filePath);
      try {
        // Decrypts + GCM-verifies chunk 0 — cryptographic proof the FEK is
        // the right key (a wrong key fails the tag check).
        await reader.read(0, 1);
        return true;
      } finally {
        await reader.close();
      }
    } catch {
      return false;
    }
  }

  /**
   * True when a session FEK is loaded (an unlocked hybrid/cloud session). The
   * session key is pushed by the renderer on unlock ONLY for hybrid profiles —
   * a genuine local-only profile never sets it. The sync path uses this to
   * decide whether an oversized machine-key blob is eligible for the one-time
   * auto-migration to a portable FEK container.
   */
  hasSessionFek(): boolean {
    return peekSessionKey() !== null;
  }

  /**
   * True when ANY account FEK is available to migrateToPortableFEK — the
   * in-memory session key OR the safeStorage-sealed .fek_safe used by background
   * cycles (getFekRawForSync covers both). The sync path uses this to decide
   * whether a non-portable-still result should be retried next cycle (no key =
   * locked) or pinned (a key was present, so it was a real, non-repeatable
   * failure — avoids re-transcoding a multi-GB file every cycle).
   */
  async hasAnyFek(): Promise<boolean> {
    return (await this.getFekRawForSync()) !== null;
  }

  // ── .filarr protected containers (Wave 2 "protéger sur place") ───────────
  // The box format (filarrContainer.ts) mirrors the app-vault key model but
  // lives OUTSIDE the vault dir, so main.ts needs explicit key access. Both
  // helpers return OWNED COPIES the caller must fill(0) after use — the live
  // session key is zeroized in place on lock and the master key must never
  // leak a long-lived reference outside this service.

  /**
   * Key that NEW protected containers are written with: the session FEK when
   * loaded (portable — opens on any of the user's unlocked devices), else
   * the machine master key (device-bound). Same routing as
   * saveEncryptedFileFromPathFEK / file:moveIntoVault.
   */
  async getBoxWriteKey(): Promise<Buffer> {
    const session = peekSessionKey();
    if (session) return Buffer.from(session);
    const masterKey = await this.getMasterKey();
    return Buffer.from(masterKey);
  }

  /**
   * Ordered candidate keys for READING a protected container: machine master
   * key first (local profiles), then the account FEK when available (session
   * key or .fek_safe). The box reader probes each against the metadata GCM.
   */
  async getBoxKeyCandidates(): Promise<Buffer[]> {
    const candidates: Buffer[] = [];
    try {
      candidates.push(Buffer.from(await this.getMasterKey()));
    } catch {
      // Not initialized yet — FEK may still be available below.
    }
    candidates.push(...(await this.accountKeyCandidates()));
    return candidates;
  }

  /**
   * Quelle clé, parmi celles fournies, authentifie le chunk 0 de ce conteneur ?
   * Rend l'INDEX dans `keys`, ou -1. Version publique de `selectV3Key`, exposée
   * pour l'inventaire de migration : classer un blob « ouvert par la clé
   * machine » (non concerné par la bascule) / « ouvert par la clé active » (à
   * risque) / « ouvert par aucune » (déjà perdu) est LE calcul qui borne la
   * migration et qui garde la bascule.
   */
  async probeV3KeyIndex(filePath: string, keys: readonly Buffer[]): Promise<number> {
    const selected = await this.selectV3Key(filePath, [...keys]);
    if (!selected) return -1;
    return keys.findIndex((k) => k === selected);
  }

  /**
   * Clé machine (`encryption.key.safe`) d'un répertoire de profil ARBITRAIRE.
   *
   * L'inventaire doit lire les blobs de TOUS les profils locaux, pas seulement
   * de l'actif — la FEK est globale à l'appareil, donc la bascule les concerne
   * tous. `getMasterKey` ne connaît que le profil actif ; celle-ci comble le
   * manque sans jamais toucher `this.key`.
   */
  async readProfileMachineKey(profileDir: string): Promise<Buffer | null> {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const sealed = await fs.readFile(path.join(profileDir, 'encryption.key.safe')).catch(() => null);
        if (sealed) return Buffer.from(safeStorage.decryptString(sealed), 'base64');
      }
      const plain = await fs.readFile(path.join(profileDir, 'encryption.key')).catch(() => null);
      return plain ? Buffer.from(plain) : null;
    } catch {
      return null;
    }
  }

  /** Base64 de la clé machine d'un profil, pour `manifest.encryptionKey`. */
  async readProfileEncryptionKeyBase64(profileDir: string): Promise<string | null> {
    const key = await this.readProfileMachineKey(profileDir);
    return key ? key.toString('base64') : null;
  }

  /**
   * Re-encrypts an oversized machine-key (or legacy V1/V2) vault blob IN PLACE
   * into a PORTABLE V3 container keyed by the account FEK, so it can finally
   * sync across devices. This rescues large files imported while the renderer
   * briefly reported local mode (machine-key V3), without a re-import.
   *
   * Data-safety contract (this runs on real multi-GB user files):
   *   - streams chunk-by-chunk in flat memory — no plaintext temp file;
   *   - writes to a sibling *.migrating-<rand> staging file, then fs.rename over
   *     the original ONLY after the staged blob is verified to (a) decrypt +
   *     GCM-verify with the FEK and (b) carry a whole-plaintext SHA-256 equal to
   *     the source;
   *   - on ANY failure the staging file is unlinked and the ORIGINAL is left
   *     byte-for-byte untouched;
   *   - returns false (never throws) when no FEK is available — the caller then
   *     keeps the file local_only. A genuine local-only profile has no FEK, so
   *     it is never touched.
   * Idempotent: an already-portable FEK blob is a no-op that returns true. The
   * re-keyed local file stays readable — decryptFileAuto / createDecryptStreamAuto
   * already select machine-key-then-FEK, so the FEK container is picked up.
   */
  async migrateToPortableFEK(filePath: string): Promise<boolean> {
    const fekRaw = await this.getFekRawForSync();
    if (!fekRaw) {
      // No account FEK (locked / genuine local-only) — keep local_only.
      return false;
    }
    const fek = Buffer.from(fekRaw);
    try {
      if (await isV3File(filePath)) {
        const masterKey = await this.getMasterKey();
        // Which key already authenticates chunk 0? FEK first (idempotent skip),
        // then the machine key (the case we migrate).
        const srcKey = await this.selectV3Key(filePath, [fek, masterKey]);
        if (!srcKey) {
          // Neither key authenticates — corrupt or foreign container. Never
          // touch it; the caller keeps it local_only.
          return false;
        }
        if (srcKey === fek) {
          // Already a portable FEK blob — nothing to do.
          return true;
        }
        // srcKey === masterKey: transcode machine-key → FEK (streaming).
        return await this.transcodeToPortableStaging(filePath, (stagedPath) =>
          transcodeV3File(masterKey, fek, filePath, stagedPath)
        );
      }

      // Legacy V1/V2 blob (bounded ≤ 500 MB by construction): decrypt in RAM,
      // re-encrypt as a portable FEK V3 container.
      let plain: Buffer;
      try {
        const blob = await fs.readFile(filePath);
        plain = await this.decryptBinary(blob);
      } catch {
        // Unknown/foreign container — leave it untouched.
        return false;
      }
      try {
        const srcHash = crypto.createHash('sha256').update(plain).digest();
        return await this.transcodeToPortableStaging(filePath, async (stagedPath) => {
          await encryptBufferToFileV3(fek, plain, stagedPath);
          return { origSize: plain.length, plaintextSha256: srcHash };
        });
      } finally {
        plain.fill(0);
      }
    } catch (error) {
      console.error(
        '[StorageService] migrateToPortableFEK failed (original preserved):',
        error instanceof Error ? error.message : error
      );
      return false;
    } finally {
      fek.fill(0);
    }
  }

  /**
   * Shared staging → verify → atomic-rename for migrateToPortableFEK. `produce`
   * writes the portable blob to the staging path and returns the SOURCE
   * plaintext digest it encrypted; this then verifies the staged blob against
   * the FEK (whole-plaintext SHA-256 == source AND chunk-0 GCM portability
   * proof) before the atomic rename. On any failure the staging file is
   * unlinked and the original is untouched; returns false.
   */
  private async transcodeToPortableStaging(
    filePath: string,
    produce: (stagedPath: string) => Promise<{ origSize: number; plaintextSha256: Buffer }>
  ): Promise<boolean> {
    const fekRaw = await this.getFekRawForSync();
    if (!fekRaw) return false;
    const fek = Buffer.from(fekRaw);
    const stagedPath = `${filePath}.migrating-${crypto.randomBytes(6).toString('hex')}`;
    try {
      const { plaintextSha256: srcHash } = await produce(stagedPath);
      // Verify: the staged blob decrypts + GCM-verifies under the FEK and its
      // whole plaintext matches the source (byte-for-byte via SHA-256).
      const stagedHash = await hashV3Plaintext(fek, stagedPath);
      if (!srcHash.equals(stagedHash)) {
        throw new Error('Verification post-migration echouee (empreinte plaintext differente)');
      }
      // Portability proof: chunk 0 authenticates under the account FEK.
      if (!(await this.isPortableV3File(stagedPath))) {
        throw new Error('Le blob migre n est pas portable (FEK)');
      }
      // Atomic swap — the original survives every failure up to this point.
      await fs.rename(stagedPath, filePath);
      return true;
    } catch (error) {
      await fs.unlink(stagedPath).catch(() => {});
      console.error(
        '[StorageService] transcodeToPortableStaging failed (original preserved):',
        error instanceof Error ? error.message : error
      );
      return false;
    } finally {
      fek.fill(0);
    }
  }

  /**
   * Save folder to storage
   */
  async saveFolder(folder: Folder): Promise<Folder> {
    // GARDE ANTI-PERTE : `getFolder` renvoie un dossier vide marqué
    // `__unreadable` quand son `metadata.json` est présent mais illisible. Le
    // réécrire (ici) DÉTRUIRAIT le contenu réel encore sur le disque et
    // propagerait ce vide via la synchro. On refuse donc — l'échec est visible
    // (l'appelant reçoit l'erreur) plutôt que silencieux, et le fichier réel
    // est préservé pour une lecture ultérieure réussie. La marque traverse les
    // « lire → muter → sauver » (elle survit à un spread `{...folder}`).
    if (folder.__unreadable) {
      throw new Error(
        `Refus d'écriture : metadata.json du dossier ${folder.id} est illisible ` +
          `(préservation du contenu réel — réessayez une fois le déchiffrement rétabli).`
      );
    }
    /*
      POURQUOI PAS `Date.now()`, QUI TENAIT ICI DEPUIS L ORIGINE.

      L identifiant du dossier n est pas qu une cle locale : il devient le
      repertoire sur le disque, PUIS la premiere moitie de l entree hachee
      qui donne la cle d objet distante — `fileId = sha256("<id>/<nom>")`
      tronque (voir `scanFileIdOf`, syncService). Cette derivation n est pas
      salee. Sa resistance repose donc ENTIEREMENT sur l imprevisibilite de
      `folder.id` : un horodatage en millisecondes se retrouve par force brute
      sur une fenetre de quelques 10^11, ce qui est l affaire de secondes — et
      une fois l identifiant connu, tous les noms de fichiers du dossier se
      devinent au dictionnaire.

      Ce repli ne se declenche pas en usage normal (le renderer fournit
      toujours un id via `folderService.createFolder`, aleatoire depuis
      `af3b1cf9`). C est precisement pour ca qu il etait dangereux : un chemin
      rare, jamais observe, qui aurait produit des dossiers enumerables sans
      que personne le remarque.

      La decision vit dans `ensureFolderId` — pas en ligne ici — pour qu une
      garde puisse exercer LE chemin reel plutot qu un jumeau.
    */
    folder.id = ensureFolderId(folder);

    const folderPath = path.join(this.baseDir as string, folder.id);

    try {
      await fs.mkdir(folderPath, { recursive: true });
    } catch (error: unknown) {
      if (error instanceof Error && (error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
      // If folder already exists, continue
    }

    const metadataPath = path.join(folderPath, 'metadata.json');
    const encryptedMetadata = await this.encrypt(folder);
    await fs.writeFile(metadataPath, encryptedMetadata);

    // Notify sync service
    if (this._onFolderSaved) this._onFolderSaved(folder.id);

    // If it's a subfolder (has parentId), add it to parent's items
    if (folder.parentId) {
      try {
        const parentFolder = await this.getFolder(folder.parentId, true);
        if (parentFolder) {
          // Check if item isn't already in parent (avoid duplicates)
          const alreadyExists = parentFolder.items.some(item =>
            (typeof item === 'string' && item === folder.id) ||
            (typeof item === 'object' && item !== null && item.id === folder.id)
          );

          if (!alreadyExists) {
            await this.addItemToFolder(folder.parentId, {
              id: folder.id,
              name: folder.name,
              type: 'folder',
              parentId: folder.parentId,
              createdAt: folder.createdAt,
              updatedAt: folder.updatedAt,
              items: [],
              color: folder.color,
              protected: folder.protected,
              password: folder.password,
              reminders: []
            });
          }
        }
      } catch (error) {
        console.error(`Error adding subfolder ${folder.id} to parent ${folder.parentId}:`, error);
        // Don't propagate error as folder was created successfully
      }
    }

    return folder;
  }

  /**
   * Get all root-level folders (non-deleted)
   */
  async getFolders(): Promise<Folder[]> {
    try {
      const folderIds = await fs.readdir(this.baseDir as string);

      // Filter to directories only (parallel stat)
      const dirChecks = await Promise.all(
        folderIds.map(async (id) => {
          try {
            const stats = await fs.stat(path.join(this.baseDir as string, id));
            return stats.isDirectory() ? id : null;
          } catch { return null; }
        })
      );
      const dirIds = dirChecks.filter(
        (id): id is string => id !== null && !estRepertoireReserve(id)
      );

      // Read all folders in parallel
      const results = await Promise.all(
        dirIds.map(async (id) => {
          try {
            return await this.getFolder(id);
          } catch (error) {
            console.error(`Error reading folder ${id}:`, error);
            return null;
          }
        })
      );

      // Return all non-deleted folders (including subfolders)
      // so the renderer has complete data for stats and search
      return results.filter((f): f is Folder => f !== null && !f.deletedAt);
    } catch (error) {
      console.error('Error reading folders:', error);
      return [];
    }
  }

  /**
   * Internal method to get ALL folders including deleted ones
   * Used for trash operations and other internal needs
   */
  async getAllFoldersIncludingDeleted(): Promise<Folder[]> {
    try {
      const folderIds = await fs.readdir(this.baseDir as string);

      // Filter to directories only (parallel stat)
      const dirChecks = await Promise.all(
        folderIds.map(async (id) => {
          try {
            const stats = await fs.stat(path.join(this.baseDir as string, id));
            return stats.isDirectory() ? id : null;
          } catch { return null; }
        })
      );
      // Meme filtre que getAllFolders : les repertoires de service ne sont pas
      // des dossiers. Sans ca, getFolder leve pour chacun d'eux a chaque
      // recensement (rappels, planificateur) et noie la console.
      const dirIds = dirChecks.filter(
        (id): id is string => id !== null && !estRepertoireReserve(id)
      );

      // Read all folders in parallel
      const results = await Promise.all(
        dirIds.map(async (id) => {
          try {
            return await this.getFolder(id, true);
          } catch (error) {
            console.error(`Error reading folder ${id}:`, error);
            return null;
          }
        })
      );

      return results.filter((f): f is Folder => f !== null);
    } catch (error) {
      console.error('Error reading folders:', error);
      return [];
    }
  }

  /**
   * Get folder by ID
   */
  async getFolder(id: string, includeDeleted: boolean = false): Promise<Folder> {

    const folderPath = path.join(this.baseDir as string, id.toString());
    const metadataPath = path.join(folderPath, 'metadata.json');

    // Un répertoire de service n'est pas un dossier, et surtout : la branche
    // ENOENT plus bas lui écrirait des métadonnées, ce qui le ferait APPARAÎTRE
    // dans le coffre. On refuse avant d'y toucher.
    if (estRepertoireReserve(id.toString())) {
      throw new Error(`${id} est un repertoire de service, pas un dossier`);
    }

    try {
      const stats = await fs.stat(folderPath);
      if (!stats.isDirectory()) {
        throw new Error(`${id} is not a valid folder`);
      }

      const encryptedMetadata = await fs.readFile(metadataPath, 'utf8');

      // Check if migration is needed — au format COURANT, sans jamais rétrograder
      // un `v3:` (voir machineContainerNeedsRewrite).
      const needsMigration = machineContainerNeedsRewrite(encryptedMetadata);

      const folder = await this.decrypt(encryptedMetadata) as Folder;

      // If data was decrypted using legacy method, re-encrypt with new method
      if (needsMigration) {
        try {
          await this.saveFolder(folder);
        } catch (migrationError) {
          console.error(`[MIGRATION] Failed to migrate folder ${id}:`, migrationError);
          // Continue anyway, the data was decrypted successfully
        }
      }


      folder.items = folder.items || [];

      const deletedItemsCount = folder.items.filter(item => item.deletedAt).length;

      // Filter out soft-deleted items unless explicitly requested
      if (!includeDeleted) {
        const beforeCount = folder.items.length;
        folder.items = folder.items.filter(item => !item.deletedAt);
      } else {
      }

      folder.items = folder.items.map(item => ({
        ...item,
        color: item.color || folder.color
      }));


      return folder;
    } catch (error: unknown) {
      console.error(`Error reading folder ${id}:`, error);
      if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        const defaultFolder: Folder = {
          id: id.toString(),
          name: `Folder ${id}`,
          items: [],
          color: '#000000'
        };
        await this.saveFolder(defaultFolder);
        return defaultFolder;
      }

      // Métadonnées PRÉSENTES mais ILLISIBLES (déchiffrement échoué). On ne
      // RÉINITIALISE PLUS le fichier. Un échec de déchiffrement peut être
      // TRANSITOIRE — écriture partielle après un crash, clé momentanément
      // incorrecte, course entre une lecture et une rotation de clé. L'ancien
      // comportement (réécrire un dossier vide par-dessus) DÉTRUISAIT alors
      // définitivement le contenu réel, et la synchro propageait ce dossier
      // vide sur les AUTRES appareils : une perte de données déclenchée par une
      // simple lecture ratée.
      //
      // On renvoie donc un dossier vide EN MÉMOIRE (l'application ne plante
      // pas) MAIS on laisse `metadata.json` INTACT sur le disque : une lecture
      // ultérieure réussie (clé rétablie, écriture terminée) récupère le vrai
      // contenu. Un fichier réellement corrompu reste simplement montré vide
      // jusqu'à ce que l'utilisateur le réécrive lui-même — jamais effacé en
      // douce.
      if (error instanceof Error && (
        error.message.includes('Invalid initialization vector') ||
        error.message.includes('Invalid IV length') ||
        error.message.includes('Encrypted data too short') ||
        error.message.includes('Unsupported state') ||
        (error as NodeJS.ErrnoException).code === 'ERR_CRYPTO_INVALID_IV'
      )) {
        console.warn(
          `[StorageService] metadata.json du dossier ${id} illisible — dossier montré VIDE, ` +
          `fichier PRÉSERVÉ pour récupération (aucune réinitialisation).`
        );
        return {
          id: id.toString(),
          name: `Folder ${id}`,
          items: [],
          color: '#000000',
          // Interdit à `saveFolder` de réécrire ce vide par-dessus le fichier
          // réel (encore intact) : sinon toute mutation (ajout/renommage/
          // déplacement) rouvrirait la perte de données que cette branche vise.
          __unreadable: true,
        };
      }
      throw error;
    }
  }

  /**
   * Get folder items
   */
  async getFolderItems(folderId: string): Promise<Item[]> {
    const folder = await this.getFolder(folderId);
    return folder.items || [];
  }

  /**
   * Update folder
   */
  async updateFolder(id: string, updatedFolder: Partial<Folder>): Promise<Folder> {
    const existingFolder = await this.getFolder(id);

    if (existingFolder.id === updatedFolder.id) {
      // Update folder itself
      const mergedFolder: Folder = {
        ...existingFolder,
        ...updatedFolder,
        id,
        items: (updatedFolder.items || existingFolder.items).map(item => ({
          ...item,
          color: item.id === updatedFolder.id ? updatedFolder.color : item.color
        }))
      };
      await this.saveFolder(mergedFolder);
      return mergedFolder;
    } else {
      // Update item inside folder
      const updatedItems = existingFolder.items.map(item =>
        item.id === updatedFolder.id ? { ...item, ...updatedFolder } : item
      );
      const mergedFolder: Folder = {
        ...existingFolder,
        items: updatedItems
      };
      await this.saveFolder(mergedFolder);
      return mergedFolder;
    }
  }

  /**
   * Delete folder
   */
  async deleteFolder(id: string, permanent: boolean = false): Promise<void> {
    if (permanent) {
      // Permanent deletion - secure-wipe contents then remove from filesystem
      const folderPath = path.join(this.baseDir as string, id);
      await secureDeleteDir(folderPath);
      if (this._onFolderDeleted) this._onFolderDeleted(id);
    } else {
      // Soft delete - set deletedAt timestamp
      // Get folder with ALL items (including deleted ones) to preserve deleted items when saving
      const folder = await this.getFolder(id, true);
      folder.deletedAt = new Date().toISOString();
      folder.updatedAt = new Date().toISOString();
      await this.saveFolder(folder);
    }
  }

  /**
   * Add item to folder
   */
  async addItemToFolder(folderId: string, item: Item): Promise<Folder> {
    return this.withFolderLock(folderId, async () => {
      const folder = await this.getFolder(folderId);

      // Échouer bruyamment : un retour silencieux laissait l'appelant croire que
      // l'élément était rangé alors qu'il n'existait nulle part.
      if (!folder) {
        throw new Error(`Folder ${folderId} not found`);
      }
      if (folder.deletedAt) {
        throw new Error(`Cannot add an item to deleted folder ${folderId}`);
      }

      if (!folder.items) folder.items = [];

      // If item is a folder, ensure it has correct structure
      if (item.type === 'folder') {
        item = {
          ...item,
          items: [],
          reminders: []
        };
      }

      folder.items.push(item);
      await this.saveFolder(folder);

      return folder;
    });
  }

  /**
   * Remove item from folder
   */
  async removeItemFromFolder(folderId: string, itemId: string): Promise<Folder> {
    return this.withFolderLock(folderId, async () => {
      const folder = await this.getFolder(folderId);

      if (folder && folder.items) {
        const itemToRemove = folder.items.find(item => item.id === itemId);

        if (itemToRemove) {
          // If it's a file, secure-wipe and delete from filesystem
          if (itemToRemove.type !== 'folder') {
            const filePath = path.join(this.baseDir as string, folderId, itemToRemove.name);
            try {
              await secureDeleteFile(filePath);
            } catch (error: unknown) {
              if (error instanceof Error && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.error('Error deleting file:', error);
                throw error;
              }
              console.warn(`File not found, skipping deletion: ${filePath}`);
            }
          }

          // Remove item from folder items list
          folder.items = folder.items.filter(item => item.id !== itemId);
          // Update folder in storage
          await this.saveFolder(folder);
        }
      }

      return folder;
    });
  }

  /**
   * DÉPLACER VERS LE COFFRE EN LAISSANT UN RACCOURCI.
   *
   * L'appelant a DÉJÀ déposé les octets dans le coffre (l'élément `ref.itemId`
   * existe). Ici on fait le reste, dans cet ordre :
   *   1. effacement SÛR du blob local (patron de `deleteFile` permanent —
   *      ENOENT toléré : un fichier jamais mis en cache n'a rien à effacer) ;
   *   2. avis à la synchro que le BLOB est supprimé (`_onFileDeleted` marque
   *      `folderId/nom` comme `deleted` dans le manifeste : le prochain cycle
   *      l'efface du nuage perso). Cet avis ne touche PAS à l'entrée de
   *      métadonnées du dossier — c'est `removeItemFromFolder` qui retire une
   *      fiche, et on ne l'appelle justement pas ;
   *   3. la FICHE reste, transformée en raccourci (`buildShortcutEntry`) et
   *      sauvée : `saveFolder` prévient la synchro de métadonnées, la fiche
   *      voyage donc vers les autres appareils.
   *
   * Chargé AVEC les supprimés (patron `deleteFile`) : sauver le dossier sans
   * eux viderait la corbeille. Sous le verrou du dossier, sans rappeler une
   * méthode verrouillée (le verrou n'est pas réentrant).
   */
  async convertFileToVaultShortcut(
    folderId: string,
    fileId: string,
    ref: VaultShortcutRef
  ): Promise<Folder> {
    return this.withFolderLock(folderId, async () => {
      const folder = await this.getFolder(folderId, true);
      const index = folder.items.findIndex((item) => item.id === fileId);
      if (index === -1) {
        throw new Error('File not found');
      }
      const file = folder.items[index];
      if (file.type === 'folder') {
        throw new Error('Un dossier ne devient pas un raccourci de coffre');
      }

      // La fiche AVANT le disque : une référence invalide lève ici, sans
      // qu'aucun octet n'ait été effacé.
      const now = new Date().toISOString();
      const shortcut = buildShortcutEntry(file, ref, now);

      const filePath = path.join(this.baseDir as string, folderId, file.name);
      try {
        await secureDeleteFile(filePath);
      } catch (error: unknown) {
        if (error instanceof Error && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error(`[STORAGE SERVICE] convertFileToVaultShortcut - Error deleting physical file:`, error);
          throw error;
        }
      }

      // Le blob seul : le manifeste de synchro porte les blobs par
      // `folderId/nom`, la fiche vit dans `meta:folderId` — deux entrées.
      if (this._onFileDeleted) this._onFileDeleted(folderId, file.name);

      folder.items[index] = shortcut;
      folder.updatedAt = now;
      await this.saveFolder(folder);
      return folder;
    });
  }

  /**
   * Save file
   */
  async saveFile(folderId: string, file: { name: string; content: string | Buffer }): Promise<Folder> {
    const folderPath = path.join(this.baseDir as string, folderId);
    const filePath = path.join(folderPath, file.name);
    await fs.writeFile(filePath, file.content);
    return await this.addItemToFolder(folderId, {
      id: Date.now().toString(),
      name: file.name,
      type: 'file'
    });
  }

  /**
   * Read file
   */
  async readFile(folderId: string, fileName: string): Promise<string> {
    const folderPath = path.join(this.baseDir as string, folderId);
    const filePath = path.join(folderPath, fileName);
    return await fs.readFile(filePath, 'utf8');
  }

  /**
   * Delete file
   */
  async deleteFile(folderId: string, fileName: string, permanent: boolean = false): Promise<Folder> {

    // Get folder with ALL items (including deleted ones) to preserve deleted items when saving
    const folder = await this.getFolder(folderId, true);

    const file = folder.items.find(item => item.name === fileName || item.id === fileName);

    if (!file) {
      console.error(`[STORAGE SERVICE] deleteFile - File not found: ${fileName} in folder ${folderId}`);
      console.error(`[STORAGE SERVICE] deleteFile - Available items:`, folder.items.map(i => ({ id: i.id, name: i.name })));
      throw new Error('File not found');
    }


    if (permanent) {
      // Permanent deletion - secure-wipe contents then remove file from filesystem
      const folderPath = path.join(this.baseDir as string, folderId);
      const filePath = path.join(folderPath, file.name);

      try {
        await secureDeleteFile(filePath);
      } catch (error: unknown) {
        if (error instanceof Error && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error(`[STORAGE SERVICE] deleteFile - Error deleting physical file:`, error);
          throw error;
        }
      }

      // Notify sync service
      if (this._onFileDeleted) this._onFileDeleted(folderId, file.name);

      // Remove from folder items
      const result = await this.removeItemFromFolder(folderId, file.id);
      return result;
    } else {
      // Soft delete - set deletedAt timestamp
      file.deletedAt = new Date().toISOString();
      file.updatedAt = new Date().toISOString();
      folder.updatedAt = new Date().toISOString();
      await this.saveFolder(folder);
      return folder;
    }
  }

  /**
   * Get the path to the calendar reminders file
   */
  private getCalendarRemindersPath(): string {
    return path.join(this.baseDir as string, 'calendarReminders.json');
  }

  /**
   * Read calendar-specific reminders from dedicated file
   */
  private async getCalendarReminders(): Promise<Reminder[]> {
    try {
      const filePath = this.getCalendarRemindersPath();
      const exists = await fs.access(filePath).then(() => true).catch(() => false);
      if (!exists) return [];
      const encrypted = await fs.readFile(filePath, 'utf8');
      if (!encrypted || encrypted.trim() === '') return [];
      const data = await this.decrypt(encrypted);
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('Error reading calendar reminders:', error);
      return [];
    }
  }

  /**
   * Save calendar-specific reminders to dedicated file
   */
  private async saveCalendarReminders(reminders: Reminder[]): Promise<void> {
    const filePath = this.getCalendarRemindersPath();
    const encrypted = await this.encrypt(reminders);
    await fs.writeFile(filePath, encrypted);
    // Le fichier voyage desormais sous `meta:calendar-reminders` : sans cet
    // avis, il resterait sur ce seul appareil (voir `reminderMetaDoc`).
    this._onReminderStoreChanged?.(CALENDAR_REMINDERS_META_RESOURCE_ID);
  }

  // ─────────── Note-attached reminders ───────────
  // Notes live in a single encrypted blob (notes.enc) owned by the
  // renderer, so we can't easily walk note.reminders[] from main. Instead
  // we keep note reminders in a sibling file noteReminders.json with the
  // same schema as calendar reminders. The Reminder.itemId is the noteId.

  private getNoteRemindersPath(): string {
    return path.join(this.baseDir as string, 'noteReminders.json');
  }

  private async getNoteReminders(): Promise<Reminder[]> {
    try {
      const filePath = this.getNoteRemindersPath();
      const exists = await fs.access(filePath).then(() => true).catch(() => false);
      if (!exists) return [];
      const encrypted = await fs.readFile(filePath, 'utf8');
      if (!encrypted || encrypted.trim() === '') return [];
      const data = await this.decrypt(encrypted);
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('Error reading note reminders:', error);
      return [];
    }
  }

  private async saveNoteReminders(reminders: Reminder[]): Promise<void> {
    const filePath = this.getNoteRemindersPath();
    const encrypted = await this.encrypt(reminders);
    await fs.writeFile(filePath, encrypted);
    this._onReminderStoreChanged?.(NOTE_REMINDERS_META_RESOURCE_ID);
  }

  async addNoteReminder(noteId: string, noteName: string, reminder: Reminder): Promise<Reminder> {
    if (!reminder.id) reminder.id = Date.now().toString();
    const next: Reminder = {
      ...reminder,
      itemId: noteId,
      itemName: noteName,
      itemType: 'note',
    };
    stampReminderCreation(next);
    const all = await this.getNoteReminders();
    all.push(next);
    await this.saveNoteReminders(all);
    return next;
  }

  async updateNoteReminder(
    noteId: string,
    reminderId: string,
    updates: Partial<Reminder>
  ): Promise<Reminder | null> {
    const all = await this.getNoteReminders();
    const idx = all.findIndex((r) => r.id === reminderId && r.itemId === noteId);
    if (idx === -1) return null;
    all[idx] = touchReminder(all[idx], updates);
    await this.saveNoteReminders(all);
    return all[idx];
  }

  async deleteNoteReminder(noteId: string, reminderId: string): Promise<boolean> {
    const all = await this.getNoteReminders();
    // PIERRE TOMBALE — même raison que pour les rappels libres.
    const now = new Date().toISOString();
    let touched = false;
    const next = all.map((r) => {
      if (r.id !== reminderId || r.itemId !== noteId) return r;
      touched = true;
      return toTombstone(r as StoredReminder, now) as unknown as Reminder;
    });
    if (!touched) return false;
    await this.saveNoteReminders(next);
    return true;
  }

  /**
   * Drop all reminders attached to the given note id. Called when a note
   * is deleted so we don't keep orphaned reminders.
   */
  async deleteAllNoteRemindersFor(noteId: string): Promise<void> {
    const all = await this.getNoteReminders();
    const now = new Date().toISOString();
    let touched = false;
    const next = all.map((r) => {
      if (r.itemId !== noteId || isTombstone(r as StoredReminder)) return r;
      touched = true;
      return toTombstone(r as StoredReminder, now) as unknown as Reminder;
    });
    if (touched) await this.saveNoteReminders(next);
  }

  /**
   * Add reminder to item
   */
  async addReminder(itemId: string, reminder: Reminder): Promise<Reminder> {
    reminder.id = Date.now().toString();
    // HORODATAGE A LA CREATION. Le mobile arbitre les rappels sur `updatedAt`
    // (syncMerge.mergeFolderReminders, LWW avec egalite au local) : un rappel
    // ecrit sans lui vaut 0 dans cet arbitrage et perd contre n'importe quel
    // etat du telephone des le premier cycle.
    stampReminderCreation(reminder);

    // Handle calendar-specific reminders (not attached to any file/folder)
    if (itemId === 'calendar') {
      const calendarReminders = await this.getCalendarReminders();
      calendarReminders.push(reminder);
      await this.saveCalendarReminders(calendarReminders);
      return reminder;
    }

    let targetFolder: Folder | null = null;
    let targetItem: Folder | Item | null = null;

    // Search in all folders (need to work with all items including deleted to modify them)
    const allFolders = await this.getAllFoldersIncludingDeleted();

    for (const folder of allFolders) {
      if (folder.id === itemId) {
        targetFolder = folder;
        break;
      }
      const item = folder.items.find(i => i.id === itemId);
      if (item) {
        targetFolder = folder;
        targetItem = item;
        break;
      }
    }

    if (!targetFolder) {
      throw new Error('Folder or item not found');
    }

    if (targetItem) {
      // Reminder is for an item in the folder
      if (!targetItem.reminders) targetItem.reminders = [];
      targetItem.reminders.push(reminder);
    } else {
      // Reminder is for the folder itself
      if (!targetFolder.reminders) targetFolder.reminders = [];
      targetFolder.reminders.push(reminder);
    }

    await this.saveFolder(targetFolder);
    return reminder;
  }

  /**
   * Update reminder
   */
  async updateReminder(itemId: string, reminderId: string, updatedReminder: Partial<Reminder>): Promise<Reminder> {
    // Handle calendar-specific reminders
    if (itemId === 'calendar') {
      const calendarReminders = await this.getCalendarReminders();
      const idx = calendarReminders.findIndex(r => r.id === reminderId);
      if (idx !== -1) {
        calendarReminders[idx] = touchReminder(calendarReminders[idx], updatedReminder);
        await this.saveCalendarReminders(calendarReminders);
        return calendarReminders[idx];
      }
      throw new Error('Calendar reminder not found');
    }

    let targetFolder: Folder | null = null;
    let targetItem: Folder | Item | null = null;

    // Search in all folders (need to work with all items including deleted to modify them)
    const allFolders = await this.getAllFoldersIncludingDeleted();

    for (const folder of allFolders) {
      if (folder.id === itemId) {
        targetFolder = folder;
        targetItem = folder;  // Reminder is for the folder itself
        break;
      }
      const item = folder.items.find(i => i.id === itemId);
      if (item) {
        targetFolder = folder;
        targetItem = item;
        break;
      }
    }

    if (!targetFolder || !targetItem) {
      throw new Error('Folder or item not found');
    }

    if (!targetItem.reminders) {
      targetItem.reminders = [];
    }

    const reminderIndex = targetItem.reminders.findIndex(r => r.id === reminderId);

    if (reminderIndex !== -1) {
      // Update existing reminder
      targetItem.reminders[reminderIndex] = touchReminder(
        targetItem.reminders[reminderIndex],
        updatedReminder
      );
    } else {
      // Create new reminder
      const newReminder: Reminder = {
        id: reminderId,
        description: updatedReminder.description || '',
        date: updatedReminder.date || new Date().toISOString(),
        ...updatedReminder
      };
      stampReminderCreation(newReminder);
      targetItem.reminders.push(newReminder);
    }

    await this.saveFolder(targetFolder);
    return targetItem.reminders[reminderIndex !== -1 ? reminderIndex : targetItem.reminders.length - 1];
  }

  /**
   * Delete reminder
   */
  async deleteReminder(itemId: string, reminderId: string): Promise<void> {
    // Handle calendar-specific reminders
    if (itemId === 'calendar') {
      const calendarReminders = await this.getCalendarReminders();
      // PIERRE TOMBALE, pas un retrait. Le fichier voyage : le retirer
      // simplement laisserait l'autre appareil le porter encore, et la descente
      // suivante le ressusciterait. Voir `reminderMetaDoc`.
      const now = new Date().toISOString();
      const next = calendarReminders.map((r) =>
        r.id === reminderId ? (toTombstone(r as StoredReminder, now) as unknown as Reminder) : r
      );
      await this.saveCalendarReminders(next);
      return;
    }

    // Search in all folders (need to work with all items including deleted to modify them)
    const allFolders = await this.getAllFoldersIncludingDeleted();

    for (const folder of allFolders) {
      // Check if reminder is in the folder itself
      if (folder.id === itemId && folder.reminders) {
        folder.reminders = folder.reminders.filter(r => r.id !== reminderId);
        await this.saveFolder(folder);
        return;
      }

      // Check if reminder is in an item in the folder
      const item = folder.items.find(i => i.id === itemId);
      if (item && item.reminders) {
        item.reminders = item.reminders.filter(r => r.id !== reminderId);
        await this.saveFolder(folder);
        return;
      }
    }
  }

  /**
   * Get all reminders
   */
  async getAllReminders(): Promise<Reminder[]> {
    // Search ALL folders (including sub-folders) to find all reminders
    const allFolders = await this.getAllFoldersIncludingDeleted();
    const reminders: Reminder[] = [];

    for (const folder of allFolders) {
      // Skip deleted folders
      if (folder.deletedAt) continue;

      if (folder.reminders && folder.reminders.length > 0) {
        reminders.push(...folder.reminders.map(r => ({
          ...r,
          itemId: folder.id,
          itemName: folder.name,
          itemType: 'folder'
        })));
      }
      if (folder.items && folder.items.length > 0) {
        for (const item of folder.items) {
          // Skip deleted items
          if (item.deletedAt) continue;
          if (item.reminders && item.reminders.length > 0) {
            reminders.push(...item.reminders.map(r => ({
              ...r,
              itemId: item.id,
              itemName: item.name,
              itemType: item.type || 'file'
            })));
          }
        }
      }
    }

    // Also include calendar-specific reminders. `liveReminders` ECARTE LES
    // PIERRES TOMBALES : le fichier voyage, et une suppression faite sur un
    // autre appareil y reste marquee jusqu'a sa purge — la montrer ici la ferait
    // reapparaitre a l'ecran et reprogrammerait sa notification.
    const calendarReminders = liveReminders(
      (await this.getCalendarReminders()) as unknown as StoredReminder[]
    ) as unknown as Reminder[];
    for (const r of calendarReminders) {
      reminders.push({
        ...r,
        itemId: r.itemId || 'calendar',
        itemName: r.itemName || 'Calendrier',
        itemType: r.itemType || 'folder'
      });
    }

    // Note-attached reminders live in their own sibling file (notes.enc
    // is owned by the renderer, so we can't easily walk note.reminders[]
    // from main).
    const noteReminders = liveReminders(
      (await this.getNoteReminders()) as unknown as StoredReminder[]
    ) as unknown as Reminder[];
    for (const r of noteReminders) {
      if (!r.itemId) continue;
      reminders.push({ ...r, itemType: 'note' });
    }

    // DEDOUBLONNAGE — un sous-dossier est A LA FOIS un dossier (son propre
    // metadata.json, ses propres reminders[]) et un item du dossier parent,
    // dont le metadata.json porte une COPIE du meme tableau. Sans ce passage,
    // son rappel ressortait deux fois : deux lignes a l'ecran, et deux
    // notifications programmees pour un seul rappel. Voir `reminderMetaCore`.
    return dedupeRemindersById(reminders);
  }

  /**
   * Get notification settings
   */
  async getNotificationSettings(): Promise<NotificationSettings> {
    try {
      const settingsPath = path.join(this.baseDir as string, 'notificationSettings.json');

      // Check if file exists
      const exists = await fs.access(settingsPath).then(() => true).catch(() => false);

      if (!exists) {
        // If file doesn't exist, create it with default settings
        const defaultSettings: NotificationSettings = {
          enabled: true,
          sound: true,
          delay: 15
        };
        await fs.writeFile(settingsPath, JSON.stringify(defaultSettings));
        return defaultSettings;
      }

      // If file exists, read it
      const settingsContent = await fs.readFile(settingsPath, 'utf8');
      return JSON.parse(settingsContent);
    } catch (error) {
      console.error('Error reading notification settings:', error);
      // Return default settings on error
      return {
        enabled: true,
        sound: true,
        delay: 15
      };
    }
  }

  /**
   * Update notification settings
   */
  async updateNotificationSettings(settings: NotificationSettings): Promise<void> {
    const settingsPath = path.join(this.baseDir as string, 'notificationSettings.json');
    await fs.writeFile(settingsPath, JSON.stringify(settings));
  }

  /**
   * Get reminder by ID
   */
  async getReminder(reminderId: string): Promise<Reminder | undefined> {
    const allReminders = await this.getAllReminders();
    return allReminders.find(reminder => reminder.id === reminderId);
  }

  /**
   * Get reminders for item
   */
  async getReminders(itemId: string): Promise<Reminder[]> {
    const folder = await this.getFolder(itemId);
    return folder.reminders || [];
  }

  /**
   * Get item by ID
   */
  async getItem(id: string): Promise<Item> {
    // Search in all folders
    const allFolders = await this.getFolders();

    for (const folder of allFolders) {
      // Check if ID matches folder itself
      if (folder.id === id) {
        return {
          ...folder,
          type: 'folder',
          parentId: folder.parentId || 'root'
        } as Item;
      }

      // Search in folder items
      if (folder.items) {
        const item = folder.items.find(i => i.id === id);
        if (item) {
          return { ...item, parentId: folder.id };
        }
      }
    }

    throw new Error('Item not found');
  }

  /**
   * Move item from source folder to target folder.
   *
   * `sourceFolderId`/`targetFolderId` accept the ROOT_FOLDER_ID sentinel: the
   * root is NOT a stored folder (no metadata.json), a top-level folder is simply
   * one whose `parentId` is empty. Reading or writing it through `getFolder`
   * would create a bogus "Folder root" directory, so both ends are special-cased
   * and the corresponding side of the result is null.
   */
  async moveItem(itemId: string, sourceFolderId: string, targetFolderId: string): Promise<{ sourceFolder: Folder | null; targetFolder: Folder | null }> {
    if (!itemId || !sourceFolderId || !targetFolderId) {
      throw new Error('itemId, sourceFolderId and targetFolderId are required');
    }

    if (sourceFolderId === targetFolderId) {
      throw new Error('Source folder and target folder must be different');
    }

    if (itemId === targetFolderId) {
      throw new Error('Cannot move a folder into itself or its subfolders');
    }

    const fromRoot = sourceFolderId === ROOT_FOLDER_ID;
    const toRoot = targetFolderId === ROOT_FOLDER_ID;

    // Lock both folders to prevent concurrent read-modify-write races.
    // Always lock in sorted order to prevent deadlocks. The sentinel is locked
    // like any other id: it serializes concurrent moves touching the root.
    const [firstId, secondId] = [sourceFolderId, targetFolderId].sort();
    return this.withFolderLock(firstId, () =>
      this.withFolderLock(secondId, async () => {
        // Get source and target folders (null on the root side)
        const sourceFolder = fromRoot ? null : await this.getFolder(sourceFolderId);
        const targetFolder = toRoot ? null : await this.getFolder(targetFolderId);

        // Find the item. At the root there is no container to look into: the
        // item must be a top-level folder, which we read by its own id.
        let item: Item;
        if (fromRoot) {
          const rootFolder = await this.getFolder(itemId);
          if (rootFolder.parentId) {
            throw new Error(`Item ${itemId} is not at the root`);
          }
          // A folder listed inside a parent carries an EMPTY items array — its
          // real content lives in its own metadata.json (see addItemToFolder).
          item = { ...rootFolder, type: 'folder', items: [], reminders: [] } as Item;
        } else {
          const found = sourceFolder!.items.find(i => i.id === itemId);
          if (!found) {
            throw new Error(`Item ${itemId} not found in source folder ${sourceFolderId}`);
          }
          item = found;
        }

        if (item.type !== 'folder' && toRoot) {
          throw new Error('Only folders can be moved to the root');
        }

        // Check that we're not moving a folder into itself or its subfolders
        if (item.type === 'folder' && !toRoot) {
          const isCircular = await this.isDescendant(targetFolderId, itemId);
          if (isCircular) {
            throw new Error('Cannot move a folder into itself or its subfolders');
          }
        }

        // If it's a file, move physical file (files never sit at the root)
        if (item.type !== 'folder') {
          const sourcePath = path.join(this.baseDir as string, sourceFolderId, item.name);
          const targetPath = path.join(this.baseDir as string, targetFolderId, item.name);

          // Check if source file exists
          if (await fs.access(sourcePath).then(() => true).catch(() => false)) {
            await fs.rename(sourcePath, targetPath);
          }
        }

        // Remove item from source folder
        if (sourceFolder) {
          sourceFolder.items = sourceFolder.items.filter(i => i.id !== itemId);
          await this.saveFolder(sourceFolder);
        }

        // Add item to target folder with new parentId
        if (targetFolder) {
          const movedItem: Item = { ...item, parentId: targetFolderId };
          targetFolder.items.push(movedItem);
          await this.saveFolder(targetFolder);
        }

        // If it's a folder, update its parentId
        if (item.type === 'folder') {
          const folderToMove = await this.getFolder(itemId);
          folderToMove.parentId = toRoot ? null : targetFolderId;
          await this.saveFolder(folderToMove);
        }

        return { sourceFolder, targetFolder };
      })
    );
  }

  /**
   * Copy item from source folder to target folder
   */
  async copyItem(itemId: string, sourceFolderId: string, targetFolderId: string, newName?: string): Promise<{ targetFolder: Folder; newItem: Item }> {
    if (!itemId || !sourceFolderId || !targetFolderId) {
      throw new Error('itemId, sourceFolderId and targetFolderId are required');
    }

    // The root is NOT a stored folder (same contract as moveItem above):
    // getFolder('root') would fabricate a bogus "Folder root" on disk. Copies
    // land inside a real folder only — refuse the root as a target.
    if (targetFolderId === ROOT_FOLDER_ID) {
      throw new Error('Cannot copy to the root — pick a destination folder');
    }
    const fromRoot = sourceFolderId === ROOT_FOLDER_ID;

    // Get source and target folders (the root has no metadata.json to read)
    const sourceFolder = fromRoot ? null : await this.getFolder(sourceFolderId);
    const targetFolder = await this.getFolder(targetFolderId);

    // Find the item. At the root, the item must be a top-level folder, read by
    // its own id — mirroring moveItem's sentinel handling.
    let item: Item;
    if (fromRoot) {
      const rootFolder = await this.getFolder(itemId);
      if (rootFolder.parentId) {
        throw new Error(`Item ${itemId} is not at the root`);
      }
      item = { ...rootFolder, type: 'folder', items: [], reminders: [] } as Item;
    } else {
      const found = sourceFolder!.items.find(i => i.id === itemId);
      if (!found) {
        throw new Error(`Item ${itemId} not found in source folder ${sourceFolderId}`);
      }
      item = found;
    }

    // Generate new ID and name for copy
    const newItemId = Date.now().toString();
    const finalName = newName || this.generateCopyName(item.name, targetFolder.items);

    // Create copy of item
    const newItem: Item = {
      ...item,
      id: newItemId,
      name: finalName,
      parentId: targetFolderId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // If it's a file, copy physical file
    if (item.type !== 'folder') {
      const sourcePath = path.join(this.baseDir as string, sourceFolderId, item.name);
      const targetPath = path.join(this.baseDir as string, targetFolderId, finalName);

      // Check if source file exists
      if (await fs.access(sourcePath).then(() => true).catch(() => false)) {
        // Transcode chunk-by-chunk in RAM (fresh key material, V3-aware,
        // never writes plaintext to disk). Legacy V1/V2 copies upgrade to V3.
        await this.reencryptFileAuto(sourcePath, targetPath);
      }
    } else {
      // If it's a folder, copy recursively
      const copiedFolder = await this.copyFolderRecursive(itemId, targetFolderId, finalName, newItemId);
      newItem.items = copiedFolder.items || [];
    }

    // Add copy to target folder
    targetFolder.items.push(newItem);
    await this.saveFolder(targetFolder);

    return { targetFolder, newItem };
  }

  /**
   * Generate copy name (adds suffix like (Copy), (Copy 2), etc.)
   */
  private generateCopyName(originalName: string, existingItems: Item[]): string {
    const existingNames = existingItems.map(item => item.name);

    // Extract extension if it's a file
    const lastDotIndex = originalName.lastIndexOf('.');
    let baseName = originalName;
    let extension = '';

    if (lastDotIndex > 0 && lastDotIndex < originalName.length - 1) {
      baseName = originalName.substring(0, lastDotIndex);
      extension = originalName.substring(lastDotIndex);
    }

    // Test different suffixes
    let copyName = `${baseName} (Copie)${extension}`;
    let counter = 2;

    while (existingNames.includes(copyName)) {
      copyName = `${baseName} (Copie ${counter})${extension}`;
      counter++;
    }

    return copyName;
  }

  /**
   * Copy folder recursively with all its content
   */
  private async copyFolderRecursive(sourceFolderId: string, parentFolderId: string, newFolderName: string, newFolderId: string): Promise<Folder> {
    const sourceFolder = await this.getFolder(sourceFolderId);

    // Create new folder
    const newFolder: Folder = {
      id: newFolderId,
      name: newFolderName,
      color: sourceFolder.color,
      items: [],
      parentId: parentFolderId,
      protected: sourceFolder.protected,
      password: sourceFolder.password,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      reminders: []
    };

    // Save new folder
    await this.saveFolder(newFolder);

    // Copy all items from source folder
    if (sourceFolder.items && sourceFolder.items.length > 0) {
      for (const item of sourceFolder.items) {
        if (item.type === 'folder') {
          // Recursion for subfolders
          const subFolderId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
          await this.copyFolderRecursive(item.id, newFolderId, item.name, subFolderId);
          newFolder.items.push({
            ...item,
            id: subFolderId,
            parentId: newFolderId
          });
        } else {
          // Copy files
          const newFileId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
          const sourcePath = path.join(this.baseDir as string, sourceFolderId, item.name);
          const targetPath = path.join(this.baseDir as string, newFolderId, item.name);

          if (await fs.access(sourcePath).then(() => true).catch(() => false)) {
            // V3-aware transcode with flat memory (see reencryptFileAuto).
            await this.reencryptFileAuto(sourcePath, targetPath);
          }

          newFolder.items.push({
            ...item,
            id: newFileId,
            parentId: newFolderId
          });
        }
      }

      // Save folder with all its items
      await this.saveFolder(newFolder);
    }

    return newFolder;
  }

  /**
   * Check if folder is descendant of another (to avoid circular moves)
   */
  private async isDescendant(folderId: string, potentialAncestorId: string): Promise<boolean> {
    try {
      let currentId: string | undefined = folderId;

      while (currentId) {
        if (currentId === potentialAncestorId) {
          return true;
        }

        const folder = await this.getFolder(currentId);
        currentId = folder.parentId || undefined;
      }

      return false;
    } catch (_error) {
      return false;
    }
  }

  // ============= TRASH/CORBEILLE METHODS =============

  /**
   * Restore deleted item (remove deletedAt)
   */
  async restoreItem(itemId: string): Promise<Folder | Item> {

    // Use internal method to get ALL folders including deleted ones
    const allFolders = await this.getAllFoldersIncludingDeleted();

    let foundFolder: Folder | null = null;
    let foundFile: Item | null = null;
    let parentFolder: Folder | null = null;

    // Search item in all folders
    for (const folder of allFolders) {

      // Check if it's the folder itself
      if (folder.id === itemId) {
        foundFolder = folder;
        if (folder.deletedAt) {
          delete folder.deletedAt;
          folder.updatedAt = new Date().toISOString();
          await this.saveFolder(folder);
          return folder;
        } else {
        }
      }

      // Search in folder items
      if (folder.items) {
        const item = folder.items.find(i => i.id === itemId);
        if (item) {
          foundFile = item;
          parentFolder = folder;

          if (item.deletedAt) {
            delete item.deletedAt;
            item.updatedAt = new Date().toISOString();
            folder.updatedAt = new Date().toISOString();
            await this.saveFolder(folder);
            return item;
          } else {
          }
        }
      }
    }


    throw new Error(`Item ${itemId} not found or not deleted`);
  }

  /**
   * Permanently delete item
   */
  async permanentlyDeleteItem(itemId: string, folderId: string | null = null): Promise<boolean> {
    // Use internal method to get ALL folders including deleted ones
    const allFolders = await this.getAllFoldersIncludingDeleted();

    // If it's a folder
    for (const folder of allFolders) {
      if (folder.id === itemId) {
        await this.deleteFolder(itemId, true);
        return true;
      }
    }

    // If it's a file
    if (folderId) {
      const folder = await this.getFolder(folderId, true);
      const file = folder.items.find(i => i.id === itemId);
      if (file) {
        await this.deleteFile(folderId, file.id, true);
        return true;
      }
    } else {
      // Search file in all folders
      for (const folder of allFolders) {
        const file = folder.items.find(i => i.id === itemId);
        if (file) {
          await this.deleteFile(folder.id, file.id, true);
          return true;
        }
      }
    }

    throw new Error('Item not found');
  }

  /**
   * Get all items in trash
   */
  async getTrashItems(): Promise<TrashItem[]> {

    // Use the internal method to get ALL folders including deleted ones
    const allFolders = await this.getAllFoldersIncludingDeleted();

    const trashItems: TrashItem[] = [];

    for (const folder of allFolders) {
      // Add deleted folders
      if (folder.deletedAt) {
        trashItems.push({
          ...folder,
          type: 'folder',
          itemType: 'folder',
          parentId: folder.parentId || null
        } as TrashItem);
      }

      // Add deleted files
      if (folder.items) {
        folder.items.forEach(item => {
          if (item.deletedAt) {
            trashItems.push({
              ...item,
              itemType: 'file',
              parentFolderId: folder.id,
              parentFolderName: folder.name
            });
          }
        });
      }
    }


    // Sort by deletion date (most recent first)
    return trashItems.sort((a, b) =>
      new Date(b.deletedAt as string).getTime() - new Date(a.deletedAt as string).getTime()
    );
  }

  /**
   * Empty trash (permanently delete all deleted items)
   */
  async emptyTrash(olderThanDays: number = 0): Promise<number> {
    const trashItems = await this.getTrashItems();
    let deletedCount = 0;
    const now = new Date();

    for (const item of trashItems) {
      const deletedDate = new Date(item.deletedAt as string);
      const daysDiff = (now.getTime() - deletedDate.getTime()) / (1000 * 60 * 60 * 24);

      // If olderThanDays is specified, only delete older items
      if (olderThanDays > 0 && daysDiff < olderThanDays) {
        continue;
      }

      try {
        if (item.itemType === 'folder') {
          await this.deleteFolder(item.id, true);
        } else {
          await this.deleteFile(item.parentFolderId as string, item.id, true);
        }
        deletedCount++;
      } catch (error) {
        console.error(`Error permanently deleting item ${item.id}:`, error);
      }
    }

    return deletedCount;
  }

  /**
   * Auto-cleanup: delete trash items older than 30 days
   */
  async autoCleanupTrash(): Promise<number> {
    return await this.emptyTrash(30);
  }

  // ============================================
  // STORAGE QUOTA TRACKING
  // ============================================

  /**
   * Get current storage usage information (local disk — no tier limits)
   */
  async getStorageQuota(): Promise<StorageQuota> {
    const defaultQuota: StorageQuota = { used: 0, total: 0 };

    try {
      const data = await fs.readFile(this.quotaFile as string, 'utf8');
      if (!data || !data.trim()) {
        await this.saveStorageQuota(defaultQuota);
        return defaultQuota;
      }
      try {
        const parsed = JSON.parse(data);
        return { used: parsed.used || 0, total: parsed.total || 0 };
      } catch {
        console.warn('[StorageService] Corrupted quota file, reinitializing');
        await this.saveStorageQuota(defaultQuota);
        return defaultQuota;
      }
    } catch (error: unknown) {
      if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.saveStorageQuota(defaultQuota);
        return defaultQuota;
      }
      throw error;
    }
  }

  /**
   * Save storage quota information
   */
  private async saveStorageQuota(quota: StorageQuota): Promise<void> {
    await fs.writeFile(this.quotaFile as string, JSON.stringify(quota, null, 2), 'utf8');
  }

  /**
   * Calculate total storage used by scanning all files
   */
  async calculateStorageUsed(): Promise<number> {
    let totalSize = 0;

    const calculateDirSize = async (dirPath: string): Promise<number> => {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);

          if (entry.isDirectory()) {
            totalSize += await calculateDirSize(fullPath);
          } else if (entry.isFile()) {
            const stats = await fs.stat(fullPath);
            totalSize += stats.size;
          }
        }
      } catch (error) {
        console.error(`Error calculating size for ${dirPath}:`, error);
      }

      return totalSize;
    };

    await calculateDirSize(this.baseDir as string);
    return totalSize;
  }

  /**
   * Update storage quota with current usage
   */
  async updateStorageQuota(): Promise<StorageQuota> {
    const used = await this.calculateStorageUsed();
    const quota: StorageQuota = { used, total: used };
    await this.saveStorageQuota(quota);
    return quota;
  }

  /**
   * Check if a file is within the per-file size limit of the LEGACY
   * whole-buffer IPC path (500 MB — the entire file transits renderer->main
   * in RAM). The V3 path-based streaming import uses
   * checkQuotaBeforeUploadFromPath (5 GiB) instead.
   * No tier-based storage quota — local disk is the user's own storage.
   */
  async checkQuotaBeforeUpload(fileSize: number): Promise<QuotaCheckResult> {
    const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB
    if (fileSize > MAX_FILE_SIZE) {
      return { allowed: false, reason: 'Fichier trop volumineux (max 500 Mo)' };
    }
    return { allowed: true };
  }

  /**
   * Per-file size limit for the V3 path-based streaming import (5 GiB,
   * aligned with MAX_FILE_SIZE in src/constants/limits.ts). Streaming keeps
   * memory flat, so the old 500 MB whole-buffer cap does not apply here.
   */
  async checkQuotaBeforeUploadFromPath(fileSize: number): Promise<QuotaCheckResult> {
    if (fileSize > this.streamMaxFileSize) {
      return { allowed: false, reason: 'Fichier trop volumineux (max 5 Go)' };
    }
    return { allowed: true };
  }

  /**
   * Increment storage usage by a specific amount
   */
  /**
   * Corriger le quota d'un DELTA — positif ou négatif.
   *
   * ── POURQUOI CE N'EST PAS `incrementStorageUsage` ─────────────────────────
   * Deux défauts se cumulaient. D'abord `incrementStorageUsage` ne fait
   * qu'AJOUTER : `decrementStorageUsage` existe et n'avait, lui, aucun
   * appelant dans tout le dépôt. Un fichier réenregistré comptait donc une
   * seconde fois, puis une troisième — le quota ne pouvait que monter, et une
   * autosave le ferait grimper à chaque frappe.
   *
   * Ensuite l'UNITÉ était fausse : la vérité, `calculateStorageUsed()`, somme
   * les tailles SUR DISQUE (donc du chiffré), alors que l'incrément ajoutait
   * la longueur EN CLAIR. Les deux ne parlaient pas de la même grandeur.
   *
   * Un delta mesuré sur le disque, avant et après l'écriture, règle les deux :
   * même unité que la vérité, et une réécriture ne compte que ce qu'elle a
   * réellement ajouté.
   */
  async adjustStorageUsage(deltaBytes: number): Promise<StorageQuota> {
    const quota = await this.getStorageQuota();
    quota.used = Math.max(0, quota.used + deltaBytes);
    await this.saveStorageQuota(quota);
    return quota;
  }

  /** Taille sur disque, ou 0 si le fichier n'existe pas encore. */
  async onDiskSize(filePath: string): Promise<number> {
    try {
      return (await fs.stat(filePath)).size;
    } catch {
      return 0;
    }
  }

  async incrementStorageUsage(bytes: number): Promise<StorageQuota> {
    const quota = await this.getStorageQuota();
    quota.used += bytes;
    await this.saveStorageQuota(quota);
    return quota;
  }

  /**
   * Decrement storage usage by a specific amount
   */
  async decrementStorageUsage(bytes: number): Promise<StorageQuota> {
    const quota = await this.getStorageQuota();
    quota.used = Math.max(0, quota.used - bytes);
    await this.saveStorageQuota(quota);
    return quota;
  }
  /**
   * Get the raw encryption key as base64 (for inclusion in cloud manifest).
   */
  /**
   * Un conteneur clé machine doit-il être réécrit au format courant ? Un `v3:`
   * ne redescend jamais ; un `v1:` ou un sans-marqueur monte toujours.
   */
  needsMachineRewrite(head: Buffer | string): boolean {
    return machineContainerNeedsRewrite(head);
  }

  getEncryptionKeyBase64(): string | null {
    if (!this.key) return null;
    return this.key.toString('base64');
  }

  /**
   * Replace the encryption key with one from another device.
   * If targetDir is provided, writes to that directory (for profile restore).
   * Also updates the in-memory key if targetDir matches current baseDir.
   */
  async replaceEncryptionKey(keyBase64: string, targetDir?: string): Promise<void> {
    const keyBuf = Buffer.from(keyBase64, 'base64');
    const dir = targetDir || this.getBaseDir();

    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(keyBase64);
      await fs.writeFile(path.join(dir, 'encryption.key.safe'), encrypted, { mode: 0o600 });
    } else {
      await fs.writeFile(path.join(dir, 'encryption.key'), keyBuf, { mode: 0o600 });
    }

    // Update in-memory key if we're writing to the active directory
    if (!targetDir || targetDir === this.baseDir) {
      this.key = keyBuf;
    }
  }

  // ── Pairing: FEK transfer between devices ────────────────────────────────

  /**
   * Load the FEK from .fek_safe and return it as an extractable CryptoKey.
   * Used by pairingService to wrap the FEK for transfer to another device.
   * Returns null if .fek_safe doesn't exist or safeStorage is unavailable.
   */
  async loadFEKForPairing(): Promise<crypto.webcrypto.CryptoKey | null> {
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        return null;
      }

      // .fek_safe may be in the active profile dir (written by renderer via hybrid:storeFEK)
      // or in the root FilarData dir (written by initWithExistingFEK during pairing)
      const candidates = [
        this.baseDir ? path.join(this.baseDir, '.fek_safe') : null,
        path.join(app.getPath('userData'), 'FilarData', '.fek_safe'),
      ].filter(Boolean) as string[];

      let encrypted: Buffer | null = null;
      for (const fekPath of candidates) {
        encrypted = await fs.readFile(fekPath).catch(() => null);
        if (encrypted) break;
      }
      if (!encrypted) {
        return null;
      }

      const base64 = safeStorage.decryptString(encrypted);
      const rawBytes = Buffer.from(base64, 'base64');

      // Import as extractable so wrapKey() can operate on it
      return await crypto.subtle.importKey(
        'raw',
        rawBytes,
        { name: 'AES-GCM', length: 256 },
        true, // extractable — required for wrapKey
        ['encrypt', 'decrypt']
      );
    } catch (error) {
      console.error('[StorageService] loadFEKForPairing error:', error);
      return null;
    }
  }

  /**
   * Store a FEK received from another device via pairing.
   * Wraps it with the local password (PBKDF2 → KEK → AES-GCM wrap),
   * saves wrapped_fek.json, and persists raw bytes in .fek_safe.
   */
  async initWithExistingFEK(fekRaw: Uint8Array, password: string): Promise<void> {
    // Write FEK to root FilarData (accessible before profile activation)
    // and to current baseDir if different (accessible after profile activation)
    const rootDir = path.join(app.getPath('userData'), 'FilarData');
    await fs.mkdir(rootDir, { recursive: true });
    const baseDir = rootDir;

    // 1. Derive KEK from password (same params as hybridCrypto.ts)
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    const kek = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 600_000,
        hash: 'SHA-512',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['wrapKey']
    );

    // 2. Import FEK as extractable CryptoKey
    const fekKey = await crypto.subtle.importKey(
      'raw',
      fekRaw,
      { name: 'AES-GCM', length: 256 },
      true, // extractable for wrapKey
      ['encrypt', 'decrypt']
    );

    // 3. Wrap FEK with KEK (AES-GCM)
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrappedFekBuffer = await crypto.subtle.wrapKey('raw', fekKey, kek, {
      name: 'AES-GCM',
      iv,
    });

    // 4. Pack: IV(12) || wrappedKey → base64
    const packed = new Uint8Array(12 + wrappedFekBuffer.byteLength);
    packed.set(iv, 0);
    packed.set(new Uint8Array(wrappedFekBuffer), 12);

    const wrappedKeyData = {
      wrappedFek: Buffer.from(packed).toString('base64'),
      kekSalt: Buffer.from(salt).toString('base64'),
      version: 1,
    };

    // 5. Save wrapped_fek.json
    const keyPath = path.join(baseDir, 'wrapped_fek.json');
    await fs.writeFile(keyPath, JSON.stringify(wrappedKeyData), { mode: 0o600 });

    // 6. Save .fek_safe via OS keychain
    if (safeStorage.isEncryptionAvailable()) {
      const fekB64 = Buffer.from(fekRaw).toString('base64');
      const encryptedFek = safeStorage.encryptString(fekB64);
      const fekSafePath = path.join(baseDir, '.fek_safe');
      await fs.writeFile(fekSafePath, encryptedFek, { mode: 0o600 });
    }
  }

  // ── FEK-based encrypt/decrypt for cloud manifest (multi-device) ─────────

  // Two on-wire formats coexist forever — the marker prefix tells decrypt
  // which one we're looking at. We don't migrate old manifests; they get
  // rewritten in the new format the next time the device pushes.
  //
  //   "fek:"  legacy: IV(12) || AES-GCM(plain-bytes)
  //   "fkz:"  new:    IV(12) || AES-GCM(deflated-bytes)
  //
  // Compression is significant for the manifest specifically — it's a JSON
  // blob that scales with the number of files in the profile and routinely
  // hits hundreds of KB to a few MB. zlib at default level typically
  // squashes it 4-8x. Files themselves are compressed client-side via the
  // separate hybridCrypto pipeline.
  private static readonly FEK_MARKER = Buffer.from('fek:');
  private static readonly FEK_ZLIB_MARKER = Buffer.from('fkz:');
  private static readonly FEK_IV_LENGTH = 12;

  // Don't bother compressing tiny payloads — the deflate header alone
  // costs ~6 bytes and there's nothing to save on a 200-byte manifest
  // (which happens for brand-new profiles).
  private static readonly FEK_COMPRESS_MIN_BYTES = 256;

  /**
   * Encrypt data with the FEK (AES-256-GCM).
   *
   * Format: "fkz:" || IV(12) || ciphertext+tag (plaintext = deflated)
   *      or "fek:" || IV(12) || ciphertext+tag (plaintext = raw bytes)
   *
   * We pick "fkz:" whenever deflate actually saves bytes. The decrypt path
   * accepts both markers, so a mid-rollout device that pushes one and
   * pulls the other never breaks.
   */
  async encryptWithFEK(data: Buffer): Promise<Buffer> {
    const fek = await this.loadFEKForPairing();
    if (!fek) {
      throw new Error('FEK not available — vault not unlocked');
    }
    return this.encryptManifestWithCryptoKey(data, fek);
  }

  /**
   * Même format « fek: » / « fkz: », mais avec des OCTETS de clé fournis.
   *
   * Existe pour la migration : le manifeste du profil CIBLE doit être chiffré
   * sous la clé ENTRANTE, jamais sous la clé active. Passer par
   * `encryptWithFEK` produirait un manifeste que le compte ne saurait pas
   * relire — et la preuve du palier 1 le rejetterait, à juste titre.
   */
  async encryptWithRawKey(data: Buffer, rawKey: Buffer): Promise<Buffer> {
    const key = await crypto.subtle.importKey(
      'raw', rawKey, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
    );
    return this.encryptManifestWithCryptoKey(data, key);
  }

  /** Pendant de `encryptWithRawKey` — relit un manifeste sous une clé donnée. */
  async decryptWithRawKey(encryptedData: Buffer, rawKey: Buffer): Promise<Buffer> {
    const key = await crypto.subtle.importKey(
      'raw', rawKey, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
    );
    return this.decryptManifestWithCryptoKey(encryptedData, key);
  }

  private async encryptManifestWithCryptoKey(
    data: Buffer,
    fek: crypto.webcrypto.CryptoKey
  ): Promise<Buffer> {
    // Try compressing first. Only commit to "fkz:" if it pays for itself
    // — otherwise the marker + framing would inflate the wire size for
    // payloads that don't compress (rare for the manifest, but possible).
    let payload: Buffer = data;
    let marker = StorageService.FEK_MARKER;
    if (data.byteLength >= StorageService.FEK_COMPRESS_MIN_BYTES) {
      try {
        const compressed = await deflateAsync(data);
        if (compressed.byteLength < data.byteLength) {
          payload = compressed;
          marker = StorageService.FEK_ZLIB_MARKER;
        }
      } catch {
        // deflate failures are unexpected with a Buffer input but we
        // never want manifest writes to fail because of a compression
        // edge case — fall back to plain.
      }
    }

    const fekRaw = await crypto.subtle.exportKey('raw', fek);
    const encKey = await crypto.subtle.importKey(
      'raw', fekRaw, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
    );

    const iv = crypto.getRandomValues(new Uint8Array(StorageService.FEK_IV_LENGTH));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, encKey, payload
    );

    return Buffer.concat([
      marker,
      Buffer.from(iv),
      Buffer.from(ciphertext),
    ]);
  }

  /**
   * Decrypt data encrypted with the FEK.
   * Accepts "fek:" (plain) or "fkz:" (deflated) markers.
   */
  async decryptWithFEK(encryptedData: Buffer): Promise<Buffer> {
    const fek = await this.loadFEKForPairing();
    if (!fek) {
      throw new Error('FEK not available — vault not unlocked');
    }
    return this.decryptManifestWithCryptoKey(encryptedData, fek);
  }

  private async decryptManifestWithCryptoKey(
    encryptedData: Buffer,
    fek: crypto.webcrypto.CryptoKey
  ): Promise<Buffer> {
    let isCompressed = false;
    let markerLen = 0;
    if (encryptedData.subarray(0, StorageService.FEK_ZLIB_MARKER.length).equals(StorageService.FEK_ZLIB_MARKER)) {
      isCompressed = true;
      markerLen = StorageService.FEK_ZLIB_MARKER.length;
    } else if (encryptedData.subarray(0, StorageService.FEK_MARKER.length).equals(StorageService.FEK_MARKER)) {
      markerLen = StorageService.FEK_MARKER.length;
    } else {
      throw new Error('decryptWithFEK: unknown marker (expected "fek:" or "fkz:")');
    }

    const fekRaw = await crypto.subtle.exportKey('raw', fek);
    const decKey = await crypto.subtle.importKey(
      'raw', fekRaw, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
    );

    const payload = encryptedData.subarray(markerLen);
    const iv = payload.subarray(0, StorageService.FEK_IV_LENGTH);
    const ciphertext = payload.subarray(StorageService.FEK_IV_LENGTH);

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv }, decKey, ciphertext
    );

    const plainBuf = Buffer.from(plaintext);
    return isCompressed ? await inflateAsync(plainBuf) : plainBuf;
  }

  /**
   * LIT LE CONTENEUR DU CLIENT WEB (`hybridCrypto.encryptFileContent`).
   *
   * Le format, les replis et la raison d'etre vivent dans `webContainerRead` —
   * PUR, donc confronte a des vecteurs croises dans ses tests. Ici il ne reste
   * que le choix des cles, qui est le seul morceau lie a l'etat de ce service.
   *
   * ⚠ LECTURE SEULEMENT. Le bureau continue de sceller en « v2: ».
   */
  async decryptWebFileContainer(encryptedData: Buffer): Promise<Buffer> {
    /**
     * Les cles de LECTURE, pas seulement la FEK active : apres une bascule,
     * tout objet anterieur n'ouvre que sous une cle retiree, et le web fait le
     * meme detour (`decryptFileContent` essaie l'active puis les retirees).
     */
    return openWebFileContainer(encryptedData, await this.accountKeyCandidates());
  }

  /**
   * Decrypt manifest data — auto-detects FEK or legacy format.
   * Tries FEK first (multi-device compatible), falls back to legacy local key.
   */
  async decryptManifestAuto(encryptedData: Buffer): Promise<Buffer> {
    const isFek = encryptedData.subarray(0, StorageService.FEK_MARKER.length).equals(StorageService.FEK_MARKER);
    const isFkz = encryptedData.subarray(0, StorageService.FEK_ZLIB_MARKER.length).equals(StorageService.FEK_ZLIB_MARKER);
    if (isFek || isFkz) {
      return this.decryptWithFEK(encryptedData);
    }
    // Fallback to legacy local-key decryption
    return this.decryptBinary(encryptedData);
  }
  // ── Enhanced Lock Mode ───────────────────────────────────────────────────

  private static readonly APP_CONFIG_FILE = 'appConfig.json';

  /**
   * Get the enhanced lock setting for a profile.
   */
  async getEnhancedLock(profileDir: string): Promise<boolean> {
    try {
      const configPath = path.join(profileDir, StorageService.APP_CONFIG_FILE);
      const data = await fs.readFile(configPath, 'utf8');
      const config = JSON.parse(data);
      return config.enhancedLock === true;
    } catch {
      return false;
    }
  }

  /**
   * Set the enhanced lock setting for a profile.
   */
  async setEnhancedLock(profileDir: string, enabled: boolean): Promise<void> {
    const configPath = path.join(profileDir, StorageService.APP_CONFIG_FILE);
    let config: Record<string, unknown> = {};
    try {
      const data = await fs.readFile(configPath, 'utf8');
      config = JSON.parse(data);
    } catch {
      // File doesn't exist yet
    }
    config.enhancedLock = enabled;
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  }

  /**
   * Delete .fek_safe from disk. Called on app quit when enhanced lock is enabled.
   * The FEK remains in wrapped_fek.json (password-protected) — the user will
   * need to enter their vault password on next launch.
   */
  async deleteFEKSafe(): Promise<void> {
    // Search both profile dir and root
    const candidates = [
      this.baseDir ? path.join(this.baseDir, '.fek_safe') : null,
      path.join(app.getPath('userData'), 'FilarData', '.fek_safe'),
    ].filter(Boolean) as string[];

    for (const fekPath of candidates) {
      // Securely wipe — the FEK safe blob protects vault key material
      await secureDeleteFile(fekPath).catch(() => {});
    }
  }
}

export default new StorageService();
