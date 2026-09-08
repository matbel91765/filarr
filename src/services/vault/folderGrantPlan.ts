/**
 * folderGrantCatchUp — les éléments d'un dossier partagé qui n'ont PAS encore
 * d'accès, parce qu'ils sont arrivés après le partage.
 *
 * Sans React, sans réseau, sans i18n. Le mobile RECOPIE ce module.
 *
 * ── CE MODULE NE CHOISIT PAS, IL RATTRAPE ───────────────────────────────────
 *
 * Le CHOIX des éléments à partager existe déjà et n'est pas ici : c'est
 * `shareItemPicker` (groupement par sous-dossier, cases décochables, recherche)
 * derrière `ShareItemToPersonBody`. Partager « ce dossier sauf trois fichiers »
 * fonctionne depuis longtemps.
 *
 * Ce qui manquait, c'est l'APRÈS : un fichier déposé dans le dossier après le
 * partage n'a d'accès pour personne — personne n'était là pour le sceller.
 * L'application de l'hôte le fait d'elle-même au prochain lancement, sur le
 * modèle de `pendingGrantSweep` : « ce qui disparaît, ce n'est pas l'attente,
 * c'est l'obligation qu'un humain s'en souvienne ».
 *
 * ── POURQUOI IL N'Y A PAS DE SECONDE RÈGLE DE CHEMIN ICI ────────────────────
 *
 * « Quels éléments sont dans ce dossier » est déjà écrit — `folderGrantRollup`
 * (vaultExplorerModel) l'applique pour compter les partages d'une tuile. Deux
 * implémentations de cette question finiraient par diverger, et la divergence
 * serait invisible : l'une compterait un fichier que l'autre partagerait.
 *
 * On réutilise donc `isShareableUnder`, extrait de `folderGrantRollup` et
 * partagé avec lui. Les deux écartent les MARQUEURS de dossier et les FILS de
 * discussion : ce sont des implémentations, pas du contenu, et
 * `vaultFileCaps.shareWithPerson` refuse déjà de les partager.
 *
 * ── CE QU'IL NE FAIT PAS ────────────────────────────────────────────────────
 *
 * Il ne scelle rien. Sceller demande K_vault, la clé publique du destinataire et
 * son statut de vérification — trois choses qui n'ont pas leur place dans un
 * calcul d'ensemble. Il rend une liste ; l'appelant l'exécute.
 */

import {
  isShareableUnder,
  type VaultItemLike,
} from '../../renderer/components/vaults/vaultExplorerModel';

/**
 * L'INTENTION MÉMORISÉE d'un partage de dossier.
 *
 * Sans elle, un rattrapage ne peut pas distinguer un fichier ajouté depuis d'un
 * fichier que l'utilisateur avait DÉLIBÉRÉMENT décoché — il rendrait accessible
 * ce qu'on avait retiré. C'est la raison d'être de ce type : le rattrapage est
 * impossible sans mémoire de l'intention, et cette mémoire doit porter les
 * exclusions, pas seulement le dossier.
 */
export interface FolderShareIntent {
  /** Le dossier partagé, chemin normalisé ('' = la racine du coffre). */
  folderPath: string;
  /** Le compte destinataire. */
  granteeUserId: string;
  /** Les éléments EXPLICITEMENT décochés au moment du partage. */
  excludedItemIds: string[];
  /**
   * L'INSTANT DU PARTAGE (ISO 8601) — et c'est lui qui rend la garantie
   * STRUCTURELLE plutôt que dépendante d'une discipline.
   *
   * Au moment du partage, TOUT le contenu partageable non décoché a reçu un
   * accès. Donc, plus tard, un élément sans accès est forcément dans l'un de
   * ces trois cas :
   *
   *   (a) il était décoché      → ne doit pas être scellé ;
   *   (b) son accès a été révoqué → ne doit pas être scellé ;
   *   (c) il est arrivé depuis   → DOIT être scellé.
   *
   * Or (a) et (b) portent une date de création ANTÉRIEURE à l'intention, et (c)
   * une date postérieure. Borner le rattrapage aux éléments plus récents que
   * `since` écarte donc (a) et (b) SANS avoir à s'en souvenir — y compris pour
   * une révocation qui aurait oublié d'écrire son exclusion.
   *
   * Les exclusions restent nécessaires pour un cas que la date ne couvre pas :
   * un élément arrivé APRÈS le partage, scellé par un rattrapage, puis révoqué.
   * Celui-là est postérieur à `since` et ne peut être retenu que par son
   * exclusion.
   */
  since: string;
}

/** Un élément, plus la seule chose que le rattrapage ajoute : sa date de création. */
export type CatchUpItem = VaultItemLike & { createdAt: string };

/**
 * Les éléments à sceller pour tenir cette intention à jour.
 *
 * `alreadyGrantedItemIds` : ce que ce destinataire possède DÉJÀ sur ce coffre.
 * Un élément déjà scellé n'est pas rescellé ici — la mise à jour d'un accès
 * périmé (K_item change à chaque édition) est un autre geste, tenu par le
 * serveur au commit (`grant_set_mismatch`) et par la route `rewrap`.
 */
