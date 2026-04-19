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
  ChangeEvent,
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
import { ReminderModal, type ReminderData } from '../../ui/ReminderModal';
import { MoveCopyDialog } from '../../ui/MoveCopyDialog';
import { DeleteFolderConfirmModal } from '../../ui/DeleteFolderConfirmModal';
import { VersionHistoryPanel } from '../../versions';
import { FolderPasswordModal } from '../../files/FolderPasswordModal';
import { PasswordUnlockModal } from '../../files/PasswordUnlockModal';
import { isProtected, isUnlockedForSession } from '../../../../services/auth/filePasswordService';
import { fetchVersions, createVersion } from '../../../../store/slices/versionsSlice';
import useFolder from '../../../../hooks/useFolder';
import useFile from '../../../../hooks/useFile';
import useContextMenu from '../../../../hooks/useContextMenu';
import useDragAndDrop from '../../../../hooks/useDragAndDrop';
import { useNotification } from '../../ui/Notification';
import {
  openFile,
  readFile,
  validateFile,
  validateFileBatch,
  moveFile,
  copyFile,
  downloadMultipleFiles,
} from '../../../../services/core/fileService';
import { moveFolder, copyFolder } from '../../../../services/core/folderService';
import {
  selectFolderItems,
  selectFolderPathById,
} from '../../../../store/selectors/folderSelectors';
import { Breadcrumb } from '../../navigation/Breadcrumb';
import { SortGroupBar } from './SortGroupBar';
import { BatchActionToolbar } from './BatchActionToolbar';
import type {
  Item,
  Folder,
  Reminder,
  ViewMode,
  SortOption,
  FileItem,
  HierarchicalTag,
} from '../../../../types';
import type { RootState, AppDispatch } from '../../../../store';
import type { FolderDeletionInfo } from '../../../../hooks/useFolderOperations';
import { isFolder as checkIsFolder } from '../../../../types';
import { SHOW_PROGRESS_THRESHOLD, formatBytes } from '../../../../constants/limits';
import {
  addFavorite,
  addRecentFile,
  selectIsFavorite,
} from '../../../../store/slices/favoritesSlice';
import {
  selectAllTags,
  selectFileTagMappings,
  loadTags,
  getFileTags,
} from '../../../../store/slices/tagsSlice';
import { getFileTypeInfo, isImageFile } from '../../../../utils/fileTypeIcons';
import { useRubberBandSelection } from '../../../../hooks/useRubberBandSelection';
import FileDetailsPanel from './FileDetailsPanel';
import { QuickLookModal } from '../../preview/QuickLookModal';
import { GalleryModal, isImageItem } from '../../preview/GalleryModal';
import { NoteEmbedCard } from '../../notes/NoteEmbedCard';
import {
  selectAllNotes,
  createNewNote,
  deleteNotesByFolder,
} from '../../../../store/slices/notesSlice';

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

// Props pour FileCard
interface FileCardProps {
  item: Item;
  folderId?: string;
  isSelected: boolean;
  onSelect: (itemId: string) => void;
  onItemClick: (item: Item) => void;
  viewMode: ViewMode;
  onRename?: (itemId: string) => void;
  onDelete?: (itemId: string) => void;
  onDownload?: (itemId: string) => void;
  onContextMenu?: (e: MouseEvent<HTMLDivElement>, item: Item) => void;
  onDragStart?: (e: DragEvent<HTMLDivElement>, item: Item) => void;
  onDragEnd?: () => void;
  onDragOver?: (e: DragEvent<HTMLDivElement>, itemId: string) => void;
  onDragEnter?: (e: DragEvent<HTMLDivElement>, itemId: string) => void;
  onDragLeave?: (e: DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: DragEvent<HTMLDivElement>, itemId: string) => void;
  isDraggedOver?: boolean;
  isDragging?: boolean;
  tags?: HierarchicalTag[];
  hasReminder?: boolean;
  isItemProtected?: boolean;
  isItemUnlocked?: boolean;
  offlineStatus?: 'synced' | 'syncing' | 'failed' | 'pinned-pending' | 'not-pinned';
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

// Icônes SVG
const BackIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="20"
    height="20"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
  </svg>
);

const UploadIcon: FC = () => (
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
      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
    />
  </svg>
);

const FolderPlusIcon: FC = () => (
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
      d="M12 10.5v6m3-3H9m4.06-7.19l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
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

const GridIcon: FC = () => (
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
      d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
    />
  </svg>
);

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

const FileIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="48"
    height="48"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
    />
  </svg>
);

const FolderIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="48"
    height="48"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
    />
  </svg>
);

const DownloadIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="16"
    height="16"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
    />
  </svg>
);

const EditIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="16"
    height="16"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
    />
  </svg>
);

const DeleteIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="16"
    height="16"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
    />
  </svg>
);

const FolderOpenIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="16"
    height="16"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776"
    />
  </svg>
);

const BellIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="16"
    height="16"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
    />
  </svg>
);

const HistoryIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="16"
    height="16"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const MoveIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="16"
    height="16"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
    />
  </svg>
);

const CopyIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="16"
    height="16"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75"
    />
  </svg>
);

const StarIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="16"
    height="16"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
    />
  </svg>
);

const LockIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="16"
    height="16"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
    />
  </svg>
);

const InfoIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="16"
    height="16"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
    />
  </svg>
);

// Pool de chargement de thumbnails — limite la concurrence IPC et priorise les items récemment visibles (LIFO)
const THUMBNAIL_MAX_CONCURRENT = 3;
let thumbnailActiveCount = 0;
const thumbnailPendingQueue: Array<() => void> = [];

