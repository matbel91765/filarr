/**
 * Le solveur de grille, éprouvé.
 *
 * C'est la seule brique du moteur dont un défaut soit INVISIBLE et DURABLE : un
 * rendu cassé se voit à l'œil en trois secondes, une disposition mal résolue se
 * découvre trois semaines plus tard sur le téléphone de quelqu'un, une fois
 * synchronisée partout. D'où une suite qui ne se contente pas d'exemples : les
 * quatre invariants (pas de chevauchement, gravité, idempotence, déterminisme)
 * sont aussi vérifiés sur des centaines de dispositions engendrées, y compris
 * volontairement corrompues.
 *
 * L'aléa est un générateur À GRAINE, jamais `Math.random` : un test qui échoue
 * une fois sur cent sans qu'on puisse le rejouer ne prouve rien et finit
 * désactivé.
 */

import { describe, expect, it } from 'vitest';

import {
  allowedSizeList,
  clampPlacement,
  clampToConstraints,
  collisionsFor,
  compactLayout,
  compareReadingOrder,
  constraintsFromSizes,
  cycleSize,
  findFreeSpot,
  isResizable,
  insertItem,
  layoutRowCount,
  layoutsEqual,
  moveItem,
  normalizeLayout,
  projectLayout,
  rectsOverlap,
  removeItem,
  resolveConstraints,
  resizeItem,
  snapToAllowedSize,
  sortReadingOrder,
} from '../gridSolver';
import {
  GRID_COLUMNS,
  GRID_SIZES,
  gridSize,
  sizeIdOf,
  type GridColumnCount,
  type GridPlacement,
  type GridSizeConstraints,
} from '../gridTypes';

// ==================== Outils ====================

const p = (id: string, x: number, y: number, w: number, h: number): GridPlacement => ({
  id,
  x,
  y,
  w,
  h,
});

/** Lecture compacte d'une disposition : `id@x,y wxh`, en ordre de lecture. */
const show = (items: readonly GridPlacement[]): string[] =>
  sortReadingOrder(items).map((i) => `${i.id}@${i.x},${i.y} ${i.w}x${i.h}`);

/** Aucune paire ne se recouvre. L'invariant central. */
function expectNoOverlap(items: readonly GridPlacement[]): void {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const overlap = rectsOverlap(items[i], items[j]);
      if (overlap) {
        throw new Error(
          `chevauchement entre ${show([items[i]])[0]} et ${show([items[j]])[0]}\n` +
            `disposition : ${show(items).join(' | ')}`
        );
      }
    }
  }
}

/** Tout tient dans la grille. */
function expectInsideGrid(items: readonly GridPlacement[], columns: number): void {
  for (const it of items) {
    expect(it.x, `${it.id}.x`).toBeGreaterThanOrEqual(0);
    expect(it.y, `${it.id}.y`).toBeGreaterThanOrEqual(0);
    expect(it.w, `${it.id}.w`).toBeGreaterThanOrEqual(1);
    expect(it.h, `${it.id}.h`).toBeGreaterThanOrEqual(1);
    expect(it.x + it.w, `${it.id} déborde à droite`).toBeLessThanOrEqual(columns);
  }
}

/** Rien ne flotte : chaque widget touche le haut ou quelque chose. */
function expectGravity(items: readonly GridPlacement[]): void {
  for (const it of items) {
    if (it.y === 0) continue;
    const supported = items.some(
      (o) => o.id !== it.id && o.y + o.h === it.y && o.x < it.x + it.w && it.x < o.x + o.w
    );
    expect(supported, `${it.id} flotte en l'air (y=${it.y})`).toBe(true);
  }
}

/** Générateur à graine (xorshift32) — reproductible et sans dépendance. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

/**
 * Dispositions ENGENDRÉES, volontairement sales : positions tirées au hasard,
 * donc chevauchements, trous et débordements garantis. C'est exactement ce qu'on
 * peut recevoir d'un nuage, d'un modèle importé ou d'une fusion.
 */
function randomLayout(rng: () => number, count: number, columns: number): GridPlacement[] {
  const items: GridPlacement[] = [];
  for (let i = 0; i < count; i++) {
    const size = GRID_SIZES[Math.floor(rng() * GRID_SIZES.length)];
    items.push({
      id: `w${i}`,
      x: Math.floor(rng() * (columns + 2)) - 1, // dont des abscisses hors bornes
      y: Math.floor(rng() * 10),
      w: size.w,
      h: size.h,
    });
  }
  return items;
}

/**
 * Même chose, mais avec des géométries LIBRES : n'importe quelle largeur, y
 * compris celles qu'aucun format ne nomme (5, 7, 11…), et des hauteurs qui vont
 * bien au-delà du plus grand format (jusqu'à 9 rangées). C'est ce que la poignée
 * fabrique depuis qu'elle ne s'aimante plus, donc c'est ce que le solveur, le
 * repli et la synchronisation doivent encaisser.
 */
function randomFreeLayout(rng: () => number, count: number, columns: number): GridPlacement[] {
  const items: GridPlacement[] = [];
  for (let i = 0; i < count; i++) {
    items.push({
      id: `w${i}`,
      x: Math.floor(rng() * (columns + 2)) - 1,
      y: Math.floor(rng() * 10),
      w: 1 + Math.floor(rng() * columns),
      h: 1 + Math.floor(rng() * 9),
    });
  }
  return items;
}

/**
 * L'ARITHMÉTIQUE DE LA POIGNÉE, telle que `useGridGestures` l'applique dans sa
 * branche « resize » : la largeur ne suit que le déplacement horizontal, la
 * hauteur que le vertical, et la largeur est bornée par la place qui reste À
 * DROITE du bloc (son coin haut-gauche ne bouge pas pendant le geste).
 *
 * Le hook est du code React qui a besoin d'un vrai DOM ; ce miroir vérifie la
 * seule chose qui puisse être fausse sans qu'on la voie — le calcul.
 */
function dragCorner(
  item: GridPlacement,
  dx: number,
  dy: number,
  constraints?: GridSizeConstraints,
  columns = GRID_COLUMNS
): { w: number; h: number } {
  const room = Math.max(1, columns - item.x);
  return clampToConstraints(item.w + dx, item.h + dy, constraints, room);
}

// ==================== Collisions ====================

