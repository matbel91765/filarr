/**
 * fileDetailsSharing — la logique PURE de la section « Partage » du panneau de
 * détails, et le formatage de date du panneau. Sans JSX ni React, pour être
 * testé sous vitest-node.
 *
 * POURQUOI UN MODULE À PART. Le panneau reçoit tout par props — aucun
 * useSelector, c'est voulu : il sert la vue dossier, l'accueil, et bientôt les
 * coffres, qui n'ont pas le même magasin ni les mêmes services. Ce qui se
 * décide ici — quelles lignes, combien avant « et N de plus », quand l'avis
 * « journal désactivé » s'affiche, et surtout quand la section N'EXISTE PAS —
 * est exactement ce qu'un rendu JSX fait dériver sans bruit : une troncature
 * qui passe de 3 à 4 au détour d'un refactor, un avis qui disparaît dès que la
 * liste d'activité est vide. On le fige ici, on le teste ici.
 *
 * MODE LOCAL : le panneau ne sait pas s'il tourne en nuage ou en local (pas de
 * sélecteur, voir plus haut). C'est l'HÔTE qui ne passe pas `sharing` hors du
 * mode nuage — et sans `sharing`, la section n'existe pas. Il n'y a donc aucun
 * état « partage indisponible » à rendre ici : rien à montrer, rien de montré.
 */

/** Une personne membre de l'espace ou du coffre qui porte l'élément. */
export interface SharingMember {
  /** Ce que l'utilisateur lit : nom affiché ou e-mail. */
  label: string;
  /** Rôle tel que l'hôte le connaît (owner, admin, member, viewer…). */
  role: string;
  /**
   * Identifiant stable : graine de la teinte d'avatar. Un nom affiché peut
   * changer ; une couleur qui saute au renommage désoriente.
   */
  userId: string;
}

/** Une personne à qui l'accès a été accordé nommément (partage E2EE). */
export interface SharingGrantee {
  label: string;
  /** L'accès a été scellé avec une clé dépassée (rotation) : à repartager. */
  stale?: boolean;
}

/** Une ligne du journal d'activité, déjà mise en mots PAR L'HÔTE. */
export interface SharingActivityEntry {
  /** « Alice a modifié le fichier » — le panneau n'interprète rien, il affiche. */
  text: string;
  /** Horodatage, epoch en millisecondes. */
  at: number;
}

/**
 * Tout ce que le panneau sait du partage d'un élément. Chaque champ est
 * optionnel : l'hôte ne fournit que ce qu'il sait, et la section se compose
 * de ce qui est là. `undefined` sur l'objet entier = pas de section.
 */
export interface FileDetailsSharing {
  /** Nombre total de membres, si l'hôte le connaît sans avoir la liste. */
  memberCount?: number;
  members?: SharingMember[];
  grantees?: SharingGrantee[];
  /** Liste FOURNIE mais vide = « aucune activité » ; absente = on n'en parle pas. */
  recentActivity?: SharingActivityEntry[];
  /**
   * `false` = le journal d'activité est coupé pour cet élément, et on le DIT.
   * `undefined` = on ne sait pas, on ne dit rien.
   */
  activityRecorded?: boolean;
  onOpenShareDialog?: () => void;
  onViewActivity?: () => void;
}

/**
 * Au plus trois membres, trois personnes, trois lignes d'activité : le panneau
 * est un résumé, pas la liste. Au-delà, « et N de plus » renvoie vers la boîte
 * de dialogue de partage ou le journal complet.
 */
export const SHARING_LIST_LIMIT = 3;

/** Ce que la section rend, ligne par ligne. Rien n'est calculé dans le JSX. */
export interface SharingSectionPlan {
  /** Nombre affiché à côté des avatars ; null = pas de ligne « membres ». */
  memberCount: number | null;
  /** Les membres listés avec leur rôle (au plus SHARING_LIST_LIMIT). */
  visibleMembers: SharingMember[];
  /** Membres au-delà de la limite, pour « et N de plus ». */
  hiddenMemberCount: number;
  /** Tous les membres, pour l'empilement d'avatars (qui tronque lui-même). */
  avatarItems: { label: string; seed: string }[];
  /** Personnes listées (au plus SHARING_LIST_LIMIT) ; vide = pas de ligne. */
  visibleGrantees: SharingGrantee[];
  hiddenGranteeCount: number;
  /** Les plus récentes d'abord, au plus SHARING_LIST_LIMIT. */
  activity: SharingActivityEntry[];
  /** La liste d'activité est fournie et vide, et le journal n'est pas coupé. */
  showNoActivity: boolean;
  /** Le journal est coupé : l'avis s'affiche TOUJOURS, même à côté de lignes. */
  showActivityDisabledNotice: boolean;
  /** Personne, mais un bouton pour y remédier : on le dit plutôt que de laisser un blanc. */
  showNotShared: boolean;
  showManageButton: boolean;
  showViewAllLink: boolean;
}

/**
 * Compose la section « Partage ». Rend `null` quand il n'y aurait rien à
 * montrer — la section ne doit JAMAIS exister vide : un titre « Partage » qui
 * se déplie sur du blanc laisse croire que quelque chose a échoué à charger.
 *
 * L'avis « journal désactivé » compte comme un contenu : un élément dont on
 * n'enregistre rien mérite qu'on le dise, c'est même la seule chose à en dire.
 */
