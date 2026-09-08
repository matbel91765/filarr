/**
 * mentionInbox — la boîte de mentions, partagée entre la cloche et l'explorateur.
 *
 * L'ÉPINGLE DE NOTIFICATION (volet A de la fiche épingles) NE SE STOCKE PAS :
 * une mention NON LUE est déjà un marqueur par personne, par coffre, par
 * élément, qui suit la personne d'un appareil à l'autre. La cloche la lit
 * (`GET /mentions`) ; l'explorateur n'a qu'à la regarder pour décorer la ligne
 * de l'élément — et marquer lu retire la décoration PARTOUT, sans une ligne
 * de synchronisation en plus. Une table `pins` pour ce cas aurait fabriqué une
 * seconde vérité capable de diverger de la première sur le même badge.
 *
 * Même patron que `deviceLimitPrompt` : un magasin de module, publié par qui
 * lit, lu par qui affiche. Pas de Redux pour une liste que la cloche tient déjà.
 */

import { useSyncExternalStore } from 'react';
import type { MentionDTO } from './mentionsApi';

type Listener = () => void;

let _items: MentionDTO[] = [];
const listeners = new Set<Listener>();

export function publishMentionInbox(items: MentionDTO[]): void {
  _items = items;
  for (const l of listeners) l();
}

export function readMentionInbox(): MentionDTO[] {
  return _items;
}

export function subscribeMentionInbox(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * LES ÉPINGLES DE NOTIFICATION D'UN COFFRE : par élément, le nombre de
 * mentions NON LUES. Même règle que le mobile (`mentionPinsForVault`) :
 *  · seules les non-lues comptent — marquer lu retire l'épingle ;
 *  · un élément DISPARU (`itemKind === null`) n'est pas épinglé — la boîte de
 *    la cloche le dit autrement, l'explorateur n'a rien à montrer.
 */
export function mentionPinsForVault(
  items: readonly MentionDTO[],
  vaultId: string
): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of items) {
    if (m.vaultId !== vaultId || m.readAt || m.itemKind === null) continue;
    out.set(m.itemId, (out.get(m.itemId) ?? 0) + 1);
  }
  return out;
}

/** La carte des épingles de notification d'un coffre, vivante. */
export function useMentionPins(vaultId: string): Map<string, number> {
  const items = useSyncExternalStore(subscribeMentionInbox, readMentionInbox, readMentionInbox);
  // La carte est recalculée quand la boîte change ; c'est bon marché (vingt
  // lignes au plus) et évite un memo qui dépendrait d'une référence de tableau.
  return mentionPinsForVault(items, vaultId);
}