function scheduleThumbnailLoad(loadFn: () => Promise<void>): () => void {
  const execute = () => {
    loadFn().finally(() => {
      thumbnailActiveCount--;
      drainThumbnailQueue();
    });
  };

  if (thumbnailActiveCount < THUMBNAIL_MAX_CONCURRENT) {
    thumbnailActiveCount++;
    execute();
  } else {
    thumbnailPendingQueue.push(execute);
  }

  // Cancel: retire de la queue si pas encore démarré
  return () => {
    const idx = thumbnailPendingQueue.indexOf(execute);
    if (idx !== -1) thumbnailPendingQueue.splice(idx, 1);
  };
}

function drainThumbnailQueue() {
  while (thumbnailActiveCount < THUMBNAIL_MAX_CONCURRENT && thumbnailPendingQueue.length > 0) {
    thumbnailActiveCount++;
    const next = thumbnailPendingQueue.pop()!; // LIFO: les items les plus récents passent en premier
    next();
  }
}

// In-memory thumbnail cache — survives navigation within the session
// Stores folderId/fileName → objectUrl (already resized JPEG blob URLs)
const THUMB_CACHE_MAX = 200;
const _thumbCache = new Map<string, string>();

function thumbCacheKey(folderId: string, fileName: string): string {
  return `${folderId}/${fileName}`;
}

function getThumbCached(folderId: string, fileName: string): string | null {
  return _thumbCache.get(thumbCacheKey(folderId, fileName)) ?? null;
}

function setThumbCached(folderId: string, fileName: string, url: string): void {
  const key = thumbCacheKey(folderId, fileName);
  // Evict oldest entry if at capacity
  if (_thumbCache.size >= THUMB_CACHE_MAX && !_thumbCache.has(key)) {
    const firstKey = _thumbCache.keys().next().value;
    if (firstKey) {
      const oldUrl = _thumbCache.get(firstKey);
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      _thumbCache.delete(firstKey);
    }
  }
  _thumbCache.set(key, url);
}

// Composant de vignette pour les fichiers images
const FileThumbnail: FC<{
  item: Item;
  folderId?: string;
  size?: 'grid' | 'list';
  isItemProtected?: boolean;
  isItemUnlocked?: boolean;
}> = React.memo(
  ({ item, folderId, size = 'grid', isItemProtected = false, isItemUnlocked = false }) => {
    const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isVisible, setIsVisible] = useState(false);
    const isFolder = 'items' in item;
    const fileTypeInfo = !isFolder
      ? getFileTypeInfo(item.name, 'type' in item ? (item as FileItem).type : undefined)
      : null;
    const isImage = !isFolder && isImageFile(item.name);

    // Lazy visibility detection — only load thumbnail when element enters viewport
    useEffect(() => {
      if (!isImage || !folderId) return;
      const el = containerRef.current;
      if (!el) return;
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.disconnect();
          }
        },
        { rootMargin: '200px' }
      );
      observer.observe(el);
      return () => observer.disconnect();
    }, [isImage, folderId]);

    useEffect(() => {
      if (!isVisible || !isImage || !folderId) return;
      // Don't load thumbnail for password-protected files
      if (!isFolder && isItemProtected && !isItemUnlocked) return;

      // Check in-memory cache first — instant display on folder revisit
      const cached = getThumbCached(folderId, item.name);
      if (cached) {
        setThumbnailUrl(cached);
        return;
      }

      let cancelled = false;

      const cancelScheduled = scheduleThumbnailLoad(async () => {
        if (cancelled) return;
        try {
          const data = await readFile(folderId, item.name, true);
          if (cancelled) return;
          const mimeType = ('type' in item ? (item as FileItem).type : '') || 'image/jpeg';
          const arrayBuffer = data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength
          ) as ArrayBuffer;
          const fullBlob = new Blob([arrayBuffer], { type: mimeType });

          // Resize to thumbnail to reduce GPU memory and compositing cost during scroll
          // Full-res 4000x3000 = ~36MB GPU memory vs 400x300 = ~0.5MB
          const THUMB_MAX = 400;
          const bitmap = await createImageBitmap(fullBlob);
          if (cancelled) {
            bitmap.close();
            return;
          }

          let objectUrl: string;
          const scale = Math.min(THUMB_MAX / bitmap.width, THUMB_MAX / bitmap.height, 1);
          if (scale < 1) {
            const w = Math.round(bitmap.width * scale);
            const h = Math.round(bitmap.height * scale);
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(bitmap, 0, 0, w, h);
            bitmap.close();
            if (cancelled) return;
            const thumbBlob = await new Promise<Blob | null>((resolve) =>
              canvas.toBlob(resolve, 'image/jpeg', 0.85)
            );
            if (cancelled || !thumbBlob) return;
            objectUrl = URL.createObjectURL(thumbBlob);
          } else {
            bitmap.close();
            objectUrl = URL.createObjectURL(fullBlob);
          }

          // Store in cache (URL is now owned by the cache, not this component)
          setThumbCached(folderId, item.name, objectUrl);
          if (!cancelled) setThumbnailUrl(objectUrl);
        } catch {
          // Fallback to type icon
        }
      });

      return () => {
        cancelled = true;
        cancelScheduled();
        // Don't revoke — the URL is owned by the cache now
      };
    }, [
      isVisible,
      folderId,
      item.id,
      item.name,
      isImage,
      isFolder,
      isItemProtected,
      isItemUnlocked,
    ]);

    // Hide thumbnail for protected locked files
    const showThumbnail = isImage && thumbnailUrl && (!isItemProtected || isItemUnlocked);

    // Grid mode: large preview area (Google Drive style)
    if (size === 'grid') {
      if (showThumbnail) {
        return (
          <div ref={containerRef} className="h-[140px] bg-[var(--color-background-secondary)]">
            <img
              src={thumbnailUrl}
              alt={item.name}
              className="w-full h-full object-cover"
              decoding="async"
            />
          </div>
        );
      }
      return (
        <div
          ref={containerRef}
          className="h-[140px] flex items-center justify-center"
          style={{
            backgroundColor: fileTypeInfo
              ? `${fileTypeInfo.color}12`
              : 'var(--color-background-secondary)',
          }}
        >
          <div
            className="opacity-50 [&_svg]:w-14 [&_svg]:h-14"
            style={{ color: fileTypeInfo?.color || 'var(--color-text-tertiary)' }}
          >
            {isFolder ? <FolderIcon /> : fileTypeInfo?.icon || <FileIcon />}
          </div>
        </div>
      );
    }

    // List mode: small icon/thumbnail
    if (showThumbnail) {
      return (
        <div ref={containerRef} className="w-8 h-8 rounded overflow-hidden shrink-0">
          <img
            src={thumbnailUrl}
            alt={item.name}
            className="w-full h-full object-cover"
            decoding="async"
          />
        </div>
      );
    }
    return (
      <div
        ref={containerRef}
        className="w-8 h-8 shrink-0 flex items-center justify-center [&_svg]:w-6 [&_svg]:h-6"
        style={{ color: fileTypeInfo?.color || 'var(--color-text-tertiary)' }}
      >
        {isFolder ? <FolderIcon /> : fileTypeInfo?.icon || <FileIcon />}
      </div>
    );
  }
);

