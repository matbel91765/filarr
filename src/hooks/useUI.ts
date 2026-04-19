/**
 * Hook personnalisé pour la gestion de l'interface utilisateur avec Redux
 *
 * Ce hook encapsule la logique relative à l'interface utilisateur,
 * permettant aux composants d'interagir facilement avec le store Redux.
 */

import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  setTheme,
  setCustomTheme,
  toggleSidebar,
  setSidebarOpen,
  setViewMode,
  setItemsPerPage,
  setSortBy,
  openModal,
  closeModal,
  updateModalProps,
  addNotification,
  removeNotification,
  clearAllNotifications,
  setDragging,
  setDropTarget,
  resetDragAndDrop,
  startOperation,
  updateOperationProgress,
  endOperation,
  showSuccessNotification,
  showErrorNotification,
  showWarningNotification,
  showInfoNotification,
  showConfirmationDialog,
  setActiveContextMenuItem
} from '../store/slices/uiSlice';
import {
  selectTheme,
  selectCustomTheme,
  selectSidebarOpen,
  selectViewMode,
  selectSortBy,
  selectModal,
  selectNotifications,
  selectDragAndDrop,
  selectOperations,
  selectIsModalOpen,
  selectModalType,
  selectModalProps,
  selectIsDragging,
  selectDraggedItem,
  selectDropTarget,
  selectIsLoading,
  selectOperationProgress,
} from '../store/selectors/uiSelectors';
import type { RootState, AppDispatch } from '../store';
import type { ViewMode, SortOption, SortDirection, Item, UINotification } from '../types';

/**
 * Options for notification actions
 */
export interface NotificationOptions {
  duration?: number;
  id?: string;
  [key: string]: any;
}

/**
 * Confirmation dialog options
 */
export interface ConfirmationDialogOptions {
  title?: string;
  message: string;
  onConfirm: () => void;
  onCancel?: () => void;
  confirmText?: string;
  cancelText?: string;
}

/**
 * Theme variables for custom theme
 */
export interface ThemeVariables {
  [key: string]: string | number;
}

/**
 * Drag state
 */
export interface DragState {
  isDragging: boolean;
  itemId?: string;
  itemType?: string;
}

/**
 * Drop target state
 */
export interface DropTargetState {
  targetId?: string;
  targetType?: string;
}

/**
 * Operation state
 */
export interface OperationState {
  message?: string;
  operationType?: string;
}

/**
 * Return type for useUI hook
 */
export interface UseUIReturn {
  // États
  theme: string;
  customTheme: ThemeVariables | null;
  sidebarOpen: boolean;
  viewMode: ViewMode;
  sortBy: { field: SortOption; order: SortDirection };
  modal: any;
  notifications: UINotification[];
  dragAndDrop: any;
  operations: any;
  isModalOpen: boolean;
  modalType: string | null;
  modalProps: Record<string, any>;
  isDragging: boolean;
  draggedItem: { id: string | null; type: string | null };
  dropTargetInfo: any;
  isLoading: boolean;
  operationProgress: number;
  activeContextMenuItem: { action: string; item: any } | null;

  // Méthodes
  // Thème et disposition
  changeTheme: (newTheme: string) => void;
  applyCustomTheme: (themeVars: ThemeVariables) => void;
  toggleSidebar: () => void;
  setSidebar: (isOpen: boolean) => void;
  changeViewMode: (newMode: ViewMode) => void;
  changeItemsPerPage: (count: number) => void;
  changeSortBy: (field: SortOption, order: SortDirection) => void;

  // Modales
  showModal: (type: string, props?: Record<string, any>) => void;
  hideModal: () => void;
  updateModal: (props: Record<string, any>) => void;

  // Notifications
  addNotification: (notification: UINotification) => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
  showSuccess: (message: string, options?: NotificationOptions) => void;
  showError: (message: string, options?: NotificationOptions) => void;
  showWarning: (message: string, options?: NotificationOptions) => void;
  showInfo: (message: string, options?: NotificationOptions) => void;
  showConfirmation: (options: ConfirmationDialogOptions) => void;

  // Drag and drop
  setDragging: (isDragging: boolean, itemId?: string, itemType?: string) => void;
  setDropTarget: (targetId?: string, targetType?: string) => void;
  resetDragDrop: () => void;

  // Opérations
  startLoading: (message: string, operationType?: string) => void;
  updateProgress: (progress: number) => void;
  endLoading: () => void;

  // Context Menu
  setActiveContextMenuItem: (item: Item | null | { action: string; item: any }) => void;
}

/**
 * Hook personnalisé pour gérer l'interface utilisateur
 * @returns Méthodes et données pour gérer l'UI
 */
