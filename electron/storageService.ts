import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { app, safeStorage } from 'electron';

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
}

/**
 * Reminder structure
 */
interface Reminder {
  id: string;
  description: string;
  date: string;
  isRead?: boolean;
  isCompleted?: boolean;
  itemId?: string;
  itemName?: string;
  itemType?: string;
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
  public readonly ENCRYPTION_VERSION_2: string = 'v2:'; // 600k iterations
  public readonly ENCRYPTION_VERSION_1: string = 'v1:'; // 10k iterations (legacy)


  // Sync callbacks — set by syncService to be notified of changes
  private _onFolderSaved: ((folderId: string) => void) | null = null;
  private _onFolderDeleted: ((folderId: string) => void) | null = null;
  private _onFileDeleted: ((folderId: string, fileName: string) => void) | null = null;

  setOnFolderSaved(cb: (folderId: string) => void): void { this._onFolderSaved = cb; }
  setOnFolderDeleted(cb: (folderId: string) => void): void { this._onFolderDeleted = cb; }
  setOnFileDeleted(cb: (folderId: string, fileName: string) => void): void { this._onFileDeleted = cb; }

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
  async reinitialize(profileDataDir: string): Promise<void> {
    const doInit = async () => {
      this.baseDir = profileDataDir;
      this.keyFile = path.join(this.baseDir, 'encryption.key');
      this.quotaFile = path.join(this.baseDir, 'storage.quota');
      this.key = null; // Force key reload
      await fs.mkdir(this.baseDir, { recursive: true });
      await this.loadOrGenerateKey();

      // Copy FEK files from root FilarData if missing in this profile
      // (new profile on an existing cloud account should share the FEK)
      await this.ensureFEKAvailable(profileDataDir);
    };
    this.initPromise = doInit();
    await this.initPromise;
  }

