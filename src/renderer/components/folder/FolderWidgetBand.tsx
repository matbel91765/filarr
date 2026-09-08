/**
 * Dossiers personnalisables — LE BANDEAU.
 *
 * ── AU-DESSUS DE LA LISTE, JAMAIS À SA PLACE ────────────────────────────────
 *
 * La liste de fichiers ne bouge pas, ne se déplace pas, ne se retire pas : c'est
 * ce qui garantit qu'un dossier reste un dossier. Le bandeau vit donc AU-DESSUS
 * d'elle, et il est borné en hauteur au repos (voir `folder.css`) : au-delà de
 * deux rangées de blocs, il défile dans son propre cadre au lieu de repousser le
 * premier fichier sous la ligne de flottaison. En édition la borne saute — on ne
 * peut pas ranger ce qu'on ne voit pas.
 *
 * ── REPLIÉ PAR DÉFAUT ───────────────────────────────────────────────────────
 *
 * Un dossier qui n'a rien configuré n'affiche RIEN de ce fichier — pas même le
 * pli. C'est `FolderView` qui décide de monter ce composant ou non ; ici, le
 * repli n'est offert qu'à un dossier qui a effectivement un bandeau.
 *
 * ── LE MODE ÉDITION EST CELUI DE L'ACCUEIL ──────────────────────────────────
 *
 * Même `EditBar`, même `WidgetPalette`, même `WidgetInspector`, même session
 * dans `layoutSlice` — seul l'identifiant de vue change (`folder:<uuid>` au lieu
 * de `home`). Rien n'est recopié : ce qui est ici est le CÂBLAGE de ces trois
 * composants sur une autre vue, et la conséquence directe est qu'une
 * amélioration du mode édition profite aux deux écrans le même jour.
 *
 * ── L'EMPLACEMENT RÉSERVÉ TRAVERSE ──────────────────────────────────────────
 *
 * `slots` porte TOUT ce que la vue contient, y compris `folder-config` (portée,
 * en-tête, note d'accueil, préférences d'affichage). Il est retiré de ce qu'on
 * donne à la grille — il n'a ni case ni format — mais il reste dans le brouillon
 * et dans le commit. Le laisser dehors le ferait disparaître à la sortie du mode
 * édition, et avec lui la couverture du dossier.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import { GridSurface } from '../grid/GridSurface';
import {
  GRID_COLUMNS,
  GRID_GUTTER,
  GRID_ROW_HEIGHT,
  columnsForWidth,
  gridSize,
} from '../grid/gridTypes';
import type {
  GridAllowedSizes,
  GridColumnCount,
  GridConstraintMap,
  GridPlacement,
  GridSizeConstraints,
  GridSizeId,
} from '../grid/gridTypes';
import { insertItem, moveItem } from '../grid/gridSolver';
import { EditBar } from '../home/EditBar';
import { WidgetFrame } from '../home/WidgetFrame';
import { WidgetInspector } from '../home/WidgetInspector';
import { WidgetPalette } from '../home/WidgetPalette';
import { mergeGeometry, toPlacements } from '../home/homeLayout';
import { listWidgets, resolveWidget, type WidgetDefinition } from '../home/widgetRegistry';
import { ConfirmModal } from '../ui/ConfirmModal';
import {
  flashLayoutSlot,
  redoLayoutDraft,
  selectLayoutSlot,
  setLayoutPanel,
  undoLayoutDraft,
} from '../../../store/slices/layoutSlice';
import type { AppDispatch, RootState } from '../../../store';
import {
  instantiate,
  type LayoutSlot,
  type LayoutTemplate,
  type LayoutViewId,
} from '../../../services/layout/layoutTypes';
import {
  FOLDER_BAND_TEMPLATES,
  bandSlots,
  folderPaletteCatalog,
  replaceBand,
} from './folderLayout';
import '../home/homeEdit.css';
import './folder.css';

export interface FolderWidgetBandProps {
  viewId: LayoutViewId;
  /** TOUS les emplacements de la vue, emplacement réservé compris. */
  slots: readonly LayoutSlot[];
  editing: boolean;
  /** Le bandeau est replié (sans effet en édition : on doit voir ce qu'on range). */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Nom du dossier d'où le bandeau est hérité, ou `null`. */
  inheritedFromName?: string | null;
  /** L'UNIQUE porte d'écriture : reçoit TOUS les emplacements. */
  onCommit: (next: LayoutSlot[]) => void;
  onFinishEditing: () => void;
}

