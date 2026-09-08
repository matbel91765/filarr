/**
 * Sync Queue — Persistent disk-backed queue for sync operations
 *
 * Survives crashes and restarts.
 * Shared across profiles (profileId is per-item).
 * Deduplicates by resourceId + type + profileId.
 * Exponential backoff: 30s → 5min → 30min → stop retrying.
 *
 * Storage: {userData}/FilarData/sync-queue.json
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { cheminDeStaging } from '../atomicStaging';
import { app } from 'electron';
import log from 'electron-log';

// ── Types ───────────────────────────────────────────────────────────────────

export type QueueItemType = 'upload' | 'download' | 'delete';
export type ResourceType = 'file' | 'note' | 'manifest';
export type Priority = 'high' | 'normal' | 'low';

export interface SyncQueueItem {
  id: string;
  type: QueueItemType;
  resourceType: ResourceType;
  resourceId: string;
  profileId: string;
  priority: Priority;
  attempts: number;
  maxAttempts: number;
  lastAttempt: string | null;
  nextRetry: string | null;
  error: string | null;
  createdAt: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

const QUEUE_FILE = 'sync-queue.json';
const MAX_ATTEMPTS = 3;

// Backoff delays in milliseconds
const BACKOFF_DELAYS = [
  30 * 1000, // 1st retry: 30 seconds
  5 * 60 * 1000, // 2nd retry: 5 minutes
  30 * 60 * 1000, // 3rd retry: 30 minutes
];

const PRIORITY_ORDER: Record<Priority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

// ── Path ────────────────────────────────────────────────────────────────────

function getQueuePath(): string {
  return path.join(app.getPath('userData'), 'FilarData', QUEUE_FILE);
}

// ── Load / Save ─────────────────────────────────────────────────────────────

export async function load(): Promise<SyncQueueItem[]> {
  try {
    const raw = await fs.readFile(getQueuePath(), 'utf-8');
    return JSON.parse(raw) as SyncQueueItem[];
  } catch {
    return [];
  }
}

async function save(items: SyncQueueItem[]): Promise<void> {
  const filePath = getQueuePath();
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  // Atomic write
  // Nom de staging UNIQUE — voir `atomicStaging`. Un `.tmp` partagé donnait
  // EPERM ou ENOENT dès que deux écritures de la file se croisaient.
  const tmpPath = cheminDeStaging(filePath);
  await fs.writeFile(tmpPath, JSON.stringify(items, null, 2), 'utf-8');
  await fs.rename(tmpPath, filePath);
}

// ── Enqueue ─────────────────────────────────────────────────────────────────

/**
 * Add an item to the queue. Deduplicates by resourceId + type + profileId.
 * If an identical pending item exists, it's silently ignored.
 */
export async function enqueue(item: {
  type: QueueItemType;
  resourceType: ResourceType;
  resourceId: string;
  profileId: string;
  priority?: Priority;
}): Promise<void> {
  const items = await load();

  // Deduplicate: skip if same resourceId + type + profileId already pending
  const existing = items.find(
    (i) =>
      i.resourceId === item.resourceId &&
      i.type === item.type &&
      i.profileId === item.profileId &&
      i.attempts < MAX_ATTEMPTS
  );

  if (existing) {
    log.info(
      `[syncQueue] Skipping duplicate: ${item.type} ${item.resourceType} ${item.resourceId}`
    );
    return;
  }

  const newItem: SyncQueueItem = {
    id: crypto.randomUUID(),
    type: item.type,
    resourceType: item.resourceType,
    resourceId: item.resourceId,
    profileId: item.profileId,
    priority: item.priority || 'normal',
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    lastAttempt: null,
    nextRetry: null,
    error: null,
    createdAt: new Date().toISOString(),
  };

  items.push(newItem);
  await save(items);

  log.info(
    `[syncQueue] Enqueued: ${item.type} ${item.resourceType} ${item.resourceId} (${item.priority || 'normal'})`
  );
}

// ── Dequeue ─────────────────────────────────────────────────────────────────

/**
 * Get up to `n` items ready to process.
 * Returns items whose nextRetry <= now (or nextRetry is null = first attempt),
 * with attempts < maxAttempts, sorted by priority (high first).
 */
