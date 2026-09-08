/**
 * AddToVaultDialog — « Ajouter au coffre partagé… », le MÊME geste pour une
 * note, un fichier ou un dossier de l'espace personnel.
 *
 * POURQUOI CE FICHIER EXISTE. Le coffre partagé n'avait qu'une seule porte
 * d'entrée depuis le contenu ordinaire : `MoveNoteToVaultDialog`, réservé aux
 * notes. Un fichier ne pouvait entrer QUE par le bouton « Envoyer » du
 * navigateur de coffre — c'est-à-dire en allant d'abord dans le coffre, puis en
 * ressortant chercher le fichier par un sélecteur de l'OS, alors qu'il était
 * déjà là, sous le curseur, dans Filarr. Et un dossier ne pouvait pas entrer du
 * tout. C'est exactement le « à part » que ce chantier démonte : les éléments
 * doivent être disponibles depuis le contenu normal.
 *
 * `MoveNoteToVaultDialog` est désormais une redirection vers ce composant :
 * une note passe par le MÊME chemin, avec le MÊME comportement qu'avant.
 *
 * LES GARDE-FOUS SONT CEUX DU NAVIGATEUR DE COFFRE, pas de nouveaux :
 *  — seuls les coffres DÉVERROUILLÉS où l'on peut écrire (`canEditVault`, la
 *    matrice partagée) sont proposés : un lecteur ne se voit pas offrir un
 *    dépôt que le serveur refusera. Un coffre GELÉ, lui, reste PROPOSÉ mais
 *    inéligible (`addToVaultTargets`) : le retirer rendrait le geste
 *    introuvable, l'accepter ferait payer tout le téléversement pour un 409 ;
 *  — la taille maximale et le quota sont vérifiés AVANT de lire le moindre
 *    octet — refuser après avoir chargé 500 Mio en mémoire, c'est payer la
 *    lecture pour rien (`uploadFiles` de `useVaultBrowser`, même discipline) ;
 *  — l'envoi est SÉQUENTIEL et s'arrête à la première erreur, avec son vrai
 *    message : dix envois qui échouent en parallèle sur la même cause
 *    n'apprennent rien de plus que le premier.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { Modal, ModalBody, ModalFooter, Select, Button, ProgressBar, Checkbox } from '../ui';
import { useNotification } from '../ui/Notification';
import type { AppDispatch, RootState } from '../../../store';
import {
  selectVaults,
  addVaultItem,
  ensureVaultsLoaded,
  loadVaults,
  type VaultSummary,
} from '../../../store/slices/vaultsSlice';
import {
  deleteNote,
  markNoteSharedToVault,
  saveNotesToDisk,
} from '../../../store/slices/notesSlice';
import { fetchFolders } from '../../../store/slices/foldersSlice';
import { convertFileToVaultShortcut } from '../../../store/slices/filesSlice';
import { selectCanUseTeamVaults } from '../../../store/selectors/authSelectors';
import { canEditVault } from './vaultExplorerModel';
import { vaultErrorKey, errorText } from '../../../services/vault/vaultErrorMessages';
import { joinPath, normalizeFolderName } from '../../../services/vault/vaultPaths';
import { NON_LOCAL_MAX_FILE_SIZE, formatBytes } from '../../../constants/limits';
import { readFile, deleteFile } from '../../../services/core/fileService';
import { getFolder, deleteFolder } from '../../../services/core/folderService';
import { apiGetVaultSeats } from '../../../services/vault/vaultApi';
import { runSequentially } from './addToVaultBatch';
import { addTargetOptions, defaultAddTargetId, writableAddTargets } from './addToVaultTargets';

// ─────────────────────────────────────────────────────────────────────────────
// La partie PURE — celle qu'on peut éprouver hors application
// ─────────────────────────────────────────────────────────────────────────────

/** Un fichier retenu par le parcours, avec sa place des DEUX côtés. */
export interface CollectedVaultFile {
  /** L'identifiant LOCAL — il sert à la corbeille après un « Déplacer ». */
  id: string;
  name: string;
  size: number;
  mime?: string;
  /** Le dossier PERSONNEL qui le contient : le chemin de lecture des octets. */
  sourceFolderId: string;
  /** Le dossier de DESTINATION dans le coffre ('' = racine). */
  path: string;
}

