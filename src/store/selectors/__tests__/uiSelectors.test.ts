/**
 * Tests for uiSelectors
 *
 * Comprehensive tests for UI state selectors including theme, modals,
 * notifications, drag-and-drop, and operations.
 */

import {
  selectTheme,
  selectCustomTheme,
  selectIsDarkTheme,
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
  selectOperationMessage,
} from '../uiSelectors';
import { createMockRootState } from '../../../test-utils/mockState';
import { describe, it, expect, vi } from 'vitest';

describe('uiSelectors', () => {
  describe('selectTheme', () => {
    it('should return theme', () => {
      const state = createMockRootState();
      const result = selectTheme(state);

      expect(result).toBe('light');
    });

    it('should return dark theme', () => {
      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          theme: 'dark',
        },
      });

      const result = selectTheme(state);
      expect(result).toBe('dark');
    });
  });

  describe('selectCustomTheme', () => {
    it('should return null when no custom theme', () => {
      const state = createMockRootState();
      const result = selectCustomTheme(state);

      expect(result).toBeNull();
    });

    it('should return custom theme when set', () => {
      const customTheme = {
        primaryColor: '#ff0000',
        secondaryColor: '#00ff00',
        backgroundColor: '#ffffff',
      };

      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          customTheme,
        },
      });

      const result = selectCustomTheme(state);
      expect(result).toEqual(customTheme);
    });
  });

  describe('selectIsDarkTheme', () => {
    it('should return false for light theme', () => {
      const state = createMockRootState();
      const result = selectIsDarkTheme(state);

      expect(result).toBe(false);
    });

    it('should return true for dark theme', () => {
      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          theme: 'dark',
        },
      });

      const result = selectIsDarkTheme(state);
      expect(result).toBe(true);
    });

    it('should return false for custom theme', () => {
      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          theme: 'custom',
        },
      });

      const result = selectIsDarkTheme(state);
      expect(result).toBe(false);
    });
  });

  describe('selectSidebarOpen', () => {
    it('should return sidebar open state', () => {
      const state = createMockRootState();
      const result = selectSidebarOpen(state);

      expect(result).toBe(true);
    });

    it('should return false when sidebar is closed', () => {
      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          sidebarOpen: false,
        },
      });

      const result = selectSidebarOpen(state);
      expect(result).toBe(false);
    });
  });

  describe('selectViewMode', () => {
    it('should return view mode', () => {
      const state = createMockRootState();
      const result = selectViewMode(state);

      expect(result).toBe('grid');
    });

    it('should return list view mode', () => {
      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          viewMode: 'list',
        },
      });

      const result = selectViewMode(state);
      expect(result).toBe('list');
    });
  });

  describe('selectSortBy', () => {
    it('should return sort configuration', () => {
      const state = createMockRootState();
      const result = selectSortBy(state);

      expect(result).toEqual({
        field: 'name',
        order: 'asc',
      });
    });

    it('should return custom sort configuration', () => {
      const sortBy = {
        field: 'date',
        order: 'desc',
      };

      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          sortBy,
        },
      });

      const result = selectSortBy(state);
      expect(result).toEqual(sortBy);
    });
  });

  describe('selectModal', () => {
    it('should return modal state', () => {
      const state = createMockRootState();
      const result = selectModal(state);

      expect(result).toEqual({
        isOpen: false,
        type: null,
        props: {},
      });
    });

    it('should return open modal state', () => {
      const modal = {
        isOpen: true,
        type: 'confirm',
        props: {
          message: 'Are you sure?',
          onConfirm: vi.fn(),
        },
      };

      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          modal,
        },
      });

      const result = selectModal(state);
      expect(result).toEqual(modal);
    });
  });

  describe('selectNotifications', () => {
    it('should return empty notifications array', () => {
      const state = createMockRootState();
      const result = selectNotifications(state);

      expect(result).toEqual([]);
    });

    it('should return notifications', () => {
      const notifications = [
        {
          id: '1',
          type: 'success',
          message: 'Operation completed',
        },
        {
          id: '2',
          type: 'error',
          message: 'Operation failed',
        },
      ];

      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          notifications,
        },
      });

      const result = selectNotifications(state);
      expect(result).toEqual(notifications);
    });
  });

  describe('selectDragAndDrop', () => {
    it('should return drag and drop state', () => {
      const state = createMockRootState();
      const result = selectDragAndDrop(state);

      expect(result).toEqual({
        isDragging: false,
        draggedItemId: null,
        draggedItemType: null,
        dropTargetId: null,
        dropTargetType: null,
      });
    });

    it('should return active drag state', () => {
      const dragAndDrop = {
        isDragging: true,
        draggedItemId: 'file-1',
        draggedItemType: 'file',
        dropTargetId: 'folder-1',
        dropTargetType: 'folder',
      };

      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          dragAndDrop,
        },
      });

      const result = selectDragAndDrop(state);
      expect(result).toEqual(dragAndDrop);
    });
  });

  describe('selectOperations', () => {
    it('should return operations state', () => {
      const state = createMockRootState();
      const result = selectOperations(state);

      expect(result).toEqual({
        isLoading: false,
        progress: 0,
        message: '',
        operationType: null,
      });
    });

    it('should return active operations state', () => {
      const operations = {
        isLoading: true,
        progress: 50,
        message: 'Processing files...',
        operationType: 'upload',
      };

      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          operations,
        },
      });

      const result = selectOperations(state);
      expect(result).toEqual(operations);
    });
  });

  describe('selectIsModalOpen', () => {
    it('should return false when modal is closed', () => {
      const state = createMockRootState();
      const result = selectIsModalOpen(state);

      expect(result).toBe(false);
    });

    it('should return true when modal is open', () => {
      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          modal: {
            isOpen: true,
            type: 'confirm',
            props: {},
          },
        },
      });

      const result = selectIsModalOpen(state);
      expect(result).toBe(true);
    });
  });

  describe('selectModalType', () => {
    it('should return null when modal is closed', () => {
      const state = createMockRootState();
      const result = selectModalType(state);

      expect(result).toBeNull();
    });

    it('should return modal type when open', () => {
      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          modal: {
            isOpen: true,
            type: 'confirm',
            props: {},
          },
        },
      });

      const result = selectModalType(state);
      expect(result).toBe('confirm');
    });

    it('should return alert type', () => {
      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          modal: {
            isOpen: true,
            type: 'alert',
            props: {},
          },
        },
      });

      const result = selectModalType(state);
      expect(result).toBe('alert');
    });
  });

  describe('selectModalProps', () => {
    it('should return empty props when modal is closed', () => {
      const state = createMockRootState();
      const result = selectModalProps(state);

      expect(result).toEqual({});
    });

    it('should return modal props', () => {
      const props = {
        message: 'Are you sure?',
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      };

      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          modal: {
            isOpen: true,
            type: 'confirm',
            props,
          },
        },
      });

      const result = selectModalProps(state);
      expect(result).toEqual(props);
    });
  });

  describe('selectIsDragging', () => {
    it('should return false when not dragging', () => {
      const state = createMockRootState();
      const result = selectIsDragging(state);

      expect(result).toBe(false);
    });

    it('should return true when dragging', () => {
      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          dragAndDrop: {
            isDragging: true,
            draggedItemId: 'file-1',
            draggedItemType: 'file',
            dropTargetId: null,
            dropTargetType: null,
          },
        },
      });

      const result = selectIsDragging(state);
      expect(result).toBe(true);
    });
  });

  describe('selectDraggedItem', () => {
    it('should return null values when not dragging', () => {
      const state = createMockRootState();
      const result = selectDraggedItem(state);

      expect(result).toEqual({
        id: null,
        type: null,
      });
    });

    it('should return dragged item info', () => {
      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          dragAndDrop: {
            isDragging: true,
            draggedItemId: 'file-1',
            draggedItemType: 'file',
            dropTargetId: null,
            dropTargetType: null,
          },
        },
      });

      const result = selectDraggedItem(state);
      expect(result).toEqual({
        id: 'file-1',
        type: 'file',
      });
    });

    it('should return folder dragged item', () => {
      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          dragAndDrop: {
            isDragging: true,
            draggedItemId: 'folder-1',
            draggedItemType: 'folder',
            dropTargetId: null,
            dropTargetType: null,
          },
        },
      });

      const result = selectDraggedItem(state);
      expect(result).toEqual({
        id: 'folder-1',
        type: 'folder',
      });
    });
  });

  describe('selectDropTarget', () => {
    it('should return null values when no drop target', () => {
      const state = createMockRootState();
      const result = selectDropTarget(state);

      expect(result).toEqual({
        id: null,
        type: null,
      });
    });

    it('should return drop target info', () => {
      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          dragAndDrop: {
            isDragging: true,
            draggedItemId: 'file-1',
            draggedItemType: 'file',
            dropTargetId: 'folder-1',
            dropTargetType: 'folder',
          },
        },
      });

      const result = selectDropTarget(state);
      expect(result).toEqual({
        id: 'folder-1',
        type: 'folder',
      });
    });
  });

  describe('selectIsLoading', () => {
    it('should return false when not loading', () => {
      const state = createMockRootState();
      const result = selectIsLoading(state);

      expect(result).toBe(false);
    });

    it('should return true when loading', () => {
      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          operations: {
            isLoading: true,
            progress: 50,
            message: 'Loading...',
          },
        },
      });

      const result = selectIsLoading(state);
      expect(result).toBe(true);
    });
  });

  describe('selectOperationProgress', () => {
    it('should return 0 when no operation', () => {
      const state = createMockRootState();
      const result = selectOperationProgress(state);

      expect(result).toBe(0);
    });

    it('should return progress value', () => {
      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          operations: {
            isLoading: true,
            progress: 75,
            message: 'Processing...',
          },
        },
      });

      const result = selectOperationProgress(state);
      expect(result).toBe(75);
    });

    it('should return 100 for completed operation', () => {
      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          operations: {
            isLoading: false,
            progress: 100,
            message: 'Complete',
          },
        },
      });

      const result = selectOperationProgress(state);
      expect(result).toBe(100);
    });
  });

  describe('selectOperationMessage', () => {
    it('should return empty string when no operation', () => {
      const state = createMockRootState();
      const result = selectOperationMessage(state);

      expect(result).toBe('');
    });

    it('should return operation message', () => {
      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          operations: {
            isLoading: true,
            progress: 50,
            message: 'Processing files...',
          },
        },
      });

      const result = selectOperationMessage(state);
      expect(result).toBe('Processing files...');
    });

    it('should return completion message', () => {
      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          operations: {
            isLoading: false,
            progress: 100,
            message: 'Operation completed successfully',
          },
        },
      });

      const result = selectOperationMessage(state);
      expect(result).toBe('Operation completed successfully');
    });
  });

  describe('memoization', () => {
    it('should return same reference for same state', () => {
      const state = createMockRootState();

      const result1 = selectTheme(state);
      const result2 = selectTheme(state);

      expect(result1).toBe(result2);
    });

    it('should return different reference when state changes', () => {
      const state1 = createMockRootState();
      const state2 = createMockRootState({
        ui: {
          ...state1.ui,
          theme: 'dark',
        },
      });

      const result1 = selectTheme(state1);
      const result2 = selectTheme(state2);

      expect(result1).not.toBe(result2);
    });

    it('should memoize complex selectors', () => {
      const state = createMockRootState();

      const result1 = selectDraggedItem(state);
      const result2 = selectDraggedItem(state);

      expect(result1).toBe(result2);
    });

    it('should memoize derived selectors', () => {
      const state = createMockRootState();

      const result1 = selectIsDarkTheme(state);
      const result2 = selectIsDarkTheme(state);

      expect(result1).toBe(result2);
    });
  });

  describe('edge cases', () => {
    it('should handle missing ui state gracefully', () => {
      const invalidState = {} as any;

      expect(() => selectTheme(invalidState)).toThrow();
    });

    it('should handle partial ui state', () => {
      const partialState = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          modal: undefined as any,
        },
      });

      expect(() => selectModal(partialState)).not.toThrow();
    });

    it('should handle undefined modal properties', () => {
      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          modal: {
            isOpen: true,
            type: 'confirm',
            props: undefined as any,
          },
        },
      });

      const result = selectModalProps(state);
      expect(result).toBeUndefined();
    });

    it('should handle undefined notifications', () => {
      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          notifications: undefined as any,
        },
      });

      const result = selectNotifications(state);
      expect(result).toBeUndefined();
    });
  });

  describe('integration scenarios', () => {
    it('should handle modal workflow', () => {
      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          modal: {
            isOpen: true,
            type: 'confirm',
            props: {
              title: 'Delete file?',
              message: 'This action cannot be undone',
              onConfirm: vi.fn(),
            },
          },
        },
      });

      expect(selectIsModalOpen(state)).toBe(true);
      expect(selectModalType(state)).toBe('confirm');
      expect(selectModalProps(state).title).toBe('Delete file?');
    });

    it('should handle drag and drop workflow', () => {
      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          dragAndDrop: {
            isDragging: true,
            draggedItemId: 'file-1',
            draggedItemType: 'file',
            dropTargetId: 'folder-1',
            dropTargetType: 'folder',
          },
        },
      });

      expect(selectIsDragging(state)).toBe(true);
      expect(selectDraggedItem(state)).toEqual({
        id: 'file-1',
        type: 'file',
      });
      expect(selectDropTarget(state)).toEqual({
        id: 'folder-1',
        type: 'folder',
      });
    });

    it('should handle operation progress workflow', () => {
      const state = createMockRootState({
        ui: {
          ...createMockRootState().ui,
          operations: {
            isLoading: true,
            progress: 65,
            message: 'Uploading files (13/20)...',
          },
        },
      });

      expect(selectIsLoading(state)).toBe(true);
      expect(selectOperationProgress(state)).toBe(65);
      expect(selectOperationMessage(state)).toBe('Uploading files (13/20)...');
    });
  });
});
