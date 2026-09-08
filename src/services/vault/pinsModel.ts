/**
 * pinsModel — MES ÉPINGLES dans un coffre partagé, la partie pure.
 *
 * CE QUE C'EST. Une liste PERSONNELLE d'éléments qu'on veut retrouver, par
 * coffre, qui suit la personne d'un appareil à l'autre. Rien à voir avec
 * l'épingle DU COFFRE (F27, `pinnedItemId` dans le bloc scellé des réglages) :
 * celle-là est UNE note mise en avant pour tout le monde par un administrateur.
 * Dans l'interface, ceci s'appelle « favoris » (★) et cela « épingle » (📌) —
 * deux mots pour deux gestes, sinon le menu proposerait deux « Épingler » qui
 * ne font pas la même chose.
 *
 * LA FORME, gelée avec le mobile (fiche épingles) :
 *
 *   { v: 1, items: [{ id, at }], unpinned: [{ id, at }] }
 *
 * `unpinned` porte les TOMBSTONES, et ce n'est pas du zèle : sans elles, la
 * fusion de deux appareils serait une union, et une épingle retirée ici
 * ressusciterait dès que l'autre appareil écrit. La fusion se fait PAR
 * IDENTIFIANT, horloge la plus haute gagnante — exactement `freshest` /
 * `clockOf` des notes, que le mobile a déjà des deux côtés.
 *
 * Le serveur ne voit jamais ce document : il voyage scellé sous la clé du
 * coffre (`sealPins` / `unsealPins`, côté hook).
 */

export interface PinEntry {
  id: string;
  /** Horloge du geste, en millisecondes. */
  at: number;
}

export interface PinsDoc {
  v: 1;
  items: PinEntry[];
  unpinned: PinEntry[];
}

export const EMPTY_PINS: PinsDoc = { v: 1, items: [], unpinned: [] };

/** Au-delà, les tombstones les plus anciennes tombent : la liste reste bornée. */
const MAX_TOMBSTONES = 200;

function entriesOf(raw: unknown): PinEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: PinEntry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const { id, at } = e as { id?: unknown; at?: unknown };
    if (typeof id !== 'string' || !id) continue;
    if (typeof at !== 'number' || !Number.isFinite(at)) continue;
    out.push({ id, at });
  }
  return out;
}

/**
 * Lecture TOLÉRANTE : un blob illisible, d'une version inconnue ou mal formé
 * vaut « aucune épingle » plutôt qu'une exception — la liste est un confort,
 * elle ne doit jamais empêcher d'ouvrir le coffre.
 */
export function parsePinsDoc(json: string | null | undefined): PinsDoc {
  if (!json) return EMPTY_PINS;
  try {
    const root = JSON.parse(json) as { v?: unknown; items?: unknown; unpinned?: unknown };
    if (!root || typeof root !== 'object' || root.v !== 1) return EMPTY_PINS;
    return normalizePins({
      v: 1,
      items: entriesOf(root.items),
      unpinned: entriesOf(root.unpinned),
    });
  } catch {
    return EMPTY_PINS;
  }
}

export function encodePinsDoc(doc: PinsDoc): string {
  return JSON.stringify(normalizePins(doc));
}

/**
 * LA FUSION, par identifiant, horloge la plus haute gagnante. À horloge
 * ÉGALE, le retrait l'emporte : mieux vaut une épingle à reposer qu'une
 * épingle retirée qui revient — c'est le sens qu'on choisit pour le départage,
 * et il est le même sur tous les appareils, donc déterministe.
 */
export function mergePins(a: PinsDoc, b: PinsDoc): PinsDoc {
  const best = new Map<string, { at: number; pinned: boolean }>();
  const consider = (e: PinEntry, pinned: boolean): void => {
    const cur = best.get(e.id);
    if (!cur || e.at > cur.at || (e.at === cur.at && !pinned && cur.pinned)) {
      best.set(e.id, { at: e.at, pinned });
    }
  };
  for (const e of a.items) consider(e, true);
  for (const e of a.unpinned) consider(e, false);
  for (const e of b.items) consider(e, true);
  for (const e of b.unpinned) consider(e, false);

  const items: PinEntry[] = [];
  const unpinned: PinEntry[] = [];
  for (const [id, v] of best) (v.pinned ? items : unpinned).push({ id, at: v.at });
  items.sort((x, y) => y.at - x.at || x.id.localeCompare(y.id));
  unpinned.sort((x, y) => y.at - x.at || x.id.localeCompare(y.id));
  return { v: 1, items, unpinned: unpinned.slice(0, MAX_TOMBSTONES) };
}

/** Forme canonique : dédoublonnée, triée, bornée — `merge(doc, vide)`. */
export function normalizePins(doc: PinsDoc): PinsDoc {
  return mergePins(doc, EMPTY_PINS);
}

/** Les identifiants épinglés, les plus récents en tête. */
export function pinnedIds(doc: PinsDoc): string[] {
  return normalizePins(doc).items.map((e) => e.id);
}

export function isPinned(doc: PinsDoc, id: string): boolean {
  return normalizePins(doc).items.some((e) => e.id === id);
}

/** Épingler : une entrée datée de maintenant, qui l'emporte sur toute tombstone antérieure. */
export function withPin(doc: PinsDoc, id: string, now: number): PinsDoc {
  return mergePins(doc, { v: 1, items: [{ id, at: now }], unpinned: [] });
}

/** Retirer : une tombstone datée de maintenant. */
export function withoutPin(doc: PinsDoc, id: string, now: number): PinsDoc {
  return mergePins(doc, { v: 1, items: [], unpinned: [{ id, at: now }] });
}

/**
 * Une horloge qui ne recule jamais sur cet appareil : deux gestes dans la même
 * milliseconde, ou une horloge système remise en arrière, donneraient sinon
 * deux entrées à égalité — et le départage trancherait pour le retrait.
 */
let dernier = 0;
export function pinClock(now: number = Date.now()): number {
  dernier = Math.max(dernier + 1, now);
  return dernier;
}
