/**
 * Accueil modulaire — le REGISTRE DE WIDGETS.
 *
 * ── POURQUOI LE REGISTRE EST CLOS ───────────────────────────────────────────
 *
 * Une disposition (et surtout un GABARIT, qui se publie et s'installe) ne
 * transporte qu'une CHAÎNE : `LayoutSlot.type`. Cette chaîne est résolue ICI, et
 * nulle part ailleurs, contre une table écrite à la main dans ce fichier.
 *
 * C'est LA garantie de sécurité de la place de marché : un gabarit venu
 * d'internet ne peut désigner que des composants que ce binaire embarque déjà.
 * Il ne peut pas nommer un module arbitraire, pas injecter de code, pas faire
 * exécuter quoi que ce soit — au pire il nomme un type inconnu, et l'accueil
 * affiche un bloc vide. Rien dans ce module ne doit jamais devenir dynamique :
 * pas d'`import()` calculé, pas d'enregistrement à chaud, pas de table remplie
 * depuis le disque. Le jour où l'un de ces trois apparaît, la promesse tombe.
 *
 * ── UN TYPE INCONNU N'EST PAS UNE ERREUR ────────────────────────────────────
 *
 * `resolveWidget` rend `null` sans rien jeter, et l'appelant DOIT conserver
 * l'emplacement dans le document. Un accueil rangé sur une version plus récente
 * puis rouvert sur une plus ancienne ne doit pas y perdre ses blocs : ils
 * s'affichent vides le temps de la mise à jour, et repartent intacts.
 *
 * ── SENS DES IMPORTS ────────────────────────────────────────────────────────
 *
 * Ce module importe les widgets ; AUCUN widget ne l'importe en retour à
 * l'exécution (ils ne prennent d'ici que des types, effacés à la compilation, et
 * leurs lecteurs de réglages viennent de `widgetOptions`). Le graphe reste donc
 * acyclique — un cycle ici rendrait `undefined` au premier rendu selon l'ordre
 * d'évaluation des modules, ce qui ne se voit ni à `tsc` ni en développement.
 */

import type React from 'react';

import { resolveConstraints } from '../grid/gridSolver';
import {
  GRID_SIZES,
  gridSize,
  type GridSize,
  type GridSizeConstraints,
  type GridSizeId,
} from '../grid/gridTypes';
import type { LayoutSlotRole } from '../../../services/layout/layoutTypes';
import type { RootState } from '../../../store';
import type { WidgetOptionSchema, WidgetProps } from './widgetOptions';
import { selectUnfiledNotes } from './homeSelectors';

import { GreetingWidget, GREETING_OPTIONS } from './widgets/GreetingWidget';
import { SearchLauncherWidget } from './widgets/SearchLauncherWidget';
import { ResumeWidget, RESUME_OPTIONS, isResumeEmpty } from './widgets/ResumeWidget';
import { PinsWidget, PINS_OPTIONS, isPinsEmpty } from './widgets/PinsWidget';
import {
  UpcomingRemindersWidget,
  UPCOMING_REMINDERS_OPTIONS,
  isUpcomingRemindersEmpty,
} from './widgets/UpcomingRemindersWidget';
import {
  PinnedNotesWidget,
  PINNED_NOTES_OPTIONS,
  isPinnedNotesEmpty,
} from './widgets/PinnedNotesWidget';
import {
  QuietSummaryWidget,
  QUIET_SUMMARY_OPTIONS,
  isQuietSummaryEmpty,
} from './widgets/QuietSummaryWidget';
import { StatTileWidget, STAT_TILE_OPTIONS } from './widgets/StatTileWidget';
import { BoardLauncherWidget } from './widgets/BoardLauncherWidget';
import { DashboardStatsWidget } from './widgets/DashboardStatsWidget';
import { StatCardsWidget } from './widgets/StatCardsWidget';
import { TypeDonutWidget, TYPE_DONUT_OPTIONS } from './widgets/TypeDonutWidget';
import { TopFoldersWidget, TOP_FOLDERS_OPTIONS } from './widgets/TopFoldersWidget';
import { UnfiledNotesWidget } from './widgets/UnfiledNotesWidget';
import {
  RecentNotesWidget,
  RECENT_NOTES_OPTIONS,
  isRecentNotesHidden,
} from './widgets/RecentNotesWidget';
import { SharedVaultsWidget, isSharedVaultsEmpty } from './widgets/SharedVaultsWidget';
import { SuggestedFoldersWidget, isSuggestedFoldersEmpty } from './widgets/SuggestedFoldersWidget';
import { FolderGridWidget, FOLDER_GRID_OPTIONS } from './widgets/FolderGridWidget';
import { StorageQuotaWidget, isStorageQuotaEmpty } from './widgets/StorageQuotaWidget';
import { DailyCalendarWidget } from './widgets/DailyCalendarWidget';
// -- LES VINGT BLOCS AJOUTES --
// Groupes par FAMILLE et non un fichier par bloc : ces vingt-la partagent une
// feuille de style (`blocks.css`) et une poignee de primitives (la ligne
// cliquable, l'extrait, le chiffre). Vingt fichiers auraient donne vingt
// definitions de « une ligne » qui auraient diverge au premier ajustement.
import {
  DIVIDER_OPTIONS,
  DividerWidget,
  HERO_OPTIONS,
  HeroWidget,
  SECTION_HEADING_OPTIONS,
  SectionHeadingWidget,
  SpacerWidget,
  TEXT_BLOCK_OPTIONS,
  TextBlockWidget,
} from './widgets/structureWidgets';
import {
  DAILY_NOTE_OPTIONS,
  DailyNoteWidget,
  NOTE_HUBS_OPTIONS,
  NOTE_SPOTLIGHT_OPTIONS,
  NoteHubsWidget,
  NoteSpotlightWidget,
  ORPHAN_NOTES_OPTIONS,
  OrphanNotesWidget,
  RANDOM_NOTE_OPTIONS,
  RandomNoteWidget,
} from './widgets/noteWidgets';
import {
  COLLECTIONS_OPTIONS,
  CollectionsWidget,
  FAVORITE_FILES_OPTIONS,
  FavoriteFilesWidget,
  RECENT_FILES_OPTIONS,
  RecentFilesWidget,
  TAG_CLOUD_OPTIONS,
  TRASH_PEEK_OPTIONS,
  TagCloudWidget,
  TrashPeekWidget,
} from './widgets/libraryWidgets';
import {
  ACTIVITY_OPTIONS,
  ActivityWidget,
  CLOCK_OPTIONS,
  ClockWidget,
  POMODORO_OPTIONS,
  PomodoroWidget,
  SYNC_STATUS_OPTIONS,
  SyncStatusWidget,
  VAULT_STATUS_OPTIONS,
  VaultStatusWidget,
  WRITING_OPTIONS,
  WritingStatsWidget,
} from './widgets/pulseWidgets';
// Les blocs CONTEXTUELS AU DOSSIER. Ils sont dans le MÊME registre que ceux de
// l'accueil, et ce n'est pas une commodité : une disposition ne transporte qu'une
// chaîne, et un second registre voudrait dire une seconde table de résolution —
// donc une seconde surface où un gabarit venu d'internet pourrait nommer quelque
// chose. Ils regardent le dossier COURANT (contexte) ou celui que leur attache
// désigne, ce qui les rend posables sur l'accueil aussi bien que dans un bandeau.
import {
  FolderActivityWidget,
  FolderMembersWidget,
  FolderPinnedWidget,
  FolderRecentsWidget,
  FolderStorageWidget,
  FolderTasksWidget,
} from '../folder/widgets/folderWidgets';

