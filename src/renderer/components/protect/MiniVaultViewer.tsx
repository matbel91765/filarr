/**
 * MiniVaultViewer — mini-coffre navigable d'un conteneur .filarr DOSSIER
 * (Wave 2 « Protéger sur place »).
 *
 * Reçoit l'index tar (méta + entrées, JAMAIS de données de fichier) résolu
 * par 'filarrBox:openFolder' et affiche une arborescence élégante :
 *  - « Ouvrir »    : extraction vers une copie temporaire suivie + ouverture
 *                    (LECTURE SEULE — notice permanente : les modifications
 *                    ne sont pas réenregistrées dans le conteneur en v1) ;
 *  - « Extraire… » : dialogue d'enregistrement côté main (action explicite) ;
 *  - « Tout extraire… » : sélecteur de dossier + reconstruction de l'arbre.
 *
 * Design system uniquement (Modal/Button/tokens) + famille d'icônes de
 * protection écrite à la main — thèmes sombre/terracotta automatiques.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal/Modal';
import { Button } from '../ui/Button/Button';
import { useNotification } from '../ui/Notification';
import { BoxFileIcon, BoxFolderIcon, ExtractIcon, OpenExternalIcon, VaultLockIcon } from '../icons';
import {
  extractBoxEntry,
  extractAllBoxEntries,
  type BoxEntry,
  type BoxFolderListing,
} from '../../../services/features/filarrBoxBridge';
import { formatBytes } from '../../../constants/limits';
import './MiniVaultViewer.css';

export interface MiniVaultViewerProps {
  isOpen: boolean;
  /** Chemin OS du conteneur .filarr ouvert. */
  boxPath: string;
  listing: BoxFolderListing;
  onClose: () => void;
}

// ==================== Arbre ====================

interface TreeNode {
  name: string;
  /** Chemin tar complet de l'entrée ('' pour la racine). */
  path: string;
  isDir: boolean;
  size: number;
  children: TreeNode[];
}

/** Construit l'arborescence depuis les chemins tar (dossiers implicites inclus). */
function buildTree(entries: BoxEntry[]): TreeNode {
  const root: TreeNode = { name: '', path: '', isDir: true, size: 0, children: [] };
  const nodes = new Map<string, TreeNode>([['', root]]);

  const ensureDir = (dirPath: string): TreeNode => {
    const existing = nodes.get(dirPath);
    if (existing) return existing;
    const parts = dirPath.split('/');
    const parent = ensureDir(parts.slice(0, -1).join('/'));
    const node: TreeNode = {
      name: parts[parts.length - 1],
      path: dirPath,
      isDir: true,
      size: 0,
      children: [],
    };
    parent.children.push(node);
    nodes.set(dirPath, node);
    return node;
  };

  for (const entry of entries) {
    const clean = entry.path.replace(/\/+$/, '');
    if (!clean) continue;
    if (entry.isDir) {
      ensureDir(clean);
    } else {
      const parts = clean.split('/');
      const parent = ensureDir(parts.slice(0, -1).join('/'));
      // Un fichier déjà vu (index dupliqué) ne doit pas apparaître deux fois.
      if (!nodes.has(clean)) {
        const node: TreeNode = {
          name: parts[parts.length - 1],
          path: clean,
          isDir: false,
          size: entry.size,
          children: [],
        };
        parent.children.push(node);
        nodes.set(clean, node);
      }
    }
  }

  const sortRec = (node: TreeNode): void => {
    node.children.sort((a, b) =>
      a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1
    );
    node.children.forEach(sortRec);
  };
  sortRec(root);
  return root;
}

// ==================== Composant ====================

