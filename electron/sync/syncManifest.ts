/**
 * Sync Manifest — Local manifest management + merge algorithm
 *
 * The LOCAL manifest (sync-manifest.json) is NOT encrypted.
 * It contains only checksums, sizes, statuses — never file names or content.
 * File IDs are UUIDs, opaque to anyone reading the manifest.
 *
 * The CLOUD manifest (manifest.enc on R2) IS encrypted with the FEK.
 * Encryption/decryption is handled by syncService, not here.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { cheminDeStaging } from '../atomicStaging';
import { app } from 'electron';
import log from 'electron-log';
import { NOTES_META_FILE_ID } from './notesMergeCore';
import { LAYOUT_META_FILE_ID } from './layoutMergeCore';
import { REMINDER_META_FILE_IDS } from './reminderMetaDoc';

/**
 * Les blobs à FUSION, jamais à écrasement : un seul objet porte le travail des
 * DEUX appareils, donc le remplacer en entier détruit forcément un côté.
 *  - `meta:notes`  → fusion note à note (`downloadAndMergeNotes`)
 *  - `meta:layout` → fusion vue à vue  (`downloadAndMergeLayout`)
 */
const MERGED_META_FILE_IDS: ReadonlySet<string> = new Set([
  NOTES_META_FILE_ID,
  LAYOUT_META_FILE_ID,
  // Les deux fichiers de rappels racine relevent EXACTEMENT du meme cas : un
  // seul tableau porte les rappels des deux appareils, donc le remplacer en
  // entier detruit forcement un cote. Fusion enregistrement par enregistrement
  // dans `downloadAndMergeReminders`. Voir `reminderMetaDoc`.
  ...REMINDER_META_FILE_IDS,
]);

// ── Types ───────────────────────────────────────────────────────────────────

export type FileStatus =
  | 'synced'
  | 'pending_upload'
  | 'pending_download'
  | 'conflict'
  | 'deleted'
  | 'cloud-only'
  // Kept out of cloud sync (over the size cap, or a non-portable machine-key
  // V3 blob). Persisted in the local manifest so the batch status endpoint
  // (sync:getAllFileStatuses) reports it — the renderer badge used to blink
  // because these files were absent from the manifest and every batch refresh
  // erased the per-file event that had set the badge.
  | 'local_only';

export interface SyncFileEntry {
  checksum: string; // SHA-256 of encrypted content on disk
  size: number;
  updatedAt: string; // ISO timestamp of last local modification
  syncedAt: string | null; // ISO timestamp of last successful sync
  chunks: string[]; // R2 chunk keys
  status: FileStatus;
  localPath?: string; // local relative path (folderId/fileName) — only in local manifest, stripped before R2 upload
  /**
   * SHA-256 of the PLAINTEXT (device-independent) — set for block-level delta
   * files. Authoritative for cross-device change detection: the encrypted
   * on-disk `checksum` differs per device (fresh V3 salt), so two devices with
   * identical plaintext would otherwise loop re-uploading forever. mergeWithRemote
   * compares this when BOTH sides carry it.
   */
  plaintextChecksum?: string;
  /** Present iff this file is stored as content-addressed delta blocks. */
  delta?: { version: number; blockCount: number };
  /**
   * Sens du DERNIER transfert abouti ('up' = remonté, 'down' = descendu).
   * Le statut `synced` ne dit pas d'où vient le fichier, et la file de retry ne
   * garde que ce qui a échoué : sans ce champ, l'activité de sync ne pouvait
   * rien dire des transferts terminés. Optionnel — les manifestes écrits avant
   * son introduction restent lisibles tels quels, l'activité affiche alors le
   * transfert sans flèche.
   */
  lastDirection?: SyncDirection;
  /**
   * `meta:notes` seulement : ce blob v1 a été RÉÉCRIT par un appareil passé en
   * v2 (le pont vers les appareils restés en v1), pas écrit par un appareil v1.
   * Sans ce drapeau, le pont passait pour un écrivain v1 et bloquait la
   * migration de tous les autres appareils — voir `legacyObservationOf`.
   * Absent = écriture v1 ordinaire (ou manifeste antérieur au drapeau).
   */
  legacyWriteBack?: boolean;
}

