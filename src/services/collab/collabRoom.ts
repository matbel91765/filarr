/**
 * Identité d'une salle — les deux régimes derrière un seul vocabulaire.
 *
 * Phase 1 « mes appareils » : la salle est une NOTE PERSONNELLE, identifiée par
 * son `noteId`, et le compte demandeur entre dans son nom côté relais.
 *
 * Phase 2 « à plusieurs » : la salle est un ÉLÉMENT DE COFFRE, identifié par le
 * couple `(vaultId, itemId)` — SANS compte dedans, sinon deux membres du même
 * coffre ouvrant le même élément atterriraient chacun seul chez soi. Ce qui
 * remplace le compte comme garde, c'est l'appartenance au coffre, vérifiée par
 * le relais au moment d'émettre le jeton ET revérifiée par la salle.
 *
 * Le reste du client (session, fournisseur, gestionnaire de documents) ne
 * connaît qu'UNE chaîne d'identité de salle. Un élément de coffre s'y présente
 * donc sous la forme `vault:<vaultId>:<itemId>`, qu'aucun identifiant de note
 * personnelle (un UUID) ne peut prendre. Les deux régimes cohabitent sans que
 * rien en aval ait à savoir lequel est en jeu.
 */

/** Préfixe qui distingue une salle de coffre d'une note personnelle. */
export const VAULT_ROOM_PREFIX = 'vault:';

export interface VaultRoomRef {
  vaultId: string;
  itemId: string;
}

/**
 * Les deux identifiants sont concaténés dans le nom de la salle : ils ne
 * peuvent donc contenir ni `:` (qui casserait l'analyse inverse) ni `/`, ni
 * espace, ni caractère de contrôle. C'est exactement la forme des identifiants
 * que le serveur émet (UUID), et la validation refuse le reste plutôt que de
 * fabriquer une salle au nom ambigu.
 */
const ROOM_PART_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

export function isValidRoomPart(value: unknown): value is string {
  return typeof value === 'string' && ROOM_PART_REGEX.test(value);
}

/**
 * Identité de salle d'un élément de coffre. LÈVE plutôt que de rendre une
 * chaîne bancale : l'appelant (l'ouverture de session) retombe alors sur le
 * mode hors-collaboration, ce qui n'empêche aucune édition.
 */
export function vaultRoomId(vaultId: string, itemId: string): string {
  if (!isValidRoomPart(vaultId)) throw new Error('collab: vaultId invalide');
  if (!isValidRoomPart(itemId)) throw new Error('collab: itemId invalide');
  return `${VAULT_ROOM_PREFIX}${vaultId}:${itemId}`;
}

export function isVaultRoomId(roomId: string): boolean {
  return parseVaultRoomId(roomId) !== null;
}

/** `null` — jamais d'exception — quand ce n'est pas une salle de coffre. */
export function parseVaultRoomId(roomId: string | null | undefined): VaultRoomRef | null {
  if (typeof roomId !== 'string' || !roomId.startsWith(VAULT_ROOM_PREFIX)) return null;
  const rest = roomId.slice(VAULT_ROOM_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep <= 0) return null;
  const vaultId = rest.slice(0, sep);
  const itemId = rest.slice(sep + 1);
  if (!isValidRoomPart(vaultId) || !isValidRoomPart(itemId)) return null;
  return { vaultId, itemId };
}

/**
 * Sel de dérivation de la clé de salle d'un élément.
 *
 * Volontairement DIFFÉRENT du nom de salle : le sel ne sert qu'à isoler les
 * salles entre elles dans la dérivation, et n'a aucune raison de recopier le
 * préfixe de transport. Le garder ici évite qu'un des deux dérive de son côté.
 */
export function vaultRoomSalt(vaultId: string, itemId: string): string {
  return `${vaultId}:${itemId}`;
}
