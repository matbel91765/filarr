/**
 * FAÇADE DU COFFRE DE NOTES — le seul point par lequel le processus principal
 * lit et écrit les notes, quel que soit le format sur le disque.
 *
 * ═══ QUI DÉCIDE DU FORMAT ═══
 *
 * LE DISQUE, et lui seul. `detectFormat` regarde ce qui existe : un index v2
 * présent veut dire v2, point. Aucun réglage ne peut faire lire une v2 comme
 * une v1, ni l'inverse — c'est ce qui rend impossible la panne la plus grave
 * imaginable ici : écrire dans un format et relire dans l'autre.
 *
 * Le drapeau ci-dessous ne décide QUE d'une chose : faut-il MIGRER un profil
 * encore en v1. Une fois migré, il n'a plus aucun effet.
 *
 * ═══ POURQUOI LA MIGRATION EST DORMANTE ═══
 *
 * `FILARR_NOTES_V2` n'est pas une précaution de façade. Migrer réécrit le
 * rangement de toutes les notes d'un compte, sur des données chiffrées, chez des
 * gens qui n'ont pas demandé à essuyer les plâtres. Le moteur est éprouvé
 * (61 contrats, dont l'aller-retour, la parité d'arbitrage avec la v1 et les
 * coupures de courant), mais éprouvé n'est pas ROULÉ EN VRAI : aucune de ces
 * lignes n'a encore tourné sur un vrai profil, avec de la vraie crypto, sur un
 * vrai disque.
 *
 * Tant que ce drapeau est absent, ce fichier se comporte EXACTEMENT comme
 * avant : v1 partout, aucune écriture nouvelle, aucun dossier créé. Le mettre
 * est un geste délibéré, à faire sur une copie de profil d'abord.
 */

import crypto from 'crypto';
import log from 'electron-log';

import {
  bootstrapEmptyV2,
  detectFormat,
  loadVaultV2,
  readBounded,
  VAULT_READ_CONCURRENCY,
  migrateToV2,
  saveVaultV2,
  type VaultFormat,
  type VaultIO,
} from './notesVaultStore';
import { createVaultIO, upgradeNotesVaultContainers } from './notesVaultIO';
import { blobPath, extractBlobs, inlineBlobs } from './noteBlobs';
import { NOTES_DIR } from './notesStoreV2';
import type { NotesIndex, NotesPayload, SplitDeps } from './notesStoreV2';

/**
 * Le drapeau d'activation de la MIGRATION. Lu à chaque appel plutôt que mis en
 * cache : basculer doit pouvoir se faire sans reconstruire l'application.
 */
export function isMigrationEnabled(): boolean {
  const raw = process.env.FILARR_NOTES_V2;
  return raw === '1' || raw === 'true';
}

/**
 * Empreinte du CLAIR d'une note — c'est elle qui décide s'il faut réécrire un
 * objet et s'il faut le transférer. Sur la sérialisation canonique : deux notes
 * identiques doivent donner la même empreinte sur DEUX APPAREILS DIFFÉRENTS,
 * donc pas de sel, pas d'aléa, rien qui dépende de la machine.
 */
function digestOf(note: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(stableStringify(note)).digest('hex').slice(0, 32);
}

/**
 * Sérialisation à clés TRIÉES. `JSON.stringify` suit l'ordre d'insertion : deux
 * appareils qui ont construit la même note par des chemins différents
 * produiraient des chaînes différentes, donc des empreintes différentes, donc un
 * transfert perpétuel pour un contenu identique.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`
  );
  return `{${parts.join(',')}}`;
}

/** Identifiant d'objet opaque : 16 octets d'aléa, jamais l'identifiant de note. */
function newObjectId(): string {
  return crypto.randomBytes(12).toString('base64url');
}

export function splitDeps(): SplitDeps {
  return { digestOf, newObjectId };
}

/**
 * Empreinte d'une IMAGE : SHA-256 de sa charge base64, sur seize octets.
 *
 * C'est l'identifiant de l'objet, donc il doit valoir la MÊME chose sur toutes
 * les plateformes : mêmes octets d'entrée (la charge, jamais la data-URL
 * entière), même algorithme, même troncature. Une divergence ferait remonter
 * deux fois la même image sous deux clés — exactement ce que l'adressage par
 * contenu existe pour empêcher.
 */
export function blobHash(base64: string): string {
  return crypto.createHash('sha256').update(base64, 'utf8').digest('hex').slice(0, 32);
}

/**
 * SORT LES IMAGES DES NOTES ET LES POSE SUR LE DISQUE.
 *
 * Les blobs sont écrits AVANT que le coffre ne soit réécrit avec leurs
 * références — même règle que « les notes avant l'index », et pour la même
 * raison : une coupure entre les deux laisserait un coffre qui désigne des
 * octets absents.
 *
 * Une image déjà présente n'est pas réécrite : elle est immuable, l'empreinte
 * le prouve.
 */