/**
 * Un dossier que le parcours a trouvé VIDE — ni fichier, ni sous-dossier.
 *
 * Sans marqueur il disparaîtrait purement et simplement de l'arborescence
 * reproduite : un dossier de coffre n'existe que par les chemins de ce qu'il
 * contient. `path` est le chemin du PARENT (ce que `meta.path` attend) et
 * `name` le nom du dossier (ce que `meta.title` attend) — exactement la forme
 * que pose « Nouveau dossier » dans le navigateur de coffre.
 *
 * Un dossier vide dont le PARENT contient autre chose n'a pas besoin d'un
 * second marqueur : le chemin du marqueur enfant nomme déjà tous ses préfixes
 * (`allVaultFolderPaths`).
 */
export interface CollectedEmptyFolder {
  path: string;
  name: string;
}

export interface CollectedTree {
  files: CollectedVaultFile[];
  emptyFolders: CollectedEmptyFolder[];
}

/** Ce que l'hôte sait lire d'un dossier personnel. */
export interface FolderChildren {
  folders: Array<{ id: string; name: string }>;
  files: Array<{ id: string; name: string; size: number; mime?: string }>;
}

/** Même plafond que le coffre lui-même : 20 niveaux (voir `vaultPaths`). */
export const MAX_COLLECT_DEPTH = 20;

/**
 * Parcourt un dossier personnel et rend ce qu'il faudra déposer dans le coffre.
 *
 * `childrenOf` est injecté : ce parcours ne connaît ni Redux, ni l'IPC, ni le
 * réseau — c'est ce qui le rend éprouvable hors application, et c'est exactement
 * l'endroit où une erreur (un chemin qui ne reproduit pas l'arborescence, un
 * cycle qui boucle à l'infini) ne se verrait pas à la compilation.
 *
 * LE GARDE-FOU DE CYCLE n'est pas théorique : `folder.items` peut contenir un
 * dossier ET la table des dossiers peut le rattacher au même parent — un même
 * identifiant vu deux fois enverrait deux fois le même sous-arbre.
 */
export async function collectFolderTree(params: {
  root: { id: string; name: string };
  /** Le dossier de destination dans le coffre ('' = racine). */
  basePath?: string;
  childrenOf: (folderId: string) => Promise<FolderChildren>;
  maxDepth?: number;
}): Promise<CollectedTree> {
  const { root, basePath = '', childrenOf, maxDepth = MAX_COLLECT_DEPTH } = params;
  const visited = new Set<string>();
  const files: CollectedVaultFile[] = [];
  const emptyFolders: CollectedEmptyFolder[] = [];

  const walk = async (
    node: { id: string; name: string },
    parentPath: string,
    depth: number
  ): Promise<void> => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    if (depth > maxDepth) throw new Error('folder_too_deep');
    // Jette 'folder_name_invalid' / 'folder_name_too_long' — un nom que le
    // coffre ne saurait pas porter arrête le geste AVANT le premier envoi,
    // plutôt qu'au milieu d'un lot à moitié déposé.
    const path = joinPath(parentPath, normalizeFolderName(node.name));
    const children = await childrenOf(node.id);
    for (const f of children.files) {
      files.push({
        id: f.id,
        name: f.name,
        size: f.size,
        mime: f.mime,
        sourceFolderId: node.id,
        path,
      });
    }
    if (children.files.length === 0 && children.folders.length === 0) {
      emptyFolders.push({ path: parentPath, name: normalizeFolderName(node.name) });
    }
    for (const sub of children.folders) await walk(sub, path, depth + 1);
  };

  await walk(root, basePath, 1);
  return { files, emptyFolders };
}

export type VaultAddRefusal = { reason: 'tooLarge' | 'quotaFull'; name: string; size: number };

/**
 * Le refus EN AMONT — avant d'avoir lu le moindre octet.
 *
 * Le quota est décompté CUMULATIVEMENT : dix fichiers qui passent chacun
 * séparément peuvent très bien ne pas tenir ensemble, et découvrir la place
 * manquante au septième envoi laisse un dossier à moitié déposé.
 */
export function preflightVaultAdd(
  files: ReadonlyArray<{ name: string; size: number }>,
  quota: { used: number; limit: number } | null,
  maxFileSize: number = NON_LOCAL_MAX_FILE_SIZE
): VaultAddRefusal | null {
  for (const f of files) {
    if (f.size > maxFileSize) return { reason: 'tooLarge', name: f.name, size: f.size };
  }
  if (quota && quota.limit > 0) {
    let libre = quota.limit - quota.used;
    for (const f of files) {
      if (f.size > libre) return { reason: 'quotaFull', name: f.name, size: f.size };
      libre -= f.size;
    }
  }
  return null;
}

