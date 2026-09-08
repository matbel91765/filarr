/**
 * cdc.ts — Découpage défini par le contenu (FastCDC), PUR.
 *
 * Remplace la frontière FIXE de 8 Mio de `deltaManifest.ts` par une frontière
 * décidée par le CONTENU. C'est ce qui fait qu'insérer un octet en tête d'un
 * fichier n'invalide plus tous les blocs suivants : les frontières se
 * réalignent d'elles-mêmes après le point de modification.
 *
 * Référence : Xia et al., « FastCDC: a Fast and Efficient Content-Defined
 * Chunking Approach for Data Deduplication », USENIX ATC 2016. On reprend les
 * trois apports de l'article :
 *   1. empreinte glissante Gear (une addition + un décalage par octet) ;
 *   2. saut sous-minimum — on ne teste aucune frontière avant `min` ;
 *   3. normalisation de la distribution — masque STRICT avant la taille cible,
 *      masque PERMISSIF après. Sans elle, le saut sous-minimum dégrade le taux
 *      de déduplication ; c'est la partie de l'article que les portages
 *      oublient le plus souvent.
 *
 * ── ZÉRO DÉPENDANCE, Y COMPRIS `node:crypto` ─────────────────────────────────
 * Ce module est recopié tel quel par le mobile ET importé par l'application web
 * `app.filarr.com`, qui tourne dans un navigateur. Il n'importe donc RIEN
 * d'Electron, rien de `fs`, et surtout aucun module Node — la table Gear est
 * livrée en constantes par `gearTable.ts` précisément pour cette raison. Le
 * seul import autorisé ici est cette table.
 *
 * Voir la fiche de parité 2026-09-05-blocs-delta-cdc-compression.md.
 *
 * ── POURQUOI 32 BITS ET NON 64 ───────────────────────────────────────────────
 * L'article travaille sur 64 bits. En JavaScript, 64 bits impose `BigInt` dans
 * la boucle la plus chaude du produit — un facteur dix sur une opération
 * exécutée une fois par octet de chaque fichier. On travaille donc sur 32 bits
 * avec les opérateurs entiers natifs (`<<`, `>>>`), ce qui donne une fenêtre
 * glissante de 32 octets au lieu de 64. Pour un masque de 20 bits, l'entropie
 * de 32 bits est très largement suffisante : ce qui décide de la qualité du
 * découpage est le nombre de bits du MASQUE, pas la largeur du registre.
 *
 * ⚠ LE MOBILE DOIT PRODUIRE LES MÊMES FRONTIÈRES, À L'OCTET PRÈS.
 * Une divergence ici ne casse PAS le déchiffrement — elle casse seulement la
 * déduplication. Le bogue serait donc totalement silencieux et ne se verrait
 * que sur la facture de stockage, des mois plus tard. C'est ce que les vecteurs
 * de test croisés (`test-vectors/delta-v2.json`) existent pour empêcher.
 */

import { GEAR, GEAR_NAME } from './gearTable';

export { GEAR, GEAR_NAME };

// ── Paramètres ───────────────────────────────────────────────────────────────

export interface CdcParams {
  /** Aucune frontière n'est testée avant cette taille. */
  min: number;
  /** Taille visée. Sous elle le masque est strict, au-dessus il est permissif. */
  avg: number;
  /** Coupure forcée à cette taille, même sans frontière trouvée. */
  max: number;
  /** log2(avg) — le nombre de bits « utiles » du masque. */
  maskBits: number;
  /** Niveau de normalisation FastCDC (l'article recommande 2). */
  normalization: number;
}

/**
 * Paramètres de `cdc-v1`, tels que gelés dans la fiche de parité.
 *
 * 1 Mio de moyenne et non 8 Mio comme la frontière fixe qu'on remplace : 8 Mio
 * est une granularité de SAUVEGARDE. Modifier trois lignes d'un document ne
 * doit pas faire remonter 8 Mio. Le prix est un manifeste plus long, que le
 * champ `e` et la compression absorbent.
 */
export const CDC_V1: CdcParams = {
  min: 256 * 1024,
  avg: 1024 * 1024,
  max: 4 * 1024 * 1024,
  maskBits: 20,
  normalization: 2,
};

/**
 * Masque de `bits` bits CONTIGUS de POIDS FORT sur 32 bits.
 *
 * Les bits de poids fort sont ceux qu'alimentent les octets les plus anciens de
 * la fenêtre (l'empreinte décale vers la gauche à chaque octet) : les tester
 * revient à décider la frontière sur les ~32 octets précédents, ce qui est
 * exactement le comportement recherché.
 *
 * `bits >= 32` rendrait 0xFFFFFFFF, donc une frontière introuvable et des blocs
 * systématiquement coupés à `max`. On refuse plutôt que de dégrader en silence.
 */
export function highMask(bits: number): number {
  if (!Number.isInteger(bits) || bits < 1 || bits > 31) {
    throw new Error(`cdc: nombre de bits de masque hors bornes (${bits})`);
  }
  // Décalage non signé : (0xFFFFFFFF << (32 - bits)) >>> 0
  return (0xffffffff << (32 - bits)) >>> 0;
}

/** Les deux masques de la normalisation, dérivés des paramètres. */
export function masksOf(params: CdcParams): { strict: number; lenient: number } {
  return {
    strict: highMask(params.maskBits + params.normalization),
    lenient: highMask(params.maskBits - params.normalization),
  };
}

