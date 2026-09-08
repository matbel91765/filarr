/**
 * Sync Service — Orchestrator for cloud synchronization
 *
 * Runs in the Electron main process. Coordinates:
 *   - syncR2Client (upload/download chunks + manifest)
 *   - syncManifest (local manifest + merge algorithm)
 *   - syncQueue (persistent retry queue)
 *   - StorageService (encrypt/decrypt manifest, read local files)
 *
 * Manifest encryption uses the FEK (shared across devices via pairing).
 * Files on disk are already encrypted with FEK — uploaded as-is.
 * Legacy manifests encrypted with the local StorageService key are
 * auto-detected and decrypted via decryptManifestAuto().
 */

import { app, BrowserWindow, net } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import log from 'electron-log';
import { streamingSha256 } from './multipartTransfer';
import { StampRegistry, type StatLike } from './scanStamp';
import { VaultWatcher } from './vaultWatcher';
import { SyncMetrics, formatSnapshot } from './syncMetrics';
import {
  afterAttempt,
  afterCommit,
  initialState,
  pendingCount,
  selectForSweep,
  type GcFileState,
} from './deltaGcSweep';
import chokidar from 'chokidar';
import StorageService from '../storageService';
import profileManager from '../profileManager';
import * as reminderScheduler from '../reminderScheduler';
import { isAuthenticated, getMe, authenticatedApiCall } from '../authService';
import * as r2 from './syncR2Client';
import * as manifest from './syncManifest';
import * as channel from './syncChannelClient';
import * as notesCycle from './notesCycleV2';
import { isMachineV3WriteEnabled } from '../machineContainerV3';
import { upgradeNotesVaultContainers } from './notesVaultIO';
import { decideLegacyVerdict, legacyObservationOf, type LegacyVerdict } from './notesVaultStore';
import { createVaultIO } from './notesVaultIO';
import { NOTES_DIR, NOTES_INDEX_FILENAME, isNotesIndexShape, normalizeIndex } from './notesStoreV2';
import {
  DIR_VERSIONS_NOTES,
  DIR_VERSIONS_FICHIERS,
  estCopieDeConflit,
  nomDeCopieDeConflit,
} from '../profileDirs';
import * as queue from './syncQueue';
import * as deltaSync from './deltaSync';
import { DELTA_THRESHOLD } from './deltaManifest';
import type { SyncManifest, SyncProfileMeta, SyncFileEntry, MergeResult } from './syncManifest';
import { SyncConflictError } from './syncR2Client';
import { isNoteInLiveSession } from './liveNotes';
import {
  applyConflictCopies,
  collectMergeBase,
  deepEqual,
  dropLiveSessionConflicts,
  mergeNotesPayload,
  preserveLiveSessionNotes,
  selectGenuineConflicts,
  NOTES_BLOB_FILENAME,
  NOTES_MERGE_VERSION,
  NOTES_META_FILE_ID,
  NOTES_META_RESOURCE_ID,
  type NotesMergeBase,
  type NotesPayload,
} from './notesMergeCore';
import { withNotesLock } from './notesLock';
import {
  mergeLayoutDocuments,
  normalizeLayoutDocument,
  LAYOUT_BLOB_FILENAME,
  LAYOUT_META_FILE_ID,
  type LayoutDocument,
} from './layoutMergeCore';
import { withLayoutLock } from './layoutStore';
import {
  REMINDER_META_FILES,
  REMINDER_META_FILE_IDS,
  mergeReminderDocs,
  reminderMetaFilename,
} from './reminderMetaDoc';

// Real HTTP transport for the delta routes (stateless — safe as a module const).
const deltaTransport = r2.createDeltaTransport();

/** FEK-side crypto provider bridging StorageService into deltaSync. */
function getDeltaCrypto(): deltaSync.DeltaCrypto {
  return {
    getFek: () => StorageService.getFekForDeltaSync(),
    encryptManifest: (plain: Buffer) => StorageService.encryptWithFEK(plain),
    decryptManifest: (enc: Buffer) => StorageService.decryptManifestAuto(enc),
  };
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'error' | 'offline';
  lastSyncAt: string | null;
  pendingItems: number;
  failedItems: number;
  conflicts: number;
  storageUsed: number;
  storageLimit: number;
}

type StatusChangeHandler = (status: SyncStatus) => void;

// ── Constants ───────────────────────────────────────────────────────────────

const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes
const DEBOUNCE_DELAY = 10 * 1000; // 10 seconds
/**
 * Secondes apres le demarrage pendant lesquelles le cycle des notes ne balaie
 * pas les images : le balayage relit chaque note (PBKDF2) et, lance en meme
 * temps que `notes:load`, doublait le temps d'ouverture des notes.
 */
const NOTES_SWEEP_STARTUP_GRACE_S = 180;
/**
 * Temps maximal que la FERMETURE accorde au dernier cycle (`flushBeforeQuit`).
 * Au-delà, on rend la main : mieux vaut une remontée reportée — la marque
 * `pending_upload` est déjà sur le disque — qu'une fenêtre qui refuse de mourir.
 */
const QUIT_FLUSH_BUDGET_MS = 8 * 1000; // 8 secondes
/**
 * CADENCE DU SONDAGE DE CHANGEMENT DISTANT.
 *
 * Le démon ne connaissait qu'UNE horloge : `SYNC_INTERVAL`. Un appareil
 * n'apprenait donc l'existence d'une modification faite ailleurs qu'au bout de
 * cinq minutes, alors que le client web, lui, sonde toutes les 20 s depuis
 * longtemps (voir `src/platform/web/sync/syncScheduler.ts`). D'où l'asymétrie
 * que l'on constatait : bureau → web en ~30 s, web → bureau en cinq minutes.
 *
 * Le sondage ne fait qu'un GET CONDITIONNEL du manifeste (`If-None-Match`), que
 * `getManifest` sait déjà faire : en régime établi le serveur répond 304, sans
 * corps, sans déchiffrement, sans fusion. Ce n'est un cycle complet que lorsque
 * la version distante a réellement bougé.
 *
 * DEUX CADENCES, parce que sonder toutes les dix secondes une application posée
 * dans la barre des tâches revient à payer 8 640 requêtes par jour pour
 * personne. Fenêtre au premier plan : `PROBE_INTERVAL_FOCUSED`. Sinon :
 * `PROBE_INTERVAL_BACKGROUND` — le filet de `SYNC_INTERVAL` reste par-dessus.
 */
const PROBE_INTERVAL_FOCUSED = 10 * 1000; // 10 secondes
const PROBE_INTERVAL_BACKGROUND = 45 * 1000; // 45 secondes
/** Échecs consécutifs au-delà desquels le sondage se tait (jusqu'au prochain cycle réussi). */
const PROBE_MAX_FAILURES = 3;
const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB
const MAX_PARALLEL_UPLOADS = 3;
const MAX_PARALLEL_DOWNLOADS = 3;
// Size gates for cloud sync:
//  - Files up to MAX_SYNC_FILE_SIZE go through the historical buffered
//    pipeline (whole-file fs.readFile) — fine at 500 MB.
//  - PORTABLE blobs (V3 containers decryptable with the account FEK — i.e.
//    hybrid V3-FEK files written by hybrid:saveFromPath) sync up to
//    MAX_PORTABLE_SYNC_FILE_SIZE via the resumable multipart path, which
//    streams from disk with flat memory (64 MiB parts + ranged downloads).
//  - Machine-key V3 blobs (LOCAL-mode profiles) above MAX_SYNC_FILE_SIZE
//    stay local-only: they are NOT portable across devices (the V3 key is
//    the per-machine StorageService key), so shipping them to R2 would
//    produce undecryptable files on every other device.
const MAX_SYNC_FILE_SIZE = 500 * 1024 * 1024; // 500 MB
// Portable-blob sync ceiling: raised 5 GiB → 5 TiB to match the direct-to-R2
// data plane and R2's own multipart hard cap (DIRECT_TOTAL_MAX_BYTES). The
// resumable multipart path streams from disk with flat memory, so the size is
// bounded by R2, not by main-process RAM. The machine-key-V3 local_only
// portability rule below (isPortableV3File) is unchanged.
const MAX_PORTABLE_SYNC_FILE_SIZE = 5 * 1024 * 1024 * 1024 * 1024; // 5 TiB (R2 multipart hard cap)

// Encrypted-blob names to never sync: in-flight V3 staging files written by
// saveEncryptedFileFromPathV3/FEK before their atomic rename.
const V3_STAGING_MARKER = '.v3staging-';
// In-flight portable-FEK auto-migration staging files written by
// StorageService.migrateToPortableFEK before its atomic rename. A hard crash
// mid-migration can leave one on disk; it must never be scanned as vault
// content (a completed one is a valid FEK blob and would otherwise upload as a
// phantom duplicate of the original file).
const MIGRATION_STAGING_MARKER = '.migrating-';
// In-flight ranged-download temp files (can exist for minutes on multi-GB
// blobs) — must not be scanned as vault content either.
const SYNC_DL_TMP_SUFFIX = '.syncdl.tmp';

// Resume state for multipart uploads (token/uploadId/etags — no key material),
// stored next to sync-manifest.json.
const MULTIPART_RESUME_FILE = 'multipart-resume.json';

function getResumeStorePath(profileId: string): string {
  return path.join(
    app.getPath('userData'),
    'FilarData',
    'profiles',
    profileId,
    MULTIPART_RESUME_FILE
  );
}

// ── State ───────────────────────────────────────────────────────────────────

let activeProfileId: string | null = null;
let mainWindow: BrowserWindow | null = null;
let syncTimer: ReturnType<typeof setInterval> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
// ── Sondage de changement distant (voir PROBE_INTERVAL_*) ───────────────────
let probeTimer: ReturnType<typeof setInterval> | null = null;
/**
 * L OBSERVATEUR DU COFFRE — lot 1 du chantier synchronisation.
 *
 * Il ne synchronise rien : il marque sale, et le demon decide. Le drapeau est
 * une PORTE OUVERTE — un fichier sale est toujours rehache, un fichier non sale
 * peut quand meme l etre. Si l observateur rate un evenement ou ne demarre pas,
 * on retombe donc exactement sur le comportement d avant.
 */
let vaultWatcher: VaultWatcher | null = null;

/**
 * L INSTRUMENTATION — lot 93 du chantier synchronisation.
 *
 * « Sans elle, aucune des autres n est demontrable. » Elle ne telephone nulle
 * part : les compteurs restent locaux et sont lus par l ecran de diagnostic.
 * Une instrumentation qui sortirait du poste serait une trahison du modele de
 * menace du produit.
 *
 * Elle n est PAS remise a zero entre deux cycles : ce qu on veut voir, c est la
 * tendance sur une session, pas la photo d un cycle.
 */
const metrics = new SyncMetrics();

/**
 * LE RATTRAPAGE DU RAMASSAGE — complement du lot 26.
 *
 * Le ramassage normal suit chaque commit de manifeste, en `.catch(() =>
 * undefined)`. Un GC rate ne repasse donc jamais de lui-meme, et les orphelins
 * d un fichier ecrit une fois attendent un televersement qui ne viendra pas.
 * Cet etat retient qui doit etre repris.
 *
 * En memoire seulement, et c est assume : un redemarrage rend l etat vide, donc
 * chaque fichier redevient candidat une fois. C est le bon defaut — on preferera
 * toujours un ramassage de trop a un orphelin oublie, et le serveur est
 * idempotent, garde par version et protege par sa fenetre de grace.
 */
const gcStates = new Map<string, GcFileState>();

/** Combien de fichiers attendent un rattrapage — pour l ecran de diagnostic. */
export function pendingGcCount(): number {
  return pendingCount([...gcStates.values()], Date.now());
}

/** Instantane des compteurs — expose pour l ecran de diagnostic et les tests. */
export function getSyncMetrics(): ReturnType<SyncMetrics['snapshot']> {
  return metrics.snapshot();
}

/** Resume lisible des compteurs, pour le journal et le diagnostic. */
export function formatSyncMetrics(): string {
  return formatSnapshot(metrics.snapshot());
}

/** Remet les compteurs a zero. Reserve au diagnostic. */
export function resetSyncMetrics(): void {
  metrics.reset();
}
/**
 * Version distante connue du sondage. Mémoire de SESSION : semée depuis le
 * manifeste local au premier tic, puis tenue à jour par chaque cycle réussi.
 * `null` = pas encore semée.
 */
let probeKnownVersion: number | null = null;
/** Un sondage en vol : jamais deux à la fois, jamais pendant un cycle. */
let probeInFlight = false;
let probeFailures = 0;
/** Le sondage s'est tu (réseau, session) — seul un cycle RÉUSSI le réveille. */
let probeSuspended = false;
/** Horodatage du dernier sondage réellement parti (cadence adaptative). */
let probeLastAt = 0;
let isSyncing = false;
let quotaExceededNotified = false; // reset each sync cycle
/**
 * Remontées interdites pour ce cycle (essai gratuit expiré). La fusion des notes
 * repousse l'union depuis le chemin de DESCENTE, hors de la garde `skipUploads`
 * de triggerSync : ce drapeau la lui rend visible.
 */
let uploadsBlockedThisCycle = false;
let lastSyncAt: string | null = null;
let currentState: SyncStatus['state'] = 'idle';
let cachedStorageUsed = 0;
let cachedStorageLimit = 0;
const statusHandlers: Set<StatusChangeHandler> = new Set();

// Self-healing: recompute storage counter from R2 once per session per profile.
// Guards against D1 `storage_used_bytes` drift from any accounting bug.
const storageReconciledThisSession = new Set<string>();

/**
 * Les profils dont on a deja inventorie les orphelins dans CETTE session. Meme
 * porte que le recalcul du compteur, et pour la meme raison : un listing complet
 * de profil est facture.
 */
const orphanScanThisSession = new Set<string>();

// Profile-restoration backoff: once a cloud profile has failed to restore
// (typically because its `encryptionKey` was wrapped with a different OS user
// key — DPAPI/Keychain — and can't be unwrapped on this device), don't keep
// retrying every sync cycle. Tracked per-session; cleared on profile switch.
const profilesFailedToRestore = new Set<string>();

/**
 * Dernière version de manifeste EXAMINÉE pour chaque profil NON ACTIF du compte,
 * lors du balayage de fin de cycle qui rafraîchit leur présentation.
 *
 * Relire le manifeste de tous les autres profils à chaque cycle coûterait un
 * aller-retour R2 + un déchiffrement toutes les cinq minutes, par profil, pour
 * apprendre le plus souvent que rien n'a bougé. La version du manifeste avance à
 * CHAQUE remontée : identique = rien de neuf à lire. Par session, sans
 * persistance — au pire on relit une fois au démarrage.
 */
const otherProfileMetaVersionSeen = new Map<string, number>();

// Files skipped from cloud sync because they exceed MAX_SYNC_FILE_SIZE.
// Warn once per file per session — the 5-min cycle would spam the log otherwise.
const oversizedSyncWarned = new Set<string>();

/**
 * Skip a file kept out of cloud sync (oversized, or non-portable machine-key
 * V3 blob): warn once, and surface a per-file 'local_only' badge in the
 * renderer (French tooltip lives in SyncBadge).
 */
function skipOversizedFile(
  fileId: string,
  localPath: string | undefined,
  size: number,
  reason: 'too-large' | 'not-portable' = 'too-large'
): void {
  if (!oversizedSyncWarned.has(fileId)) {
    oversizedSyncWarned.add(fileId);
    log.warn(
      `[syncService] Skipping cloud sync for ${fileId} (${size} bytes, ${reason}): kept local-only`
    );
  }
  notifyRenderer('sync-file-status-changed', {
    fileId,
    localPath,
    status: 'local_only',
  });
}

/**
 * Persist the local-only decision in the manifest so the batch status
 * endpoint (sync:getAllFileStatuses) keeps reporting it — without an entry,
 * every batch refresh erased the badge set by the per-file event (blink).
 * mergeWithRemote skips 'local_only' entries, and the cloud manifest filter
 * (synced/deleted only) never uploads them.
 */
function markEntryLocalOnly(
  localManifest: SyncManifest,
  fileId: string,
  localPath: string | undefined,
  size: number,
  mtimeIso: string
): void {
  const existing = localManifest.files[fileId];
  localManifest.files[fileId] = {
    localPath: localPath || existing?.localPath,
    checksum: existing?.checksum || '',
    size,
    updatedAt: mtimeIso,
    syncedAt: existing?.syncedAt || null,
    chunks: existing?.chunks || [],
    status: 'local_only',
  };
}

// Oversized (>500MB) files we've already tried — and FAILED — to auto-migrate
// to a portable FEK blob this session (with a FEK actually present). Prevents
// re-transcoding a multi-GB file on every 5-min scan. Cleared on profile switch.
const portableMigrationAttempted = new Set<string>();

/**
 * Decides whether an oversized (>500MB) file may sync: it must be a PORTABLE
 * FEK V3 blob. A machine-key blob on a cloud/hybrid session (session FEK
 * present) is auto-migrated IN PLACE to a portable FEK container exactly ONCE —
 * this rescues large files imported while the renderer briefly reported local
 * mode, without a re-import and without ever losing the original (atomic
 * stage-then-rename inside StorageService.migrateToPortableFEK). Genuine
 * local-only profiles (no FEK) are never touched. Returns true when the file is
 * (now) portable and safe to sync.
 */
async function ensureOversizedPortable(fileId: string, filePath: string): Promise<boolean> {
  if (await StorageService.isPortableV3File(filePath)) {
    return true;
  }
  if (portableMigrationAttempted.has(fileId)) {
    return false;
  }
  const migrated = await StorageService.migrateToPortableFEK(filePath);
  if (migrated) {
    log.info(
      `[syncService] Auto-migrated oversized file ${fileId} from machine-key to portable FEK blob — will now sync`
    );
    return true;
  }
  // Only stop retrying when a FEK was actually available (a real transcode
  // failure). With no FEK at all (still locked) a later cycle should retry once
  // the vault is unlocked; the probe/migrate above are cheap no-ops then. Use
  // hasAnyFek (session OR .fek_safe) to match the key source migrateToPortableFEK
  // actually uses, so a background cycle can't re-transcode a huge file forever.
  if (await StorageService.hasAnyFek()) {
    portableMigrationAttempted.add(fileId);
  }
  return false;
}

// ── Skip-reason tracking ────────────────────────────────────────────────────
// Sync is triggered every 5 min and on every file change; we don't want to
// spam the log on every attempt when the reason is stable (e.g. FEK absent
// during first-launch before vault password is set). Log the transition only.
type SkipReason = 'not-authenticated' | 'offline' | 'no-fek' | null;
let lastSkipReason: SkipReason = null;

function logSkip(reason: SkipReason, message: string): void {
  if (reason !== lastSkipReason) {
    log.info(message);
    lastSkipReason = reason;
  }
}

function clearSkipReason(): void {
  if (lastSkipReason !== null) {
    log.info('[syncService] Sync resumed');
    lastSkipReason = null;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * SUSPENSION DU CYCLE ORDINAIRE pendant « Publier ce coffre sur le compte ».
 *
 * Sans elle, le cycle pousserait des manifestes sous l'ANCIENNE clé dans le
 * profil d'origine pendant que la migration publie sous la NOUVELLE ailleurs :
 * deux vérités concurrentes, aucune n'étant fausse, et rien pour les départager
 * au moment de la bascule. Posée de `PREPARING` jusqu'à `DONE`/`ABANDONED`.
 */
let publishSuspended = false;

export function setPublishSuspended(suspended: boolean): void {
  publishSuspended = suspended;
  log.info(`[syncService] Cycle ordinaire ${suspended ? 'SUSPENDU (migration)' : 'repris'}`);
}

export function isPublishSuspended(): boolean {
  return publishSuspended;
}

/**
 * Identifiants de profil connus du compte. Utilisé par la migration pour
 * constituer l'ensemble des noms occupés — jamais pour décider si une place est
 * libre : le worker crée la ligne au premier GET de manifeste, donc figurer
 * dans cette liste ne prouve rien sur le contenu.
 */
export async function listCloudProfileIds(): Promise<string[]> {
  const res = await authenticatedApiCall<{ profiles: Array<{ profileId: string }> }>(
    '/sync/profiles'
  );
  if (!res.success || !res.data) return [];
  return res.data.profiles.map((p) => p.profileId);
}

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win;
}

/**
 * LE DERNIER CYCLE ABOUTI SURVIT AU REDEMARRAGE.
 *
 * `lastSyncAt` ne vivait qu'en memoire : il repartait de `null` a chaque
 * lancement et ne redevenait vrai qu'au premier cycle abouti de la session —
 * cinq minutes plus tard, ou jamais si le coffre reste verrouille (pas de FEK,
 * donc pas de cycle). Or le renderer s'en sert pour dire d'une note si elle a
 * atteint le nuage : `null` y signifie « rien n'est parti », et TOUTES les
 * notes portaient alors « Non synchronisee » sur un compte parfaitement a jour.
 *
 * Le manifeste local le PERSISTE deja (`localManifest.lastSyncAt`, ecrit a
 * l'etape 8 de chaque cycle) : on le relit au demarrage. Garde-fou : seulement
 * si le manifeste porte une version non nulle, c'est-a-dire s'il a REELLEMENT
 * ete echange avec le serveur — `createEmpty()` estampille `lastSyncAt` a
 * l'instant de sa creation, et le semer donnerait un vert mensonger a un profil
 * qui n'a encore rien pousse.
 */
function seedLastSyncAt(profileId: string): void {
  void manifest
    .load(profileId)
    .then((local) => {
      // Un changement de profil pendant la lecture annule la graine.
      if (!local || activeProfileId !== profileId || lastSyncAt) return;
      if (!local.version || !local.lastSyncAt) return;
      lastSyncAt = local.lastSyncAt;
      log.info(`[syncService] Dernier cycle connu restaure: ${lastSyncAt}`);
      // Le renderer a pu se monter avant nous : on le lui dit.
      notifyRenderer('sync-status-changed', { state: currentState, lastSyncAt });
    })
    .catch(() => {
      // Manifeste illisible : on repart de `null`, comme avant.
    });
}

export function init(profileId: string): void {
  activeProfileId = profileId;
  // Les capacités (mode BYOS, direct, delta) sont celles de CE profil.
  r2.setCapabilityScope(profileId);
  currentState = 'idle';
  // LE PROFIL CHANGE : l'horodatage du precedent ne dit plus rien de celui-ci.
  // Le garder marquait « synchronisees » des notes que ce profil-ci n'a jamais
  // poussees. Il est remis a null, puis re-seme du manifeste ci-dessous.
  lastSyncAt = null;
  seedLastSyncAt(profileId);

  // Start periodic sync
  stopDaemon();
  syncTimer = setInterval(() => {
    triggerSync(profileId).catch((err) => {
      log.error('[syncService] Periodic sync failed:', err.message);
    });
  }, SYNC_INTERVAL);

  // Sondage de changement distant — la vraie cadence perçue par l'utilisateur.
  // `SYNC_INTERVAL` reste au-dessus comme filet : il couvre le sondage suspendu
  // et tout ce qui n'est pas visible depuis la version du manifeste.
  probeKnownVersion = null;
  probeInFlight = false;
  probeFailures = 0;
  probeSuspended = false;
  probeLastAt = 0;
  probeTimer = setInterval(() => onProbeTick(profileId), PROBE_INTERVAL_FOCUSED);

  /*
    L OBSERVATEUR DU COFFRE.

    Sans lui, une modification faite hors application, un plantage entre
    l ecriture et `notifyFileChanged`, ou une restauration de sauvegarde
    restaient INVISIBLES : le balayage saute les fichiers deja synchronises. La
    donnee etait sur le disque et ne partait jamais, pendant que l interface
    affichait « synchronise ».

    Son echec n est PAS fatal : on journalise et on continue. Un coffre sur un
    partage reseau, une limite de descripteurs, un pilote recalcitrant — aucun
    de ces cas ne doit empecher la synchronisation de tourner comme avant.
  */
  try {
    vaultWatcher = new VaultWatcher({
      baseDir: StorageService.getBaseDir(),
      onDirty: (_rel, target) => {
        // La MEME cle que le balayage, sans quoi le marquage est inerte : les
        // blobs de la racine par leur cle `meta:`, les fichiers ordinaires par
        // l empreinte de leur chemin.
        markScanDirty(
          target.kind === 'meta'
            ? target.key
            : scanFileIdOf(`${target.folderId}/${target.fileName}`)
        );
      },
      onSettled: () => {
        // Tracer le DECLENCHEUR, pas seulement le cycle : sans ca, un cycle
        // venu de l observateur et un cycle venu de l horloge sont
        // indistinguables dans le journal, et on ne peut pas prouver que
        // l observateur sert a quelque chose.
        log.info('[syncService] Cycle declenche par l observateur du coffre');
        triggerSync(profileId).catch((err) => {
          log.error('[syncService] Sync declenchee par l observateur echouee:', err.message);
        });
      },
      createWatcher: (baseDir) =>
        chokidar.watch(baseDir, {
          ignoreInitial: true,
          depth: 2,
          awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 200 },
        }),
    });
    vaultWatcher.start();
    /*
      UN SUCCES SILENCIEUX EST INDISCERNABLE D UNE ABSENCE.

      Sans cette ligne, un observateur qui n a jamais demarre et un observateur
      qui tourne parfaitement produisent le MEME journal : rien. C est
      exactement le motif « module ecrit, personne qui l appelle » qu on a
      croise quatre fois sur ce chantier — sauf qu ici il serait invisible meme
      en regardant les traces.
    */
    log.info(`[syncService] Observateur du coffre demarre sur ${StorageService.getBaseDir()}`);
  } catch (err) {
    vaultWatcher = null;
    log.warn('[syncService] Observateur du coffre indisponible, sondage seul:', (err as Error).message);
  }

  /**
   * LE CANAL — le serveur nous prévient au lieu qu'on demande.
   *
   * Il ne remplace ni le sondage ni l'horloge : il les DEVANCE. Quand il est
   * ouvert, une écriture faite ailleurs arrive en moins d'une seconde ; quand
   * il ne l'est pas (non déployé, réseau, session), tout se comporte
   * exactement comme sans lui. C'est la raison pour laquelle il ne signale
   * jamais d'erreur à l'utilisateur : il n'y a rien à réparer de son côté.
   *
   * Le gestionnaire ne fait que déclencher un cycle. La version annoncée n'est
   * PAS écrite dans `probeKnownVersion` : c'est le cycle qui l'établira, depuis
   * le manifeste qu'il aura réellement lu. Croire un entier reçu sur le fil
   * ferait sauter le sondage suivant sur la foi d'une annonce non vérifiée.
   */
  channel.resetAvailability();
  channel.start(profileId, () => {
    triggerSync(profileId).catch((err) => {
      log.error('[syncService] Cycle déclenché par le canal échoué:', err.message);
    });
  });

  // Initial sync after short delay (let app settle)
  setTimeout(() => {
    triggerSync(profileId).catch((err) => {
      log.error('[syncService] Initial sync failed:', err.message);
    });
  }, 5000);

  log.info(`[syncService] Initialized for profile ${profileId}`);
}

