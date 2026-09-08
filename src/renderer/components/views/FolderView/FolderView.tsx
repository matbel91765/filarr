/**
 * FolderView Component
 *
 * Vue complète pour afficher le contenu d'un dossier avec navigation,
 * recherche, tri, upload et gestion des fichiers
 */

import React, {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  FC,
  MouseEvent,
  DragEvent,
} from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import { Button } from '../../ui/Button/Button';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../../ui/Modal/Modal';
import { ProgressBar } from '../../ui/ProgressBar/ProgressBar';
import { Dropdown } from '../../ui/Dropdown/Dropdown';
import { ContextMenu } from '../../ui/ContextMenu';
import { PromptModal } from '../../ui/PromptModal';
import { CreateFolderModal } from '../../ui/CreateFolderModal';
import { ReminderModal, type ReminderData } from '../../ui/ReminderModal';
import { buildReminder } from '../../../../services/reminders/reminderFactory';
import { MoveCopyDialog } from '../../ui/MoveCopyDialog';
import { FolderStyleModal } from '../../ui/FolderStyleModal/FolderStyleModal';
import { DeleteFolderConfirmModal } from '../../ui/DeleteFolderConfirmModal';
import { VersionHistoryPanel } from '../../versions';
import { FolderPasswordModal } from '../../files/FolderPasswordModal';
import { PasswordUnlockModal } from '../../files/PasswordUnlockModal';
import { isProtected, isUnlockedForSession } from '../../../../services/auth/filePasswordService';
// Le dialogue de partage UNIFIÉ — « Partager… » ouvre LA porte (lien public,
// entrée dans un coffre) ; ShareFileModal reste, mais ouverte PAR le dialogue.
import { useShareDialog } from '../../sharing/useShareDialog';
import { fetchVersions, createVersion } from '../../../../store/slices/versionsSlice';
import { setGroupBy, setSortBy, setViewMode } from '../../../../store/slices/uiSlice';
// ── Le dossier PERSONNALISABLE ────────────────────────────────────────────
// Même conteneur de mise en page que l'accueil, même moteur de grille, même
// mode édition — seul l'identifiant de vue change (`folder:<uuid>`).
import { FolderHeader } from '../../folder/FolderHeader';
import { FolderReadme } from '../../folder/FolderReadme';
import { FolderWidgetBand } from '../../folder/FolderWidgetBand';
import { FolderLayoutMenu } from '../../folder/FolderLayoutMenu';
import { FolderWidgetScopeProvider } from '../../folder/FolderWidgetContext';
import {
  DEFAULT_FOLDER_CONFIG,
  FOLDER_VIEW_PREFIX,
  bandSlots,
  ensureFolderConfig,
  folderViewId,
  isFolderPersonalized,
  readFolderConfigFromSlots,
  resolveFolderLayout,
  withFolderConfig,
  type FolderConfig,
  type FolderScope,
} from '../../folder/folderLayout';
import {
  HomeActionsProvider,
  HomeGridStateProvider,
  type HomeActions,
  type HomeGridState,
} from '../../home/HomeActionsContext';
import {
  beginLayoutEdit,
  cancelLayoutEdit,
  clearLayoutCommit,
  commitLayoutEdit,
  pushLayoutDraft,
  redoLayoutDraft,
  removeView,
  revertLayoutCommit,
  saveLayoutToDisk,
  setViewSlots,
  undoLayoutDraft,
} from '../../../../store/slices/layoutSlice';
import type { LayoutSlot } from '../../../../services/layout/layoutTypes';
import { gridSize } from '../../grid/gridTypes';
import { breakpointForWidth } from '../../../styles/breakpoints';
import useFolder from '../../../../hooks/useFolder';
import useFile from '../../../../hooks/useFile';
import useContextMenu from '../../../../hooks/useContextMenu';
import useDragAndDrop, {
  FILARR_FILE_MIME,
  FILARR_FOLDER_MIME,
  MOVING_TOAST_MIN_MS,
  ROOT_FOLDER_ID,
  SPRING_LOAD_DELAY_MS,
} from '../../../../hooks/useDragAndDrop';
import { useSyncStatus } from '../../../../hooks/useSyncStatus';
import { useNotification } from '../../ui/Notification';
import {
  openFile,
  validateFile,
  validateFileBatch,
  moveFile,
  copyFile,
  downloadMultipleFiles,
  getOsFilePath,
} from '../../../../services/core/fileService';
import { getCurrentStorageMode } from '../../../../services/core/storageAdapter';
import { moveFolder, copyFolder } from '../../../../services/core/folderService';
import {
  selectFolderItems,
  selectFolderPathById,
} from '../../../../store/selectors/folderSelectors';
import { Breadcrumb } from '../../navigation/Breadcrumb';
import { SortGroupBar } from './SortGroupBar';
import { BatchActionToolbar } from './BatchActionToolbar';
// Les briques PRÉSENTATIONNELLES de l'explorateur vivent hors de cette vue :
// la même carte, la même tuile de dossier et la même coque d'en-tête servent
// aussi au navigateur de coffre partagé. Ne pas les redupliquer ici.
import { FileCard, EMPTY_TAGS } from '../../files/FileCard';
import { SubfolderCard } from '../../files/SubfolderCard';
import { ExplorerHeader } from '../../files/ExplorerHeader';
import {
  UploadIcon as SharedUploadIcon,
  FolderPlusIcon as SharedFolderPlusIcon,
  GridIcon as SharedGridIcon,
} from '../../files/explorerIcons';
import type {
  Item,
  Folder,
  Reminder,
  SortOption,
  FileItem,
  HierarchicalTag,
} from '../../../../types';
import type { RootState, AppDispatch } from '../../../../store';
import type { FolderDeletionInfo } from '../../../../hooks/useFolderOperations';
import { isFolder as checkIsFolder } from '../../../../types';
import {
  fileMatchesQuery,
  fileMatchesTag,
  tagCountsForFolder,
  type FileTagMap,
} from '../../../../services/tags/fileTags';

/** Références figées : un objet neuf à chaque rendu casserait les mémoïsations. */
const EMPTY_FILE_TAG_MAP: FileTagMap = Object.freeze({}) as FileTagMap;
const EMPTY_FILE_TAGS: readonly string[] = Object.freeze([]);
import {
  SHOW_PROGRESS_THRESHOLD,
  LOCAL_STREAM_THRESHOLD,
  NON_LOCAL_MAX_FILE_SIZE,
  formatBytes,
} from '../../../../constants/limits';
import {
  addFavorite,
  removeFavorite,
  addRecentFile,
  selectIsFavorite,
} from '../../../../store/slices/favoritesSlice';
import {
  selectAllTags,
  selectFileTagMappings,
  loadTags,
  getFileTags,
} from '../../../../store/slices/tagsSlice';
import { useRubberBandSelection } from '../../../../hooks/useRubberBandSelection';
import { classifyDragTypes } from '../../../../hooks/dragMime';
import FileDetailsPanel from './FileDetailsPanel';
import { QuickLookModal } from '../../preview/QuickLookModal';
import { GalleryModal, isImageItem } from '../../preview/GalleryModal';
import { NoteEmbedCard } from '../../notes/NoteEmbedCard';
import {
  selectAllNotes,
  createNewNote,
  deleteNotesByFolder,
} from '../../../../store/slices/notesSlice';
import {
  selectDesktopProtection,
  updateDesktopProtection,
} from '../../../../store/slices/settingsSlice';
import { secureDeleteOriginal } from '../../../../services/features/desktopProtectionBridge';
import { ImportModeDialog, type ImportChoice, type ImportMode } from '../../files/ImportModeDialog';
import { ProtectInPlaceDialog } from '../../protect';
// Le menu contextuel PARTAGÉ : ordre, libellés et icônes vivent là, pas ici.
import { buildItemContextMenu, buildBackgroundContextMenu } from '../../files/itemContextMenu';
// Faire entrer un fichier ou un dossier de l'espace personnel dans un coffre
// partagé — le geste manquant : jusqu'ici il fallait aller DANS le coffre puis
// ressortir chercher le fichier par un sélecteur de l'OS.
import {
  AddToVaultDialog,
  useVaultAddTargets,
  type AddToVaultSource,
} from '../../vaults/AddToVaultDialog';
// Les GREFFONS d'édition (documents natifs .fdoc et suivants) : le même circuit
// que le navigateur de coffre — registre → éditeur revendiquant l'extension →
// hôte d'édition. Ici l'hôte est celui des fichiers PERSONNELS.
import {
  editorAcceptsSize,
  editorForFileName,
  importerForFileName,
  newDocumentFormats,
  type NewDocumentFormat,
} from '../../../../services/plugins/pluginRegistry';
import {
  defaultTargetFor,
  openTargetsFor,
  preferenceFor,
  rememberPreference,
  type OpenTarget,
} from '../../../../services/files/openWith';
import OpenWithDialog from '../../files/OpenWithDialog';
import { getPreviewType } from '../../preview/FilePreviewPanel';
import { registerBuiltinPlugins } from '../../../../plugins/registerBuiltins';
import { ensureInstalledPluginsLoaded } from '../../../../services/plugins/installedPlugins';
import { addFileToFolder } from '../../../../store/slices/filesSlice';
import { generateUniqueId } from '../../../../utils/idGenerator';
import { FilePluginEditorModal } from './FilePluginEditorModal';
import { vaultFolderRoute } from '../../layout/RouteContent/routeCompat';
import {
  selectShortcutCardProps,
  vaultRefOf,
  type VaultShortcutRef,
} from '../../../../store/selectors/fileShortcutSelectors';

/**
 * Délai avant de sceller la mise en page d'un dossier. Un rangement en appelle
 * souvent trois d'affilée (on pousse, on hésite, on repousse) ; sceller à chaque
 * fois écrirait trois fois le conteneur chiffré et pousserait trois cycles de
 * synchronisation pour un seul geste.
 */
const LAYOUT_SAVE_DEBOUNCE_MS = 800;

/** Durée du toast « Dossier enregistré · Annuler », et de la trace qui l'arme. */
const LAYOUT_SAVED_TOAST_MS = 8000;

// Type pour les paramètres de route
interface RouteParams {
  folderId: string;
  [key: string]: string | undefined;
}

// Interface pour les items du dropdown
interface DropdownItem {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
}

// Props pour UploadModal
interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  uploadProgress: number;
}

// Props pour DeleteConfirmModal
interface DeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  itemCount: number;
}

// Icônes SVG. Les glyphes partagés avec la vue de coffre (`files/explorerIcons`)
// sont dessinés en 20 px ici, en 16 px là-bas : un seul tracé, deux tailles.
// DocumentPlusIcon et ListIcon restent locaux — leur dessin diffère de celui de
// la vue de coffre, et le rendu de chacune des deux vues ne bouge pas.
const UploadIcon: FC = () => <SharedUploadIcon size={20} />;

const FolderPlusIcon: FC = () => <SharedFolderPlusIcon size={20} />;

/** « Nouveau document » — une page avec un plus, sœur de FolderPlusIcon. */
const DocumentPlusIcon: FC = () => (
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
      d="M9 13.5h6m-3-3v6m-7.5-12h6.879a1.5 1.5 0 011.06.44l3.122 3.12a1.5 1.5 0 01.439 1.061V19.5a2.25 2.25 0 01-2.25 2.25H4.5A2.25 2.25 0 012.25 19.5v-15A2.25 2.25 0 014.5 2.25z"
    />
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

const GridIcon: FC = () => <SharedGridIcon size={20} />;

const ListIcon: FC = () => (
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
      d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z"
    />
  </svg>
);

const MoreIcon: FC = () => (
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
      d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z"
    />
  </svg>
);

// Composant UploadModal
const UploadModal: FC<UploadModalProps> = ({ isOpen, onClose, uploadProgress }) => {
  const { t } = useTranslation();
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md" closeOnBackdrop={false}>
      <ModalHeader onClose={onClose}>{t('file.upload', 'Upload de fichiers')}</ModalHeader>
      <ModalBody>
        <div className="flex flex-col gap-6 py-4">
          <p className="text-sm text-[var(--color-text-secondary)] text-center">
            {t('folder.uploadInProgress', 'Upload en cours... Veuillez patienter.')}
          </p>
          <ProgressBar
            value={uploadProgress}
            variant="default"
            size="md"
            showValue
            label="Progression"
          />
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose} disabled={uploadProgress < 100}>
          Annuler
        </Button>
      </ModalFooter>
    </Modal>
  );
};

// Composant DeleteConfirmModal
const DeleteConfirmModal: FC<DeleteConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  itemCount,
}) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm">
      <ModalHeader onClose={onClose}>Confirmer la suppression</ModalHeader>
      <ModalBody>
        <p>
          Etes-vous sur de vouloir supprimer{' '}
          {itemCount === 1 ? 'cet element' : `ces ${itemCount} elements`} ?
        </p>
        <p className="mt-4 text-sm text-[var(--color-warning-600)] font-medium">
          Cette action est irreversible.
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          Annuler
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          Supprimer
        </Button>
      </ModalFooter>
    </Modal>
  );
};

// ── Group-by helpers (for the "Group" toolbar control) ──────────────────────
type GroupBucket = { key: string; label: string; order: number };

const TYPE_GROUPS: Array<{ label: string; order: number; ext: string[] }> = [
  {
    label: 'Images',
    order: 1,
    ext: [
      'jpg',
      'jpeg',
      'png',
      'gif',
      'webp',
      'bmp',
      'svg',
      'ico',
      'heic',
      'heif',
      'tif',
      'tiff',
      'avif',
    ],
  },
  {
    label: 'Documents',
    order: 2,
    ext: [
      'pdf',
      'doc',
      'docx',
      'odt',
      'rtf',
      'txt',
      'md',
      'markdown',
      'csv',
      'tsv',
      'xls',
      'xlsx',
      'ods',
      'ppt',
      'pptx',
      'odp',
      'epub',
    ],
  },
  { label: 'Vidéos', order: 3, ext: ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'm4v', 'flv'] },
  { label: 'Audio', order: 4, ext: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'wma', 'opus'] },
  { label: 'Archives', order: 5, ext: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'] },
  {
    label: 'Code',
    order: 6,
    ext: [
      'js',
      'ts',
      'jsx',
      'tsx',
      'json',
      'html',
      'htm',
      'css',
      'scss',
      'py',
      'java',
      'c',
      'cpp',
      'go',
      'rs',
      'rb',
      'php',
      'sh',
      'sql',
      'xml',
      'yaml',
      'yml',
    ],
  },
];

function fileTypeGroup(name: string): GroupBucket {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const match = TYPE_GROUPS.find((g) => g.ext.includes(ext));
  if (match) return { key: match.label, label: match.label, order: match.order };
  return { key: '__other__', label: 'Autres', order: 99 };
}

function dateGroup(updatedAt?: string): GroupBucket {
  if (!updatedAt) return { key: '__nodate__', label: 'Sans date', order: 6 };
  const d = new Date(updatedAt);
  if (isNaN(d.getTime())) return { key: '__nodate__', label: 'Sans date', order: 6 };
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 86_400_000;
  const t = d.getTime();
  if (t >= startOfToday) return { key: 'today', label: "Aujourd'hui", order: 1 };
  if (t >= startOfToday - dayMs) return { key: 'yesterday', label: 'Hier', order: 2 };
  if (t >= startOfToday - 7 * dayMs) return { key: 'week', label: 'Cette semaine', order: 3 };
  if (t >= startOfToday - 30 * dayMs) return { key: 'month', label: 'Ce mois-ci', order: 4 };
  return { key: 'older', label: 'Plus ancien', order: 5 };
}

