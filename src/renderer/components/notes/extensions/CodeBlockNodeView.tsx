/**
 * CodeBlockNodeView — Filarr Notes
 *
 * React NodeView for enhanced code blocks:
 * - Language selector dropdown
 * - Copy-to-clipboard button
 * - Line numbers
 * - Better visual rendering
 */

import React, { useCallback, useState, useRef, useEffect } from 'react';
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useTranslation } from 'react-i18next';

const POPULAR_LANGUAGES = [
  { value: '', label: 'Plain text' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'json', label: 'JSON' },
  { value: 'bash', label: 'Bash' },
  { value: 'sql', label: 'SQL' },
  { value: 'java', label: 'Java' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'php', label: 'PHP' },
  { value: 'swift', label: 'Swift' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'yaml', label: 'YAML' },
  { value: 'xml', label: 'XML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'graphql', label: 'GraphQL' },
  { value: 'dockerfile', label: 'Dockerfile' },
];

export const CodeBlockNodeView: React.FC<NodeViewProps> = ({ node, updateAttributes }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const language = node.attrs.language || '';
  const lineCount = (node.textContent || '').split('\n').length;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(node.textContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [node.textContent]);

  const handleLanguageChange = useCallback(
    (lang: string) => {
      updateAttributes({ language: lang || null });
      setDropdownOpen(false);
    },
    [updateAttributes]
  );

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  const displayLang =
    POPULAR_LANGUAGES.find((l) => l.value === language)?.label || language || 'Plain text';

  return (
    <NodeViewWrapper
      className={`code-block-wrapper ${collapsed ? 'code-block-wrapper--collapsed' : ''}`}
    >
      <div className="code-block-header" contentEditable={false}>
        {/* Fold/unfold toggle */}
        <button
          className={`code-block-fold ${collapsed ? 'code-block-fold--collapsed' : ''}`}
          onClick={() => setCollapsed(!collapsed)}
          type="button"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <polyline points={collapsed ? '9,6 15,12 9,18' : '6,9 12,15 18,9'} />
          </svg>
        </button>
        <div className="code-block-language" ref={dropdownRef}>
          <button
            className="code-block-language__btn"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            type="button"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <polyline points="16,18 22,12 16,6" />
              <polyline points="8,6 2,12 8,18" />
            </svg>
            <span>{displayLang}</span>
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <polyline points="6,9 12,15 18,9" />
            </svg>
          </button>
          {dropdownOpen && (
            <div className="code-block-language__dropdown">
              {POPULAR_LANGUAGES.map((l) => (
                <button
                  key={l.value}
                  className={`code-block-language__option ${l.value === language ? 'is-active' : ''}`}
                  onClick={() => handleLanguageChange(l.value)}
                  type="button"
                >
                  {l.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {collapsed && <span className="code-block-line-count">{lineCount} lines</span>}
        <div style={{ flex: 1 }} />
        <button
          className={`code-block-copy ${copied ? 'code-block-copy--copied' : ''}`}
          onClick={handleCopy}
          type="button"
          title="Copy code"
        >
          {copied ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <polyline points="20,6 9,17 4,12" />
            </svg>
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          )}
          <span>{copied ? t('common.copied', 'Copied') : t('common.copy', 'Copy')}</span>
        </button>
      </div>
      {!collapsed && (
        <pre>
          <NodeViewContent
            className={`code-block-content ${language ? `language-${language}` : ''}`}
          />
        </pre>
      )}
    </NodeViewWrapper>
  );
};

export default CodeBlockNodeView;
