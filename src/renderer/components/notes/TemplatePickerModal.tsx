/**
 * TemplatePickerModal — les modèles proposés à la création d'une note.
 *
 * Remplace la bande qui s'affichait dans la note vierge. Une fenêtre pose deux
 * exigences que la bande n'avait pas, et elles décident de tout le reste :
 *
 *  - **elle ne doit jamais barrer la route.** « Note vierge » est le premier
 *    bouton, Échap et le clic dehors ferment. Celui qui voulait juste écrire
 *    perd un geste, pas plus ;
 *  - **elle ne doit pas revenir sans cesse.** Elle ne s'ouvre que sur une note
 *    qu'on VIENT de créer, une seule fois par note, et jamais si la préférence
 *    a été coupée (voir `templateSuggestionPrefs`, réversible depuis la
 *    bibliothèque de modèles).
 */

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../ui/Modal';
import type { RootState } from '../../../store';
import { selectNoteTemplates } from '../../../store/slices/notesSlice';
import { getTemplateDescription, getTemplateName } from '../../../services/notes/noteService';
import { setTemplateSuggestionsEnabled } from './templateSuggestionPrefs';
import type { NoteTemplate } from '../../../types/notes';

interface TemplatePickerModalProps {
  isOpen: boolean;
  /** Applique le modèle à la note ouverte. */
  onApply: (template: NoteTemplate) => void;
  /** Ferme sans rien appliquer — la note reste vierge. */
  onClose: () => void;
}

export const TemplatePickerModal: React.FC<TemplatePickerModalProps> = ({
  isOpen,
  onApply,
  onClose,
}) => {
  const { t } = useTranslation();
  const templates = useSelector((state: RootState) => selectNoteTemplates(state));
  const [query, setQuery] = useState('');

  // Les modèles de l'utilisateur d'abord : s'il s'en est fait un, c'est
  // vraisemblablement celui qu'il cherche.
  const ordered = useMemo(() => {
    const custom = templates.filter((template) => !template.isBuiltIn);
    const builtIn = templates.filter((template) => template.isBuiltIn);
    return [...custom, ...builtIn];
  }, [templates]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return ordered;
    // Sur le libellé AFFICHÉ : chercher « projet » ne doit pas échouer parce
    // que le modèle s'appelle « Project board » dans le code.
    return ordered.filter(
      (template) =>
        getTemplateName(template).toLowerCase().includes(needle) ||
        getTemplateDescription(template).toLowerCase().includes(needle)
    );
  }, [ordered, query]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      className="template-picker"
      closeLabel={t('common.close', 'Fermer')}
    >
      <ModalHeader showCloseButton onClose={onClose} closeLabel={t('common.close', 'Fermer')}>
        {t('notes.startFromTemplate', { defaultValue: 'Start from a template' })}
      </ModalHeader>

      <ModalBody className="template-picker__body">
        <input
          type="search"
          className="template-picker__search"
          value={query}
          placeholder={t('notes.searchTemplates', 'Search templates...')}
          aria-label={t('notes.searchTemplates', 'Search templates...')}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="template-picker__grid">
          {shown.map((template) => (
            <button
              key={template.id}
              type="button"
              className="template-picker__item"
              onClick={() => onApply(template)}
            >
              <span className="template-picker__icon" aria-hidden="true">
                {template.icon || '📄'}
              </span>
              <span className="template-picker__text">
                <span className="template-picker__name">{getTemplateName(template)}</span>
                <span className="template-picker__desc">{getTemplateDescription(template)}</span>
              </span>
            </button>
          ))}
        </div>

        {shown.length === 0 && (
          <p className="template-picker__empty">
            {t('notes.noTemplatesFound', 'No templates found')}
          </p>
        )}
      </ModalBody>

      <ModalFooter className="template-picker__foot">
        <label className="template-picker__never">
          <input
            type="checkbox"
            onChange={(e) => {
              if (!e.target.checked) return;
              setTemplateSuggestionsEnabled(false);
              onClose();
            }}
          />
          <span>
            {t('notes.neverSuggestTemplates', { defaultValue: 'Never suggest templates' })}
          </span>
        </label>

        {/* Le premier bouton est celui qui SORT : proposer un modèle ne doit
            jamais coûter plus qu'un geste à qui voulait écrire. */}
        <button type="button" className="template-picker__blank" onClick={onClose}>
          {t('notes.startBlank', { defaultValue: 'Start with a blank note' })}
        </button>
      </ModalFooter>
    </Modal>
  );
};
