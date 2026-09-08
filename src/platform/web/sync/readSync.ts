/**
 * Moteur de sync web — palier M3.
 *
 * CYCLE (sync:triggerSync et pull auto post-déverrouillage) :
 *  1. PULL : GET manifeste (ETag) → déchiffrement `fek:`/`fkz:` → installation
 *     des métadonnées (`meta:{folderId}` conteneurs machine ; `meta:notes`
 *     FUSIONNÉ note à note, voir notesMerge ; `meta:layout` FUSIONNÉ au grain de
 *     la vue, voir layoutMerge) dans le store CLOISONNÉ du profil ;
 *  2. RESTAURATION : les profils cloud absents localement sont recréés avec le
 *     MÊME id (profileMeta du manifeste) — miroir de syncService.ts:790-812 ;
 *  3. PUSH (append-only) : les modifications locales marquées pending sont
 *     remontées — blobs déjà au format de câble (FEK portable), métadonnées
 *     re-scellées en conteneur machine `v2:` — puis le manifeste est réécrit
 *     par OVERLAY sur l'état distant frais (jamais de suppression d'entrées
 *     distantes : une erreur web ne peut pas détruire de données desktop),
 *     avec verrouillage optimiste (CAS version, un retry sur conflit).
 *
 * Le contenu des fichiers distants reste téléchargé À LA DEMANDE
 * (fetchCloudFile), re-chiffré au format web portable et mis en cache.
 */

import {
  decryptFileContent,
  encryptFileContent,
  exportFEKRaw,
  hasHybridKey,
} from '../../../services/auth/hybridCrypto';
import {
  apiFetch,
  ensureAccessToken,
  getAccessToken,
  refreshViaCookie,
  resolveApiBase,
} from '../webApiBase';
import { idbGet, idbPut } from '../idb';
import { forProfile, getActiveProfileId } from '../webStore';
import { emitWebEvent } from '../webEventBus';
import {
  clearPendingUploads,
  getPendingUploads,
  markPendingUpload,
  type PendingAck,
  type PendingEntry,
  type PendingMap,
} from './pendingUploads';
import { withNotesLock } from './notesLock';
import { NOTES_DIGEST_KEY, notesPlainDigest } from './notesDigest';
import {
  decryptFekContainer,
  decryptMachineContainerBinary,
  decryptMachineContainerText,
  decryptV3Buffer,
  encryptFekContainer,
  encryptMachineContainerText,
  isMachineBinaryContainer,
  isV3Container,
} from './containerCrypto';
import { readDeltaFileFromCloud } from './deltaRead';
import { isNoteLive } from '../../../services/collab/liveNoteRegistry';
// Fonction PURE et tolérante (un contenu sans base est rendu tel quel) : la
// fusion l'injecte dans `applyConflictCopies`, qui ne peut pas la connaître.
import { restampCopiedDbIds } from '../../../renderer/components/notes/extensions/inlineDatabase/dbIndex';
import {
  applyConflictCopies,
  collectMergeBase,
  deepEqual,
  dropLiveSessionConflicts,
  mergeNotesPayload,
  preserveLiveSessionNotes,
  selectGenuineConflicts,
  NOTES_META_FILE_ID,
  NOTES_META_RESOURCE_ID,
  PURGED_NOTEBOOKS_KEY,
  PURGED_NOTES_KEY,
  type NotesMergeBase,
  type NotesPayload,
} from './notesMerge';
import {
  createEmptyLayoutDocument,
  mergeLayoutDocuments,
  normalizeLayoutDocument,
  pruneDocumentSuperseded,
  LAYOUT_BLOB_FILENAME,
  LAYOUT_META_FILE_ID,
  LAYOUT_META_RESOURCE_ID,
  type LayoutDocument,
} from './layoutMerge';

interface SyncFileEntry {
  checksum: string;
  size: number;
  updatedAt: string;
  syncedAt: string | null;
  chunks: string[];
  status: string;
  /**
   * Chemin relatif attendu par le desktop (`notes.enc`, `{folderId}/metadata.json`,
   * `{folderId}/{fileName}`) — c'est lui qui lui dit OÙ écrire ce qu'il télécharge
   * (syncService.ts:1174). Une entrée poussée sans lui atterrissait nulle part.
   */
  localPath?: string;
  /** Empreinte du CLAIR (desktop) — décrit le contenu, pas l'entrée. */
  plaintextChecksum?: string;
  delta?: { version: number; blockCount: number };
  [key: string]: unknown;
}

interface SyncProfileMeta {
  id: string;
  name: string;
  avatarColor: string;
  [key: string]: unknown;
}

interface CloudManifest {
  version: number;
  profileId: string;
  lastSyncAt: string;
  files: Record<string, SyncFileEntry>;
  notes: Record<string, unknown>;
  profileMeta?: SyncProfileMeta;
  encryptionKey?: string;
  [key: string]: unknown;
}

const FOLDERS_KEY = 'folders';
const NOTES_KEY = 'notes_enc';
const SYNC_STATE_KEY = 'cloud_sync_state';

/**
 * Le document de MISE EN PAGE de ce profil, tel que ce navigateur le connaît —
 * la face web de `layout.enc` (`electron/sync/layoutStore.ts`).
 *
 * ── STOCKÉ EN CLAIR, ET C'EST DÉLIBÉRÉ ──────────────────────────────────────
 * Même classe que `folders` (voir `webStorageHandlers`) : de la STRUCTURE —
 * identifiants de vues, géométrie des blocs, attaches vers des dossiers — et
 * jamais de contenu. `folders` porte déjà les NOMS de dossiers et d'items en
 * clair dans le même IndexedDB ; chiffrer la mise en page n'y ajouterait aucun
 * secret, et lui ferait dépendre l'accueil d'un coffre déverrouillé alors qu'il
 * en est le squelette (le bureau prend la clé MACHINE, pas la FEK, exactement
 * pour cette raison — voir l'en-tête de `layoutStore.ts`).
 *
 * LA PROMESSE E2EE EST INTACTE PAR AILLEURS : ce qui PART d'ici est re-scellé en
 * conteneur clé machine `v2:` (`encryptMachineContainerText`), et le manifeste
 * qui le nomme voyage chiffré sous la FEK. Ni le worker ni R2 ne l'ouvrent.
 */
const LAYOUT_KEY = 'layout_doc';

/**
 * Ancêtre commun des notes : horloges arrêtées par la dernière fusion (ou la
 * dernière remontée), plus l'instant du dernier accord PROUVÉ avec le nuage.
 * Sert uniquement à distinguer une vraie divergence d'un simple rattrapage
 * avant de fabriquer une copie de conflit — voir `selectGenuineConflicts`.
 * Aucun contenu n'y est stocké, seulement des horodatages.
 */
const NOTES_BASE_KEY = 'notes_merge_base';

interface StoredNotesBase {
  /** Dernier instant où local ≡ nuage pour les notes (ms), ou `null`. */
  agreedAt: number | null;
  clocks: NotesMergeBase;
}

/** Taille de chunk du transport, miroir EXACT du desktop (syncService.ts:64). */
const CHUNK_SIZE = 4 * 1024 * 1024;

/**
 * DÉLAIS MAXIMAUX DU CYCLE. Un `fetch` sans `signal` n'expire JAMAIS de
 * lui-même : sur un réseau qui décroche (wifi qui tombe, proxy captif, onglet
 * réveillé sans route), la promesse reste pendue pour toujours. Le cycle ne
 * rendait alors pas la main, son verrou restait fermé, le meneur refusait tout
 * travail et les suiveurs attendaient un cycle que personne ne ferait plus —
 * plus aucune synchronisation, sans le moindre signal. Chaque aller-retour du
 * cycle porte donc sa propre échéance, comme le sondage le fait déjà.
 *
 * Deux valeurs : les échanges de contrôle (manifeste, jetons de presign) sont
 * courts, un transfert de chunk peut légitimement durer sur une ligne lente.
 */
/**
 * Tentatives du CAS de manifeste. Une seule ne suffit plus : le desktop pousse
 * en parallèle, et une session de collaboration écrit toutes les 2 s — deux
 * appareils actifs se croisent régulièrement. L'overlay étant append-only, le
 * rejouer sur un manifeste plus frais est sûr.
 */
const MAX_CAS_ATTEMPTS = 3;
const CONTROL_TIMEOUT_MS = 30_000;
const CHUNK_TIMEOUT_MS = 120_000;

/**
 * `AbortSignal.timeout` là où il existe (tous les navigateurs cibles, Node 18+).
 * Une plateforme qui ne l'a pas retrouve simplement le comportement d'avant :
 * mieux vaut un fetch sans échéance qu'un cycle qui jette au démarrage.
 */
function deadline(ms: number): AbortSignal | undefined {
  const ctor = typeof AbortSignal !== 'undefined' ? AbortSignal : null;
  return ctor && typeof ctor.timeout === 'function' ? ctor.timeout(ms) : undefined;
}

/**
 * Champ RACINE du manifeste par lequel un desktop À JOUR annonce qu'il sait
 * fusionner `notes.enc` note à note. Tant qu'il est absent, le nuage est peut-être
 * servi par un desktop qui traite ce fichier en dernier-écrivain-gagne au niveau
 * du blob : notre remontée y effacerait tout ce qu'il a écrit depuis. Absent =
 * remontée des notes DÉSACTIVÉE (le rapatriement fusionnant, lui, reste actif :
 * il ne met personne en danger).
 */
const NOTES_MERGE_CAPABILITY_FIELD = 'notesMergeVersion';

interface SyncState {
  profileId: string;
  version: number;
  lastPullAt: string;
}

let _manifestCache: { profileId: string; manifest: CloudManifest } | null = null;

/**
 * Le même manifeste, PARTAGÉ entre onglets. `_manifestCache` est une variable de
 * module : seul l'onglet qui a fait le cycle la garnit. Or seul le MENEUR fait
 * des cycles — dans tout autre onglet, ouvrir un fichier du nuage échouait sur
 * « File X does not exist », faute de savoir que l'entrée existe.
 *
 * RE-SCELLÉ AVEC LA FEK avant d'entrer dans IndexedDB, jamais en clair : ce
 * document porte la clé machine du profil et le chemin de chaque fichier. C'est
 * exactement le format sous lequel le nuage le stocke déjà (`encryptFekContainer`),
 * donc aucune discipline nouvelle — et un coffre verrouillé ne peut pas le lire.
 */
const MANIFEST_CACHE_KEY = 'cloud_manifest_enc';

/**
 * Dernière version de manifeste SERVEUR effectivement ingérée, par profil.
 * Sert d'ETag au GET conditionnel (`W/"v{version}"`, sync.ts:1352) et au
 * sondage léger de l'ordonnanceur. Une version n'y est inscrite qu'à DEUX
 * endroits — après une installation de métadonnées sans aucune entrée en
 * échec (pullFromCloud) et après notre propre écriture CAS (pushToCloud) :
 * un déchiffrement qui échoue laisse la version d'avant, donc le prochain
 * sondage redemande. `fetchManifestRaw` ne l'écrit JAMAIS (elle est aussi
 * appelée par des chemins qui n'ingèrent rien).
 */
const _serverVersions = new Map<string, number>();

/**
 * Profils dont la remontée des NOTES est suspendue : le `meta:notes` distant
 * était annoncé au manifeste mais n'a pas pu être lu ni fusionné ce cycle-ci
 * (chunk indisponible, déchiffrement, clé machine absente). Pousser dans cet
 * état remplacerait `notes.enc` côté nuage par un store qui n'a JAMAIS vu les
 * notes de l'autre appareil — exactement la perte que la fusion existe pour
 * éviter. L'entrée reste en attente et repartira au cycle suivant.
 *
 * L'absence d'un profil de cet ensemble vaut « sûr » : un manifeste non
 * rapatrié (304, même version) signifie que le distant n'a pas bougé depuis
 * l'ingestion précédente, laquelle a fusionné.
 */
const _notesPushBlocked = new Set<string>();

/**
 * Version de fusion annoncée par le manifeste distant, par profil (voir
 * NOTES_MERGE_CAPABILITY_FIELD). Absente de la carte = jamais vue = remontée des
 * notes désactivée. N'est écrite QUE depuis un manifeste réellement rapatrié :
 * un 304 ne dit rien de neuf et ne doit pas effacer ce qu'on sait.
 *
 * CARTE DE MODULE, donc PROPRE À CET ONGLET — et seul le MENEUR fait des cycles.
 * Dans un onglet suiveur elle reste vide à jamais : la garde de `notes:save` y
 * refusait donc toute marque, et les notes écrites là n'étaient JAMAIS remontées.
 * Le verdict est pour cette raison AUSSI persisté dans le store partagé du profil
 * (voir `NOTES_CAPABILITY_KEY`), que les suiveurs relisent. La carte reste le
 * cache mémoire : personne ne paie une lecture IndexedDB par sauvegarde.
 */
const _notesMergeVersions = new Map<string, number>();

/** Clé du verdict de capacité PARTAGÉ entre onglets (store du profil). */
const NOTES_CAPABILITY_KEY = 'notes_merge_capability';

/**
 * Un refus est réexaminé après ce délai : c'est le MENEUR qui écrit le verdict,
 * un suiveur démarré avant lui doit pouvoir s'apercevoir qu'il est arrivé. Un
 * verdict positif, lui, ne s'oublie pas (la capacité ne se retire pas en cours
 * de session).
 */
const CAPABILITY_REREAD_MS = 30_000;

/** Dernière consultation du verdict PARTAGÉ, par profil. */
const _capabilityReadAt = new Map<string, number>();