describe('collisions', () => {
  it('deux rectangles disjoints ne se recouvrent pas', () => {
    expect(rectsOverlap(p('a', 0, 0, 3, 2), p('b', 3, 0, 3, 2))).toBe(false);
    expect(rectsOverlap(p('a', 0, 0, 3, 2), p('b', 0, 2, 3, 2))).toBe(false);
  });

  it('des bords qui se TOUCHENT ne se recouvrent pas', () => {
    // Le piège classique : `<=` au lieu de `<` colle une gouttière fantôme
    // entre deux widgets voisins et fait descendre toute la colonne d'un cran.
    expect(rectsOverlap(p('a', 0, 0, 6, 2), p('b', 6, 0, 6, 2))).toBe(false);
    expect(rectsOverlap(p('a', 0, 0, 6, 2), p('b', 0, 2, 6, 2))).toBe(false);
  });

  it('un seul coin en commun suffit à recouvrir', () => {
    expect(rectsOverlap(p('a', 0, 0, 3, 2), p('b', 2, 1, 3, 2))).toBe(true);
  });

  it('un rectangle inclus dans un autre se recouvre', () => {
    expect(rectsOverlap(p('a', 0, 0, 12, 4), p('b', 4, 1, 3, 1))).toBe(true);
    expect(rectsOverlap(p('b', 4, 1, 3, 1), p('a', 0, 0, 12, 4))).toBe(true);
  });

  it('le recouvrement est symétrique', () => {
    const rng = makeRng(9001);
    for (let i = 0; i < 500; i++) {
      const a = p(
        'a',
        Math.floor(rng() * 12),
        Math.floor(rng() * 8),
        1 + Math.floor(rng() * 6),
        1 + Math.floor(rng() * 4)
      );
      const b = p(
        'b',
        Math.floor(rng() * 12),
        Math.floor(rng() * 8),
        1 + Math.floor(rng() * 6),
        1 + Math.floor(rng() * 4)
      );
      expect(rectsOverlap(a, b)).toBe(rectsOverlap(b, a));
    }
  });

  it('collisionsFor sait s’ignorer lui-même', () => {
    const items = [p('a', 0, 0, 3, 2), p('b', 2, 1, 3, 2)];
    expect(collisionsFor(items[0], items).map((i) => i.id)).toEqual(['a', 'b']);
    expect(collisionsFor(items[0], items, 'a').map((i) => i.id)).toEqual(['b']);
  });
});

// ==================== Bornage ====================

describe('clampPlacement', () => {
  it('ramène une largeur trop grande au nombre de colonnes', () => {
    expect(clampPlacement(p('a', 0, 0, 12, 2), 6)).toEqual(p('a', 0, 0, 6, 2));
  });

  it('recule un widget qui déborde à droite', () => {
    expect(clampPlacement(p('a', 10, 0, 4, 2), 12)).toEqual(p('a', 8, 0, 4, 2));
  });

  it('refuse les coordonnées négatives et les dimensions nulles', () => {
    expect(clampPlacement(p('a', -3, -5, 0, 0), 12)).toEqual(p('a', 0, 0, 1, 1));
  });

  it('arrondit les fractions (une case n’existe pas à moitié)', () => {
    expect(clampPlacement(p('a', 1.4, 2.6, 3.2, 1.5), 12)).toEqual(p('a', 1, 3, 3, 2));
  });
});

// ==================== Compaction ====================

describe('compaction — gravité vers le haut', () => {
  it('fait tomber un widget isolé jusqu’en haut', () => {
    expect(show(compactLayout([p('a', 3, 7, 3, 2)], 12))).toEqual(['a@3,0 3x2']);
  });

  it('empile deux widgets de la même colonne, sans les fusionner', () => {
    const out = compactLayout([p('a', 0, 4, 3, 2), p('b', 0, 9, 3, 1)], 12);
    expect(show(out)).toEqual(['a@0,0 3x2', 'b@0,2 3x1']);
  });

  it('laisse monter en parallèle deux widgets de colonnes disjointes', () => {
    const out = compactLayout([p('a', 0, 5, 3, 2), p('b', 6, 9, 3, 4)], 12);
    expect(show(out)).toEqual(['a@0,0 3x2', 'b@6,0 3x4']);
  });

  it('ne fait PAS de remplissage dense : un trou volontaire reste un trou', () => {
    // `a` occupe les colonnes 0-2 en haut, `b` les colonnes 6-8 plus bas. La
    // colonne 3-5 reste vide et personne ne vient s'y glisser : c'est la
    // différence entre une grille et `grid-auto-flow: dense`.
    const out = compactLayout([p('a', 0, 0, 3, 2), p('b', 6, 3, 3, 2)], 12);
    expect(show(out)).toEqual(['a@0,0 3x2', 'b@6,0 3x2']);
    const holes = out.filter((i) => i.x === 3);
    expect(holes).toHaveLength(0);
  });

  it('un widget large sert de plancher à tous ceux qu’il croise', () => {
    const out = compactLayout([p('full', 0, 0, 12, 2), p('a', 0, 5, 3, 1), p('b', 9, 8, 3, 1)], 12);
    expect(show(out)).toEqual(['full@0,0 12x2', 'a@0,2 3x1', 'b@9,2 3x1']);
  });

  it('ne fait pas remonter un widget PAR-DESSUS un obstacle (gravité, pas téléportation)', () => {
    // Colonnes 2-3 bloquées de 0 à 5 par `tall`. `low` est en colonnes 0-3 : il
    // tombe jusqu'à la rangée 5, il ne se faufile pas dans le trou des colonnes
    // 0-1 qui, lui, reste libre.
    const out = compactLayout([p('tall', 2, 0, 2, 5), p('low', 0, 8, 4, 1)], 12);
    expect(show(out)).toEqual(['tall@2,0 2x5', 'low@0,5 4x1']);
  });

  it('résout un chevauchement d’entrée sans rien perdre', () => {
    const out = compactLayout([p('a', 0, 0, 6, 2), p('b', 0, 0, 6, 2), p('c', 0, 1, 6, 2)], 12);
    expect(out).toHaveLength(3);
    expectNoOverlap(out);
    // Départage par identifiant : la sortie est la MÊME sur deux appareils.
    expect(show(out)).toEqual(['a@0,0 6x2', 'b@0,2 6x2', 'c@0,4 6x2']);
  });

  it('est idempotente sur des exemples empilés', () => {
    const once = compactLayout([p('a', 0, 3, 6, 2), p('b', 3, 9, 6, 3), p('c', 0, 1, 3, 1)], 12);
    expect(show(compactLayout(once, 12))).toEqual(show(once));
  });

  it('ne dépend pas de l’ordre du tableau d’entrée', () => {
    const items = [p('a', 0, 0, 6, 2), p('b', 6, 0, 6, 2), p('c', 0, 2, 12, 2)];
    const forward = show(compactLayout(items, 12));
    const backward = show(compactLayout([...items].reverse(), 12));
    expect(backward).toEqual(forward);
  });

  it('normalizeLayout est bien la compaction', () => {
    const items = [p('a', 0, 4, 3, 2), p('b', 0, 9, 3, 1)];
    expect(show(normalizeLayout(items, 12))).toEqual(show(compactLayout(items, 12)));
  });
});

describe('compaction — invariants sur 300 dispositions engendrées', () => {
  it('sortie sans chevauchement, dans la grille, sans rien qui flotte, et idempotente', () => {
    const rng = makeRng(20260822);
    for (let round = 0; round < 300; round++) {
      const columns: GridColumnCount = ([12, 6, 1] as const)[round % 3];
      const layout = randomLayout(rng, 1 + Math.floor(rng() * 14), columns);

      const once = compactLayout(layout, columns);
      expect(once).toHaveLength(layout.length);
      expectNoOverlap(once);
      expectInsideGrid(once, columns);
      expectGravity(once);

      const twice = compactLayout(once, columns);
      expect(show(twice)).toEqual(show(once));
    }
  });
});

// ==================== Emplacement libre & insertion ====================

