/**
 * vaultPaths — le FORMAT de meta.path et toute la logique d'arbre, sans React
 * ni réseau. Les dossiers d'un coffre n'existent QUE dans la méta chiffrée :
 * le serveur ne voit jamais un nom ni un chemin, et ce module est le seul
 * endroit où leur grammaire est écrite.
 *
 * FORMAT. `meta.path` est le chemin du dossier CONTENANT l'élément ; absent ou
 * `''` = racine ; segments joints par '/', sans '/' de tête ni de queue
 * (ex. 'Contrats/2026'). Chaque segment : NFC, trim des deux côtés, 1..120
 * caractères ; interdits : '/', '.', '..', vide ou blanc pur, contrôles
 * U+0000–U+001F. Bornes : MAX_PATH_DEPTH=12, MAX_SEGMENT_LEN=120,
 * MAX_PATH_LEN=1000 — la méta chiffrée entière doit rester très en deçà de la
 * borne serveur (MAX_META_B64 = 8192 en b64 ≈ 6 Ko clair) et la validation se
 * fait AVANT chiffrement : un 400 post-chiffrement est un message
 * intraduisible.
 *
 * COMPARAISON. Égalité stricte APRÈS normalisation, SENSIBLE à la casse
 * ('Docs' ≠ 'docs' — décision assumée : le tri collator les rend adjacents, et
 * une insensibilité choisie ici devrait choisir UNE casse gagnante à
 * l'affichage, mensonge qu'aucun des deux clients n'a les moyens de tenir).
 *
 * POSTEL. En LECTURE, normalizePath() applique NFC et retire les segments
 * vides avant toute comparaison — macOS livre du NFD au drag-drop, et deux
 * clients qui écriraient 'é' différemment créeraient deux dossiers jumeaux.
 * En ÉCRITURE on stocke toujours la forme normalisée.
 *
 * DOSSIERS IMPLICITES. Un dossier existe dès qu'un descendant existe : l'arbre
 * est l'union des préfixes de tous les path ET des éléments MARQUEURS
 * (meta.folderMarker). C'est ce qui rend un renommage interrompu VISIBLE (deux
 * dossiers, chacun avec sa part) au lieu de perdu, et ce qui fait survivre un
 * dossier dont le marqueur est illisible (époque perdue) tant qu'il a des
 * enfants.
 */

export const MAX_PATH_DEPTH = 12;
export const MAX_SEGMENT_LEN = 120;
export const MAX_PATH_LEN = 1000;

/** La méta minimale que ce module sait lire — structurellement, pas nominalement. */
export interface PathedMeta {
  title?: string;
  path?: string;
  folderMarker?: boolean;
}

// eslint-disable-next-line no-control-regex -- les contrôles C0 sont exactement ce qu'on interdit
const CONTROL_CHARS = /[\u0000-\u001F]/;

/**
 * Valide et normalise UN nom de dossier (un segment).
 * Jette une Error dont le message est un code i18n-able :
 * 'folder_name_invalid' | 'folder_name_too_long'.
 */
export function normalizeFolderName(name: string): string {
  const n = name.normalize('NFC').trim();
  if (n.length === 0 || n === '.' || n === '..' || n.includes('/') || CONTROL_CHARS.test(n)) {
    throw new Error('folder_name_invalid');
  }
  if (n.length > MAX_SEGMENT_LEN) throw new Error('folder_name_too_long');
  return n;
}

/**
 * La forme canonique d'un chemin, tolérante en lecture : NFC, segments vides
 * retirés, jamais de '/' de tête ou de queue. `undefined` = racine = ''.
 */
export function normalizePath(p: string | undefined | null): string {
  if (!p) return '';
  return p
    .normalize('NFC')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join('/');
}

/** 'Contrats' + '2026' → 'Contrats/2026' ; parent racine → le nom seul. */
export function joinPath(parent: string, name: string): string {
  const p = normalizePath(parent);
  return p ? `${p}/${name}` : name;
}

/** 'Contrats/2026' → 'Contrats' ; 'Contrats' → '' (racine). */
export function parentOf(p: string): string {
  const n = normalizePath(p);
  const i = n.lastIndexOf('/');
  return i === -1 ? '' : n.slice(0, i);
}

/** 'Contrats/2026' → '2026'. Racine → ''. */
export function lastSegment(p: string): string {
  const n = normalizePath(p);
  const i = n.lastIndexOf('/');
  return i === -1 ? n : n.slice(i + 1);
}

/**
 * `p` est-il `ancestor` lui-même ou l'un de ses descendants ?
 *
 * LE test d'appartenance, écrit UNE fois : `path === folder || path.startsWith(
 * folder + '/')`. Un startsWith nu emporterait 'AB' en renommant 'A'.
 * L'ancêtre racine ('') contient tout.
 */
