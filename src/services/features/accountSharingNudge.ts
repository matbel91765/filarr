/**
 * LE COUP DE COUDE VERS LES COFFRES PARTAGÉS — la décision, pure.
 *
 * ═══ CE QUE CE BANDEAU EST, ET SURTOUT CE QU'IL N'EST PAS ═══
 *
 * Il ne bloque rien, ne compte rien contre personne, et ne se déclenche sur
 * aucune suspicion. Partager un compte reste parfaitement possible : la FEK
 * dérive du mot de passe, le serveur ne voit que du chiffré, et aucun garde-fou
 * technique n'existera jamais. Ce bandeau ne fait qu'une chose — dire à
 * quelqu'un qui a manifestement plusieurs personnes sur un compte ce qu'il y
 * perd, et où est la porte.
 *
 * ═══ ON COMPTE DES APPAREILS, PAS DES « ENDROITS » ═══
 *
 * La maquette validée disait « utilisé depuis 6 endroits ». Le mot est meilleur
 * — il évoque des gens, pas des machines — mais le tenir demanderait de collecter
 * des adresses IP ou une géolocalisation approximative, c'est-à-dire d'ajouter
 * une donnée personnelle à un produit dont l'argument entier est que le serveur
 * ne sait rien. Le prix est disproportionné devant le gain : « 6 appareils » est
 * exact, se lit aussi bien, et ne coûte AUCUNE collecte nouvelle — le compte des
 * sessions vivantes existe déjà.
 *
 * ═══ LE SEUIL, ET POURQUOI IL EST HAUT ═══
 *
 * Cinq. Bureau, portable, web, téléphone et une réinstallation font quatre à
 * cinq appareils chez une seule personne, sans le moindre partage. Se déclencher
 * en dessous transformerait un conseil en accusation, et un bandeau qu'on a
 * trouvé injuste une fois n'est plus jamais lu.
 */

/** Au-delà de ce nombre d'appareils ACTIFS, le bandeau se propose. */
export const SHARING_NUDGE_THRESHOLD = 5;

/** Ce que l'utilisateur a déjà écarté. `null` = jamais écarté. */
export interface NudgeDismissal {
  /** Le nombre d'appareils au moment où il a fermé le bandeau. */
  atCount: number;
}

/**
 * FAUT-IL MONTRER LE BANDEAU ?
 *
 * L'écartement est DURABLE MAIS PAS DÉFINITIF, et c'est la seule subtilité :
 * fermer le bandeau à six appareils veut dire « je sais, c'est voulu » — pas
 * « ne me parle plus jamais de rien ». Si le compte passe ensuite à douze,
 * la situation a changé et mérite d'être redite. On réaffiche donc quand le
 * nombre a franchi un nouveau palier depuis l'écartement.
 *
 * Le palier est le seuil lui-même : il faut autant d'appareils de PLUS que le
 * seuil en demandait pour redéranger quelqu'un qui a déjà dit non.
 */
export function shouldShowSharingNudge(input: {
  activeCount: number;
  dismissal: NudgeDismissal | null;
  threshold?: number;
}): boolean {
  const threshold = input.threshold ?? SHARING_NUDGE_THRESHOLD;
  if (!Number.isFinite(input.activeCount) || input.activeCount < threshold) return false;
  if (!input.dismissal) return true;
  return input.activeCount >= input.dismissal.atCount + threshold;
}
