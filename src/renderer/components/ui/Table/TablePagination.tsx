import React, { useMemo } from 'react';
import './Table.css';

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  showPageSizeSelector?: boolean;
}

export function TablePagination({
  currentPage,
  totalPages,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  showPageSizeSelector = true,
}: PaginationProps) {
  // Calculate page numbers to display
  const pageNumbers = useMemo(() => {
    const pages: (number | 'ellipsis')[] = [];
    const maxPagesToShow = 7;

    if (totalPages <= maxPagesToShow) {
      // Show all pages
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);

      if (currentPage <= 3) {
        // Near the start
        for (let i = 2; i <= 5; i++) {
          pages.push(i);
        }
        pages.push('ellipsis');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        // Near the end
        pages.push('ellipsis');
        for (let i = totalPages - 4; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        // Middle
        pages.push('ellipsis');
        for (let i = currentPage - 1; i <= currentPage + 1; i++) {
          pages.push(i);
        }
        pages.push('ellipsis');
        pages.push(totalPages);
      }
    }

    return pages;
  }, [currentPage, totalPages]);

  // Calculate display range
  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  const handlePrevious = () => {
    if (currentPage > 1) {
      onPageChange(currentPage - 1);
    }
  };

  const handleNext = () => {
    if (currentPage < totalPages) {
      onPageChange(currentPage + 1);
    }
  };

  const handlePageSizeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newSize = parseInt(e.target.value, 10);
    onPageSizeChange?.(newSize);
    // Reset to page 1 when changing page size
    onPageChange(1);
  };

  return (
    <div className="table-pagination">
      {/* Items info */}
      <div className="table-pagination-info">
        Showing <strong>{startItem}</strong> to <strong>{endItem}</strong> of{' '}
        <strong>{totalItems}</strong> items
      </div>

      {/* Page size selector */}
      {showPageSizeSelector && onPageSizeChange && (
        <div className="table-pagination-size">
          <label htmlFor="page-size-select" className="table-pagination-size-label">
            Items per page:
          </label>
          <select
            id="page-size-select"
            className="table-pagination-size-select"
            value={pageSize}
            onChange={handlePageSizeChange}
          >
            {pageSizeOptions.map(size => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Page navigation */}
      <div className="table-pagination-nav">
        {/* Previous button */}
        <button
          className="table-pagination-button table-pagination-button-prev"
          onClick={handlePrevious}
          disabled={currentPage === 1}
          aria-label="Previous page"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"
            />
          </svg>
          Previous
        </button>

        {/* Page numbers */}
        <div className="table-pagination-pages">
          {pageNumbers.map((page, index) => {
            if (page === 'ellipsis') {
              return (
                <span key={`ellipsis-${index}`} className="table-pagination-ellipsis">
                  ...
                </span>
              );
            }

            return (
              <button
                key={page}
                className={`table-pagination-page ${
                  page === currentPage ? 'table-pagination-page-active' : ''
                }`}
                onClick={() => onPageChange(page)}
                aria-label={`Page ${page}`}
                aria-current={page === currentPage ? 'page' : undefined}
              >
                {page}
              </button>
            );
          })}
        </div>

        {/* Next button */}
        <button
          className="table-pagination-button table-pagination-button-next"
          onClick={handleNext}
          disabled={currentPage === totalPages}
          aria-label="Next page"
        >
          Next
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
