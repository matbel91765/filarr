/**
 * TRANSPORT DES RAPPELS DE NOTE ET DES RAPPELS LIBRES — format et fusion.
 *
 * ── LE PROBLÈME ─────────────────────────────────────────────────────────────
 * Le bureau range DEUX familles de rappels à la racine du profil, hors de tout
 * `metadata.json` de dossier :
 *
 *   · `noteReminders.json`     — rappels accrochés à une NOTE. Le coffre de
 *     notes est un blob que le renderer possède ; le processus principal ne sait
 *     pas parcourir `note.reminders[]`, d'où ce fichier frère ;
 *   · `calendarReminders.json` — rappels LIBRES, accrochés à rien.
 *
 * Le manifeste de synchronisation ne poussait que `{folderId}/metadata.json` et
 * les deux blobs racine (`notes.enc`, `layout.enc`). Ces deux fichiers-là ne
 * voyageaient donc PAS : un rappel de note créé sur l'ordinateur restait sur
 * l'ordinateur, et le téléphone n'en savait rien. Le rappel le plus utile — « me
 * prévenir à propos de CETTE note » — était précisément celui qui ne suivait pas
 * l'utilisateur.
 *
 * ── LE FORMAT, ET POURQUOI CELUI-LÀ ─────────────────────────────────────────
 * LE DOCUMENT TRANSPORTÉ EST LE FICHIER LUI-MÊME : un TABLEAU JSON de rappels,
 * scellé par `StorageService.encrypt` (famille « v2: », clé machine du profil)
 * exactement comme `layout.enc` et les `metadata.json`. Pas d'enveloppe, pas de
 * champ `version`, pas d'horodatage de document.
 *
 * Ce n'est pas de la paresse, c'est une contrainte : `getCalendarReminders` et
 * `getNoteReminders` lisent DÉJÀ ces fichiers et exigent un tableau
 * (`Array.isArray(data) ? data : []`). Envelopper aurait rendu tous les fichiers
 * existants illisibles par les versions déjà installées, et une version
 * antérieure de Filarr aurait vu « aucun rappel » au lieu des siens. Le format
 * reste donc COMPATIBLE OCTET POUR OCTET avec ce qui est sur les disques
 * aujourd'hui.
 *
 * Chaque élément porte les champs du type `Reminder` du bureau, plus deux :
 *
 *   · `updatedAt` — ISO 8601. C'est LA clé d'arbitrage (dernier écrivain gagne,
 *     ÉGALITÉ AU LOCAL). Absent, il vaut `createdAt`, puis 0 : un enregistrement
 *     sans horloge perd contre tout le monde, ce qui est le comportement voulu ;
 *   · `deletedAt` — ISO 8601, OPTIONNEL. PIERRE TOMBALE. Retirer un rappel du
 *     tableau ne suffit pas : l'autre appareil le porte encore et la descente
 *     suivante le ressusciterait. L'enregistrement reste donc, marqué, jusqu'à ce
 *     que les deux côtés l'aient vu — puis il est purgé après `TOMBSTONE_TTL_MS`.
 *
 * ⚠ UN LECTEUR QUI IGNORE `deletedAt` VOIT LA PIERRE TOMBALE COMME UN RAPPEL.
 * C'est le prix du tableau nu, et il se paie côté LECTURE : `liveReminders`
 * filtre, et `getAllReminders` l'applique. Toute nouvelle lecture de ces fichiers
 * doit en faire autant.
 *
 * ── CLÉS DE MANIFESTE ───────────────────────────────────────────────────────
 * `meta:note-reminders` et `meta:calendar-reminders`, sur le modèle de
 * `meta:layout` : réservées, jamais confondues avec un `meta:{folderId}` (un
 * identifiant de dossier est un UUID, jamais l'une de ces deux chaînes).
 *
 * Le mobile implémente le MÊME format. Ce commentaire est le contrat : le
 * modifier casse l'autre plateforme.
 */

import {
  dedupeRemindersById,
  reminderClockMs,
  type StoredReminder,
} from './reminderMetaCore';

// ── Constantes de protocole ─────────────────────────────────────────────────

/** Nom du fichier des rappels de NOTE, à la racine du profil. */
export const NOTE_REMINDERS_FILENAME = 'noteReminders.json';

/** Nom du fichier des rappels LIBRES, à la racine du profil. */
export const CALENDAR_REMINDERS_FILENAME = 'calendarReminders.json';

