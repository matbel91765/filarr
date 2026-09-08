/**
 * Conteneur de MISE EN PAGE sur le disque — lecture, scellement, amorçage.
 *
 * ── OÙ, ET POURQUOI LÀ ──────────────────────────────────────────────────────
 * `<userData>/FilarData/profiles/{profileId}/layout.enc`, à côté de `notes.enc`.
 * Le fichier est donc ISOLÉ PAR PROFIL par construction (rien à filtrer, rien à
 * préfixer) et il disparaît avec le profil quand celui-ci est supprimé — c'est
 * le même répertoire qui part.
 *
 * ── SOUS QUELLE CLÉ, ET POURQUOI PAS LA FEK ─────────────────────────────────
 * Sous la CLÉ MACHINE du profil (`StorageService`), celle qui scelle déjà
 * `notes.enc` et les `metadata.json`. PAS directement la FEK, et la raison est
 * dirimante : `encryptWithFEK` jette « FEK not available — vault not unlocked »,
 * et un profil purement LOCAL n'a JAMAIS de FEK. Or la mise en page doit
 * fonctionner hors ligne et hors compte : c'est le squelette de l'écran, il ne
 * peut pas dépendre d'un déverrouillage réseau.
 *
 * LA PROMESSE E2EE RESTE TENUE. Le blob voyage comme n'importe quel objet de
 * sync : le manifeste qui le décrit est chiffré avec la FEK avant de partir, et
 * l'objet lui-même est un AES-GCM que ni le worker ni R2 ne peuvent ouvrir. Les
 * autres appareils le lisent parce que la clé machine du profil voyage déjà dans
 * le manifeste chiffré (`SyncManifest.encryptionKey`) — exactement le mécanisme
 * qui rend `notes.enc` et `metadata.json` lisibles d'un appareil à l'autre.
 *
 * ── CE QUE CE MODULE NE FAIT PAS ────────────────────────────────────────────
 * Aucun réseau, aucune connaissance du manifeste. La descente (fusion) vit dans
 * `syncService.downloadAndMergeLayout`, qui appelle ces primitives sous le même
 * verrou que l'écriture venue du renderer.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import log from 'electron-log';
import StorageService from '../storageService';
import {
  LAYOUT_BLOB_FILENAME,
  LAYOUT_SEED_CLOCK,
  createEmptyLayoutDocument,
  normalizeLayoutDocument,
  pruneDocumentSuperseded,
  type LayoutDocument,
  type LayoutSlot,
} from './layoutMergeCore';

// ── Verrou ──────────────────────────────────────────────────────────────────

/**
 * Verrou d'exclusion du BLOB DE MISE EN PAGE — une seule chaîne de promesses
 * partagée par tout ce qui fait lire-modifier-écrire dessus : la fusion du cycle
 * de sync (`downloadAndMergeLayout`) et l'écriture du renderer (`layout:save`).
 *
 * Même raisonnement que `notesLock` : les deux chemins passent par
 * `StorageService.encryptToFile`, dont le temporaire est voisin du fichier
 * final, et la fusion garde plusieurs `await` entre sa lecture et son écriture.
 * Ne JAMAIS imbriquer un `withLayoutLock` dans un autre : la file est
 * strictement séquentielle.
 */
let chain: Promise<unknown> = Promise.resolve();

export function withLayoutLock<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

// ── Chemins et erreurs ──────────────────────────────────────────────────────

export function layoutFilePath(baseDir: string): string {
  return path.join(baseDir, LAYOUT_BLOB_FILENAME);
}

/**
 * La clé machine n'est pas disponible (coffre verrouillé, safeStorage pas
 * prêt). CE N'EST PAS UNE CORRUPTION : le fichier est probablement sain, et
 * l'appelant doit s'abstenir d'écrire plutôt que de repartir de zéro.
 */
export class LayoutKeyUnavailableError extends Error {}

/** Le conteneur est là mais illisible : ciphertext abîmé, JSON tronqué. */
export class LayoutUnreadableError extends Error {}

/**
 * `baseDir` est-il bien le répertoire dont StorageService tient la clé ?
 *
 * Comparaison insensible à la casse sur Windows (les deux chemins viennent de
 * `app.getPath` + `profileManager`, donc identiques en pratique — mais un écart
 * de casse ferait ici un faux négatif, c'est-à-dire une mise en page qui ne se
 * charge jamais). `getBaseDir()` jette tant que le service n'est pas
 * initialisé : dans ce cas, on ne prétend rien.
 */