export function isDescendantOrSelf(p: string, ancestor: string): boolean {
  const a = normalizePath(ancestor);
  if (a === '') return true;
  const n = normalizePath(p);
  return n === a || n.startsWith(`${a}/`);
}

/** Garde de profondeur/longueur totale — à appeler avant d'ÉCRIRE un path. */
export function assertPathWithinBounds(p: string): void {
  const n = normalizePath(p);
  if (n.length > MAX_PATH_LEN) throw new Error('folder_path_too_long');
  if (n !== '' && n.split('/').length > MAX_PATH_DEPTH) throw new Error('folder_too_deep');
}

/**
 * Les dossiers ENFANTS DIRECTS de `currentPath` : union des préfixes implicites
 * (tout path d'item dont currentPath est un préfixe strict apporte son segment
 * suivant) et des marqueurs rangés DANS currentPath. Dédoublonné, non trié —
 * le tri appartient à l'appelant (collator i18n-aware).
 */
export function deriveFolders(items: Array<{ meta: PathedMeta }>, currentPath: string): string[] {
  const cur = normalizePath(currentPath);
  const names = new Set<string>();
  for (const item of items) {
    const p = normalizePath(item.meta.path);
    // (a) préfixes implicites : l'item vit STRICTEMENT sous cur → son premier
    // segment après cur est un dossier enfant.
    if (p !== cur && isDescendantOrSelf(p, cur)) {
      const rest = cur === '' ? p : p.slice(cur.length + 1);
      const first = rest.split('/')[0];
      if (first) names.add(first);
    }
    // (b) marqueurs : un dossier vide n'existe que par son marqueur.
    if (item.meta.folderMarker && p === cur && item.meta.title) {
      names.add(item.meta.title.normalize('NFC'));
    }
  }
  return [...names];
}

/** Dossiers d'abord, ordre humain ('Dossier 2' avant 'Dossier 10'). */
export function sortFoldersFirst(folderNames: string[], collator: Intl.Collator): string[] {
  return [...folderNames].sort((a, b) => collator.compare(a, b));
}

export interface PlannedMove<M extends PathedMeta> {
  itemId: string;
  meta: M;
}

interface PlannableItem<M extends PathedMeta> {
  id: string;
  meta: M;
}

/**
 * Le plan d'un RENOMMAGE de dossier : pour chaque item vivant dans le dossier
 * ou dessous, la même méta avec le préfixe réécrit ; PLUS le marqueur du
 * dossier lui-même (title réécrit). Le plan se RECALCULE à chaque tentative
 * depuis le store frais — jamais conservé : les items déjà déplacés ne matchent
 * plus l'ancien préfixe, la reprise est idempotente par construction.
 */
export function planFolderRename<M extends PathedMeta>(
  items: Array<PlannableItem<M>>,
  folderPath: string,
  newName: string
): Array<PlannedMove<M>> {
  const from = normalizePath(folderPath);
  if (from === '') throw new Error('folder_name_invalid'); // la racine ne se renomme pas
  const name = normalizeFolderName(newName);
  const to = joinPath(parentOf(from), name);
  const parent = parentOf(from);
  const marker = lastSegment(from);
  const moves: Array<PlannedMove<M>> = [];
  for (const item of items) {
    const p = normalizePath(item.meta.path);
    if (item.meta.folderMarker && p === parent && item.meta.title?.normalize('NFC') === marker) {
      // Le marqueur du dossier renommé : son TITRE change, pas son path.
      moves.push({ itemId: item.id, meta: { ...item.meta, title: name } });
      continue;
    }
    if (isDescendantOrSelf(p, from)) {
      const suffix = p === from ? '' : p.slice(from.length + 1);
      const next = suffix ? `${to}/${suffix}` : to;
      assertPathWithinBounds(next);
      moves.push({ itemId: item.id, meta: { ...item.meta, path: next } });
    }
  }
  return moves;
}

export type MoveSource = { kind: 'item'; id: string } | { kind: 'folder'; path: string };

/**
 * Le plan d'un DÉPLACEMENT (drag-drop interne) : items nommés et/ou dossiers
 * entiers vers `destPath`. Garde de cycle : déposer un dossier dans lui-même ou
 * dans un de ses descendants jette 'folder_move_into_self'.
 */
