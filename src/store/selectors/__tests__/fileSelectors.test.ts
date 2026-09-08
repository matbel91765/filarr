/**
 * Tests for fileSelectors
 *
 * Comprehensive tests for file state selectors including sorting, filtering,
 * statistics, and file management operations.
 */

import {
  selectAllFiles,
  selectFileById,
  selectSelectedFiles,
  selectIsFileSelected,
  selectFilesInFolder,
  selectSortedFiles,
  selectFilteredFiles,
  selectFilesByType,
  selectRecentFiles,
  selectFilesStats,
  selectUploadProgress,
  selectDownloadProgress,
  selectIsLoadingFiles,
  selectFilesError,
  selectSimilarFiles,
} from '../fileSelectors';
import { createMockRootState } from '../../../test-utils/mockState';
import { describe, it, expect } from 'vitest';

describe('fileSelectors', () => {
  // Helper to create state with files
  const createStateWithFiles = () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    return createMockRootState({
      files: {
        byId: {
          'file-1': {
            id: 'file-1',
            name: 'document.txt',
            type: 'text',
            size: 1024,
            date: yesterday.toISOString(),
            folderId: 'folder-1',
          },
          'file-2': {
            id: 'file-2',
            name: 'image.png',
            type: 'image',
            size: 2048,
            date: now.toISOString(),
            folderId: 'folder-1',
          },
          'file-3': {
            id: 'file-3',
            name: 'video.mp4',
            type: 'video',
            size: 5120,
            date: lastWeek.toISOString(),
            folderId: 'folder-2',
          },
          'file-4': {
            id: 'file-4',
            name: 'document-copy.txt',
            type: 'text',
            size: 1100,
            date: yesterday.toISOString(),
            folderId: 'folder-1',
          },
        },
        allIds: ['file-1', 'file-2', 'file-3', 'file-4'],
        selectedIds: ['file-1', 'file-2'],
        loading: false,
        error: null,
        uploadProgress: {
          'file-1': 50,
          'file-2': 100,
        },
        downloadProgress: {
          'file-3': 75,
        },
      },
      folders: {
        byId: {
          'folder-1': {
            id: 'folder-1',
            name: 'Documents',
            items: ['file-1', 'file-2', 'file-4', 'folder-3'],
            date: now.toISOString(),
          },
          'folder-2': {
            id: 'folder-2',
            name: 'Media',
            items: ['file-3'],
            date: now.toISOString(),
          },
          'folder-3': {
            id: 'folder-3',
            name: 'Subfolder',
            items: [],
            date: now.toISOString(),
          },
        },
        allIds: ['folder-1', 'folder-2', 'folder-3'],
        currentFolderId: null,
        loading: false,
        error: null,
      },
      ui: {
        theme: 'light',
        customTheme: null,
        sidebarOpen: true,
        viewMode: 'grid',
        sortBy: {
          field: 'name',
          order: 'asc',
        },
        modal: {
          isOpen: false,
          type: null,
          props: {},
        },
        notifications: [],
        dragAndDrop: {
          isDragging: false,
          draggedItemId: null,
          draggedItemType: null,
          dropTargetId: null,
          dropTargetType: null,
        },
        operations: {
          isLoading: false,
          progress: 0,
          message: '',
        },
      },
    });
  };

  describe('selectAllFiles', () => {
    it('should return all files as an array', () => {
      const state = createStateWithFiles();
      const result = selectAllFiles(state);

      expect(result).toHaveLength(4);
      expect(result[0].id).toBe('file-1');
      expect(result[1].id).toBe('file-2');
      expect(result[2].id).toBe('file-3');
      expect(result[3].id).toBe('file-4');
    });

    it('should return empty array when no files', () => {
      const state = createMockRootState();
      const result = selectAllFiles(state);

      expect(result).toEqual([]);
    });

    it('should filter out null/undefined files', () => {
      const state = createMockRootState({
        files: {
          byId: {
            'file-1': {
              id: 'file-1',
              name: 'test.txt',
              type: 'text',
              size: 100,
              date: new Date().toISOString(),
            },
          },
          allIds: ['file-1', 'file-2', 'file-3'],
          selectedIds: [],
          loading: false,
          error: null,
          uploadProgress: {},
          downloadProgress: {},
        },
      });

      const result = selectAllFiles(state);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('file-1');
    });
  });

  describe('selectFileById', () => {
    it('should return file by id', () => {
      const state = createStateWithFiles();
      const selector = selectFileById('file-1');
      const result = selector(state);

      expect(result).toBeDefined();
      expect(result?.name).toBe('document.txt');
      expect(result?.type).toBe('text');
    });

    it('should return null for non-existent file', () => {
      const state = createStateWithFiles();
      const selector = selectFileById('non-existent');
      const result = selector(state);

      expect(result).toBeNull();
    });

    it('should return null when byId is missing', () => {
      const state = createMockRootState({
        files: {
          byId: undefined as any,
          allIds: [],
          selectedIds: [],
          loading: false,
          error: null,
          uploadProgress: {},
          downloadProgress: {},
        },
      });

      const selector = selectFileById('file-1');
      const result = selector(state);
      expect(result).toBeNull();
    });
  });

  describe('selectSelectedFiles', () => {
    it('should return selected files', () => {
      const state = createStateWithFiles();
      const result = selectSelectedFiles(state);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('file-1');
      expect(result[1].id).toBe('file-2');
    });

    it('should return empty array when no files selected', () => {
      const state = createMockRootState();
      const result = selectSelectedFiles(state);

      expect(result).toEqual([]);
    });

    it('should filter out invalid selected file ids', () => {
      const state = createMockRootState({
        files: {
          byId: {
            'file-1': {
              id: 'file-1',
              name: 'test.txt',
              type: 'text',
              size: 100,
              date: new Date().toISOString(),
            },
          },
          allIds: ['file-1'],
          selectedIds: ['file-1', 'file-2', 'file-3'],
          loading: false,
          error: null,
          uploadProgress: {},
          downloadProgress: {},
        },
      });

      const result = selectSelectedFiles(state);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('file-1');
    });
  });

  describe('selectIsFileSelected', () => {
    it('should return true for selected file', () => {
      const state = createStateWithFiles();
      const selector = selectIsFileSelected('file-1');
      const result = selector(state);

      expect(result).toBe(true);
    });

    it('should return false for non-selected file', () => {
      const state = createStateWithFiles();
      const selector = selectIsFileSelected('file-3');
      const result = selector(state);

      expect(result).toBe(false);
    });

    it('should return false when selectedIds is empty', () => {
      const state = createMockRootState();
      const selector = selectIsFileSelected('file-1');
      const result = selector(state);

      expect(result).toBe(false);
    });
  });

  describe('selectFilesInFolder', () => {
    it('should return files in folder', () => {
      const state = createStateWithFiles();
      const selector = selectFilesInFolder('folder-1');
      const result = selector(state);

      expect(result).toHaveLength(3);
      expect(result.map((f) => f.id)).toEqual(['file-1', 'file-2', 'file-4']);
    });

    it('should filter out folders from items', () => {
      const state = createStateWithFiles();
      const selector = selectFilesInFolder('folder-1');
      const result = selector(state);

      // folder-3 is in the items but should be filtered out
      expect(result.every((item) => item.type !== 'folder')).toBe(true);
    });

    it('should return empty array for non-existent folder', () => {
      const state = createStateWithFiles();
      const selector = selectFilesInFolder('non-existent');
      const result = selector(state);

      expect(result).toEqual([]);
    });

    it('should return empty array for folder without items', () => {
      const state = createStateWithFiles();
      const selector = selectFilesInFolder('folder-3');
      const result = selector(state);

      expect(result).toEqual([]);
    });

    it('should handle folder with null items', () => {
      const state = createMockRootState({
        folders: {
          byId: {
            'folder-1': {
              id: 'folder-1',
              name: 'Test',
              items: null as any,
              date: new Date().toISOString(),
            },
          },
          allIds: ['folder-1'],
          currentFolderId: null,
          loading: false,
          error: null,
        },
      });

      const selector = selectFilesInFolder('folder-1');
      const result = selector(state);
      expect(result).toEqual([]);
    });
  });

  describe('selectSortedFiles', () => {
    it('should sort files by name ascending', () => {
      const state = createStateWithFiles();
      const selector = selectSortedFiles('folder-1');
      const result = selector(state);

      expect(result[0].name).toBe('document-copy.txt');
      expect(result[1].name).toBe('document.txt');
      expect(result[2].name).toBe('image.png');
    });

    it('should sort files by name descending', () => {
      const state = createMockRootState({
        ...createStateWithFiles(),
        ui: {
          ...createStateWithFiles().ui,
          sortBy: {
            field: 'name',
            order: 'desc',
          },
        },
      });

      const selector = selectSortedFiles('folder-1');
      const result = selector(state);

      expect(result[0].name).toBe('image.png');
      expect(result[1].name).toBe('document.txt');
      expect(result[2].name).toBe('document-copy.txt');
    });

    it('should sort files by date ascending', () => {
      const state = createMockRootState({
        ...createStateWithFiles(),
        ui: {
          ...createStateWithFiles().ui,
          sortBy: {
            field: 'date',
            order: 'asc',
          },
        },
      });

      const selector = selectSortedFiles('folder-1');
      const result = selector(state);

      // Yesterday's files should come first (older dates)
      const dates = result.map((f) => new Date(f.date!).getTime());
      expect(dates[0]).toBeLessThanOrEqual(dates[1]);
      expect(dates[1]).toBeLessThanOrEqual(dates[2]);
    });

    it('should sort files by date descending', () => {
      const state = createMockRootState({
        ...createStateWithFiles(),
        ui: {
          ...createStateWithFiles().ui,
          sortBy: {
            field: 'date',
            order: 'desc',
          },
        },
      });

      const selector = selectSortedFiles('folder-1');
      const result = selector(state);

      const dates = result.map((f) => new Date(f.date!).getTime());
      expect(dates[0]).toBeGreaterThanOrEqual(dates[1]);
      expect(dates[1]).toBeGreaterThanOrEqual(dates[2]);
    });

    it('should sort files by size ascending', () => {
      const state = createMockRootState({
        ...createStateWithFiles(),
        ui: {
          ...createStateWithFiles().ui,
          sortBy: {
            field: 'size',
            order: 'asc',
          },
        },
      });

      const selector = selectSortedFiles('folder-1');
      const result = selector(state);

      expect(result[0].size).toBe(1024);
      expect(result[1].size).toBe(1100);
      expect(result[2].size).toBe(2048);
    });

    it('should sort files by size descending', () => {
      const state = createMockRootState({
        ...createStateWithFiles(),
        ui: {
          ...createStateWithFiles().ui,
          sortBy: {
            field: 'size',
            order: 'desc',
          },
        },
      });

      const selector = selectSortedFiles('folder-1');
      const result = selector(state);

      expect(result[0].size).toBe(2048);
      expect(result[1].size).toBe(1100);
      expect(result[2].size).toBe(1024);
    });

    it('should sort files by type ascending', () => {
      const state = createMockRootState({
        ...createStateWithFiles(),
        ui: {
          ...createStateWithFiles().ui,
          sortBy: {
            field: 'type',
            order: 'asc',
          },
        },
      });

      const selector = selectSortedFiles('folder-1');
      const result = selector(state);

      const types = result.map((f) => f.type);
      expect(types).toEqual(['image', 'text', 'text']);
    });

    it('should handle files without dates when sorting by date', () => {
      const state = createMockRootState({
        files: {
          byId: {
            'file-1': {
              id: 'file-1',
              name: 'test.txt',
              type: 'text',
              size: 100,
              date: undefined,
              folderId: 'folder-1',
            },
            'file-2': {
              id: 'file-2',
              name: 'test2.txt',
              type: 'text',
              size: 200,
              date: new Date().toISOString(),
              folderId: 'folder-1',
            },
          },
          allIds: ['file-1', 'file-2'],
          selectedIds: [],
          loading: false,
          error: null,
          uploadProgress: {},
          downloadProgress: {},
        },
        folders: {
          byId: {
            'folder-1': {
              id: 'folder-1',
              name: 'Test',
              items: ['file-1', 'file-2'],
              date: new Date().toISOString(),
            },
          },
          allIds: ['folder-1'],
          currentFolderId: null,
          loading: false,
          error: null,
        },
        ui: {
          ...createStateWithFiles().ui,
          sortBy: {
            field: 'date',
            order: 'asc',
          },
        },
      });

      const selector = selectSortedFiles('folder-1');
      const result = selector(state);

      expect(result).toHaveLength(2);
    });

    it('should handle files without sizes when sorting by size', () => {
      const state = createMockRootState({
        files: {
          byId: {
            'file-1': {
              id: 'file-1',
              name: 'test.txt',
              type: 'text',
              size: undefined,
              date: new Date().toISOString(),
              folderId: 'folder-1',
            },
            'file-2': {
              id: 'file-2',
              name: 'test2.txt',
              type: 'text',
              size: 200,
              date: new Date().toISOString(),
              folderId: 'folder-1',
            },
          },
          allIds: ['file-1', 'file-2'],
          selectedIds: [],
          loading: false,
          error: null,
          uploadProgress: {},
          downloadProgress: {},
        },
        folders: {
          byId: {
            'folder-1': {
              id: 'folder-1',
              name: 'Test',
              items: ['file-1', 'file-2'],
              date: new Date().toISOString(),
            },
          },
          allIds: ['folder-1'],
          currentFolderId: null,
          loading: false,
          error: null,
        },
        ui: {
          ...createStateWithFiles().ui,
          sortBy: {
            field: 'size',
            order: 'asc',
          },
        },
      });

      const selector = selectSortedFiles('folder-1');
      const result = selector(state);

      expect(result).toHaveLength(2);
      expect(result[0].size || 0).toBeLessThanOrEqual(result[1].size || 0);
    });
  });

  describe('selectFilteredFiles', () => {
    it('should return all files when search term is empty', () => {
      const state = createStateWithFiles();
      const selector = selectFilteredFiles('');
      const result = selector(state);

      expect(result).toHaveLength(4);
    });

    it('should return all files when search term is whitespace', () => {
      const state = createStateWithFiles();
      const selector = selectFilteredFiles('   ');
      const result = selector(state);

      expect(result).toHaveLength(4);
    });

    it('should filter files by name (case insensitive)', () => {
      const state = createStateWithFiles();
      const selector = selectFilteredFiles('document');
      const result = selector(state);

      expect(result).toHaveLength(2);
      expect(result.map((f) => f.name)).toEqual(['document.txt', 'document-copy.txt']);
    });

    it('should filter files by partial name match', () => {
      const state = createStateWithFiles();
      const selector = selectFilteredFiles('doc');
      const result = selector(state);

      expect(result).toHaveLength(2);
    });

    it('should filter by type option', () => {
      const state = createStateWithFiles();
      const selector = selectFilteredFiles('doc', { type: 'text' });
      const result = selector(state);

      expect(result).toHaveLength(2);
      expect(result.every((f) => f.type === 'text')).toBe(true);
    });

    it('should filter by name and type', () => {
      const state = createStateWithFiles();
      const selector = selectFilteredFiles('document', { type: 'text' });
      const result = selector(state);

      expect(result).toHaveLength(2);
      expect(result.every((f) => f.type === 'text' && f.name.includes('document'))).toBe(true);
    });

    it('should filter by minimum size', () => {
      const state = createStateWithFiles();
      const selector = selectFilteredFiles('.', { minSize: 2000 });
      const result = selector(state);

      expect(result).toHaveLength(2);
      expect(result.every((f) => (f.size || 0) >= 2000)).toBe(true);
    });

    it('should filter by maximum size', () => {
      const state = createStateWithFiles();
      const selector = selectFilteredFiles('.', { maxSize: 2000 });
      const result = selector(state);

      expect(result).toHaveLength(2);
      expect(result.every((f) => (f.size || 0) <= 2000)).toBe(true);
    });

    it('should filter by size range', () => {
      const state = createStateWithFiles();
      const selector = selectFilteredFiles('.', { minSize: 1000, maxSize: 3000 });
      const result = selector(state);

      // file-1: 1024, file-2: 2048, file-4: 1100 (all within range)
      // file-3: 5120 (out of range)
      expect(result).toHaveLength(3);
      expect(
        result.every((f) => {
          const size = f.size || 0;
          return size >= 1000 && size <= 3000;
        })
      ).toBe(true);
    });

    it('should filter by date range start', () => {
      const state = createStateWithFiles();
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const selector = selectFilteredFiles('.', {
        dateRange: {
          start: twoDaysAgo.toISOString(),
        },
      });
      const result = selector(state);

      // Should include files from yesterday and today, but not from last week
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((f) => new Date(f.date!) >= twoDaysAgo)).toBe(true);
    });

    it('should filter by date range end', () => {
      const state = createStateWithFiles();
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const selector = selectFilteredFiles('video', {
        dateRange: {
          end: yesterday.toISOString(),
        },
      });
      const result = selector(state);

      // Should only include the video file from last week
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((f) => new Date(f.date!) <= yesterday)).toBe(true);
    });

    it('should filter by complete date range', () => {
      const state = createStateWithFiles();
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      const selector = selectFilteredFiles('', {
        dateRange: {
          start: twoDaysAgo.toISOString(),
          end: now.toISOString(),
        },
      });
      const result = selector(state);

      expect(result.length).toBeGreaterThan(0);
    });

    it('should apply multiple filters together', () => {
      const state = createStateWithFiles();
      const selector = selectFilteredFiles('document', {
        type: 'text',
        minSize: 1000,
        maxSize: 2000,
      });
      const result = selector(state);

      expect(result.length).toBeGreaterThan(0);
      expect(
        result.every(
          (f) =>
            f.name.includes('document') &&
            f.type === 'text' &&
            (f.size || 0) >= 1000 &&
            (f.size || 0) <= 2000
        )
      ).toBe(true);
    });

    it('should handle files with missing size when filtering', () => {
      const state = createMockRootState({
        files: {
          byId: {
            'file-1': {
              id: 'file-1',
              name: 'test.txt',
              type: 'text',
              size: undefined,
              date: new Date().toISOString(),
            },
            'file-2': {
              id: 'file-2',
              name: 'test2.txt',
              type: 'text',
              size: 200,
              date: new Date().toISOString(),
            },
          },
          allIds: ['file-1', 'file-2'],
          selectedIds: [],
          loading: false,
          error: null,
          uploadProgress: {},
          downloadProgress: {},
        },
      });

      const selector = selectFilteredFiles('test', { minSize: 100 });
      const result = selector(state);

      // Only file-2 should pass (file-1 has undefined size, treated as 0)
      // Both match the name filter "test", but only file-2 meets the size requirement
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('file-2');
    });
  });

  describe('selectFilesByType', () => {
    it('should return files of specific type', () => {
      const state = createStateWithFiles();
      const selector = selectFilesByType('text');
      const result = selector(state);

      expect(result).toHaveLength(2);
      expect(result.every((f) => f.type === 'text')).toBe(true);
    });

    it('should return empty array for non-existent type', () => {
      const state = createStateWithFiles();
      const selector = selectFilesByType('audio');
      const result = selector(state);

      expect(result).toEqual([]);
    });

    it('should return all files matching the type', () => {
      const state = createStateWithFiles();
      const selector = selectFilesByType('image');
      const result = selector(state);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('image');
    });
  });

  describe('selectRecentFiles', () => {
    it('should return recent files sorted by date', () => {
      const state = createStateWithFiles();
      const selector = selectRecentFiles(10);
      const result = selector(state);

      expect(result).toHaveLength(4);

      // Should be sorted in descending order (newest first)
      const dates = result.map((f) => new Date(f.date!).getTime());
      for (let i = 0; i < dates.length - 1; i++) {
        expect(dates[i]).toBeGreaterThanOrEqual(dates[i + 1]);
      }
    });

    it('should limit results to specified limit', () => {
      const state = createStateWithFiles();
      const selector = selectRecentFiles(2);
      const result = selector(state);

      expect(result).toHaveLength(2);
    });

    it('should use default limit of 10', () => {
      const state = createStateWithFiles();
      const selector = selectRecentFiles();
      const result = selector(state);

      expect(result.length).toBeLessThanOrEqual(10);
    });

    it('should filter out files without dates', () => {
      const state = createMockRootState({
        files: {
          byId: {
            'file-1': {
              id: 'file-1',
              name: 'test.txt',
              type: 'text',
              size: 100,
              date: new Date().toISOString(),
            },
            'file-2': {
              id: 'file-2',
              name: 'test2.txt',
              type: 'text',
              size: 200,
              date: undefined,
            },
          },
          allIds: ['file-1', 'file-2'],
          selectedIds: [],
          loading: false,
          error: null,
          uploadProgress: {},
          downloadProgress: {},
        },
      });

      const selector = selectRecentFiles();
      const result = selector(state);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('file-1');
    });

    it('should return empty array when no files have dates', () => {
      const state = createMockRootState({
        files: {
          byId: {
            'file-1': {
              id: 'file-1',
              name: 'test.txt',
              type: 'text',
              size: 100,
              date: undefined,
            },
          },
          allIds: ['file-1'],
          selectedIds: [],
          loading: false,
          error: null,
          uploadProgress: {},
          downloadProgress: {},
        },
      });

      const selector = selectRecentFiles();
      const result = selector(state);

      expect(result).toEqual([]);
    });
  });

  describe('selectFilesStats', () => {
    it('should calculate total count', () => {
      const state = createStateWithFiles();
      const result = selectFilesStats(state);

      expect(result.totalCount).toBe(4);
    });

    it('should calculate total size', () => {
      const state = createStateWithFiles();
      const result = selectFilesStats(state);

      expect(result.totalSize).toBe(1024 + 2048 + 5120 + 1100);
    });

    it('should calculate average size', () => {
      const state = createStateWithFiles();
      const result = selectFilesStats(state);

      const expectedAverage = (1024 + 2048 + 5120 + 1100) / 4;
      expect(result.averageSize).toBe(expectedAverage);
    });

    it('should calculate type distribution', () => {
      const state = createStateWithFiles();
      const result = selectFilesStats(state);

      expect(result.typeDistribution).toEqual({
        text: 2,
        image: 1,
        video: 1,
      });
    });

    it('should return zero average for empty files', () => {
      const state = createMockRootState();
      const result = selectFilesStats(state);

      expect(result.averageSize).toBe(0);
    });

    it('should handle files without size', () => {
      const state = createMockRootState({
        files: {
          byId: {
            'file-1': {
              id: 'file-1',
              name: 'test.txt',
              type: 'text',
              size: undefined,
              date: new Date().toISOString(),
            },
            'file-2': {
              id: 'file-2',
              name: 'test2.txt',
              type: 'text',
              size: 100,
              date: new Date().toISOString(),
            },
          },
          allIds: ['file-1', 'file-2'],
          selectedIds: [],
          loading: false,
          error: null,
          uploadProgress: {},
          downloadProgress: {},
        },
      });

      const result = selectFilesStats(state);

      expect(result.totalSize).toBe(100);
      expect(result.averageSize).toBe(50);
    });

    it('should handle files without type', () => {
      const state = createMockRootState({
        files: {
          byId: {
            'file-1': {
              id: 'file-1',
              name: 'test.txt',
              type: undefined,
              size: 100,
              date: new Date().toISOString(),
            },
          },
          allIds: ['file-1'],
          selectedIds: [],
          loading: false,
          error: null,
          uploadProgress: {},
          downloadProgress: {},
        },
      });

      const result = selectFilesStats(state);

      expect(result.typeDistribution).toEqual({
        unknown: 1,
      });
    });

    it('should return correct stats for empty state', () => {
      const state = createMockRootState();
      const result = selectFilesStats(state);

      expect(result).toEqual({
        totalCount: 0,
        totalSize: 0,
        averageSize: 0,
        typeDistribution: {},
      });
    });
  });

  describe('selectUploadProgress', () => {
    it('should return upload progress for file', () => {
      const state = createStateWithFiles();
      const selector = selectUploadProgress('file-1');
      const result = selector(state);

      expect(result).toBe(50);
    });

    it('should return 0 for file without progress', () => {
      const state = createStateWithFiles();
      const selector = selectUploadProgress('file-3');
      const result = selector(state);

      expect(result).toBe(0);
    });

    it('should return 0 for non-existent file', () => {
      const state = createStateWithFiles();
      const selector = selectUploadProgress('non-existent');
      const result = selector(state);

      expect(result).toBe(0);
    });
  });

  describe('selectDownloadProgress', () => {
    it('should return download progress for file', () => {
      const state = createStateWithFiles();
      const selector = selectDownloadProgress('file-3');
      const result = selector(state);

      expect(result).toBe(75);
    });

    it('should return 0 for file without progress', () => {
      const state = createStateWithFiles();
      const selector = selectDownloadProgress('file-1');
      const result = selector(state);

      expect(result).toBe(0);
    });

    it('should return 0 for non-existent file', () => {
      const state = createStateWithFiles();
      const selector = selectDownloadProgress('non-existent');
      const result = selector(state);

      expect(result).toBe(0);
    });
  });

  describe('selectIsLoadingFiles', () => {
    it('should return loading state', () => {
      const state = createStateWithFiles();
      const result = selectIsLoadingFiles(state);

      expect(result).toBe(false);
    });

    it('should return true when loading', () => {
      const state = createMockRootState({
        files: {
          ...createStateWithFiles().files,
          loading: true,
        },
      });

      const result = selectIsLoadingFiles(state);
      expect(result).toBe(true);
    });
  });

  describe('selectFilesError', () => {
    it('should return null when no error', () => {
      const state = createStateWithFiles();
      const result = selectFilesError(state);

      expect(result).toBeNull();
    });

    it('should return error when present', () => {
      const error = { message: 'Test error' };
      const state = createMockRootState({
        files: {
          ...createStateWithFiles().files,
          error,
        },
      });

      const result = selectFilesError(state);
      expect(result).toEqual(error);
    });
  });

  describe('selectSimilarFiles', () => {
    it('should return files with same type', () => {
      const state = createStateWithFiles();
      const selector = selectSimilarFiles('file-1');
      const result = selector(state);

      expect(result.length).toBeGreaterThan(0);
      expect(result.some((f) => f.type === 'text')).toBe(true);
    });

    it('should return files with similar names', () => {
      const state = createStateWithFiles();
      const selector = selectSimilarFiles('file-1');
      const result = selector(state);

      expect(result.some((f) => f.name.includes('document'))).toBe(true);
    });

    it('should exclude the source file itself', () => {
      const state = createStateWithFiles();
      const selector = selectSimilarFiles('file-1');
      const result = selector(state);

      expect(result.every((f) => f.id !== 'file-1')).toBe(true);
    });

    it('should limit results to 5 files', () => {
      const state = createStateWithFiles();
      const selector = selectSimilarFiles('file-1');
      const result = selector(state);

      expect(result.length).toBeLessThanOrEqual(5);
    });

    it('should return empty array for non-existent file', () => {
      const state = createStateWithFiles();
      const selector = selectSimilarFiles('non-existent');
      const result = selector(state);

      expect(result).toEqual([]);
    });

    it('should return empty array when byId is null', () => {
      const state = createMockRootState({
        files: {
          byId: null as any,
          allIds: null as any,
          selectedIds: [],
          loading: false,
          error: null,
          uploadProgress: {},
          downloadProgress: {},
        },
      });

      const selector = selectSimilarFiles('file-1');
      const result = selector(state);

      expect(result).toEqual([]);
    });

    it('should return empty array when allIds is null', () => {
      const state = createMockRootState({
        files: {
          byId: {},
          allIds: null as any,
          selectedIds: [],
          loading: false,
          error: null,
          uploadProgress: {},
          downloadProgress: {},
        },
      });

      const selector = selectSimilarFiles('file-1');
      const result = selector(state);

      expect(result).toEqual([]);
    });

    it('should handle files with extension in name matching', () => {
      const state = createStateWithFiles();
      const selector = selectSimilarFiles('file-4');
      const result = selector(state);

      // file-4 is 'document-copy.txt', should find 'document.txt'
      expect(result.some((f) => f.name.includes('document'))).toBe(true);
    });

    it('should avoid duplicates in results', () => {
      const state = createStateWithFiles();
      const selector = selectSimilarFiles('file-1');
      const result = selector(state);

      const ids = result.map((f) => f.id);
      const uniqueIds = [...new Set(ids)];
      expect(ids.length).toBe(uniqueIds.length);
    });
  });

  describe('memoization', () => {
    it('should return same reference for same state', () => {
      const state = createStateWithFiles();

      const result1 = selectAllFiles(state);
      const result2 = selectAllFiles(state);

      expect(result1).toBe(result2);
    });

    it('should return different reference when state changes', () => {
      const state1 = createStateWithFiles();
      const state2 = createMockRootState({
        ...state1,
        files: {
          ...state1.files,
          allIds: ['file-1'],
        },
      });

      const result1 = selectAllFiles(state1);
      const result2 = selectAllFiles(state2);

      expect(result1).not.toBe(result2);
    });
  });

  describe('edge cases', () => {
    it('should handle empty state gracefully', () => {
      const state = createMockRootState();

      expect(selectAllFiles(state)).toEqual([]);
      expect(selectSelectedFiles(state)).toEqual([]);
      expect(selectFilesStats(state).totalCount).toBe(0);
    });

    it('should handle null values in file objects', () => {
      const state = createMockRootState({
        files: {
          byId: {
            'file-1': {
              id: 'file-1',
              name: 'test.txt',
              type: null as any,
              size: null as any,
              date: null as any,
            },
          },
          allIds: ['file-1'],
          selectedIds: [],
          loading: false,
          error: null,
          uploadProgress: {},
          downloadProgress: {},
        },
      });

      expect(() => selectAllFiles(state)).not.toThrow();
      expect(() => selectFilesStats(state)).not.toThrow();
    });
  });
});