/**
 * UN TIC DE SONDAGE : « le nuage a-t-il bougé ? », au coût d'un 304.
 *
 * Ne fait RIEN quand un cycle tourne (il fait déjà ce GET conditionnel lui-même),
 * quand un sondage est en vol, hors ligne, non authentifié, ou après trois
 * échecs consécutifs — un serveur injoignable ne doit pas être harcelé toutes
 * les dix secondes. La reprise passe par un cycle RÉUSSI, seule preuve que la
 * session ET le réseau sont revenus : c'est la règle du client web, reprise mot
 * pour mot pour que les deux plateformes se comportent pareil.
 *
 * Une réponse autre que 304 ne fait PAS confiance au corps reçu : on déclenche
 * un cycle complet, qui refera son propre GET. Le sondage a un seul rôle —
 * répondre oui ou non — et aucune autorité sur ce qui est écrit.
 */
async function probeRemote(profileId: string): Promise<void> {
  if (probeSuspended || probeInFlight || isSyncing || publishSuspended) return;
  if (!profileId || activeProfileId !== profileId) return;
  if (!net.isOnline()) return;
  if (!(await isAuthenticated())) return;

  let known = probeKnownVersion;
  if (known === null) {
    const local = await manifest.load(profileId).catch(() => null);
    // Pas de manifeste local : il n'y a rien à comparer, et c'est au cycle
    // complet (qui sait amorcer) de s'en occuper.
    if (!local) return;
    known = local.version ?? 0;
    probeKnownVersion = known;
  }

  probeInFlight = true;
  probeLastAt = Date.now();
  try {
    const res = await r2.getManifest(profileId, known);
    probeFailures = 0;
    if (res.notModified) return;
    log.info(
      `[syncService] Sondage : le distant a bougé (v${known} → v${res.version}) — cycle déclenché`
    );
    probeKnownVersion = res.version;
    await triggerSync(profileId);
  } catch (err) {
    probeFailures++;
    if (probeFailures >= PROBE_MAX_FAILURES) {
      probeSuspended = true;
      log.warn(
        `[syncService] Sondage suspendu après ${probeFailures} échecs (${
          (err as Error).message
        }) — reprise au prochain cycle réussi`
      );
    }
  } finally {
    probeInFlight = false;
  }
}

/**
 * Le tic d'horloge du sondage. Une seule horloge à 10 s, dont les tics sont
 * SAUTÉS quand la fenêtre n'est pas au premier plan et que la cadence de fond
 * n'est pas encore atteinte — plus simple qu'une horloge qu'on redémarre à
 * chaque changement de focus, et sans état à maintenir.
 */
function onProbeTick(profileId: string): void {
  const focused = (() => {
    try {
      return !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused();
    } catch {
      return false;
    }
  })();
  const due = focused ? PROBE_INTERVAL_FOCUSED : PROBE_INTERVAL_BACKGROUND;
  if (Date.now() - probeLastAt < due - 500) return;
  probeRemote(profileId).catch(() => {
    /* probeRemote avale déjà tout — ceci n'est qu'une ceinture */
  });
}

/**
 * DERNIER CYCLE AVANT LA FERMETURE — le trou par lequel les notes se perdaient.
 *
 * CE QUI SE PASSAIT. `before-quit` appelait `stop()`, qui appelle `stopDaemon()`,
 * qui fait `clearTimeout(debounceTimer)`. Une note sauvegardée moins de
 * DEBOUNCE_DELAY (10 s) avant la fermeture voyait donc sa remontée annulée par
 * la fermeture elle-même. L'utilisateur, lui, avait vu « Enregistré ».
 *
 * CE QUI SAUVAIT LES MEUBLES, ET CE QUI NE SUFFISAIT PAS. La marque
 * `pending_upload` est posée par `notifyMetadataChanged` AVANT d'armer le
 * debounce : elle est donc sur le disque, et le cycle du prochain démarrage la
 * ramasse. Mais « au prochain démarrage » peut vouloir dire des jours — et
 * pendant ce temps l'autre appareil lit un nuage en retard en affichant, lui
 * aussi, que tout va bien.
 *
 * LE BUDGET EST LA PIÈCE ESSENTIELLE. Un cycle complet peut durer des minutes
 * (gros fichiers, réseau lent) et rien ne doit faire paraître l'application
 * bloquée à la fermeture. On lance donc le cycle, on l'attend au plus
 * `budgetMs`, et on rend la main DANS TOUS LES CAS. Ce qui n'est pas parti
 * garde sa marque et repartira : on gagne du temps, on ne promet rien.
 *
 * Ne fait RIEN quand rien n'attend — la fermeture ne doit pas payer un
 * aller-retour réseau pour découvrir qu'il n'y avait rien à dire.
 */
export async function flushBeforeQuit(
  profileId: string,
  budgetMs = QUIT_FLUSH_BUDGET_MS
): Promise<void> {
  // Le debounce ne servira plus : soit on remonte MAINTENANT, soit jamais.
  stopDaemon();
  if (!profileId || activeProfileId !== profileId) return;

  let pending = 0;
  try {
    const local = await withDeadline(manifest.load(profileId), 1500, null);
    if (local) {
      for (const entry of Object.values(local.files)) {
        if (entry.status === 'pending_upload' || entry.status === 'deleted') pending++;
      }
    } else {
      // Manifeste illisible dans le budget : on ne conclut pas « rien à faire ».
      pending = 1;
    }
  } catch {
    pending = 1;
  }

  if (pending === 0) {
    log.info('[syncService] Fermeture : rien en attente, pas de cycle final');
    return;
  }

  log.info(
    `[syncService] Fermeture : ${pending} entrée(s) en attente — cycle final (budget ${budgetMs} ms)`
  );
  const started = Date.now();
  await withDeadline(
    triggerSync(profileId).then(() => true),
    budgetMs,
    false
  );
  log.info(`[syncService] Fermeture : cycle final rendu après ${Date.now() - started} ms`);
}

export function stop(): void {
  stopDaemon();
  activeProfileId = null;
  isSyncing = false;
  currentState = 'idle';
  // Clear the per-session zombie-profile cache so a profile switch (which may
  // have access to different OS keychain entries) gets a fresh shot at
  // restoring previously-unreachable cloud profiles.
  profilesFailedToRestore.clear();
  // A new profile has its own FEK — re-evaluate portable-migration eligibility.
  portableMigrationAttempted.clear();
  // Re-probe the direct-upload capability on the next session: a redeploy that
  // adds/removes the R2_* secrets should take effect after a restart/switch.
  r2.resetDirectCapabilityCache();
  log.info('[syncService] Stopped');
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const failed = await queue.getFailedItems();
  const pending = await queue.getPendingCount();
  const conflicts = activeProfileId ? await manifest.getConflicts(activeProfileId) : [];

  return {
    state: currentState,
    lastSyncAt,
    pendingItems: pending,
    failedItems: failed.length,
    conflicts: conflicts.length,
    storageUsed: cachedStorageUsed,
    storageLimit: cachedStorageLimit,
  };
}

export function onStatusChange(handler: StatusChangeHandler): () => void {
  statusHandlers.add(handler);
  return () => statusHandlers.delete(handler);
}

/**
 * Notify syncService that a local file was modified.
 * Debounces to avoid triggering sync on every keystroke.
 */
export function notifyFileChanged(profileId: string, localPath: string): void {
  if (profileId !== activeProfileId) return;

  // Derive opaque fileId from local path — never expose real file names
  const fileId = crypto.createHash('sha256').update(localPath).digest('hex').slice(0, 32);

  // Mark as pending upload with localPath so uploadFile can find it later
  manifest.markPendingUpload(profileId, fileId, '', 0, localPath).then(() => {
    // Notify renderer immediately so badges appear before sync triggers
    notifyRenderer('sync-file-status-changed', { fileId, localPath, status: 'pending_upload' });
  }).catch(() => {});

  // Debounce sync trigger
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    triggerSync(profileId).catch((err) => {
      log.error('[syncService] Debounced sync failed:', err.message);
    });
  }, DEBOUNCE_DELAY);
}

/**
 * Le manifeste DISTANT portait-il une entrée `meta:layout` au dernier cycle ?
 * Par profil, mémoire de SESSION (jamais persistée : c'est une observation, pas
 * un état). `undefined` = aucun cycle n'a encore rapporté de manifeste distant.
 */
const remoteLayoutSeen = new Map<string, boolean>();

/**
 * Horodatage de la derniere ecriture du blob de notes v1 VUE DANS LE MANIFESTE
 * DISTANT, par profil. `null` = le nuage n'en porte plus. Absent de la carte =
 * aucun cycle n'a encore rapporte de manifeste, donc ON NE SAIT PAS.
 *
 * Memoire de SESSION : c'est une observation, pas un etat.
 */
const remoteLegacyNotesAt = new Map<string, string | null>();
/**
 * Les empreintes de `notes.enc` que CET appareil a lui-meme remontees. Sans
 * elles, un appareil v1 qui ecrit ses notes voyait sa propre remontee dans le
 * manifeste distant, la prenait pour « un autre appareil qui ecrit encore a
 * l'ancien format », et se refusait la bascule tant qu'il servait — a jamais.
 */
const ownNotesChecksums = new Set<string>();
/** Une passe de migration v3 du coffre de notes à la fois — voir l'étape 6 du cycle. */
let upgradePassInFlight = false;

/**
 * PEUT-ON MIGRER CE PROFIL VERS LA v2 SANS RIEN PERDRE ?
 *
 * Trois reponses, et une seule autorise la migration :
 *  - `unknown` — aucun cycle n'a encore vu le manifeste distant. C'est le cas
 *    au demarrage, et c'est REFUSE : migrer sans savoir ce que le nuage porte
 *    est precisement le geste qu'on ne veut pas.
 *  - `legacy-active` — le nuage porte un blob v1 ecrit recemment : un autre
 *    appareil vit encore en v1. Migrer le couperait des notes ecrites ici.
 *  - `safe` — pas de blob v1, ou un blob abandonne depuis plus de trente jours.
 *
 * Ce n'est PAS une garantie absolue : un appareil eteint depuis deux mois peut
 * se rallumer. Ce que ca elimine, c'est le cas courant et previsible — deux
 * appareils actifs dont un seul a ete migre.
 */
export function legacyNotesVerdict(profileId: string, nowMs: number = Date.now()): LegacyVerdict {
  // `undefined` quand la carte ne connait pas ce profil : aucun cycle n'a
  // encore rapporte de manifeste, donc on ne sait pas. La regle est dans
  // `decideLegacyVerdict`, pure et eprouvee.
  return decideLegacyVerdict(
    remoteLegacyNotesAt.has(profileId) ? (remoteLegacyNotesAt.get(profileId) ?? null) : undefined,
    nowMs
  );
}

/**
 * GARDE ANTI-DOUBLE-AMORÇAGE de la mise en page : « le nuage porte-t-il déjà
 * une mise en page pour ce profil ? »
 *
 * Deux sources, dans cet ordre :
 *  1. ce que le dernier cycle a VU dans le manifeste distant (autoritaire) ;
 *  2. à défaut, le manifeste LOCAL — qui est notre mémoire du nuage entre deux
 *     sessions : une entrée `meta:layout` non supprimée y prouve qu'un appareil
 *     (celui-ci ou un autre) a déjà publié une mise en page.
 *
 * Répondre `true` fait ATTENDRE la descente au lieu d'amorcer. Répondre `false`
 * à tort ne détruit rien : les vues amorcées portent `LAYOUT_SEED_CLOCK`
 * (l'époque) et perdent donc l'arbitrage contre toute disposition réelle.
 */
export async function cloudCarriesLayout(profileId: string): Promise<boolean> {
  const seen = remoteLayoutSeen.get(profileId);
  if (seen !== undefined) return seen;
  try {
    const local = await manifest.load(profileId);
    const entry = local?.files[LAYOUT_META_FILE_ID];
    return !!entry && entry.status !== 'deleted';
  } catch {
    return false;
  }
}

/**
 * Notify that a metadata file changed (notes.enc, layout.enc or folder
 * metadata.json). Uses the resourceId directly as the manifest key (no hashing
 * needed — 'notes', 'layout' or folderId are already opaque UUIDs).
 */
/**
 * Demande un cycle bientôt, SANS toucher au manifeste.
 *
 * Pour une écriture qui ne change aucun fichier suivi par le manifeste — les
 * objets de notes v2 ont leur propre index. `notifyMetadataChanged` posait
 * `pending_upload` sur `meta:notes` (empreinte vide, donc rehachage puis
 * remontée) alors que `notes.enc` n'avait pas bougé : 3,5 Mo repartaient à
 * l'identique à chaque sauvegarde dès que le pont v1 différait sa réécriture
 * (mesuré le 05/09/2026, 17:35:07). Même délai anti-rebond que les autres
 * déclencheurs.
 */
/**
 * Images citées par les notes mais absentes du disque, constatées au
 * chargement : le prochain cycle les demande au nuage (voir
 * `notesCycle.rememberMissingBlobs`), et on le programme.
 */
export function reportMissingNoteBlobs(profileId: string, hashes: readonly string[]): void {
  if (profileId !== activeProfileId || hashes.length === 0) return;
  notesCycle.rememberMissingBlobs(profileId, hashes);
  scheduleSync(profileId);
}

export function scheduleSync(profileId: string): void {
  if (profileId !== activeProfileId) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    triggerSync(profileId).catch((err) => {
      log.error('[syncService] Debounced sync failed:', err.message);
    });
  }, DEBOUNCE_DELAY);
}

export function notifyMetadataChanged(profileId: string, resourceId: string): void {
  if (profileId !== activeProfileId) return;

  const fileId = `meta:${resourceId}`;
  manifest.markPendingUpload(profileId, fileId, '', 0).catch(() => {});

  /**
   * DIRE AU RENDERER CE QUE LE MOTEUR SAIT, AU LIEU DE LE LUI FAIRE DEVINER.
   *
   * L'indicateur de synchronisation des notes DÉDUISAIT son état d'une
   * comparaison d'horloges (`note.updatedAt > sync.lastSyncAt`). Deux mensonges
   * en découlaient, tous deux visibles tous les jours :
   *
   *  - au changement de profil, `lastSyncAt` repart à `null` et TOUTES les notes
   *    s'affichent « non synchronisées » jusqu'au premier cycle ;
   *  - une note reçue d'un AUTRE appareil porte l'horloge de CET appareil. Si
   *    elle est en avance, la note reste « non synchronisée » indéfiniment —
   *    alors qu'elle vient précisément d'arriver du nuage.
   *
   * Le statut de l'entrée `meta:notes` est un ACCUSÉ, pas une déduction : il dit
   * s'il reste quelque chose à remonter. Il prime donc sur l'horloge (voir
   * `getNoteSyncState`).
   */
  notifyRenderer('sync-file-status-changed', { fileId, status: 'pending_upload' });

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    triggerSync(profileId).catch((err) => {
      log.error('[syncService] Debounced sync failed:', err.message);
    });
  }, DEBOUNCE_DELAY);
}

/**
 * Notify that a folder was permanently deleted.
 */
export function notifyFolderDeleted(profileId: string, folderId: string): void {
  if (profileId !== activeProfileId) return;

  // Mark the metadata entry as deleted
  manifest.markDeleted(profileId, `meta:${folderId}`).catch(() => {});

  // Also mark all files in that folder as deleted
  manifest.load(profileId).then((m) => {
    if (!m) return;
    for (const fileId of Object.keys(m.files)) {
      const entry = m.files[fileId];
      if (entry.localPath?.startsWith(`${folderId}/`)) {
        manifest.markDeleted(profileId, fileId).catch(() => {});
      }
    }
  }).catch(() => {});

  // No queue.enqueue — triggerSync handles deletions directly from manifest

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    triggerSync(profileId).catch((err) => {
      log.error('[syncService] Debounced sync failed:', err.message);
    });
  }, DEBOUNCE_DELAY);
}

/**
 * Notify that a file was permanently deleted.
 */
export function notifyFileDeleted(profileId: string, localPath: string): void {
  if (profileId !== activeProfileId) return;

  const fileId = crypto.createHash('sha256').update(localPath).digest('hex').slice(0, 32);

  manifest.markDeleted(profileId, fileId).catch(() => {});

  // No queue.enqueue — triggerSync handles deletions directly from manifest

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    triggerSync(profileId).catch((err) => {
      log.error('[syncService] Debounced sync failed:', err.message);
    });
  }, DEBOUNCE_DELAY);
}

// ── Core Sync Algorithm ─────────────────────────────────────────────────────

/**
 * Reprend le ramassage des fichiers dont le GC avait echoue.
 *
 * Ne leve jamais : le rattrapage est un bonus de fin de cycle, pas une etape
 * dont l echec doit compter. Chaque tentative met a jour l etat, si bien qu un
 * fichier durablement en echec s espace tout seul par recul exponentiel.
 */
async function sweepPendingGc(profileId: string): Promise<void> {
  const candidats = selectForSweep([...gcStates.values()], Date.now());
  if (candidats.length === 0) return;
  for (const etat of candidats) {
    const cle = `${profileId}:${etat.fileId}`;
    let ok = false;
    try {
      const res = await deltaSync.retryGcForFile(
        profileId,
        etat.fileId,
        deltaTransport,
        getDeltaCrypto()
      );
      // `skipped` n est PAS un echec : la garde de version a refuse parce qu un
      // manifeste plus recent existe, et c est le comportement sur. Un nouveau
      // commit reouvrira le besoin de toute facon.
      ok = true;
      if (res.deletedBytes > 0) {
        log.info(
          `[syncService] Rattrapage GC ${etat.fileId} : ${res.deletedBytes} octets recuperes`
        );
      }
    } catch (err) {
      log.warn(
        `[syncService] Rattrapage GC ${etat.fileId} echoue :`,
        err instanceof Error ? err.message : String(err)
      );
    }
    gcStates.set(cle, afterAttempt(etat, ok, Date.now()));
  }
}