// Composant principal FolderView
export const FolderView: FC<{ folderId?: string }> = React.memo(function FolderView({
  folderId: folderIdProp,
}) {
  const { t } = useTranslation();
  const params = useParams<RouteParams>();
  const folderId = folderIdProp ?? params.folderId;
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();

  // Hooks Redux
  const {
    folders,
    loadFolder,
    addFolder,
    editFolder,
    removeFolder,
    uploadFile,
    removeFile,
    renameFile,
    downloadFile,
  } = useFolder(folderId || null);
  const { updateMetadata } = useFile();
  const { notify, success, error, warning, info, dismiss } = useNotification();
  const { contextMenu, openContextMenu, closeContextMenu } = useContextMenu();

  // ===== « Ajouter au coffre partagé… » =====
  // La capacité n'est posée que s'il existe au moins un coffre DÉVERROUILLÉ où
  // ce compte peut écrire ; sinon l'entrée est absente du menu (pas de mur de
  // vente dans un clic droit).
  const vaultAddTargets = useVaultAddTargets();
  const canAddToVault = vaultAddTargets.length > 0;
  const [addToVaultSource, setAddToVaultSource] = useState<AddToVaultSource | null>(null);

  // Avis persistant pendant un déplacement : posé au départ, retiré à l'arrivée —
  // succès COMME échec, sinon il resterait à l'écran pour de bon. Son identifiant
  // tient dans une ref : un state ne servirait qu'à re-rendre la liste pour rien.
  const movingToastRef = useRef<string | null>(null);
  const movingToastAtRef = useRef<number>(0);
  const movingToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Retire l'avis de déplacement — mais pas avant `MOVING_TOAST_MIN_MS` : un
   * déplacement local se termine en quelques dizaines de millisecondes, et
   * l'avis clignotait alors trop vite pour que l'œil l'attrape. `immediate`
   * sert au démontage et quand un déplacement en chasse un autre.
   */
  const dismissMovingToast = useCallback(
    (immediate = false) => {
      if (movingToastTimerRef.current) {
        clearTimeout(movingToastTimerRef.current);
        movingToastTimerRef.current = null;
      }
      const id = movingToastRef.current;
      if (!id) return;
      movingToastRef.current = null;
      const shownFor = Date.now() - movingToastAtRef.current;
      if (immediate || shownFor >= MOVING_TOAST_MIN_MS) {
        dismiss(id);
        return;
      }
      movingToastTimerRef.current = setTimeout(() => {
        movingToastTimerRef.current = null;
        dismiss(id);
      }, MOVING_TOAST_MIN_MS - shownFor);
    },
    [dismiss]
  );

  // Quitter la vue en plein déplacement ne doit pas laisser l'avis orphelin —
  // ni un minuteur en vol.
  useEffect(() => () => dismissMovingToast(true), [dismissMovingToast]);

  // Callbacks stables pour le hook drag and drop
  const handleDnDSuccess = useCallback(
    (message: string) => {
      dismissMovingToast();
      success(message);
      if (folderId) loadFolder(folderId);
    },
    [folderId, success, loadFolder, dismissMovingToast]
  );

  const handleDnDError = useCallback(
    (message: string) => {
      dismissMovingToast();
      error(message);
    },
    [error, dismissMovingToast]
  );

  const handleMoveStart = useCallback(
    (itemName: string) => {
      // Un déplacement chasse l'autre : on ne laisse jamais deux avis empilés.
      dismissMovingToast(true);
      movingToastAtRef.current = Date.now();
      movingToastRef.current = notify({
        type: 'info',
        message: t('dragDrop.moving', { name: itemName }),
        duration: 0,
      });
    },
    [dismissMovingToast, notify, t]
  );

  // Ouverture automatique du dossier survolé pendant un drag (spring-load) :
  // on descend dans l'arborescence sans lâcher l'élément.
  const handleSpringOpen = useCallback(
    (targetFolderId: string) => {
      navigate(`/folder/${targetFolderId}`);
    },
    [navigate]
  );

  // Hook drag and drop
  const {
    draggedItem,
    dropTarget,
    springTarget,
    pendingMove,
    handleDragStart,
    prewarmNativeDrag,
    handleDragEnd,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop: handleDropItem,
  } = useDragAndDrop(folderId, handleDnDSuccess, handleDnDError, handleSpringOpen, handleMoveStart);

  // Callback stable pour onDrop des FileCards (evite inline lambda dans le .map)
  const handleDropForCurrentFolder = useCallback(
    (e: DragEvent, targetFolderId: string) => {
      if (folderId) handleDropItem(e, targetFolderId, folderId);
    },
    [folderId, handleDropItem]
  );

  // Fil d'Ariane et bouton retour comme cibles de dépôt : remonter un élément
  // d'un ou plusieurs niveaux sans avoir à naviguer d'abord.
  const handleDropOnSegment = useCallback(
    (targetFolderId: string, e: DragEvent) => {
      if (folderId) handleDropItem(e, targetFolderId, folderId);
    },
    [folderId, handleDropItem]
  );

  const handleDropOnRoot = useCallback(
    (e: DragEvent) => {
      if (folderId) handleDropItem(e, ROOT_FOLDER_ID, folderId);
    },
    [folderId, handleDropItem]
  );

  // Créer les sélecteurs UNE SEULE FOIS par folderId (permet au cache interne de createSelector de fonctionner)
  const selectItems = useMemo(
    () => (folderId ? selectFolderItems(folderId) : () => [] as Item[]),
    [folderId]
  );
  const items = useSelector(selectItems) as Item[];

  // Breadcrumb: chemin complet du dossier actuel
  const selectPath = useMemo(
    () => (folderId ? selectFolderPathById(folderId) : () => [] as Folder[]),
    [folderId]
  );
  const folderPath = useSelector(selectPath);
  const accountMode = useSelector((state: RootState) => state.auth.accountMode);

  // Notes belonging to this folder
  const allNotes = useSelector(selectAllNotes);
  const folderNotes = useMemo(
    () => allNotes.filter((n) => n.parentId === folderId),
    [allNotes, folderId]
  );

  // Tags : résoudre les mappings fichier -> tags
  const allTags = useSelector(selectAllTags);
  const fileTagMappings = useSelector(selectFileTagMappings);

  const resolvedTagsMap = useMemo(() => {
    const tagById = new Map(allTags.map((t) => [t.id, t]));
    const result: Record<string, HierarchicalTag[]> = {};
    for (const [fileId, tagIds] of Object.entries(fileTagMappings)) {
      result[fileId] = tagIds
        .map((id) => tagById.get(id))
        .filter((t): t is HierarchicalTag => t !== undefined);
    }
    return result;
  }, [allTags, fileTagMappings]);

  // Set d'IDs des items qui ont au moins un rappel
  const itemsWithReminders = useMemo(() => {
    const set = new Set<string>();
    items.forEach((item) => {
      if ((item as any).reminders?.length > 0) {
        set.add(item.id);
      }
    });
    return set;
  }, [items]);

  // Charger le dossier au montage
  useEffect(() => {
    if (folderId) {
      loadFolder(folderId);
      setDetailsPanelItem(null);
    }
  }, [folderId, loadFolder]);

  // Récupérer le dossier actuel
  const folder: Folder = useMemo(() => {
    return (
      folders.find((f) => f.id === folderId) || {
        id: folderId || '',
        name: 'Dossier',
        items: [],
        color: '#87CEEB',
      }
    );
  }, [folders, folderId]);

  /**
   * LES ÉTIQUETTES DES FICHIERS DE CE DOSSIER, telles qu'elles sont persistées.
   *
   * Elles vivent sur le DOSSIER (`Folder.fileTags`, voir `services/tags`), pas
   * dans une tranche de session : c'est ce qui les fait survivre au
   * rechargement et voyager vers le téléphone. `EMPTY_FILE_TAGS` évite qu'un
   * dossier sans étiquette rende un objet neuf à chaque passage.
   */
  const folderFileTags: FileTagMap = folder.fileTags ?? EMPTY_FILE_TAG_MAP;

  // Bouton retour comme cible de dépôt vers le dossier parent (ou la racine),
  // avec la même attente que le fil d'Ariane pour déclencher la navigation.
  const parentTargetId = folder.parentId || ROOT_FOLDER_ID;
  const [backDropActive, setBackDropActive] = useState<boolean>(false);
  const backDwellRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelBackDwell = useCallback(() => {
    if (backDwellRef.current) {
      clearTimeout(backDwellRef.current);
      backDwellRef.current = null;
    }
    setBackDropActive(false);
  }, []);

  useEffect(() => cancelBackDwell, [cancelBackDwell]);

  // Seuls les dossiers peuvent remonter à la racine : le type traîné est lisible
  // dès `dragover` via le marqueur MIME dédié (le payload, lui, ne l'est pas).
  const backAcceptsDrag = useCallback(
    (e: DragEvent<HTMLButtonElement>): boolean => {
      if (!e.dataTransfer.types.includes(FILARR_FILE_MIME)) return false;
      return parentTargetId !== ROOT_FOLDER_ID || e.dataTransfer.types.includes(FILARR_FOLDER_MIME);
    },
    [parentTargetId]
  );

  const handleBackDragOver = useCallback(
    (e: DragEvent<HTMLButtonElement>) => {
      if (!backAcceptsDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';

      if (backDwellRef.current) return;
      setBackDropActive(true);
      backDwellRef.current = setTimeout(() => {
        backDwellRef.current = null;
        setBackDropActive(false);
        navigate(parentTargetId === ROOT_FOLDER_ID ? '/' : `/folder/${parentTargetId}`);
      }, SPRING_LOAD_DELAY_MS);
    },
    [backAcceptsDrag, navigate, parentTargetId]
  );

  const handleBackDragLeave = useCallback(
    (e: DragEvent<HTMLButtonElement>) => {
      // L'icône interne émet ses propres `dragleave` : ne rien annuler tant que
      // le curseur n'a pas réellement quitté le bouton.
      if (e.currentTarget !== e.target) return;
      cancelBackDwell();
    },
    [cancelBackDwell]
  );

  const handleBackDrop = useCallback(
    (e: DragEvent<HTMLButtonElement>) => {
      cancelBackDwell();
      if (!backAcceptsDrag(e) || !folderId) return;
      handleDropItem(e, parentTargetId, folderId);
    },
    [cancelBackDwell, backAcceptsDrag, folderId, handleDropItem, parentTargetId]
  );

  // Ajouter le dossier aux recents quand on navigue dessus
  useEffect(() => {
    if (folderId && folder && folder.name !== 'Dossier') {
      dispatch(addRecentFile({ item: folder as any, path: `/folder/${folderId}` }));
    }
  }, [folderId, folder?.id]);

  // États locaux
  const [searchQuery, setSearchQuery] = useState<string>('');
  /**
   * L'ÉTIQUETTE FILTRÉE — une seule, ou aucune.
   *
   * UNE SEULE, et pas un ensemble : deux étiquettes cochées posent aussitôt la
   * question « et/ou ? », à laquelle aucune barre de pastilles ne sait répondre
   * sans un réglage de plus. Le mobile fait le même choix, et cocher-décocher
   * reste un geste unique.
   *
   * Elle est REMISE À ZÉRO en changeant de dossier : une pastille active dans
   * un dossier où l'étiquette n'existe pas afficherait une liste vide sans
   * qu'aucune pastille allumée ne l'explique.
   */
  const [activeTag, setActiveTag] = useState<string | null>(null);
  useEffect(() => {
    setActiveTag(null);
  }, [folderId]);
  const viewMode = useSelector((state: RootState) => state.ui.viewMode);
  const sortBy = useSelector((state: RootState) => state.ui.sortBy.field);
  const sortOrder = useSelector((state: RootState) => state.ui.sortBy.order);

  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const selectedItemsSet = useMemo(() => new Set(selectedItems), [selectedItems]);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<boolean>(false);
  const [dragActive, setDragActive] = useState<boolean>(false);

  // Rubber-band (lasso) selection
  const contentContainerRef = useRef<HTMLDivElement>(null);
  const { rectRef: rubberBandRectRef, handlers: rubberBandHandlers } = useRubberBandSelection({
    containerRef: contentContainerRef,
    currentSelection: selectedItems,
    onSelectionChange: setSelectedItems,
  });

  // États pour le nouveau modal de confirmation de suppression de dossier
  const [folderDeleteModalOpen, setFolderDeleteModalOpen] = useState<boolean>(false);
  const [folderDeletionInfo, setFolderDeletionInfo] = useState<FolderDeletionInfo | null>(null);
  const [itemToDelete, setItemToDelete] = useState<Item | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // États pour les modals prompt
  const [createFolderModalOpen, setCreateFolderModalOpen] = useState<boolean>(false);
  const [renameModalOpen, setRenameModalOpen] = useState<boolean>(false);
  const [itemToRename, setItemToRename] = useState<Item | null>(null);

  // États pour le reminder modal
  const [reminderModalOpen, setReminderModalOpen] = useState<boolean>(false);
  const [itemForReminder, setItemForReminder] = useState<Item | null>(null);

  // États pour l'historique des versions
  const [versionHistoryOpen, setVersionHistoryOpen] = useState<boolean>(false);
  const [versionHistoryFileId, setVersionHistoryFileId] = useState<string | null>(null);
  const [versionHistoryFileName, setVersionHistoryFileName] = useState<string | null>(null);
  const [versionHistoryFileSize, setVersionHistoryFileSize] = useState<number>(0);
  const [passwordModalOpen, setPasswordModalOpen] = useState<boolean>(false);
  const [passwordModalItem, setPasswordModalItem] = useState<Item | null>(null);
  const [unlockModalOpen, setUnlockModalOpen] = useState<boolean>(false);
  const [unlockModalItem, setUnlockModalItem] = useState<Item | null>(null);
  // Counter to force re-render when password protection changes (localStorage isn't reactive)
  const [passwordVersion, setPasswordVersion] = useState(0);

  // Pré-calcul des statuts de protection (1 lecture cache par item au lieu de 7 appels localStorage dans le JSX)
  const protectionStatusMap = useMemo(() => {
    const map = new Map<string, { isProtected: boolean; isUnlocked: boolean }>();
    for (const item of items) {
      const prot = isProtected(item.id);
      map.set(item.id, {
        isProtected: prot,
        isUnlocked: prot ? isUnlockedForSession(item.id) : false,
      });
    }
    return map;
  }, [items, passwordVersion]);

  // États pour Move/Copy dialog
  const [moveCopyModalOpen, setMoveCopyModalOpen] = useState<boolean>(false);
  const [moveCopyMode, setMoveCopyMode] = useState<'move' | 'copy'>('move');
  const [itemToMoveCopy, setItemToMoveCopy] = useState<Item | null>(null);
  // When true the move/copy dialog operates on the whole current selection
  // instead of a single item.
  const [isBatchMoveCopy, setIsBatchMoveCopy] = useState<boolean>(false);
  // Opération de déplacement/copie en cours : la boîte reste ouverte et occupée
  // au lieu de se refermer sur une attente muette.
  const [moveCopyBusy, setMoveCopyBusy] = useState<boolean>(false);
  // Avancement du lot (élément en cours / total), `null` hors traitement par lot.
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  // Folder whose color/emoji is being edited (null = modal closed).
  const [folderStyleTarget, setFolderStyleTarget] = useState<Folder | null>(null);

  // État pour le panneau de détails
  const [detailsPanelItem, setDetailsPanelItem] = useState<Item | null>(null);

  // Quick Look (Espace)
  const [quickLookFile, setQuickLookFile] = useState<FileItem | null>(null);

  // Le dialogue de partage unifié — ouvert par « Partager… » du clic droit
  // (mode nuage seulement : hors nuage `open` est un no-op et l'entrée est
  // absente). Le lien E2EE (ShareFileModal) est son second niveau, plus une
  // porte à part : une seule entrée, un seul état.
  const {
    open: openShareDialog,
    overlays: shareDialogOverlays,
    isOpen: shareDialogOpen,
  } = useShareDialog();

  // Galerie d'images
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryInitialIndex, setGalleryInitialIndex] = useState(0);

  /**
   * ÉDITION PAR GREFFON — le chaînon qui manquait à l'explorateur personnel.
   *
   * Le greffon « Filarr Docs » (documents .fdoc, import/export .docx) n'était
   * branché que dans les coffres partagés : un utilisateur sans équipe ne
   * pouvait ni créer ni rouvrir un document natif. Le circuit est le même —
   * registre → éditeur revendiquant l'extension → hôte — seul l'hôte change,
   * parce que les octets viennent d'ici et non d'un coffre.
   */
  const [pluginEditing, setPluginEditing] = useState<FileItem | null>(null);
  /** Le fichier dont on choisit l'ouverture — null quand aucun choix n'est demandé. */
  const [openWithItem, setOpenWithItem] = useState<FileItem | null>(null);
  /** `import` quand l'éditeur ouvert ne sait que LIRE le format monté. */
  const [pluginEditingMode, setPluginEditingMode] = useState<'native' | 'import'>('native');
  /** Le format choisi dans « Nouveau document », en attente de son nom. */
  const [newDocSpec, setNewDocSpec] = useState<NewDocumentFormat | null>(null);
  // Idempotent — le premier écran venu enregistre la liste blanche.
  registerBuiltinPlugins();
  // Les greffons MARKETPLACE installés (vérifiés puis bac à sable) — chargés
  // une fois par compte, sans bloquer le rendu : les éditeurs apparaissent dès
  // qu'IndexedDB a répondu.
  const pluginUserId = useSelector((s: RootState) => s.auth.cloudUser?.id ?? null);
  useEffect(() => {
    if (pluginUserId) void ensureInstalledPluginsLoaded(pluginUserId);
  }, [pluginUserId]);

  // Filtrage et tri des items
  const filteredAndSortedItems = useMemo(() => {
    let result = [...items];

    /**
     * FILTRAGE PAR ÉTIQUETTE — la barre de pastilles.
     *
     * Il s'applique AVANT la recherche : les deux se composent (« les PDF de
     * `pitch` dont le nom contient "2026" »), et l'ordre n'a pas d'importance
     * pour le résultat, mais filtrer d'abord sur l'étiquette réduit la liste
     * que la recherche doit parcourir.
     *
     * LES DOSSIERS TRAVERSENT TOUJOURS : ils ne portent pas d'étiquette, et les
     * faire disparaître d'un clic sur une pastille couperait la navigation —
     * on ne pourrait plus descendre chercher les fichiers étiquetés d'à côté.
     */
    if (activeTag) {
      result = result.filter(
        (item) => checkIsFolder(item) || fileMatchesTag(folderFileTags, item.id, activeTag)
      );
    }

    /**
     * Filtrage par recherche — ÉTIQUETTES COMPRISES.
     *
     * Chercher « pitch » doit trouver `investisseurs.pdf` étiqueté `pitch` :
     * c'est ce que la recherche globale fait déjà (`SearchIndex.tags`), et ce
     * que la barre de ce dossier ne faisait pas. `#pitch` en tête ne cherche
     * QUE dans les étiquettes.
     *
     * Un DOSSIER n'a pas d'étiquette : il ne se cherche que par son nom, et un
     * `#` en tête l'exclut donc toujours — ce qui est le comportement voulu.
     */
    if (searchQuery) {
      result = result.filter((item) =>
        checkIsFolder(item)
          ? !searchQuery.trim().startsWith('#') &&
            item.name.toLowerCase().includes(searchQuery.toLowerCase())
          : fileMatchesQuery(item, folderFileTags[item.id] ?? EMPTY_FILE_TAGS, searchQuery)
      );
    }

    // Tri
    const direction = sortOrder === 'asc' ? 1 : -1;
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'date':
          cmp = new Date(a.updatedAt || 0).getTime() - new Date(b.updatedAt || 0).getTime();
          break;
        case 'size':
          cmp = (('size' in a ? a.size : 0) || 0) - (('size' in b ? b.size : 0) || 0);
          break;
        case 'type': {
          const extA = a.name.includes('.') ? a.name.split('.').pop()!.toLowerCase() : '';
          const extB = b.name.includes('.') ? b.name.split('.').pop()!.toLowerCase() : '';
          cmp = extA.localeCompare(extB);
          break;
        }
        default:
          cmp = 0;
      }
      return cmp * direction;
    });

    return result;
  }, [items, searchQuery, sortBy, sortOrder, activeTag, folderFileTags]);

  /**
   * LES PASTILLES DU DOSSIER — comptées sur les fichiers RÉELLEMENT PRÉSENTS.
   *
   * Sur `items` et non sur la liste filtrée, et c'est tout l'enjeu : compter
   * après le filtre ferait tomber toutes les autres pastilles à zéro dès qu'on
   * en coche une, et il n'y aurait plus aucun moyen d'en changer.
   *
   * Les entrées orphelines (fichier détruit dont l'étiquette traîne encore dans
   * `metadata.json`) ne comptent pas : `tagCountsForFolder` croise avec la liste
   * des fichiers vivants, sans quoi une pastille « 3 » mènerait à deux
   * fichiers.
   */
  const tagChips = useMemo(
    () =>
      tagCountsForFolder({
        fileTags: folderFileTags,
        files: items.filter((item) => !checkIsFolder(item)),
      }),
    [folderFileTags, items]
  );

  // Séparer les dossiers et les fichiers
  const { subfolders, files } = useMemo(() => {
    const folders: Folder[] = [];
    const fileItems: Item[] = [];

    filteredAndSortedItems.forEach((item) => {
      if (checkIsFolder(item)) {
        folders.push(item as Folder);
      } else {
        fileItems.push(item);
      }
    });

    return { subfolders: folders, files: fileItems };
  }, [filteredAndSortedItems]);

  /**
   * LES RACCOURCIS VERS UN COFFRE — l'état de chaque carte, lu UNE fois pour
   * la liste affichée. La Map est mémoïsée (`fileShortcutSelectors`) : même
   * référence tant que ni les fichiers ni l'état des coffres n'ont bougé, et
   * chaque valeur garde son identité — ce que `FileCard` (`React.memo`) attend
   * de sa prop. `FileCard` ne lit pas Redux : c'est l'hôte qui lui dit où en
   * est le coffre. Le repli du libellé est traduit ICI, un sélecteur n'a pas
   * de `t`.
   */
  const shortcutFallbackLabel = t('teamVaults.shortcut.unnamedVault', 'Coffre partagé');
  const shortcutProps = useSelector((s: RootState) =>
    selectShortcutCardProps(s, files, shortcutFallbackLabel)
  );

  // Account storage quota (cloud accounts only) — surfaced in the footer so a
  // user filling their plan while uploading here gets an early signal.
  const { storageUsed, storageLimit, isCloud } = useSyncStatus();

  // Partition files into ordered groups for the "Group by" toolbar control.
  // A single unlabeled group means grouping is off (headers are hidden).
  const groupBy = useSelector((state: RootState) => state.ui.groupBy);
  const fileGroups = useMemo(() => {
    if (!groupBy.enabled || groupBy.field === 'none') {
      return [{ key: '__all__', label: '', order: 0, items: files }];
    }
    const map = new Map<string, { label: string; order: number; items: Item[] }>();
    const push = (b: GroupBucket, item: Item) => {
      let g = map.get(b.key);
      if (!g) {
        g = { label: b.label, order: b.order, items: [] };
        map.set(b.key, g);
      }
      g.items.push(item);
    };
    files.forEach((item) => {
      if (groupBy.field === 'type') {
        push(fileTypeGroup(item.name), item);
      } else if (groupBy.field === 'date') {
        push(dateGroup(item.updatedAt), item);
      } else {
        const ch = (item.name.trim()[0] || '#').toUpperCase();
        const isAlpha = ch >= 'A' && ch <= 'Z';
        push(
          {
            key: isAlpha ? ch : '#',
            label: isAlpha ? ch : '#',
            order: isAlpha ? ch.charCodeAt(0) : 999,
          },
          item
        );
      }
    });
    return Array.from(map.entries())
      .map(([key, g]) => ({ key, label: g.label, order: g.order, items: g.items }))
      .sort((a, b) => a.order - b.order);
  }, [files, groupBy]);

  // Images pour la galerie
  const imageFiles = useMemo(
    () => files.filter((f: Item) => isImageItem(f as FileItem)) as FileItem[],
    [files]
  );

  const openGallery = useCallback(
    (file: FileItem) => {
      const idx = imageFiles.findIndex((f) => f.id === file.id);
      if (idx !== -1) {
        setGalleryInitialIndex(idx);
        setGalleryOpen(true);
      }
    },
    [imageFiles]
  );

  // Gestion de la sélection (avec Shift+Click pour range selection)
  const lastSelectedRef = useRef<string | null>(null);
  const handleSelectItem = useCallback(
    (itemId: string, event?: React.MouseEvent) => {
      if (event?.shiftKey && lastSelectedRef.current) {
        const allIds = filteredAndSortedItems.map((i) => i.id);
        const startIdx = allIds.indexOf(lastSelectedRef.current);
        const endIdx = allIds.indexOf(itemId);
        if (startIdx !== -1 && endIdx !== -1) {
          const range = allIds.slice(Math.min(startIdx, endIdx), Math.max(startIdx, endIdx) + 1);
          setSelectedItems((prev) => [...new Set([...prev, ...range])]);
        }
      } else {
        setSelectedItems((prev) => {
          const set = new Set(prev);
          if (set.has(itemId)) {
            set.delete(itemId);
          } else {
            set.add(itemId);
          }
          return [...set];
        });
      }
      lastSelectedRef.current = itemId;
    },
    [filteredAndSortedItems]
  );

  const handleSelectAll = useCallback(() => {
    setSelectedItems((prev) =>
      prev.length === filteredAndSortedItems.length ? [] : filteredAndSortedItems.map((i) => i.id)
    );
  }, [filteredAndSortedItems]);

  // Click a list-view column header to sort by it; click again to flip direction.
  const handleHeaderSort = useCallback(
    (field: 'name' | 'size' | 'date' | 'type') => {
      dispatch(
        setSortBy({
          field,
          order: sortBy === field && sortOrder === 'asc' ? 'desc' : 'asc',
        })
      );
    },
    [dispatch, sortBy, sortOrder]
  );

  // Callbacks stables pour BatchActionToolbar
  const handleBatchSelectAll = useCallback(() => {
    setSelectedItems(filteredAndSortedItems.map((i) => i.id));
  }, [filteredAndSortedItems]);

  const handleBatchDeselectAll = useCallback(() => {
    setSelectedItems([]);
  }, []);

  // Roving keyboard focus over the file/folder grid (see the nav effect below).
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  useEffect(() => {
    setFocusedIndex((idx) => (idx >= filteredAndSortedItems.length ? -1 : idx));
  }, [filteredAndSortedItems.length]);

  // Quick Look — touche Espace pour prévisualiser le fichier sélectionné
  useEffect(() => {
    const handleSpaceKey = (e: KeyboardEvent) => {
      if (e.key !== ' ') return;
      // Ignorer si focus dans un champ de saisie
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Ignorer si Quick Look déjà ouvert (FilePreviewPanel gère la fermeture)
      if (quickLookFile) return;
      // Un éditeur de greffon est ouvert : la barre d'espace lui appartient —
      // le test de balise ci-dessus ne voit pas un contenteditable, et taper
      // une espace dans un document ouvrait Quick Look par-dessus l'éditeur.
      if (pluginEditing) return;

      // Trouver le premier fichier sélectionné (pas un dossier)
      const firstFileId = selectedItems.find((id) => {
        const item = items.find((i) => i.id === id);
        return item && !checkIsFolder(item);
      });
      if (!firstFileId) return;

      e.preventDefault();
      const file = items.find((i) => i.id === firstFileId) as FileItem;
      setQuickLookFile(file);
    };

    window.addEventListener('keydown', handleSpaceKey);
    return () => window.removeEventListener('keydown', handleSpaceKey);
  }, [selectedItems, items, quickLookFile, pluginEditing]);

  // Ouvrir un fichier (apres verification du mot de passe si necessaire)
  const doOpenFile = useCallback(
    async (item: Item) => {
      try {
        await openFile(folderId || '', item.name, true);
        success(`Fichier "${item.name}" ouvert avec succès`);

        // Ajouter aux fichiers recents
        dispatch(addRecentFile({ item: item as any, path: `/folder/${folderId}` }));

        // Create a version snapshot when file is opened
        if (folderId && item.id) {
          const fileItem = item as FileItem;
          dispatch(
            createVersion({
              folderId,
              fileId: item.id,
              fileName: item.name,
              comment: 'Ouverture du fichier',
              size: fileItem.size || 0,
            })
          );
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        error(`Impossible d'ouvrir le fichier: ${errMsg}`);
      }
    },
    [folderId, success, error, dispatch]
  );

  // Click behavior preference: 'details' opens the side panel on single click
  // (the file itself opens on double-click), 'open' opens the file on single
  // click (legacy behavior). Folders always navigate on single click.
  const fileClickBehavior = useSelector((s: RootState) => s.ui.fileClickBehavior);

  /**
   * L'ÉDITEUR À MONTER — natif ou importeur selon le mode choisi.
   *
   * `editorForFileName` ne connaît que les formats REVENDIQUÉS : un `.docx`
   * ouvert par importeur y résoudrait à `null`, et l'hôte ne se rendrait
   * jamais. Le mode dit lequel des deux registres interroger.
   */
  const providerPourEdition = useCallback(
    (name: string) =>
      pluginEditingMode === 'import' ? importerForFileName(name) : editorForFileName(name),
    [pluginEditingMode]
  );

  /**
   * CRÉER LE FICHIER CONVERTI — calqué sur « Nouveau document ».
   *
   * Le fichier d'origine n'est pas touché : on en ajoute un autre, au format
   * natif de l'éditeur, avec les octets qu'il vient de produire. Le nom est
   * dédupliqué comme partout ailleurs, et l'identifiant RELU dans le dossier
   * renvoyé — un adaptateur qui attribuerait l'id côté serveur laisserait
   * sinon l'éditeur écrire ses métadonnées sur un identifiant inexistant.
   */
  const handleConvertImport = useCallback(
    async (proposedName: string, bytes: Uint8Array): Promise<{ id: string; name: string }> => {
      if (!folderId) throw new Error('no_folder');
      const point = proposedName.lastIndexOf('.');
      const base = point > 0 ? proposedName.slice(0, point) : proposedName;
      const suffixe = point > 0 ? proposedName.slice(point) : '';
      const pris = new Set(
        items.map((it) => String((it as { name?: string }).name ?? '').toLowerCase())
      );
      let nom = proposedName;
      for (let n = 2; pris.has(nom.toLowerCase()); n += 1) nom = `${base} (${n})${suffixe}`;

      const id = generateUniqueId();
      const updated = await dispatch(
        addFileToFolder({
          folderId,
          file: {
            id,
            name: nom,
            type: 'application/octet-stream',
            size: bytes.byteLength,
            content: bytes,
          } as any,
        })
      ).unwrap();
      const créé = (Array.isArray((updated as any)?.items) ? (updated as any).items : []).find(
        (it: unknown) => !!it && typeof it === 'object' && (it as { name?: string }).name === nom
      ) as { id?: string } | undefined;
      await loadFolder(folderId);
      return { id: créé?.id || id, name: nom };
    },
    [folderId, items, dispatch, loadFolder]
  );

  /**
   * EXÉCUTER UN CHOIX D'OUVERTURE.
   *
   * Trois destinations, et c'est tout : l'éditeur, l'aperçu, l'application du
   * système. Aucune n'est nouvelle — ce sont exactement les chemins que le
   * double-clic empruntait déjà. Ce qui change, c'est que l'utilisateur peut
   * désigner LEQUEL au lieu de subir l'ordre de priorité.
   *
   * Les cibles d'IMPORT n'arrivent jamais ici : `openTargetsFor` ne les produit
   * pas tant que l'hôte ne sait pas convertir (voir openWith.ts).
   */
  const ouvrirCible = useCallback(
    async (item: FileItem, cible: OpenTarget) => {
      if (cible.kind === 'editor' && folderId) {
        setPluginEditingMode(cible.mode);
        setPluginEditing(item);
        return;
      }
      if (cible.kind === 'preview') {
        setDetailsPanelItem(item);
        return;
      }
      await doOpenFile(item);
    },
    [folderId, doOpenFile]
  );

  /**
   * OUVRIR UN RACCOURCI : il n'y a pas d'octets à lire ici, on va les voir là
   * où ils sont — le coffre, directement sur l'élément (`?item=`). Un coffre
   * parti ou un élément absent ne mène nulle part : on le DIT (avertissement)
   * au lieu de naviguer dans le vide. Verrouillé ou pas encore chargé, on y va
   * quand même : c'est l'écran du coffre qui sait demander le déverrouillage.
   * Jamais de suppression de la fiche ici — un état n'est pas un verdict.
   */
  const openShortcut = useCallback(
    (item: Item, ref: VaultShortcutRef) => {
      const state = shortcutProps.get(item.id)?.state;
      if (state === 'gone') {
        warning(
          t(
            'teamVaults.shortcut.goneToast',
            'Ce coffre n’est plus accessible : le raccourci ne peut pas s’ouvrir.'
          )
        );
        return;
      }
      if (state === 'missing') {
        warning(
          t(
            'teamVaults.shortcut.missingToast',
            'Cet élément n’est plus dans le coffre : le raccourci ne peut pas s’ouvrir.'
          )
        );
        return;
      }
      dispatch(addRecentFile({ item: item as any, path: `/folder/${folderId}` }));
      navigate(vaultFolderRoute(ref.vaultId, { itemId: ref.itemId }));
    },
    [shortcutProps, warning, t, dispatch, folderId, navigate]
  );

  // Open behavior shared between single and double click — extracted so both
  // entry points share the password unlock + image gallery routing.
  const openItemContent = useCallback(
    async (item: Item) => {
      // Un RACCOURCI n'a pas d'octets ici : ni mot de passe, ni éditeur, ni
      // aperçu — il s'ouvre dans le coffre, avant toute autre garde.
      const shortcutRef = vaultRefOf(item);
      if (shortcutRef) {
        openShortcut(item, shortcutRef);
        return;
      }
      if (isProtected(item.id) && !isUnlockedForSession(item.id)) {
        setUnlockModalItem(item);
        setUnlockModalOpen(true);
        return;
      }
      /**
       * UN ÉDITEUR ENREGISTRÉ PASSE AVANT L'APERÇU. Résolution GÉNÉRIQUE par
       * extension : le jour où un greffon revendique `.kanban`, ouvrir un
       * `.kanban` ouvrira son éditeur sans qu'une ligne change ici. Sinon un
       * document natif partait vers l'aperçu générique (ou l'application
       * système, qui ne connaît pas le format) et n'était jamais éditable.
       */
      /**
       * UNE PRÉFÉRENCE EXPLICITE PASSE AVANT TOUT — et seulement elle.
       *
       * `preferenceFor` ne rend quelque chose que si l'utilisateur a coché
       * « toujours ouvrir ainsi » dans le dialogue. Sans préférence, on ne
       * touche à rien : la suite de cette fonction est le comportement
       * d'origine, à l'octet près. C'est la règle de tout le module — une
       * fonctionnalité de confort ne doit rien changer pour qui ne l'a pas
       * demandée.
       */
      if (preferenceFor(item.name)) {
        const voulue = defaultTargetFor({
          fileName: item.name,
          size: (item as FileItem).size,
          hasPreview: getPreviewType(item.name) !== 'unsupported',
          canOpenSystem: true,
          allowImport: true,
        });
        if (voulue) {
          dispatch(addRecentFile({ item: item as any, path: `/folder/${folderId}` }));
          await ouvrirCible(item as FileItem, voulue);
          return;
        }
      }

      // Un fichier TROP GROS ne va pas dans l'éditeur : il garderait tout le
      // clair en état React et gèlerait le rendu. On le laisse retomber sur
      // l'aperçu (qui sait fenêtrer) ou sur l'application système.
      const editor = editorForFileName(item.name);
      if (editor && folderId && editorAcceptsSize(editor, (item as FileItem).size)) {
        setPluginEditingMode('native');
        setPluginEditing(item as FileItem);
        dispatch(addRecentFile({ item: item as any, path: `/folder/${folderId}` }));
        return;
      }
      if (isImageItem(item as FileItem)) {
        openGallery(item as FileItem);
        return;
      }
      await doOpenFile(item);
    },
    [doOpenFile, openGallery, folderId, dispatch, openShortcut]
  );

  // Gestion du clic sur un item
  const handleItemClick = useCallback(
    async (item: Item) => {
      if ('items' in item) {
        // Dossier : verifier si protege par mot de passe
        if (isProtected(item.id) && !isUnlockedForSession(item.id)) {
          setUnlockModalItem(item);
          setUnlockModalOpen(true);
          return;
        }
        navigate(`/folder/${item.id}`);
        return;
      }
      // Fichier
      if (fileClickBehavior === 'details') {
        setDetailsPanelItem(item);
        return;
      }
      await openItemContent(item);
    },
    [navigate, fileClickBehavior, openItemContent]
  );

  // Double-click always opens the file — independent of the click behavior
  // preference. For folders, it's a no-op (single click already navigated).
  const handleItemDoubleClick = useCallback(
    async (item: Item) => {
      if ('items' in item) return;
      await openItemContent(item);
    },
    [openItemContent]
  );

  // Callback quand le fichier/dossier est deverrouille
  const handleUnlockSuccess = useCallback(
    (itemId: string) => {
      const item = unlockModalItem;
      setUnlockModalOpen(false);
      setUnlockModalItem(null);
      setPasswordVersion((v) => v + 1);
      if (!item) return;

      if ('items' in item) {
        navigate(`/folder/${item.id}`);
      } else if (
        folderId &&
        (() => {
          // Même garde qu'à l'ouverture ordinaire : ce chemin la réimplémente
          // (il ne repasse pas par openItemContent, dont la garde de protection
          // rouvrirait la demande de mot de passe).
          const e = editorForFileName(item.name);
          return e !== null && editorAcceptsSize(e, (item as FileItem).size);
        })()
      ) {
        // Un format revendiqué par un greffon s'ouvre dans SON éditeur, y
        // compris au sortir du déverrouillage — sinon le mot de passe menait
        // toujours à l'application système, qui ne connaît pas le format.
        // On ne repasse PAS par openItemContent : sa garde de protection
        // relirait l'état de session et rouvrirait la demande de mot de passe.
        setPluginEditingMode('native');
        setPluginEditing(item as FileItem);
      } else {
        doOpenFile(item);
      }
    },
    [unlockModalItem, navigate, doOpenFile, folderId]
  );

  // Gestion de l'upload
  // `importMode` (Protection du bureau) : 'move' = déplacer dans le coffre —
  // l'original n'est supprimé (suppression sécurisée côté main) qu'APRÈS
  // que la copie chiffrée + les métadonnées sont écrites ET que le main a
  // vérifié que le blob se déchiffre intégralement (hash comparé à la source).
  const handleUpload = useCallback(
    async (file: File, importMode: ImportMode = 'copy') => {
      if (!file || !folderId) return;

      // Chemin OS de l'original — requis pour le mode « déplacer ». Résolu
      // AVANT l'import (le File peut devenir inaccessible après).
      const originalPath = importMode === 'move' ? getOsFilePath(file) : null;

      let interval: NodeJS.Timeout | null = null;
      let closeTimeout: NodeJS.Timeout | null = null;
      // Désabonnement retourné par ipcRenderer.on — seule façon fiable de
      // détacher le listener (contextBridge ne préserve pas l'identité des
      // fonctions, removeListener ne matcherait jamais le wrapper).
      let unsubscribeProgress: (() => void) | null = null;

      const detachProgressListener = () => {
        if (unsubscribeProgress) {
          unsubscribeProgress();
          unsubscribeProgress = null;
        }
      };

      try {
        const storageMode = getCurrentStorageMode();
        const isLocalMode = storageMode === 'local';
        const isHybridMode = storageMode === 'hybrid';

        // ── « Déplacer dans le coffre » : gates AVANT tout travail ──
        // - chemin OS non résoluble → rétrogradé en copie (original conservé) ;
        // - stockage cloud pur → pas de blob local vérifiable → copie ;
        // - collision de nom → refus TOTAL : l'import normal écraserait le
        //   blob existant, la vérification passerait contre le NOUVEAU blob
        //   et l'ancien fichier du coffre serait détruit en silence.
        let effectiveMode: ImportMode = importMode;
        let moveDowngrade: 'no-path' | 'storage' | null = null;
        if (importMode === 'move') {
          if (!originalPath) {
            effectiveMode = 'copy';
            moveDowngrade = 'no-path';
          } else if (!isLocalMode && !isHybridMode) {
            effectiveMode = 'copy';
            moveDowngrade = 'storage';
          } else {
            const nameTaken = items.some(
              (it: Item) => !!it && !checkIsFolder(it) && it.name === file.name
            );
            if (nameTaken) {
              error(
                t(
                  'desktopProtection.moveNameTaken',
                  '« {{name}} » existe déjà dans ce dossier — renommez l’un des deux avant de déplacer (original conservé).',
                  { name: file.name }
                )
              );
              return;
            }
          }
        }

        // Gros fichier en mode HYBRIDE : si le chemin OS est résoluble, le
        // main process chiffre en streaming avec la FEK de session
        // (hybrid:saveFromPath) — conteneur V3 portable, aucun ArrayBuffer
        // côté renderer.
        const hybridStreamPath =
          isHybridMode && file.size > NON_LOCAL_MAX_FILE_SIZE ? getOsFilePath(file) : null;

        // Modes non locaux SANS chemin streaming (cloud/BYOS, ou hybride
        // avec un fichier synthétique sans chemin OS) : le fichier entier
        // passe en mémoire renderer — refuser AVANT de le lire.
        if (!isLocalMode && !hybridStreamPath && file.size > NON_LOCAL_MAX_FILE_SIZE) {
          error(
            isHybridMode
              ? t(
                  'file.tooLargeNoPath',
                  "Ce fichier dépasse 500 Mo et son chemin d'accès n'est pas résoluble — copiez-le d'abord sur le disque, puis importez-le depuis l'explorateur de fichiers."
                )
              : t(
                  'file.tooLargeNonLocal',
                  'Les fichiers de plus de 500 Mo nécessitent le mode de stockage local pour le moment.'
                )
          );
          return;
        }

        // Import V3 en streaming : en mode local, au-delà du seuil et si le
        // chemin OS est résoluble, le main process chiffre directement depuis
        // le fichier source — aucun ArrayBuffer côté renderer.
        const sourcePath =
          isLocalMode && file.size > LOCAL_STREAM_THRESHOLD
            ? getOsFilePath(file)
            : hybridStreamPath;
        const useStreamingImport = sourcePath !== null;

        // Gros fichier local SANS chemin OS résoluble (fichier synthétique,
        // pièce jointe glissée depuis une application...) : le chemin tampon
        // plafonne à 500 Mo côté main — refuser tout de suite plutôt que de
        // lire des centaines de Mo en RAM avant d'échouer.
        if (isLocalMode && !useStreamingImport && file.size > NON_LOCAL_MAX_FILE_SIZE) {
          error(
            t(
              'file.tooLargeNoPath',
              "Ce fichier dépasse 500 Mo et son chemin d'accès n'est pas résoluble — copiez-le d'abord sur le disque, puis importez-le depuis l'explorateur de fichiers."
            )
          );
          return;
        }

        let fileData: any;
        if (useStreamingImport) {
          fileData = {
            name: file.name,
            type: file.type,
            size: file.size,
            sourcePath,
            lastModified: file.lastModified,
          };
        } else {
          // Convert File object to serializable format
          const reader = new FileReader();
          fileData = await new Promise((resolve, reject) => {
            reader.onload = (e) => {
              const arrayBuffer = e.target?.result as ArrayBuffer;
              const uint8Array = new Uint8Array(arrayBuffer);

              resolve({
                name: file.name,
                type: file.type,
                size: file.size,
                content: uint8Array,
                lastModified: file.lastModified,
              });
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
          });
        }

        // Validate file before upload
        try {
          validateFile(fileData);
        } catch (validationErr: unknown) {
          const validationErrMsg =
            validationErr instanceof Error ? validationErr.message : 'Unknown error';
          error(validationErrMsg || 'File validation failed');
          return;
        }

        // Show progress modal only for large files
        const showProgress = file.size > SHOW_PROGRESS_THRESHOLD;

        if (showProgress) {
          setIsUploadModalOpen(true);
          setUploadProgress(0);

          if (useStreamingImport) {
            // Progression réelle émise par le flux de chiffrement V3 (main process)
            const progressHandler = (...args: unknown[]) => {
              const payload = args[0] as
                | { folderId?: string; fileName?: string; percent?: number }
                | undefined;
              if (
                payload &&
                payload.folderId === folderId &&
                payload.fileName === file.name &&
                typeof payload.percent === 'number'
              ) {
                // Plafonner à 99 % tant que les métadonnées ne sont pas écrites
                setUploadProgress(Math.min(99, Math.max(0, Math.round(payload.percent))));
              }
            };
            unsubscribeProgress =
              window.electron?.ipcRenderer?.on('file:importProgress', progressHandler) ?? null;
          } else {
            // Simuler la progression
            interval = setInterval(() => {
              setUploadProgress((prev) => {
                if (prev >= 90) {
                  if (interval) clearInterval(interval);
                  return 90;
                }
                return prev + 10;
              });
            }, 200);
          }
        }

        // Snapshot current item IDs before upload to detect the new one
        const currentItemIds = new Set(items.map((item: any) => item.id));

        // Upload réel via Redux with serializable data
        const uploadResult = await uploadFile(folderId, fileData);

        // uploadFile (useFolder) intercepte les erreurs, affiche la
        // notification et retourne null — ne pas afficher de toast de succès
        // ni de progression à 100 % pour un import qui a échoué.
        if (uploadResult === null) {
          if (interval) clearInterval(interval);
          detachProgressListener();
          setIsUploadModalOpen(false);
          setUploadProgress(0);
          return;
        }

        // Create initial version for the uploaded file
        if (uploadResult && folderId) {
          try {
            const newItems = uploadResult.items || [];
            // Find the newly added item by comparing with pre-upload snapshot
            const newItemId = newItems.find((id: any) => {
              const itemId = typeof id === 'string' ? id : id?.id;
              return itemId && !currentItemIds.has(itemId);
            });

            if (newItemId) {
              const fileId = typeof newItemId === 'string' ? newItemId : (newItemId as any).id;
              dispatch(
                createVersion({
                  folderId,
                  fileId,
                  fileName: file.name,
                  comment: 'Version initiale',
                  size: file.size,
                })
              );
            }
          } catch {
            // Version creation is non-critical, don't block upload
          }
        }

        if (interval) clearInterval(interval);
        detachProgressListener();

        if (showProgress) {
          setUploadProgress(100);
          closeTimeout = setTimeout(() => {
            setIsUploadModalOpen(false);
            setUploadProgress(0);
          }, 1000);
        }

        if (effectiveMode === 'move' && originalPath) {
          // Déplacer dans le coffre : la copie chiffrée + les métadonnées
          // sont écrites (uploadFile a résolu) — le main VÉRIFIE maintenant
          // que le blob se déchiffre intégralement (hash flux comparé à la
          // source, aucun clair matérialisé) puis supprime l'original de
          // façon sécurisée. En cas d'échec, l'original est TOUJOURS conservé.
          const deleteRes = await secureDeleteOriginal({
            sourcePath: originalPath,
            folderId,
            fileName: file.name,
          });
          if (deleteRes.ok) {
            success(
              t(
                'desktopProtection.moveSuccess',
                '« {{name}} » déplacé dans le coffre — original supprimé ({{size}}).',
                { name: file.name, size: formatBytes(file.size) }
              )
            );
          } else if (deleteRes.unavailable) {
            warning(
              t(
                'desktopProtection.moveUnavailable',
                '« {{name}} » importé, mais la suppression de l’original nécessite une mise à jour de Filarr — original conservé.',
                { name: file.name }
              )
            );
          } else if (deleteRes.error) {
            // Raison française précise remontée par le main (vérification
            // échouée, fichier ouvert ailleurs…) — l'original est conservé.
            warning(
              t('desktopProtection.moveFailedWithReason', '« {{name}} » : {{reason}}', {
                name: file.name,
                reason: deleteRes.error,
              })
            );
          } else {
            warning(
              t(
                'desktopProtection.moveVerifyFailed',
                '« {{name}} » importé, mais la vérification ou la suppression de l’original a échoué — original conservé.',
                { name: file.name }
              )
            );
          }
        } else if (moveDowngrade === 'no-path') {
          info(
            t(
              'desktopProtection.moveNoPath',
              '« {{name}} » importé — chemin d’origine non résoluble, l’original est conservé.',
              { name: file.name }
            )
          );
        } else if (moveDowngrade === 'storage') {
          info(
            t(
              'desktopProtection.moveStorageCopy',
              '« {{name}} » importé en copie — le déplacement nécessite le stockage local ou hybride, l’original est conservé.',
              { name: file.name }
            )
          );
        } else {
          success(`Fichier "${file.name}" uploadé avec succès (${formatBytes(file.size)})`);
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        if (interval) clearInterval(interval);
        if (closeTimeout) clearTimeout(closeTimeout);
        detachProgressListener();
        error(errMsg || "Échec de l'upload du fichier");
        setIsUploadModalOpen(false);
        setUploadProgress(0);
      }
    },
    [folderId, uploadFile, dispatch, success, error, warning, info, items, folder, t]
  );

  // ── Protection du bureau : choix Copier vs Déplacer-dans-le-coffre ──
  const desktopProtection = useSelector(selectDesktopProtection);
  const [importDialogFiles, setImportDialogFiles] = useState<File[] | null>(null);

  const runImport = useCallback(
    async (files: File[], mode: ImportMode) => {
      if (mode === 'move') {
        // Séquentiel : chaque déplacement chiffre PUIS re-déchiffre le
        // fichier entier pour vérification côté main — les paralléliser
        // saturerait le disque et brouillerait la barre de progression.
        for (const file of files) {
          await handleUpload(file, 'move');
        }
      } else {
        // Séquentiel AUSSI en copie. Chaque ajout fait lire-modifier-écrire
        // les métadonnées du dossier ; lancés de front, le dernier écrivain
        // gagnait et les fiches des autres fichiers disparaissaient en
        // silence (constaté sur le web le 2026-09-01 : cinq photos, une
        // seule visible — la même fenêtre de course existe côté desktop).
        for (const file of files) {
          await handleUpload(file);
        }
      }
    },
    [handleUpload]
  );

  /**
   * Point d'entrée unique des imports externes (drop + sélecteur).
   * Comportement par défaut inchangé (copier, sans dialogue). Le dialogue
   * n'apparaît que si « Demander à chaque import » est actif — activé
   * automatiquement quand l'utilisateur passe le mode par défaut à
   * « Déplacer » dans les Paramètres, jusqu'à « Ne plus demander ».
   */
  const startImport = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      if (desktopProtection.askImportMode) {
        setImportDialogFiles(files);
      } else {
        void runImport(files, desktopProtection.importMode);
      }
    },
    [desktopProtection.askImportMode, desktopProtection.importMode, runImport]
  );

  // ── Wave 2 : « Protéger sur place » depuis les points d'entrée d'ajout ──
  // Chemins OS à protéger (dialogue destination + suppression d'original).
  const [protectDialogPaths, setProtectDialogPaths] = useState<string[] | null>(null);

  const handleImportModeConfirm = useCallback(
    (mode: ImportChoice, remember: boolean) => {
      const files = importDialogFiles ?? [];
      setImportDialogFiles(null);
      if (mode === 'protect') {
        // Aucun import dans le coffre : les fichiers au chemin OS résoluble
        // partent vers le dialogue « Protéger sur place » (conteneur .filarr
        // dans les dossiers Windows). Les autres sont ignorés (note affichée
        // dans le dialogue de choix).
        const paths = files
          .map((file) => getOsFilePath(file))
          .filter((p): p is string => typeof p === 'string' && p.length > 0);
        if (paths.length > 0) setProtectDialogPaths(paths);
        return;
      }
      if (remember) {
        dispatch(updateDesktopProtection({ importMode: mode, askImportMode: false }));
      }
      void runImport(files, mode);
    },
    [importDialogFiles, dispatch, runImport]
  );

  /** Sélecteur OS natif → dialogue « Protéger sur place » (fichiers ou dossier). */
  const pickAndProtectInPlace = useCallback(async (directory: boolean) => {
    const renderer = window.electron?.ipcRenderer;
    if (!renderer) return;
    try {
      const result = (await renderer.invoke('showOpenDialog', {
        properties: directory ? ['openDirectory'] : ['openFile', 'multiSelections'],
      })) as { canceled?: boolean; filePaths?: string[] } | undefined;
      const paths = result && !result.canceled ? (result.filePaths ?? []) : [];
      if (paths.length > 0) setProtectDialogPaths(paths);
    } catch {
      // Dialogue indisponible — rien à casser.
    }
  }, []);

  // Nombre de fichiers dont le chemin OS est résoluble (seuls eux peuvent
  // être déplacés) — calculé à l'ouverture du dialogue uniquement.
  const importDialogMovableCount = useMemo(
    () => (importDialogFiles ?? []).filter((file) => getOsFilePath(file) !== null).length,
    [importDialogFiles]
  );
  const importDialogTotalSize = useMemo(
    () => (importDialogFiles ?? []).reduce((sum, file) => sum + file.size, 0),
    [importDialogFiles]
  );
  // Le déplacement exige un blob local vérifiable (stockage local/hybride) —
  // recalculé à chaque ouverture du dialogue (le mode peut changer en session).
  const importDialogStorageSupportsMove = useMemo(() => {
    if (importDialogFiles === null) return true;
    const mode = getCurrentStorageMode();
    return mode === 'local' || mode === 'hybrid';
  }, [importDialogFiles]);

  // Gestion de la suppression
  const handleDelete = useCallback(() => {
    setIsDeleteModalOpen(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!folderId) return;

    try {
      for (const itemId of selectedItems) {
        const item = items.find((i) => i.id === itemId);
        if (item && 'items' in item) {
          await removeFolder(itemId);
        } else {
          await removeFile(folderId, itemId);
        }
      }

      setSelectedItems([]);
      setIsDeleteModalOpen(false);
      await loadFolder(folderId);
    } catch (err) {
      error('Échec de la suppression');
    }
  }, [selectedItems, items, folderId, removeFolder, removeFile, loadFolder, error]);

  // Gestion du drag & drop
  const handleDrag = useCallback((e: DragEvent<HTMLDivElement>) => {
    // L'INTENTION se lit avant tout. Un bloc tiré de la palette du bandeau
    // appartient à la grille du bandeau, pas à la liste ; un glisser sans
    // charge utile (une carte d'un bloc dont les rappels sont muets ici, un
    // onglet) n'appartient à personne. Ni l'un ni l'autre n'est un import, et
    // l'overlay « Déposez vos fichiers ici » ne doit pas s'allumer pour eux.
    const intent = classifyDragTypes(e.dataTransfer.types);
    if (intent === 'widget' || intent === 'none') return;

    e.preventDefault();
    e.stopPropagation();

    // Ne pas afficher l'overlay upload pour les drags internes (deplacements de fichiers)
    if (intent === 'internal') return;

    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      // Un bloc lâché hors de la grille du bandeau : rien à faire, et surtout
      // pas le traiter comme un dépôt de fichiers.
      const intent = classifyDragTypes(e.dataTransfer.types);
      if (intent === 'widget') return;

      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      // Drop interne = deplacer le fichier/dossier dans le dossier courant
      if (intent === 'internal' && folderId) {
        handleDropItem(e, folderId, folderId);
        return;
      }

      // Drop externe = upload de fichiers depuis le bureau
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const files = Array.from(e.dataTransfer.files);

        // Validate batch
        try {
          const filesData = files.map((file) => ({
            name: file.name,
            size: file.size,
            type: file.type,
          }));
          validateFileBatch(filesData);
        } catch (validationErr: unknown) {
          const validationErrMsg =
            validationErr instanceof Error ? validationErr.message : 'Unknown error';
          error(validationErrMsg || 'File validation failed');
          return;
        }

        // Upload files one by one (via le point d'entrée Protection du
        // bureau : copier par défaut, dialogue copier/déplacer si demandé)
        startImport(files);
      }
    },
    [startImport, error, folderId, handleDropItem]
  );

  // Gestion des actions sur les items
  const handleRenameItem = useCallback(
    (itemId: string) => {
      const item = items.find((i) => i.id === itemId);
      if (!item) return;

      setItemToRename(item);
      setRenameModalOpen(true);
    },
    [items]
  );

  const handleConfirmRename = useCallback(
    async (newName: string) => {
      if (!itemToRename || newName === itemToRename.name || !folderId) return;

      try {
        let result: any;
        if ('items' in itemToRename) {
          result = await editFolder(itemToRename.id, { name: newName });
        } else {
          result = await renameFile(folderId, itemToRename.id, newName);
        }
        if (result === false || result === null) {
          return;
        }
        success('Élément renommé avec succès!');
        await loadFolder(folderId);
      } catch (err) {
        error('Échec du renommage');
      }
    },
    [itemToRename, folderId, editFolder, renameFile, loadFolder, success, error]
  );

  /**
   * Calcule récursivement les informations d'un dossier
   */
  const calculateFolderInfo = useCallback((folder: Folder): { count: number; size: number } => {
    let totalCount = 0;
    let totalSize = 0;

    if (!folder.items || folder.items.length === 0) {
      return { count: 0, size: 0 };
    }

    // Parcourir les items du dossier
    for (const itemOrId of folder.items) {
      // Si c'est un objet Item
      if (typeof itemOrId === 'object' && itemOrId !== null) {
        const itemObj = itemOrId as Item;
        totalCount++;

        if (checkIsFolder(itemObj)) {
          // C'est un sous-dossier, calculer récursivement
          const subResult = calculateFolderInfo(itemObj as Folder);
          totalCount += subResult.count;
          totalSize += subResult.size;
        } else {
          // C'est un fichier
          const fileItem = itemObj as FileItem;
          totalSize += fileItem.size || 0;
        }
      } else {
        // Si c'est juste un ID, on compte 1 mais on ne peut pas calculer la taille
        totalCount++;
      }
    }

    return { count: totalCount, size: totalSize };
  }, []);

  /**
   * Obtient les items directs d'un dossier sous forme d'objets Item
   */
  const getFolderDirectItems = useCallback(
    (folder: Folder): Item[] => {
      if (!folder.items || folder.items.length === 0) {
        return [];
      }

      return folder.items
        .map((itemOrId) => {
          // Si c'est déjà un objet Item, le retourner
          if (typeof itemOrId === 'object' && itemOrId !== null) {
            return itemOrId as Item;
          }
          // Si c'est un ID, on essaie de le trouver dans la liste des items
          const itemId = typeof itemOrId === 'string' ? itemOrId : null;
          if (itemId) {
            return items.find((i) => i.id === itemId) || null;
          }
          return null;
        })
        .filter((item): item is Item => item !== null);
    },
    [items]
  );

  const handleDeleteItem = useCallback(
    (itemId: string) => {
      const item = items.find((i) => i.id === itemId);
      if (!item) {
        return;
      }

      // Si c'est un dossier avec du contenu, ouvrir le modal spécial
      if (checkIsFolder(item)) {
        const folder = item as Folder;
        const directItems = getFolderDirectItems(folder);

        // Count notes belonging to this folder
        const folderNoteCount = allNotes.filter(
          (n) => n.parentId === item.id && !n.deletedAt
        ).length;

        if (directItems.length > 0 || folderNoteCount > 0) {
          // Calculer les statistiques
          const { count: totalItemCount, size: totalSize } = calculateFolderInfo(folder);

          const deletionInfo: FolderDeletionInfo = {
            folderName: item.name,
            items: directItems,
            totalItemCount,
            totalSize,
            noteCount: folderNoteCount,
          };

          setFolderDeletionInfo(deletionInfo);
          setItemToDelete(item);
          setFolderDeleteModalOpen(true);
          return;
        }
      }

      // Pour les fichiers ou dossiers vides, utiliser le modal simple
      setSelectedItems([itemId]);
      setIsDeleteModalOpen(true);
    },
    [items, calculateFolderInfo, getFolderDirectItems]
  );

  /**
   * Confirme la suppression d'un dossier avec contenu via le nouveau modal
   */
  const handleConfirmFolderDelete = useCallback(async () => {
    if (!itemToDelete || !folderId) return;

    try {
      setIsDeleting(true);

      if (checkIsFolder(itemToDelete)) {
        await removeFolder(itemToDelete.id);
        // Soft-delete notes belonging to this folder
        dispatch(deleteNotesByFolder(itemToDelete.id));
      } else {
        await removeFile(folderId, itemToDelete.id);
      }

      setFolderDeleteModalOpen(false);
      setFolderDeletionInfo(null);
      setItemToDelete(null);
      success(`"${itemToDelete.name}" a été supprimé avec succès`);
    } catch (err) {
      error('Échec de la suppression');
    } finally {
      setIsDeleting(false);
    }
  }, [itemToDelete, folderId, removeFolder, removeFile, dispatch, success, error]);

  const handleAddReminderToItem = useCallback((item: Item) => {
    setItemForReminder(item);
    setReminderModalOpen(true);
  }, []);

  const handleConfirmAddReminder = useCallback(
    async (reminderData: ReminderData) => {
      if (!itemForReminder || !folderId) return;

      try {
        const existingReminders: Reminder[] = (itemForReminder as any).reminders || [];

        // La fabrique PARTAGÉE, et pas un objet littéral : c'est elle qui
        // reprend `recurring` et `priority` (que cet écran jetait alors que la
        // boîte de dialogue les récoltait) et qui pose `createdAt`/`updatedAt`,
        // sans lesquels le mobile fait perdre ce rappel à l'arbitrage.
        const newReminder: Reminder = buildReminder(
          reminderData,
          {
            itemId: itemForReminder.id,
            itemName: itemForReminder.name,
            itemType: 'items' in itemForReminder ? 'folder' : 'file',
          },
          Date.now().toString()
        );

        const newReminders = [...existingReminders, newReminder];

        if ('items' in itemForReminder) {
          await editFolder(itemForReminder.id, { reminders: newReminders } as any);
        } else {
          await updateMetadata(folderId, itemForReminder.id, { reminders: newReminders });
        }

        success('Rappel ajouté avec succès!');
        setReminderModalOpen(false);
        setItemForReminder(null);
      } catch (err) {
        error("Échec de l'ajout du rappel");
      }
    },
    [itemForReminder, folderId, editFolder, updateMetadata, success, error]
  );

  const handleDownloadItem = useCallback(
    async (itemId: string) => {
      if (!folderId) return;

      // Block download if file is password-protected and not unlocked
      if (isProtected(itemId) && !isUnlockedForSession(itemId)) {
        error(
          'Ce fichier est protege par un mot de passe. Deverrouillez-le avant de le telecharger.'
        );
        return;
      }

      try {
        await downloadFile(folderId, itemId);
      } catch (err) {
        error('Échec du téléchargement');
      }
    },
    [folderId, downloadFile, error]
  );

  const handleDownloadMultiple = useCallback(async () => {
    if (!folderId || selectedItems.length === 0) return;

    // Filter out password-protected items that are not unlocked
    const downloadableIds = selectedItems.filter(
      (id) => !isProtected(id) || isUnlockedForSession(id)
    );
    const skippedCount = selectedItems.length - downloadableIds.length;

    if (downloadableIds.length === 0) {
      error(
        'Tous les fichiers selectionnes sont proteges par mot de passe. Deverrouillez-les avant de les telecharger.'
      );
      return;
    }

    try {
      const result = await downloadMultipleFiles(folderId, downloadableIds);
      if (result.success) {
        if (skippedCount > 0) {
          success(
            `${downloadableIds.length} fichier(s) telecharge(s). ${skippedCount} fichier(s) protege(s) ignore(s).`
          );
        } else {
          success(`${downloadableIds.length} fichier(s) telecharge(s) avec succes`);
        }
      }
    } catch (err) {
      error('Echec du telechargement');
    }
  }, [folderId, selectedItems, success, error]);

  // Gestion de Move/Copy
  const handleMoveItem = useCallback((item: Item) => {
    setIsBatchMoveCopy(false);
    setItemToMoveCopy(item);
    setMoveCopyMode('move');
    setMoveCopyModalOpen(true);
  }, []);

  const handleCopyItem = useCallback((item: Item) => {
    setIsBatchMoveCopy(false);
    setItemToMoveCopy(item);
    setMoveCopyMode('copy');
    setMoveCopyModalOpen(true);
  }, []);

  // Open the move/copy dialog for the whole selection.
  const handleBatchMove = useCallback(() => {
    if (selectedItems.length === 0) return;
    setIsBatchMoveCopy(true);
    setItemToMoveCopy(null);
    setMoveCopyMode('move');
    setMoveCopyModalOpen(true);
  }, [selectedItems.length]);

  const handleBatchCopy = useCallback(() => {
    if (selectedItems.length === 0) return;
    setIsBatchMoveCopy(true);
    setItemToMoveCopy(null);
    setMoveCopyMode('copy');
    setMoveCopyModalOpen(true);
  }, [selectedItems.length]);

  // Handler pour afficher l'historique des versions
  const handleViewHistory = useCallback(
    (item: Item) => {
      if ('items' in item) return; // Pas d'historique pour les dossiers

      const fileItem = item as FileItem;
      setVersionHistoryFileId(fileItem.id);
      setVersionHistoryFileName(fileItem.name);
      setVersionHistoryFileSize(fileItem.size || 0);
      setVersionHistoryOpen(true);

      // Charger les versions depuis Redux
      dispatch(fetchVersions(fileItem.id));
    },
    [dispatch]
  );

  // Handler pour proteger par mot de passe
  const handleSetPassword = useCallback((item: Item) => {
    setPasswordModalItem(item);
    setPasswordModalOpen(true);
  }, []);

  /**
   * Les identifiants DEJA en favori.
   *
   * Un `Set` et non un `.some()` par element : le menu est construit pour
   * chaque ligne d'une liste qui peut en compter des milliers, et une
   * recherche lineaire par ligne redevient quadratique sans prevenir.
   */
  const favoriteItemIds = useSelector(
    (state: RootState) => state.favorites.favorites,
    (a, b) => a === b
  );
  const favoriteIdSet = useMemo(
    () => new Set(favoriteItemIds.map((f) => f.itemId)),
    [favoriteItemIds]
  );

  /**
   * Poser OU retirer un favori — un seul geste, reversible.
   *
   * `addFavorite` ignore en silence un element deja favori : sans le test
   * ci-dessous, un second clic affichait « ajoute aux favoris » sans que rien
   * ne se passe.
   */
  const handleToggleFavorite = useCallback(
    (item: Item) => {
      const already = favoriteIdSet.has(item.id);
      if (already) {
        dispatch(removeFavorite(item.id));
        success(
          t('contextMenu.favoriteRemoved', '« {{name}} » retiré des favoris', {
            name: item.name,
          })
        );
        return;
      }
      dispatch(
        addFavorite({
          item: item,
          path: folderId ? `/folder/${folderId}` : '/',
        })
      );
      success(`"${item.name}" ajouté aux favoris`);
    },
    [dispatch, folderId, success, favoriteIdSet, t]
  );

  /** Alias conserve : plusieurs points d'appel le nomment ainsi. */
  const handleAddToFavorites = handleToggleFavorite;

  const handleBatchAddToFavorites = useCallback(() => {
    selectedItems.forEach((id) => {
      const item = items.find((i) => i.id === id);
      if (item) handleAddToFavorites(item);
    });
  }, [selectedItems, items, handleAddToFavorites]);

  // Keyboard navigation over the grid: arrows move focus (+ single-select),
  // Enter opens, F2 renames, Delete removes the selection, Ctrl/Cmd+A selects
  // all, Home/End jump, Escape clears. Skipped while typing or a modal is open.
  // Keyboard nav must walk items in the SAME order they render — folders in the
  // subfolders section, then files in their (possibly grouped) order — not the
  // interleaved filteredAndSortedItems, or arrows jump between non-adjacent rows.
  const navOrder = useMemo(
    () => [...subfolders, ...fileGroups.flatMap((g) => g.items)],
    [subfolders, fileGroups]
  );
  // Suppress the global key handler while ANY blocking overlay owns the keyboard,
  // otherwise arrows/Delete/Enter act on the folder view behind the overlay.
  const anyOverlayOpen =
    !!quickLookFile ||
    galleryOpen ||
    moveCopyModalOpen ||
    renameModalOpen ||
    isDeleteModalOpen ||
    folderDeleteModalOpen ||
    createFolderModalOpen ||
    isUploadModalOpen ||
    reminderModalOpen ||
    versionHistoryOpen ||
    passwordModalOpen ||
    unlockModalOpen ||
    !!detailsPanelItem ||
    !!folderStyleTarget ||
    shareDialogOpen ||
    !!pluginEditing ||
    !!newDocSpec;

  useEffect(() => {
    const isEditableTarget = (el: EventTarget | null): boolean => {
      const node = el as HTMLElement | null;
      if (!node) return false;
      const tag = node.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
    };

    const handleKeyNav = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (anyOverlayOpen) return;

      const list = navOrder;
      if (list.length === 0) return;

      const focusAt = (index: number) => {
        const clamped = Math.max(0, Math.min(index, list.length - 1));
        setFocusedIndex(clamped);
        const id = list[clamped]?.id;
        if (!id) return;
        setSelectedItems([id]);
        lastSelectedRef.current = id;
        requestAnimationFrame(() => {
          document.querySelector(`[data-item-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
        });
      };

      switch (e.key) {
        case 'ArrowDown':
        case 'ArrowRight':
          e.preventDefault();
          focusAt(focusedIndex < 0 ? 0 : focusedIndex + 1);
          break;
        case 'ArrowUp':
        case 'ArrowLeft':
          e.preventDefault();
          focusAt(focusedIndex < 0 ? 0 : focusedIndex - 1);
          break;
        case 'Home':
          e.preventDefault();
          focusAt(0);
          break;
        case 'End':
          e.preventDefault();
          focusAt(list.length - 1);
          break;
        case 'Enter': {
          if (focusedIndex < 0) return;
          const item = list[focusedIndex];
          if (!item) return;
          e.preventDefault();
          if ('items' in item) handleItemClick(item);
          else openItemContent(item);
          break;
        }
        case 'F2': {
          if (focusedIndex < 0) return;
          const item = list[focusedIndex];
          if (!item) return;
          e.preventDefault();
          handleRenameItem(item.id);
          break;
        }
        case 'Delete':
        case 'Backspace':
          if (selectedItems.length > 0) {
            e.preventDefault();
            handleDelete();
          }
          break;
        case 'a':
        case 'A':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            handleBatchSelectAll();
          }
          break;
        case 'Escape':
          if (selectedItems.length > 0) {
            setSelectedItems([]);
            setFocusedIndex(-1);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyNav);
    return () => window.removeEventListener('keydown', handleKeyNav);
  }, [
    navOrder,
    focusedIndex,
    anyOverlayOpen,
    selectedItems,
    handleItemClick,
    openItemContent,
    handleRenameItem,
    handleDelete,
    handleBatchSelectAll,
  ]);

  const handleConfirmMoveCopy = useCallback(
    async (targetFolderId: string, newName?: string) => {
      if (!itemToMoveCopy || !folderId || moveCopyBusy) return;

      setMoveCopyBusy(true);
      try {
        const isFolder = 'items' in itemToMoveCopy;

        if (moveCopyMode === 'move') {
          if (isFolder) {
            await moveFolder(itemToMoveCopy.id, folderId, targetFolderId);
            success(`Dossier "${itemToMoveCopy.name}" déplacé avec succès!`);
          } else {
            await moveFile(itemToMoveCopy.id, folderId, targetFolderId);
            success(`Fichier "${itemToMoveCopy.name}" déplacé avec succès!`);
          }
        } else {
          if (isFolder) {
            await copyFolder(itemToMoveCopy.id, folderId, targetFolderId, newName);
            success(`Dossier "${itemToMoveCopy.name}" copié avec succès!`);
          } else {
            await copyFile(itemToMoveCopy.id, folderId, targetFolderId, newName);
            success(`Fichier "${itemToMoveCopy.name}" copié avec succès!`);
          }
        }

        // Recharger le dossier pour afficher les changements
        await loadFolder(folderId);

        setMoveCopyModalOpen(false);
        setItemToMoveCopy(null);
      } catch (err: unknown) {
        // Échec : la boîte reste ouverte, prête pour une autre destination.
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        error(`Échec de l'opération: ${errMsg || 'Erreur inconnue'}`);
      } finally {
        setMoveCopyBusy(false);
      }
    },
    [
      itemToMoveCopy,
      folderId,
      moveCopyBusy,
      moveCopyMode,
      moveFolder,
      moveFile,
      copyFolder,
      copyFile,
      loadFolder,
      success,
      error,
    ]
  );

  // Move/copy the whole selection to the chosen target folder.
  const handleBatchMoveCopyConfirm = useCallback(
    async (targetFolderId: string) => {
      if (!folderId || selectedItems.length === 0 || moveCopyBusy) return;
      const selected = selectedItems
        .map((id) => items.find((i) => i.id === id))
        .filter((i): i is Item => !!i);

      setMoveCopyBusy(true);
      setBatchProgress({ done: 0, total: selected.length });

      let ok = 0;
      let failed = 0;
      try {
        for (let i = 0; i < selected.length; i++) {
          const it = selected[i];
          // Posé AVANT l'élément : le compteur annonce celui qu'on traite,
          // pas celui qu'on vient de finir — l'attente porte sur le prochain.
          setBatchProgress({ done: i + 1, total: selected.length });
          try {
            const isFolder = 'items' in it;
            if (moveCopyMode === 'move') {
              if (isFolder) await moveFolder(it.id, folderId, targetFolderId);
              else await moveFile(it.id, folderId, targetFolderId);
            } else {
              if (isFolder) await copyFolder(it.id, folderId, targetFolderId);
              else await copyFile(it.id, folderId, targetFolderId);
            }
            ok++;
          } catch {
            failed++;
          }
        }

        await loadFolder(folderId);
        setMoveCopyModalOpen(false);
        setIsBatchMoveCopy(false);
        setSelectedItems([]);

        if (failed === 0) {
          success(
            moveCopyMode === 'move' ? `${ok} élément(s) déplacé(s)` : `${ok} élément(s) copié(s)`
          );
        } else {
          error(`${ok} réussi(s), ${failed} échoué(s)`);
        }
      } finally {
        setMoveCopyBusy(false);
        setBatchProgress(null);
      }
    },
    [
      folderId,
      selectedItems,
      items,
      moveCopyBusy,
      moveCopyMode,
      moveFolder,
      moveFile,
      copyFolder,
      copyFile,
      loadFolder,
      success,
      error,
    ]
  );

  // La racine n'est une destination légale que pour le DÉPLACEMENT de dossiers :
  // un fichier doit vivre dans un dossier, et la copie ne connaît pas la
  // sentinelle racine (pas de répertoire de contenu à la racine).
  const canTargetRoot = useMemo(() => {
    if (moveCopyMode !== 'move') return false;
    if (isBatchMoveCopy) {
      const selected = selectedItems
        .map((id) => items.find((i) => i.id === id))
        .filter((i): i is Item => !!i);
      return selected.length > 0 && selected.every((i) => 'items' in i);
    }
    return !!itemToMoveCopy && 'items' in itemToMoveCopy;
  }, [moveCopyMode, isBatchMoveCopy, selectedItems, items, itemToMoveCopy]);

  // Décompte affiché dans le pied de la boîte pendant un traitement par lot.
  // Rien pour un élément seul : le bouton en attente suffit à le dire.
  const moveCopyBusyLabel = useMemo(() => {
    if (!batchProgress) return undefined;
    const count = { done: batchProgress.done, total: batchProgress.total };
    return moveCopyMode === 'move'
      ? t('moveCopy.movingProgress', count)
      : t('moveCopy.copyingProgress', count);
  }, [batchProgress, moveCopyMode, t]);

  // Gestion création de dossier
  const handleCreateFolder = useCallback(() => {
    setCreateFolderModalOpen(true);
  }, []);

  const handleConfirmCreateFolder = useCallback(
    async (folderName: string, parentId: string | null) => {
      if (!folderId) return;

      try {
        await addFolder({
          name: folderName,
          parentId,
        });
        success(t('folder.create_success'));
        // Créé hors du dossier ouvert : on suit le dossier là où il est né,
        // sinon la création n'a aucun effet visible.
        if (parentId !== folderId) {
          navigate(parentId ? `/folder/${parentId}` : '/');
        }
      } catch (err) {
        error(t('folder.create_error'));
      }
    },
    [folderId, addFolder, success, error, t, navigate]
  );

  /**
   * « Nouveau document » — créer un fichier VIDE au format d'un greffon, puis
   * l'ouvrir tout de suite.
   *
   * Zéro octet, mime générique : le greffon sait lire un document vide
   * (« lecture tolérante », c'est le contrat que la documentation promet aux
   * auteurs), et ces octets partent par le chemin d'import NORMAL — c'est lui
   * qui chiffre selon le mode de stockage. Le nom déjà pris est un REFUS, pas
   * un écrasement : le blob existant serait remplacé en silence et la ligne
   * d'origine continuerait de pointer dessus.
   */
  const handleCreateDocument = useCallback(
    async (rawName: string) => {
      const spec = newDocSpec;
      if (!spec || !folderId) return;
      const base = rawName.trim();
      if (base.length === 0 || base.length > 200 || /[\\/]/.test(base)) {
        error(t('folder.newDocumentInvalidName'));
        return;
      }
      // Jamais deux fois l'extension : « notes.fdoc » reste « notes.fdoc ».
      const suffixe = `.${spec.ext}`;
      const fileName = base.toLowerCase().endsWith(suffixe) ? base : `${base}${suffixe}`;
      if (items.some((it) => !!it && !checkIsFolder(it) && it.name === fileName)) {
        error(t('folder.newDocumentExists', { name: fileName }));
        return;
      }
      const fileId = generateUniqueId();
      try {
        /**
         * LES OCTETS DU FICHIER NEUF, demandés au format lui-même.
         *
         * Un fichier de zéro octet ne se distingue pas d'un fichier vidé :
         * c'est exactement ce qui s'est produit quand le menu offrait de
         * créer n'importe quel format ouvrable. Les formats à structure
         * obligatoire fournissent donc une graine ; ceux où le vide est un
         * document valide (le texte brut) n'en ont pas, et c'est déclaré.
         */
        const graine = spec.seed ? await spec.seed() : new Uint8Array(0);
        const updated = await dispatch(
          addFileToFolder({
            folderId,
            file: {
              id: fileId,
              name: fileName,
              type: 'application/octet-stream',
              size: graine.byteLength,
              content: graine,
            } as any,
          })
        ).unwrap();
        /**
         * L'identifiant RÉEL, relu dans le dossier renvoyé. En local et en
         * hybride c'est celui qu'on a fourni ; un adaptateur qui ferait
         * autrement (le serveur attribue l'id) laisserait sinon l'éditeur
         * écrire ses métadonnées sur un identifiant qui n'existe pas.
         */
        const créé = (Array.isArray((updated as any)?.items) ? (updated as any).items : []).find(
          (it: unknown) =>
            !!it && typeof it === 'object' && (it as { name?: string }).name === fileName
        ) as { id?: string } | undefined;
        const realId = créé?.id || fileId;
        await loadFolder(folderId);
        setNewDocSpec(null);
        // Ouverture immédiate : créer un fichier vide sans l'ouvrir ne servirait
        // à personne — c'est le geste « nouveau document », pas « nouveau vide ».
        setPluginEditingMode('native');
        setPluginEditing({
          id: realId,
          name: fileName,
          type: 'application/octet-stream',
          size: graine.byteLength,
        });
      } catch (err) {
        const message = (err as { message?: unknown } | null)?.message;
        error(typeof message === 'string' && message ? message : t('folder.newDocumentFailed'));
      }
    },
    [newDocSpec, folderId, items, dispatch, loadFolder, error, t]
  );

  /**
   * Les formats que le REGISTRE revendique — relu à chaque rendu plutôt que
   * figé au montage : un greffon installé en cours de session doit apparaître
   * dans le menu sans recharger l'écran.
   */
  const documentFormats = newDocumentFormats();

  // Gestion du menu contextuel pour les fichiers
  const handleFileContextMenu = useCallback(
    (e: MouseEvent<HTMLDivElement>, item: Item) => {
      /**
       * « Partager… » ouvre le dialogue UNIFIÉ (lien public + entrée dans un
       * coffre), pas directement la boîte de lien. Le builder partagé garde
       * pour cette capacité le libellé « Partager par lien », exact dans un
       * coffre (où le lien EST un raccourci direct) ; ici l'entrée est
       * renommée APRÈS construction, reconnue par l'identité de son handler —
       * jamais par son libellé, qui est traduit. Un « Déplacer » vers un
       * coffre depuis le dialogue met l'original à la corbeille locale : le
       * dossier courant se relit (même contrat que AddToVaultDialog).
       */
      /**
       * Le menu d'un RACCOURCI : ouvrir (dans le coffre), détails, favori,
       * rappel, retirer. Tout ce qui suppose des octets ICI (renommer,
       * télécharger, partager, versions, protéger, copier, synchroniser,
       * afficher dans l'explorateur…) est ABSENT, pas grisé : une entrée qui
       * ne peut rien faire n'a pas à être lue. « Retirer le raccourci » est le
       * `deleteFile` ordinaire — la fiche part à la corbeille douce, les
       * octets du coffre ne bougent pas.
       */
      const shortcutRef = vaultRefOf(item);
      if (shortcutRef) {
        openContextMenu(
          e as any,
          buildItemContextMenu(
            item,
            {
              openInVault: true,
              details: true,
              favorite: true,
              reminder: true,
              removeShortcut: true,
            },
            {
              onOpenInVault: () => openShortcut(item, shortcutRef),
              onDetails: () => setDetailsPanelItem(item),
              ...(favoriteIdSet.has(item.id)
                ? { onUnfavorite: () => handleToggleFavorite(item) }
                : { onFavorite: () => handleToggleFavorite(item) }),
              onReminder: () => handleAddReminderToItem(item),
              onRemoveShortcut: () => handleDeleteItem(item.id),
            },
            t
          )
        );
        return;
      }
      const onShareUnified = () =>
        openShareDialog(
          { kind: 'personalFile', file: item as FileItem, folderId: folderId || '' },
          {
            onLocalChanged: () => {
              if (folderId) void loadFolder(folderId);
            },
          }
        );
      const menu = buildItemContextMenu(
        item,
        {
          // « Ouvrir dans l'éditeur » n'apparaît que pour les formats qu'un
          // greffon revendique : partout ailleurs, le double-clic passe déjà
          // par l'application système et une entrée de plus n'apprendrait rien.
          openInEditor: !!editorForFileName(item.name),
          // « Ouvrir avec… » vaut pour TOUT fichier : même sans éditeur, il
          // reste l'aperçu et l'application système à départager.
          openWith: !('items' in item),
          details: true,
          download: true,
          showInExplorer: true,
          rename: true,
          move: true,
          copy: true,
          favorite: true,
          reminder: true,
          // Partage E2EE et synchronisation n'ont de sens qu'en mode nuage :
          // le fichier doit déjà être sur R2 pour que le lien public trouve
          // ses morceaux. En local, ces entrées ne feraient que promettre.
          share: accountMode === 'cloud',
          addToVault: canAddToVault,
          sync: accountMode === 'cloud',
          versions: true,
          protect: true,
          delete: true,
        },
        {
          onOpenInEditor: () => void openItemContent(item),
          onOpenWith: () => setOpenWithItem(item as FileItem),
          onDetails: () => setDetailsPanelItem(item),
          onDownload: () => handleDownloadItem(item.id),
          onShowInExplorer: () => {
            window.electron?.ipcRenderer
              ?.invoke('file:showInFolder', folderId || '', item.name)
              .then((ok: boolean) => {
                if (!ok) error("Impossible d'afficher le fichier dans l'explorateur");
              })
              .catch(() => error("Impossible d'afficher le fichier dans l'explorateur"));
          },
          onRename: () => handleRenameItem(item.id),
          onMove: () => handleMoveItem(item),
          onCopy: () => handleCopyItem(item),
          ...(favoriteIdSet.has(item.id)
            ? { onUnfavorite: () => handleToggleFavorite(item) }
            : { onFavorite: () => handleToggleFavorite(item) }),
          onReminder: () => handleAddReminderToItem(item),
          onShare: onShareUnified,
          onAddToVault: () =>
            setAddToVaultSource({
              kind: 'file',
              id: item.id,
              name: item.name,
              size: 'size' in item && typeof item.size === 'number' ? item.size : 0,
              mime: 'type' in item && typeof item.type === 'string' ? item.type : undefined,
              folderId: folderId || '',
            }),
          onSync: () => {
            window.electron?.ipcRenderer?.invoke('sync:triggerSync', '').catch(() => {});
          },
          onVersions: () => handleViewHistory(item),
          onProtect: () => handleSetPassword(item),
          onDelete: () => handleDeleteItem(item.id),
        },
        t
      ).map((entry) =>
        entry.onClick === onShareUnified
          ? { ...entry, label: t('contextMenu.share', 'Share…') }
          : entry
      );
      openContextMenu(e as any, menu);
    },
    [
      openContextMenu,
      openShareDialog,
      loadFolder,
      handleDownloadItem,
      handleRenameItem,
      handleMoveItem,
      handleCopyItem,
      handleAddReminderToItem,
      handleDeleteItem,
      handleToggleFavorite,
      favoriteIdSet,
      handleViewHistory,
      handleSetPassword,
      openItemContent,
      openShortcut,
      accountMode,
      canAddToVault,
      folderId,
      error,
      t,
    ]
  );

  // Gestion du menu contextuel pour les dossiers
  const handleFolderContextMenu = useCallback(
    (e: MouseEvent<HTMLDivElement>, item: Item) => {
      openContextMenu(
        e as any,
        buildItemContextMenu(
          item,
          {
            open: true,
            details: true,
            rename: true,
            style: true,
            move: true,
            copy: true,
            favorite: true,
            reminder: true,
            addToVault: canAddToVault,
            protect: true,
            delete: true,
          },
          {
            onOpen: () => handleItemClick(item),
            onDetails: () => setDetailsPanelItem(item),
            onRename: () => handleRenameItem(item.id),
            onStyle: () => setFolderStyleTarget(item as Folder),
            onMove: () => handleMoveItem(item),
            onCopy: () => handleCopyItem(item),
            ...(favoriteIdSet.has(item.id)
              ? { onUnfavorite: () => handleToggleFavorite(item) }
              : { onFavorite: () => handleToggleFavorite(item) }),
            onReminder: () => handleAddReminderToItem(item),
            onAddToVault: () =>
              setAddToVaultSource({ kind: 'folder', id: item.id, name: item.name }),
            onProtect: () => handleSetPassword(item),
            onDelete: () => handleDeleteItem(item.id),
          },
          t
        )
      );
    },
    [
      openContextMenu,
      handleItemClick,
      handleRenameItem,
      handleDeleteItem,
      handleAddReminderToItem,
      handleMoveItem,
      handleCopyItem,
      handleToggleFavorite,
      favoriteIdSet,
      handleSetPassword,
      canAddToVault,
      t,
    ]
  );

  // Wrapper pour le menu contextuel qui détermine le type d'item
  const handleItemContextMenu = useCallback(
    (e: MouseEvent<HTMLDivElement>, item: Item) => {
      if ('items' in item) {
        handleFolderContextMenu(e, item);
      } else {
        handleFileContextMenu(e, item);
      }
    },
    [handleFileContextMenu, handleFolderContextMenu]
  );

  // ==================== LE DOSSIER PERSONNALISABLE ====================
  //
  // ── LOI Nº1 ──────────────────────────────────────────────────────────────
  // Un dossier que personne n'a personnalisé est INDISCERNABLE de ce qu'il était
  // avant ce chantier : aucun en-tête, aucune note d'accueil, aucun bandeau,
  // aucune ligne de plus au-dessus de la liste, et RIEN d'écrit dans le
  // conteneur de mise en page. La seule trace permanente est une icône de plus
  // dans la barre d'actions, qui existait déjà.
  //
  // ── CE QUI NE SE PERSONNALISE PAS ────────────────────────────────────────
  // La liste de fichiers. Elle reste en bas, pleine largeur, avec ses barres, et
  // on ne peut ni la retirer ni la déplacer. C'est ce qui garantit qu'un dossier
  // reste un dossier.

  const layoutStatus = useSelector((state: RootState) => state.layout.status);
  const layoutViews = useSelector((state: RootState) => state.layout.document.views);
  const editSession = useSelector((state: RootState) => state.layout.edit);

  const layoutViewId = folderId ? folderViewId(folderId) : null;
  const layoutEditing =
    editSession !== null && layoutViewId !== null && editSession.viewId === layoutViewId;

  /** Du PARENT vers la racine — l'ordre exact que réclame la résolution. */
  const ancestorIds = useMemo(
    () =>
      (folderPath as Folder[])
        .slice(0, -1)
        .map((entry) => entry.id)
        .reverse(),
    [folderPath]
  );

  const resolvedLayout = useMemo(
    () => (folderId ? resolveFolderLayout(layoutViews, folderId, ancestorIds) : null),
    [layoutViews, folderId, ancestorIds]
  );

  /** Le BROUILLON quand une session est ouverte : rien ne descend au document. */
  const draftSlots = layoutEditing && editSession ? editSession.slots : null;

  const liveConfig = useMemo<FolderConfig>(
    () =>
      (draftSlots ? readFolderConfigFromSlots(draftSlots) : null) ??
      resolvedLayout?.own ??
      DEFAULT_FOLDER_CONFIG,
    [draftSlots, resolvedLayout]
  );

  const liveBand = useMemo<LayoutSlot[]>(
    () => (draftSlots ? bandSlots(draftSlots) : (resolvedLayout?.band ?? [])),
    [draftSlots, resolvedLayout]
  );

  /**
   * Ce que reçoit le bandeau : emplacement réservé + blocs. Quand le bandeau est
   * HÉRITÉ, ce sont les blocs de l'ancêtre présentés comme s'ils étaient d'ici —
   * c'est ce qui rend le rendu identique dans les trois portées. Un geste sur
   * l'un de ces blocs fait alors « prendre la main » (voir `commitLayoutSlots`).
   */
  const bandViewSlots = useMemo<LayoutSlot[]>(
    () => (draftSlots ? [...draftSlots] : withFolderConfig(liveBand, liveConfig)),
    [draftSlots, liveBand, liveConfig]
  );

  /** Les emplacements réellement STOCKÉS pour ce dossier (jamais ceux hérités). */
  const storedSlots = useMemo<LayoutSlot[]>(
    () => (layoutViewId ? (layoutViews[layoutViewId]?.slots ?? []) : []),
    [layoutViews, layoutViewId]
  );

  const inheritedFromName = useMemo(() => {
    const id = resolvedLayout?.inheritedFrom;
    if (!id) return null;
    return folders.find((entry) => entry.id === id)?.name ?? null;
  }, [resolvedLayout, folders]);

  /**
   * LA LARGEUR DÉCIDE, ET ELLE SE MESURE SUR LA COLONNE, PAS SUR LA FENÊTRE.
   * Sous le seuil compact, ranger le bandeau n'est pas proposé : la disposition
   * est UNE, celle des douze colonnes, et la ranger depuis un écran étroit
   * détruirait la mise en page de bureau qu'on ne pourrait plus reconstruire.
   *
   * C'est la largeur de CONTENU qui compte — celle que la grille du bandeau
   * mesurera elle-même —, pas celle de la boîte avec ses 48 px de marges : les
   * deux mesures tombaient de part et d'autre du seuil sur 48 px de largeurs de
   * fenêtre, où l'édition était permise en douze colonnes alors que le repos
   * retombait à une seule. Le `ResizeObserver` donne déjà la boîte de contenu ;
   * la première mesure doit faire pareil.
   */
  const [contentWidth, setContentWidth] = useState(0);
  useEffect(() => {
    const node = contentContainerRef.current;
    if (!node) return;
    // Première mesure immédiate : le `ResizeObserver` ne se déclenche qu'au
    // prochain cycle, et une porte qui s'ouvre un tour plus tard clignote.
    const style = getComputedStyle(node);
    setContentWidth(
      node.clientWidth -
        parseFloat(style.paddingLeft || '0') -
        parseFloat(style.paddingRight || '0')
    );
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContentWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const layoutWideEnough = breakpointForWidth(contentWidth) !== 'compact';

  // ── Refs miroirs ─────────────────────────────────────────────────────────
  // Affectées PENDANT le rendu : les rappels ci-dessous doivent garder leur
  // identité (le contexte d'actions ne doit jamais changer de valeur, sous peine
  // de re-rendre tous les blocs), et un effet arriverait un tour trop tard.
  const canEditLayout = layoutStatus === 'ready';
  const canEditLayoutRef = useRef(canEditLayout);
  canEditLayoutRef.current = canEditLayout;
  const layoutEditingRef = useRef(layoutEditing);
  layoutEditingRef.current = layoutEditing;
  const layoutWideEnoughRef = useRef(layoutWideEnough);
  layoutWideEnoughRef.current = layoutWideEnough;
  const layoutViewIdRef = useRef(layoutViewId);
  layoutViewIdRef.current = layoutViewId;
  const liveConfigRef = useRef(liveConfig);
  liveConfigRef.current = liveConfig;
  const bandViewSlotsRef = useRef(bandViewSlots);
  bandViewSlotsRef.current = bandViewSlots;
  const storedSlotsRef = useRef(storedSlots);
  storedSlotsRef.current = storedSlots;
  const editSessionRef = useRef(editSession);
  editSessionRef.current = editSession;

  // ── Écriture ─────────────────────────────────────────────────────────────

  const layoutSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleLayoutSave = useCallback(() => {
    if (layoutSaveTimerRef.current) clearTimeout(layoutSaveTimerRef.current);
    layoutSaveTimerRef.current = setTimeout(() => {
      layoutSaveTimerRef.current = null;
      void dispatch(saveLayoutToDisk());
    }, LAYOUT_SAVE_DEBOUNCE_MS);
  }, [dispatch]);

  // Quitter le dossier ne doit pas perdre un rangement qui attendait son délai.
  useEffect(
    () => () => {
      if (layoutSaveTimerRef.current) {
        clearTimeout(layoutSaveTimerRef.current);
        layoutSaveTimerRef.current = null;
        void dispatch(saveLayoutToDisk());
      }
    },
    [dispatch]
  );

  /**
   * L'UNIQUE porte d'écriture de la mise en page du dossier.
   *
   * Trois règles y sont réunies parce qu'elles doivent tenir ENSEMBLE :
   *   1. en édition, tout va au brouillon — un seul commit à la sortie, et c'est
   *      aussi ce qui rend chaque geste annulable (`pushLayoutDraft` empile) ;
   *   2. un GESTE DE BLOC sur un bandeau HÉRITÉ fait prendre la main sur ce
   *      dossier (`takeOver`) : un menu de bloc qui ne ferait rien serait pire
   *      qu'un menu absent. Mais SEULS les gestes de blocs le font : un patch de
   *      configuration (icône, pli, affichage… et le choix de portée lui-même)
   *      pose la portée qu'il veut. Forcer « propre » sur tout commit rendait
   *      « Comme le dossier parent » inatteignable et coupait l'héritage à la
   *      première icône posée ;
   *   3. une mise en page qui ne dit plus rien RETIRE la vue au lieu d'écrire
   *      un enregistrement vide — sans quoi cinq mille dossiers finiraient par
   *      peser cinq mille entrées synchronisées.
   */
  const commitLayoutSlots = useCallback(
    (next: LayoutSlot[], opts?: { takeOver?: boolean }) => {
      const viewId = layoutViewIdRef.current;
      if (!viewId || !canEditLayoutRef.current) return;
      if (layoutEditingRef.current) {
        dispatch(pushLayoutDraft({ slots: next }));
        return;
      }
      const config = readFolderConfigFromSlots(next) ?? DEFAULT_FOLDER_CONFIG;
      const owned =
        opts?.takeOver && config.scope !== 'own'
          ? withFolderConfig(next, { ...config, scope: 'own' })
          : next;
      const ownedConfig = readFolderConfigFromSlots(owned) ?? DEFAULT_FOLDER_CONFIG;
      if (isFolderPersonalized(ownedConfig, bandSlots(owned))) {
        dispatch(setViewSlots({ viewId, slots: owned }));
      } else {
        // ⚠ La fusion étant une UNION, la vue peut revenir du nuage tant qu'un
        // autre appareil la porte : la suppression DURABLE relèverait d'une
        // pierre tombale, qui n'est pas de ce chantier. Localement, l'absence
        // est bien l'état « Comme partout ».
        dispatch(removeView(viewId));
      }
      scheduleLayoutSave();
    },
    [dispatch, scheduleLayoutSave]
  );

  /** Un correctif de configuration. `undefined` sur un champ l'efface. */
  const patchFolderConfig = useCallback(
    (patch: Partial<FolderConfig>) => {
      const config = liveConfigRef.current;
      // Toute personnalisation d'un dossier « Comme partout » lui fait prendre
      // la main : on ne peut pas poser une couverture sur le réglage global.
      const nextScope: FolderScope =
        patch.scope ?? (config.scope === 'global' ? 'own' : config.scope);
      const takingOver = nextScope === 'own' && config.scope !== 'own';
      // En prenant la main sur un bandeau hérité, on en garde une COPIE : sans
      // elle, « Propre à ce dossier » viderait le bandeau qu'on avait sous les
      // yeux à l'instant du clic. En ÉDITION, la base est le brouillon (c'est ce
      // que `bandViewSlots` porte alors) : repartir du stocké effacerait les
      // blocs rangés depuis l'entrée dans le mode.
      const base =
        takingOver || layoutEditingRef.current ? bandViewSlotsRef.current : storedSlotsRef.current;
      commitLayoutSlots(withFolderConfig(base, { ...config, ...patch, scope: nextScope }));
    },
    [commitLayoutSlots]
  );

  const handleSetFolderScope = useCallback(
    (scope: FolderScope) => {
      const viewId = layoutViewIdRef.current;
      if (!viewId || !canEditLayoutRef.current) return;
      // Changer de portée pendant une session d'édition rendrait le brouillon
      // incohérent avec ce qu'il décrit : on referme sans écrire.
      if (editSessionRef.current) dispatch(cancelLayoutEdit());
      if (scope === 'global') {
        dispatch(removeView(viewId));
        scheduleLayoutSave();
        return;
      }
      patchFolderConfig({ scope });
    },
    [dispatch, patchFolderConfig, scheduleLayoutSave]
  );

  // ── Le mode édition ──────────────────────────────────────────────────────

  const startLayoutEditing = useCallback(() => {
    const viewId = layoutViewIdRef.current;
    if (!viewId || !canEditLayoutRef.current || !layoutWideEnoughRef.current) return;
    const session = editSessionRef.current;
    if (session) {
      if (session.viewId === viewId) return;
      // Une session d'un AUTRE dossier est encore ouverte : l'explorateur n'est
      // pas remonté entre deux dossiers, donc son démontage ne l'a pas fermée.
      // On la referme comme « Terminé » l'aurait fait (elle commite SA vue),
      // puis on ouvre celle-ci — un clic muet serait pire qu'un toast tardif.
      finishLayoutEditingRef.current();
    }
    // Ranger le bandeau d'un dossier qui HÉRITE ferait modifier son parent, donc
    // douze autres dossiers, sans que rien ne le dise : le dossier prend la main
    // sur une copie de ce qu'il affichait — DANS LE BROUILLON SEULEMENT. Rien
    // n'est écrit ni sauvegardé ici : « Terminé » sans geste, Échap, la fenêtre
    // qui rétrécit laissent le dossier exactement comme il était (« comme le
    // parent » reste « comme le parent »). La `baseline` est ce qui est
    // réellement STOCKÉ : c'est ce que le « Annuler » du toast restaurera.
    const owned = withFolderConfig(bandViewSlotsRef.current, {
      ...liveConfigRef.current,
      scope: 'own',
    });
    dispatch(beginLayoutEdit({ viewId, slots: owned, baseline: storedSlotsRef.current }));
  }, [dispatch]);

  const layoutCommitTraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Sortir. UN SEUL COMMIT pour toute la session, et un toast qui laisse huit
   * secondes pour se rétracter. Le commit est sauté quand rien n'a changé :
   * ouvrir, regarder et refermer ne doit pas redater la vue — une horloge neuve
   * pousse un cycle de synchronisation à tous les appareils pour décrire une
   * disposition rigoureusement identique.
   */
  const finishLayoutEditing = useCallback(() => {
    const session = editSessionRef.current;
    if (!session) return;
    // La session peut être celle d'un AUTRE dossier (voir `startLayoutEditing`)
    // — jamais celle de l'accueil, qui se referme à son propre démontage. Ce qui
    // suit n'ajoute un emplacement réservé qu'à une vue de dossier.
    const isFolderSession = session.viewId.startsWith(FOLDER_VIEW_PREFIX);

    // AUCUN GESTE, AUCUNE ÉCRITURE. `past` vide dit que le brouillon est encore
    // la copie d'entrée (chaque pas l'empile, chaque annulation le vide) : ouvrir
    // l'éditeur d'un dossier qui hérite, regarder, refermer, le laisse « comme
    // le parent » — la prise de main ne vivait que dans le brouillon.
    if (
      session.past.length === 0 ||
      JSON.stringify(session.slots) === JSON.stringify(session.baseline)
    ) {
      dispatch(cancelLayoutEdit());
      return;
    }

    let finalSlots = session.slots;
    if (isFolderSession) {
      // CEINTURE : un chemin qui remplacerait le brouillon en bloc (le sélecteur
      // de modèles d'accueil l'a fait) emporterait l'emplacement réservé, donc
      // l'icône, la couverture et la note d'accueil. On le refabrique depuis le
      // stocké plutôt que de commiter un dossier amputé.
      finalSlots = ensureFolderConfig(finalSlots, session.baseline);
      // Un bandeau qu'on vient de garnir se DÉPLIE : sinon on sort du mode sur
      // un dossier qui a l'air exactement comme avant, et le travail semble
      // perdu.
      const config = readFolderConfigFromSlots(finalSlots) ?? DEFAULT_FOLDER_CONFIG;
      if (bandSlots(finalSlots).length > 0 && config.bandCollapsed !== false) {
        finalSlots = withFolderConfig(finalSlots, { ...config, bandCollapsed: false });
      }
    }
    if (finalSlots !== session.slots) dispatch(pushLayoutDraft({ slots: finalSlots }));

    dispatch(commitLayoutEdit());
    void dispatch(saveLayoutToDisk());

    // Ce que « Annuler » doit rendre : la `baseline` est le STOCKÉ d'avant la
    // session. Si ce stocké ne disait rien (dossier « comme partout »),
    // restaurer une vue vide en écrirait une — l'absence est alors l'état à
    // rendre, et la vue est retirée.
    const revertViewId = session.viewId;
    const baselineConfig = readFolderConfigFromSlots(session.baseline);
    const baselineWritten =
      !isFolderSession ||
      (baselineConfig !== null &&
        isFolderPersonalized(baselineConfig, bandSlots(session.baseline)));

    // L'identifiant du toast est capturé par un objet et non par la variable
    // elle-même : le rappel est construit AVANT que `notify` ne rende sa valeur.
    const handle: { id: string | null } = { id: null };
    handle.id = notify({
      type: 'success',
      message: t('folder.customize.saved', 'Dossier enregistré'),
      duration: LAYOUT_SAVED_TOAST_MS,
      action: {
        label: t('home.customize.undoSave', 'Annuler'),
        onClick: () => {
          dispatch(revertLayoutCommit());
          if (!baselineWritten) dispatch(removeView(revertViewId));
          void dispatch(saveLayoutToDisk());
          if (handle.id) dismiss(handle.id);
        },
      },
    });

    // La trace ne survit pas au toast : un « Annuler » resté armé
    // ressusciterait, dix minutes plus tard, une disposition retravaillée depuis
    // — voire une que la fusion a remplacée.
    if (layoutCommitTraceTimerRef.current) clearTimeout(layoutCommitTraceTimerRef.current);
    layoutCommitTraceTimerRef.current = setTimeout(() => {
      layoutCommitTraceTimerRef.current = null;
      dispatch(clearLayoutCommit());
    }, LAYOUT_SAVED_TOAST_MS);
  }, [dispatch, notify, dismiss, t]);

  /**
   * Les deux fermetures forcées. Le document qui redevient provisoire ABANDONNE
   * (il n'y a plus de disposition sûre à écrire par-dessus) ; la fenêtre qui
   * rétrécit, elle, COMMITE — le travail est fait.
   */
  useEffect(() => {
    if (!layoutEditing) return;
    if (!canEditLayout) {
      dispatch(cancelLayoutEdit());
      return;
    }
    if (!layoutWideEnough) finishLayoutEditing();
  }, [layoutEditing, canEditLayout, layoutWideEnough, dispatch, finishLayoutEditing]);

  // Quitter le dossier en pleine édition ne doit pas perdre le rangement : c'est
  // la même sortie que « Terminé », déclenchée par le démontage.
  const finishLayoutEditingRef = useRef(finishLayoutEditing);
  finishLayoutEditingRef.current = finishLayoutEditing;
  useEffect(
    () => () => {
      if (layoutCommitTraceTimerRef.current) {
        clearTimeout(layoutCommitTraceTimerRef.current);
        layoutCommitTraceTimerRef.current = null;
      }
      if (editSessionRef.current) finishLayoutEditingRef.current();
    },
    []
  );

  // Changer de dossier SANS démontage (la route change la prop `folderId`, pas
  // l'instance) : la session du dossier quitté est refermée comme au démontage.
  // Sans quoi elle restait ouverte, « Modifier le bandeau » sur le nouveau
  // dossier devenait un clic muet, et le brouillon du précédent n'était commité
  // qu'en quittant l'explorateur — par un toast surgi sans rapport.
  useEffect(() => {
    const session = editSessionRef.current;
    if (session && session.viewId !== layoutViewId) finishLayoutEditingRef.current();
  }, [layoutViewId]);

  /**
   * Ctrl+Z / Ctrl+Maj+Z, et SEULEMENT en édition. Hors du mode, ces touches
   * appartiennent au reste du produit : les capter en permanence ferait de la
   * vue dossier un voleur de raccourcis.
   */
  useEffect(() => {
    if (!layoutEditing) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.key.toLowerCase() !== 'z') return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      event.preventDefault();
      dispatch(event.shiftKey ? redoLayoutDraft() : undoLayoutDraft());
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [layoutEditing, dispatch]);

  // ── La note d'accueil ────────────────────────────────────────────────────

  const handleOpenReadme = useCallback(() => {
    const noteId = liveConfigRef.current.readmeNoteId;
    if (noteId) navigate(`/notes?noteId=${noteId}`);
  }, [navigate]);

  const handleAddReadme = useCallback(async () => {
    if (!folderId) return;
    try {
      const created = await dispatch(createNewNote({ parentId: folderId })).unwrap();
      if (!created?.id) return;
      patchFolderConfig({ readmeNoteId: created.id, readmeCollapsed: false });
      navigate(`/notes?noteId=${created.id}`);
    } catch {
      error(t('folder.readme.createError', 'Impossible de créer la description'));
    }
  }, [folderId, dispatch, patchFolderConfig, navigate, error, t]);

  // Détacher n'efface PAS la note : elle reste dans le dossier, avec son
  // contenu. « Retirer » ne doit jamais vouloir dire « supprimer ».
  const handleDetachReadme = useCallback(
    () => patchFolderConfig({ readmeNoteId: undefined, readmeCollapsed: undefined }),
    [patchFolderConfig]
  );

  const handleToggleReadme = useCallback(
    () => patchFolderConfig({ readmeCollapsed: !liveConfigRef.current.readmeCollapsed }),
    [patchFolderConfig]
  );

  const bandCollapsed = resolvedLayout?.bandCollapsed ?? true;
  const bandCollapsedRef = useRef(bandCollapsed);
  bandCollapsedRef.current = bandCollapsed;
  const handleToggleBand = useCallback(
    () => patchFolderConfig({ bandCollapsed: !bandCollapsedRef.current }),
    [patchFolderConfig]
  );

  // ── Les préférences d'affichage, surchargées par dossier ─────────────────
  //
  // ── POURQUOI LE DOSSIER EMPRUNTE LES RÉGLAGES GLOBAUX ────────────────────
  //
  // La barre de tri/groupement/vue lit et écrit l'état GLOBAL de l'interface.
  // Deux vérités concurrentes (la barre qui montre les réglages de partout, la
  // liste qui obéit à ceux du dossier) donneraient un écran qui se contredit
  // lui-même. À l'entrée d'un dossier surchargé, ses réglages sont donc POSÉS
  // dans l'état global — la barre dit alors vrai, et tout geste fait dessus est
  // recapturé dans le dossier. À la sortie, les réglages d'avant sont remis.
  //
  // ⚠ Limite assumée : si l'application est tuée pendant qu'un tel dossier est
  // ouvert, les réglages globaux restent sur ceux du dossier. Ce sont des
  // préférences d'affichage, pas des données, et elles viennent du même
  // utilisateur — le prix est très inférieur à celui d'une barre menteuse.

  const displayOverride = resolvedLayout?.display ?? null;
  const hasDisplayOverride = displayOverride !== null;
  const displayOverrideRef = useRef(displayOverride);
  displayOverrideRef.current = displayOverride;

  const uiDisplayRef = useRef({ viewMode, sortBy, sortOrder, groupBy });
  uiDisplayRef.current = { viewMode, sortBy, sortOrder, groupBy };

  /** Faux tant que la barre n'a pas encore adopté les réglages du dossier. */
  const displaySyncedRef = useRef(false);

  useEffect(() => {
    if (!hasDisplayOverride || !folderId) return;
    const baseline = uiDisplayRef.current;
    const target = displayOverrideRef.current;
    if (!target) return;
    displaySyncedRef.current = false;
    dispatch(setViewMode(target.viewMode));
    dispatch(setSortBy({ field: target.sortField, order: target.sortOrder }));
    dispatch(setGroupBy({ field: target.groupField, enabled: target.groupEnabled }));
    return () => {
      displaySyncedRef.current = false;
      dispatch(setViewMode(baseline.viewMode));
      dispatch(setSortBy({ field: baseline.sortBy, order: baseline.sortOrder }));
      dispatch(setGroupBy({ field: baseline.groupBy.field, enabled: baseline.groupBy.enabled }));
    };
    // Les VALEURS n'y figurent pas, seulement l'existence de la surcharge : les
    // y mettre relancerait cet effet à chaque geste fait dans la barre, donc
    // reposerait les réglages du dossier par-dessus le geste qu'on vient de
    // faire — la barre deviendrait impossible à utiliser.
  }, [hasDisplayOverride, folderId, dispatch]);

  useEffect(() => {
    if (!hasDisplayOverride) return;
    const target = displayOverrideRef.current;
    if (!target) return;
    const matches =
      target.viewMode === viewMode &&
      target.sortField === sortBy &&
      target.sortOrder === sortOrder &&
      target.groupField === groupBy.field &&
      target.groupEnabled === groupBy.enabled;
    // Tant que la pose n'a pas eu lieu, la barre montre encore les réglages de
    // partout : les recapturer ici écraserait ceux du dossier par ceux qu'il
    // était justement en train de remplacer.
    if (!displaySyncedRef.current) {
      if (matches) displaySyncedRef.current = true;
      return;
    }
    if (matches) return;
    // On ne recapture que dans un dossier qui a SON affichage. En portée « comme
    // le parent » sans affichage propre, la surcharge vient de l'ancêtre : y
    // répondre en écrivant ici un affichage que personne n'a demandé ferait un
    // dossier qui change de tri tout seul.
    if (liveConfigRef.current.display === undefined) return;
    patchFolderConfig({
      display: {
        viewMode,
        sortField: sortBy,
        sortOrder,
        groupField: groupBy.field,
        groupEnabled: groupBy.enabled,
      },
    });
  }, [hasDisplayOverride, viewMode, sortBy, sortOrder, groupBy, patchFolderConfig]);

  const handleToggleDisplayOverride = useCallback(() => {
    // Le PROPRE, pas le résolu : décocher un affichage hérité de l'ancêtre
    // n'effacerait rien ici et laisserait la coche allumée.
    if (liveConfigRef.current.display !== undefined) {
      patchFolderConfig({ display: undefined });
      return;
    }
    const current = uiDisplayRef.current;
    patchFolderConfig({
      display: {
        viewMode: current.viewMode,
        sortField: current.sortBy,
        sortOrder: current.sortOrder,
        groupField: current.groupBy.field,
        groupEnabled: current.groupBy.enabled,
      },
    });
  }, [patchFolderConfig]);

  // ── Les actions vues par les blocs ───────────────────────────────────────
  //
  // Même contrat que l'accueil : la valeur du contexte ne change JAMAIS
  // d'identité (un contexte re-rend TOUS ses consommateurs à chaque nouvelle
  // valeur, que `React.memo` le veuille ou non), et ce qui varie est lu par une
  // ref rafraîchie à chaque rendu.

  const liveFolderActions = {
    openNote: (noteId: string) => navigate(`/notes?noteId=${noteId}`),
    openNotes: () => navigate('/notes'),
    openBoard: () => navigate('/board'),
    openFolder: (targetId: string) => navigate(`/folder/${targetId}`),
    openVault: (vaultId: string, itemId?: string) =>
      navigate(vaultFolderRoute(vaultId, { itemId })),
    showDetails: (item: Item) => setDetailsPanelItem(item),
    folderContextMenu: handleFolderContextMenu,
    createFolder: handleCreateFolder,
    // Les deux boîtes « coffre » (création derrière le gate de paire de clés,
    // saisie d'un code d'invitation) vivent au niveau de la PAGE d'accueil ;
    // un bandeau de dossier ne les héberge pas. On y renvoie plutôt que de
    // rendre muettes deux entrées que le bloc affiche — même repli que
    // « note du jour » → Notes.
    createVault: () => navigate('/'),
    enterInviteCode: () => navigate('/'),
    // Les GESTES DE BLOCS prennent la main sur un bandeau hérité (`takeOver`) :
    // `bandViewSlots` porte déjà la copie de ce bandeau, elle devient propre.
    setSlotSize: (slotId: string, size: Parameters<HomeActions['setSlotSize']>[1]) => {
      const spec = gridSize(size);
      commitLayoutSlots(
        bandViewSlotsRef.current.map((slot) =>
          slot.id === slotId ? { ...slot, w: spec.w, h: spec.h } : slot
        ),
        { takeOver: true }
      );
    },
    removeSlot: (slotId: string) =>
      commitLayoutSlots(
        bandViewSlotsRef.current.filter((slot) => slot.id !== slotId),
        { takeOver: true }
      ),
    setSlotOption: (slotId: string, key: string, value: unknown) =>
      commitLayoutSlots(
        bandViewSlotsRef.current.map((slot) =>
          slot.id === slotId
            ? { ...slot, options: { ...(slot.options ?? {}), [key]: value } }
            : slot
        ),
        { takeOver: true }
      ),
    startEditing: startLayoutEditing,
    finishEditing: finishLayoutEditing,
  };
  const liveFolderActionsRef = useRef(liveFolderActions);
  liveFolderActionsRef.current = liveFolderActions;

  const folderWidgetActions = useMemo<HomeActions>(
    () => ({
      openNote: (noteId) => liveFolderActionsRef.current.openNote(noteId),
      openFolder: (targetId) => liveFolderActionsRef.current.openFolder(targetId),
      openVault: (vaultId, itemId) => liveFolderActionsRef.current.openVault(vaultId, itemId),
      seeAllUnfiled: () => liveFolderActionsRef.current.openNotes(),
      seeAllNotes: () => liveFolderActionsRef.current.openNotes(),
      openNotesBoard: () => liveFolderActionsRef.current.openBoard(),
      // Le calendrier de l'accueil crée la note du jour ; ici, on se contente
      // d'ouvrir la section Notes — fabriquer une note quotidienne depuis un
      // bandeau de dossier la rangerait à la racine, ce que personne n'a demandé.
      openDailyNote: () => liveFolderActionsRef.current.openNotes(),
      folderContextMenu: (event, target) =>
        liveFolderActionsRef.current.folderContextMenu(
          event as React.MouseEvent<HTMLDivElement>,
          target
        ),
      // Un bandeau de dossier ne porte pas de carte de coffre : l'entrée existe
      // parce que le contrat est partagé avec l'accueil, elle ne mène nulle part
      // ici. Elle ne LÈVE pas pour autant — un widget qu'on poserait par
      // curiosité ne doit pas casser l'écran.
      vaultContextMenu: () => undefined,
      createFolder: () => liveFolderActionsRef.current.createFolder(),
      createVault: () => liveFolderActionsRef.current.createVault(),
      enterInviteCode: () => liveFolderActionsRef.current.enterInviteCode(),
      showDetails: (item) => liveFolderActionsRef.current.showDetails(item),
      // Le glisser-déposer appartient à la LISTE, pas au bandeau : aucun bloc
      // d'ici n'est une cible de dépôt.
      dragStart: () => undefined,
      dragEnd: () => undefined,
      dragOver: () => undefined,
      dragEnter: () => undefined,
      dragLeave: () => undefined,
      drop: () => undefined,
      setEditing: (on) =>
        on
          ? liveFolderActionsRef.current.startEditing()
          : liveFolderActionsRef.current.finishEditing(),
      setSlotSize: (slotId, size) => liveFolderActionsRef.current.setSlotSize(slotId, size),
      removeSlot: (slotId) => liveFolderActionsRef.current.removeSlot(slotId),
      setSlotOption: (slotId, key, value) =>
        liveFolderActionsRef.current.setSlotOption(slotId, key, value),
    }),
    []
  );

  /**
   * L'état volatil du glisser-déposer de l'accueil. Il est FIGÉ ici : aucun bloc
   * du bandeau n'est une cible de dépôt. Il n'existe que parce que le bloc
   * « Tous les dossiers », qu'on peut poser partout, le réclame — sans lui il
   * lèverait au montage.
   */
  const folderWidgetGridState = useMemo<HomeGridState>(
    () => ({
      draggedItem: null,
      dropTarget: null,
      springTarget: null,
      pendingMove: null,
      passwordVersion: 0,
    }),
    []
  );

  const folderWidgetScope = useMemo(
    () => (folderId ? { folderId, folderName: folder.name } : null),
    [folderId, folder.name]
  );

  /** La porte d'écriture du bandeau : un geste de bloc, donc une prise de main. */
  const handleBandCommit = useCallback(
    (next: LayoutSlot[]) => commitLayoutSlots(next, { takeOver: true }),
    [commitLayoutSlots]
  );

  // ── Ce qui s'affiche ─────────────────────────────────────────────────────

  const hasCover = !!liveConfig.coverPresetId || !!liveConfig.coverImage;
  // Un dossier « Propre à ce dossier » sans icône ni couverture RESTE une liste
  // de fichiers : l’en-tête façon page (icône vide en pointillés, « Ajouter une
  // couverture ») ne se montre que s’il a quelque chose à montrer, en édition de
  // bandeau, ou quand l’utilisateur vient de le demander depuis le menu ⋮. Sans
  // cette garde, choisir un affichage propre transformait le dossier en note.
  const [headerRequested, setHeaderRequested] = useState(false);
  useEffect(() => {
    setHeaderRequested(false);
  }, [folderId]);
  // L’édition du bandeau n’affiche PAS l’en-tête : elle range des blocs, pas une
  // icône. L’icône et la couverture ont leur propre entrée de menu.
  const showFolderHeader = headerRequested || !!liveConfig.icon || hasCover;
  const showFolderBand = layoutEditing || liveBand.length > 0;

  // Calcul des statistiques
  const totalSize = useMemo(() => {
    return items.reduce((sum, item) => sum + (('size' in item ? item.size : 0) || 0), 0);
  }, [items]);

  const formatTotalSize = useCallback((bytes: number): string => {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  }, []);

  // Single source of truth for a file card, reused across grid, list and groups.
  const renderFileCard = (item: Item) => (
    <FileCard
      key={item.id}
      item={item}
      folderId={folderId}
      isSelected={selectedItemsSet.has(item.id)}
      onSelect={handleSelectItem}
      onItemClick={handleItemClick}
      onItemDoubleClick={handleItemDoubleClick}
      onContextMenu={handleItemContextMenu}
      viewMode={viewMode}
      onDragStart={handleDragStart}
      onDragPrewarm={prewarmNativeDrag}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDropForCurrentFolder}
      isDraggedOver={dropTarget === item.id}
      isDragging={draggedItem?.id === item.id}
      // Cette section ne liste que des fichiers (les dossiers passent par
      // SubfolderCard) : la condition n'est jamais vraie ici. On la pose quand
      // même pour que la carte soit complète partout où elle sera réemployée.
      isSpringTarget={springTarget === item.id}
      isMoving={pendingMove?.itemId === item.id}
      tags={resolvedTagsMap[item.id] || EMPTY_TAGS}
      hasReminder={itemsWithReminders.has(item.id)}
      isItemProtected={protectionStatusMap.get(item.id)?.isProtected ?? false}
      isItemUnlocked={protectionStatusMap.get(item.id)?.isUnlocked ?? false}
      shortcut={shortcutProps.get(item.id)}
    />
  );

  // h-full et non h-screen : la vue vit dans `.layout__content`, qui mesure déjà
  // 100vh − 64px de barre d'en-tête — h-screen rognait le bas d'autant.
  return (
    <div className="flex flex-col h-full bg-[var(--color-background-secondary)] overflow-hidden">
      {/* ===== Header ===== */}
      <ExplorerHeader
        onBack={() => (folder.parentId ? navigate(`/folder/${folder.parentId}`) : navigate('/'))}
        backLabel={t('common.back', 'Retour')}
        onBackDragOver={handleBackDragOver}
        onBackDragLeave={handleBackDragLeave}
        onBackDrop={handleBackDrop}
        backDropActive={backDropActive}
        breadcrumb={
          <Breadcrumb
            folderId={folderId!}
            onDropOnSegment={handleDropOnSegment}
            onDropOnRoot={handleDropOnRoot}
          />
        }
        actions={
          <>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<UploadIcon />}
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.multiple = true;
                input.onchange = (e: Event) => {
                  const target = e.target as HTMLInputElement;
                  const files = Array.from(target.files ?? []);
                  if (files.length > 0) startImport(files);
                };
                input.click();
              }}
            >
              {t('file.upload', 'Upload')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<FolderPlusIcon />}
              onClick={handleCreateFolder}
            >
              {t('home.newFolder', 'Nouveau dossier')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="12" y1="18" x2="12" y2="12" />
                  <line x1="9" y1="15" x2="15" y2="15" />
                </svg>
              }
              onClick={async () => {
                const result = await dispatch(createNewNote({ parentId: folderId })).unwrap();
                if (result?.id) {
                  navigate(`/notes?noteId=${result.id}`);
                }
              }}
            >
              {t('folder.newNote', 'Nouvelle note')}
            </Button>
            {/* « Nouveau document » — un format par greffon d'édition enregistré.
              Sans ce geste, un éditeur installé restait inatteignable dans
              l'espace personnel : rien n'y créait jamais un `.fdoc`. */}
            <Dropdown
              position="bottom-right"
              trigger={
                <Button variant="secondary" size="sm" leftIcon={<DocumentPlusIcon />}>
                  {t('folder.newDocument', 'Nouveau document')}
                </Button>
              }
              items={
                documentFormats.length === 0
                  ? [
                      {
                        label: t('folder.noEditorInstalled', "Aucun greffon d'édition installé."),
                        disabled: true,
                      },
                    ]
                  : documentFormats.map((f) => ({
                      label: `${f.label} (.${f.ext})`,
                      onClick: () => setNewDocSpec(f),
                    }))
              }
            />
            {imageFiles.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setGalleryInitialIndex(0);
                  setGalleryOpen(true);
                }}
              >
                Galerie ({imageFiles.length})
              </Button>
            )}
            {/* LA porte de la personnalisation. Elle est ici, dans une barre
                d'actions qui existait déjà, parce que c'est la seule place qui
                ne déplace rien : un en-tête rétractable au-dessus de la liste
                aurait poussé le premier fichier vers le bas dans les milliers de
                dossiers que personne ne personnalisera jamais. */}
            <FolderLayoutMenu
              // En édition, le brouillon dit « propre » (c'est la copie prise en
              // main) ; la portée que le menu coche est celle qui est ÉCRITE.
              scope={layoutEditing ? (resolvedLayout?.scope ?? 'global') : liveConfig.scope}
              canEdit={canEditLayout}
              wideEnough={layoutWideEnough}
              editing={layoutEditing}
              hasReadme={!!liveConfig.readmeNoteId}
              hasBand={liveBand.length > 0}
              bandCollapsed={bandCollapsed}
              hasOwnDisplay={liveConfig.display !== undefined}
              inheritedFromName={inheritedFromName}
              onSetScope={handleSetFolderScope}
              onAddReadme={() => void handleAddReadme()}
              onAddHeader={showFolderHeader ? undefined : () => setHeaderRequested(true)}
              onStyleFolder={() => setFolderStyleTarget(folder)}
              onOpenReadme={handleOpenReadme}
              onDetachReadme={handleDetachReadme}
              onToggleBand={handleToggleBand}
              onStartEditing={startLayoutEditing}
              onFinishEditing={finishLayoutEditing}
              onToggleDisplayOverride={handleToggleDisplayOverride}
            />
          </>
        }
      />

      {/* ===== Toolbar ===== */}
      <SortGroupBar searchQuery={searchQuery} onSearchChange={setSearchQuery} />

      {/* ===== Étiquettes du dossier =====
          La barre N'EXISTE PAS quand rien n'est étiqueté : une rangée vide,
          permanente, apprendrait à ne plus la regarder. */}
      {tagChips.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap px-6 pt-3">
          {tagChips.map((chip) => {
            const actif = activeTag === chip.tag;
            return (
              <button
                key={chip.tag}
                type="button"
                // Recliquer la pastille active RELÂCHE le filtre : c'est le
                // seul geste que quelqu'un tente quand il ne trouve pas de
                // bouton « tout ».
                onClick={() => setActiveTag(actif ? null : chip.tag)}
                aria-pressed={actif}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                  border transition-colors cursor-pointer
                  ${
                    actif
                      ? 'bg-[var(--color-primary-500)] border-[var(--color-primary-500)] text-white'
                      : `bg-[var(--color-surface)] border-[var(--color-border)]
                         text-[var(--color-text-secondary)] hover:border-[var(--color-primary-300)]`
                  }`}
              >
                <span>#{chip.tag}</span>
                <span className="tabular-nums opacity-70">{chip.count}</span>
              </button>
            );
          })}
          {activeTag && (
            <button
              type="button"
              onClick={() => setActiveTag(null)}
              className="px-2 py-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]
                border-none bg-transparent cursor-pointer"
            >
              {t('folder.tags.clearFilter', 'Toutes')}
            </button>
          )}
        </div>
      )}

      {/* ===== Content area ===== */}
      <div className="flex flex-1 min-h-0">
        <div
          ref={contentContainerRef}
          className={`flex-1 overflow-y-auto px-6 py-6 relative
          ${dragActive ? 'bg-[var(--color-primary-50)]' : ''}`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onMouseDown={rubberBandHandlers.onMouseDown}
          onContextMenu={(e) => {
            // Clic droit sur la ZONE VIDE uniquement : les cartes d'items ont
            // leur propre menu (openContextMenu fait preventDefault) — s'il a
            // déjà été consommé, ne pas l'écraser.
            if (e.defaultPrevented) return;
            openContextMenu(
              e,
              buildBackgroundContextMenu(
                { newFolder: true, addFiles: true, protectFiles: true, protectFolder: true },
                {
                  onNewFolder: handleCreateFolder,
                  onAddFiles: () => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.multiple = true;
                    input.onchange = (ev: Event) => {
                      const target = ev.target as HTMLInputElement;
                      const files = Array.from(target.files ?? []);
                      if (files.length > 0) startImport(files);
                    };
                    input.click();
                  },
                  onProtectFiles: () => void pickAndProtectInPlace(false),
                  onProtectFolder: () => void pickAndProtectInPlace(true),
                },
                t
              )
            );
          }}
        >
          {/* ===== La personnalisation du dossier =====
              AU-DESSUS de la liste, jamais à sa place, et rendue seulement si
              le dossier a effectivement quelque chose à montrer : un dossier
              « Comme partout » ne monte aucun de ces trois éléments et reste
              rigoureusement identique à ce qu'il était. Elle est DEHORS du test
              « dossier vide » : un dossier sans fichier garde sa couverture et
              sa description — c'est même là qu'elles servent le plus. */}
          {folderWidgetScope && (showFolderHeader || liveConfig.readmeNoteId || showFolderBand) && (
            <FolderWidgetScopeProvider value={folderWidgetScope}>
              <HomeActionsProvider value={folderWidgetActions}>
                <HomeGridStateProvider value={folderWidgetGridState}>
                  {showFolderHeader && (
                    <FolderHeader
                      folderName={folder.name}
                      config={liveConfig}
                      onChange={patchFolderConfig}
                      readOnly={!canEditLayout}
                    />
                  )}

                  {liveConfig.readmeNoteId && (
                    <FolderReadme
                      noteId={liveConfig.readmeNoteId}
                      collapsed={liveConfig.readmeCollapsed === true}
                      onToggleCollapsed={handleToggleReadme}
                      onOpen={handleOpenReadme}
                      onDetach={handleDetachReadme}
                    />
                  )}

                  {showFolderBand && layoutViewId && (
                    <FolderWidgetBand
                      viewId={layoutViewId}
                      slots={bandViewSlots}
                      editing={layoutEditing}
                      collapsed={bandCollapsed}
                      onToggleCollapsed={handleToggleBand}
                      inheritedFromName={inheritedFromName}
                      onCommit={handleBandCommit}
                      onFinishEditing={finishLayoutEditing}
                    />
                  )}
                </HomeGridStateProvider>
              </HomeActionsProvider>
            </FolderWidgetScopeProvider>
          )}

          {filteredAndSortedItems.length === 0 ? (
            /* Empty state */
            <div
              className="flex flex-col items-center justify-center py-20 text-center
            bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-sm"
            >
              <div className="w-24 h-24 rounded-full bg-[var(--color-primary-50)] flex items-center justify-center mb-6">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1}
                  stroke="var(--color-primary-400)"
                  className="w-12 h-12"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                  />
                </svg>
              </div>
              <h2 className="text-lg font-medium text-[var(--color-text-primary)] mb-2">
                {searchQuery
                  ? t('folder.noResults', 'Aucun resultat')
                  : t('home.emptyTitle', 'Ce dossier est vide')}
              </h2>
              <p className="text-sm text-[var(--color-text-secondary)] max-w-md mb-6">
                {searchQuery
                  ? t('folder.tryAnotherSearch', 'Essayez une autre recherche')
                  : t('folder.emptyHint', 'Uploadez des fichiers ou creez un nouveau dossier')}
              </p>
              {!searchQuery && (
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<UploadIcon />}
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.multiple = true;
                    input.onchange = (e: Event) => {
                      const target = e.target as HTMLInputElement;
                      const files = Array.from(target.files ?? []);
                      if (files.length > 0) startImport(files);
                    };
                    input.click();
                  }}
                >
                  Ajouter un fichier
                </Button>
              )}
            </div>
          ) : (
            <>
              {/* ===== Subfolders section ===== */}
              {subfolders.length > 0 && (
                <section className="mb-6">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-3 flex items-center gap-2">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                      className="w-4 h-4"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                      />
                    </svg>
                    {t('settings.folders', 'Dossiers')}
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {subfolders.map((subfolder) => (
                      <SubfolderCard
                        key={subfolder.id}
                        subfolder={subfolder}
                        onItemClick={handleItemClick}
                        onContextMenu={handleItemContextMenu}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                        onDragOver={handleDragOver}
                        onDragEnter={handleDragEnter}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDropForCurrentFolder}
                        isDropTarget={dropTarget === subfolder.id}
                        isDragging={draggedItem?.id === subfolder.id}
                        isSpringTarget={springTarget === subfolder.id}
                        isMoving={pendingMove?.itemId === subfolder.id}
                        protectionStatus={protectionStatusMap.get(subfolder.id)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* ===== Files section ===== */}
              {files.length > 0 && (
                <section>
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-3 flex items-center gap-2">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                      className="w-4 h-4"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                      />
                    </svg>
                    {t('settings.files', 'Fichiers')}
                  </h2>
                  {viewMode === 'grid' ? (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
                      {fileGroups.map((g) => (
                        <React.Fragment key={g.key}>
                          {g.label && (
                            <div className="col-span-full mt-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] first:mt-0">
                              <span>{g.label}</span>
                              <span className="font-normal normal-case opacity-70">
                                {g.items.length}
                              </span>
                            </div>
                          )}
                          {g.items.map(renderFileCard)}
                        </React.Fragment>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col rounded-xl border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)] shadow-sm">
                      {/* List header */}
                      <div
                        className="grid grid-cols-[40px_40px_1fr_100px_160px_48px] items-center px-4 py-2.5
                      bg-[var(--color-background-secondary)] border-b border-[var(--color-border)]
                      text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider"
                      >
                        <div>
                          <input
                            type="checkbox"
                            checked={selectedItems.length === files.length && files.length > 0}
                            onChange={handleSelectAll}
                            className="w-4 h-4 cursor-pointer accent-[var(--color-primary-600)]"
                          />
                        </div>
                        <div></div>
                        <button
                          type="button"
                          onClick={() => handleHeaderSort('name')}
                          className="flex items-center gap-1 text-left uppercase tracking-wider hover:text-[var(--color-text-secondary)] transition-colors"
                        >
                          Nom
                          {sortBy === 'name' && <span>{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleHeaderSort('size')}
                          className="flex items-center gap-1 text-left uppercase tracking-wider hover:text-[var(--color-text-secondary)] transition-colors"
                        >
                          Taille
                          {sortBy === 'size' && <span>{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleHeaderSort('date')}
                          className="flex items-center gap-1 text-left uppercase tracking-wider hover:text-[var(--color-text-secondary)] transition-colors"
                        >
                          Modifie
                          {sortBy === 'date' && <span>{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                        </button>
                        <div></div>
                      </div>
                      {fileGroups.map((g) => (
                        <React.Fragment key={g.key}>
                          {g.label && (
                            <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-background-secondary)] border-b border-[var(--color-border)] text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
                              <span>{g.label}</span>
                              <span className="font-normal normal-case opacity-70">
                                {g.items.length}
                              </span>
                            </div>
                          )}
                          {g.items.map(renderFileCard)}
                        </React.Fragment>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </>
          )}

          {folderNotes.length > 0 && (
            <section className="mt-6">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-secondary)] mb-3 px-1">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" />
                  <polyline points="14,2 14,8 20,8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
                Notes ({folderNotes.length})
              </h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
                {folderNotes.map((note) => (
                  <NoteEmbedCard key={note.id} note={note} />
                ))}
              </div>
            </section>
          )}

          {/* Drop overlay */}
          {dragActive && (
            <div
              className="absolute inset-4 flex items-center justify-center
            bg-[var(--color-primary-50)]/80 border-3 border-dashed border-[var(--color-primary-400)]
            rounded-2xl pointer-events-none z-10 backdrop-blur-sm"
            >
              <div className="flex flex-col items-center gap-4 p-8 bg-[var(--color-surface)] rounded-xl shadow-xl">
                <div className="text-[var(--color-primary-500)]">
                  <UploadIcon />
                </div>
                <p className="text-base font-semibold text-[var(--color-text-primary)]">
                  {t('file.drag_drop', 'Deposez vos fichiers ici')}
                </p>
              </div>
            </div>
          )}

          {/* ===== Batch Action Toolbar (floating sticky) ===== */}
          <BatchActionToolbar
            selectedCount={selectedItems.length}
            totalCount={filteredAndSortedItems.length}
            onSelectAll={handleBatchSelectAll}
            onDeselectAll={handleBatchDeselectAll}
            onDelete={handleDelete}
            onMove={handleBatchMove}
            onCopy={handleBatchCopy}
            onDownload={handleDownloadMultiple}
            onAddToFavorites={handleBatchAddToFavorites}
          />

          {/* Rubber-band selection rectangle (styled via direct DOM manipulation by the hook) */}
          <div
            ref={rubberBandRectRef}
            className="absolute border-2 border-[var(--color-primary-400)] pointer-events-none z-20 rounded-sm"
            style={{
              display: 'none',
              left: 0,
              top: 0,
              willChange: 'transform, width, height',
              backgroundColor: 'var(--color-primary-400)',
              opacity: 0.1,
            }}
          />
        </div>

        {/* ===== Details Panel ===== */}
        {detailsPanelItem && (
          <FileDetailsPanel
            item={detailsPanelItem}
            folderId={folderId || ''}
            onClose={() => setDetailsPanelItem(null)}
            folder={folder}
            tags={resolvedTagsMap[detailsPanelItem.id] || []}
            shortcut={shortcutProps.get(detailsPanelItem.id)}
            onOpenInVault={() => {
              const ref = vaultRefOf(detailsPanelItem);
              if (ref) openShortcut(detailsPanelItem, ref);
            }}
          />
        )}
      </div>

      {/* ===== Footer ===== */}
      <div className="flex items-center justify-between h-10 px-6 bg-[var(--color-surface)] border-t border-[var(--color-border)] shrink-0">
        <span className="text-xs text-[var(--color-text-tertiary)]">
          {filteredAndSortedItems.length} element{filteredAndSortedItems.length > 1 ? 's' : ''}
        </span>
        {isCloud &&
          storageLimit > 0 &&
          (() => {
            const percent = Math.round((storageUsed / storageLimit) * 100);
            const color =
              percent > 90 ? '#ef4444' : percent > 80 ? '#f97316' : 'var(--color-text-tertiary)';
            return (
              <span
                className="text-xs flex items-center gap-1.5"
                style={{ color }}
                title={`${percent}% du stockage de votre compte utilisé`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-3.5 h-3.5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z"
                  />
                </svg>
                {formatTotalSize(storageUsed)} / {formatTotalSize(storageLimit)}
              </span>
            );
          })()}
        <span className="text-xs text-[var(--color-text-tertiary)]">
          Taille totale: {formatTotalSize(totalSize)}
        </span>
      </div>

      {/* ===== Modals ===== */}
      {/* Protection du bureau : Copier / Déplacer / Protéger sur place */}
      <ImportModeDialog
        isOpen={importDialogFiles !== null}
        fileCount={importDialogFiles?.length ?? 0}
        totalSize={importDialogTotalSize}
        movableCount={importDialogMovableCount}
        storageSupportsMove={importDialogStorageSupportsMove}
        defaultMode={desktopProtection.importMode}
        onCancel={() => setImportDialogFiles(null)}
        onConfirm={handleImportModeConfirm}
      />
      {/* Wave 2 : conteneurs .filarr dans les dossiers Windows */}
      <ProtectInPlaceDialog
        isOpen={protectDialogPaths !== null}
        paths={protectDialogPaths ?? []}
        onClose={() => setProtectDialogPaths(null)}
      />
      <UploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        uploadProgress={uploadProgress}
      />
      <DeleteConfirmModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleConfirmDelete}
        itemCount={selectedItems.length}
      />
      {/* Modal de confirmation pour suppression de dossier avec contenu */}
      {folderDeletionInfo && (
        <DeleteFolderConfirmModal
          isOpen={folderDeleteModalOpen}
          onClose={() => {
            setFolderDeleteModalOpen(false);
            setFolderDeletionInfo(null);
            setItemToDelete(null);
          }}
          onConfirm={handleConfirmFolderDelete}
          folderName={folderDeletionInfo.folderName}
          items={folderDeletionInfo.items}
          totalItemCount={folderDeletionInfo.totalItemCount}
          totalSize={folderDeletionInfo.totalSize}
          noteCount={folderDeletionInfo.noteCount}
          isDeleting={isDeleting}
        />
      )}
      <ReminderModal
        isOpen={reminderModalOpen}
        onClose={() => {
          setReminderModalOpen(false);
          setItemForReminder(null);
        }}
        onSubmit={handleConfirmAddReminder}
        title="Ajouter un rappel"
        itemName={itemForReminder?.name}
      />

      {/* Version History Modal */}
      {versionHistoryOpen && versionHistoryFileId && (
        <Modal
          isOpen={versionHistoryOpen}
          onClose={() => {
            setVersionHistoryOpen(false);
            setVersionHistoryFileId(null);
            setVersionHistoryFileName(null);
          }}
          size="lg"
        >
          <ModalBody>
            <VersionHistoryPanel
              fileId={versionHistoryFileId}
              fileName={versionHistoryFileName || 'Fichier'}
              folderId={folderId || undefined}
              fileSize={versionHistoryFileSize}
              onClose={() => {
                setVersionHistoryOpen(false);
                setVersionHistoryFileId(null);
                setVersionHistoryFileName(null);
              }}
            />
          </ModalBody>
        </Modal>
      )}

      {/* Password Protection Modal */}
      {passwordModalOpen && passwordModalItem && (
        <FolderPasswordModal
          isOpen={passwordModalOpen}
          onClose={() => {
            setPasswordModalOpen(false);
            setPasswordModalItem(null);
          }}
          folderId={passwordModalItem.id}
          folderName={passwordModalItem.name}
          childItemIds={
            'items' in passwordModalItem ? (passwordModalItem as Folder).items || [] : []
          }
          onPasswordChange={() => {
            setPasswordVersion((v) => v + 1);
            success('Protection par mot de passe mise à jour');
          }}
        />
      )}

      {/* Password Unlock Modal */}
      {unlockModalOpen && unlockModalItem && (
        <PasswordUnlockModal
          isOpen={unlockModalOpen}
          onClose={() => {
            setUnlockModalOpen(false);
            setUnlockModalItem(null);
          }}
          itemId={unlockModalItem.id}
          itemName={unlockModalItem.name}
          itemType={'items' in unlockModalItem ? 'folder' : 'file'}
          onUnlock={handleUnlockSuccess}
        />
      )}

      {/* Context Menu */}
      {contextMenu.isOpen && (
        <ContextMenu
          items={contextMenu.items}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
        />
      )}

      {/* Modal création de dossier — emplacement prérempli au dossier ouvert */}
      <CreateFolderModal
        isOpen={createFolderModalOpen}
        onClose={() => setCreateFolderModalOpen(false)}
        onSubmit={handleConfirmCreateFolder}
        defaultParentId={folderId || null}
      />

      {/* Modal Move/Copy — single item or the whole selection (batch) */}
      {(itemToMoveCopy || isBatchMoveCopy) && (
        <MoveCopyDialog
          isOpen={moveCopyModalOpen}
          onClose={() => {
            // Une opération en vol garde la main : fermer ici laisserait
            // l'utilisateur sans nouvelles de ce qu'il vient de lancer.
            if (moveCopyBusy) return;
            setMoveCopyModalOpen(false);
            setItemToMoveCopy(null);
            setIsBatchMoveCopy(false);
          }}
          busy={moveCopyBusy}
          busyLabel={moveCopyBusyLabel}
          onSubmit={isBatchMoveCopy ? handleBatchMoveCopyConfirm : handleConfirmMoveCopy}
          mode={moveCopyMode}
          itemName={
            isBatchMoveCopy ? `${selectedItems.length} élément(s)` : itemToMoveCopy?.name || ''
          }
          currentFolderId={folderId || ''}
          itemId={
            !isBatchMoveCopy && itemToMoveCopy && 'items' in itemToMoveCopy
              ? itemToMoveCopy.id
              : undefined
          }
          allowRootTarget={canTargetRoot}
        />
      )}

      {/* Folder color & emoji personalization */}
      {folderStyleTarget && (
        <FolderStyleModal
          isOpen={!!folderStyleTarget}
          onClose={() => setFolderStyleTarget(null)}
          folderName={folderStyleTarget.name}
          defaultColor={folderStyleTarget.color || '#3b82f6'}
          defaultEmoji={folderStyleTarget.emoji}
          onSubmit={async ({ color, emoji }) => {
            const id = folderStyleTarget.id;
            await editFolder(id, { color, emoji });
            if (folderId) await loadFolder(folderId);
          }}
        />
      )}

      {/* Modal renommage */}
      <PromptModal
        isOpen={renameModalOpen}
        onClose={() => {
          setRenameModalOpen(false);
          setItemToRename(null);
        }}
        onSubmit={handleConfirmRename}
        title="Renommer"
        label="Nouveau nom"
        defaultValue={itemToRename?.name || ''}
        submitText="Renommer"
        cancelText="Annuler"
      />

      {/* Quick Look Modal */}
      <QuickLookModal
        file={quickLookFile}
        folderId={folderId || null}
        isOpen={!!quickLookFile}
        onClose={() => setQuickLookFile(null)}
      />

      {/* Gallery Modal */}
      <GalleryModal
        images={imageFiles}
        initialIndex={galleryInitialIndex}
        folderId={folderId || ''}
        isOpen={galleryOpen}
        onClose={() => setGalleryOpen(false)}
      />

      {/* Nommer le nouveau document — le format est déjà choisi par le menu. */}
      {newDocSpec && (
        <PromptModal
          isOpen
          onClose={() => setNewDocSpec(null)}
          onSubmit={handleCreateDocument}
          title={t('folder.newDocumentTitle', 'Nouveau document — {{editor}}', {
            editor: newDocSpec.label,
          })}
          label={t('folder.newDocumentLabel', 'Nom du document')}
          placeholder={t('folder.newDocumentPlaceholder', 'Nom du document (.{{ext}})', {
            ext: newDocSpec.ext,
          })}
          submitText={t('folder.newDocumentCreate', 'Créer et ouvrir')}
          cancelText={t('common.cancel', 'Annuler')}
        />
      )}

      {/* Le choix d'ouverture — jamais spontané : seul « Ouvrir avec… » l'ouvre. */}
      {openWithItem &&
        (() => {
          const cibles = openTargetsFor({
            fileName: openWithItem.name,
            size: openWithItem.size,
            hasPreview: getPreviewType(openWithItem.name) !== 'unsupported',
            canOpenSystem: true,
            allowImport: true,
          });
          if (cibles.length === 0) return null;
          return (
            <OpenWithDialog
              fileName={openWithItem.name}
              targets={cibles}
              initialId={
                defaultTargetFor({
                  fileName: openWithItem.name,
                  size: openWithItem.size,
                  hasPreview: getPreviewType(openWithItem.name) !== 'unsupported',
                  canOpenSystem: true,
                  allowImport: true,
                })?.id ?? cibles[0].id
              }
              onCancel={() => setOpenWithItem(null)}
              onConfirm={(cible, retenir) => {
                const item = openWithItem;
                setOpenWithItem(null);
                if (retenir) rememberPreference(item.name, cible.id);
                void ouvrirCible(item, cible);
              }}
            />
          );
        })()}

      {/* L'hôte d'édition d'un greffon, branché sur les fichiers PERSONNELS */}
      {pluginEditing && folderId && providerPourEdition(pluginEditing.name) && (
        <FilePluginEditorModal
          folderId={folderId}
          fileId={pluginEditing.id}
          fileName={pluginEditing.name}
          provider={providerPourEdition(pluginEditing.name)!}
          openMode={pluginEditingMode}
          onConvert={pluginEditingMode === 'import' ? handleConvertImport : undefined}
          readOnly={isProtected(pluginEditing.id) && !isUnlockedForSession(pluginEditing.id)}
          onClose={() => setPluginEditing(null)}
          onSaved={() => {
            if (folderId) void loadFolder(folderId);
          }}
        />
      )}

      {/* « Ajouter au coffre partagé… » — le MÊME dialogue pour un fichier, un
          dossier ou une note. Un « Déplacer » met l'original à la corbeille
          LOCALE : le dossier courant doit donc se relire. */}
      <AddToVaultDialog
        isOpen={addToVaultSource !== null}
        onClose={() => setAddToVaultSource(null)}
        source={addToVaultSource}
        onLocalChanged={() => {
          if (folderId) void loadFolder(folderId);
        }}
      />

      {/* Le dialogue de partage unifié et ses seconds niveaux (lien E2EE,
          entrée dans un coffre) — une seule instance, montée ici. */}
      {shareDialogOverlays}
    </div>
  );
});

export default FolderView;
