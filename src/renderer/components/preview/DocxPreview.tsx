/**
 * DocxPreview Component
 *
 * In-app preview for Word .docx files. Converts the document to HTML entirely in
 * the renderer via mammoth's self-contained browser bundle (no bytes leave the
 * device — matches the offline/E2EE stance), sanitizes with DOMPurify, and
 * renders into the shared markdown-preview styles.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import mammoth from 'mammoth/mammoth.browser';
import DOMPurify from 'dompurify';
import clsx from 'clsx';
import { Button } from '../ui/Button/Button';
import './MarkdownPreview.css';

export interface DocxPreviewProps {
  /** Document data as ArrayBuffer */
  data: ArrayBuffer;
  /** File name */
  fileName: string;
  /** Additional CSS class */
  className?: string;
}

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

export const DocxPreview: React.FC<DocxPreviewProps> = ({ data, fileName, className }) => {
  const [html, setHtml] = useState<string | null>(null);
  const [isConverting, setIsConverting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsConverting(true);
    setError(null);
    setHtml(null);

    // mammoth mutates the ArrayBuffer's underlying bytes via a typed-array view;
    // pass a copy so we never disturb the shared preview buffer.
    const buffer = data.slice(0);
    mammoth
      .convertToHtml({ arrayBuffer: buffer })
      .then((result) => {
        if (cancelled) return;
        const sanitized = DOMPurify.sanitize(result.value, {
          // Word exports embed images as data: URIs and use tables/lists heavily.
          // Keep those; strip every active-content / network-capable tag.
          FORBID_TAGS: [
            'script',
            'style',
            'iframe',
            'object',
            'embed',
            'form',
            'input',
            'link',
            'meta',
            'base',
          ],
          FORBID_ATTR: ['style', 'srcdoc', 'formaction', 'ping'],
          ADD_ATTR: ['target', 'rel'],
        });
        setHtml(sanitized);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[DocxPreview] Conversion error:', err);
        setError(err instanceof Error ? err.message : 'Conversion impossible');
      })
      .finally(() => {
        if (!cancelled) setIsConverting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [data]);

  // Plain-text version for the copy button (strip tags from the sanitized HTML).
  const plainText = useMemo(() => {
    if (!html) return '';
    const el = document.createElement('div');
    el.innerHTML = html;
    return el.textContent || '';
  }, [html]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(plainText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[DocxPreview] Failed to copy:', err);
    }
  }, [plainText]);

  const containerClasses = clsx('markdown-preview', className);

  return (
    <div className={containerClasses}>
      <div className="markdown-preview__toolbar">
        <div className="markdown-preview__toolbar-left">
          <span className="markdown-preview__badge">Word</span>
          <span className="markdown-preview__stats" title={fileName}>
            {fileName}
          </span>
        </div>
        <div className="markdown-preview__toolbar-right">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            disabled={!html}
            title={copied ? 'Copié !' : 'Copier le texte'}
            aria-label="Copier"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </Button>
        </div>
      </div>

      <div className="markdown-preview__container">
        {isConverting ? (
          <div className="file-preview-panel__loading">
            <div className="file-preview-panel__spinner" />
            <span>Conversion du document…</span>
          </div>
        ) : error ? (
          <div className="file-preview-panel__error">
            <span>Impossible d'afficher ce document</span>
            <p className="file-preview-panel__error-message">{error}</p>
          </div>
        ) : (
          <div
            className="markdown-preview__rendered"
            dangerouslySetInnerHTML={{ __html: html || '' }}
          />
        )}
      </div>
    </div>
  );
};

export default DocxPreview;
