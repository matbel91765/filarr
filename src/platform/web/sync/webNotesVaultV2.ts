/**
 * LE COFFRE v2 DU NAVIGATEUR, VU DES HANDLERS — charger, écrire, et sortir les
 * images du JSON.
 *
 * ═══ POURQUOI CE FICHIER EXISTE ═══
 *
 * Le web pouvait LIRE et SYNCHRONISER un coffre v2 (`webNotesCycleV2`), et
 * depuis peu le MIGRER. Mais il continuait d'ÉCRIRE en v1 : chaque sauvegarde
 * réécrivait `notes_enc` en entier — dix mégaoctets sur un coffre illustré — et
 * le poussait sous `meta:notes`. Un profil migré depuis le navigateur obtenait
 * donc la compatibilité v2, pas son gain : la frappe repartait toujours avec la
 * bibliothèque entière.
 *
 * Ce module est le miroir de `notesVaultFacade.ts` côté bureau : les mêmes
 * gestes, sur le `VaultIO` d'IndexedDB. Les règles, elles, ne sont pas
 * dupliquées — `saveVaultV2`, `loadVaultV2`, `extractBlobs`, `inlineBlobs` sont
 * les jumeaux déjà éprouvés.
 *
 * ═══ L'EMPREINTE D'IMAGE DOIT VALOIR CELLE DU BUREAU ═══
 *
 * SHA-256 de la charge base64 (UTF-8), en hexadécimal, sur seize octets. C'est
 * l'IDENTIFIANT de l'objet : une divergence ferait remonter deux fois la même
 * image sous deux clés — exactement ce que l'adressage par contenu existe pour
 * empêcher. `crypto.subtle` est asynchrone là où `node:crypto` ne l'est pas ;
 * `extractBlobs` étant pur et synchrone, on parcourt deux fois : une pour
 * recenser les charges, une pour poser les références.
 */

import { extractBlobs, inlineBlobs, referencedBlobs, blobPath } from './noteBlobs';
import { NOTES_DIR, type NotesIndex, type NotesPayload, type NoteRecord } from './notesStoreV2';
import { loadVaultV2, saveVaultV2, type VaultIO } from './notesVaultStore';
import { makeSplitDeps, webBlobHash } from './webNotesHash';

export { webBlobHash };

/**
 * SORT LES IMAGES DES NOTES ET LES POSE DANS LE MAGASIN.
 *
 * Deux parcours par note illustrée : le premier ne fait que recenser les
 * charges (l'empreinte rendue est jetée), le second pose les vraies références.
 * Une note sans image ne coûte qu'un parcours, et repart intacte.
 *
 * Les blobs sont écrits AVANT que le coffre ne soit réécrit avec leurs
 * références — même règle que « les notes avant l'index ».
 */
export async function extractIntoWebStore(
  io: VaultIO,
  payload: NotesPayload
): Promise<{ payload: NotesPayload; extracted: number }> {
  const byId = payload.byId as Record<string, NoteRecord> | undefined;
  if (!byId || typeof byId !== 'object') return { payload, extracted: 0 };

  const suivant: Record<string, unknown> = {};
  let extracted = 0;
  for (const [noteId, note] of Object.entries(byId)) {
    if (!note || typeof note !== 'object') {
      suivant[noteId] = note;
      continue;
    }
    // Premier parcours : quelles charges ?
    const charges = new Set<string>();
    const sonde = extractBlobs(note, (b64) => {
      charges.add(b64);
      return '0'.repeat(32);
    });
    if (sonde.rewritten === 0) {
      suivant[noteId] = note;
      continue;
    }
    // Les empreintes, puis le second parcours avec les vraies.
    const empreintes = new Map<string, string>();
    for (const b64 of charges) empreintes.set(b64, await webBlobHash(b64));
    const { content, blobs, rewritten } = extractBlobs(note, (b64) => empreintes.get(b64)!);
    for (const [hash, base64] of Object.entries(blobs)) {
      const chemin = blobPath(NOTES_DIR, hash);
      if (!chemin) continue;
      if ((await io.read(chemin)) === null) await io.write(chemin, base64);
    }
    suivant[noteId] = content;
    extracted += rewritten;
  }
  return { payload: { ...payload, byId: suivant }, extracted };
}

/**
 * REMET LES IMAGES DANS LES NOTES — le renderer voit des data-URL, comme avant.
 * Une référence introuvable est laissée en place et signalée, jamais effacée.
 */
export async function inlineFromWebStore(
  io: VaultIO,
  payload: NotesPayload
): Promise<{ payload: NotesPayload; missing: number }> {
  const byId = payload.byId as Record<string, NoteRecord> | undefined;
  if (!byId || typeof byId !== 'object') return { payload, missing: 0 };

  const besoin = new Set<string>();
  for (const note of Object.values(byId)) referencedBlobs(note, besoin);
  const cache = new Map<string, string | null>();
  for (const hash of besoin) {
    const chemin = blobPath(NOTES_DIR, hash);
    const brut = chemin ? await io.read(chemin) : null;
    cache.set(hash, typeof brut === 'string' ? brut : null);
  }

  const suivant: Record<string, unknown> = {};
  let missing = 0;
  for (const [noteId, note] of Object.entries(byId)) {
    const { content, missing: m } = inlineBlobs(note, (h) => cache.get(h) ?? null);
    suivant[noteId] = content;
    missing += m.length;
  }
  return { payload: { ...payload, byId: suivant }, missing };
}

export interface LoadedWebVault {
  payload: NotesPayload;
  index: NotesIndex;
  /** Notes que l'index cite mais qui n'ont pas pu être lues. */
  missing: string[];
}

/**
 * CHARGE LE COFFRE v2 ET LE REND À LA FORME v1, images remises en ligne.
 * `null` si ce profil n'est pas en v2 (l'appelant lit alors `notes_enc`).
 */
export async function loadWebVaultV2(io: VaultIO): Promise<LoadedWebVault | null> {
  const charge = await loadVaultV2(io);
  if (!charge) return null;
  const { payload } = await inlineFromWebStore(io, charge.payload);
  return { payload, index: charge.index, missing: charge.missing };
}

/**
 * ÉCRIT LE COFFRE EN v2 : images sorties, puis notes, incrémentalement.
 *
 * ⚠ REFUSE D'ÉCRIRE SI DES NOTES MANQUENT À L'APPEL : écrire un coffre auquel
 * il manque les notes qu'on n'a pas su relire les effacerait de l'index, donc
 * du nuage, donc de tous les appareils. Même règle que `saveNotesV2` au bureau.
 */
export async function saveWebVaultV2(
  io: VaultIO,
  payload: NotesPayload,
  previous: NotesIndex | null,
  missing: string[] = []
): Promise<{ index: NotesIndex; written: string[] }> {
  if (missing.length > 0) {
    throw new Error(
      `webNotesVault: écriture refusée — ${missing.length} note(s) n'ont pas pu être relues`
    );
  }
  const sorti = await extractIntoWebStore(io, payload);
  if (sorti.extracted > 0) {
    console.info(`[webNotesVault] ${sorti.extracted} image(s) sortie(s) du JSON des notes`);
  }
  const byId = (sorti.payload.byId ?? {}) as Record<string, NoteRecord>;
  const res = await saveVaultV2(io, sorti.payload, await makeSplitDeps(byId), previous);
  return { index: res.index, written: res.written };
}