export async function dequeue(n: number): Promise<SyncQueueItem[]> {
  const items = await load();
  const now = Date.now();

  const ready = items.filter((item) => {
    // Already exhausted retries
    if (item.attempts >= item.maxAttempts) return false;

    // First attempt (no nextRetry set)
    if (!item.nextRetry) return true;

    // Retry time has passed
    return new Date(item.nextRetry).getTime() <= now;
  });

  // Sort by priority
  ready.sort(
    (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
  );

  return ready.slice(0, n);
}

// ── Mark Success ────────────────────────────────────────────────────────────

/**
 * Remove a completed item from the queue.
 */
export async function markSuccess(id: string): Promise<void> {
  const items = await load();
  const filtered = items.filter((i) => i.id !== id);

  if (filtered.length !== items.length) {
    await save(filtered);
    log.info(`[syncQueue] Completed: ${id}`);
  }
}

// ── Mark Failed ─────────────────────────────────────────────────────────────

/**
 * Record a failure. Increments attempts, computes next retry with backoff.
 * After maxAttempts, the item stays in the queue for visibility but won't be retried.
 */
export async function markFailed(
  id: string,
  error: string
): Promise<void> {
  const items = await load();
  const item = items.find((i) => i.id === id);

  if (!item) return;

  item.attempts++;
  item.lastAttempt = new Date().toISOString();
  item.error = error;

  if (item.attempts < item.maxAttempts) {
    const delayMs = BACKOFF_DELAYS[item.attempts - 1] || BACKOFF_DELAYS[BACKOFF_DELAYS.length - 1];
    item.nextRetry = new Date(Date.now() + delayMs).toISOString();
    log.warn(
      `[syncQueue] Failed (attempt ${item.attempts}/${item.maxAttempts}), retry in ${delayMs / 1000}s: ${id} — ${error}`
    );
  } else {
    item.nextRetry = null; // Won't be retried
    log.error(
      `[syncQueue] Exhausted retries (${item.maxAttempts}): ${id} — ${error}`
    );
  }

  await save(items);
}

// ── Queries ─────────────────────────────────────────────────────────────────

/**
 * Get all items that have exhausted their retries.
 */
export async function getFailedItems(): Promise<SyncQueueItem[]> {
  const items = await load();
  return items.filter((i) => i.attempts >= i.maxAttempts);
}

/**
 * REARMER UN ECHEC EPUISE — la reprise que l'utilisateur demande lui-meme.
 *
 * `dequeue` ecarte tout element dont `attempts >= maxAttempts`, definitivement.
 * L'affichage disait deja « Abandonne apres 3 tentatives » et le code de
 * `sync:getActivity` annonçait « l'utilisateur doit relancer lui-meme » -- sauf
 * qu'aucun chemin ne le permettait. La seule sortie etait de vider la file
 * entiere, ce qui emporte aussi le travail encore programme.
 *
 * Remet le compteur a zero et efface l'erreur : l'element redevient un element
 * neuf, avec un budget de tentatives complet et le meme escalier de report
 * derriere lui. `nextRetry: null` le rend eligible IMMEDIATEMENT (voir
 * `dequeue`) — quelqu'un qui appuie sur « Reessayer » demande maintenant, pas
 * dans trente secondes.
 *
 * ⚠ N'AGIT QUE SUR UN ELEMENT EPUISE. Rearmer un element qui attend encore son
 * essai lui rendrait un budget qu'il n'a pas depense : trois echecs pourraient
 * se rejouer sans fin tant que quelqu'un clique, et le plafond de tentatives ne
 * voudrait plus rien dire. Rend `false` dans ce cas, sans rien modifier.
 */
export async function rearm(id: string): Promise<boolean> {
  const items = await load();
  const item = items.find((i) => i.id === id);
  if (!item || item.attempts < item.maxAttempts) return false;

  item.attempts = 0;
  item.nextRetry = null;
  item.error = null;
  await save(items);
  log.info(`[syncQueue] Rearme a la demande : ${item.type} ${item.resourceId}`);
  return true;
}

/**
 * ECARTER UN ECHEC EPUISE — sans corriger quoi que ce soit, et en le sachant.
 *
 * Il y a des echecs qu'on ne peut pas reparer : un objet distant reellement
 * corrompu, un fichier supprime ailleurs. Sans cette sortie, la seule option
 * etait de vivre avec un badge rouge permanent, ce qui apprend a ignorer
 * l'indicateur — exactement le contraire de ce qu'il sert a faire.
 *
 * ⚠ REFUSE un element non epuise, pour la meme raison que `rearm` : celui-la
 * n'a pas echoue, il ATTEND. L'ecarter annulerait en silence un travail encore
 * programme, et c'est une perte de donnees deguisee en menage.
 *
 * A la difference de `reapResolvedFailures`, ceci n'affirme rien sur l'etat
 * reel de la ressource : c'est un geste de l'utilisateur, pas un constat. Si le
 * desaccord existe toujours, la fusion du prochain cycle le reprogrammera.
 */
export async function dismiss(id: string): Promise<boolean> {
  const items = await load();
  const item = items.find((i) => i.id === id);
  if (!item || item.attempts < item.maxAttempts) return false;

  await save(items.filter((i) => i.id !== id));
  log.info(`[syncQueue] Ecarte a la demande : ${item.type} ${item.resourceId} — ${item.error}`);
  return true;
}

/**
 * RETIRER LES PIERRES TOMBALES DONT LE TRAVAIL A FINI PAR SE FAIRE.
 *
 * ── LE DEFAUT, OBSERVE EN PRODUCTION ────────────────────────────────────────
 *
 * `markFailed` garde deliberement un element epuise « pour la visibilite », et
 * RIEN ne le retire jamais : `markSuccess` s'appelle avec l'identifiant d'un
 * element qu'on vient de traiter, or un element epuise n'est plus jamais
 * dequeue. La sortie de la file etait donc a sens unique.
 *
 * Consequence : une descente de `meta:...` a echoue le 13 aout sur un desaccord
 * de somme de controle, un cycle ULTERIEUR a fait converger les deux cotes, et
 * le badge rouge est reste allume DIX-NEUF JOURS sur un probleme resolu. Pire
 * qu'inutile : il apprend a ignorer l'indicateur qui devra un jour signaler une
 * vraie perte.
 *
 * ── CE QUI AUTORISE LE RETRAIT ──────────────────────────────────────────────
 *
 * `estResolu` est fourni par l'appelant, qui seul detient les manifestes. La
 * regle qu'il applique demande DEUX signaux concordants (voir `syncService`),
 * jamais un seul :
 *
 *   · la fusion du cycle n'a programme AUCUN travail pour cette ressource ;
 *   · et l'entree locale se declare `synced`.
 *
 * ⚠ Le premier seul serait une ABSENCE d'information -- une ressource disparue
 * des deux cotes n'apparait pas non plus dans le travail du cycle, et un
 * verdict definitif tire d'une absence est exactement ce qu'on s'interdit ici.
 * Le second seul ne suffit pas davantage : `synced` decrit le disque local, pas
 * l'accord avec le nuage. Ensemble, ils disent quelque chose de POSITIF : la
 * fusion a examine cette entree ce cycle-ci et conclu qu'il n'y a rien a faire.
 *
 * Rend le nombre d'elements retires.
 */
export async function reapResolvedFailures(
  profileId: string,
  estResolu: (item: SyncQueueItem) => boolean
): Promise<number> {
  const items = await load();
  const restants = items.filter(
    (i) => !(i.profileId === profileId && i.attempts >= i.maxAttempts && estResolu(i))
  );

  const retires = items.length - restants.length;
  if (retires > 0) {
    await save(restants);
    for (const i of items) {
      if (!restants.includes(i)) {
        log.info(
          `[syncQueue] Echec perime retire (la ressource a converge depuis) : ` +
            `${i.type} ${i.resourceId} — ${i.error}`
        );
      }
    }
  }
  return retires;
}

/**
 * Get count of pending items (not yet exhausted).
 */
export async function getPendingCount(): Promise<number> {
  const items = await load();
  return items.filter((i) => i.attempts < i.maxAttempts).length;
}

/**
 * Clear all items for a specific profile.
 */
export async function clearProfile(profileId: string): Promise<void> {
  const items = await load();
  const filtered = items.filter((i) => i.profileId !== profileId);
  await save(filtered);
  log.info(`[syncQueue] Cleared queue for profile ${profileId}`);
}

/**
 * Clear all items from the queue.
 */
export async function clearAll(): Promise<void> {
  await save([]);
  log.info('[syncQueue] Queue cleared');
}
