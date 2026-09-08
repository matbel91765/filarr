/**
 * Mise en page modulaire côté WEB — les deux canaux `layout:load` / `layout:save`,
 * MÊME CONTRAT que les handlers ipcMain du bureau (electron/main.ts, section
 * « Layout IPC Handlers ») pour que l'accueil modulaire fonctionne tel quel sur
 * app.filarr.com : aucun `if (isElectron)` de plus dans le renderer.
 *
 * ── CE QUI CHANGE PAR RAPPORT AU BUREAU, ET CE QUI NE CHANGE PAS ────────────
 * Ne change pas : le MODÈLE (document, vues, gabarits), la RÈGLE DE FUSION
 * (`sync/layoutMerge.ts`, copie parité-testée du moteur du bureau), l'AMORÇAGE
 * (même document produit pour les mêmes préférences, mêmes identifiants
 * déterministes, même horloge d'époque), et le CONTRAT DE RETOUR
 * (`{ document, seeded, created }`).
 *
 * Change : le support. Le bureau scelle `layout.enc` sous la clé machine du
 * profil ; le navigateur dépose le document dans le store cloisonné du profil
 * (voir `LAYOUT_KEY` dans `sync/readSync.ts` pour pourquoi en clair, et pourquoi
 * cela n'entame pas la promesse E2EE de ce qui voyage).
 *
 * ── POURQUOI CE FICHIER N'EST PAS ENREGISTRÉ LUI-MÊME ───────────────────────
 * Ses deux canaux sont repris par `webStorageHandlers` (qui porte déjà
 * `notes:load`/`notes:save`, la même famille) : le dispatcher n'a pas à changer
 * pour accueillir une ressource de plus de la même nature.
 */

import { getActiveProfileId } from '../webStore';
import { LAYOUT_FILE_MAX_BYTES } from '../../../services/layouts/layoutFormat';
import {
  cloudCarriesLayout,
  markLayoutPending,
  readLocalLayout,
  withLayoutLock,
  writeLocalLayout,
} from '../sync/readSync';
import {
  createEmptyLayoutDocument,
  normalizeLayoutDocument,
  LAYOUT_SEED_CLOCK,
  type LayoutDocument,
  type LayoutSlot,
} from '../sync/layoutMerge';

/**
 * Préférences DÉJÀ EXPRIMÉES par l'utilisateur, relevées par le renderer et
 * passées telles quelles — miroir exact de `LayoutSeedHints`
 * (electron/sync/layoutStore.ts). Elles sont LUES, jamais effacées : les anciens
 * écrans continuent de s'en servir tant que l'interface modulaire ne les a pas
 * remplacés.
 */
export interface LayoutSeedHints {
  homeRecentNotes?: boolean;
  dashboardCollapsed?: boolean;
  display?: {
    compactMode?: boolean;
    gridSize?: 'small' | 'medium' | 'large';
    defaultViewMode?: string;
  };
}

export interface LayoutLoadResult {
  document: LayoutDocument;
  /**
   * `false` = rien n'a encore été amorcé pour ce profil (le nuage porte une mise
   * en page qui n'est pas descendue, ou il n'y a pas de profil actif). Le
   * document rendu est vide et PROVISOIRE : ne rien écrire par-dessus.
   */
  seeded: boolean;
  /** Le document vient d'être CRÉÉ par cet appel (donc il faut le remonter). */
  created: boolean;
}

/**
 * Identifiants d'emplacement de l'amorçage : DÉTERMINISTES, pas des uuid — copie
 * conforme du bureau. Deux appareils qui amorcent le même accueil produisent
 * alors le MÊME document, et la fusion les reconnaît comme une seule et même
 * chose au lieu d'empiler deux jeux de blocs identiques.
 */
const seedSlotId = (key: string): string => `seed:${key}`;

/**
 * Les quatre chiffres de la rangée de tête, dans l'ordre où on les lit — copie
 * conforme du bureau. Un seul widget à réglage `metric` plutôt que quatre
 * composants : c'est ce qui garantit une seule typographie pour les quatre
 * valeurs.
 */
const SEED_METRICS = ['files', 'folders', 'storage', 'notes'] as const;

/**
 * Construit le document initial d'un profil à partir de ses préférences —
 * DUPLICATION DÉLIBÉRÉE de `seedLayoutDocument` (electron/sync/layoutStore.ts),
 * qui vit dans un module à accès disque que le navigateur ne peut pas charger.
 *
 * Elle doit rester conforme AU BIT PRÈS, pour une raison précise : deux
 * amorçages divergents (bureau ici, onglet là) ne seraient plus reconnus comme
 * le même geste, la fusion y verrait deux dispositions concurrentes et
 * archiverait la perdante — un accueil « qui change tout seul » au premier
 * cycle, sur un profil que personne n'a encore touché.
 *
 * ⚠ TOUTES les vues amorcées portent `LAYOUT_SEED_CLOCK` (l'époque) et NON
 * l'heure de l'amorçage : un amorçage ne doit jamais pouvoir gagner contre une
 * disposition réelle construite ailleurs. `seededAt` porte l'heure vraie —
 * c'est la marque, pas une horloge d'arbitrage.
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

/** Le document a-t-il DÉJÀ été amorcé ? La marque vit dans le document. */
export function isSeeded(doc: LayoutDocument | null): boolean {
  return !!doc && typeof doc.seededAt === 'string' && doc.seededAt !== '';
}

