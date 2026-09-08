/**
 * Bloc « Coffres partagés » — RETIRÉ au profit de la grille mêlée (lot A, C6).
 *
 * L'accueil rend désormais les coffres partagés PARMI les dossiers : ce bloc
 * affichait les mêmes cartes une seconde fois. Il ne rend plus rien.
 *
 * Pourquoi il existe encore : le registre des widgets est CLOS, et des
 * dispositions déjà écrites (sur disque, dans des gabarits publiés, dans des
 * dispositions synchronisées) portent un emplacement `shared-vaults`. Retirer
 * l'identifiant ferait de chacune une tuile « inconnue » ; le garder avec un
 * rendu vide, c'est une case que la grille recompacte hors édition (`isEmpty`)
 * et que l'édition laisse retirer à la main.
 */

import type React from 'react';
import type { WidgetProps } from '../widgetOptions';

/** Toujours « rien à montrer » : la grille retire la case hors édition. L'état
 *  n'est plus lu — la signature `(state) => boolean` du registre l'accepte. */
export function isSharedVaultsEmpty(): boolean {
  return true;
}

export const SharedVaultsWidget: React.FC<WidgetProps> = () => null;

export default SharedVaultsWidget;