export async function extractIntoStore(
  io: VaultIO,
  payload: NotesPayload
): Promise<{ payload: NotesPayload; extracted: number }> {
  const byId = payload.byId as Record<string, Record<string, unknown>> | undefined;
  if (!byId || typeof byId !== 'object') return { payload, extracted: 0 };

  const suivant: Record<string, unknown> = {};
  let extracted = 0;

  for (const [noteId, note] of Object.entries(byId)) {
    if (!note || typeof note !== 'object') {
      suivant[noteId] = note;
      continue;
    }
    const { content, blobs, rewritten } = extractBlobs(note, blobHash);
    if (rewritten === 0) {
      suivant[noteId] = note;
      continue;
    }
    for (const [hash, base64] of Object.entries(blobs)) {
      const chemin = blobPath(NOTES_DIR, hash);
      if (!chemin) continue;
      if ((await io.read(chemin)) === null) await io.write(chemin, base64);
    }
    suivant[noteId] = content;
    extracted += rewritten;
  }

  return { payload: { ...payload, byId: suivant }, extracted };
}

/**
 * REMET LES IMAGES DANS LES NOTES, pour que le renderer voie exactement ce
 * qu'il voyait avant : des data-URL.
 *
 * C'est ce qui rend tout le changement supportable — aucune vue de nœud, aucune
 * CSP, aucun protocole ne bouge. La séparation vit entre `notes:save` et
 * `notes:load`, et nulle part ailleurs.
 */
export async function inlineFromStore(
  io: VaultIO,
  payload: NotesPayload,
  /** Reçoit les empreintes citées mais absentes du disque — voir `rememberMissingBlobs`. */
  missingOut?: Set<string>
): Promise<NotesPayload> {
  const byId = payload.byId as Record<string, Record<string, unknown>> | undefined;
  if (!byId || typeof byId !== 'object') return payload;

  // Un cache de cycle : la même image citée par vingt notes ne se déchiffre
  // qu'une fois.
  const cache = new Map<string, string | null>();
  const lire = (hash: string): string | null => cache.get(hash) ?? null;

  // Première passe : recenser puis charger, pour que `inlineBlobs` reste
  // synchrone (et donc PUR, donc éprouvable sans disque).
  const { referencedBlobs } = await import('./noteBlobs');
  const besoin = new Set<string>();
  for (const note of Object.values(byId)) referencedBlobs(note, besoin);
  // De front : chaque image est un conteneur `v2:` à 265 ms de PBKDF2, comme
  // les notes (voir `VAULT_READ_CONCURRENCY`).
  await readBounded([...besoin], VAULT_READ_CONCURRENCY, async (hash) => {
    const chemin = blobPath(NOTES_DIR, hash);
    const brut = chemin ? await io.read(chemin) : null;
    cache.set(hash, typeof brut === 'string' ? brut : null);
  });

  const suivant: Record<string, unknown> = {};
  let manquantes = 0;
  for (const [noteId, note] of Object.entries(byId)) {
    const { content, missing } = inlineBlobs(note, lire);
    suivant[noteId] = content;
    manquantes += missing.length;
    if (missingOut) for (const h of missing) missingOut.add(h);
  }
  if (manquantes > 0) {
    log.warn(
      `[notesVault] ${manquantes} image(s) introuvable(s) — les références restent en place, ` +
        `rien n'est effacé`
    );
  }
  return { ...payload, byId: suivant };
}

export interface LoadedNotes {
  payload: NotesPayload;
  format: VaultFormat;
  /** Présent en v2 seulement — à repasser à `saveNotes` pour une écriture incrémentale. */
  index?: NotesIndex;
  /** Notes que l'index cite mais qui n'ont pas pu être lues (v2). */
  missing: string[];
  /** Images citées par les notes mais absentes du disque (v2) — à signaler au cycle. */
  missingBlobs: string[];
}

/**
 * CHARGE LE COFFRE, dans le format que le disque porte.
 *
 * Rend toujours la forme v1 : tout ce qui vit au-dessus — le renderer,
 * l'historique de versions, la sauvegarde incrémentale — ne sait rien du
 * rangement et n'a pas à le savoir.
 */
