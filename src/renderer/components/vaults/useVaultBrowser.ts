/**
 * useVaultBrowser — TOUTE la logique métier d'un coffre partagé, sortie de
 * `VaultItemBrowser` et rendue réutilisable.
 *
 * POURQUOI CE FICHIER EXISTE. Le coffre partagé doit se rendre comme
 * l'explorateur ordinaire (`VaultFolderView`) — mêmes cartes, même en-tête,
 * même clic droit. Mais tout ce qui décide de ce qu'on a le droit de faire vit
 * dans `VaultItemBrowser` : la matrice `canDelete` recopiée du serveur, le gel
 * des écritures pour un lecteur, la jauge de quota consultée AVANT de lire le
 * fichier, le refus des dossiers de l'OS au dépôt, le bandeau de reprise d'un
 * lot interrompu, les trois issues d'un 409, l'écran d'époque dépassée. Écrire
 * une seconde vue par-dessus une copie de cette logique, c'était garantir que
 * les deux divergent — et qu'un garde-fou soit corrigé d'un seul côté.
 *
 * LE CHOIX (option A). La logique est DÉPLACÉE ici, et `VaultItemBrowser`
 * la consomme : il n'en reste que le JSX. Il n'existe donc toujours qu'UNE
 * copie de chaque règle, et les deux surfaces (l'ancienne liste, le nouvel
 * explorateur) ne peuvent pas se contredire.
 *
 * CE QUI N'EST PAS ICI. La crypto : elle vit dans `vaultsSlice`
 * (addVaultItem / updateVaultItem / moveVaultItems / deleteVaultItems /
 * downloadVaultItemContent) et dans `services/vault/*`. Ce hook n'orchestre
 * que des thunks existants et le module pur `vaultPaths`.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { useNotification } from '../ui/Notification';
import type { AppDispatch, RootState } from '../../../store';
import {
  loadVaultItems,
  updateVaultItem,
  addVaultItem,
  deleteVaultItem,
  downloadVaultItemContent,
  renameVaultItem,
  moveVaultItems,
  deleteVaultItems,
  isVaultItemConflict,
  type VaultItemConflict,
  selectVaultItems,
  selectVaultDecryptStatus,
  selectIsVaultUnlocked,
  selectVaultById,
  vaultFreezeState,
  type VaultItemSummary,
  type VaultItemKind,
} from '../../../store/slices/vaultsSlice';
import { findThreadItem } from '../../../services/vault/fileThread';
import {
  editorForFileName,
  registeredEditorExtensions,
} from '../../../services/plugins/pluginRegistry';
import { registerBuiltinPlugins } from '../../../plugins/registerBuiltins';
import { ensureInstalledPluginsLoaded } from '../../../services/plugins/installedPlugins';
import {
  selectExternalSharesDisabledByOrg,
  selectRestrictDownloadByOrg,
} from '../../../store/slices/governanceSlice';
import { vaultErrorKey } from '../../../services/vault/vaultErrorMessages';
import {
  normalizeFolderName,
  normalizePath,
  joinPath,
  parentOf,
  isDescendantOrSelf,
  planFolderDelete,
  type FolderDeletePlan,
  deriveFolders,
  sortFoldersFirst,
  planFolderRename,
  planMoveInto,
  type MoveSource,
} from '../../../services/vault/vaultPaths';
import { decryptItemMetaSafe } from '../../../services/vault/itemNameResolver';
import {
  canDeleteVaultItem,
  canEditVault,
  canRestoreVaultItem,
  isVaultAdminRole,
} from './vaultExplorerModel';
import { useVaultSettings } from './settings/useVaultSettings';
import { freezeStateFromVault } from './settings/vaultManagementModel';
import {
  toggleSelection,
  extendSelectionWithRange,
  selectAllIds,
  type SelectionDeletePlan,
} from './vaultSelection';
import {
  duplicateMeta,
  duplicateSourceName,
  takenNamesIn,
  type DuplicatePlan,
} from './vaultDuplicate';
import { NON_LOCAL_MAX_FILE_SIZE, MAX_PREVIEW_FILE_SIZE } from '../../../constants/limits';
import {
  apiGetVault,
  apiGetVaultSeats,
  apiListDeletedVaultItems,
  apiPurgeVaultItem,
  apiRestoreVaultItem,
  type ServerVaultItemDTO,
} from '../../../services/vault/vaultApi';

/**
 * Le code que le serveur a nommé, extrait de l'erreur remontée par le thunk.
 *
 * Les refus de cet écran se réduisaient à une phrase unique chacun : un espace
 * gelé, un quota mutualisé plein, un plan d'hôte arrêté, un rôle insuffisant et
 * une panne réseau disaient tous « Impossible d'ajouter le fichier ». Le serveur
 * nomme pourtant chacun d'eux.
 */
export function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e ?? '');
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function itemName(item: VaultItemSummary, untitled: string): string {
  return item.meta.fileName || item.meta.title || untitled;
}

/** Le type MIME du drag-drop INTERNE — jamais confondu avec des fichiers externes. */
export const DND_TYPE = 'application/x-filarr-vault-item';

/** Un lot interrompu, tel que gardé pour la reprise. */
export type FolderPartial =
  | { op: 'rename'; path: string; newName: string; done: number; total: number }
  | { op: 'move'; sources: MoveSource[]; dest: string; done: number; total: number }
  | { op: 'delete'; path: string; done: number; total: number };

export interface ReplaceConflictState {
  target: VaultItemSummary;
  file: { name: string; mime: string };
  content: Uint8Array;
  conflict: VaultItemConflict;
}

export interface VaultPreviewState {
  item: VaultItemSummary;
  data: ArrayBuffer | null;
  error: boolean;
}

