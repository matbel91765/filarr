/**
 * Comparaison de deux versions d'un document de note, BLOC PAR BLOC — module PUR
 * (ni Redux, ni i18n, ni DOM) et SANS AUCUNE DÉPENDANCE, pas même interne.
 *
 * POURQUOI CE MODULE. L'écran de résolution met deux versions face à face et
 * demande à l'utilisateur de trancher. « Trancher » sur un document entier ne
 * sert à rien : quand deux appareils ont écrit dans la même note, l'un a souvent
 * corrigé un paragraphe pendant que l'autre en ajoutait un autre — garder une
 * version entière jette forcément du travail. Il faut donc découper, et le
 * découpage doit être celui que l'œil voit.
 *
 * LA GRANULARITÉ EST LE BLOC DE PREMIER NIVEAU, et c'est un choix.
 * Un document TipTap est une liste de nœuds de premier niveau : paragraphes,
 * titres, listes, tableaux, images, bases inline. Chacun devient UNE ligne au
 * sens de Git. Ce n'est pas un choix par défaut :
 *  · Plus fin (le mot, le caractère) : un fondu de deux rédactions dans la même
 *    phrase donne une bouillie que personne ne peut relire, et surtout on ne
 *    saurait pas reconstruire le document — une image, un tableau, une base
 *    inline ne se coupent pas en mots. Le résultat fusionné ne serait plus du
 *    contenu, mais du texte.
 *  · Plus grossier (le document) : c'est exactement ce qu'on cherche à éviter.
 * Le bloc a une autre vertu : le nœud d'origine est RECOPIÉ TEL QUEL dans le
 * résultat. Rien n'est reconstruit, donc rien n'est perdu — l'image reste
 * l'image, les lignes de la base inline restent dans les attributs du nœud.
 *
 * ÉGALITÉ. Deux blocs sont « le même » quand leur JSON canonique (clés triées,
 * récursivement) est identique. Sévère à dessein : deux paragraphes au texte
 * identique mais dont l'un porte un lien ne sont PAS le même bloc, et l'écran
 * doit les montrer côte à côte plutôt que de les confondre.
 *
 * CE QUE CE MODULE NE FAIT PAS. Il ne décide pas, il ne persiste rien, il ne
 * connaît ni la note ni son titre : il compare deux documents et sait
 * reconstruire un document à partir d'un jeu de choix. Tout le reste — quoi
 * montrer, quoi écrire, quoi purger — appartient à l'interface et au store.
 */

/** Un bloc de premier niveau, prêt à être comparé et réaffiché. */
export interface DiffBlock {
  /** Rang du bloc dans SON document (0-based). */
  index: number;
  /** Signature d'égalité : deux blocs identiques ont la même. */
  key: string;
  /** Type du nœud TipTap (`paragraph`, `heading`, `table`, `image`…). */
  type: string;
  /**
   * Texte du bloc, pour l'AFFICHAGE seulement. Vide sur un bloc qui n'en porte
   * pas (image, dessin) — l'interface le libelle alors par son type.
   */
  text: string;
  /**
   * Ce qu'on peut dire d'un bloc SANS texte, tiré de ses attributs : le nom du
   * fichier d'une image, le titre et le nombre de lignes d'une base inline, la
   * date d'un bloc calendrier. Vide quand rien n'est lisible.
   *
   * POURQUOI CE CHAMP EXISTE. Un bloc atomique porte tout son contenu dans ses
   * attributs, donc `text` est vide. Sans résumé, deux bases inline de trente
   * lignes différentes s'affichent identiques — et l'écran demanderait de
   * trancher entre deux panneaux qui se ressemblent avant de supprimer
   * définitivement celui qu'on écarte. Trancher à l'aveugle sur un contenu
   * irrécupérable est pire que ne rien proposer.
   */
  summary: string;
  /** Le nœud tel quel. C'est LUI que la fusion recopie, jamais le texte. */
  node: unknown;
}

/** Une étape de la comparaison de séquence. */
export type BlockChangeOp = 'common' | 'added' | 'removed';

