/**
 * ÉTIQUETTES DE FICHIERS — le modèle pur, et le format qui les fait survivre.
 *
 * ── LE DÉFAUT QUE CE MODULE FERME ───────────────────────────────────────────
 *
 * Le bureau montrait un `TagPicker` dans la fiche d'un fichier, et il
 * fonctionnait : on posait une étiquette, elle s'affichait. Mais elle vivait en
 * MÉMOIRE REDUX et nulle part ailleurs — `tagsSlice.fileTagMappings` n'était ni
 * persisté ni synchronisé, `loadTags` se contentait de relire l'état courant, et
 * l'`Item` de `metadata.json` n'avait aucun champ `tags`. Fermer l'application
 * effaçait tout le travail d'étiquetage, sans un mot. C'est le pire genre de
 * défaut : la fonction a l'air de marcher.
 *
 * ── LE FORMAT VIENT DU TÉLÉPHONE, ET C'EST DÉLIBÉRÉ ─────────────────────────
 *
 * Le mobile a créé ce format le premier
 * (`filarr-mobile/src/services/tags/fileTags.ts`) : une TABLE PLATE
 * `Folder.fileTags` — `identifiant de fichier → étiquettes` — rangée dans les
 * métadonnées du DOSSIER, à côté de `description` que le bureau écrit déjà.
 *
 * Pourquoi là, et pas sur l'`Item` : le dossier voyage ENTIER dans
 * `metadata.json`, chiffré et synchronisé tel quel. Une clé optionnelle de plus
 * traverse sans qu'aucune ligne de la synchronisation ait à la connaître — et
 * une version du logiciel qui l'ignore la RECOPIE au lieu de l'effacer.
 *
 * ── UNE ÉTIQUETTE EST UNE CHAÎNE NORMALISÉE, PAS UN IDENTIFIANT ─────────────
 *
 * Minuscules, espaces et virgules ramenés à des tirets. C'est ce qui permet à
 * `pitch` posé sur un ordinateur et `pitch` posé sur un téléphone d'être LA
 * MÊME étiquette — deux identifiants tirés au sort ne se seraient jamais
 * rencontrés.
 *
 * MODULE PUR : ni Redux, ni React, ni horloge.
 */

/** Table `identifiant de fichier → étiquettes`, telle qu'elle est persistée. */
export type FileTagMap = Record<string, string[]>;

/** Le peu qu'il faut connaître d'un dossier pour lire ses étiquettes. */
export interface FileTagFolder {
  id: string;
  fileTags?: FileTagMap;
  deletedAt?: string;
}

/** Le peu qu'il faut connaître d'un fichier pour le filtrer. */
export interface FileTagFile {
  id: string;
  name: string;
  parentId?: string | null;
  deletedAt?: string;
}

/**
 * Normalisation d'une étiquette — LA MÊME RÈGLE QUE LE MOBILE, au caractère
 * près. La changer d'un côté couperait le vocabulaire en deux.
 */
export function normalizeFileTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s,]+/g, '-');
}

/**
 * Nettoie une liste : normalisation, retrait des vides, dédoublon en gardant le
 * PREMIER ordre de saisie (l'ordre alphabétique ferait sauter une pastille sous
 * le curseur à chaque ajout).
 */
export function normalizeFileTagList(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of raw) {
    const tag = normalizeFileTag(entry);
    if (tag === '' || out.includes(tag)) continue;
    out.push(tag);
  }
  return out;
}

/** Les étiquettes d'un fichier, jamais `undefined`. */
export function fileTagsOf(folder: FileTagFolder | undefined, fileId: string): string[] {
  const tags = folder?.fileTags?.[fileId];
  return Array.isArray(tags) ? normalizeFileTagList(tags) : [];
}

/**
 * La table mise à jour pour UN fichier.
 *
 * Une liste vide RETIRE la clé au lieu d'écrire `[]` : sans cela, ouvrir puis
 * refermer la fiche sans rien changer laisserait une entrée vide dans les
 * métadonnées, qui ferait diverger le condensat et relancerait un cycle de
 * synchronisation pour rien.
 *
 * Rend la table D'ORIGINE (même référence) quand rien ne change — l'appelant
 * peut donc s'abstenir d'écrire, et l'écriture reste le geste rare qu'elle doit
 * être.
 */
export function withFileTags(
  map: FileTagMap | undefined,
  fileId: string,
  tags: readonly string[]
): FileTagMap {
  const current = map ?? {};
  const next = normalizeFileTagList(tags);
  const before = current[fileId];
  if (next.length === 0) {
    if (before === undefined) return current;
    const copy = { ...current };
    delete copy[fileId];
    return copy;
  }
  if (before !== undefined && sameTags(before, next)) return current;
  return { ...current, [fileId]: next };
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tag, i) => tag === b[i]);
}

/** Ajoute ou retire UNE étiquette — le geste du sélecteur. */
export function toggleFileTag(
  map: FileTagMap | undefined,
  fileId: string,
  rawTag: string
): FileTagMap {
  const tag = normalizeFileTag(rawTag);
  if (tag === '') return map ?? {};
  const current = normalizeFileTagList(map?.[fileId] ?? []);
  const next = current.includes(tag) ? current.filter((x) => x !== tag) : [...current, tag];
  return withFileTags(map, fileId, next);
}

