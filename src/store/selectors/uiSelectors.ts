/**
 * Sélecteurs pour l'interface utilisateur
 */

import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '../index';

// Sélecteurs de base
const selectUiState = (state: RootState) => state.ui;

// Sélecteurs memoized
export const selectTheme = createSelector(
  [selectUiState],
  ui => ui.theme
);

export const selectCustomTheme = createSelector(
  [selectUiState],
  ui => ui.customTheme
);

export const selectIsDarkTheme = createSelector(
  [selectTheme],
  theme => theme === 'dark'
);

export const selectSidebarOpen = createSelector(
  [selectUiState],
  ui => ui.sidebarOpen
);

export const selectViewMode = createSelector(
  [selectUiState],
  ui => ui.viewMode
);

export const selectSortBy = createSelector(
  [selectUiState],
  ui => ui.sortBy
);

export const selectModal = createSelector(
  [selectUiState],
  ui => ui.modal
);

export const selectNotifications = createSelector(
  [selectUiState],
  ui => ui.notifications
);

export const selectDragAndDrop = createSelector(
  [selectUiState],
  ui => ui.dragAndDrop
);

export const selectOperations = createSelector(
  [selectUiState],
  ui => ui.operations
);

export const selectIsModalOpen = createSelector(
  [selectModal],
  modal => modal.isOpen
);

export const selectModalType = createSelector(
  [selectModal],
  modal => modal.type
);

export const selectModalProps = createSelector(
  [selectModal],
  modal => modal.props
);

export const selectIsDragging = createSelector(
  [selectDragAndDrop],
  dragAndDrop => dragAndDrop.isDragging
);

export const selectDraggedItem = createSelector(
  [selectDragAndDrop],
  dragAndDrop => ({
    id: dragAndDrop.draggedItemId,
    type: dragAndDrop.draggedItemType
  })
);

export const selectDropTarget = createSelector(
  [selectDragAndDrop],
  dragAndDrop => ({
    id: dragAndDrop.dropTargetId,
    type: dragAndDrop.dropTargetType
  })
);

export const selectIsLoading = createSelector(
  [selectOperations],
  operations => operations.isLoading
);

export const selectOperationProgress = createSelector(
  [selectOperations],
  operations => operations.progress
);

export const selectOperationMessage = createSelector(
  [selectOperations],
  operations => operations.message
);
