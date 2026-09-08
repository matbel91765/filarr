/**
 * pinnedItemModel (F27) — ce qu'on a le droit de dire d'une note épinglée.
 *
 * L'ÉPINGLE N'EST QU'UN IDENTIFIANT. Elle vit dans le bloc chiffré des réglages
 * (`VaultSettingsBlock.pinnedItemId`), à côté de la description : le serveur la
 * range sans jamais l'ouvrir. La note, elle, ne bouge pas — elle reste dans son
 * dossier, dans l'explorateur, dans la corbeille si on l'y met. JAMAIS D'ÉLÉMENT
 * CACHÉ : ce dossier a déjà payé le prix des entités fantômes (un accès ponctuel
 * dont l'élément n'était nulle part), et une note qui n'existerait QUE dans
 * l'Aperçu serait invisible aux gestes qui la concernent (renommer, déplacer,
 * révoquer, supprimer).
 *
 * D'OÙ LE SEUL VRAI SUJET DE CE MODULE : QUE DIRE QUAND ON NE LA TROUVE PAS ?
 *
 * Trois réponses, et deux d'entre elles se ressemblent au point qu'on les a
 * confondues ailleurs — au prix d'un écran qui déclarait supprimées des notes
 * parfaitement vivantes :
 *
 *  · `readable` — on sait la NOMMER. Nommer, c'est avoir déchiffré cet
 *    élément-là : on l'ouvre, sans autre question.
 *  · `unreadable` — on ne sait pas la nommer, et on ne sait pas non plus si elle
 *    existe. TROIS causes, un seul aveu : la liste du coffre n'a pas été lue (ou
 *    pas entièrement — `loadVaultItems` SAUTE ce qu'il ne sait pas déchiffrer) ;
 *    l'élément est là mais son titre est resté scellé ; ou l'élément est là,
 *    lisible, et n'a simplement NI titre NI nom de fichier — une note vide.
 *    L'index des noms (`nameByItemId`, bâti sur `meta.fileName || meta.title`)
 *    ne porte pas ce dernier cas, et l'écran dira donc « illisible sur cet
 *    appareil » d'une note parfaitement lisible. C'est un défaut d'index, pas de
 *    verdict : la phrase reste un aveu d'ignorance, jamais une affirmation, et
 *    c'est pour ça qu'on peut vivre avec en attendant que l'index sache nommer
 *    « Sans titre ». « Épinglée, illisible sur cet appareil » est la vérité dans
 *    les trois cas.
 *  · `missing` — l'identifiant est ABSENT d'une liste qui fait AUTORITÉ, et
 *    c'est le seul cas où proposer de désépingler a un sens.
 *
 *    MAIS « ABSENT DE LA LISTE » N'EST PAS « N'EXISTE PLUS », et la phrase l'a
 *    payé. `listVaultItems` filtre `deleted_at IS NULL` côté worker : une note
 *    MISE À LA CORBEILLE quitte la liste immédiatement, alors qu'elle est
 *    restaurable pendant `trashRetentionDays` et que ses octets comptent
 *    toujours dans le quota. C'est même le scénario le plus probable des trois
 *    — un administrateur supprime la note épinglée. Le verdict, lui, est bon
 *    (l'épingle ne désigne plus rien de listable, et la retirer est légitime) ;
 *    c'est la PHRASE qui a été refaite : « il n'est plus dans ce coffre (il est
 *    peut-être à la corbeille) » est vraie de la corbeille comme de la purge.
 *
 * L'AUTORITÉ N'EST PAS RECRÉÉE ICI. `unresolvedItemLabel` (vaultActivityModel)
 * répond déjà à « que peut-on dire d'un `item_id` qu'on n'a pas su nommer ? »,
 * et `authoritativeItemIds` (grantOverviewModel) décide de ce qui fait autorité
 * — un seul élément indéchiffrable suffit à rendre `null`, parce qu'une liste
 * amputée ne prouve la disparition de personne. Ce module les APPELLE. Une
 * seconde règle, ici, aurait fini par diverger : et l'endroit où elle
 * divergerait est précisément celui où l'une des deux affirmerait une
 * suppression.
 */

import { unresolvedItemLabel } from '../vaultActivityModel';

/** Ce que l'Aperçu doit rendre pour l'épingle du coffre. */
export type PinnedItemVerdict =
  /** Rien d'épinglé — la carte n'existe pas du tout. */
  | { kind: 'none' }
  /** On sait la nommer : titre affiché, ouverture proposée. */
  | { kind: 'readable'; itemId: string; name: string }
  /** On ne sait ni la nommer ni si elle existe — on le DIT, on ne conclut rien. */
  | { kind: 'unreadable'; itemId: string }
  /**
   * Absente d'une liste qui fait autorité : là, et là seulement, on propose de
   * désépingler. La phrase dit « plus dans ce coffre », pas « n'existe plus » —
   * la corbeille sort de la liste sans rien détruire.
   */
  | { kind: 'missing'; itemId: string };

export interface PinnedItemInput {
  /** L'identifiant rangé dans le bloc chiffré, déjà borné par le décodeur. */
  pinnedItemId: string | null | undefined;
  /** Les noms résolus depuis la liste du coffre — vide n'est pas « rien n'existe ». */
  nameByItemId: ReadonlyMap<string, string>;
  /** Les éléments RÉELLEMENT lus, ou `null` quand on n'a pas lu (ou pas tout lu). */
  knownItemIds: ReadonlySet<string> | null;
}

/**
 * Le verdict, et rien de plus : ni libellé, ni traduction, ni troncature
 * d'identifiant — c'est le composant qui les porte, comme pour le fil.
 */
export function pinnedItemVerdict(input: PinnedItemInput): PinnedItemVerdict {
  const itemId = (input.pinnedItemId ?? '').trim();
  if (!itemId) return { kind: 'none' };

  // NOMMER SUFFIT, ET PASSE AVANT L'AUTORITÉ. L'index des noms est bâti sur la
  // liste du coffre : un identifiant qu'il porte a donc bien été déchiffré ici.
  // Exiger en plus l'ensemble « qui fait autorité » rendrait illisible une note
  // qu'on affiche par ailleurs, sur le seul motif qu'un AUTRE élément du coffre
  // n'a pas pu s'ouvrir.
  const name = input.nameByItemId.get(itemId);
  if (name) return { kind: 'readable', itemId, name };

  // La MÊME autorité que le fil d'activité et que les accès ponctuels : « n'existe
  // plus » ne se tire que d'une liste réellement lue et complète.
  return unresolvedItemLabel(itemId, input.knownItemIds) === 'deleted'
    ? { kind: 'missing', itemId }
    : { kind: 'unreadable', itemId };
}

/**
 * QUI PEUT POSER OU RETIRER L'ÉPINGLE — réexportée, jamais réécrite.
 *
 * La règle vit dans `vaultExplorerModel`, avec le reste de la matrice de droits
 * du coffre (`isVaultAdminRole`, `canEditVault`, `canDeleteVaultItem`) : c'est
 * ce fichier-là que le menu contextuel consulte, et deux réponses à « qui a le
 * droit d'épingler ? » finiraient par diverger — l'écran proposerait alors un
 * geste que le serveur refuse, ou cacherait un geste légitime. On la réexpose
 * ici pour que la lecture de F27 tienne en un fichier.
 */
export { mayTogglePin } from '../vaultExplorerModel';