/**
 * Retire de la table les fichiers qui n'existent plus.
 *
 * Un fichier détruit pour de bon laisserait sinon ses étiquettes dans les
 * métadonnées pour toujours — invisibles, mais comptées par le filtre, qui
 * afficherait une pastille « 3 » menant à deux fichiers.
 */
export function pruneFileTags(
  map: FileTagMap | undefined,
  livingFileIds: Iterable<string>
): FileTagMap {
  const current = map ?? {};
  const alive = new Set(livingFileIds);
  const kept: FileTagMap = {};
  let changed = false;
  for (const [fileId, tags] of Object.entries(current)) {
    if (alive.has(fileId)) kept[fileId] = tags;
    else changed = true;
  }
  return changed ? kept : current;
}

/**
 * La table ASSAINIE telle qu'on la relit du disque.
 *
 * Ces octets viennent d'un `metadata.json` qu'une autre version — ou un autre
 * appareil — a écrit. Une valeur qui n'est pas un tableau de chaînes est
 * ÉCARTÉE, jamais devinée : une étiquette inventée depuis une donnée douteuse
 * se retrouverait dans le vocabulaire de l'utilisateur et dans son filtre.
 */
export function sanitizeFileTagMap(raw: unknown): FileTagMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: FileTagMap = {};
  for (const [fileId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!fileId || !Array.isArray(value)) continue;
    const tags = normalizeFileTagList(value.filter((v): v is string => typeof v === 'string'));
    if (tags.length > 0) out[fileId] = tags;
  }
  return out;
}

// ── Vocabulaire & comptages ─────────────────────────────────────────────────

/**
 * Toutes les étiquettes posées sur des fichiers, triées.
 *
 * Les dossiers à la corbeille sont ignorés : proposer une étiquette qui ne vit
 * plus que dans un dossier supprimé mènerait à une liste vide.
 */
export function allFileTags(folders: Iterable<FileTagFolder>): string[] {
  const set = new Set<string>();
  for (const folder of folders) {
    if (!folder || folder.deletedAt) continue;
    for (const tags of Object.values(folder.fileTags ?? {})) {
      for (const tag of normalizeFileTagList(tags)) set.add(tag);
    }
  }
  return Array.from(set).sort();
}

/** Le vocabulaire COMMUN aux notes et aux fichiers, trié et dédoublonné. */
export function mergedTagVocabulary(
  noteTags: readonly string[],
  fileTags: readonly string[]
): string[] {
  const set = new Set<string>();
  for (const tag of noteTags) if (tag !== '') set.add(tag);
  for (const tag of fileTags) if (tag !== '') set.add(tag);
  return Array.from(set).sort();
}

export interface TagCount {
  tag: string;
  count: number;
}

/**
 * Combien de fichiers VIVANTS portent chaque étiquette, dans un dossier.
 *
 * Trié par nombre décroissant puis par nom : la pastille la plus utile
 * d'abord, et un ordre stable entre deux étiquettes à égalité.
 */
export function tagCountsForFolder(input: {
  fileTags: FileTagMap | undefined;
  files: readonly FileTagFile[];
}): TagCount[] {
  const counts = new Map<string, number>();
  const living = new Set(input.files.filter((f) => !f.deletedAt).map((f) => f.id));
  for (const [fileId, tags] of Object.entries(input.fileTags ?? {})) {
    if (!living.has(fileId)) continue;
    for (const tag of normalizeFileTagList(tags)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts, ([tag, count]) => ({ tag, count })).sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag)
  );
}

/** Le fichier porte-t-il l'étiquette ? `null` = aucun filtre, tout passe. */
export function fileMatchesTag(
  map: FileTagMap | undefined,
  fileId: string,
  tag: string | null
): boolean {
  if (tag === null) return true;
  return (map?.[fileId] ?? []).includes(tag);
}

// ── Recherche par nom ───────────────────────────────────────────────────────

/**
 * Le fichier répond-il à la requête, ÉTIQUETTES COMPRISES ?
 *
 * Le nom d'abord (c'est ce qu'on tape le plus souvent), puis les étiquettes :
 * chercher « pitch » doit trouver `investisseurs.pdf` étiqueté `pitch`, comme
 * la recherche globale qui lit déjà `SearchIndex.tags`.
 *
 * `#pitch` en tête restreint la recherche AUX étiquettes — même geste que le
 * mobile, et la seule façon de dire « je ne cherche PAS ce mot dans les noms ».
 */
export function fileMatchesQuery(
  file: { id: string; name: string },
  tags: readonly string[],
  query: string
): boolean {
  const raw = query.trim();
  if (raw === '') return true;
  if (raw.startsWith('#')) {
    const needle = normalizeFileTag(raw.slice(1));
    if (needle === '') return true;
    return tags.some((tag) => tag.includes(needle));
  }
  const needle = raw.toLowerCase();
  if (file.name.toLowerCase().includes(needle)) return true;
  return tags.some((tag) => tag.includes(needle));
}