export async function triggerSync(profileId: string): Promise<SyncStatus> {
  // Court-circuit EN TÊTE : une migration en cours détient la seule vérité sur
  // ce qui est publié et sous quelle clé. Voir `setPublishSuspended`.
  if (publishSuspended) {
    logSkip('not-authenticated', '[syncService] Migration en cours — cycle ordinaire suspendu');
    return getSyncStatus();
  }

  if (isSyncing) {
    log.info('[syncService] Sync already in progress, skipping');
    return getSyncStatus();
  }

  // Pre-checks
  if (!(await isAuthenticated())) {
    logSkip('not-authenticated', '[syncService] Not authenticated, skipping sync');
    return getSyncStatus();
  }

  if (!net.isOnline()) {
    updateState('offline');
    logSkip('offline', '[syncService] Offline, skipping sync');
    return getSyncStatus();
  }

  // Check if FEK is available (vault password must be set)
  const fek = await StorageService.loadFEKForPairing();
  if (!fek) {
    logSkip(
      'no-fek',
      '[syncService] FEK not available (vault not unlocked), skipping sync until unlock'
    );
    return getSyncStatus();
  }

  // All pre-checks passed — reset skip-reason so next skip logs again
  clearSkipReason();

  /**
   * L'ESSAI DE TRENTE JOURS N'EXISTE PLUS — ET N'A JAMAIS EXISTÉ AILLEURS QU'ICI.
   *
   * Ce bloc coupait les REMONTÉES de tout compte gratuit créé depuis plus de
   * trente jours, en laissant les descentes passer. Effet observable pour
   * l'utilisateur : l'application vit, elle télécharge, elle annonce des cycles
   * réussis (« 0/0 uploaded » est un succès), et rien de ce qu'il écrit ne
   * quitte l'appareil. Exactement la panne silencieuse que cette série de
   * correctifs poursuit — mais celle-ci était volontaire.
   *
   * Or l'essai n'existait nulle part ailleurs : `createUser` n'écrit aucune
   * expiration, `subscription_expires_at` n'est renseignée que par le webhook
   * d'un abonnement PAYÉ, aucune tâche du cron ne déclasse un compte gratuit, et
   * `04cdb09e` (« 5 Go gratuits sans terme ») a acté l'offre côté serveur et
   * côté site SANS toucher à ce fichier. Le client bureau était donc le dernier
   * endroit du produit à faire respecter une règle que le produit ne vend pas.
   *
   * Ce qui borne réellement un compte gratuit, c'est le QUOTA (`STORAGE_LIMITS`,
   * refusé par le Worker et remonté par `sync-quota-exceeded`), pas l'ancienneté.
   * La plomberie `skipUploads` reste en place : elle sert le jour où une vraie
   * règle de droit d'accès devra suspendre les remontées.
   */
  const skipUploads = false;

  isSyncing = true;
  metrics.cycleStarted();
  quotaExceededNotified = false;
  uploadsBlockedThisCycle = skipUploads;
  updateState('syncing');
  r2.setCapabilityScope(activeProfileId);
  r2.resetDirectCapabilityCache();
  // Les interrupteurs d'écriture serveur (conteneur v3, delta v5) se lisent
  // ICI, avant la première écriture du cycle — pas au hasard d'une remontée.
  await r2.refreshCapabilities();

  // Notify renderer immediately so the UI shows the spinning icon
  notifyRenderer('sync-status-changed', {
    state: 'syncing',
    lastSyncAt,
    pendingItems: 0,
    failedItems: 0,
    conflicts: 0,
  });

  try {
    // 1. Load local manifest
    let localManifest = (await manifest.load(profileId)) || manifest.createEmpty(profileId);

    // 1b. Scan local files and add any not yet in manifest
    await metrics.time('scan', () => scanLocalFiles(profileId, localManifest));
    await manifest.save(profileId, localManifest);

    // 2. Fetch remote manifest from R2.
    //    Send the local version as `If-None-Match` — if the server hasn't
    //    moved, it returns 304 and we skip the decrypt + merge entirely.
    //    The local manifest is treated as the authoritative remote view
    //    in that case (which it is — we already merged from it last cycle).
    const { manifest: remoteEncrypted, version: remoteVersion, notModified } =
      await r2.getManifest(profileId, localManifest.version);

    let remoteManifest: SyncManifest;
    if (notModified) {
      // Fast path: server confirms nothing changed remotely since last sync.
      // Build the remote view from the local manifest minus any entries that
      // haven't been pushed yet — otherwise the merge sees identical state on
      // both sides and never schedules the pending uploads.
      remoteManifest = {
        ...localManifest,
        files: Object.fromEntries(
          Object.entries(localManifest.files).filter(
            ([, e]) => e.status === 'synced' || e.status === 'deleted'
          )
        ),
      };
    } else if (remoteEncrypted) {
      // Decrypt with StorageService (local profile key)
      const decrypted = await StorageService.decryptManifestAuto(remoteEncrypted);
      remoteManifest = JSON.parse(decrypted.toString('utf-8'));
    } else {
      // First sync — no remote manifest
      remoteManifest = manifest.createEmpty(profileId);
    }

    // 2a bis. OBSERVATION pour la garde d'amorçage de la mise en page. Le
    //     manifeste distant fait autorité sur « le nuage a-t-il déjà une mise en
    //     page ? » ; sans cette mémoire, un second appareil amorcerait un
    //     document concurrent avant même d'avoir vu celui qui existe. Le repli
    //     304 recopie le manifeste local, qui porte la même vérité.
    remoteLayoutSeen.set(profileId, !!remoteManifest.files[LAYOUT_META_FILE_ID]);

    /**
     * 2a ter. LE NUAGE PORTE-T-IL ENCORE DES NOTES AU FORMAT v1, ET DEPUIS QUAND ?
     *
     * C'est la SEULE question qui rende la migration vers la v2 sure a poser.
     * Migrer un appareil pendant qu'un autre ecrit encore l'ancien blob
     * fabriquerait exactement la panne que ce chantier poursuit : le second
     * continuerait de publier `meta:notes`, le premier ne le lirait plus, et les
     * notes ecrites la-bas n'arriveraient nulle part — sans erreur, sans
     * indicateur, sans rien.
     *
     * On memorise donc ce que le manifeste distant en dit, et `notes:load` s'en
     * sert pour REFUSER de migrer tant que ce n'est pas tranche.
     */
    // Un blob réécrit par un appareil v2 (drapeau `legacyWriteBack`) ne compte
    // pas comme un écrivain v1 — c'est le pont, pas quelqu'un qui tape.
    // Ni ce que CET appareil a remonte lui-meme : sa propre ecriture v1 ne
    // prouve l'existence de personne d'autre (voir ownNotesChecksums).
    {
      const remoteNotesEntry = remoteManifest.files[NOTES_META_FILE_ID];
      const mine = !!remoteNotesEntry?.checksum && ownNotesChecksums.has(remoteNotesEntry.checksum);
      remoteLegacyNotesAt.set(profileId, mine ? null : legacyObservationOf(remoteNotesEntry));
    }

    // 2b. Merge PIN state from remote profileMeta into the local profile.
    //     PIN is synced cross-device via the encrypted manifest; last-write-wins
    //     based on pinUpdatedAt. If this device just configured a newer PIN it
    //     stays; otherwise the remote PIN replaces the local one.
    if (remoteManifest.profileMeta) {
      try {
        const changed = await profileManager.applyCloudPinUpdate(profileId, {
          pinHash: remoteManifest.profileMeta.pinHash,
          pinSalt: remoteManifest.profileMeta.pinSalt,
          allowPinReset: remoteManifest.profileMeta.allowPinReset,
          pinUpdatedAt: remoteManifest.profileMeta.pinUpdatedAt,
        });
        if (changed) {
          log.info('[syncService] Applied remote PIN update to local profile');
          notifyRenderer('profiles-updated', {});
        }
      } catch (err) {
        log.warn('[syncService] PIN sync failed:', (err as Error).message);
      }

      // 2b bis. Même fusion, pour ce que l'écran de choix des profils MONTRE :
      //     nom, couleur, emoji, image, ordre. Le PIN avait sa fusion depuis le
      //     début ; la présentation, non — un profil renommé ici gardait son
      //     ancien nom partout ailleurs, pour toujours. Arbitrage à l'horloge
      //     `metaUpdatedAt`, indépendante de celle du PIN.
      try {
        const changed = await profileManager.applyCloudMetaUpdate(
          profileId,
          remoteManifest.profileMeta
        );
        if (changed) {
          log.info('[syncService] Applied remote profile metadata update');
          notifyRenderer('profiles-updated', {});
        }
      } catch (err) {
        log.warn('[syncService] Profile metadata sync failed:', (err as Error).message);
      }
    }

    // 2c. LES NOTES NE CONNAISSENT PAS LE CONFLIT : leur fusion note à note le
    //     résout toujours, et aucun chemin ne doit laisser l'entrée en attente
    //     d'un arbitrage qui n'arrivera jamais (statut hérité d'un cycle
    //     antérieur, quand la descente écrasait le blob). On la ramène tout de
    //     suite à un statut sain — `synced` si le nuage porte déjà nos octets,
    //     sinon `pending_upload`, que la fusion ou la remontée du cycle
    //     réécrira. Sans cela, un blob identique des deux côtés (donc ignoré par
    //     la fusion) resterait « en conflit » indéfiniment dans l'interface.
    const notesLocalEntry = localManifest.files[NOTES_META_FILE_ID];
    if (notesLocalEntry?.status === 'conflict') {
      const notesRemoteEntry = remoteManifest.files[NOTES_META_FILE_ID];
      notesLocalEntry.status =
        notesRemoteEntry?.checksum === notesLocalEntry.checksum ? 'synced' : 'pending_upload';
      log.info(
        `[syncService] Entrée notes en conflit héritée — ramenée à ${notesLocalEntry.status}`
      );
    }

    // 3. Merge: determine what to upload/download/conflict
    const mergeResult = manifest.mergeWithRemote(localManifest, remoteManifest, {
      // Les octets de `notes.enc` que CET appareil a remontés : si l'autre
      // appareil les a adoptés et republiés sous sa propre estampille, le
      // distant reste « à nous » et la remontée directe suffit.
      isOwnUpload: (fileId, checksum) =>
        fileId === NOTES_META_FILE_ID && ownNotesChecksums.has(checksum),
    });

    // 3b. Notify renderer with pending count BEFORE processing
    const totalPending = mergeResult.toUpload.length + mergeResult.toDownload.length;
    if (totalPending > 0) {
      notifyRenderer('sync-status-changed', {
        state: 'syncing',
        lastSyncAt,
        pendingItems: totalPending,
        failedItems: 0,
        conflicts: mergeResult.conflicts.length,
      });
    }

    // 4. Process uploads (skip if trial expired)
    if (!skipUploads) {
      await processUploads(profileId, mergeResult.toUpload, localManifest);
    } else if (mergeResult.toUpload.length > 0) {
      log.info(`[syncService] Skipping ${mergeResult.toUpload.length} uploads — trial expired`);
    }

    // 5. Process downloads
    await processDownloads(profileId, mergeResult.toDownload, remoteManifest, localManifest);

    // 6. Handle conflicts
    for (const fileId of mergeResult.conflicts) {
      await handleConflict(profileId, fileId, localManifest, remoteManifest);
    }

    /**
     * 6 bis. LES NOTES, QUAND CE PROFIL EST EN v2.
     *
     * Étape à part, et pas un cas de plus dans la boucle des fichiers : en v2
     * les notes ne sont PAS des entrées de manifeste. Leur index est leur
     * manifeste, et il est chiffré — le manifeste de synchronisation ne porte
     * qu'une entrée pour lui. Mettre des milliers de notes dans le manifeste
     * ferait deux index de la même chose, qui pourraient diverger, dans un
     * fichier que chaque cycle télécharge et rechiffre.
     *
     * NE JETTE PAS : un cycle de notes en échec ne doit pas emporter celui des
     * fichiers, qui n'a rien à voir. Et rend `ran: false` sans rien tenter tant
     * que le profil est en v1 — c'est-à-dire pour tout le monde aujourd'hui.
     */
    let notesCyclePublished = false;
    try {
      const notesResult = await notesCycle.runNotesCycleV2(
        profileId,
        StorageService.getBaseDir(),
        // Le verdict est fraichement pose par l etape 2a de ce meme cycle
        // (`remoteLegacyNotesAt`), quelques lignes plus haut. Il decide si le
        // pont v1 doit encore reecrire — et donc renvoyer — `notes.enc`.
        {
          legacyVerdict: legacyNotesVerdict(profileId),
          // Pas de balayage d'images pendant les premieres minutes : il relit
          // chaque note (PBKDF2) et doublait le temps d'ouverture des notes au
          // demarrage. Il est du au plus une fois par jour, il attendra.
          skipBlobSweep: process.uptime() < NOTES_SWEEP_STARTUP_GRACE_S,
        }
      );
      notesCyclePublished = notesResult.published;
      // Des images retrouvées là-haut viennent d'arriver sur le disque : le
      // rendu doit recharger pour les afficher.
      if (notesResult.blobsRecovered > 0) notifyRenderer('notes-updated', {});
      // Le coffre de notes migre vers le conteneur v3 dès que l'interrupteur
      // (serveur ou local) est allumé — pas seulement au prochain chargement des
      // notes. La passe est idempotente et ne coûte que trois octets par fichier
      // quand tout est déjà en v3 ; sous le verrou des notes, jamais deux à la
      // fois, et jamais pendant la grâce de démarrage (elle relit chaque objet
      // en v2 : PBKDF2, comme le balayage).
      if (
        isMachineV3WriteEnabled('notes') &&
        !upgradePassInFlight &&
        process.uptime() >= NOTES_SWEEP_STARTUP_GRACE_S
      ) {
        upgradePassInFlight = true;
        void withNotesLock(() => upgradeNotesVaultContainers(StorageService.getBaseDir()))
          .catch((err) => {
            log.warn(`[syncService] migration v3 du coffre ignorée : ${(err as Error).message}`);
          })
          .finally(() => {
            upgradePassInFlight = false;
          });
      }
      /**
       * L'INDICATEUR DE SYNCHRONISATION DOIT AUSSI DIRE VRAI EN v2.
       *
       * Le badge lit l'accusé publié sur `meta:notes` (voir `noteSyncState`).
       * En v2 cette entrée ne bouge plus : le cycle des notes passe par son
       * propre index, hors manifeste. Sans cette ligne, le badge retombait donc
       * sur la comparaison d'horloges — c'est-à-dire sur le mensonge qu'on
       * vient précisément de corriger, mais seulement pour les profils migrés.
       *
       * Le cycle v2 sait ce qu'il reste à faire : un transfert en échec veut
       * dire « en attente », tout le reste veut dire « le nuage a tout ».
       */
      if (notesResult.ran) {
        notifyRenderer('sync-file-status-changed', {
          fileId: NOTES_META_FILE_ID,
          status: notesResult.failures > 0 ? 'pending_upload' : 'synced',
        });
      }
      if (notesResult.contentChanged) {
        // Le renderer tient son coffre en mémoire : sans ce signal, ce qui vient
        // d'arriver n'apparaîtrait qu'au prochain démarrage.
        notifyRenderer('notes-updated', {});
      }
      /**
       * LE BLOB v1 RÉÉCRIT DOIT PARTIR, ET RIEN NE LE FAISAIT PARTIR.
       *
       * Le cycle v2 réécrit `notes.enc` pour qu'un appareil resté en v1 voie ce
       * qu'on écrit ici — mais il le fait à l'étape 6 bis, donc APRÈS
       * `scanLocalFiles` (qui a relevé l'ancienne empreinte) et APRÈS la phase
       * de remontée. Le fichier frais restait donc sur le disque jusqu'au
       * prochain cycle déclenché par autre chose : sur une machine tranquille,
       * jamais. Le vieil appareil continuait d'afficher un coffre figé — la
       * panne exacte que cette réécriture répare.
       *
       * `notifyMetadataChanged` fait les deux gestes qui manquaient : elle pose
       * l'accusé `pending_upload` vers le renderer, et elle arme le cycle
       * suivant, dont le balayage relèvera la nouvelle empreinte et fera monter
       * le blob sous `meta:notes`.
       */
      if (notesResult.legacyBlobRewritten) {
        log.info('[syncService] blob v1 réécrit — remontée de meta:notes armée');
        notifyMetadataChanged(profileId, NOTES_META_RESOURCE_ID);
      }
    } catch (err) {
      log.error('[syncService] Cycle des notes v2 en échec (non bloquant):', err);
    }

    // 7. Process deletions — remove deleted entries from R2
    const toDelete = Object.entries(localManifest.files)
      .filter(([, e]) => e.status === 'deleted')
      .map(([id]) => id);

    for (const fileId of toDelete) {
      try {
        // Le nombre de morceaux vient du manifeste : sur un magasin LOCAL, il
        // n'existe aucune signature de listing (elle exposerait tout le
        // prefixe), donc c'est la seule facon de savoir quoi effacer.
        await r2.deleteFile(profileId, fileId, localManifest.files[fileId]?.chunks?.length || 1);
        delete localManifest.files[fileId];
        log.info(`[syncService] Deleted from R2: ${fileId}`);
      } catch (err) {
        log.error(`[syncService] R2 deletion failed for ${fileId}:`, err);
      }
    }

    // 8. Process queue retries
    await processQueue(profileId);

    // 8. Update manifest metadata (in-memory is source of truth for this cycle)
    localManifest.version = remoteVersion;
    localManifest.lastSyncAt = new Date().toISOString();

    // 9. Encrypt and upload new manifest to R2
    //    Only include entries that are synced or deleted — pending_upload entries
    //    haven't been successfully uploaded yet and would confuse other devices.

    // Include profile metadata so secondary devices can restore profiles
    let profileMeta: SyncProfileMeta | undefined;
    try {
      const pm = profileManager.getManifest();
      const profile = pm.profiles.find((p) => p.id === profileId);
      if (profile) {
        profileMeta = {
          id: profile.id,
          name: profile.name,
          avatarColor: profile.avatarColor,
          avatarEmoji: profile.avatarEmoji,
          avatarImage: profile.avatarImage,
          isDefault: profile.isDefault,
          order: profile.order,
          createdAt: profile.createdAt,
          pinHash: profile.pinHash,
          pinSalt: profile.pinSalt,
          allowPinReset: profile.allowPinReset,
          pinUpdatedAt: profile.pinUpdatedAt,
          // Sans cette horloge, les autres appareils reçoivent bien le nom et la
          // couleur — mais n'ont aucun moyen de savoir s'ils sont plus récents
          // que les leurs, donc n'y touchent jamais.
          metaUpdatedAt: profile.metaUpdatedAt,
        };
      }
    } catch {
      // profileManager not initialized — skip
    }

    // Include StorageService encryption key so other devices can decrypt metadata
    const encryptionKey = StorageService.getEncryptionKeyBase64() || undefined;

    const publishedFiles = Object.fromEntries(
      Object.entries(localManifest.files).filter(
        ([, entry]) => entry.status === 'synced' || entry.status === 'deleted'
      )
    );

    // L'entrée des notes ne doit JAMAIS disparaître du manifeste nuage. Une
    // remontée en échec la laisse `pending_upload`, donc hors du filtre ci-dessus
    // — le nuage annoncerait alors « pas de notes » alors que l'objet R2 est bien
    // là, et le prochain appareil à pousser (le web) n'aurait plus rien à
    // fusionner. On republie l'entrée distante telle quelle dans ce cas.
    if (!publishedFiles[NOTES_META_FILE_ID] && remoteManifest.files[NOTES_META_FILE_ID]) {
      publishedFiles[NOTES_META_FILE_ID] = remoteManifest.files[NOTES_META_FILE_ID];
    }

    // MÊME GARDE POUR LA MISE EN PAGE. Une remontée en échec laisse l'entrée
    // `pending_upload`, donc hors du filtre : le nuage annoncerait « pas de
    // mise en page » alors que l'objet R2 est là, et le prochain appareil à
    // publier repartirait d'un amorçage — la disposition de l'utilisateur
    // disparaîtrait de tous ses écrans.
    if (!publishedFiles[LAYOUT_META_FILE_ID] && remoteManifest.files[LAYOUT_META_FILE_ID]) {
      publishedFiles[LAYOUT_META_FILE_ID] = remoteManifest.files[LAYOUT_META_FILE_ID];
    }

    // MÊME GARDE POUR LES DEUX FICHIERS DE RAPPELS. Une remontée en échec
    // laisse l'entrée `pending_upload`, donc hors du filtre : le nuage
    // annoncerait « aucun rappel » alors que l'objet R2 est là, et l'appareil
    // suivant repartirait d'un fichier vide — les rappels de note et les
    // rappels libres disparaîtraient de tous les écrans.
    for (const fileId of REMINDER_META_FILE_IDS) {
      if (!publishedFiles[fileId] && remoteManifest.files[fileId]) {
        publishedFiles[fileId] = remoteManifest.files[fileId];
      }
    }

    // Même raisonnement pour un fichier EN CONFLIT : il n'a été ni remonté ni
    // supprimé, l'objet du nuage reste celui que décrit le manifeste distant.
    // Le statut `conflict` le sort du filtre ci-dessus ; sans cette reprise, le
    // nuage annoncerait sa disparition et les autres appareils écraseraient
    // l'objet R2 avec leur propre version pendant que l'utilisateur arbitre.
    for (const [id, entry] of Object.entries(localManifest.files)) {
      if (entry.status !== 'conflict' || publishedFiles[id]) continue;
      const remoteEntry = remoteManifest.files[id];
      if (remoteEntry) publishedFiles[id] = remoteEntry;
    }

    const cloudManifest: SyncManifest = {
      ...localManifest,
      profileMeta,
      encryptionKey,
      // Marqueur de capacité : ce desktop sait fusionner les notes note à note
      // (voir SyncManifest.notesMergeVersion). Réécrit à chaque publication.
      notesMergeVersion: NOTES_MERGE_VERSION,
      files: publishedFiles,
    };
    /**
     * NE REPUBLIER QUE SI QUELQUE CHOSE A CHANGÉ.
     *
     * Le manifeste était republié à CHAQUE cycle, même parfaitement vide :
     * `lastSyncAt` vaut « maintenant » à chaque passage, donc le document
     * différait toujours. Dans les journaux du 2026-09-02, la version passe de
     * 9886 à 9891 en vingt minutes sur cinq cycles qui n'ont rien transféré.
     *
     * C'était sans conséquence tant que personne n'écoutait. Ça ne l'est plus :
     * le canal de notification se déclenche sur l'avancée de cette version. Deux
     * appareils suffisaient alors à fabriquer une BOUCLE — A publie, le canal
     * réveille B, B publie, le canal réveille A — à la vitesse du réseau, sans
     * fin, et sans qu'aucune note ne bouge.
     *
     * La garde est délibérément conservatrice : au moindre doute on publie. Elle
     * ne se tait que si rien n'a bougé dans ce cycle ET que ce qu'on
     * publierait est déjà, mot pour mot, ce que le nuage porte.
     */
    const republish = manifest.shouldRepublishManifest({
      uploads: mergeResult.toUpload.length,
      downloads: mergeResult.toDownload.length,
      conflicts: mergeResult.conflicts.length,
      deletions: toDelete.length,
      notesPublished: notesCyclePublished,
      notesMergeVersion: NOTES_MERGE_VERSION,
      remote: remoteManifest,
      publishedFiles,
      profileMeta,
    });

    if (!republish) {
      log.info('[syncService] Manifeste inchangé — pas de republication');
    } else {
      const manifestJson = JSON.stringify(cloudManifest);
      const encryptedManifest = await StorageService.encryptWithFEK(
        Buffer.from(manifestJson, 'utf-8')
      );

      try {
        const newVersion = await r2.putManifest(profileId, encryptedManifest, remoteVersion);
        localManifest.version = newVersion;
      } catch (err) {
        if (err instanceof SyncConflictError) {
          log.warn('[syncService] Manifest conflict during upload, will retry next cycle');
          // Don't fail — the next sync cycle will re-merge
        } else {
          throw err;
        }
      }
    }

    /**
     * CE QUE LE NUAGE PORTE DOIT VIVRE AUSSI ICI. Quand le serveur répond 304,
     * c'est le manifeste local qui tient lieu de vue distante (le talon de
     * l'étape 2), et la garde de republication compare `notesMergeVersion` et
     * `profileMeta` avec lui. Le local ne les portait pas : « le nuage n'a pas
     * notre marqueur » à chaque cycle, donc 68 publications pour 0 « inchangé »
     * le 05/09/2026 — chacune avançant la version, donc réveillant tous les
     * autres appareils par le canal instantané, qui republiaient à leur tour.
     * Recopiés qu'on ait publié ou non : si la garde s'est tue, c'est que le
     * nuage les porte déjà tels quels.
     */
    localManifest.notesMergeVersion = cloudManifest.notesMergeVersion;
    localManifest.profileMeta = cloudManifest.profileMeta;

    // 10. Save local manifest
    await manifest.save(profileId, localManifest);

    /**
     * LE SONDAGE REPART D'ICI. Ce cycle vient de prouver que la session et le
     * réseau tiennent : c'est la seule chose qui lève une suspension (voir
     * `probeRemote`). Et la version qu'il connaît devient celle que ce cycle a
     * publiée — sinon le tic suivant demanderait un `If-None-Match` périmé et
     * relancerait un cycle complet dans la seconde, indéfiniment.
     */
    probeKnownVersion = localManifest.version ?? null;
    probeFailures = 0;
    probeSuspended = false;

    lastSyncAt = localManifest.lastSyncAt;
    updateState('idle');

    const conflicts = await manifest.getConflicts(profileId);
    const failed = await queue.getFailedItems();
    const pending = await queue.getPendingCount();

    // Fetch storage info from R2 and cache for getSyncStatus()
    // On first sync per session, reconcile counter from R2 to heal any drift.
    let storageUsed = 0;
    let storageLimit = 0;
    try {
      if (!storageReconciledThisSession.has(profileId)) {
        const reconciled = await r2.recalculateStorage(profileId);
        storageReconciledThisSession.add(profileId);
        if (reconciled) {
          storageUsed = reconciled.storageUsed;
          storageLimit = reconciled.storageLimit;
        }
      }
      if (storageLimit === 0) {
        const r2Status = await r2.getSyncStatus(profileId);
        storageUsed = r2Status.storageUsed;
        storageLimit = r2Status.storageLimit;
      }
      cachedStorageUsed = storageUsed;
      cachedStorageLimit = storageLimit;
    } catch {
      // Non-fatal — storage info unavailable
    }

    /*
      L'INVENTAIRE DES ORPHELINS — IL REGARDE, IL NE SUPPRIME PAS.

      `/sync/delta/gc` ramasse les blocs orphelins A L'INTERIEUR d'un fichier
      VIVANT ; `DELETE /sync/file` purge celui qu'on supprime. Aucun des deux ne
      visite un fichier DISPARU du manifeste sans etre passe par le DELETE — les
      deux iterent sur ce qui est encore la. Or l'ouverture de `scanLocalFiles`
      en fabrique a chaque migration de cles heritees, en retirant des entrees
      sans jamais reclamer les octets.

      Constate le 2026-09-07 sur le profil principal : 7,2 Go dans R2 pour 2,6 Go
      de manifeste, alors que le compteur est JUSTE (il vient du recalcul
      ci-dessus, qui liste R2). L'ecart est donc de vrais octets que plus rien ne
      reference, et rien ne les reclamait.

      `execute` N'EST PAS PASSE : cet appel ne supprime rien, il compte. Effacer
      de la donnee ne se declenche pas tout seul au demarrage d'une session — ca
      se demande. Ce journal est la pour qu'on sache ce qu'il y a A demander.

      UNE FOIS PAR SESSION, comme le recalcul, et pour la meme raison : un
      listing complet de profil est facture.
    */
    if (!orphanScanThisSession.has(profileId)) {
      orphanScanThisSession.add(profileId);
      try {
        const inventaire = await r2.gcProfile(
          profileId,
          Object.keys(localManifest.files),
          localManifest.version ?? 0
        );
        // Un refus n'est pas un inventaire : le type les distingue, et un
        // refus a deja ete journalise par `gcProfile` avec sa raison.
        if (inventaire && !('failed' in inventaire) && !inventaire.skipped && inventaire.orphanBytes > 0) {
          const mo = (n: number): string => (n / 1024 / 1024).toFixed(1);
          log.warn(
            `[sync] orphelins R2 sur ${profileId} : ${mo(inventaire.orphanBytes)} Mo ` +
              `en ${inventaire.orphanCount} objets (${inventaire.orphanFileCount} fichiers) ; ` +
              `vivant ${mo(inventaire.liveBytes)} Mo, total ${mo(inventaire.totalBytes)} Mo` +
              (inventaire.unknownCount > 0
                ? ` ; ${inventaire.unknownCount} objets de forme inconnue, CONSERVES`
                : '')
          );
          /*
            LA VENTILATION DESIGNE LA CAUSE, LE VOLUME NE LA DESIGNE PAS.

            Des MORCEAUX (`chunk`) veulent dire des fichiers ENTIERS laisses en
            place par une suppression ou un renommage qui n a pas purge le
            prefixe. Des BLOCS (`block`) veulent dire des fichiers
            synchronises en delta dont le `fileId` est mort. Deux causes, deux
            correctifs — et sans ca on suppose. On l a fait, a tort.
          */
          const p = inventaire.orphanByPiece;
          if (p) {
            log.warn(
              `[sync] ventilation : ${p.chunk.count} morceaux ${mo(p.chunk.bytes)} Mo | ` +
                `${p.block.count} blocs ${mo(p.block.bytes)} Mo | ` +
                `${p['delta-manifest'].count} manifestes delta ${mo(p['delta-manifest'].bytes)} Mo`
            );
          }
          if (inventaire.orphanFileIds?.length) {
            // Les identifiants sont des empreintes opaques, jamais des noms :
            // les journaliser n expose rien et permet de retrouver a quel
            // fichier disparu ils correspondaient.
            log.warn(
              `[sync] fichiers orphelins (${inventaire.orphanFileIds.length} premiers) : ` +
                inventaire.orphanFileIds.join(', ')
            );
          }
        }
      } catch {
        // Un inventaire rate n'a aucune consequence : il se refera.
      }
    }

    const status = {
      state: 'idle' as const,
      lastSyncAt,
      pendingItems: pending,
      failedItems: failed.length,
      conflicts: conflicts.length,
      storageUsed,
      storageLimit,
    };

    notifyRenderer('sync-status-changed', status);

    // Notify renderer to refresh file explorer + notes if files were downloaded.
    //
    // PAS DE `notes-updated` ICI. Ce test dit « au moins un objet quelconque est
    // descendu » — un PDF, une miniature, le metadata.json d'un dossier. Le
    // renderer y répondait par un `loadNotesFromDisk` qui REMPLACE `byId` en
    // bloc : tombé dans la fenêtre de 2 s du debounce d'auto-save, il annulait
    // le déplacement que l'utilisateur venait de faire, puis l'état périmé
    // repartait sur le disque. Les notes ont leur propre annonce, émise par
    // `downloadAndMergeNotes` UNIQUEMENT quand la fusion a réellement changé le
    // contenu (`remoteContentChanged`) — c'est le seul chemin d'écriture de
    // `notes.enc` côté descente, donc rien n'est perdu.
    if (mergeResult.toDownload.length > 0) {
      notifyRenderer('folders-updated', {});
      notifyRenderer('files-updated', {});

      // A folder we just pulled down may carry new reminders authored on
      // another device — re-arm the timer set so the user gets notified
      // at the right time instead of waiting up to 15min for the periodic
      // refresh.
      void reminderScheduler.rescheduleAll();
    }

    // Compute the actual upload outcomes by inspecting the manifest state
    // after the run — entries still in `pending_upload` mean the blob upload
    // failed (uploadFile rethrows on error). Same logic for downloads:
    // a fileId we tried to fetch but isn't `synced` afterward failed.
    const uploadAttempted = mergeResult.toUpload.length;
    const uploadSucceeded = mergeResult.toUpload.filter(
      (id) => localManifest.files[id]?.status === 'synced'
    ).length;
    const uploadFailed = uploadAttempted - uploadSucceeded;

    const downloadAttempted = mergeResult.toDownload.length;
    const downloadSucceeded = mergeResult.toDownload.filter(
      (id) => localManifest.files[id]?.status === 'synced'
    ).length;
    const downloadFailed = downloadAttempted - downloadSucceeded;

    log.info(
      `[syncService] Sync complete: ${uploadSucceeded}/${uploadAttempted} uploaded` +
        (uploadFailed > 0 ? ` (${uploadFailed} failed)` : '') +
        `, ${downloadSucceeded}/${downloadAttempted} downloaded` +
        (downloadFailed > 0 ? ` (${downloadFailed} failed)` : '') +
        `, ${mergeResult.conflicts.length} conflicts`
    );

    /**
     * RAMASSER LES ECHECS QUE LA REALITE A DEMENTIS.
     *
     * Un element epuise reste dans la file « pour la visibilite », et rien ne
     * l'en retirait jamais : `markSuccess` ne s'appelle que sur un element
     * qu'on vient de traiter, or un element epuise n'est plus jamais dequeue.
     * Un echec de descente du 13 aout est ainsi reste affiche DIX-NEUF JOURS
     * alors qu'un cycle ulterieur avait fait converger les deux cotes — un
     * badge rouge permanent sur un probleme resolu, qui apprend surtout a
     * ignorer l'indicateur.
     *
     * DEUX SIGNAUX CONCORDANTS sont exiges, et aucun ne suffit seul :
     *
     *   · la fusion de CE cycle n'a programme aucun travail pour la ressource.
     *     Seul, ce serait une ABSENCE d'information : une ressource disparue
     *     des deux cotes n'apparait pas non plus dans le travail du cycle.
     *   · l'entree locale se declare `synced`. Seul, cela ne parle que du
     *     disque local, pas de l'accord avec le nuage.
     *
     * Ensemble ils disent quelque chose de POSITIF : `mergeWithRemote` — qui
     * est l'autorite sur « reste-t-il du travail » — a examine cette entree et
     * conclu que non, et l'entree est installee. On n'en refait pas une
     * comparaison de contenu a cote : elle divergerait un jour de la vraie.
     *
     * Best-effort : ne jamais faire echouer un cycle reussi pour un menage.
     */
    try {
      const travailDuCycle = new Set([
        ...mergeResult.toUpload,
        ...mergeResult.toDownload,
        ...mergeResult.conflicts,
      ]);
      await queue.reapResolvedFailures(
        profileId,
        (item) =>
          !travailDuCycle.has(item.resourceId) &&
          localManifest.files[item.resourceId]?.status === 'synced'
      );
    } catch (err) {
      log.warn('[syncService] Reap des echecs perimes echoue:', (err as Error).message);
    }

    // Detect cloud-only files (synced in manifest but missing on disk)
    try {
      await manifest.detectCloudOnlyFiles(profileId, StorageService.getBaseDir());
    } catch {
      // Non-fatal
    }

    // Check for new profiles created on other devices
    try {
      const cloudProfiles = await authenticatedApiCall<{
        profiles: Array<{
          profileId: string;
          manifestVersion?: number;
          deletedAt?: string | null;
        }>;
      }>('/sync/profiles');

      if (cloudProfiles.success && cloudProfiles.data?.profiles) {
        const localProfiles = profileManager.getManifest().profiles;
        const localIds = new Set(localProfiles.map((p) => p.id));

        for (const cp of cloudProfiles.data.profiles) {
          /**
           * PIERRE TOMBALE — un profil supprimé du nuage depuis un autre
           * appareil. On ne le restaure pas (son manifeste n'existe plus), et on
           * ne SUPPRIME RIEN EN LOCAL : cet appareil peut détenir la dernière
           * copie de fichiers que personne n'a jamais remontés. L'écran de
           * gestion des profils le badge, et c'est la personne qui tranche.
           */
          if (cp.deletedAt) continue;
          // Le profil ACTIF vient de fusionner sa présentation à l'étape 2b bis,
          // depuis le manifeste déjà téléchargé de ce cycle : le relire ici
          // paierait un aller-retour R2 pour rejouer exactement le même calcul.
          if (cp.profileId === profileId) continue;
          if (localIds.has(cp.profileId)) {
            /**
             * DÉJÀ CONNU ≠ RIEN À FAIRE. Le profil actif a sa fusion à lui ;
             * les AUTRES profils du compte, eux, n'ont aucun cycle à eux tant
             * qu'ils ne sont pas ouverts — sans ce passage, un profil renommé
             * ailleurs gardait son ancien nom dans l'écran de choix jusqu'à ce
             * qu'on l'ouvre, c'est-à-dire précisément au moment où l'on cherche à
             * le reconnaître.
             *
             * Le manifeste d'un profil non actif se déchiffre avec la MÊME FEK
             * (une par compte) — c'est déjà ce que fait la restauration juste en
             * dessous. Un échec reste sans conséquence : on garde le local.
             *
             * On ne relit QUE ce qui a bougé : la version du manifeste avance à
             * chaque remontée, donc une version déjà examinée n'a rien de neuf à
             * dire, et on s'épargne un aller-retour R2 toutes les cinq minutes.
             */
            const version = cp.manifestVersion ?? 0;
            if (!version || otherProfileMetaVersionSeen.get(cp.profileId) === version) {
              continue;
            }
            otherProfileMetaVersionSeen.set(cp.profileId, version);
            try {
              const { manifest: otherEnc } = await r2.getManifest(cp.profileId);
              if (otherEnc) {
                const otherClear = await StorageService.decryptManifestAuto(otherEnc);
                const otherMf = JSON.parse(otherClear.toString('utf-8')) as SyncManifest;
                if (otherMf.profileMeta) {
                  const changed = await profileManager.applyCloudMetaUpdate(
                    cp.profileId,
                    otherMf.profileMeta
                  );
                  if (changed) {
                    notifyRenderer('profiles-updated', {});
                    log.info(
                      `[syncService] Profil ${cp.profileId} : présentation mise à jour depuis le nuage`
                    );
                  }
                }
              }
            } catch (err) {
              log.warn(
                `[syncService] Lecture du manifeste de ${cp.profileId} impossible (présentation inchangée):`,
                (err as Error).message
              );
            }
            continue;
          }
          if (profilesFailedToRestore.has(cp.profileId)) {
            // Already failed once this session — don't retry until next app
            // restart. The encryption key likely belongs to a different OS
            // user and isn't recoverable from this device.
            continue;
          }
          // New profile found on cloud — restore it
          log.info(`[syncService] New cloud profile detected: ${cp.profileId}, restoring...`);
          try {
            const { manifest: encManifest } = await r2.getManifest(cp.profileId);
            if (encManifest) {
              const decrypted = await StorageService.decryptManifestAuto(encManifest);
              const syncMf = JSON.parse(decrypted.toString('utf-8')) as SyncManifest;
              if (syncMf.profileMeta) {
                await profileManager.restoreProfileFromCloud(syncMf.profileMeta);
                if (syncMf.encryptionKey) {
                  const profDir = profileManager.getProfileDataDir(cp.profileId);
                  await StorageService.replaceEncryptionKey(syncMf.encryptionKey, profDir);
                }
                notifyRenderer('profiles-updated', {});
                log.info(`[syncService] Restored new profile: ${syncMf.profileMeta.name}`);
              }
            }
          } catch (err) {
            profilesFailedToRestore.add(cp.profileId);
            log.warn(
              `[syncService] Failed to restore profile ${cp.profileId} (will not retry this session):`,
              explainManifestFailure(err)
            );
          }
        }
      }
    } catch {
      // Non-fatal — profile discovery is best-effort
    }

    /*
      RATTRAPAGE DU RAMASSAGE — en FIN de cycle, jamais au milieu.

      Le ramassage n a aucune urgence : il recupere du stockage, il ne rend
      aucune donnee. Le faire passer avant un transfert ferait attendre
      l utilisateur pour une tache dont il ne verra jamais l effet.

      Borne a `selectForSweep` (20 par passage) parce que le serveur limite le
      ramassage a 120 appels par 300 s : saturer cette limite ferait echouer les
      GC NORMAUX, ceux qui suivent un commit, et on fabriquerait exactement les
      orphelins qu on essaie de ramasser.

      Chaque echec est absorbe : un rattrapage rate ne doit pas transformer un
      cycle reussi en cycle en erreur.
    */
    await sweepPendingGc(profileId);

    return status;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed';
    const stack = err instanceof Error ? err.stack : '';
    log.error('[syncService] Sync failed:', message, stack);
    metrics.errored();
    updateState('error');
    return getSyncStatus();
  } finally {
    isSyncing = false;
  }
}

