/**
 * MermaidNodeView — Filarr Notes
 *
 * React NodeView for Mermaid diagram blocks.
 * Toggle between code editing and rendered diagram.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import { useBlockResize } from './useBlockResize';
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'strict',
  fontFamily: 'inherit',
});

interface MermaidNodeViewProps {
  node: { attrs: { code: string; blockWidthPx?: number | null; blockHeightPx?: number | null } };
  updateAttributes: (attrs: Record<string, unknown>) => void;
  /** Fourni par TipTap à toute vue de nœud ; `isEditable` distingue les surfaces en lecture seule. */
  editor?: { isEditable: boolean };
  selected: boolean;
}

let mermaidCounter = 0;

export const MermaidNodeView: React.FC<MermaidNodeViewProps> = ({
  node,
  updateAttributes,
  selected,
  editor,
}) => {
  // Le schéma est monté par QUATRE surfaces (éditeur, rendu de version, README
  // de dossier, coffre partagé), dont certaines en lecture seule : sans cette
  // garde, la poignée s'offrirait sur un rendu qu'on ne peut pas modifier.
  const readOnly = editor ? !editor.isEditable : false;
  const resize = useBlockResize(
    node.attrs.blockWidthPx,
    node.attrs.blockHeightPx,
    updateAttributes,
    {
      disabled: readOnly,
    }
  );
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState(node.attrs.code);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(`mermaid-${++mermaidCounter}-${Date.now()}`);

  const renderDiagram = useCallback(async () => {
    if (!containerRef.current || !code.trim()) return;
    try {
      const { svg } = await mermaid.render(idRef.current, code);
      if (containerRef.current) {
        containerRef.current.innerHTML = svg;
        // The raw SVG has no accessible name — expose the diagram source as a
        // label so screen readers announce something instead of nothing.
        containerRef.current.setAttribute('role', 'img');
        const firstLine = code.trim().split('\n')[0].slice(0, 120);
        containerRef.current.setAttribute('aria-label', `Diagramme Mermaid : ${firstLine}`);
        setError(null);
      }
    } catch (err: any) {
      setError(err?.message || 'Invalid mermaid syntax');
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    }
  }, [code]);

  useEffect(() => {
    if (!editing) {
      // Generate new ID for re-render
      idRef.current = `mermaid-${++mermaidCounter}-${Date.now()}`;
      renderDiagram();
    }
  }, [editing, renderDiagram]);

  const handleConfirm = useCallback(() => {
    updateAttributes({ code });
    setEditing(false);
  }, [code, updateAttributes]);

  if (editing) {
    return (
      <NodeViewWrapper className="mermaid-node mermaid-node--editing">
        <div className="mermaid-node__toolbar">
          <span className="mermaid-node__label">Mermaid Diagram</span>
          <button className="mermaid-node__btn" onClick={handleConfirm}>
            Done
          </button>
        </div>
        <textarea
          className="mermaid-node__input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setCode(node.attrs.code);
              setEditing(false);
            }
          }}
          onBlur={handleConfirm}
          rows={Math.max(4, code.split('\n').length + 1)}
          spellCheck={false}
          autoFocus
        />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      ref={resize.ref}
      className={`mermaid-node ${resize.className} ${selected ? 'mermaid-node--selected' : ''}`}
      style={resize.style}
      onClick={() => setEditing(true)}
      title="Click to edit"
    >
      {resize.grip}
      <div className="mermaid-node__toolbar">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="M2 2h8l4 4v14a2 2 0 01-2 2H4a2 2 0 01-2-2V4c0-1.1.9-2 2-2z" />
          <polyline points="14,2 14,8 20,8" />
        </svg>
        <span className="mermaid-node__label">Mermaid</span>
      </div>
      {error && <div className="mermaid-node__error">{error}</div>}
      <div ref={containerRef} className="mermaid-node__preview" />
    </NodeViewWrapper>
  );
};
