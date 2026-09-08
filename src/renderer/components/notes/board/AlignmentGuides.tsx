/**
 * AlignmentGuides — Filarr Notes / Atelier
 *
 * Les traits d'aimantation qui apparaissent SOUS la carte qu'on déplace quand
 * un de ses bords (ou son centre) tombe à quelques pixels du bord ou du centre
 * d'une voisine. C'est la micro-interaction qui distingue un plan « où l'on
 * pose des choses » d'un plan « où l'on RANGE des choses » : sans elle, deux
 * cartes ne sont jamais alignées, elles sont alignées à la case de grille près,
 * ce qui n'est pas la même chose et se voit.
 *
 * Le composant ne calcule RIEN : la géométrie est décidée par le moteur de
 * gestes (`alignmentSnap` dans StickyNotesView), qui seul connaît les cartes
 * montées et la carte saisie. Ici on ne fait que peindre.
 *
 * Les traits vivent DANS le plan (repère monde), pas dans la fenêtre : ils
 * doivent rester collés aux cartes pendant un zoom ou un panoramique qui
 * arriverait au milieu du geste. Conséquence : leur épaisseur est donnée en
 * unités monde et vaut `1 / zoom`, pour se peindre à un pixel ÉCRAN quel que
 * soit le grossissement — un trait de 1 px monde ferait 3 px à 3× et
 * disparaîtrait sous le seuil du sous-pixel à 0,3×.
 */

import React from 'react';
import './AlignmentGuides.css';

/**
 * Un trait. `axis: 'x'` = trait VERTICAL posé à l'abscisse `pos` (c'est l'axe
 * sur lequel les deux cartes s'accordent), `axis: 'y'` = trait horizontal.
 * `from`/`to` sont l'étendue du trait sur l'AUTRE axe : l'union des deux cartes
 * concernées, pour que le trait relie visiblement celle qu'on tient à celle sur
 * laquelle elle s'aligne, et pas au-delà.
 */
export interface BoardGuide {
  axis: 'x' | 'y';
  pos: number;
  from: number;
  to: number;
}

interface AlignmentGuidesProps {
  guides: BoardGuide[];
  zoom: number;
}

export const AlignmentGuides: React.FC<AlignmentGuidesProps> = React.memo(function AlignmentGuides({
  guides,
  zoom,
}) {
  if (guides.length === 0) return null;
  const thickness = 1 / zoom;

  return (
    <>
      {guides.map((g) => (
        <div
          key={`${g.axis}:${g.pos}:${g.from}`}
          className={`board-guide board-guide--${g.axis}`}
          aria-hidden="true"
          style={
            g.axis === 'x'
              ? { left: g.pos, top: g.from, width: thickness, height: g.to - g.from }
              : { left: g.from, top: g.pos, height: thickness, width: g.to - g.from }
          }
        />
      ))}
    </>
  );
});

export default AlignmentGuides;
