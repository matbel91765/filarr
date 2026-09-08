/**
 * NotesView Component — Filarr Notes
 *
 * Main view orchestrating the Notes feature:
 * - Left panel: NotesList (sidebar with all notes)
 * - Center: NoteEditor (TipTap)
 * - Bottom: BacklinksPanel
 * - Graph mode: GraphView
 */

import React, { Component, useCallback, useEffect, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../store';
import {
  selectAllNotes,
  selectEditingNote,
  selectNote,
  setEditingNote,
  updateNoteContent,
  updateNote,
  addNote,
  resolveNoteLinks,
  setNotesViewMode,
  requestScrollToHeading,
} from '../../../store/slices/notesSlice';
import { computeRenameUpdates } from '../../../services/notes/noteRenamePropagation';
import { NoteOpenerProvider } from '../../../contexts/NoteOpenerContext';
import type { NotesState } from '../../../store/slices/notesSlice';
import {
  createDailyNote as createDailyNoteForDate,
  createNote as createNoteService,
} from '../../../services/notes/noteService';
import { useNavigate } from 'react-router-dom';
import { NotesList } from './NotesList';
import { VaultNotePane } from './VaultNotePane';
import { vaultNoteExplorerDestination } from './noteShareNavigation';
import { NoteEditor } from './NoteEditor';
import type { NoteEditorCommentsHandle } from './NoteEditor';
import { BacklinksPanel } from './BacklinksPanel';
import { NoteFolderPicker } from './NoteFolderPicker';
import { NoteBreadcrumb } from './NoteBreadcrumb';
import { LinkPreviewPopover } from './LinkPreviewPopover';
import { GraphView } from './GraphView';
import { MasonryView } from './MasonryView';
import { KanbanView } from './KanbanView';
import { StickyNotesView } from './StickyNotesView';
import { DatabaseView } from './DatabaseView';
import { SmartTagsSuggestion } from './SmartTagsSuggestion';
import { OutlinePanel } from './OutlinePanel';
import { CommentsPanel } from './CommentsPanel';
import type { NoteComment } from './CommentsPanel';
import { TasksAggregator } from './TasksAggregator';
import MindMapView from './MindMapView';
import { CalendarView } from './CalendarView';
import { CalendarWidget } from './CalendarWidget';
import { PeriodicNotes } from './PeriodicNotes';
import StyleSettingsPanel from './StyleSettingsPanel';
import QuickSwitcherPlus from './QuickSwitcherPlus';
import { TemplaterModal } from './TemplaterModal';
import { setNotesFocusMode } from '../../../store/slices/uiSlice';
import { resolveChrome } from './editorChromeModel';
import './NotesView.css';

// ==================== Épinglage des panneaux ====================

/**
 * L'ÉPINGLAGE N'EST PAS PERSISTÉ, ET C'EST VOULU.
 *
 * Première version : il l'était, par profil. Un clic sur une bascule — ou un
 * Ctrl+B — écrivait « épinglé » sur le disque, et ce oui-là survivait à tout :
 * cocher « panneaux au survol » ne produisait alors plus rien, sans le moindre
 * signal, puisque « épinglé » l'emportait sur le réglage. Une préférence qu'un
 * geste ancien peut annuler en silence n'est pas une préférence.
 *
 * Le réglage est donc souverain : il fixe l'état de départ des deux panneaux,
 * et l'épinglage n'est plus qu'un écart le temps de la session. C'est aussi ce
 * que faisait le code d'origine (`useState(true)`), donc rien ne se perd en
 * affichage normal.
 */
/**
 * Le geste vise-t-il un champ de saisie ?
 *
 * Repris de `useKeyboardShortcuts` (qui le garde en interne) : sans cette
 * garde, Ctrl+B tapé dans une note mettait du gras ET repliait la liste.
 */
const isEditableTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable) return true;
  return ['input', 'textarea', 'select'].includes(el.tagName.toLowerCase());
};

/** Largeur de la bande de bord qui appelle un panneau, et de la zone qui le retient. */
const PEEK_EDGE_PX = 28;
const PEEK_KEEP_LEFT_PX = 340;
const PEEK_KEEP_RIGHT_PX = 300;

// ==================== Icons ====================

const ListViewIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

const GraphViewIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <circle cx="6" cy="6" r="3" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="18" r="3" />
    <line x1="8.5" y1="7.5" x2="15.5" y2="16.5" />
    <line x1="15.5" y1="7.5" x2="8.5" y2="16.5" />
  </svg>
);

const MasonryViewIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="3" width="7" height="10" rx="1" />
    <rect x="14" y="3" width="7" height="6" rx="1" />
    <rect x="3" y="16" width="7" height="5" rx="1" />
    <rect x="14" y="12" width="7" height="9" rx="1" />
  </svg>
);

const KanbanViewIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="3" width="5" height="18" rx="1" />
    <rect x="10" y="3" width="5" height="12" rx="1" />
    <rect x="17" y="3" width="5" height="15" rx="1" />
  </svg>
);

const StickyViewIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M15.5 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V8.5L15.5 3z" />
    <path d="M14 3v6h6" />
  </svg>
);

const DatabaseViewIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="3" y1="15" x2="21" y2="15" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </svg>
);

const TasksViewIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="5" width="6" height="6" rx="1" />
    <path d="M5 8l1.5 1.5L9 7" />
    <line x1="13" y1="8" x2="21" y2="8" />
    <rect x="3" y="14" width="6" height="6" rx="1" />
    <path d="M5 17l1.5 1.5L9 16" />
    <line x1="13" y1="17" x2="21" y2="17" />
  </svg>
);

const CalendarViewIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const MindMapViewIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <circle cx="12" cy="12" r="3" />
    <line x1="15" y1="12" x2="20" y2="6" />
    <line x1="15" y1="12" x2="20" y2="18" />
    <line x1="9" y1="12" x2="4" y2="8" />
    <line x1="9" y1="12" x2="4" y2="16" />
    <circle cx="20" cy="6" r="2" />
    <circle cx="20" cy="18" r="2" />
    <circle cx="4" cy="8" r="2" />
    <circle cx="4" cy="16" r="2" />
  </svg>
);

const EmptyNoteIcon = () => (
  <svg
    width="64"
    height="64"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={0.8}
    opacity={0.3}
  >
    <path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" />
    <polyline points="14,2 14,8 20,8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <line x1="10" y1="9" x2="8" y2="9" />
  </svg>
);

// ==================== Graph Error Boundary ====================

interface GraphErrorBoundaryProps {
  children: ReactNode;
  onReset: () => void;
}

interface GraphErrorBoundaryState {
  hasError: boolean;
}

class GraphErrorBoundary extends Component<GraphErrorBoundaryProps, GraphErrorBoundaryState> {
  state: GraphErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): GraphErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[GraphView] Crashed:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="notes-view__empty">
          <p style={{ opacity: 0.6 }}>Graph view encountered an error.</p>
          <button
            className="notes-view__mode-btn"
            style={{
              marginTop: 12,
              padding: '6px 16px',
              background: 'var(--color-primary-600, #4682b4)',
              color: '#fff',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
            }}
            onClick={() => {
              this.setState({ hasError: false });
              this.props.onReset();
            }}
          >
            Switch to List View
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ==================== Component ====================

interface NotesViewProps {
  initialNoteId?: string;
  /**
   * UNE NOTE DE COFFRE À MONTRER ICI MÊME, portée par la route
   * `/notes/vault/<coffre>/<élément>`.
   *
   * Elle prend la place du panneau d'édition ordinaire, et RIEN D'AUTRE : la
   * liste, les panneaux latéraux et les modes de vue ne bougent pas. Elle ne
   * passe jamais par `notesSlice` — sa persistance n'a rien de commun avec
   * celle d'une note locale (voir l'en-tête de `VaultNotePane`), et une note
   * PERSONNELLE se comporte exactement comme avant.
   */
  vaultNote?: { vaultId: string; itemId: string };
}