FileThumbnail.displayName = 'FileThumbnail';

// Constante stable pour les items sans tags (evite de creer un [] a chaque render)
const EMPTY_TAGS: HierarchicalTag[] = [];

// Dimensions pour la virtualisation react-window

// Composant FileTagPills — pastilles de tags colorées
const FileTagPills: FC<{ tags: HierarchicalTag[]; compact?: boolean }> = React.memo(
  ({ tags, compact = false }) => {
    if (!tags || tags.length === 0) return null;
    const maxVisible = compact ? 2 : 3;
    const visible = tags.slice(0, maxVisible);
    const overflow = tags.length - maxVisible;

    return (
      <div className="flex items-center gap-1 shrink-0 min-w-0">
        {visible.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium leading-none text-white whitespace-nowrap"
            style={{ backgroundColor: tag.color || 'var(--color-primary-500)' }}
            title={tag.name}
          >
            {tag.name}
          </span>
        ))}
        {overflow > 0 && (
          <span className="inline-flex items-center px-1 py-0.5 rounded-full text-[10px] font-medium leading-none text-[var(--color-text-tertiary)] bg-[var(--color-background-secondary)]">
            +{overflow}
          </span>
        )}
      </div>
    );
  }
);

FileTagPills.displayName = 'FileTagPills';

// Fonctions utilitaires au niveau module (hors composant pour ne pas casser React.memo)
const formatSize = (bytes: number | undefined, isFolder: boolean): string => {
  if (!bytes || isFolder) return '-';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
};

