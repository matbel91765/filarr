/**
 * SpringDwellRing
 *
 * Compte à rebours avant l'ouverture automatique d'une cible survolée pendant un
 * drag (spring-load) : tuile de dossier, segment de fil d'Ariane ou bouton
 * retour — même minuteur partout, donc même langage visuel partout.
 *
 * Le signal porte sur TOUT le pourtour de la cible, et non plus sur une pastille
 * de 22 px posée en son centre : celle-ci tombait sur le nom du dossier, dans la
 * teinte EXACTE de la bordure de dépôt qui apparaît au même instant, et s'y
 * noyait — mesuré à ~130 pixels colorés contre ~690 pour la bordure. Désormais
 * la cible s'allume (halo) et son pourtour se remplit dans une teinte dérivée de
 * la couleur du texte, donc distincte de la bordure de dépôt dans les 11 thèmes.
 *
 * Le balayage est décrit en CSS (`@keyframes spring-dwell-sweep`, global.css) et
 * non piloté en state : `handleDragOver` est volontairement throttlé (~15 fps),
 * et re-rendre chaque carte à chaque image pour faire avancer un pourcentage
 * hacherait le drag. Seules deux valeurs viennent de JS : la durée, lue sur la
 * constante que partage le minuteur (les deux ne peuvent donc pas diverger), et
 * la longueur du tracé — mesurée, parce que la cible fait 20 px de haut dans le
 * fil d'Ariane et 220 px dans une carte de la grille.
 *
 * L'anneau se monte quand la cible s'arme et se démonte quand elle se désarme :
 * le balayage repart donc exactement quand le minuteur repart. Le minuteur, lui,
 * ne se réarme PAS tant que la cible reste la même (voir `scheduleSpringLoad`) ;
 * garder l'anneau monté dans ce cas est le comportement voulu.
 *
 * L'hôte doit être positionné (`relative`) : le voile se pose en surimpression
 * et épouse son rayon (`border-radius: inherit`).
 */

import { CSSProperties, FC, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SPRING_LOAD_DELAY_MS } from '../../../hooks/useDragAndDrop';

/** Épaisseur du tracé, en px. Le tracé est rentré d'une demi-épaisseur pour que
 *  rien ne dépasse : les hôtes portent `overflow:hidden` ou `contain:content`. */
const STROKE_WIDTH = 3;

/** En dessous, la pastille de texte ne tient pas — le pourtour parle seul. */
const LABEL_MIN_WIDTH = 150;
const LABEL_MIN_HEIGHT = 48;

interface HostBox {
  width: number;
  height: number;
  radius: number;
}

/**
 * Longueur exacte du pourtour d'un rectangle à coins arrondis : les quatre
 * quarts de cercle font un cercle complet, les côtés valent ce qu'il reste.
 */
const roundedPerimeter = (width: number, height: number, radius: number): number =>
  2 * (width - 2 * radius) + 2 * (height - 2 * radius) + 2 * Math.PI * radius;

export interface SpringDwellRingProps {
  /** Classes additionnelles — le placement par défaut couvre tout l'hôte. */
  className?: string;
}

export const SpringDwellRing: FC<SpringDwellRingProps> = ({ className }) => {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HostBox | null>(null);

  // `useLayoutEffect` et non `useEffect` : la mesure doit être faite AVANT la
  // peinture, sinon la première image montrerait un pourtour déjà plein.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Le rayon arrive par `border-radius: inherit` : on relit donc celui de
    // l'hôte, quel qu'il soit (12 px pour une tuile, 9999 px pour un bouton
    // rond — d'où le plafonnement à la moitié du plus petit côté).
    const declared = parseFloat(window.getComputedStyle(el).borderTopLeftRadius);
    setHost({
      width: rect.width,
      height: rect.height,
      radius: Math.max(
        0,
        Math.min(Number.isFinite(declared) ? declared : 0, rect.width / 2, rect.height / 2)
      ),
    });
  }, []);

  // Le tracé est rentré d'une demi-épaisseur sur les quatre côtés.
  const inset = STROKE_WIDTH / 2;
  const traceable =
    host !== null && host.width > STROKE_WIDTH * 2 && host.height > STROKE_WIDTH * 2;
  const traceWidth = traceable ? host.width - STROKE_WIDTH : 0;
  const traceHeight = traceable ? host.height - STROKE_WIDTH : 0;
  const traceRadius = traceable
    ? Math.max(0, Math.min(host.radius - inset, traceWidth / 2, traceHeight / 2))
    : 0;
  const traceLength = traceable
    ? Number(roundedPerimeter(traceWidth, traceHeight, traceRadius).toFixed(3))
    : 0;

  const sweepStyle = {
    animationDuration: `${SPRING_LOAD_DELAY_MS}ms`,
    '--spring-dwell-length': `${traceLength}`,
  } as CSSProperties;

  const showLabel =
    host !== null && host.width >= LABEL_MIN_WIDTH && host.height >= LABEL_MIN_HEIGHT;

  return (
    // Décoratif : le geste est à la souris, et l'ouverture qui suit est, elle,
    // annoncée par la navigation elle-même.
    <div ref={rootRef} aria-hidden="true" className={`spring-dwell-ring ${className || ''}`}>
      <span className="spring-dwell-ring__halo" />
      {traceable && (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="spring-dwell-ring__svg"
          width={host.width}
          height={host.height}
          viewBox={`0 0 ${host.width} ${host.height}`}
        >
          {/* Les couleurs vivent dans global.css : un attribut de présentation
              n'est pas un terrain sûr pour `color-mix()`, une déclaration CSS
              l'est. */}
          <rect
            className="spring-dwell-ring__track"
            x={inset}
            y={inset}
            width={traceWidth}
            height={traceHeight}
            rx={traceRadius}
            ry={traceRadius}
            strokeWidth={STROKE_WIDTH}
          />
          <rect
            className="spring-dwell-ring__sweep"
            x={inset}
            y={inset}
            width={traceWidth}
            height={traceHeight}
            rx={traceRadius}
            ry={traceRadius}
            strokeWidth={STROKE_WIDTH}
            strokeDasharray={traceLength}
            style={sweepStyle}
          />
        </svg>
      )}
      {showLabel && <span className="spring-dwell-ring__label">{t('dragDrop.springOpening')}</span>}
    </div>
  );
};

export default SpringDwellRing;
