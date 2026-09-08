import { contextBridge, ipcRenderer, webUtils, IpcRendererEvent } from 'electron';

/**
 * IPC Channel Allowlists
 * Only these channels can be used from the renderer process.
 */
const ALLOWED_INVOKE_CHANNELS = new Set([
  // App Config
  'getConfig',
  'saveConfig',
  // Folders
  'saveFolder',
  'getFolders',
  'getFolderItems',
  'getFolder',
  'updateFolder',
  'deleteFolder',
  // Items
  'addItemToFolder',
  'removeItemFromFolder',
  'updateItemInFolder',
  'convertFileToVaultShortcut',
  'getItem',
  'updateItem',
  'moveItem',
  'copyItem',
  // Files
  'saveFile',
  'readFile',
  'deleteFile',
  'openFile',
  'readEncryptedFile',
  'readEncryptedFileForCopy',
  'saveEncryptedFile',
  'saveEncryptedFileFromPath',
  'openEncryptedFile',
  'renameItem',
  'readTempFile',
  'deleteTempFile',
  'openVaultFile',
  'downloadItem',
  'downloadMultipleAsZip',
  'writeRawFile',
  'prepareDragFile',
  // Reminders
  'addReminder',
  'updateReminder',
  'deleteReminder',
  'getAllReminders',
  'getReminders',
  'getReminder',
  'markReminderAsRead',
  'markReminderAsDone',
  'snoozeReminder',
  'getNotificationSettings',
  'updateNotificationSettings',
  // Dialogs
  'showSaveDialog',
  'showOpenDialog',
  // Storage
  'getStorageQuota',
  'updateStorageQuota',
  // Trash
  'storage:getTrashItems',
  'storage:restoreItem',
  'storage:permanentlyDeleteItem',
  'storage:emptyTrash',
  'storage:autoCleanupTrash',
  'storage:deleteFolder',
  'storage:deleteFile',
  // Password Manager
  'pm:saveDatabase',
  'pm:loadDatabase',
  'pm:deleteDatabase',
  'pm:exportToFile',
  'pm:importFromFile',
  'pm:copyToClipboard',
  // Presse-papiers : copie d'une IMAGE (bitmap + HTML) — voir
  // src/services/notes/noteImageClipboard.ts.
  'clipboard:writeImage',
  'notes:saveImageAs',
  // Format du coffre de notes (v1 blob / v2 un objet par note) et bascule
  // EXPLICITE vers la v2. Lecture seule pour le premier ; le second est le
  // bouton des réglages, soumis au même garde-fou que la migration automatique.
  'notes:vaultFormat',
  'notes:migrateV2',
  // Crypto
  'crypto:argon2Hash',
  'crypto:argon2Verify',
  'crypto:argon2DeriveKey',
  // Argon2id BRUT, profil donné par l'appelant — la KEK de la clé de garde du
  // compte, qui doit reproduire celui du site et du mobile. Cf. argon2Service.
  'crypto:argon2Raw',
  // Clé de garde du compte : matériel de clé, libellés scellés des partages,
  // et la mémoire optionnelle « se souvenir sur cet appareil » (safeStorage).
  // Rien n'est déchiffré côté principal — cf. electron/custodyService.ts.
  'custody:key',
  'custody:shareLabels',
  'custody:setLabel',
  'custody:remember',
  'custody:recall',
  'custody:rememberStatus',
  'custody:forget',
  'crypto:hashPassword',
  'crypto:verifyPassword',
  // Secure password hash store (file/folder passwords)
  'secureStore:getPasswordHashes',
  'secureStore:setPasswordHashes',
  // Extension Bridge — disabled until Password Manager ships (v2.x)
  // 'extension:getStatus', 'extension:generatePairingCode',
  // 'extension:removePairedClient', 'extension:setPort',
  // Desktop Notifications
  'showDesktopNotification',
  // Export
  'export:gdprData',
  // BYOS (Bring Your Own Storage)
  'byos:saveProvider',
  'byos:getProviders',
  'byos:deleteProvider',
  'byos:testConnection',
  'byos:upload',
  'byos:download',
  'byos:delete',
  'byos:list',
  // Profiles
  'profile:getManifest',
  'profile:create',
  'profile:update',
  'profile:delete',
  'profile:activate',
  'profile:reorder',
  'profile:verifyPin',
  'profile:resetPin',
  'profile:fullReset',
  'profile:unlinkCloud',
  // Notes (encrypted disk persistence). `notes:saveDelta` porte les SEULES
  // notes touchées depuis la dernière écriture : le coffre entier (70 Mo sur un
  // coffre chargé d'images) traversait le pont à chaque frappe, et sa
  // sérialisation figeait le renderer pile pendant le clic qui suit un
  // glissement. Le format de notes.enc, lui, ne change pas.
  'notes:save',
  'notes:saveDelta',
  'notes:load',
  // Mise en page modulaire (conteneur chiffré `layout.enc`, synchronisé) :
  // `layout:load` amorce au premier appel d'un profil, `layout:save` scelle et
  // marque la remontée. Contrat : src/services/layout/layoutTypes.ts.
  'layout:load',
  'layout:save',
  // Modèles de mise en page PARTAGEABLES (.filarrlayout) : dialogue de fichier
  // et lecture BRUTE. Le principal ne parse jamais ces fichiers — la validation
  // vit dans src/services/layouts/layoutValidator.ts, côté renderer.
  'layouts:exportFile',
  'layouts:importFile',
  'layouts:takePendingOpen',
  // Note version history (encrypted on-disk snapshots)
  'note-versions:list',
  'note-versions:get',
  'note-versions:delete',
  'note-versions:clear',
  // Historique des FICHIERS personnels — mêmes instantanés chiffrés, mais des
  // octets et non du JSON. `snapshot` photographie l'état REMPLACÉ, `content`
  // rend les octets déchiffrés APRÈS vérification de l'empreinte.
  'file-versions:snapshot',
  'file-versions:list',
  'file-versions:content',
  'file-versions:delete',
  'file-versions:clear',
  // Generic file open dialog
  'dialog:openFile',
  // External import (Obsidian, Notion, Evernote)
  'import:selectDirectory',
  'import:selectFile',
  'import:readDirectory',
  'import:readFile',
  // Streaming import (list paths, then read in batches — keeps large vaults flat in memory)
  'import:listFiles',
  'import:readBatch',
  // Auto Link Title (fetch page title bypassing CORS)
  'fetchPageTitle',
  // Bookmark (fetch page metadata bypassing CORS)
  'fetchPageMetadata',
  // Inline-database connectors (whitelisted upstream APIs, no client URL)
  'connectors:lookup',
  // Hybrid Storage (local-first + cloud sync)
  'hybrid:renameBlob',
  'hybrid:writeRawBlob',
  'hybrid:readRawBlob',
  'hybrid:fileExists',
  'hybrid:computeChecksum',
  'hybrid:deleteBlob',
  // V3-FEK hybrid large files (streamed in main with the session FEK)
  'hybrid:saveFromPath',
  'hybrid:isV3Blob',
  'hybrid:readDecryptedV3',
  // Ranged vault-file reads for windowed previews (PDF/ZIP, no whole-buffer)
  'stream:getSize',
  'stream:readRange',
  'hybrid:saveWrappedKey',
  // Rattacher le profil actif au compte de la session, preuve du mot de passe
  // de coffre à l'appui. Web seulement aujourd'hui — sur le bureau la session
  // vit DANS le profil, les deux ne peuvent pas diverger.
  'profiles:attachToAccount',
  'hybrid:loadWrappedKey',
  'hybrid:pushWrappedKeyToCloud',
  'hybrid:fetchWrappedKeyFromCloud',
  'hybrid:storeFEK',
  'hybrid:loadFEK',
  'hybrid:clearFEK',
  'hybrid:hasKey',
  // Device-bound key for SSO unlock (E5-4)
  'hybrid:storeDeviceKey',
  'hybrid:loadDeviceKey',
  'hybrid:clearDeviceKey',
  // Per-user keypair (E2-4)
  'keypair:saveLocal',
  'keypair:loadLocal',
  'keypair:pushToCloud',
  'keypair:fetchFromCloud',
  // Vault export/import
  'vault:exportZip',
  'vault:selectImportFile',
  'vault:importZip',
  'file:readForExport',
  'file:getLocalPath',
  'file:showInFolder',
  // Persistent flags (survives localStorage resets)
  'flag:get',
  'flag:set',
  'flag:remove',
  // Redux state sync
  'redux-state-changed',
  // Print
  'pdf:printRecoveryCodes',
  // Cloud Auth
  'auth:login',
  'auth:ssoResolve',
  'auth:ssoLogin',
  'auth:ssoCancel',
  'auth:register',
  'auth:logout',
  'auth:getStatus',
  'auth:getAccessToken',
  'auth:recoverPhraseVerify',
  'auth:recoverComplete',
  'auth:verifyEmail',
  'auth:getMe',
  'auth:getDevices',
  'auth:deleteDevice',
  'auth:revokeDormantDevices',
  'app:checkForUpdates',
  'auth:deleteAccountData',
  'auth:deleteAccount',
  'auth:changePassword',
  // « Ajouter un compte cloud » : se connecter avant de choisir un profil
  'auth:beginPendingSession',
  'auth:discardPendingSession',
  'auth:pendingSessionStatus',
  // Organizations (E1 — multi-tenant)
  'org:list',
  'org:setCurrent',
  'org:getCurrent',
  // Workspace space (personal | enterprise)
  'space:get',
  'space:set',
  // Org onboarding: create / join
  'org:create',
  'org:acceptInvitation',
  // Governance offline policy cache (E9-10)
  'org:policy:save',
  'org:policy:load',
  'org:policy:clear',
  'org:members:list',
  'org:members:updateRole',
  'org:members:remove',
  'org:invitations:list',
  'org:invitations:create',
  'org:invitations:revoke',
  'org:billing:status',
  'org:billing:seats',
  'org:billing:checkout',
  'org:billing:portal',
  'org:update',
  'org:delete',
  'org:restore',
  // Two-Factor Auth
  'auth:completeMFALogin',
  'auth:cancelMFALogin',
  'auth:mfaEnrollSetup',
  'auth:mfaEnrollVerify', // E5-7 forced enrolment
  'auth:get2FAStatus',
  'auth:setup2FA',
  'auth:verifySetup2FA',
  'auth:disable2FA',
  'auth:regenerateBackupCodes',
  'auth:regenerateRecoveryPhrase',
  // Device Pairing
  'pairing:initiate',
  'pairing:join',
  'pairing:cancel',
  'pairing:getCode',
  // v2 : la comparaison numérique (SAS) et son verdict humain
  'pairing:confirmSas',
  'pairing:rejectSas',
  // « Publier ce coffre sur le compte » — la sortie du refus d'adoption.
  // Aucun de ces canaux ne transporte de clé ni de contenu : compteurs, noms de
  // profil, verdicts. La bascule est un canal SÉPARÉ et explicite.
  'publish:getState',
  'publish:buildInventory',
  'publish:start',
  'publish:pause',
  'publish:retry',
  'publish:commitSwitch',
  'publish:abandon',
  // Clés RETIRÉES : anciennes clés de coffre conservées en LECTURE SEULE après
  // une bascule. Le renderer en a besoin — c'est LUI qui déchiffre les petits
  // blobs de profil hybride, et sans elles un coffre migré paraîtrait vide.
  // Même classe d'exposition que `hybrid:loadFEK`, qui rend déjà la clé active.
  'publish:getRetiredKeys',
  // Billing
  'billing:checkout',
  'billing:portal',
  // Security
  'security:getEnhancedLock',
  'security:setEnhancedLock',
  'security:exportRecoveryKey',
  'security:previewRecoveryKey',
  'security:importRecoveryKey',
  // Cloud Sync
  'sync:getStatus',
  'sync:triggerSync',
  'sync:getCloudProfiles',
  'sync:restoreCloudProfiles',
  'sync:deleteCloudProfile',
  'sync:resolveConflict',
  'sync:getConflicts',
  'sync:getAllFileStatuses',
  'sync:setEnabled',
  // Panneau « Activité de sync » : lecture du manifeste + de la file de retry
  'sync:getActivity',
  // Liberer l'espace que plus rien ne reference. Inventaire par defaut ;
  // ne supprime que si l'ecran passe `execute`.
  'sync:gcProfile',
  // Reprise et mise a l'ecart d'un echec epuise, depuis le panneau d'activite.
  'sync:retryFailed',
  'sync:dismissFailed',
  // Session FEK handover (unlock → main memory, cleared on lock/quit)
  'sync:setSessionKey',
  'sync:clearSessionKey',
  // Collaboration temps réel : liste des notes en session vivante, poussée par
  // le renderer pour que la fusion des notes ne les écrase jamais
  'collab:setLiveNotes',
  // Downloads Watcher (OS-level folder watcher → automation)
  'downloads-watcher:get-config',
  'downloads-watcher:set-config',
  'downloads-watcher:delete-source',
  'downloads-watcher:get-status',
  'downloads-watcher:notify-import-success',
  'downloads-watcher:scan-now',
  // Hot Folders (multi-rule OS folder watcher → vault sync)
  'hot-folders:list',
  'hot-folders:get-statuses',
  'hot-folders:set-rules',
  'hot-folders:notify-import-success',
  'hot-folders:delete-source',
  'hot-folders:move-source',
  'hot-folders:pause-rule',
  'hot-folders:resume-rule',
  'hot-folders:scan-now',
  'hot-folders:clear-safety-pause',
  // Reminders: snooze action + open-at-login persistence + note reminders
  'snoozeReminder',
  'app:get-open-at-login',
  'app:set-open-at-login',
  'addReminderToNote',
  'updateReminderForNote',
  'deleteReminderFromNote',
  // E2EE Share — owner-side create/list/revoke + chunk upload + finalize + audit
  'share:create',
  'share:list',
  'share:revoke',
  'share:uploadChunk',
  'share:finalize',
  'share:listViews',
  'share:custodyKey',
  // Web Clipper (#9) — local bridge control + renderer save-result callback
  'clipper:getStatus',
  'clipper:generatePairingCode',
  'clipper:listClients',
  'clipper:removeClient',
  'clipper:setEnabled',
  'clipper:saveResult',
  // Hidden Vault (#6) — seed the decoy profile's wrapped key without activating it
  'hidden-vault:seedDecoy',
  // Desktop protection (Wave 1) — channel names are the renderer's
  // desktopProtectionBridge contract: temp purge, verified move (verify →
  // secure-delete original), global hotkeys, mini-mode window surface
  // (state/recents/protect/lock), macOS Touch ID gate
  'vault:purgeTemp',
  'file:secureDeleteOriginal',
  'file:moveIntoVault',
  'app:setGlobalHotkey',
  'auth:touchId',
  'miniMode:getState',
  'miniMode:getRecent',
  'miniMode:protectFiles',
  'miniMode:lockVault',
  'miniMode:hide',
  'miniMode:openMain',
  // Filarr Box (Wave 2) — ".filarr" protected containers ("protéger sur
  // place"): first-bytes inspect routing, protect with verify-before-delete,
  // open file/folder containers, entry extraction, unprotect, advisory
  // registry. Contract: src/services/features/filarrBoxBridge.ts.
  'filarrBox:inspect',
  'filarrBox:protect',
  'filarrBox:openFile',
  'filarrBox:openFolder',
  'filarrBox:extractEntry',
  'filarrBox:extractAll',
  'filarrBox:unprotect',
  'filarrBox:registryList',
  'filarrBox:registryRemove',
  'filarrBox:registryRelocate',
  'filarrBox:showInFolder',
]);

