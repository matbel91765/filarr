/**
 * vaultExplorerModel — la partie PURE du navigateur de coffre : l'adaptation du
 * modèle de coffre vers les cartes de l'explorateur, et la matrice de droits.
 *
 * POURQUOI UN MODULE À PART. Ce fichier n'importe ni React, ni Redux, ni le
 * réseau — seulement `vaultPaths` (lui-même pur) et des types. C'est ce qui le
 * rend ÉPROUVABLE hors application : la règle « qui peut supprimer quoi » et la
 * traduction « élément de coffre → carte » sont exactement les deux endroits où
 * une erreur ne se verrait pas à la compilation (un booléen inversé compile
 * parfaitement) et coûterait cher — un lecteur à qui l'on propose de détruire
 * le travail d'un autre, ou deux mondes dont les identifiants se croisent.
 *
 * Le reste — les thunks, la crypto, les états — vit dans `useVaultBrowser`.
 */

import { normalizePath, joinPath, isDescendantOrSelf } from '../../../services/vault/vaultPaths';
import type { ItemMenuCapabilities } from '../files/itemContextMenu';

// ─────────────────────────────────────────────────────────────────────────────
// Identifiants — deux mondes, jamais confondus
// ─────────────────────────────────────────────────────────────────────────────

/** Préfixe d'un DOSSIER VIRTUEL de coffre (les dossiers n'ont pas d'id serveur). */
export const VAULT_DIR_PREFIX = 'vaultdir:';
/** Préfixe d'un ÉLÉMENT de coffre — jamais l'id nu, pour ne pas croiser l'espace perso. */
export const VAULT_ITEM_PREFIX = 'vaultitem:';

/** `vaultdir:Contrats/2026` → `Contrats/2026` ; toute autre entrée → ''. */
export function pathFromDirId(id: string): string {
  return id.startsWith(VAULT_DIR_PREFIX) ? id.slice(VAULT_DIR_PREFIX.length) : '';
}

/** `vaultitem:abc` → `abc` ; toute autre entrée → ''. */
export function idFromItemId(id: string): string {
  return id.startsWith(VAULT_ITEM_PREFIX) ? id.slice(VAULT_ITEM_PREFIX.length) : '';
}

// ─────────────────────────────────────────────────────────────────────────────
// L'adaptateur
// ─────────────────────────────────────────────────────────────────────────────

/**
 * La forme MINIMALE qu'attend ce module d'un élément de coffre —
 * structurellement, pas nominalement : `VaultItemSummary` y est assignable tel
 * quel, et une fixture de sonde aussi, sans monter le store.
 */
export interface VaultItemLike {
  id: string;
  ownerUserId: string | null;
  itemType: string;
  sizeBytes: number;
  updatedAt: string;
  meta: {
    title?: string;
    fileName?: string;
    mime?: string;
    path?: string;
    folderMarker?: boolean;
    threadFor?: string;
  };
}

export interface VaultDisplayFolderModel {
  id: string;
  name: string;
  /** Le chemin réel dans la méta chiffrée ('Contrats/2026'). */
  path: string;
  /**
   * Les identifiants des descendants — la convention de `ExplorerFolder`. Sa
   * SEULE présence marque « ceci est un dossier » du point de vue des cartes
   * (`'items' in item`), et sa longueur remplit le « n élément(s) ».
   */
  items: string[];
}

/**
 * LE GENRE D'UN ÉLÉMENT DE COFFRE, tel que la carte doit le montrer.
 *
 * `itemType` arrive du serveur comme une CHAÎNE LIBRE, et c'est pour cela que
 * cette traduction existe plutôt qu'un transtypage : un type d'une version
 * future, une valeur vide ou une casse inattendue doivent retomber sur
 * « fichier ordinaire ». Le repli n'est pas neutre — promettre une note ouvre un
 * éditeur de texte, et l'ouvrir sur des octets qui n'en sont pas est le genre de
 * geste qui réécrit un format en le refermant.
 *
 * (Un élément dont la méta ne se DÉCHIFFRE pas n'arrive jamais jusqu'ici : il
 * est écarté de la liste et compté à part — c'est le bandeau
 * `teamVaults.decryptWarning` qui le dit, pas une carte.)
 */
export type VaultItemKind = 'note' | 'transclusion' | 'file';

export function vaultItemKind(item: { itemType: string }): VaultItemKind {
  if (item.itemType === 'note') return 'note';
  if (item.itemType === 'transclusion') return 'transclusion';
  return 'file';
}

