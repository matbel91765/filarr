/**
 * syncActivityLabels — traduire les unités de transfert en objets nommables
 *
 * Le moteur de sync ne transfère pas « des fichiers » : il transfère des
 * artefacts sur disque, dont trois seulement portent un nom que quelqu'un
 * reconnaîtrait. Le panneau d'activité affichait le `basename` brut de
 * `localPath`, ce qui donnait des lignes vraies mais muettes — `notes.enc`,
 * `layout.enc`, `hashes.enc` — et, pire, INDISCERNABLES : `<folderId>/
 * metadata.json` perd son identifiant au `basename`, donc cinq dossiers
 * différents s'affichaient comme cinq fois `metadata.json`.
 *
 * Ce module est de la PRÉSENTATION seule. Il ne touche ni au manifeste ni au
 * moteur, et rien ici ne doit décider d'un transfert : un libellé faux ne coûte
 * qu'un mot, un manifeste faux coûte des octets.
 */

import type { TFunction } from 'i18next';

/**
 * Répertoires de service du profil — miroir de `electron/profileDirs.ts`.
 * Dupliqué plutôt qu'importé : ce fichier vit dans le processus principal, et
 * le rendu web (qui sert le même panneau) n'a pas accès à `electron/`.
 */
const NOTE_VERSIONS_DIR = 'note-versions';
const FILE_VERSIONS_DIR = 'file-versions';

/** Miroir de `notesMergeCore` / `layoutMergeCore` — mêmes raisons. */
const NOTES_META_FILE_ID = 'meta:notes';
const LAYOUT_META_FILE_ID = 'meta:layout';

const NOTES_BLOB = 'notes.enc';
const LAYOUT_BLOB = 'layout.enc';
const FOLDER_META = 'metadata.json';

/** Le minimum dont un libellé a besoin — lignes « récentes » comme « échecs ». */
export interface DescribableSyncItem {
  fileId: string;
  name: string;
  localPath?: string;
}

/** Identifiant abrégé, lisible, quand aucun nom de dossier n'est connu. */
function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/**
 * Ce que la ligne doit dire à l'utilisateur.
 *
 * `folderNames` : identifiant de dossier → nom, tel que le rendu le connaît
 * déjà (`state.folders.byId`). Une entrée manquante n'est PAS une erreur — un
 * dossier peut être arrivé du nuage sans avoir encore été chargé — et fait
 * retomber sur l'identifiant abrégé, jamais sur `metadata.json` : mieux vaut
 * un dossier anonyme qu'un nom qui ressemble à celui de tous les autres.
 */
export function describeSyncItem(
  item: DescribableSyncItem,
  folderNames: Readonly<Record<string, string>>,
  t: TFunction
): string {
  const segments = (item.localPath ?? '').split('/').filter(Boolean);
  const basename = segments[segments.length - 1] ?? '';
  const atProfileRoot = segments.length === 1;

  // 1. Blobs de profil. L'identifiant méta d'abord — il est stable et ne peut
  //    pas collider avec un fichier d'utilisateur ; le nom de fichier ensuite,
  //    pour les manifestes écrits avant que ces identifiants existent.
  if (item.fileId === NOTES_META_FILE_ID || (atProfileRoot && basename === NOTES_BLOB)) {
    return t('sync.activity.artifact.notes');
  }
  if (item.fileId === LAYOUT_META_FILE_ID || (atProfileRoot && basename === LAYOUT_BLOB)) {
    return t('sync.activity.artifact.layout');
  }

  // 2. Répertoires de service : TOUT ce qu'ils contiennent est de l'historique
  //    (`hashes.enc`, les index par note, les instantanés). Les nommer un par un
  //    n'apprendrait rien de plus à qui lit le panneau.
  if (segments[0] === NOTE_VERSIONS_DIR) return t('sync.activity.artifact.noteVersions');
  if (segments[0] === FILE_VERSIONS_DIR) return t('sync.activity.artifact.fileVersions');

  // 3. `<folderId>/metadata.json` — l'index d'UN dossier, pas un fichier à soi.
  if (segments.length === 2 && basename === FOLDER_META) {
    const folderName = folderNames[segments[0]];
    return folderName
      ? t('sync.activity.artifact.folderMeta', { name: folderName })
      : t('sync.activity.artifact.folderMetaUnknown', { id: shortId(segments[0]) });
  }

  // 4. Un vrai fichier de l'utilisateur : son nom parle déjà pour lui.
  return item.name || basename || item.fileId;
}

/**
 * Le dossier qui CONTIENT la ligne, quand il en existe un et qu'il ajoute
 * quelque chose. Rien pour les artefacts de profil (ils n'appartiennent à aucun
 * dossier) ni pour la ligne d'un dossier (son nom EST déjà le libellé).
 */
export function describeSyncItemContext(
  item: DescribableSyncItem,
  folderNames: Readonly<Record<string, string>>
): string | undefined {
  const segments = (item.localPath ?? '').split('/').filter(Boolean);
  if (segments.length < 2) return undefined;
  if (segments[segments.length - 1] === FOLDER_META) return undefined;
  if (segments[0] === NOTE_VERSIONS_DIR || segments[0] === FILE_VERSIONS_DIR) return undefined;
  return folderNames[segments[0]];
}
