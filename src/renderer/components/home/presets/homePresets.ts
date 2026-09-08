/**
 * Accueil modulaire — LES TROIS MODÈLES PRÊTS À L'EMPLOI.
 *
 * ── POURQUOI TROIS, ET PAS UN RÉGLAGE ───────────────────────────────────────
 *
 * « Personnalisez votre accueil » est une promesse que presque personne ne tient
 * : il faut savoir ce qu'on veut, connaître les blocs, et accepter de passer dix
 * minutes à ranger une page qu'on regarde trois secondes par jour. Trois
 * dispositions ENTIÈRES, choisies en un clic, transforment ce travail en
 * décision — et laissent la personnalisation fine à ceux qui la veulent.
 *
 * Les trois ne sont pas trois goûts : ce sont trois RAPPORTS À SES DONNÉES.
 *
 *   · ESSENTIEL — LA BASE, et le défaut d'installation : ce que le coffre
 *     contient, ce qu'on y faisait, la grille des dossiers. Trois rangées, et
 *     on est au travail.
 *   · TABLEAU DE BORD — la grille dense, pour qui veut voir l'état de son coffre
 *     d'un regard. Des chiffres, mais tenus par des règles de cohérence (voir
 *     plus bas) : sans elles, un tableau de bord devient un sapin de Noël.
 *   · ATELIER — l'accueil de qui pense en surface plutôt qu'en liste : un pas
 *     vers le tableau, et le strict minimum autour.
 *
 * ── CE FICHIER NE CONTIENT QUE DES GABARITS ─────────────────────────────────
 *
 * Un `LayoutTemplate` ne cite AUCUN identifiant local (voir `layoutTypes`) : il
 * porte des rôles symboliques, des types de widgets, une géométrie et des
 * réglages. C'est ce qui le rend publiable, installable, et — ici — écrivable en
 * dur dans le binaire sans que rien ne dépende du coffre de qui que ce soit.
 *
 * ⚠ L'HORLOGE EST FIXE (l'époque). Ces gabarits sont du CODE, pas des données :
 * une horloge vivante les ferait gagner l'arbitrage de fusion contre un gabarit
 * que l'utilisateur a réellement modifié sur un autre appareil.
 *
 * ── GÉOMÉTRIE HORS CATALOGUE : C'EST VOULU, ET C'EST LA NORME ─────────────
 *
 * Certains emplacements (4×3, 12×3, 12×1) ne correspondent à aucun des huit
 * formats NOMMÉS de `gridTypes`, et ils n'ont jamais eu à le faire : une
 * disposition décrit un rectangle, pas un format. `sizeIdOf` rend simplement
 * `null` plutôt que de mentir sur un nom.
 *
 * Ce qui a changé : le catalogue ne borne plus non plus ce que l'utilisateur
 * FABRIQUE à la main. La poignée pose n'importe quelle géométrie entière entre
 * les bornes de son bloc (`constraints`, dans `widgetRegistry`), donc ces
 * gabarits ne décrivent plus rien d'exceptionnel — juste des tailles qu'on ne
 * sait pas NOMMER, comme la plupart de celles qu'on obtient à la souris.
 *
 * Une seule règle tient encore : chaque emplacement écrit ici doit respecter les
 * bornes de son widget, sinon le premier geste sur ce bloc le corrigerait sous
 * les yeux de son utilisateur. Les vingt emplacements des trois modèles les
 * respectent, et aucune migration de données n'a été nécessaire pour ça.
 */

import type { LayoutTemplate } from '../../../../services/layout/layoutTypes';

/** Horloge des gabarits de code — voir l'avertissement en tête de fichier. */
const CODE_CLOCK = '1970-01-01T00:00:00.000Z';

// ==================== Identité des modèles ====================