export type { WidgetProps, WidgetOptionField, WidgetOptionSchema } from './widgetOptions';
export { readBoolOption, readEnumOption, readTextOption } from './widgetOptions';

// ==================== Une entrée du registre ====================

/**
 * Ce qu'une entrée du registre ÉCRIT à la main. Ce n'est pas tout à fait ce que
 * les consommateurs lisent : voir `WidgetDefinition`, qui y ajoute ce qui se
 * DÉDUIT.
 */
interface WidgetDeclaration {
  /** Clé du registre. */
  readonly id: string;
  /**
   * Ce qui est ÉCRIT dans `LayoutSlot.type`, donc ce qui voyage sur le disque et
   * dans un gabarit publié. Égal à `id` par construction (l'assertion plus bas
   * le vérifie au chargement du module) : les deux restent distincts parce que
   * l'un est une clé de programme et l'autre une valeur de protocole, et qu'on
   * ne renomme pas la seconde sans migration.
   */
  readonly type: string;
  /**
   * Anciennes valeurs de `type` que ce widget continue de servir. Le seul
   * chemin de renommage qui ne casse pas les dispositions déjà écrites.
   */
  readonly aliases?: readonly string[];
  /** Rôle SYMBOLIQUE posé quand ce widget entre dans un gabarit. */
  readonly defaultRole: LayoutSlotRole;
  /** Clé i18n du nom du bloc — montré en édition et dans le menu d'options. */
  readonly titleKey: string;
  /**
   * Ce que ce bloc EXIGE de sa case — et rien de plus. Absent ⇒ librement
   * redimensionnable, de 1×1 aux douze colonnes.
   *
   * ── ON BORNE, ON N'ÉNUMÈRE PLUS ───────────────────────────────────────
   *
   * Un widget déclarait ici la LISTE FERMÉE des formats qu'il acceptait, et la
   * poignée de redimensionnement s'aimantait dessus. La doctrine se voulait une
   * protection ; à l'usage, elle a produit exactement trois pannes :
   *
   *   · « Tous les dossiers » n'acceptait que des formats larges de douze
   *     colonnes — sa largeur ne pouvait donc changer EN RIEN, et le geste
   *     paraissait cassé ;
   *   · la hauteur butait sur le plus grand format nommé (12×6), d'où un bloc
   *     qui « s'arrête au troisième niveau » ;
   *   · l'aimantation cherchait le format le plus proche dans le PLAN, donc
   *     tirer vers le bas pouvait sauter de 12×2 à 4×4 : le bloc changeait de
   *     largeur sous un geste vertical.
   *
   * Ce qui remplace : un PLANCHER, et un plafond seulement quand il se justifie
   * vraiment. Entre les deux, la géométrie appartient à l'utilisateur — n'importe
   * quelle largeur, n'importe quelle hauteur, case par case.
   *
   *   · PLANCHER (`minW`/`minH`) — en dessous, le contenu n'est plus lisible :
   *     une liste sans une seule ligne visible, une cible de dépôt réduite à un
   *     timbre-poste. C'est la seule justification recevable.
   *   · PLAFOND DE HAUTEUR (`maxH`) — réservé à DEUX familles. Les blocs d'UNE
   *     LIGNE ou d'UN CHIFFRE (salutation, tuile de statistique, résumé
   *     discret, lanceur) : les étirer ne montre rien de plus, ça fabrique du
   *     vide autour d'un mot. Et les blocs CONTEXTUELS AU DOSSIER : ils vivent
   *     dans le bandeau, AU-DESSUS du contenu du dossier, qu'ils pousseraient
   *     hors de l'écran.
   *   · AUCUN PLAFOND pour tout ce qui porte une LISTE (dossiers, notes,
   *     épingles, coffres, reprises, rappels) : chaque rangée gagnée est une
   *     ligne qu'on n'a plus à aller chercher. Un bloc de quinze rangées est une
   *     demande légitime, pas un bug.
   *
   * `maxW` ne se déclare quasiment jamais : refuser de la largeur à un bloc
   * n'aide personne, et les douze colonnes bornent déjà tout le monde.
   */
  readonly constraints?: GridSizeConstraints;
  /**
   * Format posé quand on ajoute ce widget à la main. Il DOIT tenir dans
   * `constraints` — vérifié au chargement du module, parce qu'un défaut hors
   * bornes donnerait un bloc que la poignée corrigerait au premier geste.
   */
  readonly defaultSize: GridSizeId;
  readonly Component: React.ComponentType<WidgetProps>;
  readonly optionsSchema?: WidgetOptionSchema;
  /**
   * Ce bloc n'a RIEN à montrer en ce moment.
   *
   * L'ancien accueil était une colonne de sections conditionnelles : sans coffre
   * partagé, la section n'existait pas et la suivante remontait. Une grille, elle,
   * garde la case — le bloc laisserait donc un trou de deux rangées chez tous
   * ceux qui n'ont pas de coffre.
   *
   * Ce prédicat rend la disparition possible SANS toucher au document : le bloc
   * est simplement retiré de ce qu'on donne à la grille, qui recompacte. Il
   * réapparaît à la seconde où il a de quoi s'afficher, et il reste TOUJOURS
   * visible en édition (sinon on ne pourrait ni le déplacer ni le retirer).
   *
   * C'est un sélecteur, pas un crochet : il est évalué pour tous les blocs en
   * une seule lecture du store, et il ne peut donc pas dépendre de l'ordre des
   * emplacements.
   */
  readonly isEmpty?: (state: RootState) => boolean;
  /**
   * Ce bloc n'est PLUS PROPOSÉ, mais reste SERVI.
   *
   * Le registre est clos : retirer une entrée ferait de chaque disposition qui
   * la porte (disque, gabarit publié, disposition synchronisée) une tuile
   * « inconnue » à l'import. Un bloc retiré garde donc son identifiant, que
   * `resolveWidget` et `knownCoreTypes` continuent de reconnaître — seule la
   * PALETTE le tait : proposer d'ajouter un bloc qui ne rend rien, c'est
   * promettre une fonction qu'on a supprimée.
   */
  readonly retired?: true;
}

