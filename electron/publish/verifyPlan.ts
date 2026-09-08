/**
 * LA PREUVE AVANT BASCULE — composition de l'échantillon.
 *
 * ON N'ABANDONNE L'ANCIENNE CLÉ QU'APRÈS AVOIR CONSTATÉ, pas supposé, que
 * chaque élément est monté et relisible sous la nouvelle. Le constat PARFAIT
 * coûte un retéléchargement intégral : le trafic double, et sur un coffre de
 * 40 Go en 4G c'est indéfendable. Ce module compose le compromis, et l'écrit
 * assez précisément pour qu'on puisse dire ce qu'il ne couvre pas.
 *
 * CE QUE L'ÉCHANTILLON NE COUVRE PAS, dit sans détour : un morceau que R2 a
 * accepté, que le manifeste répertorie avec le bon condensat, dont les octets
 * stockés auraient été perdus côté serveur — sur un élément NON échantillonné.
 * Seul le palier 3 (100 %) ferme ce cas. Il est accepté parce que (a) rien
 * n'est effacé localement : le clair reste sur l'appareil, donc une découverte
 * tardive se répare par un simple re-téléversement ; (b) le cycle ordinaire
 * vérifie déjà `sha256(octets) === entry.checksum` à chaque descente, donc une
 * altération se signale à la première relecture au lieu de s'installer ; (c)
 * R2 tient ses propres sommes de contrôle d'objet. La fenêtre résiduelle se
 * nomme : « le serveur a perdu des octets ET l'appareil a été effacé avant la
 * première relecture de l'élément concerné. »
 *
 * Module PUR, et surtout DÉTERMINISTE : le même `migrationId` donne le même
 * plan, à chaque reprise. Une preuve qu'on ne peut pas rejouer à l'identique
 * n'est pas une preuve.
 */

import type { PublishItem } from './types';

/** Petits fichiers : tout ce qui tient sous ce seuil est candidat en masse. */
export const VERIFY_SMALL_BLOB_BYTES = 1024 * 1024; // 1 Mio
export const VERIFY_SMALL_BLOB_CAP = 20;
export const VERIFY_RANDOM_SHARE = 0.02; // 2 % du reste
export const VERIFY_MAX_ITEMS = 200;
export const VERIFY_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 Gio
/**
 * En dessous de ce volume, l'argument du coût ne tient plus : retélécharger
 * 200 Mo n'est pas un sacrifice, alors la preuve complète devient le défaut.
 */
export const VERIFY_FULL_BY_DEFAULT_BYTES = 200 * 1024 * 1024;

export function shouldDefaultToFullVerify(totalBytes: number): boolean {
  return totalBytes < VERIFY_FULL_BY_DEFAULT_BYTES;
}

/**
 * PRNG déterministe, semé par le `migrationId`.
 *
 * Volontairement sans `node:crypto` : ce module doit rester pur (les tests le
 * chargent sans process principal), et on n'a besoin d'aucune propriété
 * cryptographique ici — seulement d'un tirage REPRODUCTIBLE. FNV-1a pour la
 * graine, mulberry32 pour la suite : deux fonctions courtes, sans dépendance,
 * dont on peut vérifier le comportement à l'œil.
 */