export const NotesView: React.FC<NotesViewProps> = React.memo(function NotesView({
  initialNoteId,
  vaultNote,
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();

  const editorAreaRef = useRef<HTMLDivElement>(null);
  const commentsHandleRef = useRef<NoteEditorCommentsHandle | null>(null);

  // Draggable mode toggle bar
  const [modeBarPos, setModeBarPos] = useState<{ x: number; y: number } | null>(null);
  const [isDraggingModeBar, setIsDraggingModeBar] = useState(false);
  const modeBarDragOffset = useRef({ x: 0, y: 0 });

  const handleModeBarDragStart = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      e.preventDefault();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const parentRect = (e.currentTarget as HTMLElement).offsetParent?.getBoundingClientRect() || {
        left: 0,
        top: 0,
      };
      const currentX = modeBarPos?.x ?? rect.left - parentRect.left;
      const currentY = modeBarPos?.y ?? rect.top - parentRect.top;
      setIsDraggingModeBar(true);
      modeBarDragOffset.current = { x: e.clientX - currentX, y: e.clientY - currentY };
    },
    [modeBarPos]
  );

  useEffect(() => {
    if (!isDraggingModeBar) return;
    const handleMove = (e: MouseEvent) => {
      setModeBarPos({
        x: e.clientX - modeBarDragOffset.current.x,
        y: e.clientY - modeBarDragOffset.current.y,
      });
    };
    const handleUp = () => setIsDraggingModeBar(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [isDraggingModeBar]);

  const notesPanelsHover = useSelector((s: RootState) => s.ui.notesPanelsHover);
  const focusMode = useSelector((s: RootState) => s.ui.notesFocusMode);

  /**
   * Le mode sans distraction ne survit pas à la sortie des notes.
   *
   * Il vit dans `uiSlice`, global à la fenêtre, mais SEULE cette vue le lit et
   * elle n'est montée que sur /notes. Sans ce nettoyage, le déclencher puis
   * naviguer vers les fichiers laissait un mode allumé que plus rien
   * n'affichait ni ne permettait d'éteindre — et qui se réappliquait en
   * silence au retour.
   */
  useEffect(() => {
    return () => {
      dispatch(setNotesFocusMode(false));
    };
  }, [dispatch]);

  /**
   * ÉPINGLAGE, et non plus « ouverture ».
   *
   * En mode survol les deux panneaux se révèlent au bord ; ces booléens disent
   * lesquels restent là en permanence. Ils sont PERSISTÉS par profil : en
   * `useState(true)` non persisté, activer le réglage ne faisait rien du tout
   * (les deux panneaux naissaient épinglés) et la moindre navigation hors des
   * notes les ré-épinglait.
   */
  const [rightPanelOpen, setRightPanelOpen] = useState(!notesPanelsHover);
  const [notesListOpen, setNotesListOpen] = useState(!notesPanelsHover);
  const listSlotRef = useRef<HTMLDivElement>(null);
  const rightSlotRef = useRef<HTMLDivElement>(null);
  /** Le pointeur, ou le focus clavier, réclame le panneau. */
  const [listPeek, setListPeek] = useState(false);
  const [rightPeek, setRightPeek] = useState(false);

  const togglePinnedList = useCallback(() => setNotesListOpen((prev) => !prev), []);
  const togglePinnedRight = useCallback(() => setRightPanelOpen((prev) => !prev), []);

  /**
   * Une surface plein écran est ouverte dans la liste, ou un sélecteur portalé
   * l'est depuis le panneau droit : dans les deux cas le panneau doit RESTER,
   * même si le pointeur est parti. Un menu portalé n'est pas un descendant DOM
   * du panneau — le seul verrou de focus ne le verrait jamais.
   */
  const [listOverlayOpen, setListOverlayOpen] = useState(false);
  /** Le focus clavier est DANS le panneau : il ne doit pas se dérober sous les doigts. */
  const [listFocusIn, setListFocusIn] = useState(false);
  const [rightFocusIn, setRightFocusIn] = useState(false);

  /**
   * Le réglage remet les deux panneaux à son état de départ.
   *
   * Il couvre la bascule faite pendant que cette vue est montée (notes et
   * paramètres côte à côte en vue scindée) ; hors de ce cas la vue est
   * remontée et `useState` a déjà lu la bonne valeur. Sans garde de « montée » :
   * cocher le réglage masque, le décocher rouvre, dans les deux sens et sans
   * état intermédiaire à tenir.
   */
  useEffect(() => {
    setNotesListOpen(!notesPanelsHover);
    setRightPanelOpen(!notesPanelsHover);
  }, [notesPanelsHover]);

  /**
   * LA RÉVÉLATION AU BORD.
   *
   * Une bande DOM en `:hover` serait plus simple mais entrerait en collision
   * avec le bouton « + » et la poignée de bloc de ProseMirror, posés en absolu
   * à x ≈ -4 px et x ≈ 20 px du texte. On borne donc au rectangle de la zone
   * d'éditeur — en X ET EN Y, sans quoi, en vue scindée, la bande gauche du
   * volet DROIT tomberait en plein milieu du texte du volet gauche.
   *
   * `dragover` autant que `mousemove` : pendant un glisser natif HTML5 le
   * navigateur n'émet plus de `mousemove`, et la liste est une cible de dépôt.
   */
  useEffect(() => {
    if (!notesPanelsHover || focusMode) {
      setListPeek(false);
      setRightPeek(false);
      return;
    }
    const onPoint = (e: MouseEvent | DragEvent) => {
      const area = editorAreaRef.current;
      if (!area) return;
      const r = area.getBoundingClientRect();
      const { clientX: x, clientY: y } = e;
      if (y < r.top || y > r.bottom || x < r.left - PEEK_EDGE_PX || x > r.right + PEEK_EDGE_PX) {
        setListPeek(false);
        setRightPeek(false);
        return;
      }
      setListPeek((prev) =>
        x <= r.left + PEEK_EDGE_PX ? true : x > r.left + PEEK_KEEP_LEFT_PX ? false : prev
      );
      setRightPeek((prev) =>
        x >= r.right - PEEK_EDGE_PX ? true : x < r.right - PEEK_KEEP_RIGHT_PX ? false : prev
      );
    };
    window.addEventListener('mousemove', onPoint, { passive: true });
    window.addEventListener('dragover', onPoint, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onPoint);
      window.removeEventListener('dragover', onPoint);
    };
  }, [notesPanelsHover, focusMode]);

  /**
   * Le verrou de focus, posé sur `document` et non sur le sous-arbre du
   * panneau : `InlineFolderPicker` portale son menu dans `document.body` et y
   * met le focus. Un `focusin` posé sur le slot ne le verrait jamais, et le
   * panneau se rétracterait à l'instant précis où il doit tenir.
   */
  useEffect(() => {
    if (!notesPanelsHover) return;
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as Node | null;
      setListFocusIn(!!t && !!listSlotRef.current?.contains(t));
      setRightFocusIn(!!t && !!rightSlotRef.current?.contains(t));
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [notesPanelsHover]);

  const [editorComments, setEditorComments] = useState<Record<string, NoteComment>>({});
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [templaterOpen, setTemplaterOpen] = useState(false);
  const [showStyleSettings, setShowStyleSettings] = useState(false);
  const globalViewMode = useSelector((s: RootState) => s.notes.viewMode);
  const globalEditingNote = useSelector(selectEditingNote);
  const selectedNoteId = useSelector((s: RootState) => s.notes.selectedNoteId);
  const allNotesById = useSelector((s: RootState) => s.notes.byId);
  const allNotes = useSelector(selectAllNotes);
  const isSplit = useSelector((s: RootState) => s.tabs.panels.length > 1);

  // In split mode, each panel manages its own editing note + view mode
  // locally — otherwise switching from List to Kanban in one pane would
  // flip the other to Kanban too (single global Redux value).
  const [localNoteId, setLocalNoteId] = useState<string | null>(initialNoteId ?? null);
  const [localViewMode, setLocalViewMode] = useState<NotesState['viewMode']>(globalViewMode);
  const useLocalState = isSplit || !!initialNoteId;
  const viewMode = useLocalState ? localViewMode : globalViewMode;

  // Local view-mode setter that mirrors the editing-note pattern: writes
  // to React state in split / fixed-panel mode, otherwise to Redux so the
  // user's preference still persists in single-panel sessions.
  const handleViewModeChange = useCallback(
    (mode: NotesState['viewMode']) => {
      if (useLocalState) {
        setLocalViewMode(mode);
      } else {
        dispatch(setNotesViewMode(mode));
      }
    },
    [useLocalState, dispatch]
  );

  // When entering split mode, seed local view mode from the global one
  // so the panel keeps showing the same view the user was on. Only run
  // on the transition into local-state mode — afterward the local state
  // is the source of truth and we don't want subsequent global changes
  // (or other panels' writes) to overwrite it. globalViewMode is read
  // off the closure intentionally; deps stay limited to useLocalState.
  useEffect(() => {
    if (useLocalState) {
      setLocalViewMode(globalViewMode);
    }
  }, [useLocalState]); // eslint-disable-line

  // Derive editing note: split/fixed panels use local state, single-panel uses global
  const editingNote = useLocalState
    ? localNoteId
      ? (allNotesById[localNoteId] ?? null)
      : null
    : globalEditingNote;

  const chrome = resolveChrome({
    focusMode,
    hoverPref: notesPanelsHover,
    listPinned: notesListOpen,
    rightPinned: rightPanelOpen,
    listPeek: listPeek || listFocusIn || listOverlayOpen,
    rightPeek: rightPeek || rightFocusIn,
    /**
     * ⚠ UNE NOTE DE COFFRE COMPTE COMME UNE NOTE OUVERTE.
     *
     * `noteOpen: false` fait retourner `true` à `panelVisible` sans même
     * regarder l'épinglage — « sans note ouverte, les panneaux restent, c'est
     * la seule façon d'en atteindre une ». La règle est juste ; c'est ce qu'on
     * lui disait qui était faux.
     *
     * Une note de coffre ne passe pas par `notesSlice` : `editingNote` reste
     * donc nul pendant qu'on en lit une. Les boutons de repli fonctionnaient —
     * l'état basculait, `aria-pressed` suivait — mais la visibilité était
     * décidée avant qu'on le consulte. Rien ne bougeait à l'écran, et rien
     * n'expliquait pourquoi.
     */
    noteOpen: !!editingNote || !!vaultNote,
    // L'en-tête et la barre d'outils sont l'affaire de NoteEditor.
    headerManual: null,
    scrollStage: 'full',
    toolbarPref: false,
    toolbarFocusOverride: null,
  });

  /**
   * MONTÉ ≠ VISIBLE.
   *
   * Dès que l'un des deux modes peut faire réapparaître le panneau, on le garde
   * monté et on ne joue que sur sa visibilité : le démonter détruirait la
   * requête de recherche, le mode sélection multiple et les états pliés de cinq
   * panneaux, tous en état local non persisté. Quand les deux modes sont
   * éteints — le cas par défaut — le montage conditionnel d'origine est
   * conservé tel quel, donc aucune régression.
   */
  const listMounted = chrome.listVisible || notesPanelsHover || focusMode;
  const rightMounted = chrome.rightVisible || notesPanelsHover || focusMode;
  const slotClass = (side: 'left' | 'right', visible: boolean) =>
    [
      'notes-view__slot',
      `notes-view__slot--${side}`,
      notesPanelsHover ? 'notes-view__slot--floating' : '',
      visible ? '' : 'notes-view__slot--hidden',
    ]
      .filter(Boolean)
      .join(' ');

  // Sync local state from global when entering split mode with an existing editing note
  useEffect(() => {
    if (useLocalState && !localNoteId && globalEditingNote) {
      setLocalNoteId(globalEditingNote.id);
    }
  }, [useLocalState, localNoteId, globalEditingNote]);

  // Auto-select note when opened via /notes/:noteId route (e.g. split editing)
  useEffect(() => {
    if (initialNoteId) {
      if (useLocalState) {
        setLocalNoteId(initialNoteId);
      } else {
        dispatch(setEditingNote(initialNoteId));
      }
    }
  }, [initialNoteId, dispatch, useLocalState]);

  /**
   * Quitter l'adresse d'une note de coffre, si on y est.
   *
   * Écrit UNE fois : quatre chemins mènent à « montre-moi cette note locale »
   * (la liste, le calendrier, les notes périodiques, les sous-vues), et quatre
   * copies de ce test auraient fini par en oublier un — ce qui redonnerait
   * exactement le même symptôme, sur un seul chemin, donc encore plus difficile
   * à nommer.
   */
  const leaveVaultRoute = useCallback(() => {
    if (vaultNote) navigate('/notes');
  }, [vaultNote, navigate]);

  // When selecting a note, set it as editing
  const handleSelectNote = useCallback(
    (noteId: string) => {
      /**
       * ⚠ SORTIR DE LA ROUTE DU COFFRE, D'ABORD.
       *
       * `vaultNote` vient de l'ADRESSE (`/notes/vault/<coffre>/<élément>`) et
       * il passe AVANT `editingNote` dans le rendu — c'est ce qui permet à la
       * sélection personnelle de survivre pendant qu'on lit une note de
       * coffre, et de la retrouver intacte en revenant.
       *
       * Mais choisir une note locale n'écrivait QUE dans le magasin. L'adresse,
       * elle, restait sur le coffre : le panneau de coffre gardait donc la main
       * quoi qu'on clique, et on ne pouvait plus ouvrir aucune autre note. Ce
       * qui est le plus trompeur, c'est que la sélection FONCTIONNAIT — la
       * liste surlignait bien la note demandée, seule la zone d'édition ne
       * suivait pas.
       *
       * La sélection reste donc la même ; on quitte simplement l'adresse qui la
       * masquait.
       */
      leaveVaultRoute();

      if (useLocalState) {
        setLocalNoteId(noteId);
      } else {
        dispatch(setEditingNote(noteId));
      }
    },
    [dispatch, useLocalState, leaveVaultRoute]
  );

  // Click-to-open from sub-views (Masonry, Sticky, Kanban, Database…). Those
  // views replace the note list + editor full-screen, so a bare
  // setEditingNote call does nothing visible — the editor isn't rendered in
  // those modes. Switching to `list` here brings up the editor with the
  // freshly-selected note focused, which matches user expectations from
  // similar apps (Notion, Obsidian).
  const handleOpenNote = useCallback(
    (noteId: string) => {
      handleSelectNote(noteId);
      handleViewModeChange('list');
    },
    [handleSelectNote, handleViewModeChange]
  );

  // Sélecteur rapide, mode « titres » : ouvrir la note NE SUFFIT PAS, on a
  // demandé un titre précis. Sans ce branchement, la commande retombait
  // silencieusement sur `onSelectNote` et laissait l'utilisateur en haut du
  // document — un contrôle qui a l'air de marcher et n'obéit qu'à moitié.
  // `pos` est le rang du titre (convention `extractHeadings`), la même que
  // celle attendue par `pendingScrollToHeading` dans NoteEditor.
  const handleSelectHeading = useCallback(
    (noteId: string, pos: number) => {
      handleOpenNote(noteId);
      dispatch(requestScrollToHeading({ noteId, index: pos }));
    },
    [handleOpenNote, dispatch]
  );

  // Handle content updates with link resolution
  const handleContentUpdate = useCallback(
    (content: string, plainText: string) => {
      if (!editingNote) return;
      dispatch(updateNoteContent({ id: editingNote.id, content, plainText }));
      // Debounced link resolution
      dispatch(resolveNoteLinks(editingNote.id));
    },
    [dispatch, editingNote]
  );

  const handleTitleChange = useCallback(
    (title: string) => {
      if (!editingNote) return;
      const oldTitle = editingNote.title;
      dispatch(updateNote({ id: editingNote.id, changes: { title } }));
      // Propagate to every note that linked to this one via `[[OldTitle]]`
      // or `![[OldTitle]]`. Transclusion nodes bind to a stable noteId so
      // their header self-updates, but raw wiki-link text in other notes
      // would otherwise become broken pointers.
      if (oldTitle && oldTitle !== title) {
        const updates = computeRenameUpdates(allNotes, oldTitle, title, editingNote.id);
        for (const u of updates) {
          dispatch(updateNoteContent(u));
        }
      }
    },
    [dispatch, editingNote, allNotes]
  );

  const handleCommentsChange = useCallback((comments: Record<string, NoteComment>) => {
    setEditorComments(comments);
  }, []);

  // Handle calendar date selection — open or create daily note
  const notesById = useSelector((state: RootState) => state.notes.byId);
  const handleCalendarDate = useCallback(
    (date: string) => {
      const existing = Object.values(notesById).find(
        (n) => n.isDaily && n.dailyDate === date && !n.deletedAt
      );
      // Même raison que dans `handleSelectNote` : sans ça, la note du jour
      // s'ouvre dans le magasin et reste invisible derrière le coffre.
      leaveVaultRoute();
      if (existing) {
        dispatch(setEditingNote(existing.id));
      } else {
        // Create a new daily note for the selected date
        const note = createDailyNoteForDate(date);
        dispatch(addNote(note));
        dispatch(setEditingNote(note.id));
      }
    },
    [dispatch, notesById, leaveVaultRoute]
  );

  // Handle periodic note creation
  const handleCreatePeriodicNote = useCallback(
    (title: string, _type: 'weekly' | 'monthly' | 'quarterly') => {
      leaveVaultRoute();
      const note = createNoteService({ title });
      dispatch(addNote(note));
      dispatch(setEditingNote(note.id));
    },
    [dispatch, leaveVaultRoute]
  );

  // Handle templater apply
  const handleApplyTemplate = useCallback((content: string, title: string) => {
    // This would create a new note with the template content
    setTemplaterOpen(false);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'G') {
        e.preventDefault();
        handleViewModeChange(viewMode === 'graph' ? 'list' : 'graph');
      }
      // Ctrl+B épingle / désépingle la liste des notes.
      //
      // La garde de saisie n'est pas un raffinement : sans elle, Ctrl+B tapé
      // dans le texte mettait du GRAS (raccourci TipTap) *et* repliait la
      // liste — deux effets pour un geste. On ne teste pas non plus la
      // présence de `.notes-view` dans TOUT le document : en vue scindée, les
      // deux instances répondaient au même appui.
      if ((e.ctrlKey || e.metaKey) && e.key === 'b' && !e.shiftKey) {
        if (isEditableTarget(e.target)) return;
        if (editorAreaRef.current) {
          e.preventDefault();
          togglePinnedList();
        }
      }
      // Ctrl+P or Ctrl+K for quick switcher
      if ((e.ctrlKey || e.metaKey) && e.key === 'p' && !e.shiftKey) {
        // Only intercept if we're in the notes view
        if (document.querySelector('.notes-view')) {
          e.preventDefault();
          setQuickSwitcherOpen(true);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dispatch, viewMode]);

  const body = (
    <div className={`notes-view ${focusMode ? 'notes-view--focus' : ''}`}>
      {/* View mode toggle (draggable) */}
      <div
        className="notes-view__mode-toggle"
        role="toolbar"
        aria-label={t('notes.viewModeLabel', 'Mode de vue des notes')}
        style={
          modeBarPos
            ? {
                left: modeBarPos.x,
                top: modeBarPos.y,
                transform: 'none',
                cursor: isDraggingModeBar ? 'grabbing' : 'grab',
              }
            : {
                cursor: 'grab',
              }
        }
        onMouseDown={handleModeBarDragStart}
      >
        {(
          [
            ['list', t('notes.listView', 'List View'), <ListViewIcon key="i" />],
            ['masonry', t('notes.masonryView', 'Masonry View'), <MasonryViewIcon key="i" />],
            ['kanban', t('notes.kanbanView', 'Kanban View'), <KanbanViewIcon key="i" />],
            ['sticky', t('notes.stickyView', 'Sticky Notes'), <StickyViewIcon key="i" />],
            ['database', t('notes.databaseView', 'Database View'), <DatabaseViewIcon key="i" />],
            ['tasks', t('notes.tasksView', 'Tasks'), <TasksViewIcon key="i" />],
            ['calendar', t('notes.calendarView', 'Calendar'), <CalendarViewIcon key="i" />],
            ['mindmap', t('notes.mindMapView', 'Mind Map'), <MindMapViewIcon key="i" />],
            ['graph', t('notes.graphView', 'Graph View (Ctrl+Shift+G)'), <GraphViewIcon key="i" />],
          ] as const
        ).map(([mode, label, icon]) => (
          <button
            key={mode}
            className={`notes-view__mode-btn ${viewMode === mode ? 'is-active' : ''}`}
            aria-pressed={viewMode === mode}
            aria-label={label}
            onClick={() => handleViewModeChange(mode)}
            title={label}
          >
            {icon}
          </button>
        ))}
        {/* Entrée du mode sans distraction. Un raccourci seul ne suffit pas :
            il est personnalisable, et rien ne l'annonce à l'écran. Le bouton
            ne paraît qu'en mode liste, seul endroit où l'éditeur est monté et
            où le mode a donc un sens. */}
        {viewMode === 'list' && (
          <button
            className="notes-view__mode-btn notes-view__mode-btn--focus"
            aria-label={t('notes.focusModeEnter', 'Mode sans distraction')}
            title={`${t('notes.focusModeEnter', 'Mode sans distraction')} (Ctrl+Maj+F)`}
            onClick={() => dispatch(setNotesFocusMode(true))}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                d="M4 9V5a1 1 0 011-1h4M20 9V5a1 1 0 00-1-1h-4M4 15v4a1 1 0 001 1h4M20 15v4a1 1 0 01-1 1h-4"
              />
            </svg>
          </button>
        )}
        {/* Active-note indicator: shown next to the mode bar whenever a
            note is open AND we're in a view that doesn't render the
            editor. Click → return to list mode + reopen the note.
            Confirms the note hasn't been forgotten when browsing graph,
            kanban, masonry, etc. */}
        {editingNote && viewMode !== 'list' && (
          <button
            className="notes-view__active-pill"
            onClick={() => handleViewModeChange('list')}
            title={t('notes.openActiveNote', 'Ouvrir cette note')}
            style={{
              marginLeft: 8,
              maxWidth: 180,
              padding: '4px 10px',
              fontSize: '0.75rem',
              fontWeight: 500,
              border: '1px solid var(--color-border)',
              borderRadius: 999,
              background: 'var(--color-surface)',
              color: 'var(--color-text-secondary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              cursor: 'pointer',
            }}
          >
            <span style={{ opacity: 0.6, marginRight: 6 }}>●</span>
            {editingNote.title || t('notes.untitled', 'Untitled')}
          </button>
        )}
      </div>

      {viewMode === 'graph' ? (
        <div className="notes-view__graph-container">
          <GraphErrorBoundary onReset={() => handleViewModeChange('list')}>
            <GraphView />
          </GraphErrorBoundary>
        </div>
      ) : viewMode === 'masonry' ? (
        <MasonryView onOpenNote={handleOpenNote} />
      ) : viewMode === 'kanban' ? (
        <KanbanView onOpenNote={handleOpenNote} />
      ) : viewMode === 'sticky' ? (
        <StickyNotesView onOpenNote={handleOpenNote} />
      ) : viewMode === 'database' ? (
        <DatabaseView onOpenNote={handleOpenNote} />
      ) : viewMode === 'tasks' ? (
        <TasksAggregator />
      ) : viewMode === 'mindmap' ? (
        <MindMapView note={editingNote || null} onOpenNote={handleOpenNote} />
      ) : viewMode === 'calendar' ? (
        <CalendarView onOpenNote={handleOpenNote} />
      ) : (
        <div className="notes-view__split">
          {/* Left: Notes list (collapsible) */}
          {listMounted && (
            <div
              ref={listSlotRef}
              className={slotClass('left', chrome.listVisible || listOverlayOpen)}
            >
              <NotesList onSelectNote={handleSelectNote} onOverlayOpenChange={setListOverlayOpen} />
            </div>
          )}

          {/* Center: Editor */}
          <div className="notes-view__editor-area" ref={editorAreaRef}>
            {/* Toggle button for notes list sidebar */}
            <button
              className="notes-view__list-toggle"
              onClick={togglePinnedList}
              aria-pressed={notesListOpen}
              title={
                notesListOpen
                  ? t('notes.hideNotesList', 'Masquer la liste')
                  : t('notes.showNotesList', 'Afficher la liste')
              }
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                {notesListOpen ? (
                  <>
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="9" y1="3" x2="9" y2="21" />
                    <polyline points="14,9 12,12 14,15" />
                  </>
                ) : (
                  <>
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="9" y1="3" x2="9" y2="21" />
                    <polyline points="12,9 14,12 12,15" />
                  </>
                )}
              </svg>
            </button>
            {/*
              L'ISSUE DU MODE. Le raccourci est personnalisable : s'y fier seul
              enfermerait quiconque l'a réassigné. Révélée au survol comme les
              deux bascules voisines, et atteignable au clavier par
              `:focus-visible`.
            */}
            {focusMode && (
              <button
                className="notes-view__focus-exit"
                onClick={() => dispatch(setNotesFocusMode(false))}
                title={t('notes.focusModeExit', 'Quitter le mode sans distraction')}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" d="M9 9L4 4m0 0v5m0-5h5M15 15l5 5m0 0v-5m0 5h-5" />
                </svg>
                <span>{t('notes.focusModeExit', 'Quitter le mode sans distraction')}</span>
              </button>
            )}
            {/* Toggle button for right panel */}
            <button
              className="notes-view__right-toggle"
              onClick={togglePinnedRight}
              aria-pressed={rightPanelOpen}
              title={
                rightPanelOpen
                  ? t('notes.hidePanel', 'Masquer le panneau')
                  : t('notes.showPanel', 'Afficher le panneau')
              }
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                {rightPanelOpen ? (
                  <>
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="15" y1="3" x2="15" y2="21" />
                    <polyline points="10,9 12,12 10,15" />
                  </>
                ) : (
                  <>
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="15" y1="3" x2="15" y2="21" />
                    <polyline points="12,9 10,12 12,15" />
                  </>
                )}
              </svg>
            </button>
            {vaultNote ? (
              /* LA NOTE D'UN COFFRE PARTAGÉ, dans le vrai éditeur de coffre.
                 Elle ne se mêle pas aux notes locales : elle occupe le panneau
                 d'édition, et la sélection personnelle reste où elle est —
                 revenir de la note de coffre la retrouve intacte. */
              <VaultNotePane
                vaultId={vaultNote.vaultId}
                itemId={vaultNote.itemId}
                onExit={() => navigate('/notes')}
                onOpenInVault={() =>
                  navigate(vaultNoteExplorerDestination(vaultNote.vaultId, vaultNote.itemId))
                }
              />
            ) : editingNote ? (
              <>
                {!focusMode && <NoteBreadcrumb currentNoteId={editingNote.id} />}
                <NoteEditor
                  note={editingNote}
                  onUpdate={handleContentUpdate}
                  onTitleChange={handleTitleChange}
                  onCommentsChange={handleCommentsChange}
                  commentsHandleRef={commentsHandleRef}
                  onOpenStyleSettings={() => setShowStyleSettings(true)}
                  focusMode={focusMode}
                />
                <LinkPreviewPopover editorEl={editorAreaRef.current} />
              </>
            ) : (
              <div className="notes-view__empty">
                <EmptyNoteIcon />
                <h3>{t('notes.selectOrCreate', 'Select or create a note')}</h3>
                <p>
                  {t(
                    'notes.emptyHint',
                    'Choose a note from the list, or create a new one to start writing.'
                  )}
                </p>
                <div className="notes-view__shortcuts">
                  <div className="notes-view__shortcut">
                    <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd>
                    <span>{t('notes.shortcutNew', 'New note')}</span>
                  </div>
                  <div className="notes-view__shortcut">
                    <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd>
                    <span>{t('notes.shortcutDaily', 'Daily note')}</span>
                  </div>
                  <div className="notes-view__shortcut">
                    <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd>
                    <span>{t('notes.shortcutGraph', 'Graph view')}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right: Calendar + note-specific panels */}
          {rightMounted && (
            <div
              ref={rightSlotRef}
              className={`${slotClass('right', chrome.rightVisible)} notes-view__right-panel`}
            >
              <div className="notes-view__right-panel-content">
                <CalendarWidget onSelectDate={handleCalendarDate} />
                <PeriodicNotes
                  onSelectNote={(id) => dispatch(setEditingNote(id))}
                  onCreateNote={handleCreatePeriodicNote}
                />
                {editingNote && (
                  <>
                    <OutlinePanel noteId={editingNote.id} />
                    {Object.keys(editorComments).length > 0 && (
                      <CommentsPanel
                        comments={editorComments}
                        onAddComment={() => {}}
                        onResolveComment={(id) => commentsHandleRef.current?.resolveComment(id)}
                        onDeleteComment={(id) => commentsHandleRef.current?.deleteComment(id)}
                      />
                    )}
                    <NoteFolderPicker
                      noteId={editingNote.id}
                      currentParentId={editingNote.parentId}
                    />
                    <BacklinksPanel noteId={editingNote.id} />
                    <SmartTagsSuggestion noteId={editingNote.id} />
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quick Switcher Modal */}
      <QuickSwitcherPlus
        isOpen={quickSwitcherOpen}
        onClose={() => setQuickSwitcherOpen(false)}
        onSelectNote={(noteId: string) => {
          dispatch(setEditingNote(noteId));
          setQuickSwitcherOpen(false);
        }}
        onSelectHeading={(noteId: string, pos: number) => {
          handleSelectHeading(noteId, pos);
          setQuickSwitcherOpen(false);
        }}
      />

      {/* Templater Modal */}
      <TemplaterModal
        isOpen={templaterOpen}
        onClose={() => setTemplaterOpen(false)}
        onApplyTemplate={handleApplyTemplate}
      />

      {/* Style Settings Modal */}
      {showStyleSettings && (
        <div
          className="notes-view__modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowStyleSettings(false);
          }}
        >
          <div className="notes-view__modal">
            <div className="notes-view__modal-header">
              <h3 className="notes-view__modal-title">
                {t('notes.styleSettings.title', 'Style Settings')}
              </h3>
              <button
                className="notes-view__modal-close"
                onClick={() => setShowStyleSettings(false)}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="notes-view__modal-body">
              <StyleSettingsPanel
                onSettingsChange={() => {
                  // Trigger NoteEditor to reload settings from localStorage
                  // Same-tab storage writes don't fire StorageEvent, so dispatch a custom event
                  window.dispatchEvent(new Event('filarr-style-settings-changed'));
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // Ce panneau sait ouvrir une note (état local en vue scindée, Redux sinon) :
  // tout ce qui, plus bas, propose « ouvrir dans la note » passe par là
  return <NoteOpenerProvider value={handleOpenNote}>{body}</NoteOpenerProvider>;
});

export default NotesView;
