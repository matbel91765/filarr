/**
 * FilePreviewPanel Component
 *
 * Main preview panel component that displays file previews based on file type.
 * Supports images, PDFs, text/code, video, and audio files.
 *
 * Features:
 * - Split view mode (file list + preview side by side)
 * - Resizable preview panel
 * - Preview toggle button
 * - Remembers preview size preference
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import clsx from 'clsx';
import { Button } from '../ui/Button/Button';
import { ImagePreview } from './ImagePreview';
import { PDFPreview } from './PDFPreview';
import { TextPreview } from './TextPreview';
import { MarkdownPreview } from './MarkdownPreview';
import { VideoPreview } from './VideoPreview';
import { AudioPreview } from './AudioPreview';
import { readFile } from '../../../services/core/fileService';
import {
  isProtected,
  isUnlockedForSession,
  getPasswordHint,
} from '../../../services/auth/filePasswordService';
import { PasswordUnlockModal } from '../files/PasswordUnlockModal';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import type { FileItem } from '../../../types';
import './FilePreviewPanel.css';

// Storage keys for preview preferences
const STORAGE_KEY_PREVIEW_WIDTH = 'filarr_preview_panel_width';
const STORAGE_KEY_PREVIEW_SPLIT_MODE = 'filarr_preview_split_mode';

// Default and constraints for panel width
const DEFAULT_PANEL_WIDTH = 400;
const MIN_PANEL_WIDTH = 250;
const MAX_PANEL_WIDTH = 800;

// Supported file extensions by category
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'];
const PDF_EXTENSIONS = ['pdf'];
const MARKDOWN_EXTENSIONS = ['md', 'mdx', 'markdown'];
const TEXT_EXTENSIONS = [
  'txt',
  'json',
  'js',
  'ts',
  'jsx',
  'tsx',
  'css',
  'scss',
  'html',
  'xml',
  'yaml',
  'yml',
  'ini',
  'conf',
  'sh',
  'bat',
  'py',
  'java',
  'c',
  'cpp',
  'h',
  'hpp',
  'cs',
  'go',
  'rs',
  'rb',
  'php',
  'sql',
  'log',
  'env',
  'gitignore',
  'dockerfile',
  'makefile',
];
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma'];

type PreviewType = 'image' | 'pdf' | 'markdown' | 'text' | 'video' | 'audio' | 'unsupported';

export interface FilePreviewPanelProps {
  /** File to preview */
  file: FileItem | null;
  /** Folder ID containing the file */
  folderId: string | null;
  /** Whether the panel is open */
  isOpen: boolean;
  /** Callback when panel is closed */
  onClose: () => void;
  /** Whether to show in Quick Look mode (triggered by Space key) */
  isQuickLook?: boolean;
  /** Additional CSS class */
  className?: string;
  /** Enable split view mode (side by side with file list) */
  splitView?: boolean;
  /** Callback to toggle split view mode */
  onToggleSplitView?: () => void;
  /** Initial panel width for split view */
  initialWidth?: number;
  /** Callback when panel is resized */
  onResize?: (width: number) => void;
  /** Sibling files for keyboard navigation */
  siblingFiles?: FileItem[];
  /** Callback when navigating to another file */
  onNavigate?: (file: FileItem) => void;
}

// SVG Icons
const CloseIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="20"
    height="20"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const ExpandIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="20"
    height="20"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9m10.5-5.25v4.5m0-4.5h-4.5m4.5 0L15 9m-10.5 10.5v-4.5m0 4.5h4.5m-4.5 0L9 15m10.5 5.25v-4.5m0 4.5h-4.5m4.5 0L15 15"
    />
  </svg>
);

const CollapseIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="20"
    height="20"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25"
    />
  </svg>
);

const FileIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="48"
    height="48"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
    />
  </svg>
);

const DownloadIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="20"
    height="20"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
    />
  </svg>
);

const InfoIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="20"
    height="20"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
    />
  </svg>
);

const SplitViewIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="20"
    height="20"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 4.5v15m6-15v15M4.5 19.5h15a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5h-15A1.5 1.5 0 003 6v12a1.5 1.5 0 001.5 1.5z"
    />
  </svg>
);

const ResizeHandleIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="16"
    height="16"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M8 6h.01M8 12h.01M8 18h.01M12 6h.01M12 12h.01M12 18h.01"
    />
  </svg>
);

const LockIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    width="48"
    height="48"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
    />
  </svg>
);

/**
 * Get the preview type based on file extension
 */