/**
 * TRADUIT L'ECHEC DE DECHIFFREMENT D'UN MANIFESTE DE PROFIL.
 *
 * `crypto.subtle.decrypt` ne dit jamais pourquoi il refuse : toute erreur sort
 * en `OperationError: The operation failed for an operation-specific reason`,
 * message qui ne distingue pas un octet corrompu d'un mauvais scellement. Or
 * pour un manifeste de profil il n'y a qu'une cause realiste, et elle est
 * actionnable : le blob a ete scelle avec une AUTRE FEK que celle du compte
 * ouvert ici (profil cree sous un autre compte, ou avant un changement de mot
 * de passe qui a re-derive la FEK). Le journal doit le dire, sinon la ligne
 * ressemble a une panne reseau et on cherche au mauvais endroit.
 */
function explainManifestFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/operation-specific reason|OperationError/i.test(message)) {
    return `${message} (manifeste scelle avec une autre FEK que celle du compte actif — profil etranger a ce compte, ou anterieur a un changement de mot de passe)`;
  }
  return message;
}

// ── Upload Processing ───────────────────────────────────────────────────────

async function processUploads(
  profileId: string,
  fileIds: string[],
  localManifest: SyncManifest
): Promise<void> {
  // Une file tirée : trois envois en vol, chaque place libérée reprise aussitôt.
  await runPool(fileIds, MAX_PARALLEL_UPLOADS, (fileId) => uploadFile(profileId, fileId, localManifest));
}

async function uploadFile(
  profileId: string,
  fileId: string,
  localManifest: SyncManifest
): Promise<void> {
  try {
    const baseDir = StorageService.getBaseDir();
    const entry = localManifest.files[fileId];
    if (!entry) return;

    // Use localPath from manifest, or fall back to disk scan
    let filePath: string | null = null;
    if (entry.localPath) {
      filePath = path.join(baseDir, entry.localPath);
      try {
        await fs.access(filePath);
      } catch {
        filePath = null;
      }
    }
    if (!filePath) {
      filePath = await findFileOnDisk(baseDir, fileId);
    }
    if (!filePath) {
      // File not on disk. Only mark as deleted if it was previously synced
      // (meaning it existed and was intentionally removed).
      // If never synced (syncedAt === null), it's a stale manifest entry — just remove it.
      const entry = localManifest.files[fileId];

      // EXEMPTION DE SUPPRESSION — `meta:layout`. L'absence locale de
      // `layout.enc` ne prouve RIEN sur le nuage : profil restauré sur un poste
      // neuf, fichier pas encore descendu, clé machine indisponible au moment du
      // scan. Le marquer `deleted` propagerait la suppression et effacerait la
      // mise en page de TOUS les autres appareils — la remettre serait
      // impossible. On retire simplement l'entrée LOCALE : le prochain cycle la
      // reverra dans le manifeste distant et la fera descendre.
      if (fileId === LAYOUT_META_FILE_ID) {
        log.info('[syncService] layout.enc absent du disque — entrée locale retirée, jamais supprimée du nuage');
        delete localManifest.files[fileId];
        return;
      }

      // MÊME EXEMPTION POUR LES DEUX FICHIERS DE RAPPELS, et pour la même
      // raison : leur absence locale ne prouve rien sur le nuage (profil
      // restauré, fichier pas encore descendu, clé machine indisponible au
      // scan). Les marquer `deleted` effacerait les rappels de TOUS les autres
      // appareils, sans retour possible.
      if (REMINDER_META_FILE_IDS.has(fileId)) {
        log.info(
          `[syncService] ${reminderMetaFilename(fileId)} absent du disque — entrée locale retirée, jamais supprimée du nuage`
        );
        delete localManifest.files[fileId];
        return;
      }

      if (entry?.syncedAt) {
        log.info(`[syncService] Previously synced file gone from disk, marking deleted: ${fileId}`);
        entry.status = 'deleted';
        await manifest.markDeleted(profileId, fileId);
      } else {
        log.info(`[syncService] Unsynced file not on disk, removing from manifest: ${fileId}`);
        delete localManifest.files[fileId];
      }
      return;
    }

    // Size gates (see constants above):
    //  - > 5 GiB: never synced (V3 format cap) — local-only.
    //  - 500 MB..5 GiB: only PORTABLE blobs (V3-FEK hybrid containers) sync,
    //    via the resumable from-disk multipart path. Machine-key V3 blobs
    //    (local-mode profiles) stay local-only — not portable.
    const fileStat = await fs.stat(filePath);
    if (fileStat.size > MAX_PORTABLE_SYNC_FILE_SIZE) {
      markEntryLocalOnly(localManifest, fileId, entry.localPath, fileStat.size, fileStat.mtime.toISOString());
      skipOversizedFile(fileId, entry.localPath, fileStat.size, 'too-large');
      return;
    }
    // Portability is decided once (a chunk-0 FEK probe) and reused by the delta
    // gate below, so a large hybrid file pays for it at most once per attempt.
    let portableChecked: boolean | null = null;
    if (fileStat.size > MAX_SYNC_FILE_SIZE) {
      // Portable already, or a one-time auto-migration made it portable
      // (cloud/hybrid session with the session FEK loaded). A machine-key blob
      // on a genuine local-only profile stays local_only.
      portableChecked = await ensureOversizedPortable(fileId, filePath);
      if (!portableChecked) {
        markEntryLocalOnly(localManifest, fileId, entry.localPath, fileStat.size, fileStat.mtime.toISOString());
        skipOversizedFile(fileId, entry.localPath, fileStat.size, 'not-portable');
        return;
      }
    }

    /*
      LE MEME TAMPON QU AU BALAYAGE — sinon on relit le fichier DEUX FOIS
      par cycle.

      Le balayage vient de hacher ce fichier et a rangé l empreinte dans
      l entrée ; la rehacher ici doublait la lecture. Sur les quatre copies
      de 1,28 Go du 2026-09-07, ça faisait dix gigaoctets relus par cycle
      au lieu de cinq.

      Le contrôle n est PAS abandonné : si le fichier a bougé entre le
      balayage et la remontée, sa `mtime` a changé, le tampon ne vaut plus
      et `stampedChecksum` rehache. C est précisément ce qu il sait faire.
    */
    const checksum = await stampedChecksum(fileId, filePath, fileStat, entry.checksum);

    // Check quota before uploading
    if (cachedStorageLimit > 0 && cachedStorageUsed + fileStat.size > cachedStorageLimit) {
      log.warn(`[syncService] Skipping ${fileId}: file size ${fileStat.size} exceeds remaining quota (${cachedStorageLimit - cachedStorageUsed} bytes left)`);
      if (!quotaExceededNotified) {
        quotaExceededNotified = true;
        notifyRenderer('sync-quota-exceeded', {});
      }
      return;
    }

    // ── Block-level DELTA arm (opt-in) ──────────────────────────────────────
    // A large PORTABLE hybrid file (V3-FEK, >= 64 MiB) whose Worker advertises
    // delta support uploads only its CHANGED 8 MiB blocks. Everything else (meta
    // entries, small files, machine-key/non-portable blobs, or delta capability
    // off) uses the existing path untouched. Any DeltaUnavailable falls back.
    if (
      !fileId.startsWith('meta:') &&
      fileStat.size >= DELTA_THRESHOLD &&
      (await r2.getDeltaSyncCapability())
    ) {
      const portable =
        portableChecked !== null
          ? portableChecked
          : await StorageService.isPortableV3File(filePath);
      if (portable) {
        try {
          const res = await deltaSync.uploadDelta({
            profileId,
            fileId,
            localPath: filePath,
            transport: deltaTransport,
            crypto: getDeltaCrypto(),
            onProgress: (transferred, total) => {
              notifyRenderer('sync-file-status-changed', {
                fileId,
                localPath: entry.localPath,
                status: 'pending_upload',
                transferredBytes: transferred,
                totalBytes: total,
              });
            },
          });
          /*
            UN COMMIT REOUVRE LE BESOIN DE RAMASSAGE.

            Il vient de creer des orphelins — les blocs de l ancienne version —
            et il change la version dont la garde du serveur depend. Le
            ramassage qui suit immediatement est au mieux ; s il echoue, c est
            cet etat qui le fera reprendre.
          */
          const gcCle = `${profileId}:${fileId}`;
          const gcAvant = gcStates.get(gcCle) ?? initialState(fileId, res.version);
          gcStates.set(gcCle, afterCommit(gcAvant, res.version));

          const e = localManifest.files[fileId];
          if (e) {
            e.checksum = checksum; // encrypted on-disk checksum — local change detection
            e.size = fileStat.size;
            e.syncedAt = new Date().toISOString();
            e.chunks = []; // delta files carry no chunk_N keys
            e.status = 'synced';
            e.plaintextChecksum = res.plaintextChecksum;
            e.delta = { version: res.version, blockCount: res.blockCount };
            e.lastDirection = 'up';
          }
          log.info(
            `[syncService] Delta uploaded ${fileId}: ${res.blocksUploaded} block(s), ` +
              `${res.transferredBytes} B transferred of ${fileStat.size} B on disk (v${res.version}` +
              (res.skipped ? ', unchanged' : '') +
              ')'
          );
          return;
        } catch (err) {
          if (err instanceof deltaSync.DeltaUnavailableError) {
            log.info(
              `[syncService] Delta unavailable for ${fileId}, using standard path: ${err.message}`
            );
            // fall through to the existing multipart/legacy path
          } else {
            // Block-upload failure / conflict-retries exhausted / vault locked:
            // let the outer catch enqueue a retry (old cloud state intact).
            throw err;
          }
        }
      }
    }

    // Pick the upload strategy by size:
    //   - Small files (< MULTIPART_THRESHOLD): legacy chunked path,
    //     each chunk indexed independently in the manifest. Cheaper
    //     in Class A operations for tiny files.
    //   - Large files (>= MULTIPART_THRESHOLD): resumable R2 multipart
    //     upload streamed FROM DISK (64 MiB parts, one reused buffer,
    //     per-part retry, crash resume via multipart-resume.json). A single
    //     logical chunk at index 0. Avoids both the 96 MB per-request cap
    //     on Workers and whole-file buffering in main-process RAM.
    const chunks: string[] = [];
    const byos = (await r2.getStorageMode()) === 'byos';
    /*
      MAGASIN LOCAL : LE MULTIPART EST HORS DE PORTEE, PAS SEULEMENT INDESIRABLE.

      Le multipart, direct comme proxifie, demande au WORKER d'executer trois
      appels S3 de controle — CreateMultipartUpload, CompleteMultipartUpload,
      AbortMultipartUpload. Sur un magasin local, le worker ne joint pas le
      magasin : ces trois appels echouent, et une session ouverte qu'on ne peut
      ni finaliser ni abandonner laisserait des parts orphelines a la charge de
      l'utilisateur.

      On force donc le chemin en MORCEAUX : un objet par tranche, chacun envoye
      par une simple URL presignee. Ce n'est pas un pis-aller — c'est exactement
      ce que fait le mobile depuis toujours, et le chemin de LECTURE le sait
      deja lire (`chunks.length` cote telechargement). Aucun format nouveau.
    */
    const local = byos && (await r2.isLocalStore());
    if (!local && (byos || fileStat.size >= r2.MULTIPART_THRESHOLD)) {
      const resumePath = getResumeStorePath(profileId);
      // Live byte-progress → renderer ETA (mirrors the delta emit above), for
      // BOTH the direct and proxied multipart paths. multipartTransfer already
      // fires onProgress at part granularity, so no throttle is needed here.
      const onUploadProgress = (doneBytes: number, total: number): void => {
        notifyRenderer('sync-file-status-changed', {
          fileId,
          localPath: entry.localPath,
          status: 'pending_upload',
          transferredBytes: doneBytes,
          totalBytes: total,
        });
      };
      // Prefer the DIRECT-to-R2 plane (presigned parts PUT straight to R2,
      // bounded-parallel, dynamic part sizing) when the Worker advertises it.
      // The capability is probed once and cached for the session.
      const directAvailable = await r2.getDirectUploadCapability();
      let result: { key: string; size: number };
      // Direct indisponible en byos ? Le chemin proxy est redevenu SÛR : il
      // relaie vers le bucket de l'utilisateur (objectStore), plus jamais vers
      // le R2 Filarr. On le laisse donc servir de repli, comme pour Filarr Cloud.
      if (directAvailable) {
        try {
          result = await r2.uploadViaMultipartDirectFromPath(
            profileId,
            fileId,
            filePath,
            fileStat.size,
            checksum,
            resumePath,
            { onProgress: onUploadProgress }
          );
        } catch (err) {
          if (err instanceof r2.ByosSyncError) throw err;
          const msg = err instanceof Error ? err.message : String(err);
          // Quota is deterministic — the proxied path would be rejected
          // identically, so don't waste a doomed round-trip; let the outer
          // catch surface the quota notification. A clearly-transient failure
          // keeps the DIRECT resume state on disk so the next cycle resumes
          // direct rather than restarting on the proxied path.
          if (/quota/i.test(msg) || msg.includes('413') || r2.isClearlyTransientError(err)) {
            throw err;
          }
          // (Le repli proxy vaut aussi en BYOS : il écrit dans le bucket user.)
          // Anything else means the direct plane is unusable here (secrets
          // pulled, S3 error, session lost after its one restart): abort the
          // orphaned S3 session + clear its resume state, then FALL BACK to
          // the unchanged proxied multipart path.
          if (err instanceof r2.DirectUploadUnavailableError) {
            r2.markDirectUnavailable();
          }
          log.warn(`[syncService] Direct upload failed for ${fileId}, falling back to proxied: ${msg}`);
          await r2.abortDirectSession(fileId, resumePath).catch(() => {});
          result = await r2.uploadViaMultipartFromPath(
            profileId,
            fileId,
            filePath,
            fileStat.size,
            checksum,
            resumePath,
            { onProgress: onUploadProgress }
          );
        }
      } else {
        result = await r2.uploadViaMultipartFromPath(
          profileId,
          fileId,
          filePath,
          fileStat.size,
          checksum,
          resumePath,
          { onProgress: onUploadProgress }
        );
      }
      chunks.push(result.key);
    } else {
      const fileData = await fs.readFile(filePath);
      const totalChunks = Math.ceil(fileData.byteLength / CHUNK_SIZE);
      for (let ci = 0; ci < totalChunks; ci++) {
        const start = ci * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, fileData.byteLength);
        const chunkBuffer = fileData.slice(start, end);

        const result = await r2.uploadChunk(profileId, fileId, ci, chunkBuffer);
        chunks.push(result.key);
      }
    }

    // Update local manifest
    // Update in-memory only — disk save happens once at end of triggerSync
    if (localManifest.files[fileId]) {
      localManifest.files[fileId].checksum = checksum;
      localManifest.files[fileId].size = fileStat.size;
      localManifest.files[fileId].syncedAt = new Date().toISOString();
      localManifest.files[fileId].chunks = chunks;
      localManifest.files[fileId].status = 'synced';
      // Accusé de réception vers le renderer : voir `notifyMetadataChanged`.
      if (fileId.startsWith('meta:')) {
        notifyRenderer('sync-file-status-changed', { fileId, status: 'synced' });
      }
      localManifest.files[fileId].lastDirection = 'up';
      if (fileId === NOTES_META_FILE_ID && checksum) ownNotesChecksums.add(checksum);
    }

    log.info(`[syncService] Uploaded ${fileId} (${chunks.length} chunk(s), ${fileStat.size} bytes)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed';
    log.error(`[syncService] Upload failed for ${fileId}:`, message);

    // Notify renderer if quota exceeded (once per sync cycle)
    if (message.includes('quota') || message.includes('413') || message.includes('Quota')) {
      if (!quotaExceededNotified) {
        quotaExceededNotified = true;
        notifyRenderer('sync-quota-exceeded', {});
      }
    }

    // Enqueue for retry (idempotent — duplicates are skipped by the queue)
    await queue.enqueue({
      type: 'upload',
      resourceType: 'file',
      resourceId: fileId,
      profileId,
      priority: 'normal',
    });

    // Rethrow so callers can distinguish success from failure. processUploads
    // wraps each call in Promise.allSettled (no-op), but processQueue relies
    // on this to call markFailed instead of markSuccess — without it, retries
    // were being silently marked as completed.
    throw err;
  }
}

// ── Download Processing ─────────────────────────────────────────────────────

async function processDownloads(
  profileId: string,
  fileIds: string[],
  remoteManifest: SyncManifest,
  localManifest: SyncManifest
): Promise<void> {
  // Une file tirée : trois descentes en vol, chaque place libérée reprise aussitôt.
  await runPool(fileIds, MAX_PARALLEL_DOWNLOADS, (fileId) =>
    downloadFile(profileId, fileId, remoteManifest, localManifest)
  );
}

/**
 * Rapatrie le blob distant dans un fichier TEMPORAIRE à côté de sa destination
 * et vérifie son empreinte. N'installe rien : l'appelant renomme (installation
 * atomique) ou lit le temporaire pour le fusionner. Le temporaire est effacé en
 * cas d'échec ; l'appelant est responsable du sien en cas de succès.
 */
async function fetchRemoteBlobToTemp(
  profileId: string,
  fileId: string,
  remoteEntry: SyncFileEntry,
  targetPath: string,
  progressLocalPath: string | undefined
): Promise<{ tmpPath: string; checksum: string; byteLength: number }> {
  const chunkCount = remoteEntry.chunks?.length || 1;
  const byos = (await r2.getStorageMode()) === 'byos';
  const useRanged = chunkCount === 1 && (byos || remoteEntry.size > r2.MULTIPART_THRESHOLD);
  // Ranged downloads can run for minutes on multi-GB blobs — use the
  // scanner-excluded suffix so a concurrent scanLocalFiles never treats
  // the partial file as vault content.
  const tmpPath = targetPath + (useRanged ? SYNC_DL_TMP_SUFFIX : '.tmp');

  let checksum: string;
  let byteLength: number;
  if (useRanged) {
    // Large single blob (multipart-uploaded): bounded-parallel ranged GETs
    // written at their correct offsets in the temp file, then a streaming
    // sha256 pass — the blob never sits whole in RAM. Prefer a single
    // reusable presigned R2 GET (direct) when available, else the proxied
    // per-range single-use-token path.
    const directAvailable = await r2.getDirectUploadCapability();
    // Live byte-progress → renderer ETA for large ranged downloads, mirroring
    // the upload emit. downloadToFileParallel fires onProgress per range, so
    // no throttle is needed here.
    const onDownloadProgress = (doneBytes: number, total: number): void => {
      notifyRenderer('sync-file-status-changed', {
        fileId,
        localPath: progressLocalPath,
        status: 'pending_download',
        transferredBytes: doneBytes,
        totalBytes: total,
      });
    };
    try {
      let result: { checksum: string; size: number };
      // Même règle qu'au téléversement : le proxy lit désormais le bucket de
      // l'utilisateur, il redevient un repli légitime quand le direct manque.
      if (directAvailable) {
        try {
          result = await r2.downloadChunkToFileDirectRanged(
            profileId,
            fileId,
            0,
            remoteEntry.size,
            tmpPath,
            { onProgress: onDownloadProgress }
          );
        } catch (err) {
          if (err instanceof r2.ByosSyncError) throw err;
          if (r2.isClearlyTransientError(err)) throw err;
          if (err instanceof r2.DirectUploadUnavailableError) r2.markDirectUnavailable();
          const msg = err instanceof Error ? err.message : String(err);
          log.warn(`[syncService] Direct download failed for ${fileId}, falling back to proxied: ${msg}`);
          result = await r2.downloadChunkToFileRangedParallel(
            profileId,
            fileId,
            0,
            remoteEntry.size,
            tmpPath,
            { onProgress: onDownloadProgress }
          );
        }
      } else {
        result = await r2.downloadChunkToFileRangedParallel(
          profileId,
          fileId,
          0,
          remoteEntry.size,
          tmpPath,
          { onProgress: onDownloadProgress }
        );
      }
      checksum = result.checksum;
      byteLength = result.size;
      if (remoteEntry.checksum && checksum !== remoteEntry.checksum) {
        // Manifest/object desync (concurrent upload?) — do not install a
        // blob we cannot vouch for; next cycle re-fetches the manifest.
        throw new Error(`Checksum mismatch on ranged download for ${fileId}`);
      }
    } catch (err) {
      await fs.unlink(tmpPath).catch(() => {});
      throw err;
    }
  } else {
    // Small/legacy path: buffered chunks (≤ 500 MB by construction).
    const chunkBuffers: Buffer[] = [];
    for (let ci = 0; ci < chunkCount; ci++) {
      const chunk = await r2.downloadChunk(profileId, fileId, ci);
      chunkBuffers.push(chunk);
    }
    const fileData = Buffer.concat(chunkBuffers);
    await fs.writeFile(tmpPath, fileData);
    checksum = crypto.createHash('sha256').update(fileData).digest('hex');
    byteLength = fileData.byteLength;
    if (remoteEntry.checksum && checksum !== remoteEntry.checksum) {
      /*
        DÉSACCORD MANIFESTE / OBJET — ON DEMANDE AU CHIFFREMENT.

        La clé d'objet est DÉTERMINISTE et partagée entre appareils, alors
        que la publication du manifeste passe par un compare-and-set : un
        appareil qui écrit l'objet puis PERD la course du manifeste laisse
        celui-ci annoncer l'empreinte de l'autre. Le désaccord est alors
        PERMANENT.

        Refuser était juste ; ne rien réparer ensuite ne l'était pas.
        Trois tentatives, un recul, puis plus jamais rien. Le 2026-09-07 :
        vingt-cinq fichiers bloqués depuis la veille, dont `meta:layout`.

        L'empreinte du manifeste n'est qu'un PRÉ-CONTRÔLE ; la garantie
        d'intégrité est le chiffrement authentifié. Si les octets
        s'ouvrent, ils viennent d'un client détenteur de la clé — c'est
        l'empreinte qui est périmée, pas eux. On adopte alors les octets
        et on republie l'empreinte JUSTE (celle qu'on vient de calculer),
        ce qui répare le manifeste pour tous les appareils.

        « JE N'AI PAS PU VÉRIFIER » N'EST PAS « C'EST BON ». Coffre
        verrouillé, clé de session absente : on refuse et on réessaiera.

        CE CHEMIN SEULEMENT, et c'est délibéré. Le chemin par plages sert
        les blobs de plusieurs gigaoctets : les rouvrir pour les vérifier
        coûterait des minutes à chaque tentative. Les désaccords observés
        sont tous ici — métadonnées de dossier, mise en page, petits
        fichiers — parce que ce sont eux que deux appareils réécrivent en
        même temps.
      */
      const erreur = await erreurDOuverture(tmpPath);
      const verdict = verdictBlobDivergent(erreur);
      if (!adopteLesOctets(verdict)) {
        await fs.unlink(tmpPath).catch(() => {});
        throw new Error(
          `Checksum mismatch on buffered download for ${fileId} (${verdict})`
        );
      }
      log.warn(
        `[syncService] ${fileId} : le manifeste annonçait ${remoteEntry.checksum.slice(0, 8)}, `
          + `les octets valent ${checksum.slice(0, 8)} et s'ouvrent — empreinte périmée, `
          + `on adopte les octets et on republie l'empreinte juste`
      );
    }
  }

  return { tmpPath, checksum, byteLength };
}

