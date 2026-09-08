/**
 * La différence entre deux textes, ligne à ligne.
 *
 * ── POURQUOI PAS L'HEURISTIQUE DÉJÀ PRÉSENTE ───────────────────────────────
 * `noteVersionService.diffVersions` avance en glouton avec cinq lignes de
 * regard en avant. C'est suffisant pour une note qu'on retouche par endroits.
 * Sur un fichier, non : déplacer un paragraphe de six lignes fait perdre la
 * synchronisation, et tout ce qui suit est rapporté comme réécrit. On obtient
 * un diff qui dit « vous avez tout changé » alors qu'on a bougé un bloc.
 *
 * Ici : plus longue sous-séquence commune, donc le MINIMUM d'ajouts et de
 * suppressions. C'est exact, et c'est ce qu'on attend d'une comparaison qui
 * sert à décider si on restaure une version.
 *
 * ── LE COÛT, ET LA BORNE ───────────────────────────────────────────────────
 * La LCS coûte O(n×m) en temps ET en mémoire. Sur deux fichiers de 50 000
 * lignes, c'est 2,5 milliards de cellules : de quoi faire tomber l'onglet.
 * Deux garde-fous, dans cet ordre :
 *
 *  1. On retire d'abord le préfixe et le suffixe communs. Deux versions
 *     successives d'un même fichier ne diffèrent presque jamais que par le
 *     milieu — après ce rognage il reste le plus souvent quelques dizaines de
 *     lignes, et la LCS devient gratuite.
 *  2. Si le milieu reste trop gros, on ne ment pas : on rend une différence
 *     GROSSIÈRE (tout l'ancien retiré, tout le nouveau ajouté) en la marquant
 *     `approximatif`. L'appelant peut alors le dire, plutôt que d'afficher un
 *     résultat faux avec l'aplomb d'un résultat exact.
 */

export type TypeLigne = 'egal' | 'ajout' | 'suppression';

export interface LigneDiff {
  type: TypeLigne;
  texte: string;
  /** Numéro dans l'ancienne version (1-indexé), absent pour un ajout. */
  ligneA?: number;
  /** Numéro dans la nouvelle version (1-indexé), absent pour une suppression. */
  ligneB?: number;
}

export interface ResultatDiff {
  lignes: LigneDiff[];
  ajouts: number;
  suppressions: number;
  /**
   * Vrai quand le milieu dépassait la borne et qu'on a rendu une différence
   * grossière. À AFFICHER : l'utilisateur doit savoir qu'il lit une
   * approximation.
   */
  approximatif: boolean;
}

/**
 * Deux millions de cellules — environ 8 Mo pour la table d'entiers, et moins
 * d'une centaine de millisecondes. Au-delà, la comparaison exacte coûte plus
 * cher que ce qu'elle apporte à qui la lit.
 */
const MAX_CELLULES = 2_000_000;

/** Découpe en lignes sans se soucier de la convention de fin de ligne. */
export function enLignes(texte: string): string[] {
  return texte.replace(/\r\n?/g, '\n').split('\n');
}

