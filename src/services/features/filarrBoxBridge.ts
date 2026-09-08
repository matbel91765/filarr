/**
 * FilarrBox Bridge (Wave 2 « Protéger sur place ») — côté renderer.
 *
 * Point UNIQUE du contrat IPC renderer ↔ main pour les conteneurs `.filarr`
 * protégés (format « FilarrBox » : en-tête magique + métadonnées chiffrées +
 * charge utile V3). Le main process (electron/main.ts + electron/filarrBox.ts)
 * implémente ces canaux en se référant à CE fichier — ne pas renommer un
 * canal sans mettre à jour les deux côtés + les allowlists preload.ts.
 *
 * Canaux du contrat :
 *   invoke  : 'filarrBox:inspect'        (path) → InspectResult — lit les
 *             premiers octets : magic FILARRBOX → type 'box' (+ méta si
 *             déverrouillé) ; '{' JSON → type 'note' (avec le texte du
 *             fichier pour l'import) ; sinon type 'unknown'.
 *   invoke  : 'filarrBox:protect'        ({ paths, destDir?, deleteOriginals })
 *             → { results: ProtectItemResult[] } — jamais de throw pour les
 *             échecs attendus : chaque item porte sa raison en français.
 *   invoke  : 'filarrBox:openFile'       (boxPath) → { name } — déchiffre
 *             vers une copie temporaire suivie (tempFileRegistry) et l'ouvre ;
 *             les enregistrements sont réécrits dans le conteneur (watcher).
 *   invoke  : 'filarrBox:openFolder'     (boxPath) → BoxFolderListing —
 *             index tar SANS matérialiser les données.
 *   invoke  : 'filarrBox:extractEntry'   (boxPath, entryPath, { mode }) —
 *             mode 'open' : temp suivi + ouverture (LECTURE SEULE) ;
 *             mode 'saveAs' : dialogue d'enregistrement côté main.
 *   invoke  : 'filarrBox:extractAll'     (boxPath) → { destDir?, canceled? } —
 *             sélecteur de dossier côté main puis reconstruction de l'arbre.
 *   invoke  : 'filarrBox:unprotect'      (boxPath) → { restoredPath } —
 *             déchiffre à côté du conteneur, VÉRIFIE, puis supprime le .filarr.
 *   invoke  : 'filarrBox:registryList'   () → RegistryEntry[] (+ exists par
 *             entrée) ; indisponible coffre verrouillé.
 *   invoke  : 'filarrBox:registryRemove' (id)
 *   invoke  : 'filarrBox:registryRelocate' (id, newPath) → RegistryEntry
 *   invoke  : 'filarrBox:showInFolder'   (boxPath) — shell.showItemInFolder
 *             sur le conteneur (chemin OS réel, pas un blob du coffre).
 *   receive : 'filarrBox:progress'       → { boxPath?, phase, processed,
 *             total } — progression du chiffrement/déchiffrement.
 *
 * TOUS les appels sont défensifs : si le main/preload n'expose pas encore un
 * canal, l'appel échoue proprement avec `{ ok: false, unavailable: true }` —
 * la UI reste honnête (« fonction indisponible ») sans rien casser.
 */

// ==================== Types du contrat ====================

/** Résultat commun — `unavailable` = canal non exposé (main pas à jour). */
export interface BoxBridgeResult<T = undefined> {
  ok: boolean;
  unavailable?: boolean;
  error?: string;
  data?: T;
}

/** 0 = fichier unique, 1 = dossier (charge utile tar). */
export type BoxKind = 0 | 1;

/** Métadonnées déchiffrées d'un conteneur (bloc chiffré de l'en-tête). */
export interface BoxMeta {
  name: string;
  size: number;
  createdAt: string;
  entryCount?: number;
}