export function useVaultBrowser(vaultId: string) {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const { success, error, warning } = useNotification();

  const items = useSelector((s: RootState) => selectVaultItems(s, vaultId));
  const decryptStatus = useSelector((s: RootState) => selectVaultDecryptStatus(s, vaultId));
  const unlocked = useSelector((s: RootState) => selectIsVaultUnlocked(s, vaultId));
  // A vault VIEWER may read but never write. The Worker enforces this too (403
  // vault_forbidden on every write route) — this only spares them a dead button.
  const role = useSelector((s: RootState) => selectVaultById(s, vaultId)?.role ?? 'viewer');
  const vaultName = useSelector((s: RootState) => selectVaultById(s, vaultId)?.name ?? '');
  /**
   * NOTRE époque est-elle dépassée ?
   *
   * Une rotation qui gagne sa course pendant qu'on rejoint le coffre nous laisse
   * avec un wrap d'époque N alors que le coffre est à N+1 — et aucun wrap N+1
   * n'a jamais été écrit pour nous. L'écran affichait alors le cadenas ordinaire
   * et le conseil « déverrouillez votre compte », que l'utilisateur peut suivre
   * indéfiniment sans que rien ne change : ce n'est pas son compte qui est
   * verrouillé, c'est sa clé qui n'a pas été renouvelée.
   */
  const staleEpoch = useSelector((s: RootState) => {
    const v = selectVaultById(s, vaultId);
    return !!v && v.wrappedVaultKeyEpoch < v.currentKeyEpoch;
  });
  const currentKeyEpoch = useSelector(
    (s: RootState) => selectVaultById(s, vaultId)?.currentKeyEpoch ?? 0
  );
  const myUserId = useSelector((s: RootState) => s.auth.cloudUser?.id ?? null);
  /**
   * LE COFFRE EST-IL GELÉ (F23) ? Deux valeurs, et elles ne servent pas à la
   * même chose : `frozenAt` DATE le gel (le bandeau l'affiche), `frozen` le
   * réduit au booléen dont dépendent les boutons. Elles viennent du RÉSUMÉ
   * Redux, comme le rôle — un chargeur à part donnerait deux vérités possibles
   * au même instant sur un fait qui fait disparaître des boutons.
   */
  const frozenAt = useSelector((s: RootState) => selectVaultById(s, vaultId)?.frozenAt ?? null);
  const frozenBy = useSelector((s: RootState) => selectVaultById(s, vaultId)?.frozenBy ?? null);
  const frozen = frozenAt !== null;
  /**
   * DEUX LECTURES DU MÊME DROIT (voir `vaultFileCaps`) : `canEdit` porte le gel
   * et commande les gestes d'écriture ; `roleCanEdit` ne porte que le rôle, et
   * son seul usage est la politique d'org « les lecteurs ne téléchargent pas ».
   * Les confondre rendrait le contenu d'un coffre gelé illisible à ses propres
   * membres — l'inverse exact de ce que le gel promet.
   */
  const roleCanEdit = canEditVault(role);
  const canEdit = canEditVault(role, frozen);
  /**
   * Les formats que le REGISTRE revendique — relus à chaque rendu plutôt que
   * figés au montage : un greffon installé en cours de session doit apparaître
   * dans le menu sans recharger l'écran. (Même lecture que la vue dossier.)
   */
  const documentFormats = registeredEditorExtensions();
  /**
   * Le MÊME calcul que le serveur, et pas un plus permissif — la règle vit dans
   * `vaultExplorerModel` (pure, donc éprouvable), pas ici en double.
   */
  const isVaultAdmin = isVaultAdminRole(role);
  /**
   * LES RÉGLAGES DU COFFRE (F13) — un seul d'entre eux change quelque chose ici :
   * « supprimer est réservé aux administrateurs ». Lus par tout membre (la route
   * leur est ouverte) ; tant qu'on n'a rien lu, on retombe sur le comportement
   * d'avant la fiche plutôt que de retirer des gestes sur une ignorance.
   */
  const vaultSettings = useVaultSettings(vaultId, currentKeyEpoch);
  const itemDeleteRequiresAdmin = vaultSettings.settings.itemDeleteRequiresAdmin;
  /**
   * COMBIEN DE TEMPS UN ÉLÉMENT SUPPRIMÉ RESTE RÉCUPÉRABLE (F20).
   *
   * Les confirmations de suppression promettaient TRENTE JOURS en dur. Ce n'est
   * plus qu'un défaut : un coffre réglé à sept jours faisait donc compter sur
   * une récupération déjà expirée — la pire des promesses, puisqu'on ne s'en
   * aperçoit qu'en venant chercher ce qui n'est plus là.
   *
   * ET LE REPLI DE CE DOCUMENT NE VAUT PAS ICI — c'est la seule valeur qui y
   * échappe. Ailleurs, retomber sur le défaut ne fait que laisser un geste
   * OUVERT (le serveur tranchera) ; ici, cela PROMET une durée. Recopier les
   * trente jours de `DEFAULT_VAULT_SETTINGS` sur une lecture tombée dirait
   * « restaurable 30 jours » à un coffre réglé à sept, avec l'autorité d'un
   * chiffre. On rend donc `null` — les phrases ont une variante sans durée, qui
   * dit où va l'élément sans dire combien de temps il y reste.
   */
  const trashRetentionDays: number | null =
    vaultSettings.state === 'ok' ? vaultSettings.settings.trashRetentionDays : null;
  const canDelete = (item: VaultItemSummary): boolean =>
    canDeleteVaultItem(item, role, myUserId, itemDeleteRequiresAdmin, frozen);

  const [loading, setLoading] = useState(false);
  /**
   * Politique d'org « restreindre le téléchargement » : ne s'applique qu'aux
   * LECTEURS — un membre qui peut écrire peut de toute façon tout re-déposer
   * ailleurs. Best-effort assumé : l'écran d'administration porte la mention.
   */
  const restrictDownload = useSelector(selectRestrictDownloadByOrg);
  // Politique d'org : si les partages externes sont interdits, le bouton
  // n'apparaît pas — le serveur refuse de toute façon (share.ts, appliqué là).
  const externalSharesDisabled = useSelector(selectExternalSharesDisabledByOrg);
  const [sharing, setSharing] = useState<VaultItemSummary | null>(null);
  /** E3-6 : l'element ouvert dans le partage PAR PERSONNE (grants). */
  const [grantSharing, setGrantSharing] = useState<VaultItemSummary | null>(null);
  /** L'élément ouvert dans un ÉDITEUR DE GREFFON (texte, documents…). */
  const [pluginEditing, setPluginEditing] = useState<VaultItemSummary | null>(null);
  // Idempotent — le premier écran venu enregistre la liste blanche.
  registerBuiltinPlugins();
  // Les greffons MARKETPLACE installés (vérifiés puis bac à sable) — chargés
  // une fois par compte, fire-and-forget.
  const pluginUserId = useSelector((s: RootState) => s.auth.cloudUser?.id ?? null);
  useEffect(() => {
    if (pluginUserId) void ensureInstalledPluginsLoaded(pluginUserId);
  }, [pluginUserId]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  /**
   * L'espace du coffre, affiché AVANT l'envoi — le serveur le rendait depuis
   * toujours (`pooledStorageUsed`/`pooledStorageLimit` sur /vaults/seats) et
   * aucun écran ne le montrait : on découvrait le quota au refus, après avoir
   * chiffré et envoyé.
   */
  const [quota, setQuota] = useState<{ used: number; limit: number } | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  /**
   * L'aperçu : les octets déchiffrés d'UN élément, en mémoire seulement. Avant,
   * « consulter » un fichier de coffre voulait dire le télécharger — déposer du
   * clair dans Téléchargements pour une simple lecture.
   */
  const [preview, setPreview] = useState<VaultPreviewState | null>(null);
  const [toDelete, setToDelete] = useState<VaultItemSummary | null>(null);
  /**
   * L'IDENTIFIANT, PAS L'OBJET — comme `editingId` juste en dessous.
   *
   * Garder l'élément entier en figeait la VERSION à l'instant de l'ouverture.
   * Chaque nouvelle tentative rejouait donc exactement le même 409.
   */
  const [historyId, setHistoryId] = useState<string | null>(null);
  /**
   * Filtre LOCAL — aucune requête, aucun déchiffrement supplémentaire : les
   * métadonnées sont déjà en clair en mémoire.
   */
  const [query, setQuery] = useState('');
  const [showTrash, setShowTrash] = useState(false);
  const [trash, setTrash] = useState<ServerVaultItemDTO[] | null>(null);
  const [trashError, setTrashError] = useState<string | null>(null);
  const [trashMeta, setTrashMeta] = useState<Record<string, { name?: string; folder?: boolean }>>(
    {}
  );
  /** Le DOSSIER OUVERT — '' = racine. Vit dans la méta chiffrée, jamais l'URL. */
  const [currentPath, setCurrentPath] = useState('');
  /**
   * LA SÉLECTION MULTIPLE — des identifiants d'AFFICHAGE (`vaultitem:` /
   * `vaultdir:`), jamais des ids nus : c'est ce que portent les cartes, et ce
   * qui garantit qu'une sélection restée en mémoire ne puisse jamais viser
   * l'espace personnel. La grammaire (Ctrl, Shift, Ctrl+A) vit dans
   * `vaultSelection` (pur) ; ici, seulement l'état et l'ancre du Shift+clic.
   * L'ancre est un ref : changer d'ancre ne redessine rien.
   */
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const selectionAnchorRef = useRef<string | null>(null);
  const clearSelection = useCallback(() => {
    setSelectedIds((cur) => (cur.size === 0 ? cur : new Set()));
    selectionAnchorRef.current = null;
  }, []);
  /** Ctrl/Cmd+clic ou case à cocher. */
  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((cur) => toggleSelection(cur, id));
    selectionAnchorRef.current = id;
  }, []);
  /** Shift+clic : la plage depuis l'ancre, dans l'ordre AFFICHÉ fourni par la vue. */
  const selectRangeTo = useCallback((orderedIds: readonly string[], id: string) => {
    const anchor = selectionAnchorRef.current;
    setSelectedIds((cur) => extendSelectionWithRange(cur, orderedIds, anchor, id));
    selectionAnchorRef.current = id;
  }, []);
  /** Ctrl+A : tout ce qui est à l'écran — dossiers ET fichiers. */
  const selectAll = useCallback((orderedIds: readonly string[]) => {
    setSelectedIds(selectAllIds(orderedIds));
  }, []);
  /**
   * Le LASSO (rectangle de sélection sur le fond) : le hook livre la liste
   * finale d'un coup, elle REMPLACE la sélection — il gère lui-même le
   * Ctrl+glisser additif. L'ancre du Shift+clic tombe : un rectangle n'a pas
   * de « dernier cliqué ».
   */
  const replaceSelection = useCallback((ids: Iterable<string>) => {
    setSelectedIds(new Set(ids));
    selectionAnchorRef.current = null;
  }, []);
  /** UNE opération de dossier à la fois (renommage/déplacement = N PATCH). */
  const [folderOp, setFolderOp] = useState<{ path: string; total: number; done: number } | null>(
    null
  );
  /**
   * Un lot interrompu — l'état qui rend la reprise possible. On garde les
   * ARGUMENTS du geste, jamais son plan : la reprise recalcule le plan depuis
   * le store frais (les éléments déjà passés n'y figurent plus — idempotent).
   */
  const [folderPartial, setFolderPartial] = useState<FolderPartial | null>(null);
  const [newFolder, setNewFolder] = useState<{ draft: string } | null>(null);
  /**
   * « Nouveau document » — le chaînon manquant des plugins d'édition : un
   * éditeur bac à sable ne s'ouvrait que sur un fichier EXISTANT.
   */
  const [newDoc, setNewDoc] = useState<{ ext: string; displayName: string; draft: string } | null>(
    null
  );
  const [folderRenaming, setFolderRenaming] = useState<{ path: string; draft: string } | null>(
    null
  );
  const [folderToDelete, setFolderToDelete] = useState<{
    path: string;
    plan: FolderDeletePlan;
  } | null>(null);
  /** La cible de drop survolée (chemin complet), pour l'anneau local. */
  const [hoverFolder, setHoverFolder] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /**
   * REMPLACER un fichier. `updateVaultItem` est agnostique du type d'élément :
   * le fichier remplacé devient une révision, donc récupérable depuis
   * « Versions ».
   */
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<VaultItemSummary | null>(null);
  /**
   * Le remplacement s'est heurté à une écriture concurrente. On garde TOUT ce
   * qu'il faut pour décider sans re-choisir le fichier.
   */
  const [replaceConflict, setReplaceConflict] = useState<ReplaceConflictState | null>(null);

  // Re-read the item from the list so the open editor follows a version bump
  // (its own save, or a reload that picked up someone else's).
  const editingItem = editingId ? (items.find((i) => i.id === editingId) ?? null) : null;
  // Relu à chaque rendu : la version suit les rechargements de la liste, donc
  // une tentative de restauration après conflit part de la version réelle.
  const historyItem = historyId ? (items.find((i) => i.id === historyId) ?? null) : null;

  const collator = useMemo(
    () => new Intl.Collator(i18n.language, { numeric: true, sensitivity: 'base' }),
    [i18n.language]
  );

  const searching = query.trim().length > 0;

  /** Les dossiers ENFANTS du dossier courant — implicites + marqueurs, triés. */
  const folders = useMemo(
    () => (searching ? [] : sortFoldersFirst(deriveFolders(items, currentPath), collator)),
    [items, currentPath, searching, collator]
  );

  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // Navigation : les éléments DE CE dossier (les marqueurs restent cachés —
      // ils sont l'implémentation des dossiers, pas du contenu).
      return items.filter(
        (i) =>
          !i.meta.folderMarker && !i.meta.threadFor && normalizePath(i.meta.path) === currentPath
      );
    }
    // Recherche : GLOBALE, tous dossiers confondus — le plat retrouvé, chaque
    // résultat portant son chemin cliquable.
    return items.filter((i) => {
      if (i.meta.folderMarker || i.meta.threadFor) return false;
      const name = String(i.meta.title ?? i.meta.fileName ?? '').toLowerCase();
      // Le TYPE est cherchable aussi : « pdf » ou « note » sont ce qu'on tape
      // quand on ne se souvient pas du nom.
      return (
        name.includes(q) ||
        String(i.itemType).toLowerCase().includes(q) ||
        normalizePath(i.meta.path).toLowerCase().includes(q)
      );
    });
  }, [items, query, currentPath]);

  const load = useCallback(async () => {
    if (!unlocked) return;
    setLoading(true);
    try {
      await dispatch(loadVaultItems({ vaultId })).unwrap();
    } catch (e) {
      error(t(vaultErrorKey(msg(e), 'teamVaults.errors.loadItems')));
    } finally {
      setLoading(false);
    }
  }, [dispatch, vaultId, unlocked, error, t]);

  // La jauge : l'occupation de l'espace, connue AVANT le premier envoi.
  useEffect(() => {
    let vivant = true;
    void apiGetVaultSeats().then((seats) => {
      if (!vivant || !seats) return;
      if (
        typeof seats.pooledStorageUsed === 'number' &&
        typeof seats.pooledStorageLimit === 'number'
      ) {
        setQuota({ used: seats.pooledStorageUsed, limit: seats.pooledStorageLimit });
      }
    });
    return () => {
      vivant = false;
    };
  }, [vaultId]);

  /**
   * LE GEL, RELU À L'ENTRÉE DANS LE COFFRE (F23) — et c'est ici que vit son vrai
   * public.
   *
   * `frozenAt` n'arrivait dans Redux que par `loadVaults` (jamais rejoué : la
   * garde « une demande par session » vit dans le slice) et par le réducteur de
   * celui qui venait de cliquer sur « Geler ». Autrement dit : quand A gelait le
   * coffre, B gardait « Envoyer », « Nouveau dossier », le glisser-déposer,
   * « Renommer / Déplacer / Supprimer » et AUCUN bandeau, jusqu'au prochain
   * démarrage. Chaque geste récoltait bien son 409 traduit — rien n'était perdu
   * — mais toute la charge visible de la fiche (le bandeau qui explique pourquoi
   * les boutons ont disparu) ne parvenait qu'à l'auteur du gel.
   *
   * UNE SEULE LECTURE, à l'entrée : le fait est rare et ne bouge pas tout seul
   * pendant qu'on navigue. `apiGetVault` avale son propre échec et rend `null` —
   * `freezeStateFromVault` refuse alors de rien publier, plutôt que de lire ce
   * silence comme « pas gelé » et d'effacer un bandeau vrai.
   */
  useEffect(() => {
    let vivant = true;
    void apiGetVault(vaultId).then((v) => {
      if (!vivant) return;
      const gel = freezeStateFromVault(vaultId, v);
      if (gel) dispatch(vaultFreezeState(gel));
    });
    return () => {
      vivant = false;
    };
  }, [vaultId, dispatch]);

  useEffect(() => {
    load();
  }, [load]);

  // Changer de coffre remet à la racine — un chemin n'a de sens QUE dans le sien.
  useEffect(() => {
    setCurrentPath('');
    setFolderPartial(null);
    setFolderOp(null);
  }, [vaultId]);

  // La sélection ne survit ni au changement de coffre, ni à celui de dossier,
  // ni à une recherche, ni au passage par la corbeille : ce qui était coché
  // n'est plus à l'écran, et une action sur de l'invisible serait un piège.
  useEffect(() => {
    clearSelection();
  }, [vaultId, currentPath, query, showTrash, clearSelection]);

  const loadTrash = useCallback(async () => {
    setTrashError(null);
    try {
      const dtos = await apiListDeletedVaultItems(vaultId);
      setTrash(dtos);
      /**
       * DÉCHIFFRER LES NOMS — une corbeille anonyme ne sert à rien. La méta est
       * petite ; l'échec par élément est toléré — une époque dont on n'a plus la
       * clé reste listée, anonyme, plutôt que cachée.
       */
      const metas: Record<string, { name?: string; folder?: boolean }> = {};
      await Promise.all(
        dtos.map(async (dto) => {
          const meta = await decryptItemMetaSafe(dto, vaultId);
          if (!meta) return;
          const nom = meta.fileName || meta.title;
          // Un MARQUEUR supprimé doit se dire « Dossier », pas « Note » anonyme.
          if (nom || meta.folderMarker) {
            metas[dto.id] = { name: nom, folder: meta.folderMarker === true };
          }
        })
      );
      setTrashMeta(metas);
    } catch (e) {
      // Une corbeille illisible n'est PAS une corbeille vide.
      setTrash(null);
      setTrashError(msg(e));
    }
  }, [vaultId]);

  useEffect(() => {
    if (showTrash) void loadTrash();
  }, [showTrash, loadTrash]);

  const restoreItem = async (itemId: string) => {
    try {
      await apiRestoreVaultItem(vaultId, itemId);
      success(t('teamVaults.trash.restored'));
      await loadTrash();
      await load();
    } catch (e) {
      error(t(vaultErrorKey(msg(e), 'teamVaults.errors.itemRestore')));
    }
  };

  /**
   * Déposer un lot de fichiers — la file est SÉQUENTIELLE, et c'est un choix.
   *
   * Un refus de quota ou un espace gelé doit ARRÊTER la file avec son vrai
   * message, pas laisser dix envois échouer en parallèle sur la même cause.
   */
  const uploadFiles = async (files: File[], destPath: string = currentPath) => {
    if (files.length === 0) return;
    setUploading(true);
    setUploadProgress(files.length > 1 ? { done: 0, total: files.length } : null);
    let envoyes = 0;
    try {
      for (const file of files) {
        /**
         * REFUSER AVANT DE LIRE. `file.arrayBuffer()` charge le fichier ENTIER
         * en mémoire ; découvrir ensuite que le quota est plein, c'est payer la
         * lecture pour rien — et sur un gros fichier, c'est l'onglet qui
         * s'effondre sans un mot.
         */
        if (file.size > NON_LOCAL_MAX_FILE_SIZE) {
          error(
            t('teamVaults.items.tooLarge', {
              name: file.name,
              max: formatBytes(NON_LOCAL_MAX_FILE_SIZE),
            })
          );
          break;
        }
        /**
         * CE CONTRÔLE-CI EST CELUI DU POOL DE L'ESPACE, ET SA PHRASE LE DIT
         * (F24). Il n'y a AUCUN contrôle amont du plafond propre au coffre :
         * ce que ce coffre occupe déjà n'est servi que par `/stats`, une route
         * au seau serré que l'explorateur n'appelle pas. Le refus vient donc du
         * serveur (413 `vault_quota_exceeded`), et il a sa propre phrase dans
         * la table des codes — celle qui parle du plafond DE CE COFFRE et
         * envoie relever un curseur, là où « votre espace est plein »
         * enverrait acheter des sièges pour rien.
         */
        if (quota && quota.limit > 0 && file.size > quota.limit - quota.used) {
          error(t('teamVaults.items.quotaFull', { name: file.name }));
          break;
        }
        const content = new Uint8Array(await file.arrayBuffer());
        await dispatch(
          addVaultItem({
            vaultId,
            itemType: 'file',
            meta: {
              fileName: file.name,
              mime: file.type || 'application/octet-stream',
              // Le dossier VISÉ (celui qu'on regarde, ou la rangée survolée) —
              // chiffré dans la méta comme le reste.
              path: normalizePath(destPath) || undefined,
            },
            content,
          })
        ).unwrap();
        envoyes++;
        setUploadProgress(files.length > 1 ? { done: envoyes, total: files.length } : null);
        // La jauge suit ce qu'on vient d'occuper, sans attendre un aller-retour.
        setQuota((q) => (q ? { ...q, used: q.used + file.size } : q));
      }
      if (envoyes > 0) {
        success(
          files.length > 1
            ? t('teamVaults.items.uploadedMany', { count: envoyes })
            : t('teamVaults.items.uploaded')
        );
      }
    } catch (err) {
      const code = msg(err);
      error(
        /epoch|conflict/i.test(code)
          ? t('teamVaults.errors.conflict')
          : t(vaultErrorKey(code, 'teamVaults.errors.upload'))
      );
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    // Clear the input so picking the SAME file again still fires onChange.
    e.target.value = '';
    await uploadFiles(files);
  };

  /** Ouvrir le sélecteur de fichiers — le bouton « Envoyer » des deux vues. */
  const openFilePicker = () => fileInputRef.current?.click();

  /** Armer le remplacement d'un fichier puis ouvrir le sélecteur. */
  const startReplace = (item: VaultItemSummary) => {
    setReplacing(item);
    replaceInputRef.current?.click();
  };

  /**
   * GLISSER-DÉPOSER — le geste par lequel on donne des fichiers à un espace
   * partagé partout ailleurs.
   */
  const [dragOver, setDragOver] = useState(false);
  const handleDrop = async (e: React.DragEvent) => {
    // Un drag INTERNE (déplacement d'élément) n'est jamais un envoi : certains
    // navigateurs exposent quand même dataTransfer.files — le type custom se
    // teste EN PREMIER.
    if (e.dataTransfer.types.includes(DND_TYPE)) {
      setDragOver(false);
      return;
    }
    e.preventDefault();
    setDragOver(false);
    if (!canEdit || uploading) return;
    /**
     * UN DOSSIER DE L'OS N'EST PAS UN FICHIER. Le navigateur le fait pourtant
     * apparaître dans `dataTransfer.files` comme une entrée ordinaire, dont
     * `arrayBuffer()` échoue. Les entrées sont lues AVANT tout `await` : le
     * DataTransfer est vidé dès que le gestionnaire rend la main.
     */
    const dropped = Array.from(e.dataTransfer.items ?? []);
    const hasDirectory = dropped.some(
      (it) =>
        it.kind === 'file' &&
        typeof it.webkitGetAsEntry === 'function' &&
        it.webkitGetAsEntry()?.isDirectory === true
    );
    const files = Array.from(e.dataTransfer.files ?? []);
    if (hasDirectory) {
      // Refus du dépôt ENTIER, pas seulement des dossiers : n'envoyer que les
      // fichiers d'un lot mixte laisserait croire que tout est passé.
      error(t('teamVaults.items.foldersUnsupported'));
      return;
    }
    await uploadFiles(files);
  };

  const handleReplacePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const target = replacing;
    setReplacing(null);
    if (!file || !target) return;
    setUploading(true);
    // Lu AVANT le try : le dialogue de conflit doit pouvoir rejouer ces octets
    // sans redemander le fichier.
    const content = new Uint8Array(await file.arrayBuffer());
    try {
      await dispatch(
        updateVaultItem({
          vaultId,
          itemId: target.id,
          expectedVersion: target.version,
          // Le nom suit le fichier choisi : remplacer « contrat-v1.pdf » par
          // « contrat-v2.pdf » et garder l'ancien nom serait le pire des deux.
          meta: {
            ...target.meta,
            fileName: file.name,
            mime: file.type || 'application/octet-stream',
          },
          content,
        })
      ).unwrap();
      success(t('teamVaults.items.replaced'));
    } catch (err) {
      /** UN CONFLIT N'EST PAS UNE PANNE, c'est une décision à prendre. */
      if (isVaultItemConflict(err)) {
        setReplaceConflict({
          target,
          file: { name: file.name, mime: file.type || 'application/octet-stream' },
          content,
          conflict: err,
        });
      } else {
        error(t(vaultErrorKey(msg(err), 'teamVaults.errors.upload')));
      }
    } finally {
      setUploading(false);
    }
  };

  /**
   * Le drapeau « ne referme pas encore ».
   *
   * `PromptModal` referme TOUJOURS juste après avoir appelé `onSubmit` — or les
   * dialogues de cet écran doivent survivre à un échec avec la saisie intacte.
   */
  const keepOpenRef = useRef(false);

  /**
   * Lance un geste de dialogue en gardant le drapeau levé. Le `await` garantit
   * que la remise à zéro passe par une micro-tâche, donc APRÈS la fermeture
   * synchrone de PromptModal.
   */
  const runDialogSubmit = (geste: () => Promise<void>): void => {
    keepOpenRef.current = true;
    void (async () => {
      try {
        await geste();
      } finally {
        keepOpenRef.current = false;
      }
    })();
  };

  /** Fermeture (Échap, fond, croix) — refusée tant qu'un geste est en vol. */
  const guardedClose = (close: () => void) => () => {
    if (keepOpenRef.current) return;
    close();
  };

  /** L'élément en cours de renommage, et la saisie — gardée jusqu'au succès. */
  const [renaming, setRenaming] = useState<{ item: VaultItemSummary; draft: string } | null>(null);

  const submitRename = async (saisie: string) => {
    const r = renaming;
    if (!r) return;
    const nom = saisie.trim();
    if (!nom || nom === itemName(r.item, '')) {
      setRenaming(null);
      return;
    }
    try {
      await dispatch(renameVaultItem({ vaultId, itemId: r.item.id, name: nom })).unwrap();
      // La saisie ne part qu'au succès : un échec la laisse dans le champ.
      setRenaming(null);
      success(t('teamVaults.items.renamed'));
    } catch (err) {
      if (isVaultItemConflict(err)) {
        setRenaming(null);
        error(t('teamVaults.errors.conflict'));
      } else {
        error(t(vaultErrorKey(msg(err), 'teamVaults.errors.renameItemFailed')));
      }
    }
  };

  /** Écraser délibérément : rejouer avec la version que le serveur détient. */
  const conflictOverwrite = async () => {
    const c = replaceConflict;
    if (!c || c.conflict.serverVersion === null) return;
    setReplaceConflict(null);
    setUploading(true);
    try {
      await dispatch(
        updateVaultItem({
          vaultId,
          itemId: c.target.id,
          expectedVersion: c.conflict.serverVersion,
          // Le path du SERVEUR est adopté : le 409 peut venir d'un déplacement
          // concurrent, et « écraser le contenu » ne doit pas téléporter le
          // fichier hors du dossier où quelqu'un vient de le ranger.
          meta: {
            ...c.target.meta,
            path: c.conflict.serverItem?.meta.path ?? c.target.meta.path,
            fileName: c.file.name,
            mime: c.file.mime,
          },
          content: c.content,
        })
      ).unwrap();
      success(t('teamVaults.items.replaced'));
    } catch (err) {
      // Un second conflit peut survenir — on repasse par le même dialogue.
      if (isVaultItemConflict(err)) {
        setReplaceConflict({ ...c, conflict: err });
      } else {
        error(t(vaultErrorKey(msg(err), 'teamVaults.errors.upload')));
      }
    } finally {
      setUploading(false);
    }
  };

  /** Garder les deux : mon fichier devient un NOUVEL élément, le leur reste. */
  const conflictKeepBoth = async () => {
    const c = replaceConflict;
    if (!c) return;
    setReplaceConflict(null);
    setUploading(true);
    try {
      await dispatch(
        addVaultItem({
          vaultId,
          itemType: 'file',
          meta: {
            ...c.target.meta,
            fileName: t('teamVaults.items.conflictCopyName', { name: c.file.name }),
            mime: c.file.mime,
          },
          content: c.content,
        })
      ).unwrap();
      success(t('teamVaults.items.conflictKeptBoth'));
    } catch (err) {
      error(t(vaultErrorKey(msg(err), 'teamVaults.errors.upload')));
    } finally {
      setUploading(false);
    }
  };

  /** Remettre des octets déchiffrés au navigateur sous le nom de l'élément. */
  const saveBytesAs = (bytes: Uint8Array, item: VaultItemSummary) => {
    // Copy into a fresh ArrayBuffer-backed view so the BlobPart type is satisfied
    // (the decrypt pipeline returns Uint8Array<ArrayBufferLike>).
    const blob = new Blob([new Uint8Array(bytes)], {
      type: item.meta.mime || 'application/octet-stream',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = itemName(item, t('teamVaults.items.untitled'));
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleDownload = async (item: VaultItemSummary) => {
    setDownloadingId(item.id);
    try {
      const bytes = await downloadVaultItemContent(vaultId, item);
      saveBytesAs(bytes, item);
      success(t('teamVaults.items.downloaded'));
    } catch (e) {
      error(t(vaultErrorKey(msg(e), 'teamVaults.errors.download')));
    } finally {
      setDownloadingId(null);
    }
  };

  /** La progression d'un téléchargement de SÉLECTION — la barre l'affiche. */
  const [downloadProgress, setDownloadProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  /**
   * Télécharger une sélection : SÉQUENTIEL, un élément après l'autre — N
   * déchiffrements en parallèle, c'est N fichiers entiers en mémoire en même
   * temps. Un échec n'arrête pas les autres (contrairement à l'envoi, où une
   * cause systémique se répéterait) : chaque fichier a sa propre clé, sa propre
   * chance. UN bilan à la fin, pas N toasts.
   */
  const handleDownloadMany = async (targets: VaultItemSummary[]) => {
    if (targets.length === 0) {
      // Une sélection faite de dossiers seulement : rien à télécharger, et on le dit.
      error(
        t(
          'teamVaults.selection.downloadNoFiles',
          'Nothing to download: folders are not downloaded, select files.'
        )
      );
      return;
    }
    setDownloadProgress({ done: 0, total: targets.length });
    let ok = 0;
    let failed = 0;
    try {
      for (const item of targets) {
        setDownloadingId(item.id);
        try {
          const bytes = await downloadVaultItemContent(vaultId, item);
          saveBytesAs(bytes, item);
          ok++;
        } catch {
          failed++;
        }
        setDownloadProgress({ done: ok + failed, total: targets.length });
      }
      if (ok > 0) {
        success(
          t('teamVaults.selection.downloadedMany', {
            count: ok,
            defaultValue: '{{count}} files downloaded',
          })
        );
      }
      if (failed > 0) {
        error(
          t('teamVaults.selection.downloadFailedMany', {
            count: failed,
            defaultValue: '{{count}} files could not be downloaded',
          })
        );
      }
    } finally {
      setDownloadingId(null);
      setDownloadProgress(null);
    }
  };

  /** La progression d'une DUPLICATION de sélection — la barre l'affiche. */
  const [duplicateProgress, setDuplicateProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  /**
   * « Dupliquer ici » : chaque élément est RELU (déchiffré sous sa K_item) puis
   * RENVOYÉ comme un nouvel élément (`addVaultItem`, K_item neuve) — il n'y a
   * pas de copie côté serveur, c'est un envoi qui coûte ce qu'un envoi coûte.
   * D'où la MÊME garde que l'envoi, AVANT de relire quoi que ce soit : la
   * taille plafond, puis la jauge de quota. Et SÉQUENTIEL, arrêt à la première
   * erreur : un quota plein ou un espace gelé se répéterait N fois, autant le
   * dire une fois avec son vrai message. Les dossiers cochés sont exclus (pas
   * d'octets à relire) et le bilan le dit.
   */
  const duplicateItems = async (plan: DuplicatePlan<VaultItemSummary>) => {
    const targets = plan.files;
    if (targets.length === 0) {
      error(
        t(
          'teamVaults.selection.duplicateNoFiles',
          'Nothing to duplicate: folders are not duplicated, select files.'
        )
      );
      return;
    }
    const copyWord = t('teamVaults.selection.copyWord', 'copy');
    setUploading(true);
    setDuplicateProgress({ done: 0, total: targets.length });
    // Les noms déjà pris, PAR dossier, tenus à jour au fil du lot : deux
    // duplicatas du même fichier dans la même passe ne se marchent pas dessus.
    const takenByPath = new Map<string, Set<string>>();
    const takenFor = (path: string): Set<string> => {
      let set = takenByPath.get(path);
      if (!set) {
        set = takenNamesIn(items, path);
        takenByPath.set(path, set);
      }
      return set;
    };
    let done = 0;
    try {
      for (const item of targets) {
        const nom = duplicateSourceName(item.meta) || t('teamVaults.items.untitled');
        if (item.sizeBytes > NON_LOCAL_MAX_FILE_SIZE) {
          error(
            t('teamVaults.items.tooLarge', { name: nom, max: formatBytes(NON_LOCAL_MAX_FILE_SIZE) })
          );
          break;
        }
        // Le pool de l'ESPACE, comme à l'envoi — le plafond du coffre, lui, est
        // refusé par le serveur avec sa phrase à lui (`vault_quota_exceeded`).
        if (quota && quota.limit > 0 && item.sizeBytes > quota.limit - quota.used) {
          error(t('teamVaults.items.quotaFull', { name: nom }));
          break;
        }
        let content: Uint8Array;
        try {
          content = await downloadVaultItemContent(vaultId, item);
        } catch (e) {
          error(t(vaultErrorKey(msg(e), 'teamVaults.errors.download')));
          break;
        }
        const path = normalizePath(item.meta.path);
        const taken = takenFor(path);
        const meta = duplicateMeta(item.meta, copyWord, taken);
        taken.add(duplicateSourceName(meta));
        try {
          await dispatch(
            addVaultItem({
              vaultId,
              itemType: item.itemType as VaultItemKind,
              meta,
              content,
            })
          ).unwrap();
        } catch (e) {
          const code = msg(e);
          error(
            /epoch|conflict/i.test(code)
              ? t('teamVaults.errors.conflict')
              : t(vaultErrorKey(code, 'teamVaults.errors.upload'))
          );
          break;
        }
        done++;
        setDuplicateProgress({ done, total: targets.length });
        // La jauge suit ce qu'on vient d'occuper, sans attendre un aller-retour.
        setQuota((q) => (q ? { ...q, used: q.used + item.sizeBytes } : q));
      }
      if (done > 0) {
        success(
          t('teamVaults.selection.duplicatedMany', {
            count: done,
            defaultValue: '{{count}} items duplicated',
          })
        );
      }
      if (plan.skippedFolders + plan.skippedOther > 0) {
        warning(
          t('teamVaults.selection.duplicateSkipped', {
            count: plan.skippedFolders + plan.skippedOther,
            defaultValue: '{{count}} items were not duplicated (folders are excluded).',
          })
        );
      }
    } finally {
      setUploading(false);
      setDuplicateProgress(null);
    }
  };

  /** Voir la leur avant de trancher : téléchargement direct de l'élément serveur. */
  const conflictDownloadTheirs = async () => {
    const it = replaceConflict?.conflict.serverItem;
    if (!it) return;
    await handleDownload(it);
  };

  const handlePreview = async (item: VaultItemSummary) => {
    // Plafond identique à celui des fichiers personnels : au-delà, le mode
    // bufferisé coûterait la mémoire de l'onglet — on renvoie au téléchargement.
    if (item.sizeBytes > MAX_PREVIEW_FILE_SIZE) {
      error(t('teamVaults.preview.tooLarge'));
      return;
    }
    setPreview({ item, data: null, error: false });
    try {
      const bytes = await downloadVaultItemContent(vaultId, item);
      const copie = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(copie).set(bytes);
      setPreview((p) => (p && p.item.id === item.id ? { ...p, data: copie } : p));
    } catch {
      setPreview((p) => (p && p.item.id === item.id ? { ...p, error: true } : p));
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    const item = toDelete;
    setToDelete(null);
    try {
      await dispatch(deleteVaultItem({ vaultId, itemId: item.id })).unwrap();
      // Le FIL du fichier suit son fichier à la corbeille (soft-delete).
      // Best-effort : un échec ici ne défait rien.
      const thread = findThreadItem(items, item.id);
      if (thread) {
        try {
          await dispatch(deleteVaultItem({ vaultId, itemId: thread.id })).unwrap();
        } catch {
          /* le fil restera masqué et rejoindra la corbeille plus tard */
        }
      }
      success(t('teamVaults.items.deleted'));
    } catch (e) {
      error(t(vaultErrorKey(msg(e), 'teamVaults.errors.delete')));
    }
  };

  /**
   * Supprimer une SÉLECTION. Le plan (`planSelectionDelete`, matrice élément
   * par élément + plan récursif de chaque dossier coché) est calculé par la
   * vue AU CLIC, comme pour un dossier : la confirmation dit combien partent
   * et combien la matrice a refusés — jamais découvert en 403. Rien de
   * supprimable : on le DIT, pas de modale morte.
   */
  const [selectionToDelete, setSelectionToDelete] = useState<SelectionDeletePlan | null>(null);

  const requestDeleteSelection = (plan: SelectionDeletePlan) => {
    if (plan.deletions.length === 0) {
      error(t('teamVaults.folders.deleteRecursiveSkipped', { count: plan.skipped }));
      return;
    }
    setSelectionToDelete(plan);
  };

  const confirmDeleteSelection = async () => {
    const plan = selectionToDelete;
    setSelectionToDelete(null);
    if (!plan) return;
    // Soft-deletes, la corbeille (30 j) est le filet. `item_not_found` compte
    // comme un succès dans le thunk : relancer après un échec partiel ne
    // rejoue que le reste — la sélection est vidée, l'hôte recoche ce qui reste.
    setFolderOp({ path: currentPath, total: plan.deletions.length, done: 0 });
    try {
      const res = await dispatch(deleteVaultItems({ vaultId, itemIds: plan.deletions })).unwrap();
      clearSelection();
      if (res.failed.length === 0) {
        success(t('teamVaults.items.deleted'));
      } else {
        const systemic = res.failed.find(
          (f) => f.error !== 'item_version_conflict' && f.error !== 'vault_locked'
        );
        error(
          systemic
            ? t(vaultErrorKey(systemic.error, 'teamVaults.folders.partialFailed'))
            : t('teamVaults.errors.conflict')
        );
      }
    } finally {
      setFolderOp(null);
    }
  };

  /**
   * Le cœur des gestes de dossier : exécuter un plan (N PATCH meta) avec
   * rapport partiel structuré. `origin` garde les ARGUMENTS pour la reprise —
   * jamais le plan, recalculé à chaque tentative depuis le store frais.
   */
  const runFolderPlan = async (
    opPath: string,
    moves: Array<{ itemId: string; meta: VaultItemSummary['meta'] }>,
    origin:
      | { op: 'rename'; path: string; newName: string }
      | { op: 'move'; sources: MoveSource[]; dest: string }
  ): Promise<boolean> => {
    if (moves.length === 0) {
      setFolderPartial(null);
      return true;
    }
    setFolderOp({ path: opPath, total: moves.length, done: 0 });
    try {
      const res = await dispatch(moveVaultItems({ vaultId, moves })).unwrap();
      if (res.failed.length === 0) {
        setFolderPartial(null);
        return true;
      }
      // ÉCHEC PARTIEL : l'état intermédiaire est VISIBLE (préfixes implicites,
      // deux dossiers chacun avec sa part) — pas corrompu. Le bandeau propose
      // « Reprendre », qui replanifie depuis le store déjà rechargé.
      setFolderPartial({
        ...origin,
        done: res.applied.length,
        total: moves.length,
      } as FolderPartial);
      const systemic = res.failed.find(
        (f) => f.error !== 'item_version_conflict' && f.error !== 'vault_locked'
      );
      error(
        systemic
          ? t(vaultErrorKey(systemic.error, 'teamVaults.folders.partialFailed'))
          : t('teamVaults.errors.conflict')
      );
      return false;
    } finally {
      setFolderOp(null);
    }
  };

  const folderNameError = (e: unknown): string =>
    msg(e) === 'folder_name_too_long'
      ? t('teamVaults.folders.nameTooLong')
      : msg(e) === 'folder_too_deep' || msg(e) === 'folder_path_too_long'
        ? t('teamVaults.folders.tooDeep')
        : t('teamVaults.folders.invalidName');

  const submitNewFolder = async (draft: string) => {
    let nom: string;
    try {
      nom = normalizeFolderName(draft);
    } catch (e) {
      error(folderNameError(e));
      return;
    }
    try {
      // Un dossier vide EST un élément : le MARQUEUR (note à zéro octet, cachée
      // de la liste). Sans lui, « Nouveau dossier » disparaîtrait à la
      // navigation et n'existerait jamais pour les autres membres.
      await dispatch(
        addVaultItem({
          vaultId,
          itemType: 'note',
          meta: { folderMarker: true, title: nom, path: currentPath || undefined },
          content: new Uint8Array(0),
        })
      ).unwrap();
      setNewFolder(null);
      success(t('teamVaults.folders.created'));
    } catch (e) {
      error(t(vaultErrorKey(msg(e), 'teamVaults.errors.upload')));
    }
  };

  /**
   * Créer un document VIDE puis l'ouvrir tout de suite — le motif EXACT de
   * submitNewFolder : le contrôle de quota est hérité, et le fichier vaut mieux
   * que rien parce que le plugin sait lire un document vide.
   */
  const submitNewDoc = async (saisie: string) => {
    const spec = newDoc;
    if (!spec) return;
    const base = saisie.trim();
    if (base.length === 0 || base.length > 200) {
      error(t('teamVaults.folders.invalidName'));
      return;
    }
    // Jamais deux fois l'extension : « notes.kanban » reste « notes.kanban ».
    const suffixe = `.${spec.ext}`;
    const fileName = base.toLowerCase().endsWith(suffixe) ? base : `${base}${suffixe}`;
    try {
      const créé = await dispatch(
        addVaultItem({
          vaultId,
          itemType: 'file',
          meta: {
            fileName,
            mime: 'application/octet-stream',
            path: currentPath || undefined,
          },
          content: new Uint8Array(0),
        })
      ).unwrap();
      setNewDoc(null);
      // Ouverture immédiate : créer un fichier vide sans l'ouvrir ne servirait
      // à personne — c'est le geste « nouveau document », pas « nouveau vide ».
      if (editorForFileName(fileName)) setPluginEditing(créé);
    } catch (e) {
      error(t(vaultErrorKey(msg(e), 'teamVaults.errors.upload')));
    }
  };

  const submitFolderRename = async (path: string, newName: string) => {
    let moves;
    try {
      moves = planFolderRename(items, path, newName);
    } catch (e) {
      error(folderNameError(e));
      return;
    }
    const ok = await runFolderPlan(path, moves, { op: 'rename', path, newName });
    if (ok) {
      setFolderRenaming(null);
      success(t('teamVaults.folders.renamed'));
      // Si le dossier ouvert vient d'être renommé, suivre le nouveau chemin.
      const to = joinPath(parentOf(path), normalizeFolderName(newName));
      setCurrentPath((cur) =>
        cur === path || cur.startsWith(`${path}/`) ? to + cur.slice(path.length) : cur
      );
    }
  };

  const submitMove = async (sources: MoveSource[], dest: string) => {
    let moves;
    try {
      moves = planMoveInto(items, sources, dest);
    } catch (e) {
      if (msg(e) === 'folder_move_into_self') {
        error(t('teamVaults.folders.cantMoveIntoSelf'));
        return;
      }
      error(folderNameError(e));
      return;
    }
    const ok = await runFolderPlan(dest, moves, { op: 'move', sources, dest });
    if (ok && moves.length > 0) success(t('teamVaults.folders.moved'));
  };

  /** La reprise : mêmes ARGUMENTS, plan recalculé — idempotente par construction. */
  const resumeFolderPartial = async () => {
    const partial = folderPartial;
    if (!partial) return;
    if (partial.op === 'rename') {
      await submitFolderRename(partial.path, partial.newName);
      return;
    }
    if (partial.op === 'move') {
      await submitMove(partial.sources, partial.dest);
      return;
    }
    // delete : replanifier depuis le store frais — les éléments partis n'y
    // figurent plus, la reprise ne rejoue que le reste.
    const plan = planFolderDelete(items, partial.path, (it) => canDelete(it));
    setFolderToDelete(null);
    if (plan.deletions.length === 0) {
      setFolderPartial(null);
      return;
    }
    setFolderOp({ path: partial.path, total: plan.deletions.length, done: 0 });
    try {
      const res = await dispatch(deleteVaultItems({ vaultId, itemIds: plan.deletions })).unwrap();
      if (res.failed.length === 0) {
        setFolderPartial(null);
        success(t('teamVaults.items.deleted'));
      } else {
        setFolderPartial({
          op: 'delete',
          path: partial.path,
          done: res.applied.length,
          total: plan.deletions.length,
        });
      }
    } finally {
      setFolderOp(null);
    }
  };

  /**
   * Demander la suppression d'un DOSSIER : le plan est calculé AU CLIC — la
   * matrice de droits s'applique avant le geste, jamais découverte en 403. Rien
   * de supprimable : on le DIT, pas de modale morte.
   */
  const requestDeleteFolder = (fullPath: string) => {
    const plan = planFolderDelete(items, fullPath, (it) => canDelete(it));
    if (plan.deletions.length === 0) {
      error(
        t('teamVaults.folders.deleteRecursiveSkipped', {
          count: plan.skippedContent + plan.skippedMarkers,
        })
      );
      return;
    }
    setFolderToDelete({ path: fullPath, plan });
  };

  const confirmDeleteFolder = async () => {
    const cible = folderToDelete;
    setFolderToDelete(null);
    if (!cible) return;
    // RÉCURSIF (queues-p1) : soft-deletes, la corbeille (30 j) est le filet.
    // Contenus d'abord, marqueurs profond → racine — une interruption laisse un
    // arbre où tout survivant a son dossier. La reprise recalcule le plan depuis
    // le store frais (item_not_found = succès dans le thunk : idempotente).
    setFolderOp({ path: cible.path, total: cible.plan.deletions.length, done: 0 });
    try {
      const res = await dispatch(
        deleteVaultItems({ vaultId, itemIds: cible.plan.deletions })
      ).unwrap();
      if (res.failed.length === 0) {
        setFolderPartial(null);
        success(t('teamVaults.items.deleted'));
        // Si on regardait le dossier supprimé, remonter au parent.
        setCurrentPath((cur) =>
          isDescendantOrSelf(cur, cible.path) && cur !== '' ? parentOf(cible.path) : cur
        );
      } else {
        setFolderPartial({
          op: 'delete',
          path: cible.path,
          done: res.applied.length,
          total: cible.plan.deletions.length,
        });
        const systemic = res.failed.find(
          (f) => f.error !== 'item_version_conflict' && f.error !== 'vault_locked'
        );
        error(
          systemic
            ? t(vaultErrorKey(systemic.error, 'teamVaults.folders.partialFailed'))
            : t('teamVaults.errors.conflict')
        );
      }
    } finally {
      setFolderOp(null);
    }
  };

  /** Le drop interne/externe d'une CIBLE dossier (rangée ou breadcrumb). */
  const dropOnFolder = async (e: React.DragEvent, destPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    setHoverFolder(null);
    setDragOver(false);
    if (!canEdit || uploading || folderOp) return;
    const raw = e.dataTransfer.getData(DND_TYPE);
    if (raw) {
      try {
        const payload = JSON.parse(raw) as MoveSource;
        await submitMove([payload], destPath);
      } catch {
        /* payload illisible : rien à faire */
      }
      return;
    }
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) await uploadFiles(files, destPath);
  };

  const folderDragProps = (destPath: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!canEdit || uploading || folderOp) return;
      if (e.dataTransfer.types.includes(DND_TYPE) || e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        e.stopPropagation();
        setHoverFolder(destPath);
      }
    },
    onDragLeave: () => setHoverFolder((h) => (h === destPath ? null : h)),
    onDrop: (e: React.DragEvent) => void dropOnFolder(e, destPath),
  });

  const kindLabel = (itemType: string): string =>
    itemType === 'note'
      ? t('teamVaults.items.kindNote')
      : itemType === 'transclusion'
        ? t('teamVaults.items.kindTransclusion')
        : t('teamVaults.items.kindFile');

  const trashKindLabel = (it: ServerVaultItemDTO): string =>
    trashMeta[it.id]?.folder ? t('teamVaults.folders.kindFolder') : kindLabel(it.itemType);

  /** Le bouton « Restaurer » d'une ligne de corbeille — même rang que supprimer. */
  const canRestore = (it: ServerVaultItemDTO): boolean =>
    // Le gel ferme AUSSI la restauration : `POST .../restore` porte
    // `blockWhenFrozen`, parce que sortir un élément de la corbeille réécrit le
    // coffre. Le réglage `itemDeleteRequiresAdmin`, lui, ne s'y applique pas.
    canRestoreVaultItem({ ownerUserId: it.ownerUserId }, role, myUserId, frozen);

  /**
   * « Supprimer définitivement » (F20) — PROPRIÉTAIRE SEULEMENT, et pas par
   * excès de prudence : tant que la re-authentification des gestes sensibles est
   * déclarée dans la politique de gouvernance sans être appliquée nulle part
   * côté serveur, la fenêtre de récupération est LA seule protection contre un
   * compte administrateur compromis. Le worker garde la route au même rang ;
   * l'écran ne fait que ranger, il n'autorise rien.
   */
  const canPurge = role === 'owner';

  /**
   * Détruire un élément de la corbeille pour de bon.
   *
   * LE 503 `purge_failed` DIT L'INVERSE DE CE QU'ON CRAINT, et c'est pour cela
   * qu'il a sa phrase : le stockage a refusé, donc RIEN n'a été détruit et
   * l'élément est toujours là — il faut réessayer. Le repli de l'appelant
   * (« impossible de détruire ») laisserait craindre une destruction à moitié
   * faite, c'est-à-dire exactement le contraire. La table `VAULT_ERROR_KEYS` s'en
   * charge ; ici on se contente de ne pas l'écraser.
   *
   * On RELIT la corbeille dans tous les cas — y compris après un refus : sur un
   * 404 (déjà purgé ailleurs) la ligne doit disparaître, sur un 503 elle doit
   * RESTER, et la seule façon honnête de trancher est de redemander.
   */
  const purgeItem = async (itemId: string) => {
    try {
      await apiPurgeVaultItem(vaultId, itemId);
      success(t('teamVaults.trash.purgedItem'));
    } catch (e) {
      error(t(vaultErrorKey(msg(e), 'teamVaults.errors.purgeItemFailed')));
    } finally {
      await loadTrash();
      // Les octets de la corbeille pesaient sur le coffre ; ils viennent de lui
      // être rendus.
      await load();
    }
  };

  return {
    // — Identité & droits
    vaultId,
    vaultName,
    role,
    canEdit,
    /**
     * Le droit d'écriture SANS le gel — réservé à la politique d'org
     * « restreindre le téléchargement », qui est une affaire de RÔLE. Aucun
     * autre appelant ne doit s'en servir : c'est `canEdit` qui dit ce que
     * l'écran a le droit de proposer.
     */
    roleCanEdit,
    /** Le coffre est-il gelé (F23), et depuis quand — le bandeau les affiche. */
    frozen,
    frozenAt,
    frozenBy,
    isVaultAdmin,
    canDelete,
    /** Le réglage de coffre que la matrice du menu doit connaître (F13). */
    itemDeleteRequiresAdmin,
    /**
     * LA POIGNÉE DE RÉGLAGES ENTIÈRE (F27) — pas seulement les deux champs en
     * clair extraits ci-dessus. L'explorateur en a besoin pour DEUX choses que
     * seul le bloc scellé porte : la description affichée dans son fil d'Ariane,
     * et l'épingle (`block.pinnedItemId`) que son menu contextuel pose et
     * retire. On la rend telle quelle plutôt que d'en recopier trois champs :
     * l'écriture a besoin de `stored.version` (compare-and-set), de `seal` et de
     * `blockReadable` — les recopier un à un finirait par en oublier un, et
     * celui qu'on oublierait est celui qui empêche d'écraser un bloc qu'on n'a
     * pas su ouvrir.
     */
    vaultSettings,
    /** L'époque COURANTE de la clé — celle sous laquelle un bloc se rescelle. */
    currentKeyEpoch,
    /** Ce que les confirmations de suppression ont le droit de promettre (F20). */
    trashRetentionDays,
    unlocked,
    staleEpoch,
    myUserId,
    restrictDownload,
    externalSharesDisabled,
    documentFormats,
    // — Contenu
    items,
    decryptStatus,
    loading,
    load,
    collator,
    query,
    setQuery,
    searching,
    currentPath,
    setCurrentPath,
    folders,
    visibleItems,
    // — Sélection multiple (ids d'AFFICHAGE préfixés)
    selectedIds,
    setSelectedIds,
    clearSelection,
    toggleSelected,
    selectRangeTo,
    selectAll,
    replaceSelection,
    // — Duplication d'une sélection (« Dupliquer ici »)
    duplicateProgress,
    duplicateItems,
    // — Quota / envoi
    quota,
    uploading,
    uploadProgress,
    uploadFiles,
    fileInputRef,
    handleFilePicked,
    openFilePicker,
    // — Glisser-déposer
    dragOver,
    setDragOver,
    handleDrop,
    dropOnFolder,
    folderDragProps,
    hoverFolder,
    setHoverFolder,
    // — Remplacement + conflits 409
    replaceInputRef,
    replacing,
    startReplace,
    handleReplacePicked,
    replaceConflict,
    setReplaceConflict,
    conflictOverwrite,
    conflictKeepBoth,
    conflictDownloadTheirs,
    // — Lecture / téléchargement
    preview,
    setPreview,
    handlePreview,
    downloadingId,
    handleDownload,
    downloadProgress,
    handleDownloadMany,
    // — Suppression d'élément
    toDelete,
    setToDelete,
    confirmDelete,
    // — Suppression d'une sélection
    selectionToDelete,
    setSelectionToDelete,
    requestDeleteSelection,
    confirmDeleteSelection,
    // — Dossiers (lots + reprise)
    folderOp,
    folderPartial,
    setFolderPartial,
    resumeFolderPartial,
    newFolder,
    setNewFolder,
    submitNewFolder,
    newDoc,
    setNewDoc,
    submitNewDoc,
    folderRenaming,
    setFolderRenaming,
    submitFolderRename,
    folderToDelete,
    setFolderToDelete,
    requestDeleteFolder,
    confirmDeleteFolder,
    submitMove,
    // — Renommage d'élément
    renaming,
    setRenaming,
    submitRename,
    // — Panneaux / modales
    editingId,
    setEditingId,
    editingItem,
    historyId,
    setHistoryId,
    historyItem,
    sharing,
    setSharing,
    grantSharing,
    setGrantSharing,
    pluginEditing,
    setPluginEditing,
    // — Corbeille d'éléments
    showTrash,
    setShowTrash,
    trash,
    trashError,
    trashMeta,
    loadTrash,
    restoreItem,
    canRestore,
    canPurge,
    purgeItem,
    trashKindLabel,
    kindLabel,
    // — Discipline des dialogues
    runDialogSubmit,
    guardedClose,
  };
}

export type VaultBrowser = ReturnType<typeof useVaultBrowser>;
