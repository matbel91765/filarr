/**
 * Classification web des canaux IPC desktop — table de routage du dispatcher (lot W1).
 *
 * Source de vérité : les allowlists de electron/preload.ts. Le test
 * src/platform/web/__tests__/channelRegistry.vitest.ts vérifie l'exhaustivité :
 * chaque canal allowlisté apparaît ici exactement une fois, et rien d'autre.
 *
 * État recensé (2026-08-12, branche feat/enterprise-e3-shared-vaults) :
 * 272 canaux invoke uniques (273 entrées, `snoozeReminder` dupliqué), 5 send,
 * 44 receive. L'audit de surface (dim-ipc-surface, base commit 9478740)
 * comptait 257/5/40 ; les 12 invoke et 3 receive supplémentaires sont
 * postérieurs : import streaming (53e4709, ×2), appairage v2 SAS (31d03c6,
 * ×2 + `pairing-sas`), publication de coffre (d8a8bb1, ×8 + 2 receive).
 *
 * Convention de lecture des cibles : 'storage' couvre le moteur local
 * navigateur au sens large — OPFS/IndexedDB, mais aussi les substituts
 * d'API navigateur exécutés localement (Notifications API, window.print,
 * location.reload, window.open) qui n'ont ni transport Worker ('api'),
 * ni custody ('crypto'), ni refus ('desktop').
 */

/** Cible d'un canal invoke côté web. */
export type WebChannelTarget =
  | 'api' // proxy vers le Worker : fetch direct (famille d)
  | 'storage' // OPFS/IndexedDB + substituts navigateur, palier M1-M3 (famille c)
  | 'crypto' // WebCrypto/IndexedDB custody, palier M1-M3 (famille b)
  | 'desktop'; // desktop-only : jamais porté, rejet ERR_CHANNEL_UNAVAILABLE (famille a)

export interface ChannelClass {
  target: WebChannelTarget;
  /** Palier du dossier avant-projet où le canal devient fonctionnel (absent pour 'desktop'). */
  palier?: 'M1' | 'M2' | 'M3' | 'M4';
}

