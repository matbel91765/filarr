/**
 * Hook pour gérer le drag and drop des fichiers et dossiers
 *
 * Ce hook encapsule toute la logique de drag and drop pour déplacer
 * des fichiers et dossiers dans l'application.
 * Supporte le cross-panel drag via un payload JSON dans dataTransfer.
 */

import { useState, useCallback, useRef, useEffect, DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { moveFile } from '../services/core/fileService';
import { moveFolder } from '../services/core/folderService';
import { ROOT_FOLDER_ID } from '../services/core/storageAdapter';
import { fetchFolders } from '../store/slices/foldersSlice';
import type { AppDispatch, RootState } from '../store';
import type { Item } from '../types';
import { isFolder as checkIsFolder } from '../types';

import { FILARR_FILE_MIME } from './dragMime';

/**
 * MIME custom pour distinguer le DnD de fichiers du DnD d'onglets. Défini dans
 * `dragMime` (module pur, partagé avec le bandeau de dossier) et réexporté ici
 * pour que les importeurs existants ne bougent pas.
 */
export { FILARR_FILE_MIME };
/** Marqueur lisible dès `dragover` : le contenu déplacé est un dossier */
export const FILARR_FOLDER_MIME = 'application/x-filarr-folder';
const FILARR_TAB_MIME = 'application/x-filarr-tab';

export { ROOT_FOLDER_ID };

/** Délai d'ouverture automatique d'un dossier survolé pendant un drag (ms) */
export const SPRING_LOAD_DELAY_MS = 700;

/**
 * Durée d'affichage MINIMALE de l'avis « Déplacement de … » (ms).
 *
 * L'avis est posé dès le départ du déplacement, avant tout aller-retour — mais
 * un déplacement local se termine en quelques dizaines de millisecondes, et il
 * disparaissait alors trop vite pour qu'on le remarque. Les vues qui le posent
 * retardent son retrait jusqu'à ce plancher.
 */
export const MOVING_TOAST_MIN_MS = 900;

/**
 * Type pour l'état du drag and drop
 */
export interface DragState {
  draggedItem: Item | null;
  dropTarget: string | null;
  isDragging: boolean;
}

/**
 * Déplacement en vol : l'élément est encore affiché à sa place d'origine (aucun
 * retrait optimiste — le stockage hybride peut retomber sur le local, cf. les
 * commentaires de `storageAdapter`), mais sa carte doit se montrer occupée.
 */
export interface PendingMove {
  itemId: string;
  targetFolderId: string;
}

/**
 * Return type pour useDragAndDrop hook
 */
export interface UseDragAndDropReturn {
  draggedItem: Item | null;
  dropTarget: string | null;
  /** Dossier armé pour l'ouverture automatique (feedback visuel) */
  springTarget: string | null;
  /** Déplacement en cours côté service, `null` hors opération */
  pendingMove: PendingMove | null;
  isDragging: boolean;
  handleDragStart: (e: DragEvent, item: Item) => void;
  prewarmNativeDrag: (item: Item) => void;
  handleDragEnd: () => void;
  handleDragOver: (e: DragEvent, targetFolderId: string) => void;
  handleDragEnter: (e: DragEvent, targetFolderId: string) => void;
  handleDragLeave: (e: DragEvent) => void;
  handleDrop: (e: DragEvent, targetFolderId: string, currentFolderId: string) => Promise<void>;
  canDrop: (targetFolderId: string) => boolean;
  isDescendant: (ancestorId: string, candidateId: string) => boolean;
}

/**
 * Hook personnalisé pour gérer le drag and drop
 * @param currentFolderId - ID du dossier courant (pour encoder dans dataTransfer)
 * @param onSuccess - Callback appelé après un déplacement réussi
 * @param onError - Callback appelé en cas d'erreur
 * @param onSpringOpen - Ouverture automatique du dossier survolé pendant le drag
 * @param onMoveStart - Le déplacement part réellement (après toutes les validations)
 * @returns Fonctions et états pour le drag and drop
 */
export const useDragAndDrop = (
  currentFolderId: string | undefined,
  onSuccess?: (message: string) => void,
  onError?: (message: string) => void,
  onSpringOpen?: (folderId: string) => void,
  onMoveStart?: (itemName: string) => void
): UseDragAndDropReturn => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const foldersById = useSelector((state: RootState) => state.folders.byId);
  const [draggedItem, setDraggedItem] = useState<Item | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [springTarget, setSpringTarget] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Refs pour les callbacks — evite que handleDrop change a chaque render
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  const onSpringOpenRef = useRef(onSpringOpen);
  const onMoveStartRef = useRef(onMoveStart);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);
  useEffect(() => {
    onSpringOpenRef.current = onSpringOpen;
  }, [onSpringOpen]);
  useEffect(() => {
    onMoveStartRef.current = onMoveStart;
  }, [onMoveStart]);

  // Throttle pour handleDragOver (~15fps)
  const lastDragOverRef = useRef<number>(0);

  // Pre-materialized decrypted temp file for the pending native drag-out. The OS
  // requires startDrag to run synchronously inside the dragstart gesture, so we
  // prepare the file ahead of time (on mousedown) and cache its path here.
  const dragPrepRef = useRef<{ id: string; path: string | null }>({ id: '', path: null });

  const prewarmNativeDrag = useCallback(
    (item: Item) => {
      if (checkIsFolder(item) || !currentFolderId || !window.electron?.ipcRenderer) return;
      if (dragPrepRef.current.id === item.id && dragPrepRef.current.path) return;
      dragPrepRef.current = { id: item.id, path: null };
      window.electron.ipcRenderer
        .invoke('prepareDragFile', currentFolderId, item.name)
        .then((tempPath: string) => {
          if (tempPath && dragPrepRef.current.id === item.id) {
            dragPrepRef.current.path = tempPath;
          }
        })
        .catch(() => {
          /* best-effort */
        });
    },
    [currentFolderId]
  );

  /**
   * Vérifie si `candidateId` est `ancestorId` lui-même ou l'un de ses descendants.
   * Remonte la chaîne des parents depuis le candidat ; le `Set` coupe court si
   * l'arbre contient un cycle (métadonnées incohérentes) au lieu de boucler.
   */
  const isDescendant = useCallback(
    (ancestorId: string, candidateId: string): boolean => {
      if (!ancestorId || !candidateId) return false;
      if (ancestorId === candidateId) return true;

      const seen = new Set<string>([candidateId]);
      let currentId = foldersById[candidateId]?.parentId || undefined;

      while (currentId && !seen.has(currentId)) {
        if (currentId === ancestorId) return true;
        seen.add(currentId);
        currentId = foldersById[currentId]?.parentId || undefined;
      }

      return false;
    },
    [foldersById]
  );

  /**
   * Vérifie si on peut déposer l'élément dans le dossier cible (same-panel)
   */
  const canDrop = useCallback(
    (targetFolderId: string): boolean => {
      if (!draggedItem) return false;
      if (draggedItem.id === targetFolderId) return false;

      if (checkIsFolder(draggedItem)) {
        if (isDescendant(draggedItem.id, targetFolderId)) {
          return false;
        }
      }

      return true;
    },
    [draggedItem, isDescendant]
  );

  /**
   * Décide si une zone accepte le dépôt. Quand l'élément déplacé est connu
   * localement (même panneau), `canDrop` fait autorité — sinon la cible resterait
   * acceptante pour sa propre descendance. En cross-panel on n'a que les types
   * MIME sous la main : la présence du payload suffit, la validation réelle a
   * lieu au drop.
   */
  const accepts = useCallback(
    (e: DragEvent, targetFolderId: string): boolean => {
      if (draggedItem) return canDrop(targetFolderId);
      return e.dataTransfer.types.includes(FILARR_FILE_MIME);
    },
    [draggedItem, canDrop]
  );

  // Ouverture automatique (spring-load) : le dossier survolé assez longtemps
  // s'ouvre, ce qui permet de traverser l'arborescence sans lâcher l'élément.
  const springTimerRef = useRef<{ targetId: string; timer: ReturnType<typeof setTimeout> } | null>(
    null
  );

  const cancelSpringLoad = useCallback(() => {
    if (springTimerRef.current) {
      clearTimeout(springTimerRef.current.timer);
      springTimerRef.current = null;
    }
    setSpringTarget(null);
  }, []);

  const scheduleSpringLoad = useCallback(
    (targetFolderId: string) => {
      if (!onSpringOpenRef.current) return;
      // Déjà armé sur cette cible : ne pas réinitialiser le compte à rebours,
      // `dragenter` se redéclenche en passant d'un enfant à l'autre.
      if (springTimerRef.current?.targetId === targetFolderId) return;

      cancelSpringLoad();

      // Seule une cible connue comme dossier peut s'ouvrir (les cartes fichier
      // passent aussi par `handleDragEnter`).
      if (!foldersById[targetFolderId]) return;

      const timer = setTimeout(() => {
        springTimerRef.current = null;
        setSpringTarget(null);
        onSpringOpenRef.current?.(targetFolderId);
      }, SPRING_LOAD_DELAY_MS);

      springTimerRef.current = { targetId: targetFolderId, timer };
      setSpringTarget(targetFolderId);
    },
    [cancelSpringLoad, foldersById]
  );

  useEffect(() => cancelSpringLoad, [cancelSpringLoad]);

  /**
   * Gère le début du drag — encode un payload complet dans dataTransfer
   * + prépare le fichier déchiffré pour drag natif vers le bureau
   */
  const handleDragStart = useCallback(
    (e: DragEvent, item: Item) => {
      // Alt+drag on a file → native OS drag-out to the desktop. Electron's file
      // drag requires preventDefault + a *synchronous* startDrag, which is
      // mutually exclusive with the HTML5 drag used for internal moves. So we gate
      // it behind Alt and require the file to have been prewarmed on Alt+mousedown
      // (decryption is async and can't run inside the gesture).
      if (
        e.altKey &&
        !checkIsFolder(item) &&
        currentFolderId &&
        window.electron?.ipcRenderer &&
        dragPrepRef.current.id === item.id &&
        dragPrepRef.current.path
      ) {
        e.preventDefault();
        window.electron.ipcRenderer.send('ondragstart', dragPrepRef.current.path);
        return;
      }

      e.stopPropagation();

      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setData('text/plain', item.id);

      // Payload complet pour le cross-panel
      e.dataTransfer.setData(
        FILARR_FILE_MIME,
        JSON.stringify({
          itemId: item.id,
          itemName: item.name,
          itemType: checkIsFolder(item) ? 'folder' : 'file',
          sourceFolderId: currentFolderId || ROOT_FOLDER_ID,
        })
      );

      // Le payload n'est pas lisible pendant `dragover` : ce marqueur l'est, et
      // permet aux cibles réservées aux dossiers (la racine) de se désactiver.
      if (checkIsFolder(item)) {
        e.dataTransfer.setData(FILARR_FOLDER_MIME, item.id);
      }

      setDraggedItem(item);
      setIsDragging(true);

      if (e.currentTarget instanceof HTMLElement) {
        e.currentTarget.classList.add('dragging');
      }
    },
    [currentFolderId]
  );

  /**
   * Gère la fin du drag
   */
  const handleDragEnd = useCallback(() => {
    cancelSpringLoad();
    setDraggedItem(null);
    setDropTarget(null);
    setIsDragging(false);
  }, [cancelSpringLoad]);

  /**
   * Gère le survol d'une zone de drop (throttled)
   */
  const handleDragOver = useCallback(
    (e: DragEvent, targetFolderId: string) => {
      // preventDefault DOIT toujours être appelé, sinon le browser refuse le drop
      e.preventDefault();
      // stopPropagation TOUJOURS pour empecher le container d'activer l'overlay upload
      e.stopPropagation();

      // Throttle la logique restante à ~15fps
      const now = Date.now();
      if (now - lastDragOverRef.current < 66) return;
      lastDragOverRef.current = now;

      if (accepts(e, targetFolderId)) {
        e.dataTransfer.dropEffect = 'move';
      } else {
        e.dataTransfer.dropEffect = 'none';
      }
    },
    [accepts]
  );

  /**
   * Gère l'entrée dans une zone de drop
   */
  const handleDragEnter = useCallback(
    (e: DragEvent, targetFolderId: string) => {
      e.preventDefault();
      e.stopPropagation();

      if (!accepts(e, targetFolderId)) {
        cancelSpringLoad();
        return;
      }

      setDropTarget(targetFolderId);
      scheduleSpringLoad(targetFolderId);
    },
    [accepts, scheduleSpringLoad, cancelSpringLoad]
  );

  /**
   * Gère la sortie d'une zone de drop
   */
  const handleDragLeave = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.currentTarget === e.target) {
        setDropTarget(null);
        cancelSpringLoad();
      }
    },
    [cancelSpringLoad]
  );

  /**
   * Cleanup helper
   */
  const cleanup = useCallback(() => {
    cancelSpringLoad();
    setDropTarget(null);
    setDraggedItem(null);
    setIsDragging(false);
  }, [cancelSpringLoad]);

  /**
   * Gère le drop de l'élément — lit les données depuis dataTransfer (cross-panel safe)
   */
  const handleDrop = useCallback(
    async (e: DragEvent, targetFolderId: string, currentFolderIdFallback: string) => {
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
      let sourceFolderId = currentFolderIdFallback || ROOT_FOLDER_ID;

      const raw = e.dataTransfer.getData(FILARR_FILE_MIME);
      if (raw) {
        try {
          const data = JSON.parse(raw);
          itemId = data.itemId;
          itemName = data.itemName;
          itemType = data.itemType;
          sourceFolderId = data.sourceFolderId || ROOT_FOLDER_ID;
        } catch {
          // fallthrough vers l'état local
        }
      }

      // 2) Fallback: état local (same-panel)
      if (!itemId && draggedItem) {
        itemId = draggedItem.id;
        itemName = draggedItem.name;
        itemType = checkIsFolder(draggedItem) ? 'folder' : 'file';
        sourceFolderId = currentFolderIdFallback || ROOT_FOLDER_ID;
      }

      if (!itemId) {
        cleanup();
        return;
      }

      // Ne pas permettre de déplacer dans le même dossier, ni dans soi-même
      if (sourceFolderId === targetFolderId || itemId === targetFolderId) {
        cleanup();
        return;
      }

      if (itemType === 'folder' && isDescendant(itemId, targetFolderId)) {
        onErrorRef.current?.(t('dragDrop.intoDescendant'));
        cleanup();
        return;
      }

      if (itemType === 'file' && targetFolderId === ROOT_FOLDER_ID) {
        onErrorRef.current?.(t('dragDrop.fileAtRoot'));
        cleanup();
        return;
      }

      // Le déplacement part : la carte d'origine reste en place (pas de retrait
      // optimiste, le stockage peut retomber sur le local) mais se montre
      // occupée, et l'appelant peut poser un avis persistant.
      setPendingMove({ itemId, targetFolderId });
      onMoveStartRef.current?.(itemName);

      try {
        if (itemType === 'folder') {
          await moveFolder(itemId, sourceFolderId, targetFolderId);
          onSuccessRef.current?.(t('dragDrop.folderMoved', { name: itemName }));
          // Le parent d'un dossier change : les vues qui lisent l'arbre
          // (accueil, fil d'Ariane, barre latérale) doivent le relire.
          dispatch(fetchFolders());
        } else {
          await moveFile(itemId, sourceFolderId, targetFolderId);
          onSuccessRef.current?.(t('dragDrop.fileMoved', { name: itemName }));
        }
      } catch (error: unknown) {
        console.error('Erreur lors du déplacement:', error);
        const message = error instanceof Error ? error.message : '';
        onErrorRef.current?.(
          t('dragDrop.moveFailed', { error: message || t('dragDrop.unknownError') })
        );
      } finally {
        // `finally` et pas la branche de succès : un échec doit lui aussi rendre
        // la carte à son état normal, sinon elle reste grisée pour de bon.
        setPendingMove(null);
        cleanup();
      }
    },
    [draggedItem, cleanup, isDescendant, dispatch, t]
  );

  return {
    draggedItem,
    dropTarget,
    springTarget,
    pendingMove,
    isDragging,
    handleDragStart,
    prewarmNativeDrag,
    handleDragEnd,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    canDrop,
    isDescendant,
  };
};

export default useDragAndDrop;
