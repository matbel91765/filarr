/**
 * Minimap — Filarr Notes / Atelier
 *
 * Le plan du plan : 180 × 120 px en bas à droite, un rectangle par note et le
 * cadre de ce que l'on regarde. Sur un tableau de deux cents notes, c'est la
 * seule chose qui répond à « où suis-je, et qu'est-ce qu'il y a autour » sans
 * dézoomer jusqu'à ne plus rien lire.
 *
 * TROIS CONTRAINTES ont dessiné ce composant :
 *
 * 1. UN SEUL canvas 2D, pas N divs. Deux cents rectangles en DOM, c'est deux
 *    cents nœuds de plus à composer à chaque image de panoramique — la minimap
 *    coûterait plus cher que le tableau qu'elle résume.
 *
 * 2. Le dessin est ÉTRANGLÉ EN rAF. Un panoramique envoie des dizaines de
 *    `mousemove` par image ; sans étranglement on repeindrait le canvas
 *    plusieurs fois pour un seul rafraîchissement d'écran.
 *
 * 3. Une voie IMPÉRATIVE (`setViewport`), pour la même raison que
 *    `ParallaxBackdrop` : pendant un panoramique à la souris, `pan` n'est PAS
 *    dans l'état React (voir StickyNotesView). La minimap doit donc pouvoir
 *    être rafraîchie sans rendu, sinon son cadre resterait figé pendant tout le
 *    geste — c'est-à-dire précisément quand on la regarde.
 *
 * Le cadrage est recalculé à chaque dessin sur l'union « boîte des notes ∪
 * fenêtre courante » : autrement, en panoramiquant hors du nuage de notes, le
 * cadre du regard sortirait du canvas et la minimap ne dirait plus rien.
 */

