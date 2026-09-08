/**
 * saveExportFile — écrire un fichier d'export là où la personne le demande, sur
 * les deux plateformes.
 *
 * DEUX CHEMINS, ET AUCUN N'EST « LE REPLI DE L'AUTRE ».
 *
 *  · BUREAU : la boîte système (`showSaveDialog`) puis `writeRawFile`. Ce sont
 *    les deux canaux que l'export de fichiers du coffre emprunte déjà
 *    (`services/core/fileService`), et `writeRawFile` est GARDÉ par
 *    `vaultLockGate` : un coffre verrouillé refuse l'écriture au niveau du
 *    processus principal, pas seulement à l'écran. Le chemin est en outre borné
 *    au dossier personnel et au temporaire côté main — un `defaultPath` exotique
 *    ne peut donc pas écrire n'importe où. La boîte système, elle, laisse
 *    choisir n'importe quel lecteur : ce refus-là est donc RECONNU et nommé
 *    (`EXPORT_PATH_REFUSED`) plutôt que rendu comme une panne quelconque.
 *
 *  · WEB : un `Blob` et une ancre `download`. Il n'y a pas de boîte système dans
 *    un navigateur, et `window.electron.ipcRenderer` EXISTE sur app.filarr.com
 *    (le shim web) : appeler le canal bureau y produirait un rejet non géré en
 *    production, pas un message. C'est le piège consigné du dossier web —
 *    `isWebPlatform()` est la seule garde qui vaille, jamais la présence d'un
 *    objet.
 *
 * ANNULER N'EST PAS ÉCHOUER. La boîte système rend un chemin vide quand on ferme
 * : l'appelant doit pouvoir se taire plutôt qu'afficher une erreur pour un geste
 * délibéré. D'où `'canceled'` comme résultat à part entière.
 */

import { isWebPlatform } from '../../../../services/platform/isWebPlatform';
import { errorText } from '../../../../services/vault/vaultErrorMessages';

export type SaveExportResult = 'saved' | 'canceled';

/**
 * LE REFUS DE CHEMIN, NOMMÉ AU LIEU D'ÊTRE SUBI.
 *
 * `writeRawFile` borne l'écriture au dossier personnel et au temporaire — une
 * garde du processus principal, pas un détail. Or la boîte système, elle, laisse
 * choisir `D:\` ou un lecteur réseau : le geste part, il est refusé, et
 * l'appelant n'avait qu'un « l'export a échoué » qui envoie chercher une panne
 * là où il n'y en a pas. Le code ci-dessous est la SEULE chose que cette
 * fonction ajoute au refus : une phrase qui dit où le fichier a le droit
 * d'atterrir.
 *
 * ON RECONNAÎT LE MESSAGE, faute de code : le processus principal lève une
 * `Error` de texte libre (`electron/main.ts`, canal `writeRawFile`), qu'Electron
 * emballe encore dans « Error invoking remote method… ». Ce texte n'est pas
 * traduit et ne dépend d'aucune locale. Les DEUX moitiés comptent — le canal ET
 * le motif — sans quoi n'importe quelle panne parlant de « home » passerait pour
 * ce refus-là.
 */
export const EXPORT_PATH_REFUSED = 'export_path_not_allowed';

export function isWriteRawFilePathRefusal(message: string): boolean {
  return message.includes('writeRawFile') && /must be under user home or temp/i.test(message);
}

export interface ExportFileToSave {
  filename: string;
  mime: string;
  content: string;
}

export async function saveExportFile(file: ExportFileToSave): Promise<SaveExportResult> {
  if (isWebPlatform()) {
    const url = URL.createObjectURL(new Blob([file.content], { type: file.mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = file.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    /**
     * RÉVOQUÉ PLUS TARD, JAMAIS DANS LA FOULÉE DU CLIC. `a.click()` ne fait
     * qu'AMORCER le téléchargement ; libérer l'URL à la ligne suivante peut le
     * couper en route selon le navigateur, et c'est sur un export de plusieurs
     * milliers de lignes — celui qu'on tient à ne pas refaire — que ça se voit.
     * Dix secondes : le délai des deux autres téléchargements web du dépôt
     * (`platform/web/handlers/webFileHandlers`), et la mémoire est bien rendue.
     */
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return 'saved';
  }

  const ipc = window.electron?.ipcRenderer;
  if (!ipc) throw new Error('save_unavailable');
  const extension = file.filename.split('.').pop() ?? 'txt';
  const savePath = (await ipc.invoke('showSaveDialog', {
    defaultPath: file.filename,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  })) as string | undefined;
  if (!savePath) return 'canceled';

  // `TextEncoder` plutôt que la chaîne : le canal attend des octets, et c'est
  // aussi ce qui garantit que la marque d'ordre d'octets du CSV part telle
  // quelle — un encodage implicite la perdrait, et Excel relirait les accents
  // en codage local.
  try {
    await ipc.invoke('writeRawFile', savePath, new TextEncoder().encode(file.content));
  } catch (e) {
    // Traduit le refus de chemin en CODE ; tout le reste (disque plein, droits)
    // remonte tel quel — l'appelant a sa phrase générique pour ce qu'on ne sait
    // pas nommer, et la deviner serait pire que se taire.
    if (isWriteRawFilePathRefusal(errorText(e))) throw new Error(EXPORT_PATH_REFUSED, { cause: e });
    throw e;
  }
  return 'saved';
}

export default saveExportFile;
