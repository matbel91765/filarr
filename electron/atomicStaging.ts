/**
 * LE NOM DU FICHIER DE STAGING D'UNE ÉCRITURE ATOMIQUE.
 *
 * Écrire `X.tmp` puis le renommer en `X` rend l'écriture atomique pour le
 * LECTEUR : il voit l'ancien fichier ou le nouveau, jamais un fichier à moitié
 * écrit. C'est le bon geste, et tout le dépôt le fait.
 *
 * ── CE QU'UN `.tmp` PARTAGÉ CASSE, ET IL L'A CASSÉ EN PRODUCTION ────────────
 *
 * Le nom `X.tmp` est le même pour TOUS les écrivains. Deux écritures qui se
 * croisent écrivent donc dans le MÊME fichier de staging, et se marchent
 * dessus :
 *
 *   · le premier renomme, le second trouve son staging DISPARU → `ENOENT` ;
 *   · ou le premier tient encore son descripteur → `EPERM` sous Windows ;
 *   · et dans le meilleur des cas, le fichier publié contient un mélange des
 *     deux écritures.
 *
 * Ce n'est pas théorique. Journaux du 2026-09-07, sur un compte ouvert depuis
 * deux postes :
 *
 *     Sync failed: ENOENT: no such file or directory,
 *     rename 'sync-manifest.json.tmp' -> 'sync-manifest.json'
 *
 * Cinq fois, et chacune fait échouer le CYCLE ENTIER de synchronisation. Plus
 * trois `EPERM` et deux `ENOENT` sur `sync-queue.json`.
 *
 * ── POURQUOI CE MODULE PLUTÔT QU'UN SUFFIXE RECOPIÉ ─────────────────────────
 *
 * Le remède était DÉJÀ dans le dépôt — `noteVersionService` et
 * `fileVersionService` l'avaient trouvé, chacun de son côté, avec un
 * commentaire qui raconte le même incident. Quatre autres écrivains ne
 * l'avaient pas. Une règle qui vit en deux copies et manque à quatre endroits
 * n'est pas une règle : c'est une coïncidence. Elle a maintenant un seul
 * endroit où être, et un test qui vérifie que personne ne la contourne.
 *
 * ── LE SUFFIXE ──────────────────────────────────────────────────────────────
 *
 * PID en base 36 (deux instances de Filarr sur la même machine — ça arrive, et
 * c'est même le cas de la machine de développement) plus six octets aléatoires
 * (deux écritures concurrentes DANS le même processus, le cas courant : le
 * cycle de synchro et le canal instantané). Ni l'un ni l'autre ne suffit seul.
 */

import * as crypto from 'crypto';

/**
 * Le chemin de staging pour écrire `cible`, unique à cet appel.
 *
 * Se termine par `.tmp` : les observateurs de dossier filtrent déjà sur cette
 * extension (`vaultWatcher`), et un staging vu comme un fichier du coffre
 * déclencherait une synchronisation de l'intermédiaire.
 */
export function cheminDeStaging(cible: string): string {
  return `${cible}.${process.pid.toString(36)}.${crypto.randomBytes(6).toString('hex')}.tmp`;
}
