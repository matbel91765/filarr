/**
 * FileCard — la carte d'un élément de l'explorateur (grille + ligne de liste).
 *
 * Extrait tel quel de `views/FolderView/FolderView.tsx` : mêmes classes, mêmes
 * gestes, mêmes badges. Le but de l'extraction est que TOUTE surface qui liste
 * des fichiers (espace personnel, coffre partagé, résultats de recherche…)
 * rende EXACTEMENT la même carte, sans copie.
 *
 * Aucun contexte implicite : tout arrive par les props. Le composant ne lit ni
 * Redux ni la route — la seule exception est `SyncBadge`, qui est lui-même un
 * composant connecté et qui se rend `null` hors mode cloud. (i18n, lui, est
 * lu ici : les infobulles des pastilles sont à la carte, pas à l'appelant.)
 *
 * Le modèle d'élément attendu (`ExplorerItem`) est volontairement MINIMAL :
 * `{ id, name, type?, size?, updatedAt?, items? }`. La présence de `items`
 * marque un dossier — c'est le même test que dans FolderView (`'items' in item`).
 */

import React, { useState, useEffect, useRef, FC, MouseEvent, ChangeEvent, DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CircularProgress } from '../ui/ProgressBar/CircularProgress';
import { SpringDwellRing } from '../ui/SpringDwellRing';
import SyncBadge from '../sync/SyncBadge';
import { SharedBadge } from './SharedBadge';
import { ThreadBadgeChip } from './ThreadBadgeChip';
import { FavoriteBadge, MentionBadge } from './MarkBadges';
import { VaultIcon } from './itemContextMenu';
import { readFile } from '../../../services/core/fileService';
import { getFileTypeInfo, isImageFile } from '../../../utils/fileTypeIcons';
import type { HierarchicalTag, ViewMode } from '../../../types';

/**
 * Forme minimale d'un élément affichable dans une carte.
 *
 * `FileItem` et `Folder` (les types Redux de l'espace personnel) y sont
 * assignables tels quels ; un élément de coffre partagé peut l'implémenter sans
 * fabriquer une fausse entité Redux.
 */
export interface ExplorerItem {
  id: string;
  name: string;
  /** Type MIME, s'il est connu. Affine seulement le choix de l'icône. */
  type?: string;
  size?: number;
  updatedAt?: string;
  /** Présence de `items` = l'élément est un dossier. */
  items?: string[];
}

/**
 * L'état d'un RACCOURCI vers un coffre partagé, tel que l'hôte le calcule
 * (`store/selectors/fileShortcutSelectors`) — la carte ne fait qu'afficher :
 *   live    : le coffre est ouvert et l'élément y est — le clic ouvre ;
 *   locked  : coffre verrouillé ou pas encore lu — on ne sait pas encore ;
 *   missing : coffre lu, l'élément n'y est plus ;
 *   gone    : le coffre n'est plus accessible ;
 *   unknown : la liste des coffres n'est pas encore chargée.
 */
export type FileCardShortcutState = 'live' | 'locked' | 'missing' | 'gone' | 'unknown';

export interface FileCardShortcut {
  /** Le nom du coffre, ou « Coffre partagé » quand il est verrouillé (sans nom lisible). */
  label: string;
  state: FileCardShortcutState;
}

/**
 * CE QUE LA CARTE MONTRE À LA PLACE D'UN FICHIER — une NOTE, ou une note
 * intégrée. Absent = fichier ordinaire, et c'est le seul repli : la carte ne
 * devine pas un genre depuis un nom ou un MIME.
 *
 * Pourquoi la carte a besoin de le savoir, alors qu'elle sait déjà déduire une
 * icône du nom : une note de coffre n'a PAS d'extension. « Compte rendu » et
 * « Contrat » rendaient la même icône générique, la même ligne, la même tuile —
 * on ne distinguait une note d'un fichier qu'en l'ouvrant. Le genre vient donc
 * de l'appelant (`vaultItemKind`), qui lit `itemType`, jamais le nom.
 */
export type FileCardKind = 'note' | 'transclusion';