export interface VaultDisplayFileModel<T extends VaultItemLike = VaultItemLike> {
  id: string;
  name: string;
  type?: string;
  size: number;
  updatedAt: string;
  /**
   * Note, note intégrée ou fichier — ce qui permet à la carte de le montrer
   * SANS lire le nom. Il vit ici et pas dans la carte parce que `FileCard` ne
   * connaît ni Redux ni le modèle de coffre : ce champ est le fil qui relie
   * `itemType` à l'icône, et c'est lui que les tests tendent.
   */
  kind: VaultItemKind;
  /** L'élément de coffre d'origine — jamais aplati, jamais recopié. */
  source: T;
}

export interface VaultDisplayItemsModel<T extends VaultItemLike = VaultItemLike> {
  folders: VaultDisplayFolderModel[];
  files: Array<VaultDisplayFileModel<T>>;
}

/**
 * Traduit le contenu d'un dossier de coffre en cartes d'explorateur.
 *
 * SIGNATURE. Elle prend ce qui a DÉJÀ été dérivé par `useVaultBrowser`
 * (`folderNames` via `deriveFolders` + tri collator, `visibleItems` via le
 * filtre de chemin) au lieu de re-dériver : deux dérivations, ce seraient deux
 * vérités possibles sur « qu'y a-t-il dans ce dossier », et c'est exactement ce
 * que ce chantier cherche à empêcher.
 *
 * `allItems` ne sert qu'à COMPTER le contenu d'un sous-dossier : un dossier de
 * coffre n'a pas de liste d'enfants, il n'existe que par les chemins de ses
 * descendants.
 *
 * INVARIANT tenu ici : un FICHIER ne porte JAMAIS la clé `items` (sans quoi la
 * carte le prendrait pour un dossier et irait chercher une icône de dossier,
 * un compteur d'éléments et des cibles de dépôt qui n'ont pas de sens).
 */
export function toVaultDisplayItems<T extends VaultItemLike>(params: {
  allItems: readonly T[];
  folderNames: readonly string[];
  visibleItems: readonly T[];
  currentPath: string;
  untitled: string;
}): VaultDisplayItemsModel<T> {
  const { allItems, folderNames, visibleItems, currentPath, untitled } = params;

  const folders: VaultDisplayFolderModel[] = folderNames.map((name) => {
    const path = joinPath(currentPath, name);
    // Les DESCENDANTS réels : ni marqueurs de dossier, ni fils de discussion —
    // ce sont des implémentations, pas du contenu.
    const contained = allItems
      .filter(
        (i) =>
          !i.meta.folderMarker &&
          !i.meta.threadFor &&
          isDescendantOrSelf(normalizePath(i.meta.path), path)
      )
      .map((i) => VAULT_ITEM_PREFIX + i.id);
    return { id: VAULT_DIR_PREFIX + path, name, path, items: contained };
  });

  const files: Array<VaultDisplayFileModel<T>> = visibleItems.map((item) => ({
    id: VAULT_ITEM_PREFIX + item.id,
    name: item.meta.fileName || item.meta.title || untitled,
    // Le MIME chiffré dans la méta : il ne sert qu'à affiner l'icône de type.
    type: item.meta.mime,
    size: item.sizeBytes,
    updatedAt: item.updatedAt,
    kind: vaultItemKind(item),
    source: item,
  }));

  return { folders, files };
}

/**
 * Tous les dossiers du coffre, chemins complets et triés — les destinations
 * possibles d'un « Déplacer ». Union des préfixes de tous les chemins ET des
 * marqueurs : exactement la règle des dossiers implicites de `vaultPaths`.
 */
export function allVaultFolderPaths(
  items: readonly VaultItemLike[],
  collator: Intl.Collator
): string[] {
  const set = new Set<string>();
  for (const it of items) {
    const p = normalizePath(it.meta.path);
    if (p) {
      const segs = p.split('/');
      for (let i = 1; i <= segs.length; i++) set.add(segs.slice(0, i).join('/'));
    }
    if (it.meta.folderMarker && it.meta.title) {
      set.add(joinPath(p, it.meta.title.normalize('NFC')));
    }
  }
  return [...set].sort((a, b) => collator.compare(a, b));
}

// ─────────────────────────────────────────────────────────────────────────────
// Les badges « Partagé » — de l'index des grants aux props des cartes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Combien d'ÉLÉMENTS partagés un dossier contient — le nombre de descendants
 * qui portent au moins un grant vivant, PAS la somme des grants : « contient 3
 * éléments partagés » se lit ; « 7 personnes cumulées sur 3 fichiers » ne dit
 * rien à qui regarde une tuile de dossier.
 *
 * Un dossier de coffre n'existe que par les chemins de ses descendants (voir
 * `toVaultDisplayItems`) : on remonte donc le préfixe de chemin, avec la même
 * règle d'exclusion — ni marqueurs de dossier, ni fils de discussion, qui sont
 * des implémentations et non du contenu (et qu'on ne peut pas partager :
 * `vaultFileCaps.shareWithPerson` refuse les marqueurs).
 *
 * `grantMap` est celle de `selectGrantCountMap` : clé = id NU de l'élément,
 * absence = zéro.
 */
