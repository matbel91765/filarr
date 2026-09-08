import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/**
 * Fusion NOTE À NOTE du store de notes — module PUR (ni IndexedDB ni crypto).
 *
 * POURQUOI. Le desktop traite `notes.enc` comme un fichier unique : dernier
 * écrivain gagne au niveau du BLOB. Appliquer cette règle au web, dont le store
 * a divergé du desktop pendant des jours, effacerait d'un côté ou de l'autre
 * tout ce que l'autre a écrit entre-temps. Le blob étant du JSON structuré
 * porteur d'horodatages PAR NOTE, on fusionne au grain de la note.
 *
 * RÈGLES (aucune ne supprime jamais rien) :
 *  - `byId` : union par id. Collision → l'entrée dont l'horloge est la plus
 *    récente gagne ; horloge absente/illisible = -∞ (perd face à une horloge
 *    valide) ; ÉGALITÉ = le LOCAL est conservé.
 *  - Les notes supprimées portent `deletedAt` (suppression douce) : ce sont des
 *    notes comme les autres, RIEN n'est filtré. Leur horloge inclut `deletedAt`
 *    (voir `clockOf`).
 *  - `allIds` : reconstruit depuis les clés de `byId` fusionné — ordre local
 *    d'abord, ids distants nouveaux ensuite, puis tout id de `byId` qu'aucune
 *    des deux listes ne citait. Un id présent dans `byId` n'est jamais perdu.
 *  - `notebooks` (Record) et `templates` (tableau, identifiés par id) : union
 *    par id, même règle d'horloge ; sans horloge d'aucun côté, le distant ne
 *    remplace pas un local existant (l'ajout ne détruit pas).
 *  - Tout AUTRE champ : valeur locale si la clé existe localement, sinon la
 *    distante. Jamais de perte, jamais d'écrasement.
 *
 * SEULE EXCEPTION à « rien ne disparaît » : les SUPPRESSIONS DÉFINITIVES.
 * `permanentlyDeleteNote` & co retirent vraiment la note du store ; sans trace,
 * l'union la fait revenir du nuage au cycle suivant, indéfiniment. Le payload
 * porte donc deux registres de pierres tombales durables — `purged` (notes) et
 * `purgedNotebooks` (carnets), `id → purgedAt` ISO — et la fusion soustrait de
 * l'union tout id dont le `purgedAt` est POSTÉRIEUR à l'horloge de l'entrée d'en
 * face (une modification faite après la purge gagne : elle est plus récente que
 * la décision de purger). Les pierres de plus de 90 jours sont oubliées pour que
 * les registres ne grossissent pas sans fin. Le desktop ignore ces champs mais
 * les PERSISTE (il réécrit le payload entier), donc ils font l'aller-retour.
 *
 * INVARIANT DUR, vérifié ID PAR ID : toute note du `byId` local se retrouve dans
 * le `byId` fusionné, SAUF celles qu'une pierre de purge plus récente qu'elles a
 * légitimement retirées. Un simple comptage ne prouverait rien (une note perdue
 * compensée par une note distante gagnée passerait au travers) ; ici chaque id
 * local est réclamé nommément. `mergeNotesPayload` jette plutôt que de rendre un
 * store amputé ; l'appelant compte l'échec et ne réécrit rien.
 *
 * CE QUE L'ARBITRAGE DÉTRUIT QUAND MÊME. « Rien ne disparaît » vaut au grain de
 * l'ID, pas du CONTENU : quand la même note a été éditée des deux côtés, l'entrée
 * la plus fraîche remplace l'autre et le texte perdant s'évapore. La fusion le
 * SIGNALE désormais (`overwritten`) et sait fabriquer la copie de sauvegarde
 * (`applyConflictCopies`) — l'équivalent pour les notes du `_conflict_<horodatage>`
 * que le desktop fabrique déjà pour les fichiers ordinaires.
 */

export interface NotesPayload {
  byId?: unknown;
  allIds?: unknown;
  templates?: unknown;
  notebooks?: unknown;
  purged?: unknown;
  purgedNotebooks?: unknown;
  [key: string]: unknown;
}

/**
 * Une entrée dont le CONTENU a été détruit par l'arbitrage d'horloge : les deux
 * côtés la portaient, avec des contenus DIFFÉRENTS, et l'horloge a tranché. Ce
 * n'est ni un ajout (un seul côté la portait), ni une convergence (contenus
 * identiques) : c'est la seule situation où fusionner perd du texte.
 */
export interface OverwrittenEntry {
  id: string;
  kind: 'note' | 'notebook';
  /** Le côté dont le contenu a PERDU — c'est lui qu'il faut conserver. */
  side: 'local' | 'remote';
  /** L'entrée perdante, telle quelle. */
  losing: unknown;
}

