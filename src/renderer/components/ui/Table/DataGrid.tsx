import React, { useState, useMemo } from 'react';
import { Table, TableProps } from './Table';
import { TablePagination } from './TablePagination';
import './Table.css';

export interface Filter {
  key: string;
  label: string;
  type: 'select' | 'text' | 'date';
  options?: { value: string; label: string }[];
  value?: any;
}

export interface Action<T = any> {
  label: string;
  icon?: React.ReactNode;
  onClick: (item: T) => void;
  variant?: 'default' | 'danger';
}

export interface BulkAction {
  label: string;
  icon?: React.ReactNode;
  onClick: (selectedIds: string[]) => void;
  variant?: 'default' | 'danger';
}

export interface DataGridProps<T> extends TableProps<T> {
  pagination?: boolean;
  pageSize?: number;
  currentPage?: number;
  totalItems?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  searchable?: boolean;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  filters?: Filter[];
  onFilterChange?: (filters: Filter[]) => void;
  actions?: Action<T>[];
  bulkActions?: BulkAction[];
}

export function DataGrid<T>({
  columns,
  data,
  keyExtractor,
  pagination = false,
  pageSize = 25,
  currentPage = 1,
  totalItems,
  onPageChange,
  onPageSizeChange,
  searchable = false,
  searchValue = '',
  onSearchChange,
  filters = [],
  onFilterChange,
  actions = [],
  bulkActions = [],
  selectedRows = [],
  onSelectionChange,
  ...tableProps
}: DataGridProps<T>) {
  const [internalSearchValue, setInternalSearchValue] = useState(searchValue);
  const [activeFilters, setActiveFilters] = useState<Filter[]>(filters);
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);

  const isSearchControlled = searchValue !== undefined && onSearchChange !== undefined;
  const currentSearchValue = isSearchControlled ? searchValue : internalSearchValue;

  // Handle search
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (isSearchControlled) {
      onSearchChange?.(value);
    } else {
      setInternalSearchValue(value);
    }
  };

  // Handle filter change
  const handleFilterChange = (filterKey: string, value: any) => {
    const updatedFilters = activeFilters.map(filter =>
      filter.key === filterKey ? { ...filter, value } : filter
    );
    setActiveFilters(updatedFilters);
    onFilterChange?.(updatedFilters);
  };

  // Add actions column if actions are provided
  const columnsWithActions = useMemo(() => {
    if (actions.length === 0) return columns;

    return [
      ...columns,
      {
        key: '__actions',
        header: 'Actions',
        width: '120px',
        align: 'center' as const,
        accessor: (item: T) => {
          const itemId = keyExtractor(item);
          const isMenuOpen = openActionMenuId === itemId;

          return (
            <div className="table-actions">
              <button
                className="table-actions-button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenActionMenuId(isMenuOpen ? null : itemId);
                }}
                aria-label="Open actions menu"
                aria-expanded={isMenuOpen}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <circle cx="8" cy="3" r="1.5" />
                  <circle cx="8" cy="8" r="1.5" />
                  <circle cx="8" cy="13" r="1.5" />
                </svg>
              </button>
              {isMenuOpen && (
                <>
                  <div
                    className="table-actions-backdrop"
                    onClick={() => setOpenActionMenuId(null)}
                  />
                  <div className="table-actions-menu">
                    {actions.map((action, index) => (
                      <button
                        key={index}
                        className={`table-actions-menu-item ${
                          action.variant === 'danger' ? 'table-actions-menu-item-danger' : ''
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          action.onClick(item);
                          setOpenActionMenuId(null);
                        }}
                      >
                        {action.icon && <span className="table-actions-menu-icon">{action.icon}</span>}
                        {action.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        },
      },
    ];
  }, [columns, actions, keyExtractor, openActionMenuId]);

  // Pagination calculations
  const totalPages = totalItems
    ? Math.ceil(totalItems / pageSize)
    : Math.ceil(data.length / pageSize);

  const paginatedData = useMemo(() => {
    if (!pagination || totalItems) {
      // If totalItems is provided, assume server-side pagination
      return data;
    }

    // Client-side pagination
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return data.slice(startIndex, endIndex);
  }, [data, pagination, currentPage, pageSize, totalItems]);

  const displayedItemsCount = totalItems || data.length;
  // Variables for potential future use (pagination info display)
  // const startItem = (currentPage - 1) * pageSize + 1;
  // const endItem = Math.min(currentPage * pageSize, displayedItemsCount);

  return (
    <div className="data-grid">
      {/* Toolbar */}
      {(searchable || filters.length > 0 || (bulkActions.length > 0 && selectedRows.length > 0)) && (
        <div className="data-grid-toolbar">
          {/* Bulk actions */}
          {bulkActions.length > 0 && selectedRows.length > 0 && (
            <div className="data-grid-bulk-actions">
              <span className="data-grid-bulk-actions-count">
                {selectedRows.length} selected
              </span>
              {bulkActions.map((action, index) => (
                <button
                  key={index}
                  className={`data-grid-bulk-action ${
                    action.variant === 'danger' ? 'data-grid-bulk-action-danger' : ''
                  }`}
                  onClick={() => action.onClick(selectedRows)}
                >
                  {action.icon && <span className="data-grid-bulk-action-icon">{action.icon}</span>}
                  {action.label}
                </button>
              ))}
            </div>
          )}

          {/* Search */}
          {searchable && !(bulkActions.length > 0 && selectedRows.length > 0) && (
            <div className="data-grid-search">
              <div className="data-grid-search-input-wrapper">
                <svg
                  className="data-grid-search-icon"
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M11.5 7a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zm-.82 4.74a6 6 0 111.06-1.06l3.04 3.04a.75.75 0 11-1.06 1.06l-3.04-3.04z"
                  />
                </svg>
                <input
                  type="text"
                  className="data-grid-search-input"
                  placeholder="Search..."
                  value={currentSearchValue}
                  onChange={handleSearchChange}
                  aria-label="Search"
                />
                {currentSearchValue && (
                  <button
                    className="data-grid-search-clear"
                    onClick={() => {
                      if (isSearchControlled) {
                        onSearchChange?.('');
                      } else {
                        setInternalSearchValue('');
                      }
                    }}
                    aria-label="Clear search"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Filters */}
          {filters.length > 0 && !(bulkActions.length > 0 && selectedRows.length > 0) && (
            <div className="data-grid-filters">
              {activeFilters.map(filter => (
                <div key={filter.key} className="data-grid-filter">
                  <label className="data-grid-filter-label">{filter.label}</label>
                  {filter.type === 'select' && (
                    <select
                      className="data-grid-filter-select"
                      value={filter.value || ''}
                      onChange={(e) => handleFilterChange(filter.key, e.target.value)}
                    >
                      <option value="">All</option>
                      {filter.options?.map(option => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {filter.type === 'text' && (
                    <input
                      type="text"
                      className="data-grid-filter-input"
                      value={filter.value || ''}
                      onChange={(e) => handleFilterChange(filter.key, e.target.value)}
                      placeholder={`Filter by ${filter.label.toLowerCase()}`}
                    />
                  )}
                  {filter.type === 'date' && (
                    <input
                      type="date"
                      className="data-grid-filter-input"
                      value={filter.value || ''}
                      onChange={(e) => handleFilterChange(filter.key, e.target.value)}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <Table
        columns={columnsWithActions}
        data={paginatedData}
        keyExtractor={keyExtractor}
        selectedRows={selectedRows}
        onSelectionChange={onSelectionChange}
        {...tableProps}
      />

      {/* Pagination */}
      {pagination && (
        <div className="data-grid-footer">
          <TablePagination
            currentPage={currentPage}
            totalPages={totalPages}
            pageSize={pageSize}
            totalItems={displayedItemsCount}
            onPageChange={onPageChange || (() => {})}
            onPageSizeChange={onPageSizeChange}
            showPageSizeSelector={!!onPageSizeChange}
          />
        </div>
      )}
    </div>
  );
}
