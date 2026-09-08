/**
 * VaultFolderView — un coffre partagé rendu comme l'explorateur ORDINAIRE.
 *
 * LE CAP. « Le coffre partagé n'a rien de différent de l'explorateur normal :
 * c'est juste un endroit où l'on accède à ses fichiers partagés. » L'ancienne
 * vue (`VaultItemBrowser`) affichait une liste de rangées à six boutons, propre
 * au coffre : on changeait de produit en franchissant la frontière. Ici on
 * réemploie les MÊMES briques que `views/FolderView` — `ExplorerHeader`,
 * `FileCard`, `SubfolderCard`, `buildItemContextMenu` — donc les mêmes cartes,
 * les mêmes vignettes, le même clic droit, le même basculement grille/liste.
 *
 * CE QUI N'EST PAS RÉÉCRIT. Rien de la logique : elle vit dans
 * `useVaultBrowser` (extrait de `VaultItemBrowser`), qui reste l'unique
 * détenteur du gel des écritures pour un lecteur, de la matrice `canDelete`
 * recopiée du serveur, de la jauge de quota consultée avant l'envoi, du refus
 * des dossiers de l'OS au dépôt, du bandeau de reprise d'un lot interrompu, des
 * trois issues d'un 409 et de l'écran d'époque dépassée.
 *
 * DEUX MONDES, ZÉRO FUSION. Les éléments de coffre ne deviennent JAMAIS des
 * entités Redux de l'espace personnel : l'adaptateur ci-dessous ne produit que
 * la forme d'affichage minimale (`ExplorerItem` / `ExplorerFolder`), avec des
 * identifiants PRÉFIXÉS (`vaultitem:` / `vaultdir:`) pour qu'aucun code ne
 * puisse confondre l'un avec l'autre — ni le cache de vignettes, ni le service
 * de mots de passe par fichier, ni une sélection restée en mémoire.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import type { AppDispatch, RootState } from '../../../store';
import { loadVaults, loadVaultItems, vaultActivitySeen } from '../../../store/slices/vaultsSlice';
import type { VaultItemSummary } from '../../../store/slices/vaultsSlice';
import { loadVaultShareSummary } from '../../../store/slices/shareIndexSlice';
import {
  selectGrantCountMap,
  selectVaultMemberCount,
} from '../../../store/selectors/shareIndexSelectors';
import { setSortBy, setViewMode } from '../../../store/slices/uiSlice';
import type { SortOption, ViewMode } from '../../../types';
import { Button, ConfirmModal, Dropdown, PromptModal } from '../ui';
import { Modal, ModalHeader, ModalBody } from '../ui/Modal/Modal';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import {
  FileCard,
  SubfolderCard,
  ExplorerHeader,
  EMPTY_TAGS,
  type ExplorerItem,
  type ExplorerFolder,
} from '../files';
import {
  buildItemContextMenu,
  buildBackgroundContextMenu,
  ShareIcon,
  DownloadIcon,
  MoveIcon,
  CopyIcon,
  DeleteIcon,
  PersonShareIcon,
  type ItemMenuCapabilities,
  type ItemMenuHandlers,
} from '../files/itemContextMenu';
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu';
import { VaultSelectionBar } from './VaultSelectionBar';
import { VaultGlyph } from './VaultGlyph';
import { useVaultAppearance } from './useVaultAppearance';
import { useVaultPin } from './settings/useVaultPin';
import { useVaultFavorites } from './useVaultFavorites';
import { useMentionPins } from '../../../services/vault/mentionInbox';
import {
  pruneSelection,
  resolveSelection,
  planSelectionDelete,
  folderDescendantFiles,
} from './vaultSelection';
import { planDuplicate } from './vaultDuplicate';
import useContextMenu from '../../../hooks/useContextMenu';
// Le LASSO de l'explorateur personnel, réemployé tel quel : le même hook, la
// même classe visuelle (`rb-selecting`), le même rectangle.
import { useRubberBandSelection } from '../../../hooks/useRubberBandSelection';
import { VaultNoteEditor } from './VaultNoteEditor';
import { VaultItemHistory } from './VaultItemHistory';
import { VaultShareModal } from './VaultShareModal';
import { VaultFileThreadPanel } from './VaultFileThreadPanel';
import {
  threadBadgeKey,
  threadBadges,
  type ThreadBadge,
} from '../../../services/vault/threadStamp';
// Le dialogue de partage UNIFIÉ (« Gérer l'accès ») et le panneau de détails
// de la vue dossier — les MÊMES briques que l'espace personnel, pas des
// variantes « coffre » : c'est le cap de ce fichier.
import { useShareDialog } from '../sharing/useShareDialog';
import FileDetailsPanel, { type FileDetailsSharing } from '../views/FolderView/FileDetailsPanel';
import { VaultActivityPanel } from './VaultActivityPanel';
import { vaultFolderRoute } from '../layout/RouteContent/routeCompat';
// Le SEUL traducteur « note de coffre → route de l'onglet Notes ». L'explorateur
// s'en sert pour la même raison que la section « Coffres partagés » : deux
// orthographes de la même adresse divergeraient au premier changement de forme.
import { vaultNoteDestination } from '../notes/noteShareNavigation';
import { BufferPreview } from '../preview/BufferPreview';
import { PluginEditorModal } from '../plugins/PluginEditorModal';
import { editorAcceptsSize, editorForFileName } from '../../../services/plugins/pluginRegistry';
import { vaultErrorKey } from '../../../services/vault/vaultErrorMessages';
import {
  normalizePath,
  parentOf,
  lastSegment,
  isDescendantOrSelf,
  type MoveSource,
} from '../../../services/vault/vaultPaths';
import {
  apiGetVaultActivity,
  apiListItemGrants,
  apiListVaultMembers,
  type ItemGrantDTO,
  type VaultActivityPage,
} from '../../../services/vault/vaultApi';
import { unseenCount, resolveActivityRow } from './vaultActivityModel';
// F11 — le point rouge de « Gérer ». Il ne DEMANDE rien : il relit ce que la
// page de gestion a déposé lors de sa dernière visite (voir l'en-tête du hook).
import { useVaultKeyAlertCount } from './settings/useMemberKeyWatch';
import { getSeenCursor, setSeenCursor } from './vaultActivitySeen';
// Les glyphes de l'en-tête (16 px, `currentColor`) sont ceux de la vue dossier :
// importés de `files/explorerIcons`, plus recopiés (lot A, C6).
import {
  UploadIcon,
  FolderPlusIcon,
  DocumentPlusIcon,
  SortAscIcon,
  SortDescIcon,
  ListIcon,
  GridIcon,
} from '../files/explorerIcons';
import { useVaultBrowser, formatBytes, itemName, DND_TYPE } from './useVaultBrowser';
import {
  VAULT_ITEM_PREFIX,
  idFromItemId,
  toVaultDisplayItems,
  allVaultFolderPaths,
  buildSharedCardProps,
  vaultFileCaps,
  vaultFolderCaps,
  toVaultDetailsItem,
  eventsForVaultItem,
  vaultItemKind,
  vaultNoteOpenTarget,
  type VaultCapsContext,
  type VaultDisplayFolderModel,
  type VaultDisplayFileModel,
} from './vaultExplorerModel';
import { VaultFrozenBanner } from './VaultFrozenBanner';
import { searchFieldProps } from '../ui/searchFieldProps';

/**
 * L'ADAPTATEUR et la MATRICE DE DROITS vivent dans `vaultExplorerModel` —
 * un module sans React ni Redux, donc éprouvable hors application. Ce sont les
 * deux endroits où une erreur ne se verrait pas à la compilation.
 */
export type VaultDisplayFolder = VaultDisplayFolderModel & ExplorerFolder;
export type VaultDisplayFile = VaultDisplayFileModel<VaultItemSummary> & ExplorerItem;
export interface VaultDisplayItems {
  folders: VaultDisplayFolder[];
  files: VaultDisplayFile[];
}

/**
 * Le badge « Partagé » du FIL D'ARIANE — la marque du coffre lui-même (à ne pas
 * confondre avec `files/SharedBadge`, la pastille « partagé avec N personnes »
 * que les cartes posent sur CHAQUE élément : même glyphe, deux sujets).
 */
const VaultBreadcrumbBadge: React.FC<{ label: string; title: string }> = ({ label, title }) => (
  <span
    title={title}
    className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold
      bg-[var(--color-primary-50)] text-[var(--color-primary-700)]"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className="w-3 h-3"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
      />
    </svg>
    {label}
  </span>
);

// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  vaultId: string;
  /**
   * Remonter d'un cran depuis la RACINE du coffre. Absent = le composant décide
   * (retour à l'accueil, où vivent les cartes de coffre) — c'est ce que fait la
   * route profonde `/vault-folder/<id>`.
   */
  onExit?: () => void;
  /**
   * L'ÉLÉMENT À METTRE EN ÉVIDENCE à l'arrivée (`/vault-folder/<id>?item=…`) :
   * la cible d'un raccourci de l'espace personnel. Une fois les éléments
   * chargés, la vue se place dans SON dossier, le sélectionne et l'amène à
   * l'écran — une seule fois, puis l'utilisateur est chez lui.
   */
  focusItemId?: string;
  /**
   * OUVRIR la cible, et pas seulement la montrer (`?open=1`).
   *
   * C'est ce que demande la section « Coffres partagés » de l'onglet Notes :
   * un clic sur une note y doit poser cette note dans l'éditeur, comme un clic
   * sur une note personnelle — pas déposer la personne devant un explorateur
   * où sa carte est simplement surlignée.
   *
   * SEULE UNE NOTE S'OUVRE AINSI. Un fichier vise son ouverture ordinaire
   * (téléchargement, aperçu, application tierce) et la déclencher au seul vu
   * d'une adresse serait un geste qu'on prend au nom de quelqu'un.
   */
  openFocusedItem?: boolean;
}

/**
 * Le volet latéral ne porte plus que le FIL. « Membres » y vivait aussi, à 380
 * pixels de large pour un tableau de cinq colonnes ; il a sa page entière
 * désormais (`?view=settings`), et le bouton de la barre s'appelle « Gérer ».
 */
type SidePanel = 'activity' | null;

