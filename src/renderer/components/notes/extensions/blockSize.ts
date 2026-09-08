/**
 * Taille d'un bloc — LOGIQUE PURE.
 *
 * POURQUOI CE MODULE. Un seul bloc de la note savait se redimensionner :
 * l'image (`fileEmbed`). Tout le reste — base inline et son kanban, schéma
 * mermaid, calendrier, requête, embed, transclusion — prenait la place qu'il
 * voulait, sans recours.
 *
 * ON COPIE L'IMAGE POUR LE GESTE. Même poignée au coin bas-droit, même unité
 * (le PIXEL), mêmes bords fixes (haut et gauche : le bloc grandit vers la
 * droite et vers le bas, le pixel parcouru par la souris est le pixel gagné par
 * le bloc). Une tentative précédente réglait la largeur en POURCENTAGE avec des
 * poignées flottantes des deux côtés, et la hauteur par des paliers dans un
 * menu : deux gestes différents pour une seule intention, dont aucun ne
 * montrait son résultat pendant qu'on le réglait.
 *
 * LA HAUTEUR VA DANS LES DEUX SENS, et il a fallu s'y reprendre à deux fois.
 * Une version intermédiaire la plafonnait à la hauteur NATURELLE du bloc, au nom
 * de « on ne peut pas créer de vide ». Résultat : tirer la poignée vers le bas
 * ne produisait STRICTEMENT RIEN — le seul sens qui agissait était le
 * rétrécissement, et un réglage dont la moitié des gestes ne répond pas se lit,
 * à juste titre, comme un réglage cassé. Une contrainte qu'on s'impose au nom du
 * bon goût ne vaut pas une poignée qui répond à la main.
 *
 * LE POINT DE REPÈRE RESTE LA HAUTEUR NATURELLE, mais comme AIMANT et non comme
 * plafond : passer à moins de `BLOCK_SNAP_TOLERANCE` d'elle écrit `null`,
 * c'est-à-dire « libre ». C'est ce qui garde « revenir comme avant » atteignable
 * à la souris, dans un sens comme dans l'autre.
 *
 * BORNER SERT À DEUX CHOSES, SYMÉTRIQUES. Vers le haut : un kanban de trente
 * cartes, une base de deux cents lignes poussent tout le reste de la note hors
 * de l'écran ; bornés, ils défilent CHEZ EUX. Vers le bas : un plateau presque
 * vide qu'on veut haut pour y déposer des cartes. Le bloc étant une colonne
 * flex, la place gagnée va à la vue active — elle s'étire, elle ne laisse pas un
 * blanc à côté d'elle.
 *
 * CE QUI N'EST PAS ICI : le rendu (CSS), la pose de l'attribut (l'extension
 * TipTap), la poignée (le composant React). Ce fichier ne connaît que des
 * nombres — c'est ce qui le rend testable sans éditeur.
 */

/** En deçà, plus rien n'est lisible : un kanban de 150 px ne montre pas une carte. */
export const BLOCK_MIN_WIDTH = 220;

/**
 * Largeur supposée quand on ne peut pas mesurer (test hors navigateur, bloc
 * détaché du DOM). Ni un plafond ni une valeur d'office : juste de quoi ne
 * jamais rendre `NaN`, c'est-à-dire un bloc invisible.
 */
export const BLOCK_FALLBACK_WIDTH = 720;

/**
 * Distance au bord droit sous laquelle on retombe sur la largeur d'office.
 *
 * Sans cette zone, revenir à « comme avant » demanderait de tomber au pixel
 * près sur la largeur du conteneur — ce qui n'arrive jamais. Le bloc resterait
 * alors à 719 px pour toujours, avec un attribut inutile dans le document.
 */
export const BLOCK_SNAP_TOLERANCE = 24;

/** Pas du réglage au clavier (flèches sur la poignée). */
export const BLOCK_WIDTH_STEP = 40;

/**
 * Blocs qui portent une largeur.
 *
 * Liste explicite plutôt que « tout ce qui est un bloc » : l'attribut n'a de
 * sens que sur les nœuds dont la vue sait poser la poignée, et un attribut posé
 * sur un nœud qui ne le rend pas alourdit le document sans rien produire.
 *
 * `fileEmbed` en est absent À DESSEIN : l'image porte déjà sa propre largeur en
 * pixels. Deux largeurs sur le même nœud se contrediraient — laquelle gagne ? —
 * sans que rien à l'écran ne dise pourquoi.
 *
 * Ni paragraphe, ni titre, ni liste : une poignée sur chaque ligne de la note
 * est du bruit permanent, payé partout où elle n'a rien à régler.
 */
export const RESIZABLE_BLOCK_TYPES: readonly string[] = [
  'inlineDatabase',
  'mermaidBlock',
  'calendarBlock',
  'dataviewBlock',
  'embedUrl',
  'transclusion',
];

