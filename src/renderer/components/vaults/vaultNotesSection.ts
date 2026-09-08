/**
 * vaultNotesSection — la section « Coffres partagés » de l'onglet Notes, réduite
 * à ce qui se DÉCIDE.
 *
 * POURQUOI UN MODULE À PART, comme `vaultExplorerModel` à côté. Ce fichier
 * n'importe ni React, ni Redux, ni le réseau : il prend l'état des coffres et
 * rend des groupes, des lignes et des états vides. C'est précisément la partie
 * où une erreur ne se verrait pas à la compilation — un état vide rendu à la
 * place d'un état inconnu compile parfaitement, et se lit « il n'y a rien ».
 *
 * LA RÈGLE QUI GOUVERNE TOUT LE FICHIER : ce qui ne se déchiffre pas ne se
 * devine pas. Quatre silences différents mènent ici à quatre phrases
 * différentes, et aucun d'eux ne mène à « aucune note » :
 *
 *   · le coffre est VERROUILLÉ — on n'a pas sa clé en mémoire, on n'a donc
 *     jamais lu sa liste ; il a peut-être cent notes ;
 *   · son époque de clé est EN RETARD — une rotation est passée sans qu'on
 *     nous re-scelle la clé. Le cadenas ordinaire conseillerait « déverrouillez
 *     votre compte », un geste que la personne peut répéter indéfiniment sans
 *     rien changer : ce n'est pas son compte qui est fermé (voir le même
 *     partage entre `lockedHint` et `staleEpochHint` dans `useVaultBrowser`) ;
 *   · sa liste n'est PAS ENCORE ARRIVÉE — un chargement, pas un vide ;
 *   · ses métas ne se DÉCHIFFRENT PAS — un élément dont la méta est illisible
 *     est écarté de la liste et compté à part (`decryptStatusByVault`), tout
 *     comme dans l'explorateur, où c'est le bandeau `teamVaults.decryptWarning`
 *     qui le dit. Zéro note lisible plus un compteur non nul, ce n'est pas un
 *     coffre vide : c'est un coffre qu'on ne sait pas lire.
 *
 * SEUL le cinquième cas — ouvert, à jour, lu, intégralement déchiffré, zéro
 * note — a le droit de dire « aucune note ».
 *
 * CE QU'ON N'AFFICHE PAS, et ce n'est pas un oubli. `itemType: 'note'` recouvre
 * trois choses dans un coffre : les vraies notes, les MARQUEURS DE DOSSIER
 * (`meta.folderMarker`, comment un dossier vide existe sans ligne à lui) et les
 * FILS DE DISCUSSION de fichiers (`meta.threadFor`, le sidecar de commentaires
 * d'un fichier). Les deux derniers sont de la plomberie : les lister donnerait
 * des « notes » qui, ouvertes, ne montreraient rien d'intelligible.
 */

/**
 * La forme MINIMALE qu'un coffre doit avoir ici — structurellement, pas
 * nominalement : `VaultSummary` y est assignable tel quel, et une fixture de
 * sonde aussi, sans monter le store.
 */
export interface VaultNotesSectionVault {
  vaultId: string;
  /** Déchiffré. Chaîne vide quand le coffre n'a pas pu être ouvert. */
  name: string;
  unlocked: boolean;
  currentKeyEpoch: number;
  /** L'époque du wrap que NOUS détenons. Inférieure = rotation non re-scellée. */
  wrappedVaultKeyEpoch: number;
}

/** Un élément de coffre, réduit à ce que cette section lit. */
export interface VaultNotesSectionItem {
  id: string;
  itemType: string;
  updatedAt: string;
  meta: {
    title?: string;
    folderMarker?: boolean;
    threadFor?: string;
  };
}

