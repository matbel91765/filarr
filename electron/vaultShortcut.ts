/**
 * RACCOURCI VERS UN COFFRE — la partie PURE du geste « déplacer vers le coffre
 * en laissant un raccourci », éprouvable hors Electron.
 *
 * Le contrat tient en une phrase : une seule version du fichier existe, celle
 * du coffre. Ici on ne fabrique que la FICHE qui reste dans le dossier
 * personnel : même identifiant (le fichier garde sa place, ses rappels, ses
 * liens), même nom/type/taille/dates/description, mais SANS aucun octet
 * (`encryptedData`, `iv`, `content`) — et avec `vaultRef` qui dit où sont les
 * octets et depuis quand. Rien d'autre n'entre dans la persistance en clair :
 * deux identifiants et une date, jamais un nom de coffre.
 *
 * L'effacement des octets sur le disque et l'avis à la synchro sont dans
 * `storageService.convertFileToVaultShortcut` : ils touchent au système de
 * fichiers, pas à cette fonction.
 */

export interface VaultShortcutRef {
  vaultId: string;
  itemId: string;
  movedAt: string;
}

/** Les champs qui transportent des OCTETS et n'ont rien à faire sur un raccourci. */
const CHAMPS_OCTETS = ['encryptedData', 'iv', 'content'] as const;

/**
 * Refuse une référence incomplète AVANT d'avoir touché au disque : une fiche
 * qui pointerait vers « nulle part » serait un fichier perdu, pas un raccourci.
 */
export function assertVaultShortcutRef(ref: unknown): asserts ref is VaultShortcutRef {
  const r = ref as Partial<VaultShortcutRef> | null | undefined;
  if (!r || typeof r !== 'object') throw new Error('vaultRef manquant');
  for (const champ of ['vaultId', 'itemId', 'movedAt'] as const) {
    if (typeof r[champ] !== 'string' || r[champ]!.trim() === '') {
      throw new Error(`vaultRef.${champ} manquant`);
    }
  }
  if (Number.isNaN(Date.parse(r.movedAt as string))) {
    throw new Error('vaultRef.movedAt n\'est pas une date');
  }
}

/**
 * La fiche-raccourci dérivée d'une fiche de fichier. Copie : la fiche reçue
 * n'est jamais mutée (l'appelant peut encore lire `file.name` pour effacer le
 * blob après coup). `updatedAt` est bumpé pour que la synchro de métadonnées
 * voie le changement et que les autres appareils reçoivent la fiche à jour.
 */
export function buildShortcutEntry<T extends { id: string; name: string; type: string }>(
  file: T,
  ref: VaultShortcutRef,
  now: string = new Date().toISOString()
): T & { vaultRef: VaultShortcutRef; updatedAt: string } {
  if (file.type === 'folder') {
    throw new Error('Un dossier ne devient pas un raccourci de coffre (v1 : fichiers seulement)');
  }
  assertVaultShortcutRef(ref);
  const entry = { ...file } as Record<string, unknown>;
  // `delete` et non `= undefined` : la fiche part en JSON, et un `undefined`
  // survivrait à un spread côté renderer en masquant l'absence réelle.
  for (const champ of CHAMPS_OCTETS) delete entry[champ];
  entry.vaultRef = { vaultId: ref.vaultId, itemId: ref.itemId, movedAt: ref.movedAt };
  entry.updatedAt = now;
  return entry as T & { vaultRef: VaultShortcutRef; updatedAt: string };
}

/** Un raccourci se reconnaît à sa référence — jamais à l'absence d'octets seule. */
export function isVaultShortcut(item: { vaultRef?: unknown } | null | undefined): boolean {
  const ref = item?.vaultRef as Partial<VaultShortcutRef> | undefined;
  return !!ref && typeof ref.vaultId === 'string' && typeof ref.itemId === 'string';
}
