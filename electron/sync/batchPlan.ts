/**
 * batchPlan.ts — Regroupement des petits objets. PUR.
 *
 * Lot 47. Mille objets de 2 Kio coutent mille operations de classe A ; groupes,
 * une seule. Sur la facture R2 d aujourd hui c est marginal — a treize comptes,
 * tout est sous les paliers gratuits. Sur la LATENCE PERCUE, ca ne l est pas du
 * tout : mille aller-retours reseau, meme paralleles a trois, se voient.
 *
 * ── LA REGLE QUI DECIDE ──────────────────────────────────────────────────────
 * On ne groupe QUE ce qui est petit. Un gros objet ne gagne rien a etre groupe
 * (le cout est domine par les octets, pas par la requete) et il ferait perdre
 * deux choses precieuses :
 *   - la REPRISE : un lot qui echoue se rejoue en entier, alors qu un gros
 *     transfert isole reprend la ou il s est arrete ;
 *   - le PARALLELISME : un lot est une unite, il n exploite pas les trois places
 *     de la file.
 *
 * ── CE MODULE NE TRANSFERE RIEN ──────────────────────────────────────────────
 * Il PLANIFIE. Aucune E/S, aucun reseau, aucune horloge : il rend des lots, et
 * l appelant les execute comme il l entend. C est ce qui le rend testable et ce
 * qui permet de changer la politique sans toucher au transport.
 */

/** Un objet candidat au regroupement. */
export interface BatchItem {
  /** Cle ou identifiant, opaque a ce module. */
  key: string;
  /** Taille en octets de ce qui sera transmis. */
  size: number;
}

/** Un lot a executer en une requete, ou un objet a transferer seul. */
export interface BatchGroup {
  /** `true` = une seule requete pour tous les elements ; `false` = transfert isole. */
  batched: boolean;
  items: BatchItem[];
  /** Somme des tailles du lot. */
  totalSize: number;
}

export interface BatchOptions {
  /**
   * Au-dela de cette taille, un objet part SEUL.
   *
   * 256 Kio : en dessous, la requete coute plus que les octets ; au-dessus,
   * c est l inverse et on veut la reprise et le parallelisme.
   */
  maxItemSize?: number;
  /**
   * Nombre maximal d elements par lot.
   *
   * Un lot trop gros est un pari : s il echoue, tout se rejoue. Cent elements
   * est le compromis — assez pour supprimer l essentiel des requetes, assez peu
   * pour qu un echec ne coute pas une minute.
   */
  maxItemsPerBatch?: number;
  /**
   * Octets maximaux par lot.
   *
   * Borne la memoire ET le cout d un rejeu. Sans elle, cent objets de 250 Kio
   * feraient un lot de 25 Mo a refaire en entier au premier echec.
   */
  maxBytesPerBatch?: number;
}

export const DEFAULT_MAX_ITEM_SIZE = 256 * 1024;
export const DEFAULT_MAX_ITEMS_PER_BATCH = 100;
export const DEFAULT_MAX_BYTES_PER_BATCH = 4 * 1024 * 1024;

/**
 * Repartit des objets entre lots groupes et transferts isoles.
 *
 * L ORDRE D ENTREE EST PRESERVE a l interieur de chaque categorie. Un appelant
 * qui a deja trie sa file — le plus court d abord, l interactif en tete — ne
 * doit pas voir son travail defait par le planificateur.
 */
export function planBatches(items: readonly BatchItem[], options: BatchOptions = {}): BatchGroup[] {
  const maxItemSize = options.maxItemSize ?? DEFAULT_MAX_ITEM_SIZE;
  const maxItems = Math.max(1, options.maxItemsPerBatch ?? DEFAULT_MAX_ITEMS_PER_BATCH);
  const maxBytes = Math.max(1, options.maxBytesPerBatch ?? DEFAULT_MAX_BYTES_PER_BATCH);

  const groups: BatchGroup[] = [];
  let current: BatchItem[] = [];
  let currentBytes = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    // Un « lot » d un seul element n en est pas un : le marquer comme groupe
    // ferait compter une requete economisee qui ne l est pas, et fausserait la
    // mesure du lot 93.
    groups.push({
      batched: current.length > 1,
      items: current,
      totalSize: currentBytes,
    });
    current = [];
    currentBytes = 0;
  };

  for (const item of items) {
    const size = Number.isFinite(item.size) && item.size > 0 ? item.size : 0;
    if (size > maxItemSize) {
      // Un gros objet ne rejoint jamais un lot, mais il ne doit pas non plus
      // couper celui en cours : les petits qui le suivent peuvent encore
      // rejoindre les petits qui le precedent.
      groups.push({ batched: false, items: [item], totalSize: size });
      continue;
    }
    if (current.length >= maxItems || currentBytes + size > maxBytes) flush();
    current.push(item);
    currentBytes += size;
  }
  flush();
  return groups;
}

/** Requetes economisees par ce plan, par rapport a un transfert un-par-un. */
export function requestsSaved(groups: readonly BatchGroup[]): number {
  let saved = 0;
  for (const g of groups) if (g.batched) saved += g.items.length - 1;
  return saved;
}

/** Nombre de requetes que ce plan va emettre. */
export function requestCount(groups: readonly BatchGroup[]): number {
  return groups.length;
}

/**
 * Resume chiffre du plan — ce que l instrumentation doit enregistrer.
 *
 * `before` est le nombre de requetes qu on aurait emises sans regroupement,
 * c est-a-dire un par objet. Le rapport des deux est le gain reel.
 */
export function summarize(groups: readonly BatchGroup[]): {
  before: number;
  after: number;
  saved: number;
  batchedItems: number;
} {
  let before = 0;
  let batchedItems = 0;
  for (const g of groups) {
    before += g.items.length;
    if (g.batched) batchedItems += g.items.length;
  }
  return { before, after: groups.length, saved: requestsSaved(groups), batchedItems };
}