// Props pour FileCard
export interface FileCardProps<T extends ExplorerItem = ExplorerItem> {
  item: T;
  /**
   * Dossier PERSONNEL propriétaire du fichier, utilisé pour lire le contenu et
   * en tirer une vignette. Laisser vide quand le contenu n'est pas lisible
   * localement (coffre partagé, contenu encore chiffré à distance) : la carte
   * retombe alors sur l'icône de type déduite du nom.
   */
  folderId?: string;
  isSelected: boolean;
  onSelect: (itemId: string) => void;
  onItemClick: (item: T) => void;
  onItemDoubleClick?: (item: T) => void;
  viewMode: ViewMode;
  onRename?: (itemId: string) => void;
  onDelete?: (itemId: string) => void;
  onDownload?: (itemId: string) => void;
  onContextMenu?: (e: MouseEvent<HTMLDivElement>, item: T) => void;
  onDragStart?: (e: DragEvent<HTMLDivElement>, item: T) => void;
  /** Pre-materialize the decrypted temp file so native drag-out starts in-gesture. */
  onDragPrewarm?: (item: T) => void;
  onDragEnd?: () => void;
  onDragOver?: (e: DragEvent<HTMLDivElement>, itemId: string) => void;
  onDragEnter?: (e: DragEvent<HTMLDivElement>, itemId: string) => void;
  onDragLeave?: (e: DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: DragEvent<HTMLDivElement>, itemId: string) => void;
  isDraggedOver?: boolean;
  isDragging?: boolean;
  /**
   * Cet élément est un DOSSIER armé pour l'ouverture automatique : la carte
   * s'allume et son pourtour montre le temps restant. Sans effet sur un fichier
   * — la carte d'un fichier ne s'ouvre jamais toute seule.
   */
  isSpringTarget?: boolean;
  /** Déplacement de cet élément en vol : la carte est gelée le temps de l'aller-retour */
  isMoving?: boolean;
  tags?: HierarchicalTag[];
  hasReminder?: boolean;
  isItemProtected?: boolean;
  isItemUnlocked?: boolean;
  offlineStatus?: 'synced' | 'syncing' | 'failed' | 'pinned-pending' | 'not-pinned';
  /**
   * Avec combien de personnes cet élément est partagé (grants vivants). Absent
   * ou 0 = pas de badge. Deux PRIMITIVES et non un objet `{ count, title }` :
   * cette carte est `React.memo`, et un objet recréé à chaque rendu de
   * l'appelant la ferait se re-rendre à chaque tick — précisément ce que le
   * memo est là pour éviter sur une grille de cent cartes.
   */
  sharedCount?: number;
  /** L'infobulle du badge de partage, déjà traduite (« Partagé avec 3 personnes »). */
  sharedTitle?: string;
  /**
   * UN FIL DE DISCUSSION existe sur cet élément — le nombre de racines NON
   * résolues. Absent = pas de fil, donc pas de pastille ; `0` = fil résolu,
   * pastille SOURDE (un fil résolu reste un fil, et le faire disparaître
   * effacerait la conversation de la vue).
   *
   * Trois PRIMITIVES et non un objet, pour la même raison que `sharedCount` :
   * cette carte est `React.memo`, et un objet recréé à chaque rendu de l'hôte
   * la ferait se re-rendre à chaque tick.
   */
  commentOpen?: number;
  /**
   * Le compte est-il DIGNE DE FOI ? À faux, la pastille se dessine SANS
   * nombre : le tampon manque ou a vieilli (voir `services/vault/threadStamp`).
   * Mieux vaut une pastille muette qu'un chiffre démenti à l'ouverture du fil.
   */
  commentExact?: boolean;
  /** L'infobulle du badge de discussion, déjà traduite. */
  commentTitle?: string;
  /**
   * Cet élément est un RACCOURCI vers un coffre partagé : ses octets sont
   * partis là-bas, seule la fiche reste ici (`FileItem.vaultRef`). La carte ne
   * lit pas Redux, donc l'hôte lui dit où en est le coffre : le libellé et
   * l'état. L'objet vient d'une Map mémoïsée côté hôte — même référence tant
   * que rien n'a bougé, donc compatible avec le `React.memo` de la carte.
   * Effets : vignette « coffre » (jamais de lecture d'octets), pastille dans la
   * barre d'info, infobulle honnête, et PAS d'export Alt+glisser.
   */
  shortcut?: FileCardShortcut;
  /**
   * Cet élément est une NOTE (ou une note intégrée) et non un fichier : vignette
   * dédiée et pastille de genre, dans les DEUX vues. Absent = fichier ordinaire,
   * rendu exactement comme avant.
   */
  kind?: FileCardKind;
  /**
   * Cet élément est dans MES favoris (★) — personnel, scellé, suit la personne
   * d'un appareil à l'autre. Absent ou faux = pas de pastille.
   */
  favorite?: boolean;
  /** L'infobulle du favori, déjà traduite. */
  favoriteTitle?: string;
  /**
   * Des MENTIONS NON LUES me visent dans cet élément — leur nombre. Absent ou
   * 0 = pas de pastille ; marquer lu la fait disparaître partout.
   */
  mentionCount?: number;
  /** L'infobulle des mentions, déjà traduite. */
  mentionTitle?: string;
}

