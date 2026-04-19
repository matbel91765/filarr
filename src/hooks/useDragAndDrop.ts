/**
 * Hook pour gérer le drag and drop des fichiers et dossiers
 *
 * Ce hook encapsule toute la logique de drag and drop pour déplacer
 * des fichiers et dossiers dans l'application.
 * Supporte le cross-panel drag via un payload JSON dans dataTransfer.
 */

import { useState, useCallback, useRef, useEffect, DragEvent } from 'react';
import { moveFile } from '../services/core/fileService';
import { moveFolder } from '../services/core/folderService';
import type { Item } from '../types';
import { isFolder as checkIsFolder } from '../types';

/** MIME type custom pour distinguer le DnD de fichiers du DnD d'onglets */
const FILARR_FILE_MIME = 'application/x-filarr-file';
const FILARR_TAB_MIME = 'application/x-filarr-tab';

/**
 * Type pour l'état du drag and drop
 */
export interface DragState {
  draggedItem: Item | null;
  dropTarget: string | null;
  isDragging: boolean;
}

/**
 * Return type pour useDragAndDrop hook
 */
export interface UseDragAndDropReturn {
  draggedItem: Item | null;
  dropTarget: string | null;
  isDragging: boolean;
  handleDragStart: (e: DragEvent, item: Item) => void;
  handleDragEnd: () => void;
  handleDragOver: (e: DragEvent, targetFolderId: string) => void;
  handleDragEnter: (e: DragEvent, targetFolderId: string) => void;
  handleDragLeave: (e: DragEvent) => void;
  handleDrop: (e: DragEvent, targetFolderId: string, currentFolderId: string) => Promise<void>;
  canDrop: (targetFolderId: string) => boolean;
}

/**
 * Hook personnalisé pour gérer le drag and drop
 * @param currentFolderId - ID du dossier courant (pour encoder dans dataTransfer)
 * @param onSuccess - Callback appelé après un déplacement réussi
 * @param onError - Callback appelé en cas d'erreur
 * @returns Fonctions et états pour le drag and drop
 */
