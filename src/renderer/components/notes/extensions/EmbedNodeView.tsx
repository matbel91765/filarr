/**
 * EmbedNodeView — Filarr Notes
 *
 * React NodeView for embedded URLs.
 * Renders YouTube/Vimeo as iframes, others as link cards.
 */

import React, { useState } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import { useBlockResize } from './useBlockResize';

interface EmbedNodeViewProps {
  node: {
    attrs: {
      url: string;
      title: string;
      embedType: string;
      embedId: string;
      /** Largeur en pixels réglée à la poignée ; `null` = largeur d'office. */
      blockWidthPx?: number | null;
    };
  };
  updateAttributes: (attrs: Record<string, unknown>) => void;
  /** Fourni par TipTap à toute vue de nœud ; `isEditable` distingue les surfaces en lecture seule. */
  editor?: { isEditable: boolean };
  selected: boolean;
}

export const EmbedNodeView: React.FC<EmbedNodeViewProps> = ({
  node,
  updateAttributes,
  selected,
  editor,
}) => {
  const { url, title, embedType, embedId } = node.attrs;
  // Le schéma est monté par QUATRE surfaces (éditeur, rendu de version, README
  // de dossier, coffre partagé), dont certaines en lecture seule : sans cette
  // garde, la poignée s'offrirait sur un rendu qu'on ne peut pas modifier.
  const readOnly = editor ? !editor.isEditable : false;
  // Pas de hauteur : une vidéo a un rapport d'image, sa hauteur découle de sa
  // largeur. Lui en imposer une autre ne bornerait rien, ça rognerait.
  const resize = useBlockResize(node.attrs.blockWidthPx, null, updateAttributes, {
    disabled: readOnly,
    height: false,
  });

  const [editing, setEditing] = useState(!url);
  const [inputUrl, setInputUrl] = useState(url);

  if (editing) {
    return (
      <NodeViewWrapper className="embed-node embed-node--editing">
        <div className="embed-node__input-row">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
          </svg>
          <input
            className="embed-node__input"
            type="url"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && inputUrl.trim()) {
                const { type, id } = detectType(inputUrl.trim());
                updateAttributes({ url: inputUrl.trim(), embedType: type, embedId: id });
                setEditing(false);
              }
              if (e.key === 'Escape') setEditing(false);
            }}
            placeholder="Paste URL (YouTube, Vimeo, or any link)..."
            autoFocus
          />
        </div>
      </NodeViewWrapper>
    );
  }

  if (embedType === 'youtube' && embedId) {
    return (
      <NodeViewWrapper
        ref={resize.ref}
        className={`embed-node embed-node--youtube ${resize.className} ${selected ? 'embed-node--selected' : ''}`}
        style={resize.style}
      >
        <div className="embed-node__iframe-wrapper">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${embedId}`}
            title={title || 'YouTube video'}
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="embed-node__iframe"
          />
        </div>
        <div className="embed-node__footer" onClick={() => setEditing(true)}>
          <span className="embed-node__url">{url}</span>
        </div>
        {resize.grip}
      </NodeViewWrapper>
    );
  }

  if (embedType === 'vimeo' && embedId) {
    return (
      <NodeViewWrapper
        ref={resize.ref}
        className={`embed-node embed-node--vimeo ${resize.className} ${selected ? 'embed-node--selected' : ''}`}
        style={resize.style}
      >
        <div className="embed-node__iframe-wrapper">
          <iframe
            src={`https://player.vimeo.com/video/${embedId}`}
            title={title || 'Vimeo video'}
            frameBorder="0"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            className="embed-node__iframe"
          />
        </div>
        <div className="embed-node__footer" onClick={() => setEditing(true)}>
          <span className="embed-node__url">{url}</span>
        </div>
        {resize.grip}
      </NodeViewWrapper>
    );
  }

  // Generic link card
  return (
    <NodeViewWrapper
      ref={resize.ref}
      className={`embed-node embed-node--link ${resize.className} ${selected ? 'embed-node--selected' : ''}`}
      style={resize.style}
    >
      <a href={url} target="_blank" rel="noopener noreferrer" className="embed-node__link-card">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
          <polyline points="15,3 21,3 21,9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
        <span className="embed-node__link-url">{url}</span>
      </a>
      <button className="embed-node__edit-btn" onClick={() => setEditing(true)} title="Edit URL">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      </button>
      {resize.grip}
    </NodeViewWrapper>
  );
};

function detectType(url: string): { type: string; id: string } {
  const ytMatch = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/
  );
  if (ytMatch) return { type: 'youtube', id: ytMatch[1] };
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) return { type: 'vimeo', id: vimeoMatch[1] };
  return { type: 'link', id: '' };
}
