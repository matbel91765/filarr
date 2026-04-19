/**
 * ThemePreview Component
 *
 * Provides a live preview of theme changes with sample UI elements.
 * Used to visualize themes before applying them.
 */

import React, { FC } from 'react';
import clsx from 'clsx';
import type { Theme, ThemeColors } from '../../../services/platform/themeService';
import './ThemePreview.css';

// SVG Icons
const FolderIcon: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const FileIcon: FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const StarIcon: FC = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const SearchIcon: FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

export interface ThemePreviewProps {
  /** The theme to preview */
  theme: Theme;
  /** Custom color overrides for preview */
  colorOverrides?: Partial<ThemeColors>;
  /** Additional CSS class */
  className?: string;
  /** Compact mode - shows smaller preview */
  compact?: boolean;
  /** Show comparison mode with current theme */
  showComparison?: boolean;
}

export const ThemePreview: FC<ThemePreviewProps> = ({
  theme,
  colorOverrides,
  className,
  compact = false,
  showComparison = false,
}) => {
  // Merge theme colors with overrides
  const colors: ThemeColors = {
    ...theme.colors,
    ...colorOverrides,
  };

  // Create inline style variables
  const previewStyle: React.CSSProperties = {
    '--preview-background': colors.background,
    '--preview-background-secondary': colors.backgroundSecondary,
    '--preview-surface': colors.surface,
    '--preview-text-primary': colors.textPrimary,
    '--preview-text-secondary': colors.textSecondary,
    '--preview-text-tertiary': colors.textTertiary,
    '--preview-primary': colors.primary,
    '--preview-accent': colors.accent,
    '--preview-border': colors.border,
    '--preview-success': colors.success,
    '--preview-warning': colors.warning,
    '--preview-error': colors.error,
  } as React.CSSProperties;

  return (
    <div
      className={clsx(
        'theme-preview',
        {
          'theme-preview--compact': compact,
          'theme-preview--dark': theme.mode === 'dark',
        },
        className
      )}
      style={previewStyle}
    >
      <div className="theme-preview__window">
        {/* Title bar */}
        <div className="theme-preview__titlebar">
          <div className="theme-preview__window-controls">
            <span className="theme-preview__window-btn theme-preview__window-btn--close" />
            <span className="theme-preview__window-btn theme-preview__window-btn--minimize" />
            <span className="theme-preview__window-btn theme-preview__window-btn--maximize" />
          </div>
          <span className="theme-preview__titlebar-text">Filarr</span>
        </div>

        {/* Main content */}
        <div className="theme-preview__content">
          {/* Sidebar */}
          <div className="theme-preview__sidebar">
            <div className="theme-preview__sidebar-section">
              <div className="theme-preview__sidebar-item theme-preview__sidebar-item--active">
                <FolderIcon />
                <span>Documents</span>
              </div>
              <div className="theme-preview__sidebar-item">
                <FolderIcon />
                <span>Images</span>
              </div>
              <div className="theme-preview__sidebar-item">
                <FolderIcon />
                <span>Videos</span>
              </div>
            </div>
            <div className="theme-preview__sidebar-divider" />
            <div className="theme-preview__sidebar-section">
              <div className="theme-preview__sidebar-item theme-preview__sidebar-item--favorite">
                <StarIcon />
                <span>Favoris</span>
              </div>
            </div>
          </div>

          {/* Main area */}
          <div className="theme-preview__main">
            {/* Search bar */}
            <div className="theme-preview__search">
              <SearchIcon />
              <span>Rechercher...</span>
            </div>

            {/* File list */}
            <div className="theme-preview__files">
              <div className="theme-preview__file theme-preview__file--selected">
                <FileIcon />
                <span className="theme-preview__file-name">Document.pdf</span>
                <span className="theme-preview__file-date">Aujourd'hui</span>
              </div>
              <div className="theme-preview__file">
                <FileIcon />
                <span className="theme-preview__file-name">Image.png</span>
                <span className="theme-preview__file-date">Hier</span>
              </div>
              <div className="theme-preview__file">
                <FileIcon />
                <span className="theme-preview__file-name">Video.mp4</span>
                <span className="theme-preview__file-date">Il y a 3 jours</span>
              </div>
            </div>

            {/* Buttons showcase */}
            {!compact && (
              <div className="theme-preview__buttons">
                <button className="theme-preview__btn theme-preview__btn--primary">
                  Primary
                </button>
                <button className="theme-preview__btn theme-preview__btn--secondary">
                  Secondary
                </button>
                <button className="theme-preview__btn theme-preview__btn--ghost">
                  Ghost
                </button>
              </div>
            )}

            {/* Status indicators */}
            {!compact && (
              <div className="theme-preview__status-indicators">
                <span className="theme-preview__badge theme-preview__badge--success">
                  Success
                </span>
                <span className="theme-preview__badge theme-preview__badge--warning">
                  Warning
                </span>
                <span className="theme-preview__badge theme-preview__badge--error">
                  Error
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Theme info */}
      <div className="theme-preview__info">
        <span className="theme-preview__name">{theme.name}</span>
        <span className="theme-preview__mode">
          {theme.mode === 'dark' ? 'Mode sombre' : 'Mode clair'}
        </span>
      </div>

      {/* Color swatches */}
      {!compact && (
        <div className="theme-preview__swatches">
          <div
            className="theme-preview__swatch"
            style={{ backgroundColor: colors.primary }}
            title="Primary"
          />
          <div
            className="theme-preview__swatch"
            style={{ backgroundColor: colors.accent }}
            title="Accent"
          />
          <div
            className="theme-preview__swatch"
            style={{ backgroundColor: colors.background }}
            title="Background"
          />
          <div
            className="theme-preview__swatch"
            style={{ backgroundColor: colors.surface }}
            title="Surface"
          />
          <div
            className="theme-preview__swatch"
            style={{ backgroundColor: colors.textPrimary }}
            title="Text"
          />
        </div>
      )}
    </div>
  );
};

export default ThemePreview;
