/**
 * Contrat renderer ↔ process principal pour « Publier ce coffre sur le compte ».
 *
 * Ce qui traverse ce pont : des compteurs, des noms de profil, des verdicts.
 * JAMAIS une clé, jamais un octet de contenu, jamais une URL présignée — ces
 * dernières sont des secrets porteurs et n'ont rien à faire dans un renderer.
 *
 * La BASCULE a son propre canal (`publish:commitSwitch`) : elle n'est jamais un
 * effet de bord d'un autre appel. Le geste qui abandonne la clé d'un coffre
 * doit être aussi explicite dans le code qu'il l'est à l'écran.
 */

export type PublishState =
  | 'PREPARING'
  | 'READY'
  | 'PUBLISHING'
  | 'VERIFYING'
  | 'SWITCHING'
  | 'DONE'
  | 'FAILED'
  | 'ABANDONED';

export type PublishErrorCode =
  | 'network'
  | 'quota-exceeded'
  | 'key-diverged'
  | 'verify-failed'
  | 'internal';

export interface PublishTargetProfile {
  localProfileId: string;
  targetProfileId: string;
  targetName: string;
  itemCount: number;
  byteCount: number;
  notesBundle: boolean;
  relocated: boolean;
}

export interface PublishAbandonedProfile {
  localProfileId: string;
  name: string;
  itemCount: number;
  byteCount: number;
  acceptedAt: string;
}

/**
 * Un obstacle à la bascule — et JAMAIS un cul-de-sac : chaque forme doit mener
 * à un geste NOMMÉ à l'écran. Union discriminée pour que l'interface soit
 * OBLIGÉE de traiter chaque cas (un `kind` ajouté sans action ne compile pas).
 */
export type PublishBlocker =
  | {
      kind: 'oversize';
      localProfileId: string;
      itemKey: string;
      name: string;
      size: number;
    }
  | { kind: 'keychain-unavailable' };

export interface PublishSnapshot {
  state: PublishState;
  migrationId: string;
  counters: {
    totalItems: number;
    doneItems: number;
    damagedItems: number;
    totalBytes: number;
    doneBytes: number;
  };
  targetProfiles: PublishTargetProfile[];
  abandonedProfiles: PublishAbandonedProfile[];
  blockers: PublishBlocker[];
  verify: { planned: number; ok: number; failed: string[]; full: boolean };
  lastError: { code: PublishErrorCode; itemKey: string | null } | null;
  currentLabel: string;
  /** `null` ⇒ on ne sait pas encore, et l'écran n'affiche RIEN. */
  etaSeconds: number | null;
  paused: boolean;
}

export interface PublishInventoryOptions {
  abandonedProfileIds?: string[];
  renames?: Record<string, string>;
  fullVerify?: boolean;
}

interface IpcResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

function ipc(): { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } | null {
  return window.electron?.ipcRenderer ?? null;
}

export async function getPublishState(): Promise<PublishSnapshot | null> {
  const bridge = ipc();
  if (!bridge) return null;
  return (await bridge.invoke('publish:getState')) as PublishSnapshot | null;
}

export async function buildPublishInventory(
  options: PublishInventoryOptions
): Promise<IpcResult<PublishSnapshot>> {
  const bridge = ipc();
  if (!bridge) return { success: false, error: 'IPC indisponible' };
  return (await bridge.invoke('publish:buildInventory', options)) as IpcResult<PublishSnapshot>;
}

export async function startPublishing(): Promise<IpcResult<void>> {
  const bridge = ipc();
  if (!bridge) return { success: false, error: 'IPC indisponible' };
  return (await bridge.invoke('publish:start')) as IpcResult<void>;
}

/** Pause — PAS abandon. Rien n'est nettoyé, tout se reprend d'un bouton. */
export async function pausePublishing(): Promise<IpcResult<void>> {
  const bridge = ipc();
  if (!bridge) return { success: false, error: 'IPC indisponible' };
  return (await bridge.invoke('publish:pause')) as IpcResult<void>;
}

export async function retryPublishing(): Promise<IpcResult<void>> {
  const bridge = ipc();
  if (!bridge) return { success: false, error: 'IPC indisponible' };
  return (await bridge.invoke('publish:retry')) as IpcResult<void>;
}

/**
 * LA BASCULE. Le process principal revérifie les trois verrous avant d'agir.
 *
 * L'ADOPTION EN MÉMOIRE FAIT PARTIE DU MÊME GESTE (règle C4). Le process
 * principal a déjà remplacé sa clé de session ; le renderer, lui, tient sa
 * PROPRE copie de la FEK et continuerait de sceller ses nouveaux fichiers sous
 * l'ANCIENNE clé si on ne la rechargeait pas ici. Attendre un redémarrage
 * laisserait une fenêtre où l'écran annonce le succès pendant que l'application
 * écrit sous une clé que plus rien ne désigne comme active.
 */