/**
 * L'échec de déchiffrement vient-il d'une CLÉ INDISPONIBLE (état transitoire)
 * plutôt que d'un contenu corrompu ?
 *
 * `StorageService.decrypt` attend `initPromise` puis exige `this.key` : tant que
 * le coffre n'est pas déverrouillé — ou si safeStorage refuse la clé — il jette
 * « StorageService not initialized — encryption key not loaded » AVANT même de
 * regarder les octets. `notes:load` (main.ts) distingue déjà ce cas par le même
 * marqueur pour ne pas conclure « pas de notes ». Ici l'enjeu est plus grave :
 * confondre les deux ferait passer un blob local sain pour illisible, donc
 * remplaçable par le distant.
 *
 * Un vrai ciphertext corrompu échoue autrement : « Unsupported state or unable
 * to authenticate data » (GCM), « Encrypted data too short », « Invalid IV
 * length », JSON invalide — aucun de ces messages ne cite la clé.
 */
export function isKeyUnavailableError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  if (code === 'EACCES' || code === 'EPERM') return true; // fichier de clé illisible
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes('not initialized') ||
    message.includes('encryption key') ||
    message.includes('safeStorage')
  );
}

/**
 * CE QUE VAUT UN BLOB DONT L'EMPREINTE NE CORRESPOND PAS AU MANIFESTE.
 *
 * ── LE BLOCAGE QUE CECI DÉBLOQUE ────────────────────────────────────────────
 *
 * L'empreinte annoncée par le manifeste et les octets réellement posés dans le
 * magasin peuvent diverger : la clé d'objet est DÉTERMINISTE et partagée entre
 * appareils, alors que la publication du manifeste passe par un
 * compare-and-set. Un appareil qui écrit l'objet puis perd la course du
 * manifeste laisse le manifeste annoncer l'empreinte de l'AUTRE.
 *
 * Refuser était juste. Mais après le refus, RIEN ne réparait : trois
 * tentatives, un recul, puis plus rien — jamais. Constaté le 2026-09-07 sur un
 * compte ouvert depuis deux postes : vingt-cinq fichiers bloqués depuis la
 * veille, dont `meta:layout`, et une centaine d'erreurs répétées. Ces fichiers
 * ne seraient JAMAIS redescendus.
 *
 * ── POURQUOI ACCEPTER N'AFFAIBLIT PAS LE CHIFFREMENT ────────────────────────
 *
 * L'empreinte du manifeste n'est pas la garantie d'intégrité de Filarr : c'est
 * un PRÉ-CONTRÔLE bon marché. La vraie garantie est le chiffrement authentifié
 * (AES-GCM) — un serveur qui substituerait ou altérerait des octets ne saurait
 * pas produire un tag valide sans la clé, et le déchiffrement échouerait.
 *
 * Donc : si les octets s'OUVRENT, ils viennent d'un client Filarr détenteur de
 * la clé. Ce ne sont pas des octets à jeter, c'est l'empreinte qui est
 * périmée. On adopte les octets et on republie l'empreinte JUSTE — celle qu'on
 * vient de calculer — ce qui répare le manifeste pour tous les appareils.
 *
 * ── LE CAS QU'IL NE FAUT SURTOUT PAS CONFONDRE ──────────────────────────────
 *
 * « Je n'ai pas pu vérifier » n'est pas « c'est bon ». Coffre verrouillé, clé
 * de session absente, fichier de clé illisible : le déchiffrement échoue AVANT
 * de regarder les octets. Accepter dans ce cas reviendrait à faire confiance au
 * magasin sans aucun contrôle — exactement ce que le pré-contrôle existait pour
 * éviter. On refuse, et on réessaiera coffre ouvert.
 */
/**
 * LE BLOB S'OUVRE-T-IL ? Rend `null` si oui, l'erreur sinon.
 *
 * ── POURQUOI DEUX TENTATIVES, ET PAS UNE ────────────────────────────────────
 *
 * UN MÊME CONTENEUR EXISTE EN DEUX REPRÉSENTATIONS, et chacune a SON décodeur :
 *
 *   · `decryptFileAuto` lit un fichier de coffre — conteneur V3 en flux, ou
 *     conteneur machine sous forme d'OCTETS (`decryptBinary`) ;
 *   · `decrypt` lit un conteneur machine sous forme de TEXTE — c'est celui de
 *     `notes.enc`, `layout.enc` et des `metadata.json`.
 *
 * Les deux portent le même marqueur `v3:`. Donner le texte au décodeur binaire
 * échoue sur le tag GCM — « Unsupported state or unable to authenticate data »
 * — et ressemble EXACTEMENT à une corruption.
 *
 * C'est ce que mon premier jet faisait : il ne consultait que le décodeur
 * binaire, donc TOUTE entrée `meta:` était jugée corrompue. Le refus était le
 * même qu'avant la réparation — aucune régression — mais la réparation ne
 * s'appliquait jamais aux seules entrées qui en avaient besoin, et le journal
 * accusait une corruption qui n'existait pas. Observé le 2026-09-08 sur
 * `meta:notes`, `meta:layout` et un `meta:<dossier>`, à chaque cycle.
 *
 * On demande donc à CHAQUE lecteur réel, pas à un seul. Le blob est authentique
 * si l'un d'eux l'ouvre — c'est la définition utile : « un client détenteur de
 * la clé a écrit ces octets ».
 *
 * L'erreur rendue est celle du PREMIER décodeur : c'est elle qui distingue
 * « clé indisponible » de « contenu corrompu », et la seconde tentative ne
 * change pas ce diagnostic quand les deux échouent.
 */
async function erreurDOuverture(tmpPath: string): Promise<unknown | null> {
  try {
    await StorageService.decryptFileAuto(tmpPath);
    return null;
  } catch (binaire) {
    try {
      // Un conteneur TEXTE commence par son marqueur en clair. On ne lit le
      // fichier en entier que si les trois premiers octets le promettent.
      const tete = await fs.readFile(tmpPath, { encoding: 'utf-8', flag: 'r' });
      if (/^v[123]:/.test(tete.slice(0, 3))) {
        await StorageService.decrypt(tete);
        return null;
      }
    } catch {
      // Le second décodeur échoue aussi : c'est l'erreur du premier qui porte
      // le diagnostic, on la laisse remonter telle quelle.
    }
    return binaire;
  }
}

export type VerdictBlob = 'authentique' | 'cle-indisponible' | 'corrompu';

/**
 * Traduit l'issue d'une tentative de déchiffrement en verdict.
 *
 * `null` = le déchiffrement a réussi. PUR : c'est la décision, pas l'E/S, qui
 * est délicate ici — et c'est elle qu'on veut pouvoir exercer.
 */
export function verdictBlobDivergent(erreurDeDechiffrement: unknown | null): VerdictBlob {
  if (erreurDeDechiffrement === null || erreurDeDechiffrement === undefined) {
    return 'authentique';
  }
  // La distinction vit déjà dans `isKeyUnavailableError`, écrite pour la même
  // raison ailleurs : confondre les deux ferait passer un blob sain pour
  // illisible. Ici la faute symétrique est pire — elle ferait passer un blob
  // INVÉRIFIABLE pour authentique.
  return isKeyUnavailableError(erreurDeDechiffrement) ? 'cle-indisponible' : 'corrompu';
}

/** Un seul verdict autorise à adopter les octets. */
export function adopteLesOctets(verdict: VerdictBlob): boolean {
  return verdict === 'authentique';
}

/**
 * Ancêtre commun des notes : l'horloge de chaque entrée telle que la dernière
 * fusion l'a arrêtée. Sert UNIQUEMENT à distinguer une vraie divergence (les
 * deux côtés ont écrit) d'un simple rattrapage (un seul a écrit) avant de
 * fabriquer une copie de conflit — voir `selectGenuineConflicts`.
 *
 * Fichier en clair, à côté de `notes.enc` : il ne contient que des ids et des
 * horodatages, exactement ce que `note-versions/{noteId}/` expose déjà en nom de
 * dossier. Aucun titre, aucun contenu. Le scan de remontée l'ignore (il ne
 * ramasse que `notes.enc` et les DOSSIERS de la racine).
 */
const NOTES_BASE_FILENAME = '.notes-merge-base.json';

async function readNotesMergeBase(baseDir: string): Promise<NotesMergeBase | null> {
  try {
    const raw = JSON.parse(
      await fs.readFile(path.join(baseDir, NOTES_BASE_FILENAME), 'utf-8')
    ) as Partial<NotesMergeBase>;
    if (!raw || typeof raw !== 'object') return null;
    // La table DISTANTE n'est reprise que si elle est là : une base écrite par
    // une version antérieure n'en a pas, et `selectGenuineConflicts` retombe
    // alors sur la comparaison à l'union — plus stricte, jamais bavarde.
    const remote = raw.remote;
    return {
      notes: raw.notes ?? {},
      notebooks: raw.notebooks ?? {},
      ...(remote && typeof remote === 'object'
        ? { remote: { notes: remote.notes ?? {}, notebooks: remote.notebooks ?? {} } }
        : {}),
    };
  } catch {
    // Absent (première fusion) ou illisible : aucun ancêtre connu. Le cycle
    // reste prudent — il ne fabrique aucune copie — et la base repart d'ici.
    return null;
  }
}

