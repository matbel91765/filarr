/**
 * vaultSettingsModel — les décisions de l'onglet « Réglages » (F13), sans React,
 * sans réseau, sans traduction.
 *
 * DEUX BLOCS, ET LA FRONTIÈRE EST LE SUJET. Un coffre a deux moitiés de
 * réglages, et l'écran doit les distinguer parce qu'elles n'ont pas la même
 * force :
 *
 *  · « appliqué par le serveur » — `settings`, EN CLAIR, parce qu'une règle que
 *    le serveur ne peut pas lire n'est pas une règle. Uniquement des entiers,
 *    des énumérés et des booléens : un champ de texte libre ici serait une
 *    fuite, pas une fonctionnalité (zéro-connaissance) ;
 *  · « appliqué par votre application » — un bloc scellé sous K_vault que le
 *    serveur range sans jamais l'ouvrir. Tout ce qui ressemble à du texte y va,
 *    et il n'est appliqué que par les clients à jour. L'écran le DIT : promettre
 *    une contrainte que seul le client honore serait un mensonge.
 *
 * CE MODULE MIROITE `infra/cloudflare-worker/src/vaultSettings.ts`, MAIS
 * SEULEMENT LES CHAMPS QUE CET ÉCRAN ÉDITE — les cinq de la v1, plus les quatre
 * de F20/F21/F24 (conservation de la corbeille, révisions retenues, relance
 * automatique des invitations, plafond de stockage). Le document du serveur peut
 * en porter d'autres, aujourd'hui ou demain, et ceux-là traversent cet écran
 * SANS ÊTRE TOUCHÉS : le correctif est partiel, et un champ absent du correctif
 * est un champ que le serveur ne change pas. C'est la même discipline que le
 * bloc chiffré et ses champs « portés ». Ajouter un réglage ici demande donc
 * trois choses : le champ, sa borne, et sa ligne à l'écran — jamais un envoi du
 * document entier.
 *
 * Les bornes, les rôles et les défauts sont écrits deux fois, et c'est assumé :
 * le renderer ne compile pas le worker. La règle est donc que le client soit, en
 * cas de doute, PLUS PERMISSIF que le serveur — un client plus strict rend
 * introuvable un geste légitime, un client plus permissif récolte un refus déjà
 * traduit (`grants_disabled`, `grant_expiry_too_far`, `setting_forbidden`).
 * C'est pour cette raison que `readVaultSettings` retombe sur les défauts d'AVANT
 * F13 quand il n'a rien pu lire.
 *
 * POURQUOI TOUT CELA EST PUR. Un correctif partiel mal construit remet des
 * champs au défaut sans que personne ne l'ait demandé ; un encodeur de bloc qui
 * oublie les clés qu'il ne connaît pas efface l'apparence (F14) et la règle OOB
 * (F25) au premier enregistrement fait par un client plus ancien ; un décodeur
 * qui LÈVE ferme l'onglet entier. Rien de tout cela ne se voit à la compilation.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Le document EN CLAIR — ce que le serveur applique lui-même
// ─────────────────────────────────────────────────────────────────────────────

/** Les rôles qu'une invitation peut donner — jamais `owner` : la propriété se
 *  TRANSFÈRE, elle ne s'invite pas. Même liste que `VAULT_INVITE_ROLES` côté
 *  worker (l'ordre est celui de l'écran : du plus fort au plus faible). */
export const VAULT_INVITE_ROLES = ['admin', 'member', 'viewer'] as const;
export type VaultInviteRole = (typeof VAULT_INVITE_ROLES)[number];

export const MIN_INVITE_TTL_DAYS = 1;
export const MAX_INVITE_TTL_DAYS = 30;
export const MIN_GRANT_EXPIRY_DAYS = 1;
export const MAX_GRANT_EXPIRY_DAYS = 365;

/**
 * Les durées de conservation de la corbeille (F20) — une ÉNUMÉRATION, pas un
 * intervalle, et c'est le serveur qui l'impose.
 *
 * La requête de balayage compare la valeur stockée à cette même liste avant de
 * s'en servir : une durée hors liste y retomberait sur le défaut. Offrir « 21
 * jours » promettrait donc une conservation que le serveur n'applique pas.
 */
export const TRASH_RETENTION_CHOICES: readonly number[] = [7, 14, 30, 90];

/** Combien de révisions supersédées d'un élément restent récupérables (F20). */
export const MIN_RETAINED_REVISIONS = 1;
export const MAX_RETAINED_REVISIONS = 10;

/**
 * Le plafond de stockage d'un coffre (F24) se saisit en GIGAOCTETS et voyage en
 * OCTETS : le serveur ne connaît que des octets, et l'hôte ne pense pas en
 * octets. La conversion vit ici pour que l'aller-retour saisie → serveur →
 * saisie soit éprouvé une fois pour toutes.
 */
export const BYTES_PER_GB = 1024 ** 3;

/** La borne haute du serveur (100 Tio) — rabattre ici évite un aller-retour. */
export const MAX_STORAGE_CAP_BYTES = 100 * 1024 ** 4;

/** Au-delà, la jauge du plafond de coffre mérite d'être signalée. */
export const STORAGE_CAP_WARNING_PCT = 80;

/**
 * Les durées PROPOSÉES, plutôt qu'un champ libre entre 1 et 30.
 *
 * Le serveur accepte n'importe quel entier de la plage ; l'écran n'a pas à faire
 * saisir « 23 ». Cinq paliers couvrent les intentions réelles (un lien d'un
 * jour pour une vérification à voix haute, un mois pour quelqu'un en congés), et
 * un menu ne peut pas produire de valeur hors borne — ce qu'un `<input
 * type=number>` fait à la moindre frappe.
 */
