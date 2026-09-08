/**
 * L'INVENTAIRE — l'énumération du disque, et le classement par clé.
 *
 * TROIS SOURCES, ET LEUR UNION EST LA PREUVE DE COMPLÉTUDE :
 *   (A) `profileManager.getManifest().profiles[]` — la liste de ce qui DOIT
 *       être couvert ;
 *   (B) `FilarData/profiles/*` — le disque, seule source autoritative des
 *       octets, et la seule qui connaisse les profils ORPHELINS ;
 *   (C) le contenu de chaque répertoire de profil — `metadata.json`,
 *       `notes.enc`, `layout.enc`, et les blobs.
 *
 * LE CAS ORPHELIN N'EST PAS THÉORIQUE. Un profil supprimé, une réinstallation
 * par-dessus des données, un coffre abandonné laissent un répertoire plein de
 * fichiers scellés sous une clé que la bascule écraserait. Il est donc présenté
 * par son identifiant, avec son nombre de fichiers et son volume, et il DOIT
 * être soit inventorié, soit explicitement abandonné. L'ignorer serait une
 * non-conformité, et une perte silencieuse.
 *
 * LE CLASSEMENT PAR CLÉ EST CE QUI BORNE LA MIGRATION. Sur le bureau, la
 * bascule ne casse QUE les blobs scellés sous la FEK ; les conteneurs sous la
 * clé machine (`metadata.json`, `notes.enc`, `layout.enc`, blobs des profils
 * locaux) survivent intacts. Les noms, les arborescences, les notes et la mise
 * en page ne bougent pas. C'est ce qui rend la migration finie et annonçable.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron';
import log from 'electron-log';
import StorageService from '../storageService';
import profileManager from '../profileManager';
import type { PublishItem, PublishKeyClass, PublishLocalProfile } from './types';

/**
 * Fichiers de travail et matériel de clé : jamais publiés comme contenu.
 * Un `.v3staging-*` publié serait un fichier à moitié écrit ; un
 * `wrapped_fek.json` publié serait la clé du coffre, montée dans le nuage.
 */
const EXCLUDED_EXACT = new Set([
  'metadata.json', // traité à part, comme `folder-meta`
  'notes.enc', // traité à part, comme `notes-bundle`
  'layout.enc', // idem — le conteneur de mise en page du profil
  'sync-manifest.json',
  'multipart-resume.json',
  'appConfig.json',
  'storage.quota',
  'profiles.json',
  'encryption.key',
  'encryption.key.safe',
  'wrapped_fek.json',
  'incoming_fek.json',
  'publish-journal.json',
]);

const EXCLUDED_PREFIXES = ['.fek_safe', '.incoming_fek_safe', '.device_key_safe', '.space'];
const EXCLUDED_MARKERS = ['.v3staging-', '.migrating-', '.next'];
const EXCLUDED_SUFFIXES = ['.syncdl.tmp', '.tmp'];

function isExcludedFile(name: string): boolean {
  if (EXCLUDED_EXACT.has(name)) return true;
  if (name.startsWith('wrapped_fek.json')) return true;
  if (name.startsWith('encryption.key')) return true;
  if (EXCLUDED_PREFIXES.some((p) => name.startsWith(p))) return true;
  if (EXCLUDED_MARKERS.some((m) => name.includes(m))) return true;
  if (EXCLUDED_SUFFIXES.some((s) => name.endsWith(s))) return true;
  return false;
}

/** Répertoires qui ne sont pas des dossiers de coffre. */
function isExcludedDir(name: string): boolean {
  return name.startsWith('.') || name === 'publish' || name === 'note-versions';
}

/**
 * Clé d'élément d'un blob — RIGOUREUSEMENT la dérivation de `scanLocalFiles` :
 * `sha256('<folderId>/<fileName>')`, tronqué à 32 caractères hexadécimaux.
 * Diverger d'un octet ferait re-téléverser tout le coffre au premier cycle
 * ordinaire qui suivrait la migration.
 */
export function blobItemKey(localPath: string): string {
  return crypto.createHash('sha256').update(localPath).digest('hex').slice(0, 32);
}

export interface ScanResult {
  profiles: PublishLocalProfile[];
  items: PublishItem[];
}

interface KeyRing {
  /** Clé machine du profil (`encryption.key.safe`) — jamais menacée par la bascule. */
  machine: Buffer | null;
  /** FEK ACTIVE du compte — c'est elle qu'on abandonne. */
  active: Buffer | null;
  /** Clé entrante — présente quand une migration reprend après interruption. */
  incoming: Buffer | null;
}