const ALLOWED_SEND_CHANNELS = new Set([
  'restart_app',
  'ondragstart',
  'redux-state-changed',
  'open-external',
  // Desktop protection (Wave 1) — renderer lock-state push (tray badge; the
  // only source of truth for local machine-key profiles)
  'vault:renderer-lock-state',
  /**
   * DIAGNOSTIC — une ligne du renderer vers le journal du processus principal.
   *
   * En production les outils de developpement sont REFERMES de force
   * (`main.ts`) : le renderer n'a donc aucun moyen de signaler une panne, et
   * un chargement rate n'y laisse aucune trace. Le journal du main, lui, est
   * un fichier que l'utilisateur sait retrouver et envoyer.
   *
   * Le main borne ce qu'il ecrit ; voir `reportToLog` pour la regle qui compte :
   * une portee et un message COMPOSES A LA MAIN, jamais une charge utile.
   */
  'diag:log',
  /**
   * ACCUSÉ DE PURGE À LA FERMETURE. Le main demande au renderer de vider son
   * auto-save en attente (debounce de 2 s) et ATTEND cette réponse avant de
   * lancer le dernier cycle de synchronisation. Sans elle, le main partirait
   * remonter un `notes.enc` qui ne porte pas encore la dernière frappe.
   * Ne transporte rien : c'est un « c'est écrit ».
   */
  'app:flush-notes:done',
]);

