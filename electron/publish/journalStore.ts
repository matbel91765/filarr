/**
 * Branchement `electron` du journal de migration.
 *
 * Le journal vit dans `{userData}/FilarData/publish-journal.json`, scellé par
 * `safeStorage`. Il DOIT être lisible AVANT tout déverrouillage de coffre :
 * c'est lui qui dit s'il faut reprendre, et la reprise décide de la clé. D'où
 * `safeStorage` (lié à la session OS) plutôt qu'une clé de coffre, qui n'est
 * précisément pas encore disponible à ce moment-là.
 *
 * Repli sans trousseau : on écrit le JSON en clair. Le journal ne contient
 * AUCUNE clé, aucun fragment de clé, aucun clair de fichier — seulement des
 * compteurs, des identifiants et des condensats. Refuser de démarrer une
 * migration parce que le trousseau manque coûterait plus qu'il ne protège.
 */

import path from 'path';
import { app, safeStorage } from 'electron';
import { createJournalStore, type JournalStore } from './journalStoreCore';

let cached: JournalStore | null = null;

export function getPublishBaseDir(): string {
  return path.join(app.getPath('userData'), 'FilarData');
}

export function getJournalStore(): JournalStore {
  if (cached) return cached;
  cached = createJournalStore(getPublishBaseDir(), {
    seal: (plain) =>
      safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(plain)
        : Buffer.from(plain, 'utf-8'),
    unseal: (sealed) => {
      // Le JSON en clair commence par « { » : c'est le marqueur qui distingue
      // les deux formes sans avoir à deviner l'état du trousseau, lequel peut
      // avoir changé entre l'écriture et la relecture.
      if (sealed.length > 0 && sealed[0] === 0x7b) return sealed.toString('utf-8');
      return safeStorage.decryptString(sealed);
    },
  });
  return cached;
}

/** Réservé aux tests d'intégration du process principal. */
export function resetJournalStoreCache(): void {
  cached = null;
}
