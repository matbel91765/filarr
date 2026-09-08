/**
 * fileVersionStore — la façade renderer du magasin d'instantanés de fichiers.
 *
 * Mince pont IPC vers `electron/fileVersionService.ts`, où vivent réellement
 * les octets : chiffrés sous la FEK du profil, avec une empreinte SHA-256
 * vérifiée à la relecture.
 *
 * ── POURQUOI CE MODULE EXISTE À PART ───────────────────────────────────────
 * `versionService.ts` est l'API historique (configuration, comparaison, index
 * localStorage). Elle a longtemps prétendu versionner sans jamais écrire un
 * octet. Plutôt que de la réécrire d'un bloc, on isole ici LE SEUL endroit qui
 * connaît le magasin réel : `versionService` s'y adresse quand le pont existe,
 * et retombe sur son index de métadonnées quand il n'existe pas (navigateur).
 *
 * La distinction n'est pas cosmétique : elle est publiée jusque dans
 * l'interface par `contentAvailable`. Un historique sans octets ne doit PAS
 * proposer « Restaurer ».
 */

export interface FileVersionRecord {
  id: string;
  fileId: string;
  fileName: string;
  folderId: string;
  versionNumber: number;
  size: number;
  /** SHA-256 hexadécimal du contenu en clair. */
  sha256: string;
  createdAt: string;
  comment?: string;
}

export type SnapshotOutcome =
  | { status: 'created'; version: FileVersionRecord }
  | { status: 'unchanged' }
  | { status: 'too_large'; size: number; limit: number }
  | { status: 'failed'; reason: string };

/**
 * Vrai quand le magasin d'octets est joignable.
 *
 * C'est la SEULE question à poser avant de promettre une restauration. Sur le
 * web il n'y a pas de magasin : l'interface doit le dire, pas le masquer.
 */
export function isAvailable(): boolean {
  const pont = (window as unknown as { electron?: { ipcRenderer?: { invoke?: unknown } } })
    .electron?.ipcRenderer;
  return typeof pont?.invoke === 'function';
}

async function invoke<T>(channel: string, args: unknown[], repli: T): Promise<T> {
  const pont = (
    window as unknown as {
      electron?: { ipcRenderer?: { invoke?: (c: string, ...a: unknown[]) => Promise<unknown> } };
    }
  ).electron?.ipcRenderer;
  if (!pont || typeof pont.invoke !== 'function') return repli;
  try {
    const res = await pont.invoke(channel, ...args);
    return (res ?? repli) as T;
  } catch {
    return repli;
  }
}

/**
 * Photographier l'état REMPLACÉ d'un fichier.
 *
 * On passe les octets d'AVANT la sauvegarde, jamais ceux d'après : voir
 * l'en-tête de `electron/fileVersionService.ts` pour la raison (sinon l'état
 * d'origine d'un fichier disparaît à sa première modification).
 */
export async function snapshot(input: {
  fileId: string;
  fileName: string;
  folderId: string;
  bytes: Uint8Array;
  comment?: string;
}): Promise<SnapshotOutcome> {
  return invoke<SnapshotOutcome>('file-versions:snapshot', [input], {
    status: 'failed',
    reason: 'bridge_unavailable',
  });
}

/** Les métadonnées des versions d'un fichier, plus récent d'abord. */
export async function listVersions(fileId: string): Promise<FileVersionRecord[]> {
  if (!fileId) return [];
  return invoke<FileVersionRecord[]>('file-versions:list', [fileId], []);
}

/**
 * Les octets d'une version — ou `null`.
 *
 * `null` couvre DEUX cas volontairement indistincts pour l'appelant : la
 * version n'existe pas, ou son empreinte ne correspond plus. Dans les deux, la
 * seule conduite sûre est identique : ne rien réécrire.
 */
export async function getVersionBytes(
  fileId: string,
  versionId: string
): Promise<Uint8Array | null> {
  const res = await invoke<Uint8Array | number[] | null>(
    'file-versions:content',
    [fileId, versionId],
    null
  );
  if (!res) return null;
  return res instanceof Uint8Array ? res : new Uint8Array(res as number[]);
}

export async function deleteVersion(fileId: string, versionId: string): Promise<boolean> {
  return invoke<boolean>('file-versions:delete', [fileId, versionId], false);
}

export async function clearVersions(fileId: string): Promise<boolean> {
  return invoke<boolean>('file-versions:clear', [fileId], false);
}
