/**
 * TextPreview Component
 *
 * Text and code preview with syntax highlighting using highlight.js.
 * Supports various programming languages and text formats.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import clsx from 'clsx';
import { Button } from '../ui/Button/Button';
import './FilePreviewPanel.css';

// La table de langages et l'enregistrement hljs sont PARTAGÉS avec l'éditeur
// de code : deux copies divergeraient au premier langage ajouté d'un seul côté.
import { EXTENSION_LANGUAGE_MAP, hljs } from '../../../utils/syntaxHighlight';

export interface TextPreviewProps {
  /** Text data as ArrayBuffer */
  data: ArrayBuffer;
  /** File name */
  fileName: string;
  /** File extension (for syntax highlighting) */
  extension: string;
  /** Additional CSS class */
  className?: string;
}

// SVG Icons
const WrapIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="18"
    height="18"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
    />
  </svg>
);

const LineNumbersIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="18"
    height="18"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
    />
  </svg>
);

const CopyIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="18"
    height="18"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75"
    />
  </svg>
);

const CheckIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="18"
    height="18"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

const SearchIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="18"
    height="18"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
    />
  </svg>
);

export const TextPreview: React.FC<TextPreviewProps> = ({
  data,
  fileName,
  extension,
  className,
}) => {
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [wordWrap, setWordWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0);

  const codeRef = useRef<HTMLPreElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Decode ArrayBuffer to string
  const content = useMemo(() => {
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(data);
  }, [data]);

  // Get language for syntax highlighting
  const language = useMemo(() => {
    const ext = extension.toLowerCase();
    return EXTENSION_LANGUAGE_MAP[ext] || 'plaintext';
  }, [extension]);

  // Split content into lines
  const lines = useMemo(() => {
    return content.split('\n');
  }, [content]);

  // Apply syntax highlighting
  const highlightedContent = useMemo(() => {
    try {
      if (language === 'plaintext') {
        return escapeHtml(content);
      }
      const result = hljs.highlight(content, { language });
      return result.value;
    } catch (err) {
      console.warn('[TextPreview] Syntax highlighting failed:', err);
      return escapeHtml(content);
    }
  }, [content, language]);

  // Escape HTML special characters
  function escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  // Copy to clipboard
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[TextPreview] Failed to copy:', err);
    }
  }, [content]);

  // Toggle search
  const toggleSearch = useCallback(() => {
    setShowSearch((prev) => {
      if (!prev) {
        setTimeout(() => searchInputRef.current?.focus(), 100);
      }
      return !prev;
    });
    setSearchQuery('');
    setSearchResults([]);
  }, []);

  // Search functionality
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }

    const results: number[] = [];
    const lowerQuery = searchQuery.toLowerCase();

    lines.forEach((line, index) => {
      if (line.toLowerCase().includes(lowerQuery)) {
        results.push(index);
      }
    });

    setSearchResults(results);
    setCurrentSearchIndex(0);
  }, [searchQuery, lines]);

  // Navigate to search result
  useEffect(() => {
    if (searchResults.length === 0 || !codeRef.current) return;

    const lineNumber = searchResults[currentSearchIndex];
    const lineElement = codeRef.current.querySelector(`[data-line="${lineNumber}"]`);
    if (lineElement) {
      lineElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentSearchIndex, searchResults]);

  // Navigate search results
  const goToNextResult = useCallback(() => {
    if (searchResults.length === 0) return;
    setCurrentSearchIndex((prev) => (prev + 1) % searchResults.length);
  }, [searchResults.length]);

  const goToPrevResult = useCallback(() => {
    if (searchResults.length === 0) return;
    setCurrentSearchIndex((prev) => (prev - 1 + searchResults.length) % searchResults.length);
  }, [searchResults.length]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        toggleSearch();
      } else if (e.key === 'Escape' && showSearch) {
        setShowSearch(false);
        setSearchQuery('');
      } else if (e.key === 'Enter' && showSearch) {
        e.preventDefault();
        if (e.shiftKey) {
          goToPrevResult();
        } else {
          goToNextResult();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSearch, toggleSearch, goToNextResult, goToPrevResult]);

  // Render lines with line numbers
  const renderContent = useMemo(() => {
    const highlightedLines = highlightedContent.split('\n');

    return highlightedLines.map((line, index) => {
      const isSearchResult = searchResults.includes(index);
      const isCurrentResult = searchResults[currentSearchIndex] === index;

      return (
        <div
          key={index}
          data-line={index}
          className={clsx('text-preview__line', {
            'text-preview__line--search-result': isSearchResult,
            'text-preview__line--current-result': isCurrentResult,
          })}
        >
          {showLineNumbers && <span className="text-preview__line-number">{index + 1}</span>}
          <span
            className="text-preview__line-content"
            dangerouslySetInnerHTML={{ __html: line || '&nbsp;' }}
          />
        </div>
      );
    });
  }, [highlightedContent, showLineNumbers, searchResults, currentSearchIndex]);

  const containerClasses = clsx(
    'text-preview',
    {
      'text-preview--wrap': wordWrap,
      'text-preview--no-line-numbers': !showLineNumbers,
    },
    className
  );

  return (
    <div className={containerClasses}>
      {/* Toolbar */}
      <div className="text-preview__toolbar">
        <div className="text-preview__toolbar-left">
          <span className="text-preview__language-badge">{language}</span>
          <span className="text-preview__line-count">{lines.length} lignes</span>
        </div>

        <div className="text-preview__toolbar-right">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleSearch}
            title="Rechercher (Ctrl+F)"
            aria-label="Rechercher"
            className={clsx({ 'text-preview__btn--active': showSearch })}
          >
            <SearchIcon />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowLineNumbers(!showLineNumbers)}
            title="Afficher les numeros de ligne"
            aria-label="Afficher les numeros de ligne"
            className={clsx({ 'text-preview__btn--active': showLineNumbers })}
          >
            <LineNumbersIcon />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setWordWrap(!wordWrap)}
            title="Retour a la ligne automatique"
            aria-label="Retour a la ligne automatique"
            className={clsx({ 'text-preview__btn--active': wordWrap })}
          >
            <WrapIcon />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            title={copied ? 'Copie!' : 'Copier le contenu'}
            aria-label="Copier"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
        </div>
      </div>

      {/* Search Bar */}
      {showSearch && (
        <div className="text-preview__search">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher..."
            className="text-preview__search-input"
          />
          {searchResults.length > 0 && (
            <span className="text-preview__search-results">
              {currentSearchIndex + 1} / {searchResults.length}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={goToPrevResult}
            disabled={searchResults.length === 0}
            title="Resultat precedent (Shift+Entree)"
            aria-label="Resultat precedent"
          >
            <span style={{ transform: 'rotate(90deg)', display: 'inline-block' }}>{'<'}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={goToNextResult}
            disabled={searchResults.length === 0}
            title="Resultat suivant (Entree)"
            aria-label="Resultat suivant"
          >
            <span style={{ transform: 'rotate(90deg)', display: 'inline-block' }}>{'>'}</span>
          </Button>
        </div>
      )}

      {/* Code Container */}
      <div className="text-preview__container">
        <pre ref={codeRef} className="text-preview__code">
          {renderContent}
        </pre>
      </div>
    </div>
  );
};

export default TextPreview;
