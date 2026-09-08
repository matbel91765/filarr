/**
 * LES PROFILS D'UN COMPTE — la question à laquelle « ajouter un compte cloud »
 * doit répondre avant de décider quoi que ce soit.
 *
 * Après une connexion, la restauration ramène du nuage les profils du compte.
 * Reste à savoir, dans le manifeste LOCAL, lesquels lui appartiennent — parce
 * que la machine en porte d'autres : un second compte, du travail purement
 * local. « Prendre le premier » ouvrait le profil de quelqu'un d'autre.
 *
 * DEUX SOURCES, et aucune ne suffit seule :
 *
 *   · les identifiants que la restauration vient de rendre — mais elle sort
 *     immédiatement sur un identifiant DÉJÀ connu (`restoreProfileFromCloud`
 *     n'écrase pas une entrée existante), si bien qu'un profil présent en local
 *     n'y figure pas ;
 *   · l'estampille `cloudAccount` du manifeste — que la restauration pose à
 *     CHAQUE passage, y compris sur ces profils-là. Elle rattrape donc
 *     exactement ce que la première liste laisse tomber : le profil sur lequel
 *     on travaillait hors ligne, et qu'on vient de rattacher au compte.
 *
 * Leur union est le seul ensemble sûr. L'intersection en perdrait la moitié, et
 * l'une ou l'autre prise seule laisse un trou par lequel passe le symptôme.
 */

export interface AccountProfileLike {
  id: string;
  isDefault?: boolean;
  cloudAccount?: { email?: string } | null;
}

/** Comparaison d'adresses : une adresse n'est pas sensible à la casse. */
function sameAccount(a: string | undefined | null, b: string): boolean {
  return !!a && a.trim().toLowerCase() === b;
}

/**
 * Les profils locaux relevant de `email`, dans l'ordre du manifeste.
 *
 * Une adresse vide ne désigne aucun compte : on rend une liste vide plutôt que
 * de faire correspondre tous les profils sans estampille — l'appelant retombe
 * alors sur la création, ce qui est le comportement voulu quand on ne sait pas
 * à qui on parle.
 */
export function profilesOfAccount<T extends AccountProfileLike>(
  profiles: readonly T[],
  email: string,
  restoredIds: readonly string[] = []
): T[] {
  const needle = email.trim().toLowerCase();
  if (!needle) return [];
  const restored = new Set(restoredIds);
  return profiles.filter((p) => restored.has(p.id) || sameAccount(p.cloudAccount?.email, needle));
}

/**
 * Ce qu'il faut faire des profils trouvés.
 *
 * `pick` n'est PAS `isDefault` : ce drapeau désigne le profil par défaut de
 * l'APPAREIL, pas celui du compte. Sur une machine qui portait déjà un profil
 * local marqué par défaut, s'y fier ferait entrer dans le mauvais. À un seul
 * profil, il n'y a rien à arbitrer ; à plusieurs, c'est à la personne de dire.
 */
export type AccountLanding =
  | { kind: 'create' }
  | { kind: 'enter'; profileId: string }
  | { kind: 'choose'; profileIds: string[] };

export function landingForAccount<T extends AccountProfileLike>(
  mine: readonly T[]
): AccountLanding {
  if (mine.length === 0) return { kind: 'create' };
  if (mine.length === 1) return { kind: 'enter', profileId: mine[0].id };
  return { kind: 'choose', profileIds: mine.map((p) => p.id) };
}
