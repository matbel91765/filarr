/**
 * LA PORTE — refuse la surface IPC qui rend du clair pendant que le coffre est
 * verrouillé.
 *
 * POURQUOI UN ENROBAGE PLUTÔT QUE SOIXANTE APPELS
 *
 * La première idée était de poser un `assertVaultUnlocked(channel)` en tête de
 * chaque handler concerné. Une soixantaine d'insertions dans un fichier de dix
 * mille lignes, qu'aucun mécanisme ne rappelle : le prochain canal de lecture
 * ajouté n'en aurait pas, et personne ne s'en apercevrait — une porte qui
 * s'ouvre en silence à mesure que le code grandit.
 *
 * Ici, l'enrobage intercepte `ipcMain.handle` une fois pour toutes, et la LISTE
 * des canaux gardés est un objet qu'on relit. Mieux : `auditGate()` dit quels
 * noms de la liste n'ont JAMAIS été enregistrés — un canal renommé ou une faute
 * de frappe deviennent visibles au lieu de créer un trou muet.
 *
 * CE QUE LA PORTE NE FAIT PAS, et il faut le dire :
 *   · elle ne chiffre rien. Le disque reste ce qu'il est (voir l'en-tête de
 *     `vaultLockState`) ;
 *   · elle ne couvre PAS les chemins internes du main. Le cycle de
 *     synchronisation déchiffre le manifeste et fusionne les notes sans passer
 *     par IPC : il continue de tourner sur un coffre verrouillé. C'est voulu —
 *     le nuage doit rester cohérent — mais ça veut dire que « verrouillé » ferme
 *     la surface APPLICATIVE, pas le processus.
 *
 * D'OÙ LA RÈGLE, pour tout ce qui viendra lire le coffre depuis le main sans
 * passer par `ipcMain.handle` — un serveur MCP local, un greffon, une tâche de
 * fond : cette porte-là ne vous protège pas. Appelez `isVaultLocked()` (ou
 * `assertVaultUnlocked()`) vous-même, à l'entrée. Croire que « le verrou est
 * géré » parce qu'il l'est pour l'interface serait la façon la plus naturelle
 * de rouvrir ce que ce module vient de fermer.
 */

import { assertVaultUnlocked } from './vaultLockState';

/**
 * Les canaux qui rendent du clair, ou qui écrivent/détruisent dans le coffre.
 *
 * ABSENTS VOLONTAIREMENT — chacun pour une raison, et pas par oubli :
 *
 *   · `notes:save` / `notes:saveDelta` : SEULES écritures pilotées par un
 *     debounce (2 s dans `App.tsx`), et c'est précisément ce qui les fait
 *     sortir. `forgetSessionSecrets` purge l'écriture en attente avant
 *     d'effacer les clés, et `lockVaultFromMain` ATTEND cette purge avant
 *     d'effacer la sienne — mais cette attente n'a lieu qu'avec la porte DÉJÀ
 *     fermée. Si ces deux canaux étaient gardés, la purge se ferait refuser par
 *     la porte qu'elle est censée précéder, et le verrouillage perdrait la
 *     frappe qu'il devait sauver. Leur exception est ce qui rend l'attente
 *     utile plutôt que dangereuse.
 *   · `vault:purgeTemp`, `deleteTempFile` : ils EFFACENT du clair. Les refuser
 *     pendant un verrouillage laisserait traîner exactement ce qu'on veut voir
 *     partir.
 *   · `miniMode:getRecent`, `miniMode:protectFiles` : déjà gardés main-side, et
 *     ils répondent « vide » / « refusé » proprement. Lever une erreur à la
 *     place dégraderait la fenêtre mini sans rien gagner.
 *   · `import:*` : lisent des fichiers OS choisis par la personne, pas le coffre.
 *   · tout ce qui sert À DÉVERROUILLER (`hybrid:*` de clés, `security:*`,
 *     `crypto:*`, `secureStore:*`, `profile:*`, `auth:*`) : les fermer
 *     interdirait de rouvrir.
 */
