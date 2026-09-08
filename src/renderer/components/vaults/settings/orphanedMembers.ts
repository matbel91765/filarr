/**
 * orphanedMembers (F08) — « cette personne détient encore la clé de ce coffre,
 * mais elle n'est plus dans l'espace qui l'héberge ».
 *
 * POURQUOI CET ÉCRAN EXISTE (P3 du plan). Retirer quelqu'un d'un ESPACE ne fait
 * pas tourner les clés de ses coffres : `onMembershipRevoked` ne touche que
 * l'escrow. La personne garde donc un wrap parfaitement valide. Le serveur lui
 * refuse ses requêtes — son appartenance à l'org n'est plus active — mais ce
 * qu'elle a déjà téléchargé reste lisible, et une ré-admission dans l'espace lui
 * rouvrirait tout SANS nouvelle vérification. C'est un état vrai, durable, et
 * qui n'était visible nulle part.
 *
 * LE LIBELLÉ DOIT DIRE ÇA, ET RIEN DE PLUS FLATTEUR. « Accès révoqué » serait
 * faux : la clé est toujours entre ses mains. Le seul geste qui ferme vraiment
 * la porte est le retrait du coffre, parce que LUI fait tourner K_vault.
 *
 * LE RETRAIT SE FAIT EN BLOC, ET CE N'EST PAS UN CONFORT. Faire tourner la clé
 * exige de la resceller à CHAQUE membre restant, donc d'aller lire sa clé
 * publique — et `GET /account/public-key/:userId` répond 403 `org_forbidden` sur
 * EXACTEMENT le prédicat qui allume ce bandeau (appartenance à l'org non
 * `active`). Retirer A en laissant B dehors échoue donc sur B, et retirer B en
 * laissant A échoue sur A : proposer un bouton par personne offrait deux
 * culs-de-sac dans la seule situation que ce bandeau existe pour montrer. Le
 * modèle ne propose donc qu'un geste TOTAL — `removeTogether`, vide dès qu'une
 * seule ligne resterait derrière — que le serveur sait déjà exécuter en une
 * rotation (`removeUserIds` est un tableau, et la garde `wrap_set_mismatch` ne
 * porte que sur la couverture des RESTANTS).
 *
 * ET SURTOUT : `inSpace` ABSENT N'EST PAS « HORS ». Le champ n'existe que
 * depuis P2 ; un worker d'avant ne l'envoie pas. Une app qui lirait `!inSpace`
 * accuserait tout le monde d'être sorti de l'espace, puis proposerait de faire
 * tourner la clé du coffre pour chacun — un geste destructeur déclenché par une
 * absence d'information. C'est la règle « terminal ≠ jetable », appliquée à
 * l'endroit où elle coûte le plus cher. Ce silence n'est PAS compté à part : la
 * réponse est tout ou rien (`listVaultMembershipsWithSpace` remplit `in_space`
 * pour toutes les lignes ou pour aucune), si bien qu'un chiffre « n lignes n'ont
 * rien déclaré » vaudrait toujours zéro quand le bandeau s'affiche — et un champ
 * qui ne se voit nulle part ne garde rien.
 */

import type { VaultMemberRow } from './vaultManagementModel';

export interface OrphanedMembersVerdict {
  /**
   * Les membres dont le serveur AFFIRME qu'ils ne sont plus dans l'espace,
   * triés par libellé — le même ordre que le tableau juste en dessous.
   */
  rows: VaultMemberRow[];
  /** `rows.length`, pour l'index « À traiter » : un seul calcul, un seul chiffre. */
  count: number;
  /**
   * Ceux que MON rôle peut réellement retirer d'ici. Ce n'est pas `rows` : un
   * administrateur ne retire pas un propriétaire, et personne ne se retire
   * soi-même par ce bouton (« Quitter » vit dans l'onglet Danger).
   */
  removable: VaultMemberRow[];
  /**
   * LE GESTE, quand il existe : tout le monde d'un coup, en une rotation. Vide
   * dès qu'une seule personne hors de l'espace resterait derrière — il faudrait
   * lui resceller K_vault' et sa clé publique est refusée (voir l'en-tête). Un
   * bouton qui échoue à tous les coups est pire qu'un bouton absent.
   */
  removeTogether: VaultMemberRow[];
  /**
   * Ce qui ferme le geste : les lignes hors de l'espace que mon rôle ne peut pas
   * retirer d'ici. Nommées, parce que l'écran doit dire POURQUOI il ne propose
   * rien — et à qui s'adresser.
   */
  blockers: VaultMemberRow[];
}

export function orphanedMembers(rows: readonly VaultMemberRow[]): OrphanedMembersVerdict {
  const dehors = rows
    .filter((m) => m.inSpace === false)
    .sort((a, b) => a.label.localeCompare(b.label));
  const removable = dehors.filter((m) => m.removable);
  const blockers = dehors.filter((m) => !m.removable);
  return {
    rows: dehors,
    count: dehors.length,
    removable,
    // Tout ou rien : un retrait partiel laisserait un hors-espace à resceller.
    removeTogether: blockers.length === 0 ? removable : [],
    blockers,
  };
}