export const INVITE_TTL_CHOICES: readonly number[] = [1, 3, 7, 14, 30];

/**
 * Les durées à PROPOSER, en tenant compte de ce que le coffre porte DÉJÀ.
 *
 * Le serveur accepte n'importe quel entier de 1 à 30 : un autre client — ou une
 * version future de celui-ci — peut donc avoir posé 21 jours, que les cinq
 * paliers ne savent pas dire. Un menu qui ne contient pas sa propre valeur
 * s'affiche VIDE : le champ ment alors sur l'état du coffre, et il le fait
 * précisément sur les coffres réglés par quelqu'un d'autre. On injecte donc les
 * valeurs présentes (l'enregistrée ET le brouillon, sans quoi « Réinitialiser »
 * proposerait une valeur que le menu ne sait plus afficher) à leur rang.
 *
 * Ce qui sort des bornes du serveur, en revanche, n'est JAMAIS injecté : ce
 * serait offrir un choix qui ne peut que se faire refuser. C'est le même
 * arbitrage que `grantExpiryChoices`, qui propose toujours la borne elle-même.
 */
export function inviteTtlChoices(present: readonly number[]): number[] {
  const choix = new Set<number>(INVITE_TTL_CHOICES);
  for (const jours of present) {
    if (isInteger(jours, MIN_INVITE_TTL_DAYS, MAX_INVITE_TTL_DAYS)) choix.add(jours);
  }
  return [...choix].sort((a, b) => a - b);
}

export interface VaultSettingsDocument {
  /** Durée de vie d'une invitation de coffre, en jours (remplaçait la constante 7 j). */
  inviteTtlDays: number;
  /** Le rôle qu'une invitation reçoit quand l'écran n'en nomme pas d'autre. */
  defaultInviteRole: VaultInviteRole;
  /**
   * Les accès ponctuels par élément sont-ils ouverts sur ce coffre ?
   *
   * CE QUE LE COUPER FAIT EXACTEMENT : il ferme la CRÉATION, et elle seule. Les
   * accès déjà donnés continuent de fonctionner et se réparent encore d'une
   * version d'élément à l'autre. L'écran doit le dire, sans quoi l'hôte croira
   * avoir refermé une porte qui reste ouverte pour ceux qui la franchissent
   * déjà — la liste des accès vivants les nomme un par un, et chacun se révoque.
   */
  itemGrantsEnabled: boolean;
  /** Expiration maximale d'un accès ponctuel, en jours. `null` = aucun plafond. */
  grantMaxExpiryDays: number | null;
  /** Supprimer un élément exige-t-il le rang admin (au lieu de « déposant OU admin ») ? */
  itemDeleteRequiresAdmin: boolean;
  /**
   * Combien de jours un élément reste à la corbeille avant destruction (F20).
   *
   * PLAFONNÉ PAR LA POLITIQUE DE L'ESPACE HÔTE, et le refus a son propre code
   * (`retention_over_policy`, 400) : la valeur demandée n'est pas MAL FORMÉE,
   * elle est légitime et quelqu'un d'autre l'a plafonnée ailleurs. L'écran doit
   * dire lequel des deux réglages céder, pas prétendre à une faute de saisie.
   */
  trashRetentionDays: number;
  /** Combien de révisions supersédées d'un élément restent récupérables (1..10). */
  retainedRevisions: number;
  /**
   * Relancer automatiquement une invitation 48 h avant qu'elle expire (F21).
   *
   * C'EST LE SERVEUR QUI L'ENVOIE, pas l'application : le cron passe même quand
   * personne n'ouvre Filarr, et c'est tout l'intérêt — le défaut qu'on ferme est
   * une invitation morte de vieillesse chez un hôte qui la croyait donnée. Le
   * champ est donc EN CLAIR comme les autres règles appliquées par le worker :
   * une règle qu'il ne pourrait pas lire ne s'appliquerait jamais.
   *
   * COUPER N'EFFACE RIEN : les rappels DÉJÀ envoyés restent envoyés, et la
   * relance manuelle de l'hôte continue de fonctionner. L'écran doit le dire, à
   * la manière de `itemGrantsEnabled` — on ferme une source d'envois futurs, on
   * ne reprend pas ceux qui sont partis.
   */
  autoRemindInvites: boolean;
  /**
   * Plafond de stockage PROPRE À CE COFFRE, en octets. `null` = aucun.
   *
   * IL NE RÉSERVE RIEN : le pool mutualisé de l'espace reste la limite réelle, et
   * un coffre plafonné à 50 Go dans un espace plein est refusé par le pool. Il
   * empêche un coffre de manger l'espace des autres — le seul cas que le pool ne
   * sait pas traiter, puisqu'il ne connaît que le total. D'où deux refus
   * distincts côté serveur (`vault_quota_exceeded` / `pooled_quota_exceeded`) et
   * deux phrases distinctes à l'écran : ils se lèvent par des gestes opposés.
   */
  storageCapBytes: number | null;
}

/**
 * LES DÉFAUTS SONT LE COMPORTEMENT D'AVANT F13, à l'identique — et ce sont aussi
 * ceux sur lesquels on retombe quand la lecture échoue. Un coffre sans ligne de
 * réglages doit se comporter exactement comme hier ; un coffre dont on n'a pas su
 * lire les réglages doit lui aussi rester ouvert, et laisser le serveur refuser
 * avec sa phrase, plutôt que de retirer des gestes sur une ignorance.
 */
