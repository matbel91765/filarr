/**
 * Tests for electronMiddleware
 */

import electronMiddleware, { setupIpcListeners } from '../electronMiddleware';
import { AnyAction } from '@reduxjs/toolkit';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * `window` N'EXISTE PAS DANS L'ENVIRONNEMENT `node` DE VITEST.
 *
 * Ces tests viennent de Jest, ou l'environnement JSDOM etait le defaut et ou
 * `window === globalThis`. Ils ne testent aucun DOM — ils posent seulement
 * `window.electron` pour doubler le pont IPC. Aliaser suffit donc, et evite
 * d'ajouter jsdom (une dependance de plusieurs megaoctets) pour cinq lignes.
 */
if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
  (globalThis as { window?: unknown }).window = globalThis;
}

describe('electronMiddleware', () => {
  let mockStore: any;
  let mockNext: vi.Mock;
  let mockElectron: any;
  let mockIpcRenderer: any;

  beforeEach(() => {
    // Setup mocks
    mockNext = vi.fn((action) => action);
    mockStore = {
      getState: vi.fn(),
      dispatch: vi.fn(),
    };

    mockIpcRenderer = {
      invoke: vi.fn(),
      on: vi.fn(),
      send: vi.fn(),
      once: vi.fn(),
      removeListener: vi.fn(),
      removeAllListeners: vi.fn(),
    };

    mockElectron = {
      ipcRenderer: mockIpcRenderer,
    };

    // Set window.electron directly (JSDOM environment: window === global)
    (window as any).electron = mockElectron;
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (window as any).electron;
  });

  describe('middleware function', () => {
    it('should pass action to next middleware', () => {
      const action: AnyAction = { type: 'TEST_ACTION' };
      const middleware = electronMiddleware(mockStore)(mockNext);

      middleware(action);

      expect(mockNext).toHaveBeenCalledWith(action);
    });

    it('should handle actions when electron is not available', () => {
      (window as any).electron = undefined;
      const action: AnyAction = { type: 'TEST_ACTION' };
      const middleware = electronMiddleware(mockStore)(mockNext);

      const result = middleware(action);

      expect(mockNext).toHaveBeenCalledWith(action);
      expect(result).toEqual(action);
    });

    it('should invoke electron IPC for files/addFileRequested action', () => {
      const action: AnyAction = {
        type: 'files/addFileRequested',
        payload: { fileName: 'test.txt' },
      };
      const middleware = electronMiddleware(mockStore)(mockNext);

      middleware(action);

      expect(mockIpcRenderer.send).toHaveBeenCalledWith('add-file', action.payload);
    });

    it('should invoke electron IPC for files/exportFileRequested action', () => {
      const action: AnyAction = {
        type: 'files/exportFileRequested',
        payload: { fileId: '123' },
      };
      const middleware = electronMiddleware(mockStore)(mockNext);

      middleware(action);

      expect(mockIpcRenderer.send).toHaveBeenCalledWith('export-file', action.payload);
    });

    it('should invoke electron IPC for folders/createRequested action', () => {
      const action: AnyAction = {
        type: 'folders/createRequested',
        payload: { folderName: 'New Folder' },
      };
      const middleware = electronMiddleware(mockStore)(mockNext);

      middleware(action);

      expect(mockIpcRenderer.send).toHaveBeenCalledWith('create-folder', action.payload);
    });

    it('should invoke electron IPC for auth/loginRequested action', () => {
      const action: AnyAction = {
        type: 'auth/loginRequested',
        payload: { username: 'user', password: 'pass' },
      };
      const middleware = electronMiddleware(mockStore)(mockNext);

      middleware(action);

      expect(mockIpcRenderer.send).toHaveBeenCalledWith('login', action.payload);
    });

    it('should invoke electron IPC for sync/syncRequested action', () => {
      const action: AnyAction = {
        type: 'sync/syncRequested',
        payload: {},
      };
      const middleware = electronMiddleware(mockStore)(mockNext);

      middleware(action);

      expect(mockIpcRenderer.send).toHaveBeenCalledWith('sync-with-cloud', action.payload);
    });

    it('should send rejected actions to main process for logging', () => {
      const action: AnyAction = {
        type: 'some/action/rejected',
        error: { message: 'Test error' },
        meta: { requestId: '123', requestStatus: 'rejected' },
      };
      const middleware = electronMiddleware(mockStore)(mockNext);

      middleware(action);

      expect(mockIpcRenderer.send).toHaveBeenCalledWith('redux-error', {
        type: action.type,
        error: 'Test error',
        meta: action.meta,
      });
    });

    it('should send fulfilled actions to main process', () => {
      const action: AnyAction = {
        type: 'auth/login/fulfilled',
        payload: { user: 'testuser' },
        meta: { requestId: '123', requestStatus: 'fulfilled' },
      };
      const middleware = electronMiddleware(mockStore)(mockNext);

      middleware(action);

      expect(mockIpcRenderer.send).toHaveBeenCalledWith('redux-state-changed', {
        type: action.type,
        payload: action.payload,
      });
    });

    it('should send sync pending notification to main process', () => {
      const action: AnyAction = {
        type: 'sync/syncWithCloud/pending',
        meta: { requestId: '123', requestStatus: 'pending' },
      };
      const middleware = electronMiddleware(mockStore)(mockNext);

      middleware(action);

      expect(mockIpcRenderer.send).toHaveBeenCalledWith('long-operation-started', {
        type: 'sync',
        message: 'Synchronisation en cours...',
      });
    });

    it('should send sync fulfilled notification to main process', () => {
      const action: AnyAction = {
        type: 'sync/syncWithCloud/fulfilled',
        payload: undefined,
        meta: { requestId: '123', requestStatus: 'fulfilled' },
      };
      const middleware = electronMiddleware(mockStore)(mockNext);

      middleware(action);

      expect(mockIpcRenderer.send).toHaveBeenCalledWith('long-operation-finished', {
        type: 'sync',
        success: true,
      });
    });

    it('should send sync rejected notification to main process', () => {
      const action: AnyAction = {
        type: 'sync/syncWithCloud/rejected',
        error: { message: 'Sync failed' },
        meta: { requestId: '123', requestStatus: 'rejected' },
      };
      const middleware = electronMiddleware(mockStore)(mockNext);

      middleware(action);

      expect(mockIpcRenderer.send).toHaveBeenCalledWith('long-operation-finished', {
        type: 'sync',
        success: false,
        error: 'Sync failed',
      });
    });
  });

  describe('setupIpcListeners', () => {
    it('should setup IPC listeners for show-notification', () => {
      setupIpcListeners(mockStore);

      expect(mockIpcRenderer.on).toHaveBeenCalledWith('show-notification', expect.any(Function));
    });

    it('should setup IPC listeners for folders-updated', () => {
      setupIpcListeners(mockStore);

      expect(mockIpcRenderer.on).toHaveBeenCalledWith('folders-updated', expect.any(Function));
    });

    it('should setup IPC listeners for files-updated', () => {
      setupIpcListeners(mockStore);

      expect(mockIpcRenderer.on).toHaveBeenCalledWith('files-updated', expect.any(Function));
    });

    it('should setup IPC listeners for main-process-error', () => {
      setupIpcListeners(mockStore);

      expect(mockIpcRenderer.on).toHaveBeenCalledWith('main-process-error', expect.any(Function));
    });

    it('should setup IPC listeners for sync-status-changed', () => {
      setupIpcListeners(mockStore);

      expect(mockIpcRenderer.on).toHaveBeenCalledWith('sync-status-changed', expect.any(Function));
    });

    it('should setup IPC listeners for system-theme-changed', () => {
      setupIpcListeners(mockStore);

      expect(mockIpcRenderer.on).toHaveBeenCalledWith('system-theme-changed', expect.any(Function));
    });

    it('should dispatch notification when show-notification event received', () => {
      setupIpcListeners(mockStore);

      const onCallback = mockIpcRenderer.on.mock.calls.find(
        (call: any[]) => call[0] === 'show-notification'
      )[1];
      const notification = { type: 'success', message: 'Test notification' };

      onCallback(null, notification);

      expect(mockStore.dispatch).toHaveBeenCalledWith({
        type: 'ui/addNotification',
        payload: notification,
      });
    });

    it('should warn when electron IPC is not available', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation();
      (window as any).electron = undefined;

      setupIpcListeners(mockStore);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Electron IPC not available, skipping IPC listeners setup'
      );

      consoleWarnSpy.mockRestore();
    });
  });
});
