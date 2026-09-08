/**
 * TemplateManager — Filarr Notes
 *
 * Modal to browse, preview, and manage note templates.
 * Supports built-in templates + user-created "Save as template" from any note.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../store';
import {
  selectNoteTemplates,
  addTemplate,
  removeTemplate,
  createNewNote,
} from '../../../store/slices/notesSlice';
import type { NoteTemplate } from '../../../types/notes';
import {
  areTemplateSuggestionsEnabled,
  setTemplateSuggestionsEnabled,
} from './templateSuggestionPrefs';
import { getTemplateDescription, getTemplateName } from '../../../services/notes/noteService';
import './TemplateManager.css';

// ==================== Icons ====================

const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const TemplateIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="9" y1="21" x2="9" y2="9" />
  </svg>
);

const PlusIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <polyline points="3,6 5,6 21,6" />
    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
  </svg>
);

// Built-in template icons
const TEMPLATE_ICONS: Record<string, React.ReactNode> = {
  calendar: (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  meeting: (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" />
      <path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  ),
  clipboard: (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" />
    </svg>
  ),
  briefcase: (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
      <line x1="2" y1="13" x2="22" y2="13" />
    </svg>
  ),
  users: (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" />
      <path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  ),
  default: <TemplateIcon />,
};

// ==================== Component ====================

interface TemplateManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TemplateManager: React.FC<TemplateManagerProps> = React.memo(function TemplateManager({
  isOpen,
  onClose,
}) {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const templates = useSelector(selectNoteTemplates);
  const [selectedTemplate, setSelectedTemplate] = useState<NoteTemplate | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  /**
   * Le reglage « proposer les modeles dans une note vierge » vit ICI parce que
   * c'est ici qu'on revient quand on en veut un. Refuse depuis la note, il
   * serait autrement irreversible : un interrupteur a sens unique, cache dans
   * une note qu'on ne rouvrira pas.
   */
  const [suggestEnabled, setSuggestEnabled] = useState(() => areTemplateSuggestionsEnabled());

  const filteredTemplates = useMemo(() => {
    if (!searchQuery) return templates;
    const q = searchQuery.toLowerCase();
    // Sur le libelle AFFICHE : chercher « projet » ne doit pas echouer parce
    // que le modele s'appelle « Project board » dans le code.
    return templates.filter(
      (tpl) =>
        getTemplateName(tpl).toLowerCase().includes(q) ||
        getTemplateDescription(tpl).toLowerCase().includes(q)
    );
  }, [templates, searchQuery]);

  const builtIn = useMemo(() => filteredTemplates.filter((t) => t.isBuiltIn), [filteredTemplates]);
  const custom = useMemo(() => filteredTemplates.filter((t) => !t.isBuiltIn), [filteredTemplates]);

  const handleUseTemplate = useCallback(
    (template: NoteTemplate) => {
      dispatch(createNewNote({ templateId: template.id, title: getTemplateName(template) }));
      onClose();
    },
    [dispatch, onClose]
  );

  const handleDeleteTemplate = useCallback(
    (templateId: string) => {
      dispatch(removeTemplate(templateId));
      if (selectedTemplate?.id === templateId) setSelectedTemplate(null);
    },
    [dispatch, selectedTemplate]
  );

  // Preview: try to extract headings/text from TipTap JSON
  const previewContent = useMemo(() => {
    if (!selectedTemplate) return '';
    try {
      const doc = JSON.parse(selectedTemplate.content);
      const lines: string[] = [];
      const extractText = (nodes: any[]) => {
        for (const node of nodes) {
          if (node.type === 'heading' && node.content) {
            const level = node.attrs?.level || 1;
            const text = node.content.map((c: any) => c.text || '').join('');
            lines.push('#'.repeat(level) + ' ' + text);
          } else if (node.type === 'paragraph' && node.content) {
            lines.push(node.content.map((c: any) => c.text || '').join(''));
          } else if (node.type === 'taskList' && node.content) {
            for (const item of node.content) {
              const checked = item.attrs?.checked ? '☑' : '☐';
              const text =
                item.content
                  ?.map((p: any) => p.content?.map((c: any) => c.text || '').join('') || '')
                  .join('') || '...';
              lines.push(`${checked} ${text}`);
            }
          } else if (node.type === 'bulletList' && node.content) {
            for (const item of node.content) {
              const text =
                item.content
                  ?.map((p: any) => p.content?.map((c: any) => c.text || '').join('') || '')
                  .join('') || '...';
              lines.push(`• ${text}`);
            }
          }
          if (
            node.content &&
            !['heading', 'paragraph', 'taskList', 'bulletList'].includes(node.type)
          ) {
            extractText(node.content);
          }
        }
      };
      if (doc.content) extractText(doc.content);
      return lines.join('\n');
    } catch {
      return selectedTemplate.content.slice(0, 200);
    }
  }, [selectedTemplate]);

  if (!isOpen) return null;

  return (
    <div className="template-manager__overlay" onClick={onClose}>
      <div className="template-manager" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="template-manager__header">
          <h2 className="template-manager__title">
            <TemplateIcon />
            {t('notes.templateManager', 'Templates')}
          </h2>
          <button className="template-manager__close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        {/* Search */}
        <div className="template-manager__search">
          <input
            type="text"
            placeholder={t('notes.searchTemplates', 'Search templates...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <label className="template-manager__suggest-toggle">
          <input
            type="checkbox"
            checked={suggestEnabled}
            onChange={(e) => {
              setSuggestEnabled(e.target.checked);
              setTemplateSuggestionsEnabled(e.target.checked);
            }}
          />
          <span>
            {t('notes.suggestTemplatesInBlankNote', {
              defaultValue: 'Suggest templates in a blank note',
            })}
          </span>
        </label>

        <div className="template-manager__body">
          {/* Template list */}
          <div className="template-manager__list">
            {builtIn.length > 0 && (
              <>
                <div className="template-manager__section-label">
                  {t('notes.builtInTemplates', 'Built-in')}
                </div>
                {builtIn.map((tpl) => (
                  <button
                    key={tpl.id}
                    className={`template-manager__item ${selectedTemplate?.id === tpl.id ? 'is-active' : ''}`}
                    onClick={() => setSelectedTemplate(tpl)}
                  >
                    <span className="template-manager__item-icon">
                      {TEMPLATE_ICONS[tpl.icon] ||
                        (tpl.icon ? <span>{tpl.icon}</span> : TEMPLATE_ICONS.default)}
                    </span>
                    <div className="template-manager__item-info">
                      <span className="template-manager__item-name">{getTemplateName(tpl)}</span>
                      <span className="template-manager__item-desc">
                        {getTemplateDescription(tpl)}
                      </span>
                    </div>
                  </button>
                ))}
              </>
            )}

            {custom.length > 0 && (
              <>
                <div className="template-manager__section-label">
                  {t('notes.customTemplates', 'Custom')}
                </div>
                {custom.map((tpl) => (
                  <button
                    key={tpl.id}
                    className={`template-manager__item ${selectedTemplate?.id === tpl.id ? 'is-active' : ''}`}
                    onClick={() => setSelectedTemplate(tpl)}
                  >
                    <span className="template-manager__item-icon">
                      {TEMPLATE_ICONS[tpl.icon] ||
                        (tpl.icon ? <span>{tpl.icon}</span> : TEMPLATE_ICONS.default)}
                    </span>
                    <div className="template-manager__item-info">
                      <span className="template-manager__item-name">{getTemplateName(tpl)}</span>
                      <span className="template-manager__item-desc">
                        {getTemplateDescription(tpl)}
                      </span>
                    </div>
                    <button
                      className="template-manager__item-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteTemplate(tpl.id);
                      }}
                      title={t('common.delete', 'Delete')}
                    >
                      <TrashIcon />
                    </button>
                  </button>
                ))}
              </>
            )}

            {filteredTemplates.length === 0 && (
              <p className="template-manager__empty">
                {t('notes.noTemplatesFound', 'No templates found')}
              </p>
            )}
          </div>

          {/* Preview panel */}
          <div className="template-manager__preview">
            {selectedTemplate ? (
              <>
                <div className="template-manager__preview-header">
                  <h3>{getTemplateName(selectedTemplate)}</h3>
                  <p>{getTemplateDescription(selectedTemplate)}</p>
                </div>
                <pre className="template-manager__preview-content">
                  {previewContent || '(empty template)'}
                </pre>
                {selectedTemplate.variables.length > 0 && (
                  <div className="template-manager__preview-vars">
                    <span className="template-manager__preview-vars-label">
                      {t('notes.templateVariables', 'Variables:')}
                    </span>
                    {selectedTemplate.variables.map((v) => (
                      <span key={v.name} className="template-manager__preview-var">
                        {`{{${v.name}}}`}
                      </span>
                    ))}
                  </div>
                )}
                <button
                  className="template-manager__use-btn"
                  onClick={() => handleUseTemplate(selectedTemplate)}
                >
                  <PlusIcon />
                  {t('notes.useTemplate', 'Use Template')}
                </button>
              </>
            ) : (
              <div className="template-manager__preview-empty">
                <TemplateIcon />
                <p>{t('notes.selectTemplate', 'Select a template to preview')}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export default TemplateManager;
