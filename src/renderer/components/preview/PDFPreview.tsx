/**
 * PDFPreview Component
 *
 * PDF viewer with page navigation using pdfjs-dist.
 * Supports zoom, page navigation, and fullscreen mode.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import clsx from 'clsx';
import { Button } from '../ui/Button/Button';
import { Input } from '../ui/Input/Input';
import * as pdfjsLib from 'pdfjs-dist';
import './FilePreviewPanel.css';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export interface PDFPreviewProps {
  /** PDF data as ArrayBuffer */
  data: ArrayBuffer;
  /** File name */
  fileName: string;
  /** Additional CSS class */
  className?: string;
}

// SVG Icons
const ChevronLeftIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="18" height="18">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
  </svg>
);

const ChevronRightIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="18" height="18">
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
  </svg>
);

const ZoomInIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="18" height="18">
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM10.5 7.5v6m3-3h-6" />
  </svg>
);

const ZoomOutIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="18" height="18">
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM13.5 10.5h-6" />
  </svg>
);

const FitWidthIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="18" height="18">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v16.5h16.5M3.75 3.75h16.5M3.75 3.75L20.25 20.25" />
  </svg>
);

const FitPageIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="18" height="18">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9m10.5-5.25v4.5m0-4.5h-4.5m4.5 0L15 9m-10.5 10.5v-4.5m0 4.5h4.5m-4.5 0L9 15m10.5 5.25v-4.5m0 4.5h-4.5m4.5 0L15 15" />
  </svg>
);

const ThumbnailsIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="18" height="18">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
  </svg>
);

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const SCALE_STEP = 0.25;

type PDFDocumentProxy = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>;
type PDFPageProxy = Awaited<ReturnType<PDFDocumentProxy['getPage']>>;

