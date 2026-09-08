/**
 * COUCHE DE RANGEMENT DU COFFRE DE NOTES — v1 (un blob) et v2 (un objet par
 * note), et le passage de l'une à l'autre.
 *
 * ORCHESTRATION PURE : toutes les entrées/sorties passent par `VaultIO`, qui
 * chiffre et déchiffre. Ce module ne connaît ni `fs`, ni la crypto, ni Electron
 * — c'est ce qui permet de l'éprouver entièrement en mémoire, y compris les
 * pannes (écriture qui échoue au milieu, objet illisible, index absent).
 *
 * ═══ CE QUI EST SUR LE DISQUE ═══
 *
 *   <profil>/notes.enc            ← v1. CONSERVÉ après migration, jamais effacé.
 *   <profil>/notes/index.enc      ← v2. L'index fait AUTORITÉ.
 *   <profil>/notes/<objectId>.enc ← v2. Une note.
 *
 * ═══ L'INDEX EST ÉCRIT EN DERNIER, ET C'EST TOUTE L'ATOMICITÉ ═══
 *
 * Un dossier ne se renomme pas atomiquement comme un fichier. On s'appuie donc
 * sur une règle plus simple : **le coffre v2 n'existe que si son index existe**.
 * Une écriture interrompue laisse des objets de note orphelins et aucun index —
 * état parfaitement inoffensif, que `detectFormat` lit comme « pas encore de
 * v2 » et que la migration suivante recouvre.
 *
 * L'ordre est donc, sans exception : les notes d'abord, l'index ensuite.
 *
 * ═══ LA MIGRATION NE DÉTRUIT RIEN ═══
 *
 * `migrateToV2` lit `notes.enc`, écrit les objets, écrit l'index, et S'ARRÊTE
 * LÀ. `notes.enc` reste sur le disque, intact, pour toujours. Il coûte quelques
 * mégaoctets et il est la seule chose qui permette de revenir en arrière si la
 * v2 déçoit. Le supprimer serait la seule décision irréversible de tout ce
 * chantier — on ne la prend pas.
 *
 * ═══ CE QUI RESTE À FAIRE (et qui n'est PAS ici) ═══
 *
 * La réconciliation avec un appareil resté en v1. Tant que tous les appareils
 * d'un compte ne sont pas passés en v2, l'un d'eux continue d'écrire
 * `meta:notes` dans le nuage, et ses notes doivent être RÉINJECTÉES et non
 * ignorées. C'est le travail de `syncService`, pas celui de cette couche :
 * `mergeV1PayloadIntoV2` lui en donne le moyen.
 */

/**
 * ⚠ SOURCE DE VÉRITÉ : `electron/sync/notesVaultStore.ts`.
 *
 * PORTAGE À L'IDENTIQUE, pas une variante. La duplication est imposée par la
 * racine de `electron/tsconfig.json` (voir l'entête de `notesStoreV2.ts`).
 * `notesStoreV2Parity.vitest.ts` confronte les deux familles.
 */

import {
  assembleVault,
  mergeIndexes,
  missingNotes,
  normalizeIndex,
  isNotesIndexShape,
  carryIndexDeviceFields,
  splitVault,
  NOTES_DIR,
  NOTES_FORMAT_VERSION,
  NOTES_INDEX_FILENAME,
  type NoteRecord,
  type NotesIndex,
  type NotesPayload,
  type SplitDeps,
} from './notesStoreV2';

/** Nom du blob v1, à la racine du profil. */
export const V1_BLOB_FILENAME = 'notes.enc';

/**
 * Entrées/sorties du coffre. L'implémentation réelle chiffre avec la FEK ; les
 * tests en fournissent une en mémoire. Les chemins sont RELATIFS au dossier du
 * profil : ce module ne fabrique jamais de chemin absolu.
 */
