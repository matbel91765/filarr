/**
 * ExportDialog — Filarr Notes
 *
 * Modal dialog for exporting a note in multiple formats.
 * Markdown, HTML, PDF, DOCX, Filarr (.filarr JSON).
 */

import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  exportNote,
  type ExportFormat,
  type ExportResult,
} from '../../../services/notes/noteExportService';
import type { Note } from '../../../types/notes';
import './ExportDialog.css';

// ==================== Format Info ====================

interface FormatInfo {
  id: ExportFormat;
  label: string;
  ext: string;
  icon: string;
  desc: string;
}

const FORMATS: FormatInfo[] = [
  { id: 'markdown', label: 'Markdown', ext: '.md', icon: 'M', desc: 'Plain text with formatting' },
  { id: 'html', label: 'HTML', ext: '.html', icon: 'H', desc: 'Web page format' },
  { id: 'pdf', label: 'PDF', ext: '.pdf', icon: 'P', desc: 'Portable document' },
  { id: 'docx', label: 'DOCX', ext: '.docx', icon: 'W', desc: 'Microsoft Word' },
  { id: 'filarr', label: 'Filarr', ext: '.filarr', icon: 'F', desc: 'Full backup with metadata' },
];

// ==================== Component ====================

interface ExportDialogProps {
  note: Note;
  onClose: () => void;
}

export const ExportDialog: React.FC<ExportDialogProps> = React.memo(
  function ExportDialog({ note, onClose }) {
    const { t } = useTranslation();
    const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('markdown');
    const [includeMetadata, setIncludeMetadata] = useState(true);
    const [includeLinks, setIncludeLinks] = useState(false);
    const [exporting, setExporting] = useState(false);

    const handleExport = useCallback(async () => {
      setExporting(true);
      try {
        const result: ExportResult = await exportNote(note, {
          format: selectedFormat,
          includeMetadata,
          includeLinks,
        });

        // Download via anchor
        const url = URL.createObjectURL(result.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = result.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        onClose();
      } catch (err) {
        console.error('[ExportDialog] Export failed:', err);
      } finally {
        setExporting(false);
      }
    }, [note, selectedFormat, includeMetadata, includeLinks, onClose]);

    return (
      <div className="export-dialog__overlay" onClick={onClose}>
        <div className="export-dialog" onClick={(e) => e.stopPropagation()}>
          <div className="export-dialog__header">
            <h3>{t('notes.exportNote', 'Export Note')}</h3>
            <button className="export-dialog__close" onClick={onClose}>
              &times;
            </button>
          </div>

          <div className="export-dialog__body">
            <div className="export-dialog__formats">
              {FORMATS.map((fmt) => (
                <button
                  key={fmt.id}
                  className={`export-dialog__format ${selectedFormat === fmt.id ? 'is-selected' : ''}`}
                  onClick={() => setSelectedFormat(fmt.id)}
                >
                  <span className="export-dialog__format-icon">{fmt.icon}</span>
                  <div className="export-dialog__format-info">
                    <span className="export-dialog__format-label">{fmt.label}</span>
                    <span className="export-dialog__format-desc">{fmt.desc}</span>
                  </div>
                  <span className="export-dialog__format-ext">{fmt.ext}</span>
                </button>
              ))}
            </div>

            <div className="export-dialog__options">
              <label className="export-dialog__option">
                <input
                  type="checkbox"
                  checked={includeMetadata}
                  onChange={(e) => setIncludeMetadata(e.target.checked)}
                />
                <span>{t('notes.includeMetadata', 'Include metadata')}</span>
              </label>
              <label className="export-dialog__option">
                <input
                  type="checkbox"
                  checked={includeLinks}
                  onChange={(e) => setIncludeLinks(e.target.checked)}
                />
                <span>{t('notes.includeLinks', 'Include linked notes')}</span>
              </label>
            </div>
          </div>

          <div className="export-dialog__footer">
            <button className="export-dialog__cancel" onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </button>
            <button
              className="export-dialog__submit"
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting
                ? t('notes.exporting', 'Exporting...')
                : t('notes.export', 'Export')}
            </button>
          </div>
        </div>
      </div>
    );
  }
);

export default ExportDialog;
