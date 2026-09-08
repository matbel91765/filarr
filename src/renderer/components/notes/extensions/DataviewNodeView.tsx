/**
 * DataviewNodeView — Filarr Notes
 *
 * React NodeView for the dataview block extension.
 * Parses a simplified query language and executes it against
 * notes stored in the Redux store, rendering results as a table or list.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import { useBlockResize } from './useBlockResize';
import { useSelector, useDispatch } from 'react-redux';
import { setEditingNote } from '../../../../store/slices/notesSlice';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Note {
  id: string;
  title: string;
  content: string;
  plainText: string;
  parentId: string | null;
  linkedNoteIds: string[];
  isDaily: boolean;
  dailyDate: string | null;
  icon: string | null;
  coverColor: string | null;
  wordCount: number;
  tagIds: string[];
  notebookId: string | null;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

interface WhereClause {
  field: string;
  op: string;
  value: string;
  connector?: 'AND' | 'OR';
}

interface DataviewQuery {
  type: 'TABLE' | 'LIST';
  fields: string[];
  where: WhereClause[];
  sort?: { field: string; order: 'ASC' | 'DESC' };
  limit?: number;
}

interface DataviewNodeViewProps {
  node: { attrs: { query: string; blockWidthPx?: number | null; blockHeightPx?: number | null } };
  updateAttributes: (attrs: Record<string, unknown>) => void;
  /** Fourni par TipTap à toute vue de nœud ; `isEditable` distingue les surfaces en lecture seule. */
  editor?: { isEditable: boolean };
  selected: boolean;
}

/* ------------------------------------------------------------------ */
/*  Query parser                                                       */
/* ------------------------------------------------------------------ */

function parseQuery(raw: string): DataviewQuery {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    throw new Error('Empty query');
  }

  const result: DataviewQuery = {
    type: 'TABLE',
    fields: [],
    where: [],
  };

  // --- First line: TABLE or LIST ---
  const firstLine = lines[0];
  if (/^TABLE\b/i.test(firstLine)) {
    result.type = 'TABLE';
    const fieldsPart = firstLine.replace(/^TABLE\s+/i, '');
    result.fields = fieldsPart
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean);
    if (result.fields.length === 0) {
      throw new Error('TABLE requires at least one field');
    }
  } else if (/^LIST\b/i.test(firstLine)) {
    result.type = 'LIST';
    result.fields = ['title'];
  } else {
    throw new Error('Query must start with TABLE or LIST');
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    // FROM — skip (always notes for now)
    if (/^FROM\b/i.test(line)) {
      continue;
    }

    // WHERE
    if (/^WHERE\b/i.test(line)) {
      const wherePart = line.replace(/^WHERE\s+/i, '');
      result.where = parseWhereClauses(wherePart);
      continue;
    }

    // SORT
    if (/^SORT\b/i.test(line)) {
      const sortMatch = line.match(/^SORT\s+(\w+)\s*(ASC|DESC)?$/i);
      if (!sortMatch) throw new Error(`Invalid SORT: ${line}`);
      result.sort = {
        field: sortMatch[1],
        order: (sortMatch[2]?.toUpperCase() as 'ASC' | 'DESC') || 'ASC',
      };
      continue;
    }

    // LIMIT
    if (/^LIMIT\b/i.test(line)) {
      const limitMatch = line.match(/^LIMIT\s+(\d+)$/i);
      if (!limitMatch) throw new Error(`Invalid LIMIT: ${line}`);
      result.limit = parseInt(limitMatch[1], 10);
      continue;
    }

    throw new Error(`Unknown clause: ${line}`);
  }

  return result;
}

function parseWhereClauses(raw: string): WhereClause[] {
  const parts: { text: string; connector?: 'AND' | 'OR' }[] = [];
  const tokens = raw.split(/\b(AND|OR)\b/i);

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].trim();
    if (!t) continue;
    if (/^AND$/i.test(t) || /^OR$/i.test(t)) {
      if (parts.length > 0) {
        parts[parts.length - 1].connector = t.toUpperCase() as 'AND' | 'OR';
      }
    } else {
      parts.push({ text: t });
    }
  }

  return parts.map(({ text, connector }) => {
    // Handle CONTAINS operator
    const containsMatch = text.match(/^(\w+)\s+CONTAINS\s+"([^"]*)"$/i);
    if (containsMatch) {
      return { field: containsMatch[1], op: 'CONTAINS', value: containsMatch[2], connector };
    }

    // Handle standard operators: >=, <=, !=, =, >, <
    const stdMatch = text.match(/^(\w+)\s*(>=|<=|!=|=|>|<)\s*"?([^"]*)"?$/);
    if (!stdMatch) {
      throw new Error(`Invalid WHERE condition: ${text}`);
    }

    return { field: stdMatch[1], op: stdMatch[2], value: stdMatch[3].trim(), connector };
  });
}

