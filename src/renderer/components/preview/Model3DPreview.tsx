/**
 * Model3DPreview Component
 *
 * In-app preview for 3D models (.glb / .gltf) with orbit controls. The heavy
 * <model-viewer> web component is dynamically imported inside an effect so it
 * stays out of the main bundle, and the model bytes are turned into a local
 * object URL (nothing leaves the device — matches the offline/E2EE stance).
 */

import React, { useState, useEffect } from 'react';
import clsx from 'clsx';
import './MarkdownPreview.css';

export interface Model3DPreviewProps {
  /** Model data as ArrayBuffer */
  data: ArrayBuffer;
  /** File name */
  fileName: string;
  /** File extension (glb | gltf) */
  extension?: string;
  /** Additional CSS class */
  className?: string;
}

// <model-viewer> is a custom element registered at runtime by @google/model-viewer.
// Type it as a cast'd component rather than augmenting JSX.IntrinsicElements — a
// `namespace JSX` augmentation trips the project's no-namespace lint rule.
type ModelViewerProps = React.HTMLAttributes<HTMLElement> & {
  src?: string;
  'camera-controls'?: boolean | '';
  'auto-rotate'?: boolean | '';
};
const ModelViewer = 'model-viewer' as unknown as React.FC<ModelViewerProps>;

export const Model3DPreview: React.FC<Model3DPreviewProps> = ({ data, fileName, className }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setReady(false);
    setError(null);
    setUrl(null);

    // Importing @google/model-viewer registers the <model-viewer> custom
    // element as a side effect; it only needs to happen once but is cheap.
    import('@google/model-viewer')
      .then(() => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([data]));
        setUrl(objectUrl);
        setReady(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[Model3DPreview] Failed to load viewer:', err);
        setError(err instanceof Error ? err.message : 'Chargement impossible');
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [data]);

  const containerClasses = clsx('markdown-preview', className);

  return (
    <div className={containerClasses}>
      <div className="markdown-preview__toolbar">
        <div className="markdown-preview__toolbar-left">
          <span className="markdown-preview__badge">3D</span>
          <span className="markdown-preview__stats" title={fileName}>
            {fileName}
          </span>
        </div>
      </div>

      <div className="markdown-preview__container">
        {error ? (
          <div className="file-preview-panel__error">
            <span>Impossible d'afficher ce modèle 3D</span>
            <p className="file-preview-panel__error-message">{error}</p>
          </div>
        ) : !ready || !url ? (
          <div className="file-preview-panel__loading">
            <div className="file-preview-panel__spinner" />
            <span>Chargement du modèle 3D…</span>
          </div>
        ) : (
          <ModelViewer
            src={url}
            camera-controls
            auto-rotate
            style={{
              width: '100%',
              height: '100%',
              background: 'var(--color-background-secondary)',
            }}
          />
        )}
      </div>
    </div>
  );
};

export default Model3DPreview;