/**
 * Une entrée telle qu'on la LIT. La déclaration, plus les raccourcis de taille
 * calculés une fois pour toutes au chargement du module.
 */
export interface WidgetDefinition extends WidgetDeclaration {
  /**
   * Les formats NOMMÉS proposés en un clic pour ce bloc — menu du bloc, prise
   * de format, inspecteur.
   *
   * DÉDUITS des contraintes, jamais listés à la main : deux déclarations pour
   * une seule idée finissent toujours par diverger, et celle qui aurait divergé
   * ici aurait proposé une taille que la poignée refuse — ou pire, caché une
   * taille parfaitement légale.
   *
   * Ce ne sont PAS les seules tailles possibles. La poignée pose n'importe
   * quelle géométrie entière entre les bornes ; ceci n'est qu'un jeu de
   * suggestions qu'on sait NOMMER.
   */
  readonly sizeShortcuts: readonly GridSizeId[];
}

/**
 * Ce format nommé tient-il dans les bornes de ce bloc ?
 *
 * `resolveConstraints` remet la déclaration en règle avant comparaison (absente,
 * partielle, à l'envers) : c'est la MÊME fonction que celle qui borne la
 * poignée, et c'est volontaire — un raccourci que le geste refuserait ensuite
 * serait un bouton qui ment.
 */
function fitsConstraints(size: GridSize, constraints?: GridSizeConstraints): boolean {
  const { minW, minH, maxW, maxH } = resolveConstraints(constraints);
  return size.w >= minW && size.w <= maxW && size.h >= minH && size.h <= maxH;
}

// ==================== Le catalogue ====================

/**
 * Les bornes des blocs contextuels au DOSSIER qui portent une liste.
 *
 * Écrites une seule fois : elles disent toutes la même chose pour la même
 * raison (le bandeau annonce la page, il ne la remplace pas), et six copies
 * auraient dérivé l'une après l'autre.
 */
const FOLDER_BAND_LIST: GridSizeConstraints = { minW: 3, minH: 2, maxH: 4 };

/**
 * LA table. Écrite à la main, dans l'ordre où on présente les blocs à
 * l'utilisateur : d'abord ce qui accueille, puis ce qui range, puis ce qui
 * compte. Les chiffres sont EN DERNIER et hors du modèle par défaut — on ne met
 * pas un tableau de bord sous le nez de quelqu'un qui n'en a pas demandé.
 */