/** Sens d'un transfert : 'up' = local → nuage, 'down' = nuage → local. */
export type SyncDirection = 'up' | 'down';

export interface SyncNoteEntry {
  checksum: string;
  updatedAt: string;
  syncedAt: string | null;
  status: FileStatus;
}

export interface SyncProfileMeta {
  id: string;
  name: string;
  avatarColor: string;
  avatarEmoji?: string;
  avatarImage?: string;
  isDefault: boolean;
  order: number;
  createdAt: string;
  /**
   * PIN hash (PBKDF2-SHA-256, 600k iterations) — synced between devices so
   * the user doesn't need to re-configure the PIN on every device.
   * Safe to include: the whole manifest is encrypted with the FEK before
   * upload, and the PIN hash is already non-reversible.
   */
  pinHash?: string;
  pinSalt?: string;
  allowPinReset?: boolean;
  /** ISO timestamp of last PIN mutation — used for last-write-wins merging */
  pinUpdatedAt?: string;
  /**
   * Horodatage ISO de la dernière mutation de la PRÉSENTATION du profil (nom,
   * couleur, emoji, image, ordre) — même arbitrage dernier-écrivain-gagne que
   * `pinUpdatedAt`, mais pour ce que l'écran de choix des profils montre.
   *
   * Son absence coûtait le voyage entier : `restoreProfileFromCloud` sort sur un
   * identifiant déjà connu, donc un profil renommé sur un appareil gardait son
   * ancien nom sur tous les autres, indéfiniment. Champ optionnel — un manifeste
   * écrit avant son introduction ne réclame rien, et le local reste intact.
   */
  metaUpdatedAt?: string;
}

export interface SyncManifest {
  version: number; // matches D1 manifest_version
  profileId: string;
  lastSyncAt: string;
  files: Record<string, SyncFileEntry>;
  notes: Record<string, SyncNoteEntry>;
  /** Profile metadata — synced so secondary devices can restore profiles */
  profileMeta?: SyncProfileMeta;
  /** StorageService encryption key (base64) — needed to decrypt metadata.json on other devices */
  encryptionKey?: string;
  /**
   * MARQUEUR DE CAPACITÉ — « l'appareil qui a écrit ce manifeste sait fusionner
   * les notes note à note » (voir NOTES_MERGE_VERSION). Il vit à la RACINE du
   * manifeste, à côté de `profileMeta`/`encryptionKey`, parce que c'est la seule
   * zone qui survit à l'aller-retour : le client web réécrit le manifeste par
   * `{ ...base, files: … }` (readSync.ts, « le web ne supprime jamais rien du
   * manifeste ») et conserve donc les champs racine qu'il ne connaît pas.
   *
   * Absence = repli sûr. Un desktop antérieur ignore le champ à la lecture (JSON
   * en trop, aucun code ne valide la forme) et, comme il reconstruit ce qu'il
   * pousse à partir de SON manifeste local qui ne le porte pas, il l'efface en
   * poussant : le nuage retombe alors tout seul dans l'état « un appareil de la
   * flotte ne fusionne pas ».
   */
  notesMergeVersion?: number;
}

export interface MergeResult {
  toUpload: string[];
  toDownload: string[];
  conflicts: string[];
}

// ── Paths ───────────────────────────────────────────────────────────────────

const MANIFEST_FILE = 'sync-manifest.json';

function getManifestPath(profileId: string): string {
  return path.join(
    app.getPath('userData'),
    'FilarData',
    'profiles',
    profileId,
    MANIFEST_FILE
  );
}

// ── Create Empty ────────────────────────────────────────────────────────────

export function createEmpty(profileId: string): SyncManifest {
  return {
    version: 0,
    profileId,
    lastSyncAt: new Date().toISOString(),
    files: {},
    notes: {},
  };
}