/** Clé de manifeste des rappels de note. */
export const NOTE_REMINDERS_META_FILE_ID = 'meta:note-reminders';

/** Clé de manifeste des rappels libres. */
export const CALENDAR_REMINDERS_META_FILE_ID = 'meta:calendar-reminders';

/** Ressources passées à `notifyMetadataChanged` (qui préfixe par `meta:`). */
export const NOTE_REMINDERS_META_RESOURCE_ID = 'note-reminders';
export const CALENDAR_REMINDERS_META_RESOURCE_ID = 'calendar-reminders';

/** Les deux familles et leur fichier — pour les balayages génériques. */
export const REMINDER_META_FILES: ReadonlyArray<{
  fileId: string;
  resourceId: string;
  filename: string;
}> = [
  {
    fileId: NOTE_REMINDERS_META_FILE_ID,
    resourceId: NOTE_REMINDERS_META_RESOURCE_ID,
    filename: NOTE_REMINDERS_FILENAME,
  },
  {
    fileId: CALENDAR_REMINDERS_META_FILE_ID,
    resourceId: CALENDAR_REMINDERS_META_RESOURCE_ID,
    filename: CALENDAR_REMINDERS_FILENAME,
  },
];

/** Ces deux clés, en jeu, pour les gardes du manifeste et de la descente. */
export const REMINDER_META_FILE_IDS: ReadonlySet<string> = new Set(
  REMINDER_META_FILES.map((f) => f.fileId)
);

/** Le fichier porté par une clé de manifeste de rappels, ou `null`. */
export function reminderMetaFilename(fileId: string): string | null {
  return REMINDER_META_FILES.find((f) => f.fileId === fileId)?.filename ?? null;
}

/**
 * Durée de vie d'une pierre tombale — trente jours, le même ordre de grandeur
 * que la corbeille du coffre et que `TOMBSTONE_MAX_AGE_MS` du mobile.
 *
 * Le délai n'est pas décoratif : un appareil peut rester hors ligne longtemps, et
 * purger trop tôt ferait RÉAPPARAÎTRE le rappel supprimé à la première
 * reconnexion — la suppression d'un côté annulée par le silence de l'autre.
 */
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ── Lecture ─────────────────────────────────────────────────────────────────

/**
 * Le document tel qu'il voyage : un tableau, et rien d'autre.
 *
 * Tout ce qui n'est pas un tableau rend un tableau VIDE — un fichier illisible
 * n'est pas un fichier plein de rappels. Les éléments qui ne sont pas des objets
 * identifiés sont écartés : ils ne pourraient être ni arbitrés ni supprimés.
 */
export function normalizeReminderDoc(input: unknown): StoredReminder[] {
  if (!Array.isArray(input)) return [];
  const out: StoredReminder[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const rec = raw as StoredReminder;
    if (typeof rec.id !== 'string' || rec.id === '') continue;
    out.push(rec);
  }
  return dedupeRemindersById(out);
}

/** Une pierre tombale, ou un rappel bien vivant ? */
export function isTombstone(reminder: StoredReminder): boolean {
  return typeof reminder.deletedAt === 'string' && reminder.deletedAt.length > 0;
}

/**
 * Les rappels VIVANTS d'un document. À appliquer partout où le fichier est lu
 * pour être MONTRÉ ou PROGRAMMÉ — sans quoi une suppression faite ailleurs
 * s'afficherait comme un rappel ordinaire.
 */
export function liveReminders(reminders: readonly StoredReminder[]): StoredReminder[] {
  return reminders.filter((r) => !isTombstone(r));
}

// ── Suppression ─────────────────────────────────────────────────────────────

/**
 * Marque un rappel comme SUPPRIMÉ au lieu de le retirer.
 *
 * Le contenu est vidé de ce qui pourrait être sensible — un intitulé de rappel
 * dit quelque chose de la vie de l'utilisateur, et le garder trente jours pour la
 * seule commodité d'un arbitrage serait un mauvais échange. Restent l'identité,
 * l'ancrage et les horloges : le strict nécessaire pour que l'autre appareil
 * comprenne QUOI supprimer.
 */