function assertParams(p: CdcParams): void {
  if (!(p.min > 0 && p.avg >= p.min && p.max >= p.avg)) {
    throw new Error('cdc: il faut 0 < min <= avg <= max');
  }
  // Valide les deux masques tout de suite plutôt qu'au premier octet.
  masksOf(p);
}

// ── Découpage d'un tampon complet ────────────────────────────────────────────

/**
 * Longueur du PROCHAIN bloc à partir de `start`, en octets.
 *
 * Rend au minimum 1 et au maximum `params.max`. Si la fin du tampon est
 * atteinte avant qu'une frontière ne soit trouvée, rend tout le reste — le
 * dernier bloc d'un fichier n'a pas à respecter `min`.
 */
export function nextCut(buf: Uint8Array, start: number, params: CdcParams = CDC_V1): number {
  assertParams(params);
  const remaining = buf.length - start;
  if (remaining <= 0) return 0;
  if (remaining <= params.min) return remaining;

  const { strict, lenient } = masksOf(params);
  const hardEnd = Math.min(remaining, params.max);
  // La zone à masque strict s'arrête à `avg` — ou plus tôt si le fichier finit.
  const strictEnd = Math.min(remaining, params.avg);

  let hash = 0;
  // Saut sous-minimum : on avance sans même calculer l'empreinte. C'est le
  // gain de vitesse principal de FastCDC, et il est gratuit : une frontière
  // trouvée avant `min` serait de toute façon refusée.
  let i = params.min;

  for (; i < strictEnd; i++) {
    hash = ((hash << 1) + GEAR[buf[start + i]]) >>> 0;
    if ((hash & strict) === 0) return i + 1;
  }
  for (; i < hardEnd; i++) {
    hash = ((hash << 1) + GEAR[buf[start + i]]) >>> 0;
    if ((hash & lenient) === 0) return i + 1;
  }
  return hardEnd;
}

/**
 * Offsets de fin de chaque bloc, pour un tampon COMPLET en mémoire.
 * Le dernier offset vaut toujours `buf.length`.
 *
 * Réservé aux tampons qui tiennent en mémoire (vecteurs de test, petits
 * fichiers). Pour un fichier de plusieurs gigaoctets, utiliser `CdcSplitter`.
 */
export function cdcBoundaries(buf: Uint8Array, params: CdcParams = CDC_V1): number[] {
  const out: number[] = [];
  let pos = 0;
  while (pos < buf.length) {
    pos += nextCut(buf, pos, params);
    out.push(pos);
  }
  return out;
}

// ── Découpage en flux ────────────────────────────────────────────────────────

/**
 * Découpeur incrémental : on lui pousse les morceaux tels que le disque ou le
 * réseau les livre, il rend des blocs dont les frontières ne dépendent QUE du
 * contenu — jamais de la façon dont les octets sont arrivés.
 *
 * C'est la propriété critique : deux appareils qui lisent le même fichier avec
 * des tailles de lecture différentes DOIVENT produire les mêmes blocs. Le test
 * `frontières indépendantes du découpage d'entrée` la vérifie.
 *
 * Mémoire : l'accumulateur ne dépasse jamais `max` + la taille d'un `push`,
 * quel que soit le fichier. Rien n'est gardé après émission.
 */
export class CdcSplitter {
  private readonly params: CdcParams;
  private buffer: Uint8Array;
  /** Nombre d'octets utiles au début de `buffer`. */
  private filled = 0;

  constructor(params: CdcParams = CDC_V1) {
    assertParams(params);
    this.params = params;
    this.buffer = new Uint8Array(params.max * 2);
  }

  /** Pousse des octets, rend les blocs COMPLETS que ces octets ont permis de fermer. */
  push(bytes: Uint8Array): Uint8Array[] {
    if (bytes.length === 0) return [];
    this.ensure(this.filled + bytes.length);
    this.buffer.set(bytes, this.filled);
    this.filled += bytes.length;

    const out: Uint8Array[] = [];
    let pos = 0;
    // On ne ferme un bloc que s'il reste ASSEZ d'octets derrière pour que la
    // décision soit définitive : tant que le reste tient sous `max`, un octet
    // futur pourrait encore déplacer la frontière. Sans cette garde, la
    // frontière dépendrait de la taille des lectures — exactement le bogue
    // silencieux que ce module existe pour empêcher.
    while (this.filled - pos > this.params.max) {
      const view = this.buffer.subarray(pos, this.filled);
      const len = nextCut(view, 0, this.params);
      out.push(view.slice(0, len));
      pos += len;
    }
    if (pos > 0) {
      this.buffer.copyWithin(0, pos, this.filled);
      this.filled -= pos;
    }
    return out;
  }

  /** Ferme le flux et rend les blocs restants. Le découpeur n'est plus utilisable. */
  flush(): Uint8Array[] {
    const out: Uint8Array[] = [];
    let pos = 0;
    while (pos < this.filled) {
      const view = this.buffer.subarray(pos, this.filled);
      const len = nextCut(view, 0, this.params);
      out.push(view.slice(0, len));
      pos += len;
    }
    this.filled = 0;
    return out;
  }

  private ensure(size: number): void {
    if (size <= this.buffer.length) return;
    const grown = new Uint8Array(Math.max(size, this.buffer.length * 2));
    grown.set(this.buffer.subarray(0, this.filled));
    this.buffer = grown;
  }
}
