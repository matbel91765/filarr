/**
 * folderGridOrder — l'ORDRE de la grille « Tous les dossiers » quand elle mêle
 * dossiers et coffres partagés (lot A, C4). Fonction PURE, sans React : c'est
 * ce qui la rend testable en nœud nu, et ce qui garantit que la grille et la
 * liste rangent exactement pareil.
 *
 * LA RÈGLE, EN TROIS TEMPS :
 *   1. les dossiers d'abord, dans l'ordre reçu (celui de `selectRootFolders`,
 *      qui est déjà l'ordre de l'utilisateur) ;
 *   2. puis les coffres DÉVERROUILLÉS, par nom ;
 *   3. puis les coffres VERROUILLÉS, en dernier — leur nom n'est pas lisible
 *      (chaîne vide), les trier « par nom » les mettrait en tête par accident,
 *      devant tout ce qu'on peut ouvrir. Entre eux, par identifiant : un ordre
 *      stable vaut mieux qu'un ordre qui change à chaque relecture.
 * Pas d'en-tête de groupe : la frontière se lit à la vignette.
 */

import type { Folder } from '../../../../types';
import type { VaultSummary } from '../../../../store/slices/vaultsSlice';

export type HomeCard =
  | { kind: 'folder'; folder: Folder }
  | { kind: 'vault'; vault: VaultSummary; unlocked: boolean };

/** Comparaison de noms insensible à la casse et aux accents, chiffres en ordre naturel. */
function byName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

/** Les coffres seuls, déjà rangés : déverrouillés par nom, verrouillés en queue. */
export function orderVaultCards(
  vaults: readonly VaultSummary[],
  unlockedIds: ReadonlySet<string> | readonly string[]
): Array<{ vault: VaultSummary; unlocked: boolean }> {
  const unlocked = unlockedIds instanceof Set ? unlockedIds : new Set(unlockedIds);
  const open: VaultSummary[] = [];
  const locked: VaultSummary[] = [];
  for (const v of vaults) (unlocked.has(v.id) ? open : locked).push(v);
  open.sort((a, b) => byName(a.name, b.name) || byName(a.id, b.id));
  locked.sort((a, b) => byName(a.id, b.id));
  return [
    ...open.map((vault) => ({ vault, unlocked: true })),
    ...locked.map((vault) => ({ vault, unlocked: false })),
  ];
}

/** La grille entière : dossiers, puis coffres rangés. */
export function mixHomeCards(
  folders: readonly Folder[],
  vaults: readonly VaultSummary[],
  unlockedIds: ReadonlySet<string> | readonly string[]
): HomeCard[] {
  return [
    ...folders.map((folder): HomeCard => ({ kind: 'folder', folder })),
    ...orderVaultCards(vaults, unlockedIds).map(
      ({ vault, unlocked }): HomeCard => ({ kind: 'vault', vault, unlocked })
    ),
  ];
}