export interface VaultIO {
  /** Lit et déchiffre. `null` = absent, vide, ou illisible — jamais une exception. */
  read(relPath: string): Promise<unknown | null>;
  /** Chiffre et écrit. Doit être atomique au niveau du FICHIER (écrire-puis-renommer). */
  write(relPath: string, plain: unknown): Promise<void>;
  /** Supprime. Ne jette pas si le fichier n'existe pas. */
  remove(relPath: string): Promise<void>;
  /** Noms de fichiers présents dans un dossier relatif ; `[]` si le dossier manque. */
  list(relDir: string): Promise<string[]>;
  /**
   * Identité du fichier (taille + date, peu importe la forme), ou `null` s'il
   * n'existe pas. Sert UNIQUEMENT à savoir si quelque chose a bougé sans payer
   * la lecture : le blob v1 pèse dix mégaoctets, et le relire à chaque cycle
   * pour découvrir qu'il n'a pas changé coûterait plus cher que tout ce que la
   * v2 fait gagner.
   */
  stat?(relPath: string): Promise<string | null>;
}

export type VaultFormat = 'none' | 'v1' | 'v2';

const indexPath = (): string => `${NOTES_DIR}/${NOTES_INDEX_FILENAME}`;
const notePath = (objectId: string): string => `${NOTES_DIR}/${objectId}.enc`;

/**
 * Un identifiant d'objet acceptable. Sert de garde à la LECTURE comme à
 * l'écriture : un index venu du nuage est une donnée, et une entrée dont
 * l'`objectId` contiendrait `../` fabriquerait un chemin hors du profil.
 */
const OBJECT_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidObjectId(v: unknown): v is string {
  return typeof v === 'string' && OBJECT_ID_REGEX.test(v);
}

/**
 * QUEL FORMAT LE DISQUE PORTE-T-IL ?
 *
 * L'index d'abord : sa présence DÉFINIT la v2 (voir l'atomicité en tête). Sans
 * lui, on regarde `notes.enc`. Sans les deux, le profil n'a pas encore de notes.
 */
export async function detectFormat(io: VaultIO): Promise<VaultFormat> {
  const index = await io.read(indexPath());
  if (index !== null) return 'v2';
  const blob = await io.read(V1_BLOB_FILENAME);
  if (blob !== null) return 'v1';
  return 'none';
}

// ── Lecture ─────────────────────────────────────────────────────────────────

export interface LoadedVault {
  payload: NotesPayload;
  index: NotesIndex;
  /** Notes que l'index cite mais dont l'objet n'a pas pu être lu. */
  missing: string[];
}

/**
 * CHARGE LE COFFRE v2 ET LE REND À LA FORME v1.
 *
 * Tout ce qui vit au-dessus — le renderer, la sauvegarde incrémentale,
 * l'historique — continue de voir exactement le même objet qu'avant. La v2 est
 * un changement de RANGEMENT, pas de modèle.
 *
 * Une note illisible est SIGNALÉE (`missing`) et omise, jamais rendue vide :
 * un trou dans `byId` se lirait comme une suppression, et la sauvegarde
 * suivante le propagerait au nuage. L'appelant doit refuser d'écrire tant que
 * `missing` n'est pas vide — c'est ce que `saveVaultFull` impose plus bas.
 */
export async function loadVaultV2(io: VaultIO): Promise<LoadedVault | null> {
  const raw = await io.read(indexPath());
  if (raw === null) return null;
  /**
   * GARDE DE FORME — voir `isNotesIndexShape`. Sans elle, un `index.enc` qui se
   * déchiffre en n'importe quel objet (déchiffrement à moitié réussi, entrée
   * d'une autre nature posée là) devenait un index VIDE et VALIDE : le coffre
   * paraissait sans notes, et la sauvegarde suivante supprimait tous les objets
   * devenus « orphelins ». On JETTE plutôt : un index illisible n'est pas un
   * coffre vide, et l'appelant doit s'abstenir d'écrire.
   */
  if (!isNotesIndexShape(raw)) {
    throw new Error("notesVaultStore: index.enc n'a pas la forme d'un index v2 — lecture refusée");
  }
  const index = normalizeIndex(raw);

  const notes: Record<string, NoteRecord> = {};
  for (const [noteId, entry] of Object.entries(index.notes)) {
    if (!isValidObjectId(entry.objectId)) continue;
    const note = await io.read(notePath(entry.objectId));
    if (note && typeof note === 'object' && !Array.isArray(note)) {
      notes[noteId] = note as NoteRecord;
    }
  }

  return { payload: assembleVault(index, notes), index, missing: missingNotes(index, notes) };
}