export interface NotesMergeResult {
  merged: NotesPayload;
  /** La fusion diffère du store LOCAL → il faut réécrire. */
  changedFromLocal: boolean;
  /** La fusion diffère du conteneur DISTANT → le local porte du neuf à pousser. */
  changedFromRemote: boolean;
  /**
   * Au moins une entrée de `byId` diffère du local (ajoutée, modifiée ou
   * purgée). SEUL ce drapeau autorise à prévenir le renderer : `notes-updated`
   * lui fait remplacer TOUT son store depuis le disque, ce qui écrase la frappe
   * en cours pas encore passée par l'auto-save. Une simple normalisation
   * (reconstruction d'`allIds`, adoption d'un champ inconnu) ne le lève pas.
   */
  remoteContentChanged: boolean;
  /**
   * Un registre de purge (`purged` / `purgedNotebooks`) diffère du local. Le
   * renderer DOIT être prévenu dans ce cas aussi : son store Redux reconstruit
   * le payload à chaque sauvegarde, et s'il n'a pas rechargé les pierres que la
   * fusion vient d'apporter, la sauvegarde suivante les efface du disque — les
   * notes définitivement supprimées ressuscitent alors au cycle d'après.
   */
  purgeRegistryChanged: boolean;
  /**
   * Les entrées dont l'arbitrage d'horloge a DÉTRUIT le contenu perdant, notes
   * d'abord puis carnets. Rapport brut : c'est à l'appelant de trier ce qui
   * mérite une copie de sauvegarde (`selectGenuineConflicts`) — une entrée que
   * l'autre côté n'a fait que rattraper n'a rien perdu.
   */
  overwritten: OverwrittenEntry[];
}

/** Clé de l'entrée `meta:notes` du manifeste (miroir de syncService.ts:1571). */
export const NOTES_META_FILE_ID = 'meta:notes';

/** `folderId` conventionnel du registre pending pour cette ressource. */
export const NOTES_META_RESOURCE_ID = 'notes';

/** Registre des NOTES définitivement supprimées (`id → purgedAt` ISO). */
export const PURGED_NOTES_KEY = 'purged';

/** Registre des CARNETS définitivement supprimés (`id → purgedAt` ISO). */
export const PURGED_NOTEBOOKS_KEY = 'purgedNotebooks';

/**
 * Durée de vie d'une pierre tombale de purge. Passé ce délai, l'appareil qui
 * n'a pas synchronisé depuis 90 jours ressusciterait la note — mais garder les
 * pierres pour l'éternité fait grossir le payload à chaque suppression
 * définitive, sur TOUS les appareils. 90 jours = la fenêtre de rétention la
 * plus longue déjà pratiquée par la corbeille.
 */
export const PURGE_TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

type Dict = Record<string, unknown>;