/** Résultat de l'inspection des premiers octets d'un .filarr. */
export type BoxInspectResult =
  | { type: 'box'; locked: true; kind: BoxKind }
  | ({ type: 'box'; locked?: false; kind: BoxKind } & BoxMeta)
  | { type: 'note'; content?: string }
  | { type: 'unknown' };

/** Entrée de l'index tar d'un conteneur dossier (jamais de données ici). */
export interface BoxEntry {
  path: string;
  size: number;
  isDir: boolean;
}

export interface BoxFolderListing {
  meta: BoxMeta;
  entries: BoxEntry[];
}

/** Résultat par élément d'une protection sur place. */
export interface ProtectItemResult {
  sourcePath: string;
  ok: boolean;
  /** Chemin du conteneur .filarr écrit (si ok). */
  boxPath?: string;
  kind?: BoxKind;
  /** Raison française de l'échec (original TOUJOURS conservé). */
  error?: string;
  /** Avertissement non bloquant (ex. original conservé car ouvert ailleurs). */
  warning?: string;
  /** Liens symboliques ignorés dans un dossier (jamais suivis). */
  skippedSymlinks?: number;
  /** true = l'original a bien été supprimé après vérification. */
  originalDeleted?: boolean;
}

export interface ProtectArgs {
  paths: string[];
  /** Dossier de destination ; absent = à côté de chaque original. */
  destDir?: string;
  /** Supprimer les originaux APRÈS vérification d'intégrité. */
  deleteOriginals: boolean;
}

/** Entrée du registre « Mes fichiers protégés » (advisory-only). */
export interface ProtectedRegistryEntry {
  id: string;
  boxPath: string;
  kind: BoxKind;
  name: string;
  size: number;
  createdAt: string;
  lastOpenedAt?: string;
  /** false = le .filarr n'existe plus à boxPath (déplacé/renommé ?). */
  exists?: boolean;
}

/** Progression poussée par le main pendant protect/open/extract. */
export interface BoxProgressEvent {
  boxPath?: string;
  phase: 'encrypt' | 'verify' | 'decrypt' | 'delete';
  processed: number;
  total: number;
}

// ==================== Appels défensifs ====================

const ipc = () => window.electron?.ipcRenderer;

const UNAVAILABLE_PATTERN =
  /Blocked (invoke|send|listener) on unauthorized channel|No handler registered/i;

/** Retire le préfixe des rejets IPC Electron pour remonter la vraie raison. */
function cleanIpcError(message: string): string {
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}

async function safeInvoke<T>(channel: string, ...args: unknown[]): Promise<BoxBridgeResult<T>> {
  const renderer = ipc();
  if (!renderer) return { ok: false, unavailable: true, error: 'Electron indisponible' };
  try {
    const data = (await renderer.invoke(channel, ...args)) as T;
    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      unavailable: UNAVAILABLE_PATTERN.test(message),
      error: cleanIpcError(message),
    };
  }
}

// ==================== Contrat : appels ====================

/** Inspecte les premiers octets d'un .filarr (boîte / note JSON / inconnu). */
export function inspectBox(path: string): Promise<BoxBridgeResult<BoxInspectResult>> {
  return safeInvoke('filarrBox:inspect', path);
}

/**
 * Protège des fichiers/dossiers SUR PLACE : chaque source devient un
 * conteneur `.filarr` chiffré (destDir ou à côté de l'original). Les
 * originaux ne sont supprimés qu'APRÈS vérification que le conteneur se
 * déchiffre à l'identique (hash flux) — séquencement côté main.
 */
export function protectInPlace(
  args: ProtectArgs
): Promise<BoxBridgeResult<{ results: ProtectItemResult[] }>> {
  return safeInvoke('filarrBox:protect', args);
}

/**
 * Ouvre un conteneur FICHIER : déchiffrement vers une copie temporaire
 * suivie (purge au verrouillage/fermeture) + ouverture via l'application
 * par défaut. Les enregistrements sont réécrits dans le conteneur.
 */
