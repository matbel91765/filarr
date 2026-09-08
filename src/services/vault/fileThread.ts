/**
 * fileThread — le FIL DE DISCUSSION d'un fichier de coffre (Temps 2).
 *
 * Un fichier (pdf, docx…) n'a pas de corps ProseMirror où ancrer : son fil vit
 * dans un élément SIDECAR chiffré — itemType 'note', lié par meta.threadFor =
 * <itemId du fichier> dans la méta CHIFFRÉE (le serveur ne peut pas corréler
 * un fil à son fichier, et c'est voulu). Le sidecar est caché de toutes les
 * listes, exactement comme meta.folderMarker.
 *
 * POURQUOI PAS un champ méta (borne MAX_META_B64 = 8192 ≈ 6 Ko de clair — un
 * fil la crève, et chaque renommage réécrit la méta entière) ni une révision
 * dédiée (le commit d'une révision REMPLACE le contenu courant — l'historique
 * E3-12 traiterait le fil comme une version du fichier). L'élément séparé
 * réutilise TOUT le pipeline : K_item neuf par écriture, CAS de version,
 * rescellement des grants, corbeille, rotation d'époque. Zéro changement
 * serveur.
 *
 * CONFLIT (409) : UNE reprise, par FUSION-PAR-UNION (mergeComments — les
 * tombstones garantissent qu'un supprimé ne ressuscite pas). Si le serveur ne
 * détient plus rien (serverVersion null — le fichier et sa cascade viennent
 * d'être supprimés puis restaurés, ou le sidecar seul est parti), on RECRÉE
 * le sidecar au lieu de retenter l'update. Un second 409 remonte : jamais de
 * boucle.
 */

import {
  addVaultItem,
  updateVaultItem,
  isVaultItemConflict,
  type VaultItemSummary,
} from '../../store/slices/vaultsSlice';
import type { AppDispatch } from '../../store';
import { mergeComments, sanitizeCommentMap, type VaultComment } from './vaultComments';
import { metaWithThreadStamp } from './threadStamp';

export const THREAD_FOR_META = 'threadFor';
export const FILE_THREAD_FORMAT = 'filarr.file-thread';

/** Le sidecar d'un fichier dans une liste d'éléments, ou null. */
export function findThreadItem(
  items: VaultItemSummary[],
  fileItemId: string
): VaultItemSummary | null {
  return items.find((i) => i.meta[THREAD_FOR_META] === fileItemId) ?? null;
}

/** Octets déchiffrés d'un sidecar → commentaires sains ({} si illisible). */
export function parseFileThread(bytes: Uint8Array): Record<string, VaultComment> {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
      format?: string;
      v?: number;
      comments?: unknown;
    };
    if (parsed?.format !== FILE_THREAD_FORMAT || parsed.v !== 1) return {};
    return sanitizeCommentMap(parsed.comments);
  } catch {
    return {};
  }
}

export function serializeFileThread(
  threadFor: string,
  comments: Record<string, VaultComment>
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({ format: FILE_THREAD_FORMAT, v: 1, threadFor, comments })
  );
}

/** Le résultat brut d'updateVaultItem — on n'en garde que l'élément. */
type UpdatePayload = { item: VaultItemSummary };

/**
 * Écrit le fil : crée le sidecar au premier commentaire, le met à jour ensuite
 * — toujours par le pipeline complet (K_item neuf, CAS, rescellement des
 * grants). Retourne le sidecar à jour.
 */
export async function saveFileThread(
  dispatch: AppDispatch,
  args: {
    vaultId: string;
    file: VaultItemSummary;
    existing: VaultItemSummary | null;
    comments: Record<string, VaultComment>;
    /** Le fil que le SERVEUR détenait au moment du chargement — la base de fusion. */
    downloadContent: (item: VaultItemSummary) => Promise<Uint8Array>;
  }
): Promise<VaultItemSummary> {
  const { vaultId, file, existing, comments } = args;
  const content = serializeFileThread(file.id, comments);

  /**
   * LE TAMPON EST POSÉ À CHAQUE ÉCRITURE, sur les commentaires QUI PARTENT.
   *
   * Il était absent, et la méta repartait de `{ ...existing.meta }` : un tampon
   * écrit par un téléphone survivait donc intact à toutes les écritures du
   * bureau, en annonçant un compte que plus personne ne vérifiait. Le calculer
   * ici — au même endroit que le corps sérialisé — est la seule place où le
   * chiffre ne peut pas diverger du fil : les deux sortent du même objet.
   */
  const stamped = (base: Record<string, unknown>, written: Record<string, VaultComment>) =>
    metaWithThreadStamp(base, written);

  const create = async (
    body: Uint8Array,
    written: Record<string, VaultComment>
  ): Promise<VaultItemSummary> =>
    (await dispatch(
      addVaultItem({
        vaultId,
        itemType: 'note',
        meta: stamped({ [THREAD_FOR_META]: file.id, title: '' }, written),
        content: body,
      })
    ).unwrap()) as VaultItemSummary;

  if (existing === null) return create(content, comments);

  const update = async (
    expectedVersion: number,
    body: Uint8Array,
    written: Record<string, VaultComment>
  ) =>
    (
      (await dispatch(
        updateVaultItem({
          vaultId,
          itemId: existing.id,
          expectedVersion,
          // La méta repart TELLE QUELLE — perdre threadFor rendrait le fil
          // visible comme une note vide fantôme, orpheline de son fichier —
          // au tampon près, qui doit décrire le fil QU'ON ÉCRIT.
          meta: stamped({ ...existing.meta }, written),
          content: body,
        })
      ).unwrap()) as UpdatePayload
    ).item;

  try {
    return await update(existing.version, content, comments);
  } catch (e) {
    if (!isVaultItemConflict(e)) throw e;
    if (e.serverVersion === null) {
      // Le sidecar n'existe plus côté serveur (cascade d'une suppression du
      // fichier, corbeille…) : on recrée plutôt que de retenter dans le vide.
      return create(content, comments);
    }
    // Quelqu'un a écrit le fil entre-temps : fusion-par-union et UNE reprise.
    // LE TAMPON DÉCRIT LA FUSION, pas notre version : c'est elle qui part.
    const theirs = e.serverItem ? parseFileThread(await args.downloadContent(e.serverItem)) : {};
    const merged = mergeComments(theirs, comments);
    return update(e.serverVersion, serializeFileThread(file.id, merged), merged);
  }
}