describe('premier emplacement libre', () => {
  it('rend le coin haut-gauche d’une grille vide', () => {
    expect(findFreeSpot([], 3, 2, 12)).toEqual({ x: 0, y: 0 });
  });

  it('se pose à droite quand la place est à droite', () => {
    expect(findFreeSpot([p('a', 0, 0, 6, 2)], 6, 2, 12)).toEqual({ x: 6, y: 0 });
  });

  it('descend d’une rangée quand la première est pleine', () => {
    const full = [p('a', 0, 0, 6, 2), p('b', 6, 0, 6, 2)];
    expect(findFreeSpot(full, 6, 2, 12)).toEqual({ x: 0, y: 2 });
  });

  it('balaie de haut en bas puis de gauche à droite (ordre de lecture)', () => {
    // Un trou en (3,0) et un autre en (0,2). C'est celui du HAUT qui gagne.
    const items = [p('a', 0, 0, 3, 1), p('b', 6, 0, 6, 1), p('c', 3, 1, 9, 1)];
    expect(findFreeSpot(items, 3, 1, 12)).toEqual({ x: 3, y: 0 });
  });

  it('respecte le plancher minY et ne remonte jamais au-dessus', () => {
    const items = [p('a', 0, 0, 3, 1)];
    expect(findFreeSpot(items, 3, 1, 12, 4)).toEqual({ x: 0, y: 4 });
  });

  it('rend un emplacement sous tout le monde quand rien ne convient', () => {
    const items = [p('a', 0, 0, 12, 3)];
    expect(findFreeSpot(items, 12, 1, 12)).toEqual({ x: 0, y: 3 });
  });
});

describe('insertion', () => {
  it('pose le nouveau venu au premier trou, pas en bas de page', () => {
    const items = [p('a', 0, 0, 6, 2), p('b', 0, 2, 12, 2)];
    const out = insertItem(items, { id: 'new', w: 6, h: 2 }, 12);
    expect(show(out)).toEqual(['a@0,0 6x2', 'new@6,0 6x2', 'b@0,2 12x2']);
  });

  it('n’écrase jamais un widget existant', () => {
    const rng = makeRng(4242);
    for (let round = 0; round < 120; round++) {
      const base = compactLayout(randomLayout(rng, 6, 12), 12);
      const size = GRID_SIZES[Math.floor(rng() * GRID_SIZES.length)];
      const out = insertItem(base, { id: 'new', w: size.w, h: size.h }, 12);
      expect(out).toHaveLength(base.length + 1);
      expectNoOverlap(out);
      expectInsideGrid(out, 12);
    }
  });

  it('borne le nouveau venu à la largeur disponible', () => {
    const out = insertItem([], { id: 'full', w: 12, h: 2 }, 6);
    expect(show(out)).toEqual(['full@0,0 6x2']);
  });
});

// ==================== Déplacement ====================

describe('déplacement avec poussée des voisins', () => {
  it('pousse vers le BAS celui qu’on recouvre, jamais l’inverse', () => {
    const items = [p('a', 0, 0, 6, 2), p('b', 0, 2, 6, 2)];
    const out = moveItem(items, 'b', 0, 0, 12);
    // `b` prend la place du haut, `a` glisse dessous.
    expect(show(out)).toEqual(['b@0,0 6x2', 'a@0,2 6x2']);
  });

  it('propage la poussée en cascade', () => {
    const items = [p('a', 0, 0, 12, 1), p('b', 0, 1, 12, 1), p('c', 0, 2, 12, 1)];
    const out = moveItem(items, 'c', 0, 0, 12);
    expect(show(out)).toEqual(['c@0,0 12x1', 'a@0,1 12x1', 'b@0,2 12x1']);
  });

  it('déposer plus bas dans une colonne vide laisse la gravité rattraper', () => {
    const items = [p('a', 0, 0, 3, 2), p('b', 3, 0, 3, 2)];
    const out = moveItem(items, 'b', 6, 5, 12);
    expect(show(out)).toEqual(['a@0,0 3x2', 'b@6,0 3x2']);
  });

  it('déposer SOUS une pile existante s’y range en dernier, sans la bousculer', () => {
    const items = [p('a', 0, 0, 3, 2), p('b', 0, 2, 3, 2), p('c', 6, 0, 3, 1)];
    const out = moveItem(items, 'c', 0, 6, 12);
    expect(show(out)).toEqual(['a@0,0 3x2', 'b@0,2 3x2', 'c@0,4 3x1']);
  });

  it('borne le dépôt hors grille au lieu de le refuser', () => {
    const out = moveItem([p('a', 0, 0, 4, 2)], 'a', 99, -5, 12);
    expect(show(out)).toEqual(['a@8,0 4x2']);
  });

  it('un identifiant inconnu laisse la disposition en règle, sans lever', () => {
    const items = [p('a', 0, 4, 3, 2)];
    expect(show(moveItem(items, 'fantome', 0, 0, 12))).toEqual(['a@0,0 3x2']);
  });

  it('rejouer le même déplacement depuis l’origine ne dérive pas', () => {
    // Ce que fait le geste à chaque image de la souris : repartir de la MÊME
    // disposition de départ. Le résultat ne doit dépendre que de la cible.
    const items = [p('a', 0, 0, 6, 2), p('b', 6, 0, 6, 2), p('c', 0, 2, 12, 2)];
    const once = moveItem(items, 'a', 6, 2, 12);
    for (let i = 0; i < 5; i++) {
      expect(show(moveItem(items, 'a', 6, 2, 12))).toEqual(show(once));
    }
  });

  it('invariants tenus sur 300 déplacements engendrés', () => {
    const rng = makeRng(1337);
    for (let round = 0; round < 300; round++) {
      const base = compactLayout(randomLayout(rng, 2 + Math.floor(rng() * 10), 12), 12);
      const victim = base[Math.floor(rng() * base.length)];
      const out = moveItem(base, victim.id, Math.floor(rng() * 14) - 1, Math.floor(rng() * 12), 12);
      expect(out).toHaveLength(base.length);
      expectNoOverlap(out);
      expectInsideGrid(out, 12);
      expectGravity(out);
    }
  });
});

// ==================== Redimensionnement ====================

describe('redimensionnement', () => {
  it('pousse ce que la nouvelle taille recouvre', () => {
    const items = [p('a', 0, 0, 3, 1), p('b', 0, 1, 3, 1)];
    const out = resizeItem(items, 'a', 3, 2, 12);
    expect(show(out)).toEqual(['a@0,0 3x2', 'b@0,2 3x1']);
  });

  it('recule le widget plutôt que de le rétrécir quand il déborde à droite', () => {
    const out = resizeItem([p('a', 9, 0, 3, 1)], 'a', 6, 2, 12);
    expect(show(out)).toEqual(['a@6,0 6x2']);
  });

  it('rétrécir libère la place et la gravité la rend', () => {
    const items = [p('a', 0, 0, 12, 3), p('b', 0, 3, 3, 1)];
    const out = resizeItem(items, 'a', 3, 1, 12);
    expect(show(out)).toEqual(['a@0,0 3x1', 'b@0,1 3x1']);
  });

  it('invariants tenus sur 200 redimensionnements engendrés', () => {
    const rng = makeRng(777);
    for (let round = 0; round < 200; round++) {
      const base = compactLayout(randomLayout(rng, 2 + Math.floor(rng() * 8), 12), 12);
      const victim = base[Math.floor(rng() * base.length)];
      const size = GRID_SIZES[Math.floor(rng() * GRID_SIZES.length)];
      const out = resizeItem(base, victim.id, size.w, size.h, 12);
      expect(out).toHaveLength(base.length);
      expectNoOverlap(out);
      expectInsideGrid(out, 12);
      expectGravity(out);
    }
  });
});

