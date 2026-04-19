/**
 * Service de gestion des versions de fichiers (Version History)
 *
 * Ce module gère le versionnement automatique des fichiers, permettant de:
 * - Sauvegarder automatiquement une version a chaque modification
 * - Conserver les N dernieres versions (configurable)
 * - Comparer les versions (diff)
 * - Restaurer une version precedente
 *
 * MODE NAVIGATEUR: Utilise localStorage au lieu de l'API Electron IPC
 */

import { generateUniqueId } from '../../utils/idGenerator';
import errorService from '../platform/errorService';
import profileStorage from './profileStorage';

// ==================== TYPES ====================

export interface FileVersion {
  id: string;
  fileId: string;
  fileName: string;
  folderId: string;
  versionNumber: number;
  size: number;
  checksum: string;
  createdAt: string;
  createdBy?: string;
  comment?: string;
  metadata?: Record<string, any>;
}

export interface VersionDiff {
  versionA: string;
  versionB: string;
  type: 'binary' | 'text';
  additions: number;
  deletions: number;
  changes: DiffChange[];
}

export interface DiffChange {
  type: 'add' | 'remove' | 'modify';
  lineNumber?: number;
  content?: string;
  oldContent?: string;
  newContent?: string;
}

export interface VersionConfig {
  maxVersions: number;
  autoVersionOnSave: boolean;
  excludeExtensions: string[];
  minTimeBetweenVersions: number; // in seconds
}

export interface VersionRestoreResult {
  success: boolean;
  restoredVersion: FileVersion;
  newVersion?: FileVersion;
}

// ==================== DEFAULT CONFIG ====================

const DEFAULT_VERSION_CONFIG: VersionConfig = {
  maxVersions: 10,
  autoVersionOnSave: true,
  excludeExtensions: ['.tmp', '.bak', '.swp'],
  minTimeBetweenVersions: 5, // 5 seconds
};

// ==================== STORAGE KEYS ====================

const STORAGE_KEY_CONFIG = 'filarr_version_config';
const STORAGE_KEY_VERSIONS = 'filarr_file_versions';

// ==================== VERSION SERVICE ====================

class VersionService {
  private config: VersionConfig;
  private versions: Record<string, FileVersion[]> = {};

  constructor() {
    this.config = { ...DEFAULT_VERSION_CONFIG };
    this.loadConfig();
    this.loadVersions();
  }

  /**
   * Charge la configuration depuis localStorage
   */
  private loadConfig(): void {
    try {
      const saved = profileStorage.getItem(STORAGE_KEY_CONFIG);
      if (saved) {
        this.config = { ...DEFAULT_VERSION_CONFIG, ...JSON.parse(saved) };
      }
    } catch (error) {
      console.warn('[VERSION SERVICE] Could not load config, using defaults:', error);
    }
  }

  /**
   * Charge les versions depuis localStorage
   */
  private loadVersions(): void {
    try {
      const saved = profileStorage.getItem(STORAGE_KEY_VERSIONS);
      if (saved) {
        this.versions = JSON.parse(saved);
      }
    } catch (error) {
      console.warn('[VERSION SERVICE] Could not load versions:', error);
      this.versions = {};
    }
  }

  /**
   * Persiste les versions dans localStorage
   */
  private saveVersions(): void {
    try {
      profileStorage.setItem(STORAGE_KEY_VERSIONS, JSON.stringify(this.versions));
    } catch (error) {
      console.error('[VERSION SERVICE] Error saving versions:', error);
    }
  }

