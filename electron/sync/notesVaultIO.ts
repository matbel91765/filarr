/**
 * ADAPTATEUR DISQUE DU COFFRE DE NOTES — la seule partie de la v2 qui touche
 * `fs` et la crypto.
 *
 * Tout le raisonnement vit au-dessus (`notesVaultStore`, `notesStoreV2`), et il
 * est éprouvé sur un disque en mémoire. Ici, il n'y a que de la plomberie —
 * délibérément, pour que ce fichier n'ait presque rien à prouver.
 *
 * TROIS RÈGLES QUE CETTE PLOMBERIE DOIT TENIR :
 *
 * 1. UNE LECTURE NE JETTE JAMAIS. Fichier absent, vide, illisible, chiffré avec
 *    une autre clé : tout rend `null`. La couche du dessus sait quoi faire d'une
 *    absence (`missing`, refus d'écrire) ; elle ne saurait pas quoi faire d'une
 *    exception surgie au milieu du chargement de trois cents notes.
 * 2. UNE ÉCRITURE EST ATOMIQUE AU NIVEAU DU FICHIER. `encryptToFile` écrit dans
 *    un temporaire puis renomme — c'est ce qui rend l'ordre « notes d'abord,
 *    index ensuite » suffisant pour tenir lieu d'atomicité globale.
 * 3. AUCUN CHEMIN NE SORT DU PROFIL. Les chemins arrivent d'un index qui peut
 *    venir du nuage, donc d'une DONNÉE. On les résout et on vérifie qu'ils
 *    restent sous `baseDir` — une entrée bricolée ne doit pas pouvoir écrire
 *    ailleurs sur la machine.
 */

import { promises as fs } from 'fs';
import path from 'path';
import log from 'electron-log';

import StorageService from '../storageService';
import {
  isMachineV3WriteEnabled,
  machineMarkerOf,
  machineWriteVersion,
  MACHINE_MARKER_V3,
  type MachineContainerVersion,
} from '../machineContainerV3';
import { BLOBS_DIR } from './noteBlobs';
import { readBounded } from './notesVaultStore';
import { NOTES_DIR } from './notesStoreV2';
import type { VaultIO } from './notesVaultStore';

/**
 * Résout un chemin relatif SOUS `baseDir`, ou rend `null` s'il s'en échappe.
 *
 * `path.resolve` normalise `..`, et la comparaison porte sur le résultat : c'est
 * la seule vérification qui résiste à `..%2f`, aux séparateurs mélangés et aux
 * chemins absolus glissés dans une entrée d'index.
 */