/* ------------------------------------------------------------------ */
/*  Query executor                                                     */
/* ------------------------------------------------------------------ */

function getFieldValue(note: Note, field: string): unknown {
  return (note as unknown as Record<string, unknown>)[field];
}

function coerceNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function evaluateCondition(note: Note, clause: WhereClause): boolean {
  const fieldVal = getFieldValue(note, clause.field);
  const { op, value } = clause;

  if (op === 'CONTAINS') {
    if (Array.isArray(fieldVal)) {
      return fieldVal.includes(value);
    }
    if (typeof fieldVal === 'string') {
      return fieldVal.toLowerCase().includes(value.toLowerCase());
    }
    return false;
  }

  const numField = coerceNumber(fieldVal);
  const numValue = coerceNumber(value);
  const isNumeric = !isNaN(Number(value)) && typeof fieldVal === 'number';

  switch (op) {
    case '=':
      return isNumeric ? numField === numValue : String(fieldVal) === value;
    case '!=':
      return isNumeric ? numField !== numValue : String(fieldVal) !== value;
    case '>':
      return isNumeric ? numField > numValue : String(fieldVal) > value;
    case '<':
      return isNumeric ? numField < numValue : String(fieldVal) < value;
    case '>=':
      return isNumeric ? numField >= numValue : String(fieldVal) >= value;
    case '<=':
      return isNumeric ? numField <= numValue : String(fieldVal) <= value;
    default:
      return false;
  }
}

function matchesWhere(note: Note, clauses: WhereClause[]): boolean {
  if (clauses.length === 0) return true;

  let result = evaluateCondition(note, clauses[0]);

  for (let i = 1; i < clauses.length; i++) {
    const prev = clauses[i - 1];
    const current = clauses[i];
    const conditionResult = evaluateCondition(note, current);

    if (prev.connector === 'OR') {
      result = result || conditionResult;
    } else {
      result = result && conditionResult;
    }
  }

  return result;
}

function executeQuery(
  query: DataviewQuery,
  notes: Note[]
): { headers: string[]; rows: unknown[][] } {
  // Filter
  let filtered = notes.filter((n) => matchesWhere(n, query.where));

  // Sort
  if (query.sort) {
    const { field, order } = query.sort;
    filtered.sort((a, b) => {
      const va = getFieldValue(a, field);
      const vb = getFieldValue(b, field);
      let cmp = 0;
      if (typeof va === 'number' && typeof vb === 'number') {
        cmp = va - vb;
      } else {
        cmp = String(va ?? '').localeCompare(String(vb ?? ''));
      }
      return order === 'DESC' ? -cmp : cmp;
    });
  }

  // Limit
  if (query.limit != null && query.limit > 0) {
    filtered = filtered.slice(0, query.limit);
  }

  // Project fields
  const fields = query.type === 'LIST' ? ['title'] : query.fields;
  const rows = filtered.map((note) => [note.id, ...fields.map((f) => getFieldValue(note, f))]);

  return { headers: fields, rows };
}

/* ------------------------------------------------------------------ */
/*  Format helpers                                                     */
/* ------------------------------------------------------------------ */

