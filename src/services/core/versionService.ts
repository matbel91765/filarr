/**
 * Service de gestion des versions de fichiers (Version History)
 *
 * Ce module gère le versionnement automatique des fichiers, permettant de:
 * - Sauvegarder automatiquement une version a chaque modification
 * - Conserver les N dernieres versions (configurable)
 * - Comparer les versions (diff)
 * - Restaurer une version precedente
 *
 * ── LE MAGASIN REEL, ET LE MODE DEGRADE ───────────────────────────────────
 * Sur le bureau les OCTETS sont vraiment ecrits : `fileVersionStore` parle au
 * magasin chiffre du processus principal, l'empreinte est un vrai SHA-256, et
 * « Restaurer » reecrit le fichier. Ce module ne fait plus qu'orchestrer.
 *
 * Dans un NAVIGATEUR il n'existe aucun magasin d'octets. On garde alors
 * l'index de metadonnees en localStorage, mais chaque entree porte
 * `contentAvailable: false` : l'interface doit desactiver « Restaurer » plutot
 * que de promettre une restauration qui n'aura pas lieu.
 *
 * C'est precisement le mensonge que cette version supprime — un historique qui
 * affichait « version restauree » sans jamais reecrire un octet, avec une
 * empreinte tiree d'un generateur aleatoire.
 */

import { generateUniqueId } from '../../utils/idGenerator';
import errorService from '../platform/errorService';
import profileStorage from './profileStorage';
import * as fileVersionStore from './fileVersionStore';
import type { FileVersionRecord } from './fileVersionStore';
import { decodeText } from '../../utils/textEncoding';
import { diffLignes, enLignes } from '../../utils/textDiff';

// ==================== CONSTANTES ====================

/**
 * Au-dela, on ne photographie pas. Doit rester ALIGNE sur `MAX_SNAPSHOT_BYTES`
 * de `electron/fileVersionService.ts` : le magasin refuserait de toute facon,
 * mais le savoir ici evite de LIRE un fichier enorme pour rien.
 */
export const MAX_SNAPSHOT_BYTES = 25 * 1024 * 1024;

/**
 * Normaliser ce que `readFile` a bien voulu rendre en octets.
 *
 * JETER PLUTOT QUE RENDRE VIDE — meme regle, et pour la meme raison, que dans
 * l'hote d'edition : un tableau vide de repli finirait ecrit par-dessus le
 * vrai fichier lors d'une restauration.
 */
function toBytes(data: unknown): Uint8Array {
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(
      view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer
    );
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(data as number[]);
  const serialise = data as { data?: unknown } | null;
  if (serialise && Array.isArray(serialise.data)) return new Uint8Array(serialise.data as number[]);
  throw new Error('unreadable_file_content');
}

// ==================== TYPES ====================

export interface FileVersion {
  id: string;
  fileId: string;
  fileName: string;
  folderId: string;
  versionNumber: number;
  size: number;
  /**
   * SHA-256 hexadecimal du contenu en clair sur le bureau.
   *
   * Longtemps c'etait `generateUniqueId().substring(0, 8)` — une chaine
   * ALEATOIRE. Deux versions identiques paraissaient donc differentes, et
   * « les empreintes different » etait vrai a chaque comparaison, par
   * construction. Vaut '' en mode degrade.
   */
  checksum: string;
  /**
   * Les octets de cette version sont-ils vraiment recuperables ?
   *
   * Faux = entree de journal seulement. L'interface DOIT alors refuser de
   * proposer une restauration : c'est le garde-fou contre le retour du
   * mensonge.
   */
  contentAvailable: boolean;
  createdAt: string;
  createdBy?: string;
  comment?: string;
  metadata?: Record<string, any>;
}

/**
 * Au-delà, la comparaison n'est plus lisible et le rendu construit une rangée
 * par ligne modifiée. On tronque, et on le dit dans le résultat.
 */