/** Profils pour lesquels l'attente d'un desktop à jour a déjà été journalisée. */
const _notesGuardLogged = new Set<string>();

/**
 * Profils dont le repli « nuage sans `meta:notes` » a déjà posé sa marque cette
 * session. Sans ce garde, chaque pull d'un nuage qui n'annonce pas encore les
 * notes remarquait la ressource, donc émettait `web:pending-marked`, donc
 * relançait un cycle complet 10 s plus tard — une boucle chaude perpétuelle tant
 * que la remontée échouait ou restait désactivée.
 */
const _notesFallbackMarked = new Set<string>();

/**
 * Empreinte de l'entrée `meta:notes` réellement FUSIONNÉE au dernier pull, par
 * profil (absente = le manifeste ingéré n'annonçait aucune entrée notes).
 *
 * POURQUOI. La remontée refait un GET INCONDITIONNEL du manifeste : entre le
 * manifeste fusionné (version V) et celui-là (version V'), un autre appareil a
 * pu publier ses notes. Pousser alors remplacerait `notes.enc` par un état qui
 * n'a jamais vu V' — la perte exacte que la fusion existe pour empêcher.
 * Comparer cette empreinte à celle du manifeste frais le détecte ; en cas
 * d'écart on saute la remontée SANS acquitter la marque, et le cycle suivant
 * refusionnera avant de pousser.
 */
const _mergedNotesChecksum = new Map<string, string>();

/**
 * Ids des notes du `meta:notes` réellement fusionné, par profil. Sert à la
 * garde anti-effacement de `buildNotesContainer` : un store local vide dont le
 * registre de purge couvre TOUS ces ids est une suppression VOULUE, pas un
 * store perdu.
 */
const _mergedNotesRemoteIds = new Map<string, Set<string>>();

/**
 * Profils dont la remontée de la MISE EN PAGE est suspendue : l'entrée
 * `meta:layout` était annoncée au manifeste mais n'a pas pu être lue ni
 * fusionnée ce cycle-ci. Même raison que pour les notes — la remontée remplace
 * le blob ENTIER côté nuage, donc pousser sans avoir lu ce qu'on remplace
 * effacerait la disposition faite sur l'autre appareil.
 */
const _layoutPushBlocked = new Set<string>();

/**
 * Empreinte de l'entrée `meta:layout` réellement FUSIONNÉE au dernier pull, par
 * profil. Garde de FRAÎCHEUR de la remontée, strictement la même que pour les
 * notes : la remontée refait un GET inconditionnel du manifeste, et si l'entrée
 * a bougé entre la fusion et lui, l'état qu'on s'apprête à pousser n'a jamais vu
 * ce changement-là.
 */
const _mergedLayoutChecksum = new Map<string, string>();

/** Oubli des versions connues — logout / verrouillage / changement de profil. */
export function clearServerVersions(): void {
  _serverVersions.clear();
  _notesPushBlocked.clear();
  _notesMergeVersions.clear();
  _capabilityReadAt.clear();
  _notesGuardLogged.clear();
  _notesFallbackMarked.clear();
  _mergedNotesChecksum.clear();
  _mergedNotesRemoteIds.clear();
  _layoutPushBlocked.clear();
  _mergedLayoutChecksum.clear();
}

/** Un marqueur de capacité exploitable, ou `null`. */
function capabilityOf(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 ? raw : null;
}

/**
 * Mémorise (ou oublie) le marqueur de capacité porté par un manifeste LU — en
 * mémoire ET dans le store partagé, pour que les onglets SUIVEURS (qui ne font
 * aucun cycle, donc ne lisent aucun manifeste) puissent en juger eux aussi.
 * L'écriture n'a lieu que si le verdict CHANGE : la relire à chaque cycle ne
 * coûte rien, la réécrire toutes les 10 s si.
 */
async function recordNotesMergeCapability(
  profileId: string,
  manifest: CloudManifest
): Promise<void> {
  const version = capabilityOf(manifest[NOTES_MERGE_CAPABILITY_FIELD]);
  const previous = _notesMergeVersions.get(profileId) ?? null;
  if (version !== null) _notesMergeVersions.set(profileId, version);
  else _notesMergeVersions.delete(profileId);
  _capabilityReadAt.set(profileId, Date.now());
  if (version === previous) return;
  await forProfile(profileId)
    .put(NOTES_CAPABILITY_KEY, { version })
    .catch((err) => {
      console.warn('[webSync] verdict de capacité des notes non partagé :', err);
    });
}

/** Journalise UNE fois par session la raison du refus, et rend `false`. */
function refuseNotesPush(profileId: string): false {
  if (!_notesGuardLogged.has(profileId)) {
    _notesGuardLogged.add(profileId);
    console.info(
      '[webSync] remontée des notes en attente : le manifeste distant ne porte pas encore ' +
        `\`${NOTES_MERGE_CAPABILITY_FIELD}\`. Les notes écrites ici restent dans ce navigateur ` +
        "tant qu'un appareil de bureau à jour n'a pas synchronisé ce profil. Le rapatriement " +
        'des notes distantes, lui, continue normalement.'
    );
  }
  return false;
}

/**
 * La remontée de `meta:notes` est-elle autorisée pour ce profil ? Mémoire
 * d'abord (le cycle de CET onglet vient peut-être de lire un manifeste), puis
 * verdict PARTAGÉ posé par le meneur. Un refus n'est pas relu plus d'une fois
 * par `CAPABILITY_REREAD_MS` : une sauvegarde de notes ne doit pas payer un
 * accès IndexedDB de plus.
 */
async function notesPushAllowed(profileId: string): Promise<boolean> {
  if (_notesMergeVersions.has(profileId)) return true;
  const readAt = _capabilityReadAt.get(profileId);
  if (readAt !== undefined && Date.now() - readAt < CAPABILITY_REREAD_MS) {
    return refuseNotesPush(profileId);
  }
  _capabilityReadAt.set(profileId, Date.now());
  const stored = await forProfile(profileId)
    .get<{ version?: unknown }>(NOTES_CAPABILITY_KEY)
    .catch(() => null);
  const version = capabilityOf(stored?.version);
  if (version === null) return refuseNotesPush(profileId);
  _notesMergeVersions.set(profileId, version);
  return true;
}

/**
 * Même verdict, pour le profil ACTIF — consulté par `notes:save` avant de
 * marquer `meta:notes` en attente. Marquer une ressource que la remontée
 * refusera laisserait l'entrée dans le registre indéfiniment : badge « non
 * synchronisé » et avertissement de fermeture d'onglet perpétuels. Quand la
 * capacité apparaît, le repli de `installMetadata` (nuage sans entrée notes) ou
 * la fusion elle-même (`changedFromRemote`) repose la marque.
 */
export async function isNotesPushAllowed(): Promise<boolean> {
  const profileId = await getActiveProfileId();
  return profileId ? notesPushAllowed(profileId) : false;
}

/**
 * Le GET conditionnel est-il hors service pour cette session ? L'en-tête
 * `If-None-Match` a DÉJÀ fait tomber toute la sync web en conditions réelles
 * (préflight CORS refusé par l'allowlist du Worker) : au premier échec réseau
 * du chemin conditionnel on rejoue sans lui et on ne le retente plus.
 */
let _conditionalGetDisabled = false;

export function isConditionalGetDisabled(): boolean {
  return _conditionalGetDisabled;
}

const b64ToBytes = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
const bytesToB64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

async function fekRawOrThrow(): Promise<Uint8Array> {
  const fek = await exportFEKRaw();
  /**
   * ⚠ CE MESSAGE PARLE DE LA CLÉ DU PROFIL, PAS D'UN COFFRE PARTAGÉ.
   *
   * Il disait « Coffre verrouillé — déverrouillez avant de synchroniser ». Le
   * mot « coffre » désigne ici le chiffrement du profil (la FEK), mais il est
   * devenu, depuis, le nom des COFFRES PARTAGÉS — qui n'ont rien à voir. Un
   * utilisateur lisant ce message dans sa console est parti chercher pourquoi
   * son coffre partagé bloquait ses notes locales : la panne était ailleurs, le
   * message l'a envoyé au mauvais endroit.
   *
   * Il nomme donc désormais ce qu'il constate, et pas une hypothèse sur la
   * cause. La cause LA PLUS FRÉQUENTE est d'ailleurs bénigne : au démarrage,
   * la clé est restaurée de façon asynchrone (`tryRestoreFEKFromSafeStorage`),
   * et tout ce qui interroge avant la fin tombe ici. Ce n'est pas un
   * verrouillage, c'est une course.
   */
  if (!fek) throw new Error('Clé de chiffrement du profil indisponible (pas encore restaurée)');
  return fek;
}

async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest(
    'SHA-256',
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  );
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** fileId du manifeste = sha256("folderId/fileName") tronqué à 32 hex (syncService.ts:359). */
export async function deriveFileId(folderId: string, fileName: string): Promise<string> {
  return (await sha256HexBytes(new TextEncoder().encode(`${folderId}/${fileName}`))).slice(0, 32);
}

/** Cache mémoire + dépôt partagé (voir MANIFEST_CACHE_KEY). */
async function rememberManifest(profileId: string, manifest: CloudManifest): Promise<void> {
  _manifestCache = { profileId, manifest };
  try {
    const sealed = await encryptFekContainer(
      new TextEncoder().encode(JSON.stringify(manifest)),
      await fekRawOrThrow()
    );
    await forProfile(profileId).put(MANIFEST_CACHE_KEY, sealed);
  } catch (err) {
    // Perdre le partage ne coûte qu'un onglet suiveur sans statuts cloud
    // jusqu'à son prochain cycle : jamais une donnée.
    console.warn('[webSync] manifeste non partagé avec les autres onglets :', err);
  }
}

/** Manifeste déposé par le cycle d'un AUTRE onglet, ou `null`. */
async function readStoredManifest(profileId: string): Promise<CloudManifest | null> {
  try {
    const sealed = await forProfile(profileId).get<Uint8Array>(MANIFEST_CACHE_KEY);
    if (!sealed) return null;
    const plain = await decryptFekContainer(new Uint8Array(sealed), await fekRawOrThrow());
    return JSON.parse(new TextDecoder().decode(plain)) as CloudManifest;
  } catch (err) {
    console.warn('[webSync] manifeste partagé illisible :', err);
    return null;
  }
}

/**
 * Le manifeste du profil actif, mémoire d'abord puis dépôt partagé. À préférer
 * partout où l'absence de manifeste se traduit par « ce fichier n'existe pas » :
 * dans un onglet suiveur, la mémoire est vide par construction.
 */
export async function loadCachedManifest(): Promise<CloudManifest | null> {
  if (_manifestCache) return _manifestCache.manifest;
  const profileId = await getActiveProfileId();
  if (!profileId) return null;
  const manifest = await readStoredManifest(profileId);
  if (manifest) _manifestCache = { profileId, manifest };
  return manifest;
}

// ── Transport chunks (proxy Worker, jeton par chunk) ────────────────────────

