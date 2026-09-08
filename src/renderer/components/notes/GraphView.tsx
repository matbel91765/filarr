/**
 * GraphView Component — Filarr Notes
 *
 * Force-directed graph visualization with:
 * - Automatic cluster detection (simplified Louvain)
 * - Dynamic filter (search, type)
 * - Heat map mode (recency-based coloring)
 * - Interactive force layout (RAF + node dragging)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../store';
import {
  selectAllNotes,
  selectAllNotebooks,
  setEditingNote,
  setNotesViewMode,
  setNotesFilterNotebook,
  updateNoteContent,
  resolveNoteLinks,
  extractRawTextFromContent,
} from '../../../store/slices/notesSlice';
import { setCurrentFolder } from '../../../store/slices/foldersSlice';
import { showWarningNotification } from '../../../store/slices/uiSlice';
import type { GraphNode, GraphEdge } from '../../../types/notes';
import { detectClusters, recencyScore, heatColor } from '../../../services/notes/graphAlgorithms';
import { filterNotesByDate, sliderToDate } from '../../../services/notes/graphTimeTravel';
import { parseWikiLinks } from '../../../services/notes/noteLinkParser';
import { buildNoteTitleIndex, linkResolutionKey } from '../../../services/notes/noteService';
import {
  type GraphSettings,
  loadGraphSettings,
  saveGraphSettings,
  labelAlpha,
  parseGroupQuery,
} from '../../../services/notes/graphSettings';
import { isDarkTheme } from '../../utils/theme';
import GraphSettingsPanel from './GraphSettingsPanel';
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
} from 'd3-force';
import './GraphView.css';
import * as profileStorage from '../../../services/core/profileStorage';

/**
 * Positions figées des nœuds du graphe. Géométrie de vue PAR APPAREIL (elle
 * n'est pas synchronisée), mais désormais PAR PROFIL : deux profils du même
 * poste ne se renvoient plus la disposition — ni, avec elle, la liste des
 * identifiants de notes de l'autre.
 */
const GRAPH_POSITIONS_KEY = 'filarr_graph_positions';

/**
 * Trait PLEIN pour `setLineDash`. Constante partagée parce que l'API exige
 * un tableau : écrire `setLineDash([])` dans la boucle des arêtes en
 * allouait un par trait et par frame.
 */
const NO_DASH: number[] = [];

/**
 * Polices des lettres de type, mémoïsées par taille ENTIÈRE de police.
 * Sans ce cache, chaque nœud composait sa chaîne `600 12.6px Inter…` à
 * chaque frame. L'arrondi au pixel est imperceptible (et rend même le
 * texte plus net) et borne le cache : les rayons vont de 6 à 40, que le
 * multiplicateur de taille étire au plus jusqu'à 5×.
 */
const nodeFontCache = new Map<number, string>();
function nodeFont(sizePx: number): string {
  const key = Math.max(1, Math.round(sizePx));
  let font = nodeFontCache.get(key);
  if (font === undefined) {
    font = `600 ${key}px Inter, sans-serif`;
    nodeFontCache.set(key, font);
  }
  return font;
}

// ==================== Colors ====================

const NODE_COLORS: Record<string, { fill: string; glow: string; light: string }> = {
  note: { fill: '#4a9eed', glow: 'rgba(74, 158, 237, 0.4)', light: '#7ab8f5' },
  file: { fill: '#34d399', glow: 'rgba(52, 211, 153, 0.4)', light: '#6ee7b7' },
  folder: { fill: '#fbbf24', glow: 'rgba(251, 191, 36, 0.4)', light: '#fcd34d' },
  notebook: { fill: '#a855f7', glow: 'rgba(168, 85, 247, 0.4)', light: '#c084fc' },
  // Balises : teal, bien distinct des fichiers (vert) et des notes (bleu).
  tag: { fill: '#2dd4bf', glow: 'rgba(45, 212, 191, 0.4)', light: '#5eead4' },
  // Non résolus : gris neutre — le nœud est en plus estompé au rendu.
  unresolved: { fill: '#94a3b8', glow: 'rgba(148, 163, 184, 0.3)', light: '#cbd5e1' },
};

// Lettre de type dessinée au centre des gros nœuds (D = dossier, C = carnet).
const NODE_TYPE_LETTER: Record<string, string> = {
  note: 'N',
  file: 'F',
  folder: 'D',
  notebook: 'C',
  tag: '#',
  unresolved: '?',
};

// ==================== Force Simulation (RAF-based) ====================

interface SimNode extends GraphNode {
  fx?: number | null;
  fy?: number | null;
  clusterId?: number;
  updatedAt?: string;
  /** Libellé tronqué, précalculé à la construction — zéro slice() par frame. */
  displayLabel?: string;
}

interface SimEdge extends GraphEdge {
  /**
   * Vrai si l'arête inverse existe aussi (wiki-links croisés) : le rendu
   * dessine alors une seconde tête de flèche côté source. Précalculé à la
   * construction du graphe — le test se faisait auparavant sur un Set de
   * chaînes, donc une template string `${source}→${target}` allouée PAR
   * ARÊTE ET PAR FRAME dès que les flèches sont actives (le défaut).
   */
  reciprocal?: boolean;
}

/**
 * Tête de flèche triangulaire.
 *
 * Hissée au niveau module : définie dans la boucle des arêtes, elle
 * allouait une closure par arête et par frame (60 fps × nb d'arêtes).
 * Les captures (direction unitaire, taille, couleur) deviennent des
 * paramètres — `ux/uy` restent distincts de `awayX/awayY` car la
 * perpendiculaire de la base du triangle se prend TOUJOURS sur la
 * direction de l'arête, y compris pour la tête inverse.
 */
function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  atX: number,
  atY: number,
  awayX: number,
  awayY: number,
  ux: number,
  uy: number,
  size: number,
  color: string
): void {
  const nx = -uy;
  const ny = ux;
  ctx.beginPath();
  ctx.moveTo(atX, atY);
  ctx.lineTo(atX - awayX * size + nx * size * 0.5, atY - awayY * size + ny * size * 0.5);
  ctx.lineTo(atX - awayX * size - nx * size * 0.5, atY - awayY * size - ny * size * 0.5);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function initializePositions(nodes: SimNode[]): void {
  // Spread around origin — simulation runs in unbounded space (like Obsidian)
  const spread = Math.max(300, nodes.length * 12);
  nodes.forEach((n) => {
    if (!n.x || !n.y) {
      n.x = (Math.random() - 0.5) * spread;
      n.y = (Math.random() - 0.5) * spread;
    }
    n.vx = 0;
    n.vy = 0;
  });
}

/**
 * Compute the bounding box of all nodes and return a transform that fits
 * them into the viewport with padding.
 */
function computeFitTransform(
  nodes: SimNode[],
  viewWidth: number,
  viewHeight: number
): { x: number; y: number; scale: number } {
  if (nodes.length === 0) return { x: 0, y: 0, scale: 1 };
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }
  const padding = 80;
  const graphW = maxX - minX + padding * 2;
  const graphH = maxY - minY + padding * 2;
  const scale = Math.min(1.5, Math.min(viewWidth / graphW, viewHeight / graphH));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return {
    x: viewWidth / 2 - cx * scale,
    y: viewHeight / 2 - cy * scale,
    scale,
  };
}

// d3-force simulation is used instead of custom physics — same library as Obsidian

// ==================== Helpers ====================

function getNodeRadius(connections: number): number {
  // Logarithmic scaling for better visual range: 6px (0 connections) → 40px (100+ connections)
  if (connections <= 0) return 6;
  return Math.min(40, 6 + Math.sqrt(connections) * 5);
}

// ==================== Component ====================

