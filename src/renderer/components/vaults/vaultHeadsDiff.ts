/**
 * vaultHeadsDiff — CE QU'IL FAUT RELIRE, et rien de plus.
 *
 * LE PROBLÈME. Tout ce qui décrit un coffre partagé est chargé UNE fois : un
 * membre ajoute un fichier, change un réglage, gèle le coffre ou retire
 * quelqu'un, et les autres écrans ouverts continuent d'afficher l'état d'avant
 * jusqu'à un rechargement complet de l'application. `GET /vaults/heads` donne
 * le signal ; ce module donne la DÉCISION.
 *
 * POURQUOI UNE FONCTION PURE PLUTÔT QUE DES `if` DANS LE GUETTEUR. Le guetteur
 * est un composant à minuteries, visibilité et recul exponentiel : le tester
 * revient à piloter le temps. La décision, elle, est un tableau contre un autre
 * — et c'est elle qui peut coûter cher si elle se trompe (rechargements en
 * boucle d'un côté, propagation muette de l'autre). Le guetteur n'appelle donc
 * que ceci, et dispatche ce qu'on lui rend.
 *
 * LE PRINCIPE DE COMPARAISON, ET IL N'EST PAS UNIFORME. Chaque champ se compare
 * à L'AUTORITÉ QUI LE PORTE :
 *   · `currentKeyEpoch`, `myWrappedEpoch`, `frozenAt` vivent dans le RÉSUMÉ
 *     Redux : on les compare au magasin. Un écart s'y voit dès le PREMIER tour,
 *     même si le changement est arrivé avant que le guetteur ne démarre.
 *   · `itemsRevision`, `settingsVersion`, `memberCount` ne vivent nulle part
 *     dans le magasin : ils se comparent à la tête du TOUR PRÉCÉDENT. Sans
 *     point de comparaison (premier tour), on apprend sans rien conclure —
 *     l'écran vient d'être chargé, il est déjà à jour.
 *
 * CE QU'ON NE RECHARGE JAMAIS. Le CORPS d'une note ouverte. Il a sa propre
 * synchronisation (l'édition collaborative), et son enregistrement se rebase
 * sur la version du DOCUMENT CHARGÉ (`vaultNoteEditorSync.saveGuardVersion`),
 * jamais sur celle qui traverse la liste — c'est déjà la garde qui empêchait un
 * rafraîchissement de fond d'écraser le travail d'un autre. Relire la LISTE
 * d'éléments est donc sûr, et allume même la bannière « une version plus
 * récente existe » qui n'avait jusqu'ici aucun moyen de s'allumer toute seule.
 */

import { vaultTargetFromRoute } from '../layout/RouteContent/routeCompat';

/** Une tête telle que `GET /vaults/heads` la rend. */
export interface VaultHead {
  vaultId: string;
  /** Chaîne OPAQUE : on la compare, on ne la lit pas. */
  itemsRevision: string;
  memberCount: number;
  settingsVersion: number;
  currentKeyEpoch: number;
  myWrappedEpoch: number;
  frozenAt: string | null;
  deletedAt: string | null;
}

/** Ce que le magasin porte AUJOURD'HUI pour un coffre — l'autre moitié du duel. */
export interface KnownVault {
  vaultId: string;
  /**
   * L'espace du coffre. INDISPENSABLE : la route est portée par UN espace
   * (X-Org-Id) tandis que la liste du magasin les fusionne tous. Sans lui, un
   * coffre d'un espace non sondé passerait pour un coffre perdu.
   */
  organizationId: string;
  currentKeyEpoch: number;
  wrappedVaultKeyEpoch: number;
  frozenAt: string | null;
}

export interface HeadsDiffInput {
  /** Les têtes reçues, tous espaces sondés confondus. */
  heads: VaultHead[];
  /** Les espaces dont la réponse est ARRIVÉE. Le reste est « on ne sait pas ». */
  coveredOrgIds: string[];
  /** Les coffres du magasin. */
  known: KnownVault[];
  /** Les têtes du tour précédent, par coffre. Vide au premier tour. */
  previous: Record<string, VaultHead>;
  /** Les coffres actuellement AFFICHÉS (l'onglet actif de chaque panneau). */
  visibleVaultIds: string[];
  /**
   * Les coffres dont la LISTE D'ÉLÉMENTS est montrée AILLEURS que dans leur
   * explorateur — aujourd'hui la section « Coffres partagés » de l'onglet Notes,
   * qui en montre plusieurs à la fois.
   *
   * POURQUOI UN CHAMP SÉPARÉ PLUTÔT QU'UN AJOUT À `visibleVaultIds`. Les deux
   * mènent au même rechargement, mais pas de la même façon : `visibleVaultIds`
   * se DÉDUIT des routes (`vaultTargetsFromPanels`), c'est-à-dire d'un fait que
   * le magasin porte déjà, tandis que celui-ci est DÉCLARÉ par un écran qui sait
   * seul ce qu'il affiche. Les confondre inviterait à déduire l'un de l'autre,
   * et la seule déduction possible — « tous les coffres connus, puisque la
   * section peut les montrer » — transformerait le guetteur en déchiffrement
   * perpétuel de toutes les listes, y compris section repliée.
   *
   * LA BORNE EST DONC CHEZ L'APPELANT, et elle est étroite : la section ne
   * déclare que les coffres OUVERTS qu'elle affiche VRAIMENT, et se retire
   * lorsqu'elle est repliée ou démontée.
   */
  listedVaultIds: string[];
  /** Les coffres dont la page « Gérer le coffre » est ouverte. */
  managedVaultIds: string[];
}

