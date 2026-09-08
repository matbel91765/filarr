/**
 * useBlockResize — la poignée de taille, pour n'importe quelle vue de bloc.
 *
 * C'EST LA POIGNÉE DE L'IMAGE, RENDUE PARTAGEABLE. Même coin (bas-droit), même
 * icône, même unité (le pixel), mêmes bords fixes (haut et gauche), même
 * engagement : ce qu'on tire est ce qui bouge. Un bloc n'a plus qu'à brancher
 * trois choses sur son `NodeViewWrapper` — `ref`, `className`, `style` — et à
 * poser `grip` en PREMIER parmi ses enfants (voir plus bas pourquoi).
 *
 * UN SEUL GESTE POUR LES DEUX DIMENSIONS. Le déplacement horizontal règle la
 * largeur, le vertical la hauteur ; on peut ne faire que l'un des deux sans y
 * penser, parce que chacun a une zone de tolérance autour de sa valeur
 * d'office : un écart de moins de `BLOCK_SNAP_TOLERANCE` ne borne rien et
 * n'écrit rien dans le document.
 *
 * LA HAUTEUR VA DANS LES DEUX SENS. On mesure la hauteur NATURELLE du bloc au
 * début du geste, en retirant brièvement la contrainte — non pour en faire un
 * plafond (une version intermédiaire le faisait, et tirer vers le bas ne
 * produisait alors rien du tout), mais pour savoir où se trouve « libre » :
 * repasser à moins de `BLOCK_SNAP_TOLERANCE` de cette hauteur efface la borne
 * au lieu de figer la mesure du jour.
 *
 * POURQUOI LA POIGNÉE VA EN PREMIER. Un bloc borné ne défile PAS lui-même :
 * c'est son dernier enfant qui prend la place restante et défile (cf.
 * `blockSize.css`), pour que l'en-tête et la barre des vues d'une base restent
 * en vue. Si la poignée était le dernier enfant, ce serait ELLE qu'on
 * désignerait comme zone défilante — et le contenu, lui, déborderait.
 *
 * ZÉRO RENDU PENDANT LE GESTE, et ce n'est pas une optimisation gratuite : la
 * vue d'une base inline reconstruit ses lignes, ses groupes et ses colonnes à
 * chaque rendu. Repasser par React à chaque `mousemove` ferait ramer le
 * glissement précisément sur les blocs qu'on redimensionne le plus. On écrit
 * donc la taille directement sur le DOM pendant le geste, et on ne touche au
 * document qu'au relâché.
 *
 * LE PIÈGE QUI VA AVEC. React n'efface que les styles qu'il a lui-même posés :
 * une taille écrite à la main pendant le geste SURVIVRAIT à un retour à la
 * taille d'office (où la propriété `style` de React vaut `undefined`, donc ne
 * décrit rien à effacer). Le bloc resterait figé à la valeur tirée sans qu'un
 * seul attribut du document ne le dise. D'où le nettoyage explicite avant
 * chaque écriture — voir `commit()`.
 */

