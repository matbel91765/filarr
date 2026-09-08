/**
 * Accueil modulaire — LES ACTIONS PARTAGÉES.
 *
 * ── LE PROBLÈME QUE CE FICHIER RÉSOUT ───────────────────────────────────────
 *
 * Les widgets sont `React.memo`, sinon glisser un bloc re-rendrait les onze
 * autres. Mais ils déclenchent des choses qui vivent au niveau de la PAGE : les
 * neuf modales du menu contextuel d'un dossier, le panneau de détails, les avis
 * de déplacement. Descendre ces rappels par les props les ferait naître à chaque
 * rendu de l'accueil, et la mémoïsation ne tiendrait plus une seconde.
 *
 * D'où un contexte dont la valeur est STABLE POUR TOUJOURS : elle est fabriquée
 * une fois (`useMemo` sans dépendance mouvante) et lit ce qui change à travers
 * des refs. Les modales restent où elles doivent être — au niveau de la page,
 * montées une seule fois, avec leur état à elles — et les widgets ne voient
 * qu'une poignée de fonctions qui ne changent jamais d'identité.
 *
 * ── POURQUOI DEUX CONTEXTES ─────────────────────────────────────────────────
 *
 * Un consommateur de contexte re-rend à CHAQUE changement de la valeur, que
 * `React.memo` le veuille ou non. Or l'état du glisser-déposer (cible survolée,
 * ressort armé, déplacement en vol) change des dizaines de fois par seconde
 * pendant un glissement. Le mettre dans le même contexte que les actions
 * re-rendrait TOUS les widgets à chaque pixel parcouru.
 *
 * Il vit donc à part, dans `HomeGridStateContext`, que SEUL le bloc « Tous les
 * dossiers » consomme — le seul qui porte des cibles de dépôt. Les dix autres
 * ne le lisent pas et ne bougent pas.
 */

import React, { createContext, useContext } from 'react';

import type { GridSizeId } from '../grid/gridTypes';
import type { Folder, Item } from '../../../types';
import type { DragState, PendingMove } from '../../../hooks/useDragAndDrop';

// ==================== Les actions ====================

export interface HomeActions {
  // ── Navigation ──────────────────────────────────────────────────────────
  /** Ouvre une note dans la section Notes. */
  openNote: (noteId: string) => void;
  /** Ouvre un dossier (et l'inscrit dans les récents). */
  openFolder: (folderId: string) => void;
  /** Ouvre un coffre partagé — sur un élément précis si `itemId` est donné (raccourci). */
  openVault: (vaultId: string, itemId?: string) => void;
  /** Section Notes filtrée sur les notes sans dossier. */
  seeAllUnfiled: () => void;
  /** Section Notes, filtres remis à plat. */
  seeAllNotes: () => void;
  /** Le tableau de notes (`/board`). */
  openNotesBoard: () => void;
  /** Une note quotidienne, par date ISO (`YYYY-MM-DD`). */
  openDailyNote: (isoDate: string) => void;

  // ── Menus contextuels ───────────────────────────────────────────────────
  /** Clic droit sur un dossier : le menu PARTAGÉ et ses neuf modales. */
  folderContextMenu: (event: React.MouseEvent<HTMLElement>, folder: Folder) => void;
  /** Clic droit sur une carte de coffre : le menu partagé des cartes de coffre (`useVaultCardMenu`). */
  vaultContextMenu: (event: React.MouseEvent<HTMLElement>, vault: { id: string }) => void;
  /** Création de dossier à la racine. */
  createFolder: () => void;
  /**
   * Création d'un coffre partagé (lot A, C4). La boîte vit au niveau de la
   * page, derrière le gate de paire de clés monté À LA DEMANDE — un widget n'a
   * pas à savoir qu'un coffre exige la clé privée en mémoire.
   */
  createVault: () => void;
  /**
   * « J'ai un code d'invitation… » : la saisie d'un lien d'invitation, elle
   * aussi au niveau de la page (une seule boîte pour le bouton « Nouveau » et
   * le menu de fond).
   */
  enterInviteCode: () => void;
  /** Panneau de détails d'un élément. */
  showDetails: (item: Item) => void;

  // ── Glisser-déposer (les rappels, pas l'état) ───────────────────────────
  dragStart: (event: React.DragEvent, folder: Folder) => void;
  dragEnd: () => void;
  dragOver: (event: React.DragEvent, folderId: string) => void;
  dragEnter: (event: React.DragEvent, folderId: string) => void;
  dragLeave: (event: React.DragEvent) => void;
  drop: (event: React.DragEvent, folderId: string) => void;

  // ── La disposition elle-même ────────────────────────────────────────────
  /** Entre ou sort du mode personnalisation. */
  setEditing: (on: boolean) => void;
  /** Pose un format du catalogue sur un emplacement. */
  setSlotSize: (slotId: string, size: GridSizeId) => void;
  /** Retire un bloc de l'accueil. */
  removeSlot: (slotId: string) => void;
  /** Écrit un réglage de bloc (les valeurs sont validées par le schéma). */
  setSlotOption: (slotId: string, key: string, value: unknown) => void;
}

/**
 * Pas de valeur par défaut utilisable : un widget rendu hors de l'accueil est un
 * bug de câblage, pas un cas à absorber en silence avec des rappels vides.
 */
const HomeActionsContext = createContext<HomeActions | null>(null);

export const HomeActionsProvider = HomeActionsContext.Provider;

export function useHomeActions(): HomeActions {
  const value = useContext(HomeActionsContext);
  if (!value) {
    throw new Error('useHomeActions : ce widget doit être rendu dans <HomeActionsProvider>');
  }
  return value;
}

// ==================== L'état volatil de la grille de dossiers ====================

export interface HomeGridState {
  /** L'élément en cours de glissement, ou `null`. */
  draggedItem: DragState['draggedItem'];
  /** Le dossier survolé qui accepterait le dépôt. */
  dropTarget: string | null;
  /** Le dossier dont le ressort est armé (ouverture automatique). */
  springTarget: string | null;
  /** Le déplacement en vol, qui gèle sa carte. */
  pendingMove: PendingMove | null;
  /**
   * Compteur sans signification propre : il ne sert qu'à faire re-rendre les
   * cartes après un changement de protection. `isProtected` lit le stockage
   * local, qui n'est pas réactif — sans ce coup de pouce, le cadenas resterait
   * celui d'avant.
   */
  passwordVersion: number;
}

const HomeGridStateContext = createContext<HomeGridState | null>(null);

export const HomeGridStateProvider = HomeGridStateContext.Provider;

export function useHomeGridState(): HomeGridState {
  const value = useContext(HomeGridStateContext);
  if (!value) {
    throw new Error('useHomeGridState : ce widget doit être rendu dans <HomeGridStateProvider>');
  }
  return value;
}
