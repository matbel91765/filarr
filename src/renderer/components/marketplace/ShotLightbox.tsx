/**
 * LA VISIONNEUSE DE CAPTURES — voir une image en grand, et rien d'autre.
 *
 * ── POURQUOI ELLE EXISTE ────────────────────────────────────────────────────
 *
 * Une fiche montrait sa capture dans un cadre de quelques centaines de pixels,
 * et le clic ne faisait rien. Or c'est précisément ce qu'on veut d'une capture
 * d'écran : la regarder. Sans cette fenêtre, la galerie était une rangée de
 * vignettes qui promettait une image qu'on ne pouvait pas ouvrir.
 *
 * ── CE QU'ELLE FAIT DE PLUS QU'UN `<img>` AGRANDI ───────────────────────────
 *
 * · Échap ferme, ← et → circulent : ce sont les trois gestes qu'on essaie sans
 *   y penser dans n'importe quelle visionneuse. Ne pas les avoir se lit comme
 *   une fenêtre cassée.
 * · Le FOYER est capturé et rendu. On ouvre au clavier, on referme au clavier,
 *   et on retrouve le bouton d'où l'on venait — sinon la tabulation repart du
 *   haut de la page derrière l'image.
 * · Le fond ferme au clic, mais l'image NON : sans cette distinction, cliquer
 *   sur ce qu'on regarde referme la fenêtre.
 *
 * ⚠ CE QU'ELLE NE FAIT PAS : zoomer. Une capture est stockée en 1280×720 (voir
 * `LAYOUT_PREVIEW_WIDTH`) ; l'agrandir au-delà de sa taille propre ne montre
 * rien de plus qu'une bouillie, et proposer une loupe qui ne révèle aucun
 * détail est une promesse vide. L'image est donc CONTENUE, jamais étirée
 * au-delà de ses pixels réels.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import './marketplace.css';

export interface ShotLightboxProps {
  /** Les URL de données, dans l'ordre de la galerie. Jamais vide. */
  shots: readonly string[];
  /** L'indice montré. Écrêté ici : la galerie peut changer sous le pied. */
  index: number;
  /** Le nom de la fiche, pour l'en-tête et le libellé d'accessibilité. */
  title: string;
  onIndex: (index: number) => void;
  onClose: () => void;
}

/** Les éléments qui peuvent recevoir le foyer dans la fenêtre. */
const FOCUSABLE = 'button:not([disabled])';

export const ShotLightbox: React.FC<ShotLightboxProps> = ({
  shots,
  index,
  title,
  onIndex,
  onClose,
}) => {
  const { t } = useTranslation();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  /** Le bouton d'où l'on vient. Rendu au démontage. */
  const returnRef = useRef<Element | null>(null);

  const total = shots.length;
  const current = Math.min(Math.max(index, 0), Math.max(total - 1, 0));

  const step = useCallback(
    (delta: number) => {
      // La circulation est un TORE : au bout, on revient au début. Une flèche
      // qui ne fait rien au dernier élément laisse croire qu'elle est cassée.
      if (total > 1) onIndex((current + delta + total) % total);
    },
    [current, onIndex, total]
  );

  // ── Le foyer : pris à l'ouverture, rendu à la fermeture ──────────────────
  useEffect(() => {
    returnRef.current = document.activeElement;
    closeRef.current?.focus();
    return () => {
      const back = returnRef.current;
      if (back instanceof HTMLElement && document.contains(back)) back.focus();
    };
  }, []);

  // ── Le clavier ───────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        // `stopPropagation` : sans lui, l'Échap qui ferme l'image continue sa
        // route et ferme aussi la fiche derrière elle — deux fermetures pour
        // un geste, et on se retrouve dans le catalogue sans l'avoir demandé.
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        step(1);
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        step(-1);
        return;
      }
      if (event.key !== 'Tab') return;

      // Le piège à foyer. Sans lui, la tabulation sort par le bas et se met à
      // parcourir la page cachée derrière le voile.
      const nodes = surfaceRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    // En CAPTURE : la fiche et la vue marketplace écoutent Échap elles aussi,
    // et c'est la fenêtre du dessus qui doit répondre la première.
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose, step]);

  if (total === 0) return null;

  return createPortal(
    <div
      className="mkt-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={t('marketplace.gallery.viewerLabel', {
        name: title,
        defaultValue: 'Captures de {{name}}',
      })}
      onClick={onClose}
    >
      <div
        className="mkt-lightbox__surface"
        ref={surfaceRef}
        // Le contenu ne referme pas : seul le fond le fait.
        onClick={(event) => event.stopPropagation()}
      >
        {/* `chrome-safe-inline` : cet en-tete touche le bord haut de la fenetre
            sans cadre, et porte un controle a CHAQUE extremite — le titre sous
            les feux macOS, « Fermer » sous les boutons Windows/Linux. Sans les
            deux reserves, le clic sur « Fermer » part a l'OS et ferme
            l'application. La geometrie se mesure : voir styles/chrome.css. */}
        <div className="mkt-lightbox__head chrome-safe-inline">
          <span className="mkt-lightbox__title">
            {title}
            {total > 1 && (
              <span className="mkt-lightbox__counter">
                {t('marketplace.gallery.counter', {
                  index: current + 1,
                  total,
                  defaultValue: '{{index}} / {{total}}',
                })}
              </span>
            )}
          </span>
          <button
            type="button"
            ref={closeRef}
            className="mkt-lightbox__close"
            onClick={onClose}
            aria-label={t('marketplace.gallery.close', 'Fermer')}
          >
            {t('marketplace.gallery.close', 'Fermer')}
            <kbd className="mkt-lightbox__kbd">{t('marketplace.gallery.escKey', 'Échap')}</kbd>
          </button>
        </div>

        <div className="mkt-lightbox__stage">
          {total > 1 && (
            <button
              type="button"
              className="mkt-lightbox__arrow"
              onClick={() => step(-1)}
              aria-label={t('marketplace.gallery.previous', 'Image précédente')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="m15 18-6-6 6-6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
          <div className="mkt-lightbox__frame">
            <img src={shots[current]} alt="" />
          </div>
          {total > 1 && (
            <button
              type="button"
              className="mkt-lightbox__arrow"
              onClick={() => step(1)}
              aria-label={t('marketplace.gallery.next', 'Image suivante')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="m9 18 6-6-6-6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>

        {total > 1 && (
          <div className="mkt-lightbox__thumbs">
            {shots.map((shot, i) => (
              <button
                key={i}
                type="button"
                className={`mkt-lightbox__thumb${i === current ? ' is-current' : ''}`}
                onClick={() => onIndex(i)}
                aria-current={i === current}
                aria-label={t('layouts.market.detail.shotNth', {
                  index: i + 1,
                  total,
                })}
              >
                <img src={shot} alt="" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default ShotLightbox;