/**
 * Normaliser ce que `readFile` a bien voulu rendre — Buffer d'IPC, ArrayBuffer
 * du nuage, tableau sérialisé — en octets. JETER PLUTÔT QUE RENDRE VIDE : un
 * repli sur zéro octet déposerait un fichier VIDE dans le coffre sous le nom du
 * vrai, et un « Déplacer » mettrait ensuite l'original à la corbeille.
 * (Même règle, mot pour mot, que `FilePluginEditorModal`.)
 */
export const toBytes = (data: unknown): Uint8Array => {
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(
      view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer
    );
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(data as number[]);
  const serialise = data as { data?: unknown } | null;
  if (serialise && Array.isArray(serialise.data)) return new Uint8Array(serialise.data as number[]);
  throw new Error('unreadable_file_content');
};

// ─────────────────────────────────────────────────────────────────────────────
// Les COFFRES ÉLIGIBLES — la condition d'affichage de l'entrée de menu
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Les coffres où ce compte peut déposer : déverrouillés (on a besoin de K_vault
 * en mémoire pour sceller K_item) et où le rôle écrit.
 *
 * LE GEL N'EST PAS FILTRÉ ICI, ET C'EST VOULU (F23). Un coffre gelé refuse les
 * écritures de contenu, mais le retirer de cette liste rendrait le geste
 * introuvable — et si tous vos coffres sont gelés, l'entrée « Ajouter au
 * coffre » disparaîtrait sans un mot. Il reste donc une destination VISIBLE, que
 * `addToVaultTargets` rend inéligible avec sa raison ; c'est `writableAddTargets`
 * — et pas la longueur de cette liste — qui dit s'il existe une issue.
 *
 * Renvoie une liste VIDE quand l'offre ne donne pas droit aux coffres — d'où la
 * règle d'affichage : pas d'entrée de menu du tout, plutôt qu'une entrée qui
 * ouvrirait un mur de vente. Un menu contextuel n'est pas un endroit où vendre.
 *
 * NE CHARGE RIEN. Ce hook est monté par l'accueil, l'explorateur, la liste des
 * notes ET ce dialogue — quatre montages au premier rendu, qui déclenchaient
 * chacun leur propre lecture derrière une garde locale aveugle aux autres. Le
 * chargement appartient à `VaultsBootstrapHost` (App), l'autorité unique ; ici
 * on ne fait que LIRE ce qu'il a rapporté.
 */
