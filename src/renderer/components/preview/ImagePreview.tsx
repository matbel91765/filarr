/**
 * ImagePreview Component
 *
 * Image viewer with zoom, pan, and rotate capabilities.
 * Supports all common image formats: jpg, png, gif, webp, bmp, svg.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import clsx from 'clsx';
import { Button } from '../ui/Button/Button';
import './FilePreviewPanel.css';

export interface ImagePreviewProps {
  /** Image data as ArrayBuffer */
  data: ArrayBuffer;
  /** File name */
  fileName: string;
  /** MIME type of the image */
  mimeType: string;
  /** Callback when image dimensions are loaded */
  onLoad?: (dimensions: { width: number; height: number }) => void;
  /** Additional CSS class */
  className?: string;
}

// SVG Icons
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

const ZoomResetIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="18" height="18">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M15 9h4.5M15 9V4.5M15 9l5.25-5.25M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
  </svg>
);

const RotateLeftIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="18" height="18">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
  </svg>
);

const RotateRightIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="18" height="18">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3" />
  </svg>
);

const FitScreenIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="18" height="18">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9m10.5-5.25v4.5m0-4.5h-4.5m4.5 0L15 9m-10.5 10.5v-4.5m0 4.5h4.5m-4.5 0L9 15m10.5 5.25v-4.5m0 4.5h-4.5m4.5 0L15 15" />
  </svg>
);

const FitWidthIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="18" height="18">
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" />
  </svg>
);

const FitHeightIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="18" height="18">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 8.25L18.75 12 15 15.75m-6-7.5L5.25 12 9 15.75" />
  </svg>
);

const FullscreenIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="18" height="18">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9m10.5-5.25v4.5m0-4.5h-4.5m4.5 0L15 9m-10.5 10.5v-4.5m0 4.5h4.5m-4.5 0L9 15m10.5 5.25v-4.5m0 4.5h-4.5m4.5 0L15 15" />
  </svg>
);

const ExitFullscreenIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="18" height="18">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M15 9h4.5M15 9V4.5M15 9l5.25-5.25M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 15h4.5m-4.5 0v4.5m0-4.5l5.25 5.25" />
  </svg>
);

type FitMode = 'none' | 'fit' | 'width' | 'height';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const ZOOM_STEP = 0.25;

