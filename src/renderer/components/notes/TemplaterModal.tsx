/**
 * TemplaterModal — Filarr Notes
 *
 * A Templater-like system for creating notes from templates with
 * dynamic expressions (date math, variables, etc.).
 * Templates are stored in localStorage under `filarr-note-templates`.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import './TemplaterModal.css';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface NoteTemplate {
  id: string;
  name: string;
  description: string;
  content: string;
}

interface TemplaterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyTemplate: (content: string, title: string) => void;
}

type ModalView = 'list' | 'create' | 'edit';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = 'filarr-note-templates';

const DEFAULT_TEMPLATES: NoteTemplate[] = [
  {
    id: 'default-daily',
    name: 'Daily Note',
    description: 'Daily journal with tasks, notes, and reflection sections',
    content: `# {{weekday}}, {{date}}

## Tasks
- [ ] {{cursor}}

## Notes


## Journal

---
*Created at {{time}}*`,
  },
  {
    id: 'default-meeting',
    name: 'Meeting Notes',
    description: 'Structured meeting notes with agenda and action items',
    content: `# Meeting Notes — {{date}}

## Attendees
-

## Agenda
1. {{cursor}}

## Discussion Notes


## Action Items
- [ ]

## Next Meeting
- Date: {{date+7d}}

---
*Meeting recorded at {{time}}*`,
  },
  {
    id: 'default-weekly',
    name: 'Weekly Review',
    description: 'Weekly review template with reflection and planning sections',
    content: `# Weekly Review — Week {{week}}, {{year}}

**Period:** {{date-6d}} to {{date}}

## Accomplishments
- {{cursor}}

## Challenges
-

## Lessons Learned
-

## Next Week Goals
- [ ]

## Notes


---
*Review completed on {{weekday}}, {{date}} at {{time}}*`,
  },
];

/* ------------------------------------------------------------------ */
/*  Template expression processor                                      */
/* ------------------------------------------------------------------ */

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function applyDateOffset(base: Date, expr: string): Date {
  const match = expr.match(/^date([+-])(\d+)([dwmy])$/);
  if (!match) return base;

  const sign = match[1] === '+' ? 1 : -1;
  const amount = parseInt(match[2], 10) * sign;
  const unit = match[3];
  const result = new Date(base);

  switch (unit) {
    case 'd':
      result.setDate(result.getDate() + amount);
      break;
    case 'w':
      result.setDate(result.getDate() + amount * 7);
      break;
    case 'm':
      result.setMonth(result.getMonth() + amount);
      break;
    case 'y':
      result.setFullYear(result.getFullYear() + amount);
      break;
  }

  return result;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatTime(d: Date): string {
  return d.toTimeString().slice(0, 5);
}

const WEEKDAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function processTemplate(
  template: string,
  vars?: Record<string, string>,
): { content: string; cursorOffset: number } {
  const now = new Date();
  let cursorOffset = -1;

  const processed = template.replace(/\{\{([^}]+)\}\}/g, (fullMatch, rawExpr: string) => {
    const expr = rawExpr.trim();

    // Static variables from vars map
    if (vars && vars[expr] !== undefined) {
      return vars[expr];
    }

    // {{cursor}} — record position then remove
    if (expr === 'cursor') {
      return '\u200B'; // Zero-width space as cursor marker
    }

    // {{date}} — current date
    if (expr === 'date') {
      return formatDate(now);
    }

    // {{date+Nd}}, {{date-1m}}, etc.
    if (/^date[+-]\d+[dwmy]$/.test(expr)) {
      return formatDate(applyDateOffset(now, expr));
    }

    // {{time}}
    if (expr === 'time') {
      return formatTime(now);
    }

    // {{weekday}}
    if (expr === 'weekday') {
      return WEEKDAY_NAMES[now.getDay()];
    }

    // {{week}}
    if (expr === 'week') {
      return String(getISOWeekNumber(now));
    }

    // {{month}}
    if (expr === 'month') {
      return MONTH_NAMES[now.getMonth()];
    }

    // {{year}}
    if (expr === 'year') {
      return String(now.getFullYear());
    }

    // {{title}} — use vars or fallback
    if (expr === 'title') {
      return vars?.title ?? 'Untitled';
    }

    // {{random:uuid}}
    if (expr === 'random:uuid') {
      return generateUUID();
    }

    // Unknown expression — leave as-is
    return fullMatch;
  });

  // Find cursor marker position
  const markerIdx = processed.indexOf('\u200B');
  if (markerIdx !== -1) {
    cursorOffset = markerIdx;
  }

  // Remove cursor markers
  const final = processed.replace(/\u200B/g, '');

  return { content: final, cursorOffset };
}

