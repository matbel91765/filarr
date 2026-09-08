/**
 * « PUBLIER CE COFFRE SUR LE COMPTE » — l'orchestrateur.
 *
 * ═══ LE PARCOURS, EN UNE PHRASE ═══
 * Pour chaque élément : LIRE avec la clé active, rechiffrer POUR L'ENVOI
 * SEULEMENT, téléverser — le fichier du coffre ne bouge pas. Puis, et
 * SEULEMENT après avoir CONSTATÉ que tout est monté et relisible, basculer
 * l'appareil sur la clé du compte, en CONSERVANT l'ancienne en lecture.
 *
 * ═══ LES DEUX RÈGLES QUI COMMANDENT TOUT LE RESTE ═══
 *
 * C1 — LA MIGRATION NE RESCELLE RIEN LOCALEMENT. Pas un octet du coffre n'est
 *   réécrit. Le détail, et la raison pour laquelle le TYPE l'interdit plutôt
 *   qu'une convention, sont dans `itemTransfer.ts`. Conséquence directe et
 *   voulue : ABANDONNER EST GRATUIT À N'IMPORTE QUEL INSTANT — rien sur
 *   l'appareil n'a changé, donc il n'y a rien à défaire. Les chemins de
 *   destruction ne sont pas gérés : ils n'existent plus.
 *
 * C2 — APRÈS LA BASCULE, L'ANCIENNE CLÉ EST CONSERVÉE EN LECTURE SEULE. Elle
 *   le doit : sous C1, 100 % du contenu local reste scellé sous elle. Les
 *   écritures NOUVELLES emploient la clé du compte ; la lecture essaie la clé
 *   active puis retombe sur les clés retenues. Ce que cette conservation coûte
 *   est écrit — pas caché — dans `retiredKey.ts`.
 *
 * ═══ CE QUI EST ÉCRIT SUR LE DISQUE, ET OÙ ═══
 *
 * · AUCUN CLAIR. Le transcodage V3 streame en mémoire plate ; les blobs de
 *   format renderer transitent par un tampon zéroïsé dans un `finally`.
 * · UN FICHIER DE TRANSPORT, dans `publish/<migrationId>/outbox/`, quand
 *   l'envoi exige un chemin (V3 streamé, ou blob assez gros pour le multipart).
 *   Hors du coffre, jamais renommé par-dessus quoi que ce soit, supprimé dès
 *   l'envoi confirmé. Coût réel : de l'espace disque temporaire égal à la
 *   taille de l'élément en cours.
 * · AUCUN FICHIER LOCAL N'EST SUPPRIMÉ. La migration PUBLIE ; elle ne déplace
 *   pas, elle n'efface pas.
 *
 * ═══ CE QUE LA BASCULE CHANGE VRAIMENT, SUR LE BUREAU ═══
 * Elle change la clé d'ÉCRITURE. Rien ne devient illisible : `metadata.json` et
 * `notes.enc` vivent sous la clé MACHINE (`encryption.key.safe`) et ne
 * dépendaient déjà pas de la FEK ; les blobs sous FEK continuent de s'ouvrir
 * grâce à la clé retenue (C2). Le manifeste cible emporte la clé machine du
 * profil (`encryptionKey`) — sans quoi les autres appareils verraient des
 * dossiers qu'ils ne sauraient pas ouvrir.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { BrowserWindow, app } from 'electron';
import log from 'electron-log';
import StorageService from '../storageService';
import profileManager from '../profileManager';
import * as sessionKeyStore from '../sessionKeyStore';
import * as r2 from '../sync/syncR2Client';
import * as syncService from '../sync/syncService';
import { getMe } from '../authService';
import { decryptHybridFekBlob, encryptHybridFekBlobV1 } from '../hybridBlobCrypto';
import { hashV3Plaintext, transcodeV3File } from '../streamCrypto';
import type { SyncFileEntry, SyncManifest } from '../sync/syncManifest';
import {
  canSwitch,
  createJournal,
  decideResume,
  exceedsDamageThreshold,
  isOrdinarySyncSuspended,
} from './journalMachine';
import { getJournalStore, getPublishBaseDir } from './journalStore';
import {
  clearIncomingFek,
  computeAccountKeyDigest,
  hasIncomingFek,
  loadIncomingFekRaw,
  loadIncomingMaterial,
  storeIncomingFek,
} from './incomingFek';
import {
  keychainAvailable,
  loadRetiredRawKeys,
  retainRetiredKey,
} from './retiredKey';
import { transferItem, type TransferPorts } from './itemTransfer';
import {
  discardNextKeys,
  finishSwitch,
  performSwitch,
  resumeSwitch,
  WRAPPED_FEK_FILE,
  type KeyLocation,
} from './keySwitch';
import { buildPublishPlan, verifyProfileCoverage, type PublishPlan } from './plan';
import { relocatePublishedProfiles } from './profileRelocation';
import { buildVerifyPlan, shouldDefaultToFullVerify } from './verifyPlan';
import { assignTargets } from './targetProfile';
import { resumeActionFor, tallyLedger } from './ledger';
import { scanAllProfiles } from './inventoryScan';
import type {
  LedgerLine,
  PublishErrorCode,
  PublishItem,
  PublishJournal,
  PublishLocalProfile,
} from './types';

// ── Constantes ──────────────────────────────────────────────────────────────

/**
 * Morceau de transport : 4 Mio, exactement le `CHUNK_SIZE` de `syncService`.
 * Diverger casserait la reprise d'un téléversement entamé par l'un et repris
 * par l'autre — et le worker plafonne à 96 Mio par requête.
 */
const CHUNK_SIZE = 4 * 1024 * 1024;

/**
 * Plafond de retéléchargement PAR ÉLÉMENT à la vérification. Le palier 2 relit
 * les octets ; le faire sur un blob de plusieurs gigaoctets tiendrait tout en
 * mémoire pour prouver ce que le palier 1 a déjà largement établi. Les éléments
 * plus gros sortent de l'échantillon — c'est une limite connue, nommée ici.
 */
const VERIFY_MAX_ITEM_DOWNLOAD_BYTES = 256 * 1024 * 1024;

/** Rafraîchissement des compteurs : jamais à chaque élément (O(n²) sinon). */
const COUNTER_FLUSH_ITEMS = 25;
const COUNTER_FLUSH_MS = 5_000;

// ── État du process principal ───────────────────────────────────────────────

interface EngineState {
  journal: PublishJournal;
  plan: PublishPlan | null;
  /** Clé du compte, en clair, le temps de la migration. Jamais journalisée. */
  incomingFek: Buffer;
  activeFek: Buffer | null;
  /** Drapeau observé ENTRE deux éléments — jamais un `abort` au milieu. */
  pauseRequested: boolean;
  running: boolean;
  /** Débits récents (octets/ms) pour l'estimation — médiane sur 20 éléments. */
  recentRates: number[];
  startedAtMs: number;
  itemsSinceStart: number;
  currentLabel: string;
}

let state: EngineState | null = null;
let mainWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win;
}

