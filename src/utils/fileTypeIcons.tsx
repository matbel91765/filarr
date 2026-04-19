import React, { FC } from 'react';

interface FileTypeInfo {
  icon: React.ReactNode;
  color: string;
}

// --- SVG Icon components ---

const ImageFileIcon: FC<{ size?: number }> = ({ size = 48 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={size} height={size}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
  </svg>
);

const VideoFileIcon: FC<{ size?: number }> = ({ size = 48 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={size} height={size}>
    <path strokeLinecap="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
  </svg>
);

const AudioFileIcon: FC<{ size?: number }> = ({ size = 48 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={size} height={size}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
  </svg>
);

const PDFFileIcon: FC<{ size?: number }> = ({ size = 48 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={size} height={size}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
  </svg>
);

const CodeFileIcon: FC<{ size?: number }> = ({ size = 48 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={size} height={size}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
  </svg>
);

const ArchiveFileIcon: FC<{ size?: number }> = ({ size = 48 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={size} height={size}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
  </svg>
);

const SpreadsheetFileIcon: FC<{ size?: number }> = ({ size = 48 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={size} height={size}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M12 10.875v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125M13.125 12h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125M20.625 12c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5M12 14.625v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 14.625c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m0 0v1.5c0 .621-.504 1.125-1.125 1.125M12 16.875c0-.621.504-1.125 1.125-1.125" />
  </svg>
);

const GenericFileIcon: FC<{ size?: number }> = ({ size = 48 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={size} height={size}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
  </svg>
);

// --- Extension sets ---

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff', 'tif']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'flv', 'wmv']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'flac', 'aac', 'm4a', 'wma']);
const PDF_EXT = new Set(['pdf']);
const CODE_EXT = new Set([
  'js', 'ts', 'jsx', 'tsx', 'css', 'scss', 'html', 'xml', 'json', 'yaml', 'yml',
  'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'sql',
  'sh', 'bat', 'md', 'txt', 'log', 'env', 'ini', 'conf', 'dockerfile', 'makefile',
]);
const ARCHIVE_EXT = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz']);
const SPREADSHEET_EXT = new Set(['xls', 'xlsx', 'csv', 'ods']);

// --- Color palette ---

const TYPE_COLORS = {
  image: '#10b981',
  video: '#8b5cf6',
  audio: '#f59e0b',
  pdf: '#ef4444',
  code: '#3b82f6',
  archive: '#6b7280',
  spreadsheet: '#059669',
  default: '#6366f1',
};

// --- Helpers ---

export function isImageFile(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXT.has(ext);
}

// --- Public API ---

export const getFileTypeInfo = (fileName: string, mimeType?: string, size?: number): FileTypeInfo => {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  if (IMAGE_EXT.has(ext) || mimeType?.startsWith('image/')) {
    return { icon: <ImageFileIcon size={size} />, color: TYPE_COLORS.image };
  }
  if (VIDEO_EXT.has(ext) || mimeType?.startsWith('video/')) {
    return { icon: <VideoFileIcon size={size} />, color: TYPE_COLORS.video };
  }
  if (AUDIO_EXT.has(ext) || mimeType?.startsWith('audio/')) {
    return { icon: <AudioFileIcon size={size} />, color: TYPE_COLORS.audio };
  }
  if (PDF_EXT.has(ext) || mimeType === 'application/pdf') {
    return { icon: <PDFFileIcon size={size} />, color: TYPE_COLORS.pdf };
  }
  if (SPREADSHEET_EXT.has(ext)) {
    return { icon: <SpreadsheetFileIcon size={size} />, color: TYPE_COLORS.spreadsheet };
  }
  if (CODE_EXT.has(ext) || mimeType?.startsWith('text/')) {
    return { icon: <CodeFileIcon size={size} />, color: TYPE_COLORS.code };
  }
  if (ARCHIVE_EXT.has(ext)) {
    return { icon: <ArchiveFileIcon size={size} />, color: TYPE_COLORS.archive };
  }

  return { icon: <GenericFileIcon size={size} />, color: TYPE_COLORS.default };
};
