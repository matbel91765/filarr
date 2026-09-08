/**
 * LE PASSAGE PAR LE DISQUE — côté renderer.
 *
 * Trois canaux, et une règle qui les tient tous : le processus principal
 * n'ANALYSE JAMAIS un `.filarrlayout`. Il ouvre un dialogue, il refuse ce qui
 * est trop gros, il rend une CHAÎNE. Toute la lecture — le JSON, les clés
 * interdites, les types de widgets, les liaisons — se fait ici, dans le
 * validateur, et donc en un seul endroit. Deux analyseurs pour un format qui
 * circule, ce serait deux jeux de règles qui divergent, et c'est toujours le
 * plus permissif qui décide.
 *
 * Hors Electron (client web), ces fonctions rendent un échec explicite plutôt
 * que de lever : la place de marché doit pouvoir s'afficher là-bas aussi.
 */

import {
  LAYOUT_FILE_MAX_BYTES,
  serializeLayoutFile,
  suggestedFileName,
  utf8ByteLength,
  type LayoutFile,
} from './layoutFormat';
import { isWebPlatform } from '../platform/isWebPlatform';

export interface LayoutFileReadResult {
  content: string;
  /** Le nom du fichier choisi — affiché pour que l'utilisateur reconnaisse le sien. */
  fileName: string;
}

export type LayoutIoOutcome<T> =
  | { status: 'ok'; value: T }
  | { status: 'canceled' }
  | { status: 'error'; message?: string };

/**
 * Le pont IPC tel que le renderer le voit — ET SON ÉMULATION WEB.
 *
 * Sur app.filarr.com, `window.electron.ipcRenderer` EXISTE : c'est le
 * dispatcher web (src/platform/web/installWebPlatform.ts), qui sert les canaux
 * portés et LÈVE sur les autres (`ChannelUnavailableError` pour un canal
 * desktop-only, `ChannelNotImplementedError` pour un palier pas encore livré).
 * Tester la présence du pont ne distingue donc PAS le bureau du navigateur ;
 * c'est `safeInvoke` qui tient le contrat de l'en-tête.
 */
function bridge(): { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } | null {
  const renderer = window.electron?.ipcRenderer;
  return renderer ? { invoke: (channel, ...args) => renderer.invoke(channel, ...args) } : null;
}

/**
 * Invoque un canal et rend `null` au lieu de lever — pont absent, canal absent,
 * ou handler qui lève : pour ce module, tout cela est « pas de fichier ».
 *
 * POURQUOI. `takePendingLayoutOpen` est appelée AU MONTAGE de l'accueil, sans
 * aucun geste. Sur le web le canal est classé desktop-only et le dispatcher
 * lève : la promesse partait en rejet non géré, que le CrashReporter remontait à
 * chaque ouverture de l'accueil (constaté en prod le 2026-08-28). Un dialogue
 * natif qui n'existe pas n'est pas une panne, c'est « rien à ouvrir » — et
 * l'en-tête promettait déjà un échec explicite plutôt qu'une exception.
 */
async function safeInvoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const api = bridge();
  if (!api) return null;
  try {
    return await api.invoke(channel, ...args);
  } catch {
    return null;
  }
}

/** Écrit le fichier là où l'utilisateur le demande. Rend le chemin choisi. */
export async function saveLayoutFile(file: LayoutFile): Promise<LayoutIoOutcome<string>> {
  if (!bridge()) return { status: 'error', message: 'unsupported' };
  const content = serializeLayoutFile(file);
  if (utf8ByteLength(content) > LAYOUT_FILE_MAX_BYTES) {
    return { status: 'error', message: 'too-large' };
  }
  const raw = (await safeInvoke('layouts:exportFile', {
    content,
    suggestedName: suggestedFileName(file.name),
  })) as { success?: boolean; canceled?: boolean; path?: string; error?: string } | null;
  // Pont muet ou canal qui lève (web : `layouts:exportFile` n'est pas encore
  // porté) : même verdict que sans pont, le dialogue affiche « export échoué ».
  if (!raw) return { status: 'error', message: 'unsupported' };
  if (raw.canceled) return { status: 'canceled' };
  if (!raw.success || typeof raw.path !== 'string') return { status: 'error', message: raw.error };
  return { status: 'ok', value: raw.path };
}

/**
 * Ouvre le sélecteur (ou lit un chemin déjà connu, quand le fichier a été
 * double-cliqué dans l'explorateur) et rend son CONTENU BRUT.
 */
export async function readLayoutFile(
  path?: string
): Promise<LayoutIoOutcome<LayoutFileReadResult>> {
  if (!bridge()) return { status: 'error', message: 'unsupported' };
  const raw = (await safeInvoke('layouts:importFile', path ? { path } : {})) as {
    success?: boolean;
    canceled?: boolean;
    content?: string;
    fileName?: string;
    error?: string;
  } | null;
  if (!raw) return { status: 'error', message: 'unsupported' };
  if (raw.canceled) return { status: 'canceled' };
  if (!raw.success || typeof raw.content !== 'string') {
    return { status: 'error', message: raw.error };
  }
  return {
    status: 'ok',
    value: { content: raw.content, fileName: raw.fileName ?? '' },
  };
}

/**
 * Récupère un `.filarrlayout` double-cliqué AVANT que l'écran d'accueil ne soit
 * monté, et l'efface côté principal en le rendant.
 *
 * Sans cette reprise, ouvrir un modèle depuis l'explorateur alors que
 * l'application est fermée ne montrerait rien : l'événement partirait vers un
 * renderer qui n'écoute pas encore, et le fichier serait perdu sans un mot.
 */
export async function takePendingLayoutOpen(): Promise<LayoutFileReadResult | null> {
  // Rien ne double-clique un fichier dans un onglet : le canal est classé
  // desktop-only (src/platform/web/channelClassification.ts) et n'a pas à être
  // présenté au dispatcher web — `safeInvoke` l'absorberait, mais la règle du
  // dispatcher est que l'UI gate ces canaux, pas qu'elle compte sur son refus.
  if (isWebPlatform()) return null;
  const raw = (await safeInvoke('layouts:takePendingOpen')) as {
    content?: string;
    fileName?: string;
  } | null;
  if (!raw || typeof raw.content !== 'string') return null;
  return { content: raw.content, fileName: raw.fileName ?? '' };
}

/**
 * S'abonne aux ouvertures qui arrivent pendant que l'application tourne.
 *
 * L'événement ne porte QU'UN SIGNAL : le contenu se réclame ensuite par
 * `takePendingLayoutOpen`. Une seule voie de lecture, donc un seul endroit où
 * la taille est vérifiée et où le fichier est consommé — un contenu poussé par
 * l'événement ET un autre récupéré à l'ouverture de l'écran auraient fini par
 * ouvrir deux fois le même aperçu.
 *
 * Rend la fonction de désabonnement (l'identité des fonctions ne survit pas au
 * pont de contexte : c'est la seule façon fiable de se détacher).
 */
export function onLayoutFileOpened(handler: () => void): () => void {
  const renderer = window.electron?.ipcRenderer;
  if (!renderer) return () => undefined;
  return renderer.on('filarr-layout-opened', () => handler());
}
