/**
 * RasterImagePreview Component
 *
 * In-app preview for image formats browsers cannot render natively — HEIC/HEIF
 * (Apple photos) and TIFF. The bytes are decoded and re-encoded to a PNG entirely
 * in the renderer (heic2any / utif2 are dynamically imported so they stay out of
 * the main bundle and no data ever leaves the device), then the resulting PNG is
 * handed off to the existing ImagePreview so zoom / pan / rotate come for free.
 */

import React, { useState, useEffect } from 'react';
import clsx from 'clsx';
import { ImagePreview } from './ImagePreview';
import './MarkdownPreview.css';

export interface RasterImagePreviewProps {
  /** Raw image data as ArrayBuffer */
  data: ArrayBuffer;
  /** File name */
  fileName: string;
  /** File extension (heic | heif | tif | tiff) */
  extension?: string;
  /** MIME type of the source image (used as a hint for HEIC decoding) */
  mimeType?: string;
  /** Callback when the (converted) image dimensions are loaded */
  onLoad?: (dimensions: { width: number; height: number }) => void;
  /** Additional CSS class */
  className?: string;
}

export const RasterImagePreview: React.FC<RasterImagePreviewProps> = ({
  data,
  fileName,
  extension,
  mimeType,
  onLoad,
  className,
}) => {
  const [pngBuffer, setPngBuffer] = useState<ArrayBuffer | null>(null);
  const [isConverting, setIsConverting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsConverting(true);
    setError(null);
    setPngBuffer(null);

    const ext = (extension || fileName.split('.').pop() || '').toLowerCase();

    const convert = async (): Promise<ArrayBuffer> => {
      // --- HEIC / HEIF → PNG -------------------------------------------------
      if (ext === 'heic' || ext === 'heif') {
        const heic2any = (await import('heic2any')).default;
        const out = await heic2any({
          blob: new Blob([data], { type: mimeType || 'image/heic' }),
          toType: 'image/png',
        });
        // heic2any may return a single Blob or an array (multi-image HEIC).
        const blob = Array.isArray(out) ? out[0] : out;
        return await blob.arrayBuffer();
      }

      // --- TIFF → PNG (decode → canvas → PNG) --------------------------------
      if (ext === 'tif' || ext === 'tiff') {
        const UTIF = await import('utif2');
        const ifds = UTIF.decode(data);
        if (!ifds.length) throw new Error('Aucune image trouvée dans le fichier TIFF');
        const page = ifds[0];
        UTIF.decodeImage(data, page);
        const rgba = UTIF.toRGBA8(page); // Uint8Array, RGBA 8bpc

        const canvas = document.createElement('canvas');
        canvas.width = page.width;
        canvas.height = page.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Contexte canvas 2D indisponible');

        const imageData = new ImageData(new Uint8ClampedArray(rgba), page.width, page.height);
        ctx.putImageData(imageData, 0, 0);

        const pngBlob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob((b) => resolve(b), 'image/png')
        );
        if (!pngBlob) throw new Error('Encodage PNG impossible');
        return await pngBlob.arrayBuffer();
      }

      throw new Error(`Format d'image non pris en charge : ${ext || 'inconnu'}`);
    };

    convert()
      .then((buffer) => {
        if (!cancelled) setPngBuffer(buffer);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[RasterImagePreview] Conversion error:', err);
        setError(err instanceof Error ? err.message : 'Conversion impossible');
      })
      .finally(() => {
        if (!cancelled) setIsConverting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [data, extension, fileName, mimeType]);

  if (error) {
    return (
      <div className={clsx('markdown-preview', className)}>
        <div className="markdown-preview__container">
          <div className="file-preview-panel__error">
            <span>Impossible d'afficher cette image</span>
            <p className="file-preview-panel__error-message">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (isConverting || !pngBuffer) {
    return (
      <div className={clsx('markdown-preview', className)}>
        <div className="markdown-preview__container">
          <div className="file-preview-panel__loading">
            <div className="file-preview-panel__spinner" />
            <span>Conversion de l'image…</span>
          </div>
        </div>
      </div>
    );
  }

  // Delegate to the native image viewer — zoom / pan / rotate for free.
  return (
    <ImagePreview
      data={pngBuffer}
      fileName={fileName}
      mimeType="image/png"
      onLoad={onLoad}
      className={className}
    />
  );
};

export default RasterImagePreview;