const MAX_LIGNES_DIFF = 2000;

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
        const brut = JSON.parse(saved) as Record<string, FileVersion[]>;
        // MIGRATION SILENCIEUSE. Les entrees ecrites avant le magasin reel
        // n'ont aucun octet derriere elles : `contentAvailable` absent DOIT
        // valoir faux. Le laisser indefini le rendrait falsy par accident —
        // vrai aujourd'hui, faux le jour ou quelqu'un ecrit `?? true`.
        this.versions = Object.fromEntries(
          Object.entries(brut).map(([fileId, liste]) => [
            fileId,
            (Array.isArray(liste) ? liste : []).map((v) => ({
              ...v,
              contentAvailable: v.contentAvailable === true,
            })),
          ])
        );
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
    force?: boolean,
    /**
     * Les octets a photographier — l'etat REMPLACE, pas le nouveau. Facultatif :
     * sans eux, le service va lire le fichier (voir `lireOctetsCourants`).
     */
    bytes?: Uint8Array
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

    // ── LE CHEMIN REEL ────────────────────────────────────────────────────
    // Si le magasin d'octets repond, c'est LUI qui fait foi : il chiffre, il
    // hache, il applique la retention. On ne touche pas a localStorage dans ce
    // cas — deux index pour la meme chose finissent par diverger.
    if (fileVersionStore.isAvailable()) {
      const octets = bytes ?? (await this.lireOctetsCourants(folderId, fileName, size));
      if (octets && octets.length > 0) {
        const issue = await fileVersionStore.snapshot({
          fileId,
          fileName,
          folderId,
          bytes: octets,
          comment,
        });
        if (issue.status === 'created') {
          const reelle = this.depuisEnregistrement(issue.version);
          this.versions[fileId] = [reelle, ...(this.versions[fileId] ?? [])].slice(
            0,
            this.config.maxVersions
          );
          return reelle;
        }
        if (issue.status === 'unchanged' && existingVersions.length > 0) {
          // Rien n'a bouge depuis le dernier instantane : renvoyer le plus
          // recent est plus honnete que de fabriquer un doublon.
          return { ...existingVersions[0] };
        }
        // 'too_large' ou 'failed' : on retombe sur l'entree de journal
        // ci-dessous, mais avec contentAvailable a FAUX. Un fichier trop gros
        // pour etre photographie doit le dire, pas faire semblant.
      }
    }

    const version: FileVersion = {
      id: generateUniqueId(),
      fileId,
      fileName,
      folderId,
      versionNumber,
      size: size || 0,
      checksum: '',
      contentAvailable: false,
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
   * Convertir un enregistrement du magasin reel en `FileVersion`.
   *
   * Un seul endroit fait cette traduction : c'est ici que `contentAvailable`
   * devient vrai, et nulle part ailleurs.
   */
  private depuisEnregistrement(rec: FileVersionRecord): FileVersion {
    return {
      id: rec.id,
      fileId: rec.fileId,
      fileName: rec.fileName,
      folderId: rec.folderId,
      versionNumber: rec.versionNumber,
      size: rec.size,
      checksum: rec.sha256,
      contentAvailable: true,
      createdAt: rec.createdAt,
      comment: rec.comment,
    };
  }

  /**
   * Lire les octets ACTUELS d'un fichier, pour les photographier.
   *
   * Les appelants historiques (« Ouverture du fichier », « Version initiale »)
   * ne fournissent pas d'octets : ils n'en avaient pas besoin, puisque rien
   * n'etait stocke. Plutot que de les reecrire un par un, on va chercher le
   * contenu ici — et leurs versions deviennent reelles sans qu'ils changent.
   *
   * L'import est DYNAMIQUE : `fileService` tire tout l'adaptateur de stockage,
   * et le charger au demarrage pour une fonction rarement empruntee alourdit
   * le premier rendu pour rien.
   */
  private async lireOctetsCourants(
    folderId: string,
    fileName: string,
    size?: number
  ): Promise<Uint8Array | null> {
    // Un plafond AVANT la lecture : ouvrir un fichier de 2 Go pour decider
    // ensuite qu'il est trop gros, c'est le gel qu'on veut eviter.
    if (typeof size === 'number' && size > MAX_SNAPSHOT_BYTES) return null;
    try {
      const { readFile } = await import('./fileService');
      const data = await readFile(folderId, fileName, true);
      return toBytes(data);
    } catch {
      // Illisible (fichier protege non deverrouille, blob absent) : pas de
      // version reelle. On ne fabrique surtout pas un tableau vide, qui
      // s'ecrirait ensuite par-dessus le vrai fichier a la restauration.
      return null;
    }
  }

  /**
   * Recupere toutes les versions d'un fichier
   */
  async getVersions(fileId: string): Promise<FileVersion[]> {
    if (!fileId) {
      throw errorService.createValidationError('fileId est requis');
    }

    // Le magasin reel fait foi quand il repond. On rafraichit le cache memoire
    // au passage : `getVersion(versionId)` et `compareVersions` s'en servent, et
    // ils n'ont pas le fileId sous la main.
    if (fileVersionStore.isAvailable()) {
      const enregistrements = await fileVersionStore.listVersions(fileId);
      const reelles = enregistrements.map((r) => this.depuisEnregistrement(r));
      this.versions[fileId] = reelles;
      return reelles.map((v) => ({ ...v }));
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
    const version = await this.getVersion(versionId);
    if (version && version.contentAvailable && fileVersionStore.isAvailable()) {
      const octets = await fileVersionStore.getVersionBytes(version.fileId, versionId);
      if (octets) return octets as unknown as Buffer;
    }
    // Sans magasin d'octets, il n'y a RIEN a rendre. On leve plutot que de
    // rendre un texte d'excuse : un appelant qui ecrirait ce texte dans le
    // fichier detruirait le document en croyant le restaurer.
    throw errorService.createNotFoundError(
      `Le contenu de la version ${versionId} n'est pas disponible`,
      { versionId }
    );
  }

  /**
   * Compare deux versions (diff simple en mode navigateur)
   */
  /**
   * Comparer deux versions PAR LEUR CONTENU.
   *
   * Cette méthode ne lisait jamais les octets : elle comparait la taille, la
   * date, l'empreinte et le commentaire. Comme la date change toujours, elle
   * rendait une « différence » sur chaque paire de versions, toujours la
   * même, qui n'apprenait rien. Il n'y avait donc pas de comparaison, juste
   * l'apparence d'une.
   *
   * On lit maintenant les deux versions. Trois issues, toutes déclarées :
   *  — les deux sont du texte lisible → différence ligne à ligne exacte ;
   *  — au moins une est binaire → on le dit, avec l'écart de taille ;
   *  — les octets manquent (version d'avant le magasin, ou purgée) → on le
   *    dit AUSSI, plutôt que de faire passer une absence pour une égalité.
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

    const octetsA = await this.octetsDeVersion(versionA);
    const octetsB = await this.octetsDeVersion(versionB);

    // ── Les octets manquent : un fait, pas une erreur ──
    if (!octetsA || !octetsB) {
      const manquante = !octetsA ? versionA : versionB;
      return {
        versionA: versionIdA,
        versionB: versionIdB,
        type: 'binary',
        additions: 0,
        deletions: 0,
        changes: [
          {
            type: 'modify',
            lineNumber: 1,
            oldContent: `Version du ${new Date(manquante.createdAt).toLocaleString()}`,
            newContent:
              'Contenu indisponible : cette version est anterieure au magasin de contenus, ou son instantane a ete purge.',
          },
        ],
      };
    }

    const texteA = decodeText(octetsA);
    const texteB = decodeText(octetsB);

    // ── Au moins une des deux est binaire ──
    if (!texteA || !texteB) {
      const ecart = octetsB.length - octetsA.length;
      const identiques =
        octetsA.length === octetsB.length && octetsA.every((o, i) => o === octetsB[i]);
      return {
        versionA: versionIdA,
        versionB: versionIdB,
        type: 'binary',
        additions: ecart > 0 ? ecart : 0,
        deletions: ecart < 0 ? -ecart : 0,
        changes: identiques
          ? []
          : [
              {
                type: 'modify',
                lineNumber: 1,
                oldContent: `${octetsA.length} octets`,
                newContent: `${octetsB.length} octets`,
              },
            ],
      };
    }

    // ── Deux textes : la vraie différence ──
    const resultat = diffLignes(enLignes(texteA.text), enLignes(texteB.text));
    const changes: DiffChange[] = [];

    if (resultat.approximatif) {
      // Dit AVANT le reste : ce qui suit est une approximation, et le lecteur
      // doit le savoir avant d'en tirer une conclusion.
      changes.push({
        type: 'modify',
        lineNumber: 0,
        oldContent: 'Comparaison approximative',
        newContent:
          'Les deux versions sont trop differentes pour une comparaison ligne a ligne exacte.',
      });
    }

    for (const ligne of resultat.lignes) {
      if (ligne.type === 'egal') continue;
      changes.push(
        ligne.type === 'ajout'
          ? { type: 'add', lineNumber: ligne.ligneB, content: ligne.texte }
          : { type: 'remove', lineNumber: ligne.ligneA, content: ligne.texte }
      );
      // Dix mille rangees ne se lisent plus, et le rendu les construit toutes.
      // On s'arrete, et on le DIT.
      if (changes.length >= MAX_LIGNES_DIFF) {
        changes.push({
          type: 'modify',
          lineNumber: 0,
          oldContent: 'Comparaison tronquee',
          newContent: `Seules les ${MAX_LIGNES_DIFF} premieres lignes modifiees sont affichees.`,
        });
        break;
      }
    }

    return {
      versionA: versionIdA,
      versionB: versionIdB,
      type: 'text',
      additions: resultat.ajouts,
      deletions: resultat.suppressions,
      changes,
    };
  }

  /**
   * Les octets d'une version, ou `null` s'ils ne sont pas disponibles.
   *
   * `getVersionContent` LÈVE quand le contenu manque — c'est le bon choix pour
   * une restauration, où rendre autre chose que les vrais octets détruirait le
   * fichier. Pour une comparaison, non : une version sans octets n'est pas une
   * erreur, c'est un fait à afficher.
   */
  private async octetsDeVersion(version: FileVersion): Promise<Uint8Array | null> {
    if (!version.contentAvailable || !fileVersionStore.isAvailable()) return null;
    try {
      const octets = await fileVersionStore.getVersionBytes(version.fileId, version.id);
      return octets ? new Uint8Array(octets) : null;
    } catch {
      return null;
    }
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

    // ── LE REFUS FRANC ────────────────────────────────────────────────────
    // Sans octets, il n'y a pas de restauration. On leve, et l'appelant
    // affichera l'echec. L'ancienne implementation renvoyait `success: true`
    // ici meme, sans avoir rien ecrit : l'utilisateur lisait « version
    // restauree » devant un fichier inchange.
    if (!versionToRestore.contentAvailable || !fileVersionStore.isAvailable()) {
      throw errorService.createValidationError(
        `Le contenu de la version ${versionToRestore.versionNumber} n'a pas ete conserve : ` +
          'restauration impossible'
      );
    }

    const octets = await fileVersionStore.getVersionBytes(versionToRestore.fileId, versionId);
    if (!octets || octets.length === 0) {
      // `null` couvre l'absence ET l'empreinte qui ne correspond plus. Dans les
      // deux cas on n'ecrit rien : reecrire un blob corrompu sous l'etiquette
      // « restaure » serait la pire des issues.
      throw errorService.createValidationError(
        `Les octets de la version ${versionToRestore.versionNumber} sont introuvables ou alteres`
      );
    }

    // L'ETAT COURANT REJOINT L'HISTOIRE, ET IL Y ENTRE AVANT L'ECRASEMENT.
    // Une restauration ne doit jamais etre le seul geste irreversible du
    // produit : apres celle-ci, revenir en arriere reste possible.
    let backupVersion: FileVersion | undefined;
    const courant = await this.lireOctetsCourants(
      versionToRestore.folderId,
      versionToRestore.fileName
    );
    if (courant && courant.length > 0) {
      backupVersion = await this.createVersion(
        versionToRestore.folderId,
        versionToRestore.fileId,
        versionToRestore.fileName,
        `Etat avant restauration de la version ${versionToRestore.versionNumber}`,
        courant.length,
        true,
        courant
      );
    }

    // L'ECRITURE REELLE. Meme porte que l'editeur : l'adaptateur rechiffre et
    // respecte le mode de stockage (local, hybride, nuage).
    const { default: storageAdapter } = await import('./storageAdapter');
    await storageAdapter.saveEncryptedFile(
      versionToRestore.folderId,
      versionToRestore.fileName,
      // Le type annonce `Buffer` — un heritage de @types/node dans le
      // renderer. L'implementation ne lit que `byteLength` et les octets :
      // meme cast que l'hote d'edition (FilePluginEditorModal).
      octets as unknown as Buffer
    );

    // LA META SUIT LES OCTETS — sinon la liste du dossier continue d'annoncer
    // l'ancienne taille et le tri par date ignore la restauration. Son echec
    // n'est PAS l'echec de la restauration : les octets sont deja ecrits, et
    // la prochaine relecture du dossier corrigera la ligne.
    try {
      const { updateFileMetadata } = await import('./fileService');
      await updateFileMetadata(versionToRestore.folderId, versionToRestore.fileId, {
        size: octets.byteLength,
        updatedAt: new Date().toISOString(),
      });
    } catch (metaErr) {
      console.warn('[VERSION SERVICE] metadata refresh failed after restore:', metaErr);
    }

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
        // Les octets d'abord : un index nettoye qui laisse le blob derriere
        // lui, c'est du disque perdu que plus rien ne nomme.
        if (fileVersions[index].contentAvailable && fileVersionStore.isAvailable()) {
          await fileVersionStore.deleteVersion(fileId, versionId);
        }
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

    if (fileVersionStore.isAvailable()) {
      await fileVersionStore.clearVersions(fileId);
    }

    if (this.versions[fileId]) {
      delete this.versions[fileId];
      this.saveVersions();
    }
    return true;
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