/* ------------------------------------------------------------------ */
/*  Storage helpers                                                    */
/* ------------------------------------------------------------------ */

function loadTemplates(): NoteTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // Ignore parse errors
  }
  // Return defaults on first use or error
  return [...DEFAULT_TEMPLATES];
}

function saveTemplates(templates: NoteTemplate[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const TemplaterModal: React.FC<TemplaterModalProps> = ({
  isOpen,
  onClose,
  onApplyTemplate,
}) => {
  const [templates, setTemplates] = useState<NoteTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<ModalView>('list');

  // Form state
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formContent, setFormContent] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  // Load templates on open
  useEffect(() => {
    if (isOpen) {
      setTemplates(loadTemplates());
      setSelectedId(null);
      setView('list');
    }
  }, [isOpen]);

  // Persist on change
  const persistTemplates = useCallback((updated: NoteTemplate[]) => {
    setTemplates(updated);
    saveTemplates(updated);
  }, []);

  // Selected template
  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId],
  );

  // Preview of selected template with expressions processed
  const preview = useMemo(() => {
    if (!selected) return null;
    return processTemplate(selected.content);
  }, [selected]);

  // Handlers
  const handleUseTemplate = useCallback(() => {
    if (!selected) return;
    const { content } = processTemplate(selected.content);
    // Derive title from first heading or template name
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : selected.name;
    onApplyTemplate(content, title);
    onClose();
  }, [selected, onApplyTemplate, onClose]);

  const handleCreateNew = useCallback(() => {
    setFormName('');
    setFormDesc('');
    setFormContent('');
    setEditingId(null);
    setView('create');
  }, []);

  const handleEditTemplate = useCallback(
    (tmpl: NoteTemplate) => {
      setFormName(tmpl.name);
      setFormDesc(tmpl.description);
      setFormContent(tmpl.content);
      setEditingId(tmpl.id);
      setView('edit');
    },
    [],
  );

  const handleDeleteTemplate = useCallback(
    (id: string) => {
      const updated = templates.filter((t) => t.id !== id);
      persistTemplates(updated);
      if (selectedId === id) setSelectedId(null);
    },
    [templates, selectedId, persistTemplates],
  );

  const handleSaveForm = useCallback(() => {
    if (!formName.trim()) return;

    if (view === 'edit' && editingId) {
      const updated = templates.map((t) =>
        t.id === editingId
          ? { ...t, name: formName.trim(), description: formDesc.trim(), content: formContent }
          : t,
      );
      persistTemplates(updated);
    } else {
      const newTemplate: NoteTemplate = {
        id: `tmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: formName.trim(),
        description: formDesc.trim(),
        content: formContent,
      };
      persistTemplates([...templates, newTemplate]);
    }

    setView('list');
  }, [view, editingId, formName, formDesc, formContent, templates, persistTemplates]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  // Keyboard
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="templater-overlay" onClick={handleOverlayClick}>
      <div className="templater-modal">
        {/* Header */}
        <div className="templater-header">
          <h2>
            {view === 'list' && 'Note Templates'}
            {view === 'create' && 'Create Template'}
            {view === 'edit' && 'Edit Template'}
          </h2>
          <div className="templater-header-actions">
            {view === 'list' && (
              <button className="templater-btn templater-btn--primary" onClick={handleCreateNew}>
                + New Template
              </button>
            )}
            <button className="templater-close-btn" onClick={onClose} title="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="templater-body">
          {/* ---- List view ---- */}
          {view === 'list' && (
            <>
              {templates.length === 0 ? (
                <div className="templater-empty">
                  No templates yet. Create one to get started.
                </div>
              ) : (
                <div className="templater-list">
                  {templates.map((tmpl) => (
                    <div
                      key={tmpl.id}
                      className={`templater-card ${selectedId === tmpl.id ? 'templater-card--selected' : ''}`}
                      onClick={() => setSelectedId(tmpl.id === selectedId ? null : tmpl.id)}
                    >
                      <div className="templater-card-info">
                        <div className="templater-card-name">{tmpl.name}</div>
                        {tmpl.description && (
                          <div className="templater-card-desc">{tmpl.description}</div>
                        )}
                      </div>
                      <div className="templater-card-actions">
                        <button
                          className="templater-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditTemplate(tmpl);
                          }}
                          title="Edit"
                        >
                          Edit
                        </button>
                        <button
                          className="templater-btn templater-btn--danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteTemplate(tmpl.id);
                          }}
                          title="Delete"
                        >
                          Del
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Preview + Use button for selected template */}
              {selected && preview && (
                <div className="templater-preview">
                  <div className="templater-preview-label">Preview</div>
                  <div className="templater-preview-content">{preview.content}</div>
                  <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      className="templater-btn templater-btn--primary"
                      onClick={handleUseTemplate}
                    >
                      Use Template
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ---- Create / Edit view ---- */}
          {(view === 'create' || view === 'edit') && (
            <div className="templater-form">
              <div className="templater-field">
                <label>Template Name</label>
                <input
                  className="templater-input"
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Bug Report, Research Note..."
                  autoFocus
                />
              </div>

              <div className="templater-field">
                <label>Description</label>
                <input
                  className="templater-input"
                  type="text"
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="Brief description of this template"
                />
              </div>

              <div className="templater-field">
                <label>Content</label>
                <textarea
                  className="templater-textarea"
                  value={formContent}
                  onChange={(e) => setFormContent(e.target.value)}
                  placeholder={'# {{date}} — My Template\n\n## Section\n- {{cursor}}'}
                />
              </div>

              <div className="templater-help">
                <strong>Available expressions:</strong><br />
                <code>{'{{date}}'}</code> current date &middot;
                <code>{'{{date+7d}}'}</code> date + 7 days &middot;
                <code>{'{{date-1m}}'}</code> date - 1 month &middot;
                <code>{'{{time}}'}</code> current time &middot;
                <code>{'{{weekday}}'}</code> day name &middot;
                <code>{'{{week}}'}</code> ISO week &middot;
                <code>{'{{month}}'}</code> month name &middot;
                <code>{'{{year}}'}</code> year &middot;
                <code>{'{{title}}'}</code> note title &middot;
                <code>{'{{random:uuid}}'}</code> UUID &middot;
                <code>{'{{cursor}}'}</code> cursor position
              </div>

              {/* Live preview */}
              {formContent && (
                <div className="templater-preview">
                  <div className="templater-preview-label">Live Preview</div>
                  <div className="templater-preview-content">
                    {processTemplate(formContent).content}
                  </div>
                </div>
              )}

              <div className="templater-form-actions">
                <button className="templater-btn" onClick={() => setView('list')}>
                  Cancel
                </button>
                <button
                  className="templater-btn templater-btn--primary"
                  onClick={handleSaveForm}
                  disabled={!formName.trim()}
                >
                  {view === 'edit' ? 'Save Changes' : 'Create Template'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TemplaterModal;
