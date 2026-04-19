/**
 * CalloutNodeView — Filarr Notes
 *
 * React NodeView for interactive callout blocks:
 * - Icon button opens a type picker popover (5x2 grid)
 * - Chevron toggles collapse/expand of the body
 * - Editable inline title
 * - NodeViewContent for block content
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import { CALLOUT_TYPES, getCalloutMeta } from './calloutExtension';
import type { CalloutType } from './calloutExtension';

interface CalloutNodeViewProps {
  node: {
    attrs: {
      type: CalloutType;
      collapsed: boolean;
      title: string;
    };
  };
  updateAttributes: (attrs: Record<string, unknown>) => void;
  selected: boolean;
  deleteNode: () => void;
  editor: any;
}

export const CalloutNodeView: React.FC<CalloutNodeViewProps> = ({
  node,
  updateAttributes,
  selected,
}) => {
  const { type, collapsed, title } = node.attrs;
  const meta = getCalloutMeta(type);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const iconBtnRef = useRef<HTMLButtonElement>(null);

  // Close picker on outside click
  useEffect(() => {
    if (!pickerOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        pickerRef.current && !pickerRef.current.contains(e.target as Node) &&
        iconBtnRef.current && !iconBtnRef.current.contains(e.target as Node)
      ) {
        setPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [pickerOpen]);

  const handleToggleCollapse = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    updateAttributes({ collapsed: !collapsed });
  }, [collapsed, updateAttributes]);

  const handleSelectType = useCallback((newType: CalloutType) => {
    updateAttributes({ type: newType });
    setPickerOpen(false);
  }, [updateAttributes]);

  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateAttributes({ title: e.target.value });
  }, [updateAttributes]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Focus the content area below
      const wrapper = (e.target as HTMLElement).closest('.callout');
      const content = wrapper?.querySelector('.callout__body [contenteditable]') as HTMLElement;
      content?.focus();
    }
  }, []);

  return (
    <NodeViewWrapper
      className={`callout callout--${type} ${collapsed ? 'callout--collapsed' : ''} ${selected ? 'callout--selected' : ''}`}
      data-callout=""
      data-callout-type={type}
      data-collapsed={String(collapsed)}
    >
      {/* Left strip: icon + chevron */}
      <div className="callout__left">
        <button
          ref={iconBtnRef}
          className="callout__icon-btn"
          onClick={(e) => { e.stopPropagation(); setPickerOpen(!pickerOpen); }}
          title="Change callout type"
          contentEditable={false}
        >
          {meta.icon}
        </button>

        <button
          className={`callout__chevron ${collapsed ? 'callout__chevron--collapsed' : ''}`}
          onClick={handleToggleCollapse}
          title={collapsed ? 'Expand' : 'Collapse'}
          contentEditable={false}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {/* Type picker popover */}
        {pickerOpen && (
          <div ref={pickerRef} className="callout__type-picker" contentEditable={false}>
            {CALLOUT_TYPES.map(ct => (
              <button
                key={ct.type}
                className={`callout__type-option ${ct.type === type ? 'callout__type-option--active' : ''}`}
                onClick={(e) => { e.stopPropagation(); handleSelectType(ct.type); }}
                title={ct.type}
                style={{ '--callout-option-color': ct.color } as React.CSSProperties}
              >
                <span className="callout__type-option-icon">{ct.icon}</span>
                <span className="callout__type-option-label">{ct.type}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right: title + content */}
      <div className="callout__main">
        <div className="callout__title-row" contentEditable={false}>
          <input
            className="callout__title-input"
            value={title}
            onChange={handleTitleChange}
            onKeyDown={handleTitleKeyDown}
            placeholder={`${type.charAt(0).toUpperCase() + type.slice(1)}`}
            spellCheck={false}
          />
        </div>
        <div className={`callout__body ${collapsed ? 'callout__body--hidden' : ''}`}>
          <NodeViewContent className="callout__content" />
        </div>
      </div>
    </NodeViewWrapper>
  );
};