export const MiniVaultViewer: React.FC<MiniVaultViewerProps> = ({
  isOpen,
  boxPath,
  listing,
  onClose,
}) => {
  const { t } = useTranslation();
  const { success, error: notifyError, info } = useNotification();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** Chemin tar de l'entrée en cours d'action (désactive ses boutons). */
  const [busyEntry, setBusyEntry] = useState<string | null>(null);
  const [extractingAll, setExtractingAll] = useState(false);

  const tree = useMemo(() => buildTree(listing.entries), [listing.entries]);
  const fileCount = useMemo(
    () => listing.entries.filter((e) => !e.isDir).length,
    [listing.entries]
  );

  const toggleDir = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleEntryAction = useCallback(
    async (entry: TreeNode, mode: 'open' | 'saveAs') => {
      if (busyEntry) return;
      setBusyEntry(entry.path);
      try {
        const res = await extractBoxEntry(boxPath, entry.path, mode);
        if (res.ok) {
          if (mode === 'open') {
            info(
              t(
                'desktopProtection.miniVault.openedReadOnly',
                '« {{name}} » ouvert en lecture seule (copie temporaire, purgée au verrouillage).',
                { name: entry.name }
              )
            );
          } else if (res.data?.canceled) {
            // Dialogue annulé — silencieux.
          } else {
            success(
              t('desktopProtection.miniVault.extracted', '« {{name}} » extrait.', {
                name: entry.name,
              })
            );
          }
        } else if (res.unavailable) {
          info(
            t(
              'settings.desktop.featureUnavailable',
              'Disponible après la prochaine mise à jour de Filarr.'
            )
          );
        } else {
          notifyError(
            res.error ||
              t('desktopProtection.miniVault.entryFailed', 'Impossible d’extraire « {{name}} ».', {
                name: entry.name,
              })
          );
        }
      } finally {
        setBusyEntry(null);
      }
    },
    [boxPath, busyEntry, success, notifyError, info, t]
  );

  const handleExtractAll = useCallback(async () => {
    if (extractingAll) return;
    setExtractingAll(true);
    try {
      const res = await extractAllBoxEntries(boxPath);
      if (res.ok) {
        if (!res.data?.canceled) {
          success(
            t(
              'desktopProtection.miniVault.extractedAll',
              '{{count}} fichier(s) extrait(s) vers {{dir}}.',
              { count: res.data?.fileCount ?? fileCount, dir: res.data?.destDir ?? '' }
            )
          );
        }
      } else if (res.unavailable) {
        info(
          t(
            'settings.desktop.featureUnavailable',
            'Disponible après la prochaine mise à jour de Filarr.'
          )
        );
      } else {
        notifyError(
          res.error ||
            t('desktopProtection.miniVault.extractAllFailed', 'Échec de l’extraction complète.')
        );
      }
    } finally {
      setExtractingAll(false);
    }
  }, [boxPath, extractingAll, fileCount, success, notifyError, info, t]);

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    if (node.isDir && node.path !== '') {
      const isCollapsed = collapsed.has(node.path);
      return (
        <li key={node.path} className="mini-vault__node">
          <button
            type="button"
            className="mini-vault__row mini-vault__row--dir"
            style={{ paddingLeft: `${10 + depth * 18}px` }}
            onClick={() => toggleDir(node.path)}
            aria-expanded={!isCollapsed}
          >
            <span
              className={`mini-vault__chevron ${isCollapsed ? '' : 'mini-vault__chevron--open'}`}
              aria-hidden="true"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
            </span>
            <BoxFolderIcon size={15} className="mini-vault__row-icon" />
            <span className="mini-vault__row-name">{node.name}</span>
            <span className="mini-vault__row-meta">
              {t('desktopProtection.miniVault.dirMeta', '{{count}} élément(s)', {
                count: node.children.length,
              })}
            </span>
          </button>
          {!isCollapsed && node.children.length > 0 && (
            <ul className="mini-vault__list">
              {node.children.map((child) => renderNode(child, depth + 1))}
            </ul>
          )}
        </li>
      );
    }

    if (node.isDir) {
      // Racine : rendre uniquement les enfants.
      return node.children.map((child) => renderNode(child, depth));
    }

    const busy = busyEntry === node.path;
    return (
      <li key={node.path} className="mini-vault__node">
        <div
          className="mini-vault__row mini-vault__row--file"
          style={{ paddingLeft: `${10 + depth * 18 + 18}px` }}
        >
          <BoxFileIcon size={15} className="mini-vault__row-icon" />
          <span className="mini-vault__row-name" title={node.path}>
            {node.name}
          </span>
          <span className="mini-vault__row-meta">{formatBytes(node.size)}</span>
          <span className="mini-vault__row-actions">
            <Button
              variant="ghost"
              size="sm"
              loading={busy}
              disabled={busyEntry !== null && !busy}
              leftIcon={<OpenExternalIcon size={13} />}
              onClick={() => void handleEntryAction(node, 'open')}
            >
              {t('desktopProtection.miniVault.open', 'Ouvrir')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busyEntry !== null}
              leftIcon={<ExtractIcon size={13} />}
              onClick={() => void handleEntryAction(node, 'saveAs')}
            >
              {t('desktopProtection.miniVault.extract', 'Extraire…')}
            </Button>
          </span>
        </div>
      </li>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={listing.meta.name}
      size="lg"
      className="mini-vault__modal"
    >
      <ModalBody>
        {/* ── Bandeau méta ── */}
        <div className="mini-vault__meta">
          <span className="mini-vault__badge">
            <VaultLockIcon size={13} />
            {t('desktopProtection.miniVault.badge', 'Conteneur protégé')}
          </span>
          <span className="mini-vault__meta-item">
            {t('desktopProtection.miniVault.fileCount', '{{count}} fichier(s)', {
              count: listing.meta.entryCount ?? fileCount,
            })}
          </span>
          <span className="mini-vault__meta-item">{formatBytes(listing.meta.size)}</span>
          <span className="mini-vault__meta-item mini-vault__meta-item--path" title={boxPath}>
            {boxPath}
          </span>
        </div>

        {/* ── Notice lecture seule (permanente, v1) ── */}
        <p className="mini-vault__readonly" role="note">
          {t(
            'desktopProtection.miniVault.readOnlyNotice',
            'Lecture seule — les modifications apportées aux fichiers ouverts ne sont pas réenregistrées dans le conteneur.'
          )}
        </p>

        {/* ── Arborescence ── */}
        {fileCount === 0 && listing.entries.length === 0 ? (
          <p className="mini-vault__empty">
            {t('desktopProtection.miniVault.empty', 'Ce conteneur est vide.')}
          </p>
        ) : (
          <ul className="mini-vault__list mini-vault__list--root" aria-label={listing.meta.name}>
            {renderNode(tree, 0)}
          </ul>
        )}
      </ModalBody>
      <ModalFooter>
        <Button
          variant="secondary"
          loading={extractingAll}
          disabled={fileCount === 0}
          leftIcon={<ExtractIcon size={15} />}
          onClick={() => void handleExtractAll()}
        >
          {t('desktopProtection.miniVault.extractAll', 'Tout extraire…')}
        </Button>
        <Button variant="primary" onClick={onClose}>
          {t('common.close', 'Fermer')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default MiniVaultViewer;
