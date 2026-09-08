/**
 * Desktop Protection Bridge (Wave 1) — côté renderer.
 *
 * Point UNIQUE du contrat IPC renderer ↔ main pour la surface de protection
 * du bureau. Le main process (electron/main.ts) implémente ces canaux en se
 * référant à CE fichier — ne pas renommer un canal sans mettre à jour les
 * deux côtés + les allowlists preload.ts.
 *
 * Canaux du contrat :
 *   invoke  : 'vault:purgeTemp'           → { deletedCount, errors }
 *   invoke  : 'file:secureDeleteOriginal' → { verified } (JETTE un message
 *             français si la vérification/suppression échoue — l'original
 *             est alors TOUJOURS conservé)
 *   invoke  : 'app:setGlobalHotkey'       → { registered: { mini, lock } }
 *   invoke  : 'miniMode:getState'         → { locked }
 *   invoke  : 'miniMode:getRecent'        → RecentProtectedItem[]
 *   invoke  : 'miniMode:protectFiles'     → { imported, failed } (import
 *             complet côté main dans « Boîte de réception » ; jette si le
 *             coffre est verrouillé)
 *   invoke  : 'miniMode:lockVault'        → { locked: true } (verrouillage
 *             main-side : FEK session effacée + purge + broadcast)
 *   invoke  : 'miniMode:openMain' / 'miniMode:hide'
 *   invoke  : 'flag:set' (clé 'desktop-protection') → miroir des réglages,
 *             appliqué EN DIRECT par le main (raccourcis, powerMonitor,
 *             purge au verrouillage) et relu au boot depuis filarr-flags.json
 *   send    : 'vault:renderer-lock-state' ← { locked } poussé par le renderer
 *             (seule source de vérité pour les profils locaux à clé machine)
 *   receive : 'vault:lock-request'        → le main demande le verrouillage
 *   receive : 'mini:refresh'              → la fenêtre mini doit se rafraîchir
 *   receive : 'tray:open-recent'          → naviguer vers un fichier récent
 *   receive : 'filarr-file-opened'        → un .filarr a été double-cliqué ;
 *             routage Wave 2 par octets magiques via 'filarrBox:inspect'
 *             (conteneur chiffré / sauvegarde de note JSON / inconnu) —
 *             voir filarrBoxBridge.ts pour le contrat des conteneurs
 *   receive : 'shell:protect-request'     → { paths } clic droit Windows
 *             « Protéger avec Filarr » (Wave 2b) — le main coalesce les
 *             invocations --protect (une par élément sélectionné) en un lot ;
 *             file « queue-and-retry » de filarrBoxBridge, drainée par
 *             ShellProtectHost (dialogue Protéger sur place pré-rempli)
 *
 * TOUS les appels sont défensifs : si le main/preload n'expose pas encore un
 * canal, l'appel échoue proprement avec `{ ok: false, unavailable: true }` —
 * la UI reste honnête (« fonction indisponible ») sans rien casser.
 */

import i18n from '../../i18n/config';
import {
  showErrorNotification,
  showInfoNotification,
  showSuccessNotification,
} from '../../store/slices/uiSlice';
import type { DesktopProtectionSettings } from '../../store/slices/settingsSlice';
import { inspectBox, queueBoxOpen, queueShellProtectRequest } from './filarrBoxBridge';
import { setPendingInvite } from '../invites/pendingInvite';

// Opt-in du ReduxNotificationsHost : seules les notifications marquées
// `metadata.source` sont rendues (les non-marquées sont des doublons legacy
// des hooks CRUD). Sans ce tag, les toasts de ce bridge tombent dans le vide.
const TOAST_META = { metadata: { source: 'desktopProtection' } } as const;

// ==================== Types du contrat ====================

/** Résultat commun — `unavailable` = canal non exposé (main pas à jour). */
export interface BridgeResult<T = undefined> {
  ok: boolean;
  unavailable?: boolean;
  error?: string;
  data?: T;
}