/** Ce type de bloc accepte-t-il une largeur ? */
export function canResizeBlockType(typeName: string): boolean {
  return RESIZABLE_BLOCK_TYPES.includes(typeName);
}

/** Une mesure exploitable, ou le repli. Jamais 0, jamais `NaN`. */
export function usableWidth(available: number): number {
  return Number.isFinite(available) && available >= BLOCK_MIN_WIDTH
    ? Math.round(available)
    : BLOCK_FALLBACK_WIDTH;
}

/**
 * Ramène une largeur dans les bornes.
 *
 * Le plafond est la place RÉELLEMENT disponible, mesurée au moment du geste, et
 * non une constante : c'est ce qui permet de dépasser la colonne de texte quand
 * elle est étroite (le bloc va alors jusqu'au bord de la page) sans jamais
 * produire un débordement que personne n'a demandé.
 */
export function clampBlockWidth(px: number, available: number): number {
  const max = usableWidth(available);
  if (!Number.isFinite(px)) return max;
  return Math.round(Math.max(BLOCK_MIN_WIDTH, Math.min(max, px)));
}

/**
 * Lit la largeur telle qu'elle sort du document.
 *
 * `null` veut dire « largeur d'office », qui est aussi l'absence d'attribut :
 * un document écrit avant cette fonctionnalité, ou par un client qui l'ignore,
 * se lit exactement comme aujourd'hui. Une valeur abîmée est ramenée dans les
 * bornes plutôt que jetée — le bloc reste réglable.
 *
 * Aucun plafond n'est appliqué ICI : la largeur enregistrée dans le document
 * voyage avec lui, et une note lue dans un panneau étroit ne doit pas se faire
 * RÉÉCRIRE par la seule lecture. Le plafond est affaire de rendu (`max-width`
 * en CSS) et de geste (`clampBlockWidth`), pas de stockage.
 */
export function parseBlockWidth(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.max(BLOCK_MIN_WIDTH, n));
}

/**
 * Ce qu'il faut ÉCRIRE dans l'attribut pour une largeur donnée.
 *
 * La largeur d'office s'écrit `null` et non « la valeur du conteneur » : c'est
 * ce qui garantit qu'un bloc ramené à sa taille d'origine redevient
 * rigoureusement identique à un bloc qu'on n'a jamais touché — mêmes attributs,
 * même sérialisation, même empreinte pour la synchronisation. Et c'est aussi ce
 * qui le laisse RESUIVRE la fenêtre : une largeur figée à la taille qu'avait
 * l'écran ce jour-là ne se retaille plus jamais toute seule.
 */
export function widthAttrFor(px: number, available: number): number | null {
  const max = usableWidth(available);
  const clamped = clampBlockWidth(px, available);
  return clamped >= max - BLOCK_SNAP_TOLERANCE ? null : clamped;
}

/**
 * Largeur résultant d'un glissement de la poignée.
 *
 * Aucun facteur d'échelle : le bord GAUCHE du bloc ne bouge pas, seul le droit
 * suit la souris. Un pixel parcouru vaut un pixel — c'est exactement ce que
 * fait la poignée de l'image, et c'est le seul réglage où la main et le bord
 * restent collés.
 */
export function widthFromDrag(startWidth: number, deltaPx: number, available: number): number {
  return clampBlockWidth(startWidth + deltaPx, available);
}

/**
 * Réglage AU CLAVIER (flèches sur la poignée), qui doit atteindre les mêmes
 * valeurs que la souris. Le dernier pas vers la droite rend `null` : « revenir
 * à la largeur d'office » doit être atteignable sans souris, sinon un bloc
 * rétréci le reste pour toujours.
 */
export function stepBlockWidth(
  current: number | null,
  direction: -1 | 1,
  available: number
): number | null {
  const max = usableWidth(available);
  const from = current === null ? max : clampBlockWidth(current, available);
  return widthAttrFor(from + direction * BLOCK_WIDTH_STEP, available);
}

// ==================== Hauteur ====================

/** En deçà, un kanban ne montre plus une seule carte entière : borner ne sert plus à rien. */
export const BLOCK_MIN_HEIGHT = 120;

/**
 * Plafond absolu. Au-delà, on ne borne plus rien — c'est déjà plus haut qu'un
 * écran. La borne existe pour qu'un glissement emballé, ou une valeur abîmée, ne
 * produise pas un bloc de 40 000 px qu'on ne saurait plus rattraper à la souris.
 */
export const BLOCK_MAX_HEIGHT = 2400;

/** Pas du réglage au clavier (flèches haut / bas sur la poignée). */
export const BLOCK_HEIGHT_STEP = 40;