export const INVOKE_CHANNELS: Record<string, ChannelClass> = {
  // ── config (2) ── MPW-C08, localStorage/IndexedDB
  getConfig: { target: 'storage', palier: 'M1' },
  saveConfig: { target: 'storage', palier: 'M1' },

  // ── dossiers — métadonnées (6) ── MPW-C01
  saveFolder: { target: 'storage', palier: 'M2' },
  getFolders: { target: 'storage', palier: 'M2' },
  getFolderItems: { target: 'storage', palier: 'M2' },
  getFolder: { target: 'storage', palier: 'M2' },
  updateFolder: { target: 'storage', palier: 'M2' },
  deleteFolder: { target: 'storage', palier: 'M2' },

  // ── éléments — métadonnées (8) ── MPW-C01
  addItemToFolder: { target: 'storage', palier: 'M2' },
  removeItemFromFolder: { target: 'storage', palier: 'M2' },
  updateItemInFolder: { target: 'storage', palier: 'M2' },
  // Effacement sûr du blob local + avis au manifeste de synchro main-side :
  // ni l'un ni l'autre n'existe sur le web (pas de coffre perso local).
  convertFileToVaultShortcut: { target: 'desktop' },
  getItem: { target: 'storage', palier: 'M2' },
  updateItem: { target: 'storage', palier: 'M2' },
  moveItem: { target: 'storage', palier: 'M2' },
  copyItem: { target: 'storage', palier: 'M2' },

  // ── fichiers — contenu et ouverture (17) ── MPW-C02 ; ouverture externe/temp/drag = MPW-A05/A06
  saveFile: { target: 'storage', palier: 'M2' },
  readFile: { target: 'storage', palier: 'M2' },
  deleteFile: { target: 'storage', palier: 'M2' },
  openFile: { target: 'desktop' }, // ouverture dans une app externe
  readEncryptedFile: { target: 'storage', palier: 'M2' },
  readEncryptedFileForCopy: { target: 'storage', palier: 'M2' },
  saveEncryptedFile: { target: 'storage', palier: 'M2' },
  saveEncryptedFileFromPath: { target: 'storage', palier: 'M2' }, // File.stream() remplace le chemin OS
  // Reclassés après le premier test réel : « ouvrir » sur web = Blob URL typée
  // dans un onglet (PDF/images en lecteur natif), pas d'app externe.
  openEncryptedFile: { target: 'storage', palier: 'M2' },
  renameItem: { target: 'storage', palier: 'M2' },
  readTempFile: { target: 'desktop' }, // aucun fichier temporaire en clair sur le web
  deleteTempFile: { target: 'desktop' },
  openVaultFile: { target: 'storage', palier: 'M2' },
  downloadItem: { target: 'storage', palier: 'M2' }, // téléchargement navigateur
  downloadMultipleAsZip: { target: 'storage', palier: 'M2' }, // zip en flux dans un worker
  writeRawFile: { target: 'storage', palier: 'M2' },
  prepareDragFile: { target: 'desktop' }, // drag-out natif vers l'OS

  // ── rappels (14) ── MPW-D07 : CRUD local IndexedDB dès M2, Web Push = M4
  addReminder: { target: 'storage', palier: 'M2' },
  updateReminder: { target: 'storage', palier: 'M2' },
  deleteReminder: { target: 'storage', palier: 'M2' },
  getAllReminders: { target: 'storage', palier: 'M2' },
  getReminders: { target: 'storage', palier: 'M2' },
  getReminder: { target: 'storage', palier: 'M2' },
  markReminderAsRead: { target: 'storage', palier: 'M2' },
  markReminderAsDone: { target: 'storage', palier: 'M2' },
  snoozeReminder: { target: 'storage', palier: 'M2' }, // dupliqué dans le preload — une seule entrée ici
  getNotificationSettings: { target: 'storage', palier: 'M2' },
  updateNotificationSettings: { target: 'storage', palier: 'M2' },
  addReminderToNote: { target: 'storage', palier: 'M2' },
  updateReminderForNote: { target: 'storage', palier: 'M2' },
  deleteReminderFromNote: { target: 'storage', palier: 'M2' },

  // ── dialogues natifs à chemins OS (2) ── retournent des chemins, inutilisables sur le web
  showSaveDialog: { target: 'desktop' },
  showOpenDialog: { target: 'desktop' },

  // ── quota de stockage (2) ── MPW-C04
  getStorageQuota: { target: 'storage', palier: 'M2' },
  updateStorageQuota: { target: 'storage', palier: 'M2' },

  // ── corbeille storage:* (7) ── MPW-C04
  'storage:getTrashItems': { target: 'storage', palier: 'M2' },
  'storage:restoreItem': { target: 'storage', palier: 'M2' },
  'storage:permanentlyDeleteItem': { target: 'storage', palier: 'M2' },
  'storage:emptyTrash': { target: 'storage', palier: 'M2' },
  'storage:autoCleanupTrash': { target: 'storage', palier: 'M2' },
  'storage:deleteFolder': { target: 'storage', palier: 'M2' },
  'storage:deleteFile': { target: 'storage', palier: 'M2' },

  // ── gestionnaire de mots de passe pm:* (6) ── MPW-G13, IndexedDB chiffré
  // Gestionnaire de mots de passe : jamais exposé dans l'UI (bridge extension
  // désactivé) — retiré du périmètre web sur décision fondateur (2026-08-13).
  'pm:saveDatabase': { target: 'desktop' },
  'pm:loadDatabase': { target: 'desktop' },
  'pm:deleteDatabase': { target: 'desktop' },
  'pm:exportToFile': { target: 'desktop' },
  'pm:importFromFile': { target: 'desktop' },
  'pm:copyToClipboard': { target: 'desktop' },

  // ── image d'une note : copier / enregistrer sous (2) ──
  //
  // 'desktop' n'est PAS un renoncement fonctionnel ici : le client web REND
  // ces deux gestes, mais sans jamais passer par le dispatcher. Le garde de
  // src/services/notes/noteImageClipboard.ts (`hasElectronBridge()` exige
  // `!isWebPlatform()`) fait partir le navigateur sur `navigator.clipboard
  // .write` d'un blob PNG, et sur un `<a download>` pour l'enregistrement.
  // Les classer 'desktop' dit donc la vérité du transport : ces canaux
  // n'ont pas de route web, parce qu'ils n'en ont pas besoin.
  'clipboard:writeImage': { target: 'desktop' },
  'notes:saveImageAs': { target: 'desktop' },

  // ── crypto argon2 (6) ── MPW-B01, hash-wasm en worker
  'crypto:argon2Hash': { target: 'crypto', palier: 'M1' },
  'crypto:argon2Verify': { target: 'crypto', palier: 'M1' },
  'crypto:argon2DeriveKey': { target: 'crypto', palier: 'M1' },
  // Dérivation BRUTE à profil explicite (KEK de la clé de garde). Sur le web,
  // c'est exactement ce que fait déjà `custody-crypto.ts` du site avec
  // `hash-wasm` : même famille, même palier.
  'crypto:argon2Raw': { target: 'crypto', palier: 'M1' },
  'crypto:hashPassword': { target: 'crypto', palier: 'M1' },
  'crypto:verifyPassword': { target: 'crypto', palier: 'M1' },

  // ── secureStore (2) ── MPW-G25, hashes de mots de passe fichier/dossier, IndexedDB chiffré
  'secureStore:getPasswordHashes': { target: 'crypto', palier: 'M2' },
  'secureStore:setPasswordHashes': { target: 'crypto', palier: 'M2' },

  // ── notifications (1) ── Notifications API au premier plan (MPW-D07)
  showDesktopNotification: { target: 'storage', palier: 'M2' },

  // ── export RGPD (1) ── MPW-C11, génération client + téléchargement
  'export:gdprData': { target: 'storage', palier: 'M2' },

  // ── byos (8) ── MPW-A08 : S3 direct bloqué par CORS, un proxy contredirait la promesse
  'byos:saveProvider': { target: 'desktop' },
  'byos:getProviders': { target: 'desktop' },
  'byos:deleteProvider': { target: 'desktop' },
  'byos:testConnection': { target: 'desktop' },
  'byos:upload': { target: 'desktop' },
  'byos:download': { target: 'desktop' },
  'byos:delete': { target: 'desktop' },
  'byos:list': { target: 'desktop' },

  // ── profils (10) ── MPW-C05 ; le PIN relève de la custody (argon2)
  'profile:getManifest': { target: 'storage', palier: 'M2' },
  'profile:create': { target: 'storage', palier: 'M2' },
  'profile:update': { target: 'storage', palier: 'M2' },
  'profile:delete': { target: 'storage', palier: 'M2' },
  'profile:activate': { target: 'storage', palier: 'M2' },
  'profile:reorder': { target: 'storage', palier: 'M2' },
  'profile:verifyPin': { target: 'crypto', palier: 'M2' },
  'profile:resetPin': { target: 'crypto', palier: 'M2' },
  'profile:fullReset': { target: 'storage', palier: 'M2' },
  'profile:unlinkCloud': { target: 'storage', palier: 'M2' },

  // ── notes (3) ── MPW-G30, pipeline chiffré re-routé, format inchangé.
  // `notes:saveDelta` est un protocole de TRANSPORT (les seules notes touchées),
  // pas un format : le blob écrit reste le coffre complet des deux côtés.
  'notes:save': { target: 'storage', palier: 'M2' },
  'notes:saveDelta': { target: 'storage', palier: 'M2' },
  'notes:load': { target: 'storage', palier: 'M2' },

  // ── mise en page modulaire (2) ── même pipeline chiffré que les notes.
  //
  // ÉTAT CÔTÉ WEB : la parité est FAITE. `installMetadata` a une branche
  // `meta:layout` qui déchiffre le conteneur avec la clé machine du manifeste
  // (le chemin déjà éprouvé de `notes.enc` — aucune seconde politique de clé),
  // fusionne au grain de la vue via `sync/layoutMerge.ts` et émet
  // `layout-updated`. La remontée est symétrique, sous les deux gardes des
  // notes (distant non fusionné ce cycle, ou empreinte divergente → différé).
  //
  // ⚠ NE PAS y remettre un `if (resourceId === 'layout') continue;` : cette
  // garde a existé le temps d'un chantier — sans branche de lecture, la boucle
  // installait le conteneur comme un DOSSIER fantôme de clé `undefined`. La
  // brancher aujourd'hui annulerait la lecture et rendrait la personnalisation
  // invisible sur app.filarr.com.
  //
  // Parité prouvée : `sync/__tests__/layoutMergeParity.vitest.ts` (le corps est
  // octet pour octet celui de `electron/sync/layoutMergeCore.ts`) et
  // `__tests__/layoutSyncCycle.vitest.ts` (cycle descente + remontée).
  'layout:load': { target: 'storage', palier: 'M3' },
  'layout:save': { target: 'storage', palier: 'M3' },

  // ── modèles de mise en page partageables (3) ──
  // Le fichier `.filarrlayout` est du texte, choisi et rendu par un dialogue
  // natif. Sur le web : `showSaveFilePicker` / `showOpenFilePicker` (ou, à
  // défaut, un <a download> et un <input type=file>) — aucune règle métier n'y
  // vit, la validation est déjà partagée (services/layouts/layoutValidator.ts).
  // `takePendingOpen` n'existe pas là-bas : rien ne double-clique un fichier
  // dans un onglet.
  'layouts:exportFile': { target: 'storage', palier: 'M2' },
  'layouts:importFile': { target: 'storage', palier: 'M2' },
  'layouts:takePendingOpen': { target: 'desktop' },

  // ── versions de notes (4) ── MPW-G30
  'note-versions:list': { target: 'storage', palier: 'M2' },
  'note-versions:get': { target: 'storage', palier: 'M2' },
  'note-versions:delete': { target: 'storage', palier: 'M2' },
  'note-versions:clear': { target: 'storage', palier: 'M2' },

  // ── versions de FICHIERS (5) ──
  // Même palier que les versions de notes : ce sont des instantanés chiffrés
  // sous la FEK, donc du stockage, jamais du bureau.
  'file-versions:snapshot': { target: 'storage', palier: 'M2' },
  'file-versions:list': { target: 'storage', palier: 'M2' },
  'file-versions:content': { target: 'storage', palier: 'M2' },
  'file-versions:delete': { target: 'storage', palier: 'M2' },
  'file-versions:clear': { target: 'storage', palier: 'M2' },

  // ── dialogue générique (1) ── retourne le CONTENU (pas seulement un chemin) → showOpenFilePicker
  'dialog:openFile': { target: 'storage', palier: 'M2' },

  // ── import Obsidian/Notion (6) ── MPW-G31, showDirectoryPicker + replis
  'import:selectDirectory': { target: 'storage', palier: 'M2' },
  'import:selectFile': { target: 'storage', palier: 'M2' },
  'import:readDirectory': { target: 'storage', palier: 'M2' },
  'import:readFile': { target: 'storage', palier: 'M2' },
  'import:listFiles': { target: 'storage', palier: 'M2' },
  'import:readBatch': { target: 'storage', palier: 'M2' },

  // ── métadonnées de page (2) ── MPW-A09 : proxy Worker OPT-IN livré (QW-13, metaHandlers)
  fetchPageTitle: { target: 'api', palier: 'M2' },
  fetchPageMetadata: { target: 'api', palier: 'M2' },

  // ── connecteurs de bases inline (1) ── POST /meta/lookup, même opt-in (metaHandlers)
  'connectors:lookup': { target: 'api', palier: 'M2' },

  // ── hybrid (19) ── MPW-G04 : cache blob → OPFS M3 ; custody → M1 ; moitiés cloud → fetch M1
  'hybrid:renameBlob': { target: 'storage', palier: 'M2' },
  'hybrid:writeRawBlob': { target: 'storage', palier: 'M3' },
  'hybrid:readRawBlob': { target: 'storage', palier: 'M3' },
  'hybrid:fileExists': { target: 'storage', palier: 'M3' },
  'hybrid:computeChecksum': { target: 'storage', palier: 'M3' },
  'hybrid:deleteBlob': { target: 'storage', palier: 'M3' },
  'hybrid:saveFromPath': { target: 'crypto', palier: 'M2' }, // flux V3 : File.stream() + TransformStream AES-GCM (MPW-B05)
  'hybrid:isV3Blob': { target: 'storage', palier: 'M3' }, // simple sonde de format sur le cache
  'hybrid:readDecryptedV3': { target: 'crypto', palier: 'M2' }, // flux V3 déchiffré (MPW-B05)
  'hybrid:saveWrappedKey': { target: 'crypto', palier: 'M1' },
  // Le rattachement d'un profil à un compte : famille crypto, parce que c'est
  // une clé qui change de propriétaire — pas un réglage de profil.
  'profiles:attachToAccount': { target: 'crypto', palier: 'M1' },
  'hybrid:loadWrappedKey': { target: 'crypto', palier: 'M1' },
  'hybrid:pushWrappedKeyToCloud': { target: 'api', palier: 'M1' },
  'hybrid:fetchWrappedKeyFromCloud': { target: 'api', palier: 'M1' },
  'hybrid:storeFEK': { target: 'crypto', palier: 'M1' },
  'hybrid:loadFEK': { target: 'crypto', palier: 'M1' },
  'hybrid:clearFEK': { target: 'crypto', palier: 'M1' },
  'hybrid:hasKey': { target: 'crypto', palier: 'M1' },
  'hybrid:storeDeviceKey': { target: 'crypto', palier: 'M1' },
  'hybrid:loadDeviceKey': { target: 'crypto', palier: 'M1' },
  'hybrid:clearDeviceKey': { target: 'crypto', palier: 'M1' },

  // ── lectures par plages stream:* (2) ── MPW-G23 : plages HTTP (M2) puis OPFS (M3)
  'stream:getSize': { target: 'storage', palier: 'M2' },
  'stream:readRange': { target: 'storage', palier: 'M2' },

  // ── keypair (4) ── MPW-G22 : local = custody, cloud = fetch
  'keypair:saveLocal': { target: 'crypto', palier: 'M1' },
  'keypair:loadLocal': { target: 'crypto', palier: 'M1' },
  'keypair:pushToCloud': { target: 'api', palier: 'M1' },
  'keypair:fetchFromCloud': { target: 'api', palier: 'M1' },

  // ── export/import de coffre + file:* associés (6) ── MPW-C09 ; chemins OS et shell = ABSENT
  'vault:exportZip': { target: 'storage', palier: 'M2' },
  'vault:selectImportFile': { target: 'storage', palier: 'M2' },
  'vault:importZip': { target: 'storage', palier: 'M2' },
  'file:readForExport': { target: 'storage', palier: 'M2' },
  'file:getLocalPath': { target: 'desktop' }, // retourne un chemin OS — n'existe pas sur le web
  'file:showInFolder': { target: 'desktop' },

  // ── flags persistants (3) ── MPW-C08
  'flag:get': { target: 'storage', palier: 'M1' },
  'flag:set': { target: 'storage', palier: 'M1' },
  'flag:remove': { target: 'storage', palier: 'M1' },

  // ── canal mort (1) ── allowlisté mais aucun handler ipcMain nulle part — rien à porter
  'redux-state-changed': { target: 'desktop' },

  // ── impression (1) ── window.print()/téléchargement du PDF de codes de récupération
  'pdf:printRecoveryCodes': { target: 'storage', palier: 'M1' },

  // ── auth (28) ── MPW-G02 : fetch direct ; touchId ABSENT (WebAuthn UV le remplace, DW-02)
  'auth:login': { target: 'api', palier: 'M1' },
  'auth:register': { target: 'api', palier: 'M1' },
  'auth:logout': { target: 'api', palier: 'M1' },
  'auth:getStatus': { target: 'api', palier: 'M1' },
  'auth:getAccessToken': { target: 'api', palier: 'M1' },
  'auth:recoverPhraseVerify': { target: 'api', palier: 'M1' },
  'auth:recoverComplete': { target: 'api', palier: 'M1' },
  'auth:verifyEmail': { target: 'api', palier: 'M1' },
  'auth:getMe': { target: 'api', palier: 'M1' },
  'auth:getDevices': { target: 'api', palier: 'M1' },
  'auth:deleteDevice': { target: 'api', palier: 'M1' },
  'auth:revokeDormantDevices': { target: 'api', palier: 'M1' },
  'auth:deleteAccountData': { target: 'api', palier: 'M1' },
  'auth:deleteAccount': { target: 'api', palier: 'M1' },
  'auth:changePassword': { target: 'api', palier: 'M1' },
  'auth:completeMFALogin': { target: 'api', palier: 'M1' },
  // SSO (E5-1) : la session revient par une boucle locale (RFC 8252) que seul un
  // processus natif peut tenir — bureau seulement, et l'écran ne le propose pas sur le web.
  'auth:ssoResolve': { target: 'desktop', palier: 'M4' },
  'auth:ssoLogin': { target: 'desktop', palier: 'M4' },
  'auth:ssoCancel': { target: 'desktop', palier: 'M4' },
  'auth:cancelMFALogin': { target: 'api', palier: 'M1' },
  'auth:mfaEnrollSetup': { target: 'api', palier: 'M1' },
  'auth:mfaEnrollVerify': { target: 'api', palier: 'M1' },
  'auth:get2FAStatus': { target: 'api', palier: 'M1' },
  'auth:setup2FA': { target: 'api', palier: 'M1' },
  'auth:verifySetup2FA': { target: 'api', palier: 'M1' },
  'auth:disable2FA': { target: 'api', palier: 'M1' },
  'auth:regenerateBackupCodes': { target: 'api', palier: 'M1' },
  'auth:regenerateRecoveryPhrase': { target: 'api', palier: 'M1' },
  'auth:touchId': { target: 'desktop' }, // macOS Touch ID — WebAuthn UV est le substitut, pas un portage
  /**
   * Zone d'attente d'« ajouter un compte cloud » — desktop-only PAR NATURE.
   *
   * Elle n'existe que parce qu'un profil de bureau est un domaine
   * d'authentification sur disque : se connecter avant d'en choisir un oblige à
   * ranger les jetons quelque part de neutre. Le navigateur n'a qu'UNE session,
   * portée à l'onglet : il n'y a rien à mettre en attente ni à déménager.
   */
  // Le « royaume en attente » de « + Ajouter un compte » existe aussi sur le
  // web (authHandlers) : la session y est celle du navigateur, mais l'estampille
  // et la clé de coffre sont celles d'un profil — le profil resté actif ne doit
  // pas les recevoir au nom du compte qu'on ajoute.
  'auth:beginPendingSession': { target: 'api', palier: 'M3' },
  'auth:discardPendingSession': { target: 'api', palier: 'M3' },
  'auth:pendingSessionStatus': { target: 'api', palier: 'M3' },

  // ── org (19) ── MPW-G03 : fetch direct M4 (gate QW-07) ; cache de policy = IndexedDB
  // Les quatre premiers sont servis (handlers/orgHandlers.ts) : sans `org:list`,
  // la liste des espaces reste vide sur le web et un coffre partagé par autrui
  // n'apparaît jamais, invitation acceptée ou non.
  'org:list': { target: 'api', palier: 'M1' },
  'org:setCurrent': { target: 'api', palier: 'M1' },
  'org:getCurrent': { target: 'api', palier: 'M1' },
  'org:create': { target: 'api', palier: 'M4' },
  'org:acceptInvitation': { target: 'api', palier: 'M1' },
  'org:policy:save': { target: 'storage', palier: 'M4' }, // cache offline local (E9-10) → IndexedDB
  'org:policy:load': { target: 'storage', palier: 'M4' },
  'org:policy:clear': { target: 'storage', palier: 'M4' },
  'org:members:list': { target: 'api', palier: 'M4' },
  'org:members:updateRole': { target: 'api', palier: 'M4' },
  'org:members:remove': { target: 'api', palier: 'M4' },
  'org:invitations:list': { target: 'api', palier: 'M4' },
  'org:invitations:create': { target: 'api', palier: 'M4' },
  'org:invitations:revoke': { target: 'api', palier: 'M4' },
  'org:billing:status': { target: 'api', palier: 'M4' },
  'org:billing:checkout': { target: 'api', palier: 'M4' },
  'org:billing:portal': { target: 'api', palier: 'M4' },
  // Ajoute par `9aee479c` (une organisation pleine pouvait ne plus jamais
  // grandir) sans passer par cette table : le verrou d'exhaustivite l'a
  // rattrape. Meme nature que ses trois voisins — un appel d'API pur.
  'org:billing:seats': { target: 'api', palier: 'M4' },
  // Le format du coffre de notes est une affaire de DISQUE : le web range ses
  // notes dans IndexedDB et ne connait pas `notes.enc`. Les deux canaux n'ont
  // donc pas d'objet ici — l'ecran qui les utilise est celui du bureau.
  'notes:vaultFormat': { target: 'desktop' },
  'notes:migrateV2': { target: 'desktop' },
  'org:update': { target: 'api', palier: 'M4' },
  'org:delete': { target: 'api', palier: 'M4' },
  'org:restore': { target: 'api', palier: 'M4' },

  // ── espace de travail (2) ── MPW-G19
  'space:get': { target: 'api', palier: 'M1' },
  'space:set': { target: 'api', palier: 'M1' },

  // ── appairage (6) ── MPW-G18 : cloud-médié, crypto ECDH/HKDF déjà WebCrypto
  'pairing:initiate': { target: 'api', palier: 'M2' },
  'pairing:join': { target: 'api', palier: 'M2' },
  'pairing:cancel': { target: 'api', palier: 'M2' },
  'pairing:getCode': { target: 'api', palier: 'M2' },
  'pairing:confirmSas': { target: 'api', palier: 'M2' },
  'pairing:rejectSas': { target: 'api', palier: 'M2' },

  // ── publication de coffre (8) ── migration d'un coffre LOCAL à clé machine vers le compte :
  // l'état de départ (profil safeStorage, journal disque, clés retirées) n'existe pas sur le
  // web — les profils à clé machine y sont invisibles par construction (MPW-G05)
  'publish:getState': { target: 'desktop' },
  'publish:buildInventory': { target: 'desktop' },
  'publish:start': { target: 'desktop' },
  'publish:pause': { target: 'desktop' },
  'publish:retry': { target: 'desktop' },
  'publish:commitSwitch': { target: 'desktop' },
  'publish:abandon': { target: 'desktop' },
  'publish:getRetiredKeys': { target: 'desktop' },

  // ── facturation (2) ── MPW-G20 : navigation Stripe, allowlist de redirection prête
  'billing:checkout': { target: 'api', palier: 'M1' },
  'billing:portal': { target: 'api', palier: 'M1' },

  // ── sécurité (5) ── MPW-G11/B03 : WebCrypto + fichiers
  'security:getEnhancedLock': { target: 'crypto', palier: 'M1' },
  'security:setEnhancedLock': { target: 'crypto', palier: 'M1' },
  'security:exportRecoveryKey': { target: 'crypto', palier: 'M1' },
  'security:previewRecoveryKey': { target: 'crypto', palier: 'M1' },
  'security:importRecoveryKey': { target: 'crypto', palier: 'M1' },

  // ── sync (9) ── MPW-G08 : contrôles → moteur in-renderer M3 ; FEK de session → worker crypto M1
  'sync:getStatus': { target: 'storage', palier: 'M3' },
  'sync:triggerSync': { target: 'storage', palier: 'M3' },
  'sync:getCloudProfiles': { target: 'api', palier: 'M2' }, // pur appel serveur (liste des profils cloud)
  // Ramène les profils du compte : appel serveur + écriture du manifeste local.
  'sync:restoreCloudProfiles': { target: 'api', palier: 'M2' },
  // Retire un profil du nuage : ligne D1 + octets R2.
  'sync:deleteCloudProfile': { target: 'api', palier: 'M2' },
  'sync:resolveConflict': { target: 'storage', palier: 'M3' },
  'sync:getConflicts': { target: 'storage', palier: 'M3' },
  'sync:getAllFileStatuses': { target: 'storage', palier: 'M3' },
  'sync:setEnabled': { target: 'storage', palier: 'M3' },
  // Activité de sync : lecture du manifeste caché + des remontées en attente.
  // Le nettoyage des orphelins parle au worker par le manifeste LOCAL, que
  // le web ne tient pas : geste de bureau.
  'sync:gcProfile': { target: 'desktop' },
  'sync:getActivity': { target: 'storage', palier: 'M3' },
  /**
   * Reprise et mise a l'ecart d'un echec de synchronisation : DESKTOP-ONLY par
   * nature. Ils agissent sur la file de retry persistante, qui est un objet du
   * processus principal ; le web n'en a pas — il reessaie au cycle suivant sans
   * rien garder, et son `sync:getActivity` rend `failed: []`. Aucun bouton ne
   * peut donc apparaitre la-bas, et un rejet franc vaut mieux qu'un faux
   * succes sur une file inexistante.
   */
  'sync:retryFailed': { target: 'desktop' },
  'sync:dismissFailed': { target: 'desktop' },
  'sync:setSessionKey': { target: 'crypto', palier: 'M1' },
  'sync:clearSessionKey': { target: 'crypto', palier: 'M1' },

  // ── collaboration temps réel (1) ── la liste des notes en session vivante.
  // Sur le web, la fusion tourne DANS le renderer et interroge directement le
  // registre (liveNoteRegistry) : ce canal n'a personne à prévenir, il est donc
  // absorbé localement par le moteur de stockage.
  'collab:setLiveNotes': { target: 'storage', palier: 'M3' },

  // ── downloads-watcher (6) ── MPW-A01 : watcher OS, exécution app fermée
  'downloads-watcher:get-config': { target: 'desktop' },
  'downloads-watcher:set-config': { target: 'desktop' },
  'downloads-watcher:delete-source': { target: 'desktop' },
  'downloads-watcher:get-status': { target: 'desktop' },
  'downloads-watcher:notify-import-success': { target: 'desktop' },
  'downloads-watcher:scan-now': { target: 'desktop' },

  // ── hot-folders (10) ── MPW-A01
  'hot-folders:list': { target: 'desktop' },
  'hot-folders:get-statuses': { target: 'desktop' },
  'hot-folders:set-rules': { target: 'desktop' },
  'hot-folders:notify-import-success': { target: 'desktop' },
  'hot-folders:delete-source': { target: 'desktop' },
  'hot-folders:move-source': { target: 'desktop' },
  'hot-folders:pause-rule': { target: 'desktop' },
  'hot-folders:resume-rule': { target: 'desktop' },
  'hot-folders:scan-now': { target: 'desktop' },
  'hot-folders:clear-safety-pause': { target: 'desktop' },

  // ── app (3) ── MPW-G29 : hotkey global OS, lancement à l'ouverture de session
  'app:get-open-at-login': { target: 'desktop' },
  'app:set-open-at-login': { target: 'desktop' },
  'app:setGlobalHotkey': { target: 'desktop' },

  // ── partage E2EE (7) ── MPW-G12 : crypto déjà WebCrypto, transport re-routé
  'share:create': { target: 'api', palier: 'M2' },
  'share:list': { target: 'api', palier: 'M2' },
  'share:revoke': { target: 'api', palier: 'M2' },
  'share:uploadChunk': { target: 'api', palier: 'M2' },
  'share:finalize': { target: 'api', palier: 'M2' },
  'share:listViews': { target: 'api', palier: 'M2' },
  'share:custodyKey': { target: 'api', palier: 'M2' },

  // ── clé de garde du compte (7) ── D3 : lecture et renommage des libellés
  // scellés des partages, des deux origines (compte et application).
  //
  // Les trois premiers sont du transport pur : le renderer scelle et déscelle,
  // le pont ne fait que porter le jeton. Sur le web, ce sont des `fetch`.
  'custody:key': { target: 'api', palier: 'M2' },
  'custody:shareLabels': { target: 'api', palier: 'M2' },
  'custody:setLabel': { target: 'api', palier: 'M2' },
  // Les quatre derniers sont la mémoire OPTIONNELLE de la privée déverrouillée.
  // Sur le bureau elle passe par `safeStorage` ; sur le web, l'équivalent existe
  // déjà et s'appelle `lib/dashboard/vault-session.ts` (clé AES non
  // extractible en IndexedDB) — d'où 'crypto', la famille de la custody de clés.
  'custody:remember': { target: 'crypto', palier: 'M2' },
  'custody:recall': { target: 'crypto', palier: 'M2' },
  'custody:rememberStatus': { target: 'crypto', palier: 'M2' },
  'custody:forget': { target: 'crypto', palier: 'M2' },

  // ── clipper (6) ── MPW-A07 : pont WebSocket localhost impossible depuis une page
  'clipper:getStatus': { target: 'desktop' },
  'clipper:generatePairingCode': { target: 'desktop' },
  'clipper:listClients': { target: 'desktop' },
  'clipper:removeClient': { target: 'desktop' },
  'clipper:setEnabled': { target: 'desktop' },
  'clipper:saveResult': { target: 'desktop' },

  // ── coffre caché (1) ── MPW-G26 : même pipeline crypto
  'hidden-vault:seedDecoy': { target: 'crypto', palier: 'M3' },

  // ── protection desktop Wave 1 (3) ── MPW-A03 : destruction vérifiée du clair, inapplicable
  'vault:purgeTemp': { target: 'desktop' },
  'file:secureDeleteOriginal': { target: 'desktop' },
  'file:moveIntoVault': { target: 'desktop' },

  // ── miniMode (6) ── MPW-G14 : fenêtre always-on-top
  'miniMode:getState': { target: 'desktop' },
  'miniMode:getRecent': { target: 'desktop' },
  'miniMode:protectFiles': { target: 'desktop' },
  'miniMode:lockVault': { target: 'desktop' },
  'miniMode:hide': { target: 'desktop' },
  'miniMode:openMain': { target: 'desktop' },

  // ── filarrBox (11) ── MPW-G06 : conteneurs .filarr sur chemins OS + shell Explorer
  'filarrBox:inspect': { target: 'desktop' },
  'filarrBox:protect': { target: 'desktop' },
  'filarrBox:openFile': { target: 'desktop' },
  'filarrBox:openFolder': { target: 'desktop' },
  'filarrBox:extractEntry': { target: 'desktop' },
  'filarrBox:extractAll': { target: 'desktop' },
  'filarrBox:unprotect': { target: 'desktop' },
  'filarrBox:registryList': { target: 'desktop' },
  'filarrBox:registryRemove': { target: 'desktop' },
  'filarrBox:registryRelocate': { target: 'desktop' },
  'filarrBox:showInFolder': { target: 'desktop' },
  // Le web n'a rien a mettre a jour : app.filarr.com sert toujours le dernier build.
  'app:checkForUpdates': { target: 'desktop' },
};