/**
 * Cet élément est-il un CONTENU PARTAGEABLE situé sous ce dossier ?
 *
 * Extrait de `folderGrantRollup` pour que la question n'ait qu'UNE définition :
 * le rattrapage des accès (`services/vault/folderGrantPlan`) la pose aussi, et
 * deux implémentations divergeraient de façon invisible — l'une compterait un
 * fichier que l'autre partagerait.
 *
 * Écarte les MARQUEURS de dossier et les FILS de discussion : ce sont des
 * implémentations et non du contenu, et `vaultFileCaps.shareWithPerson` refuse
 * déjà de les partager.
 */
export function isShareableUnder(item: VaultItemLike, path: string): boolean {
  if (item.meta.folderMarker || item.meta.threadFor) return false;
  return isDescendantOrSelf(normalizePath(item.meta.path), path);
}

export function folderGrantRollup(
  items: readonly VaultItemLike[],
  grantMap: ReadonlyMap<string, number>,
  path: string
): number {
  // Le cas de loin le plus courant (rien n'est partagé) ne parcourt rien.
  if (grantMap.size === 0) return 0;
  let count = 0;
  for (const it of items) {
    if ((grantMap.get(it.id) ?? 0) < 1) continue;
    if (isShareableUnder(it, path)) count++;
  }
  return count;
}

/** Les infobulles, déjà traduites par l'écran — ce module ne connaît pas i18n. */
export interface SharedCardLabels {
  /** « Partagé avec N personne(s) » */
  sharedWith: (count: number) => string;
  /** « Contient N élément(s) partagé(s) » */
  folderContains: (count: number) => string;
}

/** Ce qu'une `FileCard` reçoit — deux PRIMITIVES, pour ne pas casser son `React.memo`. */
export interface SharedFileCardProps {
  sharedCount: number;
  sharedTitle: string;
}

/** Ce qu'une `SubfolderCard` reçoit (`sharedRollup`) — un objet, mais STABLE : il vit dans la Map. */
export interface SharedFolderCardProps {
  count: number;
  title: string;
}

export interface SharedCardPropsModel {
  /** Clé = id d'AFFICHAGE du fichier (`vaultitem:…`), celui que la carte porte. */
  byFileId: ReadonlyMap<string, SharedFileCardProps>;
  /** Clé = id d'AFFICHAGE du dossier (`vaultdir:…`). */
  byFolderId: ReadonlyMap<string, SharedFolderCardProps>;
}

const NO_SHARED_CARD_PROPS: SharedCardPropsModel = {
  byFileId: new Map(),
  byFolderId: new Map(),
};

/**
 * LE FIL entre l'index des grants et les cartes — la fonction que calcule le
 * `useMemo` de `VaultFolderView`, sortie ici pour être éprouvée sans DOM.
 *
 * POURQUOI ELLE EXISTE. `offlineStatus` a été pendant des mois une prop de
 * `FileCard` que personne ne passait : la pastille existait, la donnée aussi,
 * et rien ne les reliait — et comme rien ne le testait, personne ne l'a vu.
 * Ici, le test de ce module vérifie que pour un grant donné, la carte du
 * fichier reçoit SON compte et SON infobulle, et que la tuile du dossier
 * parent reçoit son cumul. Si un futur refactor coupe le fil, ce test tombe.
 *
 * Seuls les éléments RÉELLEMENT partagés ont une entrée : la carte lit
 * `.get(id)?.sharedCount` et se rend sans badge pour les autres, sans qu'on ait
 * à fabriquer des zéros. Les objets de `byFolderId` sont créés UNE fois par
 * calcul : tant que les entrées du `useMemo` ne bougent pas, la tuile reçoit
 * la même référence et son `React.memo` tient.
 */
export function buildSharedCardProps(params: {
  allItems: readonly VaultItemLike[];
  files: ReadonlyArray<{ id: string; source: { id: string } }>;
  folders: ReadonlyArray<{ id: string; path: string }>;
  grantMap: ReadonlyMap<string, number>;
  labels: SharedCardLabels;
}): SharedCardPropsModel {
  const { allItems, files, folders, grantMap, labels } = params;
  if (grantMap.size === 0) return NO_SHARED_CARD_PROPS;

  const byFileId = new Map<string, SharedFileCardProps>();
  for (const f of files) {
    const count = grantMap.get(f.source.id) ?? 0;
    if (count > 0)
      byFileId.set(f.id, { sharedCount: count, sharedTitle: labels.sharedWith(count) });
  }

  const byFolderId = new Map<string, SharedFolderCardProps>();
  for (const d of folders) {
    const count = folderGrantRollup(allItems, grantMap, d.path);
    if (count > 0) byFolderId.set(d.id, { count, title: labels.folderContains(count) });
  }

  return { byFileId, byFolderId };
}

