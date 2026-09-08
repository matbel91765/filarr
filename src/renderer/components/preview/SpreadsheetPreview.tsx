/**
 * SpreadsheetPreview Component
 *
 * In-app preview for spreadsheet files (.xlsx / .xls / .ods). The workbook is
 * parsed entirely in the renderer with SheetJS (`xlsx`), loaded via a dynamic
 * import so the (heavy) library stays out of the main bundle and no bytes ever
 * leave the device. Each sheet becomes a virtualized table (react-virtuoso's
 * TableVirtuoso) so large exports stay smooth, with a tab bar to switch sheets.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { TableVirtuoso } from 'react-virtuoso';
import clsx from 'clsx';
import { Button } from '../ui/Button/Button';
import { Input } from '../ui/Input/Input';
import './CsvPreview.css';

export interface SpreadsheetPreviewProps {
  /** Spreadsheet data as ArrayBuffer */
  data: ArrayBuffer;
  /** File name */
  fileName: string;
  /** File extension (xlsx | xls | ods) */
  extension?: string;
  /** Additional CSS class */
  className?: string;
}

type SortDir = 'asc' | 'desc' | null;

interface ParsedSheet {
  name: string;
  /** Rectangular 2D grid of stringified cell values (includes the header row). */
  grid: string[][];
  colCount: number;
}

// Compare two cell strings, numeric-aware (so "10" sorts after "9").
const compareCells = (a: string, b: string): number => {
  const na = parseFloat(a);
  const nb = parseFloat(b);
  const aNum = a.trim() !== '' && !isNaN(na);
  const bNum = b.trim() !== '' && !isNaN(nb);
  if (aNum && bNum) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
};

const badgeFor = (extension?: string): string => {
  switch ((extension || '').toLowerCase()) {
    case 'xls':
      return 'XLS';
    case 'ods':
      return 'ODS';
    default:
      return 'XLSX';
  }
};