/**
 * Sous quelle clé ce conteneur s'ouvre-t-il AUJOURD'HUI ?
 *
 * L'ordre des sondes suit la probabilité, pas l'importance : la clé machine
 * d'abord (majoritaire sur les profils locaux), puis la FEK, puis la clé
 * entrante. Cette dernière est une sonde de COMPATIBILITÉ : la migration
 * actuelle ne rescelle rien localement (C1), donc elle ne produit jamais de
 * blob sous cette clé — mais une tentative menée par la conception ANTÉRIEURE,
 * qui rescellait au fil de l'eau, a pu en laisser (même posture que l'état
 * `uploaded` du registre, reconnu en lecture seulement).
 */
async function classifyBlob(filePath: string, ring: KeyRing): Promise<PublishKeyClass> {
  if (await StorageService.isV3VaultFile(filePath)) {
    const keys: Buffer[] = [];
    const classes: PublishKeyClass[] = [];
    if (ring.machine) {
      keys.push(ring.machine);
      classes.push('machine');
    }
    if (ring.active) {
      keys.push(ring.active);
      classes.push('active');
    }
    if (ring.incoming) {
      keys.push(ring.incoming);
      // S'ouvre sous la clé du COMPTE — un état que la migration actuelle ne
      // produit pas (C1), hérité d'une tentative de la conception antérieure.
      // Classé « à risque » comme un blob sous FEK ; le registre décidera
      // ensuite s'il est déjà traité.
      classes.push('active');
    }
    const idx = await StorageService.probeV3KeyIndex(filePath, keys);
    return idx >= 0 ? classes[idx] : 'none';
  }

  // Conteneur hérité `v2:` / `v1:` — machine-key par construction (c'est le
  // format que `encryptBinary` produit avec `this.key`).
  const head = await fs.open(filePath, 'r').then(
    async (h) => {
      try {
        const buf = Buffer.alloc(3);
        await h.read(buf, 0, 3, 0);
        return buf.toString('utf-8');
      } finally {
        await h.close().catch(() => undefined);
      }
    },
    () => ''
  );
  if (head === 'v3:' || head === 'v2:' || head === 'v1:') return 'machine';

  // Reste : un blob FEK au format RENDERER (petit fichier de profil hybride).
  // On ne le déchiffre pas ici — ce serait lire tout le coffre pour construire
  // un inventaire. Il est présumé « à risque » ; s'il s'avère illisible au
  // moment du traitement, il deviendra `damaged` à ce moment-là, sans qu'un
  // seul de ses octets soit touché.
  return 'active';
}

/**
 * Énumère TOUS les profils locaux et TOUS leurs éléments.
 *
 * `activeFek` / `incomingFek` sont fournis par l'appelant : ce module ne
 * décide pas quelles clés existent, il classe ce qu'on lui donne.
 */