// ─────────────────────────────────────────────────────────────────────────────
// La matrice de droits — LA MÊME que celle du serveur
// ─────────────────────────────────────────────────────────────────────────────

export type VaultRole = string;

/** Un rôle qui administre le coffre. */
export function isVaultAdminRole(role: VaultRole): boolean {
  return role === 'admin' || role === 'owner';
}

/**
 * Un rôle qui peut ÉCRIRE. Le Worker le refait sur chaque route d'écriture.
 *
 * LE SECOND ÉCHELON EST LE GEL (F23), et il est ORTHOGONAL au rôle. Un coffre
 * gelé est en lecture seule pour TOUT LE MONDE, propriétaire compris : le worker
 * pose `blockWhenFrozen` sur les onze routes d'écriture de CONTENU (création,
 * morceaux, finalisation, révisions, commit, méta, grants, suppression,
 * restauration) et répond 409 `vault_frozen`. Il ne le pose nulle part ailleurs
 * — retirer quelqu'un, révoquer une invitation, renouveler la clé, quitter,
 * dégeler restent ouverts, sans quoi geler suffirait à rendre son propre accès
 * irrévocable.
 *
 * FAUX PAR DÉFAUT, ET CE DÉFAUT COMPTE. Même discipline que
 * `itemDeleteRequiresAdmin` : un écran qui ne connaît pas l'état de gel se
 * comporte comme avant la fiche. Retirer des gestes sur une ignorance rendrait
 * introuvable un geste légitime ; les proposer sur un coffre gelé récolte un
 * refus que le serveur nomme et que l'écran traduit déjà.
 */
export function canEditVault(role: VaultRole, frozen = false): boolean {
  if (frozen) return false;
  return role !== 'viewer';
}

/**
 * OÙ S'OUVRE UNE NOTE DE COFFRE — la fenêtre, ou l'éditeur complet.
 *
 * DEUX CADRES, DEUX USAGES. Depuis l'explorateur d'un coffre, un double-clic sur
 * une note menait toujours à la même fenêtre (`VaultNoteEditor` en variante
 * `Modal`). Elle est parfaite pour CONSULTER : légère, posée par-dessus la
 * grille, refermée d'un geste, elle ne fait pas perdre le dossier qu'on
 * regardait. Elle est trop étroite pour ÉCRIRE — on rédige dans le panneau de
 * l'onglet Notes (`VaultNotePane`), qui est la destination que la section
 * « Coffres partagés » vise déjà, et le même éditeur y monte, dans son cadre
 * `pane`.
 *
 * LE DISCRIMINANT EST « PUIS-JE ÉCRIRE CETTE NOTE MAINTENANT », PAS LE RÔLE, et
 * c'est toute la raison de passer par `canEditVault` plutôt que de tester
 * `role !== 'viewer'` sur place. Un coffre GELÉ (F23) est en lecture seule pour
 * TOUT LE MONDE, propriétaire compris : y emmener quelqu'un dans l'éditeur
 * complet lui promettrait une rédaction que le worker refusera (409
 * `vault_frozen`) au premier enregistrement.
 *
 * TOUTE IGNORANCE MÈNE À LA FENÊTRE. Rôle absent, rôle d'une version future,
 * gel qu'on n'a pas su lire : la fenêtre est le choix qui ne promet rien — et il
 * se trouve être, à la ligne près, le comportement d'avant ce chantier. C'est
 * pourquoi le repli est ici plus prudent qu'ailleurs dans cette matrice, où
 * `frozen` vaut faux par défaut : là-bas un repli strict RETIRERAIT un geste
 * légitime ; ici il n'en retire aucun, il choisit seulement le cadre modeste.
 *
 * LES RANGS SONT ÉNUMÉRÉS, et cette liste est la seule chose que ce module
 * ajoute à `canEditVault`. Le worker ne connaît que quatre rangs (`ROLE_RANK` :
 * viewer, member, admin, owner) et refuse tout le reste (rang -1). `canEditVault`,
 * lui, rend `true` pour n'importe quelle chaîne qui n'est pas 'viewer' — ce qui
 * est le bon repli pour un MENU (proposer un geste qui récoltera un refus nommé
 * vaut mieux que le rendre introuvable), mais le mauvais pour un CADRE : un rang
 * inventé installerait la personne dans un éditeur complet, hors de son
 * explorateur, pour rien.
 */
export type VaultNoteOpenTarget = 'pane' | 'modal';

/** Les rangs que le serveur CONNAÎT — `ROLE_RANK`, worker `vaults.ts`. */
const KNOWN_VAULT_ROLES: readonly VaultRole[] = ['viewer', 'member', 'admin', 'owner'];