export function safeJoin(baseDir: string, relPath: string): string | null {
  const resolved = path.resolve(baseDir, relPath);
  const root = path.resolve(baseDir);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

/**
 * Fabrique les entrées/sorties du coffre pour un dossier de profil.
 *
 * `StorageService` est un singleton dont la clé suit le profil actif ; on ne la
 * capture pas ici, on l'appelle à chaque fois. Un changement de profil au milieu
 * d'un chargement doit échouer proprement, pas déchiffrer avec l'ancienne clé.
 */
/**
 * Version de conteneur pour un chemin du coffre. Le périmètre `notes` du drapeau
 * FILARR_MACHINE_CONTAINER_V3 ne couvre que ce qui vit sous `notes/` — objets,
 * index, images. `notes.enc` (le pont v1, à la racine) suit le périmètre `all` :
 * il est lu par le mobile à l'appairage et par les anciens bureaux, et son
 * identité taille:mtime sert au pont.
 */
export function vaultWriteVersion(relPath: string): MachineContainerVersion {
  const normalise = relPath.replace(/\\/g, '/');
  const sousNotes = normalise === NOTES_DIR || normalise.startsWith(`${NOTES_DIR}/`);
  return machineWriteVersion(sousNotes ? 'notes' : 'all');
}

/** Fichiers réécrits de front pendant la migration — chacun coûte 265 ms de PBKDF2 à relire. */
const UPGRADE_CONCURRENCY = 4;

export interface UpgradeDeps {
  /** Les trois premiers caractères du fichier — le marqueur, sans rien déchiffrer. */
  readHead: (fullPath: string) => Promise<string>;
  /** Identité `taille:mtime`, ou `null` si absent. */
  stat: (fullPath: string) => Promise<string | null>;
  readFile: (fullPath: string) => Promise<string>;
  decrypt: (container: string) => Promise<unknown>;
  encryptToFile: (plain: unknown, fullPath: string) => Promise<void>;
  /** Noms des entrées d'un dossier ; `[]` s'il n'existe pas. */
  list: (fullDir: string) => Promise<string[]>;
  enabled: () => boolean;
}

export interface UpgradeResult {
  upgraded: number;
  skipped: number;
  failed: number;
}

function realUpgradeDeps(): UpgradeDeps {
  return {
    readHead: async (full) => {
      const handle = await fs.open(full, 'r');
      try {
        const buf = Buffer.alloc(3);
        const { bytesRead } = await handle.read(buf, 0, 3, 0);
        return buf.subarray(0, bytesRead).toString('utf8');
      } finally {
        await handle.close();
      }
    },
    stat: async (full) => {
      try {
        const st = await fs.stat(full);
        return `${st.size}:${st.mtimeMs}`;
      } catch {
        return null;
      }
    },
    readFile: (full) => fs.readFile(full, 'utf-8'),
    decrypt: (container) => StorageService.decrypt(container),
    encryptToFile: (plain, full) => StorageService.encryptToFile(plain, full, { version: 'v3' }),
    list: async (full) => {
      try {
        return await fs.readdir(full);
      } catch {
        return [];
      }
    },
    enabled: () => isMachineV3WriteEnabled('notes'),
  };
}

/**
 * MIGRATION LOCALE `v2:` → `v3:` DU COFFRE DE NOTES.
 *
 * Sans elle, la vitesse du nouveau conteneur n'arriverait qu'aux notes
 * modifiées : les autres resteraient en `v2:`, à 265 ms chacune, à chaque
 * démarrage. La passe relit une fois chaque objet, index et image encore en
 * `v2:` (le prix PBKDF2 payé une dernière fois, 4 de front) et le réécrit en
 * `v3:` — écrit-puis-renomme, jamais en place.
 *
 * Ce qu'elle ne fait JAMAIS :
 *  - toucher `notes.enc` à la racine : elle ne liste que `notes/` et
 *    `notes/blobs/`, et l'identité taille:mtime du pont v1 reste intacte ;
 *  - rétrograder un `v3:` (voir machineContainerNeedsRewrite) ;
 *  - écrire par-dessus un fichier qui a bougé entre sa lecture et sa réécriture
 *    (cycle de synchronisation, sauvegarde) : l'identité est relevée avant et
 *    après le déchiffrement, et le fichier est laissé tel quel si elle diffère.
 *
 * L'appelant la passe sous le verrou des notes (`withNotesLock`, main.ts), ce qui
 * écarte les sauvegardes du rendu ; le relevé d'identité couvre le cycle.
 */
export async function upgradeNotesVaultContainers(
  baseDir: string,
  deps: UpgradeDeps = realUpgradeDeps()
): Promise<UpgradeResult> {
  const out: UpgradeResult = { upgraded: 0, skipped: 0, failed: 0 };
  if (!deps.enabled()) return out;

  const fichiers: string[] = [];
  for (const rel of [NOTES_DIR, `${NOTES_DIR}/${BLOBS_DIR}`]) {
    const full = safeJoin(baseDir, rel);
    if (!full) continue;
    for (const nom of await deps.list(full)) {
      if (nom.endsWith('.enc')) fichiers.push(path.join(full, nom));
    }
  }

  await readBounded(fichiers, UPGRADE_CONCURRENCY, async (full) => {
    try {
      const head = await deps.readHead(full);
      // Deja v3 : rien a faire. Tout le reste (v2, v1, sans marqueur) monte —
      // le drapeau a deja ete consulte par `enabled`, on ne le relit pas ici.
      if (machineMarkerOf(head) === MACHINE_MARKER_V3) {
        out.skipped++;
        return;
      }
      const avant = await deps.stat(full);
      const plain = await deps.decrypt(await deps.readFile(full));
      if ((await deps.stat(full)) !== avant) {
        // Quelqu'un a écrit pendant qu'on lisait : on ne réécrit jamais du plus vieux.
        out.skipped++;
        return;
      }
      await deps.encryptToFile(plain, full);
      out.upgraded++;
    } catch (err) {
      out.failed++;
      log.warn(`[notesVaultIO] migration v3 : ${path.basename(full)} laissé tel quel — ${(err as Error).message}`);
    }
  });

  if (out.upgraded > 0 || out.failed > 0) {
    log.info(
      `[notesVaultIO] coffre de notes : ${out.upgraded} fichier(s) réécrit(s) en v3, ` +
        `${out.skipped} déjà à jour, ${out.failed} en échec`
    );
  }
  return out;
}

export function createVaultIO(baseDir: string): VaultIO {
  return {
    async read(relPath: string): Promise<unknown | null> {
      const full = safeJoin(baseDir, relPath);
      if (!full) {
        log.warn(`[notesVaultIO] chemin refusé (hors profil) : ${relPath}`);
        return null;
      }
      try {
        const container = await fs.readFile(full, 'utf-8');
        if (!container || container.trim().length === 0) return null;
        return await StorageService.decrypt(container);
      } catch {
        // Absent, vide, illisible, ou chiffré avec une autre clé : dans tous les
        // cas la réponse honnête est « je n'ai pas ça », pas une exception.
        return null;
      }
    },

    async write(relPath: string, plain: unknown): Promise<void> {
      const full = safeJoin(baseDir, relPath);
      if (!full) throw new Error(`notesVaultIO: chemin refusé (hors profil) : ${relPath}`);
      await fs.mkdir(path.dirname(full), { recursive: true });
      // Écrit-puis-renomme : voir la règle 2 en tête de fichier. La version du
      // conteneur dépend du périmètre du drapeau — voir `vaultWriteVersion`.
      await StorageService.encryptToFile(plain, full, { version: vaultWriteVersion(relPath) });
    },

    async remove(relPath: string): Promise<void> {
      const full = safeJoin(baseDir, relPath);
      if (!full) return;
      await fs.unlink(full).catch(() => {
        /* déjà absent : c'est le résultat voulu */
      });
    },

    async stat(relPath: string): Promise<string | null> {
      const full = safeJoin(baseDir, relPath);
      if (!full) return null;
      try {
        const st = await fs.stat(full);
        // Taille + date de modification : assez pour dire « ca a bouge »,
        // sans jamais dechiffrer. C'est tout ce qu'on demande ici.
        return `${st.size}:${st.mtimeMs}`;
      } catch {
        return null;
      }
    },

    async list(relDir: string): Promise<string[]> {
      const full = safeJoin(baseDir, relDir);
      if (!full) return [];
      try {
        return await fs.readdir(full);
      } catch {
        return [];
      }
    },
  };
}

/** Chemin absolu du dossier des objets de note, pour les journaux et le ménage. */
export function notesDirOf(baseDir: string): string {
  return path.join(baseDir, NOTES_DIR);
}