// ── Load / Save ─────────────────────────────────────────────────────────────

export async function load(profileId: string): Promise<SyncManifest | null> {
  try {
    const filePath = getManifestPath(profileId);
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as SyncManifest;
  } catch {
    return null;
  }
}

/** Délais entre deux essais de renommage, en ms — 620 ms au total, bornés. */
export const RENAME_RETRY_DELAYS_MS: readonly number[] = [20, 40, 80, 160, 320];
/** Les seuls codes qui signifient « quelqu'un tient le fichier », pas « impossible ». */
const RETRYABLE_RENAME_CODES: ReadonlySet<string> = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * `fs.rename` sur Windows échoue en EPERM quand la DESTINATION est ouverte par
 * quelqu'un d'autre : ce n'est pas un défaut de droits, c'est une collision de
 * quelques millisecondes. Ici elle est même provoquée par nous : le canal
 * instantané annonce notre propre publication ~1 ms après `putManifest`, le
 * cycle qu'il déclenche tombe sur « déjà en cours » et rend `getSyncStatus()`,
 * qui LIT `sync-manifest.json` — pendant que `save` le renomme.
 *
 * Mesuré le 05/09/2026 : 19 sauvegardes sur 50 perdues, chacune coûtant le
 * cycle entier (« Sync failed ») et une remontée en double au cycle suivant,
 * puisque l'état « déjà remonté » n'avait pas été écrit. Le lecteur garde le
 * fichier quelques millisecondes : on réessaie brièvement, et pas plus.
 *
 * Rend le nombre d'essais (1 = du premier coup). Toute autre erreur, ou la
 * même au-delà des délais, remonte telle quelle.
 */
export async function renameWithRetry(
  from: string,
  to: string,
  deps: {
    rename?: (from: string, to: string) => Promise<void>;
    sleep?: (ms: number) => Promise<void>;
    delays?: readonly number[];
  } = {}
): Promise<number> {
  const rename = deps.rename ?? ((f: string, t: string) => fs.rename(f, t));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const delays = deps.delays ?? RENAME_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return attempt + 1;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (!code || !RETRYABLE_RENAME_CODES.has(code) || attempt >= delays.length) throw err;
      await sleep(delays[attempt]);
    }
  }
}

export async function save(
  profileId: string,
  manifest: SyncManifest
): Promise<void> {
  const filePath = getManifestPath(profileId);
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  // Atomic write: write to temp then rename
  // Nom de staging UNIQUE : un `.tmp` partagé faisait échouer le renommage
  // du second écrivain en ENOENT — et un cycle de synchro entier avec lui.
  const tmpPath = cheminDeStaging(filePath);
  await fs.writeFile(tmpPath, JSON.stringify(manifest, null, 2), 'utf-8');
  const essais = await renameWithRetry(tmpPath, filePath);
  if (essais > 1) {
    log.warn(
      `[syncManifest] sync-manifest.json renommé au ${essais}e essai (lecteur concurrent)`
    );
  }
}

// ── File Status Updates ─────────────────────────────────────────────────────

export async function markPendingUpload(
  profileId: string,
  fileId: string,
  checksum: string,
  size: number,
  localPath?: string
): Promise<void> {
  const manifest = (await load(profileId)) || createEmpty(profileId);

  const existing = manifest.files[fileId];
  manifest.files[fileId] = {
    localPath: localPath || existing?.localPath,
    checksum,
    size,
    updatedAt: new Date().toISOString(),
    syncedAt: existing?.syncedAt || null,
    chunks: existing?.chunks || [],
    status: 'pending_upload',
  };

  await save(profileId, manifest);
}

export async function markSynced(
  profileId: string,
  fileId: string,
  chunks?: string[]
): Promise<void> {
  const manifest = (await load(profileId)) || createEmpty(profileId);

  const entry = manifest.files[fileId];
  if (entry) {
    entry.syncedAt = new Date().toISOString();
    entry.status = 'synced';
    if (chunks) entry.chunks = chunks;
  }

  await save(profileId, manifest);
}

