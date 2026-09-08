/**
 * ParallaxBackdrop — Filarr Notes / Atelier
 *
 * Le FOND du tableau, en trois couches, toutes `pointer-events: none` (le
 * double-clic sur le vide doit atteindre la fenêtre : une couche opaque au clic
 * volerait le geste qu'elle est censée mettre en valeur).
 *
 *   glow (0,2 × pan) — deux nappes très diffuses, teintées par le thème
 *   haze (0,5 × pan) — un voile plus fin, qui donne la profondeur
 *   grid (1 × pan)   — la grille de points, VERROUILLÉE AU MONDE
 *
 * La grille est le point délicat. Elle était peinte sur la FENÊTRE (pas fixe de
 * 20 px écran) alors que l'aimantation, elle, travaille en coordonnées MONDE :
 * les deux divergeaient dès le premier panoramique ou zoom, et les points ne
 * voulaient plus rien dire. Ici la maille suit le zoom (`20 × zoom`) et l'origine
 * suit le panoramique, donc un point = une case d'aimantation, toujours.
 *
 * Le décalage d'une demi-maille est nécessaire : `radial-gradient` centre son
 * cercle DANS la tuile, donc sans lui les points tomberaient à mi-chemin entre
 * deux cases.
 *
 * Les translations de parallaxe passent par des variables CSS (`--par-x/y`) et
 * non par `transform` en style en ligne : une règle `prefers-reduced-motion` ne
 * peut pas battre un style en ligne, mais elle peut remettre `transform: none`.
 * Elles sont bornées — au-delà, la nappe sortirait du cadre et le fond
 * deviendrait plat au fin fond du plan.
 */

// Les styles des trois couches vivent dans `StickyNotesView.css`, avec le reste
// du décor de la fenêtre : ce composant n'existe que pour porter le calcul.
import React, { useImperativeHandle, useRef } from 'react';

interface ParallaxBackdropProps {
  /** Panoramique courant, en pixels écran. */
  panX: number;
  panY: number;
  zoom: number;
  /** Pas d'aimantation, en unités MONDE. */
  grid: number;
}

/**
 * Voie IMPÉRATIVE, pour le panoramique à la souris seulement.
 *
 * Depuis la livraison « l'échelle », le panoramique n'écrit plus `pan` dans
 * l'état à chaque pixel : il pousse la transformée du plan directement dans le
 * DOM et ne commite qu'au relâchement. Le décor doit suivre la MÊME horloge —
 * un fond qui reste immobile pendant que les cartes glissent est pire que pas
 * de fond du tout. D'où cette poignée : les mêmes formules, écrites à la main
 * dans le style des trois couches, sans passer par un rendu React.
 */
export interface ParallaxBackdropHandle {
  setViewport(panX: number, panY: number, zoom: number): void;
}

/** Course maximale d'une nappe de parallaxe, en pixels. */
const PARALLAX_CLAMP = 180;

function drift(v: number, factor: number): string {
  const d = v * factor;
  return `${Math.max(-PARALLAX_CLAMP, Math.min(PARALLAX_CLAMP, d))}px`;
}

/** Maille de la grille à l'écran, bornée pour rester visible aux deux extrêmes. */
function cellFor(grid: number, zoom: number): number {
  return Math.max(4, grid * zoom);
}

export const ParallaxBackdrop = React.memo(
  React.forwardRef<ParallaxBackdropHandle, ParallaxBackdropProps>(function ParallaxBackdrop(
    { panX, panY, zoom, grid },
    ref
  ) {
    const glowRef = useRef<HTMLDivElement>(null);
    const hazeRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);

    const cell = cellFor(grid, zoom);
    // Le point grossit avec le zoom mais reste borné : à 3× un disque de 3 px
    // transforme la grille en pois, à 0,3× un sous-pixel la fait disparaître.
    const dot = Math.min(2.2, Math.max(0.6, zoom));

    // Écrit les MÊMES valeurs que le rendu ci-dessous, à la main. Quand l'état
    // rattrape enfin la ref (au relâchement), React repose exactement ces
    // valeurs-là : aucun saut n'est possible entre les deux voies.
    useImperativeHandle(
      ref,
      () => ({
        setViewport(px: number, py: number, z: number) {
          if (glowRef.current) {
            glowRef.current.style.setProperty('--par-x', drift(px, 0.2));
            glowRef.current.style.setProperty('--par-y', drift(py, 0.2));
          }
          if (hazeRef.current) {
            hazeRef.current.style.setProperty('--par-x', drift(px, 0.5));
            hazeRef.current.style.setProperty('--par-y', drift(py, 0.5));
          }
          if (gridRef.current) {
            const c = cellFor(grid, z);
            gridRef.current.style.backgroundPosition = `${px - c / 2}px ${py - c / 2}px`;
          }
        },
      }),
      [grid]
    );

    const glowStyle = {
      ['--par-x' as string]: drift(panX, 0.2),
      ['--par-y' as string]: drift(panY, 0.2),
    } as React.CSSProperties;
    const hazeStyle = {
      ['--par-x' as string]: drift(panX, 0.5),
      ['--par-y' as string]: drift(panY, 0.5),
    } as React.CSSProperties;

    return (
      <div className="board-backdrop" aria-hidden="true">
        <div className="board-backdrop__glow" ref={glowRef} style={glowStyle} />
        <div className="board-backdrop__haze" ref={hazeRef} style={hazeStyle} />
        <div
          className="board-backdrop__grid"
          ref={gridRef}
          style={{
            backgroundImage: `radial-gradient(circle, currentColor ${dot}px, transparent ${dot}px)`,
            backgroundSize: `${cell}px ${cell}px`,
            backgroundPosition: `${panX - cell / 2}px ${panY - cell / 2}px`,
          }}
        />
      </div>
    );
  })
);

export default ParallaxBackdrop;