export async function commitKeySwitch(): Promise<IpcResult<PublishSnapshot>> {
  const bridge = ipc();
  if (!bridge) return { success: false, error: 'IPC indisponible' };
  const result = (await bridge.invoke('publish:commitSwitch')) as IpcResult<PublishSnapshot>;
  if (result.success) {
    await adoptSwitchedKeyInRenderer();
  }
  return result;
}

/**
 * Recharge, côté renderer, la clé du compte fraîchement promue, ET les clés
 * RETIRÉES qui ouvrent encore tout le contenu antérieur à la bascule.
 *
 * `hybrid:loadFEK` relit `.fek_safe`, que la bascule vient de promouvoir : la
 * clé rendue est donc celle du compte. Un échec ici n'annule pas la bascule
 * (le disque est déjà promu) mais doit être VISIBLE — d'où la remontée
 * d'erreur plutôt qu'un `catch` muet.
 */
export async function adoptSwitchedKeyInRenderer(): Promise<void> {
  const bridge = ipc();
  if (!bridge) return;
  const { importFEKRaw, refreshRetiredFeks } = await import('../auth/hybridCrypto');
  const rawBytes = (await bridge.invoke('hybrid:loadFEK')) as number[] | null;
  if (rawBytes && rawBytes.length > 0) {
    await importFEKRaw(new Uint8Array(rawBytes));
  }
  await refreshRetiredFeks();
}

/**
 * La bascule vient d'adopter la clé du compte côté process principal.
 * Rend la fonction de désabonnement. Utile quand la bascule a été menée par une
 * REPRISE au démarrage plutôt que par le bouton de l'écran.
 */
export function onPublishKeyAdopted(handler: () => void): () => void {
  const bridge = window.electron?.ipcRenderer;
  if (!bridge) return () => undefined;
  return bridge.on('publish:key-adopted', () => handler());
}

/** Une seule écoute permanente, quel que soit le nombre d'appels à l'installeur. */
let keyAdoptionUnsubscribe: (() => void) | null = null;

/**
 * Écoute PERMANENTE de `publish:key-adopted` — la correction ne dépend
 * d'AUCUN écran.
 *
 * Une bascule peut s'achever par la REPRISE au démarrage (`resumeOnStartup`,
 * décision `resume-switch`) sans que l'écran « Publier ce coffre » soit monté.
 * Le process principal a alors déjà adopté la clé du compte ; si le renderer
 * n'écoutait que depuis la modale, il garderait sa PROPRE copie de l'ancienne
 * FEK et scellerait ses nouveaux fichiers sous une clé que plus rien ne
 * désigne comme active. D'où cet abonnement installé au bootstrap du renderer
 * (appel explicite dans `App.tsx` + auto-installation au chargement du module,
 * qui fait partie du bundle initial), et jamais désabonné.
 *
 * Idempotent : un second appel ne crée pas de second abonnement. L'échec de
 * l'adoption est journalisé sans détail sensible (jamais d'octet de clé) ;
 * il n'annule pas la bascule, déjà actée sur le disque par le process
 * principal.
 */
export function initPublishKeyAdoption(): void {
  if (keyAdoptionUnsubscribe) return;
  const bridge = window.electron?.ipcRenderer;
  if (!bridge) return;
  keyAdoptionUnsubscribe = bridge.on('publish:key-adopted', () => {
    void adoptSwitchedKeyInRenderer().catch((err: unknown) => {
      console.error(
        '[publish] Adoption de la clé côté renderer en échec:',
        err instanceof Error ? err.message : 'erreur inconnue'
      );
    });
  });
}

// Auto-installation au chargement du module : `publishBridge` est importé
// statiquement (chaîne App → Settings → modales), donc évalué au bootstrap du
// renderer, AVANT tout montage d'écran. Sans `window.electron` (tests, web),
// l'appel est un no-op et l'appel explicite de `App.tsx` reste possible.
initPublishKeyAdoption();

export async function abandonPublishing(): Promise<IpcResult<PublishSnapshot>> {
  const bridge = ipc();
  if (!bridge) return { success: false, error: 'IPC indisponible' };
  return (await bridge.invoke('publish:abandon')) as IpcResult<PublishSnapshot>;
}

/** S'abonne aux changements d'état. Rend la fonction de désabonnement. */
export function onPublishStateChanged(handler: (snapshot: PublishSnapshot) => void): () => void {
  const bridge = window.electron?.ipcRenderer;
  if (!bridge) return () => undefined;
  return bridge.on('publish:state-changed', (snapshot: PublishSnapshot) => handler(snapshot));
}

/** Formatage d'octets, en base 1000 comme partout ailleurs dans l'application. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} o`;
  const units = ['ko', 'Mo', 'Go', 'To'];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}