export const ESSENTIAL_TEMPLATE_ID = 'filarr.essential';
export const DASHBOARD_TEMPLATE_ID = 'filarr.dashboard';
export const WORKSHOP_TEMPLATE_ID = 'filarr.workshop';
export const JOURNAL_TEMPLATE_ID = 'filarr.journal';
export const LIBRARY_TEMPLATE_ID = 'filarr.library';
export const GARDEN_TEMPLATE_ID = 'filarr.garden';
export const CALM_TEMPLATE_ID = 'filarr.calm';

/**
 * Un modèle tel qu'on le PRÉSENTE : le gabarit, plus la phrase qui dit à qui il
 * s'adresse. La phrase ne voyage pas dans le document (elle est ici, en clé
 * i18n) — un gabarit publié n'emporte que son nom.
 */
export interface HomePreset {
  readonly id: string;
  readonly template: LayoutTemplate;
  /** Clé i18n d'une ligne : à qui ce modèle s'adresse. */
  readonly descriptionKey: string;
}

// ==================== 1. Essentiel ====================

/**
 * LE DÉFAUT D'INSTALLATION — LA BASE.
 *
 * Trois rangées, lues de haut en bas : ce que le coffre CONTIENT (quatre
 * chiffres, une seule graisse), ce qu'on y FAISAIT (répartition par type,
 * reprise, notes récentes), puis ce qu'on y OUVRE (la grille complète des
 * dossiers, pleine largeur, qui est le geste réel de l'accueil).
 *
 * ── CE QUI A CHANGÉ, ET POURQUOI ────────────────────────────────────────────
 *
 * Ce modèle était une colonne SANS AUCUN CHIFFRE (salutation, champ de
 * recherche, reprise, épingles, ligne de pied). Il porte désormais la
 * disposition « Home — Base » construite à la main puis adoptée comme base :
 * quatre tuiles, une rangée de trois blocs, la grille des dossiers.
 *
 * Deux blocs ont donc DISPARU du défaut : la salutation et le champ de
 * recherche. Le champ n'était qu'une porte vers la palette de commandes, qui
 * reste ouverte au clavier partout dans l'application — ce n'est pas une
 * fonction qu'on perd, c'est un raccourci qu'on ne montre plus.
 *
 * ⚠ Ce modèle est désormais TRÈS PROCHE de « Tableau de bord », qui garde en
 * propre le calendrier, les rappels et une rangée de plus. C'est assumé : la
 * base montre l'état du coffre, le tableau de bord montre l'agenda.
 *
 * Les blocs s'effacent tout seuls quand ils n'ont rien à dire (`isEmpty` du
 * registre) : sur un profil neuf, il ne reste que ce qui a quelque chose à
 * montrer.
 *
 * ── LES RÈGLES DE COHÉRENCE S'APPLIQUENT ICI AUSSI ──────────────────────────
 *
 * Voir « Tableau de bord » plus bas : une seule couleur d'accent, une seule
 * graisse pour les valeurs, aucune ombre au-delà de `--shadow-sm`. Le donut est
 * le seul bloc multicolore, et ses couleurs sont des CATÉGORIES.
 */
export const ESSENTIAL_TEMPLATE: LayoutTemplate = {
  id: ESSENTIAL_TEMPLATE_ID,
  name: 'Essentiel',
  updatedAt: CODE_CLOCK,
  version: 3,
  author: 'Filarr',
  slots: [
    // Rangée 1 — quatre tuiles, un chiffre chacune, la même graisse pour les
    // quatre (même raison que dans « Tableau de bord » : un seul widget à
    // réglage `metric`, pas quatre composants à quatre typographies).
    { role: 'stats', type: 'stat-tile', x: 0, y: 0, w: 3, h: 1, options: { metric: 'files' } },
    { role: 'stats', type: 'stat-tile', x: 3, y: 0, w: 3, h: 1, options: { metric: 'folders' } },
    { role: 'stats', type: 'stat-tile', x: 6, y: 0, w: 3, h: 1, options: { metric: 'storage' } },
    { role: 'stats', type: 'stat-tile', x: 9, y: 0, w: 3, h: 1, options: { metric: 'notes' } },
    // Rangée 2 — un quart, un quart, une moitié. Les douze colonnes sont
    // pleines : un trou ici ferait remonter la grille des dossiers au premier
    // geste du solveur.
    { role: 'stats', type: 'type-donut', x: 0, y: 1, w: 3, h: 2 },
    { role: 'recents', type: 'resume', x: 3, y: 1, w: 3, h: 2, options: { frame: 'card' } },
    { role: 'notes', type: 'recent-notes', x: 6, y: 1, w: 6, h: 2 },
    // Rangée 3 — la liste complète des dossiers, pleine largeur.
    {
      role: 'folder-grid',
      type: 'folder-grid',
      x: 0,
      y: 3,
      w: 12,
      h: 4,
      options: { viewMode: 'grid' },
    },
  ],
};