export async function markConflict(
  profileId: string,
  fileId: string
): Promise<void> {
  const manifest = (await load(profileId)) || createEmpty(profileId);

  const entry = manifest.files[fileId];
  if (entry) {
    entry.status = 'conflict';
  }

  await save(profileId, manifest);
}

export async function markDeleted(
  profileId: string,
  fileId: string
): Promise<void> {
  const manifest = (await load(profileId)) || createEmpty(profileId);

  const entry = manifest.files[fileId];
  if (entry) {
    entry.status = 'deleted';
    entry.updatedAt = new Date().toISOString();
  }

  await save(profileId, manifest);
}

// ── Queries ─────────────────────────────────────────────────────────────────

export async function getItemsToUpload(
  profileId: string
): Promise<string[]> {
  const manifest = await load(profileId);
  if (!manifest) return [];

  return Object.entries(manifest.files)
    .filter(([, entry]) => entry.status === 'pending_upload')
    .map(([id]) => id);
}

export async function getItemsToDownload(
  profileId: string
): Promise<string[]> {
  const manifest = await load(profileId);
  if (!manifest) return [];

  return Object.entries(manifest.files)
    .filter(([, entry]) => entry.status === 'pending_download')
    .map(([id]) => id);
}

export async function getConflicts(
  profileId: string
): Promise<string[]> {
  const manifest = await load(profileId);
  if (!manifest) return [];

  return Object.entries(manifest.files)
    .filter(([, entry]) => entry.status === 'conflict')
    .map(([id]) => id);
}

export async function getAllFileStatuses(
  profileId: string
): Promise<Record<string, FileStatus>> {
  const manifest = await load(profileId);
  if (!manifest) return {};

  const statuses: Record<string, FileStatus> = {};
  for (const [id, entry] of Object.entries(manifest.files)) {
    statuses[id] = entry.status;
    // Also map by localPath so renderer can match by folderId/fileName
    if (entry.localPath) {
      statuses[entry.localPath] = entry.status;
      // Don't map by fileName alone — collisions when multiple files share the same name
    }
  }
  return statuses;
}

// ── Activity (read-only view of the manifest) ───────────────────────────────

/** Une ligne du panneau d'activité — tout vient du manifeste local, rien du réseau. */
export interface SyncActivityItem {
  fileId: string;
  /** Nom lisible tiré de `localPath` ; à défaut l'identifiant opaque. */
  name: string;
  localPath?: string;
  size: number;
  status: FileStatus;
  updatedAt: string;
  syncedAt: string | null;
  lastDirection?: SyncDirection;
}

export interface SyncActivity {
  recent: SyncActivityItem[];
  pending: SyncActivityItem[];
  conflicts: SyncActivityItem[];
}

/** Plafond par liste — le panneau est une fenêtre, pas un journal exhaustif. */
const ACTIVITY_CAP = 100;

function toActivityItem(fileId: string, entry: SyncFileEntry): SyncActivityItem {
  return {
    fileId,
    name: entry.localPath?.split('/').pop() || fileId,
    localPath: entry.localPath,
    size: entry.size,
    status: entry.status,
    updatedAt: entry.updatedAt,
    syncedAt: entry.syncedAt,
    lastDirection: entry.lastDirection,
  };
}

/**
 * Vue LECTURE SEULE du manifeste pour le panneau « Activité de sync ».
 *
 * Aucune migration : tout ce qui est rendu ici (taille, statut, horodatages,
 * chemin local) est déjà écrit par le moteur depuis toujours. Un manifeste
 * absent rend trois listes vides — jamais une erreur : le panneau doit pouvoir
 * s'ouvrir sur un profil qui n'a encore rien synchronisé.
 */