export function vaultNoteOpenTarget(input: {
  role: VaultRole | null | undefined;
  /** Le coffre est-il gelé ? `undefined`/`null` = on ne sait pas → la fenêtre. */
  frozen: boolean | null | undefined;
}): VaultNoteOpenTarget {
  const { role, frozen } = input;
  if (!role || !KNOWN_VAULT_ROLES.includes(role)) return 'modal';
  if (typeof frozen !== 'boolean') return 'modal';
  return canEditVault(role, frozen) ? 'pane' : 'modal';
}

/**
 * Qui peut supprimer quoi — la règle du serveur, reproduite telle quelle.
 *
 * `infra/cloudflare-worker/src/vaults.ts`, route `DELETE /:id/items/:itemId` :
 *
 *   1. `requireVaultRole(c, 'member')`   → un LECTEUR est refusé d'entrée (403)
 *   2. `isItemOwner || isVaultAdmin`     → sinon `vault_forbidden`
 *
 * LE PREMIER ÉCHELON MANQUAIT CÔTÉ CLIENT. La condition n'était que
 * `isVaultAdmin || item.ownerUserId === myUserId` : un membre rétrogradé en
 * lecture seule continuait donc de se voir proposer « Supprimer » sur tout ce
 * qu'il avait déposé, avec une confirmation qui promettait la suppression, pour
 * récolter un 403 que rien n'annonçait. Le cas n'est pas théorique — c'est
 * exactement ce que produit une rétrogradation, le geste d'administration le
 * plus courant après l'invitation. (Trouvé à la sonde : `tsc` ne voit pas un
 * échelon de droits absent.)
 *
 * Le correctif ne peut RIEN ouvrir : il ne fait que retirer un bouton qui
 * n'aboutissait jamais. Écrit ICI une seule fois — un client plus permissif que
 * le serveur, c'est une promesse non tenue ; plus strict, c'est un geste
 * légitime rendu introuvable.
 */
export function canDeleteVaultItem(
  item: { ownerUserId: string | null },
  role: VaultRole,
  myUserId: string | null,
  /**
   * LE RÉGLAGE DE COFFRE `itemDeleteRequiresAdmin` (F13), appliqué par le
   * serveur en UN point — la route de suppression, qui répond alors 403
   * `setting_forbidden`. Il remplace « déposant OU admin » par « admin », y
   * compris pour son PROPRE dépôt : c'est tout l'objet du réglage.
   *
   * PAR DÉFAUT FAUX, et ce défaut compte : un coffre qui n'a jamais rien réglé,
   * et un coffre dont on n'a pas su LIRE les réglages, se comportent comme
   * avant la fiche. Retirer ce bouton sur une panne de lecture rendrait
   * introuvable un geste parfaitement légitime — la règle du dépôt est qu'un
   * client plus permissif récolte un refus nommé, tandis qu'un client plus
   * strict ne récolte rien du tout.
   */
  itemDeleteRequiresAdmin = false,
  /**
   * LE COFFRE EST-IL GELÉ (F23) ? `DELETE /:id/items/:itemId` porte
   * `blockWhenFrozen` : la suppression est une écriture de contenu, et elle est
   * refusée 409 `vault_frozen` quel que soit le rang. Faux par défaut, comme le
   * réglage ci-dessus, et pour la même raison.
   */
  frozen = false
): boolean {
  if (!canEditVault(role, frozen)) return false;
  if (itemDeleteRequiresAdmin) return isVaultAdminRole(role);
  return isVaultAdminRole(role) || (!!myUserId && item.ownerUserId === myUserId);
}

/**
 * Qui peut SORTIR un élément de la corbeille. Le serveur le dit lui-même :
 * « Même rang que la suppression » (`POST /:id/items/:itemId/restore`, gate
 * `requireVaultRole(c, 'member')` puis propriétaire-ou-admin).
 *
 * MAIS LE RÉGLAGE `itemDeleteRequiresAdmin` NE S'Y APPLIQUE PAS, et la position
 * du quatrième argument est là pour qu'on ne puisse pas le brancher par
 * distraction : la route de restauration ne lit PAS les réglages du coffre. Le
 * réglage s'appelle « suppression réservée aux administrateurs », pas
 * « corbeille réservée » — reproduire ici une garde que le serveur n'a pas
 * retirerait un bouton qui, lui, aboutit.
 *
 * LE GEL, LUI, S'Y APPLIQUE, et c'est justement l'asymétrie qui mérite d'être
 * écrite : `restore` porte `blockWhenFrozen` là où il ne lit pas les réglages.
 * Sortir un élément de la corbeille RÉÉCRIT le coffre — un coffre gelé, c'est un
 * coffre dont le contenu ne bouge plus, dans les deux sens.
 */