export function useVaultAddTargets(): VaultSummary[] {
  const canUse = useSelector(selectCanUseTeamVaults);
  const vaults = useSelector(selectVaults);
  const unlockedIds = useSelector((s: RootState) => s.vaults.unlockedVaultIds);

  return useMemo(
    () =>
      canUse ? vaults.filter((v) => !!v && unlockedIds.includes(v.id) && canEditVault(v.role)) : [],
    [canUse, vaults, unlockedIds]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Le dialogue
// ─────────────────────────────────────────────────────────────────────────────

/** Ce qu'on peut envoyer dans un coffre depuis le contenu ordinaire. */
export type AddToVaultSource =
  | { kind: 'note'; id: string; title: string; content: string }
  /**
   * Un LOT de notes (sélection multiple de la liste) : le même geste que pour
   * une note, répété séquentiellement — chaque note reçoit son propre
   * élément de coffre ET son propre marqueur `sharedTo`.
   */
  | { kind: 'notes'; notes: Array<{ id: string; title: string; content: string }> }
  | { kind: 'file'; id: string; name: string; size: number; mime?: string; folderId: string }
  | { kind: 'folder'; id: string; name: string };

interface Props {
  isOpen: boolean;
  onClose: () => void;
  source: AddToVaultSource | null;
  /**
   * Le contenu LOCAL vient de changer (un « Déplacer » a mis l'original à la
   * corbeille) — l'hôte relit ce qu'il affiche. L'accueil et la vue dossier ne
   * regardent pas la même chose, c'est donc à eux de dire quoi relire.
   */
  onLocalChanged?: () => void;
}

type Mode = 'copy' | 'move';

/** Le nom d'UN objet ; un lot n'en a pas — l'hôte le nomme par son compte (traduit). */
const sourceName = (s: AddToVaultSource | null): string =>
  !s ? '' : s.kind === 'note' ? s.title : s.kind === 'notes' ? '' : s.name;

export const AddToVaultDialog: React.FC<Props> = ({ isOpen, onClose, source, onLocalChanged }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const { success, error } = useNotification();
  // « Aucun coffre déverrouillé » ne doit pas être affiché AVANT d'avoir la
  // réponse, ni sur une lecture qui a échoué : trois situations très
  // différentes — on charge, on n'a pas pu lire, il n'y a réellement rien.
  const vaultsLoading = useSelector((s: RootState) => s.vaults.loading);
  const vaultsError = useSelector((s: RootState) => s.vaults.error);
  /** Tous les dossiers connus : la seconde source de sous-dossiers (parentId). */
  const foldersById = useSelector((s: RootState) => s.folders.byId);

  /**
   * LA MÊME liste que celle qui décide de l'affichage de l'entrée de menu.
   * Deux filtres d'éligibilité, ce seraient deux vérités possibles sur « où
   * puis-je déposer » — et l'écart se verrait exactement au pire moment : une
   * entrée de menu qui ouvre une boîte disant qu'il n'y a nulle part où aller.
   */
  const eligibleVaults = useVaultAddTargets();

  const [vaultId, setVaultId] = useState('');
  const [mode, setMode] = useState<Mode>('copy');
  /**
   * « Laisser un raccourci à la place » (mode « déplacer », UN fichier). Coché
   * par défaut : c'est le geste qui ne perd rien — le fichier garde sa place
   * ici et s'ouvre dans le coffre. Décoché = comportement historique, la
   * fiche part à la corbeille. v1 : fichiers seulement — un DOSSIER déplacé
   * garde le comportement actuel (corbeille), et les notes ont leur propre
   * lien (`sharedTo`).
   */
  const [leaveShortcut, setLeaveShortcut] = useState(true);
  const [busy, setBusy] = useState(false);
  /** L'avancement d'un lot : `null` tant qu'il n'y a rien à compter. */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  /** Le quota MUTUALISÉ de l'espace, relu à l'ouverture (consultatif, jamais bloquant). */
  const [quota, setQuota] = useState<{ used: number; limit: number } | null>(null);

  // TROIS effets plutôt qu'un, pour que chacun n'ait QUE ses vraies dépendances
  // — un seul effet obligerait à mentir sur l'une ou l'autre.
  useEffect(() => {
    if (!isOpen) return;
    setMode('copy');
    setLeaveShortcut(true);
    setProgress(null);
  }, [isOpen]);

  // Peupler le sélecteur même si l'utilisateur n'a jamais ouvert la vue des
  // coffres (loadVaults déverrouille chaque coffre depuis son wrap d'adhésion).
  // `ensureVaultsLoaded`, PAS `loadVaults` nu : la garde « une demande par
  // session » vit dans le slice (`initialLoadRequested`). L'ancienne garde
  // locale `vaults.length > 0` était aveugle à un chargement déjà EN COURS et
  // à un chargement déjà ABOUTI SUR UNE LISTE VIDE — un compte sans coffre
  // relançait la requête à chaque ouverture de la boîte. Le « Réessayer » du
  // corps, lui, garde `loadVaults` : une relance explicite doit passer outre.
  useEffect(() => {
    if (!isOpen) return;
    void dispatch(ensureVaultsLoaded());
  }, [isOpen, dispatch]);

  /**
   * Le quota, relu à CHAQUE ouverture. `return undefined` explicite : une
   * fonction de nettoyage rendue seulement dans une branche fait échouer la
   * compilation (TS7030) — le piège classique de ce dépôt.
   */
  useEffect(() => {
    if (!isOpen) return undefined;
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
  }, [isOpen]);

  /**
   * Les destinations réellement ouvertes — la liste MOINS les coffres gelés.
   * C'est ce compte-là qui décide si la boîte a une issue ; la liste entière,
   * elle, décide seulement de ce qu'on AFFICHE.
   */
  const writableTargets = useMemo(() => writableAddTargets(eligibleVaults), [eligibleVaults]);
  /**
   * La cible choisie est-elle devenue inéligible ? Le cas arrive vraiment : un
   * autre admin gèle le coffre pendant que la boîte est ouverte, et le résumé
   * Redux le rapporte. Sans ce contrôle, le bouton d'envoi resterait actif sur
   * une destination que le serveur refusera APRÈS le téléversement.
   */
  const targetFrozen = !!vaultId && !writableTargets.some((v) => v.id === vaultId);
  const noWritableTarget = writableTargets.length === 0;

  // Le premier coffre ÉLIGIBLE par défaut — jamais un coffre gelé, qu'on ne
  // pourrait de toute façon pas valider.
  useEffect(() => {
    if (!isOpen || vaultId) return;
    const premier = defaultAddTargetId(eligibleVaults);
    if (premier) setVaultId(premier);
  }, [isOpen, vaultId, eligibleVaults]);

  /**
   * Les enfants d'un dossier personnel, vus des DEUX registres.
   *
   * `folder.items` porte les objets réellement rangés dedans, mais un
   * sous-dossier peut n'être rattaché que par son `parentId` dans la table des
   * dossiers (c'est ce que fait un déplacement). Prendre l'union, dédoublonnée
   * par identifiant, évite qu'une branche entière soit oubliée en silence — un
   * dossier « déposé » dont il manquerait la moitié serait pire que le refus.
   */
  const childrenOf = useCallback(
    async (folderId: string): Promise<FolderChildren> => {
      const folder = await getFolder(folderId);
      const folders: Array<{ id: string; name: string }> = [];
      const files: Array<{ id: string; name: string; size: number; mime?: string }> = [];
      const vus = new Set<string>();
      for (const brut of (folder.items ?? []) as unknown[]) {
        if (!brut || typeof brut !== 'object') continue;
        const enfant = brut as {
          id?: string;
          name?: string;
          items?: unknown;
          type?: string;
          size?: number;
        };
        if (!enfant.id || !enfant.name || vus.has(enfant.id)) continue;
        vus.add(enfant.id);
        /**
         * LA TABLE DES DOSSIERS FAIT AUTORITÉ sur la nature de l'enfant, avant
         * la forme de l'objet inline — c'est l'ordre que suit déjà
         * `selectFolderItems`. Un sous-dossier inline dépourvu de `items` et de
         * `type: 'folder'` serait sinon pris pour un fichier, et on irait
         * demander ses octets à un dossier.
         */
        if (foldersById[enfant.id] || Array.isArray(enfant.items) || enfant.type === 'folder') {
          folders.push({ id: enfant.id, name: enfant.name });
        } else {
          files.push({
            id: enfant.id,
            name: enfant.name,
            size: typeof enfant.size === 'number' ? enfant.size : 0,
            mime: typeof enfant.type === 'string' ? enfant.type : undefined,
          });
        }
      }
      for (const f of Object.values(foldersById)) {
        if (!f || f.parentId !== folderId || f.deletedAt || vus.has(f.id)) continue;
        vus.add(f.id);
        folders.push({ id: f.id, name: f.name });
      }
      return { folders, files };
    },
    [foldersById]
  );

  /** Le message d'un refus AMONT — la phrase du navigateur de coffre, à l'identique. */
  const refusalText = useCallback(
    (r: VaultAddRefusal): string =>
      r.reason === 'tooLarge'
        ? t('teamVaults.items.tooLarge', {
            name: r.name,
            max: formatBytes(NON_LOCAL_MAX_FILE_SIZE),
          })
        : t('teamVaults.items.quotaFull', { name: r.name }),
    [t]
  );

  /** Traduire l'échec d'un envoi — la table des codes, jamais un message brut. */
  const reportError = useCallback(
    (e: unknown) => {
      const code = errorText(e);
      if (code === 'folder_name_invalid' || code === 'folder_name_too_long') {
        error(t('teamVaults.addToVault.badFolderName', { name: sourceName(source) }));
        return;
      }
      if (code === 'folder_too_deep') {
        error(t('teamVaults.folders.tooDeep'));
        return;
      }
      if (code === 'unreadable_file_content') {
        error(t('teamVaults.addToVault.readFailed', { name: sourceName(source) }));
        return;
      }
      error(
        /epoch|conflict/i.test(code)
          ? t('teamVaults.errors.conflict')
          : t(vaultErrorKey(code, 'teamVaults.errors.upload'))
      );
    },
    [error, t, source]
  );

  /**
   * Chaque `submitX` rend VRAI quand le geste a abouti. Un refus amont (taille,
   * quota, dossier vide) rend FAUX : la boîte reste alors OUVERTE, avec le
   * coffre et le mode encore choisis — se refermer sur un avis d'erreur oblige
   * à tout recommencer pour comprendre ce qui vient d'être refusé.
   */

  /**
   * UNE note — le geste d'origine de `MoveNoteToVaultDialog`, plus le LIEN
   * note → copie (`sharedTo`, voir `NoteShareRef` : copie DIVERGENTE, jamais
   * synchronisée) qui nourrit le badge de partage de la liste des notes.
   *
   * PAS DE SYMÉTRIE avec `submitFile` / `submitFolder`, et c'est voulu : le
   * marqueur vit SUR la note, dans `notesSlice`, persisté avec elle dans
   * notes.db. Un fichier ou un dossier personnel n'a aucune entrée là-dedans
   * (ils vivent dans les services de fichiers/dossiers et leur propre manifeste
   * de synchro) — il n'y a nulle part où accrocher un tel lien sans inventer un
   * registre parallèle. Ils ne portent donc pas de badge, et ce n'est pas un
   * oubli à « compléter ».
   *
   * `sourceNoteId` dans la méta est le lien dans l'AUTRE sens (copie → note),
   * pour un futur « ouvrir la note d'origine » depuis le coffre. La méta est
   * chiffrée sous K_item comme le titre (`encryptItemMeta` dans `addVaultItem`) :
   * le serveur ne voit JAMAIS cet identifiant, qui n'a de sens que sur les
   * appareils qui possèdent la note.
   */
  const submitNote = async (
    note: { id: string; title: string; content: string },
    /** `false` dans un lot : UN avis pour le lot, pas un par note. */
    announce = true
  ) => {
    const item = await dispatch(
      addVaultItem({
        vaultId,
        itemType: 'note',
        meta: { title: note.title, sourceNoteId: note.id },
        content: new TextEncoder().encode(note.content),
      })
    ).unwrap();
    // Le marqueur AVANT la corbeille : `deleteNote` est une suppression DOUCE
    // (`deletedAt`), la note garde son `sharedTo` à la corbeille et `restoreNote`
    // la ressuscite avec — un « Déplacer » regretté retrouve son lien. `item`
    // est le `VaultItemSummary` rendu par le thunk : `id` est l'identifiant
    // SERVEUR (le seul qui retrouve la copie), `createdAt` l'instant du dépôt.
    dispatch(
      markNoteSharedToVault({
        noteId: note.id,
        vaultId,
        itemId: item.id,
        mode,
        at: item.createdAt,
      })
    );
    if (mode === 'move') dispatch(deleteNote(note.id));
    // Persister dans les DEUX modes — avant, une copie ne touchait pas le
    // disque, et le marqueur se serait perdu au rechargement. En DELTA : seule
    // cette note traverse le pont IPC, pas le coffre entier (sur 70 Mo de notes,
    // l'écriture pleine figeait le fil ~100 ms). `removedIds` vide même en mode
    // « déplacer » : la corbeille garde la note dans `byId`, rien n'est retiré.
    await dispatch(saveNotesToDisk({ delta: { dirtyIds: [note.id], removedIds: [] } }));
    if (announce) {
      success(
        t(mode === 'move' ? 'teamVaults.moveToVault.moved' : 'teamVaults.moveToVault.copied')
      );
    }
    return true;
  };

  /**
   * UN LOT de notes — `submitNote` répété dans l'ordre de la sélection, par
   * `runSequentially` (doctrine de `submitFolder` : séquentiel, arrêt propre à
   * la première erreur, ce qui est passé reste dans le coffre avec son
   * marqueur `sharedTo` déjà posé et persisté note par note). La jauge est
   * celle du dossier ; l'avis est UN SEUL, pluralisé, plutôt que dix toasts
   * identiques qui se recouvrent.
   *
   * `onLocalChanged` en mode « déplacer » : les notes viennent de partir à la
   * corbeille — l'hôte (la liste) vide sa sélection, qui pointerait sinon sur
   * des lignes qui ne sont plus là.
   */
  const submitNotes = async (
    notes: Array<{ id: string; title: string; content: string }>
  ): Promise<boolean> => {
    if (notes.length === 0) return false;
    const total = await runSequentially(
      notes,
      async (n) => {
        await submitNote(n, false);
      },
      (done, all) => setProgress({ done, total: all })
    );
    if (mode === 'move') onLocalChanged?.();
    success(
      t(
        mode === 'move' ? 'teamVaults.addToVault.notesMoved' : 'teamVaults.addToVault.notesCopied',
        mode === 'move'
          ? '{{count}} notes moved to the vault'
          : '{{count}} notes copied to the vault',
        { count: total }
      )
    );
    return true;
  };

  /** UN fichier — refus de taille et de quota AVANT la lecture des octets. */
  const submitFile = async (file: {
    id: string;
    name: string;
    size: number;
    mime?: string;
    folderId: string;
  }): Promise<boolean> => {
    const refus = preflightVaultAdd([{ name: file.name, size: file.size }], quota);
    if (refus) {
      error(refusalText(refus));
      return false;
    }
    const content = toBytes(await readFile(file.folderId, file.name, true));
    // `sourceFileId` : la référence ARRIÈRE (copie → fichier personnel), le
    // pendant de `sourceNoteId` pour les notes. Dans la méta CHIFFRÉE sous
    // K_item : le serveur ne voit jamais cet identifiant.
    const item = await dispatch(
      addVaultItem({
        vaultId,
        itemType: 'file',
        meta: {
          fileName: file.name,
          mime: file.mime || 'application/octet-stream',
          sourceFileId: file.id,
        },
        content,
      })
    ).unwrap();
    if (mode === 'move' && leaveShortcut) {
      // Les octets sont dans le coffre : ici ne reste que la fiche, devenue
      // raccourci. Si cette moitié échoue, le fichier est BIEN dans le coffre
      // et l'original est toujours là — on le dit tel quel plutôt que de
      // laisser croire à un échec du dépôt (rejouer redéposerait un doublon).
      try {
        await dispatch(
          convertFileToVaultShortcut({
            folderId: file.folderId,
            fileId: file.id,
            vaultId,
            itemId: item.id,
          })
        ).unwrap();
      } catch {
        onLocalChanged?.();
        error(
          t(
            'teamVaults.addToVault.shortcutFailed',
            '“{{name}}” is in the vault, but the shortcut could not be created — the original stays here.',
            { name: file.name }
          )
        );
        return true;
      }
      onLocalChanged?.();
      success(
        t(
          'teamVaults.addToVault.fileMovedShortcut',
          '“{{name}}” moved to the vault — a shortcut stays here.',
          { name: file.name }
        )
      );
      return true;
    }
    if (mode === 'move') {
      // Corbeille locale, jamais suppression définitive — même sémantique que
      // la note : ce qui vient d'entrer dans le coffre reste récupérable ici.
      await deleteFile(file.folderId, file.id, false);
      onLocalChanged?.();
    }
    success(
      t(mode === 'move' ? 'teamVaults.addToVault.fileMoved' : 'teamVaults.addToVault.fileCopied', {
        name: file.name,
      })
    );
    return true;
  };

  /**
   * UN dossier — v1 : parcours récursif, refus EN AMONT, envoi séquentiel.
   *
   * L'arrêt est PROPRE : la première erreur interrompt la file et laisse dans le
   * coffre ce qui est déjà passé (rejouer le geste ne redépose que le reste, un
   * doublon près). Et le « Déplacer » ne met l'original à la corbeille QUE si
   * tout est passé — sinon on effacerait ce qui n'est nulle part ailleurs.
   */
  const submitFolder = async (folder: { id: string; name: string }): Promise<boolean> => {
    setProgress({ done: 0, total: 0 });
    const { files, emptyFolders } = await collectFolderTree({
      root: folder,
      childrenOf,
    });
    if (files.length === 0 && emptyFolders.length === 0) {
      error(t('teamVaults.addToVault.emptyFolder', { name: folder.name }));
      return false;
    }
    const refus = preflightVaultAdd(files, quota);
    if (refus) {
      error(refusalText(refus));
      return false;
    }

    const total = files.length + emptyFolders.length;
    let done = 0;
    setProgress({ done, total });

    // Les marqueurs d'abord : ce sont des envois à zéro octet, et un dossier qui
    // apparaît avant son contenu se lit mieux qu'un contenu sans dossier.
    for (const dossier of emptyFolders) {
      await dispatch(
        addVaultItem({
          vaultId,
          itemType: 'note',
          meta: { folderMarker: true, title: dossier.name, path: dossier.path || undefined },
          content: new Uint8Array(0),
        })
      ).unwrap();
      done++;
      setProgress({ done, total });
    }

    for (const f of files) {
      const content = toBytes(await readFile(f.sourceFolderId, f.name, true));
      await dispatch(
        addVaultItem({
          vaultId,
          itemType: 'file',
          meta: {
            fileName: f.name,
            mime: f.mime || 'application/octet-stream',
            path: f.path || undefined,
          },
          content,
        })
      ).unwrap();
      done++;
      setProgress({ done, total });
      // La jauge suit ce qu'on vient d'occuper, sans attendre un aller-retour.
      setQuota((q) => (q ? { ...q, used: q.used + f.size } : q));
    }

    if (mode === 'move') {
      await deleteFolder(folder.id, false);
      await dispatch(fetchFolders());
      onLocalChanged?.();
    }
    success(
      t(
        mode === 'move'
          ? 'teamVaults.addToVault.folderMoved'
          : 'teamVaults.addToVault.folderCopied',
        { name: folder.name, files: files.length }
      )
    );
    return true;
  };

  const handleSubmit = async () => {
    if (!source || !vaultId || busy) return;
    setBusy(true);
    try {
      const abouti =
        source.kind === 'note'
          ? await submitNote(source)
          : source.kind === 'notes'
            ? await submitNotes(source.notes)
            : source.kind === 'file'
              ? await submitFile(source)
              : await submitFolder(source);
      // Refermer sur un refus effacerait le message ET le choix de coffre.
      if (abouti) onClose();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  // Un lot se nomme par son compte : « 3 notes » là où une note met son titre.
  const nom =
    source?.kind === 'notes'
      ? t('teamVaults.addToVault.notesBatchName', '{{count}} notes', {
          count: source.notes.length,
        })
      : sourceName(source);
  const titleKey =
    mode === 'move' ? 'teamVaults.moveToVault.title' : 'teamVaults.moveToVault.copyTitle';

  return (
    <Modal
      isOpen={isOpen}
      onClose={busy ? () => {} : onClose}
      title={t(titleKey, { name: nom })}
      size="sm"
    >
      <ModalBody>
        {vaultsLoading && eligibleVaults.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">{t('common.loading')}</p>
        ) : vaultsError && eligibleVaults.length === 0 ? (
          <div role="alert" className="flex flex-col items-start gap-2">
            <p className="text-sm text-[var(--color-text-primary)] m-0">
              {t(vaultErrorKey(vaultsError, 'teamVaults.errors.load'))}
            </p>
            <Button size="sm" variant="secondary" onClick={() => dispatch(loadVaults())}>
              {t('teamVaults.retry')}
            </Button>
          </div>
        ) : eligibleVaults.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">
            {t('teamVaults.moveToVault.noVaults')}
          </p>
        ) : (
          <div className="space-y-4">
            <Select
              label={t('teamVaults.moveToVault.vaultLabel')}
              options={addTargetOptions(eligibleVaults, {
                untitled: t('teamVaults.locked'),
                frozen: t('teamVaults.settings.frozen.badge'),
              })}
              value={vaultId}
              onChange={(v) => setVaultId(Array.isArray(v) ? (v[0] ?? '') : v)}
              fullWidth
            />
            {/* LE REFUS ARRIVE AVANT L'ENVOI, pas après. Une option éteinte dit
                « pas là » ; c'est cette phrase qui dit POURQUOI et ce qui le
                lève. Elle n'apparaît que quand le gel change quelque chose :
                aucune destination ouverte, ou celle qu'on a choisie vient de se
                fermer. */}
            {(noWritableTarget || targetFrozen) && (
              <p className="text-sm text-[var(--color-text-secondary)] m-0">
                {t('teamVaults.errors.vaultFrozen')}
              </p>
            )}
            <Select
              label={t('teamVaults.moveToVault.modeLabel')}
              options={[
                { value: 'copy', label: t('teamVaults.moveToVault.modeCopy') },
                { value: 'move', label: t('teamVaults.moveToVault.modeMove') },
              ]}
              value={mode}
              onChange={(v) => setMode((Array.isArray(v) ? v[0] : v) as Mode)}
              fullWidth
            />
            {/* UN fichier en mode « déplacer » : laisser un raccourci ou non.
                Le sous-libellé dit la vraie contrepartie — il n'y a plus qu'une
                version, celle du coffre, et l'ouvrir suppose le coffre déverrouillé. */}
            {mode === 'move' && source?.kind === 'file' && (
              <div>
                <Checkbox
                  label={t('teamVaults.addToVault.leaveShortcut', 'Leave a shortcut in its place')}
                  checked={leaveShortcut}
                  onChange={(e) => setLeaveShortcut(e.target.checked)}
                  disabled={busy}
                />
                <p className="text-xs text-[var(--color-text-secondary)] m-0 mt-1">
                  {t(
                    'teamVaults.addToVault.leaveShortcutHint',
                    'The file will only exist in the vault; the shortcut opens it there (unlocked vault required).'
                  )}
                </p>
              </div>
            )}
            {/* L'ATTENTE A UN NOM. Un dossier de deux cents fichiers passait
                sinon plusieurs minutes derrière un bouton qui tournait, sans
                dire combien il en restait. */}
            {busy && progress !== null && (
              <div aria-live="polite">
                <p className="text-xs text-[var(--color-text-secondary)] m-0 mb-1">
                  {progress.total === 0
                    ? t('teamVaults.addToVault.scanning')
                    : t('teamVaults.addToVault.progress', {
                        done: progress.done,
                        total: progress.total,
                      })}
                </p>
                {progress.total > 0 && (
                  <ProgressBar
                    value={Math.round((progress.done / progress.total) * 100)}
                    size="sm"
                  />
                )}
              </div>
            )}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          onClick={handleSubmit}
          loading={busy}
          disabled={!vaultId || eligibleVaults.length === 0 || targetFrozen}
        >
          {t(
            mode === 'move'
              ? 'teamVaults.moveToVault.submitMove'
              : 'teamVaults.moveToVault.submitCopy'
          )}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default AddToVaultDialog;