export async function getActivity(profileId: string): Promise<SyncActivity> {
  const m = await load(profileId);
  if (!m) return { recent: [], pending: [], conflicts: [] };

  const recent: SyncActivityItem[] = [];
  const pending: SyncActivityItem[] = [];
  const conflicts: SyncActivityItem[] = [];

  for (const [fileId, entry] of Object.entries(m.files)) {
    const item = toActivityItem(fileId, entry);
    if (entry.status === 'conflict') {
      conflicts.push(item);
    } else if (entry.status === 'pending_upload' || entry.status === 'pending_download') {
      pending.push(item);
    } else if (entry.syncedAt) {
      // Un transfert n'est « récent » que s'il a effectivement abouti une fois.
      recent.push(item);
    }
  }

  const desc = (a: string | null, b: string | null): number =>
    (b ? Date.parse(b) || 0 : 0) - (a ? Date.parse(a) || 0 : 0);

  recent.sort((a, b) => desc(a.syncedAt, b.syncedAt));
  pending.sort((a, b) => desc(a.updatedAt, b.updatedAt));
  conflicts.sort((a, b) => desc(a.updatedAt, b.updatedAt));

  return {
    recent: recent.slice(0, ACTIVITY_CAP),
    pending: pending.slice(0, ACTIVITY_CAP),
    conflicts: conflicts.slice(0, ACTIVITY_CAP),
  };
}

/**
 * Mark files as 'cloud-only' if they are 'synced' in the manifest
 * but don't exist on disk locally.
 */
export async function detectCloudOnlyFiles(
  profileId: string,
  baseDir: string
): Promise<void> {
  const m = await load(profileId);
  if (!m) return;

  let changed = false;
  for (const [, entry] of Object.entries(m.files)) {
    if (entry.status === 'synced' && entry.localPath) {
      const filePath = path.join(baseDir, entry.localPath);
      try {
        await fs.access(filePath);
      } catch {
        entry.status = 'cloud-only';
        changed = true;
      }
    }
  }

  if (changed) {
    await save(profileId, m);
  }
}

// ── Merge Algorithm ─────────────────────────────────────────────────────────

/** Horodatage ISO exploitable en millisecondes, ou `null` (absent/illisible). */
function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Compare local manifest with remote manifest and determine what needs
 * to be uploaded, downloaded, or flagged as conflict.
 *
 * Rules:
 *   - Local only (not in remote) → toUpload
 *   - Remote only (not in local) → toDownload
 *   - Both exist, same checksum → skip (already synced)
 *   - Both exist, different checksum:
 *       - Local updated after remote syncedAt AND remote updated after local syncedAt → conflict
 *       - Local updated after remote syncedAt → toUpload
 *       - Remote updated after local syncedAt → toDownload
 *   - Status 'deleted' in local → skip (deletion handled separately)
 *
 * GARDE DE SÛRETÉ (voir `hasUnpushedLocalEdits` plus bas) : un `toDownload`
 * ÉCRASE le fichier local (syncService.downloadFile réécrit le chemin en place).
 * Tant que l'entrée locale porte des modifications jamais remontées, ce
 * téléchargement bascule vers le chemin de CONFLIT, qui met une copie de côté
 * avant toute réécriture. La règle « conflit » d'origine exige que les DEUX
 * côtés aient bougé depuis la synchro d'en face — ce qui est faux dès que le
 * local est simplement EN RETARD d'horloge (édition hors ligne, remontée
 * échouée) alors qu'il porte pourtant du contenu que personne d'autre n'a.
 */
/**
 * FAUT-IL REPUBLIER LE MANIFESTE ?
 *
 * Il l'etait a CHAQUE cycle, meme parfaitement vide : `lastSyncAt` vaut
 * « maintenant » a chaque passage, donc le document differait toujours. Dans les
 * journaux du 2026-09-02, la version passe de 9886 a 9891 en vingt minutes sur
 * cinq cycles qui n'ont rien transfere.
 *
 * C'etait sans consequence tant que personne n'ecoutait. Ca ne l'est plus : le
 * canal de notification se declenche sur l'avancee de cette version. Deux
 * appareils suffisaient alors a fabriquer une BOUCLE — A publie, le canal
 * reveille B, B publie, le canal reveille A — a la vitesse du reseau, sans fin,
 * et sans qu'aucune note ne bouge.
 *
 * DELIBEREMENT CONSERVATRICE : elle ne rend `false` que si RIEN n'a bouge dans
 * le cycle ET que ce qu'on publierait est deja, mot pour mot, ce que le nuage
 * porte. Au moindre doute, on publie — une republication de trop coute une
 * requete, une republication manquante coute la convergence.
 */