export function canRestoreVaultItem(
  item: { ownerUserId: string | null },
  role: VaultRole,
  myUserId: string | null,
  frozen = false
): boolean {
  return canDeleteVaultItem(item, role, myUserId, false, frozen);
}

/**
 * QUI PEUT ÉPINGLER UNE NOTE À L'APERÇU (F27), ET SUR QUOI.
 *
 * ADMINISTRATEURS SEULEMENT, parce que le geste ÉCRIT les réglages du coffre
 * (`PUT /:id/settings`, réservé au rang admin par le worker) : l'offrir à un
 * membre ne lui donnerait qu'un refus. Ce n'est pas une préférence personnelle
 * — l'épingle est vue par tout le coffre, elle appartient à l'équipe.
 *
 * PAS SUR UN MARQUEUR DE DOSSIER : il n'existe que pour tenir un dossier vide,
 * il n'a rien à ouvrir ni à montrer.
 *
 * ET LE GEL NE LA FERME PAS — c'est le seul point de cette matrice où `frozen`
 * ne change rien, et il vaut mieux l'écrire. Le worker grève du 409
 * `vault_frozen` les écritures de CONTENU ; les réglages, les invitations,
 * l'effectif et la rotation continuent. Retirer l'épingle d'un coffre gelé
 * inventerait une interdiction que le serveur n'applique pas — et un coffre
 * archivé est justement celui où l'on veut mettre en avant « lisez ceci
 * d'abord ».
 *
 * CE PARAGRAPHE-LÀ N'EST PAS UN PARAMÈTRE. La fonction a porté un `frozen?`
 * qu'elle ne LISAIT jamais : un test lui passait `frozen: true` et croyait
 * garder la règle, alors qu'il ne gardait rien du tout. La règle réelle est
 * l'ABSENCE de `&& !ctx.frozen` dans `vaultFileCaps` autour de `pin`/`unpin` —
 * c'est là qu'elle se vérifie, et c'est là que le garde-fou est posé. Un
 * paramètre mort qui a l'air d'une garde est pire que pas de garde.
 *
 * La règle vit ICI, avec le reste de la matrice de droits, et non dans
 * `pinnedItemModel` : c'est ce fichier qui répond à « qui a le droit de quoi »,
 * et une seconde réponse ailleurs finirait par diverger de celle du menu.
 */
export function mayTogglePin(input: {
  role: VaultRole;
  folderMarker: boolean | undefined;
}): boolean {
  return isVaultAdminRole(input.role) && !input.folderMarker;
}

/** Le contexte de droits d'un écran de coffre, tel que le hook le connaît. */
export interface VaultCapsContext {
  role: VaultRole;
  myUserId: string | null;
  /** Politique d'org : les LECTEURS ne téléchargent pas. */
  restrictDownload: boolean;
  /** Politique d'org : aucun lien de partage externe. */
  externalSharesDisabled: boolean;
  /** Une recherche GLOBALE est en cours — déplacer n'y a pas de sens. */
  searching: boolean;
  /**
   * Réglage DU COFFRE (F13) : supprimer exige-t-il le rang admin ? Optionnel, et
   * faux par défaut — un écran qui n'a pas lu les réglages se comporte comme
   * avant la fiche plutôt que de retirer des gestes sur une ignorance.
   */
  itemDeleteRequiresAdmin?: boolean;
  /**
   * LE COFFRE EST-IL GELÉ (F23) ? Optionnel, et faux par défaut — un écran qui
   * n'a pas lu l'état du coffre se comporte comme avant la fiche plutôt que de
   * retirer des gestes sur une ignorance.
   */
  frozen?: boolean;
  /**
   * L'ÉLÉMENT ÉPINGLÉ À L'APERÇU (F27), tel que le bloc scellé des réglages le
   * porte. `undefined` recouvre DEUX faits qu'on ne cherche pas à distinguer
   * ici : rien n'est épinglé, ou cet écran n'a pas su ouvrir le bloc. Dans les
   * deux cas le menu propose « Épingler » — le geste, lui, refuse d'écrire un
   * bloc illisible et le DIT (`useVaultPin`), plutôt que d'écraser en silence
   * ce qu'un autre membre lit encore.
   */
  pinnedItemId?: string;
}

/**
 * Les capacités du menu contextuel d'un ÉLÉMENT de coffre.
 *
 * Une capacité absente = « cet écran ne propose pas ce geste ». On préfère
 * RETIRER que griser : un bouton grisé invite à chercher pourquoi, un geste
 * absent dit simplement que ce rôle consulte.
 */
