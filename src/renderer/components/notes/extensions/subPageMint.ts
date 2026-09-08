/**
 * Ids de sous-pages frappés PAR CET APPAREIL et dont la note reste à créer.
 *
 * POURQUOI CE CANAL LOCAL. Le nœud `subPage` voyage par le CRDT : en session
 * vivante, l'appareil d'en face le reçoit et monte la même vue. Si la vue crée
 * une note dès qu'elle voit un nœud sans note associée, LES DEUX en créent une
 * — deux notes « Sans titre » pour une seule sous-page, et une course pour
 * savoir laquelle le nœud finira par désigner. L'id est donc frappé UNE FOIS, à
 * l'insertion, et seul l'appareil qui l'a frappé matérialise la note ; l'autre
 * la reçoit par la synchronisation ordinaire.
 *
 * La marque ne peut pas être portée par le nœud : tout attribut de nœud est
 * synchronisé, donc l'appareil d'en face la verrait aussi.
 *
 * Module à part pour ne pas nouer un cycle d'imports entre l'extension (qui
 * importe sa vue) et la vue (qui réclame ses ids).
 */

const _mintedHere = new Set<string>();

/** Déclare un id frappé ici : sa note reste à créer, par nous. */
export function markMintedSubPage(noteId: string): void {
  _mintedHere.add(noteId);
}

/**
 * « Est-ce MOI qui ai frappé cet id, et personne ne l'a encore matérialisé ? »
 * CONSOMME la marque : deux montages successifs de la même vue ne peuvent pas
 * créer deux notes.
 */
export function claimMintedSubPage(noteId: string): boolean {
  return _mintedHere.delete(noteId);
}