function isCurrentCryptoContext(baseDir: string): boolean {
  let current: string;
  try {
    current = StorageService.getBaseDir();
  } catch {
    return false;
  }
  const a = path.resolve(current);
  const b = path.resolve(baseDir);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Miroir de `syncService.isKeyUnavailableError` — voir son commentaire. */
function isKeyUnavailableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes('not initialized') ||
    message.includes('encryption key') ||
    message.includes('safeStorage')
  );
}

// ── Lecture / écriture ──────────────────────────────────────────────────────

/**
 * Lit le conteneur du profil. `null` = le fichier N'EXISTE PAS (c'est le seul
 * cas où l'amorçage est envisageable). Une clé indisponible ou un conteneur
 * illisible JETTENT : confondre « absent » et « illisible » ferait ré-amorcer
 * par-dessus une mise en page bien réelle.
 */
export async function readLayoutDocument(baseDir: string): Promise<LayoutDocument | null> {
  const filePath = layoutFilePath(baseDir);
  let container: string;
  try {
    container = await fs.readFile(filePath, 'utf-8');
  } catch {
    return null; // pas encore de mise en page sur cet appareil
  }
  if (container.trim() === '') return null;
  try {
    return normalizeLayoutDocument(await StorageService.decrypt(container));
  } catch (err) {
    if (isKeyUnavailableError(err)) {
      throw new LayoutKeyUnavailableError((err as Error).message);
    }
    throw new LayoutUnreadableError((err as Error).message);
  }
}

/**
 * Scelle le document. `encryptToFile` écrit un temporaire UNIQUE puis renomme :
 * jamais de `layout.enc` tronqué, même si le processus meurt en cours d'écriture.
 *
 * La purge des dispositions perdantes expirées se fait ICI plutôt qu'à la
 * lecture : une purge en lecture réécrirait le fichier à chaque démarrage et
 * rouvrirait un cycle de sync pour rien.
 */
export async function writeLayoutDocument(
  baseDir: string,
  document: LayoutDocument,
  now: { iso: string; ms: number } = { iso: new Date().toISOString(), ms: Date.now() }
): Promise<LayoutDocument> {
  // Même garde qu'à la lecture, et pour une raison plus grave encore : sceller
  // sous la clé d'un AUTRE profil produirait un `layout.enc` que le profil
  // propriétaire ne saurait plus ouvrir — et que la sync remonterait tel quel.
  if (!isCurrentCryptoContext(baseDir)) {
    throw new LayoutKeyUnavailableError(
      'Contexte de clé ≠ profil demandé — écriture de la mise en page refusée'
    );
  }
  const doc = normalizeLayoutDocument(document);
  pruneDocumentSuperseded(doc, now.ms);
  doc.updatedAt = now.iso;
  await fs.mkdir(baseDir, { recursive: true });
  await StorageService.encryptToFile(doc, layoutFilePath(baseDir));
  return doc;
}

// ── Amorçage ────────────────────────────────────────────────────────────────

/**
 * Préférences DÉJÀ EXPRIMÉES par l'utilisateur, relevées par le renderer et
 * passées telles quelles. Le processus principal ne va JAMAIS les chercher
 * lui-même : elles vivent dans le `localStorage` du renderer (préfixé par
 * profil) et dans le store persisté, deux endroits qu'il ne sait pas lire.
 *
 * Et il ne les EFFACE jamais non plus : l'amorçage les LIT. Les anciens
 * réglages continuent de piloter les anciens écrans tant que l'interface
 * modulaire ne les a pas remplacés — un utilisateur qui reviendrait en arrière
 * doit retrouver son accueil intact.
 */
export interface LayoutSeedHints {
  /** `state.ui.homeRecentNotes` — widget « Notes récentes » de l'accueil. */
  homeRecentNotes?: boolean;
  /** `localStorage['filarr-dashboard-collapsed']` — bandeau de statistiques replié. */
  dashboardCollapsed?: boolean;
  /** `state.settings.display` — ce qui a un sens pour une grille de dossiers. */
  display?: {
    compactMode?: boolean;
    gridSize?: 'small' | 'medium' | 'large';
    defaultViewMode?: string;
  };
}

/**
 * Identifiants d'emplacement de l'amorçage : DÉTERMINISTES, pas des uuid.
 * Deux appareils qui amorcent le même accueil produisent alors le MÊME document
 * — la fusion les reconnaît comme une seule et même chose au lieu d'empiler
 * deux jeux de blocs identiques.
 */
