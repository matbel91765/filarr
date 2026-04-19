/**
 * KeyboardShortcutsSettings Component
 *
 * Composant de paramétrage des raccourcis clavier.
 * Permet aux utilisateurs de voir, modifier et personnaliser les raccourcis clavier.
 */

import React, { useState, useCallback, useMemo } from 'react';
import clsx from 'clsx';
import { useKeyboardShortcuts } from '../../../hooks/useKeyboardShortcuts';
import type { KeyboardShortcut, ShortcutCategory } from '../../../services/platform/shortcutsService';
import './KeyboardShortcutsSettings.css';

export interface KeyboardShortcutsSettingsProps {
  /** Classe CSS additionnelle */
  className?: string;
  /** Callback lors de la modification d'un raccourci */
  onShortcutChange?: (shortcut: KeyboardShortcut) => void;
}

/**
 * Composant KeyboardShortcutsSettings
 */
export const KeyboardShortcutsSettings: React.FC<KeyboardShortcutsSettingsProps> = ({
  className,
  onShortcutChange
}) => {
  const {
    shortcuts,
    getShortcutsByCategory,
    updateShortcutKeys,
    toggleShortcut,
    resetShortcut,
    resetAllShortcuts,
    formatKeys,
    hasConflict,
    categories,
    isRecording,
    startRecording,
    stopRecording,
    recordedKeys,
    recordingShortcutId
  } = useKeyboardShortcuts({ enabled: false }); // Désactiver pendant l'édition

  const [selectedCategory, setSelectedCategory] = useState<ShortcutCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showConfirmReset, setShowConfirmReset] = useState(false);

  // Filtrer les raccourcis
  const filteredShortcuts = useMemo(() => {
    let result = selectedCategory === 'all'
      ? shortcuts
      : getShortcutsByCategory(selectedCategory as ShortcutCategory);

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        shortcut =>
          shortcut.name.toLowerCase().includes(query) ||
          shortcut.description.toLowerCase().includes(query) ||
          shortcut.keys.join(' ').toLowerCase().includes(query)
      );
    }

    return result;
  }, [shortcuts, selectedCategory, searchQuery, getShortcutsByCategory]);

  // Grouper par catégorie si "all" est sélectionné
  const groupedShortcuts = useMemo(() => {
    if (selectedCategory !== 'all') {
      return { [selectedCategory]: filteredShortcuts };
    }

    const groups: Record<string, KeyboardShortcut[]> = {};
    filteredShortcuts.forEach(shortcut => {
      if (!groups[shortcut.category]) {
        groups[shortcut.category] = [];
      }
      groups[shortcut.category].push(shortcut);
    });

    return groups;
  }, [filteredShortcuts, selectedCategory]);

  // Gérer le clic sur le bouton d'enregistrement
  const handleRecordClick = useCallback((shortcutId: string) => {
    if (isRecording && recordingShortcutId === shortcutId) {
      stopRecording();
    } else {
      startRecording(shortcutId);
    }
  }, [isRecording, recordingShortcutId, startRecording, stopRecording]);

  // Appliquer les touches enregistrées
  const handleApplyRecordedKeys = useCallback((shortcutId: string) => {
    if (recordedKeys.length === 0) return;

    // Vérifier les conflits
    const conflict = hasConflict(shortcutId, recordedKeys);
    if (conflict) {
      alert(`Conflit avec le raccourci "${conflict.name}". Veuillez choisir une autre combinaison.`);
      return;
    }

    const success = updateShortcutKeys(shortcutId, recordedKeys);
    if (success) {
      stopRecording();
      const shortcut = shortcuts.find(s => s.id === shortcutId);
      if (shortcut && onShortcutChange) {
        onShortcutChange({ ...shortcut, keys: recordedKeys });
      }
    }
  }, [recordedKeys, hasConflict, updateShortcutKeys, stopRecording, shortcuts, onShortcutChange]);

  // Gérer le toggle d'activation
  const handleToggle = useCallback((shortcutId: string, enabled: boolean) => {
    toggleShortcut(shortcutId, enabled);
    const shortcut = shortcuts.find(s => s.id === shortcutId);
    if (shortcut && onShortcutChange) {
      onShortcutChange({ ...shortcut, enabled });
    }
  }, [toggleShortcut, shortcuts, onShortcutChange]);

  // Gérer la réinitialisation d'un raccourci
  const handleResetShortcut = useCallback((shortcutId: string) => {
    resetShortcut(shortcutId);
    const shortcut = shortcuts.find(s => s.id === shortcutId);
    if (shortcut && onShortcutChange) {
      onShortcutChange(shortcut);
    }
  }, [resetShortcut, shortcuts, onShortcutChange]);

  // Gérer la réinitialisation de tous les raccourcis
  const handleResetAll = useCallback(() => {
    resetAllShortcuts();
    setShowConfirmReset(false);
  }, [resetAllShortcuts]);

  // Obtenir le nom de la catégorie
  const getCategoryName = useCallback((categoryId: string): string => {
    const category = categories.find(c => c.id === categoryId);
    return category ? category.name : categoryId;
  }, [categories]);

  const containerClasses = clsx('keyboard-shortcuts-settings', className);

  return (
    <div className={containerClasses}>
      {/* En-tête */}
      <div className="keyboard-shortcuts-settings__header">
        <h2 className="keyboard-shortcuts-settings__title">Raccourcis clavier</h2>
        <p className="keyboard-shortcuts-settings__description">
          Personnalisez les raccourcis clavier pour naviguer plus rapidement dans l'application.
        </p>
      </div>

      {/* Barre d'outils */}
      <div className="keyboard-shortcuts-settings__toolbar">
        {/* Recherche */}
        <div className="keyboard-shortcuts-settings__search">
          <svg
            className="keyboard-shortcuts-settings__search-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            className="keyboard-shortcuts-settings__search-input"
            placeholder="Rechercher un raccourci..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="keyboard-shortcuts-settings__search-clear"
              onClick={() => setSearchQuery('')}
              aria-label="Effacer la recherche"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Filtre par catégorie */}
        <div className="keyboard-shortcuts-settings__filter">
          <select
            className="keyboard-shortcuts-settings__category-select"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value as ShortcutCategory | 'all')}
          >
            <option value="all">Toutes les catégories</option>
            {categories.map(category => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        {/* Bouton de réinitialisation */}
        <button
          className="keyboard-shortcuts-settings__reset-all-btn"
          onClick={() => setShowConfirmReset(true)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          Réinitialiser tout
        </button>
      </div>

      {/* Liste des raccourcis */}
      <div className="keyboard-shortcuts-settings__list">
        {Object.entries(groupedShortcuts).map(([category, categoryShortcuts]) => (
          <div key={category} className="keyboard-shortcuts-settings__category">
            {selectedCategory === 'all' && (
              <h3 className="keyboard-shortcuts-settings__category-title">
                {getCategoryName(category)}
              </h3>
            )}

            <div className="keyboard-shortcuts-settings__shortcuts">
              {categoryShortcuts.map(shortcut => (
                <div
                  key={shortcut.id}
                  className={clsx('keyboard-shortcuts-settings__shortcut', {
                    'keyboard-shortcuts-settings__shortcut--disabled': !shortcut.enabled,
                    'keyboard-shortcuts-settings__shortcut--recording':
                      isRecording && recordingShortcutId === shortcut.id
                  })}
                >
                  {/* Informations du raccourci */}
                  <div className="keyboard-shortcuts-settings__shortcut-info">
                    <span className="keyboard-shortcuts-settings__shortcut-name">
                      {shortcut.name}
                    </span>
                    <span className="keyboard-shortcuts-settings__shortcut-description">
                      {shortcut.description}
                    </span>
                  </div>

                  {/* Affichage des touches */}
                  <div className="keyboard-shortcuts-settings__shortcut-keys">
                    {isRecording && recordingShortcutId === shortcut.id ? (
                      <div className="keyboard-shortcuts-settings__recording">
                        {recordedKeys.length > 0 ? (
                          <kbd className="keyboard-shortcuts-settings__kbd keyboard-shortcuts-settings__kbd--recording">
                            {formatKeys(recordedKeys)}
                          </kbd>
                        ) : (
                          <span className="keyboard-shortcuts-settings__recording-hint">
                            Appuyez sur une combinaison...
                          </span>
                        )}
                      </div>
                    ) : (
                      <kbd className="keyboard-shortcuts-settings__kbd">
                        {formatKeys(shortcut.keys)}
                      </kbd>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="keyboard-shortcuts-settings__shortcut-actions">
                    {shortcut.customizable && (
                      <>
                        {isRecording && recordingShortcutId === shortcut.id ? (
                          <>
                            <button
                              className="keyboard-shortcuts-settings__action-btn keyboard-shortcuts-settings__action-btn--apply"
                              onClick={() => handleApplyRecordedKeys(shortcut.id)}
                              disabled={recordedKeys.length === 0}
                              title="Appliquer"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            </button>
                            <button
                              className="keyboard-shortcuts-settings__action-btn keyboard-shortcuts-settings__action-btn--cancel"
                              onClick={stopRecording}
                              title="Annuler"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M18 6L6 18M6 6l12 12" />
                              </svg>
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className="keyboard-shortcuts-settings__action-btn keyboard-shortcuts-settings__action-btn--edit"
                              onClick={() => handleRecordClick(shortcut.id)}
                              title="Modifier"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                            </button>
                            <button
                              className="keyboard-shortcuts-settings__action-btn keyboard-shortcuts-settings__action-btn--reset"
                              onClick={() => handleResetShortcut(shortcut.id)}
                              title="Réinitialiser"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                                <path d="M3 3v5h5" />
                              </svg>
                            </button>
                          </>
                        )}
                      </>
                    )}

                    {/* Toggle */}
                    <label className="keyboard-shortcuts-settings__toggle">
                      <input
                        type="checkbox"
                        checked={shortcut.enabled}
                        onChange={(e) => handleToggle(shortcut.id, e.target.checked)}
                        className="keyboard-shortcuts-settings__toggle-input"
                      />
                      <span className="keyboard-shortcuts-settings__toggle-slider"></span>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {filteredShortcuts.length === 0 && (
          <div className="keyboard-shortcuts-settings__empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
            </svg>
            <p>Aucun raccourci trouvé</p>
          </div>
        )}
      </div>

      {/* Modal de confirmation de réinitialisation */}
      {showConfirmReset && (
        <div className="keyboard-shortcuts-settings__confirm-overlay">
          <div className="keyboard-shortcuts-settings__confirm-modal">
            <h3 className="keyboard-shortcuts-settings__confirm-title">
              Réinitialiser tous les raccourcis ?
            </h3>
            <p className="keyboard-shortcuts-settings__confirm-message">
              Cette action remettra tous les raccourcis clavier à leurs valeurs par défaut.
              Vos personnalisations seront perdues.
            </p>
            <div className="keyboard-shortcuts-settings__confirm-actions">
              <button
                className="keyboard-shortcuts-settings__confirm-btn keyboard-shortcuts-settings__confirm-btn--cancel"
                onClick={() => setShowConfirmReset(false)}
              >
                Annuler
              </button>
              <button
                className="keyboard-shortcuts-settings__confirm-btn keyboard-shortcuts-settings__confirm-btn--confirm"
                onClick={handleResetAll}
              >
                Réinitialiser
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="keyboard-shortcuts-settings__footer">
        <div className="keyboard-shortcuts-settings__instructions">
          <h4>Instructions</h4>
          <ul>
            <li>Cliquez sur le bouton d'édition pour modifier un raccourci</li>
            <li>Appuyez sur la nouvelle combinaison de touches souhaitée</li>
            <li>Validez avec Entrée ou cliquez sur le bouton de validation</li>
            <li>Appuyez sur Échap pour annuler</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default KeyboardShortcutsSettings;