/**
 * Blocs qui acceptent une hauteur bornée.
 *
 * `embedUrl` en est ABSENT, comme l'image et pour la même raison : une vidéo a
 * un rapport d'image, sa hauteur découle de sa largeur. Lui en imposer une
 * autre ne borne rien, ça déforme ou ça rogne.
 *
 * Les autres ont tous un contenu qui s'allonge sans limite — des cartes, des
 * lignes, un long schéma — et c'est exactement ce qu'on veut pouvoir tenir.
 */
export const HEIGHT_RESIZABLE_BLOCK_TYPES: readonly string[] = [
  'inlineDatabase',
  'mermaidBlock',
  'calendarBlock',
  'dataviewBlock',
  'transclusion',
];

/** Ce type de bloc accepte-t-il une hauteur bornée ? */
export function canResizeBlockHeightType(typeName: string): boolean {
  return HEIGHT_RESIZABLE_BLOCK_TYPES.includes(typeName);
}

/**
 * A-t-on une hauteur naturelle exploitable ?
 *
 * Elle ne sert PLUS de plafond — seulement d'aimant vers « libre ». Sans elle
 * (jsdom, bloc pas encore posé) on règle quand même la hauteur : on perd juste
 * le retour à « libre » par glissement, qui reste atteignable au double-clic.
 */
export function canBoundHeight(natural: number): boolean {
  return Number.isFinite(natural) && natural > 0;
}

/**
 * Ramène une hauteur dans les bornes ABSOLUES.
 *
 * Volontairement indépendant du contenu : c'est ce qui permet de tirer un bloc
 * plus HAUT que ce qu'il montre — un plateau presque vide qu'on veut grand. Le
 * contenu n'intervient que comme aimant vers « libre » (`heightAttrFor`).
 */
export function clampBlockHeight(px: number): number {
  if (!Number.isFinite(px)) return BLOCK_MIN_HEIGHT;
  return Math.round(Math.max(BLOCK_MIN_HEIGHT, Math.min(BLOCK_MAX_HEIGHT, px)));
}

/**
 * Lit la hauteur telle qu'elle sort du document. `null` = libre, qui est aussi
 * l'absence d'attribut : un document écrit avant cette fonctionnalité se lit
 * exactement comme aujourd'hui.
 *
 * Aucun plafond ICI, pour la même raison que la largeur : la valeur voyage avec
 * le document, et la relire ne doit jamais la réécrire.
 */
export function parseBlockHeight(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.max(BLOCK_MIN_HEIGHT, n));
}

/**
 * Ce qu'il faut ÉCRIRE dans l'attribut pour une hauteur donnée.
 *
 * Rejoindre la hauteur naturelle s'écrit `null` — « libre » — et non la
 * mesure du jour. Trois conséquences voulues : aucun vide n'est représentable,
 * un bloc relâché redevient identique à un bloc jamais touché, et un bloc
 * libéré CONTINUE de suivre son contenu quand on lui ajoute des cartes — une
 * hauteur figée à la taille du jour ne se retaille plus jamais toute seule.
 *
 * La zone d'attraction est la même que pour la largeur : sans elle, revenir à
 * « libre » demanderait de tomber au pixel près sur la hauteur du contenu.
 */
export function heightAttrFor(px: number, natural: number): number | null {
  const clamped = clampBlockHeight(px);
  // Sans repère, on garde la valeur : mieux vaut une hauteur réglable qu'un
  // geste qui ne répond pas.
  if (!canBoundHeight(natural)) return clamped;
  // Bande SYMÉTRIQUE autour de la hauteur naturelle. Une bande « tout ce qui est
  // plus grand », comme dans la version précédente, revenait à interdire
  // d'agrandir : chaque pixel gagné vers le bas se réécrivait en « libre ».
  return Math.abs(clamped - Math.round(natural)) <= BLOCK_SNAP_TOLERANCE ? null : clamped;
}

/**
 * Hauteur résultant d'un glissement de la poignée.
 *
 * Aucun facteur d'échelle, comme pour la largeur : le bord HAUT ne bouge pas,
 * seul le bas suit la souris. Vers le bas comme vers le haut — c'est le point
 * qui manquait.
 */
export function heightFromDrag(startHeight: number, deltaPy: number): number {
  return clampBlockHeight(startHeight + deltaPy);
}

/**
 * Réglage AU CLAVIER (flèches haut / bas sur la poignée). Le dernier pas vers
 * le bas rend `null` : « libérer la hauteur » doit être atteignable sans
 * souris, sinon un bloc borné le reste pour toujours.
 */
export function stepBlockHeight(
  current: number | null,
  direction: -1 | 1,
  natural: number
): number | null {
  const base = current === null ? natural : current;
  if (!Number.isFinite(base)) return null;
  return heightAttrFor(clampBlockHeight(base) + direction * BLOCK_HEIGHT_STEP, natural);
}
