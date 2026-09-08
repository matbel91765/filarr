/**
 * memberRosterModel (F09) — chercher, filtrer, trier le trombinoscope, et savoir
 * quelles lignes une case à cocher a le droit d'atteindre.
 *
 * POURQUOI CE FICHIER EXISTE. Un coffre d'équipe finit par compter plus de
 * monde qu'un écran n'en montre, et les gestes qui suivent portent sur des
 * LIGNES : changer un rôle, retirer (donc faire TOURNER la clé du coffre),
 * ouvrir une cérémonie de vérification. Se tromper de ligne coûte un accès rendu
 * ou une rotation subie par tout le monde. Ces décisions-là se testent en
 * quelques lignes de vitest tant qu'elles sont des fonctions ; noyées dans le
 * composant, elles ne se vérifieraient qu'à l'œil, une fois — c'est le même
 * découpage que `vaultManagementModel`, pour la même raison.
 *
 * LA SÉLECTION EST UN GARDE-FOU, PAS UN CONFORT. La barre flottante ne propose
 * que deux gestes, et le serveur refuse les DEUX sur le propriétaire et sur
 * soi-même (`requireVaultRole`, garde `last_owner`). Une case à cocher qui les
 * atteindrait ne ferait qu'offrir un échec — pire, un échec au MILIEU d'un lot,
 * après que les premières lignes ont déjà changé. `isSelectable` exige donc les
 * deux capacités que `buildMemberRows` a déjà calculées d'après les règles du
 * serveur : on ne réinvente pas la matrice ici, on la consulte.
 *
 * ET LE LOT NE PORTE QUE SUR CE QUI EST À L'ÉCRAN : un geste ne s'exécute que
 * sur l'intersection de ce qui est coché et de ce que le filtre laisse voir,
 * sans quoi « Retirer (2) » lancerait une rotation sur trois personnes, dont une
 * que le filtre cachait au moment du clic.
 *
 * CE QUI SURVIT AU FILTRE, DIT EXACTEMENT. Poser ou lever un filtre ne touche
 * PAS à la sélection rangée : revenir en arrière retrouve ses cases cochées. En
 * revanche, le premier clic fait SOUS le filtre perd les lignes cachées — la
 * `Table` ne connaît que ce qu'elle affiche, elle propose donc une sélection
 * déjà amputée, et `applySelectionChange` la prend telle quelle. C'est le
 * comportement PRUDENT (jamais plus de monde que ce que l'écran montrait), mais
 * ce n'est pas une mémoire, et il ne faut pas le présenter comme telle.
 *
 * « HORS DE L'ESPACE » NE SE DÉDUIT PAS D'UN SILENCE. `inSpace` absent (Worker
 * d'avant P2) vaut « on ne sait pas », jamais « hors » — même règle que
 * `orphanedMembers`, et pour la même raison : le geste proposé derrière ce
 * filtre fait tourner la clé du coffre.
 */

import type { VaultMemberRow } from './vaultManagementModel';

// ─────────────────────────────────────────────────────────────────────────────
// La requête : ce que la barre au-dessus du tableau décide
// ─────────────────────────────────────────────────────────────────────────────

/** Les six filtres de la fiche, dans l'ordre de la liste déroulante. */
export type RosterFilterId = 'all' | 'admins' | 'members' | 'viewers' | 'outOfSpace' | 'keyChanged';

export const ROSTER_FILTERS: readonly RosterFilterId[] = [
  'all',
  'admins',
  'members',
  'viewers',
  'outOfSpace',
  'keyChanged',
];

/**
 * Les colonnes triables. Les clés sont celles des colonnes de la `Table` : le
 * composant renvoie `column.key` tel quel, et un identifiant qui ne serait pas
 * le même des deux côtés se traduirait par un en-tête qui ne trie rien.
 */
export type RosterSortKey = 'member' | 'role' | 'joined';

export interface RosterSort {
  key: RosterSortKey;
  direction: 'asc' | 'desc';
}

/** L'arrivée sur l'onglet : par adresse, croissant — l'ordre d'avant F09. */
export const DEFAULT_ROSTER_SORT: RosterSort = { key: 'member', direction: 'asc' };