function notify(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

async function persist(journal: PublishJournal): Promise<void> {
  journal.updatedAt = new Date().toISOString();
  await getJournalStore().write(journal);
  notify('publish:state-changed', toSnapshot(journal));
}

// ── Instantané pour le renderer ─────────────────────────────────────────────

export interface PublishSnapshot {
  state: PublishJournal['state'];
  migrationId: string;
  counters: PublishJournal['counters'];
  targetProfiles: PublishJournal['targetProfiles'];
  abandonedProfiles: PublishJournal['abandonedProfiles'];
  blockers: PublishJournal['blockers'];
  verify: { planned: number; ok: number; failed: string[]; full: boolean };
  lastError: PublishJournal['lastError'];
  /** Nom de l'élément en cours — seulement pour le profil ouvert. */
  currentLabel: string;
  /**
   * Estimation en secondes, ou `null`. `null` signifie « on ne sait pas
   * encore » et l'écran n'affiche RIEN : un « calcul en cours… » n'informe de
   * rien et occupe la place de l'information vraie.
   */
  etaSeconds: number | null;
  paused: boolean;
}

function toSnapshot(journal: PublishJournal): PublishSnapshot {
  return {
    state: journal.state,
    migrationId: journal.migrationId,
    counters: journal.counters,
    targetProfiles: journal.targetProfiles,
    abandonedProfiles: journal.abandonedProfiles,
    blockers: journal.blockers,
    verify: {
      planned: journal.verify.plan.length,
      ok: journal.verify.ok,
      failed: journal.verify.failed,
      full: journal.verify.full,
    },
    lastError: journal.lastError,
    currentLabel: state?.currentLabel ?? '',
    etaSeconds: estimateEta(journal),
    paused: state?.pauseRequested ?? false,
  };
}

/**
 * Estimation du temps restant.
 *
 * Médiane du débit des 20 derniers éléments, appliquée aux octets restants.
 * Rien n'est affiché avant 60 s ET 5 éléments terminés : une estimation faite
 * sur deux petits fichiers annoncerait « 4 minutes » pour un coffre de 7 Go,
 * et une estimation qui se corrige à la hausse est pire que pas d'estimation.
 */
function estimateEta(journal: PublishJournal): number | null {
  if (!state) return null;
  if (journal.state !== 'PUBLISHING') return null;
  if (state.itemsSinceStart < 5) return null;
  if (Date.now() - state.startedAtMs < 60_000) return null;
  const rates = [...state.recentRates].sort((a, b) => a - b);
  if (rates.length === 0) return null;
  const median = rates[Math.floor(rates.length / 2)];
  if (median <= 0) return null;
  const remaining = Math.max(0, journal.counters.totalBytes - journal.counters.doneBytes);
  return Math.round(remaining / median / 1000);
}

// ── Petits utilitaires ──────────────────────────────────────────────────────

function rootDir(): string {
  return path.join(app.getPath('userData'), 'FilarData');
}

function profileDir(profileId: string): string {
  return path.join(rootDir(), 'profiles', profileId.replace(/[^a-zA-Z0-9-]/g, ''));
}

/**
 * TOUS les emplacements de clé, racine EN PREMIER.
 *
 * La racine d'abord parce que c'est elle qui fait autorité si la reprise
 * survient après une promotion partielle (voir `keySwitch.ts`). Les profils
 * suivent, tous, sans exception — un profil oublié conserverait l'ANCIENNE clé
 * et serait lu en priorité par `hybrid:loadFEK`.
 */
async function keyLocations(): Promise<KeyLocation[]> {
  const locations: KeyLocation[] = [{ dir: rootDir(), label: 'root' }];
  try {
    const entries = await fs.readdir(path.join(rootDir(), 'profiles'), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      locations.push({
        dir: path.join(rootDir(), 'profiles', entry.name),
        label: `profile:${entry.name}`,
      });
    }
  } catch {
    // Coffre hérité monolithique : la racine suffit.
  }
  return locations;
}

async function streamingSha256(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  const handle = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.allocUnsafe(1024 * 1024);
    let pos = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buf, 0, buf.length, pos);
      if (bytesRead === 0) break;
      hash.update(buf.subarray(0, bytesRead));
      pos += bytesRead;
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
  return hash.digest('hex');
}

// ── Garde d'adoption : le point d'entrée ────────────────────────────────────

export interface AdoptionInspection {
  itemCount: number;
  byteCount: number;
  profileCount: number;
}

/**
 * Ce que la garde a besoin de savoir : combien d'éléments deviendraient
 * illisibles si l'appareil adoptait la clé du compte séance tenante. Compté sur
 * le DISQUE, pas dans un index — c'est ce qui serait perdu.
 */
export async function inspectLocalContent(): Promise<AdoptionInspection> {
  const { items, profiles } = await scanAllProfiles({ activeFek: null, incomingFek: null });
  const blobs = items.filter((it) => it.kind === 'blob');
  return {
    itemCount: blobs.length,
    byteCount: blobs.reduce((sum, it) => sum + it.size, 0),
    profileCount: profiles.length,
  };
}

// ── PREPARING : ouvrir la migration ─────────────────────────────────────────

/**
 * Persiste la clé entrante (emballée, INACTIVE) et ouvre le journal.
 *
 * La clé du compte doit survivre à une mort de l'application : des semaines de
 * données, c'est des heures de migration, et refaire l'appairage à chaque
 * coupure serait intenable. Elle est donc écrite — sous des noms qu'aucun
 * chemin d'activation ne lit.
 */
export async function beginMigration(params: {
  incomingFekRaw: Buffer;
  vaultPassword: string;
  accountUserId: string;
}): Promise<PublishSnapshot> {
  const migrationId = crypto.randomUUID();
  const stored = await storeIncomingFek(params.incomingFekRaw, params.vaultPassword, migrationId);

  const journal = createJournal({
    migrationId,
    accountUserId: params.accountUserId,
    accountKeyDigest: stored.keyDigest,
    wrappedDigest: stored.wrappedDigest,
    now: new Date().toISOString(),
  });

  state = {
    journal,
    plan: null,
    incomingFek: Buffer.from(params.incomingFekRaw),
    activeFek: await loadActiveFek(),
    pauseRequested: false,
    running: false,
    recentRates: [],
    startedAtMs: Date.now(),
    itemsSinceStart: 0,
    currentLabel: '',
  };

  // Le cycle ordinaire est SUSPENDU dès maintenant : sans cela il pousserait
  // des manifestes sous l'ANCIENNE clé dans le profil d'origine pendant qu'on
  // publie sous la nouvelle ailleurs — deux vérités concurrentes, aucune
  // n'étant fausse, et rien pour les départager.
  syncService.setPublishSuspended(true);
  StorageService.setIncomingReadKey(state.incomingFek);

  await persist(journal);
  return toSnapshot(journal);
}

async function loadActiveFek(): Promise<Buffer | null> {
  const key = await StorageService.loadFEKForPairing();
  if (!key) return null;
  return Buffer.from(await crypto.subtle.exportKey('raw', key));
}

// ── PREPARING → READY : construire l'inventaire ─────────────────────────────

export interface InventoryOptions {
  /** Profils explicitement, nommément abandonnés. */
  abandonedProfileIds?: string[];
  /** Renommages décidés à l'écran, par profil local. */
  renames?: Record<string, string>;
  /** Palier 3 (retéléchargement intégral). */
  fullVerify?: boolean;
}

/**
 * Reconstruit l'inventaire À CHAQUE FOIS. Jamais rechargé depuis le journal :
 * hériter d'un inventaire partiel est précisément le risque que la reprise en
 * `PREPARING`/`READY` doit fermer, et le coffre a pu changer entre-temps.
 */
export async function buildInventory(opts: InventoryOptions = {}): Promise<PublishSnapshot> {
  const st = requireState();
  const journal = st.journal;

  const scan = await scanAllProfiles({
    activeFek: st.activeFek,
    incomingFek: st.incomingFek,
  });

  // Profil cible : un NEUF par profil local. Le test d'occupation est « le
  // manifeste distant est nul », JAMAIS la présence dans /sync/profiles — le
  // worker crée la ligne au premier GET, donc l'identifiant de cet appareil y
  // figure toujours.
  const abandoned = new Set(opts.abandonedProfileIds ?? []);
  const { occupiedNames, complete } = await collectOccupiedNames(st.incomingFek);
  const deviceName = sanitizeDeviceLabel();

  // L'assignation elle-même est un module PUR (`assignTargets`) : pour un
  // profil déjà consigné au journal, ni la sonde distante ni le tirage d'UUID
  // ne sont consultés — le journal fait autorité, et le test
  // `publishTargetAssignment.test.ts` fait LEVER les ports pour le prouver.
  // Sans cela, une reprise re-tirerait la cible au sort et sèmerait un second
  // profil dans le compte (défaut constaté sur mobile).
  const targets = await assignTargets(
    {
      profiles: scan.profiles,
      abandonedProfileIds: abandoned,
      previousAssignments: new Map(
        journal.targetProfiles.map(
          (t) =>
            [
              t.localProfileId,
              { targetProfileId: t.targetProfileId, targetName: t.targetName },
            ] as const
        )
      ),
      occupiedNames,
      complete,
      deviceName,
      renames: opts.renames,
    },
    {
      remoteManifestIsNull,
      mintUuid: () => crypto.randomUUID(),
    }
  );

  const plan = buildPublishPlan({
    profiles: scan.profiles,
    items: scan.items,
    abandonedProfileIds: [...abandoned],
    targets,
    // Le bureau n'a AUCUN plafond par élément : `transcodeV3File` streame.
    maxItemBytes: null,
    now: new Date().toISOString(),
  });

  const coverage = verifyProfileCoverage(scan.profiles, plan);
  if (!coverage.ok) {
    throw new Error(
      `[publish] Profils locaux non traités : ${coverage.uncoveredProfileIds.join(', ')}`
    );
  }

  st.plan = plan;
  journal.targetProfiles = plan.targetProfiles;
  // L'horodatage d'un abandon DÉJÀ consenti est préservé : c'est la trace du
  // geste de l'utilisateur, pas celle de la reconstruction de l'inventaire.
  const acceptedBefore = new Map(
    journal.abandonedProfiles.map((p) => [p.localProfileId, p.acceptedAt] as const)
  );
  journal.abandonedProfiles = plan.abandonedProfiles.map((p) => ({
    ...p,
    acceptedAt: acceptedBefore.get(p.localProfileId) ?? p.acceptedAt,
  }));
  // C8 — LES OBSTACLES SONT NOMMÉS, ET CHACUN A UNE ACTION À L'ÉCRAN.
  //
  // Sur le bureau, `maxItemBytes` vaut `null` : le transcodage streame et
  // l'envoi passe en multipart, donc AUCUN plafond par élément n'existe et
  // `plan.blockers` est toujours vide. Le seul obstacle réel est l'absence de
  // trousseau — et il n'est pas cosmétique : sans lui, l'ancienne clé ne peut
  // pas être conservée en lecture (C2), donc la bascule rendrait le contenu
  // local inaccessible. On le pose DÈS L'INVENTAIRE plutôt qu'au dernier
  // instant, pour que l'utilisateur ait le geste à faire avant d'avoir attendu
  // des heures.
  journal.blockers = [
    ...plan.blockers,
    ...(keychainAvailable() ? [] : [{ kind: 'keychain-unavailable' as const }]),
  ];
  journal.counters = { ...plan.counters, doneItems: 0, damagedItems: 0, doneBytes: 0 };
  await refreshCounters(journal, plan);
  journal.verify.full = opts.fullVerify ?? shouldDefaultToFullVerify(plan.counters.totalBytes);
  // Assignation directe, sans passage par `assertTransition` : reconstruire
  // l'inventaire est un geste de LECTURE qui peut survenir depuis n'importe
  // quel état vivant (y compris une reprise en `VERIFYING`), et il ne touche
  // ni une clé ni un octet. Le graphe garde ce qu'il doit garder — la bascule.
  journal.state = 'READY';
  await persist(journal);
  return toSnapshot(journal);
}