/** Charge le blob v1. `null` s'il n'existe pas ou n'a pas la forme attendue. */
export async function loadVaultV1(io: VaultIO): Promise<NotesPayload | null> {
  const raw = await io.read(V1_BLOB_FILENAME);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const payload = raw as NotesPayload;
  if (!payload.byId || typeof payload.byId !== 'object') return null;
  return payload;
}

// ── Écriture ────────────────────────────────────────────────────────────────

export interface SaveResult {
  index: NotesIndex;
  /** Objets réellement écrits (notes dont l'empreinte a changé). */
  written: string[];
  /** Objets devenus orphelins et supprimés. */
  removed: string[];
}

/**
 * ÉCRIT LE COFFRE ENTIER EN v2, en ne touchant QUE ce qui a changé.
 *
 * Le nom dit « full » parce que la charge utile est le coffre complet — mais
 * l'écriture, elle, est incrémentale : une note dont l'empreinte n'a pas bougé
 * n'est pas réécrite. C'est ce qui fait qu'une sauvegarde coûte la taille de ce
 * qu'on a tapé, et non celle de la bibliothèque.
 *
 * L'ORDRE EST UNE GARANTIE : notes d'abord, index ensuite, orphelins en dernier.
 * Une panne au milieu laisse un index qui désigne un état cohérent — l'ancien
 * si l'index n'a pas été écrit, le nouveau s'il l'a été.
 */
export async function saveVaultV2(
  io: VaultIO,
  payload: NotesPayload,
  deps: SplitDeps,
  previous?: NotesIndex | null
): Promise<SaveResult> {
  const { index: fresh, notes } = splitVault(payload, deps, previous ?? null);
  /**
   * REPORT DES CHAMPS D'APPAREIL ET DE REGISTRE. `splitVault` fabrique un index
   * NEUF depuis la charge utile : `blobs`, `blobTombstones`, `legacyStamp`,
   * `blobSweepAt` et `legacyDigest` ne vivent pas dans le coffre v1, donc il
   * n'a aucun moyen de les connaître — et chaque sauvegarde les effaçait.
   * Voir `carryIndexDeviceFields`, et son miroir mobile `indexFromSlice`.
   */
  const index = carryIndexDeviceFields(fresh, previous ?? null);

  const written: string[] = [];
  for (const [noteId, entry] of Object.entries(index.notes)) {
    if (!isValidObjectId(entry.objectId)) {
      throw new Error(`notesVaultStore: identifiant d'objet refusé pour ${noteId}`);
    }
    // Empreinte inchangée ET objet déjà connu : rien à réécrire.
    const before = previous?.notes?.[noteId];
    if (before && before.objectId === entry.objectId && before.digest === entry.digest) continue;
    await io.write(notePath(entry.objectId), notes[noteId]);
    written.push(entry.objectId);
  }

  // L'INDEX EN DERNIER : jusqu'ici, le coffre v2 sur le disque est encore
  // l'ancien. C'est cette écriture-ci qui publie le nouveau, d'un coup.
  await io.write(indexPath(), index);

  // Les orphelins ne partent qu'APRÈS : supprimer avant l'index laisserait un
  // index qui désigne des objets qui n'existent plus.
  const removed: string[] = [];
  if (previous) {
    const kept = new Set(Object.values(index.notes).map((e) => e.objectId));
    for (const before of Object.values(previous.notes)) {
      if (!kept.has(before.objectId)) {
        await io.remove(notePath(before.objectId));
        removed.push(before.objectId);
      }
    }
  }

  return { index, written, removed };
}