export interface HeadsDiff {
  /** Relire la LISTE des coffres (résumés : nom, époque, gel, appartenance). */
  reloadVaults: boolean;
  /** Relire les ÉLÉMENTS de ces coffres. */
  reloadItems: string[];
  /** Relire les RÉGLAGES de ces coffres. */
  reloadSettings: string[];
  /** Rafraîchir la page « Gérer le coffre » de ces coffres. */
  reloadManagement: string[];
  /**
   * Les coffres connus qui ne sont plus servis : on n'en est plus membre.
   *
   * RENDU POUR ÊTRE LU, PAS POUR ÊTRE EXÉCUTÉ. Le verrouillage en mémoire
   * (`lockVaultEverywhere`) est déjà fait par `loadVaults`, qui verrouille tout
   * identifiant sorti de sa liste — le refaire ici serait un second chemin de
   * révocation, donc une seconde vérité. `reloadVaults` est mis à vrai, et
   * c'est `loadVaults` qui ferme.
   */
  goneVaultIds: string[];
}

const VIDE: HeadsDiff = {
  reloadVaults: false,
  reloadItems: [],
  reloadSettings: [],
  reloadManagement: [],
  goneVaultIds: [],
};

export function diffVaultHeads(input: HeadsDiffInput): HeadsDiff {
  const covered = new Set(input.coveredOrgIds);
  const visible = new Set([...input.visibleVaultIds, ...input.listedVaultIds]);
  const managed = new Set(input.managedVaultIds);
  const knownById = new Map(input.known.map((k) => [k.vaultId, k]));
  const seen = new Set<string>();

  const out: HeadsDiff = {
    ...VIDE,
    reloadItems: [],
    reloadSettings: [],
    reloadManagement: [],
    goneVaultIds: [],
  };

  for (const head of input.heads) {
    seen.add(head.vaultId);
    const prev = input.previous[head.vaultId];
    const mine = knownById.get(head.vaultId);

    // Les éléments : seulement pour un coffre QU'ON REGARDE — son explorateur
    // est à l'écran, ou une autre surface déclare en lister le contenu
    // (`listedVaultIds`). Déchiffrer la liste d'un coffre que personne n'a sous
    // les yeux coûterait le prix fort pour un résultat que personne ne verrait ;
    // elle sera relue à son ouverture, comme aujourd'hui. Les deux ensembles
    // sont FUSIONNÉS dans `visible` : un coffre à la fois regardé et listé ne
    // doit produire qu'UN rechargement, pas deux déchiffrements de la même
    // liste à chaque tour.
    if (prev && prev.itemsRevision !== head.itemsRevision && visible.has(head.vaultId)) {
      out.reloadItems.push(head.vaultId);
    }

    // Les réglages : pour TOUS les coffres, à l'écran ou non. Ils décident de
    // ce que l'explorateur, le panneau de partage et la porte rapide
    // s'autorisent ; périmés, ils font proposer un geste que le serveur
    // refusera.
    if (prev && prev.settingsVersion !== head.settingsVersion) {
      out.reloadSettings.push(head.vaultId);
    }

    let resumeChange = false;
    if (prev && prev.memberCount !== head.memberCount) resumeChange = true;
    if (mine) {
      if (mine.currentKeyEpoch !== head.currentKeyEpoch) resumeChange = true;
      if (mine.wrappedVaultKeyEpoch !== head.myWrappedEpoch) resumeChange = true;
      if ((mine.frozenAt ?? null) !== (head.frozenAt ?? null)) resumeChange = true;
      // Le coffre a été supprimé pendant qu'il était encore dans notre liste :
      // `loadVaults` l'en fera tomber (et verrouillera sa clé au passage).
      if (head.deletedAt !== null) resumeChange = true;
    } else if (head.deletedAt === null) {
      /**
       * SERVI, MAIS INCONNU DU MAGASIN : on vient de nous ajouter à ce coffre.
       * C'est LE cas qui rend l'ajout direct (F06) visible sans rechargement.
       *
       * La condition sur `deletedAt` n'est pas un détail de style, c'est ce qui
       * empêche une boucle perpétuelle : la route sert AUSSI les coffres
       * supprimés (c'est ainsi qu'on apprend la suppression), que `loadVaults`
       * écarte par construction. Sans elle, les deux se contrediraient à chaque
       * tour, pour toujours.
       */
      resumeChange = true;
    }

    if (resumeChange) {
      out.reloadVaults = true;
      if (managed.has(head.vaultId)) out.reloadManagement.push(head.vaultId);
    }
  }

  /**
   * DISPARU DE LA RÉPONSE = PLUS MEMBRE — mais UNIQUEMENT dans un espace dont
   * la réponse est arrivée. Un espace muet (requête en échec) ne prouve rien,
   * et conclure à sa place verrouillerait tous les coffres où l'on nous a
   * invité au premier hoquet réseau.
   */
  for (const k of input.known) {
    if (!covered.has(k.organizationId)) continue;
    if (seen.has(k.vaultId)) continue;
    out.goneVaultIds.push(k.vaultId);
    out.reloadVaults = true;
  }

  return out;
}

