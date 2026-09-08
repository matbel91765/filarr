/**
 * COFFRE DE NOTES v2 — UNE NOTE, UN OBJET. Module PUR (ni disque, ni crypto,
 * ni Electron), tout ce qui varie est injecté.
 *
 * ═══ POURQUOI ═══
 *
 * En v1, toutes les notes vivent dans un seul `notes.enc`. Mesuré dans le
 * journal du 2026-09-02, sur un coffre de 31 notes et 9,87 Mo :
 *
 *   descente des 3 morceaux ............ 1,4 s
 *   déchiffrement + fusion + rescellement 4,7 s
 *   relecture par le renderer .......... 2,1 s
 *   remontée ........................... 2,9 s
 *
 * Onze secondes de travail pour une virgule tapée dans UNE note. Et ce coût ne
 * dépend pas de ce qui a changé : il dépend de la taille du coffre. Aucune
 * horloge, aucun canal de notification, aucun réseau plus rapide ne corrige
 * ça — c'est le format qui est en cause.
 *
 * En v2, chaque note est un objet à elle seule, et un INDEX minuscule porte de
 * quoi ARBITRER sans lire une seule note. Un cycle lit l'index (quelques Ko),
 * décide, puis ne transfère et ne déchiffre QUE les notes réellement
 * divergentes. Le coût suit ce qui a changé, plus la taille du coffre.
 *
 * ═══ CE QUE L'INDEX PORTE, ET POURQUOI EXACTEMENT ÇA ═══
 *
 * Trois champs par note, pas un de plus :
 *  - `objectId` — la clé sous laquelle le nuage range cette note. STABLE :
 *    la changer à chaque écriture laisserait un objet orphelin par sauvegarde.
 *  - `updatedAt` / `deletedAt` — l'horloge d'arbitrage, EXACTEMENT celle de la
 *    v1 (`clockOf` : le plus récent des deux). C'est ce qui rend la migration
 *    sûre : la v2 tranche comme la v1 tranchait, sur les mêmes entrées.
 *  - `digest` — l'empreinte du CLAIR de la note. Elle répond à la seule
 *    question qui décide d'un transfert : « le contenu diffère-t-il ? » Deux
 *    horloges différentes sur un contenu identique (un aller-retour, un
 *    rescellement) ne doivent RIEN faire transiter.
 *
 * ═══ CE QUE LE NUAGE APPREND EN PLUS, ET C'EST UNE DÉCISION ═══
 *
 * En v1 le serveur voyait UN objet et sa taille. En v2 il voit un objet PAR
 * NOTE : leur nombre, la date de chaque écriture, la taille de chacune. C'est
 * une métadonnée réelle, et elle n'existait pas avant.
 *
 * Deux choses la bornent. D'abord `objectId` est un identifiant OPAQUE tiré au
 * hasard, jamais l'identifiant de note : il ne porte ni titre, ni date de
 * création, ni rien qui se corrèle d'un compte à l'autre. Ensuite, c'est
 * exactement le régime que le reste du coffre subit déjà — un fichier ordinaire
 * est un objet, sa taille est visible, ses écritures sont datées. Les notes
 * rejoignent le régime commun ; elles n'y perdent pas plus que les fichiers.
 *
 * Ce qui reste vrai, et c'est l'essentiel : le serveur ne peut lire NI le
 * contenu, NI le titre, NI l'index — tout est chiffré avec la FEK.
 *
 * ═══ CE MODULE NE PERD JAMAIS DE NOTE ═══
 *
 * Mêmes règles que `notesMergeCore` (v1), et une parité testée entre les deux :
 *  - union par id ; collision → horloge la plus récente ; ÉGALITÉ = le LOCAL ;
 *  - une tombstone (`deletedAt`) est une note comme une autre, jamais filtrée ;
 *  - face à une note VIVANTE, une tombstone doit être STRICTEMENT plus fraîche
 *    pour la re-supprimer (à égalité, la restauration tient) ;
 *  - les purges définitives passent par des pierres tombales datées, et ne
 *    soustraient que ce qui n'a pas été modifié APRÈS la décision de purger ;
 *  - INVARIANT DUR : l'index fusionné ne peut pas contenir moins d'entrées que
 *    le local, purges mises à part. `mergeIndexes` le vérifie et JETTE plutôt
 *    que de rendre un index amputé — l'appelant n'écrit alors rien.
 *
 * ⚠ SOURCE DE VÉRITÉ : `electron/sync/notesStoreV2.ts`. PORTAGE À L'IDENTIQUE,
 * pas une variante — la duplication est imposée par la racine de
 * `electron/tsconfig.json`. `notesStoreV2Parity.vitest.ts` confronte les deux.
 */

// ── Types ───────────────────────────────────────────────────────────────────

/** Une note, vue d'ici : un objet opaque dont on ne lit que les horloges. */
export type NoteRecord = Record<string, unknown>;

/** Le coffre à la forme v1 — ce que le renderer manipule, et qui ne change PAS. */
export interface NotesPayload {
  byId?: unknown;
  allIds?: unknown;
  templates?: unknown;
  notebooks?: unknown;
  purged?: unknown;
  purgedNotebooks?: unknown;
  [key: string]: unknown;
}

