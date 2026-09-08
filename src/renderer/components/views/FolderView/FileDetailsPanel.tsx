/**
 * FileDetailsPanel Component
 *
 * Panneau lateral droit affichant les informations detaillees d'un fichier ou dossier
 *
 * PROPS + SERVICES, AUCUN useSelector — et c'est une regle, pas un hasard : le
 * panneau sert la vue dossier, l'accueil, et les coffres partages, qui n'ont ni
 * le meme magasin ni les memes services. Tout ce qui varie d'un hote a l'autre
 * (les tags, la protection par mot de passe, le partage) arrive par props ou se
 * masque par props (`hideTags`, `sharing`). En mode local, l'hote ne passe pas
 * `sharing` et la section « Partage » n'existe pas : le panneau n'a pas a
 * savoir dans quel mode il tourne.
 *
 * La logique de la section « Partage » (quelles lignes, troncature, avis) vit
 * dans fileDetailsSharing.ts, sans JSX, testee sous vitest-node.
 */

import React, { useState, useRef, useCallback, useEffect, FC } from 'react';
import { useTranslation } from 'react-i18next';
import { TagPicker } from '../../tags';
import { AvatarStack, Button } from '../../ui';
import { useRelativeTime } from '../../home/widgets/relativeTime';
import { isProtected, isUnlockedForSession } from '../../../../services/auth/filePasswordService';
import { getFileTypeInfo } from '../../../../utils/fileTypeIcons';
import { vaultRefOf } from '../../../../store/selectors/fileShortcutSelectors';
import { NoteGlyph } from '../../files/FileCard';
import type { FileCardKind } from '../../files/FileCard';
import { VaultIcon } from '../../files/itemContextMenu';
import { isFolder as checkIsFolder } from '../../../../types';
import type { Item, Folder, FileItem, HierarchicalTag } from '../../../../types';
import {
  SHARING_LIST_LIMIT,
  activityTimestampIso,
  formatDetailsDate,
  planSharingSection,
  roleLabelKey,
  type FileDetailsSharing,
} from './fileDetailsSharing';

export type { FileDetailsSharing } from './fileDetailsSharing';

interface FileDetailsPanelProps {
  item: Item;
  folderId: string;
  onClose: () => void;
  folder?: Folder;
  tags?: HierarchicalTag[];
  /**
   * Ce que l'hote sait du partage de l'element. Absent = pas de section
   * « Partage » (mode local, ou hote qui n'en parle pas). Les textes
   * d'activite arrivent DEJA resolus : le panneau affiche, il n'interprete pas.
   */
  sharing?: FileDetailsSharing;
  /**
   * Masque « Tags » et « Securite ». Les elements d'un coffre n'ont ni
   * TagPicker (pas de magasin de tags) ni filePasswordService : afficher ces
   * sections leur promettrait des reglages qui n'existent pas.
   */
  hideTags?: boolean;
  /**
   * L'element est un RACCOURCI vers un coffre partage (`FileItem.vaultRef`) :
   * l'hote fournit le libelle du coffre et son etat (voir
   * `fileShortcutSelectors`), le panneau les affiche sans rien deduire.
   */
  shortcut?: { label: string; state: 'live' | 'locked' | 'missing' | 'gone' | 'unknown' };
  /** « Ouvrir dans le coffre » — fourni par l'hote, qui sait naviguer. */
  onOpenInVault?: () => void;
  /**
   * LE GENRE de l'element, quand l'hote le connait — la MEME prop, du meme
   * type, que `FileCard`. Absente = fichier ordinaire, et le panneau se comporte
   * exactement comme avant.
   *
   * POURQUOI ELLE EXISTE. Le panneau deduisait tout du NOM
   * (`getFileTypeInfo(name)`), ce qui marche pour un fichier et ment pour une
   * note : une note de coffre n'a pas d'extension, et le panneau l'annoncait
   * « Fichier », avec une ligne « Extension » vide et un « Type MIME » vide.
   * C'est le defaut deja corrige sur les cartes, au meme endroit du
   * raisonnement. Le genre se LIT (`vaultItemKind`), il ne se devine pas.
   */
  kind?: FileCardKind;
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
      {isOpen && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
};

// Ligne d'info
const InfoRow: FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex justify-between items-start py-1.5 text-sm">
    <span className="text-[var(--color-text-tertiary)] shrink-0">{label}</span>
    <span className="text-[var(--color-text-primary)] text-right ml-3 break-all min-w-0">
      {value}
    </span>
  </div>
);

