/**
 * TagEditor Component
 *
 * Modal pour creer et editer des tags hierarchiques.
 * Inclut un selecteur de couleur, la selection du parent,
 * et la gestion des alias.
 */

import React, { FC, useState, useCallback, useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import clsx from 'clsx';
import Modal, { ModalBody, ModalFooter } from '../ui/Modal/Modal';
import Button from '../ui/Button/Button';
import { Input } from '../ui/Input/Input';
import type { AppDispatch, RootState } from '../../../store';
import type { HierarchicalTag } from '../../../types';
// Default tag colors (tagService removed)
const TAG_COLORS = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
  '#EC4899', '#06B6D4', '#F97316', '#14B8A6', '#6366F1',
  '#84CC16', '#E11D48',
];

import {
  createTag,
  updateTag,
  selectAllTags,
} from '../../../store/slices/tagsSlice';
import { useNotification } from '../ui/Notification';
import './TagEditor.css';

// ==================== ICONS ====================

const CloseIcon: FC = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const PlusIcon: FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

// ==================== TYPES ====================

interface TagEditorProps {
  isOpen: boolean;
  onClose: () => void;
  tag?: HierarchicalTag | null; // Si defini, mode edition
  parentId?: string | null; // Parent par defaut pour la creation
}

interface FormData {
  name: string;
  parentId: string | null;
  color: string;
  description: string;
  aliases: string[];
}

// ==================== COMPONENT ====================

