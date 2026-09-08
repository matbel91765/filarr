/**
 * ipcRangeSource.ts — a {@link RangeSource} backed by the main-process
 * `stream:getSize` / `stream:readRange` IPC channels.
 *
 * Windowed previews (PDF via pdf.js range transport, ZIP via ranged
 * central-directory listing) need random access to a decrypted vault file
 * WITHOUT buffering the whole thing in renderer RAM. The main process already
 * decrypts V3 containers chunk-by-chunk (machine key OR session FEK — see
 * electron/storageService.ts createDecryptStreamAuto), so this module simply
 * pulls plaintext byte windows over IPC.
 *
 * Why IPC instead of the fetch-based {@link ./rangeSource} transport: the
 * renderer CSP `connect-src` deliberately does NOT whitelist `filarr-stream:`,
 * so `fetch('filarr-stream://…')` is blocked. Going through IPC keeps the CSP
 * tight while reusing the exact same main-side decrypt path the media
 * protocol uses.
 */

import type { RangeSource } from './rangeSource';

interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

function ipcRenderer(): IpcRendererLike {
  const bridge = (window as unknown as { electron?: { ipcRenderer?: IpcRendererLike } }).electron;
  if (!bridge?.ipcRenderer) {
    throw new Error('La lecture par plage est indisponible dans cet environnement.');
  }
  return bridge.ipcRenderer;
}

/**
 * Binds `folderId`/`fileName` into a {@link RangeSource} whose reads are served
 * by the main process. `readRange` uses a half-open window `[start, end)` (the
 * pdf.js / ZIP-reader convention); the IPC layer takes `(offset, length)`.
 */
export function createIpcRangeSource(folderId: string, fileName: string): RangeSource {
  return {
    async getSize(): Promise<number> {
      const size = await ipcRenderer().invoke('stream:getSize', folderId, fileName);
      if (typeof size !== 'number' || !Number.isFinite(size)) {
        throw new Error(`Impossible de déterminer la taille de « ${fileName} ».`);
      }
      return size;
    },
    async readRange(start: number, end: number): Promise<Uint8Array> {
      const length = end - start;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || length < 0) {
        throw new Error(`Plage d'octets invalide (${start}–${end}) pour « ${fileName} ».`);
      }
      if (length === 0) {
        return new Uint8Array(0);
      }
      const bytes = await ipcRenderer().invoke(
        'stream:readRange',
        folderId,
        fileName,
        start,
        length
      );
      // Electron marshals a main-side Buffer/Uint8Array back as a Uint8Array.
      if (bytes instanceof Uint8Array) {
        return bytes;
      }
      if (Array.isArray(bytes)) {
        return Uint8Array.from(bytes as number[]);
      }
      throw new Error(`Échec de lecture de « ${fileName} » : réponse inattendue.`);
    },
  };
}
