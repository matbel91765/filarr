/**
 * SÉLECTEURS D'ÉTIQUETTES DE FICHIER — le point de branchement des écrans.
 *
 * ── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
 *
 * Les étiquettes d'un fichier vivent dans les métadonnées de son DOSSIER
 * (`Folder.fileTags`, voir `services/tags/fileTags`), donc les lire demande de
 * croiser deux tranches. Un écran qui referait ce croisement chez lui
 * obtiendrait une table neuve à chaque rendu — et, dans une liste filtrée,
 * re-parcourrait tous les dossiers à chaque frappe.
 *
 * `selectFileTagIndex` mémoïse ce croisement UNE fois. Une vue peut alors se
 * contenter de :
 *
 *     const index = useSelector(selectFileTagIndex);
 *     files.filter((f) => fileMatchesQuery(f, index[f.id] ?? [], query));
 *
 * ── CE QU'ILS NE FONT PAS ───────────────────────────────────────────────────
 *
 * Ils ne touchent pas à `tagsSlice`. La tranche des étiquettes garde son
 * vocabulaire hiérarchique (couleurs, alias, parents) ; ces sélecteurs ne
 * répondent qu'à « quelles chaînes sont posées sur quels fichiers ? », qui est
 * la seule question dont la RÉPONSE EST PERSISTÉE.
 */
import { createSelector } from '@reduxjs/toolkit';

import { allFileTags, normalizeFileTagList, type FileTagMap } from '../../services/tags/fileTags';
import type { Folder } from '../../types';

interface FoldersSliceShape {
  folders: { byId: Record<string, Folder | undefined> };
}

const EMPTY_TAGS: readonly string[] = Object.freeze([]);

/**
 * `identifiant de fichier → étiquettes`, TOUS DOSSIERS CONFONDUS.
 *
 * Les dossiers à la corbeille sont écartés : leurs fichiers ne se cherchent pas
 * non plus, et les compter ferait remonter des étiquettes qui ne mènent nulle
 * part.
 *
 * Référence STABLE tant que la tranche des dossiers ne bouge pas — c'est tout
 * l'intérêt.
 */
export const selectFileTagIndex = createSelector(
  [(state: FoldersSliceShape) => state.folders.byId],
  (byId): FileTagMap => {
    const index: FileTagMap = {};
    for (const folder of Object.values(byId)) {
      if (!folder || folder.deletedAt) continue;
      for (const [fileId, tags] of Object.entries(folder.fileTags ?? {})) {
        const clean = normalizeFileTagList(tags);
        if (clean.length > 0) index[fileId] = clean;
      }
    }
    return index;
  }
);

/** Le vocabulaire complet des étiquettes de fichier, trié. */
export const selectAllFileTags = createSelector(
  [(state: FoldersSliceShape) => state.folders.byId],
  (byId): readonly string[] =>
    allFileTags(Object.values(byId).filter((folder): folder is Folder => !!folder))
);

/** Les étiquettes d'UN fichier — liste vide stable quand il n'en a pas. */
export function selectTagsForFile(state: FoldersSliceShape, fileId: string): readonly string[] {
  return selectFileTagIndex(state)[fileId] ?? EMPTY_TAGS;
}

/** La table d'UN dossier, telle qu'elle est persistée (jamais `undefined`). */
export function selectFolderFileTags(state: FoldersSliceShape, folderId: string): FileTagMap {
  return state.folders.byId[folderId]?.fileTags ?? {};
}
