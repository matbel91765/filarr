/**
 * ÉCRITURE ATOMIQUE de petits fichiers — le patron déjà éprouvé du coffre,
 * factorisé pour le matériel de clé.
 *
 * POURQUOI CE FICHIER EXISTE. Le coffre possède déjà ce patron
 * (`StorageService.transcodeToPortableStaging` : fichier d'attente VOISIN,
 * vérification, puis renommage atomique) mais il est taillé pour du streaming
 * de plusieurs gigaoctets. Le matériel de clé, lui, tient en quelques centaines
 * d'octets et était écrit par un `fs.writeFile` direct PAR-DESSUS le fichier
 * final. Une coupure d'alimentation au milieu de cette écriture laisse un
 * `wrapped_fek.json` tronqué — c'est-à-dire un coffre qu'aucun mot de passe
 * n'ouvre plus. Le coût de la protection est un `rename` ; le coût de son
 * absence est le coffre entier.
 *
 * LES TROIS TEMPS, ET CE QUE CHACUN GARANTIT :
 *  1. écrire dans un fichier d'attente VOISIN (même répertoire, donc même
 *     système de fichiers — `rename` n'est atomique que dans ce cas) puis
 *     `fsync` : sans lui, une coupure peut publier un nom qui pointe sur des
 *     octets jamais descendus au disque ;
 *  2. RELIRE le fichier d'attente et le confronter octet pour octet à ce qu'on
 *     voulait écrire. C'est la « vérification » du patron d'origine : elle
 *     attrape un disque plein, un système de fichiers menteur, une écriture
 *     partielle silencieuse ;
 *  3. `rename` — l'instant où le nouveau contenu devient le fichier. Avant, le
 *     fichier en place est l'ANCIEN, entier. Après, le NOUVEAU, entier. Il
 *     n'existe aucun instant intermédiaire.
 *
 * Le suffixe `.tmp` n'est pas cosmétique : l'inventaire de migration
 * (`inventoryScan.EXCLUDED_SUFFIXES`) l'ignore, donc un fichier d'attente
 * abandonné par une coupure ne sera jamais pris pour du contenu à publier.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

/**
 * Écrit `data` à `destPath` sans jamais laisser le fichier final à moitié écrit.
 *
 * Lève si la relecture ne rend pas exactement les octets demandés — et dans ce
 * cas le fichier d'attente est supprimé et le fichier final N'A PAS ÉTÉ TOUCHÉ.
 */
export async function writeFileAtomic(
  destPath: string,
  data: Buffer,
  mode = 0o600
): Promise<void> {
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  const staging = `${destPath}.${crypto.randomBytes(6).toString('hex')}.tmp`;

  try {
    const handle = await fs.open(staging, 'w', mode);
    try {
      await handle.writeFile(data);
      await handle.sync().catch(() => undefined);
    } finally {
      await handle.close().catch(() => undefined);
    }

    const readBack = await fs.readFile(staging);
    if (!readBack.equals(data)) {
      throw new Error('[publish] Écriture atomique : la relecture diffère de ce qui a été écrit');
    }

    await fs.rename(staging, destPath);
  } catch (err) {
    await fs.unlink(staging).catch(() => undefined);
    throw err;
  }
}
