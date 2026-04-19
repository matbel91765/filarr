/**
 * MarkdownPreview Component
 *
 * Renders markdown files as formatted HTML with support for
 * headings, links, code blocks, tables, lists, and images.
 * Includes a toggle to switch between rendered and raw source views.
 */

import React, { useState, useMemo, useCallback, useRef } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import clsx from 'clsx';
import { Button } from '../ui/Button/Button';
import './MarkdownPreview.css';

export interface MarkdownPreviewProps {
  /** Markdown data as ArrayBuffer */
  data: ArrayBuffer;
  /** File name */
  fileName: string;
  /** Additional CSS class */
  className?: string;
}

// SVG Icons
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

// Configure marked for security
marked.setOptions({
  gfm: true,
  breaks: true,
});

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({ data, fileName, className }) => {
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Decode ArrayBuffer to string
  const rawContent = useMemo(() => {
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(data);
  }, [data]);

  // Parse markdown to HTML
  const htmlContent = useMemo(() => {
    try {
      return marked.parse(rawContent) as string;
    } catch (err) {
      console.error('[MarkdownPreview] Parse error:', err);
      return `<pre>${rawContent.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;
    }
  }, [rawContent]);

  // Sanitize HTML with DOMPurify
  const sanitizedHtml = useMemo(() => {
    DOMPurify.addHook('afterSanitizeAttributes', (node: Element) => {
      if (node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
    const result = DOMPurify.sanitize(htmlContent, {
      ADD_ATTR: ['target', 'rel'],
      // Defence-in-depth: block SVG/MathML escape hatches (foreignObject,
      // annotation-xml) that have historically been used to wrap iframes
      // or scripts past tag blocklists, plus legacy embed tags.
      FORBID_TAGS: [
        'style',
        'form',
        'input',
        'textarea',
        'select',
        'iframe',
        'object',
        'embed',
        'svg',
        'math',
        'foreignObject',
        'annotation-xml',
        'base',
        'meta',
        'link',
      ],
      FORBID_ATTR: ['style', 'srcdoc', 'formaction', 'ping'],
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    });
    DOMPurify.removeHook('afterSanitizeAttributes');
    return result;
  }, [htmlContent]);

  // Word count
  const wordCount = useMemo(() => {
    return rawContent.split(/\s+/).filter((w) => w.length > 0).length;
  }, [rawContent]);

  // Line count
  const lineCount = useMemo(() => {
    return rawContent.split('\n').length;
  }, [rawContent]);

  // Copy to clipboard
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(rawContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[MarkdownPreview] Failed to copy:', err);
    }
  }, [rawContent]);

  const containerClasses = clsx('markdown-preview', className);

  return (
    <div className={containerClasses}>
      {/* Toolbar */}
      <div className="markdown-preview__toolbar">
        <div className="markdown-preview__toolbar-left">
          <span className="markdown-preview__badge">Markdown</span>
          <span className="markdown-preview__stats">
            {lineCount} lignes &middot; {wordCount} mots
          </span>
        </div>

        <div className="markdown-preview__toolbar-right">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSource(!showSource)}
            title={showSource ? 'Apercu rendu' : 'Code source'}
            aria-label={showSource ? 'Apercu rendu' : 'Code source'}
            className={clsx({ 'markdown-preview__btn--active': showSource })}
          >
            {showSource ? <PreviewIcon /> : <SourceIcon />}
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

      {/* Content */}
      <div className="markdown-preview__container" ref={contentRef}>
        {showSource ? (
          <pre className="markdown-preview__source">{rawContent}</pre>
        ) : (
          <div
            className="markdown-preview__rendered"
            dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
          />
        )}
      </div>
    </div>
  );
};

export default MarkdownPreview;
