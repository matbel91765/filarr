/**
 * itemNameResolver — rouvrir la méta chiffrée d'un DTO serveur, en tolérant
 * l'échec PAR ÉLÉMENT.
 *
 * Extrait du bloc de déchiffrement de la corbeille (VaultItemBrowser.loadTrash)
 * pour servir aussi le fil d'activité : un élément encore à la corbeille reste
 * nommable, un élément PURGÉ n'a plus de méta nulle part — l'appelant assume
 * son fallback (« un élément supprimé » + id tronqué). Une époque dont on n'a
 * plus la clé rend null, jamais une exception : la ligne s'affiche anonyme
 * plutôt que de disparaître.
 */

import type { ServerVaultItemDTO } from './vaultApi';
import { unwrapItemKey, decryptItemMeta } from './vaultCrypto';
import { getVaultKey } from './vaultKeyCache';
import type { VaultItemMeta } from '../../store/slices/vaultsSlice';

/** La méta déchiffrée d'un DTO, ou null (clé d'époque perdue, blob corrompu). */
export async function decryptItemMetaSafe(
  dto: ServerVaultItemDTO,
  vaultId: string
): Promise<VaultItemMeta | null> {
  try {
    const kVault = getVaultKey(vaultId, dto.wrappedUnderEpoch);
    if (!kVault) return null;
    const kItem = await unwrapItemKey(dto.wrappedItemKey, kVault);
    try {
      return (await decryptItemMeta(
        dto.encryptedMeta,
        dto.encryptedMetaIv,
        kItem
      )) as VaultItemMeta;
    } finally {
      kItem.fill(0);
    }
  } catch {
    return null;
  }
}

/** Le NOM d'un élément serveur, ou null — fileName prime, comme partout. */
export async function decryptItemName(
  dto: ServerVaultItemDTO,
  vaultId: string
): Promise<string | null> {
  const meta = await decryptItemMetaSafe(dto, vaultId);
  return meta?.fileName || meta?.title || null;
}
