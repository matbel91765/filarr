/**
 * vaultDuplicate — « Dupliquer ici » dans un coffre, la partie PURE.
 *
 * POURQUOI. L'explorateur personnel sait copier ; le coffre n'avait aucun
 * chemin pour ça (pas de thunk `copy`/`duplicate` dans `vaultsSlice`). Un
 * duplicata de coffre est un NOUVEL élément : ses octets sont relus (déchiffrés
 * sous sa K_item), puis re-chiffrés sous une K_item neuve (`addVaultItem`). Il
 * n'y a donc rien à « copier » côté serveur — c'est un envoi, avec le coût d'un
 * envoi (quota, temps de chiffrement), et c'est dit à l'écran.
 *
 * Ce module ne décide que du NOM et du PLAN — les deux endroits où un défaut
 * compilerait : « (copie) (copie) » au lieu de « (copie 2) », un doublon de
 * nom dans le même dossier, un dossier pris pour un fichier.
 */

import { normalizePath } from '../../../services/vault/vaultPaths';
import type { VaultItemLike } from './vaultExplorerModel';

/** Les types d'élément dont on sait relire et renvoyer les octets. */
const DUPLICABLE_TYPES: ReadonlySet<string> = new Set(['file', 'note', 'transclusion']);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `rapport.final.pdf` → ['rapport.final', '.pdf'] ; `.env` et `Sans point` → [nom, '']. */
export function splitExtension(name: string): [string, string] {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return [name, ''];
  return [name.slice(0, i), name.slice(i)];
}

/**
 * Le nom du duplicata : « nom (copie).ext », puis « nom (copie 2).ext »…
 *
 * Un nom qui porte DÉJÀ le suffixe n'en reçoit pas un second : « a (copie) »
 * devient « a (copie 2) », « a (copie 2) » devient « a (copie 3) ». Et le
 * premier candidat libre gagne : `taken` porte les noms déjà présents dans le
 * dossier de destination (le lot en cours compris), pour ne jamais produire
 * deux « (copie) » du même fichier dans le même dossier.
 */
export function copyNameFor(name: string, copyWord: string, taken: ReadonlySet<string>): string {
  const [base, ext] = splitExtension(name);
  const suffix = new RegExp(`^(.*?) \\(${escapeRegExp(copyWord)}(?: (\\d+))?\\)$`);
  const m = base.match(suffix);
  const root = m ? m[1] : base;
  // Sans suffixe : on commence à « (copie) ». Avec : au numéro suivant.
  let n = m ? (m[2] ? Number(m[2]) + 1 : 2) : 1;
  const candidate = (k: number) => `${root} (${copyWord}${k > 1 ? ` ${k}` : ''})${ext}`;
  let out = candidate(n);
  while (taken.has(out)) {
    n++;
    out = candidate(n);
  }
  return out;
}

/** Le nom qui porte l'identité d'un élément : le fichier, sinon le titre. */
export function duplicateSourceName(meta: VaultItemLike['meta']): string {
  return meta.fileName || meta.title || '';
}

/**
 * La méta du duplicata : la MÊME (chemin, mime…) avec le nom suffixé — sur
 * `fileName` pour un fichier, sur `title` pour une note. Les deux vides : le
 * suffixe seul, pour que le duplicata soit au moins reconnaissable.
 */
export function duplicateMeta<M extends VaultItemLike['meta']>(
  meta: M,
  copyWord: string,
  taken: ReadonlySet<string>
): M {
  if (meta.fileName) return { ...meta, fileName: copyNameFor(meta.fileName, copyWord, taken) };
  if (meta.title) return { ...meta, title: copyNameFor(meta.title, copyWord, taken) };
  return { ...meta, title: copyNameFor('', copyWord, taken).trim() };
}

/** Les noms déjà pris dans UN dossier — les contenus seulement, ni marqueurs ni fils. */
export function takenNamesIn(allItems: readonly VaultItemLike[], path: string): Set<string> {
  const p = normalizePath(path);
  const out = new Set<string>();
  for (const it of allItems) {
    if (it.meta.folderMarker || it.meta.threadFor) continue;
    if (normalizePath(it.meta.path) !== p) continue;
    const nom = duplicateSourceName(it.meta);
    if (nom) out.add(nom);
  }
  return out;
}

export interface DuplicatePlan<T extends VaultItemLike> {
  /** Ce qui sera dupliqué, dans l'ordre de la sélection. */
  files: T[];
  /** Les DOSSIERS cochés : exclus, et dits. Un dossier n'a pas d'octets à relire. */
  skippedFolders: number;
  /** Les éléments d'un type qu'on ne sait pas rejouer — exclus, et dits. */
  skippedOther: number;
}

/**
 * Le plan d'une duplication : les éléments cochés DIRECTEMENT, fichiers et
 * notes ; les dossiers cochés sont exclus (leur contenu n'est PAS aplati — un
 * « Dupliquer » qui déverserait cent fichiers d'un dossier dans le dossier
 * courant serait une surprise, pas un service).
 */
export function planDuplicate<T extends VaultItemLike>(resolved: {
  items: readonly T[];
  folderPaths: readonly string[];
}): DuplicatePlan<T> {
  const files: T[] = [];
  let skippedOther = 0;
  for (const it of resolved.items) {
    if (DUPLICABLE_TYPES.has(it.itemType)) files.push(it);
    else skippedOther++;
  }
  return { files, skippedFolders: resolved.folderPaths.length, skippedOther };
}
