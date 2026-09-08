/**
 * MathNodeView — Filarr Notes
 *
 * React NodeView for both inline and block math.
 * Renders KaTeX output; click to edit the LaTeX source.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface MathNodeViewProps {
  node: { type: { name: string }; attrs: { latex: string } };
  updateAttributes: (attrs: Record<string, unknown>) => void;
  selected: boolean;
}

export const MathNodeView: React.FC<MathNodeViewProps> = ({ node, updateAttributes, selected }) => {
  const [editing, setEditing] = useState(!node.attrs.latex);
  const [latex, setLatex] = useState(node.attrs.latex || '');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const isBlock = node.type.name === 'mathBlock';

  // Render KaTeX
  useEffect(() => {
    if (!editing && previewRef.current && latex) {
      try {
        // 'htmlAndMathml' emits the MathML layer KaTeX otherwise suppresses,
        // giving screen readers accessible math instead of styled spans.
        katex.render(latex, previewRef.current, {
          displayMode: isBlock,
          throwOnError: false,
          output: 'htmlAndMathml',
        });
        // Expose the source as an accessible label + role for AT.
        previewRef.current.setAttribute('role', 'math');
        previewRef.current.setAttribute('aria-label', latex);
      } catch {
        previewRef.current.textContent = latex;
      }
    }
  }, [editing, latex, isBlock]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const handleConfirm = useCallback(() => {
    updateAttributes({ latex });
    setEditing(false);
  }, [latex, updateAttributes]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || (!isBlock && !e.shiftKey))) {
        e.preventDefault();
        handleConfirm();
      }
      if (e.key === 'Escape') {
        setLatex(node.attrs.latex);
        setEditing(false);
      }
    },
    [handleConfirm, isBlock, node.attrs.latex]
  );

  if (editing) {
    return (
      <NodeViewWrapper
        as={isBlock ? 'div' : 'span'}
        className={`math-node math-node--editing ${isBlock ? 'math-node--block' : 'math-node--inline'}`}
      >
        <textarea
          ref={inputRef}
          className="math-node__input"
          value={latex}
          onChange={(e) => setLatex(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleConfirm}
          placeholder={isBlock ? 'LaTeX (Ctrl+Enter to confirm)' : 'LaTeX (Enter to confirm)'}
          rows={isBlock ? 3 : 1}
        />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as={isBlock ? 'div' : 'span'}
      className={`math-node ${isBlock ? 'math-node--block' : 'math-node--inline'} ${selected ? 'math-node--selected' : ''}`}
      onClick={() => setEditing(true)}
      title="Click to edit"
    >
      {latex ? (
        <span ref={previewRef} className="math-node__preview" />
      ) : (
        <span className="math-node__placeholder">{isBlock ? '$$...$$' : '$...$'}</span>
      )}
    </NodeViewWrapper>
  );
};
