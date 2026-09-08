/**
 * newVaultAccessModel — « ce coffre est NOUVEAU pour moi », décidé sans serveur.
 *
 * POURQUOI CE MODÈLE EXISTE. Depuis l'ajout direct (F06), quelqu'un qui est déjà
 * membre de l'espace reçoit sa place SUR-LE-CHAMP : pas de jeton, pas
 * d'invitation en attente, pas d'acceptation. Le chemin est le bon — mais il ne
 * laisse, côté destinataire, AUCUN objet à afficher. Ni `myInvitations`, ni
 * `awaitingHost` : rien. La personne ne l'apprenait qu'en remarquant un dossier
 * de plus à l'accueil.
 *
 * LE SEUL FAIT DISPONIBLE EST DONC UNE DIFFÉRENCE : ce que le serveur liste
 * moins ce que CET appareil avait déjà vu. D'où un registre local
 * d'identifiants de coffres, par profil (`vaultAccessSeen.ts`). Il reste LOCAL
 * par nécessité autant que par principe — le serveur ne doit rien apprendre de
 * plus sur ce que quelqu'un regarde, et il n'a de toute façon aucune notion de
 * « déjà vu ».
 *
 * LE PIÈGE QUE CE FICHIER FERME. Un compte qui ouvre l'application pour la
 * première fois a un registre vide : « tout ce qui n'est pas dedans » lui
 * annoncerait ses quinze coffres d'un coup, le jour de son arrivée, comme si
 * quinze personnes venaient de lui donner accès. Le premier chargement ne fait
 * donc que SEMER, en silence — et c'est le drapeau `seeded` qui le dit, jamais
 * la taille du registre (un compte peut légitimement n'avoir aucun coffre, puis
 * en recevoir un : c'est un vrai neuf, et il doit s'afficher).
 *
 * PUR ET SANS EFFET DE BORD : ni `localStorage`, ni Redux, ni horloge. Les
 * entrées sont ce que le serveur a listé, le registre, et le drapeau de semis ;
 * la sortie dit ce qui est neuf et ce qu'il faut écrire. Le stockage vit à côté.
 */

/** Le registre des coffres déjà vus par ce profil. */
export interface KnownVaultsRegistry {
  /** Identifiants opaques — jamais un nom : le nom est chiffré, il n'a rien à faire ici. */
  ids: readonly string[];
  /**
   * Le registre a-t-il déjà été semé ?
   *
   * SÉPARÉ DE `ids.length`, ET C'EST TOUT LE SUJET : un registre vide veut dire
   * deux choses opposées — « on n'a jamais regardé » (ne rien annoncer) et « on
   * a regardé, il n'y avait aucun coffre » (le prochain est un vrai neuf).
   */
  seeded: boolean;
}

export interface NewVaultsOutcome {
  /** Ce qui est neuf pour moi, dans l'ordre où le serveur l'a listé. */
  newVaultIds: string[];
  /** Le registre à écrire, ou `null` quand il n'a pas bougé (pas d'écriture inutile). */
  nextKnownIds: string[] | null;
  /** Ce passage n'a fait que semer : rien ne s'affiche. */
  seeded: boolean;
}

/**
 * Confronte la liste du serveur au registre.
 *
 * `registry` vaut `null` quand rien n'a jamais été écrit pour ce profil.
 *
 * LE NEUF N'ENTRE PAS DANS LE REGISTRE ICI, et c'est délibéré : s'il y entrait,
 * le bandeau vivrait un seul rendu et le chargement suivant le trouverait
 * « déjà vu » — l'annonce disparaîtrait sans que personne ne l'ait lue. Seul un
 * GESTE (ouvrir le coffre, ou écarter l'annonce) appelle `markKnown`.
 */
export function resolveNewVaults(
  loadedVaultIds: readonly string[],
  registry: KnownVaultsRegistry | null
): NewVaultsOutcome {
  // Dédoublonné : `loadVaults` concatène PLUSIEURS espaces, rien ne garantit
  // qu'un identifiant n'y figure qu'une fois.
  const loaded: string[] = [];
  const vus = new Set<string>();
  for (const id of loadedVaultIds) {
    if (!vus.has(id)) {
      vus.add(id);
      loaded.push(id);
    }
  }

  if (!registry || !registry.seeded) {
    // PREMIER SEMIS, EN SILENCE. Un registre présent mais non semé (écrit par
    // une version antérieure, ou tronqué) est traité comme absent : ne pas
    // savoir ne doit jamais produire une salve d'annonces.
    return { newVaultIds: [], nextKnownIds: loaded, seeded: true };
  }

  const connus = new Set(registry.ids);
  const newVaultIds = loaded.filter((id) => !connus.has(id));

  // Le registre n'est ÉLAGUÉ que de ce qui a disparu de la liste : un coffre
  // qu'on a quitté n'a plus à occuper de place, et s'il revenait, c'est bien
  // une nouvelle à annoncer — c'est exactement le geste de l'hôte qu'on montre.
  const élagué = registry.ids.filter((id) => vus.has(id));
  const nextKnownIds = élagué.length === registry.ids.length ? null : [...élagué];

  return { newVaultIds, nextKnownIds, seeded: false };
}

/**
 * Le registre après qu'un coffre a été VU — ouvert, ou écarté à la main.
 *
 * Rend toujours un registre SEMÉ : si le stockage avait été vidé entre-temps,
 * repartir vierge ferait rejouer la salve du premier lancement.
 */
export function markKnown(
  registry: KnownVaultsRegistry | null,
  vaultId: string
): KnownVaultsRegistry {
  const ids = registry?.ids ?? [];
  return { ids: ids.includes(vaultId) ? [...ids] : [...ids, vaultId], seeded: true };
}
