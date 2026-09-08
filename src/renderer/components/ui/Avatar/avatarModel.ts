/**
 * Avatar — logique PURE (initiales + teinte stable).
 *
 * Séparée du composant TSX pour deux raisons : elle se teste sous vitest en
 * environnement node (pas de DOM, pas de JSX), et elle doit donner la MÊME
 * réponse partout — un avatar « JD » vert ici doit être « JD » vert sur
 * l'autre appareil, dans la liste des membres comme sur la carte du fichier.
 * Rien ici ne touche au thème : le modèle rend un INDEX de teinte, la feuille
 * de style (Avatar.css) le traduit en paire fond/texte à partir des jetons du
 * thème, ce qui laisse clair et sombre se débrouiller sans calcul de couleur.
 */

/**
 * Nombre de paires fond/texte déclarées dans Avatar.css (`.avatar--hue-N`).
 * Le modèle et la feuille de style doivent rester d'accord : changer l'un sans
 * l'autre donnerait des avatars sans couleur pour les index orphelins.
 */
export const AVATAR_HUE_COUNT = 8;

/** Ce qui sépare les « mots » d'un nom ou d'un local-part : jean.dupont, jean_dupont, jean-dupont, jean+tag, Jean Dupont. */
const SEGMENT_SEPARATOR = /[.\s_\-+]+/;

/**
 * Initiales affichées dans la pastille.
 *
 * Un e-mail est réduit à son local-part (« jean.dupont@exemple.fr » → « jean.dupont ») :
 * le domaine ne dit rien de la personne. Ensuite, deux segments ou plus donnent
 * la première lettre de chacun des deux premiers (« jean.dupont » → « JD »,
 * « Jean Dupont » → « JD ») ; un seul segment donne ses deux premières lettres
 * (« alice » → « AL »). Vide → « ? », pour que la pastille ne soit jamais muette.
 *
 * Découpage par POINTS DE CODE (Array.from) et non par unités UTF-16 : une
 * lettre accentuée ou un emoji en tête de nom ne doit pas se retrouver coupé
 * en deux moitiés de paire de substitution.
 */
export function avatarInitials(label: string): string {
  const trimmed = (label ?? '').trim();
  if (!trimmed) return '?';

  const at = trimmed.indexOf('@');
  // « @exemple.fr » (local-part vide) retombe sur la chaîne entière : mieux vaut
  // des initiales du domaine qu'un « ? » pour un libellé qui n'est pas vide.
  const localPart = at > 0 ? trimmed.slice(0, at) : trimmed;

  const segments = localPart.split(SEGMENT_SEPARATOR).filter((s) => s.length > 0);
  if (segments.length === 0) return '?';

  const firstOf = (s: string): string => Array.from(s)[0];
  const initials =
    segments.length >= 2
      ? firstOf(segments[0]) + firstOf(segments[1])
      : Array.from(segments[0]).slice(0, 2).join('');

  return initials.toLocaleUpperCase();
}

/**
 * FNV-1a 32 bits — le même hachage que celui des teintes de collaboration
 * (collabPresence.ts), pour qu'une graine identique tombe sur le même index
 * quelle que soit la surface qui l'affiche. Volontairement dupliqué plutôt
 * qu'importé : l'avatar du design system ne doit pas dépendre du module de
 * coédition des notes.
 */
export function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Index de teinte [0, AVATAR_HUE_COUNT) pour une graine. Stable d'un rendu à
 * l'autre et d'un appareil à l'autre : la couleur d'une personne fait partie
 * de la façon dont on la reconnaît d'un coup d'œil, elle ne doit pas changer
 * au rechargement.
 */
export function avatarHueIndex(seed: string): number {
  return fnv1a32(seed ?? '') % AVATAR_HUE_COUNT;
}
