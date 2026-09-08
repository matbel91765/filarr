/**
 * FontPreview Component
 *
 * In-app preview for font files (.ttf / .otf / .woff / .woff2). The font bytes are
 * loaded entirely in the renderer via the native FontFace API (no network, matches
 * the offline/E2EE stance), registered on `document.fonts`, and rendered as a live
 * specimen: an editable pangram, the full glyph set, and a size ramp. The FontFace
 * is removed from the document again on unmount so specimens never leak between
 * previews.
 */

import React, { useEffect, useId, useState } from 'react';
import clsx from 'clsx';
import { Input } from '../ui/Input/Input';
import './MarkdownPreview.css';

export interface FontPreviewProps {
  /** Font file data as ArrayBuffer */
  data: ArrayBuffer;
  /** File name */
  fileName: string;
  /** File extension (ttf | otf | woff | woff2) */
  extension?: string;
  /** Additional CSS class */
  className?: string;
}

const DEFAULT_PANGRAM = 'Portez ce vieux whisky au juge blond qui fume';
const DEFAULT_SAMPLE = 'Filarr chiffre vos fichiers de bout en bout — 0123456789';

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const PUNCTUATION = '&é"\'(-è_çà) ! ? . , ; : @ # € $ % * + = / \\ < > { } [ ]';

const SIZE_SAMPLES = [12, 16, 24, 36, 48];

export const FontPreview: React.FC<FontPreviewProps> = ({
  data,
  fileName,
  extension,
  className,
}) => {
  const [family, setFamily] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sampleText, setSampleText] = useState(DEFAULT_SAMPLE);

  // Stable, per-instance, CSS-safe font-family identifier.
  const rawId = useId();
  const familyName = 'filarr-font-preview-' + rawId.replace(/[^a-zA-Z0-9]/g, '');

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setFamily(null);

    // Copy the bytes so the shared preview buffer is never retained/detached.
    const face = new FontFace(familyName, data.slice(0));

    face
      .load()
      .then((loaded) => {
        if (cancelled) return;
        document.fonts.add(loaded);
        setFamily(familyName);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('[FontPreview] Font load error:', err);
        setError(err instanceof Error ? err.message : 'Police illisible');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
      // Safe even if the face was never added (load failed / still pending).
      document.fonts.delete(face);
    };
  }, [data, familyName]);

  const containerClasses = clsx('markdown-preview', className);
  const specimenFont: React.CSSProperties = family ? { fontFamily: family } : {};

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: 'var(--color-text-tertiary, #9ca3af)',
    marginBottom: 8,
  };

  const cardStyle: React.CSSProperties = {
    padding: '16px 20px',
    borderRadius: 10,
    border: '1px solid var(--color-border, #e5e7eb)',
    background: 'var(--color-bg-secondary, #f9fafb)',
    marginBottom: 20,
  };

  return (
    <div className={containerClasses}>
      <div className="markdown-preview__toolbar">
        <div className="markdown-preview__toolbar-left">
          <span className="markdown-preview__badge">Police</span>
          <span className="markdown-preview__stats" title={fileName}>
            {fileName}
            {extension ? ` · ${extension.toUpperCase()}` : ''}
          </span>
        </div>
        <div className="markdown-preview__toolbar-right">
          <Input
            type="text"
            value={sampleText}
            onChange={(e) => setSampleText(e.target.value)}
            placeholder="Texte d'aperçu…"
            style={{ maxWidth: 260 }}
            disabled={!family}
            aria-label="Texte d'aperçu personnalisé"
          />
        </div>
      </div>

      <div className="markdown-preview__container">
        {isLoading ? (
          <div className="file-preview-panel__loading">
            <div className="file-preview-panel__spinner" />
            <span>Chargement de la police…</span>
          </div>
        ) : error ? (
          <div className="file-preview-panel__error">
            <span>Impossible d'afficher cette police</span>
            <p className="file-preview-panel__error-message">{error}</p>
          </div>
        ) : (
          <div style={{ padding: '24px 32px', maxWidth: 900 }}>
            {/* Editable pangram specimen */}
            <div style={{ marginBottom: 24 }}>
              <div style={labelStyle}>Pangramme (éditable)</div>
              <div
                contentEditable
                suppressContentEditableWarning
                spellCheck={false}
                role="textbox"
                aria-label="Pangramme éditable"
                style={{
                  ...specimenFont,
                  fontSize: 44,
                  lineHeight: 1.25,
                  color: 'var(--color-text-primary, #1f2937)',
                  outline: 'none',
                  wordBreak: 'break-word',
                  cursor: 'text',
                }}
              >
                {DEFAULT_PANGRAM}
              </div>
            </div>

            {/* Glyph set */}
            <div style={cardStyle}>
              <div style={labelStyle}>Alphabet & chiffres</div>
              <div
                style={{
                  ...specimenFont,
                  fontSize: 26,
                  lineHeight: 1.6,
                  color: 'var(--color-text-primary, #1f2937)',
                  wordBreak: 'break-word',
                }}
              >
                <div>{UPPERCASE}</div>
                <div>{LOWERCASE}</div>
                <div>{DIGITS}</div>
                <div style={{ fontSize: 20 }}>{PUNCTUATION}</div>
              </div>
            </div>

            {/* Size ramp driven by the custom preview text */}
            <div>
              <div style={labelStyle}>Tailles</div>
              {SIZE_SAMPLES.map((size) => (
                <div
                  key={size}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 14,
                    marginBottom: 10,
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      width: 44,
                      textAlign: 'right',
                      fontSize: 11,
                      fontVariantNumeric: 'tabular-nums',
                      color: 'var(--color-text-tertiary, #9ca3af)',
                    }}
                  >
                    {size} px
                  </span>
                  <span
                    style={{
                      ...specimenFont,
                      fontSize: size,
                      lineHeight: 1.3,
                      color: 'var(--color-text-primary, #1f2937)',
                      wordBreak: 'break-word',
                      minWidth: 0,
                    }}
                  >
                    {sampleText || DEFAULT_SAMPLE}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FontPreview;