/** Tout ce qu'il faut pour arbitrer une note SANS la lire. */
export interface NoteIndexEntry {
  /** Clé de l'objet dans le nuage. Opaque, tirée au hasard, STABLE. */
  objectId: string;
  /** Horloge, moitié « modification ». `null` quand la note n'en porte pas. */
  updatedAt: string | null;
  /** Horloge, moitié « suppression douce ». `null` pour une note vivante. */
  deletedAt: string | null;
  /** Empreinte du CLAIR : décide s'il faut TRANSFÉRER, l'horloge décidant qui gagne. */
  digest: string;
  /**
   * L'ANCÊTRE COMMUN : l'empreinte telle qu'elle était au dernier ACCORD PROUVÉ
   * avec le nuage. C'est ce qui distingue un vrai conflit d'un simple retard.
   *
   * Sans elle, la fusion ne peut pas faire la différence entre « l'autre côté a
   * écrit quelque chose d'autre » et « l'autre côté n'a fait que rester en
   * arrière ». La v1 ne le pouvait pas non plus : elle rend un rapport BRUT et
   * laisse l'appelant trier (`selectGenuineConflicts`). Résultat, une note
   * simplement rattrapée par l'autre appareil pouvait produire une copie de
   * conflit dont personne n'avait besoin.
   *
   * Avec elle, la règle est exacte : le perdant dont l'empreinte ÉGALE
   * l'ancêtre du gagnant n'a rien perdu — il EST l'ancêtre. Tout autre cas est
   * une vraie divergence, et se signale.
   *
   * `null` = ancêtre inconnu (note jamais synchronisée, index d'avant ce
   * champ) : dans le doute on signale, jamais l'inverse.
   */
  syncedDigest?: string | null;
  /**
   * LA FORME LOCALE OBSERVÉE — mémoire d'APPAREIL, jamais publiée (retirée
   * par `indexForCloud`). Empreinte de la note TELLE QUE CET APPAREIL LA
   * TIENT, relevée la dernière fois qu'elle a été jugée en accord avec
   * `digest`. Deux implémentations ne rangent pas une même note avec les
   * mêmes octets (liens, texte brut, champs par défaut) : sans cette mémoire,
   * chaque cycle recalculait `digest` sur la forme locale, la trouvait
   * différente de celle publiée par l'autre appareil, concluait à une
   * MODIFICATION, la repoussait — et l'autre faisait pareil en face, une
   * copie de conflit à chaque tour (04/09/2026 : 31 notes devenues 66).
   * `null` = jamais relevée (note fraîchement reçue).
   */
  localShape?: string | null;
}

export interface NotesIndex {
  version: 2;
  /** noteId → entrée. La seule chose qu'un cycle lit pour décider. */
  notes: Record<string, NoteIndexEntry>;
  /** Ordre d'affichage. Même sémantique qu'en v1. */
  allIds: string[];
  notebooks: Record<string, unknown>;
  templates: unknown[];
  /** Pierres tombales des purges DÉFINITIVES : id → `purgedAt` ISO. */
  purged: Record<string, string>;
  purgedNotebooks: Record<string, string>;
  /**
   * LES IMAGES QUE LE NUAGE DÉTIENT — empreinte → date de première parution.
   *
   * Les images vivent hors du JSON des notes, adressées par leur contenu (voir
   * `noteBlobs.ts`). Ce registre dit lesquelles sont déjà là-haut, et c'est ce
   * qui évite de les remonter à chaque frappe.
   *
   * SA FUSION EST UNE UNION, SANS ARBITRAGE ET SANS RETRAIT. Un blob est
   * IMMUABLE : deux appareils ne peuvent pas en avoir des versions
   * différentes, il n'y a donc rien à départager. Et rien n'en est jamais
   * retiré ici : une image peut être citée par une note qu'on n'a pas chargée
   * (en v2 elles se lisent une par une), donc « personne ne la référence » est
   * une conclusion que la fusion n'a PAS les moyens de tirer.
   *
   * PUBLIÉ, contrairement à `syncedDigest` et `legacyStamp` : c'est un fait sur
   * le NUAGE, identique pour tout le monde.
   */
  blobs?: Record<string, string>;
  /**
   * LES IMAGES QUE LE NUAGE A DÉLIBÉRÉMENT SUPPRIMÉES — empreinte → date ISO.
   *
   * ═══ POURQUOI UNE PIERRE, ET PAS UN SIMPLE RETRAIT DU REGISTRE ═══
   *
   * La fusion de `blobs` est une UNION : retirer une empreinte du registre ne
   * tient pas, l'appareil suivant la remettrait depuis sa copie. Et le registre
   * décide des remontées (« déjà là-haut, on n'envoie pas ») : une image
   * supprimée du nuage mais encore au registre ne serait JAMAIS renvoyée — un
   * appareil qui la cite encore la perdrait pour de bon. Il faut donc un fait
   * qui survive à la fusion et qui dise « supprimée, ET quand ».
   *
   * ═══ L'ARBITRAGE, ET C'EST LUI QUI REND LA SUPPRESSION SÛRE ═══
   *
   * Pierre contre registre, la plus RÉCENTE gagne. Une image remontée APRÈS sa
   * pierre est ressuscitée : le registre l'emporte et la pierre tombe. C'est ce
   * qui couvre l'appareil resté hors ligne avec une note qui la cite : à son
   * retour, sa note part, l'image repart avec elle (le registre ne la connaît
   * plus), et la pierre s'efface. Rien n'est perdu — au prix d'un transfert.
   *
   * PUBLIÉ, comme `blobs`, et pour la même raison : c'est un fait sur le NUAGE.
   * Périmé après `PURGE_TOMBSTONE_TTL_MS`, comme les pierres de notes.
   */
  blobTombstones?: Record<string, string>;
  /**
   * Dernier balayage des images orphelines, ISO. Mémoire d'APPAREIL (retirée
   * par `indexForCloud`) : le ménage se fait sur CE disque, et un appareil n'a
   * pas à imposer sa cadence aux autres.
   *
   * Le balayage exige de relire TOUTES les notes — c'est cher. Cette date le
   * borne à une fois par jour.
   */
  blobSweepAt?: string | null;
  /**
   * Identité du blob v1 LOCAL à la dernière réinjection (`reconcileLegacyBlob`).
   *
   * Mémoire d'APPAREIL, comme `syncedDigest`, et retirée par `indexForCloud` :
   * c'est un fait sur CE disque, et le publier n'apprendrait rien à personne
   * tout en faisant diverger l'index à chaque cycle.
   */
  legacyStamp?: string | null;
  /**
   * Empreinte du coffre v2 telle qu'elle a ete REECRITE dans le blob v1, la
   * derniere fois.
   *
   * Memoire d'APPAREIL, retiree par `indexForCloud` comme `legacyStamp` : c'est
   * un fait sur CE disque. Elle existe pour que la reecriture ne coute rien
   * quand rien n'a bouge — sans elle, chaque cycle relirait toutes les notes
   * pour reconstruire un blob identique a celui d'avant.
   */
  legacyDigest?: string | null;
}

