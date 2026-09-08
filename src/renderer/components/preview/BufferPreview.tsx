/**
 * BufferPreview — le dispatch d'aperçu pour des OCTETS DÉJÀ EN MÉMOIRE.
 *
 * CE QUE SON ABSENCE COÛTAIT. L'application possède dix-neuf familles de
 * visionneuses — PDF, tableur, docx, EPUB, 3D, courriel… — et un élément de
 * COFFRE PARTAGÉ n'en bénéficiait d'aucune : « consulter » signifiait
 * télécharger, c'est-à-dire déposer du CLAIR dans le dossier Téléchargements
 * pour une simple lecture. L'aperçu est donc autant un gain de confort qu'un
 * gain de sécurité : les octets déchiffrés restent en mémoire.
 *
 * ADAPTATEUR, PAS COPIE. `FilePreviewPanel` reste le panneau des fichiers
 * personnels — couplé à FileItem, aux dossiers, aux chemins fenêtrés du
 * bureau. Ici ne vit que sa moitié bufferisée : le même `getPreviewType`
 * (importé, jamais dupliqué — deux tables divergeraient) et les mêmes
 * visionneuses, alimentées par un ArrayBuffer d'où qu'il vienne. Les formats
 * dont la visionneuse exige un flux fenêtré (grosses archives, vidéos en
 * streaming) tombent sur le repli « télécharger pour ouvrir » — dégradation
 * annoncée, pas une erreur.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { getPreviewType } from './FilePreviewPanel';
import { ImagePreview } from './ImagePreview';
import { PDFPreview } from './PDFPreview';
import { MarkdownPreview } from './MarkdownPreview';
import { DocxPreview } from './DocxPreview';
import { CsvPreview } from './CsvPreview';
import { HtmlPreview } from './HtmlPreview';
import { SpreadsheetPreview } from './SpreadsheetPreview';
import { RasterImagePreview } from './RasterImagePreview';
import { EpubPreview } from './EpubPreview';
import { ArchivePreview } from './ArchivePreview';
import { IcsPreview } from './IcsPreview';
import { FontPreview } from './FontPreview';
import { EmailPreview } from './EmailPreview';
import { Model3DPreview } from './Model3DPreview';
import { TextPreview } from './TextPreview';
import { VideoPreview } from './VideoPreview';
import { AudioPreview } from './AudioPreview';

export interface BufferPreviewProps {
  /** Les octets DÉCHIFFRÉS du document — jamais écrits sur disque ici. */
  data: ArrayBuffer;
  fileName: string;
  className?: string;
}

/** MIME approché depuis l'extension — suffisant pour <img>/<video>/<audio>. */
function mimeFromName(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const table: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    mp4: 'video/mp4',
    webm: 'video/webm',
    ogg: 'video/ogg',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    flac: 'audio/flac',
    aac: 'audio/aac',
    m4a: 'audio/mp4',
    wma: 'audio/x-ms-wma',
  };
  return table[ext] ?? 'application/octet-stream';
}

export const BufferPreview: React.FC<BufferPreviewProps> = ({ data, fileName, className }) => {
  const { t } = useTranslation();
  const type = getPreviewType(fileName);
  const extension = fileName.split('.').pop()?.toLowerCase() || '';

  switch (type) {
    case 'image':
      return (
        <ImagePreview
          data={data}
          fileName={fileName}
          mimeType={mimeFromName(fileName)}
          className={className}
        />
      );
    case 'pdf':
      return <PDFPreview data={data} fileName={fileName} className={className} />;
    case 'markdown':
      return <MarkdownPreview data={data} fileName={fileName} className={className} />;
    case 'docx':
      return <DocxPreview data={data} fileName={fileName} className={className} />;
    case 'csv':
      return <CsvPreview data={data} fileName={fileName} className={className} />;
    case 'html':
      return <HtmlPreview data={data} fileName={fileName} className={className} />;
    case 'spreadsheet':
      return (
        <SpreadsheetPreview
          data={data}
          fileName={fileName}
          extension={extension}
          className={className}
        />
      );
    case 'rasterimage':
      return <RasterImagePreview data={data} fileName={fileName} className={className} />;
    case 'epub':
      return <EpubPreview data={data} fileName={fileName} className={className} />;
    case 'archive':
      return <ArchivePreview data={data} fileName={fileName} className={className} />;
    case 'ics':
      return <IcsPreview data={data} fileName={fileName} className={className} />;
    case 'font':
      return <FontPreview data={data} fileName={fileName} className={className} />;
    case 'email':
      return <EmailPreview data={data} fileName={fileName} className={className} />;
    case 'model3d':
      return <Model3DPreview data={data} fileName={fileName} className={className} />;
    case 'text':
      return (
        <TextPreview data={data} fileName={fileName} extension={extension} className={className} />
      );
    case 'video':
      return (
        <VideoPreview
          data={data}
          fileName={fileName}
          mimeType={mimeFromName(fileName)}
          className={className}
        />
      );
    case 'audio':
      return (
        <AudioPreview
          data={data}
          fileName={fileName}
          mimeType={mimeFromName(fileName)}
          className={className}
        />
      );
    default:
      return (
        <div className="flex items-center justify-center h-full p-6">
          <p className="text-sm text-[var(--color-text-secondary)] m-0 text-center">
            {t('teamVaults.preview.unsupported')}
          </p>
        </div>
      );
  }
};

export default BufferPreview;