export function openBoxFile(boxPath: string): Promise<BoxBridgeResult<{ name?: string }>> {
  return safeInvoke('filarrBox:openFile', boxPath);
}

/** Ouvre un conteneur DOSSIER : méta + index des entrées (aucune donnée). */
export function openBoxFolder(boxPath: string): Promise<BoxBridgeResult<BoxFolderListing>> {
  return safeInvoke('filarrBox:openFolder', boxPath);
}

/**
 * Extrait UNE entrée d'un conteneur dossier.
 * mode 'open'  : copie temporaire suivie + ouverture (lecture seule).
 * mode 'saveAs': dialogue d'enregistrement côté main (action explicite,
 *                fichier non suivi).
 */
export function extractBoxEntry(
  boxPath: string,
  entryPath: string,
  mode: 'open' | 'saveAs'
): Promise<BoxBridgeResult<{ openedPath?: string; savedPath?: string; canceled?: boolean }>> {
  return safeInvoke('filarrBox:extractEntry', boxPath, entryPath, { mode });
}

/** Extrait TOUT l'arbre d'un conteneur dossier vers un dossier choisi. */
export function extractAllBoxEntries(
  boxPath: string
): Promise<BoxBridgeResult<{ destDir?: string; canceled?: boolean; fileCount?: number }>> {
  return safeInvoke('filarrBox:extractAll', boxPath);
}

/**
 * Déprotège un conteneur : restaure le clair à côté du .filarr (vérifié),
 * puis supprime le conteneur et son entrée de registre.
 */
export function unprotectBox(boxPath: string): Promise<BoxBridgeResult<{ restoredPath?: string }>> {
  return safeInvoke('filarrBox:unprotect', boxPath);
}

/** Liste du registre « Mes fichiers protégés » (indisponible verrouillé). */
export function listProtectedItems(): Promise<BoxBridgeResult<ProtectedRegistryEntry[]>> {
  return safeInvoke('filarrBox:registryList');
}

/** Retire une entrée de la liste (le conteneur lui-même n'est pas touché). */
export function removeProtectedItem(id: string): Promise<BoxBridgeResult> {
  return safeInvoke('filarrBox:registryRemove', id);
}

/**
 * Re-pointe une entrée introuvable vers un .filarr choisi par l'utilisateur
 * (le main valide magic + nom des métadonnées avant d'accepter).
 */
export function relocateProtectedItem(
  id: string,
  newPath: string
): Promise<BoxBridgeResult<ProtectedRegistryEntry>> {
  return safeInvoke('filarrBox:registryRelocate', id, newPath);
}

/** Affiche le conteneur (chemin OS réel) dans l'explorateur de fichiers. */
export function showBoxInFolder(boxPath: string): Promise<BoxBridgeResult> {
  return safeInvoke('filarrBox:showInFolder', boxPath);
}

/**
 * Écoute la progression poussée par le main (chiffrement/vérification).
 * Retourne un désabonnement ; no-op silencieux si le canal n'est pas encore
 * dans l'allowlist preload.
 */
export function onBoxProgress(callback: (event: BoxProgressEvent) => void): () => void {
  const renderer = ipc();
  if (!renderer) return () => {};
  try {
    return renderer.on('filarrBox:progress', (payload: unknown) => {
      const p = payload as Partial<BoxProgressEvent> | undefined;
      if (p && typeof p.processed === 'number' && typeof p.total === 'number' && p.phase) {
        callback(p as BoxProgressEvent);
      }
    });
  } catch {
    return () => {};
  }
}

// ==================== File d'attente des ouvertures ====================
// Un double-clic .filarr peut arriver AVANT que la fenêtre principale soit
// déverrouillée/montée. desktopProtectionBridge pousse ici ; FilarrBoxHost
// (monté uniquement une fois le coffre déverrouillé) draine à son montage
// et en direct via l'abonnement. La file survit au verrouillage : c'est le
// mécanisme « queue-and-retry » du design.