export function planFolderCatchUp(
  items: readonly CatchUpItem[],
  intent: FolderShareIntent,
  alreadyGrantedItemIds: readonly string[]
): string[] {
  /*
    LES EXCLUSIONS D'ABORD, ET C'EST LA RÈGLE À NE JAMAIS INVERSER.

    Un rattrapage qui rendrait accessible un document explicitement retiré
    serait le pire défaut possible de cette fonction : silencieux, différé, et
    contraire au geste. L'utilisateur a décoché ce fichier une fois et ne
    reviendra pas vérifier.
  */
  const exclus = new Set(intent.excludedItemIds);
  const dejaScelles = new Set(alreadyGrantedItemIds);
  const depuis = Date.parse(intent.since);

  const aSceller: string[] = [];
  for (const item of items) {
    if (exclus.has(item.id)) continue;
    if (dejaScelles.has(item.id)) continue;
    /*
      LA BORNE DE DATE — écarte (a) et (b) sans avoir à s'en souvenir.

      Une date illisible ne vaut PAS « récent » : on ne scelle rien. Un
      rattrapage qui n'accorde rien est un défaut visible ; un rattrapage qui
      ré-accorde est une fuite invisible.
    */
    const cree = Date.parse(item.createdAt);
    if (!Number.isFinite(cree) || !Number.isFinite(depuis) || cree <= depuis) continue;
    if (!isShareableUnder(item, intent.folderPath)) continue;
    aSceller.push(item.id);
  }
  return aSceller;
}

/** Ce qu'un rattrapage a trouvé à sceller pour UNE personne. */
export interface CatchUpForGrantee {
  granteeUserId: string;
  /** Les éléments à sceller, dans l'ordre où le coffre les porte. */
  itemIds: string[];
}

/**
 * Le rattrapage du COFFRE ENTIER — toutes les intentions, toutes les personnes.
 *
 * `planFolderCatchUp` traite UNE intention. Composer plusieurs intentions n'est
 * pas une simple boucle, et c'est la raison d'être de cette fonction.
 *
 * ── UNE EXCLUSION VAUT POUR TOUT LE COFFRE, PAS POUR UNE INTENTION ──────────
 *
 * « Client » est partagé avec Marie sauf `secret.pdf`. Plus tard, « Client/
 * Annexes » — où vit `secret.pdf` — est partagé avec Marie sans rien décocher.
 * Boucle naïve : la seconde intention ne connaît pas l'exclusion de la première
 * et scelle le fichier. Le geste de retrait est défait par un partage voisin,
 * en silence, des semaines après.
 *
 * Les exclusions sont donc UNIES PAR PERSONNE avant tout calcul : décoché une
 * fois pour quelqu'un, un élément ne lui est jamais rendu par un rattrapage.
 * Seul un partage EXPLICITE peut le lui redonner — un humain qui le coche.
 *
 * Le sens de l'erreur commande : ne pas sceller se voit (« je ne vois pas le
 * fichier »), sceller à tort ne se voit pas.
 *
 * ── CE QU'IL FAUT LUI DONNER ────────────────────────────────────────────────
 *
 * `liveGrants` : les accès VIVANTS du coffre (`GET /vaults/:id/grants`), pas
 * ceux d'un élément. Un accès expiré n'y est plus, et c'est voulu : le
 * rattrapage n'est pas chargé de prolonger une péremption qu'un humain a posée.
 */
export function planVaultCatchUp(
  items: readonly CatchUpItem[],
  intents: readonly FolderShareIntent[],
  liveGrants: readonly { itemId: string; granteeUserId: string }[]
): CatchUpForGrantee[] {
  if (intents.length === 0) return [];

  const dejaParPersonne = new Map<string, Set<string>>();
  for (const g of liveGrants) {
    let s = dejaParPersonne.get(g.granteeUserId);
    if (!s) dejaParPersonne.set(g.granteeUserId, (s = new Set()));
    s.add(g.itemId);
  }

  // Les exclusions de TOUTES les intentions d'une personne, réunies AVANT de
  // planifier quoi que ce soit — voir l'en-tête.
  const exclusParPersonne = new Map<string, Set<string>>();
  for (const i of intents) {
    let s = exclusParPersonne.get(i.granteeUserId);
    if (!s) exclusParPersonne.set(i.granteeUserId, (s = new Set()));
    for (const id of i.excludedItemIds) s.add(id);
  }

  const aSceller = new Map<string, Set<string>>();
  for (const intent of intents) {
    const deja = dejaParPersonne.get(intent.granteeUserId) ?? new Set<string>();
    const elargie: FolderShareIntent = {
      ...intent,
      excludedItemIds: [...(exclusParPersonne.get(intent.granteeUserId) ?? [])],
    };
    for (const id of planFolderCatchUp(items, elargie, [...deja])) {
      let s = aSceller.get(intent.granteeUserId);
      if (!s) aSceller.set(intent.granteeUserId, (s = new Set()));
      s.add(id);
    }
  }

  // Ordre STABLE : celui du coffre pour les éléments, alphabétique pour les
  // personnes. Un rattrapage qui scelle dans un ordre variable rend ses
  // journaux — et ses tests — illisibles.
  const rang = new Map(items.map((it, i) => [it.id, i]));
  return [...aSceller.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([granteeUserId, ids]) => ({
      granteeUserId,
      itemIds: [...ids].sort((a, b) => (rang.get(a) ?? 0) - (rang.get(b) ?? 0)),
    }));
}
