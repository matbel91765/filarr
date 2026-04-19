/**
 * MoveCopyDialog Component
 *
 * Dialog pour sélectionner un dossier de destination lors d'un déplacement ou d'une copie
 */

import { useState, useMemo, FC, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../Modal/Modal';
import { Button } from '../Button/Button';
import { Input } from '../Input/Input';
import type { RootState } from '../../../../store';
import type { Folder } from '../../../../types';
import './MoveCopyDialog.css';

// Icônes
const FolderIcon: FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="20" height="20">
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
  </svg>
);

const ChevronRightIcon: FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="16" height="16">
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
  </svg>
);

const ChevronDownIcon: FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="16" height="16">
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
  </svg>
);

const SearchIcon: FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="20" height="20">
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
  </svg>
);

// Props
export interface MoveCopyDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (targetFolderId: string, newName?: string) => void;
  mode: 'move' | 'copy';
  itemName: string;
  currentFolderId: string;
  itemId?: string;
}

// Composant FolderTreeItem
interface FolderTreeItemProps {
  folder: Folder;
  level: number;
  selectedFolderId: string | null;
  onSelect: (folderId: string) => void;
  expandedFolders: Set<string>;
  onToggleExpand: (folderId: string) => void;
  allFolders: Folder[];
  disabledFolderIds: Set<string>;
}