// ==================== 2. Tableau de bord ====================

/**
 * LA GRILLE DENSE.
 *
 * ── LES RÈGLES DE COHÉRENCE, QUI NE SE NÉGOCIENT PAS ────────────────────────
 *
 * Un tableau de bord se dégrade toujours de la même façon : chaque bloc arrive
 * avec sa couleur, sa graisse et son ombre, et la page finit par ne plus rien
 * hiérarchiser du tout. Les blocs posés ici respectent donc, TOUS :
 *
 *   · une seule couleur d'accent sur la page (`--color-primary-*`) ;
 *   · toute valeur numérique dans la même graisse et la même taille ;
 *   · tout libellé en petites majuscules espacées ;
 *   · aucune ombre plus forte que `--shadow-sm` ;
 *   · aucune bordure colorée, aucun dégradé.
 *
 * Le seul bloc multicolore de la composition est « Répartition par type » : ses
 * couleurs sont des CATÉGORIES, pas des accents — elles disent quel type de
 * fichier, elles ne cherchent pas l'œil.
 */
export const DASHBOARD_TEMPLATE: LayoutTemplate = {
  id: DASHBOARD_TEMPLATE_ID,
  name: 'Tableau de bord',
  updatedAt: CODE_CLOCK,
  version: 1,
  author: 'Filarr',
  slots: [
    // Rangée 1 — quatre tuiles, un chiffre chacune, la même graisse pour les
    // quatre. Un seul widget avec un réglage `metric` : quatre composants
    // différents auraient fini avec quatre typographies différentes.
    { role: 'stats', type: 'stat-tile', x: 0, y: 0, w: 3, h: 1, options: { metric: 'files' } },
    { role: 'stats', type: 'stat-tile', x: 3, y: 0, w: 3, h: 1, options: { metric: 'folders' } },
    { role: 'stats', type: 'stat-tile', x: 6, y: 0, w: 3, h: 1, options: { metric: 'storage' } },
    { role: 'stats', type: 'stat-tile', x: 9, y: 0, w: 3, h: 1, options: { metric: 'notes' } },
    // Rangée 2 — trois colonnes égales.
    { role: 'stats', type: 'type-donut', x: 0, y: 1, w: 4, h: 3 },
    { role: 'recents', type: 'resume', x: 4, y: 1, w: 4, h: 3, options: { frame: 'card' } },
    {
      role: 'tasks',
      type: 'upcoming-reminders',
      x: 8,
      y: 1,
      w: 4,
      h: 3,
      options: { frame: 'card' },
    },
    // Rangée 3 — deux moitiés.
    { role: 'calendar', type: 'calendar', x: 0, y: 4, w: 6, h: 3 },
    { role: 'notes', type: 'recent-notes', x: 6, y: 4, w: 6, h: 3 },
    // Rangée 4 — la liste complète des dossiers, pleine largeur.
    { role: 'folder-grid', type: 'folder-grid', x: 0, y: 7, w: 12, h: 3 },
  ],
};

// ==================== 3. Atelier ====================