export async function loadNotes(dataDir: string): Promise<LoadedNotes | null> {
  const io = createVaultIO(dataDir);

  /**
   * ⚠ ON NE PASSE PAS PAR `detectFormat` ICI, ET C'EST IMPORTANT.
   *
   * `detectFormat` déchiffre `notes.enc` pour conclure « v1 » — soit 9,9 Mo et
   * ~2 s sur un coffre réel. Sur le chemin de CHARGEMENT, où l'appelant relira
   * ce même blob juste après, ça doublerait purement et simplement le coût du
   * démarrage pour tous les profils encore en v1, c'est-à-dire pour tout le
   * monde tant que la v2 est dormante.
   *
   * `loadVaultV2` ne lit que l'index : absent, il rend `null` et on s'arrête là.
   * Une lecture de quelques octets pour dire « pas de v2 ».
   */
  const loaded = await loadVaultV2(io);
  if (loaded) {
    const format: VaultFormat = 'v2';
    // Les images reviennent DANS les notes : le renderer voit ce qu'il a
    // toujours vu, et rien au-dessus de cette ligne ne sait qu'elles vivent
    // ailleurs.
    const imagesManquantes = new Set<string>();
    loaded.payload = await inlineFromStore(io, loaded.payload, imagesManquantes);
    if (loaded.missing.length > 0) {
      log.warn(
        `[notesVault] v2 : ${loaded.missing.length} note(s) illisible(s) — ` +
          `l'index les connaît toujours, aucune n'est effacée`
      );
    }
    return {
      payload: loaded.payload,
      format,
      index: loaded.index,
      missing: loaded.missing,
      missingBlobs: [...imagesManquantes],
    };
  }

  // Profil VIERGE : il naît en v2 (voir bootstrapEmptyV2). Le premier
  // enregistrement écrira des objets, jamais un paquet v1.
  const born = await bootstrapEmptyV2(io);
  if (born) {
    log.info('[notesVault] profil sans note : né en v2 (index vide posé)');
    return {
      payload: { byId: {}, allIds: [], templates: [], notebooks: {} } as NotesPayload,
      format: 'v2',
      index: born,
      missing: [],
      missingBlobs: [],
    };
  }
  // Pas de v2 : on ne charge PAS le blob v1 ici. L'appelant a son propre chemin
  // v1, éprouvé, et le relire deux fois ne servirait qu'à payer deux fois.
  return null;
}

export interface SavedNotes {
  format: VaultFormat;
  index?: NotesIndex;
  /** Objets réellement réécrits (v2). Vide en v1. */
  written: string[];
}

/**
 * ÉCRIT LE COFFRE. En v2, l'écriture est INCRÉMENTALE : seules les notes dont
 * l'empreinte a bougé repartent sur le disque.
 *
 * ⚠ REFUSE D'ÉCRIRE SI DES NOTES MANQUENT À L'APPEL. Écrire un coffre auquel il
 * manque les notes qu'on n'a pas su relire les effacerait de l'index — donc du
 * nuage, donc de tous les appareils. L'appelant doit passer `missing` tel que
 * `loadNotes` le lui a rendu.
 */
export async function saveNotesV2(
  dataDir: string,
  payload: NotesPayload,
  previous: NotesIndex | null,
  missing: string[] = []
): Promise<SavedNotes> {
  if (missing.length > 0) {
    throw new Error(
      `notesVault: écriture refusée — ${missing.length} note(s) n'ont pas pu être relues`
    );
  }
  const io = createVaultIO(dataDir);
  /**
   * LES IMAGES SORTENT ICI, et c'est tout le gain : le coffre écrit ne porte
   * plus que des références. Taper une virgule dans une note illustrée cesse
   * de rescellter, réécrire et retransférer ses images — 318 Ko de moyenne par
   * note sur un coffre réel.
   */
  const sorti = await extractIntoStore(io, payload);
  if (sorti.extracted > 0) {
    log.info(`[notesVault] ${sorti.extracted} image(s) sortie(s) du JSON des notes`);
  }
  const res = await saveVaultV2(io, sorti.payload, splitDeps(), previous);
  return { format: 'v2', index: res.index, written: res.written };
}

/**
 * MIGRE CE PROFIL VERS LA v2, si et seulement si le drapeau est posé.
 *
 * Rend `null` quand il n'y a rien à faire (drapeau absent, profil déjà en v2,
 * pas de blob) — l'appelant n'a alors rien à changer à son comportement.
 * `notes.enc` n'est JAMAIS supprimé : c'est le seul chemin de retour.
 */
export type LegacyVerdict = 'safe' | 'legacy-active' | 'unknown';