// ── Acces a un objet isole (chemin de synchronisation) ─────────────────────
//
// Le cycle de sync ne reecrit pas le coffre entier : il pose UNE note descendue,
// puis l'index. Ces trois fonctions sont son outillage, et elles imposent la
// meme discipline que `saveVaultV2` — l'appelant ecrit les notes AVANT l'index.

/** Lit un objet de note isole. `null` = absent ou illisible. */
export async function readNoteObject(io: VaultIO, objectId: string): Promise<NoteRecord | null> {
  if (!isValidObjectId(objectId)) return null;
  const raw = await io.read(notePath(objectId));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as NoteRecord;
}

/** Ecrit un objet de note isole. Jette sur un identifiant refuse. */
export async function writeNoteObject(
  io: VaultIO,
  objectId: string,
  note: NoteRecord
): Promise<void> {
  if (!isValidObjectId(objectId)) {
    throw new Error(
      `notesVaultStore: identifiant d'objet refuse : ${String(objectId).slice(0, 32)}`
    );
  }
  await io.write(notePath(objectId), note);
}

/**
 * Ecrit l'index. A n'appeler qu'APRES avoir pose toutes les notes qu'il cite —
 * c'est cette ecriture qui publie le nouvel etat du coffre (voir l'atomicite en
 * tete de fichier).
 */
export async function writeIndex(io: VaultIO, index: NotesIndex): Promise<void> {
  await io.write(indexPath(), index);
}

// ── Migration v1 → v2 ───────────────────────────────────────────────────────

export interface MigrationResult {
  ok: boolean;
  /** Pourquoi la migration n'a pas eu lieu, quand `ok` est faux. */
  why?: string;
  index?: NotesIndex;
  noteCount?: number;
}

/**
 * MIGRE `notes.enc` VERS LE FORMAT v2.
 *
 * Trois refus, tous du même genre : on ne migre pas un état qu'on ne comprend
 * pas. Pas de blob, blob illisible, ou v2 déjà présente — dans les trois cas on
 * ne touche à rien et on le dit.
 *
 * `notes.enc` N'EST PAS SUPPRIMÉ. Il reste le seul chemin de retour, et il est
 * aussi ce que lira un appareil resté en v1. Le garder coûte quelques
 * mégaoctets ; le supprimer coûterait la possibilité de se tromper.
 */
export async function migrateToV2(io: VaultIO, deps: SplitDeps): Promise<MigrationResult> {
  const existing = await io.read(indexPath());
  if (existing !== null) return { ok: false, why: 'v2 déjà présente' };

  const payload = await loadVaultV1(io);
  if (!payload) return { ok: false, why: 'aucun notes.enc exploitable' };

  const { index, notes } = splitVault(payload, deps, null);
  const noteCount = Object.keys(index.notes).length;

  /**
   * GARDE ANTI-MIGRATION-VIDE. Un blob qui se déchiffre en un coffre sans
   * aucune note n'est pas forcément un coffre vide : c'est aussi ce que produit
   * une lecture qui a mal tourné. Migrer là-dessus écrirait un index vide qui
   * ferait autorité — et le blob, lui, ne serait plus jamais relu.
   */
  if (noteCount === 0) {
    const byId = payload.byId;
    const looksEmpty =
      !byId || typeof byId !== 'object' || Object.keys(byId as object).length === 0;
    if (!looksEmpty) return { ok: false, why: 'découpe vide sur un coffre non vide' };
  }

  for (const [noteId, entry] of Object.entries(index.notes)) {
    if (!isValidObjectId(entry.objectId)) {
      return { ok: false, why: `identifiant d'objet refusé pour ${noteId}` };
    }
    await io.write(notePath(entry.objectId), notes[noteId]);
  }
  // L'index en dernier : c'est lui qui fait basculer le profil en v2.
  await io.write(indexPath(), index);

  return { ok: true, index, noteCount };
}

// ── Réconciliation avec un appareil resté en v1 ─────────────────────────────