const FolderTreeItem: FC<FolderTreeItemProps> = ({
  folder,
  level,
  selectedFolderId,
  onSelect,
  expandedFolders,
  onToggleExpand,
  allFolders,
  disabledFolderIds,
}) => {
  const isExpanded = expandedFolders.has(folder.id);
  const isSelected = selectedFolderId === folder.id;
  const isDisabled = disabledFolderIds.has(folder.id);

  // Trouver les sous-dossiers
  const subFolders = useMemo(() => {
    return allFolders.filter(f => f.parentId === folder.id);
  }, [allFolders, folder.id]);

  const hasChildren = subFolders.length > 0;

  return (
    <div className="folder-tree-item">
      <div
        className={`folder-tree-item__content ${isSelected ? 'folder-tree-item__content--selected' : ''} ${isDisabled ? 'folder-tree-item__content--disabled' : ''}`}
        style={{ paddingLeft: `${level * 20 + 8}px` }}
        onClick={() => !isDisabled && onSelect(folder.id)}
      >
        <div className="folder-tree-item__expand" onClick={(e) => {
          e.stopPropagation();
          if (hasChildren) {
            onToggleExpand(folder.id);
          }
        }}>
          {hasChildren ? (
            isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />
          ) : (
            <span style={{ width: '16px', display: 'inline-block' }} />
          )}
        </div>
        <div className="folder-tree-item__icon">
          <FolderIcon />
        </div>
        <div className="folder-tree-item__name">{folder.name}</div>
      </div>
      {isExpanded && hasChildren && (
        <div className="folder-tree-item__children">
          {subFolders.map(subFolder => (
            <FolderTreeItem
              key={subFolder.id}
              folder={subFolder}
              level={level + 1}
              selectedFolderId={selectedFolderId}
              onSelect={onSelect}
              expandedFolders={expandedFolders}
              onToggleExpand={onToggleExpand}
              allFolders={allFolders}
              disabledFolderIds={disabledFolderIds}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// Composant principal
export const MoveCopyDialog: FC<MoveCopyDialogProps> = ({
  isOpen,
  onClose,
  onSubmit,
  mode,
  itemName,
  currentFolderId,
  itemId,
}) => {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [newName, setNewName] = useState<string>(itemName);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Récupérer tous les dossiers du store
  const allFolders = useSelector((state: RootState) => {
    return Object.values(state.folders.byId);
  });

  // Calculer les dossiers désactivés (pour éviter les déplacements circulaires)
  const disabledFolderIds = useMemo(() => {
    const disabled = new Set<string>();
    disabled.add(currentFolderId); // Le dossier actuel est toujours désactivé

    // Si on déplace un dossier, désactiver ce dossier et tous ses descendants
    if (itemId) {
      disabled.add(itemId);

      const addDescendants = (folderId: string) => {
        allFolders.forEach(folder => {
          if (folder.parentId === folderId) {
            disabled.add(folder.id);
            addDescendants(folder.id);
          }
        });
      };

      addDescendants(itemId);
    }

    return disabled;
  }, [currentFolderId, itemId, allFolders]);

  // Dossiers racine (pas de parentId)
  const rootFolders = useMemo(() => {
    return allFolders.filter(f => !f.parentId || f.parentId === 'root');
  }, [allFolders]);

  // Filtrer les dossiers selon la recherche
  const filteredFolders = useMemo(() => {
    if (!searchQuery) return rootFolders;

    const matchingFolders = allFolders.filter(f =>
      f.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Inclure les parents des dossiers correspondants
    const foldersToShow = new Set<string>();
    matchingFolders.forEach(folder => {
      foldersToShow.add(folder.id);

      // Ajouter tous les parents
      let currentParentId = folder.parentId;
      while (currentParentId) {
        foldersToShow.add(currentParentId);
        const parent = allFolders.find(f => f.id === currentParentId);
        currentParentId = parent?.parentId;
      }
    });

    return rootFolders.filter(f => foldersToShow.has(f.id));
  }, [rootFolders, allFolders, searchQuery]);

  // Auto-expand les dossiers lors de la recherche
  useEffect(() => {
    if (searchQuery) {
      const newExpanded = new Set<string>();
      allFolders.forEach(folder => {
        if (folder.name.toLowerCase().includes(searchQuery.toLowerCase())) {
          // Expand tous les parents
          let currentParentId = folder.parentId;
          while (currentParentId) {
            newExpanded.add(currentParentId);
            const parent = allFolders.find(f => f.id === currentParentId);
            currentParentId = parent?.parentId;
          }
        }
      });
      setExpandedFolders(newExpanded);
    }
  }, [searchQuery, allFolders]);

  const handleToggleExpand = (folderId: string) => {
    setExpandedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(folderId)) {
        newSet.delete(folderId);
      } else {
        newSet.add(folderId);
      }
      return newSet;
    });
  };

  const handleSubmit = () => {
    if (!selectedFolderId) return;

    if (mode === 'copy' && newName && newName !== itemName) {
      onSubmit(selectedFolderId, newName);
    } else {
      onSubmit(selectedFolderId);
    }

    onClose();
  };

  const handleCancel = () => {
    setSelectedFolderId(null);
    setNewName(itemName);
    setSearchQuery('');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleCancel} size="md">
      <ModalHeader onClose={handleCancel}>
        {mode === 'move' ? 'Déplacer' : 'Copier'} "{itemName}"
      </ModalHeader>
      <ModalBody>
        <div className="move-copy-dialog">
          <div className="move-copy-dialog__info">
            Sélectionnez un dossier de destination:
          </div>

          {/* Recherche */}
          <div className="move-copy-dialog__search">
            <Input
              placeholder="Rechercher un dossier..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              leftIcon={<SearchIcon />}
              size="md"
            />
          </div>

          {/* Arbre des dossiers */}
          <div className="move-copy-dialog__tree">
            {filteredFolders.length === 0 ? (
              <div className="move-copy-dialog__empty">
                {searchQuery ? 'Aucun dossier trouvé' : 'Aucun dossier disponible'}
              </div>
            ) : (
              filteredFolders.map(folder => (
                <FolderTreeItem
                  key={folder.id}
                  folder={folder}
                  level={0}
                  selectedFolderId={selectedFolderId}
                  onSelect={setSelectedFolderId}
                  expandedFolders={expandedFolders}
                  onToggleExpand={handleToggleExpand}
                  allFolders={allFolders}
                  disabledFolderIds={disabledFolderIds}
                />
              ))
            )}
          </div>

          {/* Champ pour renommer lors de la copie */}
          {mode === 'copy' && (
            <div className="move-copy-dialog__rename">
              <label className="move-copy-dialog__rename-label">
                Nouveau nom (optionnel):
              </label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={itemName}
                size="md"
              />
            </div>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={handleCancel}>
          Annuler
        </Button>
        <Button
          variant="primary"
          onClick={handleSubmit}
          disabled={!selectedFolderId}
        >
          {mode === 'move' ? 'Déplacer' : 'Copier'}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default MoveCopyDialog;