export const DEFAULT_VAULT_SETTINGS: Readonly<VaultSettingsDocument> = {
  inviteTtlDays: 7,
  defaultInviteRole: 'member',
  itemGrantsEnabled: true,
  grantMaxExpiryDays: null,
  itemDeleteRequiresAdmin: false,
  // Les valeurs qui étaient EN DUR dans le worker avant F20/F24 : trente jours de
  // corbeille, trois révisions retenues, aucun plafond de coffre. Un coffre qui
  // n'a jamais rien réglé doit se comporter exactement comme hier — sans quoi
  // l'arrivée de ces curseurs changerait le sort de tous les coffres existants
  // sans que personne ne l'ait demandé.
  trashRetentionDays: 30,
  retainedRevisions: 3,
  storageCapBytes: null,
  /**
   * LA SEULE VALEUR DE CETTE LISTE QUI N'EST PAS « COMME AVANT » (F21). Toutes
   * les autres reproduisent un comportement existant ; la relance automatique
   * n'existait pas du tout. Son défaut est VRAI parce que personne ne peut
   * regretter la disparition d'un comportement qu'il n'a jamais eu — et parce
   * que l'absence de rappel est précisément ce qui a coûté un accès. Le worker
   * pose le même défaut : deux valeurs différentes feraient afficher ici
   * l'inverse de ce que le cron applique là-bas.
   */
  autoRemindInvites: true,
};

const SETTING_KEYS = [
  'inviteTtlDays',
  'defaultInviteRole',
  'itemGrantsEnabled',
  'grantMaxExpiryDays',
  'itemDeleteRequiresAdmin',
  'trashRetentionDays',
  'retainedRevisions',
  'autoRemindInvites',
  'storageCapBytes',
] as const;

/**
 * Les SECTIONS de l'écran. `invitations` et `permissions` sont les deux moitiés
 * du bloc « appliqué par le serveur » (l'audit du worker parle le même
 * vocabulaire) ; `app` est le bloc chiffré — nommé d'après ce que l'écran en
 * dit, « appliqué par votre application », et non d'après sa forme technique.
 */
export type VaultSettingsSection = 'invitations' | 'permissions' | 'retention' | 'storage' | 'app';

const SECTION_OF: Record<(typeof SETTING_KEYS)[number], VaultSettingsSection> = {
  inviteTtlDays: 'invitations',
  defaultInviteRole: 'invitations',
  // La MÊME section que côté worker : le journal d'audit dit dans quelle partie
  // quelque chose a changé, et deux vocabulaires produiraient une ligne que
  // l'écran ne saurait pas relire.
  autoRemindInvites: 'invitations',
  itemGrantsEnabled: 'permissions',
  grantMaxExpiryDays: 'permissions',
  itemDeleteRequiresAdmin: 'permissions',
  // Les mêmes noms que l'audit du worker (`retention`, `storage`) : le journal
  // dit QUE quelque chose a changé et DANS QUELLE partie, et l'écran doit parler
  // le même vocabulaire que la ligne qu'il produit.
  trashRetentionDays: 'retention',
  retainedRevisions: 'retention',
  storageCapBytes: 'storage',
};

/** L'ordre d'affichage des sections, une fois pour toutes. */
const SECTION_ORDER: readonly VaultSettingsSection[] = [
  'invitations',
  'permissions',
  'retention',
  'storage',
  'app',
];