export const PDFPreview: React.FC<PDFPreviewProps> = ({
  data,
  fileName,
  className,
}) => {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageInputValue, setPageInputValue] = useState('1');
  const [renderTask, setRenderTask] = useState<ReturnType<PDFPageProxy['render']> | null>(null);
  const [showThumbnails, setShowThumbnails] = useState(false);
  const [thumbnails, setThumbnails] = useState<{ page: number; dataUrl: string }[]>([]);
  const [isLoadingThumbnails, setIsLoadingThumbnails] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const thumbnailsRef = useRef<HTMLDivElement>(null);

  // Load PDF document
  useEffect(() => {
    let cancelled = false;

    const loadPDF = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const loadingTask = pdfjsLib.getDocument({ data });
        const pdf = await loadingTask.promise;

        if (cancelled) return;

        setPdfDoc(pdf);
        setTotalPages(pdf.numPages);
        setCurrentPage(1);
        setPageInputValue('1');
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        if (cancelled) return;
        console.error('[PDFPreview] Error loading PDF:', err);
        setError(errMsg || 'Failed to load PDF');
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadPDF();

    return () => {
      cancelled = true;
    };
  }, [data]);

  // Render current page
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    let cancelled = false;

    const renderPage = async () => {
      try {
        // Cancel any ongoing render task
        if (renderTask) {
          renderTask.cancel();
        }

        const page = await pdfDoc.getPage(currentPage);

        if (cancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        if (!context) return;

        // Calculate viewport with scale
        const viewport = page.getViewport({ scale });

        // Set canvas dimensions
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        // Render the page
        const task = page.render({
          canvasContext: context,
          viewport,
        });

        setRenderTask(task);

        await task.promise;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        if ((err instanceof Error ? err.name : "") === 'RenderingCancelledException') return;
        console.error('[PDFPreview] Error rendering page:', err);
      }
    };

    renderPage();

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, currentPage, scale]);

  // Auto-fit to container width on initial load
  useEffect(() => {
    if (!pdfDoc || !containerRef.current) return;

    const fitToWidth = async () => {
      const page = await pdfDoc.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      const containerWidth = containerRef.current?.clientWidth || 800;
      const padding = 40; // Account for padding
      const newScale = (containerWidth - padding) / viewport.width;
      setScale(Math.min(newScale, 1.5));
    };

    fitToWidth();
  }, [pdfDoc]);

  // Navigation handlers
  const goToPage = useCallback((page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
      setPageInputValue(page.toString());
    }
  }, [totalPages]);

  const handlePrevPage = useCallback(() => {
    goToPage(currentPage - 1);
  }, [currentPage, goToPage]);

  const handleNextPage = useCallback(() => {
    goToPage(currentPage + 1);
  }, [currentPage, goToPage]);

  const handlePageInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setPageInputValue(e.target.value);
  }, []);

  const handlePageInputBlur = useCallback(() => {
    const page = parseInt(pageInputValue, 10);
    if (!isNaN(page)) {
      goToPage(page);
    } else {
      setPageInputValue(currentPage.toString());
    }
  }, [pageInputValue, currentPage, goToPage]);

  const handlePageInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handlePageInputBlur();
    }
  }, [handlePageInputBlur]);

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    setScale(prev => Math.min(prev + SCALE_STEP, MAX_SCALE));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale(prev => Math.max(prev - SCALE_STEP, MIN_SCALE));
  }, []);

  const handleFitWidth = useCallback(async () => {
    if (!pdfDoc || !containerRef.current) return;

    const page = await pdfDoc.getPage(currentPage);
    const viewport = page.getViewport({ scale: 1 });
    const containerWidth = containerRef.current.clientWidth;
    const padding = 40;
    const newScale = (containerWidth - padding) / viewport.width;
    setScale(newScale);
  }, [pdfDoc, currentPage]);

  const handleFitPage = useCallback(async () => {
    if (!pdfDoc || !containerRef.current) return;

    const page = await pdfDoc.getPage(currentPage);
    const viewport = page.getViewport({ scale: 1 });
    const containerWidth = containerRef.current.clientWidth;
    const containerHeight = containerRef.current.clientHeight;
    const padding = 40;

    const scaleX = (containerWidth - padding) / viewport.width;
    const scaleY = (containerHeight - padding) / viewport.height;
    const newScale = Math.min(scaleX, scaleY);
    setScale(newScale);
  }, [pdfDoc, currentPage]);

  // Toggle thumbnail sidebar
  const handleToggleThumbnails = useCallback(() => {
    setShowThumbnails(prev => !prev);
  }, []);

  // Generate thumbnails
  useEffect(() => {
    if (!pdfDoc || !showThumbnails || thumbnails.length > 0) return;

    let cancelled = false;

    const generateThumbnails = async () => {
      setIsLoadingThumbnails(true);
      const thumbs: { page: number; dataUrl: string }[] = [];
      const thumbnailScale = 0.2; // Small scale for thumbnails

      for (let i = 1; i <= pdfDoc.numPages; i++) {
        if (cancelled) break;

        try {
          const page = await pdfDoc.getPage(i);
          const viewport = page.getViewport({ scale: thumbnailScale });

          // Create offscreen canvas
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          if (!context) continue;

          canvas.width = viewport.width;
          canvas.height = viewport.height;

          await page.render({
            canvasContext: context,
            viewport,
          }).promise;

          thumbs.push({
            page: i,
            dataUrl: canvas.toDataURL('image/jpeg', 0.7),
          });
        } catch (err) {
          console.error(`[PDFPreview] Error generating thumbnail for page ${i}:`, err);
        }
      }

      if (!cancelled) {
        setThumbnails(thumbs);
        setIsLoadingThumbnails(false);
      }
    };

    generateThumbnails();

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, showThumbnails, thumbnails.length]);

  // Scroll thumbnail into view when page changes
  useEffect(() => {
    if (!showThumbnails || !thumbnailsRef.current) return;

    const thumbnailElement = thumbnailsRef.current.querySelector(
      `[data-page="${currentPage}"]`
    );
    if (thumbnailElement) {
      thumbnailElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [currentPage, showThumbnails]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        handlePrevPage();
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        handleNextPage();
      } else if (e.key === 'Home') {
        e.preventDefault();
        goToPage(1);
      } else if (e.key === 'End') {
        e.preventDefault();
        goToPage(totalPages);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        handleZoomIn();
      } else if (e.key === '-') {
        e.preventDefault();
        handleZoomOut();
      } else if (e.key === 't' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        handleToggleThumbnails();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePrevPage, handleNextPage, goToPage, totalPages, handleZoomIn, handleZoomOut, handleToggleThumbnails]);

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (e.deltaY < 0) {
        handleZoomIn();
      } else {
        handleZoomOut();
      }
    }
  }, [handleZoomIn, handleZoomOut]);

  const containerClasses = clsx('pdf-preview', className);

  if (isLoading) {
    return (
      <div className={containerClasses}>
        <div className="pdf-preview__loading">
          <div className="pdf-preview__spinner" />
          <span>Chargement du PDF...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={containerClasses}>
        <div className="pdf-preview__error">
          <span>Impossible de charger le PDF</span>
          <p className="pdf-preview__error-message">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={containerClasses}>
      {/* Toolbar */}
      <div className="pdf-preview__toolbar">
        {/* Page Navigation */}
        <div className="pdf-preview__toolbar-group">
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePrevPage}
            disabled={currentPage <= 1}
            title="Page precedente (Gauche)"
            aria-label="Page precedente"
          >
            <ChevronLeftIcon />
          </Button>
          <div className="pdf-preview__page-input-wrapper">
            <input
              type="text"
              value={pageInputValue}
              onChange={handlePageInputChange}
              onBlur={handlePageInputBlur}
              onKeyDown={handlePageInputKeyDown}
              className="pdf-preview__page-input"
              aria-label="Numero de page"
            />
            <span className="pdf-preview__page-separator">/</span>
            <span className="pdf-preview__page-total">{totalPages}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNextPage}
            disabled={currentPage >= totalPages}
            title="Page suivante (Droite)"
            aria-label="Page suivante"
          >
            <ChevronRightIcon />
          </Button>
        </div>

        <div className="pdf-preview__toolbar-divider" />

        {/* Zoom Controls */}
        <div className="pdf-preview__toolbar-group">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleZoomOut}
            disabled={scale <= MIN_SCALE}
            title="Zoom arriere (-)"
            aria-label="Zoom arriere"
          >
            <ZoomOutIcon />
          </Button>
          <span className="pdf-preview__zoom-value">{Math.round(scale * 100)}%</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleZoomIn}
            disabled={scale >= MAX_SCALE}
            title="Zoom avant (+)"
            aria-label="Zoom avant"
          >
            <ZoomInIcon />
          </Button>
        </div>

        <div className="pdf-preview__toolbar-divider" />

        {/* Fit Controls */}
        <div className="pdf-preview__toolbar-group">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleFitWidth}
            title="Ajuster a la largeur"
            aria-label="Ajuster a la largeur"
          >
            <FitWidthIcon />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleFitPage}
            title="Ajuster a la page"
            aria-label="Ajuster a la page"
          >
            <FitPageIcon />
          </Button>
        </div>

        <div className="pdf-preview__toolbar-divider" />

        {/* Thumbnails Toggle */}
        <div className="pdf-preview__toolbar-group">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleThumbnails}
            title={showThumbnails ? 'Masquer les miniatures (T)' : 'Afficher les miniatures (T)'}
            aria-label={showThumbnails ? 'Masquer les miniatures' : 'Afficher les miniatures'}
            className={clsx({ 'pdf-preview__btn--active': showThumbnails })}
          >
            <ThumbnailsIcon />
          </Button>
        </div>
      </div>

      {/* Content Wrapper */}
      <div className="pdf-preview__content-wrapper">
        {/* Thumbnails Sidebar */}
        {showThumbnails && (
          <div className="pdf-preview__thumbnails" ref={thumbnailsRef}>
            {isLoadingThumbnails ? (
              <div className="pdf-preview__thumbnails-loading">
                <div className="pdf-preview__spinner" />
                <span>Chargement...</span>
              </div>
            ) : (
              thumbnails.map((thumb) => (
                <button
                  key={thumb.page}
                  data-page={thumb.page}
                  className={clsx('pdf-preview__thumbnail', {
                    'pdf-preview__thumbnail--active': currentPage === thumb.page,
                  })}
                  onClick={() => goToPage(thumb.page)}
                  title={`Page ${thumb.page}`}
                >
                  <img
                    src={thumb.dataUrl}
                    alt={`Page ${thumb.page}`}
                    className="pdf-preview__thumbnail-image"
                  />
                  <span className="pdf-preview__thumbnail-label">{thumb.page}</span>
                </button>
              ))
            )}
          </div>
        )}

        {/* Canvas Container */}
        <div
          ref={containerRef}
          className="pdf-preview__container"
          onWheel={handleWheel}
        >
          <canvas ref={canvasRef} className="pdf-preview__canvas" />
        </div>
      </div>

      {/* Page indicator (mobile-friendly) */}
      <div className="pdf-preview__page-indicator">
        Page {currentPage} sur {totalPages}
      </div>
    </div>
  );
};

export default PDFPreview;
