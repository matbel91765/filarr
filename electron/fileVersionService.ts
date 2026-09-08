/**
 * fileVersionService — l'historique de versions des fichiers PERSONNELS.
 *
 * ── CE QU'IL REMPLACE, ET POURQUOI IL EXISTE ───────────────────────────────
 * `src/services/core/versionService.ts` tenait un historique qui ne stockait
 * JAMAIS un octet : des métadonnées dans localStorage, une empreinte tirée de
 * `generateUniqueId().substring(0, 8)` — donc une chaîne aléatoire, pas un
 * hachage — et un « Restaurer » qui affichait « version restaurée » sans rien
 * réécrire. Une interface qui annonce une restauration et n'en fait aucune est
 * pire que l'absence de fonction : elle invite à écraser un fichier en croyant
 * pouvoir revenir.
 *
 * Ici les octets sont VRAIMENT écrits, chiffrés sous la FEK du profil comme
 * tout le reste du coffre local, et l'empreinte est un vrai SHA-256 — ce qui
 * rend la déduplication possible et la restauration vérifiable.
 *
 * ── LE MODÈLE : ON PHOTOGRAPHIE L'AVANT, PAS L'APRÈS ───────────────────────
 * Les notes photographient le contenu ENREGISTRÉ. Pour un fichier, ce choix
 * perdrait l'état le plus précieux : celui d'AVANT la première modification.
 * Un fichier importé puis édité une fois n'aurait qu'un instantané — sa
 * version modifiée — et l'original serait parti sans laisser de trace.
 *
 * On photographie donc l'état REMPLACÉ. L'historique devient « tout ce que ce
 * fichier a été avant maintenant », l'état courant vit dans le fichier
 * lui-même, et l'original survit à la première sauvegarde. Restaurer, c'est
 * alors photographier l'état courant (il rejoint l'historique) puis réécrire
 * les octets choisis : aucun état n'est jamais perdu par une restauration.
 *
 * ── DISPOSITION SUR DISQUE ─────────────────────────────────────────────────
 *   {profil}/file-versions/{fileId}/index.enc     — méta JSON, plus récent d'abord
 *   {profil}/file-versions/{fileId}/v_<id>.enc    — un blob chiffré par version
 *
 * Le nom du fichier versionné vit dans la MÉTA, pas dans le chemin : un
 * renommage ne doit pas orpheliner l'historique.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import log from 'electron-log';

import StorageService from './storageService';
import { secureDeleteFile, secureDeleteDir } from './secureDelete';
import { DIR_VERSIONS_FICHIERS } from './profileDirs';

// Le nom vient du module qui tient AUSSI la liste des répertoires que le
// recensement des dossiers doit ignorer : les deux ne peuvent plus diverger.
const VERSIONS_DIRNAME = DIR_VERSIONS_FICHIERS;
const INDEX_FILENAME = 'index.enc';

/**
 * Combien d'états passés on garde par fichier.
 *
 * Un fichier n'est pas une note : il pèse volontiers des mégaoctets, et dix
 * instantanés d'un binaire de 50 Mo, c'est un demi-gigaoctet pour un seul
 * document. La rétention est donc plus courte que celle des notes, et doublée
 * d'un plafond de TAILLE ci-dessous — le nombre seul ne protège de rien.
 */
export const DEFAULT_MAX_VERSIONS = 10;

/**
 * Au-delà, on ne photographie pas.
 *
 * Le coût d'un instantané est celui d'un chiffrement complet du contenu
 * (PBKDF2 + AES-GCM sur tout le tampon). Sur un fichier de plusieurs centaines
 * de mégaoctets, versionner à chaque sauvegarde transformerait une frappe en
 * plusieurs secondes de gel et remplirait le disque en silence. Mieux vaut ne
 * pas versionner et le DIRE que versionner et faire ramer l'application.
 */
export const MAX_SNAPSHOT_BYTES = 25 * 1024 * 1024;

