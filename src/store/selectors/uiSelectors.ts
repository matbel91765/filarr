/**
 * Sélecteurs pour l'interface utilisateur
 */

import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '../index';

// Sélecteurs de base
const selectUiState = (state: RootState) => state.ui;

// Sélecteurs memoized
export const selectTheme = createSelector([selectUiState], (ui) => ui.theme);

export const selectCustomTheme = createSelector([selectUiState], (ui) => ui.customTheme);

export const selectIsDarkTheme = createSelector([selectTheme], (theme) => theme === 'dark');

export const selectSidebarOpen = createSelector([selectUiState], (ui) => ui.sidebarOpen);

export const selectBarsMode = createSelector([selectUiState], (ui) => ui.barsMode);

// Barre supérieure (recherche/sync/profil) : rendue partout sauf 'tabs-only'
// et 'none'. Son PLACEMENT change selon le mode — bandeau dans le flux,
// pilule flottante, rail vertical, ou repliée hors du flux ('autohide').
export const selectHeaderBarVisible = createSelector(
  [selectBarsMode],
  (mode) =>
    mode === 'all' ||
    mode === 'search-only' ||
    mode === 'autohide' ||
    mode === 'floating' ||
    mode === 'side'
);

export const selectHeaderBarAutohide = createSelector(
  [selectBarsMode],
  (mode) => mode === 'autohide'
);

// Disposition « flottante » : la barre reste dans le flux mais se dessine en
// pilule détachée et centrée, bornée en largeur pour ne jamais passer sous
// les contrôles natifs de la fenêtre.
export const selectHeaderBarFloating = createSelector(
  [selectBarsMode],
  (mode) => mode === 'floating'
);

// Disposition « rail » : la barre est fixée sur le bord gauche, toute la
// hauteur ; le reste de l'application est décalé de sa largeur.
export const selectHeaderBarSide = createSelector([selectBarsMode], (mode) => mode === 'side');

// Barre d'onglets : rendue PAR PANNEAU, masquée quand seule la barre
// supérieure est demandée ou quand tout le chrome est retiré.
export const selectTabBarVisible = createSelector(
  [selectBarsMode],
  (mode) => mode !== 'search-only' && mode !== 'none'
);

// Vrai quand la barre d'onglets occupe le haut de la fenêtre : la barre
// supérieure ne tient alors plus le flux ('tabs-only'), en est sortie
// ('autohide') ou vit sur le bord gauche ('side'). Sert à réserver les
// contrôles natifs et la poignée de déplacement de la fenêtre, qui vivent
// dans les 40 premiers pixels.
// 'floating' n'en est PAS : la pilule reste dans le flux et c'est elle qui
// tient la bande haute (elle est bornée en largeur pour laisser les
// contrôles natifs libres).
export const selectTabBarTopmost = createSelector(
  [selectBarsMode],
  (mode) => mode === 'tabs-only' || mode === 'autohide' || mode === 'side'
);

export const selectViewMode = createSelector([selectUiState], (ui) => ui.viewMode);

export const selectSortBy = createSelector([selectUiState], (ui) => ui.sortBy);

export const selectModal = createSelector([selectUiState], (ui) => ui.modal);

export const selectNotifications = createSelector([selectUiState], (ui) => ui.notifications);

export const selectDragAndDrop = createSelector([selectUiState], (ui) => ui.dragAndDrop);

export const selectOperations = createSelector([selectUiState], (ui) => ui.operations);

export const selectIsModalOpen = createSelector([selectModal], (modal) => modal.isOpen);

export const selectModalType = createSelector([selectModal], (modal) => modal.type);

export const selectModalProps = createSelector([selectModal], (modal) => modal.props);

export const selectIsDragging = createSelector(
  [selectDragAndDrop],
  (dragAndDrop) => dragAndDrop.isDragging
);

export const selectDraggedItem = createSelector([selectDragAndDrop], (dragAndDrop) => ({
  id: dragAndDrop.draggedItemId,
  type: dragAndDrop.draggedItemType,
}));

export const selectDropTarget = createSelector([selectDragAndDrop], (dragAndDrop) => ({
  id: dragAndDrop.dropTargetId,
  type: dragAndDrop.dropTargetType,
}));

export const selectIsLoading = createSelector(
  [selectOperations],
  (operations) => operations.isLoading
);

export const selectOperationProgress = createSelector(
  [selectOperations],
  (operations) => operations.progress
);

export const selectOperationMessage = createSelector(
  [selectOperations],
  (operations) => operations.message
);
