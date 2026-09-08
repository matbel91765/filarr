/**
 * MoveCopyDialog Component
 *
 * Dialog pour sélectionner un dossier de destination lors d'un déplacement ou d'une copie
 */

import { useState, useMemo, useCallback, useRef, FC, KeyboardEvent, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../Modal/Modal';
import { Button } from '../Button/Button';
import { Input } from '../Input/Input';
import useFolder from '../../../../hooks/useFolder';
import { selectAllFolders } from '../../../../store/selectors/folderSelectors';
import { ROOT_FOLDER_ID } from '../../../../services/core/storageAdapter';
import type { Folder } from '../../../../types';
import './MoveCopyDialog.css';

import * as profileStorage from '../../../../services/core/profileStorage';
/** Destinations récemment choisies, les plus récentes en tête. */
const RECENT_TARGETS_KEY = 'filarr.moveCopy.recentTargets';
const MAX_RECENT_TARGETS = 5;

const readRecentTargets = (): string[] => {
  try {
    const raw = profileStorage.getItemWithLegacyFallback(RECENT_TARGETS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed)
      ? parsed.filter((id: unknown): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
};

const pushRecentTarget = (folderId: string): void => {
  try {
    const next = [folderId, ...readRecentTargets().filter((id) => id !== folderId)].slice(
      0,
      MAX_RECENT_TARGETS
    );
    profileStorage.setItem(RECENT_TARGETS_KEY, JSON.stringify(next));
  } catch {
    /* Les récents sont un confort : un stockage indisponible ne doit rien casser. */
  }
};

// Icônes
const FolderIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="20"
    height="20"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
    />
  </svg>
);

const HomeIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="20"
    height="20"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75"
    />
  </svg>
);

const ChevronRightIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="16"
    height="16"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
  </svg>
);

const ChevronDownIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="16"
    height="16"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
  </svg>
);

const SearchIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="20"
    height="20"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
    />
  </svg>
);

const PlusIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="16"
    height="16"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
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
  /**
   * Autorise la racine comme destination. Elle n'est valide que pour le
   * DÉPLACEMENT d'un dossier : la racine n'a pas de répertoire de contenu, et
   * `copyItem` ne connaît pas la sentinelle.
   */
  allowRootTarget?: boolean;
  /**
   * Opération en cours côté appelant. Tant qu'elle dure, la boîte reste ouverte
   * et verrouillée : c'est le parent qui la referme à l'arrivée. Ne pas passer
   * la prop du tout laisse le comportement historique (fermeture immédiate à la
   * validation, l'appelant se débrouillant de l'attente).
   */
  busy?: boolean;
  /** Texte d'avancement affiché dans le pied pendant `busy` (ex. « Déplacement 3/12… ») */
  busyLabel?: string;
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
    return allFolders.filter((f) => f.parentId === folder.id);
  }, [allFolders, folder.id]);

  const hasChildren = subFolders.length > 0;

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isDisabled) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(folder.id);
    }
  };

  return (
    <div className="folder-tree-item">
      <div
        className={`folder-tree-item__content ${isSelected ? 'folder-tree-item__content--selected' : ''} ${isDisabled ? 'folder-tree-item__content--disabled' : ''}`}
        style={{ paddingLeft: `${level * 20 + 8}px` }}
        data-folder-id={folder.id}
        role="button"
        tabIndex={isDisabled ? -1 : 0}
        aria-pressed={isSelected}
        aria-disabled={isDisabled}
        onKeyDown={handleKeyDown}
        onClick={() => !isDisabled && onSelect(folder.id)}
      >
        <div
          className="folder-tree-item__expand"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) {
              onToggleExpand(folder.id);
            }
          }}
        >
          {hasChildren ? (
            isExpanded ? (
              <ChevronDownIcon />
            ) : (
              <ChevronRightIcon />
            )
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
          {subFolders.map((subFolder) => (
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
  allowRootTarget = false,
  busy,
  busyLabel,
}) => {
  const { t } = useTranslation();
  const { addFolder } = useFolder();
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [newName, setNewName] = useState<string>(itemName);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [recentTargets, setRecentTargets] = useState<string[]>([]);
  const [isCreatingFolder, setIsCreatingFolder] = useState<boolean>(false);
  const [newFolderName, setNewFolderName] = useState<string>('');
  const [isSavingFolder, setIsSavingFolder] = useState<boolean>(false);

  const treeRef = useRef<HTMLDivElement>(null);

  // Récupérer tous les dossiers du store (sélecteur memoized : une identité
  // stable est indispensable, plusieurs effets ci-dessous en dépendent).
  const allFolders = useSelector(selectAllFolders);

  // Calculer les dossiers désactivés (pour éviter les déplacements circulaires)
  const disabledFolderIds = useMemo(() => {
    const disabled = new Set<string>();
    disabled.add(currentFolderId); // Le dossier actuel est toujours désactivé

    // Si on déplace un dossier, désactiver ce dossier et tous ses descendants
    if (itemId) {
      disabled.add(itemId);

      const addDescendants = (folderId: string) => {
        allFolders.forEach((folder) => {
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
    return allFolders.filter((f) => !f.parentId || f.parentId === ROOT_FOLDER_ID);
  }, [allFolders]);

  // Filtrer les dossiers selon la recherche
  const filteredFolders = useMemo(() => {
    if (!searchQuery) return rootFolders;

    const matchingFolders = allFolders.filter((f) =>
      f.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Inclure les parents des dossiers correspondants
    const foldersToShow = new Set<string>();
    matchingFolders.forEach((folder) => {
      foldersToShow.add(folder.id);

      // Ajouter tous les parents
      let currentParentId = folder.parentId;
      while (currentParentId) {
        foldersToShow.add(currentParentId);
        const parent = allFolders.find((f) => f.id === currentParentId);
        currentParentId = parent?.parentId;
      }
    });

    return rootFolders.filter((f) => foldersToShow.has(f.id));
  }, [rootFolders, allFolders, searchQuery]);

  // Auto-expand les dossiers lors de la recherche
  useEffect(() => {
    if (searchQuery) {
      const newExpanded = new Set<string>();
      allFolders.forEach((folder) => {
        if (folder.name.toLowerCase().includes(searchQuery.toLowerCase())) {
          // Expand tous les parents
          let currentParentId = folder.parentId;
          while (currentParentId) {
            newExpanded.add(currentParentId);
            const parent = allFolders.find((f) => f.id === currentParentId);
            currentParentId = parent?.parentId;
          }
        }
      });
      setExpandedFolders(newExpanded);
    }
  }, [searchQuery, allFolders]);

  // L'amorçage ci-dessous ne doit jouer QU'À L'OUVERTURE : s'il dépendait de
  // `allFolders`, la moindre création de dossier replierait l'arbre sous les
  // doigts. Le miroir sert à lire l'arbre sans en dépendre.
  const foldersRef = useRef<Folder[]>(allFolders);
  useEffect(() => {
    foldersRef.current = allFolders;
  }, [allFolders]);

  // Ouverture : déplier le chemin du dossier courant et l'amener sous les yeux,
  // pour que la destination la plus probable soit à un clic.
  useEffect(() => {
    if (!isOpen) return;

    setRecentTargets(readRecentTargets());

    const byId = new Map(foldersRef.current.map((f) => [f.id, f]));
    const ancestors = new Set<string>();
    let parentId = byId.get(currentFolderId)?.parentId;
    while (parentId && parentId !== ROOT_FOLDER_ID && !ancestors.has(parentId)) {
      ancestors.add(parentId);
      parentId = byId.get(parentId)?.parentId;
    }
    setExpandedFolders(ancestors);

    // Le déroulé doit être rendu avant qu'on puisse viser la ligne.
    const timer = window.setTimeout(() => {
      const row = treeRef.current?.querySelector(
        `[data-folder-id="${CSS.escape(currentFolderId)}"]`
      );
      row?.scrollIntoView({ block: 'center' });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isOpen, currentFolderId]);

  const handleToggleExpand = useCallback((folderId: string) => {
    setExpandedFolders((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(folderId)) {
        newSet.delete(folderId);
      } else {
        newSet.add(folderId);
      }
      return newSet;
    });
  }, []);

  // Destinations récentes encore valides (un dossier peut avoir été supprimé
  // ou être devenu illégal pour cet item).
  const recentChips = useMemo(() => {
    const byId = new Map(allFolders.map((f) => [f.id, f]));
    return recentTargets
      .map((id) => {
        if (id === ROOT_FOLDER_ID) {
          return allowRootTarget ? { id, label: t('moveCopy.root') } : null;
        }
        const folder = byId.get(id);
        if (!folder || disabledFolderIds.has(id)) return null;
        return { id, label: folder.name };
      })
      .filter((chip): chip is { id: string; label: string } => chip !== null);
  }, [recentTargets, allFolders, disabledFolderIds, allowRootTarget, t]);

  // Parent du dossier à créer : la sélection courante, sinon la racine.
  const createParentId = useMemo(() => {
    return selectedFolderId && selectedFolderId !== ROOT_FOLDER_ID ? selectedFolderId : null;
  }, [selectedFolderId]);

  const createParentLabel = useMemo(() => {
    if (!createParentId) return t('moveCopy.root');
    return allFolders.find((f) => f.id === createParentId)?.name || t('moveCopy.root');
  }, [createParentId, allFolders, t]);

  const handleCreateFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name || isSavingFolder) return;

    setIsSavingFolder(true);
    try {
      const created = await addFolder({ name, parentId: createParentId });
      if (created) {
        setSelectedFolderId(created.id);
        if (createParentId) {
          setExpandedFolders((prev) => new Set(prev).add(createParentId));
        }
        setNewFolderName('');
        setIsCreatingFolder(false);
      }
    } finally {
      setIsSavingFolder(false);
    }
  }, [newFolderName, isSavingFolder, addFolder, createParentId]);

  const handleSubmit = () => {
    if (!selectedFolderId || busy) return;

    pushRecentTarget(selectedFolderId);

    if (mode === 'copy' && newName && newName !== itemName) {
      onSubmit(selectedFolderId, newName);
    } else {
      onSubmit(selectedFolderId);
    }

    // Quand l'appelant pilote `busy`, c'est lui qui referme à la fin de
    // l'opération : se fermer ici escamoterait justement l'état d'attente.
    if (busy === undefined) onClose();
  };

  const handleCancel = () => {
    // Verrou unique pour la croix, le fond et Échap — tous passent par ici.
    if (busy) return;
    setSelectedFolderId(null);
    setNewName(itemName);
    setSearchQuery('');
    setIsCreatingFolder(false);
    setNewFolderName('');
    onClose();
  };

  const handleRootKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSelectedFolderId(ROOT_FOLDER_ID);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleCancel} size="md">
      <ModalHeader onClose={handleCancel} closeLabel={t('common.close')}>
        {mode === 'move'
          ? t('moveCopy.moveTitle', { name: itemName })
          : t('moveCopy.copyTitle', { name: itemName })}
      </ModalHeader>
      <ModalBody>
        <div className="move-copy-dialog">
          <div className="move-copy-dialog__info">{t('moveCopy.info')}</div>

          {/* Destinations récentes */}
          {recentChips.length > 0 && (
            <div className="move-copy-dialog__recent">
              <div className="move-copy-dialog__recent-label">{t('moveCopy.recent')}</div>
              <div className="move-copy-dialog__recent-chips">
                {recentChips.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    className={`move-copy-dialog__chip ${selectedFolderId === chip.id ? 'move-copy-dialog__chip--selected' : ''}`}
                    onClick={() => setSelectedFolderId(chip.id)}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Recherche */}
          <div className="move-copy-dialog__search">
            <Input
              placeholder={t('moveCopy.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              leftIcon={<SearchIcon />}
              size="md"
            />
          </div>

          {/* Arbre des dossiers */}
          <div className="move-copy-dialog__tree" ref={treeRef}>
            {/* La racine n'est pas un dossier stocké : c'est l'absence de parent,
                représentée par la sentinelle ROOT_FOLDER_ID. */}
            {allowRootTarget && !searchQuery && (
              <div className="folder-tree-item">
                <div
                  className={`folder-tree-item__content folder-tree-item__content--root ${selectedFolderId === ROOT_FOLDER_ID ? 'folder-tree-item__content--selected' : ''}`}
                  style={{ paddingLeft: '8px' }}
                  data-folder-id={ROOT_FOLDER_ID}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selectedFolderId === ROOT_FOLDER_ID}
                  onKeyDown={handleRootKeyDown}
                  onClick={() => setSelectedFolderId(ROOT_FOLDER_ID)}
                >
                  <div className="folder-tree-item__expand">
                    <span style={{ width: '16px', display: 'inline-block' }} />
                  </div>
                  <div className="folder-tree-item__icon">
                    <HomeIcon />
                  </div>
                  <div className="folder-tree-item__name">{t('moveCopy.root')}</div>
                </div>
              </div>
            )}

            {filteredFolders.length === 0 ? (
              !allowRootTarget || searchQuery ? (
                <div className="move-copy-dialog__empty">
                  {searchQuery ? t('moveCopy.noResults') : t('moveCopy.empty')}
                </div>
              ) : null
            ) : (
              filteredFolders.map((folder) => (
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

          {/* Création d'un dossier dans la destination sélectionnée */}
          <div className="move-copy-dialog__create">
            {isCreatingFolder ? (
              <>
                <div className="move-copy-dialog__create-hint">
                  {t('moveCopy.newFolderIn', { name: createParentLabel })}
                </div>
                <div className="move-copy-dialog__create-row">
                  <Input
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleCreateFolder();
                      }
                    }}
                    placeholder={t('moveCopy.newFolderPlaceholder')}
                    size="sm"
                    fullWidth
                    autoFocus
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void handleCreateFolder()}
                    disabled={!newFolderName.trim() || isSavingFolder}
                  >
                    {t('common.create')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setIsCreatingFolder(false);
                      setNewFolderName('');
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                </div>
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<PlusIcon />}
                onClick={() => setIsCreatingFolder(true)}
              >
                {t('moveCopy.newFolderHere')}
              </Button>
            )}
          </div>

          {/* Champ pour renommer lors de la copie */}
          {mode === 'copy' && (
            <div className="move-copy-dialog__rename">
              <label className="move-copy-dialog__rename-label" htmlFor="move-copy-new-name">
                {t('moveCopy.renameLabel')}
              </label>
              <Input
                id="move-copy-new-name"
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
        {busy && busyLabel && (
          <span
            className="mr-auto text-sm text-[var(--color-text-secondary)]"
            aria-live="polite"
            role="status"
          >
            {busyLabel}
          </span>
        )}
        <Button variant="secondary" onClick={handleCancel} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          onClick={handleSubmit}
          loading={busy}
          disabled={!selectedFolderId || busy}
        >
          {mode === 'move' ? t('moveCopy.move') : t('moveCopy.copy')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default MoveCopyDialog;
