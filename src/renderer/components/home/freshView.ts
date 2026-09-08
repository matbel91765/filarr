/**
 * « CETTE DISPOSITION VIENT D'ÊTRE POSÉE » — un marqueur, et sa péremption.
 *
 * ── LE PROBLÈME ─────────────────────────────────────────────────────────────
 *
 * Un bloc s'efface quand il n'a rien à dire (`isEmpty` du registre). Sur un
 * accueil habité, c'est juste : personne ne veut d'une case vide qui dit
 * « aucune note récente ».
 *
 * Sur une disposition qu'on vient d'INSTALLER, c'est désastreux. On choisit un
 * modèle de huit blocs, on l'applique, et il en apparaît deux — les six autres
 * attendent un contenu qu'on n'a pas encore. L'écran ne dit pas « ils
 * viendront », il dit « ça n'a pas marché », et on retourne à son accueil
 * d'avant en concluant que le modèle était cassé.
 *
 * ── LA RÈGLE ────────────────────────────────────────────────────────────────
 *
 * Une vue fraîchement posée montre TOUS ses blocs, vides compris — exactement
 * ce que fait déjà le mode édition, et pour la même raison : on ne peut pas
 * juger ce qu'on ne voit pas.
 *
 * Le marqueur s'efface au premier passage en édition : à ce moment-là, la
 * personne a vu la composition entière et l'a prise en main. Il ne survit pas
 * non plus au changement de vue — c'est une propriété de CETTE pose, pas de
 * l'application.
 */

import { getItem, removeItem, setItem } from '../../../services/core/profileStorage';

const KEY = 'filarr.layout.freshView';

/** Marque la vue qu'on vient de poser. */
export function markFreshView(viewId: string): void {
  try {
    setItem(KEY, viewId);
  } catch {
    /* pas de stockage : les blocs vides se masqueront, sans plus */
  }
}

/** La vue donnée vient-elle d'être posée ? */
export function isFreshView(viewId: string): boolean {
  try {
    return getItem(KEY) === viewId;
  } catch {
    return false;
  }
}

/** La personne a pris la main : le marqueur n'a plus lieu d'être. */
export function clearFreshView(): void {
  try {
    removeItem(KEY);
  } catch {
    /* rien a faire */
  }
}