describe('retrait', () => {
  it('retire et rattrape la gravité derrière', () => {
    const items = [p('a', 0, 0, 3, 2), p('b', 0, 2, 3, 2), p('c', 0, 4, 3, 2)];
    expect(show(removeItem(items, 'b', 12))).toEqual(['a@0,0 3x2', 'c@0,2 3x2']);
  });

  it('retirer un inconnu ne perd personne', () => {
    const items = [p('a', 0, 0, 3, 2)];
    expect(removeItem(items, 'fantome', 12)).toHaveLength(1);
  });
});

// ==================== Projection ====================

describe('projection 12 → 6 → 1', () => {
  const master = [
    p('hero', 0, 0, 12, 2), // pleine largeur
    p('left', 0, 2, 6, 3), // large
    p('right', 6, 2, 3, 2), // carré
    p('corner', 9, 2, 3, 1), // tuile
  ];

  it('à 12 colonnes, ne fait que remettre en règle', () => {
    expect(show(projectLayout(master, 12))).toEqual([
      'hero@0,0 12x2',
      'left@0,2 6x3',
      'right@6,2 3x2',
      'corner@9,2 3x1',
    ]);
  });

  it('à 6 colonnes, borne les largeurs et garde l’ORDRE DE LECTURE', () => {
    const out = projectLayout(master, 6);
    expectNoOverlap(out);
    expectInsideGrid(out, 6);
    // hero (12→6) puis left (6) puis right (3) et corner (3) côte à côte.
    expect(show(out)).toEqual(['hero@0,0 6x2', 'left@0,2 6x3', 'right@0,5 3x2', 'corner@3,5 3x1']);
  });

  it('à 1 colonne, empile dans l’ordre de lecture en conservant les hauteurs', () => {
    expect(show(projectLayout(master, 1))).toEqual([
      'hero@0,0 1x2',
      'left@0,2 1x3',
      'right@0,5 1x2',
      'corner@0,7 1x1',
    ]);
  });

  /**
   * LE REPLI NE TOUCHE PAS À LA HAUTEUR — et c'est une décision, pas un oubli.
   *
   * `projectLayout` ne dérive QUE la largeur : une case garde ses rangées à six
   * et à une colonne. Rétrécir aussi la hauteur au passage donnerait un bloc qui
   * n'est plus celui que l'auteur a réglé, et surtout un repli qui n'est plus
   * une fonction inversible de la disposition maîtresse.
   *
   * Ce n'est pas un gâchis pour un 12×6 : les blocs à qui on accorde une pleine
   * largeur haute portent des cartes en trois ou quatre colonnes (feuille de
   * style), et ces colonnes retombent à une sur un écran étroit. Le contenu y
   * devient donc PLUS haut, pas plus court — les six rangées y sont encore plus
   * justifiées qu'en large. Le bloc « Tous les dossiers », lui, remplit et fait
   * défiler sa case : la hauteur y est de la liste visible, à toutes les largeurs.
   */
  it('une pleine largeur HAUTE se replie en largeur et garde ses rangées', () => {
    const seeded = [p('stats', 0, 0, 12, 2), p('folders', 0, 2, 12, 6), p('recents', 0, 8, 12, 3)];

    const six = projectLayout(seeded, 6);
    expect(show(six)).toEqual(['stats@0,0 6x2', 'folders@0,2 6x6', 'recents@0,8 6x3']);
    expectNoOverlap(six);
    expectInsideGrid(six, 6);

    const one = projectLayout(seeded, 1);
    expect(show(one)).toEqual(['stats@0,0 1x2', 'folders@0,2 1x6', 'recents@0,8 1x3']);
    expectNoOverlap(one);
    expectInsideGrid(one, 1);

    // La hauteur est CONSERVÉE à l'identique, à toutes les largeurs.
    for (const columns of [12, 6, 1] as const) {
      const byId = new Map(projectLayout(seeded, columns).map((i) => [i.id, i.h]));
      expect(byId.get('folders')).toBe(6);
    }
  });

  it('un 12×4 et un 12×6 voisinent avec des petits blocs sans les écraser', () => {
    // Le vrai mélange d'un accueil réglé à la main : deux pleines largeurs
    // hautes et deux tuiles. Rien ne se recouvre, rien ne flotte, à trois
    // largeurs.
    const mixed = [
      p('panel', 0, 0, 12, 4),
      p('tileA', 0, 4, 3, 1),
      p('tileB', 3, 4, 3, 1),
      p('page', 0, 5, 12, 6),
    ];
    for (const columns of [12, 6, 1] as const) {
      const out = projectLayout(mixed, columns);
      expect(out).toHaveLength(mixed.length);
      expectNoOverlap(out);
      expectInsideGrid(out, columns);
      expectGravity(out);
    }
  });

  it('l’ordre de lecture du repli est CELUI de la grille large, pas l’ordre du tableau', () => {
    const scrambled = [master[3], master[1], master[0], master[2]];
    expect(show(projectLayout(scrambled, 1)).map((s) => s.split('@')[0])).toEqual([
      'hero',
      'left',
      'right',
      'corner',
    ]);
  });

  it('est déterministe : mêmes entrées, même sortie, quel que soit l’ordre du tableau', () => {
    const rng = makeRng(31415);
    for (let round = 0; round < 200; round++) {
      const layout = compactLayout(randomLayout(rng, 2 + Math.floor(rng() * 10), 12), 12);
      const shuffled = [...layout].sort(() => (rng() < 0.5 ? -1 : 1));
      for (const columns of [12, 6, 1] as const) {
        const a = projectLayout(layout, columns);
        const b = projectLayout(shuffled, columns);
        expect(show(b)).toEqual(show(a));
        expectNoOverlap(a);
        expectInsideGrid(a, columns);
      }
    }
  });

  it('ne perd ni ne duplique aucun widget, à toutes les largeurs', () => {
    const rng = makeRng(2718);
    for (let round = 0; round < 200; round++) {
      const layout = randomLayout(rng, 1 + Math.floor(rng() * 12), 12);
      for (const columns of [12, 6, 1] as const) {
        const out = projectLayout(layout, columns);
        expect(out.map((i) => i.id).sort()).toEqual(layout.map((i) => i.id).sort());
      }
    }
  });

  it('à 6 colonnes, le repli ne remonte jamais un widget au-dessus de son aîné', () => {
    const rng = makeRng(161803);
    for (let round = 0; round < 200; round++) {
      const layout = compactLayout(randomLayout(rng, 2 + Math.floor(rng() * 10), 12), 12);
      const order = sortReadingOrder(layout).map((i) => i.id);
      const out = projectLayout(layout, 6);
      const byId = new Map(out.map((i) => [i.id, i]));
      for (let i = 1; i < order.length; i++) {
        const prev = byId.get(order[i - 1]) as GridPlacement;
        const cur = byId.get(order[i]) as GridPlacement;
        expect(
          cur.y,
          `${order[i]} est remonté au-dessus de ${order[i - 1]}`
        ).toBeGreaterThanOrEqual(prev.y);
      }
    }
  });

  it('la projection est stable : la rejouer sur son propre résultat ne bouge plus', () => {
    // Ce qui compte pour la synchronisation : la disposition MAÎTRESSE n'est
    // jamais réécrite depuis un repli, mais si elle l'était par accident, le
    // repli à 12 colonnes doit être un point fixe.
    const rng = makeRng(5772);
    for (let round = 0; round < 100; round++) {
      const layout = randomLayout(rng, 1 + Math.floor(rng() * 10), 12);
      const once = projectLayout(layout, 12);
      expect(show(projectLayout(once, 12))).toEqual(show(once));
    }
  });
});

