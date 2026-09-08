/**
 * Moteur de grille — le SOLVEUR.
 *
 * Cent pour cent pur : aucune importation de React, aucun accès au DOM, aucune
 * horloge, aucun aléa. C'est le seul endroit du chantier où un défaut se paie
 * cher — une disposition mal résolue, c'est le tableau de bord de quelqu'un qui
 * se réorganise tout seul pendant la nuit, sur trois appareils à la fois. Donc :
 * tout ici est testable sans monter un rendu, et tout ici EST testé
 * (`__tests__/gridSolver.vitest.ts`).
 *
 * ── L'INVARIANT ────────────────────────────────────────────────────────────
 *
 * Toute fonction publique qui renvoie une disposition renvoie une disposition
 * SANS CHEVAUCHEMENT, tenant dans ses colonnes, triée en ordre de lecture. Cet
 * invariant n'est pas « respecté avec soin » par chaque algorithme : il est
 * IMPOSÉ par construction, parce que chaque chemin de sortie passe par
 * `compactLayout`, qui pose chaque widget sous tout ce qui le précède et le
 * recouvre. Un bug dans la poussée des voisins produit au pire un rangement
 * inattendu ; il ne peut pas produire deux widgets superposés.
 *
 * ── LA GRAVITÉ EST VERS LE HAUT, ET SEULEMENT VERS LE HAUT ──────────────────
 *
 * Chaque widget tombe vers le haut jusqu'au premier obstacle de SES colonnes.
 * Il ne se faufile jamais latéralement pour combler un trou, et surtout il n'y a
 * PAS de remplissage dense (`grid-auto-flow: dense`) : le remplissage
 * automatique déplace les widgets à l'insu de l'utilisateur, qui range son
 * accueil, revient le lendemain et ne retrouve rien. Un trou volontaire reste un
 * trou. La seule chose qu'on refuse, c'est un widget suspendu en l'air sans rien
 * dessous — parce que ça, personne ne le fait exprès et personne ne peut le
 * réparer sur un téléphone.
 */

import {
  GRID_COLUMNS,
  GRID_SIZES,
  GRID_SIZE_IDS,
  type GridColumnCount,
  type GridPlacement,
  type GridRect,
  type GridSize,
  type GridSizeConstraints,
  type GridSizeId,
} from './gridTypes';

// ==================== Géométrie ====================

