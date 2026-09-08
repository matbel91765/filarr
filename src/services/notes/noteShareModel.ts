/**
 * Modèle PUR du partage de notes vers les coffres — aucune dépendance Redux,
 * React ou plateforme, pour la même raison que `ghostNotes` ou `conflictResolution` :
 * ce qui décide « où est ma copie, et dans quel état ? » doit se tester en isolement
 * et se réutiliser tel quel depuis le slice, les sélecteurs et, plus tard, le web.
 *
 * Deux responsabilités :
 *  - la tenue de la liste `sharedTo` d'une note (upsert dédoublonné, retrait) ;
 *  - la LECTURE de cette liste contre ce que le slice des coffres sait à cet
 *    instant, traduite en un état de badge — et surtout, la discipline de
 *    DÉGRADATION quand le slice ne sait pas tout.
 *
 * Le principe qui gouverne les règles ci-dessous : TERMINAL ≠ JETABLE. Un verdict
 * définitif (« ta copie a disparu », « ce coffre n'existe plus ») ne se dérive
 * jamais d'une ABSENCE d'information — un chargement pas encore fait, un coffre pas
 * encore déverrouillé, un élément qu'on n'a pas su déchiffrer. Dans le doute, on
 * dit « verrouillé » ou « inconnu », jamais « perdu » : un badge qui crie
 * « copie manquante » au démarrage, avant que `loadVaults` n'ait répondu,
 * pousserait l'utilisateur à re-déposer la note et à fabriquer un doublon.
 */

import type { Note, NoteShareRef } from '../../types/notes';

/**
 * État d'un dépôt, tel que le badge le rend :
 *  - `live`        : le coffre est là, déverrouillé, et la copie y est visible ;
 *  - `locked`      : on ne peut pas voir la copie (coffre verrouillé, ou élément
 *                    indéchiffrable) — elle est PROBABLEMENT là ;
 *  - `copyMissing` : le coffre est ouvert, ses éléments sont chargés, et la copie
 *                    n'y est pas — à la CORBEILLE du coffre (30 j, d'où elle
 *                    peut REVENIR) ou purgée. Ce verdict se RECALCULE à chaque
 *                    lecture et ne se persiste jamais : le marqueur de la note
 *                    reste, et une restauration le fait repasser à `live` ;
 *  - `vaultGone`   : la liste des coffres est chargée et celui-là n'y est plus
 *                    (supprimé, ou accès retiré) ;
 *  - `unknown`     : pas assez d'information pour trancher (liste des coffres ou
 *                    éléments pas encore chargés).
 */
export type NoteShareBadgeState = 'live' | 'locked' | 'copyMissing' | 'vaultGone' | 'unknown';

/**
 * Projection MINIMALE de l'état des coffres, construite par le sélecteur : ce
 * module ne connaît ni `VaultsState` ni `VaultItemSummary`, seulement ce dont
 * la décision a besoin. C'est aussi ce qui rend la matrice testable sans
 * fabriquer un slice de coffres complet.
 */
export interface VaultsLite {
  /**
   * `true` seulement quand la liste des coffres a été RÉELLEMENT chargée — une
   * lecture demandée, terminée et RÉUSSIE (le sélecteur le dérive du drapeau de
   * session `initialLoadRequested`, jamais du contenu de la liste : une liste
   * vide peut très bien être chargée). Tant que c'est `false`, l'absence d'un
   * coffre ne prouve rien.
   */
  vaultsLoaded: boolean;
  vaults: Record<string, { name: string; unlocked: boolean }>;
  /**
   * Les identifiants des éléments VIVANTS par coffre, pour les coffres dont les
   * éléments ONT été chargés. Un coffre absent de cette table = pas encore
   * chargé (et non « vide ») — la distinction est toute la différence entre
   * `unknown` et `copyMissing`. Un élément à la corbeille du coffre n'y figure
   * pas (le slice le retire au soft-delete, le serveur ne le liste plus) ; il y
   * revient à la restauration.
   */
  itemIdsByVault?: Record<string, Set<string>>;
  /**
   * Nombre d'éléments que `loadVaultItems` n'a PAS su déchiffrer, par coffre.
   * Ces éléments sont sautés silencieusement de la liste (clé d'époque non
   * détenue, par exemple) : « absent de la liste » ne veut alors pas dire
   * « supprimé ».
   */
  undecryptableByVault?: Record<string, number>;
}

const sameRef = (a: NoteShareRef, b: { vaultId: string; itemId: string }): boolean =>
  a.vaultId === b.vaultId && a.itemId === b.itemId;

/**
 * Ajoute ou remplace un dépôt, dédoublonné par (vaultId, itemId).
 *
 * Le doublon est un cas réel, pas théorique : un re-dépôt après une panne
 * réseau côté téléversement (l'élément existait déjà, le serveur a répondu
 * « déjà là »), ou deux clics rapides. Deux entrées pour le même élément
 * feraient compter deux copies là où il n'y en a qu'une. Le remplacement
 * conserve l'ordre d'origine (le dépôt le plus ancien reste en tête) mais
 * adopte les champs frais (`mode`, `at`) : c'est le geste le plus récent qui
 * décrit l'intention actuelle.
 *
 * Renvoie toujours un NOUVEAU tableau : l'entrée peut être un tableau gelé
 * sorti d'un état Redux, et le module ne doit jamais muter ce qu'on lui prête.
 */