/**
 * Identité d'un nouvel emplacement. Le compteur n'est pas décoratif : poser un
 * gabarit crée trois emplacements dans la MÊME milliseconde, et `Date.now()`
 * seul leur donnerait trois fois le même identifiant.
 */
let slotCounter = 0;
function newSlotId(): string {
  slotCounter += 1;
  return `slot-${Date.now().toString(36)}-${slotCounter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

const ChevronIcon: React.FC<{ collapsed: boolean }> = ({ collapsed }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    className={`folder-band__chevron ${collapsed ? 'folder-band__chevron--collapsed' : ''}`}
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
  </svg>
);

export const FolderWidgetBand: React.FC<FolderWidgetBandProps> = ({
  viewId,
  slots,
  editing,
  collapsed,
  onToggleCollapsed,
  inheritedFromName,
  onCommit,
  onFinishEditing,
}) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const editSession = useSelector((state: RootState) => state.layout.edit);
  const installedTemplates = useSelector((state: RootState) => state.layout.document.templates);

  const band = useMemo(() => bandSlots(slots), [slots]);

  // ── Lectures stables pendant un geste ────────────────────────────────────
  // Affectation PENDANT le rendu, jamais dans un effet : `renderItem` est appelé
  // par la grille au rendu même, et un effet arriverait un tour trop tard.
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const tRef = useRef(t);
  tRef.current = t;

  const placements = useMemo<GridPlacement[]>(() => toPlacements(band), [band]);

  const allowedSizes = useMemo<GridAllowedSizes>(() => {
    const map: Record<string, readonly GridSizeId[]> = {};
    for (const slot of band) {
      const definition = resolveWidget(slot.type);
      if (definition) map[slot.id] = definition.sizeShortcuts;
    }
    return map;
  }, [band]);

  /**
   * Les BORNES de la poignée. Ici elles comptent doublement : un bloc de bandeau
   * qui s'allongerait sans fin pousserait le CONTENU du dossier hors de l'écran
   * (voir `widgetRegistry`, où ces blocs sont les seuls à garder un plafond de
   * hauteur alors qu'ils portent des listes).
   */
  const constraints = useMemo<GridConstraintMap>(() => {
    const map: Record<string, GridSizeConstraints> = {};
    for (const slot of band) {
      const definition = resolveWidget(slot.type);
      if (definition?.constraints) map[slot.id] = definition.constraints;
    }
    return map;
  }, [band]);

  /**
   * Signature du CONTENU des blocs, géométrie exclue — c'est elle qui commande
   * l'identité de `renderItem`. Pendant un glissement rien n'est commité : elle
   * ne bouge pas, le rappel garde son identité, et la grille ne re-rend que les
   * cases qui changent de place.
   */
  const contentKey = useMemo(
    () =>
      band
        .map(
          (slot) =>
            `${slot.id}~${slot.type}~${JSON.stringify(slot.options ?? null)}~${JSON.stringify(
              slot.binding ?? null
            )}`
        )
        .join(''),
    [band]
  );

  const selectedSlotId = editSession?.selectedSlotId ?? null;
  const flashSlotId = editSession?.flashSlotId ?? null;
  const panelOpen = editSession?.panelOpen ?? false;
  const panelMode = editSession?.panelMode ?? 'add';

  const selectedSlot = useMemo(
    () => (selectedSlotId ? (band.find((slot) => slot.id === selectedSlotId) ?? null) : null),
    [selectedSlotId, band]
  );

  // ── Écriture ─────────────────────────────────────────────────────────────

  const handleLayoutChange = useCallback(
    (next: GridPlacement[]) => {
      // `mergeGeometry` laisse INTACT tout emplacement absent des placements :
      // c'est ce qui fait traverser `folder-config` sans qu'il ait besoin d'être
      // connu ici.
      onCommit(mergeGeometry(slotsRef.current, next));
    },
    [onCommit]
  );

  /** Une taille posée EXACTEMENT, en cases — le chemin clavier de l'inspecteur. */
  const handleSetSlotGeometry = useCallback(
    (slotId: string, w: number, h: number) => {
      onCommit(slotsRef.current.map((slot) => (slot.id === slotId ? { ...slot, w, h } : slot)));
    },
    [onCommit]
  );

  /** Un format NOMMÉ : le menu du bloc et la prise de format passent par ici. */
  const handleSetSlotSize = useCallback(
    (slotId: string, size: GridSizeId) => {
      const spec = gridSize(size);
      handleSetSlotGeometry(slotId, spec.w, spec.h);
    },
    [handleSetSlotGeometry]
  );

  const handleRemoveSlot = useCallback(
    (slotId: string) => {
      onCommit(slotsRef.current.filter((slot) => slot.id !== slotId));
    },
    [onCommit]
  );

  const handleSetSlotOption = useCallback(
    (slotId: string, key: string, value: unknown) => {
      onCommit(
        slotsRef.current.map((slot) =>
          slot.id === slotId
            ? { ...slot, options: { ...(slot.options ?? {}), [key]: value } }
            : slot
        )
      );
    },
    [onCommit]
  );

  // ── Ajouter un bloc ──────────────────────────────────────────────────────

  const insertWidget = useCallback(
    (definition: WidgetDefinition, at?: { x: number; y: number }) => {
      const base = slotsRef.current;
      const spec = gridSize(definition.defaultSize);
      const id = newSlotId();
      const existing = toPlacements(bandSlots(base));
      const geometry = at
        ? moveItem(
            [...existing, { id, x: at.x, y: at.y, w: spec.w, h: spec.h }],
            id,
            at.x,
            at.y,
            GRID_COLUMNS
          )
        : insertItem(existing, { id, w: spec.w, h: spec.h }, GRID_COLUMNS);
      const created: LayoutSlot = {
        id,
        role: definition.defaultRole,
        type: definition.type,
        x: 0,
        y: 0,
        w: spec.w,
        h: spec.h,
      };
      onCommit(mergeGeometry([...base, created], geometry));
      dispatch(flashLayoutSlot(id));
    },
    [dispatch, onCommit]
  );

  // ── Glisser un bloc de la palette dans la grille ─────────────────────────

  const gridBoxRef = useRef<HTMLDivElement | null>(null);
  const dragWidgetRef = useRef<WidgetDefinition | null>(null);
  const [dropCell, setDropCell] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null
  );

  const cellAt = useCallback((clientX: number, clientY: number, w: number, h: number) => {
    const node = gridBoxRef.current;
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    const cellWidth = (rect.width - GRID_GUTTER * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
    if (cellWidth <= 0) return null;
    const column = Math.floor((clientX - rect.left) / (cellWidth + GRID_GUTTER));
    const row = Math.floor((clientY - rect.top) / (GRID_ROW_HEIGHT + GRID_GUTTER));
    return { x: Math.min(Math.max(0, column), GRID_COLUMNS - w), y: Math.max(0, row), w, h };
  }, []);

  const handleGridDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const definition = dragWidgetRef.current;
      // Ce n'est pas un bloc : c'est un fichier ou un dossier, et ce
      // glisser-déposer là appartient à la liste. On ne le capte pas.
      if (!definition) return;
      event.preventDefault();
      // Le geste RESTE dans le bandeau : sans cet arrêt, chaque survol remontait
      // au conteneur de l'explorateur, qui y voyait un import et posait son
      // overlay « Déposez vos fichiers ici » par-dessus la grille et le témoin.
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
      const spec = gridSize(definition.defaultSize);
      const next = cellAt(event.clientX, event.clientY, spec.w, spec.h);
      setDropCell((previous) =>
        previous && next && previous.x === next.x && previous.y === next.y ? previous : next
      );
    },
    [cellAt]
  );

  const handleGridDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const definition = dragWidgetRef.current;
      if (!definition) return;
      event.preventDefault();
      event.stopPropagation();
      const spec = gridSize(definition.defaultSize);
      const cell = cellAt(event.clientX, event.clientY, spec.w, spec.h);
      dragWidgetRef.current = null;
      setDropCell(null);
      insertWidget(definition, cell ? { x: cell.x, y: cell.y } : undefined);
    },
    [cellAt, insertWidget]
  );

  const dropGhostStyle = useMemo(() => {
    if (!dropCell) return undefined;
    const track = `((100% - ${GRID_GUTTER * (GRID_COLUMNS - 1)}px) / ${GRID_COLUMNS})`;
    return {
      left: `calc(${track} * ${dropCell.x} + ${dropCell.x * GRID_GUTTER}px)`,
      width: `calc(${track} * ${dropCell.w} + ${(dropCell.w - 1) * GRID_GUTTER}px)`,
      top: `${dropCell.y * (GRID_ROW_HEIGHT + GRID_GUTTER)}px`,
      height: `${dropCell.h * GRID_ROW_HEIGHT + (dropCell.h - 1) * GRID_GUTTER}px`,
    };
  }, [dropCell]);

  // ── Repartir d'un modèle ─────────────────────────────────────────────────

  const templates = useMemo<LayoutTemplate[]>(() => {
    // Les gabarits INSTALLÉS peuvent décrire un accueil comme un bandeau : le
    // document ne les range pas par famille. On les propose après ceux d'ici,
    // qui sont les seuls écrits pour un dossier.
    const installed = Object.values(installedTemplates).filter(
      (template) => !FOLDER_BAND_TEMPLATES.some((builtin) => builtin.id === template.id)
    );
    return [...FOLDER_BAND_TEMPLATES, ...installed];
  }, [installedTemplates]);

  const [templateToApply, setTemplateToApply] = useState<LayoutTemplate | null>(null);

  const applyTemplate = useCallback(
    (template: LayoutTemplate) => {
      const view = instantiate(template, {
        viewId,
        newSlotId,
        now: new Date().toISOString(),
      });
      // L'emplacement réservé SURVIT au gabarit : il ne décrit pas des blocs, il
      // décrit le dossier. Un modèle qui effacerait la couverture et la note
      // d'accueil en même temps que la disposition serait un piège.
      onCommit(replaceBand(slotsRef.current, view.slots));
      dispatch(setLayoutPanel({ open: false }));
    },
    [dispatch, onCommit, viewId]
  );

  const templateConfirmMessage = useMemo(() => {
    if (!templateToApply) return '';
    return t(
      'folder.customize.resetMessage',
      'Le bandeau de ce dossier sera remplacé par « {{name}} ». Seule la disposition change : aucun fichier, aucune note et aucun dossier n’est touché.',
      { name: templateToApply.name }
    );
  }, [templateToApply, t]);

  // ── Ce que la palette offre ──────────────────────────────────────────────

  // Blocs « de ce dossier » en tête, sans le bloc de page « Tous les dossiers ».
  // Le registre ne change pas d'ordre : c'est la palette de l'accueil qui a
  // besoin de l'autre.
  const paletteCatalog = useMemo(() => folderPaletteCatalog(listWidgets()), []);

  // ── Ce que le dossier affichera AU REPOS ─────────────────────────────────
  //
  // On édite la disposition MAÎTRESSE, en douze colonnes forcées ; hors édition
  // la grille se reprojette sur la largeur réelle (six colonnes sous 1 200 px).
  // Mesuré sur l'ESPACE DE TRAVAIL et non sur la grille : c'est la largeur que
  // la grille retrouvera une fois le panneau refermé. Quand les deux diffèrent,
  // on le DIT — sinon « ce qu'on range n'est pas ce qu'on voit ».
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const [restColumns, setRestColumns] = useState<GridColumnCount>(GRID_COLUMNS);
  useEffect(() => {
    if (!editing) return;
    const node = workspaceRef.current;
    if (!node) return;
    setRestColumns(columnsForWidth(node.getBoundingClientRect().width));
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setRestColumns(columnsForWidth(entry.contentRect.width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [editing]);

  // ── Le rendu d'un bloc ───────────────────────────────────────────────────

  const renderItem = useCallback(
    (id: string) => {
      const slot = slotsRef.current.find((candidate) => candidate.id === id);
      if (!slot) return null;
      const definition = resolveWidget(slot.type);

      const inner = definition ? (
        <WidgetFrame
          slotId={slot.id}
          definition={definition}
          options={slot.options}
          binding={slot.binding}
          editing={editing}
        />
      ) : editing ? (
        <div className="home-widget__unknown">
          {tRef.current('home.customize.unknownWidget', 'Bloc indisponible dans cette version')}
        </div>
      ) : null;

      const className = [
        'home-slot',
        editing && slot.id === selectedSlotId ? 'home-slot--selected' : '',
        slot.id === flashSlotId ? 'home-slot--flash' : '',
      ]
        .filter(Boolean)
        .join(' ');

      // AU REPOS : une enveloppe muette, sans rôle ni tabulation — rien qui
      // distingue ce bandeau d'une section écrite à la main.
      if (!editing) return <div className={className}>{inner}</div>;

      return (
        <div
          className={className}
          role="button"
          tabIndex={0}
          aria-pressed={slot.id === selectedSlotId}
          onClick={() => dispatch(selectLayoutSlot(slot.id))}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            dispatch(selectLayoutSlot(slot.id));
          }}
        >
          {inner}
        </div>
      );
    },
    // `slots` est lu par ref pour que l'identité de ce rappel survive à un
    // geste ; ce qui la commande est `contentKey`, qui ne bouge que si le
    // contenu d'un bloc change — jamais pour un simple déplacement.
    [editing, contentKey, selectedSlotId, flashSlotId, dispatch]
  );

  // ── Rendu ────────────────────────────────────────────────────────────────

  const showGrid = editing || !collapsed;
  const canUndo = (editSession?.past.length ?? 0) > 0;
  const canRedo = (editSession?.future.length ?? 0) > 0;

  return (
    <section
      className={['folder-band', editing ? 'folder-band--editing' : ''].filter(Boolean).join(' ')}
      aria-label={t('folder.band.label', 'Bandeau du dossier')}
      // Le bandeau n'est pas une surface de sélection : le lasso de fichiers de
      // l'explorateur (`useRubberBandSelection`) ne part jamais d'ici — ni de la
      // trame en édition, ni de la barre, ni de la palette.
      data-no-rubber-band=""
    >
      {editing ? (
        <EditBar
          addActive={panelOpen && !selectedSlot && panelMode === 'add'}
          templatesActive={panelOpen && !selectedSlot && panelMode === 'templates'}
          onToggleAdd={() =>
            dispatch(
              setLayoutPanel({
                open: !(panelOpen && !selectedSlot && panelMode === 'add'),
                mode: 'add',
              })
            )
          }
          onOpenTemplates={() => dispatch(setLayoutPanel({ open: true, mode: 'templates' }))}
          // « Modèle ▾ » ouvre LES MODÈLES DE BANDEAU (panneau `templates`), pas
          // les modèles d'accueil : ceux-là remplacent le brouillon en bloc et
          // emportaient l'emplacement réservé — icône, couverture et note
          // d'accueil disparaissaient au « Terminé ».
          onPickTemplate={() => dispatch(setLayoutPanel({ open: true, mode: 'templates' }))}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={() => dispatch(undoLayoutDraft())}
          onRedo={() => dispatch(redoLayoutDraft())}
          onDone={onFinishEditing}
        />
      ) : (
        <div className="folder-band__bar">
          <button
            type="button"
            className="folder-band__toggle"
            aria-expanded={!collapsed}
            onClick={onToggleCollapsed}
          >
            <ChevronIcon collapsed={collapsed} />
            <span>{t('folder.band.title', 'Bandeau')}</span>
          </button>
          {/* D'où viennent ces blocs, écrit noir sur blanc. Sans cette phrase,
              modifier le bandeau d'un dossier hérité donnerait l'impression de
              ne modifier que lui — alors que le geste porte sur son parent. */}
          {inheritedFromName && (
            <span className="folder-band__origin">
              {t('folder.band.inherited', 'Hérité de « {{name}} »', { name: inheritedFromName })}
            </span>
          )}
        </div>
      )}

      {/* Ce que « Terminé » fera d'un bandeau hérité : la prise de main vit dans
          le brouillon, et valider l'écrit. Dit AVANT, pas découvert après. */}
      {editing && inheritedFromName && (
        <p className="folder-band__hint">
          {t(
            'folder.band.detachOnDone',
            'Bandeau hérité de « {{name}} » : « Terminé » donnera à ce dossier son propre bandeau.',
            { name: inheritedFromName }
          )}
        </p>
      )}
      {editing && restColumns !== GRID_COLUMNS && (
        <p className="folder-band__hint">
          {t(
            'folder.band.narrowPreview',
            'Rangé sur douze colonnes ; à cette largeur, le dossier l’affiche sur {{columns}}.',
            { columns: restColumns }
          )}
        </p>
      )}

      {showGrid && (
        <div ref={workspaceRef} className="folder-band__workspace">
          <div
            ref={gridBoxRef}
            className="folder-band__grid"
            onDragOver={handleGridDragOver}
            onDrop={handleGridDrop}
          >
            <GridSurface
              layout={placements}
              editing={editing}
              onLayoutChange={handleLayoutChange}
              allowedSizes={allowedSizes}
              constraints={constraints}
              renderItem={renderItem}
              // ON N'ÉDITE QUE LA DISPOSITION MAÎTRESSE : sans ce forçage,
              // ouvrir le panneau ferait passer la grille sous les douze
              // colonnes et le moteur refuserait tous les gestes, en silence.
              columnsOverride={editing ? GRID_COLUMNS : undefined}
              emptyState={
                editing ? (
                  <p className="folder-band__empty">
                    {t(
                      'folder.band.empty',
                      'Ajoutez un bloc pour donner des repères à ce dossier.'
                    )}
                  </p>
                ) : undefined
              }
            />
            {dropGhostStyle && (
              <div className="home-drop-ghost" style={dropGhostStyle} aria-hidden="true" />
            )}
          </div>

          {editing && (
            <div
              className={['home-workspace__panel', panelOpen ? 'home-workspace__panel--open' : '']
                .filter(Boolean)
                .join(' ')}
            >
              {panelOpen &&
                (selectedSlot ? (
                  <WidgetInspector
                    slot={selectedSlot}
                    definition={resolveWidget(selectedSlot.type)}
                    onClose={() => {
                      dispatch(selectLayoutSlot(null));
                      dispatch(setLayoutPanel({ open: false }));
                    }}
                    onResize={(w, h) => handleSetSlotGeometry(selectedSlot.id, w, h)}
                    onOption={(key, value) => handleSetSlotOption(selectedSlot.id, key, value)}
                    onRemove={() => handleRemoveSlot(selectedSlot.id)}
                  />
                ) : (
                  <WidgetPalette
                    mode={panelMode}
                    onClose={() => dispatch(setLayoutPanel({ open: false }))}
                    onInsert={insertWidget}
                    onDragWidgetStart={(definition) => {
                      dragWidgetRef.current = definition;
                    }}
                    onDragWidgetEnd={() => {
                      dragWidgetRef.current = null;
                      setDropCell(null);
                    }}
                    templates={templates}
                    activeTemplateId={editSession?.templateId}
                    onPickTemplate={setTemplateToApply}
                    catalog={paletteCatalog}
                    title={t('folder.palette.title', 'Ajouter un bloc au bandeau')}
                    templatesHint={t(
                      'folder.palette.templatesHint',
                      'Un modèle remplace le bandeau de ce dossier. Vos fichiers, vos notes et vos dossiers ne sont pas touchés.'
                    )}
                  />
                ))}
            </div>
          )}
        </div>
      )}

      {/* Le geste reste dans le brouillon : Ctrl+Z le défait et rien n'est écrit
          avant « Terminé ». D'où `warning` et non `danger` — rien ne se perd. */}
      <ConfirmModal
        isOpen={templateToApply !== null}
        onClose={() => setTemplateToApply(null)}
        onConfirm={() => {
          if (templateToApply) applyTemplate(templateToApply);
          setTemplateToApply(null);
        }}
        title={t('folder.customize.resetTitle', 'Repartir d’un modèle ?')}
        message={templateConfirmMessage}
        confirmText={t('common.apply', 'Appliquer')}
        cancelText={t('common.cancel', 'Annuler')}
        variant="warning"
      />
    </section>
  );
};

export default FolderWidgetBand;
