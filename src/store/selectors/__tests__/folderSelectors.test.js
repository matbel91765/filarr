/**
 * Test suite for folderSelectors
 */

import {
  selectAllFolders,
  selectFolderById,
  selectFolderItems,
  selectCurrentFolder,
  selectCurrentFolderItems,
  selectIsLoadingFolders,
  selectFoldersError,
  selectSortedFolders,
  selectFolderTree,
  selectFolderPathById,
  selectFilteredFolders
} from '../folderSelectors';

describe('folderSelectors', () => {
  const mockState = {
    folders: {
      byId: {
        'folder-1': {
          id: 'folder-1',
          name: 'Documents',
          type: 'folder',
          items: ['file-1', 'folder-2'],
          date: '2024-01-01T00:00:00.000Z'
        },
        'folder-2': {
          id: 'folder-2',
          name: 'Photos',
          type: 'folder',
          items: ['file-2'],
          date: '2024-01-02T00:00:00.000Z'
        }
      },
      allIds: ['folder-1', 'folder-2'],
      currentFolderId: 'folder-1',
      loading: false,
      error: null
    },
    files: {
      byId: {
        'file-1': {
          id: 'file-1',
          name: 'document.txt',
          type: 'file',
          size: 1024
        },
        'file-2': {
          id: 'file-2',
          name: 'photo.jpg',
          type: 'file',
          size: 2048
        }
      },
      allIds: ['file-1', 'file-2']
    },
    ui: {
      sortBy: {
        field: 'name',
        order: 'asc'
      }
    }
  };

  describe('selectAllFolders', () => {
    it('should return all folders as an array', () => {
      const result = selectAllFolders(mockState);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(mockState.folders.byId['folder-1']);
      expect(result[1]).toEqual(mockState.folders.byId['folder-2']);
    });

    it('should return empty array when no folders', () => {
      const emptyState = {
        ...mockState,
        folders: { ...mockState.folders, byId: {}, allIds: [] }
      };

      const result = selectAllFolders(emptyState);
      expect(result).toEqual([]);
    });
  });

  describe('selectFolderById', () => {
    it('should return folder by id', () => {
      const selector = selectFolderById('folder-1');
      const result = selector(mockState);

      expect(result).toEqual(mockState.folders.byId['folder-1']);
    });

    it('should return null for non-existent folder', () => {
      const selector = selectFolderById('non-existent');
      const result = selector(mockState);

      expect(result).toBe(null);
    });
  });

  describe('selectFolderItems', () => {
    it('should return folder items with correct types', () => {
      const selector = selectFolderItems('folder-1');
      const result = selector(mockState);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'file-1',
        itemType: 'file'
      });
      expect(result[1]).toMatchObject({
        id: 'folder-2',
        itemType: 'folder'
      });
    });

    it('should return empty array for non-existent folder', () => {
      const selector = selectFolderItems('non-existent');
      const result = selector(mockState);

      expect(result).toEqual([]);
    });

    it('should return empty array for folder without items', () => {
      const stateWithoutItems = {
        ...mockState,
        folders: {
          ...mockState.folders,
          byId: {
            ...mockState.folders.byId,
            'folder-3': {
              id: 'folder-3',
              name: 'Empty',
              type: 'folder',
              items: []
            }
          }
        }
      };

      const selector = selectFolderItems('folder-3');
      const result = selector(stateWithoutItems);

      expect(result).toEqual([]);
    });

    it('should filter out null items', () => {
      const stateWithInvalidItems = {
        ...mockState,
        folders: {
          ...mockState.folders,
          byId: {
            ...mockState.folders.byId,
            'folder-4': {
              id: 'folder-4',
              name: 'Test',
              type: 'folder',
              items: ['file-1', 'invalid-id', 'file-2']
            }
          }
        }
      };

      const selector = selectFolderItems('folder-4');
      const result = selector(stateWithInvalidItems);

      expect(result).toHaveLength(2);
      expect(result.every(item => item !== null)).toBe(true);
    });
  });

  describe('selectCurrentFolder', () => {
    it('should return current folder', () => {
      const result = selectCurrentFolder(mockState);

      expect(result).toEqual(mockState.folders.byId['folder-1']);
    });

    it('should return null when no current folder', () => {
      const stateWithoutCurrent = {
        ...mockState,
        folders: {
          ...mockState.folders,
          currentFolderId: null
        }
      };

      const result = selectCurrentFolder(stateWithoutCurrent);
      expect(result).toBe(null);
    });
  });

  describe('selectCurrentFolderItems', () => {
    it('should return current folder items', () => {
      const result = selectCurrentFolderItems(mockState);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: 'file-1', itemType: 'file' });
      expect(result[1]).toMatchObject({ id: 'folder-2', itemType: 'folder' });
    });

    it('should return empty array when no current folder', () => {
      const stateWithoutCurrent = {
        ...mockState,
        folders: {
          ...mockState.folders,
          currentFolderId: null
        }
      };

      const result = selectCurrentFolderItems(stateWithoutCurrent);
      expect(result).toEqual([]);
    });
  });

  describe('selectIsLoadingFolders', () => {
    it('should return loading state', () => {
      const result = selectIsLoadingFolders(mockState);
      expect(result).toBe(false);
    });

    it('should return true when loading', () => {
      const loadingState = {
        ...mockState,
        folders: { ...mockState.folders, loading: true }
      };

      const result = selectIsLoadingFolders(loadingState);
      expect(result).toBe(true);
    });
  });

  describe('selectFoldersError', () => {
    it('should return null when no error', () => {
      const result = selectFoldersError(mockState);
      expect(result).toBe(null);
    });

    it('should return error when present', () => {
      const error = { message: 'Test error' };
      const errorState = {
        ...mockState,
        folders: { ...mockState.folders, error }
      };

      const result = selectFoldersError(errorState);
      expect(result).toEqual(error);
    });
  });

  describe('selectSortedFolders', () => {
    it('should sort folders by name ascending', () => {
      const result = selectSortedFolders(mockState);

      expect(result[0].name).toBe('Documents');
      expect(result[1].name).toBe('Photos');
    });

    it('should sort folders by name descending', () => {
      const stateDesc = {
        ...mockState,
        ui: {
          sortBy: { field: 'name', order: 'desc' }
        }
      };

      const result = selectSortedFolders(stateDesc);

      expect(result[0].name).toBe('Photos');
      expect(result[1].name).toBe('Documents');
    });

    it('should sort folders by date', () => {
      const stateByDate = {
        ...mockState,
        ui: {
          sortBy: { field: 'date', order: 'asc' }
        }
      };

      const result = selectSortedFolders(stateByDate);

      expect(result[0].id).toBe('folder-1');
      expect(result[1].id).toBe('folder-2');
    });

    it('should sort folders by size (item count)', () => {
      const stateBySize = {
        ...mockState,
        ui: {
          sortBy: { field: 'size', order: 'desc' }
        }
      };

      const result = selectSortedFolders(stateBySize);

      expect(result[0].items.length).toBeGreaterThanOrEqual(result[1].items.length);
    });

    it('should handle folders without items when sorting by size', () => {
      const stateWithEmptyFolder = {
        ...mockState,
        folders: {
          ...mockState.folders,
          byId: {
            ...mockState.folders.byId,
            'folder-3': {
              id: 'folder-3',
              name: 'Empty',
              type: 'folder',
              date: '2024-01-03T00:00:00.000Z'
            }
          },
          allIds: ['folder-1', 'folder-2', 'folder-3']
        },
        ui: {
          sortBy: { field: 'size', order: 'desc' }
        }
      };

      const result = selectSortedFolders(stateWithEmptyFolder);

      expect(result).toHaveLength(3);
    });

    it('should handle folders without dates when sorting by date', () => {
      const stateWithoutDate = {
        ...mockState,
        folders: {
          ...mockState.folders,
          byId: {
            'folder-1': {
              id: 'folder-1',
              name: 'Documents',
              type: 'folder',
              items: ['file-1'],
              date: undefined
            },
            'folder-2': {
              id: 'folder-2',
              name: 'Photos',
              type: 'folder',
              items: ['file-2'],
              date: '2024-01-02T00:00:00.000Z'
            }
          }
        },
        ui: {
          sortBy: { field: 'date', order: 'asc' }
        }
      };

      const result = selectSortedFolders(stateWithoutDate);

      expect(result).toHaveLength(2);
    });

    it('should return folders in original order for unknown sort field', () => {
      const stateUnknownSort = {
        ...mockState,
        ui: {
          sortBy: { field: 'unknown', order: 'asc' }
        }
      };

      const result = selectSortedFolders(stateUnknownSort);

      expect(result).toHaveLength(2);
    });
  });

  describe('selectFolderTree', () => {
    it('should build tree with root folders only', () => {
      const result = selectFolderTree(mockState);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('folder-1');
      expect(result[1].id).toBe('folder-2');
    });

    it('should build tree with parent-child relationships', () => {
      const stateWithHierarchy = {
        ...mockState,
        folders: {
          ...mockState.folders,
          byId: {
            'folder-1': {
              id: 'folder-1',
              name: 'Root',
              type: 'folder',
              items: [],
              date: '2024-01-01T00:00:00.000Z'
            },
            'folder-2': {
              id: 'folder-2',
              name: 'Child',
              type: 'folder',
              items: [],
              parentId: 'folder-1',
              date: '2024-01-02T00:00:00.000Z'
            },
            'folder-3': {
              id: 'folder-3',
              name: 'Grandchild',
              type: 'folder',
              items: [],
              parentId: 'folder-2',
              date: '2024-01-03T00:00:00.000Z'
            }
          },
          allIds: ['folder-1', 'folder-2', 'folder-3']
        }
      };

      const result = selectFolderTree(stateWithHierarchy);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('folder-1');
      expect(result[0].children).toHaveLength(1);
      expect(result[0].children[0].id).toBe('folder-2');
      expect(result[0].children[0].children).toHaveLength(1);
      expect(result[0].children[0].children[0].id).toBe('folder-3');
    });

    it('should handle multiple root folders with children', () => {
      const stateMultipleRoots = {
        ...mockState,
        folders: {
          ...mockState.folders,
          byId: {
            'root-1': {
              id: 'root-1',
              name: 'Root 1',
              type: 'folder',
              items: []
            },
            'root-2': {
              id: 'root-2',
              name: 'Root 2',
              type: 'folder',
              items: []
            },
            'child-1': {
              id: 'child-1',
              name: 'Child 1',
              type: 'folder',
              items: [],
              parentId: 'root-1'
            },
            'child-2': {
              id: 'child-2',
              name: 'Child 2',
              type: 'folder',
              items: [],
              parentId: 'root-2'
            }
          },
          allIds: ['root-1', 'root-2', 'child-1', 'child-2']
        }
      };

      const result = selectFolderTree(stateMultipleRoots);

      expect(result).toHaveLength(2);
      expect(result.every(folder => folder.children)).toBe(true);
    });

    it('should return empty array when byId is null', () => {
      const stateNullById = {
        ...mockState,
        folders: {
          ...mockState.folders,
          byId: null,
          allIds: null
        }
      };

      const result = selectFolderTree(stateNullById);

      expect(result).toEqual([]);
    });

    it('should return empty array when allIds is null', () => {
      const stateNullAllIds = {
        ...mockState,
        folders: {
          ...mockState.folders,
          byId: {},
          allIds: null
        }
      };

      const result = selectFolderTree(stateNullAllIds);

      expect(result).toEqual([]);
    });

    it('should handle empty folders state', () => {
      const emptyState = {
        ...mockState,
        folders: {
          ...mockState.folders,
          byId: {},
          allIds: []
        }
      };

      const result = selectFolderTree(emptyState);

      expect(result).toEqual([]);
    });

    it('should skip folders that do not exist in byId', () => {
      const stateWithMissingFolders = {
        ...mockState,
        folders: {
          ...mockState.folders,
          byId: {
            'folder-1': {
              id: 'folder-1',
              name: 'Folder 1',
              type: 'folder',
              items: []
            }
          },
          allIds: ['folder-1', 'folder-2', 'folder-3']
        }
      };

      const result = selectFolderTree(stateWithMissingFolders);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('folder-1');
    });
  });

  describe('selectFolderPathById', () => {
    it('should return path for root folder', () => {
      const selector = selectFolderPathById('folder-1');
      const result = selector(mockState);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('folder-1');
    });

    it('should return path from nested folder to root', () => {
      const stateWithNesting = {
        ...mockState,
        folders: {
          ...mockState.folders,
          byId: {
            'folder-1': {
              id: 'folder-1',
              name: 'Root',
              type: 'folder',
              items: []
            },
            'folder-2': {
              id: 'folder-2',
              name: 'Child',
              type: 'folder',
              items: [],
              parentId: 'folder-1'
            },
            'folder-3': {
              id: 'folder-3',
              name: 'Grandchild',
              type: 'folder',
              items: [],
              parentId: 'folder-2'
            }
          },
          allIds: ['folder-1', 'folder-2', 'folder-3']
        }
      };

      const selector = selectFolderPathById('folder-3');
      const result = selector(stateWithNesting);

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('folder-1');
      expect(result[1].id).toBe('folder-2');
      expect(result[2].id).toBe('folder-3');
    });

    it('should return empty array for non-existent folder', () => {
      const selector = selectFolderPathById('non-existent');
      const result = selector(mockState);

      expect(result).toEqual([]);
    });

    it('should return empty array when folderId is null', () => {
      const selector = selectFolderPathById(null);
      const result = selector(mockState);

      expect(result).toEqual([]);
    });

    it('should return empty array when byId is null', () => {
      const stateNullById = {
        ...mockState,
        folders: {
          ...mockState.folders,
          byId: null
        }
      };

      const selector = selectFolderPathById('folder-1');
      const result = selector(stateNullById);

      expect(result).toEqual([]);
    });

    it('should handle broken parent chain gracefully', () => {
      const stateBrokenChain = {
        ...mockState,
        folders: {
          ...mockState.folders,
          byId: {
            'folder-1': {
              id: 'folder-1',
              name: 'Child',
              type: 'folder',
              items: [],
              parentId: 'non-existent-parent'
            }
          },
          allIds: ['folder-1']
        }
      };

      const selector = selectFolderPathById('folder-1');
      const result = selector(stateBrokenChain);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('folder-1');
    });

    it('should return correct path for middle-level folder', () => {
      const stateDeepNesting = {
        ...mockState,
        folders: {
          ...mockState.folders,
          byId: {
            'folder-1': {
              id: 'folder-1',
              name: 'Root',
              type: 'folder',
              items: []
            },
            'folder-2': {
              id: 'folder-2',
              name: 'Level 1',
              type: 'folder',
              items: [],
              parentId: 'folder-1'
            },
            'folder-3': {
              id: 'folder-3',
              name: 'Level 2',
              type: 'folder',
              items: [],
              parentId: 'folder-2'
            }
          },
          allIds: ['folder-1', 'folder-2', 'folder-3']
        }
      };

      const selector = selectFolderPathById('folder-2');
      const result = selector(stateDeepNesting);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('folder-1');
      expect(result[1].id).toBe('folder-2');
    });
  });

  describe('selectFilteredFolders', () => {
    it('should return all folders when search term is empty', () => {
      const selector = selectFilteredFolders('');
      const result = selector(mockState);

      expect(result).toHaveLength(2);
    });

    it('should return all folders when search term is whitespace', () => {
      const selector = selectFilteredFolders('   ');
      const result = selector(mockState);

      expect(result).toHaveLength(2);
    });

    it('should filter folders by name (case insensitive)', () => {
      const selector = selectFilteredFolders('doc');
      const result = selector(mockState);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Documents');
    });

    it('should filter folders with partial match', () => {
      const selector = selectFilteredFolders('pho');
      const result = selector(mockState);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Photos');
    });

    it('should return empty array when no matches', () => {
      const selector = selectFilteredFolders('nonexistent');
      const result = selector(mockState);

      expect(result).toEqual([]);
    });

    it('should handle case sensitivity correctly', () => {
      const selector = selectFilteredFolders('DOCUMENTS');
      const result = selector(mockState);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Documents');
    });

    it('should trim search term before matching', () => {
      const selector = selectFilteredFolders('  Documents  ');
      const result = selector(mockState);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Documents');
    });
  });

  describe('edge cases', () => {
    it('should handle null byId gracefully', () => {
      const stateNullById = {
        ...mockState,
        folders: {
          ...mockState.folders,
          byId: null
        }
      };

      const selector = selectFolderItems('folder-1');
      const result = selector(stateNullById);

      expect(result).toEqual([]);
    });

    it('should handle null files byId in selectFolderItems', () => {
      const stateNullFilesById = {
        ...mockState,
        files: {
          ...mockState.files,
          byId: null
        }
      };

      const selector = selectFolderItems('folder-1');
      const result = selector(stateNullFilesById);

      expect(result).toEqual([]);
    });

    it('should handle null files byId in selectCurrentFolderItems', () => {
      const stateNullFilesById = {
        ...mockState,
        files: {
          ...mockState.files,
          byId: null
        }
      };

      const result = selectCurrentFolderItems(stateNullFilesById);

      expect(result).toEqual([]);
    });

    it('should handle null folders byId in selectCurrentFolderItems', () => {
      const stateNullFoldersById = {
        ...mockState,
        folders: {
          ...mockState.folders,
          byId: null
        }
      };

      const result = selectCurrentFolderItems(stateNullFoldersById);

      expect(result).toEqual([]);
    });
  });

  describe('memoization', () => {
    it('should return same reference for same state', () => {
      const result1 = selectAllFolders(mockState);
      const result2 = selectAllFolders(mockState);

      expect(result1).toBe(result2);
    });

    it('should return different reference when state changes', () => {
      const state1 = mockState;
      const state2 = {
        ...mockState,
        folders: {
          ...mockState.folders,
          allIds: ['folder-1']
        }
      };

      const result1 = selectAllFolders(state1);
      const result2 = selectAllFolders(state2);

      expect(result1).not.toBe(result2);
    });
  });
});
