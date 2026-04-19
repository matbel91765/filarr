/**
 * BookmarkNodeView — Filarr Notes
 *
 * React NodeView for web link bookmark cards.
 * On mount, if not yet fetched, calls `fetchPageMetadata` IPC to get
 * title, description, image, favicon, domain from the URL.
 * Shows editing mode (URL input), loading skeleton, or rich preview card.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NodeViewWrapper } from '@tiptap/react';

interface BookmarkNodeViewProps {
  node: {
    attrs: {
      url: string;
      title: string;
      description: string;
      image: string;
      favicon: string;
      domain: string;
      fetched: boolean;
    };
  };
  updateAttributes: (attrs: Record<string, unknown>) => void;
  selected: boolean;
  deleteNode: () => void;
}

export const BookmarkNodeView: React.FC<BookmarkNodeViewProps> = ({
  node,
  updateAttributes,
  selected,
  deleteNode,
}) => {
  const { url, title, description, image, favicon, domain, fetched } = node.attrs;
  const [editing, setEditing] = useState(!url);
  const [inputUrl, setInputUrl] = useState(url);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const fetchedRef = useRef(false);

  // Auto-fetch metadata when we have a URL but haven't fetched yet,
  // or if stored images are raw URLs (not data URIs) — re-fetch to fix CSP
  const needsRefetch = fetched && (
    (image && image.startsWith('http')) || (favicon && favicon.startsWith('http'))
  );

  useEffect(() => {
    if (!url || loading) return;
    if (fetched && !needsRefetch) return;
    if (fetchedRef.current && !needsRefetch) return;
    fetchedRef.current = true;
    fetchMetadata(url);
  }, [url, fetched, needsRefetch]);

  const fetchMetadata = useCallback(async (targetUrl: string) => {
    setLoading(true);
    setError(false);
    try {
      const ipc = (window as any).electron?.ipcRenderer;
      if (!ipc) {
        setError(true);
        setLoading(false);
        return;
      }
      const meta = await ipc.invoke('fetchPageMetadata', targetUrl);
      if (meta) {
        updateAttributes({
          title: meta.title || '',
          description: meta.description || '',
          image: meta.image || '',
          favicon: meta.favicon || '',
          domain: meta.domain || '',
          fetched: true,
        });
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [updateAttributes]);

  const handleSubmitUrl = useCallback((rawUrl: string) => {
    const trimmed = rawUrl.trim();
    if (!trimmed) return;
    // Prepend https:// if no protocol
    const finalUrl = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
    updateAttributes({ url: finalUrl, fetched: false });
    setInputUrl(finalUrl);
    setEditing(false);
    fetchedRef.current = false;
  }, [updateAttributes]);

  const handleOpen = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, [url]);

  // Editing mode: URL input
  if (editing) {
    return (
      <NodeViewWrapper className="bookmark-card bookmark-card--editing">
        <div className="bookmark-card__input-row">
          <svg className="bookmark-card__link-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
          </svg>
          <input
            className="bookmark-card__input"
            type="url"
            value={inputUrl}
            onChange={e => setInputUrl(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleSubmitUrl(inputUrl);
              if (e.key === 'Escape') {
                if (!url) deleteNode();
                else setEditing(false);
              }
            }}
            placeholder="Paste a URL..."
            autoFocus
          />
        </div>
      </NodeViewWrapper>
    );
  }

  // Loading skeleton
  if (loading) {
    return (
      <NodeViewWrapper className="bookmark-card bookmark-card--loading">
        <div className="bookmark-card__skeleton">
          <div className="bookmark-card__skeleton-text">
            <div className="bookmark-card__skeleton-line bookmark-card__skeleton-line--title" />
            <div className="bookmark-card__skeleton-line bookmark-card__skeleton-line--desc" />
            <div className="bookmark-card__skeleton-line bookmark-card__skeleton-line--domain" />
          </div>
          <div className="bookmark-card__skeleton-thumb" />
        </div>
      </NodeViewWrapper>
    );
  }

  // Rich preview card
  return (
    <NodeViewWrapper className={`bookmark-card ${selected ? 'bookmark-card--selected' : ''} ${error ? 'bookmark-card--error' : ''}`}>
      <a
        className="bookmark-card__link"
        href={url}
        onClick={handleOpen}
        target="_blank"
        rel="noopener noreferrer"
      >
        <div className="bookmark-card__text">
          {title && <div className="bookmark-card__title">{title}</div>}
          {description && <div className="bookmark-card__desc">{description}</div>}
          <div className="bookmark-card__meta">
            {favicon && !favicon.startsWith('http') && <img className="bookmark-card__favicon" src={favicon} alt="" width={16} height={16} />}
            <span className="bookmark-card__domain">{domain || url}</span>
          </div>
        </div>
        {image && !image.startsWith('http') && (
          <div className="bookmark-card__thumb">
            <img src={image} alt="" />
          </div>
        )}
      </a>
      <button
        className="bookmark-card__edit-btn"
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        title="Edit URL"
        contentEditable={false}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </button>
    </NodeViewWrapper>
  );
};