import React, { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../../../i18n/config';
import {
  heightAttrFor,
  heightFromDrag,
  parseBlockHeight,
  parseBlockWidth,
  stepBlockHeight,
  stepBlockWidth,
  widthAttrFor,
  widthFromDrag,
} from './blockSize';

/** Classe posée sur le bloc : elle ancre la poignée et porte la portée du survol. */
const RESIZABLE_CLASS = 'note-block-resizable';
const RESIZING_CLASS = 'note-block-resizable--resizing';
/** Le bloc est borné en hauteur : c'est son dernier enfant qui défile (cf. le CSS). */
const BOUNDED_CLASS = 'note-block-resizable--bounded';

export interface BlockResize {
  /** À brancher sur le `ref` du `NodeViewWrapper`. */
  ref: React.RefObject<HTMLDivElement>;
  /** À concaténer au `className` du bloc. */
  className: string;
  /** À passer au `style` du bloc (`undefined` = taille d'office). */
  style: React.CSSProperties | undefined;
  /** La poignée elle-même, à rendre en PREMIER parmi les enfants du bloc. */
  grip: React.ReactNode;
}

export interface BlockResizeOptions {
  /** Surface en lecture seule : la taille s'affiche, mais aucune prise. */
  disabled?: boolean;
  /**
   * Ce bloc accepte-t-il une hauteur bornée ? `false` pour ceux dont la hauteur
   * découle de la largeur (une vidéo et son rapport d'image).
   */
  height?: boolean;
}

/**
 * Place disponible en largeur, mesurée MAINTENANT.
 *
 * Le parent d'une vue React est l'enveloppe que TipTap crée pour elle : elle
 * fait exactement la largeur de la colonne de texte, quelle que soit la surface
 * (éditeur, aperçu de version, fenêtre d'un coffre partagé) et quel que soit le
 * réglage de largeur de page. C'est donc la bonne référence, et la seule qui
 * n'ait rien à savoir de la mise en page qui l'entoure.
 */
function availableWidth(el: HTMLElement | null): number {
  if (!el) return NaN;
  const parent = el.parentElement;
  const measured = parent ? parent.clientWidth : el.offsetWidth;
  return measured > 0 ? measured : NaN;
}

/**
 * Hauteur que le bloc prendrait SANS contrainte.
 *
 * On retire la contrainte, on mesure, on la remet — dans la même frame, donc
 * rien ne clignote. C'est plus grossier qu'un calcul, et c'est voulu : la
 * hauteur naturelle d'un kanban dépend de ses cartes, de leur repli, de la
 * largeur courante et de la taille de police du thème. Aucune formule ne
 * suivrait ça ; le navigateur, lui, la connaît déjà.
 */
function naturalHeight(el: HTMLElement | null): number {
  if (!el) return NaN;
  const wasBounded = el.classList.contains(BOUNDED_CLASS);
  const previous = el.style.height;
  if (wasBounded) el.classList.remove(BOUNDED_CLASS);
  el.style.height = '';
  const measured = el.offsetHeight;
  if (wasBounded) el.classList.add(BOUNDED_CLASS);
  el.style.height = previous;
  return measured > 0 ? measured : NaN;
}

export function useBlockResize(
  rawWidth: unknown,
  rawHeight: unknown,
  updateAttributes: (attrs: Record<string, unknown>) => void,
  options: BlockResizeOptions = {}
): BlockResize {
  const { disabled = false, height: heightEnabled = true } = options;
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLSpanElement>(null);

  const width = parseBlockWidth(rawWidth);
  const height = heightEnabled ? parseBlockHeight(rawHeight) : null;

  /**
   * Rend la main au rendu React : on retire la taille écrite à la main AVANT
   * d'écrire dans le document, sinon elle masquerait le résultat (cf. l'en-tête).
   */
  const commit = useCallback(
    (nextWidth: number | null, nextHeight: number | null) => {
      const el = ref.current;
      if (el) {
        el.style.width = '';
        el.style.height = '';
        el.classList.remove(RESIZING_CLASS);
        el.classList.toggle(BOUNDED_CLASS, nextHeight !== null);
      }
      const attrs: Record<string, unknown> = { blockWidthPx: nextWidth };
      if (heightEnabled) attrs.blockHeightPx = nextHeight;
      updateAttributes(attrs);
    },
    [heightEnabled, updateAttributes]
  );

  const onGripMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();

      const el = ref.current;
      if (!el) return;

      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = el.offsetWidth;
      const startHeight = el.offsetHeight;
      const available = availableWidth(el);
      // Mesurée UNE FOIS, au début du geste. Rétrécir la largeur rallonge le
      // contenu, donc ce plafond vieillit un peu pendant le glissement ; le
      // remesurer à chaque pixel coûterait un recalcul de mise en page complet
      // par image, sur le bloc le plus lourd de la note.
      const natural = heightEnabled ? naturalHeight(el) : NaN;

      let lastWidth = startWidth;
      // Initialisée à la borne EXISTANTE, et non à `null` : un simple clic sur la
      // poignée (mousedown + mouseup, sans un seul `mousemove`) libérerait sinon
      // la hauteur d'un bloc déjà borné, sans que rien n'ait été tiré.
      let lastHeight: number | null = height;

      el.classList.add(RESIZING_CLASS);

      const onMove = (ev: MouseEvent) => {
        lastWidth = widthFromDrag(startWidth, ev.clientX - startX, available);
        el.style.width = `${lastWidth}px`;

        if (heightEnabled) {
          lastHeight = heightAttrFor(heightFromDrag(startHeight, ev.clientY - startY), natural);
          // « Libre » ne s'écrit pas en pixels : on retire la contrainte pour
          // que le bloc reprenne SA hauteur, sinon on figerait la mesure du jour.
          el.style.height = lastHeight === null ? '' : `${lastHeight}px`;
          el.classList.toggle(BOUNDED_CLASS, lastHeight !== null);
        }

        // L'étiquette suit par le DOM, pour la même raison que la taille : un
        // `setState` par pixel parcouru rendrait le geste saccadé.
        if (badgeRef.current) {
          badgeRef.current.textContent =
            lastHeight === null ? `${lastWidth} px` : `${lastWidth} × ${lastHeight}`;
        }
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (badgeRef.current) badgeRef.current.textContent = '';
        const nextWidth = widthAttrFor(lastWidth, available);
        // Rien n'a bougé : on n'écrit pas. Une transaction à vide salirait
        // l'historique d'annulation et, sur une note partagée, ferait voyager une
        // mise à jour CRDT pour un clic sans effet.
        if (nextWidth === width && lastHeight === height) {
          const el2 = ref.current;
          if (el2) {
            el2.style.width = '';
            el2.style.height = '';
            el2.classList.remove(RESIZING_CLASS);
          }
          return;
        }
        commit(nextWidth, lastHeight);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [commit, disabled, height, heightEnabled, width]
  );

  /**
   * Le pendant CLAVIER, sur la poignée elle-même : sans lui, régler la taille
   * d'un bloc serait impossible sans souris. `Entrée` / `Espace` / double-clic
   * ramènent à la taille d'office — une prise qui ne sait que rétrécir laisse
   * un bloc rétréci pour toujours.
   */
  const onGripKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;
      const el = ref.current;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        commit(stepBlockWidth(width, e.key === 'ArrowRight' ? 1 : -1, availableWidth(el)), height);
      } else if (heightEnabled && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        commit(width, stepBlockHeight(height, e.key === 'ArrowDown' ? 1 : -1, naturalHeight(el)));
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        commit(null, null);
      }
    },
    [commit, disabled, height, heightEnabled, width]
  );

  const onGripDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      commit(null, null);
    },
    [commit, disabled]
  );

  const style =
    width === null && height === null
      ? undefined
      : {
          ...(width === null ? null : { width: `${width}px` }),
          ...(height === null ? null : { height: `${height}px` }),
        };

  const className = height === null ? RESIZABLE_CLASS : `${RESIZABLE_CLASS} ${BOUNDED_CLASS}`;

  if (disabled) {
    // Une surface en lecture seule (aperçu de version, coffre partagé sans
    // droit d'écriture) AFFICHE la taille mais n'offre aucune prise.
    return { ref, className, style, grip: null };
  }

  const label =
    width === null && height === null
      ? t('notes.blockSize.sizeAuto', "Taille d'origine")
      : height === null
        ? i18n.t('notes.blockSize.widthPx', { defaultValue: '{{n}} px de large', n: width })
        : i18n.t('notes.blockSize.sizePx', {
            defaultValue: '{{w}} × {{h}} px',
            w: width ?? '—',
            h: height,
          });

  const grip = (
    <button
      type="button"
      className="note-block-grip"
      onMouseDown={onGripMouseDown}
      // Le clic est arrêté À PART : `stopPropagation` sur `mousedown` n'empêche
      // pas le `click` qui suit de remonter, et plusieurs blocs (le schéma
      // mermaid, l'embed) passent en édition au clic sur leur enveloppe. On
      // relâcherait la poignée dans un éditeur de code.
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={onGripDoubleClick}
      onKeyDown={onGripKeyDown}
      // Les blocs redimensionnables sont TOUS `draggable` côté ProseMirror (on
      // les déplace à la souris dans la note). Sans ces deux lignes, tirer la
      // poignée déménagerait le bloc au lieu de le redimensionner — le
      // `preventDefault` du `mousedown` suffit sur Chromium, mais il n'y a
      // aucune raison de faire dépendre le geste d'un détail de moteur.
      draggable={false}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      aria-label={`${t('notes.blockSize.resize', 'Redimensionner ce bloc')} — ${label}`}
      title={t(
        'notes.blockSize.resizeHint',
        "Glisser pour redimensionner · double-clic pour la taille d'origine"
      )}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor">
        <path d="M9 1v8H1" strokeWidth="1.5" />
        <path d="M9 5v4H5" strokeWidth="1.5" />
      </svg>
      <span className="note-block-grip__badge" ref={badgeRef} aria-hidden="true" />
    </button>
  );

  return { ref, className, style, grip };
}