export const FileIcon: FC = () => (
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

export const FolderIcon: FC = () => (
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

/**
 * Vignette d'un élément.
 *
 * TOLÈRE un élément SANS contenu local : sans `folderId`, aucune lecture n'est
 * tentée et le rendu retombe immédiatement sur l'icône de type déduite du nom
 * via `getFileTypeInfo(name, type)`. Même repli si la lecture échoue (contenu
 * encore chiffré à distance, fichier absent du cache) — le `catch` est muet et
 * laisse l'icône en place. C'est ce qui permet au navigateur de coffre partagé
 * de rendre la MÊME carte sans jamais déchiffrer quoi que ce soit.
 */
export const FileThumbnail: FC<{
  item: ExplorerItem;
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
    const fileTypeInfo = !isFolder ? getFileTypeInfo(item.name, item.type) : null;
    const isImage = !isFolder && isImageFile(item.name);
    const isPdf = !isFolder && item.name.toLowerCase().endsWith('.pdf');
    // Types we can render a real preview thumbnail for.
    const isThumbable = isImage || isPdf;

    // Lazy visibility detection — only load thumbnail when element enters viewport
    useEffect(() => {
      if (!isThumbable || !folderId) return;
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
    }, [isThumbable, folderId]);

    useEffect(() => {
      if (!isVisible || !isThumbable || !folderId) return;
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
          const arrayBuffer = data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength
          ) as ArrayBuffer;
          const THUMB_MAX = 400;

          // PDF: render page 1 to a canvas via pdfjs (dynamically imported so it
          // stays out of the main bundle), then cache a JPEG.
          if (isPdf) {
            const [pdfjsLib, { pdfWorkerReady }] = await Promise.all([
              import('pdfjs-dist'),
              import('../../../utils/pdfWorker'),
            ]);
            await pdfWorkerReady;
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
            if (cancelled) return;
            const page = await pdf.getPage(1);
            const base = page.getViewport({ scale: 1 });
            const scale = Math.min(THUMB_MAX / base.width, 1.5);
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            await page.render({ canvasContext: ctx, viewport }).promise;
            if (cancelled) return;
            const thumbBlob = await new Promise<Blob | null>((resolve) =>
              canvas.toBlob(resolve, 'image/jpeg', 0.85)
            );
            if (cancelled || !thumbBlob) return;
            const pdfUrl = URL.createObjectURL(thumbBlob);
            setThumbCached(folderId, item.name, pdfUrl);
            if (!cancelled) setThumbnailUrl(pdfUrl);
            return;
          }

          const mimeType = item.type || 'image/jpeg';
          const fullBlob = new Blob([arrayBuffer], { type: mimeType });

          // Resize to thumbnail to reduce GPU memory and compositing cost during scroll
          // Full-res 4000x3000 = ~36MB GPU memory vs 400x300 = ~0.5MB
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
      item.type,
      isThumbable,
      isPdf,
      isFolder,
      isItemProtected,
      isItemUnlocked,
    ]);

    // Hide thumbnail for protected locked files
    const showThumbnail = isThumbable && thumbnailUrl && (!isItemProtected || isItemUnlocked);

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
export const EMPTY_TAGS: HierarchicalTag[] = [];

// Composant FileTagPills — pastilles de tags colorées
export const FileTagPills: FC<{ tags: HierarchicalTag[]; compact?: boolean }> = React.memo(
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

/**
 * La vignette d'un RACCOURCI : le cadenas du coffre sur fond primaire — jamais
 * `FileThumbnail`, qui tenterait de lire des octets qui ne sont plus ici. Un
 * raccourci qui n'est pas « vivant » (coffre verrouillé, parti, élément
 * absent) est estompé : la carte dit d'un coup d'œil qu'elle n'ouvrira pas.
 */
/**
 * Le crayon des notes — LE MÊME tracé que celui des cartes de l'accueil
 * (`ResumeWidget`), et c'est tout l'intérêt : une note doit se reconnaître au
 * même signe partout, sinon chaque surface enseigne une convention de plus.
 *
 * EXPORTÉ pour le panneau de détails, qui a le même besoin — dire « note » sans
 * passer par une extension qu'une note n'a pas. Le recopier là-bas ferait
 * exactement ce que cet en-tête interdit : un deuxième signe pour la même chose.
 */
export const NoteGlyph: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.6}
    stroke="currentColor"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"
    />
  </svg>
);

/**
 * La vignette d'une NOTE. Elle remplace `FileThumbnail` plutôt que de s'y
 * ajouter : une note n'a ni octets prévisualisables, ni extension d'où tirer une
 * icône, et la laisser retomber sur l'icône générique est exactement ce qui la
 * rendait indistincte d'un fichier inconnu.
 *
 * Teinte `info`, jamais `primary` : `primary` est déjà la couleur du COFFRE
 * (raccourcis, pastilles de vault). Deux choses différentes ne peuvent pas
 * porter la même couleur sur la même grille.
 */
const NoteThumbnail: FC<{ size: 'grid' | 'list' }> = ({ size }) => {
  if (size === 'grid') {
    return (
      <div className="h-[140px] flex items-center justify-center bg-[var(--color-info-50)]">
        <div className="[&_svg]:w-14 [&_svg]:h-14 text-[var(--color-info-600)] opacity-80">
          <NoteGlyph />
        </div>
      </div>
    );
  }
  return (
    <div
      className="w-8 h-8 shrink-0 rounded flex items-center justify-center bg-[var(--color-info-50)]
        text-[var(--color-info-600)] [&_svg]:w-5 [&_svg]:h-5"
    >
      <NoteGlyph />
    </div>
  );
};

/**
 * La pastille « Note » / « Note intégrée » — même grammaire que `ShortcutPill`
 * (même forme, même taille, même place), parce que c'est déjà ce que la carte
 * utilise pour dire « ceci n'est pas un fichier ordinaire ».
 *
 * ELLE DOUBLE LA VIGNETTE À DESSEIN. L'icône seule demande de connaître le
 * signe ; le mot le dit. Les deux ensemble, c'est ce qui permet de reconnaître
 * une note SANS lire le nom du fichier — la demande exacte.
 */
const KindPill: FC<{ kind: FileCardKind }> = ({ kind }) => {
  const { t } = useTranslation();
  const label =
    kind === 'transclusion'
      ? t('teamVaults.items.kindTransclusion', 'Note intégrée')
      : t('teamVaults.items.kindNote', 'Note');
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium
        leading-none whitespace-nowrap min-w-0 max-w-full
        text-[var(--color-info-700)] bg-[var(--color-info-50)]"
      title={label}
    >
      <span className="shrink-0 [&_svg]:w-3 [&_svg]:h-3" aria-hidden="true">
        <NoteGlyph />
      </span>
      <span className="truncate">{label}</span>
    </span>
  );
};