export interface BlockChange {
  op: BlockChangeOp;
  /** Bloc côté « ma version » — présent sur `common` et `removed`. */
  mine: DiffBlock | null;
  /** Bloc côté « leur version » — présent sur `common` et `added`. */
  theirs: DiffBlock | null;
}

/**
 * Nature d'un groupe de blocs contigus. `changed` est le cas GitHub : la même
 * place du document porte des blocs des deux côtés.
 */
export type HunkKind = 'common' | 'added' | 'removed' | 'changed';

export interface DiffHunk {
  /** Id stable dans une comparaison donnée — sert de clé de choix. */
  id: string;
  kind: HunkKind;
  mine: DiffBlock[];
  theirs: DiffBlock[];
}

/**
 * Côté retenu pour une différence.
 *
 * `both` n'est pas un raffinement : c'est la seule issue qui ne jette rien.
 * Tout ce qui diverge entre deux zones communes forme UN groupe, donc deux
 * changements sans rapport — ils ont réécrit un paragraphe, j'ai ajouté une
 * image juste en dessous — arrivent en une seule décision. Sans ce troisième
 * choix, il faudrait sacrifier un côté entier, sans recours puisque la copie
 * est ensuite purgée. Les deux suites de nœuds sont simplement concaténées,
 * comme un `git merge` dont on garde les deux versants.
 */
export type DiffSide = 'mine' | 'theirs' | 'both';

/** Choix pris jusqu'ici, `hunk.id → côté`. Les absents ne sont pas tranchés. */
export type HunkChoices = Readonly<Record<string, DiffSide>>;

export interface DocumentComparison {
  /**
   * Empreinte du COUPLE comparé. Les identifiants de différence (`h0@…`) la
   * portent, ce qui rend un choix pris sur une comparaison précédente
   * structurellement incomptable sur la suivante.
   *
   * POURQUOI. Les identifiants sont attribués par position. Un cycle de
   * synchronisation qui remplace le contenu de la note pendant l'arbitrage fait
   * recalculer la comparaison : sans empreinte, `h2` désignerait un autre bloc,
   * les choix déjà pris resteraient comptés, le bouton s'armerait, et on
   * écrirait une fusion que personne n'a jamais vue avant de purger la copie.
   */
  signature: string;
  /** Les deux documents ont pu être lus. Sinon rien n'est comparable. */
  comparable: boolean;
  /**
   * La comparaison fine a été abandonnée (documents trop gros) : toute la partie
   * divergente est rendue comme UNE seule différence.
   */
  coarse: boolean;
  hunks: DiffHunk[];
  /** Racine du document « ma version » — gabarit du résultat fusionné. */
  root: Record<string, unknown> | null;
  /** Nombre de différences, c'est-à-dire de groupes non communs. */
  differences: number;
}

/**
 * Plafond de la table de programmation dynamique. Au-delà, comparer coûterait
 * plus de mémoire qu'une note n'en mérite : on rend UNE différence qui couvre
 * toute la zone divergente, ce qui reste résoluble (en gros) plutôt que de
 * faire ramer l'application ou de refuser la comparaison.
 */
export const MAX_DIFF_CELLS = 1_000_000;

/**
 * Nœuds dont les enfants sont eux-mêmes des blocs : leurs textes se lisent l'un
 * SOUS l'autre. Sert au seul affichage — une liste à puces rendue « abc » d'un
 * trait serait illisible. Un type inconnu est traité comme une ligne unique,
 * ce qui n'abîme jamais rien puisque le nœud, lui, est recopié tel quel.
 */