const FileDetailsPanel: FC<FileDetailsPanelProps> = ({
  item,
  folderId,
  onClose,
  folder,
  tags,
  sharing,
  hideTags,
  shortcut,
  onOpenInVault,
  kind,
}) => {
  const { t, i18n } = useTranslation();
  const relativeTime = useRelativeTime();
  const sharingPlan = planSharingSection(sharing);
  const isFolder = checkIsFolder(item);
  const fileItem = !isFolder ? (item as FileItem) : null;
  const folderItem = isFolder ? (item as Folder) : null;
  /** Une NOTE, dite par l'hote — pas devinee d'un nom. Meme regle que la carte. */
  const isNote = !isFolder && !!kind;
  /**
   * L'icone deduite du NOM, et seulement pour un vrai fichier : `getFileTypeInfo`
   * lit l'extension, une note n'en a pas, et son repli generique est justement ce
   * qui faisait ressembler une note a un fichier inconnu.
   */
  const fileTypeInfo = fileItem && !isNote ? getFileTypeInfo(fileItem.name, fileItem.type) : null;
  /** « Note » / « Note integree » — les libelles du coffre, deja traduits. */
  const noteKindLabel = !isNote
    ? null
    : kind === 'transclusion'
      ? t('teamVaults.items.kindTransclusion', 'Note intégrée')
      : t('teamVaults.items.kindNote', 'Note');
  /** Un raccourci : les octets sont dans le coffre, seule la fiche est ici. */
  const shortcutRef = fileItem ? vaultRefOf(fileItem) : undefined;
  // L'etat du coffre, dit en clair sous la ligne du raccourci — rien pour
  // « live », ou le panneau repeterait ce que le bouton promet deja.
  const shortcutStateText =
    shortcut && shortcut.state === 'locked'
      ? t('teamVaults.shortcut.titleLocked', 'Coffre verrouillé — déverrouillez-le pour l’ouvrir')
      : shortcut && shortcut.state === 'missing'
        ? t('teamVaults.shortcut.titleMissing', 'Introuvable dans le coffre {{name}}', {
            name: shortcut.label,
          })
        : shortcut && shortcut.state === 'gone'
          ? t('teamVaults.shortcut.titleGone', 'Le coffre n’est plus accessible')
          : shortcut && shortcut.state === 'unknown'
            ? t('teamVaults.shortcut.titleUnknown', 'Coffres en cours de chargement…')
            : null;

  // Redimensionnement
  const [width, setWidth] = useState(320);
  const panelRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
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
    },
    [width]
  );

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

  // Formater la date dans la langue de l'app (avant : 'fr-FR' en dur)
  const formatDate = (date: string | undefined): string => formatDetailsDate(date, i18n.language);

  // Libelle d'un role : traduit s'il est connu, brut sinon (jamais une cle nue)
  const roleLabel = (role: string): string => {
    const key = roleLabelKey(role);
    return key ? t(key, role) : role;
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
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
          {t('details.title', 'Details')}
        </h3>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]
            hover:bg-[var(--color-background-secondary)] transition-colors"
          aria-label={t('details.close', 'Close')}
          title={t('details.close', 'Close')}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="w-4 h-4"
          >
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
              /* Teinte `info` pour une note, comme sa vignette de carte : jamais
                 `primary`, deja la couleur du COFFRE (raccourcis, pastilles). */
              backgroundColor: isFolder
                ? folderItem?.color
                  ? `${folderItem.color}20`
                  : 'var(--color-primary-50)'
                : isNote
                  ? 'var(--color-info-50)'
                  : fileTypeInfo
                    ? `${fileTypeInfo.color}15`
                    : 'var(--color-background-secondary)',
              color: isFolder
                ? folderItem?.color || 'var(--color-primary-500)'
                : isNote
                  ? 'var(--color-info-600)'
                  : fileTypeInfo?.color || 'var(--color-text-tertiary)',
            }}
          >
            {isFolder ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="currentColor"
                viewBox="0 0 24 24"
                className="w-7 h-7"
              >
                <path d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
            ) : isNote ? (
              /* Le MEME crayon que la carte : une note se reconnait au meme
                 signe partout, sinon chaque surface enseigne une convention. */
              <NoteGlyph />
            ) : (
              fileTypeInfo?.icon || (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-7 h-7"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                  />
                </svg>
              )
            )}
          </div>

          {/* Name */}
          <div className="text-center max-w-full">
            <p className="text-sm font-semibold text-[var(--color-text-primary)] break-words">
              {item.name}
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
              {/* « Fichier » etait le repli de TOUT ce qui n'a pas de type MIME
                  — et une note de coffre n'en a pas. Le genre passe donc avant
                  le repli, jamais l'inverse. */}
              {isFolder
                ? t('details.kind.folder', 'Folder')
                : shortcutRef
                  ? t('teamVaults.shortcut.kind', 'Raccourci vers un coffre partagé')
                  : isNote
                    ? noteKindLabel
                    : fileItem?.type || t('details.kind.file', 'File')}
            </p>
          </div>
        </div>

        {/* Informations */}
        <CollapsibleSection title={t('details.info.title', 'Information')} defaultOpen>
          {!isFolder && fileItem && (
            <>
              {/* La taille ne parle que d'octets presents ICI : un raccourci
                  n'en a plus (ils sont dans le coffre, avec leur vraie taille). */}
              {!shortcutRef && (
                <InfoRow label={t('details.info.size', 'Size')} value={formatSize(fileItem.size)} />
              )}
              {/* NI EXTENSION NI TYPE MIME POUR UNE NOTE. Les deux lignes
                  sortaient vides — « Extension : » suivi d'un blanc n'informe
                  pas, il fait croire a une donnee manquante la ou la question
                  ne se pose meme pas. Une note n'a pas de nom de fichier. */}
              {!isNote && (
                <>
                  <InfoRow
                    label={t('details.info.extension', 'Extension')}
                    value={getExtension(fileItem.name)}
                  />
                  <InfoRow
                    label={t('details.info.mimeType', 'MIME type')}
                    value={fileItem.type || '-'}
                  />
                </>
              )}
            </>
          )}
          {isFolder && folderItem && (
            <>
              <InfoRow
                label={t('details.info.items', 'Items')}
                value={t('details.info.itemCount', {
                  count: getFolderItemCount(folderItem),
                  defaultValue: `${getFolderItemCount(folderItem)} item(s)`,
                })}
              />
              {folderItem.color && (
                <InfoRow
                  label={t('details.info.color', 'Color')}
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
          <InfoRow
            label={t('details.info.createdAt', 'Created')}
            value={formatDate(item.createdAt)}
          />
          <InfoRow
            label={t('details.info.updatedAt', 'Modified')}
            value={formatDate(item.updatedAt)}
          />
          {folder && <InfoRow label={t('details.info.location', 'Location')} value={folder.name} />}
          {shortcutRef && (
            <>
              <InfoRow
                label={t('teamVaults.shortcut.detailsRow', 'Raccourci vers le coffre')}
                value={
                  <span className="inline-flex items-center gap-1 [&_svg]:w-3.5 [&_svg]:h-3.5 text-[var(--color-primary-600)]">
                    <VaultIcon />
                    <span className="text-[var(--color-text-primary)]">
                      {shortcut?.label ?? t('teamVaults.shortcut.unnamedVault', 'Coffre partagé')}
                    </span>
                  </span>
                }
              />
              {shortcutStateText && (
                <p
                  role="note"
                  className="mt-1 mb-1 px-2.5 py-2 rounded-md text-xs bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)]"
                >
                  {shortcutStateText}
                </p>
              )}
              {onOpenInVault && (
                <div className="pt-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onOpenInVault}
                    leftIcon={<VaultIcon />}
                  >
                    {t('teamVaults.shortcut.openInVault', 'Ouvrir dans le coffre')}
                  </Button>
                </div>
              )}
            </>
          )}
        </CollapsibleSection>

        {/* Tags + Securite : masques ensemble pour les elements de coffre, qui
            n'ont ni magasin de tags ni protection par mot de passe (voir la
            prop `hideTags`). */}
        {!hideTags && (
          <>
            {/* Tags */}
            <CollapsibleSection title={t('details.tags.title', 'Tags')} defaultOpen>
              {/* `folderId` EST CE QUI FAIT DURER L'ÉTIQUETTE : elle est écrite
                  dans `Folder.fileTags` (metadata.json), pas dans la seule
                  mémoire Redux. Voir `services/tags/fileTags`. */}
              <TagPicker
                fileId={item.id}
                folderId={folderId}
                placeholder={t('details.tags.addPlaceholder', 'Add a tag…')}
              />
            </CollapsibleSection>

            {/* Sécurité — pas pour un raccourci : il n'y a rien a proteger
                ici, les octets sont dans le coffre (et sous SA cle). */}
            {!shortcutRef && (
              <CollapsibleSection
                title={t('details.security.title', 'Security')}
                defaultOpen={false}
              >
                <div className="flex items-center gap-2 py-1.5 text-sm">
                  <span className="text-[var(--color-text-tertiary)]">
                    {t('details.security.password', 'Password')}
                  </span>
                  <span className="ml-auto">
                    {isProtected(item.id) ? (
                      <span className="flex items-center gap-1.5">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                          stroke="currentColor"
                          className={`w-4 h-4 ${isUnlockedForSession(item.id) ? 'text-green-500' : 'text-[var(--color-warning-500)]'}`}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                          />
                        </svg>
                        <span className="text-[var(--color-text-primary)] text-xs font-medium">
                          {isUnlockedForSession(item.id)
                            ? t('details.security.unlocked', 'Unlocked')
                            : t('details.security.protected', 'Protected')}
                        </span>
                      </span>
                    ) : (
                      <span className="text-[var(--color-text-tertiary)] text-xs">
                        {t('details.security.notProtected', 'Not protected')}
                      </span>
                    )}
                  </span>
                </div>
              </CollapsibleSection>
            )}
          </>
        )}

        {/* Partage — uniquement quand l'hote a quelque chose a en dire.
            `planSharingSection` rend null pour un `sharing` absent OU vide :
            un titre « Partage » deplie sur du blanc ferait croire a un
            chargement rate. Ce qui suit ne calcule rien, il pose le plan. */}
        {sharingPlan && (
          <CollapsibleSection title={t('details.sharing.title', 'Sharing')} defaultOpen>
            {sharingPlan.memberCount !== null && (
              <InfoRow
                label={t('details.sharing.members', 'Members')}
                value={
                  <span className="inline-flex items-center gap-2">
                    <AvatarStack
                      items={sharingPlan.avatarItems}
                      size="xs"
                      max={SHARING_LIST_LIMIT}
                    />
                    <span>
                      {t('details.sharing.memberCount', {
                        count: sharingPlan.memberCount,
                        defaultValue: `${sharingPlan.memberCount} member(s)`,
                      })}
                    </span>
                  </span>
                }
              />
            )}
            {sharingPlan.visibleMembers.length > 0 && (
              <ul className="list-none m-0 p-0 pb-1.5 flex flex-col gap-1">
                {sharingPlan.visibleMembers.map((member, index) => (
                  // L'identifiant n'est pas garanti unique par l'hote (deux
                  // lignes pour un meme compte a deux roles) : l'index leve
                  // l'ambiguite, la liste ne se reordonne pas en place.
                  <li
                    key={`${member.userId}-${index}`}
                    className="flex items-center justify-between gap-3 text-xs"
                  >
                    <span
                      className="text-[var(--color-text-primary)] truncate min-w-0"
                      title={member.label}
                    >
                      {member.label}
                    </span>
                    <span className="text-[var(--color-text-tertiary)] shrink-0">
                      {roleLabel(member.role)}
                    </span>
                  </li>
                ))}
                {sharingPlan.hiddenMemberCount > 0 && (
                  <li className="text-xs text-[var(--color-text-tertiary)]">
                    {t('details.sharing.more', {
                      count: sharingPlan.hiddenMemberCount,
                      defaultValue: `and ${sharingPlan.hiddenMemberCount} more`,
                    })}
                  </li>
                )}
              </ul>
            )}

            {sharingPlan.visibleGrantees.length > 0 && (
              <div className="py-1.5">
                <p className="text-sm text-[var(--color-text-tertiary)] m-0 mb-1">
                  {t('details.sharing.grantees', 'Shared with')}
                </p>
                <ul className="list-none m-0 p-0 flex flex-col gap-1">
                  {sharingPlan.visibleGrantees.map((grantee, index) => (
                    <li
                      key={`${grantee.label}-${index}`}
                      className="flex items-center justify-between gap-3 text-xs"
                    >
                      <span
                        className="text-[var(--color-text-primary)] truncate min-w-0"
                        title={grantee.label}
                      >
                        {grantee.label}
                      </span>
                      {/* Pastille « perime » : l'acces a ete scelle avec une
                          cle depassee. Le -100/-700 est le couple pastel/texte
                          que chaque theme entretient (cf. Avatar.css). */}
                      {grantee.stale && (
                        <span
                          className="shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide
                            bg-[var(--color-warning-100)] text-[var(--color-warning-700)]"
                          title={t(
                            'details.sharing.staleHint',
                            'Granted with an outdated key — share again to refresh it'
                          )}
                        >
                          {t('details.sharing.stale', 'Expired')}
                        </span>
                      )}
                    </li>
                  ))}
                  {sharingPlan.hiddenGranteeCount > 0 && (
                    <li className="text-xs text-[var(--color-text-tertiary)]">
                      {t('details.sharing.more', {
                        count: sharingPlan.hiddenGranteeCount,
                        defaultValue: `and ${sharingPlan.hiddenGranteeCount} more`,
                      })}
                    </li>
                  )}
                </ul>
              </div>
            )}

            {sharingPlan.showNotShared && (
              <p className="text-xs text-[var(--color-text-tertiary)] py-1.5 m-0">
                {t('details.sharing.notShared', 'Not shared with anyone yet')}
              </p>
            )}

            {/* Journal coupe : l'avis s'affiche TOUJOURS, meme a cote de
                lignes d'activite — un element dont on n'enregistre rien
                merite qu'on le dise, jamais qu'on le cache. */}
            {sharingPlan.showActivityDisabledNotice && (
              <p
                role="note"
                className="mt-1.5 mb-1 px-2.5 py-2 rounded-md text-xs bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)]"
              >
                {t(
                  'details.sharing.activityDisabled',
                  'Activity log is off for this item: no action is recorded.'
                )}
              </p>
            )}

            {(sharingPlan.activity.length > 0 || sharingPlan.showNoActivity) && (
              <div className="py-1.5">
                <p className="text-sm text-[var(--color-text-tertiary)] m-0 mb-1">
                  {t('details.sharing.activity', 'Recent activity')}
                </p>
                {sharingPlan.showNoActivity ? (
                  <p className="text-xs text-[var(--color-text-tertiary)] m-0">
                    {t('details.sharing.noActivity', 'No activity yet')}
                  </p>
                ) : (
                  <ul className="list-none m-0 p-0 flex flex-col gap-1">
                    {sharingPlan.activity.map((entry, index) => (
                      <li
                        key={`${entry.at}-${index}`}
                        className="flex items-baseline justify-between gap-3 text-xs"
                      >
                        <span className="text-[var(--color-text-primary)] min-w-0 break-words">
                          {entry.text}
                        </span>
                        <span className="text-[var(--color-text-tertiary)] shrink-0">
                          {relativeTime(activityTimestampIso(entry.at))}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {(sharingPlan.showManageButton || sharingPlan.showViewAllLink) && (
              <div className="flex items-center gap-2 pt-2">
                {sharingPlan.showManageButton && (
                  <Button variant="secondary" size="sm" onClick={sharing?.onOpenShareDialog}>
                    {t('details.sharing.manageAccess', 'Manage access')}
                  </Button>
                )}
                {sharingPlan.showViewAllLink && (
                  <Button variant="ghost" size="sm" onClick={sharing?.onViewActivity}>
                    {t('details.sharing.viewAll', 'View all')}
                  </Button>
                )}
              </div>
            )}
          </CollapsibleSection>
        )}

        {/* Description */}
        {item.description && (
          <CollapsibleSection
            title={t('details.description.title', 'Description')}
            defaultOpen={false}
          >
            <p className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap">
              {item.description}
            </p>
          </CollapsibleSection>
        )}
      </div>
    </div>
  );
};

export default FileDetailsPanel;
