/**
 * BinaryInfoPreview Component
 *
 * Executables and opaque binaries (.exe, .msi, .dmg, .deb, .iso, …) have no
 * meaningful in-app rendering — and Filarr deliberately never runs them. Instead
 * of downloading a potentially huge payload just to fail, this shows a clean
 * info card (recognised type + size + a "not executed here" reassurance) built
 * entirely from the file metadata. No bytes are fetched.
 *
 * Les LIBELLÉS ne vivent plus ici : la table `extension → genre` était en
 * français en dur, donc à moitié illisible pour un utilisateur en anglais.
 * Elle est devenue `binaryInfoModel.ts` (pur, testé) + les clés
 * `preview.binaryInfo.*`, dont la nomenclature est celle du mobile.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import './MarkdownPreview.css';
import { binaryKindLabelKey, describeBinaryKind } from './binaryInfoModel';

export interface BinaryInfoPreviewProps {
  /** File name */
  fileName: string;
  /** File size in bytes */
  size: number;
  /** File extension (exe | msi | dmg | …) */
  extension?: string;
  /** Additional CSS class */
  className?: string;
}

const formatBytes = (bytes: number): string => {
  if (!bytes || bytes < 0) return '0 o';
  const k = 1024;
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
};

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    padding: 32,
    textAlign: 'center',
  },
  iconRing: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 88,
    height: 88,
    borderRadius: 20,
    background: 'var(--color-bg-secondary, #f3f4f6)',
    border: '1px solid var(--color-border, #e5e7eb)',
    color: 'var(--color-text-secondary, #6b7280)',
  },
  kind: {
    fontSize: 17,
    fontWeight: 600,
    color: 'var(--color-text-primary, #1f2937)',
  },
  name: {
    fontSize: 13,
    color: 'var(--color-text-secondary, #6b7280)',
    fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace",
    wordBreak: 'break-all',
    maxWidth: 460,
  },
  meta: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  chip: {
    fontSize: 12,
    padding: '3px 10px',
    borderRadius: 999,
    background: 'var(--color-bg-secondary, #f3f4f6)',
    border: '1px solid var(--color-border, #e5e7eb)',
    color: 'var(--color-text-secondary, #6b7280)',
    fontVariantNumeric: 'tabular-nums',
  },
  notice: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    maxWidth: 460,
    padding: '10px 14px',
    borderRadius: 10,
    background: 'var(--color-bg-secondary, #f9fafb)',
    border: '1px solid var(--color-border, #e5e7eb)',
    color: 'var(--color-text-secondary, #6b7280)',
    fontSize: 12.5,
    lineHeight: 1.5,
    textAlign: 'left',
  },
};

const BinaryIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    width="44"
    height="44"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M6 6.878V6a2.25 2.25 0 012.25-2.25h7.5A2.25 2.25 0 0118 6v.878m-12 0c.235-.083.487-.128.75-.128h10.5c.263 0 .515.045.75.128m-12 0A2.25 2.25 0 004.5 9v.878m13.5-3A2.25 2.25 0 0119.5 9v.878m0 0a2.246 2.246 0 00-.75-.128H5.25c-.263 0-.515.045-.75.128m15 0A2.25 2.25 0 0121 12v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6c0-.98.626-1.813 1.5-2.122"
    />
  </svg>
);

const ShieldIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.6}
    stroke="currentColor"
    width="18"
    height="18"
    style={{ flexShrink: 0, marginTop: 1 }}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 12.75L11.25 15 15 9.75M21 12c0 4.556-3.86 8.25-9 8.25S3 16.556 3 12s3.86-8.25 9-8.25S21 7.444 21 12z"
    />
  </svg>
);

export const BinaryInfoPreview: React.FC<BinaryInfoPreviewProps> = ({
  fileName,
  size,
  extension,
  className,
}) => {
  const { t } = useTranslation();
  const kind = describeBinaryKind(fileName, extension);
  const containerClasses = clsx('markdown-preview', className);

  return (
    <div className={containerClasses}>
      <div className="markdown-preview__toolbar">
        <div className="markdown-preview__toolbar-left">
          <span className="markdown-preview__badge">{kind.badge}</span>
          <span className="markdown-preview__stats" title={fileName}>
            {fileName}
          </span>
        </div>
      </div>

      <div className="markdown-preview__container">
        <div style={styles.wrap}>
          <div style={styles.iconRing}>
            <BinaryIcon />
          </div>
          <div style={styles.kind}>{t(binaryKindLabelKey(kind.key))}</div>
          <div style={styles.name}>{fileName}</div>
          <div style={styles.meta}>
            <span style={styles.chip}>{formatBytes(size)}</span>
            {kind.platform && <span style={styles.chip}>{kind.platform}</span>}
            <span style={styles.chip}>.{kind.extension}</span>
          </div>
          <div style={styles.notice}>
            <ShieldIcon />
            <span>{t('preview.binaryInfo.neverRun')}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BinaryInfoPreview;