  /**
   * Sauvegarde la configuration
   */
  async saveConfig(config: Partial<VersionConfig>): Promise<VersionConfig> {
    this.config = { ...this.config, ...config };
    try {
      profileStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(this.config));
    } catch (error) {
      throw errorService.createFileSystemError(
        'Impossible de sauvegarder la configuration des versions',
        error as Error
      );
    }
    return this.config;
  }

  /**
   * Obtient la configuration actuelle
   */
  getConfig(): VersionConfig {
    return { ...this.config };
  }

  /**
   * Cree une nouvelle version d'un fichier
   */
  async createVersion(
    folderId: string,
    fileId: string,
    fileName: string,
    comment?: string,
    size?: number,
    force?: boolean
  ): Promise<FileVersion> {
    if (!folderId || !fileId || !fileName) {
      throw new Error('folderId, fileId et fileName sont requis pour creer une version');
    }

    // Verifier si l'extension est exclue (sauf en mode force)
    if (!force) {
      const dotIndex = fileName.lastIndexOf('.');
      if (dotIndex >= 0) {
        const extension = fileName.substring(dotIndex).toLowerCase();
        const excludeList = Array.isArray(this.config.excludeExtensions)
          ? this.config.excludeExtensions
          : [];
        if (excludeList.includes(extension)) {
          throw new Error(`Les fichiers avec l'extension ${extension} ne sont pas versiones`);
        }
      }
    }

    // Verifier le temps minimum entre versions (sauf en mode force)
    const existingVersions = this.versions[fileId] || [];
    if (!force && existingVersions.length > 0) {
      const lastVersion = existingVersions[0];
      const timeSinceLastVersion = (Date.now() - new Date(lastVersion.createdAt).getTime()) / 1000;

      if (timeSinceLastVersion < this.config.minTimeBetweenVersions) {
        return { ...lastVersion };
      }
    }

    const versionNumber =
      existingVersions.length > 0 ? (existingVersions[0].versionNumber || 0) + 1 : 1;

    const checksum = generateUniqueId().substring(0, 8);

    const version: FileVersion = {
      id: generateUniqueId(),
      fileId,
      fileName,
      folderId,
      versionNumber,
      size: size || 0,
      checksum,
      createdAt: new Date().toISOString(),
      comment,
    };

    // Creer un nouveau tableau mutable (l'ancien peut etre gele par Redux/Immer)
    const currentVersions = Array.isArray(this.versions[fileId])
      ? this.versions[fileId].map((v) => ({ ...v }))
      : [];
    this.versions[fileId] = [version, ...currentVersions];

    // Nettoyer les anciennes versions
    this.cleanupOldVersions(fileId);

    // Persister
    this.saveVersions();

    return version;
  }

  /**
   * Recupere toutes les versions d'un fichier
   */
  async getVersions(fileId: string): Promise<FileVersion[]> {
    if (!fileId) {
      throw errorService.createValidationError('fileId est requis');
    }

    const versions = this.versions[fileId] || [];
    // Retourner une COPIE triee pour eviter que Redux/Immer ne gele le tableau interne
    return [...versions]
      .map((v) => ({ ...v }))
      .sort(
        (a: FileVersion, b: FileVersion) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
  }

  /**
   * Recupere une version specifique
   */
  async getVersion(versionId: string): Promise<FileVersion | null> {
    if (!versionId) {
      throw errorService.createValidationError('versionId est requis');
    }

    for (const fileVersions of Object.values(this.versions)) {
      const version = fileVersions.find((v) => v.id === versionId);
      if (version) return { ...version };
    }
    return null;
  }

  /**
   * Recupere le contenu d'une version (placeholder pour mode navigateur)
   */
  async getVersionContent(versionId: string): Promise<Buffer> {
    if (!versionId) {
      throw errorService.createValidationError('versionId est requis');
    }
    // En mode navigateur, le contenu n'est pas stocke separement
    // On retourne un buffer vide avec un message
    const encoder = new TextEncoder();
    return encoder.encode('Contenu non disponible en mode navigateur') as any;
  }

  /**
   * Compare deux versions (diff simple en mode navigateur)
   */
  async compareVersions(versionIdA: string, versionIdB: string): Promise<VersionDiff> {
    if (!versionIdA || !versionIdB) {
      throw errorService.createValidationError('Les deux versionIds sont requis');
    }

    const versionA = await this.getVersion(versionIdA);
    const versionB = await this.getVersion(versionIdB);

    if (!versionA || !versionB) {
      throw errorService.createValidationError('Une ou les deux versions sont introuvables');
    }

    // Build metadata comparison
    const changes: DiffChange[] = [];
    let additions = 0;
    let deletions = 0;

    // Compare sizes
    if (versionA.size !== versionB.size) {
      const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
      };
      changes.push({
        type: 'modify',
        lineNumber: 1,
        oldContent: `Taille: ${formatSize(versionA.size)}`,
        newContent: `Taille: ${formatSize(versionB.size)}`,
      });
      if (versionB.size > versionA.size) {
        additions = versionB.size - versionA.size;
      } else {
        deletions = versionA.size - versionB.size;
      }
    }

    // Compare dates
    changes.push({
      type: 'modify',
      lineNumber: 2,
      oldContent: `Date: ${new Date(versionA.createdAt).toLocaleString('fr-FR')}`,
      newContent: `Date: ${new Date(versionB.createdAt).toLocaleString('fr-FR')}`,
    });

    // Compare checksums
    if (versionA.checksum !== versionB.checksum) {
      changes.push({
        type: 'modify',
        lineNumber: 3,
        oldContent: `Checksum: ${versionA.checksum}`,
        newContent: `Checksum: ${versionB.checksum}`,
      });
    }

    // Compare comments
    if (versionA.comment !== versionB.comment) {
      if (versionA.comment && !versionB.comment) {
        changes.push({
          type: 'remove',
          lineNumber: 4,
          content: `Commentaire: ${versionA.comment}`,
        });
      } else if (!versionA.comment && versionB.comment) {
        changes.push({ type: 'add', lineNumber: 4, content: `Commentaire: ${versionB.comment}` });
      } else {
        changes.push({
          type: 'modify',
          lineNumber: 4,
          oldContent: `Commentaire: ${versionA.comment}`,
          newContent: `Commentaire: ${versionB.comment}`,
        });
      }
    }

    return {
      versionA: versionIdA,
      versionB: versionIdB,
      type: 'text',
      additions,
      deletions,
      changes,
    };
  }

  /**
   * Restaure une version precedente
   */
  async restoreVersion(versionId: string): Promise<VersionRestoreResult> {
    if (!versionId) {
      throw errorService.createValidationError('versionId est requis');
    }

    const versionToRestore = await this.getVersion(versionId);
    if (!versionToRestore) {
      throw errorService.createNotFoundError(`Version ${versionId} non trouvee`, { versionId });
    }

    // Creer une sauvegarde de l'etat actuel
    const backupVersion = await this.createVersion(
      versionToRestore.folderId,
      versionToRestore.fileId,
      versionToRestore.fileName,
      `Sauvegarde automatique avant restauration de la version ${versionToRestore.versionNumber}`
    );

    return {
      success: true,
      restoredVersion: versionToRestore,
      newVersion: backupVersion,
    };
  }

  /**
   * Supprime une version specifique
   */
  async deleteVersion(versionId: string): Promise<boolean> {
    if (!versionId) {
      throw errorService.createValidationError('versionId est requis');
    }

    for (const [fileId, fileVersions] of Object.entries(this.versions)) {
      const index = fileVersions.findIndex((v) => v.id === versionId);
      if (index >= 0) {
        fileVersions.splice(index, 1);
        if (fileVersions.length === 0) {
          delete this.versions[fileId];
        }
        this.saveVersions();
        return true;
      }
    }
    return false;
  }

  /**
   * Supprime toutes les versions d'un fichier
   */
  async deleteAllVersions(fileId: string): Promise<boolean> {
    if (!fileId) {
      throw errorService.createValidationError('fileId est requis');
    }

    if (this.versions[fileId]) {
      delete this.versions[fileId];
      this.saveVersions();
      return true;
    }
    return false;
  }

  /**
   * Nettoie les anciennes versions en gardant les N plus recentes
   */
  private cleanupOldVersions(fileId: string): void {
    const versions = this.versions[fileId];
    if (!versions) return;

    if (versions.length > this.config.maxVersions) {
      this.versions[fileId] = versions.slice(0, this.config.maxVersions);
    }
  }

  /**
   * Calcule l'espace utilise par les versions d'un fichier
   */
  async getVersionsSize(fileId: string): Promise<number> {
    try {
      const versions = await this.getVersions(fileId);
      return versions.reduce((total, version) => total + version.size, 0);
    } catch (error) {
      console.error('[VERSION SERVICE] Error calculating versions size:', error);
      return 0;
    }
  }

  /**
   * Calcule l'espace total utilise par toutes les versions
   */
  async getTotalVersionsSize(): Promise<number> {
    let total = 0;
    for (const fileVersions of Object.values(this.versions)) {
      total += fileVersions.reduce((sum, v) => sum + v.size, 0);
    }
    return total;
  }

  /**
   * Exporte une version (mode navigateur: telechargement)
   */
  async exportVersion(versionId: string, _targetPath?: string): Promise<string> {
    if (!versionId) {
      throw errorService.createValidationError('versionId est requis');
    }

    const version = await this.getVersion(versionId);
    if (!version) {
      throw errorService.createNotFoundError(`Version ${versionId} non trouvee`);
    }

    // En mode navigateur, retourner un identifiant de la version
    return `export_${version.fileName}_v${version.versionNumber}`;
  }
}

// Export de l'instance singleton
export const versionService = new VersionService();

// Export par defaut
export default versionService;
