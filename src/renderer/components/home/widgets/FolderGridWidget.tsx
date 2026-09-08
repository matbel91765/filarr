/**
 * Bloc « Tous les dossiers » — LE bloc qui porte tout le reste.
 *
 * Glisser-déposer complet (avec ressort d'ouverture automatique, témoin de
 * dépôt, superposition « déplacement en cours »), clic droit sur chaque carte,
 * bascule grille/liste, bouton « Nouveau », état vide. C'est pour lui que
 * l'accueil modulaire a été découpé dans cet ordre : il part en dernier, et il
 * garde TOUT son comportement.
 *
 * ── L'ACCUEIL MÊLÉ (lot A, C4) ──────────────────────────────────────────────
 *
 * Les coffres partagés n'ont plus de section à part : leurs cartes prennent
 * place DANS cette grille, après les dossiers, sans en-tête de groupe
 * (`folderGridOrder.ts` dit l'ordre). Deux différences, toutes deux voulues :
 *   · AUCUN glisser-déposer sur une carte de coffre — déposer dans un coffre est
 *     le geste chiffrant d'`AddToVaultDialog`, pas un déplacement de dossier ;
 *   · le bouton « Nouveau » devient un menu : dossier, coffre partagé, code
 *     d'invitation — les deux entrées « coffre » n'existent que si le compte y
 *     a droit (règle 13 : jamais hors nuage).
 * La pastille « activité nouvelle » vient de `selectUnseenVaultIds` (Redux),
 * les cartes ne lisent jamais localStorage elles-mêmes.
 *
 * ── POURQUOI IL LIT UN CONTEXTE À PART ──────────────────────────────────────
 *
 * L'état du glisser-déposer change des dizaines de fois par seconde pendant un
 * glissement. Il vit donc dans `HomeGridStateContext`, que ce bloc est le SEUL à
 * consommer : les dix autres widgets ne le lisent pas, et ne re-rendent donc pas
 * pendant qu'on traîne un dossier au-dessus d'un autre.
 *
 * ── LA BASCULE GRILLE/LISTE EST DEVENUE UN RÉGLAGE ──────────────────────────
 *
 * C'était un `useState` local : le choix était perdu à chaque changement d'écran
 * et ne suivait aucun appareil. Il est maintenant écrit dans l'emplacement
 * (`options.viewMode`), donc il se synchronise — et l'amorçage le pré-remplit
 * déjà à partir de `settings.display.defaultViewMode`.
 */

import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';

import { Button } from '../../ui/Button';
import { Dropdown, type DropdownItem } from '../../ui/Dropdown';
import { SpringDwellRing } from '../../ui/SpringDwellRing';
import { MovingOverlay } from '../../files/FileCard';
import { VaultCardGrid, VaultRowList } from '../../vaults/VaultCards';
import { isProtected, isUnlockedForSession } from '../../../../services/auth/filePasswordService';
import type { Folder } from '../../../../types';
import type { RootState } from '../../../../store';
import { selectUnseenVaultIds, loadVaults } from '../../../../store/slices/vaultsSlice';
import type { AppDispatch } from '../../../../store';
import { selectCanUseTeamVaults } from '../../../../store/selectors/authSelectors';
import { useHomeActions, useHomeGridState } from '../HomeActionsContext';
import { selectRootFolders, selectSharedVaults } from '../homeSelectors';
import { readEnumOption, type WidgetOptionSchema, type WidgetProps } from '../widgetOptions';
import { mixHomeCards } from './folderGridOrder';

export const FOLDER_GRID_OPTIONS: WidgetOptionSchema = [
  {
    kind: 'enum',
    key: 'viewMode',
    labelKey: 'home.widgets.opt.viewMode',
    fallback: 'grid',
    choices: [
      { value: 'grid', labelKey: 'home.gridView' },
      { value: 'list', labelKey: 'home.listView' },
    ],
  },
];

// ==================== Icônes ====================

const FolderGlyph: React.FC<{ color?: string; className: string }> = ({ color, className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill={color || 'var(--color-primary-500)'}
    viewBox="0 0 24 24"
    className={className}
    aria-hidden="true"
  >
    <path d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
  </svg>
);

const MoreDotsIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    className="w-4 h-4 text-[var(--color-text-secondary)]"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z"
    />
  </svg>
);