const BLOCK_CONTAINERS: ReadonlySet<string> = new Set([
  'doc',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'table',
  'tableRow',
  'details',
  'detailsContent',
  'callout',
  'columnBlock',
  'column',
  'toggleList',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * JSON à clés TRIÉES, récursivement, et SANS LES ABSENCES. Rend `null` quand il
 * n'y a rien à écrire, ce qui permet à l'appelant d'omettre la clé.
 *
 * L'ORDRE DES CLÉS d'abord : deux nœuds sémantiquement identiques sérialisés
 * dans un autre ordre — ce qui arrive dès qu'un document fait l'aller-retour par
 * un autre appareil — doivent se reconnaître.
 *
 * LES ATTRIBUTS ABSENTS ENSUITE, et c'est le point critique. ProseMirror émet
 * l'objet `attrs` COMPLET dès qu'un type déclare un attribut, valeurs par défaut
 * comprises : un paragraphe s'écrit `{"type":"paragraph","attrs":{"blockId":null}}`
 * sur un client, `{"type":"paragraph"}` sur un autre — et l'ensemble des clés
 * dépend des extensions chargées. Or un conflit vient PAR DÉFINITION de deux
 * appareils, souvent de deux versions (bureau contre web déployé un autre jour,
 * bureau contre mobile). Comparer `null` à « absent » ferait alors différer TOUS
 * les blocs : le document entier deviendrait une seule différence, et l'écran
 * l'annoncerait quand même « Différence 1 sur 1 » — une dégradation totale et
 * muette, précisément dans le cas où il sert le plus.
 *
 * Un `null` explicite et une clé absente disent la même chose (« pas de
 * valeur »), donc les confondre ne masque aucune vraie différence ; `false`, `0`
 * et la chaîne vide, eux, sont des valeurs et restent comparés. Rien n'est
 * reconstruit à partir d'ici : le nœud d'origine est recopié tel quel.
 */
function canonicalPart(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    // Un `null` DANS un tableau garde sa place : retirer un élément décalerait
    // les suivants et changerait le sens de la séquence.
    return value.length === 0
      ? null
      : `[${value.map((v) => canonicalPart(v) ?? 'null').join(',')}]`;
  }
  if (isRecord(value)) {
    const parts: string[] = [];
    for (const key of Object.keys(value).sort()) {
      const part = canonicalPart(value[key]);
      if (part !== null) parts.push(`${JSON.stringify(key)}:${part}`);
    }
    return parts.length === 0 ? null : `{${parts.join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  return encoded === undefined ? null : encoded;
}

function canonical(value: unknown): string {
  return canonicalPart(value) ?? 'null';
}

/** Texte affichable d'un nœud, sauts de ligne compris. */
function nodeText(node: unknown): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (!isRecord(node)) return '';
  if (node.type === 'text') return typeof node.text === 'string' ? node.text : '';
  if (node.type === 'hardBreak') return '\n';
  const children = node.content;
  if (!Array.isArray(children)) return '';
  const separator = typeof node.type === 'string' && BLOCK_CONTAINERS.has(node.type) ? '\n' : '';
  return children.map(nodeText).join(separator);
}

/**
 * Empreinte du couple de documents comparés.
 *
 * Ce n'est PAS une empreinte cryptographique et elle n'a pas à l'être : elle ne
 * protège de personne, elle distingue deux états successifs du même écran. Ce
 * qu'on exige d'elle est de CHANGER quand le contenu change — un faux positif
 * (deux contenus différents, même empreinte) laisserait passer un choix périmé,
 * donc on y mêle les longueurs, qui coupent court aux collisions faciles.
 * Elle est calculée sur des chaînes déjà en mémoire, sans allocation.
 */
function fingerprint(mine: unknown, theirs: unknown): string {
  const a = typeof mine === 'string' ? mine : '';
  const b = typeof theirs === 'string' ? theirs : '';
  let hash = 0x811c9dc5;
  for (const source of [a, ' ', b]) {
    for (let i = 0; i < source.length; i++) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return `${(hash >>> 0).toString(36)}.${a.length.toString(36)}.${b.length.toString(36)}`;
}

interface ParsedDocument {
  root: Record<string, unknown>;
  nodes: unknown[];
}

/**
 * Lit un document TipTap sérialisé. Rend `null` dès que la forme n'est pas
 * sûre : mieux vaut dire « je ne sais pas comparer » que fabriquer une
 * comparaison inventée sur laquelle quelqu'un supprimerait du contenu.
 * Une chaîne vide est un document VIDE légitime, pas une erreur.
 */
function parseDocument(content: unknown): ParsedDocument | null {
  if (typeof content !== 'string') return null;
  if (content.trim() === '') return { root: { type: 'doc' }, nodes: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const children = parsed.content;
  if (children === undefined || children === null) return { root: parsed, nodes: [] };
  if (!Array.isArray(children)) return null;
  return { root: parsed, nodes: children };
}

/**
 * Attributs qui portent, selon les extensions, quelque chose qu'un humain peut
 * lire. Balayés dans cet ordre : le plus parlant d'abord.
 */
const LABEL_ATTRS: readonly string[] = [
  'title',
  'name',
  'fileName',
  'filename',
  'alt',
  'label',
  'caption',
  'date',
  'url',
  'href',
  'src',
  'code',
  'latex',
  'formula',
  'query',
  'language',
];

/** Au-delà, un résumé cesse d'aider et encombre le panneau. */
const SUMMARY_MAX = 140;

function clip(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > SUMMARY_MAX ? `${flat.slice(0, SUMMARY_MAX - 1)}…` : flat;
}

/**
 * Ce qu'on peut dire d'un bloc à partir de ses seuls attributs.
 *
 * Générique à dessein — un type d'extension ajouté demain reste décrit sans
 * qu'on y pense — avec un seul cas particulier : la base de données inline
 * range tout son contenu dans une chaîne JSON, et « 30 lignes » est ce que
 * l'utilisateur a besoin de comparer.
 */
function blockSummary(node: unknown): string {
  if (!isRecord(node)) return '';
  const attrs = isRecord(node.attrs) ? node.attrs : null;
  if (!attrs) return '';

  const parts: string[] = [];
  if (typeof attrs.data === 'string') {
    try {
      const parsed: unknown = JSON.parse(attrs.data);
      if (isRecord(parsed)) {
        if (typeof parsed.title === 'string' && parsed.title.trim() !== '')
          parts.push(parsed.title);
        if (Array.isArray(parsed.rows)) parts.push(`${parsed.rows.length} ⋮`);
        if (Array.isArray(parsed.properties)) parts.push(`${parsed.properties.length} ⋯`);
      }
    } catch {
      /* une charge illisible ne vaut pas mieux que pas de résumé */
    }
  }
  for (const key of LABEL_ATTRS) {
    const value = attrs[key];
    if (typeof value !== 'string' || value.trim() === '') continue;
    // Une donnée embarquée (image collée, dessin) n'a rien de lisible à montrer.
    if (value.startsWith('data:')) continue;
    parts.push(value);
    break;
  }
  return clip(parts.join(' · '));
}

function toBlocks(nodes: readonly unknown[]): DiffBlock[] {
  return nodes.map((node, index) => ({
    index,
    key: canonical(node),
    type: isRecord(node) && typeof node.type === 'string' ? node.type : '',
    text: nodeText(node),
    summary: blockSummary(node),
    node,
  }));
}

/**
 * Différence de séquence sur deux listes de blocs — plus longue sous-séquence
 * commune, puis remontée déterministe.
 *
 * L'ordre d'émission est fixé : à un point de divergence, ce qui DISPARAÎT sort
 * avant ce qui APPARAÎT. Le regroupement en dépend, et un ordre qui varierait
 * d'un rendu à l'autre ferait sauter les choix déjà pris d'une différence à
 * l'autre.
 *
 * Coût mémoire `(n+1)×(m+1)` entiers : l'appelant public `compareDocuments`
 * borne les entrées, un appel direct ne l'est pas.
 */
export function diffBlocks(
  mine: readonly DiffBlock[],
  theirs: readonly DiffBlock[]
): BlockChange[] {
  const n = mine.length;
  const m = theirs.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return theirs.map((block) => ({ op: 'added' as const, mine: null, theirs: block }));
  if (m === 0) return mine.map((block) => ({ op: 'removed' as const, mine: block, theirs: null }));

  const width = m + 1;
  // `dp[i][j]` = longueur de la plus longue sous-séquence commune des SUFFIXES.
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] =
        mine[i].key === theirs[j].key
          ? dp[(i + 1) * width + (j + 1)] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + (j + 1)]);
    }
  }

  const out: BlockChange[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && mine[i].key === theirs[j].key) {
      out.push({ op: 'common', mine: mine[i], theirs: theirs[j] });
      i++;
      j++;
    } else if (i < n && (j === m || dp[(i + 1) * width + j] >= dp[i * width + (j + 1)])) {
      out.push({ op: 'removed', mine: mine[i], theirs: null });
      i++;
    } else {
      out.push({ op: 'added', mine: null, theirs: theirs[j] });
      j++;
    }
  }
  return out;
}

/**
 * Regroupe les étapes en différences décidables. Une suite contiguë de blocs
 * communs devient un groupe `common` ; TOUT ce qui diverge entre deux zones
 * communes devient UN SEUL groupe, quel que soit l'ordre dans lequel les
 * retraits et les ajouts se sont présentés — deux boutons pour une même place
 * du document, jamais quatre.
 */
export function buildHunks(changes: readonly BlockChange[], signature = ''): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const mark = signature === '' ? '' : `@${signature}`;
  let i = 0;
  let seq = 0;
  while (i < changes.length) {
    const mine: DiffBlock[] = [];
    const theirs: DiffBlock[] = [];
    if (changes[i].op === 'common') {
      while (i < changes.length && changes[i].op === 'common') {
        const { mine: a, theirs: b } = changes[i];
        if (a) mine.push(a);
        if (b) theirs.push(b);
        i++;
      }
      hunks.push({ id: `h${seq++}${mark}`, kind: 'common', mine, theirs });
      continue;
    }
    while (i < changes.length && changes[i].op !== 'common') {
      const change = changes[i];
      if (change.op === 'removed' && change.mine) mine.push(change.mine);
      else if (change.op === 'added' && change.theirs) theirs.push(change.theirs);
      i++;
    }
    const kind: HunkKind =
      mine.length > 0 && theirs.length > 0 ? 'changed' : mine.length > 0 ? 'removed' : 'added';
    hunks.push({ id: `h${seq++}${mark}`, kind, mine, theirs });
  }
  return hunks;
}

/**
 * Compare deux documents sérialisés.
 *
 * Les préfixes et suffixes communs sont retirés AVANT la table : un conflit
 * réel ne touche presque jamais qu'un endroit, et sans cette coupe une note de
 * mille paragraphes ferait travailler un million de cases pour un paragraphe
 * changé.
 */
export function compareDocuments(mineContent: unknown, theirsContent: unknown): DocumentComparison {
  const signature = fingerprint(mineContent, theirsContent);
  const mineDoc = parseDocument(mineContent);
  const theirsDoc = parseDocument(theirsContent);
  if (!mineDoc || !theirsDoc) {
    return {
      signature,
      comparable: false,
      coarse: false,
      hunks: [],
      root: mineDoc ? mineDoc.root : null,
      differences: 0,
    };
  }

  const mine = toBlocks(mineDoc.nodes);
  const theirs = toBlocks(theirsDoc.nodes);

  let start = 0;
  while (start < mine.length && start < theirs.length && mine[start].key === theirs[start].key) {
    start++;
  }
  let endMine = mine.length;
  let endTheirs = theirs.length;
  while (
    endMine > start &&
    endTheirs > start &&
    mine[endMine - 1].key === theirs[endTheirs - 1].key
  ) {
    endMine--;
    endTheirs--;
  }

  const middleMine = mine.slice(start, endMine);
  const middleTheirs = theirs.slice(start, endTheirs);

  const changes: BlockChange[] = [];
  for (let i = 0; i < start; i++) changes.push({ op: 'common', mine: mine[i], theirs: theirs[i] });

  let coarse = false;
  if ((middleMine.length + 1) * (middleTheirs.length + 1) > MAX_DIFF_CELLS) {
    coarse = true;
    for (const block of middleMine) changes.push({ op: 'removed', mine: block, theirs: null });
    for (const block of middleTheirs) changes.push({ op: 'added', mine: null, theirs: block });
  } else {
    for (const change of diffBlocks(middleMine, middleTheirs)) changes.push(change);
  }

  for (let i = endMine; i < mine.length; i++) {
    changes.push({ op: 'common', mine: mine[i], theirs: theirs[endTheirs + (i - endMine)] });
  }

  const hunks = buildHunks(changes, signature);
  return {
    signature,
    comparable: true,
    coarse,
    hunks,
    root: mineDoc.root,
    differences: hunks.filter((hunk) => hunk.kind !== 'common').length,
  };
}

/** Les différences qui attendent encore un choix, dans l'ordre du document. */
export function unresolvedHunkIds(hunks: readonly DiffHunk[], choices: HunkChoices = {}): string[] {
  return hunks
    .filter((hunk) => hunk.kind !== 'common' && choices[hunk.id] === undefined)
    .map((hunk) => hunk.id);
}

/** Où en est la résolution — ce que le pied de l'écran annonce. */
export function decisionSummary(
  hunks: readonly DiffHunk[],
  choices: HunkChoices = {}
): { total: number; decided: number; allMine: boolean; allTheirs: boolean } {
  let total = 0;
  let decided = 0;
  let mine = 0;
  let theirs = 0;
  for (const hunk of hunks) {
    if (hunk.kind === 'common') continue;
    total++;
    const side = choices[hunk.id];
    if (side === undefined) continue;
    decided++;
    // `both` est tranché sans être d'un côté : il ne doit alimenter NI le compte
    // « tout à moi » NI « tout à eux », sous peine de faire recopier une version
    // entière alors que l'utilisateur a demandé de garder les deux.
    if (side === 'theirs') theirs++;
    else if (side === 'mine') mine++;
  }
  return {
    total,
    decided,
    allMine: total > 0 && mine === total,
    allTheirs: total > 0 && theirs === total,
  };
}

/**
 * Les blocs du résultat, dans l'ordre. Une différence non tranchée retombe sur
 * « ma version » : c'est l'état de départ du document d'origine, donc le seul
 * repli qui ne fabrique rien. L'interface, elle, EXIGE un choix explicite avant
 * d'écrire — ce repli n'est là que pour que l'aperçu ait toujours un sens.
 */
export function mergedBlocks(hunks: readonly DiffHunk[], choices: HunkChoices = {}): DiffBlock[] {
  const out: DiffBlock[] = [];
  for (const hunk of hunks) {
    if (hunk.kind === 'common') {
      for (const block of hunk.mine) out.push(block);
      continue;
    }
    const choice = choices[hunk.id];
    if (choice === 'both') {
      // La mienne puis la leur, dans cet ordre : le document d'origine est le
      // mien, garder son fil de lecture est ce qui surprend le moins.
      for (const block of hunk.mine) out.push(block);
      for (const block of hunk.theirs) out.push(block);
      continue;
    }
    for (const block of choice === 'theirs' ? hunk.theirs : hunk.mine) out.push(block);
  }
  return out;
}

/**
 * Reconstruit le document fusionné et son texte brut.
 *
 * La racine de « ma version » sert de gabarit (elle peut porter des attributs
 * que le contenu ne dit pas), seuls ses enfants sont remplacés. Un résultat
 * sans aucun bloc reçoit un paragraphe vide : un `doc` sans contenu n'est pas
 * un document que l'éditeur sait rouvrir.
 *
 * Le texte brut joint les blocs par une ligne blanche, comme le fait l'éditeur
 * lorsqu'il redérive `plainText` — il sert à la recherche et aux extraits, et
 * doit dire la même chose que le document.
 */
export function mergedDocument(
  comparison: DocumentComparison,
  choices: HunkChoices = {}
): { content: string; plainText: string } {
  const blocks = mergedBlocks(comparison.hunks, choices);
  const root: Record<string, unknown> = isRecord(comparison.root)
    ? { ...comparison.root }
    : { type: 'doc' };
  if (typeof root.type !== 'string' || root.type === '') root.type = 'doc';
  root.content = blocks.length > 0 ? blocks.map((block) => block.node) : [{ type: 'paragraph' }];
  return {
    content: JSON.stringify(root),
    plainText: blocks.map((block) => block.text).join('\n\n'),
  };
}
