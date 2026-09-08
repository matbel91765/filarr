/**
 * LA BARRE D'UNE FICHE OUVERTE — ce qui reste de l'en-tête quand on lit.
 *
 * ── CE QU'ELLE REMPLACE ─────────────────────────────────────────────────────
 *
 * La vue marketplace porte un en-tête à trois étages : le titre et sa phrase,
 * la rangée des types d'objet (Extensions / Modèles), puis celle des sections
 * (Découvrir / Mes modèles / Publier). Une centaine de pixels bien employés
 * TANT QU'ON CHERCHE : ils disent où l'on est et ce qu'on peut faire.
 *
 * Une fois une fiche ouverte, ils ne répondent plus à aucune question. On ne
 * choisit plus un rayon, on lit un objet — et l'en-tête pousse la capture
 * d'écran, qui est le sujet, sous la ligne de flottaison.
 *
 * Cette barre-ci tient en une hauteur de bouton et garde les deux seules
 * choses encore utiles : par où l'on repart, et d'où l'on vient.
 *
 * ⚠ PAS DE CROIX EN PLUS DE LA FLÈCHE. Elles feraient exactement le même
 * geste ; en offrir deux oblige à se demander laquelle est la bonne.
 */

import React from 'react';

import './marketplace.css';

export interface DetailTopBarProps {
  /** Le libellé de retour — « Catalogue », « Mes modèles »… */
  backLabel: string;
  /** Le rayon d'où vient la fiche. Affiché après le retour, en gris. */
  crumb: string;
  onBack: () => void;
  /** Ce qui se pose à droite : signaler, désinstaller… Souvent rien. */
  actions?: React.ReactNode;
}

export const DetailTopBar: React.FC<DetailTopBarProps> = ({
  backLabel,
  crumb,
  onBack,
  actions,
}) => (
  <div className="mkt-topbar">
    <div className="mkt-topbar__left">
      <button type="button" className="mkt-topbar__back" onClick={onBack}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M19 12H5m7 7-7-7 7-7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {backLabel}
      </button>
      <span className="mkt-topbar__sep" aria-hidden="true">
        /
      </span>
      <span className="mkt-topbar__crumb">{crumb}</span>
    </div>
    {actions && <div className="mkt-topbar__actions">{actions}</div>}
  </div>
);

export default DetailTopBar;