const ALLOWED_RECEIVE_CHANNELS = new Set([
  'foldersUpdated',
  'update_available',
  'update_downloaded',
  'update_download_progress',
  'upcomingReminders',
  'file-changed',
  'update-install-confirmed',
  'show-notification',
  'folders-updated',
  'files-updated',
  'notes-updated',
  /**
   * L'APPLICATION VA SE FERMER : écris ce que tu retiens, tout de suite.
   *
   * Le pendant de `app:flush-notes:done`. Le renderer répond sur ce dernier
   * canal une fois son auto-save vidé — puis le main remonte. Voir
   * `flushRendererNotes` (main.ts) et `flushBeforeQuit` (syncService).
   */
  'app:flush-notes',
  'profiles-updated',
  'main-process-error',
  // La fusion de la mise en page vient de réécrire `layout.enc` : le renderer
  // tient sa disposition en mémoire et doit la relire, sinon ce qui arrive du
  // nuage n'apparaîtrait qu'au prochain démarrage. Ne porte aucune donnée.
  'layout-updated',
  // La fusion des rappels vient de réécrire `noteReminders.json` ou
  // `calendarReminders.json` : la liste des rappels et les minuteurs du
  // planificateur doivent être relus, sinon ce qui arrive du nuage
  // n'apparaîtrait — et ne sonnerait — qu'au prochain démarrage. Aucune donnée.
  'reminders-updated',
  'sync-status-changed',
  'sync-conflict-detected',
  'sync-quota-exceeded',
  'sync-file-status-changed',
  'sync-trial-expired',
  'pairing-device-detected',
  'pairing-complete',
  'pairing-error',
  // Progression de « Publier ce coffre sur le compte » (compteurs + état).
  'publish:state-changed',
  // La bascule vient d'adopter la clé du compte côté process principal : le
  // renderer doit recharger la sienne DANS LA FOULÉE, sinon il continuerait de
  // sceller ses nouveaux fichiers sous l'ancienne clé. Ne porte aucune donnée.
  'publish:key-adopted',
  // v2 : le nombre de vérification à comparer à l'écran d'en face. Ne porte
  // que des chiffres destinés à être lus — jamais de clé, jamais de secret.
  'pairing-sas',
  'billing-tier-changed',
  'system-theme-changed',
  'auth-status-changed',
  'device-wipe-required', // E9-11: admin remote-wipe → renderer signs the ack + locks
  'downloads-watcher:file-detected',
  'downloads-watcher:status-changed',
  'hot-folders:file-event',
  'hot-folders:status-changed',
  'reminder-clicked',
  'reminder-fired',
  // V3 streaming import — byte-level progress from the main-process encrypt stream
  'file:importProgress',
  // Web Clipper (#9) — incoming clip to persist + pairing notification
  'clipper:save',
  'clipper:clientPaired',
  // Desktop protection (Wave 1) — main-initiated lock, mini-window refresh
  // signal, tray recent-file navigation, .filarr double-click delivery
  'vault:lock-request',
  'mini:refresh',
  'tray:open-recent',
  'filarr-file-opened',
  // Un .filarrlayout double-cliqué : SIGNAL seul (le contenu se réclame par
  // 'layouts:takePendingOpen'), pour n'avoir qu'une voie de lecture.
  'filarr-layout-opened',
  // Filarr Box (Wave 2) — byte-level progress during protect/open/extract
  'filarrBox:progress',
  // Wave 2b — Explorer right-click « Protéger avec Filarr »: coalesced
  // { paths: string[] } burst from main → opens ProtectInPlaceDialog
  'shell:protect-request',
  // Invitation reçue par filarr:// — le seul automatisme possible sur le bureau,
  // où le renderer charge app://filarr.app/index.html et n'a aucune URL à lire.
  // Charge utile déjà analysée et validée par le main (inviteProtocol.ts).
  'deep-link-invite',
]);