function isPlainObject(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const has = (o: Dict, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Horloge d'une entrée = la PLUS RÉCENTE de ses dates de mutation.
 *
 * `updatedAt` seul ne suffit pas : `deleteNote` (notesSlice.ts:282) pose
 * `deletedAt` SANS toucher `updatedAt`. Une tombstone aurait donc exactement
 * l'horloge de la note vivante d'en face, l'égalité garderait le local, et une
 * suppression faite sur le desktop ressusciterait sur le web — puis serait
 * repoussée vers le desktop. Prendre le max des deux dates ordonne correctement
 * « modifiée » puis « supprimée ».
 */
export function clockOf(entry: unknown): number {
  if (!isPlainObject(entry)) return -Infinity;
  let best = -Infinity;
  for (const field of ['updatedAt', 'deletedAt']) {
    const raw = entry[field];
    if (typeof raw !== 'string') continue;
    const ms = Date.parse(raw);
    if (!Number.isNaN(ms) && ms > best) best = ms;
  }
  return best;
}

/**
 * EMPREINTE DE DÉPARTAGE — la même que `digestOf` de la v2 (SHA-256 de la
 * sérialisation à clés triées, 32 hexadécimaux), pour qu'un appareil resté en
 * v1 et un appareil passé en v2 tranchent une égalité EXACTEMENT de la même
 * façon. Synchrone (@noble/hashes) : la fusion l'est.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}

export function noteTieDigest(entry: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(stableStringify(entry)))).slice(0, 32);
}

/**
 * Le distant doit être STRICTEMENT plus frais pour gagner. À HORLOGE ÉGALE, le
 * départage est DÉTERMINISTE : même contenu → le local (rien ne bouge) ; contenus
 * différents → la plus grande empreinte, des deux côtés. Sans cela, chaque
 * appareil gardait le sien et le renvoyait, l'autre faisait pareil, et deux
 * copies datées à la même seconde se renvoyaient dix mégaoctets toutes les
 * cinq minutes, sans fin (incident du 2026-09-04).
 */
function freshest(local: unknown, remote: unknown): unknown {
  const cl = clockOf(local);
  const cr = clockOf(remote);
  if (cr > cl) return remote;
  if (cr < cl) return local;
  // Horloges toutes deux illisibles : rien à départager proprement, le local
  // reste (un carnet sans date ne remplace pas un carnet existant).
  if (!Number.isFinite(cl)) return local;
  const dl = noteTieDigest(local);
  const dr = noteTieDigest(remote);
  if (dl === dr) return local;
  return dr > dl ? remote : local;
}

/** Une entrée « supprimée douce » : elle porte un `deletedAt` exploitable. */
function isTombstone(entry: unknown): boolean {
  return isPlainObject(entry) && typeof entry.deletedAt === 'string' && entry.deletedAt !== '';
}

/**
 * Arbitrage d'une collision d'id, avec la RÉSURRECTION traitée explicitement.
 *
 * Restaurer une note (`restoreNote`) retire son `deletedAt` : l'entrée locale
 * redevient vivante pendant que le nuage garde la tombstone. Tant que la
 * restauration bouscule `updatedAt` (elle le fait désormais), l'horloge locale
 * est postérieure et le local gagne — mais un store restauré par une version
 * ANTÉRIEURE de l'application n'a pas ce coup d'horloge, et la note repartait à
 * la corbeille au cycle suivant. Règle explicite : face à une note locale
 * VIVANTE, une tombstone distante doit être STRICTEMENT plus fraîche pour la
 * re-supprimer ; à horloge égale ou antérieure, la résurrection tient.
 */
function resolveEntry(local: unknown, remote: unknown): unknown {
  if (!isTombstone(local) && isTombstone(remote)) {
    return clockOf(remote) > clockOf(local) ? remote : local;
  }
  // Miroir exact : vue de l'autre appareil, c'est SA note vivante face à NOTRE
  // tombstone. À horloge égale la vivante tient là-bas ; elle doit donc tenir
  // ici aussi, sinon les deux côtés gardent chacun le leur et se le renvoient.
  if (isTombstone(local) && !isTombstone(remote)) {
    return clockOf(remote) >= clockOf(local) ? remote : local;
  }
  return freshest(local, remote);
}

/** Horodatage ISO exploitable, ou `null`. */
function parseIso(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Union de deux registres de purge : par id, la pierre la PLUS RÉCENTE gagne ;
 * les entrées illisibles et celles de plus de `PURGE_TOMBSTONE_TTL_MS` sont
 * oubliées (sans quoi le registre grossit à chaque suppression définitive, pour
 * toujours, sur tous les appareils).
 */
function mergePurgeSet(local: unknown, remote: unknown, nowMs: number): Record<string, string> {
  const out: Record<string, string> = {};
  const floor = nowMs - PURGE_TOMBSTONE_TTL_MS;
  for (const side of [local, remote]) {
    if (!isPlainObject(side)) continue;
    for (const [id, raw] of Object.entries(side)) {
      const at = parseIso(raw);
      if (at === null || at < floor) continue;
      const kept = parseIso(out[id]);
      if (kept === null || at > kept) out[id] = raw as string;
    }
  }
  return out;
}

/**
 * Retire de `entries` tout id purgé APRÈS la dernière mutation connue de
 * l'entrée. Une note modifiée (ou restaurée) postérieurement à la purge est
 * conservée : la mutation la plus récente fait foi, exactement comme pour les
 * collisions ordinaires. Rend les ids réellement retirés.
 */
function applyPurges(entries: Dict, purged: Record<string, string>): Set<string> {
  const removed = new Set<string>();
  for (const [id, at] of Object.entries(purged)) {
    if (!has(entries, id)) continue;
    const purgedAt = parseIso(at);
    if (purgedAt === null || purgedAt <= clockOf(entries[id])) continue;
    delete entries[id];
    removed.add(id);
  }
  return removed;
}

/** `byId` fusionné apporte-t-il un contenu que le local n'avait pas ? */
function byIdDiffers(merged: Dict, local: unknown): boolean {
  if (!isPlainObject(local)) return Object.keys(merged).length > 0;
  const keys = Object.keys(merged);
  if (keys.length !== Object.keys(local).length) return true;
  for (const k of keys) {
    if (!has(local, k) || !deepEqual(merged[k], local[k])) return true;
  }
  return false;
}

/** Comparaison structurelle insensible à l'ordre des CLÉS (l'ordre des tableaux compte). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    for (const k of ka) {
      if (!has(b, k) || !deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  // Dernier cas utile : NaN (jamais produit par du JSON, mais gratuit).
  return a !== a && b !== b;
}

/**
 * Union par clé de deux Record — collision arbitrée par l'horloge, et le
 * contenu SACRIFIÉ déposé dans `sink`. Une collision entre contenus identiques
 * ne sacrifie rien : elle n'est pas rapportée (sinon chaque cycle recréerait la
 * même copie de conflit pour une note que personne n'a touchée).
 */
function mergeById(
  local: Dict,
  remote: Dict,
  kind: 'note' | 'notebook',
  sink: OverwrittenEntry[]
): Dict {
  const out: Dict = { ...local };
  for (const [id, remoteEntry] of Object.entries(remote)) {
    if (!has(local, id)) {
      out[id] = remoteEntry;
      continue;
    }
    const localEntry = local[id];
    const winner = resolveEntry(localEntry, remoteEntry);
    out[id] = winner;
    if (deepEqual(localEntry, remoteEntry)) continue;
    // `resolveEntry` rend TOUJOURS l'un des deux objets reçus : l'identité dit
    // donc lequel a perdu, sans re-comparer les horloges.
    const localWon = winner === localEntry;
    sink.push({
      id,
      kind,
      side: localWon ? 'remote' : 'local',
      losing: localWon ? remoteEntry : localEntry,
    });
  }
  return out;
}

/**
 * Ordre local préservé, nouveautés distantes en fin de liste, puis tout id de
 * `byId` orphelin des deux listes. Les ids qui ne désignent AUCUNE entrée de
 * `byId` sont écartés : ils ne référencent rien et font planter les vues qui
 * font `allIds.map(id => byId[id])`.
 */
function mergeAllIds(local: unknown, remote: unknown, byId: Dict): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const take = (list: unknown): void => {
    if (!Array.isArray(list)) return;
    for (const raw of list) {
      if (typeof raw !== 'string' || seen.has(raw) || !has(byId, raw)) continue;
      seen.add(raw);
      out.push(raw);
    }
  };
  take(local);
  take(remote);
  for (const id of Object.keys(byId)) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

const idOf = (entry: unknown): string | null =>
  isPlainObject(entry) && typeof entry.id === 'string' ? entry.id : null;

/**
 * Union d'un tableau identifié par `id`. Les entrées locales sont TOUTES
 * conservées, dans leur ordre (doublons d'id compris — on ne répare pas en
 * supprimant) ; une entrée distante de même id n'écrase la première occurrence
 * locale que si son horloge est strictement plus fraîche ; une entrée distante
 * sans id n'est ajoutée que si aucune entrée sans id ne lui est identique.
 */
function mergeTemplates(local: unknown[], remote: unknown[]): unknown[] {
  const out: unknown[] = [...local];
  const slotById = new Map<string, number>();
  const anonymous: unknown[] = [];
  local.forEach((entry, index) => {
    const id = idOf(entry);
    if (id === null) anonymous.push(entry);
    else if (!slotById.has(id)) slotById.set(id, index);
  });
  for (const entry of remote) {
    const id = idOf(entry);
    if (id === null) {
      if (!anonymous.some((a) => deepEqual(a, entry))) out.push(entry);
      continue;
    }
    const slot = slotById.get(id);
    if (slot === undefined) {
      slotById.set(id, out.length);
      out.push(entry);
    } else {
      out[slot] = freshest(out[slot], entry);
    }
  }
  return out;
}

/** Les deux côtés sont des Record → fusion ; un seul → celui-là ; aucun → null. */
function pickRecord(
  local: unknown,
  remote: unknown,
  kind: 'note' | 'notebook',
  sink: OverwrittenEntry[]
): Dict | null {
  if (isPlainObject(local) && isPlainObject(remote)) return mergeById(local, remote, kind, sink);
  if (isPlainObject(local)) return { ...local };
  if (isPlainObject(remote)) return { ...remote };
  return null;
}

/**
 * Fusion pure d'un payload de notes local avec son homologue distant.
 * Ne lit ni n'écrit rien : l'appelant décide de réécrire (`changedFromLocal`),
 * de marquer une remontée (`changedFromRemote`) et de prévenir le renderer
 * (`remoteContentChanged`).
 *
 * `nowMs` n'est là que pour l'expiration des pierres tombales de purge (et pour
 * que les tests la pilotent) : la fusion reste pure.
 */
export function mergeNotesPayload(
  localInput: unknown,
  remoteInput: unknown,
  nowMs: number = Date.now()
): NotesMergeResult {
  const local: Dict = isPlainObject(localInput) ? localInput : {};
  const remote: Dict = isPlainObject(remoteInput) ? remoteInput : {};

  // 1. Socle : tout le local, puis les clés distantes que le local n'a pas.
  const merged: Dict = { ...local };
  for (const [key, value] of Object.entries(remote)) {
    if (!has(merged, key)) merged[key] = value;
  }

  // 2. Registres de purge — union puis expiration. La clé n'apparaît que si
  //    l'un des deux côtés la portait déjà : inventer un `purged: {}` rendrait
  //    la fusion différente du local à chaque cycle (réécriture perpétuelle).
  const purgedNotes = mergePurgeSet(local[PURGED_NOTES_KEY], remote[PURGED_NOTES_KEY], nowMs);
  const purgedNotebooks = mergePurgeSet(
    local[PURGED_NOTEBOOKS_KEY],
    remote[PURGED_NOTEBOOKS_KEY],
    nowMs
  );
  for (const [key, set] of [
    [PURGED_NOTES_KEY, purgedNotes],
    [PURGED_NOTEBOOKS_KEY, purgedNotebooks],
  ] as const) {
    if (Object.keys(set).length > 0 || has(local, key) || has(remote, key)) merged[key] = set;
  }

  // 3. Notes — union, puis soustraction des purges plus récentes que l'entrée.
  const overwritten: OverwrittenEntry[] = [];
  const byId = pickRecord(local.byId, remote.byId, 'note', overwritten);
  let purgedIds = new Set<string>();
  if (byId) {
    purgedIds = applyPurges(byId, purgedNotes);
    merged.byId = byId;
  }

  // 4. Carnets — même soustraction.
  const notebooks = pickRecord(local.notebooks, remote.notebooks, 'notebook', overwritten);
  if (notebooks) {
    applyPurges(notebooks, purgedNotebooks);
    merged.notebooks = notebooks;
  }

  // 5. Modèles.
  if (Array.isArray(local.templates) && Array.isArray(remote.templates)) {
    merged.templates = mergeTemplates(local.templates, remote.templates);
  } else if (Array.isArray(local.templates)) {
    merged.templates = [...local.templates];
  } else if (Array.isArray(remote.templates)) {
    merged.templates = [...remote.templates];
  }

  // 6. Index, reconstruit depuis les notes fusionnées (purges déjà appliquées).
  if (byId) merged.allIds = mergeAllIds(local.allIds, remote.allIds, byId);

  // 7. Filet réclamé ID PAR ID : chaque note locale doit se retrouver dans
  //    l'union, ou avoir été retirée par une pierre de purge plus récente
  //    qu'elle. Un comptage ne prouverait rien — une note locale perdue,
  //    compensée par une note distante gagnée, passerait au travers.
  if (isPlainObject(local.byId) && byId) {
    for (const id of Object.keys(local.byId)) {
      if (has(byId, id) || purgedIds.has(id)) continue;
      throw new Error(`Fusion des notes refusée : la note ${id} a disparu de l'union`);
    }
  }

  return {
    merged,
    changedFromLocal: !deepEqual(merged, local),
    changedFromRemote: !deepEqual(merged, remote),
    remoteContentChanged: byId ? byIdDiffers(byId, local.byId) : false,
    purgeRegistryChanged:
      !deepEqual(merged[PURGED_NOTES_KEY], local[PURGED_NOTES_KEY]) ||
      !deepEqual(merged[PURGED_NOTEBOOKS_KEY], local[PURGED_NOTEBOOKS_KEY]),
    // Une entrée qu'une purge définitive vient de retirer de l'union n'a plus
    // de contenu à sauver : la conserver la ferait ressusciter en copie.
    overwritten: overwritten.filter((entry) => {
      const record = entry.kind === 'note' ? byId : notebooks;
      return record !== null && has(record, entry.id);
    }),
  };
}

// ── Garde des sessions vivantes ─────────────────────────────────────────────

/**
 * Rétablit dans la fusion les notes qui sont en SESSION VIVANTE (collaboration
 * temps réel), et rend leurs identifiants.
 *
 * POURQUOI. Le contenu durable d'une note en session est produit par le CRDT :
 * il change à chaque frappe, sur cet appareil comme sur les autres. Laisser la
 * fusion la remplacer par un instantané nuage (ou la retirer sur une pierre de
 * purge) ferait perdre la frappe en cours, et le CRDT — qui ne relit pas le
 * magasin — ne la reconstruirait jamais.
 *
 * CE QUI SE PASSE À LA PLACE. L'arbitrage est REPORTÉ, pas annulé : la version
 * distante reste dans le nuage (l'appelant ne remonte pas ce cycle-là, sinon il
 * l'écraserait), et le premier cycle qui suit la fin de la session la
 * fusionnera normalement — copie de conflit comprise s'il y a lieu.
 *
 * L'entrée locale est aussi remise dans `allIds` si une purge l'en avait
 * retirée : une note de `byId` absente de l'index casse les vues qui font
 * `allIds.map(id => byId[id])`.
 */
export function preserveLiveSessionNotes(
  localInput: unknown,
  merged: NotesPayload,
  isLive: (noteId: string) => boolean
): string[] {
  const local: Dict = isPlainObject(localInput) ? localInput : {};
  const localById = local.byId;
  const mergedById = merged.byId;
  if (!isPlainObject(localById) || !isPlainObject(mergedById)) return [];

  const held: string[] = [];
  for (const [id, entry] of Object.entries(localById)) {
    if (!isLive(id)) continue;
    if (has(mergedById, id) && deepEqual(mergedById[id], entry)) continue;
    mergedById[id] = entry;
    held.push(id);
  }
  if (held.length > 0 && Array.isArray(merged.allIds)) {
    const index = merged.allIds as unknown[];
    for (const id of held) {
      if (!index.includes(id)) index.push(id);
    }
  }
  return held;
}

/**
 * Écarte des entrées écrasées TOUTES celles qui sont en session vivante — la
 * seule chose qui doive décider d'une copie de conflit pour une note en cours
 * d'édition collaborative.
 *
 * LE DÉFAUT QUE CETTE FONCTION FERME. Les appelants filtraient sur la liste
 * RENDUE par `preserveLiveSessionNotes`, c'est-à-dire les notes qu'il a fallu
 * RÉTABLIR. Or cette liste est vide dès que l'arbitrage d'horloge a déjà donné
 * le local gagnant — et c'est le cas le plus FRÉQUENT en session : chaque
 * appareil réécrit la note toutes les deux secondes (retour au stockage du
 * CRDT), donc celui qui a écrit en dernier gagne chez lui. La note était bien
 * vivante, la garde était bien posée, et une copie de conflit était fabriquée
 * quand même — une par cycle, chacune portant le texte tapé à cet instant. Le
 * carnet se remplissait de doublons pendant qu'on écrivait.
 *
 * POURQUOI AUCUNE COPIE N'EST DUE ICI. Pendant une session, les deux versions
 * stockées ne sont pas deux contenus rivaux : ce sont deux PROJECTIONS du même
 * document CRDT, prises à quelques secondes d'écart. Il n'y a rien à sauver, et
 * l'arbitrage est de toute façon REPORTÉ (voir `preserveLiveSessionNotes`) : le
 * premier cycle qui suit la fin de la session tranchera pour de bon, copie de
 * conflit comprise s'il y a lieu.
 *
 * Les CARNETS ne sont jamais concernés : ils n'ont pas de session.
 */
export function dropLiveSessionConflicts(
  overwritten: OverwrittenEntry[],
  isLive: (noteId: string) => boolean
): OverwrittenEntry[] {
  if (overwritten.length === 0) return overwritten;
  return overwritten.filter((entry) => {
    if (entry.kind !== 'note') return true;
    try {
      return !isLive(entry.id);
    } catch {
      // Un registre défaillant ne doit pas se traduire par une copie de plus.
      return false;
    }
  });
}

// ── Copies de conflit ───────────────────────────────────────────────────────

/**
 * Horloge de chaque entrée d'un payload, id par id (`clockOf`, en
 * millisecondes). Les horloges seules voyagent : aucun contenu, aucun titre.
 */
export interface EntryClocks {
  notes: Record<string, number | null>;
  notebooks: Record<string, number | null>;
}

/**
 * Ancêtre commun des deux côtés tel que la DERNIÈRE FUSION l'a arrêté. C'est la
 * seule chose qui distingue « l'autre appareil a rattrapé mon retard » (un côté
 * n'a pas bougé depuis) de « nous avons édité tous les deux » (les deux ont
 * bougé). Sans elle, chaque modification propagée normalement fabriquerait une
 * copie de conflit — une par cycle, indéfiniment.
 *
 * DEUX TABLES, ET C'EST TOUT L'ENJEU. `notes`/`notebooks` portent les horloges
 * de l'union qu'on vient d'écrire EN LOCAL ; `remote` porte celles du conteneur
 * que le NUAGE servait à ce moment-là. Une seule table pour les deux côtés était
 * fausse dès qu'un cycle fusionnait SANS remonter (garde de fraîcheur, garde de
 * capacité, note retenue par une session vivante, 409, réseau coupé) : l'ancêtre
 * avançait alors sur nos écritures locales que le nuage n'avait jamais vues, et
 * au cycle suivant l'horloge distante — restée en arrière, donc « différente de
 * l'ancêtre » — passait pour un mouvement. Le local ayant vraiment bougé, une
 * copie de conflit naissait d'une note que personne d'autre n'avait touchée.
 *
 * `remote` est OPTIONNELLE : une base écrite par une version antérieure ne la
 * porte pas. Le distant est alors comparé à l'union — comparaison plus stricte,
 * qui ne peut pas conclure à tort qu'il a bougé.
 */
export interface NotesMergeBase extends EntryClocks {
  /** Horloges du conteneur DISTANT au moment de cette même fusion. */
  remote?: EntryClocks;
}

/**
 * Instantané des horloges d'un payload — à persister après chaque fusion.
 *
 * Une entrée SANS horloge lisible est inscrite à `null`, pas omise : omettre
 * revenait à la dire « inconnue de la base », donc éternellement divergente, donc
 * recopiée en conflit à chaque cycle. `null` dit « elle était là, sans horloge ».
 */
export function collectEntryClocks(payload: unknown): EntryClocks {
  const out: EntryClocks = { notes: {}, notebooks: {} };
  if (!isPlainObject(payload)) return out;
  const take = (source: unknown, into: Record<string, number | null>): void => {
    if (!isPlainObject(source)) return;
    for (const [id, entry] of Object.entries(source)) {
      const clock = clockOf(entry);
      into[id] = Number.isFinite(clock) ? clock : null;
    }
  };
  take(payload.byId, out.notes);
  take(payload.notebooks, out.notebooks);
  return out;
}

/**
 * Base complète d'un cycle : ce que NOUS gardons (l'union scellée en local) et
 * ce que le NUAGE portait au même instant. À persister à chaque fusion, et après
 * chaque remontée acquittée — le nuage porte alors exactement ce qui est parti,
 * donc les deux tables se confondent (`collectMergeBase(pousse, pousse)`).
 */
export function collectMergeBase(localPayload: unknown, remotePayload: unknown): NotesMergeBase {
  const ours = collectEntryClocks(localPayload);
  return {
    notes: ours.notes,
    notebooks: ours.notebooks,
    remote: collectEntryClocks(remotePayload),
  };
}

/**
 * Champs qui datent une entrée sans rien dire de ce qu'elle CONTIENT. Deux
 * versions qui n'en diffèrent que par là portent le même texte : il n'y a rien à
 * sauver, et une sauvegarde automatique qui repose `updatedAt` sans toucher au
 * document ne doit jamais fabriquer une copie de son propre jumeau.
 */
const CLOCK_ONLY_FIELDS = ['updatedAt'] as const;

/** L'entrée débarrassée de ses seuls horodatages — pour comparer les substances. */
function withoutClocks(entry: unknown): unknown {
  if (!isPlainObject(entry)) return entry;
  const copy: Dict = { ...entry };
  for (const field of CLOCK_ONLY_FIELDS) delete copy[field];
  return copy;
}

/**
 * Ce côté a-t-il ÉCRIT depuis l'ancêtre ? STRICTEMENT plus récent, jamais
 * « différent » : une horloge ANTÉRIEURE à l'ancêtre décrit un côté EN RETARD
 * (le nuage n'a pas encore reçu ce que nous avons fusionné), pas un côté qui
 * aurait écrit. Les confondre fabriquait une copie de conflit à chaque cycle
 * suivant une fusion non remontée.
 *
 * ABSENTE ≠ SANS HORLOGE. Une entrée que la base ne cite pas est INCONNUE : on
 * ne peut rien prouver, elle compte comme ayant bougé. Une entrée citée à `null`
 * était là, sans horloge lisible : elle n'a bougé que si elle en a gagné une.
 * Confondre les deux condamnait toute entrée sans horloge à passer pour
 * divergente à chaque cycle, donc à être recopiée sans fin.
 */
function movedSince(clock: number, ancestor: number | null | undefined, known: boolean): boolean {
  if (!known) return true; // inconnue de la base : rien de prouvable
  if (ancestor === null) return Number.isFinite(clock); // était sans horloge
  if (!Number.isFinite(clock)) return true; // en avait une, n'en a plus : rien de prouvable
  return clock > (ancestor as number);
}

/**
 * Parmi les entrées écrasées, celles dont le contenu perdant est RÉELLEMENT
 * perdu — c'est-à-dire celles que les deux côtés ont modifiées depuis leur
 * dernier accord, avec des contenus qui ne disent pas la même chose.
 *
 * TROIS SIGNAUX, chacun couvrant l'angle mort des autres :
 *  - la SUBSTANCE : deux versions qui ne diffèrent que par leur horodatage n'ont
 *    rien perdu du tout, quoi qu'en disent les horloges.
 *  - la BASE, une table PAR CÔTÉ (voir `NotesMergeBase`) : chaque côté est
 *    comparé à l'ancêtre qui le concerne — le nôtre à l'union qu'on a scellée en
 *    local, le distant au conteneur que le nuage servait alors. Comparaison par
 *    AVANCE STRICTE : la valeur voyage avec l'entrée, elle ne souffre donc
 *    d'aucun décalage d'horloge entre appareils, et un côté en RETARD n'est
 *    jamais pris pour un côté qui a écrit.
 *  - `agreedAtMs`, l'instant du dernier accord prouvé avec le nuage, comparé à
 *    la seule horloge LOCALE (même machine, donc ordonnable) : il rattrape le
 *    cas où la base est en retard parce que nous avons poussé sans refusionner.
 * Une entrée n'est conservée que si TOUS disent « les deux côtés ont écrit ».
 *
 * `base` à `null` = aucun ancêtre connu (premier cycle après mise à jour) :
 * on ne juge pas et on ne fabrique rien — mieux vaut le comportement d'avant
 * pendant un cycle que d'inonder le carnet de copies au premier démarrage.
 *
 * Une tombstone perdante n'est jamais conservée : son « contenu » est une
 * suppression voulue, la ressusciter en copie visible serait un contresens.
 */
export function selectGenuineConflicts(
  overwritten: OverwrittenEntry[],
  merged: NotesPayload,
  base: NotesMergeBase | null,
  agreedAtMs: number | null
): OverwrittenEntry[] {
  if (!base || overwritten.length === 0) return [];
  const agreed = agreedAtMs === null || Number.isNaN(agreedAtMs) ? -Infinity : agreedAtMs;
  const kept: OverwrittenEntry[] = [];
  for (const entry of overwritten) {
    if (isTombstone(entry.losing)) continue;
    const record = entry.kind === 'note' ? merged.byId : merged.notebooks;
    const winner = isPlainObject(record) ? record[entry.id] : undefined;
    // Même substance des deux côtés : seule l'horloge les sépare, rien à sauver.
    if (winner !== undefined && deepEqual(withoutClocks(entry.losing), withoutClocks(winner))) {
      continue;
    }

    const ours = (entry.kind === 'note' ? base.notes : base.notebooks) ?? {};
    // Base d'une version antérieure (pas de table distante) : le distant est
    // comparé à l'union. Plus strict, donc jamais un faux mouvement.
    const theirs = (entry.kind === 'note' ? base.remote?.notes : base.remote?.notebooks) ?? ours;

    const localKnown = has(ours, entry.id);
    const localAncestor = ours[entry.id];
    const losingClock = clockOf(entry.losing);
    const winnerClock = clockOf(winner);
    const localClock = entry.side === 'local' ? losingClock : winnerClock;
    const remoteClock = entry.side === 'local' ? winnerClock : losingClock;

    // Horloge illisible = on ne peut rien prouver : on conserve (perdre est pire).
    const localMoved =
      movedSince(localClock, localAncestor, localKnown) &&
      (!Number.isFinite(localClock) || localClock > agreed);
    const remoteMoved =
      movedSince(remoteClock, theirs[entry.id], has(theirs, entry.id)) &&
      // NOTRE PROPRE UNION QUI NOUS REVIENT. Le nuage porte exactement l'horloge
      // que la dernière fusion a scellée ici : il a accepté ce qu'on lui a
      // poussé, il n'a rien écrit. Sans cette exception, le cycle qui suit une
      // remontée réussie voyait « le distant a avancé » et recopiait la note.
      !(localKnown && typeof localAncestor === 'number' && remoteClock === localAncestor);
    if (localMoved && remoteMoved) kept.push(entry);
  }
  return kept;
}

/**
 * Marque du titre d'une copie de conflit. NEUTRE, et c'est délibéré : ce module
 * est PUR (il ne peut pas lire i18n) et l'application est EN/FR — un suffixe
 * français en dur s'affichait tel quel dans l'interface anglaise. Le symbole et
 * la date se lisent dans les deux langues ; `applyConflictCopies` accepte un
 * `titleSuffix` explicite pour l'appelant qui saura traduire.
 */
export const CONFLICT_TITLE_MARK = '⚠';

/** ` (⚠ 2026-08-14)` — la date distingue deux copies de la même note. */
export function conflictTitleSuffix(nowIso: string): string {
  const day = typeof nowIso === 'string' && nowIso.length >= 10 ? nowIso.slice(0, 10) : '';
  return day ? ` (${CONFLICT_TITLE_MARK} ${day})` : ` (${CONFLICT_TITLE_MARK})`;
}

/**
 * Champs qui portent une IDENTITÉ DE PLACEMENT : deux entrées ne peuvent pas les
 * revendiquer ensemble sans se disputer la place — deux « notes du jour » pour la
 * même date, deux cartes au même rang de colonne, deux boîtes au même point du
 * canevas. Une copie de conflit hérite du CONTENU, jamais de la place ; on les
 * neutralise donc comme on retire déjà `deletedAt`.
 */
const PLACEMENT_FIELDS = [
  'dailyDate',
  'scheduledDate',
  'viewPositions',
  'viewSizes',
  'kanbanOrder',
  'manualOrder',
] as const;

/**
 * Dépose dans le payload une copie de chaque version perdante, sous un id NEUF.
 * Rend le nombre de copies créées.
 *
 * POURQUOI UNE NOTE ET PAS UNE ARCHIVE. Une archive dans un coin d'IndexedDB (ou
 * un fichier à côté de `notes.enc`) ne sauve personne : personne ne la regarde,
 * rien ne la synchronise, et elle meurt avec le navigateur qu'on vide. Une note
 * visible se lit, se compare, se fusionne à la main, se synchronise vers les
 * autres appareils et se supprime comme n'importe quelle note.
 *
 * L'ID EST NEUF, jamais celui d'origine : réutiliser l'id écraserait la version
 * gagnante. Et parce que cet id n'existe que d'un seul côté, l'union le recopie
 * sans jamais l'arbitrer — la copie ne peut pas engendrer un second conflit au
 * cycle suivant.
 *
 * `restampContent` EST LA MÊME RÈGLE, POUR CE QUE LE DOCUMENT PORTE À
 * L'INTÉRIEUR. Une base de données inline a une identité (`dbId`) que les
 * relations d'autres notes visent : deux notes qui la portent, et une relation
 * en vise une puis en lit l'autre — des chiffres faux, sans rien à l'écran qui
 * le dise. La re-frappe est INJECTÉE parce que ce module est PUR : elle vit
 * chez l'éditeur (`restampCopiedDbIds`), pas ici. Absente, rien ne change ; et
 * la fonction fournie doit être TOTALE — un contenu qu'elle ne sait pas lire se
 * rend tel quel, elle ne jette jamais.
 */
export function applyConflictCopies(
  payload: NotesPayload,
  entries: OverwrittenEntry[],
  options: {
    now: string;
    newId: () => string;
    titleSuffix?: string;
    device?: string;
    restampContent?: (content: string) => string;
  }
): number {
  const suffix = options.titleSuffix ?? conflictTitleSuffix(options.now);
  let created = 0;
  for (const entry of entries) {
    if (!isPlainObject(entry.losing)) continue;
    const record = entry.kind === 'note' ? payload.byId : payload.notebooks;
    if (!isPlainObject(record)) continue;
    // La GAGNANTE, lue avant d'insérer la copie : son horodatage d'alors est ce
    // qui permettra plus tard de remettre les deux versions face à face, même si
    // l'utilisateur a continué d'écrire dans l'original entre-temps.
    const winner = record[entry.id];
    let id = options.newId();
    while (has(record, id)) id = options.newId();
    const labelKey = entry.kind === 'note' ? 'title' : 'name';
    const label = entry.losing[labelKey];
    const base = typeof label === 'string' && label.trim() !== '' ? label : '';
    const copy: Dict = {
      ...entry.losing,
      id,
      [labelKey]: base === '' ? suffix.trim() : `${base}${suffix}`,
      // Horodatée de MAINTENANT : elle remonte ainsi en tête des vues triées
      // par récence, c'est ce qui la rend visible sans travail d'interface.
      updatedAt: options.now,
      conflictOfId: entry.id,
      conflictSavedAt: options.now,
      conflictOriginalUpdatedAt:
        typeof entry.losing.updatedAt === 'string' ? entry.losing.updatedAt : null,
      // D'OÙ VENAIT LA PERDANTE. `local` = elle était sur CET appareil et le
      // nuage portait plus récent ; `remote` = elle venait du nuage et c'est
      // notre version qui l'a emporté. Avec `conflictDevice` (l'appareil qui a
      // fusionné), c'est tout ce qu'une résolution assistée peut dire sans
      // inventer une identité d'appareil que le magasin ne porte pas.
      conflictSide: entry.side,
      conflictDevice: typeof options.device === 'string' ? options.device : null,
      conflictKeptUpdatedAt:
        isPlainObject(winner) && typeof winner.updatedAt === 'string' ? winner.updatedAt : null,
    };
    delete copy.deletedAt; // une copie de conflit n'atterrit jamais à la corbeille
    for (const field of PLACEMENT_FIELDS) delete copy[field];
    // L'identité des bases inline est une identité de PLACEMENT elle aussi :
    // deux blocs ne peuvent pas la revendiquer ensemble. Seules les notes en
    // portent (un carnet n'a pas de document).
    if (entry.kind === 'note' && options.restampContent && typeof copy.content === 'string') {
      copy.content = options.restampContent(copy.content);
    }
    // `isDaily` est un booléen obligatoire du modèle : on le rabat au lieu de le
    // retirer, sinon la note du jour aurait deux prétendants pour la même date.
    if (has(copy, 'isDaily')) copy.isDaily = false;
    record[id] = copy;
    if (entry.kind === 'note' && Array.isArray(payload.allIds)) {
      (payload.allIds as unknown[]).push(id);
    }
    created++;
  }
  return created;
}