const DECLARATIONS: readonly WidgetDeclaration[] = [
  {
    id: 'greeting',
    type: 'greeting',
    defaultRole: 'greeting',
    titleKey: 'home.widgets.greeting',
    // Une bannière d'accueil : un nom, une date longue. Plafond de hauteur
    // SERRÉ — une salutation de six rangées ne dit pas plus qu'une salutation
    // de deux, elle prend juste la place de ce qui suit.
    constraints: { minW: 4, minH: 1, maxH: 2 },
    defaultSize: 'full',
    Component: GreetingWidget,
    optionsSchema: GREETING_OPTIONS,
  },
  {
    id: 'search-launcher',
    type: 'search-launcher',
    defaultRole: 'search',
    titleKey: 'home.widgets.searchLauncher',
    // UNE LIGNE. Le modèle « Essentiel » l'écrit en 12×1, et c'est désormais
    // aussi ce que la poignée sait fabriquer : le plancher de hauteur est à une
    // rangée. Le plafond est à deux — un champ de recherche plus haut que ça
    // n'est plus un champ de recherche.
    constraints: { minW: 4, minH: 1, maxH: 2 },
    defaultSize: 'full',
    Component: SearchLauncherWidget,
  },
  {
    id: 'resume',
    type: 'resume',
    defaultRole: 'recents',
    titleKey: 'home.widgets.resume',
    // Une LISTE de reprises : plancher modeste, aucun plafond. Le bloc défile
    // déjà dans sa case, donc une rangée de plus est une reprise de plus à
    // portée d'œil.
    constraints: { minW: 3, minH: 2 },
    defaultSize: 'full',
    Component: ResumeWidget,
    optionsSchema: RESUME_OPTIONS,
    isEmpty: isResumeEmpty,
  },
  {
    id: 'pins',
    type: 'pins',
    defaultRole: 'favorites',
    titleKey: 'home.widgets.pins',
    // SANS PLAFOND : quatre épingles par rangée, autant de rangées qu'il y a
    // d'épingles. Chaque rangée gagnée est une rangée d'épingles qu'on n'a plus
    // à aller chercher.
    constraints: { minW: 3, minH: 2 },
    defaultSize: 'full',
    Component: PinsWidget,
    optionsSchema: PINS_OPTIONS,
    isEmpty: isPinsEmpty,
  },
  {
    id: 'folder-grid',
    type: 'folder-grid',
    defaultRole: 'folder-grid',
    titleKey: 'home.widgets.folderGrid',
    // LE BLOC QUI A MOTIVÉ CE CHANTIER. Il porte la liste complète des dossiers,
    // le glisser-déposer et le clic droit : sous six colonnes, les cartes n'ont
    // plus de place pour leur nom et la cible de dépôt devient un timbre-poste.
    // D'où un plancher de largeur HAUT — c'est une vraie contrainte, pas une
    // habitude.
    //
    // AUCUN plafond de hauteur, et c'est tout le sujet : l'ancienne liste
    // s'arrêtait à 12×6, donc le bloc « s'arrêtait au troisième niveau ». Il
    // s'allonge maintenant autant qu'on le tire, et la page défile.
    constraints: { minW: 6, minH: 2 },
    // 12×6 : EXACTEMENT ce que `seedLayoutDocument` pose. Un ajout à la main
    // doit donner le même bloc que l'amorçage, sinon le même widget n'a pas la
    // même tête selon qu'on l'a reçu ou choisi.
    defaultSize: 'page',
    Component: FolderGridWidget,
    optionsSchema: FOLDER_GRID_OPTIONS,
  },
  {
    id: 'suggested-folders',
    type: 'suggested-folders',
    defaultRole: 'favorites',
    titleKey: 'home.widgets.suggestedFolders',
    // Quatre cartes de dossier : une liste, donc pas de plafond — la fenêtre les
    // repasse à deux colonnes bien avant qu'on manque de place.
    constraints: { minW: 3, minH: 2 },
    defaultSize: 'full',
    Component: SuggestedFoldersWidget,
    isEmpty: isSuggestedFoldersEmpty,
  },
  {
    id: 'unfiled-notes',
    type: 'unfiled-notes',
    defaultRole: 'notes',
    titleKey: 'home.widgets.unfiledNotes',
    // Quatre cartes de note : une liste, plancher modeste, pas de plafond.
    constraints: { minW: 3, minH: 2 },
    defaultSize: 'full',
    Component: UnfiledNotesWidget,
    isEmpty: (state) => selectUnfiledNotes(state).length === 0,
  },
  {
    id: 'recent-notes',
    type: 'recent-notes',
    defaultRole: 'recents',
    titleKey: 'home.widgets.recentNotes',
    // Six cartes sur trois colonnes : DEUX rangées de cartes, que deux rangées
    // de grille tronquent déjà. Une liste, donc aucun plafond.
    constraints: { minW: 3, minH: 2 },
    defaultSize: 'full',
    Component: RecentNotesWidget,
    optionsSchema: RECENT_NOTES_OPTIONS,
    isEmpty: isRecentNotesHidden,
  },
  {
    id: 'pinned-notes',
    type: 'pinned-notes',
    defaultRole: 'notes',
    titleKey: 'home.widgets.pinnedNotes',
    // Six lignes épinglées : une liste, plancher modeste, pas de plafond.
    constraints: { minW: 3, minH: 2 },
    defaultSize: 'full',
    Component: PinnedNotesWidget,
    optionsSchema: PINNED_NOTES_OPTIONS,
    isEmpty: isPinnedNotesEmpty,
  },
  {
    id: 'upcoming-reminders',
    type: 'upcoming-reminders',
    defaultRole: 'tasks',
    titleKey: 'home.widgets.upcomingReminders',
    // Cinq rappels en lignes : une liste, plancher modeste, pas de plafond.
    constraints: { minW: 3, minH: 2 },
    defaultSize: 'wide',
    Component: UpcomingRemindersWidget,
    optionsSchema: UPCOMING_REMINDERS_OPTIONS,
    isEmpty: isUpcomingRemindersEmpty,
  },
  {
    id: 'quiet-summary',
    type: 'quiet-summary',
    defaultRole: 'summary',
    titleKey: 'home.widgets.quietSummary',
    // C'est une LIGNE. La largeur reste réglable à partir de la moitié de la
    // page — personne n'est lésé par un résumé plus étroit —, mais la hauteur
    // est tenue court : quatre rangées en feraient une carte, c'est-à-dire
    // exactement ce que ce bloc refuse d'être.
    constraints: { minW: 6, minH: 1, maxH: 2 },
    defaultSize: 'full',
    Component: QuietSummaryWidget,
    optionsSchema: QUIET_SUMMARY_OPTIONS,
    isEmpty: isQuietSummaryEmpty,
  },
  {
    id: 'board-launcher',
    type: 'board-launcher',
    defaultRole: 'quick-actions',
    titleKey: 'home.widgets.boardLauncher',
    // Un LANCEUR : une cible à cliquer, pas une surface à remplir. Hauteur tenue
    // court, largeur libre.
    constraints: { minW: 4, minH: 2, maxH: 3 },
    defaultSize: 'full',
    Component: BoardLauncherWidget,
  },
  {
    id: 'shared-vaults',
    type: 'shared-vaults',
    defaultRole: 'vaults',
    titleKey: 'home.widgets.sharedVaults',
    // RETIRÉ au profit de la grille mêlée (lot A, C6) : les coffres partagés
    // sont rendus parmi les dossiers de l'accueil, ce bloc les affichait une
    // seconde fois. L'identifiant reste ENREGISTRÉ — le registre est clos, et
    // des dispositions déjà écrites (disque, gabarits, synchronisées) portent
    // un emplacement `shared-vaults` que `resolveWidget` doit continuer de
    // servir. Le composant rend `null` et `isEmpty` est toujours vrai : la
    // grille recompacte la case hors édition, l'édition la laisse retirer. Les
    // contraintes sont gardées telles quelles pour ne recaler aucune disposition.
    // `retired` le tait dans la palette sans le retirer du registre.
    constraints: { minW: 3, minH: 2 },
    defaultSize: 'full',
    Component: SharedVaultsWidget,
    isEmpty: isSharedVaultsEmpty,
    retired: true,
  },
  {
    id: 'calendar',
    type: 'calendar',
    defaultRole: 'calendar',
    titleKey: 'home.widgets.calendar',
    // La journée en lignes : une liste, plancher modeste, pas de plafond.
    constraints: { minW: 3, minH: 2 },
    defaultSize: 'tall',
    Component: DailyCalendarWidget,
  },
  {
    id: 'storage-quota',
    type: 'storage-quota',
    defaultRole: 'storage',
    titleKey: 'home.widgets.storageQuota',
    // Une jauge et un chiffre : hauteur tenue court, largeur libre.
    constraints: { minW: 2, minH: 1, maxH: 2 },
    defaultSize: 'tile',
    Component: StorageQuotaWidget,
    isEmpty: isStorageQuotaEmpty,
  },
  {
    id: 'stat-tile',
    type: 'stat-tile',
    defaultRole: 'stats',
    titleKey: 'home.widgets.statTile',
    // Une valeur, un libellé : au-delà de deux rangées, la tuile devient une
    // carte vide autour d'un chiffre. La largeur, elle, ne gêne personne.
    constraints: { minW: 2, minH: 1, maxH: 2 },
    defaultSize: 'tile',
    Component: StatTileWidget,
    optionsSchema: STAT_TILE_OPTIONS,
  },
  {
    id: 'stat-cards',
    type: 'stat-cards',
    defaultRole: 'stats',
    titleKey: 'home.widgets.statCards',
    // Une rangée de chiffres : hauteur tenue court, largeur libre.
    constraints: { minW: 4, minH: 1, maxH: 2 },
    defaultSize: 'full',
    Component: StatCardsWidget,
  },
  {
    id: 'type-donut',
    type: 'type-donut',
    defaultRole: 'stats',
    titleKey: 'home.widgets.typeDonut',
    // Un disque et sa légende : il grandit proprement, donc aucun plafond.
    constraints: { minW: 3, minH: 2 },
    defaultSize: 'band',
    Component: TypeDonutWidget,
    optionsSchema: TYPE_DONUT_OPTIONS,
  },
  {
    id: 'top-folders',
    type: 'top-folders',
    defaultRole: 'stats',
    titleKey: 'home.widgets.topFolders',
    // Un classement, donc une liste : plancher modeste, pas de plafond.
    constraints: { minW: 3, minH: 2 },
    defaultSize: 'band',
    Component: TopFoldersWidget,
    optionsSchema: TOP_FOLDERS_OPTIONS,
  },
  {
    id: 'dashboard-stats',
    type: 'dashboard-stats',
    defaultRole: 'stats',
    titleKey: 'dashboard.title',
    // Le bandeau d'un seul tenant, avec son pli mémorisé : au-delà de quatre
    // rangées il ne fait que s'étirer.
    constraints: { minW: 6, minH: 2, maxH: 4 },
    defaultSize: 'full',
    // Le bandeau HISTORIQUE, d'un seul tenant, avec son pli mémorisé. Il n'est
    // pas là pour être choisi (les trois blocs fins au-dessus le remplacent
    // avantageusement) mais parce que l'amorçage des profils existants écrit ce
    // type-là : sans lui, un utilisateur qui avait ses chiffres les perdrait au
    // premier lancement de l'accueil modulaire.
    Component: DashboardStatsWidget,
  },

  // ── Les blocs contextuels au dossier ───────────────────────────────────
  //
  // EN FIN DE CATALOGUE, et c'est délibéré : la palette montre les six premiers
  // et replie le reste. Les poser plus haut ferait entrer six blocs qui parlent
  // d'« ici » dans la première vue d'une palette ouverte depuis l'accueil, où
  // « ici » ne désigne rien.
  //
  // Aucun `isEmpty` : ce prédicat ne reçoit que le store, or ces blocs
  // dépendent du dossier qu'on regarde, qui n'y est pas. Les faire disparaître
  // au jugé serait pire que de les laisser dire leur vide eux-mêmes.
  //
  // C'est la SEULE famille qui garde un plafond de hauteur alors qu'elle
  // porte des listes (`FOLDER_BAND_LIST`), et la raison est la même qu'au
  // premier jour : ces blocs vivent dans le BANDEAU d'un dossier, AU-DESSUS de
  // son contenu. Six rangées y pousseraient les fichiers du dossier hors de
  // l'écran — le bandeau n'est pas la page, il l'annonce.
  {
    id: 'folder-recents',
    type: 'folder-recents',
    defaultRole: 'recents',
    titleKey: 'folder.widgets.recents',
    constraints: FOLDER_BAND_LIST,
    defaultSize: 'band',
    Component: FolderRecentsWidget,
  },
  {
    id: 'folder-pinned',
    type: 'folder-pinned',
    defaultRole: 'favorites',
    titleKey: 'folder.widgets.pinned',
    constraints: FOLDER_BAND_LIST,
    defaultSize: 'band',
    Component: FolderPinnedWidget,
  },
  {
    id: 'folder-storage',
    type: 'folder-storage',
    defaultRole: 'storage',
    titleKey: 'folder.widgets.storage',
    // Une jauge : hauteur tenue court, comme son homologue de l'accueil.
    constraints: { minW: 2, minH: 1, maxH: 2 },
    defaultSize: 'tile',
    Component: FolderStorageWidget,
  },
  {
    id: 'folder-members',
    type: 'folder-members',
    defaultRole: 'members',
    titleKey: 'folder.widgets.members',
    constraints: FOLDER_BAND_LIST,
    defaultSize: 'square',
    Component: FolderMembersWidget,
  },
  {
    id: 'folder-tasks',
    type: 'folder-tasks',
    defaultRole: 'tasks',
    titleKey: 'folder.widgets.tasks',
    constraints: FOLDER_BAND_LIST,
    defaultSize: 'band',
    Component: FolderTasksWidget,
  },
  {
    id: 'folder-activity',
    type: 'folder-activity',
    defaultRole: 'activity',
    titleKey: 'folder.widgets.activity',
    constraints: FOLDER_BAND_LIST,
    defaultSize: 'band',
    Component: FolderActivityWidget,
  },
  // ============== LES BLOCS AJOUTÉS ==============
  //
  // ── AUCUN NE SE CACHE QUAND IL EST VIDE, ET C'EST DÉLIBÉRÉ ────────────────
  //
  // Les blocs historiques disparaissent quand ils n'ont rien à dire : la grille
  // recompacte, et un bandeau « Coffres partagés (0) » ne reste pas en travers
  // de l'accueil de quelqu'un qui n'en a aucun. C'était le bon choix à une
  // époque où l'état vide était une ligne grise de douze pixels — autant ne
  // rien montrer.
  //
  // Ces blocs-ci ont un vrai état vide : un cadre, un glyphe, une phrase qui
  // dit ce qui apparaîtra ici. Le cacher revient alors à trouer une composition
  // que quelqu'un a dessinée — et, sur un modèle qu'on vient d'installer, à
  // montrer une page à moitié absente à qui la découvre.
  //
  // Un bloc vide qui a l'air DÉLIBÉRÉMENT vide vaut mieux qu'un trou. Ils
  // restent donc, tous.
  //
  // Ils sont ajoutes EN FIN DE TABLE et non intercales par theme. L'ordre de
  // cette table est celui de la palette : intercaler aurait deplace sous les
  // doigts vingt-six blocs que les gens savent deja trouver, pour un gain de
  // rangement dont personne ne beneficie.

  // -- Structure : les blocs qui ne montrent aucune donnee --
  {
    id: 'section-heading',
    type: 'section-heading',
    defaultRole: 'summary',
    titleKey: 'home.widgets.sectionHeading',
    // UNE LIGNE, et ca ne se discute pas : un titre de section haut de quatre
    // rangees n'annonce rien de plus, il eloigne juste ce qu'il annonce.
    constraints: { minW: 2, minH: 1, maxH: 2 },
    defaultSize: 'full',
    Component: SectionHeadingWidget,
    optionsSchema: SECTION_HEADING_OPTIONS,
  },
  {
    id: 'divider',
    type: 'divider',
    defaultRole: 'summary',
    titleKey: 'home.widgets.divider',
    // ⚠ `maxH: 1` a fait LEVER le registre au chargement : aucun format nomme
    // ne fait douze colonnes sur UNE rangee (`full` vaut 12x2), donc le defaut
    // ne tenait pas dans ses propres bornes. Et comme ce module s'evalue au
    // demarrage, l'accueil entier plantait a l'ouverture — un defaut que `tsc`
    // et le build compilent sans un mot.
    //
    // Deux rangees, donc, et le trait reste centre dedans : un filet a qui on
    // veut donner un peu d'air est une demande legitime.
    constraints: { minW: 1, minH: 1, maxH: 2 },
    defaultSize: 'full',
    Component: DividerWidget,
    optionsSchema: DIVIDER_OPTIONS,
  },
  {
    id: 'spacer',
    type: 'spacer',
    defaultRole: 'summary',
    titleKey: 'home.widgets.spacer',
    // AUCUN plafond : un espace, c'est precisement ce dont on veut choisir la
    // taille. Le borner reviendrait a decider a la place de l'utilisateur de la
    // respiration de sa page.
    constraints: { minW: 1, minH: 1 },
    defaultSize: 'full',
    Component: SpacerWidget,
  },
  {
    id: 'text-block',
    type: 'text-block',
    defaultRole: 'summary',
    titleKey: 'home.widgets.textBlock',
    constraints: { minW: 2, minH: 1 },
    defaultSize: 'full',
    Component: TextBlockWidget,
    optionsSchema: TEXT_BLOCK_OPTIONS,
  },
  {
    id: 'hero',
    type: 'hero',
    defaultRole: 'greeting',
    titleKey: 'home.widgets.hero',
    constraints: { minW: 4, minH: 2, maxH: 6 },
    defaultSize: 'full',
    Component: HeroWidget,
    optionsSchema: HERO_OPTIONS,
  },

  // -- Notes : comment revient-on a ce qu'on a oublie ? --
  {
    id: 'random-note',
    type: 'random-note',
    defaultRole: 'notes',
    titleKey: 'home.widgets.randomNote',
    constraints: { minW: 3, minH: 2 },
    defaultSize: 'square',
    Component: RandomNoteWidget,
    optionsSchema: RANDOM_NOTE_OPTIONS,
  },
  {
    id: 'note-spotlight',
    type: 'note-spotlight',
    defaultRole: 'notes',
    titleKey: 'home.widgets.noteSpotlight',
    constraints: { minW: 3, minH: 2 },
    defaultSize: 'square',
    Component: NoteSpotlightWidget,
    optionsSchema: NOTE_SPOTLIGHT_OPTIONS,
    // PAS d'`isEmpty` : un bloc sans note choisie doit rester VISIBLE, sinon on
    // ne peut jamais lui en choisir une. Il dit ce qu'il attend.
  },
  {
    id: 'daily-note',
    type: 'daily-note',
    defaultRole: 'notes',
    titleKey: 'home.widgets.dailyNote',
    constraints: { minW: 3, minH: 2, maxH: 5 },
    defaultSize: 'square',
    Component: DailyNoteWidget,
    optionsSchema: DAILY_NOTE_OPTIONS,
  },
  {
    id: 'note-hubs',
    type: 'note-hubs',
    defaultRole: 'notes',
    titleKey: 'home.widgets.noteHubs',
    constraints: { minW: 3, minH: 2 },
    defaultSize: 'square',
    Component: NoteHubsWidget,
    optionsSchema: NOTE_HUBS_OPTIONS,
  },
  {
    id: 'orphan-notes',
    type: 'orphan-notes',
    defaultRole: 'notes',
    titleKey: 'home.widgets.orphanNotes',
    constraints: { minW: 3, minH: 2 },
    defaultSize: 'square',
    Component: OrphanNotesWidget,
    optionsSchema: ORPHAN_NOTES_OPTIONS,
    // PAS d'`isEmpty` : zero orpheline est un RESULTAT, pas une absence. Le
    // bloc dit « rien ne traine », et c'est l'information qu'on venait chercher.
  },

  // -- Bibliotheque : tags, collections, fichiers, corbeille --
  {
    id: 'tag-cloud',
    type: 'tag-cloud',
    defaultRole: 'summary',
    titleKey: 'home.widgets.tagCloud',
    constraints: { minW: 3, minH: 2 },
    defaultSize: 'square',
    Component: TagCloudWidget,
    optionsSchema: TAG_CLOUD_OPTIONS,
  },
  {
    id: 'collections',
    type: 'collections',
    defaultRole: 'favorites',
    titleKey: 'home.widgets.collections',
    constraints: { minW: 3, minH: 2 },
    defaultSize: 'square',
    Component: CollectionsWidget,
    optionsSchema: COLLECTIONS_OPTIONS,
  },
  {
    id: 'recent-files',
    type: 'recent-files',
    defaultRole: 'recents',
    titleKey: 'home.widgets.recentFiles',
    constraints: { minW: 3, minH: 2 },
    defaultSize: 'square',
    Component: RecentFilesWidget,
    optionsSchema: RECENT_FILES_OPTIONS,
  },
  {
    id: 'favorite-files',
    type: 'favorite-files',
    defaultRole: 'favorites',
    titleKey: 'home.widgets.favoriteFiles',
    constraints: { minW: 3, minH: 2 },
    defaultSize: 'square',
    Component: FavoriteFilesWidget,
    optionsSchema: FAVORITE_FILES_OPTIONS,
  },
  {
    id: 'trash-peek',
    type: 'trash-peek',
    defaultRole: 'recents',
    titleKey: 'home.widgets.trashPeek',
    constraints: { minW: 3, minH: 2 },
    defaultSize: 'square',
    Component: TrashPeekWidget,
    optionsSchema: TRASH_PEEK_OPTIONS,
  },

  // -- Le pouls : ce que l'application sait d'elle-meme --
  {
    id: 'activity',
    type: 'activity',
    defaultRole: 'stats',
    titleKey: 'home.widgets.activity',
    // Une carte d'activite sous quatre colonnes ecrase les cases sous la taille
    // du pixel : ce n'est plus un graphique, c'est un trait.
    constraints: { minW: 4, minH: 2, maxH: 6 },
    defaultSize: 'wide',
    Component: ActivityWidget,
    optionsSchema: ACTIVITY_OPTIONS,
  },
  {
    id: 'writing-stats',
    type: 'writing-stats',
    defaultRole: 'stats',
    titleKey: 'home.widgets.writingStats',
    constraints: { minW: 3, minH: 2, maxH: 4 },
    defaultSize: 'square',
    Component: WritingStatsWidget,
    optionsSchema: WRITING_OPTIONS,
  },
  {
    id: 'sync-status',
    type: 'sync-status',
    defaultRole: 'summary',
    titleKey: 'home.widgets.syncStatus',
    constraints: { minW: 3, minH: 2, maxH: 5 },
    defaultSize: 'square',
    Component: SyncStatusWidget,
    optionsSchema: SYNC_STATUS_OPTIONS,
    // AUCUN `isEmpty`, et c'est delibere : un bloc d'etat qui s'efface quand
    // tout va bien s'efface aussi la premiere fois qu'on aurait eu besoin de
    // lui, et son absence se lit alors comme « rien a signaler ».
  },
  {
    id: 'vault-status',
    type: 'vault-status',
    defaultRole: 'vaults',
    titleKey: 'home.widgets.vaultStatus',
    constraints: { minW: 3, minH: 2 },
    defaultSize: 'square',
    Component: VaultStatusWidget,
    optionsSchema: VAULT_STATUS_OPTIONS,
  },
  {
    id: 'clock',
    type: 'clock',
    defaultRole: 'greeting',
    titleKey: 'home.widgets.clock',
    // Un chiffre : hauteur tenue court, comme la salutation et les tuiles.
    constraints: { minW: 2, minH: 1, maxH: 3 },
    defaultSize: 'square',
    Component: ClockWidget,
    optionsSchema: CLOCK_OPTIONS,
  },
  /**
   * LE MINUTEUR — le seul bloc que le TÉLÉPHONE avait et pas l'ordinateur.
   *
   * Le minuteur du bureau n'était qu'une fenêtre flottante ; le mobile en a
   * fait un bloc d'accueil (`widgetCatalog.ts`, inscrit dans
   * `MOBILE_ONLY_WIDGET_TYPES`). Une disposition rangée là-bas s'ouvrait donc
   * ici avec un emplacement « indisponible dans cette version ».
   *
   * L'IDENTIFIANT, LES BORNES ET LE RÔLE SONT CEUX DU MOBILE, au caractère
   * près : c'est la condition pour qu'une disposition traverse. Un identifiant
   * différent aurait fait deux blocs jumeaux qui ne se reconnaissent pas.
   */
  {
    id: 'pomodoro',
    type: 'pomodoro',
    defaultRole: 'quick-actions',
    titleKey: 'home.widgets.pomodoro',
    // Un chiffre et une ligne : mêmes bornes que l'horloge, dont il est
    // visuellement le frère.
    constraints: { minW: 3, minH: 1, maxH: 3 },
    defaultSize: 'square',
    Component: PomodoroWidget,
    optionsSchema: POMODORO_OPTIONS,
  },
];