/**
 * RÉINJECTE UN COFFRE v1 (venu du nuage) DANS UN INDEX v2.
 *
 * LE PIÈGE QUE CETTE FONCTION EXISTE POUR ÉVITER. Tant que tous les appareils
 * d'un compte ne sont pas passés en v2, l'un d'eux continue d'écrire l'ancien
 * `meta:notes`. Si la v2 ignorait ce blob, les notes écrites depuis ce
 * téléphone-là n'atteindraient JAMAIS les autres appareils — et personne ne
 * verrait d'erreur, ce qui est la pire forme de perte.
 *
 * On traite donc le blob v1 comme n'importe quel index distant : on le découpe,
 * on fusionne, on obtient le même plan. `toFetch` désigne alors des notes dont
 * le contenu est DÉJÀ dans le blob — l'appelant les prend là, sans requête.
 */
export function mergeV1PayloadIntoV2(
  localIndex: NotesIndex,
  v1Payload: NotesPayload,
  deps: SplitDeps,
  nowMs: number = Date.now()
): { plan: ReturnType<typeof mergeIndexes>; notes: Record<string, NoteRecord> } {
  // Les clés d'objet du LOCAL sont reprises : une note déjà connue ne doit pas
  // se voir attribuer une clé neuve sous prétexte qu'elle arrive par le blob.
  const { index: asIndex, notes } = splitVault(v1Payload, deps, localIndex);
  return { plan: mergeIndexes(localIndex, asIndex, nowMs), notes };
}

/**
 * RÉINJECTE LE BLOB v1 DU DISQUE DANS LA v2, S'IL A BOUGÉ.
 *
 * ═══ LE CHEMIN, ET POURQUOI IL EST SIMPLE ═══
 *
 * Un appareil resté en v1 continue d'écrire `meta:notes` dans le nuage. Le
 * cycle de synchronisation ORDINAIRE le descend et le fusionne dans le
 * `notes.enc` local — ce chemin existe depuis toujours et n'a pas bougé. Après
 * migration, ce fichier n'est simplement plus lu : les notes arrivent sur le
 * disque et n'apparaissent nulle part. Silencieusement.
 *
 * Il n'y a donc RIEN à télécharger ici : il suffit de relire ce que le cycle a
 * déjà posé. C'est ce que fait cette fonction.
 *
 * ═══ ELLE NE RELIT QUE SI LE FICHIER A BOUGÉ ═══
 *
 * `legacyStamp` est l'identité du blob à la dernière réinjection. Tant qu'elle
 * ne change pas, on ne déchiffre rien. Sans cette garde, chaque cycle paierait
 * dix mégaoctets pour découvrir qu'un appareil éteint est toujours éteint.
 *
 * Rend `null` quand il n'y a rien à faire.
 */
export async function reconcileLegacyBlob(
  io: VaultIO,
  localIndex: NotesIndex,
  deps: SplitDeps,
  legacyStamp: string | null,
  nowMs: number = Date.now()
): Promise<{
  plan: ReturnType<typeof mergeIndexes>;
  notes: Record<string, NoteRecord>;
  stamp: string | null;
} | null> {
  const stamp = io.stat ? await io.stat(V1_BLOB_FILENAME) : null;
  // Pas de blob, ou blob inchangé depuis la dernière réinjection : rien à faire.
  if (io.stat && stamp === null) return null;
  if (io.stat && stamp === legacyStamp) return null;

  const payload = await loadVaultV1(io);
  if (!payload) return null;

  const { plan, notes } = mergeV1PayloadIntoV2(localIndex, payload, deps, nowMs);
  return { plan, notes, stamp };
}