export const GATED_CHANNELS: readonly string[] = [
  // ── Lectures de contenu ───────────────────────────────────────────────
  'getFolders',
  'getFolder',
  'getFolderItems',
  'getItem',
  'readFile',
  'readEncryptedFile',
  'readEncryptedFileForCopy',
  'readTempFile',
  'openFile',
  'openEncryptedFile',
  'openVaultFile',
  'downloadItem',
  'downloadMultipleAsZip',
  'prepareDragFile',
  'file:getLocalPath',
  'file:readForExport',
  'stream:getSize',
  'stream:readRange',
  'hybrid:readDecryptedV3',
  'hybrid:readRawBlob',
  'notes:load',
  'note-versions:get',
  'note-versions:list',
  'file-versions:content',
  'file-versions:list',
  'layout:load',
  'storage:getTrashItems',
  'vault:exportZip',
  'export:gdprData',
  'filarrBox:inspect',
  'filarrBox:extractAll',
  'filarrBox:extractEntry',
  'filarrBox:openFile',
  // Les rappels vivent dans les notes et le calendrier : les rendre, c'est
  // rendre du contenu.
  'getAllReminders',
  'getReminder',
  'getReminders',

  // ── Écritures et destructions dans le coffre ──────────────────────────
  'addItemToFolder',
  'updateItem',
  'updateItemInFolder',
  'removeItemFromFolder',
  'renameItem',
  'moveItem',
  'copyItem',
  'deleteFile',
  'deleteFolder',
  'saveFolder',
  'updateFolder',
  'saveFile',
  'saveEncryptedFile',
  'saveEncryptedFileFromPath',
  'writeRawFile',
  'hybrid:saveFromPath',
  'hybrid:writeRawBlob',
  'hybrid:deleteBlob',
  'hybrid:renameBlob',
  'notes:saveImageAs',
  'note-versions:delete',
  'note-versions:clear',
  'file-versions:snapshot',
  'file-versions:delete',
  'file-versions:clear',
  'layout:save',
  'layouts:exportFile',
  'layouts:importFile',
  'storage:deleteFile',
  'storage:deleteFolder',
  'storage:emptyTrash',
  'storage:permanentlyDeleteItem',
  'storage:restoreItem',
  'storage:autoCleanupTrash',
  'vault:importZip',
  'file:moveIntoVault',
  'convertFileToVaultShortcut',
  'filarrBox:protect',
  'filarrBox:unprotect',
  'addReminder',
  'addReminderToNote',
  'updateReminder',
  'updateReminderForNote',
  'deleteReminder',
  'deleteReminderFromNote',
  'snoozeReminder',
  'markReminderAsDone',
  'markReminderAsRead',
  'collab:setLiveNotes',
];

const gatedSet: ReadonlySet<string> = new Set(GATED_CHANNELS);

/**
 * Sous-ensemble minimal d'`ipcMain` dont la porte a besoin — assez lâche pour
 * qu'un vrai `IpcMain` s'y glisse, et pour qu'un faux le fasse aussi dans les
 * tests. Les `any` reprennent EXACTEMENT la signature d'Electron : les resserrer
 * rendrait `IpcMain` non assignable (la contravariance du paramètre `event`).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface HandleRegistrar {
  handle(channel: string, listener: (event: any, ...args: any[]) => any): void;
}

type GatedListener = (event: any, ...args: any[]) => any;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Canaux gardés effectivement enregistrés, dans l'ordre d'enregistrement. */
const registered = new Set<string>();

/**
 * Enrobe `ipcMain.handle` : tout canal de `GATED_CHANNELS` lèvera
 * `ERR_VAULT_LOCKED` tant que le coffre est verrouillé, AVANT que le handler
 * d'origine ne touche au disque.
 *
 * À appeler UNE fois, AVANT l'enregistrement des handlers : seuls ceux
 * enregistrés après cet appel sont gardés. L'audit se lit séparément
 * (`auditGate`), une fois tout enregistré.
 */
export function installVaultLockGate(ipcMain: HandleRegistrar): void {
  const original = ipcMain.handle.bind(ipcMain);

  ipcMain.handle = function gatedHandle(channel: string, listener: GatedListener): void {
    if (!gatedSet.has(channel)) {
      original(channel, listener);
      return;
    }
    registered.add(channel);
    original(channel, function gated(event, ...args) {
      // AVANT le handler, sans exception : refuser après coup laisserait la
      // lecture avoir lieu, et c'est la lecture qu'on refuse.
      assertVaultUnlocked(channel);
      return listener(event, ...args);
    });
  };
}

/**
 * Ce que la porte garde vraiment, confronté à ce qu'elle croit garder.
 *
 * `missing` est le seul champ qui compte : un nom listé qu'aucun handler ne
 * porte est un canal renommé ou mal orthographié, donc un trou. À journaliser
 * une fois tous les handlers enregistrés — c'est le rappel qu'une insertion
 * manuelle par handler n'aurait jamais offert.
 */
export function auditGate(): { guarded: string[]; missing: string[] } {
  const guarded = GATED_CHANNELS.filter((c) => registered.has(c));
  const missing = GATED_CHANNELS.filter((c) => !registered.has(c));
  return { guarded, missing };
}

/** Remise à zéro — tests uniquement. */
export function resetGateForTests(): void {
  registered.clear();
}