  /**
   * Ensure .fek_safe and wrapped_fek.json exist in the target profile dir.
   * If missing, copies from root FilarData or other profile dirs.
   */
  private async ensureFEKAvailable(profileDir: string): Promise<void> {
    const rootDir = path.join(app.getPath('userData'), 'FilarData');
    const fekSafe = '.fek_safe';
    const wrappedFek = 'wrapped_fek.json';

    // Check if FEK already exists in this profile
    const hasFekSafe = await fs.access(path.join(profileDir, fekSafe)).then(() => true).catch(() => false);
    const hasWrapped = await fs.access(path.join(profileDir, wrappedFek)).then(() => true).catch(() => false);

    if (hasFekSafe && hasWrapped) return; // Already good

    // Search for FEK in: root dir, then other profile dirs
    const searchDirs = [rootDir];
    try {
      const profilesDir = path.join(rootDir, 'profiles');
      const profiles = await fs.readdir(profilesDir);
      for (const p of profiles) {
        const pDir = path.join(profilesDir, p);
        const stat = await fs.stat(pDir);
        if (stat.isDirectory() && pDir !== profileDir) {
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
          // Remove legacy unprotected key file
          await fs.unlink(this.keyFile as string).catch(() => {});
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
  async encrypt(data: any): Promise<string> {
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
   * Decrypt data (JSON)
   */
  async decrypt(encryptedData: string): Promise<any> {
    // Wait for any pending initialization to complete before decrypting
    await this.initPromise;
    if (!this.key) {
      throw new Error('StorageService not initialized — encryption key not loaded');
    }
    // Check for version marker
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
  async encryptBinary(data: Buffer): Promise<Buffer> {
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
    const v2Marker = Buffer.from(this.ENCRYPTION_VERSION_2, 'utf8');
    const v1Marker = Buffer.from(this.ENCRYPTION_VERSION_1, 'utf8');

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

  /**
   * Save folder to storage
   */
  async saveFolder(folder: Folder): Promise<Folder> {
    if (!folder.id) {
      folder.id = Date.now().toString();
    } else {
      folder.id = folder.id.toString();
    }

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
      const dirIds = dirChecks.filter((id): id is string => id !== null);

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
      const dirIds = dirChecks.filter((id): id is string => id !== null);

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

    try {
      const stats = await fs.stat(folderPath);
      if (!stats.isDirectory()) {
        throw new Error(`${id} is not a valid folder`);
      }

      const encryptedMetadata = await fs.readFile(metadataPath, 'utf8');

      // Check if migration is needed
      const needsMigration = !encryptedMetadata.startsWith(this.ENCRYPTION_VERSION_2);

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

      // Handle corrupted/unreadable encrypted data — reinitialize the folder
      // rather than crashing the entire application
      if (error instanceof Error && (
        error.message.includes('Invalid initialization vector') ||
        error.message.includes('Invalid IV length') ||
        error.message.includes('Encrypted data too short') ||
        error.message.includes('Unsupported state') ||
        (error as NodeJS.ErrnoException).code === 'ERR_CRYPTO_INVALID_IV'
      )) {
        console.warn(`[StorageService] Corrupted metadata for folder ${id}, reinitializing`);
        const defaultFolder: Folder = {
          id: id.toString(),
          name: `Folder ${id}`,
          items: [],
          color: '#000000'
        };
        try {
          await this.saveFolder(defaultFolder);
        } catch (saveErr) {
          console.error(`[StorageService] Failed to reinitialize folder ${id}:`, saveErr);
        }
        return defaultFolder;
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
      // Permanent deletion - remove from filesystem
      const folderPath = path.join(this.baseDir as string, id);
      await fs.rm(folderPath, { recursive: true, force: true });
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

      if (folder) {
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
      }

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
          // If it's a file, delete from filesystem
          if (itemToRemove.type !== 'folder') {
            const filePath = path.join(this.baseDir as string, folderId, itemToRemove.name);
            try {
              await fs.unlink(filePath);
            } catch (error: unknown) {
              // Ignore error if file doesn't exist (ENOENT)
              // This can happen if file was manually deleted
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
      // Permanent deletion - remove file from filesystem
      const folderPath = path.join(this.baseDir as string, folderId);
      const filePath = path.join(folderPath, file.name);

      try {
        await fs.unlink(filePath);
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
  }

  /**
   * Add reminder to item
   */
  async addReminder(itemId: string, reminder: Reminder): Promise<Reminder> {
    reminder.id = Date.now().toString();

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
        calendarReminders[idx] = { ...calendarReminders[idx], ...updatedReminder } as Reminder;
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
      targetItem.reminders[reminderIndex] = {
        ...targetItem.reminders[reminderIndex],
        ...updatedReminder
      } as Reminder;
    } else {
      // Create new reminder
      const newReminder: Reminder = {
        id: reminderId,
        description: updatedReminder.description || '',
        date: updatedReminder.date || new Date().toISOString(),
        ...updatedReminder
      };
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
      const filtered = calendarReminders.filter(r => r.id !== reminderId);
      await this.saveCalendarReminders(filtered);
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

    // Also include calendar-specific reminders
    const calendarReminders = await this.getCalendarReminders();
    for (const r of calendarReminders) {
      reminders.push({
        ...r,
        itemId: r.itemId || 'calendar',
        itemName: r.itemName || 'Calendrier',
        itemType: r.itemType || 'folder'
      });
    }

    return reminders;
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
   * Move item from source folder to target folder
   */
  async moveItem(itemId: string, sourceFolderId: string, targetFolderId: string): Promise<{ sourceFolder: Folder; targetFolder: Folder }> {
    if (!itemId || !sourceFolderId || !targetFolderId) {
      throw new Error('itemId, sourceFolderId and targetFolderId are required');
    }

    if (sourceFolderId === targetFolderId) {
      throw new Error('Source folder and target folder must be different');
    }

    // Lock both folders to prevent concurrent read-modify-write races.
    // Always lock in sorted order to prevent deadlocks.
    const [firstId, secondId] = [sourceFolderId, targetFolderId].sort();
    return this.withFolderLock(firstId, () =>
      this.withFolderLock(secondId, async () => {
        // Get source and target folders
        const sourceFolder = await this.getFolder(sourceFolderId);
        const targetFolder = await this.getFolder(targetFolderId);

        // Find item in source folder
        const item = sourceFolder.items.find(i => i.id === itemId);
        if (!item) {
          throw new Error(`Item ${itemId} not found in source folder ${sourceFolderId}`);
        }

        // Check that we're not moving a folder into itself or its subfolders
        if (item.type === 'folder') {
          const isCircular = await this.isDescendant(targetFolderId, itemId);
          if (isCircular || targetFolderId === itemId) {
            throw new Error('Cannot move a folder into itself or its subfolders');
          }
        }

        // If it's a file, move physical file
        if (item.type !== 'folder') {
          const sourcePath = path.join(this.baseDir as string, sourceFolderId, item.name);
          const targetPath = path.join(this.baseDir as string, targetFolderId, item.name);

          // Check if source file exists
          if (await fs.access(sourcePath).then(() => true).catch(() => false)) {
            await fs.rename(sourcePath, targetPath);
          }
        }

        // Remove item from source folder
        sourceFolder.items = sourceFolder.items.filter(i => i.id !== itemId);

        // Add item to target folder with new parentId
        const movedItem: Item = { ...item, parentId: targetFolderId };
        targetFolder.items.push(movedItem);

        // Save both folders
        await this.saveFolder(sourceFolder);
        await this.saveFolder(targetFolder);

        // If it's a folder, update its parentId
        if (item.type === 'folder') {
          const folderToMove = await this.getFolder(itemId);
          folderToMove.parentId = targetFolderId;
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

    // Get source and target folders
    const sourceFolder = await this.getFolder(sourceFolderId);
    const targetFolder = await this.getFolder(targetFolderId);

    // Find item in source folder
    const item = sourceFolder.items.find(i => i.id === itemId);
    if (!item) {
      throw new Error(`Item ${itemId} not found in source folder ${sourceFolderId}`);
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
        const fileContent = await fs.readFile(sourcePath);
        await fs.writeFile(targetPath, fileContent);
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
            const fileContent = await fs.readFile(sourcePath);
            await fs.writeFile(targetPath, fileContent);
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
   * Check if a file is within the per-file size limit (500 MB).
   * No tier-based storage quota — local disk is the user's own storage.
   */
  async checkQuotaBeforeUpload(fileSize: number): Promise<QuotaCheckResult> {
    const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB
    if (fileSize > MAX_FILE_SIZE) {
      return { allowed: false, reason: 'File too large (max 500 MB)' };
    }
    return { allowed: true };
  }

  /**
   * Increment storage usage by a specific amount
   */
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

  private static readonly FEK_MARKER = Buffer.from('fek:');
  private static readonly FEK_IV_LENGTH = 12;

  /**
   * Encrypt data with the FEK (AES-256-GCM).
   * Format: "fek:" || IV(12) || ciphertext+tag
   * Used for the cloud manifest so any device with the FEK can decrypt it.
   */
  async encryptWithFEK(data: Buffer): Promise<Buffer> {
    const fek = await this.loadFEKForPairing();
    if (!fek) {
      throw new Error('FEK not available — vault not unlocked');
    }

    // Re-import with encrypt usage
    const fekRaw = await crypto.subtle.exportKey('raw', fek);
    const encKey = await crypto.subtle.importKey(
      'raw', fekRaw, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
    );

    const iv = crypto.getRandomValues(new Uint8Array(StorageService.FEK_IV_LENGTH));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, encKey, data
    );

    return Buffer.concat([
      StorageService.FEK_MARKER,
      Buffer.from(iv),
      Buffer.from(ciphertext),
    ]);
  }

  /**
   * Decrypt data encrypted with the FEK.
   * Expects format: "fek:" || IV(12) || ciphertext+tag
   */
  async decryptWithFEK(encryptedData: Buffer): Promise<Buffer> {
    const fek = await this.loadFEKForPairing();
    if (!fek) {
      throw new Error('FEK not available — vault not unlocked');
    }

    const fekRaw = await crypto.subtle.exportKey('raw', fek);
    const decKey = await crypto.subtle.importKey(
      'raw', fekRaw, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
    );

    // Strip "fek:" marker
    const payload = encryptedData.subarray(StorageService.FEK_MARKER.length);
    const iv = payload.subarray(0, StorageService.FEK_IV_LENGTH);
    const ciphertext = payload.subarray(StorageService.FEK_IV_LENGTH);

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv }, decKey, ciphertext
    );

    return Buffer.from(plaintext);
  }

  /**
   * Decrypt manifest data — auto-detects FEK or legacy format.
   * Tries FEK first (multi-device compatible), falls back to legacy local key.
   */
  async decryptManifestAuto(encryptedData: Buffer): Promise<Buffer> {
    if (encryptedData.subarray(0, StorageService.FEK_MARKER.length).equals(StorageService.FEK_MARKER)) {
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
      await fs.unlink(fekPath).catch(() => {});
    }
  }
}

export default new StorageService();