// ── send (5) ── §6 de la matrice 09
export const SEND_CHANNELS: Record<string, ChannelClass> = {
  restart_app: { target: 'storage', palier: 'M1' }, // location.reload() (mise à jour SW)
  ondragstart: { target: 'desktop' }, // drag-out natif (MPW-A06)
  'redux-state-changed': { target: 'desktop' }, // canal mort, aucun handler main
  'open-external': { target: 'storage', palier: 'M1' }, // window.open + rel=noopener
  'vault:renderer-lock-state': { target: 'desktop' }, // alimentait le badge de tray — sans consommateur web
  // Diagnostic : une ligne du renderer vers le journal du main. Sans objet
  // sur le web, ou la console existe -- `reportToLog` sort avant d'appeler.
  'diag:log': { target: 'desktop' },
  /**
   * Accuse la purge d'auto-save demandee par le main AVANT de quitter. Sans
   * objet sur le web : rien n'y « quitte » au sens d'un processus, et le
   * `beforeunload` d'App.tsx couvre deja la fermeture d'un onglet. Le renderer
   * ne l'emet que s'il a recu `app:flush-notes`, que le web n'emet jamais.
   */
  'app:flush-notes:done': { target: 'desktop' },
};

// ── receive (44) ── classification ETW-1035 (24 moteur local / 2 polling / 15 absents)
// + les 3 canaux post-audit : pairing-sas (local), publish:* (absents, flux desktop-only)
export const RECEIVE_CHANNELS: Record<string, { source: 'local' | 'poll' | 'absent' }> = {
  // moteur local (25) — émis par le moteur web dans la page (sync, stockage, rappels, auth, appairage)
  foldersUpdated: { source: 'local' },
  'folders-updated': { source: 'local' },
  'files-updated': { source: 'local' },
  'notes-updated': { source: 'local' },
  'layout-updated': { source: 'local' },
  // La fusion des rappels vient de réécrire `noteReminders.json` ou
  // `calendarReminders.json` : la liste et les minuteurs doivent être relus.
  // Le moteur web l'émet comme le processus principal — même cycle, même
  // fusion (`reminderMetaDoc`), donc `local`.
  'reminders-updated': { source: 'local' },
  'profiles-updated': { source: 'local' },
  'file-changed': { source: 'local' },
  'sync-status-changed': { source: 'local' },
  'sync-conflict-detected': { source: 'local' },
  'sync-quota-exceeded': { source: 'local' },
  'sync-file-status-changed': { source: 'local' },
  'sync-trial-expired': { source: 'local' },
  'file:importProgress': { source: 'local' },
  'show-notification': { source: 'local' },
  'main-process-error': { source: 'local' },
  upcomingReminders: { source: 'local' },
  'reminder-fired': { source: 'local' },
  'reminder-clicked': { source: 'local' },
  'auth-status-changed': { source: 'local' },
  'system-theme-changed': { source: 'local' }, // matchMedia('prefers-color-scheme')
  'pairing-device-detected': { source: 'local' },
  'pairing-complete': { source: 'local' },
  'pairing-error': { source: 'local' },
  'pairing-sas': { source: 'local' }, // chiffres SAS issus de la cérémonie ECDH locale (post-audit)
  'vault:lock-request': { source: 'local' }, // minuterie d'auto-lock + propagation inter-onglets

  // polling API (2) — dérivés du poll serveur / refresh de jeton (ETW-1037)
  'billing-tier-changed': { source: 'poll' },
  'device-wipe-required': { source: 'poll' },

  // absents (17) — jamais émis sur le web (auto-update, watchers OS, ponts localhost, tray/shell)
  /**
   * « L'application va se fermer, ecris ce que tu retiens. » Emis par le
   * processus principal uniquement : sur le web, la fermeture d'un onglet passe
   * par `beforeunload`, qui purge deja la file sans aller-retour IPC.
   */
  'app:flush-notes': { source: 'absent' },
  update_available: { source: 'absent' },
  update_downloaded: { source: 'absent' },
  update_download_progress: { source: 'absent' },
  'update-install-confirmed': { source: 'absent' },
  'downloads-watcher:file-detected': { source: 'absent' },
  'downloads-watcher:status-changed': { source: 'absent' },
  'hot-folders:file-event': { source: 'absent' },
  'hot-folders:status-changed': { source: 'absent' },
  'clipper:save': { source: 'absent' },
  'clipper:clientPaired': { source: 'absent' },
  'mini:refresh': { source: 'absent' },
  'tray:open-recent': { source: 'absent' },
  'filarr-file-opened': { source: 'absent' },
  // Un onglet ne reçoit pas de double-clic depuis l'explorateur de fichiers.
  'filarr-layout-opened': { source: 'absent' },
  'filarrBox:progress': { source: 'absent' },
  'shell:protect-request': { source: 'absent' },
  // Le lien profond n'existe que sur le bureau : sur le web, l'URL est captée
  // directement au chargement (services/invites/pendingInvite.ts).
  'deep-link-invite': { source: 'absent' },
  'publish:state-changed': { source: 'absent' }, // progression de la publication de coffre (desktop-only, post-audit)
  'publish:key-adopted': { source: 'absent' }, // adoption de clé côté main (desktop-only, post-audit)
};