/**
 * Reprise après un redémarrage, pour `PUBLISHING` comme pour `VERIFYING`.
 *
 * Le plan en mémoire n'a pas survécu à la mort de l'application : il faut le
 * reconstruire. Ce n'est pas un coût perdu — le registre fait sauter tout ce
 * qui est déjà `done`, donc la passe est rapide, et la preuve repart de zéro,
 * ce qui est exactement la conduite voulue en `VERIFYING` (une preuve à moitié
 * faite ne prouve rien, et son plan est rejouable à l'identique).
 */
export async function resumeAfterRestart(): Promise<void> {
  const st = requireState();
  await buildInventory({
    abandonedProfileIds: st.journal.abandonedProfiles.map((p) => p.localProfileId),
    fullVerify: st.journal.verify.full,
  });
  await startPublishing();
}

function sanitizeDeviceLabel(): string {
  try {
    // Même assainissement que l'appairage : pas de caractère de contrôle, pas
    // de longueur folle dans un nom qui finira dans un manifeste.
    return os.hostname().replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 24) || 'cet appareil';
  } catch {
    return 'cet appareil';
  }
}

async function remoteManifestIsNull(profileId: string): Promise<boolean> {
  try {
    const { manifest } = await r2.getManifest(profileId);
    return manifest === null;
  } catch {
    // Injoignable : on ne peut PAS affirmer que la place est libre. On frappe
    // donc un identifiant neuf — écrire dans un profil qui contient peut-être
    // déjà quelque chose est le seul résultat qu'on n'accepte jamais.
    return false;
  }
}

/**
 * Noms de profil déjà occupés dans le compte.
 *
 * Un manifeste illisible sous la clé ENTRANTE appartient à un autre domaine de
 * clés : son nom ne contraint pas le nôtre, et l'inclure produirait une
 * désambiguïsation fondée sur une lecture qu'on n'a pas faite. Dès qu'un
 * manifeste est injoignable ou illisible, l'ensemble est déclaré INCOMPLET et
 * la désambiguïsation bascule sur le nom d'appareil — qui, lui, est vrai quoi
 * qu'il arrive.
 */
async function collectOccupiedNames(
  incomingFek: Buffer
): Promise<{ occupiedNames: string[]; complete: boolean }> {
  const names: string[] = [];
  let complete = true;
  try {
    const cloud = await syncService.listCloudProfileIds();
    for (const profileId of cloud) {
      try {
        const { manifest } = await r2.getManifest(profileId);
        if (!manifest) continue;
        const plain = await StorageService.decryptWithRawKey(manifest, incomingFek);
        const parsed = JSON.parse(plain.toString('utf-8')) as SyncManifest;
        if (parsed.profileMeta?.name) names.push(parsed.profileMeta.name);
      } catch {
        complete = false;
      }
    }
  } catch {
    complete = false;
  }
  return { occupiedNames: names, complete };
}

// ── PUBLISHING : la boucle ──────────────────────────────────────────────────

export async function startPublishing(): Promise<void> {
  const st = requireState();
  if (st.running) return;
  if (!st.plan) {
    // Reprise d'un `FAILED` après redémarrage : le plan n'a pas survécu, mais le
    // registre si — on le reconstruit plutôt que d'échouer sur « inventaire
    // absent », qui ne dirait rien à personne.
    await buildInventory({
      abandonedProfileIds: st.journal.abandonedProfiles.map((p) => p.localProfileId),
      fullVerify: st.journal.verify.full,
    });
  }
  if (st.journal.state === 'READY' || st.journal.state === 'FAILED') {
    st.journal.state = 'PUBLISHING';
    st.journal.lastError = null;
    await persist(st.journal);
  }
  st.pauseRequested = false;
  st.running = true;
  void runLoop().finally(() => {
    if (state) state.running = false;
  });
}

/**
 * « Interrompre » — un drapeau, pas un `abort`.
 *
 * L'élément en cours va à son terme : l'interrompre au milieu ne gagne que
 * quelques secondes et complique la reprise. La migration passe en `READY`,
 * c'est-à-dire EN PAUSE : rien n'est nettoyé, tout se reprend d'un bouton.
 * Passer de la pause à l'abandon est un SECOND geste, explicite.
 */
export function requestPause(): void {
  if (state) state.pauseRequested = true;
}

async function runLoop(): Promise<void> {
  const st = requireState();
  const journal = st.journal;
  const plan = st.plan;
  if (!plan) throw new Error('[publish] Inventaire absent — construire le plan d abord');

  const store = getJournalStore();
  let sinceFlush = 0;
  let lastFlush = Date.now();
  st.startedAtMs = Date.now();
  st.itemsSinceStart = 0;

  try {
    // Les éléments déjà illisibles AVANT la migration sont consignés d'emblée :
    // on ne tente rien sur eux, on ne touche pas un octet, on les compte.
    for (const item of plan.damagedAtScan) {
      const folded = await store.readLedger(journal.migrationId, item.localProfileId);
      if (folded.has(item.key)) continue;
      await store.appendLedger(journal.migrationId, item.localProfileId, {
        k: item.key,
        s: 'damaged',
        why: 'unreadable',
        t: new Date().toISOString(),
      });
    }

    for (const item of plan.order) {
      if (st.pauseRequested) {
        journal.state = 'READY';
        await refreshCounters(journal, plan);
        await persist(journal);
        return;
      }

      const folded = await store.readLedger(journal.migrationId, item.localProfileId);
      const action = resumeActionFor(folded, item.key);
      if (action === 'skip') continue;

      st.currentLabel = item.localPath.split('/').pop() ?? '';
      const t0 = Date.now();
      try {
        await processItem(item, folded.get(item.key) ?? null);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = classifyFailure(message);
        journal.state = 'FAILED';
        journal.lastError = { code, itemKey: item.key };
        await refreshCounters(journal, plan);
        await persist(journal);
        // « Fichier du coffre intact » n'est pas une consolation de circonstance :
        // sous C1 il n'a jamais été ouvert en écriture, donc aucun échec, quel
        // qu'il soit, ne peut le laisser dans un état intermédiaire.
        log.error(`[publish] Échec sur ${item.key} (${code}) — fichier du coffre intact:`, message);
        return;
      }

      const elapsed = Math.max(1, Date.now() - t0);
      st.recentRates.push(item.size / elapsed);
      if (st.recentRates.length > 20) st.recentRates.shift();
      st.itemsSinceStart += 1;

      sinceFlush += 1;
      if (sinceFlush >= COUNTER_FLUSH_ITEMS || Date.now() - lastFlush >= COUNTER_FLUSH_MS) {
        sinceFlush = 0;
        lastFlush = Date.now();
        await refreshCounters(journal, plan);
        await persist(journal);
        if (exceedsDamageThreshold(journal.counters.damagedItems, journal.counters.totalItems)) {
          // Une corruption massive n'est pas un incident par élément : c'est le
          // signe que la clé active n'est PAS celle qu'on croit. Poursuivre
          // transformerait un problème de clé en perte de coffre.
          journal.state = 'FAILED';
          journal.lastError = { code: 'internal', itemKey: null };
          await persist(journal);
          return;
        }
      }
    }

    await refreshCounters(journal, plan);
    st.currentLabel = '';

    if (exceedsDamageThreshold(journal.counters.damagedItems, journal.counters.totalItems)) {
      journal.state = 'FAILED';
      journal.lastError = { code: 'internal', itemKey: null };
      await persist(journal);
      return;
    }

    await pushTargetManifests(plan);
    journal.state = 'VERIFYING';
    await persist(journal);
    await runVerification(plan);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    journal.state = 'FAILED';
    journal.lastError = { code: classifyFailure(message), itemKey: null };
    await persist(journal);
    log.error('[publish] Boucle interrompue:', message);
  }
}