/** Deux rectangles se recouvrent-ils ? Les bords qui se touchent NE se recouvrent pas. */
export function rectsOverlap(a: GridRect, b: GridRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Les widgets que `rect` recouvre, `ignoreId` excepté. */
export function collisionsFor(
  rect: GridRect,
  items: readonly GridPlacement[],
  ignoreId?: string
): GridPlacement[] {
  return items.filter((it) => it.id !== ignoreId && rectsOverlap(rect, it));
}

/**
 * Ordre de LECTURE : de haut en bas, puis de gauche à droite. L'identifiant
 * départage les ex æquo — sans lui, deux widgets posés exactement au même
 * endroit (une disposition corrompue, une fusion de synchronisation) se
 * résoudraient dans l'ordre où le tableau se trouve être, donc différemment sur
 * deux appareils. Un ordre total est ce qui rend le repli et la compaction
 * REPRODUCTIBLES.
 */
export function compareReadingOrder(a: GridPlacement, b: GridPlacement): number {
  if (a.y !== b.y) return a.y - b.y;
  if (a.x !== b.x) return a.x - b.x;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortReadingOrder(items: readonly GridPlacement[]): GridPlacement[] {
  return [...items].sort(compareReadingOrder);
}

/**
 * Ramène un widget dans la grille : largeur au plus le nombre de colonnes,
 * abscisse dans les bornes, ordonnée positive, dimensions entières et non nulles.
 * Tout ce qui entre dans le solveur passe par là, y compris une disposition
 * arrivée du nuage qu'un autre appareil aurait écrite pour une grille plus large.
 */
export function clampPlacement(item: GridPlacement, columns: number): GridPlacement {
  const w = Math.min(Math.max(1, Math.round(item.w)), columns);
  const h = Math.max(1, Math.round(item.h));
  const x = Math.min(Math.max(0, Math.round(item.x)), columns - w);
  const y = Math.max(0, Math.round(item.y));
  return { ...item, x, y, w, h };
}

// ==================== Compaction ====================

/**
 * Compaction VERS LE HAUT, et résolution de tout chevauchement au passage.
 *
 * Les widgets sont traités en ordre de lecture ; chacun se pose immédiatement
 * sous le plus bas de ceux, déjà posés, qui partagent au moins une de ses
 * colonnes. D'où les deux propriétés :
 *
 *   — AUCUN CHEVAUCHEMENT EN SORTIE, quoi qu'on donne en entrée. Un widget est
 *     posé sous tous ceux qui le précèdent et qui le croisent horizontalement,
 *     donc il ne peut en recouvrir aucun.
 *   — IDEMPOTENCE. Repasser sur une disposition compactée ne la bouge plus. Le
 *     re-tri ne peut inverser que des widgets qui ne partagent AUCUNE colonne
 *     (si deux widgets se croisent horizontalement, celui posé en premier finit
 *     strictement au-dessus, donc l'ordre est préservé) — et deux widgets sans
 *     colonne commune ne s'influencent pas.
 *
 * Le prix est un O(n²) assumé : une grille d'accueil compte quelques dizaines de
 * widgets, pas quelques milliers, et un index par colonne coûterait plus en
 * lisibilité qu'il ne rapporterait en microsecondes.
 */
export function compactLayout(
  items: readonly GridPlacement[],
  columns: GridColumnCount
): GridPlacement[] {
  const ordered = sortReadingOrder(items.map((i) => clampPlacement(i, columns)));
  const placed: GridPlacement[] = [];
  for (const item of ordered) {
    let y = 0;
    for (const p of placed) {
      // Croisement horizontal seulement : la gravité est verticale.
      if (p.x < item.x + item.w && item.x < p.x + p.w) {
        y = Math.max(y, p.y + p.h);
      }
    }
    placed.push({ ...item, y });
  }
  return sortReadingOrder(placed);
}

/**
 * Remise en règle d'une disposition d'origine inconnue (nuage, modèle importé,
 * fichier bricolé à la main). Alias explicite de la compaction, parce que
 * l'appelant qui veut « juste nettoyer » n'a pas à savoir que nettoyer et
 * compacter sont le même geste.
 */
export function normalizeLayout(
  items: readonly GridPlacement[],
  columns: GridColumnCount
): GridPlacement[] {
  return compactLayout(items, columns);
}

// ==================== Recherche d'emplacement ====================

/**
 * Premier emplacement libre pour un rectangle `w × h`, balayé de haut en bas
 * puis de gauche à droite — donc dans l'ordre de lecture, celui où l'œil
 * cherche naturellement « la place qui reste ».
 *
 * `minY` interdit de remonter au-dessus d'une rangée donnée. C'est le repli qui
 * s'en sert : sans lui, un petit widget se glisserait dans un trou laissé
 * plusieurs rangées plus haut et doublerait tous ses aînés, ce qui casserait
 * l'ordre de lecture — la seule chose que l'utilisateur peut prédire quand il
 * ouvre son accueil sur un autre écran.
 */
export function findFreeSpot(
  items: readonly GridPlacement[],
  w: number,
  h: number,
  columns: GridColumnCount,
  minY = 0
): { x: number; y: number } {
  const cw = Math.min(Math.max(1, w), columns);
  const ch = Math.max(1, h);
  const floor = Math.max(0, minY);
  const bottom = items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
  for (let y = floor; y <= bottom; y++) {
    for (let x = 0; x + cw <= columns; x++) {
      if (collisionsFor({ x, y, w: cw, h: ch }, items).length === 0) {
        return { x, y };
      }
    }
  }
  // Rien au-dessus : sous tout le monde, à gauche.
  return { x: 0, y: Math.max(bottom, floor) };
}

/**
 * Insertion d'un widget au premier emplacement libre.
 *
 * Volontairement pas « en bas de la page » : un accueil qui grandit par le bas
 * oblige à faire défiler pour voir ce qu'on vient d'ajouter, et l'ajout suivant
 * est encore plus loin. Le premier trou est là où l'utilisateur regarde déjà.
 */
export function insertItem(
  items: readonly GridPlacement[],
  item: { id: string; w: number; h: number },
  columns: GridColumnCount
): GridPlacement[] {
  const w = Math.min(Math.max(1, item.w), columns);
  const h = Math.max(1, item.h);
  const base = items.map((i) => clampPlacement(i, columns));
  const spot = findFreeSpot(base, w, h, columns);
  return compactLayout([...base, { id: item.id, x: spot.x, y: spot.y, w, h }], columns);
}

// ==================== Poussée des voisins ====================

/**
 * Pousse VERS LE BAS, en cascade, tout ce que `anchor` recouvre.
 *
 * L'ancre ne bouge pas : c'est le widget que l'utilisateur tient dans la main,
 * et rien n'est plus déroutant qu'un widget qui recule sous le curseur. Chaque
 * voisin délogé peut à son tour en déloger d'autres, d'où la file.
 *
 * La terminaison est acquise : une poussée déplace toujours un widget STRICTEMENT
 * plus bas (le recouvrement implique `it.y < cur.y + cur.h`), et la hauteur
 * totale est finie. Le compteur de sécurité n'est là que pour qu'un cas non
 * prévu se traduise par un rangement approximatif — jamais par un gel de
 * l'interface. La correction finale, elle, est garantie ailleurs : l'appelant
 * repasse toujours par `compactLayout`.
 */
function pushCollidersDown(
  anchor: GridPlacement,
  others: readonly GridPlacement[]
): GridPlacement[] {
  const work = others.map((o) => ({ ...o }));
  const queue: GridPlacement[] = [anchor];
  const budget = work.length * (work.length + 1) + 32;
  let steps = 0;
  while (queue.length > 0 && steps < budget) {
    steps++;
    const cur = queue.shift() as GridPlacement;
    for (const it of work) {
      if (it.id === cur.id) continue;
      if (rectsOverlap(cur, it)) {
        it.y = cur.y + cur.h;
        queue.push(it);
      }
    }
  }
  return work;
}

/**
 * Déplacement d'un widget vers `(x, y)`, voisins poussés, gravité réappliquée.
 *
 * Le déplacement part TOUJOURS de la disposition d'origine, jamais de l'aperçu
 * du geste précédent : sinon un aller-retour de la souris laisserait une trace,
 * chaque image ajoutant sa poussée à la précédente, et le tableau dériverait
 * sous le doigt. On rejoue le même calcul depuis le même point de départ à
 * chaque image — c'est ce qui rend le geste réversible.
 */
export function moveItem(
  items: readonly GridPlacement[],
  id: string,
  x: number,
  y: number,
  columns: GridColumnCount
): GridPlacement[] {
  const base = items.map((i) => clampPlacement(i, columns));
  const source = base.find((i) => i.id === id);
  if (!source) return compactLayout(base, columns);

  const moved = clampPlacement({ ...source, x, y }, columns);
  const others = base.filter((i) => i.id !== id);
  const pushed = pushCollidersDown(moved, others);
  return compactLayout([moved, ...pushed], columns);
}

/**
 * Redimensionnement à des dimensions DÉJÀ bornées par les contraintes du widget
 * (voir `clampToConstraints`). Le solveur ne connaît pas les contraintes d'un
 * widget : c'est une propriété du widget, pas de la grille.
 *
 * N'IMPORTE QUELLE géométrie entière est recevable — 5×3, 12×7, 1×11. Le
 * catalogue de formats nommés ne borne plus rien ici : il ne sert qu'à proposer
 * des tailles en un clic.
 *
 * L'abscisse recule si la nouvelle largeur déborde à droite — le widget grandit
 * plutôt que de rétrécir : celui qui agrandit veut de la place, pas un refus.
 * Le geste à la poignée, lui, borne la largeur à la place disponible à droite
 * AVANT d'appeler ici, pour que le bloc ne glisse pas latéralement sous le
 * curseur qui tire son coin.
 */
export function resizeItem(
  items: readonly GridPlacement[],
  id: string,
  w: number,
  h: number,
  columns: GridColumnCount
): GridPlacement[] {
  const base = items.map((i) => clampPlacement(i, columns));
  const source = base.find((i) => i.id === id);
  if (!source) return compactLayout(base, columns);

  const resized = clampPlacement({ ...source, w, h }, columns);
  const others = base.filter((i) => i.id !== id);
  const pushed = pushCollidersDown(resized, others);
  return compactLayout([resized, ...pushed], columns);
}

/** Retire un widget et rattrape la gravité derrière lui. */
export function removeItem(
  items: readonly GridPlacement[],
  id: string,
  columns: GridColumnCount
): GridPlacement[] {
  return compactLayout(
    items.filter((i) => i.id !== id),
    columns
  );
}

// ==================== Projection 12 → 6 → 1 ====================

/**
 * Dérive la disposition affichée à `columns` colonnes depuis la maîtresse en
 * douze.
 *
 * Règles, dans cet ordre :
 *   1. les widgets sont pris dans l'ORDRE DE LECTURE de la grille large ;
 *   2. chaque largeur est ramenée à `min(largeur, colonnes)` ;
 *   3. chacun se pose au premier emplacement libre SANS REMONTER au-dessus du
 *      précédent — la lecture est donc préservée exactement ;
 *   4. en une colonne, plus rien à arbitrer : une pile, dans l'ordre de lecture.
 *
 * Le résultat est une fonction PURE de la disposition maîtresse : deux appareils
 * qui reçoivent le même modèle affichent le même repli, et le repli n'est jamais
 * stocké — donc jamais désynchronisé de ce dont il est dérivé.
 */
export function projectLayout(
  items: readonly GridPlacement[],
  columns: GridColumnCount
): GridPlacement[] {
  const ordered = sortReadingOrder(items.map((i) => clampPlacement(i, GRID_COLUMNS)));

  if (columns === GRID_COLUMNS) return compactLayout(ordered, GRID_COLUMNS);

  if (columns === 1) {
    let y = 0;
    return ordered.map((item) => {
      const placed = { ...item, x: 0, y, w: 1 };
      y += item.h;
      return placed;
    });
  }

  const placed: GridPlacement[] = [];
  let floor = 0;
  for (const item of ordered) {
    const w = Math.min(item.w, columns);
    const spot = findFreeSpot(placed, w, item.h, columns, floor);
    placed.push({ ...item, x: spot.x, y: spot.y, w });
    floor = spot.y;
  }
  return sortReadingOrder(placed);
}

// ==================== Formats ====================

/**
 * Les formats autorisés d'un widget, dans l'ordre du catalogue. Une liste vide
 * ou entièrement inconnue rend les huit : mieux vaut un widget redimensionnable
 * plus librement que prévu qu'un widget qu'on ne peut plus redimensionner du
 * tout parce qu'une déclaration a été mal orthographiée.
 */
export function allowedSizeList(allowed?: readonly GridSizeId[]): GridSize[] {
  const wanted = new Set<string>(allowed && allowed.length > 0 ? allowed : GRID_SIZE_IDS);
  const list = GRID_SIZES.filter((s) => wanted.has(s.id));
  return list.length > 0 ? list : [...GRID_SIZES];
}

/**
 * Format suivant (ou précédent) dans le cycle des formats autorisés. Le cycle
 * boucle : c'est un contrôle à un seul bouton, il ne doit jamais se retrouver en
 * butée sans que rien ne se passe. Un format courant hors catalogue (`null`)
 * repart du début.
 */
export function cycleSize(
  current: GridSizeId | null,
  allowed?: readonly GridSizeId[],
  direction: 1 | -1 = 1
): GridSize {
  const list = allowedSizeList(allowed);
  const index = current === null ? -1 : list.findIndex((s) => s.id === current);
  if (index === -1) return direction >= 0 ? list[0] : list[list.length - 1];
  return list[(index + direction + list.length) % list.length];
}

/**
 * Le format NOMMÉ le plus proche de dimensions données. Distance euclidienne
 * dans le plan (colonnes, rangées), les ex æquo départagés par l'ordre du
 * catalogue — donc déterministe.
 *
 * ATTENTION : ce n'est PLUS l'aimantation de la poignée. Le geste pose la
 * géométrie brute, case par case (voir `clampToConstraints`) ; s'aimanter sur
 * un format faisait sauter la largeur pendant qu'on tirait vers le bas, et
 * rendait un 5×1 — ou un 12×7 — infabricable. La fonction reste pour les
 * appelants qui veulent RAPPROCHER une géométrie d'un nom : un gabarit importé,
 * une suggestion, un affichage.
 */
export function snapToAllowedSize(w: number, h: number, allowed?: readonly GridSizeId[]): GridSize {
  const list = allowedSizeList(allowed);
  let best = list[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const size of list) {
    const dw = size.w - w;
    const dh = size.h - h;
    const score = dw * dw + dh * dh;
    if (score < bestScore) {
      bestScore = score;
      best = size;
    }
  }
  return best;
}

// ==================== Contraintes de taille ====================

/**
 * Les bornes EFFECTIVES d'un widget : ce que la déclaration dit, remis en règle.
 *
 * Une déclaration peut être absente, partielle, à l'envers (`minW` au-dessus de
 * `maxW`), fractionnaire ou négative — elle vient d'un registre écrit à la main.
 * Rien de tout ça ne doit pouvoir produire une borne infranchissable : le pire
 * cas admissible est un widget qui se redimensionne plus librement que son
 * auteur ne l'imaginait, jamais un widget qu'on ne peut plus toucher.
 *
 * `columns` plafonne la largeur. Le geste s'en sert pour passer la place
 * DISPONIBLE À DROITE plutôt que les douze colonnes : c'est ce qui empêche le
 * bloc de glisser vers la gauche quand on tire son coin au-delà du bord. Un
 * `minW` plus grand que cette place gagne quand même — sinon un widget large
 * coincé à droite deviendrait irrédimensionnable.
 */
export function resolveConstraints(
  constraints: GridSizeConstraints | undefined,
  columns: number = GRID_COLUMNS
): { minW: number; minH: number; maxW: number; maxH: number } {
  const room = Math.max(1, Math.floor(columns));
  const asCount = (value: number | undefined, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.round(value)) : fallback;

  const minW = Math.min(asCount(constraints?.minW, 1), GRID_COLUMNS);
  const minH = asCount(constraints?.minH, 1);
  // Absent ⇒ libre : toute la place en largeur, aucun plafond en hauteur.
  const maxW = Math.max(minW, Math.min(asCount(constraints?.maxW, GRID_COLUMNS), room));
  const maxH = Math.max(minH, asCount(constraints?.maxH, Number.POSITIVE_INFINITY));
  return { minW, minH, maxW, maxH };
}

/**
 * Ramène des dimensions brutes — celles que le curseur vient de dicter — dans
 * les bornes du widget. Point d'entrée UNIQUE du redimensionnement libre.
 *
 * Les deux axes sont traités SÉPARÉMENT, et c'est tout le sujet : la largeur ne
 * dépend que de la largeur demandée, la hauteur que de la hauteur demandée.
 * L'ancienne aimantation cherchait le format le plus proche dans le plan, donc
 * tirer vers le bas pouvait changer la largeur — le bloc changeait de forme sous
 * le curseur sans que personne ne comprenne pourquoi.
 */
export function clampToConstraints(
  w: number,
  h: number,
  constraints?: GridSizeConstraints,
  columns: number = GRID_COLUMNS
): { w: number; h: number } {
  const { minW, minH, maxW, maxH } = resolveConstraints(constraints, columns);
  const rawW = Number.isFinite(w) ? Math.round(w) : minW;
  const rawH = Number.isFinite(h) ? Math.round(h) : minH;
  return {
    w: Math.min(Math.max(rawW, minW), maxW),
    h: Math.min(Math.max(rawH, minH), maxH),
  };
}

/**
 * Le widget a-t-il plus d'une géométrie possible ? Sert à décider si la poignée
 * d'angle a lieu d'être : une prise qui ne peut rien changer est un mensonge.
 */
export function isResizable(
  constraints?: GridSizeConstraints,
  columns: number = GRID_COLUMNS
): boolean {
  const { minW, minH, maxW, maxH } = resolveConstraints(constraints, columns);
  return maxW > minW || maxH > minH;
}

/**
 * Contraintes DÉDUITES d'une liste de formats nommés : le plus petit et le plus
 * grand de chaque axe.
 *
 * Passerelle pour un appelant qui n'a encore déclaré que des formats. Attention
 * à ce qu'elle fait vraiment : elle rend le rectangle ENGLOBANT, donc elle
 * autorise des géométries que la liste ne contenait pas (['tile' 3×1, 'tall'
 * 4×4] ⇒ 3..4 × 1..4, dont le 4×1). C'est voulu — on borne, on n'énumère plus.
 */
export function constraintsFromSizes(allowed?: readonly GridSizeId[]): GridSizeConstraints {
  const list = allowedSizeList(allowed);
  return {
    minW: Math.min(...list.map((s) => s.w)),
    minH: Math.min(...list.map((s) => s.h)),
    maxW: Math.max(...list.map((s) => s.w)),
    maxH: Math.max(...list.map((s) => s.h)),
  };
}

// ==================== Comparaison ====================

/**
 * Deux dispositions décrivent-elles le même agencement ? Comparaison par
 * identifiant, insensible à l'ordre du tableau.
 *
 * Sert au COMMIT UNIQUE : à la fin d'un geste, si rien n'a bougé, rien n'est
 * écrit. Sans ce garde-fou, un simple clic sur une poignée pousserait une écriture
 * synchronisée à tous les appareils, avec conflit potentiel à la clé, pour
 * décrire une disposition rigoureusement identique.
 */
export function layoutsEqual(a: readonly GridPlacement[], b: readonly GridPlacement[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(a.map((i) => [i.id, i]));
  for (const it of b) {
    const other = byId.get(it.id);
    if (!other) return false;
    if (other.x !== it.x || other.y !== it.y || other.w !== it.w || other.h !== it.h) return false;
  }
  return true;
}

/** Nombre de rangées occupées — la hauteur de la surface à réserver. */
export function layoutRowCount(items: readonly GridPlacement[]): number {
  return items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
}