// ==================== Formats ====================

describe('catalogue de formats', () => {
  it('les huit formats sont exactement ceux annoncés', () => {
    expect(GRID_SIZES.map((s) => `${s.id} ${s.w}x${s.h}`)).toEqual([
      'tile 3x1',
      'square 3x2',
      'band 6x2',
      'wide 6x3',
      'full 12x2',
      'panel 12x4',
      'page 12x6',
      'tall 4x4',
    ]);
  });

  it('les trois pleines largeurs se suivent et grandissent', () => {
    // Ce qu'un bloc qui n'accepte QUE des pleines largeurs voit défiler : sa
    // hauteur double, puis triple, puis revient. Si l'ordre du catalogue changeait,
    // le cycle sauterait de 12×6 à 12×4 sans raison visible à l'écran.
    const fullWidth = GRID_SIZES.filter((s) => s.w === GRID_COLUMNS);
    expect(fullWidth.map((s) => s.id)).toEqual(['full', 'panel', 'page']);
    expect(fullWidth.map((s) => s.h)).toEqual([2, 4, 6]);
    const indexes = fullWidth.map((s) => GRID_SIZES.findIndex((c) => c.id === s.id));
    expect(indexes).toEqual([indexes[0], indexes[0] + 1, indexes[0] + 2]);
  });

  it('la HAUTEUR QUE L’AMORÇAGE ÉCRIT porte enfin un nom', () => {
    // Le défaut d'origine : `seedLayoutDocument` pose « Tous les dossiers » en
    // 12×6, mais le catalogue s'arrêtait à 12×2. `sizeIdOf` rendait donc `null`,
    // l'inspecteur n'affichait aucun format, et le cycle repartait de zéro en
    // écrasant quatre rangées. Un catalogue fermé doit nommer ce que les
    // dispositions écrivent vraiment.
    expect(sizeIdOf(12, 6)).toBe('page');
    expect(sizeIdOf(12, 4)).toBe('panel');
  });

  it('aucun format ne dépasse la grille maîtresse', () => {
    for (const size of GRID_SIZES) {
      expect(size.w).toBeLessThanOrEqual(GRID_COLUMNS);
    }
  });

  it('sizeIdOf reconnaît un format et refuse d’en inventer un', () => {
    expect(sizeIdOf(6, 2)).toBe('band');
    expect(sizeIdOf(5, 1)).toBeNull();
  });

  it('gridSize lève sur un identifiant inconnu', () => {
    expect(() => gridSize('nope' as never)).toThrow();
  });

  it('allowedSizeList garde l’ordre du CATALOGUE, pas celui de la déclaration', () => {
    expect(allowedSizeList(['full', 'tile']).map((s) => s.id)).toEqual(['tile', 'full']);
  });

  it('une liste vide ou entièrement inconnue rend les huit', () => {
    expect(allowedSizeList([]).map((s) => s.id)).toHaveLength(GRID_SIZES.length);
    expect(allowedSizeList(['zzz' as never]).map((s) => s.id)).toHaveLength(GRID_SIZES.length);
  });
});

describe('cycle de formats', () => {
  it('avance dans l’ordre du catalogue et boucle', () => {
    expect(cycleSize('tile').id).toBe('square');
    expect(cycleSize('tall').id).toBe('tile');
  });

  it('recule et boucle dans l’autre sens', () => {
    expect(cycleSize('tile', undefined, -1).id).toBe('tall');
    expect(cycleSize('square', undefined, -1).id).toBe('tile');
  });

  it('ne propose que les formats autorisés', () => {
    const allowed = ['tile', 'band'] as const;
    expect(cycleSize('tile', allowed).id).toBe('band');
    expect(cycleSize('band', allowed).id).toBe('tile');
  });

  it('un format courant hors catalogue repart du début', () => {
    expect(cycleSize(null).id).toBe('tile');
    expect(cycleSize(null, undefined, -1).id).toBe('tall');
  });

  it('un seul format autorisé : le cycle reste dessus, il ne casse pas', () => {
    expect(cycleSize('band', ['band']).id).toBe('band');
  });

  it('boucler sur tout le cycle revient au point de départ', () => {
    let current = GRID_SIZES[0].id;
    for (let i = 0; i < GRID_SIZES.length; i++) current = cycleSize(current).id;
    expect(current).toBe(GRID_SIZES[0].id);
  });
});

/**
 * Le cas de « Tous les dossiers » : un bloc qui ne PROPOSE que des pleines
 * largeurs en raccourci. Le cycle doit y parcourir les trois hauteurs nommées —
 * il était cassé quand le catalogue n'en offrait qu'une seule.
 *
 * Ce que ce bloc a aussi révélé, et qui a coûté la loi du catalogue : ses trois
 * formats faisaient tous douze de large, donc la poignée d'angle ne pouvait
 * RIEN changer à sa largeur, et sa hauteur butait sur le plus grand format
 * nommé. « Je n'arrive pas à redimensionner en largeur » et « ça s'arrête au
 * troisième niveau » sont exactement ces deux phrases-là. La liste de formats ne
 * borne plus la poignée : elle ne fait que peupler le raccourci.
 */
