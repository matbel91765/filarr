/**
 * EpubPreview Component
 *
 * In-app paginated EPUB reader. The .epub archive is parsed and rendered entirely
 * in the renderer via epub.js (dynamically imported so its JSZip-backed bundle stays
 * out of the main chunk — no bytes leave the device, matching the offline/E2EE stance).
 * Provides Prev/Next pagination, a font-size control and a table-of-contents dropdown.
 * Reading location is intentionally not persisted.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import clsx from 'clsx';
import type { Book, Rendition, NavItem } from 'epubjs';
import { Button } from '../ui/Button/Button';
import { Dropdown, type DropdownItem } from '../ui/Dropdown';
import './MarkdownPreview.css';

export interface EpubPreviewProps {
  /** EPUB data as ArrayBuffer */
  data: ArrayBuffer;
  /** File name */
  fileName: string;
  /** File extension (epub) */
  extension?: string;
  /** Additional CSS class */
  className?: string;
}

const MIN_FONT = 70;
const MAX_FONT = 200;
const FONT_STEP = 10;

const ChevronLeftIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="18"
    height="18"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
  </svg>
);

const ChevronRightIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="18"
    height="18"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
  </svg>
);

const readerStyle: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
};

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  background: 'var(--color-bg-primary, #ffffff)',
};

export const EpubPreview: React.FC<EpubPreviewProps> = ({ data, fileName, className }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toc, setToc] = useState<NavItem[]>([]);
  const [fontSize, setFontSize] = useState(100);

  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setToc([]);

    (async () => {
      try {
        const ePub = (await import('epubjs')).default;
        if (cancelled) return;

        const containerEl = containerRef.current;
        if (!containerEl) throw new Error('Conteneur de lecture indisponible');

        // epub.js reads the buffer via JSZip; hand it a copy so we never disturb
        // the shared preview buffer.
        const book = ePub(data.slice(0));
        bookRef.current = book;

        const rendition = book.renderTo(containerEl, {
          width: '100%',
          height: '100%',
          spread: 'none',
        });
        renditionRef.current = rendition;
        rendition.themes.fontSize(`${fontSize}%`);

        await rendition.display();
        if (cancelled) {
          rendition.destroy();
          book.destroy();
          return;
        }
        setIsLoading(false);

        // Table of contents (best-effort — a missing nav shouldn't break the reader).
        book.loaded.navigation
          .then((nav) => {
            if (!cancelled) setToc(nav.toc ?? []);
          })
          .catch(() => {
            /* no navigation document */
          });
      } catch (err) {
        if (cancelled) return;
        console.error('[EpubPreview] Failed to open EPUB:', err);
        setError(err instanceof Error ? err.message : 'Lecture impossible');
        setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      try {
        renditionRef.current?.destroy();
      } catch {
        /* ignore */
      }
      try {
        bookRef.current?.destroy();
      } catch {
        /* ignore */
      }
      renditionRef.current = null;
      bookRef.current = null;
    };
    // NOTE: fontSize is intentionally excluded from deps — it is applied
    // imperatively below without re-opening the book. (No eslint-disable for
    // react-hooks/exhaustive-deps: that rule isn't registered in this CRA config
    // and referencing it breaks the build.)
  }, [data]);

  const goPrev = useCallback(() => {
    renditionRef.current?.prev();
  }, []);

  const goNext = useCallback(() => {
    renditionRef.current?.next();
  }, []);

  const changeFont = useCallback((delta: number) => {
    setFontSize((prev) => {
      const next = Math.min(MAX_FONT, Math.max(MIN_FONT, prev + delta));
      renditionRef.current?.themes.fontSize(`${next}%`);
      return next;
    });
  }, []);

  const tocItems: DropdownItem[] = toc.map((item) => ({
    label: item.label.trim() || '(sans titre)',
    onClick: () => {
      renditionRef.current?.display(item.href);
    },
  }));

  const ready = !isLoading && !error;
  const containerClasses = clsx('markdown-preview', className);

  return (
    <div className={containerClasses}>
      <div className="markdown-preview__toolbar">
        <div className="markdown-preview__toolbar-left">
          <span className="markdown-preview__badge">EPUB</span>
          <span className="markdown-preview__stats" title={fileName}>
            {fileName}
          </span>
        </div>
        <div className="markdown-preview__toolbar-right">
          {tocItems.length > 0 && (
            <Dropdown
              trigger={
                <Button variant="ghost" size="sm" disabled={!ready} title="Sommaire">
                  Sommaire
                </Button>
              }
              items={tocItems}
              position="bottom-right"
              disabled={!ready}
            />
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => changeFont(-FONT_STEP)}
            disabled={!ready || fontSize <= MIN_FONT}
            title="Réduire la taille du texte"
            aria-label="Réduire la taille du texte"
          >
            A−
          </Button>
          <span className="markdown-preview__stats" style={{ minWidth: 42, textAlign: 'center' }}>
            {fontSize}%
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => changeFont(FONT_STEP)}
            disabled={!ready || fontSize >= MAX_FONT}
            title="Augmenter la taille du texte"
            aria-label="Augmenter la taille du texte"
          >
            A+
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={goPrev}
            disabled={!ready}
            title="Page précédente"
            aria-label="Page précédente"
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={goNext}
            disabled={!ready}
            title="Page suivante"
            aria-label="Page suivante"
          >
            <ChevronRightIcon />
          </Button>
        </div>
      </div>

      <div className="markdown-preview__container">
        {error ? (
          <div className="file-preview-panel__error">
            <span>Impossible d'afficher ce livre</span>
            <p className="file-preview-panel__error-message">{error}</p>
          </div>
        ) : (
          <div style={readerStyle}>
            <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
            {isLoading && (
              <div className="file-preview-panel__loading" style={overlayStyle}>
                <div className="file-preview-panel__spinner" />
                <span>Ouverture du livre…</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default EpubPreview;
