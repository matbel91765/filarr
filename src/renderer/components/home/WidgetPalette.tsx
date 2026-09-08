/**
 * Mode édition — LA PALETTE (et le sélecteur de modèles).
 *
 * ── UN APERÇU VIVANT, PAS UNE ICÔNE ─────────────────────────────────────────
 *
 * Chaque entrée monte le VRAI widget, avec les VRAIES données du compte, à
 * l'échelle 0,5. Ça ne coûte presque rien — le composant existe déjà, il lit
 * déjà le store — et ça remplace la question « à quoi ressemble “Notes récentes”
 * ? » par sa réponse. Une icône et un nom obligent à ajouter le bloc pour le
 * savoir, puis à le retirer : deux gestes pour une information qu'on pouvait
 * donner gratuitement.
 *
 * Les aperçus sont INERTES (`pointer-events: none`) : ce sont des vignettes, pas
 * des blocs. Un aperçu cliquable ouvrirait une note depuis la palette.
 *
 * ── UNE SOURCE VIDE SE DIT, ELLE NE SE CACHE PAS ────────────────────────────
 *
 * Un bloc sans rien à montrer aujourd'hui reste dans la liste, grisé, avec sa
 * raison ÉCRITE (« Coffres partagés — vous n'en avez aucun »). Le masquer
 * laisserait croire que le produit ne sait pas faire, et la seule façon de
 * découvrir la fonction serait de tomber dessus ailleurs. Il reste insérable :
 * poser le bloc avant d'avoir la donnée est un usage légitime — c'est même comme
 * ça qu'on se prépare une place.
 *
 * L'exception : un bloc RETIRÉ (`retired` dans le registre). Il ne rend plus
 * rien et ne le rendra plus jamais ; le montrer grisé « rien à afficher »
 * promettrait une fonction supprimée. Il reste servi pour les dispositions qui
 * le portent encore, mais la palette ne l'offre pas.
 *
 * ── LE PANNEAU POUSSE, IL NE RECOUVRE PAS ───────────────────────────────────
 *
 * Voir `homeEdit.css` : la grille se recompose à côté. Un panneau qui recouvre
 * cache précisément l'endroit où le bloc va tomber.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import { GRID_GUTTER, GRID_ROW_HEIGHT, gridSize } from '../grid/gridTypes';
import { listWidgets, resolveWidget, type WidgetDefinition } from './widgetRegistry';
import { FILARR_WIDGET_MIME } from '../../../hooks/dragMime';
import type { LayoutEditPanelMode } from '../../../store/slices/layoutSlice';
import type { LayoutTemplate } from '../../../services/layout/layoutTypes';
import type { RootState } from '../../../store';
import './homeEdit.css';

/** Largeur utile d'une vignette, en pixels. Le panneau fait 320 px moins ses marges. */
const PREVIEW_WIDTH = 288;

/** Échelle des aperçus. 0,5 : lisible, et deux fois moins de pixels à peindre. */
const PREVIEW_SCALE = 0.5;

/**
 * Hauteur d'aperçu, en rangées. Deux au maximum : un bloc « Haute » (quatre
 * rangées) ferait une vignette de 200 px et on ne verrait plus que lui dans la
 * liste. Ce qu'on montre est une IDENTITÉ, pas une maquette au millimètre.
 */
const PREVIEW_MAX_ROWS = 2;

export interface WidgetPaletteProps {
  mode: LayoutEditPanelMode;
  onClose: () => void;
  /** Clic : insertion au premier emplacement libre. */
  onInsert: (definition: WidgetDefinition) => void;
  /** Début d'un glissement vers la grille. */
  onDragWidgetStart: (definition: WidgetDefinition) => void;
  onDragWidgetEnd: () => void;
  templates: readonly LayoutTemplate[];
  activeTemplateId?: string;
  onPickTemplate: (template: LayoutTemplate) => void;
  /**
   * Le catalogue OFFERT, dans l'ordre de présentation. Absent : tout le
   * registre moins les blocs retirés — l'ordre de l'accueil. Le bandeau d'un
   * dossier passe le sien, blocs « de ce dossier » en tête : le registre les
   * range en fin de liste pour l'accueil, et les six premiers affichés y
   * seraient sinon six blocs qui ne parlent pas du dossier ouvert.
   */
  catalog?: readonly WidgetDefinition[];
  /** Titre du panneau en mode « ajouter » — celui de l'accueil par défaut. */
  title?: string;
  /** Phrase d'avertissement des modèles — celle de l'accueil par défaut. */
  templatesHint?: string;
}