describe('un bloc qui ne PROPOSE que des pleines largeurs', () => {
  const FULL_WIDTHS = ['full', 'panel', 'page'] as const;

  it('le cycle parcourt les trois hauteurs, dans l’ordre croissant, et boucle', () => {
    expect(cycleSize('full', FULL_WIDTHS).id).toBe('panel');
    expect(cycleSize('panel', FULL_WIDTHS).id).toBe('page');
    expect(cycleSize('page', FULL_WIDTHS).id).toBe('full');
  });

  it('et il recule dans l’autre sens sans jamais buter', () => {
    expect(cycleSize('page', FULL_WIDTHS, -1).id).toBe('panel');
    expect(cycleSize('panel', FULL_WIDTHS, -1).id).toBe('full');
    expect(cycleSize('full', FULL_WIDTHS, -1).id).toBe('page');
  });

  it('trois clics ramènent le bloc là où il était', () => {
    let id = cycleSize(null, FULL_WIDTHS).id;
    expect(id).toBe('full');
    for (let i = 0; i < FULL_WIDTHS.length; i++) id = cycleSize(id, FULL_WIDTHS).id;
    expect(id).toBe('full');
  });

  it('la poignée fabrique DÉSORMAIS des largeurs partielles, raccourcis ou pas', () => {
    // L'ancienne suite affirmait l'inverse, et c'était le bug : ce bloc ne
    // proposant que des pleines largeurs, l'aimantation le ramenait à douze
    // colonnes quoi qu'on fasse. Sans contrainte déclarée, la poignée suit le
    // curseur, et rétrécir de six colonnes rend un 6×2.
    const block = p('folders', 0, 0, 12, 2);
    expect(dragCorner(block, -6, 0)).toEqual({ w: 6, h: 2 });
    expect(dragCorner(block, -9, 0)).toEqual({ w: 3, h: 2 });
    expect(dragCorner(block, -11, 0)).toEqual({ w: 1, h: 2 });
    // Et la largeur obtenue n'a plus besoin de porter un nom.
    expect(sizeIdOf(dragCorner(block, -7, 0).w, 2)).toBeNull();
  });

  it('la hauteur ne s’arrête plus au plus grand format nommé', () => {
    // « Quand on veut le rendre très grand en hauteur il s'arrête au troisième
    // niveau » : le troisième niveau, c'était 12×6, le plus grand format nommé.
    const block = p('folders', 0, 0, 12, 2);
    expect(dragCorner(block, 0, 4).h).toBe(6);
    expect(dragCorner(block, 0, 10).h).toBe(12);
    expect(dragCorner(block, 0, 30).h).toBe(32);
  });

  it('le cycle n’écrase plus la hauteur que l’amorçage a écrite', () => {
    // L'accueil tel que `seedLayoutDocument` le pose : le bandeau de chiffres,
    // « Tous les dossiers » en 12×6, les notes récentes dessous. Avant, un clic
    // sur la prise de format ramenait le bloc du milieu à 12×2 — quatre rangées
    // perdues, et aucun moyen de les retrouver.
    const seeded = [p('stats', 0, 0, 12, 2), p('folders', 0, 2, 12, 6), p('recents', 0, 8, 12, 3)];

    // Le bloc est en 12×6 : ce format est désormais RECONNU, donc le cycle
    // repart de lui et reboucle sur le plus petit au lieu de partir de nulle part.
    const afterClick = gridSize(cycleSize(sizeIdOf(12, 6), FULL_WIDTHS).id);
    expect(`${afterClick.w}x${afterClick.h}`).toBe('12x2');

    const shrunk = resizeItem(seeded, 'folders', 12, 4, 12);
    expect(show(shrunk)).toEqual(['stats@0,0 12x2', 'folders@0,2 12x4', 'recents@0,6 12x3']);
    expectNoOverlap(shrunk);
    expectGravity(shrunk);

    // Et le chemin inverse rend exactement la disposition de départ.
    expect(show(resizeItem(shrunk, 'folders', 12, 6, 12))).toEqual(show(seeded));
  });
});

/**
 * `snapToAllowedSize` a changé de RÔLE, pas de calcul : elle ne borne plus le
 * geste (ce serait le bug), elle rapproche une géométrie d'un format nommé pour
 * qui veut suggérer ou étiqueter. Les tests de calcul restent ; l'affirmation
 * « un 5×1 est infabricable » disparaît — elle est devenue fausse.
 */
describe('rapprochement d’un format nommé', () => {
  it('reconnaît une dimension exacte', () => {
    expect(snapToAllowedSize(6, 2).id).toBe('band');
  });

  it('un 5×1 est désormais PARFAITEMENT fabricable — le rapprochement n’est qu’un avis', () => {
    // Ce que la poignée pose vraiment : la valeur brute.
    expect(dragCorner(p('a', 0, 0, 3, 1), 2, 0)).toEqual({ w: 5, h: 1 });
    // Ce que le solveur en fait : un 5×1 posé, gardé, replié.
    expect(show(resizeItem([p('a', 0, 0, 3, 1)], 'a', 5, 1, 12))).toEqual(['a@0,0 5x1']);
    // Et ce que la fonction de rapprochement en dit, si on le lui demande : le
    // format nommé le plus proche — un AVIS, qui n'a pas été appliqué.
    expect(snapToAllowedSize(5, 1).id).toBe('band');
    expect(sizeIdOf(5, 1)).toBeNull();
  });

  it('choisit bien le plus proche au sens euclidien', () => {
    // (5,1) : tile(3,1)=4, square(3,2)=5, band(6,2)=2 → band.
    expect(snapToAllowedSize(5, 1).id).toBe('band');
    // (13,2) déborde : full(12,2)=1 gagne.
    expect(snapToAllowedSize(13, 2).id).toBe('full');
    // (4,4) est un format exact.
    expect(snapToAllowedSize(4, 4).id).toBe('tall');
  });

  it('ne sort jamais de la liste autorisée', () => {
    const rng = makeRng(8080);
    const allowed = ['tile', 'tall'] as const;
    for (let i = 0; i < 200; i++) {
      const snapped = snapToAllowedSize(Math.floor(rng() * 15), Math.floor(rng() * 8), allowed);
      expect(allowed).toContain(snapped.id);
    }
  });

  it('est déterministe (les ex æquo tranchés par l’ordre du catalogue)', () => {
    const first = snapToAllowedSize(4.5, 1.5).id;
    for (let i = 0; i < 20; i++) expect(snapToAllowedSize(4.5, 1.5).id).toBe(first);
  });
});

// ==================== Contraintes & redimensionnement libre ====================

/**
 * LE CONTRAT QUI A REMPLACÉ LE CATALOGUE FERMÉ.
 *
 * Un widget ne choisit plus dans un menu de huit rectangles : il déclare un
 * plancher, éventuellement un plafond, et l'utilisateur fait ce qu'il veut entre
 * les deux. Ce qui se teste ici, c'est surtout ce qu'une déclaration ABSENTE ou
 * bancale produit — parce que c'est le cas courant (aucun widget n'a de
 * contrainte tant que le registre ne l'a pas dit) et parce qu'une borne fausse
 * rend un bloc intouchable sans que rien ne le signale.
 */