function isInteger(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

/**
 * Relire ce que le serveur a rendu, SANS JAMAIS LEVER — un JSON tordu, une clé
 * d'une version plus récente, une valeur hors borne écrite par un client bogué :
 * tout retombe sur le défaut du champ concerné, jamais sur une page fermée.
 *
 * Chaque champ retombe SÉPARÉMENT : une seule valeur illisible ne doit pas
 * emporter les quatre autres, qui sont peut-être exactement celles que l'hôte a
 * posées.
 */
export function readVaultSettings(raw: unknown): VaultSettingsDocument {
  const root: Record<string, unknown> =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const role =
    typeof root.defaultInviteRole === 'string' &&
    (VAULT_INVITE_ROLES as readonly string[]).includes(root.defaultInviteRole)
      ? (root.defaultInviteRole as VaultInviteRole)
      : DEFAULT_VAULT_SETTINGS.defaultInviteRole;

  return {
    inviteTtlDays: isInteger(root.inviteTtlDays, MIN_INVITE_TTL_DAYS, MAX_INVITE_TTL_DAYS)
      ? root.inviteTtlDays
      : DEFAULT_VAULT_SETTINGS.inviteTtlDays,
    defaultInviteRole: role,
    itemGrantsEnabled:
      typeof root.itemGrantsEnabled === 'boolean'
        ? root.itemGrantsEnabled
        : DEFAULT_VAULT_SETTINGS.itemGrantsEnabled,
    // `null` est une valeur LÉGITIME (aucun plafond) et ne se distingue pas
    // d'une valeur illisible par un simple `??` — d'où le test explicite.
    grantMaxExpiryDays:
      root.grantMaxExpiryDays === null
        ? null
        : isInteger(root.grantMaxExpiryDays, MIN_GRANT_EXPIRY_DAYS, MAX_GRANT_EXPIRY_DAYS)
          ? root.grantMaxExpiryDays
          : DEFAULT_VAULT_SETTINGS.grantMaxExpiryDays,
    itemDeleteRequiresAdmin:
      typeof root.itemDeleteRequiresAdmin === 'boolean'
        ? root.itemDeleteRequiresAdmin
        : DEFAULT_VAULT_SETTINGS.itemDeleteRequiresAdmin,
    // Une durée HORS ÉNUMÉRATION retombe sur le défaut, exactement comme le fait
    // la lecture du worker : l'afficher telle quelle ferait croire à une
    // conservation que le balayage n'applique pas.
    trashRetentionDays: TRASH_RETENTION_CHOICES.includes(root.trashRetentionDays as number)
      ? (root.trashRetentionDays as number)
      : DEFAULT_VAULT_SETTINGS.trashRetentionDays,
    retainedRevisions: isInteger(
      root.retainedRevisions,
      MIN_RETAINED_REVISIONS,
      MAX_RETAINED_REVISIONS
    )
      ? root.retainedRevisions
      : DEFAULT_VAULT_SETTINGS.retainedRevisions,
    // UN BOOLÉEN DONT LE DÉFAUT EST VRAI : le test de type est indispensable, et
    // un `??` ne suffirait pas. Lire une valeur illisible — ou l'absence du
    // champ sur un coffre d'avant 0078 — comme `false` ÉTEINDRAIT à l'écran un
    // rappel que le cron envoie quand même, et l'hôte relancerait à la main en
    // tuant un lien encore valide.
    autoRemindInvites:
      typeof root.autoRemindInvites === 'boolean'
        ? root.autoRemindInvites
        : DEFAULT_VAULT_SETTINGS.autoRemindInvites,
    // `null` est une valeur LÉGITIME (aucun plafond) et `0` en est une autre
    // (« plus un octet de plus ») : les deux se distinguent, et un `||` les
    // confondrait. Une valeur illisible retombe sur « aucun plafond », le plus
    // permissif — un client plus strict que le serveur refuserait des dépôts que
    // le serveur accepte.
    storageCapBytes: isInteger(root.storageCapBytes, 0, MAX_STORAGE_CAP_BYTES)
      ? root.storageCapBytes
      : DEFAULT_VAULT_SETTINGS.storageCapBytes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Le plafond de stockage, tel qu'il se tape et tel qu'il se lit (F24)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Une saisie en gigaoctets → des octets, ou `null` pour « aucun plafond ».
 *
 * LE CHAMP VIDE EST « AUCUN PLAFOND », PAS « ZÉRO OCTET », et la nuance décide
 * du sort du coffre : `0` refuse le prochain dépôt, `null` ne refuse rien. Un
 * `Number('')` vaut zéro — c'est précisément le piège que ce parseur ferme.
 *
 * ON RABAT PLUTÔT QUE DE REFUSER, comme pour le plafond d'expiration : une
 * frappe de trop ne doit pas coûter un aller-retour et un message d'erreur, mais
 * elle ne doit pas non plus arriver telle quelle au serveur. La granularité est
 * le gigaoctet ENTIER : c'est l'unité dans laquelle un plafond de coffre se
 * pense, et une décimale rendrait l'aller-retour d'affichage instable.
 */
export function parseStorageCapGb(raw: string): number | null {
  const texte = raw.trim();
  if (!texte) return null;
  const go = Number(texte);
  if (!Number.isFinite(go)) return null;
  const octets = Math.floor(go) * BYTES_PER_GB;
  if (octets < 0) return 0;
  return Math.min(octets, MAX_STORAGE_CAP_BYTES);
}

/**
 * Des octets → ce que le champ affiche. Vide pour « aucun plafond » : afficher
 * « 0 » dirait qu'un plafond nul est posé, c'est-à-dire l'inverse.
 */
export function formatStorageCapGb(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return '';
  return String(Math.floor(bytes / BYTES_PER_GB));
}

export interface StorageCapUsage {
  /** Le remplissage du plafond, en % — BORNÉ à 100 : une jauge ne déborde pas. */
  pct: number;
  /** Le coffre occupe DÉJÀ plus que le plafond demandé. */
  over: boolean;
  tone: 'ok' | 'warning' | 'danger';
}

/**
 * Ce que la jauge du plafond montre — ou `null` quand il n'y a pas de plafond,
 * donc rien à jauger.
 *
 * UN PLAFOND SOUS L'USAGE COURANT EST ACCEPTÉ PAR LE SERVEUR, et c'est voulu : il
 * ne détruit rien, il refuse la SUITE. Mais l'écran doit le dire AVANT
 * d'enregistrer — « vous êtes déjà au-dessus, les nouveaux envois seront
 * refusés » — plutôt que de le laisser découvrir au premier dépôt refusé, où le
 * message parlerait d'un plafond qu'on a soi-même posé sans le savoir.
 */
export function storageCapUsage(input: {
  capBytes: number | null;
  usedBytes: number;
}): StorageCapUsage | null {
  if (input.capBytes === null || !Number.isFinite(input.capBytes)) return null;
  const over = input.usedBytes > input.capBytes;
  // Un plafond à zéro est plein par définition, et la division n'a pas lieu.
  const pct =
    input.capBytes <= 0
      ? 100
      : Math.min(100, Math.max(0, Math.round((input.usedBytes / input.capBytes) * 100)));
  return {
    pct,
    over,
    tone: over ? 'danger' : pct >= STORAGE_CAP_WARNING_PCT ? 'warning' : 'ok',
  };
}

/**
 * Rabattre une saisie de plafond dans les bornes du serveur.
 *
 * ON RABAT, ON NE REFUSE PAS — et c'est l'inverse de ce que fait le serveur, à
 * dessein : lui valide une requête déjà partie et doit dire non plutôt que de
 * rogner en silence ; ici on borne un CHAMP DE SAISIE, avant qu'il ne parte. Une
 * frappe de trop (« 3000 ») n'a pas à coûter un aller-retour et un message
 * d'erreur — mais elle ne doit pas non plus arriver telle quelle au serveur.
 */
export function clampGrantMaxExpiryDays(raw: number | null): number | null {
  if (raw === null || !Number.isFinite(raw)) return null;
  const n = Math.floor(raw);
  if (n < MIN_GRANT_EXPIRY_DAYS) return MIN_GRANT_EXPIRY_DAYS;
  if (n > MAX_GRANT_EXPIRY_DAYS) return MAX_GRANT_EXPIRY_DAYS;
  return n;
}

// ─────────────────────────────────────────────────────────────────────────────
// Le bloc chiffré — « appliqué par votre application »
// ─────────────────────────────────────────────────────────────────────────────

export const VAULT_SETTINGS_BLOCK_VERSION = 1;

/** Une description tient sur deux lignes d'en-tête. Bornée AVANT le chiffrement :
 *  le serveur ne peut pas la borner, il ne la lit pas. */
export const MAX_VAULT_DESCRIPTION = 280;

/**
 * La longueur MAXIMALE d'un identifiant d'élément épinglé (F27).
 *
 * Ce champ ne porte QU'UN identifiant — un UUID en fait 36. La borne n'est pas
 * un caprice : cet identifiant repart dans une route (`?item=…`) et dans une
 * comparaison d'ensemble, et le bloc est écrit par des clients qu'on ne
 * contrôle pas tous. Ce qui déborde n'entre pas, plutôt que d'être propagé.
 */
export const MAX_VAULT_ITEM_ID = 128;

/**
 * Le bloc, tel que CE client le comprend.
 *
 * `description` (F13) et `pinnedItemId` (F27) sont les deux champs que cette
 * version SAIT lire. Les autres sont PORTÉS SANS ÊTRE COMPRIS (`carried`) :
 * l'apparence viendra avec F14, la règle de vérification
 * hors bande avec F25, et d'ici là un client d'aujourd'hui qui rescelle le bloc
 * doit les rendre INTACTS. Sans cela, ouvrir puis enregistrer les réglages
 * depuis une version plus ancienne effacerait silencieusement ce qu'une version
 * plus récente y avait posé — un défaut qui ne se voit jamais chez celui qui le
 * provoque, seulement chez les autres membres du coffre.
 */
export interface VaultSettingsBlock {
  description: string;
  /**
   * F27 — LA NOTE ÉPINGLÉE. L'identifiant d'UN élément du coffre, et rien
   * d'autre : la note reste une note ordinaire, présente dans l'explorateur
   * comme les autres — l'épingle ne la cache ni ne la duplique, elle la
   * DÉSIGNE. Le champ vit dans le bloc scellé parce qu'un identifiant d'élément
   * mis en avant dit quelque chose du coffre que le serveur n'a pas à savoir.
   *
   * `undefined` = rien d'épinglé. Jamais la chaîne vide : le décodeur et
   * l'encodeur s'entendent pour que « absent » ait UNE seule forme, sans quoi
   * deux encodages du même état différeraient et rescelleraient pour rien.
   */
  pinnedItemId?: string;
  /** Ce que cette version ne connaît pas, gardé tel quel pour le rescellement. */
  carried?: Record<string, unknown>;
}

/** Les clés que CETTE version sait produire — tout le reste est « porté ». */
const KNOWN_BLOCK_KEYS = new Set(['v', 'description', 'pinnedItemId']);

/**
 * Un identifiant d'élément, ou rien. Le raboté est significatif : le champ est
 * comparé à des identifiants venus de la liste du coffre, et une espèce en trop
 * rendrait « épinglée, illisible » une note parfaitement lisible.
 */
function readPinnedItemId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const id = raw.trim();
  if (!id || id.length > MAX_VAULT_ITEM_ID) return undefined;
  return id;
}

/**
 * Décoder le bloc, SANS JAMAIS LEVER. Une description perdue coûte une ligne de
 * texte ; une exception ici ferme l'onglet Réglages en entier, y compris les
 * réglages en clair qui, eux, se lisent parfaitement.
 *
 * `v` n'est PAS vérifiée : une version future dont on sait lire `description` se
 * lit, et ce qu'on ne comprend pas voyage dans `carried`. Refuser sur le numéro
 * de version rendrait un bloc parfaitement lisible illisible.
 */
export function decodeVaultSettingsBlock(json: string | null | undefined): VaultSettingsBlock {
  let root: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(json ?? '');
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { description: '' };
    }
    root = parsed as Record<string, unknown>;
  } catch {
    return { description: '' };
  }

  const carried: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(root)) if (!KNOWN_BLOCK_KEYS.has(k)) carried[k] = v;

  const description = typeof root.description === 'string' ? root.description : '';
  const pinnedItemId = readPinnedItemId(root.pinnedItemId);
  return {
    description: description.slice(0, MAX_VAULT_DESCRIPTION),
    // Un champ HORS BORNES est laissé de côté, pas « porté » : `pinnedItemId`
    // est une clé que cette version CONNAÎT, et la reconduire telle quelle
    // rescellerait la valeur aberrante qu'on vient de refuser de lire.
    ...(pinnedItemId ? { pinnedItemId } : {}),
    ...(Object.keys(carried).length > 0 ? { carried } : {}),
  };
}

