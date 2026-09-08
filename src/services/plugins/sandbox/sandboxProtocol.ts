/**
 * sandboxProtocol — le PROTOCOLE du pont hôte ↔ greffon bac à sable.
 *
 * QUI EST L'ADVERSAIRE : le greffon lui-même. Tout message ENTRANT (côté hôte)
 * vient de code non revu qui tourne dans une iframe d'origine opaque — le
 * parseur refuse toute forme inattendue, plafonne chaque champ d'octets et
 * chaque chaîne, et ne jette JAMAIS (null, à charge du pont de compter et de
 * couper sous le spam). Symétriquement, le bootstrap de la page invitée
 * n'accepte qu'UN message du parent, et le contenu sensible ne passe QUE par
 * le MessagePort — privé par construction.
 *
 * Le message de bootstrap est le SEUL à passer par window.postMessage (ciblé
 * '*' : une origine opaque est inmatchable) — il ne transporte RIEN d'autre
 * que le type et le port.
 *
 * ÉVOLUTION RÉSERVÉE : kind:'yjs-update' (relais d'updates Yjs encodées pour
 * une future collaboration sandboxée). NON implémenté en v1 — donner à du code
 * non revu un flux d'écriture direct dans une salle partagée est une décision
 * de sécurité à instruire, pas un champ à ajouter.
 */

export const SANDBOX_PROTOCOL_VERSION = 1;
export const SANDBOX_BOOTSTRAP_TYPE = 'filarr-sandbox-bootstrap';
/** Plafond sur TOUT champ d'octets, entrant comme sortant. */
export const SANDBOX_MAX_BYTES = 64 * 1024 * 1024;
const MAX_MESSAGE_CHARS = 2000;

// ── Hôte → greffon ───────────────────────────────────────────────────────────

export type HostMessage =
  | {
      kind: 'init';
      version: number;
      code: string;
      editorId: string;
      fileName: string;
      readOnly: boolean;
      bytes: ArrayBuffer;
    }
  | { kind: 'save-result'; requestId: number; ok: boolean; errorMessage?: string }
  | { kind: 'get-bytes'; requestId: number }
  | { kind: 'destroy' };

// ── Greffon → hôte ───────────────────────────────────────────────────────────

export type GuestMessage =
  | { kind: 'ready'; version: number }
  | { kind: 'mounted' }
  | { kind: 'mount-error'; message: string }
  | { kind: 'dirty'; dirty: boolean }
  | { kind: 'save-request'; requestId: number; bytes: ArrayBuffer }
  | { kind: 'bytes-result'; requestId: number; bytes: ArrayBuffer }
  | { kind: 'fatal'; message: string };

// ── Validation stricte ───────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isRequestId(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && Number.isFinite(v) && v >= 0;
}

function isBytes(v: unknown): v is ArrayBuffer {
  return v instanceof ArrayBuffer && v.byteLength <= SANDBOX_MAX_BYTES;
}

function clampMessage(v: unknown): string | null {
  return typeof v === 'string' ? v.slice(0, MAX_MESSAGE_CHARS) : null;
}

/** Ce que le GREFFON envoie — LA surface d'attaque du pont côté hôte. */
export function parseGuestMessage(data: unknown): GuestMessage | null {
  if (!isRecord(data)) return null;
  switch (data.kind) {
    case 'ready':
      return typeof data.version === 'number' && Number.isFinite(data.version)
        ? { kind: 'ready', version: data.version }
        : null;
    case 'mounted':
      return { kind: 'mounted' };
    case 'mount-error': {
      const message = clampMessage(data.message);
      return message !== null ? { kind: 'mount-error', message } : null;
    }
    case 'dirty':
      return typeof data.dirty === 'boolean' ? { kind: 'dirty', dirty: data.dirty } : null;
    case 'save-request':
      return isRequestId(data.requestId) && isBytes(data.bytes)
        ? { kind: 'save-request', requestId: data.requestId, bytes: data.bytes }
        : null;
    case 'bytes-result':
      return isRequestId(data.requestId) && isBytes(data.bytes)
        ? { kind: 'bytes-result', requestId: data.requestId, bytes: data.bytes }
        : null;
    case 'fatal': {
      const message = clampMessage(data.message);
      return message !== null ? { kind: 'fatal', message } : null;
    }
    default:
      return null;
  }
}

/** Ce que l'HÔTE envoie — validé côté page invitée, même rigueur. */
export function parseHostMessage(data: unknown): HostMessage | null {
  if (!isRecord(data)) return null;
  switch (data.kind) {
    case 'init':
      return typeof data.version === 'number' &&
        typeof data.code === 'string' &&
        typeof data.editorId === 'string' &&
        typeof data.fileName === 'string' &&
        typeof data.readOnly === 'boolean' &&
        isBytes(data.bytes)
        ? {
            kind: 'init',
            version: data.version,
            code: data.code,
            editorId: data.editorId,
            fileName: data.fileName,
            readOnly: data.readOnly,
            bytes: data.bytes,
          }
        : null;
    case 'save-result':
      return isRequestId(data.requestId) && typeof data.ok === 'boolean'
        ? {
            kind: 'save-result',
            requestId: data.requestId,
            ok: data.ok,
            ...(typeof data.errorMessage === 'string'
              ? { errorMessage: data.errorMessage.slice(0, MAX_MESSAGE_CHARS) }
              : {}),
          }
        : null;
    case 'get-bytes':
      return isRequestId(data.requestId) ? { kind: 'get-bytes', requestId: data.requestId } : null;
    case 'destroy':
      return { kind: 'destroy' };
    default:
      return null;
  }
}