/** Élément récemment protégé (tray + fenêtre mini — noms seuls, jamais de contenu). */
export interface RecentProtectedItem {
  id: string;
  name: string;
  folderId: string;
  size?: number;
  protectedAt?: string; // ISO
}

/** État du coffre vu par la fenêtre mini (source : main process). */
export interface MiniVaultState {
  locked: boolean;
}

/** Clé du flag (filarr-flags.json) portant le miroir des réglages. */
export const DESKTOP_PROTECTION_FLAG_KEY = 'desktop-protection';

// ==================== Appels défensifs ====================

const ipc = () => window.electron?.ipcRenderer;

const UNAVAILABLE_PATTERN =
  /Blocked (invoke|send|listener) on unauthorized channel|No handler registered/i;

/**
 * Les rejets IPC d'Electron préfixent le message d'origine
 * ("Error invoking remote method 'x': Error: <raison française>") —
 * on retire le préfixe pour faire remonter la vraie raison jusqu'aux toasts.
 */
function cleanIpcError(message: string): string {
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}

async function safeInvoke<T>(channel: string, ...args: unknown[]): Promise<BridgeResult<T>> {
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

// ==================== Purge des fichiers temporaires ====================

/**
 * Purge immédiate des copies de travail en clair (fichiers ouverts depuis le
 * coffre, glisser-sortir, aperçus). Effacement via secureDelete côté main —
 * best-effort sur SSD (wear-leveling / TRIM) : ne jamais promettre
 * « irrécupérable » dans la UI.
 */
export function purgeTempFiles(): Promise<BridgeResult<{ deletedCount: number; errors: number }>> {
  return safeInvoke('vault:purgeTemp');
}

// ==================== Déplacer dans le coffre ====================

export interface SecureDeleteOriginalArgs {
  /** Chemin OS du fichier source à supprimer. */
  sourcePath: string;
  /** Dossier du coffre où la copie chiffrée vient d'être écrite. */
  folderId: string;
  /** Nom du fichier dans le coffre. */
  fileName: string;
}

/**
 * Demande au main de supprimer l'original APRÈS avoir vérifié que la copie
 * chiffrée du coffre se déchiffre intégralement (hash flux comparé à la
 * source — aucun clair matérialisé). À n'appeler qu'une fois la sauvegarde
 * ET les métadonnées écrites. En cas d'échec (rejet), l'original est
 * TOUJOURS conservé et `error` porte la raison en français.
 */
export function secureDeleteOriginal(
  args: SecureDeleteOriginalArgs
): Promise<BridgeResult<{ verified?: boolean }>> {
  return safeInvoke('file:secureDeleteOriginal', args);
}

// ==================== Raccourcis globaux ====================

export interface GlobalHotkeyConfig {
  enabled: boolean;
  /** Accélérateur Electron — ouvrir/fermer le mini-mode. */
  mini: string;
  /** Accélérateur Electron — tout verrouiller. */
  lock: string;
}

/**
 * (Ré)enregistre les raccourcis globaux côté main. `registered.*` à false =
 * accélérateur déjà pris par une autre application (globalShortcut.register
 * retourne false sans exception) — la UI doit le dire au lieu de prétendre
 * que ça a marché.
 */
export function applyGlobalHotkeys(
  config: GlobalHotkeyConfig
): Promise<BridgeResult<{ registered?: { mini: boolean; lock: boolean } }>> {
  return safeInvoke('app:setGlobalHotkey', config);
}

// ==================== Miroir des préférences vers le main ====================

/**
 * Réplique les réglages nécessaires au main process (raccourcis, verrouillage
 * session/veille, purge au verrouillage) dans filarr-flags.json via le canal
 * EXISTANT 'flag:set'. Le main les applique EN DIRECT et les relit au boot —
 * le state Redux est renderer-only, sans ce miroir le main ne saurait rien.
 * Les champs d'import (copier/déplacer) restent renderer-only.
 */
export async function mirrorDesktopSettingsToMain(
  settings: DesktopProtectionSettings
): Promise<BridgeResult> {
  const payload = JSON.stringify({
    hotkeysEnabled: settings.hotkeysEnabled,
    hotkeyMini: settings.hotkeyMini,
    hotkeyLock: settings.hotkeyLock,
    lockOnOsLock: settings.lockOnOsLock,
    lockOnSuspend: settings.lockOnSuspend,
    purgeTempOnLock: settings.purgeTempOnLock,
  });
  return safeInvoke('flag:set', DESKTOP_PROTECTION_FLAG_KEY, payload);
}

// ==================== Verrouillage ====================

/**
 * Écoute la demande de verrouillage envoyée par le main process
 * (powerMonitor lock-screen/suspend, raccourci global, action du tray).
 * Retourne une fonction de désabonnement.
 */
export function onLockRequest(callback: () => void): () => void {
  const renderer = ipc();
  if (!renderer) return () => {};
  try {
    return renderer.on('vault:lock-request', callback);
  } catch {
    // Canal absent de l'allowlist preload (main pas à jour) — no-op silencieux.
    return () => {};
  }
}

/**
 * Pousse l'état de verrouillage du renderer vers le main (icône du tray,
 * fenêtre mini). Les profils locaux (clé machine) n'ont jamais de session
 * key main-side : ce push est la seule source de vérité pour eux.
 */
export function pushRendererLockState(locked: boolean): void {
  const renderer = ipc();
  if (!renderer) return;
  try {
    renderer.send('vault:renderer-lock-state', { locked });
  } catch {
    // Canal pas encore dans l'allowlist preload — silencieux, best-effort.
  }
}

// ==================== Fenêtre mini-mode ====================

/** État du coffre pour la fenêtre mini. */
export function getMiniVaultState(): Promise<BridgeResult<MiniVaultState>> {
  return safeInvoke('miniMode:getState');
}

/** Derniers éléments protégés (affichés dans le mini-mode ; vide si verrouillé). */
export function getRecentProtected(): Promise<BridgeResult<RecentProtectedItem[]>> {
  return safeInvoke('miniMode:getRecent');
}

/**
 * Protège des fichiers déposés sur le mini-mode : import COMPLET côté main
 * (chiffrement streaming + métadonnées + quota + sync) dans le dossier
 * « Boîte de réception » du profil actif. Rejeté si le coffre est verrouillé.
 */
export function protectFiles(
  paths: string[]
): Promise<BridgeResult<{ imported?: number; failed?: number }>> {
  return safeInvoke('miniMode:protectFiles', { paths });
}

/** Tout verrouiller depuis le mini-mode (main-side : session key + purge + broadcast). */
export function lockVaultFromMini(): Promise<BridgeResult<{ locked?: boolean }>> {
  return safeInvoke('miniMode:lockVault');
}

/** Cache la fenêtre mini et affiche/focus la fenêtre principale. */
export function openMainWindow(): Promise<BridgeResult> {
  return safeInvoke('miniMode:openMain');
}

/** Cache la fenêtre mini (croix du mini-mode). */
export function hideMiniWindow(): Promise<BridgeResult> {
  return safeInvoke('miniMode:hide');
}

/**
 * Écoute le signal de rafraîchissement poussé par le main à la fenêtre mini
 * (verrouillage, nouveaux récents, réglages). Retourne un désabonnement.
 */
export function onMiniRefresh(callback: () => void): () => void {
  const renderer = ipc();
  if (!renderer) return () => {};
  try {
    return renderer.on('mini:refresh', callback);
  } catch {
    return () => {};
  }
}

// ==================== Listeners fenêtre principale ====================
// « Fichiers récents » du tray (navigation) et .filarr double-cliqué.
// La protection tray/mini est un import complet CÔTÉ MAIN (le renderer voit
// arriver les dossiers via 'foldersUpdated') — rien à orchestrer ici.

interface DesktopBridgeStore {
  // Signature volontairement minimale : seuls des action-objets de
  // notification sont dispatchés ici (compatible avec le store réel).
  dispatch: (action: { type: string }) => unknown;
}

// ==================== Routage .filarr double-cliqué (Wave 2) ====================

/**
 * Route un .filarr double-cliqué d'après ses premiers octets (inspection
 * côté main — le renderer ne lit jamais le fichier lui-même) :
 *  - conteneur protégé « FilarrBox » → file d'ouvertures de filarrBoxBridge
 *    (FilarrBoxHost la draine : fichier → ouverture temp ; dossier →
 *    mini-coffre navigable). Coffre verrouillé → mise en attente + notice ;
 *    l'ouverture repart automatiquement au déverrouillage (le host n'est
 *    monté que déverrouillé).
 *  - sauvegarde de note JSON (noteExportService, format historique en clair)
 *    → chemin d'import de notes EXISTANT (jamais le parseur de conteneur).
 *  - inconnu (ex. blob V3 brut renommé) → notice honnête.
 */
async function routeFilarrFileOpen(store: DesktopBridgeStore, filePath: string): Promise<void> {
  const name = filePath.split(/[\\/]/).pop() || '.filarr';
  const res = await inspectBox(filePath);

  if (!res.ok) {
    if (res.unavailable) {
      // Main pas encore à jour (contrat Wave 2 absent) : retomber sur la
      // notice Wave 1 — honnête, sans prétendre savoir ce qu'est le fichier.
      store.dispatch(
        showInfoNotification(
          i18n.t(
            'desktopProtection.filarrFileOpened',
            '« {{name}} » est un conteneur Filarr — importez-le via Paramètres → Stockage.',
            { name }
          ),
          TOAST_META
        )
      );
    } else {
      // Raison française précise du main (corrompu, autre appareil…).
      store.dispatch(
        showErrorNotification(
          res.error ||
            i18n.t('desktopProtection.box.openFailed', 'Impossible d’ouvrir « {{name}} ».', {
              name,
            }),
          TOAST_META
        )
      );
    }
    return;
  }

  const inspected = res.data;
  if (!inspected) return;

  switch (inspected.type) {
    case 'box': {
      if (inspected.locked) {
        store.dispatch(
          showInfoNotification(
            i18n.t(
              'desktopProtection.box.lockedQueued',
              'Coffre verrouillé — « {{name}} » s’ouvrira après le déverrouillage.',
              { name }
            ),
            TOAST_META
          )
        );
      }
      // Verrouillé ou non : on pousse dans la file. Le host n'est monté que
      // déverrouillé — l'ouverture part immédiatement ou au déverrouillage.
      queueBoxOpen({ boxPath: filePath, kind: inspected.kind });
      return;
    }
    case 'note': {
      // Sauvegarde de note JSON en clair (noteExportService) : même chemin
      // que l'import de notes de la liste — jamais le parseur de conteneur.
      const content = inspected.content;
      if (typeof content !== 'string' || content.length === 0) {
        store.dispatch(
          showInfoNotification(
            i18n.t(
              'desktopProtection.box.noteNoContent',
              '« {{name}} » est une sauvegarde de note — importez-la depuis la liste des notes.',
              { name }
            ),
            TOAST_META
          )
        );
        return;
      }
      try {
        const [{ importNoteFromFile }, { addNote, setEditingNote }] = await Promise.all([
          import('../notes/noteImportService'),
          import('../../store/slices/notesSlice'),
        ]);
        const note = importNoteFromFile(content, name);
        store.dispatch(addNote(note));
        store.dispatch(setEditingNote(note.id));
        store.dispatch(
          showSuccessNotification(
            i18n.t('desktopProtection.box.noteImported', 'Note « {{title}} » importée.', {
              title: note.title || name,
            }),
            TOAST_META
          )
        );
      } catch {
        store.dispatch(
          showErrorNotification(
            i18n.t(
              'desktopProtection.box.noteImportFailed',
              'Sauvegarde de note invalide — « {{name}} » n’a pas pu être importée.',
              { name }
            ),
            TOAST_META
          )
        );
      }
      return;
    }
    default:
      store.dispatch(
        showErrorNotification(
          i18n.t(
            'desktopProtection.box.notAContainer',
            'Ce fichier n’est pas un conteneur Filarr valide.'
          ),
          TOAST_META
        )
      );
  }
}

let initialized = false;
const unsubscribers: Array<() => void> = [];

/**
 * Initialise les listeners de la FENÊTRE PRINCIPALE (jamais la fenêtre
 * mini) : navigation vers un récent du tray + notice .filarr. Appelé après
 * la sélection du profil (le Router doit être monté pour naviguer).
 * Idempotent.
 */
export function initDesktopProtectionBridge(store: DesktopBridgeStore): void {
  if (initialized) return;
  if (!window.electron?.ipcRenderer) return;
  if (window.location.hash.startsWith('#/mini')) return;
  initialized = true;

  const renderer = window.electron.ipcRenderer;

  try {
    unsubscribers.push(
      renderer.on('tray:open-recent', (payload: { folderId?: unknown }) => {
        const folderId = typeof payload?.folderId === 'string' ? payload.folderId : null;
        if (folderId) {
          // HashRouter : la navigation par hash fonctionne depuis n'importe où.
          window.location.hash = `#/folder/${folderId}`;
        }
      })
    );
  } catch {
    // Canal absent de l'allowlist preload — la navigation tray restera
    // simplement inactive, rien d'autre à casser.
  }

  try {
    unsubscribers.push(
      renderer.on('filarr-file-opened', (payload: { path?: unknown }) => {
        const filePath = typeof payload?.path === 'string' ? payload.path : '';
        if (!filePath) return;
        void routeFilarrFileOpen(store, filePath);
      })
    );
  } catch {
    // Canal absent de l'allowlist preload — pas de routage .filarr, sans plus.
  }

  try {
    unsubscribers.push(
      renderer.on(
        'deep-link-invite',
        (payload: { kind?: unknown; token?: unknown; vaultId?: unknown; orgId?: unknown }) => {
          // Le main a déjà analysé et validé l'URI (electron/inviteProtocol.ts) ;
          // ici on ne fait qu'ARMER le porteur, exactement comme le collage
          // manuel. PendingInviteHost, seul à savoir si le coffre est
          // déverrouillé et le store hydraté, le reprend ensuite.
          const kind = payload?.kind === 'vault' ? 'vault' : 'org';
          const token = typeof payload?.token === 'string' ? payload.token : '';
          if (!token) return;
          setPendingInvite({
            kind,
            token,
            ...(typeof payload?.vaultId === 'string' ? { vaultId: payload.vaultId } : {}),
            ...(typeof payload?.orgId === 'string' ? { orgId: payload.orgId } : {}),
          });
        }
      )
    );
  } catch {
    // Canal absent de l'allowlist preload — le collage manuel reste le chemin.
  }

  try {
    unsubscribers.push(
      renderer.on('shell:protect-request', (payload: { paths?: unknown }) => {
        // Clic droit Windows « Protéger avec Filarr » (Wave 2b) — le main a
        // déjà coalescé les invocations --protect en un seul lot { paths }.
        const raw: unknown[] = Array.isArray(payload?.paths) ? payload.paths : [];
        const paths = raw.filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
        if (paths.length === 0) return;
        const delivered = queueShellProtectRequest(paths);
        if (!delivered) {
          // Host non monté = coffre verrouillé : le lot attend dans la file
          // (drainée par ShellProtectHost au déverrouillage) — le dire.
          store.dispatch(
            showInfoNotification(
              i18n.t(
                'desktopProtection.shellProtect.lockedQueued',
                'Coffre verrouillé — la protection de {{count}} élément(s) démarrera après le déverrouillage.',
                { count: paths.length }
              ),
              TOAST_META
            )
          );
        }
      })
    );
  } catch {
    // Canal absent de l'allowlist preload (main pas à jour) — le clic droit
    // Windows restera simplement sans effet, rien d'autre à casser.
  }
}

/** Détache les listeners (tests / changement complet de contexte). */
export function teardownDesktopProtectionBridge(): void {
  if (!initialized) return;
  for (const unsubscribe of unsubscribers.splice(0)) {
    try {
      unsubscribe();
    } catch {
      /* déjà détaché */
    }
  }
  initialized = false;
}