/**
 * Typer l'échec, parce que la conduite en dépend entièrement : `network` se
 * reprend tout seul, `quota-exceeded` demande un geste et ne défait RIEN.
 */
function classifyFailure(message: string): PublishErrorCode {
  if (/quota/i.test(message) || message.includes('413')) return 'quota-exceeded';
  if (/network|fetch|ETIMEDOUT|ECONNRESET|timeout/i.test(message)) return 'network';
  return 'internal';
}

async function refreshCounters(journal: PublishJournal, plan: PublishPlan): Promise<void> {
  const store = getJournalStore();
  let done = 0;
  let damaged = 0;
  let doneBytes = 0;
  const sizeOf = new Map<string, number>();
  for (const it of [...plan.order, ...plan.damagedAtScan]) sizeOf.set(it.key, it.size);

  for (const target of plan.targetProfiles) {
    const folded = await store.readLedger(journal.migrationId, target.localProfileId);
    const tally = tallyLedger(folded);
    done += tally.done;
    damaged += tally.damaged;
    for (const [key, line] of folded) {
      if (line.s === 'done') doneBytes += sizeOf.get(key) ?? line.n ?? 0;
    }
  }
  journal.counters.doneItems = done;
  journal.counters.damagedItems = damaged;
  journal.counters.doneBytes = doneBytes;
}

// ── Le traitement d'un élément ──────────────────────────────────────────────

/**
 * Répertoire de TRANSPORT de la migration. Hors du coffre, purgé avec la
 * migration, et ignoré par l'inventaire (`isExcludedDir` écarte `publish`).
 */
function outboxDir(migrationId: string): string {
  return path.join(
    getPublishBaseDir(),
    'publish',
    migrationId.replace(/[^a-zA-Z0-9-]/g, ''),
    'outbox'
  );
}

/**
 * Câble les ports de `itemTransfer` sur le vrai disque, la vraie crypto et le
 * vrai transport.
 *
 * LE PORT `vault` N'A AUCUNE MÉTHODE D'ÉCRITURE, et c'est ainsi que C1 tient :
 * l'orchestrateur ne peut pas rescelller le coffre même s'il le voulait.
 * Toutes les écritures passent par `outbox`, dont les chemins vivent dans le
 * répertoire de migration.
 */
function buildTransferPorts(targetProfileId: string): TransferPorts {
  const st = requireState();
  const out = outboxDir(st.journal.migrationId);

  return {
    vault: {
      isV3Container: (p) => StorageService.isV3VaultFile(p),
      readAll: (p) => fs.readFile(p),
      sha256OfFile: (p) => streamingSha256(p),
    },
    outbox: {
      path: (name) => path.join(out, name.replace(/[^a-zA-Z0-9._-]/g, '_')),
      transcodeFromVault: async (vaultPath, outPath) => {
        if (!st.activeFek) throw new Error('Coffre verrouillé — clé active indisponible');
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        const { plaintextSha256 } = await transcodeV3File(
          st.activeFek,
          st.incomingFek,
          vaultPath,
          outPath
        );
        return plaintextSha256.toString('hex');
      },
      plaintextShaUnderAccountKey: async (outPath) =>
        (await hashV3Plaintext(st.incomingFek, outPath)).toString('hex'),
      write: async (outPath, data) => {
        // Écriture DIRECTE, volontairement : ce fichier n'est pas un fichier
        // final, il est réécrit intégralement avant chaque envoi et supprimé
        // juste après. Un reliquat d'une coupure ne peut donc pas être envoyé
        // tel quel — il est écrasé avant d'être lu. Le patron atomique est
        // réservé à ce qui doit survivre : le matériel de clé et le journal.
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        await fs.writeFile(outPath, data, { mode: 0o600 });
      },
      remove: async (outPath) => {
        await fs.unlink(outPath).catch(() => undefined);
      },
      sizeOf: async (outPath) => (await fs.stat(outPath)).size,
      sha256OfFile: (outPath) => streamingSha256(outPath),
    },
    openRendererBlob: (blob) => decryptHybridFekBlob(blob, st.activeFek ? [st.activeFek] : []),
    sealRendererBlobForTransport: (plain) => encryptHybridFekBlobV1(plain, st.incomingFek),
    openRendererBlobUnderAccountKey: (blob) => decryptHybridFekBlob(blob, [st.incomingFek]),
    sha256OfBuffer: (data) => crypto.createHash('sha256').update(data).digest('hex'),
    uploadFromPath: (fileId, filePath, size, checksum) =>
      uploadFileToTarget(targetProfileId, fileId, filePath, size, checksum),
    uploadFromBuffer: (fileId, data, checksum) =>
      uploadBufferToTarget(targetProfileId, fileId, data, checksum),
    multipartThreshold: r2.MULTIPART_THRESHOLD,
    now: () => new Date().toISOString(),
  };
}

/**
 * Traite un élément et consigne LA ligne qui en résulte.
 *
 * Le fichier du coffre n'est ouvert qu'en LECTURE — voir `itemTransfer.ts`.
 * Aucune erreur ici ne peut laisser le coffre dans un état intermédiaire : il
 * n'y a pas d'état intermédiaire à laisser.
 */
async function processItem(item: PublishItem, previous: LedgerLine | null): Promise<void> {
  const st = requireState();
  const journal = st.journal;
  const store = getJournalStore();
  const target = journal.targetProfiles.find((t) => t.localProfileId === item.localProfileId);
  if (!target) throw new Error(`[publish] Pas de profil cible pour ${item.localProfileId}`);

  const vaultPath = path.join(profileDir(item.localProfileId), item.localPath);
  const line = await transferItem(
    item,
    vaultPath,
    previous,
    buildTransferPorts(target.targetProfileId)
  );

  if (line.s === 'damaged') {
    log.warn(`[publish] Élément illisible, conservé intact: ${item.key}`);
  }
  await store.appendLedger(journal.migrationId, item.localProfileId, line);
}

/**
 * Téléverse un fichier vers le profil CIBLE.
 *
 * L'espace de noms de reprise est PROPRE À LA MIGRATION
 * (`publish/<migrationId>/multipart-resume.json`) : deux mécaniques de reprise
 * qui partageraient un fichier d'état se marcheraient dessus, et l'une des deux
 * reprendrait un transfert que l'autre a abandonné.
 */