export const SpreadsheetPreview: React.FC<SpreadsheetPreviewProps> = ({
  data,
  fileName,
  extension,
  className,
}) => {
  const [sheets, setSheets] = useState<ParsedSheet[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeSheet, setActiveSheet] = useState(0);
  const [filter, setFilter] = useState('');
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setSheets(null);
    setActiveSheet(0);
    setFilter('');
    setSortCol(null);
    setSortDir(null);

    (async () => {
      try {
        // Dynamic import keeps SheetJS out of the main bundle.
        const XLSX = await import('xlsx');
        const wb = XLSX.read(new Uint8Array(data), { type: 'array' });

        const parsed: ParsedSheet[] = wb.SheetNames.map((name) => {
          const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[name], {
            header: 1,
            defval: '',
            blankrows: false,
          }) as unknown[][];

          // Stringify every cell and normalize ragged rows to a rectangular grid.
          const rows = rawRows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : []));
          const colCount = rows.reduce((max, r) => Math.max(max, r.length), 0);
          const grid = rows.map((r) => {
            if (r.length === colCount) return r;
            const padded = r.slice();
            while (padded.length < colCount) padded.push('');
            return padded;
          });
          return { name, grid, colCount };
        });

        if (cancelled) return;
        setSheets(parsed);
      } catch (err) {
        if (cancelled) return;
        console.error('[SpreadsheetPreview] Parse error:', err);
        setError(err instanceof Error ? err.message : 'Lecture impossible');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [data]);

  const current =
    sheets && sheets.length > 0 ? sheets[Math.min(activeSheet, sheets.length - 1)] : null;

  const { headers, bodyRows } = useMemo(() => {
    if (!current || current.grid.length === 0) {
      return { headers: [] as string[], bodyRows: [] as string[][] };
    }
    return { headers: current.grid[0], bodyRows: current.grid.slice(1) };
  }, [current]);

  const displayedRows = useMemo(() => {
    let rows = bodyRows;
    const q = filter.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) => r.some((cell) => cell.toLowerCase().includes(q)));
    }
    if (sortCol !== null && sortDir) {
      const sorted = rows.slice().sort((a, b) => compareCells(a[sortCol] ?? '', b[sortCol] ?? ''));
      if (sortDir === 'desc') sorted.reverse();
      rows = sorted;
    }
    return rows;
  }, [bodyRows, filter, sortCol, sortDir]);

  const handleSort = useCallback(
    (col: number) => {
      if (sortCol !== col) {
        setSortCol(col);
        setSortDir('asc');
      } else {
        // asc → desc → none
        setSortDir((d) => (d === 'asc' ? 'desc' : d === 'desc' ? null : 'asc'));
        if (sortDir === 'desc') setSortCol(null);
      }
    },
    [sortCol, sortDir]
  );

  const handleSelectSheet = useCallback((index: number) => {
    setActiveSheet(index);
    setFilter('');
    setSortCol(null);
    setSortDir(null);
  }, []);

  const containerClasses = clsx('csv-preview', className);

  if (isLoading) {
    return (
      <div className={containerClasses}>
        <div className="csv-preview__table-wrap">
          <div className="file-preview-panel__loading">
            <div className="file-preview-panel__spinner" />
            <span>Lecture du classeur…</span>
          </div>
        </div>
      </div>
    );
  }

  if (error || !sheets || sheets.length === 0) {
    return (
      <div className={containerClasses}>
        <div className="csv-preview__table-wrap">
          <div className="file-preview-panel__error">
            <span>Impossible d'afficher ce classeur</span>
            {error && <p className="file-preview-panel__error-message">{error}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={containerClasses}>
      <div className="csv-preview__toolbar">
        <div className="csv-preview__toolbar-left">
          <span className="csv-preview__badge">{badgeFor(extension)}</span>
          <span className="csv-preview__stats" title={fileName}>
            {displayedRows.length.toLocaleString()} lignes
            {filter && ` (sur ${bodyRows.length.toLocaleString()})`} · {headers.length} colonnes
          </span>
        </div>
        <div className="csv-preview__toolbar-right">
          <Input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrer…"
            className="csv-preview__filter"
          />
          {(sortCol !== null || filter) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilter('');
                setSortCol(null);
                setSortDir(null);
              }}
              title="Réinitialiser"
            >
              Réinitialiser
            </Button>
          )}
        </div>
      </div>

      {sheets.length > 1 && (
        <div
          role="tablist"
          aria-label="Feuilles"
          style={{
            display: 'flex',
            gap: 4,
            padding: '4px 12px',
            overflowX: 'auto',
            borderBottom: '1px solid var(--color-border, #e5e7eb)',
            background: 'var(--color-bg-secondary, #f9fafb)',
            flexShrink: 0,
          }}
        >
          {sheets.map((sheet, i) => {
            const isActive = i === Math.min(activeSheet, sheets.length - 1);
            return (
              <button
                key={`${sheet.name}-${i}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                title={sheet.name}
                onClick={() => handleSelectSheet(i)}
                style={{
                  padding: '4px 12px',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: isActive ? 600 : 500,
                  whiteSpace: 'nowrap',
                  maxWidth: 200,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  background: isActive ? 'var(--color-primary-100, #dbeafe)' : 'transparent',
                  color: isActive
                    ? 'var(--color-primary-700, #1d4ed8)'
                    : 'var(--color-text-secondary, #6b7280)',
                }}
              >
                {sheet.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="csv-preview__table-wrap">
        <TableVirtuoso
          data={displayedRows}
          className="csv-preview__virtuoso"
          fixedHeaderContent={() => (
            <tr>
              <th className="csv-preview__th csv-preview__th--index">#</th>
              {headers.map((h, i) => (
                <th
                  key={i}
                  className={clsx('csv-preview__th', { 'csv-preview__th--sorted': sortCol === i })}
                  onClick={() => handleSort(i)}
                  title={h}
                >
                  <span className="csv-preview__th-label">{h || `Col ${i + 1}`}</span>
                  {sortCol === i && (
                    <span className="csv-preview__sort-caret">{sortDir === 'asc' ? '▲' : '▼'}</span>
                  )}
                </th>
              ))}
            </tr>
          )}
          itemContent={(index, row) => (
            <>
              <td className="csv-preview__td csv-preview__td--index">{index + 1}</td>
              {headers.map((_, i) => (
                <td key={i} className="csv-preview__td" title={row[i]}>
                  {row[i]}
                </td>
              ))}
            </>
          )}
        />
      </div>
    </div>
  );
};

export default SpreadsheetPreview;