export interface VaultNotesSectionInput {
  vaults: readonly VaultNotesSectionVault[];
  itemsByVault: Readonly<Record<string, readonly VaultNotesSectionItem[]>>;
  /**
   * Les coffres dont la liste d'éléments a VRAIMENT été lue.
   *
   * Une entrée absente de `itemsByVault` et un tableau vide sont deux choses
   * différentes, et c'est tout l'enjeu : le magasin ne distingue pas « jamais
   * chargé » de « chargé, rien dedans ». Sans cette liste, un coffre dont la
   * réponse n'est pas encore revenue afficherait « aucune note ».
   */
  loadedVaultIds: readonly string[];
  /**
   * Les coffres dont la DERNIERE tentative de chargement a echoue.
   *
   * Sans cette entree, un echec est indiscernable d'un chargement qui dure :
   * dans les deux cas le coffre est simplement absent de `loadedVaultIds`, et
   * l'ecran affichait « Chargement des notes... » pour toujours.
   */
  failedVaultIds?: readonly string[];
  decryptStatusByVault: Readonly<Record<string, { undecryptable: number } | undefined>>;
  /** `teamVaults.items.untitled`, résolu par l'appelant — ce module ne traduit pas. */
  untitledLabel: string;
}

/**
 * L'état d'un groupe. Il y a CINQ façons de n'avoir aucune ligne à montrer, et
 * elles ne se disent pas de la même façon.
 */
export type VaultNotesGroupState =
  | 'ready'
  | 'empty'
  | 'loading'
  /** La dernière tentative de lecture a ÉCHOUÉ. Distinct de `loading`, qui est
   *  transitoire — voir `etatDuCoffre`. */
  | 'failed'
  | 'locked'
  | 'stale-epoch'
  | 'undecryptable';

export interface VaultNotesRow {
  vaultId: string;
  itemId: string;
  /** Jamais vide : le libellé « sans titre » a déjà été appliqué. */
  title: string;
  updatedAt: string;
}

export interface VaultNotesGroup {
  vaultId: string;
  /** Déchiffré, ou chaîne vide — l'appelant met alors `teamVaults.locked`. */
  vaultName: string;
  state: VaultNotesGroupState;
  rows: VaultNotesRow[];
  /** Combien d'éléments de ce coffre n'ont pas pu être déchiffrés. */
  undecryptable: number;
}

export interface VaultNotesSection {
  /**
   * La section a-t-elle lieu d'être ? Faux sans le moindre coffre — la règle 13
   * (hors nuage, rien de tout cela n'existe) est tenue par l'APPELANT, qui ne
   * bâtit ce modèle que pour un compte nuage ayant le droit ; ici on ne juge que
   * la présence de coffres.
   */
  hasSection: boolean;
  groups: VaultNotesGroup[];
  /** Le total des lignes RÉELLEMENT lisibles — ce que le repli affiche. */
  noteCount: number;
}

/** Un élément de coffre est-il une note que l'utilisateur a écrite ? */
function estNoteUtilisateur(item: VaultNotesSectionItem): boolean {
  if (item.itemType !== 'note') return false;
  // Les deux plomberies décrites en tête de fichier.
  if (item.meta.folderMarker) return false;
  if (item.meta.threadFor) return false;
  return true;
}

/**
 * L'état d'un coffre, dans l'ordre où les inconnues doivent être levées.
 *
 * L'ORDRE N'EST PAS ARBITRAIRE. L'époque en retard passe AVANT le verrou, y
 * compris quand le coffre est encore ouvert par une clé ancienne : c'est le
 * diagnostic le plus précis dont on dispose, et le seul qui débouche sur un
 * geste utile (demander à l'hôte un nouveau scellé). Le rétrograder en
 * « verrouillé » renverrait la personne vers un déverrouillage qui ne peut rien.
 */