export interface PendingBoxOpen {
  boxPath: string;
  kind: BoxKind;
}

const pendingOpens: PendingBoxOpen[] = [];
let openListener: ((open: PendingBoxOpen) => void) | null = null;

/** Pousse une ouverture (host monté → livrée en direct ; sinon en attente). */
export function queueBoxOpen(open: PendingBoxOpen): void {
  if (openListener) {
    openListener(open);
  } else {
    pendingOpens.push(open);
  }
}

/**
 * Abonne le host aux ouvertures. Draine immédiatement les ouvertures en
 * attente (double-clic pendant le verrouillage / avant montage), puis livre
 * en direct. Retourne un désabonnement.
 */
export function subscribeBoxOpen(listener: (open: PendingBoxOpen) => void): () => void {
  openListener = listener;
  for (const open of pendingOpens.splice(0)) {
    listener(open);
  }
  return () => {
    if (openListener === listener) openListener = null;
  };
}

// ==================== File « Protéger avec Filarr » (Wave 2b) ====================
// Le menu contextuel Windows (clic droit → « Protéger avec Filarr ») lance
// Filarr avec `--protect <chemin>` ; le main coalesce les invocations (une
// par élément sélectionné) puis pousse UN événement 'shell:protect-request'
// { paths } au renderer. desktopProtectionBridge le reçoit et pousse ici ;
// ShellProtectHost (monté uniquement une fois le coffre déverrouillé) draine
// à son montage et en direct — même mécanisme « queue-and-retry » que la file
// d'ouvertures ci-dessus : un clic droit pendant le verrouillage attend, le
// dialogue s'ouvre automatiquement au déverrouillage.

const pendingShellProtectPaths: string[] = [];
let shellProtectListener: ((paths: string[]) => void) | null = null;

/**
 * Pousse une demande de protection venue du menu contextuel Windows.
 * Retourne true si elle a été livrée en direct (host monté = coffre
 * déverrouillé) ; false si mise en attente jusqu'au déverrouillage — la
 * surface appelante peut alors afficher une notice honnête.
 */
export function queueShellProtectRequest(paths: string[]): boolean {
  const cleaned = paths.filter((p) => p.length > 0);
  if (cleaned.length === 0) return true;
  if (shellProtectListener) {
    shellProtectListener(cleaned);
    return true;
  }
  // En attente : accumulation dédupliquée — plusieurs clics droits pendant le
  // verrouillage se coalescent en UN seul lot présenté au déverrouillage.
  for (const p of cleaned) {
    if (!pendingShellProtectPaths.includes(p)) pendingShellProtectPaths.push(p);
  }
  return false;
}

/**
 * Abonne le host aux demandes du menu contextuel. Draine immédiatement les
 * chemins en attente (clic droit pendant le verrouillage / avant montage) en
 * UN SEUL lot, puis livre en direct. Retourne un désabonnement.
 */
export function subscribeShellProtectRequest(listener: (paths: string[]) => void): () => void {
  shellProtectListener = listener;
  const pending = pendingShellProtectPaths.splice(0);
  if (pending.length > 0) {
    listener(pending);
  }
  return () => {
    if (shellProtectListener === listener) shellProtectListener = null;
  };
}

// ==================== Signal « registre modifié » ====================
// La liste des Paramètres se rafraîchit quand une protection/déprotection
// aboutit ailleurs (dialogue FolderView, host, mini-vault) — micro-bus
// module-level, même pattern que la file ci-dessus.

const registryListeners = new Set<() => void>();

/** Notifie toutes les surfaces que le registre a changé. */
export function notifyRegistryChanged(): void {
  for (const listener of registryListeners) {
    try {
      listener();
    } catch {
      // Un listener cassé ne doit pas empêcher les autres de se rafraîchir.
    }
  }
}

/** Abonne une surface au signal de rafraîchissement. Retourne un désabonnement. */
export function subscribeRegistryChanged(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}