export function upsertShareRef(
  refs: readonly NoteShareRef[] | undefined,
  ref: NoteShareRef
): NoteShareRef[] {
  const list = refs ?? [];
  const idx = list.findIndex((r) => sameRef(r, ref));
  if (idx === -1) return [...list, { ...ref }];
  const next = [...list];
  next[idx] = { ...ref };
  return next;
}

/**
 * Retire un dépôt par (vaultId, itemId). Renvoie un nouveau tableau, vide si
 * c'était le dernier — c'est à l'appelant de décider s'il efface alors le champ
 * (le slice le fait, pour que « jamais déposée » et « plus déposée nulle part »
 * se persistent de la même façon : par l'absence du champ).
 */
export function removeShareRef(
  refs: readonly NoteShareRef[] | undefined,
  target: { vaultId: string; itemId: string }
): NoteShareRef[] {
  return (refs ?? []).filter((r) => !sameRef(r, target));
}

/**
 * État d'UN dépôt. Les règles, dans l'ordre où elles s'appliquent :
 *
 *  1. Coffre inconnu du slice → `vaultGone` si la liste est chargée, sinon
 *     `unknown`. Au démarrage, `vaults` est vide pendant quelques centaines de
 *     millisecondes : rendre « coffre disparu » pendant ce laps serait un faux
 *     verdict affiché à chaque lancement.
 *  2. Coffre connu mais pas déverrouillé → `locked`. On ne peut rien dire de la
 *     copie sans la clé ; on ne le prétend pas.
 *  3. Coffre déverrouillé mais éléments pas encore chargés (`itemIdsByVault`
 *     sans entrée pour lui) → `unknown`. `loadVaultItems` est déclenché à
 *     l'ouverture de l'écran des coffres, pas au déverrouillage : entre les
 *     deux, une liste absente n'est pas une liste vide.
 *  4. Éléments chargés et `itemId` présent → `live`.
 *  5. Éléments chargés, `itemId` absent, mais des éléments INDÉCHIFFRABLES ont
 *     été sautés dans ce coffre → `locked`. `loadVaultItems` (vaultsSlice)
 *     écarte silencieusement ce qu'il ne sait pas déchiffrer et se contente de
 *     les compter ; notre copie peut être parmi eux (scellée sous une époque de
 *     clé qu'on ne détient pas encore). Dire « manquante » ici enverrait
 *     l'utilisateur re-déposer une note qui existe.
 *  6. Éléments chargés, `itemId` absent, rien d'indéchiffrable → `copyMissing`.
 *     C'est le SEUL chemin vers ce verdict : tout est chargé, tout est lisible,
 *     et la copie n'y est pas. « Définitif » pour la lecture, pas pour la note :
 *     la copie est peut-être à la corbeille du coffre, d'où un membre peut la
 *     restaurer — l'appelant ne doit JAMAIS retirer le marqueur sur ce verdict,
 *     seulement l'afficher ; la lecture suivante dira `live` si elle est revenue.
 */
export function shareRefState(ref: NoteShareRef, lite: VaultsLite): NoteShareBadgeState {
  const vault = lite.vaults[ref.vaultId];
  if (!vault) return lite.vaultsLoaded ? 'vaultGone' : 'unknown';
  if (!vault.unlocked) return 'locked';
  const items = lite.itemIdsByVault?.[ref.vaultId];
  if (!items) return 'unknown';
  if (items.has(ref.itemId)) return 'live';
  if ((lite.undecryptableByVault?.[ref.vaultId] ?? 0) > 0) return 'locked';
  return 'copyMissing';
}

/**
 * Ordre de préséance pour RÉSUMER plusieurs dépôts en un seul badge. Le fait
 * positif domine (une copie visible quelque part, c'est ce que le badge
 * promet) ; puis les états d'incertitude AVANT les verdicts définitifs — un
 * badge qui dit « copie manquante » alors qu'un autre coffre n'est pas encore
 * déverrouillé affirme plus qu'on ne sait ; `vaultGone` en dernier parce qu'il
 * est le plus définitif de tous.
 */
const BADGE_PRECEDENCE: readonly NoteShareBadgeState[] = [
  'live',
  'locked',
  'unknown',
  'copyMissing',
  'vaultGone',
];

/**
 * État du badge d'une NOTE, résumé de tous ses dépôts selon `BADGE_PRECEDENCE`.
 * `null` quand la note n'a été déposée nulle part — pas de badge à rendre, et
 * l'appelant n'a pas à distinguer « champ absent » de « tableau vide ».
 */
export function shareBadgeState(
  note: Pick<Note, 'sharedTo'>,
  lite: VaultsLite
): NoteShareBadgeState | null {
  const refs = note.sharedTo;
  if (!refs || refs.length === 0) return null;
  let best = Number.POSITIVE_INFINITY;
  for (const ref of refs) {
    const rank = BADGE_PRECEDENCE.indexOf(shareRefState(ref, lite));
    if (rank < best) best = rank;
  }
  return BADGE_PRECEDENCE[best];
}
