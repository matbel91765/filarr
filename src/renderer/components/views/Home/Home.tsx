/**
 * Home View — l'accueil MODULAIRE.
 *
 * ── CE QUI A CHANGÉ, ET CE QUI N'A PAS CHANGÉ ───────────────────────────────
 *
 * Ce qui a changé : l'accueil n'écrit plus ses sections en dur. Il lit le
 * document de mise en page (`layout.enc`, vue `home`), le donne au moteur de
 * grille, et chaque emplacement est résolu contre le REGISTRE DE WIDGETS. Ce qui
 * s'affiche, dans quel ordre et à quelle taille, appartient donc à
 * l'utilisateur — et se synchronise entre ses appareils.
 *
 * Ce qui n'a pas changé : absolument tout le comportement. Le glisser-déposer
 * avec ressort et témoins, le clic droit sur une carte ET sur le fond, les neuf
 * modales du menu de dossier, le panneau de détails, les coffres partagés, les
 * avis de déplacement. Ces choses vivent TOUJOURS ici, au niveau de la page :
 *
 *   · les modales, parce qu'elles portent un état qui doit survivre au fait
 *     qu'un widget se re-rende, disparaisse ou change de place ;
 *   · les rappels qui les ouvrent, parce que réunis dans `HomeActionsContext`
 *     ils gardent une identité stable, ce qui est la condition pour que les
 *     widgets restent mémoïsés.
 *
 * ── LE REPLI, ET POURQUOI IL N'ÉCRIT RIEN ───────────────────────────────────
 *
 * Quand le document ne porte pas encore de vue `home` (profil neuf sur le web,
 * chargement en cours, mise en page du nuage pas redescendue), l'accueil rend le
 * modèle « Essentiel » EN MÉMOIRE. Il ne le scelle pas : le contrat de
 * `layout:load` dit qu'un document non amorcé est PROVISOIRE, et écrire par
 * dessus écraserait la disposition que le nuage est en train de livrer.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  FC,
  DragEvent,
  MouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { ContextMenu } from '../../ui/ContextMenu';
import { PromptModal } from '../../ui/PromptModal';
import { CreateFolderModal } from '../../ui/CreateFolderModal';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { FolderStyleModal } from '../../ui/FolderStyleModal/FolderStyleModal';
import { MoveCopyDialog } from '../../ui/MoveCopyDialog';
import { ReminderModal, type ReminderData } from '../../ui/ReminderModal';
import { buildReminder } from '../../../../services/reminders/reminderFactory';
import { DeleteFolderConfirmModal } from '../../ui/DeleteFolderConfirmModal';
import { FolderPasswordModal } from '../../files/FolderPasswordModal';
import { ProtectInPlaceDialog } from '../../protect';
// Le menu contextuel PARTAGÉ avec la vue dossier : même ordre, mêmes libellés,
// mêmes icônes — l'accueil n'a plus son dialecte à lui.
import { buildItemContextMenu, buildBackgroundContextMenu } from '../../files/itemContextMenu';
// Un coffre partagé est un dossier de plus : son clic droit est celui de la page
// des coffres, importé — jamais recopié.
import { useVaultCardMenu } from '../../vaults/useVaultCardMenu';
import { vaultFolderRoute } from '../../layout/RouteContent/routeCompat';
import {
  AddToVaultDialog,
  useVaultAddTargets,
  type AddToVaultSource,
} from '../../vaults/AddToVaultDialog';
// Lot A (C4/C5) : créer un coffre et coller un code se font DEPUIS L'ACCUEIL ;
// le bandeau porte ce qui attend (invitations, accès promis, partagé avec moi).
import { CreateVaultModal } from '../../vaults/CreateVaultModal';
import { VaultKeypairGateModal } from '../../vaults/VaultKeypairGate';
import { VaultInboxBanner, InviteCodeModal } from '../../vaults/VaultInboxBanner';
import { selectCanUseTeamVaults } from '../../../../store/selectors/authSelectors';
import FileDetailsPanel from '../FolderView/FileDetailsPanel';
// ── L'accueil modulaire ───────────────────────────────────────────────────
import { GridSurface } from '../../grid/GridSurface';
import { GRID_COLUMNS, GRID_GUTTER, columnsForWidth, gridSize } from '../../grid/gridTypes';
import type {
  GridAllowedSizes,
  GridConstraintMap,
  GridPlacement,
  GridSizeConstraints,
  GridSizeId,
} from '../../grid/gridTypes';
import { insertItem, moveItem } from '../../grid/gridSolver';
import { WidgetFrame } from '../../home/WidgetFrame';
import { EditBar } from '../../home/EditBar';
import { WidgetPalette } from '../../home/WidgetPalette';
import { WidgetInspector } from '../../home/WidgetInspector';
import {
  HomeActionsProvider,
  HomeGridStateProvider,
  type HomeActions,
  type HomeGridState,
} from '../../home/HomeActionsContext';
import { resolveWidget, type WidgetDefinition } from '../../home/widgetRegistry';
import {
  ESSENTIAL_TEMPLATE,
  essentialHomeView,
  mergeGeometry,
  toPlacements,
} from '../../home/homeLayout';
// Les réglages de la PAGE (aujourd'hui : sa largeur), rangés dans un
// emplacement réservé pour se synchroniser comme le reste de la mise en page.
import {
  homeGridSlots,
  homeRowHeight,
  readHomeConfigFromSlots,
  withHomeConfig,
  type HomeWidth,
} from '../../home/homeConfig';
import { selectSharedVaults } from '../../home/homeSelectors';
// ── Modèles de mise en page partageables (.filarrlayout) ──────────────────
import { ExportLayoutDialog } from '../../home/ExportLayoutDialog';
import { ImportLayoutDialog, type ImportSource } from '../../home/ImportLayoutDialog';
import { HomeViewSwitcher } from '../../home/HomeViewSwitcher';
import { UnavailableWidget } from '../../home/UnavailableWidget';
import { readUnavailableInfo } from '../../home/layoutTransfer';
import { clearFreshView, isFreshView } from '../../home/freshView';
import {
  duplicateSlotsForView,
  homeViewName,
  planSaveAs,
  useActiveHomeView,
} from '../../home/homeViews';
import {
  onLayoutFileOpened,
  takePendingLayoutOpen,
} from '../../../../services/layouts/layoutFileIo';
import { Dropdown, type DropdownItem } from '../../ui/Dropdown';
import { breakpointForWidth } from '../../../styles/breakpoints';
// La largeur de la page (`.home-page--centered`) vit dans cette feuille : c'est
// cet écran qui pose la classe, c'est donc lui qui déclare en avoir besoin.
import '../../home/home.css';
import '../../home/homeEdit.css';
import useFolder from '../../../../hooks/useFolder';
import useContextMenu from '../../../../hooks/useContextMenu';
import useDragAndDrop, {
  MOVING_TOAST_MIN_MS,
  ROOT_FOLDER_ID,
} from '../../../../hooks/useDragAndDrop';
import { useNotification } from '../../ui/Notification';
import { moveFolder } from '../../../../services/core/folderService';
import { createDailyNote } from '../../../../services/notes/noteService';
import { fetchFolders } from '../../../../store/slices/foldersSlice';
import { addFavorite, addRecentFile } from '../../../../store/slices/favoritesSlice';
import {
  addNote,
  selectNote,
  setNotesFilterNotebook,
  setNotesFilterUnfiled,
} from '../../../../store/slices/notesSlice';
import {
  beginLayoutEdit,
  cancelLayoutEdit,
  setView,
  clearLayoutCommit,
  commitLayoutEdit,
  flashLayoutSlot,
  pushLayoutDraft,
  redoLayoutDraft,
  revertLayoutCommit,
  saveLayoutToDisk,
  selectLayoutSlot,
  setLayoutPanel,
  setViewSlots,
  undoLayoutDraft,
} from '../../../../store/slices/layoutSlice';
import type { Folder, Reminder, Item } from '../../../../types';
import type { AppDispatch, RootState } from '../../../../store';
import {
  instantiate,
  type LayoutSlot,
  type LayoutTemplate,
} from '../../../../services/layout/layoutTypes';
import type { FolderDeletionInfo } from '../../../../hooks/useFolderOperations';

/**
 * Délai avant de sceller une disposition. Un geste de rangement en appelle
 * souvent trois d'affilée (on pousse, on hésite, on repousse) ; sceller à chaque
 * fois écrirait trois fois le conteneur chiffré et pousserait trois cycles de
 * synchronisation pour un seul rangement.
 */
const LAYOUT_SAVE_DEBOUNCE_MS = 800;

/**
 * Durée du toast « Accueil enregistré · Annuler », et donc durée de vie de la
 * trace qui rend ce « Annuler » possible. Huit secondes : le temps de lire, de
 * regarder l'accueil, et de se dire non.
 */
const SAVED_TOAST_MS = 8000;

/** Durée du clignotement d'un bloc qu'on vient de poser. */
const FLASH_MS = 400;

/**
 * Identité d'un nouvel emplacement.
 *
 * Le compteur n'est pas décoratif : instancier un gabarit crée six emplacements
 * dans la MÊME milliseconde, et `Date.now()` seul leur donnerait six fois le
 * même identifiant — six blocs que la grille traiterait comme un seul.
 */
