/**
 * FdocPreview — lire un document Filarr sans ouvrir l'éditeur.
 *
 * Le rendu lui-même vit dans `utils/fdocRender`, en module PUR : c'est là que
 * se trouve la règle de sûreté (tout est échappé, les images distantes sont
 * refusées), et c'est là qu'elle se teste. Ce composant ne fait que l'afficher.
 *
 * `dangerouslySetInnerHTML` est employé sciemment. Le HTML n'est pas celui du
 * fichier : il est REconstruit nœud par nœud à partir de l'arbre JSON, avec une
 * liste blanche de balises et un échappement systématique. Rien du document ne
 * traverse sans passer par là.
 */

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { renderFdoc } from '../../../utils/fdocRender';
import './FdocPreview.css';

export interface FdocPreviewProps {
  data: ArrayBuffer;
  fileName: string;
  className?: string;
}

export const FdocPreview: React.FC<FdocPreviewProps> = ({ data, fileName, className }) => {
  const { t } = useTranslation();
  const rendu = useMemo(() => renderFdoc(new Uint8Array(data)), [data]);

  if (!rendu) {
    return (
      <div className="fdoc-preview__empty" role="status">
        {t('preview.fdoc.unreadable', 'Ce document ne peut pas être lu.')}
      </div>
    );
  }

  return (
    <div className={`fdoc-preview ${className || ''}`}>
      <div className="fdoc-preview__meta">
        {t('preview.fdoc.words', '{{count}} mot', { count: rendu.mots })}
      </div>
      <article
        className="fdoc-preview__page"
        aria-label={fileName}
        dangerouslySetInnerHTML={{ __html: rendu.html }}
      />
    </div>
  );
};

export default FdocPreview;
