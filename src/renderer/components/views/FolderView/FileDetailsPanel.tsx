/**
 * FileDetailsPanel Component
 *
 * Panneau lateral droit affichant les informations detaillees d'un fichier ou dossier
 */

import React, { useState, useRef, useCallback, useEffect, FC } from 'react';
import { TagPicker } from '../../tags';
import { isProtected, isUnlockedForSession } from '../../../../services/auth/filePasswordService';
import { getFileTypeInfo } from '../../../../utils/fileTypeIcons';
import { isFolder as checkIsFolder } from '../../../../types';
import type { Item, Folder, FileItem, HierarchicalTag } from '../../../../types';

interface FileDetailsPanelProps {
  item: Item;
  folderId: string;
  onClose: () => void;
  folder?: Folder;
  tags?: HierarchicalTag[];
}

// Section depliable
const CollapsibleSection: FC<{
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, defaultOpen = true, children }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-[var(--color-border-light)]">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 w-full px-4 py-2.5 text-xs font-semibold uppercase tracking-wider
          text-[var(--color-text-tertiary)] hover:bg-[var(--color-background-secondary)] transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          className={`w-3.5 h-3.5 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        {title}
      </button>
      {isOpen && (
        <div className="px-4 pb-3">
          {children}
        </div>
      )}
    </div>
  );
};

// Ligne d'info
const InfoRow: FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex justify-between items-start py-1.5 text-sm">
    <span className="text-[var(--color-text-tertiary)] shrink-0">{label}</span>
    <span className="text-[var(--color-text-primary)] text-right ml-3 break-all min-w-0">{value}</span>
  </div>
);

const FileDetailsPanel: FC<FileDetailsPanelProps> = ({ item, folderId, onClose, folder, tags }) => {
  const isFolder = checkIsFolder(item);
  const fileItem = !isFolder ? (item as FileItem) : null;
  const folderItem = isFolder ? (item as Folder) : null;
  const fileTypeInfo = fileItem ? getFileTypeInfo(fileItem.name, fileItem.type) : null;

  // Redimensionnement
  const [width, setWidth] = useState(320);
  const panelRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;

    const startX = e.clientX;
    const startWidth = width;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const diff = startX - e.clientX;
      const newWidth = Math.min(480, Math.max(280, startWidth + diff));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [width]);

  // Fermer avec Echap
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Formater la taille
  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  };

  // Formater la date
  const formatDate = (date: string | undefined): string => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Extension du fichier
  const getExtension = (name: string): string => {
    const parts = name.split('.');
    return parts.length > 1 ? parts.pop()!.toUpperCase() : '-';
  };

  // Nombre d'elements dans un dossier
  const getFolderItemCount = (f: Folder): number => {
    return f.items?.length || 0;
  };

  return (
    <div
      ref={panelRef}
      className="shrink-0 flex flex-col bg-[var(--color-surface)] border-l border-[var(--color-border)] overflow-hidden relative"
      style={{ width: `${width}px` }}
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--color-primary-400)] transition-colors z-10"
        onMouseDown={handleMouseDown}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] shrink-0">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Détails</h3>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]
            hover:bg-[var(--color-background-secondary)] transition-colors"
          aria-label="Fermer"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Item header */}
        <div className="flex flex-col items-center gap-3 px-4 py-5 border-b border-[var(--color-border-light)]">
          {/* Icon */}
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center [&_svg]:w-7 [&_svg]:h-7"
            style={{
              backgroundColor: isFolder
                ? (folderItem?.color ? `${folderItem.color}20` : 'var(--color-primary-50)')
                : (fileTypeInfo ? `${fileTypeInfo.color}15` : 'var(--color-background-secondary)'),
              color: isFolder
                ? (folderItem?.color || 'var(--color-primary-500)')
                : (fileTypeInfo?.color || 'var(--color-text-tertiary)')
            }}
          >
            {isFolder ? (
              <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" className="w-7 h-7">
                <path d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
            ) : (
              fileTypeInfo?.icon || (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
              )
            )}
          </div>

          {/* Name */}
          <div className="text-center max-w-full">
            <p className="text-sm font-semibold text-[var(--color-text-primary)] break-words">{item.name}</p>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
              {isFolder ? 'Dossier' : (fileItem?.type || 'Fichier')}
            </p>
          </div>
        </div>

        {/* Informations */}
        <CollapsibleSection title="Informations" defaultOpen>
          {!isFolder && fileItem && (
            <>
              <InfoRow label="Taille" value={formatSize(fileItem.size)} />
              <InfoRow label="Extension" value={getExtension(fileItem.name)} />
              <InfoRow label="Type MIME" value={fileItem.type || '-'} />
            </>
          )}
          {isFolder && folderItem && (
            <>
              <InfoRow label="Éléments" value={`${getFolderItemCount(folderItem)} élément(s)`} />
              {folderItem.color && (
                <InfoRow
                  label="Couleur"
                  value={
                    <div className="flex items-center gap-1.5">
                      <span
                        className="inline-block w-3.5 h-3.5 rounded-full border border-[var(--color-border)]"
                        style={{ backgroundColor: folderItem.color }}
                      />
                      <span>{folderItem.color}</span>
                    </div>
                  }
                />
              )}
            </>
          )}
          <InfoRow label="Créé le" value={formatDate(item.createdAt)} />
          <InfoRow label="Modifié le" value={formatDate(item.updatedAt)} />
          {folder && (
            <InfoRow label="Emplacement" value={folder.name} />
          )}
        </CollapsibleSection>

        {/* Tags */}
        <CollapsibleSection title="Tags" defaultOpen>
          <TagPicker
            fileId={item.id}
            placeholder="Ajouter un tag..."
          />
        </CollapsibleSection>

        {/* Sécurité */}
        <CollapsibleSection title="Sécurité" defaultOpen={false}>
          <div className="flex items-center gap-2 py-1.5 text-sm">
            <span className="text-[var(--color-text-tertiary)]">Mot de passe</span>
            <span className="ml-auto">
              {isProtected(item.id) ? (
                <span className="flex items-center gap-1.5">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                    className={`w-4 h-4 ${isUnlockedForSession(item.id) ? 'text-green-500' : 'text-[var(--color-warning-500)]'}`}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                  <span className="text-[var(--color-text-primary)] text-xs font-medium">
                    {isUnlockedForSession(item.id) ? 'Déverrouillé' : 'Protégé'}
                  </span>
                </span>
              ) : (
                <span className="text-[var(--color-text-tertiary)] text-xs">Non protégé</span>
              )}
            </span>
          </div>
        </CollapsibleSection>

        {/* Description */}
        {item.description && (
          <CollapsibleSection title="Description" defaultOpen={false}>
            <p className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap">{item.description}</p>
          </CollapsibleSection>
        )}
      </div>
    </div>
  );
};

export default FileDetailsPanel;