/** Hauteur en pixels de `rows` rangées de grille, gouttières comprises. */
function rowsHeight(rows: number): number {
  return rows * GRID_ROW_HEIGHT + (rows - 1) * GRID_GUTTER;
}

/**
 * Le catalogue tel que la palette l'OFFRE : sans les blocs retirés. On filtre
 * ICI et non dans `listWidgets`, que `knownCoreTypes` lit aussi pour valider
 * les dispositions importées — un bloc retiré doit rester connu à l'import.
 */
function offeredWidgets(): readonly WidgetDefinition[] {
  return listWidgets().filter((definition) => !definition.retired);
}

// ==================== Une entrée du catalogue ====================

interface PaletteEntryProps {
  definition: WidgetDefinition;
  empty: boolean;
  onInsert: (definition: WidgetDefinition) => void;
  onDragWidgetStart: (definition: WidgetDefinition) => void;
  onDragWidgetEnd: () => void;
}

const PaletteEntry: React.FC<PaletteEntryProps> = ({
  definition,
  empty,
  onInsert,
  onDragWidgetStart,
  onDragWidgetEnd,
}) => {
  const { t } = useTranslation();
  const { Component } = definition;

  /**
   * `inert` retire TOUT le sous-arbre de la tabulation et du survol : sans lui,
   * les boutons et les liens du widget d'aperçu resteraient atteignables au
   * clavier et la palette deviendrait un labyrinthe de focus. Il est posé à la
   * main parce que les types de React 18 ne le connaissent pas encore — la
   * chaîne vide pose bien l'attribut côté DOM.
   */
  const markInert = useCallback((node: HTMLSpanElement | null) => {
    if (node) node.setAttribute('inert', '');
  }, []);

  const spec = gridSize(definition.defaultSize);
  const rows = Math.min(spec.h, PREVIEW_MAX_ROWS);
  const boxHeight = Math.round(rowsHeight(rows) * PREVIEW_SCALE);
  const title = t(definition.titleKey);

  // « Coffres partagés — vous n'en avez aucun ». La raison est propre au bloc
  // quand on sait la dire, générique sinon : mieux vaut une phrase vraie et
  // vague qu'un silence.
  const reason = empty
    ? t(
        `home.palette.empty.${definition.id}`,
        t('home.palette.emptyGeneric', 'rien à afficher pour le moment')
      )
    : '';

  const className = ['home-palette__entry', empty ? 'home-palette__entry--empty' : '']
    .filter(Boolean)
    .join(' ');

  /**
   * `div role="button"` et non `<button>` : l'entrée CONTIENT un widget entier,
   * donc des boutons et des liens. Les imbriquer dans un vrai bouton produit du
   * HTML invalide et deux cibles pour un seul geste.
   */
  return (
    <li className="home-palette__item">
      <div
        role="button"
        tabIndex={0}
        className={className}
        draggable
        onClick={() => onInsert(definition)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onInsert(definition);
        }}
        onDragStart={(event) => {
          // La charge utile ne sert à rien côté application (le type voyage par
          // un rappel), mais un glissement sans données n'est pas un glissement
          // valide : sans elle, `drop` n'arrive jamais.
          event.dataTransfer.setData('text/plain', definition.type);
          // Le MARQUEUR, lisible dès `dragover` par tout conteneur traversé :
          // c'est lui qui dit à la zone d'import de l'explorateur que ce
          // glisser n'est pas le sien. Sans lui, un bloc tiré vers la grille
          // allumait « Déposez vos fichiers ici » par-dessus la grille.
          event.dataTransfer.setData(FILARR_WIDGET_MIME, definition.type);
          event.dataTransfer.effectAllowed = 'copy';
          onDragWidgetStart(definition);
        }}
        onDragEnd={onDragWidgetEnd}
        title={t('home.palette.insertHint', 'Cliquez pour poser, ou glissez dans la grille')}
      >
        <span className="home-palette__name">{title}</span>
        {empty && <span className="home-palette__reason">{reason}</span>}

        {/* La vignette. `aria-hidden` la retire du récit — elle répète en pixels
            ce que le nom dit déjà — et `inert` (posé par `markInert`) la retire
            de la tabulation. */}
        <span
          ref={markInert}
          className="home-palette__preview"
          style={{ height: `${boxHeight}px` }}
          aria-hidden="true"
        >
          <span
            className="home-palette__preview-inner"
            style={{
              width: `${Math.round(PREVIEW_WIDTH / PREVIEW_SCALE)}px`,
              height: `${rowsHeight(rows)}px`,
              transform: `scale(${PREVIEW_SCALE})`,
            }}
          >
            <Component slotId={`palette:${definition.id}`} editing={false} />
          </span>
        </span>
      </div>
    </li>
  );
};