const BellIcon: React.FC<{ className: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
    />
  </svg>
);

/** Cadenas ouvert / fermé — le même dessin qu'avant, aux deux endroits. */
const LockGlyph: React.FC<{ unlocked: boolean; className: string; strokeWidth: number }> = ({
  unlocked,
  className,
  strokeWidth,
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={strokeWidth}
    stroke="currentColor"
    className={className}
    aria-hidden="true"
  >
    {unlocked ? (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
      />
    ) : (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
      />
    )}
  </svg>
);

// ==================== Une carte ====================

interface FolderRowProps {
  folder: Folder;
  /** Rendu en liste : la première ligne n'a pas de filet au-dessus. */
  first?: boolean;
  dropTarget: boolean;
  springing: boolean;
  moving: boolean;
  dragging: boolean;
  /**
   * La protection est calculée PAR LE PARENT et descend en booléens.
   *
   * `isProtected` lit le stockage local, qui n'est pas réactif : une carte
   * mémoïsée qui l'interrogerait elle-même garderait son cadenas d'avant après
   * un changement de mot de passe. Le parent, lui, re-rend (il lit le contexte
   * volatil, où vit le compteur de protection), recalcule, et seules les cartes
   * dont le booléen a VRAIMENT changé se re-rendent.
   */
  protectedFolder: boolean;
  unlocked: boolean;
}

/**
 * Les rappels ne descendent pas par les props : la carte les prend dans le
 * contexte des actions, dont la valeur ne change jamais. Seul l'état qui la
 * concerne DIRECTEMENT (est-elle la cible du dépôt ? est-elle en vol ?) arrive
 * en props, et il est booléen — donc `React.memo` élimine les N−1 cartes que le
 * survol d'une voisine ne touche pas.
 */
const FolderCardGrid: React.FC<FolderRowProps> = React.memo(function FolderCardGrid({
  folder,
  dropTarget,
  springing,
  moving,
  dragging,
  protectedFolder,
  unlocked,
}) {
  const { t } = useTranslation();
  const actions = useHomeActions();
  const reminders = (folder as { reminders?: unknown[] }).reminders;

  return (
    <div
      onClick={() => actions.openFolder(folder.id)}
      onContextMenu={(e) => actions.folderContextMenu(e, folder)}
      draggable
      onDragStart={(e) => actions.dragStart(e, folder)}
      onDragEnd={actions.dragEnd}
      onDragOver={(e) => actions.dragOver(e, folder.id)}
      onDragEnter={(e) => actions.dragEnter(e, folder.id)}
      onDragLeave={actions.dragLeave}
      onDrop={(e) => actions.drop(e, folder.id)}
      className={`group relative rounded-xl border cursor-pointer select-none
      transition-all duration-200 overflow-hidden
      bg-[var(--color-surface)] border-[var(--color-border)] shadow-sm
      hover:shadow-lg hover:border-[var(--color-primary-200)] hover:-translate-y-0.5
      ${dropTarget ? 'ring-2 ring-[var(--color-primary-400)] border-dashed border-[var(--color-primary-400)]' : ''}
      ${moving ? 'pointer-events-none' : ''}
      ${dragging ? 'opacity-50 scale-95' : ''}`}
    >
      {/* Attente avant l'ouverture automatique. Montée tant que la cible est
          armée : le balayage repart pile quand le minuteur repart. */}
      {springing && <SpringDwellRing key={folder.id} />}
      {moving && <MovingOverlay />}

      {/* Thumbnail / preview area */}
      <div
        className="h-[120px] flex items-center justify-center"
        style={{
          backgroundColor: folder.color ? `${folder.color}15` : 'var(--color-background-secondary)',
        }}
      >
        {folder.emoji ? (
          <span className="text-5xl leading-none">{folder.emoji}</span>
        ) : (
          <FolderGlyph
            color={folder.color || 'var(--color-primary-400)'}
            className="w-14 h-14 opacity-50"
          />
        )}
      </div>

      {/* Info bar */}
      <div className="flex items-center gap-3 px-3 py-2.5 bg-[var(--color-surface)] border-t border-[var(--color-border-light)]">
        {folder.emoji ? (
          <span className="text-lg leading-none shrink-0">{folder.emoji}</span>
        ) : (
          <FolderGlyph color={folder.color} className="w-5 h-5 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
            {folder.name}
          </p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            actions.folderContextMenu(e, folder);
          }}
          className="opacity-0 group-hover:opacity-100 p-1 rounded-full
          hover:bg-[var(--color-background-secondary)] transition-opacity duration-150"
        >
          <MoreDotsIcon />
        </button>
      </div>

      {/* Badges */}
      <div className="absolute top-2 right-2 flex items-center gap-1.5">
        {protectedFolder && (
          <div
            className={`flex items-center justify-center w-6 h-6 rounded-full shadow-sm
          ${unlocked ? 'bg-green-500/90 text-white' : 'bg-[var(--color-text-secondary)] text-white'}`}
            title={unlocked ? t('password.unlockedSession') : t('password.protected')}
          >
            <LockGlyph unlocked={unlocked} className="w-3 h-3" strokeWidth={2.5} />
          </div>
        )}
        {Array.isArray(reminders) && reminders.length > 0 && (
          <div className="bg-amber-500 text-white text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm">
            <BellIcon className="w-3 h-3" />
            {reminders.length}
          </div>
        )}
      </div>
    </div>
  );
});

const FolderRowList: React.FC<FolderRowProps> = React.memo(function FolderRowList({
  folder,
  first,
  dropTarget,
  springing,
  moving,
  dragging,
  protectedFolder,
  unlocked,
}) {
  const { t } = useTranslation();
  const actions = useHomeActions();
  const reminders = (folder as { reminders?: unknown[] }).reminders;

  return (
    <div
      onClick={() => actions.openFolder(folder.id)}
      onContextMenu={(e) => actions.folderContextMenu(e, folder)}
      draggable
      onDragStart={(e) => actions.dragStart(e, folder)}
      onDragEnd={actions.dragEnd}
      onDragOver={(e) => actions.dragOver(e, folder.id)}
      onDragEnter={(e) => actions.dragEnter(e, folder.id)}
      onDragLeave={actions.dragLeave}
      onDrop={(e) => actions.drop(e, folder.id)}
      className={`group relative flex items-center gap-4 px-4 py-3 cursor-pointer select-none
      transition-colors duration-100
      hover:bg-[var(--color-background-secondary)]
      ${!first ? 'border-t border-[var(--color-border-light)]' : ''}
      ${dropTarget ? 'ring-2 ring-inset ring-[var(--color-primary-400)]' : ''}
      ${moving ? 'pointer-events-none' : ''}
      ${dragging ? 'opacity-50' : ''}`}
    >
      {springing && <SpringDwellRing key={folder.id} />}
      {moving && <MovingOverlay />}
      {folder.emoji ? (
        <span className="text-xl leading-none shrink-0">{folder.emoji}</span>
      ) : (
        <FolderGlyph color={folder.color} className="w-6 h-6 shrink-0" />
      )}
      <span className="flex-1 text-sm text-[var(--color-text-primary)] truncate font-medium flex items-center gap-1.5">
        {folder.name}
        {protectedFolder && (
          <span
            className={`shrink-0 ${unlocked ? 'text-green-500' : 'text-[var(--color-text-tertiary)]'}`}
            title={unlocked ? t('password.unlockedSession') : t('password.protected')}
          >
            <LockGlyph unlocked={unlocked} className="w-3.5 h-3.5" strokeWidth={2} />
          </span>
        )}
      </span>
      <span className="text-xs text-[var(--color-text-tertiary)] hidden sm:inline">
        {folder.items?.length || 0} {t('home.items', 'élément(s)')}
      </span>
      {Array.isArray(reminders) && reminders.length > 0 && (
        <span className="text-xs text-amber-500 flex items-center gap-1">
          <BellIcon className="w-3.5 h-3.5" />
          {reminders.length}
        </span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          actions.folderContextMenu(e, folder);
        }}
        className="opacity-0 group-hover:opacity-100 p-1 rounded-full
        hover:bg-[var(--color-background-secondary)] transition-opacity duration-150"
      >
        <MoreDotsIcon />
      </button>
    </div>
  );
});

// ==================== Le bloc ====================

export const FolderGridWidget: React.FC<WidgetProps> = React.memo(function FolderGridWidget({
  slotId,
  options,
}) {
  const { t } = useTranslation();
  const actions = useHomeActions();
  const folders = useSelector(selectRootFolders);
  // Les coffres : la LISTE (mémoïsée), les déverrouillés, la pastille. Aucun
  // chargement ici — `VaultsBootstrapHost` est l'autorité unique.
  const sharedVaults = useSelector(selectSharedVaults);
  const unlockedVaultIds = useSelector((s: RootState) => s.vaults.unlockedVaultIds);
  const unseenVaultIds = useSelector(selectUnseenVaultIds);
  const canUseTeamVaults = useSelector(selectCanUseTeamVaults);
  const dispatch = useDispatch<AppDispatch>();
  /**
   * L'ÉCHEC DE CHARGEMENT DES COFFRES ÉTAIT INVISIBLE ICI. `vaults.error`
   * n'était lu que par la boîte « Ajouter à un coffre » : l'accueil affichait
   * simplement une grille sans coffres — indiscernable d'un compte qui n'en a
   * pas (cas réel du 2026-09-01 sur le web : coffre « disparu », en fait un
   * chargement raté au démarrage, sans un mot nulle part). Une absence qui a
   * une CAUSE se dit, avec le geste pour réessayer.
   */
  const vaultsLoadError = useSelector((s: RootState) => s.vaults.error);
  const vaultsLoading = useSelector((s: RootState) => s.vaults.loading);
  /**
   * L'objet ENTIER, pas ses champs : `passwordVersion` n'est jamais lu ici, mais
   * lire le contexte suffit à faire re-rendre ce bloc quand il change — et c'est
   * ce rendu qui recalcule les cadenas des cartes. Le déstructurer laisserait une
   * variable inutilisée, le lire ainsi dit exactement ce qui se passe.
   */
  const gridState = useHomeGridState();

  const viewMode = readEnumOption(FOLDER_GRID_OPTIONS, options, 'viewMode');

  const setViewMode = useCallback(
    (mode: 'grid' | 'list') => actions.setSlotOption(slotId, 'viewMode', mode),
    [actions, slotId]
  );

  /** La grille mêlée : dossiers, puis coffres rangés (voir `folderGridOrder`). */
  const cards = useMemo(
    () => mixHomeCards(folders, sharedVaults, unlockedVaultIds),
    [folders, sharedVaults, unlockedVaultIds]
  );

  /**
   * Le menu « Nouveau ». Les deux entrées « coffre » ne sont pas grisées mais
   * ABSENTES quand le compte n'y a pas droit : un menu n'est pas l'endroit où
   * vendre une offre (même règle que le bloc « Coffres partagés »).
   */
  const newMenuItems = useMemo<DropdownItem[]>(
    () => [
      { label: t('home.newMenu.folder', 'Nouveau dossier'), onClick: actions.createFolder },
      ...(canUseTeamVaults
        ? [
            {
              label: t('home.newMenu.vault', 'Nouveau coffre partagé'),
              onClick: actions.createVault,
            },
            {
              label: t('home.newMenu.inviteCode', "J'ai un code d'invitation…"),
              onClick: actions.enterInviteCode,
            },
          ]
        : []),
    ],
    [t, actions, canUseTeamVaults]
  );

  return (
    <section className="h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-3 home-widget__header">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] m-0">
          {t('home.allFolders', 'Tous les dossiers')}
        </h2>
        <div className="flex items-center gap-1">
          {/* View mode toggle */}
          <div className="flex items-center bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-0.5 mr-2">
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-md transition-all duration-150
              ${
                viewMode === 'list'
                  ? 'bg-[var(--color-primary-50)] text-[var(--color-primary-600)] shadow-sm'
                  : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
              }`}
              title={t('home.listView', 'Vue liste')}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="w-4 h-4"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                />
              </svg>
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-md transition-all duration-150
              ${
                viewMode === 'grid'
                  ? 'bg-[var(--color-primary-50)] text-[var(--color-primary-600)] shadow-sm'
                  : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
              }`}
              title={t('home.gridView', 'Vue grille')}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="w-4 h-4"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
                />
              </svg>
            </button>
          </div>

          {/* « Nouveau » : un menu, pas un bouton — dossier, coffre, code. Le
              bouton n'a pas de `onClick` : c'est l'enveloppe du menu qui écoute. */}
          <Dropdown
            position="bottom-right"
            items={newMenuItems}
            trigger={
              <Button
                variant="primary"
                size="sm"
                data-tour-new
                aria-haspopup="menu"
                leftIcon={
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                }
              >
                {t('home.newFolder', 'Nouveau')}
              </Button>
            }
          />
        </div>
      </div>

      {canUseTeamVaults && vaultsLoadError && sharedVaults.length === 0 && (
        <div
          className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2"
          role="alert"
        >
          <p className="text-xs m-0 text-[var(--color-text-secondary)]">
            {t(
              'home.vaultsLoadFailed',
              'Vos coffres partagés n’ont pas pu être chargés — ils ne sont pas perdus.'
            )}
          </p>
          <Button
            size="sm"
            variant="tertiary"
            loading={vaultsLoading}
            onClick={() => void dispatch(loadVaults())}
          >
            {t('common.retry', 'Réessayer')}
          </Button>
        </div>
      )}

      {cards.length === 0 ? (
        /* Empty state */
        <div
          className="flex flex-col items-center justify-center py-20 text-center
        bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-sm"
        >
          <div className="w-24 h-24 rounded-full bg-[var(--color-primary-50)] flex items-center justify-center mb-6">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1}
              stroke="var(--color-primary-400)"
              className="w-12 h-12"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-[var(--color-text-primary)] mb-2">
            {t('home.emptyTitle', 'Aucun dossier')}
          </h3>
          <p className="text-sm text-[var(--color-text-secondary)] max-w-md mb-6">
            {t(
              'home.emptyText',
              'Créez votre premier dossier pour commencer à organiser vos fichiers'
            )}
          </p>
          <Button variant="primary" size="md" onClick={actions.createFolder}>
            {t('home.createFirst', 'Créer mon premier dossier')}
          </Button>
        </div>
      ) : viewMode === 'grid' ? (
        /* ===== Grid View (Google Drive file cards) ===== */
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {cards.map((card) =>
            card.kind === 'folder' ? (
              <FolderCardGrid
                key={card.folder.id}
                folder={card.folder}
                dropTarget={gridState.dropTarget === card.folder.id}
                springing={gridState.springTarget === card.folder.id}
                moving={gridState.pendingMove?.itemId === card.folder.id}
                dragging={gridState.draggedItem?.id === card.folder.id}
                protectedFolder={isProtected(card.folder.id)}
                unlocked={isUnlockedForSession(card.folder.id)}
              />
            ) : (
              <VaultCardGrid
                key={`vault-${card.vault.id}`}
                vault={card.vault}
                unlocked={card.unlocked}
                unseen={unseenVaultIds.has(card.vault.id)}
                onOpen={actions.openVault}
                onContextMenu={actions.vaultContextMenu}
              />
            )
          )}
        </div>
      ) : (
        /* ===== List View ===== */
        <div className="flex flex-col rounded-xl border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)] shadow-sm">
          {cards.map((card, index) =>
            card.kind === 'folder' ? (
              <FolderRowList
                key={card.folder.id}
                folder={card.folder}
                first={index === 0}
                dropTarget={gridState.dropTarget === card.folder.id}
                springing={gridState.springTarget === card.folder.id}
                moving={gridState.pendingMove?.itemId === card.folder.id}
                dragging={gridState.draggedItem?.id === card.folder.id}
                protectedFolder={isProtected(card.folder.id)}
                unlocked={isUnlockedForSession(card.folder.id)}
              />
            ) : (
              <VaultRowList
                key={`vault-${card.vault.id}`}
                vault={card.vault}
                first={index === 0}
                unlocked={card.unlocked}
                unseen={unseenVaultIds.has(card.vault.id)}
                onOpen={actions.openVault}
                onContextMenu={actions.vaultContextMenu}
              />
            )
          )}
        </div>
      )}
    </section>
  );
});

export default FolderGridWidget;