function seedFrom(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface VerifyPlanInput {
  /**
   * Les éléments réellement MONTÉS (état `done`), dans l'ordre canonique du
   * plan. Les `damaged` n'y figurent pas : on ne prouve pas ce qu'on n'a pas
   * monté.
   */
  publishedItems: readonly PublishItem[];
  migrationId: string;
  /** Palier 3 : l'échantillon vaut 100 %. */
  full: boolean;
}

/**
 * Compose l'échantillon.
 *
 * Priorités, dans l'ordre — et chacune ferme une perte SILENCIEUSE :
 *  1. toutes les `folder-meta` et le `notes-bundle`. Petits, et leur perte ne
 *     se verrait pas : un dossier vide ou des notes manquantes ressemblent à
 *     un dossier vide et à des notes manquantes. Ils ne sont JAMAIS rognés par
 *     le plafond.
 *  2. les blobs ≤ 1 Mio, plafonnés à 20 : ils coûtent presque rien à revérifier.
 *  3. le blob le plus volumineux de chaque profil cible : c'est le transfert
 *     le plus susceptible d'avoir mal tourné.
 *  4. le blob dont l'`updatedAt` est le plus ancien : le contenu le plus
 *     éloigné du chemin d'écriture récent, donc le moins souvent relu.
 *  5. 2 % du reste, tirés par un générateur semé par `migrationId`.
 *  6. plafond global : 200 éléments OU 2 Gio, la borne atteinte la première.
 */
export function buildVerifyPlan(input: VerifyPlanInput): string[] {
  const items = input.publishedItems;
  if (items.length === 0) return [];

  const positionOf = new Map<string, number>();
  items.forEach((it, i) => positionOf.set(it.key, i));

  if (input.full) {
    return items.map((it) => it.key);
  }

  const selected = new Set<string>();
  let bytes = 0;

  // (1) — hors plafond, par construction.
  const metas = items.filter((it) => it.kind !== 'blob');
  for (const it of metas) {
    selected.add(it.key);
    bytes += it.size;
  }

  const blobs = items.filter((it) => it.kind === 'blob');
  const byKeyAsc = [...blobs].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  /** Ajoute si les deux bornes le permettent ; rend `false` quand c'est plein. */
  const tryAdd = (item: PublishItem): boolean => {
    if (selected.has(item.key)) return true;
    if (selected.size >= VERIFY_MAX_ITEMS) return false;
    if (bytes + item.size > VERIFY_MAX_BYTES) return false;
    selected.add(item.key);
    bytes += item.size;
    return true;
  };

  // (2) petits fichiers, plafonnés à 20.
  let smalls = 0;
  for (const it of byKeyAsc) {
    if (smalls >= VERIFY_SMALL_BLOB_CAP) break;
    if (it.size > VERIFY_SMALL_BLOB_BYTES) continue;
    if (!tryAdd(it)) break;
    smalls += 1;
  }

  // (3) le plus volumineux de chaque profil cible.
  const largestPerProfile = new Map<string, PublishItem>();
  for (const it of byKeyAsc) {
    const current = largestPerProfile.get(it.localProfileId);
    if (!current || it.size > current.size) largestPerProfile.set(it.localProfileId, it);
  }
  for (const it of [...largestPerProfile.values()].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  )) {
    tryAdd(it);
  }

  // (4) le plus ancien.
  let oldest: PublishItem | null = null;
  for (const it of byKeyAsc) {
    const t = Date.parse(it.updatedAt);
    if (!Number.isFinite(t)) continue;
    if (!oldest || t < Date.parse(oldest.updatedAt)) oldest = it;
  }
  if (oldest) tryAdd(oldest);

  // (5) 2 % du reste — tirage reproductible.
  const rest = byKeyAsc.filter((it) => !selected.has(it.key));
  const quota = Math.floor(rest.length * VERIFY_RANDOM_SHARE);
  if (quota > 0 && rest.length > 0) {
    const rnd = mulberry32(seedFrom(input.migrationId));
    // Mélange de Fisher-Yates sur une COPIE : l'entrée `rest` est déjà triée par
    // clé, donc le mélange ne dépend que de la graine — pas de l'ordre d'arrivée
    // des fichiers sur le disque, qui lui varie d'une machine à l'autre.
    const shuffled = [...rest];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }
    for (let i = 0; i < quota; i++) {
      if (!tryAdd(shuffled[i])) break;
    }
  }

  // Sortie dans l'ORDRE CANONIQUE du plan : les petits d'abord, donc la barre
  // de vérification bouge tôt elle aussi.
  return [...selected].sort((a, b) => (positionOf.get(a) ?? 0) - (positionOf.get(b) ?? 0));
}