/** Écriture atomique : une base tronquée coûterait un cycle sans copie. */
async function writeNotesMergeBase(baseDir: string, base: NotesMergeBase): Promise<void> {
  const target = path.join(baseDir, NOTES_BASE_FILENAME);
  const tmp = `${target}.${process.pid.toString(36)}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(base), 'utf-8');
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    log.warn(`[syncService] base de fusion des notes non enregistrée: ${(err as Error).message}`);
  }
}

/** Ce que la section critique de la fusion rapporte à son appelant. */
interface NotesMergeOutcome {
  /** Le local apporte du neuf : l'union doit repartir vers le nuage. */
  changedFromRemote: boolean;
  /** Une note a bougé → le renderer doit recharger son store. */
  remoteContentChanged: boolean;
  /** `notes.enc` a été réécrit pendant la section critique. */
  wroteLocal: boolean;
  /** Empreinte du `notes.enc` sur le DISQUE — calculée seulement si on remonte. */
  diskChecksum: string | null;
  diskSize: number;
  /** mtime du fichier après écriture, en ISO. */
  diskUpdatedAt: string;
  /** Versions perdantes sauvées en copies de conflit pendant cette fusion. */
  conflictCopies: number;
  /**
   * L'entrée de manifeste a été publiée et la remontée TENTÉE dans la section
   * critique (cas des copies de conflit) : l'appelant ne doit refaire ni l'une
   * ni l'autre.
   */
  publishedInLock: boolean;
  /**
   * Notes RETENUES parce qu'une session d'édition vivante les tient : leur
   * arbitrage est reporté au premier cycle qui suit la fin de la session, et
   * aucune remontée ne part tant qu'il en reste (elle écraserait dans le nuage
   * la version distante qu'on vient de ne pas arbitrer).
   */
  heldLiveNotes: number;
}

/**
 * DESCENTE DES NOTES — fusion note à note, jamais un écrasement.
 *
 * `notes.enc` n'est pas un fichier comme les autres : c'est UN blob qui porte
 * TOUTES les notes, et le desktop comme le web y écrivent des morceaux
 * différents. Le chemin ordinaire de téléchargement réécrit le fichier en place,
 * donc un desktop porteur d'éditions jamais remontées (hors ligne, remontée
 * échouée) perdait tout ce qu'il avait écrit dès que le nuage bougeait — sans
 * copie de sauvegarde, car la copie de conflit exige que les deux côtés aient
 * bougé depuis la synchro d'en face, ce qui n'est pas le cas d'un local
 * simplement en retard d'horloge.
 *
 * Ici : on rapatrie le conteneur distant DANS UN TEMPORAIRE, on le déchiffre
 * (clé machine, la même que celle qui a scellé `notes.enc`), on déchiffre le
 * local, on fusionne au grain de la note (`notesMergeCore`), puis on réécrit —
 * et on repousse l'union si le local apportait du neuf. Tout ce qui touche au
 * fichier passe par `withNotesLock`, partagé avec l'auto-save `notes:save`.
 *
 * Chaque échec laisse le LOCAL INTACT : conteneur distant illisible, clé
 * indisponible, fusion refusée par son filet anti-rétrécissement, sauvegarde de
 * secours impossible, écriture impossible — dans tous ces cas on ne touche pas à
 * `notes.enc`, on ne réécrit pas l'entrée de manifeste, et le cycle suivant
 * réessaiera.
 *
 * Exportée pour la suite `__tests__/notesSyncWrite.vitest.ts` : c'est le seul
 * chemin d'écriture de `notes.enc` côté descente, et ses refus d'écrire sont
 * précisément ce qui doit rester verrouillé.
 */
export async function downloadAndMergeNotes(
  profileId: string,
  fileId: string,
  remoteEntry: SyncFileEntry,
  localManifest: SyncManifest
): Promise<void> {
  const baseDir = StorageService.getBaseDir();
  const notesPath = path.join(baseDir, NOTES_BLOB_FILENAME);
  await fs.mkdir(baseDir, { recursive: true });

  // Ancêtre commun + dernier accord PROUVÉ avec le nuage, lus AVANT que
  // l'entrée de manifeste ne soit réécrite plus bas. `synced` veut dire que le
  // `notes.enc` d'alors est bien parti (uploadFile) ou qu'il égalait déjà le
  // distant ; tout autre statut = des notes locales que le nuage n'a jamais
  // vues, donc aucun accord à invoquer (`null` = on ne conclut rien).
  const priorNotesBase = await readNotesMergeBase(baseDir);
  const priorEntry = localManifest.files[fileId];
  const agreedAtMs =
    priorEntry?.status === 'synced' && priorEntry.syncedAt
      ? Date.parse(priorEntry.syncedAt)
      : null;

  if (remoteEntry.delta) {
    // Les entrées `meta:` n'empruntent jamais le delta par blocs (uploadFile
    // l'exclut explicitement). Si cela arrivait, refuser plutôt que de retomber
    // sur un chemin qui écrase.
    throw new Error(`Entrée notes en delta inattendue (${fileId}) — fusion refusée`);
  }

  const {
    tmpPath,
    checksum: remoteChecksum,
    byteLength,
  } = await fetchRemoteBlobToTemp(
    profileId,
    fileId,
    remoteEntry,
    `${notesPath}.remote`,
    NOTES_BLOB_FILENAME
  );

  /**
   * Réécrit l'entrée de manifeste des notes EN ENTIER (un `meta:notes` resté en
   * `conflict` retombe ici sur un statut sain).
   *
   * L'EMPREINTE PUBLIÉE DOIT DÉSIGNER UN OBJET QUI EXISTE. Quand la fusion
   * converge, rien ne part vers R2 : publier l'empreinte du fichier LOCAL
   * annonçait au nuage un objet introuvable, et l'appareil suivant cassait sur
   * un « Checksum mismatch » en descendant les notes. On recopie donc
   * l'empreinte, la taille et les morceaux DEPUIS le distant.
   */
  const publishEntry = (facts: {
    changedFromRemote: boolean;
    diskChecksum: string | null;
    diskSize: number;
    diskUpdatedAt: string;
  }): void => {
    localManifest.files[fileId] = {
      localPath: NOTES_BLOB_FILENAME,
      // `diskChecksum` n'est renseigné que quand on remonte ; sinon l'empreinte
      // et la taille sont celles de l'objet R2 réellement descendu.
      checksum: facts.diskChecksum ?? remoteChecksum,
      size: facts.changedFromRemote ? facts.diskSize : byteLength,
      updatedAt: facts.diskUpdatedAt,
      syncedAt: new Date().toISOString(),
      chunks: remoteEntry.chunks?.length ? remoteEntry.chunks : ['chunk_0'],
      // La fusion apporte du local que le nuage n'a pas → il faut la repousser,
      // sinon l'autre appareil ne verra jamais ces notes.
      status: facts.changedFromRemote ? 'pending_upload' : 'synced',
    };
  };

  try {
    // 1. Distant. Illisible (clé machine d'un autre appareil, blob tronqué) →
    //    on ne touche à rien : mieux vaut ne pas converger que détruire. Le
    //    réseau et ce déchiffrement restent HORS du verrou : ils ne touchent
    //    pas à `notes.enc` et dureraient autrement le temps d'un PBKDF2 pendant
    //    lequel plus aucune sauvegarde ne passerait.
    const remoteContainer = await fs.readFile(tmpPath, 'utf-8');
    let remotePayload: NotesPayload;
    try {
      remotePayload = (await StorageService.decrypt(remoteContainer)) as NotesPayload;
    } catch (err) {
      log.error(
        `[syncService] notes.enc distant illisible — local préservé, aucune écriture: ${
          (err as Error).message
        }`
      );
      return;
    }

    // 2. SECTION CRITIQUE — lire, fusionner, écrire `notes.enc` en exclusion
    //    mutuelle avec `notes:save` (main.ts). Sans ce verrou, une sauvegarde
    //    partie entre notre lecture et notre écriture était écrasée par la
    //    fusion, et les deux écritures pouvaient se croiser dans le temporaire
    //    d'encryptToFile. `null` = on n'a rien écrit et rien à publier.
    const outcome = await withNotesLock(async (): Promise<NotesMergeOutcome | null> => {
      let localContainer: string | null = null;
      try {
        localContainer = await fs.readFile(notesPath, 'utf-8');
      } catch {
        localContainer = null; // pas encore de notes sur cet appareil
      }

      let localPayload: NotesPayload | null = null;
      if (localContainer !== null) {
        try {
          localPayload = (await StorageService.decrypt(localContainer)) as NotesPayload;
        } catch (err) {
          // CLÉ INDISPONIBLE ≠ CONTENU CORROMPU. Sans la clé machine (coffre
          // encore verrouillé, safeStorage pas prêt), le blob local est peut-être
          // parfaitement sain : le traiter comme illisible ferait passer TOUTES
          // les notes de cet appareil à la trappe au profit du distant. On ne
          // touche à rien, le cycle suivant réessaiera avec la clé.
          if (isKeyUnavailableError(err)) {
            log.warn(
              `[syncService] Clé indisponible pour lire notes.enc — aucune écriture, reprise au prochain cycle: ${
                (err as Error).message
              }`
            );
            return null;
          }
          // Ciphertext réellement corrompu : le distant peut être installé, mais
          // JAMAIS avant d'avoir mis l'original de côté. Une copie ratée
          // (disque plein, droits) annule le cycle — l'écrasement sans filet
          // était la perte définitive de notes que personne ne pouvait plus
          // récupérer.
          const backup = `${notesPath}.unreadable-${Date.now()}`;
          try {
            await fs.copyFile(notesPath, backup);
          } catch (copyErr) {
            log.error(
              `[syncService] notes.enc local corrompu (${(err as Error).message}) mais la ` +
                `sauvegarde de secours a échoué (${(copyErr as Error).message}) — ` +
                'aucune écriture, local conservé tel quel'
            );
            return null;
          }
          log.error(
            `[syncService] notes.enc local corrompu (${
              (err as Error).message
            }) — copie conservée dans ${path.basename(backup)}, installation du distant`
          );
        }
      }

      let changedFromLocal: boolean;
      let changedFromRemote: boolean;
      let remoteContentChanged: boolean;
      /**
       * Charge utile à sceller, ou `null` pour installer les OCTETS distants tels
       * quels — ce qui vaut dès que la fusion égale le distant : rechiffrer
       * produirait le même contenu sous une empreinte différente, que le cycle
       * suivant repousserait pour rien.
       */
      let payloadToSeal: NotesPayload | null = null;
      let conflictCopies = 0;
      /** Notes retenues parce qu'une session vivante les édite (arbitrage reporté). */
      let heldLiveNotes: string[] = [];

      if (localPayload === null) {
        changedFromLocal = true;
        changedFromRemote = false;
        remoteContentChanged = true;
      } else {
        let merged;
        try {
          merged = mergeNotesPayload(localPayload, remotePayload);
        } catch (err) {
          // Filet anti-rétrécissement : la fusion refuse de rendre moins de notes
          // que le local. Rien n'est réécrit.
          log.error(
            `[syncService] Fusion des notes refusée — local préservé: ${(err as Error).message}`
          );
          return null;
        }
        changedFromLocal = merged.changedFromLocal;
        changedFromRemote = merged.changedFromRemote;
        remoteContentChanged = merged.remoteContentChanged;

        // GARDE DES SESSIONS VIVANTES (liste publiée par le renderer). Une note
        // en cours d'édition collaborative n'est jamais remplacée par la
        // fusion : son contenu durable est produit par le CRDT, frappe après
        // frappe. L'arbitrage est REPORTÉ au premier cycle qui suit la fin de
        // la session — la version distante reste dans le nuage jusque-là, donc
        // on ne remonte rien ce cycle-ci.
        heldLiveNotes = preserveLiveSessionNotes(localPayload, merged.merged, (id) =>
          isNoteInLiveSession(id)
        );
        if (heldLiveNotes.length > 0) {
          changedFromLocal = !deepEqual(merged.merged, localPayload);
          changedFromRemote = false;
          remoteContentChanged = remoteContentChanged && changedFromLocal;
          // IMPÉRATIF : désigner la charge à sceller, même sans remontée. Sans
          // elle, `installRemoteBytes` adopterait le conteneur DISTANT tel quel
          // et emporterait justement la note qu'on vient de retenir.
          payloadToSeal = merged.merged;
        }
        if (changedFromRemote) payloadToSeal = merged.merged;

        // ARBITRAGE DESTRUCTEUR → COPIE. Même geste que `handleConflict` pour un
        // fichier ordinaire (copie `_conflict_<horodatage>`), mais au grain de la
        // note : le contenu que l'horloge vient d'écarter ne part pas sans trace.
        // Une note VIVANTE en est exclue : elle n'a rien perdu, son arbitrage
        // n'a pas eu lieu. Le filtre porte sur la liveur, jamais sur
        // `heldLiveNotes` — cette liste ne contient que les notes qu'il a fallu
        // RÉTABLIR, donc elle est vide dès que l'arbitrage a déjà donné le local
        // gagnant, ce qui est le cas ordinaire en session (chaque appareil
        // réécrit la note toutes les 2 s). Filtrer là-dessus fabriquait une
        // copie de conflit par cycle pendant toute la collaboration.
        conflictCopies = applyConflictCopies(
          merged.merged,
          selectGenuineConflicts(
            dropLiveSessionConflicts(merged.overwritten, (id) => isNoteInLiveSession(id)),
            merged.merged,
            priorNotesBase,
            agreedAtMs
          ),
          { now: new Date().toISOString(), newId: () => crypto.randomUUID(), device: 'desktop' }
        );
        if (conflictCopies > 0 && heldLiveNotes.length > 0) {
          // Les copies existent, mais remonter écraserait la version distante
          // qu'on vient de ne pas arbitrer : elles partiront au cycle suivant.
          payloadToSeal = merged.merged;
          changedFromLocal = true;
          remoteContentChanged = true;
        } else if (conflictCopies > 0) {
          // Les copies n'existent que chez nous : il faut les sceller ICI et les
          // pousser, et le renderer doit recharger — sa prochaine sauvegarde
          // reconstruit le payload depuis Redux et les effacerait sinon.
          payloadToSeal = merged.merged;
          changedFromLocal = true;
          changedFromRemote = true;
          remoteContentChanged = true;
        }
      }

      /** L'union à sceller, ou `null` si le disque la porte déjà telle quelle. */
      const toSeal = changedFromLocal ? payloadToSeal : null;
      /**
       * Rien à remonter : on adopte les OCTETS distants au lieu de garder un
       * container local équivalent mais chiffré sous un autre sel. Le fichier
       * devient l'objet R2 à l'octet près, donc l'empreinte publiée plus bas
       * désigne bien quelque chose, et `scanLocalFiles` ne rouvre pas une
       * remontée à chaque cycle sur un simple écart de sel.
       */
      const installRemoteBytes = payloadToSeal === null && localContainer !== remoteContainer;
      const willWrite = toSeal !== null || installRemoteBytes;

      if (willWrite) {
        // Ceinture ET bretelles : le verrou interdit déjà qu'une sauvegarde
        // s'intercale, mais un écrivain qui l'ignorerait doit encore être vu.
        let currentContainer: string | null = null;
        try {
          currentContainer = await fs.readFile(notesPath, 'utf-8');
        } catch {
          currentContainer = null;
        }
        if (currentContainer !== localContainer) {
          log.warn(
            '[syncService] notes.enc a changé pendant la fusion — écriture abandonnée, reprise au prochain cycle'
          );
          return null;
        }

        if (toSeal === null) {
          await fs.rename(tmpPath, notesPath);
        } else {
          // encryptToFile écrit un temporaire puis renomme : jamais de notes.enc
          // tronqué même si le processus meurt en cours d'écriture.
          await StorageService.encryptToFile(toSeal, notesPath);
        }
      }

      // L'état qui vient d'être arrêté devient l'ancêtre du prochain cycle —
      // DEUX tables : ce que le disque porte désormais (l'union scellée, ou le
      // distant quand il n'y avait rien à y ajouter) et ce que le NUAGE servait
      // à cet instant. Confondre les deux faisait avancer l'ancêtre du distant
      // sur des écritures locales jamais remontées, et le cycle suivant prenait
      // le nuage RESTÉ EN ARRIÈRE pour un nuage qui a écrit : copie de conflit
      // d'une note que personne d'autre n'avait touchée.
      await writeNotesMergeBase(
        baseDir,
        collectMergeBase(payloadToSeal ?? remotePayload, remotePayload)
      );

      // `updatedAt` doit refléter le fichier RÉELLEMENT sur le disque (sinon
      // scanLocalFiles le reverrait comme modifié et bouclerait). L'empreinte
      // du disque ne sert qu'au cas « on remonte » : quand on ne remonte pas,
      // c'est l'entrée DISTANTE qui fait foi (voir plus bas).
      const stat = await fs.stat(notesPath);
      const facts = {
        changedFromRemote,
        diskChecksum: changedFromRemote ? await streamingSha256(notesPath) : null,
        diskSize: stat.size,
        diskUpdatedAt: stat.mtime.toISOString(),
      };

      /**
       * REMONTÉE DANS LA SECTION CRITIQUE quand des copies de conflit viennent
       * d'être fabriquées. Elles n'existent QUE sur ce disque tant qu'elles ne
       * sont pas parties, et `notes:save` (auto-save du renderer) reconstruit le
       * payload entier depuis Redux : si le renderer n'a pas encore rechargé, sa
       * sauvegarde suivante les efface — et rien ne les refabriquera, puisque la
       * base d'ancêtres vient d'être avancée. Publier et pousser sans rendre le
       * verrou ferme cette fenêtre : une fois dans le nuage, la copie revient
       * par la fusion même si le local la perd. Le verrou n'est tenu pendant un
       * envoi QUE dans ce cas rare, jamais pour une descente ordinaire.
       */
      let publishedInLock = false;
      if (conflictCopies > 0) {
        publishEntry(facts);
        publishedInLock = true;
        if (changedFromRemote && !uploadsBlockedThisCycle) {
          try {
            await uploadFile(profileId, fileId, localManifest);
          } catch (err) {
            log.warn(
              `[syncService] Remontée des copies de conflit échouée (retentera): ${
                (err as Error).message
              }`
            );
          }
        }
      }

      return {
        ...facts,
        remoteContentChanged,
        wroteLocal: willWrite,
        conflictCopies,
        publishedInLock,
        heldLiveNotes: heldLiveNotes.length,
      };
    });

    if (outcome === null) return;

    const { changedFromRemote, remoteContentChanged } = outcome;

    // 3. Manifeste local — sauf si la section critique l'a déjà publié ET
    //    remonté (copies de conflit) : le réécrire ici rétrograderait en
    //    `pending_upload` une entrée que `uploadFile` vient de passer à `synced`.
    if (!outcome.publishedInLock) publishEntry(outcome);

    log.info(
      `[syncService] Notes fusionnées (${byteLength} B distants, ${outcome.diskSize} B sur disque) — ` +
        `réécriture locale: ${outcome.wroteLocal}, remontée nécessaire: ${changedFromRemote}`
    );
    if (outcome.conflictCopies > 0) {
      log.info(
        `[syncService] ${outcome.conflictCopies} version(s) écrasée(s) conservée(s) en copie de conflit`
      );
    }
    if (outcome.heldLiveNotes > 0) {
      log.info(
        `[syncService] ${outcome.heldLiveNotes} note(s) en session vivante — arbitrage reporté au prochain cycle`
      );
    }

    if (remoteContentChanged) notifyRenderer('notes-updated', {});

    // 4. Remontée de l'union DANS LE MÊME CYCLE : l'étape 9 de triggerSync ne
    //    publie que les entrées `synced`, une entrée restée `pending_upload`
    //    disparaîtrait donc du manifeste nuage. Un échec n'est pas fatal
    //    (uploadFile a déjà réenfilé une tentative) : le local reste juste.
    if (changedFromRemote && !uploadsBlockedThisCycle && !outcome.publishedInLock) {
      try {
        await uploadFile(profileId, fileId, localManifest);
      } catch (err) {
        log.warn(
          `[syncService] Remontée des notes fusionnées échouée (retentera): ${(err as Error).message}`
        );
      }
    }
  } finally {
    // Le temporaire a pu être renommé (cas « pas de local ») — ignorer l'absence.
    await fs.unlink(tmpPath).catch(() => {});
  }
}

/** Ce que la section critique de la fusion de mise en page rapporte. */
interface LayoutMergeOutcome {
  /** Le local apporte du neuf : l'union doit repartir vers le nuage. */
  changedFromRemote: boolean;
  /** `layout.enc` a été réécrit → le renderer doit relire sa mise en page. */
  wroteLocal: boolean;
  /** Empreinte du fichier SUR LE DISQUE — calculée seulement si on remonte. */
  diskChecksum: string | null;
  diskSize: number;
  diskUpdatedAt: string;
  /** Vues dont l'arbitrage a écarté une disposition (copie conservée). */
  conflicts: number;
}

/**
 * DESCENTE DE LA MISE EN PAGE — fusion vue à vue, jamais un écrasement.
 *
 * `layout.enc` n'est pas un fichier comme les autres : c'est UN blob qui porte
 * TOUTES les vues, et chaque appareil en édite des morceaux différents (l'un
 * range son accueil, l'autre un dossier). Le chemin ordinaire de téléchargement
 * réécrit le fichier en place : un appareil porteur de changements jamais
 * remontés perdrait tout dès que le nuage bouge.
 *
 * Ici : on rapatrie le conteneur distant DANS UN TEMPORAIRE, on le déchiffre
 * (clé machine, la même que celle qui a scellé `layout.enc`), on déchiffre le
 * local, on fusionne AU GRAIN DE LA VUE (`layoutMergeCore`), puis on réécrit —
 * et on repousse l'union si le local apportait du neuf. Tout ce qui touche au
 * fichier passe par `withLayoutLock`, partagé avec l'écriture `layout:save`.
 *
 * Chaque échec laisse le LOCAL INTACT : conteneur distant illisible, clé
 * indisponible, sauvegarde de secours impossible, écriture impossible — dans
 * tous ces cas on ne touche pas à `layout.enc`, on ne réécrit pas l'entrée de
 * manifeste, et le cycle suivant réessaiera.
 *
 * Exportée pour les tests : c'est le seul chemin d'écriture de `layout.enc`
 * côté descente, et ses refus d'écrire sont précisément ce qui doit rester
 * verrouillé.
 */
export async function downloadAndMergeLayout(
  profileId: string,
  fileId: string,
  remoteEntry: SyncFileEntry,
  localManifest: SyncManifest
): Promise<void> {
  const baseDir = StorageService.getBaseDir();
  const layoutPath = path.join(baseDir, LAYOUT_BLOB_FILENAME);
  await fs.mkdir(baseDir, { recursive: true });

  if (remoteEntry.delta) {
    // Les entrées `meta:` n'empruntent jamais le delta par blocs (uploadFile
    // l'exclut explicitement). Si cela arrivait, refuser plutôt que de retomber
    // sur un chemin qui écrase.
    throw new Error(`Entrée de mise en page en delta inattendue (${fileId}) — fusion refusée`);
  }

  const {
    tmpPath,
    checksum: remoteChecksum,
    byteLength,
  } = await fetchRemoteBlobToTemp(
    profileId,
    fileId,
    remoteEntry,
    `${layoutPath}.remote`,
    LAYOUT_BLOB_FILENAME
  );

  /**
   * Réécrit l'entrée de manifeste EN ENTIER. Même règle que pour les notes :
   * quand la fusion converge, rien ne part vers R2, donc l'empreinte publiée
   * doit être celle de l'objet DISTANT — publier celle du fichier local
   * annoncerait au nuage un objet introuvable, et l'appareil suivant casserait
   * sur un « Checksum mismatch ».
   */
  const publishEntry = (facts: {
    changedFromRemote: boolean;
    diskChecksum: string | null;
    diskSize: number;
    diskUpdatedAt: string;
  }): void => {
    localManifest.files[fileId] = {
      localPath: LAYOUT_BLOB_FILENAME,
      checksum: facts.diskChecksum ?? remoteChecksum,
      size: facts.changedFromRemote ? facts.diskSize : byteLength,
      updatedAt: facts.diskUpdatedAt,
      syncedAt: new Date().toISOString(),
      chunks: remoteEntry.chunks?.length ? remoteEntry.chunks : ['chunk_0'],
      status: facts.changedFromRemote ? 'pending_upload' : 'synced',
    };
  };

  try {
    // 1. Distant. Illisible (clé machine d'un autre appareil, blob tronqué) →
    //    on ne touche à rien. Le réseau et ce déchiffrement restent HORS du
    //    verrou : ils ne touchent pas à `layout.enc`.
    const remoteContainer = await fs.readFile(tmpPath, 'utf-8');
    let remoteDoc: LayoutDocument;
    try {
      remoteDoc = normalizeLayoutDocument(await StorageService.decrypt(remoteContainer));
    } catch (err) {
      log.error(
        `[syncService] layout.enc distant illisible — local préservé, aucune écriture: ${
          (err as Error).message
        }`
      );
      return;
    }

    // 2. SECTION CRITIQUE — lire, fusionner, écrire en exclusion mutuelle avec
    //    `layout:save`. `null` = on n'a rien écrit et rien à publier.
    const outcome = await withLayoutLock(async (): Promise<LayoutMergeOutcome | null> => {
      let localContainer: string | null = null;
      try {
        localContainer = await fs.readFile(layoutPath, 'utf-8');
      } catch {
        localContainer = null; // pas encore de mise en page sur cet appareil
      }
      if (localContainer !== null && localContainer.trim() === '') localContainer = null;

      let localDoc: LayoutDocument | null = null;
      if (localContainer !== null) {
        try {
          localDoc = normalizeLayoutDocument(await StorageService.decrypt(localContainer));
        } catch (err) {
          // CLÉ INDISPONIBLE ≠ CONTENU CORROMPU (voir downloadAndMergeNotes).
          if (isKeyUnavailableError(err)) {
            log.warn(
              `[syncService] Clé indisponible pour lire layout.enc — aucune écriture, reprise au prochain cycle: ${
                (err as Error).message
              }`
            );
            return null;
          }
          // Ciphertext réellement corrompu : le distant peut être installé, mais
          // JAMAIS avant d'avoir mis l'original de côté.
          const backup = `${layoutPath}.unreadable-${Date.now()}`;
          try {
            await fs.copyFile(layoutPath, backup);
          } catch (copyErr) {
            log.error(
              `[syncService] layout.enc local corrompu (${(err as Error).message}) mais la ` +
                `sauvegarde de secours a échoué (${(copyErr as Error).message}) — aucune écriture`
            );
            return null;
          }
          log.error(
            `[syncService] layout.enc local corrompu — copie conservée dans ${path.basename(
              backup
            )}, installation du distant`
          );
        }
      }

      let changedFromLocal: boolean;
      let changedFromRemote: boolean;
      let conflicts = 0;
      /**
       * Document à sceller, ou `null` pour installer les OCTETS distants tels
       * quels — ce qui vaut dès que la fusion égale le distant : rechiffrer
       * produirait le même contenu sous un sel différent, que le cycle suivant
       * repousserait pour rien.
       */
      let docToSeal: LayoutDocument | null = null;

      if (localDoc === null) {
        changedFromLocal = true;
        changedFromRemote = false;
      } else {
        const merged = mergeLayoutDocuments(localDoc, remoteDoc);
        changedFromLocal = merged.changedFromLocal;
        changedFromRemote = merged.changedFromRemote;
        conflicts = merged.conflicts.length;
        if (changedFromRemote) docToSeal = merged.merged;
      }

      const toSeal = changedFromLocal ? docToSeal : null;
      const installRemoteBytes = docToSeal === null && localContainer !== remoteContainer;
      const willWrite = toSeal !== null || installRemoteBytes;

      if (willWrite) {
        // Ceinture ET bretelles : le verrou interdit déjà qu'une écriture
        // s'intercale, mais un écrivain qui l'ignorerait doit encore être vu.
        let currentContainer: string | null = null;
        try {
          currentContainer = await fs.readFile(layoutPath, 'utf-8');
        } catch {
          currentContainer = null;
        }
        if (currentContainer !== localContainer) {
          log.warn(
            '[syncService] layout.enc a changé pendant la fusion — écriture abandonnée, reprise au prochain cycle'
          );
          return null;
        }

        if (toSeal === null) {
          await fs.rename(tmpPath, layoutPath);
        } else {
          await StorageService.encryptToFile(toSeal, layoutPath);
        }
      }

      const stat = await fs.stat(layoutPath);
      return {
        changedFromRemote,
        wroteLocal: willWrite,
        diskChecksum: changedFromRemote ? await streamingSha256(layoutPath) : null,
        diskSize: stat.size,
        diskUpdatedAt: stat.mtime.toISOString(),
        conflicts,
      };
    });

    if (outcome === null) return;

    publishEntry(outcome);

    log.info(
      `[syncService] Mise en page fusionnée (${byteLength} B distants, ${outcome.diskSize} B sur disque) — ` +
        `réécriture locale: ${outcome.wroteLocal}, remontée nécessaire: ${outcome.changedFromRemote}`
    );
    if (outcome.conflicts > 0) {
      log.info(
        `[syncService] ${outcome.conflicts} vue(s) arbitrée(s) — disposition perdante conservée 30 jours`
      );
    }

    // Le renderer tient sa mise en page en mémoire : sans cette annonce, la
    // disposition arrivée du nuage n'apparaîtrait qu'au prochain démarrage.
    if (outcome.wroteLocal) notifyRenderer('layout-updated', {});

    // Remontée DANS LE MÊME CYCLE : l'étape 9 de triggerSync ne publie que les
    // entrées `synced`, une entrée restée `pending_upload` disparaîtrait du
    // manifeste nuage. Un échec n'est pas fatal — le local reste juste.
    if (outcome.changedFromRemote && !uploadsBlockedThisCycle) {
      try {
        await uploadFile(profileId, fileId, localManifest);
      } catch (err) {
        log.warn(
          `[syncService] Remontée de la mise en page fusionnée échouée (retentera): ${
            (err as Error).message
          }`
        );
      }
    }
  } finally {
    // Le temporaire a pu être renommé (cas « pas de local ») — ignorer l'absence.
    await fs.unlink(tmpPath).catch(() => {});
  }
}

/**
 * DESCENTE DES RAPPELS DE NOTE ET DES RAPPELS LIBRES — fusion enregistrement par
 * enregistrement, jamais un écrasement.
 *
 * Même situation exactement que `layout.enc` : UN fichier porte les rappels des
 * DEUX appareils. Le chemin ordinaire de téléchargement réécrit le fichier en
 * place, donc l'appareil porteur d'un rappel jamais remonté le perdrait dès que
 * le nuage bouge. Le format et les quatre règles d'arbitrage vivent dans
 * `reminderMetaDoc` ; ici, on ne fait qu'enchaîner : rapatrier, déchiffrer,
 * fusionner, réécrire, republier.
 *
 * Chaque échec laisse le LOCAL INTACT — conteneur distant illisible, clé
 * indisponible, fichier modifié pendant la fusion : dans tous ces cas on ne
 * touche à rien, on ne réécrit pas l'entrée de manifeste, et le cycle suivant
 * réessaiera.
 *
 * Exportée pour les tests : c'est le seul chemin d'écriture de ces deux fichiers
 * côté descente.
 */
export async function downloadAndMergeReminders(
  profileId: string,
  fileId: string,
  remoteEntry: SyncFileEntry,
  localManifest: SyncManifest
): Promise<void> {
  const filename = reminderMetaFilename(fileId);
  if (!filename) throw new Error(`Clé de rappels inconnue: ${fileId}`);

  const baseDir = StorageService.getBaseDir();
  const localPath = path.join(baseDir, filename);
  await fs.mkdir(baseDir, { recursive: true });

  if (remoteEntry.delta) {
    // Les entrées `meta:` n'empruntent jamais le delta par blocs (uploadFile
    // l'exclut). Si cela arrivait, refuser plutôt que de retomber sur un chemin
    // qui écrase.
    throw new Error(`Entrée de rappels en delta inattendue (${fileId}) — fusion refusée`);
  }

  const { tmpPath, byteLength } = await fetchRemoteBlobToTemp(
    profileId,
    fileId,
    remoteEntry,
    `${localPath}.remote`,
    filename
  );

  try {
    // 1. Distant. Illisible → on ne touche à rien. Le réseau et ce
    //    déchiffrement restent hors de toute section critique.
    const remoteContainer = await fs.readFile(tmpPath, 'utf-8');
    let remoteDoc: unknown;
    try {
      remoteDoc = await StorageService.decrypt(remoteContainer);
    } catch (err) {
      log.error(
        `[syncService] ${filename} distant illisible — local préservé, aucune écriture: ${
          (err as Error).message
        }`
      );
      return;
    }

    // 2. Local. Absent = un tableau vide, ce qui est VRAI (aucun rappel de
    //    cette famille sur cet appareil) et ce que la fusion attend.
    let localContainer: string | null = null;
    try {
      localContainer = await fs.readFile(localPath, 'utf-8');
    } catch {
      localContainer = null;
    }
    if (localContainer !== null && localContainer.trim() === '') localContainer = null;

    let localDoc: unknown = [];
    if (localContainer !== null) {
      try {
        localDoc = await StorageService.decrypt(localContainer);
      } catch (err) {
        // CLÉ INDISPONIBLE ≠ CONTENU CORROMPU. Dans le premier cas le fichier
        // est probablement sain : le remplacer par le distant effacerait les
        // rappels créés ici. On s'abstient et on réessaiera.
        if (isKeyUnavailableError(err)) {
          log.warn(
            `[syncService] Clé indisponible pour lire ${filename} — aucune écriture: ${
              (err as Error).message
            }`
          );
          return;
        }
        const backup = `${localPath}.unreadable-${Date.now()}`;
        try {
          await fs.copyFile(localPath, backup);
        } catch (copyErr) {
          log.error(
            `[syncService] ${filename} local corrompu (${(err as Error).message}) mais la ` +
              `sauvegarde de secours a échoué (${(copyErr as Error).message}) — aucune écriture`
          );
          return;
        }
        log.error(
          `[syncService] ${filename} local corrompu — copie conservée dans ${path.basename(
            backup
          )}, fusion sur un tableau vide`
        );
        localDoc = [];
      }
    }

    const merge = mergeReminderDocs(localDoc, remoteDoc);

    if (merge.changedFromLocal) {
      // Ceinture ET bretelles : `StorageService` peut réécrire ce fichier
      // pendant que le réseau tournait (l'utilisateur crée un rappel). On
      // relit avant d'écrire ; un écart abandonne l'écriture plutôt que
      // d'effacer ce qui vient d'être posé.
      let currentContainer: string | null = null;
      try {
        currentContainer = await fs.readFile(localPath, 'utf-8');
      } catch {
        currentContainer = null;
      }
      if (currentContainer !== localContainer) {
        log.warn(
          `[syncService] ${filename} a changé pendant la fusion — écriture abandonnée, reprise au prochain cycle`
        );
        return;
      }
      await StorageService.encryptToFile(merge.merged, localPath);
    }

    const stat = await fs.stat(localPath).catch(() => null);
    const diskChecksum = stat ? await streamingSha256(localPath) : null;

    /**
     * L'entrée de manifeste est réécrite EN ENTIER. Même règle que pour les
     * notes et la mise en page : quand la fusion égale le distant, rien ne part
     * vers R2, donc l'empreinte publiée doit être celle de l'objet DISTANT —
     * publier celle du fichier local annoncerait au nuage un objet introuvable,
     * et l'appareil suivant casserait sur un « Checksum mismatch ».
     */
    localManifest.files[fileId] = {
      localPath: filename,
      checksum: merge.changedFromRemote ? (diskChecksum ?? remoteEntry.checksum) : remoteEntry.checksum,
      size: merge.changedFromRemote ? (stat?.size ?? byteLength) : byteLength,
      updatedAt: stat ? stat.mtime.toISOString() : remoteEntry.updatedAt,
      syncedAt: new Date().toISOString(),
      chunks: remoteEntry.chunks?.length ? remoteEntry.chunks : ['chunk_0'],
      status: merge.changedFromRemote ? 'pending_upload' : 'synced',
    };

    log.info(
      `[syncService] ${filename} fusionné (${merge.merged.length} rappel(s)) — ` +
        `réécriture locale: ${merge.changedFromLocal}, remontée nécessaire: ${merge.changedFromRemote}`
    );

    // Le renderer tient sa liste de rappels en mémoire, et le planificateur ses
    // minuteurs : sans cette annonce, ce qui vient d'arriver du nuage
    // n'apparaîtrait — et ne sonnerait — qu'au prochain démarrage.
    if (merge.changedFromLocal) notifyRenderer('reminders-updated', {});

    // Remontée DANS LE MÊME CYCLE : l'étape 9 ne publie que les entrées
    // `synced`, une entrée restée `pending_upload` disparaîtrait du manifeste
    // nuage. Un échec n'est pas fatal — le local reste juste.
    if (merge.changedFromRemote && !uploadsBlockedThisCycle) {
      try {
        await uploadFile(profileId, fileId, localManifest);
      } catch (err) {
        log.warn(
          `[syncService] Remontée de ${filename} fusionné échouée (retentera): ${
            (err as Error).message
          }`
        );
      }
    }
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
}

async function downloadFile(
  profileId: string,
  fileId: string,
  remoteManifest: SyncManifest,
  localManifest: SyncManifest
): Promise<void> {
  try {
    const remoteEntry = remoteManifest.files[fileId];
    if (!remoteEntry) {
      log.warn(`[syncService] No remote entry for download: ${fileId}`);
      return;
    }

    // LES NOTES NE SE TÉLÉCHARGENT PAS, ELLES SE FUSIONNENT. Seul chemin
    // d'écriture de notes.enc côté descente — voir downloadAndMergeNotes.
    if (fileId === NOTES_META_FILE_ID) {
      await downloadAndMergeNotes(profileId, fileId, remoteEntry, localManifest);
      return;
    }

    // LA MISE EN PAGE NON PLUS : elle se FUSIONNE vue à vue. Seul chemin
    // d'écriture de layout.enc côté descente — voir downloadAndMergeLayout.
    if (fileId === LAYOUT_META_FILE_ID) {
      await downloadAndMergeLayout(profileId, fileId, remoteEntry, localManifest);
      return;
    }

    // LES RAPPELS NON PLUS : un seul tableau porte ceux des deux appareils.
    // Fusion enregistrement par enregistrement — voir `reminderMetaDoc`.
    if (REMINDER_META_FILE_IDS.has(fileId)) {
      await downloadAndMergeReminders(profileId, fileId, remoteEntry, localManifest);
      return;
    }

    // If chunks list is empty, try downloading chunk_0 (single-chunk file)
    const chunkCount = remoteEntry.chunks?.length || 1;

    // Resolve the target path FIRST — both strategies below write straight
    // to a temp file next to it, then rename into place.
    const baseDir = StorageService.getBaseDir();
    const localEntry = localManifest.files[fileId];
    let targetPath: string;

    if (localEntry?.localPath) {
      // Known local path — write back to same location
      targetPath = path.join(baseDir, localEntry.localPath);
    } else if (remoteEntry.localPath) {
      // Path from remote manifest (encrypted, so safe)
      targetPath = path.join(baseDir, remoteEntry.localPath);
    } else if (fileId.startsWith('meta:')) {
      // Metadata file — derive path from key. `meta:notes` n'arrive jamais ici :
      // il est détourné plus haut vers la fusion.
      targetPath = path.join(baseDir, fileId.slice(5), 'metadata.json');
    } else {
      // Unknown file — can't determine path, skip
      log.warn(`[syncService] No localPath for downloaded file: ${fileId}, skipping write`);
      return;
    }

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(targetPath), { recursive: true });

    // ── Block-level DELTA download ──────────────────────────────────────────
    // The remote entry flags a content-addressed delta file: fetch its manifest
    // + changed blocks, GCM-verify, and reassemble straight into a fresh V3-FEK
    // blob (no plaintext temp file). A missing block surfaces corruption; if a
    // legacy full object still exists we fall back, else the error is surfaced.
    if (remoteEntry.delta && (await r2.getDeltaSyncCapability())) {
      const deltaTmp = targetPath + SYNC_DL_TMP_SUFFIX;
      try {
        const res = await deltaSync.downloadDelta({
          profileId,
          fileId,
          destPath: targetPath,
          tmpPath: deltaTmp,
          transport: deltaTransport,
          crypto: getDeltaCrypto(),
        });
        const stat = await fs.stat(targetPath);
        const encChecksum = await streamingSha256(targetPath);
        const localPath = localEntry?.localPath || remoteEntry.localPath || undefined;
        localManifest.files[fileId] = {
          localPath,
          checksum: encChecksum,
          size: stat.size,
          updatedAt: remoteEntry.updatedAt,
          syncedAt: new Date().toISOString(),
          chunks: [],
          status: 'synced',
          plaintextChecksum: res.plaintextChecksum,
          delta: { version: res.version, blockCount: res.blockCount },
          lastDirection: 'down',
        };
        log.info(
          `[syncService] Delta downloaded ${fileId} (${res.blockCount} block(s), ${stat.size} B on disk)`
        );
        return;
      } catch (err) {
        await fs.unlink(deltaTmp).catch(() => {});
        if (err instanceof deltaSync.DeltaUnavailableError) {
          log.info(`[syncService] Delta download unavailable for ${fileId}, using standard path`);
          // fall through to the legacy path
        } else if (err instanceof deltaSync.DeltaBlockMissingError) {
          // Recover only if a legacy full object (chunk_N) still exists remotely.
          const hasLegacy =
            (remoteEntry.chunks?.length ?? 0) > 0 &&
            remoteEntry.chunks.some((k) => !k.includes('/blocks/'));
          if (!hasLegacy) throw err; // unrecoverable — surface French corruption
          log.warn(
            `[syncService] Delta blocks missing for ${fileId}, attempting legacy full download`
          );
          // fall through to the legacy path
        } else {
          throw err;
        }
      }
    }

    const { tmpPath, checksum, byteLength } = await fetchRemoteBlobToTemp(
      profileId,
      fileId,
      remoteEntry,
      targetPath,
      localEntry?.localPath || remoteEntry.localPath || undefined
    );

    // Atomic install
    await fs.rename(tmpPath, targetPath);

    // Verify file was written
    try {
      const stat = await fs.stat(targetPath);
      log.info(`[syncService] File written to disk: ${targetPath}, size: ${stat.size}`);
    } catch {
      log.error(`[syncService] File NOT on disk after write: ${targetPath}`);
      throw new Error(`Write verification failed for ${targetPath}`);
    }

    // Update local manifest — preserve localPath from remote if available
    const localPath = localEntry?.localPath || remoteEntry.localPath || undefined;

    localManifest.files[fileId] = {
      localPath,
      checksum,
      size: byteLength,
      updatedAt: remoteEntry.updatedAt,
      syncedAt: new Date().toISOString(),
      chunks: remoteEntry.chunks?.length ? remoteEntry.chunks : [`chunk_0`],
      status: 'synced',
      lastDirection: 'down',
    };

    // In-memory update only — disk save at end of triggerSync

    log.info(`[syncService] Downloaded ${fileId} (${chunkCount} chunk(s), ${byteLength} bytes)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Download failed';
    log.error(`[syncService] Download failed for ${fileId}:`, message);

    await queue.enqueue({
      type: 'download',
      resourceType: 'file',
      resourceId: fileId,
      profileId,
      priority: 'high',
    });

    // Rethrow so processQueue's catch-block calls markFailed instead of
    // markSuccess. processDownloads wraps in Promise.allSettled.
    throw err;
  }
}

