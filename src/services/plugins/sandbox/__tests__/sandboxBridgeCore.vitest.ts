/**
 * sandboxBridgeCore — le pont, port bouchonné, timers factices.
 *
 * Ce qui se prouve : init CLONE les octets avant transfert (l'appelant garde
 * les siens), la corrélation par requestId tient sous l'entrelacement, un
 * greffon qui bombarde est COUPÉ, et dispose ne laisse aucune promesse
 * pendante.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createSandboxBridgeCore,
  MAX_INVALID_MESSAGES,
  type SandboxBridgeCore,
} from '../sandboxBridgeCore';

let posted: Array<{ data: never; transfer?: Transferable[] }>;
let closed: boolean;
let core: SandboxBridgeCore;
let onDirty: ReturnType<typeof vi.fn<(dirty: boolean) => void>>;
let saveBytes: ReturnType<typeof vi.fn<(bytes: Uint8Array) => Promise<void>>>;
let onFatal: ReturnType<typeof vi.fn<(message: string) => void>>;

beforeEach(() => {
  vi.useFakeTimers();
  posted = [];
  closed = false;
  onDirty = vi.fn<(dirty: boolean) => void>();
  saveBytes = vi.fn<(bytes: Uint8Array) => Promise<void>>(async () => {});
  onFatal = vi.fn<(message: string) => void>();
  core = createSandboxBridgeCore({
    port: {
      postMessage: (data, transfer) => posted.push({ data: data as never, transfer }),
      close: () => {
        closed = true;
      },
    },
    callbacks: { onDirty, saveBytes, onFatal },
  });
});

const initParams = {
  code: '(()=>{})()',
  editorId: 'e',
  fileName: 'f.sbx',
  readOnly: false,
  bytes: new Uint8Array([1, 2, 3]),
};

describe('init', () => {
  it('résout sur mounted ; CLONE les octets (l’original survit au transfert)', async () => {
    const original = new Uint8Array([9, 9, 9]);
    const p = core.init({ ...initParams, bytes: original });
    const sent = posted[0].data as { kind: string; bytes: ArrayBuffer };
    expect(sent.kind).toBe('init');
    // Le buffer transféré n'est PAS celui de l'original.
    expect(posted[0].transfer?.[0]).not.toBe(original.buffer);
    expect(new Uint8Array(sent.bytes)).toEqual(original);
    core.handleMessage({ kind: 'mounted' });
    await expect(p).resolves.toBeUndefined();
  });

  it('rejette sur mount-error, et sur timeout', async () => {
    const p1 = core.init(initParams);
    core.handleMessage({ kind: 'mount-error', message: 'schema cassé' });
    await expect(p1).rejects.toThrow('schema cassé');

    const p2 = core.init(initParams);
    vi.advanceTimersByTime(20_000);
    await expect(p2).rejects.toThrow('sandbox_init_timeout');
  });
});

describe('requestBytes', () => {
  it('corrèle deux requêtes ENTRELACÉES par requestId', async () => {
    const p1 = core.requestBytes();
    const p2 = core.requestBytes();
    const ids = posted
      .filter((m) => (m.data as { kind: string }).kind === 'get-bytes')
      .map((m) => (m.data as { requestId: number }).requestId);
    // Réponse à la SECONDE d'abord — l'entrelacement ne croise pas les fils.
    core.handleMessage({
      kind: 'bytes-result',
      requestId: ids[1],
      bytes: new Uint8Array([2]).buffer,
    });
    core.handleMessage({
      kind: 'bytes-result',
      requestId: ids[0],
      bytes: new Uint8Array([1]).buffer,
    });
    expect(Array.from(await p1)).toEqual([1]);
    expect(Array.from(await p2)).toEqual([2]);
  });

  it('time-out individuel ; une réponse à une requête expirée est ignorée', async () => {
    const p = core.requestBytes();
    vi.advanceTimersByTime(15_000);
    await expect(p).rejects.toThrow('sandbox_request_timeout');
    expect(() =>
      core.handleMessage({ kind: 'bytes-result', requestId: 1, bytes: new ArrayBuffer(1) })
    ).not.toThrow();
  });
});

describe('save-request', () => {
  it('appelle saveBytes et répond ok ; un rejet porte errorMessage', async () => {
    core.handleMessage({ kind: 'save-request', requestId: 5, bytes: new Uint8Array([7]).buffer });
    await vi.waitFor(() => expect(saveBytes).toHaveBeenCalled());
    await Promise.resolve();
    const result = posted.find((m) => (m.data as { kind: string }).kind === 'save-result');
    expect(result?.data).toMatchObject({ requestId: 5, ok: true });

    saveBytes.mockRejectedValueOnce(new Error('quota plein'));
    core.handleMessage({ kind: 'save-request', requestId: 6, bytes: new ArrayBuffer(1) });
    await vi.waitFor(() => {
      const r = posted.filter((m) => (m.data as { kind: string }).kind === 'save-result');
      expect(r.length).toBe(2);
    });
    const failed = posted.filter((m) => (m.data as { kind: string }).kind === 'save-result')[1];
    expect(failed.data).toMatchObject({ requestId: 6, ok: false, errorMessage: 'quota plein' });
  });
});

describe('défense', () => {
  it('un greffon qui bombarde de messages invalides est COUPÉ (onFatal)', () => {
    for (let i = 0; i < MAX_INVALID_MESSAGES; i++) core.handleMessage({ kind: 'garbage', i });
    expect(onFatal).toHaveBeenCalledWith('sandbox_protocol_abuse');
  });

  it('fatal rejette les promesses pendantes ; dispose aussi, et ferme le port', async () => {
    const p = core.requestBytes();
    core.handleMessage({ kind: 'fatal', message: 'crash greffon' });
    await expect(p).rejects.toThrow('crash greffon');
    expect(onFatal).toHaveBeenCalled();

    const p2 = core.requestBytes();
    core.dispose();
    await expect(p2).rejects.toThrow('sandbox_disposed');
    expect(closed).toBe(true);
  });
});