async function downloadChunk(
  profileId: string,
  fileId: string,
  chunkIndex: number
): Promise<Uint8Array> {
  const token = await apiFetch<{ data?: { downloadUrl?: string } }>('/sync/presign/download', {
    method: 'POST',
    body: { profileId, fileId, chunkIndex },
    signal: deadline(CONTROL_TIMEOUT_MS),
  });
  const downloadUrl = token.body?.data?.downloadUrl;
  if (!token.body?.success || !downloadUrl) {
    throw new Error(token.body?.error || `Téléchargement refusé (chunk ${chunkIndex})`);
  }
  const res = await fetch(`${resolveApiBase()}${downloadUrl}`, {
    signal: deadline(CHUNK_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Chunk ${chunkIndex} : HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function uploadChunk(
  profileId: string,
  fileId: string,
  chunkIndex: number,
  bytes: Uint8Array
): Promise<string> {
  const token = await apiFetch<{ data?: { uploadUrl?: string; key?: string } }>(
    '/sync/presign/upload',
    {
      method: 'POST',
      body: { profileId, fileId, chunkIndex, size: bytes.byteLength },
      signal: deadline(CONTROL_TIMEOUT_MS),
    }
  );
  const uploadUrl = token.body?.data?.uploadUrl;
  if (!token.body?.success || !uploadUrl) {
    throw new Error(token.body?.error || `Upload refusé (${fileId}/${chunkIndex})`);
  }
  const res = await fetch(`${resolveApiBase()}${uploadUrl}`, {
    method: 'PUT',
    body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    headers: { 'Content-Type': 'application/octet-stream' },
    signal: deadline(CHUNK_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Upload chunk : HTTP ${res.status}`);
  const body = (await res.json().catch(() => null)) as {
    success?: boolean;
    data?: { key?: string };
  } | null;
  return body?.data?.key ?? token.body?.data?.key ?? `${fileId}/${chunkIndex}`;
}

/**
 * Découpe en chunks de 4 Mio comme le desktop, et rend les clés dans l'ordre.
 * Le presign refuse au-delà de la taille de chunk : un conteneur de notes un peu
 * gros (quelques milliers de notes) partait en UN morceau et se faisait rejeter,
 * donc ne remontait jamais. `downloadWholeFile` sait déjà recoller les morceaux.
 */
async function uploadBytes(
  profileId: string,
  fileId: string,
  bytes: Uint8Array
): Promise<string[]> {
  const total = Math.max(1, Math.ceil(bytes.byteLength / CHUNK_SIZE));
  const keys: string[] = [];
  for (let i = 0; i < total; i++) {
    const part = bytes.subarray(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, bytes.byteLength));
    keys.push(await uploadChunk(profileId, fileId, i, part));
  }
  return keys;
}

async function downloadWholeFile(
  profileId: string,
  fileId: string,
  entry: SyncFileEntry
): Promise<Uint8Array> {
  if (entry.delta) {
    throw new Error('Fichiers delta (≥64 Mio) pas encore supportés sur le web');
  }
  const count = Math.max(entry.chunks.length, 1);
  const parts: Uint8Array[] = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    const part = await downloadChunk(profileId, fileId, i);
    parts.push(part);
    total += part.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

// ── Manifeste : lecture ─────────────────────────────────────────────────────

const isAbort = (err: unknown): boolean =>
  err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');

/**
 * GET du manifeste, avec ceinture sur le conditionnel : le préflight CORS de
 * `If-None-Match` a déjà mis toute la sync web à terre une fois. Une erreur
 * réseau sur le chemin conditionnel rejoue donc la requête SANS l'en-tête et
 * condamne le conditionnel pour la session (le sondage le respecte).
 */
async function getManifestResponse(
  profileId: string,
  accessToken: string,
  knownVersion?: number,
  signal?: AbortSignal
): Promise<Response> {
  const url = `${resolveApiBase()}/sync/manifest/${profileId}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
  const conditional = typeof knownVersion === 'number' && !_conditionalGetDisabled;
  if (!conditional) return fetch(url, { headers, signal });
  try {
    return await fetch(url, {
      headers: { ...headers, 'If-None-Match': `W/"v${knownVersion}"` },
      signal,
    });
  } catch (err) {
    if (isAbort(err) || signal?.aborted) throw err;
    _conditionalGetDisabled = true;
    console.warn('[webSync] GET conditionnel désactivé pour la session :', err);
    return fetch(url, { headers, signal });
  }
}

async function fetchManifestRaw(
  profileId: string,
  knownVersion?: number
): Promise<{ manifest: CloudManifest | null; version: number; notModified: boolean }> {
  const accessToken = await ensureAccessToken();
  if (!accessToken) throw new Error('Non authentifié');
  // Le Worker répond 304 sans corps tant que la version n'a pas bougé
  // (sync.ts:1338-1362). La déduplication par version reste en ceinture plus
  // bas — elle couvre le cas où un intermédiaire mange le conditionnel.
  let res = await getManifestResponse(
    profileId,
    accessToken,
    knownVersion,
    deadline(CONTROL_TIMEOUT_MS)
  );
  // LE MANIFESTE EST L'ÉTAPE 1 DU CYCLE, donc l'endroit où une session périmée
  // se voit en premier — et l'endroit où elle CONDAMNAIT tout : le cycle mourait
  // ici, avant le moindre `apiFetch`, seul chemin qui savait renouveler. Un 401
  // vaut donc une re-frappe du jeton et UN second essai ; s'il échoue à son
  // tour, le refus est réel et remonte comme avant.
  if (res.status === 401 && (await refreshViaCookie())) {
    const renewed = getAccessToken();
    if (renewed) {
      void res.body?.cancel().catch(() => undefined);
      res = await getManifestResponse(
        profileId,
        renewed,
        knownVersion,
        deadline(CONTROL_TIMEOUT_MS)
      );
    }
  }
  if (res.status === 304) return { manifest: null, version: knownVersion ?? 0, notModified: true };
  if (!res.ok) throw new Error(`Manifeste : HTTP ${res.status}`);
  const body = (await res.json()) as {
    success: boolean;
    data?: { manifest: string | null; version: number };
    error?: string;
  };
  if (!body.success || !body.data) throw new Error(body.error || 'Manifeste illisible');
  if (body.data.manifest === null) {
    return { manifest: null, version: body.data.version, notModified: false };
  }
  // Déduplication côté client : même version que la dernière lue → inutile de
  // déchiffrer/installer à nouveau.
  if (typeof knownVersion === 'number' && body.data.version === knownVersion) {
    return { manifest: null, version: knownVersion, notModified: true };
  }
  const plain = await decryptFekContainer(b64ToBytes(body.data.manifest), await fekRawOrThrow());
  const manifest = JSON.parse(new TextDecoder().decode(plain)) as CloudManifest;
  return { manifest, version: body.data.version, notModified: false };
}

export type ManifestProbe = 'unchanged' | 'changed' | 'skipped' | 'unauthorized' | 'error';

const PROBE_TIMEOUT_MS = 10_000;

/**
 * Sondage léger du manifeste distant — GET conditionnel dont le CORPS N'EST
 * JAMAIS LU : 304 quand rien n'a bougé (un aller-retour d'en-têtes), sinon on
 * annule le flux et on rend `changed`. Le rapatriement reste l'affaire du cycle
 * complet (aucune logique de pull dupliquée ici).
 *
 * `skipped` = rien à comparer (session absente, coffre verrouillé, aucune
 * version encore lue pour ce profil, ou conditionnel hors service) : c'est au
 * cycle complet de faire foi, jamais au sondage — sans ça un profil jamais lu
 * déclencherait un cycle à chaque tour, et sans conditionnel le sondage
 * téléchargerait le manifeste entier toutes les 20 s.
 */
export async function probeManifestChanged(profileId: string): Promise<ManifestProbe> {
  // Renouvelé si besoin : un sondage qui part avec un jeton mort rend
  // `unauthorized`, ce qui SUSPEND le sondage pour la session (syncScheduler) —
  // le quasi-temps-réel s'éteignait donc au bout d'un quart d'heure d'onglet
  // ouvert, sans que rien ne le dise.
  const accessToken = await ensureAccessToken();
  if (!accessToken || !hasHybridKey() || _conditionalGetDisabled) return 'skipped';
  const known = _serverVersions.get(profileId);
  if (known === undefined) return 'skipped';

  let res: Response;
  try {
    res = await fetch(`${resolveApiBase()}/sync/manifest/${profileId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'If-None-Match': `W/"v${known}"`,
      },
      // Sans délai maximal, un wifi qui décroche laisse la requête pendue et
      // le verrou de sondage fermé POUR TOUJOURS : le quasi-temps-réel meurt
      // en silence. Un abandon vaut un échec (back-off, puis cycle complet).
      // Même discipline que tous les allers-retours du cycle (voir `deadline`).
      signal: deadline(PROBE_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn('[webSync] sondage interrompu :', err);
    return 'error';
  }
  if (res.status === 304) return 'unchanged';
  // Corps non lu : le cycle complet refera la requête, inutile de payer le
  // téléchargement du manifeste deux fois.
  void res.body?.cancel().catch(() => undefined);
  if (res.status === 401 || res.status === 403) return 'unauthorized';
  if (!res.ok) return 'error';
  return 'changed';
}

// ── Installation des métadonnées ────────────────────────────────────────────

interface WebFolder {
  id: string;
  name: string;
  items?: Array<Record<string, unknown>>;
  __fromCloud?: boolean;
  __unreadable?: boolean;
  [key: string]: unknown;
}

/**
 * `failed` = entrées que le nuage proposait et qu'on n'a PAS su lire (réseau,
 * déchiffrement). L'appelant s'en sert pour ne pas inscrire la version : une
 * entrée perdue doit être redemandée au prochain cycle. Les sauts délibérés
 * (méta de dossier locale en attente, local plus récent) ne sont pas des
 * échecs — et un manifeste SANS clé machine non plus, sinon la version ne
 * serait jamais inscrite et tout serait retéléchargé à chaque cycle.
 *
 * `meta:notes` fait exception à tout ça : jamais sauté, toujours FUSIONNÉ dans
 * le store local (installNotes), et sa remontée est suspendue tant que le
 * distant n'a pas été lu (voir _notesPushBlocked).
 */
async function installMetadata(
  profileId: string,
  manifest: CloudManifest
): Promise<{ installed: number; failed: number }> {
  const store = forProfile(profileId);
  const machineKey = manifest.encryptionKey ? b64ToBytes(manifest.encryptionKey) : null;
  const folders = (await store.get<Record<string, WebFolder>>(FOLDERS_KEY)) ?? {};
  // Les modifications locales EN ATTENTE de remontée priment sur le distant :
  // sans ce garde, un pull entre la modification et son push écrasait le
  // dossier __fromCloud avec la version distante périmée (bug de fraîcheur
  // constaté — la méta poussée ensuite perdait les items récents).
  const pending = await getPendingUploads();
  let installed = 0;
  let failed = 0;
  let foldersChanged = false;
  let sawRemoteNotes = false;
  let notesBlocked = false;
  let sawRemoteLayout = false;
  let layoutBlocked = false;

  for (const [fileId, entry] of Object.entries(manifest.files)) {
    if (!fileId.startsWith('meta:')) continue;
    const resourceId = fileId.slice(5);
    if (entry.status === 'deleted') {
      // Entrée distante explicitement supprimée : rien à installer — mais elle
      // compte comme VUE, sinon la marque de secours plus bas la ressusciterait.
      // Son empreinte est retenue quand même : c'est l'état distant que ce
      // cycle a pris en compte, et la remontée le comparera au sien.
      if (resourceId === NOTES_META_RESOURCE_ID) {
        sawRemoteNotes = true;
        _mergedNotesChecksum.set(profileId, entry.checksum);
        _mergedNotesRemoteIds.set(profileId, new Set());
      }
      if (resourceId === LAYOUT_META_RESOURCE_ID) {
        sawRemoteLayout = true;
        _mergedLayoutChecksum.set(profileId, entry.checksum);
      }
      continue;
    }
    if (resourceId === NOTES_META_RESOURCE_ID) {
      // Annoncé par le manifeste : la remontée reste suspendue TANT QUE ce
      // conteneur n'a pas été lu et fusionné (voir _notesPushBlocked).
      sawRemoteNotes = true;
      notesBlocked = true;
    }
    if (resourceId === LAYOUT_META_RESOURCE_ID) {
      // Idem pour la mise en page, et pour la même raison exactement : la
      // remontée remplace le blob ENTIER.
      sawRemoteLayout = true;
      layoutBlocked = true;
    }
    // FRAÎCHEUR — les notes sont la SEULE ressource exemptée du saut « méta
    // locale en attente ». Pour un dossier, sauter préserve le local car la
    // remontée réécrira l'entrée distante ENTIÈRE et le dossier n'a qu'un
    // écrivain à la fois. Pour les notes, sauter serait destructeur : le push
    // qui suit dans le MÊME cycle remplace `notes.enc` en entier côté nuage,
    // donc pousser sans avoir lu le distant écraserait les notes de l'autre
    // appareil. On fusionne toujours, PUIS on pousse la fusion — c'est
    // précisément ce que la fusion note à note rend sûr.
    //
    // La MISE EN PAGE est exemptée pour la même raison que les notes : sa
    // remontée remplace le blob entier, donc pousser une modification locale
    // sans avoir lu le distant écraserait la disposition de l'autre appareil.
    if (
      pending[fileId] &&
      resourceId !== NOTES_META_RESOURCE_ID &&
      resourceId !== LAYOUT_META_RESOURCE_ID
    ) {
      continue;
    }
    try {
      const bytes = await downloadWholeFile(profileId, fileId, entry);
      if (resourceId === NOTES_META_RESOURCE_ID) {
        if (!machineKey) continue; // conteneur illisible sans clé : pas un échec
        const remotePayload = (await decryptMachineContainerText(
          new TextDecoder().decode(bytes),
          machineKey
        )) as NotesPayload;
        if (await installNotes(profileId, remotePayload)) installed++;
        notesBlocked = false; // distant lu ET fusionné : la remontée peut partir
        // Ce que la remontée du même cycle comparera au manifeste frais : si
        // l'entrée a bougé entre-temps, elle pousserait un état qui n'a pas vu
        // ce changement-là.
        _mergedNotesChecksum.set(profileId, entry.checksum);
        _mergedNotesRemoteIds.set(
          profileId,
          new Set(Object.keys((remotePayload?.byId as Record<string, unknown>) ?? {}))
        );
        continue;
      }
      if (resourceId === LAYOUT_META_RESOURCE_ID) {
        // MÊME CHEMIN DE CLÉ QUE `meta:notes`, à la lettre : conteneur TEXTE
        // `v2:` ouvert avec la clé machine que porte le manifeste. Sans elle le
        // conteneur est illisible — ce n'est pas un échec, juste un manifeste
        // qui n'a pas encore été écrit par un appareil qui la connaît.
        if (!machineKey) continue;
        const remoteDoc = normalizeLayoutDocument(
          await decryptMachineContainerText(new TextDecoder().decode(bytes), machineKey)
        );
        if (await installLayout(profileId, remoteDoc)) installed++;
        layoutBlocked = false; // distant lu ET fusionné : la remontée peut partir
        _mergedLayoutChecksum.set(profileId, entry.checksum);
        continue;
      }
      if (!machineKey) continue;
      const folderObj = (await decryptMachineContainerText(
        new TextDecoder().decode(bytes),
        machineKey
      )) as WebFolder;
      const local = folders[folderObj.id];
      if (local && !local.__fromCloud) continue; // jamais écraser du local web
      // Ceinture last-write-wins : un dossier __fromCloud modifié localement
      // plus récemment que la version distante n'est pas rétrogradé.
      if (
        local?.updatedAt &&
        folderObj.updatedAt &&
        String(local.updatedAt) > String(folderObj.updatedAt)
      ) {
        continue;
      }
      folders[folderObj.id] = { ...folderObj, __fromCloud: true };
      foldersChanged = true;
      installed++;
    } catch (err) {
      failed++;
      console.warn(`[webSync] meta ${resourceId} ignoré :`, err);
    }
  }

  if (foldersChanged) {
    await store.put(FOLDERS_KEY, folders);
    emitWebEvent('folders-updated');
  }

  if (notesBlocked) _notesPushBlocked.add(profileId);
  else _notesPushBlocked.delete(profileId);

  if (layoutBlocked) _layoutPushBlocked.add(profileId);
  else _layoutPushBlocked.delete(profileId);

  if (!sawRemoteLayout) {
    // Le manifeste ingéré n'annonce AUCUNE mise en page : l'oublier fait que la
    // remontée refusera de pousser si le manifeste frais en porte une (publiée
    // entre les deux lectures — un état qu'on n'a jamais fusionné).
    _mergedLayoutChecksum.delete(profileId);
  }

  if (!sawRemoteNotes) {
    // Le manifeste ingéré n'annonce AUCUNE entrée notes : l'oublier fait que la
    // remontée refusera de pousser si le manifeste frais en porte une (publiée
    // entre les deux lectures — un état qu'on n'a jamais fusionné).
    _mergedNotesChecksum.delete(profileId);
    _mergedNotesRemoteIds.delete(profileId);
  }

  // Nuage sans `meta:notes` (profil neuf, ou notes jamais poussées) et store
  // local garni : rien dans la boucle n'aurait marqué la remontée, les notes du
  // navigateur resteraient prisonnières. UNE SEULE marque par profil et par
  // session : la reposer à chaque pull réveillait le scheduler en boucle (voir
  // _notesFallbackMarked), et elle survit de toute façon dans le registre tant
  // que le push n'a pas abouti.
  if (
    !sawRemoteNotes &&
    !_notesFallbackMarked.has(profileId) &&
    (await notesPushAllowed(profileId)) &&
    (await store.get<Uint8Array>(NOTES_KEY))
  ) {
    _notesFallbackMarked.add(profileId);
    await markNotesPending(profileId);
  }
  return { installed, failed };
}

/** Le registre pending appartient au profil ACTIF : ne jamais salir un autre. */
async function markNotesPending(profileId: string): Promise<void> {
  if ((await getActiveProfileId()) !== profileId) return;
  await markPendingUpload(NOTES_META_FILE_ID, {
    kind: 'meta',
    folderId: NOTES_META_RESOURCE_ID,
  }).catch(() => {});
}

/** Base d'ancêtres du profil, ou `null` si elle n'a jamais été établie. */
async function readNotesBase(
  store: ReturnType<typeof forProfile>
): Promise<StoredNotesBase | null> {
  const raw = await store.get<StoredNotesBase>(NOTES_BASE_KEY).catch(() => null);
  if (!raw || typeof raw !== 'object' || !raw.clocks) return null;
  // La table DISTANTE n'est reprise que si elle est complète : une base écrite
  // par une version antérieure n'en a pas, et `selectGenuineConflicts` retombe
  // alors sur la comparaison à l'union — plus stricte, jamais bavarde.
  const remote = raw.clocks.remote;
  return {
    agreedAt: typeof raw.agreedAt === 'number' ? raw.agreedAt : null,
    clocks: {
      notes: raw.clocks.notes ?? {},
      notebooks: raw.clocks.notebooks ?? {},
      ...(remote && typeof remote === 'object'
        ? { remote: { notes: remote.notes ?? {}, notebooks: remote.notebooks ?? {} } }
        : {}),
    },
  };
}

/**
 * Réécrit la base — sans rien faire quand elle n'a pas bougé (elle est relue à
 * chaque cycle, l'écrire pour rien coûterait un accès IndexedDB toutes les
 * 10 s). Un échec n'est jamais fatal : une base perdue ne coûte qu'un cycle
 * prudent (aucune copie de conflit fabriquée), jamais une note.
 */
async function writeNotesBase(
  store: ReturnType<typeof forProfile>,
  next: StoredNotesBase,
  previous: StoredNotesBase | null
): Promise<void> {
  if (previous && deepEqual(next, previous)) return;
  await store.put(NOTES_BASE_KEY, next).catch((err) => {
    console.warn('[webSync] base de fusion des notes non enregistrée :', err);
  });
}

// ── Copies de conflit : durables avant d'être remontées ─────────────────────

/**
 * Copies de conflit FABRIQUÉES mais dont on n'a pas encore la preuve qu'elles
 * ont quitté ce navigateur.
 *
 * LE DANGER. Une copie n'existe que dans `notes_enc` tant qu'elle n'est pas
 * poussée. Or le renderer reconstruit le payload ENTIER depuis Redux à chaque
 * auto-sauvegarde : s'il n'a pas encore rechargé (le `notes-updated` de la
 * fusion voyage, mais la frappe en cours peut le devancer), sa sauvegarde
 * suivante écrase le blob SANS la copie. Et elle ne sera pas refabriquée : la
 * base d'ancêtres, elle, a déjà été mise à jour — le cycle suivant ne voit plus
 * aucune divergence. La seule version perdante de cette note disparaît alors
 * définitivement, ce qui est exactement la perte que la copie existe pour
 * empêcher.
 *
 * LE REMÈDE. Ce registre survit à l'écrasement (autre clé du store) et
 * `buildNotesContainer` RÉINJECTE ce qui manque juste avant l'envoi, sous le
 * verrou des notes. Il n'est vidé qu'une fois la remontée acquittée. Chiffré
 * comme le blob de notes : il porte du contenu de note.
 */
const NOTES_CONFLICT_PENDING_KEY = 'notes_conflict_pending';

interface PendingConflictCopies {
  notes: Record<string, unknown>;
  notebooks: Record<string, unknown>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

async function readPendingConflictCopies(
  store: ReturnType<typeof forProfile>
): Promise<PendingConflictCopies> {
  const empty: PendingConflictCopies = { notes: {}, notebooks: {} };
  try {
    const sealed = await store.get<Uint8Array>(NOTES_CONFLICT_PENDING_KEY);
    if (!sealed) return empty;
    const plain = await decryptFileContent(new Uint8Array(sealed));
    const parsed = JSON.parse(new TextDecoder().decode(plain)) as PendingConflictCopies;
    return {
      notes: isRecord(parsed?.notes) ? parsed.notes : {},
      notebooks: isRecord(parsed?.notebooks) ? parsed.notebooks : {},
    };
  } catch (err) {
    console.warn('[webSync] registre des copies de conflit illisible :', err);
    return empty;
  }
}

async function writePendingConflictCopies(
  store: ReturnType<typeof forProfile>,
  value: PendingConflictCopies
): Promise<void> {
  try {
    if (Object.keys(value.notes).length === 0 && Object.keys(value.notebooks).length === 0) {
      await store.delete(NOTES_CONFLICT_PENDING_KEY);
      return;
    }
    const plain = new TextEncoder().encode(JSON.stringify(value));
    const sealed = await encryptFileContent(
      plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength) as ArrayBuffer
    );
    await store.put(NOTES_CONFLICT_PENDING_KEY, sealed);
  } catch (err) {
    console.warn('[webSync] copies de conflit non mises à l’abri :', err);
  }
}

/**
 * Les copies que `applyConflictCopies` vient de déposer — reconnaissables à leur
 * `conflictSavedAt`, qui porte l'horodatage EXACT qu'on lui a passé.
 */
function collectFreshConflictCopies(payload: NotesPayload, stamp: string): PendingConflictCopies {
  const out: PendingConflictCopies = { notes: {}, notebooks: {} };
  const take = (source: unknown, into: Record<string, unknown>): void => {
    if (!isRecord(source)) return;
    for (const [id, entry] of Object.entries(source)) {
      if (isRecord(entry) && entry.conflictSavedAt === stamp) into[id] = entry;
    }
  };
  take(payload.byId, out.notes);
  take(payload.notebooks, out.notebooks);
  return out;
}

/** Remet dans le payload les copies que quelqu'un a effacées. Rend le compte. */
function restoreMissingConflictCopies(
  payload: NotesPayload,
  pending: PendingConflictCopies
): number {
  let restored = 0;
  const put = (record: unknown, entries: Record<string, unknown>, index: boolean): void => {
    if (!isRecord(record)) return;
    for (const [id, entry] of Object.entries(entries)) {
      if (Object.prototype.hasOwnProperty.call(record, id)) continue;
      record[id] = entry;
      if (index && Array.isArray(payload.allIds)) (payload.allIds as unknown[]).push(id);
      restored++;
    }
  };
  put(payload.byId, pending.notes, true);
  put(payload.notebooks, pending.notebooks, false);
  return restored;
}

// ── Notes en session vivante, vues par le cycle ─────────────────────────────

/**
 * Instantané PARTAGÉ des notes en session vivante (store du profil).
 *
 * POURQUOI PARTAGÉ. `liveNoteRegistry` est une variable de MODULE : elle ne
 * connaît que son propre onglet. Or le cycle de synchronisation ne tourne que
 * chez le MENEUR, alors que la note peut très bien être ouverte dans un autre
 * onglet — qui partage le même IndexedDB, donc le même `notes_enc`. Le meneur
 * voyait alors « le local a bougé » (c'était la frappe du suiveur) face à « le
 * distant a bougé » (l'autre appareil), sans savoir qu'une session était en
 * cours : il fabriquait une copie de conflit à chaque cycle.
 */
const LIVE_NOTES_KEY = 'collab_live_notes';

/**
 * Péremption d'un instantané publié — miroir de `electron/sync/liveNotes.ts`,
 * confortablement au-dessus du battement de la session (45 s). Sans elle, un
 * onglet mort en cours d'édition gèlerait l'arbitrage de sa note pour toujours.
 */
const LIVE_NOTES_TTL_MS = 150_000;

interface StoredLiveNotes {
  ids: string[];
  /** Instant de publication (ms). */
  at: number;
}

/**
 * Publie l'instantané des sessions de CET onglet pour les autres (canal
 * `collab:setLiveNotes`). Meilleur effort : un échec ne coûte que la garde
 * inter-onglets, jamais une donnée.
 */
export async function publishLiveNotesSnapshot(noteIds: readonly string[]): Promise<void> {
  const profileId = await getActiveProfileId();
  if (!profileId) return;
  const ids = noteIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
  await forProfile(profileId)
    .put(LIVE_NOTES_KEY, { ids, at: Date.now() } satisfies StoredLiveNotes)
    .catch((err) => {
      console.warn('[webSync] notes en session non partagées avec les autres onglets :', err);
    });
}

/**
 * Prédicat « cette note est en session vivante », lu au moment de la fusion —
 * registre mémoire de CET onglet (voir `liveNoteRegistry`) UNION instantané
 * partagé des autres onglets, péremption comprise.
 */
async function liveNoteGuard(profileId: string): Promise<(noteId: string) => boolean> {
  let shared: ReadonlySet<string> = new Set();
  try {
    const raw = await forProfile(profileId).get<StoredLiveNotes>(LIVE_NOTES_KEY);
    if (raw && Array.isArray(raw.ids) && typeof raw.at === 'number') {
      if (Date.now() - raw.at <= LIVE_NOTES_TTL_MS) {
        shared = new Set(raw.ids.filter((id): id is string => typeof id === 'string'));
      }
    }
  } catch {
    /* dépôt illisible : le registre mémoire fait foi à lui seul */
  }
  return (noteId: string) => {
    try {
      if (isNoteLive(noteId)) return true;
    } catch {
      /* registre mémoire en vrac : l'instantané partagé reste consultable */
    }
    return shared.has(noteId);
  };
}

/**
 * Installe le payload de notes distant dans le store local — fusion note à
 * note quand un store existe déjà. Rend `true` si le local a été RÉÉCRIT.
 *
 * Trois décisions, toutes anti-boucle ou anti-perte :
 *  - on ne réécrit QUE si la fusion diffère du local (sinon le store passerait
 *    son temps à être « modifié » pour rien) ;
 *  - la remontée n'est marquée QUE si la fusion diffère du DISTANT (et que la
 *    remontée est autorisée, voir notesPushAllowed) : des nouveautés purement
 *    distantes ne doivent pas déclencher un push (boucle infinie), alors que du
 *    neuf local, lui, doit bien partir — une seule fois, puisque le cycle
 *    suivant trouvera distant et local identiques ;
 *  - `notes-updated` n'est émis que si la fusion apporte du CONTENU (une entrée
 *    de `byId` différente), un registre de purge différent OU une copie de
 *    conflit fraîchement fabriquée — le renderer reconstruit le payload depuis
 *    Redux à chaque sauvegarde, donc une copie qu'il n'a pas rechargée serait
 *    effacée du store à la sauvegarde suivante. Ce canal fait
 *    recharger tout le store du renderer depuis le disque : l'émettre pour une
 *    simple normalisation écrasait la frappe en cours pas encore passée par
 *    l'auto-save — mais le TAIRE quand des pierres tombales arrivent laisse le
 *    renderer les ignorer, et sa sauvegarde suivante (qui reconstruit le
 *    payload depuis Redux) les efface du disque.
 *
 * Toute la séquence lire → fusionner → écrire tient sous le verrou du store :
 * une sauvegarde du renderer qui s'y intercalerait serait effacée par l'écriture
 * de la fusion (et réciproquement).
 */
async function installNotes(profileId: string, remotePayload: NotesPayload): Promise<boolean> {
  const store = forProfile(profileId);

  // LU AVANT LE VERROU : le prédicat sert deux fois sous la section critique
  // (rétablissement des notes vivantes, puis exclusion des copies de conflit),
  // et il consulte le dépôt partagé des autres onglets.
  const isLive = await liveNoteGuard(profileId);

  const outcome = await withNotesLock(async () => {
    const existing = await store.get<Uint8Array>(NOTES_KEY);
    const priorBase = await readNotesBase(store);

    let payload: NotesPayload = remotePayload;
    let mustWrite = true;
    let mustPush = false;
    let conflictCopies = 0;
    /** Notes retenues parce qu'une session vivante les édite (arbitrage reporté). */
    let held: string[] = [];
    // Store local absent : tout ce qui arrive est du contenu neuf — sauf si le
    // distant est lui-même vide de notes ET de pierres, auquel cas il n'y a
    // rien à annoncer.
    let contentChanged =
      Object.keys((remotePayload?.byId as Record<string, unknown>) ?? {}).length > 0 ||
      Object.keys((remotePayload?.[PURGED_NOTES_KEY] as Record<string, unknown>) ?? {}).length >
        0 ||
      Object.keys((remotePayload?.[PURGED_NOTEBOOKS_KEY] as Record<string, unknown>) ?? {}).length >
        0;

    if (existing) {
      const localPlain = await decryptFileContent(new Uint8Array(existing));
      const localPayload = JSON.parse(new TextDecoder().decode(localPlain)) as NotesPayload;
      const {
        merged,
        changedFromLocal,
        changedFromRemote,
        remoteContentChanged,
        purgeRegistryChanged,
        overwritten,
      } = mergeNotesPayload(localPayload, remotePayload);
      payload = merged;
      mustWrite = changedFromLocal;
      mustPush = changedFromRemote;
      // Les pierres tombales comptent comme du contenu pour le renderer : sans
      // rechargement il les perdrait à sa prochaine sauvegarde.
      contentChanged = remoteContentChanged || purgeRegistryChanged;

      // GARDE DES SESSIONS VIVANTES. Une note en cours d'édition collaborative
      // ne peut pas être remplacée par le résultat de la fusion : son contenu
      // durable est produit par le CRDT, frappe après frappe.
      held = preserveLiveSessionNotes(localPayload, merged, isLive);
      if (held.length > 0) {
        // La fusion ne vaut plus ce qu'elle disait : on recompte.
        mustWrite = !deepEqual(merged, localPayload);
        // ET ON NE REMONTE PAS ce cycle-ci. Pousser notre version écraserait
        // dans le nuage la version distante qu'on vient justement de ne pas
        // arbitrer : elle doit y rester jusqu'à la fin de la session.
        mustPush = false;
        contentChanged = contentChanged && mustWrite;
      }

      // ARBITRAGE DESTRUCTEUR → COPIE. Là où le desktop fabrique un
      // `_conflict_<horodatage>` pour un fichier ordinaire, on fabrique une
      // note : le contenu que l'horloge vient d'écarter ne peut pas partir sans
      // laisser de trace.
      const stamp = new Date().toISOString();
      conflictCopies = applyConflictCopies(
        merged,
        selectGenuineConflicts(
          // Une note VIVANTE n'a rien perdu : son arbitrage est reporté, pas
          // tranché. Le filtre porte sur la LIVEUR, jamais sur `held` — cette
          // liste-là ne contient que les notes qu'il a fallu rétablir, donc
          // elle est vide quand l'arbitrage a déjà donné le local gagnant, ce
          // qui est le cas le plus courant en session (chaque appareil réécrit
          // la note toutes les 2 s). Filtrer sur `held` fabriquait une copie
          // par cycle pendant toute la session.
          dropLiveSessionConflicts(overwritten, isLive),
          merged,
          priorBase?.clocks ?? null,
          priorBase?.agreedAt ?? null
        ),
        {
          now: stamp,
          newId: () => crypto.randomUUID(),
          device: 'web',
          // Une copie de conflit est une COPIE : ses bases de données inline
          // reçoivent une identité neuve, sinon la note d'origine et la copie
          // portent les mêmes et une relation qui vise l'une lit l'autre.
          restampContent: restampCopiedDbIds,
        }
      );
      if (conflictCopies > 0) {
        mustWrite = true;
        // La copie doit atteindre les autres appareils — mais pas au prix de
        // l'écrasement d'une version distante retenue : dans ce cas elle attend
        // le cycle suivant, à l'abri dans le registre des copies en attente.
        mustPush = held.length === 0;
        contentChanged = true;
        // MISE À L'ABRI AVANT DE RENDRE LA MAIN : à partir d'ici, une
        // auto-sauvegarde du renderer peut écraser le blob sans les copies. Le
        // registre survit à cet écrasement, et la remontée les réinjectera.
        const fresh = collectFreshConflictCopies(merged, stamp);
        const already = await readPendingConflictCopies(store);
        await writePendingConflictCopies(store, {
          notes: { ...already.notes, ...fresh.notes },
          notebooks: { ...already.notebooks, ...fresh.notebooks },
        });
      }
    }

    if (mustWrite) {
      const plain = new TextEncoder().encode(JSON.stringify(payload));
      const reEncrypted = await encryptFileContent(
        plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength) as ArrayBuffer
      );
      await store.put(NOTES_KEY, reEncrypted);
      // L'empreinte du clair suit l'écriture : sans elle, le renderer qui
      // recharge puis ré-enregistre cette même fusion passerait pour un
      // modificateur et relancerait une remontée (voir notesDigest).
      await store.put(NOTES_DIGEST_KEY, await notesPlainDigest(plain));
    }

    // La fusion qu'on vient d'arrêter devient l'ancêtre du prochain cycle —
    // DEUX tables : ce que nous gardons, et ce que le nuage servait à l'instant
    // de cette fusion. Confondre les deux faisait avancer l'ancêtre du distant
    // sur nos écritures locales dès qu'un cycle fusionnait sans remonter, et le
    // cycle d'après prenait le nuage RESTÉ EN ARRIÈRE pour un nuage qui a écrit :
    // copie de conflit d'une note que personne d'autre n'avait touchée.
    // `agreedAt` n'avance QUE si rien ne reste à pousser : sinon on prétendrait
    // que le nuage porte déjà des notes qu'il n'a jamais vues, et la divergence
    // suivante passerait pour un simple rattrapage. Une note RETENUE compte
    // comme un désaccord : local et distant diffèrent toujours.
    await writeNotesBase(
      store,
      {
        agreedAt: mustPush || held.length > 0 ? (priorBase?.agreedAt ?? null) : Date.now(),
        clocks: collectMergeBase(payload, remotePayload),
      },
      priorBase
    );
    return { mustWrite, mustPush, contentChanged, conflictCopies, held: held.length };
  });

  if (outcome.conflictCopies > 0) {
    console.info(
      `[webSync] ${outcome.conflictCopies} version(s) écrasée(s) conservée(s) en copie de conflit`
    );
  }
  if (outcome.held > 0) {
    console.info(
      `[webSync] ${outcome.held} note(s) en session vivante — arbitrage reporté au prochain cycle`
    );
  }
  // Le renderer réagit déjà à ce canal (electronMiddleware:144 → rechargement
  // depuis le disque) : rien à toucher côté renderer.
  if (outcome.mustWrite && outcome.contentChanged) emitWebEvent('notes-updated');
  if (outcome.mustPush && (await notesPushAllowed(profileId))) await markNotesPending(profileId);
  return outcome.mustWrite;
}

// ── Mise en page : la face web de `layout.enc` ──────────────────────────────
//
// LE CONTENEUR EST LISIBLE ICI, ET SOUS EXACTEMENT LA MÊME POLITIQUE DE CLÉ QUE
// `notes.enc`. C'était la question à trancher avant d'écrire une ligne : le
// bureau scelle `layout.enc` sous la CLÉ MACHINE DU PROFIL, que le navigateur
// ne détient pas. Mais il ne la détient pas non plus pour `notes.enc` ni pour
// les `metadata.json`, et il les lit pourtant depuis le palier M3 : la clé
// machine voyage DANS LE MANIFESTE (`manifest.encryptionKey`, base64), lui-même
// scellé sous la FEK. On emprunte donc le chemin déjà éprouvé —
// `decryptMachineContainerText(texte, machineKey)` — sans inventer une seconde
// politique de clé. Aucune clé nouvelle, aucun secret supplémentaire exposé.

/**
 * Verrou d'exclusion du DOCUMENT DE MISE EN PAGE — deux étages, exactement comme
 * `notesLock` (voir son en-tête pour le raisonnement complet) : une chaîne de
 * promesses pour cet onglet, un Web Lock nommé pour les autres.
 *
 * Trois chemins font lire-modifier-écrire sur la même clé : la fusion du cycle
 * (`installLayout`), l'écriture du renderer (`layout:save`) et l'amorçage
 * (`layout:load`). Sans exclusion, une sauvegarde intercalée entre la lecture et
 * l'écriture de la fusion est écrasée par cette dernière — et réciproquement.
 *
 * ⚠ Ne JAMAIS imbriquer un `withLayoutLock` dans un autre : la file est
 * strictement séquentielle. `readLocalLayout`/`writeLocalLayout` ne le prennent
 * donc PAS eux-mêmes ; c'est l'appelant qui tient la section critique.
 */
const LAYOUT_LOCK_NAME = 'filarr-layout';

let _layoutChain: Promise<unknown> = Promise.resolve();

export function withLayoutLock<T>(task: () => Promise<T>): Promise<T> {
  const guarded = (): Promise<T> => {
    const locks =
      typeof navigator !== 'undefined'
        ? (navigator as Navigator & { locks?: LockManager }).locks
        : undefined;
    if (!locks || typeof locks.request !== 'function') return task();
    return locks.request(LAYOUT_LOCK_NAME, () => task()) as Promise<T>;
  };
  const run = _layoutChain.then(guarded, guarded);
  _layoutChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Le document de ce profil, ou `null` s'il n'y en a pas encore. Un dépôt
 * illisible (JSON abîmé, forme inattendue) vaut `null` : la normalisation est
 * tolérante, et ce qu'elle ne sait pas relire ne désigne rien qu'on puisse
 * afficher. À l'inverse d'un `layout.enc` de bureau, il n'y a pas ici de « clé
 * indisponible » à distinguer de « absent » — le dépôt est en clair.
 */
export async function readLocalLayout(profileId: string): Promise<LayoutDocument | null> {
  const raw = await forProfile(profileId)
    .get<unknown>(LAYOUT_KEY)
    .catch(() => null);
  if (raw === null || raw === undefined) return null;
  return normalizeLayoutDocument(raw);
}

/**
 * Scelle — enfin, DÉPOSE — le document. Même traitement que
 * `writeLayoutDocument` côté bureau, et il compte : normalisation, purge des
 * dispositions perdantes expirées, `updatedAt` du conteneur redaté. Deux côtés
 * qui n'appliqueraient pas la même préparation produiraient deux documents
 * différents à partir du même geste, donc une divergence à chaque cycle.
 */
export async function writeLocalLayout(
  profileId: string,
  document: LayoutDocument,
  now: { iso: string; ms: number } = { iso: new Date().toISOString(), ms: Date.now() }
): Promise<LayoutDocument> {
  const doc = normalizeLayoutDocument(document);
  pruneDocumentSuperseded(doc, now.ms);
  doc.updatedAt = now.iso;
  await forProfile(profileId).put(LAYOUT_KEY, doc);
  return doc;
}

/**
 * Le registre pending appartient au profil ACTIF : ne jamais salir un autre.
 * Exporté pour `layout:save` et pour l'amorçage, qui doivent l'un et l'autre
 * faire partir ce qu'ils viennent d'écrire.
 */
export async function markLayoutPending(profileId: string): Promise<void> {
  if ((await getActiveProfileId()) !== profileId) return;
  await markPendingUpload(LAYOUT_META_FILE_ID, {
    kind: 'meta',
    folderId: LAYOUT_META_RESOURCE_ID,
  }).catch(() => {});
}

/**
 * Le nuage porte-t-il DÉJÀ une mise en page pour ce profil ? — garde
 * anti-double-amorçage, miroir de `syncService.cloudCarriesLayout`.
 *
 * Réponse d'après le manifeste connu (mémoire, puis dépôt partagé entre
 * onglets). Un « non » par ignorance (aucun cycle encore joué) ne détruit rien :
 * une vue amorcée porte `LAYOUT_SEED_CLOCK`, donc elle PERD contre n'importe
 * quelle disposition réelle à la première fusion, et la garde de fraîcheur de la
 * remontée l'empêche de partir avant que le distant ait été lu.
 */
export async function cloudCarriesLayout(profileId: string): Promise<boolean> {
  const manifest =
    _manifestCache?.profileId === profileId
      ? _manifestCache.manifest
      : await readStoredManifest(profileId).catch(() => null);
  const entry = manifest?.files?.[LAYOUT_META_FILE_ID];
  return !!entry && entry.status !== 'deleted';
}

/**
 * Installe le document distant — FUSIONNÉ au grain de la VUE avec ce que ce
 * navigateur porte déjà (`layoutMerge`, copie parité-testée du moteur du
 * bureau). Rend `true` si le dépôt local a été réécrit.
 *
 * Les deux drapeaux de la fusion pilotent la suite, et pas autre chose :
 *  - `changedFromLocal` → on réécrit, et on prévient le renderer
 *    (`layout-updated`), qui relit son document depuis le dépôt ;
 *  - `changedFromRemote` → ce navigateur porte du neuf que le nuage n'a pas :
 *    on marque la remontée. Sans cette condition, une nouveauté purement
 *    distante déclencherait un push, donc un cycle, donc un push : une boucle.
 */
async function installLayout(profileId: string, remoteDoc: LayoutDocument): Promise<boolean> {
  const outcome = await withLayoutLock(async () => {
    const local = await readLocalLayout(profileId);
    const { merged, changedFromLocal, changedFromRemote, conflicts } = mergeLayoutDocuments(
      local ?? createEmptyLayoutDocument(),
      remoteDoc
    );
    if (changedFromLocal) await writeLocalLayout(profileId, merged);
    return { changedFromLocal, changedFromRemote, conflicts };
  });
  if (outcome.conflicts.length > 0) {
    // La perdante n'est pas perdue : elle est dans `superseded` (30 jours), et
    // l'interface sait la reproposer. On le DIT, parce qu'une disposition qui
    // change toute seule sans un mot est exactement ce qui fait croire à un bug.
    console.info(
      `[webSync] mise en page arbitrée sur ${outcome.conflicts.length} vue(s) — ` +
        'la disposition écartée est conservée'
    );
  }
  if (outcome.changedFromLocal) emitWebEvent('layout-updated');
  if (outcome.changedFromRemote) await markLayoutPending(profileId);
  return outcome.changedFromLocal;
}

// ── Restauration des profils cloud (miroir syncService.ts:790-812) ──────────

interface ProfilesManifest {
  version: 1;
  activeProfileId: string | null;
  profiles: Array<Record<string, unknown> & { id: string }>;
  maxProfiles: number;
  migratedFromLegacy: boolean;
}

/**
 * Profils nuage que la clé COURANTE ne déchiffre pas — typiquement antérieurs
 * à un changement de mot de passe, ou résidus d une ère précédente. Sans cette
 * mémoire, chaque cycle retélécharge leur manifeste pour échouer pareil, et
 * crie une erreur qui n en est pas une.
 */
const _unreadableProfiles = new Set<string>();

/**
 * Une NOUVELLE clé vient d'être installée en session : les profils écartés avec
 * la précédente méritent un nouvel essai. Sans cela, la bonne clé arrivait
 * (déverrouillage, reconnexion) et les profils restaient « ignorés pour la
 * session » — exactement le silence constaté en prod le 2026-08-28.
 */
export function resetUnreadableProfiles(): void {
  _unreadableProfiles.clear();
}

export function getUnreadableProfileIds(): string[] {
  return [..._unreadableProfiles];
}

export interface AccountProfilesOutcome {
  /** Profils AJOUTÉS au manifeste local par ce passage. */
  restored: number;
  /**
   * TOUS les profils du compte présents en local après ce passage — restaurés
   * ET déjà connus. Le bureau rend la même chose ; l'appelant partagé
   * (`accountProfiles.profilesOfAccount`) en fait l'union avec l'estampille.
   */
  profileIds: string[];
  /** Profils du compte que la clé COURANTE ne déchiffre pas. */
  unreadable: string[];
}

export async function restoreAccountProfiles(): Promise<AccountProfilesOutcome> {
  const listing = await apiFetch<{
    data?: { profiles?: Array<{ profileId: string; manifestVersion: number }> };
  }>('/sync/profiles', { signal: deadline(CONTROL_TIMEOUT_MS) });
  // « Liste injoignable » n'est pas « aucun profil » : rendre zéro ici
  // enverrait l'onboarding créer un doublon vide alors que les vrais profils
  // existent côté serveur.
  if (listing.status !== 200 || !listing.body?.success) {
    throw new Error(`sync/profiles: HTTP ${listing.status}`);
  }
  const cloudProfiles = listing.body.data?.profiles ?? [];
  const outcome = (restored: number, profileIds: string[]): AccountProfilesOutcome => ({
    restored,
    profileIds,
    unreadable: cloudProfiles
      .filter((cp) => _unreadableProfiles.has(cp.profileId))
      .map((cp) => cp.profileId),
  });
  if (cloudProfiles.length === 0) return outcome(0, []);

  // Lecture HORS verrou pour le travail réseau ; l'écriture, plus bas, relit
  // le manifeste SOUS le verrou des profils et y applique ce qui a été décidé —
  // une activation faite pendant le téléchargement n'est pas écrasée.
  const local = (await idbGet<ProfilesManifest>('profiles_manifest')) ?? {
    version: 1 as const,
    activeProfileId: null,
    profiles: [],
    maxProfiles: 10,
    migratedFromLegacy: true,
  };
  const localById = new Map(local.profiles.map((p) => [p.id, p]));
  const profileIds: string[] = [];
  /** Profils à ajouter au manifeste (déchiffrés, prêts). */
  const additions: Array<Record<string, unknown> & { id: string }> = [];
  /** Profils déjà là dont l'estampille doit être (re)posée. */
  const restamp = new Set<string>();
  let restored = 0;

  /**
   * LE COMPTE AUQUEL CES PROFILS APPARTIENNENT — un constat, pas une devinette :
   * `/sync/profiles` est portée au `user_id` du jeton, donc tout ce qu'elle rend
   * appartient au compte connecté. Sans cette estampille, `ProfilePicker` range
   * le profil restauré sous « Local » plutôt que sous l'adresse du compte.
   */
  const { getSessionUser } = await import('../handlers/authHandlers');
  const u = getSessionUser();
  const compte = u
    ? {
        email: u.email,
        tier: u.subscriptionTier,
        linkedAt: new Date().toISOString(),
        accountType: u.accountType,
      }
    : null;

  for (const cp of cloudProfiles) {
    if (cp.manifestVersion === 0) continue;
    const known = localById.get(cp.profileId);
    if (known) {
      profileIds.push(cp.profileId);
      /**
       * L'ESTAMPILLE À CHAQUE PASSAGE, y compris sur un profil déjà là — comme
       * le bureau (pairingService). Le web sortait ici AVANT d'estampiller : un
       * profil restauré avant l'existence de l'estampille, ou né dans le
       * navigateur puis rattaché au compte, restait « Local » pour toujours.
       * `/sync/profiles` est portée au jeton : ce profil appartient au compte
       * connecté, par construction.
       */
      if (compte) {
        const current = (known.cloudAccount as { email?: string } | null | undefined)?.email;
        if (!current) {
          restamp.add(cp.profileId);
        } else if (current.trim().toLowerCase() !== compte.email.trim().toLowerCase()) {
          // Le même identifiant est listé sous DEUX comptes (poussé sous l'un
          // par une session d'avant, rattaché à l'autre ici). On ne retourne
          // pas l'appartenance d'un profil sur la foi d'une liste distante —
          // c'est l'estampille locale qui route sa clé.
          console.warn(
            `[webSync] profil ${cp.profileId} listé sous ${compte.email} mais rattaché à ${current} — appartenance conservée`
          );
          profileIds.pop();
        }
      }
      continue;
    }
    if (_unreadableProfiles.has(cp.profileId)) continue;
    try {
      const { manifest } = await fetchManifestRaw(cp.profileId);
      const meta = manifest?.profileMeta;
      if (!meta) continue;
      additions.push({
        ...meta,
        id: cp.profileId,
        pinAttempts: 0,
        isDefault: false,
        lastAccessedAt: new Date().toISOString(),
        ...(compte ? { cloudAccount: compte } : {}),
      });
      restored++;
      profileIds.push(cp.profileId);
    } catch (err) {
      // OperationError = le conteneur ne se déchiffre pas avec la clé courante :
      // inutile d'insister à chaque cycle — jusqu'à la PROCHAINE clé
      // (resetUnreadableProfiles, appelé à chaque installation de FEK).
      const undecryptable = err instanceof Error && err.name === 'OperationError';
      if (undecryptable) _unreadableProfiles.add(cp.profileId);
      console.warn(
        `[webSync] profil nuage ${cp.profileId} ${undecryptable ? 'illisible avec la clé actuelle — la FEK de ce navigateur n’est pas celle qui a chiffré ce profil (ignoré jusqu’à la prochaine clé)' : 'non restauré'} :`,
        err
      );
    }
  }

  if (additions.length > 0 || restamp.size > 0) {
    const { withManifestLock } = await import('../handlers/profileHandlers');
    await withManifestLock(async () => {
      const fresh = (await idbGet<ProfilesManifest>('profiles_manifest')) ?? local;
      const present = new Set(fresh.profiles.map((p) => p.id));
      let changed = false;
      for (const id of restamp) {
        const p = fresh.profiles.find((x) => x.id === id);
        if (p && compte) {
          p.cloudAccount = compte;
          changed = true;
        }
      }
      for (const add of additions) {
        if (present.has(add.id)) continue;
        fresh.profiles.push({ ...add, order: fresh.profiles.length });
        changed = true;
      }
      if (changed) {
        await idbPut('profiles_manifest', fresh);
        emitWebEvent('profiles-updated');
      }
    });
  }
  return outcome(restored, profileIds);
}

/** Le compteur seul — ce que le cycle de sync rapporte. */
export async function restoreCloudProfiles(): Promise<number> {
  return (await restoreAccountProfiles()).restored;
}

// ── Remontée (append-only overlay + CAS) ────────────────────────────────────

async function buildLocalProfileMeta(profileId: string): Promise<SyncProfileMeta | undefined> {
  const local = await idbGet<ProfilesManifest>('profiles_manifest');
  const p = local?.profiles.find((x) => x.id === profileId);
  if (!p) return undefined;
  const {
    id,
    name,
    avatarColor,
    avatarEmoji,
    avatarImage,
    isDefault,
    order,
    createdAt,
    pinHash,
    pinSalt,
    allowPinReset,
    pinUpdatedAt,
  } = p as Record<string, unknown> & SyncProfileMeta;
  return {
    id,
    name,
    avatarColor,
    avatarEmoji,
    avatarImage,
    isDefault,
    order,
    createdAt,
    pinHash,
    pinSalt,
    allowPinReset,
    pinUpdatedAt,
  } as SyncProfileMeta;
}

/**
 * Dernier écrivain gagne sur l'horloge PIN — MÊME règle que
 * profileManager.applyCloudPinUpdate (electron/profileManager.ts:521-559) : le
 * nuage ne l'emporte que s'il est STRICTEMENT plus récent. Figer le
 * `profileMeta` distant (ce que faisait ce push) rendait inerte tout
 * changement local de PIN ou d'autorisation de réinitialisation.
 */
function freshestProfileMeta(
  local?: SyncProfileMeta,
  cloud?: SyncProfileMeta
): SyncProfileMeta | undefined {
  if (!local) return cloud;
  if (!cloud) return local;
  const clock = (m: SyncProfileMeta): number => {
    const raw = m.pinUpdatedAt;
    const ms = typeof raw === 'string' ? new Date(raw).getTime() : NaN;
    return Number.isNaN(ms) ? -Infinity : ms;
  };
  return clock(cloud) > clock(local) ? cloud : local;
}

/**
 * Un store local sans notes est-il une SUPPRESSION VOULUE plutôt qu'une perte ?
 *
 * Oui si le registre `purged` du payload réclame nommément tous les ids que le
 * `meta:notes` distant fusionné ce cycle portait : chacun a été définitivement
 * supprimé ici, la vacuité est le résultat attendu. Non si le distant n'a PAS
 * été fusionné (ids inconnus) — dans le doute on ne pousse pas.
 */
function isDeliberateEmptying(profileId: string, payload: NotesPayload): boolean {
  const remoteIds = _mergedNotesRemoteIds.get(profileId);
  if (!remoteIds || remoteIds.size === 0) return false;
  const purged = payload[PURGED_NOTES_KEY];
  if (!purged || typeof purged !== 'object') return false;
  const registry = purged as Record<string, unknown>;
  for (const id of remoteIds) {
    if (typeof registry[id] !== 'string') return false;
  }
  return true;
}

/**
 * Blob local `notes_enc` (chiffré FEK) → conteneur clé machine `v2:` prêt pour
 * `meta:notes`, exactement le format que le desktop écrit dans notes.enc et que
 * `installMetadata` sait relire. Rend `null` quand il n'y a rien à pousser.
 *
 * GARDE ANTI-EFFACEMENT, miroir de celle du desktop (main.ts:6332-6348) et de
 * `notes:save` côté web : un payload local SANS aucune note ne remplace jamais
 * un `meta:notes` distant conséquent. Une suppression réelle voyage en
 * tombstones (`deletedAt`), pas en store vide — un store vide face à un nuage
 * garni signale une anomalie locale, et on préfère ne rien pousser.
 *
 * EXCEPTION : l'utilisateur qui vide VRAIMENT ses notes (suppressions
 * définitives) produit lui aussi un store sans notes. La garde le distingue de
 * l'anomalie par les pierres tombales : si le registre `purged` couvre tous les
 * ids que le `meta:notes` distant FUSIONNÉ ce cycle contenait, la vacuité est
 * une décision, pas une perte — et la refuser condamnerait les purges à ne
 * jamais quitter le navigateur.
 */
async function buildNotesContainer(
  profileId: string,
  store: ReturnType<typeof forProfile>,
  machineKey: Uint8Array,
  remoteEntry: SyncFileEntry | undefined
): Promise<{
  bytes: Uint8Array;
  base: StoredNotesBase;
  conflictIds: PendingConflictCopies;
  restored: number;
} | null> {
  // Instant PRIS AVANT la lecture : une sauvegarde qui s'intercalerait ensuite
  // porte une horloge postérieure, donc restera vue comme « pas encore d'accord
  // avec le nuage » — le sens prudent.
  const readAt = Date.now();
  const pendingCopies = await readPendingConflictCopies(store);
  // Lecture sous le verrou : sans lui, ce qui part pouvait être un état
  // intermédiaire d'une fusion en cours d'écriture. La RÉINJECTION des copies de
  // conflit tient dans la même section critique : entre la relecture du blob et
  // ce qui part sur le câble, aucune sauvegarde ne peut les reperdre.
  const outcome = await withNotesLock(async () => {
    const encrypted = await store.get<Uint8Array>(NOTES_KEY);
    if (!encrypted) return null;
    const plain = await decryptFileContent(new Uint8Array(encrypted));
    const parsed = JSON.parse(new TextDecoder().decode(plain)) as NotesPayload;
    const restored = restoreMissingConflictCopies(parsed, pendingCopies);
    if (restored > 0) {
      // Le blob local les avait perdues : les y remettre, sinon le prochain
      // cycle repartirait du même état amputé.
      console.warn(
        `[webSync] ${restored} copie(s) de conflit réinjectée(s) : une sauvegarde du renderer ` +
          "les avait effacées avant qu'elles n'atteignent le nuage"
      );
      const restoredPlain = new TextEncoder().encode(JSON.stringify(parsed));
      await store.put(
        NOTES_KEY,
        await encryptFileContent(
          restoredPlain.buffer.slice(
            restoredPlain.byteOffset,
            restoredPlain.byteOffset + restoredPlain.byteLength
          ) as ArrayBuffer
        )
      );
      await store.put(NOTES_DIGEST_KEY, await notesPlainDigest(restoredPlain));
    }
    return { payload: parsed, restored };
  });
  if (!outcome) return null;
  const { payload, restored } = outcome;

  const byId = payload && typeof payload === 'object' ? payload.byId : null;
  const noteCount = byId && typeof byId === 'object' ? Object.keys(byId).length : 0;
  const remoteIsSubstantial =
    !!remoteEntry && remoteEntry.status !== 'deleted' && remoteEntry.size > 200;
  if (noteCount === 0 && remoteIsSubstantial && !isDeliberateEmptying(profileId, payload)) {
    console.warn(
      '[webSync] remontée des notes refusée : store local vide face à un notes.enc distant garni'
    );
    return null;
  }

  // Ce que le conteneur qui part porte RÉELLEMENT : c'est cette liste-là, et
  // pas le registre entier, qui sera acquittée une fois le CAS passé.
  const present = (record: unknown, entries: Record<string, unknown>): Record<string, unknown> => {
    const kept: Record<string, unknown> = {};
    if (!isRecord(record)) return kept;
    for (const id of Object.keys(entries)) {
      if (Object.prototype.hasOwnProperty.call(record, id)) kept[id] = entries[id];
    }
    return kept;
  };

  return {
    bytes: new TextEncoder().encode(await encryptMachineContainerText(payload, machineKey)),
    // Une fois le CAS passé, le nuage porte EXACTEMENT ces octets : les deux
    // tables de l'ancêtre se confondent, et le cycle suivant ne peut pas prendre
    // notre propre remontée pour une écriture venue d'ailleurs.
    base: { agreedAt: readAt, clocks: collectMergeBase(payload, payload) },
    conflictIds: {
      notes: present(payload.byId, pendingCopies.notes),
      notebooks: present(payload.notebooks, pendingCopies.notebooks),
    },
    restored,
  };
}

/**
 * Chemin relatif que le desktop attend pour cette entrée — exactement ce que
 * son propre scan inscrit (syncService.ts:1573 pour `notes.enc`, :1606 pour
 * `{folderId}/metadata.json`, :1636 pour un fichier). Sans lui, le desktop
 * télécharge l'entrée et n'a nulle part où l'écrire.
 */
function expectedLocalPath(fileId: string, entry: PendingEntry): string | undefined {
  if (fileId === NOTES_META_FILE_ID) return 'notes.enc';
  // `layout.enc`, à la racine du répertoire de profil — c'est là que le bureau
  // écrit ce qu'il télécharge (`downloadAndMergeLayout`), et le seul endroit où
  // il saura le relire.
  if (fileId === LAYOUT_META_FILE_ID) return LAYOUT_BLOB_FILENAME;
  if (entry.kind === 'blob' && entry.folderId && entry.fileName) {
    return `${entry.folderId}/${entry.fileName}`;
  }
  if (entry.kind === 'meta' && entry.folderId) return `${entry.folderId}/metadata.json`;
  return undefined;
}

async function pushToCloud(profileId: string, attempt = 0): Promise<number> {
  const active = await getActiveProfileId();
  if (active !== profileId) return 0; // le registre pending est celui du profil actif
  const pending: PendingMap = await getPendingUploads();
  const pendingIds = Object.keys(pending);
  if (pendingIds.length === 0) return 0;

  const fekRaw = await fekRawOrThrow();
  const store = forProfile(profileId);
  const { manifest: remote, version: remoteVersion } = await fetchManifestRaw(profileId);

  const base: CloudManifest = remote ?? {
    version: 0,
    profileId,
    lastSyncAt: new Date().toISOString(),
    files: {},
    notes: {},
  };
  let machineKeyB64 = base.encryptionKey;
  if (!machineKeyB64) {
    // Profil né sur le web : générer sa clé machine pour que le desktop puisse
    // relire les métadonnées (même rôle que encryption.key du desktop).
    machineKeyB64 = bytesToB64(crypto.getRandomValues(new Uint8Array(32)));
  }
  const machineKey = b64ToBytes(machineKeyB64);

  // Le manifeste vient d'être relu : c'est le moment de savoir si un desktop à
  // jour sert ce profil (un 304 ne rend pas de manifeste et ne dit donc rien).
  if (remote) await recordNotesMergeCapability(profileId, remote);
  else {
    // Aucun manifeste côté serveur : il n'y a rien qu'on aurait pu manquer, et
    // garder une empreinte d'un manifeste disparu bloquerait la remontée pour
    // toujours (plus aucun pull ne viendrait la rafraîchir).
    _mergedNotesChecksum.delete(profileId);
    _mergedNotesRemoteIds.delete(profileId);
  }

  const folders = (await store.get<Record<string, WebFolder>>(FOLDERS_KEY)) ?? {};
  const overlay: Record<string, SyncFileEntry> = {};
  // Acquittements : l'id ET la marque LUE AU DÉBUT du push. Une entrée
  // remarquée pendant l'upload garde sa nouvelle marque (voir clearPendingUploads).
  const done: PendingAck[] = [];
  const ack = (fileId: string, entry: PendingEntry): void => {
    done.push({ fileId, markedAt: entry.markedAt });
  };
  /** Empreinte de `meta:notes` telle que NOUS venons de l'écrire — voir plus bas. */
  let pushedNotesChecksum: string | null = null;
  /** Ancêtre correspondant : le nuage porte cet état-là dès que le CAS passe. */
  let pushedNotesBase: StoredNotesBase | null = null;
  /** Copies de conflit réellement embarquées : acquittées après le CAS seulement. */
  let pushedConflictCopies: PendingConflictCopies | null = null;
  /** Des copies ont dû être réinjectées : le renderer doit les recharger. */
  let restoredConflictCopies = 0;
  /** Empreinte de `meta:layout` telle que NOUS venons de l'écrire. */
  let pushedLayoutChecksum: string | null = null;

  for (const fileId of pendingIds) {
    const p = pending[fileId];
    try {
      // Suppression : on ne retire JAMAIS l'entrée du manifeste — on bascule
      // son statut à 'deleted'. C'est une TRACE, pas une purge : le desktop
      // saute les entrées distantes supprimées (mergeWithRemote:351) et ne
      // purge R2 que d'après son propre manifeste (syncService:605). Entrée
      // inconnue du distant : rien à propager.
      if (p.kind === 'delete') {
        const remoteEntry = base.files[fileId];
        if (remoteEntry && remoteEntry.status !== 'deleted') {
          overlay[fileId] = {
            ...remoteEntry,
            status: 'deleted',
            updatedAt: p.markedAt ?? new Date().toISOString(),
            syncedAt: new Date().toISOString(),
          };
        }
        ack(fileId, p);
        continue;
      }
      let bytes: Uint8Array | null = null;
      if (p.kind === 'meta' && fileId === NOTES_META_FILE_ID) {
        // GARDE D'ACTIVATION : sans marqueur de capacité distant, on ne pousse
        // pas et on ne retire pas la marque — elle repartira quand un desktop à
        // jour aura synchronisé ce profil.
        if (!(await notesPushAllowed(profileId))) continue;
        if (_notesPushBlocked.has(profileId)) {
          // Le distant n'a pas pu être fusionné : on laisse la marque et on
          // retentera. Ne JAMAIS pousser sans avoir lu ce qu'on remplace.
          console.warn('[webSync] remontée des notes différée : distant non fusionné ce cycle');
          continue;
        }
        // GARDE DE FRAÎCHEUR : ce manifeste-ci vient d'être relu, il peut être
        // POSTÉRIEUR à celui que le pull a fusionné. Si l'entrée notes a bougé
        // entre les deux, l'état qu'on s'apprête à pousser n'a pas vu ce
        // changement : on saute SANS acquitter, le cycle suivant refusionnera.
        if (base.files[fileId]?.checksum !== _mergedNotesChecksum.get(profileId)) {
          console.warn(
            '[webSync] remontée des notes différée : `meta:notes` distant plus récent que la fusion'
          );
          continue;
        }
        // Miroir EXACT d'une méta de dossier, à la source du clair près : le
        // blob local est chiffré FEK (format web), le nuage attend le conteneur
        // clé machine `v2:` que le desktop écrit dans notes.enc.
        const built = await buildNotesContainer(profileId, store, machineKey, base.files[fileId]);
        if (!built) {
          // Rien à pousser (aucun store) ou remontée refusée par la garde
          // anti-effacement : la marque est retirée plutôt que de faire boucler
          // le cycle — la prochaine sauvegarde de notes la reposera.
          ack(fileId, p);
          continue;
        }
        bytes = built.bytes;
        pushedNotesBase = built.base;
        pushedConflictCopies = built.conflictIds;
        restoredConflictCopies += built.restored;
      } else if (p.kind === 'meta' && fileId === LAYOUT_META_FILE_ID) {
        // ⚠ AVANT la branche générique `meta` : l'entrée en attente porte
        // `folderId: 'layout'`, elle y serait prise pour un dossier.
        if (_layoutPushBlocked.has(profileId)) {
          // Le distant n'a pas pu être fusionné : on laisse la marque et on
          // retentera. Ne JAMAIS pousser sans avoir lu ce qu'on remplace.
          console.warn(
            '[webSync] remontée de la mise en page différée : distant non fusionné ce cycle'
          );
          continue;
        }
        // GARDE DE FRAÎCHEUR, identique à celle des notes : ce manifeste-ci vient
        // d'être relu, il peut être POSTÉRIEUR à celui que le pull a fusionné.
        // Les deux valeurs sont `undefined` quand le nuage ne porte aucune mise
        // en page et que nous n'en avons jamais fusionné — c'est le cas de la
        // toute première publication, et il doit passer.
        if (base.files[fileId]?.checksum !== _mergedLayoutChecksum.get(profileId)) {
          console.warn(
            '[webSync] remontée de la mise en page différée : `meta:layout` distant plus récent que la fusion'
          );
          continue;
        }
        const doc = await withLayoutLock(() => readLocalLayout(profileId));
        if (!doc) {
          // Rien à pousser : la marque part plutôt que de faire boucler le
          // cycle — la prochaine écriture la reposera.
          ack(fileId, p);
          continue;
        }
        // Le nuage attend le conteneur clé machine `v2:` que le bureau écrit
        // dans `layout.enc` — même format, même clé, même lecteur.
        bytes = new TextEncoder().encode(await encryptMachineContainerText(doc, machineKey));
      } else if (p.kind === 'meta' && p.folderId) {
        const folder = folders[p.folderId];
        if (!folder) {
          ack(fileId, p); // dossier disparu : rien à pousser
          continue;
        }
        // Drapeaux INTERNES au web : ils ne doivent jamais entrer dans le
        // conteneur poussé (le desktop les relirait comme des champs de méta).
        const { __fromCloud, __unreadable, ...clean } = folder;
        void __fromCloud;
        void __unreadable;
        const container = await encryptMachineContainerText(clean, machineKey);
        bytes = new TextEncoder().encode(container);
      } else if (p.kind === 'blob' && p.folderId && p.fileName) {
        const blob = await store.get<Uint8Array>(`file:${p.folderId}/${p.fileName}`);
        if (!blob) {
          ack(fileId, p);
          continue;
        }
        bytes = new Uint8Array(blob);
      }
      if (!bytes) continue;
      const keys = await uploadBytes(profileId, fileId, bytes);
      const now = new Date().toISOString();
      // FUSION sur l'entrée distante, jamais remplacement : elle porte des
      // champs que le web ne produit pas (localPath, et tout champ ajouté plus
      // tard par le desktop) et les écraser les détruisait. `plaintextChecksum`
      // et `delta` font exception : ils DÉCRIVENT les octets qu'on vient de
      // remplacer. Les garder ferait conclure au desktop « même contenu, rien à
      // faire » (syncManifest.ts:404-409) ou lui ferait lire un blob entier
      // comme des blocs delta.
      const {
        plaintextChecksum: _obsolete,
        delta: _obsoleteDelta,
        ...carried
      } = base.files[fileId] ?? ({} as SyncFileEntry);
      void _obsolete;
      void _obsoleteDelta;
      const checksum = await sha256HexBytes(bytes);
      overlay[fileId] = {
        ...carried,
        checksum,
        size: bytes.byteLength,
        // HORLOGE DE CÂBLE. Pour `meta:notes`, c'est l'instant de la REMONTÉE
        // qui date l'entrée, jamais celui de la marque : cette marque peut
        // attendre des jours (garde de capacité, distant non fusionné), et le
        // desktop comparerait alors une horloge périmée à la sienne. Le
        // `markedAt` ne sert qu'à l'acquittement par comparaison. Pour les
        // autres ressources, la marque DATE la modification et reste juste.
        updatedAt:
          fileId === NOTES_META_FILE_ID || fileId === LAYOUT_META_FILE_ID
            ? now
            : (p.markedAt ?? now),
        syncedAt: now,
        chunks: keys,
        status: 'synced',
        localPath: expectedLocalPath(fileId, p) ?? base.files[fileId]?.localPath,
        // EXPLICITE dans les deux sens pour `meta:notes` : `...carried` remonte
        // le drapeau d'un écrivain précédent, et une vraie écriture v1 depuis
        // ce navigateur doit l'effacer — sinon elle passerait pour le pont.
        ...(fileId === NOTES_META_FILE_ID ? { legacyWriteBack: p.legacyWriteBack === true } : {}),
      };
      if (fileId === NOTES_META_FILE_ID) pushedNotesChecksum = checksum;
      if (fileId === LAYOUT_META_FILE_ID) pushedLayoutChecksum = checksum;
      ack(fileId, p);
      if (p.kind === 'blob' && p.folderId && p.fileName) {
        emitWebEvent('sync-file-status-changed', {
          fileId,
          localPath: `${p.folderId}/${p.fileName}`,
          status: 'synced',
        });
      }
    } catch (err) {
      console.warn(`[webSync] push ${fileId} échoué (retentera au prochain cycle) :`, err);
    }
  }

  if (Object.keys(overlay).length === 0) {
    await clearPendingUploads(done);
    if (restoredConflictCopies > 0) emitWebEvent('notes-updated');
    return 0;
  }

  const next: CloudManifest = {
    ...base,
    profileId,
    // OVERLAY : les entrées distantes sont toutes conservées — le web ne
    // supprime jamais rien du manifeste (v1 append-only).
    files: { ...base.files, ...overlay },
    lastSyncAt: new Date().toISOString(),
    encryptionKey: machineKeyB64,
    profileMeta: freshestProfileMeta(await buildLocalProfileMeta(profileId), base.profileMeta),
  };

  const encrypted = await encryptFekContainer(
    new TextEncoder().encode(JSON.stringify(next)),
    fekRaw
  );

  // CAS : PUT {version} → {uploadUrl,newVersion} → PUT octets. 409 = re-tenter UNE fois.
  const tokenRes = await apiFetch<{ data?: { uploadUrl?: string; newVersion?: number } }>(
    `/sync/manifest/${profileId}`,
    { method: 'PUT', body: { version: remoteVersion }, signal: deadline(CONTROL_TIMEOUT_MS) }
  );
  if (!tokenRes.body?.success || !tokenRes.body.data?.uploadUrl) {
    if (tokenRes.status === 409 && attempt === 0) {
      return pushToCloud(profileId, 1);
    }
    throw new Error(tokenRes.body?.error || 'Jeton manifeste refusé');
  }
  const putRes = await fetch(`${resolveApiBase()}${tokenRes.body.data.uploadUrl}`, {
    method: 'PUT',
    body: encrypted.buffer.slice(
      encrypted.byteOffset,
      encrypted.byteOffset + encrypted.byteLength
    ) as ArrayBuffer,
    headers: { 'Content-Type': 'application/octet-stream' },
    signal: deadline(CONTROL_TIMEOUT_MS),
  });
  if (!putRes.ok) throw new Error(`PUT manifeste : HTTP ${putRes.status}`);

  await clearPendingUploads(done);
  // Notre écriture devient l'état distant de référence : sans cette mise à
  // jour, la garde de fraîcheur trouverait l'empreinte de la fusion périmée au
  // cycle suivant et refuserait toute remontée, indéfiniment.
  if (pushedNotesChecksum) _mergedNotesChecksum.set(profileId, pushedNotesChecksum);
  // Même raison pour la mise en page : sans cette mise à jour, la garde de
  // fraîcheur comparerait l'empreinte de la fusion PÉRIMÉE au cycle suivant et
  // refuserait toute remontée, indéfiniment.
  if (pushedLayoutChecksum) _mergedLayoutChecksum.set(profileId, pushedLayoutChecksum);
  // Le nuage porte désormais EXACTEMENT ce que nous venons de lire : c'est un
  // accord prouvé. Sans cette mise à jour, la base resterait celle de la
  // dernière fusion et notre propre remontée ressemblerait, au cycle suivant, à
  // une divergence — une copie de conflit pour rien.
  if (pushedNotesChecksum && pushedNotesBase) {
    await writeNotesBase(store, pushedNotesBase, null);
  }
  // ACQUITTEMENT DES COPIES DE CONFLIT : elles sont dans le conteneur que le
  // nuage vient d'accepter, donc récupérables depuis n'importe quel appareil.
  // Seules les entrées réellement embarquées partent du registre — une copie
  // fabriquée pendant ce push y reste et sera poussée au cycle suivant.
  if (pushedNotesChecksum && pushedConflictCopies) {
    const remaining = await readPendingConflictCopies(store);
    for (const id of Object.keys(pushedConflictCopies.notes)) delete remaining.notes[id];
    for (const id of Object.keys(pushedConflictCopies.notebooks)) delete remaining.notebooks[id];
    await writePendingConflictCopies(store, remaining);
  }
  if (restoredConflictCopies > 0) emitWebEvent('notes-updated');
  const newVersion = tokenRes.body.data.newVersion ?? remoteVersion + 1;
  // Notre propre écriture fait avancer la version : l'inscrire tout de suite,
  // sinon le prochain sondage prendrait notre push pour un changement distant.
  _serverVersions.set(profileId, newVersion);
  await store.put(SYNC_STATE_KEY, {
    profileId,
    version: newVersion,
    lastPullAt: new Date().toISOString(),
  } satisfies SyncState);
  await rememberManifest(profileId, next);
  return Object.keys(overlay).length;
}

// ── Cycle public ────────────────────────────────────────────────────────────

export interface PullResult {
  state: 'idle' | 'error';
  version: number;
  installedMeta: number;
  pushed: number;
  restoredProfiles: number;
  notModified: boolean;
  error?: string;
}

/**
 * VERROU DE CYCLE, partagé par TOUS les déclencheurs (ordonnanceur périodique,
 * sondage, debounce, et le bouton « Synchroniser maintenant » qui passe par
 * `sync:triggerSync`). Un cycle fait pull → fusion → push : deux qui se
 * chevauchent lisent le même manifeste, poussent deux fois et se battent sur le
 * CAS. Un appel pendant un cycle en vol REJOINT ce cycle au lieu d'en ouvrir un
 * second ; un appel pour un AUTRE profil attend son tour plutôt que de recevoir
 * un résultat qui ne le concerne pas.
 *
 * Le verrou vit ici, sur le point d'entrée public, et non chez l'ordonnanceur :
 * c'est le seul endroit par lequel tout le monde passe.
 */
let _cycleInFlight: { profileId: string; promise: Promise<PullResult> } | null = null;

export function pullFromCloud(profileId: string): Promise<PullResult> {
  const inFlight = _cycleInFlight;
  if (inFlight) {
    if (inFlight.profileId === profileId) return inFlight.promise;
    return inFlight.promise.then(() => pullFromCloud(profileId));
  }
  const promise = runCycle(profileId).finally(() => {
    if (_cycleInFlight?.promise === promise) _cycleInFlight = null;
  });
  _cycleInFlight = { profileId, promise };
  return promise;
}

/** Un cycle est-il en vol ? (diagnostic / tests — jamais une décision métier.) */
export function isCycleInFlight(): boolean {
  return _cycleInFlight !== null;
}

async function runCycle(profileId: string): Promise<PullResult> {
  // ÉTAT VISIBLE, comme le desktop l'annonce en tête de cycle
  // (syncService.ts:525-532) : sans cet événement, un clic sur « Synchroniser »
  // ne changeait STRICTEMENT rien à l'écran — ni pendant, ni en cas d'échec.
  // La sortie est garantie plus bas : les deux branches en émettent une.
  emitWebEvent('sync-status-changed', { state: 'syncing' });
  try {
    const store = forProfile(profileId);
    const prior = await store.get<SyncState>(SYNC_STATE_KEY);
    const known =
      prior?.profileId === profileId && _manifestCache?.profileId === profileId
        ? prior.version
        : undefined;

    const { manifest, version, notModified } = await fetchManifestRaw(profileId, known);
    let installedMeta = 0;
    if (manifest) {
      await rememberManifest(profileId, manifest);
      // AVANT l'installation : le repli de marquage des notes consulte déjà la
      // garde d'activation.
      await recordNotesMergeCapability(profileId, manifest);
      const { installed, failed } = await installMetadata(profileId, manifest);
      installedMeta = installed;
      if (failed === 0) {
        // Version inscrite APRÈS ingestion complète seulement : une entrée
        // illisible doit laisser le sondage redemander cette version-là.
        _serverVersions.set(profileId, version);
        await store.put(SYNC_STATE_KEY, {
          profileId,
          version,
          lastPullAt: new Date().toISOString(),
        } satisfies SyncState);
      } else {
        console.warn(
          `[webSync] version ${version} non inscrite : ${failed} méta(s) illisible(s) — nouvelle tentative au prochain cycle`
        );
      }
    } else {
      // Rien à ingérer (304, même version, ou aucun manifeste côté serveur) :
      // la version connue reste vraie.
      _serverVersions.set(profileId, version);
    }

    const restoredProfiles = await restoreCloudProfiles().catch(() => 0);
    const pushed = await pushToCloud(profileId).catch((err) => {
      console.warn('[webSync] remontée échouée (retentera au prochain cycle) :', err);
      return 0;
    });

    emitWebEvent('sync-status-changed', { state: 'idle', lastSyncAt: new Date().toISOString() });
    return { state: 'idle', version, installedMeta, pushed, restoredProfiles, notModified };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Un cycle qui échoue le DIT, ET DIT POURQUOI : l'état seul rendait le
    // bouton rouge sans le moindre indice, y compris pour un cycle AUTOMATIQUE
    // (qui n'affiche aucune bulle). Le message voyage donc avec l'état — le
    // survol du bouton et le journal le portent.
    console.error('[webSync] cycle échoué :', err);
    emitWebEvent('sync-status-changed', { state: 'error', error: message });
    return {
      state: 'error',
      version: 0,
      installedMeta: 0,
      pushed: 0,
      restoredProfiles: 0,
      notModified: false,
      error: message,
    };
  }
}

/** Manifeste déchiffré du dernier cycle (lecture seule — pour les statuts UI). */
export function getCachedManifest(): CloudManifest | null {
  return _manifestCache?.manifest ?? null;
}

export async function getSyncState(): Promise<SyncState | null> {
  const pid = await getActiveProfileId();
  if (!pid) return null;
  return forProfile(pid).get<SyncState>(SYNC_STATE_KEY);
}

/** Rapatriement à la demande du contenu d'un fichier cloud (voir en-tête). */
export async function fetchCloudFile(
  folderId: string,
  fileName: string
): Promise<Uint8Array | null> {
  // Le dépôt partagé rattrape l'onglet SUIVEUR, dont le cache mémoire ne sera
  // jamais garni : sans lui, tout fichier du nuage y est « inexistant ».
  await loadCachedManifest();
  const cached = _manifestCache;
  if (!cached) return null;
  const fileId = await deriveFileId(folderId, fileName);
  const entry = cached.manifest.files[fileId];
  if (!entry) return null;
  // Seuls les fichiers réellement PRÉSENTS côté cloud sont téléchargeables :
  // pending_upload = l'autre appareil n'a pas fini de pousser, local_only =
  // jamais poussé par design, deleted = purgé.
  if (entry.status !== 'synced' && entry.status !== 'cloud-only') {
    console.warn(
      `[webSync] ${fileName} : statut cloud '${entry.status}' — contenu indisponible depuis le web`
    );
    return null;
  }
  // Diagnostic conditions réelles : en cas d'échec de téléchargement, cette
  // ligne dit immédiatement le palier de stockage en cause.
  console.info(
    `[webSync] fetchCloudFile ${fileName} — size=${entry.size} chunks=${entry.chunks.length} ` +
      `delta=${entry.delta ? 'oui' : 'non'} status=${entry.status}`
  );
  if (entry.delta) {
    // Fichier delta (≥ 64 Mio, blocs adressés par contenu) : lu bloc à bloc et
    // déchiffré ici — jamais un conteneur V3 à ouvrir ensuite. Voir deltaRead.ts.
    const fekRaw = await fekRawOrThrow();
    const plain = await readDeltaFileFromCloud(cached.profileId, fileId, fekRaw);
    const reEncrypted = await encryptFileContent(
      plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength) as ArrayBuffer,
      { fileName }
    );
    await forProfile(cached.profileId).put(`file:${folderId}/${fileName}`, reEncrypted);
    return plain;
  }
  if (entry.size >= 64 * 1024 * 1024 && entry.chunks.length <= 1) {
    throw new Error(
      `${fileName} : gros fichier (multipart ${Math.round(entry.size / 1024 / 1024)} Mo) — ` +
        'pas encore supporté sur le web'
    );
  }

  const bytes = await downloadWholeFile(cached.profileId, fileId, entry);
  const fekRaw = await fekRawOrThrow();

  let plain: Uint8Array;
  if (isV3Container(bytes)) {
    plain = await decryptV3Buffer(bytes, fekRaw);
  } else if (isMachineBinaryContainer(bytes)) {
    const machineKey = cached.manifest.encryptionKey
      ? b64ToBytes(cached.manifest.encryptionKey)
      : null;
    if (!machineKey) throw new Error('Clé machine absente du manifeste');
    plain = await decryptMachineContainerBinary(bytes, machineKey);
  } else {
    plain = new Uint8Array(await decryptFileContent(bytes));
  }

  const reEncrypted = await encryptFileContent(
    plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength) as ArrayBuffer,
    { fileName }
  );
  await forProfile(cached.profileId).put(`file:${folderId}/${fileName}`, reEncrypted);
  return plain;
}
