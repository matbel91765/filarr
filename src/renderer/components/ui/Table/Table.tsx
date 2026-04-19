import React, { useState, useEffect, useRef, useCallback } from 'react';
import './Table.css';

export interface Column<T> {
  key: string;
  header: string;
  accessor: (item: T) => React.ReactNode;
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
  headerClassName?: string;
  cellClassName?: string;
}

export interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (item: T) => string;
  onRowClick?: (item: T) => void;
  selectable?: boolean;
  selectedRows?: string[];
  onSelectionChange?: (selectedIds: string[]) => void;
  sortable?: boolean;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  onSort?: (column: string, direction: 'asc' | 'desc') => void;
  loading?: boolean;
  emptyMessage?: string;
  stickyHeader?: boolean;
  striped?: boolean;
  hoverable?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function Table<T>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  selectable = false,
  selectedRows = [],
  onSelectionChange,
  sortable = false,
  sortBy,
  sortDirection = 'asc',
  onSort,
  loading = false,
  emptyMessage = 'No data available',
  stickyHeader = false,
  striped = false,
  hoverable = true,
  size = 'md',
  className = '',
}: TableProps<T>) {
  const [internalSort, setInternalSort] = useState<{
    column: string | null;
    direction: 'asc' | 'desc';
  }>({
    column: sortBy || null,
    direction: sortDirection,
  });

  const [focusedRowIndex, setFocusedRowIndex] = useState<number>(-1);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number>(-1);
  const tableRef = useRef<HTMLDivElement>(null);

  const isControlled = sortBy !== undefined && onSort !== undefined;
  const currentSortColumn = isControlled ? sortBy : internalSort.column;
  const currentSortDirection = isControlled ? sortDirection : internalSort.direction;

  // Handle sort
  const handleSort = (columnKey: string) => {
    const column = columns.find(col => col.key === columnKey);
    if (!column?.sortable && !sortable) return;

    const newDirection =
      currentSortColumn === columnKey && currentSortDirection === 'asc'
        ? 'desc'
        : 'asc';

    if (isControlled) {
      onSort?.(columnKey, newDirection);
    } else {
      setInternalSort({ column: columnKey, direction: newDirection });
    }
  };

  // Handle selection
  const handleRowSelect = (itemId: string, index: number, shiftKey: boolean) => {
    if (!selectable || !onSelectionChange) return;

    let newSelection: string[];

    if (shiftKey && lastSelectedIndex !== -1) {
      // Range selection with Shift
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      const rangeIds = data
        .slice(start, end + 1)
        .map(item => keyExtractor(item));

      const combinedSet = new Set([...selectedRows, ...rangeIds]);
      newSelection = Array.from(combinedSet);
    } else {
      // Single selection toggle
      if (selectedRows.includes(itemId)) {
        newSelection = selectedRows.filter(id => id !== itemId);
      } else {
        newSelection = [...selectedRows, itemId];
      }
      setLastSelectedIndex(index);
    }

    onSelectionChange(newSelection);
  };

  // Select all / deselect all
  const handleSelectAll = () => {
    if (!selectable || !onSelectionChange) return;

    if (selectedRows.length === data.length) {
      onSelectionChange([]);
    } else {
      onSelectionChange(data.map(item => keyExtractor(item)));
    }
  };

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent, item: T, index: number) => {
    const itemId = keyExtractor(item);

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (index < data.length - 1) {
          setFocusedRowIndex(index + 1);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (index > 0) {
          setFocusedRowIndex(index - 1);
        }
        break;
      case ' ':
      case 'Enter':
        e.preventDefault();
        if (e.key === ' ' && selectable) {
          handleRowSelect(itemId, index, e.shiftKey);
        } else if (e.key === 'Enter' && onRowClick) {
          onRowClick(item);
        }
        break;
    }
  }, [data, keyExtractor, selectable, onRowClick]);

  // Focus management
  useEffect(() => {
    if (focusedRowIndex >= 0 && tableRef.current) {
      const rows = tableRef.current.querySelectorAll('[role="row"]');
      const targetRow = rows[focusedRowIndex + 1]; // +1 to skip header row
      if (targetRow instanceof HTMLElement) {
        targetRow.focus();
      }
    }
  }, [focusedRowIndex]);

  // Sort data
  const sortedData = React.useMemo(() => {
    if (!currentSortColumn || isControlled) return data;

    const column = columns.find(col => col.key === currentSortColumn);
    if (!column) return data;

    return [...data].sort((a, b) => {
      const aValue = column.accessor(a);
      const bValue = column.accessor(b);

      // Handle null/undefined
      if (aValue == null) return 1;
      if (bValue == null) return -1;

      // Convert to string for comparison
      const aStr = String(aValue);
      const bStr = String(bValue);

      const comparison = aStr.localeCompare(bStr, undefined, { numeric: true });
      return currentSortDirection === 'asc' ? comparison : -comparison;
    });
  }, [data, currentSortColumn, currentSortDirection, columns, isControlled]);

  // Render loading skeleton
  if (loading) {
    return (
      <div className={`table-container ${className}`} ref={tableRef}>
        <div className={`table table-${size}`}>
          <div className="table-header" role="rowgroup">
            <div className="table-row" role="row">
              {selectable && <div className="table-cell table-cell-checkbox" role="columnheader"></div>}
              {columns.map(column => (
                <div
                  key={column.key}
                  className={`table-cell ${column.headerClassName || ''}`}
                  role="columnheader"
                  style={{ width: column.width }}
                >
                  {column.header}
                </div>
              ))}
            </div>
          </div>
          <div className="table-body" role="rowgroup">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="table-row table-row-loading" role="row">
                {selectable && (
                  <div className="table-cell table-cell-checkbox" role="cell">
                    <div className="skeleton skeleton-checkbox"></div>
                  </div>
                )}
                {columns.map(column => (
                  <div
                    key={column.key}
                    className={`table-cell ${column.cellClassName || ''}`}
                    role="cell"
                    style={{ width: column.width }}
                  >
                    <div className="skeleton skeleton-text"></div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Render empty state
  if (data.length === 0) {
    return (
      <div className={`table-container ${className}`} ref={tableRef}>
        <div className={`table table-${size}`}>
          <div className="table-header" role="rowgroup">
            <div className="table-row" role="row">
              {selectable && <div className="table-cell table-cell-checkbox" role="columnheader"></div>}
              {columns.map(column => (
                <div
                  key={column.key}
                  className={`table-cell ${column.headerClassName || ''}`}
                  role="columnheader"
                  style={{ width: column.width }}
                >
                  {column.header}
                </div>
              ))}
            </div>
          </div>
          <div className="table-body table-empty" role="rowgroup">
            <div className="table-empty-state">
              <p>{emptyMessage}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isAllSelected = selectable && data.length > 0 && selectedRows.length === data.length;
  const isIndeterminate = selectable && selectedRows.length > 0 && selectedRows.length < data.length;

  return (
    <div className={`table-container ${className}`} ref={tableRef}>
      <div
        className={`table table-${size} ${stickyHeader ? 'table-sticky-header' : ''} ${
          striped ? 'table-striped' : ''
        } ${hoverable ? 'table-hoverable' : ''}`}
        role="table"
      >
        <div className="table-header" role="rowgroup">
          <div className="table-row" role="row">
            {selectable && (
              <div className="table-cell table-cell-checkbox" role="columnheader">
                <label className="table-checkbox">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    ref={(input) => {
                      if (input) {
                        input.indeterminate = isIndeterminate;
                      }
                    }}
                    onChange={handleSelectAll}
                    aria-label="Select all rows"
                  />
                  <span className="table-checkbox-custom"></span>
                </label>
              </div>
            )}
            {columns.map(column => {
              const isSortable = column.sortable !== undefined ? column.sortable : sortable;
              const isSorted = currentSortColumn === column.key;

              return (
                <div
                  key={column.key}
                  className={`table-cell ${column.headerClassName || ''} ${
                    isSortable ? 'table-cell-sortable' : ''
                  } ${isSorted ? 'table-cell-sorted' : ''}`}
                  role="columnheader"
                  aria-sort={
                    isSorted
                      ? currentSortDirection === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                  style={{ width: column.width, textAlign: column.align }}
                  onClick={() => isSortable && handleSort(column.key)}
                  tabIndex={isSortable ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (isSortable && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      handleSort(column.key);
                    }
                  }}
                >
                  <span className="table-cell-content">
                    {column.header}
                    {isSortable && (
                      <span className="table-sort-icon">
                        {isSorted ? (
                          currentSortDirection === 'asc' ? (
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                              <path d="M8 4l4 5H4l4-5z" />
                            </svg>
                          ) : (
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                              <path d="M8 12l-4-5h8l-4 5z" />
                            </svg>
                          )
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" opacity="0.3">
                            <path d="M8 4l3 4H5l3-4zM8 12l-3-4h6l-3 4z" />
                          </svg>
                        )}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="table-body" role="rowgroup">
          {sortedData.map((item, index) => {
            const itemId = keyExtractor(item);
            const isSelected = selectedRows.includes(itemId);

            return (
              <div
                key={itemId}
                className={`table-row ${isSelected ? 'table-row-selected' : ''} ${
                  onRowClick ? 'table-row-clickable' : ''
                }`}
                role="row"
                aria-selected={selectable ? isSelected : undefined}
                tabIndex={0}
                onClick={() => onRowClick?.(item)}
                onKeyDown={(e) => handleKeyDown(e, item, index)}
              >
                {selectable && (
                  <div className="table-cell table-cell-checkbox" role="cell">
                    <label
                      className="table-checkbox"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => handleRowSelect(itemId, index, (e.nativeEvent as MouseEvent).shiftKey)}
                        aria-label={`Select row ${index + 1}`}
                      />
                      <span className="table-checkbox-custom"></span>
                    </label>
                  </div>
                )}
                {columns.map(column => (
                  <div
                    key={column.key}
                    className={`table-cell ${column.cellClassName || ''}`}
                    role="cell"
                    style={{ width: column.width, textAlign: column.align }}
                  >
                    {column.accessor(item)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