const formatDate = (date: string | undefined): string => {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

// Composant FileCard (memoized pour eviter les re-renders lors de la selection)
const FileCard: FC<FileCardProps> = React.memo(
  ({
    item,
    folderId: cardFolderId,
    isSelected,
    onSelect,
    onItemClick,
    viewMode,
    onContextMenu,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragEnter,
    onDragLeave,
    onDrop,
    isDraggedOver,
    isDragging,
    tags,
    hasReminder,
    isItemProtected = false,
    isItemUnlocked = false,
    offlineStatus,
  }) => {
    const isFolder = 'items' in item;
    const fileTypeInfo = !isFolder
      ? getFileTypeInfo(item.name, 'type' in item ? (item as FileItem).type : undefined)
      : null;

    if (viewMode === 'list') {
      return (
        <div
          data-item-id={item.id}
          className={`group grid grid-cols-[40px_40px_1fr_100px_160px_48px] items-center px-4 py-3
          cursor-pointer select-none [contain:layout_style]
          hover:bg-[var(--color-background-secondary)]
          border-b border-[var(--color-border-light)] last:border-b-0
          ${isDraggedOver ? 'ring-2 ring-inset ring-[var(--color-primary-400)]' : ''}
          ${isDragging ? 'opacity-50' : ''}
          ${isSelected ? 'bg-[var(--color-primary-50)]' : ''}`}
          style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 56px' }}
          draggable
          onClick={() => onItemClick(item)}
          onContextMenu={(e) => onContextMenu && onContextMenu(e, item)}
          onDragStart={(e) => onDragStart && onDragStart(e, item)}
          onDragEnd={() => onDragEnd && onDragEnd()}
          onDragOver={(e) => isFolder && onDragOver && onDragOver(e, item.id)}
          onDragEnter={(e) => isFolder && onDragEnter && onDragEnter(e, item.id)}
          onDragLeave={(e) => isFolder && onDragLeave && onDragLeave(e)}
          onDrop={(e) => isFolder && onDrop && onDrop(e, item.id)}
        >
          <div>
            <input
              type="checkbox"
              checked={isSelected}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                e.stopPropagation();
                onSelect(item.id);
              }}
              onClick={(e: MouseEvent<HTMLInputElement>) => e.stopPropagation()}
              className="w-4 h-4 cursor-pointer accent-[var(--color-primary-600)]"
            />
          </div>
          <FileThumbnail
            item={item}
            folderId={cardFolderId}
            size="list"
            isItemProtected={isItemProtected}
            isItemUnlocked={isItemUnlocked}
          />
          <div className="text-sm font-medium text-[var(--color-text-primary)] truncate pr-4 flex items-center gap-1.5">
            <span className="truncate">{item.name}</span>
            {hasReminder && (
              <span className="shrink-0 text-amber-500" title="Rappel programme">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  className="w-3.5 h-3.5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
                  />
                </svg>
              </span>
            )}
            {isItemProtected && (
              <span
                className={`shrink-0 ${isItemUnlocked ? 'text-green-500' : 'text-[var(--color-text-tertiary)]'}`}
                title={
                  isItemUnlocked ? 'Deverrouille pour cette session' : 'Protege par mot de passe'
                }
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  className="w-3.5 h-3.5"
                >
                  {isItemUnlocked ? (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                    />
                  ) : (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                    />
                  )}
                </svg>
              </span>
            )}
            {offlineStatus && offlineStatus !== 'not-pinned' && (
              <span
                className={`shrink-0 ${
                  offlineStatus === 'synced'
                    ? 'text-emerald-500'
                    : offlineStatus === 'syncing' || offlineStatus === 'pinned-pending'
                      ? 'text-[var(--color-primary-400)]'
                      : 'text-red-400'
                }`}
                title={
                  offlineStatus === 'synced'
                    ? 'Disponible hors ligne'
                    : offlineStatus === 'syncing' || offlineStatus === 'pinned-pending'
                      ? 'Synchronisation en cours...'
                      : 'Échec de synchronisation'
                }
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  className={`w-3.5 h-3.5 ${offlineStatus === 'syncing' || offlineStatus === 'pinned-pending' ? 'animate-pulse' : ''}`}
                >
                  {offlineStatus === 'synced' ? (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 12.75L11.25 15 15 9.75M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.338-2.338 3.75 3.75 0 013.572 5.363M6.75 19.5h10.5"
                    />
                  ) : offlineStatus === 'failed' ? (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                    />
                  ) : (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 16.5V9.75m0 6.75l-3-3m3 3l3-3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.338-2.338 3.75 3.75 0 013.572 5.363M6.75 19.5h10.5"
                    />
                  )}
                </svg>
              </span>
            )}
            {tags && tags.length > 0 && <FileTagPills tags={tags} compact />}
          </div>
          <div className="text-xs text-[var(--color-text-tertiary)]">
            {formatSize('size' in item ? item.size : undefined, isFolder)}
          </div>
          <div className="text-xs text-[var(--color-text-tertiary)]">
            {formatDate(item.updatedAt)}
          </div>
          <div
            className="flex justify-center"
            onClick={(e: MouseEvent<HTMLDivElement>) => e.stopPropagation()}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                onContextMenu && onContextMenu(e as any, item);
              }}
              className="opacity-0 group-hover:opacity-100 p-1 rounded-full
              hover:bg-[var(--color-background-secondary)]"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="w-4 h-4 text-[var(--color-text-secondary)]"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z"
                />
              </svg>
            </button>
          </div>
        </div>
      );
    }

    // Grid mode: Google Drive-style card with preview area + info bar
    return (
      <div
        data-item-id={item.id}
        className={`file-card-grid group relative rounded-xl border cursor-pointer select-none
        overflow-hidden [contain:content]
        bg-[var(--color-surface)] border-[var(--color-border)] shadow-sm
        hover:border-[var(--color-primary-200)]
        ${isDraggedOver ? 'ring-2 ring-[var(--color-primary-400)] border-dashed border-[var(--color-primary-400)]' : ''}
        ${isDragging ? 'opacity-50 scale-95' : ''}
        ${isSelected ? 'ring-2 ring-[var(--color-primary-400)] border-[var(--color-primary-300)]' : ''}`}
        style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 220px' }}
        onClick={() => onItemClick(item)}
        onContextMenu={(e) => onContextMenu && onContextMenu(e, item)}
        draggable
        onDragStart={(e) => onDragStart && onDragStart(e, item)}
        onDragEnd={() => onDragEnd && onDragEnd()}
        onDragOver={(e) => isFolder && onDragOver && onDragOver(e, item.id)}
        onDragEnter={(e) => isFolder && onDragEnter && onDragEnter(e, item.id)}
        onDragLeave={(e) => isFolder && onDragLeave && onDragLeave(e)}
        onDrop={(e) => isFolder && onDrop && onDrop(e, item.id)}
      >
        {/* Checkbox */}
        <div className="absolute top-2 left-2 z-10 opacity-0 group-hover:opacity-100">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              e.stopPropagation();
              onSelect(item.id);
            }}
            onClick={(e: MouseEvent<HTMLInputElement>) => e.stopPropagation()}
            className="w-4 h-4 cursor-pointer accent-[var(--color-primary-600)]"
          />
        </div>

        {/* Preview area */}
        <FileThumbnail
          item={item}
          folderId={cardFolderId}
          size="grid"
          isItemProtected={isItemProtected}
          isItemUnlocked={isItemUnlocked}
        />

        {/* Reminder badge */}
        {hasReminder && !isItemProtected && (
          <div
            className="absolute top-2 right-2 flex items-center justify-center w-6 h-6 rounded-full bg-amber-500/90 text-white shadow-sm"
            title="Rappel programme"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2.5}
              stroke="currentColor"
              className="w-3 h-3"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
              />
            </svg>
          </div>
        )}
        {hasReminder && isItemProtected && (
          <div
            className="absolute top-2 right-10 flex items-center justify-center w-6 h-6 rounded-full bg-amber-500/90 text-white shadow-sm"
            title="Rappel programme"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2.5}
              stroke="currentColor"
              className="w-3 h-3"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
              />
            </svg>
          </div>
        )}

        {/* Lock badge */}
        {isItemProtected && (
          <div
            className={`absolute top-2 right-2 flex items-center justify-center w-7 h-7 rounded-full shadow-sm
          ${isItemUnlocked ? 'bg-green-500/90 text-white' : 'bg-slate-700/80 text-white'}`}
            title={isItemUnlocked ? 'Deverrouille pour cette session' : 'Protege par mot de passe'}
          >
            {isItemUnlocked ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2.5}
                stroke="currentColor"
                className="w-3.5 h-3.5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2.5}
                stroke="currentColor"
                className="w-3.5 h-3.5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                />
              </svg>
            )}
          </div>
        )}

        {/* Offline sync badge */}
        {offlineStatus && offlineStatus !== 'not-pinned' && (
          <div
            className={`absolute bottom-[52px] left-2 flex items-center justify-center w-5 h-5 rounded-full shadow-sm
              ${offlineStatus === 'synced' ? 'bg-emerald-500/90 text-white' : ''}
              ${offlineStatus === 'syncing' || offlineStatus === 'pinned-pending' ? 'bg-[var(--color-primary-500)]/90 text-white' : ''}
              ${offlineStatus === 'failed' ? 'bg-red-500/90 text-white' : ''}
            `}
            title={
              offlineStatus === 'synced'
                ? 'Disponible hors ligne'
                : offlineStatus === 'syncing' || offlineStatus === 'pinned-pending'
                  ? 'Synchronisation en cours...'
                  : 'Échec de synchronisation'
            }
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2.5}
              stroke="currentColor"
              className={`w-3 h-3 ${offlineStatus === 'syncing' || offlineStatus === 'pinned-pending' ? 'animate-pulse' : ''}`}
            >
              {offlineStatus === 'synced' ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.338-2.338 3.75 3.75 0 013.572 5.363M6.75 19.5h10.5"
                />
              ) : offlineStatus === 'failed' ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 16.5V9.75m0 6.75l-3-3m3 3l3-3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.338-2.338 3.75 3.75 0 013.572 5.363M6.75 19.5h10.5"
                />
              )}
            </svg>
          </div>
        )}

        {/* Info bar */}
        <div className="flex items-center gap-2.5 px-3 py-2.5 border-t border-[var(--color-border-light)]">
          <div
            className="shrink-0 [&_svg]:w-5 [&_svg]:h-5"
            style={{ color: fileTypeInfo?.color || 'var(--color-primary-500)' }}
          >
            {isFolder ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="currentColor"
                viewBox="0 0 24 24"
                className="w-5 h-5"
              >
                <path d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
            ) : (
              fileTypeInfo?.icon || <FileIcon />
            )}
          </div>
          <p
            className="flex-1 text-sm font-medium text-[var(--color-text-primary)] truncate min-w-0"
            title={item.name}
          >
            {item.name}
          </p>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onContextMenu && onContextMenu(e as any, item);
            }}
            className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded-full
            hover:bg-[var(--color-background-secondary)]"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="w-4 h-4 text-[var(--color-text-secondary)]"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z"
              />
            </svg>
          </button>
        </div>

        {/* Tags */}
        {tags && tags.length > 0 && (
          <div className="px-3 pb-2">
            <FileTagPills tags={tags} />
          </div>
        )}
      </div>
    );
  }
);

