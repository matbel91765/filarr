/**
 * LA TUILE INERTE — un bloc que cette version ne sait pas rendre.
 *
 * ── POURQUOI ELLE OCCUPE SA PLACE ───────────────────────────────────────────
 *
 * Un modèle importé peut nommer un bloc qui n'existe pas encore ici. Trois
 * conduites étaient possibles, deux sont mauvaises :
 *
 *   · le SUPPRIMER : l'import dirait « appliqué » et l'utilisateur aurait perdu
 *     des blocs sans qu'aucune ligne ne le lui dise. C'est la conduite qu'on
 *     s'interdit partout dans ce produit ;
 *   · le MASQUER (ce que faisait l'accueil jusqu'ici pour un type inconnu) :
 *     rien n'est perdu, mais la mise en page reçue n'est plus celle qu'on a
 *     acceptée, et le trou n'a aucune explication ;
 *   · l'AFFICHER INERTE, à sa taille exacte. La disposition est celle qu'on a
 *     choisie, le manque est nommé, et le jour où la mise à jour arrive le bloc
 *     se réhydrate tout seul — l'emplacement porte déjà le bon type.
 *
 * Elle ne fait RIEN : aucun clic, aucun lien, aucune promesse de mise à jour
 * qu'on ne saurait pas tenir. Elle dit ce qui manque, et de quelle version il
 * relève quand le fichier l'a déclaré.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

import type { LayoutUnavailableInfo } from '../../../services/layouts/layoutFormat';
import './layoutTransfer.css';

export interface UnavailableWidgetProps {
  /** Le type demandé par la disposition — toujours affiché, c'est le fait brut. */
  type: string;
  /** Ce que l'import a retenu du fichier : nom de secours, version réclamée. */
  info: LayoutUnavailableInfo | null;
}

export const UnavailableWidget: React.FC<UnavailableWidgetProps> = React.memo(
  function UnavailableWidget({ type, info }) {
    const { t } = useTranslation();
    const name = info?.title ?? type;
    const version = info?.minAppVersion;

    return (
      <div className="home-unavailable" role="note" aria-label={t('layouts.unavailable.aria')}>
        <p className="home-unavailable__name">{name}</p>
        <p className="home-unavailable__reason">
          {version
            ? t('layouts.unavailable.withVersion', { version })
            : t('layouts.unavailable.plain')}
        </p>
      </div>
    );
  }
);

export default UnavailableWidget;