/** L'enveloppe totale gardée par fichier, tous instantanés confondus. */
export const MAX_TOTAL_BYTES_PER_FILE = 150 * 1024 * 1024;

export interface FileVersionMeta {
  id: string;
  fileId: string;
  fileName: string;
  folderId: string;
  versionNumber: number;
  size: number;
  /** SHA-256 hexadécimal du contenu EN CLAIR. Une vraie empreinte. */
  sha256: string;
  createdAt: string;
  comment?: string;
}

export interface SnapshotInput {
  fileId: string;
  fileName: string;
  folderId: string;
  /** Les octets REMPLACÉS — l'état d'avant. Voir l'en-tête. */
  bytes: Buffer;
  comment?: string;
}

export type SnapshotOutcome =
  | { status: 'created'; version: FileVersionMeta }
  | { status: 'unchanged' }
  | { status: 'too_large'; size: number; limit: number }
  | { status: 'failed'; reason: string };

// ── Chemins, et leur assainissement ─────────────────────────────────────────

/**
 * Les identifiants viennent du renderer : ils sont traités comme hostiles.
 * Un `..` accepté ici écrirait n'importe où sous le profil.
 */
function safeSegment(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function versionsDirForProfile(profileDataDir: string): string {
  return path.join(profileDataDir, VERSIONS_DIRNAME);
}

function versionsDirForFile(profileDataDir: string, fileId: string): string {
  return path.join(versionsDirForProfile(profileDataDir), safeSegment(fileId, 'fileId'));
}

function indexPath(profileDataDir: string, fileId: string): string {
  return path.join(versionsDirForFile(profileDataDir, fileId), INDEX_FILENAME);
}

function contentPath(profileDataDir: string, fileId: string, versionId: string): string {
  return path.join(
    versionsDirForFile(profileDataDir, fileId),
    `v_${safeSegment(versionId, 'versionId')}.enc`
  );
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function newVersionId(): string {
  return crypto.randomBytes(12).toString('hex');
}

// ── Sérialisation de l'index ────────────────────────────────────────────────

/**
 * Sérialise les écritures d'index PAR FICHIER.
 *
 * Une sauvegarde peut en chevaucher une autre (auto-sauvegarde débouncée qui
 * repart pendant qu'un enregistrement explicite est en vol). Deux passes
 * concurrentes feraient chacune un lire-modifier-écrire sur le même index, et
 * l'entrée de la première disparaîtrait sans bruit. Même remède que côté
 * notes, pour la même raison.
 */
const indexLocks = new Map<string, Promise<unknown>>();

function withIndexLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const precedent = indexLocks.get(key) ?? Promise.resolve();
  const suivant = precedent.then(fn, fn);
  // On garde une chaîne qui ne rejette JAMAIS : un échec ne doit pas
  // empoisonner toutes les écritures suivantes de ce fichier.
  indexLocks.set(
    key,
    suivant.catch(() => undefined)
  );
  return suivant;
}

async function readIndex(profileDataDir: string, fileId: string): Promise<FileVersionMeta[]> {
  try {
    const raw = await fs.readFile(indexPath(profileDataDir, fileId), 'utf-8');
    const decrypted = await StorageService.decrypt(raw);
    if (!Array.isArray(decrypted)) return [];
    return decrypted as FileVersionMeta[];
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    log.warn(`[fileVersionService] readIndex failed for ${fileId}:`, err);
    return [];
  }
}

async function writeIndex(
  profileDataDir: string,
  fileId: string,
  versions: FileVersionMeta[]
): Promise<void> {
  const dir = versionsDirForFile(profileDataDir, fileId);
  await fs.mkdir(dir, { recursive: true });

  const encrypted = await StorageService.encrypt(versions);
  const cible = indexPath(profileDataDir, fileId);
  // Nom de staging UNIQUE par écrivain : un `.tmp` partagé laissait deux
  // passes concurrentes se voler le fichier, et le second `rename` échouait en
  // ENOENT (Windows : EPERM, l'autre poignée étant encore ouverte).
  const tmp = `${cible}.${process.pid.toString(36)}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, encrypted, 'utf-8');
    await fs.rename(tmp, cible);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

// ── Rétention ───────────────────────────────────────────────────────────────

/**
 * PURE — tout le raisonnement de rétention tient ici, donc tout est testable
 * sans disque ni chiffrement. Rend la liste gardée et les identifiants à
 * effacer, jamais l'inverse : c'est la liste GARDÉE qui fait foi, pour qu'un
 * bug de calcul laisse des fichiers orphelins plutôt qu'il n'en supprime trop.
 */
export function applyRetention(
  versions: FileVersionMeta[],
  maxVersions: number,
  maxTotalBytes: number
): { kept: FileVersionMeta[]; dropped: FileVersionMeta[] } {
  const ordonne = [...versions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const kept: FileVersionMeta[] = [];
  const dropped: FileVersionMeta[] = [];
  let total = 0;
  for (const v of ordonne) {
    const taille = Number.isFinite(v.size) && v.size > 0 ? v.size : 0;
    // Le plus RÉCENT est toujours gardé, même s'il dépasse à lui seul
    // l'enveloppe : un historique vide est un pire service qu'un historique
    // trop gros, et l'entrée vient d'être payée.
    const tient = kept.length === 0 || (kept.length < maxVersions && total + taille <= maxTotalBytes);
    if (tient) {
      kept.push(v);
      total += taille;
    } else {
      dropped.push(v);
    }
  }
  return { kept, dropped };
}

// ── L'API ───────────────────────────────────────────────────────────────────

/**
 * Photographier l'état REMPLACÉ d'un fichier.
 *
 * Idempotent par le contenu : si les octets sont identiques à ceux du dernier
 * instantané, on ne réécrit rien. C'est le cas ordinaire d'une auto-sauvegarde
 * qui repart sans qu'une frappe soit arrivée entre-temps.
 */
export async function snapshot(
  profileDataDir: string,
  input: SnapshotInput
): Promise<SnapshotOutcome> {
  const { fileId, fileName, folderId, bytes, comment } = input;
  try {
    safeSegment(fileId, 'fileId');
  } catch {
    return { status: 'failed', reason: 'invalid_file_id' };
  }
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    // Un fichier vide n'a rien à restaurer, et « Nouveau document » en crée un
    // à chaque fois : le photographier remplirait l'historique de néant.
    return { status: 'unchanged' };
  }
  if (bytes.length > MAX_SNAPSHOT_BYTES) {
    return { status: 'too_large', size: bytes.length, limit: MAX_SNAPSHOT_BYTES };
  }

  return withIndexLock(`${profileDataDir}:${fileId}`, async () => {
    try {
      const empreinte = sha256(bytes);
      const index = await readIndex(profileDataDir, fileId);

      // DÉDUPLICATION — on compare au plus récent, pas à tout l'historique :
      // revenir à un état ancien est un événement RÉEL de la vie du fichier, et
      // l'effacer de la chronologie rendrait l'aller-retour invisible.
      if (index.length > 0 && index[0].sha256 === empreinte) {
        return { status: 'unchanged' } as SnapshotOutcome;
      }

      const versionId = newVersionId();
      const meta: FileVersionMeta = {
        id: versionId,
        fileId,
        fileName,
        folderId,
        versionNumber: (index[0]?.versionNumber ?? 0) + 1,
        size: bytes.length,
        sha256: empreinte,
        createdAt: new Date().toISOString(),
        comment,
      };

      const dir = versionsDirForFile(profileDataDir, fileId);
      await fs.mkdir(dir, { recursive: true });
      const chiffre = await StorageService.encryptBinary(bytes);
      // Le CONTENU d'abord, l'index ENSUITE : un index qui nomme un blob
      // absent est un « Restaurer » qui échoue, alors qu'un blob que l'index
      // ignore n'est qu'un octet perdu, ramassé au prochain nettoyage.
      await fs.writeFile(contentPath(profileDataDir, fileId, versionId), chiffre);

      const { kept, dropped } = applyRetention(
        [meta, ...index],
        DEFAULT_MAX_VERSIONS,
        MAX_TOTAL_BYTES_PER_FILE
      );
      await writeIndex(profileDataDir, fileId, kept);

      // Les évincés partent APRÈS que l'index ne les nomme plus.
      for (const mort of dropped) {
        await secureDeleteFile(contentPath(profileDataDir, fileId, mort.id)).catch(() => undefined);
      }

      return { status: 'created', version: meta } as SnapshotOutcome;
    } catch (err) {
      log.error('[fileVersionService] snapshot failed:', (err as Error).message);
      return { status: 'failed', reason: (err as Error).message } as SnapshotOutcome;
    }
  });
}

export async function listVersions(
  profileDataDir: string,
  fileId: string
): Promise<FileVersionMeta[]> {
  try {
    safeSegment(fileId, 'fileId');
  } catch {
    return [];
  }
  const index = await readIndex(profileDataDir, fileId);
  return [...index].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/**
 * Les octets d'une version, déchiffrés — et VÉRIFIÉS.
 *
 * L'empreinte est recalculée et comparée à celle de l'index. Un blob corrompu
 * (disque, synchronisation, édition manuelle) ne doit pas être réécrit sur le
 * fichier de l'utilisateur sous l'étiquette « restauré » : c'est exactement le
 * mensonge que ce module existe pour supprimer.
 */
export async function getVersionContent(
  profileDataDir: string,
  fileId: string,
  versionId: string
): Promise<Buffer | null> {
  try {
    const index = await readIndex(profileDataDir, fileId);
    const meta = index.find((v) => v.id === versionId);
    if (!meta) return null;

    const chiffre = await fs.readFile(contentPath(profileDataDir, fileId, versionId));
    const clair = await StorageService.decryptBinary(chiffre);
    if (sha256(clair) !== meta.sha256) {
      log.error(`[fileVersionService] checksum mismatch on ${fileId}/${versionId}`);
      return null;
    }
    return clair;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      log.error('[fileVersionService] getVersionContent failed:', (err as Error).message);
    }
    return null;
  }
}

export async function deleteVersion(
  profileDataDir: string,
  fileId: string,
  versionId: string
): Promise<boolean> {
  return withIndexLock(`${profileDataDir}:${fileId}`, async () => {
    try {
      const index = await readIndex(profileDataDir, fileId);
      const reste = index.filter((v) => v.id !== versionId);
      if (reste.length === index.length) return false;
      await writeIndex(profileDataDir, fileId, reste);
      await secureDeleteFile(contentPath(profileDataDir, fileId, versionId)).catch(
        () => undefined
      );
      return true;
    } catch (err) {
      log.error('[fileVersionService] deleteVersion failed:', (err as Error).message);
      return false;
    }
  });
}

export async function clearVersions(profileDataDir: string, fileId: string): Promise<boolean> {
  return withIndexLock(`${profileDataDir}:${fileId}`, async () => {
    try {
      await secureDeleteDir(versionsDirForFile(profileDataDir, fileId));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return true;
      log.error('[fileVersionService] clearVersions failed:', (err as Error).message);
      return false;
    }
  });
}

/** Ce que l'historique d'un fichier occupe sur le disque, en octets. */
export async function usageBytes(profileDataDir: string, fileId: string): Promise<number> {
  const index = await readIndex(profileDataDir, fileId);
  return index.reduce((total, v) => total + (Number.isFinite(v.size) ? v.size : 0), 0);
}

export const __internal = { applyRetention, sha256, safeSegment };