async function uploadFileToTarget(
  targetProfileId: string,
  fileId: string,
  filePath: string,
  size: number,
  checksum: string
): Promise<string[]> {
  const st = requireState();
  if (size >= r2.MULTIPART_THRESHOLD) {
    const resumePath = path.join(
      getPublishBaseDir(),
      'publish',
      st.journal.migrationId,
      'multipart-resume.json'
    );
    await fs.mkdir(path.dirname(resumePath), { recursive: true });
    const result = await r2.uploadViaMultipartFromPath(
      targetProfileId,
      fileId,
      filePath,
      size,
      checksum,
      resumePath
    );
    // La clé rendue par le worker, jamais une clé reconstituée : le cycle
    // ordinaire inspecte ces chaînes (il y distingue les blocs delta), et une
    // clé fabriquée finirait par mentir sur la nature de l'objet.
    return [result.key];
  }

  const handle = await fs.open(filePath, 'r');
  try {
    const total = Math.max(1, Math.ceil(size / CHUNK_SIZE));
    const buf = Buffer.allocUnsafe(CHUNK_SIZE);
    const keys: string[] = [];
    for (let i = 0; i < total; i++) {
      const { bytesRead } = await handle.read(buf, 0, CHUNK_SIZE, i * CHUNK_SIZE);
      const result = await r2.uploadChunk(targetProfileId, fileId, i, buf.subarray(0, bytesRead));
      keys.push(result.key);
    }
    return keys;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/**
 * Téléverse depuis la MÉMOIRE — le chemin nominal d'un petit blob sous C1.
 *
 * Il n'existe que parce que la migration ne rescelle plus rien : un blob de
 * format renderer est rechiffré dans un tampon et part de là, sans qu'un seul
 * octet ne soit écrit sur le disque. L'appelant borne l'usage à ce qui tient
 * raisonnablement en mémoire (`multipartThreshold`) ; au-delà, il repasse par
 * un fichier de transport.
 */
async function uploadBufferToTarget(
  targetProfileId: string,
  fileId: string,
  data: Buffer,
  checksum: string
): Promise<string[]> {
  void checksum; // Le worker ne prend pas d'empreinte sur ce chemin par morceaux.
  const total = Math.max(1, Math.ceil(data.length / CHUNK_SIZE));
  const keys: string[] = [];
  for (let i = 0; i < total; i++) {
    const slice = data.subarray(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, data.length));
    const result = await r2.uploadChunk(targetProfileId, fileId, i, slice);
    keys.push(result.key);
  }
  return keys;
}

// ── Le manifeste du profil cible ────────────────────────────────────────────

async function pushTargetManifests(plan: PublishPlan): Promise<void> {
  const st = requireState();
  const store = getJournalStore();

  for (const target of plan.targetProfiles) {
    const folded = await store.readLedger(st.journal.migrationId, target.localProfileId);
    const files: Record<string, SyncFileEntry> = {};
    const itemsByKey = new Map<string, PublishItem>();
    for (const it of plan.order) {
      if (it.localProfileId === target.localProfileId) itemsByKey.set(it.key, it);
    }

    for (const [key, line] of folded) {
      if (line.s !== 'done') continue;
      const item = itemsByKey.get(key);
      // La ligne `done` porte ELLE-MÊME ses empreintes de transport. C'était le
      // défaut de la version précédente : elle écrivait `uploaded` puis `done`,
      // et comme le registre ne retient que la DERNIÈRE ligne d'une clé, la
      // seconde effaçait `r`/`n`/`ch`/`ks` — le manifeste naissait alors avec un
      // condensat vide et une taille nulle, et la preuve le rejetait. Une ligne
      // autosuffisante ferme le cas par construction.
      const entry: SyncFileEntry = {
        checksum: line.r ?? '',
        size: line.n ?? item?.size ?? 0,
        updatedAt: item?.updatedAt ?? new Date().toISOString(),
        syncedAt: new Date().toISOString(),
        chunks: line.ks ?? [],
        status: 'synced',
        localPath: item?.localPath,
      };
      // `plaintextChecksum` n'est posé que pour les éléments RÉELLEMENT
      // rechiffrés : c'est le champ qui sert de comparateur inter-appareils, et
      // y écrire autre chose qu'une empreinte de clair ferait boucler la
      // détection de changement du cycle ordinaire.
      if (line.c) entry.plaintextChecksum = line.c;
      files[key] = entry;
    }

    const local = await findLocalProfile(target.localProfileId);
    const manifest: SyncManifest = {
      version: 0,
      profileId: target.targetProfileId,
      lastSyncAt: new Date().toISOString(),
      files,
      notes: {},
      profileMeta: {
        id: target.targetProfileId,
        name: target.targetName,
        avatarColor: local?.avatarColor ?? '#6366f1',
        avatarEmoji: local?.avatarEmoji,
        avatarImage: local?.avatarImage,
        // TOUJOURS faux : un second « par défaut » rendrait le choix
        // d'ouverture indéterminé sur les autres appareils.
        isDefault: false,
        order: local?.order ?? 0,
        createdAt: local?.createdAt ?? new Date().toISOString(),
        pinHash: local?.pinHash,
        pinSalt: local?.pinSalt,
        allowPinReset: local?.allowPinReset,
        pinUpdatedAt: local?.pinUpdatedAt,
      },
      // La clé MACHINE du profil : sans elle, les `metadata.json` publiés
      // seraient illisibles ailleurs, et le profil cible naîtrait muet.
      encryptionKey:
        (await StorageService.readProfileEncryptionKeyBase64(
          profileDir(target.localProfileId)
        )) ?? undefined,
    };

    const { version } = await r2.getManifest(target.targetProfileId);
    manifest.version = version;
    const encrypted = await StorageService.encryptWithRawKey(
      Buffer.from(JSON.stringify(manifest), 'utf-8'),
      st.incomingFek
    );
    await r2.putManifest(target.targetProfileId, encrypted, version);
  }
}

async function findLocalProfile(profileId: string): Promise<PublishLocalProfile | null> {
  try {
    const p = profileManager.getManifest().profiles.find((x) => x.id === profileId);
    return p
      ? {
          id: p.id,
          name: p.name,
          order: p.order,
          isDefault: p.isDefault,
          createdAt: p.createdAt,
          avatarColor: p.avatarColor,
          avatarEmoji: p.avatarEmoji,
          avatarImage: p.avatarImage,
          pinHash: p.pinHash,
          pinSalt: p.pinSalt,
          allowPinReset: p.allowPinReset,
          pinUpdatedAt: p.pinUpdatedAt,
        }
      : null;
  } catch {
    return null;
  }
}

// ── VERIFYING : la preuve ───────────────────────────────────────────────────

/**
 * Palier 1 (inventaire) puis palier 2 (octets).
 *
 * Le palier 1 recharge le manifeste SANS CACHE et le déchiffre sous la clé
 * ENTRANTE : un échec ici est fatal, parce que c'est la preuve directe que le
 * compte ne saurait pas relire ce qu'on vient d'écrire. Le palier 2 retélécharge
 * un échantillon déterministe et compare les empreintes du registre.
 */
async function runVerification(plan: PublishPlan): Promise<void> {
  const st = requireState();
  const journal = st.journal;
  const store = getJournalStore();

  journal.verify.ok = 0;
  journal.verify.failed = [];
  await persist(journal);

  const publishedItems: PublishItem[] = [];
  const ledgerByKey = new Map<string, LedgerLine>();

  for (const target of journal.targetProfiles) {
    const folded = await store.readLedger(journal.migrationId, target.localProfileId);
    for (const [k, line] of folded) if (line.s === 'done') ledgerByKey.set(k, line);

    // ── Palier 1 ──
    const { manifest: encrypted } = await r2.getManifest(target.targetProfileId);
    if (!encrypted) {
      return failVerification(journal, `manifeste absent pour ${target.targetProfileId}`);
    }
    let remote: SyncManifest;
    try {
      const plain = await StorageService.decryptWithRawKey(encrypted, st.incomingFek);
      remote = JSON.parse(plain.toString('utf-8')) as SyncManifest;
    } catch {
      return failVerification(journal, 'manifeste illisible sous la clé du compte');
    }
    if (!remote.profileMeta?.id || !remote.profileMeta?.name) {
      // Sans `profileMeta` exploitable, le profil cible naîtrait INADOPTABLE :
      // aucun autre appareil ne saurait le reprendre.
      return failVerification(journal, 'profileMeta absent ou non conforme');
    }

    for (const [key, line] of folded) {
      if (line.s !== 'done') continue;
      const entry = remote.files[key];
      if (!entry) return failVerification(journal, `entrée manquante: ${key}`);
      if (entry.checksum !== line.r) return failVerification(journal, `checksum: ${key}`);
      if (entry.size !== line.n) return failVerification(journal, `taille: ${key}`);
      if ((entry.chunks?.length ?? 0) !== (line.ch ?? 0)) {
        return failVerification(journal, `chunks: ${key}`);
      }
      if (line.c && entry.plaintextChecksum !== line.c) {
        return failVerification(journal, `plaintextChecksum: ${key}`);
      }
    }
    for (const key of Object.keys(remote.files)) {
      if (!folded.has(key)) return failVerification(journal, `entrée en trop: ${key}`);
    }

    for (const it of plan.order) {
      if (it.localProfileId !== target.localProfileId) continue;
      if (folded.get(it.key)?.s !== 'done') continue;
      if (it.size > VERIFY_MAX_ITEM_DOWNLOAD_BYTES) continue;
      publishedItems.push(it);
    }
  }

  // ── Palier 2 ──
  journal.verify.plan = buildVerifyPlan({
    publishedItems,
    migrationId: journal.migrationId,
    full: journal.verify.full,
  });
  await persist(journal);

  const targetOf = new Map(journal.targetProfiles.map((t) => [t.localProfileId, t]));
  const itemByKey = new Map(publishedItems.map((it) => [it.key, it]));

  for (const key of journal.verify.plan) {
    const item = itemByKey.get(key);
    const line = ledgerByKey.get(key);
    const target = item ? targetOf.get(item.localProfileId) : undefined;
    if (!item || !line || !target) {
      journal.verify.failed.push(key);
      continue;
    }
    const ok = await verifyOneItem(target.targetProfileId, key, line);
    if (ok) {
      journal.verify.ok += 1;
    } else {
      // Une panne de transfert isolée ne condamne pas : on republie UNE fois,
      // puis on revérifie. Un second échec, si.
      log.warn(`[publish] Preuve en échec sur ${key} — republication unique`);
      try {
        await processItem(item, null);
      } catch {
        journal.verify.failed.push(key);
        continue;
      }
      const retry = await verifyOneItem(target.targetProfileId, key, line);
      if (retry) journal.verify.ok += 1;
      else journal.verify.failed.push(key);
    }
    await persist(journal);
  }

  if (journal.verify.failed.length > 0) {
    journal.state = 'FAILED';
    journal.lastError = { code: 'verify-failed', itemKey: journal.verify.failed[0] };
    await persist(journal);
    return;
  }

  // La preuve est faite. La bascule reste un geste de l'utilisateur : c'est le
  // dernier instant où il peut tout arrêter sans conséquence, et le lui retirer
  // serait basculer à sa place.
  await persist(journal);
}

async function failVerification(journal: PublishJournal, why: string): Promise<void> {
  log.error(`[publish] Vérification échouée: ${why}`);
  journal.state = 'FAILED';
  journal.lastError = { code: 'verify-failed', itemKey: null };
  journal.verify.failed.push(why);
  await persist(journal);
}

/**
 * Retélécharge un élément et confronte ses octets au registre.
 *
 * Deux constats, pas un : (a) `sha256(octets stockés) === r` prouve que le
 * serveur rend BIEN ce qu'on lui a confié ; (b) pour un élément rechiffré,
 * `sha256(clair déchiffré sous la clé entrante) === c` prouve que le compte
 * saura le LIRE. Le premier seul ne dirait rien de la lisibilité ; le second
 * seul ne dirait rien de l'intégrité du transport.
 */
async function verifyOneItem(
  targetProfileId: string,
  key: string,
  line: LedgerLine
): Promise<boolean> {
  try {
    const chunkCount = Math.max(1, line.ch ?? 1);
    const parts: Buffer[] = [];
    for (let i = 0; i < chunkCount; i++) {
      parts.push(await r2.downloadChunk(targetProfileId, key, i));
    }
    const blob = Buffer.concat(parts);
    if (crypto.createHash('sha256').update(blob).digest('hex') !== line.r) return false;
    if (!line.c) return true;

    // Élément rechiffré : on prouve la LISIBILITÉ sous la clé du compte.
    const st = requireState();
    if (blob.subarray(0, 12).toString('ascii') === 'FILARRENCV3\0') {
      const tmp = path.join(
        outboxDir(st.journal.migrationId),
        `verify-${crypto.randomBytes(4).toString('hex')}.bin`
      );
      await fs.mkdir(path.dirname(tmp), { recursive: true });
      await fs.writeFile(tmp, blob, { mode: 0o600 });
      try {
        const digest = await hashV3Plaintext(st.incomingFek, tmp);
        return digest.toString('hex') === line.c;
      } finally {
        await fs.unlink(tmp).catch(() => undefined);
      }
    }
    const plain = decryptHybridFekBlob(blob, [st.incomingFek]);
    try {
      return crypto.createHash('sha256').update(plain).digest('hex') === line.c;
    } finally {
      plain.fill(0);
    }
  } catch (err) {
    log.warn(`[publish] Retéléchargement impossible pour ${key}:`, (err as Error).message);
    return false;
  }
}

// ── SWITCHING : la bascule ──────────────────────────────────────────────────

/**
 * Le dernier geste. Les trois verrous de [R1] sont vérifiés ICI, avant tout
 * contact avec un fichier de clé : tous les éléments traités, aucun blocage,
 * aucune preuve en échec.
 */
export async function commitKeySwitch(): Promise<PublishSnapshot> {
  const st = requireState();
  const journal = st.journal;

  const verdict = canSwitch(journal);
  if (!verdict.ok) {
    throw new Error(`[publish] Bascule refusée: ${verdict.reason}`);
  }

  const material = await loadIncomingMaterial();
  if (!material) throw new Error('[publish] Clé entrante absente — bascule impossible');

  // La clé ACTIVE au moment de la bascule est celle sous laquelle dort tout le
  // contenu local. On la capture ICI, avant que quoi que ce soit ne soit promu :
  // après S4 elle ne serait plus lisible nulle part.
  const oldRaw = st.activeFek ?? (await loadActiveFek());
  const oldWrapped = await fs.readFile(path.join(rootDir(), WRAPPED_FEK_FILE)).catch(() => null);

  await performSwitch({
    journal,
    locations: await keyLocations(),
    material,
    persist,
    clearIncoming: clearIncomingFek,
    relocateProfiles: () => relocateRenamedProfiles(journal),
    retainOldKey: () => retainOldActiveKey(oldRaw, oldWrapped),
    adoptInMemory: () => adoptAccountKeyInMemory(st.incomingFek),
  });

  // La clé entrante est devenue la clé ACTIVE : elle n'a plus rien à faire dans
  // les candidates « clé entrante », et le cycle ordinaire reprend. Les clés
  // RETENUES, elles, restent posées — c'est tout le contenu local qui en dépend.
  StorageService.setIncomingReadKey(null);
  await refreshRetiredReadKeys();
  syncService.setPublishSuspended(false);
  st.incomingFek.fill(0);
  await getJournalStore().purgeMigration(journal.migrationId);
  return toSnapshot(journal);
}

/**
 * S0 — conserve l'ancienne clé en LECTURE SEULE, et la pose immédiatement dans
 * les candidates de lecture.
 *
 * Lève quand il n'y a pas de clé active à retenir : sous C1, basculer sans
 * retenir la clé sous laquelle dort le contenu local rendrait ce contenu
 * inaccessible. Une bascule qui ne peut pas être sûre n'a pas lieu.
 */
async function retainOldActiveKey(
  oldRaw: Buffer | null,
  oldWrapped: Buffer | null
): Promise<void> {
  if (!oldRaw) {
    throw new Error(
      '[publish] Clé active illisible — impossible de la conserver, bascule refusée'
    );
  }
  await retainRetiredKey({ raw: oldRaw, wrapped: oldWrapped });
  await refreshRetiredReadKeys();
}

/**
 * S4b — l'adoption EN MÉMOIRE, dans la même transaction que la promotion.
 *
 * Sans elle, `getFekRawForSync()` continuait de rendre la clé de SESSION, donc
 * l'ANCIENNE, à la seconde même où l'écran annonçait le succès : toute écriture
 * dans cette fenêtre scellait sous une clé absente du trousseau, et les sondes
 * voyaient un coffre incohérent. Le renderer, lui, est prévenu par
 * `publish:key-adopted` et recharge sa propre copie depuis `hybrid:loadFEK` —
 * l'écoute est installée au BOOTSTRAP du renderer (`initPublishKeyAdoption`
 * dans `publishBridge`), pas seulement dans l'écran de migration, pour couvrir
 * une bascule achevée par la reprise au démarrage. Si l'événement part avant
 * que le renderer ne soit chargé, il est perdu — mais alors aucune copie de
 * l'ancienne clé n'existe encore là-bas, et son premier `hybrid:loadFEK` lira
 * directement la clé promue.
 */
async function adoptAccountKeyInMemory(incoming: Buffer): Promise<void> {
  try {
    sessionKeyStore.setSessionKey(new Uint8Array(incoming));
  } catch (err) {
    // Une clé de session de longueur inattendue serait un bogue en amont ; on
    // préfère l'effacer que laisser l'ANCIENNE en place et écrire avec.
    sessionKeyStore.clearSessionKey();
    log.error('[publish] Adoption en mémoire impossible:', (err as Error).message);
    throw err;
  }
  notify('publish:key-adopted', null);
}

/** Recharge les clés retenues et les pose dans les candidates de LECTURE. */
async function refreshRetiredReadKeys(): Promise<void> {
  StorageService.setRetiredReadKeys(await loadRetiredRawKeys());
}

/**
 * Appelé à l'AMORÇAGE de l'application, avant tout déverrouillage : sans cela,
 * un coffre migré s'ouvrirait avec la seule clé du compte et paraîtrait vide
 * jusqu'à ce que quelqu'un ouvre l'écran de migration (règle C7).
 */
export async function loadRetainedKeysOnStartup(): Promise<void> {
  try {
    await refreshRetiredReadKeys();
  } catch (err) {
    log.error('[publish] Clés retenues non chargées:', (err as Error).message);
  }
}

/**
 * Les clés retirées, pour le RENDERER — qui déchiffre lui-même les petits blobs
 * de profil hybride et n'ouvrirait donc rien d'antérieur à une bascule sans
 * elles. Lecture seule côté renderer : `encryptFileContent` ne les connaît pas.
 */
export async function getRetiredKeysForRenderer(): Promise<Buffer[]> {
  return loadRetiredRawKeys();
}

/**
 * Déplace les profils dont l'identifiant a dû changer — répertoire, registre
 * local des profils ET profil actif, ou RIEN : toute la conduite (idempotence,
 * réparation d'un déplacement à moitié fait, échec qui LÈVE au lieu de se
 * logger) vit dans le module pur `profileRelocation.ts`, testé par morts
 * simulées. Ne se produit que quand le manifeste distant de l'identifiant
 * local n'était PAS nul — c'est-à-dire quand la place était déjà prise.
 *
 * La version précédente avalait l'échec du `rename` (log puis poursuite) et
 * sautait la mise à jour du registre dès que le répertoire cible existait : une
 * mort entre le renommage et l'écriture du registre laissait l'appareil avec la
 * clé du compte mais l'IDENTITÉ d'avant — le cycle lisait alors l'ancien
 * manifeste nuage sous la mauvaise clé et concluait « clé forkée ». Ici, un
 * échec remonte à `finishSwitch`, la bascule ne conclut pas `DONE`, et la
 * reprise rejoue la passe jusqu'à convergence.
 */
async function relocateRenamedProfiles(journal: PublishJournal): Promise<void> {
  // Le registre est capturé par fermeture : `writeRegistry` persiste l'objet
  // MÊME que `readRegistry` a rendu (contrat du module), sans transtypage.
  let registry: ReturnType<typeof profileManager.getManifest> | null = null;

  const report = await relocatePublishedProfiles(journal.targetProfiles, {
    profileDir,
    dirExists: (dir) =>
      fs
        .access(dir)
        .then(() => true)
        .catch(() => false),
    renameDir: (from, to) => fs.rename(from, to),
    readRegistry: async () => {
      try {
        registry = profileManager.getManifest();
        return registry;
      } catch {
        // Coffre hérité sans registre initialisé : rien à réparer.
        return null;
      }
    },
    writeRegistry: async () => {
      if (registry) await profileManager.saveManifest(registry);
    },
  });

  if (report.movedDirs.length > 0 || report.repairedRegistryIds.length > 0) {
    log.info(
      `[publish] Profils déplacés: ${report.movedDirs.length} répertoire(s), ` +
        `${report.repairedRegistryIds.length} entrée(s) de registre corrigée(s)`
    );
  }
}

// ── Abandon et nettoyage ────────────────────────────────────────────────────

/**
 * Abandon — GRATUIT, à n'importe quel instant.
 *
 * Ce n'est pas une formule : sous C1, la migration n'a réécrit AUCUN fichier du
 * coffre. Il n'existe donc rien à défaire côté appareil. La clé active ne bouge
 * pas, le contenu s'ouvre exactement comme avant, et la seule chose supprimée
 * est la clé ENTRANTE — qui n'a jamais été active et dont aucun octet local ne
 * dépend. (La version précédente rescellait au fil de l'eau : abandonner y
 * rendait illisible tout ce qui avait déjà été migré. C'est ce défaut-là que
 * C1 supprime, plutôt que de le gérer.)
 *
 * Côté compte, il n'existe AUCUNE route de suppression de profil : la seule
 * conduite possible est de vider les objets puis de pousser un manifeste
 * STÉRILE, sans `profileMeta`. Sans `profileMeta`, aucun appareil n'adoptera ce
 * profil — il tombe dans l'état « semé mais jamais poussé », déjà traité comme
 * normal par la découverte de profils.
 */
export async function abandonMigration(): Promise<PublishSnapshot> {
  const st = requireState();
  const journal = st.journal;

  journal.state = 'ABANDONED';
  journal.abandonedAt = new Date().toISOString();
  await persist(journal);

  // Le ménage distant a encore besoin de la clé du compte : le manifeste
  // stérile doit être RELISIBLE par le compte, sinon on laisserait derrière
  // nous un blob que personne ne peut ouvrir — un déchet d'une autre sorte.
  // On en garde donc une copie le temps du ménage, et on efface l'original
  // tout de suite : la clé entrante ne doit plus pouvoir devenir active.
  const cleanupKey = Buffer.from(st.incomingFek);

  await discardNextKeys(await keyLocations());
  await clearIncomingFek();
  StorageService.setIncomingReadKey(null);
  st.incomingFek.fill(0);
  syncService.setPublishSuspended(false);

  void runRemoteCleanup(journal, cleanupKey)
    .catch((err) => log.warn('[publish] Ménage distant interrompu:', (err as Error).message))
    .finally(() => cleanupKey.fill(0));

  return toSnapshot(journal);
}

/**
 * Le ménage distant est LENT, et cela doit être dit.
 *
 * `DELETE /sync/file` est plafonné à 120 appels par 300 s et par utilisateur :
 * 12 000 éléments prennent plus de huit heures. C'est donc un travail de FOND,
 * reprenable, qui traverse les redémarrages. Un 429 fait attendre puis
 * reprendre — le plafond est une lenteur, pas un échec.
 */
async function runRemoteCleanup(
  journal: PublishJournal,
  accountKey: Buffer | null
): Promise<void> {
  const store = getJournalStore();
  for (const target of journal.targetProfiles) {
    const folded = await store.readLedger(journal.migrationId, target.localProfileId);
    const keys = [...folded.entries()]
      .filter(([, l]) => l.s === 'uploaded' || l.s === 'done')
      .map(([k]) => k);

    journal.cleanup.pendingDeletes = keys.length;
    for (const key of keys) {
      try {
        await r2.deleteFile(target.targetProfileId, key);
        journal.cleanup.pendingDeletes -= 1;
      } catch (err) {
        const message = (err as Error).message;
        if (message.includes('429') || /rate limit/i.test(message)) {
          journal.cleanup.lastAttemptAt = new Date().toISOString();
          await persist(journal);
          await new Promise((resolve) => setTimeout(resolve, 300_000));
          continue;
        }
        log.warn(`[publish] Suppression distante échouée pour ${key}:`, message);
      }
    }

    // Manifeste STÉRILE : pas de `profileMeta`, donc pas adoptable.
    // Sans clé de compte (ménage repris après un redémarrage, la clé entrante
    // ayant déjà été effacée), on s'en tient à la purge des objets : pousser un
    // manifeste que le compte ne saurait pas relire n'améliorerait rien.
    if (!accountKey) continue;
    try {
      const { version } = await r2.getManifest(target.targetProfileId);
      const sterile: SyncManifest = {
        version,
        profileId: target.targetProfileId,
        lastSyncAt: new Date().toISOString(),
        files: {},
        notes: {},
      };
      const encrypted = await StorageService.encryptWithRawKey(
        Buffer.from(JSON.stringify(sterile), 'utf-8'),
        accountKey
      );
      await r2.putManifest(target.targetProfileId, encrypted, version);
    } catch (err) {
      log.warn('[publish] Manifeste stérile non poussé:', (err as Error).message);
    }
  }
  journal.cleanup.lastAttemptAt = new Date().toISOString();
  await persist(journal);
}

// ── Reprise au démarrage ────────────────────────────────────────────────────

/**
 * Appelé AVANT tout déverrouillage de coffre : c'est le journal qui dit s'il
 * faut reprendre, et la reprise décide de la clé. Lire cet état après avoir
 * chargé une clé serait le lire trop tard.
 */
export async function resumeOnStartup(): Promise<PublishSnapshot | null> {
  const store = getJournalStore();

  // C7 — l'état de C2 est chargé à l'AMORÇAGE, journal ou pas. Un coffre déjà
  // migré doit s'ouvrir dès le démarrage : ses octets dorment encore sous la
  // clé retenue, et attendre l'ouverture d'un écran pour la poser ferait
  // paraître le coffre vide entre-temps.
  await loadRetainedKeysOnStartup();

  const journal = await store.read();

  if (!journal) {
    // Un `*.next` trouvé sans journal est un résidu : LE JOURNAL FAIT FOI,
    // jamais le système de fichiers.
    await discardNextKeys(await keyLocations());
    return null;
  }

  let accountUserId: string | null = null;
  try {
    const me = await getMe();
    accountUserId = me.success && me.user ? String((me.user as { id?: string }).id ?? '') : null;
  } catch {
    accountUserId = null;
  }

  const decision = decideResume(journal, accountUserId, Date.now());

  if (decision.action === 'purge-receipt') {
    await store.remove();
    await store.purgeMigration(journal.migrationId);
    return null;
  }
  if (decision.action === 'keep-receipt') {
    return toSnapshot(journal);
  }
  if (decision.action === 'abandon-foreign-account') {
    // On ne publie rien chez quelqu'un d'autre. CE QUE CE CHEMIN DÉTRUIT, dit
    // précisément : la clé ENTRANTE et les fichiers `*.next`, rien d'autre.
    // Aucun octet du coffre n'a été rescellé (C1), donc l'appareil reste
    // exactement tel qu'il était — c'est pour cela que ce geste peut être fait
    // sans demander l'avis de personne. Il ne le pouvait PAS quand la migration
    // rescellait au fil de l'eau : il rendait alors illisible tout le déjà-migré
    // au simple démarrage, sans le moindre geste de l'utilisateur.
    journal.state = 'ABANDONED';
    journal.abandonedAt = new Date().toISOString();
    await clearIncomingFek();
    await discardNextKeys(await keyLocations());
    await store.write(journal);
    return toSnapshot(journal);
  }

  const incoming = await loadIncomingFekRaw();
  if (!incoming && journal.state !== 'SWITCHING') {
    // DISTINGUER L'INDISPONIBILITÉ TRANSITOIRE DE LA DISPARITION.
    //
    // `loadIncomingFekRaw` rend `null` dans DEUX situations opposées : le
    // trousseau de l'OS n'est pas (encore) disponible — session verrouillée,
    // démarrage à froid sous Linux, trousseau non déverrouillé — ou bien la
    // clé entrante a réellement disparu. Traiter la première comme la seconde
    // faisait basculer une migration parfaitement vivante dans un état
    // TERMINAL, sur un incident qui se répare tout seul en dix secondes.
    //
    // Tant que le fichier emballé est là, la migration n'est pas perdue : on
    // laisse le journal EN L'ÉTAT et on rend la main. Le prochain démarrage —
    // ou la prochaine ouverture de l'écran — la reprendra.
    if (!keychainAvailable() || (await hasIncomingFek())) {
      log.warn(
        '[publish] Clé entrante momentanément illisible — migration laissée en l état, aucun abandon'
      );
      // La migration est VIVANTE, même si elle ne peut pas reprendre tout de
      // suite : le cycle ordinaire reste suspendu (voir la table
      // `isOrdinarySyncSuspended`). Rendre la main SANS poser la suspension
      // ouvrirait la fenêtre où la découverte de profils adopte en douce les
      // profils cibles — la panne constatée sur mobile.
      syncService.setPublishSuspended(isOrdinarySyncSuspended(journal.state));
      return toSnapshot(journal);
    }
    // Le matériel entrant n'existe vraiment plus : il n'y a plus rien à
    // publier. On referme proprement, sans jamais toucher la clé active.
    journal.state = 'ABANDONED';
    journal.abandonedAt = new Date().toISOString();
    await discardNextKeys(await keyLocations());
    await store.write(journal);
    return toSnapshot(journal);
  }

  state = {
    journal,
    plan: null,
    incomingFek: incoming ?? Buffer.alloc(0),
    activeFek: await loadActiveFek(),
    pauseRequested: false,
    running: false,
    recentRates: [],
    startedAtMs: Date.now(),
    itemsSinceStart: 0,
    currentLabel: '',
  };
  // La TABLE décide, pas un littéral : `ABANDONED` (reprise du ménage distant)
  // ne suspend PAS le cycle — le ménage dure des heures (120 suppressions /
  // 300 s) et suspendre la synchronisation pendant tout ce temps, à chaque
  // démarrage, priverait l'appareil de sync sans rien protéger. Tous les états
  // vivants, eux, suspendent.
  syncService.setPublishSuspended(isOrdinarySyncSuspended(journal.state));
  if (incoming) StorageService.setIncomingReadKey(incoming);

  if (decision.action === 'resume-switch') {
    const material = await loadIncomingMaterial();
    const locations = await keyLocations();
    const rootWrapped = await fs
      .readFile(path.join(rootDir(), WRAPPED_FEK_FILE))
      .catch(() => null);
    const rootHoldsIncoming =
      rootWrapped !== null &&
      crypto.createHash('sha256').update(rootWrapped).digest('hex') === journal.wrappedDigest;

    // La clé « ancienne » à retenir, vue depuis une reprise. Si la racine porte
    // DÉJÀ la clé du compte, la clé active lue ici EST la nouvelle : la retenir
    // est alors sans effet (elle est déjà la clé d'écriture), et la véritable
    // ancienne a été retenue avant le pivot, lors de la première tentative.
    const oldRaw = state?.activeFek ?? null;

    await resumeSwitch({
      journal,
      locations,
      // Quand la clé entrante a disparu mais que la RACINE porte déjà la
      // nouvelle, c'est elle qui fait autorité : on réécrit tout depuis elle.
      material: material ?? { wrapped: rootWrapped ?? Buffer.alloc(0), sealed: null },
      persist,
      clearIncoming: clearIncomingFek,
      relocateProfiles: () => relocateRenamedProfiles(journal),
      retainOldKey: async () => {
        if (!oldRaw) return; // Coffre verrouillé : rien de lisible à retenir.
        await retainRetiredKey({ raw: oldRaw, wrapped: rootHoldsIncoming ? null : rootWrapped });
        await refreshRetiredReadKeys();
      },
      adoptInMemory: async () => {
        // Sans clé entrante en mémoire (reprise « promote-from-root »), la
        // session ne peut pas être adoptée ici : on l'EFFACE plutôt que de
        // laisser l'ancienne servir de clé d'écriture. Le renderer repoussera
        // la bonne au prochain déverrouillage.
        if (incoming && incoming.length > 0) await adoptAccountKeyInMemory(incoming);
        else sessionKeyStore.clearSessionKey();
      },
      incomingKeyPresent: material !== null,
      rootHoldsIncoming,
    });
    if (journal.state === 'DONE') {
      StorageService.setIncomingReadKey(null);
      await refreshRetiredReadKeys();
    }
    // Après la reprise de bascule, l'état peut être DONE (fin), FAILED (rien
    // promu) ou PUBLISHING (retour en arrière) : la table tranche pour chacun.
    syncService.setPublishSuspended(isOrdinarySyncSuspended(journal.state));
    return toSnapshot(journal);
  }

  if (decision.action === 'resume-cleanup') {
    void runRemoteCleanup(journal, incoming).catch(() => undefined);
    return toSnapshot(journal);
  }

  if (decision.action === 'resume-publish' || decision.action === 'restart-verify') {
    // On ne bloque pas le démarrage de l'application là-dessus : reconstruire
    // l'inventaire lit tout le coffre, et l'utilisateur doit pouvoir ouvrir sa
    // fenêtre pendant ce temps.
    void resumeAfterRestart().catch((err) =>
      log.error('[publish] Reprise de la publication impossible:', (err as Error).message)
    );
    return toSnapshot(journal);
  }

  if (decision.nextState) {
    journal.state = decision.nextState;
    await store.write(journal);
  }
  return toSnapshot(journal);
}

export async function getSnapshot(): Promise<PublishSnapshot | null> {
  if (state) return toSnapshot(state.journal);
  const journal = await getJournalStore().read();
  return journal ? toSnapshot(journal) : null;
}

export async function hasPendingMigration(): Promise<boolean> {
  return (await hasIncomingFek()) || (await getJournalStore().read()) !== null;
}

/** Reprend la boucle après un `FAILED` réseau ou un élargissement de quota. */
export async function retryPublishing(): Promise<void> {
  const st = requireState();
  if (st.journal.state !== 'FAILED' && st.journal.state !== 'READY') return;
  await startPublishing();
}

function requireState(): EngineState {
  if (!state) throw new Error('[publish] Aucune migration ouverte');
  return state;
}

/** Réservé aux tests d'intégration du process principal. */
export function __resetEngineForTests(): void {
  state = null;
}