export const useDragAndDrop = (
  currentFolderId: string | undefined,
  onSuccess?: (message: string) => void,
  onError?: (message: string) => void
): UseDragAndDropReturn => {
  const [draggedItem, setDraggedItem] = useState<Item | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Refs pour les callbacks — evite que handleDrop change a chaque render
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  // Throttle pour handleDragOver (~15fps)
  const lastDragOverRef = useRef<number>(0);

  /**
   * Vérifie si un dossier est un descendant d'un autre dossier
   */
  const isDescendant = useCallback((parentId: string, childId: string): boolean => {
    return parentId === childId;
  }, []);

  /**
   * Vérifie si on peut déposer l'élément dans le dossier cible (same-panel)
   */
  const canDrop = useCallback((targetFolderId: string): boolean => {
    if (!draggedItem) return false;

    if (checkIsFolder(draggedItem)) {
      if (isDescendant(draggedItem.id, targetFolderId)) {
        return false;
      }
    }

    return true;
  }, [draggedItem, isDescendant]);

  /**
   * Gère le début du drag — encode un payload complet dans dataTransfer
   * + prépare le fichier déchiffré pour drag natif vers le bureau
   */
  const handleDragStart = useCallback((e: DragEvent, item: Item) => {
    e.stopPropagation();

    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', item.id);

    // Payload complet pour le cross-panel
    e.dataTransfer.setData(FILARR_FILE_MIME, JSON.stringify({
      itemId: item.id,
      itemName: item.name,
      itemType: checkIsFolder(item) ? 'folder' : 'file',
      sourceFolderId: currentFolderId || '',
    }));

    setDraggedItem(item);
    setIsDragging(true);

    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.classList.add('dragging');
    }

    // Drag natif vers le bureau : préparer le fichier déchiffré en arrière-plan
    if (!checkIsFolder(item) && currentFolderId && window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.invoke('prepareDragFile', currentFolderId, item.name)
        .then((tempPath: string) => {
          if (tempPath) {
            window.electron.ipcRenderer.send('ondragstart', tempPath);
          }
        })
        .catch((err: unknown) => {
          console.warn('[DragAndDrop] Could not prepare file for native drag:', err);
        });
    }
  }, [currentFolderId]);

  /**
   * Gère la fin du drag
   */
  const handleDragEnd = useCallback(() => {
    setDraggedItem(null);
    setDropTarget(null);
    setIsDragging(false);
  }, []);

  /**
   * Gère le survol d'une zone de drop (throttled)
   */
  const handleDragOver = useCallback((e: DragEvent, targetFolderId: string) => {
    // preventDefault DOIT toujours être appelé, sinon le browser refuse le drop
    e.preventDefault();
    // stopPropagation TOUJOURS pour empecher le container d'activer l'overlay upload
    e.stopPropagation();

    // Throttle la logique restante à ~15fps
    const now = Date.now();
    if (now - lastDragOverRef.current < 66) return;
    lastDragOverRef.current = now;

    // Accepter si même panneau (canDrop) ou cross-panel (MIME type présent)
    const hasFilarrData = e.dataTransfer.types.includes(FILARR_FILE_MIME);
    if (canDrop(targetFolderId) || hasFilarrData) {
      e.dataTransfer.dropEffect = 'move';
    } else {
      e.dataTransfer.dropEffect = 'none';
    }
  }, [canDrop]);

  /**
   * Gère l'entrée dans une zone de drop
   */
  const handleDragEnter = useCallback((e: DragEvent, targetFolderId: string) => {
    e.preventDefault();
    e.stopPropagation();

    const hasFilarrData = e.dataTransfer.types.includes(FILARR_FILE_MIME);
    if (canDrop(targetFolderId) || hasFilarrData) {
      setDropTarget(targetFolderId);
    }
  }, [canDrop]);

  /**
   * Gère la sortie d'une zone de drop
   */
  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.currentTarget === e.target) {
      setDropTarget(null);
    }
  }, []);

  /**
   * Cleanup helper
   */
  const cleanup = useCallback(() => {
    setDropTarget(null);
    setDraggedItem(null);
    setIsDragging(false);
  }, []);

  /**
   * Gère le drop de l'élément — lit les données depuis dataTransfer (cross-panel safe)
   */
  const handleDrop = useCallback(async (
    e: DragEvent,
    targetFolderId: string,
    currentFolderIdFallback: string
  ) => {
    e.preventDefault();
    e.stopPropagation();

    // Ignorer les drags d'onglets
    if (e.dataTransfer.types.includes(FILARR_TAB_MIME)) {
      cleanup();
      return;
    }

    // 1) Tenter de lire le payload structuré (cross-panel safe)
    let itemId: string | null = null;
    let itemName = '';
    let itemType: 'file' | 'folder' = 'file';
    let sourceFolderId = currentFolderIdFallback;

    const raw = e.dataTransfer.getData(FILARR_FILE_MIME);
    if (raw) {
      try {
        const data = JSON.parse(raw);
        itemId = data.itemId;
        itemName = data.itemName;
        itemType = data.itemType;
        sourceFolderId = data.sourceFolderId;
      } catch {
        // fallthrough vers l'état local
      }
    }

    // 2) Fallback: état local (same-panel)
    if (!itemId && draggedItem) {
      itemId = draggedItem.id;
      itemName = draggedItem.name;
      itemType = checkIsFolder(draggedItem) ? 'folder' : 'file';
      sourceFolderId = currentFolderIdFallback;
    }

    if (!itemId) {
      cleanup();
      return;
    }

    // Ne pas permettre de déplacer dans le même dossier
    if (sourceFolderId === targetFolderId) {
      cleanup();
      return;
    }

    try {
      if (itemType === 'folder') {
        await moveFolder(itemId, sourceFolderId, targetFolderId);
        onSuccessRef.current?.(`Dossier "${itemName}" déplacé avec succès`);
      } else {
        await moveFile(itemId, sourceFolderId, targetFolderId);
        onSuccessRef.current?.(`Fichier "${itemName}" déplacé avec succès`);
      }
    } catch (error: unknown) {
      console.error('Erreur lors du déplacement:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      onErrorRef.current?.(`Échec du déplacement: ${message || 'Erreur inconnue'}`);
    } finally {
      cleanup();
    }
  }, [draggedItem, cleanup]);

  return {
    draggedItem,
    dropTarget,
    isDragging,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    canDrop,
  };
};

export default useDragAndDrop;