/** Fonctions injectées : c'est ce qui garde ce module pur et testable. */
export interface SplitDeps {
  /** Empreinte du clair d'une note. Doit être stable et sans collision utile. */
  digestOf: (note: NoteRecord) => string;
  /** Nouvel identifiant d'objet, opaque. Appelé UNIQUEMENT pour une note sans clé. */
  newObjectId: () => string;
}

export interface SplitResult {
  index: NotesIndex;
  /** noteId → la note entière, à sceller dans son propre objet. */
  notes: Record<string, NoteRecord>;
}

/** Une entrée dont l'arbitrage a détruit le contenu perdant (v1 : `OverwrittenEntry`). */
export interface OverwrittenNote {
  noteId: string;
  /** Le côté dont le contenu a PERDU — c'est lui qu'il faudrait conserver. */
  side: 'local' | 'remote';
  losing: NoteIndexEntry;
}

export interface IndexMergePlan {
  merged: NotesIndex;
  /** Notes à DESCENDRE : le distant gagne et son contenu diffère. */
  toFetch: string[];
  /** Notes à REMONTER : le local gagne et son contenu diffère (ou manque en face). */
  toPush: string[];
  /**
   * Notes dont la clé d'objet change parce que le distant en portait une autre.
   * L'appelant doit supprimer l'ancien objet local, sinon il reste orphelin.
   */
  rekeyed: Array<{ noteId: string; from: string; to: string }>;
  /** Notes que les pierres de purge ont retirées de l'union. */
  purgedOut: string[];
  /** L'index fusionné diffère du LOCAL → il faut le réécrire sur le disque. */
  changedFromLocal: boolean;
  /** L'index fusionné diffère du DISTANT → il faut le publier. */
  changedFromRemote: boolean;
  /** Entrées dont l'arbitrage d'horloge a écarté un contenu DIFFÉRENT. */
  overwritten: OverwrittenNote[];
}

/** Durée de vie d'une pierre tombale de purge — miroir EXACT de la v1. */
export const PURGE_TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Version de format annoncée dans le manifeste (`SyncManifest.notesFormatVersion`). */
export const NOTES_FORMAT_VERSION = 2;

/** Clé de l'index dans le manifeste de synchronisation. */
export const NOTES_INDEX_FILE_ID = 'meta:notes-index';

/** Préfixe des entrées de note dans le manifeste : `note:<objectId>`. */
export const NOTE_ENTRY_PREFIX = 'note:';

/** Nom de l'index sur le disque, sous le dossier `notes/` du profil. */
export const NOTES_INDEX_FILENAME = 'index.enc';

/** Dossier des objets de note, à la racine du profil. */
export const NOTES_DIR = 'notes';

// ── Petits outils ───────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const has = (o: Record<string, unknown>, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, k);

