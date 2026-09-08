/**
 * GalleryModal — Lightbox galerie d'images
 *
 * Navigation gauche/droite, compteur, barre de thumbnails,
 * mode diaporama, chargement lazy via readFile().
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { readFile } from '../../../services/core/fileService';
import type { FileItem } from '../../../types';

// La galerie couvre l'écran entier, barre de titre frameless comprise : sans
// réserve, « fermer la galerie » tombe sous le bouton Fermer natif. La classe
// est posée sur la RACINE plutôt que sur le bandeau — la racine ne porte
// aucun utilitaire de padding, donc rien ne peut écraser la réserve, et le
// bandeau descend entier sous la bande sans avoir besoin de réserve latérale.
// Mesurée, la valeur vaut 0 dans un navigateur et en fenêtre mini : plus rien
// à conditionner par plateforme. Voir styles/chrome.css.
const rootChromeInset = 'chrome-safe-top';

// ==================== Types ====================

interface GalleryModalProps {
  images: FileItem[];
  initialIndex: number;
  folderId: string;
  isOpen: boolean;
  onClose: () => void;
}

// ==================== Helpers ====================

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico']);

const getMimeType = (fileName: string): string => {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
  };
  return map[ext] || 'image/jpeg';
};

export const isImageItem = (item: FileItem): boolean => {
  const ext = item.name.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXTENSIONS.has(ext);
};

// ==================== Icons ====================

const ChevronLeftIcon: React.FC = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const ChevronRightIcon: React.FC = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const CloseIcon: React.FC = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const PlayIcon: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

const PauseIcon: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="4" width="4" height="16" />
    <rect x="14" y="4" width="4" height="16" />
  </svg>
);

// ==================== Component ====================

export const GalleryModal: React.FC<GalleryModalProps> = ({
  images,
  initialIndex,
  folderId,
  isOpen,
  onClose,
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [imageCache, setImageCache] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [slideshow, setSlideshow] = useState(false);
  const slideshowRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const thumbsRef = useRef<HTMLDivElement>(null);

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(initialIndex);
      setSlideshow(false);
    }
  }, [isOpen, initialIndex]);

  const currentImage = images[currentIndex];

  // Load image data
  const loadImage = useCallback(
    async (file: FileItem) => {
      if (imageCache.has(file.id)) return;
      try {
        const data = await readFile(folderId, file.name, true);
        const blob = new Blob([new Uint8Array(data)], { type: getMimeType(file.name) });
        const url = URL.createObjectURL(blob);
        setImageCache((prev) => new Map(prev).set(file.id, url));
      } catch (err) {
        console.error('[Gallery] Failed to load image:', file.name, err);
      }
    },
    [folderId, imageCache]
  );

  // Load current + adjacent images
  useEffect(() => {
    if (!isOpen || images.length === 0) return;

    setLoading(!imageCache.has(images[currentIndex].id));

    const toLoad = [
      images[currentIndex],
      images[(currentIndex + 1) % images.length],
      images[(currentIndex - 1 + images.length) % images.length],
    ];

    let cancelled = false;
    (async () => {
      for (const img of toLoad) {
        if (cancelled) break;
        await loadImage(img);
      }
      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, currentIndex, images, loadImage, imageCache]);

  // Navigate
  const goNext = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % images.length);
  }, [images.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
  }, [images.length]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          goNext();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          goPrev();
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case ' ':
          e.preventDefault();
          setSlideshow((prev) => !prev);
          break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, goNext, goPrev, onClose]);

  // Slideshow auto-advance
  useEffect(() => {
    if (slideshow) {
      slideshowRef.current = setInterval(goNext, 3000);
    } else if (slideshowRef.current) {
      clearInterval(slideshowRef.current);
      slideshowRef.current = null;
    }
    return () => {
      if (slideshowRef.current) clearInterval(slideshowRef.current);
    };
  }, [slideshow, goNext]);

  // Scroll thumbnail bar to keep current centered
  useEffect(() => {
    if (!thumbsRef.current) return;
    const activeThumb = thumbsRef.current.children[currentIndex] as HTMLElement;
    if (activeThumb) {
      activeThumb.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
    }
  }, [currentIndex]);

  // Cleanup blob URLs on close
  const imageCacheRef = useRef(imageCache);
  imageCacheRef.current = imageCache;
  useEffect(() => {
    if (!isOpen) {
      imageCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
      setImageCache(new Map());
    }
  }, [isOpen]);

  // Thumbnail blob URLs (reuse cache or show placeholder)
  const thumbUrls = useMemo(() => {
    return images.map((img) => imageCache.get(img.id) || null);
  }, [images, imageCache]);

  if (!isOpen || images.length === 0) return null;

  const currentUrl = imageCache.get(currentImage.id);

  return (
    <div
      /* chrome-safe-top : voir rootChromeInset en tete de fichier. */
      className={`fixed inset-0 z-50 flex flex-col bg-black/90 ${rootChromeInset}`}
      style={{ backdropFilter: 'blur(4px)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-white/90 text-sm font-medium truncate max-w-[300px]">
            {currentImage.name}
          </span>
          <span className="text-white/50 text-sm">
            {currentIndex + 1} / {images.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSlideshow((prev) => !prev)}
            className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            title={slideshow ? 'Pause (Espace)' : 'Diaporama (Espace)'}
          >
            {slideshow ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            title="Fermer (Échap)"
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      {/* Main image area */}
      <div className="flex-1 relative flex items-center justify-center min-h-0 px-16">
        {/* Nav buttons */}
        {images.length > 1 && (
          <>
            <button
              onClick={goPrev}
              className="absolute left-3 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/40 text-white/80 hover:text-white hover:bg-black/60 transition-colors z-10"
              title="Précédent"
            >
              <ChevronLeftIcon />
            </button>
            <button
              onClick={goNext}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-3 rounded-full bg-black/40 text-white/80 hover:text-white hover:bg-black/60 transition-colors z-10"
              title="Suivant"
            >
              <ChevronRightIcon />
            </button>
          </>
        )}

        {/* Image */}
        {loading && !currentUrl ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            <span className="text-white/50 text-sm">Chargement...</span>
          </div>
        ) : currentUrl ? (
          <img
            src={currentUrl}
            alt={currentImage.name}
            className="max-w-full max-h-full object-contain select-none"
            style={{ transition: 'opacity 0.2s' }}
            decoding="async"
            draggable={false}
          />
        ) : (
          <span className="text-white/50">Impossible de charger l'image</span>
        )}
      </div>

      {/* Thumbnail bar */}
      {images.length > 1 && (
        <div className="shrink-0 px-4 py-3 border-t border-white/10">
          <div
            ref={thumbsRef}
            className="flex gap-2 overflow-x-auto py-1"
            style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.2) transparent' }}
          >
            {images.map((img, idx) => (
              <button
                key={img.id}
                onClick={() => setCurrentIndex(idx)}
                className={`
                  shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition-all duration-150
                  ${
                    idx === currentIndex
                      ? 'border-white ring-1 ring-white/30 scale-105'
                      : 'border-transparent opacity-60 hover:opacity-90'
                  }
                `}
              >
                {thumbUrls[idx] ? (
                  <img
                    src={thumbUrls[idx]!}
                    alt={img.name}
                    className="w-full h-full object-cover"
                    decoding="async"
                    draggable={false}
                  />
                ) : (
                  <div className="w-full h-full bg-white/10 flex items-center justify-center">
                    <div className="w-4 h-4 border border-white/30 border-t-white/70 rounded-full animate-spin" />
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default GalleryModal;