export default function useUI(): UseUIReturn {
  const dispatch = useDispatch<AppDispatch>();

  // Sélecteurs de données
  const theme = useSelector(selectTheme);
  const customTheme = useSelector(selectCustomTheme);
  const sidebarOpen = useSelector(selectSidebarOpen);
  const viewMode = useSelector(selectViewMode);
  const sortBy = useSelector(selectSortBy);
  const modal = useSelector(selectModal);
  const notifications = useSelector(selectNotifications);
  const dragAndDrop = useSelector(selectDragAndDrop);
  const operations = useSelector(selectOperations);

  // Sélecteurs dérivés
  const isModalOpen = useSelector(selectIsModalOpen);
  const modalType = useSelector(selectModalType);
  const modalProps = useSelector(selectModalProps);
  const isDragging = useSelector(selectIsDragging);
  const draggedItem = useSelector(selectDraggedItem);
  const dropTargetInfo = useSelector(selectDropTarget);
  const isLoading = useSelector(selectIsLoading);
  const operationProgress = useSelector(selectOperationProgress);
  const activeContextMenuItem = useSelector((state: RootState) => state.ui.activeContextMenuItem);

  // Méthodes pour le thème et la disposition
  const changeTheme = useCallback((newTheme: string) => {
    dispatch(setTheme(newTheme as 'light' | 'dark' | 'custom'));
  }, [dispatch]);

  const applyCustomTheme = useCallback((themeVars: ThemeVariables) => {
    // Ensure all values are strings
    const stringThemeVars: Record<string, string> = {};
    Object.entries(themeVars).forEach(([key, value]) => {
      stringThemeVars[key] = String(value);
    });
    dispatch(setCustomTheme(stringThemeVars));
  }, [dispatch]);

  const toggleSidebarVisibility = useCallback(() => {
    dispatch(toggleSidebar());
  }, [dispatch]);

  const setSidebarVisibility = useCallback((isOpen: boolean) => {
    dispatch(setSidebarOpen(isOpen));
  }, [dispatch]);

  const changeViewMode = useCallback((newMode: ViewMode) => {
    dispatch(setViewMode(newMode));
  }, [dispatch]);

  const changeItemsPerPage = useCallback((count: number) => {
    dispatch(setItemsPerPage(count));
  }, [dispatch]);

  const changeSortBy = useCallback((field: SortOption, order: SortDirection) => {
    dispatch(setSortBy({ field, order }));
  }, [dispatch]);

  // Méthodes pour les modales
  const showModal = useCallback((type: string, props: Record<string, any> = {}) => {
    dispatch(openModal({ type, props }));
  }, [dispatch]);

  const hideModal = useCallback(() => {
    dispatch(closeModal());
  }, [dispatch]);

  const updateModal = useCallback((props: Record<string, any>) => {
    dispatch(updateModalProps(props));
  }, [dispatch]);

  // Méthodes pour les notifications
  const addNewNotification = useCallback((notification: UINotification) => {
    dispatch(addNotification(notification));
  }, [dispatch]);

  const removeNotificationById = useCallback((id: string) => {
    dispatch(removeNotification(Number(id)));
  }, [dispatch]);

  const clearNotifications = useCallback(() => {
    dispatch(clearAllNotifications());
  }, [dispatch]);

  // Méthodes pour les notifications typées
  const showSuccess = useCallback((message: string, options: NotificationOptions = {}) => {
    dispatch(showSuccessNotification(message, options));
  }, [dispatch]);

  const showError = useCallback((message: string, options: NotificationOptions = {}) => {
    dispatch(showErrorNotification(message, options));
  }, [dispatch]);

  const showWarning = useCallback((message: string, options: NotificationOptions = {}) => {
    dispatch(showWarningNotification(message, options));
  }, [dispatch]);

  const showInfo = useCallback((message: string, options: NotificationOptions = {}) => {
    dispatch(showInfoNotification(message, options));
  }, [dispatch]);

  const showConfirmation = useCallback((options: ConfirmationDialogOptions) => {
    dispatch(showConfirmationDialog(options));
  }, [dispatch]);

  // Méthodes pour le drag and drop
  const setItemDragging = useCallback((isDragging: boolean, itemId?: string, itemType?: string) => {
    dispatch(setDragging({ isDragging, itemId, itemType }));
  }, [dispatch]);

  const setItemDropTarget = useCallback((targetId?: string, targetType?: string) => {
    dispatch(setDropTarget({ targetId: targetId ?? null, targetType: targetType ?? null }));
  }, [dispatch]);

  const resetDragDrop = useCallback(() => {
    dispatch(resetDragAndDrop());
  }, [dispatch]);

  // Méthodes pour les opérations
  const startLoadingOperation = useCallback((message: string, operationType?: string) => {
    dispatch(startOperation({ message, operationType }));
  }, [dispatch]);

  const updateProgress = useCallback((progress: number) => {
    dispatch(updateOperationProgress(progress));
  }, [dispatch]);

  const endLoadingOperation = useCallback(() => {
    dispatch(endOperation());
  }, [dispatch]);

  // Méthode pour le menu contextuel
  const dispatchSetActiveContextMenuItem = useCallback((item: Item | null | { action: string; item: any }) => {
    if (item === null) {
      dispatch(setActiveContextMenuItem(null));
    } else if ('action' in item && 'item' in item) {
      dispatch(setActiveContextMenuItem(item));
    } else {
      dispatch(setActiveContextMenuItem({ action: '', item }));
    }
  }, [dispatch]);

  // Retourner les données et méthodes
  return {
    // États
    theme,
    customTheme,
    sidebarOpen,
    viewMode,
    sortBy,
    modal,
    notifications,
    dragAndDrop,
    operations,
    isModalOpen,
    modalType,
    modalProps,
    isDragging,
    draggedItem,
    dropTargetInfo,
    isLoading,
    operationProgress,
    activeContextMenuItem,

    // Méthodes
    // Thème et disposition
    changeTheme,
    applyCustomTheme,
    toggleSidebar: toggleSidebarVisibility,
    setSidebar: setSidebarVisibility,
    changeViewMode,
    changeItemsPerPage,
    changeSortBy,

    // Modales
    showModal,
    hideModal,
    updateModal,

    // Notifications
    addNotification: addNewNotification,
    removeNotification: removeNotificationById,
    clearNotifications,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    showConfirmation,

    // Drag and drop
    setDragging: setItemDragging,
    setDropTarget: setItemDropTarget,
    resetDragDrop,

    // Opérations
    startLoading: startLoadingOperation,
    updateProgress,
    endLoading: endLoadingOperation,

    // Context Menu
    setActiveContextMenuItem: dispatchSetActiveContextMenuItem
  };
}