/** Chaîne exploitable, ou `null`. Une chaîne vide n'est pas une date. */
function isoOrNull(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/**
 * Horloge d'une ENTRÉE D'INDEX : le plus récent de `updatedAt` et `deletedAt`.
 *
 * Recopie littérale de `clockOf` (notesMergeCore) — et c'est vital : la v1 et la
 * v2 doivent trancher IDENTIQUEMENT sur les mêmes notes, sinon migrer changerait
 * silencieusement le gagnant de conflits déjà tranchés. Une parité est testée.
 */
export function indexClock(entry: Pick<NoteIndexEntry, 'updatedAt' | 'deletedAt'> | null): number {
  if (!entry) return -Infinity;
  let best = -Infinity;
  for (const raw of [entry.updatedAt, entry.deletedAt]) {
    if (typeof raw !== 'string') continue;
    const ms = Date.parse(raw);
    if (!Number.isNaN(ms) && ms > best) best = ms;
  }
  return best;
}

/** Horloge d'une NOTE entière — même règle, appliquée au dossier complet. */
export function noteClock(note: unknown): number {
  if (!isPlainObject(note)) return -Infinity;
  return indexClock({
    updatedAt: isoOrNull(note.updatedAt),
    deletedAt: isoOrNull(note.deletedAt),
  });
}

/** Une entrée « supprimée douce » : elle porte un `deletedAt` exploitable. */
function isTombstone(entry: NoteIndexEntry | null): boolean {
  return !!entry && typeof entry.deletedAt === 'string' && entry.deletedAt.length > 0;
}

function parseIso(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

// ── Découpe : v1 → v2 ───────────────────────────────────────────────────────

/**
 * DÉCOUPE UN COFFRE v1 EN INDEX + OBJETS PAR NOTE.
 *
 * `previous` sert à la STABILITÉ DES CLÉS : une note déjà indexée garde son
 * `objectId`. Sans ce report, chaque sauvegarde tirerait une clé neuve, écrirait
 * un nouvel objet et abandonnerait le précédent — le nuage se remplirait de
 * doublons que plus rien ne référence.
 *
 * Une entrée de `byId` qui n'est pas un objet est IGNORÉE plutôt que découpée :
 * on ne fabrique pas un objet de note à partir de quelque chose qui n'en est
 * pas une, et la laisser passer produirait un index qui ment.
 */
export function splitVault(
  payload: NotesPayload,
  deps: SplitDeps,
  previous?: NotesIndex | null
): SplitResult {
  const byId = isPlainObject(payload.byId) ? payload.byId : {};
  const notes: Record<string, NoteRecord> = {};
  const entries: Record<string, NoteIndexEntry> = {};

  for (const noteId of Object.keys(byId)) {
    const note = byId[noteId];
    if (!isPlainObject(note)) continue;
    notes[noteId] = note;
    const prev = previous?.notes?.[noteId];
    const updatedAt = isoOrNull(note.updatedAt);
    const deletedAt = isoOrNull(note.deletedAt);
    const shape = deps.digestOf(note);
    // Voir `NoteIndexEntry.localShape`. L'horloge inchangée est la condition
    // de tout : une note éditée porte un nouvel `updatedAt` (chaque réducteur
    // l'estampille) et repart sur son empreinte réelle.
    let digest = shape;
    if (prev && prev.updatedAt === updatedAt && prev.deletedAt === deletedAt && prev.digest) {
      const known = prev.localShape ?? null;
      if (known === shape) {
        // Forme locale identique à la dernière observation : rien n'a bougé,
        // l'empreinte publiée reste la référence.
        digest = prev.digest;
      } else if (known === null && (prev.syncedDigest ?? null) === prev.digest) {
        // Note fraîchement reçue, accord prouvé : on ADOPTE la forme que ce
        // magasin lui a donnée comme référence, sans en faire une édition.
        digest = prev.digest;
      }
    }
    entries[noteId] = {
      objectId: prev?.objectId ?? deps.newObjectId(),
      updatedAt,
      deletedAt,
      digest,
      // L'ancêtre ne se recalcule pas : il est POSÉ par la synchronisation quand
      // un accord est prouvé. Le redécoupage le reporte, sans y toucher.
      syncedDigest: prev?.syncedDigest ?? null,
      localShape: shape,
    };
  }

  // `allIds` est reconstruit sur ce qui EXISTE : l'ordre du coffre d'abord, puis
  // toute note qu'il ne citait pas. Un id cité mais absent de `byId` disparaît —
  // il ne désignait rien.
  const allIds: string[] = [];
  const seen = new Set<string>();
  const declared = Array.isArray(payload.allIds) ? payload.allIds : [];
  for (const id of declared) {
    if (typeof id === 'string' && entries[id] !== undefined && !seen.has(id)) {
      allIds.push(id);
      seen.add(id);
    }
  }
  for (const id of Object.keys(entries)) {
    if (!seen.has(id)) {
      allIds.push(id);
      seen.add(id);
    }
  }

  return {
    index: {
      version: NOTES_FORMAT_VERSION,
      notes: entries,
      allIds,
      notebooks: isPlainObject(payload.notebooks) ? payload.notebooks : {},
      templates: Array.isArray(payload.templates) ? payload.templates : [],
      purged: isPlainObject(payload.purged) ? (payload.purged as Record<string, string>) : {},
      purgedNotebooks: isPlainObject(payload.purgedNotebooks)
        ? (payload.purgedNotebooks as Record<string, string>)
        : {},
    },
    notes,
  };
}

/**
 * RECOMPOSE LE COFFRE v1 depuis l'index et les notes chargées.
 *
 * La forme rendue est celle de la v1, AU CHAMP ET À L'ORDRE DE CLÉ PRÈS : c'est
 * ce qui permet à tout ce qui vit au-dessus — le renderer, la sauvegarde
 * incrémentale, l'historique de versions — de ne rien savoir du format de
 * stockage. La v2 est un changement de RANGEMENT, pas de modèle.
 *
 * Une note que l'index cite mais qui n'a pas été chargée est OMISE de `byId` et
 * de `allIds`. C'est délibéré : rendre un `byId` avec un trou ferait croire à
 * une suppression, et la sauvegarde suivante la propagerait. Mieux vaut un
 * coffre partiel identifiable qu'un coffre amputé qui se réplique.
 */
export function assembleVault(index: NotesIndex, notes: Record<string, NoteRecord>): NotesPayload {
  const byId: Record<string, NoteRecord> = {};
  for (const noteId of Object.keys(index.notes)) {
    const note = notes[noteId];
    if (isPlainObject(note)) byId[noteId] = note;
  }

  const allIds: string[] = [];
  const seen = new Set<string>();
  for (const id of index.allIds) {
    if (byId[id] !== undefined && !seen.has(id)) {
      allIds.push(id);
      seen.add(id);
    }
  }
  for (const id of Object.keys(byId)) {
    if (!seen.has(id)) {
      allIds.push(id);
      seen.add(id);
    }
  }

  const purged = index.purged ?? {};
  const purgedNotebooks = index.purgedNotebooks ?? {};
  // Forme STRICTEMENT identique à celle qu'écrit la v1 (notesDelta, règle 2) :
  // toute divergence ferait voir à chaque côté une différence que l'autre ne
  // voit pas, et les appareils se renverraient le coffre indéfiniment.
  return {
    byId,
    allIds,
    templates: index.templates ?? [],
    notebooks: index.notebooks ?? {},
    ...(Object.keys(purged).length > 0 ? { purged } : {}),
    ...(Object.keys(purgedNotebooks).length > 0 ? { purgedNotebooks } : {}),
  };
}

/** Nombre de notes que l'index désigne mais qui manquent à l'appel. */
export function missingNotes(index: NotesIndex, notes: Record<string, NoteRecord>): string[] {
  return Object.keys(index.notes).filter((id) => !isPlainObject(notes[id]));
}

// ── Fusion des index ────────────────────────────────────────────────────────

/** Union de deux registres de purge : la pierre la plus récente gagne, les vieilles s'oublient. */
function mergePurgeSet(
  local: Record<string, string> | undefined,
  remote: Record<string, string> | undefined,
  nowMs: number
): Record<string, string> {
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
 * Arbitrage d'une collision, avec la RÉSURRECTION traitée explicitement : face à
 * une note vivante, une tombstone doit être STRICTEMENT plus fraîche pour la
 * re-supprimer. À horloge égale, la restauration tient. Copie de la v1.
 */
function resolveEntry(local: NoteIndexEntry, remote: NoteIndexEntry): 'local' | 'remote' {
  if (!isTombstone(local) && isTombstone(remote)) {
    return indexClock(remote) > indexClock(local) ? 'remote' : 'local';
  }
  // Miroir : notre tombstone face à leur vivante — à horloge égale, la vivante
  // tient là-bas, donc ici aussi (sinon chacun garde le sien, sans fin).
  if (isTombstone(local) && !isTombstone(remote)) {
    return indexClock(remote) >= indexClock(local) ? 'remote' : 'local';
  }
  const cl = indexClock(local);
  const cr = indexClock(remote);
  if (cr > cl) return 'remote';
  if (cr < cl) return 'local';
  // Horloges toutes deux illisibles : le local reste, comme en v1.
  if (!Number.isFinite(cl)) return 'local';
  // HORLOGE ÉGALE : départage déterministe par l'empreinte, la même des deux
  // côtés (et la même qu'en v1, `noteTieDigest`). Même empreinte → le local,
  // rien ne bouge. Sans cela, deux copies datées à la même seconde se
  // renvoyaient l'une l'autre toutes les cinq minutes (incident du 2026-09-04).
  if (local.digest === remote.digest) return 'local';
  return remote.digest > local.digest ? 'remote' : 'local';
}

function sameEntry(
  a: NoteIndexEntry | undefined,
  b: NoteIndexEntry | undefined,
  withAncestor: boolean
): boolean {
  if (!a || !b) return a === b;
  if (withAncestor && (a.syncedDigest ?? null) !== (b.syncedDigest ?? null)) return false;
  return (
    a.objectId === b.objectId &&
    a.updatedAt === b.updatedAt &&
    a.deletedAt === b.deletedAt &&
    a.digest === b.digest
  );
}

/**
 * L'INDEX TEL QU'IL PART AU NUAGE — l'ancêtre commun RETIRÉ.
 *
 * `syncedDigest` répond à « qu'est-ce que MOI j'ai vu la dernière fois ? ».
 * C'est une mémoire d'APPAREIL, pas un fait partagé : l'ancêtre de cette
 * machine-ci n'est pas celui de l'autre. Le publier serait faux deux fois — il
 * imposerait notre point de vue aux autres, et il ferait diverger l'index à
 * chaque cycle (chacun réécrivant le champ de l'autre), donc republier sans fin.
 *
 * Il reste donc sur le disque, et le nuage ne voit que les faits.
 */
export function indexForCloud(index: NotesIndex): NotesIndex {
  const notes: Record<string, NoteIndexEntry> = {};
  for (const [id, e] of Object.entries(index.notes)) {
    notes[id] = {
      objectId: e.objectId,
      updatedAt: e.updatedAt,
      deletedAt: e.deletedAt,
      digest: e.digest,
    };
  }
  const out = { ...index, notes };
  // Mémoires d'appareil : elles ne montent pas (voir `legacyStamp`).
  delete (out as { legacyStamp?: unknown }).legacyStamp;
  delete (out as { blobSweepAt?: unknown }).blobSweepAt;
  delete (out as { legacyDigest?: unknown }).legacyDigest;
  return out;
}

/**
 * EMPREINTE DU COFFRE, CALCULEE DEPUIS L'INDEX SEUL.
 *
 * Elle repond a une seule question : « le coffre assemble serait-il le meme que
 * la derniere fois ? ». Et elle y repond SANS LIRE UNE SEULE NOTE — c'est tout
 * son interet. L'index porte deja l'empreinte du contenu de chaque note
 * (`digest`), donc deux index qui s'accordent sur ces empreintes, sur l'ordre et
 * sur les annexes produisent le meme `assembleVault`.
 *
 * Ce qui entre : ce que `assembleVault` LIT. Ce qui n'y entre pas — `objectId`,
 * `syncedDigest`, les memoires d'appareil — ne change pas le coffre produit, et
 * l'y mettre ferait croire a un changement a chaque cycle.
 */
export function legacyVaultDigest(index: NotesIndex, hash: (value: NoteRecord) => string): string {
  const notes = Object.keys(index.notes)
    .sort()
    .map((id) => [id, index.notes[id].digest, index.notes[id].deletedAt ?? '']);
  return hash({
    notes,
    allIds: index.allIds,
    templates: index.templates ?? [],
    notebooks: index.notebooks ?? {},
    purged: index.purged ?? {},
    purgedNotebooks: index.purgedNotebooks ?? {},
  });
}

function sameRecord(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!has(b, k)) return false;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  }
  return true;
}

/**
 * FUSIONNE DEUX INDEX ET REND LE PLAN DE TRANSFERT.
 *
 * C'est le cœur de la v2 : tout se décide ICI, sur quelques kilo-octets, avant
 * qu'un seul octet de note ne bouge. Ce que la fonction rend n'est pas un
 * coffre — c'est une DÉCISION : qui gagne, quoi descendre, quoi remonter.
 *
 * `toFetch` et `toPush` ne contiennent que les notes dont le CONTENU diffère
 * (`digest`). Une note dont l'horloge a bougé sans que le contenu change — un
 * aller-retour, un rescellement avec un sel neuf — ne fait rien transiter : la
 * v1 la renvoyait pourtant en entier, c'est ce que ce format vient corriger.
 *
 * JETTE plutôt que de rendre un index amputé : voir l'invariant dur en tête de
 * fichier. L'appelant n'écrit alors rien et garde son état intact.
 */
export function mergeIndexes(
  localInput: NotesIndex,
  remoteInput: NotesIndex,
  nowMs: number = Date.now()
): IndexMergePlan {
  const local = normalizeIndex(localInput);
  const remote = normalizeIndex(remoteInput);

  const purged = mergePurgeSet(local.purged, remote.purged, nowMs);
  const purgedNotebooks = mergePurgeSet(local.purgedNotebooks, remote.purgedNotebooks, nowMs);

  const notes: Record<string, NoteIndexEntry> = {};
  const toFetch: string[] = [];
  const toPush: string[] = [];
  const rekeyed: Array<{ noteId: string; from: string; to: string }> = [];
  const purgedOut: string[] = [];
  const overwritten: OverwrittenNote[] = [];

  const ids = new Set([...Object.keys(local.notes), ...Object.keys(remote.notes)]);

  for (const noteId of ids) {
    const l = local.notes[noteId];
    const r = remote.notes[noteId];

    // ── Purge définitive. La pierre ne l'emporte que si elle est POSTÉRIEURE à
    //    l'entrée d'en face : une modification faite après la décision de
    //    purger est plus récente que cette décision, et gagne.
    const stone = parseIso(purged[noteId]);
    if (stone !== null) {
      const survivor = Math.max(indexClock(l ?? null), indexClock(r ?? null));
      if (!(survivor > stone)) {
        purgedOut.push(noteId);
        continue;
      }
    }

    if (l && !r) {
      notes[noteId] = l;
      toPush.push(noteId);
      continue;
    }
    if (!l && r) {
      notes[noteId] = r;
      toFetch.push(noteId);
      continue;
    }
    if (!l || !r) continue; // inatteignable : l'id vient de l'union

    // La clé d'objet du NUAGE fait foi : c'est sous elle que la note est rangée.
    // Une divergence signifie que les deux côtés ont indexé la note sans se
    // voir ; l'objet local devient alors orphelin et doit être nettoyé.
    const objectId = r.objectId || l.objectId;
    if (l.objectId && r.objectId && l.objectId !== r.objectId) {
      rekeyed.push({ noteId, from: l.objectId, to: r.objectId });
    }

    const winner = resolveEntry(l, r);
    const kept = winner === 'remote' ? r : l;

    if (l.digest === r.digest) {
      /**
       * MÊME CONTENU DES DEUX CÔTÉS : rien à transférer, et surtout — c'est un
       * ACCORD PROUVÉ. On pose donc l'ancêtre commun ici, au seul endroit où il
       * est démontré plutôt que supposé. Cela rend le champ auto-réparateur :
       * un index d'avant ce champ, ou une note dont l'ancêtre s'est perdu,
       * retrouve le sien dès que les deux côtés se rejoignent.
       */
      notes[noteId] = { ...kept, objectId, syncedDigest: kept.digest };
      continue;
    }

    notes[noteId] = { ...kept, objectId };

    const losing = winner === 'remote' ? l : r;
    /**
     * EST-CE UN VRAI CONFLIT, OU L'AUTRE CÔTÉ N'A-T-IL QUE DU RETARD ?
     *
     * Le perdant dont l'empreinte ÉGALE l'ancêtre commun du gagnant n'a rien
     * perdu : il EST cet ancêtre, et le gagnant en descend. Signaler ce cas
     * fabriquerait une copie de conflit dont personne n'a besoin — exactement
     * ce que la v1 laissait passer, faute de pouvoir faire la différence.
     *
     * Ancêtre inconnu (`null`) : on signale. Dans le doute on protège, on ne
     * suppose jamais qu'il n'y a rien à sauver.
     */
    // L'ANCÊTRE EST LE NÔTRE, jamais celui du gagnant. Lu sur le gagnant, il
    // était toujours inconnu quand le distant l'emportait (`indexForCloud`
    // retire `syncedDigest` avant publication) : « dans le doute on signale »
    // fabriquait une copie de conflit à CHAQUE republication de l'autre
    // appareil, même pour une note jamais touchée ici (trouvé par la session
    // mobile le 04/09/2026). Règle : si NOTRE empreinte est celle du dernier
    // accord, adopter le distant ne perd rien ; si le distant porte exactement
    // notre dernier accord, notre édition le remplace sans rien écraser. Notre
    // ancêtre inconnu : on signale, on ne suppose jamais qu'il n'y a rien à sauver.
    const ours = l.syncedDigest ?? null;
    const genuine =
      ours === null ? true : winner === 'remote' ? l.digest !== ours : r.digest !== ours;
    if (genuine) {
      overwritten.push({ noteId, side: winner === 'remote' ? 'local' : 'remote', losing });
    }

    if (winner === 'remote') toFetch.push(noteId);
    else toPush.push(noteId);
  }

  /**
   * INVARIANT DUR. Hors purges, la fusion ne peut pas rendre moins d'entrées que
   * le local : une tombstone REMPLACE la note mais garde sa clé. Y contrevenir
   * voudrait dire qu'on s'apprête à écrire un coffre amputé — on jette.
   */
  const expectedFloor = Object.keys(local.notes).filter((id) => !purgedOut.includes(id)).length;
  if (Object.keys(notes).length < expectedFloor) {
    throw new Error(
      `mergeIndexes: index amputé (${Object.keys(notes).length} < ${expectedFloor}) — écriture refusée`
    );
  }

  // `allIds` : ordre local d'abord, puis les ids distants nouveaux, puis tout id
  // de `notes` qu'aucune des deux listes ne citait. Rien ne se perd.
  const allIds: string[] = [];
  const seen = new Set<string>();
  for (const source of [local.allIds, remote.allIds]) {
    for (const id of source) {
      if (notes[id] !== undefined && !seen.has(id)) {
        allIds.push(id);
        seen.add(id);
      }
    }
  }
  for (const id of Object.keys(notes)) {
    if (!seen.has(id)) {
      allIds.push(id);
      seen.add(id);
    }
  }

  // Union du registre, union des pierres (avec péremption), puis ARBITRAGE
  // entre les deux : voir `reconcileBlobRegistry`.
  const registreBrut: Record<string, string> = { ...(local.blobs ?? {}) };
  for (const [hash, at] of Object.entries(remote.blobs ?? {})) {
    if (!registreBrut[hash]) registreBrut[hash] = at;
  }
  const { blobs, blobTombstones } = reconcileBlobRegistry(
    registreBrut,
    mergePurgeSet(local.blobTombstones, remote.blobTombstones, nowMs)
  );

  const merged: NotesIndex = {
    version: NOTES_FORMAT_VERSION,
    ...(Object.keys(blobs).length > 0 ? { blobs } : {}),
    ...(Object.keys(blobTombstones).length > 0 ? { blobTombstones } : {}),
    // Mémoire d'APPAREIL : elle vient du local, par définition — le distant
    // n'a rien à en dire. La reconstruire ici plutôt qu'à chaque appelant évite
    // qu'un seul oubli la fasse repartir de zéro, ce qui relirait dix
    // mégaoctets de blob v1 à chaque cycle sans que rien ne le signale.
    ...(local.legacyStamp !== undefined ? { legacyStamp: local.legacyStamp } : {}),
    // Mémoire d'appareil, comme `legacyStamp` : elle vient du local.
    ...(local.blobSweepAt !== undefined ? { blobSweepAt: local.blobSweepAt } : {}),
    ...(local.legacyDigest !== undefined ? { legacyDigest: local.legacyDigest } : {}),
    notes,
    allIds,
    notebooks: mergeKeyed(local.notebooks, remote.notebooks),
    templates: mergeTemplates(local.templates, remote.templates),
    purged,
    purgedNotebooks,
  };

  return {
    merged,
    toFetch,
    toPush,
    rekeyed,
    purgedOut,
    // Le disque doit apprendre l'ancetre (c'est une memoire locale) ; le nuage
    // ne doit PAS etre republie pour ca — voir `indexForCloud`.
    changedFromLocal: !sameIndex(merged, local, true),
    changedFromRemote: !sameIndex(merged, remote, false),
    overwritten,
  };
}

/**
 * REGISTRE CONTRE PIERRES : LA PLUS RÉCENTE GAGNE, EMPREINTE PAR EMPREINTE.
 *
 * C'est la seule règle qui rende la suppression d'une image SÛRE dans un
 * système où le registre fusionne par union et décide des remontées :
 *
 *  - pierre plus récente que l'entrée du registre → l'image est SUPPRIMÉE :
 *    elle sort du registre, donc le prochain appareil qui la cite la renverra
 *    au lieu de croire qu'elle est là-haut ;
 *  - entrée du registre plus récente que la pierre → l'image est RESSUSCITÉE :
 *    quelqu'un l'a remontée après la suppression, la pierre tombe.
 *
 * Une date illisible d'un côté fait gagner l'autre ; illisible des deux côtés,
 * on garde l'image — dans le doute, on ne supprime pas. À DATE ÉGALE, l'image
 * reste aussi : une remontée est un geste plus délibéré qu'un balayage (quelqu'un
 * a les octets ET une note qui les cite), et deux appareils qui agissent dans la
 * même milliseconde ne doivent pas départager en faveur de la perte.
 *
 * Pure, exportée : `syncNotesV2` l'applique aussi à l'index qu'il publie, une
 * fois les remontées faites — c'est là que la résurrection se DÉCIDE.
 */
export function reconcileBlobRegistry(
  registry: Record<string, string>,
  tombstones: Record<string, string>
): { blobs: Record<string, string>; blobTombstones: Record<string, string> } {
  const blobs: Record<string, string> = {};
  const blobTombstones: Record<string, string> = { ...tombstones };
  for (const [hash, seenAt] of Object.entries(registry)) {
    const stone = tombstones[hash];
    if (stone === undefined) {
      blobs[hash] = seenAt;
      continue;
    }
    const seen = parseIso(seenAt);
    const dead = parseIso(stone);
    if (dead === null || (seen !== null && seen >= dead)) {
      blobs[hash] = seenAt;
      delete blobTombstones[hash];
    }
  }
  return { blobs, blobTombstones };
}

/**
 * L'ENTRÉE A-T-ELLE LA FORME D'UN INDEX v2 ?
 *
 * ⚠ CETTE GARDE EST OBLIGATOIRE DEVANT `normalizeIndex`, ET SON ABSENCE ÉTAIT
 * UN PIÈGE SILENCIEUX. `normalizeIndex` normalise N'IMPORTE QUOI en index
 * VALIDE ET VIDE : un objet vide, un objet de note, un JSON d'une autre
 * application, un déchiffrement qui a mal tourné mais rendu un objet — tous
 * ressortent en `{ version: 2, notes: {}, allIds: [] }`. C'est le bon
 * comportement quand on COMPLÈTE un index partiel ; c'en est un désastreux
 * quand on s'en sert pour CONCLURE.
 *
 * Deux conclusions fausses en découlaient :
 *
 *  - « le nuage ne porte plus rien » (transport) — alors qu'il porte peut-être
 *    tout, sous une forme qu'on n'a pas su lire ;
 *  - « ce disque n'a aucune note » (chargement local) — et la sauvegarde
 *    suivante, elle, supprime les objets orphelins.
 *
 * Deux exigences, minimales et suffisantes : `version === 2` (le format
 * s'annonce) et `notes` est un objet (la carte existe, même vide). Un index
 * légitimement vide les satisfait ; un objet qui n'est pas un index ne les
 * satisfait pas.
 */
export function isNotesIndexShape(input: unknown): boolean {
  if (!isPlainObject(input)) return false;
  if (input.version !== NOTES_FORMAT_VERSION) return false;
  return isPlainObject(input.notes);
}

/**
 * REPORTE LES CHAMPS D'APPAREIL ET DE REGISTRE d'un index sur un autre.
 *
 * `splitVault` fabrique un index NEUF à partir de la charge utile : il n'a
 * aucun moyen de connaître `blobs`, `blobTombstones`, `legacyStamp`,
 * `blobSweepAt` ni `legacyDigest`, qui ne vivent pas dans le coffre v1 mais
 * dans l'index lui-même. Sans ce report, CHAQUE sauvegarde les effaçait :
 *
 *  - `blobs` / `blobTombstones` perdus ⇒ le registre des images publiées
 *    repart à zéro, donc le balayage d'orphelins ne sait plus ce que le nuage
 *    porte et le ménage se refait — ou pire, s'abstient ;
 *  - `legacyStamp` / `legacyDigest` perdus ⇒ le blob v1 est relu et réécrit à
 *    chaque cycle, soit dix mégaoctets pour découvrir qu'on est d'accord avec
 *    soi-même ;
 *  - `blobSweepAt` perdu ⇒ le balayage quotidien redevient un balayage à
 *    chaque cycle.
 *
 * Même liste, dans le même ordre, que `indexFromSlice` du mobile
 * (`filarr-mobile/src/services/sync/notesV2/notesCycleV2.ts`) : les deux
 * plateformes doivent conserver EXACTEMENT les mêmes champs, sinon l'index
 * écrit par l'une amputerait celui de l'autre.
 *
 * `undefined` reste `undefined` : on ne sème pas un champ que l'index source
 * ne portait pas — ce serait un octet de différence, donc un condensat
 * différent, donc une republication pour rien.
 */
export function carryIndexDeviceFields(
  fresh: NotesIndex,
  previous: NotesIndex | null | undefined
): NotesIndex {
  if (!previous) return fresh;
  return {
    ...fresh,
    ...(previous.blobs ? { blobs: previous.blobs } : {}),
    ...(previous.blobTombstones ? { blobTombstones: previous.blobTombstones } : {}),
    ...(previous.blobSweepAt !== undefined ? { blobSweepAt: previous.blobSweepAt } : {}),
    ...(previous.legacyStamp !== undefined ? { legacyStamp: previous.legacyStamp } : {}),
    ...(previous.legacyDigest !== undefined ? { legacyDigest: previous.legacyDigest } : {}),
  };
}

/** Complète un index partiel sans jamais inventer d'entrée de note. */
export function normalizeIndex(input: unknown): NotesIndex {
  const src = isPlainObject(input) ? input : {};
  const rawNotes = isPlainObject(src.notes) ? src.notes : {};
  const notes: Record<string, NoteIndexEntry> = {};
  for (const [id, value] of Object.entries(rawNotes)) {
    if (!isPlainObject(value)) continue;
    if (typeof value.objectId !== 'string' || value.objectId.length === 0) continue;
    notes[id] = {
      objectId: value.objectId,
      updatedAt: isoOrNull(value.updatedAt),
      deletedAt: isoOrNull(value.deletedAt),
      digest: typeof value.digest === 'string' ? value.digest : '',
      syncedDigest: typeof value.syncedDigest === 'string' ? value.syncedDigest : null,
      ...(typeof value.localShape === 'string' ? { localShape: value.localShape } : {}),
    };
  }
  const allIds = Array.isArray(src.allIds)
    ? src.allIds.filter((id): id is string => typeof id === 'string')
    : [];
  return {
    version: NOTES_FORMAT_VERSION,
    // Mémoire d'APPAREIL, conservée telle quelle : `normalizeIndex` s'exécute
    // en tête de `mergeIndexes`, et la laisser tomber ici la ferait repartir de
    // zéro à chaque cycle — donc relire dix mégaoctets de blob v1 sans que rien
    // ne le signale. `undefined` reste `undefined` : un index qui n'en porte pas
    // ne doit pas se voir inventer une empreinte.
    ...(typeof src.legacyStamp === 'string' || src.legacyStamp === null
      ? { legacyStamp: src.legacyStamp as string | null }
      : {}),
    ...(isPlainObject(src.blobs) ? { blobs: src.blobs as Record<string, string> } : {}),
    ...(isPlainObject(src.blobTombstones)
      ? { blobTombstones: src.blobTombstones as Record<string, string> }
      : {}),
    ...(typeof src.blobSweepAt === 'string' ? { blobSweepAt: src.blobSweepAt } : {}),
    ...(typeof src.legacyDigest === 'string' || src.legacyDigest === null
      ? { legacyDigest: src.legacyDigest as string | null }
      : {}),
    notes,
    allIds,
    notebooks: isPlainObject(src.notebooks) ? src.notebooks : {},
    templates: Array.isArray(src.templates) ? src.templates : [],
    purged: isPlainObject(src.purged) ? (src.purged as Record<string, string>) : {},
    purgedNotebooks: isPlainObject(src.purgedNotebooks)
      ? (src.purgedNotebooks as Record<string, string>)
      : {},
  };
}

/** Union par id, horloge la plus récente ; sans horloge, le local tient. */
function mergeKeyed(
  local: Record<string, unknown>,
  remote: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...local };
  for (const [id, value] of Object.entries(remote)) {
    if (!has(out, id)) {
      out[id] = value;
      continue;
    }
    if (noteClock(value) > noteClock(out[id])) out[id] = value;
  }
  return out;
}

