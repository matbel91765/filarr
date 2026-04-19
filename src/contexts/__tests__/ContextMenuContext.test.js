/**
 * Tests unitaires pour le contexte ContextMenu
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ContextMenuProvider, useContextMenu } from '../ContextMenuContext';
import uiSlice from '../../store/slices/uiSlice';

// Créer un store de test
const createTestStore = () => {
  return configureStore({
    reducer: {
      ui: uiSlice,
    },
  });
};

describe('ContextMenuContext', () => {
  let store;

  beforeEach(() => {
    store = createTestStore();
  });

  describe('ContextMenuProvider', () => {
    it('devrait rendre les enfants sans erreur', () => {
      const { result } = renderHook(() => useContextMenu(), {
        wrapper: ({ children }) => (
          <Provider store={store}>
            <ContextMenuProvider>{children}</ContextMenuProvider>
          </Provider>
        ),
      });

      expect(result.current).toBeDefined();
    });

    it('devrait fournir la fonction setContextMenu', () => {
      const { result } = renderHook(() => useContextMenu(), {
        wrapper: ({ children }) => (
          <Provider store={store}>
            <ContextMenuProvider>{children}</ContextMenuProvider>
          </Provider>
        ),
      });

      expect(result.current.setContextMenu).toBeDefined();
      expect(typeof result.current.setContextMenu).toBe('function');
    });
  });

  describe('useContextMenu', () => {
    it('devrait retourner le contexte du menu contextuel', () => {
      const { result } = renderHook(() => useContextMenu(), {
        wrapper: ({ children }) => (
          <Provider store={store}>
            <ContextMenuProvider>{children}</ContextMenuProvider>
          </Provider>
        ),
      });

      expect(result.current).toHaveProperty('setContextMenu');
    });

    it('devrait dispatcher une action openModal lors de l\'appel de setContextMenu', () => {
      const { result } = renderHook(() => useContextMenu(), {
        wrapper: ({ children }) => (
          <Provider store={store}>
            <ContextMenuProvider>{children}</ContextMenuProvider>
          </Provider>
        ),
      });

      const menuOptions = {
        x: 100,
        y: 200,
        options: [
          { label: 'Option 1', action: 'action1' },
          { label: 'Option 2', action: 'action2' },
        ],
        onOptionSelect: jest.fn(),
        item: { id: 'item-1', name: 'Test Item' },
      };

      act(() => {
        result.current.setContextMenu(menuOptions);
      });

      // Vérifier que l'état du store a été mis à jour
      const state = store.getState();
      expect(state.ui.modal).toBeDefined();
      expect(state.ui.modal.type).toBe('context-menu');
      expect(state.ui.modal.props).toMatchObject({
        x: 100,
        y: 200,
        options: menuOptions.options,
        item: menuOptions.item,
      });
    });

    it('devrait permettre d\'afficher plusieurs menus contextuels successifs', () => {
      const { result } = renderHook(() => useContextMenu(), {
        wrapper: ({ children }) => (
          <Provider store={store}>
            <ContextMenuProvider>{children}</ContextMenuProvider>
          </Provider>
        ),
      });

      const firstMenu = {
        x: 100,
        y: 200,
        options: [{ label: 'Option 1' }],
        onOptionSelect: jest.fn(),
        item: { id: 'item-1' },
      };

      const secondMenu = {
        x: 150,
        y: 250,
        options: [{ label: 'Option 2' }],
        onOptionSelect: jest.fn(),
        item: { id: 'item-2' },
      };

      act(() => {
        result.current.setContextMenu(firstMenu);
      });

      let state = store.getState();
      expect(state.ui.modal.props.x).toBe(100);
      expect(state.ui.modal.props.item.id).toBe('item-1');

      act(() => {
        result.current.setContextMenu(secondMenu);
      });

      state = store.getState();
      expect(state.ui.modal.props.x).toBe(150);
      expect(state.ui.modal.props.item.id).toBe('item-2');
    });

    it('devrait gérer les coordonnées du menu contextuel', () => {
      const { result } = renderHook(() => useContextMenu(), {
        wrapper: ({ children }) => (
          <Provider store={store}>
            <ContextMenuProvider>{children}</ContextMenuProvider>
          </Provider>
        ),
      });

      act(() => {
        result.current.setContextMenu({
          x: 300,
          y: 400,
          options: [],
          onOptionSelect: jest.fn(),
          item: null,
        });
      });

      const state = store.getState();
      expect(state.ui.modal.props.x).toBe(300);
      expect(state.ui.modal.props.y).toBe(400);
    });

    it('devrait accepter des options de menu variées', () => {
      const { result } = renderHook(() => useContextMenu(), {
        wrapper: ({ children }) => (
          <Provider store={store}>
            <ContextMenuProvider>{children}</ContextMenuProvider>
          </Provider>
        ),
      });

      const options = [
        { label: 'Ouvrir', action: 'open', icon: 'open-icon' },
        { label: 'Renommer', action: 'rename', icon: 'rename-icon' },
        { label: 'Supprimer', action: 'delete', icon: 'delete-icon', danger: true },
        { type: 'separator' },
        { label: 'Propriétés', action: 'properties' },
      ];

      act(() => {
        result.current.setContextMenu({
          x: 100,
          y: 200,
          options,
          onOptionSelect: jest.fn(),
          item: { id: 'test-item' },
        });
      });

      const state = store.getState();
      expect(state.ui.modal.props.options).toEqual(options);
    });

    it('devrait gérer les callback onOptionSelect', () => {
      const { result } = renderHook(() => useContextMenu(), {
        wrapper: ({ children }) => (
          <Provider store={store}>
            <ContextMenuProvider>{children}</ContextMenuProvider>
          </Provider>
        ),
      });

      const onOptionSelect = jest.fn();

      act(() => {
        result.current.setContextMenu({
          x: 100,
          y: 200,
          options: [{ label: 'Test' }],
          onOptionSelect,
          item: null,
        });
      });

      const state = store.getState();
      expect(state.ui.modal.props.onOptionSelect).toBeDefined();
    });

    it('devrait permettre de passer un item au menu contextuel', () => {
      const { result } = renderHook(() => useContextMenu(), {
        wrapper: ({ children }) => (
          <Provider store={store}>
            <ContextMenuProvider>{children}</ContextMenuProvider>
          </Provider>
        ),
      });

      const item = {
        id: 'file-123',
        name: 'document.txt',
        type: 'file',
        size: 1024,
      };

      act(() => {
        result.current.setContextMenu({
          x: 100,
          y: 200,
          options: [{ label: 'Test' }],
          onOptionSelect: jest.fn(),
          item,
        });
      });

      const state = store.getState();
      expect(state.ui.modal.props.item).toEqual(item);
    });

    it('devrait fonctionner sans item (null)', () => {
      const { result } = renderHook(() => useContextMenu(), {
        wrapper: ({ children }) => (
          <Provider store={store}>
            <ContextMenuProvider>{children}</ContextMenuProvider>
          </Provider>
        ),
      });

      act(() => {
        result.current.setContextMenu({
          x: 100,
          y: 200,
          options: [{ label: 'Test' }],
          onOptionSelect: jest.fn(),
          item: null,
        });
      });

      const state = store.getState();
      expect(state.ui.modal.props.item).toBeNull();
    });
  });

  describe('Intégration avec Redux', () => {
    it('devrait dispatcher l\'action openModal avec le bon type', () => {
      const { result } = renderHook(() => useContextMenu(), {
        wrapper: ({ children }) => (
          <Provider store={store}>
            <ContextMenuProvider>{children}</ContextMenuProvider>
          </Provider>
        ),
      });

      act(() => {
        result.current.setContextMenu({
          x: 100,
          y: 200,
          options: [],
          onOptionSelect: jest.fn(),
          item: null,
        });
      });

      const state = store.getState();
      expect(state.ui.modal.type).toBe('context-menu');
    });

    it('devrait stocker les props du menu dans le state Redux', () => {
      const { result } = renderHook(() => useContextMenu(), {
        wrapper: ({ children }) => (
          <Provider store={store}>
            <ContextMenuProvider>{children}</ContextMenuProvider>
          </Provider>
        ),
      });

      const props = {
        x: 123,
        y: 456,
        options: [{ label: 'Test Option' }],
        onOptionSelect: jest.fn(),
        item: { id: 'test' },
      };

      act(() => {
        result.current.setContextMenu(props);
      });

      const state = store.getState();
      expect(state.ui.modal.props).toMatchObject({
        x: 123,
        y: 456,
        options: props.options,
        item: props.item,
      });
    });
  });
});
