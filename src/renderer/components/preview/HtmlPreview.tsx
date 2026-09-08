/**
 * HtmlPreview Component
 *
 * Renders self-contained .html files (e.g. saved web-clipper exports, exported
 * reports) with a rendered/source toggle. The rendered view is a locked-down
 * `<iframe sandbox="">` fed a DOMPurify-sanitized document plus a restrictive CSP
 * meta: no scripts, no forms, no network fetches — only inline styles and data:
 * images survive, which keeps the offline/E2EE guarantee intact.
 */

import React, { useState, useMemo, useCallback } from 'react';
import DOMPurify from 'dompurify';
import clsx from 'clsx';
import { Button } from '../ui/Button/Button';
import './MarkdownPreview.css';

export interface HtmlPreviewProps {
  /** HTML data as ArrayBuffer */
  data: ArrayBuffer;
  /** File name */
  fileName: string;
  /** Additional CSS class */
  className?: string;
}

const SourceIcon: React.FC = () => (
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
      d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"
    />
  </svg>
);

const PreviewIcon: React.FC = () => (
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
      d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
    />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

// Blocks every network fetch (scripts/frames/remote img/css/font) while allowing
// the page's own inline styling and embedded data: images to render.
const CSP_META =
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; media-src data: blob:; style-src \'unsafe-inline\'; font-src data:;">';

export const HtmlPreview: React.FC<HtmlPreviewProps> = ({ data, fileName, className }) => {
  const [showSource, setShowSource] = useState(false);

  const rawContent = useMemo(() => new TextDecoder('utf-8').decode(data), [data]);

  const srcDoc = useMemo(() => {
    const sanitized = DOMPurify.sanitize(rawContent, {
      WHOLE_DOCUMENT: true,
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'base'],
      FORBID_ATTR: ['srcdoc', 'formaction', 'ping'],
    });
    // Inject the CSP into <head> (creating one if absent) so it is honored.
    if (/<head[^>]*>/i.test(sanitized)) {
      return sanitized.replace(/<head[^>]*>/i, (m) => m + CSP_META);
    }
    if (/<html[^>]*>/i.test(sanitized)) {
      return sanitized.replace(/<html[^>]*>/i, (m) => `${m}<head>${CSP_META}</head>`);
    }
    return `<head>${CSP_META}</head>${sanitized}`;
  }, [rawContent]);

  const handleToggle = useCallback(() => setShowSource((s) => !s), []);

  const containerClasses = clsx('markdown-preview', className);

  return (
    <div className={containerClasses}>
      <div className="markdown-preview__toolbar">
        <div className="markdown-preview__toolbar-left">
          <span className="markdown-preview__badge">HTML</span>
          <span className="markdown-preview__stats" title={fileName}>
            {fileName}
          </span>
        </div>
        <div className="markdown-preview__toolbar-right">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggle}
            title={showSource ? 'Aperçu rendu' : 'Code source'}
            aria-label={showSource ? 'Aperçu rendu' : 'Code source'}
            className={clsx({ 'markdown-preview__btn--active': showSource })}
          >
            {showSource ? <PreviewIcon /> : <SourceIcon />}
          </Button>
        </div>
      </div>

      <div className="markdown-preview__container">
        {showSource ? (
          <pre className="markdown-preview__source">{rawContent}</pre>
        ) : (
          <iframe
            title={fileName}
            sandbox=""
            srcDoc={srcDoc}
            style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
          />
        )}
      </div>
    </div>
  );
};

export default HtmlPreview;