/** Même règle, sur un TABLEAU identifié par `id`. L'ordre local est conservé. */
function mergeTemplates(local: unknown[], remote: unknown[]): unknown[] {
  const byId = new Map<string, unknown>();
  const order: string[] = [];
  const anonymous: unknown[] = [];
  const push = (item: unknown, fromRemote: boolean): void => {
    if (!isPlainObject(item) || typeof item.id !== 'string') {
      if (!fromRemote) anonymous.push(item);
      return;
    }
    const id = item.id;
    if (!byId.has(id)) {
      byId.set(id, item);
      order.push(id);
      return;
    }
    if (noteClock(item) > noteClock(byId.get(id))) byId.set(id, item);
  };
  for (const item of local) push(item, false);
  for (const item of remote) push(item, true);
  return [...order.map((id) => byId.get(id)), ...anonymous];
}

function sameIndex(a: NotesIndex, b: NotesIndex, withAncestor: boolean): boolean {
  const ka = Object.keys(a.notes);
  const kb = Object.keys(b.notes);
  if (ka.length !== kb.length) return false;
  for (const id of ka) {
    if (!sameEntry(a.notes[id], b.notes[id], withAncestor)) return false;
  }
  if (a.allIds.length !== b.allIds.length) return false;
  for (let i = 0; i < a.allIds.length; i++) {
    if (a.allIds[i] !== b.allIds[i]) return false;
  }
  if (!sameRecord(a.notebooks, b.notebooks)) return false;
  if (JSON.stringify(a.templates) !== JSON.stringify(b.templates)) return false;
  if (!sameRecord(a.purged, b.purged)) return false;
  if (!sameRecord(a.purgedNotebooks, b.purgedNotebooks)) return false;
  if (!sameRecord(a.blobs ?? {}, b.blobs ?? {})) return false;
  if (!sameRecord(a.blobTombstones ?? {}, b.blobTombstones ?? {})) return false;
  return true;
}