/**
 * L'ACCUEIL DE QUI PENSE EN SURFACE.
 *
 * ── L'ÉCART, DIT FRANCHEMENT ────────────────────────────────────────────────
 *
 * La conception visait le canevas spatial (`StickyNotesView`, mode `all`) monté
 * DANS l'accueil, avec des objets qui ne seraient plus seulement des notes mais
 * aussi des raccourcis de dossier, des fichiers et des widgets miniatures.
 *
 * Ce n'est PAS ce qui est livré ici, et le demi-canevas n'a pas été livré non
 * plus. Le canevas porte son propre système de coordonnées, son propre zoom, sa
 * propre gestion du glissement et sa propre minimap : le poser dans une case de
 * grille redimensionnable, elle-même déplaçable au glisser-déposer, ferait deux
 * moteurs de gestes qui se disputent le même pointeur — exactement le genre de
 * chose qui « marche » en démonstration et devient inutilisable au quotidien.
 * Et les objets non-notes n'existent pas dans le modèle du tableau : les
 * inventer était un chantier à part entière, pas une variante de mise en page.
 *
 * Ce modèle est donc une BASCULE assumée : un accueil minimal dont le bloc
 * principal ouvre l'Atelier (`/board`), qui est déjà le canevas complet, à sa
 * taille, avec tous ses gestes. Quand les objets non-notes existeront, ce
 * gabarit deviendra le point d'entrée naturel du canevas en accueil.
 */
export const WORKSHOP_TEMPLATE: LayoutTemplate = {
  id: WORKSHOP_TEMPLATE_ID,
  name: 'Atelier',
  updatedAt: CODE_CLOCK,
  version: 1,
  author: 'Filarr',
  slots: [
    { role: 'greeting', type: 'greeting', x: 0, y: 0, w: 12, h: 2, options: { style: 'live' } },
    { role: 'quick-actions', type: 'board-launcher', x: 0, y: 2, w: 12, h: 2 },
    { role: 'search', type: 'search-launcher', x: 0, y: 4, w: 12, h: 1 },
    { role: 'notes', type: 'pinned-notes', x: 0, y: 5, w: 12, h: 3, options: { frame: 'column' } },
  ],
};

// ==================== Le catalogue ====================

// ==================== 4. Le journal ====================

/**
 * ÉCRIRE, ET VOIR QU'ON A ÉCRIT.
 *
 * Une disposition pour qui tient un journal. Elle répond à deux questions et
 * pas une de plus : « qu'est-ce que j'écris aujourd'hui » et « est-ce que je
 * tiens le rythme ».
 *
 * La carte d'activité est en pleine largeur À DESSEIN : c'est le seul bloc de
 * l'accueil qui montre une HABITUDE plutôt qu'un état, et une habitude ne se
 * lit pas dans un carré de trois colonnes.
 */
export const JOURNAL_TEMPLATE: LayoutTemplate = {
  id: JOURNAL_TEMPLATE_ID,
  name: 'Le journal',
  updatedAt: CODE_CLOCK,
  version: 1,
  author: 'Filarr',
  slots: [
    {
      role: 'greeting',
      type: 'clock',
      x: 0,
      y: 0,
      w: 3,
      h: 2,
      options: { mode: 'both', frame: 'plain' },
    },
    { role: 'notes', type: 'daily-note', x: 3, y: 0, w: 9, h: 2, options: { frame: 'accent' } },
    {
      role: 'summary',
      type: 'section-heading',
      x: 0,
      y: 2,
      w: 12,
      h: 1,
      options: { label: 'Le rythme', size: 'medium' },
    },
    { role: 'stats', type: 'activity', x: 0, y: 3, w: 8, h: 3, options: { span: 'quarter' } },
    { role: 'stats', type: 'writing-stats', x: 8, y: 3, w: 4, h: 3 },
    {
      role: 'summary',
      type: 'section-heading',
      x: 0,
      y: 6,
      w: 12,
      h: 1,
      options: { label: 'Dernières notes', size: 'medium' },
    },
    { role: 'notes', type: 'recent-notes', x: 0, y: 7, w: 12, h: 3, options: { layout: 'list' } },
  ],
};