const getPreviewType = (fileName: string): PreviewType => {
  const extension = fileName.split('.').pop()?.toLowerCase() || '';

  if (IMAGE_EXTENSIONS.includes(extension)) return 'image';
  if (PDF_EXTENSIONS.includes(extension)) return 'pdf';
  if (MARKDOWN_EXTENSIONS.includes(extension)) return 'markdown';
  if (TEXT_EXTENSIONS.includes(extension)) return 'text';
  if (VIDEO_EXTENSIONS.includes(extension)) return 'video';
  if (AUDIO_EXTENSIONS.includes(extension)) return 'audio';

  return 'unsupported';
};

/**
 * Format file size for display
 */
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Format date for display
 */
const formatDate = (dateString?: string): string => {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * Get MIME type from file extension
 */
const getMimeType = (fileName: string): string => {
  const extension = fileName.split('.').pop()?.toLowerCase() || '';

  const mimeTypes: Record<string, string> = {
    // Images
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    // PDF
    pdf: 'application/pdf',
    // Video
    mp4: 'video/mp4',
    webm: 'video/webm',
    ogg: 'video/ogg',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    // Audio
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    flac: 'audio/flac',
    aac: 'audio/aac',
    m4a: 'audio/mp4',
    wma: 'audio/x-ms-wma',
    // Text
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    js: 'text/javascript',
    ts: 'text/typescript',
    jsx: 'text/jsx',
    tsx: 'text/tsx',
    css: 'text/css',
    html: 'text/html',
    xml: 'text/xml',
  };

  return mimeTypes[extension] || 'application/octet-stream';
};

export const FilePreviewPanel: React.FC<FilePreviewPanelProps> = ({
  file,
  folderId,
  isOpen,
  onClose,
  isQuickLook = false,
  className,
  splitView = false,
  onToggleSplitView,
  initialWidth,
  onResize,
  siblingFiles,
  onNavigate,
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [fileData, setFileData] = useState<ArrayBuffer | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(
    null
  );
  const previewContentRef = useRef<HTMLDivElement>(null);

  // Resizable panel state
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    if (initialWidth) return initialWidth;
    const stored = localStorage.getItem(STORAGE_KEY_PREVIEW_WIDTH);
    return stored ? parseInt(stored, 10) : DEFAULT_PANEL_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartX = useRef<number>(0);
  const resizeStartWidth = useRef<number>(0);

  const panelRef = useRef<HTMLDivElement>(null);

  // Password protection state
  const [isFileLocked, setIsFileLocked] = useState(false);
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [passwordVersion, setPasswordVersion] = useState(0);

  // Check password protection status
  useEffect(() => {
    if (!file || !isOpen) {
      setIsFileLocked(false);
      return;
    }
    setIsFileLocked(isProtected(file.id) && !isUnlockedForSession(file.id));
  }, [file?.id, isOpen, passwordVersion]);

  // Reset state when file changes
  useEffect(() => {
    setFileData(null);
    setError(null);
    setImageDimensions(null);
  }, [file?.id]);

  // Load file data when panel opens (only if not locked)
  useEffect(() => {
    const loadFileData = async () => {
      if (!file || !folderId || !isOpen) return;
      if (isFileLocked) return;

      const previewType = getPreviewType(file.name);
      if (previewType === 'unsupported') return;

      setIsLoading(true);
      setDownloadPercent(0);
      setError(null);

      try {
        const data = await readFile(folderId, file.name, true, (percent) => {
          setDownloadPercent(percent);
        });
        setDownloadPercent(100);
        setFileData(data.buffer as ArrayBuffer);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error('[FilePreviewPanel] Error loading file:', err);
        setError(errMsg || 'Failed to load file');
      } finally {
        setIsLoading(false);
      }
    };

    loadFileData();
  }, [file, folderId, isOpen, isFileLocked]);

  // Handle keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (showUnlockModal) return;
      if (e.key === 'Escape') {
        if (isFullscreen) {
          setIsFullscreen(false);
        } else {
          onClose();
        }
      } else if (e.key === ' ' && isQuickLook) {
        e.preventDefault();
        onClose();
      } else if (e.key === 'f' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsFullscreen(!isFullscreen);
      } else if (e.key === 'i' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setShowInfo(!showInfo);
      } else if (e.key === 'ArrowLeft' && siblingFiles && onNavigate && file) {
        e.preventDefault();
        const currentIndex = siblingFiles.findIndex((f) => f.id === file.id);
        if (currentIndex > 0) {
          onNavigate(siblingFiles[currentIndex - 1]);
        }
      } else if (e.key === 'ArrowRight' && siblingFiles && onNavigate && file) {
        e.preventDefault();
        const currentIndex = siblingFiles.findIndex((f) => f.id === file.id);
        if (currentIndex < siblingFiles.length - 1) {
          onNavigate(siblingFiles[currentIndex + 1]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isOpen,
    isFullscreen,
    isQuickLook,
    onClose,
    showInfo,
    showUnlockModal,
    siblingFiles,
    onNavigate,
    file,
  ]);

  // Handle download
  const handleDownload = useCallback(async () => {
    if (!file || !folderId) return;

    try {
      await window.electron.ipcRenderer.invoke('downloadItem', {
        folderId,
        itemId: file.id,
      });
    } catch (err) {
      console.error('[FilePreviewPanel] Download error:', err);
    }
  }, [file, folderId]);

  // Handle unlock success
  const handleUnlockSuccess = useCallback(() => {
    setShowUnlockModal(false);
    setPasswordVersion((v) => v + 1);
    setFileData(null);
    setError(null);
  }, []);

  // Handle resize start
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      resizeStartX.current = e.clientX;
      resizeStartWidth.current = panelWidth;
    },
    [panelWidth]
  );

  // Handle resize move
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = resizeStartX.current - e.clientX;
      const newWidth = Math.min(
        Math.max(resizeStartWidth.current + delta, MIN_PANEL_WIDTH),
        MAX_PANEL_WIDTH
      );
      setPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      // Save width to localStorage
      localStorage.setItem(STORAGE_KEY_PREVIEW_WIDTH, panelWidth.toString());
      if (onResize) {
        onResize(panelWidth);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, panelWidth, onResize]);

  // Update image dimensions
  const handleImageLoad = useCallback((dimensions: { width: number; height: number }) => {
    setImageDimensions(dimensions);
  }, []);

  if (!isOpen || !file) return null;

  const previewType = getPreviewType(file.name);
  const mimeType = getMimeType(file.name);
  const extension = file.name.split('.').pop()?.toLowerCase() || '';

  const panelClasses = clsx(
    'file-preview-panel',
    {
      'file-preview-panel--fullscreen': isFullscreen,
      'file-preview-panel--quick-look': isQuickLook,
      'file-preview-panel--split-view': splitView,
      'file-preview-panel--resizing': isResizing,
    },
    className
  );

  // Panel style with dynamic width for split view
  const panelStyle: React.CSSProperties =
    splitView && !isFullscreen
      ? { width: panelWidth, minWidth: MIN_PANEL_WIDTH, maxWidth: MAX_PANEL_WIDTH }
      : {};

  const renderPreviewContent = () => {
    // Password-protected locked state
    if (isFileLocked) {
      const hint = file ? getPasswordHint(file.id) : null;
      return (
        <div className="file-preview-panel__locked">
          <div className="file-preview-panel__locked-icon">
            <LockIcon />
          </div>
          <h3 className="file-preview-panel__locked-title">Fichier protege</h3>
          <p className="file-preview-panel__locked-message">
            Ce fichier est protege par un mot de passe. Deverrouillez-le pour afficher l'apercu.
          </p>
          {hint && <p className="file-preview-panel__locked-hint">Indice : {hint}</p>}
          <Button variant="primary" size="sm" onClick={() => setShowUnlockModal(true)}>
            Deverrouiller
          </Button>
        </div>
      );
    }

    if (isLoading) {
      return (
        <div className="file-preview-panel__loading">
          <div className="file-preview-panel__spinner" />
          <span>Chargement de l'apercu...</span>
          {downloadPercent > 0 && downloadPercent < 100 && (
            <div className="w-48 mt-3">
              <div className="h-1.5 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--color-primary-500)] rounded-full transition-all duration-200"
                  style={{ width: `${downloadPercent}%` }}
                />
              </div>
              <span className="text-xs text-[var(--text-tertiary)] mt-1 block text-center">
                {downloadPercent}%
              </span>
            </div>
          )}
        </div>
      );
    }

    if (error) {
      return (
        <div className="file-preview-panel__error">
          <FileIcon />
          <span>Impossible de charger l'apercu</span>
          <p className="file-preview-panel__error-message">{error}</p>
        </div>
      );
    }

    switch (previewType) {
      case 'image':
        return fileData ? (
          <ImagePreview
            data={fileData}
            fileName={file.name}
            mimeType={mimeType}
            onLoad={handleImageLoad}
          />
        ) : null;

      case 'pdf':
        return fileData ? <PDFPreview data={fileData} fileName={file.name} /> : null;

      case 'markdown':
        return fileData ? <MarkdownPreview data={fileData} fileName={file.name} /> : null;

      case 'text':
        return fileData ? (
          <TextPreview data={fileData} fileName={file.name} extension={extension} />
        ) : null;

      case 'video':
        return fileData ? (
          <VideoPreview data={fileData} fileName={file.name} mimeType={mimeType} />
        ) : null;

      case 'audio':
        return fileData ? (
          <AudioPreview data={fileData} fileName={file.name} mimeType={mimeType} />
        ) : null;

      default:
        return (
          <div className="file-preview-panel__unsupported">
            <FileIcon />
            <h3>Apercu non disponible</h3>
            <p>Ce type de fichier ne peut pas etre previsualise.</p>
            <p className="file-preview-panel__unsupported-extension">.{extension}</p>
          </div>
        );
    }
  };

  return (
    <div className={panelClasses} ref={panelRef} style={panelStyle}>
      {/* Resize Handle for Split View */}
      {splitView && !isFullscreen && (
        <div
          className="file-preview-panel__resize-handle"
          onMouseDown={handleResizeStart}
          title="Drag to resize"
        >
          <ResizeHandleIcon />
        </div>
      )}

      {/* Header */}
      <div className="file-preview-panel__header">
        <div className="file-preview-panel__header-left">
          <h3 className="file-preview-panel__title" title={file.name}>
            {file.name}
          </h3>
          {siblingFiles && siblingFiles.length > 1 && (
            <span className="file-preview-panel__nav-indicator">
              {siblingFiles.findIndex((f) => f.id === file.id) + 1} / {siblingFiles.length}
            </span>
          )}
        </div>
        <div className="file-preview-panel__header-actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowInfo(!showInfo)}
            title="Informations du fichier (Ctrl+I)"
            aria-label="Informations"
            className={clsx({ 'file-preview-panel__btn--active': showInfo })}
            disabled={isFileLocked}
          >
            <InfoIcon />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            title="Telecharger"
            aria-label="Telecharger"
            disabled={isFileLocked}
          >
            <DownloadIcon />
          </Button>
          {onToggleSplitView && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleSplitView}
              title={splitView ? 'Fermer la vue partagee' : 'Vue partagee'}
              aria-label={splitView ? 'Fermer la vue partagee' : 'Vue partagee'}
              className={clsx({ 'file-preview-panel__btn--active': splitView })}
            >
              <SplitViewIcon />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? 'Quitter le plein ecran (Ctrl+F)' : 'Plein ecran (Ctrl+F)'}
            aria-label={isFullscreen ? 'Quitter le plein ecran' : 'Plein ecran'}
          >
            {isFullscreen ? <CollapseIcon /> : <ExpandIcon />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            title="Fermer (Echap)"
            aria-label="Fermer"
          >
            <CloseIcon />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="file-preview-panel__content">
        {/* Preview Area */}
        <div
          className="file-preview-panel__preview"
          ref={previewContentRef}
          style={{ position: 'relative' }}
        >
          <ErrorBoundary
            fallback={
              <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  width="48"
                  height="48"
                  style={{ margin: '0 auto 16px', color: 'var(--color-warning-500, #f59e0b)' }}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                  />
                </svg>
                <p style={{ color: 'var(--color-text-secondary)' }}>
                  Impossible d'afficher l'apercu de ce fichier.
                </p>
              </div>
            }
          >
            {renderPreviewContent()}
          </ErrorBoundary>
        </div>

        {/* Info Panel */}
        {showInfo && (
          <div className="file-preview-panel__info">
            <h4 className="file-preview-panel__info-title">Informations</h4>
            <dl className="file-preview-panel__info-list">
              <dt>Nom</dt>
              <dd title={file.name}>{file.name}</dd>

              <dt>Type</dt>
              <dd>{mimeType}</dd>

              <dt>Taille</dt>
              <dd>{formatFileSize(file.size)}</dd>

              <dt>Extension</dt>
              <dd>.{extension}</dd>

              {imageDimensions && (
                <>
                  <dt>Dimensions</dt>
                  <dd>
                    {imageDimensions.width} x {imageDimensions.height} px
                  </dd>
                </>
              )}

              <dt>Cree le</dt>
              <dd>{formatDate(file.createdAt)}</dd>

              <dt>Modifie le</dt>
              <dd>{formatDate(file.updatedAt)}</dd>
            </dl>
          </div>
        )}
      </div>

      {/* Quick Look hint */}
      {isQuickLook && (
        <div className="file-preview-panel__quick-look-hint">Appuyez sur Espace pour fermer</div>
      )}

      {/* Password Unlock Modal */}
      {showUnlockModal && file && (
        <PasswordUnlockModal
          isOpen={showUnlockModal}
          onClose={() => setShowUnlockModal(false)}
          itemId={file.id}
          itemName={file.name}
          itemType="file"
          onUnlock={handleUnlockSuccess}
        />
      )}
    </div>
  );
};

export default FilePreviewPanel;
