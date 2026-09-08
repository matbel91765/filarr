/**
 * L'entête d'une section de l'accueil.
 *
 * Six blocs portaient exactement le même `<h2>` recopié six fois dans l'ancien
 * accueil. Les recopier une septième fois dans six fichiers séparés aurait
 * garanti qu'ils finissent par diverger — c'est déjà arrivé au menu contextuel
 * des dossiers, qui avait fini par avoir « son dialecte » selon l'écran.
 *
 * `count` est le TOTAL, pas ce que la rangée montre : afficher « (4) » sur un
 * tas de trente notes non classées le faisait passer pour réglé.
 */

import React from 'react';

export interface SectionHeadingProps {
  icon?: React.ReactNode;
  label: string;
  count?: number;
  /** Contrôles à droite (bascule de vue, liens « tout voir »…). */
  actions?: React.ReactNode;
}

export const SectionHeading: React.FC<SectionHeadingProps> = ({ icon, label, count, actions }) => (
  <div className={`flex items-center justify-between mb-3 ${actions ? 'home-widget__header' : ''}`}>
    <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] flex items-center gap-2 m-0">
      {icon}
      {label}
      {count !== undefined && <span className="normal-case font-normal opacity-60">({count})</span>}
    </h2>
    {actions}
  </div>
);

export default SectionHeading;
