/**
 * InlineFolderPicker Component
 *
 * Inline folder picker with searchable tree for automation rules.
 * Uses a portal to render the dropdown, avoiding overflow clipping from parent containers.
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { useSelector } from 'react-redux';
import { selectAllFolders } from '../../../store/selectors/folderSelectors';
import type { Folder } from '../../../types';

interface InlineFolderPickerProps {
  value: string | null;
  onChange: (folderId: string, folder: Folder | null) => void;
  label?: string;
  placeholder?: string;
  className?: string;
}

// --- Internal FolderTreeNode ---

interface FolderTreeNodeProps {
  folder: Folder;
  level: number;
  selectedId: string | null;
  onSelect: (id: string, folder: Folder) => void;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  allFolders: Folder[];
  searchQuery: string;
}

const FolderTreeNode: React.FC<FolderTreeNodeProps> = ({
  folder,
  level,
  selectedId,
  onSelect,
  expandedIds,
  onToggleExpand,
  allFolders,
  searchQuery,
}) => {
  const isExpanded = expandedIds.has(folder.id);
  const isSelected = selectedId === folder.id;

  const children = useMemo(
    () => allFolders.filter((f) => f.parentId === folder.id),
    [allFolders, folder.id]
  );
  const hasChildren = children.length > 0;

  const isMatch =
    searchQuery && folder.name.toLowerCase().includes(searchQuery.toLowerCase());

  return (
    <div>
      <div
        className={`flex items-center gap-1.5 py-1.5 px-2 rounded-md cursor-pointer text-xs transition-colors duration-100
          ${isSelected
            ? 'bg-[var(--color-primary)] text-white'
            : isMatch
            ? 'bg-[var(--color-primary-50)] text-[var(--color-text-primary)] hover:bg-[var(--color-primary-100)]'
            : 'text-[var(--color-text-primary)] hover:bg-[var(--color-primary-50)]'
          }`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={() => onSelect(folder.id, folder)}
      >
        {/* Expand chevron */}
        <button
          type="button"
          className={`flex items-center justify-center w-4 h-4 shrink-0 transition-transform duration-150 ${
            isExpanded ? 'rotate-90' : ''
          } ${hasChildren ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggleExpand(folder.id);
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M3.5 1.5L7 5L3.5 8.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {/* Folder icon */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          className={`shrink-0 ${isSelected ? 'text-white' : 'text-[var(--color-primary)]'}`}
        >
          <path
            d="M2 4V12C2 12.5523 2.44772 13 3 13H13C13.5523 13 14 12.5523 14 12V6C14 5.44772 13.5523 5 13 5H8.5L7.29289 3.79289C7.10536 3.60536 6.851 3.5 6.58579 3.5H3C2.44772 3.5 2 3.94772 2 4.5V4Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        {/* Name */}
        <span className="truncate">{folder.name}</span>
      </div>

      {isExpanded && hasChildren && (
        <div>
          {children.map((child) => (
            <FolderTreeNode
              key={child.id}
              folder={child}
              level={level + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              allFolders={allFolders}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// --- Main Component ---

export const InlineFolderPicker: React.FC<InlineFolderPickerProps> = ({
  value,
  onChange,
  label,
  placeholder: placeholderProp,
  className,
}) => {
  const { t } = useTranslation();
  const placeholder = placeholderProp || t('automation.folderPicker.selectFolder');
  const allFolders = useSelector(selectAllFolders);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Find the selected folder
  const selectedFolder = useMemo(
    () => (value ? allFolders.find((f) => f.id === value) || null : null),
    [value, allFolders]
  );

  // Build breadcrumb path for selected folder
  const folderPath = useMemo(() => {
    if (!selectedFolder) return '';
    const parts: string[] = [];
    let current: Folder | undefined = selectedFolder;
    while (current) {
      parts.unshift(current.name);
      current = current.parentId
        ? allFolders.find((f) => f.id === current!.parentId)
        : undefined;
    }
    return parts.join(' / ');
  }, [selectedFolder, allFolders]);

  // Root folders
  const rootFolders = useMemo(
    () => allFolders.filter((f) => !f.parentId || f.parentId === 'root'),
    [allFolders]
  );

  // Filter folders by search
  const filteredRootFolders = useMemo(() => {
    if (!searchQuery) return rootFolders;

    const matching = allFolders.filter((f) =>
      f.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const toShow = new Set<string>();
    matching.forEach((folder) => {
      toShow.add(folder.id);
      let parentId = folder.parentId;
      while (parentId) {
        toShow.add(parentId);
        const parent = allFolders.find((f) => f.id === parentId);
        parentId = parent?.parentId;
      }
    });

    return rootFolders.filter((f) => toShow.has(f.id));
  }, [rootFolders, allFolders, searchQuery]);

  // Auto-expand parents of matching folders during search
  useEffect(() => {
    if (!searchQuery) return;
    const newExpanded = new Set<string>();
    allFolders.forEach((folder) => {
      if (folder.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        let parentId = folder.parentId;
        while (parentId) {
          newExpanded.add(parentId);
          const parent = allFolders.find((f) => f.id === parentId);
          parentId = parent?.parentId;
        }
      }
    });
    setExpandedIds(newExpanded);
  }, [searchQuery, allFolders]);

  // Compute dropdown position from trigger button
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setDropdownPos({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  }, []);

  // Open/close handler
  const toggleOpen = useCallback(() => {
    if (!isOpen) {
      updatePosition();
    }
    setIsOpen((prev) => !prev);
  }, [isOpen, updatePosition]);

  // Click outside to close (check both trigger and dropdown)
  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) {
        return;
      }
      setIsOpen(false);
      setSearchQuery('');
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen]);

  // Reposition on scroll/resize while open
  useEffect(() => {
    if (!isOpen) return;
    const handleReposition = () => updatePosition();
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [isOpen, updatePosition]);

  // Focus search when opened
  useEffect(() => {
    if (isOpen && searchRef.current) {
      searchRef.current.focus();
    }
  }, [isOpen]);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (id: string, folder: Folder) => {
      onChange(id, folder);
      setIsOpen(false);
      setSearchQuery('');
    },
    [onChange]
  );

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onChange('', null);
    },
    [onChange]
  );

  const dropdown = isOpen && dropdownPos && createPortal(
    <div
      ref={dropdownRef}
      className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg overflow-hidden"
      style={{
        position: 'fixed',
        zIndex: 9999,
        top: dropdownPos.top,
        left: dropdownPos.left,
        width: dropdownPos.width,
      }}
    >
      {/* Search */}
      <div className="p-2 border-b border-[var(--color-border)]">
        <div className="relative">
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
          >
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={searchRef}
            type="text"
            placeholder={t('automation.folderPicker.searchFolder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-background-secondary)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
          />
        </div>
      </div>

      {/* Tree */}
      <div className="max-h-48 overflow-y-auto p-1.5">
        {filteredRootFolders.length === 0 ? (
          <div className="py-4 text-center text-xs text-[var(--color-text-tertiary)]">
            {searchQuery ? t('automation.folderPicker.noFolderFound') : t('automation.folderPicker.noFolderAvailable')}
          </div>
        ) : (
          filteredRootFolders.map((folder) => (
            <FolderTreeNode
              key={folder.id}
              folder={folder}
              level={0}
              selectedId={value}
              onSelect={handleSelect}
              expandedIds={expandedIds}
              onToggleExpand={handleToggleExpand}
              allFolders={allFolders}
              searchQuery={searchQuery}
            />
          ))
        )}
      </div>
    </div>,
    document.body
  );

  return (
    <div className={className || ''}>
      {label && (
        <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
          {label}
        </label>
      )}

      {/* Trigger button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleOpen}
        className={`flex items-center gap-2 w-full px-3 py-2 text-xs text-left rounded-lg border transition-colors duration-150
          ${isOpen
            ? 'border-[var(--color-primary)] ring-1 ring-[var(--color-primary)] bg-[var(--color-surface)]'
            : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-primary-200)]'
          }`}
      >
        {/* Folder icon */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          className={`shrink-0 ${selectedFolder ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-tertiary)]'}`}
        >
          <path
            d="M2 4V12C2 12.5523 2.44772 13 3 13H13C13.5523 13 14 12.5523 14 12V6C14 5.44772 13.5523 5 13 5H8.5L7.29289 3.79289C7.10536 3.60536 6.851 3.5 6.58579 3.5H3C2.44772 3.5 2 3.94772 2 4.5V4Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        {/* Label / path */}
        <span
          className={`flex-1 truncate ${
            selectedFolder ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-tertiary)]'
          }`}
        >
          {selectedFolder ? folderPath : placeholder}
        </span>

        {/* Clear button */}
        {selectedFolder && (
          <span
            role="button"
            tabIndex={0}
            onClick={handleClear}
            onKeyDown={(e) => { if (e.key === 'Enter') handleClear(e as any); }}
            className="flex items-center justify-center w-4 h-4 shrink-0 rounded-full text-[var(--color-text-tertiary)] hover:bg-[var(--color-border)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M8 2L2 8M2 2L8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
        )}

        {/* Chevron */}
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          className={`shrink-0 text-[var(--color-text-tertiary)] transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
        >
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {dropdown}
    </div>
  );
};

export default InlineFolderPicker;