/**
 * La mémoire du tour suivant : les têtes d'AVANT, mises à jour de ce qu'on
 * vient d'apprendre.
 *
 * POURQUOI PAS UN SIMPLE REMPLACEMENT. Un espace dont la requête a échoué n'a
 * rendu aucune tête ; écraser la mémoire avec ce qui est arrivé effacerait la
 * sienne, et le tour suivant croirait tout neuf — un rechargement complet à
 * chaque hoquet réseau. On ne remplace donc que dans les espaces COUVERTS, où
 * l'absence est une information (le coffre n'est plus à nous) plutôt qu'un
 * silence.
 */
export function rememberVaultHeads(
  previous: Record<string, VaultHead>,
  heads: VaultHead[],
  coveredOrgIds: string[],
  known: KnownVault[]
): Record<string, VaultHead> {
  const covered = new Set(coveredOrgIds);
  const next: Record<string, VaultHead> = {};
  const orgOf = new Map(known.map((k) => [k.vaultId, k.organizationId]));
  for (const [vaultId, head] of Object.entries(previous)) {
    const org = orgOf.get(vaultId);
    // Un coffre dont l'espace n'a pas répondu garde sa tête ; un coffre d'un
    // espace couvert qui n'est plus servi la perd (sinon elle survivrait à
    // l'appartenance).
    if (org !== undefined && covered.has(org)) continue;
    next[vaultId] = head;
  }
  for (const head of heads) next[head.vaultId] = head;
  return next;
}

/**
 * LA CADENCE, sortie du guetteur pour être éprouvée sans piloter le temps.
 *
 * 25 s en régime normal (voir l'en-tête de `VaultHeadsWatcher` pour le choix du
 * chiffre), puis un doublement par échec CONSÉCUTIF, plafonné à 5 minutes. Le
 * compteur retombe à zéro au premier succès ET au retour au premier plan : un
 * recul accumulé pendant une mise en veille ne punit rien.
 */
export const INTERVALLE_MS = 25_000;
export const RECUL_MAX_MS = 5 * 60_000;

export function prochainDelai(echecsConsecutifs: number): number {
  if (echecsConsecutifs <= 0) return INTERVALLE_MS;
  return Math.min(INTERVALLE_MS * 2 ** echecsConsecutifs, RECUL_MAX_MS);
}

/** Un onglet, réduit à ce que la sélection lit. */
export interface PanelSnapshot {
  activeTabId: string;
  tabs: Array<{ id: string; route: string }>;
}

/**
 * LES COFFRES QU'ON REGARDE, tirés des panneaux.
 *
 * L'onglet ACTIF de chaque panneau seulement — la vue scindée en montre deux à
 * la fois, un onglet en arrière-plan n'en montre aucun (ses éléments seront
 * relus à son activation, comme aujourd'hui). `?view=settings` distingue la page
 * « Gérer le coffre » de l'explorateur : c'est le seul écran qui doit être
 * prévenu d'un changement d'effectif pendant qu'il est ouvert.
 *
 * Le décodage passe par `vaultTargetFromRoute`, l'autorité des routes de coffre
 * — jamais par une expression régulière locale qui divergerait le jour où la
 * forme de l'adresse changera.
 */
export function vaultTargetsFromPanels(panels: readonly PanelSnapshot[]): {
  visibleVaultIds: string[];
  managedVaultIds: string[];
} {
  const vus: string[] = [];
  const geres: string[] = [];
  for (const panel of panels) {
    const actif = panel.tabs.find((t) => t.id === panel.activeTabId);
    if (!actif) continue;
    const cible = vaultTargetFromRoute(actif.route);
    if (!cible) continue;
    if (!vus.includes(cible.vaultId)) vus.push(cible.vaultId);
    if (cible.view === 'settings' && !geres.includes(cible.vaultId)) geres.push(cible.vaultId);
  }
  return { visibleVaultIds: vus, managedVaultIds: geres };
}