describe('contraintes de taille', () => {
  it('sans déclaration, tout est libre : de 1×1 aux douze colonnes, hauteur non bornée', () => {
    expect(resolveConstraints(undefined)).toEqual({
      minW: 1,
      minH: 1,
      maxW: GRID_COLUMNS,
      maxH: Number.POSITIVE_INFINITY,
    });
    expect(clampToConstraints(7, 3)).toEqual({ w: 7, h: 3 });
    expect(clampToConstraints(0, 0)).toEqual({ w: 1, h: 1 });
    expect(clampToConstraints(99, 99)).toEqual({ w: GRID_COLUMNS, h: 99 });
  });

  it('le plancher tient, sur les deux axes et indépendamment', () => {
    const c = { minW: 4, minH: 2 };
    expect(clampToConstraints(1, 1, c)).toEqual({ w: 4, h: 2 });
    expect(clampToConstraints(9, 1, c)).toEqual({ w: 9, h: 2 });
    expect(clampToConstraints(1, 9, c)).toEqual({ w: 4, h: 9 });
  });

  it('le plafond tient, et un axe sans plafond reste libre', () => {
    expect(clampToConstraints(12, 40, { maxW: 6 })).toEqual({ w: 6, h: 40 });
    expect(clampToConstraints(12, 40, { maxH: 4 })).toEqual({ w: GRID_COLUMNS, h: 4 });
  });

  it('une déclaration bancale ne peut pas verrouiller un bloc', () => {
    // À l'envers : le plancher gagne, on ne rend jamais un intervalle vide.
    expect(clampToConstraints(1, 1, { minW: 6, maxW: 2 })).toEqual({ w: 6, h: 1 });
    // Fractionnaire, négative, absurde : arrondie et ramenée dans la grille.
    expect(clampToConstraints(3, 3, { minW: 2.4, minH: -5, maxW: 40 })).toEqual({ w: 3, h: 3 });
    expect(resolveConstraints({ minW: 99 }).minW).toBe(GRID_COLUMNS);
    // Un `NaN` venu d'un registre bricolé ne doit rien immobiliser.
    expect(resolveConstraints({ minW: Number.NaN, maxH: Number.NaN })).toEqual({
      minW: 1,
      minH: 1,
      maxW: GRID_COLUMNS,
      maxH: Number.POSITIVE_INFINITY,
    });
  });

  it('la place disponible plafonne la largeur, mais le plancher passe devant', () => {
    // Un bloc collé à droite (x = 9) n'a que trois colonnes devant lui.
    expect(clampToConstraints(12, 1, undefined, 3)).toEqual({ w: 3, h: 1 });
    // …sauf s'il en exige six : mieux vaut un bloc que le solveur recule qu'un
    // bloc plus petit que son contenu.
    expect(clampToConstraints(12, 1, { minW: 6 }, 3)).toEqual({ w: 6, h: 1 });
  });

  it('isResizable ne ment pas sur une prise qui ne peut rien changer', () => {
    expect(isResizable(undefined)).toBe(true);
    expect(isResizable({ minW: 12, maxW: 12, minH: 2, maxH: 6 })).toBe(true);
    expect(isResizable({ minW: 12, maxW: 12, minH: 2, maxH: 2 })).toBe(false);
    expect(isResizable({ minW: 3, maxW: 3, minH: 1, maxH: 1 })).toBe(false);
  });

  it('constraintsFromSizes rend le rectangle ENGLOBANT d’une liste de formats', () => {
    // La passerelle pour un appelant qui n'a déclaré que des formats nommés.
    expect(constraintsFromSizes(['full', 'panel', 'page'])).toEqual({
      minW: 12,
      minH: 2,
      maxW: 12,
      maxH: 6,
    });
    // Elle BORNE, elle n'énumère pas : le 4×1 devient possible, et c'est voulu.
    expect(constraintsFromSizes(['tile', 'tall'])).toEqual({
      minW: 3,
      minH: 1,
      maxW: 4,
      maxH: 4,
    });
  });
});

/**
 * LE GESTE, côté calcul.
 *
 * Trois symptômes rapportés, trois propriétés à tenir : la largeur se règle (et
 * pas seulement sur quatre valeurs), la hauteur ne bute plus, et tirer vers le
 * bas ne touche JAMAIS à la largeur. Le reste — poussée des voisins, surface qui
 * s'allonge, relâchement fidèle à l'aperçu — est ce qui doit survivre au
 * changement de loi.
 */