export function planSharingSection(
  sharing: FileDetailsSharing | undefined
): SharingSectionPlan | null {
  if (!sharing) return null;

  const members = sharing.members ?? [];
  const grantees = sharing.grantees ?? [];
  // `memberCount` prime sur la longueur de la liste : l'hôte peut connaître le
  // total sans avoir chargé tout le monde (liste paginée, membres masqués).
  const memberTotal = sharing.memberCount ?? members.length;
  const hasMembers = memberTotal > 0 || members.length > 0;
  const hasGrantees = grantees.length > 0;

  const showActivityDisabledNotice = sharing.activityRecorded === false;
  const activityProvided = sharing.recentActivity !== undefined;
  const activity = activityProvided ? mostRecent(sharing.recentActivity ?? []) : [];
  // Quand le journal est coupé, « aucune activité » serait un mensonge par
  // omission : la liste est vide PARCE QUE rien n'est enregistré, et c'est
  // l'avis qui l'explique. On ne dit pas les deux.
  const showNoActivity = activityProvided && activity.length === 0 && !showActivityDisabledNotice;

  const showManageButton = typeof sharing.onOpenShareDialog === 'function';
  const showViewAllLink = typeof sharing.onViewActivity === 'function';
  const showNotShared = !hasMembers && !hasGrantees && showManageButton;

  const hasContent =
    hasMembers ||
    hasGrantees ||
    activityProvided ||
    showActivityDisabledNotice ||
    showManageButton ||
    showViewAllLink;
  if (!hasContent) return null;

  return {
    memberCount: hasMembers ? Math.max(memberTotal, members.length) : null,
    visibleMembers: members.slice(0, SHARING_LIST_LIMIT),
    hiddenMemberCount: Math.max(0, Math.max(memberTotal, members.length) - SHARING_LIST_LIMIT),
    avatarItems: members.map((m) => ({ label: m.label, seed: m.userId })),
    visibleGrantees: grantees.slice(0, SHARING_LIST_LIMIT),
    hiddenGranteeCount: Math.max(0, grantees.length - SHARING_LIST_LIMIT),
    activity,
    showNoActivity,
    showActivityDisabledNotice,
    showNotShared,
    showManageButton,
    showViewAllLink,
  };
}

/**
 * Les SHARING_LIST_LIMIT entrées les plus récentes, les plus récentes d'abord.
 * L'hôte n'a aucune obligation d'ordre : un journal fusionné de plusieurs
 * sources arrive dans l'ordre d'arrivée, pas dans l'ordre des faits. Tri
 * stable : deux entrées au même instant gardent leur ordre d'origine, et un
 * horodatage illisible (NaN) ne fait pas sauter les autres.
 */
function mostRecent(entries: SharingActivityEntry[]): SharingActivityEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const delta = b.entry.at - a.entry.at;
      return Number.isNaN(delta) || delta === 0 ? a.index - b.index : delta;
    })
    .slice(0, SHARING_LIST_LIMIT)
    .map(({ entry }) => entry);
}

/**
 * L'horodatage d'une ligne d'activité au format que `useRelativeTime` attend
 * (ISO). `new Date(NaN).toISOString()` LANCE une RangeError : une entrée à
 * l'horodatage illisible ne doit pas faire tomber tout le panneau, elle
 * s'affiche simplement sans heure.
 */
export function activityTimestampIso(at: number): string | undefined {
  return Number.isFinite(at) ? new Date(at).toISOString() : undefined;
}

/** Les rôles qu'on sait traduire. Tout autre rôle s'affiche tel quel. */
const KNOWN_ROLES: ReadonlySet<string> = new Set(['owner', 'admin', 'member', 'editor', 'viewer']);

/**
 * Clé i18n du libellé d'un rôle, ou `null` si le rôle est inconnu — auquel cas
 * le panneau affiche la chaîne brute de l'hôte plutôt qu'une clé non traduite.
 * Insensible à la casse et aux espaces : « Owner » et « owner » sont le même rôle.
 */
export function roleLabelKey(role: string): string | null {
  const normalized = role.trim().toLowerCase();
  return KNOWN_ROLES.has(normalized) ? `details.sharing.role.${normalized}` : null;
}

/** Jour, mois en toutes lettres, année, heure — le format du panneau depuis toujours. */
const DETAILS_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

/**
 * Date d'un élément dans la langue de l'app. Avant : `toLocaleDateString('fr-FR')`
 * en dur, qui servait « 05 mars 2026 » à un utilisateur en anglais.
 *
 * Ne lance JAMAIS : une étiquette de langue exotique retombe sur la locale du
 * moteur, et une date illisible rend « - » plutôt qu'« Invalid Date » — une
 * ligne sans date se lit encore, une ligne qui affiche une erreur fait douter
 * de tout le panneau.
 */
export function formatDetailsDate(
  date: string | undefined | null,
  language: string | undefined
): string {
  if (!date) return '-';
  const time = new Date(date).getTime();
  if (Number.isNaN(time)) return '-';
  try {
    return new Intl.DateTimeFormat(language || undefined, DETAILS_DATE_OPTIONS).format(time);
  } catch {
    return new Intl.DateTimeFormat(undefined, DETAILS_DATE_OPTIONS).format(time);
  }
}