// ==================== 5. Le classeur ====================

/**
 * LES FICHIERS D'ABORD.
 *
 * L'accueil savait compter les fichiers et ne savait pas en atteindre un. Cette
 * disposition est celle qui répare ça : trois chemins vers un fichier
 * (récents, favoris, dossiers) et la corbeille, qui est un chemin aussi — le
 * plus urgent des quatre quand on vient de supprimer la mauvaise chose.
 */
export const LIBRARY_TEMPLATE: LayoutTemplate = {
  id: LIBRARY_TEMPLATE_ID,
  name: 'Le classeur',
  updatedAt: CODE_CLOCK,
  version: 1,
  author: 'Filarr',
  slots: [
    {
      role: 'stats',
      type: 'stat-tile',
      x: 0,
      y: 0,
      w: 3,
      h: 1,
      options: { metric: 'files', tone: 'accent' },
    },
    {
      role: 'stats',
      type: 'stat-tile',
      x: 3,
      y: 0,
      w: 3,
      h: 1,
      options: { metric: 'folders', tone: 'outline' },
    },
    {
      role: 'stats',
      type: 'stat-tile',
      x: 6,
      y: 0,
      w: 3,
      h: 1,
      options: { metric: 'storage', tone: 'outline' },
    },
    {
      role: 'stats',
      type: 'stat-tile',
      x: 9,
      y: 0,
      w: 3,
      h: 1,
      options: { metric: 'notes', tone: 'outline' },
    },
    { role: 'recents', type: 'recent-files', x: 0, y: 1, w: 4, h: 3 },
    { role: 'favorites', type: 'favorite-files', x: 4, y: 1, w: 4, h: 3 },
    { role: 'stats', type: 'top-folders', x: 8, y: 1, w: 4, h: 3, options: { shape: 'list' } },
    {
      role: 'folder-grid',
      type: 'folder-grid',
      x: 0,
      y: 4,
      w: 9,
      h: 4,
      options: { viewMode: 'grid' },
    },
    { role: 'recents', type: 'trash-peek', x: 9, y: 4, w: 3, h: 4 },
  ],
};

// ==================== 6. Le jardin ====================

/**
 * REVENIR À CE QU'ON A OUBLIÉ.
 *
 * La disposition la plus opposée à un tableau de bord : aucun compteur, aucun
 * graphique. Elle ne montre que des CHEMINS DE RETOUR vers ce qui a été écrit —
 * le hasard, les carrefours, les orphelines, les tags.
 *
 * Les orphelines sont posées en accent, seules de la page. C'est le bloc le
 * plus désagréable et le plus utile : il montre exactement ce qu'on a laissé
 * tomber, et il ne sert à rien s'il se fond dans le décor.
 */
export const GARDEN_TEMPLATE: LayoutTemplate = {
  id: GARDEN_TEMPLATE_ID,
  name: 'Le jardin',
  updatedAt: CODE_CLOCK,
  version: 1,
  author: 'Filarr',
  slots: [
    {
      role: 'summary',
      type: 'section-heading',
      x: 0,
      y: 0,
      w: 12,
      h: 1,
      options: { label: 'Au hasard', size: 'large', rule: false },
    },
    { role: 'notes', type: 'random-note', x: 0, y: 1, w: 7, h: 3, options: { frame: 'plain' } },
    {
      role: 'summary',
      type: 'tag-cloud',
      x: 7,
      y: 1,
      w: 5,
      h: 3,
      options: { frame: 'outline', shape: 'cloud' },
    },
    { role: 'summary', type: 'divider', x: 0, y: 4, w: 12, h: 1, options: { style: 'gradient' } },
    {
      role: 'notes',
      type: 'orphan-notes',
      x: 0,
      y: 5,
      w: 6,
      h: 4,
      options: { frame: 'accent', scope: 'isolated' },
    },
    { role: 'notes', type: 'note-hubs', x: 6, y: 5, w: 6, h: 4, options: { frame: 'outline' } },
  ],
};