export const ImagePreview: React.FC<ImagePreviewProps> = ({
  data,
  fileName,
  mimeType,
  onLoad,
  className,
}) => {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [fitMode, setFitMode] = useState<FitMode>('fit');
  const [isFullscreen, setIsFullscreen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Convert ArrayBuffer to base64 URL
  const imageUrl = useMemo(() => {
    const blob = new Blob([data], { type: mimeType });
    return URL.createObjectURL(blob);
  }, [data, mimeType]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  // Reset state when data changes
  useEffect(() => {
    setZoom(1);
    setRotation(0);
    setPosition({ x: 0, y: 0 });
    setImageLoaded(false);
  }, [data]);

  // Handle image load
  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
    setImageLoaded(true);

    if (onLoad) {
      onLoad({ width: img.naturalWidth, height: img.naturalHeight });
    }

    // Auto-fit image to container
    if (containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const scaleX = containerRect.width / img.naturalWidth;
      const scaleY = containerRect.height / img.naturalHeight;
      const fitZoom = Math.min(scaleX, scaleY, 1);
      setZoom(fitZoom);
    }
  }, [onLoad]);

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    setZoom(prev => Math.min(prev + ZOOM_STEP, MAX_ZOOM));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(prev => Math.max(prev - ZOOM_STEP, MIN_ZOOM));
  }, []);

  const handleZoomReset = useCallback(() => {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  const handleFitToScreen = useCallback(() => {
    if (containerRef.current && imageRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const scaleX = containerRect.width / naturalSize.width;
      const scaleY = containerRect.height / naturalSize.height;
      const fitZoom = Math.min(scaleX, scaleY, 1);
      setZoom(fitZoom);
      setPosition({ x: 0, y: 0 });
      setFitMode('fit');
    }
  }, [naturalSize]);

  // Fit to width
  const handleFitToWidth = useCallback(() => {
    if (containerRef.current && naturalSize.width > 0) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const padding = 20;
      const fitZoom = (containerRect.width - padding) / naturalSize.width;
      setZoom(Math.min(fitZoom, MAX_ZOOM));
      setPosition({ x: 0, y: 0 });
      setFitMode('width');
    }
  }, [naturalSize]);

  // Fit to height
  const handleFitToHeight = useCallback(() => {
    if (containerRef.current && naturalSize.height > 0) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const padding = 20;
      const fitZoom = (containerRect.height - padding) / naturalSize.height;
      setZoom(Math.min(fitZoom, MAX_ZOOM));
      setPosition({ x: 0, y: 0 });
      setFitMode('height');
    }
  }, [naturalSize]);

  // Toggle fullscreen
  const handleToggleFullscreen = useCallback(async () => {
    if (!wrapperRef.current) return;

    try {
      if (!document.fullscreenElement) {
        await wrapperRef.current.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (err) {
      console.error('[ImagePreview] Fullscreen error:', err);
    }
  }, []);

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Rotation handlers
  const handleRotateLeft = useCallback(() => {
    setRotation(prev => (prev - 90) % 360);
  }, []);

  const handleRotateRight = useCallback(() => {
    setRotation(prev => (prev + 90) % 360);
  }, []);

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoom(prev => Math.min(Math.max(prev + delta, MIN_ZOOM), MAX_ZOOM));
  }, []);

  // Pan handlers (mouse drag)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    e.preventDefault();
  }, [position]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        handleZoomIn();
      } else if (e.key === '-') {
        e.preventDefault();
        handleZoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        handleZoomReset();
      } else if (e.key === 'r' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        handleRotateRight();
      } else if (e.key === 'R' && e.shiftKey) {
        e.preventDefault();
        handleRotateLeft();
      } else if (e.key === 'f' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        handleToggleFullscreen();
      } else if (e.key === 'w') {
        e.preventDefault();
        handleFitToWidth();
      } else if (e.key === 'h') {
        e.preventDefault();
        handleFitToHeight();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleZoomIn, handleZoomOut, handleZoomReset, handleRotateLeft, handleRotateRight, handleToggleFullscreen, handleFitToWidth, handleFitToHeight]);

  const containerClasses = clsx(
    'image-preview',
    {
      'image-preview--dragging': isDragging,
      'image-preview--fullscreen': isFullscreen,
    },
    className
  );

  return (
    <div className={containerClasses} ref={wrapperRef}>
      {/* Toolbar */}
      <div className="image-preview__toolbar">
        <div className="image-preview__toolbar-group">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleZoomOut}
            title="Zoom arriere (-)"
            aria-label="Zoom arriere"
            disabled={zoom <= MIN_ZOOM}
          >
            <ZoomOutIcon />
          </Button>
          <span className="image-preview__zoom-value">{Math.round(zoom * 100)}%</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleZoomIn}
            title="Zoom avant (+)"
            aria-label="Zoom avant"
            disabled={zoom >= MAX_ZOOM}
          >
            <ZoomInIcon />
          </Button>
        </div>

        <div className="image-preview__toolbar-divider" />

        <div className="image-preview__toolbar-group">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleFitToScreen}
            title="Ajuster a l'ecran"
            aria-label="Ajuster a l'ecran"
            className={clsx({ 'image-preview__btn--active': fitMode === 'fit' })}
          >
            <FitScreenIcon />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleFitToWidth}
            title="Ajuster a la largeur (W)"
            aria-label="Ajuster a la largeur"
            className={clsx({ 'image-preview__btn--active': fitMode === 'width' })}
          >
            <FitWidthIcon />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleFitToHeight}
            title="Ajuster a la hauteur (H)"
            aria-label="Ajuster a la hauteur"
            className={clsx({ 'image-preview__btn--active': fitMode === 'height' })}
          >
            <FitHeightIcon />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleZoomReset}
            title="Taille reelle (0)"
            aria-label="Taille reelle"
          >
            <ZoomResetIcon />
          </Button>
        </div>

        <div className="image-preview__toolbar-divider" />

        <div className="image-preview__toolbar-group">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleFullscreen}
            title={isFullscreen ? 'Quitter le plein ecran (F)' : 'Plein ecran (F)'}
            aria-label={isFullscreen ? 'Quitter le plein ecran' : 'Plein ecran'}
          >
            {isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
          </Button>
        </div>

        <div className="image-preview__toolbar-divider" />

        <div className="image-preview__toolbar-group">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRotateLeft}
            title="Rotation gauche (Shift+R)"
            aria-label="Rotation gauche"
          >
            <RotateLeftIcon />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRotateRight}
            title="Rotation droite (R)"
            aria-label="Rotation droite"
          >
            <RotateRightIcon />
          </Button>
        </div>
      </div>

      {/* Image Container */}
      <div
        ref={containerRef}
        className="image-preview__container"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        {!imageLoaded && (
          <div className="image-preview__loading">
            <div className="image-preview__spinner" />
          </div>
        )}
        <img
          ref={imageRef}
          src={imageUrl}
          alt={fileName}
          className="image-preview__image"
          onLoad={handleImageLoad}
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${zoom}) rotate(${rotation}deg)`,
            opacity: imageLoaded ? 1 : 0,
            cursor: isDragging ? 'grabbing' : 'grab',
          }}
          draggable={false}
        />
      </div>

      {/* Dimensions info */}
      {imageLoaded && naturalSize.width > 0 && (
        <div className="image-preview__dimensions">
          {naturalSize.width} x {naturalSize.height} px
        </div>
      )}
    </div>
  );
};

export default ImagePreview;
