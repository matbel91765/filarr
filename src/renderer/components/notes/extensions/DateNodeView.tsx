/**
 * DateNodeView — Filarr Notes
 *
 * Inline date chip with click-to-edit date picker.
 */

import React, { useCallback, useRef, useState } from 'react';
import { NodeViewWrapper } from '@tiptap/react';

interface DateNodeViewProps {
  node: { attrs: { date: string } };
  updateAttributes: (attrs: Record<string, unknown>) => void;
  selected: boolean;
}

function formatDisplayDate(iso: string): string {
  try {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

export const DateNodeView: React.FC<DateNodeViewProps> = ({ node, updateAttributes, selected }) => {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateAttributes({ date: e.target.value });
      setEditing(false);
    },
    [updateAttributes]
  );

  if (editing) {
    return (
      <NodeViewWrapper as="span" className="inline-date inline-date--editing">
        <input
          ref={inputRef}
          type="date"
          className="inline-date__picker"
          defaultValue={node.attrs.date}
          onChange={handleChange}
          onBlur={() => setEditing(false)}
          autoFocus
        />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="span"
      className={`inline-date ${selected ? 'inline-date--selected' : ''}`}
      onClick={() => setEditing(true)}
      title="Click to change date"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ verticalAlign: 'middle', marginRight: 3 }}>
        <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
      </svg>
      <span>{formatDisplayDate(node.attrs.date)}</span>
    </NodeViewWrapper>
  );
};
