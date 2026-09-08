/**
 * SearchResults Component
 *
 * Dropdown component that displays search results below the search input.
 * Supports files, folders, notes, and settings results.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../../../../store';
import type { SearchResult } from '../../../../store/slices/searchSlice';
import { setEditingNote } from '../../../../store/slices/notesSlice';
import './SearchResults.css';

export interface SearchResultsProps {
  results: SearchResult[];
  loading: boolean;
  query: string;
  onResultClick?: () => void;
}

const NoteIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
    />
  </svg>
);

const SettingsIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
    />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const FolderIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24">
    <path d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
  </svg>
);

const FileIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
    />
  </svg>
);

function getResultIcon(type: SearchResult['type']) {
  switch (type) {
    case 'folder':
      return <FolderIcon />;
    case 'note':
      return <NoteIcon />;
    case 'setting':
      return <SettingsIcon />;
    default:
      return <FileIcon />;
  }
}

function getTypeLabel(type: SearchResult['type']): string {
  switch (type) {
    case 'folder':
      return 'Dossier';
    case 'note':
      return 'Note';
    case 'setting':
      return 'Parametre';
    case 'vault-item':
      return 'Coffre partagé';
    default:
      return 'Fichier';
  }
}

export const SearchResults: React.FC<SearchResultsProps> = ({
  results,
  loading,
  query,
  onResultClick,
}) => {
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();

  const handleResultClick = (result: SearchResult) => {
    if (result.type === 'note') {
      dispatch(setEditingNote(result.id));
      navigate('/notes');
    } else if (result.route) {
      navigate(result.route);
    } else if (result.type === 'folder') {
      navigate(`/folder/${result.id}`);
    } else {
      navigate(`/folder/${result.id.split('-')[0]}`);
    }
    onResultClick?.();
  };

  const formatFileSize = (bytes: number | null): string => {
    if (bytes === null) return '';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const formatDate = (dateString: string): string => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Aujourd'hui";
    if (diffDays === 1) return 'Hier';
    if (diffDays < 7) return `Il y a ${diffDays} jours`;
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const highlightMatch = (text: string, q: string): React.ReactNode => {
    if (!q.trim()) return text;
    try {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
      return parts.map((part, index) =>
        part.toLowerCase() === q.toLowerCase() ? (
          <mark key={index} className="search-results__highlight">
            {part}
          </mark>
        ) : (
          part
        )
      );
    } catch {
      return text;
    }
  };

  return (
    <div className="search-results">
      {loading ? (
        <div className="search-results__loading">
          <div className="search-results__spinner" />
          <span>Recherche en cours...</span>
        </div>
      ) : results.length === 0 ? (
        <div className="search-results__empty">
          <svg
            className="search-results__empty-icon"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
          <p className="search-results__empty-text">Aucun resultat pour "{query}"</p>
          <p className="search-results__empty-hint">Essayez d'autres mots-cles</p>
        </div>
      ) : (
        <>
          <div className="search-results__header">
            <span className="search-results__count">
              {results.length} resultat{results.length > 1 ? 's' : ''}
            </span>
          </div>
          <div className="search-results__list">
            {results.map((result) => (
              <button
                key={result.id}
                className="search-results__item"
                onClick={() => handleResultClick(result)}
                type="button"
              >
                <div className="search-results__item-icon">{getResultIcon(result.type)}</div>
                <div className="search-results__item-content">
                  <div className="search-results__item-name">
                    {highlightMatch(result.name, query)}
                  </div>
                  {result.excerpt && (
                    <div className="search-results__item-excerpt">
                      {highlightMatch(result.excerpt, query)}
                    </div>
                  )}
                  <div className="search-results__item-meta">
                    <span
                      className="search-results__item-tag"
                      style={{ padding: '0 6px', fontSize: 10 }}
                    >
                      {getTypeLabel(result.type)}
                    </span>
                    {result.path && (
                      <>
                        <span className="search-results__item-separator">·</span>
                        <span className="search-results__item-path">{result.path}</span>
                      </>
                    )}
                    {result.size !== null && (
                      <>
                        <span className="search-results__item-separator">·</span>
                        <span className="search-results__item-size">
                          {formatFileSize(result.size)}
                        </span>
                      </>
                    )}
                    {result.lastModified && (
                      <>
                        <span className="search-results__item-separator">·</span>
                        <span className="search-results__item-date">
                          {formatDate(result.lastModified)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default SearchResults;
