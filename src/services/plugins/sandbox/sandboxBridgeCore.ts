/**
 * sandboxBridgeCore — le CŒUR du pont côté hôte, pur (aucun DOM : le port est
 * abstrait, les timers injectés — testable en env node).
 *
 * L'adversaire est le greffon : messages entrants validés (sandboxProtocol),
 * corrélation par requestId, timeouts individuels, et COUPURE (onFatal) sous
 * le spam de messages invalides — un greffon qui bombarde n'est pas un greffon
 * qui bogue, et l'hôte tient les clés du coffre.
 */

import { SANDBOX_PROTOCOL_VERSION, parseGuestMessage, type HostMessage } from './sandboxProtocol';

export const INIT_TIMEOUT_MS = 15_000;
export const REQUEST_TIMEOUT_MS = 10_000;
/** Au N-ième message invalide, le pont coupe. */
export const MAX_INVALID_MESSAGES = 20;

export interface SandboxPortLike {
  postMessage(data: unknown, transfer?: Transferable[]): void;
  close(): void;
}

export interface SandboxBridgeCallbacks {
  onDirty(dirty: boolean): void;
  /** Le SEUL chemin d'écriture — l'hôte re-chiffre et versionne. */
  saveBytes(bytes: Uint8Array): Promise<void>;
  onFatal(message: string): void;
}

export interface SandboxBridgeCore {
  /** À brancher sur port.onmessage côté DOM (reçoit event.data). */
  handleMessage(data: unknown): void;
  init(params: {
    code: string;
    editorId: string;
    fileName: string;
    readOnly: boolean;
    bytes: Uint8Array;
  }): Promise<void>;
  requestBytes(): Promise<Uint8Array>;
  dispose(): void;
}

type TimerFn = (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;

export function createSandboxBridgeCore(opts: {
  port: SandboxPortLike;
  callbacks: SandboxBridgeCallbacks;
  setTimeoutFn?: TimerFn;
  clearTimeoutFn?: (t: ReturnType<typeof setTimeout>) => void;
}): SandboxBridgeCore {
  const { port, callbacks } = opts;
  const setT: TimerFn = opts.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = opts.clearTimeoutFn ?? ((t: ReturnType<typeof setTimeout>) => clearTimeout(t));

  let disposed = false;
  let invalidCount = 0;
  let nextRequestId = 1;

  let mountResolve: (() => void) | null = null;
  let mountReject: ((e: Error) => void) | null = null;
  let mountTimer: ReturnType<typeof setTimeout> | null = null;

  const pendingBytes = new Map<
    number,
    {
      resolve: (b: Uint8Array) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  const send = (msg: HostMessage, transfer?: Transferable[]) => {
    if (disposed) return;
    try {
      port.postMessage(msg, transfer);
    } catch {
      /* port déjà fermé */
    }
  };

  const failAll = (message: string) => {
    if (mountReject) {
      mountReject(new Error(message));
      mountResolve = null;
      mountReject = null;
      if (mountTimer) clearT(mountTimer);
    }
    for (const [, pending] of pendingBytes) {
      clearT(pending.timer);
      pending.reject(new Error(message));
    }
    pendingBytes.clear();
  };

  const fatal = (message: string) => {
    failAll(message);
    callbacks.onFatal(message);
  };

  return {
    handleMessage(data: unknown) {
      if (disposed) return;
      const msg = parseGuestMessage(data);
      if (msg === null) {
        invalidCount++;
        if (invalidCount >= MAX_INVALID_MESSAGES) fatal('sandbox_protocol_abuse');
        return;
      }
      switch (msg.kind) {
        case 'ready':
          // Distingue « page morte » de « greffon lent » — informatif seulement.
          return;
        case 'mounted':
          if (mountResolve) {
            mountResolve();
            mountResolve = null;
            mountReject = null;
            if (mountTimer) clearT(mountTimer);
          }
          return;
        case 'mount-error':
          if (mountReject) {
            mountReject(new Error(msg.message || 'sandbox_mount_failed'));
            mountResolve = null;
            mountReject = null;
            if (mountTimer) clearT(mountTimer);
          }
          return;
        case 'dirty':
          callbacks.onDirty(msg.dirty);
          return;
        case 'save-request': {
          const requestId = msg.requestId;
          void callbacks
            .saveBytes(new Uint8Array(msg.bytes))
            .then(() => send({ kind: 'save-result', requestId, ok: true }))
            .catch((e: unknown) =>
              send({
                kind: 'save-result',
                requestId,
                ok: false,
                errorMessage: e instanceof Error ? e.message : 'save_failed',
              })
            );
          return;
        }
        case 'bytes-result': {
          const pending = pendingBytes.get(msg.requestId);
          if (!pending) return; // requête inconnue/expirée : ignoré
          pendingBytes.delete(msg.requestId);
          clearT(pending.timer);
          pending.resolve(new Uint8Array(msg.bytes));
          return;
        }
        case 'fatal':
          fatal(msg.message || 'sandbox_crashed');
          return;
      }
    },

    init(params) {
      return new Promise<void>((resolve, reject) => {
        mountResolve = resolve;
        mountReject = reject;
        mountTimer = setT(() => {
          if (mountReject) {
            mountReject(new Error('sandbox_init_timeout'));
            mountResolve = null;
            mountReject = null;
          }
        }, INIT_TIMEOUT_MS);
        // CLONE OBLIGATOIRE : le transfert DÉTACHE le buffer côté émetteur, et
        // l'appelant (la modale) garde les octets en état React. Imposé ici,
        // jamais laissé à l'appelant.
        const copie = params.bytes.slice();
        send(
          {
            kind: 'init',
            version: SANDBOX_PROTOCOL_VERSION,
            code: params.code,
            editorId: params.editorId,
            fileName: params.fileName,
            readOnly: params.readOnly,
            bytes: copie.buffer as ArrayBuffer,
          },
          [copie.buffer as ArrayBuffer]
        );
      });
    },

    requestBytes() {
      return new Promise<Uint8Array>((resolve, reject) => {
        const requestId = nextRequestId++;
        const timer = setT(() => {
          pendingBytes.delete(requestId);
          reject(new Error('sandbox_request_timeout'));
        }, REQUEST_TIMEOUT_MS);
        pendingBytes.set(requestId, { resolve, reject, timer });
        send({ kind: 'get-bytes', requestId });
      });
    },

    dispose() {
      if (disposed) return;
      send({ kind: 'destroy' });
      disposed = true;
      failAll('sandbox_disposed');
      try {
        port.close();
      } catch {
        /* déjà fermé */
      }
    },
  };
}
