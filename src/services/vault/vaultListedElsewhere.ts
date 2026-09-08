/**
 * vaultListedElsewhere — QUELS COFFRES SONT LISTÉS HORS DE LEUR EXPLORATEUR.
 *
 * LE PROBLÈME QUE ÇA RÉSOUT. `VaultHeadsWatcher` ne relit la liste d'éléments
 * que des coffres « regardés », et il les déduit des ROUTES ouvertes
 * (`vaultTargetsFromPanels`). C'était exact tant qu'un seul écran montrait le
 * contenu d'un coffre. La section « Coffres partagés » de l'onglet Notes en
 * montre PLUSIEURS à la fois, depuis une route qui ne nomme aucun coffre : sans
 * ce registre, une note ajoutée par un autre membre n'y apparaîtrait jamais sans
 * rechargement complet — la propagation vivante s'arrêterait exactement là où
 * on vient de la promettre.
 *
 * POURQUOI PAS REDUX. C'est le même raisonnement que `vaultLiveRefresh` juste à
 * côté : le guetteur est monté UNE fois, très haut dans l'arbre, tandis que la
 * section est un composant d'écran qui va et vient. Faire transiter « ce que
 * j'affiche en ce moment » par le magasin, ce serait une action à chaque repli,
 * chaque dépliage et chaque déverrouillage, pour un fait qui n'intéresse qu'un
 * seul lecteur et qui ne survit pas à la session.
 *
 * CE N'EST PAS UN CANAL D'ÉTAT. On n'y met AUCUNE donnée de coffre : uniquement
 * des identifiants, et uniquement ceux qu'un écran affiche VRAIMENT. La borne
 * est là et nulle part ailleurs — un appelant qui y verserait tous les coffres
 * connus transformerait le guetteur en déchiffrement perpétuel de toutes les
 * listes, y compris pour des écrans fermés.
 *
 * UN COMPTEUR PAR COFFRE, pas un booléen : deux surfaces peuvent lister le même
 * coffre en même temps (la vue scindée), et la première qui se démonte ne doit
 * pas retirer le coffre sous les yeux de la seconde.
 */

const comptes = new Map<string, number>();
const abonnes = new Set<() => void>();

/**
 * L'instantané lu par le guetteur. TRIÉ ET MÉMOÏSÉ : `useSyncExternalStore`
 * exige que deux lectures sans changement rendent la MÊME référence, sans quoi
 * React boucle indéfiniment.
 */
let instantane: string[] = [];

function recalculer(): void {
  instantane = [...comptes.keys()].sort();
  for (const notifier of abonnes) notifier();
}

/** Les coffres actuellement listés ailleurs que dans leur explorateur. */
export function vaultsListedElsewhere(): string[] {
  return instantane;
}

export function subscribeVaultsListedElsewhere(onChange: () => void): () => void {
  abonnes.add(onChange);
  return () => {
    abonnes.delete(onChange);
  };
}

/**
 * Déclarer qu'un écran liste le contenu de ces coffres. Rend la fonction de
 * retrait — à appeler au démontage ET au repli : une section repliée n'affiche
 * rien, et continuer à faire relire ses listes serait du travail pour personne.
 */
export function declareVaultsListed(vaultIds: readonly string[]): () => void {
  const pris = [...new Set(vaultIds)];
  for (const id of pris) comptes.set(id, (comptes.get(id) ?? 0) + 1);
  if (pris.length > 0) recalculer();
  let rendu = false;
  return () => {
    // Idempotent : React peut appeler le nettoyage d'un effet deux fois (mode
    // strict), et décrémenter deux fois retirerait le coffre d'une AUTRE
    // surface qui l'affiche encore.
    if (rendu) return;
    rendu = true;
    for (const id of pris) {
      const n = (comptes.get(id) ?? 0) - 1;
      if (n <= 0) comptes.delete(id);
      else comptes.set(id, n);
    }
    if (pris.length > 0) recalculer();
  };
}

/** Pour les tests : repartir d'une ardoise vierge entre deux cas. */
export function resetVaultsListedElsewhere(): void {
  comptes.clear();
  instantane = [];
  abonnes.clear();
}