export async function scanAllProfiles(params: {
  activeFek: Buffer | null;
  incomingFek: Buffer | null;
}): Promise<ScanResult> {
  const rootDir = path.join(app.getPath('userData'), 'FilarData');
  const profilesDir = path.join(rootDir, 'profiles');

  // ── (A) le manifeste ──
  const declared = new Map<string, PublishLocalProfile>();
  try {
    for (const p of profileManager.getManifest().profiles) {
      declared.set(p.id, {
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
      });
    }
  } catch (err) {
    log.warn('[publish] profileManager indisponible pour l inventaire:', (err as Error).message);
  }

  // ── (B) le disque ──
  let dirNames: string[] = [];
  try {
    const entries = await fs.readdir(profilesDir, { withFileTypes: true });
    dirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    // Pas encore de répertoire `profiles/` — coffre hérité monolithique.
  }

  const profiles: PublishLocalProfile[] = [];
  const seen = new Set<string>();
  for (const p of declared.values()) {
    profiles.push(p);
    seen.add(p.id);
  }
  let orphanOrder = 10_000;
  for (const dir of dirNames) {
    if (seen.has(dir)) continue;
    // ORPHELIN : sur le disque, absent du manifeste. Il est nommé par son
    // identifiant — on ne lui invente pas un nom qu'on n'a pas.
    profiles.push({
      id: dir,
      name: '',
      order: orphanOrder++,
      isDefault: false,
      createdAt: new Date(0).toISOString(),
      orphan: true,
    });
  }

  // ── (C) le contenu ──
  const items: PublishItem[] = [];
  for (const profile of profiles) {
    const dir = path.join(profilesDir, profile.id);
    const ring: KeyRing = {
      machine: await StorageService.readProfileMachineKey(dir),
      active: params.activeFek,
      incoming: params.incomingFek,
    };

    // `notes.enc` — un par profil sur le bureau (contrairement au mobile, dont
    // les tranches Redux ne sont pas cloisonnées). Chaque profil publie donc
    // SES notes, et il ne peut y en avoir qu'une par profil cible : aucune
    // duplication destinée à diverger n'est possible ici.
    const notesPath = path.join(dir, 'notes.enc');
    const notesStat = await fs.stat(notesPath).catch(() => null);
    if (notesStat?.isFile()) {
      items.push({
        key: 'meta:notes',
        kind: 'notes-bundle',
        localProfileId: profile.id,
        localPath: 'notes.enc',
        size: notesStat.size,
        updatedAt: notesStat.mtime.toISOString(),
        keyClass: 'machine',
      });
    }

    // `layout.enc` — LE MÊME TRAITEMENT QUE `notes.enc`, et pour les mêmes
    // raisons : un conteneur unique par profil, à la racine du répertoire de
    // profil, scellé sous la CLÉ MACHINE (voir `sync/layoutStore.ts`), donc
    // `keyClass: 'machine'` — il survit intact à la bascule et ses octets
    // partent tels quels (`itemTransfer` cas 1).
    //
    // SANS CETTE ENTRÉE, PUBLIER SON COFFRE PERDAIT SA MISE EN PAGE : le
    // manifeste du profil CIBLE est reconstruit d'après ce seul inventaire
    // (`pushTargetManifests`), donc une mise en page absente d'ici n'existe
    // plus pour le compte — l'accueil modulaire repartait de zéro sur tous les
    // autres appareils.
    //
    // `key` et `localPath` reprennent MOT POUR MOT `LAYOUT_META_FILE_ID` et
    // `LAYOUT_BLOB_FILENAME` (`sync/layoutMergeCore.ts`), écrits en toutes
    // lettres comme `meta:notes` juste au-dessus : c'est l'identifiant sous
    // lequel le cycle ordinaire reconnaîtra l'entrée après la migration, et il
    // ne doit pas dépendre d'un import pour rester exact.
    //
    // `kind: 'notes-bundle'` faute d'un genre à soi : les trois genres sont
    // figés (`PublishItemKind`) et hors périmètre. Le choix est SANS effet de
    // bord — aucun consommateur ne dérive de chemin ni de destination du genre
    // (le transfert suit `localPath`/`key`/`keyClass`), le plan le classe
    // simplement avant les blobs, et la preuve ne rogne jamais un non-`blob`
    // (`verifyPlan`), ce qui est exactement le traitement voulu ici.
    const layoutPath = path.join(dir, 'layout.enc');
    const layoutStat = await fs.stat(layoutPath).catch(() => null);
    if (layoutStat?.isFile()) {
      items.push({
        key: 'meta:layout',
        kind: 'notes-bundle',
        localProfileId: profile.id,
        localPath: 'layout.enc',
        size: layoutStat.size,
        updatedAt: layoutStat.mtime.toISOString(),
        keyClass: 'machine',
      });
    }

    let folderDirs: string[] = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      folderDirs = entries
        .filter((e) => e.isDirectory() && !isExcludedDir(e.name))
        .map((e) => e.name);
    } catch {
      continue; // Profil déclaré sans répertoire : VIDE, il ne bloque rien.
    }

    for (const folderId of folderDirs) {
      const folderPath = path.join(dir, folderId);

      const metaPath = path.join(folderPath, 'metadata.json');
      const metaStat = await fs.stat(metaPath).catch(() => null);
      if (metaStat?.isFile()) {
        items.push({
          key: `meta:${folderId}`,
          kind: 'folder-meta',
          localProfileId: profile.id,
          localPath: `${folderId}/metadata.json`,
          size: metaStat.size,
          updatedAt: metaStat.mtime.toISOString(),
          // Conteneur `v2:` sous la clé MACHINE : il survit intact à la bascule.
          keyClass: 'machine',
          folderId,
        });
      }

      let fileNames: string[] = [];
      try {
        fileNames = await fs.readdir(folderPath);
      } catch {
        continue;
      }

      for (const fileName of fileNames) {
        if (isExcludedFile(fileName)) continue;
        const filePath = path.join(folderPath, fileName);
        const stat = await fs.stat(filePath).catch(() => null);
        if (!stat?.isFile()) continue;
        const localPath = `${folderId}/${fileName}`;
        items.push({
          key: blobItemKey(localPath),
          kind: 'blob',
          localProfileId: profile.id,
          localPath,
          size: stat.size,
          updatedAt: stat.mtime.toISOString(),
          keyClass: await classifyBlob(filePath, ring),
          folderId,
        });
      }
    }

    if (ring.machine) ring.machine.fill(0);
  }

  return { profiles, items };
}

/**
 * Compte les éléments scellés sur cet appareil — l'entrée `localContentCount`
 * de la garde d'adoption. Compté sur le DISQUE : c'est ce qui deviendrait
 * illisible, et un index applicatif peut mentir là où le disque ne le peut pas.
 */
export async function countLocalSealedItems(): Promise<number> {
  const { items } = await scanAllProfiles({ activeFek: null, incomingFek: null });
  return items.filter((it) => it.kind === 'blob').length;
}