export const VaultFolderView: React.FC<Props> = ({
  vaultId,
  onExit,
  focusItemId,
  openFocusedItem,
}) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const vb = useVaultBrowser(vaultId);
  const { contextMenu, openContextMenu, closeContextMenu } = useContextMenu();

  /**
   * L'ÉPINGLE DU COFFRE (F27), posée et retirée depuis le menu contextuel d'un
   * élément. Elle vit dans le bloc scellé des réglages que `useVaultBrowser` lit
   * déjà pour lui-même : aucune lecture de plus, et le hook d'écriture refait
   * exactement ce que fait l'onglet « Réglages » — y compris le refus d'écraser
   * un bloc que cet appareil n'a pas su ouvrir.
   */
  const pin = useVaultPin(vaultId, vb.currentKeyEpoch, vb.vaultSettings);

  /**
   * MES FAVORIS (★) — personnels, scellés sous la clé du coffre, suivis d'un
   * appareil à l'autre par un compare-and-set côté serveur qui ne lit jamais
   * la liste. Rien à voir avec l'épingle du coffre ci-dessus.
   */
  // Le même prédicat que `isCloud` plus bas — lu ici parce que ce hook doit
  // être appelé avant lui, et qu'un hook ne se déplace pas sans risque.
  const favEnabled = useSelector((s: RootState) => s.auth.accountMode === 'cloud');
  const fav = useVaultFavorites(vaultId, vb.currentKeyEpoch, favEnabled);
  /**
   * LES MENTIONS NON LUES QUI ME VISENT, par élément — dérivées de la boîte
   * que la cloche tient déjà : rien à stocker, et marquer lu les retire.
   */
  const mentionPins = useMentionPins(vaultId);
  const favoriteTitle = t('teamVaults.favorites.badge');
  const mentionTitle = useCallback((n: number) => t('teamVaults.mentionBadge', { count: n }), [t]);

  /**
   * LA DESCRIPTION AFFICHÉE DANS LE FIL D'ARIANE (F27). Elle vient du bloc que
   * CET écran vient d'ouvrir, jamais de l'index en mémoire : celui-ci sert aux
   * CARTES, qui n'ont pas de lecture à elles. Ici on en a une, et une valeur
   * fraîche vaut mieux qu'une valeur retenue — c'est aussi ce qui fait disparaître
   * la ligne dans la seconde où quelqu'un efface la description.
   */
  const description = vb.vaultSettings.blockReadable ? vb.vaultSettings.block.description : '';

  /**
   * OUVRIR UNE NOTE DU COFFRE — LE passage unique, et il TRANCHE.
   *
   * Toutes les portes de cet écran (double-clic, clic simple en préférence
   * « ouvrir », bouton « Ouvrir » de la barre de sélection, menu contextuel,
   * lien profond `?item=…&open=1`) aboutissent ici, et la décision est prise UNE
   * fois, par un modèle pur (`vaultNoteOpenTarget`) éprouvé hors application.
   * Écrire la condition à quatre endroits, ce serait quatre occasions de la voir
   * diverger — et le symptôme serait une note qui s'ouvre dans une fenêtre au
   * double-clic et dans l'onglet Notes par le menu contextuel, sur le même
   * coffre, sans qu'aucune compilation ne s'en émeuve.
   *
   * CE QUE LA DÉCISION LIT : le droit d'écrire MAINTENANT — le rôle ET le gel,
   * les deux entrées de `canEditVault`. Un lecteur, ou n'importe qui dans un
   * coffre gelé, garde la fenêtre : légère, posée par-dessus la grille, refermée
   * d'un geste, elle ne fait pas perdre le dossier qu'on regardait, et c'est
   * exactement ce qu'il faut pour consulter.
   *
   * CE QU'ON QUITTE EN ÉCRIVANT, ET IL FAUT LE DIRE. Partir vers l'onglet Notes
   * DÉMONTE cet écran : `useVaultBrowser` tient son dossier courant, sa
   * recherche et sa sélection en état local. Le retour (« ← nom du coffre »)
   * repasse par `?item=<id>`, qui replace l'explorateur dans le dossier de la
   * note, l'y sélectionne et la fait défiler à l'écran — donc le CHEMIN et la
   * note reviennent, mais ni une recherche globale en cours (le raccourci la
   * vide, c'est sa règle depuis toujours) ni une sélection multiple. Un lecteur,
   * lui, ne perd rien du tout : sa fenêtre s'ouvre par-dessus l'explorateur
   * intact.
   */
  const openNote = useCallback(
    (itemId: string) => {
      if (vaultNoteOpenTarget({ role: vb.role, frozen: vb.frozen }) === 'pane') {
        navigate(vaultNoteDestination(vaultId, itemId));
        return;
      }
      vb.setEditingId(itemId);
    },
    // `vb` est recréé à chaque rendu : on dépend de l'objet entier plutôt que de
    // mentir sur des membres qui ne sont pas mémoïsés.
    [vb, navigate, vaultId]
  );

  /**
   * LA CIBLE D'UN RACCOURCI — en DEUX temps, parce que `useVaultBrowser` VIDE
   * la sélection à chaque changement de dossier (son effet tourne avant
   * celui-ci, dans le même commit) : sélectionner dans le passage qui pose
   * `setCurrentPath` serait effacé aussitôt. On pose donc le dossier, et on
   * sélectionne au passage suivant, quand `currentPath` est celui de l'élément.
   *
   * Une cible introuvable une fois la liste chargée ne déclenche rien : la
   * carte-raccourci l'a déjà dit (« introuvable ») ; cette vue n'y ajoute pas
   * un second avertissement.
   *
   * Une NOUVELLE cible (autre raccourci vers le même coffre, composant non
   * remonté — la clé est le coffre) relance le cycle.
   */
  const focusRef = useRef<{
    id: string | null;
    phase: 'pending' | 'placed' | 'done';
    open: boolean;
  }>({
    id: focusItemId ?? null,
    phase: focusItemId ? 'pending' : 'done',
    open: !!openFocusedItem,
  });
  useEffect(() => {
    focusRef.current = {
      id: focusItemId ?? null,
      phase: focusItemId ? 'pending' : 'done',
      open: !!openFocusedItem,
    };
  }, [focusItemId, openFocusedItem]);
  // `vb` est recréé à chaque rendu : l'effet tourne à chaque passage, gardé
  // par la phase — dépendre de membres non mémoïsés mentirait.
  useEffect(() => {
    const focus = focusRef.current;
    if (focus.phase === 'done' || !focus.id) return;
    const item = vb.items.find((i) => i.id === focus.id);
    if (!item) {
      // Liste chargée (non vide, plus en vol) et l'élément n'y est pas : on renonce.
      if (vb.items.length > 0 && !vb.loading) focus.phase = 'done';
      return;
    }
    const targetPath = normalizePath(item.meta.path);
    if (focus.phase === 'pending') {
      focus.phase = 'placed';
      if (vb.query) vb.setQuery('');
      if (vb.currentPath !== targetPath) {
        vb.setCurrentPath(targetPath);
        return;
      }
    }
    if (vb.currentPath !== targetPath) return;
    focus.phase = 'done';
    const displayId = `${VAULT_ITEM_PREFIX}${item.id}`;
    vb.replaceSelection([displayId]);
    /**
     * L'INTENTION D'OUVRIR, honorée ICI et pas ailleurs : à ce point, la liste
     * est chargée, le dossier est le bon, et l'élément existe VRAIMENT. Ouvrir
     * plus tôt reviendrait à monter l'éditeur sur un élément deviné.
     *
     * `openNote` est le MÊME chemin que le double-clic sur une carte : il tranche
     * le cadre (fenêtre ou onglet Notes) selon le droit d'écrire, puis monte
     * `VaultNoteEditor` — donc la salle collaborative, l'élection
     * d'enregistrement, le veto de lecture seule et la bannière de version plus
     * récente. Un second chemin d'ouverture serait un second éditeur, et deux
     * éditeurs divergent.
     */
    if (focus.open && vaultItemKind(item) === 'note' && !item.meta.folderMarker) {
      openNote(item.id);
    }
    // La carte n'existe dans le DOM qu'après ce rendu : une frame plus tard.
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(displayId)}"]`);
      el?.scrollIntoView({ block: 'center' });
    });
  }, [vb, openNote]);

  /**
   * Les préférences d'affichage sont celles de l'explorateur PERSONNEL — même
   * clé Redux, même bascule grille/liste, même tri. Basculer en liste dans un
   * dossier et retrouver la grille dans un coffre, ce serait exactement le
   * « à part » qu'on démonte.
   */
  const viewMode = useSelector((s: RootState) => s.ui.viewMode);
  const sortField = useSelector((s: RootState) => s.ui.sortBy.field);
  const sortOrder = useSelector((s: RootState) => s.ui.sortBy.order);
  /**
   * La préférence « clic simple = ouvrir OU détails » de l'explorateur
   * personnel — la MÊME lecture que `FolderView.handleItemClick` : un coffre
   * qui ignorerait ce réglage serait, encore, un produit à part.
   */
  const fileClickBehavior = useSelector((s: RootState) => s.ui.fileClickBehavior);
  /**
   * LE SIGNE DU COFFRE dans le fil d'Ariane (F14) — la même fusion des deux
   * portées que les cartes de l'accueil, par le même hook. Sans apparence, rien
   * ne s'affiche : le fil d'Ariane d'un coffre ordinaire ne portait pas de
   * glyphe avant la fiche, et lui en ajouter un déplacerait le nom de tous les
   * coffres du monde pour une fonction que personne n'a demandée.
   */
  // Le sélecteur sur sa propre ligne : l'ordre des hooks était stable imbriqué,
  // mais il fallait le vérifier pour s'en convaincre.
  const vaultSummary = useSelector((s: RootState) => s.vaults.vaults[vaultId]);
  const vaultAppearance = useVaultAppearance(vaultSummary);

  const [sidePanel, setSidePanel] = useState<SidePanel>(null);
  /**
   * Les sources d'un « Déplacer » lancé depuis le menu contextuel ou la barre
   * de sélection — un élément, un dossier, ou toute la sélection : le même
   * sélecteur de destination pour les trois.
   */
  const [movingSources, setMovingSources] = useState<MoveSource[] | null>(null);

  const untitled = t('teamVaults.items.untitled');

  const { folders: displayFolders, files: displayFilesUnsorted } = useMemo(
    () =>
      toVaultDisplayItems({
        allItems: vb.items,
        folderNames: vb.folders,
        visibleItems: vb.visibleItems,
        currentPath: vb.currentPath,
        untitled,
      }),
    [vb.items, vb.folders, vb.visibleItems, vb.currentPath, untitled]
  );

  /** Le tri de l'explorateur, appliqué aux cartes de coffre. */
  const displayFiles = useMemo(() => {
    const direction = sortOrder === 'asc' ? 1 : -1;
    const ext = (n: string) => (n.includes('.') ? n.split('.').pop()!.toLowerCase() : '');
    return [...displayFilesUnsorted].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = vb.collator.compare(a.name, b.name);
          break;
        case 'date':
          cmp = new Date(a.updatedAt || 0).getTime() - new Date(b.updatedAt || 0).getTime();
          break;
        case 'size':
          cmp = (a.size || 0) - (b.size || 0);
          break;
        case 'type':
          cmp = vb.collator.compare(ext(a.name), ext(b.name));
          break;
        default:
          cmp = 0;
      }
      return cmp * direction;
    });
  }, [displayFilesUnsorted, sortField, sortOrder, vb.collator]);

  const allFolderPaths = useMemo(
    () => allVaultFolderPaths(vb.items, vb.collator),
    [vb.items, vb.collator]
  );

  /**
   * LES BADGES « PARTAGÉ » DES CARTES — la donnée, pas une prop morte.
   *
   * L'agrégat du coffre (effectif + grants par élément) est demandé UNE fois à
   * l'ouverture, par le thunk qui porte lui-même sa dédup en vol et son TTL ;
   * hors nuage sa `condition` en fait un no-op. Les cartes ne font que LIRE :
   * `grantMap` est la Map mémoïsée de `selectGrantCountMap` (même référence
   * tant que rien n'a bougé), et `buildSharedCardProps` en dérive, dans un seul
   * `useMemo`, les PRIMITIVES que chaque `FileCard` reçoit et les objets
   * stables que chaque `SubfolderCard` reçoit — patron `protectionStatusMap`
   * de la vue dossier. Entre deux chargements, ce sont les actions de partage
   * (grant créé / révoqué) qui tiennent la Map à jour, donc le badge suit le
   * geste sans attendre le TTL.
   */
  useEffect(() => {
    void dispatch(loadVaultShareSummary(vaultId));
  }, [dispatch, vaultId]);
  const grantMap = useSelector((s: RootState) => selectGrantCountMap(s, vaultId));

  /**
   * LES PASTILLES DE DISCUSSION — lues dans le TAMPON, sans télécharger un fil.
   *
   * Chaque écriture de fil dépose `meta.threadStats` sur son porteur (le
   * sidecar pour un fichier, la note elle-même pour une note) : voir
   * `services/vault/threadStamp`. La méta est déjà déchiffrée ici — la Map ne
   * coûte donc pas un octet de réseau, là où compter « pour de vrai »
   * demanderait un déchiffrement de sidecar PAR LIGNE.
   *
   * Un tampon absent ou périmé donne `exact: false` : la pastille se dessine
   * sans nombre plutôt que d'avancer un chiffre que l'ouverture du fil
   * démentirait.
   */
  const threadBadgeMap = useMemo(() => threadBadges(vb.items), [vb.items]);
  const threadBadgeTitle = useCallback(
    (badge: ThreadBadge) =>
      t(threadBadgeKey(badge), {
        count: badge.open,
        defaultValue: badge.exact
          ? badge.open > 0
            ? `${badge.open} commentaire(s) ouvert(s)`
            : 'Discussion résolue'
          : 'Une discussion existe',
      }),
    [t]
  );
  const sharedCardProps = useMemo(
    () =>
      buildSharedCardProps({
        allItems: vb.items,
        files: displayFilesUnsorted,
        folders: displayFolders,
        grantMap,
        labels: {
          sharedWith: (count) =>
            t('teamVaults.shareBadge.sharedWith', {
              count,
              defaultValue: `Partagé avec ${count} personne(s)`,
            }),
          folderContains: (count) =>
            t('teamVaults.shareBadge.folderContains', {
              count,
              defaultValue: `Contient ${count} élément(s) partagé(s)`,
            }),
        },
      }),
    [vb.items, displayFilesUnsorted, displayFolders, grantMap, t]
  );

  /**
   * En recherche GLOBALE, les résultats viennent de partout. Plutôt que de
   * répéter chaque nom suivi de son chemin, on affiche les DOSSIERS d'origine
   * une seule fois : c'est la question qu'on se pose (« où ça se trouve ? »),
   * et un clic y emmène.
   */
  const resultFolders = useMemo(() => {
    if (!vb.searching) return [];
    const set = new Set<string>();
    for (const f of displayFiles) {
      const p = normalizePath(f.source.meta.path);
      if (p) set.add(p);
    }
    return [...set].sort((a, b) => vb.collator.compare(a, b));
  }, [vb.searching, vb.collator, displayFiles]);

  /**
   * LE BADGE D'ACTIVITÉ — une requête par coffre ouvert, qui nourrit à la fois
   * le compteur du bouton ET la première page du panneau (pas de double fetch).
   *
   * Le « vu » ne bouge PAS ici : il ne bouge qu'à l'OUVERTURE du panneau, sinon
   * la pastille s'éteindrait sans que rien n'ait été lu.
   */
  const [activityPage, setActivityPage] = useState<VaultActivityPage | null>(null);
  const [unseen, setUnseen] = useState(0);

  /**
   * F11 — COMBIEN DE CLÉS ONT CHANGÉ SANS ÊTRE ACQUITTÉES, à la dernière fois
   * qu'on a regardé. Aucune requête n'est faite ici : contrôler les clés de tout
   * un roster à chaque ouverture d'un dossier coûterait deux lectures par membre
   * pour un badge (§7, amplification de lecture). Le point dit donc « il y avait
   * ça la dernière fois », ce qui est l'information honnête, et la page de
   * gestion, elle, regarde pour de bon.
   *
   * ET IL SUIT LE MÊME DROIT QUE LA PAGE QU'IL DÉSIGNE. Les alertes rangées
   * sous `filarr.kt.alerts.<coffre>` appartiennent à l'APPAREIL, pas au rôle de
   * celui qui regarde : un administrateur rétrogradé — ou un second profil sur
   * la même machine — voyait donc un point rouge, cliquait sur « Gérer », et
   * tombait sur une page sans bandeau, sans colonne « Confiance » et sans le
   * moindre geste possible (`VaultSettingsView` ne contrôle rien hors gestion).
   * Un signal d'alarme qui ne mène à rien apprend à ignorer les signaux
   * d'alarme : le point n'existe donc que pour qui gère le coffre.
   */
  const keyAlerts = useVaultKeyAlertCount(vaultId, vb.isVaultAdmin);
  const myUserId = vb.myUserId;
  useEffect(() => {
    setActivityPage(null);
    setUnseen(0);
    let vivant = true;
    apiGetVaultActivity(vaultId, { limit: 50 })
      .then((p) => {
        if (!vivant) return;
        setActivityPage(p);
        if (myUserId) setUnseen(unseenCount(p.events, getSeenCursor(myUserId, vaultId)));
      })
      .catch(() => {
        /* pas de badge — le panneau reste ouvrable et dira l'erreur */
      });
    return () => {
      vivant = false;
    };
  }, [vaultId, myUserId]);

  const toggleActivity = () => {
    if (sidePanel === 'activity') {
      setSidePanel(null);
      return;
    }
    setSidePanel('activity');
    setUnseen(0);
    // « Vu jusqu'ici » = la TÊTE de la page chargée (couple occurredAt/id).
    const head = activityPage?.events[0];
    if (head && myUserId) {
      setSeenCursor(myUserId, vaultId, { occurredAt: head.occurredAt, id: head.id });
      // Le curseur vit dans localStorage, que rien n'observe : on réveille le
      // sélecteur de pastille (`selectUnseenVaultIds`) pour que la carte de
      // l'accueil s'éteigne sans attendre une relecture des têtes.
      dispatch(vaultActivitySeen(vaultId));
    }
  };

  // ── Partage : UNE porte (le dialogue unifié) ───────────────────────────────

  // Règle 13 : hors nuage, ni bouton « Partager », ni section « Partage » du
  // panneau de détails. (Un coffre n'existe pas hors nuage, mais la vue ne
  // doit pas avoir à le savoir pour tenir la règle.)
  const isCloud = useSelector((s: RootState) => s.auth.accountMode === 'cloud');
  const { open: openShare, overlays: shareOverlays, isOpen: shareOpen } = useShareDialog();

  // ── Le panneau de détails d'un élément ─────────────────────────────────────

  /**
   * On retient l'ID, pas l'objet : l'élément du store peut être renommé ou
   * remplacé pendant que le panneau est ouvert, et le panneau doit suivre. S'il
   * disparaît (supprimé, sorti de la recherche), le panneau se ferme de lui-même.
   */
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const detailsItem = useMemo(
    () => (detailsId ? (vb.items.find((i) => i.id === detailsId) ?? null) : null),
    [vb.items, detailsId]
  );
  /**
   * LE GENRE DE L'ÉLÉMENT DÉTAILLÉ — la MÊME autorité que les cartes
   * (`vaultItemKind`, la traduction de `itemType`), et le même contrat qu'elles :
   * `undefined` pour un fichier ordinaire, pour que le panneau reste exactement
   * celui de l'espace personnel.
   *
   * Sans lui, le panneau retombait sur `getFileTypeInfo(nom)` et annonçait
   * « Fichier » pour une note, avec une extension vide et un type MIME vide —
   * le défaut déjà fermé sur les cartes, au même endroit du raisonnement.
   */
  const detailsKind = detailsItem ? vaultItemKind(detailsItem) : undefined;
  const closeDetails = useCallback(() => setDetailsId(null), []);
  /** « Voir toute l'activité » depuis le panneau : une boîte, le panneau reste. */
  const [activityModalOpen, setActivityModalOpen] = useState(false);

  const memberCount = useSelector((s: RootState) => selectVaultMemberCount(s, vaultId));

  /**
   * Les grants de l'élément SÉLECTIONNÉ — UNE requête, à l'ouverture du
   * panneau et à chaque changement d'élément. `undefined` tant qu'on ne sait
   * pas : le panneau n'affiche alors pas de ligne « Partagé avec », plutôt
   * qu'un « personne » qui mentirait le temps d'un aller-retour. Le compte de
   * l'index (`grantMap`) est dans les dépendances : un grant créé ou révoqué
   * depuis le dialogue fait relire la liste sans attendre le TTL.
   */
  const [grants, setGrants] = useState<ItemGrantDTO[] | undefined>(undefined);
  const detailsGrantCount = detailsId ? (grantMap.get(detailsId) ?? 0) : 0;
  useEffect(() => {
    setGrants(undefined);
    if (!detailsId || !isCloud) return undefined;
    let vivant = true;
    void apiListItemGrants(vaultId, detailsId).then((g) => {
      if (vivant) setGrants(g);
    });
    return () => {
      vivant = false;
    };
  }, [vaultId, detailsId, isCloud, detailsGrantCount]);

  /**
   * Les noms des acteurs (userId → e-mail), lus UNE fois par coffre et
   * seulement quand un panneau de détails s'ouvre : les lignes d'activité et
   * les grants sans adresse en ont besoin, le reste de la vue non.
   *
   * LA SOURCE A CHANGÉ (P2) : le trombinoscope DU COFFRE, dont chaque ligne
   * porte désormais l'adresse, au lieu de celui de l'ESPACE, qui exigeait
   * `VIEW_MEMBERS` et répondait donc 403 à tout invité — le `catch` mémorisait
   * alors une Map vide, et le panneau n'affichait plus que des identifiants
   * tronqués pour tout le monde sauf le propriétaire de l'espace. Les acteurs
   * d'un coffre en sont membres par construction, si bien que cette lecture-là
   * suffit, et elle est ouverte à TOUS les rôles.
   */
  const [emailByUserId, setEmailByUserId] = useState<Map<string, string> | null>(null);
  useEffect(() => {
    setEmailByUserId(null);
  }, [vaultId]);
  useEffect(() => {
    /**
     * DEUX RAISONS DE LIRE LE TROMBINOSCOPE, ET LA SECONDE EST LE GEL (F23) : le
     * bandeau doit NOMMER qui a fermé le coffre, et le serveur ne rend qu'un
     * identifiant opaque. La lecture reste PARESSEUSE et mémorisée — un coffre
     * gelé la fait partir une fois, jamais à chaque rendu — et son échec ne
     * coûte que le nom : le bandeau a sa phrase sans nom.
     */
    if ((!detailsId && !vb.frozen) || !isCloud || emailByUserId !== null) return undefined;
    let vivant = true;
    void apiListVaultMembers(vaultId)
      .then((vm) => {
        if (!vivant) return;
        const map = new Map<string, string>();
        for (const m of vm) if (m.email) map.set(m.userId, m.email);
        setEmailByUserId(map);
      })
      .catch(() => {
        // Une Map vide MÉMORISÉE, pour ne pas redemander à chaque ouverture de
        // panneau ; le rendu retombe sur l'identifiant tronqué.
        if (vivant) setEmailByUserId(new Map());
      });
    return () => {
      vivant = false;
    };
  }, [detailsId, isCloud, vaultId, emailByUserId, vb.frozen]);

  /**
   * Nommer une personne quand on la connaît (F23 : le bandeau de gel). Le repli
   * est l'identifiant TRONQUÉ, comme partout dans ce dossier — c'est au bandeau
   * de décider qu'un identifiant tronqué ne vaut pas la peine d'être affiché.
   */
  const displayMember = useCallback(
    (userId: string) => emailByUserId?.get(userId) ?? userId.slice(0, 8),
    [emailByUserId]
  );

  /** Les noms des éléments du coffre, pour mettre en mots les lignes du fil. */
  const nameByItemId = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of vb.items) {
      const nom = i.meta.fileName || i.meta.title;
      if (nom) m.set(i.id, nom);
    }
    return m;
  }, [vb.items]);

  /**
   * Ce que le panneau sait du partage de l'élément. Le journal condensé vient
   * de la page d'activité DÉJÀ chargée pour le badge de l'en-tête — aucune
   * requête de plus — filtrée sur cet élément et mise en mots par le même
   * modèle que le panneau d'activité (`resolveActivityRow`), pour que les deux
   * disent la même chose du même évènement.
   */
  const detailsSharing = useMemo((): FileDetailsSharing | undefined => {
    if (!isCloud || !detailsItem) return undefined;
    const emails = emailByUserId ?? new Map<string, string>();
    const ctx = { emailByUserId: emails, nameByItemId };
    const recentActivity = activityPage
      ? eventsForVaultItem(activityPage.events, detailsItem.id, 3).map((e) => {
          const row = resolveActivityRow(e, ctx);
          const params = { ...row.params };
          if (row.unresolvedItemId) {
            params.item = `${t('teamVaults.activity.deletedItem')} (${row.unresolvedItemId.slice(0, 8)})`;
          }
          if (!params.actor) params.actor = t('teamVaults.activity.someone');
          return { text: t(row.i18nKey, params), at: e.occurredAt };
        })
      : undefined;
    const target = {
      kind: 'vaultItem' as const,
      vaultId,
      item: detailsItem,
      itemName: itemName(detailsItem, untitled),
    };
    return {
      memberCount,
      grantees: grants?.map((g) => ({
        label: g.granteeEmail ?? emails.get(g.granteeUserId) ?? g.granteeUserId.slice(0, 8),
        stale: g.stale,
      })),
      recentActivity,
      activityRecorded: activityPage ? activityPage.recorded : undefined,
      onOpenShareDialog: () => openShare(target),
      onViewActivity: () => setActivityModalOpen(true),
    };
  }, [
    isCloud,
    detailsItem,
    emailByUserId,
    nameByItemId,
    activityPage,
    vaultId,
    untitled,
    memberCount,
    grants,
    openShare,
    t,
  ]);

  // ── Sélection multiple ────────────────────────────────────────────────────

  /**
   * L'ordre AFFICHÉ — dossiers puis fichiers triés — celui que Shift+clic
   * parcourt et que Ctrl+A embrasse. En recherche globale il n'y a pas de
   * dossiers : l'ordre suit ce qui est réellement à l'écran.
   */
  const orderedIds = useMemo(
    () => [...displayFolders.map((f) => f.id), ...displayFiles.map((f) => f.id)],
    [displayFolders, displayFiles]
  );
  /** Ce qui est coché ET encore à l'écran : un élément supprimé ailleurs ne compte plus. */
  const selection = useMemo(
    () => pruneSelection(vb.selectedIds, orderedIds),
    [vb.selectedIds, orderedIds]
  );
  /** Les éléments et dossiers RÉELS derrière les ids cochés (module pur). */
  const resolved = useMemo(() => resolveSelection(selection, vb.items), [selection, vb.items]);

  /**
   * LA GRAMMAIRE DU CLIC, celle de l'explorateur personnel : clic = ouvrir,
   * Ctrl/Cmd+clic = basculer, Shift+clic = plage. Posée en phase de CAPTURE sur
   * une enveloppe autour de chaque carte, parce que les cartes (`FileCard`,
   * `SubfolderCard`) ne passent pas l'évènement à `onItemClick` — et on ne les
   * modifie pas. Un clic modifié est CONSOMMÉ ici : la carte ne l'ouvre pas.
   */
  const captureModifiedClick = useCallback(
    (e: React.MouseEvent, id: string) => {
      if (e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        vb.selectRangeTo(orderedIds, id);
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        vb.toggleSelected(id);
      }
    },
    [vb, orderedIds]
  );

  /**
   * LE LASSO — « clic gauche sur le fond puis glisser pour en prendre
   * plusieurs », le geste de l'explorateur personnel. Le hook lit les cartes
   * par leur `data-item-id` (posé par `FileCard` et `SubfolderCard` : ce sont
   * déjà les identifiants d'AFFICHAGE préfixés), ne démarre jamais sur une
   * carte ni sur une zone `[data-no-rubber-band]`, gère le Ctrl+glisser
   * additif, et livre la liste finale d'un coup — qui REMPLACE la sélection.
   * Un clic sur le fond sans glisser la vide, comme dans la vue dossier.
   * Suspendu pendant un lot en vol (les cartes bougent) et dans la corbeille.
   */
  const contentContainerRef = useRef<HTMLDivElement>(null);
  const lassoSelection = useMemo(() => [...selection], [selection]);
  const { rectRef: rubberBandRectRef, handlers: rubberBandHandlers } = useRubberBandSelection({
    containerRef: contentContainerRef,
    currentSelection: lassoSelection,
    onSelectionChange: vb.replaceSelection,
    enabled: !vb.folderOp && !vb.showTrash,
  });

  /**
   * Ce que la sélection PEUT — la même matrice que les menus, appliquée au lot.
   * Une action absente est retirée de la barre, pas grisée. Le partage par
   * personne est un geste d'ADMIN et n'existe qu'en nuage (règle 13).
   */
  const selectionCanMove = vb.canEdit && !vb.searching && !vb.folderOp;
  // `roleCanEdit` et NON `canEdit` : la politique d'org « les lecteurs ne
  // téléchargent pas » est une affaire de RÔLE. La brancher sur `canEdit`, qui
  // porte désormais le gel (F23), retirerait le téléchargement aux membres d'un
  // coffre archivé — c'est-à-dire l'inverse de ce que geler promet.
  const selectionCanDownload =
    resolved.items.length > 0 && !(vb.restrictDownload && !vb.roleCanEdit);
  // `!vb.frozen` comme dans `vaultFileCaps.shareWithPerson` : sceller un accès
  // ponctuel est une ÉCRITURE (`POST .../grants` porte `blockWhenFrozen`), et la
  // barre de sélection doit dire la même chose que le menu contextuel.
  const selectionCanShare =
    isCloud && vb.isVaultAdmin && !vb.frozen && resolved.allFiles.length > 0;
  const selectionCanDelete = vb.canEdit && !vb.folderOp;

  const moveSelection = () => {
    if (resolved.moveSources.length > 0) setMovingSources(resolved.moveSources);
  };
  /** Les DOSSIERS cochés ne se téléchargent pas (pas d'octets) — la barre et le hook le disent. */
  const downloadSelection = () => void vb.handleDownloadMany(resolved.items);
  /** Le plan est calculé AU CLIC : la matrice s'applique avant le geste. */
  const deleteSelection = () =>
    vb.requestDeleteSelection(planSelectionDelete(vb.items, resolved, vb.canDelete));
  /** Toute la sélection — dossiers résolus en fichiers — vers UNE personne. */
  const shareSelection = () =>
    openShare(
      {
        kind: 'vaultItems',
        vaultId,
        items: resolved.allFiles,
        name: t('teamVaults.selection.shareName', {
          count: resolved.allFiles.length,
          defaultValue: '{{count}} items',
        }),
        // Le choix des éléments se groupe par sous-dossier RELATIF au dossier
        // qu'on regarde ; en recherche globale, pas de base : le préfixe commun.
        basePath: vb.searching ? undefined : vb.currentPath,
      },
      { initialFocus: 'invite' }
    );
  /** « Partager le dossier avec une personne… » : ses descendants, fichiers seulement. */
  const shareFolderWithPerson = (folder: VaultDisplayFolder) =>
    openShare(
      {
        kind: 'vaultItems',
        vaultId,
        items: folderDescendantFiles(vb.items, folder.path),
        name: folder.name,
        basePath: folder.path,
      },
      { initialFocus: 'invite' }
    );

  /**
   * Le menu contextuel d'une SÉLECTION : quand le clic droit tombe sur un
   * élément coché (et qu'il n'est pas seul), les actions portent sur le lot —
   * comme dans l'explorateur personnel. Les mêmes gestes que la barre.
   */
  const buildSelectionMenu = (): ContextMenuItem[] => {
    const menu: ContextMenuItem[] = [
      {
        label: t('teamVaults.selection.count', {
          count: selection.size,
          defaultValue: '{{count}} selected',
        }),
        disabled: true,
      },
      { divider: true },
    ];
    if (selectionCanDownload) {
      menu.push({
        label: t('teamVaults.selection.download', 'Download'),
        icon: <DownloadIcon />,
        onClick: downloadSelection,
      });
    }
    if (selectionCanMove) {
      menu.push({
        label: t('teamVaults.selection.move', 'Move'),
        icon: <MoveIcon />,
        onClick: moveSelection,
      });
    }
    if (selectionCanCopy) {
      menu.push({
        label: t('teamVaults.selection.duplicate', 'Duplicate here'),
        icon: <CopyIcon />,
        onClick: copySelection,
      });
    }
    if (selectionCanShare) {
      menu.push({ divider: true });
      menu.push({
        label: t('teamVaults.selection.shareWithPerson', 'Share with a person…'),
        icon: <PersonShareIcon />,
        onClick: shareSelection,
      });
    }
    if (selectionCanDelete) {
      menu.push({ divider: true });
      menu.push({
        label: t('teamVaults.selection.delete', 'Delete'),
        icon: <DeleteIcon />,
        danger: true,
        onClick: deleteSelection,
      });
    }
    menu.push({ divider: true });
    menu.push({ label: t('teamVaults.selection.clear', 'Clear'), onClick: vb.clearSelection });
    return menu;
  };

  const headerSort = useCallback(
    (field: SortOption) =>
      dispatch(
        setSortBy({
          field,
          order: sortField === field && sortOrder === 'asc' ? 'desc' : 'asc',
        })
      ),
    [dispatch, sortField, sortOrder]
  );

  // ── Gestes ────────────────────────────────────────────────────────────────

  /** Ouvrir un élément : le geste de clic simple, comme dans la vue dossier. */
  const openFile = useCallback(
    (file: VaultDisplayFile) => {
      const item = file.source;
      // Une note : c'est `openNote` qui décide du cadre (fenêtre pour qui
      // consulte, onglet Notes pour qui rédige) — jamais cette fonction.
      if (item.itemType === 'note') {
        openNote(item.id);
        return;
      }
      // Trop gros pour un éditeur : on retombe sur l'aperçu, qui sait fenêtrer.
      const editeur = editorForFileName(itemName(item, ''));
      if (editeur !== null && editorAcceptsSize(editeur, item.sizeBytes)) {
        vb.setPluginEditing(item);
        return;
      }
      void vb.handlePreview(item);
    },
    // `vb` change à chaque rendu (objet recréé) : on dépend de l'objet entier
    // plutôt que de mentir sur des membres qui ne sont pas mémoïsés.
    [vb, openNote]
  );

  /**
   * Le CLIC SIMPLE sur un fichier suit la préférence de l'explorateur
   * personnel : « détails » ouvre le panneau, « ouvrir » ouvre — le double-clic
   * ouvre TOUJOURS, quelle que soit la préférence (même règle que la vue
   * dossier). Un marqueur n'arrive jamais ici (jamais affiché).
   */
  const clickFile = useCallback(
    (file: VaultDisplayFile) => {
      if (fileClickBehavior === 'details') {
        setDetailsId(file.source.id);
        return;
      }
      openFile(file);
    },
    [fileClickBehavior, openFile]
  );

  const startDragFile = (e: React.DragEvent, file: VaultDisplayFile) => {
    if (!vb.canEdit || vb.folderOp || vb.searching) return;
    e.dataTransfer.setData(DND_TYPE, JSON.stringify({ kind: 'item', id: file.source.id }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const startDragFolder = (e: React.DragEvent, folder: VaultDisplayFolder) => {
    if (!vb.canEdit || vb.folderOp) return;
    e.dataTransfer.setData(DND_TYPE, JSON.stringify({ kind: 'folder', path: folder.path }));
    e.dataTransfer.effectAllowed = 'move';
  };

  /** Le drop sur une TUILE de dossier — même chemin que le drop sur un segment. */
  const folderDropHandlers = (path: string) => vb.folderDragProps(path);

  const confirmMove = async (dest: string) => {
    const sources = movingSources;
    setMovingSources(null);
    if (!sources || sources.length === 0) return;
    await vb.submitMove(sources, dest);
    // Ce qui vient de partir n'est plus à l'écran : la sélection se vide.
    vb.clearSelection();
  };

  // ── Menus contextuels ─────────────────────────────────────────────────────

  const capsContext: VaultCapsContext = useMemo(
    () => ({
      role: vb.role,
      myUserId: vb.myUserId,
      restrictDownload: vb.restrictDownload,
      externalSharesDisabled: vb.externalSharesDisabled,
      searching: vb.searching,
      // Le réglage de coffre « supprimer est réservé aux administrateurs »
      // (F13) : la matrice du menu doit le connaître, sinon l'écran proposerait
      // « Supprimer » et sa confirmation pour récolter un `setting_forbidden`.
      itemDeleteRequiresAdmin: vb.itemDeleteRequiresAdmin,
      // L'ÉLÉMENT ÉPINGLÉ (F27) : la matrice choisit entre « Épingler » et
      // « Ne plus épingler ». Les deux entrées sont exclusives, et proposer les
      // deux ferait choisir entre un geste et son contraire sur le même objet.
      pinnedItemId: pin.pinnedItemId,
      // LE GEL (F23) : le serveur refuse les écritures de CONTENU d'un coffre
      // gelé (409 `vault_frozen`). Sans lui ici, le menu proposerait
      // « Renommer », « Déplacer » et « Supprimer » avec leurs confirmations,
      // pour récolter un refus au dernier moment — sur un coffre dont le
      // bandeau vient pourtant d'annoncer qu'il est en lecture seule.
      frozen: vb.frozen,
    }),
    [
      vb.role,
      vb.myUserId,
      vb.restrictDownload,
      vb.externalSharesDisabled,
      vb.searching,
      vb.itemDeleteRequiresAdmin,
      vb.frozen,
      pin.pinnedItemId,
    ]
  );

  /**
   * LES GESTIONNAIRES D'UN ÉLÉMENT, écrits UNE fois : le menu contextuel et la
   * barre de sélection (un seul élément coché) appellent les MÊMES fermetures.
   * Deux listes de gestionnaires, c'eût été deux façons de « renommer ».
   */
  const fileHandlersFor = (item: VaultItemSummary): ItemMenuHandlers => ({
    // « Ouvrir » : la MÊME décision que le double-clic (`openNote`). La capacité
    // `vaultFileCaps.open` n'existe que sur une note, ce gestionnaire n'est donc
    // jamais posé sur autre chose.
    onOpen: () => openNote(item.id),
    onOpenInEditor: () => vb.setPluginEditing(item),
    onPreview: () => void vb.handlePreview(item),
    onDownload: () => void vb.handleDownload(item),
    onRename: () => vb.setRenaming({ item, draft: itemName(item, '') }),
    onReplace: () => vb.startReplace(item),
    onMove: () => setMovingSources([{ kind: 'item', id: item.id }]),
    onVersions: () => vb.setHistoryId(item.id),
    onDetails: () => setDetailsId(item.id),
    // UNE porte vers le partage : le dialogue unifié. « Partager avec une
    // personne » est le même dialogue, la main déjà sur le champ ; seul le
    // lien public garde son raccourci direct (une boîte à un seul geste).
    onManageAccess: () =>
      openShare({ kind: 'vaultItem', vaultId, item, itemName: itemName(item, untitled) }),
    onShareWithPerson: () =>
      openShare(
        { kind: 'vaultItem', vaultId, item, itemName: itemName(item, untitled) },
        { initialFocus: 'invite' }
      ),
    onShare: () => vb.setSharing(item),
    /**
     * ÉPINGLER / DÉSÉPINGLER (F27). Le geste écrit le bloc scellé des réglages
     * par LE MÊME chemin que la description (`useVaultPin`) : plan partiel,
     * champs inconnus portés, scellé sous l'époque courante, compare-and-set.
     * L'élément, lui, ne bouge pas d'un pixel — l'épingle le DÉSIGNE.
     */
    // MES FAVORIS (★) : l'hôte choisit le sens en ne posant qu'UN des deux
    // gestionnaires — c'est ainsi que le menu décide entre « Ajouter » et
    // « Retirer », sur le même patron que pin / unpin.
    ...(fav.isFavorite(item.id)
      ? { onUnfavorite: () => void fav.toggle(item.id) }
      : { onFavorite: () => void fav.toggle(item.id) }),
    onPin: () => void pin.setPinned(item.id),
    onUnpin: () => void pin.setPinned(undefined),
    onDelete: () => vb.setToDelete(item),
  });

  const folderHandlersFor = (folder: VaultDisplayFolder): ItemMenuHandlers => ({
    onOpen: () => vb.setCurrentPath(folder.path),
    onRename: () => vb.setFolderRenaming({ path: folder.path, draft: folder.name }),
    onMove: () => setMovingSources([{ kind: 'folder', path: folder.path }]),
    onShareWithPerson: () => shareFolderWithPerson(folder),
    // Le plan (et sa matrice de droits) est calculé AU CLIC : rien de
    // supprimable se dit, au lieu d'ouvrir une modale morte.
    onDelete: () => vb.requestDeleteFolder(folder.path),
  });

  /**
   * LES GESTES UNITAIRES DE LA BARRE — quand UN SEUL élément est coché : les
   * mêmes capacités que son menu contextuel (`vaultFileCaps` /
   * `vaultFolderCaps`), les mêmes gestionnaires. Une capacité absente de la
   * matrice est absente de la barre — pas grisée.
   */
  const soleFile = selection.size === 1 && resolved.items.length === 1 ? resolved.items[0] : null;
  const soleFolder =
    selection.size === 1 && resolved.folderPaths.length === 1
      ? (displayFolders.find((f) => f.path === resolved.folderPaths[0]) ?? null)
      : null;
  const soleFileCaps: ItemMenuCapabilities | null = soleFile
    ? vaultFileCaps(soleFile, capsContext, editorForFileName(itemName(soleFile, '')) !== null)
    : null;
  const soleFolderCaps: ItemMenuCapabilities | null = soleFolder
    ? vaultFolderCaps(capsContext)
    : null;
  const soleDisplayFile = soleFile
    ? (displayFiles.find((f) => f.source.id === soleFile.id) ?? null)
    : null;
  const unitActions = {
    // « Ouvrir » : la note dans son éditeur, le fichier dans son greffon ou
    // l'aperçu — exactement le geste du clic (`openFile`) ; le dossier s'entre.
    onOpen: soleDisplayFile
      ? soleFileCaps && (soleFileCaps.open || soleFileCaps.openInEditor || soleFileCaps.preview)
        ? () => openFile(soleDisplayFile)
        : undefined
      : soleFolder && soleFolderCaps?.open
        ? folderHandlersFor(soleFolder).onOpen
        : undefined,
    onRename: soleFile
      ? soleFileCaps?.rename
        ? fileHandlersFor(soleFile).onRename
        : undefined
      : soleFolder && soleFolderCaps?.rename
        ? folderHandlersFor(soleFolder).onRename
        : undefined,
    // Détails, historique, accès, lien : des gestes de FICHIER — un dossier de
    // coffre n'a ni ligne serveur ni versions.
    onDetails: soleFile && soleFileCaps?.details ? fileHandlersFor(soleFile).onDetails : undefined,
    onVersions:
      soleFile && soleFileCaps?.versions ? fileHandlersFor(soleFile).onVersions : undefined,
    // Règle 13 : hors nuage, ni « Gérer l'accès » ni lien public.
    onManageAccess:
      isCloud && soleFile && soleFileCaps?.manageAccess
        ? fileHandlersFor(soleFile).onManageAccess
        : undefined,
    onShareLink:
      isCloud && soleFile && soleFileCaps?.share ? fileHandlersFor(soleFile).onShare : undefined,
  };

  /**
   * « Dupliquer ici » — fichiers seulement, dossiers exclus et dits (le
   * bouton le porte en infobulle). Capacité = celle d'écrire ; le plan est
   * calculé AU CLIC. Le coût est celui d'un envoi (relecture, re-chiffrement,
   * quota) : le hook applique la même garde que l'envoi.
   */
  const selectionCanCopy = vb.canEdit && !vb.folderOp && !vb.uploading && resolved.items.length > 0;
  const copySelection = () => void vb.duplicateItems(planDuplicate(resolved));

  const openFileMenu = useCallback(
    (e: React.MouseEvent, file: VaultDisplayFile) => {
      // Clic droit sur un élément COCHÉ, parmi d'autres : le menu est celui du lot.
      if (selection.size > 1 && selection.has(file.id)) {
        openContextMenu(e, buildSelectionMenu());
        return;
      }
      const item = file.source;
      const hasPluginEditor = editorForFileName(itemName(item, '')) !== null;
      const caps: ItemMenuCapabilities = vaultFileCaps(item, capsContext, hasPluginEditor);
      openContextMenu(e, buildItemContextMenu(file, caps, fileHandlersFor(item), t));
    },
    [capsContext, openContextMenu, t, selection, buildSelectionMenu, fileHandlersFor]
  );

  const openFolderMenu = useCallback(
    (e: React.MouseEvent, folder: VaultDisplayFolder) => {
      // Clic droit sur un dossier COCHÉ, parmi d'autres : le menu est celui du lot.
      if (selection.size > 1 && selection.has(folder.id)) {
        openContextMenu(e, buildSelectionMenu());
        return;
      }
      const base = vaultFolderCaps(capsContext);
      // Règle 13 : hors nuage, le partage par personne n'existe pas.
      const caps: ItemMenuCapabilities = {
        ...base,
        shareWithPerson: isCloud && base.shareWithPerson,
      };
      const handlers = folderHandlersFor(folder);
      const onShareWithPerson = handlers.onShareWithPerson;
      // Le builder ne connaît qu'un libellé pour ce geste ; sur un dossier il
      // doit dire de quoi il retourne (« le dossier », pas « l'élément »). On
      // reconnaît l'entrée par son gestionnaire, jamais par son texte.
      const menu = buildItemContextMenu(folder, caps, handlers, t).map((m) =>
        m.onClick === onShareWithPerson
          ? {
              ...m,
              label: t('teamVaults.selection.shareFolderWithPerson', 'Share folder with a person…'),
            }
          : m
      );
      openContextMenu(e, menu);
    },
    [capsContext, openContextMenu, t, isCloud, selection, buildSelectionMenu, folderHandlersFor]
  );

  const openBackgroundMenu = (e: React.MouseEvent) => {
    if (e.defaultPrevented) return;
    openContextMenu(
      e,
      buildBackgroundContextMenu(
        { newFolder: vb.canEdit, addFiles: vb.canEdit },
        {
          onNewFolder: () => vb.setNewFolder({ draft: '' }),
          onAddFiles: vb.openFilePicker,
        },
        t
      )
    );
  };

  // ── Clavier : Échap vide la sélection, Ctrl/Cmd+A prend tout ─────────────

  /**
   * Suspendu dès qu'un recouvrement tient le clavier (modale, éditeur,
   * dialogue de partage, panneau de détails) — sinon Échap viderait la
   * sélection derrière la boîte qu'on croyait fermer, et Ctrl+A cocherait
   * l'écran pendant qu'on sélectionne du texte dans l'éditeur. Même règle que
   * l'explorateur personnel. (Avant le retour anticipé : c'est un hook.)
   */
  const anyOverlayOpen =
    !!vb.editingItem ||
    !!vb.historyItem ||
    !!vb.pluginEditing ||
    shareOpen ||
    !!vb.preview ||
    !!vb.replaceConflict ||
    !!vb.renaming ||
    !!vb.newFolder ||
    !!vb.newDoc ||
    !!vb.folderRenaming ||
    !!movingSources ||
    !!vb.folderToDelete ||
    !!vb.toDelete ||
    !!vb.selectionToDelete ||
    !!detailsItem ||
    activityModalOpen ||
    !!vb.sharing;
  useEffect(() => {
    const isEditableTarget = (el: EventTarget | null): boolean => {
      const node = el as HTMLElement | null;
      if (!node) return false;
      const tag = node.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if (anyOverlayOpen || vb.showTrash || isEditableTarget(e.target)) return;
      if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) {
        if (orderedIds.length === 0) return;
        e.preventDefault();
        vb.selectAll(orderedIds);
        return;
      }
      if (e.key === 'Escape' && selection.size > 0) {
        e.preventDefault();
        vb.clearSelection();
        return;
      }
      // Suppr/Retour = supprimer la sélection ; F2 = renommer l'élément seul —
      // les raccourcis de l'explorateur personnel, sous les mêmes capacités
      // que la barre (une action absente de la barre l'est aussi au clavier).
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection.size > 0) {
        if (!selectionCanDelete) return;
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (e.key === 'F2' && unitActions.onRename) {
        e.preventDefault();
        unitActions.onRename();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    anyOverlayOpen,
    orderedIds,
    selection.size,
    vb,
    selectionCanDelete,
    deleteSelection,
    unitActions.onRename,
  ]);

  // ── Écran verrouillé / époque dépassée ────────────────────────────────────

  if (!vb.unlocked) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-3">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="w-12 h-12 text-[var(--color-text-tertiary)]"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 0h10.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H6.75a1.5 1.5 0 0 1-1.5-1.5v-6a1.5 1.5 0 0 1 1.5-1.5Z"
          />
        </svg>
        <h3 className="text-base font-semibold text-[var(--color-text-primary)] m-0">
          {t(vb.staleEpoch ? 'teamVaults.staleEpochTitle' : 'teamVaults.lockedTitle')}
        </h3>
        <p className="text-sm text-[var(--color-text-secondary)] max-w-sm m-0">
          {t(vb.staleEpoch ? 'teamVaults.staleEpochHint' : 'teamVaults.lockedHint')}
        </p>
        <Button variant="secondary" size="sm" onClick={() => dispatch(loadVaults())}>
          {t('teamVaults.retry')}
        </Button>
      </div>
    );
  }

  const goUp = () => {
    if (vb.currentPath !== '') {
      vb.setCurrentPath(parentOf(vb.currentPath));
      return;
    }
    if (onExit) onExit();
    else navigate('/');
  };

  const backTarget = vb.currentPath === '' ? null : parentOf(vb.currentPath);

  return (
    <div
      className={`flex flex-col h-full bg-[var(--color-background-secondary)] overflow-hidden relative
        ${vb.dragOver ? 'ring-2 ring-inset ring-[var(--color-primary-500,#3b82f6)]' : ''}`}
      onDragOver={(e) => {
        if (!vb.canEdit || vb.uploading) return;
        if (e.dataTransfer.types.includes(DND_TYPE)) return;
        e.preventDefault();
        vb.setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        vb.setDragOver(false);
      }}
      onDrop={vb.handleDrop}
    >
      {vb.dragOver && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none bg-[var(--color-surface)]/80">
          <p className="text-sm font-semibold text-[var(--color-text-primary)] m-0">
            {t('teamVaults.items.dropHere')}
          </p>
        </div>
      )}

      {/* Les deux entrées de fichier cachées — envoi et remplacement. */}
      <input
        type="file"
        multiple
        ref={vb.fileInputRef}
        className="hidden"
        onChange={vb.handleFilePicked}
        aria-hidden="true"
      />
      <input
        type="file"
        ref={vb.replaceInputRef}
        className="hidden"
        onChange={vb.handleReplacePicked}
        aria-hidden="true"
      />

      {/* ===== En-tête — la coque partagée avec la vue dossier ===== */}
      <ExplorerHeader
        onBack={goUp}
        backLabel={
          vb.currentPath === ''
            ? t('teamVaults.explorer.backToVaults', 'Tous les coffres')
            : t('common.back', 'Retour')
        }
        onBackDragOver={backTarget === null ? undefined : folderDropHandlers(backTarget).onDragOver}
        onBackDragLeave={
          backTarget === null ? undefined : folderDropHandlers(backTarget).onDragLeave
        }
        onBackDrop={backTarget === null ? undefined : folderDropHandlers(backTarget).onDrop}
        backDropActive={backTarget !== null && vb.hoverFolder === backTarget}
        breadcrumb={
          <nav
            aria-label={t('teamVaults.folders.root')}
            className="flex items-center gap-1.5 min-w-0 text-sm"
          >
            <button
              type="button"
              onClick={() => vb.setCurrentPath('')}
              {...vb.folderDragProps('')}
              className={`border-none bg-transparent cursor-pointer px-1.5 py-0.5 rounded truncate max-w-[220px] inline-flex items-center gap-1.5
                ${vb.hoverFolder === '' && vb.currentPath !== '' ? 'ring-2 ring-[var(--color-primary-400)]' : ''}
                ${vb.currentPath === '' ? 'font-semibold text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
            >
              {vaultAppearance && (
                <VaultGlyph appearance={vaultAppearance} className="w-4 h-4 text-base shrink-0" />
              )}
              {vb.vaultName || t('teamVaults.locked')}
            </button>
            <VaultBreadcrumbBadge
              label={t('teamVaults.explorer.sharedBadge', 'Partagé')}
              title={t(`teamVaults.role.${vb.role}`, vb.role)}
            />
            {vb.currentPath !== '' &&
              vb.currentPath.split('/').map((seg, k, segs) => {
                const target = segs.slice(0, k + 1).join('/');
                const last = k === segs.length - 1;
                return (
                  <React.Fragment key={target}>
                    <span className="text-[var(--color-text-tertiary)]">/</span>
                    <button
                      type="button"
                      onClick={() => vb.setCurrentPath(target)}
                      {...vb.folderDragProps(target)}
                      className={`border-none bg-transparent cursor-pointer px-1.5 py-0.5 rounded truncate max-w-[180px]
                        ${vb.hoverFolder === target && !last ? 'ring-2 ring-[var(--color-primary-400)]' : ''}
                        ${last ? 'font-semibold text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
                    >
                      {seg}
                    </button>
                  </React.Fragment>
                );
              })}
            {vb.folderOp && (
              <span className="ml-2 text-xs text-[var(--color-text-tertiary)] whitespace-nowrap">
                {t('teamVaults.folders.moving', {
                  done: vb.folderOp.done,
                  total: vb.folderOp.total,
                })}
              </span>
            )}
            {/* F27 — LA DESCRIPTION COURTE, À LA RACINE SEULEMENT. Elle dit ce
                qu'est CE coffre ; la répéter au fond d'un sous-dossier
                n'apprendrait plus rien et volerait la place du chemin. Tronquée
                sur une ligne, avec un plafond de largeur : un texte de 280
                signes pousserait sinon les boutons de la barre hors de l'écran
                — c'est-à-dire exactement le débordement horizontal que la fiche
                voisine (F28) existe pour empêcher. Absente : rien du tout, pas
                un séparateur orphelin. */}
            {vb.currentPath === '' && description && (
              <>
                <span className="text-[var(--color-text-tertiary)]">·</span>
                <span
                  className="truncate max-w-[280px] text-xs text-[var(--color-text-tertiary)]"
                  title={description}
                >
                  {description}
                </span>
              </>
            )}
          </nav>
        }
        actions={
          <>
            {/* La JAUGE avant l'envoi — connue avant d'avoir chiffré quoi que ce soit. */}
            {vb.quota && vb.quota.limit > 0 && (
              <span
                className="text-[11px] text-[var(--color-text-tertiary)] whitespace-nowrap mr-1"
                title={t('teamVaults.items.quotaTitle')}
              >
                {t('teamVaults.items.quotaGauge', {
                  used: formatBytes(vb.quota.used),
                  limit: formatBytes(vb.quota.limit),
                })}
              </span>
            )}
            {vb.canEdit ? (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<UploadIcon />}
                  loading={vb.uploading}
                  disabled={vb.uploading || !!vb.folderOp}
                  onClick={vb.openFilePicker}
                >
                  {vb.uploading ? t('teamVaults.items.uploading') : t('file.upload', 'Upload')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<FolderPlusIcon />}
                  disabled={vb.uploading || !!vb.folderOp}
                  onClick={() => vb.setNewFolder({ draft: '' })}
                >
                  {t('home.newFolder', 'Nouveau dossier')}
                </Button>
                <Dropdown
                  position="bottom-right"
                  disabled={vb.uploading || !!vb.folderOp}
                  trigger={
                    <Button
                      variant="secondary"
                      size="sm"
                      leftIcon={<DocumentPlusIcon />}
                      disabled={vb.uploading || !!vb.folderOp}
                    >
                      {t('folder.newDocument', 'Nouveau document')}
                    </Button>
                  }
                  items={
                    vb.documentFormats.length === 0
                      ? [{ label: t('teamVaults.items.noEditorInstalled'), disabled: true }]
                      : vb.documentFormats.map((f) => ({
                          label: `${f.displayName} (.${f.ext})`,
                          onClick: () =>
                            vb.setNewDoc({ ext: f.ext, displayName: f.displayName, draft: '' }),
                        }))
                  }
                />
              </>
            ) : (
              <span className="text-xs text-[var(--color-text-tertiary)]">
                {t('teamVaults.items.readOnly')}
              </span>
            )}
            {/* « Partager » : LA porte vers le partage du coffre — inviter, la
                liste d'accès, le lien, au même endroit (dialogue unifié). */}
            {isCloud && (
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<ShareIcon />}
                onClick={() => openShare({ kind: 'vault', vaultId })}
              >
                {t('teamVaults.explorer.share', 'Share')}
              </Button>
            )}
            {/* « Gérer » QUITTE l'explorateur pour la page du coffre (membres,
                invitations, activité, danger). Le volet de 380 pixels qui
                s'ouvrait ici comprimait un tableau de cinq colonnes et n'avait
                de place ni pour les invitations ni pour la fiche d'identité ;
                « Partager » reste la porte RAPIDE, celle-ci est la complète. */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(vaultFolderRoute(vaultId, { view: 'settings' }))}
            >
              {t('teamVaults.settings.manage')}
              {/* Un POINT, pas un compteur : le nombre exact n'ajoute rien ici,
                  et il n'y a qu'une conduite à tenir — aller voir. Il porte son
                  propre libellé accessible, sinon le bouton se lit « Gérer »
                  aux deux états.

                  ET IL PORTE `role="img"`, sans quoi ce libellé n'existe pas :
                  ARIA n'autorise pas à nommer un élément générique, et un
                  `<span>` nu en est un — le lecteur d'écran laissait donc tomber
                  l'`aria-label`, exactement le silence qu'on voulait éviter.
                  C'est la convention d'`Avatar` et de `SharedBadge`. */}
              {keyAlerts > 0 && (
                <span
                  className="ml-1.5 inline-block w-2 h-2 rounded-full align-middle bg-[var(--color-error-500,#ef4444)]"
                  role="img"
                  aria-label={t('teamVaults.settings.trust.banner.title', { count: keyAlerts })}
                />
              )}
            </Button>
            <Button
              variant={sidePanel === 'activity' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={toggleActivity}
            >
              {t('teamVaults.viewTab.activity')}
              {unseen > 0 && sidePanel !== 'activity' && (
                <span
                  className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold bg-[var(--color-primary-600,#2563eb)] text-white"
                  aria-label={t('teamVaults.activity.unseenBadge', { count: unseen })}
                >
                  {unseen >= 50 ? '50+' : unseen}
                </span>
              )}
            </Button>
            <Button
              variant={vb.showTrash ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => vb.setShowTrash((v) => !v)}
            >
              {t('teamVaults.trash.open')}
            </Button>
          </>
        }
      />

      {/* ===== LE GEL (F23) — au-dessus de tout, sous l'en-tête =====
          Les boutons « Envoyer », « Nouveau dossier » et « Nouveau document »
          viennent de disparaître au profit du texte « Lecture seule » : sans ce
          bandeau, un membre lit ce mot-là sans savoir POURQUOI, et conclut à un
          rôle rétrogradé ou à une panne. Il est visible pour TOUS les rôles, y
          compris les lecteurs — le fait ne dépend pas de ce qu'on a le droit de
          faire, et un lecteur qui voit ses collègues cesser d'écrire mérite la
          même explication. */}
      {vb.frozen && (
        <div className="px-6 pt-3">
          <VaultFrozenBanner
            frozenAt={vb.frozenAt}
            frozenBy={vb.frozenBy}
            display={displayMember}
          />
        </div>
      )}

      {/* ===== Barre de tri / recherche / affichage ===== */}
      <div className="flex items-center justify-between gap-3 px-6 py-2.5 bg-[var(--color-surface)] border-b border-[var(--color-border-light)] shrink-0">
        <div className="flex-1 max-w-[400px]">
          <div className="relative">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-tertiary)] pointer-events-none"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
              />
            </svg>
            <input
              {...searchFieldProps('filarr-vault-search', t('teamVaults.items.searchPlaceholder'))}
              value={vb.query}
              onChange={(e) => vb.setQuery(e.target.value)}
              placeholder={t('teamVaults.items.searchPlaceholder')}
              aria-label={t('teamVaults.items.searchPlaceholder')}
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-[var(--color-background-secondary)]
                border border-transparent text-sm text-[var(--color-text-primary)]
                placeholder:text-[var(--color-text-tertiary)]
                focus:bg-[var(--color-surface)] focus:border-[var(--color-primary-300)]
                focus:ring-1 focus:ring-[var(--color-primary-300)] focus:outline-none transition-all"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Dropdown
            position="bottom-right"
            trigger={
              <Button variant="ghost" size="sm">
                {t('sort.sortBy')}: {t(`sort.${sortField}`, sortField)}
              </Button>
            }
            items={(['name', 'date', 'size', 'type'] as SortOption[]).map((field) => ({
              label: t(`sort.${field}`, field),
              onClick: () => dispatch(setSortBy({ field, order: sortOrder })),
            }))}
          />
          <button
            type="button"
            onClick={() =>
              dispatch(setSortBy({ field: sortField, order: sortOrder === 'asc' ? 'desc' : 'asc' }))
            }
            className="p-1.5 rounded-md text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]
              hover:bg-[var(--color-background-secondary)] transition-colors"
            title={sortOrder === 'asc' ? t('sort.ascending') : t('sort.descending')}
          >
            {sortOrder === 'asc' ? <SortAscIcon /> : <SortDescIcon />}
          </button>
          <div className="w-px h-5 bg-[var(--color-border)]" />
          <div className="flex items-center bg-[var(--color-background-secondary)] border border-[var(--color-border)] rounded-lg p-0.5">
            {(['list', 'grid'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => dispatch(setViewMode(mode))}
                aria-label={mode === 'list' ? t('sort.listView') : t('sort.gridView')}
                className={`p-1.5 rounded-md transition-all duration-150 ${
                  viewMode === mode
                    ? 'bg-[var(--color-primary-50)] text-[var(--color-primary-600)] shadow-sm'
                    : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
                }`}
              >
                {mode === 'list' ? <ListIcon /> : <GridIcon />}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ===== Bandeaux d'état ===== */}
      {vb.uploadProgress && (
        <div className="px-6 py-1.5 text-xs text-[var(--color-text-secondary)] bg-[var(--color-surface)] border-b border-[var(--color-border-light)]">
          {t('teamVaults.items.uploadingCount', {
            done: vb.uploadProgress.done,
            total: vb.uploadProgress.total,
          })}
        </div>
      )}

      {vb.decryptStatus && vb.decryptStatus.undecryptable > 0 && (
        <div className="px-6 py-2 text-xs text-[var(--color-warning-700,#b45309)] bg-[var(--color-warning-50,#fffbeb)] border-b border-[var(--color-border-light)]">
          {vb.decryptStatus.historyAvailable
            ? t('teamVaults.decryptWarning', { count: vb.decryptStatus.undecryptable })
            : t('teamVaults.decryptTransient')}
        </div>
      )}

      {/* Le BANDEAU DE REPRISE : un lot interrompu n'est pas une panne —
          l'état intermédiaire est visible, et la reprise recalcule son plan
          depuis le store frais. Persistant jusqu'à convergence. */}
      {vb.folderPartial && !vb.showTrash && (
        <div
          role="alert"
          className="px-6 py-2 flex items-center justify-between gap-2 text-xs border-b border-[var(--color-border-light)]"
          style={{ color: 'var(--color-warning-700)', backgroundColor: 'var(--color-warning-50)' }}
        >
          <span>
            {t(
              vb.folderPartial.op === 'delete'
                ? 'teamVaults.folders.deletePartial'
                : 'teamVaults.folders.partial',
              { done: vb.folderPartial.done, total: vb.folderPartial.total }
            )}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              size="sm"
              variant="secondary"
              disabled={!!vb.folderOp}
              onClick={() => void vb.resumeFolderPartial()}
            >
              {t('teamVaults.folders.resume')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => vb.setFolderPartial(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}

      {/* ===== Contenu ===== */}
      <div className="flex flex-1 min-h-0">
        {/* Le conteneur du LASSO : `relative` pour que le rectangle se
            positionne dans son défilement, `onMouseDown` pour le démarrer sur
            le fond — jamais sur une carte, le hook s'en assure. */}
        <div
          ref={contentContainerRef}
          className="flex-1 overflow-y-auto px-6 py-6 min-w-0 relative"
          onContextMenu={openBackgroundMenu}
          onMouseDown={rubberBandHandlers.onMouseDown}
        >
          {/* Le rectangle de sélection — stylé par le hook en DOM direct, même
              rendu que la vue dossier. */}
          <div
            ref={rubberBandRectRef}
            className="absolute border-2 border-[var(--color-primary-400)] pointer-events-none z-20 rounded-sm"
            style={{
              display: 'none',
              left: 0,
              top: 0,
              willChange: 'transform, width, height',
              backgroundColor: 'var(--color-primary-400)',
              opacity: 0.1,
            }}
          />
          {!vb.showTrash && !vb.searching && fav.ordered.length > 0 && (
            <section
              aria-label={t('teamVaults.favorites.title')}
              className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3"
            >
              <p className="m-0 mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
                ★ {t('teamVaults.favorites.title')}
              </p>
              <div className="flex flex-wrap gap-2">
                {fav.ordered.map((id) => {
                  const item = vb.items.find((i) => i.id === id);
                  // Un favori dont l'élément n'est plus listé (corbeille, purge,
                  // clé d'époque perdue) ne s'affiche pas : la liste d'un coffre
                  // ne prouve la disparition de personne, on n'invente rien.
                  if (!item || item.meta.folderMarker) return null;
                  return (
                    <button
                      key={id}
                      type="button"
                      className="max-w-[16rem] truncate rounded-full border border-[var(--color-border)] bg-[var(--color-background-secondary)] px-3 py-1 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-background-tertiary)] cursor-pointer"
                      title={itemName(item, untitled)}
                      onClick={() =>
                        item.itemType === 'note' ? openNote(item.id) : void vb.handlePreview(item)
                      }
                    >
                      {itemName(item, untitled)}
                    </button>
                  );
                })}
              </div>
            </section>
          )}
          {vb.showTrash ? (
            <VaultTrashPane vb={vb} />
          ) : displayFolders.length === 0 && displayFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] shadow-sm">
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
              <h2 className="text-lg font-medium text-[var(--color-text-primary)] mb-2">
                {vb.loading
                  ? t('common.loading')
                  : vb.searching
                    ? t('teamVaults.items.noMatch', { query: vb.query })
                    : t('teamVaults.items.empty')}
              </h2>
              {!vb.searching && vb.canEdit && !vb.loading && (
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<UploadIcon />}
                  onClick={vb.openFilePicker}
                >
                  {t('file.upload', 'Upload')}
                </Button>
              )}
            </div>
          ) : (
            <>
              {displayFolders.length > 0 && (
                <section className="mb-6">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-3">
                    {t('settings.folders', 'Dossiers')}
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {displayFolders.map((folder) => (
                      // L'enveloppe porte la grammaire de sélection (capture) et
                      // l'anneau « coché » : `SubfolderCard` n'a pas d'état
                      // sélectionné, et on ne la modifie pas.
                      <div
                        key={folder.id}
                        data-selected={selection.has(folder.id) || undefined}
                        onClickCapture={(e) => captureModifiedClick(e, folder.id)}
                        className={`rounded-xl ${
                          selection.has(folder.id)
                            ? 'ring-2 ring-[var(--color-primary-400)] ring-offset-1 ring-offset-[var(--color-background-secondary)]'
                            : ''
                        }`}
                      >
                        <SubfolderCard
                          subfolder={folder}
                          onItemClick={(f) => vb.setCurrentPath(f.path)}
                          onContextMenu={openFolderMenu}
                          onDragStart={startDragFolder}
                          onDragEnd={() => vb.setHoverFolder(null)}
                          onDragOver={(e) => folderDropHandlers(folder.path).onDragOver(e)}
                          onDragEnter={(e) => folderDropHandlers(folder.path).onDragOver(e)}
                          onDragLeave={() => folderDropHandlers(folder.path).onDragLeave()}
                          onDrop={(e) => folderDropHandlers(folder.path).onDrop(e)}
                          isDropTarget={vb.hoverFolder === folder.path}
                          isDragging={false}
                          // Le dossier ENGAGÉ dans le lot en cours est gelé : le
                          // renommé pendant un renommage, la destination pendant
                          // un déplacement. Dans les deux cas, y entrer au milieu
                          // de N PATCH montrerait un arbre à moitié écrit.
                          isMoving={!!vb.folderOp && vb.folderOp.path === folder.path}
                          sharedRollup={sharedCardProps.byFolderId.get(folder.id)}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {displayFiles.length > 0 && (
                <section>
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)] mb-3">
                    {t('settings.files', 'Fichiers')}
                  </h2>
                  {/* En recherche GLOBALE, les résultats viennent de partout :
                      les dossiers d'origine sont dits UNE fois, et cliquables —
                      « où ça se trouve » est la question, pas « quel nom ». */}
                  {resultFolders.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap mb-3">
                      {resultFolders.map((p) => (
                        <button
                          key={`res:${p}`}
                          type="button"
                          onClick={() => {
                            vb.setQuery('');
                            vb.setCurrentPath(p);
                          }}
                          className="px-2 py-0.5 rounded-full text-[11px] border border-[var(--color-border)]
                            bg-[var(--color-surface)] cursor-pointer text-[var(--color-text-secondary)]
                            hover:text-[var(--color-text-primary)] hover:border-[var(--color-primary-300)]"
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  )}
                  {viewMode === 'grid' ? (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
                      {displayFiles.map((file) => (
                        <VaultFileCard
                          key={file.id}
                          file={file}
                          viewMode={viewMode}
                          isSelected={selection.has(file.id)}
                          onSelect={vb.toggleSelected}
                          onModifiedClick={captureModifiedClick}
                          onClick={clickFile}
                          onOpen={openFile}
                          onContextMenu={openFileMenu}
                          onDragStart={startDragFile}
                          draggable={vb.canEdit && !vb.folderOp && !vb.searching}
                          sharedCount={sharedCardProps.byFileId.get(file.id)?.sharedCount}
                          sharedTitle={sharedCardProps.byFileId.get(file.id)?.sharedTitle}
                          thread={threadBadgeMap.get(idFromItemId(file.id)) ?? null}
                          threadTitle={threadBadgeTitle}
                          favorite={fav.ids.has(file.source.id)}
                          favoriteTitle={favoriteTitle}
                          mentionCount={mentionPins.get(file.source.id)}
                          mentionTitle={mentionTitle}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col rounded-xl border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface)] shadow-sm">
                      {/* Les MÊMES colonnes que la vue dossier — sans en-tête,
                          les cellules d'une ligne ne veulent rien dire. */}
                      <div
                        className="grid grid-cols-[40px_40px_1fr_100px_160px_48px] items-center px-4 py-2.5
                          bg-[var(--color-background-secondary)] border-b border-[var(--color-border)]
                          text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider"
                      >
                        <div />
                        <div />
                        <button
                          type="button"
                          onClick={() => headerSort('name')}
                          className="flex items-center gap-1 text-left uppercase tracking-wider border-none bg-transparent cursor-pointer text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
                        >
                          {t('sort.name')}
                          {sortField === 'name' && <span>{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                        </button>
                        <button
                          type="button"
                          onClick={() => headerSort('size')}
                          className="flex items-center gap-1 text-left uppercase tracking-wider border-none bg-transparent cursor-pointer text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
                        >
                          {t('sort.size')}
                          {sortField === 'size' && <span>{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                        </button>
                        <button
                          type="button"
                          onClick={() => headerSort('date')}
                          className="flex items-center gap-1 text-left uppercase tracking-wider border-none bg-transparent cursor-pointer text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
                        >
                          {t('sort.date')}
                          {sortField === 'date' && <span>{sortOrder === 'asc' ? '▲' : '▼'}</span>}
                        </button>
                        <div />
                      </div>
                      {displayFiles.map((file) => (
                        <VaultFileCard
                          key={file.id}
                          file={file}
                          viewMode={viewMode}
                          isSelected={selection.has(file.id)}
                          onSelect={vb.toggleSelected}
                          onModifiedClick={captureModifiedClick}
                          onClick={clickFile}
                          onOpen={openFile}
                          onContextMenu={openFileMenu}
                          onDragStart={startDragFile}
                          draggable={vb.canEdit && !vb.folderOp && !vb.searching}
                          sharedCount={sharedCardProps.byFileId.get(file.id)?.sharedCount}
                          sharedTitle={sharedCardProps.byFileId.get(file.id)?.sharedTitle}
                          thread={threadBadgeMap.get(idFromItemId(file.id)) ?? null}
                          threadTitle={threadBadgeTitle}
                          favorite={fav.ids.has(file.source.id)}
                          favoriteTitle={favoriteTitle}
                          mentionCount={mentionPins.get(file.source.id)}
                          mentionTitle={mentionTitle}
                        />
                      ))}
                    </div>
                  )}
                </section>
              )}
            </>
          )}

          {/* La BARRE DE SÉLECTION — flottante, collée en bas du contenu, sur le
              patron de l'explorateur perso. Les actions absentes sont celles
              que la matrice retire ; pendant un lot en vol, elle dit où il en est. */}
          {!vb.showTrash && (
            <VaultSelectionBar
              selectedCount={selection.size}
              totalCount={orderedIds.length}
              folderCount={resolved.folderPaths.length}
              progress={
                vb.downloadProgress
                  ? {
                      ...vb.downloadProgress,
                      label: t('teamVaults.selection.downloading', 'Downloading'),
                    }
                  : vb.duplicateProgress
                    ? {
                        ...vb.duplicateProgress,
                        label: t('teamVaults.selection.duplicating', 'Duplicating'),
                      }
                    : vb.folderOp
                      ? {
                          done: vb.folderOp.done,
                          total: vb.folderOp.total,
                          label: t('teamVaults.selection.working', 'Working'),
                        }
                      : null
              }
              onSelectAll={() => vb.selectAll(orderedIds)}
              onDeselectAll={vb.clearSelection}
              onOpen={unitActions.onOpen}
              onRename={unitActions.onRename}
              onDetails={unitActions.onDetails}
              onVersions={unitActions.onVersions}
              onManageAccess={unitActions.onManageAccess}
              onShareLink={unitActions.onShareLink}
              onMove={selectionCanMove ? moveSelection : undefined}
              onCopy={selectionCanCopy ? copySelection : undefined}
              onDownload={selectionCanDownload ? downloadSelection : undefined}
              onShareWithPerson={selectionCanShare ? shareSelection : undefined}
              onDelete={selectionCanDelete ? deleteSelection : undefined}
            />
          )}
        </div>

        {/* Le PANNEAU DE DÉTAILS — celui de la vue dossier, dans la même
            rangée, avec un adaptateur minimal (id PRÉFIXÉ, jamais de clé
            `items`) : ni tags ni mot de passe (`hideTags`), et la section
            « Partage » nourrie par l'index, les grants et le fil du coffre. */}
        {detailsItem && (
          <FileDetailsPanel
            item={toVaultDetailsItem(detailsItem, untitled)}
            folderId=""
            onClose={closeDetails}
            hideTags
            sharing={detailsSharing}
            kind={detailsKind === 'file' ? undefined : detailsKind}
          />
        )}

        {/* Le PANNEAU LATÉRAL : le fil, sans quitter le contenu. */}
        {sidePanel && (
          <aside className="w-[380px] shrink-0 border-l border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col min-h-0">
            <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-[var(--color-border-light)] shrink-0">
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)] m-0">
                {t('teamVaults.viewTab.activity')}
              </h2>
              <Button variant="ghost" size="sm" onClick={() => setSidePanel(null)}>
                {t('common.close')}
              </Button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <VaultActivityPanel vaultId={vaultId} initialPage={activityPage} />
            </div>
          </aside>
        )}
      </div>

      {contextMenu.isOpen && (
        <ContextMenu
          items={contextMenu.items}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
        />
      )}

      {/* ===== Les modales — toutes pilotées par le hook ===== */}
      {vb.editingItem && (
        <VaultNoteEditor
          isOpen
          onClose={() => vb.setEditingId(null)}
          vaultId={vaultId}
          item={vb.editingItem}
          canEdit={vb.canEdit}
          role={vb.role}
        />
      )}

      {vb.historyItem && (
        <VaultItemHistory
          isOpen
          onClose={() => vb.setHistoryId(null)}
          vaultId={vaultId}
          itemId={vb.historyItem.id}
          currentVersion={vb.historyItem.version}
          canEdit={vb.canEdit}
          onRestored={() => dispatch(loadVaultItems({ vaultId }))}
        />
      )}

      {/* UN GREFFON QUI TOMBE NE PREND PAS LE COFFRE AVEC LUI.
          Le code d'un greffon est du code qu'on héberge sans le contrôler —
          y compris nos builtins : une collision de noms de types Yjs a suffi
          à faire remonter une exception SYNCHRONE du montage jusqu'à
          l'ErrorBoundary de la route, qui a remplacé l'explorateur entier par
          « Erreur dans le Coffre partagé » pour un seul fichier qu'on
          n'arrivait pas à ouvrir. La barrière est donc ici, au plus près :
          on perd la fenêtre d'édition, jamais la page. Le repli DIT quoi
          faire — c'est déjà le texte du bac à sable, qui promet la bonne
          chose (les données du coffre sont intactes). */}
      {vb.pluginEditing && (
        <ErrorBoundary
          // Une barrière retient son erreur pour toujours : sans clé par
          // élément, un fichier qui a planté condamnerait le SUIVANT à
          // s'ouvrir sur le repli. (Fermer suffit déjà — la barrière est
          // démontée — mais passer d'un élément à l'autre ne repasse pas
          // forcément par là.)
          key={vb.pluginEditing.id}
          fallback={
            <Modal isOpen onClose={() => vb.setPluginEditing(null)} size="md">
              <ModalHeader onClose={() => vb.setPluginEditing(null)}>
                {itemName(vb.pluginEditing, untitled)}
              </ModalHeader>
              <ModalBody>
                <p className="text-sm text-[var(--color-text-secondary)] m-0">
                  {t('teamVaults.pluginEditor.sandboxCrashed')}
                </p>
              </ModalBody>
            </Modal>
          }
        >
          <PluginEditorModal
            vaultId={vaultId}
            item={vb.pluginEditing}
            fileName={itemName(vb.pluginEditing, untitled)}
            provider={editorForFileName(itemName(vb.pluginEditing, ''))!}
            canEdit={vb.canEdit}
            role={vb.role}
            onClose={() => vb.setPluginEditing(null)}
            onSaved={() => void vb.load()}
          />
        </ErrorBoundary>
      )}

      {/* Le dialogue de partage unifié (cartes, en-tête, panneau de détails)
          — une seule instance, montée ici. Le partage par personne y vit :
          plus de ShareItemToPersonModal à part. */}
      {shareOverlays}

      {/* « Voir toute l'activité » depuis le panneau de détails : la même page
          que le badge (pas de double fetch), le panneau de détails reste. */}
      {activityModalOpen && (
        <Modal
          isOpen
          onClose={() => setActivityModalOpen(false)}
          title={t('teamVaults.viewTab.activity')}
          size="lg"
        >
          <ModalBody>
            <VaultActivityPanel vaultId={vaultId} initialPage={activityPage} />
          </ModalBody>
        </Modal>
      )}

      {vb.sharing && (
        <VaultShareModal
          vaultId={vaultId}
          item={vb.sharing}
          fileName={itemName(vb.sharing, untitled)}
          onClose={() => vb.setSharing(null)}
        />
      )}

      {vb.preview && (
        <Modal isOpen onClose={() => vb.setPreview(null)} size="xl">
          <ModalHeader onClose={() => vb.setPreview(null)}>
            {itemName(vb.preview.item, untitled)}
          </ModalHeader>
          <ModalBody>
            <div className="h-[70vh] min-h-[320px]">
              {vb.preview.error ? (
                <p className="text-sm text-[var(--color-error-600,#dc2626)] m-0">
                  {t('teamVaults.preview.failed')}
                </p>
              ) : vb.preview.data === null ? (
                <p className="text-sm text-[var(--color-text-secondary)] m-0">
                  {t('common.loading')}
                </p>
              ) : (
                <BufferPreview
                  data={vb.preview.data}
                  fileName={itemName(vb.preview.item, 'fichier')}
                />
              )}
            </div>
            {vb.preview.item.itemType === 'file' && (
              <VaultFileThreadPanel
                vaultId={vaultId}
                file={vb.preview.item}
                items={vb.items}
                canEdit={vb.canEdit}
                onWrote={() => void vb.load()}
              />
            )}
          </ModalBody>
        </Modal>
      )}

      {/* Le conflit de remplacement : trois issues, aucune perte silencieuse. */}
      {vb.replaceConflict && (
        <ConfirmModal
          isOpen
          onClose={() => vb.setReplaceConflict(null)}
          onConfirm={vb.conflictOverwrite}
          title={t('teamVaults.items.conflictTitle')}
          message={
            vb.replaceConflict.conflict.serverItem
              ? t('teamVaults.items.conflictBody', {
                  name: itemName(vb.replaceConflict.conflict.serverItem, untitled),
                })
              : t('teamVaults.items.conflictBodyGone')
          }
          confirmText={t('teamVaults.items.conflictOverwrite')}
          variant="danger"
          extraActions={[
            { label: t('teamVaults.items.conflictKeepBoth'), onClick: vb.conflictKeepBoth },
            ...(vb.replaceConflict.conflict.serverItem
              ? [
                  {
                    label: t('teamVaults.items.conflictDownloadTheirs'),
                    onClick: vb.conflictDownloadTheirs,
                  },
                ]
              : []),
          ]}
        />
      )}

      {vb.renaming && (
        <PromptModal
          isOpen
          onClose={vb.guardedClose(() => vb.setRenaming(null))}
          onSubmit={(valeur) => vb.runDialogSubmit(() => vb.submitRename(valeur))}
          title={t('teamVaults.items.renameTitle')}
          label={t('teamVaults.items.renameTitle')}
          defaultValue={vb.renaming.draft}
          submitText={t('teamVaults.items.rename')}
          cancelText={t('common.cancel')}
        />
      )}

      {vb.newFolder && (
        <PromptModal
          isOpen
          onClose={vb.guardedClose(() => vb.setNewFolder(null))}
          onSubmit={(valeur) => vb.runDialogSubmit(() => vb.submitNewFolder(valeur))}
          title={t('teamVaults.folders.newFolderTitle')}
          label={t('teamVaults.folders.newFolderTitle')}
          placeholder={t('teamVaults.folders.namePlaceholder')}
          defaultValue={vb.newFolder.draft}
          submitText={t('teamVaults.folders.newFolder')}
          cancelText={t('common.cancel')}
        />
      )}

      {vb.newDoc && (
        <PromptModal
          isOpen
          onClose={vb.guardedClose(() => vb.setNewDoc(null))}
          onSubmit={(valeur) => vb.runDialogSubmit(() => vb.submitNewDoc(valeur))}
          title={t('teamVaults.items.newDocumentTitle', { editor: vb.newDoc.displayName })}
          label={t('teamVaults.items.newDocumentTitle', { editor: vb.newDoc.displayName })}
          placeholder={t('teamVaults.items.newDocumentPlaceholder', { ext: vb.newDoc.ext })}
          defaultValue={vb.newDoc.draft}
          submitText={t('teamVaults.items.newDocumentCreate')}
          cancelText={t('common.cancel')}
        />
      )}

      {vb.folderRenaming && (
        <PromptModal
          isOpen
          onClose={vb.guardedClose(() => vb.setFolderRenaming(null))}
          onSubmit={(valeur) =>
            vb.runDialogSubmit(() => vb.submitFolderRename(vb.folderRenaming!.path, valeur))
          }
          title={t('teamVaults.folders.renameTitle')}
          label={t('teamVaults.folders.renameTitle')}
          defaultValue={vb.folderRenaming.draft}
          submitText={t('teamVaults.folders.rename')}
          cancelText={t('common.cancel')}
        />
      )}

      {/* « Déplacer » depuis le menu contextuel : le glisser-déposer reste le
          geste principal, mais il n'existe pas au clavier — et une cible hors
          du dossier courant ne se survole pas. Les destinations sont les
          dossiers RÉELS du coffre (préfixes implicites + marqueurs). */}
      {movingSources && (
        <Modal isOpen onClose={() => setMovingSources(null)} size="md">
          <ModalHeader onClose={() => setMovingSources(null)}>
            {movingSources.length > 1
              ? t('teamVaults.selection.moveMany', {
                  count: movingSources.length,
                  defaultValue: 'Move {{count}} items',
                })
              : t('contextMenu.move', 'Déplacer')}
          </ModalHeader>
          <ModalBody>
            <ul className="list-none m-0 p-0 max-h-[50vh] overflow-y-auto space-y-0.5">
              {['', ...allFolderPaths].map((path) => {
                // Une cible interdite est ABSENTE, pas grisée : déposer un
                // dossier dans lui-même (ou l'un de ses descendants) n'est pas
                // une option à comprendre — pour un lot, il suffit qu'UN des
                // dossiers cochés l'interdise.
                if (
                  movingSources.some((s) => s.kind === 'folder' && isDescendantOrSelf(path, s.path))
                ) {
                  return null;
                }
                return (
                  <li key={`dest:${path || '/'}`}>
                    <button
                      type="button"
                      onClick={() => void confirmMove(path)}
                      className="w-full text-left px-3 py-2 rounded-lg text-sm border-none bg-transparent cursor-pointer
                        text-[var(--color-text-primary)] hover:bg-[var(--color-hover-overlay)]"
                    >
                      {path === '' ? t('teamVaults.folders.root') : path}
                    </button>
                  </li>
                );
              })}
            </ul>
          </ModalBody>
        </Modal>
      )}

      <ConfirmModal
        isOpen={vb.folderToDelete !== null}
        onClose={() => vb.setFolderToDelete(null)}
        onConfirm={() => void vb.confirmDeleteFolder()}
        title={t('teamVaults.folders.deleteTitle')}
        message={
          vb.folderToDelete
            ? `${t(
                // LA DURÉE VIENT DU COFFRE (F20), elle n'est plus de trente jours
                // pour tout le monde : promettre un mois sur un coffre réglé à
                // sept ferait compter sur une récupération déjà passée. Et quand
                // les réglages n'ont PAS été lus, on n'en cite aucune plutôt
                // qu'une plausible et fausse.
                vb.trashRetentionDays === null
                  ? 'teamVaults.folders.deleteRecursiveConfirmNoDuration'
                  : 'teamVaults.folders.deleteRecursiveConfirm',
                {
                  name: lastSegment(vb.folderToDelete.path),
                  count: vb.folderToDelete.plan.totalContent,
                  days: vb.trashRetentionDays,
                }
              )}${
                vb.folderToDelete.plan.skippedContent + vb.folderToDelete.plan.skippedMarkers > 0
                  ? ` ${t('teamVaults.folders.deleteRecursiveSkipped', {
                      count:
                        vb.folderToDelete.plan.skippedContent +
                        vb.folderToDelete.plan.skippedMarkers,
                    })}`
                  : ''
              }`
            : ''
        }
        confirmText={t('teamVaults.items.delete')}
        variant="danger"
      />

      {/* Supprimer une SÉLECTION : la confirmation dit combien partent et
          combien la matrice a refusés — élément par élément, jamais un 403. */}
      <ConfirmModal
        isOpen={vb.selectionToDelete !== null}
        onClose={() => vb.setSelectionToDelete(null)}
        onConfirm={() => void vb.confirmDeleteSelection()}
        title={t('teamVaults.selection.deleteTitle', 'Delete the selection')}
        message={
          vb.selectionToDelete
            ? `${t(
                // Même règle qu'au-dessus : une durée non lue ne se remplace pas
                // par le défaut, elle se tait.
                vb.trashRetentionDays === null
                  ? 'teamVaults.selection.deleteConfirmNoDuration'
                  : 'teamVaults.selection.deleteConfirm',
                {
                  count: vb.selectionToDelete.totalContent - vb.selectionToDelete.skipped,
                  days: vb.trashRetentionDays,
                }
              )}${
                vb.selectionToDelete.skipped > 0
                  ? ` ${t('teamVaults.folders.deleteRecursiveSkipped', {
                      count: vb.selectionToDelete.skipped,
                    })}`
                  : ''
              }`
            : ''
        }
        confirmText={t('teamVaults.items.delete')}
        variant="danger"
      />

      <ConfirmModal
        isOpen={vb.toDelete !== null}
        onClose={() => vb.setToDelete(null)}
        onConfirm={vb.confirmDelete}
        title={t('teamVaults.items.deleteTitle')}
        message={t('teamVaults.items.deleteConfirm', {
          name: vb.toDelete ? itemName(vb.toDelete, untitled) : '',
        })}
        confirmText={t('teamVaults.items.delete')}
        variant="danger"
      />
    </div>
  );
};

/**
 * La carte d'un fichier de coffre — `FileCard` telle quelle, sans `folderId`.
 *
 * L'ABSENCE de `folderId` est délibérée : c'est ce qui empêche la carte d'aller
 * lire le contenu sur le disque personnel pour en tirer une vignette. Un
 * élément de coffre n'existe pas là-bas, et l'y chercher ferait N lectures
 * vouées à l'échec. La carte retombe sur l'icône déduite du nom.
 */
const VaultFileCard: React.FC<{
  file: VaultDisplayFile;
  viewMode: ViewMode;
  isSelected: boolean;
  draggable: boolean;
  onSelect: (id: string) => void;
  /** Le clic simple — suit la préférence « ouvrir / détails » de l'explorateur perso. */
  onClick: (file: VaultDisplayFile) => void;
  /** Le double-clic — ouvre TOUJOURS. */
  onOpen: (file: VaultDisplayFile) => void;
  onContextMenu: (e: React.MouseEvent, file: VaultDisplayFile) => void;
  onDragStart: (e: React.DragEvent, file: VaultDisplayFile) => void;
  /** Le badge « partagé avec N personnes » — deux primitives, voir `FileCardProps`. */
  sharedCount?: number;
  sharedTitle?: string;
  /**
   * La pastille de DISCUSSION, telle que le tampon la donne (`threadStamp`).
   * `null` = aucun fil sur cet élément, donc aucune pastille.
   */
  thread?: ThreadBadge | null;
  /** L'infobulle, résolue par l'hôte qui a `t` — trois phrases, pas une. */
  threadTitle?: (badge: ThreadBadge) => string;
  /** Dans MES favoris (★). */
  favorite?: boolean;
  favoriteTitle?: string;
  /** Mentions NON LUES qui me visent ici, et leur infobulle. */
  mentionCount?: number;
  mentionTitle?: (n: number) => string;
  /**
   * Ctrl/Cmd+clic et Shift+clic, interceptés en phase de CAPTURE avant que la
   * carte n'ouvre l'élément — `FileCard` ne transmet pas l'évènement à
   * `onItemClick`, et on ne la modifie pas. L'enveloppe est `display: contents`
   * : aucune boîte de plus, la carte reste l'enfant direct de la grille.
   */
  onModifiedClick?: (e: React.MouseEvent, id: string) => void;
}> = ({
  file,
  viewMode,
  isSelected,
  draggable,
  onSelect,
  onClick,
  onOpen,
  onContextMenu,
  onDragStart,
  sharedCount,
  sharedTitle,
  thread,
  threadTitle,
  favorite,
  favoriteTitle,
  mentionCount,
  mentionTitle,
  onModifiedClick,
}) => (
  <div
    className="contents"
    onClickCapture={onModifiedClick ? (e) => onModifiedClick(e, file.id) : undefined}
  >
    <FileCard
      item={file}
      viewMode={viewMode}
      isSelected={isSelected}
      onSelect={onSelect}
      onItemClick={onClick}
      onItemDoubleClick={onOpen}
      onContextMenu={onContextMenu}
      onDragStart={draggable ? onDragStart : undefined}
      tags={EMPTY_TAGS}
      sharedCount={sharedCount}
      sharedTitle={sharedTitle}
      commentOpen={thread ? thread.open : undefined}
      commentExact={thread ? thread.exact : undefined}
      commentTitle={thread && threadTitle ? threadTitle(thread) : undefined}
      favorite={favorite}
      favoriteTitle={favoriteTitle}
      mentionCount={mentionCount}
      mentionTitle={mentionCount && mentionTitle ? mentionTitle(mentionCount) : undefined}
      /* LE GENRE, dans les deux vues. Une note de coffre n'a pas d'extension :
         sans lui, « Compte rendu » et « Contrat » rendaient la même carte, et on
         ne les distinguait qu'en les ouvrant. `undefined` pour un fichier —
         la carte reste alors exactement celle de l'espace personnel. */
      kind={file.kind === 'file' ? undefined : file.kind}
    />
  </div>
);

/**
 * La CORBEILLE d'éléments du coffre — restauration à trente jours.
 *
 * Elle reste dans le corps de l'explorateur (et non dans une modale) pour la
 * même raison que le reste : c'est un état de la même vue, pas un ailleurs.
 * (À ne pas confondre avec `VaultTrash`, qui est la corbeille des COFFRES
 * eux-mêmes, au pied du rail.)
 */
const VaultTrashPane: React.FC<{ vb: ReturnType<typeof useVaultBrowser> }> = ({ vb }) => {
  const { t } = useTranslation();
  /**
   * L'élément dont on demande la DESTRUCTION définitive (F20). L'identifiant, pas
   * l'objet : la ligne peut disparaître de la liste sous la modale (une purge
   * faite ailleurs, une restauration), et garder l'objet ferait confirmer un
   * geste sur quelque chose qui n'est plus là.
   */
  const [toPurge, setToPurge] = useState<string | null>(null);
  if (vb.trashError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 p-2">
        <p className="text-sm text-[var(--color-text-primary)] m-0">
          {t(vaultErrorKey(vb.trashError, 'teamVaults.errors.trashLoad'))}
        </p>
        <Button size="sm" variant="secondary" onClick={() => void vb.loadTrash()}>
          {t('teamVaults.retry')}
        </Button>
      </div>
    );
  }
  if (vb.trash === null) {
    return (
      <p className="text-sm text-[var(--color-text-tertiary)] p-2 m-0">{t('common.loading')}</p>
    );
  }
  if (vb.trash.length === 0) {
    return (
      <p className="text-sm text-[var(--color-text-tertiary)] p-2 m-0">
        {t('teamVaults.trash.empty')}
      </p>
    );
  }
  return (
    <>
      <p className="text-xs text-[var(--color-text-tertiary)] px-2 mb-2 mt-0">
        {/* La durée non lue se tait plutôt que de promettre le défaut (F20). */}
        {vb.trashRetentionDays === null
          ? t('teamVaults.trash.hintNoDuration')
          : t('teamVaults.trash.hint', { count: vb.trashRetentionDays })}
      </p>
      <ul className="list-none m-0 p-0 space-y-0.5">
        {vb.trash.map((it) => (
          <li
            key={it.id}
            className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)]"
          >
            <div className="min-w-0">
              <p className="text-sm text-[var(--color-text-primary)] m-0 truncate">
                {vb.trashMeta[it.id]?.name ??
                  `${vb.trashKindLabel(it)} · ${formatBytes(it.sizeBytes)}`}
              </p>
              {vb.trashMeta[it.id]?.name && (
                <p className="text-xs text-[var(--color-text-tertiary)] m-0">
                  {vb.trashKindLabel(it)} · {formatBytes(it.sizeBytes)}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {vb.canRestore(it) && (
                <Button size="sm" variant="secondary" onClick={() => void vb.restoreItem(it.id)}>
                  {t('teamVaults.trash.restore')}
                </Button>
              )}
              {/* DÉTRUIRE POUR DE BON (F20) — propriétaire seulement, comme la
                  route. Sans lui, « supprimer » ne voulait pas dire supprimer :
                  l'élément quittait la liste mais ses octets restaient un mois de
                  plus sur le serveur, et quelqu'un qui venait de déposer le
                  mauvais document n'avait aucun recours avant l'échéance. */}
              {vb.canPurge && (
                <Button size="sm" variant="danger" onClick={() => setToPurge(it.id)}>
                  {t('teamVaults.trash.purgeItem')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <ConfirmModal
        isOpen={toPurge !== null}
        onClose={() => setToPurge(null)}
        onConfirm={() => {
          const cible = toPurge;
          setToPurge(null);
          if (cible) void vb.purgeItem(cible);
        }}
        title={t('teamVaults.trash.purgeItemTitle')}
        message={t('teamVaults.trash.purgeItemConfirm')}
        confirmText={t('teamVaults.trash.purgeItem')}
        variant="danger"
      />
    </>
  );
};

export default VaultFolderView;