// ==================== Un modèle ====================

/**
 * L'aperçu d'un modèle est sa GÉOMÉTRIE, pas son contenu : un modèle décrit des
 * rôles, et deux comptes ne mettront pas les mêmes données dedans. Montrer des
 * rectangles nommés dit exactement ce qu'on va recevoir — montrer des données
 * ferait une promesse que l'installation ne tiendrait pas.
 */
const TemplatePreview: React.FC<{ template: LayoutTemplate }> = ({ template }) => {
  const { t } = useTranslation();
  const rows = template.slots.reduce((m, s) => Math.max(m, s.y + s.h), 0);

  return (
    <span
      className="home-template__map"
      style={{ ['--home-template-rows' as string]: String(Math.max(rows, 1)) }}
    >
      {template.slots.map((slot, index) => {
        const definition = resolveWidget(slot.type);
        return (
          <span
            key={`${slot.type}-${index}`}
            className="home-template__cell"
            style={{
              ['--home-template-x' as string]: String(slot.x + 1),
              ['--home-template-y' as string]: String(slot.y + 1),
              ['--home-template-w' as string]: String(slot.w),
              ['--home-template-h' as string]: String(slot.h),
            }}
          >
            {definition ? t(definition.titleKey) : slot.type}
          </span>
        );
      })}
    </span>
  );
};

// ==================== Le panneau ====================

export const WidgetPalette: React.FC<WidgetPaletteProps> = ({
  mode,
  onClose,
  onInsert,
  onDragWidgetStart,
  onDragWidgetEnd,
  templates,
  activeTemplateId,
  onPickTemplate,
  catalog: catalogProp,
  title,
  templatesHint,
}) => {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);

  const catalog = catalogProp ?? offeredWidgets();

  /**
   * Les blocs sans rien à montrer, en une seule lecture du store et sous forme
   * de CHAÎNE : `useSelector` compare par identité, et un tableau neuf à chaque
   * action re-rendrait la palette — donc les douze aperçus — en permanence.
   */
  const emptyKey = useSelector((state: RootState) =>
    catalog
      .filter((definition) => definition.isEmpty?.(state) === true)
      .map((definition) => definition.id)
      .join('|')
  );

  const emptyIds = useMemo(() => new Set(emptyKey ? emptyKey.split('|') : []), [emptyKey]);

  // Les six premiers d'abord : le catalogue est écrit dans l'ordre où on
  // présente les blocs, et dérouler douze aperçus vivants d'un coup fait un mur.
  const shown = showAll ? catalog : catalog.slice(0, 6);

  return (
    <aside
      className="home-panel"
      aria-label={title ?? t('home.palette.title', 'Ajouter un élément')}
    >
      <div className="home-panel__header">
        <h2 className="home-panel__title">
          {mode === 'templates'
            ? t('home.palette.templatesTitle', 'Repartir d’un modèle')
            : (title ?? t('home.palette.title', 'Ajouter un élément'))}
        </h2>
        <button
          type="button"
          className="home-panel__close"
          aria-label={t('common.close', 'Fermer')}
          title={t('common.close', 'Fermer')}
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      {mode === 'templates' ? (
        <div className="home-panel__body">
          <p className="home-panel__hint">
            {templatesHint ??
              t(
                'home.palette.templatesHint',
                'Un modèle remplace la disposition de votre accueil. Vos fichiers, vos notes et vos dossiers ne sont pas touchés.'
              )}
          </p>
          <ul className="home-panel__list">
            {templates.map((template) => (
              <li key={template.id} className="home-palette__item">
                <button
                  type="button"
                  className={[
                    'home-template',
                    template.id === activeTemplateId ? 'home-template--active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => onPickTemplate(template)}
                >
                  <span className="home-palette__name">{template.name}</span>
                  <TemplatePreview template={template} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="home-panel__body">
          <p className="home-panel__hint">
            {t('home.palette.insertHint', 'Cliquez pour poser, ou glissez dans la grille')}
          </p>
          <ul className="home-panel__list">
            {shown.map((definition) => (
              <PaletteEntry
                key={definition.id}
                definition={definition}
                empty={emptyIds.has(definition.id)}
                onInsert={onInsert}
                onDragWidgetStart={onDragWidgetStart}
                onDragWidgetEnd={onDragWidgetEnd}
              />
            ))}
          </ul>
          {!showAll && catalog.length > shown.length && (
            <button type="button" className="home-panel__more" onClick={() => setShowAll(true)}>
              {t('home.palette.showAll', 'Voir tous les blocs')}
            </button>
          )}
        </div>
      )}
    </aside>
  );
};

export default WidgetPalette;