// ==================== Résolution ====================

/**
 * LA table telle qu'on la lit : chaque déclaration, plus ses raccourcis.
 *
 * Le calcul est fait UNE fois, au chargement du module, et pas à chaque rendu de
 * panneau : la liste ne dépend que de constantes de programme, et une fonction
 * appelée par le rendu aurait rendu un tableau neuf à chaque fois — donc une
 * mémoïsation cassée chez tous ceux qui la reçoivent en dépendance.
 */
const CATALOG: readonly WidgetDefinition[] = DECLARATIONS.map((def) => ({
  ...def,
  sizeShortcuts: GRID_SIZES.filter((size) => fitsConstraints(size, def.constraints)).map(
    (size) => size.id
  ),
}));

const BY_TYPE: ReadonlyMap<string, WidgetDefinition> = (() => {
  const map = new Map<string, WidgetDefinition>();
  for (const def of CATALOG) {
    // Le contrat `id === type` n'est pas décoratif : une moitié du code indexe
    // par `id`, l'autre lit `LayoutSlot.type`. Les laisser diverger ferait
    // disparaître un widget d'un seul côté, sans aucun message.
    if (def.id !== def.type) {
      throw new Error(`widgetRegistry : « ${def.id} » et « ${def.type} » doivent être identiques`);
    }
    if (map.has(def.type)) {
      throw new Error(`widgetRegistry : type dupliqué « ${def.type} »`);
    }
    // Le défaut DOIT tenir dans les bornes. Un défaut hors bornes poserait un
    // bloc que la première prise de poignée corrigerait sous les yeux de
    // l'utilisateur, sans que rien n'explique le saut.
    if (!fitsConstraints(gridSize(def.defaultSize), def.constraints)) {
      throw new Error(
        `widgetRegistry : le format par défaut « ${def.defaultSize} » de « ${def.id} » ne tient pas dans ses contraintes`
      );
    }
    map.set(def.type, def);
    for (const alias of def.aliases ?? []) {
      if (map.has(alias)) {
        throw new Error(`widgetRegistry : alias en conflit « ${alias} »`);
      }
      map.set(alias, def);
    }
  }
  return map;
})();

/** Le catalogue, dans l'ordre de présentation. */
export function listWidgets(): readonly WidgetDefinition[] {
  return CATALOG;
}

/**
 * Le widget d'un type, ou `null` s'il n'existe pas dans CE binaire.
 *
 * Rend `null` — ne lève pas, et ne se rabat sur AUCUN widget de secours :
 * afficher autre chose que ce que la disposition demande serait mentir sur son
 * contenu, et un widget de secours qui lirait des `options` prévues pour un
 * autre bloc est exactement le genre de chose qu'un gabarit hostile chercherait.
 */
export function resolveWidget(type: string | undefined | null): WidgetDefinition | null {
  if (!type) return null;
  return BY_TYPE.get(type) ?? null;
}