/** Le document vide et PROVISOIRE — jamais écrit, seulement rendu. */
const provisional = (): LayoutLoadResult => ({
  document: createEmptyLayoutDocument(),
  seeded: false,
  created: false,
});

// ── Le disque, côté navigateur : types et utilitaires ───────────────────────

/** Le contrat rendu au renderer — miroir de ce qu'attend `layoutFileIo.ts`. */
interface LayoutExportResult {
  success: boolean;
  canceled?: boolean;
  /** Sur le web, le NOM retenu : un onglet n'a pas de chemin à rendre. */
  path?: string;
  error?: string;
}

interface LayoutImportResult {
  success: boolean;
  canceled?: boolean;
  content?: string;
  fileName?: string;
  error?: string;
}

/**
 * L'API File System Access, décrite au strict nécessaire.
 *
 * Elle n'est pas dans les types DOM de ce projet et n'existe que sur Chromium :
 * la déclarer ici, minimale, vaut mieux qu'un `any` — le compilateur vérifie au
 * moins qu'on l'appelle comme on l'a comprise.
 */
type SaveFilePicker = (options: {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{
  name?: string;
  createWritable: () => Promise<{
    write: (data: string) => Promise<void>;
    close: () => Promise<void>;
  }>;
}>;

type OpenFilePicker = (options: {
  multiple?: boolean;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ getFile: () => Promise<File> }[]>;

/** La personne a fermé le sélecteur — jamais une panne. */
function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/**
 * Le téléchargement navigateur — même motif que `webFileHandlers.downloadItem`.
 *
 * L'URL d'objet est révoquée en différé : la révoquer tout de suite couperait
 * le téléchargement que le clic vient à peine de lancer.
 */
function triggerDownload(content: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Le repli d'ouverture : un `<input type="file">` invisible.
 *
 * ⚠ L'ANNULATION SE DÉTECTE PAR L'ÉVÉNEMENT `cancel`, et c'est important : sans
 * lui, fermer le sélecteur laisserait la promesse en suspens pour toujours, et
 * l'écran d'import resterait figé sur un chargement qui n'arrive jamais. Les
 * navigateurs qui n'ont pas `showOpenFilePicker` (Firefox, Safari) émettent
 * bien cet événement depuis 2023.
 */
function pickFileViaInput(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.filarrlayout,application/json';
    input.style.display = 'none';
    const done = (value: File | null): void => {
      input.remove();
      resolve(value);
    };
    input.addEventListener('change', () => done(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => done(null), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Lit le fichier choisi, en bornant la taille AVANT de le lire.
 *
 * La même borne existe côté bureau, dans le processus principal : un fichier
 * qui la dépasse n'a aucune raison d'être chargé en mémoire pour être refusé
 * ensuite par le validateur.
 */
async function readChosenFile(file: File): Promise<LayoutImportResult> {
  if (file.size > LAYOUT_FILE_MAX_BYTES) {
    return { success: false, error: 'too-large' };
  }
  const content = await file.text();
  // La taille en octets d'un `File` est déjà celle du disque : on ne remesure
  // pas la chaîne, on se contente de rendre ce qu'on a lu.
  return { success: true, content, fileName: file.name };
}

export const layoutHandlers: Record<string, (...args: unknown[]) => unknown> = {
  /**
   * Lit — et amorce au premier appel d'un profil — le document de mise en page.
   *
   * Toute la séquence lire → décider → écrire tient sous le verrou de la mise en
   * page : la fusion d'un cycle qui s'y intercalerait serait écrasée par
   * l'amorçage (et l'amorçage annulé par la fusion).
   */
  'layout:load': async (hintsArg: unknown): Promise<LayoutLoadResult> => {
    try {
      const profileId = await getActiveProfileId();
      if (!profileId) return provisional();
      const hints = (hintsArg ?? {}) as LayoutSeedHints;

      const result = await withLayoutLock(async (): Promise<LayoutLoadResult> => {
        const existing = await readLocalLayout(profileId);
        if (existing) return { document: existing, seeded: isSeeded(existing), created: false };

        // GARDE ANTI-DOUBLE-AMORÇAGE : si le nuage porte déjà une mise en page,
        // on n'en fabrique pas une seconde — on attend la descente. Le renderer
        // comprend `seeded: false` comme « provisoire, ne rien écrire ».
        if (await cloudCarriesLayout(profileId)) {
          console.info('[layout:load][web] amorçage retenu : le nuage porte déjà une mise en page');
          return provisional();
        }

        const seeded = seedLayoutDocument(hints, new Date().toISOString());
        const written = await writeLocalLayout(profileId, seeded);
        return { document: written, seeded: true, created: true };
      });

      // Prévenir la sync UNIQUEMENT quand l'amorçage vient de créer le document :
      // marquer une remontée à chaque lecture rouvrirait un cycle pour rien.
      if (result.created) await markLayoutPending(profileId);
      return result;
    } catch (err) {
      console.error('[layout:load][web] échec :', err);
      // `seeded: false` fait comprendre au renderer que le document rendu est
      // PROVISOIRE : il ne le réécrira pas par-dessus ce qui existe.
      return provisional();
    }
  },

  /** Dépose le document courant et marque la remontée. */
  'layout:save': async (document: unknown): Promise<boolean> => {
    try {
      const profileId = await getActiveProfileId();
      if (!profileId) return false;
      await withLayoutLock(() => writeLocalLayout(profileId, normalizeLayoutDocument(document)));
      await markLayoutPending(profileId);
      return true;
    } catch (err) {
      console.error('[layout:save][web] échec :', err);
      return false;
    }
  },

  // ── Le passage par le disque, version navigateur ──────────────────────────
  //
  // Ces deux canaux étaient classés portables (palier M2) depuis le début et
  // n'avaient jamais été écrits. Le symptôme n'était PAS une absence : le shim
  // web levait, `safeInvoke` absorbait, et l'écran d'export affichait « le
  // fichier n'a pas pu être écrit » — un message qui accuse le disque alors
  // qu'il n'y avait simplement aucun dialogue de fichier.
  //
  // ⚠ AUCUNE RÈGLE MÉTIER ICI, exactement comme côté bureau : on ouvre un
  // sélecteur, on borne la taille, on rend une CHAÎNE. Toute la lecture d'un
  // `.filarrlayout` reste dans `layoutValidator.ts`. Deux analyseurs pour un
  // format qui circule, ce serait deux jeux de règles qui divergent — et c'est
  // toujours le plus permissif qui décide.

  /**
   * Écrit le fichier. Deux chemins, et le premier est nettement meilleur.
   *
   * `showSaveFilePicker` (Chromium) donne un VRAI « Enregistrer sous » : la
   * personne choisit l'endroit et le nom, et une annulation est une annulation.
   * Le repli `<a download>` (Firefox, Safari) dépose dans les téléchargements
   * sans rien demander — on ne peut alors ni proposer un dossier, ni distinguer
   * un abandon d'un succès, et c'est pourquoi il n'est que le repli.
   */
  'layouts:exportFile': async (arg: unknown): Promise<LayoutExportResult> => {
    const { content, suggestedName } = (arg ?? {}) as {
      content?: unknown;
      suggestedName?: unknown;
    };
    if (typeof content !== 'string' || content === '') {
      return { success: false, error: 'bad-request' };
    }
    const name =
      typeof suggestedName === 'string' && suggestedName !== ''
        ? suggestedName
        : 'mise-en-page.filarrlayout';

    const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker })
      .showSaveFilePicker;
    if (typeof picker === 'function') {
      try {
        const handle = await picker({
          suggestedName: name,
          types: [
            {
              description: 'Filarr layout',
              accept: { 'application/json': ['.filarrlayout'] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        return { success: true, path: handle.name ?? name };
      } catch (err) {
        // `AbortError` = la personne a fermé le sélecteur. Ce n'est pas une
        // panne, et l'annoncer comme telle ferait chercher un problème qui
        // n'existe pas.
        if (isAbort(err)) return { success: false, canceled: true };
        // Activation utilisateur perdue, contexte non sécurisé, permission
        // refusée : on retombe sur le téléchargement plutôt que d'échouer.
        console.warn('[layouts:exportFile][web] sélecteur indisponible, repli téléchargement', err);
      }
    }

    try {
      triggerDownload(content, name);
      return { success: true, path: name };
    } catch (err) {
      console.error('[layouts:exportFile][web] échec :', err);
      return { success: false, error: 'write-failed' };
    }
  },

  /**
   * Lit un fichier choisi par la personne.
   *
   * L'argument `path` du bureau est IGNORÉ : il vient du double-clic dans
   * l'explorateur, qui n'a pas d'équivalent dans un onglet. Le renderer ne le
   * passe d'ailleurs jamais sur le web (`takePendingLayoutOpen` est gaté).
   */
  'layouts:importFile': async (): Promise<LayoutImportResult> => {
    const picker = (window as unknown as { showOpenFilePicker?: OpenFilePicker })
      .showOpenFilePicker;
    if (typeof picker === 'function') {
      try {
        const [handle] = await picker({
          multiple: false,
          types: [
            {
              description: 'Filarr layout',
              accept: { 'application/json': ['.filarrlayout'] },
            },
          ],
        });
        if (!handle) return { success: false, canceled: true };
        return await readChosenFile(await handle.getFile());
      } catch (err) {
        if (isAbort(err)) return { success: false, canceled: true };
        console.warn('[layouts:importFile][web] sélecteur indisponible, repli input', err);
      }
    }

    try {
      const file = await pickFileViaInput();
      if (!file) return { success: false, canceled: true };
      return await readChosenFile(file);
    } catch (err) {
      console.error('[layouts:importFile][web] échec :', err);
      return { success: false, error: 'read-failed' };
    }
  },
};