// ==================== 7. Au calme ====================

/**
 * PRESQUE RIEN.
 *
 * L'heure, une intention qu'on écrit soi-même, ce qu'on était en train de
 * faire. Rien d'autre.
 *
 * C'est la disposition qui justifie à elle seule les blocs de STRUCTURE : sans
 * l'espace, le filet et le bloc de texte, « presque rien » ne serait pas
 * composable — on ne saurait qu'empiler des boîtes pleines, et une page calme
 * faite de boîtes pleines n'est pas une page calme.
 */
export const CALM_TEMPLATE: LayoutTemplate = {
  id: CALM_TEMPLATE_ID,
  name: 'Au calme',
  updatedAt: CODE_CLOCK,
  version: 1,
  author: 'Filarr',
  slots: [
    { role: 'summary', type: 'spacer', x: 0, y: 0, w: 12, h: 1 },
    {
      role: 'greeting',
      type: 'clock',
      x: 3,
      y: 1,
      w: 6,
      h: 2,
      options: { mode: 'both', frame: 'plain' },
    },
    {
      role: 'summary',
      type: 'text-block',
      x: 3,
      y: 3,
      w: 6,
      h: 2,
      options: { size: 'quote', align: 'center', body: '' },
    },
    { role: 'summary', type: 'divider', x: 4, y: 5, w: 4, h: 1, options: { style: 'dots' } },
    { role: 'recents', type: 'resume', x: 3, y: 6, w: 6, h: 3, options: { frame: 'plain' } },
    { role: 'summary', type: 'quiet-summary', x: 3, y: 9, w: 6, h: 1, options: { tone: 'quiet' } },
  ],
};

/**
 * Les SEPT, dans l'ordre où on les présente. « Essentiel » d'abord : c'est le
 * défaut, donc le retour en arrière — celui qu'on doit trouver en premier quand
 * une session de rangement a mal tourné.
 */
export const HOME_PRESETS: readonly HomePreset[] = [
  {
    id: ESSENTIAL_TEMPLATE_ID,
    template: ESSENTIAL_TEMPLATE,
    descriptionKey: 'home.presets.essential.description',
  },
  {
    id: DASHBOARD_TEMPLATE_ID,
    template: DASHBOARD_TEMPLATE,
    descriptionKey: 'home.presets.dashboard.description',
  },
  {
    id: WORKSHOP_TEMPLATE_ID,
    template: WORKSHOP_TEMPLATE,
    descriptionKey: 'home.presets.workshop.description',
  },
  {
    id: JOURNAL_TEMPLATE_ID,
    template: JOURNAL_TEMPLATE,
    descriptionKey: 'home.presets.journal.description',
  },
  {
    id: LIBRARY_TEMPLATE_ID,
    template: LIBRARY_TEMPLATE,
    descriptionKey: 'home.presets.library.description',
  },
  {
    id: GARDEN_TEMPLATE_ID,
    template: GARDEN_TEMPLATE,
    descriptionKey: 'home.presets.garden.description',
  },
  {
    id: CALM_TEMPLATE_ID,
    template: CALM_TEMPLATE,
    descriptionKey: 'home.presets.calm.description',
  },
];

/** Le modèle d'un identifiant, ou `null` — jamais de repli silencieux. */
export function findPreset(id: string | undefined | null): HomePreset | null {
  if (!id) return null;
  return HOME_PRESETS.find((preset) => preset.id === id) ?? null;
}

/**
 * Identité d'un emplacement fabriqué en posant un modèle.
 *
 * Le compteur n'est pas décoratif : instancier un gabarit crée jusqu'à dix
 * emplacements dans la MÊME milliseconde, et `Date.now()` seul leur donnerait
 * dix fois le même identifiant — dix blocs que la grille traiterait comme un.
 */
let presetSlotCounter = 0;
export function newPresetSlotId(): string {
  presetSlotCounter += 1;
  return `slot-${Date.now().toString(36)}-${presetSlotCounter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}