const ShortcutThumbnail: FC<{ size: 'grid' | 'list'; state: FileCardShortcutState }> = ({
  size,
  state,
}) => {
  const muted = state !== 'live';
  if (size === 'grid') {
    return (
      <div className="h-[140px] flex items-center justify-center bg-[var(--color-primary-50)]">
        <div
          className={`[&_svg]:w-14 [&_svg]:h-14 text-[var(--color-primary-500)] ${muted ? 'opacity-40' : 'opacity-70'}`}
        >
          <VaultIcon />
        </div>
      </div>
    );
  }
  return (
    <div
      className={`w-8 h-8 shrink-0 rounded flex items-center justify-center bg-[var(--color-primary-50)]
        text-[var(--color-primary-500)] [&_svg]:w-5 [&_svg]:h-5 ${muted ? 'opacity-60' : ''}`}
    >
      <VaultIcon />
    </div>
  );
};

/** Le petit cadenas fermé de la pastille d'un raccourci verrouillé / inconnu. */
const ShortcutLockGlyph: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2.5}
    stroke="currentColor"
    className="w-3 h-3 shrink-0"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
    />
  </svg>
);

/**
 * La pastille « Coffre <nom> » d'un raccourci, teintée par l'état : primaire
 * (vivant), neutre avec cadenas (verrouillé / pas encore chargé),
 * avertissement (absent / parti). Le fond d'avertissement passe par
 * `color-mix` : l'opacité Tailwind (`/15`) ne s'applique pas à un `var(--…)`.
 */