export function planMoveInto<M extends PathedMeta>(
  items: Array<PlannableItem<M>>,
  sources: MoveSource[],
  destPath: string
): Array<PlannedMove<M>> {
  const dest = normalizePath(destPath);
  assertPathWithinBounds(dest);
  const moves: Array<PlannedMove<M>> = [];
  const planned = new Set<string>();
  for (const source of sources) {
    if (source.kind === 'item') {
      const item = items.find((i) => i.id === source.id);
      if (!item || planned.has(item.id)) continue;
      if (normalizePath(item.meta.path) === dest) continue; // déjà là — zéro PATCH
      planned.add(item.id);
      moves.push({ itemId: item.id, meta: { ...item.meta, path: dest || undefined } as M });
      continue;
    }
    const from = normalizePath(source.path);
    if (from === '') throw new Error('folder_move_into_self');
    if (isDescendantOrSelf(dest, from)) throw new Error('folder_move_into_self');
    if (parentOf(from) === dest) continue; // déjà là
    const to = joinPath(dest, lastSegment(from));
    const parent = parentOf(from);
    const marker = lastSegment(from);
    for (const item of items) {
      if (planned.has(item.id)) continue;
      const p = normalizePath(item.meta.path);
      if (item.meta.folderMarker && p === parent && item.meta.title?.normalize('NFC') === marker) {
        planned.add(item.id);
        moves.push({ itemId: item.id, meta: { ...item.meta, path: dest || undefined } as M });
        continue;
      }
      if (isDescendantOrSelf(p, from)) {
        const suffix = p === from ? '' : p.slice(from.length + 1);
        const next = suffix ? `${to}/${suffix}` : to;
        assertPathWithinBounds(next);
        planned.add(item.id);
        moves.push({ itemId: item.id, meta: { ...item.meta, path: next } });
      }
    }
  }
  return moves;
}

// ── Suppression récursive d'un dossier (queues-p1) ───────────────────────────

export interface FolderDeletePlan {
  /** ids à supprimer : CONTENUS d'abord (ordre libre), puis MARQUEURS du plus
   *  profond au moins profond — une interruption laisse toujours un arbre où
   *  chaque élément survivant a encore son dossier (implicite ou marqué). */
  deletions: string[];
  /** Contenus (non-marqueurs) sautés faute de droits. */
  skippedContent: number;
  /** Marqueurs sautés (droits insuffisants, ou un élément sauté survit dessous). */
  skippedMarkers: number;
  /** Total de contenus sous le dossier — pour le dialogue. */
  totalContent: number;
}

/**
 * Le plan PUR de suppression récursive. La récursion est CLIENT par
 * construction : les chemins vivent dans la méta chiffrée, le serveur ne peut
 * pas savoir ce qui est « sous » un dossier — le plan ne part JAMAIS au
 * serveur, seuls des ids opaques le font (N DELETE).
 *
 * La matrice de droits s'applique AVANT le geste (même prédicat que le
 * serveur, fourni par l'appelant) : un contenu sauté garde VIVANTS le marqueur
 * de son dossier ET ceux de tous ses ancêtres — sinon le dossier resterait
 * visible (implicite) mais perdrait son marqueur, et disparaîtrait en silence
 * une fois vidé plus tard.
 */
export function planFolderDelete<T extends { id: string; meta: PathedMeta }>(
  items: readonly T[],
  folderPath: string,
  canDelete: (item: T) => boolean
): FolderDeletePlan {
  const from = normalizePath(folderPath);
  if (from === '') throw new Error('folder_name_invalid'); // la racine ne se supprime pas

  /** Le dossier que CE marqueur incarne. */
  const folderOf = (marker: T): string =>
    joinPath(normalizePath(marker.meta.path), (marker.meta.title ?? '').normalize('NFC'));

  const contentDeletions: string[] = [];
  let skippedContent = 0;
  let totalContent = 0;
  /** Les path des contenus SAUTÉS — les dossiers qui doivent survivre. */
  const keepAlive: string[] = [];

  for (const item of items) {
    if (item.meta.folderMarker) continue;
    const p = normalizePath(item.meta.path);
    if (!isDescendantOrSelf(p, from)) continue;
    totalContent++;
    if (canDelete(item)) {
      contentDeletions.push(item.id);
    } else {
      skippedContent++;
      keepAlive.push(p);
    }
  }

  // Marqueurs du dossier et de ses descendants, du PLUS PROFOND au moins
  // profond : un marqueur survivant (droits, ou contenu sauté dessous) pousse
  // son dossier dans keepAlive — les marqueurs moins profonds le voient.
  const markers = items
    .filter((i) => i.meta.folderMarker && isDescendantOrSelf(folderOf(i), from))
    .sort((a, b) => folderOf(b).split('/').length - folderOf(a).split('/').length);

  const markerDeletions: string[] = [];
  let skippedMarkers = 0;
  for (const marker of markers) {
    const folder = folderOf(marker);
    const shelters = keepAlive.some((p) => isDescendantOrSelf(p, folder));
    if (canDelete(marker) && !shelters) {
      markerDeletions.push(marker.id);
    } else {
      skippedMarkers++;
      keepAlive.push(folder);
    }
  }

  return {
    deletions: [...contentDeletions, ...markerDeletions],
    skippedContent,
    skippedMarkers,
    totalContent,
  };
}