// ── Conflict Handling ───────────────────────────────────────────────────────

async function handleConflict(
  profileId: string,
  fileId: string,
  localManifest: SyncManifest,
  remoteManifest: SyncManifest
): Promise<void> {
  // Fork strategy: create a copy with _conflict_{timestamp} suffix
  try {
    const baseDir = StorageService.getBaseDir();
    // Le manifeste connaît le chemin exact (`folderId/nomDeFichier`, ou
    // `notes.enc`) : s'en servir D'ABORD. findFileOnDisk ne sait chercher qu'un
    // `{fileId}.bin` ou un dossier homonyme, or les ids sont des empreintes
    // depuis scanLocalFiles — il ne trouvait donc plus rien, et un conflit
    // finissait systématiquement dans la branche « pas de fichier local ».
    const declaredPath = localManifest.files[fileId]?.localPath;
    let filePath: string | null = null;
    if (declaredPath) {
      const candidate = path.join(baseDir, declaredPath);
      try {
        await fs.access(candidate);
        filePath = candidate;
      } catch {
        filePath = null;
      }
    }
    if (!filePath) filePath = await findFileOnDisk(baseDir, fileId);

    if (filePath) {
      const timestamp = Date.now();
      const conflictId = nomDeCopieDeConflit(fileId, timestamp);
      const conflictDir = path.join(baseDir, conflictId);
      await fs.mkdir(conflictDir, { recursive: true });

      /*
        `copyFile` ET PAS `readFile` PUIS `writeFile`.

        L ancienne paire chargeait le fichier ENTIER en memoire avant de
        le reecrire. Sur le conflit observe le 2026-09-07, ca voulait dire
        1,28 Go dans le tas du processus principal — celui qui tient
        l interface — a chaque copie, et six fois de suite pendant la
        boucle. `copyFile` laisse le systeme de fichiers faire le travail :
        memoire plate, et sur NTFS la copie est deleguee au noyau.
      */
      await fs.copyFile(filePath, path.join(conflictDir, `${conflictId}.bin`));

      // Mark conflict in manifest — sur le DISQUE (markConflict relit, mute,
      // sauve) ET dans l'objet EN MÉMOIRE, qui est la source de vérité du cycle :
      // c'est lui que l'étape 9 publie et que l'étape 10 réécrit par-dessus le
      // disque. Sans cette propagation, le statut `conflict` était effacé
      // aussitôt posé et l'entrée repartait comme si de rien n'était.
      await manifest.markConflict(profileId, fileId);
      const inMemory = localManifest.files[fileId];
      if (inMemory) inMemory.status = 'conflict';

      // Notify renderer
      notifyRenderer('sync-conflict-detected', {
        profileId,
        fileId,
        conflictCopyId: conflictId,
      });

      log.warn(`[syncService] Conflict detected for ${fileId}, copy created: ${conflictId}`);
    } else {
      // File doesn't exist locally — not a real conflict, just download remote.
      // Le faire MAINTENANT : rien à protéger, et laisser l'entrée en
      // `pending_download` ne déclenchait aucun téléchargement (les descentes
      // viennent du résultat de fusion, pas du statut) — le fichier ne
      // redescendait donc jamais.
      if (localManifest.files[fileId]) {
        localManifest.files[fileId].status = 'pending_download';
      }
      log.info(`[syncService] Conflict for ${fileId} but no local file — downloading remote`);
      await downloadFile(profileId, fileId, remoteManifest, localManifest);
    }
  } catch (err) {
    log.error(`[syncService] Conflict handling failed for ${fileId}:`, err);
    await manifest.markConflict(profileId, fileId);
    const inMemory = localManifest.files[fileId];
    if (inMemory) inMemory.status = 'conflict';
  }
}

// ── Conflict Resolution ─────────────────────────────────────────────────────

export async function resolveConflict(
  profileId: string,
  fileId: string,
  keep: 'local' | 'remote'
): Promise<void> {
  if (keep === 'remote') {
    // Download remote version, overwrite local
    const { manifest: remoteEnc, version } = await r2.getManifest(profileId);
    if (remoteEnc) {
      const decrypted = await StorageService.decryptManifestAuto(remoteEnc);
      const remoteManifest = JSON.parse(decrypted.toString('utf-8')) as SyncManifest;
      const localManifest = (await manifest.load(profileId)) || manifest.createEmpty(profileId);
      await downloadFile(profileId, fileId, remoteManifest, localManifest);
    }
  }

  // In both cases, mark as synced (local version is now the truth)
  const m = await manifest.load(profileId);
  if (m?.files[fileId]) {
    m.files[fileId].status = 'synced';
    m.files[fileId].syncedAt = new Date().toISOString();
    // Sens de l'arbitrage : `remote` a fait descendre le fichier, `local` a
    // désigné notre copie comme vérité (c'est elle qui remontera). Réécrit ici
    // parce que ce `load` relit le disque et perd ce que downloadFile venait
    // d'inscrire dans son manifeste en mémoire.
    m.files[fileId].lastDirection = keep === 'remote' ? 'down' : 'up';
    await manifest.save(profileId, m);
  }

  log.info(`[syncService] Conflict resolved for ${fileId}: kept ${keep}`);
}

export async function getConflicts(profileId: string): Promise<string[]> {
  return manifest.getConflicts(profileId);
}

// ── Queue Processing ────────────────────────────────────────────────────────

async function processQueue(profileId: string): Promise<void> {
  const items = await queue.dequeue(MAX_PARALLEL_UPLOADS);
  if (items.length === 0) return;

  const profileItems = items.filter((i) => i.profileId === profileId);

  for (const item of profileItems) {
    try {
      if (item.type === 'upload') {
        const localManifest = (await manifest.load(profileId)) || manifest.createEmpty(profileId);
        await uploadFile(profileId, item.resourceId, localManifest);
        await queue.markSuccess(item.id);
      } else if (item.type === 'download') {
        const { manifest: remoteEnc } = await r2.getManifest(profileId);
        if (remoteEnc) {
          const decrypted = await StorageService.decryptManifestAuto(remoteEnc);
          const remoteManifest = JSON.parse(decrypted.toString('utf-8')) as SyncManifest;
          const localManifest = (await manifest.load(profileId)) || manifest.createEmpty(profileId);
          await downloadFile(profileId, item.resourceId, remoteManifest, localManifest);
          await queue.markSuccess(item.id);
        }
      } else if (item.type === 'delete') {
        await r2.deleteFile(profileId, item.resourceId);
        await queue.markSuccess(item.id);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Queue item failed';
      await queue.markFailed(item.id, message);
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Attend `p` au plus `ms`, puis rend `fallback`.
 *
 * La promesse n'est PAS annulée — rien ici ne l'est — elle continue dans le
 * vide. Sans conséquence pour les appelants : un cycle de sync est idempotent,
 * et le seul usage aujourd'hui est la fermeture, où le processus s'arrête juste
 * après. Un rejet vaut échéance : l'appelant obtient `fallback`, jamais une
 * exception.
 */
function withDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, ms);
    const finish = (value: T): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    p.then(
      (v) => finish(v),
      () => finish(fallback)
    );
  });
}

function stopDaemon(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (probeTimer) {
    clearInterval(probeTimer);
    probeTimer = null;
  }
  // L observateur suit la vie du demon, pour la meme raison que le canal : le
  // laisser tourner ferait marquer sale un profil qui n est plus l actif.
  if (vaultWatcher) {
    const w = vaultWatcher;
    vaultWatcher = null;
    w.stop().catch(() => undefined);
  }
  resetScanStamps();
  // Le canal suit exactement la vie du demon : le laisser ouvert apres un arret
  // ferait tirer un profil qui n'est plus l'actif.
  channel.stop();
}

function updateState(state: SyncStatus['state']): void {
  currentState = state;
  // Fire handlers async — don't block on getSyncStatus()
  getSyncStatus().then((status) => {
    for (const handler of statusHandlers) {
      try {
        handler(status);
      } catch {
        // Ignore handler errors
      }
    }
  }).catch(() => {});
}

