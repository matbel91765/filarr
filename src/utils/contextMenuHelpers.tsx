/**
 * Helpers pour les menus contextuels avec support de la corbeille
 */

import React from 'react';
import type { Item } from '../types';

export const getDeleteLabel = (isInTrash: boolean): string => {
  return isInTrash ? 'Supprimer définitivement' : 'Mettre à la corbeille';
};

export const getDeleteConfirmMessage = (isInTrash: boolean, itemCount: number = 1): string => {
  if (isInTrash) {
    return itemCount > 1
      ? `Êtes-vous sûr de vouloir supprimer définitivement ces ${itemCount} éléments ? Cette action est irréversible.`
      : 'Êtes-vous sûr de vouloir supprimer définitivement cet élément ? Cette action est irréversible.';
  }

  return itemCount > 1
    ? `Déplacer ces ${itemCount} éléments vers la corbeille ?`
    : 'Déplacer cet élément vers la corbeille ?';
};

export const getDeleteConfirmTitle = (isInTrash: boolean): string => {
  return isInTrash ? 'Supprimer définitivement' : 'Mettre à la corbeille';
};

export const shouldShowPermanentDeleteWarning = (isInTrash: boolean): boolean => {
  return isInTrash;
};

/**
 * Icône de corbeille SVG
 */
export const TrashIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="16" height="16">
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
  </svg>
);

/**
 * Icône de restauration SVG
 */
export const RestoreIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="16" height="16">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
  </svg>
);

/**
 * Icône d'historique de versions SVG
 */
export const HistoryIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="16" height="16">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

/**
 * Icône de cadenas SVG
 */
export const LockIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="16" height="16">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
  </svg>
);

/**
 * Icône de coffre-fort SVG
 */
export const VaultIcon: React.FC = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="16" height="16">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
  </svg>
);

/**
 * Détermine si un item est dans la corbeille
 */
export const isItemInTrash = (item: Item): boolean => {
  return !!item.deletedAt;
};

/**
 * Options de menu contextuel pour un item normal
 */
export interface ContextMenuOptions {
  onMoveToTrash: () => void;
  onRestore?: () => void;
  onPermanentDelete?: () => void;
  onRename?: () => void;
  onDownload?: () => void;
  onMove?: () => void;
  onCopy?: () => void;
  onAddReminder?: () => void;
  // Version history
  onViewHistory?: () => void;
  // Vault/Security features
  onAddToVault?: () => void;
  // Password protection
  onSetPassword?: () => void;
  // Smart features
  onAutoTag?: () => void;
  onAddToSmartFolder?: () => void;
}

/**
 * Génère les options du menu contextuel basées sur l'état de l'item
 */
export const generateContextMenuItems = (
  item: Item,
  options: ContextMenuOptions,
  isFolder: boolean = false
) => {
  const inTrash = isItemInTrash(item);
  const items: any[] = [];

  if (inTrash) {
    // Menu pour les items dans la corbeille
    if (options.onRestore) {
      items.push({
        label: 'Restaurer',
        icon: React.createElement(RestoreIcon),
        onClick: options.onRestore
      });
    }

    if (options.onPermanentDelete) {
      items.push({
        label: 'Supprimer définitivement',
        icon: React.createElement(TrashIcon),
        onClick: options.onPermanentDelete,
        danger: true
      });
    }
  } else {
    // Menu pour les items normaux
    if (!isFolder && options.onDownload) {
      items.push({
        label: 'Télécharger',
        onClick: options.onDownload
      });
    }

    if (options.onRename) {
      items.push({
        label: 'Renommer',
        onClick: options.onRename
      });
    }

    if (options.onMove) {
      items.push({
        label: 'Déplacer',
        onClick: options.onMove
      });
    }

    if (options.onCopy) {
      items.push({
        label: 'Copier',
        onClick: options.onCopy
      });
    }

    if (options.onAddReminder) {
      items.push({
        divider: true
      });
      items.push({
        label: 'Ajouter un rappel',
        onClick: options.onAddReminder
      });
    }

    // Version History (files only)
    if (!isFolder && options.onViewHistory) {
      items.push({
        divider: true
      });
      items.push({
        label: 'Voir l\'historique des versions',
        icon: React.createElement(HistoryIcon),
        onClick: options.onViewHistory
      });
    }

    // Vault/Security features (files only)
    if (!isFolder && options.onAddToVault) {
      items.push({
        label: 'Ajouter au coffre-fort',
        icon: React.createElement(VaultIcon),
        onClick: options.onAddToVault
      });
    }

    // Password protection
    if (options.onSetPassword) {
      items.push({
        label: 'Protéger par mot de passe',
        icon: React.createElement(LockIcon),
        onClick: options.onSetPassword
      });
    }

    // Smart Features Section
    if (!isFolder) {
      const hasSmartFeatures = options.onAutoTag || options.onAddToSmartFolder;

      if (hasSmartFeatures) {
        items.push({ divider: true });
      }

      if (options.onAutoTag) {
        items.push({
          label: 'Suggerer des tags',
          onClick: options.onAutoTag,
        });
      }

      if (options.onAddToSmartFolder) {
        items.push({
          label: 'Ajouter au dossier intelligent',
          onClick: options.onAddToSmartFolder,
        });
      }
    }

    // Toujours ajouter l'option de suppression/corbeille
    items.push({
      divider: true
    });
    items.push({
      label: 'Mettre à la corbeille',
      icon: React.createElement(TrashIcon),
      onClick: options.onMoveToTrash,
      danger: true
    });
  }

  return items;
};