import React, { useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import './Minimap.css';

export const MINIMAP_W = 180;
export const MINIMAP_H = 120;
/** Marge intérieure, pour que le cadre du regard ne se colle pas aux bords. */
const PAD = 6;

/** Ce que la minimap a besoin de savoir d'une note — rien de plus. */
export interface MinimapNote {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Même teinte que la carte (voir `noteTintHue`), pour que l'œil relie les deux. */
  hue: number;
  selected: boolean;
}

export interface MinimapHandle {
  setViewport(panX: number, panY: number, zoom: number): void;
}

interface MinimapProps {
  /** Référence STABLE (mémoïsée par la vue) : sinon on redessine à chaque rendu. */
  notes: MinimapNote[];
  /** Taille de la FENÊTRE en pixels écran. */
  viewportW: number;
  viewportH: number;
  panX: number;
  panY: number;
  zoom: number;
  label: string;
  /** Recentrer la vue sur ce point du MONDE. */
  onPanTo: (worldX: number, worldY: number) => void;
}

/** Projection monde → canvas retenue au dernier dessin, pour le clic. */
interface Projection {
  s: number;
  ox: number;
  oy: number;
}

function readColor(cs: CSSStyleDeclaration, name: string, fallback: string): string {
  const v = cs.getPropertyValue(name).trim();
  return v || fallback;
}

export const Minimap = React.memo(
  React.forwardRef<MinimapHandle, MinimapProps>(function Minimap(
    { notes, viewportW, viewportH, panX, panY, zoom, label, onPanTo },
    ref
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const projRef = useRef<Projection>({ s: 1, ox: 0, oy: 0 });
    const frameRef = useRef<number | null>(null);
    // Miroir des données du dessin. Le dessin lit ICI et non dans sa fermeture :
    // il est appelé aussi bien par un effet que par la poignée impérative, qui,
    // elle, arrive entre deux rendus avec un panoramique plus frais que l'état.
    const dataRef = useRef({ notes, viewportW, viewportH, panX, panY, zoom });

    const draw = useCallback(() => {
      frameRef.current = null;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const d = dataRef.current;
      const dpr = window.devicePixelRatio || 1;
      // Redimensionner un canvas l'efface : ne le faire que si la densité a
      // changé, sinon chaque image repartirait d'un buffer neuf pour rien.
      const wantW = Math.round(MINIMAP_W * dpr);
      const wantH = Math.round(MINIMAP_H * dpr);
      if (canvas.width !== wantW || canvas.height !== wantH) {
        canvas.width = wantW;
        canvas.height = wantH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);

      const cs = getComputedStyle(canvas);
      const primary = readColor(cs, '--color-primary-500', '#5fb8e3');
      const border = readColor(cs, '--color-border', '#8884');

      // Le rectangle du MONDE que l'on regarde, déduit de la transformée du
      // plan : `translate(pan) scale(zoom)` ⇒ écran (0,0) = monde (−pan/zoom).
      const z = d.zoom || 1;
      const vx = -d.panX / z;
      const vy = -d.panY / z;
      const vw = d.viewportW / z;
      const vh = d.viewportH / z;

      let minX = vx;
      let minY = vy;
      let maxX = vx + vw;
      let maxY = vy + vh;
      for (const n of d.notes) {
        if (n.x < minX) minX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.x + n.w > maxX) maxX = n.x + n.w;
        if (n.y + n.h > maxY) maxY = n.y + n.h;
      }
      const bw = Math.max(1, maxX - minX);
      const bh = Math.max(1, maxY - minY);
      const s = Math.min((MINIMAP_W - PAD * 2) / bw, (MINIMAP_H - PAD * 2) / bh);
      // Centrer ce qui reste de place : une boîte très large laisserait sinon
      // tout le bas du canvas vide et le contenu collé en haut.
      const ox = PAD + (MINIMAP_W - PAD * 2 - bw * s) / 2 - minX * s;
      const oy = PAD + (MINIMAP_H - PAD * 2 - bh * s) / 2 - minY * s;
      projRef.current = { s, ox, oy };

      for (const n of d.notes) {
        // Plancher d'un pixel et demi : au facteur de la minimap, une note de
        // 200 px peut tomber sous le pixel et ne rien peindre du tout.
        const rw = Math.max(1.5, n.w * s);
        const rh = Math.max(1.5, n.h * s);
        ctx.fillStyle = n.selected ? primary : `hsl(${n.hue} 62% 52% / 0.72)`;
        ctx.fillRect(ox + n.x * s, oy + n.y * s, rw, rh);
      }

      // Le cadre du regard, par-dessus tout le reste.
      ctx.strokeStyle = primary;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        ox + vx * s + 0.75,
        oy + vy * s + 0.75,
        Math.max(3, vw * s - 1.5),
        Math.max(3, vh * s - 1.5)
      );
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, MINIMAP_W - 1, MINIMAP_H - 1);
    }, []);

    const schedule = useCallback(() => {
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(draw);
    }, [draw]);

    // Voie React : les props ont changé (notes, zoom, panoramique commité).
    useEffect(() => {
      dataRef.current = { notes, viewportW, viewportH, panX, panY, zoom };
      schedule();
    }, [notes, viewportW, viewportH, panX, panY, zoom, schedule]);

    useEffect(
      () => () => {
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      },
      []
    );

    // Voie impérative : panoramique en cours, aucun rendu React n'aura lieu.
    useImperativeHandle(
      ref,
      () => ({
        setViewport(px: number, py: number, z: number) {
          dataRef.current = { ...dataRef.current, panX: px, panY: py, zoom: z };
          schedule();
        },
      }),
      [schedule]
    );

    /** Point du canvas → point du MONDE, puis recentrage sur ce point. */
    const panToEvent = useCallback(
      (clientX: number, clientY: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const { s, ox, oy } = projRef.current;
        if (s <= 0) return;
        onPanTo((clientX - rect.left - ox) / s, (clientY - rect.top - oy) / s);
      },
      [onPanTo]
    );

    const handleMouseDown = useCallback(
      (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        // La minimap est un ENFANT de la fenêtre du tableau : sans ça, le même
        // mousedown démarrerait aussi un cadre de sélection ou un panoramique.
        e.preventDefault();
        e.stopPropagation();
        panToEvent(e.clientX, e.clientY);
        const onMove = (ev: MouseEvent) => panToEvent(ev.clientX, ev.clientY);
        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      },
      [panToEvent]
    );

    return (
      <canvas
        ref={canvasRef}
        className="board-minimap"
        style={{ width: MINIMAP_W, height: MINIMAP_H }}
        role="img"
        aria-label={label}
        title={label}
        onMouseDown={handleMouseDown}
      />
    );
  })
);

export default Minimap;