/**
 * Encoder le bloc à sceller. TOUJOURS une chaîne, jamais `null`.
 *
 * POURQUOI PAS DE « RIEN À SCELLER ». Un premier jet rendait `null` pour un bloc
 * sans description, l'idée étant de ne pas écrire un blob que personne
 * n'ouvrira. Mais c'est précisément ce `null` qui rendait EFFACER une
 * description impossible : celui qui vidait le champ et cliquait Enregistrer ne
 * voyait rien se passer, et le texte revenait au rechargement suivant. Une
 * enveloppe `{ v: 1 }` scellée dit quelque chose de parfaitement clair — « ce
 * coffre n'a pas de description » — et c'est ce que le décodeur relit.
 *
 * Ce n'est pas une écriture pour rien : c'est `vaultSettingsSavePlan` qui décide
 * s'il y a lieu d'écrire, en comparant les DEUX encodages. Un bloc inchangé
 * produit la même chaîne des deux côtés et ne part pas.
 *
 * La description est RABOTÉE puis bornée avant d'entrer : le serveur ne peut pas
 * la borner, il ne la lit pas.
 */
export function encodeVaultSettingsBlock(block: VaultSettingsBlock): string {
  const description = block.description.trim().slice(0, MAX_VAULT_DESCRIPTION);
  const pinnedItemId = readPinnedItemId(block.pinnedItemId);
  return JSON.stringify({
    v: VAULT_SETTINGS_BLOCK_VERSION,
    ...(block.carried ?? {}),
    ...(description ? { description } : {}),
    // DÉSÉPINGLER, c'est OMETTRE. Écrire `pinnedItemId: null` serait une valeur
    // de plus à interpréter à la lecture, et une seconde façon de dire « rien ».
    ...(pinnedItemId ? { pinnedItemId } : {}),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// L'époque du scellé
// ─────────────────────────────────────────────────────────────────────────────

/** Sous quelle clé le bloc enregistré a-t-il été scellé. */
export type SealVerdict = 'absent' | 'current' | 'superseded';

/**
 * `superseded` est le cas qui devait exister.
 *
 * Le bloc est scellé sous K_vault de l'époque où on l'a enregistré. Une rotation
 * (un retrait de membre) engendre K_vault' — et un client d'avant cette fiche ne
 * rescellait pas le bloc. Le lire avec la clé courante échoue, et l'écran
 * afficherait alors une description VIDE : c'est-à-dire qu'il ferait croire à un
 * texte effacé, là où il suffit de le ré-enregistrer pour le remettre à
 * l'endroit. Une époque ABSENTE se traite comme révolue, pour la même raison :
 * on ne sait pas sous quelle clé il a été scellé, et supposer « la courante »
 * serait promettre qu'il n'y a rien à réparer.
 */
export function settingsSealVerdict(input: {
  hasBlock: boolean;
  settingsEpoch: number | null | undefined;
  currentKeyEpoch: number;
}): SealVerdict {
  if (!input.hasBlock) return 'absent';
  if (typeof input.settingsEpoch !== 'number') return 'superseded';
  return input.settingsEpoch >= input.currentKeyEpoch ? 'current' : 'superseded';
}

/** Ce que l'écran doit dire du bloc enregistré — et ce qu'il a le droit d'en faire. */
export interface SettingsBlockNotice {
  /**
   * Le bloc est à RESCELLER : scellé sous une clé révolue, mais ouvert ici. Ce
   * drapeau commande à la fois la phrase affichée et le `forceReseal` du plan —
   * annoncer le geste sans l'armer laisserait l'avertissement à demeure.
   */
  reseal: boolean;
  /**
   * Un bloc EXISTE et cet appareil ne l'a pas ouvert. Aucun rescellement n'est
   * alors permis : le champ est vide parce qu'on n'a rien su lire, et le sceller
   * par-dessus effacerait ce qu'un autre membre ouvre encore.
   */
  unreadable: boolean;
  /**
   * L'illisibilité ci-dessus est PROVISOIRE : une lecture est encore en vol.
   *
   * Le chargeur pose la ligne du serveur avant d'avoir déchiffré le bloc, si
   * bien qu'entre les deux `hasStoredBlock` est déjà vrai pendant que
   * `blockReadable` porte encore la réponse du tour précédent. Sur la relecture
   * qui suit un déverrouillage — celle qui va justement RÉUSSIR — l'écran
   * annonçait « bloc illisible » là où « patientez » était la vérité.
   *
   * Ce drapeau ne change RIEN au refus d'écrire (on ne scelle jamais par-dessus
   * un bloc qu'on n'a pas ouvert) : il ne change que la phrase. Il ne qualifie
   * donc que `unreadable`, jamais un bloc lu.
   */
  pending: boolean;
}

/**
 * LES DEUX VERDICTS NE S'EXCLUENT PAS, ET LES CONFONDRE DÉTRUIT DES DONNÉES.
 *
 * Un bloc scellé sous une clé révolue se lit souvent quand même (les époques
 * passées restent en cache) : là, « ré-enregistrez pour le resceller » est le
 * bon conseil, et le rescellement forcé le rend enfin faisable.
 *
 * Mais les MÊMES causes produisent aussi le cas où l'on n'a rien pu ouvrir — un
 * bloc sans époque déclarée, une clé d'époque absente de cet appareil, un tag
 * AES-GCM qui refuse. Y afficher « ré-enregistrez » revient à faire sceller un
 * champ VIDE, sans les champs portés, par-dessus un couple que le porteur de
 * l'ancienne clé sait encore ouvrir : la description et ce que F14/F25 y
 * avaient posé disparaissent pour tout le monde. La rotation applique déjà
 * cette règle (« envoyer un bloc qu'on n'a pas su ouvrir écraserait ce qui est
 * encore récupérable ») ; l'enregistrement doit l'appliquer aussi.
 *
 * D'où deux drapeaux plutôt qu'un état exclusif : l'illisibilité PRIME, et le
 * rescellement n'est proposé que sur un bloc réellement lu.
 */
export function settingsBlockNotice(input: {
  seal: SealVerdict;
  blockReadable: boolean;
  /** Le serveur porte-t-il un couple chiffré pour ce coffre ? */
  hasStoredBlock: boolean;
  /**
   * Une lecture des réglages est en vol. Optionnel : un appelant qui n'a pas la
   * notion garde exactement l'ancienne phrase.
   */
  loading?: boolean;
}): SettingsBlockNotice {
  const unreadable = input.hasStoredBlock && !input.blockReadable;
  return {
    reseal: input.hasStoredBlock && input.seal === 'superseded' && !unreadable,
    unreadable,
    // « Pas encore lu » n'est qu'une NUANCE de « pas lu » — jamais une
    // permission d'écrire, et jamais un mot sur un bloc parfaitement ouvert.
    pending: unreadable && input.loading === true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Le plan d'enregistrement
// ─────────────────────────────────────────────────────────────────────────────

export interface VaultSettingsDraft {
  settings: VaultSettingsDocument;
  block: VaultSettingsBlock;
}

export interface VaultSettingsSavePlan {
  /** Le correctif PARTIEL, ou `null` : uniquement les champs qui ont changé. */
  patch: Partial<VaultSettingsDocument> | null;
  /** Le bloc à resceller, ou `null` s'il n'a pas bougé (ou n'a rien à sceller). */
  block: VaultSettingsBlock | null;
  /** Les sections touchées, dans l'ordre de l'écran — pour le dire à l'hôte. */
  sections: VaultSettingsSection[];
  /** Rien à enregistrer : le bouton reste éteint (le serveur répond 400 sinon). */
  empty: boolean;
}

/**
 * Ce qui part au serveur, et rien de plus.
 *
 * LE CORRECTIF EST PARTIEL, et c'est le fond de la fonction. Envoyer le document
 * entier obligerait ce client à connaître TOUS les champs — y compris ceux
 * qu'une version plus récente aurait ajoutés — et les remettrait au défaut sans
 * que personne ne l'ait demandé. Un champ absent du correctif est un champ
 * qu'on ne touche pas.
 *
 * LA DESCRIPTION EST COMPARÉE APRÈS RABOTAGE : sinon deux espaces ajoutés en fin
 * de champ rescelleraient le bloc sous une nouvelle version, pour rien — et
 * feraient échouer le compare-and-set de quelqu'un d'autre.
 *
 * SAUF QU'UN DIFF DE TEXTE NE SAIT RIEN DES ÉPOQUES, et c'est pourquoi
 * `forceReseal` existe. L'écran promet « ré-enregistrez pour le resceller
 * sous la clé courante » à qui porte un bloc scellé sous une clé révolue ; à
 * description inchangée les deux encodages sont identiques, le plan est vide et
 * le bouton reste éteint — changer un réglage en clair n'aide pas davantage,
 * puisque le bloc ne part que s'il a bougé. Le geste annoncé était donc
 * infaisable, et le bloc restait scellé sous une clé retirée : illisible pour
 * tout membre arrivé après la rotation. Le rescellement devient une ENTRÉE du
 * plan (voir `settingsBlockNotice`, qui ne l'arme que sur un bloc réellement
 * lu — sceller un texte jamais ouvert écraserait ce qui est encore récupérable).
 */
export function vaultSettingsSavePlan(
  saved: VaultSettingsDraft,
  draft: VaultSettingsDraft,
  opts: { forceReseal?: boolean } = {}
): VaultSettingsSavePlan {
  const patch: Partial<VaultSettingsDocument> = {};
  const sections = new Set<VaultSettingsSection>();
  for (const key of SETTING_KEYS) {
    if (saved.settings[key] === draft.settings[key]) continue;
    // Le cast est nécessaire : TypeScript ne relie pas l'index générique d'une
    // clé d'union à la valeur du même champ dans le document source.
    (patch as Record<string, unknown>)[key] = draft.settings[key];
    sections.add(SECTION_OF[key]);
  }

  const encodedSaved = encodeVaultSettingsBlock(saved.block);
  const encodedDraft = encodeVaultSettingsBlock(draft.block);
  const blockChanged = encodedSaved !== encodedDraft;
  // Le bloc part s'il a CHANGÉ, ou parce qu'on demande de le resceller : le
  // second cas est celui d'une clé qui a tourné sous un texte identique.
  const sealsBlock = blockChanged || opts.forceReseal === true;
  if (sealsBlock) sections.add('app');

  const hasPatch = Object.keys(patch).length > 0;
  return {
    patch: hasPatch ? patch : null,
    block: sealsBlock
      ? {
          ...draft.block,
          description: draft.block.description.trim().slice(0, MAX_VAULT_DESCRIPTION),
        }
      : null,
    sections: SECTION_ORDER.filter((s) => sections.has(s)),
    empty: !hasPatch && !sealsBlock,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ce que le partage par élément a le droit de proposer
// ─────────────────────────────────────────────────────────────────────────────

/** Une durée en jours, ou `null` pour « jamais ». */
export type GrantExpiryChoice = number | null;

/** Les paliers offerts quand rien ne plafonne — ceux d'avant F13. */
const GRANT_EXPIRY_STEPS: readonly number[] = [7, 30];

/**
 * UN PLAFOND REND L'EXPIRATION OBLIGATOIRE, et l'écran doit le refléter.
 *
 * Le serveur refuse (`grant_expiry_too_far`) un accès SANS expiration dès qu'un
 * plafond est posé : un accès sans fin le contournerait entièrement, ce qui
 * serait pire que de ne pas avoir de plafond du tout. Continuer à proposer
 * « jamais » sous un plafond, c'est donc offrir un bouton qui ne peut que se
 * faire refuser.
 *
 * La borne elle-même est TOUJOURS proposée, même quand elle ne tombe sur aucun
 * palier : sans elle, un plafond de 3 jours ne laisserait aucun choix du tout.
 */
export function grantExpiryChoices(maxDays: number | null): GrantExpiryChoice[] {
  if (maxDays === null) return [null, ...GRANT_EXPIRY_STEPS];
  const steps = GRANT_EXPIRY_STEPS.filter((d) => d < maxDays);
  return [...steps, maxDays];
}

/**
 * Ramener un choix devenu illégal dans ce que le coffre autorise — l'hôte peut
 * avoir changé le plafond pendant qu'un dialogue de partage était ouvert.
 * On tombe sur la BORNE plutôt que sur le palier le plus court : c'est
 * l'intention la plus proche de « jamais », qui était le défaut d'avant.
 */
export function coerceGrantExpiry(
  current: GrantExpiryChoice,
  maxDays: number | null
): GrantExpiryChoice {
  const allowed = grantExpiryChoices(maxDays);
  if (allowed.some((c) => c === current)) return current;
  return allowed[allowed.length - 1];
}

// ─────────────────────────────────────────────────────────────────────────────
// F19 — l'espace du coffre, son plan, et la conservation légale
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ce qu'on sait du plan de l'hôte. `unknown` n'est PAS « il va bien » : c'est
 * l'absence d'information, et elle ne s'affiche pas.
 */
export type HostPlanVerdict = 'unknown' | 'lapsed';

export interface VaultSpaceIdentity {
  /**
   * Le nom de l'espace quand on le connaît, son identifiant sinon — donc VIDE
   * si l'identifiant l'est. Ce n'est pas « jamais vide » : aucun appelant
   * n'en fournit un aujourd'hui (la page ne s'ouvre que sur un coffre lu),
   * et inventer ici un libellé de remplacement affirmerait un espace qu'on ne
   * connaît pas.
   */
  label: string;
  /** Faux quand `label` n'est qu'un identifiant — l'écran l'affiche autrement. */
  named: boolean;
  plan: HostPlanVerdict;
}

/**
 * L'espace du coffre, nommé sans rien inventer.
 *
 * POURQUOI LE PLAN NE SE DÉDUIT PAS DE LA LISTE DES ESPACES. L'entitlement d'un
 * espace personnel est calculé par le serveur à partir de l'abonnement de son
 * PROPRIÉTAIRE (`resolveVaultEntitlement` : tier + date d'expiration du compte
 * propriétaire), et rien de tout cela n'est servi au client — ni le `tier` de
 * l'org, ni son `billingStatus`, ne répondent à la question. Le déduire de l'un
 * ou de l'autre donnerait un verdict que le worker ne calcule pas ainsi, sur
 * l'espace de quelqu'un d'AUTRE, et il serait faux dans les deux sens.
 *
 * La seule preuve disponible est donc le refus `host_plan_lapsed` reçu pour ce
 * coffre. Sans lui, on ne dit rien — pas de badge, pas de « tout va bien » :
 * une absence d'information n'est pas un verdict (« terminal ≠ jetable »).
 */
export function vaultSpaceIdentity(input: {
  organizationId: string;
  orgs: readonly { id: string; name: string }[];
  /** Un refus `host_plan_lapsed` réellement REÇU pour ce coffre. */
  planRefused: boolean;
}): VaultSpaceIdentity {
  const org = input.orgs.find((o) => o.id === input.organizationId);
  const name = org?.name?.trim();
  return {
    label: name || input.organizationId,
    named: !!name,
    plan: input.planRefused ? 'lapsed' : 'unknown',
  };
}

/** Ce qui ferme les gestes irréversibles de l'onglet Danger. */
export type DangerGuard = 'none' | 'legalHold';

/**
 * `legalHold` est servi au rang admin SEULEMENT, et il est OMIS en dessous
 * plutôt que rendu à `false` : un `false` affirmerait qu'il n'y a pas de
 * conservation, ce qu'un membre n'a pas à apprendre du coffre.
 *
 * Absent ne ferme donc rien — le serveur refusera de toute façon, avec sa phrase
 * (`legal_hold_active`, déjà traduite) — mais l'écran n'affirme pas l'inverse
 * non plus : il ne dit simplement rien. Écrit ici plutôt qu'en `!legalHold` au
 * fil du rendu : c'est exactement le genre de condition qu'une inversion rend
 * fausse sans qu'aucun type ne bronche.
 */
export function dangerGuard(legalHold: boolean | undefined): DangerGuard {
  return legalHold === true ? 'legalHold' : 'none';
}