export interface RosterQuery {
  /** Ce qui a été tapé — vide (ou blanc) vaut « tout le monde ». */
  search: string;
  filter: RosterFilterId;
  sort: RosterSort;
}

export interface RosterInput {
  rows: readonly VaultMemberRow[];
  query: RosterQuery;
  /**
   * Les membres dont la clé a changé (ou dont le journal ne tient pas), tels que
   * le contrôle de F11 les a trouvés. Un ensemble VIDE n'est pas « personne » :
   * c'est aussi ce qu'on a tant que le contrôle n'a pas répondu — le filtre rend
   * alors une liste vide, et l'écran dit qu'elle est filtrée.
   */
  keyChanged: ReadonlySet<string>;
}

export interface RosterView {
  /** Les lignes à rendre : filtrées puis triées. */
  rows: VaultMemberRow[];
  /** L'effectif complet, avant tout filtre — l'écran ne doit pas mentir dessus. */
  total: number;
  /** Combien la recherche et le filtre laissent de côté. */
  hidden: number;
  /**
   * Une recherche ou un filtre est-il posé ? C'est ce qui distingue « aucun
   * résultat » (proposer d'effacer le filtre) de « ce coffre est vide » (une
   * situation impossible, cf. `vaultSettingsEmptyStates`).
   */
  filtered: boolean;
  /** Les lignes visibles qu'une case à cocher peut atteindre. */
  selectableIds: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Filtrer
// ─────────────────────────────────────────────────────────────────────────────

const ADMIN_ROLES: ReadonlySet<string> = new Set(['owner', 'admin']);

function matchesFilter(
  row: VaultMemberRow,
  filter: RosterFilterId,
  keyChanged: ReadonlySet<string>
): boolean {
  switch (filter) {
    case 'admins':
      return ADMIN_ROLES.has(row.role);
    case 'members':
      return row.role === 'member';
    case 'viewers':
      return row.role === 'viewer';
    case 'outOfSpace':
      // `=== false` et non `!row.inSpace` : le champ ABSENT vaut « on ne sait
      // pas », et un `!undefined` le rangerait parmi les sortis.
      return row.inSpace === false;
    case 'keyChanged':
      return keyChanged.has(row.userId);
    case 'all':
    default:
      return true;
  }
}

/**
 * La recherche porte sur l'ADRESSE et sur l'IDENTIFIANT, pas sur le rôle.
 *
 * L'identifiant compte autant que l'adresse : un invité n'a pas l'annuaire de
 * l'espace (P2), sa table affiche donc des identifiants, et une recherche qui ne
 * viserait que l'adresse ne trouverait plus personne chez lui. Le rôle, lui, est
 * en dehors : il a son propre filtre, et taper « member » sortirait la moitié du
 * coffre au lieu de la personne cherchée.
 */
function matchesSearch(row: VaultMemberRow, needle: string): boolean {
  if (!needle) return true;
  return (
    row.label.toLowerCase().includes(needle) ||
    row.userId.toLowerCase().includes(needle) ||
    (row.email ?? '').toLowerCase().includes(needle)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Trier
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Le rang des rôles. Trier les LIBELLÉS donnerait « admin < member < owner <
 * viewer » : un classement alphabétique qui ne veut rien dire pour un humain
 * qui cherche qui gère le coffre.
 */
const ROLE_RANK: Record<string, number> = { owner: 0, admin: 1, member: 2, viewer: 3 };
const UNKNOWN_ROLE_RANK = 9;

/** Comparaison par libellé — le départage universel (voir `compareRows`). */
function byLabel(a: VaultMemberRow, b: VaultMemberRow): number {
  return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
}

function joinedMs(row: VaultMemberRow): number | null {
  const ms = Date.parse(row.joinedAt);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Le tri, avec DEUX règles qui ne se voient qu'en les cassant :
 *
 *  1. À valeur égale, l'adresse tranche. Sans ce départage, l'ordre dépend de
 *     ce que le serveur a renvoyé, et deux rendus successifs échangent deux
 *     lignes sous la main de quelqu'un qui vise une case à cocher.
 *  2. Une date illisible finit DERNIÈRE dans les deux sens. « On ne sait pas
 *     quand » n'est ni le plus ancien ni le plus récent ; le laisser au rang
 *     zéro d'un tri croissant en ferait le doyen du coffre.
 */
function compareRows(a: VaultMemberRow, b: VaultMemberRow, sort: RosterSort): number {
  const sens = sort.direction === 'desc' ? -1 : 1;
  if (sort.key === 'role') {
    const ra = ROLE_RANK[a.role] ?? UNKNOWN_ROLE_RANK;
    const rb = ROLE_RANK[b.role] ?? UNKNOWN_ROLE_RANK;
    if (ra !== rb) return (ra - rb) * sens;
    return byLabel(a, b);
  }
  if (sort.key === 'joined') {
    const da = joinedMs(a);
    const db = joinedMs(b);
    // Les inconnues sortent du tri : elles vont au bout, quel que soit le sens.
    if (da === null && db === null) return byLabel(a, b);
    if (da === null) return 1;
    if (db === null) return -1;
    if (da !== db) return (da - db) * sens;
    return byLabel(a, b);
  }
  return byLabel(a, b) * sens;
}

// ─────────────────────────────────────────────────────────────────────────────
// La vue
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Une ligne qu'une case à cocher peut atteindre.
 *
 * Les DEUX capacités sont exigées parce que la barre flottante propose les DEUX
 * gestes : une ligne retirable mais dont le rôle est verrouillé (ou l'inverse)
 * ferait échouer la moitié d'un lot, après coup et en silence. `removable` et
 * `canChangeRole` viennent de `buildMemberRows`, qui reproduit les règles du
 * serveur : le propriétaire et soi-même échouent aux deux.
 */
export function isSelectable(row: VaultMemberRow): boolean {
  return row.removable && row.canChangeRole;
}

/**
 * CE QU'UN TROMBINOSCOPE VIDE A LE DROIT DE DIRE — une clé i18n, pas une phrase.
 *
 * TROIS VIDES QUI NE SE VALENT PAS, et qui se rendaient tous les trois comme du
 * blanc dans la bande compacte : un chargement en cours, un filtre qui ne laisse
 * rien, et un coffre où l'on est réellement seul. Le `<Table>` distinguait déjà
 * les trois (`loading` + `emptyMessage`) ; les cartes, elles, ne rendaient rien
 * du tout. Une absence rendue comme un fait est le travers de tout ce dossier,
 * et il ne devient pas anodin parce qu'il passe de la phrase au blanc.
 *
 * L'ORDRE DES QUESTIONS EST LE FOND. « On n'a pas encore lu » passe AVANT tout :
 * conclure « personne ne correspond » ou « vous êtes seul » sur une liste qui
 * n'est pas arrivée, c'est rendre un verdict sur un silence.
 *
 * UNE CLÉ, PAS UNE TRADUCTION : ce fichier ne connaît ni `t` ni composant, et
 * les deux surfaces (table et cartes) tirent la MÊME clé de la MÊME fonction —
 * deux `if` recopiés divergent au premier quatrième cas.
 */
export type RosterPlaceholderKey =
  | 'common.loading'
  | 'teamVaults.settings.roster.none'
  | 'teamVaults.settings.members.aloneHint';

export function rosterPlaceholderKey(input: {
  /** Une PREMIÈRE lecture est en vol (rien encore à montrer). */
  loading: boolean;
  /** Une recherche ou un filtre est posé — ce qui manque peut être caché. */
  filtered: boolean;
}): RosterPlaceholderKey {
  if (input.loading) return 'common.loading';
  return input.filtered
    ? 'teamVaults.settings.roster.none'
    : 'teamVaults.settings.members.aloneHint';
}

export function rosterView(input: RosterInput): RosterView {
  const needle = input.query.search.trim().toLowerCase();
  const filtre = input.query.filter;
  const rows = input.rows
    .filter((r) => matchesFilter(r, filtre, input.keyChanged) && matchesSearch(r, needle))
    // Copie AVANT tri : `Array.prototype.sort` mute, et la liste vient du hook
    // de chargement — la trier en place ferait bouger l'ordre chez tous les
    // autres onglets qui lisent la même référence.
    .slice()
    .sort((a, b) => compareRows(a, b, input.query.sort));

  return {
    rows,
    total: input.rows.length,
    hidden: input.rows.length - rows.length,
    filtered: needle !== '' || filtre !== 'all',
    selectableIds: rows.filter(isSelectable).map((r) => r.userId),
  };
}

/**
 * Ce qu'un geste de lot emporte VRAIMENT : l'intersection de ce qui est coché,
 * de ce qui est à l'écran, et de ce qu'une case pouvait atteindre.
 *
 * Une sélection survit au changement de filtre (les cases cochées se retrouvent
 * en revenant en arrière) : c'est ici, et à un seul endroit plutôt que dans
 * chaque gestionnaire, que les lignes redevenues invisibles sortent du geste.
 * Les lignes hors d'atteinte, elles, sont écartées deux fois — la `Table` ne
 * leur donne plus de case (`isRowSelectable`), et ce filtre-ci ne les laisserait
 * pas passer davantage.
 */
export function visibleSelection(selected: readonly string[], view: RosterView): string[] {
  const atteignables = new Set(view.selectableIds);
  const vus = new Set<string>();
  return selected.filter((id) => {
    if (!atteignables.has(id) || vus.has(id)) return false;
    vus.add(id);
    return true;
  });
}

/**
 * Ce que la sélection devient quand la `Table` en propose une nouvelle.
 *
 * LA VRAIE RÉPARATION EST EN AMONT, ET ELLE EST FAITE. La `Table` prend
 * désormais un prédicat `isRowSelectable` (l'onglet lui passe `isSelectable`) :
 * le propriétaire et ma ligne n'ont plus de case du tout, la case d'en-tête ne
 * compte que les lignes atteignables — elle se lit donc « tout cochée » pour de
 * bon — et son second clic émet un tableau VIDE, qui ne ressemble à aucun autre
 * geste. Il n'y a plus rien à deviner, et le cas jadis indécidable (toutes les
 * lignes atteignables cochées, la ligne interdite en DERNIER à l'écran : deux
 * gestes, une seule charge utile) ne peut plus se produire.
 *
 * CE QUI SUIT EST DONC LA CEINTURE, LA `Table` ÉTANT LES BRETELLES. Cette
 * fonction reste le dernier mot pour deux raisons qui n'ont pas disparu : elle
 * retire les lignes qu'un FILTRE cache (la `Table` ne les voit même pas), et
 * elle lit encore l'intention « tout décocher » sur la forme historique — la
 * proposition de l'écran ENTIER, dans son ordre. Un appelant qui oublierait le
 * prédicat retomberait sur l'ancien comportement, prudent, plutôt que d'effacer
 * cinq cases parce qu'on en a cliqué une sixième juste avant « Retirer (5) » —
 * c'est-à-dire avant une rotation de clé.
 */
export function applySelectionChange(
  incoming: readonly string[],
  view: RosterView,
  current: readonly string[]
): string[] {
  const next = visibleSelection(incoming, view);
  if (next.length === 0) return [];
  const courant = visibleSelection(current, view);
  const inchangé = next.length === courant.length && courant.every((id) => next.includes(id));
  // L'écran entier, dans son ordre : la signature de la case d'en-tête. Un clic
  // de ligne, lui, ajoute SA ligne à la fin de ce qui était coché.
  const écran = view.rows.map((r) => r.userId);
  const proposeTout =
    incoming.length === écran.length && écran.every((id, i) => incoming[i] === id);
  return inchangé && proposeTout && incoming.length > next.length ? [] : next;
}

/**
 * Les lignes de la sélection, DANS L'ORDRE DE L'ÉCRAN — c'est ainsi que la
 * confirmation les nomme, et une liste dans l'ordre des clics ne se relit pas
 * contre le tableau qu'on a sous les yeux.
 */
export function selectedRows(selected: readonly string[], view: RosterView): VaultMemberRow[] {
  const cochés = new Set(visibleSelection(selected, view));
  return view.rows.filter((r) => cochés.has(r.userId));
}

export default rosterView;
