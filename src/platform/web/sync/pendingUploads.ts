/**
 * Registre des modifications locales EN ATTENTE DE REMONTÉE — la face web du
 * `markPendingUpload` desktop (syncManifest). Cloisonné par profil.
 *
 * v1 append-only : on n'enregistre que créations et mises à jour (jamais de
 * suppressions — elles restent locales jusqu'au merge bidirectionnel complet).
 */

import { storeGet, storePut } from '../webStore';
import { emitWebEvent } from '../webEventBus';

const PENDING_KEY = 'pending_uploads';

// Miroir synchrone du registre : `beforeunload` ne peut pas attendre une
// lecture IndexedDB, on maintient donc le compte en mémoire.
let _pendingCount = 0;

export function getPendingCountSync(): number {
  return _pendingCount;
}

export async function refreshPendingCount(): Promise<void> {
  try {
    _pendingCount = Object.keys((await storeGet<PendingMap>(PENDING_KEY)) ?? {}).length;
  } catch {
    /* pas de profil actif : registre inaccessible, compteur inchangé */
  }
}

// Garde-fou de fermeture d'onglet. Au niveau module (et non dans le scheduler)
// pour survivre au verrouillage du coffre : des modifications en attente
// restent en attente, verrou ou pas. (Garde window : tests Node.)
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (_pendingCount > 0) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

export interface PendingEntry {
  kind: 'meta' | 'blob' | 'delete';
  folderId?: string;
  fileName?: string;
  markedAt: string;
  /** `meta:notes` : cette remontée est le PONT v2 → v1 (blob réécrit), pas une écriture v1. */
  legacyWriteBack?: true;
}

export type PendingMap = Record<string, PendingEntry>;

export async function markPendingUpload(
  fileId: string,
  entry: Omit<PendingEntry, 'markedAt'>
): Promise<void> {
  const pending = (await storeGet<PendingMap>(PENDING_KEY)) ?? {};
  pending[fileId] = { ...entry, markedAt: new Date().toISOString() };
  await storePut(PENDING_KEY, pending);
  _pendingCount = Object.keys(pending).length;
  // Badge immédiat (le renderer indexe par fileId ET localPath) + réveil du
  // scheduler (debounce 10 s, comme le desktop).
  if (entry.kind === 'blob' && entry.folderId && entry.fileName) {
    emitWebEvent('sync-file-status-changed', {
      fileId,
      localPath: `${entry.folderId}/${entry.fileName}`,
      status: 'pending_upload',
    });
  }
  emitWebEvent('web:pending-marked');
}

export async function getPendingUploads(): Promise<PendingMap> {
  return (await storeGet<PendingMap>(PENDING_KEY)) ?? {};
}

/** Ce que le push a effectivement traité : l'id ET la marque qu'il a lue. */
export interface PendingAck {
  fileId: string;
  /** `markedAt` observé AU DÉBUT du push. `undefined` = purge inconditionnelle. */
  markedAt?: string;
}

/**
 * Acquittement PAR COMPARAISON. Une entrée n'est retirée que si sa marque est
 * encore CELLE QUI A ÉTÉ POUSSÉE : le push dure (chiffrement, upload, CAS du
 * manifeste), et une sauvegarde survenue pendant ce temps remarque la ressource
 * avec un `markedAt` neuf. La purge aveugle d'origine effaçait cette marque-là,
 * donc la dernière modification n'était JAMAIS remontée — elle attendait la
 * suivante, indéfiniment si l'utilisateur s'arrêtait d'écrire.
 */
export async function clearPendingUploads(acks: PendingAck[]): Promise<void> {
  if (acks.length === 0) return;
  const pending = (await storeGet<PendingMap>(PENDING_KEY)) ?? {};
  let removed = 0;
  for (const { fileId, markedAt } of acks) {
    const entry = pending[fileId];
    if (!entry) continue;
    if (markedAt !== undefined && entry.markedAt !== markedAt) {
      // Remarquée pendant le push : la marque neuve reste, le prochain cycle
      // remontera la modification qu'elle désigne.
      continue;
    }
    delete pending[fileId];
    removed++;
  }
  if (removed === 0) return;
  await storePut(PENDING_KEY, pending);
  _pendingCount = Object.keys(pending).length;
}
