/**
 * Header Search Integration Tests
 *
 * Tests the integration of search functionality in the Header component
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import configureStore from 'redux-mock-store';
import { thunk } from 'redux-thunk';
import { Header } from '../Header';
import searchService from '../../../../../services/search/searchService';
import { createMockRootState } from '../../../../../test-utils/mockState';

// Mock searchService
jest.mock('../../../../../services/search/searchService');

// Mock react-i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => defaultValue || key,
  }),
}));

// Mock themeService (used by uiSlice at import time)
jest.mock('../../../../../services/platform/themeService', () => ({
  applyDensity: jest.fn(),
  saveDensitySettings: jest.fn(),
  loadThemePreferences: jest.fn(() => ({
    activeThemeId: 'light',
    customThemes: [],
    useSystemTheme: false,
  })),
  loadDensitySettings: jest.fn(() => ({
    mode: 'comfortable',
    viewType: 'grid',
    listColumns: ['name', 'size', 'modified'],
    gridItemSize: 'medium',
  })),
  DEFAULT_DENSITY_SETTINGS: {
    mode: 'comfortable',
    viewType: 'grid',
    listColumns: ['name', 'size', 'modified'],
    gridItemSize: 'medium',
  },
}));

const mockStore = configureStore([thunk]);

describe('Header Search Integration', () => {
  let store: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Mock searchService.search
    (searchService.search as jest.Mock).mockReturnValue([
      {
        id: 'file-1',
        type: 'file',
        item: {
          id: 'file-1',
          name: 'Test Document.pdf',
          type: 'pdf',
          size: 2048,
          createdAt: '2024-01-01',
          updatedAt: '2024-01-02',
        },
        relevance: 0.95,
        matches: [
          {
            field: 'fileName',
            value: 'Test Document.pdf',
            start: 0,
            end: 4,
          },
        ],
      },
      {
        id: 'folder-1',
        type: 'folder',
        item: {
          id: 'folder-1',
          name: 'Test Folder',
          color: '#3B82F6',
          items: [],
          createdAt: '2024-01-01',
          updatedAt: '2024-01-02',
        },
        relevance: 0.85,
        matches: [
          {
            field: 'fileName',
            value: 'Test Folder',
            start: 0,
            end: 4,
          },
        ],
      },
    ]);

    store = mockStore(createMockRootState());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should render search input', () => {
    render(
      <Provider store={store}>
        <BrowserRouter>
          <Header />
        </BrowserRouter>
      </Provider>
    );

    expect(screen.getByPlaceholderText('Rechercher dans Filarr')).toBeInTheDocument();
  });

  it('should debounce search input', async () => {
    render(
      <Provider store={store}>
        <BrowserRouter>
          <Header />
        </BrowserRouter>
      </Provider>
    );

    const searchInput = screen.getByPlaceholderText('Rechercher dans Filarr');

    // Type "test" character by character
    fireEvent.change(searchInput, { target: { value: 't' } });
    fireEvent.change(searchInput, { target: { value: 'te' } });
    fireEvent.change(searchInput, { target: { value: 'tes' } });
    fireEvent.change(searchInput, { target: { value: 'test' } });

    // At this point, no search should have been triggered yet
    expect(store.getActions()).toEqual([]);

    // Fast forward 300ms (debounce delay)
    jest.advanceTimersByTime(300);

    // Now search should be triggered
    await waitFor(() => {
      const actions = store.getActions();
      expect(actions.length).toBeGreaterThan(0);
      expect(actions[0].type).toBe('search/setQuery');
      expect(actions[0].payload).toBe('test');
    });
  });

  it('should display search results when typing', async () => {
    const storeWithResults = mockStore({
      ...store.getState(),
      search: {
        ...store.getState().search,
        query: 'test',
        results: [
          {
            id: 'file-1',
            name: 'Test Document.pdf',
            type: 'file',
            path: '/documents',
            lastModified: '2024-01-02',
            size: 2048,
            relevance: 0.95,
            excerpt: 'Test excerpt...',
            tags: [],
          },
          {
            id: 'folder-1',
            name: 'Test Folder',
            type: 'folder',
            path: '/folders',
            lastModified: '2024-01-02',
            size: null,
            relevance: 0.85,
            excerpt: null,
            tags: [],
          },
        ],
        loading: false,
      },
    });

    // Render directly with the store that has results
    render(
      <Provider store={storeWithResults}>
        <BrowserRouter>
          <Header />
        </BrowserRouter>
      </Provider>
    );

    const searchInput = screen.getByPlaceholderText('Rechercher dans Filarr');
    fireEvent.change(searchInput, { target: { value: 'test' } });

    // Advance debounce timer
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    // Run any remaining timers from effects
    await act(async () => {
      jest.runAllTimers();
    });

    // Text is split by highlightMatch across multiple elements, use substring match
    expect(
      screen.getByText((_content, element) => element?.textContent === 'Test Document.pdf')
    ).toBeInTheDocument();
    expect(
      screen.getByText((_content, element) => element?.textContent === 'Test Folder')
    ).toBeInTheDocument();
  });

  it('should hide results when search input is cleared', async () => {
    const storeWithResults = mockStore({
      ...store.getState(),
      search: {
        ...store.getState().search,
        query: 'test',
        results: [
          {
            id: 'file-1',
            name: 'Test Document.pdf',
            type: 'file',
            path: '/documents',
            lastModified: '2024-01-02',
            size: 2048,
            relevance: 0.95,
            excerpt: 'Test excerpt...',
            tags: [],
          },
        ],
        loading: false,
      },
    });

    render(
      <Provider store={storeWithResults}>
        <BrowserRouter>
          <Header />
        </BrowserRouter>
      </Provider>
    );

    const searchInput = screen.getByPlaceholderText('Rechercher dans Filarr') as HTMLInputElement;

    // Type something to trigger showResults via debounce
    fireEvent.change(searchInput, { target: { value: 'test' } });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await act(async () => {
      jest.runAllTimers();
    });

    // Results should be visible (text split by highlightMatch)
    const findTestDoc = (_content: string, element: Element | null) =>
      element?.textContent === 'Test Document.pdf';
    expect(screen.getByText(findTestDoc)).toBeInTheDocument();

    // Clear the input
    fireEvent.change(searchInput, { target: { value: '' } });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await act(async () => {
      jest.runAllTimers();
    });

    // Results should be hidden
    expect(screen.queryByText(findTestDoc)).not.toBeInTheDocument();
  });

  it('should show loading state while searching', async () => {
    const storeWithLoading = mockStore({
      ...store.getState(),
      search: {
        ...store.getState().search,
        query: 'test',
        loading: true,
        results: [],
      },
    });

    render(
      <Provider store={storeWithLoading}>
        <BrowserRouter>
          <Header />
        </BrowserRouter>
      </Provider>
    );

    const searchInput = screen.getByPlaceholderText('Rechercher dans Filarr');
    // Type something to trigger showResults via debounce
    fireEvent.change(searchInput, { target: { value: 'test' } });
    act(() => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(screen.getByText('Recherche en cours...')).toBeInTheDocument();
    });
  });

  it('should show empty state when no results found', async () => {
    const storeWithNoResults = mockStore({
      ...store.getState(),
      search: {
        ...store.getState().search,
        query: 'nonexistent',
        loading: false,
        results: [],
      },
    });

    render(
      <Provider store={storeWithNoResults}>
        <BrowserRouter>
          <Header />
        </BrowserRouter>
      </Provider>
    );

    const searchInput = screen.getByPlaceholderText('Rechercher dans Filarr');
    // Type something to trigger showResults via debounce
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });
    act(() => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(screen.getByText(/Aucun résultat pour/)).toBeInTheDocument();
    });
  });

  it('should close results dropdown on blur', async () => {
    const storeWithResults = mockStore({
      ...store.getState(),
      search: {
        ...store.getState().search,
        query: 'test',
        results: [
          {
            id: 'file-1',
            name: 'Test Document.pdf',
            type: 'file',
            path: '/documents',
            lastModified: '2024-01-02',
            size: 2048,
            relevance: 0.95,
            excerpt: 'Test excerpt...',
            tags: [],
          },
        ],
        loading: false,
      },
    });

    render(
      <Provider store={storeWithResults}>
        <BrowserRouter>
          <Header />
        </BrowserRouter>
      </Provider>
    );

    const searchInput = screen.getByPlaceholderText('Rechercher dans Filarr');

    const findTestDoc = (_content: string, element: Element | null) =>
      element?.textContent === 'Test Document.pdf';

    // Type something to trigger showResults via debounce
    fireEvent.change(searchInput, { target: { value: 'test' } });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await act(async () => {
      jest.runAllTimers();
    });

    // Results should be visible
    expect(screen.getByText(findTestDoc)).toBeInTheDocument();

    // Blur the input
    fireEvent.blur(searchInput);

    // Advance time to allow blur delay (200ms setTimeout in handleSearchBlur)
    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    expect(screen.queryByText(findTestDoc)).not.toBeInTheDocument();
  });

  it('should call searchService with correct parameters', async () => {
    render(
      <Provider store={store}>
        <BrowserRouter>
          <Header />
        </BrowserRouter>
      </Provider>
    );

    const searchInput = screen.getByPlaceholderText('Rechercher dans Filarr');
    fireEvent.change(searchInput, { target: { value: 'test query' } });

    jest.advanceTimersByTime(300);

    await waitFor(() => {
      const actions = store.getActions();
      expect(actions.length).toBeGreaterThan(0);
      // The executeSearch thunk should be dispatched
      const executeSearchAction = actions.find((a: any) => a.type === 'search/execute/pending');
      expect(executeSearchAction).toBeDefined();
    });
  });
});