export function shouldRepublishManifest(input: {
  uploads: number;
  downloads: number;
  conflicts: number;
  deletions: number;
  /** Le cycle des notes v2 a publie son index : le manifeste doit suivre. */
  notesPublished: boolean;
  /** Marqueur de capacite que NOUS annoncons. */
  notesMergeVersion: number;
  remote: Pick<SyncManifest, 'files' | 'profileMeta' | 'notesMergeVersion'>;
  publishedFiles: Record<string, SyncFileEntry>;
  profileMeta: SyncManifest['profileMeta'] | undefined;
}): boolean {
  if (input.uploads > 0 || input.downloads > 0) return true;
  if (input.conflicts > 0 || input.deletions > 0) return true;
  if (input.notesPublished) return true;
  // Notre marqueur de capacite manque au nuage : le poser est la seule facon
  // qu'un client web s'autorise a remonter ses notes (voir notesPushAllowed).
  if (input.remote.notesMergeVersion !== input.notesMergeVersion) return true;
  if (JSON.stringify(input.publishedFiles) !== JSON.stringify(input.remote.files)) return true;
  if (
    JSON.stringify(input.profileMeta ?? null) !== JSON.stringify(input.remote.profileMeta ?? null)
  ) {
    return true;
  }
  return false;
}

export function mergeWithRemote(
  local: SyncManifest,
  remote: SyncManifest,
  opts: {
    /**
     * « Cette empreinte distante est-elle des octets que CET appareil a
     * remontés ? » Sert aux blobs à fusion (voir la règle plus bas). Sans lui,
     * seule l'estampille `syncedAt` distingue notre entrée de celle d'un autre.
     */
    isOwnUpload?: (fileId: string, checksum: string) => boolean;
  } = {}
): MergeResult {
  const { isOwnUpload } = opts;
  const toUpload: string[] = [];
  const toDownload: string[] = [];
  const conflicts: string[] = [];

  log.info('[merge] Local files:', Object.keys(local.files || {}));
  log.info('[merge] Remote files:', Object.keys(remote.files || {}));

  // Collect all file IDs from both manifests
  const allFileIds = new Set([
    ...Object.keys(local.files),
    ...Object.keys(remote.files),
  ]);

  log.info('[merge] Total unique IDs:', allFileIds.size);

  for (const fileId of allFileIds) {
    const localEntry = local.files[fileId];
    const remoteEntry = remote.files[fileId];

    log.info('[merge] Processing:', fileId,
      'local:', localEntry ? `${localEntry.status}/${localEntry.checksum?.slice(0, 8)}` : 'NONE',
      'remote:', remoteEntry ? `${remoteEntry.status}/${remoteEntry.checksum?.slice(0, 8)}` : 'NONE'
    );

    // Skip deleted files
    if (localEntry?.status === 'deleted') continue;
    if (remoteEntry?.status === 'deleted') continue;

    // Skip local-only files entirely: they are deliberately excluded from
    // cloud sync (oversized / non-portable), so they must neither be
    // scheduled for upload nor be overwritten by a remote download.
    if (localEntry?.status === 'local_only') continue;

    // Un conflit DÉJÀ ouvert attend l'arbitrage de l'utilisateur
    // (sync:resolveConflict). Le reprendre à chaque cycle referait une copie
    // `_conflict_<horodatage>` toutes les cinq minutes sans jamais converger.
    //
    // LES BLOBS À FUSION SONT EXEMPTÉS (notes ET mise en page) : leur fusion
    // au grain de l'entrée EST la résolution du conflit, elle ne demande aucun
    // arbitrage. Sauter l'entrée les aurait figés POUR TOUJOURS (dans les deux
    // sens) dès qu'un ancien cycle l'avait marquée `conflict` — plus aucune
    // fusion, donc plus aucun moyen de sortir du statut. Les deux descentes
    // réécrivent l'entrée (`synced` / `pending_upload`) après chaque fusion
    // réussie, ce qui la fait retomber d'elle-même vers un statut sain.
    if (localEntry?.status === 'conflict' && !MERGED_META_FILE_IDS.has(fileId)) continue;

    if (localEntry && !remoteEntry) {
      // Local only → upload
      toUpload.push(fileId);
    } else if (!localEntry && remoteEntry) {
      // Remote only → download
      toDownload.push(fileId);
    } else if (localEntry && remoteEntry) {
      // Both exist — compare content. For delta files the encrypted-on-disk
      // `checksum` is device-specific (fresh V3 salt per re-encrypt), so when
      // BOTH sides carry a plaintextChecksum we compare THAT instead — else two
      // devices holding identical plaintext would re-upload forever.
      const bothPlain =
        !!localEntry.plaintextChecksum && !!remoteEntry.plaintextChecksum;
      const sameContent = bothPlain
        ? localEntry.plaintextChecksum === remoteEntry.plaintextChecksum
        : localEntry.checksum === remoteEntry.checksum;
      if (sameContent) {
        // Same content — already synced, nothing to do
        continue;
      }

      const localSyncedMs = parseMs(localEntry.syncedAt);
      const localUpdatedMs = parseMs(localEntry.updatedAt);
      const remoteUpdatedMs = parseMs(remoteEntry.updatedAt);

      // ── meta:notes / meta:layout — jamais d'écrasement, dans AUCUN sens ───
      // Ce sont les fichiers dont les deux appareils éditent des MORCEAUX
      // différents (une note ici, une note là ; l'accueil ici, un dossier là) :
      // les remplacer en entier détruit forcément le travail d'un côté. Le
      // téléchargement les traite à part (`downloadAndMergeNotes`,
      // `downloadAndMergeLayout`) — fusion au grain de l'entrée puis remontée de
      // l'union. La remontée directe n'est permise que si nous sommes
      // strictement en avance, et « en avance » se juge sur l'IDENTITÉ de
      // l'entrée distante, jamais sur ses horloges.
      //
      // LA BOUCLE DU 05/09/2026. Deux bureaux (prod et dev) sur le même profil
      // ont chacun remonté leur `notes.enc` toutes les 20 s pendant une heure :
      // plus de 100 envois, ~720 Mo, pour des notes identiques. La règle d'alors
      // comparait le `updatedAt` distant (le mtime du fichier de l'AUTRE, vieux
      // d'une heure) à notre `syncedAt` (notre remontée d'il y a 20 s) : chacun
      // concluait « le distant n'a pas bougé depuis ma remontée, je suis en
      // avance » et écrasait aveuglément le blob d'en face. Symétrique, donc
      // perpétuel ; le canal instantané en a fait une boucle serrée.
      //
      // Le distant est « à nous » dans exactement deux cas : c'est notre propre
      // remontée qui nous revient — l'estampille `syncedAt` est CELLE que nous
      // avons posée puis publiée dans le même souffle, tout autre écrivain pose
      // la sienne — ou ce sont des octets que cet appareil a lui-même remontés
      // (`isOwnUpload` : l'autre appareil les a ADOPTÉS et republiés sous sa
      // propre estampille). Sinon quelqu'un d'autre a écrit : on descend et on
      // fusionne. La fusion est idempotente — un contenu identique est adopté à
      // l'octet près (`installRemoteBytes`) — et la boucle s'éteint dès qu'UN
      // seul des deux appareils applique cette règle.
      if (MERGED_META_FILE_IDS.has(fileId)) {
        const ownStamp = !!localEntry.syncedAt && remoteEntry.syncedAt === localEntry.syncedAt;
        const ownBytes = !!isOwnUpload && isOwnUpload(fileId, remoteEntry.checksum);
        const remoteIsOurs = ownStamp || ownBytes;
        const court = (c: string): string => c.slice(0, 8);
        log.info(
          `[merge] ${fileId} divergent — local ${court(localEntry.checksum)} ` +
            `(synced ${localEntry.syncedAt ?? 'nul'}) / distant ${court(remoteEntry.checksum)} ` +
            `(updated ${remoteEntry.updatedAt}, synced ${remoteEntry.syncedAt ?? '?'}) → ` +
            (remoteIsOurs ? 'remontée (notre entrée)' : 'descente et fusion (autre écrivain)')
        );
        if (remoteIsOurs) {
          toUpload.push(fileId);
        } else {
          toDownload.push(fileId);
        }
        continue;
      }

      /**
       * Le local porte-t-il des modifications JAMAIS remontées ? `scanLocalFiles`
       * repose `updatedAt` (mtime du fichier) et laisse `syncedAt` intact à
       * chaque écriture locale, et `markPendingUpload` fait de même : l'écart
       * entre les deux EST la trace d'un contenu que le nuage n'a jamais vu.
       * `syncedAt` nul (jamais remonté) et un horodatage illisible comptent tous
       * deux comme « non remonté » — dans le doute, on protège.
       */
      const hasUnpushedLocalEdits =
        localSyncedMs === null || localUpdatedMs === null || localUpdatedMs > localSyncedMs;

      /** Téléchargement — dérouté vers le conflit s'il devait écraser du local jamais remonté. */
      const scheduleDownload = (): void => {
        if (hasUnpushedLocalEdits) {
          conflicts.push(fileId);
        } else {
          toDownload.push(fileId);
        }
      };

      // Handle first-sync scenarios (one or both sides never synced)
      if (!localEntry.syncedAt || !remoteEntry.syncedAt) {
        if (!localEntry.syncedAt && remoteEntry.syncedAt) {
          // Remote was previously synced, local never was → remote wins (new device scenario)
          // …sauf que le fichier local existe et n'a JAMAIS été remonté : c'est
          // exactement le cas où l'écraser détruit la seule copie.
          scheduleDownload();
        } else if (localEntry.syncedAt && !remoteEntry.syncedAt) {
          // Local was previously synced, remote never was → local wins
          toUpload.push(fileId);
        } else {
          // Both never synced → compare timestamps
          const localTime = new Date(localEntry.updatedAt).getTime();
          const remoteTime = new Date(remoteEntry.updatedAt).getTime();
          if (localTime >= remoteTime) {
            toUpload.push(fileId);
          } else {
            scheduleDownload();
          }
        }
        continue;
      }

      const localTime = new Date(localEntry.updatedAt).getTime();
      const remoteTime = new Date(remoteEntry.updatedAt).getTime();
      const localSyncedAt = new Date(localEntry.syncedAt).getTime();
      const remoteSyncedAt = new Date(remoteEntry.syncedAt).getTime();

      const localChangedSinceRemoteSync = localTime > remoteSyncedAt;
      const remoteChangedSinceLocalSync = remoteTime > localSyncedAt;

      if (localChangedSinceRemoteSync && remoteChangedSinceLocalSync) {
        // Both changed since last sync — conflict
        conflicts.push(fileId);
      } else if (localChangedSinceRemoteSync) {
        // Only local changed — upload
        toUpload.push(fileId);
      } else if (remoteChangedSinceLocalSync) {
        // Only remote changed — download (conflit si le local n'a jamais été remonté)
        scheduleDownload();
      }
      // Neither changed (stale timestamps) → skip
    }
  }

  log.info(
    `[syncManifest] Merge result: ${toUpload.length} upload, ${toDownload.length} download, ${conflicts.length} conflicts`
  );

  return { toUpload, toDownload, conflicts };
}
