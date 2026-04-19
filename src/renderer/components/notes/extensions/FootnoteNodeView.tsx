/**
 * FootnoteNodeView — Filarr Notes
 *
 * Renders a superscript footnote number. Click to view/edit content.
 * Number is computed by counting all footnote nodes before this one.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NodeViewWrapper } from '@tiptap/react';

interface FootnoteNodeViewProps {
  node: { attrs: { content: string } };
  updateAttributes: (attrs: Record<string, unknown>) => void;
  editor: any;
  getPos: () => number;
  selected: boolean;
}

export const FootnoteNodeView: React.FC<FootnoteNodeViewProps> = ({
  node,
  updateAttributes,
  editor,
  getPos,
  selected,
}) => {
  const [editing, setEditing] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [footnoteNumber, setFootnoteNumber] = useState(1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Compute footnote number from document position
  useEffect(() => {
    if (!editor) return;
    let count = 0;
    const myPos = getPos();
    editor.state.doc.descendants((n: any, pos: number) => {
      if (n.type.name === 'footnote' && pos < myPos) {
        count++;
      }
    });
    setFootnoteNumber(count + 1);
  }, [editor, getPos, editor?.state?.doc]);

  const handleSave = useCallback(() => {
    setEditing(false);
  }, []);

  if (editing) {
    return (
      <NodeViewWrapper as="span" className="footnote-ref footnote-ref--editing">
        <sup className="footnote-ref__number">{footnoteNumber}</sup>
        <span className="footnote-ref__editor" contentEditable={false}>
          <textarea
            ref={textareaRef}
            className="footnote-ref__textarea"
            value={node.attrs.content}
            onChange={(e) => updateAttributes({ content: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSave();
              }
              if (e.key === 'Escape') handleSave();
            }}
            onBlur={handleSave}
            autoFocus
            rows={2}
            placeholder="Footnote content..."
          />
        </span>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="span"
      className={`footnote-ref ${selected ? 'footnote-ref--selected' : ''}`}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onClick={() => setEditing(true)}
      title={node.attrs.content || 'Click to add footnote content'}
    >
      <sup className="footnote-ref__number">{footnoteNumber}</sup>
      {showTooltip && node.attrs.content && (
        <span className="footnote-ref__tooltip" contentEditable={false}>
          {node.attrs.content}
        </span>
      )}
    </NodeViewWrapper>
  );
};