export const GraphView: React.FC = React.memo(function GraphView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  // Survol : ref uniquement — le canvas est redessiné à la main sur
  // changement de nœud survolé, AUCUN re-render React par mousemove.
  const hoveredNodeRef = useRef<string | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });

  // ---- Réglages unifiés (contrat Obsidian + clés Filarr) ----
  // Un seul objet persisté dans localStorage `filarr_graph_settings` ;
  // les anciennes clés éparses (show_arrows, local_mode, local_depth,
  // show_notebooks) sont migrées une fois par loadGraphSettings().
  const [settings, setSettings] = useState<GraphSettings>(loadGraphSettings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  useEffect(() => {
    saveGraphSettings(settings);
  }, [settings]);
  const updateSettings = useCallback((patch: Partial<GraphSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);
  // Panneau de réglages flottant — remplace l'ancienne barre de toggles.
  const [settingsOpen, setSettingsOpen] = useState(false);

  const draggingNodeRef = useRef<string | null>(null);
  const hasDraggedRef = useRef(false);
  const transformRef = useRef(transform);
  transformRef.current = transform;

  // Link creation state
  const [linkSource, setLinkSource] = useState<string | null>(null);
  const [linkToast, setLinkToast] = useState<string | null>(null);

  // Time travel state
  const [showTimeTravel, setShowTimeTravel] = useState(false);
  const [timeTravelValue, setTimeTravelValue] = useState(1);

  // RAF simulation state (mutable refs for 60fps without React re-renders)
  const simNodesRef = useRef<SimNode[]>([]);
  const simEdgesRef = useRef<SimEdge[]>([]);
  const simNodeMapRef = useRef<Map<string, SimNode>>(new Map());
  // Structures dérivées du graphe, préparées HORS boucle de rendu pour que
  // renderCanvas ne fasse aucune allocation par frame :
  //   - adjacence pour le fondu de survol Obsidian (voisins directs)
  //   - degrés pour la force de lien (1/sqrt(max(deg)))
  //   - correspondances de la recherche (null = pas de filtre actif)
  //   - notes visibles au curseur du time travel (null = pas de time travel)
  //   - couleur figée par nœud (groupes > heatmap > clusters > type)
  // (la réciprocité des arêtes est portée par SimEdge.reciprocal, calculée
  // à la construction du graphe)
  const neighborsRef = useRef<Map<string, Set<string>>>(new Map());
  const degreeCountRef = useRef<Map<string, number>>(new Map());
  const searchMatchRef = useRef<Set<string> | null>(null);
  // Time travel : filtre de RENDU, pas de construction — le graphe (et donc
  // la simulation d3) reste identique d'un cran de curseur à l'autre, seul
  // le dessin masque les notes trop récentes. Filtrer dans graphData
  // relancerait la simulation à chaque cran et ferait sauter tout le layout.
  const timeTravelSetRef = useRef<Set<string> | null>(null);
  const nodeColorMapRef = useRef<Map<string, { fill: string; glow: string }>>(new Map());
  const selectedNoteIdRef = useRef<string | null>(null);
  const [simReady, setSimReady] = useState(false);

  const notes = useSelector(selectAllNotes);
  const filesById = useSelector((s: RootState) => s.files.byId);
  const foldersById = useSelector((s: RootState) => s.folders.byId);
  const selectedNoteId = useSelector((s: RootState) => s.notes.selectedNoteId);
  selectedNoteIdRef.current = selectedNoteId;
  const notesById = useSelector((s: RootState) => s.notes.byId);
  // Référence STABLE sur le tableau de tags — l'ancien selector fabriquait
  // une map neuve à chaque dispatch, donc re-render sur chaque action.
  const rawTags = useSelector(
    (s: RootState) => s.tags?.tags as Array<{ id: string; name: string }> | undefined
  );
  const tagsById = useMemo(() => {
    const map: Record<string, { id: string; name: string }> = {};
    for (const tag of rawTags || []) map[tag.id] = tag;
    return map;
  }, [rawTags]);
  const notebooks = useSelector(selectAllNotebooks);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setDimensions({ width, height });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const effectiveDimensions = useMemo(
    () => dimensions || { width: 800, height: 600 },
    [dimensions]
  );
  const effectiveDimensionsRef = useRef(effectiveDimensions);
  effectiveDimensionsRef.current = effectiveDimensions;

  // Cache du texte brut par note. extractRawTextFromContent fait un
  // JSON.parse du document TipTap ENTIER : sans cache il retournait tout le
  // coffre à CHAQUE recomputation du graphe (bascule d'un réglage, ajout
  // d'une note, changement de sélection…). Invalidé par updatedAt — le
  // contenu ne peut pas bouger sans que updatedAt bouge (updateNoteContent
  // les écrit ensemble).
  const rawTextCacheRef = useRef<Map<string, { updatedAt: string; rawText: string }>>(new Map());

  // Le graphe LOCAL est le seul consommateur de la note sélectionnée dans la
  // construction du graphe. En dépendre directement faisait re-parser le
  // coffre, reconstruire la simulation d3 et recadrer le viewport à chaque
  // changement de note, même quand le mode local est éteint (le défaut).
  const localFocusNoteId = settings.localMode ? selectedNoteId : null;

  // Build graph data + run cluster detection
  const graphData = useMemo(() => {
    const nodeMap = new Map<string, SimNode>();
    const edgeList: SimEdge[] = [];
    const connectionCount = new Map<string, number>();

    for (const note of notes) {
      nodeMap.set(note.id, {
        id: note.id,
        label: note.title || 'Untitled',
        type: 'note',
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        connections: 0,
        updatedAt: note.updatedAt,
      });
    }

    for (const note of notes) {
      for (const targetId of note.linkedNoteIds) {
        if (nodeMap.has(targetId)) {
          edgeList.push({ source: note.id, target: targetId, type: 'note-note' });
          connectionCount.set(note.id, (connectionCount.get(note.id) || 0) + 1);
          connectionCount.set(targetId, (connectionCount.get(targetId) || 0) + 1);
        }
      }
      // Pièces jointes (fichiers/dossiers) derrière le toggle showAttachments.
      // Défaut TRUE sur desktop : ces nœuds ont toujours existé ici, les
      // masquer par défaut casserait la continuité produit.
      if (settings.showAttachments) {
        for (const fileId of note.linkedFileIds) {
          const file = filesById[fileId];
          if (file && !nodeMap.has(fileId)) {
            nodeMap.set(fileId, {
              id: fileId,
              label: file.name,
              type: 'file',
              x: 0,
              y: 0,
              vx: 0,
              vy: 0,
              connections: 0,
            });
          }
          if (nodeMap.has(fileId)) {
            edgeList.push({ source: note.id, target: fileId, type: 'note-file' });
            connectionCount.set(note.id, (connectionCount.get(note.id) || 0) + 1);
            connectionCount.set(fileId, (connectionCount.get(fileId) || 0) + 1);
          }
        }
        for (const folderId of note.linkedFolderIds) {
          const folder = foldersById[folderId];
          if (folder && !nodeMap.has(folderId)) {
            nodeMap.set(folderId, {
              id: folderId,
              label: folder.name,
              type: 'folder',
              x: 0,
              y: 0,
              vx: 0,
              vy: 0,
              connections: 0,
            });
          }
          if (nodeMap.has(folderId)) {
            edgeList.push({ source: note.id, target: folderId, type: 'note-folder' });
            connectionCount.set(note.id, (connectionCount.get(note.id) || 0) + 1);
            connectionCount.set(folderId, (connectionCount.get(folderId) || 0) + 1);
          }
        }
      }
    }

    // Nœuds balises (parité Obsidian) : un nœud #tag relié à chaque note
    // qui la porte. Ids préfixés `tag:` pour ne jamais entrer en collision
    // avec les ids de notes/fichiers.
    if (settings.showTags) {
      for (const note of notes) {
        if (!nodeMap.has(note.id)) continue;
        for (const tagId of note.tagIds || []) {
          const tag = tagsById[tagId];
          if (!tag) continue;
          const tagNodeId = `tag:${tag.id}`;
          if (!nodeMap.has(tagNodeId)) {
            nodeMap.set(tagNodeId, {
              id: tagNodeId,
              label: `#${tag.name}`,
              type: 'tag',
              x: 0,
              y: 0,
              vx: 0,
              vy: 0,
              connections: 0,
            });
          }
          edgeList.push({ source: note.id, target: tagNodeId, type: 'note-tag' });
          connectionCount.set(note.id, (connectionCount.get(note.id) || 0) + 1);
          connectionCount.set(tagNodeId, (connectionCount.get(tagNodeId) || 0) + 1);
        }
      }
    }

    // Liens NON résolus (hideUnresolved = « Fichiers existants seulement »).
    // On re-parse le texte brut (crochets préservés) avec la MÊME extraction
    // que resolveNoteLinks, car linkedNoteIds ne garde que les cibles
    // résolues — l'info « cible sans note » n'existe nulle part ailleurs.
    //
    // INVARIANT, À INDEX DE LIENS FRAIS : tout [[lien]] produit SOIT une
    // arête résolue, SOIT un nœud fantôme, jamais rien. Il ne tient que si
    // le test « est-ce résolu ? » utilise exactement la clé de resolveLinks :
    // on partage donc sa fonction d'index (buildNoteTitleIndex) et sa clé
    // (linkResolutionKey) au lieu de normaliser à part. Une normalisation
    // locale plus large (espaces repliés, fragment #ancre retiré) créait
    // l'angle mort exact : [[Ma Note#Section]] ou [[Ma  Note]] n'étaient pas
    // résolus par le service ET n'étaient pas vus comme fantômes ici — le
    // lien s'évaporait.
    //
    // La RÉSERVE « à index frais » n'est pas rhétorique : les arêtes viennent
    // de linkedNoteIds PERSISTÉ, pas d'un resolveNoteLinks rejoué ici. Si cet
    // index est périmé — cas typique : la note cible a été créée APRÈS
    // l'écriture du lien, sans que la source soit rouverte — le graphe perd
    // l'arête sans afficher de fantôme (la cible existe désormais, donc elle
    // est « résolue »). C'est la FRAÎCHEUR de l'index qui est alors en cause,
    // pas la normalisation ; le remède est de rejouer resolveNoteLinks, pas
    // d'élargir la clé.
    //
    // Conséquence assumée : ces cibles apparaissent en fantômes, ce qui est
    // la vérité produit (l'éditeur ne sait pas non plus les ouvrir). Idem
    // pour un lien vers une note en corbeille : l'index est bâti sur les
    // notes VISIBLES, donc la cible devient un fantôme au lieu de disparaître.
    if (!settings.hideUnresolved) {
      const titleIndex = buildNoteTitleIndex(notes);
      const rawTextCache = rawTextCacheRef.current;
      for (const note of notes) {
        if (!nodeMap.has(note.id)) continue;
        // Fallback plainText : contenu non-JSON (créé via Shift+clic graphe)
        // garde ses [[crochets]] dans plainText.
        let rawText: string;
        const cached = rawTextCache.get(note.id);
        if (cached && cached.updatedAt === note.updatedAt) {
          rawText = cached.rawText;
        } else {
          rawText = extractRawTextFromContent(note.content) || note.plainText || '';
          rawTextCache.set(note.id, { updatedAt: note.updatedAt, rawText });
        }
        if (!rawText.includes('[[')) continue;
        const seen = new Set<string>();
        for (const link of parseWikiLinks(rawText)) {
          if (link.type !== 'note' || link.isEmbed) continue;
          // link.target est déjà trimé par parseWikiLinks — [[ Titre ]] se
          // résout donc bien, exactement comme côté service.
          const key = linkResolutionKey(link.target);
          if (!key || titleIndex.has(key) || seen.has(key)) continue;
          seen.add(key);
          const unresolvedId = `unresolved:${key}`;
          if (!nodeMap.has(unresolvedId)) {
            nodeMap.set(unresolvedId, {
              id: unresolvedId,
              // Libellé = la cible telle qu'écrite (première occurrence) :
              // l'utilisateur doit reconnaître ce qu'il a tapé pour corriger.
              label: link.target,
              type: 'unresolved',
              x: 0,
              y: 0,
              vx: 0,
              vy: 0,
              connections: 0,
            });
          }
          edgeList.push({ source: note.id, target: unresolvedId, type: 'note-unresolved' });
          connectionCount.set(note.id, (connectionCount.get(note.id) || 0) + 1);
          connectionCount.set(unresolvedId, (connectionCount.get(unresolvedId) || 0) + 1);
        }
      }
      // Purge paresseuse : les notes supprimées laisseraient sinon leur
      // entrée à vie. Seuil large pour ne pas invalider le cache à chaque
      // passage sur un coffre qui bouge peu.
      if (rawTextCache.size > notes.length * 2 + 32) {
        const alive = new Set(notes.map((n) => n.id));
        for (const id of rawTextCache.keys()) {
          if (!alive.has(id)) rawTextCache.delete(id);
        }
      }
    }

    // Optional notebook overlay: adds hub nodes for each notebook with
    // a child note present in the current graph. Kept behind a toggle
    // (`showNotebooks`, persisted) because auto-linking every note to
    // its notebook creates dense artificial clusters that drown out the
    // wiki-link structure — users asked for it back as an opt-in layer.
    if (settings.showNotebooks) {
      const notebookChildCount = new Map<string, number>();
      for (const note of notes) {
        if (!note.notebookId) continue;
        if (!nodeMap.has(note.id)) continue;
        notebookChildCount.set(note.notebookId, (notebookChildCount.get(note.notebookId) || 0) + 1);
      }
      for (const notebook of notebooks) {
        const childCount = notebookChildCount.get(notebook.id) || 0;
        if (childCount === 0) continue;
        const notebookNodeId = `notebook:${notebook.id}`;
        nodeMap.set(notebookNodeId, {
          id: notebookNodeId,
          label: notebook.name,
          type: 'notebook',
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          connections: 0,
        });
      }
      for (const note of notes) {
        if (!note.notebookId) continue;
        if (!nodeMap.has(note.id)) continue;
        const notebookNodeId = `notebook:${note.notebookId}`;
        if (!nodeMap.has(notebookNodeId)) continue;
        edgeList.push({
          source: notebookNodeId,
          target: note.id,
          type: 'notebook-note',
        });
        connectionCount.set(notebookNodeId, (connectionCount.get(notebookNodeId) || 0) + 1);
        connectionCount.set(note.id, (connectionCount.get(note.id) || 0) + 1);
      }
    }

    for (const [id, count] of connectionCount) {
      const node = nodeMap.get(id);
      if (node) node.connections = count;
    }

    // Cap node count for performance — keep most-connected nodes
    const MAX_GRAPH_NODES = 2000;
    let finalNodes = Array.from(nodeMap.values());
    let finalEdges = edgeList;

    if (finalNodes.length > MAX_GRAPH_NODES) {
      // Sort by connections (most connected first), keep top N
      finalNodes.sort((a, b) => b.connections - a.connections);
      finalNodes = finalNodes.slice(0, MAX_GRAPH_NODES);
      const keptIds = new Set(finalNodes.map((n) => n.id));
      finalEdges = edgeList.filter((e) => keptIds.has(e.source) && keptIds.has(e.target));
    }

    // Local graph: restrict to the open note's N-hop neighborhood. The global
    // graph is unreadable noise on a real vault; the local view answers "what
    // connects to what I'm reading now" and stays legible at scale.
    if (settings.localMode && localFocusNoteId && nodeMap.has(localFocusNoteId)) {
      const adjacency = new Map<string, Set<string>>();
      for (const e of finalEdges) {
        (adjacency.get(e.source) ?? adjacency.set(e.source, new Set()).get(e.source)!).add(
          e.target
        );
        (adjacency.get(e.target) ?? adjacency.set(e.target, new Set()).get(e.target)!).add(
          e.source
        );
      }
      const keep = new Set<string>([localFocusNoteId]);
      let frontier = [localFocusNoteId];
      for (let d = 0; d < settings.localJumps; d++) {
        const next: string[] = [];
        for (const id of frontier) {
          for (const nb of adjacency.get(id) ?? []) {
            if (!keep.has(nb)) {
              keep.add(nb);
              next.push(nb);
            }
          }
        }
        frontier = next;
      }
      finalNodes = finalNodes.filter((n) => keep.has(n.id));
      finalEdges = finalEdges.filter((e) => keep.has(e.source) && keep.has(e.target));
    }

    // Orphelins : appliqué APRÈS tous les autres filtres — le degré se
    // mesure sur les arêtes restantes, pas sur le graphe complet (une note
    // dont tous les voisins sont filtrés devient orpheline ici).
    if (!settings.showOrphans) {
      const connected = new Set<string>();
      for (const e of finalEdges) {
        connected.add(e.source);
        connected.add(e.target);
      }
      finalNodes = finalNodes.filter((n) => connected.has(n.id));
    }

    // Libellé tronqué précalculé — renderCanvas ne fait aucun slice() par frame.
    let hasUnresolved = false;
    for (const node of finalNodes) {
      node.displayLabel = node.label.length > 30 ? node.label.slice(0, 30) + '...' : node.label;
      if (node.type === 'unresolved') hasUnresolved = true;
    }

    // Réciprocité (wiki-links croisés → double tête de flèche) figée sur le
    // jeu d'arêtes FINAL, une fois par (re)construction. Les arêtes carnet
    // sont de la containment, pas de la direction : jamais réciproques.
    // Séparateur NUL : aucun id ne peut le contenir, donc pas de
    // collision de clé (contrairement à une flèche typographique).
    {
      const directed = new Set<string>();
      for (const e of finalEdges) {
        if (e.type === 'notebook-note') continue;
        directed.add(`${e.source}\u0000${e.target}`);
      }
      for (const e of finalEdges) {
        e.reciprocal = e.type !== 'notebook-note' && directed.has(`${e.target}\u0000${e.source}`);
      }
    }

    // Cluster detection
    const nodeIds = finalNodes.map((n) => n.id);
    const clusterResult = detectClusters(nodeIds, finalEdges);
    for (const [id, clusterId] of clusterResult.clusters) {
      const node = nodeMap.get(id);
      if (node) node.clusterId = clusterId;
    }

    return {
      nodes: finalNodes,
      edges: finalEdges,
      clusterResult,
      hasUnresolved,
    };
  }, [
    notes,
    filesById,
    foldersById,
    notebooks,
    tagsById,
    settings.showNotebooks,
    settings.showTags,
    settings.showAttachments,
    settings.hideUnresolved,
    settings.showOrphans,
    settings.localMode,
    settings.localJumps,
    localFocusNoteId,
  ]);

  // d3-force simulation ref
  const simulationRef = useRef<Simulation<SimNode, SimulationLinkDatum<SimNode>> | null>(null);
  // Fonctions de force de la simulation courante + dernières valeurs
  // appliquées — permet aux sliders de Forces de réinitialiser les caches
  // internes de d3 (strength/distance sont figés à l'initialize) sans
  // reconstruire les nœuds ni perdre les positions.
  const forceFnsRef = useRef<{
    chargeStrength: (d: SimNode) => number;
    linkStrength: (link: SimulationLinkDatum<SimNode>) => number;
  } | null>(null);
  const appliedForcesRef = useRef<{
    repel: number;
    distance: number;
    link: number;
    center: number;
  } | null>(null);

  // Initialize d3-force simulation
  useEffect(() => {
    const { nodes: rawNodes, edges } = graphData;
    if (rawNodes.length === 0) {
      simNodesRef.current = [];
      simEdgesRef.current = [];
      setSimReady(true);
      return;
    }

    // Stop any previous simulation
    if (simulationRef.current) simulationRef.current.stop();

    const simNodes: SimNode[] = rawNodes.map((n) => ({ ...n }));
    const savedPositions = loadPositions();
    let allRestored = true;

    // Restore saved positions
    for (const node of simNodes) {
      const saved = savedPositions[node.id];
      if (saved) {
        node.x = saved.x;
        node.y = saved.y;
      } else {
        allRestored = false;
      }
    }

    // Initialize unpositioned nodes
    const unpositioned = simNodes.filter((n) => !n.x || !n.y);
    if (unpositioned.length > 0) initializePositions(unpositioned);

    const nodeMap = new Map(simNodes.map((n) => [n.id, n]));
    simNodesRef.current = simNodes;
    simEdgesRef.current = edges;
    simNodeMapRef.current = nodeMap;

    // Build d3 links (source/target as node objects, not IDs)
    const d3Links = edges.map((e) => ({
      source: e.source,
      target: e.target,
    }));

    // Count degree for link strength (d3-force standard approach).
    // Stocké dans une ref : les fonctions de force relisent les degrés à
    // chaque réinitialisation (sliders de forces en direct).
    const degreeCount = new Map<string, number>();
    for (const e of edges) {
      degreeCount.set(e.source, (degreeCount.get(e.source) || 0) + 1);
      degreeCount.set(e.target, (degreeCount.get(e.target) || 0) + 1);
    }
    degreeCountRef.current = degreeCount;

    // ── Structures de rendu préparées une fois par (re)construction ──
    // Adjacence non orientée pour le fondu de survol (voisins directs).
    const adjacency = new Map<string, Set<string>>();
    for (const e of edges) {
      (adjacency.get(e.source) ?? adjacency.set(e.source, new Set()).get(e.source)!).add(e.target);
      (adjacency.get(e.target) ?? adjacency.set(e.target, new Set()).get(e.target)!).add(e.source);
    }
    neighborsRef.current = adjacency;

    // (Les paires réciproques ne sont plus un Set de chaînes : chaque arête
    // porte son booléen `reciprocal`, figé à la construction du graphe. Le
    // rendu lit un champ au lieu de fabriquer une clé par arête et par frame.)

    const n = simNodes.length;

    // ── Forces au contrat partagé desktop/mobile (mapping Obsidian) ──
    // Les fonctions relisent settingsRef/degreeCountRef à chaque
    // (ré)initialisation : l'effet « sliders en direct » n'a qu'à rappeler
    // .strength()/.distance() puis alpha(0.3).restart(), sans reconstruire
    // les nœuds ni perdre les positions.
    const chargeStrength = (d: SimNode) =>
      -(13 * settingsRef.current.repelStrength) - 2 * (d.connections || 0);
    // 1/√max(s,t) au lieu du 1/min(s,t) par défaut de d3 : les liens vers
    // les hubs deviennent BEAUCOUP plus faibles, la structure locale émerge.
    const linkStrength = (link: SimulationLinkDatum<SimNode>) => {
      const degrees = degreeCountRef.current;
      const s =
        degrees.get(typeof link.source === 'string' ? link.source : (link.source as SimNode).id) ||
        1;
      const t =
        degrees.get(typeof link.target === 'string' ? link.target : (link.target as SimNode).id) ||
        1;
      return settingsRef.current.linkStrength * (1 / Math.sqrt(Math.max(s, t)));
    };
    forceFnsRef.current = { chargeStrength, linkStrength };

    const initial = settingsRef.current;
    const sim = forceSimulation<SimNode>(simNodes)
      .force(
        'charge',
        forceManyBody<SimNode>()
          .strength(chargeStrength)
          .theta(n > 1000 ? 0.9 : 0.8)
      )
      .force(
        'link',
        forceLink<SimNode, SimulationLinkDatum<SimNode>>(d3Links)
          .id((d: SimNode) => d.id)
          .distance(initial.linkDistance * 0.25)
          .strength(linkStrength)
      )
      // forceX/forceY (0,0) au lieu de forceCenter : forceCenter TRANSLATE le
      // graphe (barycentre imposé), forceX/Y ATTIRE chaque nœud — c'est le
      // comportement Obsidian et c'est pilotable par le slider de centrage.
      .force('x', forceX<SimNode>(0).strength(initial.centerStrength * 0.1))
      .force('y', forceY<SimNode>(0).strength(initial.centerStrength * 0.1))
      .velocityDecay(0.35)
      .alphaDecay(allRestored ? 0.04 : 0.008)
      .alpha(allRestored ? 0.3 : 1);

    // Mémorise les valeurs appliquées pour que l'effet « live » ne réchauffe
    // pas une simulation fraîche sans changement réel.
    appliedForcesRef.current = {
      repel: initial.repelStrength,
      distance: initial.linkDistance,
      link: initial.linkStrength,
      center: initial.centerStrength,
    };

    simulationRef.current = sim;

    // Tick handler — render on each simulation step
    sim.on('tick', () => {
      renderCanvas();
    });

    sim.on('end', () => {
      savePositions();
    });

    // Fit viewport after a short settle
    setTimeout(() => {
      const dims = effectiveDimensionsRef.current;
      const fit = computeFitTransform(simNodesRef.current, dims.width, dims.height);
      setTransform(fit);
      setSimReady(true);
    }, 50);

    return () => {
      sim.stop();
    };
  }, [graphData]); // effectiveDimensions removed intentionally — uses ref to avoid simulation restarts on resize

  // ── Sliders de Forces EN DIRECT ──
  // d3 fige strength/distance dans des tableaux internes à l'initialize :
  // rappeler .strength(fn)/.distance(v) force la réinitialisation, puis
  // alpha(0.3).restart() réchauffe — les nœuds gardent leurs positions.
  useEffect(() => {
    const sim = simulationRef.current;
    const fns = forceFnsRef.current;
    if (!sim || !fns) return;
    const applied = appliedForcesRef.current;
    if (
      applied &&
      applied.repel === settings.repelStrength &&
      applied.distance === settings.linkDistance &&
      applied.link === settings.linkStrength &&
      applied.center === settings.centerStrength
    ) {
      // Rien n'a bougé (montage initial ou patch sans rapport) : ne pas
      // écraser l'alpha d'une simulation fraîche en train de se poser.
      return;
    }
    const charge = sim.force('charge') as ReturnType<typeof forceManyBody<SimNode>> | undefined;
    if (charge) charge.strength(fns.chargeStrength);
    const link = sim.force('link') as
      | ReturnType<typeof forceLink<SimNode, SimulationLinkDatum<SimNode>>>
      | undefined;
    if (link) {
      link.distance(settings.linkDistance * 0.25);
      link.strength(fns.linkStrength);
    }
    const fx = sim.force('x') as ReturnType<typeof forceX<SimNode>> | undefined;
    if (fx) fx.strength(settings.centerStrength * 0.1);
    const fy = sim.force('y') as ReturnType<typeof forceY<SimNode>> | undefined;
    if (fy) fy.strength(settings.centerStrength * 0.1);
    appliedForcesRef.current = {
      repel: settings.repelStrength,
      distance: settings.linkDistance,
      link: settings.linkStrength,
      center: settings.centerStrength,
    };
    sim.alpha(0.3).restart();
  }, [
    settings.repelStrength,
    settings.linkDistance,
    settings.linkStrength,
    settings.centerStrength,
  ]);

  // Canvas ref for high-performance rendering
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Find node under mouse position (for Canvas hit-testing)
  const findNodeAtPosition = useCallback((clientX: number, clientY: number): SimNode | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const t = transformRef.current;
    const graphX = (clientX - rect.left - t.x) / t.scale;
    const graphY = (clientY - rect.top - t.y) / t.scale;

    // Check from top (last rendered) to bottom for correct z-order
    const nodes = simNodesRef.current;
    const sizeMult = settingsRef.current.nodeSizeMultiplier;
    // Un nœud masqué par le time travel n'est pas cliquable : sans cette
    // garde, la note invisible resterait survolable et ouvrable.
    const timeSet = timeTravelSetRef.current;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (timeSet && node.type === 'note' && !timeSet.has(node.id)) continue;
      const r = getNodeRadius(node.connections) * sizeMult;
      const dx = node.x - graphX;
      const dy = node.y - graphY;
      if (dx * dx + dy * dy <= (r + 4) * (r + 4)) return node;
    }
    return null;
  }, []);

  // Canvas rendering function — replaces SVG DOM updates.
  // TOUT est lu via des refs (transform, réglages, survol, recherche,
  // couleurs et voisinages précalculés) : le callback est stable ([] deps,
  // donc jamais de closure périmée dans le tick d3) et ne fait AUCUNE
  // allocation proportionnelle au graphe par frame.
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Base HiDPI reposée À CHAQUE frame. Changer canvas.width/height (ce que
    // fait React au redimensionnement du conteneur) RÉINITIALISE le contexte
    // à l'échelle identité ; les frames émises par les ticks d3 n'ont aucun
    // autre endroit où la restaurer, et le rendu resterait flou/réduit
    // jusqu'au prochain pan/zoom (l'ancien re-render sur survol masquait le
    // problème, il ne le corrigeait pas). Coût : un setTransform par frame.
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const w = canvas.width;
    const h = canvas.height;
    const t = transformRef.current;
    const s = settingsRef.current;
    const nodes = simNodesRef.current;
    const edges = simEdgesRef.current;
    const nodeMap = simNodeMapRef.current;
    const nodeSize = s.nodeSizeMultiplier;
    const lineSize = s.lineSizeMultiplier;

    // Recherche : Set de correspondances précalculé (null = pas de filtre).
    // Survol Obsidian : nœud survolé + voisins DIRECTS + arêtes incidentes
    // à pleine intensité, tout le reste à 0.12, libellés des non-voisins
    // masqués. Les deux estompes se combinent par min().
    const searchSet = searchMatchRef.current;
    // Time travel : Set des notes déjà créées à la date choisie (null = OFF).
    // Contrairement à la recherche (qui estompe), il MASQUE — le graphe doit
    // ressembler à ce qu'il était à cette date. v1 assumée : seuls les nœuds
    // de type `note` sont datés, dossiers/fichiers/balises/carnets restent
    // visibles même si toutes leurs notes ont disparu.
    const timeSet = timeTravelSetRef.current;
    const currentHovered = hoveredNodeRef.current;
    const hoverNeighbors = currentHovered ? neighborsRef.current.get(currentHovered) : undefined;
    const currentSelected = selectedNoteIdRef.current;
    const colorMap = nodeColorMapRef.current;

    // Clear
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.scale, t.scale);

    // Frustum culling bounds (in graph space)
    const viewX0 = -t.x / t.scale;
    const viewY0 = -t.y / t.scale;
    const viewX1 = (w - t.x) / t.scale;
    const viewY1 = (h - t.y) / t.scale;
    const pad = 60; // padding for nodes near edge

    const isDark = isDarkTheme();
    const labelColor = isDark ? '#c8d6e5' : '#334155';
    const labelHighlight = isDark ? '#ffffff' : '#0f172a';

    // Edge color adapts to theme — sky blue at 20% is invisible on light backgrounds,
    // especially with a single edge where there's no mass of lines to register.
    const edgeBaseColor = isDark ? 'rgba(135, 206, 235, 0.32)' : 'rgba(71, 85, 105, 0.45)';
    const edgeHoverColor = isDark ? 'rgba(135, 206, 235, 0.85)' : 'rgba(30, 64, 124, 0.85)';
    // Notebook-note edges are containment, not wiki-links — render them
    // faded + dashed so they stay readable without competing with real links.
    const notebookEdgeColor = isDark ? 'rgba(168, 85, 247, 0.22)' : 'rgba(147, 51, 234, 0.28)';
    const notebookEdgeHover = isDark ? 'rgba(192, 132, 252, 0.7)' : 'rgba(126, 34, 206, 0.7)';

    // Tirets des arêtes de carnet : UN seul tableau par frame (il ne dépend
    // que de l'échelle), pas un par arête — `setLineDash` prend un tableau,
    // et l'appeler dans la boucle en allouait un par trait, à 60 images par
    // seconde. `NO_DASH` est la constante partagée du trait plein.
    const notebookDash = [4 / t.scale, 3 / t.scale];

    // ── Draw edges ──
    ctx.lineWidth = (1.2 * lineSize) / t.scale;
    for (const edge of edges) {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) continue;

      // Une arête qui touche une note masquée par le time travel disparaît
      // avec elle — sinon les liens partiraient dans le vide.
      if (
        timeSet &&
        ((source.type === 'note' && !timeSet.has(source.id)) ||
          (target.type === 'note' && !timeSet.has(target.id)))
      )
        continue;

      // Frustum culling: skip if both endpoints are off-screen
      if (
        (source.x < viewX0 - pad && target.x < viewX0 - pad) ||
        (source.x > viewX1 + pad && target.x > viewX1 + pad) ||
        (source.y < viewY0 - pad && target.y < viewY0 - pad) ||
        (source.y > viewY1 + pad && target.y > viewY1 + pad)
      )
        continue;

      // Estompes : recherche (0.06, une extrémité hors filtre suffit) et
      // survol (0.12 pour toute arête non incidente) — min() des deux.
      let edgeAlpha = 1;
      if (searchSet && (!searchSet.has(edge.source) || !searchSet.has(edge.target)))
        edgeAlpha = 0.06;
      if (currentHovered && edge.source !== currentHovered && edge.target !== currentHovered)
        edgeAlpha = Math.min(edgeAlpha, 0.12);
      ctx.globalAlpha = edgeAlpha;

      const isHighlighted = currentHovered === edge.source || currentHovered === edge.target;
      const isNotebookEdge = edge.type === 'notebook-note';
      let strokeColor: string;

      if (isNotebookEdge) {
        strokeColor = isHighlighted ? notebookEdgeHover : notebookEdgeColor;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = ((isHighlighted ? 1.6 : 1) * lineSize) / t.scale;
        ctx.setLineDash(notebookDash);
      } else {
        strokeColor = isHighlighted ? edgeHoverColor : edgeBaseColor;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = ((isHighlighted ? 2.2 : 1.4) * lineSize) / t.scale;
        ctx.setLineDash(NO_DASH);
      }

      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();

      // Direction arrow: only on directed (non-notebook) edges, and
      // only when the toggle is on. Tip lands just outside the target
      // node's radius so it doesn't overlap the node disc.
      if (s.showArrow && !isNotebookEdge) {
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const len = Math.hypot(dx, dy);
        if (len > 0.5) {
          const ux = dx / len;
          const uy = dy / len;
          // Arrow size scales gently with zoom — bigger on zoom out so
          // it stays readable, smaller on zoom in so it doesn't crowd
          // the node.
          const arrowSize = 8 / t.scale;
          const targetR = getNodeRadius(target.connections) * nodeSize;
          const sourceR = getNodeRadius(source.connections) * nodeSize;

          // Head at target end. drawArrowHead est au niveau module : plus
          // aucune closure allouée par arête et par frame.
          const tipX = target.x - ux * (targetR + 1 / t.scale);
          const tipY = target.y - uy * (targetR + 1 / t.scale);
          drawArrowHead(ctx, tipX, tipY, ux, uy, ux, uy, arrowSize, strokeColor);

          // Reciprocal: also draw a head at source end pointing back.
          // Booléen figé à la construction du graphe — plus de clé de Set
          // fabriquée par arête et par frame.
          if (edge.reciprocal) {
            const tipX2 = source.x + ux * (sourceR + 1 / t.scale);
            const tipY2 = source.y + uy * (sourceR + 1 / t.scale);
            drawArrowHead(ctx, tipX2, tipY2, -ux, -uy, ux, uy, arrowSize, strokeColor);
          }
        }
      }
    }
    ctx.setLineDash(NO_DASH);
    ctx.globalAlpha = 1;

    // Fonte des libellés : calculée UNE fois par frame (dépend du zoom seul).
    const fontSize = Math.max(10, Math.min(16, 13 / t.scale));
    const labelFont = `500 ${fontSize}px Inter, system-ui, sans-serif`;

    // ── Draw nodes ──
    for (const node of nodes) {
      // Time travel : note pas encore créée à la date choisie → invisible.
      if (timeSet && node.type === 'note' && !timeSet.has(node.id)) continue;

      // Frustum culling
      if (
        node.x < viewX0 - pad ||
        node.x > viewX1 + pad ||
        node.y < viewY0 - pad ||
        node.y > viewY1 + pad
      )
        continue;

      const radius = getNodeRadius(node.connections) * nodeSize;
      const isHov = node.id === currentHovered;
      const isSel = node.id === currentSelected;
      // Couleur figée hors boucle : groupes > heatmap > clusters > type.
      const colors = colorMap.get(node.id) || NODE_COLORS[node.type];
      const searchDimmed = searchSet ? !searchSet.has(node.id) : false;
      const hoverDimmed = currentHovered
        ? !isHov && !(hoverNeighbors && hoverNeighbors.has(node.id))
        : false;

      // Ambient glow
      if (isHov || isSel) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 8, 0, Math.PI * 2);
        ctx.fillStyle = colors.glow;
        ctx.globalAlpha = 0.35;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Node shape. Non résolus : estompés en permanence (fantômes) en plus
      // des estompes recherche/survol.
      let nodeAlpha = searchDimmed || hoverDimmed ? 0.12 : 1;
      if (node.type === 'unresolved') nodeAlpha *= 0.5;
      ctx.globalAlpha = nodeAlpha;
      ctx.beginPath();
      if (node.type === 'note' || node.type === 'tag' || node.type === 'unresolved') {
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      } else if (node.type === 'file') {
        const r = radius * 0.85;
        ctx.rect(node.x - r, node.y - r, r * 2, r * 2);
      } else if (node.type === 'notebook') {
        // Diamond for notebooks — larger than other nodes to read as a hub
        const r = radius * 1.15;
        ctx.moveTo(node.x, node.y - r);
        ctx.lineTo(node.x + r, node.y);
        ctx.lineTo(node.x, node.y + r);
        ctx.lineTo(node.x - r, node.y);
        ctx.closePath();
      } else {
        // Hexagon for folders
        for (let k = 0; k < 6; k++) {
          const angle = (k * 60 - 30) * (Math.PI / 180);
          const px = node.x + radius * Math.cos(angle);
          const py = node.y + radius * Math.sin(angle);
          k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
      }
      ctx.fillStyle = colors.fill;
      ctx.fill();

      // Selection ring
      if (isSel) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5 / t.scale;
        ctx.stroke();
      }

      // Type letter (only if node big enough on screen)
      const screenRadius = radius * t.scale;
      if (screenRadius >= 10) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = nodeFont(radius * 0.7);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(NODE_TYPE_LETTER[node.type] || '?', node.x, node.y + 1);
      }

      // Libellé : fondu au zoom via la formule partagée labelAlpha().
      // Nœud important (degré >= 10) évalué avec scale*1.5 pour apparaître
      // plus tôt ; survolé/sélectionné toujours à 1 ; masqué si le nœud est
      // estompé par la recherche ou hors voisinage du survol.
      const isImportant = node.connections >= 10;
      let lAlpha = labelAlpha(isImportant ? t.scale * 1.5 : t.scale, s.textFadeMultiplier);
      if (isHov || isSel) lAlpha = 1;
      else if (searchDimmed || hoverDimmed) lAlpha = 0;
      if (lAlpha > 0.01) {
        ctx.globalAlpha = lAlpha;
        ctx.fillStyle = isHov || isSel ? labelHighlight : labelColor;
        ctx.font = labelFont;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(node.displayLabel || node.label, node.x, node.y + radius + 8);
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }, []); // stable : tout passe par des refs (survol, réglages, sélection, recherche)

  // ---- Position persistence ----
  // One-shot warning per session so the toast doesn't spam on every drag.
  const savePositionsFailedRef = useRef(false);
  const savePositions = useCallback(() => {
    const positions: Record<string, { x: number; y: number }> = {};
    for (const node of simNodesRef.current) {
      positions[node.id] = { x: node.x, y: node.y };
    }
    try {
      profileStorage.setItem(GRAPH_POSITIONS_KEY, JSON.stringify(positions));
      // Reset the suppression flag once a save succeeds — if quota was
      // freed up between failures, the next failure should warn again.
      savePositionsFailedRef.current = false;
    } catch (err) {
      if (savePositionsFailedRef.current) return;
      savePositionsFailedRef.current = true;
      const isQuota =
        err instanceof Error &&
        (err.name === 'QuotaExceededError' ||
          err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
          /quota/i.test(err.message));
      console.warn('[GraphView] localStorage save failed:', err);
      dispatch(
        showWarningNotification(
          isQuota
            ? t(
                'notes.graphPersistQuota',
                "Le navigateur n'a plus assez d'espace pour sauvegarder les positions du graphe. Vos déplacements ne seront pas conservés au rechargement."
              )
            : t(
                'notes.graphPersistFailed',
                'Impossible de sauvegarder les positions du graphe. Vos déplacements ne seront pas conservés.'
              )
        )
      );
    }
  }, [dispatch, t]);

  const loadPositions = useCallback((): Record<string, { x: number; y: number }> => {
    try {
      const raw = profileStorage.getItemWithLegacyFallback(GRAPH_POSITIONS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, []);

  // Restart d3-force simulation (used during drag to propagate forces)
  const reheatSimulation = useCallback(() => {
    const sim = simulationRef.current;
    if (sim) {
      sim.alpha(0.3).restart();
    }
  }, []);

  // Node drag handlers — use refs to avoid stale closures and re-renders during drag
  const handleNodeDragStart = useCallback(
    (nodeId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      draggingNodeRef.current = nodeId;
      hasDraggedRef.current = false;
      const node = simNodeMapRef.current.get(nodeId);
      if (node) {
        node.fx = node.x;
        node.fy = node.y;
      }
      // Reheat simulation so other nodes react to the drag
      reheatSimulation();
    },
    [reheatSimulation]
  );

  const handleMouseMoveForDrag = useCallback(
    (e: React.MouseEvent) => {
      const dragId = draggingNodeRef.current;
      if (dragId) {
        hasDraggedRef.current = true;
        const node = simNodeMapRef.current.get(dragId);
        if (node) {
          // Convert screen coords to graph coords using ref for latest transform
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const t = transformRef.current;
          node.fx = (e.clientX - rect.left - t.x) / t.scale;
          node.fy = (e.clientY - rect.top - t.y) / t.scale;
          node.x = node.fx;
          node.y = node.fy;
          // Keep d3 simulation warm during drag
          const sim = simulationRef.current;
          if (sim && sim.alpha() < 0.1) sim.alpha(0.1).restart();
        }
      } else if (isPanning) {
        setTransform((t) => ({
          ...t,
          x: e.clientX - panStart.current.x,
          y: e.clientY - panStart.current.y,
        }));
      }
    },
    [isPanning]
  );

  const handleMouseUpForDrag = useCallback(() => {
    const dragId = draggingNodeRef.current;
    if (dragId) {
      const node = simNodeMapRef.current.get(dragId);
      if (node) {
        // Keep node PINNED where the user dropped it (like Obsidian)
        node.fx = node.x;
        node.fy = node.y;
      }
      draggingNodeRef.current = null;
      savePositions();
    }
    setIsPanning(false);
  }, [savePositions]);

  // Side panel: clicking a note node reveals details (neighbors, tags,
  // stats, preview) instead of immediately opening the editor — Obsidian-
  // style. File / folder nodes still navigate immediately because there's
  // no extra detail panel for those.
  const [detailNodeId, setDetailNodeId] = useState<string | null>(null);

  const handleNodeClick = useCallback(
    (nodeId: string, nodeType: string) => {
      // Suppress click if the user was dragging a node
      if (hasDraggedRef.current) return;

      // Nœuds fantômes (cible sans note) et balises : pas de navigation —
      // il n'y a nulle part où aller. Ils restent déplaçables/survolables.
      if (nodeType === 'unresolved' || nodeType === 'tag') return;

      if (nodeType === 'note') {
        setDetailNodeId(nodeId);
      } else if (nodeType === 'file') {
        // Navigate to file's parent folder
        const file = filesById[nodeId];
        if (file?.parentId) {
          dispatch(setCurrentFolder(file.parentId));
          navigate(`/folder/${file.parentId}`);
        }
      } else if (nodeType === 'folder') {
        dispatch(setCurrentFolder(nodeId));
        navigate(`/folder/${nodeId}`);
      } else if (nodeType === 'notebook') {
        // Node ids for notebooks are prefixed with `notebook:` to avoid
        // collisions with note/file/folder ids — strip the prefix.
        const notebookId = nodeId.startsWith('notebook:') ? nodeId.slice(9) : nodeId;
        dispatch(setNotesFilterNotebook(notebookId));
        dispatch(setNotesViewMode('list'));
      }
    },
    [dispatch, filesById, navigate]
  );

  // Pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0 && !draggingNodeRef.current) {
      setIsPanning(true);
      panStart.current = {
        x: e.clientX - transformRef.current.x,
        y: e.clientY - transformRef.current.y,
      };
    }
  }, []);

  // Wheel zoom — attached via native listener to bypass React passive mode
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.92 : 1.08;
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      setTransform((t) => {
        const newScale = Math.max(0.1, Math.min(6, t.scale * delta));
        const ratio = newScale / t.scale;
        return {
          x: mouseX - (mouseX - t.x) * ratio,
          y: mouseY - (mouseY - t.y) * ratio,
          scale: newScale,
        };
      });
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [simReady]); // re-attach when canvas is ready

  // ── Groupes de couleurs (parité Obsidian) ──
  // Le PREMIER groupe dont la requête matche colore le nœud. Requêtes :
  // sous-chaîne du titre (insensible casse), `tag:#x`/`tag:x`, `notebook:nom`
  // (spécifique desktop). Précalculé en Map — jamais évalué par frame.
  const groupColorMap = useMemo(() => {
    const map = new Map<string, string>();
    if (settings.colorGroups.length === 0) return map;
    const parsed = settings.colorGroups.map((g) => ({
      query: parseGroupQuery(g.query),
      color: g.color,
    }));
    const tagNameById = new Map<string, string>();
    for (const tag of rawTags || []) tagNameById.set(tag.id, tag.name.toLowerCase());
    const notebookNameById = new Map<string, string>();
    for (const nb of notebooks) notebookNameById.set(nb.id, nb.name.toLowerCase());

    for (const node of graphData.nodes) {
      const labelLower = node.label.toLowerCase();
      const note = node.type === 'note' ? notesById[node.id] : undefined;
      for (const { query, color } of parsed) {
        if (!query) continue; // requête vide : ne matche jamais
        let hit = false;
        if (query.kind === 'substring') {
          hit = labelLower.includes(query.value);
        } else if (query.kind === 'tag') {
          if (note) {
            hit = (note.tagIds || []).some((tid) => tagNameById.get(tid) === query.value);
          } else if (node.type === 'tag') {
            // Le nœud balise lui-même prend la couleur de son groupe.
            hit = labelLower === `#${query.value}`;
          }
        } else if (query.kind === 'notebook') {
          hit = !!note?.notebookId && notebookNameById.get(note.notebookId) === query.value;
        }
        if (hit) {
          map.set(node.id, color);
          break; // premier groupe gagnant
        }
      }
    }
    return map;
  }, [settings.colorGroups, graphData, notesById, rawTags, notebooks]);

  // ── Couleur finale par nœud, figée en Map pour le rendu ──
  // Priorité : groupes > heatmap > clusters > type (comportement Obsidian).
  // Un groupe est une intention EXPLICITE de l'utilisateur, il passe donc
  // devant les calques automatiques ; les nœuds qu'aucun groupe ne matche
  // gardent la coloration clusters/heat map. L'ordre inverse rendait les
  // groupes inatteignables : `showClusters` est vrai par défaut et
  // detectClusters colore 100% des nœuds, donc aucune couleur de groupe ne
  // s'affichait jamais sans éteindre les deux autres calques à la main.
  const nodeColorMap = useMemo(() => {
    const map = new Map<string, { fill: string; glow: string }>();
    const clusterColors = graphData.clusterResult.colors;
    for (const node of graphData.nodes) {
      const groupColor = groupColorMap.get(node.id);
      if (groupColor) {
        map.set(node.id, { fill: groupColor, glow: `${groupColor}66` });
        continue;
      }
      if (settings.showHeatMap && node.updatedAt) {
        map.set(node.id, heatColor(recencyScore(node.updatedAt)));
        continue;
      }
      if (
        settings.showClusters &&
        node.clusterId !== undefined &&
        clusterColors.has(node.clusterId)
      ) {
        const color = clusterColors.get(node.clusterId)!;
        map.set(node.id, { fill: color, glow: `${color}66` });
        continue;
      }
      // Sinon : pas d'entrée — renderCanvas retombe sur NODE_COLORS[type].
    }
    return map;
  }, [settings.showHeatMap, settings.showClusters, graphData, groupColorMap]);
  nodeColorMapRef.current = nodeColorMap;

  // ── Correspondances de la recherche, précalculées ──
  // renderCanvas ne fait plus aucun toLowerCase() par nœud par frame.
  useEffect(() => {
    const fq = settings.search.trim().toLowerCase();
    if (!fq) {
      searchMatchRef.current = null;
    } else {
      const matches = new Set<string>();
      for (const node of graphData.nodes) {
        if (node.label.toLowerCase().includes(fq)) matches.add(node.id);
      }
      searchMatchRef.current = matches;
    }
    renderCanvas();
  }, [settings.search, graphData, renderCanvas]);

  // Time travel filtering
  const timeTravelData = useMemo(() => {
    if (!showTimeTravel) return null;
    // First pass: get date range
    const rangeResult = filterNotesByDate(notesById, new Date().toISOString());
    if (!rangeResult.minDate || !rangeResult.maxDate) return null;
    const targetDate = sliderToDate(timeTravelValue, rangeResult.minDate, rangeResult.maxDate);
    const filtered = filterNotesByDate(notesById, targetDate);
    return {
      visibleNoteIds: filtered.visibleNoteIds,
      targetDate,
      displayDate: new Date(targetDate).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
    };
  }, [showTimeTravel, timeTravelValue, notesById]);

  // ── Publication du filtre time travel vers le rendu ──
  // Même modèle que la recherche : un Set posé dans une ref puis un redraw
  // manuel. Le curseur ne provoque aucun re-render du canvas par lui-même
  // (l'effet de rendu global ne dépend pas de `timeTravelValue`), donc sans
  // cet appel le graphe restait figé pendant qu'on déplaçait le curseur.
  useEffect(() => {
    timeTravelSetRef.current =
      showTimeTravel && timeTravelData ? timeTravelData.visibleNoteIds : null;
    renderCanvas();
  }, [showTimeTravel, timeTravelData, renderCanvas]);

  // Escape key cancels link creation mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && linkSource) {
        setLinkSource(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [linkSource]);

  // Auto-dismiss toast after 2.5s
  useEffect(() => {
    if (!linkToast) return;
    const timer = setTimeout(() => setLinkToast(null), 2500);
    return () => clearTimeout(timer);
  }, [linkToast]);

  // Create wiki-link between two notes
  const createWikiLink = useCallback(
    (sourceId: string, targetId: string) => {
      const sourceNote = notesById[sourceId];
      const targetNote = notesById[targetId];
      if (!sourceNote || !targetNote) return;

      const targetTitle = targetNote.title || 'Untitled';
      const wikiLink = `[[${targetTitle}]]`;

      // Check if this link already exists in plainText
      if (sourceNote.plainText.includes(wikiLink)) {
        setLinkToast(
          t('notes.graphLinkExists', 'Link already exists: {{link}}', { link: wikiLink })
        );
        return;
      }

      // Build new TipTap JSON content
      let newContent: string;
      let newPlainText: string;
      try {
        const doc = JSON.parse(sourceNote.content);
        // Append a new paragraph node with the wiki-link text
        const linkParagraph = {
          type: 'paragraph',
          content: [{ type: 'text', text: wikiLink }],
        };
        if (doc.content && Array.isArray(doc.content)) {
          doc.content.push(linkParagraph);
        } else {
          doc.content = [linkParagraph];
        }
        newContent = JSON.stringify(doc);
        newPlainText = sourceNote.plainText ? sourceNote.plainText + '\n' + wikiLink : wikiLink;
      } catch {
        // Content isn't valid JSON — treat as plain text
        newContent = sourceNote.content;
        newPlainText = sourceNote.plainText ? sourceNote.plainText + '\n' + wikiLink : wikiLink;
      }

      dispatch(updateNoteContent({ id: sourceId, content: newContent, plainText: newPlainText }));
      dispatch(resolveNoteLinks(sourceId));
      setLinkToast(t('notes.graphLinkCreated', 'Link created: {{link}}', { link: wikiLink }));
    },
    [dispatch, notesById, t]
  );

  // Handle node click — supports Shift+click for link creation
  const handleNodeClickWithLink = useCallback(
    (nodeId: string, nodeType: string, e: React.MouseEvent) => {
      // Only notes can participate in link creation
      if (e.shiftKey && nodeType === 'note') {
        if (!linkSource) {
          // Start link creation: select source
          setLinkSource(nodeId);
        } else if (linkSource !== nodeId) {
          // Complete link creation: connect source -> target
          createWikiLink(linkSource, nodeId);
          setLinkSource(null);
        }
        return;
      }

      // Default click behavior (non-shift)
      if (!linkSource) {
        handleNodeClick(nodeId, nodeType);
      }
    },
    [linkSource, createWikiLink, handleNodeClick]
  );

  const zoomPercent = Math.round(transform.scale * 100);

  // Re-render canvas on any display-affecting change (zoom/pan, sélection,
  // réglages d'affichage, dimensions, couleurs recalculées). Le survol, lui,
  // redessine directement depuis le handler souris via les refs — pas de
  // re-render. La base HiDPI est reposée par renderCanvas lui-même : c'est
  // le seul point de passage commun aux frames React ET aux ticks d3.
  useEffect(() => {
    renderCanvas();
  }, [transform, selectedNoteId, settings, effectiveDimensions, nodeColorMap, renderCanvas]);

  return (
    <div className="graph-view" ref={containerRef}>
      {/* Controls bar */}
      <div className="graph-view__controls">
        <button
          className="graph-view__control-btn"
          onClick={() => setTransform((t) => ({ ...t, scale: Math.min(4, t.scale * 1.25) }))}
          title="Zoom in"
        >
          +
        </button>
        <button
          className="graph-view__control-btn"
          onClick={() => setTransform((t) => ({ ...t, scale: Math.max(0.2, t.scale * 0.8) }))}
          title="Zoom out"
        >
          -
        </button>
        <button
          className="graph-view__control-btn"
          onClick={() =>
            setTransform(
              computeFitTransform(
                simNodesRef.current,
                effectiveDimensions.width,
                effectiveDimensions.height
              )
            )
          }
          title="Reset view"
        >
          R
        </button>
        <button
          className={`graph-view__control-btn ${settingsOpen ? 'is-active' : ''}`}
          onClick={() => setSettingsOpen((v) => !v)}
          aria-pressed={settingsOpen}
          title={t('notes.graphSettings', 'Graph settings')}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h.01a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51h.01a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v.01a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
      </div>

      {/* Panneau de réglages flottant — remplace l'ancienne barre de toggles */}
      {settingsOpen && (
        <GraphSettingsPanel
          settings={settings}
          onChange={updateSettings}
          showTimeTravel={showTimeTravel}
          onToggleTimeTravel={() => setShowTimeTravel((v) => !v)}
          hasSelectedNote={!!selectedNoteId}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* Time travel slider (fixe en haut, décalé si le panneau est ouvert) */}
      {showTimeTravel && timeTravelData && (
        <div className="graph-view__time-travel" style={{ left: settingsOpen ? 312 : 16, top: 16 }}>
          <span className="graph-view__time-travel-label">
            {t('notes.graphTimeTravelDate', 'Showing state at:')} {timeTravelData.displayDate}
          </span>
          <input
            className="graph-view__time-travel-slider"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={timeTravelValue}
            onChange={(e) => setTimeTravelValue(Number(e.target.value))}
          />
        </div>
      )}

      {/* Empty state */}
      {graphData.nodes.length === 0 ? (
        <div className="graph-view__empty">
          <svg
            className="graph-view__empty-icon"
            width="80"
            height="80"
            viewBox="0 0 80 80"
            fill="none"
          >
            <circle
              cx="25"
              cy="30"
              r="8"
              fill="rgba(74, 158, 237, 0.15)"
              stroke="#4a9eed"
              strokeWidth="1.5"
            />
            <circle
              cx="55"
              cy="25"
              r="6"
              fill="rgba(52, 211, 153, 0.15)"
              stroke="#34d399"
              strokeWidth="1.5"
            />
            <circle
              cx="40"
              cy="55"
              r="10"
              fill="rgba(74, 158, 237, 0.15)"
              stroke="#4a9eed"
              strokeWidth="1.5"
            />
            <circle
              cx="65"
              cy="55"
              r="5"
              fill="rgba(251, 191, 36, 0.15)"
              stroke="#fbbf24"
              strokeWidth="1.5"
            />
            <line
              x1="25"
              y1="30"
              x2="40"
              y2="55"
              stroke="rgba(70, 130, 180, 0.35)"
              strokeWidth="1.5"
            />
            <line
              x1="55"
              y1="25"
              x2="40"
              y2="55"
              stroke="rgba(70, 130, 180, 0.35)"
              strokeWidth="1.5"
            />
            <line
              x1="40"
              y1="55"
              x2="65"
              y2="55"
              stroke="rgba(70, 130, 180, 0.35)"
              strokeWidth="1.5"
              strokeDasharray="4,3"
            />
          </svg>
          <p className="graph-view__empty-text">
            {t(
              'notes.graphEmpty',
              'Your knowledge graph will appear here. Link notes together using [[wiki-links]] to build connections.'
            )}
          </p>
          <span className="graph-view__empty-hint">
            [[note name]] &middot; [[file:document.pdf]] &middot; [[folder:Projects]]
          </span>
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          width={effectiveDimensions.width * (window.devicePixelRatio || 1)}
          height={effectiveDimensions.height * (window.devicePixelRatio || 1)}
          className="graph-view__svg"
          style={{
            width: effectiveDimensions.width,
            height: effectiveDimensions.height,
            cursor: isPanning ? 'grabbing' : 'grab',
          }}
          onMouseDown={(e) => {
            const node = findNodeAtPosition(e.clientX, e.clientY);
            if (node) {
              handleNodeDragStart(node.id, e);
            } else {
              handleMouseDown(e);
            }
          }}
          onMouseMove={(e) => {
            handleMouseMoveForDrag(e);
            // Détection de survol : REF + redraw manuel + curseur impératif.
            // Zéro re-render React par mousemove (spec perf) — le fondu
            // Obsidian des non-voisins se joue entièrement dans renderCanvas.
            if (!draggingNodeRef.current && !isPanning) {
              const node = findNodeAtPosition(e.clientX, e.clientY);
              const newHovered = node?.id || null;
              if (newHovered !== hoveredNodeRef.current) {
                hoveredNodeRef.current = newHovered;
                (e.currentTarget as HTMLCanvasElement).style.cursor = newHovered
                  ? 'pointer'
                  : 'grab';
                renderCanvas();
              }
            }
          }}
          onMouseUp={(e) => {
            if (draggingNodeRef.current && !hasDraggedRef.current) {
              // Click (not drag) — handle node click
              const node = findNodeAtPosition(e.clientX, e.clientY);
              if (node) handleNodeClickWithLink(node.id, node.type, e);
            }
            handleMouseUpForDrag();
          }}
          onMouseLeave={() => {
            if (hoveredNodeRef.current) {
              hoveredNodeRef.current = null;
              renderCanvas();
            }
            handleMouseUpForDrag();
          }}
        />
      )}

      {/* Legend */}
      <div className="graph-view__legend">
        {settings.showClusters && graphData.clusterResult.count > 1 ? (
          // Cluster legend
          Array.from(graphData.clusterResult.colors.entries()).map(([id, color]) => (
            <div key={id} className="graph-view__legend-item">
              <span
                className="graph-view__legend-dot"
                style={{ background: color, boxShadow: `0 0 6px ${color}` }}
              />
              <span>
                {t('notes.graphCluster', 'Cluster')} {id + 1}
              </span>
            </div>
          ))
        ) : settings.showHeatMap ? (
          // Heat map legend
          <>
            <div className="graph-view__legend-item">
              <span
                className="graph-view__legend-dot"
                style={{ background: '#ef4444', boxShadow: '0 0 6px #ef4444' }}
              />
              <span>{t('notes.graphHot', 'Recent')}</span>
            </div>
            <div className="graph-view__legend-item">
              <span
                className="graph-view__legend-dot"
                style={{ background: '#fbbf24', boxShadow: '0 0 6px #fbbf24' }}
              />
              <span>{t('notes.graphWarm', 'This week')}</span>
            </div>
            <div className="graph-view__legend-item">
              <span
                className="graph-view__legend-dot"
                style={{ background: '#4a9eed', boxShadow: '0 0 6px #4a9eed' }}
              />
              <span>{t('notes.graphCold', 'Older')}</span>
            </div>
          </>
        ) : (
          // Default type legend
          <>
            <div className="graph-view__legend-item">
              <span
                className="graph-view__legend-dot"
                style={{
                  background: NODE_COLORS.note.fill,
                  boxShadow: `0 0 6px ${NODE_COLORS.note.glow}`,
                }}
              />
              <span>{t('notes.graphNote', 'Note')}</span>
            </div>
            {settings.showAttachments && (
              <>
                <div className="graph-view__legend-item">
                  <span
                    className="graph-view__legend-dot"
                    style={{
                      background: NODE_COLORS.file.fill,
                      boxShadow: `0 0 6px ${NODE_COLORS.file.glow}`,
                    }}
                  />
                  <span>{t('notes.graphFile', 'File')}</span>
                </div>
                <div className="graph-view__legend-item">
                  <span
                    className="graph-view__legend-dot"
                    style={{
                      background: NODE_COLORS.folder.fill,
                      boxShadow: `0 0 6px ${NODE_COLORS.folder.glow}`,
                    }}
                  />
                  <span>{t('notes.graphFolder', 'Folder')}</span>
                </div>
              </>
            )}
            {settings.showTags && (
              <div className="graph-view__legend-item">
                <span
                  className="graph-view__legend-dot"
                  style={{
                    background: NODE_COLORS.tag.fill,
                    boxShadow: `0 0 6px ${NODE_COLORS.tag.glow}`,
                  }}
                />
                <span>{t('notes.graphTag', 'Tag')}</span>
              </div>
            )}
            {graphData.hasUnresolved && (
              <div className="graph-view__legend-item">
                <span
                  className="graph-view__legend-dot"
                  style={{
                    background: NODE_COLORS.unresolved.fill,
                    boxShadow: `0 0 6px ${NODE_COLORS.unresolved.glow}`,
                  }}
                />
                <span>{t('notes.graphUnresolved', 'Unresolved')}</span>
              </div>
            )}
            {settings.showNotebooks && (
              <div className="graph-view__legend-item">
                <span
                  className="graph-view__legend-dot"
                  style={{
                    background: NODE_COLORS.notebook.fill,
                    boxShadow: `0 0 6px ${NODE_COLORS.notebook.glow}`,
                  }}
                />
                <span>{t('notes.graphNotebook', 'Notebook')}</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Stats */}
      <div className="graph-view__stats">
        {graphData.nodes.length} {t('notes.graphNodes', 'nodes')} &middot; {graphData.edges.length}{' '}
        {t('notes.graphEdges', 'connections')}
        {settings.showClusters && graphData.clusterResult.count > 1 && (
          <>
            {' '}
            &middot; {graphData.clusterResult.count} {t('notes.graphClusterCount', 'clusters')}
          </>
        )}
      </div>

      {/* Zoom level */}
      <div className="graph-view__zoom">{zoomPercent}%</div>

      {/* Link creation status bar */}
      {linkSource && (
        <div className="graph-view__link-status">
          {t('notes.graphLinkHint', 'Shift+click another note to create a link. Esc to cancel.')}
        </div>
      )}

      {/* Link creation toast */}
      {linkToast && <div className="graph-view__link-toast">{linkToast}</div>}

      {/* Side panel: details for the clicked note node */}
      {detailNodeId &&
        (() => {
          const note = notesById[detailNodeId];
          if (!note) {
            // Race: node selected, then deleted. Drop selection silently.
            return null;
          }
          const incoming: string[] = [];
          const outgoing: string[] = [];
          for (const e of graphData.edges) {
            if (e.type !== 'note-note') continue;
            if (e.target === detailNodeId) incoming.push(e.source);
            if (e.source === detailNodeId) outgoing.push(e.target);
          }
          const tagNames = (note.tagIds || [])
            .map((tid) => tagsById[tid]?.name)
            .filter((n): n is string => !!n);
          const previewText = (note.plainText || '').replace(/\s+/g, ' ').trim().slice(0, 240);
          const updatedAt = note.updatedAt ? new Date(note.updatedAt) : null;

          return (
            <div className="graph-view__panel" role="dialog" aria-label="Note details">
              <header className="graph-view__panel-header">
                <h3 className="graph-view__panel-title">
                  {note.title || t('notes.untitled', 'Untitled')}
                </h3>
                <button
                  type="button"
                  className="graph-view__panel-close"
                  onClick={() => setDetailNodeId(null)}
                  aria-label="Close"
                >
                  ×
                </button>
              </header>
              <div className="graph-view__panel-body">
                <div className="graph-view__panel-stats">
                  <span>
                    <strong>{incoming.length}</strong> {t('notes.graphPanelIncoming', 'incoming')}
                  </span>
                  <span>
                    <strong>{outgoing.length}</strong> {t('notes.graphPanelOutgoing', 'outgoing')}
                  </span>
                  <span>
                    <strong>{note.wordCount || 0}</strong> {t('notes.words', 'words')}
                  </span>
                </div>

                {tagNames.length > 0 && (
                  <section className="graph-view__panel-section">
                    <h4>{t('notes.graphPanelTags', 'Tags')}</h4>
                    <div className="graph-view__panel-tags">
                      {tagNames.map((name) => (
                        <span key={name} className="graph-view__panel-tag">
                          #{name}
                        </span>
                      ))}
                    </div>
                  </section>
                )}

                {updatedAt && (
                  <section className="graph-view__panel-section">
                    <h4>{t('notes.graphPanelUpdated', 'Last modified')}</h4>
                    <p className="graph-view__panel-meta">
                      {updatedAt.toLocaleDateString()}{' '}
                      {updatedAt.toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </section>
                )}

                {previewText && (
                  <section className="graph-view__panel-section">
                    <h4>{t('notes.graphPanelPreview', 'Preview')}</h4>
                    <p className="graph-view__panel-preview">{previewText}</p>
                  </section>
                )}

                {(incoming.length > 0 || outgoing.length > 0) && (
                  <section className="graph-view__panel-section">
                    <h4>{t('notes.graphPanelNeighbors', 'Neighbors')}</h4>
                    {outgoing.length > 0 && (
                      <>
                        <p className="graph-view__panel-subhead">
                          ↗ {t('notes.graphPanelOutgoing', 'outgoing')}
                        </p>
                        <ul className="graph-view__panel-list">
                          {outgoing.map((id) => (
                            <li key={`out-${id}`}>
                              <button
                                type="button"
                                onClick={() => setDetailNodeId(id)}
                                className="graph-view__panel-link"
                              >
                                {notesById[id]?.title || t('notes.untitled', 'Untitled')}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {incoming.length > 0 && (
                      <>
                        <p className="graph-view__panel-subhead">
                          ↙ {t('notes.graphPanelIncoming', 'incoming')}
                        </p>
                        <ul className="graph-view__panel-list">
                          {incoming.map((id) => (
                            <li key={`in-${id}`}>
                              <button
                                type="button"
                                onClick={() => setDetailNodeId(id)}
                                className="graph-view__panel-link"
                              >
                                {notesById[id]?.title || t('notes.untitled', 'Untitled')}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </section>
                )}
              </div>

              <div className="graph-view__panel-footer">
                <button
                  type="button"
                  className="graph-view__panel-primary"
                  onClick={() => {
                    dispatch(setEditingNote(detailNodeId));
                    dispatch(setNotesViewMode('list'));
                    setDetailNodeId(null);
                  }}
                >
                  {t('notes.graphPanelOpen', 'Open note')}
                </button>
              </div>
            </div>
          );
        })()}
    </div>
  );
});

export default GraphView;
