/**
 * L'ICÔNE D'UNE FICHE — un seul endroit qui sait la rendre.
 *
 * ── POURQUOI CE COMPOSANT EXISTE ────────────────────────────────────────────
 *
 * Il y avait deux rendus d'icône : la carte du catalogue et la liste « Mes
 * modèles publiés ». Le jour où l'icône a pu devenir une image, j'ai corrigé le
 * premier et oublié le second — qui a donc affiché SIX MILLE CARACTÈRES de
 * base64 en travers de la page.
 *
 * Ce n'était pas une étourderie évitable par plus d'attention : deux rendus
 * pour un seul format finissent toujours par diverger. Le rendu est donc ici, et
 * les deux écrans l'appellent.
 *
 * ── CE QUI ARRIVE ICI N'EST PAS DE CONFIANCE ────────────────────────────────
 *
 * L'icône vient d'une colonne D1 que PERSONNE NE SIGNE (le worker la duplique
 * depuis l'enveloppe pour pouvoir trier sans tout analyser). On la passe donc
 * par `isImageIcon` — la même fonction que le validateur — et non par un
 * `startsWith('data:')` qui laisserait rendre un `data:` arbitraire.
 *
 * Un emoji, lui, est écrêté en points de code et isolé dans un `<bdi>` : un
 * emoji peut embarquer des marques bidirectionnelles qui, sans isolation,
 * retournent le texte VOISIN.
 */

import React from 'react';

import { clampIcon } from '../../../services/plugins/marketplaceTypes';
import { isImageIcon } from '../../../services/layouts/layoutMarketTypes';
import './marketplace.css';

export interface MarketIconProps {
  /** Ce que le serveur a servi — texte attaquant, jamais rendu tel quel. */
  icon: string | null | undefined;
  /** Le glyphe quand il n'y a pas d'icône. */
  fallback?: string;
  className?: string;
}

export const MarketIcon: React.FC<MarketIconProps> = ({
  icon,
  fallback = '▤',
  className = 'mkt-card__icon',
}) => {
  /**
   * ⚠ L'ORDRE EST LA CORRECTION D'UN BOGUE RÉEL, ET IL EST CONTRE-INTUITIF.
   *
   * `clampIcon` écrête à huit POINTS DE CODE — la bonne mesure pour un emoji,
   * une catastrophe pour une URL de données. Écrêter d'abord transformait
   * `data:image/webp;base64,…` en `data:ima`, huit caractères exactement :
   * `isImageIcon` refusait alors la chaîne tronquée, et l'écran affichait
   * « data:ima » en toutes lettres à la place de la vignette.
   *
   * On teste donc l'image sur la valeur ENTIÈRE, et on n'écrête que ce qui
   * reste — c'est-à-dire un emoji, la seule chose que cette borne concerne.
   */
  if (typeof icon === 'string' && isImageIcon(icon)) {
    return (
      <span className={className} aria-hidden="true">
        <img className="mkt-card__icon-img" src={icon} alt="" />
      </span>
    );
  }

  const emoji = clampIcon(icon);
  return (
    <span className={className} aria-hidden="true">
      <bdi>{emoji ?? fallback}</bdi>
    </span>
  );
};

export default MarketIcon;