/**
 * Invariants d'exhaustivité, vérifiés par le test du registre contre le preload.
 * NOTE : l'audit dim-ipc-surface comptait 257/5/40 ; le preload courant en est à
 * 273/5/44 (import streaming ×2, appairage v2 ×2+1, publication de coffre ×8+2,
 * connecteurs de bases inline ×1, notes en session vivante ×1, lien profond
 * d'invitation ×1, profils du nuage ×2 : restauration et suppression,
 * activité de sync ×1, sauvegarde incrémentale des notes ×1, mise en page
 * modulaire ×2 invoke + ×1 receive, modèles de mise en page partageables
 * ×3 invoke + ×1 receive, image d'une note ×2 : `clipboard:writeImage` et
 * `notes:saveImageAs`, raccourci vers le coffre ×1 :
 * `convertFileToVaultShortcut`).
 */
/**
 * Compte attendu de chaque allowlist du preload. Volontairement figé : un canal
 * ajouté sans passer par ici fait ÉCHOUER le verrou d'exhaustivité, ce qui est
 * exactement son rôle (voir channelRegistry.vitest.ts).
 *
 * +1 send / +1 receive le 2026-09-02 : `app:flush-notes` et son accusé
 * `app:flush-notes:done`, la purge d'auto-save demandée avant de quitter.
 *
 * +8 invoke le 2026-09-03 (D3, libellés scellés des partages) :
 * `crypto:argon2Raw` et les sept canaux `custody:*`.
 *
 * +1 invoke le 2026-09-03 : `app:checkForUpdates`, la verification a la demande
 * (bureau seulement).
 */
export const EXPECTED_COUNTS = { invoke: 314, send: 7, receive: 48 } as const;