const ShortcutPill: FC<{ shortcut: FileCardShortcut; title?: string }> = ({ shortcut, title }) => {
  const { t } = useTranslation();
  const warn = shortcut.state === 'missing' || shortcut.state === 'gone';
  const neutral = shortcut.state === 'locked' || shortcut.state === 'unknown';
  const tone = warn
    ? 'text-[var(--color-warning-600)]'
    : neutral
      ? 'text-[var(--color-text-secondary)] bg-[var(--color-background-secondary)]'
      : 'text-[var(--color-primary-700)] bg-[var(--color-primary-50)]';
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium leading-none whitespace-nowrap min-w-0 max-w-full ${tone}`}
      style={
        warn
          ? { backgroundColor: 'color-mix(in srgb, var(--color-warning-500) 15%, transparent)' }
          : undefined
      }
      title={title}
    >
      {neutral ? (
        <ShortcutLockGlyph />
      ) : (
        <span className="shrink-0 [&_svg]:w-3 [&_svg]:h-3" aria-hidden="true">
          <VaultIcon />
        </span>
      )}
      <span className="truncate">
        {t('teamVaults.shortcut.pill', 'Coffre {{name}}', { name: shortcut.label })}
      </span>
    </span>
  );
};

// Fonctions utilitaires au niveau module (hors composant pour ne pas casser React.memo)
export const formatSize = (bytes: number | undefined, isFolder: boolean): string => {
  if (!bytes || isFolder) return '-';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
};

export const formatDate = (date: string | undefined): string => {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

/**
 * Voile d'attente sur une carte dont le déplacement est en vol : l'élément reste
 * affiché à sa place (aucun retrait optimiste — le stockage hybride peut
 * retomber sur le local et le déplacement échouer), mais il cesse d'être
 * manipulable le temps de l'aller-retour. L'hôte doit être `relative`.
 *
 * C'est CE voile qui atténue la carte, et non plus un `opacity-50` posé sur
 * l'hôte : l'opacité de l'hôte s'appliquait aussi au témoin, qui se retrouvait à
 * moitié transparent — un rond pâle sur une carte pâle, que personne ne voyait.
 * Ici la carte passe derrière un voile de surface et le témoin reste net.
 */
export const MovingOverlay: FC = () => (
  <span className="move-pending-veil">
    <span className="move-pending-veil__chip">
      <CircularProgress size="sm" indeterminate />
    </span>
  </span>
);

// Composant FileCard (memoized pour eviter les re-renders lors de la selection)
const FileCardInner = React.memo(
  <T extends ExplorerItem>({
    item,
    folderId: cardFolderId,
    isSelected,
    onSelect,
    onItemClick,
    onItemDoubleClick,
    viewMode,
    onContextMenu,
    onDragStart,
    onDragPrewarm,
    onDragEnd,
    onDragOver,
    onDragEnter,
    onDragLeave,
    onDrop,
    isDraggedOver,
    isDragging,
    isSpringTarget,
    isMoving,
    tags,
    hasReminder,
    isItemProtected = false,
    isItemUnlocked = false,
    offlineStatus,
    sharedCount,
    sharedTitle,
    commentOpen,
    commentExact,
    commentTitle,
    shortcut,
    kind,
    favorite,
    favoriteTitle,
    mentionCount,
    mentionTitle,
  }: FileCardProps<T>) => {
    const { t } = useTranslation();
    const isFolder = 'items' in item;
    // Une NOTE n'a pas d'extension : lui chercher une icône de type rendrait
    // l'icône générique — celle qui la confondait avec n'importe quel fichier.
    const isNote = !isFolder && !!kind;
    const fileTypeInfo = !isFolder && !isNote ? getFileTypeInfo(item.name, item.type) : null;

    // Les infobulles communes aux deux branches (liste / grille), traduites une fois.
    const altDragTitle = !isFolder
      ? t('file.altDragExport', 'Alt+glisser pour exporter vers le bureau')
      : undefined;
    /**
     * L'infobulle d'un RACCOURCI dit ce que le clic FERA, par état — et jamais
     * « Alt+glisser pour exporter » : il n'y a pas d'octets à exporter ici.
     */
    const shortcutTitle = shortcut
      ? shortcut.state === 'live'
        ? t('teamVaults.shortcut.titleLive', 'S’ouvre dans le coffre {{name}}', {
            name: shortcut.label,
          })
        : shortcut.state === 'locked'
          ? t(
              'teamVaults.shortcut.titleLocked',
              'Coffre verrouillé — déverrouillez-le pour l’ouvrir'
            )
          : shortcut.state === 'missing'
            ? t('teamVaults.shortcut.titleMissing', 'Introuvable dans le coffre {{name}}', {
                name: shortcut.label,
              })
            : shortcut.state === 'gone'
              ? t('teamVaults.shortcut.titleGone', 'Le coffre n’est plus accessible')
              : t('teamVaults.shortcut.titleUnknown', 'Coffres en cours de chargement…')
      : undefined;
    const cardTitle = shortcut ? shortcutTitle : altDragTitle;
    /**
     * Le glisser d'un raccourci reste un glisser INTERNE (déplacer la fiche
     * d'un dossier à l'autre) ; Alt+glisser, qui exporterait des octets vers
     * le bureau, est refusé net — il n'y en a pas.
     */
    const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
      if (shortcut && e.altKey) {
        e.preventDefault();
        return;
      }
      if (onDragStart) onDragStart(e, item);
    };
    const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
      if (shortcut) return;
      if (e.altKey && onDragPrewarm) onDragPrewarm(item);
    };
    const offlineTitle =
      offlineStatus === 'synced'
        ? t('offline.statusSynced', 'Disponible hors ligne')
        : offlineStatus === 'syncing' || offlineStatus === 'pinned-pending'
          ? t('offline.statusSyncing', 'Synchronisation en cours...')
          : t('offline.statusFailed', 'Échec de synchronisation');

    if (viewMode === 'list') {
      return (
        <div
          data-item-id={item.id}
          className={`group relative grid grid-cols-[40px_40px_1fr_100px_160px_48px] items-center px-4 py-3
          cursor-pointer select-none [contain:layout_style]
          hover:bg-[var(--color-background-secondary)]
          border-b border-[var(--color-border-light)] last:border-b-0
          ${isDraggedOver ? 'ring-2 ring-inset ring-[var(--color-primary-400)]' : ''}
          ${isDragging ? 'opacity-50' : ''}
          ${isMoving ? 'pointer-events-none' : ''}
          ${isSelected ? 'bg-[var(--color-primary-50)]' : ''}`}
          style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 56px' }}
          title={cardTitle}
          draggable
          onClick={() => onItemClick(item)}
          onDoubleClick={() => onItemDoubleClick && onItemDoubleClick(item)}
          onContextMenu={(e) => onContextMenu && onContextMenu(e, item)}
          onDragStart={handleDragStart}
          onMouseDown={handleMouseDown}
          onDragEnd={() => onDragEnd && onDragEnd()}
          onDragOver={(e) => isFolder && onDragOver && onDragOver(e, item.id)}
          onDragEnter={(e) => isFolder && onDragEnter && onDragEnter(e, item.id)}
          onDragLeave={(e) => isFolder && onDragLeave && onDragLeave(e)}
          onDrop={(e) => isFolder && onDrop && onDrop(e, item.id)}
        >
          {isSpringTarget && <SpringDwellRing />}
          {isMoving && <MovingOverlay />}
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
          {shortcut ? (
            <ShortcutThumbnail size="list" state={shortcut.state} />
          ) : isNote && kind ? (
            <NoteThumbnail size="list" />
          ) : (
            <FileThumbnail
              item={item}
              folderId={cardFolderId}
              size="list"
              isItemProtected={isItemProtected}
              isItemUnlocked={isItemUnlocked}
            />
          )}
          <div className="text-sm font-medium text-[var(--color-text-primary)] truncate pr-4 flex items-center gap-1.5">
            <span className="truncate">{item.name}</span>
            {shortcut && <ShortcutPill shortcut={shortcut} title={shortcutTitle} />}
            {isNote && kind && <KindPill kind={kind} />}
            {hasReminder && (
              <span
                className="shrink-0 text-amber-500"
                title={t('reminder.scheduledBadge', 'Rappel programmé')}
              >
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
                  isItemUnlocked
                    ? t('password.unlockedSession', 'Déverrouillé pour cette session')
                    : t('password.protected', 'Protégé par mot de passe')
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
            {/* Partage : après le cadenas, avant le hors-ligne — la pilule
                inline, même gabarit que les tags qui suivent. */}
            {typeof sharedCount === 'number' && sharedCount > 0 && (
              <SharedBadge
                variant="inline"
                count={sharedCount}
                title={sharedTitle ?? ''}
                className="shrink-0"
              />
            )}
            {/* Discussion : juste après le partage — les deux disent « d'autres
                gens sont sur ce fichier », et se lisent ensemble. */}
            {typeof commentOpen === 'number' && (
              <ThreadBadgeChip
                variant="inline"
                open={commentOpen}
                exact={commentExact !== false}
                title={commentTitle ?? ''}
                className="shrink-0"
              />
            )}
            {/* Les MARQUAGES qui me concernent — mes favoris, les mentions
                qui me visent — après ce qui concerne les autres. */}
            {typeof mentionCount === 'number' && mentionCount > 0 && (
              <MentionBadge
                variant="inline"
                count={mentionCount}
                title={mentionTitle ?? ''}
                className="shrink-0"
              />
            )}
            {favorite && (
              <FavoriteBadge variant="inline" title={favoriteTitle ?? ''} className="shrink-0" />
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
                title={offlineTitle}
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
            {formatSize(item.size, isFolder)}
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
        ${isMoving ? 'pointer-events-none' : ''}
        ${isSelected ? 'ring-2 ring-[var(--color-primary-400)] border-[var(--color-primary-300)]' : ''}`}
        style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 220px' }}
        title={cardTitle}
        onClick={() => onItemClick(item)}
        onDoubleClick={() => onItemDoubleClick && onItemDoubleClick(item)}
        onContextMenu={(e) => onContextMenu && onContextMenu(e, item)}
        draggable
        onDragStart={handleDragStart}
        onMouseDown={handleMouseDown}
        onDragEnd={() => onDragEnd && onDragEnd()}
        onDragOver={(e) => isFolder && onDragOver && onDragOver(e, item.id)}
        onDragEnter={(e) => isFolder && onDragEnter && onDragEnter(e, item.id)}
        onDragLeave={(e) => isFolder && onDragLeave && onDragLeave(e)}
        onDrop={(e) => isFolder && onDrop && onDrop(e, item.id)}
      >
        {isSpringTarget && <SpringDwellRing />}
        {isMoving && <MovingOverlay />}

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

        {/* Preview area — ni un raccourci ni une note n'ont d'octets à prévisualiser */}
        {shortcut ? (
          <ShortcutThumbnail size="grid" state={shortcut.state} />
        ) : isNote && kind ? (
          <NoteThumbnail size="grid" />
        ) : (
          <FileThumbnail
            item={item}
            folderId={cardFolderId}
            size="grid"
            isItemProtected={isItemProtected}
            isItemUnlocked={isItemUnlocked}
          />
        )}

        {/* Le coin HAUT-DROIT : UN groupe en flux (patron FolderGridWidget),
            ordre partage → rappel → cadenas. Avant, chaque pastille se posait
            en absolu et le rappel existait en DEUX exemplaires (right-2 seul,
            right-10 à côté du cadenas) pour ne pas se superposer ; avec le
            badge de partage il en aurait fallu quatre. Le flux règle la
            question structurellement : chaque pastille se rend une fois, et
            prend la place que les autres lui laissent. */}
        <div className="absolute top-2 right-2 flex items-center gap-1.5">
          {typeof sharedCount === 'number' && sharedCount > 0 && (
            <SharedBadge variant="corner" count={sharedCount} title={sharedTitle ?? ''} />
          )}
          {typeof commentOpen === 'number' && (
            <ThreadBadgeChip
              variant="corner"
              open={commentOpen}
              exact={commentExact !== false}
              title={commentTitle ?? ''}
            />
          )}
          {typeof mentionCount === 'number' && mentionCount > 0 && (
            <MentionBadge variant="corner" count={mentionCount} title={mentionTitle ?? ''} />
          )}
          {favorite && <FavoriteBadge variant="corner" title={favoriteTitle ?? ''} />}
          {hasReminder && (
            <div
              className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-500/90 text-white shadow-sm"
              title={t('reminder.scheduledBadge', 'Rappel programmé')}
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
          {isItemProtected && (
            <div
              className={`flex items-center justify-center w-7 h-7 rounded-full shadow-sm
            ${isItemUnlocked ? 'bg-green-500/90 text-white' : 'bg-slate-700/80 text-white'}`}
              title={
                isItemUnlocked
                  ? t('password.unlockedSession', 'Déverrouillé pour cette session')
                  : t('password.protected', 'Protégé par mot de passe')
              }
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
        </div>

        {/* Offline sync badge */}
        {offlineStatus && offlineStatus !== 'not-pinned' && (
          <div
            className={`absolute bottom-[52px] left-2 flex items-center justify-center w-5 h-5 rounded-full shadow-sm
              ${offlineStatus === 'synced' ? 'bg-emerald-500/90 text-white' : ''}
              ${offlineStatus === 'syncing' || offlineStatus === 'pinned-pending' ? 'bg-[var(--color-primary-500)]/90 text-white' : ''}
              ${offlineStatus === 'failed' ? 'bg-red-500/90 text-white' : ''}
            `}
            title={offlineTitle}
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

        {/* Cloud sync badge — en bas à droite, symétrique du badge hors-ligne
            (bas-gauche) : le coin haut-droit appartient au groupe ci-dessus.
            Pas pour un raccourci : rien à synchroniser, les octets sont ailleurs. */}
        {!shortcut && (
          <SyncBadge
            fileId={item.id}
            folderId={cardFolderId}
            fileName={item.name}
            positionClassName="absolute bottom-[52px] right-2"
          />
        )}

        {/* Info bar */}
        <div className="flex items-center gap-2.5 px-3 py-2.5 border-t border-[var(--color-border-light)]">
          <div
            className="shrink-0 [&_svg]:w-5 [&_svg]:h-5"
            style={{
              color: shortcut
                ? 'var(--color-primary-500)'
                : isNote
                  ? 'var(--color-info-600)'
                  : fileTypeInfo?.color || 'var(--color-primary-500)',
            }}
          >
            {shortcut ? (
              <VaultIcon />
            ) : isNote ? (
              <NoteGlyph />
            ) : isFolder ? (
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
          {shortcut && (
            <span className="shrink-0 max-w-[45%] min-w-0 flex">
              <ShortcutPill shortcut={shortcut} title={shortcutTitle} />
            </span>
          )}
          {isNote && kind && (
            <span className="shrink-0 max-w-[45%] min-w-0 flex">
              <KindPill kind={kind} />
            </span>
          )}
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

FileCardInner.displayName = 'FileCard';

/**
 * `React.memo` efface le paramètre de type : on le restaure par assertion, pour
 * que l'appelant garde SES types d'items (`Item` côté personnel, la ligne de
 * coffre côté partagé) jusque dans les handlers, sans `any` ni cast au point
 * d'appel. L'objet rendu est bien le composant mémoïsé.
 */
export const FileCard = FileCardInner as unknown as (<T extends ExplorerItem>(
  props: FileCardProps<T>
) => React.ReactElement | null) & { displayName?: string };