function notifyRenderer(channel: string, data: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

/**
 * Find a file on disk by its ID.
 * Scans the profile directory for a folder matching the fileId
 * or a file named {fileId}.bin within any folder.
 */
/**
 * Scan the profile directory for files not yet tracked in the manifest.
 * Adds them as pending_upload so the next merge detects them.
 */
/**
 * TAMPON D IDENTITE DU BALAYAGE — lot 2 du chantier synchronisation.
 *
 * `scanLocalFiles` relisait INTEGRALEMENT `notes.enc`, `layout.enc` et les deux
 * fichiers de rappels a chaque cycle, soit 288 fois par jour. Sur un blob de
 * 50 Mo, c est 14 Go de lecture disque quotidienne pour repondre a une question
 * qu une seule syscall tranche.
 *
 * Le registre est un CACHE, jamais une autorite : `stampedChecksum` ne saute le
 * hachage que s il a DEJA une empreinte connue pour ce fichier (celle du
 * manifeste). Sans empreinte connue, il hache, quoi que dise le tampon. Un
 * cache qui ne peut pas repondre laisse donc toujours passer au calcul.
 *
 * Le filet reste entier : rehachage force tous les sept jours, tampon date du
 * futur rejete, et `markScanDirty` (branche sur l observateur du coffre) force
 * le calcul quel que soit le tampon.
 */
const scanStamps = new StampRegistry();

/**
 * Identifiant opaque d un fichier du coffre, a partir de son chemin relatif.
 *
 * UNE SEULE derivation, partagee par le balayage et par l observateur. Elle
 * existait en un seul exemplaire, en ligne dans `scanLocalFiles` ; l observateur
 * a d abord marque sale sous `dossier/fichier`, une cle que le balayage ne
 * consulte JAMAIS. Le marquage etait donc inerte pour les fichiers ordinaires —
 * c est-a-dire precisement la ou le trou de correction se trouvait.
 */
/**
 * Ce balayage doit-il PRESERVER l entree au lieu de la remplacer ?
 *
 * Sortie en fonction — et exportee — pour qu une garde exerce LA regle et non
 * un jumeau : un test qui recopierait la condition resterait vert pendant
 * qu on la retire ici. C est la lecon de `ensureFolderId` (meme journee).
 *
 * LA REGLE : un conflit dont les octets sur le disque n ont pas bouge depuis la
 * copie de conflit reste un conflit. Sans elle, le balayage remet l entree en
 * `pending_upload`, la garde anti-boucle du fusionneur ne s arme jamais, et
 * chaque cycle refait une copie `_conflict_<horodatage>`.
 *
 * Si le checksum a CHANGE, l utilisateur a reedite le fichier depuis : c est
 * une vraie nouvelle version locale, qui doit repartir et refaire l arbitrage
 * sur du contenu a jour.
 */
export function keepsOpenConflict(
  existing: { status?: string; checksum?: string } | undefined,
  diskChecksum: string
): boolean {
  return existing?.status === 'conflict' && existing.checksum === diskChecksum;
}

export function scanFileIdOf(localPath: string): string {
  return crypto.createHash('sha256').update(localPath).digest('hex').slice(0, 32);
}

/** Force le rehachage d une entree — appele par l observateur du coffre. */
export function markScanDirty(key: string): void {
  scanStamps.markDirty(key);
}

/** Cette entree a-t-elle ete signalee par l observateur ? */
export function isScanDirty(key: string): boolean {
  return scanStamps.isDirty(key);
}

/** Oublie tous les tampons. Un changement de profil ne laisse rien derriere lui. */
export function resetScanStamps(): void {
  scanStamps.clear();
}

/**
 * Empreinte d un blob de la racine, en evitant le hachage quand c est sur.
 *
 * `known` est l empreinte que le manifeste porte deja. Quand elle manque, on
 * hache : c est le cas du premier balayage, et c est ce qui rend le cache
 * incapable d inventer une reponse.
 */
async function stampedChecksum(
  key: string,
  filePath: string,
  stat: StatLike,
  known: string | undefined
): Promise<string> {
  const now = Date.now();
  if (known && !scanStamps.shouldHash(key, stat, now)) {
    metrics.hashSkipped();
    return known;
  }
  const checksum = await streamingSha256(filePath);
  // On compte les octets REELLEMENT relus : c est ce chiffre qui rend visible
  // le cout du constat n 2 (14 Go par jour pour rehacher un blob de 50 Mo).
  metrics.hashComputed(stat.size);
  scanStamps.record(key, stat, now);
  return checksum;
}

/**
 * LES ENTRÉES DE COPIES DE CONFLIT DÉJÀ PUBLIÉES — à retirer du nuage.
 *
 * PUR : on lui donne le manifeste, il rend les identifiants à marquer
 * `deleted`. Aucun disque, aucun réseau.
 *
 * ── LE TROU QUE ÇA FERME, ET C'ÉTAIT LE MIEN ────────────────────────────────
 *
 * Le 2026-09-07 au matin, le balayage a cessé de prendre les répertoires
 * `<fileId>_conflict_<horodatage>` pour des dossiers du coffre. J'avais écrit
 * que les entrées DÉJÀ publiées « se périmeraient simplement ». C'était faux.
 *
 * Elles restent `synced` dans le manifeste local. Le fusionneur les voit
 * `local: synced / remote: NONE` — parce que la publication du manifeste, elle,
 * échoue — et les reprogramme en TÉLÉVERSEMENT à chaque cycle. Sur le profil
 * observé le soir même : 28 fichiers renvoyés à chaque tour, dont TROIS copies
 * d'un fichier de 1,28 Go re-découpées en blocs à chaque fois.
 *
 * Le cycle durait alors une minute, pendant laquelle l'autre appareil publiait
 * deux fois. Le compare-and-set du manifeste était donc refusé — « Manifest
 * conflict during upload, will retry next cycle » — et le cycle suivant, aussi
 * long, reperdait. Interblocage vivant : les deux postes travaillaient sans
 * fin, aucun ne convergeait, et la version distante montait sans nous.
 *
 * ── POURQUOI `deleted` ET PAS UN RETRAIT LOCAL ──────────────────────────────
 *
 * Retirer l'entrée localement la ferait REDESCENDRE au tour suivant pour toutes
 * celles que le nuage porte déjà — et le répertoire se recréerait sur le disque.
 * `deleted` purge l'objet R2 ET l'entrée, des deux côtés, une fois pour toutes.
 *
 * ── CE QUI N'EST PAS SUPPRIMÉ, ET C'EST L'ESSENTIEL ─────────────────────────
 *
 * LE FICHIER SUR LE DISQUE RESTE. L'étape de suppression du cycle efface
 * l'objet distant puis retire l'entrée ; elle ne touche jamais au disque. La
 * copie de conflit demeure donc là où son propriétaire peut l'arbitrer — sur la
 * machine où la divergence a eu lieu, qui est le seul endroit où ça a un sens.
 *
 * Sur les AUTRES appareils, le fusionneur saute simplement une entrée distante
 * `deleted` : leur copie locale n'est pas effacée non plus.
 */
export function conflictCopyEntriesToPurge(
  files: Readonly<Record<string, { localPath?: string; status?: string }>>
): string[] {
  const aPurger: string[] = [];
  for (const [fileId, entry] of Object.entries(files)) {
    // Déjà en cours de suppression : ne pas la reprogrammer.
    if (entry.status === 'deleted') continue;

    /*
      DEUX FORMES, ET IL FAUT LES DEUX.

      · `meta:<répertoire>` — les métadonnées que `getFolder` avait inventées en
        prenant le répertoire pour un dossier ;
      · une entrée dont le CHEMIN LOCAL est sous ce répertoire — la copie
        elle-même (`<conflictId>/<conflictId>.bin`).

      N'en traiter qu'une laisserait l'autre boucler.
    */
    if (fileId.startsWith('meta:') && estCopieDeConflit(fileId.slice('meta:'.length))) {
      aPurger.push(fileId);
      continue;
    }
    const premierSegment = entry.localPath?.split('/')[0];
    if (premierSegment && estCopieDeConflit(premierSegment)) {
      aPurger.push(fileId);
    }
  }
  return aPurger;
}

/**
 * LES CONFLITS SANS COPIE — ceux que personne ne peut arbitrer.
 *
 * PUR : le manifeste et la liste des répertoires présents, rien d'autre.
 *
 * ── CE QUI LES FABRIQUE ─────────────────────────────────────────────────────
 *
 * `handleConflict` copie le fichier divergent dans un répertoire, PUIS marque
 * l'entrée `conflict`. Quand la copie échoue, son `catch` marque quand même —
 * et c'est là que tout se bloque : le statut `conflict` existe pour dire « un
 * humain doit choisir entre deux versions », or il n'y en a plus qu'une.
 *
 * Le cas s'est produit en masse : un identifiant `meta:<...>` porte un
 * deux-points, que Windows lit comme le séparateur d'un flux de données
 * alternatif — `mkdir` échouait en ENOENT (corrigé depuis, voir
 * `nomDeCopieDeConflit`). Sur le profil observé le 2026-09-07 au soir : 24
 * entrées en conflit, 29 répertoires de copie sur le disque, et AUCUN pour une
 * entrée `meta:`. Vingt conflits fantômes.
 *
 * ── CE QUE ÇA COÛTE, ET CE N'EST PAS LA PASTILLE ────────────────────────────
 *
 * Le fusionneur SAUTE les entrées `conflict` — c'est la garde anti-boucle. Ces
 * vingt métadonnées de dossier ne se synchronisaient donc plus du tout : un
 * renommage, une couleur, un rangement faits sur un poste ne partaient plus.
 * Gelées, sans rien à arbitrer, et sans qu'aucun écran ne puisse les libérer.
 *
 * ── POURQUOI RENDRE `synced` ET PAS AUTRE CHOSE ─────────────────────────────
 *
 * On ne prétend rien : on rend l'entrée au fusionneur et on le laisse
 * re-décider avec les empreintes qu'il a.
 *
 *   · contenus identiques → il ne se passe rien, et c'est la vérité ;
 *   · contenus divergents → il refabrique un conflit, et CETTE FOIS la copie
 *     réussit (le nom est assaini). L'utilisateur obtient enfin les deux
 *     versions qu'on lui devait.
 *
 * `pending_upload` forcerait notre version sur le nuage sans rien comparer ;
 * un retrait de l'entrée la ferait redescendre. Le seul statut honnête est
 * celui qui ne décide pas.
 *
 * ── LA BORNE À NE PAS FRANCHIR ──────────────────────────────────────────────
 *
 * On ne libère QUE les entrées dont aucune copie n'existe. Une copie présente
 * veut dire que l'utilisateur a deux versions sous les yeux : la libérer
 * choisirait à sa place, silencieusement.
 */
export function conflictsSansCopie(
  files: Readonly<Record<string, { status?: string }>>,
  repertoiresPresents: readonly string[]
): string[] {
  const enConflit = Object.entries(files).filter(([, e]) => e.status === 'conflict');
  if (enConflit.length === 0) return [];

  // Une copie s'appelle `<nom assaini>_conflict_<horodatage>`. On compare donc
  // sur le PRÉFIXE assaini, pas sur l'identifiant brut — sans quoi `meta:X` ne
  // reconnaîtrait jamais sa propre copie `meta-X_conflict_...`.
  const copies = repertoiresPresents.filter((n) => estCopieDeConflit(n));
  const aLibererer: string[] = [];
  for (const [fileId] of enConflit) {
    const prefixe = `${nomDeCopieDeConflit(fileId, 0).replace(/_conflict_0$/, '')}_conflict_`;
    if (!copies.some((n) => n.startsWith(prefixe))) aLibererer.push(fileId);
  }
  return aLibererer;
}

async function scanLocalFiles(
  profileId: string,
  localManifest: SyncManifest
): Promise<void> {
  const baseDir = StorageService.getBaseDir();

  /*
    LES COPIES DE CONFLIT DEJA PUBLIEES SORTENT DU NUAGE.

    Le balayage cesse plus bas de les prendre pour des dossiers, mais les
    entrees qu'il avait deja creees restent `synced` — et le fusionneur les
    reprogramme en televersement a chaque cycle tant que le nuage ne les
    porte pas. C'est ce qui a fait boucler un profil le 2026-09-07 au soir :
    28 fichiers renvoyes par tour, dont trois copies de 1,28 Go redecoupees
    a chaque fois, un cycle d'une minute, et un compare-and-set de manifeste
    perdu a tous les coups.

    `deleted` et non un retrait local : voir `conflictCopyEntriesToPurge`.
    LE FICHIER SUR LE DISQUE N'EST PAS TOUCHE.
  */
  for (const fileId of conflictCopyEntriesToPurge(localManifest.files)) {
    const e = localManifest.files[fileId];
    if (e) e.status = 'deleted';
    await manifest.markDeleted(profileId, fileId);
    log.info(`[syncService] copie de conflit retiree du nuage : ${fileId}`);
  }

  // Migration: remove legacy non-hashed keys (folderId/fileName format)
  const legacyKeys = Object.keys(localManifest.files).filter(
    (k) => k.includes('/') && !k.startsWith('meta:')
  );
  if (legacyKeys.length > 0) {
    for (const key of legacyKeys) {
      delete localManifest.files[key];
    }
    log.info(`[syncService] Cleaned ${legacyKeys.length} legacy manifest keys`);
  }

  try {
    // Scan notes.enc (single file at profile root)
    const notesPath = path.join(baseDir, NOTES_BLOB_FILENAME);
    try {
      const notesStat = await fs.stat(notesPath);
      if (notesStat.isFile()) {
        const metaKey = NOTES_META_FILE_ID;
        const existing = localManifest.files[metaKey];
        const checksum = await stampedChecksum(metaKey, notesPath, notesStat, existing?.checksum);
        if (!existing || existing.checksum !== checksum) {
          /*
            QUI VIENT D'ÉCRIRE CE FICHIER ? Si ce profil est en v2, son index
            garde l'identité (taille:mtime) du blob v1 tel qu'il l'a réécrit
            lui-même (`legacyStamp`, posé dans la même écriture). Un blob qui
            porte cette identité est le pont vers les appareils v1, pas une
            écriture v1 : on le dit au manifeste, sinon chaque autre appareil
            encore en v1 lirait « quelqu'un tape encore » et ne migrerait
            jamais. Un profil v1 n'a pas d'index : jamais de drapeau.
          */
          let legacyWriteBack = false;
          try {
            const rawIndex = await createVaultIO(baseDir).read(`${NOTES_DIR}/${NOTES_INDEX_FILENAME}`);
            if (rawIndex !== null && isNotesIndexShape(rawIndex)) {
              const stamp = `${notesStat.size}:${notesStat.mtimeMs}`;
              legacyWriteBack = normalizeIndex(rawIndex).legacyStamp === stamp;
            }
          } catch {
            /* index illisible : on ne conclut rien, le blob passe pour une écriture v1 */
          }
          localManifest.files[metaKey] = {
            localPath: NOTES_BLOB_FILENAME,
            checksum,
            size: notesStat.size,
            updatedAt: notesStat.mtime.toISOString(),
            syncedAt: existing?.syncedAt || null,
            chunks: existing?.chunks || [],
            status: 'pending_upload',
            legacyWriteBack,
          };
        }
      }
    } catch { /* notes.enc doesn't exist yet */ }

    // Scan layout.enc (single file at profile root, sibling of notes.enc).
    //
    // CE BLOC EST OBLIGATOIRE, ET SON ABSENCE EST UN PIÈGE SILENCIEUX.
    // `notifyMetadataChanged` crée l'entrée `meta:layout` SANS `localPath`
    // (elle n'en connaît pas). Au moment de la remontée, `uploadFile` cherche
    // alors le fichier avec `findFileOnDisk`, qui ne sait explorer que les
    // dossiers de coffre — il ne trouve rien, et l'entrée part à la trappe
    // (retirée, ou pire : marquée `deleted` et propagée). C'est ici, et
    // seulement ici, que `localPath: 'layout.enc'` est posé.
    const layoutPath = path.join(baseDir, LAYOUT_BLOB_FILENAME);
    try {
      const layoutStat = await fs.stat(layoutPath);
      if (layoutStat.isFile()) {
        const existing = localManifest.files[LAYOUT_META_FILE_ID];
        const checksum = await stampedChecksum(LAYOUT_META_FILE_ID, layoutPath, layoutStat, existing?.checksum);
        if (!existing || existing.checksum !== checksum || !existing.localPath) {
          localManifest.files[LAYOUT_META_FILE_ID] = {
            localPath: LAYOUT_BLOB_FILENAME,
            checksum,
            size: layoutStat.size,
            updatedAt: layoutStat.mtime.toISOString(),
            syncedAt: existing?.syncedAt || null,
            chunks: existing?.chunks || [],
            status: 'pending_upload',
          };
        }
      }
    } catch { /* layout.enc doesn't exist yet */ }

    /**
     * Les DEUX fichiers de rappels racine (`noteReminders.json`,
     * `calendarReminders.json`).
     *
     * MEME PIEGE QUE `layout.enc`, ET IL EST SILENCIEUX.
     * `notifyMetadataChanged` cree l'entree SANS `localPath` (elle n'en connait
     * pas). Au moment de la remontee, `uploadFile` cherche alors le fichier
     * avec `findFileOnDisk`, qui ne sait explorer que les dossiers de coffre :
     * il ne trouve rien, et l'entree part a la trappe. C'est ici, et seulement
     * ici, que le chemin est pose.
     */
    for (const meta of REMINDER_META_FILES) {
      const remindersPath = path.join(baseDir, meta.filename);
      try {
        const stat = await fs.stat(remindersPath);
        if (!stat.isFile()) continue;
        const existing = localManifest.files[meta.fileId];
        const checksum = await stampedChecksum(meta.fileId, remindersPath, stat, existing?.checksum);
        if (!existing || existing.checksum !== checksum || !existing.localPath) {
          localManifest.files[meta.fileId] = {
            localPath: meta.filename,
            checksum,
            size: stat.size,
            updatedAt: stat.mtime.toISOString(),
            syncedAt: existing?.syncedAt || null,
            chunks: existing?.chunks || [],
            status: 'pending_upload',
          };
        }
      } catch { /* ce fichier de rappels n'existe pas encore */ }
    }

    const entries = await fs.readdir(baseDir, { withFileTypes: true });

    /*
      LES CONFLITS FANTOMES SONT LIBERES — voir `conflictsSansCopie`.

      Une entree `conflict` dont la copie n'existe pas n'est pas arbitrable :
      il n'y a plus qu'une version. Et comme le fusionneur SAUTE les entrees
      en conflit, elle ne se synchronise plus du tout — vingt metadonnees de
      dossier gelees le 2026-09-07, sans rien a arbitrer et sans qu'aucun
      ecran puisse les liberer.

      On les rend au fusionneur en `synced` : il re-decide avec les
      empreintes. Identiques, il ne se passe rien ; divergentes, il refait un
      conflit — et cette fois la copie reussit, le nom etant assaini.
    */
    const repertoires = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    for (const fileId of conflictsSansCopie(localManifest.files, repertoires)) {
      const e = localManifest.files[fileId];
      // L'objet EN MEMOIRE suffit : c'est lui que l'etape 10 ecrit sur le
      // disque a la fin du cycle. Une ecriture de plus ici ferait deux
      // sources pour un meme fait.
      if (e) e.status = 'synced';
      log.warn(`[syncService] conflit sans copie libere : ${fileId}`);
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Skip non-UUID folders and special files
      if (entry.name.startsWith('.') || entry.name === 'sync-manifest.json') continue;
      /**
       * LE MAGASIN v2 N'EST PAS UN DOSSIER. `notes/` (NOTES_DIR) porte l'index,
       * un objet par note et un `metadata.json` marqueur. Pris pour un dossier
       * utilisateur nommé « notes », son entrée de métadonnées s'appelait
       * `meta:notes` — EXACTEMENT l'identifiant du fichier de notes v1 : le
       * balayage écrasait l'entrée du vrai `notes.enc` par un marqueur de 229
       * octets, qui montait dans le nuage à la place des notes ; l'appareil
       * resté en v1 le trouvait illisible, gardait les siennes, les
       * repoussait, et l'on tournait. Ses objets, eux, partaient une seconde
       * fois comme des fichiers ordinaires (« 33 en attente »). Les
       * répertoires de versions ne sont pas des dossiers non plus.
       */
      if (
        entry.name === NOTES_DIR ||
        entry.name === DIR_VERSIONS_NOTES ||
        entry.name === DIR_VERSIONS_FICHIERS
      ) {
        continue;
      }

      /*
        UNE COPIE DE CONFLIT NE SE SYNCHRONISE PAS, ET C EST UNE DECISION.

        `handleConflict` fabrique un REPERTOIRE `<fileId>_conflict_<ts>`
        a la racine du profil. Le balayage le prenait pour un dossier du
        coffre : ses metadonnees ET son contenu partaient dans le nuage,
        puis se propageaient sur les autres postes.

        CE QUE CA A COUTE, mesure le 2026-09-07. Le fichier en conflit
        faisait 1,28 Go. Chaque copie recoit un `fileId` NEUF — il derive
        du CHEMIN — donc aucune ne profite des blocs de l originale :
        2,7 Go televerses pour un seul fichier, sur quatre identifiants.

        Une copie de conflit est un artefact d ARBITRAGE : elle existe
        pour que son proprietaire tranche, sur la machine ou la
        divergence a ete constatee. La diffuser ne rend service a
        personne — l autre poste recoit un doublon qu il ne peut pas
        arbitrer, et paie le stockage.

        LES ENTREES DEJA PUBLIEES NE SONT PAS TOUCHEES. Les sauter ici
        les laisse simplement se perimer dans le manifeste ; rien ne les
        marque `deleted`, donc aucune suppression ne part vers les autres
        appareils. Effacer la donnee d un conflit non arbitre serait le
        seul geste vraiment irreparable de cette histoire.
      */
      if (estCopieDeConflit(entry.name)) continue;

      const folderId = entry.name;

      // Scan metadata.json for each folder
      const metadataPath = path.join(baseDir, folderId, 'metadata.json');
      try {
        const metaStat = await fs.stat(metadataPath);
        if (metaStat.isFile()) {
          const metaKey = `meta:${folderId}`;
          const existing = localManifest.files[metaKey];
          // Le TAMPON, comme pour les blobs de la racine : 47 dossiers
          // rehachés à chaque cycle pour une réponse qu'un `stat` donne.
          const checksum = await stampedChecksum(
            metaKey,
            metadataPath,
            metaStat,
            existing?.checksum
          );
          if (!existing || existing.checksum !== checksum) {
            localManifest.files[metaKey] = {
              localPath: `${folderId}/metadata.json`,
              checksum,
              size: metaStat.size,
              updatedAt: metaStat.mtime.toISOString(),
              syncedAt: existing?.syncedAt || null,
              chunks: existing?.chunks || [],
              status: 'pending_upload',
            };
          }
        }
      } catch { /* no metadata.json */ }
      const folderPath = path.join(baseDir, folderId);

      // Scan files inside each folder
      let files: string[];
      try {
        files = await fs.readdir(folderPath);
      } catch {
        continue;
      }

      for (const fileName of files) {
        if (fileName === 'metadata.json') continue;
        // In-flight temporaries must never enter the manifest: V3 staging
        // files (atomic-rename encrypt path) and ranged-download partials.
        if (fileName.includes(V3_STAGING_MARKER)) continue;
        if (fileName.includes(MIGRATION_STAGING_MARKER)) continue;
        if (fileName.endsWith(SYNC_DL_TMP_SUFFIX)) continue;

        // Derive an opaque fileId from the local path — never expose real file names
        const localPath = `${folderId}/${fileName}`;
        const fileId = scanFileIdOf(localPath);

        /*
          LE TROU DE CORRECTION, ET SA FERMETURE.

          Ce raccourci saute un fichier deja synchronise sans meme le `stat`er.
          Le balayage ne decouvrait donc que les fichiers NOUVEAUX, et toute la
          detection de modification reposait sur `notifyFileChanged`, appele par
          l application au moment ou elle ecrit. Ce qui contourne ce chemin
          etait INVISIBLE : modification hors application, plantage entre
          l ecriture et la notification, restauration de sauvegarde, autre outil
          qui touche au coffre. La donnee restait sur le disque et ne partait
          JAMAIS, pendant que l interface affichait « synchronise ».

          `isScanDirty` est la porte que l observateur ouvre. Elle ne peut que
          FORCER l examen, jamais l empecher : si l observateur rate un
          evenement ou ne demarre pas, on retombe exactement sur le comportement
          d avant.
        */
        const existing = localManifest.files[fileId];
        if (existing && existing.checksum && existing.status === 'synced' && !isScanDirty(fileId)) {
          continue;
        }

        const filePath = path.join(folderPath, fileName);
        try {
          const stat = await fs.stat(filePath);
          if (!stat.isFile()) continue;

          // Size gates (see constants above). local_only entries are kept
          // IN the manifest so the batch status endpoint reports them.
          if (stat.size > MAX_PORTABLE_SYNC_FILE_SIZE) {
            markEntryLocalOnly(localManifest, fileId, localPath, stat.size, stat.mtime.toISOString());
            skipOversizedFile(fileId, localPath, stat.size, 'too-large');
            continue;
          }
          if (stat.size > MAX_SYNC_FILE_SIZE) {
            // Keep a settled local_only decision without re-probing every scan —
            // UNLESS a one-time auto-migration to a portable FEK blob is still
            // worth attempting (cloud/hybrid session, not yet tried). This is
            // what rescues a file already pinned local_only (e.g. the user's
            // 1.28 GB machine-key import) once the vault is unlocked.
            const settledLocalOnly =
              existing?.status === 'local_only' && existing.size === stat.size;
            if (settledLocalOnly && portableMigrationAttempted.has(fileId)) {
              continue;
            }
            const portable = await ensureOversizedPortable(fileId, filePath);
            if (!portable) {
              markEntryLocalOnly(localManifest, fileId, localPath, stat.size, stat.mtime.toISOString());
              skipOversizedFile(fileId, localPath, stat.size, 'not-portable');
              continue;
            }
          }

          /*
            LE TAMPON D IDENTITE VAUT ICI AUSSI — ET C EST ICI QUE SONT LES
            GIGAOCTETS.

            `scanStamp` a ete ecrit pour ne pas rehacher un fichier qui n a
            pas bouge, et il n etait consulte que pour QUATRE blobs de la
            racine. Cette boucle-ci, qui porte tout le contenu du coffre,
            appelait `streamingSha256` sans condition.

            Le raccourci au-dessus ne sauve que les entrees `synced`. Une
            entree bloquee en `pending_upload` — remontee en echec, jeton
            expire, conflit ouvert — etait donc RELUE ET REHACHEE
            INTEGRALEMENT a chaque cycle, toutes les cinq minutes, pour
            toujours.

            Mesure dans les journaux du 2026-09-07 : 177 secondes de
            silence avant « Scan found 75 files pending upload », avec
            quatre copies d un fichier de 1,28 Go parmi elles. Pendant ces
            trois minutes le processus principal lit et hache sans
            desemparer — c est lui qui sert l interface, d ou
            l effondrement des performances pendant une synchronisation.

            `stampedChecksum` porte deja les trois defenses : l observateur
            de fichiers force le rehachage de ce qu il a vu bouger,
            `isStale` le force de toute facon toutes les semaines, et sans
            empreinte connue on hache. Le tampon EVITE le hachage, il ne le
            remplace jamais.
          */
          const checksum = await stampedChecksum(
            fileId,
            filePath,
            stat,
            existing?.checksum
          );


          /*
            UN CONFLIT OUVERT SURVIT AU BALAYAGE — SANS QUOI IL SE REJOUE À L'INFINI.

            Ce bloc REMPLACE l'entrée entière. Il ne sautait que les entrées
            `synced`, donc une entrée passée en `conflict` par `handleConflict`
            repartait en `pending_upload` au balayage suivant, `syncedAt` remis à
            zéro. La garde anti-boucle du fusionneur — « un conflit déjà ouvert
            attend l'arbitrage de l'utilisateur » — ne pouvait alors JAMAIS
            s'armer : le statut qu'elle guette avait été effacé avant qu'elle ne
            regarde.

            L'EMBALLEMENT QUE ÇA PRODUIT. À chaque cycle : divergence constatée,
            nouvelle copie `_conflict_<horodatage>` écrite sur le disque ET
            téléversée, statut effacé, recommencer. Observé en production le
            2026-09-07 sur un compte ouvert depuis deux postes : six copies du
            même fichier, 95 entrées en attente d'envoi, et des centaines de
            kilo-octets dupliqués à chaque tour — dans le coffre local comme
            dans le nuage.

            LA CONDITION EST LE CHECKSUM, PAS LE STATUT. Si les octets sur le
            disque n'ont pas bougé depuis la copie de conflit, il n'y a rien de
            neuf à envoyer : on garde le conflit en attente. S'ils ont changé,
            l'utilisateur a réédité le fichier depuis — c'est une vraie nouvelle
            version locale, qui doit repartir en `pending_upload` et refaire
            l'arbitrage sur du contenu à jour.
          */
          if (keepsOpenConflict(existing, checksum)) continue;

          localManifest.files[fileId] = {
            localPath,
            checksum,
            size: stat.size,
            updatedAt: stat.mtime.toISOString(),
            syncedAt: null,
            chunks: [],
            status: 'pending_upload',
          };
        } catch {
          // Can't read file, skip
        }
      }
    }

    const newFiles = Object.values(localManifest.files).filter(
      (f) => f.status === 'pending_upload'
    ).length;

    if (newFiles > 0) {
      log.info(`[syncService] Scan found ${newFiles} files pending upload`);
    }
  } catch (err) {
    log.error('[syncService] Local scan failed:', err);
  }
}

async function findFileOnDisk(
  baseDir: string,
  fileId: string
): Promise<string | null> {
  // fileId format: "folderId/fileName" (from scanLocalFiles)
  if (fileId.includes('/')) {
    const directPath = path.join(baseDir, fileId);
    try {
      await fs.access(directPath);
      return directPath;
    } catch {
      // Not found at direct path
    }
  }

  // Legacy: fileId might be a raw UUID — scan folders
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Check for fileId.bin
      const candidatePath = path.join(baseDir, entry.name, `${fileId}.bin`);
      try {
        await fs.access(candidatePath);
        return candidatePath;
      } catch {
        // Not in this folder
      }
      // Check for fileId directly
      const altPath = path.join(baseDir, entry.name, fileId);
      try {
        await fs.access(altPath);
        return altPath;
      } catch {
        // Not here either
      }
    }
  } catch {
    // Can't read dir
  }

  return null;
}

/**
 * FILE TIRÉE À `limit` PLACES. Un transfert qui finit libère sa place au
 * suivant sur-le-champ. Avant : des LOTS de trois (`Promise.allSettled` par
 * lot) — un fichier lent retenait les deux autres, et le lot suivant
 * attendait le plus lent. Chaque tâche avale ses propres erreurs (uploadFile
 * et downloadFile le font déjà) : la file ne s'arrête jamais sur un échec.
 */
async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  const size = Math.max(1, Math.min(limit, items.length));
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const idx = next++;
      if (idx >= items.length) return;
      try {
        await fn(items[idx]);
      } catch (err) {
        log.error(`[syncService] transfert en échec (file) : ${(err as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: size }, () => worker()));
}