describe('redimensionnement libre à la poignée', () => {
  it('toutes les largeurs sont fabricables, pas seulement 3, 4, 6 et 12', () => {
    const block = p('a', 0, 0, 1, 1);
    const widths = new Set<number>();
    for (let dx = 0; dx < GRID_COLUMNS; dx++) widths.add(dragCorner(block, dx, 0).w);
    expect([...widths].sort((l, r) => l - r)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('tirer en HAUTEUR ne change jamais la largeur — ni l’inverse', () => {
    const rng = makeRng(4242);
    for (let i = 0; i < 300; i++) {
      const item = p('a', 0, 0, 1 + Math.floor(rng() * 12), 1 + Math.floor(rng() * 6));
      const dy = Math.floor(rng() * 41) - 20;
      const dx = Math.floor(rng() * 41) - 20;
      expect(dragCorner(item, 0, dy).w, 'un tirage vertical a bougé la largeur').toBe(item.w);
      expect(dragCorner(item, dx, 0).h, 'un tirage horizontal a bougé la hauteur').toBe(item.h);
    }
  });

  it('le bloc ne glisse pas vers la gauche quand on tire au-delà du bord droit', () => {
    // Sans le plafonnement à la place disponible, le solveur reculerait
    // l'abscisse pour faire tenir le bloc : le coin haut-gauche filerait sous le
    // curseur qui tire le coin opposé.
    const block = p('a', 9, 0, 3, 2);
    expect(dragCorner(block, 5, 0)).toEqual({ w: 3, h: 2 });
    const out = resizeItem([block], 'a', dragCorner(block, 5, 0).w, 2, 12);
    expect(show(out)).toEqual(['a@9,0 3x2']);
  });

  it('un bloc qui grandit POUSSE ses voisins et n’en traverse aucun', () => {
    const base = compactLayout([p('a', 0, 0, 5, 2), p('b', 5, 0, 7, 2), p('c', 0, 2, 12, 3)], 12);
    const grown = resizeItem(base, 'a', 5, 5, 12);
    expect(show(grown)).toEqual(['a@0,0 5x5', 'b@5,0 7x2', 'c@0,5 12x3']);
    expectNoOverlap(grown);
    expectGravity(grown);
  });

  it('agrandir en hauteur laisse le bloc EXACTEMENT où il est et pousse ce qu’il recouvre', () => {
    const rng = makeRng(9091);
    for (let round = 0; round < 200; round++) {
      const base = compactLayout(randomFreeLayout(rng, 2 + Math.floor(rng() * 7), 12), 12);
      const victim = base[Math.floor(rng() * base.length)];
      const out = resizeItem(base, victim.id, victim.w, victim.h + 1 + Math.floor(rng() * 6), 12);
      const after = out.find((i) => i.id === victim.id) as GridPlacement;
      // Le bloc tenu à la poignée ne se déplace pas sous le curseur.
      expect(after.x, 'le bloc a glissé en largeur').toBe(victim.x);
      expect(after.y, 'le bloc a été remonté sous le curseur').toBe(victim.y);
      expect(after.w, 'la largeur a bougé pendant un tirage vertical').toBe(victim.w);
      // Et tout ce que le bloc RECOUVRE en grandissant passe dessous, sans
      // jamais le traverser. (Un tiers peut, lui, remonter : si son support
      // s'est fait pousser plus bas, la gravité le rattrape. C'est le modèle,
      // pas un défaut — ce qu'on refuse, c'est un widget suspendu en l'air.)
      const bottom = after.y + after.h;
      for (const other of out) {
        if (other.id === victim.id) continue;
        const before = base.find((i) => i.id === other.id) as GridPlacement;
        // Ce que la nouvelle géométrie recouvre part DESSOUS — jamais au-dessus,
        // jamais au travers.
        if (rectsOverlap(after, before)) {
          expect(other.y, `${other.id} n'a pas été poussé sous le bloc`).toBeGreaterThanOrEqual(
            bottom
          );
        }
      }
      expectNoOverlap(out);
      expectInsideGrid(out, 12);
      expectGravity(out);
    }
  });

  it('la surface s’allonge au lieu de rogner : chaque rangée gagnée compte', () => {
    const base = [p('a', 0, 0, 12, 2)];
    expect(layoutRowCount(base)).toBe(2);
    for (const h of [3, 7, 12, 25]) {
      expect(layoutRowCount(resizeItem(base, 'a', 12, h, 12))).toBe(h);
    }
  });

  it('le relâchement pose EXACTEMENT ce que l’aperçu montrait', () => {
    // L'aperçu du geste est `resizeItem(...)` ; le commit écrit ce tableau tel
    // quel, et la surface le re-projette au rendu suivant. Si la projection
    // bougeait ne serait-ce que d'une case, le bloc sauterait au relâchement.
    const rng = makeRng(1717);
    for (let round = 0; round < 200; round++) {
      const base = compactLayout(randomFreeLayout(rng, 2 + Math.floor(rng() * 7), 12), 12);
      const victim = base[Math.floor(rng() * base.length)];
      const room = GRID_COLUMNS - victim.x;
      const size = clampToConstraints(
        1 + Math.floor(rng() * 12),
        1 + Math.floor(rng() * 12),
        undefined,
        room
      );
      const preview = resizeItem(base, victim.id, size.w, size.h, 12);
      expect(show(projectLayout(preview, 12))).toEqual(show(preview));
      expect(layoutsEqual(compactLayout(preview, 12), preview)).toBe(true);
      // Et la géométrie posée est bien celle que la poignée dictait.
      const after = preview.find((i) => i.id === victim.id) as GridPlacement;
      expect(`${after.w}x${after.h}`).toBe(`${size.w}x${size.h}`);
    }
  });

  it('les invariants tiennent sur 200 redimensionnements HORS catalogue', () => {
    const rng = makeRng(2024);
    for (let round = 0; round < 200; round++) {
      const base = compactLayout(randomFreeLayout(rng, 2 + Math.floor(rng() * 8), 12), 12);
      const victim = base[Math.floor(rng() * base.length)];
      const out = resizeItem(
        base,
        victim.id,
        1 + Math.floor(rng() * 12),
        1 + Math.floor(rng() * 12),
        12
      );
      expect(out).toHaveLength(base.length);
      expectNoOverlap(out);
      expectInsideGrid(out, 12);
      expectGravity(out);
      // Compaction STABLE : repasser dessus ne bouge plus rien.
      expect(layoutsEqual(compactLayout(out, 12), out)).toBe(true);
    }
  });

  it('une géométrie hors catalogue se replie proprement en six et en une colonne', () => {
    // 12×7, 5×3, 7×2 : trois rectangles qu'aucun format ne nomme, et que la
    // poignée fabrique maintenant en trois secondes.
    const master = compactLayout([p('a', 0, 0, 12, 7), p('b', 0, 7, 5, 3), p('c', 5, 7, 7, 2)], 12);
    expect(show(master)).toEqual(['a@0,0 12x7', 'b@0,7 5x3', 'c@5,7 7x2']);

    const six = projectLayout(master, 6);
    expectNoOverlap(six);
    expectInsideGrid(six, 6);
    // Les hauteurs SURVIVENT au repli — c'est ce qu'on demandait au bloc haut.
    expect(sortReadingOrder(six).map((i) => `${i.id} ${i.w}x${i.h}`)).toEqual([
      'a 6x7',
      'b 5x3',
      'c 6x2',
    ]);

    const one = projectLayout(master, 1);
    expect(show(one)).toEqual(['a@0,0 1x7', 'b@0,7 1x3', 'c@0,10 1x2']);

    // Le repli est stable : le rejouer sur son propre résultat ne bouge plus.
    expect(show(projectLayout(six, 6))).toEqual(show(six));
  });

  it('les invariants du repli tiennent aussi sur des dispositions libres', () => {
    const rng = makeRng(3131);
    for (let round = 0; round < 150; round++) {
      const master = compactLayout(randomFreeLayout(rng, 2 + Math.floor(rng() * 8), 12), 12);
      for (const columns of [12, 6, 1] as const) {
        const out = projectLayout(master, columns);
        expect(out).toHaveLength(master.length);
        expectNoOverlap(out);
        expectInsideGrid(out, columns);
        // Les hauteurs ne sont JAMAIS rognées par le repli.
        for (const item of out) {
          const source = master.find((i) => i.id === item.id) as GridPlacement;
          expect(item.h, `${item.id} a perdu de la hauteur en se repliant`).toBe(source.h);
        }
      }
    }
  });
});

// ==================== Comparaison & mesures ====================

describe('layoutsEqual', () => {
  it('ignore l’ordre du tableau', () => {
    const a = [p('a', 0, 0, 3, 2), p('b', 3, 0, 3, 2)];
    expect(layoutsEqual(a, [...a].reverse())).toBe(true);
  });

  it('repère un déplacement d’une seule case', () => {
    expect(layoutsEqual([p('a', 0, 0, 3, 2)], [p('a', 1, 0, 3, 2)])).toBe(false);
  });

  it('repère un ajout, un retrait et un renommage', () => {
    expect(layoutsEqual([p('a', 0, 0, 3, 2)], [])).toBe(false);
    expect(layoutsEqual([p('a', 0, 0, 3, 2)], [p('a', 0, 0, 3, 2), p('b', 3, 0, 3, 2)])).toBe(
      false
    );
    expect(layoutsEqual([p('a', 0, 0, 3, 2)], [p('z', 0, 0, 3, 2)])).toBe(false);
  });
});

describe('mesures', () => {
  it('layoutRowCount rend la rangée sous le plus bas', () => {
    expect(layoutRowCount([])).toBe(0);
    expect(layoutRowCount([p('a', 0, 0, 3, 2), p('b', 6, 3, 3, 4)])).toBe(7);
  });

  it('compareReadingOrder trie haut→bas puis gauche→droite puis par identifiant', () => {
    const items = [p('z', 0, 0, 1, 1), p('a', 0, 0, 1, 1), p('b', 3, 0, 1, 1), p('c', 0, 1, 1, 1)];
    expect(sortReadingOrder(items).map((i) => i.id)).toEqual(['a', 'z', 'b', 'c']);
    // La rangée prime sur la colonne, la colonne prime sur l'identifiant.
    expect(compareReadingOrder(p('a', 9, 0, 1, 1), p('b', 0, 1, 1, 1))).toBeLessThan(0);
    expect(compareReadingOrder(p('a', 3, 0, 1, 1), p('b', 0, 0, 1, 1))).toBeGreaterThan(0);
    expect(compareReadingOrder(p('a', 0, 0, 1, 1), p('a', 0, 0, 1, 1))).toBe(0);
  });
});