const seedSlotId = (key: string): string => `seed:${key}`;

/**
 * Les quatre chiffres de la rangée de tête, dans l'ordre où on les lit. Un seul
 * widget à réglage `metric` plutôt que quatre composants : c'est ce qui garantit
 * une seule typographie pour les quatre valeurs.
 */
const SEED_METRICS = ['files', 'folders', 'storage', 'notes'] as const;

/**
 * Construit le document initial d'un profil à partir de ses préférences.
 *
 * ⚠ TOUTES les vues amorcées portent `LAYOUT_SEED_CLOCK` (l'époque) et NON
 * l'heure de l'amorçage. Voir le commentaire de cette constante : un amorçage
 * ne doit jamais pouvoir gagner contre une disposition réelle construite
 * ailleurs. `seededAt`, lui, porte l'heure vraie — c'est la marque, pas une
 * horloge d'arbitrage.
 */
export function seedLayoutDocument(hints: LayoutSeedHints, nowIso: string): LayoutDocument {
  const doc = createEmptyLayoutDocument();
  const slots: LayoutSlot[] = [];
  let y = 0;

  // ── Rangée 1 — quatre tuiles, un chiffre chacune ─────────────────────────
  // `dashboardCollapsed` disait « je ne veux pas du bandeau de chiffres ». Le
  // bandeau n'existe plus sous cette forme, mais la préférence porte toujours :
  // c'est cette rangée qu'elle retire, et la rangée suivante remonte d'un cran.
  if (hints.dashboardCollapsed !== true) {
    SEED_METRICS.forEach((metric, index) => {
      slots.push({
        id: seedSlotId(`stat-${metric}`),
        role: 'stats',
        type: 'stat-tile',
        x: index * 3,
        y,
        w: 3,
        h: 1,
        options: { metric },
      });
    });
    y += 1;
  }

  // ── Rangée 2 — un quart, un quart, une moitié ────────────────────────────
  slots.push({ id: seedSlotId('types'), role: 'stats', type: 'type-donut', x: 0, y, w: 3, h: 2 });
  slots.push({
    id: seedSlotId('resume'),
    role: 'recents',
    type: 'resume',
    x: 3,
    y,
    w: 3,
    h: 2,
    options: { frame: 'card' },
  });
  // `homeRecentNotes` est activé SAUF refus explicite (cf. `loadHomeRecentNotes`
  // côté renderer) : on reproduit la même règle, sinon l'amorçage ferait
  // disparaître un widget que l'utilisateur voyait la veille. En cas de refus,
  // la moitié droite de la rangée reste VIDE — on ne redistribue pas la place
  // d'un bloc refusé, ce qui ferait un accueil différent de la base.
  if (hints.homeRecentNotes !== false) {
    slots.push({
      id: seedSlotId('recents'),
      role: 'notes',
      type: 'recent-notes',
      x: 6,
      y,
      w: 6,
      h: 2,
    });
  }
  y += 2;

  // ── Rangée 3 — la grille complète des dossiers, pleine largeur ───────────
  // Les trois réglages d'affichage déjà exprimés voyagent tels quels : ils ne
  // changent pas la composition, seulement la façon dont ce bloc dessine.
  slots.push({
    id: seedSlotId('folder-grid'),
    role: 'folder-grid',
    type: 'folder-grid',
    x: 0,
    y,
    w: 12,
    h: 4,
    options: {
      compact: hints.display?.compactMode === true,
      gridSize: hints.display?.gridSize ?? 'medium',
      viewMode: hints.display?.defaultViewMode ?? 'grid',
    },
  });

  doc.views.home = { id: 'home', slots, updatedAt: LAYOUT_SEED_CLOCK };
  doc.seededAt = nowIso;
  return doc;
}

/** Le document a-t-il DÉJÀ été amorcé ? La marque vit dans le conteneur. */
export function isSeeded(doc: LayoutDocument | null): boolean {
  return !!doc && typeof doc.seededAt === 'string' && doc.seededAt !== '';
}

/** Réponse de `loadOrSeedLayout` — miroir du contrat rendu par `layout:load`. */
export interface LayoutLoadResult {
  document: LayoutDocument;
  /**
   * `false` = rien n'a encore été amorcé pour ce profil (le nuage porte une
   * mise en page qui n'est pas descendue, ou la clé n'était pas disponible).
   * Le document rendu est vide et PROVISOIRE : ne rien écrire par-dessus.
   */
  seeded: boolean;
  /** `layout.enc` vient d'être CRÉÉ par cet appel (donc il faut le remonter). */
  created: boolean;
}