function etatDuCoffre(
  vault: VaultNotesSectionVault,
  charge: boolean,
  echoue: boolean,
  lignes: number,
  illisibles: number
): VaultNotesGroupState {
  if (vault.wrappedVaultKeyEpoch < vault.currentKeyEpoch) return 'stale-epoch';
  if (!vault.unlocked) return 'locked';
  /**
   * ⚠ L'ECHEC PASSE AVANT LE CHARGEMENT, ET APRES LE VERROU.
   *
   * Apres le verrou, parce qu'un coffre verrouille echoue forcement : dire
   * « echec » plutot que « verrouille » enverrait chercher une panne la ou il
   * suffit de saisir un mot de passe.
   *
   * Avant le chargement, parce que c'est TOUT le correctif : sans cette ligne,
   * un coffre dont la lecture a echoue reste « en chargement » pour toujours.
   */
  if (echoue) return 'failed';
  if (!charge) return 'loading';
  if (lignes > 0) return 'ready';
  // Zéro ligne : reste à savoir si c'est un vide ou une ignorance.
  if (illisibles > 0) return 'undecryptable';
  return 'empty';
}

/**
 * Le comparateur des groupes : par nom, les coffres SANS NOM en dernier.
 *
 * Un nom vide veut dire « pas ouvert » (le nom est chiffré sous K_vault). Le
 * trier alphabétiquement le mettrait en tête de section, si bien que la première
 * chose vue serait un coffre illisible — on range donc ces cas à la fin, où ils
 * se lisent comme ce qu'ils sont : un reste à régler.
 */
function comparerGroupes(a: VaultNotesGroup, b: VaultNotesGroup): number {
  const aVide = a.vaultName.trim() === '';
  const bVide = b.vaultName.trim() === '';
  if (aVide !== bVide) return aVide ? 1 : -1;
  const parNom = a.vaultName.localeCompare(b.vaultName, undefined, { sensitivity: 'base' });
  // Départage stable par identifiant : deux coffres homonymes (ou deux
  // verrouillés, tous deux sans nom) ne doivent pas changer d'ordre d'un rendu
  // à l'autre sous les yeux de quelqu'un.
  return parNom !== 0 ? parNom : a.vaultId.localeCompare(b.vaultId);
}

export function buildVaultNotesSection(input: VaultNotesSectionInput): VaultNotesSection {
  const charges = new Set(input.loadedVaultIds);
  const echecs = new Set(input.failedVaultIds ?? []);
  const groups: VaultNotesGroup[] = [];
  let noteCount = 0;

  for (const vault of input.vaults) {
    const illisibles = input.decryptStatusByVault[vault.vaultId]?.undecryptable ?? 0;
    const charge = charges.has(vault.vaultId);
    const rows: VaultNotesRow[] = (input.itemsByVault[vault.vaultId] ?? [])
      .filter(estNoteUtilisateur)
      .map((item) => ({
        vaultId: vault.vaultId,
        itemId: item.id,
        // Un titre blanc n'est pas un titre : `trim()` avant le repli, sans quoi
        // la ligne serait une case vide impossible à viser du regard.
        title: item.meta.title?.trim() ? item.meta.title.trim() : input.untitledLabel,
        updatedAt: item.updatedAt,
      }))
      // La plus récemment modifiée en tête : dans un coffre partagé, c'est
      // presque toujours celle qu'un autre membre vient de toucher.
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    const state = etatDuCoffre(vault, charge, echecs.has(vault.vaultId), rows.length, illisibles);
    /**
     * LES LIGNES NE SURVIVENT QU'AUX ÉTATS QUI LES ASSUMENT. Un coffre dont
     * l'époque est en retard peut très bien porter des éléments lus AVANT la
     * rotation, encore présents dans le magasin : les afficher promettrait une
     * ouverture qui échouera, et on ne montre pas une porte qui ne s'ouvre pas.
     */
    const visibles = state === 'ready' ? rows : [];
    noteCount += visibles.length;

    groups.push({
      vaultId: vault.vaultId,
      vaultName: vault.name,
      state,
      rows: visibles,
      undecryptable: illisibles,
    });
  }

  groups.sort(comparerGroupes);

  return { hasSection: groups.length > 0, groups, noteCount };
}
