/**
 * CsvPreview Component
 *
 * Renders CSV/TSV files as an interactive, sortable, filterable table. Parsing is
 * done entirely in the renderer with PapaParse (offline), and the (potentially
 * large) body is virtualized with react-virtuoso's TableVirtuoso so a
 * 100k-row export stays smooth.
 */

import React, { useState, useMemo, useCallback } from 'react';
import Papa from 'papaparse';
import { TableVirtuoso } from 'react-virtuoso';
import clsx from 'clsx';
import { Button } from '../ui/Button/Button';
import { Input } from '../ui/Input/Input';
import './CsvPreview.css';

export interface CsvPreviewProps {
  /** CSV/TSV data as ArrayBuffer */
  data: ArrayBuffer;
  /** File name */
  fileName: string;
  /** File extension (csv | tsv) */
  extension?: string;
  /** Additional CSS class */
  className?: string;
}

type SortDir = 'asc' | 'desc' | null;

// Compare two cell strings, numeric-aware (so "10" sorts after "9").
const compareCells = (a: string, b: string): number => {
  const na = parseFloat(a);
  const nb = parseFloat(b);
  const aNum = a.trim() !== '' && !isNaN(na);
  const bNum = b.trim() !== '' && !isNaN(nb);
  if (aNum && bNum) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
};

export const CsvPreview: React.FC<CsvPreviewProps> = ({ data, fileName, extension, className }) => {
  const [filter, setFilter] = useState('');
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [firstRowIsHeader, setFirstRowIsHeader] = useState(true);

  const rawText = useMemo(() => new TextDecoder('utf-8').decode(data), [data]);

  // Parse once. TSV forces a tab delimiter; CSV lets PapaParse auto-detect.
  const parsed = useMemo(() => {
    const result = Papa.parse<string[]>(rawText, {
      delimiter: extension === 'tsv' ? '\t' : '',
      skipEmptyLines: true,
    });
    const rows = (result.data as string[][]).filter((r) => Array.isArray(r));
    const colCount = rows.reduce((max, r) => Math.max(max, r.length), 0);
    // Normalize ragged rows to a rectangular grid.
    const grid = rows.map((r) => {
      if (r.length === colCount) return r;
      const padded = r.slice();
      while (padded.length < colCount) padded.push('');
      return padded;
    });
    return { grid, colCount, delimiter: result.meta.delimiter };
  }, [rawText, extension]);

  const { headers, bodyRows } = useMemo(() => {
    if (parsed.grid.length === 0) return { headers: [] as string[], bodyRows: [] as string[][] };
    if (firstRowIsHeader) {
      return { headers: parsed.grid[0], bodyRows: parsed.grid.slice(1) };
    }
    const generated = Array.from({ length: parsed.colCount }, (_, i) => `Col ${i + 1}`);
    return { headers: generated, bodyRows: parsed.grid };
  }, [parsed, firstRowIsHeader]);

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

  const containerClasses = clsx('csv-preview', className);
  const badge = extension === 'tsv' ? 'TSV' : 'CSV';

  return (
    <div className={containerClasses}>
      <div className="csv-preview__toolbar">
        <div className="csv-preview__toolbar-left">
          <span className="csv-preview__badge">{badge}</span>
          <span className="csv-preview__stats">
            {displayedRows.length.toLocaleString()} lignes
            {filter && ` (sur ${bodyRows.length.toLocaleString()})`} · {headers.length} colonnes
          </span>
        </div>
        <div className="csv-preview__toolbar-right">
          <label className="csv-preview__header-toggle">
            <input
              type="checkbox"
              checked={firstRowIsHeader}
              onChange={(e) => setFirstRowIsHeader(e.target.checked)}
            />
            1<sup>re</sup> ligne = en-têtes
          </label>
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

export default CsvPreview;