FileCard.displayName = 'FileCard';

// Props pour SubfolderCard
interface SubfolderCardProps {
  subfolder: Folder;
  onItemClick: (item: Item) => void;
  onContextMenu: (e: MouseEvent<HTMLDivElement>, item: Item) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>, item: Item) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent<HTMLDivElement>, itemId: string) => void;
  onDragEnter: (e: DragEvent<HTMLDivElement>, itemId: string) => void;
  onDragLeave: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (e: DragEvent<HTMLDivElement>, itemId: string) => void;
  isDropTarget: boolean;
  isDragging: boolean;
  protectionStatus?: { isProtected: boolean; isUnlocked: boolean };
}

// Composant SubfolderCard (memoized pour eviter les re-renders inutiles)
const SubfolderCard: FC<SubfolderCardProps> = React.memo(
  ({
    subfolder,
    onItemClick,
    onContextMenu,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragEnter,
    onDragLeave,
    onDrop,
    isDropTarget,
    isDragging,
    protectionStatus,
  }) => {
    return (
      <div
        data-item-id={subfolder.id}
        onClick={() => onItemClick(subfolder)}
        onContextMenu={(e) => onContextMenu(e, subfolder)}
        draggable
        onDragStart={(e) => onDragStart(e, subfolder)}
        onDragEnd={onDragEnd}
        onDragOver={(e) => onDragOver(e, subfolder.id)}
        onDragEnter={(e) => onDragEnter(e, subfolder.id)}
        onDragLeave={onDragLeave}
        onDrop={(e) => onDrop(e, subfolder.id)}
        className={`group flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer
        bg-[var(--color-surface)] border border-[var(--color-border)]
        shadow-sm hover:border-[var(--color-primary-200)]
        select-none [contain:content] overflow-hidden
        ${isDropTarget ? 'ring-2 ring-[var(--color-primary-400)] border-dashed border-[var(--color-primary-400)]' : ''}
        ${isDragging ? 'opacity-50 scale-95' : ''}`}
        style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 56px' }}
      >
        <div
          className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
          style={{
            backgroundColor: subfolder.color ? `${subfolder.color}20` : 'var(--color-primary-50)',
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill={subfolder.color || 'var(--color-primary-500)'}
            viewBox="0 0 24 24"
            className="w-5 h-5"
          >
            <path d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--color-text-primary)] truncate flex items-center gap-1.5">
            {subfolder.name}
            {protectionStatus?.isProtected && (
              <span
                className={`shrink-0 ${protectionStatus.isUnlocked ? 'text-green-500' : 'text-[var(--color-text-tertiary)]'}`}
                title={
                  protectionStatus.isUnlocked
                    ? 'Deverrouille pour cette session'
                    : 'Protege par mot de passe'
                }
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  className="w-3.5 h-3.5"
                >
                  {protectionStatus.isUnlocked ? (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                    />
                  ) : (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                    />
                  )}
                </svg>
              </span>
            )}
          </p>
          <p className="text-xs text-[var(--color-text-tertiary)]">
            {subfolder.items?.length || 0} element(s)
          </p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onContextMenu(e as any, subfolder);
          }}
          className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded-full
          hover:bg-[var(--color-background-secondary)]"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="w-4 h-4 text-[var(--color-text-secondary)]"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z"
            />
          </svg>
        </button>
      </div>
    );
  }
);