export function vaultFileCaps(
  item: VaultItemLike,
  ctx: VaultCapsContext,
  hasPluginEditor: boolean
): ItemMenuCapabilities {
  /**
   * DEUX LECTURES DU MÊME DROIT, ET LES CONFONDRE COÛTE LE CONTENU (F23).
   *
   * `canEdit` porte le gel : c'est lui qui décide des gestes d'écriture.
   * `roleCanEdit` ne porte QUE le rôle, et il n'a qu'un usage — la politique
   * d'org « les lecteurs ne téléchargent pas ». Le gel n'a rien à voir avec
   * elle : geler veut dire « ça reste lisible », et faire tomber `download`
   * avec `canEdit` rendrait le contenu d'un coffre archivé inaccessible à ses
   * propres membres, c'est-à-dire l'inverse exact de ce qu'on leur promet.
   */
  const roleCanEdit = canEditVault(ctx.role);
  const canEdit = canEditVault(ctx.role, ctx.frozen);
  const isFile = item.itemType === 'file';
  return {
    // Une note s'OUVRE (son éditeur) ; un fichier revendiqué par un greffon
    // s'ouvre dans CET éditeur — les deux gestes de tête de la vue dossier.
    open: item.itemType === 'note',
    openInEditor: isFile && hasPluginEditor,
    preview: isFile,
    download: !(ctx.restrictDownload && !roleCanEdit),
    rename: canEdit,
    replace: isFile && canEdit,
    move: canEdit && !ctx.searching,
    // L'historique est ouvert à TOUS les membres : un lecteur consulte, seul
    // celui qui peut écrire restaure (VaultItemHistory applique `canEdit`).
    versions: true,
    // Le panneau de détails est ouvert à TOUS les membres : il ne fait que
    // montrer (taille, dates, qui a accès) — un marqueur de dossier n'a rien à
    // montrer, il n'existe que pour tenir un dossier vide.
    details: !item.meta.folderMarker,
    /**
     * « Gérer l'accès » — le dialogue unifié — est ouvert à TOUT membre, lecteur
     * compris : le listing des accès (membres, personnes nommées, lien) se
     * CONSULTE ; ce sont les gestes dedans (inviter, sceller) que le dialogue
     * retire selon le rôle (`shareDialogSections`). Un marqueur de dossier
     * n'est pas un contenu : rien à y partager, rien à y lister.
     */
    manageAccess: !item.meta.folderMarker,
    /**
     * LE LIEN PUBLIC SUIT LE GEL, ALORS QUE LE SERVEUR NE LE GÈLE PAS — et
     * c'est le seul endroit de ce fichier où le client est plus strict que le
     * contrat, donc il se dit. `canEdit` porte le gel : l'entrée disparaît
     * d'un coffre gelé, sans que la route de création de lien, elle, refuse
     * quoi que ce soit.
     *
     * Ce n'est PAS une interdiction, et ça ne doit pas se lire comme telle :
     * « Gérer l'accès » reste ouvert et mène au même dialogue, dont la section
     * « lien » ne dépend que du rôle (`shareDialogSections`). C'est un menu qui
     * range un raccourci d'écriture pendant qu'un bandeau annonce que rien ne
     * change ici. Si le worker vient à geler la création de liens, cette ligne
     * sera déjà juste ; en attendant, elle ne retire l'accès à personne.
     */
    share: isFile && canEdit && !ctx.externalSharesDisabled,
    // Conservé pour les admins comme RACCOURCI : il ouvre le même dialogue,
    // focalisé sur la ligne d'invitation (`initialFocus: 'invite'`). Fermé par
    // le gel : sceller un accès ponctuel est une ÉCRITURE (`POST
    // /:id/items/:itemId/grants` porte `blockWhenFrozen`).
    shareWithPerson: isVaultAdminRole(ctx.role) && !item.meta.folderMarker && !ctx.frozen,
    /**
     * ÉPINGLER À L'APERÇU (F27) — ADMINISTRATEURS SEULEMENT, et le gel n'y change
     * RIEN. Le geste écrit `PUT /:id/settings`, que le worker réserve au rang
     * admin et qu'il ne grève PAS du 409 `vault_frozen` (réservé aux écritures
     * de contenu). Retirer l'entrée d'un coffre gelé inventerait une
     * interdiction que le serveur n'applique pas — et un coffre archivé est
     * justement celui où l'on veut mettre en avant « lisez ceci d'abord ».
     *
     * Les deux entrées sont EXCLUSIVES : cet élément est l'épingle, ou il ne
     * l'est pas.
     */
    /**
     * « AJOUTER AUX FAVORIS » (★) est PERSONNEL : tout membre, lecteur compris,
     * range ses propres repères — ils ne s'imposent à personne et le serveur
     * n'en lit jamais le contenu (useVaultFavorites). Rien à voir avec
     * l'épingle DU COFFRE (📌, F27) juste en dessous, qui désigne UNE note pour
     * tout le monde et reste un geste d'administrateur. L'hôte choisit le sens
     * (ajouter / retirer) en fournissant l'un ou l'autre gestionnaire.
     */
    favorite: !item.meta.folderMarker,
    pin:
      mayTogglePin({ role: ctx.role, folderMarker: item.meta.folderMarker }) &&
      ctx.pinnedItemId !== item.id,
    unpin:
      mayTogglePin({ role: ctx.role, folderMarker: item.meta.folderMarker }) &&
      ctx.pinnedItemId === item.id,
    delete: canDeleteVaultItem(
      item,
      ctx.role,
      ctx.myUserId,
      ctx.itemDeleteRequiresAdmin,
      ctx.frozen
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Le panneau de détails — l'adaptateur vers `FileDetailsPanel`
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ce que le panneau de détails attend d'un élément : la forme `FileItem` de
 * l'espace personnel, réduite à ce qu'un élément de coffre sait dire. Un type
 * structurel plutôt que `FileItem` lui-même : ce module n'importe pas les types
 * Redux de l'espace personnel (deux mondes, zéro fusion), et `FileItem` y est
 * assignable par sa forme.
 */
export interface VaultDetailsItem {
  /** L'id d'AFFICHAGE (`vaultitem:…`) — jamais l'id nu, comme les cartes. */
  id: string;
  name: string;
  /** Le MIME chiffré dans la méta, ou '' : le panneau affiche « Fichier ». */
  type: string;
  size: number;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Élément de coffre → élément de détails. PAS de clé `items` (sinon le panneau
 * le prendrait pour un dossier et irait compter ses enfants) ; l'id est
 * PRÉFIXÉ pour qu'aucun service de l'espace personnel (tags, mot de passe par
 * fichier) ne puisse être interrogé avec un id de coffre — le panneau les
 * masque déjà (`hideTags`), le préfixe est la ceinture avec les bretelles.
 */
export function toVaultDetailsItem(
  item: VaultItemLike & { createdAt?: string },
  untitled: string
): VaultDetailsItem {
  return {
    id: VAULT_ITEM_PREFIX + item.id,
    name: item.meta.fileName || item.meta.title || untitled,
    type: item.meta.mime ?? '',
    size: item.sizeBytes,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

/**
 * Les évènements du fil qui parlent de CET élément — le journal condensé du
 * panneau de détails. Le serveur ne livre que des ids opaques : un évènement
 * concerne l'élément quand sa méta porte `item_id` (édition, suppression,
 * restauration, grant créé/révoqué — tous le posent). `targetId` n'est PAS
 * consulté : pour un grant c'est le DESTINATAIRE (un userId), pas l'élément.
 *
 * `events` est déjà dans l'ordre du serveur (le plus récent en tête) : on
 * conserve cet ordre et on ne garde que `limit` lignes.
 */
export function eventsForVaultItem<T extends { metadata: Record<string, unknown> | null }>(
  events: readonly T[],
  itemId: string,
  limit: number
): T[] {
  if (limit <= 0) return [];
  const out: T[] = [];
  for (const e of events) {
    if (e.metadata?.item_id === itemId) {
      out.push(e);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/**
 * Les capacités du menu contextuel d'un DOSSIER de coffre. Pas de
 * téléchargement (un dossier n'a pas d'octets), pas de versions (il n'a pas de
 * ligne serveur), pas de lien public (le lien porte sur un élément).
 */
export function vaultFolderCaps(ctx: VaultCapsContext): ItemMenuCapabilities {
  // Le gel compte ici comme partout : un dossier de coffre n'est qu'un préfixe
  // de chemin, donc le renommer ou le déplacer, c'est réécrire la méta de tous
  // ses descendants — l'écriture de contenu que `blockWhenFrozen` refuse.
  const canEdit = canEditVault(ctx.role, ctx.frozen);
  return {
    open: true,
    rename: canEdit,
    move: canEdit,
    /**
     * « Partager le dossier avec une personne… » — un acte d'ADMIN, comme sur
     * un élément. Le grant reste PAR ÉLÉMENT côté serveur : l'écran résout les
     * descendants du dossier (fichiers seulement, marqueurs exclus) et scelle
     * chacun ; un fichier ajouté plus tard dans le dossier n'est PAS couvert,
     * et le dialogue le dit. Hors nuage, l'écran ne pose pas cette entrée. Un
     * coffre gelé la ferme : chaque scellé est un `POST .../grants`.
     */
    shareWithPerson: isVaultAdminRole(ctx.role) && !ctx.frozen,
    // La suppression d'un dossier est RÉCURSIVE : c'est le plan calculé au clic
    // (`planFolderDelete`, matrice appliquée élément par élément) qui décide de
    // ce qui part réellement. Ici on n'ouvre que la porte — et le réglage du
    // coffre la referme aussi, sans quoi on ouvrirait un plan qui ne retiendrait
    // aucun élément.
    delete: canEdit && (!ctx.itemDeleteRequiresAdmin || isVaultAdminRole(ctx.role)),
  };
}