function formatValue(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  }
  return String(value);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const DataviewNodeView: React.FC<DataviewNodeViewProps> = ({
  node,
  updateAttributes,
  selected,
  editor,
}) => {
  // Le schéma est monté par QUATRE surfaces (éditeur, rendu de version, README
  // de dossier, coffre partagé), dont certaines en lecture seule : sans cette
  // garde, la poignée s'offrirait sur un rendu qu'on ne peut pas modifier.
  const readOnly = editor ? !editor.isEditable : false;
  const resize = useBlockResize(
    node.attrs.blockWidthPx,
    node.attrs.blockHeightPx,
    updateAttributes,
    {
      disabled: readOnly,
    }
  );
  const dispatch = useDispatch();
  const notesById = useSelector((state: any) => state.notes.byId) as Record<string, Note>;
  const allNotes = useMemo(() => Object.values(notesById), [notesById]);

  const [editing, setEditing] = useState(false);
  const [draftQuery, setDraftQuery] = useState(node.attrs.query);

  const queryText = node.attrs.query;

  const { result, error } = useMemo(() => {
    try {
      const parsed = parseQuery(queryText);
      const res = executeQuery(parsed, allNotes);
      return { result: { query: parsed, ...res }, error: null };
    } catch (e: any) {
      return { result: null, error: e.message || 'Unknown error' };
    }
  }, [queryText, allNotes]);

  const handleSave = useCallback(() => {
    updateAttributes({ query: draftQuery });
    setEditing(false);
  }, [draftQuery, updateAttributes]);

  const handleNavigate = useCallback(
    (noteId: string) => {
      dispatch(setEditingNote(noteId));
    },
    [dispatch]
  );

  return (
    <NodeViewWrapper
      ref={resize.ref}
      className={`dataview-node ${resize.className} ${selected ? 'dataview-node--selected' : ''}`}
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        margin: '8px 0',
        overflow: 'hidden',
        background: 'var(--color-background-secondary)',
        ...resize.style,
      }}
    >
      {resize.grip}
      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          background: 'var(--color-background-tertiary)',
          borderBottom: '1px solid var(--color-border)',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--color-text-secondary)',
          userSelect: 'none',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="9" y1="21" x2="9" y2="9" />
          </svg>
          Dataview
        </span>
        <button
          onClick={() => {
            if (editing) {
              handleSave();
            } else {
              setDraftQuery(queryText);
              setEditing(true);
            }
          }}
          style={{
            background: 'none',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            padding: '2px 8px',
            cursor: 'pointer',
            fontSize: 11,
            color: 'var(--color-text-secondary)',
          }}
        >
          {editing ? 'Save' : 'Edit'}
        </button>
      </div>

      {/* Query editor */}
      {editing && (
        <div style={{ padding: 8, borderBottom: '1px solid var(--color-border)' }}>
          <textarea
            value={draftQuery}
            onChange={(e) => setDraftQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setEditing(false);
              }
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                handleSave();
              }
            }}
            style={{
              width: '100%',
              minHeight: 80,
              fontFamily: 'monospace',
              fontSize: 13,
              padding: 8,
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              resize: 'vertical',
              background: 'var(--color-surface)',
              color: 'var(--color-text-primary)',
              outline: 'none',
              boxSizing: 'border-box',
            }}
            spellCheck={false}
            autoFocus
          />
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
            Ctrl+Enter to save, Escape to cancel
          </div>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div
          style={{
            padding: '8px 12px',
            color: 'var(--color-error-500)',
            fontSize: 13,
            background: 'var(--color-error-50)',
          }}
        >
          Query error: {error}
        </div>
      )}

      {/* Results */}
      {result && !error && (
        <div style={{ padding: 0 }}>
          {result.rows.length === 0 ? (
            <div
              style={{
                padding: '12px',
                fontSize: 13,
                color: 'var(--color-text-tertiary)',
                textAlign: 'center',
              }}
            >
              No matching notes
            </div>
          ) : result.query.type === 'LIST' ? (
            <ul style={{ listStyle: 'none', margin: 0, padding: '4px 0' }}>
              {result.rows.map((row) => {
                const noteId = row[0] as string;
                const title = row[1] as string;
                return (
                  <li
                    key={noteId}
                    onClick={() => handleNavigate(noteId)}
                    style={{
                      padding: '6px 12px',
                      fontSize: 13,
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--color-border-light)',
                      color: 'var(--color-text-primary)',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        'var(--color-hover-overlay)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = 'transparent';
                    }}
                  >
                    {title || 'Untitled'}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {result.headers.map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: 'left',
                          padding: '6px 12px',
                          borderBottom: '2px solid var(--color-border)',
                          fontWeight: 600,
                          fontSize: 12,
                          color: 'var(--color-text-secondary)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => {
                    const noteId = row[0] as string;
                    const values = row.slice(1);
                    return (
                      <tr
                        key={noteId}
                        onClick={() => handleNavigate(noteId)}
                        style={{ cursor: 'pointer' }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLElement).style.background =
                            'var(--color-hover-overlay)';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.background = 'transparent';
                        }}
                      >
                        {values.map((v, idx) => (
                          <td
                            key={idx}
                            style={{
                              padding: '6px 12px',
                              borderBottom: '1px solid var(--color-border-light)',
                              color: 'var(--color-text-primary)',
                              maxWidth: 300,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {formatValue(v)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div
            style={{
              padding: '4px 12px',
              fontSize: 11,
              color: 'var(--color-text-tertiary)',
              textAlign: 'right',
            }}
          >
            {result.rows.length} result{result.rows.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
};
