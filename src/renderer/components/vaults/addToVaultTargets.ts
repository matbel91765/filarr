/**
 * addToVaultTargets — LES DESTINATIONS D'« AJOUTER AU COFFRE », ET LE GEL (F23).
 *
 * POURQUOI CES QUATRE FONCTIONS EXISTENT. `useVaultAddTargets` ne regardait que
 * le rôle. Un coffre GELÉ restait donc une destination ordinaire : on choisissait
 * un fichier, on le chiffrait, on envoyait ses morceaux — et le 409
 * `vault_frozen` n'arrivait qu'à la fin. La règle habituelle du dossier (« un
 * client plus permissif ne coûte qu'un refus nommé ») ne tient plus dans ce
 * cas-là : sur plusieurs gigaoctets, elle coûte tout le téléversement.
 *
 * ET POURTANT ON NE FILTRE PAS. Retirer le coffre gelé de la liste rendrait le
 * geste INTROUVABLE — et si tous vos coffres sont gelés, l'entrée « Ajouter au
 * coffre » s'évanouirait sans un mot, exactement ce que `vaultExplorerModel`
 * interdit. Le coffre gelé reste donc VISIBLE et devient INÉLIGIBLE, avec sa
 * raison écrite dans son libellé.
 *
 * UNE SEULE DÉRIVATION, comme la liste elle-même : deux idées de « où puis-je
 * déposer », ce seraient deux vérités possibles au même instant, et l'écart se
 * verrait au pire moment — une entrée de menu qui ouvre une boîte disant qu'il
 * n'y a nulle part où aller.
 */

/** Le minimum qu'une destination doit porter. `VaultSummary` le porte déjà. */
export interface AddTargetLike {
  id: string;
  /** Le nom DÉCHIFFRÉ ; vide tant que le coffre est verrouillé. */
  name?: string;
  /**
   * L'instant du gel, tel que le serveur l'a rendu. ABSENT (worker d'avant le
   * gel) veut dire « on ne sait pas », et on ne retire rien sur une ignorance.
   */
  frozenAt?: string | null;
  /** Le rôle est filtré en amont (`useVaultAddTargets`) ; il n'est pas relu ici. */
  role?: string;
}

/** Ce coffre refuse-t-il les écritures de contenu ? */
export function isFrozenTarget(vault: AddTargetLike): boolean {
  return !!vault.frozenAt;
}

/**
 * Les destinations où l'on peut RÉELLEMENT déposer, ici et maintenant.
 *
 * C'est ce compte-là — et pas la longueur de la liste — qui décide si la voie
 * « Ajouter au coffre » a une issue : une boîte dont toutes les options sont
 * inéligibles n'est pas une destination.
 */
export function writableAddTargets<T extends AddTargetLike>(targets: readonly T[]): T[] {
  return targets.filter((v) => !isFrozenTarget(v));
}

/**
 * Le coffre pré-sélectionné à l'ouverture : le premier NON gelé, pas le premier
 * tout court. Pré-sélectionner un coffre gelé laisserait un bouton d'envoi actif
 * sur une destination que le serveur refusera après le téléversement.
 *
 * Rend `''` quand aucune destination n'est éligible — c'est-à-dire « rien n'est
 * choisi », que le bouton d'envoi lit déjà comme un refus.
 */
export function defaultAddTargetId(targets: readonly AddTargetLike[]): string {
  return writableAddTargets(targets)[0]?.id ?? '';
}

/** Une option du sélecteur — la forme qu'attend `Select` du système de design. */
export interface AddTargetOption {
  value: string;
  label: string;
  disabled: boolean;
}

/**
 * Les options du sélecteur, gel COMPRIS.
 *
 * Les libellés sont passés traduits : ce module ne connaît pas i18n, c'est ce
 * qui le rend éprouvable sans DOM ni traducteur.
 */
export function addTargetOptions(
  targets: readonly AddTargetLike[],
  labels: { untitled: string; frozen: string }
): AddTargetOption[] {
  return targets.map((v) => {
    const nom = v.name || labels.untitled;
    const gele = isFrozenTarget(v);
    return {
      value: v.id,
      // Le mot « Gelé » DANS le libellé, et pas seulement une option grisée :
      // une entrée éteinte sans raison invite à chercher une panne.
      label: gele ? `${nom} (${labels.frozen})` : nom,
      disabled: gele,
    };
  });
}