/**
 * Amorce le profil SI et SEULEMENT SI c'est légitime, sous le verrou.
 *
 * `cloudCarriesLayout` est la GARDE ANTI-DOUBLE-AMORÇAGE : si le nuage porte
 * déjà une entrée `meta:layout`, on n'amorce pas — on attend la descente. Sans
 * elle, un second appareil fabriquerait un document concurrent avant même
 * d'avoir vu celui qui existe.
 *
 * Rend `{ document, seeded }` : `seeded: false` avec un document vide veut dire
 * « le nuage a la réponse, elle n'est pas encore arrivée » — l'appelant
 * n'affiche rien de définitif et réessaiera après la prochaine descente.
 */
export async function loadOrSeedLayout(
  baseDir: string,
  hints: LayoutSeedHints,
  cloudCarriesLayout: boolean,
  now: { iso: string; ms: number } = { iso: new Date().toISOString(), ms: Date.now() }
): Promise<LayoutLoadResult> {
  return withLayoutLock(async () => {
    // GARDE DE CONTEXTE CRYPTOGRAPHIQUE — trouvée par une sonde en processus
    // principal réel, pas par le typage. Chaque profil a SA clé machine
    // (`encryption.key.safe`), donc lire le conteneur d'un profil pendant que
    // StorageService tient la clé d'un AUTRE profil échoue exactement comme un
    // fichier corrompu : « Unsupported state or unable to authenticate data ».
    //
    // Or `profile:activate` pose `activeProfileId` AVANT d'appeler
    // `StorageService.reinitialize` — quelques `await` pendant lesquels
    // `getActiveProfileDataDir()` désigne déjà le nouveau profil alors que la
    // clé est encore l'ancienne. Un `layout:load` tombé dans cette fenêtre
    // aurait mis la vraie mise en page de côté et ré-amorcé par-dessus.
    // On ne touche à RIEN tant que les deux ne parlent pas du même profil.
    if (!isCurrentCryptoContext(baseDir)) {
      log.warn('[layoutStore] Contexte de clé ≠ profil demandé — aucune lecture, aucune écriture');
      return { document: createEmptyLayoutDocument(), seeded: false, created: false };
    }

    let existing: LayoutDocument | null;
    try {
      existing = await readLayoutDocument(baseDir);
    } catch (err) {
      if (err instanceof LayoutKeyUnavailableError) {
        // Le fichier est probablement sain : on ne le remplace pas, on attend
        // la clé. Le prochain appel repassera ici avec le coffre déverrouillé.
        log.warn(`[layoutStore] Clé indisponible — aucune écriture: ${err.message}`);
        return { document: createEmptyLayoutDocument(), seeded: false, created: false };
      }
      // Illisible pour de bon. On amorce à neuf, mais JAMAIS avant d'avoir mis
      // l'original de côté : une copie ratée annule l'opération plutôt que de
      // détruire la seule trace d'une mise en page qu'un outil saurait sauver.
      const backup = `${layoutFilePath(baseDir)}.unreadable-${Date.now()}`;
      try {
        await fs.copyFile(layoutFilePath(baseDir), backup);
      } catch (copyErr) {
        log.error(
          `[layoutStore] layout.enc illisible (${(err as Error).message}) mais la sauvegarde ` +
            `de secours a échoué (${(copyErr as Error).message}) — aucune écriture`
        );
        return { document: createEmptyLayoutDocument(), seeded: false, created: false };
      }
      log.error(
        `[layoutStore] layout.enc illisible — copie conservée dans ${path.basename(backup)}, ré-amorçage`
      );
      existing = null;
    }
    if (existing) return { document: existing, seeded: isSeeded(existing), created: false };

    if (cloudCarriesLayout) {
      log.info('[layoutStore] Amorçage retenu : le nuage porte déjà une mise en page');
      return { document: createEmptyLayoutDocument(), seeded: false, created: false };
    }

    const seeded = seedLayoutDocument(hints, now.iso);
    const written = await writeLayoutDocument(baseDir, seeded, now);
    log.info(
      `[layoutStore] Mise en page amorcée (${written.views.home?.slots.length ?? 0} bloc(s))`
    );
    return { document: written, seeded: true, created: true };
  });
}