let slotCounter = 0;
function newSlotId(): string {
  slotCounter += 1;
  return `slot-${Date.now().toString(36)}-${slotCounter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

/** Trois points verticaux — le produit n'embarque pas de bibliothèque d'icônes. */
const HomeMoreIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    className="home-header__glyph"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z"
    />
  </svg>
);

export const Home: FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const { folders, addFolder, editFolder, removeFolder } = useFolder();
  const { contextMenu, openContextMenu, closeContextMenu } = useContextMenu();
  const { notify, success, error, dismiss } = useNotification();

  // ===== Notes =====

  const handleOpenNote = useCallback(
    (noteId: string) => {
      dispatch(selectNote(noteId));
      navigate('/notes');
    },
    [dispatch, navigate]
  );

  // « Voir les N notes sans dossier » : la section Notes doit s'ouvrir SUR ces
  // notes-là. Sans le filtre, le bouton menait à la liste complète, où elles
  // redevenaient exactement aussi introuvables qu'avant.
  //
  // ORDRE IMPOSÉ : le carnet d'abord — poser un filtre de carnet lève le filtre
  // « sans dossier » (les deux vues sont exclusives), donc l'inverse annulerait
  // ce qu'on vient de demander.
  const handleSeeAllUnfiled = useCallback(() => {
    dispatch(setNotesFilterNotebook(null));
    dispatch(setNotesFilterUnfiled(true));
    navigate('/notes');
  }, [dispatch, navigate]);

  // « Toutes les notes » : l'inverse — on remet la liste à plat avant d'y aller,
  // sinon un filtre posé plus tôt fait mentir le bouton.
  const handleSeeAllNotes = useCallback(() => {
    dispatch(setNotesFilterNotebook(null));
    dispatch(setNotesFilterUnfiled(false));
    navigate('/notes');
  }, [dispatch, navigate]);

  // Le tableau est une DESTINATION à part entière (`/board`) : un simple lien.
  const handleOpenNotesBoard = useCallback(() => {
    navigate('/board');
  }, [navigate]);

  /**
   * Un jour du bloc Calendrier : la note quotidienne de ce jour, ouverte — ou
   * créée si elle n'existe pas. Même règle que le calendrier du bandeau des
   * notes, pour que les deux calendriers du produit se comportent pareil.
   */
  const notesById = useSelector((state: RootState) => state.notes.byId);
  const handleOpenDailyNote = useCallback(
    (isoDate: string) => {
      const existing = Object.values(notesById).find(
        (n) => n.isDaily && n.dailyDate === isoDate && !n.deletedAt
      );
      if (existing) {
        dispatch(selectNote(existing.id));
      } else {
        const note = createDailyNote(isoDate);
        dispatch(addNote(note));
        dispatch(selectNote(note.id));
      }
      navigate('/notes');
    },
    [notesById, dispatch, navigate]
  );

  // ===== Coffres partagés =====
  // Ils vivent dans leur propre section de l'app ; depuis l'accueil, rien ne
  // disait qu'ils existaient. Aucun mur de vente ici : sans coffre, pas de bloc.
  // L'accueil ne fait que LIRE la liste : son chargement appartient à
  // `VaultsBootstrapHost` (App), l'autorité unique — la garde « une tentative
  // par montage » qui vivait ici en doublait deux autres au premier rendu.
  const sharedVaults = useSelector(selectSharedVaults);

  const handleOpenVault = useCallback(
    (vaultId: string, itemId?: string) => navigate(vaultFolderRoute(vaultId, { itemId })),
    [navigate]
  );

  /**
   * OUVRIR LA FICHE « Où en est l'accès de X ? » (F04) plutôt que l'explorateur.
   *
   * Le bandeau annonce un accès que le balayage n'a pas pu accorder seul ; le
   * geste qui répond à cette phrase (comparer une empreinte, relancer, annuler)
   * vit dans l'onglet Invitations de la page de gestion. « Ouvrir le coffre »
   * déposait l'hôte devant une grille de fichiers, sans rien qui rappelle
   * pourquoi il était venu.
   */
  const handleOpenVaultAccess = useCallback(
    (vaultId: string, focus: string) =>
      navigate(vaultFolderRoute(vaultId, { view: 'settings', tab: 'invitations', focus })),
    [navigate]
  );

  /**
   * CRÉER UN COFFRE depuis l'accueil (lot A, C4) — en deux temps. La boîte de
   * création exige la paire de clés en mémoire (sceller K_vault à sa propre clé
   * publique), or un déverrouillage par PIN la laisse absente. Le gate est donc
   * monté À LA DEMANDE, en fenêtre : s'il n'a rien à demander, il rend la main
   * sans s'afficher et la boîte de création s'ouvre directement.
   */
  const [createVaultStage, setCreateVaultStage] = useState<'gate' | 'form' | null>(null);
  const handleCreateVault = useCallback(() => setCreateVaultStage('gate'), []);
  const handleVaultKeypairReady = useCallback(() => setCreateVaultStage('form'), []);
  /** « J'ai un code d'invitation… » — la même boîte pour le menu et le fond. */
  const [inviteCodeOpen, setInviteCodeOpen] = useState(false);
  const handleEnterInviteCode = useCallback(() => setInviteCodeOpen(true), []);
  // Règle 13 : hors nuage (ou sans droit aux coffres), le menu de fond ne
  // propose ni coffre ni code.
  const canUseTeamVaults = useSelector(selectCanUseTeamVaults);

  /**
   * Le clic droit d'une carte de coffre — le MÊME builder, les MÊMES boîtes que
   * dans l'explorateur d'un coffre (`/vault-folder/<id>`) — l'ancienne liste
   * `/vaults` a fondu dans l'accueil. `overlays` porte le panneau Membres/Activité et la
   * confirmation de départ ; il est rendu en bas de l'accueil.
   */
  const { menuFor: vaultMenuFor, overlays: vaultOverlays } = useVaultCardMenu();
  const sharedVaultsRef = useRef(sharedVaults);
  useEffect(() => {
    sharedVaultsRef.current = sharedVaults;
  }, [sharedVaults]);
  const handleVaultContextMenu = useCallback(
    (e: MouseEvent<HTMLElement>, vault: { id: string }) => {
      // `menuFor` attend le résumé complet du coffre : on le relit dans la liste
      // plutôt que de le faire voyager par la carte.
      const cible = sharedVaultsRef.current.find((v) => v.id === vault.id);
      if (!cible) return;
      openContextMenu(e as any, vaultMenuFor(cible));
    },
    [openContextMenu, vaultMenuFor]
  );

  // ===== « Ajouter au coffre partagé… » =====
  // L'entrée n'existe QUE s'il y a au moins un coffre déverrouillé où ce compte
  // peut écrire : un menu contextuel n'est pas un endroit où vendre une offre.
  const vaultAddTargets = useVaultAddTargets();
  const canAddToVault = vaultAddTargets.length > 0;
  const [addToVaultSource, setAddToVaultSource] = useState<AddToVaultSource | null>(null);

  // ===== Avis de déplacement =====
  // Posé au départ, retiré à l'arrivée (succès COMME échec). Son identifiant
  // tient dans une ref : un state ne servirait qu'à re-rendre pour rien.
  const movingToastRef = useRef<string | null>(null);
  const movingToastAtRef = useRef<number>(0);
  const movingToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Retire l'avis de déplacement — mais pas avant `MOVING_TOAST_MIN_MS` : un
   * déplacement local se termine en quelques dizaines de millisecondes, et
   * l'avis clignotait alors trop vite pour que l'œil l'attrape. `immediate` sert
   * au démontage et quand un déplacement en chasse un autre.
   */
  const dismissMovingToast = useCallback(
    (immediate = false) => {
      if (movingToastTimerRef.current) {
        clearTimeout(movingToastTimerRef.current);
        movingToastTimerRef.current = null;
      }
      const id = movingToastRef.current;
      if (!id) return;
      movingToastRef.current = null;
      const shownFor = Date.now() - movingToastAtRef.current;
      if (immediate || shownFor >= MOVING_TOAST_MIN_MS) {
        dismiss(id);
        return;
      }
      movingToastTimerRef.current = setTimeout(() => {
        movingToastTimerRef.current = null;
        dismiss(id);
      }, MOVING_TOAST_MIN_MS - shownFor);
    },
    [dismiss]
  );

  // Quitter l'accueil en plein déplacement ne doit pas laisser l'avis orphelin
  // — ni un minuteur en vol.
  useEffect(() => () => dismissMovingToast(true), [dismissMovingToast]);

  // ===== Glisser-déposer =====
  const handleDnDSuccess = useCallback(
    (message: string) => {
      dismissMovingToast();
      success(message);
    },
    [success, dismissMovingToast]
  );
  const handleDnDError = useCallback(
    (message: string) => {
      dismissMovingToast();
      error(message);
    },
    [error, dismissMovingToast]
  );
  const handleMoveStart = useCallback(
    (itemName: string) => {
      // Un déplacement chasse l'autre : on ne laisse jamais deux avis empilés.
      dismissMovingToast(true);
      movingToastAtRef.current = Date.now();
      movingToastRef.current = notify({
        type: 'info',
        message: t('dragDrop.moving', { name: itemName }),
        duration: 0,
      });
    },
    [dismissMovingToast, notify, t]
  );
  // Ouverture automatique du dossier survolé pendant un drag (spring-load)
  const handleSpringOpen = useCallback(
    (targetFolderId: string) => navigate(`/folder/${targetFolderId}`),
    [navigate]
  );

  const {
    draggedItem,
    dropTarget,
    springTarget,
    pendingMove,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop: handleDropItem,
  } = useDragAndDrop(
    // L'accueil affiche la racine : pas de dossier courant, d'où la sentinelle.
    ROOT_FOLDER_ID,
    handleDnDSuccess,
    handleDnDError,
    handleSpringOpen,
    handleMoveStart
  );

  // ===== États des modales =====
  const [createModalOpen, setCreateModalOpen] = useState<boolean>(false);
  const [renameModalOpen, setRenameModalOpen] = useState<boolean>(false);
  const [folderToRename, setFolderToRename] = useState<Folder | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState<boolean>(false);
  const [folderToDelete, setFolderToDelete] = useState<Folder | null>(null);
  // « Personnaliser » ouvre la MÊME boîte que la vue dossier (couleur ET emoji).
  const [folderStyleTarget, setFolderStyleTarget] = useState<Folder | null>(null);
  const [reminderModalOpen, setReminderModalOpen] = useState<boolean>(false);
  const [folderForReminder, setFolderForReminder] = useState<Folder | null>(null);
  const [folderDeleteModalOpen, setFolderDeleteModalOpen] = useState<boolean>(false);
  const [folderDeletionInfo, setFolderDeletionInfo] = useState<FolderDeletionInfo | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  /** Le panneau de détails, ouvert par « Voir les détails ». */
  const [detailsPanelItem, setDetailsPanelItem] = useState<Item | null>(null);
  /** Le dossier racine dont on choisit la destination, et l'attente en vol. */
  const [folderToMove, setFolderToMove] = useState<Folder | null>(null);
  const [moveBusy, setMoveBusy] = useState<boolean>(false);
  /** Le dossier dont on règle la protection par mot de passe. */
  const [passwordModalFolder, setPasswordModalFolder] = useState<Folder | null>(null);
  /**
   * La valeur n'est jamais lue : ce compteur n'existe que pour provoquer un
   * rendu après un changement de protection. `isProtected` lit le stockage
   * local, qui n'est pas réactif — sans ce coup de pouce, le cadenas des cartes
   * resterait celui d'avant.
   */
  const [passwordVersion, bumpPasswordVersion] = useState(0);
  /** Chemins OS choisis pour « Protéger sur place » (menu de fond). */
  const [protectDialogPaths, setProtectDialogPaths] = useState<string[] | null>(null);

  // Les dossiers RACINE : le seul dérivé dont la page a encore besoin (les blocs
  // lisent le leur). Il sert au menu contextuel, qui relit le dossier visé.
  const rootFolders = useMemo(
    () => folders.filter((folder) => !folder.parentId || folder.parentId === null),
    [folders]
  );
  const rootFoldersRef = useRef(rootFolders);
  useEffect(() => {
    rootFoldersRef.current = rootFolders;
  }, [rootFolders]);

  const handleCreateFolder = useCallback(() => {
    setCreateModalOpen(true);
  }, []);

  const handleConfirmCreate = useCallback(
    async (folderName: string, parentId: string | null) => {
      try {
        await addFolder({ name: folderName, parentId });
        success(t('home.createSuccess', 'Dossier créé avec succès'));
        // Créé ailleurs qu'à la racine : l'accueil ne le montre pas, on emmène
        // l'utilisateur là où son dossier vient d'apparaître.
        if (parentId) {
          navigate(`/folder/${parentId}`);
        }
      } catch (err) {
        error(t('home.createError', 'Échec de la création du dossier'));
      }
    },
    [addFolder, success, error, t, navigate]
  );

  const handleOpenFolder = useCallback(
    (folderId: string) => {
      const folder = rootFoldersRef.current.find((f) => f.id === folderId);
      if (folder) {
        dispatch(addRecentFile({ item: folder as any, path: `/folder/${folderId}` }));
      }
      navigate(`/folder/${folderId}`);
    },
    [navigate, dispatch]
  );

  const handleRenameFolder = useCallback((folder: Folder) => {
    setFolderToRename(folder);
    setRenameModalOpen(true);
  }, []);

  const handleConfirmRename = useCallback(
    async (newName: string) => {
      if (folderToRename && newName !== folderToRename.name) {
        try {
          await editFolder(folderToRename.id, { name: newName });
          success(t('home.renameSuccess', 'Dossier renommé avec succès'));
        } catch (err) {
          error(t('home.renameError', 'Échec du renommage'));
        }
      }
    },
    [folderToRename, editFolder, success, error, t]
  );

  const handleConfirmStyle = useCallback(
    async ({ color, emoji }: { color: string; emoji?: string }) => {
      if (!folderStyleTarget) return;
      try {
        await editFolder(folderStyleTarget.id, { color, emoji });
        success(t('home.customizeSuccess', 'Couleur appliquée avec succès'));
      } catch (err) {
        error(t('home.customizeError', 'Échec de la personnalisation'));
      }
    },
    [folderStyleTarget, editFolder, success, error, t]
  );

  /**
   * Ajouter un dossier racine aux favoris — le même geste que dans la vue
   * dossier, à ceci près que le chemin de retour est la racine.
   */
  const handleAddToFavorites = useCallback(
    (folder: Folder) => {
      dispatch(addFavorite({ item: folder as Item, path: '/' }));
      success(t('home.favoriteAdded', '« {{name}} » ajouté aux favoris', { name: folder.name }));
    },
    [dispatch, success, t]
  );

  /**
   * Déplacer un dossier RACINE vers un autre dossier.
   *
   * La racine n'est pas un dossier stocké : elle passe par la sentinelle
   * `ROOT_FOLDER_ID`, que `moveItem` sait traiter côté main. La racine n'est PAS
   * proposée comme destination (un dossier racine y est déjà), et la COPIE n'est
   * pas offerte ici — `copyItem` n'a pas l'équivalent du cas particulier racine
   * de `moveItem`.
   */
  const handleConfirmMove = useCallback(
    async (targetFolderId: string) => {
      if (!folderToMove || moveBusy) return;
      setMoveBusy(true);
      try {
        await moveFolder(folderToMove.id, ROOT_FOLDER_ID, targetFolderId);
        // Le parent change : l'arbre entier doit être relu (accueil, fil
        // d'Ariane, barre latérale) — même relecture que le glisser-déposer.
        await dispatch(fetchFolders());
        success(t('home.moveSuccess', 'Dossier déplacé avec succès'));
        setFolderToMove(null);
      } catch (err) {
        // Échec : la boîte reste ouverte, prête pour une autre destination.
        const message = err instanceof Error ? err.message : '';
        error(
          message
            ? t('home.moveErrorDetail', 'Échec du déplacement : {{error}}', { error: message })
            : t('home.moveError', 'Échec du déplacement')
        );
      } finally {
        setMoveBusy(false);
      }
    },
    [folderToMove, moveBusy, dispatch, success, error, t]
  );

  /** Sélecteur OS natif → dialogue « Protéger sur place » (fichiers ou dossier). */
  const pickAndProtectInPlace = useCallback(async (directory: boolean) => {
    const renderer = window.electron?.ipcRenderer;
    if (!renderer) return;
    try {
      const result = (await renderer.invoke('showOpenDialog', {
        properties: directory ? ['openDirectory'] : ['openFile', 'multiSelections'],
      })) as { canceled?: boolean; filePaths?: string[] } | undefined;
      const paths = result && !result.canceled ? (result.filePaths ?? []) : [];
      if (paths.length > 0) setProtectDialogPaths(paths);
    } catch {
      // Dialogue indisponible — rien à casser.
    }
  }, []);

  const calculateFolderInfo = useCallback((folder: Folder): { count: number; size: number } => {
    if (!folder.items || folder.items.length === 0) {
      return { count: 0, size: 0 };
    }

    let totalCount = 0;
    let totalSize = 0;

    folder.items.forEach((itemOrId) => {
      if (typeof itemOrId !== 'object' || itemOrId === null) return;
      const itemObj = itemOrId as Item;

      totalCount++;

      if ('size' in itemObj && typeof (itemObj as any).size === 'number') {
        totalSize += (itemObj as any).size;
      }

      if ('items' in itemObj && Array.isArray((itemObj as any).items)) {
        const subResult = calculateFolderInfo(itemObj as Folder);
        totalCount += subResult.count;
        totalSize += subResult.size;
      }
    });

    return { count: totalCount, size: totalSize };
  }, []);

  const handleDeleteFolder = useCallback(
    (folder: Folder) => {
      const directItems: Item[] = (folder.items || [])
        .map((itemOrId) => (typeof itemOrId === 'object' ? (itemOrId as Item) : null))
        .filter((item): item is Item => item !== null);

      if (directItems.length > 0) {
        const { count: totalItemCount, size: totalSize } = calculateFolderInfo(folder);

        const deletionInfo: FolderDeletionInfo = {
          folderName: folder.name,
          items: directItems,
          totalItemCount,
          totalSize,
          noteCount: 0,
        };

        setFolderDeletionInfo(deletionInfo);
        setFolderToDelete(folder);
        setFolderDeleteModalOpen(true);
      } else {
        setFolderToDelete(folder);
        setDeleteModalOpen(true);
      }
    },
    [calculateFolderInfo]
  );

  const handleConfirmDelete = useCallback(async () => {
    if (folderToDelete) {
      try {
        await removeFolder(folderToDelete.id);
        success(t('home.deleteSuccess', 'Dossier supprimé avec succès'));
      } catch (err) {
        error(t('home.deleteError', 'Échec de la suppression'));
      }
    }
  }, [folderToDelete, removeFolder, success, error, t]);

  const handleConfirmFolderDelete = useCallback(async () => {
    if (!folderToDelete) return;

    try {
      setIsDeleting(true);
      await removeFolder(folderToDelete.id);
      success(t('home.deleteSuccess', 'Dossier supprimé avec succès'));
      setFolderDeleteModalOpen(false);
      setFolderDeletionInfo(null);
      setFolderToDelete(null);
    } catch (err) {
      error(t('home.deleteError', 'Échec de la suppression'));
    } finally {
      setIsDeleting(false);
    }
  }, [folderToDelete, removeFolder, success, error, t]);

  const handleAddReminder = useCallback((folder: Folder) => {
    setFolderForReminder(folder);
    setReminderModalOpen(true);
  }, []);

  const handleConfirmReminder = useCallback(
    async (reminderData: ReminderData) => {
      if (folderForReminder) {
        try {
          const existingReminders: Reminder[] = (folderForReminder as any).reminders || [];

          // Même fabrique que la vue dossier — les deux écrans jetaient la
          // récurrence et la priorité, chacun de son côté.
          const newReminder: Reminder = buildReminder(
            reminderData,
            {
              itemId: folderForReminder.id,
              itemName: folderForReminder.name,
              itemType: 'folder',
            },
            Date.now().toString()
          );

          const newReminders = [...existingReminders, newReminder];

          await editFolder(folderForReminder.id, { reminders: newReminders } as any);
          success(t('home.reminderSuccess', 'Rappel ajouté avec succès'));
        } catch (err) {
          error(t('home.reminderError', "Échec de l'ajout du rappel"));
        }
      }
    },
    [folderForReminder, editFolder, success, error, t]
  );

  /**
   * Le menu d'un dossier racine — construit par le builder PARTAGÉ, donc dans le
   * même ordre et avec les mêmes libellés que dans la vue dossier.
   *
   * Ce que l'accueil ne propose pas, et pourquoi :
   *  — `copy` : `copyItem` (côté main) n'a pas le cas particulier racine que
   *    `moveItem` possède ; il lirait « root » comme un vrai dossier et en
   *    fabriquerait un faux sur le disque.
   *  — `download`, `showInExplorer`, `versions`, `share`, `sync` : ils portent
   *    sur des FICHIERS, et la racine n'en héberge aucun.
   *
   * `canAddToVault` voyage par une ref : sans elle, l'obtention d'un coffre
   * changerait l'identité de ce rappel, donc celle du contexte d'actions, donc
   * ferait re-rendre TOUS les blocs.
   */
  const canAddToVaultRef = useRef(canAddToVault);
  useEffect(() => {
    canAddToVaultRef.current = canAddToVault;
  }, [canAddToVault]);

  // Lue PENDANT le rendu par `renderItem` : affectation en phase de rendu, un
  // effet arriverait un tour trop tard apres un changement de langue.
  const tRef = useRef(t);
  tRef.current = t;

  const handleFolderContextMenu = useCallback(
    (e: MouseEvent<HTMLElement>, folder: Folder) => {
      openContextMenu(
        e as any,
        buildItemContextMenu(
          folder as Item,
          {
            open: true,
            details: true,
            rename: true,
            style: true,
            move: true,
            favorite: true,
            reminder: true,
            // Faire entrer CE dossier dans un coffre partagé — l'entrée
            // disparaît quand aucun coffre ne peut le recevoir.
            addToVault: canAddToVaultRef.current,
            protect: true,
            delete: true,
          },
          {
            onOpen: () => handleOpenFolder(folder.id),
            onDetails: () => setDetailsPanelItem(folder as Item),
            onRename: () => handleRenameFolder(folder),
            onStyle: () => setFolderStyleTarget(folder),
            onMove: () => setFolderToMove(folder),
            onFavorite: () => handleAddToFavorites(folder),
            onReminder: () => handleAddReminder(folder),
            onAddToVault: () =>
              setAddToVaultSource({ kind: 'folder', id: folder.id, name: folder.name }),
            onProtect: () => setPasswordModalFolder(folder),
            onDelete: () => handleDeleteFolder(folder),
          },
          tRef.current
        )
      );
    },
    [
      openContextMenu,
      handleOpenFolder,
      handleRenameFolder,
      handleAddToFavorites,
      handleAddReminder,
      handleDeleteFolder,
    ]
  );

  // ==================== La mise en page ====================

  const layoutStatus = useSelector((state: RootState) => state.layout.status);
  const layoutViews = useSelector((state: RootState) => state.layout.document.views);
  const editSession = useSelector((state: RootState) => state.layout.edit);
  const installedTemplates = useSelector((state: RootState) => state.layout.document.templates);

  /**
   * QUEL ACCUEIL EST AFFICHÉ.
   *
   * Il y en a plusieurs depuis que « appliquer un modèle » crée une mise en
   * page nommée au lieu d'écraser celle qu'on avait (voir `homeViews.ts`).
   * `homeViewId` remplace donc la constante `HOME_VIEW_ID` PARTOUT dans cet
   * écran : lecture, édition, écriture, instanciation. En laisser une seule
   * derrière ferait éditer une mise en page tout en en affichant une autre.
   */
  const [homeViewId, setHomeViewId] = useActiveHomeView(layoutViews, layoutStatus === 'ready');
  const homeView = layoutViews[homeViewId];

  // ── Modèles de mise en page partageables ────────────────────────────────
  const [exportOpen, setExportOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [importState, setImportSource] = useState<{ open: boolean; source: ImportSource | null }>({
    open: false,
    source: null,
  });

  /**
   * UN `.filarrlayout` DOUBLE-CLIQUÉ OUVRE L'APERÇU, jamais l'application.
   *
   * Deux chemins, une seule lecture : le processus principal garde le chemin en
   * attente et signale son arrivée ; on le réclame ici. La réclamation se fait
   * AUSSI au montage, parce qu'un démarrage à froid livre le fichier bien avant
   * que cet écran existe — le signal serait tombé dans le vide.
   */
  useEffect(() => {
    let cancelled = false;
    const pull = async (): Promise<void> => {
      const pending = await takePendingLayoutOpen();
      if (cancelled || !pending) return;
      setImportSource({
        open: true,
        source: { kind: 'raw', content: pending.content, fileName: pending.fileName },
      });
    };
    void pull();
    const off = onLayoutFileOpened(() => void pull());
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  /**
   * Le mode personnalisation vit dans le STORE, plus dans un `useState` local.
   *
   * Ce n'est pas de la centralisation gratuite : le brouillon, la pile
   * d'annulation et la sélection y vivent ensemble, et deux sources de vérité
   * (« je suis en édition » ici, « voici le brouillon » là-bas) finiraient par
   * diverger le jour où l'une des deux est remise à zéro — au changement de
   * profil, par exemple, où `loadLayoutFromDisk` efface la session mais ne
   * pourrait pas éteindre un booléen local.
   */
  const editing = editSession !== null && editSession.viewId === homeViewId;

  /**
   * Le repli. Il n'est PAS scellé : le contrat de `layout:load` dit qu'un
   * document non amorcé est provisoire, et écrire par-dessus écraserait la
   * disposition que le nuage est peut-être en train de livrer.
   */
  const fallbackView = useMemo(() => essentialHomeView(), []);
  const committedSlots: LayoutSlot[] = useMemo(() => {
    const own = homeView?.slots;
    // « La vue dit-elle quelque chose ? » se mesure sur les BLOCS, pas sur le
    // tableau brut : depuis que la largeur de page voyage dans un emplacement
    // réservé, une vue peut être longue de un et ne décrire aucun bloc. Compter
    // le tableau entier ferait rendre une page blanche à qui a réglé sa largeur
    // puis retiré tous ses blocs, là où il obtenait « Essentiel » jusqu'ici.
    if (own && homeGridSlots(own).length > 0) return own;
    // Et le repli GARDE la largeur déjà réglée : elle n'a pas disparu du
    // document, il n'y a aucune raison qu'elle disparaisse de l'écran.
    return withHomeConfig(fallbackView.slots, readHomeConfigFromSlots(own));
  }, [homeView, fallbackView]);

  /**
   * Ce que la grille affiche. En édition, c'est le BROUILLON : pendant toute la
   * session, rien ne descend dans le document ni sur le disque. Une écriture par
   * geste, c'est vingt versions du même rangement à synchroniser, donc vingt
   * occasions qu'un autre appareil arbitre au milieu.
   */
  const slots: LayoutSlot[] = editing && editSession ? editSession.slots : committedSlots;

  /**
   * LES DEUX LECTURES DE `slots`, ET ELLES NE SE MÉLANGENT PAS.
   *
   *   · `homeConfig` — les réglages de la PAGE, portés par l'emplacement
   *     réservé (voir `homeConfig.ts`). Ils voyagent donc avec la mise en page :
   *     un accueil mis en pleine largeur sur le fixe l'est aussi sur le portable.
   *   · `gridSlots` — ce que la grille a le droit de voir. L'emplacement réservé
   *     n'y est JAMAIS : il n'est pas un bloc, il n'a ni format ni contenu, et le
   *     laisser passer ouvrirait une case morte au milieu de l'accueil.
   *
   * L'ÉCRITURE, elle, part toujours de `slots` entier (`slotsRef`) : c'est ce
   * qui fait que le réglage survit à un déplacement, à un ajout de bloc et à
   * l'application d'un modèle.
   */
  const homeConfig = useMemo(() => readHomeConfigFromSlots(slots), [slots]);
  const gridSlots = useMemo(() => homeGridSlots(slots), [slots]);

  // Ranger est refusé tant que le document n'est pas arrêté : sceller un repli
  // par-dessus une mise en page qui descend du nuage la perdrait.
  const canEditLayout = layoutStatus === 'ready';

  /**
   * LA LARGEUR DÉCIDE, ET ELLE SE MESURE SUR LA COLONNE, PAS SUR LA FENÊTRE.
   *
   * Sous 840 px, la personnalisation n'est pas proposée du tout. Une édition
   * mobile bâclée n'abîmerait pas qu'elle-même : la disposition est UNE, celle
   * des douze colonnes, et la ranger depuis un écran étroit détruirait la mise en
   * page de bureau que le même compte ne pourrait plus reconstruire de là.
   */
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [pageWidth, setPageWidth] = useState(0);
  useEffect(() => {
    const node = pageRef.current;
    if (!node) return;
    // Première mesure immédiate : le `ResizeObserver` ne se déclenche qu'au
    // prochain cycle, et une porte qui s'ouvre un tour plus tard clignote.
    setPageWidth(node.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setPageWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const wideEnough = breakpointForWidth(pageWidth) !== 'compact';

  /**
   * Les blocs qui n'ont rien à dire aujourd'hui. Une seule lecture du store pour
   * tous, rendue sous forme de CHAÎNE : `useSelector` compare par identité, et un
   * tableau neuf à chaque action re-rendrait l'accueil en permanence.
   */
  const emptyIdsKey = useSelector((state: RootState) =>
    gridSlots
      .filter((slot) => {
        const definition = resolveWidget(slot.type);
        // UN TYPE INCONNU N'EST PLUS MASQUÉ. Il l'était tant qu'un tel bloc ne
        // pouvait venir que d'un aller-retour entre deux versions ; depuis
        // qu'on importe des modèles, il vient d'un fichier que l'utilisateur a
        // ACCEPTÉ en connaissance de cause (le récapitulatif d'import compte
        // « en attente »). Le masquer ferait mentir ce compte et ouvrirait un
        // trou dans une disposition qu'il vient de choisir : il occupe donc son
        // rectangle en tuile inerte, et se réhydratera tout seul.
        if (!definition) return false;
        return definition.isEmpty?.(state) === true;
      })
      .map((slot) => slot.id)
      .join('|')
  );

  const visiblePlacements = useMemo<GridPlacement[]>(() => {
    const all = toPlacements(gridSlots);
    // En édition, TOUT est montré : un bloc vide qu'on ne voit pas est un bloc
    // qu'on ne peut ni déplacer ni retirer.
    if (editing) return all;
    // Et de même sur une disposition qu'on vient de poser : un modèle de huit
    // blocs qui en montre deux se lit comme un modèle cassé, pas comme un
    // accueil qui attend du contenu. Voir `freshView`.
    if (isFreshView(homeViewId)) return all;
    const hidden = new Set(emptyIdsKey ? emptyIdsKey.split('|') : []);
    return all.filter((p) => !hidden.has(p.id));
  }, [gridSlots, editing, emptyIdsKey]);

  const allowedSizes = useMemo<GridAllowedSizes>(() => {
    const map: Record<string, readonly GridSizeId[]> = {};
    for (const slot of gridSlots) {
      const def = resolveWidget(slot.type);
      if (def) map[slot.id] = def.sizeShortcuts;
    }
    return map;
  }, [gridSlots]);

  /**
   * Les BORNES de la poignée, bloc par bloc.
   *
   * À ne pas confondre avec `allowedSizes`, juste au-dessus : celui-là ne dit que
   * ce qu'on propose EN UN CLIC, celui-ci dit ce que le geste a le droit de
   * fabriquer. Entre les deux bornes, n'importe quelle géométrie entière est
   * recevable — c'est la grille de l'utilisateur.
   */
  const constraints = useMemo<GridConstraintMap>(() => {
    const map: Record<string, GridSizeConstraints> = {};
    for (const slot of gridSlots) {
      const def = resolveWidget(slot.type);
      if (def?.constraints) map[slot.id] = def.constraints;
    }
    return map;
  }, [gridSlots]);

  // ── Écriture ────────────────────────────────────────────────────────────
  // Le document scellé est la source de vérité : on ne garde aucune copie locale
  // de la disposition. Le geste écrit dans le store, le store re-rend la grille.

  /**
   * Les emplacements courants, lisibles depuis un rappel stable.
   *
   * L'affectation se fait PENDANT le rendu, et pas dans un effet : `renderItem`
   * est appele par la grille au rendu, donc un effet arriverait trop tard et le
   * rappel dessinerait le contenu du rendu precedent.
   */
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  /**
   * Signature du CONTENU des blocs — type, reglages, attaches — a l'exclusion
   * totale de la geometrie.
   *
   * C'est elle qui commande l'identite de `renderItem`. Pendant un geste, rien
   * n'est commite : la signature ne bouge pas, le rappel garde son identite, et
   * `GridItem` ne re-rend que les cases qui changent de place. Au commit d'un
   * simple deplacement, elle ne bouge toujours pas — seule une modification
   * reelle (un reglage change, un bloc retire) la fait changer, et alors tous
   * les blocs se redessinent une fois, ce qui est exactement ce qu'on veut.
   */
  const slotsContentKey = useMemo(
    () =>
      gridSlots
        .map(
          (slot) =>
            `${slot.id}~${slot.type}~${JSON.stringify(slot.options ?? null)}~${JSON.stringify(
              slot.binding ?? null
            )}`
        )
        .join(''),
    // `gridSlots` et non `slots` : la largeur de la page n'est pas le contenu
    // d'un bloc, et la faire entrer ici redessinerait les douze blocs a chaque
    // bascule de largeur, alors que la grille se recompose deja toute seule.
    [gridSlots]
  );

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void dispatch(saveLayoutToDisk());
    }, LAYOUT_SAVE_DEBOUNCE_MS);
  }, [dispatch]);

  // Quitter l'accueil ne doit pas perdre un rangement qui attendait son délai.
  useEffect(
    () => () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        void dispatch(saveLayoutToDisk());
      }
    },
    [dispatch]
  );

  /**
   * L'UNIQUE porte d'ecriture de la disposition.
   *
   * Le garde-fou n'est pas redondant avec le mode edition : le menu d'un bloc
   * est atteignable au SURVOL, hors edition, et il sait changer un format, un
   * reglage ou retirer un bloc. Ces gestes doivent obeir a la meme regle que les
   * autres — tant que le document n'est pas arrete, `loadLayoutFromDisk` le
   * remplacera, et ce qu'on ecrirait ici disparaitrait sans un mot.
   */
  const canEditLayoutRef = useRef(canEditLayout);
  canEditLayoutRef.current = canEditLayout;
  // La vue courante, lisible depuis les rappels STABLES (`commitSlots`,
  // `startEditing`). Les mettre à jour à chaque bascule d'accueil casserait la
  // mémoïsation de la grille pendant un geste — voir le contrat de `renderItem`.
  const homeViewIdRef = useRef(homeViewId);
  homeViewIdRef.current = homeViewId;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const wideEnoughRef = useRef(wideEnough);
  wideEnoughRef.current = wideEnough;

  const commitSlots = useCallback(
    (next: LayoutSlot[]) => {
      if (!canEditLayoutRef.current) return;
      // EN ÉDITION, TOUT VA DANS LE BROUILLON. C'est le seul chemin d'écriture
      // du mode, et c'est ce qui garantit à la fois le commit unique à la sortie
      // et le fait que le geste soit annulable : `pushLayoutDraft` est aussi ce
      // qui empile l'annulation. Un raccourci qui écrirait directement ici
      // produirait un geste qu'on ne peut pas défaire, sans que rien ne le dise.
      if (editingRef.current) {
        dispatch(pushLayoutDraft({ slots: next }));
        return;
      }
      dispatch(setViewSlots({ viewId: homeViewIdRef.current, slots: next }));
      scheduleSave();
    },
    [dispatch, scheduleSave]
  );

  /** Un geste de la grille : SEULE la géométrie remonte. */
  const handleLayoutChange = useCallback(
    (next: GridPlacement[]) => {
      commitSlots(mergeGeometry(slotsRef.current, next));
    },
    [commitSlots]
  );

  /**
   * Une taille posée EXACTEMENT, en cases. C'est le chemin de l'inspecteur, où
   * la largeur et la hauteur se tapent au clavier : aucun format nommé n'est
   * consulté, aucune valeur n'est aimantée.
   */
  const handleSetSlotGeometry = useCallback(
    (slotId: string, w: number, h: number) => {
      commitSlots(slotsRef.current.map((slot) => (slot.id === slotId ? { ...slot, w, h } : slot)));
    },
    [commitSlots]
  );

  /** Un format NOMMÉ : le menu du bloc et la prise de format passent par ici. */
  const handleSetSlotSize = useCallback(
    (slotId: string, size: GridSizeId) => {
      const spec = gridSize(size);
      handleSetSlotGeometry(slotId, spec.w, spec.h);
    },
    [handleSetSlotGeometry]
  );

  const handleRemoveSlot = useCallback(
    (slotId: string) => {
      commitSlots(slotsRef.current.filter((slot) => slot.id !== slotId));
    },
    [commitSlots]
  );

  const handleSetSlotOption = useCallback(
    (slotId: string, key: string, value: unknown) => {
      commitSlots(
        slotsRef.current.map((slot) =>
          slot.id === slotId
            ? { ...slot, options: { ...(slot.options ?? {}), [key]: value } }
            : slot
        )
      );
    },
    [commitSlots]
  );

  /**
   * LA LARGEUR DE LA PAGE. Un geste d'édition comme les autres, et c'est tout
   * l'intérêt de la faire passer par `commitSlots` :
   *
   *   · le changement est VISIBLE IMMÉDIATEMENT — le brouillon est ce que la
   *     page rend, donc la grille s'élargit sous les yeux ;
   *   · il entre dans la PILE D'ANNULATION (`pushLayoutDraft`), donc Ctrl+Z le
   *     défait comme un déplacement de bloc ;
   *   · il est scellé par le COMMIT UNIQUE de la sortie, pas à l'instant du
   *     clic — essayer les deux largeurs puis refermer ne pousse qu'une seule
   *     version aux autres appareils.
   */
  const handleSetHomeWidth = useCallback(
    (width: HomeWidth) => {
      commitSlots(withHomeConfig(slotsRef.current, { width }));
    },
    [commitSlots]
  );

  // ==================== Le mode édition ====================

  const editSessionRef = useRef(editSession);
  editSessionRef.current = editSession;

  /** Entrer. Les trois portes passent toutes par ici. */
  const startEditing = useCallback(() => {
    if (!canEditLayoutRef.current || !wideEnoughRef.current) return;
    if (editSessionRef.current) return;
    dispatch(beginLayoutEdit({ viewId: homeViewIdRef.current, slots: slotsRef.current }));
  }, [dispatch]);

  /** Le minuteur qui périme la trace du dernier commit avec le toast. */
  const commitTraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Sortir. UN SEUL COMMIT pour toute la session, et un toast qui laisse huit
   * secondes pour se rétracter.
   *
   * Le commit est sauté quand rien n'a changé : ouvrir le mode, regarder, et
   * refermer ne doit pas redater la vue — une horloge neuve pousse un cycle de
   * synchronisation à tous les appareils pour décrire une disposition
   * rigoureusement identique, avec le conflit potentiel qui va avec.
   */
  // La personne est passée en édition : elle a vu la composition entière, le
  // marqueur « fraîchement posée » a fait son travail (voir `freshView`).
  useEffect(() => {
    if (editing) clearFreshView();
  }, [editing]);

  const finishEditing = useCallback(() => {
    const session = editSessionRef.current;
    if (!session) return;

    const changed = JSON.stringify(session.slots) !== JSON.stringify(session.baseline);
    if (!changed) {
      dispatch(cancelLayoutEdit());
      return;
    }

    dispatch(commitLayoutEdit());
    void dispatch(saveLayoutToDisk());

    // L'identifiant du toast est capturé par un objet et non par la variable
    // elle-même : le rappel est construit AVANT que `notify` ne rende sa valeur.
    const handle: { id: string | null } = { id: null };
    handle.id = notify({
      type: 'success',
      message: t('home.customize.saved', 'Accueil enregistré'),
      duration: SAVED_TOAST_MS,
      action: {
        label: t('home.customize.undoSave', 'Annuler'),
        onClick: () => {
          dispatch(revertLayoutCommit());
          void dispatch(saveLayoutToDisk());
          if (handle.id) dismiss(handle.id);
        },
      },
    });

    // La trace ne survit pas au toast : un « Annuler » qui resterait armé
    // ressusciterait, dix minutes plus tard, une disposition que l'utilisateur a
    // depuis retravaillée — voire une que la fusion a remplacée.
    if (commitTraceTimerRef.current) clearTimeout(commitTraceTimerRef.current);
    commitTraceTimerRef.current = setTimeout(() => {
      commitTraceTimerRef.current = null;
      dispatch(clearLayoutCommit());
    }, SAVED_TOAST_MS);
  }, [dispatch, notify, dismiss, t]);

  /**
   * Les deux fermetures forcées. Le document qui redevient provisoire ABANDONNE
   * (il n'y a plus de disposition sûre à écrire par-dessus) ; la fenêtre qui
   * rétrécit, elle, COMMITE — le travail est fait, ce n'est pas parce qu'on a
   * repoussé un bord de fenêtre qu'il faut le jeter.
   */
  useEffect(() => {
    if (!editing) return;
    if (!canEditLayout) {
      dispatch(cancelLayoutEdit());
      return;
    }
    if (!wideEnough) finishEditing();
  }, [editing, canEditLayout, wideEnough, dispatch, finishEditing]);

  // Quitter l'accueil en pleine édition ne doit pas perdre le rangement : c'est
  // la même sortie que « Terminé », déclenchée par le démontage.
  const finishEditingRef = useRef(finishEditing);
  finishEditingRef.current = finishEditing;
  useEffect(
    () => () => {
      if (commitTraceTimerRef.current) {
        clearTimeout(commitTraceTimerRef.current);
        commitTraceTimerRef.current = null;
      }
      if (editSessionRef.current) finishEditingRef.current();
    },
    []
  );

  // ── Annuler / rétablir ──────────────────────────────────────────────────

  const canUndo = (editSession?.past.length ?? 0) > 0;
  const canRedo = (editSession?.future.length ?? 0) > 0;
  const handleUndo = useCallback(() => dispatch(undoLayoutDraft()), [dispatch]);
  const handleRedo = useCallback(() => dispatch(redoLayoutDraft()), [dispatch]);

  /**
   * Ctrl+Z / Ctrl+Maj+Z, et seulement en édition. Hors du mode, ces touches
   * appartiennent à l'éditeur de notes et à qui les demandera ensuite : les
   * capter en permanence ferait de l'accueil un voleur de raccourcis.
   */
  useEffect(() => {
    if (!editing) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.key.toLowerCase() !== 'z') return;
      // Une saisie en cours garde ses raccourcis : le panneau n'a pas de champ
      // aujourd'hui, mais il en aura, et le jour venu ce garde-fou existe déjà.
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      event.preventDefault();
      dispatch(event.shiftKey ? redoLayoutDraft() : undoLayoutDraft());
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing, dispatch]);

  // ── Sélection, panneau, clignotement ────────────────────────────────────

  const selectedSlotId = editSession?.selectedSlotId ?? null;
  const panelOpen = editSession?.panelOpen ?? false;
  const panelMode = editSession?.panelMode ?? 'add';
  const flashSlotId = editSession?.flashSlotId ?? null;

  const selectedSlot = useMemo(
    () => (selectedSlotId ? (slots.find((slot) => slot.id === selectedSlotId) ?? null) : null),
    [selectedSlotId, slots]
  );

  useEffect(() => {
    if (!flashSlotId) return;
    const timer = setTimeout(() => dispatch(flashLayoutSlot(null)), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashSlotId, dispatch]);

  // ── Ajouter un bloc ─────────────────────────────────────────────────────

  /**
   * Pose un widget du catalogue. Sans `at`, il tombe au premier emplacement
   * LIBRE (pas en bas de page : un accueil qui grandit par le bas oblige à faire
   * défiler pour voir ce qu'on vient d'ajouter) et clignote pour qu'on le
   * retrouve. Avec `at`, il tombe là où on l'a lâché.
   */
  const insertWidget = useCallback(
    (definition: WidgetDefinition, at?: { x: number; y: number }) => {
      const base = slotsRef.current;
      const spec = gridSize(definition.defaultSize);
      const id = newSlotId();
      // Le solveur ne voit QUE des blocs. Lui donner l'emplacement réservé lui
      // ferait chercher une place libre autour d'un rectangle de zéro case.
      const placements = toPlacements(homeGridSlots(base));
      const geometry = at
        ? moveItem(
            [...placements, { id, x: at.x, y: at.y, w: spec.w, h: spec.h }],
            id,
            at.x,
            at.y,
            GRID_COLUMNS
          )
        : insertItem(placements, { id, w: spec.w, h: spec.h }, GRID_COLUMNS);
      const created: LayoutSlot = {
        id,
        role: definition.defaultRole,
        type: definition.type,
        x: 0,
        y: 0,
        w: spec.w,
        h: spec.h,
      };
      dispatch(pushLayoutDraft({ slots: mergeGeometry([...base, created], geometry) }));
      dispatch(flashLayoutSlot(id));
    },
    [dispatch]
  );

  // ── Glisser un bloc de la palette dans la grille ────────────────────────
  //
  // Le moteur de grille ne connaît pas les dépôts venus de l'extérieur, et il
  // n'a pas à les connaître : ce qui suit est de la géométrie pure, faite au
  // niveau de la page, avec les mêmes constantes que la feuille de style.

  const gridBoxRef = useRef<HTMLDivElement | null>(null);
  const dragWidgetRef = useRef<WidgetDefinition | null>(null);
  const [dropCell, setDropCell] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null
  );

  /**
   * LA HAUTEUR DE RANGÉE SUIT LA LARGEUR DE CASE — et c'est la contrepartie du
   * mode « Pleine largeur ».
   *
   * Douze colonnes sur 2 560 px donnent une case de 193 px : une « Tuile » (3×1)
   * y devient un bandeau de 612 × 88, mesuré, contre 322 × 88 au plafond centré.
   * Le remède n'est pas de re-brider la page — ce serait remettre exactement le
   * vide qu'on vient d'enlever —, c'est de borner la PROPORTION de la case
   * (`homeRowHeight`, plafonnée à 1,5×).
   *
   * Métrique DÉRIVÉE, jamais stockée, comme le nombre de colonnes : rien de ce
   * qui se synchronise ni de ce qui s'exporte n'en dépend. Et elle ne bouge pas
   * d'un pixel en mode centré, où la case ne dépasse jamais sa référence.
   *
   * La mesure se fait sur la BOÎTE DE LA GRILLE, pas sur la page : le panneau
   * d'édition lui prend 336 px quand il s'ouvre, et c'est bien la grille, pas la
   * fenêtre, qui décide de ce que devient une case.
   */
  const [gridWidth, setGridWidth] = useState(0);
  useEffect(() => {
    const node = gridBoxRef.current;
    if (!node) return;
    setGridWidth(node.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      // Largeur SEULE : la hauteur de la grille change quand la rangée change,
      // et réagir à ça ferait tourner l'observateur en rond.
      if (entry)
        setGridWidth((previous) =>
          previous === entry.contentRect.width ? previous : entry.contentRect.width
        );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // En édition, la grille est FORCÉE à douze colonnes (voir `columnsOverride`
  // plus bas) : la hauteur de rangée doit obéir à la même règle, sans quoi le
  // témoin de dépôt viserait une rangée qui n'existe pas.
  const rowHeight = homeRowHeight(gridWidth, editing ? GRID_COLUMNS : columnsForWidth(gridWidth));
  const rowHeightRef = useRef(rowHeight);
  rowHeightRef.current = rowHeight;

  const handleWidgetDragStart = useCallback((definition: WidgetDefinition) => {
    dragWidgetRef.current = definition;
  }, []);

  const handleWidgetDragEnd = useCallback(() => {
    dragWidgetRef.current = null;
    setDropCell(null);
  }, []);

  /** La case sous le curseur, coin supérieur gauche du bloc. */
  const cellAt = useCallback((clientX: number, clientY: number, w: number, h: number) => {
    const node = gridBoxRef.current;
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    const cellWidth = (rect.width - GRID_GUTTER * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
    if (cellWidth <= 0) return null;
    const column = Math.floor((clientX - rect.left) / (cellWidth + GRID_GUTTER));
    // Par ref, pour que ce rappel garde son identité : il est passé aux
    // gestionnaires de dépôt, qui ne doivent pas se reconstruire à chaque pixel
    // pris ou rendu par le panneau qui s'ouvre.
    const row = Math.floor((clientY - rect.top) / (rowHeightRef.current + GRID_GUTTER));
    return {
      x: Math.min(Math.max(0, column), GRID_COLUMNS - w),
      y: Math.max(0, row),
      w,
      h,
    };
  }, []);

  const handleGridDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const definition = dragWidgetRef.current;
      // Ce n'est pas un bloc : c'est un fichier ou un dossier, et ce
      // glisser-déposer là appartient au bloc « Tous les dossiers ». On ne le
      // capte pas.
      if (!definition) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      const spec = gridSize(definition.defaultSize);
      const next = cellAt(event.clientX, event.clientY, spec.w, spec.h);
      // Ne re-rendre que quand la CASE change, pas quand le pixel change.
      setDropCell((previous) =>
        previous && next && previous.x === next.x && previous.y === next.y ? previous : next
      );
    },
    [cellAt]
  );

  const handleGridDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const definition = dragWidgetRef.current;
      if (!definition) return;
      event.preventDefault();
      const spec = gridSize(definition.defaultSize);
      const cell = cellAt(event.clientX, event.clientY, spec.w, spec.h);
      dragWidgetRef.current = null;
      setDropCell(null);
      insertWidget(definition, cell ? { x: cell.x, y: cell.y } : undefined);
    },
    [cellAt, insertWidget]
  );

  // ── Repartir d'un modèle ────────────────────────────────────────────────

  const templates = useMemo<LayoutTemplate[]>(() => {
    const installed = Object.values(installedTemplates);
    // « Essentiel » est du CODE, pas une donnée du document : il n'y figure pas
    // et doit pourtant rester choisissable — c'est le seul retour en arrière sûr
    // après une session de rangement qui a mal tourné.
    return installed.some((template) => template.id === ESSENTIAL_TEMPLATE.id)
      ? installed
      : [ESSENTIAL_TEMPLATE, ...installed];
  }, [installedTemplates]);

  /**
   * « ENREGISTRER COMME… » — garder cette disposition sous un nouveau nom.
   *
   * ── LA SÉMANTIQUE, ET POURQUOI C'EST CELLE-LÀ ─────────────────────────────
   *
   * La disposition en cours part dans une mise en page NEUVE, et l'accueil
   * courant retourne à ce qu'il était à son dernier enregistrement. C'est le
   * « Enregistrer sous » de n'importe quel éditeur, et c'est ce qui rend le
   * bouton utile : sans ce retour en arrière, on garderait une copie ET on
   * aurait quand même écrasé l'original — exactement ce qu'on cherchait à
   * éviter en cliquant.
   *
   * ── DES IDENTIFIANTS DE BLOCS FRAIS ───────────────────────────────────────
   *
   * Les blocs sont recopiés avec de NOUVEAUX identifiants, comme le fait
   * `instantiate` en posant un modèle. Les `binding` locaux, eux, SURVIVENT :
   * c'est une copie de MA disposition sur MON appareil — contrairement à un
   * export, il n'y a rien à assainir, et vider les attaches ferait une copie
   * inutilisable qu'il faudrait rebrancher bloc par bloc.
   */
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  /** Le nom demandé existe déjà : on fait confirmer plutôt qu'écraser. */
  const [saveAsConflict, setSaveAsConflict] = useState<{ name: string; viewId: string } | null>(
    null
  );

  const commitSaveAs = useCallback(
    (name: string, viewId: string) => {
      const source = editSessionRef.current?.slots ?? slotsRef.current;
      const copie = duplicateSlotsForView(source, newSlotId);

      // L'accueil courant reprend sa forme d'avant : la session d'édition est
      // ABANDONNÉE, pas validée. Tout ce qu'on vient d'arranger vit désormais
      // dans la nouvelle mise en page.
      dispatch(cancelLayoutEdit());
      dispatch(setView({ id: viewId, slots: copie, updatedAt: new Date().toISOString() }));
      void dispatch(saveLayoutToDisk());
      setHomeViewId(viewId);

      setSaveAsOpen(false);
      setSaveAsConflict(null);
      notify({
        type: 'success',
        message: t('home.customize.savedAs', { name }),
        duration: SAVED_TOAST_MS,
      });
    },
    [dispatch, setHomeViewId, notify, t]
  );

  /**
   * ⚠ `makeHomeViewId` est DÉTERMINISTE : deux mises en page du même nom
   * portent le même identifiant, et la seconde écraserait la première sans un
   * mot. On fait donc confirmer — jamais de destruction silencieuse.
   */
  const requestSaveAs = useCallback(
    (rawName: string) => {
      const plan = planSaveAs(rawName, layoutViews);
      if (!plan) return;
      if (plan.replaces) {
        setSaveAsOpen(false);
        setSaveAsConflict({ name: plan.name, viewId: plan.viewId });
        return;
      }
      commitSaveAs(plan.name, plan.viewId);
    },
    [layoutViews, commitSaveAs]
  );

  const [templateToApply, setTemplateToApply] = useState<LayoutTemplate | null>(null);

  const applyTemplate = useCallback(
    (template: LayoutTemplate) => {
      const view = instantiate(template, {
        viewId: homeViewId,
        newSlotId,
        now: new Date().toISOString(),
      });
      // Un pas d'édition comme un autre : Ctrl+Z le défait, et rien n'est écrit
      // avant la sortie. C'est ce qui rend « Repartir d'un modèle » essayable.
      //
      // La largeur de la page SURVIT au modèle : un gabarit décrit des blocs, il
      // ne décrit pas l'écran de celui qui le pose (voir `homeConfig.ts`, § « et
      // le gabarit partagé ? »). Sans ce report, essayer un modèle recentrerait
      // l'accueil sans prévenir, et personne ne ferait le lien.
      dispatch(
        pushLayoutDraft({
          slots: withHomeConfig(view.slots, readHomeConfigFromSlots(slotsRef.current)),
          templateId: template.id,
        })
      );
      dispatch(setLayoutPanel({ open: false }));
    },
    [dispatch, homeViewId]
  );

  /**
   * La confirmation NOMME ce qui part, et rappelle que la disposition ne touche
   * pas aux données. C'est cette seconde phrase qui décoince l'expérimentation :
   * sans elle, « remplacer votre accueil » se lit comme « supprimer vos
   * fichiers », et personne n'essaie jamais un modèle.
   */
  const templateConfirmMessage = useMemo(() => {
    if (!templateToApply) return '';
    const names = slots
      .map((slot) => resolveWidget(slot.type))
      .filter((definition): definition is WidgetDefinition => definition !== null)
      .map((definition) => t(definition.titleKey));
    const shown = names.slice(0, 5).join(', ');
    // `n` et non `count` : `count` déclencherait la recherche des formes
    // plurielles d'i18next pour une clé qui n'en a pas.
    const blocks =
      names.length > 5
        ? t('home.customize.resetBlocksMore', '{{blocks}} et {{n}} autre(s)', {
            blocks: shown,
            n: names.length - 5,
          })
        : shown;
    return t(
      'home.customize.resetMessage',
      'Votre accueil actuel ({{blocks}}) sera remplacé par « {{name}} ». Seule la disposition change : aucun fichier, aucune note et aucun dossier n’est touché.',
      { blocks, name: templateToApply.name }
    );
  }, [templateToApply, slots, t]);

  // ── Le contexte des actions ─────────────────────────────────────────────
  //
  // Sa valeur ne change JAMAIS d'identite, et c'est tout l'enjeu : un contexte
  // fait re-rendre TOUS ses consommateurs a chaque nouvelle valeur, que
  // `React.memo` le veuille ou non. Or plusieurs rappels d'ici ne sont pas
  // stables a la source — `handleDrop` du hook de glisser-deposer depend de
  // l'element en cours de glissement, par exemple. Les cabler directement
  // ferait re-rendre les onze blocs a chaque debut et chaque fin de glissement.
  //
  // Ils passent donc par une ref rafraichie a chaque rendu, et le contexte ne
  // porte que des trampolines construits une fois pour toutes.

  const live = {
    openNote: handleOpenNote,
    openFolder: handleOpenFolder,
    openVault: handleOpenVault,
    seeAllUnfiled: handleSeeAllUnfiled,
    seeAllNotes: handleSeeAllNotes,
    openNotesBoard: handleOpenNotesBoard,
    openDailyNote: handleOpenDailyNote,
    folderContextMenu: handleFolderContextMenu,
    vaultContextMenu: handleVaultContextMenu,
    createFolder: handleCreateFolder,
    createVault: handleCreateVault,
    enterInviteCode: handleEnterInviteCode,
    dragStart: handleDragStart,
    dragEnd: handleDragEnd,
    dragOver: handleDragOver,
    dragEnter: handleDragEnter,
    dragLeave: handleDragLeave,
    drop: handleDropItem,
    setSlotSize: handleSetSlotSize,
    removeSlot: handleRemoveSlot,
    setSlotOption: handleSetSlotOption,
    startEditing,
    finishEditing,
  };
  const liveRef = useRef(live);
  liveRef.current = live;

  const actions = useMemo<HomeActions>(
    () => ({
      openNote: (noteId) => liveRef.current.openNote(noteId),
      openFolder: (folderId) => liveRef.current.openFolder(folderId),
      openVault: (vaultId, itemId) => liveRef.current.openVault(vaultId, itemId),
      seeAllUnfiled: () => liveRef.current.seeAllUnfiled(),
      seeAllNotes: () => liveRef.current.seeAllNotes(),
      openNotesBoard: () => liveRef.current.openNotesBoard(),
      openDailyNote: (isoDate) => liveRef.current.openDailyNote(isoDate),
      folderContextMenu: (event, folder) => liveRef.current.folderContextMenu(event, folder),
      vaultContextMenu: (event, vault) => liveRef.current.vaultContextMenu(event, vault),
      createFolder: () => liveRef.current.createFolder(),
      createVault: () => liveRef.current.createVault(),
      enterInviteCode: () => liveRef.current.enterInviteCode(),
      showDetails: (item) => setDetailsPanelItem(item),
      dragStart: (event, folder) => liveRef.current.dragStart(event, folder),
      dragEnd: () => liveRef.current.dragEnd(),
      dragOver: (event, folderId) => liveRef.current.dragOver(event, folderId),
      dragEnter: (event, folderId) => liveRef.current.dragEnter(event, folderId),
      dragLeave: (event) => liveRef.current.dragLeave(event),
      // La racine n'est pas un dossier stocke : la sentinelle est posee ici, pas
      // dans le bloc — un widget n'a pas a connaitre la topologie du stockage.
      drop: (event, folderId) => {
        void liveRef.current.drop(event, folderId, ROOT_FOLDER_ID);
      },
      // Le menu d'un bloc est la TROISIÈME porte du mode (avec le « ⋯ » de
      // l'en-tête et le clic droit sur le fond). Entrer et sortir n'y sont pas
      // symétriques : sortir COMMITE.
      setEditing: (on) => (on ? liveRef.current.startEditing() : liveRef.current.finishEditing()),
      setSlotSize: (slotId, size) => liveRef.current.setSlotSize(slotId, size),
      removeSlot: (slotId) => liveRef.current.removeSlot(slotId),
      setSlotOption: (slotId, key, value) => liveRef.current.setSlotOption(slotId, key, value),
    }),
    []
  );

  /** L'état volatil : il change vite, et un seul bloc le lit. */
  const gridState = useMemo<HomeGridState>(
    () => ({ draggedItem, dropTarget, springTarget, pendingMove, passwordVersion }),
    [draggedItem, dropTarget, springTarget, pendingMove, passwordVersion]
  );

  /**
   * Le rendu d'un bloc. DOIT être stable pendant un geste, sinon `GridItem`
   * re-rend les N cases à chaque case franchie (voir son contrat de
   * mémoïsation). Il ne dépend donc que de `slots` — dont la référence ne change
   * qu'au COMMIT d'un geste, pas pendant.
   */
  const renderItem = useCallback(
    (id: string) => {
      const slot = slotsRef.current.find((s) => s.id === id);
      if (!slot) return null;
      const definition = resolveWidget(slot.type);

      const inner = definition ? (
        <WidgetFrame
          slotId={slot.id}
          definition={definition}
          options={slot.options}
          binding={slot.binding}
          editing={editing}
        />
      ) : (
        // Type inconnu de CE binaire. L'emplacement reste dans le document (il
        // repartira intact vers la version qui sait le rendre) ET il occupe sa
        // place : une TUILE INERTE, au repos comme en édition. Voir
        // `UnavailableWidget` pour pourquoi ni suppression ni masquage.
        <UnavailableWidget type={slot.type} info={readUnavailableInfo(slot.options)} />
      );

      const className = [
        'home-slot',
        editing && slot.id === selectedSlotId ? 'home-slot--selected' : '',
        slot.id === flashSlotId ? 'home-slot--flash' : '',
      ]
        .filter(Boolean)
        .join(' ');

      // AU REPOS : une enveloppe muette. Pas de rôle, pas de tabulation, pas de
      // rappel — rien qui distingue cet accueil d'un accueil écrit à la main.
      if (!editing) {
        return <div className={className}>{inner}</div>;
      }

      // EN ÉDITION : le contenu du bloc est déjà intraversable (`home.css`), donc
      // le clic arrive ICI et SÉLECTIONNE. C'est exactement ce qui sépare un mode
      // édition sûr d'un mode piégeux : on ne peut pas ouvrir une note en
      // essayant d'attraper le bloc qui la porte.
      return (
        <div
          className={className}
          role="button"
          tabIndex={0}
          aria-pressed={slot.id === selectedSlotId}
          onClick={() => dispatch(selectLayoutSlot(slot.id))}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            dispatch(selectLayoutSlot(slot.id));
          }}
        >
          {inner}
        </div>
      );
    },
    // `slots` n'y figure pas : il est lu par ref, precisement pour que
    // l'identite de ce rappel survive a un geste. Ce qui commande cette identite
    // est `slotsContentKey`, qui ne bouge QUE si le contenu d'un bloc change —
    // jamais pour un simple deplacement. `t` non plus n'y figure pas : sa propre
    // identite n'est pas garantie, et la moindre instabilite ici ferait re-rendre
    // les N cases a chaque case franchie pendant un glissement.
    //
    // La selection et le clignotement, eux, DOIVENT y figurer — ils changent
    // l'apparence d'une case. Ils ne bougent jamais pendant un glissement, donc
    // la memoisation tient quand il faut.
    [editing, slotsContentKey, selectedSlotId, flashSlotId, dispatch]
  );

  /**
   * Le menu du FOND : clic droit là où il n'y a pas de carte.
   *
   * Garde `defaultPrevented` — les cartes ouvrent leur propre menu (et
   * `openContextMenu` fait `preventDefault`) ; sans cette garde, le menu de fond
   * écraserait celui de la carte qu'on vient de viser.
   *
   * « Ajouter des fichiers… » n'y figure pas : la racine ne contient que des
   * dossiers, un fichier déposé là ne s'afficherait nulle part. En revanche il
   * porte maintenant « Personnaliser l'accueil » — c'est le seul chemin qui
   * n'ajoute AUCUN pixel à un accueil au repos.
   */
  const handleBackgroundContextMenu = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (e.defaultPrevented) return;
      const items = buildBackgroundContextMenu(
        {
          newFolder: true,
          // Les deux gestes « coffre » suivent le droit aux coffres (règle 13).
          newVault: canUseTeamVaults,
          inviteCode: canUseTeamVaults,
          protectFiles: true,
          protectFolder: true,
        },
        {
          onNewFolder: handleCreateFolder,
          onNewVault: handleCreateVault,
          onInviteCode: handleEnterInviteCode,
          onProtectFiles: () => void pickAndProtectInPlace(false),
          onProtectFolder: () => void pickAndProtectInPlace(true),
        },
        t
      );
      // L'une des DEUX portes du mode qui ne coûtent aucun pixel à un accueil au
      // repos (l'autre est le « ⋯ » de l'en-tête). Le separateur se pose sur
      // l'entree PRECEDENTE : `ContextMenu` rend le filet apres l'element qui le
      // porte.
      //
      // Quand le mode est indisponible, l'entrée reste — GRISÉE, avec la raison
      // écrite. La faire disparaître laisserait croire que la personnalisation
      // n'existe pas, et personne n'irait chercher pourquoi.
      if (items.length > 0) {
        items[items.length - 1].divider = true;
        if (editing) {
          items.push({
            label: t('home.customize.finish', 'Terminé'),
            onClick: finishEditing,
          });
        } else if (!canEditLayout) {
          items.push({
            label: t('home.customize.unavailable', 'Personnalisation indisponible pour le moment'),
            disabled: true,
          });
        } else if (!wideEnough) {
          items.push({
            label: t(
              'home.customize.tooNarrow',
              'Réorganisez votre accueil sur une fenêtre plus large'
            ),
            disabled: true,
          });
        } else {
          items.push({
            label: t('home.customize.start', "Personnaliser l'accueil"),
            onClick: startEditing,
          });
        }
      }
      openContextMenu(e as any, items);
    },
    [
      openContextMenu,
      handleCreateFolder,
      handleCreateVault,
      handleEnterInviteCode,
      canUseTeamVaults,
      pickAndProtectInPlace,
      t,
      editing,
      canEditLayout,
      wideEnough,
      startEditing,
      finishEditing,
    ]
  );

  /**
   * Le menu « ⋯ » de l'en-tête de l'accueil — la porte DÉCOUVRABLE (le clic
   * droit, lui, se devine ; ce menu se voit au survol). Aucun bouton flottant
   * n'existe sur cette page : celui-ci est ancré dans la ligne d'en-tête, exactement
   * là où la barre d'édition viendra prendre sa place.
   */
  const homeMenuItems = useMemo<DropdownItem[]>(() => {
    /**
     * LES TROIS ENTRÉES DE PARTAGE sont TOUJOURS là, même quand ranger est
     * impossible. Importer et changer de mise en page ne demandent pas d'entrer
     * en édition, et une fenêtre étroite n'est pas une raison de ne pas pouvoir
     * revenir à son accueil habituel — c'est même le moment où on en a besoin.
     * Exporter, en revanche, suit le document : on n'exporte pas une
     * disposition provisoire qui n'est pas encore descendue du nuage.
     */
    const transfer: DropdownItem[] = [
      ...(canEditLayout
        ? [
            {
              label: t('layouts.menu.export', 'Exporter cette mise en page…'),
              onClick: () => setExportOpen(true),
            },
          ]
        : []),
      {
        label: t('layouts.menu.import', 'Importer une mise en page…'),
        onClick: () => setImportSource({ open: true, source: null }),
      },
      {
        label: t('layouts.menu.switch', 'Mes mises en page…'),
        onClick: () => setSwitcherOpen(true),
      },
    ];
    if (transfer.length > 0) transfer[transfer.length - 1].divider = true;

    if (!canEditLayout) {
      return [
        ...transfer,
        {
          label: t('home.customize.unavailable', 'Personnalisation indisponible pour le moment'),
          disabled: true,
        },
      ];
    }
    if (!wideEnough) {
      return [
        ...transfer,
        {
          label: t(
            'home.customize.tooNarrow',
            'Réorganisez votre accueil sur une fenêtre plus large'
          ),
          disabled: true,
        },
      ];
    }
    return [
      ...transfer,
      { label: t('home.customize.start', "Personnaliser l'accueil"), onClick: startEditing },
    ];
  }, [canEditLayout, wideEnough, startEditing, t]);

  /**
   * Le témoin de dépôt, en pixels dérivés de la MÊME métrique que la feuille de
   * style. `calc` sur des pourcentages plutôt qu'une largeur relevée : la
   * grille se recompose pendant que le panneau s'ouvre, et une valeur mesurée
   * une fois serait fausse pendant les deux cents millisecondes qui comptent.
   */
  const dropGhostStyle = useMemo(() => {
    if (!dropCell) return undefined;
    const track = `((100% - ${GRID_GUTTER * (GRID_COLUMNS - 1)}px) / ${GRID_COLUMNS})`;
    return {
      left: `calc(${track} * ${dropCell.x} + ${dropCell.x * GRID_GUTTER}px)`,
      width: `calc(${track} * ${dropCell.w} + ${(dropCell.w - 1) * GRID_GUTTER}px)`,
      // La rangée, elle, est la MÊME que celle donnée à la surface : un témoin
      // dessiné sur 88 px pendant que la grille en fait 120 viserait une case
      // au-dessus de celle où le bloc va tomber.
      top: `${dropCell.y * (rowHeight + GRID_GUTTER)}px`,
      height: `${dropCell.h * rowHeight + (dropCell.h - 1) * GRID_GUTTER}px`,
    };
  }, [dropCell, rowHeight]);

  return (
    // Rangée : la colonne habituelle, plus le panneau de détails à sa droite —
    // même disposition que la vue dossier, pour que « Voir les détails » se
    // présente pareil des deux côtés.
    <div
      className="flex w-full min-h-full bg-[var(--color-background-secondary)]"
      onContextMenu={handleBackgroundContextMenu}
    >
      <div className="flex flex-col flex-1 min-w-0">
        <div
          ref={pageRef}
          className={[
            'home-page',
            editing ? 'home-page--editing' : '',
            // LA LARGEUR DE LA PAGE. Le plafond de « Centré » a quitté le
            // `max-w-[1400px]` d'ici pour `home.css` : il n'est plus une valeur
            // posée en passant, c'est un état nommé que le JavaScript relit
            // (`HOME_PAGE_MAX_WIDTH`) pour en dériver la largeur de case.
            // Les marges latérales usuelles (`px-6`), elles, restent dans les
            // DEUX modes — « pleine largeur » n'est pas « collé aux bords ».
            homeConfig.width === 'full' ? 'home-page--full' : 'home-page--centered',
            'w-full px-6 py-6 flex flex-col gap-6',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {/* L'EN-TÊTE. Au repos elle ne porte qu'un « ⋯ » invisible tant que la
              souris est ailleurs ; en édition, la barre prend sa place. Même
              ancrage dans les deux modes : la barre ne surgit pas d'ailleurs. */}
          {editing ? (
            <EditBar
              addActive={panelOpen && !selectedSlot && panelMode === 'add'}
              templatesActive={panelOpen && !selectedSlot && panelMode === 'templates'}
              onToggleAdd={() =>
                dispatch(
                  setLayoutPanel({
                    open: !(panelOpen && !selectedSlot && panelMode === 'add'),
                    mode: 'add',
                  })
                )
              }
              onOpenTemplates={() => dispatch(setLayoutPanel({ open: true, mode: 'templates' }))}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={handleUndo}
              onRedo={handleRedo}
              onDone={finishEditing}
              onSaveAs={() => setSaveAsOpen(true)}
              width={homeConfig.width}
              onWidth={handleSetHomeWidth}
            />
          ) : (
            <div className="home-header">
              <Dropdown
                className="home-header__menu"
                position="bottom-right"
                items={homeMenuItems}
                trigger={
                  <span
                    className="home-header__menu-button"
                    aria-label={t('home.customize.homeMenu', 'Options de l’accueil')}
                    title={t('home.customize.homeMenu', 'Options de l’accueil')}
                  >
                    <HomeMoreIcon />
                  </span>
                }
              />
            </div>
          )}

          {/* LE BANDEAU (lot A, C5) : ce qui ATTEND — invitations, accès promis,
              code armé, « partagé avec moi ». Au-dessus de la grille et PAS en
              widget : un widget se retire, et `isEmpty` ne voit pas le
              localStorage où vivent les invitations armées. Rend `null` quand
              tout est vide. */}
          <VaultInboxBanner onOpenVault={handleOpenVault} onOpenAccess={handleOpenVaultAccess} />

          <HomeActionsProvider value={actions}>
            <HomeGridStateProvider value={gridState}>
              {/* Le panneau POUSSE la grille (voir `homeEdit.css`) : on doit voir
                  où le bloc va tomber, et un panneau flottant masquerait
                  exactement la zone qu'on vise. */}
              <div className="home-workspace">
                <div
                  ref={gridBoxRef}
                  className="home-workspace__grid"
                  onDragOver={handleGridDragOver}
                  onDrop={handleGridDrop}
                >
                  <GridSurface
                    layout={visiblePlacements}
                    editing={editing && canEditLayout}
                    onLayoutChange={handleLayoutChange}
                    allowedSizes={allowedSizes}
                    constraints={constraints}
                    renderItem={renderItem}
                    // La rangée s'étire avec la case en pleine largeur, et vaut
                    // exactement 88 px partout ailleurs — voir `homeRowHeight`.
                    rowHeight={rowHeight}
                    // ON N'ÉDITE QUE LA DISPOSITION MAÎTRESSE. Sans ce forçage,
                    // ouvrir le panneau ferait passer la grille sous les douze
                    // colonnes et le moteur REFUSERAIT tous les gestes, au
                    // milieu de la session, sans un mot.
                    columnsOverride={editing ? GRID_COLUMNS : undefined}
                  />
                  {dropGhostStyle && (
                    <div className="home-drop-ghost" style={dropGhostStyle} aria-hidden="true" />
                  )}
                </div>

                {editing && (
                  <div
                    className={[
                      'home-workspace__panel',
                      panelOpen ? 'home-workspace__panel--open' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {/* LE MÊME PANNEAU change de contenu quand un bloc est
                        sélectionné — jamais une modale par-dessus la grille,
                        qui cacherait le bloc qu'on est en train de régler. */}
                    {panelOpen &&
                      (selectedSlot ? (
                        <WidgetInspector
                          slot={selectedSlot}
                          definition={resolveWidget(selectedSlot.type)}
                          // Refermer l'inspecteur DÉSÉLECTIONNE aussi : sans ça
                          // le panneau rouvrirait sur les réglages du bloc
                          // d'avant à la prochaine ouverture.
                          onClose={() => {
                            dispatch(selectLayoutSlot(null));
                            dispatch(setLayoutPanel({ open: false }));
                          }}
                          onResize={(w, h) => handleSetSlotGeometry(selectedSlot.id, w, h)}
                          onOption={(key, value) =>
                            handleSetSlotOption(selectedSlot.id, key, value)
                          }
                          onRemove={() => handleRemoveSlot(selectedSlot.id)}
                        />
                      ) : (
                        <WidgetPalette
                          mode={panelMode}
                          onClose={() => dispatch(setLayoutPanel({ open: false }))}
                          onInsert={insertWidget}
                          onDragWidgetStart={handleWidgetDragStart}
                          onDragWidgetEnd={handleWidgetDragEnd}
                          templates={templates}
                          // Le gabarit posé PENDANT la session prime : c'est lui
                          // que la grille montre, même s'il n'est pas encore
                          // scellé.
                          activeTemplateId={editSession?.templateId ?? homeView?.templateId}
                          onPickTemplate={setTemplateToApply}
                        />
                      ))}
                  </div>
                )}
              </div>
            </HomeGridStateProvider>
          </HomeActionsProvider>
        </div>
      </div>

      {/* ===== Panneau de détails =====
          Même composant que la vue dossier. `folderId` n'y sert à rien (il est
          accepté mais jamais lu) : la racine n'a pas d'identifiant, on passe
          donc la chaîne vide plutôt que d'inventer une sentinelle. */}
      {detailsPanelItem && (
        <FileDetailsPanel
          item={detailsPanelItem}
          folderId=""
          onClose={() => setDetailsPanelItem(null)}
        />
      )}

      {/* Context Menu */}
      {contextMenu.isOpen && (
        <ContextMenu
          items={contextMenu.items}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
        />
      )}

      {/* ===== Modèles de mise en page partageables =====
          Trois boîtes, montées en permanence (elles ne rendent rien tant
          qu'elles sont fermées) : exporter avec son tableau d'assainissement,
          importer avec son aperçu, et le sélecteur qui rend le retour en
          arrière à un clic. */}
      <ExportLayoutDialog
        isOpen={exportOpen}
        onClose={() => setExportOpen(false)}
        // `gridSlots` et non `slots` : l'emplacement réservé NE PART PAS dans un
        // modèle partagé. La largeur est une préférence d'écran, pas une
        // disposition — et son type, absent du registre de qui importe,
        // s'afficherait chez lui en tuile inerte. Voir `homeConfig.ts`.
        slots={gridSlots}
        defaultName={homeViewName(homeViewId, t('layouts.views.default', 'Accueil'))}
      />
      <ImportLayoutDialog
        isOpen={importState.open}
        source={importState.source}
        onClose={() => setImportSource({ open: false, source: null })}
        onApplied={(viewId) => setHomeViewId(viewId)}
      />
      <PromptModal
        isOpen={saveAsOpen}
        onClose={() => setSaveAsOpen(false)}
        onSubmit={requestSaveAs}
        title={t('home.customize.saveAsTitle')}
        label={t('home.customize.saveAsLabel')}
        placeholder={t('home.customize.saveAsPlaceholder')}
        submitText={t('home.customize.saveAsConfirm')}
        cancelText={t('common.cancel')}
      />

      {/* Le nom est déjà pris. On NOMME ce qui serait remplacé : « une mise en
          page porte déjà ce nom » sans dire laquelle laisserait décider à
          l'aveugle. */}
      <ConfirmModal
        isOpen={saveAsConflict !== null}
        onClose={() => setSaveAsConflict(null)}
        onConfirm={() => saveAsConflict && commitSaveAs(saveAsConflict.name, saveAsConflict.viewId)}
        title={t('home.customize.saveAsExistsTitle')}
        message={t('home.customize.saveAsExists', { name: saveAsConflict?.name ?? '' })}
        confirmText={t('home.customize.saveAsReplace')}
        cancelText={t('common.cancel')}
        variant="warning"
      />

      <HomeViewSwitcher
        isOpen={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        activeViewId={homeViewId}
      />

      {/* Modal création de dossier — emplacement à la racine par défaut */}
      <CreateFolderModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSubmit={handleConfirmCreate}
        defaultParentId={null}
        title={t('home.newFolderTitle', 'Nouveau dossier')}
      />

      {/* Modal renommage de dossier */}
      <PromptModal
        isOpen={renameModalOpen}
        onClose={() => {
          setRenameModalOpen(false);
          setFolderToRename(null);
        }}
        onSubmit={handleConfirmRename}
        title={t('home.renameTitle', 'Renommer le dossier')}
        label={t('home.renameLabel', 'Nouveau nom')}
        defaultValue={folderToRename?.name || ''}
        submitText={t('common.rename', 'Renommer')}
        cancelText={t('common.cancel', 'Annuler')}
      />

      {/* Modal confirmation de suppression simple */}
      <ConfirmModal
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setFolderToDelete(null);
        }}
        onConfirm={handleConfirmDelete}
        title={t('home.deleteTitle', 'Supprimer le dossier')}
        message={
          folderToDelete
            ? t(
                'home.deleteConfirm',
                `Êtes-vous sûr de vouloir supprimer le dossier "${folderToDelete.name}" ? Cette action est irréversible.`
              )
            : ''
        }
        confirmText={t('common.delete', 'Supprimer')}
        cancelText={t('common.cancel', 'Annuler')}
        variant="danger"
      />

      {/* Modal confirmation de suppression détaillée */}
      {folderDeletionInfo && (
        <DeleteFolderConfirmModal
          isOpen={folderDeleteModalOpen}
          onClose={() => {
            setFolderDeleteModalOpen(false);
            setFolderDeletionInfo(null);
            setFolderToDelete(null);
          }}
          onConfirm={handleConfirmFolderDelete}
          folderName={folderDeletionInfo.folderName}
          items={folderDeletionInfo.items}
          totalItemCount={folderDeletionInfo.totalItemCount}
          totalSize={folderDeletionInfo.totalSize}
          isDeleting={isDeleting}
        />
      )}

      {/* Personnalisation couleur & emoji — la MÊME boîte que la vue dossier */}
      {folderStyleTarget && (
        <FolderStyleModal
          isOpen={!!folderStyleTarget}
          onClose={() => setFolderStyleTarget(null)}
          folderName={folderStyleTarget.name}
          defaultColor={folderStyleTarget.color || '#3b82f6'}
          defaultEmoji={folderStyleTarget.emoji}
          onSubmit={handleConfirmStyle}
        />
      )}

      {/* Déplacement d'un dossier racine — la racine n'est pas une destination
          (le dossier y est déjà), d'où `allowRootTarget` laissé à faux. */}
      {folderToMove && (
        <MoveCopyDialog
          isOpen={!!folderToMove}
          onClose={() => {
            // Une opération en vol garde la main : refermer ici laisserait
            // l'utilisateur sans nouvelles de ce qu'il vient de lancer.
            if (moveBusy) return;
            setFolderToMove(null);
          }}
          busy={moveBusy}
          onSubmit={handleConfirmMove}
          mode="move"
          itemName={folderToMove.name}
          currentFolderId={ROOT_FOLDER_ID}
          itemId={folderToMove.id}
        />
      )}

      {/* Protection par mot de passe */}
      {passwordModalFolder && (
        <FolderPasswordModal
          isOpen={!!passwordModalFolder}
          onClose={() => setPasswordModalFolder(null)}
          folderId={passwordModalFolder.id}
          folderName={passwordModalFolder.name}
          childItemIds={passwordModalFolder.items || []}
          onPasswordChange={() => {
            bumpPasswordVersion((v) => v + 1);
            success(t('home.protectUpdated', 'Protection par mot de passe mise à jour'));
          }}
        />
      )}

      {/* « Protéger sur place » depuis le menu de fond */}
      <ProtectInPlaceDialog
        isOpen={protectDialogPaths !== null}
        paths={protectDialogPaths ?? []}
        onClose={() => setProtectDialogPaths(null)}
      />

      {/* « Ajouter au coffre partagé… » — un dossier racine entier part dans un
          coffre (copie, ou déplacement avec corbeille locale à l'arrivée).
          Pas de `onLocalChanged` : l'accueil ne propose que des DOSSIERS, et le
          déplacement d'un dossier relit déjà l'arbre entier (`fetchFolders`). */}
      <AddToVaultDialog
        isOpen={addToVaultSource !== null}
        onClose={() => setAddToVaultSource(null)}
        source={addToVaultSource}
      />

      {/* « Nouveau coffre partagé » (lot A, C4) : le gate d'abord — invisible
          s'il n'a rien à demander — puis la boîte de création. Créé, le coffre
          s'ouvre : c'est là que l'utilisateur voulait aller. */}
      <VaultKeypairGateModal
        isOpen={createVaultStage === 'gate'}
        onClose={() => setCreateVaultStage(null)}
        onReady={handleVaultKeypairReady}
      />
      <CreateVaultModal
        isOpen={createVaultStage === 'form'}
        onClose={() => setCreateVaultStage(null)}
        onCreated={handleOpenVault}
      />
      {/* « J'ai un code d'invitation… » — arme le lien ; PendingInviteHost
          reprend la main. */}
      <InviteCodeModal isOpen={inviteCodeOpen} onClose={() => setInviteCodeOpen(false)} />

      {/* Panneaux Membres/Activité et confirmation de départ d'un coffre. */}
      {vaultOverlays}

      {/* « Repartir d'un modèle… » — la confirmation NOMME ce qui sera remplacé
          et rappelle que la disposition ne touche PAS aux données. Le geste
          reste dans le brouillon : Ctrl+Z le défait, et rien n'est écrit avant
          « Terminé ». D'où `variant="warning"` et non `danger` : rien ne se
          perd ici. */}
      <ConfirmModal
        isOpen={templateToApply !== null}
        onClose={() => setTemplateToApply(null)}
        onConfirm={() => {
          if (templateToApply) applyTemplate(templateToApply);
          setTemplateToApply(null);
        }}
        title={t('home.customize.resetTitle', 'Repartir d’un modèle ?')}
        message={templateConfirmMessage}
        confirmText={t('common.apply', 'Appliquer')}
        cancelText={t('common.cancel', 'Annuler')}
        variant="warning"
      />

      {/* Modal ajout de rappel */}
      <ReminderModal
        isOpen={reminderModalOpen}
        onClose={() => {
          setReminderModalOpen(false);
          setFolderForReminder(null);
        }}
        onSubmit={handleConfirmReminder}
        title={t('home.reminderTitle', 'Ajouter un rappel')}
        itemName={folderForReminder?.name}
      />
    </div>
  );
};

export default Home;