export function diffLignes(ancien: string[], nouveau: string[]): ResultatDiff {
  const lignes: LigneDiff[] = [];

  // ── 1. Préfixe commun ──
  let debut = 0;
  while (debut < ancien.length && debut < nouveau.length && ancien[debut] === nouveau[debut]) {
    lignes.push({ type: 'egal', texte: ancien[debut], ligneA: debut + 1, ligneB: debut + 1 });
    debut += 1;
  }

  // ── 2. Suffixe commun (sans empiéter sur le préfixe) ──
  let finA = ancien.length;
  let finB = nouveau.length;
  while (finA > debut && finB > debut && ancien[finA - 1] === nouveau[finB - 1]) {
    finA -= 1;
    finB -= 1;
  }

  const milieuA = ancien.slice(debut, finA);
  const milieuB = nouveau.slice(debut, finB);

  let approximatif = false;
  const coeur: LigneDiff[] = [];

  if (milieuA.length === 0 || milieuB.length === 0) {
    // Un seul côté a du contenu : pas de LCS à calculer.
    milieuA.forEach((t, i) => coeur.push({ type: 'suppression', texte: t, ligneA: debut + i + 1 }));
    milieuB.forEach((t, i) => coeur.push({ type: 'ajout', texte: t, ligneB: debut + i + 1 }));
  } else if (milieuA.length * milieuB.length > MAX_CELLULES) {
    approximatif = true;
    milieuA.forEach((t, i) => coeur.push({ type: 'suppression', texte: t, ligneA: debut + i + 1 }));
    milieuB.forEach((t, i) => coeur.push({ type: 'ajout', texte: t, ligneB: debut + i + 1 }));
  } else {
    coeur.push(...lcs(milieuA, milieuB, debut));
  }

  lignes.push(...coeur);

  // ── 3. Suffixe commun, restitué ──
  for (let i = 0; i < ancien.length - finA; i += 1) {
    lignes.push({
      type: 'egal',
      texte: ancien[finA + i],
      ligneA: finA + i + 1,
      ligneB: finB + i + 1,
    });
  }

  return {
    lignes,
    ajouts: lignes.filter((l) => l.type === 'ajout').length,
    suppressions: lignes.filter((l) => l.type === 'suppression').length,
    approximatif,
  };
}

/**
 * La plus longue sous-séquence commune, puis le chemin de retour.
 *
 * `decalage` est le nombre de lignes du préfixe commun déjà consommées : les
 * numéros rendus sont ceux du FICHIER, pas ceux du milieu, sans quoi le
 * lecteur ne saurait pas où regarder.
 */
function lcs(a: string[], b: string[], decalage: number): LigneDiff[] {
  const n = a.length;
  const m = b.length;
  const largeur = m + 1;
  const table = new Uint32Array((n + 1) * largeur);

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * largeur + j] =
        a[i] === b[j]
          ? table[(i + 1) * largeur + (j + 1)] + 1
          : Math.max(table[(i + 1) * largeur + j], table[i * largeur + (j + 1)]);
    }
  }

  const sortie: LigneDiff[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      sortie.push({
        type: 'egal',
        texte: a[i],
        ligneA: decalage + i + 1,
        ligneB: decalage + j + 1,
      });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * largeur + j] >= table[i * largeur + (j + 1)]) {
      // Suppression d'abord quand les deux chemins se valent : lire « ce qui
      // était là » avant « ce qui l'a remplacé » suit le sens de la lecture.
      sortie.push({ type: 'suppression', texte: a[i], ligneA: decalage + i + 1 });
      i += 1;
    } else {
      sortie.push({ type: 'ajout', texte: b[j], ligneB: decalage + j + 1 });
      j += 1;
    }
  }
  while (i < n) {
    sortie.push({ type: 'suppression', texte: a[i], ligneA: decalage + i + 1 });
    i += 1;
  }
  while (j < m) {
    sortie.push({ type: 'ajout', texte: b[j], ligneB: decalage + j + 1 });
    j += 1;
  }
  return sortie;
}

/**
 * Ne garder que les changements et quelques lignes autour.
 *
 * Un fichier de trois mille lignes dont deux ont bougé ne doit pas produire
 * trois mille rangées à faire défiler : ce qui est identique n'apprend rien,
 * sauf juste au bord d'un changement, où il situe.
 */
export function enSections(lignes: LigneDiff[], contexte = 3): LigneDiff[][] {
  const interessant = new Set<number>();
  lignes.forEach((l, i) => {
    if (l.type === 'egal') return;
    for (
      let k = Math.max(0, i - contexte);
      k <= Math.min(lignes.length - 1, i + contexte);
      k += 1
    ) {
      interessant.add(k);
    }
  });

  const sections: LigneDiff[][] = [];
  let courante: LigneDiff[] | null = null;
  for (let i = 0; i < lignes.length; i += 1) {
    if (!interessant.has(i)) {
      courante = null;
      continue;
    }
    if (!courante) {
      courante = [];
      sections.push(courante);
    }
    courante.push(lignes[i]);
  }
  return sections;
}
