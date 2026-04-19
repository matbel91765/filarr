/**
 * CommandPalette Component
 *
 * Palette de commandes inspirée de VS Code pour accès rapide aux fichiers,
 * actions et paramètres. Ouverte avec Ctrl+P.
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  forwardRef
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useCommandPalette, Command, CommandCategory } from '../../../../hooks/useCommandPalette';
import './CommandPalette.css';

export interface CommandPaletteProps {
  /** Est-ce que la palette est ouverte */
  isOpen: boolean;
  /** Callback de fermeture */
  onClose: () => void;
  /** Callback lors de l'exécution d'une commande */
  onExecute?: (command: Command) => void;
  /** Classe CSS additionnelle */
  className?: string;
  /** Placeholder pour le champ de recherche */
  placeholder?: string;
}

/**
 * Composant CommandPalette
 */
export const CommandPalette = forwardRef<HTMLDivElement, CommandPaletteProps>(
  (
    {
      isOpen,
      onClose,
      onExecute,
      className,
      placeholder = 'Rechercher fichiers, commandes, paramètres...'
    },
    ref
  ) => {
    const {
      query,
      setQuery,
      filteredCommands,
      selectedIndex,
      setSelectedIndex,
      executeCommand,
      recentCommands,
      categories,
      getCategoryIcon,
      getCategoryName
    } = useCommandPalette();

    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

    // Focus sur l'input à l'ouverture
    useEffect(() => {
      if (isOpen) {
        setQuery('');
        setSelectedIndex(0);
        setTimeout(() => {
          inputRef.current?.focus();
        }, 50);
      }
    }, [isOpen, setQuery, setSelectedIndex]);

    // Scroll vers l'élément sélectionné
    useEffect(() => {
      const selectedItem = itemRefs.current.get(selectedIndex);
      if (selectedItem && listRef.current) {
        const listRect = listRef.current.getBoundingClientRect();
        const itemRect = selectedItem.getBoundingClientRect();

        if (itemRect.top < listRect.top) {
          selectedItem.scrollIntoView({ block: 'start', behavior: 'smooth' });
        } else if (itemRect.bottom > listRect.bottom) {
          selectedItem.scrollIntoView({ block: 'end', behavior: 'smooth' });
        }
      }
    }, [selectedIndex]);

    // Grouper les commandes par catégorie
    const groupedCommands = useMemo(() => {
      if (query.trim() === '' && recentCommands.length > 0) {
        // Afficher les commandes récentes en premier si pas de recherche
        return {
          recent: recentCommands.slice(0, 5),
          ...categories.reduce((acc, cat) => {
            const commands = filteredCommands.filter(cmd => cmd.category === cat.id);
            if (commands.length > 0) {
              acc[cat.id] = commands;
            }
            return acc;
          }, {} as Record<string, Command[]>)
        };
      }

      // Grouper par catégorie
      const groups: Record<string, Command[]> = {};
      filteredCommands.forEach(cmd => {
        if (!groups[cmd.category]) {
          groups[cmd.category] = [];
        }
        groups[cmd.category].push(cmd);
      });

      return groups;
    }, [query, recentCommands, filteredCommands, categories]);

    // Calculer l'index global pour la navigation
    const flattenedCommands = useMemo(() => {
      const result: Command[] = [];
      Object.values(groupedCommands).forEach(commands => {
        result.push(...commands);
      });
      return result;
    }, [groupedCommands]);

    // Gestion du clavier
    const handleKeyDown = useCallback(
      (event: React.KeyboardEvent) => {
        switch (event.key) {
          case 'ArrowDown':
            event.preventDefault();
            setSelectedIndex(prev =>
              prev < flattenedCommands.length - 1 ? prev + 1 : 0
            );
            break;

          case 'ArrowUp':
            event.preventDefault();
            setSelectedIndex(prev =>
              prev > 0 ? prev - 1 : flattenedCommands.length - 1
            );
            break;

          case 'Enter':
            event.preventDefault();
            if (flattenedCommands[selectedIndex]) {
              handleExecute(flattenedCommands[selectedIndex]);
            }
            break;

          case 'Escape':
            event.preventDefault();
            onClose();
            break;

          case 'Tab':
            event.preventDefault();
            // Tab pour naviguer vers le bas, Shift+Tab vers le haut
            if (event.shiftKey) {
              setSelectedIndex(prev =>
                prev > 0 ? prev - 1 : flattenedCommands.length - 1
              );
            } else {
              setSelectedIndex(prev =>
                prev < flattenedCommands.length - 1 ? prev + 1 : 0
              );
            }
            break;
        }
      },
      [flattenedCommands, selectedIndex, setSelectedIndex, onClose]
    );

    // Exécuter une commande
    const handleExecute = useCallback(
      (command: Command) => {
        executeCommand(command);
        onExecute?.(command);
        onClose();
      },
      [executeCommand, onExecute, onClose]
    );

    // Clic sur le backdrop
    const handleBackdropClick = useCallback(
      (event: React.MouseEvent) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      },
      [onClose]
    );

    // Rendu d'une commande
    const renderCommand = useCallback(
      (command: Command, globalIndex: number) => {
        const isSelected = globalIndex === selectedIndex;

        return (
          <button
            key={command.id}
            ref={(el) => {
              if (el) {
                itemRefs.current.set(globalIndex, el);
              } else {
                itemRefs.current.delete(globalIndex);
              }
            }}
            className={clsx('command-palette__item', {
              'command-palette__item--selected': isSelected
            })}
            onClick={() => handleExecute(command)}
            onMouseEnter={() => setSelectedIndex(globalIndex)}
            role="option"
            aria-selected={isSelected}
          >
            {/* Icône */}
            <span
              className="command-palette__item-icon"
              dangerouslySetInnerHTML={{ __html: command.icon || getCategoryIcon(command.category) }}
            />

            {/* Contenu */}
            <div className="command-palette__item-content">
              <span className="command-palette__item-title">
                {highlightMatch(command.name, query)}
              </span>
              {command.description && (
                <span className="command-palette__item-description">
                  {command.description}
                </span>
              )}
            </div>

            {/* Raccourci clavier */}
            {command.shortcut && (
              <span className="command-palette__item-shortcut">
                {formatShortcut(command.shortcut)}
              </span>
            )}

            {/* Badge de catégorie */}
            <span className="command-palette__item-category">
              {getCategoryName(command.category)}
            </span>
          </button>
        );
      },
      [selectedIndex, query, handleExecute, setSelectedIndex, getCategoryIcon, getCategoryName]
    );

    if (!isOpen) return null;

    let globalIndex = -1;

    const paletteContent = (
      <div
        className="command-palette__backdrop"
        onClick={handleBackdropClick}
        role="presentation"
      >
        <div
          ref={ref}
          className={clsx('command-palette', className)}
          role="combobox"
          aria-expanded="true"
          aria-haspopup="listbox"
          aria-owns="command-palette-list"
        >
          {/* Champ de recherche */}
          <div className="command-palette__header">
            <div className="command-palette__search">
              <svg
                className="command-palette__search-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                className="command-palette__input"
                placeholder={placeholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                aria-autocomplete="list"
                aria-controls="command-palette-list"
                aria-activedescendant={
                  flattenedCommands[selectedIndex]
                    ? `command-${flattenedCommands[selectedIndex].id}`
                    : undefined
                }
              />
              {query && (
                <button
                  className="command-palette__clear"
                  onClick={() => setQuery('')}
                  aria-label="Effacer la recherche"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Liste des résultats */}
          <div
            ref={listRef}
            className="command-palette__list"
            id="command-palette-list"
            role="listbox"
          >
            {Object.entries(groupedCommands).map(([category, commands]) => {
              if (commands.length === 0) return null;

              return (
                <div key={category} className="command-palette__group">
                  <div className="command-palette__group-header">
                    {category === 'recent' ? 'Récent' : getCategoryName(category as CommandCategory)}
                  </div>
                  <div className="command-palette__group-items">
                    {commands.map(command => {
                      globalIndex++;
                      return renderCommand(command, globalIndex);
                    })}
                  </div>
                </div>
              );
            })}

            {flattenedCommands.length === 0 && (
              <div className="command-palette__empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="11" cy="11" r="8" />
                  <path d="M21 21l-4.35-4.35" />
                  <path d="M8 11h6" />
                </svg>
                <p>Aucun résultat pour "{query}"</p>
                <span>Essayez avec d'autres termes</span>
              </div>
            )}
          </div>

          {/* Footer avec instructions */}
          <div className="command-palette__footer">
            <div className="command-palette__hint">
              <kbd>↑</kbd><kbd>↓</kbd> pour naviguer
            </div>
            <div className="command-palette__hint">
              <kbd>↵</kbd> pour exécuter
            </div>
            <div className="command-palette__hint">
              <kbd>Esc</kbd> pour fermer
            </div>
          </div>
        </div>
      </div>
    );

    return createPortal(paletteContent, document.body);
  }
);

CommandPalette.displayName = 'CommandPalette';

/**
 * Mettre en évidence les correspondances dans le texte
 */
function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;

  const parts: React.ReactNode[] = [];
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let lastIndex = 0;

  // Recherche simple par caractères
  const queryChars = lowerQuery.split('');
  let charIndex = 0;

  for (let i = 0; i < text.length && charIndex < queryChars.length; i++) {
    if (lowerText[i] === queryChars[charIndex]) {
      if (i > lastIndex) {
        parts.push(
          <span key={`text-${lastIndex}`}>{text.slice(lastIndex, i)}</span>
        );
      }
      parts.push(
        <mark key={`match-${i}`} className="command-palette__highlight">
          {text[i]}
        </mark>
      );
      lastIndex = i + 1;
      charIndex++;
    }
  }

  if (lastIndex < text.length) {
    parts.push(<span key={`text-end`}>{text.slice(lastIndex)}</span>);
  }

  return parts.length > 0 ? <>{parts}</> : text;
}

/**
 * Formater un raccourci clavier pour l'affichage
 */
function formatShortcut(shortcut: string[]): React.ReactNode {
  return shortcut.map((key, index) => (
    <kbd key={index} className="command-palette__kbd">
      {key}
    </kbd>
  ));
}

export default CommandPalette;