export async function migrateIfEnabled(
  dataDir: string,
  legacy: LegacyVerdict
): Promise<NotesIndex | null> {
  if (!isMigrationEnabled()) return null;

  /**
   * ON NE MIGRE PAS SANS SAVOIR CE QUE LE NUAGE PORTE.
   *
   * Migrer cet appareil pendant qu'un autre ecrit encore l'ancien blob
   * fabriquerait exactement la panne que ce chantier poursuit : le second
   * continuerait de publier `meta:notes`, celui-ci ne le lirait plus, et les
   * notes ecrites la-bas n'arriveraient nulle part — sans erreur, sans
   * indicateur, sans rien.
   *
   * `unknown` est REFUSE au meme titre que `legacy-active` : au demarrage aucun
   * cycle n'a encore vu le manifeste distant, et migrer dans le noir est
   * precisement le geste qu'on ne veut pas. Le premier cycle tranchera, et la
   * migration se fera au chargement suivant.
   */
  if (legacy !== 'safe') {
    log.info(
      `[notesVault] migration v2 differee : ${
        legacy === 'unknown'
          ? "le nuage n'a pas encore ete consulte"
          : 'un autre appareil ecrit encore au format v1'
      }`
    );
    return null;
  }

  const io: VaultIO = createVaultIO(dataDir);
  if ((await detectFormat(io)) !== 'v1') return null;

  const res = await migrateToV2(io, splitDeps());
  if (!res.ok) {
    log.info(`[notesVault] migration v2 non effectuée : ${res.why}`);
    return null;
  }
  log.info(
    `[notesVault] MIGRÉ en v2 — ${res.noteCount} note(s) rangées une par une. ` +
      `notes.enc est conservé tel quel.`
  );
  return res.index ?? null;
}

/**
 * MIGRE PARCE QUE QUELQU'UN L'A DEMANDÉ.
 *
 * La différence avec `migrateIfEnabled` tient en une ligne : pas de
 * `FILARR_NOTES_V2`. Ce drapeau gouverne la migration AUTOMATIQUE — celle qui
 * se déclencherait toute seule au premier chargement, sur des données que son
 * propriétaire n'a pas décidé de déplacer. Un bouton, lui, EST la décision : le
 * redemander par variable d'environnement serait demander deux fois la même
 * chose.
 *
 * LE GARDE-FOU, EN REVANCHE, RESTE ENTIER. Un geste délibéré ne rend pas sûr de
 * migrer pendant qu'un autre appareil écrit encore en v1 : l'utilisateur ne peut
 * pas savoir ce que le nuage porte, c'est précisément ce que le verdict lui
 * apprend. Il est donc appliqué ici exactement comme là-bas.
 */
export async function migrateNow(
  dataDir: string,
  legacy: LegacyVerdict,
  opts: MigrateOptions = {}
): Promise<{ ok: boolean; why?: string; noteCount?: number }> {
  // Sans avoir vu le nuage, on ne bouge pas : c'est la seule interdiction
  // qui ne se leve pas. Un ecrivain v1 encore actif, lui, se franchit en
  // connaissance de cause — le pont (`shouldWriteBackLegacy`) continue de
  // lui ecrire `notes.enc`, et `reconcileLegacyBlob` lit ce qu'il y met.
  if (legacy === 'unknown') return { ok: false, why: 'cloud-not-seen' };
  if (legacy === 'legacy-active' && !opts.acknowledgeLegacyWriter) {
    return { ok: false, why: 'legacy-active' };
  }  const io: VaultIO = createVaultIO(dataDir);
  const format = await detectFormat(io);
  if (format === 'v2') return { ok: false, why: 'already-v2' };
  if (format === 'none') {
    // Rien à déplacer : on pose l'index vide, le profil est en v2.
    await bootstrapEmptyV2(io);
    return { ok: true, noteCount: 0 };
  }

  const res = await migrateToV2(io, splitDeps());
  if (!res.ok) return { ok: false, why: res.why };
  log.info(
    `[notesVault] MIGRÉ en v2 sur demande — ${res.noteCount} note(s). ` +
      `notes.enc est conservé tel quel.`
  );
  return { ok: true, noteCount: res.noteCount };
}

export interface MigrateOptions {
  /**
   * La personne a lu qu'un autre appareil ecrit encore a l'ancien format et
   * bascule quand meme : le pont le servira jusqu'a ce qu'il bascule a son tour.
   */
  acknowledgeLegacyWriter?: boolean;
}

/** Le format que porte ce profil, sans rien charger. */
export async function formatOf(dataDir: string): Promise<VaultFormat> {
  return detectFormat(createVaultIO(dataDir));
}

/**
 * Migration locale `v2:` → `v3:` des objets, index et images du coffre — voir
 * `upgradeNotesVaultContainers`. Sans effet tant que FILARR_MACHINE_CONTAINER_V3
 * n'est pas à `notes` ou `all`. À passer sous le verrou des notes.
 */
export async function upgradeContainers(dataDir: string) {
  return upgradeNotesVaultContainers(dataDir);
}