export function toTombstone(reminder: StoredReminder, nowIso: string): StoredReminder {
  const out: StoredReminder = {
    id: reminder.id,
    updatedAt: nowIso,
    deletedAt: nowIso,
  };
  if (reminder.itemId !== undefined) out.itemId = reminder.itemId;
  if (reminder.itemType !== undefined) out.itemType = reminder.itemType;
  if (reminder.createdAt !== undefined) out.createdAt = reminder.createdAt;
  return out;
}

/** Purge les pierres tombales assez vieilles pour que tout le monde les ait vues. */
export function pruneExpiredTombstones(
  reminders: readonly StoredReminder[],
  nowMs: number,
  ttlMs: number = TOMBSTONE_TTL_MS
): StoredReminder[] {
  return reminders.filter((r) => {
    if (!isTombstone(r)) return true;
    const at = new Date(r.deletedAt as string).getTime();
    // Horodatage illisible : on purge plutôt que de garder pour toujours un
    // enregistrement dont on ne saura jamais dire l'âge.
    if (Number.isNaN(at)) return false;
    return nowMs - at <= ttlMs;
  });
}

// ── Fusion ──────────────────────────────────────────────────────────────────

/** Résultat d'une fusion de documents de rappels. */
export interface ReminderDocMerge {
  merged: StoredReminder[];
  /** Le résultat diffère du LOCAL → il faut réécrire le fichier. */
  changedFromLocal: boolean;
  /** Le résultat diffère du DISTANT → il faut le republier. */
  changedFromRemote: boolean;
}

/**
 * Deux documents comparés à l'identique ? Comparaison sur le JSON à clés
 * TRIÉES : deux appareils qui ont construit le même état par des chemins
 * différents doivent en tirer les mêmes octets, sinon chacun republierait à
 * chaque cycle un fichier que l'autre trouve déjà bon.
 */
function stableJson(reminders: readonly StoredReminder[]): string {
  return JSON.stringify(
    reminders.map((r) => {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(r).sort()) out[k] = r[k];
      return out;
    })
  );
}

/**
 * FUSIONNE DEUX DOCUMENTS DE RAPPELS, enregistrement par enregistrement.
 *
 * ── LES RÈGLES, ET CE QU'ELLES COÛTENT ──────────────────────────────────────
 * 1. UNION PAR IDENTIFIANT. Un rappel présent d'un seul côté est GARDÉ. Son
 *    absence de l'autre ne dit rien : le fichier ne porte pas de journal, donc
 *    « je ne l'ai pas » ne se distingue pas de « je ne l'ai pas encore ». C'est
 *    pour cela que la suppression a besoin d'une pierre tombale.
 * 2. ARBITRAGE À `updatedAt`, ÉGALITÉ AU LOCAL — même convention que
 *    `mergeFolderMeta` et que `mergeFolderReminders` du mobile. Aligner les
 *    trois évite qu'un même rappel soit arbitré dans un sens ici et dans l'autre
 *    là-bas.
 * 3. UNE PIERRE TOMBALE EST UN ENREGISTREMENT COMME UN AUTRE. Elle gagne si elle
 *    est plus récente, elle perd sinon : rouvrir un rappel après l'avoir
 *    supprimé est un geste légitime, et l'horloge le dit.
 * 4. ORDRE STABLE (par identifiant). Deux appareils qui fusionnent le même
 *    couple doivent produire les MÊMES octets — sans quoi le condensat diffère et
 *    chacun republie éternellement.
 */
export function mergeReminderDocs(
  localInput: unknown,
  remoteInput: unknown,
  nowMs: number = Date.now(),
  ttlMs: number = TOMBSTONE_TTL_MS
): ReminderDocMerge {
  const local = normalizeReminderDoc(localInput);
  const remote = normalizeReminderDoc(remoteInput);

  const byId = new Map<string, StoredReminder>();
  for (const entry of local) byId.set(entry.id, entry);
  for (const entry of remote) {
    const mine = byId.get(entry.id);
    if (!mine) {
      byId.set(entry.id, entry);
      continue;
    }
    // Strictement PLUS RÉCENT pour l'emporter : l'égalité reste au local.
    if (reminderClockMs(entry) > reminderClockMs(mine)) byId.set(entry.id, entry);
  }

  const merged = pruneExpiredTombstones(
    [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    nowMs,
    ttlMs
  );

  return {
    merged,
    changedFromLocal: stableJson(merged) !== stableJson(local),
    changedFromRemote: stableJson(merged) !== stableJson(remote),
  };
}