/**
 * FAUT-IL REECRIRE LE BLOB v1 ? — le geste le plus destructeur de tout le lot.
 *
 * ═══ CE QU'IL FAIT, ET POURQUOI IL FAUT LE FAIRE ═══
 *
 * `reconcileLegacyBlob` ne va que dans UN SENS : il lit ce qu'un appareil reste
 * en v1 a ecrit. L'inverse manquait — une note creee ICI, en v2, n'atteignait
 * JAMAIS ce vieil appareil. Il continuait d'afficher un coffre figé au jour de
 * la migration, sans la moindre erreur. Encore la meme forme de perte.
 *
 * On reecrit donc `notes.enc` avec le coffre v2 assemble, et le cycle de
 * synchronisation ORDINAIRE — celui qui n'a pas bouge — le fait monter sous
 * `meta:notes`, ou le vieil appareil le trouve.
 *
 * ═══ QUATRE REFUS, PARCE QU'ON ECRASE UN FICHIER QU'UN AUTRE APPAREIL CROIT ═══
 *
 *  - PAS DE BLOB : on n'en fabrique pas. Le creer ressusciterait la v1 pour un
 *    compte qui l'a quittee, et ferait remonter dix megaoctets a chaque cycle
 *    pour personne.
 *  - COFFRE INCOMPLET : une note de l'index qu'on n'a pas su lire manquerait au
 *    blob reecrit — et le vieil appareil, ne la voyant plus, la traiterait comme
 *    SUPPRIMEE. Un echec de lecture deviendrait une suppression propagee.
 *  - RIEN N'A CHANGE : l'empreinte du coffre est la meme qu'a la derniere
 *    reecriture. Reecrire quand meme couterait dix megaoctets de rescellement et
 *    de transfert par cycle, pour un octet identique.
 *  - AUCUNE NOTE : un index vide ne doit pas ecraser un blob qui, lui, en porte.
 *    C'est le cas d'un index tout juste cree, ou d'une lecture qui a tout rate.
 */
export interface LegacyWritebackInput {
  /** Le blob v1 existe-t-il sur le disque ? */
  blobPresent: boolean;
  /** Empreinte du coffre tel qu'il serait ecrit (`legacyVaultDigest`). */
  digest: string;
  /** Empreinte de ce qu'on y a ecrit la derniere fois. */
  lastDigest: string | null | undefined;
  /** Notes que l'index cite mais qu'on n'a PAS su lire. */
  missing: number;
  /** Combien de notes l'index cite. */
  noteCount: number;
}

export function shouldWriteBackLegacy(input: LegacyWritebackInput): boolean {
  if (!input.blobPresent) return false;
  if (input.missing > 0) return false;
  if (input.noteCount === 0) return false;
  return input.digest !== input.lastDigest;
}

/** Objets présents sur le disque qu'aucune entrée d'index ne réclame. */
export async function findOrphanObjects(io: VaultIO, index: NotesIndex): Promise<string[]> {
  const files = await io.list(NOTES_DIR);
  const claimed = new Set(Object.values(index.notes).map((e) => `${e.objectId}.enc`));
  claimed.add(NOTES_INDEX_FILENAME);
  // ⚠ RIEN D'IMBRIQUÉ : les images vivent sous `notes/blobs/` et l'index des
  // notes ne les réclame pas — sans cette garde elles seraient toutes vues
  // comme orphelines. Même règle que le bureau, même raison.
  return files.filter((f) => !f.includes('/') && f.endsWith('.enc') && !claimed.has(f));
}

/** Age au-dela duquel un blob v1 dans le nuage est considere comme abandonne. */
export const LEGACY_NOTES_STALE_MS = 30 * 24 * 60 * 60 * 1000;

export type LegacyVerdict = 'safe' | 'legacy-active' | 'unknown';