const TagEditor: FC<TagEditorProps> = ({
  isOpen,
  onClose,
  tag,
  parentId = null,
}) => {
  const dispatch = useDispatch<AppDispatch>();
  const allTags = useSelector((state: RootState) => selectAllTags(state as any));
  const { success, error } = useNotification();

  const isEditMode = Boolean(tag);

  // Form state
  const [formData, setFormData] = useState<FormData>({
    name: '',
    parentId: null,
    color: TAG_COLORS[0],
    description: '',
    aliases: [],
  });
  const [aliasInput, setAliasInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Initialize form when modal opens or tag changes
  useEffect(() => {
    if (isOpen) {
      if (tag) {
        // Edit mode
        setFormData({
          name: tag.name,
          parentId: tag.parentId,
          color: tag.color,
          description: tag.description || '',
          aliases: [...tag.aliases],
        });
      } else {
        // Create mode
        setFormData({
          name: '',
          parentId: parentId,
          color: TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)],
          description: '',
          aliases: [],
        });
      }
      setAliasInput('');
      setValidationError(null);
    }
  }, [isOpen, tag, parentId]);

  // Get available parent tags (exclude self and descendants in edit mode)
  const availableParents = useMemo(() => {
    if (!tag) return allTags;

    // Get all descendants of the current tag
    const getDescendants = (id: string): string[] => {
      const children = allTags.filter(t => t.parentId === id);
      return [id, ...children.flatMap(c => getDescendants(c.id))];
    };

    const excludeIds = getDescendants(tag.id);
    return allTags.filter(t => !excludeIds.includes(t.id));
  }, [allTags, tag]);

  // Get tag path for display in parent selector
  const getTagPath = useCallback(
    (tagId: string): string => {
      const parts: string[] = [];
      let current = allTags.find(t => t.id === tagId);
      while (current) {
        parts.unshift(current.name);
        current = current.parentId ? allTags.find(t => t.id === current!.parentId) : undefined;
      }
      return parts.join(' > ');
    },
    [allTags]
  );

  // Handlers
  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, name: e.target.value }));
    setValidationError(null);
  }, []);

  const handleParentChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setFormData(prev => ({
      ...prev,
      parentId: e.target.value || null,
    }));
  }, []);

  const handleColorChange = useCallback((color: string) => {
    setFormData(prev => ({ ...prev, color }));
  }, []);

  const handleDescriptionChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setFormData(prev => ({ ...prev, description: e.target.value }));
  }, []);

  const handleAliasInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setAliasInput(e.target.value);
  }, []);

  const handleAddAlias = useCallback(() => {
    const trimmed = aliasInput.trim();
    if (trimmed && !formData.aliases.includes(trimmed)) {
      setFormData(prev => ({
        ...prev,
        aliases: [...prev.aliases, trimmed],
      }));
      setAliasInput('');
    }
  }, [aliasInput, formData.aliases]);

  const handleAliasKeyPress = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddAlias();
      }
    },
    [handleAddAlias]
  );

  const handleRemoveAlias = useCallback((alias: string) => {
    setFormData(prev => ({
      ...prev,
      aliases: prev.aliases.filter(a => a !== alias),
    }));
  }, []);

  const handleSubmit = useCallback(async () => {
    // Validation
    if (!formData.name.trim()) {
      setValidationError('Le nom du tag est requis');
      return;
    }

    // Check for duplicate names (case-insensitive)
    const duplicateName = allTags.some(
      t => t.name.toLowerCase() === formData.name.trim().toLowerCase() && t.id !== tag?.id
    );
    if (duplicateName) {
      setValidationError('Un tag avec ce nom existe deja');
      return;
    }

    setIsSubmitting(true);
    setValidationError(null);

    try {
      if (isEditMode && tag) {
        // Update existing tag
        await dispatch(
          updateTag({
            id: tag.id,
            updates: {
              name: formData.name.trim(),
              parentId: formData.parentId,
              color: formData.color,
              description: formData.description.trim() || undefined,
              aliases: formData.aliases,
            },
          })
        ).unwrap();
        success('Tag modifie avec succes');
      } else {
        // Create new tag
        await dispatch(
          createTag({
            name: formData.name.trim(),
            parentId: formData.parentId,
            color: formData.color,
            description: formData.description.trim() || undefined,
            aliases: formData.aliases,
          })
        ).unwrap();
        success('Tag cree avec succes');
      }

      onClose();
    } catch (err) {
      error((err as Error).message || 'Erreur lors de la sauvegarde');
    } finally {
      setIsSubmitting(false);
    }
  }, [dispatch, formData, isEditMode, tag, allTags, onClose, success, error]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditMode ? 'Modifier le tag' : 'Nouveau tag'}
      size="md"
    >
      <ModalBody>
        <div className="tag-editor">
          {/* Name input */}
          <div className="tag-editor__field">
            <label className="tag-editor__label" htmlFor="tag-name">
              Nom <span className="tag-editor__required">*</span>
            </label>
            <Input
              id="tag-name"
              type="text"
              value={formData.name}
              onChange={handleNameChange}
              placeholder="Entrez le nom du tag"
              error={validationError || undefined}
              autoFocus
            />
          </div>

          {/* Parent selector */}
          <div className="tag-editor__field">
            <label className="tag-editor__label" htmlFor="tag-parent">
              Tag parent
            </label>
            <select
              id="tag-parent"
              className="tag-editor__select"
              value={formData.parentId || ''}
              onChange={handleParentChange}
            >
              <option value="">Aucun parent (tag racine)</option>
              {availableParents.map((t) => (
                <option key={t.id} value={t.id}>
                  {getTagPath(t.id)}
                </option>
              ))}
            </select>
          </div>

          {/* Color picker */}
          <div className="tag-editor__field">
            <label className="tag-editor__label">Couleur</label>
            <div className="tag-editor__colors">
              {TAG_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={clsx('tag-editor__color', {
                    'tag-editor__color--selected': formData.color === color,
                  })}
                  style={{ backgroundColor: color }}
                  onClick={() => handleColorChange(color)}
                  aria-label={`Couleur ${color}`}
                  aria-pressed={formData.color === color}
                />
              ))}
            </div>
          </div>

          {/* Aliases */}
          <div className="tag-editor__field">
            <label className="tag-editor__label" htmlFor="tag-alias">
              Alias (pour la recherche)
            </label>
            <div className="tag-editor__alias-input">
              <Input
                id="tag-alias"
                type="text"
                value={aliasInput}
                onChange={handleAliasInputChange}
                onKeyPress={handleAliasKeyPress}
                placeholder="Ajouter un alias"
                size="sm"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={handleAddAlias}
                disabled={!aliasInput.trim()}
                leftIcon={<PlusIcon />}
              >
                Ajouter
              </Button>
            </div>
            {formData.aliases.length > 0 && (
              <div className="tag-editor__aliases">
                {formData.aliases.map((alias) => (
                  <span key={alias} className="tag-editor__alias">
                    {alias}
                    <button
                      type="button"
                      className="tag-editor__alias-remove"
                      onClick={() => handleRemoveAlias(alias)}
                      aria-label={`Supprimer l'alias ${alias}`}
                    >
                      <CloseIcon />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Description */}
          <div className="tag-editor__field">
            <label className="tag-editor__label" htmlFor="tag-description">
              Description
            </label>
            <textarea
              id="tag-description"
              className="tag-editor__textarea"
              value={formData.description}
              onChange={handleDescriptionChange}
              placeholder="Description optionnelle"
              rows={3}
            />
          </div>

          {/* Preview */}
          <div className="tag-editor__preview">
            <span className="tag-editor__preview-label">Apercu:</span>
            <span
              className="tag-editor__preview-tag"
              style={{ backgroundColor: formData.color }}
            >
              {formData.name || 'Nouveau tag'}
            </span>
          </div>
        </div>
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
          Annuler
        </Button>
        <Button
          variant="primary"
          onClick={handleSubmit}
          loading={isSubmitting}
          disabled={!formData.name.trim()}
        >
          {isEditMode ? 'Enregistrer' : 'Creer'}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default TagEditor;
