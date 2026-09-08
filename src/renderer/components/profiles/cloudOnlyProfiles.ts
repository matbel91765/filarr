/**
 * cloudOnlyProfiles.ts — Les profils que le nuage connaît et que cet appareil
 * n'a pas.
 *
 * `GET /sync/profiles` rend TOUT ce que le compte porte, pierres tombales
 * comprises (`deletedAt`). La fenêtre « Gérer les profils » ne listait que les
 * profils locaux et leur état nuage ; un profil présent là-haut seulement — un
 * essai d'une ancienne installation, un profil scellé sous une clé que le
 * compte n'a plus — n'apparaissait nulle part, et rien ne permettait de s'en
 * séparer. Il encombrait pourtant chaque lancement (« Failed to restore
 * profile … », sur chaque appareil, à chaque démarrage).
 *
 * Pur, sans React ni IPC : c'est la sélection et l'ordre que l'on prouve ici.
 */

export interface CloudProfileRowLike {
  profileId: string;
  manifestVersion?: number;
  storageUsed?: number;
  lastSyncAt?: string | null;
  /** Pierre tombale : déjà supprimé du nuage, plus rien à faire. */
  deletedAt?: string | null;
}

export interface CloudOnlyProfile {
  profileId: string;
  /** Les huit premiers caractères : de quoi reconnaître une ligne dans un journal. */
  shortId: string;
  lastSyncAt: string | null;
  storageUsed: number;
}

const parseMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
};

/**
 * Les lignes du nuage qui ne correspondent à aucun profil local et ne sont pas
 * des pierres tombales, les plus récemment synchronisées d'abord (jamais
 * synchronisé en dernier). Une liste `null` (nuage injoignable) rend `[]` : on
 * ne propose pas de supprimer ce qu'on n'a pas pu lire.
 */
export function cloudOnlyProfiles(
  rows: CloudProfileRowLike[] | null | undefined,
  localIds: Iterable<string>
): CloudOnlyProfile[] {
  if (!rows) return [];
  const local = new Set(localIds);
  return rows
    .filter((r) => !local.has(r.profileId) && !r.deletedAt)
    .map((r) => ({
      profileId: r.profileId,
      shortId: r.profileId.slice(0, 8),
      lastSyncAt: r.lastSyncAt ?? null,
      storageUsed: typeof r.storageUsed === 'number' && r.storageUsed > 0 ? r.storageUsed : 0,
    }))
    .sort((a, b) => (parseMs(b.lastSyncAt) ?? -1) - (parseMs(a.lastSyncAt) ?? -1));
}

/** Mégaoctets avec une décimale, pour `profiles.cloudOnlySize`. */
export function megabytes(bytes: number): string {
  return (Math.max(0, bytes) / (1024 * 1024)).toFixed(1);
}