/**
 * PEUT-ON MIGRER CE PROFIL VERS LA v2 SANS COUPER UN AUTRE APPAREIL ?
 *
 * `observed` est l'horodatage de la derniere ecriture du blob v1 VUE DANS LE
 * MANIFESTE DISTANT. Trois reponses, une seule autorise la migration :
 *
 *  - `unknown` (`undefined`) — aucun cycle n'a encore rapporte de manifeste.
 *    REFUSE : migrer sans savoir ce que le nuage porte est precisement le geste
 *    qu'on ne veut pas. Le premier cycle tranchera.
 *  - `legacy-active` — un blob v1 ecrit recemment : un autre appareil vit
 *    encore en v1, et migrer le couperait des notes ecrites ici.
 *  - `safe` — pas de blob (`null`), ou un blob abandonne depuis plus de trente
 *    jours.
 *
 * CE N'EST PAS UNE GARANTIE ABSOLUE, et il faut le dire : un appareil eteint
 * depuis deux mois peut se rallumer. Ce que ca elimine, c'est le cas courant et
 * previsible — deux appareils actifs dont un seul a ete migre.
 *
 * Un horodatage ILLISIBLE compte comme actif : on ne conclut pas a l'abandon
 * depuis une donnee qu'on ne sait pas lire.
 */
export function decideLegacyVerdict(
  observed: string | null | undefined,
  nowMs: number = Date.now()
): LegacyVerdict {
  if (observed === undefined) return 'unknown';
  if (observed === null || observed === '') return observed === null ? 'safe' : 'legacy-active';
  const ms = Date.parse(observed);
  if (Number.isNaN(ms)) return 'legacy-active';
  return nowMs - ms > LEGACY_NOTES_STALE_MS ? 'safe' : 'legacy-active';
}

/**
 * CE QUE LE MANIFESTE DIT VRAIMENT DU BLOB v1 — ou pourquoi « personne ne tape »
 * pouvait quand même bloquer la migration.
 *
 * Un appareil passé en v2 RÉÉCRIT le blob v1 à chaque changement de son index
 * (le pont, `shouldWriteBackLegacy`) pour qu'un appareil resté en v1 continue
 * de voir les notes. Cette réécriture remontait au nuage comme une écriture v1
 * ordinaire : `updatedAt` frais, rien d'autre. Tout appareil encore en v1 la
 * lisait comme « quelqu'un écrit encore à l'ancien format » et refusait de
 * migrer — indéfiniment, tant que l'appareil v2 restait en usage. Le pont
 * bloquait la migration qu’il était censé préparer.
 *
 * L'entrée porte donc maintenant `legacyWriteBack` quand c'est un appareil v2
 * qui l'a produite. Vu d'ici, c'est comme si le blob n'existait pas (`null`) :
 * son contenu vient de la v2, aucune note n'y attend d'être reprise. Un vrai
 * appareil v1 qui écrit reconstruit l'entrée SANS le drapeau — il redevient
 * visible à la seconde.
 *
 * `undefined` reste réservé à « aucun manifeste vu » (voir decideLegacyVerdict).
 */
export function legacyObservationOf(
  entry: { status?: string; updatedAt?: string; legacyWriteBack?: boolean } | null | undefined
): string | null {
  if (!entry || entry.status === 'deleted') return null;
  if (entry.legacyWriteBack === true) return null;
  return entry.updatedAt ?? '';
}

/** Version de format à annoncer dans le manifeste, d'après ce que porte le disque. */
export function formatVersionOf(format: VaultFormat): number {
  return format === 'v2' ? NOTES_FORMAT_VERSION : 1;
}

/**
 * NAÎTRE EN v2. Un profil qui n'a encore AUCUNE note — ni `notes.enc`, ni
 * `notes/index.enc` — reçoit un index vide : sa première note sera un objet,
 * pas un paquet v1 qu'il faudrait basculer plus tard (et que la bascule
 * refusait tant qu'il était vide). Tous les clients en circulation lisent
 * le v2 et rejoignent un coffre v2 existant : un profil né ainsi est lisible
 * partout. Ne touche à RIEN d'autre : un profil qui porte un blob v1 garde
 * son bouton. Rend l'index posé, ou `null` si le profil n'était pas vierge.
 */
export async function bootstrapEmptyV2(io: VaultIO): Promise<NotesIndex | null> {
  if ((await detectFormat(io)) !== 'none') return null;
  const index = normalizeIndex({});
  await writeIndex(io, index);
  return index;
}