SubfolderCard.displayName = 'SubfolderCard';

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
  const { success, error } = useNotification();
  const { contextMenu, openContextMenu, closeContextMenu } = useContextMenu();

  // Callbacks stables pour le hook drag and drop
  const handleDnDSuccess = useCallback(
    (message: string) => {
      success(message);
      if (folderId) loadFolder(folderId);
    },
    [folderId, success, loadFolder]
  );

  const handleDnDError = useCallback(
    (message: string) => {
      error(message);
    },
    [error]
  );

  // Hook drag and drop
  const {
    draggedItem,
    dropTarget,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop: handleDropItem,
  } = useDragAndDrop(folderId, handleDnDSuccess, handleDnDError);

  // Callback stable pour onDrop des FileCards (evite inline lambda dans le .map)
  const handleDropForCurrentFolder = useCallback(
    (e: DragEvent, targetFolderId: string) => {
      if (folderId) handleDropItem(e, targetFolderId, folderId);
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

  // Ajouter le dossier aux recents quand on navigue dessus
  useEffect(() => {
    if (folderId && folder && folder.name !== 'Dossier') {
      dispatch(addRecentFile({ item: folder as any, path: `/folder/${folderId}` }));
    }
  }, [folderId, folder?.id]);

  // États locaux
  const [searchQuery, setSearchQuery] = useState<string>('');
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

  // État pour le panneau de détails
  const [detailsPanelItem, setDetailsPanelItem] = useState<Item | null>(null);

  // Quick Look (Espace)
  const [quickLookFile, setQuickLookFile] = useState<FileItem | null>(null);

  // Galerie d'images
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryInitialIndex, setGalleryInitialIndex] = useState(0);

  // Filtrage et tri des items
  const filteredAndSortedItems = useMemo(() => {
    let result = [...items];

    // Filtrage par recherche
    if (searchQuery) {
      result = result.filter((item) => item.name.toLowerCase().includes(searchQuery.toLowerCase()));
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
  }, [items, searchQuery, sortBy, sortOrder]);

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

  // Callbacks stables pour BatchActionToolbar
  const handleBatchSelectAll = useCallback(() => {
    setSelectedItems(filteredAndSortedItems.map((i) => i.id));
  }, [filteredAndSortedItems]);

  const handleBatchDeselectAll = useCallback(() => {
    setSelectedItems([]);
  }, []);

  // Quick Look — touche Espace pour prévisualiser le fichier sélectionné
  useEffect(() => {
    const handleSpaceKey = (e: KeyboardEvent) => {
      if (e.key !== ' ') return;
      // Ignorer si focus dans un champ de saisie
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Ignorer si Quick Look déjà ouvert (FilePreviewPanel gère la fermeture)
      if (quickLookFile) return;

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
  }, [selectedItems, items, quickLookFile]);

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
      } else {
        // Fichier : verifier si protege par mot de passe
        if (isProtected(item.id) && !isUnlockedForSession(item.id)) {
          setUnlockModalItem(item);
          setUnlockModalOpen(true);
          return;
        }
        // Si c'est une image, ouvrir la galerie
        if (isImageItem(item as FileItem)) {
          openGallery(item as FileItem);
          return;
        }
        await doOpenFile(item);
      }
    },
    [navigate, doOpenFile, openGallery]
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
      } else {
        doOpenFile(item);
      }
    },
    [unlockModalItem, navigate, doOpenFile]
  );

  // Gestion de l'upload
  const handleUpload = useCallback(
    async (file: File) => {
      if (!file || !folderId) return;

      let interval: NodeJS.Timeout | null = null;
      let closeTimeout: NodeJS.Timeout | null = null;

      try {
        // Convert File object to serializable format
        const reader = new FileReader();
        const fileData: any = await new Promise((resolve, reject) => {
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

        // Snapshot current item IDs before upload to detect the new one
        const currentItemIds = new Set(items.map((item: any) => item.id));

        // Upload réel via Redux with serializable data
        const uploadResult = await uploadFile(folderId, fileData);

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

        if (showProgress) {
          setUploadProgress(100);
          closeTimeout = setTimeout(() => {
            setIsUploadModalOpen(false);
            setUploadProgress(0);
          }, 1000);
        }

        success(`Fichier "${file.name}" uploadé avec succès (${formatBytes(file.size)})`);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        if (interval) clearInterval(interval);
        if (closeTimeout) clearTimeout(closeTimeout);
        error(errMsg || "Échec de l'upload du fichier");
        setIsUploadModalOpen(false);
        setUploadProgress(0);
      }
    },
    [folderId, uploadFile, dispatch, success, error, items, folder]
  );

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
    e.preventDefault();
    e.stopPropagation();

    // Ne pas afficher l'overlay upload pour les drags internes (deplacements de fichiers)
    const isInternalDrag = e.dataTransfer.types.includes('application/x-filarr-file');
    if (isInternalDrag) return;

    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      // Drop interne = deplacer le fichier/dossier dans le dossier courant
      const isInternalDrag = e.dataTransfer.types.includes('application/x-filarr-file');
      if (isInternalDrag && folderId) {
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

        // Upload files one by one
        files.forEach((file) => handleUpload(file));
      }
    },
    [handleUpload, error, folderId, handleDropItem]
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

        const newReminder: Reminder = {
          id: Date.now().toString(),
          itemId: itemForReminder.id,
          itemName: itemForReminder.name,
          itemType: 'items' in itemForReminder ? 'folder' : 'file',
          date:
            reminderData.datetime ||
            new Date(`${reminderData.date}T${reminderData.time}`).toISOString(),
          message: reminderData.message,
        };

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
    setItemToMoveCopy(item);
    setMoveCopyMode('move');
    setMoveCopyModalOpen(true);
  }, []);

  const handleCopyItem = useCallback((item: Item) => {
    setItemToMoveCopy(item);
    setMoveCopyMode('copy');
    setMoveCopyModalOpen(true);
  }, []);

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

  // Add to favorites handler
  const handleAddToFavorites = useCallback(
    (item: Item) => {
      dispatch(
        addFavorite({
          item: item,
          path: folderId ? `/folder/${folderId}` : '/',
        })
      );
      success(`"${item.name}" ajouté aux favoris`);
    },
    [dispatch, folderId, success]
  );

  const handleBatchAddToFavorites = useCallback(() => {
    selectedItems.forEach((id) => {
      const item = items.find((i) => i.id === id);
      if (item) handleAddToFavorites(item);
    });
  }, [selectedItems, items, handleAddToFavorites]);

  const handleConfirmMoveCopy = useCallback(
    async (targetFolderId: string, newName?: string) => {
      if (!itemToMoveCopy || !folderId) return;

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
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        error(`Échec de l'opération: ${errMsg || 'Erreur inconnue'}`);
      }
    },
    [
      itemToMoveCopy,
      folderId,
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

  // Gestion création de dossier
  const handleCreateFolder = useCallback(() => {
    setCreateFolderModalOpen(true);
  }, []);

  const handleConfirmCreateFolder = useCallback(
    async (folderName: string) => {
      if (!folderId) return;

      try {
        await addFolder({
          name: folderName,
          parentId: folderId,
        });
        success('Dossier créé avec succès!');
      } catch (err) {
        error('Échec de la création du dossier');
      }
    },
    [folderId, addFolder, success, error]
  );

  // Gestion du menu contextuel pour les fichiers
  const handleFileContextMenu = useCallback(
    (e: MouseEvent<HTMLDivElement>, item: Item) => {
      const isFavorite = selectIsFavorite(
        {
          favorites: {
            favorites: [],
            recentFiles: [],
            maxRecentFiles: 20,
            isDragging: false,
            draggedItemId: null,
            dropTargetIndex: null,
            showRecent: true,
            showFavorites: true,
            lastPersisted: null,
          },
        },
        item.id
      );

      openContextMenu(e as any, [
        {
          label: 'Voir les détails',
          icon: <InfoIcon />,
          onClick: () => {
            setDetailsPanelItem(item);
            closeContextMenu();
          },
        },
        {
          label:
            isProtected(item.id) && !isUnlockedForSession(item.id)
              ? 'Télécharger (protégé)'
              : 'Télécharger',
          icon: <DownloadIcon />,
          disabled: isProtected(item.id) && !isUnlockedForSession(item.id),
          onClick: () => {
            handleDownloadItem(item.id);
            closeContextMenu();
          },
        },
        {
          label: 'Renommer',
          icon: <EditIcon />,
          onClick: () => {
            handleRenameItem(item.id);
            closeContextMenu();
          },
        },
        {
          label: 'Déplacer',
          icon: <MoveIcon />,
          onClick: () => {
            handleMoveItem(item);
            closeContextMenu();
          },
        },
        {
          label: 'Copier',
          icon: <CopyIcon />,
          onClick: () => {
            handleCopyItem(item);
            closeContextMenu();
          },
        },
        {
          label: 'Ajouter aux favoris',
          icon: <StarIcon />,
          onClick: () => {
            handleAddToFavorites(item);
            closeContextMenu();
          },
        },
        {
          label: 'Ajouter un rappel',
          icon: <BellIcon />,
          onClick: () => {
            handleAddReminderToItem(item);
            closeContextMenu();
          },
        },
        { divider: true },
        {
          label: "Voir l'historique des versions",
          icon: <HistoryIcon />,
          onClick: () => {
            handleViewHistory(item);
            closeContextMenu();
          },
        },
        {
          label: 'Protéger par mot de passe',
          icon: <LockIcon />,
          onClick: () => {
            handleSetPassword(item);
            closeContextMenu();
          },
        },
        { divider: true },
        {
          label: 'Supprimer',
          icon: <DeleteIcon />,
          onClick: () => {
            handleDeleteItem(item.id);
            closeContextMenu();
          },
          danger: true,
          shortcut: 'Suppr',
        },
      ]);
    },
    [
      openContextMenu,
      closeContextMenu,
      handleDownloadItem,
      handleRenameItem,
      handleMoveItem,
      handleCopyItem,
      handleAddReminderToItem,
      handleDeleteItem,
      handleAddToFavorites,
      handleViewHistory,
      handleSetPassword,
      navigate,
    ]
  );

  // Gestion du menu contextuel pour les dossiers
  const handleFolderContextMenu = useCallback(
    (e: MouseEvent<HTMLDivElement>, item: Item) => {
      openContextMenu(e as any, [
        {
          label: 'Ouvrir',
          icon: <FolderOpenIcon />,
          onClick: () => {
            handleItemClick(item);
            closeContextMenu();
          },
        },
        {
          label: 'Voir les détails',
          icon: <InfoIcon />,
          onClick: () => {
            setDetailsPanelItem(item);
            closeContextMenu();
          },
        },
        {
          label: 'Renommer',
          icon: <EditIcon />,
          onClick: () => {
            handleRenameItem(item.id);
            closeContextMenu();
          },
        },
        {
          label: 'Déplacer',
          icon: <MoveIcon />,
          onClick: () => {
            handleMoveItem(item);
            closeContextMenu();
          },
        },
        {
          label: 'Copier',
          icon: <CopyIcon />,
          onClick: () => {
            handleCopyItem(item);
            closeContextMenu();
          },
        },
        {
          label: 'Ajouter aux favoris',
          icon: <StarIcon />,
          onClick: () => {
            handleAddToFavorites(item);
            closeContextMenu();
          },
        },
        {
          label: 'Ajouter un rappel',
          icon: <BellIcon />,
          onClick: () => {
            handleAddReminderToItem(item);
            closeContextMenu();
          },
        },
        {
          label: 'Protéger par mot de passe',
          icon: <LockIcon />,
          onClick: () => {
            handleSetPassword(item);
            closeContextMenu();
          },
        },
        { divider: true },
        {
          label: 'Supprimer',
          icon: <DeleteIcon />,
          onClick: () => {
            handleDeleteItem(item.id);
            closeContextMenu();
          },
          danger: true,
          shortcut: 'Suppr',
        },
      ]);
    },
    [
      openContextMenu,
      closeContextMenu,
      handleItemClick,
      handleRenameItem,
      handleDeleteItem,
      handleAddReminderToItem,
      handleMoveItem,
      handleCopyItem,
      handleAddToFavorites,
      handleSetPassword,
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

  // Calcul des statistiques
  const totalSize = useMemo(() => {
    return items.reduce((sum, item) => sum + (('size' in item ? item.size : 0) || 0), 0);
  }, [items]);

  const formatTotalSize = useCallback((bytes: number): string => {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  }, []);

  return (
    <div className="flex flex-col h-screen bg-[var(--color-background-secondary)] overflow-hidden">
      {/* ===== Header ===== */}
      <div className="flex items-center justify-between h-16 px-6 bg-[var(--color-surface)] border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() =>
              folder.parentId ? navigate(`/folder/${folder.parentId}`) : navigate('/')
            }
            className="shrink-0 flex items-center justify-center w-9 h-9 rounded-full
              text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]"
            aria-label="Retour"
          >
            <BackIcon />
          </button>
          <Breadcrumb folderId={folderId!} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="primary"
            size="sm"
            leftIcon={<UploadIcon />}
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.onchange = (e: Event) => {
                const target = e.target as HTMLInputElement;
                const file = target.files?.[0];
                if (file) handleUpload(file);
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
        </div>
      </div>

      {/* ===== Toolbar ===== */}
      <SortGroupBar searchQuery={searchQuery} onSearchChange={setSearchQuery} />

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
        >
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
                    input.onchange = (e: Event) => {
                      const target = e.target as HTMLInputElement;
                      const file = target.files?.[0];
                      if (file) handleUpload(file);
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
                      {files.map((item) => (
                        <FileCard
                          key={item.id}
                          item={item}
                          folderId={folderId}
                          isSelected={selectedItemsSet.has(item.id)}
                          onSelect={handleSelectItem}
                          onItemClick={handleItemClick}
                          onContextMenu={handleItemContextMenu}
                          viewMode={viewMode}
                          onDragStart={handleDragStart}
                          onDragEnd={handleDragEnd}
                          onDragOver={handleDragOver}
                          onDragEnter={handleDragEnter}
                          onDragLeave={handleDragLeave}
                          onDrop={handleDropForCurrentFolder}
                          isDraggedOver={dropTarget === item.id}
                          isDragging={draggedItem?.id === item.id}
                          tags={resolvedTagsMap[item.id] || EMPTY_TAGS}
                          hasReminder={itemsWithReminders.has(item.id)}
                          isItemProtected={protectionStatusMap.get(item.id)?.isProtected ?? false}
                          isItemUnlocked={protectionStatusMap.get(item.id)?.isUnlocked ?? false}
                        />
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
                        <div>Nom</div>
                        <div>Taille</div>
                        <div>Modifie</div>
                        <div></div>
                      </div>
                      {files.map((item) => (
                        <FileCard
                          key={item.id}
                          item={item}
                          folderId={folderId}
                          isSelected={selectedItemsSet.has(item.id)}
                          onSelect={handleSelectItem}
                          onItemClick={handleItemClick}
                          onContextMenu={handleItemContextMenu}
                          viewMode={viewMode}
                          onDragStart={handleDragStart}
                          onDragEnd={handleDragEnd}
                          onDragOver={handleDragOver}
                          onDragEnter={handleDragEnter}
                          onDragLeave={handleDragLeave}
                          onDrop={handleDropForCurrentFolder}
                          isDraggedOver={dropTarget === item.id}
                          isDragging={draggedItem?.id === item.id}
                          tags={resolvedTagsMap[item.id] || EMPTY_TAGS}
                          hasReminder={itemsWithReminders.has(item.id)}
                          isItemProtected={protectionStatusMap.get(item.id)?.isProtected ?? false}
                          isItemUnlocked={protectionStatusMap.get(item.id)?.isUnlocked ?? false}
                        />
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
          />
        )}
      </div>

      {/* ===== Footer ===== */}
      <div className="flex items-center justify-between h-10 px-6 bg-[var(--color-surface)] border-t border-[var(--color-border)] shrink-0">
        <span className="text-xs text-[var(--color-text-tertiary)]">
          {filteredAndSortedItems.length} element{filteredAndSortedItems.length > 1 ? 's' : ''}
        </span>
        <span className="text-xs text-[var(--color-text-tertiary)]">
          Taille totale: {formatTotalSize(totalSize)}
        </span>
      </div>

      {/* ===== Modals ===== */}
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

      {/* Modal création de dossier */}
      <PromptModal
        isOpen={createFolderModalOpen}
        onClose={() => setCreateFolderModalOpen(false)}
        onSubmit={handleConfirmCreateFolder}
        title="Nouveau dossier"
        label="Nom du dossier"
        placeholder="Ex: Documents"
        submitText="Créer"
        cancelText="Annuler"
      />

      {/* Modal Move/Copy */}
      {itemToMoveCopy && (
        <MoveCopyDialog
          isOpen={moveCopyModalOpen}
          onClose={() => {
            setMoveCopyModalOpen(false);
            setItemToMoveCopy(null);
          }}
          onSubmit={handleConfirmMoveCopy}
          mode={moveCopyMode}
          itemName={itemToMoveCopy.name}
          currentFolderId={folderId || ''}
          itemId={'items' in itemToMoveCopy ? itemToMoveCopy.id : undefined}
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
    </div>
  );
});

export default FolderView;