/**
 * IPC Renderer API exposed to the renderer process
 */
interface IpcRendererAPI {
  send: (channel: string, data: any) => void;
  on: (channel: string, func: (...args: any[]) => void) => () => void;
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  removeListener: (channel: string, func: (...args: any[]) => void) => void;
}

/**
 * Electron API exposed to the renderer process via context bridge
 */
export interface ElectronAPI {
  ipcRenderer: IpcRendererAPI;
  /**
   * Resolves the real OS path of a dropped/picked File object.
   * Electron 41 removed File.path — webUtils.getPathForFile is the only
   * sanctioned way for the renderer to learn it (V3 streaming import).
   */
  getPathForFile: (file: Parameters<typeof webUtils.getPathForFile>[0]) => string;
}

/**
 * Global Window type extension
 */
declare global {
  interface Window {
    electron: ElectronAPI;
    electronAPI: { getVersion: () => string };
  }
}

/**
 * Context Bridge - Exposes Electron API to renderer process securely
 * All channels are validated against allowlists.
 */
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: (channel: string, data: any): void => {
      if (!ALLOWED_SEND_CHANNELS.has(channel)) {
        throw new Error(`Blocked send on unauthorized channel: ${channel}`);
      }
      ipcRenderer.send(channel, data);
    },
    on: (channel: string, func: (...args: any[]) => void): (() => void) => {
      if (!ALLOWED_RECEIVE_CHANNELS.has(channel)) {
        throw new Error(`Blocked listener on unauthorized channel: ${channel}`);
      }
      const wrapper = (_event: IpcRendererEvent, ...args: unknown[]): void => func(...args);
      ipcRenderer.on(channel, wrapper);
      // contextBridge does NOT preserve function identity: each time a
      // function crosses the bridge a fresh proxy is created, so a later
      // removeListener(channel, func) can never match the wrapper registered
      // here. The returned unsubscribe closure keeps the real wrapper
      // reference in the preload world and is the only reliable detach —
      // required by per-transfer listeners (V3 import progress).
      return () => {
        ipcRenderer.removeListener(channel, wrapper);
      };
    },
    invoke: (channel: string, ...args: any[]): Promise<any> => {
      if (!ALLOWED_INVOKE_CHANNELS.has(channel)) {
        return Promise.reject(new Error(`Blocked invoke on unauthorized channel: ${channel}`));
      }
      return ipcRenderer.invoke(channel, ...args);
    },
    // Best-effort only: kept for API compatibility with existing callers.
    // Because of the proxy-identity limitation above this cannot match a
    // wrapper registered by on() — use the unsubscribe returned by on().
    removeListener: (channel: string, func: (...args: any[]) => void): void => {
      ipcRenderer.removeListener(channel, func);
    },
  },
  getPathForFile: (file: Parameters<typeof webUtils.getPathForFile>[0]): string =>
    webUtils.getPathForFile(file),
} as ElectronAPI);

// Expose app version synchronously (from package.json at build time)
contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.sendSync('get-app-version'),
});
